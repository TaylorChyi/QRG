#!/usr/bin/env python3
"""Build QRG's editable SVG, PNG and macOS icon from shared geometry."""
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
SIZE = 1024
EYES = ((232, 232), (568, 232), (232, 568))
TILES = ((0, 0), (2, 0), (0, 1), (1, 1), (1, 2), (2, 2))
CREAM = '#f7fff9'
MINT = '#79f2c0'
TOP = (32, 104, 89)
BOTTOM = (9, 48, 48)


def write_svg():
    parts = ['''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-labelledby="title desc">
  <title id="title">QRG</title>
  <desc id="desc">Three ivory QR finder patterns and mint tiles on a forest-green rounded square.</desc>
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#206859"/>
      <stop offset="1" stop-color="#093030"/>
    </linearGradient>
    <filter id="shadow" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#051e20" flood-opacity="0.22"/>
    </filter>
    <mask id="eyes">
      <rect width="1024" height="1024" fill="black"/>''']
    for x, y in EYES:
        parts += [f'      <rect x="{x}" y="{y}" width="224" height="224" rx="54" fill="white"/>',
                  f'      <rect x="{x+40}" y="{y+40}" width="144" height="144" rx="20" fill="black"/>',
                  f'      <rect x="{x+80}" y="{y+80}" width="64" height="64" rx="12" fill="white"/>']
    parts += ['    </mask>', '  </defs>',
              '  <rect x="96" y="96" width="832" height="832" rx="188" fill="url(#background)" filter="url(#shadow)"/>',
              f'  <rect width="1024" height="1024" fill="{CREAM}" mask="url(#eyes)"/>']
    for col, row in TILES:
        parts.append(f'  <rect x="{568+col*80}" y="{568+row*80}" width="64" height="64" rx="12" fill="{MINT}"/>')
    parts.append('</svg>')
    (ASSETS / 'icon.svg').write_text('\n'.join(parts) + '\n', encoding='utf-8')


def render_png():
    # Render at twice the output resolution for clean vector-like curves.
    factor = 2
    extent = SIZE * factor

    def box(x, y, width, height):
        return (x*factor, y*factor, (x+width)*factor-1, (y+height)*factor-1)

    silhouette = Image.new('L', (extent, extent))
    ImageDraw.Draw(silhouette).rounded_rectangle(box(96, 96, 832, 832), 188*factor, fill=255)
    shadow_mask = Image.new('L', (extent, extent))
    shadow_mask.paste(silhouette, (0, 14*factor))
    shadow_mask = shadow_mask.filter(ImageFilter.GaussianBlur(14*factor)).point(lambda v: round(v*.22))
    image = Image.new('RGBA', (extent, extent), (5, 30, 32, 0))
    image.putalpha(shadow_mask)

    gradient = Image.new('RGBA', (extent, extent))
    pen = ImageDraw.Draw(gradient)
    for y in range(extent):
        t = min(1, max(0, (y/factor-96)/832))
        colour = tuple(round(a+(b-a)*t) for a, b in zip(TOP, BOTTOM)) + (255,)
        pen.line((0, y, extent-1, y), fill=colour)
    gradient.putalpha(silhouette)
    image.alpha_composite(gradient)

    eyes = Image.new('L', (extent, extent))
    pen = ImageDraw.Draw(eyes)
    for x, y in EYES:
        pen.rounded_rectangle(box(x, y, 224, 224), 54*factor, fill=255)
        pen.rounded_rectangle(box(x+40, y+40, 144, 144), 20*factor, fill=0)
        pen.rounded_rectangle(box(x+80, y+80, 64, 64), 12*factor, fill=255)
    ink = Image.new('RGBA', (extent, extent), CREAM)
    ink.putalpha(eyes)
    image.alpha_composite(ink)
    pen = ImageDraw.Draw(image)
    for col, row in TILES:
        pen.rounded_rectangle(box(568+col*80, 568+row*80, 64, 64), 12*factor, fill=MINT)
    return image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def main():
    ASSETS.mkdir(exist_ok=True)
    write_svg()
    icon = render_png()
    icon.save(ASSETS / 'icon.png', optimize=True)
    iconutil = shutil.which('iconutil')
    if iconutil is None:
        raise SystemExit('SVG 和 PNG 已生成；生成 macOS .icns 需要 iconutil。')
    with tempfile.TemporaryDirectory(prefix='qrg-icon-') as temporary:
        iconset = Path(temporary) / 'QRG.iconset'
        iconset.mkdir()
        for logical in (16, 32, 128, 256, 512):
            for density in (1, 2):
                pixels = logical*density
                suffix = '@2x' if density == 2 else ''
                icon.resize((pixels, pixels), Image.Resampling.LANCZOS).save(
                    iconset / f'icon_{logical}x{logical}{suffix}.png')
        subprocess.run([iconutil, '-c', 'icns', str(iconset), '-o', str(ASSETS / 'icon.icns')], check=True)
    print('已生成 assets/icon.svg、assets/icon.png 和 assets/icon.icns。')


if __name__ == '__main__':
    main()
