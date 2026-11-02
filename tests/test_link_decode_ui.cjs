#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { chromium } = require(process.env.QRG_PLAYWRIGHT_MODULE || 'playwright-core');

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8000';
const browserPath = process.env.BROWSER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function ready(page) {
  await page.waitForFunction(() => !document.querySelector('#decode-qr').disabled, null, { timeout: 20000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('https://example.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: 'opened link' }));
  await context.route('https://decoded.example.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: 'decoded link' }));
  await context.route('https://other.example.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: 'other link' }));
  try {
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await ready(page);
    assert.equal(await page.locator('.field-label #content-count').count(), 0);
    assert.equal(await page.locator('.content-input #content-count').count(), 1);
    assert.equal(await page.locator('#open-link').isEnabled(), true);

    const directPopupPromise = page.waitForEvent('popup');
    await page.locator('#open-link').click();
    const directPopup = await directPopupPromise;
    await directPopup.waitForURL('https://example.com/');
    assert.equal(await directPopup.evaluate(() => window.opener), null);
    await directPopup.close();

    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'hello', '']) {
      await page.locator('#content').fill(bad);
      assert.equal(await page.locator('#open-link').isDisabled(), true, `${bad}: source link must be web URL`);
    }

    const realTarget = 'https://decoded.example.test/qr?item=1';
    await page.locator('#content').fill(realTarget);
    await ready(page);
    const realPopupPromise = page.waitForEvent('popup');
    const decodeRequestPromise = page.waitForRequest(request => new URL(request.url()).pathname === '/api/decode');
    await page.locator('#decode-qr').click();
    const realPopup = await realPopupPromise;
    const decodeRequest = await decodeRequestPromise;
    assert.match(decodeRequest.postDataJSON().image, /^data:image\/png;base64,/);
    await realPopup.waitForURL(realTarget, { timeout: 20000 });
    assert.equal(await realPopup.evaluate(() => window.opener), null);
    await realPopup.close();
    await ready(page);

    await page.route('**/api/decode?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: 'https://other.example.test/from-image' }) }));
    const changedPopupPromise = page.waitForEvent('popup');
    await page.locator('#decode-qr').click();
    const changedPopup = await changedPopupPromise;
    await changedPopup.waitForURL('https://other.example.test/from-image');
    assert.notEqual(changedPopup.url(), realTarget, 'destination must come from QR decoder');
    await changedPopup.close();
    await page.unroute('**/api/decode?*');

    await page.route('**/api/decode?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: 'plain QR text' }) }));
    const textPopupPromise = page.waitForEvent('popup');
    await page.locator('#decode-qr').click();
    const textPopup = await textPopupPromise;
    await textPopup.waitForEvent('close');
    assert.match(await page.locator('#status').textContent(), /链接|网页|http/i);
    await page.unroute('**/api/decode?*');

    await page.route('**/api/decode?*', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '未识别到二维码' }) }));
    const failedPopupPromise = page.waitForEvent('popup');
    await page.locator('#decode-qr').click();
    const failedPopup = await failedPopupPromise;
    await failedPopup.waitForEvent('close');
    assert.match(await page.locator('#status').textContent(), /未识别到二维码/);
    await page.unroute('**/api/decode?*');

    let releaseDecode;
    const decoding = new Promise(resolve => { releaseDecode = resolve; });
    let requestStarted;
    const started = new Promise(resolve => { requestStarted = resolve; });
    await page.route('**/api/decode?*', async route => {
      requestStarted();
      await decoding;
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ content: 'https://other.example.test/stale' }) }).catch(() => {});
    });
    const stalePopupPromise = page.waitForEvent('popup');
    await page.locator('#decode-qr').click();
    const stalePopup = await stalePopupPromise;
    await started;
    assert.equal(await page.locator('#decode-qr').isDisabled(), true);
    await page.locator('#content').fill('https://example.com/changed');
    if (!stalePopup.isClosed()) await stalePopup.waitForEvent('close');
    releaseDecode();
    await page.unroute('**/api/decode?*');
    await ready(page);
    assert.equal(context.pages().some(tab => tab.url() === 'https://other.example.test/stale'), false,
      'editing while decoding must not navigate stale QR results');

    await page.evaluate(() => { window.__qrgOpen = window.open; window.open = () => null; });
    await page.locator('#decode-qr').click();
    assert.match(await page.locator('#status').textContent(), /浏览器|弹窗|打开|拦截/);
    await page.evaluate(() => { window.open = window.__qrgOpen; delete window.__qrgOpen; });

    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      for (const [width, height] of [[1280, 720], [320, 568]]) {
        await page.setViewportSize({ width, height });
        if (width === 320) await page.locator('button[data-view="preview"]').click();
        const target = width === 320 ? '#decode-qr' : '#open-link';
        const position = await page.locator(target).evaluate(button => {
          const r = button.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
        });
        assert.ok(position.width >= 36 && position.left >= 0 && position.right <= width && position.top >= 0 && position.bottom <= height,
          `${theme} ${width}×${height}: navigation button clipped ${JSON.stringify(position)}`);
        assert.ok(await page.locator('#decode-qr').isVisible());
        if (width === 320) await page.locator('button[data-view="editor"]').click();
      }
    }
    assert.deepEqual(errors, [], `JavaScript errors: ${errors.join('; ')}`);
    process.stdout.write('link and QR navigation ok\n');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
