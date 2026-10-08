package cn.scut.bombax.scut

import cn.scut.bombax.scut.billing.DxcParser
import cn.scut.bombax.scut.billing.DxcSession
import cn.scut.bombax.scut.billing.GzicParser
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GzicParserTest {

    private fun feeItem(info: String?, room: String? = "G1-101", code: Int = 200): JSONObject {
        val showData = if (info == null) "{}" else """{"信息":${JSONObject.quote(info)}}"""
        val data = if (room == null) "{}" else """{"room":${JSONObject.quote(room)}}"""
        return JSONObject(
            """{"code":$code,"msg":"success","map":{"showData":$showData,"data":$data}}"""
        )
    }

    @Test
    fun `reads the three fee items and the room`() {
        val reading = GzicParser.parse(
            electric = feeItem("当前电表剩余金额 35.60 元"),
            ac = feeItem("空调剩余 8.5 元"),
            water = feeItem("水表读数, 剩余水量 12.34 吨"),
            now = 1_730_000_000_000L
        )
        assertEquals("GZIC", reading.campus)
        assertEquals("G1-101", reading.room)
        assertEquals(35.60, reading.electric!!, 1e-9)
        assertEquals(8.5, reading.ac!!, 1e-9)
        assertEquals(12.34, reading.water!!, 1e-9)
        assertEquals("水表读数, 剩余水量 12.34 吨", reading.waterText)
        assertEquals(1_730_000_000_000L, reading.updatedAtMillis)
    }

    @Test
    fun `water uses the last comma separated segment`() {
        // The old implementation did `信息.split(',').pop()` for the water item
        // because the school prefixes the sentence with a label list.
        assertEquals(7.5, GzicParser.parseAmount("充值记录, 余额 7.50 元", true)!!, 1e-9)
        assertEquals(7.5, GzicParser.parseAmount("1.0 元, 余额 7.50 元", true)!!, 1e-9)
        // Without takeLast the first number in the whole sentence wins.
        assertEquals(1.0, GzicParser.parseAmount("1.0 元, 余额 7.50 元", false)!!, 1e-9)
    }

    @Test
    fun `negative and decimal amounts survive`() {
        assertEquals(-3.25, GzicParser.parseAmount("欠费 -3.25 元", false)!!, 1e-9)
        assertEquals(0.0, GzicParser.parseAmount("余额 0 元", false)!!, 1e-9)
    }

    @Test
    fun `no number in the text is unparseable rather than zero`() {
        assertNull(GzicParser.parseAmount("暂无数据", false))
        assertNull(GzicParser.parseAmount("", false))
        assertNull(GzicParser.parseAmount(null, false))
    }

    @Test
    fun `a non 200 service code is a protocol change`() {
        var caught: ScutException? = null
        try {
            GzicParser.parse(feeItem("x", code = 500), feeItem("y"), feeItem("z"), 0L)
        } catch (failure: ScutException) {
            caught = failure
        }
        assertEquals(AppError.PROTOCOL_CHANGED, caught?.error)
        assertTrue(caught?.detail?.contains("code=500") == true)
    }

    @Test
    fun `a missing map block is a protocol change`() {
        var caught: ScutException? = null
        try {
            GzicParser.parse(JSONObject("""{"code":200}"""), feeItem("y"), feeItem("z"), 0L)
        } catch (failure: ScutException) {
            caught = failure
        }
        assertEquals(AppError.PROTOCOL_CHANGED, caught?.error)
    }

    @Test
    fun `a missing room is a protocol change`() {
        var caught: ScutException? = null
        try {
            GzicParser.parse(feeItem("x", room = null), feeItem("y"), feeItem("z"), 0L)
        } catch (failure: ScutException) {
            caught = failure
        }
        assertEquals(AppError.PROTOCOL_CHANGED, caught?.error)
    }

    @Test
    fun `exposes the raw upstream wording for unit verification`() {
        val reading = GzicParser.parse(
            feeItem("电表剩余金额 1 元"),
            feeItem("空调 2 元"),
            feeItem("水, 3 元"),
            0L
        )
        assertEquals("电表剩余金额 1 元", reading.electricText)
        assertEquals("空调 2 元", reading.acText)
        assertEquals("水, 3 元", reading.waterText)
    }
}

class DxcParserTest {

    private val base = "https://ecardwxnew.scut.edu.cn/berserker-base/redirect".toHttpUrl()

    @Test
    fun `status code is the string the school returns`() {
        assertTrue(DxcParser.isOk(JSONObject("""{"statusCode":"200"}""")))
        assertEquals("500", DxcParser.statusCode(JSONObject("""{"statusCode":500}""")))
        assertNull(DxcParser.statusCode(JSONObject("""{}""")))
    }

    @Test
    fun `room and money come out of resultObject`() {
        val userInfo = JSONObject("""{"statusCode":"200","resultObject":{"roomName":"九栋 302"}}""")
        assertEquals("九栋 302", DxcParser.roomName(userInfo))
        val ammeter = JSONObject("""{"statusCode":"200","resultObject":{"leftMoney":"128.5"}}""")
        assertEquals(128.5, DxcParser.money(ammeter)!!, 1e-9)
        val numeric = JSONObject("""{"statusCode":"200","resultObject":{"leftMoney":7}}""")
        assertEquals(7.0, DxcParser.money(numeric)!!, 1e-9)
    }

    @Test
    fun `money is null when the field is absent or unreadable`() {
        assertNull(DxcParser.money(JSONObject("""{"resultObject":{}}""")))
        assertNull(DxcParser.money(JSONObject("""{"resultObject":{"leftMoney":"abc"}}""")))
        assertNull(DxcParser.money(JSONObject("""{}""")))
    }

    @Test
    fun `resultKeys reports names and never a value`() {
        // This string goes into logcat once per successful query, so the test is the guarantee:
        // a balance, a room or a student number must not be able to ride along with the names.
        val json = JSONObject(
            """{"statusCode":"200","resultObject":{
               "leftMoney":"128.50","roomName":"G9-301","studentNo":"202199999",
               "powerLeft":52.0}}"""
        )
        val keys = DxcParser.resultKeys(json)
        assertEquals("leftMoney,powerLeft,roomName,studentNo", keys)
        assertFalse(keys.contains("128.50"))
        assertFalse(keys.contains("G9-301"))
        assertFalse(keys.contains("202199999"))
    }

    @Test
    fun `resultKeys degrades to none instead of throwing`() {
        assertEquals("none", DxcParser.resultKeys(JSONObject("""{"statusCode":"200"}""")))
        assertEquals("none", DxcParser.resultKeys(JSONObject("""{"resultObject":{}}""")))
    }

    @Test
    fun `a failed dfyc call names the stage only`() {
        var caught: ScutException? = null
        try {
            DxcParser.requireOk(JSONObject("""{"statusCode":"500","message":"内部错误"}"""), "ammeterBalance")
        } catch (failure: ScutException) {
            caught = failure
        }
        assertEquals(AppError.PROTOCOL_CHANGED, caught?.error)
        assertTrue(caught?.detail?.contains("status=500") == true)
        assertTrue(!caught!!.message!!.contains("内部错误"))
    }

    @Test
    fun `relative redirect locations are resolved`() {
        val url = DxcParser.resolveRedirect(
            "/sdms-weixin-pay-sp/newWeixin/index.html",
            base,
            "dxc.getCode"
        )
        assertEquals("/sdms-weixin-pay-sp/newWeixin/index.html", url.encodedPath)
    }

    @Test
    fun `plain http locations are upgraded to https`() {
        val url = DxcParser.resolveRedirect(
            "http://dfyc.utc.scut.edu.cn/sdms-weixin-pay-sp/service/x",
            base,
            "dxc.authorize"
        )
        assertEquals("https", url.scheme)
        assertEquals("dfyc.utc.scut.edu.cn", url.host)
    }

    @Test
    fun `absolute scut locations are accepted`() {
        val url = DxcParser.resolveRedirect(
            "https://ecardwxnew.scut.edu.cn/portal/thirdLogin?code=1",
            base,
            "dxc.redirect"
        )
        assertEquals("/portal/thirdLogin", url.encodedPath)
    }

    @Test
    fun `a location outside the school domain is refused`() {
        for (candidate in listOf(
            "https://evil.example.com/next",
            "https://scut.edu.cn.attacker.net/x",
            "https://notscut.edu.cn/x"
        )) {
            var caught: ScutException? = null
            try {
                DxcParser.resolveRedirect(candidate, base, "dxc.redirect")
            } catch (failure: ScutException) {
                caught = failure
            }
            assertEquals("should refuse $candidate", AppError.PROTOCOL_CHANGED, caught?.error)
        }
    }

    @Test
    fun `missing location is a protocol change`() {
        for (missing in listOf(null, "   ")) {
            var caught: ScutException? = null
            try {
                DxcParser.resolveRedirect(missing, base, "dxc.thirdLogin")
            } catch (failure: ScutException) {
                caught = failure
            }
            assertEquals(AppError.PROTOCOL_CHANGED, caught?.error)
            assertTrue(caught?.detail?.contains("location") == true)
        }
    }

    @Test
    fun `the chain must end on the payment index page`() {
        assertTrue(DxcParser.isIndexPage("/sdms-weixin-pay-sp/newWeixin/index.html", "dxc.getCode"))
        assertTrue(
            DxcParser.isIndexPage(
                "https://dfyc.utc.scut.edu.cn/sdms-weixin-pay-sp/newWeixin/index.html",
                "dxc.getCode"
            )
        )
        var caught: ScutException? = null
        try {
            DxcParser.isIndexPage("/sdms-weixin-pay-sp/other.html", "dxc.getCode")
        } catch (failure: ScutException) {
            caught = failure
        }
        assertEquals(AppError.PROTOCOL_CHANGED, caught?.error)
    }

    @Test
    fun `a DFYC redirect or 401 or 403 means the session died, not that the school is down`() {
        // Observed 2026-10-07 20:02, 49 minutes after login: dxc.userInfo answered 302 and the
        // user was told 上游暂不可用, which is the wrong conclusion.
        assertTrue(DxcSession.isStale(302))
        assertTrue(DxcSession.isStale(301))
        assertTrue(DxcSession.isStale(307))
        assertTrue(DxcSession.isStale(401))
        assertTrue(DxcSession.isStale(403))
        assertFalse(DxcSession.isStale(200))
        assertFalse(DxcSession.isStale(500))   // an outage is not a stale session
        assertFalse(DxcSession.isStale(404))
        assertFalse(DxcSession.isStale(400))
    }

    @Test
    fun `a thirdLogin that lands on the index page means the session is already there`() {
        // Observed on a device on 2026-10-07: walking the chain again while the school still
        // holds the DFYC session redirects to the landing page instead of /oauth/authorize.
        assertTrue(
            DxcParser.landsOnIndex(
                "https://dfyc.utc.scut.edu.cn/sdms-weixin-pay-sp/newWeixin/index.html".toHttpUrl()
            )
        )
        assertTrue(
            DxcParser.landsOnIndex(
                "https://dfyc.utc.scut.edu.cn/sdms-weixin-pay-sp/newWeixin/index.html?x=1".toHttpUrl()
            )
        )
        assertFalse(
            DxcParser.landsOnIndex(
                "https://ecardwxnew.scut.edu.cn/berserker-auth/oauth/authorize?appId=360".toHttpUrl()
            )
        )
        assertFalse(
            DxcParser.landsOnIndex(
                "https://dfyc.utc.scut.edu.cn/sdms-weixin-pay-sp/service/ykt/getCode".toHttpUrl()
            )
        )
    }

    @Test
    fun `message extraction does not leak into the thrown detail`() {
        val json = JSONObject("""{"statusCode":"401","message":"session expired for user 20210001"}""")
        assertEquals("session expired for user 20210001", DxcParser.message(json))
        var caught: ScutException? = null
        try {
            DxcParser.requireOk(json, "userInfo")
        } catch (failure: ScutException) {
            caught = failure
        }
        assertTrue(!caught!!.detail!!.contains("20210001"))
    }
}
