package cn.scut.bombax.scut

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import cn.scut.bombax.scut.auth.AuthRepository
import cn.scut.bombax.scut.auth.SecureKeyboardService
import cn.scut.bombax.scut.billing.BillingRepository
import cn.scut.bombax.scut.history.BalanceHistoryStore
import cn.scut.bombax.scut.network.ScutCookieJar
import cn.scut.bombax.scut.network.ScutHttp
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * The process-wide SCUT stack: one OkHttp client, one cookie jar, one session, one executor.
 *
 * Before 2026-10-08 all of this lived inside [ScutApiPlugin], which was fine while the WebView
 * was the only thing that could ask for a query. The daily refresh broke that assumption: the
 * alarm starts the notification service, and a service that built its *own* client, jar and
 * session would have had a second set of cookies, a second Keystore read and — the part that
 * actually matters — a second queue, so "at most one in-flight SCUT request" would have been
 * two. Sharing this object is what keeps that invariant true across both entry points.
 *
 * Threading: every SCUT call is dispatched onto [io], which is single-threaded. The lazily
 * built objects below are guarded by [lock] anyway, because the first one can be created from
 * the plugin's load path while another thread is already working.
 *
 * Nothing here is a secret store: the access token, refresh token, TGC, locSession and
 * JSESSIONID live in [session] and in the Keystore-encrypted file, and never leave this process.
 */
class ScutRuntime private constructor(val app: Context) {

    companion object {
        /** Name of the encrypted session record, under `noBackupFilesDir`. */
        const val SESSION_FILE = "scut-session.bin"

        /** Where the last WebView user agent is kept so a cold-started service asks as the same client. */
        const val PREFS = "bombax.native.v1"
        const val KEY_USER_AGENT = "userAgent"

        @Volatile
        private var instance: ScutRuntime? = null

        /** Application-scoped: the activity, the service and the alarm receiver all get the same one. */
        fun get(context: Context): ScutRuntime {
            val app = context.applicationContext ?: context
            instance?.let { if (it.app === app) return it }
            return synchronized(this) {
                val existing = instance
                if (existing != null && existing.app === app) {
                    existing
                } else {
                    ScutRuntime(app).also { instance = it }
                }
            }
        }
    }

    private val lock = Any()

    val cookieJar = ScutCookieJar()
    val session = SessionStore()

    /**
     * The one queue for SCUT traffic. Single-threaded by design: it is what makes "at most one
     * in-flight query" a property of the code rather than a promise in a comment.
     */
    val io: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "scut-io").apply { isDaemon = true }
    }

    /** Mirrors whether the persistent notice was asked to run; the OS can still stop it. */
    @Volatile
    var noticeRunning = false

    @Volatile
    private var userAgent: String? = null

    private var httpClient: ScutHttp? = null
    private var authRepository: AuthRepository? = null
    private var billingRepository: BillingRepository? = null

    /**
     * The local balance history, or null when it cannot be opened.
     *
     * `SQLiteOpenHelper` does not touch the disk until the database is first requested, so this
     * costs nothing at startup. A history that fails to open must never fail a query: the school
     * round-trip is the product, the record is the bonus, so every use of this is null-checked.
     */
    val history: BalanceHistoryStore? by lazy {
        runCatching { BalanceHistoryStore(app) }
            .onFailure { Diag.warn("stage=history result=unavailable reason=${it.javaClass.simpleName}") }
            .getOrNull()
    }

    private val prefs: SharedPreferences?
        get() = runCatching { app.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }.getOrNull()

    init {
        userAgent = prefs?.getString(KEY_USER_AGENT, null)
        attachSessionDisk()
        Diag.event(
            "stage=runtime result=ready api=${Build.VERSION.SDK_INT} release=${Build.VERSION.RELEASE} " +
                "userAgent=${if (userAgent.isNullOrBlank()) "absent" else "cached"}"
        )
    }

    /**
     * Records the WebView's own user agent, which is the string the whole protocol was verified
     * with. The daily alarm can start the process with no WebView at all, so the value is kept
     * across starts — the alternative would be asking SCUT as `okhttp/4.12.0`, an identity this
     * app has never measured. Only its presence is ever logged: the string names this device.
     */
    fun useWebViewUserAgent(candidate: String?) {
        if (candidate.isNullOrBlank() || candidate == userAgent) return
        synchronized(lock) {
            if (candidate == userAgent) return
            userAgent = candidate
            runCatching { prefs?.edit()?.putString(KEY_USER_AGENT, candidate)?.apply() }
            httpClient = null
            authRepository = null
            billingRepository = null
        }
    }

    /** OkHttp client for the whole process; rebuilt only when the user agent changes. */
    fun http(): ScutHttp = synchronized(lock) {
        httpClient?.let { return it }
        ScutHttp(ScutHttp.build(cookieJar, userAgent)).also { built ->
            httpClient = built
            // The repositories capture the client, so they are rebuilt with it.
            authRepository = null
            billingRepository = null
        }
    }

    fun auth(): AuthRepository = synchronized(lock) {
        authRepository?.let { return it }
        AuthRepository(http(), cookieJar, SecureKeyboardService(http())).also { authRepository = it }
    }

    fun billing(): BillingRepository = synchronized(lock) {
        billingRepository?.let { return it }
        BillingRepository(http(), cookieJar, session, auth(), history)
            .also { billingRepository = it }
    }

    /**
     * Enables the Keystore-backed session copy, for every entry point.
     *
     * This used to hang off the plugin's `load()`, which meant a process started by the daily
     * alarm had no way to read its own session. `noBackupFilesDir` keeps the file out of Android's
     * auto backup and `adb backup`; the Keystore key never leaves the device, so a copied file is
     * ciphertext with no usable key. Any failure degrades to memory-only rather than breaking login.
     */
    private fun attachSessionDisk() {
        runCatching {
            val file = File(app.noBackupFilesDir, SESSION_FILE)
            val store = FileSessionStore(file, KeystoreSessionCipher())
            store.probe()?.let {
                // Report and stay memory-only: a broken Keystore must not break login.
                Diag.warn("stage=session result=disk-disabled reason=$it")
                return
            }
            session.attachDisk(store)
            Diag.event("stage=session result=disk-ready path=noBackupFilesDir")
        }.onFailure {
            Diag.warn("stage=session result=disk-disabled reason=${it.javaClass.simpleName}")
        }
    }

    /**
     * What the plugin does when its Activity goes away.
     *
     * The in-memory session and the cookies are dropped, but the queue is deliberately *not*
     * shut down: this process may still be hosting the notification service, which owns the same
     * runtime. Calling `shutdownNow()` here would have made the daily path fail with
     * `RejectedExecutionException`, and a later Activity would have got a dead executor from the
     * singleton. When the process really dies the OS takes the thread with it.
     */
    fun onActivityDestroyed() {
        session.dropMemory()
        cookieJar.clear()
    }
}
