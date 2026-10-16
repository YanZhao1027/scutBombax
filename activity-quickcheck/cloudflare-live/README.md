> **安全门禁更新（2026-10-16）**：此分支仅实现虚构数据测试后端。所有 `/api/` 业务请求必须同时满足 `SYNTHETIC_ONLY=true` 和 `ENABLE_LIVE=true`，否则在读取数据库 Session 前返回 503。后者仅表示允许独立 Stage 演练，**绝不是正式生产上线许可**。缺少真实身份核验、数据留存与删除、撤权及合规告知之前，不得配置真实学生资料。

# 花工木棉 · 活动速签 —— 持久化后端（暂未上线）

这是从 Ubuntu 本地 MVP 迁移到 Cloudflare Workers + D1 + 私有 R2 的后端开发分支。现有公网 https://activity-demo.10273055.xyz/ 仍是完全虚构数据的演示页，**并非**可以收集真实学生资料的系统。

## 已编写的后端

- D1：独立账户、12 小时 Session、活动、岗位分工、报名、审核与审计、45 秒签到码、人工到场、AI 建议。
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
