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
/**
 * How to read a DFYC answer that is not a JSON body.
 *
 * The缴费 endpoints are same-origin JSON calls behind a session cookie. When that cookie's
 * session has lapsed the endpoint does not answer 401 — it answers a **302 to its own login
 * page**, which is what a browser expects and an API client does not. Treating that as
 * "upstream unavailable" tells the user the school is down when in fact one session simply
 * expired, so the redirect and the two unauthorised statuses are recognised here as "this
 * session is stale" and the caller rebuilds it.
 */
object DxcSession {
    fun isStale(status: Int): Boolean = status in 300..399 || status == 401 || status == 403
}

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

    /**
     * The **field names** of `resultObject`, sorted.
     *
     * This exists to settle a semantic question the school's answer never states: `leftMoney`
     * is read for both the electricity and the water item, and the response carries no unit
     * text, so whether the number is 元 or 度/kWh is currently inferred from the field name
     * alone — and the user reports that the official page shows a 度 figure and a 元 figure
     * side by side (2026-10-08). Names are protocol structure, not user data: **no value is
     * ever returned by this function**, and it is logged once per successful query so the next
     * live run can tell us whether a second, unit-bearing field exists that we are ignoring.
     */
    fun resultKeys(json: JSONObject): String {
        val result = json.optJSONObject("resultObject") ?: return "none"
        val names = result.keys().asSequence().toSortedSet()
        return if (names.isEmpty()) "none" else names.joinToString(",")
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
