#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.QRG_PLAYWRIGHT_MODULE || 'playwright-core');

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8000';
const browserPath = process.env.BROWSER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const content = 'https://newcall.5gnewcall.cn/basicservice/#/pages/promotion/premium?channel=300677&activityCode=QGtonghuazunxianghuodong';
const renderRequest = request => new URL(request.url()).pathname === '/api/render';

async function ready(page) {
  await page.waitForFunction(() => {
    const image = document.querySelector('#preview-image');
    return !document.querySelector('#download-png').disabled && image.complete && image.naturalWidth > 0
      && getComputedStyle(image).opacity === '1';
  }, null, { timeout: 20000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  const context = await browser.newContext({ locale: 'zh-CN', acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    for (const theme of ['light', 'dark']) {
      await page.goto(baseURL, { waitUntil: 'networkidle' });
      await ready(page);
      await page.locator('#theme').selectOption(theme);
      await page.locator('#error-correction').selectOption('Q');
      await page.locator('#version').selectOption('5');
      await ready(page);
      const rendered = page.waitForResponse(response => renderRequest(response.request()) && response.ok()
        && response.request().postDataJSON().content === content);
      await page.locator('#content').fill(content);
      const [response] = await Promise.all([rendered,
        page.waitForFunction(() => document.querySelector('#version').value === 'auto', null, { timeout: 5000 })]);
      await ready(page);
      assert.equal(response.headers()['x-qrg-version'], '9');
      assert.equal(await page.locator('#content').inputValue(), content);
      assert.equal(await page.locator('#error-correction').inputValue(), 'Q');
      assert.equal(await page.locator('#module-shape').inputValue(), 'tile');
      assert.equal(await page.locator('#eye-shape').inputValue(), 'rounded');
      assert.equal(await page.locator('#status').isVisible(), true);
      assert.match(await page.locator('#status').textContent(), /自动.*9/);
      assert.equal(await page.locator('#status').getAttribute('class'), 'preview-notice');
      await page.screenshot({ path: `build/capacity-${theme}.png` });
      await page.locator('#language').selectOption('en');
      await page.waitForFunction(() => document.documentElement.lang === 'en');
      await ready(page);
      assert.match(await page.locator('#status').textContent(), /version 9 was selected automatically/);
      await page.setViewportSize({ width: 320, height: 568 });
      await page.locator('[data-view="preview"]').click();
      const fits = await page.locator('#status').evaluate(element => {
        const rect = element.getBoundingClientRect();
        const button = document.querySelector('#download-png').getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && button.bottom <= innerHeight;
      });
      assert.ok(fits, 'capacity notice and exports must fit on mobile in both themes');
      await page.screenshot({ path: `build/capacity-${theme}-mobile.png` });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator('#language').selectOption('zh-CN');
      await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
      await ready(page);

      // One undo restores the complete previous edit, and redo keeps the recovered version.
      await page.locator('#undo').click();
      await ready(page);
      assert.equal(await page.locator('#content').inputValue(), 'https://example.com');
      assert.equal(await page.locator('#version').inputValue(), '5');
      await page.locator('#redo').click();
      await ready(page);
      assert.equal(await page.locator('#content').inputValue(), content);
      assert.equal(await page.locator('#version').inputValue(), 'auto');

      const pngDownload = page.waitForEvent('download');
      await page.locator('#download-png').click();
      const png = await pngDownload;
      const image = await fs.readFile(await png.path());
      const decoded = await context.request.post(`${baseURL}/api/decode`, {
        data: { image: `data:image/png;base64,${image.toString('base64')}` },
      });
      assert.deepEqual(await decoded.json(), { content }, 'downloaded PNG must retain the entire URL');
      const svgResponse = page.waitForResponse(response => renderRequest(response.request())
        && response.request().postDataJSON().format === 'svg');
      const svgDownload = page.waitForEvent('download');
      await page.locator('#download-svg').click();
      const svg = await svgResponse;
      assert.equal(svg.status(), 200);
      assert.equal(svg.headers()['x-qrg-version'], '9');
      assert.equal(svg.request().postDataJSON().version, null);
      assert.equal(await (await svgDownload).failure(), null);
      process.stdout.write(`${theme}: capacity recovery, undo/redo and PNG/SVG exports ok\n`);
    }

    // Raising error correction can also invalidate a previously sufficient fixed version.
    await page.locator('#content').fill('x'.repeat(70));
    await page.locator('#error-correction').selectOption('L');
    await page.locator('#version').selectOption('5');
    await ready(page);
    await page.locator('#error-correction').selectOption('H');
    await ready(page);
    assert.equal(await page.locator('#version').inputValue(), 'auto');
    assert.equal(await page.locator('#error-correction').inputValue(), 'H');

    // Genuine capacity limits remain errors, with no retry loop or stale exports.
    const requests = [];
    page.on('request', request => { if (renderRequest(request)) requests.push(request.postDataJSON()); });
    await page.locator('#content').fill('x'.repeat(4096));
    await page.waitForFunction(() => document.querySelector('#status').className === 'preview-error');
    assert.equal(await page.locator('#download-png').isDisabled(), true);
    assert.equal(await page.locator('#download-svg').isDisabled(), true);
    assert.equal(requests.length, 1);

    // An old capacity response must not change a newer fixed-version edit.
    await page.locator('#content').fill('short');
    await page.locator('#version').selectOption('5');
    await ready(page);
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    await page.route('**/api/render?*', async route => {
      if (route.request().postDataJSON().content !== content) return route.continue();
      markStarted();
      await held;
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({
        error: 'capacity', code: 'capacity_exceeded', minimum_version: 9,
      }) }).catch(() => {});
    });
    await page.locator('#content').fill(content);
    await started;
    await page.locator('#content').fill('newer');
    release();
    await ready(page);
    assert.equal(await page.locator('#version').inputValue(), '5');
    assert.equal(await page.locator('#content').inputValue(), 'newer');
    assert.deepEqual(errors, []);
    process.stdout.write('correction changes, capacity limits and stale responses ok\n');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
