package cn.scut.bombax.scut

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RechargeDestinationTest {
    @Test
    fun approvedDestinationIsFixedAndDoesNotContainUserParameters() {
        assertEquals(
            "https://dfyc.utc.scut.edu.cn/sdms-weixin-pay/newWeixin/index.html",
            RechargeDestination.URL
        )
        assertFalse(RechargeDestination.URL.contains("?"))
        assertEquals("com.tencent.mm", RechargeDestination.WECHAT_PACKAGE)
    }

    @Test
    fun neverTreatsUnverifiedGzicAsDxcRecharge() {
        assertTrue(RechargeDestination.availableForCampus("DXC"))
        assertFalse(RechargeDestination.availableForCampus("GZIC"))
        assertFalse(RechargeDestination.availableForCampus(null))
        assertFalse(RechargeDestination.availableForCampus(""))
    }
}
