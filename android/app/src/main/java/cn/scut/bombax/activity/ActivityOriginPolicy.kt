package cn.scut.bombax.activity

import java.net.URI
import java.util.Locale

/**
 * The launch destination is public HTTPS. Only a validated campus health
 * probe in the public website can navigate to campus HTTPS on :8443.
 * Do not broaden this list to wildcards, staging, arbitrary ports or HTTP.
 */
internal object ActivityOriginPolicy {
    const val PUBLIC_URL = "https://activity.10273055.xyz/"

    fun isTrusted(url: String?): Boolean {
        if (url == null) return false
        val uri = try { URI(url) } catch (_: Exception) { return false }
        if (!uri.scheme.equals("https", ignoreCase = true) || uri.rawUserInfo != null) return false
        val host = uri.host?.lowercase(Locale.ROOT) ?: return false
        return when (host) {
            "activity.10273055.xyz" -> uri.port == -1 || uri.port == 443
            "activity-lan.10273055.xyz" -> uri.port == 8443
            else -> false
        }
    }
}
