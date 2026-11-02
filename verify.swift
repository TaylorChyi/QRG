import Foundation
import Vision

guard CommandLine.arguments.count == 2 else { exit(2) }
do {
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    try VNImageRequestHandler(url: URL(fileURLWithPath: CommandLine.arguments[1])).perform([request])
    guard let result = request.results?.first?.payloadStringValue else { exit(1) }
    print(result)
} catch {
    fputs("二维码识别失败: \(error)\n", stderr)
    exit(1)
}
