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
    @StateObject private var editor = QRGEditor(root: URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? FileManager.default.currentDirectoryPath))

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
                            TextField("https://", text: editor.binding(\.content, coalescing: true)).textFieldStyle(.roundedBorder)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
                    }
                    GroupBox("外观") {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                ColorPicker("码颜色", selection: editor.binding(\.foreground, coalescing: true), supportsOpacity: false)
                                Spacer()
                                ColorPicker("背景颜色", selection: editor.binding(\.background, coalescing: true), supportsOpacity: false).disabled(editor.settings.transparent)
                            }
                            Toggle("透明背景", isOn: editor.binding(\.transparent))
                            HStack {
                                Picker("码点", selection: editor.binding(\.shape)) {
                                    Text("方形").tag("square"); Text("瓷砖").tag("tile"); Text("圆形").tag("circle")
                                }
                                Picker("码眼", selection: editor.binding(\.eyes)) {
                                    Text("方形").tag("square"); Text("中圆角").tag("rounded")
                                }
                            }
                        }.padding(4)
                    }
                    GroupBox("规格") {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Picker("容错", selection: editor.binding(\.level)) { ForEach(["L", "M", "Q", "H"], id: \.self) { Text($0).tag($0) } }
                                Picker("版本", selection: editor.binding(\.version)) {
                                    Text("自动").tag(0)
                                    ForEach(1...40, id: \.self) { v in Text("\(17 + 4*v) × \(17 + 4*v)").tag(v) }
                                }
                            }
                            HStack {
                                Stepper("边距：\(editor.settings.margin) 格", value: editor.binding(\.margin), in: 0...50)
                                Text("尺寸")
                                TextField("像素", value: editor.binding(\.size, coalescing: true), format: .number.grouping(.never)).frame(width: 75)
                                Text("px").foregroundStyle(.secondary)
                            }
                            Toggle("锐利像素边缘", isOn: editor.binding(\.crisp))
                        }.padding(4)
                    }
                    GroupBox("中心 Logo") {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text(editor.settings.logo?.lastPathComponent ?? "未选择图片").lineLimit(1).foregroundStyle(editor.settings.logo == nil ? .secondary : .primary)
                                Spacer()
                                Button("选择…") { chooseLogo() }
                                if editor.settings.logo != nil { Button("移除") { editor.update(\.logo, to: nil) } }
                            }
                            HStack {
                                Text("大小 \(Int(editor.settings.logoScale * 100))%")
                                Slider(value: editor.binding(\.logoScale, coalescing: true), in: 0.05...0.25, step: 0.01)
                                Stepper("留白 \(editor.settings.logoPadding) px", value: editor.binding(\.logoPadding), in: 0...40)
                            }.disabled(editor.settings.logo == nil)
                        }.padding(4)
                    }
                    Text("修改后自动更新预览").font(.callout).foregroundStyle(.secondary)
                }.padding(24)
            }.frame(minWidth: 450, idealWidth: 500)
            Divider()
            VStack(spacing: 16) {
                HStack {
                    Text("预览").font(.title2.bold())
                    Spacer()
                    Button { editor.undo() } label: { Label("后退", systemImage: "arrow.uturn.backward") }
                        .help("撤销上次修改").disabled(!editor.canUndo)
                    Button { editor.redo() } label: { Label("前进", systemImage: "arrow.uturn.forward") }
                        .help("重做已撤销的修改").disabled(!editor.canRedo)
                }
                Spacer(minLength: 0)
                ZStack {
                    RoundedRectangle(cornerRadius: 18).fill(Color(nsColor: .controlBackgroundColor))
                    if let preview = editor.preview {
                        Image(nsImage: preview).resizable().interpolation(.none).scaledToFit().padding(24)
                    } else {
                        VStack(spacing: 10) {
                            if editor.updating { ProgressView().controlSize(.large) }
                            else { Image(systemName: "qrcode").font(.system(size: 70)).foregroundStyle(.tertiary) }
                            Text(editor.updating ? "正在更新预览…" : "二维码预览").foregroundStyle(.secondary)
                        }
                    }
                }.aspectRatio(1, contentMode: .fit).frame(maxWidth: 430)
                Spacer(minLength: 0)
                Text(editor.status).font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
                HStack {
                    Button("导出 PNG…") { export("png") }.disabled(!editor.canExport)
                    Button("导出 SVG…") { export("svg") }.disabled(!editor.canExport)
                    if editor.exporting { ProgressView().controlSize(.small) }
                    Spacer()
                }
            }.padding(24).frame(minWidth: 440, maxWidth: .infinity, maxHeight: .infinity)
        }.frame(minWidth: 950, minHeight: 700)
            .onAppear { editor.start() }
    }

    private func chooseLogo() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.png, .jpeg, .tiff, .gif]
        if panel.runModal() == .OK { editor.update(\.logo, to: panel.url) }
    }
    private func export(_ format: String) {
        guard editor.canExport else { return }
        let panel = NSSavePanel(); panel.nameFieldStringValue = "二维码.\(format)"
        panel.allowedContentTypes = [format == "png" ? .png : .svg]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        editor.export(format, to: url)
    }
}
