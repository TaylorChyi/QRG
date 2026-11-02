(() => {
  'use strict';

  let locale = document.documentElement.lang;
  let messages = JSON.parse(document.getElementById('i18n-catalogue').textContent);
  let requestID = 0;
  const selector = document.getElementById('language');
  let preference = selector.value;

  function t(source, values = {}) {
    return (messages[source] || source).replace(/\{(\w+)\}/g,
      (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
  }

  function apply(root = document) {
    for (const element of root.querySelectorAll('[data-i18n]')) {
      element.textContent = t(element.dataset.i18n);
    }
    for (const attribute of ['aria-label', 'title', 'alt', 'data-tooltip', 'content']) {
      for (const element of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
        element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
      }
    }
  }

  async function load(value, persist = false) {
    const id = ++requestID;
    const response = await fetch(`/api/i18n?lang=${encodeURIComponent(value)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (id !== requestID) return;
    locale = data.locale;
    messages = data.messages;
    document.documentElement.lang = locale;
    selector.value = value === 'auto' ? 'auto' : locale;
    preference = selector.value;
    if (persist) {
      document.cookie = `qrg-language=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
      const url = new URL(location.href);
      if (url.searchParams.has('lang')) {
        url.searchParams.delete('lang');
        history.replaceState(null, '', url);
      }
    }
    apply();
    document.dispatchEvent(new Event('qrg:languagechange'));
  }

  window.QRGI18n = { t, apply, apiURL: path => `${path}?lang=${encodeURIComponent(locale)}` };
  selector.addEventListener('change', () => {
    const selected = selector.value;
    load(selected, true).catch(() => {
      selector.value = preference;
      window.QRGControls?.sync();
      const status = document.getElementById('status');
      status.textContent = t('无法切换语言，请重试。');
      status.className = 'preview-error';
    });
  });
  window.QRGI18n.ready = Promise.resolve();
})();
