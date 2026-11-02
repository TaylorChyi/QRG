(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const dialog = $('logo-crop-dialog');
  const canvas = $('logo-crop-canvas');
  const context = canvas.getContext('2d');
  const apply = $('apply-logo-crop');
  const fields = Object.fromEntries(['top', 'bottom', 'left', 'right'].map(key => [key, $(`crop-${key}`)]));
  let draft = null;
  let drag = null;
  let token = 0;
  let returnFocus = null;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function paint() {
    if (!draft) return;
    const { image, crop } = draft;
    const sx = canvas.width / image.naturalWidth;
    const sy = canvas.height / image.naturalHeight;
    const x = crop.x * sx, y = crop.y * sy, w = crop.width * sx, h = crop.height * sy;
    const theme = getComputedStyle(dialog);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.fillStyle = theme.getPropertyValue('--crop-scrim').trim();
    context.fillRect(0, 0, canvas.width, y);
    context.fillRect(0, y + h, canvas.width, canvas.height - y - h);
    context.fillRect(0, y, x, h);
    context.fillRect(x + w, y, canvas.width - x - w, h);
    const unit = canvas.width / (canvas.getBoundingClientRect().width || canvas.width);
    context.strokeStyle = theme.getPropertyValue('--accent').trim();
    context.lineWidth = 2 * unit;
    context.strokeRect(x, y, w, h);
    context.fillStyle = theme.getPropertyValue('--raised').trim();
    for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      context.fillRect(hx - 4 * unit, hy - 4 * unit, 8 * unit, 8 * unit);
      context.strokeRect(hx - 4 * unit, hy - 4 * unit, 8 * unit, 8 * unit);
    }
  }

  function cropInsets() {
    const { image, crop } = draft;
    return { top: crop.y, bottom: image.naturalHeight - crop.y - crop.height,
      left: crop.x, right: image.naturalWidth - crop.x - crop.width };
  }

  function sync() {
    if (!draft) return;
    const { image, crop } = draft;
    const insets = cropInsets();
    const bounds = { top: image.naturalHeight - insets.bottom - 1, bottom: image.naturalHeight - insets.top - 1,
      left: image.naturalWidth - insets.right - 1, right: image.naturalWidth - insets.left - 1 };
    for (const [key, field] of Object.entries(fields)) {
      field.value = String(insets[key]);
      field.max = String(bounds[key]);
      field.setAttribute('aria-invalid', 'false');
    }
    apply.disabled = false;
    $('crop-selection-size').textContent = `选区 ${crop.width} × ${crop.height} 像素`;
    window.QRGControls?.sync();
    paint();
  }

  function close() {
    token += 1;
    if (dialog.open) dialog.close();
    draft = null;
    drag = null;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  async function open(options) {
    close();
    const current = ++token;
    const image = new Image();
    image.src = options.source;
    await image.decode();
    if (current !== token) return;
    if (Math.max(image.naturalWidth, image.naturalHeight) > 4096) throw new Error('Logo 图片宽高不能超过 4096 像素。');
    const scale = 1120 / Math.max(image.naturalWidth, image.naturalHeight);
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    draft = { ...options, image, crop: options.crop ? { ...options.crop }
      : { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight } };
    returnFocus = document.activeElement;
    window.QRGControls?.close();
    dialog.showModal();
    sync();
    canvas.focus();
  }

  for (const [key, field] of Object.entries(fields)) {
    field.addEventListener('input', () => {
      if (!draft) return;
      const value = Number(field.value);
      if (field.value === '' || !Number.isInteger(value) || value < Number(field.min) || value > Number(field.max)) {
        field.setAttribute('aria-invalid', 'true');
        apply.disabled = true;
        return;
      }
      const insets = { ...cropInsets(), [key]: value };
      draft.crop = { x: insets.left, y: insets.top,
        width: draft.image.naturalWidth - insets.left - insets.right,
        height: draft.image.naturalHeight - insets.top - insets.bottom };
      sync();
    });
    field.addEventListener('blur', () => {
      if (field.getAttribute('aria-invalid') === 'true') sync();
    });
  }

  function position(event) {
    const box = canvas.getBoundingClientRect();
    return {
      x: clamp(Math.round((event.clientX - box.left) / box.width * draft.image.naturalWidth), 0, draft.image.naturalWidth),
      y: clamp(Math.round((event.clientY - box.top) / box.height * draft.image.naturalHeight), 0, draft.image.naturalHeight),
    };
  }

  canvas.addEventListener('pointerdown', event => {
    if (!draft || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    canvas.focus();
    const point = position(event);
    const { crop, image } = draft;
    const box = canvas.getBoundingClientRect();
    const near = (a, b, scale) => Math.abs(a - b) * scale < 12;
    const corners = [
      [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height],
      [crop.x + crop.width, crop.y, crop.x, crop.y + crop.height],
      [crop.x, crop.y + crop.height, crop.x + crop.width, crop.y],
      [crop.x + crop.width, crop.y + crop.height, crop.x, crop.y],
    ];
    const corner = corners.find(([x, y]) => near(point.x, x, box.width / image.naturalWidth) && near(point.y, y, box.height / image.naturalHeight));
    const full = crop.width === image.naturalWidth && crop.height === image.naturalHeight;
    const inside = point.x > crop.x && point.x < crop.x + crop.width && point.y > crop.y && point.y < crop.y + crop.height;
    drag = { pointerId: event.pointerId, start: point, crop: { ...crop }, mode: corner ? 'resize' : inside && !full ? 'move' : 'draw',
      anchor: corner ? { x: corner[2], y: corner[3] } : point };
    canvas.setPointerCapture(event.pointerId);
  });

  function move(event) {
    if (!draft || !drag || drag.pointerId !== event.pointerId) return;
    const point = position(event);
    const { image } = draft;
    if (drag.mode === 'move') {
      draft.crop = { ...drag.crop,
        x: clamp(drag.crop.x + point.x - drag.start.x, 0, image.naturalWidth - drag.crop.width),
        y: clamp(drag.crop.y + point.y - drag.start.y, 0, image.naturalHeight - drag.crop.height) };
    } else {
      const left = Math.min(drag.anchor.x, point.x), top = Math.min(drag.anchor.y, point.y);
      draft.crop = { x: Math.min(left, image.naturalWidth - 1), y: Math.min(top, image.naturalHeight - 1),
        width: Math.max(1, Math.abs(point.x - drag.anchor.x)), height: Math.max(1, Math.abs(point.y - drag.anchor.y)) };
    }
    sync();
  }
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', event => {
    move(event);
    if (drag?.pointerId === event.pointerId) drag = null;
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('lostpointercapture', () => { drag = null; });
  canvas.addEventListener('keydown', event => {
    if (!draft) return;
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const { crop, image } = draft;
    crop.x = clamp(crop.x + direction[0] * step, 0, image.naturalWidth - crop.width);
    crop.y = clamp(crop.y + direction[1] * step, 0, image.naturalHeight - crop.height);
    sync();
  });

  $('reset-logo-crop').addEventListener('click', () => {
    if (!draft) return;
    draft.crop = { x: 0, y: 0, width: draft.image.naturalWidth, height: draft.image.naturalHeight };
    sync();
  });
  $('cancel-logo-crop').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  apply.addEventListener('click', () => {
    if (!draft || apply.disabled) return;
    const { source, name, crop, onApply } = draft;
    close();
    onApply({ logo: source, logo_name: name, logo_crop: { ...crop } });
  });
  window.addEventListener('resize', paint);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);
  window.QRGLogoCrop = { open, close };
})();
