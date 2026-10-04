package cn.scut.bombax.scut

/**
 * Stable app-level error codes. Raw upstream text is never forwarded to the
 * WebView; only these codes plus a short human message and a redacted detail
 * (HTTP status or upstream service code) cross the bridge.
 */
enum class AppError(val wire: String) {
    CAPTCHA_REQUIRED("CAPTCHA_REQUIRED"),
    CAPTCHA_INVALID("CAPTCHA_INVALID"),
    INVALID_CREDENTIALS("INVALID_CREDENTIALS"),
    REAUTH_REQUIRED("REAUTH_REQUIRED"),
    UPSTREAM_UNAVAILABLE("UPSTREAM_UNAVAILABLE"),
    PROTOCOL_CHANGED("PROTOCOL_CHANGED"),
    NO_SESSION("NO_SESSION"),
    BUSY("BUSY"),
    INVALID_INPUT("INVALID_INPUT"),
    NETWORK("NETWORK"),
    CAMPUS_NETWORK_REQUIRED("CAMPUS_NETWORK_REQUIRED");

    /**
     * The user-facing line for this code. Raw upstream text never crosses the
     * bridge, so every message shown on screen comes from this one list.
     */
    fun human(): String = when (this) {
        CAPTCHA_REQUIRED -> "需要输入图形验证码"
        CAPTCHA_INVALID -> "图形验证码不正确"
        INVALID_CREDENTIALS -> "账号或密码不正确"
        REAUTH_REQUIRED -> "登录已过期，请重新登录"
        UPSTREAM_UNAVAILABLE -> "一卡通服务暂不可用，请稍后再试"
        PROTOCOL_CHANGED -> "一卡通接口结构已变化"
        NO_SESSION -> "尚未登录"
        BUSY -> "已有请求在进行中"
        INVALID_INPUT -> "账号或密码填写不完整"
        NETWORK -> "网络请求失败"
        CAMPUS_NETWORK_REQUIRED -> "当前网络无法访问一卡通服务，请连接校园网或使用学校 SSLVPN 后重试"
    }
}

/**
 * @param detail redacted diagnostic only: a stage name, HTTP status or service
 *   code. Never a token, cookie value, password, captcha answer or identity.
 */
class ScutException(
    val error: AppError,
    message: String,
    val detail: String? = null,
    cause: Throwable? = null
) : Exception(message, cause)
