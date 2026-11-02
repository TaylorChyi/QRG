import SwiftUI
import AppKit

struct QRSettings: Equatable {
    var content = "https://example.com"
    var foreground = Color.black
    var background = Color.white
    var transparent = false
    var shape = "tile"
    var eyes = "rounded"
    var margin = 4
    var level = "H"
    var version = 0
    var size = 1024
    var logo: URL?
    var logoScale = 0.19
    var logoPadding = 1
    var crisp = false

    var arguments: [String] {
        var args = [content, "--color", hex(foreground), "--background", transparent ? "transparent" : hex(background), "--module-shape", shape, "--eye-shape", eyes, "--margin", String(margin), "--error-correction", level, "--size", String(size)]
        if version > 0 { args += ["--version", String(version)] }
        if let logo { args += ["--logo", logo.path, "--logo-scale", String(logoScale), "--logo-padding-px", String(logoPadding)] }
        if crisp { args += ["--crisp"] }
        return args
    }

    private func hex(_ color: Color) -> String {
        let c = NSColor(color).usingColorSpace(.sRGB) ?? .black
        return String(format: "#%02X%02X%02X", Int((c.redComponent * 255).rounded()), Int((c.greenComponent * 255).rounded()), Int((c.blueComponent * 255).rounded()))
    }
}

typealias QRCommand = ([String], URL, Bool, @escaping (Result<String, Error>) -> Void) -> Void

@MainActor
final class QRGEditor: ObservableObject {
    @Published private(set) var settings = QRSettings()
    @Published private(set) var preview: NSImage?
    @Published private(set) var status = "修改内容或样式，预览会自动更新。"
    @Published private(set) var updating = false
    @Published private(set) var exporting = false
    @Published private(set) var canUndo = false
    @Published private(set) var canRedo = false

    private var past: [QRSettings] = []
    private var future: [QRSettings] = []
    private var editGroup: AnyKeyPath?
    private var lastEdit = Date.distantPast
    private var renderedSettings: QRSettings?
    private var revision = 0
    private var generating = false
    private var pending: (settings: QRSettings, revision: Int)?
    private var debounceTask: Task<Void, Never>?
    private var started = false
    private let debounceNanoseconds: UInt64
    private let run: QRCommand

    init(root: URL, debounceNanoseconds: UInt64 = 300_000_000, run: QRCommand? = nil) {
        self.debounceNanoseconds = debounceNanoseconds
        self.run = run ?? { args, output, verify, completion in
            DispatchQueue.global(qos: .userInitiated).async {
                let result: Result<String, Error>
                do {
                    let task = Process()
                    task.executableURL = root.appendingPathComponent("qrg")
                    task.arguments = args + ["--output", output.path] + (verify ? ["--verify"] : [])
                    let pipe = Pipe()
                    task.standardOutput = pipe; task.standardError = pipe
                    try task.run()
                    let data = pipe.fileHandleForReading.readDataToEndOfFile()
                    task.waitUntilExit()
                    let message = String(data: data, encoding: .utf8) ?? ""
                    result = task.terminationStatus == 0 ? .success(message) : .failure(NSError(domain: "QRG", code: Int(task.terminationStatus), userInfo: [NSLocalizedDescriptionKey: message]))
                } catch { result = .failure(error) }
                DispatchQueue.main.async { completion(result) }
            }
        }
    }

    var canExport: Bool { preview != nil && renderedSettings == settings && !updating && !exporting }

    func binding<Value>(_ field: WritableKeyPath<QRSettings, Value>, coalescing: Bool = false) -> Binding<Value> {
        Binding(get: { self.settings[keyPath: field] }, set: { self.update(field, to: $0, coalescing: coalescing) })
    }

    func update<Value>(_ field: WritableKeyPath<QRSettings, Value>, to value: Value, coalescing: Bool = false) {
        var next = settings
        next[keyPath: field] = value
        guard next != settings else { return }
        let now = Date()
        if !(coalescing && editGroup == field && now.timeIntervalSince(lastEdit) < 0.6 && !past.isEmpty && future.isEmpty) {
            past.append(settings)
        }
        future.removeAll()
        editGroup = coalescing ? field : nil
        lastEdit = now
        apply(next)
    }

    func undo() {
        guard let previous = past.popLast() else { return }
        future.append(settings)
        editGroup = nil
        apply(previous)
    }

    func redo() {
        guard let next = future.popLast() else { return }
        past.append(settings)
        editGroup = nil
        apply(next)
    }

    func start() {
        guard !started else { return }
        started = true
        schedulePreview()
    }

    private func apply(_ next: QRSettings) {
        settings = next
        canUndo = !past.isEmpty
        canRedo = !future.isEmpty
        schedulePreview()
    }

    private func schedulePreview() {
        revision += 1
        debounceTask?.cancel()
        pending = nil
        preview = nil
        renderedSettings = nil
        updating = !settings.content.isEmpty
        guard updating else { status = "输入链接或文字后会自动生成预览。"; return }
        status = "正在更新预览…"
        let request = (settings: settings, revision: revision)
        debounceTask = Task { [weak self] in
            guard let self else { return }
            do { try await Task.sleep(nanoseconds: debounceNanoseconds) }
            catch { return }
            guard request.revision == revision else { return }
            pending = request
            generateNextPreview()
        }
    }

    private func generateNextPreview() {
        guard !generating, let request = pending else { return }
        pending = nil
        generating = true
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("qrg-preview-\(UUID().uuidString).png")
        run(request.settings.arguments, url, !request.settings.transparent) { [weak self] result in
            defer { try? FileManager.default.removeItem(at: url) }
            guard let self else { return }
            generating = false
            defer { generateNextPreview() }
            // A completion from an earlier edit must never replace the current preview or error.
            guard request.revision == revision else { return }
            updating = false
            switch result {
            case .success:
                guard let data = try? Data(contentsOf: url), let image = NSImage(data: data) else {
                    status = "无法读取生成的图片。"; return
                }
                preview = image
                renderedSettings = request.settings
                status = request.settings.transparent ? "预览已自动更新。透明背景请在最终背景上扫码验证。" : "预览已自动更新，并通过 macOS 扫码验证。"
            case .failure(let error): status = error.localizedDescription
            }
        }
    }

    func export(_ format: String, to url: URL) {
        guard canExport else { return }
        let request = settings
        let exportRevision = revision
        exporting = true
        status = "正在导出…"
        run(request.arguments, url, format == "png" && !request.transparent) { [weak self] result in
            guard let self else { return }
            exporting = false
            guard exportRevision == revision else { return }
            switch result {
            case .success: status = "已导出：\(url.path)"
            case .failure(let error): status = error.localizedDescription
            }
        }
    }
}
