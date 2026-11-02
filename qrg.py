#!/usr/bin/env python3
"""Create styled QR codes as PNG or SVG."""
import argparse
import base64
import io
import math
import subprocess
import sys
from pathlib import Path
from dataclasses import dataclass

import qrcode
from PIL import Image, ImageChops, ImageColor, ImageDraw
from qrcode.exceptions import DataOverflowError
from qrg_i18n import environment_locale, resolve_locale, set_locale, t

LEVELS = {'L': qrcode.constants.ERROR_CORRECT_L, 'M': qrcode.constants.ERROR_CORRECT_M,
          'Q': qrcode.constants.ERROR_CORRECT_Q, 'H': qrcode.constants.ERROR_CORRECT_H}
ROUNDED_CORNER_RADIUS = 1.5

def color(value):
    if value.lower() == 'transparent':
        return (0, 0, 0, 0)
    try:
        return ImageColor.getcolor(value, 'RGBA')
    except ValueError as exc:
        raise argparse.ArgumentTypeError(t('无效颜色: {value}', value=value)) from exc

def positive(value):
    try:
        n = int(value)
        if n < 0: raise ValueError()
        return n
    except ValueError as exc:
        raise argparse.ArgumentTypeError(t('请输入非负整数')) from exc

def svg_color(c):
    return f'#{c[0]:02x}{c[1]:02x}{c[2]:02x}', c[3] / 255

@dataclass(frozen=True)
class QRSettings:
    content: str
    color: tuple = (0, 0, 0, 255)
    background: tuple = (255, 255, 255, 255)
    module_shape: str = 'square'
    eye_shape: str = 'square'
    image_shape: str = 'square'
    margin: int = 4
    error_correction: str = 'M'
    version: int | None = None
    size: int = 1024
    logo: Image.Image | None = None
    logo_scale: float = .20
    logo_padding_px: int | None = None
    logo_modules: int | None = None
    logo_padding_modules: int | None = None


class LogoSizeError(ValueError):
    def __init__(self, max_modules):
        self.max_modules = max_modules
        super().__init__(t('当前二维码的 Logo 最多为 {max_modules} 个码点；请缩小 Logo 或增加二维码版本', max_modules=max_modules))


@dataclass(frozen=True)
class RenderResult:
    data: bytes
    version: int
    modules: int
    image_corner_radius: float


def logo_clearance(clearance, version, modules, padding_modules=None, padding_pixels=None, cell_pixels=None):
    """Return the erased module rectangle, rejecting structural-pattern overlap."""
    if padding_modules is not None:
        padding = padding_modules
    elif padding_pixels is not None:
        padding = padding_pixels / cell_pixels
    else:
        padding = 1.25
    left, top, right, bottom = (math.floor(clearance[0]-padding), math.floor(clearance[1]-padding),
                                math.ceil(clearance[2]+padding), math.ceil(clearance[3]+padding))
    patterns = [(0, 0, 7, 7), (modules-7, 0, modules, 7), (0, modules-7, 7, modules)]
    for cy in qrcode.util.pattern_position(version):
        for cx in qrcode.util.pattern_position(version):
            if (cx <= 8 and cy <= 8) or (cx >= modules-9 and cy <= 8) or (cx <= 8 and cy >= modules-9):
                continue
            patterns.append((cx-2, cy-2, cx+3, cy+3))
    if any(left < x1 and right > x0 and top < y1 and bottom > y0 for x0, y0, x1, y1 in patterns):
        raise ValueError(t('Logo 留白与二维码的定位结构重叠；请减小 Logo 或更换版本'))
    return left, top, right, bottom


def logo_options(version, modules):
    """Offer only useful centred slots and padding that fit this QR version."""
    choices = sorted({2, 3, 5, 7, 9, 11, 15, modules // 4})
    result = {}
    for side in choices:
        if not 1 <= side <= modules // 4:
            continue
        start = (modules - side) // 2
        clearance = (start, start, start + side, start + side)
        allowed = []
        for padding in (0, 1, 2):
            try:
                logo_clearance(clearance, version, modules, padding_modules=padding)
            except ValueError:
                continue
            allowed.append(padding)
        if allowed:
            result[str(side)] = allowed
    return result


def render_qr(args: QRSettings, output_format: str) -> RenderResult:
    """Render in memory for both the CLI and web app; no filesystem or subprocesses."""
    if output_format not in ('png', 'svg'):
        raise ValueError(t('输出格式必须为 PNG 或 SVG'))
    if args.image_shape not in ('square', 'rounded'):
        raise ValueError(t('图片外角必须为直角或圆角'))
    if args.logo_padding_modules is not None:
        if type(args.logo_padding_modules) is not int or not 0 <= args.logo_padding_modules <= 8:
            raise ValueError(t('logo_padding_modules 必须为 0–8 之间的整数'))
        if args.logo_padding_px is not None:
            raise ValueError(t('Logo 留白只能选择像素或码点其中一种单位'))
    qr = qrcode.QRCode(version=args.version, error_correction=LEVELS[args.error_correction], box_size=1, border=0)
    qr.add_data(args.content)
    try:
        qr.make(fit=args.version is None)
    except DataOverflowError:
        raise ValueError(t('内容无法放入指定版本和容错等级；请选择更大的版本或自动版本')) from None
    matrix = qr.get_matrix(); n = len(matrix); total = n + 2 * args.margin
    if args.logo_modules is not None and args.logo_modules > n // 4:
        raise LogoSizeError(n // 4)
    if args.size < total: raise ValueError(t('输出尺寸至少需要 {total} 像素，以容纳每个码点', total=total))
    fg, fa = svg_color(args.color); bg, ba = svg_color(args.background)
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{args.size}" height="{args.size}" viewBox="0 0 {total} {total}">',
             f'<rect width="{total}" height="{total}" fill="{bg}" fill-opacity="{ba}"/>']
    # Use equal whole-pixel cells when a quiet zone can absorb the remainder.
    # A borderless PNG must fill its canvas instead of adding an implicit margin.
    supersample = max(1, min(4, 4096 // args.size))
    image = Image.new('RGBA', (args.size * supersample, args.size * supersample), args.background) if output_format == 'png' else None
    draw = ImageDraw.Draw(image) if image is not None else None
    borderless_png = args.margin == 0 and image is not None
    px = (args.size / total if borderless_png else args.size // total) * supersample
    offset = 0 if borderless_png else (args.size * supersample - total * px) / 2
    def rect(x, y, w, h, radius, fill):
        x += args.margin; y += args.margin
        c, a = svg_color(fill)
        parts.append(f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{radius:g}" fill="{c}" fill-opacity="{a}"/>')
        left, top = round(offset+x*px), round(offset+y*px)
        box = (left, top, max(left, round(offset+(x+w)*px)-1),
               max(top, round(offset+(y+h)*px)-1))
        if draw is not None:
            draw.rounded_rectangle(box, radius=radius*px, fill=fill)
    logo = None
    if args.logo is not None:
        logo = args.logo.convert('RGBA')
        max_side = args.logo_modules if args.logo_modules is not None else n * args.logo_scale
        # Scale both small and large uploads to the selected share of the QR body.
        # thumbnail() only shrinks, so common small icons otherwise stay the same size.
        slot_left = (n - args.logo_modules) // 2 if args.logo_modules is not None else None
        if borderless_png and slot_left is not None:
            slot_start = round(slot_left * px)
            target_side = max(1, round((slot_left + args.logo_modules) * px) - slot_start)
        else:
            target_side = max(1, round(max_side * px))
        ratio = target_side / max(logo.size)
        logo = logo.resize((max(1, round(logo.width * ratio)),
                            max(1, round(logo.height * ratio))), Image.Resampling.LANCZOS)
        lw, lh = logo.width/px, logo.height/px
        if args.logo_modules is not None:
            # QR bodies have odd side lengths. An even-sized module slot must sit
            # half a cell off the geometric centre to keep its edges on the grid.
            slot_top = slot_left
            logo_x = slot_left + (args.logo_modules - lw) / 2
            logo_y = slot_top + (args.logo_modules - lh) / 2
            clearance = (slot_left, slot_top,
                         slot_left + args.logo_modules, slot_top + args.logo_modules)
        else:
            logo_x, logo_y = (n-lw)/2, (n-lh)/2
            clearance = (logo_x, logo_y, logo_x + lw, logo_y + lh)
        clear_left, clear_top, clear_right, clear_bottom = logo_clearance(
            clearance, qr.version, n, args.logo_padding_modules, args.logo_padding_px, px / supersample)
    eyes = [(0,0), (n-7,0), (0,n-7)]
    for y, row in enumerate(matrix):
        for x, dark in enumerate(row):
            if not dark or any(ex <= x < ex+7 and ey <= y < ey+7 for ex,ey in eyes): continue
            if logo is not None and clear_left <= x < clear_right and clear_top <= y < clear_bottom: continue
            inset = .12 if args.module_shape == 'tile' else 0
            side = 1 - 2 * inset
            radius = {'square':0, 'tile':.16, 'circle':.5}[args.module_shape]
            rect(x+inset,y+inset,side,side,radius,args.color)
    # Finder patterns contain a 7×7 outer frame, a background-coloured ring and a 3×3 centre.
    # Clear the ring so transparent backgrounds remain transparent.
    for index,(x,y) in enumerate(eyes):
        start = len(parts)
        radius = 0 if args.eye_shape == 'square' else ROUNDED_CORNER_RADIUS
        rect(x,y,7,7,radius,args.color)
        rect(x+1,y+1,5,5,0 if radius == 0 else .8,args.background)
        rect(x+2,y+2,3,3,0 if radius == 0 else .6,args.color)
        outer, _, centre = parts[start:]
        del parts[start:]
        inner_radius = 0 if radius == 0 else .8
        parts.append(f'<mask id="eye{index}"><rect width="{total}" height="{total}" fill="white"/><rect x="{x+1+args.margin}" y="{y+1+args.margin}" width="5" height="5" rx="{inner_radius}" fill="black"/></mask><g mask="url(#eye{index})">{outer}</g>{centre}')
    if logo is not None:
        x, y = logo_x, logo_y
        if image is not None:
            if borderless_png and args.logo_modules is not None:
                position = (slot_start + (target_side - logo.width) // 2,
                            slot_start + (target_side - logo.height) // 2)
            else:
                position = (round(offset+(x+args.margin)*px), round(offset+(y+args.margin)*px))
            image.alpha_composite(logo, position)
        data = io.BytesIO(); logo.save(data, format='PNG')
        encoded = base64.b64encode(data.getvalue()).decode('ascii')
        parts.append(f'<image x="{x+args.margin:g}" y="{y+args.margin:g}" width="{lw:g}" height="{lh:g}" href="data:image/png;base64,{encoded}"/>')
    image_corner_radius = 0
    if args.image_shape == 'rounded':
        # Apply the same outer silhouette to the background, modules and logo.
        # Use the finder's actual module width, including PNG pixel snapping.
        image_corner_radius = ROUNDED_CORNER_RADIUS * (px / supersample if image is not None else args.size / total)
        parts.insert(1, f'<clipPath id="image-corners"><rect width="{total}" height="{total}" rx="{ROUNDED_CORNER_RADIUS:g}"/></clipPath><g clip-path="url(#image-corners)">')
        parts.append('</g>')
        if image is not None:
            mask = Image.new('L', image.size, 0)
            ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.width - 1, image.height - 1),
                                                    radius=image_corner_radius * supersample, fill=255)
            image.putalpha(ImageChops.multiply(image.getchannel('A'), mask))
    parts.append('</svg>')
    if output_format == 'svg':
        data = ('\n'.join(parts)+'\n').encode('utf-8')
    else:
        if supersample != 1:
            image = image.resize((args.size, args.size), Image.Resampling.BOX)
        buffer = io.BytesIO()
        image.save(buffer, 'PNG')
        data = buffer.getvalue()
    return RenderResult(data, qr.version, n, image_corner_radius)

def main():
    locale_probe = argparse.ArgumentParser(add_help=False)
    locale_probe.add_argument('--lang')
    requested_locale, _ = locale_probe.parse_known_args()
    set_locale(resolve_locale(requested_locale.lang) or environment_locale())
    p = argparse.ArgumentParser(description=t('生成可自定义样式的二维码（PNG 或 SVG）'))
    p.add_argument('--lang', metavar='LANG', help=t('界面语言：zh-CN、zh-TW、en、ja、ko、es、fr、de'))
    p.add_argument('content', help=t('链接或其他二维码内容'))
    p.add_argument('-o', '--output', required=True, help=t('输出文件，扩展名为 .png 或 .svg'))
    p.add_argument('--color', type=color, default=color('#000000'), help=t('码颜色，如 #123456（默认黑色）'))
    p.add_argument('--background', type=color, default=color('#ffffff'), help=t('背景颜色，或 transparent（默认白色）'))
    p.add_argument('--module-shape', choices=['square', 'tile', 'circle'], default='square', help=t('码点形状：方形、圆角瓷砖、圆形'))
    p.add_argument('--eye-shape', choices=['square', 'rounded'], default='square', help=t('码眼形状：方形或中圆角'))
    p.add_argument('--image-shape', choices=['square', 'rounded'], default='square', help=t('整张图片外角：直角或圆角'))
    p.add_argument('--margin', type=positive, default=4, help=t('边距，单位为码点（默认 4）'))
    p.add_argument('--error-correction', choices=['L','M','Q','H'], type=str.upper, default='M', help=t('容错等级 L/M/Q/H（默认 M）'))
    p.add_argument('--version', type=int, choices=range(1, 41), help=t('二维码版本 1–40，边长为 17 + 4 × 版本；默认自动选择'))
    p.add_argument('--size', type=int, default=1024, help=t('输出宽高像素（默认 1024）'))
    p.add_argument('--verify', action='store_true', help=t('用 macOS Vision 校验生成的 PNG 可解码且内容一致'))
    p.add_argument('--logo', type=Path, help=t('中心 Logo 图片路径（PNG、JPEG 等 Pillow 支持的格式）'))
    p.add_argument('--logo-padding-px', type=positive, help=t('Logo 最小留白，单位为输出像素；实际边界按完整码点向外取整'))
    p.add_argument('--logo-scale', type=float, default=0.20, help=t('Logo 最大宽度占二维码本体边长比例（默认 0.20，最大 0.25）'))
    p.add_argument('--logo-modules', type=int, help=t('Logo 最大边长占用的码点数（1–44，且不超过当前二维码本体边长的四分之一）'))
    args = p.parse_args()
    if args.lang and not resolve_locale(args.lang):
        p.error(t('不支持的语言：{lang}', lang=args.lang))
    out = Path(args.output).expanduser()
    if out.suffix.lower() not in ('.png', '.svg'): p.error(t('输出文件扩展名必须为 .png 或 .svg'))
    if args.verify and out.suffix.lower() != '.png': p.error(t('--verify 仅支持 PNG'))
    if args.size < 64 or args.size > 16384: p.error(t('--size 必须在 64–16384 之间'))
    if not 0 < args.logo_scale <= .25: p.error(t('--logo-scale 必须大于 0 且不超过 0.25'))
    if args.logo_modules is not None and not 1 <= args.logo_modules <= 44: p.error(t('--logo-modules 必须为 1–44 之间的整数'))
    if args.color[3] == 0: p.error(t('码颜色不能完全透明'))
    logo = None
    if args.logo:
        try:
            with Image.open(args.logo.expanduser()) as source:
                logo = source.convert('RGBA')
        except (OSError, ValueError) as exc:
            p.error(t('无法读取 Logo: {error}', error=exc))
    settings = QRSettings(**{field: getattr(args, field) for field in QRSettings.__dataclass_fields__
                             if field not in ('logo', 'logo_padding_modules')}, logo=logo)
    try:
        rendered = render_qr(settings, out.suffix.lower()[1:])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(rendered.data)
    except ValueError as exc:
        p.error(str(exc))
    except OSError as exc:
        p.error(t('无法写入文件: {error}', error=exc))
    if args.verify:
        verifier = Path(__file__).resolve().with_name('verify.swift')
        result = subprocess.run(['/usr/bin/swift', str(verifier), str(out)], capture_output=True, text=True)
        if result.returncode != 0 or result.stdout.removesuffix('\n') != args.content:
            print(t('验证失败：macOS Vision 未能读出完全一致的内容；文件已保留，请调整参数。'), file=sys.stderr)
            return 1
        print(t('已验证：macOS Vision 解码内容一致。'))
    print(t('已生成 {path}（版本 {version}，{modules}×{modules}，容错 {error_correction}）',
            path=out.resolve(), version=rendered.version, modules=rendered.modules,
            error_correction=args.error_correction))
    if args.margin < 4: print(t('提示：边距低于 4 个码点可能影响扫描。'), file=sys.stderr)
    if args.logo and args.error_correction not in ('Q','H'): print(t('提示：带 Logo 建议使用较高容错等级 H，并实际扫码验证。'), file=sys.stderr)

if __name__ == '__main__': sys.exit(main())
