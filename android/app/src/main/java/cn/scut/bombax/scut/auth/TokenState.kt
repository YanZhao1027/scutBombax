package cn.scut.bombax.scut.auth

import cn.scut.bombax.scut.AppError
import cn.scut.bombax.scut.ScutException
import org.json.JSONObject

enum class Campus {
    GZIC, DXC;

    companion object {
        fun from(text: String?): Campus =
            if (text?.trim()?.uppercase() == "DXC") DXC else GZIC
    }
}

/**
 * Which of the school's card login types an account belongs to, using the keys SCUT's own
 * `frontInfo` publishes: `card` = 账号登录 (a campus-card account), `sno` = 学工号登录 (a
 * student or staff number). Both carry `encryption:"keyboard"` and `openCaptcha:"1"`.
 *
 * The wrong one is answered `code=8000`, exactly like a wrong password, so this is never
 * inferred: an unknown value is rejected at the bridge instead of falling back to a default.
 */
enum class LoginType(val wire: String) {
    CARD("card"),
    SNO("sno");

    companion object {
        fun from(text: String?): LoginType? =
            values().firstOrNull { it.wire == text?.trim()?.lowercase() }
    }
}

/**
 * Everything the native layer keeps private. The WebView only ever sees the
 * public projection built by the plugin.
 */
data class TokenState(
    val accessToken: String,
    val refreshToken: String,
    val expiresAtMillis: Long,
    val tokenType: String,
    val tgc: String,
    val locSession: String,
    val name: String,
    val sno: String,
    val campus: Campus,
    /** A refresh must replay the type that obtained the token, not a default. */
    val loginType: LoginType = LoginType.CARD,
    /**
     * The DFYC (`dxc`) session cookie once the SSO chain has been walked, so a second query
     * can go straight to the balance endpoints. It is not optional for correctness: re-running
     * the chain with a live DFYC session makes `thirdLogin` short-circuit to the landing page
     * instead of back through `/oauth/authorize`, which is not the shape the chain expects.
     * In memory only, never sent to JavaScript, and never written to disk.
     */
    val dxcJsession: String = ""
)

/** Pure expiry decisions, unit-tested on the JVM. */
object TokenPolicy {
    /** Refresh a little before the real expiry so a query cannot race it. */
    const val REFRESH_SKEW_MS = 5 * 60 * 1000L

    fun needsRefresh(expiresAtMillis: Long, now: Long): Boolean =
        expiresAtMillis - now <= REFRESH_SKEW_MS

    fun isExpired(expiresAtMillis: Long, now: Long): Boolean = expiresAtMillis <= now

    /** Whole seconds left, clamped at zero. */
    fun secondsLeft(expiresAtMillis: Long, now: Long): Long =
        maxOf(0L, (expiresAtMillis - now) / 1000L)
}

/**
 * Turns an `expires_in` number into an absolute deadline.
 *
 * Some deployments answer in seconds (OAuth standard), others hand back a
 * millisecond timestamp. A value larger than 10 years in seconds is treated as
 * a millisecond clock so a misread cannot produce an instantly-expired session.
 */
object ExpiryParser {
    const val TEN_YEARS_IN_SECONDS = 10L * 365L * 24L * 60L * 60L

    fun toDeadlineMillis(rawExpiresIn: Long, now: Long): Long =
        if (rawExpiresIn > TEN_YEARS_IN_SECONDS) rawExpiresIn else now + rawExpiresIn * 1000L
}

/**
 * Login failures classified from a redacted view of the upstream answer.
 *
 * The `8002` / `8003` codes and the `captcha` keyword patterns are inherited
 * from the old Cloudflare implementation. They are treated here as hypotheses:
 * the exact service code observed on a device is always recorded in the
 * exception detail so a real trace can confirm or replace them.
 */
object LoginErrorClassifier {

    /**
     * Captcha codes 8002 / 8003 are how the school's own client decides that a
     * captcha is required or wrong: its token-request handler re-opens the captcha
     * dialog on exactly those two codes. SCUT's `frontInfo` config also sets
     * `openCaptcha:"1"` for the card login, so a captcha is expected up front.
     *
     * That makes them SOURCE_VERIFIED against the official client, not yet
     * RUNTIME_VERIFIED for this app — the school validates the credential pair
     * before the captcha, so they can only be observed with a correct password.
     * The observed code is always recorded in the exception detail.
     */
    val captchaServiceCodes = setOf("8002", "8003")

    /**
     * `code=8000` with `message=用户名或密码错误` was observed on 2026-10-05 from a
     * token request that carried no credentials at all, so this one is not a
     * guess. It still is not proof that every 8000 response is a credential error.
     */
    val credentialServiceCodes = setOf("8000")

    private val captchaText = Regex("captcha|验证码|校验码")
    private val clearlyInvalid = Regex("invalid|incorrect|wrong|错误|不正确")

    fun serviceCode(json: JSONObject?): String? =
        json?.opt("code")?.toString()?.takeIf { it.isNotBlank() && it != "null" }

    fun haystack(json: JSONObject?): String {
        if (json == null) return ""
        return listOf("error", "error_description", "message", "msg", "code")
            .mapNotNull { key -> json.opt(key)?.toString() }
            .joinToString(" ")
            .lowercase()
    }

    fun classify(json: JSONObject?, status: Int, hadCaptcha: Boolean): AppError {
        // A server-side failure is never read as a credential failure. The old
        // implementation lumped everything unmatched into INVALID_CREDENTIALS,
        // which made a school outage look like a wrong password.
        if (status >= 500) return AppError.UPSTREAM_UNAVAILABLE

        val text = haystack(json)
        val code = serviceCode(json)
        if (code != null && captchaServiceCodes.contains(code)) {
            return if (hadCaptcha && clearlyInvalid.containsMatchIn(text)) {
                AppError.CAPTCHA_INVALID
            } else {
                AppError.CAPTCHA_REQUIRED
            }
        }
        if (captchaText.containsMatchIn(text)) {
            return if (hadCaptcha && clearlyInvalid.containsMatchIn(text)) {
                AppError.CAPTCHA_INVALID
            } else {
                AppError.CAPTCHA_REQUIRED
            }
        }
        if (code != null && credentialServiceCodes.contains(code)) {
            return AppError.INVALID_CREDENTIALS
        }
        // A body that matches no shape this app knows. Calling that a wrong
        // password would hide a protocol change behind a misleading message.
        if (text.isBlank() && code == null) {
            return AppError.PROTOCOL_CHANGED
        }
        return AppError.INVALID_CREDENTIALS
    }
}

/** Pure token-response parsing so the OAuth shape can be unit-tested. */
object TokenParser {

    fun parse(
        json: JSONObject,
        status: Int,
        campus: Campus,
        tgc: String,
        locSession: String,
        previousRefreshToken: String,
        now: Long,
        hadCaptcha: Boolean,
        loginType: LoginType
    ): TokenState {
        val accessToken = json.optString("access_token")
        if (accessToken.isBlank()) {
            val error = LoginErrorClassifier.classify(json, status, hadCaptcha)
            throw ScutException(
                error,
                error.human(),
                "status=$status code=${LoginErrorClassifier.serviceCode(json) ?: "-"}"
            )
        }
        val expiresIn = json.optLong("expires_in", -1L)
        if (expiresIn <= 0L) {
            throw ScutException(
                AppError.PROTOCOL_CHANGED,
                "token 响应缺少有效期",
                "status=$status"
            )
        }
        val tokenType = json.optString("token_type").ifBlank { "bearer" }
        val refreshToken = json.optString("refresh_token").ifBlank { previousRefreshToken }
        return TokenState(
            accessToken = accessToken,
            refreshToken = refreshToken,
            expiresAtMillis = ExpiryParser.toDeadlineMillis(expiresIn, now),
            tokenType = tokenType,
            tgc = tgc,
            locSession = locSession,
            name = json.optString("name"),
            sno = json.optString("sno"),
            campus = campus,
            loginType = loginType
        )
    }
}
