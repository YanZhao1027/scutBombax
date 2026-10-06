package cn.scut.bombax.scut.billing

import cn.scut.bombax.scut.AppError
import cn.scut.bombax.scut.ScutEndpoints
import cn.scut.bombax.scut.ScutException
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject

/**
 * DFYC (大学城水电费) response parsing, kept pure so the shapes in
 * `src/utils/billing.ts` can be unit-tested without a network.
 */
object DxcParser {

    const val OK_STATUS = "200"

    fun statusCode(json: JSONObject): String? =
        json.opt("statusCode")?.toString()?.takeIf { it.isNotBlank() }

    fun isOk(json: JSONObject): Boolean = statusCode(json) == OK_STATUS

    fun roomName(json: JSONObject): String? =
        json.optJSONObject("resultObject")
            ?.optString("roomName")
            ?.trim()
            ?.takeIf { it.isNotEmpty() }

    /** `resultObject.leftMoney` arrives as a string or a number depending on item. */
    fun money(json: JSONObject): Double? {
        val result = json.optJSONObject("resultObject") ?: return null
        val raw = result.opt("leftMoney")?.toString()?.trim() ?: return null
        return raw.toDoubleOrNull()
    }

    fun message(json: JSONObject): String? =
        json.optString("message").takeIf { it.isNotBlank() }

    /**
     * Resolves one hop of the SSO chain.
     *
     * Relative Locations are allowed, plain http is upgraded to https, and a
     * destination outside *.scut.edu.cn is refused rather than followed. Only the
     * host/path of the destination is ever logged.
     */
    fun resolveRedirect(location: String?, base: HttpUrl, stage: String): HttpUrl {
        val raw = location?.trim()
        if (raw.isNullOrEmpty()) {
            throw ScutException(AppError.PROTOCOL_CHANGED, "$stage 没有跳转地址", "$stage/location")
        }
        val resolved = base.resolve(raw)
            ?: throw ScutException(AppError.PROTOCOL_CHANGED, "$stage 跳转地址无法解析", "$stage/location")
        // OkHttp keeps Builder#scheme internal, so the upgrade is done on the
        // serialised form: only the scheme changes, host, port, path, query and
        // fragment are carried over untouched.
        val url = if (resolved.scheme == "http") {
            resolved.toString().replaceFirst("^http://".toRegex(), "https://").toHttpUrl()
        } else {
            resolved
        }
        if (!ScutEndpoints.isScutHost(url.host)) {
            throw ScutException(
                AppError.PROTOCOL_CHANGED,
                "$stage 跳转到非学校域名",
                "$stage/host"
            )
        }
        return url
    }

    /**
     * Whether a hop already lands on the DFYC index page.
     *
     * `thirdLogin` answers this instead of bouncing back through `/oauth/authorize` when the
     * school still holds a live DFYC session for the user — the handshake is finished, so it
     * sends you where you were going. In a browser that is invisible; for the chain it means
     * "already established", not "unexpected status".
     */
    fun landsOnIndex(url: HttpUrl): Boolean = url.encodedPath == ScutEndpoints.DFYC_INDEX

    /** The final hop of the chain is expected to land on the DFYC index page. */
    fun isIndexPage(location: String?, stage: String): Boolean {
        val path = location?.trim()
        if (path == ScutEndpoints.DFYC_INDEX) return true
        // A host-qualified but otherwise identical Location is still the index page.
        val parsed = path?.let { ScutEndpoints.dfycUrl("/").resolve(it) }
        if (parsed?.encodedPath == ScutEndpoints.DFYC_INDEX) return true
        throw ScutException(
            AppError.PROTOCOL_CHANGED,
            "$stage 跳转终点不是缴费首页",
            "$stage/path=${parsed?.encodedPath ?: "unparsed"}"
        )
    }

    fun requireOk(json: JSONObject, stage: String): JSONObject {
        if (!isOk(json)) {
            throw ScutException(
                AppError.PROTOCOL_CHANGED,
                "DFYC $stage 返回异常",
                "dxc/$stage/status=${statusCode(json) ?: "-"}"
            )
        }
        return json
    }
}
