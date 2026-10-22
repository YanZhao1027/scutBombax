# 大学城校园网络智能路由 · 安全准备方案（未启用）

## 目标与两层判断

学生打开 **`https://activity.10273055.xyz`**。仅当 Cloudflare 的**可信连接出口 IP**属于配置的大学城校区**公网出口 CIDR**，且校区 Ubuntu 内网服务最近 95 秒内有**经共享密钥签名的心跳**，才给前端“可以尝试内网”的建议。浏览器还必须在 1.3 秒内经 HTTPS/CORS 成功探测实际 LAN 域名 `/__lan/health`，随后才跳转。任一条件不满足，直接停留在 Cloudflare。

**不能把学生在内网的 `10.x.x.x`、`172.16/12` 或 `192.168/16` 当作 Cloudflare 能看到的出口 IP。** IPv4/IPv6 公网出口 CIDR 必须由校方网络管理员核实，当前示例没有填任何段，也没有实际启用。

## 设计和安全隔离

- 独立 Cloudflare Worker `smart-route/router.mjs`，**仅负责** `activity.10273055.xyz/__route/*`，不接管学生报名、业务 API、扫码后台。`CAMPUS_ROUTE_ENABLED=false` 默认拒绝切换，KV 没配置或心跳过期则一直返回 `{mode:"cloud"}`。
- Ubuntu 用 `smart-route/heartbeat.mjs` 检查**本机的真实活动服务**就绪，才发 HMAC-SHA256 签名心跳到 CF；Key 应存仅 Ubuntu root/bombax 可读的环境文件和 Cloudflare Worker secret，**绝不能进入仓库、浏览器、URL 查询或日志**。心跳推荐 30 秒一次，KV TTL 120 秒，取 95 秒新鲜度。
- 前端仅在公网页面 **`/`、没有 URL fragment、没有 `?force_cloud=1`，且不是 Android App 受限 WebView** 时调用 `/__route/decision`。`#pass=bqx_...`（私密一码通）、`/my`、`/adminlogin`、`/admin`、API 都不跨域重定向；不会将令牌、管理员 Cookie、学号或真实用户 IP 发送给内网探测地址。
- 浏览器收到 `mode:probe` 后会 `fetch('https://activity-lan.10273055.xyz/__lan/health', {mode:'cors',credentials:'omit'})`，必须得到 `{"service":"bombax-campus-lan","healthy":true}` 才继续。校区服务须提供有效 TLS 证书（公开受信任的证书和校园 DNS 私有解析），明确允许 CORS 来源 `https://activity.10273055.xyz`，如需 Private Network Access 预检还须配置 `Access-Control-Allow-Private-Network: true`。
- 从公网页面在 90 秒内第二次发生内网跳转尝试后，当前浏览器会选择 Cloudflare；LAN 站点额外安装 `smart-route/lan-watchdog.js`，在 25 秒内连续刷新 3 次，或健康接口失效，回退 `https://activity.10273055.xyz/?force_cloud=1`。**如果内网页面根本无法加载，就无法运行 LAN JS**：浏览器应通过公共 Cloudflare 地址或独立备用地址手动回退，这是 HTTP 跳转的客观限制。
- 校区 LAN 服务器必须提供同一套活动数据的**可信后端、API 代理和跨域/Cookie 语义**。目前主站活动 Cookie 为**主机专属 HttpOnly Cookie**，Android Beta.3 的 Keystore 票夹也限定来源。**直接切换到不同 LAN 域名会隔离原有 Cookie**；因此路由首期只测试**匿名首页发现**，绝不把学生报名、一码通恢复、工作人员登录、私密照片或核销流量切到未验收的 LAN 服务。最终方案优先评估保持**同一 hostname 的校园 split-horizon DNS** 或经过安全审计的同源代理，不能为了路由把 Cookie 设为整个 `.10273055.xyz`（会扩大到其他服务的凭证范围）。
- 不记录或存储学生 IP；只在当前请求内匹配网段。校区心跳 KV 只记录节点标识与最近心跳时间，不包括学生、二维码或审核材料。**任何未配齐参数、未知 IP、超时或证书错误，一律走 CF**。

## 准备工作（暂不改线上域名）

1. 确定校区**公网出口 IPv4/IPv6 CIDR**（需网络管理员确认）、校区内网 HTTPS 站点域名和证书、Campus DNS 如何解析，先保证校区内部手机能独立访问该站点。
2. 校区 Ubuntu 架设活动本机服务，仅测试 `/__lan/health`：必须真实检查后端服务、D1 同步/代理是否工作，不要写死返回健康。使用 Nginx 提供 `Access-Control-Allow-Origin: https://activity.10273055.xyz` 等必要 CORS，禁止开放任意来源。
3. 给独立 Worker 创建 KV 命名空间，设置 `CAMPUS_ROUTE_ENABLED=false`，配置准确 CIDR 与 LAN HTTPS Origin，使用 `wrangler secret put CAMPUS_HEARTBEAT_SECRET` 设置独立 32 字节以上高熵密钥。注意避免和工作人员密码或一卡通账号复用。Ubuntu 环境文件填写 `BOMBAX_ROUTE_SECRET`（同一密钥）、`BOMBAX_CLOUD_HEARTBEAT=https://activity.10273055.xyz/__route/heartbeat`、`BOMBAX_LAN_LOCAL_HEALTH=http://127.0.0.1:8787/health`、`BOMBAX_CAMPUS_NODE_ID=uc-ubuntu-01`，设置 `chmod 600`。
4. 用 `.service.example` 和 `.timer.example` 模板创建只读 systemd 服务，`OnUnitActiveSec=30s`。先在虚构数据沙箱验证：正常、停机、DNS 失败、签名错误、IP 不命中、浏览器超时、手机快速刷新、LAN 同源 cookie 与恢复。
5. **在这些条件均人工验收前，不开启 `CAMPUS_ROUTE_ENABLED=true`，不把生产 `activity.10273055.xyz` 的任何路由指向本 Worker，也不部署 Ubuntu 心跳。** 现阶段完成的是可配置原型与单元测试，不是生产智能路由上线。

## 尚需提供

准确的大学城**公网出口 CIDR**（可能多段、含 IPv6）、拟使用的校内 HTTPS 域名和证书方案，以及校区 Ubuntu 服务准备的端口和活动后端/API 同源代理方案。没有这些，Cloudflare 无法可靠判别“大学城 IP”并建立安全可恢复的路由。
