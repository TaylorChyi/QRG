"""Language selection and translated response regressions."""

import ast
import re
import subprocess
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from string import Formatter

from qrg_i18n import LANGUAGES, catalogue, current_locale, negotiate_locale, resolve_locale, reset_locale, set_locale, t
from qrg_web import app

ROOT = Path(__file__).resolve().parents[1]


def source_messages():
    """Read actual translation calls so new visible copy needs a catalogue entry."""
    keys = set()
    for filename in ('qrg.py', 'qrg_web.py'):
        tree = ast.parse((ROOT / filename).read_text(encoding='utf-8'))
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                    and node.func.id == 't' and node.args
                    and isinstance(node.args[0], ast.Constant)
                    and isinstance(node.args[0].value, str)):
                keys.add(node.args[0].value)
            if filename == 'qrg_web.py' and isinstance(node, ast.Dict):
                # HTTP status messages are looked up by number before passing to t().
                keys.update(value.value for value in node.values
                            if isinstance(value, ast.Constant) and isinstance(value.value, str)
                            and any('\u4e00' <= char <= '\u9fff' for char in value.value))
    for filename in (*sorted((ROOT / 'web/static').glob('*.js')), ROOT / 'web/templates/index.html'):
        text = filename.read_text(encoding='utf-8')
        keys.update(match.group(2) for match in re.finditer(r"\bt\(\s*(['\"])(.*?)\1", text)
                    if '\n' not in match.group(2))
    # controls.js translates these labels through t(name) and t(label).
    keys.update(('红色', '绿色', '蓝色', '增加', '减少'))
    return keys


def placeholders(value):
    return {name for _, name, _, _ in Formatter().parse(value) if name is not None}


class LanguageTests(unittest.TestCase):
    def test_language_tag_and_quality_negotiation(self):
        self.assertEqual(resolve_locale('zh-Hant-HK'), 'zh-TW')
        self.assertEqual(resolve_locale('zh_Hans_CN.UTF-8'), 'zh-CN')
        self.assertEqual(resolve_locale('zh-Hans-TW'), 'zh-CN')
        self.assertEqual(resolve_locale('zh-Hant-CN'), 'zh-TW')
        self.assertEqual(resolve_locale('es-MX'), 'es')
        self.assertIsNone(resolve_locale('xx-XX'))
        self.assertEqual(negotiate_locale('ja;q=0.4,fr-FR;q=0.9,en;q=0'), 'fr')
        self.assertEqual(negotiate_locale('xx;q=1,en;q=0,zh-Hant;q=0.7'), 'zh-TW')
        self.assertEqual(negotiate_locale('en;q=0'), 'zh-CN')

    def test_catalogue_format_and_context_restoration(self):
        translated = catalogue('en').get('请输入链接')
        self.assertTrue(translated)
        original = current_locale()
        token = set_locale('en')
        try:
            self.assertEqual(t('请输入链接'), translated)
        finally:
            reset_locale(token)
        self.assertEqual(current_locale(), original)

    def test_every_catalogue_covers_visible_messages_and_placeholders(self):
        expected = source_messages()
        self.assertGreater(len(expected), 190)
        for locale, _name in LANGUAGES:
            if locale == 'zh-CN':
                continue
            with self.subTest(locale=locale):
                messages = catalogue(locale)
                self.assertEqual(set(messages), expected)
                self.assertTrue(all(value.strip() for value in messages.values()))
                self.assertEqual([key for key, value in messages.items()
                                  if placeholders(key) != placeholders(value)], [])

    def test_web_precedence_and_request_isolation(self):
        app.config['TESTING'] = True
        client = app.test_client()
        client.set_cookie('qrg-language', 'ja')
        response = client.get('/', headers={'Accept-Language': 'fr-FR'})
        self.assertEqual(response.headers['Content-Language'], 'ja')
        self.assertIn('Cookie', response.headers['Vary'])
        self.assertIn('Accept-Language', response.headers['Vary'])
        response = client.post('/api/render?lang=en', json={}, headers={'Accept-Language': 'fr-FR'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.headers['Content-Language'], 'en')
        self.assertEqual(response.json['error'], catalogue('en')['请输入链接'])
        self.assertEqual(client.get('/api/i18n?lang=zh-TW').json['locale'], 'zh-TW')
        automatic = client.get('/api/i18n?lang=auto', headers={'Accept-Language': 'fr-FR'})
        self.assertEqual(automatic.json['locale'], 'fr')
        client.set_cookie('qrg-language', 'auto')
        self.assertEqual(client.get('/api/i18n', headers={'Accept-Language': 'de-DE'}).json['locale'], 'de')
        self.assertEqual(current_locale(), 'zh-CN')

    def test_json_and_http_errors_are_localised_without_context_leakage(self):
        app.config['TESTING'] = True
        client = app.test_client()
        invalid = client.post('/api/render?lang=fr', data='{', content_type='application/json')
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json['error'], catalogue('fr')['请求必须为有效的 JSON 对象'])
        missing = client.get('/api/absent?lang=de')
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json['error'], catalogue('de')['接口不存在'])
        chinese = client.post('/api/render', json={})
        self.assertEqual(chinese.json['error'], '请输入链接')
        self.assertEqual(current_locale(), 'zh-CN')

    def test_independent_clients_keep_their_request_language(self):
        app.config['TESTING'] = True

        def request_in(locale):
            with app.test_client() as client:
                return [client.post(f'/api/render?lang={locale}', json={}).json['error']
                        for _ in range(5)]

        with ThreadPoolExecutor(max_workers=2) as pool:
            english = pool.submit(request_in, 'en')
            japanese = pool.submit(request_in, 'ja')
            self.assertEqual(english.result(), [catalogue('en')['请输入链接']] * 5)
            self.assertEqual(japanese.result(), [catalogue('ja')['请输入链接']] * 5)

    def test_cli_explicit_language(self):
        result = subprocess.run([sys.executable, str(ROOT / 'qrg.py'), '--lang', 'en', '--help'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(catalogue('en')['生成可自定义样式的二维码（PNG 或 SVG）'], result.stdout)


if __name__ == '__main__':
    unittest.main()
