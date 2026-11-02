import AppKit
import SwiftUI

@MainActor
final class FakeCommand {
    struct Request {
        let args: [String]
        let output: URL
        let verify: Bool
        let complete: (Result<String, Error>) -> Void
    }
    var requests: [Request] = []

    func run(_ args: [String], _ output: URL, _ verify: Bool, _ completion: @escaping (Result<String, Error>) -> Void) {
        requests.append(Request(args: args, output: output, verify: verify, complete: completion))
    }

    func succeed(_ index: Int) throws {
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 2, pixelsHigh: 2, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        try bitmap.representation(using: .png, properties: [:])!.write(to: requests[index].output)
        requests[index].complete(.success("ok"))
    }

    func fail(_ index: Int) {
        requests[index].complete(.failure(NSError(domain: "Test", code: 1, userInfo: [NSLocalizedDescriptionKey: "无效设置"])))
    }
}

@main
@MainActor
struct EditorTests {
    static func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else { fatalError(message) }
    }

    static func waitFor(_ condition: () -> Bool) async {
        for _ in 0..<200 {
            if condition() { return }
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
        fatalError("Timed out waiting for preview")
    }

    static func main() async throws {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let fake = FakeCommand()
        let editor = QRGEditor(root: root, debounceNanoseconds: 0, run: fake.run)

        editor.start()
        await waitFor { fake.requests.count == 1 }
        check(fake.requests[0].args.first == "https://example.com", "Initial preview must start automatically")
        check(!editor.canExport, "Export must wait for preview")

        editor.update(\.content, to: "first edit", coalescing: true)
        editor.update(\.content, to: "latest edit", coalescing: true)
        await waitFor { editor.updating }
        // Let the latest debounce fire while the first command is still running.
        try? await Task.sleep(nanoseconds: 20_000_000)
        check(fake.requests.count == 1, "Preview commands must be serial")
        fake.fail(0)
        check(fake.requests.count == 2, "Latest queued edit must run after the old command")
        check(fake.requests[1].args.first == "latest edit", "Intermediate edits must be skipped")
        check(editor.status != "无效设置", "Stale errors must be ignored")
        try fake.succeed(1)
        check(editor.canExport && editor.preview != nil, "Latest preview must enable export")
        check(!FileManager.default.fileExists(atPath: fake.requests[1].output.path), "Preview temporary files must be removed")

        editor.undo()
        check(editor.settings == QRSettings(), "Continuous typing must undo as one edit")
        check(!editor.canExport && editor.preview == nil, "Undo must invalidate the previous preview")
        await waitFor { fake.requests.count == 3 }
        editor.redo()
        check(editor.settings.content == "latest edit", "Redo must restore content")
        // Complete the previous generation before the new debounce fires.
        try fake.succeed(2)
        check(editor.preview == nil, "A stale success must not restore the old image")
        await waitFor { fake.requests.count == 4 }
        try fake.succeed(3)
        check(editor.canExport, "Redo must regenerate automatically")

        editor.update(\.content, to: "")
        check(!editor.updating && !editor.canExport && editor.preview == nil, "Empty content must clear preview and stop waiting")
        let requestCount = fake.requests.count
        try? await Task.sleep(nanoseconds: 20_000_000)
        check(fake.requests.count == requestCount, "Empty content must not launch a command")
        editor.undo()
        await waitFor { fake.requests.count == 5 }
        try fake.succeed(4)

        let output = FileManager.default.temporaryDirectory.appendingPathComponent("qrg-test-export-\(UUID().uuidString).svg")
        editor.export("svg", to: output)
        check(fake.requests.count == 6 && !fake.requests[5].verify && editor.exporting, "SVG export must use current validated settings without PNG verification")
        editor.update(\.transparent, to: true)
        fake.requests[5].complete(.success("ok"))
        check(editor.updating && editor.status == "正在更新预览…", "Export completion must not overwrite a newer preview state")
        await waitFor { fake.requests.count == 7 }
        check(!fake.requests[6].verify, "Transparent preview must skip Vision verification")
        fake.fail(6)
        check(editor.preview == nil && !editor.canExport && !editor.updating, "Current failure must leave export disabled")
        editor.undo()
        await waitFor { fake.requests.count == 8 }
        check(fake.requests[7].verify, "Opaque preview must use Vision verification")
        try fake.succeed(7)
        check(editor.canExport, "Undo must recover from invalid settings")

        let history = QRGEditor(root: root, debounceNanoseconds: 1_000_000_000, run: fake.run)
        let initial = history.settings
        history.update(\.content, to: "history")
        history.update(\.foreground, to: .red)
        history.update(\.background, to: .yellow)
        history.update(\.transparent, to: true)
        history.update(\.shape, to: "circle")
        history.update(\.eyes, to: "square")
        history.update(\.margin, to: 6)
        history.update(\.level, to: "Q")
        history.update(\.version, to: 5)
        history.update(\.size, to: 400)
        history.update(\.logo, to: root.appendingPathComponent("logo.png"))
        history.update(\.logoScale, to: 0.15)
        history.update(\.logoPadding, to: 4)
        history.update(\.crisp, to: true)
        let modified = history.settings
        for _ in 0..<14 { history.undo() }
        check(history.settings == initial && !history.canUndo && history.canRedo, "Undo must restore every setting")
        for _ in 0..<14 { history.redo() }
        check(history.settings == modified && history.canUndo && !history.canRedo, "Redo must restore every setting")
        history.undo()
        history.update(\.margin, to: 8)
        check(!history.canRedo, "A new edit must clear the redo branch")
        history.redo()
        check(history.settings.margin == 8 && !history.settings.crisp, "Redo must not resurrect discarded edits")
        print("PASS: automatic preview, latest edit races, export consistency, failure recovery, complete undo/redo and branching")
    }
}
