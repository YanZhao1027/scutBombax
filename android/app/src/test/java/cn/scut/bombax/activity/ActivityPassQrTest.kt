package cn.scut.bombax.activity

import org.junit.Assert.*
import org.junit.Test

class ActivityPassQrTest {
    private val valid = "bqx_" + "ab".repeat(32)

    @Test fun offlineUrlIsExactlyTheOriginalOneCodePassWithPrivateFragment() {
        assertEquals("https://activity-stage.10273055.xyz/#pass=$valid", ActivityPassQr.uri(valid))
    }

    @Test fun forgedAndUntrustedFormatsCannotBeRendered() {
        for (bad in listOf("", "bqx_"+ "0".repeat(63), "BQX_" + "a".repeat(64),
            "https://activity-stage.10273055.xyz/#pass=$valid", "test-student")) {
            try {
                ActivityPassQr.uri(bad)
                fail("invalid QR pass accepted")
            } catch (_: IllegalArgumentException) { /* intended fail closed */ }
        }
    }
}
