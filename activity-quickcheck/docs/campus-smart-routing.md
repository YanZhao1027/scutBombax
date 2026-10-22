# 花工木棉活动 · 大学城 Ubuntu / Cloudflare 智能路由（尚未启用）

**状态：仅有源码、模拟测试和示例配置；没有接管 `activity.10273055.xyz`。**
实际启用前必须取得校内网络出口公网 IPv4/IPv6 CIDR、校内 Ubuntu 的 SSH/运维权限、Cloudflare Tunnel/Access 的配置、同版静态资源哈希，以及后端生产实名资料合规许可。绝不能凭“大学城内网 10.x/172.16.x/192.168.x 网段”直接识别用户，因为 Cloudflare 通常只能看到 NAT 后的公共出口地址。

## 保证同一个网址 / 同一个一码通

浏览器始终访问 **`https://activity.10273055.xyz`**，不执行 302 到私有 IP 或陌生二级域名。

Cloudflare Worker 在收到 **GET/HEAD 静态资源**时，若请求由批准的校区公网出口进入，且 Ubuntu 最近 90 秒心跳表明在线且版本一致，就通过 **Cloudflare Tunnel** 取回校内 Ubuntu 的静态 HTML/JS/CSS/SVG。用户仍看到 `activity.10273055.xyz`。**全部 `/api/` 请求始终在同一个 Cloudflare Worker 内执行，使用相同 D1/R2**；不能将二维码凭证、工作人员 Cookie、学生上传图片或后台写入流量转发给内网静态服务器。反向代理不透传浏览器 Cookie、Authorization、CF-Connecting-IP 或其他身份头。

这个“同一域名下的服务器智能分流”替代浏览器跳转；**是真正可靠地自动失败回退的方式**。直接 302 至 `http://10.x.x.x` 会破坏 HTTPS、安全 Cookie、Android 本机加密票夹按 origin 限制与跨网络可用性，也无法保证目标站不可达时浏览器自动回来。

## 判定、回退和防循环

- **路由门禁默认关闭**。必须同时设置 `CAMPUS_ROUTING_ENABLED=true`、`PUBLIC_ORIGIN=https://activity.10273055.xyz`、`CAMPUS_STATIC_ORIGIN=https://campus-static.10273055.xyz`（公开 DNS 经 Tunnel 抵达本机静态服务）、`CAMPUS_RELEASE_SHA`（40 字符 Git/hash 标识）、`CAMPUS_EGRESS_CIDRS`（多个校区**出口公网** CIDR，用逗号分隔）、`CAMPUS_HEARTBEAT_SECRET`（Cloudflare secret，≥32 字符）。
- Ubuntu 每 20 秒经 HTTPS 向 `POST /__campus/heartbeat` 发送 `{"ready":true/false,"release":"同一提交的 SHA"}`，使用专用 Bearer Secret。Secret 只放在机密文件和 Cloudflare Secrets 中，不提交 Git；未授权、版本不一致或未准备好均不能更新可用状态。Worker 存入 D1 `activity_campus_heartbeat`，使用 Cloudflare 时间作为接收时间，不信任 Ubuntu 自填时钟。
- 只有 **90 秒内有效心跳**、请求公网 IP 落在配置 CIDR、静态版本匹配时才尝试校区。校内请求设 1.5 秒超时；Tunnel 失效、HTTP 非 2xx、缺失/错误 `X-Bombax-Static-Release` 立即回退 Cloudflare 静态 ASSETS。
- 对真正 HTML 页面导航计数，而**不把 JS/CSS/图片网络请求算成刷新**。30 秒内连续访问 3 次时，第三次即由 Cloudflare 静态服务兜底，使用 `bqx_route_fallback` 短期 Cookie 保持 5 分钟。此 Cookie 只决定静态路由，**不赋予任何活动权限**，且不会覆盖 `bqx_live` / `bqx_g_*` 凭证。
- 双线都来自同一经过 SHA 检查的静态版本。Ubuntu 提供的响应剥离任何 Set-Cookie；边缘仅转发 Content-Type 并重写安全头。**学生与工作人员身份接口只走 Cloudflare**，所以切换不改变一码通 token 或签到唯一性。
- 若校内出口并非固定公网 IP、存在多出口 IPv6/CGNAT、或用户处于校园 VPN/IPv6 优先网络，应在运营前明确允许/否认范围。IP 判断是优化路由，**不能作为认证**。

## Ubuntu 预备工作（上线前必须人工验收）

1. 新建 Ubuntu 只读静态资源目录 `/srv/bombax-activity/public`，从审查通过的同一 Git HEAD 部署。该目录不能包含任何私有 R2 文件、D1 导出、服务端密钥或学生数据；必须包含 `admin/index.html`、`adminlogin/index.html`、`banners/*.svg` 和站点前端。
2. 安装 Nginx 和 `cloudflared`，Nginx 只监听 `127.0.0.1:8080`（示例：`campus/nginx.activity.conf.example`），配置 `X-Bombax-Static-Release` 响应头及 `/health-static` 本地探针。**切勿在校内主机运行带校园/学生凭证的克隆后端**。
3. 在 Cloudflare Tunnel 下发布独立受保护的静态主机名（例如 `campus-static.10273055.xyz` → `http://127.0.0.1:8080`），最好由 Access Service Token 保护。Worker 的 `CAMPUS_ACCESS_CLIENT_ID` / `CAMPUS_ACCESS_CLIENT_SECRET` 是单独 secret，仅用于请求校内静态站；不得将学生 Cookie 带过去。
4. 创建仅 root 可读的 `/etc/bombax/activity-campus.env`（权限 0600），按模板设置 48 字符以上随机心跳密钥与该静态发布版本。安装 `campus/campus-heartbeat.sh`、`campus/bombax-campus-heartbeat.service` / `.timer`；仅在本机 Nginx 健康时上报 `ready=true`。
5. 创建并迁移 Cloudflare **正式环境 D1** 的 `campus/router_schema.sql`；先完成 `0004_event_branding.sql`，将所有活动后台实际数据 API 绑定到**一个** Cloudflare Worker（不是两个相互竞争的报名数据库）。现在没有正式活动 D1 故**不能直接启用**。
6. 检查出口公网 IP 是否属于已批准网关，用校外/校内浏览器实际验证 200/超时/版本不符/断开 heartbeat/连续刷新 3 次/恢复 5 分钟等场景。观察路由可在响应中找 `X-Bombax-Route: campus`，**不要以 student 学号、二维码或 Cookie 作路由日志**。
7. 配置正式 `activity.10273055.xyz` Worker route 前先做备份、灰度和回滚演练；新 App 的 Native Keystore 白名单当前只匹配 **Stage origin**，生产上线还需要独立审核并更新 App 允许的 Activity origin，不能直接把 Stage 二维码当正式码。

参考 Cloudflare 官方文档：Tunnel Routing https://developers.cloudflare.com/tunnel/concepts/routing/；Cloudflare 原始 IP Header https://developers.cloudflare.com/fundamentals/reference/http-headers/；KV 多区域最终一致性不适合 20 秒心跳 https://developers.cloudflare.com/kv/concepts/how-kv-works/ 。因此心跳在 D1 中维护，不在 Worker KV 做实时选路。

## 现阶段与用户确认

**不更改真实 DNS、Tunnel、校区主机或生产环境；此功能仅有关闭状态下的代码和模拟测试。**
需要你后续提供：校区公网出口网段、Ubuntu 主机部署计划、Cloudflare Tunnel 接入方式；不需要将密码或 Bearer Secret 直接发在聊天里。
