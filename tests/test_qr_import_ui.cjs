#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { chromium } = require(process.env.QRG_PLAYWRIGHT_MODULE || 'playwright-core');
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8000';
const executablePath = process.env.BROWSER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function ready(page) {
  await page.waitForFunction(() => !document.getElementById('download-png').disabled);
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'zh-CN' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const target = 'https://example.com/from-small-image?item=42';
  try {
    const response = await context.request.post(`${baseURL}/api/render`, { data: {
      content: target, size: 128, module_shape: 'square', eye_shape: 'square', error_correction: 'M',
    } });
    assert.equal(response.status(), 200);
    const source = await response.body();
    const image = { name: 'small-qr.png', mimeType: 'image/png', buffer: source };
    await page.goto(`${baseURL}/?lang=zh-CN`, { waitUntil: 'networkidle' });
    await ready(page);

    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('#import-qr').click();
    await (await chooserPromise).setFiles(image);
    await page.waitForFunction(value => document.getElementById('content').value === value, target);
    await ready(page);
    assert.equal(context.pages().length, 1, 'import must fill content without opening the destination');
    assert.equal(await page.locator('#qr-file').inputValue(), '', 'same image can be selected again');
    const rendered = await page.locator('#preview-image').evaluate(async img => {
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    });
    const decoded = await context.request.post(`${baseURL}/api/decode`, { data: { image: rendered } });
    assert.equal((await decoded.json()).content, target, 'regenerated QR must contain the imported URL');
    assert.equal(await page.locator('#preview-image').evaluate(img => img.naturalWidth), 1024);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#download-png').click();
    const download = await downloadPromise;
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const exported = Buffer.concat(chunks);
    assert.equal(exported.readUInt32BE(16), 1024, 'export must regenerate at the chosen resolution');
    const exportedContent = await context.request.post(`${baseURL}/api/decode`, {
      data: { image: `data:image/png;base64,${exported.toString('base64')}` },
    });
    assert.equal((await exportedContent.json()).content, target);
    await page.locator('#undo').click();
    assert.equal(await page.locator('#content').inputValue(), 'https://example.com');
    await page.locator('#redo').click();
    assert.equal(await page.locator('#content').inputValue(), target);

    // Read real JPEG and WebP versions, and replace an empty input as well.
    for (const [mimeType, extension] of [['image/jpeg', 'jpg'], ['image/webp', 'webp']]) {
      const encoded = await page.evaluate(async ({ base64, mimeType }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        return canvas.toDataURL(mimeType, 0.9).split(',')[1];
      }, { base64: source.toString('base64'), mimeType });
      await page.locator('#content').fill('');
      await page.locator('#qr-file').setInputFiles({ name: `small.${extension}`, mimeType, buffer: Buffer.from(encoded, 'base64') });
      await page.waitForFunction(value => document.getElementById('content').value === value, target);
      await ready(page);
    }

    for (const [file, expected] of [
      [{ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('invalid') }, /无法读取/],
      [{ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024 + 1) }, /2 MiB/],
      [{ name: 'code.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') }, /PNG/],
    ]) {
      await page.locator('#qr-file').setInputFiles(file);
      await page.waitForFunction(() => !document.getElementById('qr-import-status').hidden);
      await page.waitForFunction(() => document.getElementById('import-qr').getAttribute('aria-busy') === 'false');
      assert.match(await page.locator('#qr-import-status').textContent(), expected);
      assert.equal(await page.locator('#content').inputValue(), target, 'failure must preserve content');
    }

    for (const content of ['plain text from QR', 'javascript:alert(1)', '9'.repeat(4097)]) {
      await page.route('**/api/decode*', route => route.fulfill({ json: { content } }));
      await page.locator('#qr-file').setInputFiles(image);
      await page.waitForFunction(() => document.getElementById('import-qr').getAttribute('aria-busy') === 'false');
      if (content.length > 4096) {
        assert.match(await page.locator('#qr-import-status').textContent(), /4096/);
      } else {
        assert.equal(await page.locator('#content').inputValue(), content);
        assert.equal(await page.locator('#open-link').isDisabled(), true);
      }
      assert.equal(context.pages().length, 1);
      await page.unroute('**/api/decode*');
    }

    let release;
    let started;
    const pending = new Promise(resolve => { release = resolve; });
    const requestStarted = new Promise(resolve => { started = resolve; });
    await page.route('**/api/decode*', async route => {
      started();
      await pending;
      await route.fulfill({ json: { content: target } }).catch(() => {});
    });
    await page.locator('#qr-file').setInputFiles(image);
    await requestStarted;
    await page.locator('#content').fill('https://example.com/typed-while-reading');
    release();
    await page.unroute('**/api/decode*');
    await ready(page);
    assert.equal(await page.locator('#content').inputValue(), 'https://example.com/typed-while-reading');

    // A slow first upload must not replace a more recent image selection.
    let releaseFirst;
    let firstStarted;
    const firstPending = new Promise(resolve => { releaseFirst = resolve; });
    const firstRequest = new Promise(resolve => { firstStarted = resolve; });
    let calls = 0;
    await page.route('**/api/decode*', async route => {
      if (++calls === 1) {
        firstStarted();
        await firstPending;
        await route.fulfill({ json: { content: 'old image' } }).catch(() => {});
      } else {
        await route.fulfill({ json: { content: target } });
      }
    });
    await page.locator('#qr-file').setInputFiles(image);
    await firstRequest;
    await page.locator('#qr-file').setInputFiles(image);
    await page.waitForFunction(value => document.getElementById('content').value === value, target);
    releaseFirst();
    await page.unroute('**/api/decode*');
    await ready(page);
    assert.equal(await page.locator('#content').inputValue(), target);

    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 720 });
        const box = await page.locator('#import-qr').boundingBox();
        assert.ok(box && box.width >= 44 && box.height >= 28 && box.x >= 0 && box.x + box.width <= width,
          `${theme} ${width}: import action must be visible`);
        await page.locator('#import-qr').focus();
        assert.equal(await page.locator('#import-qr').evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
      }
    }
    assert.deepEqual(errors, []);
    process.stdout.write('QR image import, regeneration, history, error preservation and themes ok\n');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
