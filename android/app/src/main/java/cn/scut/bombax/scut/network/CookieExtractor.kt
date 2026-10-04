package cn.scut.bombax.scut.network

/**
 * Pure `Set-Cookie` extraction.
 *
 * The DXC chain needs the JSESSIONID issued by one specific hop, so it is read
 * straight from that response rather than depending on jar ordering. Values are
 * kept in memory only and are never logged or passed to the WebView.
 */
object CookieExtractor {

    /**
     * `Set-Cookie` attributes. A malformed or split header can put one of these
     * in the leading position; treating it as a cookie name would invent
     * diagnostics such as a cookie called "Path", so they are skipped.
     */
    private val ATTRIBUTES = setOf(
        "path", "domain", "expires", "max-age", "secure", "httponly",
        "samesite", "version", "comment", "commenturl"
    )

    private fun nameValue(header: String): Pair<String, String>? {
        val pair = header.substringBefore(';').trim()
        val separator = pair.indexOf('=')
        if (separator <= 0) return null
        val name = pair.substring(0, separator).trim()
        if (name.isEmpty() || name.lowercase() in ATTRIBUTES) return null
        return name to pair.substring(separator + 1).trim()
    }

    fun parse(setCookieHeaders: List<String>): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for (header in setCookieHeaders) {
            val pair = nameValue(header) ?: continue
            out[pair.first] = pair.second
        }
        return out
    }

    fun value(setCookieHeaders: List<String>, name: String): String? =
        parse(setCookieHeaders)[name]

    /**
     * Same extraction against a jar-like snapshot, used by tests and by the
     * session store when only one value is wanted.
     */
    fun firstValue(setCookieHeaders: List<String>, name: String): String? {
        for (header in setCookieHeaders) {
            val pair = nameValue(header) ?: continue
            if (pair.first == name) return pair.second
        }
        return null
    }
}
