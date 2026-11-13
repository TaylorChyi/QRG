# Windows build

The Windows app runs the bundled browser editor through WebView2. It maps the
`build/native-web` files to `https://qrg.local/` inside the app, so QR generation
and image recognition use the local renderer and WASM reader.

Install .NET 10 SDK, Python 3.10+, Node.js 20+, and the locked Python and npm
dependencies, then from the repository root:

```powershell
python -m pip install -r requirements-web.txt
npm ci
npm run build
python script/build-native-web --skip-build
./native/windows/build.ps1 -Runtime win-x64 -Version 1.0.0
```

The script produces a self-contained .NET app ZIP in `build/release/`. Windows
ARM64 is also supported with `-Runtime win-arm64`. The archive includes all
site files, WebView2 SDK and .NET redistribution notices; the Microsoft Edge WebView2 Runtime is
provided by Windows 11 and most Windows 10 installations, or can be installed
from [Microsoft's official download page](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

The app opens image file inputs in the platform picker, saves PNG/SVG through a
native Save As dialog, reads the clipboard only on a user request, and sends
external HTTP(S) links to the default browser. The built ZIP is not signed.
