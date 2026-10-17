package cn.scut.bombax.activity

/**
 * Pure string validation; no Activity, network or Android dependencies.
 * App account tokens / campus SCUT cookie names are never accepted here.
 */
internal object ActivityPassRules {
    private val eventPattern = Regex(
        "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    private val receiptPattern = Regex("^bqx_[0-9a-f]{64}$")

    fun validEventId(value: String): Boolean = eventPattern.matches(value)

    fun cookieName(eventId: String): String? =
        if (validEventId(eventId)) "bqx_g_" + eventId.replace("-", "") else null

    fun extractReceipt(eventId: String, cookieHeader: String?): String? {
        val name = cookieName(eventId) ?: return null
        if (cookieHeader == null || cookieHeader.length > 16_384) return null
        // Cookie names must be exact, not substring matches in unrelated cookies.
        val values = cookieHeader.split(';').mapNotNull { pair ->
            val index = pair.indexOf('=')
            if (index < 0 || pair.substring(0, index).trim() != name) null
            else pair.substring(index + 1).trim()
        }
        return values.singleOrNull()?.takeIf(receiptPattern::matches)
    }

    fun validState(value: String): Boolean =
        value in setOf("pending", "approved", "rejected")
}
