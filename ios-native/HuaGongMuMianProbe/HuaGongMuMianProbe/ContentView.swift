import SwiftUI

struct ContentView: View {
    @StateObject private var model = ProbeViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    intro
                    diagnostics
                    if let image = model.captchaPreview {
                        captchaSection(image)
                    }
                    privacyNote
                }
                .padding(16)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("花工木棉")
            .navigationBarTitleDisplayMode(.inline)
        }
        .tint(Color(red: 0.08, green: 0.47, blue: 0.87))
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("iPhone 本机协议实验", systemImage: "iphone.gen3")
                .font(.headline)
            Text("不需要登录、不输入密码。检查学校登录配置、图形验证码和安全键盘是否能通过原生网络请求读取。")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Button(action: model.begin) {
                HStack(spacing: 8) {
                    if model.isRunning {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: "play.fill")
                    }
                    Text(model.isRunning ? "检测中…" : "运行三项无凭据检查")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.isRunning)
            .accessibilityIdentifier("start-probe")

            if let date = model.lastChecked {
                Text("最近检测：" + date.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(18)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    private var diagnostics: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("请求顺序")
                .font(.headline)
            ForEach(model.items) { item in
                VStack(alignment: .leading, spacing: 7) {
                    HStack(spacing: 8) {
                        Image(systemName: item.state.systemImage)
                            .foregroundStyle(item.state == .passed ? Color.green :
                                                item.state == .failed ? Color.orange : Color.secondary)
                        Text(item.stage.title).fontWeight(.medium)
                        Spacer()
                        Text(item.state.label)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Text(item.summary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                .padding(13)
                .background(Color(uiColor: .secondarySystemGroupedBackground),
                            in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private func captchaSection(_ image: UIImage) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("本机验证码预览")
                .font(.headline)
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: 210, maxHeight: 100)
                .accessibilityLabel("学校返回的验证码图片")
            Text("只在内存中展示；本实验不要求提交验证码，也不保存验证码 key。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    private var privacyNote: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("隐私与下一步", systemImage: "lock.shield")
                .font(.headline)
            Text("全部请求由本机 URLSession 直接访问华工一卡通，不经过 Ubuntu 或 Cloudflare。临时 Cookie 仅保存在本次运行的内存会话中。")
            Text("界面只显示 HTTP 状态、业务码及 JSON 字段名；不展示随机令牌、UUID 或密码。此版本尚不执行登录、读取余额或支付。")
            Text("若三项通过，再移植已验证的 Android 安全键盘编码及完整认证流程。不要在截图中分享令牌或个人信息。")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(16)
    }
}

#Preview {
    ContentView()
}
