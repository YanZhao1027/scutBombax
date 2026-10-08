# SCUT Bombax 技术难点全记录

这份文档把整个项目里真正卡过我们、并且最后被解决（或被明确判定为"不做"）的技术难点集中列出，
每条都写清：**症状 → 为什么难 → 怎么定位 → 怎么解决 → 拿什么证明**。它不替代
[`PROTOCOL.md`](PROTOCOL.md)（协议事实与证据分级）、[`DEVICE_VERIFICATION.md`](DEVICE_VERIFICATION.md)
（逐节设备记录）、[`ARCHITECTURE.md`](ARCHITECTURE.md)（设计取舍）和
[`HANDOFF.md`](HANDOFF.md)（决策清单），只是把它们按"难点"这个维度重新串一遍，方便回头看。

时间跨度：2026-10-04 → 2026-10-08。平台：Ubuntu 24.04 + 命令行工具链，无 Android Studio；
协议验证全部在真机（Android 14 / API 34，arm64-v8a）上完成。

当前状态：114 条 JVM 单测 + 17 条 vitest 全绿；debug 与 release 两种包都能构建；
release 包已用用户自有密钥签名并通过 `apksigner` 校验（尚未真机安装）。

---

## A. 架构前提：为什么必须原生网络

### A1. WebView 直连被 CORS 挡死

- **症状**：浏览器/WebView 里 `fetch()` 学校接口，上游返回 200，但 JS 读不到响应体，
  响应头里没有 `Access-Control-Allow-Origin`。
- **为什么难**：它看起来像"接口坏了"，实际是跨源策略；而且 Cloudflare Worker 中转那条路
  直接 403，容易被当成"需要找一个能用的代理"，从而走向项目明令禁止的方向。
- **定位**：同一请求三组对照 —— 本机直连 200、Worker 403、浏览器 200 但 CORS 阻断。
  结论是网络可达、策略不允许，与代理无关。
- **解决**：固定分层 `WebView → Capacitor 插件 → Kotlin → OkHttp → SCUT`，
  WebView 只做展示，`src/bridge.ts` 是唯一 JS 出口，且该文件里不允许出现对学校域名的 `fetch`。
  Capacitor 配置 `androidScheme: 'https'`、`cleartext: false`、`allowMixedContent: false`。
- **证据**：`PROTOCOL.md` "Network feasibility already tested"；错误分类测试
  `LoginClassificationTest`；设备上一次原生错误完整走到屏幕上（§1）。

### A2. 学校按**源地址**拒绝：403 且响应体会回显你的公网 IP

- **症状**：真机在校外网络时，一卡通主机对 `curl` 和 OkHttp 一律 403，IPv4/IPv6 都一样。
- **为什么难**：403 出现在每个阶段，容易被归类成"上游挂了"或"我们请求写错了"，
  从而去改本来正确的请求；更麻烦的是那个拦截页里**印着调用方公网 IP**，
  一旦原样进日志或界面，就把用户身份位置写进了记录。
- **解决**：在 `ScutHttp.send` 里唯一一处由网络层自己完成的分类 ——
  识别到拦截页就抛 `CAMPUS_NETWORK_REQUIRED`，**丢弃响应体**，日志只记 `blocked=campus-network-only`。
  官方允许的校外路径只有学校 SSL VPN，由用户在手机上完成。
- **约束**：AGENTS.md 禁止加代理/WAF 绕过，应用里也不提供相关设置项。
- **证据**：`PROTOCOL.md` §"2026-10-05 on-device"，截图 `phone-403.png`，
  单测 `NetworkAccessTest`。

---

## B. 登录协议：本项目代价最高的部分

登录连续失败多天，最后发现是**两个各自独立的客户端 bug**，任何一个单独存在都会得到
与"密码错误"完全相同的响应。累计消耗了约 11 次真实尝试（学校用 `error_times` cookie 记失败次数，
有锁定风险），这也是后面所有流程都强调"每个假设只允许一次真实尝试"的原因。

### B1. 安全键盘不是"输入提示"，而是每会话替换密码

- **症状**：按官方组件的字面读法提交密码，永远 `code=8000`。
- **两次误读**：
  1. 以为提交的就是瓦片上的字符（原样）→ 错；
  2. 以为只有数字参与替换、字母原样 → 也错（而且会拒绝合法的字母数字混合密码）。
- **为什么难**：响应里的四个 token 串是**每会话随机**的，瓦片**布局却是固定的**；
  只读压缩后的 JS 很容易把"展示顺序"和"提交值"读反。
- **定位方式（关键）**：不再靠推理，改用**服务端自己的瓦片图片**定案 ——
  `/berserker-secure/keyboard` 的 `data.*Image` 每格一张 PNG，**零凭据**请求即可拿到，
  把 91 张瓦片解码出来就得到真实布局：数字 `0..9`、大小写按 **QWERTY 顺序**（不是字母表序）、
  符号行 29 个字符。官方组件的 `click()` 也印证方向：点第 e 格发出 `numberKeyboard[e]`。
- **解决**：`SecureKeyboard` 保存四行固定布局并提供 `tokenFor(char)`；
  `SecureKeyboardEncoder.encode()` 把**每个**字符按所在行映射，再追加 `"$1$" + uuid`。
  四行布局与两次错误都写成了 `CaptchaAndKeyboardTest` 里的断言，防止"反向修好"。
- **证据**：`PROTOCOL.md` "Secure keyboard"，四张瓦片条 `kb-tiles-*.png`（含 sha256），
  最终 200 登录（§4）。

### B2. `logintype` 是凭据的一部分，而我们把它写死成了 `card`

- **症状**：编码修对之后仍然 `8000`。
- **为什么难**：`card`（账号登录）和 `sno`（学工号登录）是**两个不同的账号命名空间**，
  用错命名空间得到的错误码和"密码错"一模一样，没有任何信号区分。写死的默认值来自旧 `cf-web` worker。
- **定位**：零凭据的 `GET /berserker-app/frontInfo` 直接列出学校开放的登录类型
  （`card` / `sno`，两者 `encryption:"keyboard"`、`openCaptcha:"1"`，另有 `sso`）；
  再问用户官方页面上成功登录用的是哪种 —— 答"学工号登陆"。
- **解决**：`LoginType` 枚举 + 登录界面选择器（默认学工号）+ 原生层对未知值**拒绝而不是猜**
  （`INVALID_INPUT`，detail `login/loginType`）；刷新时回放当初拿到 token 的那个类型。
  `LoginFormTest` 钉住字段。
- **证据**：`PROTOCOL.md` 证据表中该行为 **RUNTIME_VERIFIED 2026-10-06**：`sno` 登录成功，`card` 从未成功。

### B3. 验证码校验**先于**凭据校验

- **症状**：换一张验证码再填，行为看起来自相矛盾。
- **定位**：用"过期验证码 + 其他都正确"的请求观察返回 `8002`，再用新鲜验证码观察 `8000` ——
  顺序即证明：请求体里带验证码字段时先校验验证码；不带验证码字段才直接进凭据校验。
- **意义**：`8002` **不能**被解读成"密码对了"。之前我曾据 `8002` 宣布"凭据校验通过"，
  这个结论被随后两次新鲜验证码仍返回 `8000` 直接推翻 —— 记录在此作为方法教训。
- **解决**：分类器把 `8002`/`8003` 一律按验证码问题处理并换图，绝不当作凭据信号。
- **证据**：`PROTOCOL.md` "Which check runs first"；`logcat-2026-10-06T2238-bombax-attempt.txt`
  （同一会话内 stale→`8002`、fresh→`8000`）。

### B4. 字段拼写与"不要猜名字"

- `loginFrom`（不是 `loginForm`）、`captcha_header_code` / `captcha_header_key` 这些名字
  全部来自学校自己发布的 `/plat/js/*` 包，属于 `SOURCE_VERIFIED`，而不是从生态惯例里猜。
- 归档方式：这些第三方压缩代码**不进仓库**，只放在仓库外 `evidence/client/` 并列 sha256
  （AGENTS.md 不允许 vendor 第三方代码）。

---

## C. 会话、令牌与持久化

### C1. `expires_in` 的单位与 70 天

- **症状/风险**：把 `6048000` 当成"约 2 小时"或当成毫秒，会做出完全错误的刷新策略。
- **事实**：单位是**秒**，`6048000s` = 70 天；登录后 2 秒界面显示 `token 剩余 6047998s`。
- **影响**：这条事实直接推翻了"需要后台保活"的需求前提，也是后来敢于把后台节奏定为
  "一天一次"的底气。

### C2. refresh_token 下发了，但学校不接受该 grant

- **症状**：`grant_type=refresh_token` 用真 token 得到 HTTP 500。
- **为什么难**：500 看起来像服务端故障，容易反复重试（而 AGENTS.md 明令不得高频重试）。
- **定位（零凭据差分）**：用**假 token** 打同一接口 → HTTP 401
  `Cannot convert access token to JSON`；再核对学校自己的客户端**从不发送**该 grant。
  两者合起来说明：不是我们请求写得不好，是这个 grant 不被支持。
- **解决**：失败即要求重新登录，**绝不自动回放存储的密码**（应用本来也不存密码）。
  刷新逻辑保留但按"不支持"设计，前台定时器只做重新查询，不调 grant。
- **证据**：`PROTOCOL.md` "Refresh token"、`DEVICE_VERIFICATION.md` §5。

### C3. Keystore 持久化的两个真实坑

需求：token 有效 70 天，但进程一死就要重打账号+密码+验证码。用户 2026-10-07 决定持久化。

- **坑一：`NoSuchAlgorithmException: Provider AndroidKeyStore does not provide AES/GCM/NoPadding`**。
  密钥必须来自 `AndroidKeyStore` provider，但 **Cipher 要用平台 provider** 去取。
  曾按"密钥和 Cipher 同一个 provider"的直觉写，直接抛异常。
- **坑二：密文打包长度 off-by-one**（`ArrayIndexOutOfBoundsException`）。
  blob 结构是 `[版本字节 1][iv 长度][iv][密文+tag]`，需要 `1 + iv.size + body.size`；
  最初按 `iv.size + body.size` 分配。现在由 `CipherBlob.pack/unpack` 统一实现，
  **生产代码与单测共用同一段**，避免测试自证。
- **其他约束**：文件放 `noBackupFilesDir`（同时 `allowBackup=false`），
  密钥不可导出，因此文件被拷走也只是没有钥匙的密文；
  `SessionCodec` 显式列字段（不用反射序列化），并有测试钉死键集合，
  保证将来新增字段不会悄悄把密码写进去；`loginType` 缺失的记录直接拒绝恢复。
- **一个行为陷阱**：Activity `onDestroy` 里调 `clear()` 会**把刚写的文件删掉**，
  于是"按返回键 = 退出登录"。拆成 `dropMemory()`（只清内存，保留磁盘）与 `clear()`（两者都清，
  由"退出/清除登录状态"调用）。
- **证据**：`SessionPersistenceTest`（11 条，用 JDK 真 AES/GCM 密码器 + 假密钥库替代）；
  设备 §9：写入 → force-stop → `result=restored` → 正常查询；退出后两份都没了。

### C4. DFYC 会话短命，而且用 **302** 表达"会话没了"

- **症状**：登录成功后第二次查询报 `dxc.authorize 期望 302，实际 200`；
  另一段时间之后表现为界面"上游暂不可用"。
- **两条独立事实**：
  1. **SSO 链是单用的** —— 带着还活着的 DFYC 会话重走链，会在 `thirdLogin` 处短路，
     导致 `authorize` 返回 200（而不是 302）。解法：保存并复用 `dxcJsession`，
     正常刷新只发 3 个余额请求（原来 7 个），只有余额读被拒时才重建链。
  2. **DFYC 会话几十分钟就过期**（一次实测约 49 分钟），而 JSON 接口用 **302** 重定向到登录页
     来表达这一点，不是 401/403。把 302 当"上游不可用"是分类错误。
- **解决**：`DxcSession.isStale(status)`（3xx/401/403）+ 一次重建 + 一次重试，
  失败才要求重新登录；`DxcParser.landsOnIndex()` 识别"其实已经在站内"。
- **证据**：`DEVICE_VERIFICATION.md` §7、§8（20:02 与 20:19 两次记录），`BillingParserTest`。

---

## D. 前端调度：与 OEM 省电策略的正面冲突

### D1. 隐藏 WebView 的定时器根本不触发

- **测量**：常驻通知开着、自动刷新设 5 分钟、应用退到桌面，观察 7 分 42 秒 →
  **0 条应用日志，一次查询都没有**。
- **意义**：这推翻了"页面还在，定时器就会跑"的假设，也是后来把时钟搬进原生代码的依据。

### D2. 反向问题：冻结/解冻抖动造成查询突发

- **症状**：后台 11 秒内打出 4 次完整查询（更早还有一次 7 秒 6 查询，当时被误记成"用户自己点的"）。
- **原因**：OEM freezer 反复让页面在可见/不可见之间翻转，每次都合理地判定"间隔已过，补一次"，
  于是欠账被一次性兑现。
- **解决**：`AutoRefresher` 增加 `MIN_TICK_SPACING_MS = 60_000` 间距地板 ——
  不管来多少定时器、翻转或 resume，60 秒内最多一次；被拒的 tick **等完剩余时间**而不是从
  `lastFinishedAt` 重新排（第一版就是这么写的，对过期时间戳会算出 delay 0 变成忙等，
  被假时钟单测当场抓住）；AGENTS.md 要求网络重试在秒级，所以**只给那一次有界重试开豁免**。
- **证据**：`refresh.test.ts` 17 条（含两条间距地板用例）；§12 复测窗口内 0 条日志。

### D3. "已登录但界面空白"

- **症状**：恢复会话后药丸显示已登录，三张卡却是空的。出现过两次，原因不同：
  校区选择器与会话不一致；以及定时器已挂上但页面自认隐藏所以不触发。
- **解决**：`boot()` 无条件先 `query('restore')`；选择器跟随会话而不是相反；
  prefs 在已登录/未登录两条路径都应用（此前只在有会话时应用，导致退出后选择器回到 HTML 默认值）。

---

## E. 后台能力：两次受控偏离

AGENTS.md 原文禁止后台 Service、WorkManager 和 alarm。用户 2026-10-07 要求常驻通知，
2026-10-08 又要求"每天可以吧"的后台刷新，因此这两条被**记录为授权偏离**（规则原文保留，
偏离写在其后），其余方向仍然禁止：不用 WorkManager、不申请精确闹钟、不开机自启、不存密码、
不做验证码 OCR、服务永不尝试登录。

### E1. 常驻通知本身

- `specialUse` 前台服务类型 + `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` 说明；
  `POST_NOTIFICATIONS` 运行时授权（Android 13+）；通道 `IMPORTANCE_LOW`：静音、不弹头、
  无角标、`VISIBILITY_PRIVATE`。
- 界面开关的状态来自**服务是否真在跑**（`runtime.noticeRunning` 由服务自己在
  `onStartCommand`/`onDestroy` 里写），而不是界面自己记一份 —— 否则会出现"开关是关的，
  通知栏却挂着"或反之。

### E2. 一天一次的闹钟，以及"锚点"决定节奏会不会漂移

- 用 `setAndAllowWhileIdle`（非精确），**不需要** `SCHEDULE_EXACT_ALARM`；
  代价是可能被 Doze 推迟 —— 实测推迟 45 秒，界面因此只承诺"下次约 …"而不给分钟。
- **关键设计**：重挂时锚点用**计划触发时间**而不是实际投递时间。
  若用实际时间，每天被推迟的几十秒会累加，刷新时间一路后移；实测重挂结果为 `86354s`
  （= 24h − 46s），节奏自纠正。
- 过期锚点（重启、被杀、离线数日）走"间距地板后一次性补查"，即 `dueInSec=60`，
  不是立即并发补一串。
- **重装和 force-stop 都会清掉应用的闹钟**（日志里能看到
  `AlarmManager: Package … lost permission to set exact alarms!`），
  所以每次打开应用都重新挂表 —— 这不是保险带，是功能成立的前提。

### E3. Android 12+ 的硬限制：非精确闹钟**不能**拉起前台服务

- **实测**：通知服务活着时 `result=fired start=foreground-service`，请求正常走队列；
  服务没活着时系统直接
  `Background started FGS: Disallowed [uidState: RCVR; code:DENIED]`，
  应用侧 `BackgroundServiceStartNotAllowedException`，连普通 `startService` 兜底也被拒。
- **由此推出的产品约束**（不是实现细节，是行为承诺）：每日刷新必须依附常驻通知；
  关掉通知会同时取消闹钟；页面每次到前台都会把服务补起来。
- 想绕过它需要精确闹钟权限或 WorkManager，两者都被明确放弃，并把限制写进文档而不是藏起来。

### E4. 失败时的显示策略

- 刷新失败**保留上一次的数字**，只在副标题加原因（`刷新失败` / `需在校内网络` / `需重新登录`），
  因为旧数字仍是用户手上最好的估计；只有登录态确实没了才把数字撤掉换成"需要重新登录"。
- 服务不做登录：没有密码，验证码也必须人眼读。

### E5. 共享运行时（结构性难点）

- 后台查询暴露的真正问题不是"怎么定时"，而是**客户端、cookie、session、单线程队列原本都长在
  `ScutApiPlugin` 里**。服务自建一套 = 两套队列 = "最多一个在途请求"变成"最多两个"，
  而这条不变量是关于**学校服务器负载**的，不是关于 UI 的。
- 解决：提出进程级 `ScutRuntime`，插件/服务/接收器共用。两个连带修正：
  Activity 销毁**不再**关闭队列（服务还要用）；Keystore session 的挂载从插件 `load()`
  移到 runtime 初始化，否则闹钟拉起的进程读不到自己的登录态。
- WebView 的 User-Agent 被持久化（只记录"有没有"，从不打印内容），因为所有协议事实都是
  带着这个头验证的，冷启动不该退化成 `okhttp/4.12.0` 这个从未测过的身份。

### E6. 一个"兜底"造成的进程崩溃循环（2026-10-08，v0.2a）

- **症状**：装机后第一次启动（屏幕未亮、经 adb 拉起），恢复查询超时，然后**连两个进程在 1.2 秒内死掉**，
  系统给出 30 分钟的服务重启退避：

```text
12:20:46.482  startForegroundService() not allowed due to mAllowStartForeground false
12:20:46.545  Service.startForeground() not allowed due to mAllowStartForeground false
12:20:46.856  Process cn.scut.bombax (pid 9550) has died: fg  SVC
12:20:46.858  Scheduling restart of crashed service … in 1000ms
12:20:48.706  Process cn.scut.bombax (pid 9900) has died: fg  SVC
12:20:48.707  Scheduling restart of crashed service … in 1800000ms
```

- **为什么难想到**：E3 里那条"`startService` 兜底"看起来是无害的降级。实际上 **`startService` 会成功**
  —— 被拒的是随后的 `startForeground()`。而一个"以前台方式启动却始终没能进入前台"的服务，
  Android 的处理是**判定为崩溃并杀掉宿主进程**，不是静默忽略。
- **修复**：去掉 `startService` 兜底（拒绝就报告 `refused`，什么都不启动）；把 `startForeground()`
  本身包进 `runCatching`，失败时清 `noticeRunning`、记 `result=not-foregrounded` 并 **`stopSelf()`**；
  这种拒绝之后 `onStartCommand` 返回 `START_NOT_STICKY`，不让系统反复重试。
- **诚实状态**：修复后的构建只验证到"允许"那条路径（`Background started FGS: Allowed` →
  `result=shown` → 进程存活）；**拒绝分支尚未再次复现**，目前是从系统日志推断出来的修法，
  今晚 23:00 的投递是第一次真实考验。
- **可迁移的教训**：给"被拒绝"加兜底之前，先确认兜底成功之后系统对**后续状态**的要求是什么。
  前台服务的契约是"五秒内进前台"，任何让它进了 `onStartCommand` 又进不了前台的启动方式，
  都等于给自己埋了一次进程级故障。

---

## F. 构建与工具链（无 Android Studio、无 sudo）

| 难点 | 症状 | 解决 |
| --- | --- | --- |
| 发行版自带 Java 是 JRE 且没有 sudo | Gradle 找不到 `javac` | 免 root 安装 Temurin JDK 21 到 `~/opt/jdk-21.0.12.1+1`，统一经 `scripts/with-jdk.sh` 注入 |
| Gradle 发行版无法自动下载 | 首次 sync 卡死 | 手工播种 `~/.gradle/wrapper/dists/` |
| `build-tools` 目录为空 | 链接资源时报缺工具 | 用命令行 sdkmanager 补齐并校验 |
| **`cap sync` 必须早于 `assembleDebug`** | 装到手机上的包**没有新前端资源**，改动"生效了又没生效" | 固化为 `pnpm android` / `pnpm apk`，顺序写进 README；这个坑踩过两次 |
| `~/.ssh/config` 把 `github.com` 绑到另一把部署密钥 | 报 `The key you are authenticating with has been marked as read only.`，看起来像本仓库权限问题 | 推送固定加 `-F /dev/null -o IdentityAgent=none -i ~/.ssh/scutbombax_deploy`；用 `ssh -T git@github.com` 看问候语判断实际用的是哪把钥匙 |
| GitHub 侧偶发 `remote: fatal error in commit_refs` | 整仓推送失败 | 判定为服务端瞬时问题，重试即过；不本地改历史 |
| APK 字节不可复现 | 同一份源码两次构建 sha 不同 | 明确 sha256 只作"会话标记"，不作内容哈希 |
| release 签名 | 未配置时 `assembleRelease` 静默产出装不上的未签名包 | 密钥/密码不入库（`keystore.properties` + `BOMBAX_KEYSTORE_*` 环境变量，后者优先）；缺哪几项就**点名哪几项**（第一版笼统说"没找到密钥"，而当时密钥是在的、只缺两个密码，会把人带去错的文件） |

---

## G. 安全与隐私工程（把"不泄露"做成机制而不是自觉）

- **唯一日志出口** `Diag`：只允许 host/path、method、HTTP status、耗时、服务码、重定向目标
  host/path；查询串**从不打印**（DXC 链会把 access token 放在里面）；cookie 只打印名字；
  另有 `scrub()` 作为第二道防线（抹掉 token/cookie/password 形态的值和 ≥40 位的不透明串）。
- **绝不记录**：学号/账号、密码及其编码结果、验证码答案、access token、refresh token、
  TGC、locSession、JSESSIONID。
- **跨边界的最小投影**：`SessionPublic` 与 `Bills` 是唯一进 JS 的形状，并有测试断言
  投影里不含任何 token/cookie/学号。
- **TLS 校验保持默认开启**，不加代理与绕过机制。
- **文档与证据不带设备标识符**：证据文件入库前先 grep 序列号 / IPv4 / IPv6 / SSID / BSSID /
  bearer token / cookie 值；含学号的截图直接删除；`dumpsys connectivity` 这类输出
  会同时打印 SSID、BSSID 和 IP，因此只用于当场判断，不作为证据归档。
- **凭据不经过助手**：所有密码输入都由用户在手机上完成；助手侧只接受"成功/失败"，
  并且优先使用**零凭据探针**（`frontInfo`、`/plat/js/*`、键盘瓦片图、假 token 差分）取证。
- **明确拒绝的便利**：存查询密码、端侧 OCR 解验证码（那是在对抗学校故意放置的自动化防护，
  旁边还挂着失败计数）、任何公共代理或 WAF 绕过。

---

## H. 测试策略：把踩过的坑钉住

- 114 条 JVM 单测 + 17 条 vitest，全部可在无设备、无 Android Studio 环境跑。
- 纯逻辑可测的都拆出来测：验证码解析、键盘映射、登录错误分类、token 过期判定、
  cookie 抽取、GZIC/DXC 解析、刷新状态机、每日节奏数学。
- **专门钉住"曾经的错"**：键盘四行布局 + 两种历史误读各一条断言；间距地板的忙等回归；
  `SessionCodec` 键集合固定（防止新字段悄悄持久化敏感信息）。
- 平台不可用部分用**等价实现**而不是放宽全局：JVM 里没有 Android Keystore，
  就用 JDK 真 AES/GCM 密码器 + 临时密钥实现同一个 `SessionCipher` 接口，
  打包/解包逻辑 `CipherBlob` 与生产共用；`Diag.writer` 可替换，避免把
  `unitTests.returnDefaultValues` 打开成全局遮羞布。
- DOM 契约用脚本静态检查（`pnpm check:dom`），因为 `main.ts` 里缺 id 会**在 import 时抛错**、
  白屏而 tsc 看不见。

---

## I. 仍未解决 / 未验证（诚实清单）

| 项 | 状态 |
| --- | --- |
| 后台**成功**刷新一次 | 未验证。§13 里每次后台尝试都撞在校网超时（宿舍 wifi 卡在门户认证：`plat.hf.scut.edu.cn` 不解析、DFYC 443 超时）。机制全通，数字没变过 |
| GZIC 余额语义与单位 | `DEVICE_PENDING`。该账号宿舍是 DXC，用 DXC 房间去查 GZIC 证明不了什么；用户已明确"先不做" |
| `8003` | 学校自己的客户端文档里有，从未观测到；分类器已把 8002/8003 同等处理，无收益不去撞 |
| `TGC` / `locSession` 是否各自必需 | 未知。带着两者链是通的，拆一个是拿学校做实验 |
| 是否存在登出端点 | 未找到，应用只清本地状态，不臆造端点 |
| `error_times` 阈值与锁定时长 | 未文档化也未探测 —— 这正是"每个假设一次真实尝试"上限的理由 |
| 新版 UI 退出登录后的布局 | 未在手机上看（要看到就得退出登录，花一次真实登录） |
| release 签名包真机运行 | 未安装。安装需先卸载 debug 版，会连带删掉 Keystore 加密的登录态 |
| 历史表里真正落进第一行 | 未验证。写行只发生在成功查询之后，而本会话每次查询都死在门户超时；`no_backup/bombax-history.db` 已建、`count(*)=0` 是正确状态（§14.3） |
| §14.2 崩溃修复的拒绝分支 | 未复现。修复是从系统日志推断的，只验证到"允许"路径；今晚 23:00 的投递是第一次真实考验 |
| 闹钟在跨夜被 OEM 杀进程后能否复活 | 未测。已知的复活路径是"下次打开应用重挂" |

---

## J. 如果只保留五条经验

1. **不要读压缩 JS 猜协议，去找服务端自己给你的、零凭据的权威物证。**
   本项目最贵的两个 bug 最后分别由瓦片 PNG 和 `frontInfo` 定案，而两次靠 JS 的推断都错了。
2. **同一个错误码可能来自两个完全不同的原因。** `8000` 既可能是密码错，也可能是账号命名空间错；
   把它们当一种情况处理，就会在死路上反复消耗真实尝试次数。
3. **限制要用差分实验定性，不要靠状态码猜。** refresh grant 是 500 还是 401、
   DFYC 过期是 302 还是 401 —— 一次假值探针就能把"服务坏了"和"我们不被支持"分开。
4. **不变量要跟着架构走，不能靠注释。** "最多一个在途请求"在只有一类调用者时是插件里的一个线程；
   出现第二类调用者（服务）之后，它必须变成进程级共享对象，否则静默失效。
5. **平台限制要写进产品承诺。** 非精确闹钟拉不起前台服务、重装会清闹钟、隐藏 WebView 不跑定时器 ——
   这三条决定了功能"在什么条件下成立"，比任何"已实现"的声明更有用。

