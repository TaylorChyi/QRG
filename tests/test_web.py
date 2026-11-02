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
        for path in ('/static/app.css', '/static/controls.css', '/static/controls.js', '/static/app.js', '/icon.png'):
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

    def test_small_uploaded_icon_obeys_scale_and_clearance(self):
        logo = logo_data((16, 8))
        renders = {}
        for scale, padding in ((.10, 0), (.20, 0), (.20, 32)):
            result = self.render(format='svg', version=5, logo=logo,
                                 logo_scale=scale, logo_padding_px=padding)
            self.assertEqual(result.status_code, 200, result.json)
            renders[(scale, padding)] = ET.fromstring(result.data)
        ns = '{http://www.w3.org/2000/svg}'
        small = renders[(.10, 0)].find(ns + 'image')
        large = renders[(.20, 0)].find(ns + 'image')
        self.assertGreater(float(small.get('width')), 16 / 8)
        self.assertAlmostEqual(float(large.get('width')) / float(small.get('width')), 2, delta=.1)
        self.assertAlmostEqual(float(large.get('width')) / float(large.get('height')), 2, delta=.1)
        self.assertLess(len(renders[(.20, 32)].findall(ns + 'rect')),
                        len(renders[(.20, 0)].findall(ns + 'rect')))

    def test_logo_module_size_is_exact_and_keeps_aspect_ratio(self):
        logo = logo_data((16, 8))
        widths = []
        for modules in (5, 7):
            result = self.render(format='svg', version=5, logo=logo,
                                 logo_modules=modules, logo_scale=.05, logo_padding_px=0)
            self.assertEqual(result.status_code, 200, result.json)
            self.assertEqual(result.headers['X-QRG-Logo-Max-Modules'], '9')
            self.assertEqual(result.headers['X-QRG-Logo-Modules'], str(modules))
            embedded = ET.fromstring(result.data).find('{http://www.w3.org/2000/svg}image')
            widths.append(float(embedded.get('width')))
            self.assertEqual(float(embedded.get('width')), modules)
            self.assertEqual(float(embedded.get('height')), modules / 2)
        self.assertEqual(widths, [5, 7])

    def test_logo_module_limit_uses_resolved_qr_version(self):
        result = self.render(content='x', version=1, logo=logo_data(), logo_modules=6)
        self.assertEqual(result.status_code, 400)
        self.assertEqual(result.json['max_logo_modules'], 5)
        self.assertIn('5 个码点', result.json['error'])
        accepted = self.render(content='x', version=1, logo_modules=5)
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.headers['X-QRG-Logo-Max-Modules'], '5')
        self.assertEqual(accepted.headers['X-QRG-Logo-Modules'], '5')
        self.assertEqual(self.render(content='x', version=1).headers['X-QRG-Logo-Max-Modules'], '5')

    def test_logo_crop_selects_source_pixels_before_embedding(self):
        source = Image.new('RGB', (40, 20), '#ff0000')
        source.paste('#0000ff', (20, 0, 40, 20))
        buffer = io.BytesIO()
        source.save(buffer, 'PNG')
        logo = 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')
        result = self.render(format='svg', version=5, logo=logo,
                             logo_crop={'x': 20, 'y': 0, 'width': 20, 'height': 20})
        self.assertEqual(result.status_code, 200, result.json)
        embedded = ET.fromstring(result.data).find('{http://www.w3.org/2000/svg}image')
        with Image.open(io.BytesIO(base64.b64decode(embedded.get('href').split(',', 1)[1]))) as cropped:
            self.assertEqual(cropped.size[0], cropped.size[1])
            self.assertEqual(cropped.getpixel((cropped.width // 2, cropped.height // 2))[:3], (0, 0, 255))

    def test_logo_crop_uses_exif_oriented_coordinates(self):
        source = Image.new('RGB', (40, 20), '#ff0000')
        source.paste('#0000ff', (20, 0, 40, 20))
        exif = Image.Exif()
        exif[274] = 6
        buffer = io.BytesIO()
        source.save(buffer, 'JPEG', exif=exif)
        logo = 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')
        result = self.render(format='svg', version=5, logo=logo,
                             logo_crop={'x': 0, 'y': 20, 'width': 20, 'height': 20})
        self.assertEqual(result.status_code, 200, result.json)
        embedded = ET.fromstring(result.data).find('{http://www.w3.org/2000/svg}image')
        with Image.open(io.BytesIO(base64.b64decode(embedded.get('href').split(',', 1)[1]))) as cropped:
            r, g, b = cropped.getpixel((cropped.width // 2, cropped.height // 2))[:3]
            self.assertLess(r, 20)
            self.assertLess(g, 20)
            self.assertGreater(b, 230)

    def test_invalid_logo_crops_are_client_errors(self):
        logo = logo_data((40, 20))
        cases = [
            ({'x': 0, 'y': 0, 'width': 1, 'height': 1}, None),
            ({'x': -1, 'y': 0, 'width': 1, 'height': 1}, logo),
            ({'x': 20, 'y': 0, 'width': 21, 'height': 1}, logo),
            ({'x': 0, 'y': 0, 'width': 0, 'height': 1}, logo),
            ({'x': True, 'y': 0, 'width': 1, 'height': 1}, logo),
            ({'x': 0.5, 'y': 0, 'width': 1, 'height': 1}, logo),
            ({'x': 0, 'y': 0, 'width': 1}, logo),
            ({'x': 0, 'y': 0, 'width': 1, 'height': 1, 'extra': 1}, logo),
            ([0, 0, 1, 1], logo),
        ]
        for crop, image in cases:
            with self.subTest(crop=crop, has_logo=image is not None):
                result = self.render(logo=image, logo_crop=crop)
                self.assertEqual(result.status_code, 400)

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
            {'logo_modules': 0}, {'logo_modules': 45}, {'logo_modules': -1},
            {'logo_modules': 5.0}, {'logo_modules': '5'}, {'logo_modules': True},
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
