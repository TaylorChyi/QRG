#!/usr/bin/env python3
"""Create styled QR codes as PNG or SVG."""
import argparse
import base64
import io
import math
import subprocess
import sys
from pathlib import Path

import qrcode
from PIL import Image, ImageColor, ImageDraw
from qrcode.exceptions import DataOverflowError

LEVELS = {'L': qrcode.constants.ERROR_CORRECT_L, 'M': qrcode.constants.ERROR_CORRECT_M,
          'Q': qrcode.constants.ERROR_CORRECT_Q, 'H': qrcode.constants.ERROR_CORRECT_H}

def color(value):
    if value.lower() == 'transparent':
        return (0, 0, 0, 0)
    try:
        return ImageColor.getcolor(value, 'RGBA')
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f'无效颜色: {value}') from exc

def positive(value):
    try:
        n = int(value)
        if n < 0: raise ValueError()
        return n
    except ValueError as exc:
        raise argparse.ArgumentTypeError('请输入非负整数') from exc

def svg_color(c):
    return f'#{c[0]:02x}{c[1]:02x}{c[2]:02x}', c[3] / 255

def main():
    p = argparse.ArgumentParser(description='生成可自定义样式的二维码（PNG 或 SVG）')
    p.add_argument('content', help='链接或其他二维码内容')
    p.add_argument('-o', '--output', required=True, help='输出文件，扩展名为 .png 或 .svg')
    p.add_argument('--color', type=color, default=color('#000000'), help='码颜色，如 #123456（默认黑色）')
    p.add_argument('--background', type=color, default=color('#ffffff'), help='背景颜色，或 transparent（默认白色）')
    p.add_argument('--module-shape', choices=['square', 'tile', 'circle'], default='square', help='码点形状：方形、圆角瓷砖、圆形')
    p.add_argument('--eye-shape', choices=['square', 'rounded'], default='square', help='码眼形状：方形或中圆角')
    p.add_argument('--margin', type=positive, default=4, help='边距，单位为码点（默认 4）')
    p.add_argument('--error-correction', choices=['L','M','Q','H'], type=str.upper, default='M', help='容错等级 L/M/Q/H（默认 M）')
    p.add_argument('--version', type=int, choices=range(1, 41), help='二维码版本 1–40，边长为 17 + 4 × 版本；默认自动选择')
    p.add_argument('--size', type=int, default=1024, help='输出宽高像素（默认 1024）')
    p.add_argument('--crisp', action='store_true', help='码点按原生像素绘制，不对边缘做抗锯齿')
    p.add_argument('--verify', action='store_true', help='用 macOS Vision 校验生成的 PNG 可解码且内容一致')
    p.add_argument('--logo', type=Path, help='中心 Logo 图片路径（PNG、JPEG 等 Pillow 支持的格式）')
    p.add_argument('--logo-padding-px', type=positive, help='Logo 最小留白，单位为输出像素；实际边界按完整码点向外取整')
    p.add_argument('--logo-scale', type=float, default=0.20, help='Logo 最大宽度占二维码本体边长比例（默认 0.20，最大 0.25）')
    args = p.parse_args()
    out = Path(args.output).expanduser()
    if out.suffix.lower() not in ('.png', '.svg'): p.error('输出文件扩展名必须为 .png 或 .svg')
    if args.verify and out.suffix.lower() != '.png': p.error('--verify 仅支持 PNG')
    if args.size < 64 or args.size > 16384: p.error('--size 必须在 64–16384 之间')
    if not 0 < args.logo_scale <= .25: p.error('--logo-scale 必须大于 0 且不超过 0.25')
    if args.color[3] == 0: p.error('码颜色不能完全透明')
    qr = qrcode.QRCode(version=args.version, error_correction=LEVELS[args.error_correction], box_size=1, border=0)
    qr.add_data(args.content)
    try:
        qr.make(fit=args.version is None)
    except DataOverflowError:
        p.error('内容无法放入指定版本和容错等级；请选择更大的版本或自动版本')
    matrix = qr.get_matrix(); n = len(matrix); total = n + 2 * args.margin
    if args.size < total: p.error(f'输出尺寸至少需要 {total} 像素，以容纳每个码点')
    scale = args.size / total
    fg, fa = svg_color(args.color); bg, ba = svg_color(args.background)
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{args.size}" height="{args.size}" viewBox="0 0 {total} {total}">',
             f'<rect width="{total}" height="{total}" fill="{bg}" fill-opacity="{ba}"/>']
    # Keep the QR grid on whole pixels; antialias only the rounded edges.
    supersample = 1 if args.crisp or args.size > 4096 else 4
    image = Image.new('RGBA', (args.size * supersample, args.size * supersample), args.background)
    draw = ImageDraw.Draw(image)
    px = (args.size // total) * supersample
    offset = (args.size * supersample - total * px) / 2
    def rect(x, y, w, h, radius, fill):
        x += args.margin; y += args.margin
        c, a = svg_color(fill)
        parts.append(f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{radius:g}" fill="{c}" fill-opacity="{a}"/>')
        box = (round(offset+x*px), round(offset+y*px), round(offset+(x+w)*px)-1, round(offset+(y+h)*px)-1)
        draw.rounded_rectangle(box, radius=radius*px, fill=fill)
    logo = None
    if args.logo:
        try:
            logo = Image.open(args.logo.expanduser()).convert('RGBA')
        except (OSError, ValueError) as exc:
            p.error(f'无法读取 Logo: {exc}')
        max_side = n * args.logo_scale
        logo.thumbnail((max(1, round(max_side*px)), max(1, round(max_side*px))), Image.Resampling.LANCZOS)
        lw, lh = logo.width/px, logo.height/px
        logo_x, logo_y = (n-lw)/2, (n-lh)/2
        padding = 1.25 if args.logo_padding_px is None else args.logo_padding_px * supersample / px
        clear_left = math.floor(logo_x-padding)
        clear_top = math.floor(logo_y-padding)
        clear_right = math.ceil(logo_x+lw+padding)
        clear_bottom = math.ceil(logo_y+lh+padding)
        # Do not erase alignment patterns, which are structural QR features.
        positions = qrcode.util.pattern_position(qr.version)
        for cy in positions:
            for cx in positions:
                if (cx <= 8 and cy <= 8) or (cx >= n-9 and cy <= 8) or (cx <= 8 and cy >= n-9):
                    continue
                if clear_left < cx+3 and clear_right > cx-2 and clear_top < cy+3 and clear_bottom > cy-2:
                    p.error('Logo 留白与二维码的定位结构重叠；请减小 Logo 或更换版本')
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
        radius = 0 if args.eye_shape == 'square' else 1.5
        rect(x,y,7,7,radius,args.color)
        rect(x+1,y+1,5,5,0 if radius == 0 else .8,args.background)
        rect(x+2,y+2,3,3,0 if radius == 0 else .6,args.color)
        outer, _, centre = parts[start:]
        del parts[start:]
        inner_radius = 0 if radius == 0 else .8
        parts.append(f'<mask id="eye{index}"><rect width="{total}" height="{total}" fill="white"/><rect x="{x+1+args.margin}" y="{y+1+args.margin}" width="5" height="5" rx="{inner_radius}" fill="black"/></mask><g mask="url(#eye{index})">{outer}</g>{centre}')
    if logo is not None:
        x, y = logo_x, logo_y
        image.alpha_composite(logo, (round(offset+(x+args.margin)*px), round(offset+(y+args.margin)*px)))
        data = io.BytesIO(); logo.save(data, format='PNG')
        encoded = base64.b64encode(data.getvalue()).decode('ascii')
        parts.append(f'<image x="{x+args.margin:g}" y="{y+args.margin:g}" width="{lw:g}" height="{lh:g}" href="data:image/png;base64,{encoded}"/>')
    parts.append('</svg>')
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.suffix.lower() == '.svg':
            out.write_text('\n'.join(parts)+'\n', encoding='utf-8')
        else:
            if supersample != 1: image = image.resize((args.size,args.size), Image.Resampling.BOX)
            image.save(out, 'PNG')
    except OSError as exc:
        p.error(f'无法写入文件: {exc}')
    if args.verify:
        verifier = Path(__file__).resolve().with_name('verify.swift')
        result = subprocess.run(['/usr/bin/swift', str(verifier), str(out)], capture_output=True, text=True)
        if result.returncode != 0 or result.stdout.removesuffix('\n') != args.content:
            print('验证失败：macOS Vision 未能读出完全一致的内容；文件已保留，请调整参数。', file=sys.stderr)
            return 1
        print('已验证：macOS Vision 解码内容一致。')
    print(f'已生成 {out.resolve()}（版本 {qr.version}，{n}×{n}，容错 {args.error_correction}）')
    if args.margin < 4: print('提示：边距低于 4 个码点可能影响扫描。', file=sys.stderr)
    if args.logo and args.error_correction not in ('Q','H'): print('提示：带 Logo 建议使用较高容错等级 H，并实际扫码验证。', file=sys.stderr)

if __name__ == '__main__': sys.exit(main())
