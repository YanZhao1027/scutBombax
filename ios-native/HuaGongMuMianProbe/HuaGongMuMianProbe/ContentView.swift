import SwiftUI

@MainActor final class MainModel: ObservableObject {
    @Published var user = ""
    @Published var password = ""
    @Published var code = ""
    @Published var useCard = false
    @Published var image: UIImage?
    @Published var status = "请先获取验证码"
    @Published var busy = false
    @Published var loggedIn = false
    @Published var reading: Balance?
    @Published var history: [Balance] = []
    private var key: String?
    private let api = SchoolAPI()
    private let historyKey = "huagongmumian.ios.dxc.history.v1"
    init() {
        if let data = UserDefaults.standard.data(forKey:historyKey),
           let decoded = try? JSONDecoder().decode([Balance].self,from:data) { history = decoded }
    }
    func captcha() {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                let challenge = try await api.captcha()
                key = challenge.key
                image = UIImage(data:challenge.image)
                code = ""
                status = "请输入图片中的验证码"
            } catch {
                key = nil
                image = nil
                status = error.localizedDescription
            }
        }
    }
    func login() {
        guard !busy,let key else { status = "请先获取验证码"; return }
        let name = user
        let secret = password
        let captchaCode = code
        busy = true
        Task {
            defer { busy = false; password = "" }
            do {
                try await api.login(user:name,pass:secret,code:captchaCode,key:key,useCard:useCard)
                loggedIn = true
                status = "登录成功，正在读取大学城水电余额"
                try await fetchInner()
            } catch {
                status = error.localizedDescription
                if !loggedIn { image = nil; self.key = nil; code = "" }
            }
        }
    }
    func fetch() {
        guard !busy,loggedIn else { return }
        busy = true
        Task {
            defer { busy = false }
            do { try await fetchInner() }
            catch { status = error.localizedDescription }
        }
    }
    private func fetchInner() async throws {
        let result = try await api.getBalance()
        reading = result
        history.insert(result,at:0)
        if history.count > 365 { history = Array(history.prefix(365)) }
        if let data = try? JSONEncoder().encode(history) {
            UserDefaults.standard.set(data,forKey:historyKey)
        }
        status = "水电余额更新成功"
    }
    func logout() {
        Task { await api.logout() }
        loggedIn = false
        key = nil
        code = ""
        password = ""
        image = nil
        reading = nil
        status = "已清除临时登录状态"
    }
    func clearHistory() {
        history = []
        UserDefaults.standard.removeObject(forKey:historyKey)
        status = "本机历史已清除"
    }
}

struct ContentView: View {
    @StateObject private var model = MainModel()
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment:.leading,spacing:18) {
                    header
                    if model.loggedIn { dashboard } else { loginForm }
                    if !model.history.isEmpty { historyPanel }
                    footer
                }
                .padding(16)
                .frame(maxWidth:650)
                .frame(maxWidth:.infinity)
            }
            .background(Color(uiColor:.systemGroupedBackground))
            .navigationTitle("花工木棉")
            .navigationBarTitleDisplayMode(.inline)
        }
        .tint(Color(red:0.09,green:0.42,blue:0.83))
    }
    private var header: some View {
        VStack(alignment:.leading,spacing:8) {
            Text("华工宿舍水电").font(.title2.bold())
            Text("SideStore iOS 实验版 · 大学城校区")
                .font(.subheadline).foregroundStyle(.secondary)
            Label(model.status,systemImage:"info.circle")
                .font(.footnote).foregroundStyle(.secondary)
                .fixedSize(horizontal:false,vertical:true)
        }.padding(18)
            .frame(maxWidth:.infinity,alignment:.leading)
            .background(.regularMaterial,in:RoundedRectangle(cornerRadius:18))
    }
    private var loginForm: some View {
        VStack(alignment:.leading,spacing:14) {
            Text("一卡通登录").font(.headline)
            Picker("账号类型",selection:$model.useCard) {
                Text("学工号").tag(false)
                Text("一卡通账号").tag(true)
            }.pickerStyle(.segmented)
            TextField("学工号或一卡通账号",text:$model.user)
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
            SecureField("一卡通密码（不保存）",text:$model.password)
                .textContentType(.password)
                .textFieldStyle(.roundedBorder)
            if let image = model.image {
                HStack(spacing:12) {
                    Image(uiImage:image).resizable().scaledToFit()
                        .frame(width:175,height:70)
                        .accessibilityLabel("学校验证码")
                    Button("换一张") { model.captcha() }.disabled(model.busy)
                }
                TextField("输入图片验证码",text:$model.code)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            Button("获取验证码") { model.captcha() }
                .disabled(model.busy)
                .buttonStyle(.bordered)
            Button {
                model.login()
            } label: {
                HStack {
                    if model.busy { ProgressView().tint(.white) }
                    Text(model.busy ? "正在请求学校…" : "登录并查询水电")
                }.frame(maxWidth:.infinity).padding(.vertical,8)
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.busy || model.image == nil || model.user.isEmpty || model.password.isEmpty || model.code.isEmpty)
        }
        .padding(18)
        .background(.regularMaterial,in:RoundedRectangle(cornerRadius:18))
    }
    private var dashboard: some View {
        VStack(alignment:.leading,spacing:14) {
            Text("大学城宿舍").font(.headline)
            if let reading = model.reading {
                Text(reading.room).font(.caption).foregroundStyle(.secondary)
                HStack(alignment:.firstTextBaseline) {
                    VStack(alignment:.leading,spacing:7) {
                        Text("剩余电费").font(.caption).foregroundStyle(.secondary)
                        Text(reading.electric,format:.number.precision(.fractionLength(2)))
                            .font(.largeTitle.bold()).monospacedDigit()
                        Text("元").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment:.leading,spacing:7) {
                        Text("水费平台余额").font(.caption).foregroundStyle(.secondary)
                        Text(reading.water,format:.number.precision(.fractionLength(2)))
                            .font(.title.bold()).monospacedDigit()
                        Text("单位待核实").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Text("读取时间：" + reading.time.formatted(date:.abbreviated,time:.shortened))
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Text("已登录，尚未取得本次余额")
                    .foregroundStyle(.secondary)
            }
            Button("立即刷新余额") { model.fetch() }
                .buttonStyle(.borderedProminent)
                .disabled(model.busy)
            Button("退出登录") { model.logout() }
                .buttonStyle(.bordered)
                .disabled(model.busy)
        }
        .padding(18)
        .background(.regularMaterial,in:RoundedRectangle(cornerRadius:18))
    }
    private var historyPanel: some View {
        VStack(alignment:.leading,spacing:10) {
            HStack {
                Text("本机历史").font(.headline)
                Spacer()
                Button("清空") { model.clearHistory() }.font(.caption)
            }
            ForEach(model.history.prefix(10)) { item in
                HStack {
                    Text(item.time,format:.dateTime.month().day().hour().minute())
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Text("电费 " + String(format:"%.2f",item.electric))
                        .monospacedDigit().font(.caption)
                }
                Divider()
            }
            Text("仅保存余额与宿舍名称，不保存密码和 Token。")
                .font(.caption2).foregroundStyle(.secondary)
        }
        .padding(18)
        .background(.regularMaterial,in:RoundedRectangle(cornerRadius:18))
    }
    private var footer: some View {
        VStack(alignment:.leading,spacing:6) {
            Label("只连接华工官方域名",systemImage:"lock.shield")
            Text("账号、密码、验证码与会话仅交由本机直接提交学校接口；没有开发者运营的中继服务器。首次真机登录未验证，避免短时间连续重试。")
            Text("首次版本仅针对大学城；广州国际校区暂不支持。")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(8)
    }
}
#Preview { ContentView() }
