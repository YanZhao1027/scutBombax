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

在 HEAD `d98ac86`（§17.2 之后，仅文档改动）上：

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 干净 |
| `pnpm test` | 43 通过（`snapshot-time` 4 + `view` 9 + `trend` 13 + `refresh` 17） |
| `pnpm check:dom` | `missing ids: none`，CSP 9 条指令 |
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
| 4 | 首次登录由用户本人完成；禁止记录密码、token、宿舍号 | 两次登录（昨日下午、今晨 10:2x）都由用户亲手输入；应用日志与通知内容不含宿舍号。**但 §17.2 的一次屏幕转写把宿舍号写进了仓库（提交 `d98ac86`），本次提交已就地脱敏，历史里那条仍在**——见 §4 | RUNTIME_VERIFIED（凭据侧）/ 已修正的文档失误（标识符侧） | §15.3 / 本文 §4 |
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

---

## 3. 未验证 / 待定（写明缺什么、谁能补）

| 项 | 为什么还没验 | 谁能解除 |
| --- | --- | --- |
| 重新登录后 23:00 闹钟重新登记 | 退出后按设计零闹钟；下一次登录归用户 | 用户登录 → 我打开两个开关并读 `dumpsys alarm` |
| 第 12 条记录 `source=login` | 同上，需要一次真实登录 | 用户登录 |
| 第 11 条（今晨 10:25）的 source 标签 | release 不可 `run-as`（正确行为），且该行写入时本次日志抓取尚未开始（12:59 起） | 无法回溯，保持未验证 |
| 会话过期状态（`authenticated=false` + 原因串） | 只能等令牌自然过期或人为失效，不制造 | 下次自然发生时记录 |
| 无会话且无历史（空态） | 验证它要清空本机唯一一条真实序列 | 明确不在本机做 |
| §17.1 里 `stage=snapshotTest result=fired/ok` 两行日志本身 | 检视时已被 logcat 轮转掉；结论由消费位点+行数+图表三个旁证支撑 | 下次测试时先起抓取 |
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
  抄进了 `DEVICE_VERIFICATION.md`，随 `d98ac86` 推到了远端。本次提交把文件里的那处替换成
  `<楼栋-房号>`，并在这里写明：**文件已脱敏，git 历史未改**（不为此强推重写共享分支）。
  如果这个仓库将来要对其他人开放，需要先过滤该提交。
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

另外，PR #1 的第一版集成代码 `tsc --noEmit` 就没过（`$` 泛型放宽后 `el as T` 触发 TS2352），
"TypeScript 已完成"当时不成立——修完才是。这条写进来是为了保留一个教训：**报告里"完成"必须以
构建命令的退出码为准。**

---

## 7. 版本与发布决议

- 不动既有标签：`v0.2.0` 不强移动，`v0.2.1` 不删除。GitHub 上的 release 由用户（人类工程师）手工
  维护，工具链不去纠正它。
- 下一次正式发布使用新标签 `v0.2.2` / `versionCode=3`，并且**由构建产出反推记录**（任务 #22），
  而不是手工记账。
- PR #1 保持 Draft，测试通过后只更新、不自动合并（用户的明确指示）。本报告与上一节两处脱敏
  只是文档提交，代码仍未动；远端分支 `feat/electric-trend-v3` 在此之前是 `d98ac86`。

---

## 8. 结论

Release 0.2.0 在真机上通过了批准时列出的第 1–6 项；第 7 项即本文。登录、查询、首条快照、
离线历史、通知、每日墙钟槽位、自然投递端到端、登出与历史解耦这八件事都有 RUNTIME_VERIFIED
级别的证据。未验证项全部列在 §3，其中只有"重新登录"这一项在等用户动手，其余要么需要时间
（会话自然过期），要么被明确判定为不该在本机做（清空唯一真实序列去验空态）。

两条发布门槛（字段语义、HMAC 用户级隔离）仍然开着，它们不阻塞继续积累数据，但阻塞任何多用户
或可导出的发布。

本轮唯一一处由验收过程本身造成的问题是 §4 记录的那次房间号入库：文件已脱敏，历史提交没改。
它不影响 app 的行为，但它是这份报告里最该被看见的一条——**规则写在文档里不等于规则被遵守**。
