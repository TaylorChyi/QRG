(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const controls = {
    content: $('content'), color: $('color'), background: $('background'), transparent: $('transparent'),
    module_shape: $('module-shape'), eye_shape: $('eye-shape'), margin: $('margin'),
    error_correction: $('error-correction'), version: $('version'), size: $('size'), crisp: $('crisp'),
    logo_scale: $('logo-scale'), logo_padding_px: $('logo-padding-px'),
  };
  const preview = $('preview-image');
  const placeholder = $('preview-placeholder');
  const stage = $('preview-stage');
  const status = $('status');
  const statusBox = status.parentElement;
  const details = $('qr-details');
  const pngButton = $('download-png');
  const svgButton = $('download-svg');
  const undoButton = $('undo');
  const redoButton = $('redo');
  const logoFile = $('logo-file');
  const tabs = [...document.querySelectorAll('[role="tab"][data-panel]')];
  const presetButtons = [...document.querySelectorAll('[data-preset]')];
  const presets = {
    classic: { color: '#000000', background: '#ffffff', transparent: false, module_shape: 'tile', eye_shape: 'rounded' },
    indigo: { color: '#4338ca', background: '#ffffff', transparent: false, module_shape: 'tile', eye_shape: 'rounded' },
    forest: { color: '#146c53', background: '#ffffff', transparent: false, module_shape: 'circle', eye_shape: 'rounded' },
    clay: { color: '#9a482f', background: '#fff8f0', transparent: false, module_shape: 'tile', eye_shape: 'rounded' },
  };
  const numberBounds = { margin: [0, 32], size: [64, 4096], logo_padding_px: [0, 128], logo_scale: [5, 25] };
  const initial = {
    content: 'https://example.com', color: '#000000', background: '#ffffff', transparent: false,
    module_shape: 'tile', eye_shape: 'rounded', margin: 4, error_correction: 'H', version: null,
    size: 1024, crisp: false, logo: null, logo_name: '', logo_crop: null, logo_scale: 0.19, logo_padding_px: 1,
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
  const invalidInputs = new Set();

  for (let v = 1; v <= 40; v += 1) {
    const option = document.createElement('option');
    option.value = String(v);
    option.textContent = `${v} · ${17 + 4 * v} × ${17 + 4 * v}`;
    controls.version.append(option);
  }

  function announce(message, kind = '') {
    status.textContent = message;
    statusBox.className = `preview-meta${kind ? ` is-${kind}` : ''}`;
  }

  function refreshButtons() {
    undoButton.disabled = past.length === 0;
    redoButton.disabled = future.length === 0;
    const canExport = readyBlob !== null && readyRevision === revision && !busyExport && invalidInputs.size === 0;
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
    if (!invalidInputs.has('margin')) controls.margin.value = String(settings.margin);
    controls.error_correction.value = settings.error_correction;
    controls.version.value = settings.version === null ? 'auto' : String(settings.version);
    if (!invalidInputs.has('size')) controls.size.value = String(settings.size);
    controls.crisp.checked = settings.crisp;
    if (!invalidInputs.has('logo_scale')) controls.logo_scale.value = String(Math.round(settings.logo_scale * 100));
    if (!invalidInputs.has('logo_padding_px')) controls.logo_padding_px.value = String(settings.logo_padding_px);
    for (const key of Object.keys(numberBounds)) controls[key].setAttribute('aria-invalid', invalidInputs.has(key) ? 'true' : 'false');
    controls.logo_scale.disabled = !settings.logo;
    controls.logo_padding_px.disabled = !settings.logo;
    $('color-value').textContent = settings.color.toUpperCase();
    $('background-value').textContent = settings.background.toUpperCase();
    $('logo-scale-value').textContent = `${Math.round(settings.logo_scale * 100)}%`;
    $('logo-name').textContent = settings.logo_name || '未选择图片';
    $('content-count').textContent = `${settings.content.length} / 4096`;
    $('preview-size').textContent = `${settings.size} × ${settings.size} px`;
    for (const button of presetButtons) {
      const preset = presets[button.dataset.preset];
      const selected = preset && Object.entries(preset).every(([key, value]) => settings[key] === value);
      button.classList.toggle('is-selected', Boolean(selected));
      button.setAttribute('aria-pressed', String(Boolean(selected)));
    }
    $('remove-logo').hidden = !settings.logo;
    $('edit-logo-crop').hidden = !settings.logo;
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
      } else {
        thumb.textContent = '＋';
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
      placeholder.lastElementChild.textContent = '输入链接或文字后自动生成';
      details.textContent = '';
      announce('输入链接或文字后会自动生成预览。');
      return;
    }
    if (invalidInputs.size) {
      stage.classList.remove('is-loading');
      announce('请修正超出范围的数值。', 'error');
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
    invalidInputs.clear();
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
      logo: settings.logo, logo_scale: settings.logo_scale,
      logo_crop: settings.logo_crop, logo_padding_px: settings.logo_padding_px, format,
    };
  }

  async function requestImage(format, signal) {
    const response = await fetch('/api/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload(format)), signal,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || `生成失败（HTTP ${response.status}）`);
    }
    return { blob: await response.blob(), version: response.headers.get('X-QRG-Version'), modules: response.headers.get('X-QRG-Modules') };
  }

  async function render(targetRevision) {
    if (targetRevision !== revision) return;
    controller = new AbortController();
    try {
      const result = await requestImage('png', controller.signal);
      if (targetRevision !== revision) return;
      const nextUrl = URL.createObjectURL(result.blob);
      const previousUrl = imageUrl;
      imageUrl = nextUrl;
      preview.src = nextUrl;
      preview.hidden = false;
      placeholder.hidden = true;
      stage.classList.remove('is-loading');
      readyBlob = result.blob;
      readyRevision = targetRevision;
      details.textContent = result.version && result.modules ? `版本 ${result.version} · ${result.modules} × ${result.modules} 码点 · ${settings.size} × ${settings.size} px` : `${settings.size} × ${settings.size} px`;
      announce(settings.transparent ? '预览已就绪 · 透明背景' : '预览已就绪', 'ready');
      refreshButtons();
      if (previousUrl) URL.revokeObjectURL(previousUrl);
    } catch (error) {
      if (targetRevision !== revision || error.name === 'AbortError') return;
      stage.classList.remove('is-loading');
      preview.hidden = true;
      placeholder.hidden = false;
      placeholder.lastElementChild.textContent = '预览生成失败';
      details.textContent = '';
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
      announce('SVG 已导出。请在目标设备上扫码确认。', 'ready');
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
      if (key in numberBounds) {
        const [min, max] = numberBounds[key];
        const value = Number(control.value);
        if (control.value === '' || !Number.isInteger(value) || value < min || value > max) {
          invalidInputs.add(key);
          control.setAttribute('aria-invalid', 'true');
          invalidate();
          return;
        }
        const wasInvalid = invalidInputs.delete(key);
        const nextValue = key === 'logo_scale' ? value / 100 : value;
        const changed = settings[key] !== nextValue;
        update(key, nextValue, key === 'logo_scale' || key === 'size');
        if (wasInvalid && !changed) invalidate();
        return;
      }
      const value = control.type === 'checkbox' ? control.checked : control.value;
      update(key, key === 'version' ? value === 'auto' ? null : Number(value) : value,
        key === 'content' || key === 'color' || key === 'background');
    });
    if (key in numberBounds) control.addEventListener('blur', () => {
      if (invalidInputs.has(key)) {
        invalidInputs.delete(key);
        control.setAttribute('aria-invalid', 'false');
        control.value = key === 'logo_scale' ? String(Math.round(settings.logo_scale * 100)) : String(settings[key]);
        window.QRGControls?.sync();
        invalidate();
      }
    });
  }

  function activateTab(tab, focus = false) {
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      const panel = $(item.dataset.panel);
      if (panel) panel.hidden = !active;
    }
    if (focus) tab.focus();
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', (event) => {
      const index = tabs.indexOf(tab);
      let next;
      if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
      else if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
      else if (event.key === 'Home') next = tabs[0];
      else if (event.key === 'End') next = tabs[tabs.length - 1];
      else return;
      event.preventDefault();
      activateTab(next, true);
    });
  }

  for (const button of presetButtons) {
    button.addEventListener('click', () => {
      const preset = presets[button.dataset.preset];
      if (!preset || Object.entries(preset).every(([key, value]) => settings[key] === value)) return;
      past.push({ ...settings });
      if (past.length > 40) past.shift();
      future = [];
      lastEdit = { key: null, time: 0 };
      settings = { ...settings, ...preset };
      syncControls();
      invalidate();
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
    invalidInputs.delete('logo_scale');
    invalidInputs.delete('logo_padding_px');
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
    invalidInputs.delete('logo_scale');
    invalidInputs.delete('logo_padding_px');
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
      announce('PNG 已导出。请在目标设备上扫码确认。', 'ready');
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
