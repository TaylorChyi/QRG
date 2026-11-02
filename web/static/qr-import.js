(() => {
  'use strict';

  const content = document.getElementById('content');
  const button = document.getElementById('import-qr');
  const fileInput = document.getElementById('qr-file');
  const status = document.getElementById('qr-import-status');
  const field = content.closest('.content-field');
  const t = (...args) => window.QRGI18n.t(...args);
  let controller = null;
  let reader = null;
  let sequence = 0;
  let dragDepth = 0;

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
  }

  function announce(message = '', error = false) {
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('is-error', error);
  }

  function cancel() {
    clearDrag();
    sequence += 1;
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
      if (content.maxLength >= 0 && data.content.length > content.maxLength) {
        throw new Error(t('二维码内容超过 {limit} 个字符，请使用内容更短的二维码。', { limit: content.maxLength }));
      }
      content.dispatchEvent(new CustomEvent('qrg:import-content', { detail: data.content }));
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
})();
