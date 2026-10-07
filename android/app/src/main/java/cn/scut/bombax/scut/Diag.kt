package cn.scut.bombax.scut

import android.util.Log
import okhttp3.HttpUrl

/**
 * Redacted diagnostics.
 *
 * Everything written through this object is safe to read in `adb logcat`:
 * stage name, method, host, path, HTTP status, elapsed time and a non-sensitive
 * upstream service code. Query strings are never printed (the DXC redirect puts
 * an access token in one), cookie values are never printed, and no identity,
 * password, captcha answer or token is ever printed.
 */
object Diag {
    const val TAG = "ScutBombax"

    /**
     * Where a line goes. Production is logcat; a JVM unit test has no `android.util.Log`, so it
     * swaps this out instead of the project weakening `unitTests.returnDefaultValues` globally.
     */
    internal var writer: (warn: Boolean, String) -> Unit = ::logcat

    internal fun logcat(warn: Boolean, message: String) {
        if (warn) Log.w(TAG, message) else Log.i(TAG, message)
    }

    fun request(
        stage: String,
        method: String,
        url: HttpUrl,
        status: Int,
        elapsedMs: Long,
        serviceCode: String? = null,
        blocked: Boolean = false
    ) {
        val builder = StringBuilder()
            .append("stage=").append(stage)
            .append(" method=").append(method)
            .append(" host=").append(url.host)
            .append(" path=").append(url.encodedPath)
            .append(" status=").append(status)
            .append(" ms=").append(elapsedMs)
        if (!serviceCode.isNullOrEmpty()) builder.append(" serviceCode=").append(serviceCode)
        // The school's off-campus block page carries the caller's public IP, so
        // the only thing recorded about it is that it happened.
        if (blocked) builder.append(" blocked=campus-network-only")
        writer(false, builder.toString())
    }

    fun ioFailure(stage: String, method: String, url: HttpUrl, elapsedMs: Long, kind: String) {
        writer(
            true,
            "stage=$stage method=$method host=${url.host} path=${url.encodedPath} " +
                "status=-1 ms=$elapsedMs io=$kind"
        )
    }

    /** Coarse, credential-free progress events (e.g. "login=ok campus=GZIC"). */
    fun event(message: String) {
        writer(false, message)
    }

    fun warn(message: String) {
        writer(true, message)
    }

    /**
     * Best-effort sanitizer for any text that might reach a log line: strips
     * anything that looks like a bearer token, a cookie pair, a secret or a long
     * opaque value. Used only as a second line of defence.
     */
    fun scrub(text: String): String =
        text
            .replace(
                Regex("(?i)(authorization|cookie|synjones-auth|password|access_token|refresh_token|token|secret|captcha)\\s*[=:]\\s*[^&\\s,;]+"),
                "$1=<redacted>"
            )
            .replace(Regex("[A-Za-z0-9+/=_-]{40,}"), "<opaque>")
}
