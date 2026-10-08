package cn.scut.bombax.scut

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import cn.scut.bombax.scut.notice.BalanceNoticeService
import cn.scut.bombax.scut.notice.DailyRefresh
import cn.scut.bombax.scut.notice.DailySchedule
import cn.scut.bombax.scut.auth.CaptchaService
import cn.scut.bombax.scut.auth.Campus
import cn.scut.bombax.scut.auth.LoginInput
import cn.scut.bombax.scut.auth.LoginType
import cn.scut.bombax.scut.auth.TokenState
import cn.scut.bombax.scut.billing.BalanceReading
import cn.scut.bombax.scut.history.BalanceSnapshot
import cn.scut.bombax.scut.history.SnapshotSource
import com.getcapacitor.JSObject
import org.json.JSONArray
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/** The alias the notification permission is asked under; see `requestNoticePermission`.
 *
 * A file-level constant rather than a companion one, because annotation arguments are resolved
 * outside the class body and cannot see it. */
private const val NOTICE_PERMISSION_ALIAS = "notifications"

/**
 * The only bridge between the WebView and SCUT.
 *
 * Surface is intentionally narrow — health, captcha, login, bills, refresh, logout, and the two
 * opt-in notification switches. Access token, refresh token, TGC, locSession and JSESSIONID never
 * cross into JavaScript; the page only gets display strings and stable error codes.
 *
 * The stack itself is [ScutRuntime], which is process-wide and shared with the notification
 * service. That sharing is the whole reason at-most-one-in-flight survives the daily alarm.
 */
@CapacitorPlugin(
    name = "ScutApi",
    permissions = [
        Permission(alias = NOTICE_PERMISSION_ALIAS, strings = [Manifest.permission.POST_NOTIFICATIONS])
    ]
)
class ScutApiPlugin : Plugin() {

    companion object {
        /** Version of the JS-facing surface, bumped when a method is added. */
        const val BRIDGE_VERSION = "3"
    }

    /** Capacitor exposes a nullable context; the activity is always there once the bridge is up. */
    private val appCtx: Context
        get() = context ?: bridge.activity

    /** The process-wide stack: one client, one cookie jar, one session, one queue. */
    private val runtime: ScutRuntime
        get() = ScutRuntime.get(appCtx)

    /** App-local plugin registration happens in MainActivity before the bridge loads. */
    override fun load() {
        super.load()
        // The WebView's own UA is the identity every protocol fact in docs/PROTOCOL.md was
        // verified with; the daily alarm can start this process with no WebView, so the runtime
        // keeps a copy.
        runtime.useWebViewUserAgent(runCatching { bridge.webView?.settings?.userAgentString }.getOrNull())
        // An alarm is a one-shot that does not survive a reboot, so every app start re-arms it.
        DailyRefresh.armIfEnabled(appCtx, System.currentTimeMillis())
        Diag.event(
            "plugin=ScutApi ready api=${Build.VERSION.SDK_INT} release=${Build.VERSION.RELEASE} bridge=$BRIDGE_VERSION"
        )
    }

    @PluginMethod
    fun health(call: PluginCall) {
        submit(call) {
            val versionName = runCatching {
                val context = getContext()
                context.packageManager.getPackageInfo(context.packageName, 0).versionName
            }.getOrNull() ?: "0.2.0"
            JSObject().apply {
                put("ok", true)
                put("platform", "android")
                put("appVersion", versionName)
                put("bridgeVersion", BRIDGE_VERSION)
                put("androidApi", Build.VERSION.SDK_INT)
                put("androidRelease", Build.VERSION.RELEASE)
                put("deviceModel", Build.MODEL)
                put("tlsValidation", "default")
                put("session", sessionJson(runtime.session.public(System.currentTimeMillis())))
            }
        }
    }

    @PluginMethod
    fun getCaptcha(call: PluginCall) {
        submit(call) {
            val challenge = CaptchaService(runtime.http()).fetch()
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
            val state = runtime.auth().login(
                LoginInput(username, password, campus, loginType, captchaKey, captchaCode)
            )
            runtime.session.save(state)
            sessionJson(runtime.session.public(System.currentTimeMillis()))
        }
    }

    @PluginMethod
    fun getBills(call: PluginCall) {
        // The page knows why it asked — a tap, the timer, a login, a restore — and the history
        // needs that to tell a nightly series point from a curious glance. An unrecognised value
        // becomes `unknown` rather than being assumed to be a tap.
        val source = SnapshotSource.from(call.getString("source"))
        submit(call) {
            if (runtime.session.peek() == null) {
                throw ScutException(AppError.NO_SESSION, "尚未登录", "bills/noSession")
            }
            billsJson(runtime.billing().fetchBills(source))
        }
    }

    /**
     * The newest stored reading, for the screen to fall back on when the school cannot be reached.
     *
     * Returns `null` rather than an empty object when there is no history, so the page cannot
     * mistake "never queried" for "queried and got zeros".
     */
    @PluginMethod
    fun lastSnapshot(call: PluginCall) {
        submit(call) {
            val stored = runtime.history?.latestAny()
            if (stored == null) {
                JSObject().apply { put("snapshot", JSObject.NULL) }
            } else {
                JSObject().apply { put("snapshot", snapshotJson(stored)) }
            }
        }
    }

    /**
     * A local-only chart read. Never fetches SCUT, never writes or synthesises history.
     * Uses the last displayed meter profile so an offline chart works without a session.
     * No room number or grouping hash crosses this new bridge method.
     */
    @PluginMethod
    fun electricHistory(call: PluginCall) {
        submit(call) {
            val history = runtime.history
            val latest = history?.latestAny()
            val points = JSONArray()
            if (latest != null) {
                history.listForProfile(latest.profileId).forEach { stored ->
                    points.put(JSObject().apply {
                        put("updatedAt", stored.recordedAtMillis)
                        putNumberOr("electric", stored.electric)
                        put("source", stored.source.wire)
                    })
                }
            }
            JSObject().apply {
                put("campus", latest?.campus ?: JSObject.NULL)
                put("unit", latest?.electricUnit.orEmpty())
                put("points", points)
            }
        }
    }

    @PluginMethod
    fun clearHistory(call: PluginCall) {
        submit(call) {
            val history = runtime.history
                ?: throw ScutException(
                    AppError.UPSTREAM_UNAVAILABLE,
                    "本机历史记录暂不可用",
                    "history/unavailable"
                )
            JSObject().apply { put("deleted", history.clear(profileId = null).toLong()) }
        }
    }

    @PluginMethod
    fun refreshSession(call: PluginCall) {
        submit(call) {
            val current = runtime.session.peek()
                ?: throw ScutException(AppError.NO_SESSION, "尚未登录", "refresh/noSession")
            val result = JSObject()
            try {
                val refreshed: TokenState = runtime.auth().refresh(current)
                runtime.session.save(refreshed)
                result.put("refreshed", true)
            } catch (failure: ScutException) {
                // A failed refresh means interactive relogin, never a stored
                // password replay.
                runtime.session.clear()
                runtime.cookieJar.clear()
                result.put("refreshed", false)
                result.put("error", failure.error.wire)
            }
            result.put("session", sessionJson(runtime.session.public(System.currentTimeMillis())))
            result
        }
    }

    // ------------------------------------------------------- persistent notice
    //
    // Opt-in, off by default. Two levels: the notification itself, which only ever shows what the
    // page hands it, and — on top of that — one daily refresh driven by an inexact alarm. Turning
    // the notification off turns the daily path off with it, because the service is the only thing
    // the alarm is allowed to wake.

    @PluginMethod
    fun noticeStatus(call: PluginCall) {
        submit(call) { noticeJson() }
    }

    @PluginMethod
    fun requestNoticePermission(call: PluginCall) {
        // Below Android 13 the runtime permission does not exist, and if it is already granted
        // there is nothing to ask — either way, answer with the real state.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || noticePermissionGranted()) {
            submit(call) { noticeJson() }
            return
        }
        // Hand the call to Capacitor's activity-result launcher so it resolves **after** the
        // person answers the dialog. Answering immediately used to read `granted=false` while the
        // dialog was still open, which made the page revert its own switch and left the user
        // toggling twice — found during the 2026-10-08 release acceptance.
        requestPermissionForAlias(NOTICE_PERMISSION_ALIAS, call, "handleNoticePermissionResult")
    }

    /**
     * The permission dialog is gone; answer with the system's state rather than with the callback
     * map, so this response and `noticeStatus()` can never disagree.
     *
     * **The signature is one parameter, and Capacitor's reflection will crash the app if it is
     * not.** `Plugin.triggerPermissionCallback` invokes `method.invoke(this, savedCall)` — a first
     * version of this method took `(call, grantResults)` as the javadoc suggests, and the app died
     * with `IllegalArgumentException: Wrong number of arguments; expected 2, got 1` the moment the
     * user answered the dialog (seen on the release build, 2026-10-08 16:54:24). The grant result
     * is not needed anyway: the state is read from the system below.
     */
    @PermissionCallback
    fun handleNoticePermissionResult(call: PluginCall) {
        submit(call) { noticeJson() }
    }

    @PluginMethod
    fun startNotice(call: PluginCall) {
        submit(call) {
            val context = appCtx
            requireNoticeAllowed()
            BalanceNoticeService.createChannel(context)
            val intent = BalanceNoticeService.intent(
                context,
                call.getString("room").orEmpty(),
                call.getString("electric").orEmpty(),
                call.getString("water").orEmpty(),
                call.getString("unit").orEmpty(),
                call.getString("updated").orEmpty()
            )
            // Refused is a reportable outcome, not an exception: the page still has the numbers on
            // screen, it just could not pin them to the shade right now.
            val started = BalanceNoticeService.start(context, intent)
            runtime.noticeRunning = started != "refused"
            JSObject().apply {
                put("running", started != "refused")
                put("how", started)
            }
        }
    }

    @PluginMethod
    fun stopNotice(call: PluginCall) {
        submit(call) {
            val context = appCtx
            context.stopService(BalanceNoticeService.intent(context, "", "", "", "", ""))
            runtime.noticeRunning = false
            // The user asked for no notification; a daily alarm that restarts the service would
            // put one straight back up. Both switches go together on the way off.
            DailyRefresh.disable(context)
            noticeJson()
        }
    }

    // ---------------------------------------------------------- daily refresh
    //
    // One query a day, inexact alarm, no login attempt, no retry loop. Off by default.

    @PluginMethod
    fun enableDaily(call: PluginCall) {
        submit(call) {
            val context = appCtx
            requireNoticeAllowed()
            if (runtime.session.peek() == null) {
                throw ScutException(
                    AppError.NO_SESSION,
                    "请先登录，再开启晚间余额快照",
                    "daily/noSession"
                )
            }
            val enabled = DailyRefresh.enable(context, System.currentTimeMillis())
            if (enabled == 0L) {
                throw ScutException(
                    AppError.UPSTREAM_UNAVAILABLE,
                    "系统不接受定时唤醒，无法开启晚间余额快照",
                    "daily/arm-failed"
                )
            }
            noticeJson()
        }
    }

    @PluginMethod
    fun disableDaily(call: PluginCall) {
        submit(call) {
            DailyRefresh.disable(appCtx)
            noticeJson()
        }
    }

    private fun noticeJson(): JSObject {
        val context = appCtx
        val now = System.currentTimeMillis()
        val nextDue = DailyRefresh.nextDue(context, now)
        return JSObject().apply {
            put("granted", noticePermissionGranted())
            put("enabled", NotificationManagerCompat.from(context).areNotificationsEnabled())
            put("running", runtime.noticeRunning)
            put("dailyEnabled", DailyRefresh.isEnabled(context))
            // -1 while the switch is off; seconds until the next planned wake otherwise.
            put("nextDueIn", if (nextDue == 0L) -1L else DailySchedule.secondsUntil(now, nextDue))
        }
    }

    private fun requireNoticeAllowed() {
        val context = appCtx
        if (!noticePermissionGranted() || !NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            throw ScutException(
                AppError.INVALID_INPUT,
                "通知权限未开启，请在系统设置里允许本应用通知",
                "notice/permission"
            )
        }
    }

    private fun noticePermissionGranted(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            appCtx,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
    }

    @PluginMethod
    fun logout(call: PluginCall) {
        submit(call) {
            runtime.session.clear()
            runtime.auth().logout()
            sessionJson(SessionPublic.anonymous())
        }
    }

    override fun handleOnDestroy() {
        // Memory only: the stored copy is what makes the next start stay signed in. The shared
        // queue deliberately outlives the Activity — the notification service owns it too.
        runtime.onActivityDestroyed()
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

    /**
     * The same shape as `billsJson`, plus the two fields that make a stale reading honest:
     * when it was taken and why. The page must not be able to render history as present.
     */
    private fun snapshotJson(stored: BalanceSnapshot): JSObject = JSObject().apply {
        put("campus", stored.campus)
        put("room", stored.room)
        putNumberOr("electric", stored.electric)
        putNumberOr("water", stored.water)
        putNumberOr("ac", stored.ac)
        put("electricUnit", stored.electricUnit)
        put("waterUnit", stored.waterUnit)
        put("acUnit", stored.acUnit)
        put("updatedAt", stored.recordedAtMillis)
        put("source", stored.source.wire)
    }

    private fun billsJson(reading: BalanceReading): JSObject = JSObject().apply {        put("campus", reading.campus)
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
            runtime.io.execute {
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
