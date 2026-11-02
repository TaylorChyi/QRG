<p align="center"><img src="assets/icon.png" width="128" alt="QRG 应用图标"></p>

# QRG

macOS 本地二维码工具。输入链接或文字，输出 PNG 或 SVG。生成过程在本机完成，内容不会发送到二维码服务。

## 使用

克隆仓库后，在项目目录中运行：

```sh
./qrg 'https://example.com' -o ~/Desktop/二维码.png
```

需要 macOS、Python 3 和 `python3 -m venv`。`./qrg` 首次运行会创建 `.venv`，并通过 pip 安装 `requirements.txt` 中锁定版本的依赖；完成后可离线生成。若希望自行安装依赖，可运行 `python3 -m venv .venv` 和 `.venv/bin/python -m pip install -r requirements.txt`。查看全部参数：

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

`assets/icon.svg` 是可编辑的图标原稿，`assets/icon.png` 是 1024 × 1024 PNG，`assets/icon.icns` 用于 macOS 应用。需要重新生成图标时，先安装依赖，再在 macOS 上运行 `.venv/bin/python scripts/build_icon.py`。生成 `.icns` 还需 macOS 自带的 `iconutil`。启动图形界面时，`script/run-gui` 将 `.icns` 放入本地构建的应用包。
