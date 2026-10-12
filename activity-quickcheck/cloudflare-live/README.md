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
2. 复制 wrangler.stage.example.jsonc 为本地 wrangler.stage.jsonc，写入新建数据库 ID 及桶名称。只绑定 activity-stage.10273055.xyz。
3. 在确认数据库 ID 后，对独立的测试 D1 执行 migrations/0001_init.sql。
4. 在 Ubuntu 本机通过 wrangler secret put DEEPSEEK_API_KEY 保存 DeepSeek API Key，禁止发到聊天或提交 Git。
5. scripts/provision-organizer.mjs 可从 stdin 接收管理密码，生成一次性建主办方账号 SQL；在目标 D1 执行并安全删除，公开的学生注册流程不能创建主办方。
6. 继续保持 ENABLE_LIVE=false。完成独立前端、真实多设备验证、资料保护与同意界面后，才能审核是否改为 true。

注意：当前这个目录还没有完整可发布的生产前端。Node 本地 MVP 的 /api/activities 与 Cloudflare 新后台的 /api/events 并不一致，不应直接混用。Cloudflare Stage 所有业务写入接口在 ENABLE_LIVE=false 时返回 503。

## DeepSeek 权限与用户告知

学生在报名时默认不同意使用 AI。只有学生勾选 AI 处理同意后，**该场活动的负责人或审核员主动点按**才允许发送材料至 DeepSeek。只使用 HTTPS、服务器环境中的 DeepSeek Secret，不向浏览器下发 API Key。DeepSeek 可阅读截图文字和可见点赞数，但不能证明截图未篡改、点赞真实、学号与本人一致。不能将 AI 建议作为自动批准、拒绝或处罚依据。

具体上线前还须补齐：隐私声明和第三方提供个人信息说明、EXIF 清理、主动删除/更正、保留期自动删除、限流实测、并发 D1/R2 一致性、真机 GPS/相机扫码、二维码浏览器打包、正式活动票模板、数据备份、退出/撤权和 500 人并发演练。

官方模型文档：https://api-docs.deepseek.com/guides/vision/ 。实际模型名为 deepseek-flash。

## 测试

在 activity-quickcheck 执行 npm test。单元测试仅使用模拟截图字节和伪造 DeepSeek JSON，不会实际收费、不上传个人资料。后续上线前须额外实施独立安全和人工验收。
