#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { chromium } = require(process.env.QRG_PLAYWRIGHT_MODULE || 'playwright-core');
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8000';
const executablePath = process.env.BROWSER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pasteShortcut = process.platform === 'darwin' ? 'Meta+V' : 'Control+V';

async function ready(page) {
  await page.waitForFunction(() => !document.getElementById('download-png').disabled);
}

async function transfer(page, files) {
  return page.evaluateHandle(files => {
    const data = new DataTransfer();
    for (const file of files) {
      const bytes = Uint8Array.from(atob(file.base64), char => char.charCodeAt(0));
      data.items.add(new File([bytes], file.name, { type: file.type }));
    }
    return data;
  }, files);
}

async function pasteImage(page, base64) {
  await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
  }, base64);
  await page.locator('#content').focus();
  await page.keyboard.press(pasteShortcut);
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'zh-CN' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(baseURL).origin });
  const page = await context.newPage();
  const errors = [];
  let decodeRequests = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/decode') decodeRequests += 1; });
  const target = 'https://example.com/dropped-or-pasted-qr';
  let releasePending = () => {};
  try {
    const response = await context.request.post(`${baseURL}/api/render`, { data: {
      content: target, size: 128, module_shape: 'square', eye_shape: 'square', error_correction: 'M',
    } });
    assert.equal(response.status(), 200);
    const image = { name: 'qr.png', type: 'image/png', base64: (await response.body()).toString('base64') };
    await page.goto(`${baseURL}/?lang=zh-CN`, { waitUntil: 'networkidle' });
    await ready(page);
    const dataTransfer = await transfer(page, [image]);

    // Nested drag events keep the target highlighted until the whole page is left.
    await page.dispatchEvent('.content-field', 'dragenter', { dataTransfer });
    await page.dispatchEvent('#content', 'dragenter', { dataTransfer });
    await page.dispatchEvent('.content-field', 'dragleave', { dataTransfer });
    assert.equal(await page.locator('.content-field').evaluate(el => el.classList.contains('is-dragging')), true);
    await page.dispatchEvent('#content', 'dragleave', { dataTransfer });
    assert.equal(await page.locator('.content-field').evaluate(el => el.classList.contains('is-dragging')), false);

    await page.locator('#content').fill('https://example.com/before-drop');
    await page.dispatchEvent('#preview-pane', 'dragenter', { dataTransfer });
    await page.dispatchEvent('#preview-pane', 'dragover', { dataTransfer });
    await page.dispatchEvent('#preview-pane', 'drop', { dataTransfer });
    await page.waitForFunction(value => document.getElementById('content').value === value, target);
    await ready(page);
    assert.equal(await page.locator('.content-field').evaluate(el => el.classList.contains('is-dragging')), false);
    assert.equal(context.pages().length, 1, 'dropping a file must not open it or navigate away');
    await page.locator('#undo').click();
    assert.equal(await page.locator('#content').inputValue(), 'https://example.com/before-drop');
    await page.locator('#redo').click();
    assert.equal(await page.locator('#content').inputValue(), target);
    process.stdout.write('file drop and history ok\n');

    // Real browser clipboard and keyboard events, including native text paste.
    await page.locator('#content').fill('https://example.com/before-paste');
    await pasteImage(page, image.base64);
    await page.waitForFunction(value => document.getElementById('content').value === value, target);
    await ready(page);
    await page.locator('#undo').click();
    assert.equal(await page.locator('#content').inputValue(), 'https://example.com/before-paste');
    await page.locator('#redo').click();
    assert.equal(await page.locator('#content').inputValue(), target);
    await page.locator('#content').fill('');
    const beforeTextPaste = decodeRequests;
    await page.evaluate(() => navigator.clipboard.writeText('https://example.com/ordinary-paste'));
    await page.locator('#content').focus();
    await page.keyboard.press(pasteShortcut);
    await page.waitForFunction(() => document.getElementById('content').value === 'https://example.com/ordinary-paste');
    await ready(page);
    assert.equal(decodeRequests, beforeTextPaste, 'text paste must bypass image decoding');
    process.stdout.write('real image and text clipboard paste ok\n');

    const beforeFailure = await page.locator('#content').inputValue();
    const multiple = await transfer(page, [image, { ...image, name: 'second.png' }]);
    for (const [type, init] of [['drop', { dataTransfer: multiple }], ['paste', { clipboardData: multiple }]]) {
      const beforeMultiple = decodeRequests;
      await page.dispatchEvent('#content', type, init);
      assert.match(await page.locator('#qr-import-status').textContent(), /一张/);
      assert.equal(await page.locator('#content').inputValue(), beforeFailure);
      assert.equal(decodeRequests, beforeMultiple, 'multiple files must not be sent for decoding');
    }
    const bad = await transfer(page, [{ name: 'bad.png', type: 'image/png', base64: Buffer.from('invalid').toString('base64') }]);
    await page.dispatchEvent('#content', 'drop', { dataTransfer: bad });
    await page.waitForFunction(() => document.getElementById('import-qr').getAttribute('aria-busy') === 'false');
    assert.match(await page.locator('#qr-import-status').textContent(), /无法读取/);
    assert.equal(await page.locator('#content').inputValue(), beforeFailure);
    process.stdout.write('multiple and invalid image preservation ok\n');

    // A later drop cancels an older pasted image result.
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    releasePending = release;
    let requests = 0;
    await page.route('**/api/decode*', async route => {
      if (++requests === 1) {
        await pending;
        await route.fulfill({ json: { content: 'old pasted result' } }).catch(() => {});
      } else await route.continue();
    });
    const requestStarted = page.waitForRequest(request => new URL(request.url()).pathname === '/api/decode', { timeout: 10000 });
    await pasteImage(page, image.base64);
    await requestStarted;
    const latestDrop = await transfer(page, [image]);
    await page.dispatchEvent('#content', 'drop', { dataTransfer: latestDrop });
    await page.waitForFunction(value => document.getElementById('content').value === value, target);
    release();
    await page.unroute('**/api/decode*');
    await ready(page);
    assert.equal(await page.locator('#content').inputValue(), target);

    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 720 });
        const normalBackground = await page.locator('#content').evaluate(el => getComputedStyle(el).backgroundColor);
        await page.dispatchEvent('#content', 'dragenter', { dataTransfer });
        const styles = await page.locator('#content').evaluate(el => ({
          background: getComputedStyle(el).backgroundColor,
          accent: getComputedStyle(document.documentElement).getPropertyValue('--soft-accent').trim(),
        }));
        assert.notEqual(styles.background, normalBackground, 'file drag must visibly highlight the input');
        const box = await page.locator('#qr-import-hint').boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width, `${theme} ${width}: hint must fit`);
        await page.dispatchEvent('#content', 'dragleave', { dataTransfer });
      }
    }
    assert.deepEqual(errors, []);
    process.stdout.write('QR drag/drop, real image/text clipboard paste, history, cancellation and themes ok\n');
  } finally {
    releasePending();
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
