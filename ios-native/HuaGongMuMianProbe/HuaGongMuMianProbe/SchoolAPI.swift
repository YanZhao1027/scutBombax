import Foundation

enum SchoolError: LocalizedError {
    case failure(String)
    var errorDescription: String? {
        if case .failure(let message) = self { return message }
        return nil
    }
}
struct Balance: Codable, Identifiable {
    var id = UUID()
    let time: Date
    let room: String
    let electric: Double
    let water: Double
}
struct Captcha {
    let key: String
    let image: Data
}
actor SchoolAPI {
    private let card = "ecardwxnew.scut.edu.cn"
    private let dxc = "dfyc.utc.scut.edu.cn"
    private final class ManualRedirect: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }
    private let redirect = ManualRedirect()
    private let client: URLSession
    private var accessToken: String?
    private var expiry: Date = .distantPast
    private var tgc = ""
    private var locSession = ""
    private var jsession: String?
    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = true
        configuration.httpCookieAcceptPolicy = .always
        configuration.timeoutIntervalForRequest = 18
        configuration.httpAdditionalHeaders = [
            "Accept":"application/json, text/plain, */*",
            "Accept-Language":"zh-CN,zh;q=0.9",
            "User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        ]
        client = URLSession(configuration: configuration, delegate: redirect, delegateQueue: nil)
    }
    private struct Reply {
        let status: Int
        let json: [String:Any]?
        let location: String?
    }
    private func address(_ path: String, host: String = "ecardwxnew.scut.edu.cn") throws -> URL {
        guard let url = URL(string:"https://" + host + path) else { throw SchoolError.failure("无效接口地址") }
        return url
    }
    private func value(_ object: [String:Any], _ key: String) -> String {
        if let v = object[key] as? String { return v }
        if let v = object[key] as? NSNumber { return v.stringValue }
        return ""
    }
    private func request(_ url: URL, post: [(String,String)]? = nil, headers: [String:String] = [:]) async throws -> Reply {
        guard url.scheme == "https", [card,dxc].contains(url.host ?? "") else {
            throw SchoolError.failure("学校跳转到未授权域名，已拒绝")
        }
        var r = URLRequest(url:url)
        r.cachePolicy = .reloadIgnoringLocalCacheData
        if let post {
            let safe = CharacterSet(charactersIn:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
            func escape(_ v: String) -> String { v.addingPercentEncoding(withAllowedCharacters:safe) ?? "" }
            r.httpMethod = "POST"
            r.httpBody = post.map { escape($0.0) + "=" + escape($0.1) }.joined(separator:"&").data(using:.utf8)
            r.setValue("application/x-www-form-urlencoded",forHTTPHeaderField:"Content-Type")
        }
        for (k,v) in headers { r.setValue(v,forHTTPHeaderField:k) }
        let (data,response) = try await client.data(for:r)
        guard let res = response as? HTTPURLResponse, data.count <= 1_500_000 else {
            throw SchoolError.failure("学校响应格式不正确或内容过长")
        }
        let json = (try? JSONSerialization.jsonObject(with:data)) as? [String:Any]
        return Reply(status:res.statusCode,json:json,location:res.value(forHTTPHeaderField:"Location"))
    }
    private func require(_ r: Reply, _ stage:String) throws -> [String:Any] {
        guard r.status == 200, let j = r.json else { throw SchoolError.failure("\(stage) HTTP \(r.status)") }
        return j
    }
    private func cookie(_ name:String, host:String) -> String {
        guard let url = URL(string:"https://" + host + "/") else { return "" }
        return client.configuration.httpCookieStorage?.cookies(for:url)?.first(where:{$0.name == name})?.value ?? ""
    }
    func captcha() async throws -> Captcha {
        let initReply = try await request(address("/berserker-app/frontInfo?synAccessSource=h5"))
        _ = try require(initReply,"登录配置")
        let r = try await request(address("/berserker-auth/oauth/captcha?synAccessSource=h5"))
        let j = try require(r,"验证码")
        let key = value(j,"key")
        let imageString = value(j,"image")
        guard !key.isEmpty, !imageString.isEmpty,
              let bytes = Data(base64Encoded:String(imageString.split(separator:",").last ?? "")) else {
            throw SchoolError.failure("验证码图片格式异常")
        }
        return Captcha(key:key,image:bytes)
    }
    private func encodedPassword(_ plain:String) async throws -> String {
        let r = try await request(address("/berserker-secure/keyboard?type=Standard&order=0&synAccessSource=h5"))
        let j = try require(r,"安全键盘")
        guard let data = j["data"] as? [String:Any] else { throw SchoolError.failure("安全键盘缺少 data") }
        let uuid = value(data,"uuid")
        let rows = [
            ("0123456789",value(data,"numberKeyboard")),
            ("qwertyuiopasdfghjklzxcvbnm",value(data,"lowerLetterKeyboard")),
            ("QWERTYUIOPASDFGHJKLZXCVBNM",value(data,"upperLetterKeyboard")),
            ("*\\-[]{}/!<,>?~&@#.:+|\u{60}%'$;^\"_",value(data,"symbolKeyboard"))
        ]
        guard !uuid.isEmpty,rows[0].1.count == 10,rows[1].1.count == 26,
              rows[2].1.count == 26,rows[3].1.count == 29 else {
            throw SchoolError.failure("学校安全键盘结构变化，已停止登录")
        }
        var encrypted = ""
        for char in plain {
            var found = false
            for (characters,tokens) in rows {
                if let index = characters.firstIndex(of:char) {
                    let position = characters.distance(from:characters.startIndex,to:index)
                    encrypted.append(tokens[tokens.index(tokens.startIndex,offsetBy:position)])
                    found = true
                    break
                }
            }
            if !found { throw SchoolError.failure("密码含有安全键盘未支持的字符") }
        }
        return encrypted + "$1$" + uuid
    }
    func login(user:String, pass:String, code:String, key:String, useCard:Bool) async throws {
        guard !user.isEmpty,!pass.isEmpty,!code.isEmpty,!key.isEmpty else {
            throw SchoolError.failure("请输入账号、密码、验证码")
        }
        accessToken = nil
        let encrypted = try await encodedPassword(pass)
        let parameters = [
            ("username",user),("password",encrypted),
            ("grant_type","password"),("scope","all"),
            ("loginFrom","h5"),("logintype",useCard ? "card" : "sno"),
            ("device_token","h5"),("synAccessSource","h5"),
            ("captcha_header_code",code),("captcha_header_key",key)
        ]
        let auth = "Basic bW9iaWxlX3NlcnZpY2VfcGxhdGZvcm06bW9iaWxlX3NlcnZpY2VfcGxhdGZvcm1fc2VjcmV0"
        let r = try await request(address("/berserker-auth/oauth/token"),post:parameters,headers:["Authorization":auth])
        let obj = r.json ?? [:]
        let token = value(obj,"access_token")
        guard r.status == 200,!token.isEmpty else {
            let c = value(obj,"code")
            if c == "8002" || c == "8003" { throw SchoolError.failure("验证码错误或过期，请刷新") }
            if c == "8000" { throw SchoolError.failure("学校拒绝账号或密码，请核对登录类型；不要连续尝试") }
            throw SchoolError.failure("登录失败 HTTP \(r.status)，业务码 \(c)")
        }
        let expires = Double(value(obj,"expires_in")) ?? 0
        guard expires > 0 else { throw SchoolError.failure("学校未返回登录有效期") }
        accessToken = token
        expiry = Date().addingTimeInterval(expires)
        tgc = cookie("TGC",host:card)
        locSession = cookie("locSession",host:card)
        jsession = nil
    }
    private func next(_ r: Reply,from url:URL) throws -> URL {
        guard r.status == 302,let location = r.location,
              let raw = URL(string:location,relativeTo:url)?.absoluteURL,
              var parts = URLComponents(url:raw,resolvingAgainstBaseURL:false) else {
            throw SchoolError.failure("SSO 跳转未返回预期的 302")
        }
        if parts.scheme == "http" { parts.scheme = "https" }
        guard let next = parts.url,next.scheme == "https",
              [card,dxc].contains(next.host ?? "") else {
            throw SchoolError.failure("SSO 尝试跳转到未知域名")
        }
        return next
    }
    private func establish(_ token:String) async throws -> String {
        var components = URLComponents()
        components.scheme = "https"
        components.host = card
        components.path = "/berserker-base/redirect"
        components.queryItems = [
            URLQueryItem(name:"appId",value:"360"),
            URLQueryItem(name:"loginFrom",value:"h5"),
            URLQueryItem(name:"synAccessSource",value:"h5"),
            URLQueryItem(name:"synjones-auth",value:token),
            URLQueryItem(name:"type",value:"app")
        ]
        guard let start = components.url else { throw SchoolError.failure("SSO URL 无效") }
        let cookieHeader = "TGC=\(tgc); locSession=\(locSession); error_times=0"
        let first = try await request(start,headers:["Cookie":cookieHeader])
        let secondURL = try next(first,from:start)
        let second = try await request(secondURL,headers:["Cookie":cookieHeader])
        let thirdURL = try next(second,from:secondURL)
        let id = cookie("JSESSIONID",host:dxc)
        guard !id.isEmpty else { throw SchoolError.failure("SSO 未下发 JSESSIONID") }
        if thirdURL.path == "/sdms-weixin-pay-sp/newWeixin/index.html" { return id }
        let ssoCookies = "JSESSIONID=\(id); " + cookieHeader
        let third = try await request(thirdURL,headers:["Cookie":ssoCookies])
        let fourthURL = try next(third,from:thirdURL)
        let fourth = try await request(fourthURL,headers:["Cookie":ssoCookies])
        let final = try next(fourth,from:fourthURL)
        guard final.path == "/sdms-weixin-pay-sp/newWeixin/index.html" else {
            throw SchoolError.failure("SSO 未抵达缴费系统")
        }
        return id
    }
    private func read(_ path:String, id:String) async throws -> [String:Any] {
        let r = try await request(address(path,host:dxc),headers:["Cookie":"JSESSIONID=" + id])
        let j = try require(r,"缴费系统")
        guard value(j,"statusCode") == "200" else { throw SchoolError.failure("缴费系统会话无效或请求失败") }
        return j
    }
    private func balance(id:String) async throws -> Balance {
        let info = try await read("/sdms-weixin-pay-sp/service/find/userinfo",id:id)
        let electricity = try await read("/sdms-weixin-pay-sp/service/ammeterBalance?type=1",id:id)
        let water = try await read("/sdms-weixin-pay-sp/service/waterBalance?type=3&systemType=1",id:id)
        guard let room = (info["resultObject"] as? [String:Any])?["roomName"] as? String,
              let e = electricity["resultObject"] as? [String:Any],
              let w = water["resultObject"] as? [String:Any],
              let eVal = Double(value(e,"leftMoney")),
              let wVal = Double(value(w,"leftMoney")) else {
            throw SchoolError.failure("余额返回字段不完整")
        }
        return Balance(time:Date(),room:room,electric:eVal,water:wVal)
    }
    func getBalance() async throws -> Balance {
        guard let token = accessToken,expiry.timeIntervalSinceNow > 300 else {
            throw SchoolError.failure("登录已过期，请重新登录")
        }
        if let id = jsession,let latest = try? await balance(id:id) { return latest }
        let id = try await establish(token)
        jsession = id
        return try await balance(id:id)
    }
    func logout() {
        accessToken = nil
        jsession = nil
        client.configuration.httpCookieStorage?.removeCookies(since:.distantPast)
    }
}
