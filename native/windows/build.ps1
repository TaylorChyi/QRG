param(
    [ValidateSet('win-x64', 'win-arm64')]
    [string] $Runtime = 'win-x64',
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string] $Version = '1.0.0'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$site = Join-Path $root 'build\native-web'
if (-not (Test-Path (Join-Path $site 'index.html')) -or
    -not (Test-Path (Join-Path $site 'static\site-runtime.js'))) {
    throw "Missing build/native-web. Run 'npm run build' and 'python script/build-native-web --skip-build' from the repository root first."
}

$publish = Join-Path $root "build\native-windows\$Runtime"
if (Test-Path $publish) { Remove-Item -Recurse -Force $publish }
New-Item -ItemType Directory -Force -Path $publish | Out-Null
dotnet publish (Join-Path $PSScriptRoot 'QRG.Windows.csproj') `
    --configuration Release --runtime $Runtime --self-contained true `
    -p:PublishSingleFile=true -p:PublishTrimmed=false -p:DebugType=None `
    "-p:Version=$Version" --output $publish
if ($LASTEXITCODE -ne 0) { throw 'Windows publish failed.' }

Copy-Item -Recurse -Path $site -Destination (Join-Path $publish 'site')
@"
QRG for Windows $Version ($Runtime)

Extract this entire ZIP, then start QRG.exe. The QR editor, renderer, image
reader and eight language catalogues are bundled and run locally. Internet
access is not needed to create or read a QR code.

Windows 10/11 and Microsoft Edge WebView2 Runtime are required. If WebView2 is
missing, QRG offers the official download page:
https://developer.microsoft.com/en-us/microsoft-edge/webview2/

Images you choose are processed in this app. PNG and SVG export use a native
Save As dialog; external HTTP(S) links open in your default browser.

This ZIP has no code signature. Windows SmartScreen may ask for confirmation.
"@ | Set-Content -Encoding UTF8 (Join-Path $publish 'README-Windows.txt')

$release = Join-Path $root 'build\release'
New-Item -ItemType Directory -Force -Path $release | Out-Null
$architecture = $Runtime.Substring(4)
$archive = Join-Path $release "qrg-v$Version-windows-$architecture.zip"
if (Test-Path $archive) { Remove-Item -Force $archive }
Compress-Archive -Path (Join-Path $publish '*') -DestinationPath $archive -CompressionLevel Optimal
Write-Host "Created $archive"
