package cn.scut.bombax.scut.auth

import cn.scut.bombax.scut.AppError
import cn.scut.bombax.scut.ScutEndpoints
import cn.scut.bombax.scut.ScutException
import cn.scut.bombax.scut.Stages
import cn.scut.bombax.scut.network.ScutHttp
import okhttp3.Request
import org.json.JSONObject

data class CaptchaChallenge(val key: String, val image: String)

/**
 * Captcha response parsing (`{"key":"...","image":"data:image/png;base64,..."}`).
 *
 * The image is shown to the user as-is and solved by the user. There is no OCR
 * anywhere in this project.
 */
object CaptchaParser {
    const val PNG_DATA_PREFIX = "data:image/png;base64,"

    fun normalizeImage(raw: String): String {
        val trimmed = raw.trim()
        return when {
            trimmed.startsWith("data:") -> trimmed
            else -> PNG_DATA_PREFIX + trimmed
        }
    }

    /** Returns null when the shape does not match the documented response. */
    fun parse(json: JSONObject?): CaptchaChallenge? {
        if (json == null) return null
        val key = json.optString("key").trim()
        val image = json.optString("image").trim()
        if (key.isEmpty() || image.isEmpty()) return null
        return CaptchaChallenge(key, normalizeImage(image))
    }
}

class CaptchaService(private val http: ScutHttp) {

    fun fetch(): CaptchaChallenge {
        val url = ScutEndpoints.cardUrl(ScutEndpoints.CAPTCHA_PATH)
            .newBuilder()
            .addQueryParameter("synAccessSource", "h5")
            .build()

        val response = http.send(Stages.CAPTCHA, Request.Builder().url(url).get().build())
        if (response.status != 200) {
            throw ScutException(
                AppError.UPSTREAM_UNAVAILABLE,
                "验证码服务暂不可用",
                "${Stages.CAPTCHA}/${response.status}"
            )
        }
        val challenge = CaptchaParser.parse(response.json)
            ?: throw ScutException(
                AppError.PROTOCOL_CHANGED,
                "验证码响应结构已变化",
                "${Stages.CAPTCHA}/${response.status}"
            )
        return challenge
    }
}
