package cn.scut.bombax.activity

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ActivityOriginPolicyTest {
    @Test fun acceptsCanonicalPublicAndCampusSmartRedirect() {
        assertTrue(ActivityOriginPolicy.isTrusted(ActivityOriginPolicy.PUBLIC_URL))
        assertTrue(ActivityOriginPolicy.isTrusted("https://activity.10273055.xyz/api/events"))
        assertTrue(ActivityOriginPolicy.isTrusted("https://activity-lan.10273055.xyz:8443/"))
        assertTrue(ActivityOriginPolicy.isTrusted("https://activity-lan.10273055.xyz:8443/__lan/health"))
    }

    @Test fun rejectsStageDemoAndImpostorOrigins() {
        for (url in listOf(
            "https://activity-stage.10273055.xyz/",
            "https://activity-demo.10273055.xyz/",
            "http://activity.10273055.xyz/",
            "https://activity-lan.10273055.xyz/",
            "https://activity-lan.10273055.xyz:443/",
            "https://activity-lan.10273055.xyz:8444/",
            "http://activity-lan.10273055.xyz:8443/",
            "https://activity.10273055.xyz:8443/",
            "https://activity.10273055.xyz.evil.example/",
            "https://activity.10273055.xyz@evil.example/",
            "https://evil.example@activity.10273055.xyz/",
            "https://activity-lan.10273055.xyz:8443.evil.example/",
            "https://xn--something.invalid/"
        )) {
            assertFalse(url, ActivityOriginPolicy.isTrusted(url))
        }
    }
}
