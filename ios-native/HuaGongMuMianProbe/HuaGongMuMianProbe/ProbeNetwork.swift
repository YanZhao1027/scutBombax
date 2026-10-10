import Foundation

/// All network requests originate on this iPhone/iPad.
/// No Ubuntu relay, third-party SDK, API token, login or password is involved.
final class ProbeNetwork {
    private let session: URLSession
    private let host = "https://ecardwxnew.scut.edu.cn"

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        config.httpShouldSetCookies = true
        config.httpCookieAcceptPolicy = .always
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.httpAdditionalHeaders = [
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "User-Agent":
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                + "AppleWebKit/605.1.15 (KHTML, like Gecko) "
                + "Version/17.0 Mobile/15E148 Safari/604.1"
        ]
        session = URLSession(configuration: config)
    }

    func request(_ stage: ProbeStage) async throws -> ProbeObservation {
        guard let url = URL(string: host + stage.path),
              url.scheme == "https", url.host == "ecardwxnew.scut.edu.cn" else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 20
        request.cachePolicy = .reloadIgnoringLocalCacheData

        let (body, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        return ProbeInspector.inspect(body, httpStatus: status, stage: stage)
    }

    func finish() {
        // The ephemeral in-memory cookie jar is destroyed with this session.
        session.invalidateAndCancel()
    }
}
