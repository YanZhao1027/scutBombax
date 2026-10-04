package cn.scut.bombax.scut

import cn.scut.bombax.scut.network.CookieExtractor
import cn.scut.bombax.scut.network.ScutCookieJar
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CookieExtractionTest {

    private val card = "https://ecardwxnew.scut.edu.cn/berserker-auth/oauth/token".toHttpUrl()

    /** `Cookie.parse` yields one cookie; the jar API takes the whole header list. */
    private fun cookie(url: okhttp3.HttpUrl, header: String): List<okhttp3.Cookie> =
        listOf(okhttp3.Cookie.parse(url, header)!!)

    @Test
    fun `extracts named values from multiple set-cookie headers`() {
        val headers = listOf(
            "TGC=abc123; Path=/; HttpOnly; Secure",
            "locSession=xyz789; Path=/; Max-Age=1800",
            "error_times=0; Path=/"
        )
        val parsed = CookieExtractor.parse(headers)
        assertEquals("abc123", parsed["TGC"])
        assertEquals("xyz789", parsed["locSession"])
        assertEquals("0", parsed["error_times"])
        assertEquals("abc123", CookieExtractor.value(headers, "TGC"))
    }

    @Test
    fun `ignores attributes and malformed headers`() {
        val parsed = CookieExtractor.parse(listOf("Path=/; HttpOnly", "=empty", "good=1"))
        assertEquals(mapOf("good" to "1"), parsed)
    }

    @Test
    fun `jar keeps scut cookies and forgets them on clear`() {
        val jar = ScutCookieJar()
        jar.saveFromResponse(card, cookie(card, "TGC=t-1; Path=/; HttpOnly; Secure"))
        jar.saveFromResponse(card, cookie(card, "locSession=l-1; Path=/"))
        assertEquals("t-1", jar.value("TGC"))
        assertEquals("l-1", jar.value("locSession"))
        assertEquals(listOf("TGC", "locSession"), jar.snapshotNames())

        val sent = jar.loadForRequest(card)
        assertTrue(sent.any { it.name == "TGC" })

        jar.clear()
        assertNull(jar.value("TGC"))
        assertFalse(jar.has("locSession"))
        assertTrue(jar.loadForRequest(card).isEmpty())
    }

    @Test
    fun `later value for the same name wins`() {
        val jar = ScutCookieJar()
        jar.saveFromResponse(card, cookie(card, "JSESSIONID=old; Path=/"))
        jar.saveFromResponse(card, cookie(card, "JSESSIONID=new; Path=/"))
        assertEquals("new", jar.value("JSESSIONID"))
    }

    @Test
    fun `a non school host receives nothing and stores nothing`() {
        val jar = ScutCookieJar()
        val foreign = "https://example.com/".toHttpUrl()
        jar.saveFromResponse(foreign, cookie(foreign, "TGC=leak; Path=/"))
        assertNull(jar.value("TGC"))
        assertTrue(jar.loadForRequest(foreign).isEmpty())
    }

    @Test
    fun `subdomains are trusted`() {
        assertTrue(ScutEndpoints.isScutHost("ecardwxnew.scut.edu.cn"))
        assertTrue(ScutEndpoints.isScutHost("dfyc.utc.scut.edu.cn"))
        assertTrue(ScutEndpoints.isScutHost("scut.edu.cn"))
        assertFalse(ScutEndpoints.isScutHost("evil-scut.edu.cn"))
        assertFalse(ScutEndpoints.isScutHost("scut.edu.cn.attacker.net"))
    }

    @Test
    fun `expired cookies are dropped on read`() {
        val jar = ScutCookieJar()
        val dead = okhttp3.Cookie.Builder()
            .name("JSESSIONID")
            .value("gone")
            .path("/")
            .domain("ecardwxnew.scut.edu.cn")
            .expiresAt(System.currentTimeMillis() - 10_000L)
            .build()
        jar.saveFromResponse(card, listOf(dead))
        assertNull(jar.value("JSESSIONID"))
    }

    @Test
    fun `first value helper returns the oldest match`() {
        val headers = listOf("A=1; Path=/", "A=2; Path=/")
        assertEquals("1", CookieExtractor.firstValue(headers, "A"))
        assertEquals("2", CookieExtractor.parse(headers)["A"])
    }
}

class DiagnosticsScrubTest {

    @Test
    fun `scrub removes credential shaped text`() {
        val input = "Authorization: Basic ABCDEF token=supersecretvalue cookie: TGC=abc123"
        val out = Diag.scrub(input)
        assertFalse(out.contains("supersecretvalue"))
        assertFalse(out.contains("abc123"))
        assertTrue(out.contains("<redacted>"))
    }

    @Test
    fun `scrub hides long opaque values`() {
        val opaque = "a".repeat(60)
        assertTrue(Diag.scrub("value=$opaque").contains("<opaque>"))
    }

    @Test
    fun `scrub leaves short stage text alone`() {
        assertEquals("stage=dxc.thirdLogin status=302", Diag.scrub("stage=dxc.thirdLogin status=302"))
    }
}
