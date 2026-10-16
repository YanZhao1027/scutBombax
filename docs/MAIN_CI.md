# Android main 分支 CI 与验收

`main` 的 [android-main.yml](../.github/workflows/android-main.yml) 在针对 `main` 的 PR、主线 push 和手动触发时执行。权限为 `contents: read`，**不包含**签名密钥、校园凭据、Cloudflare 凭据或任何学生数据。

| 自动化门禁 | 指令 / 证据 | 自动化能够证明的范围 |
| --- | --- | --- |
| 依赖固定 | `pnpm install --frozen-lockfile` | 与锁文件同步 |
| 本地隐私形状规则 | `pnpm check:privacy` | 扫描仓库跟踪文件；个人本地 `privacy-denylist.local.txt` 不会提交，CI 不具备本机私有精确值清单 |
| DOM/业务逻辑 | `pnpm check:dom`、`pnpm test` | 现有静态检查和前端单测 |
| Web 产物 | `pnpm build`、`pnpm exec cap sync android` | TypeScript 编译与 Capacitor 同步 |
| 原生测试 / 安装包 | `testDebugUnitTest assembleDebug` | Kotlin/JVM 单测及测试签名 Debug APK 构建 |

**不是正式 Release：** 工作流上传的 7 天 Artifact 仅用于开发测试，签名与正式 `v1.0.1` 不同，不可充当升级包。正式 APK 必须遵守签名、版本号、校验和及人工发行流程；CI 绝不接触正式签名密钥。

**不代表真机验收：** CI 不会访问学校水电服务或校园账号，也不能证明相机扫码、GPS、系统文件选择器、多校区兼容性和支付交接已经通过。Android 2.0 Beta 仍使用独立的 [Beta workflow](https://github.com/YanZhao1027/scutBombax/blob/release/2.0.0-beta/.github/workflows/android-2-beta.yml) 和真机验收清单。

**合并建议：** PR 经代码审阅且此工作流首次成功后，在 GitHub 仓库 Settings → Branches / Rulesets 中把相应 job 设置为必过检查（若仓库计划启用保护）；仅提交工作流本身不会自动启用仓库规则。
