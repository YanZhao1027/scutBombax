package cn.scut.bombax.activity

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/**
 * Render an original one-code pass completely offline.
 * QR pixels stay in memory; bearer text never enters the webpage.
 */
internal object ActivityPassQr {
    private const val STAGE = "https://activity-stage.10273055.xyz/"
    private val tokenPattern = Regex("^bqx_[0-9a-f]{64}$")

    fun uri(token: String): String {
        require(tokenPattern.matches(token)) { "一码通令牌格式无效" }
        return STAGE + "#pass=" + token
    }

    fun bitmap(token: String, edge: Int = 800): Bitmap {
        require(edge in 256..1200) { "二维码尺寸无效" }
        val matrix = QRCodeWriter().encode(
            uri(token), BarcodeFormat.QR_CODE, edge, edge,
            mapOf(
                EncodeHintType.CHARACTER_SET to "UTF-8",
                EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
                EncodeHintType.MARGIN to 3
            )
        )
        val pixels = IntArray(edge * edge)
        for (y in 0 until edge) for (x in 0 until edge) {
            pixels[y * edge + x] = if (matrix.get(x, y)) Color.BLACK else Color.WHITE
        }
        return Bitmap.createBitmap(pixels, edge, edge, Bitmap.Config.ARGB_8888)
    }
}
