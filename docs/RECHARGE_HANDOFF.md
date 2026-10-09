# 官方充值入口：微信交接与浏览器入口

## 固定入口与保护

- 大学城校区（DXC）：https://dfyc.utc.scut.edu.cn/sdms-weixin-pay/newWeixin/index.html
- 广州国际校区（GZIC）：未经验证，未开放充值跳转。
- URL 常量在 Android 原生 RechargeDestination 中，JS 不会传递目标 URL、账号、宿舍、Cookie、Token 或付款金额。
- 微信入口使用 ACTION_SEND + setPackage("com.tencent.mm") 只发送此公开 URL，不使用未公开的微信内部 Activity。
- 用户需要在微信选择聊天（如文件传输助手），再点击分享的 URL 才能在微信内打开网页。
- 浏览器入口使用 ACTION_VIEW，可能进入学校 CAS 统一认证，不保证有微信身份。
- 点击外部入口不代表已完成认证或付款。Bombax 不监听支付结果，也不主动发起额外余额查询。

## 客户端限制

普通 Android App 没有可靠的公开通用接口，把任意 HTTPS 页面直接放到微信内置浏览器并替用户完成微信 OAuth。商业专用 SDK 需要业务权限及学校配合，不能把官方 URL 当作该 SDK 的授权参数。

如果未来学校提供经核验的小程序 URL Scheme / URL Link 或微信开放平台正式业务能力，可另行集成并在真实微信环境验收；不能靠未公开 Activity、伪造 WeChat User-Agent 或注入 SSO 凭据。

## 2026-10-10 验收

- 主机：TypeScript 及 Vite build 通过；66 Vitest、126 JVM 测试全部通过；隐私守卫与 DOM ID 校验通过。
- 签名 Android release：1.0.1 / code 4，证书不变；adb install -r 成功、设备 base.apk 与构建 APK 的 SHA-256 一致。
- 实测：登录态恢复、历史 source=restore 入库、次日 DAILY Alarm 仍存在。
- DXC 首页：两个充值按钮可用；微信未安装时提示不可用，未自动跳向其他浏览器，进程存活。
- 浏览器按钮：Android 离开 Bombax，完成系统外部 Activity 交接；没有在这轮核验学校最终身份验证和支付页。
- **未验证**：测试机上没有微信 com.tencent.mm，因此微信分享目标是否正常出现、在微信里打开学校链接是否免登录，均未标记成功。需要一台装有微信的手机做真实对照；不输入密码到 Bombax 的充值接口，也不复制支付凭据。

本功能独立于余额查询：按钮本身不会调 getBills()；充值成功之后是否余额增加，仍由用户以后主动查询或原有每日快照读数确认。
