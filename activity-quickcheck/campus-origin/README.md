# 花工木棉大学城 Ubuntu 校内预览服务（只读）
当前是安全的第 1 阶段：本机只读活动卡片首页，不承担工作人员登录、报名、截图、照片上传、二维码或签到。**不可把它当作已有可用的全功能校内站**。

`node campus-origin/server.mjs` 默认绑定 **127.0.0.1:8789**，从 `https://activity-stage.10273055.xyz/api/events` 拉取**虚构测试活动目录**，缓存 20 秒，内置 5 种安全 21:9 SVG 横幅。点击报名按钮打开 Cloudflare 的 HTTPS 测试站 `/#event=<event-id>`，确保学生 Cookie、一码通、私有 R2 和后台会话从不进入 HTTP 内网预览服务。

`/__lan/health` 实际向 Stage 的 `/api/health` 和 `/api/events` 发起 HTTPS 请求，仅两者在限时内都通过才返回 `{service:"bombax-campus-lan",healthy:true}`；否则 503（供将来的 Ubuntu->CF 签名心跳进行真实就绪判断）。

该部署**不改动 Ubuntu 已存在的 443 / audition 服务**，不打开额外公网端口。正式内网体验下一步须让学校提供/确认校内 DNS、HTTPS 证书以及校园公网出口 CIDR，在受信任的 TLS 反向代理之后接入同源完整业务。当前活动 Worker 固定 `PUBLIC_ORIGIN` 为 Stage HTTPS，绝不应改为接受裸 HTTP/任意 Origin，不可为了兼容而把 bearer Cookie 域扩到所有子域。

运维检查：
- `curl -fsS http://127.0.0.1:8789/__lan/health`
- `curl -fsS http://127.0.0.1:8789/ | head -c 200`
- `ss -ltn | grep ':8789 '`

不能自动回退的极端情况：浏览器连内网首页 HTML 都加载不了时，页面 JS 不可能主动重定向，需保留独立 Cloudflare 外网入口或通过学校可信分流 DNS/代理负责回退。
