package cn.scut.bombax.scut

import android.os.Build
import cn.scut.bombax.scut.auth.AuthRepository
import cn.scut.bombax.scut.auth.CaptchaService
import cn.scut.bombax.scut.auth.Campus
import cn.scut.bombax.scut.auth.LoginInput
import cn.scut.bombax.scut.auth.LoginType
import cn.scut.bombax.scut.auth.SecureKeyboardService
import cn.scut.bombax.scut.auth.TokenState
import cn.scut.bombax.scut.billing.BalanceReading
import cn.scut.bombax.scut.billing.BillingRepository
import cn.scut.bombax.scut.network.ScutCookieJar
import cn.scut.bombax.scut.network.ScutHttp
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.Executors
import java.util.concurrent.ExecutorService

/**
 * The only bridge between the WebView and SCUT.
 *
 * Surface is intentionally narrow — health, captcha, login, bills, refresh,
 * logout. Access token, refresh token, TGC, locSession and JSESSIONID never
 * cross into JavaScript; the page only gets display strings and stable error
 * codes.
 *
 * All work runs on one single-thread executor, which is what guarantees at most
 * one in-flight SCUT request at a time.
 */
@CapacitorPlugin(name = "ScutApi")
class ScutApiPlugin : Plugin() {

    companion object {
        /** Version of the JS-facing surface, bumped when a method is added. */
        const val BRIDGE_VERSION = "1"
    }

    private val cookieJar = ScutCookieJar()
    private val session = SessionStore()
    private val io: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "scut-io").apply { isDaemon = true }
    }

    private var http: ScutHttp? = null
    private var authRepository: AuthRepository? = null
    private var billingRepository: BillingRepository? = null

    private fun http(): ScutHttp {
        http?.let { return it }
        val userAgent = runCatching { bridge.webView?.settings?.userAgentString }.getOrNull()
        val built = ScutHttp(ScutHttp.build(cookieJar, userAgent))
        http = built
        return built
    }

    private fun auth(): AuthRepository {
        authRepository?.let { return it }
        val built = AuthRepository(http(), cookieJar, SecureKeyboardService(http()))
        authRepository = built
        return built
    }

    private fun billing(): BillingRepository {
        billingRepository?.let { return it }
        val built = BillingRepository(http(), cookieJar, session, auth())
        billingRepository = built
        return built
    }

    /** App-local plugin registration happens in MainActivity before the bridge loads. */
    override fun load() {
        super.load()
        Diag.event(
            "plugin=ScutApi ready api=${Build.VERSION.SDK_INT} release=${Build.VERSION.RELEASE}"
        )
    }

    @PluginMethod
    fun health(call: PluginCall) {
        submit(call) {
            val versionName = runCatching {
                val context = getContext()
                context.packageManager.getPackageInfo(context.packageName, 0).versionName
            }.getOrNull() ?: "0.1.0"
            JSObject().apply {
                put("ok", true)
                put("platform", "android")
                put("appVersion", versionName)
                put("bridgeVersion", BRIDGE_VERSION)
                put("androidApi", Build.VERSION.SDK_INT)
                put("androidRelease", Build.VERSION.RELEASE)
                put("deviceModel", Build.MODEL)
                put("tlsValidation", "default")
                put("session", sessionJson(session.public(System.currentTimeMillis())))
            }
        }
    }

    @PluginMethod
    fun getCaptcha(call: PluginCall) {
        submit(call) {
            val challenge = CaptchaService(http()).fetch()
            JSObject().apply {
                put("key", challenge.key)
                put("image", challenge.image)
            }
        }
    }

    @PluginMethod
    fun login(call: PluginCall) {
        val username = call.getString("username").orEmpty()
        val password = call.getString("password").orEmpty()
        val campus = Campus.from(call.getString("campus"))
        val captchaKey = call.getString("captchaKey")
        val captchaCode = call.getString("captchaCode")
        // No default: `card` and `sno` are different account namespaces and picking the wrong
        // one looks exactly like a wrong password, so a missing or unknown value is refused.
        val loginType = LoginType.from(call.getString("loginType"))
        submit(call) {
            if (loginType == null) {
                throw ScutException(
                    AppError.INVALID_INPUT,
                    "请选择登录方式（学工号登录或账号登录）",
                    "login/loginType"
                )
            }
            val state = auth().login(
                LoginInput(username, password, campus, loginType, captchaKey, captchaCode)
            )
            session.save(state)
            sessionJson(session.public(System.currentTimeMillis()))
        }
    }

    @PluginMethod
    fun getBills(call: PluginCall) {
        submit(call) {
            if (session.peek() == null) {
                throw ScutException(AppError.NO_SESSION, "尚未登录", "bills/noSession")
            }
            billsJson(billing().fetchBills())
        }
    }

    @PluginMethod
    fun refreshSession(call: PluginCall) {
        submit(call) {
            val current = session.peek()
                ?: throw ScutException(AppError.NO_SESSION, "尚未登录", "refresh/noSession")
            val result = JSObject()
            try {
                val refreshed: TokenState = auth().refresh(current)
                session.save(refreshed)
                result.put("refreshed", true)
            } catch (failure: ScutException) {
                // A failed refresh means interactive relogin, never a stored
                // password replay.
                session.clear()
                cookieJar.clear()
                result.put("refreshed", false)
                result.put("error", failure.error.wire)
            }
            result.put("session", sessionJson(session.public(System.currentTimeMillis())))
            result
        }
    }

    @PluginMethod
    fun logout(call: PluginCall) {
        submit(call) {
            session.clear()
            auth().logout()
            sessionJson(SessionPublic.anonymous())
        }
    }

    override fun handleOnDestroy() {
        io.shutdownNow()
        session.clear()
        cookieJar.clear()
        super.handleOnDestroy()
    }

    // ------------------------------------------------------------ plumbing

    private fun sessionJson(public: SessionPublic): JSObject = JSObject().apply {
        put("authenticated", public.authenticated)
        put("campus", public.campus?.name ?: JSObject.NULL)
        put("name", public.name)
        put("expiresIn", public.expiresIn)
        put("canRefresh", public.canRefresh)
    }

    private fun billsJson(reading: BalanceReading): JSObject = JSObject().apply {
        put("campus", reading.campus)
        put("room", reading.room)
        putNumberOr("electric", reading.electric)
        putNumberOr("water", reading.water)
        putNumberOr("ac", reading.ac)
        // The school's own wording is shown verbatim so the unit of each number
        // can be confirmed on a real account. It is display data for the signed-in
        // user, never a log line. Key names match `Bills` in src/types.ts.
        put("electricUnit", reading.electricText)
        put("waterUnit", reading.waterText)
        put("acUnit", reading.acText)
        put("updatedAt", reading.updatedAtMillis)
    }

    private fun JSObject.putNumberOr(key: String, value: Double?) {
        if (value == null) put(key, JSObject.NULL) else put(key, value)
    }

    private fun submit(call: PluginCall, work: () -> JSObject) {
        try {
            io.execute {
                try {
                    call.resolve(work())
                } catch (failure: ScutException) {
                    reject(call, failure.error, failure.message ?: failure.error.wire, failure.detail)
                } catch (throwable: Throwable) {
                    Diag.warn("unexpected ${throwable.javaClass.simpleName} during native call")
                    reject(
                        call,
                        AppError.UPSTREAM_UNAVAILABLE,
                        "原生请求失败",
                        throwable.javaClass.simpleName
                    )
                }
            }
        } catch (rejected: java.util.concurrent.RejectedExecutionException) {
            reject(call, AppError.BUSY, "应用正在退出", "io/shutdown")
        }
    }

    private fun reject(call: PluginCall, error: AppError, message: String, detail: String?) {
        val data = JSObject()
        if (!detail.isNullOrEmpty()) data.put("detail", Diag.scrub(detail))
        call.reject(message, error.wire, null, data)
    }
}
