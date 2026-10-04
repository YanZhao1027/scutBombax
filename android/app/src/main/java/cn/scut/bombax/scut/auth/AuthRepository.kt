package cn.scut.bombax.scut.auth

import cn.scut.bombax.scut.AppError
import cn.scut.bombax.scut.Diag
import cn.scut.bombax.scut.ScutEndpoints
import cn.scut.bombax.scut.ScutException
import cn.scut.bombax.scut.Stages
import cn.scut.bombax.scut.network.ScutCookieJar
import cn.scut.bombax.scut.network.ScutHttp
import okhttp3.FormBody
import okhttp3.Request

data class LoginInput(
    val username: String,
    val password: String,
    val campus: Campus,
    val captchaKey: String?,
    val captchaCode: String?
)

/**
 * OAuth form construction, kept separate so the exact field names are one
 * auditable list rather than scattered strings.
 *
 * `username`, `password`, `grant_type`, `scope`, `loginForm`, `logintype`,
 * `device_token` and `synAccessSource` come from the old working implementation
 * (`src/utils/session.ts`). The two captcha names are the Synjones candidates
 * (`captcha_header_code` / `captcha_header_key`) that still have to be confirmed
 * by a device trace; the stage name recorded in logcat tells the two attempts
 * apart.
 */
object LoginForm {
    const val FIELD_CAPTCHA_CODE = "captcha_header_code"
    const val FIELD_CAPTCHA_KEY = "captcha_header_key"

    val BASE_FIELDS = listOf(
        "grant_type" to "password",
        "scope" to "all",
        "loginForm" to "h5",
        "logintype" to "card",
        "device_token" to "h5",
        "synAccessSource" to "h5"
    )

    val REFRESH_FIELDS = listOf(
        "grant_type" to "refresh_token",
        "scope" to "all",
        "loginForm" to "h5",
        "logintype" to "card",
        "device_token" to "h5",
        "synAccessSource" to "h5"
    )

    fun passwordForm(
        username: String,
        encodedPassword: String,
        captchaKey: String?,
        captchaCode: String?
    ): FormBody {
        val builder = FormBody.Builder()
            .add("username", username)
            .add("password", encodedPassword)
        for ((key, value) in BASE_FIELDS) builder.add(key, value)
        if (!captchaKey.isNullOrEmpty() && !captchaCode.isNullOrEmpty()) {
            builder.add(FIELD_CAPTCHA_CODE, captchaCode)
            builder.add(FIELD_CAPTCHA_KEY, captchaKey)
        }
        return builder.build()
    }

    fun refreshForm(refreshToken: String): FormBody {
        val builder = FormBody.Builder().add("refresh_token", refreshToken)
        for ((key, value) in REFRESH_FIELDS) builder.add(key, value)
        return builder.build()
    }
}

/**
 * Owns the OAuth handshake. Session state is written into [SessionStore] and the
 * cookie jar only; nothing here returns a token to the caller's caller.
 */
class AuthRepository(
    private val http: ScutHttp,
    private val cookieJar: ScutCookieJar,
    private val keyboardService: SecureKeyboardService
) {

    fun login(input: LoginInput): TokenState {
        val username = input.username.trim()
        if (username.isEmpty() || input.password.isEmpty()) {
            throw ScutException(AppError.INVALID_INPUT, "请填写账号和密码", "login/input")
        }

        val keyboard = keyboardService.fetch()
        val encoded = SecureKeyboardEncoder.encode(input.password, keyboard.numberKeyboard, keyboard.uuid)
            ?: throw ScutException(
                AppError.INVALID_INPUT,
                "一卡通密码应为数字，且与安全键盘布局匹配",
                "login/encode"
            )

        val hadCaptcha = !input.captchaKey.isNullOrEmpty() && !input.captchaCode.isNullOrEmpty()
        val stage = if (hadCaptcha) Stages.LOGIN_WITH_CAPTCHA else Stages.LOGIN_WITHOUT_CAPTCHA

        val body = LoginForm.passwordForm(username, encoded, input.captchaKey, input.captchaCode)
        val request = Request.Builder()
            .url(ScutEndpoints.cardUrl(ScutEndpoints.TOKEN_PATH))
            .header("Authorization", ScutEndpoints.BASIC_AUTH)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .post(body)
            .build()

        val response = http.send(stage, request)
        val json = response.json
        if (response.status !in 200..299 || json == null) {
            val error = LoginErrorClassifier.classify(json, response.status, hadCaptcha)
            Diag.warn(
                "stage=$stage result=rejected error=${error.wire} " +
                    "status=${response.status} code=${LoginErrorClassifier.serviceCode(json) ?: "-"}"
            )
            throw ScutException(
                error,
                error.human(),
                "status=${response.status} code=${LoginErrorClassifier.serviceCode(json) ?: "-"}"
            )
        }

        val state = TokenParser.parse(
            json = json,
            status = response.status,
            campus = input.campus,
            tgc = cookieJar.value("TGC").orEmpty(),
            locSession = cookieJar.value("locSession").orEmpty(),
            previousRefreshToken = "",
            now = System.currentTimeMillis(),
            hadCaptcha = hadCaptcha
        )
        Diag.event(
            "stage=$stage result=ok campus=${state.campus.name} " +
                "refreshToken=${if (state.refreshToken.isBlank()) "absent" else "present"} " +
                "cookies=${cookieJar.snapshotNames().joinToString(",")}"
        )
        return state
    }

    /** Standards-style refresh; failure always means interactive relogin. */
    fun refresh(current: TokenState): TokenState {
        if (current.refreshToken.isBlank()) {
            throw ScutException(
                AppError.REAUTH_REQUIRED,
                "学校未下发 refresh_token，需要重新登录",
                "refresh/absent"
            )
        }
        val request = Request.Builder()
            .url(ScutEndpoints.cardUrl(ScutEndpoints.TOKEN_PATH))
            .header("Authorization", ScutEndpoints.BASIC_AUTH)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .post(LoginForm.refreshForm(current.refreshToken))
            .build()

        val response = http.send(Stages.REFRESH, request)
        val json = response.json
        if (response.status !in 200..299 || json == null) {
            Diag.warn(
                "stage=${Stages.REFRESH} result=failed status=${response.status} " +
                    "code=${LoginErrorClassifier.serviceCode(json) ?: "-"}"
            )
            throw ScutException(
                AppError.REAUTH_REQUIRED,
                "token 刷新失败，请重新登录",
                "refresh/${response.status}"
            )
        }

        val refreshed = TokenParser.parse(
            json = json,
            status = response.status,
            campus = current.campus,
            // A refresh that does not re-issue these must not wipe them.
            tgc = cookieJar.value("TGC") ?: current.tgc,
            locSession = cookieJar.value("locSession") ?: current.locSession,
            previousRefreshToken = current.refreshToken,
            now = System.currentTimeMillis(),
            hadCaptcha = false
        )
        val rotated = refreshed.refreshToken != current.refreshToken
        Diag.event(
            "stage=${Stages.REFRESH} result=ok rotated=${if (rotated) "yes" else "no"} " +
                "expiresIn=${((refreshed.expiresAtMillis - System.currentTimeMillis()) / 1000)}s " +
                "tgc=${if (refreshed.tgc.isBlank()) "absent" else "present"} " +
                "locSession=${if (refreshed.locSession.isBlank()) "absent" else "present"}"
        )
        return refreshed
    }

    /**
     * Clears the whole client-side session. The old implementation has no
     * documented SCUT logout endpoint, so this drops local cookies only and
     * does not guess at one.
     */
    fun logout() {
        cookieJar.clear()
        Diag.event("stage=logout result=cleared")
    }
}
