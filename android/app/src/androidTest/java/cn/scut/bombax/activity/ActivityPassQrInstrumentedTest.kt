package cn.scut.bombax.activity

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.zxing.BinaryBitmap
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/** Device-only QR rendering and scanning: fake pass, no stored real receipts. */
@RunWith(AndroidJUnit4::class)
class ActivityPassQrInstrumentedTest {
    @Test fun encryptedLocalPassCanBecomeAReadableOfflineQr() {
        val receipt = "bqx_" + "a1".repeat(32)
        val side = 720
        val bitmap = ActivityPassQr.bitmap(receipt, side)
        val pixels = IntArray(side * side)
        bitmap.getPixels(pixels, 0, side, 0, 0, side, side)
        val source = RGBLuminanceSource(side, side, pixels)
        val read = QRCodeReader().decode(BinaryBitmap(HybridBinarizer(source)))
        assertEquals(ActivityPassQr.uri(receipt), read.text)
        bitmap.recycle()
    }
}
