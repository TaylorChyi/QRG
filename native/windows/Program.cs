using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace QRG.Windows;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var smokeTest = args.Length == 1 && args[0] == "--smoke-test";
        using var window = new MainWindow(smokeTest);
        Application.Run(window);
        if (smokeTest) Environment.ExitCode = window.SmokePassed ? 0 : 1;
    }
}

internal sealed class MainWindow : Form
{
    private const string AppOrigin = "https://qrg.local";
    private const string RuntimeDownload = "https://developer.microsoft.com/en-us/microsoft-edge/webview2/";
    private readonly WebView2 browser = new() { Dock = DockStyle.Fill };
    private readonly bool smokeTest;
    private readonly System.Windows.Forms.Timer smokeTimeout = new() { Interval = 90_000 };
    private readonly string smokePath = Path.Combine(AppContext.BaseDirectory, "smoke-test.log");
    public bool SmokePassed { get; private set; }

    public MainWindow(bool smokeTest)
    {
        this.smokeTest = smokeTest;
        Text = "QRG";
        Width = 1180;
        Height = 810;
        MinimumSize = new Size(360, 540);
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(browser);
        Shown += async (_, _) => await StartBrowserAsync();
        if (smokeTest)
        {
            smokeTimeout.Tick += (_, _) => FinishSmoke(false, "Timed out waiting for WebView2 and QR checks.");
            smokeTimeout.Start();
        }
    }

    private async Task StartBrowserAsync()
    {
        var site = Path.Combine(AppContext.BaseDirectory, "site");
        if (!File.Exists(Path.Combine(site, "index.html")) ||
            !File.Exists(Path.Combine(site, "static", "site-runtime.js")))
        {
            if (smokeTest) FinishSmoke(false, "The bundled QRG site is missing.");
            else
            {
                MessageBox.Show(this, "The bundled QRG site is missing. Please extract the full ZIP before starting QRG.",
                    "QRG", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
            return;
        }

        try
        {
            var userData = smokeTest
                ? Path.Combine(Path.GetTempPath(), "qrg-smoke-profile-" + Guid.NewGuid().ToString("N"))
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "QRG", "WebView2");
            Directory.CreateDirectory(userData);
            var environment = await CoreWebView2Environment.CreateAsync(null, userData);
            await browser.EnsureCoreWebView2Async(environment);
        }
        catch (Exception error)
        {
            if (smokeTest)
            {
                FinishSmoke(false, "WebView2 failed to start: " + error.Message);
                return;
            }
            var choice = MessageBox.Show(this,
                $"QRG could not start Microsoft Edge WebView2.\n\n{error.Message}\n\nOpen the official WebView2 Runtime download page?",
                "QRG", MessageBoxButtons.YesNo, MessageBoxIcon.Error);
            if (choice == DialogResult.Yes) OpenExternal(RuntimeDownload);
            Close();
            return;
        }

        var core = browser.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping("qrg.local", site,
            CoreWebView2HostResourceAccessKind.Deny);
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsWebMessageEnabled = true;
        core.WebMessageReceived += OnWebMessage;
        core.NavigationStarting += (_, e) =>
        {
            if (IsAppUri(e.Uri)) return;
            e.Cancel = true;
            OpenExternal(e.Uri);
        };
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            OpenExternal(e.Uri);
        };
        await core.AddScriptToExecuteOnDocumentCreatedAsync(
            "window.QRGNative = {postMessage: message => window.chrome.webview.postMessage(message)};");
        if (smokeTest)
        {
            core.NavigationCompleted += (_, e) =>
            {
                if (!e.IsSuccess) FinishSmoke(false, "The bundled page failed to load: " + e.WebErrorStatus);
                else _ = core.ExecuteScriptAsync(SmokeScript);
            };
            try { Clipboard.SetText("QRG smoke clipboard"); }
            catch (Exception error) { FinishSmoke(false, "Clipboard setup failed: " + error.Message); return; }
        }
        browser.Source = new Uri(AppOrigin + "/index.html" + (smokeTest ? "?lang=en" : ""));
    }

    private static bool IsAppUri(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        uri.Scheme == Uri.UriSchemeHttps &&
        uri.Host.Equals("qrg.local", StringComparison.OrdinalIgnoreCase) &&
        uri.IsDefaultPort;

    private static bool IsExternalUri(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp);

    private static void OpenExternal(string? value)
    {
        if (IsExternalUri(value))
            Process.Start(new ProcessStartInfo(value!) { UseShellExecute = true });
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!IsAppUri(e.Source)) return;
        JsonElement id = default;
        try
        {
            using var payload = JsonDocument.Parse(e.TryGetWebMessageAsString());
            var root = payload.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return;
            if (!root.TryGetProperty("id", out var identifier) ||
                identifier.ValueKind is not (JsonValueKind.String or JsonValueKind.Number)) return;
            id = identifier.Clone();
            var action = root.GetProperty("action").GetString();
            switch (action)
            {
                case "save":
                    var saved = SaveFile(root);
                    Reply(id, true, cancelled: !saved);
                    break;
                case "openExternal":
                    var url = root.GetProperty("url").GetString();
                    if (!IsExternalUri(url)) throw new InvalidOperationException("Only HTTP(S) links can be opened.");
                    OpenExternal(url);
                    Reply(id, true);
                    break;
                case "clipboard":
                    ReadClipboard(id);
                    break;
                case "smokeReport" when smokeTest:
                    FinishSmoke(root.GetProperty("ok").GetBoolean(),
                        root.GetProperty("details").GetString() ?? "No smoke details.");
                    break;
                default:
                    throw new InvalidOperationException("Unsupported native action.");
            }
        }
        catch (Exception error)
        {
            if (id.ValueKind != JsonValueKind.Undefined) Reply(id, false, error.Message);
        }
    }

    private bool SaveFile(JsonElement payload)
    {
        var mime = payload.GetProperty("mime").GetString();
        var filename = payload.GetProperty("filename").GetString();
        var png = mime == "image/png" && filename == "qrg.png";
        var svg = mime == "image/svg+xml" && filename == "qrg.svg";
        if (!png && !svg) throw new InvalidOperationException("Unsupported export format.");
        var base64 = payload.GetProperty("data").GetString();
        if (base64 is null || base64.Length > 24 * 1024 * 1024)
            throw new InvalidOperationException("Export is too large.");
        var bytes = Convert.FromBase64String(base64);
        if (smokeTest)
        {
            File.WriteAllBytes(Path.Combine(AppContext.BaseDirectory, filename), bytes);
            return true;
        }
        using var dialog = new SaveFileDialog
        {
            FileName = filename,
            Filter = png ? "PNG image (*.png)|*.png" : "SVG image (*.svg)|*.svg",
            DefaultExt = png ? "png" : "svg",
            AddExtension = true,
            OverwritePrompt = true
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return false;
        File.WriteAllBytes(dialog.FileName, bytes);
        return true;
    }

    private void ReadClipboard(JsonElement id)
    {
        if (Clipboard.ContainsImage())
        {
            using var image = Clipboard.GetImage();
            if (image is null) throw new InvalidOperationException("Unable to read clipboard image.");
            using var buffer = new MemoryStream();
            image.Save(buffer, System.Drawing.Imaging.ImageFormat.Png);
            if (buffer.Length > 2 * 1024 * 1024)
                throw new InvalidOperationException("Clipboard image exceeds 2 MiB.");
            Reply(id, true, data: Convert.ToBase64String(buffer.ToArray()), mime: "image/png");
        }
        else if (Clipboard.ContainsText())
        {
            Reply(id, true, text: Clipboard.GetText());
        }
        else
        {
            Reply(id, true, text: "");
        }
    }

    private void Reply(JsonElement id, bool ok, string? error = null, string? text = null,
        string? mime = null, string? data = null, bool cancelled = false)
    {
        if (browser.CoreWebView2 is null) return;
        var result = JsonSerializer.Serialize(new { id, ok, error, text, mime, data, cancelled });
        _ = browser.CoreWebView2.ExecuteScriptAsync($"window.QRGNativeResult?.({result});");
    }

    private void FinishSmoke(bool ok, string details)
    {
        if (!smokeTest || IsDisposed) return;
        smokeTimeout.Stop();
        if (ok)
        {
            var png = Path.Combine(AppContext.BaseDirectory, "qrg.png");
            var svg = Path.Combine(AppContext.BaseDirectory, "qrg.svg");
            try
            {
                using var image = Image.FromFile(png);
                if (image.Width != 1024 || image.Height != 1024 ||
                    !File.ReadAllText(svg).Contains("<svg", StringComparison.Ordinal))
                    throw new InvalidOperationException("Native PNG/SVG exports are invalid.");
            }
            catch (Exception error)
            {
                ok = false;
                details = "Native export validation failed: " + error.Message;
            }
        }
        SmokePassed = ok;
        File.WriteAllText(smokePath, (ok ? "PASS: " : "FAIL: ") + details);
        Close();
    }

    private const string SmokeScript = """
        (async () => {
          const report = (ok, details) => window.chrome.webview.postMessage(
            JSON.stringify({id: 'smoke', action: 'smokeReport', ok, details}));
          const waitFor = async (condition, label) => {
            const until = Date.now() + 25000;
            while (!condition()) {
              if (Date.now() > until) throw new Error('Timed out waiting for ' + label);
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          };
          try {
            await window.QRGI18n.ready;
            await waitFor(() => window.QRGSite && window.QRGNativeBridge &&
              !document.querySelector('#download-png')?.disabled, 'QR preview');
            if (document.documentElement.lang !== 'en') throw new Error('English UI did not load');
            const theme = document.querySelector('#theme');
            for (const value of ['dark', 'light', 'system']) {
              theme.value = value;
              theme.dispatchEvent(new Event('change', {bubbles: true}));
              if (document.documentElement.getAttribute('data-theme') !==
                  (value === 'system' ? null : value)) throw new Error(value + ' theme failed');
            }
            const content = 'https://example.com/qrg-smoke';
            const response = await window.QRGSite.fetch('/api/render', {
              method: 'POST', body: JSON.stringify({content, format: 'png', size: 512})
            });
            if (!response.ok) throw new Error('Local QR render failed');
            const bytes = new Uint8Array(await response.arrayBuffer());
            let binary = '';
            for (const byte of bytes) binary += String.fromCharCode(byte);
            const decoded = await window.QRGSite.fetch('/api/decode', {
              method: 'POST', body: JSON.stringify({image: 'data:image/png;base64,' + btoa(binary)})
            });
            if (!decoded.ok || (await decoded.json()).content !== content)
              throw new Error('Local WASM QR decode failed');
            if ((await navigator.clipboard.readText()) !== 'QRG smoke clipboard')
              throw new Error('Native clipboard bridge failed');
            let saves = 0;
            const originalSave = window.QRGNativeBridge.save;
            window.QRGNativeBridge.save = async (...args) => {
              await originalSave(...args);
              saves += 1;
            };
            document.querySelector('#download-png').click();
            await waitFor(() => saves >= 1, 'PNG native save');
            document.querySelector('#download-svg').click();
            await waitFor(() => saves >= 2, 'SVG native save');
            report(true, 'WebView2 preview, English UI, themes, local QR/WASM roundtrip, clipboard, PNG/SVG native saves.');
          } catch (error) { report(false, String(error?.stack || error)); }
        })();
        """;
}
