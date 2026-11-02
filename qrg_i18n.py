"""Small shared catalogue and locale negotiation for QRG's web and CLI surfaces."""

import json
import os
from contextvars import ContextVar
from functools import lru_cache
from pathlib import Path
from string import Formatter

LANGUAGES = (
    ('zh-CN', '简体中文'), ('zh-TW', '繁體中文'), ('en', 'English'),
    ('ja', '日本語'), ('ko', '한국어'), ('es', 'Español'),
    ('fr', 'Français'), ('de', 'Deutsch'),
)
DEFAULT_LOCALE = 'zh-CN'
_current_locale = ContextVar('qrg_locale', default=DEFAULT_LOCALE)
_catalogue_dir = Path(__file__).resolve().parent / 'locales'


def resolve_locale(value):
    """Map a supported BCP 47 language tag to a QRG catalogue, or None."""
    if not isinstance(value, str) or not value:
        return None
    tag = value.strip().replace('_', '-').split('.', 1)[0].split('@', 1)[0].lower()
    if tag == 'zh' or tag.startswith('zh-'):
        subtags = tag.split('-')[1:]
        if 'hans' in subtags:
            return 'zh-CN'
        if 'hant' in subtags:
            return 'zh-TW'
        if any(part in ('tw', 'hk', 'mo') for part in subtags):
            return 'zh-TW'
        return 'zh-CN'
    primary = tag.split('-', 1)[0]
    if primary in ('en', 'ja', 'ko', 'es', 'fr', 'de'):
        return primary
    return None


def negotiate_locale(header):
    """Choose the highest weighted supported Accept-Language, respecting q=0."""
    choices = []
    for index, item in enumerate((header or '').split(',')):
        language, *parameters = item.strip().split(';')
        quality = 1.0
        for parameter in parameters:
            name, _, value = parameter.strip().partition('=')
            if name.lower() == 'q':
                try:
                    quality = float(value)
                except ValueError:
                    quality = 0.0
        if 0 < quality <= 1:
            locale = resolve_locale(language)
            if locale:
                choices.append((-quality, index, locale))
    return min(choices)[2] if choices else DEFAULT_LOCALE


def environment_locale():
    for name in ('LC_ALL', 'LC_MESSAGES', 'LANG'):
        value = os.environ.get(name)
        if value:
            return resolve_locale(value) or DEFAULT_LOCALE
    return DEFAULT_LOCALE


def current_locale():
    return _current_locale.get()


def set_locale(locale):
    return _current_locale.set(resolve_locale(locale) or DEFAULT_LOCALE)


def reset_locale(token):
    _current_locale.reset(token)


@lru_cache(maxsize=len(LANGUAGES))
def catalogue(locale):
    locale = resolve_locale(locale) or DEFAULT_LOCALE
    if locale == DEFAULT_LOCALE:
        return {}
    with (_catalogue_dir / f'{locale}.json').open(encoding='utf-8') as source:
        messages = json.load(source)
    if not isinstance(messages, dict) or any(not isinstance(k, str) or not isinstance(v, str)
                                             for k, v in messages.items()):
        raise ValueError(f'Invalid QRG catalogue: {locale}')
    fields = lambda value: {name for _, name, _, _ in Formatter().parse(value) if name is not None}
    for source, translation in messages.items():
        if fields(source) != fields(translation):
            raise ValueError(f'Placeholder mismatch in QRG catalogue {locale}: {source}')
    return messages


def t(source, **values):
    translated = catalogue(current_locale()).get(source, source)
    return translated.format(**values) if values else translated
