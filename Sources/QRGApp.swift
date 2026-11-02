import SwiftUI
import AppKit

@main
struct QRGApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
            .defaultSize(width: 1020, height: 760)
            .windowResizability(.contentMinSize)
    }
}

struct ContentView: View {
    @State private var content = "https://example.com"
    @State private var foreground = Color.black
    @State private var background = Color.white
    @State private var transparent = false
    @State private var shape = "tile"
    @State private var eyes = "rounded"
    @State private var margin = 4
    @State private var level = "H"
    @State private var version = 0
    @State private var size = 1024
    @State private var logo: URL?
    @State private var logoScale = 0.19
    @State private var logoPadding = 1
    @State private var crisp = false
    @State private var preview: NSImage?
    @State private var status = "输入链接后，点击生成预览。"
    @State private var busy = false
    @State private var lastPreviewSettings: [String] = []
    private let root = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? FileManager.default.currentDirectoryPath)

    var body: some View {
        HStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("二维码生成器").font(.largeTitle.bold())
                        Text("链接、样式与 Logo，一处完成。")
                            .foregroundStyle(.secondary)
                    }
                    GroupBox("内容") {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("链接或文字").font(.callout.weight(.medium))
                            TextField("https://", text: $content).textFieldStyle(.roundedBorder)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
                    }
                    GroupBox("外观") {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                ColorPicker("码颜色", selection: $foreground, supportsOpacity: false)
                                Spacer()
                                ColorPicker("背景颜色", selection: $background, supportsOpacity: false).disabled(transparent)
                            }
                            Toggle("透明背景", isOn: $transparent)
                            HStack {
                                Picker("码点", selection: $shape) {
                                    Text("方形").tag("square"); Text("瓷砖").tag("tile"); Text("圆形").tag("circle")
                                }
                                Picker("码眼", selection: $eyes) {
                                    Text("方形").tag("square"); Text("中圆角").tag("rounded")
                                }
                            }
                        }.padding(4)
                    }
                    GroupBox("规格") {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Picker("容错", selection: $level) { ForEach(["L", "M", "Q", "H"], id: \.self) { Text($0).tag($0) } }
                                Picker("版本", selection: $version) {
                                    Text("自动").tag(0)
                                    ForEach(1...40, id: \.self) { v in Text("\(17 + 4*v) × \(17 + 4*v)").tag(v) }
                                }
                            }
                            HStack {
                                Stepper("边距：\(margin) 格", value: $margin, in: 0...50)
                                Text("尺寸")
                                TextField("像素", value: $size, format: .number.grouping(.never)).frame(width: 75)
                                Text("px").foregroundStyle(.secondary)
                            }
                            Toggle("锐利像素边缘", isOn: $crisp)
                        }.padding(4)
                    }
                    GroupBox("中心 Logo") {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text(logo?.lastPathComponent ?? "未选择图片").lineLimit(1).foregroundStyle(logo == nil ? .secondary : .primary)
                                Spacer()
                                Button("选择…") { chooseLogo() }
                                if logo != nil { Button("移除") { logo = nil } }
                            }
                            HStack {
                                Text("大小 \(Int(logoScale * 100))%")
                                Slider(value: $logoScale, in: 0.05...0.25, step: 0.01)
                                Stepper("留白 \(logoPadding) px", value: $logoPadding, in: 0...40)
                            }.disabled(logo == nil)
                        }.padding(4)
                    }
                    HStack {
                        Button("生成预览") { generatePreview() }.keyboardShortcut(.defaultAction).disabled(busy || content.isEmpty)
                        if busy { ProgressView().controlSize(.small) }
                        Spacer()
                    }
                }.padding(24)
            }.frame(minWidth: 450, idealWidth: 500)
            Divider()
            VStack(spacing: 16) {
                HStack { Text("预览").font(.title2.bold()); Spacer() }
                Spacer(minLength: 0)
                ZStack {
                    RoundedRectangle(cornerRadius: 18).fill(Color(nsColor: .controlBackgroundColor))
                    if let preview {
                        Image(nsImage: preview).resizable().interpolation(.none).scaledToFit().padding(24)
                    } else {
                        VStack(spacing: 10) {
                            Image(systemName: "qrcode").font(.system(size: 70)).foregroundStyle(.tertiary)
                            Text("二维码预览").foregroundStyle(.secondary)
                        }
                    }
                }.aspectRatio(1, contentMode: .fit).frame(maxWidth: 430)
                Spacer(minLength: 0)
                Text(status).font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
                HStack {
                    Button("导出 PNG…") { export("png") }.disabled(busy || preview == nil)
                    Button("导出 SVG…") { export("svg") }.disabled(busy || preview == nil)
                    Spacer()
                }
            }.padding(24).frame(minWidth: 440, maxWidth: .infinity, maxHeight: .infinity)
        }.frame(minWidth: 950, minHeight: 700)
    }

    private func chooseLogo() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.png, .jpeg, .tiff, .gif]
        if panel.runModal() == .OK { logo = panel.url }
    }
    private func hex(_ color: Color) -> String {
        let c = NSColor(color).usingColorSpace(.sRGB) ?? .black
        return String(format: "#%02X%02X%02X", Int((c.redComponent*255).rounded()), Int((c.greenComponent*255).rounded()), Int((c.blueComponent*255).rounded()))
    }
    private func arguments() -> [String] {
        var a = [content, "--color", hex(foreground), "--background", transparent ? "transparent" : hex(background), "--module-shape", shape, "--eye-shape", eyes, "--margin", String(margin), "--error-correction", level, "--size", String(size)]
        if version > 0 { a += ["--version", String(version)] }
        if let logo { a += ["--logo", logo.path, "--logo-scale", String(logoScale), "--logo-padding-px", String(logoPadding)] }
        if crisp { a += ["--crisp"] }
        return a
    }
    private func run(_ args: [String], output: URL, verify: Bool, completion: @escaping (Result<String, Error>) -> Void) {
        busy = true
        let script = root.appendingPathComponent("qrg").path
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let task = Process(); task.executableURL = URL(fileURLWithPath: script)
                task.arguments = args + ["--output", output.path] + (verify ? ["--verify"] : [])
                let pipe = Pipe(); task.standardOutput = pipe; task.standardError = pipe
                try task.run()
                let data = pipe.fileHandleForReading.readDataToEndOfFile(); task.waitUntilExit()
                let message = String(data: data, encoding: .utf8) ?? ""
                let result: Result<String, Error> = task.terminationStatus == 0 ? .success(message) : .failure(NSError(domain: "QRG", code: Int(task.terminationStatus), userInfo: [NSLocalizedDescriptionKey: message]))
                DispatchQueue.main.async { busy = false; completion(result) }
            } catch { DispatchQueue.main.async { busy = false; completion(.failure(error)) } }
        }
    }
    private func generatePreview() {
        let settings = arguments()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("qrg-preview-\(UUID().uuidString).png")
        status = "正在生成并验证…"
        run(settings, output: url, verify: !transparent) { result in
            defer { try? FileManager.default.removeItem(at: url) }
            switch result {
            case .success:
                guard let image = NSImage(contentsOf: url) else { status = "无法读取生成的图片。"; return }
                preview = image; lastPreviewSettings = settings
                status = transparent ? "预览已生成。透明背景请在最终背景上扫码验证。" : "预览已生成，并通过 macOS 扫码验证。"
            case .failure(let error): status = error.localizedDescription
            }
        }
    }
    private func export(_ format: String) {
        guard arguments() == lastPreviewSettings else { status = "设置已更改，请先重新生成预览。"; return }
        let panel = NSSavePanel(); panel.nameFieldStringValue = "二维码.\(format)"
        panel.allowedContentTypes = [format == "png" ? .png : .svg]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        status = "正在导出…"
        run(lastPreviewSettings, output: url, verify: format == "png" && !transparent) { result in
            switch result {
            case .success: status = "已导出：\(url.path)"
            case .failure(let error): status = error.localizedDescription
            }
        }
    }
}
