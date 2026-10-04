package cn.scut.bombax.scut.network

/**
 * Detects the school's edge answer for "this network location may not use this
 * service".
 *
 * Verified on a physical device on 2026-10-05 from an off-campus uplink: every
 * path on `ecardwxnew.scut.edu.cn` (including `/berserker-auth/oauth/captcha`)
 * answered `HTTP/1.1 403` with `Server: rump/e` and an HTML page whose text is
 * `403 抱歉，页面无法访问 校外可通过学校SSLVPN访问本网站。 访问IP：…`, over both IPv4
 * and IPv6, while `dfyc.utc.scut.edu.cn` answered `200` on the same connection.
 * So the restriction is a per-vhost source-address policy of the school, not a
 * client, TLS or app problem, and the school's own remedy is its SSL VPN.
 *
 * The page echoes the caller's public IP, which is device-identifying, so only
 * the boolean result of this check may escape [ScutHttp]; the body itself is
 * never logged, never kept on the response and never crosses the bridge.
 */
object NetworkAccess {
    /** Status the school's edge uses for its block page. */
    const val BLOCK_STATUS = 403

    /**
     * Phrases from the block page, both copied from the captured response.
     * Matching is on the exact text so a JSON API answer that happens to carry
     * status 403 keeps going through the normal classifiers instead.
     */
    val BLOCK_HINTS = listOf(
        "校外可通过学校SSLVPN访问本网站",
        "抱歉，页面无法访问"
    )

    fun isBlocked(status: Int, bodyText: String?): Boolean {
        if (status != BLOCK_STATUS) return false
        val text = bodyText ?: return false
        return BLOCK_HINTS.any { text.contains(it) }
    }
}
