import subprocess
import math
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://app.huawei.com/qr/Ayb-zA-S3XC'

class QRTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.logo = self.folder / 'logo.png'
        Image.new('RGB', (100, 100), '#e34b40').save(self.logo)

    def run_qrg(self, *args):
        return subprocess.run([sys.executable, str(ROOT/'qrg.py'), *map(str, args)], capture_output=True, text=True)

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

    def test_rejects_insufficient_version(self):
        out = self.folder/'out.png'
        result = self.run_qrg(URL, '-o', out, '--version', 1, '--error-correction', 'H')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(out.exists())

if __name__ == '__main__': unittest.main()
