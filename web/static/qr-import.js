(() => {
  'use strict';

  const content = document.getElementById('content');
  const button = document.getElementById('import-qr');
  const pasteButton = document.getElementById('paste-content');
  const fileInput = document.getElementById('qr-file');
  const status = document.getElementById('qr-import-status');
  const field = content.closest('.content-field');
  const t = (...args) => window.QRGI18n.t(...args);
  let controller = null;
  let reader = null;
  let sequence = 0;
  let dragDepth = 0;
  let clipboardState = 'unknown';
  let clipboardPermission = null;
  let clipboardProbe = 0;
  let pasteBusy = false;
  const clipboardSupported = Boolean(navigator.clipboard?.read || navigator.clipboard?.readText);

  function refreshPasteButton() {
    pasteButton.disabled = !clipboardSupported || pasteBusy;
    pasteButton.dataset.clipboard = clipboardState;
    pasteButton.setAttribute('aria-busy', String(pasteBusy));
    pasteButton.title = !clipboardSupported ? t('浏览器无法读取剪贴板，请在链接框使用粘贴快捷键。')
      : pasteBusy ? t('正在读取剪贴板…')
      : clipboardState === 'empty' ? t('剪贴板中没有可粘贴的图片或文字。')
      : clipboardState === 'ready' ? t('点击粘贴剪贴板中的图片或文字') : t('点击读取并粘贴剪贴板内容');
  }

  async function readClipboard(includeImages = false) {
    if (!navigator.clipboard.read) return { files: [], hasImage: false, text: await navigator.clipboard.readText() };
    const items = await navigator.clipboard.read();
    const images = items.map(item => ({ item, type: item.types.find(type => ['image/png', 'image/jpeg', 'image/webp'].includes(type))
      || item.types.find(type => type.startsWith('image/')) }))
      .filter(image => image.type);
    if (images.length) {
      const files = includeImages ? await Promise.all(images.map(async ({ item, type }) =>
        new File([await item.getType(type)], 'clipboard-image', { type }))) : [];
      return { files, hasImage: true, text: '' };
    }
    const texts = await Promise.all(items.filter(item => item.types.includes('text/plain'))
      .map(async item => (await item.getType('text/plain')).text()));
    return { files: [], hasImage: false, text: texts.join('\n') };
  }

  async function refreshClipboard() {
    const probe = ++clipboardProbe;
    if (pasteBusy || document.hidden || !document.hasFocus()) return;
    if (clipboardPermission?.state !== 'granted') {
      clipboardState = 'unknown';
      refreshPasteButton();
      return;
    }
    try {
      const data = await readClipboard();
      if (probe !== clipboardProbe) return;
      clipboardState = data.hasImage || data.text.trim() ? 'ready' : 'empty';
    } catch {
      if (probe !== clipboardProbe) return;
      clipboardState = 'unknown';
    }
    refreshPasteButton();
  }

  async function watchClipboard() {
    try {
      clipboardPermission = await navigator.permissions?.query({ name: 'clipboard-read' });
      clipboardPermission?.addEventListener('change', refreshClipboard);
    } catch { /* Browsers without this permission query can still read after a click. */ }
    refreshClipboard();
  }

  function applyContent(value) {
    if (content.maxLength >= 0 && value.length > content.maxLength) {
      throw new Error(t('二维码内容超过 {limit} 个字符，请使用内容更短的二维码。', { limit: content.maxLength }));
    }
    content.dispatchEvent(new CustomEvent('qrg:import-content', { detail: value }));
  }

  pasteButton.addEventListener('click', async () => {
    cancel();
    const token = sequence;
    pasteBusy = true;
    clipboardProbe += 1;
    refreshPasteButton();
    try {
      const data = await readClipboard(true);
      if (token !== sequence) return;
      clipboardState = data.hasImage || data.text.trim() ? 'ready' : 'empty';
      if (data.hasImage) importFiles(data.files);
      else if (data.text.trim()) applyContent(data.text);
      else announce(t('剪贴板中没有可粘贴的图片或文字。'), true);
    } catch (error) {
      if (token !== sequence) return;
      announce(error.name === 'Error' ? error.message
        : t('无法读取剪贴板，请允许浏览器访问，或在链接框使用粘贴快捷键。'), true);
    } finally {
      if (token === sequence) pasteBusy = false;
      refreshPasteButton();
    }
  });
  window.addEventListener('focus', refreshClipboard);
  document.addEventListener('visibilitychange', refreshClipboard);
  navigator.clipboard?.addEventListener('clipboardchange', refreshClipboard);
  pasteButton.addEventListener('pointerenter', refreshClipboard);
  pasteButton.addEventListener('focus', refreshClipboard);
  for (const event of ['copy', 'cut']) document.addEventListener(event, () => setTimeout(refreshClipboard, 0));

  function clearDrag() {
    dragDepth = 0;
    field.classList.remove('is-dragging');
  }

  function hasFiles(event) {
    return Array.from(event.dataTransfer?.types || []).includes('Files');
  }

  function refreshButton() {
    button.setAttribute('aria-busy', String(controller !== null));
    button.querySelector('span').textContent = controller ? t('识别中…') : t('上传二维码');
    button.title = t('请提供 PNG、JPEG 或 WebP 二维码图片');
    refreshPasteButton();
  }

  function announce(message = '', error = false) {
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('is-error', error);
  }

  function cancel() {
    clearDrag();
    sequence += 1;
    pasteBusy = false;
    controller?.abort();
    controller = null;
    reader?.abort();
    reader = null;
    announce();
    refreshButton();
  }

  button.addEventListener('click', () => fileInput.click());
  content.addEventListener('input', cancel);
  document.getElementById('undo').addEventListener('click', cancel);
  document.getElementById('redo').addEventListener('click', cancel);
  window.addEventListener('pagehide', cancel);
  document.addEventListener('qrg:languagechange', cancel);

  document.addEventListener('dragenter', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (document.querySelector('dialog[open]')) return;
    dragDepth += 1;
    field.classList.add('is-dragging');
  });
  document.addEventListener('dragover', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = document.querySelector('dialog[open]') ? 'none' : 'copy';
  });
  document.addEventListener('dragleave', event => {
    if (!dragDepth) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) clearDrag();
  });
  document.addEventListener('dragend', clearDrag);
  window.addEventListener('blur', clearDrag);
  document.addEventListener('drop', event => {
    clearDrag();
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (document.querySelector('dialog[open]')) return;
    importFiles(Array.from(event.dataTransfer.files));
  });
  document.addEventListener('paste', event => {
    if (document.querySelector('dialog[open]')) return;
    const editable = event.target.closest?.('input, textarea, [contenteditable]');
    if (editable && editable !== content) return;
    let images = Array.from(event.clipboardData?.items || [])
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile()).filter(Boolean);
    if (!images.length) images = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'));
    if (!images.length) return;
    event.preventDefault();
    importFiles(images);
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) importFiles([file]);
  });

  function importFiles(files) {
    if (!files.length) return;
    if (files.length > 1) {
      cancel();
      announce(t('请一次只导入一张二维码图片。'), true);
      return;
    }
    importFile(files[0]);
  }

  async function importFile(file) {
    cancel();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      announce(t('请选择 PNG、JPEG 或 WebP 图片。'), true);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      announce(t('二维码图片不能超过 2 MiB'), true);
      return;
    }

    const token = sequence;
    const activeController = new AbortController();
    controller = activeController;
    const timeout = setTimeout(() => {
      activeController.abort();
      reader?.abort();
    }, 15_000);
    refreshButton();
    announce(t('正在识别二维码…'));
    try {
      const image = await new Promise((resolve, reject) => {
        const activeReader = new FileReader();
        reader = activeReader;
        activeReader.onload = () => resolve(activeReader.result);
        activeReader.onerror = () => reject(new Error(t('无法读取二维码图片，请重试。')));
        activeReader.onabort = () => reject(new DOMException('', 'AbortError'));
        activeReader.readAsDataURL(file);
      });
      if (token !== sequence) return;
      reader = null;
      activeController.signal.throwIfAborted();
      const response = await fetch(window.QRGI18n.apiURL('/api/decode'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }), signal: activeController.signal,
      });
      const data = await response.json();
      if (token !== sequence) return;
      activeController.signal.throwIfAborted();
      if (!response.ok) throw new Error(data.error || t('无法读取二维码图片'));
      if (typeof data.content !== 'string' || !data.content.trim()) {
        throw new Error(t('未识别到二维码，请检查图片和颜色对比度'));
      }
      applyContent(data.content);
      announce();
    } catch (error) {
      if (token !== sequence) return;
      announce(error.name === 'AbortError' ? t('识别超时，请重试。')
        : error instanceof TypeError ? t('无法连接 QRG 服务，请检查服务是否正在运行。')
        : error instanceof SyntaxError ? t('无法读取二维码图片') : error.message, true);
    } finally {
      clearTimeout(timeout);
      if (token === sequence) {
        controller = null;
        reader = null;
        refreshButton();
      }
    }
  }

  refreshButton();
  if (clipboardSupported) watchClipboard();
})();
