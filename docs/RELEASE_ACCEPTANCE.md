# SCUT Bombax Release 0.2.0 真机验收报告

验收日期：2026-10-08 14:32 → 2026-10-09 13:12（北京时间）。
设备：Redmi K50（rubens），Android 14 / API 34，arm64-v8a，USB adb。
验收对象：签名 release 包 `versionCode=2` / `versionName=0.2.0`，PR #1 head `50709fe` 构建。
逐条原始记录在 [`DEVICE_VERIFICATION.md`](DEVICE_VERIFICATION.md) §13–§17.2，本文只做汇总与判级，
不替代原始记录。

证据等级沿用 [`PROTOCOL.md`](PROTOCOL.md) 的定义：
**RUNTIME_VERIFIED**（真机上观测到）> **HOST_TESTED**（主机测试通过、真机未观测）>
**USER_VERIFIED**（用户口头/使用确认，接口本身未声明）> **PENDING**（未做，写明阻塞人）。

---

## 0. 验收对象的身份，今天重新核过一遍

```bash
adb shell pm path cn.scut.bombax
# /data/app/~~8nOK23…==/cn.scut.bombax-XXr7d8…==/base.apk
adb shell sha256sum <上面那个路径>
# 899aaccca1866d80f27cca7fa6b8b814532a2f9614177ed98d7bbbe58e959e79
sha256sum evidence/app-release-2026-10-08T2236-pr1-50709fe.apk
# 899aaccca1866d80f27cca7fa6b8b814532a2f9614177ed98d7bbbe58e959e79   ← 同一份字节

apksigner verify --print-certs <上面那份 APK>
# Signer #1 certificate DN: CN=alyz, OU=scutbombax, O=scut, L=gz, ST=gd, C=cn
# Signer #1 certificate SHA-256 digest: ef607f9df8e7872c9008d6aaf35da6d5ee69db217a97bc7b0f6d191629ff89d4
adb shell dumpsys package cn.scut.bombax | grep -E "versionCode|versionName|flags"
# versionCode=2  versionName=0.2.0  flags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]   ← 无 DEBUGGABLE
```

手机里正在跑的这份 APK 与仓库外存档的那份**字节级一致**，签名证书指纹与 README 记录的正式签名
密钥一致（`ef607f9d…`，与首个 release 包同一把钥匙）。这一点是 RUNTIME_VERIFIED，不是"看元数据像"。

存档位置：`/home/zyubuntu/scutbombax/evidence/`，清单 `sha256-2026-10-09.txt`。

## 0.1 主机侧门禁，写这份报告时重跑了一遍

在 §17.2 之后的那个文档 HEAD（历史整理后为 `89cd718`，树 `13eb1f91…`，内容与整理前逐字节相同）上：

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 干净 |
| `pnpm test` | 55 通过（`refresh` 17 + `trend` 13 + `view` 9 + `snapshot-time` 8 + `check-privacy` 6 + `privacy` 门禁 2） |
| `pnpm check:dom` | `missing ids: none`，CSP 9 条指令 |
| `pnpm check:privacy` | 全仓干净，denylist 1 条；`--selftest` 通过 |
| `./gradlew testDebugUnitTest` | 122 通过，0 失败 0 跳过（12 个类） |

手机上的那份 APK 是 `50709fe` 构建的字节，这些主机测试跑的是同一分支的 HEAD；两者相差只有
文档提交，所以表格里的等级不会因为"测的不是装的那个包"而失真。

---

## 1. 对照批准时列出的 7 条要求

| # | 要求 | 结论 | 等级 | 出处 |
| --- | --- | --- | --- | --- |
| 1 | 暂不做历史导入/导出；切换签名时允许清空 | 按决议执行：代码里没有任何导入/导出功能；卸载 Debug → 安装 Release，会话与历史确实被丢弃 | RUNTIME_VERIFIED | §15 / §15.1 |
| 2 | 确认 Release APK 用已验证的正式签名，`versionCode=2`、`versionName=0.2.0` | 见 §0，今天重新核过，APK 字节与签名指纹都对上 | RUNTIME_VERIFIED | §14.6 / 本文 §0 |
| 3 | 切换前保留脱敏证据与测试报告 | `release-swap-2026-10-08.txt`（含 pristine 一份）留存，明确注明它是**记录**而非还原路径；历史原始行导出为 `history-2026-10-08-first-rows.txt`，只含数值、不含房间号 | RUNTIME_VERIFIED | §15 / `EVIDENCE_INDEX.md` |
| 4 | 首次登录由用户本人完成；禁止记录密码、token、宿舍号 | 凭据侧守住：两次登录（昨日下午、今晨 10:2x）与傍晚那次重登都由用户亲手输入，应用日志与通知内容不含宿舍号。标识符侧**违反过一次**：§17.2 的屏幕转写把宿舍号写进了仓库，现已随历史整理从分支上移除，并补了**机械检查**（§7.3）——见 §4 与 §7 | RUNTIME_VERIFIED（凭据侧）/ 已修正并已被工具钉住的文档失误（标识符侧） | §15.3 / §19 / 本文 §4 / §7 |
| 5 | 装后 5 项检查（登录查询 / 首条快照 / 离线冷启动历史 / 通知状态 / 23:00 闹钟登记） | 5 项全部观测到 | RUNTIME_VERIFIED | §15.3 |
| 6 | 23:00 后台触发：不崩溃；被拒就如实记录；成功则形成一条 nightly 快照；错过不补查 | 23:14:57 投递（`lateSec=897`），全链路成功、写入 `source=daily`、进程未死、重排到次日 23:00:00 且不补查 | RUNTIME_VERIFIED | §17 |
| 7 | 提交严格区分已验证/未验证的验收报告 | 本文；未验证项集中在 §3 | — | — |

---

## 2. 已验证（真机）

**签名与安装路径。** Release 签名原地更新（`adb install -r`，不卸载）会保留 Keystore 会话与历史库：
昨天三次原地重装，每次都 `result=restored` 且无需重新登录。这正是私有签名密钥存在的意义，也是
后续原地升级到 `versionCode=3` 的前提。

**登录与查询。** 用户在 release 包上登录一次即过；`expiresIn=6047594s` ≈ 70 天，与
`expires_in=6048000` 的协议事实吻合。DXC 链路 `dxc.userInfo → ammeterBalance → waterBalance`
返回 200。

**首条快照入库。** `stage=history result=recorded source=restore electric=true water=true ac=false`。
写路径只有一个入口（`BalanceHistoryStore.record`），失败查询不写行——离线冷启动那一次没有新增行。

**离线展示不冒充实时。** 断网（`http_proxy 127.0.0.1:1`，不动 Wi-Fi 关联）冷启动后，屏幕文案为
"显示的是 今天 17:01 的历史记录（当前无法连接校园一卡通），不是实时余额"，通知栏同样保留旧的
真实数字而不是占位符。这是缓存优先规则的正面证据。

**通知权限与常驻通知。** 弹窗 → 允许 → 通知立即张贴，不需要第二次点击（这条是被 §15.3 记录的
权限回调崩溃修复之后才成立的）。MIUI 把 `IMPORTANCE_LOW` 的通知归到下拉底部"静音"分组，屏幕上
看不到不等于没张贴，判定以 `dumpsys notification` 为准。

**每日闹钟登记与自重排。** 17:03:00 开启时 `dueInSec=21419` → 落点恰为 23:00:00（北京），
即"墙钟时刻"而不是"开关后 24 小时"。每次 `force-stop` 之后闹钟仍在。23:14 触发后重新登记的
`origWhen 1791558000000` 距当晚槽位正好 86 400 000 ms——**投递晚了，计划没跟着漂**。

**23:00 自然投递端到端（§17）。** 息屏 Doze、无用户操作：alarm → receiver → service →
`ScutRuntime` → SQLite 全链路走完，`start=foreground-service` 被允许，前提是常驻通知已活着
（§13.3 那条约束的正向确认）；同一进程（22:38 起）处理完投递，`crash` 缓冲区无记录，系统未报
`has died: fg SVC`。UI 文案"系统可能延迟"因此不是免责套话，而是实测下界。

这条只算**一次**端到端成功：它证明链路能通，不证明以后每次都准点、也不证明每次都能在后台成功
执行。Doze 深度、充电状态、Wi-Fi 关联是否在维护窗口里可用，都不在应用控制内；`setAndAllowWhileIdle`
本身就是不精确闹钟。连续多日的投递成功率见 §3。

**一次性验证闹钟（§17.1）。** 用户点"约 5 分钟后测试一次"后：待决测试闹钟被消费、图表摘要
7 → 10 条、最新点 10/9 09:19 ¥22.38、按钮回到空闲标签且 `testPending=false`（只能由
`consumeTest()` 产生）。三个独立信号一致。

**登出与历史解耦（§17.2，本次验收最后一项）。** 13:04:01 用户点退出，日志四行依次为
`notice=removed` / `daily=disabled` / `snapshotTest=cancelled` / `logout=cleared`；系统侧同步确认
`dumpsys alarm` 该软件包**零**待决闹钟、`BalanceNoticeService` 不在服务表、通知记录不再张贴。
与此同时屏幕仍显示 `未登录` + 历史余额 + "显示的是 今天 10:25 的历史记录，不是实时余额" +
`本地历史 · 最近 11 条记录` + 趋势图，会话级控件（刷新 / 常驻通知 / 每日余额快照 / 测试 / 退出）
只剩"登录并查询"。**退出删掉的是排期与通知，不是数据，也不是读数据的能力。**

**五个界面状态里，真机已覆盖三种情形。** 有会话；无会话有历史；以及经由真实"退出"动作到达的
退出后状态（二者同一路径但各自记录）。离线且历史可显示的状态另有 §15.3 的独立证据。

**登录后重开排期，并把上一轮缺的原始日志补齐（18:42–19:09，§19）。** 用户自己重登一次（一次成功），
`stage=history result=recorded source=login` 这一行第一次被抓到——§17.1 当时只能靠旁证推断的行标签，
现在是直接观测。打开常驻通知后 `stage=notice result=shown`、`NotificationRecord id=176 importance=2`
张贴、`ServiceRecord … isForeground=true foregroundId=176`；再开每日快照，`dueInSec=14453` 落在
23:00:00，`dumpsys alarm` 的 `origWhen 1791558000000` 与该时刻**逐毫秒相同**。
"约 5 分钟后测试一次"这一轮的 `fired / ok` 两行也在：19:00:07 登记 `dueInSec=300`，19:08:52 投递
`lateSec=225`，随后 `result=recorded source=test`、`snapshotTest result=ok`，待决测试闹钟被消费。
这一条**迟到但不算失败**：5 分钟是计划下界，不是约定时刻；两个样本（一次准点、一次晚 225 s）合起来
才是"约几分钟内到达"这个说法的依据。

**用户自选时刻真机走通，并顺带验到会话过期自愈（21:20–21:47，§20）。** 用户把每日时刻设成 21:25，
21:20:55 登记 `dueInSec=244`；21:28:03 投递 `lateSec=183`，链路先撞到 `dxc.userInfo 302` →
`stage=dxc result=session-stale`，随后**只重建一次** SSO 链就拿到三个 200，写入 `source=daily`
（第 14 条），通知更新到 21:28，重排后的 `origWhen 1791638700000` 与次日 21:25:00.000 逐毫秒相同。
两个结论各自独立：**改时刻是替换而不是新增**（待决列表里始终只有一条 `DAILY_REFRESH`，不存在旧的
23:00 残留）；**DFYC 会话过期在后台路径上也被正确识别**，这是协议文档里"302 表示会话没了、重建一次"
第一次在真机的每日路径上被观测到，不是在前台点击时。至此自然投递有三个时刻样本：昨晚 23:14（+897 s）、
今晚 21:28（+183 s），定时测试两次（一次准点、一次 +225 s）。

**同时暴露一个显示新鲜度问题（记为待办，不当场改）。** 页面一直开着的时候，后台投递更新了通知和
数据库，却没有更新页面：倒计时仍写着 `下次约 4 分后`，趋势摘要仍是 `最近 13 条记录`——两者在 21:21
之前是对的，到 21:29 已经都错了。21:47 前台刷新一次之后，同一页面变成 `下次约 23 小时 38 分后` 与
`最近 15 条记录`。排期没有任何问题，是"打开中的 WebView 不会被告知"。这属于**展示层的诚实性**缺陷：
屏幕上的话说的是过期的事实，而用户无从分辨，所以要修；但不在验证中途改代码。

---

## 3. 未验证 / 待定（写明缺什么、谁能补）

| 项 | 为什么还没验 | 谁能解除 |
| --- | --- | --- |
| 第 11 条（今晨 10:25）的 source 标签 | release 不可 `run-as`（正确行为），且该行写入时本次日志抓取尚未开始（12:59 起） | 无法回溯，保持未验证 |
| 会话过期状态（`authenticated=false` + 原因串） | 只能等令牌自然过期或人为失效，不制造 | 下次自然发生时记录 |
| 连续多日投递成功率（准点性、后台成功率） | 已有 2 次自然投递（23:14 / +897 s、21:28 / +183 s）与 2 次定时测试（准点、+225 s），全部成功但都是单点，谈不上分布 | 让开关继续开着按天累积；不为此加补查逻辑 |
| 页面在后台投递后不刷新（倒计时与趋势摘要会说过期话） | 现象已在 §20 量到并写清成因；本轮没动代码，因为正在验证的构建不该被中途替换 | 下一轮：状态到达后让可见页面重新读取 `noticeJson` 与历史 |
| `3 小时 60 分` 那个倒计时显示修复的真机效果 | 修复已过主机门禁并重新签名构建（`de8f5584…`，同一把钥匙），但**没有安装**：安装会清掉今晚已登记的 23:00 闹钟 | 随 `versionCode=3` 那一轮一起上机 |
| 无会话且无历史（空态） | 验证它要清空本机唯一一条真实序列 | 明确不在本机做 |
| `source=daily` 行的原始时间戳核对 | 同 `run-as` 限制，靠去标识日志行 + 图表条数间接确认 | 结构上无法在本机加强 |
| GZIC 余额 | 校区不同，需要 GZIC 账号 | 用户 |
| 水费单位、`leftEle/leftFreeEle/leftFreeMoney/elePrice` 语义 | 接口没声明单位；电费"元"是 USER_VERIFIED，不是 API 事实 | 观察积累，见 §5 |

本文档刻意不使用"应该没问题"的表述。上面每一行都对应一个尚未观测的事实。

---

## 4. 禁止记录的东西，怎么证明没记

- 应用日志只有去标识阶段行：`stage=… result=…`，数值以 `electric=true/false` 存在性出现，
  两条 JVM 测试会在房间号、分组键、余额、时间戳任一出现在该行时失败。
- 今天为验收新落的 `logcat-2026-10-09-signout.txt`（4 行）在归档前后各扫一遍，正则覆盖
  楼栋-房间号形状、`password` / `authorization` / `bearer` / `jsessionid` / `cookie` /
  `access_token` / `client_id` / `secret` 以及 UUID 形状，命中数为 0。
  （正则本身不写在这份文档里——把房间号写成"扫描模式"仍然是把它写进仓库。）
- 屏幕证据优先从 `uiautomator` 的可访问性树读取文字，而不是截图：房间号是标识符，不进仓库、
  不进证据文件。历史 PNG 截图只在早期（Debug 阶段）留存，且已归档在仓库外的 `evidence/`。
- **这条规则本轮被我自己违反过一次。** §17.2 记录退出后屏幕时，把可访问性树里的房间号原样
  抄进了 `DEVICE_VERIFICATION.md`，随那两个文档提交推到了远端。处置分两步：先把文件里
  那处换成 `<楼栋-房号>`，再按用户决定把携带它的两个文档提交整理成一个（`89cd718`），整理前后
  **整棵树 SHA 相同**（`13eb1f91…`）——过程见 §7。仓库是公开的，所以这不是形式问题。
- **强推不等于内容消失，这一点是实测而非推测。** 整理后用 `curl` 逐个引用取同一份文件比对：
  被替换提交按其**固定 SHA** 请求仍返回 HTTP 200 且含那处房间号（1 命中）；分支头、整理后的提交、
  `refs/pull/1/merge`、`main` 取到的都是占位符版本。也就是说 PR 的可见引用已经不含该内容，
  残留只剩两条路："按旧 SHA 直接取"和 GitHub 缓存 / 别人已有的克隆。要让前者也失效，需要向
  GitHub Support 申请清理，受理与否由 GitHub 判断。（仓库是公开的这一点由用户指出：公开仓库的
  历史提交等于无需认证就能取到的页面，所以同一条规则的分量比私有仓库重一个量级。）
- 密码不进任何存储（`hint` 里也这样对用户写着）；token 只进 Keystore 背书的 AES-256-GCM
  不可导出密钥加密的 `noBackupFilesDir/scut-session.bin`，`allowBackup=false`。
- 本轮验收中，助手侧从未输入过任何凭据，两次登录都由用户亲手完成。

---

## 5. 两条附加要求的现状

**A. 字段语义。** 真机已抓到字段名：电表 `elePrice, leftEle, leftFreeEle, leftFreeMoney,
leftMoney, monTime, roomId, roomName`；水表 `coldWaterPrice, leftMoney, leftWater, monTime`
（RUNTIME_VERIFIED 的是**名字**，不是含义）。电费余额单位是人民币元，来源是用户确认
（USER_VERIFIED），水费与 GZIC 仍待验证。**单位确认不等于"余额减少量 = 实际消费金额"**：跨充值
或人工调额的采样区间仍必须排除或标为未知，趋势图的"余额增项"列表正是为此存在——今晨序列
¥29.91 → ¥28.43 → ¥22.38 无增项，是第一段形状像消费的序列，但它是观测，不是模型。
未验证语义之前，这些字段不进任何预测。

**B. 身份隔离。** `profile_id = SHA-256("campus|room")[:16]` 是稳定分组键，
**不是匿名化**：房间号取值有限，且同宿舍不同用户会得到同一个键。当前单用户不受影响，代码里的
KDoc 已明写这一点；任何面向多用户或可导出的版本发布之前，必须换成本机密钥参与的 HMAC
或其他用户级分组（任务 #19 / #21）。

---

## 6. 本轮验收暴露并修掉的缺陷

1. **`startService` 回退导致崩溃循环。** 系统拒绝后台 FGS 启动时（`uidState: RCVR; code:DENIED`），
   作为前台服务启动却从不调用 `startForeground()` 的服务会被判为崩溃：进程被杀两次（间隔 1.2 s），
   随后 30 分钟服务退避。修法是删掉回退、把 `startForeground()` 包进 `runCatching`、失败即
   `stopSelf()` 并返回 `START_NOT_STICKY`，把"每日快照需要常驻通知"变成产品规则而不是一句建议。
2. **权限回调签名崩溃。** `@PermissionCallback` 写成 `(call, grantResults)` 会抛
   `IllegalArgumentException: Wrong number of arguments; expected 2, got 1`，因为
   `Plugin.triggerPermissionCallback` 只 `invoke(this, savedCall)`。文档没写，注释写在方法旁边。
3. **`source=unknown` 满屏。** Capacitor 把插件参数作为 JSON 对象传递，`getBills("restore")`
   的裸字符串永远到不了 `call.getString`；改成 `getBills({ source })`。第一条被误标为 `unknown`
   的历史行保留原样，不改写数据。
4. **`renderDaily` 竞态。** 权限对话框关闭后重绘时读到 `running:false`（`startNotice` 还在排队），
   把用户刚拿到的开关又置灰；判定条件加入 `noticeToggle.checked`。

5. **倒计时能印出 60 分钟。** 屏幕上出现 `下次约 3 小时 60 分后`：小时按整除取、分钟各自四舍五入，3 小时 59.6 分就成了 3 小时 60 分。改成整个跨度先取整再拆分（`formatCountdown`），4 条测试钉住（手机原值现在是 `4 小时 0 分`）。修完构建、签名仍是 `ef607f9d…`，但当时没装——见 §3。

另外，PR #1 的第一版集成代码 `tsc --noEmit` 就没过（`$` 泛型放宽后 `el as T` 触发 TS2352），
"TypeScript 已完成"当时不成立——修完才是。这条写进来是为了保留一个教训：**报告里"完成"必须以
构建命令的退出码为准。**

---

## 7. 版本与发布决议

- 不动既有标签：`v0.2.0` 不强移动，`v0.2.1` 不删除。GitHub 上的 release 由用户（人类工程师）手工
  维护，工具链不去纠正它。
- 下一次正式发布使用新标签 `v0.2.2` / `versionCode=3`，并且**由构建产出反推记录**（任务 #22），
  而不是手工记账。
- PR #1 保持 Draft，测试通过后只更新、不自动合并（用户的明确指示）。本轮所有改动都只有文档，
  应用代码与 APK 字节没动。

### 7.1 房号泄露的历史整理：过程、判据、边界

判据由用户提出，也是这份记录唯一有意义的通过条件：**整理前后完整 Git tree SHA 必须一致**，
即只换历史，不换内容。

```bash
# 1) 先把可恢复的东西放到仓库外，权限收紧
git bundle create ../backups/feat-electric-trend-v3-PRE-REWRITE-2026-10-09.bundle \
  refs/heads/feat/electric-trend-v3
git bundle verify …            # "The bundle records a complete history"
chmod 600 ../backups/*.bundle  # 这份备份含未脱敏文本，因此目录 0700、文件 0600（当时；§7.2 里删掉，恢复路径换成干净 bundle）

# 2) 确认远端没有别人在推（lease 用远端当时的值 <旧 HEAD>，而不是本地跟踪引用）
git ls-remote origin | grep electric-trend
git ls-remote origin | grep 'pull/1/head'

# 3) 用同一个树、同一个父提交，造一个整理后的提交
git commit-tree 13eb1f918ad74dfba15affc6d891029f44d9019a -p 1caf532… -F msg   # → 89cd718
git update-ref refs/heads/feat/electric-trend-v3 89cd718

# 4) 判据核对
git rev-parse <旧 HEAD>^{tree} 89cd718^{tree}   # 两行相同
git diff --stat <旧 HEAD> 89cd718               # 空
git status --short                              # 空
for c in $(git rev-list feat/electric-trend-v3); do git grep -qF '<房间号>' $c; done   # 0 命中

# 5) 只强推这一条 PR 分支
git push --force-with-lease=refs/heads/feat/electric-trend-v3:<旧 HEAD> \
  git@github.com:YanZhao1027/scutBombax.git feat/electric-trend-v3:refs/heads/feat/electric-trend-v3
```

`<旧 HEAD>` 的具体 SHA **不写在这份公开文档里**：旧对象仍可按固定 SHA 取到（见 §4），把 SHA 印在
文档上等于给还在服务的旧内容做索引。它记在本地 `backups/README-pre-rewrite.txt`（0600），
向 GitHub Support 提清理申请时用那份。

结果：`+ <旧 HEAD>...89cd718 …（forced update）`，lease 生效说明远端确实没被别人移动过；
`refs/pull/1/head` 随推送前进到 `89cd718`。约束也都核对过——`refs/heads/main` 仍是
`2ccc3ed…`，`alpha` / `v0.1.0` / `v0.1-classic-ui` / `v0.2.0` / `v0.2.1` 五个标签对象
逐字未变，没有执行任何 `--mirror` 推送。

残留暴露不是猜测，是逐个引用取同一份文件量出来的（`curl` 取
`https://raw.githubusercontent.com/<owner>/<repo>/<ref>/docs/DEVICE_VERIFICATION.md`，
只统计字节数与命中数，不回显内容）：

| 取哪个引用 | HTTP | 字节 | 含旧房间号 | 含 `<楼栋-房号>` |
| --- | --- | --- | --- | --- |
| 被替换的旧提交（固定 SHA） | 200 | 75,776 | **1 处** | 否 |
| 整理后的提交 `89cd718` | 200 | 76,586 | 0 | 是 |
| 当前分支头 `5548a26` | 200 | 76,807 | 0 | 是 |
| `refs/pull/1/merge`（GitHub 自建测试合并） | 200 | 76,586 | 0 | 是 |
| 泄露之前的提交 `1caf532` | 200 | 73,337 | 0 | 否 |
| `refs/heads/main` | 200 | 66,489 | 0 | 否（这一节还没进 main） |

边界写清楚，别把"整理过了"说成"清除了"：**PR 的所有可见引用都取到干净版本，旧文本只在"按被替换
提交的固定 SHA 直接请求"这条路上还活着**，加上 GitHub 缓存与别人已克隆走的副本。本地清理不能
替代 GitHub Support 申请，两件事各自独立（见 §7.2）。

### 7.2 本地未脱敏副本的清理（用户批准，顺序有讲究）

顺序是用户定的：**先建干净备份，再删旧备份，最后才动 reflog**——否则"清理"会把恢复能力一起清掉。

```bash
# 1) 干净备份：只打包 main 与当前分支可达的提交，不用 --all
git bundle create ../backups/scutbombax-CLEAN-2026-10-09.bundle \
  refs/heads/main refs/heads/feat/electric-trend-v3
git bundle list-heads …; git bundle verify …        # "records a complete history"
# 反证：克隆这份 bundle，被替换的提交与那个 blob 根本不在对象库里
git clone … /tmp/check && git -C /tmp/check cat-file -t <旧提交>   # could not get object info
git -C /tmp/check rev-list --all | … git grep -F '<房间号>'        # 0 命中

# 2) 删除含未脱敏文本的旧 PRE-REWRITE bundle（不上传、不进 evidence/）
rm ../backups/feat-electric-trend-v3-PRE-REWRITE-2026-10-09.bundle

# 3) 只过期不可达记录，保留正常本地恢复记录
git reflog expire --expire-unreachable=now --all
git gc --prune=now

# 4) 验证：旧对象、旧 blob 均已消失；引用与工作树正常
git cat-file -t <旧提交1> <旧提交2> <旧 blob>   # 三个都是 could not get object info
git for-each-ref; git status --short; git fsck --no-dangling   # 干净
git fetch origin --prune                        # 之后再次确认可达提交 0 命中
```

恢复能力实测过一遍：克隆新 bundle → `git checkout -b feat/electric-trend-v3
origin/feat/electric-trend-v3`（bundle 只列分支引用，所以克隆后默认什么都没检出，这一步必须写下来），
`docs/RELEASE_ACCEPTANCE.md`、`docs/DEVICE_VERIFICATION.md`、`src/main.ts`、`ScutRuntime.kt`、
`package.json` 与工作副本**逐字节相同**，且克隆库里 0 条提交含房间号。清理后主机门禁重跑：
typecheck 干净、43 vitest 通过（闸门加入后是 55，见 §7.3）、`check:dom` 无缺失 id、`git status` 空。

三条不过头的说法，都是这段流程的边界：

- 普通 `rm` 在 SSD、写时复制文件系统和系统快照上**不宣称不可恢复**；这里是"不再以文件形式
  存在"，不是"物理上不存在"。
- 会话与工具日志仍含该标识符（`~/.qoder/projects/…`、`~/.qoder/logs/…`，本轮已把它们收紧到
  0600）。删它们等于删掉这次对话的历史，那是用户的决定，不是顺手能做的清理。
- 本地清理与 GitHub 残留是两件事：旧提交按其固定 SHA 仍能取到（§7.1 的量测）。**用户决定不再走
  Support 工单**：泄露的只有本人宿舍号，权衡之后接受这份残留。申请所需的最小事实仍然留在
  `backups/README-pre-rewrite.txt`（0600，含被替换提交的 SHA，不含房号原文），随时可以提。

### 7.3 让下一次进不去：机械检查，而不是自觉

用户的要求是"之后用户信息不可能进我们这里或者上传"。这句话只能由**检查**兑现，所以本轮加了
`scripts/check-privacy.mjs`，挂在三个地方：`pnpm check:privacy`、`pnpm test`（`src/privacy.test.ts`
以子进程调用它，泄露会让测试套件失败）、以及提交时的 pre-commit 钩子
（`scripts/git-hooks/pre-commit` + `pnpm hooks:install`，本仓库克隆已安装并实测：把含房号形状的
临时文件 `git add` 之后提交被拦下）。

规则分两层。形状层不需要任何本机数据：楼栋-房号、18 位身份证、11 位大陆手机号、以及
"凭据名 = 看起来真实的值"（`looksLikeSecret` 要求长度、数字、大小写混合或 `eyJ` 前缀，因此
`refreshToken=present`、`bearer <access_token>`、`password: string`、`els.password.value`、
`refresh_token=not-a-real-token-0000` 这些仓库里合法写法都不报）。值层是
`privacy-denylist.local.txt`（gitignore、0600、当前恰好 1 条），管的是"这个具体房间不能再出现"。

三件事值得留档：

- **误报是设计出来的对手。** 第一次全仓扫描报了 5 处，全部来自既有文档与代码里对凭据的*描述*；
  不修好它们，这个检查一周内就会被绕过。现在 `--selftest` 把 8 条必报和 14 条必不报钉住。
- **它确实抓得住原来那个错误。** 把 §17.2 那次屏幕转写在仓库外重建成一个临时文件，扫描器报了三条
  （形状、语境、denylist），且输出全部打码——**报告工具本身不能变成第二次泄露**。临时文件已删。
- **边界说清楚。** 它不认识未知的学号格式（长度与字符集因年级而异，硬猜会淹死在误报里），所以
  "永不记录用户名/学号"仍由 `Diag` 的去标识化路径和两条 JVM 测试保证；它也不管"上传"，因为
  本项目没有后端、没有任何出站上传，那条路由 AGENTS.md 的禁令和本检查的 git 覆盖面共同保证。

门禁现状（含本轮改动，Kotlin 测试夹具改用命名常量并注明合成数据）：typecheck 干净、**55 条 vitest**
（43 + 6 守卫 + 4 倒计时 + 2 门禁）、122 条 JVM 测试、`check:dom` 无缺失 id、`assembleRelease` 通过，
新 APK `de8f5584…` 签名证书仍是 `ef607f9d…`。**未安装**，理由见 §3。

---

## 8. 结论

Release 0.2.0 在真机上通过了批准时列出的第 1–6 项；第 7 项即本文。登录、查询、首条快照、
离线历史、通知、每日墙钟槽位、自然投递端到端、登出与历史解耦这八件事都有 RUNTIME_VERIFIED
级别的证据。未验证项全部列在 §3，其中只有"重新登录"这一项在等用户动手，其余要么需要时间
（会话自然过期），要么被明确判定为不该在本机做（清空唯一真实序列去验空态）。

两条发布门槛（字段语义、HMAC 用户级隔离）仍然开着，它们不阻塞继续积累数据，但阻塞任何多用户
或可导出的发布。

本轮唯一一处由验收过程本身造成的问题是 §4 记录的那次房间号入库：文件已脱敏，携带它的两个文档
提交已按"树 SHA 必须一致"的判据整理成一个（§7.1），本地未脱敏副本也按"先建干净备份、再删旧的、
最后清不可达历史"的顺序处理掉了（§7.2）。旧提交按其固定 SHA 在 GitHub 上仍可取到，量测过；
**用户在知情后决定不提 Support 工单**，接受这份只对本人有意义的残留，同时把要求改成面向未来的
那条——用户信息不可能再进仓库，这由 §7.3 的检查保证，不再由自觉保证。它不影响 app 的行为，
却是这份报告里最该被看见的一条：**规则写在文档里不等于规则被遵守。**

用户核对后确定的两条后续做法已纳入本报告：其一，验收"装的是什么包"一律**从设备反查**
（`pm path` + `sha256sum` + `apksigner verify`），不再以构建时间或 `lastUpdateTime` 推断；其二，
每日查询时刻不再固定 23:00，由使用者选定即可，闹钟重排正确就算通过。
