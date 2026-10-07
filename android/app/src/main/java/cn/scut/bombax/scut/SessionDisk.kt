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
/**
 * `[iv length][iv][ciphertext+tag]`.
 *
 * Shared by production and the unit tests on purpose: the first version of this file packed the
 * nonce inline and allocated one byte too few, which only showed up on a device. Keeping the
 * layout in one place means the tests exercise the bytes the Keystore path actually writes.
 */
object CipherBlob {
    fun pack(iv: ByteArray, body: ByteArray): ByteArray =
        ByteArray(1 + iv.size + body.size).also { out ->
            out[0] = iv.size.toByte()
            System.arraycopy(iv, 0, out, 1, iv.size)
            System.arraycopy(body, 0, out, 1 + iv.size, body.size)
        }

    /** Null when the blob is empty, self-inconsistent, or too short to hold an IV. */
    fun unpack(blob: ByteArray): Pair<ByteArray, ByteArray>? {
        if (blob.isEmpty()) return null
        val ivSize = blob[0].toInt()
        if (ivSize <= 0 || blob.size <= 1 + ivSize) return null
        return blob.copyOfRange(1, 1 + ivSize) to blob.copyOfRange(1 + ivSize, blob.size)
    }
}

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
 * Only the *key* comes from the `AndroidKeyStore` provider; the cipher is the platform's own
 * `AES/GCM/NoPadding`. Asking that provider for the transformation throws
 * `NoSuchAlgorithmException: Provider AndroidKeyStore does not provide AES/GCM/NoPadding` —
 * which is exactly what the startup probe caught on a device on 2026-10-07, without spending a
 * login to find out.
 *
 * GCM needs a fresh 12-byte nonce per encryption; it is generated here and prepended to the
 * ciphertext, which is what makes the nonce safe to store in the clear.
 */
class KeystoreSessionCipher(
    private val alias: String = KEY_ALIAS,
    private val provider: String = ANDROID_KEYSTORE
) : SessionCipher {

    override fun encrypt(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.ENCRYPT_MODE, key())
        }
        val iv = cipher.iv
        return CipherBlob.pack(iv, cipher.doFinal(plain))
    }

    override fun decrypt(blob: ByteArray): ByteArray {
        val (iv, body) = CipherBlob.unpack(blob)
            ?: throw IllegalArgumentException("malformed cipher blob")
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
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

    /** Null on success, otherwise the exception class and message — enough to diagnose
     *  a Keystore or filesystem failure from logcat without putting any secret in the log. */
    fun save(json: String): String? = runCatching {
        val parent = file.parentFile
        if (parent != null && !parent.isDirectory) parent.mkdirs()
        file.writeBytes(SessionEnvelope.pack(json, cipher))
        null
    }.exceptionOrNull()?.let { "${it.javaClass.simpleName}: ${it.message}" }

    /**
     * Encrypts, writes, reads back and deletes a constant, so an unusable Keystore or an
     * unwritable directory is reported at startup instead of at the first login.
     *
     * Without this the only way to learn the cause was to log in, fail silently and ask the
     * user to log in again — which costs a real credential attempt.
     */
    fun probe(): String? {
        val probeFile = File(file.parentFile, "${'$'}{file.name}.probe")
        return runCatching {
            val text = "bombax-session-probe"
            probeFile.writeBytes(SessionEnvelope.pack(text, cipher))
            val back = SessionEnvelope.unpack(probeFile.readBytes(), cipher)
            if (back != text) "round-trip mismatch" else null
        }.exceptionOrNull()?.let { "${it.javaClass.simpleName}: ${it.message}" }
            .also { runCatching { probeFile.delete() } }
    }

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
