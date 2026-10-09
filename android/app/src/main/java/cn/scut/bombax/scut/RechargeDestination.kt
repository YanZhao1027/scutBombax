package cn.scut.bombax.scut

/**
 * Only the official DXC page, with no account, token, campus session or room in its URL.
 * The external WeChat or browser flow owns authentication and payment end-to-end.
 */
object RechargeDestination {
    const val URL = "https://dfyc.utc.scut.edu.cn/sdms-weixin-pay/newWeixin/index.html"
    const val WECHAT_PACKAGE = "com.tencent.mm"

    fun availableForCampus(campus: String?): Boolean = campus == "DXC"
}
