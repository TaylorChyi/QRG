<p align="center"><img src="assets/icon.png" width="128" alt="QRG 应用图标"></p>

# QRG

二维码工具，提供命令行、macOS 应用和可自部署的 Web 界面。输入链接或文字，输出 PNG 或 SVG。命令行和 macOS 应用在本机生成；Web 版在运行 QRG 的服务器生成，不调用第三方二维码服务。

## Web 版与调测 Action

需要 Python 3.10 或更高版本。macOS、Linux 上在项目目录运行：

```sh
./script/run-web
```

首次运行会创建 `.venv` 并安装 `requirements-web.txt` 的依赖，之后无需联网安装。打开 [http://127.0.0.1:8000](http://127.0.0.1:8000)。在 Codex 项目的 Actions 中也可以选择「Web · 调测 QRG」；「Web · 自动测试」运行 Web 接口测试。调测服务监听本机，修改 Python 文件会自动重载，修改 HTML/CSS/JS 后刷新页面即可看到更新，按 Ctrl+C 停止。端口冲突时使用 `PORT=8001 ./script/run-web`。

Web 界面提供自动预览、撤销/重做、码色和背景色、透明背景、码点和码眼形状、容错等级、版本、尺寸、Logo，以及 PNG/SVG 下载。适配窄屏，支持浅色、深色和跟随系统。PNG 下载使用当前预览对应的图片；修改设置后须等待新预览成功才能导出。

链接、文字和 Logo 会发送到当前 QRG 服务器，应用不会将这些内容写入文件、数据库或浏览器持久存储，也不会在应用日志中记录请求正文。反向代理或托管环境的日志策略由部署者管理。Web 版不执行 macOS Vision 自动解码，请用目标设备扫码确认。

为限制服务器资源占用，Web 输出尺寸为 64–4096 像素，边距为 0–32 个码点；Logo 接受 PNG/JPEG/WebP，文件最多 2 MiB，宽高各不超过 4096 像素；请求最多 3 MiB。内容最多 8192 个 UTF-8 字节，实际二维码容量仍受版本和容错等级限制。SVG 导出不分配整张位图画布，PNG 抗锯齿画布的单边上限为 4096 像素。

### 后续服务器部署

不需要 Node.js 或前端构建。仓库已提供 Gunicorn 入口、Dockerfile、Compose 和健康检查 `/healthz`。Linux 服务器可以运行：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-web.txt
./script/serve-web
```

生产入口默认监听 `127.0.0.1:8000`，使用两个 worker。可通过 `HOST`、`PORT` 和 `WEB_CONCURRENCY` 调整，例如 `HOST=0.0.0.0 PORT=8080 WEB_CONCURRENCY=2 ./script/serve-web`。将其交给 systemd 等进程管理器常驻运行，外部访问通过反向代理提供 HTTPS。调测入口 `run-web` 仅用于开发。入口遵循 [Flask 的 Gunicorn 部署方式](https://flask.palletsprojects.com/en/stable/deploying/gunicorn/)；项目 Actions 的用途见 [OpenAI 官方说明](https://learn.chatgpt.com/docs/environments/local-environment)。

也可在装有 Docker Compose 的服务器运行：

```sh
docker compose up -d --build
docker compose logs -f qrg
curl --fail http://127.0.0.1:8000/healthz
```

Compose 默认只把容器端口映射到服务器的回环地址，以便由同机反向代理转发。容器以非 root 用户运行、根文件系统只读，无持久卷；重新构建后不需要数据迁移。当前没有登录或账户体系，访问范围、速率限制和 HTTPS 可在反向代理配置。反向代理请求上限应至少为 3 MiB，转发页面、`/static/`、`/icon.png`、`/api/render` 和 `/healthz` 到同一应用，建议在独立域名的根路径部署。此改动只准备部署材料，不会自动部署服务器。

Web 测试可独立运行，或连同现有 CLI 测试运行：

```sh
./script/test-web
.venv/bin/python -m unittest discover -s tests -v
```

Web 接口测试在 macOS、Linux 均可运行；其中 macOS Vision 的真实解码用例只在 macOS 执行。

## 使用

克隆仓库后，在项目目录中运行：

```sh
./qrg 'https://example.com' -o ~/Desktop/二维码.png
```

需要 macOS、Python 3.10 或更高版本和 `python3 -m venv`。`./qrg` 首次运行会创建 `.venv`，并通过 pip 安装 `requirements.txt` 中锁定版本的依赖；完成后可离线生成。若希望自行安装依赖，可运行 `python3 -m venv .venv` 和 `.venv/bin/python -m pip install -r requirements.txt`。查看全部参数：

```sh
./qrg --help
```

也可以在当前终端设置一个简短命令：

```sh
alias qrg="$(pwd)/qrg"
qrg 'https://example.com' -o ~/Desktop/二维码.png
```

如需在其他目录也能使用，请把仓库的绝对路径写入 shell 配置（如 `~/.zshrc`）。路径有空格时请使用引号。

## 样式示例

```sh
./qrg 'https://example.com' -o ~/Desktop/二维码.png \
  --color '#123d36' --background '#f7f4ed' \
  --module-shape tile --eye-shape rounded \
  --margin 4 --error-correction H --version 5 --size 1024
```

- `--color`：码的颜色；`--background`：背景颜色，支持常见颜色名称、十六进制颜色及 `transparent`。
- `--module-shape`：`square` 方形、`tile` 圆角瓷砖、`circle` 圆形。
- `--eye-shape`：`square` 方形或 `rounded` 中圆角。
- `--margin`：四周边距，以码点数计，默认 4。
- `--error-correction`：容错等级 `L`、`M`、`Q`、`H`，默认 `M`。
- `--version`：版本 1–40，码的边长为 `17 + 4 × 版本` 个码点，例如版本 5 是 37×37；不指定时自动选择。指定的版本容不下内容时会报错。
- `--size`：输出宽高，单位像素；SVG 的二维码图形可无损缩放。
- `--crisp`：关闭码点边缘的抗锯齿，适合需要像素锐利边缘的输出；小尺寸下圆角可能呈锯齿。

带 Logo：

```sh
./qrg 'https://example.com' -o ~/Desktop/带Logo二维码.png \
  --module-shape tile --eye-shape rounded --error-correction H \
  --logo ~/Desktop/logo.png --logo-scale 0.20
```

Logo 支持 PNG、JPEG 等 Pillow 能读取的图片；`--logo-scale` 是 Logo 最大边长占二维码本体边长的比例，最大 0.25。使用 `.svg` 扩展名即可生成嵌入 Logo 的 SVG。

二维码识别受颜色对比、背景、尺寸、圆角、Logo 和实际展示或印刷条件影响。默认保留四个码点的边距；带 Logo 建议使用 H 容错等级。制作完成后请用目标设备实际扫码，透明背景尤其要确认最终背景与码色有足够对比度。

## 解码校验与自动测试

在 PNG 命令中加入 `--verify`，工具会调用 macOS Vision 解码生成文件并对比原文；未通过时命令返回非零退出码，生成文件保留供排查。这个检查不能替代不同手机、缩放和印刷条件下的实际扫码。SVG 目前不支持此参数。

`--logo-padding-px` 可指定 Logo 周围的最小留白像素数；留白边界以完整码点为单位向外取整，实际距离可能更大，以避免切断码点。若留白会覆盖二维码的校准定位图形，工具会拒绝生成并提示调整 Logo 或版本。Logo 留白仍会移除部分数据，依靠容错恢复，因此建议使用 H 级并验证。

运行自动测试：

```sh
.venv/bin/python -m unittest discover -s tests -v
```

## macOS 图形界面

运行 `./script/run-gui`，或在 Codex 项目的 Actions 里选择「Mac · 打开 QRG」。首次运行会编译本机应用；生成二维码时使用同一套 QRG CLI。打开后自动生成预览，修改内容、样式、规格或 Logo 后也会自动更新，无需点击生成按钮。连续输入或拖动时会在短暂停顿后更新，更新完成后可导出 PNG 或 SVG。预览右上角的「后退」「前进」可撤销和重做设置修改；后退后进行新修改会清除前进记录。非透明背景的预览和 PNG 导出会用 macOS Vision 验证；透明背景和 SVG 需要在实际使用环境中扫码确认。

图形界面跟随 macOS 的浅色或深色外观。应用位于项目的 `build/QRG.app`，启动脚本负责传入项目路径；依赖和项目目录须保持可用。

构建图形界面需要安装 Xcode Command Line Tools（`xcode-select --install`）。只构建、不打开窗口时可运行 `./script/run-gui --build-only`。

运行 `./script/test-gui` 可检查自动预览的连续修改、过期结果处理、导出一致性以及后退和前进。

## 应用图标

图标沿用「三个方形＋一个圆形」结构，圆角外轮廓就是整个应用图标的边缘。`assets/QRG.icon` 为白底黑色标记，`assets/QRG-Black.icon` 为黑底白色标记，均可直接用 Apple Icon Composer 编辑；玻璃边缘、折射和光照由 Icon Composer 渲染。

`assets/icon.png`、`assets/icon-dark.png` 是两款 1024 × 1024 PNG；对应的 `.icns` 由 Apple `actool` 编译。`assets/icon.svg` 是无玻璃特效的平面矢量配套。Web 和 macOS 应用默认使用白色款，黑色款作为独立备选，不会自动随系统切换。

重新导出需完整 Xcode、Icon Composer 27 或更高版本，以及项目的 Pillow 依赖，在 macOS 上运行 `.venv/bin/python scripts/build_icon.py`。脚本默认使用当前 `xcode-select` 所选 Xcode 内的 Icon Composer；也可通过 `ICON_COMPOSER_ICTOOL` 指向其他版本的 `Icon Composer.app/Contents/Executables/ictool`。启动图形界面时，`script/run-gui` 将 `assets/icon.icns` 放入本地构建的应用包。
