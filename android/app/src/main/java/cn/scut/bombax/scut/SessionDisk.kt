package cn.scut.bombax.scut

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import java.io.File

/**
 * The transform an [SessionEnvelope] is allowed to use.
 *
 * Production supplies a key that lives in the Android Keystore and cannot be exported; unit
 * tests supply an ordinary JCE key so the byte format can be verified on the host.
 */
interface SessionCipher {
    /** Returns whatever [decrypt] needs to read back, including any IV the implementation needs. */
    fun encrypt(plain: ByteArray): ByteArray

    fun decrypt(blob: ByteArray): ByteArray
}

/**
 * One version byte in front of whatever the cipher produced, so a file written by an older
 * build is recognised and discarded rather than decrypted into nonsense.
 */
object SessionEnvelope {
    const val VERSION: Byte = 1

    fun pack(json: String, cipher: SessionCipher): ByteArray {
        val body = cipher.encrypt(json.toByteArray(Charsets.UTF_8))
        return ByteArray(body.size + 1).also { out ->
            out[0] = VERSION
            System.arraycopy(body, 0, out, 1, body.size)
        }
    }

    /** Null means "unusable, treat as not logged in" — never a partial session. */
    fun unpack(blob: ByteArray, cipher: SessionCipher): String? {
        if (blob.size < 2 || blob[0] != VERSION) return null
        return runCatching {
            String(cipher.decrypt(blob.copyOfRange(1, blob.size)), Charsets.UTF_8)
        }.getOrNull()
    }
}

/**
 * AES/GCM under a non-exportable Keystore key.
 *
 * GCM needs a fresh 12-byte nonce per encryption; it is generated here and prepended to the
 * ciphertext, which is what makes the nonce safe to store in the clear.
 */
class KeystoreSessionCipher(
    private val alias: String = KEY_ALIAS,
    private val provider: String = ANDROID_KEYSTORE
) : SessionCipher {

    override fun encrypt(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION, provider).apply {
            init(Cipher.ENCRYPT_MODE, key())
        }
        val iv = cipher.iv
        val body = cipher.doFinal(plain)
        return ByteArray(iv.size + body.size).also { out ->
            out[0] = iv.size.toByte()
            System.arraycopy(iv, 0, out, 1, iv.size)
            System.arraycopy(body, 0, out, 1 + iv.size, body.size)
        }
    }

    override fun decrypt(blob: ByteArray): ByteArray {
        require(blob.size > 1) { "empty cipher blob" }
        val ivSize = blob[0].toInt()
        require(ivSize > 0 && blob.size > 1 + ivSize) { "malformed cipher blob" }
        val iv = blob.copyOfRange(1, 1 + ivSize)
        val body = blob.copyOfRange(1 + ivSize, blob.size)
        val cipher = Cipher.getInstance(TRANSFORMATION, provider).apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, iv))
        }
        return cipher.doFinal(body)
    }

    /** Generated once, then reused. Non-exportable, so the key bytes never exist in process memory. */
    private fun key(): SecretKey {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, provider)
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                // No biometric or device unlock binding: the app must restore its own session on
                // a cold start, and a locked-out key would only mean "log in again".
                .setUserAuthenticationRequired(false)
                .build()
        )
        return generator.generateKey()
    }

    companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "cn.scut.bombax.session"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val TAG_BITS = 128
    }
}

/**
 * Reads and writes the encrypted session file.
 *
 * The file lives in `noBackupFilesDir`, so neither Android's auto backup nor `adb backup`
 * carries it off the device; that is the whole reason this class takes a [File] instead of a
 * preference name.
 */
class FileSessionStore(
    private val file: File,
    private val cipher: SessionCipher
) {

    fun save(json: String): Boolean = runCatching {
        val parent = file.parentFile
        if (parent != null && !parent.isDirectory) parent.mkdirs()
        file.writeBytes(SessionEnvelope.pack(json, cipher))
        true
    }.getOrDefault(false)

    /** Null when there is nothing usable; an unreadable file is removed rather than retried. */
    fun load(): String? {
        if (!file.isFile) return null
        val text = runCatching {
            SessionEnvelope.unpack(file.readBytes(), cipher)
        }.getOrNull()
        if (text == null) {
            clear()
            Diag.warn("stage=session result=discarded reason=undecryptable")
        }
        return text
    }

    fun clear() {
        runCatching { if (file.isFile) file.delete() }
    }

    fun existsForTests(): Boolean = file.isFile
}
