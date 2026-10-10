# 花工木棉 · iOS 原生协议实验（无需开发者会员）

这是独立的 iOS 原生实验分支 feat/ios-native-probe，以 Android v1.0.1 为协议参考，
与现有 feat/ios-pwa、Android main 和 Cloudflare 部署互不干扰。

**当前版本只做无凭据阶段的协议诊断，没有账户登录、付款或余额查询。**
iPhone SE 2 的快捷指令已经分别取得 frontInfo、captcha 和 keyboard 的响应；
接下来由 Swift 自动提取 JSON 字段，而不必人工查看大量图片编码。

## 用 MacBook Air M4 打开工程

要求：Xcode 16 或更新、免费 Apple Account、iPhone SE 2（iOS 16 及更新）。

如果 Mac 上还没有此仓库：

~~~sh
git clone https://github.com/YanZhao1027/scutBombax.git
cd scutBombax
git fetch origin feat/ios-native-probe
git switch --track origin/feat/ios-native-probe
open ios-native/HuaGongMuMianProbe/HuaGongMuMianProbe.xcodeproj
~~~

如果 Mac 上已经有此仓库，进入仓库目录后执行：

~~~sh
git fetch origin feat/ios-native-probe
git switch --track origin/feat/ios-native-probe
open ios-native/HuaGongMuMianProbe/HuaGongMuMianProbe.xcodeproj
~~~

Xcode 打开以后：

1. Xcode 菜单 Settings → Accounts：添加自己的免费 Apple Account。
2. 左侧点击蓝色的 HuaGongMuMianProbe 工程图标，再点 TARGETS → HuaGongMuMianProbe。
3. Signing & Capabilities：勾选 Automatically manage signing，Team 选择 Personal Team。
   如果提示 Bundle Identifier 冲突，可把 xyz.huagongmumian.probe 改为个人唯一后缀。
4. 用 USB 连接 iPhone SE 2，在手机上点信任此电脑。必要时进入
   设置 → 隐私与安全性 → 开发者模式，开启并按提示重启。
5. Xcode 顶部运行目标选择连接的 iPhone，按 ⌘R 进行编译安装。
   第一次安装可能需要在手机设置中信任开发者证书。
6. 打开“花工木棉实验”，点击“运行三项无凭据检查”。

**只需要反馈：** 三项的“通过/待排查”、HTTP 状态与业务码，以及
第三项的“待确认字段”名称。不要发送 key、UUID、键盘令牌、
账号密码或完整学校 JSON。

个人免费签名适合真机实验，不等于可直接分发给其他人的正式 iOS App；
证书或配置文件可能需要约每 7 天重新签名。正式分发另行评估。

## 协议与隐私边界

- 只向 https://ecardwxnew.scut.edu.cn 发送三个无凭据 GET。
- 请求顺序为 frontInfo → captcha → keyboard（同一临时 URLSession 的 CookieJar）。
- URLSessionConfiguration.ephemeral：Cookie 仅在本次内存会话中，不存系统持久化存储。
- 当前 App 不存在登录表单、用户凭据、用户名、Token 上传、任何自建代理或后台定时查询。
- 截图应只包含 HTTP 状态/业务码和字段名，避免泄露即时随机安全键盘数据。
- 图形验证码图片只在 App 内存中显示。随机 key 和 keyboard token 不展示、不存储。
- 校外是否能访问学校接口取决于学校网络策略；如被拒绝，先测试校园 Wi-Fi 或学校官方 SSLVPN。
- GitHub Actions 使用 macOS runner 对 iOS Simulator 进行无签名编译；不能取代实际 iPhone 测试。

## 构建与维护

工程路径：

~~~text
ios-native/HuaGongMuMianProbe/HuaGongMuMianProbe.xcodeproj
~~~

不需要 CocoaPods、第三方 SDK 或付费开发者会员。

Ubuntu 端也可重建确定性的 Xcode 工程元数据（不会进行 Swift 编译）：

~~~sh
python3 ios-native/generate_project.py
~~~

SwiftUI 的功能入口为 ContentView.swift，协议状态检查为 ProbeInspector.swift，
网络边界为 ProbeNetwork.swift。iPhone 验证三个接口结构之后，再考虑是否值得
实现经过人工许可的安全键盘编码与本机登录。之前的 Android 成熟实现可对照：
android/app/src/main/java/cn/scut/bombax/scut/auth/ 。
