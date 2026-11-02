"""Stateless QRG HTTP application. Run with script/run-web or Gunicorn."""
import argparse
import base64
import binascii
import io
import json
import math
import os
import warnings
from dataclasses import replace
from pathlib import Path

from flask import Flask, Response, jsonify, render_template, request, send_from_directory
from PIL import Image, ImageOps, UnidentifiedImageError
from werkzeug.exceptions import HTTPException

from qrg import LogoSizeError, QRSettings, color, logo_options, render_qr

ROOT = Path(__file__).resolve().parent
MAX_LOGO_BYTES = 2 * 1024 * 1024
MAX_LOGO_PIXELS = 4096 * 4096
app = Flask(__name__, template_folder='web/templates', static_folder='web/static')
app.config.update(
    MAX_CONTENT_LENGTH=3 * 1024 * 1024,
    TEMPLATES_AUTO_RELOAD=os.environ.get('QRG_TEMPLATE_AUTO_RELOAD') == '1',
)


def integer(data, key, default, low, high, nullable=False):
    value = data.get(key, default)
    if nullable and value is None:
        return None
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f'{key} 必须为 {low}–{high} 之间的整数')
    return value


def choice(data, key, default, options):
    value = data.get(key, default)
    if not isinstance(value, str) or value not in options:
        raise ValueError(f'{key} 的选项无效')
    return value


def read_logo(value):
    if value is None:
        return None
    if not isinstance(value, str) or ',' not in value:
        raise ValueError('Logo 必须为 PNG、JPEG 或 WebP 图片')
    header, encoded = value.split(',', 1)
    if header not in ('data:image/png;base64', 'data:image/jpeg;base64', 'data:image/webp;base64'):
        raise ValueError('Logo 仅支持 PNG、JPEG 和 WebP')
    if len(encoded) > 4 * math.ceil(MAX_LOGO_BYTES / 3):
        raise ValueError('Logo 文件不能超过 2 MiB')
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise ValueError('Logo 图片数据无效') from None
    if len(raw) > MAX_LOGO_BYTES:
        raise ValueError('Logo 文件不能超过 2 MiB')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw), formats=('PNG', 'JPEG', 'WEBP')) as image:
                if image.width * image.height > MAX_LOGO_PIXELS or max(image.size) > 4096:
                    raise ValueError('Logo 图片宽高不能超过 4096 像素')
                return ImageOps.exif_transpose(image).convert('RGBA')
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValueError('无法读取 Logo，请使用有效的 PNG、JPEG 或 WebP 图片') from None


def crop_logo(logo, crop):
    if crop is None:
        return logo
    if logo is None:
        raise ValueError('请先上传 Logo 再选择裁剪范围')
    if not isinstance(crop, dict) or set(crop) != {'x', 'y', 'width', 'height'}:
        raise ValueError('Logo 裁剪范围无效')
    if any(type(crop[key]) is not int for key in crop):
        raise ValueError('Logo 裁剪坐标必须为整数')
    x, y, width, height = (crop[key] for key in ('x', 'y', 'width', 'height'))
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > logo.width or y + height > logo.height:
        raise ValueError('Logo 裁剪范围超出图片边界')
    return logo.crop((x, y, x + width, y + height))


def settings_from_json(data):
    content = data.get('content', '')
    if not isinstance(content, str) or not content:
        raise ValueError('请输入链接')
    try:
        content_bytes = content.encode('utf-8')
    except UnicodeEncodeError:
        raise ValueError('内容包含无效字符') from None
    if len(content_bytes) > 8192:
        raise ValueError('内容不能超过 8192 个 UTF-8 字节；二维码容量还取决于容错等级')
    colours = {}
    for key, default in (('color', '#000000'), ('background', '#ffffff')):
        value = data.get(key, default)
        if not isinstance(value, str) or len(value) > 64:
            raise ValueError('请输入有效颜色')
        try:
            colours[key] = color(value)
        except argparse.ArgumentTypeError as exc:
            raise ValueError(str(exc)) from None
    if colours['color'][3] == 0:
        raise ValueError('码颜色不能完全透明')
    crisp = data.get('crisp', False)
    if type(crisp) is not bool:
        raise ValueError('crisp 必须为布尔值')
    logo_scale = data.get('logo_scale', .19)
    if type(logo_scale) not in (int, float) or not 0 < logo_scale <= .25:
        raise ValueError('Logo 比例必须大于 0 且不超过 0.25')
    logo = crop_logo(read_logo(data.get('logo')), data.get('logo_crop'))
    return QRSettings(
        content=content, **colours,
        module_shape=choice(data, 'module_shape', 'tile', ('square', 'tile', 'circle')),
        eye_shape=choice(data, 'eye_shape', 'rounded', ('square', 'rounded')),
        margin=integer(data, 'margin', 4, 0, 32),
        error_correction=choice(data, 'error_correction', 'H', ('L', 'M', 'Q', 'H')),
        version=integer(data, 'version', None, 1, 40, nullable=True),
        size=integer(data, 'size', 1024, 64, 4096),
        crisp=crisp, logo=logo, logo_scale=logo_scale,
        logo_modules=integer(data, 'logo_modules', None, 1, 44, nullable=True),
        logo_padding_px=integer(data, 'logo_padding_px', None, 0, 128, nullable=True),
        logo_padding_modules=integer(data, 'logo_padding_modules', None, 0, 8, nullable=True),
    )


@app.after_request
def response_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; "
        "img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; "
        "base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    )
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
    return response


@app.errorhandler(HTTPException)
def http_error(error):
    if request.path.startswith('/api/'):
        messages = {400: '请求必须为有效的 JSON 对象', 413: '请求过大，Logo 文件不能超过 2 MiB',
                    415: '请使用 application/json 请求', 404: '接口不存在', 405: '请求方法不支持'}
        return jsonify(error=messages.get(error.code, '请求失败')), error.code
    return error


@app.get('/')
def index():
    return render_template('index.html')


@app.get('/icon.png')
def icon():
    return send_from_directory(ROOT / 'assets', 'icon.png')


@app.get('/healthz')
def health():
    return jsonify(status='ok')


@app.post('/api/render')
def render():
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify(error='请求必须为 JSON 对象'), 400
    settings = None
    def available_logo_options():
        if settings is None:
            return None
        try:
            reference = render_qr(replace(settings, logo=None, logo_modules=None,
                                          logo_padding_px=None, logo_padding_modules=None), 'svg')
        except ValueError:
            return None
        return logo_options(reference.version, reference.modules)

    try:
        output_format = choice(data, 'format', 'png', ('png', 'svg'))
        settings = settings_from_json(data)
        result = render_qr(settings, output_format)
    except LogoSizeError as exc:
        details = {'error': str(exc), 'max_logo_modules': exc.max_modules}
        options = available_logo_options()
        if options is not None:
            details['logo_options'] = options
        return jsonify(details), 400
    except ValueError as exc:
        details = {'error': str(exc)}
        if settings is not None and settings.logo is not None:
            options = available_logo_options()
            if options is not None:
                details['logo_options'] = options
        return jsonify(details), 400
    headers = {
        'Content-Disposition': f'attachment; filename="qrg.{output_format}"',
        'X-QRG-Version': str(result.version), 'X-QRG-Modules': str(result.modules),
        'X-QRG-Logo-Max-Modules': str(result.modules // 4),
        'X-QRG-Logo-Options': json.dumps(logo_options(result.version, result.modules), separators=(',', ':')),
    }
    if settings.logo_modules is not None:
        headers['X-QRG-Logo-Modules'] = str(settings.logo_modules)
    return Response(result.data, mimetype='image/png' if output_format == 'png' else 'image/svg+xml', headers=headers)
