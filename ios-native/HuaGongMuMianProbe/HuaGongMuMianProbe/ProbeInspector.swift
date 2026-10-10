import Foundation

/// This intentionally inspects response shapes only: never display or persist
/// captcha keys, secure-keyboard tokens, UUIDs, account IDs, or full JSON bodies.
enum ProbeStage: String, CaseIterable, Identifiable {
    case frontInfo
    case captcha
    case keyboard

    var id: Self { self }

    var title: String {
        switch self {
        case .frontInfo: return "登录配置"
        case .captcha: return "图形验证码"
        case .keyboard: return "安全键盘"
        }
    }

    var path: String {
        switch self {
        case .frontInfo:
            return "/berserker-app/frontInfo?synAccessSource=h5"
        case .captcha:
            return "/berserker-auth/oauth/captcha?synAccessSource=h5"
        case .keyboard:
            return "/berserker-secure/keyboard?type=Standard&order=0&synAccessSource=h5"
        }
    }
}

struct ProbeObservation {
    let passed: Bool
    let status: Int
    let code: String
    let detail: String
    /// Optional preview in volatile memory, never written to disk.
    let captchaImage: Data?
}

enum ProbeInspector {
    static let limitBytes = 1_500_000

    static func inspect(
        _ body: Data,
        httpStatus: Int,
        stage: ProbeStage
    ) -> ProbeObservation {
        guard body.count <= limitBytes else {
            return ProbeObservation(
                passed: false, status: httpStatus, code: "—",
                detail: "响应超过安全大小上限", captchaImage: nil
            )
        }
        guard let root = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else {
            return ProbeObservation(
                passed: false, status: httpStatus, code: "—",
                detail: "服务器没有返回预期的 JSON", captchaImage: nil
            )
        }

        let code: String
        if let number = root["code"] as? NSNumber {
            code = number.stringValue
        } else if let string = root["code"] as? String {
            code = String(string.prefix(12))
        } else {
            code = "无"
        }
        let serviceOK = (code == "无" || code == "200")
        let httpOK = (httpStatus == 200)
        let responseOK = httpOK && serviceOK

        switch stage {
        case .frontInfo:
            let config = root["data"] as? [String: Any]
            let isH5 = config?["platType"] as? String == "h5"
            return ProbeObservation(
                passed: responseOK && isH5,
                status: httpStatus,
                code: code,
                detail: isH5
                    ? "platType=h5，已取得公开登录配置"
                    : "未取得预期的 h5 登录配置；检查校园网络与请求顺序",
                captchaImage: nil
            )

        case .captcha:
            // In the validated Android protocol the captcha lives at the root,
            // without a required service-code envelope.
            let key = root["key"] as? String ?? ""
            let rawImage = root["image"] as? String ?? ""
            let hasCaptcha = !key.isEmpty && !rawImage.isEmpty
            return ProbeObservation(
                passed: responseOK && hasCaptcha,
                status: httpStatus,
                code: code,
                detail: hasCaptcha
                    ? "key 与 image 均存在（未显示 key 值）"
                    : "验证码字段不完整；如果业务码为 401，请先检查前置请求",
                captchaImage: hasCaptcha && responseOK ? decodeCaptcha(rawImage) : nil
            )

        case .keyboard:
            let data = root["data"] as? [String: Any] ?? [:]
            let required = [
                "uuid", "numberKeyboard",
                "lowerLetterKeyboard", "upperLetterKeyboard",
                "symbolKeyboard"
            ]
            let missing = required.filter {
                guard let value = data[$0] as? String else { return true }
                return value.isEmpty
            }
            let names = data.keys.sorted()
            // Field NAMES only, not the random per-session keyboard values.
            let availableNames = names.prefix(24).joined(separator: "、")
            let detail: String
            if missing.isEmpty && !data.isEmpty {
                detail = "五个编码字段齐全；键名：" + availableNames
            } else {
                detail = "待确认字段：" + missing.joined(separator: "、")
                    + "；当前键名：" + (availableNames.isEmpty ? "无" : availableNames)
            }
            return ProbeObservation(
                passed: responseOK && missing.isEmpty,
                status: httpStatus,
                code: code,
                detail: detail,
                captchaImage: nil
            )
        }
    }

    private static func decodeCaptcha(_ raw: String) -> Data? {
        let encoded: String
        if let comma = raw.firstIndex(of: ",") {
            encoded = String(raw[raw.index(after: comma)...])
        } else {
            encoded = raw
        }
        guard encoded.utf8.count < limitBytes else { return nil }
        return Data(base64Encoded: encoded, options: .ignoreUnknownCharacters)
    }
}
