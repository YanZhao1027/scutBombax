# 花工木棉 · HarmonyOS 原生实验版

**状态：0.1.0 技术预览 / 暂不面向其他学生分发。**

独立分支 feat/harmony-native：参考 Android 1.0.1 的协议移植。
应用仅向华南理工大学自有主机发请求（ecardwxnew.scut.edu.cn 和 dfyc.utc.scut.edu.cn）。
没有 Ubuntu / Cloudflare 中继、遥测或后台定时轮询。

## 已实现（已编译；真实学校账号与余额尚未验证）

- HarmonyOS ArkUI 页面：大学城 / 广州国际校区、校园卡账号 / 学工号、查询密码、图形验证码。
- frontInfo → captcha → secure keyboard → OAuth token，包含 Android v1.0.1 的四组安全键盘逐字符编码；明文密码不写盘。
- 大学城 DXC：校方 SSO 302 链与 JSESSIONID、本机水电余额查询，支持会话复用和单次失效重建。
- 广州国际校区 GZIC：费用项 1/2/3 顺序查询电、水、空调余额。
- 成功查询后只保存本机余额快照。提供 7/30/90 天的电费、水费独立纵轴趋势图和最近十条查询记录。
- 退出时清除令牌及 Cookie，历史仅包含时间、校区及余额，不保存学号、房号、密码或 Token。
- 只有用户主动点击按钮才会访问校园接口。禁止自动跳转，SSO 目的地仅允许 scut.edu.cn 的 HTTPS 子域名。
- 完整木棉图标，HarmonyOS 5.0 (API12) 起的兼容目标，无第三方运行时网络 SDK。

**特别注意：** 此版本是已完成源码/unsigned HAP 编译的原生实验，并非已在手机上用真实账号验证成功的正式查询版。调试者绝不应要求测试者把密码、验证码 Key、Session Cookie 或完整学校 JSON 发到聊天或 Issues。

## macOS + DevEco Studio 真机签名

打开 MacBook Air 的终端：

    git clone https://github.com/YanZhao1027/scutBombax.git
    cd scutBombax
    git fetch origin feat/harmony-native
    git switch --track origin/feat/harmony-native

已有同名仓库时，进入现有仓库目录、跳过 clone，并 fetch/switch 即可。

在 DevEco Studio 6.x 选择 Open，打开仓库中的 harmony 子目录（不要直接打开 Android 项目）。按顺序完成：

**签名包名已修正：`cn.scut.bombax.hmapp`。** 之前的 `cn.scut.bombax.harmony` 使用了华为保留字段 `harmony`，会导致自动签名拒绝。请先拉取最新 `feat/harmony-native` 提交并在 DevEco Studio 中重新同步工程；若此前的签名配置绑定旧包名，则在 Signing Configs 中重新生成自动签名，切勿继续使用旧包名的签名信息。

1. 在 DevEco Studio 中安装 HarmonyOS SDK 5.1 或更高版本，并同步工程。
2. 把手机从 Ubuntu 拔下接到 Mac，解锁并在手机端授权 USB 调试。
3. 进入 File → Project Structure → Project → Signing Configs；选择 `default` 产品，勾选 Automatically generate signature。未登录时用本人华为开发者账号登录，等待出现已生成的 Debug Certificate / Provisioning Profile，再按 Apply / OK。内部调试可选择自动签名。
4. 确认工程级 `build-profile.json5`：`app.products` 下 `name: "default"` 的产品必须有 `signingConfig: "default"`；并且 `app.signingConfigs` 中已由 DevEco 自动产生同名 `default` 项及本机签名材料。若数组仍是 `[]`，说明**并未完成实际签名**，安装将报 `9568320 no signature file`。仓库中的空数组只是公开源码模板。
5. 如果此前修改过包名或出现无签名错误，先清理签名旧记录 / 重新执行自动签名，然后 Build → Clean Project、Build → Build Hap(s)，最后使用顶部 `entry` / `default` 运行配置，点击 Run，不要手动安装或选择 `entry-default-unsigned.hap`。
6. 选择已经连接的真机作为运行设备运行。**不要把自动生成的 .p12、.cer、.p7b、签名密码或带签名材料的 build-profile.json5 变化提交到公开仓库，也不要将其全部内容粘到聊天中。**
5. 在 App 中先按“检查接口”；成功后按“刷新验证码”，选择正确校区/登录类型，输入自己的**一卡通查询密码**及验证码，本机登录后点击“查询水电余额”。

任何 AGC / 开发者认证 / 签名授权都应由手机持有人在 DevEco GUI 完成；**不要向协作者发送 Huawei ID 密码或私钥。**

此前 Ubuntu HDC 实测：设备连接状态 Connected，ARM64、API 24；无签名安装被系统以错误码 9568320 拒绝（no signature file）。这属于预期的签名权限限制，不说明应用功能不正确或已经成功。

华为官方自动签名说明：
https://developer.huawei.com/consumer/cn/doc/HarmonyOS-Guides/ide-signing-auto

## Ubuntu 命令行构建（仅 unsigned HAP）

环境需要华为官方 HarmonyOS command-line-tools、Node.js 22，并设置：

    export HARMONY_TOOLS="$HOME/your-command-line-tools"
    ./harmony/build-linux.sh

输出：harmony/entry/build/default/outputs/default/entry-default-unsigned.hap

**切勿把未签名 HAP 当作可安装在商业设备的发行版本。**
所有构建缓存、官方 SDK、认证材料都放在仓库以外或被 .gitignore 排除。

## 协议回归测试（完全离线）

仓库根目录：

    pnpm install
    node --test harmony/tests/*.test.cjs

测试执行真实的 ArkTS Protocol / SchoolClient 代码（通过 TypeScript 编译为测试可执行代码），使用完全合成的假键盘、假登录及余额数据。覆盖安全键盘字符映射、密码表单、学校域名限制、大学城及国际校区查询、单点登录重建、退出清空会话和仅余额历史投影。GitHub Actions 会持续运行。

## 已知边界与正式上架

- 当前暂不持久化 OAuth 会话；应用进程重启后需要重新登录。这是本机隐私防护的取舍。后续若加入免重复登录，必须使用 HarmonyOS 安全凭据存储并补足威胁模型。
- 校外 IP 可能被学校网关拒绝，必要时使用校园网或校方官方 SSLVPN。
- 大学城电费 leftMoney 的单位“元”已在 Android 项目中经用户与校方页面核对；水费接口不提供明确单位，故仅显示“平台返回余额”。
- 当前不包含后台余额通知、充值收款或定时访问。
- 免费开发者账号可以探索真机签名，但公开应用市场上架需满足华为审核、开发者资质、App 备案等要求；编译成功不等于已审核通过。
- 正式发布前需本人在手机上逐项验证：启动、无凭据接口、登录成功、两个校区读数、重复查询、历史保存与重启行为。两校区分别需要拥有合法账号的测试者进行自愿验证。
