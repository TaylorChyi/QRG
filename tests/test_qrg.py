import subprocess
import io
import math
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image
from qrg import QRSettings, logo_options, render_qr

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://app.huawei.com/qr/Ayb-zA-S3XC'


def module_rects(svg, margin):
    root = ET.fromstring(svg)
    ns = '{http://www.w3.org/2000/svg}'
    return {(int(float(rect.get('x'))) - margin, int(float(rect.get('y'))) - margin)
            for rect in root.findall(ns + 'rect')
            if rect.get('width') == '1' and rect.get('height') == '1'}

class QRTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.logo = self.folder / 'logo.png'
        Image.new('RGB', (100, 100), '#e34b40').save(self.logo)

    def run_qrg(self, *args):
        return subprocess.run([sys.executable, str(ROOT/'qrg.py'), *map(str, args)], capture_output=True, text=True)

    @unittest.skipUnless(sys.platform == 'darwin', 'macOS Vision 解码校验仅在 macOS 上可用')
    def test_png_decodes_with_logo(self):
        out = self.folder/'out.png'
        result = self.run_qrg(URL, '-o', out, '--size', 400, '--version', 5, '--margin', 3,
                              '--error-correction', 'H', '--module-shape', 'tile', '--eye-shape', 'rounded',
                              '--logo', self.logo, '--logo-scale', '.19', '--verify')
        self.assertEqual(result.returncode, 0, result.stderr)
        with Image.open(out) as image:
            self.assertEqual(image.size, (400, 400))

    def test_svg_logo_clearance_never_cuts_modules(self):
        out = self.folder/'out.svg'
        result = self.run_qrg(URL, '-o', out, '--size', 400, '--version', 5, '--margin', 3,
                              '--error-correction', 'H', '--module-shape', 'tile', '--logo', self.logo,
                              '--logo-scale', '.19')
        self.assertEqual(result.returncode, 0, result.stderr)
        root = ET.parse(out).getroot()
        ns = '{http://www.w3.org/2000/svg}'
        tiles = [e for e in root.findall(ns+'rect') if e.get('width') == '0.76']
        self.assertTrue(tiles)
        image = root.find(ns+'image')
        x = float(image.get('x')) - 3
        y = float(image.get('y')) - 3
        left, top = math.floor(x-1.25), math.floor(y-1.25)
        right = math.ceil(x+float(image.get('width'))+1.25)
        bottom = math.ceil(y+float(image.get('height'))+1.25)
        for tile in tiles:
            x = float(tile.get('x')) - 3
            y = float(tile.get('y')) - 3
            self.assertFalse(left <= int(x) < right and top <= int(y) < bottom)
            self.assertEqual(tile.get('height'), '0.76')

    def test_rejects_logo_over_alignment_pattern(self):
        out = self.folder/'out.png'
        result = self.run_qrg(URL, '-o', out, '--version', 7, '--error-correction', 'H', '--logo', self.logo)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('定位结构重叠', result.stderr)
        self.assertFalse(out.exists())

    def test_cli_logo_modules_are_exact_and_override_scale(self):
        out = self.folder / 'modules.svg'
        result = self.run_qrg(URL, '-o', out, '--size', 400, '--version', 5,
                              '--error-correction', 'H', '--logo', self.logo,
                              '--logo-modules', 5, '--logo-scale', '.05', '--logo-padding-px', 0)
        self.assertEqual(result.returncode, 0, result.stderr)
        embedded = ET.parse(out).getroot().find('{http://www.w3.org/2000/svg}image')
        self.assertEqual(float(embedded.get('width')), 5)
        self.assertEqual(float(embedded.get('height')), 5)

    def test_cli_logo_modules_rejects_invalid_and_version_limit(self):
        for requested in (0, 45, -1, 'abc', 10):
            with self.subTest(requested=requested):
                out = self.folder / f'invalid-{requested}.svg'
                result = self.run_qrg(URL, '-o', out, '--version', 5,
                                      '--error-correction', 'H', '--logo', self.logo,
                                      '--logo-modules', requested)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('--logo-modules' if requested != 10 else '最多为 9 个码点', result.stderr)
                self.assertFalse(out.exists())

    def test_module_slot_removes_exact_grid_cells_for_odd_and_even_sizes(self):
        icon = Image.new('RGBA', (40, 20), (250, 0, 0, 128))
        base = QRSettings(content='x', version=1, error_correction='H',
                          margin=4, size=290, logo_padding_px=0)
        reference = module_rects(render_qr(base, 'svg').data, base.margin)
        self.assertTrue(reference)
        for count in (1, 2, 3, 4, 5):
            with self.subTest(count=count):
                settings = QRSettings(**{**base.__dict__, 'logo': icon, 'logo_modules': count})
                rendered = render_qr(settings, 'svg')
                slot_left = (rendered.modules - count) // 2
                expected = {cell for cell in reference if not
                            (slot_left <= cell[0] < slot_left + count and
                             slot_left <= cell[1] < slot_left + count)}
                self.assertEqual(module_rects(rendered.data, base.margin), expected)
                embedded = ET.fromstring(rendered.data).find('{http://www.w3.org/2000/svg}image')
                self.assertEqual(float(embedded.get('width')), count)
                self.assertAlmostEqual(float(embedded.get('height')), count / 2, delta=.1)
                self.assertGreaterEqual(float(embedded.get('x')), base.margin + slot_left)
                self.assertGreaterEqual(float(embedded.get('y')), base.margin + slot_left)

    def test_module_slot_png_logo_pixels_stay_inside_reserved_square(self):
        icon = Image.new('RGBA', (40, 20), (250, 0, 0, 128))
        settings = QRSettings(content='x', version=1, error_correction='H',
                              margin=4, size=290, crisp=True, logo=icon,
                              logo_modules=2, logo_padding_px=0)
        rendered = render_qr(settings, 'png')
        slot_left = (rendered.modules - settings.logo_modules) // 2
        lower = (settings.margin + slot_left) * 10
        upper = lower + settings.logo_modules * 10
        with Image.open(io.BytesIO(rendered.data)) as qr:
            red = []
            for y in range(qr.height):
                for x in range(qr.width):
                    r, g, b, _ = qr.getpixel((x, y))
                    if r > 200 and g < 180 and b < 180:
                        red.append((x, y))
        self.assertTrue(red)
        self.assertEqual((min(x for x, _ in red), max(x for x, _ in red)), (lower, upper - 1))
        self.assertGreaterEqual(min(y for _, y in red), lower)
        self.assertLess(max(y for _, y in red), upper)

    def test_module_slot_padding_expands_by_whole_cells_and_guards_alignment(self):
        icon = Image.new('RGBA', (40, 20), (250, 0, 0, 128))
        base = QRSettings(content='x', version=1, error_correction='H',
                          margin=4, size=290, logo=icon, logo_modules=2, logo_padding_px=0)
        tight = module_rects(render_qr(base, 'svg').data, base.margin)
        padded = module_rects(render_qr(QRSettings(**{**base.__dict__, 'logo_padding_px': 11}), 'svg').data, base.margin)
        reference = module_rects(render_qr(QRSettings(**{**base.__dict__, 'logo': None}), 'svg').data, base.margin)
        self.assertEqual(padded, {cell for cell in reference if not (7 <= cell[0] < 13 and 7 <= cell[1] < 13)})
        self.assertLess(len(padded), len(tight))
        out = self.folder / 'alignment.svg'
        result = self.run_qrg('x', '-o', out, '--version', 7, '--logo', self.logo,
                              '--logo-modules', 2, '--logo-padding-px', 0)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('定位结构重叠', result.stderr)

    def test_module_padding_clears_exact_cell_rings(self):
        icon = Image.new('RGBA', (40, 20), (250, 0, 0, 128))
        base = QRSettings(content='x', version=1, error_correction='H', margin=4,
                          size=290, logo=icon, logo_modules=2)
        reference = module_rects(render_qr(QRSettings(**{**base.__dict__, 'logo': None}), 'svg').data, 4)
        for padding in (0, 1, 2):
            with self.subTest(padding=padding):
                settings = QRSettings(**{**base.__dict__, 'logo_padding_modules': padding})
                actual = module_rects(render_qr(settings, 'svg').data, 4)
                left, right = 9 - padding, 11 + padding
                self.assertEqual(actual, {cell for cell in reference if not
                                 (left <= cell[0] < right and left <= cell[1] < right)})
        with self.assertRaisesRegex(ValueError, '只能选择'):
            render_qr(QRSettings(**{**base.__dict__, 'logo_padding_px': 1,
                                    'logo_padding_modules': 1}), 'svg')

    def test_logo_options_match_real_renderability(self):
        icon = Image.new('RGB', (10, 10), '#e34b40')
        for version in (1, 5, 7, 15):
            with self.subTest(version=version):
                modules = 17 + 4 * version
                options = logo_options(version, modules)
                if version == 7:
                    self.assertEqual(options, {}, 'central alignment pattern leaves no valid slot')
                else:
                    self.assertTrue(options)
                for side in (2, 3, 5, 7, 9, 11, 15, modules // 4):
                    if side > modules // 4:
                        continue
                    for padding in (0, 1, 2):
                        settings = QRSettings(content='x', version=version, size=1024,
                                              logo=icon, logo_modules=side,
                                              logo_padding_modules=padding)
                        allowed = padding in options.get(str(side), [])
                        try:
                            render_qr(settings, 'svg')
                        except ValueError:
                            self.assertFalse(allowed, (version, side, padding))
                        else:
                            self.assertTrue(allowed, (version, side, padding))

    def test_rejects_insufficient_version(self):
        out = self.folder/'out.png'
        result = self.run_qrg(URL, '-o', out, '--version', 1, '--error-correction', 'H')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(out.exists())

if __name__ == '__main__': unittest.main()
