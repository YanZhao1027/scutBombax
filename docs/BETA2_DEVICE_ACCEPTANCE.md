# Android 2.0.0-beta.2 真机验收记录（2026-10-16）

> **状态：构建通过，真机未完成。** 本文仅记录本轮已有证据，不能把手机接上 USB 或 Android CI 成功误写为相机/GPS/文件选择器已经验收。

## 本轮 Ubuntu 独立环境证据

- 核查分支：`release/2.0.0-beta`，起点提交 `b1a0a83a333d5831d3c23ea98347803a560196a8`。
- 在单独的干净 worktree 使用 `pnpm install --frozen-lockfile`，`pnpm check:privacy`、`pnpm check:dom`、`pnpm test`（**78/78 通过**），`pnpm build`、`pnpm exec cap sync android` 均成功。
- `../scripts/with-jdk.sh ./gradlew --no-daemon testDebugUnitTest assembleDebug` 显示 **BUILD SUCCESSFUL**，构建了约 4.9 MB 的 Beta Debug APK。
- Ubuntu 检测到一台 USB 安卓设备，但 ADB 状态为 **unauthorized**。未获 USB 调试授权前无法读取 Android 版本、安装 APK、运行应用或访问权限弹窗。本轮**没有使用**屏幕解锁码，也没有访问校园身份、图片或学号。

## 安全预检与设备验收

授权后从 Beta 工程根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build && pnpm exec cap sync android
cd android && ../scripts/with-jdk.sh ./gradlew testDebugUnitTest assembleDebug && cd ..
sh scripts/beta-device-preflight.sh
```

该脚本先检查 ADB 授权和 APK 的 `cn.scut.bombax.beta` 包名，然后才会安装并启动 **Beta**，不会卸载稳定版或自动发送真实数据；签名冲突时不自动卸载。只检查安装/启动，以下人工项目不能由这个脚本证明。

| 项目 | 当前结果 | 真机通过条件 |
| --- | --- | --- |
| Debug APK 构建 / Kotlin 单测 | **通过（Ubuntu）** | CI/JVM 已通过；不等于设备可用 |
| USB ADB 授权 | **阻塞：unauthorized** | 屏幕解锁，接受信任本台 Ubuntu 电脑的 USB 调试弹窗；`adb get-state` 为 `device` |
| Beta 安装启动 | **未验证** | 包名为 `cn.scut.bombax.beta`，可与 `cn.scut.bombax` 正式版并存 |
| 双入口及业务隔离 | **未验证** | 切换宿舍水电/活动速签正常；活动 WebView 不暴露校方原生 `ScutApi` |
| App 内摄像头权限 | **未验证** | 只在用户按扫码后弹窗；允许后显示真实相机预览；拒绝后有明确提示 |
| 动态二维码光学实扫 | **未验证** | 使用虚构数据演练站，另一设备显示未过期二维码；物理摄像头识码并由授权扫码员核销，仅成功一次 |
| GPS 定位与人工兜底 | **未验证** | 授权后位置判断可用；室内失败/拒绝授权时可转人工到场 |
| 证明材料系统文件选择器 | **未验证** | 仅选择内置模拟 PNG；取消、返回和重新打开正常；不要使用真实照片 |
| Android 返回键/全屏扫码 | **未验证** | 先退出扫码/工作台，再回主界面；无卡死、无留存摄像头 |
| Android 14 和其他机型 | **未验证（本轮）** | 按设备逐项记录系统版本、WebView 版本、通过/失败及时间 |
| 校园水电登录/充值回归 | **未验证（本轮）** | 需持有者在实际校园环境自愿手动验证，不采集校园密码或支付凭证 |

**边界：** 活动站只使用 `demo_` / `TEST-` 等虚构身份和内置模拟截图。真实身份核验、个人信息删除/撤回、独立校园域名及 500 人压测尚未完成。不能因 UI 可用便宣称“正式上线”。

记录结果时保留时间、测试设备的大致 Android 版本、功能是否通过及**脱敏**错误类别。不要把锁屏 PIN、学校账号、照片原图、精确位置、二维码令牌、Cookie 或密钥写进 PR、终端日志或截图。
