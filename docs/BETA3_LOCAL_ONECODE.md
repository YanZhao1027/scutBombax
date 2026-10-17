# Android 2.0 Beta.3 · 免登录活动票夹与一码通截图恢复

**开发范围：独立虚构数据 Stage** `https://activity-stage.10273055.xyz/`。本分支不授权真实学生资料收集；不改变学校水电/一卡通登录态、不新建“花工木棉用户”账号。

## 用户路径

1. 进入 App 的「活动速签」后直接看到平台活动列表（实际由 Stage HTTPS 服务端提供），学生报名不需要登录。
2. 首次报名后服务器签发单个固定 `bqx_` 一码通，网页显示 SVG，**务必立即截图单独保存**。扫码员必须登录，审核通过且活动时间允许才可核销一次。
3. 活动站在已经过服务器验证的报名页面调用受限 Android 原生接口。原生从**本站活动 Cookie** 读取该活动的一码通凭证，经 Android Keystore 的 **AES-256-GCM** 加密后写入 App **私有 filesDir**；连活动标题、上次状态、签到标记也共同加密。
4. App 原生标题下「我的活动（本机加密票夹）」可**离线查看上次同步的标题及状态**，点击需联网查验：原生恢复该活动的 `HttpOnly; Secure; SameSite=Strict; Path=/api` Cookie，页面携带**非秘密** `#event=<UUID>` 进入，再由服务端验证真实状态。本机状态不是核销依据。
5. 活动站内的「本机已经参与的活动」通过严格的原生消息接口列出**不含原始令牌**的概要；用户可以重新联网验证或仅在本机删除副本。
6. 用户所说的“清除应用数据缓存”在本产品中按 Android 系统设置里的 **清除应用数据/清除存储**（包含本地记录与相关缓存）理解：**本机 AES-GCM 票夹和相关 Cookie 都会丢失**，卸载或丢失 Keystore 密钥也一样。单纯的临时缓存目录 `cacheDir` 与清除整个应用数据不同，但**不能把本机保存当作唯一备份**；务必独立保存一码通截图，换设备后联网查证再恢复。
7. 新手机没有原生保险箱时，用户可通过网页版或 App「从照片恢复旧的一码通」选取 PNG/JPEG/WebP 二维码截图：二维码**只在本机解码**，只把解码的原始 `bqx_` 凭证经同源 HTTPS POST 发送 `/api/pass/restore`；再 GET 对应报名**确认服务器认可**才刷新状态，并在新 App 重新加密本机保存。没有截图又无旧设备时**不能仅凭学号找回**。

## 安全边界

- Android 原生桥使用 `androidx.webkit.WebViewCompat.addWebMessageListener`，只为 Stage 精确 HTTPS origin 注入 `BombaxNativeVault`，**再次检查 isMainFrame=true、确切的源 origin 与主框架 URL**；不使用可被跨源 iframe 调用的 `addJavascriptInterface`。Showcase、学校账单主 WebView、外站一律没有此接口。
- 仅允许四项消息：`save`（原生从 scoped Cookie 读取已签发凭证）、`list`（返回无令牌概要）、`restore`（原生写 HttpOnly Cookie，不把令牌交给 JavaScript）、`forget`（删除私有副本并清理指定活动 Cookie）。
- 原生消息不会读取学校电费登录 Cookie，不复用校园登录 KeyStore 别名；`ActivityPassRules` 只接受本服务的 UUID / `bqx_` 256-bit 凭证，拒绝重复同名 Cookie。
- AndroidKeyStore 不导出密钥，密文由 `AtomicFile` 整体安全更新，`android:allowBackup=false` 不备份本地保险箱。**WebView 原有的 HttpOnly Cookie 仍由系统 CookieManager 单独管理**，本方案没有证明系统 WebView Cookie 数据库本身也是 AES-GCM 加密。
- 二维码截图的原始文件**并不因 App 保险箱而自动加密**：建议学生用设备内相册安全保存、不公开转发、遗失后联系主办方。持码者可能操作该报名，现场仍须工作人员核对本人。
- 测试站只允许 `TEST-` 虚构学号和内置模拟照片，不代表真实学生身份认证。尚未实现遗失挂失、主办方凭证撤销/重签发、法定保留期自动删除及 500 人现场压测。**禁止据此开通真实报名**。

## 构建与验收

以 PR 的干净 worktree 执行 `pnpm install --frozen-lockfile`、`pnpm check:privacy`、`pnpm test`、`pnpm build`、`pnpm exec cap sync android`，然后 `cd android && ../scripts/with-jdk.sh ./gradlew testDebugUnitTest assembleDebug`。

不执行 `adb shell pm clear` 或卸载，因为那会删除已有测试凭证。Debug Beta 使用独立包 `cn.scut.bombax.beta`；Beta.3 versionCode `2000003` 可覆盖旧 Beta.2，并与正式包共存。真机验证必须包括：首次报名自动入保险箱、离线标题/状态、重开恢复、导入截图后的跨设备有效性核验、无效码拒绝、普通缓存和清除应用数据语义说明。

**上线标记必须区分**：代码 / 单元测试、Stage HTTPS、Android 实机 UI 验收。此方案不要求 Apple / Harmony / iOS 平台同时完成。

## 离线展示原一码通（Beta.3 增补）

- 原生「我的活动（本机加密票夹）」选择活动后提供两个操作：**离线出示一码通**与**联网核验当前状态**。
- 离线二维码由 Android 原生 ZXing Core 在内存中从解密后的一码通生成，格式与网页原码完全一致：`https://activity-stage.10273055.xyz/#pass=bqx_...`。不会向 WebView 的 JavaScript 返回明文令牌，也不会保存公开文件或上传相册。
- 即使网络断开，已经保存且未到本机暂定有效期的一码通仍可显示；**这只证明本机持有当初保存的凭证，不证明当前审核、撤销、现场签到状态**。扫码员仍需联网核验并当面核对身份。
- 本地一律建议自行截图备份。截屏留在相册后不受 App 加密票夹保护，需要避免公开传播。离线二维码不可用于绕过已过期或已撤销的服务端有效期判断。
