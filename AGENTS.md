# QRG 协作与维护

## 当前开发范围

- 开发和日常验证公开 Sites 网站、自部署 Web 界面、Web 接口及其共用的命令行二维码生成能力。
- 保留现有 macOS 图形界面的源码、脚本、资源和历史；不为其新增功能，也不将其构建、测试或验收列为日常改动的检查项。
- 用户本次或以后明确要求时，再单独评估 Mac 图形界面工作。

## 文档分工

- README 面向使用者，介绍产品价值、在线入口、真实功能、使用流程和必要的使用建议；保持宣传内容准确、简洁。网页支持的每种语言都应有对应 README 和真实界面截图。同步更新各语言内容，顶部导航链接全部版本；在线入口使用对应的 `?lang=<语言代码>`，直接打开同语言界面。
- 标题下的徽章使用 `assets/badges/` 中的本地 SVG，展示在线入口、导出格式和浏览器内处理能力；只展示已实现的能力，不添加未经核实的许可证、构建或覆盖率状态。
- 项目范围、架构、依赖、运行与部署命令、API 契约、测试、发布流程和资源制作说明集中在本文件；不要将开发日志、验收过程或协作约定写回 README。
- README 的界面图来自实际运行的网页，每种语言展示编辑和预览／导出两张同语言截图。简体中文保留 `assets/readme-editor.jpg` 和 `assets/readme-preview.jpg`；其他语言保存在 `assets/screenshots/<语言代码>/editor.jpg`、`preview.jpg`。界面变化影响宣传图时再更新；不要把设计稿当作已实现功能的证据。
- 区分浏览器在线版与 Python 自部署版的数据处理方式；不要把某一版的验证结果扩展到另一版，也不要将浏览器检查当作真实设备扫码验收。

| 网页语言 | 产品 README | 截图位置 |
| --- | --- | --- |
| `zh-CN` | `README.md` | `assets/readme-editor.jpg`、`assets/readme-preview.jpg` |
| `zh-TW` | `README.zh-TW.md` | `assets/screenshots/zh-TW/` |
| `en` | `README.en.md` | `assets/screenshots/en/` |
| `ja` | `README.ja.md` | `assets/screenshots/ja/` |
| `ko` | `README.ko.md` | `assets/screenshots/ko/` |
| `es` | `README.es.md` | `assets/screenshots/es/` |
| `fr` | `README.fr.md` | `assets/screenshots/fr/` |
| `de` | `README.de.md` | `assets/screenshots/de/` |

更新非简体中文截图时，先按「检查与验证」准备 Playwright Core 和 Chrome，再运行：

```sh
node script/capture-readme-screenshots.cjs
# 只更新指定语言
node script/capture-readme-screenshots.cjs en ja
```

脚本默认读取公开站点，为上表中除简体中文外的七种语言采集 602×804、深色系统外观的真实编辑与预览画面；简体中文原图保持不变。使用相同二维码内容与设置，等待生成完成并解码核对内容，再检查语言、弹窗和导出按钮可见性。`QRG_SCREENSHOT_URL`、`QRG_SCREENSHOT_DIR` 可分别指定待核对的 Sites 页面和输出目录；`QRG_PLAYWRIGHT_MODULE`、`BROWSER_EXECUTABLE_PATH` 可指定本机依赖。

## 实现与入口

| 路径 | 职责 |
| --- | --- |
| `web/templates/index.html`、`web/static/` | 共用编辑器界面、控件、Logo 裁剪、导入、预览与导出交互。 |
| `qrg.py`、`qrg` | Python 二维码渲染与命令行入口；PNG 使用 Pillow，SVG 直接生成。 |
| `qrg_web.py` | Flask 页面、二维码生成、图片识别、国际化与健康检查接口。 |
| `qrg_i18n.py`、`locales/*.json` | Python 语言协商与共享词库。 |
| `sites/src/`、`sites/build.mjs`、`sites/export_index.py` | 浏览器内的二维码渲染、ZXing WASM 识别、语言协商和静态打包。 |
| `.openai/hosting.json` | 已绑定的 Sites 项目身份与 `dist/` 托管配置。 |
| `script/`、`tests/`、`sites/tests/` | 运行脚本和对应实现的检查。 |
| `Sources/`、`verify.swift` | 保留的 Mac GUI，以及 CLI／Web 可选的 macOS Vision 校验。 |

公开站点为 <https://qrg.taylorchyi.chatgpt.site>，源码仓库为 <https://github.com/TaylorChyi/QRG>。

## 本地 Web 运行

Python 需要 3.10 或更高版本。macOS、Linux 在仓库根目录运行：

```sh
./script/run-web
```

首次运行创建 `.venv` 并安装 `requirements-web.txt` 的锁定依赖，打开 <http://127.0.0.1:8000>。后续依赖未变化时不重复安装。脚本监听本机，Python 文件修改后自动重载；HTML、CSS、JS 修改后刷新页面。按 Ctrl+C 停止；端口冲突可用 `PORT=8001 ./script/run-web`。

`.codex/environments/environment.toml` 保留「Web · 调测 QRG」和「Web · 自动测试」两个 Action，分别调用 `script/run-web` 与 `script/test-web`，不提供 Mac GUI 日常调测 Action。

## Python Web 生产部署

在 Linux 服务器上运行：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-web.txt
./script/serve-web
```

`script/serve-web` 使用 Gunicorn，默认监听 `127.0.0.1:8000`、两个 worker、60 秒超时。可通过 `HOST`、`PORT`、`WEB_CONCURRENCY` 调整，例如 `HOST=0.0.0.0 PORT=8080 WEB_CONCURRENCY=2 ./script/serve-web`。自部署 Python Web 不需要 Node.js 或前端构建。生产环境由进程管理器常驻运行，通过反向代理提供 HTTPS；`run-web` 只用于开发。

当前没有登录或账户体系。公开范围与速率限制由部署环境控制。反向代理请求上限至少为 3 MiB，应转发 `/`、`/static/`、`/icon.png`、`/api/render`、`/api/decode`、`/api/i18n`、`/healthz` 到同一应用，优先在独立域名根路径部署。健康检查使用 `GET /healthz`。

仓库保留 `Dockerfile`、`compose.yaml`。Compose 端口只映射服务器回环地址，使用非 root 用户、只读根文件系统和临时 `/tmp`，没有持久卷。**当前 Dockerfile 未复制 `qrg_i18n.py` 和 `locales/`；修复并通过容器启动、接口与健康检查前，不要将容器部署标记为可用。** 需要检查该路径时，入口命令为：

```sh
docker compose up -d --build
docker compose logs -f qrg
curl --fail http://127.0.0.1:8000/healthz
```

## Sites 构建与发布

需要 Node.js 20 或更高版本，以及 Python Web 依赖。首次准备及本地预览：

```sh
./script/setup-web
npm ci
npm run test:sites
npm run build
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

打开 <http://127.0.0.1:8765>。`npm run build` 从共用 Jinja 模板和静态资源生成 `dist/`，构建时将页面 API 调用接到 `QRGSite.fetch`；Python Web 的源码和运行方式保持独立。`QRG_PYTHON` 可指定构建解释器。

- 在线版生成和识别都在访问者浏览器内完成，PNG 使用 Canvas，识别用本站提供的 ZXing WASM；不要引入第三方图片／二维码处理服务或远端 WASM CDN。
- Python 与 JavaScript 渲染可能存在边缘像素、抗锯齿差异。保持业务语义、容量错误、Logo 定位保护、导出和识别行为一致，不宣称两者逐像素相同。
- 站点身份以 `.openai/hosting.json` 的 `project_id` 为准；更新同一站点时复用该身份。发布按当前 Sites 工具和技能流程执行：推送准确源码、打包匹配产物、保存版本、部署并核对终态。凭据不进入源码、文件或日志。
- 当前站点面向 public。源码提交不等于网站发布成功，公开权限和部署结果分别核对。
- 只改文档和 README 展示图时，检查文档、链接和图片即可；没有站点运行内容变化时不重新构建或发布。

## 业务与接口约束

### 编辑器行为

- 桌面并排编辑和预览；手机竖屏切换「编辑二维码／预览与导出」。支持浅色、深色、跟随系统及键盘操作。
- 修改后自动预览，只有最新设置成功生成后才能导出或识别；PNG 下载复用当前成功预览。保留撤销／重做，拒绝过期结果覆盖最新状态。
- 预览缩放为 25%–200%，每次调整 25%；100% 适配可用画布，缩放不改变导出内容与尺寸。
- 码点形状为 `square`、`tile`、`circle`；码眼为 `square`、`rounded`。图片外角独立选择直角／圆角，圆角半径为 1.5 个码点，外侧透明；透明背景预览使用棋盘底纹。
- Logo 保留原图及可重编的裁剪范围。大小按完整码点槽选择，图片等比放入；大小及 0／1／2 档留白按版本、定位结构动态筛选。偶数边长槽偏离几何中心半格以对齐网格。不得覆盖定位结构。
- UI 固定版本选项为自动、1、3、5、10，自动仍支持完整版本范围。容量不足时自动切换到可容纳的版本并提示，保留内容、容错等级及撤销语义。CLI 与 HTTP 固定版本请求仍严格报错。
- 导入支持文件选择、拖放、在链接框粘贴图片以及「粘贴」按钮；识别前不清空已有内容。用户编辑、撤销／重做或新导入应取消旧识别。上传识别后不自动打开网页；「跳转／识别并跳转」只打开有效 HTTP／HTTPS 链接。
- 页面加载只查询剪贴板权限；用户点击后才触发读取和必要的浏览器权限提示。不支持读取时仍保留系统粘贴快捷键。

### 输入与输出

- UI PNG 尺寸为 256、512、1024、2048、4096 像素，默认 1024；边距为 0、2、4、8 个码点，默认 4。SVG 的二维码图形为矢量，嵌入的 Logo 仍为位图。
- HTTP 输出尺寸为 64–4096 像素，边距 0–32；请求最多 3 MiB，内容最多 8192 个 UTF-8 字节，仍受实际二维码容量限制。
- Logo 与导入图片接受 PNG／JPEG／WebP，最多 2 MiB、单边最多 4096 像素。识别失败、多个二维码或内容过长时保留原输入。
- 颜色对比、尺寸、Logo、最终背景和印刷环境影响可读性；添加 Logo 建议 H 级容错。自动识别检查不替代目标设备与实际展示／印刷环境的扫码确认。
- Python Web 将内容和图片发送到当前 QRG 服务器，应用不将其持久化，也不在应用日志中记录请求正文；反向代理及托管环境日志由部署方管理。Sites 版在浏览器内处理。语言选择会持久保存，不得笼统声称「什么都不存储」。

### HTTP 契约

- `POST /api/render`：JSON 设置，`format` 为 `png`／`svg`，成功返回对应图片。保留 `X-QRG-Version`、`X-QRG-Modules`、`X-QRG-Logo-Options`、`X-QRG-Image-Corner-Radius` 等预览元数据。
- 容量错误返回 400、`code: "capacity_exceeded"`、`minimum_version`；任何版本都无法容纳时后者为 `null`。Logo 错误保留可用大小／留白选项，便于 UI 恢复。
- `POST /api/decode`：JSON 的 `image` 是 PNG／JPEG／WebP Base64 data URL。成功返回 `{"content":"识别内容"}`；无结果、无效图片、多个二维码返回 400 和 `error`。接口只返回内容，浏览器决定是否跳转。
- `GET /api/i18n?lang=en` 返回 `locale`、`messages`；`Content-Language` 标明实际语言。Python 页面／接口依次使用 `?lang=`、`qrg-language` Cookie、`Accept-Language`，`?lang=auto` 按浏览器协商。
- Sites 的同名页面请求由浏览器本地适配处理，不是公开可调用的 HTTP API。

## 国际化

支持 `zh-CN`、`zh-TW`、`en`、`ja`、`ko`、`es`、`fr`、`de`。词库以简体中文源文案为键，保持动态占位符一致，覆盖编辑、裁剪、控件、无障碍标签及错误信息。

界面选择保存在 Cookie 一年；切换不丢失二维码内容、样式或历史。「跟随浏览器」恢复自动协商，不支持的语言回退为简体中文。CLI 用 `--lang` 指定，未指定时依次读取 `LC_ALL`、`LC_MESSAGES`、`LANG`；参数名和枚举值保持不变。

## 检查与验证

检查强度随实际改动选择，不无故重复已通过的检查：

| 改动 | 相关检查 |
| --- | --- |
| 文档、宣传图 | `git diff --check`，本地链接与图片引用、截图内容核对。 |
| Python Web API | `./script/test-web`。 |
| 共享 Python 渲染／CLI／词库 | `.venv/bin/python -m unittest discover -s tests -v`。macOS Vision 实际解码用例只在 macOS 上执行。 |
| Sites 渲染 | `npm run test:sites`、`npm run build`，必要时运行 Sites 浏览器回归。 |
| Web UI／交互 | 对受影响路径运行下面的浏览器回归；核对桌面／手机、主题、键盘及导出行为。 |

浏览器回归使用 Playwright Core 和 Chrome；它们不是 Python Web 的运行依赖。缺少依赖时可放入忽略的 `build/`：

```sh
npm install --prefix build/browser-qa --no-package-lock --no-save playwright-core@1.64.1
QRG_PLAYWRIGHT_MODULE="$PWD/build/browser-qa/node_modules/playwright-core" node tests/test_web_ui.cjs
```

按改动选择 `tests/test_capacity_ui.cjs`、`test_logo_ui.cjs`、`test_preview_zoom.cjs`、`test_image_corners_ui.cjs`、`test_link_decode_ui.cjs`、`test_qr_import_ui.cjs`、`test_qr_paste_drop_ui.cjs`、`test_i18n_ui.cjs`。默认服务为 <http://127.0.0.1:8000>，默认浏览器为 macOS Google Chrome；可通过 `BASE_URL`、`BROWSER_EXECUTABLE_PATH` 指定。

Sites 服务启动后运行：

```sh
QRG_PLAYWRIGHT_MODULE="$PWD/build/browser-qa/node_modules/playwright-core" node sites/tests/site-ui.cjs
```

该回归默认访问 <http://127.0.0.1:8765>，核对 PNG／SVG 导出、扫码回读、Logo、版本容量恢复、导入、多码拒绝、多语言、手机主题，以及没有网络 `/api` 上传。实现、自动检查、构建、真实浏览器运行和物理设备扫码分别记录。

## 命令行使用

`qrg` 入口首次创建 `.venv` 并安装 `requirements.txt`；依赖准备好后可离线生成：

```sh
./qrg 'https://example.com' -o qr.png
./qrg --lang en --help
./qrg 'https://example.com' -o qr.svg --module-shape tile --eye-shape rounded --error-correction H
./qrg 'https://example.com' -o qr-logo.png --logo logo.png --logo-modules 5 --error-correction H
```

`--color`、`--background` 支持颜色名和十六进制，背景还可用 `--background transparent`；码色禁止全透明。`--image-shape` 独立控制图片外角，默认直角；`--margin` 默认 4，`--error-correction` 默认 M。`--version` 为 1–40，未指定则自动选择；固定版本容不下内容时报错。`--size` 为输出像素，CLI 接受 64–16384。

Logo 支持 Pillow 可读格式。`--logo-modules` 优先于 `--logo-scale`，最大边长不超过二维码本体四分之一；比例参数默认 0.20、上限 0.25。`--logo-padding-px` 是最小留白，实际边界按完整码点向外取整，覆盖定位结构时拒绝生成。

PNG 可加 `--verify` 调用 macOS Vision 与原文比较；失败返回非零退出码并保留文件，SVG 不支持该参数。它仍不能替代最终环境扫码。

需要 shell 别名时，将仓库绝对路径写入 shell 配置并正确引用含空格的路径；不要修改系统路径或创建兼容链接代替真实入口。

## 保留的 Mac GUI 与图标

以下仅为既有实现的维护记录，不恢复日常开发／验收范围：

- `./script/run-gui` 编译并运行 `build/QRG.app`，调用同一 CLI；`--build-only` 只构建。需要 Xcode Command Line Tools，项目、脚本及 Python 依赖须可用。
- 既有 GUI 自动预览、导出、撤销／重做及系统主题行为保留；非透明 PNG 使用 macOS Vision 验证，透明背景和 SVG 需实际扫码。仅在用户明确要求该路径时才评估 `script/test-gui`。
- `assets/QRG.icon` 为白底黑色标记，`assets/QRG-Black.icon` 为黑底白色标记；三方形与一圆形构成标记，玻璃光照效果由 Icon Composer 渲染。
- `assets/icon.png`、`assets/icon-dark.png` 是 1024 × 1024 PNG，`.icns` 由 `actool` 编译，`assets/icon.svg` 为平面矢量配套。Web 与 GUI 使用白色款，黑色款为独立备选，不自动随主题切换。
- 图标重新导出需完整 Xcode、Icon Composer 27 或更高版本，以及 Pillow；入口为 `.venv/bin/python scripts/build_icon.py`，可通过 `ICON_COMPOSER_ICTOOL` 指定工具版本。GUI 启动脚本将 `.icns` 放入本地应用包。
