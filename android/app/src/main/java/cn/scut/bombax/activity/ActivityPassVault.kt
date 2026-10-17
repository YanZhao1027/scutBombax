package cn.scut.bombax.activity

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Explicitly app-private, AndroidKeyStore-backed AES-256-GCM receipt vault.
 *
 * Stores event title, status and bearer pass in one encrypted AtomicFile.
 * The WebView only ever receives status summaries without bearer values.
 * Files live under filesDir: clearing the *cache* is not the same as
 * clearing app *storage*. Uninstall/clear-data loses the Keystore key.
 * android:allowBackup=false deliberately excludes the vault from backups.
 */
internal class ActivityPassVault(context: Context) {
    private val storage = AtomicFile(File(context.filesDir, "activity-onecode-v1.bin"))
    private val keyAlias = "cn.scut.bombax.activity.pass.v1"

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    private fun read(): JSONArray {
        if (!storage.baseFile.exists()) return JSONArray()
        val raw = storage.openRead().use { it.readBytes() }
        require(raw.size < 512_000) { "活动票夹已超出容量限制" }
        val envelope = JSONObject(String(raw, StandardCharsets.UTF_8))
        require(envelope.optInt("version") == 1) { "本机票夹版本不兼容" }
        val iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)
        require(iv.size == 12) { "本机加密参数异常" }
        val ciphertext = Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        val decrypted = cipher.doFinal(ciphertext)
        return JSONArray(String(decrypted, StandardCharsets.UTF_8))
    }

    private fun commit(entries: JSONArray) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val payload = cipher.doFinal(entries.toString().toByteArray(StandardCharsets.UTF_8))
        val encoded = JSONObject().put("version", 1)
            .put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .put("ciphertext", Base64.encodeToString(payload, Base64.NO_WRAP))
            .toString().toByteArray(StandardCharsets.UTF_8)
        val output = storage.startWrite()
        try {
            output.write(encoded)
            storage.finishWrite(output)
        } catch (error: Exception) {
            storage.failWrite(output)
            throw error
        }
    }

    @Synchronized fun listSummaries(): JSONArray {
        val source = read()
        val summary = JSONArray()
        for (i in 0 until source.length()) {
            val row = source.getJSONObject(i)
            summary.put(JSONObject()
                .put("eventId", row.getString("eventId"))
                .put("title", row.optString("title"))
                .put("state", row.optString("state"))
                .put("attended", row.optBoolean("attended"))
                .put("expiresAt", row.optLong("expiresAt"))
                .put("updatedAt", row.optLong("updatedAt")))
        }
        return summary
    }

    @Synchronized fun save(
        eventId: String, title: String, state: String,
        attended: Boolean, expiresAt: Long, token: String
    ) {
        require(ActivityPassRules.validEventId(eventId)) { "活动编号无效" }
        require(ActivityPassRules.validState(state)) { "未知报名状态" }
        require(title.isNotBlank() && title.length <= 120) { "活动名称无效" }
        require(System.currentTimeMillis() < expiresAt &&
            expiresAt < System.currentTimeMillis() + 5L * 365 * 86_400_000
        ) { "凭证期限异常" }
        require(Regex("^bqx_[0-9a-f]{64}$").matches(token)) { "一码通格式无效" }
        val source = read()
        val entries = JSONArray()
        for (i in 0 until source.length()) {
            val existing = source.getJSONObject(i)
            if (existing.getString("eventId") != eventId) entries.put(existing)
        }
        require(entries.length() < 48) { "本机票夹已满，请移除过期记录" }
        entries.put(JSONObject()
            .put("eventId", eventId)
            .put("title", title)
            .put("state", state)
            .put("attended", attended)
            .put("expiresAt", expiresAt)
            .put("updatedAt", System.currentTimeMillis())
            .put("token", token))
        commit(entries)
    }

    @Synchronized fun readReceipt(eventId: String): String? {
        if (!ActivityPassRules.validEventId(eventId)) return null
        val entries = read()
        for (i in 0 until entries.length()) {
            val row = entries.getJSONObject(i)
            if (row.optString("eventId") == eventId) {
                if (row.optLong("expiresAt") <= System.currentTimeMillis()) return null
                return row.getString("token")
            }
        }
        return null
    }

    @Synchronized fun forget(eventId: String) {
        require(ActivityPassRules.validEventId(eventId))
        val entries = read()
        val remaining = JSONArray()
        for (i in 0 until entries.length()) {
            val row = entries.getJSONObject(i)
            if (row.optString("eventId") != eventId) remaining.put(row)
        }
        commit(remaining)
    }
}
