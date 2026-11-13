#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { chromium } = require(process.env.QRG_PLAYWRIGHT_MODULE || '../../build/browser-qa/node_modules/playwright-core');

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-GB' });
  const errors = [];
  const apiRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  await page.addInitScript(() => {
    window.nativeRequests = [];
    window.nextSave = 'success';
    window.QRGNative = { postMessage(message) {
      const value = JSON.parse(message);
      window.nativeRequests.push(value);
      const response = { id: value.id, ok: true };
      if (value.action === 'clipboard') response.text = 'https://example.com/native-clipboard';
      if (value.action === 'save' && window.nextSave === 'cancel') response.cancelled = true;
      if (value.action === 'save' && window.nextSave === 'error') {
        response.ok = false;
        response.error = 'Test save error';
      }
      setTimeout(() => window.QRGNativeResult(response), 0);
    } };
  });
  const ready = () => page.waitForFunction(() => !document.querySelector('#download-png').disabled
    && document.querySelector('#preview-image').naturalWidth > 0, null, { timeout: 30000 });
  try {
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8788', { waitUntil: 'networkidle' });
    await ready();
    assert.deepEqual(await page.evaluate(() => window.nativeRequests), [], 'loading must not read the clipboard');
    await page.locator('#paste-content').click();
    await page.waitForFunction(() => document.querySelector('#content').value.endsWith('/native-clipboard'));
    await ready();
    await page.locator('#download-png').click();
    await page.waitForFunction(() => window.nativeRequests.some(value => value.action === 'save'));
    await ready();
    const png = await page.evaluate(() => window.nativeRequests.find(value => value.action === 'save'));
    const bytes = Buffer.from(png.data, 'base64');
    assert.equal(png.filename, 'qrg.png');
    assert.equal(png.mime, 'image/png');
    assert.equal(bytes.readUInt32BE(16), 1024);
    const decoded = await page.evaluate(async data => {
      const response = await window.QRGSite.fetch('/api/decode', { method: 'POST',
        body: JSON.stringify({ image: `data:image/png;base64,${data}` }) });
      return response.json();
    }, png.data);
    assert.equal(decoded.content, 'https://example.com/native-clipboard');
    await page.locator('#download-svg').click();
    await page.waitForFunction(() => window.nativeRequests.some(value => value.filename === 'qrg.svg'));
    await ready();
    const svg = await page.evaluate(() => window.nativeRequests.find(value => value.filename === 'qrg.svg'));
    assert.match(Buffer.from(svg.data, 'base64').toString(), /<svg[^>]*viewBox=/);
    await page.evaluate(() => { window.nextSave = 'cancel'; });
    await page.locator('#download-png').click();
    await ready();
    assert.doesNotMatch(await page.locator('#status').textContent(), /Cancelled/);
    await page.evaluate(() => { window.nextSave = 'error'; });
    await page.locator('#download-png').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'Test save error');
    await ready();
    await page.locator('#decode-qr').click();
    await page.waitForFunction(() => window.nativeRequests.some(value => value.action === 'openExternal'));
    assert.equal(await page.evaluate(() => window.nativeRequests.find(value => value.action === 'openExternal').url),
      'https://example.com/native-clipboard');
    assert.equal(await page.evaluate(async () => {
      try { await window.QRGNativeBridge.openExternal('file:///private'); return false; }
      catch { return true; }
    }), true);
    for (const theme of ['light', 'dark', 'system']) {
      await page.locator('#theme').selectOption(theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('[data-view="preview"]').first().click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    assert.deepEqual(apiRequests, [], 'native QR processing must not upload to an HTTP API');
    assert.deepEqual(errors, []);
    process.stdout.write('Native bridge: PNG/SVG roundtrip, save cancellation/errors, explicit clipboard, safe links and themes passed\n');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
