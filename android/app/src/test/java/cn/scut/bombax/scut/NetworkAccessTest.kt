package cn.scut.bombax.scut

import cn.scut.bombax.scut.network.NetworkAccess
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Covers the school's off-campus block page.
 *
 * The fragment below is taken from the response a physical device received on
 * 2026-10-05 from `GET /berserker-auth/oauth/captcha?synAccessSource=h5` while
 * its uplink was outside the campus address space, with the echoed address
 * replaced by a documentation-prefix one — a real device's public address does
 * not belong in a test fixture. If the school rewords that page, the classifier
 * falls back to the previous `UPSTREAM_UNAVAILABLE` behaviour, so this test is
 * the tripwire rather than a correctness guarantee.
 */
class NetworkAccessTest {

    private val offCampusPage = """
        <!DOCTYPE html>
        <html>
          <head><meta charset="UTF-8"><title></title></head>
          <body>
            <div class="code font">403</div>
            <div class="reason font">抱歉，页面无法访问</div>
            <div class="font field">校外可通过学校SSLVPN访问本网站。</div>
            <div class="font field"><span>访问IP：</span><span>2001:db8::1</span></div>
          </body>
        </html>
    """.trimIndent()

    @Test
    fun `the captured off-campus page is recognised`() {
        assertTrue(NetworkAccess.isBlocked(403, offCampusPage))
        assertTrue(NetworkAccess.isBlocked(403, "校外可通过学校SSLVPN访问本网站。"))
    }

    @Test
    fun `a json answer with status 403 is left to the normal classifiers`() {
        assertFalse(
            NetworkAccess.isBlocked(403, """{"status":403,"message":"forbidden","code":"403"}""")
        )
    }

    @Test
    fun `only the forbidden status can be a network block`() {
        for (status in listOf(200, 302, 400, 401, 404, 500, 503)) {
            assertFalse("status $status", NetworkAccess.isBlocked(status, offCampusPage))
        }
    }

    @Test
    fun `an absent body is not a network block`() {
        assertFalse(NetworkAccess.isBlocked(403, null))
        assertFalse(NetworkAccess.isBlocked(403, ""))
    }

    @Test
    fun `the block page tells the user where to get access and echoes nothing`() {
        val human = AppError.CAMPUS_NETWORK_REQUIRED.human()
        assertTrue(human, human.contains("校园网"))
        assertTrue(human, human.contains("SSLVPN"))
        // The upstream page carries the caller's public address; nothing like it
        // may end up in the text shown to the user.
        assertFalse(human, human.contains("访问IP"))
        assertEquals("CAMPUS_NETWORK_REQUIRED", AppError.CAMPUS_NETWORK_REQUIRED.wire)
    }
}
