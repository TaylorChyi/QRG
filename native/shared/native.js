/* Native hosts supply QRGNative.postMessage; the public website never loads this file. */
(() => {
  'use strict';
  const pending = new Map();
  let sequence = 0;

  function request(action, values = {}) {
    return new Promise((resolve, reject) => {
      if (typeof window.QRGNative?.postMessage !== 'function') {
        reject(new Error('The native QRG host is unavailable.'));
        return;
      }
      const id = String(++sequence);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('The system operation timed out.'));
      }, 300_000);
      pending.set(id, { resolve, reject, timer });
      try { window.QRGNative.postMessage(JSON.stringify({ ...values, id, action })); }
      catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  window.QRGNativeResult = result => {
    const item = pending.get(String(result?.id));
    if (!item) return;
    pending.delete(String(result.id));
    clearTimeout(item.timer);
    if (result.ok) item.resolve(result);
    else item.reject(new Error(result.error || 'The system operation failed.'));
  };

  function report(error) {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = error.message;
      status.className = 'preview-error';
    }
  }

  async function save(blob, filename) {
    const dataURL = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Unable to read the exported image.'));
      reader.readAsDataURL(blob);
    });
    const result = await request('save', {
      filename, mime: blob.type.split(';')[0], data: dataURL.slice(dataURL.indexOf(',') + 1),
    });
    if (result.cancelled) throw new DOMException('Cancelled', 'AbortError');
  }

  function openExternal(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS links can be opened.');
    return request('openExternal', { url: url.href });
  }

  // The recognition flow prepares a blank tab, then navigates only after a successful decode.
  // A detached document keeps that flow cancellable without creating a second native window.
  window.open = value => {
    const proxy = {
      opener: null, closed: false, document: document.implementation.createHTMLDocument(''),
      close() { this.closed = true; },
      location: { replace(url) {
        if (proxy.closed) return;
        openExternal(url).catch(report);
        proxy.closed = true;
      } },
    };
    if (value && value !== 'about:blank') proxy.location.replace(value);
    return proxy;
  };

  const clipboard = new EventTarget();
  Object.assign(clipboard, {
    async read() {
      const value = await request('clipboard');
      if (value.mime?.startsWith('image/') && value.data) {
        const bytes = Uint8Array.from(atob(value.data), item => item.charCodeAt(0));
        const blob = new Blob([bytes], { type: value.mime });
        return [{ types: [value.mime], getType: async () => blob }];
      }
      const blob = new Blob([value.text || ''], { type: 'text/plain' });
      return [{ types: ['text/plain'], getType: async () => blob }];
    },
    async readText() { return (await request('clipboard')).text || ''; },
  });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
  // Native clipboard access is explicitly initiated by a click, never permission polling.
  const permissions = navigator.permissions;
  if (permissions?.query) {
    const originalQuery = permissions.query.bind(permissions);
    permissions.query = descriptor => descriptor.name === 'clipboard-read'
      ? Promise.resolve({ state: 'prompt', addEventListener() {} }) : originalQuery(descriptor);
  }
  window.QRGNativeBridge = { save, openExternal };
})();
