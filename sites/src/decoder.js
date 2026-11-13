import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

// Bundle the reader and host its WASM on this Site. No third-party image service.
prepareZXingModule({ overrides: { locateFile: path => new URL(`/static/${path}`, location.href).href } });

export async function decode(data, t) {
  const value = data?.image;
  if (typeof value !== 'string' || !value.includes(',')) throw new Error(t('请提供 PNG、JPEG 或 WebP 二维码图片'));
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match) throw new Error(t('二维码图片仅支持 PNG、JPEG 和 WebP'));
  if (match[2].length > 4 * Math.ceil(2 * 1024 * 1024 / 3)) throw new Error(t('二维码图片不能超过 2 MiB'));
  let bytes;
  try { bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0)); }
  catch { throw new Error(t('二维码图片数据无效')); }
  if (bytes.length > 2 * 1024 * 1024) throw new Error(t('二维码图片不能超过 2 MiB'));
  const format = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 ? 'png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpeg'
    : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' ? 'webp' : null;
  if (format !== match[1]) throw new Error(t('二维码图片格式与数据不符'));
  const image = new Image();
  image.src = value;
  try { await image.decode(); }
  catch { throw new Error(t('无法读取二维码图片')); }
  if (Math.max(image.naturalWidth, image.naturalHeight) > 4096) throw new Error(t('二维码图片宽高不能超过 4096 像素'));
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  const barcodes = await readBarcodes(context.getImageData(0, 0, canvas.width, canvas.height), {
    formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 2,
  });
  if (!barcodes.length) throw new Error(t('未识别到二维码，请检查图片和颜色对比度'));
  if (barcodes.length !== 1) throw new Error(t('图片中有多个二维码，请只保留一个'));
  return { content: barcodes[0].text };
}
