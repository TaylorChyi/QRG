#!/usr/bin/env python3
"""Export QRG's black and white Icon Composer documents on macOS."""
import os
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'


def composer_tool():
    override = os.environ.get('ICON_COMPOSER_ICTOOL')
    if override:
        path = Path(override)
    else:
        developer = subprocess.check_output(['xcode-select', '-p'], text=True).strip()
        path = (Path(developer).parent / 'Applications' / 'Icon Composer.app'
                / 'Contents' / 'Executables' / 'ictool')
    if not path.is_file():
        raise SystemExit('需要 Icon Composer。可用 ICON_COMPOSER_ICTOOL 指定其 Contents/Executables/ictool。')
    return path


def export_icon(tool, document, stem):
    # Composer renders the native Liquid Glass effects, rather than imitating them.
    subprocess.run([
        str(tool), str(document), '--export-image',
        '--output-file', str(ASSETS / f'{stem}.png'),
        '--platform', 'macOS', '--rendition', 'Default',
        '--width', '1024', '--height', '1024', '--scale', '1',
        '--design-generation', '26',
    ], check=True)
    # actool applies the macOS layout and produces the legacy app-icon fallback.
    with tempfile.TemporaryDirectory(prefix='qrg-icon-') as temporary:
        output = Path(temporary)
        subprocess.run([
            'xcrun', 'actool', str(document), '--compile', str(output),
            '--app-icon', document.stem, '--platform', 'macosx',
            '--minimum-deployment-target', '14.0',
            '--output-partial-info-plist', str(output / 'icon-info.plist'),
            '--output-format', 'human-readable-text', '--errors', '--warnings',
        ], check=True)
        iconset = output / 'QRG.iconset'
        subprocess.run([
            'iconutil', '-c', 'iconset', str(output / f'{document.stem}.icns'),
            '-o', str(iconset),
        ], check=True)
        # actool puts only 16–256 px fallbacks in ICNS, expecting Assets.car for
        # larger sizes. QRG's standalone launcher needs a complete legacy ICNS.
        # Keep actool's small renditions and supply missing Composer sizes.
        with Image.open(ASSETS / f'{stem}.png') as source:
            for pixels, filename in ((64, 'icon_32x32@2x.png'),
                                     (512, 'icon_256x256@2x.png'),
                                     (512, 'icon_512x512.png'),
                                     (1024, 'icon_512x512@2x.png')):
                canvas = Image.new('RGBA', (pixels, pixels))
                extent = round(pixels * 824 / 1024)  # 100/1024 inset on each edge.
                offset = (pixels - extent) // 2
                canvas.alpha_composite(
                    source.resize((extent, extent), Image.Resampling.LANCZOS),
                    (offset, offset))
                canvas.save(iconset / filename)
        subprocess.run([
            'iconutil', '-c', 'icns', str(iconset),
            '-o', str(ASSETS / f'{stem}.icns'),
        ], check=True)


def write_flat_svg():
    """Portable flat vector companion; .icon documents own the glass effects."""
    ET.register_namespace('', 'http://www.w3.org/2000/svg')
    svg = ET.parse(ASSETS / 'QRG.icon' / 'Assets' / 'qr-mark.svg').getroot()
    tile = ET.Element('{http://www.w3.org/2000/svg}rect', {
        'width': '1024', 'height': '1024', 'rx': '224', 'fill': '#f0f0f0',
    })
    svg.insert(1, tile)
    ET.indent(svg, space='  ')
    (ASSETS / 'icon.svg').write_text(
        ET.tostring(svg, encoding='unicode') + '\n', encoding='utf-8')


def main():
    tool = composer_tool()
    export_icon(tool, ASSETS / 'QRG.icon', 'icon')
    export_icon(tool, ASSETS / 'QRG-Black.icon', 'icon-dark')
    write_flat_svg()
    print('已从 Icon Composer 导出黑白 PNG、macOS ICNS 和平面 SVG。')


if __name__ == '__main__':
    main()
