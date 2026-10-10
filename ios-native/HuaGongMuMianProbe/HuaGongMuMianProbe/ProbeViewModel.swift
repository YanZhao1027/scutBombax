import Foundation
import UIKit

enum ProbeState {
    case pending
    case running
    case passed
    case failed

    var label: String {
        switch self {
        case .pending: return "未检测"
        case .running: return "请求中"
        case .passed: return "通过"
        case .failed: return "待排查"
        }
    }

    var systemImage: String {
        switch self {
        case .pending: return "circle.dashed"
        case .running: return "arrow.triangle.2.circlepath"
        case .passed: return "checkmark.circle.fill"
        case .failed: return "exclamationmark.circle.fill"
        }
    }
}

struct ProbeItem: Identifiable {
    let stage: ProbeStage
    var state: ProbeState = .pending
    var summary: String = "尚未发起请求"
    var id: ProbeStage { stage }
}

@MainActor
final class ProbeViewModel: ObservableObject {
    @Published private(set) var items: [ProbeItem] =
        ProbeStage.allCases.map { ProbeItem(stage: $0) }
    @Published private(set) var isRunning = false
    @Published private(set) var lastChecked: Date?
    @Published private(set) var captchaPreview: UIImage?

    func begin() {
        guard !isRunning else { return }
        isRunning = true
        lastChecked = nil
        captchaPreview = nil
        items = ProbeStage.allCases.map { ProbeItem(stage: $0) }

        Task {
            let client = ProbeNetwork()
            defer {
                client.finish()
                isRunning = false
                lastChecked = Date()
            }
            // Order matters: iPhone Shortcuts succeeded after frontInfo -> captcha.
            // The SAME URLSession carries in-memory cookies through the sequence.
            for stage in ProbeStage.allCases {
                set(stage, state: .running, summary: "等待学校回应…")
                do {
                    let result = try await client.request(stage)
                    let info = "HTTP " + String(result.status)
                        + " · 业务码 " + result.code + "\n" + result.detail
                    set(stage, state: result.passed ? .passed : .failed, summary: info)
                    if stage == .captcha, let data = result.captchaImage {
                        captchaPreview = UIImage(data: data)
                    }
                } catch {
                    let kind: String
                    if let networkError = error as? URLError {
                        kind = "网络错误：" + String(networkError.code.rawValue)
                    } else {
                        kind = "请求未成功（未记录返回正文）"
                    }
                    set(stage, state: .failed, summary: kind)
                }
            }
        }
    }

    private func set(_ stage: ProbeStage, state: ProbeState, summary: String) {
        guard let index = items.firstIndex(where: { $0.stage == stage }) else { return }
        items[index].state = state
        items[index].summary = summary
    }
}
