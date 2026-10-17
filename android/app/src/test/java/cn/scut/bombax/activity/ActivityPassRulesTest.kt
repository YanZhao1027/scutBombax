package cn.scut.bombax.activity

import org.junit.Assert.*
import org.junit.Test

class ActivityPassRulesTest {
    private val eid = "1b71a955-dad9-4112-8d01-f575a3c0149e"
    private val pass = "bqx_" + "a1".repeat(32)

    @Test fun scopedHttpOnlyCookieMayBeExtractedByNativeOnly() {
        assertEquals("bqx_g_1b71a955dad941128d01f575a3c0149e", ActivityPassRules.cookieName(eid))
        assertEquals(pass, ActivityPassRules.extractReceipt(
            eid, "session=unrelated; bqx_g_1b71a955dad941128d01f575a3c0149e=$pass; other=ok"
        ))
    }

    @Test fun malformedOtherActivityOrAmbiguousReceiptsAreRejected() {
        val other = "1b71a955-dad9-4112-8d01-f575a3c0149f"
        val cookie = ActivityPassRules.cookieName(eid) + "=" + pass
        assertNull(ActivityPassRules.extractReceipt(other, cookie))
        assertNull(ActivityPassRules.extractReceipt("https://evil.invalid", cookie))
        assertNull(ActivityPassRules.extractReceipt(eid, "xx" + cookie))
        assertNull(ActivityPassRules.extractReceipt(eid, cookie + "; " + cookie))
        assertNull(ActivityPassRules.extractReceipt(eid, cookie.replace("bqx_", "bqz_")))
        assertNull(ActivityPassRules.extractReceipt(eid, null))
        assertFalse(ActivityPassRules.validEventId(eid.uppercase()))
    }

    @Test fun fixedValidationOnlyAcceptsKnownBackendStates() {
        for (s in listOf("pending", "approved", "rejected")) {
            assertTrue(ActivityPassRules.validState(s))
        }
        for (s in listOf("owner", "student", "paid", "accepted", "")) {
            assertFalse(ActivityPassRules.validState(s))
        }
    }
}
