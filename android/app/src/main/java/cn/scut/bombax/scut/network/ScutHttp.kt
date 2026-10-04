package cn.scut.bombax.scut.network

import android.os.SystemClock
import cn.scut.bombax.scut.AppError
import cn.scut.bombax.scut.Diag
import cn.scut.bombax.scut.ScutException
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Response snapshot with the only fields the protocol layer needs.
 *
 * @param serviceCode non-sensitive `code` field from an upstream JSON body
 * @param location absolute redirect target when the response is a 3xx
 */
class ScutResponse(
    val stage: String,
    val status: Int,
    val json: JSONObject?,
    val rawLength: Int,
    val location: String?,
    val cookieNames: List<String>,
    /** name to value for this hop only; never logged and never sent to JS. */
    val cookiePairs: Map<String, String>,
    /**
     * True when the school's edge answered with its off-campus block page. Such
     * a response never reaches a caller: [ScutHttp.send] turns it into
     * [AppError.CAMPUS_NETWORK_REQUIRED] and drops the body, which echoes the
     * device's public IP.
     */
    val blockedByNetworkPolicy: Boolean = false
) {
    val isRedirect: Boolean get() = status in 300..399 && !location.isNullOrEmpty()

    /** Upstream service code as text, when present. Never a body. */
    val serviceCode: String?
        get() = json?.opt("code")?.toString()?.takeIf { it.isNotBlank() && it != "null" }

    fun requireJson(): JSONObject =
        json ?: throw ScutException(
            AppError.PROTOCOL_CHANGED,
            "上游返回的不是 JSON",
            "$stage/$status"
        )

    /** Body as text for non-JSON upstreams that still answer with JSON-ish payloads. */
    fun stringValue(key: String): String? = json?.optString(key)?.takeIf { it.isNotEmpty() }
}

/**
 * One OkHttp client for the whole app.
 *
 * - redirects are never followed automatically: the DXC chain must inspect each
 *   302 and its Location header.
 * - TLS validation is left exactly as Android ships it; no trust manager is
 *   overridden and no proxy is injected.
 */
class ScutHttp(private val client: OkHttpClient) {

    companion object {
        const val CONNECT_TIMEOUT_SECONDS = 10L
        const val READ_TIMEOUT_SECONDS = 15L
        const val MAX_BODY_BYTES = 1_500_000

        fun defaultCookieJar(): ScutCookieJar = ScutCookieJar()

        /**
         * @param userAgent sent on every request. The WebView's own UA is used
         *   so the native client identifies as the same H5 client the school
         *   already serves.
         */
        fun build(jar: ScutCookieJar, userAgent: String?): OkHttpClient {
            val builder = OkHttpClient.Builder()
                .cookieJar(jar)
                .followRedirects(false)
                .followSslRedirects(false)
                .retryOnConnectionFailure(true)
                .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .writeTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            if (!userAgent.isNullOrBlank()) {
                builder.addInterceptor { chain ->
                    val request = chain.request().newBuilder()
                        .header("User-Agent", userAgent)
                        .header("Accept", "application/json, text/plain, */*")
                        .header("Accept-Language", "zh-CN,zh;q=0.9")
                        .build()
                    chain.proceed(request)
                }
            }
            return builder.build()
        }
    }

    /**
     * Executes [request] and always logs a redacted line for it.
     *
     * Transient I/O problems become [AppError.NETWORK]; a non-2xx/non-3xx answer
     * is returned untouched so callers can classify it themselves. The single
     * exception is the school's off-campus block page, which becomes
     * [AppError.CAMPUS_NETWORK_REQUIRED] here because it means the same thing
     * at every stage and its body must not be retained.
     */
    fun send(stage: String, request: Request): ScutResponse {
        val started = SystemClock.elapsedRealtime()
        val response = try {
            client.newCall(request).execute()
        } catch (io: IOException) {
            val elapsed = SystemClock.elapsedRealtime() - started
            Diag.ioFailure(stage, request.method, request.url, elapsed, io.javaClass.simpleName)
            throw ScutException(
                AppError.NETWORK,
                "网络请求失败",
                "$stage/${io.javaClass.simpleName}",
                io
            )
        }

        response.use { live ->
            val elapsed = SystemClock.elapsedRealtime() - started
            val bodyBytes = runCatching { live.body?.byteStream()?.use { it.readBytesLimited(MAX_BODY_BYTES) } }
                .getOrNull()
            val text = bodyBytes?.let { String(it, Charsets.UTF_8) }
            val json = text?.let { parseJsonOrNull(it) }
            val locationHeader = live.header("Location")
            val resolved = if (locationHeader != null) {
                request.url.resolve(locationHeader)?.toString() ?: locationHeader
            } else {
                null
            }
            val setCookieHeaders = live.headers("Set-Cookie")
            val cookiePairs = CookieExtractor.parse(setCookieHeaders)
            val blocked = NetworkAccess.isBlocked(live.code, text)

            Diag.request(
                stage = stage,
                method = request.method,
                url = request.url,
                status = live.code,
                elapsedMs = elapsed,
                serviceCode = json?.opt("code")?.toString(),
                blocked = blocked
            )

            if (blocked) {
                // Every documented SCUT answer is JSON; this one is the school's
                // own "connect from campus or use the SSL VPN" page, which no
                // caller can act on and which must not be kept or forwarded.
                throw ScutException(
                    AppError.CAMPUS_NETWORK_REQUIRED,
                    AppError.CAMPUS_NETWORK_REQUIRED.human(),
                    "$stage/${live.code}"
                )
            }

            return ScutResponse(
                stage = stage,
                status = live.code,
                json = json,
                rawLength = text?.length ?: 0,
                location = if (live.code in 300..399) resolved else null,
                cookieNames = cookiePairs.keys.sorted(),
                cookiePairs = cookiePairs,
                blockedByNetworkPolicy = blocked
            )
        }
    }

    private fun parseJsonOrNull(text: String): JSONObject? {
        val trimmed = text.trim()
        if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null
        return try {
            JSONObject(trimmed)
        } catch (_: org.json.JSONException) {
            null
        }
    }

    private fun java.io.InputStream.readBytesLimited(limit: Int): ByteArray? {
        val out = java.io.ByteArrayOutputStream(8 * 1024)
        val buffer = ByteArray(8 * 1024)
        var total = 0
        while (true) {
            val read = read(buffer)
            if (read < 0) break
            total += read
            if (total > limit) return null
            out.write(buffer, 0, read)
        }
        return out.toByteArray()
    }
}
