#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.QRG_PLAYWRIGHT_MODULE || '../../build/browser-qa/node_modules/playwright-core');

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8765';
const executablePath = process.env.BROWSER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function ready(page) {
  await page.waitForFunction(() => {
    const image = document.getElementById('preview-image');
    return !document.getElementById('download-png').disabled && image.complete && image.naturalWidth > 0
      && getComputedStyle(image).opacity === '1';
  }, null, { timeout: 30000 });
}

async function importedImage(page, buffer, name = 'qr.png') {
  await page.locator('#qr-file').setInputFiles({ name, mimeType: 'image/png', buffer });
  await page.waitForFunction(() => document.getElementById('import-qr').getAttribute('aria-busy') === 'false',
    null, { timeout: 30000 });
}

async function siteCall(page, route, payload) {
  return page.evaluate(async ({ route, payload }) => {
    const response = await window.QRGSite.fetch(route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = response.ok && route.includes('render') && payload.format !== 'svg'
      ? btoa(String.fromCharCode(...new Uint8Array(await response.arrayBuffer())))
      : response.ok && route.includes('render') ? await response.text() : await response.json();
    return { status: response.status, body, headers: Object.fromEntries(response.headers) };
  }, { route, payload });
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ locale: 'zh-CN', acceptDownloads: true,
    viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  const apiRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });

  try {
    const response = await page.goto(baseURL, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    await ready(page);
    assert.equal(await page.locator('#content').inputValue(), 'https://example.com');
    assert.deepEqual(apiRequests, [], 'the static editor must use local APIs, without uploading QR content');

    const unicodeURL = 'https://example.com/活动?城市=上海&消息=你好';
    await page.locator('#content').fill(unicodeURL);
    await ready(page);
    await page.locator('#module-shape').selectOption('circle');
    await page.locator('#eye-shape').selectOption('rounded');
    await page.locator('#image-shape').selectOption('rounded');
    await page.locator('#background').locator('..').locator('.qrg-colour-trigger').click();
    await page.locator('.qrg-transparent-option').click();
    await ready(page);
    const pngDownload = page.waitForEvent('download');
    await page.locator('#download-png').click();
    const png = await pngDownload;
    const pngBytes = await fs.readFile(await png.path());
    assert.equal(pngBytes.readUInt32BE(16), 1024, 'PNG export respects selected dimensions');
    const decoded = await siteCall(page, '/api/decode', {
      image: `data:image/png;base64,${pngBytes.toString('base64')}`,
    });
    assert.equal(decoded.status, 200);
    assert.equal(decoded.body.content, unicodeURL, 'downloaded PNG must decode to original Unicode URL');

    const svgDownload = page.waitForEvent('download');
    await page.locator('#download-svg').click();
    const svg = await svgDownload;
    const svgText = await fs.readFile(await svg.path(), 'utf8');
    assert.match(svgText, /<svg[^>]*viewBox=/);
    assert.match(svgText, /<clipPath|<mask/, 'rounded image export clips outside corners');
    assert.match(svgText, /fill-opacity="0"/, 'transparent background survives SVG export');
    assert.deepEqual(apiRequests, [], 'preview, export and decode must stay in browser');

    await page.locator('#transparent').evaluate(input => {
      input.checked = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#module-shape').selectOption('square');
    await page.locator('#image-shape').selectOption('square');
    await ready(page);
    const initialContent = await page.locator('#content').inputValue();
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de']) {
      await page.locator('#language').selectOption(locale);
      await page.waitForFunction(value => document.documentElement.lang === value, locale);
      assert.equal(await page.locator('#content').inputValue(), initialContent, `${locale} switch must preserve content`);
    }
    await page.locator('#language').selectOption('zh-CN');
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    await ready(page);

    await page.locator('#content').fill('x'.repeat(70));
    await page.locator('#error-correction').selectOption('H');
    await page.locator('#version').selectOption('1');
    await page.waitForFunction(() => document.getElementById('version').value === 'auto',
      null, { timeout: 30000 });
    await ready(page);
    assert.equal(await page.locator('#status').getAttribute('class'), 'preview-notice');
    assert.equal(await page.locator('#content').inputValue(), 'x'.repeat(70));
    await page.locator('#undo').click();
    await ready(page);
    assert.equal(await page.locator('#version').inputValue(), 'auto');
    await page.locator('#redo').click();
    await ready(page);
    assert.equal(await page.locator('#version').inputValue(), 'auto');

    const icon = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 48;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#e13434'; ctx.fillRect(0, 0, 48, 48);
      ctx.fillStyle = '#fff'; ctx.fillRect(12, 12, 24, 24);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#content').fill('https://example.com/logo');
    await ready(page);
    await page.locator('#logo-file').setInputFiles({ name: 'logo.png', mimeType: 'image/png',
      buffer: Buffer.from(icon, 'base64') });
    await page.locator('#logo-crop-dialog').waitFor({ state: 'visible' });
    await page.locator('#apply-logo-crop').click();
    await ready(page);
    assert.equal(await page.locator('#logo-options').isVisible(), true);
    const logoSvg = await siteCall(page, '/api/render', {
      content: 'https://example.com/logo', format: 'svg', size: 256, margin: 4,
      error_correction: 'H', module_shape: 'tile', eye_shape: 'rounded', image_shape: 'square',
      logo: `data:image/png;base64,${icon}`, logo_modules: 5, logo_padding_modules: 1,
    });
    assert.equal(logoSvg.status, 200);
    assert.match(logoSvg.body, /<image/);
    assert.ok(JSON.parse(logoSvg.headers['x-qrg-logo-options'])['5']);

    await page.locator('#remove-logo').click();
    await page.locator('#content').fill('https://example.com/imported');
    await ready(page);
    const sample = await siteCall(page, '/api/render', {
      content: 'https://example.com/imported', format: 'png', size: 256,
      margin: 4, error_correction: 'M', module_shape: 'square', eye_shape: 'square', image_shape: 'square',
    });
    assert.equal(sample.status, 200);
    await page.locator('#content').fill('');
    await importedImage(page, Buffer.from(sample.body, 'base64'));
    assert.equal(await page.locator('#content').inputValue(), 'https://example.com/imported');
    await ready(page);

    const multiple = await page.evaluate(async sampleBase64 => {
      const img = new Image(); img.src = `data:image/png;base64,${sampleBase64}`; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = 576; canvas.height = 256;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 576, 256);
      ctx.drawImage(img, 0, 0); ctx.drawImage(img, 320, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    }, sample.body);
    const multipleResult = await siteCall(page, '/api/decode', {
      image: `data:image/png;base64,${multiple}`,
    });
    assert.equal(multipleResult.status, 400, 'ambiguous image must be rejected');
    assert.match(multipleResult.body.error, /多个|multiple/i);

    for (const theme of ['light', 'dark']) {
      await page.locator('#theme').selectOption(theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('button[data-view="preview"]').click();
      await ready(page);
      const fit = await page.evaluate(() => {
        const viewport = innerWidth;
        const stage = document.querySelector('.preview-card').getBoundingClientRect();
        const actions = document.querySelector('.download-actions').getBoundingClientRect();
        return document.documentElement.scrollWidth <= viewport + 1
          && stage.left >= -1 && stage.right <= viewport + 1
          && actions.left >= -1 && actions.right <= viewport + 1;
      });
      assert.ok(fit, `${theme} mobile preview must fit horizontally`);
    }
    assert.deepEqual(apiRequests, [], 'all QR and image operations must remain local');
    assert.deepEqual(errors, [], 'no browser script errors');
    process.stdout.write('Site: PNG/SVG, QR import/decode, capacity, logo, eight locales and mobile themes passed\n');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
