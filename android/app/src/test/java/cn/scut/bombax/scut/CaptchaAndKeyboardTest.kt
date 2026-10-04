package cn.scut.bombax.scut

import cn.scut.bombax.scut.auth.CaptchaParser
import cn.scut.bombax.scut.auth.SecureKeyboardEncoder
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CaptchaAndKeyboardTest {

    @Test
    fun `parses the documented captcha shape`() {
        val json = JSONObject(
            """{"key":"abc123","image":"data:image/png;base64,iVBORw0KGgo="}"""
        )
        val challenge = CaptchaParser.parse(json)!!
        assertEquals("abc123", challenge.key)
        assertEquals("data:image/png;base64,iVBORw0KGgo=", challenge.image)
    }

    @Test
    fun `adds a data url prefix when the image is bare base64`() {
        val json = JSONObject("""{"key":"k","image":"iVBORw0KGgo="}""")
        val challenge = CaptchaParser.parse(json)!!
        assertEquals("data:image/png;base64,iVBORw0KGgo=", challenge.image)
    }

    @Test
    fun `rejects captcha payloads that are missing a part`() {
        assertNull(CaptchaParser.parse(JSONObject("""{"key":"k"}""")))
        assertNull(CaptchaParser.parse(JSONObject("""{"image":"x"}""")))
        assertNull(CaptchaParser.parse(JSONObject("""{"key":"","image":"x"}""")))
        assertNull(CaptchaParser.parse(null))
    }

    @Test
    fun `maps each digit through the keyboard layout`() {
        // Layout used by the old implementation's tests: position N holds the
        // glyph SCUT expects for digit N.
        val keyboard = "0123456789"
        assertEquals(
            "12345" + SecureKeyboardEncoder.SEPARATOR + "uuid-1",
            SecureKeyboardEncoder.encode("12345", keyboard, "uuid-1")
        )
    }

    @Test
    fun `uses the shuffled layout rather than the typed digit`() {
        val keyboard = "9876543210"
        assertEquals(
            "876" + SecureKeyboardEncoder.SEPARATOR + "u",
            SecureKeyboardEncoder.encode("123", keyboard, "u")
        )
    }

    @Test
    fun `refuses non numeric passwords instead of truncating`() {
        assertNull(SecureKeyboardEncoder.encode("12a45", "0123456789", "u"))
        assertNull(SecureKeyboardEncoder.encode("", "0123456789", "u"))
        assertNull(SecureKeyboardEncoder.encode("123", "", "u"))
        assertNull(SecureKeyboardEncoder.encode("123", "0123456789", ""))
    }

    @Test
    fun `refuses digits outside the layout`() {
        assertNull(SecureKeyboardEncoder.encode("19", "012345", "u"))
    }

    @Test
    fun `parses the keyboard payload`() {
        val json = JSONObject("""{"data":{"numberKeyboard":"5432109876","uuid":"k-9"}}""")
        val keyboard = SecureKeyboardEncoder.parse(json)!!
        assertEquals("5432109876", keyboard.numberKeyboard)
        assertEquals("k-9", keyboard.uuid)
    }

    @Test
    fun `rejects a keyboard payload without data`() {
        assertNull(SecureKeyboardEncoder.parse(JSONObject("""{"data":{}}""")))
        assertNull(SecureKeyboardEncoder.parse(JSONObject("""{}""")))
    }
}
