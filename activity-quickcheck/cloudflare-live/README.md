> **2026-10-17 一码通需求确认（仅 Stage 开发提案）：** 学生不登录。首次提交虚构资料立即生成**唯一固定报名二维码**；在原浏览器或跨设备扫描同一个码可查“审核中/通过可签到/已签到”、补交模拟材料；授权工作人员现场身份核对后扫描**同一码**核销一次，核销后一码通继续能查询。短时 45 秒动态签到码在本分支已停止使用。工作人员账号仍按岗位独立登录。请查看 [一码通设计与安全边界](../docs/anonymous-student-registration.md)。
> **上线前必需：** 审阅并只在隔离 Stage 运行 `migrations/0003_guest_access.sql`，再部署匹配版本的 Worker 与静态页面；未运行迁移时新端点将拒绝/失败。保留 `ENABLE_LIVE=true` 与 `SYNTHETIC_ONLY=true` 双门禁及认证限流。截至 2026-10-17，已备份并迁移独立虚构数据 Stage D1，一码通已部署在 https://activity-stage.10273055.xyz/；**正式生产与真实学生数据仍未开放**。
> 原 `/api/register` 已停止使用（HTTP 410）；旧学生登录被拒绝，历史活动记录未删除。工作人员密码不再在网页预填写，必须由负责人在可信渠道提供。测试站始终禁用第三方 AI 图片传输。

> **安全门禁更新（2026-10-16）**：此分支仅实现虚构数据测试后端。所有 `/api/` 业务请求必须同时满足 `SYNTHETIC_ONLY=true` 和 `ENABLE_LIVE=true`，否则在读取数据库 Session 前返回 503。后者仅表示允许独立 Stage 演练，**绝不是正式生产上线许可**。缺少真实身份核验、数据留存与删除、撤权及合规告知之前，不得配置真实学生资料。

# 花工木棉 · 活动速签 —— 持久化后端（仅虚构数据 Stage，未正式上线）

这是从 Ubuntu 本地 MVP 迁移到 Cloudflare Workers + D1 + 私有 R2 的后端开发分支。现有公网 https://activity-demo.10273055.xyz/ 仍是完全虚构数据的演示页，**并非**可以收集真实学生资料的系统。

## 2026-10-17 · 扫码现场反馈（仅本机、本次扫码界面）

- **每次服务端确认一次成功核销，屏幕递增醒目的 #001 / #002 / #003 编号**，背景色交替变化；约 2 秒后提示“等待下一位”，**最近成功编号仍保留**。扫描失败、已签到重复码、越权或网络异常都**不会加计数**，失败显示明确红色提示。
- 编号是当前扫码窗口成功确认的序号，**不是整个活动累计到场人数**，页面刷新或重新进入岗位会重新从 0 计数；全场真实数据以 D1 签到记录和审核日志为准。编号**不携带姓名、学号或二维码密钥**。
- 页面与全屏相机视图均提供**“成功/错误提示音：关 / 开”**开关，默认关闭，须工作人员主动点击“开”唤醒 Web Audio。旧版短暂纯正弦波在手机扬声器上过轻，现改用**无需下载、完全原创的方波 8-bit 提示音**：服务端核销成功播放**一次上行双音节提示**（880→1320 Hz，峰值增益 0.28）；核销失败、重复或无效码播放**两段中频下降警示音**（698→523 Hz，峰值增益 0.36）。方波比旧版纯正弦音更易被手机小扬声器感知；音效没有外部版权依赖或网络请求，使用短平滑包络避免爆音、峰值低于数字满刻度。重复曝光同一无效码会被节流，避免持续蜂鸣；音效关闭时保持静音。
- 只有**扫码岗位/活动主办方**能看到折叠的「现场试听提示音（不核销、不计数）」；须先手动开启音效，才能分别试听**一次成功 8-bit 上行音**或**两段失败 8-bit 下降警示音**。试听完全在浏览器内合成，不读取二维码、不访问核销 API、不改变 #001/#002 计数；便于工作人员现场检查扬声器，而不必使用真实或假二维码乱扫。
- 音量、系统静音、浏览器/WebView 的声音策略可能阻止响铃；此时**可见编号仍是主要验收依据**。不要把本机声音或本地计数当作替代服务器审计的证明。
- 这次只修改工作人员扫码反馈页面，没有变动学生的一码通、D1/R2 结构、二维码有效期或签到唯一约束。模拟图片扫码只用于虚构数据 Stage，真实身份核验与多机现场验收仍须现场进行。

## Android 2.0 Beta.3 · 无账号活动票夹与二维码截图导入（Stage）

- 与 [Android Beta.3 方案](../docs/BETA3_LOCAL_ONECODE.md) 联动，普通浏览器和 App 均无需学生登录即可浏览活动列表和报名。
- 首次报名仍在服务端生成**单个固定一码通**。App 的 \`WebViewCompat\` 受限接口 \`BombaxNativeVault\` 仅在 Stage HTTPS **主框架**可用：Native 用 Android Keystore 加密保存本机凭证和活动摘要，JS 列表**不包含原始码**。Web 端同样可以只保存截图，不依赖 App。
- \`app-vault.js\` 只封装 \`list/save/restore/forget\` 四个受限消息。报名后、查询状态后调用 \`save\`；从本机票夹恢复时原生写 scoped HttpOnly Cookie，网页**必须请求服务端**确认报名有效。App 离线状态只是上次同步快照。
- 新设备可使用 **「从照片恢复旧的一码通截图」**：图片只在本机通过自托管 ZXing 解码、不上传原图；只将通过站点白名单校验的随机码在同源 HTTPS POST \`/api/pass/restore\` 上报，拿到服务端确认后才更新 UI 与新机保险箱。
- **强制提醒截图独立备份**：按用户习惯，把“清除应用数据缓存”明确视为系统设置里的「清除应用数据／清除存储」（含本机数据及缓存），**会清除本机加密票夹和 Cookie**；卸载或换机亦然。仅删除临时缓存与清除全部应用数据是不同操作，但绝不能把本机记录当作唯一备份。换机后需用原截图由服务器查验一码通。截图本身可能被复制，工作人员必须现场核对身份。
- 只在 \`SYNTHETIC_ONLY=true\` 的隔离测试站演练，本阶段**没有**任何学校或花工木棉学生用户系统，也没有启用真实学生数据、挂失/重签和跨平台同步。

## 截图上传与本机压缩（非 synthetic-only 客户端路径）

- 选择 PNG/JPEG 后，先使用浏览器或 Android WebView 自带的 `createImageBitmap` / `Image`、Canvas 与 JPEG 编码器在本机处理，再把 JPEG 以同源 HTTPS 上传；不引入额外的 JavaScript 图片解码器或压缩依赖，也不先上传原图。
- JPEG 编码质量为 75%；原图最多 12 MB、解码后最多 1200 万像素，输出长边最多 3200 px、最多 800 万像素，压缩文件不超过 3 MB。处理后关闭 ImageBitmap 并清空 Canvas，避免长时间占用图片缓冲区。
- Canvas 重编码会去掉原图 EXIF 元数据。对超大图或压缩后仍超过 3 MB 的截图，提示用户先在手机相册中裁剪，不会绕过压缩直接上传大文件。
- **隔离 Stage 仍保持 synthetic-only：** 只能上传内置 `demo-proof.png`，后端继续按 SHA-256 拒绝真实截图。此客户端压缩路径不等于批准开放真实学生资料；正式开放前仍须完成隐私告知、保留/删除流程、身份与授权边界及人工验收。

## 已编写的后端

- D1：工作人员独立账户和 12 小时 Session、活动/岗位分工、学生一码通报名与摘要校验、审核/审计、唯一签到和人工到场。原短时码表作为历史兼容保留。
- R2：不公开的 PNG/JPEG 报名截图。材料只允许学生本人和相关活动的审核员/负责人读取。
- DeepSeek V4.1 Flash：由审核员主动发起 AI 图片初审，学生必须预先明确同意将其截图发送给 DeepSeek；模型结果只是建议，不能自动通过材料审核。
- 未与学校或微信身份认证对接；用户学号仍是自填。
- 生产开关 ENABLE_LIVE 默认必须是 false，正式放开前还要求 Cloudflare 认证限流和 AI 费用限流等资源绑定。

## Ubuntu 进一步部署步骤（先不使用真实学生数据）

1. 使用你已有的 Wrangler 登录，**另建专用** D1 数据库和 R2 私有 bucket，不能复用 audition 项目的任何数据、Token 或资源。
2. 在 activity-quickcheck 根目录执行 cp cloudflare-live/wrangler.stage.example.jsonc wrangler.stage.jsonc，写入新建数据库 ID 及桶名称。只绑定 activity-stage.10273055.xyz。
3. 在确认数据库 ID 后，对独立的测试 D1 执行 migrations/0001_init.sql。
4. 在 Ubuntu 本机通过 wrangler secret put DEEPSEEK_API_KEY 保存 DeepSeek API Key，禁止发到聊天或提交 Git。
5. scripts/provision-organizer.mjs 可从 stdin 接收管理密码，生成一次性建主办方账号 SQL；在目标 D1 执行并安全删除，公开的学生注册流程不能创建主办方。
6. 继续保持 ENABLE_LIVE=false。完成独立前端、真实多设备验证、资料保护与同意界面后，才能审核是否改为 true。

现在已加入独立 /api/events 前端界面，包括学生报名/图片上传、审核队列、人工到场、扫码核销与导出。部署之前必须先在 activity-quickcheck 执行 npm ci，然后运行 node scripts/stage-live-assets.mjs，把 ZXing 摄像头识码库复制为静态资源；否则现场扫二维码不可用。Cloudflare Stage 在 ENABLE_LIVE=false 时仍拒绝业务写入。正式发布之前还需要用户数据删除/保留机制和手机实测。

## DeepSeek 权限与用户告知

学生在报名时默认不同意使用 AI。只有学生勾选 AI 处理同意后，**该场活动的负责人或审核员主动点按**才允许发送材料至 DeepSeek。只使用 HTTPS、服务器环境中的 DeepSeek Secret，不向浏览器下发 API Key。DeepSeek 可阅读截图文字和可见点赞数，但不能证明截图未篡改、点赞真实、学号与本人一致。不能将 AI 建议作为自动批准、拒绝或处罚依据。

具体上线前还须补齐：隐私声明和第三方提供个人信息说明、EXIF 清理、主动删除/更正、保留期自动删除、限流实测、并发 D1/R2 一致性、真机 GPS/相机扫码、二维码浏览器打包、正式活动票模板、数据备份、退出/撤权和 500 人并发演练。

官方模型文档：https://api-docs.deepseek.com/guides/vision/ 。实际模型名为 deepseek-flash。

## 测试

在 activity-quickcheck 执行 npm test。单元测试仅使用模拟截图字节和伪造 DeepSeek JSON，不会实际收费、不上传个人资料。后续上线前须额外实施独立安全和人工验收。


## Synthetic-only stage trial (2026-10-12)

Test URL: https://activity-stage.10273055.xyz/ . The Stage Worker uses isolated Cloudflare D1 and private R2; audition and the campus HTTPS nginx site remain unchanged.

This stage accepts fictional data ONLY: student usernames start demo_, student numbers start TEST-, and names start with 测试. The server also checks the SHA-256 of every upload against the hash of the built-in demo-proof.png image. No real social-media screenshots are permitted in stage mode. Accepted bytes are really uploaded to private R2 and review / attendance records really persist in D1.

### Physical multi-device walkthrough

1. Sign in as a synthetic organizer, create a test activity with start time in the past and end time in the near future, then choose the button to fill the event center from current GPS position.
2. Give three other synthetic organizer accounts the reviewer, scanner and manual permissions under the event.
3. On a separate phone or private browser window, register a demo_... student with TEST-... student number and a 测试... display name, then join.
4. Click the built-in fake screenshot upload button. The reviewer reads it from private R2 and approves manually.
5. The student refreshes their review status, physically stands inside the event radius, grants location permission, and requests the 45-second QR.
6. A scanner account on a different device scans the QR. It must succeed once, fail on replay, and appear in the CSV export.
7. For the alternative lane, manually mark a newly joined fictional student as physically present, then upload their evidence and approve it later. No second scan should be necessary.

### QR cryptography and replay prevention

Each issued ticket is 32 bytes of cryptographically secure randomness, hex encoded with the bqx_ prefix. The token does not contain the student's name, number or identity. D1 stores only its SHA-256 digest, plus a binding to the exact registration, event, and 45-second expiration. Server-side activity permissions and registration approval are checked at redemption. The attendance table has a unique registration_id constraint; thus multiple scanning devices cannot both create attendance records. Refreshing the QR invalidates the old digest. This is a short-lived opaque bearer capability, not encrypted identity data. Its main limitation is that a photographed live QR can be redeemed by whoever reaches an authorized scanner first; neither GPS nor QR encryption proves personal identity.

DeepSeek AI is not yet configured in the stage environment. Manual review works without it. This stage is not approved for real student documents: privacy notices, retention/deletion, abuse protection and physical camera testing remain ahead.


## Synthetic stage login compatibility fix (2026-10-12)

Cloudflare Workers Web Crypto rejects PBKDF2 iteration counts above 100,000.
The original four fictional organizer accounts used 240,000 iterations, causing
HTTP 500 even on correct logins. A real Cloudflare synthetic-only probe confirmed
the limit; local tests alone did not reproduce it.

A non-destructive schema migration (0002_password_iterations.sql) adds
password_iterations. Synthetic-only Workers now use PBKDF2-SHA256 with 100,000
iterations and require a matching version. Outside SYNTHETIC_ONLY=true, account
registration and login are deliberately disabled pending production-grade
authentication. The 100,000-iteration mode must NOT process real student accounts.

The one-time admin password migration is prepared on the Ubuntu machine but
requires the owner's confirmation. On the Ubuntu terminal:

    cd /home/zyubuntu/scutbombax/scutBombax-activity-live/activity-quickcheck
    bash cloudflare-live/scripts/finish-stage-login-migration.sh

At the prompt type MIGRATE-TEST to migrate only demo_owner, demo_review,
demo_scan, demo_manual in the isolated staging D1. A randomly generated
replacement testing password is held only in the local Ubuntu file
/tmp/bombax-stage-new-password (file mode 0600). To retrieve it locally after
the migration:

    cat /tmp/bombax-stage-new-password

Do not share the password via chat, screenshots, or GitHub. The old public
test password is retired after migration. The migration SQL contains only salted
hashes, not the plaintext password, and is deleted after execution.

Regression tests now cover valid versioned login and the legacy-account
migration-needed error. Temporary public hashing diagnostic endpoints were
removed before the fixed Worker deployment.
