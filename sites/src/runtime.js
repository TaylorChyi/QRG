import { render } from './renderer.js';
import { decode } from './decoder.js';
import { catalogue, chooseLocale, translator } from './locale.js';

const networkFetch = window.fetch.bind(window);
const cookie = document.cookie.split('; ').find(item => item.startsWith('qrg-language='));
let savedLanguage;
try { savedLanguage = cookie ? decodeURIComponent(cookie.slice('qrg-language='.length)) : null; }
catch { savedLanguage = null; }
const preference = new URL(location.href).searchParams.get('lang') || savedLanguage || 'auto';
const languages = navigator.languages || [navigator.language];

async function localFetch(input, options = {}) {
  const url = new URL(input, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return networkFetch(input, options);
  options.signal?.throwIfAborted();
  const locale = chooseLocale(url.searchParams.get('lang') || preference, languages);
  const t = translator(locale);
  const json = (data, status = 200) => Response.json(data, {
    status, headers: { 'Content-Language': locale, 'Cache-Control': 'no-store' },
  });
  let response;
  try {
    if (url.pathname === '/api/i18n' && (!options.method || options.method === 'GET')) {
      response = json({ locale, messages: catalogue(locale) });
    } else if (['/api/render', '/api/decode'].includes(url.pathname) && options.method === 'POST') {
      const data = JSON.parse(options.body);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(t('请求必须为 JSON 对象'));
      response = url.pathname === '/api/render' ? await render(data, t) : json(await decode(data, t));
    } else {
      response = json({ error: t('接口不存在') }, 404);
    }
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    response = json({ error: error.message || t('请求失败') }, 400);
  }
  options.signal?.throwIfAborted();
  return response;
}

window.QRGSite = { fetch: localFetch, localePreference: preference };
