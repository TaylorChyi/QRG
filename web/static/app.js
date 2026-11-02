(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const controls = {
    content: $('content'), color: $('color'), background: $('background'), transparent: $('transparent'),
    module_shape: $('module-shape'), eye_shape: $('eye-shape'), margin: $('margin'),
    error_correction: $('error-correction'), version: $('version'), size: $('size'), crisp: $('crisp'),
    logo_modules: $('logo-modules'), logo_padding_modules: $('logo-padding-modules'),
  };
  const preview = $('preview-image');
  const placeholder = $('preview-placeholder');
  const stage = $('preview-stage');
  const status = $('status');
  const pngButton = $('download-png');
  const svgButton = $('download-svg');
  const undoButton = $('undo');
  const redoButton = $('redo');
  const logoFile = $('logo-file');
  const numericSettings = new Set(['margin', 'size', 'logo_modules', 'logo_padding_modules']);
  const initial = {
    content: 'https://example.com', color: '#000000', background: '#ffffff', transparent: false,
    module_shape: 'tile', eye_shape: 'rounded', margin: 4, error_correction: 'H', version: null,
    size: 1024, crisp: false, logo: null, logo_name: '', logo_crop: null, logo_modules: 5, logo_padding_modules: 1,
  };

  let settings = { ...initial };
  let past = [];
  let future = [];
  let lastEdit = { key: null, time: 0 };
  let revision = 0;
  let renderTimer = null;
  let controller = null;
  let exportController = null;
  let imageUrl = null;
  let readyBlob = null;
  let readyRevision = -1;
  let busyExport = false;
  let displayedLogo = null;
  let displayedCrop = null;
  let logoReadToken = 0;
  let logoOptions = null;

  function adoptLogoOptions(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return false;
    logoOptions = options;
    const sizes = Object.keys(options).map(Number).sort((a, b) => a - b);
    if (!sizes.length) return false;
    const side = options[settings.logo_modules]?.length ? settings.logo_modules
      : sizes.filter(value => value <= settings.logo_modules).at(-1) ?? sizes[0];
    const paddings = options[side];
    const padding = paddings.includes(settings.logo_padding_modules) ? settings.logo_padding_modules
      : paddings.filter(value => value <= settings.logo_padding_modules).at(-1) ?? paddings[0];
    if (side === settings.logo_modules && padding === settings.logo_padding_modules) return false;
    settings = { ...settings, logo_modules: side, logo_padding_modules: padding };
    return true;
  }

  function syncOptions(control, values, value, label) {
    const entries = [...new Set([...values, value])].sort((a, b) => a - b);
    if (entries.join(',') !== [...control.options].map(option => option.value).join(',')) {
      window.QRGControls?.close();
      control.replaceChildren(...entries.map(number => new Option(label(number), String(number))));
    }
    control.value = String(value);
  }

  function announce(message = '', kind = '') {
    status.textContent = message;
    status.className = kind === 'error' ? 'preview-error' : 'visually-hidden';
  }

  function refreshButtons() {
    undoButton.disabled = past.length === 0;
    redoButton.disabled = future.length === 0;
    const canExport = readyBlob !== null && readyRevision === revision && !busyExport;
    pngButton.disabled = !canExport;
    svgButton.disabled = !canExport;
  }

  function syncControls() {
    if (controls.content.value !== settings.content) controls.content.value = settings.content;
    controls.color.value = settings.color;
    controls.background.value = settings.background;
    controls.transparent.checked = settings.transparent;
    controls.background.disabled = settings.transparent;
    controls.module_shape.value = settings.module_shape;
    controls.eye_shape.value = settings.eye_shape;
    controls.margin.value = String(settings.margin);
    controls.error_correction.value = settings.error_correction;
    controls.version.value = settings.version === null ? 'auto' : String(settings.version);
    controls.size.value = String(settings.size);
    controls.crisp.checked = settings.crisp;
    syncOptions(controls.logo_modules, Object.keys(logoOptions || {}).map(Number), settings.logo_modules, value => `${value} × ${value} 格`);
    syncOptions(controls.logo_padding_modules, logoOptions?.[settings.logo_modules] || [0, 1, 2], settings.logo_padding_modules, String);
    const logoUnavailable = !settings.logo || logoOptions !== null && Object.keys(logoOptions).length === 0;
    controls.logo_modules.disabled = logoUnavailable;
    controls.logo_padding_modules.disabled = logoUnavailable;
    $('logo-options').hidden = !settings.logo;
    $('color-value').textContent = settings.color.toUpperCase();
    $('background-value').textContent = settings.background.toUpperCase();
    $('logo-name').textContent = settings.logo_name || '选择图片';
    $('logo-thumb').hidden = !settings.logo;
    $('logo-placeholder').hidden = Boolean(settings.logo);
    $('content-count').textContent = `${settings.content.length} / 4096`;
    $('remove-logo').hidden = !settings.logo;
    $('edit-logo-crop').hidden = !settings.logo;
    $('remove-logo').parentElement.hidden = !settings.logo;
    if (settings.logo !== displayedLogo || settings.logo_crop !== displayedCrop) {
      const thumb = $('logo-thumb');
      thumb.replaceChildren();
      if (settings.logo) {
        const image = document.createElement('img');
        const source = settings.logo;
        const crop = settings.logo_crop;
        image.alt = '';
        image.onload = () => {
          if (settings.logo !== source || settings.logo_crop !== crop) return;
          const box = crop || { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
          const canvas = document.createElement('canvas');
          const scale = 112 / Math.max(box.width, box.height);
          canvas.width = Math.max(1, Math.round(box.width * scale));
          canvas.height = Math.max(1, Math.round(box.height * scale));
          canvas.getContext('2d').drawImage(image, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height);
          thumb.replaceChildren(canvas);
        };
        image.src = source;
      }
      displayedLogo = settings.logo;
      displayedCrop = settings.logo_crop;
    }
    refreshButtons();
    window.QRGControls?.sync();
  }

  function invalidate() {
    revision += 1;
    readyBlob = null;
    readyRevision = -1;
    clearTimeout(renderTimer);
    controller?.abort();
    exportController?.abort();
    stage.classList.add('is-loading');
    refreshButtons();
    if (!settings.content.trim()) {
      stage.classList.remove('is-loading');
      preview.hidden = true;
      placeholder.hidden = false;
      placeholder.lastElementChild.textContent = '输入链接后自动生成';
      announce();
      return;
    }
    announce('正在更新预览…');
    const targetRevision = revision;
    renderTimer = setTimeout(() => render(targetRevision), 320);
  }

  function update(key, value, coalesce = false) {
    if (settings[key] === value) return;
    const now = Date.now();
    if (!(coalesce && lastEdit.key === key && now - lastEdit.time < 650 && future.length === 0)) {
      past.push({ ...settings });
      if (past.length > 40) past.shift();
    }
    future = [];
    lastEdit = { key: coalesce ? key : null, time: now };
    settings = { ...settings, [key]: value };
    if (key === 'logo_modules') adoptLogoOptions(logoOptions);
    syncControls();
    invalidate();
  }

  function travel(from, to) {
    if (!from.length) return;
    logoReadToken += 1;
    window.QRGLogoCrop.close();
    to.push({ ...settings });
    if (to.length > 40) to.shift();
    settings = from.pop();
    lastEdit = { key: null, time: 0 };
    syncControls();
    invalidate();
  }

  function payload(format) {
    return {
      content: settings.content, color: settings.color,
      background: settings.transparent ? 'transparent' : settings.background,
      module_shape: settings.module_shape, eye_shape: settings.eye_shape,
      margin: settings.margin, error_correction: settings.error_correction,
      version: settings.version, size: settings.size, crisp: settings.crisp,
      logo: settings.logo, logo_modules: settings.logo_modules,
      logo_crop: settings.logo_crop, logo_padding_modules: settings.logo_padding_modules, format,
    };
  }

  async function requestImage(format, signal) {
    const response = await fetch('/api/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload(format)), signal,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const error = new Error(data?.error || `生成失败（HTTP ${response.status}）`);
      error.logoOptions = data?.logo_options;
      throw error;
    }
    return { blob: await response.blob(),
      logoOptions: JSON.parse(response.headers.get('X-QRG-Logo-Options') || 'null') };
  }

  async function render(targetRevision) {
    if (targetRevision !== revision) return;
    controller = new AbortController();
    try {
      const result = await requestImage('png', controller.signal);
      if (targetRevision !== revision) return;
      if (adoptLogoOptions(result.logoOptions)) { syncControls(); invalidate(); return; }
      syncControls();
      const nextUrl = URL.createObjectURL(result.blob);
      const previousUrl = imageUrl;
      imageUrl = nextUrl;
      preview.src = nextUrl;
      preview.hidden = false;
      placeholder.hidden = true;
      stage.classList.remove('is-loading');
      readyBlob = result.blob;
      readyRevision = targetRevision;
      announce();
      refreshButtons();
      if (previousUrl) URL.revokeObjectURL(previousUrl);
    } catch (error) {
      if (targetRevision !== revision || error.name === 'AbortError') return;
      if (adoptLogoOptions(error.logoOptions)) { syncControls(); invalidate(); return; }
      syncControls();
      stage.classList.remove('is-loading');
      preview.hidden = true;
      placeholder.hidden = false;
      placeholder.lastElementChild.textContent = '预览生成失败';
      announce(error instanceof TypeError ? '无法连接 QRG 服务，请检查服务是否正在运行。' : error.message, 'error');
      refreshButtons();
    }
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function exportSvg() {
    if (svgButton.disabled) return;
    const targetRevision = revision;
    busyExport = true;
    refreshButtons();
    announce('正在导出 SVG…');
    exportController = new AbortController();
    try {
      const result = await requestImage('svg', exportController.signal);
      if (targetRevision !== revision) return;
      download(result.blob, '二维码.svg');
      announce('SVG 已导出');
    } catch (error) {
      if (targetRevision !== revision || error.name === 'AbortError') return;
      announce(error instanceof TypeError ? '无法连接 QRG 服务，请检查服务是否正在运行。' : error.message, 'error');
    } finally {
      busyExport = false;
      refreshButtons();
    }
  }

  for (const [key, control] of Object.entries(controls)) {
    const event = control.tagName === 'SELECT' || control.type === 'checkbox' ? 'change' : 'input';
    control.addEventListener(event, () => {
      const value = control.type === 'checkbox' ? control.checked : control.value;
      update(key, numericSettings.has(key) ? Number(value)
        : key === 'version' ? value === 'auto' ? null : Number(value) : value,
        key === 'content' || key === 'color' || key === 'background');
    });
  }

  logoFile.addEventListener('change', async () => {
    const file = logoFile.files?.[0];
    logoFile.value = '';
    if (!file) return;
    window.QRGLogoCrop.close();
    const readToken = ++logoReadToken;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      announce('请选择 PNG、JPEG 或 WebP 图片。', 'error');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      announce('Logo 图片不能超过 2 MiB。', 'error');
      return;
    }
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      if (readToken !== logoReadToken) return;
      if (typeof data !== 'string') throw new Error('无法读取图片。');
      await window.QRGLogoCrop.open({ source: data, name: file.name, onApply: applyLogo });
    } catch (error) {
      if (readToken === logoReadToken) announce(error.message || '无法读取 Logo 图片。', 'error');
    }
  });

  function applyLogo(values) {
    if (settings.logo === values.logo && JSON.stringify(settings.logo_crop) === JSON.stringify(values.logo_crop)) return;
    past.push({ ...settings });
    if (past.length > 40) past.shift();
    future = [];
    lastEdit = { key: null, time: 0 };
    settings = { ...settings, ...values };
    syncControls();
    invalidate();
  }

  $('edit-logo-crop').addEventListener('click', async () => {
    if (!settings.logo) return;
    try {
      await window.QRGLogoCrop.open({ source: settings.logo, name: settings.logo_name, crop: settings.logo_crop, onApply: applyLogo });
    } catch { announce('无法读取 Logo 图片。', 'error'); }
  });
  $('remove-logo').addEventListener('click', () => {
    if (!settings.logo) return;
    logoReadToken += 1;
    window.QRGLogoCrop.close();
    past.push({ ...settings });
    if (past.length > 40) past.shift();
    future = [];
    lastEdit = { key: null, time: 0 };
    settings = { ...settings, logo: null, logo_name: '', logo_crop: null };
    syncControls();
    invalidate();
  });
  undoButton.addEventListener('click', () => travel(past, future));
  redoButton.addEventListener('click', () => travel(future, past));
  $('editor-form').addEventListener('submit', (event) => event.preventDefault());
  pngButton.addEventListener('click', () => {
    if (!pngButton.disabled && readyBlob && readyRevision === revision) {
      download(readyBlob, '二维码.png');
      announce('PNG 已导出');
    }
  });
  svgButton.addEventListener('click', exportSvg);
  $('theme').addEventListener('change', (event) => {
    const theme = event.target.value;
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = theme;
  });

  const viewButtons = [...document.querySelectorAll('.workspace-views [data-view]')];
  for (const button of viewButtons) {
    button.addEventListener('click', () => {
      document.querySelector('.workspace').dataset.view = button.dataset.view;
      for (const item of viewButtons) item.setAttribute('aria-pressed', String(item === button));
    });
  }

  window.QRGControls?.init();
  syncControls();
  invalidate();
  window.addEventListener('pagehide', () => {
    logoReadToken += 1;
    window.QRGLogoCrop.close();
    clearTimeout(renderTimer);
    controller?.abort();
    exportController?.abort();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = null;
    preview.removeAttribute('src');
    preview.hidden = true;
    placeholder.hidden = false;
    readyBlob = null;
    readyRevision = -1;
    busyExport = false;
    refreshButtons();
  });
  window.addEventListener('pageshow', (event) => { if (event.persisted) invalidate(); });
})();
