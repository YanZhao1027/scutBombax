# 花工木棉 · iOS/iPadOS PWA（独立实验分支）

在线地址：**https://pwa.10273055.xyz/**

这是 Android 1.0.1 应用的轻量 iOS/iPadOS 伴生 PWA，不是完整协议移植。它复用了
src/trend.ts 的无依赖 SVG 图表与原版木棉图标，但 **没有学校账户登录和自动查询接口**。

## 已实现

- iPhone/iPad Safari → 分享 → **添加到主屏幕**（Web App Manifest、Apple Touch Icon、Service Worker）。
- 安装后再次打开及断网时可查看已缓存页面。
- 余额和历史只保存在当前浏览器源的 IndexedDB；可手动添加/导入/导出 JSON。
- 7 / 30 / 90 天及全部 SVG 趋势，余额增项；纯演示数据不写入历史库。
- 用户主动打开学校官方查询页面或 DXC 充值页面。iOS 可通过系统分享菜单将充值链接分享给微信。
- Worker 只服务静态资源和公共 /api/health，**不接收账号、密码或付款信息**。
- 没有 D1、KV、Cron、Queue、后台保活、通知轮询或用户行为统计 SDK。

## 为什么现在不能从 PWA 自动查余额

旧 Cloudflare Worker 对 ecardwxnew.scut.edu.cn 的学校验证码和安全键盘返回
403/502，Safari 跨域直接读取学校接口又被 CORS 阻止。把 Android 的 Kotlin 网络栈
复制进浏览器无法改变这些限制。**PWA 不具备 Android 原生网络权限或绕过 CORS 的能力。**

本阶段刻意不提供一卡通登录表单，不把真实用户密码传给不可达的 Cloudflare Worker。
在域名上实际测试过：/api/health 返回 canQuerySchool:false；/api/login 返回 HTTP 503，
不发起任何学校请求。

如以后一定要从 iOS 自动查询，可另行评估**用户明确同意**的按需 relay：
Cloudflare → 自有 Ubuntu 或学校允许的出口 → 官方学校接口。此类 relay 必然处理登录
请求，不能再声称用户凭据“从不经过自己的服务器”，必须设计最小留存、日志脱敏、
滥用限速、访问审计和可撤销机制；未经明确审批不要启用。

## 构建 / 开发

在 Ubuntu 24 的仓库根目录（Node.js 22、pnpm）：

~~~bash
pnpm install --frozen-lockfile
pnpm test
pnpm build:ios-pwa
pnpm dev:ios-pwa
~~~

部署（需要已登录且对域名有权限的 Wrangler）：

~~~bash
npx wrangler deploy --config ios-pwa/wrangler.jsonc
~~~

独立 Workers 服务 huagongmumian-ios-pwa，自定义域名
pwa.10273055.xyz，不会覆盖 10273055.xyz 根站或 Android 版 GitHub Release。
ios-pwa/dist 被 .gitignore 排除。

## 测试边界（2026-10-10）

- Ubuntu：77 Vitest、PWA 类型检查及 Vite 构建通过；浏览器实测本机读数保存后刷新仍在，
  演示模式退出不残留模拟数据。
- 公网：Worker /、/manifest.webmanifest、/sw.js、图标和 JS 全部 HTTP 200；
  /api/health 200，登录代理 /api/login 503。
- **待真实 iPhone/iPad 验收**：离线冷启动（桌面 Firefox 已确认缓存所有前端资源，WebDriver 的断网导航模拟未通过，不能算成功）、主屏幕安装形态、Safari 离线重启、iOS IndexedDB
  存储保留情况、微信分享链路、iPad 分屏布局。
- iOS 可能回收长时间不用的站点存储；重要历史请先用“导出历史 JSON”保存备份。
  iOS 禁止 PWA 在退出后像 Android 前台服务那样每晚自动采样，本项目不作虚假承诺。

## 隐私边界

不写学号、密码、宿舍号、Cookie、Token；PWA 离线历史只存金额、时间和输入来源。
备份导入采用白名单结构校验，额外字段直接拒绝。Cloudflare 仍能看到普通网站
访问的网络元数据，这不等同于向它上传用户余额。
