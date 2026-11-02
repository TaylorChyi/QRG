import base64
import io
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from qrg_web import app

ROOT = Path(__file__).resolve().parents[1]


def logo_data(size=(100, 100)):
    buffer = io.BytesIO()
    Image.new('RGB', size, '#e34b40').save(buffer, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')


class WebTests(unittest.TestCase):
    def setUp(self):
        app.config['TESTING'] = True
        self.client = app.test_client()

    def render(self, **settings):
        return self.client.post('/api/render', json={'content': 'https://example.com', 'size': 400, **settings})

    def test_page_static_assets_and_health(self):
        page = self.client.get('/')
        self.assertEqual(page.status_code, 200)
        self.assertIn('QRG', page.get_data(as_text=True))
        for path in ('/static/app.css', '/static/app.js', '/icon.png'):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                response.close()
        self.assertEqual(self.client.get('/healthz').json, {'status': 'ok'})

    def test_png_dimensions_transparency_and_metadata(self):
        result = self.render(background='transparent', version=3)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.mimetype, 'image/png')
        self.assertEqual(result.headers['X-QRG-Version'], '3')
        self.assertEqual(result.headers['X-QRG-Modules'], '29')
        self.assertEqual(result.headers['Cache-Control'], 'no-store')
        with Image.open(io.BytesIO(result.data)) as image:
            self.assertEqual(image.size, (400, 400))
            self.assertEqual(image.getpixel((0, 0))[3], 0)

    def test_svg_logo_is_embedded_without_raster_canvas(self):
        logo = logo_data()
        with patch('qrg.Image.new', side_effect=AssertionError('SVG must not allocate a raster canvas')):
            result = self.render(format='svg', version=5, logo=logo, logo_padding_px=1)
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(result.mimetype, 'image/svg+xml')
        root = ET.fromstring(result.data)
        self.assertEqual(root.get('width'), '400')
        embedded = root.find('{http://www.w3.org/2000/svg}image')
        self.assertTrue(embedded.get('href').startswith('data:image/png;base64,'))

    def test_logo_alignment_rejected(self):
        result = self.render(version=7, logo=logo_data())
        self.assertEqual(result.status_code, 400)
        self.assertIn('定位结构重叠', result.json['error'])

    def test_insufficient_capacity_and_output_size(self):
        for params in ({'version': 1, 'content': 'x' * 200}, {'content': 'x' * 8192},
                       {'version': 40, 'size': 64}):
            with self.subTest(params=params.keys()):
                result = self.render(**params)
                self.assertEqual(result.status_code, 400)
                self.assertIn('error', result.json)

    def test_invalid_fields_are_controlled_client_errors(self):
        cases = [
            {'content': ''}, {'content': None}, {'content': '文' * 3000}, {'content': '\ud800'},
            {'size': 4097}, {'size': 63}, {'size': True}, {'size': 400.5}, {'margin': -1},
            {'version': 0}, {'version': []}, {'color': 'transparent'}, {'color': []},
            {'background': 'not-a-colour'}, {'module_shape': 'bad'}, {'eye_shape': {}},
            {'format': 'pdf'}, {'error_correction': 'X'}, {'crisp': 'false'},
            {'logo_scale': 0}, {'logo_scale': .26}, {'logo_scale': 10 ** 400},
            {'logo_scale': float('nan')}, {'logo_scale': float('inf')}, {'logo_scale': True},
            {'logo_padding_px': 129}, {'logo_padding_px': '1'},
        ]
        for params in cases:
            with self.subTest(field=next(iter(params))):
                response = self.render(**params)
                self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
                self.assertIn('error', response.json)

    def test_corrupt_and_unsupported_logos(self):
        for logo in ('/etc/passwd', 'https://example.com/logo.png',
                     'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,###',
                     'data:image/png;base64,bm90IGEgcG5n', [],
                     logo_data((4097, 1))):
            with self.subTest(kind=str(type(logo))):
                result = self.render(logo=logo)
                self.assertEqual(result.status_code, 400)

    def test_oversized_logo_and_request(self):
        result = self.render(logo='data:image/png;base64,' + 'A' * (2_800_000))
        self.assertEqual(result.status_code, 400)
        self.assertIn('2 MiB', result.json['error'])
        result = self.client.post('/api/render', data=b' ' * (3 * 1024 * 1024 + 1), content_type='application/json')
        self.assertEqual(result.status_code, 413)
        self.assertIn('error', result.json)

    def test_bad_json_and_methods(self):
        for body in ('null', '[]', '42', '{broken'):
            result = self.client.post('/api/render', data=body, content_type='application/json')
            self.assertEqual(result.status_code, 400)
            self.assertIn('error', result.json)
        self.assertEqual(self.client.post('/api/render', data='content=x').status_code, 415)
        self.assertEqual(self.client.get('/api/render').status_code, 405)

    def test_requests_do_not_share_contents_or_logos(self):
        first = self.render(content='private-first', logo=logo_data(), version=5, format='svg')
        second = self.render(content='different-second', version=5, format='svg')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertIn(b'<image', first.data)
        self.assertNotIn(b'<image', second.data)
        self.assertNotEqual(first.data, second.data)
        self.assertNotIn(b'private-first', first.data)

    @unittest.skipUnless(sys.platform == 'darwin', 'macOS Vision 解码校验仅在 macOS 上可用')
    def test_web_png_decodes_with_logo(self):
        content = 'https://example.com/qrg-web'
        result = self.render(content=content, version=5, logo=logo_data(), logo_scale=.19, logo_padding_px=1)
        self.assertEqual(result.status_code, 200)
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'qr.png'
            output.write_bytes(result.data)
            check = subprocess.run(['/usr/bin/swift', str(ROOT / 'verify.swift'), str(output)], capture_output=True, text=True)
        self.assertEqual(check.returncode, 0, check.stderr)
        self.assertEqual(check.stdout.removesuffix('\n'), content)


if __name__ == '__main__':
    unittest.main()
