package cn.scut.bombax.scut

/**
 * SCUT endpoints used by this app, ported from the old Node implementation
 * (`src/utils/captcha.ts`, `src/utils/keyboard.ts`, `src/utils/session.ts`,
 * `src/utils/billing.ts`) and recorded in docs/PROTOCOL.md.
 */
object ScutEndpoints {
    const val CARD_HOST = "ecardwxnew.scut.edu.cn"
    const val DFYC_HOST = "dfyc.utc.scut.edu.cn"

    const val CARD_BASE = "https://$CARD_HOST"
    const val DFYC_BASE = "https://$DFYC_HOST"

    const val CAPTCHA_PATH = "/berserker-auth/oauth/captcha"
    const val TOKEN_PATH = "/berserker-auth/oauth/token"
    const val KEYBOARD_PATH = "/berserker-secure/keyboard"
    const val FEE_ITEM_PATH = "/charge/feeitem/getThirdDataByFeeItemId"
    const val REDIRECT_PATH = "/berserker-base/redirect"

    const val DFYC_USER_INFO_PATH = "/sdms-weixin-pay-sp/service/find/userinfo"
    const val DFYC_AMMETER_PATH = "/sdms-weixin-pay-sp/service/ammeterBalance"
    const val DFYC_WATER_PATH = "/sdms-weixin-pay-sp/service/waterBalance"

    /** Terminal page the DXC getCode step is expected to redirect to. */
    const val DFYC_INDEX = "/sdms-weixin-pay-sp/newWeixin/index.html"

    /**
     * Public OAuth client id/secret of the school's own mobile H5 client, in
     * base64 form for the `Authorization: Basic` header. This is the public
     * client credential embedded in the official web page, not a user
     * credential, and the protocol does not work without it.
     */
    const val BASIC_AUTH =
        "Basic bW9iaWxlX3NlcnZpY2VfcGxhdGZvcm06bW9iaWxlX3NlcnZpY2VfcGxhdGZvcm1fc2VjcmV0"

    /** Fee item ids observed in the old implementation. */
    const val FEE_ITEM_ELECTRIC = 1
    const val FEE_ITEM_AC = 2
    const val FEE_ITEM_WATER = 3

    val SCUT_HOSTS = setOf(CARD_HOST, DFYC_HOST)

    fun isScutHost(host: String): Boolean =
        host == "scut.edu.cn" || host.endsWith(".scut.edu.cn")

    fun cardUrl(path: String): okhttp3.HttpUrl =
        okhttp3.HttpUrl.Builder().scheme("https").host(CARD_HOST).encodedPath(path).build()

    fun dfycUrl(path: String): okhttp3.HttpUrl =
        okhttp3.HttpUrl.Builder().scheme("https").host(DFYC_HOST).encodedPath(path).build()
}

/** Redirect/auth stage names, used as the only identifier in log lines. */
object Stages {
    const val CAPTCHA = "captcha"
    const val KEYBOARD = "keyboard"
    const val LOGIN = "login"
    const val LOGIN_WITH_CAPTCHA = "login.captchaForm"
    const val LOGIN_WITHOUT_CAPTCHA = "login.noCaptcha"
    const val REFRESH = "token.refresh"
    const val GZIC_ELECTRIC = "gzic.electric"
    const val GZIC_AC = "gzic.ac"
    const val GZIC_WATER = "gzic.water"
    const val DXC_REDIRECT = "dxc.redirect"
    const val DXC_THIRD_LOGIN = "dxc.thirdLogin"
    const val DXC_AUTHORIZE = "dxc.authorize"
    const val DXC_GET_CODE = "dxc.getCode"
    const val DXC_USER_INFO = "dxc.userInfo"
    const val DXC_AMMETER = "dxc.ammeterBalance"
    const val DXC_WATER = "dxc.waterBalance"
}
