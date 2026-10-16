# 花工木棉（SCUT BOMBAX）项目说明与仓库评估

**版本基准：** 2026-10-16 ｜ **仓库：** [YanZhao1027/scutBombax](https://github.com/YanZhao1027/scutBombax) ｜ **项目状态：** Android 1.x 已发布；Android 2.0 Beta、活动速签与其他平台处于开发/验证阶段

> **一句话介绍**：花工木棉是一款面向华南理工大学校园生活场景的非官方工具。现有 Android 正式版聚焦宿舍水电余额、历史趋势与官方充值入口；2.0 Beta 以 Material Design 3 为界面体系，增加独立的活动报名、资料审核和现场签到模块。

本说明依据 GitHub 仓库公开分支、README、源码、Pull Request、Release 与 Actions 记录核对。最新可确认的 GitHub 代码更新发生于 **2026-10-13**；2026-10-16 核对时 Ubuntu Remote 处于离线状态，因此**未对 Ubuntu 工作目录或当天服务运行状态重新验收**。本说明中的“通过”与“待验证”以记录的测试范围为准。

## 1. 产品定位

项目的目标是把常见校园事务集中到一个轻量、可验证的入口，同时让不同业务在技术上保持隔离。

- **宿舍水电**：在 Android 设备本机完成校方身份验证和水、电等余额查询，展示余额、历史曲线及用户主动启用的通知/快照；充值仅转交学校官方入口。
- **活动速签**：支持活动创建、报名、材料上传、后台人工审核、GPS 辅助位置判断、短时二维码签到、人工到场登记及候选名单 CSV 导出。
- **平台扩展**：Android 是主要交付平台；iOS/SideStore 与 HarmonyOS 原生版本目前为独立实验分支，不能等同于已验证的正式客户端。

**定位边界：** 花工木棉不是学校官方 App；活动系统不签发学校“活动票”或学分，自填学号不等于学校实名认证，也不读取校园支付二维码作为签到凭证。

## 2. 当前版本与交付状态

| 版本 / 分支 | 核心范围 | 已确认交付及状态 |
| --- | --- | --- |
| **v1.0.1** / `main` | Android 宿舍水电、历史与趋势、官方充值入口 | **正式 GitHub Release**，包含签名 APK；发布于 2026-10-09。DXC 核心查询链路有真机验证记录；部分校区与微信接力仍有未验证项。 |
| **2.0.0-beta.2** / `release/2.0.0-beta` | Material 3 双入口“宿舍水电 / 活动速签”；App 内独立 HTTPS 活动工作台 | **Beta CI 编译通过**，2026-10-13 的 Actions 提供 Debug APK Artifact；PR #9 为 Draft，尚未合并主线、也不是正式 Release。 |
| `feat/activity-quickcheck-mvp` | Node.js / SQLite 本地活动报名、审核、定位与原子扫码 | Draft PR #7；仅作为独立活动 MVP，不代表学校身份认证或正式上线。 |
| `feat/activity-production-ai-review` | Cloudflare Workers + D1 + 私有 R2；四岗位分工及 DeepSeek 图片初审接口 | Draft PR #8；**公开测试环境仅允许虚构材料**。自动化和虚构数据 HTTP 全链路已有测试记录，正式数据治理未通过。 |
| `feat/ios-sidestore` | SwiftUI、DXC 水电协议本机实现、SideStore 自行重签 | Draft PR #6；未签名 IPA 可用于自签流程，**iPhone 真机登录及余额结果未确认**。 |
| `feat/harmony-native` | HarmonyOS 5+ ArkTS / ArkUI 原生水电实验工程 | Draft PR #5；源码构建与模拟回归有记录，**签名安装、真机登录与余额查询未完成**。 |

**Android Beta APK 入口：** [GitHub Actions：2.0.0-beta.2 构建记录](https://github.com/YanZhao1027/scutBombax/actions/runs/38429739680)，在 *Artifacts* 下载 `HuaGongMuMian-2.0.0-beta.2-Android-APK`。该文件属于测试签名，保留期按 GitHub Actions 设置执行，不能视为长期正式下载地址。

**正式版下载：** [GitHub Release v1.0.1](https://github.com/YanZhao1027/scutBombax/releases/tag/v1.0.1)。Beta 包名为 `cn.scut.bombax.beta`，与正式版包名不同，可并存安装。

## 3. 功能模块说明

### 3.1 宿舍水电

Android 端采用 HTML / CSS / TypeScript 呈现界面，通过 Capacitor 调用 Kotlin 原生 `ScutApi` 插件，再由 OkHttp 连接学校服务。其目的在于避免 WebView 直接访问学校域名产生的 CORS 限制，并把身份会话与 UI 隔离。

已实现的关键能力包括：校区选择及验证码登录；校园安全键盘协议适配；DXC 水电余额、本地历史及趋势；手动刷新与有限前台定时刷新；用户明确启用后的常驻通知及可调整时刻的每日快照；本地加密会话恢复；学校官方充值入口交接。GZIC 查询及某些充值/微信联动步骤仍需在对应真实环境中进一步核实。

学校密码不应持久保存；会话令牌由原生层与 Android Keystore 机制管理，不传给活动端。App 不替用户付款，也不自动判定充值成功。

### 3.2 活动速签

支持两条并行路径，而不是要求所有学生在活动开始前完成材料：

**快速扫码路径**：创建活动 → 学生报名 → 上传材料 → 审核员人工审核 → 到场后授权 GPS 辅助判断 → 领取 45 秒一次性二维码 → 授权扫码员核销 → 进入申报名单。

**现场人工路径**：学生到场或临时报名 → 工作人员当面核验并记录到场及原因 → 学生后补证明截图 → 审核员补审 → 满足“审核通过且已到场”后进入名单，**不重复核销**。

现场职责建议拆分为：负责人、持续审核人员、3–4 个扫码窗口，以及至少 1 个线下人工核验窗口。摄像头不工作或室内 GPS 失效时仍能继续服务，人工核验不替代材料审核。

Cloudflare 测试后端采用独立账号、D1 记录、R2 私有材料、岗位授权、审计事件与 CSV 导出；二维码由密码学随机数生成，不包含姓名和学号，服务端存储摘要并利用数据库唯一性约束阻止重复核销。DeepSeek 图片初审功能采用**学生先授权、审核员主动发起、AI 仅提供建议、最终人工决定**的设计；共用密码的公开虚构数据测试站禁用计费 AI 调用。

### 3.3 Android 2.0 Material 3 界面

2.0 Beta 使用 `@material/web` 与 Material Design 3 风格，底部保留“宿舍水电”和“活动速签”两个主入口，不重写原生水电协议。**beta.2 源码**将活动入口改为 App 内独立 Android WebView Activity，配有受限域名白名单、独立的相机/位置权限处理及系统图片选择器；该工作台**没有注册校园 `ScutApi` 插件**。

beta.2 已通过 GitHub Android CI 构建，但不能因此推断各手机浏览器内核、摄像头实扫、GPS 精度和文件选择都已经完成真机兼容性验收。

## 4. 总体技术架构

```text
                  花工木棉 Android 客户端
                 Material 3 + TypeScript
                          │
         ┌────────────────┴─────────────────┐
         │                                  │
  宿舍水电（本机原生）                活动速签（独立业务）
         │                                  │
  Capacitor ScutApi                    受限 Android WebView
         │                                  │
  Kotlin / OkHttp                       HTTPS 活动域名
         │                                  │
  校方水电服务                      Cloudflare Workers / D1 / R2
  本机 Keystore / SQLite             （虚构数据试点环境）
         │                                  │
      无学校后端中继                    候选名单导出
```

**双业务隔离原则**：水电会话只在本机原生层使用，活动有独立域名、会话、岗位授权与数据库。不能把学校 Cookie、支付码或账号令牌复制到活动服务；正式身份适配需要学校正式授权或线下人工核验。

校园网现场服务可以采用“校内 Wi-Fi → 独立 HTTPS 子域名 → Ubuntu 独立服务 → 统一签到数据库”的架构。此前实测了手机与校园有线服务器的连通性，但**专属活动校园域名、真实学生数据服务以及 500 人现场吞吐并未验收**。校园版与 Cloudflare 版不能对同一场活动分别独立写入签到结果，必须选定唯一权威核销节点。

## 5. 验收与安全边界

| 已有证据 | 不应扩大解释为 |
| --- | --- |
| 正式 Android 1.x 的 DXC 登录、查询、会话恢复、通知/快照具有真机测试记录 | 所有校区、支付完整交易均经验证 |
| Beta.2 GitHub CI 的 Web 构建、Android Kotlin 测试、Debug APK Artifact 均成功 | Beta.2 全部功能已通过多机型现场实扫验收 |
| 活动虚构数据测试完成约 38 次实际 HTTPS 端到端请求，包括上传、审核、QR 并发互斥及 CSV | 学校身份认证、真实学生数据上线、安全审计及 500 人压力测试已通过 |
| 校园 Wi-Fi 手机访问校内有线 HTTPS 服务器成功、证书正常 | 已完成独立活动内网服务部署，或 GPS / 摄像头权限均稳定可用 |

现阶段尤其需要控制以下风险：公开演练站共用测试密码，仅允许 `demo_`、`TEST-` 等虚构资料；不得使用真实姓名学号和朋友圈截图；位置仅作为辅助信号，允许人工通道；所有图片与候选名单需要数据留存、删除、访问审计和授权撤销制度；DeepSeek 只作可选人工辅助，涉及真实图片前必须完成个人信息告知与单独同意。学校正式活动票由学校认定。

## 6. 仓库结构与开发入口

```text
scutBombax/
├── android/                         Android / Kotlin / Gradle 工程
│   └── app/src/main/java/...        ScutApi、业务仓储及 beta.2 ActivityPortal
├── src/                             TypeScript UI、状态机、Material 3、活动入口
├── index.html                       App 主视图
├── docs/                            协议、架构、设备验收、充值说明
├── scripts/                         隐私扫描、构建及环境检查
├── .github/workflows/              Beta 与活动分支的 CI 流程
└── activity-quickcheck/             活动本地 MVP 与 Cloudflare 后端（活动分支）
    ├── server.mjs / db.mjs          Node + SQLite 本地服务
    ├── cloudflare-live/             Worker、D1 迁移、网页扫码
    ├── public/                      活动界面
    ├── tests/                       审核、扫码、身份与安全边界测试
    └── docs/campus-network-pilot.md 校园内网架构规划
```

**Android 2.0 Beta 从对应分支构建：**

```bash
# 必须在 release/2.0.0-beta 分支或该分支独立工作区操作
pnpm install --frozen-lockfile
pnpm check:privacy && pnpm check:dom && pnpm test
pnpm build
pnpm exec cap sync android
cd android
../scripts/with-jdk.sh ./gradlew testDebugUnitTest assembleDebug
# 输出：android/app/build/outputs/apk/debug/app-debug.apk
```

**活动测试（在活动后端开发分支）：**

```bash
cd activity-quickcheck
npm ci
npm test
# 测试站发布需要单独授权的 Wrangler 凭据及受保护的本地配置；
# 不得将凭据、学校 Cookie 或正式数据提交到 Git。
```

## 7. 仓库检查结果与改进建议

**总体判断：** Android 正式版已经形成可交付的工程基础；2.0 Beta 和活动签到均具备独立实现与自动构建能力。但公共仓库的**顶层简介与版本状态不够同步**，应优先整理，以免外部读者误认为所有分支都是已发布产品。

| 优先级 | 发现的问题 | 建议动作 |
| --- | --- | --- |
| P0 | GitHub About 仅写“花工木棉”，无产品范围说明；`main/README.md` 首屏仍介绍早期单一 Android 水电客户端。 | About 改为覆盖水电与活动的短句；README 第一屏增加当前版本矩阵及正式版/Beta 下载入口。 |
| P0 | README 存在早期“无 D1 / 无后台服务”的范围说明及旧版本号，容易与活动分支、当前正式版混淆。 | 将早期目标转入 `docs/HISTORY.md`；把 `main`、Beta、活动试验明确分栏，更新版本值。 |
| P0 | PR #9 文字仍以 beta.1 为主，而分支代码及成功构建已到 beta.2。 | 补充 beta.2 Release Notes、实际真机权限测试记录和最新 Actions 链接。 |
| P0 | 活动 Cloudflare 测试站和生产数据治理仍未合流，身份仅自填。 | 严格隔离虚构数据；正式上线前完成身份核验、隐私留存/删除、权限审计及压力测试。 |
| P1 | `main` 当前没有统一的 GitHub Actions 构建门禁；大部分能力在 Draft PR 与功能分支。 | 为主线设置基本测试工作流，明确 Beta 合并门槛和 PR 审核顺序。 |
| P1 | 仓库树中未发现根目录 `LICENSE` 文件。 | 若计划开源，明确并添加许可证；否则注明代码可见不代表可自由再利用。 |
| P1 | Beta Debug APK 仅放在短期保留的 Actions Artifact 中。 | 真机稳定后发布带说明与校验和的 Beta prerelease；区分 Debug 测试签名与可持续更新的签名包。 |
| P2 | iOS / HarmonyOS 分支处于实验状态，文档分散。 | 集中建立 `docs/PLATFORMS.md`，逐个平台列出构建、签名、真机和功能验收范围。 |

**建议的 GitHub About 描述：**

> 花工木棉（SCUT BOMBAX）：面向华南理工大学校园生活的非官方客户端，提供宿舍水电查询与活动报名签到试验模块。Android 2.0 Beta 使用 Material Design 3。

## 8. 下一阶段路线

1. **Beta.2 真机验收**：验证 App 内相机权限弹窗、扫码预览和真实光学识码、文件选择、GPS 无法定位时人工通道、返回键、Android 14/其他机型兼容性；独立记录通过与失败项目。
2. **发布整理**：更新仓库 README / About / PR #9，给 beta.2 准备发行说明、安装说明、校验和；签名策略确定前不要把 Debug 包当正式升级包。
3. **活动现场可靠性**：限定唯一签到数据库、加入网络中断后的恢复策略、部署独立校内 HTTPS 域名、做 3–4 名扫码员与后台审核并行的真实压测。
4. **真实数据上线门槛**：身份校验、隐私告知、撤回和删除机制、审核员与扫码员操作审计、材料访问控制和 CSV 校方模板适配。
5. **多平台试验继续独立推进**：iOS 真机签名与余额验收，HarmonyOS 开发者签名与真机安装，再决定是否并入正式产品路线。

## 9. 可直接用于 GitHub README 的新版项目简介

> **花工木棉（SCUT BOMBAX）** 是面向华南理工大学校园生活的非官方开源准备阶段项目。Android v1.0.1 提供宿舍水电余额查询、历史趋势、主动刷新与官方充值入口；Android 2.0 Beta 正在使用 Material Design 3 构建“宿舍水电 + 活动速签”双模块客户端。活动速签支持报名、证明材料人工审核、现场 GPS 辅助校验、一次性二维码和人工到场兜底。Android 端将水电登录会话保留在本机原生层，活动服务使用独立的 HTTPS 域名和权限体系。

**安装与试用：** 稳定 Android 正式版使用 GitHub Release v1.0.1；2.0 Beta 使用对应分支 Actions 产出的测试签名 APK。活动网页的公开测试环境只接受虚构资料，所有模拟签到结果均不代表学校官方活动票。

**参与开发：** 项目以 Ubuntu + Node.js / pnpm + JDK 21 + Android SDK / Gradle 为核心构建环境，源码覆盖 Kotlin/OkHttp、Capacitor/TypeScript、Material Web 组件及独立 Node/Cloudflare 活动模块。提交前需完成隐私扫描、类型检查、业务测试和构建。不同功能分支通过 Draft PR 区分实验与主线。

**说明与限制：** 本项目与华南理工大学官方服务无隶属或背书关系；不应收集测试用户的真实支付凭证、学校 Cookie 或未获授权的个人材料。iOS 与 HarmonyOS 客户端仍在实验验证阶段，功能不可视为与 Android 正式版一致。

## 10. 文档维护与交付建议

- 将本项目说明放入 `docs/PROJECT_OVERVIEW.md`，让根 README 保持一屏内的产品定位、版本矩阵、截图和下载入口；细节通过文档链接承接。
- 每次发布在 `docs/RELEASE_STATUS.md` 维护“版本号、提交 SHA、签名类型、下载地址、已验收/未验收”。PR 标题及正文应同步最新 Beta 版本号。
- 对活动站点分别标明“无持久化纯演示 / 虚构数据真实后端 / 校园内网试点 / 正式上线”四种状态，不允许使用统一的“已上线”字样混淆。
- 研发日志不得粘贴实名信息、宿舍号、截图原图、学校令牌、Cloudflare API 令牌或签名密钥；仓库检查工具继续作为合并门槛。

## 11. 参考链接

- [GitHub 仓库主页（main）](https://github.com/YanZhao1027/scutBombax)
- [正式发布 v1.0.1](https://github.com/YanZhao1027/scutBombax/releases/tag/v1.0.1)
- [Android 2.0 Beta 分支](https://github.com/YanZhao1027/scutBombax/tree/release/2.0.0-beta)
- [PR #9 — Android 2.0 Beta](https://github.com/YanZhao1027/scutBombax/pull/9)
- [beta.2 CI 成功构建与 APK Artifact](https://github.com/YanZhao1027/scutBombax/actions/runs/38429739680)
- [PR #7 — 活动本地 MVP](https://github.com/YanZhao1027/scutBombax/pull/7)
- [PR #8 — Cloudflare 活动后台](https://github.com/YanZhao1027/scutBombax/pull/8)
- [校园内网试点方案](https://github.com/YanZhao1027/scutBombax/blob/feat/activity-production-ai-review/activity-quickcheck/docs/campus-network-pilot.md)
- [PR #6 — iOS SideStore](https://github.com/YanZhao1027/scutBombax/pull/6)
- [PR #5 — HarmonyOS](https://github.com/YanZhao1027/scutBombax/pull/5)

---

*说明日期：2026-10-16。以上记录体现各自分支与测试阶段，不是校方授权、正式活动票认证或任何线上真实学生数据服务的上线声明。*