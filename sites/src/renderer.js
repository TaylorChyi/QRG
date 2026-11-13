import QRCode from 'qrcode';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_CONTENT_BYTES = 8192;
const ROUNDED_CORNER_RADIUS = 1.5;

class RenderError extends Error {
  constructor(message, details = {}) {
    super(message);
    Object.assign(this, details);
  }
}

function integer(data, key, fallback, low, high, t, nullable = false) {
  const value = data[key] === undefined ? fallback : data[key];
  if (nullable && value === null) return null;
  if (!Number.isInteger(value) || value < low || value > high) {
    throw new RenderError(t('{key} 必须为 {low}–{high} 之间的整数', { key, low, high }));
  }
  return value;
}

function choice(data, key, fallback, options, t) {
  const value = data[key] === undefined ? fallback : data[key];
  if (!options.includes(value)) throw new RenderError(t('{key} 的选项无效', { key }));
  return value;
}

function colour(value, t) {
  if (value === 'transparent') return { fill: '#000000', opacity: 0 };
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) return { fill: value, opacity: 1 };
  if (typeof value === 'string' && /^#[0-9a-fA-F]{8}$/.test(value)) {
    return { fill: value.slice(0, 7), opacity: parseInt(value.slice(7), 16) / 255 };
  }
  throw new RenderError(t('请输入有效颜色'));
}

function boxesIntersect(a, b) {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

export function patternPositions(version) {
  if (version === 1) return [];
  const n = 17 + 4 * version;
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((n - 13) / (count - 1) / 2) * 2;
  const positions = [6];
  for (let position = n - 7; positions.length < count; position -= step) positions.splice(1, 0, position);
  return positions;
}

export function logoClearance(clearance, version, modules, padding, t = source => source) {
  const box = [Math.floor(clearance[0] - padding), Math.floor(clearance[1] - padding),
    Math.ceil(clearance[2] + padding), Math.ceil(clearance[3] + padding)];
  const patterns = [[0, 0, 7, 7], [modules - 7, 0, modules, 7], [0, modules - 7, 7, modules]];
  for (const cy of patternPositions(version)) for (const cx of patternPositions(version)) {
    if ((cx <= 8 && cy <= 8) || (cx >= modules - 9 && cy <= 8) || (cx <= 8 && cy >= modules - 9)) continue;
    patterns.push([cx - 2, cy - 2, cx + 3, cy + 3]);
  }
  if (patterns.some(pattern => boxesIntersect(box, pattern))) {
    throw new RenderError(t('Logo 留白与二维码的定位结构重叠；请减小 Logo 或更换版本'));
  }
  return box;
}

export function logoOptions(version, modules, t = source => source) {
  const result = {};
  const sides = [...new Set([2, 3, 5, 7, 9, 11, 15, Math.floor(modules / 4)])].sort((a, b) => a - b);
  for (const side of sides) {
    if (side < 1 || side > Math.floor(modules / 4)) continue;
    const start = Math.floor((modules - side) / 2);
    const clearance = [start, start, start + side, start + side];
    const allowed = [0, 1, 2].filter(padding => {
      try { logoClearance(clearance, version, modules, padding, t); return true; }
      catch { return false; }
    });
    if (allowed.length) result[side] = allowed;
  }
  return result;
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Invalid image')); };
    image.src = url;
  });
}

async function prepareLogo(value, crop, t) {
  if (value === null || value === undefined) {
    if (crop !== null && crop !== undefined) throw new RenderError(t('请先上传 Logo 再选择裁剪范围'));
    return null;
  }
  if (typeof value !== 'string') throw new RenderError(t('Logo 必须为 PNG、JPEG 或 WebP 图片'));
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new RenderError(t('Logo 仅支持 PNG、JPEG 和 WebP'));
  if (match[2].length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3)) throw new RenderError(t('Logo 文件不能超过 2 MiB'));
  let binary;
  try { binary = atob(match[2]); } catch { throw new RenderError(t('Logo 图片数据无效')); }
  if (binary.length > MAX_IMAGE_BYTES) throw new RenderError(t('Logo 文件不能超过 2 MiB'));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  let image;
  try { image = await loadImage(new Blob([bytes], { type: `image/${match[1]}` })); }
  catch { throw new RenderError(t('无法读取 Logo，请使用有效的 PNG、JPEG 或 WebP 图片')); }
  if (image.naturalWidth > 4096 || image.naturalHeight > 4096) {
    throw new RenderError(t('Logo 图片宽高不能超过 4096 像素'));
  }
  let region = { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
  if (crop !== null && crop !== undefined) {
    if (!crop || typeof crop !== 'object' || Array.isArray(crop) ||
      Object.keys(crop).sort().join(',') !== 'height,width,x,y' ||
      !['x', 'y', 'width', 'height'].every(key => Number.isInteger(crop[key]))) {
      throw new RenderError(t('Logo 裁剪范围无效'));
    }
    if (crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 ||
      crop.x + crop.width > image.naturalWidth || crop.y + crop.height > image.naturalHeight) {
      throw new RenderError(t('Logo 裁剪范围超出图片边界'));
    }
    region = crop;
  }
  return { image, region };
}

function svgRect(x, y, width, height, radius, colourValue) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${colourValue.fill}" fill-opacity="${colourValue.opacity}"/>`;
}

function svgFromMatrix(qr, settings, logoData, t) {
  const n = qr.modules.size;
  const total = n + 2 * settings.margin;
  const fg = settings.color;
  const bg = settings.background;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${settings.size}" height="${settings.size}" viewBox="0 0 ${total} ${total}">`];
  if (settings.imageShape === 'rounded') parts.push(`<clipPath id="image-corners"><rect width="${total}" height="${total}" rx="${ROUNDED_CORNER_RADIUS}"/></clipPath><g clip-path="url(#image-corners)">`);
  parts.push(svgRect(0, 0, total, total, 0, bg));
  const rect = (x, y, width, height, radius, colourValue) => svgRect(x + settings.margin, y + settings.margin, width, height, radius, colourValue);
  const eyes = [[0, 0], [n - 7, 0], [0, n - 7]];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!qr.modules.get(y, x) || eyes.some(([ex, ey]) => ex <= x && x < ex + 7 && ey <= y && y < ey + 7)) continue;
    if (logoData?.clearance && x >= logoData.clearance[0] && x < logoData.clearance[2] &&
      y >= logoData.clearance[1] && y < logoData.clearance[3]) continue;
    const inset = settings.moduleShape === 'tile' ? .12 : 0;
    const radius = { square: 0, tile: .16, circle: .5 }[settings.moduleShape];
    parts.push(rect(x + inset, y + inset, 1 - 2 * inset, 1 - 2 * inset, radius, fg));
  }
  eyes.forEach(([x, y], index) => {
    const radius = settings.eyeShape === 'rounded' ? ROUNDED_CORNER_RADIUS : 0;
    const outer = rect(x, y, 7, 7, radius, fg);
    const centre = rect(x + 2, y + 2, 3, 3, radius ? .6 : 0, fg);
    parts.push(`<mask id="eye${index}"><rect width="${total}" height="${total}" fill="white"/><rect x="${x + 1 + settings.margin}" y="${y + 1 + settings.margin}" width="5" height="5" rx="${radius ? .8 : 0}" fill="black"/></mask><g mask="url(#eye${index})">${outer}</g>${centre}`);
  });
  if (logoData) parts.push(`<image x="${logoData.x + settings.margin}" y="${logoData.y + settings.margin}" width="${logoData.width}" height="${logoData.height}" href="${logoData.url}"/>`);
  if (settings.imageShape === 'rounded') parts.push('</g>');
  parts.push('</svg>');
  return parts.join('\n');
}

async function logoGeometry(logo, qr, settings, t) {
  if (!logo) return null;
  const n = qr.modules.size;
  const side = settings.logoModules ?? n * settings.logoScale;
  const ratio = side / Math.max(logo.region.width, logo.region.height);
  const width = logo.region.width * ratio;
  const height = logo.region.height * ratio;
  const start = settings.logoModules === null ? (n - side) / 2 : Math.floor((n - side) / 2);
  const x = start + (side - width) / 2;
  const y = start + (side - height) / 2;
  const clearanceRegion = settings.logoModules === null ? [x, y, x + width, y + height] : [start, start, start + side, start + side];
  const padding = settings.logoPaddingModules ?? (settings.logoPaddingPx === null ? 1.25 : settings.logoPaddingPx / (settings.size / (n + 2 * settings.margin)));
  const clearance = logoClearance(clearanceRegion, qr.version, n, padding, t);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(logo.region.width * ratio * settings.size / (n + 2 * settings.margin)));
  canvas.height = Math.max(1, Math.round(logo.region.height * ratio * settings.size / (n + 2 * settings.margin)));
  canvas.getContext('2d').drawImage(logo.image, logo.region.x, logo.region.y, logo.region.width,
    logo.region.height, 0, 0, canvas.width, canvas.height);
  return { x, y, width, height, clearance, url: canvas.toDataURL('image/png') };
}

function settingsFrom(data, t) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new RenderError(t('请求必须为 JSON 对象'));
  if (typeof data.content !== 'string' || !data.content) throw new RenderError(t('请输入链接'));
  if (new TextEncoder().encode(data.content).length > MAX_CONTENT_BYTES) {
    throw new RenderError(t('内容不能超过 8192 个 UTF-8 字节；二维码容量还取决于容错等级'));
  }
  const settings = {
    content: data.content,
    color: colour(data.color ?? '#000000', t), background: colour(data.background ?? '#ffffff', t),
    moduleShape: choice(data, 'module_shape', 'tile', ['square', 'tile', 'circle'], t),
    eyeShape: choice(data, 'eye_shape', 'rounded', ['square', 'rounded'], t),
    imageShape: choice(data, 'image_shape', 'square', ['square', 'rounded'], t),
    margin: integer(data, 'margin', 4, 0, 32, t),
    errorCorrection: choice(data, 'error_correction', 'H', ['L', 'M', 'Q', 'H'], t),
    version: integer(data, 'version', null, 1, 40, t, true),
    size: integer(data, 'size', 1024, 64, 4096, t),
    logoModules: integer(data, 'logo_modules', null, 1, 44, t, true),
    logoPaddingModules: integer(data, 'logo_padding_modules', null, 0, 8, t, true),
    logoPaddingPx: integer(data, 'logo_padding_px', null, 0, 128, t, true),
    logoScale: data.logo_scale ?? .19,
    format: choice(data, 'format', 'png', ['png', 'svg'], t),
  };
  if (settings.color.opacity === 0) throw new RenderError(t('码颜色不能完全透明'));
  if (typeof settings.logoScale !== 'number' || !Number.isFinite(settings.logoScale) || settings.logoScale <= 0 || settings.logoScale > .25) {
    throw new RenderError(t('Logo 比例必须大于 0 且不超过 0.25'));
  }
  if (settings.logoPaddingModules !== null && settings.logoPaddingPx !== null) throw new RenderError(t('Logo 留白只能选择像素或码点其中一种单位'));
  return settings;
}

function qrMatrix(settings, t) {
  let minimum;
  try { minimum = QRCode.create(settings.content, { errorCorrectionLevel: settings.errorCorrection }).version; }
  catch { throw new RenderError(t('内容无法放入指定版本和容错等级；请选择更大的版本或自动版本'), { code: 'capacity_exceeded', minimum_version: null }); }
  if (settings.version !== null && settings.version < minimum) {
    throw new RenderError(t('内容无法放入指定版本和容错等级；请选择更大的版本或自动版本'),
      { code: 'capacity_exceeded', minimum_version: minimum });
  }
  return QRCode.create(settings.content, { errorCorrectionLevel: settings.errorCorrection,
    ...(settings.version === null ? {} : { version: settings.version }) });
}

async function pngFromSVG(svg, size) {
  const image = await loadImage(new Blob([svg], { type: 'image/svg+xml' }));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, size, size);
  context.drawImage(image, 0, 0, size, size);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

export async function render(data, t = (source, values = {}) => source.replace(/\{(\w+)\}/g, (_, key) => values[key])) {
  let settings;
  let qr;
  try {
    settings = settingsFrom(data, t);
    qr = qrMatrix(settings, t);
    const n = qr.modules.size;
    const total = n + 2 * settings.margin;
    if (settings.logoModules !== null && settings.logoModules > Math.floor(n / 4)) {
      throw new RenderError(t('当前二维码的 Logo 最多为 {max_modules} 个码点；请缩小 Logo 或增加二维码版本', { max_modules: Math.floor(n / 4) }),
        { max_logo_modules: Math.floor(n / 4) });
    }
    if (settings.size < total) throw new RenderError(t('输出尺寸至少需要 {total} 像素，以容纳每个码点', { total }));
    const logo = await prepareLogo(data.logo, data.logo_crop, t);
    const geometry = await logoGeometry(logo, qr, settings, t);
    const svg = svgFromMatrix(qr, settings, geometry, t);
    const body = settings.format === 'svg' ? new Blob([svg], { type: 'image/svg+xml' }) : await pngFromSVG(svg, settings.size);
    if (!body) throw new RenderError(t('生成失败（HTTP {status}）', { status: 500 }));
    const cornerRadius = settings.imageShape === 'rounded' ? 100 * ROUNDED_CORNER_RADIUS / total : 0;
    const headers = new Headers({
      'Content-Type': settings.format === 'svg' ? 'image/svg+xml' : 'image/png',
      'Content-Disposition': `attachment; filename="qrg.${settings.format}"`,
      'X-QRG-Version': String(qr.version), 'X-QRG-Modules': String(n),
      'X-QRG-Logo-Max-Modules': String(Math.floor(n / 4)),
      'X-QRG-Logo-Options': JSON.stringify(logoOptions(qr.version, n, t)),
      'X-QRG-Image-Corner-Radius': cornerRadius.toFixed(6),
    });
    if (settings.logoModules !== null) headers.set('X-QRG-Logo-Modules', String(settings.logoModules));
    return new Response(body, { headers });
  } catch (error) {
    const details = { error: error.message || t('生成失败（HTTP {status}）', { status: 400 }) };
    for (const key of ['code', 'minimum_version', 'max_logo_modules']) if (error[key] !== undefined) details[key] = error[key];
    if (settings && qr && data.logo && error.code !== 'capacity_exceeded') {
      details.logo_options = logoOptions(qr.version, qr.modules.size, t);
    }
    return new Response(JSON.stringify(details), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}
