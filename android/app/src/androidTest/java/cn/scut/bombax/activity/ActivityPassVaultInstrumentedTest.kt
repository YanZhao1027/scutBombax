package cn.scut.bombax.activity

import android.content.ContextWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.charset.StandardCharsets

/**
 * Device-only AES-GCM round trips in an ISOLATED TEST directory.
 * Never clears or edits the actual user's app data, receipts or Cookies.
 */
@RunWith(AndroidJUnit4::class)
class ActivityPassVaultInstrumentedTest {
    private lateinit var isolated: File
    private lateinit var vault: ActivityPassVault
    private val eventId = "1b71a955-dad9-4112-8d01-f575a3c0149e"
    private val secondId = "1b71a955-dad9-4112-8d01-f575a3c0149f"
    private val token = "bqx_" + "ab".repeat(32)

    @Before fun createIsolatedVault() {
        val base = InstrumentationRegistry.getInstrumentation().targetContext
        isolated = File(base.cacheDir, "onecode-instrumentation-" + System.nanoTime())
        assertTrue(isolated.mkdirs())
        val context = object : ContextWrapper(base) {
            override fun getFilesDir(): File = isolated
        }
        vault = ActivityPassVault(context)
    }

    @After fun removeOnlyTestFiles() {
        if (::isolated.isInitialized) isolated.deleteRecursively()
    }

    @Test fun encryptedPassPersistsAcrossVaultInstancesWithoutExposingSummary() {
        assertEquals(0, vault.listSummaries().length())
        vault.save(eventId, "测试招新", "approved", true, System.currentTimeMillis() + 86_400_000, token)
        val summaries = vault.listSummaries()
        assertEquals(1, summaries.length())
        assertEquals("测试招新", summaries.getJSONObject(0).getString("title"))
        assertEquals("approved", summaries.getJSONObject(0).getString("state"))
        assertTrue(summaries.getJSONObject(0).getBoolean("attended"))
        assertFalse(summaries.toString().contains(token))
        assertNull(summaries.getJSONObject(0).optString("token").takeIf { it.isNotEmpty() })

        val file = File(isolated, "activity-onecode-v1.bin")
        assertTrue(file.exists())
        val envelope = String(file.readBytes(), StandardCharsets.UTF_8)
        assertTrue(envelope.contains("ciphertext"))
        assertFalse("bearer pass must never be present in plaintext", envelope.contains(token))
        assertFalse(envelope.contains("测试招新"))
        val context = object : ContextWrapper(
            InstrumentationRegistry.getInstrumentation().targetContext
        ) {
            override fun getFilesDir(): File = isolated
        }
        val restarted = ActivityPassVault(context)
        assertEquals(token, restarted.readReceipt(eventId))
        restarted.forget(eventId)
        assertNull(restarted.readReceipt(eventId))
        assertEquals(0, restarted.listSummaries().length())
    }

    @Test fun separateEventsCanBeRemovedWithoutDeletingOtherReceipts() {
        val expiry = System.currentTimeMillis() + 86_400_000
        vault.save(eventId, "虚构 A", "pending", false, expiry, token)
        val other = "bqx_" + "cd".repeat(32)
        vault.save(secondId, "虚构 B", "rejected", false, expiry, other)
        assertEquals(2, vault.listSummaries().length())
        vault.forget(eventId)
        assertNull(vault.readReceipt(eventId))
        assertEquals(other, vault.readReceipt(secondId))
        assertEquals(1, vault.listSummaries().length())
    }

    @Test fun tamperingWithCiphertextFailsClosed() {
        vault.save(eventId, "防篡改", "pending", false,
            System.currentTimeMillis() + 86_400_000, token)
        val file = File(isolated, "activity-onecode-v1.bin")
        val original = String(file.readBytes(), StandardCharsets.UTF_8)
        val mutated = original.replaceFirst("ciphertext", "alteredtext")
        file.writeText(mutated, StandardCharsets.UTF_8)
        try {
            vault.listSummaries()
            fail("modified envelope must be rejected")
        } catch (_: Exception) {
            // A malformed or modified encrypted envelope cannot be accepted.
        }
    }
}
