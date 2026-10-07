package cn.scut.bombax.scut

import cn.scut.bombax.scut.auth.Campus
import cn.scut.bombax.scut.auth.LoginType
import cn.scut.bombax.scut.auth.TokenState
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.security.SecureRandom
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The persistence layer has to be proven on the host, because the Android Keystore is not
 * available in a JVM unit test. Everything except the key's location is shared: the same
 * [SessionEnvelope], the same [FileSessionStore], and a real AES/GCM cipher from the JDK.
 */
class SessionPersistenceTest {

    /** Same transformation as production; only the key's home differs. */
    private class JceCipher(private val key: SecretKey) : SessionCipher {
        private val random = SecureRandom()

        override fun encrypt(plain: ByteArray): ByteArray {
            val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
            val iv = ByteArray(12).also(random::nextBytes)
            cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
            return CipherBlob.pack(iv, cipher.doFinal(plain))
        }

        override fun decrypt(blob: ByteArray): ByteArray {
            val (iv, body) = CipherBlob.unpack(blob) ?: error("malformed test blob")
            val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(javax.crypto.Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
            return cipher.doFinal(body)
        }
    }

    @get:Rule
    val folders = TemporaryFolder()

    @Before
    fun silenceDiagnostics() {
        Diag.writer = { _, _ -> }
    }

    @After
    fun restoreDiagnostics() {
        Diag.writer = Diag::logcat
    }

    private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    private fun store(name: String = "scut-session.bin"): FileSessionStore =
        FileSessionStore(File(folders.root, name), JceCipher(key))

    private fun state(
        expiresAtMillis: Long = System.currentTimeMillis() + 6_048_000_000L,
        refreshToken: String = "R-1"
    ) = TokenState(
        accessToken = "A-long-access-token",
        refreshToken = refreshToken,
        expiresAtMillis = expiresAtMillis,
        tokenType = "bearer",
        tgc = "TGC-value",
        locSession = "locSession-value",
        name = "张三",
        sno = "202100000000",
        campus = Campus.DXC,
        loginType = LoginType.SNO,
        dxcJsession = "JSESSIONID-value"
    )

    @Test
    fun `a saved session survives a new store over the same file`() {
        val file = File(folders.root, "session.bin")
        val disk = FileSessionStore(file, JceCipher(key))
        val first = SessionStore()
        first.attachDisk(disk)
        val saved = state()
        first.save(saved)

        // A fresh process would build a fresh store; the file is all it shares with the old one.
        val second = SessionStore()
        second.attachDisk(FileSessionStore(file, JceCipher(key)))
        assertEquals(saved, second.peek())
    }

    @Test
    fun `the cipher blob layout survives its own edge cases`() {
        // The first implementation allocated one byte too few here; only a device run noticed,
        // because the packing lived inside the Keystore-only class.
        val iv = ByteArray(12) { (it + 1).toByte() }
        val body = ByteArray(36) { (it + 100).toByte() }
        val blob = CipherBlob.pack(iv, body)
        assertEquals(1 + iv.size + body.size, blob.size)
        assertEquals(12, blob[0].toInt())
        val (backIv, backBody) = CipherBlob.unpack(blob)!!
        assertTrue(iv.contentEquals(backIv))
        assertTrue(body.contentEquals(backBody))
        assertNull(CipherBlob.unpack(ByteArray(0)))
        assertNull(CipherBlob.unpack(byteArrayOf(0, 1, 2)))
        assertNull(CipherBlob.unpack(ByteArray(13)))
    }

    @Test
    fun `the file on disk is not readable as text`() {
        val file = File(folders.root, "session.bin")
        FileSessionStore(file, JceCipher(key)).save(SessionCodec.toJson(state()))
        val raw = file.readText(Charsets.ISO_8859_1)
        assertFalse(raw.contains("A-long-access-token"))
        assertFalse(raw.contains("TGC-value"))
        assertFalse(raw.contains("JSESSIONID"))
        assertFalse(raw.contains("张三"))
    }

    @Test
    fun `the record holds exactly the session fields and never a password`() {
        val json = JSONObject(SessionCodec.toJson(state()))
        assertEquals(
            setOf(
                "accessToken", "refreshToken", "expiresAtMillis", "tokenType", "tgc",
                "locSession", "name", "sno", "campus", "loginType", "dxcJsession"
            ),
            json.keys().asSequence().toSet()
        )
        val text = json.toString().lowercase()
        listOf("password", "captcha", "keyboard", "uuid", "$1$").forEach { forbidden ->
            assertFalse("record must not carry $forbidden", text.contains(forbidden))
        }
    }

    @Test
    fun `a round trip keeps campus login type and the dxc session`() {
        val restored = SessionCodec.fromJson(SessionCodec.toJson(state()))
        assertEquals(Campus.DXC, restored?.campus)
        assertEquals(LoginType.SNO, restored?.loginType)
        assertEquals("JSESSIONID-value", restored?.dxcJsession)
        assertEquals("R-1", restored?.refreshToken)
    }

    @Test
    fun `an expired record is dropped on arrival, not restored`() {
        val file = File(folders.root, "session.bin")
        val disk = FileSessionStore(file, JceCipher(key))
        disk.save(SessionCodec.toJson(state(expiresAtMillis = System.currentTimeMillis() - 1_000)))

        val store = SessionStore()
        store.attachDisk(disk)
        assertNull(store.peek())
        assertFalse("the expired file must be gone", file.isFile)
    }

    @Test
    fun `an undecryptable file is discarded rather than retried`() {
        val file = File(folders.root, "session.bin")
        file.writeBytes(ByteArray(64) { (it % 251).toByte() })
        val disk = FileSessionStore(file, JceCipher(key))
        assertNull(disk.load())
        assertFalse(file.isFile)
    }

    @Test
    fun `a record from an unknown format version is refused`() {
        val blob = SessionEnvelope.pack("""{"accessToken":"A"}""", JceCipher(key))
        blob[0] = 99
        assertNull(SessionEnvelope.unpack(blob, JceCipher(key)))
        assertNull(SessionEnvelope.unpack(ByteArray(0), JceCipher(key)))
    }

    @Test
    fun `a truncated or partial record never becomes a half session`() {
        assertNull(SessionCodec.fromJson("""{"accessToken":"A"}"""))
        assertNull(SessionCodec.fromJson("""{"accessToken":"A","expiresAtMillis":1,"campus":"MARS"}"""))
        assertNull(
            SessionCodec.fromJson(
                // A record written before the login type existed must not be guessed back into
                // a session: `card` and `sno` are different accounts.
                """{"accessToken":"A","expiresAtMillis":1,"campus":"DXC"}"""
            )
        )
        assertNotNull(
            SessionCodec.fromJson(
                """{"accessToken":"A","expiresAtMillis":1,"campus":"DXC","loginType":"sno"}"""
            )
        )
    }

    @Test
    fun `clearing removes the memory copy and the disk copy together`() {
        val file = File(folders.root, "session.bin")
        val store = SessionStore()
        store.attachDisk(FileSessionStore(file, JceCipher(key)))
        store.save(state())
        assertTrue(file.isFile)

        store.clear()
        assertFalse(file.isFile)
        assertNull(store.peek())
    }

    @Test
    fun `destroying the activity keeps the stored session while clearing it does not`() {
        val file = File(folders.root, "session.bin")
        val store = SessionStore()
        store.attachDisk(FileSessionStore(file, JceCipher(key)))
        store.save(state())

        store.dropMemory()
        assertTrue("destroy must not delete the record", file.isFile)
        assertNotNull("…but the next read restores it from disk", store.peek()?.accessToken)

        store.clear()
        assertFalse(file.isFile)
        assertNull(store.peek())
    }

    @Test
    fun `without a disk the store stays memory-only`() {
        val store = SessionStore()
        store.save(state())
        assertNotNull(store.peek())
        store.clear()
        assertNull(store.peek())
    }
}
