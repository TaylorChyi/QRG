#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { chromium } = require(process.env.QRG_PLAYWRIGHT_MODULE || 'playwright-core');

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  let renderRequests = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().endsWith('/api/render')) renderRequests += 1; });
  try {
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !document.querySelector('#download-png').disabled);
    const imageURL = await page.locator('#preview-image').getAttribute('src');
    const imageSize = await page.locator('#preview-image').evaluate(image => image.naturalWidth);
    const initialRequests = renderRequests;
    const cardWidth = () => page.locator('.preview-card').evaluate(card => card.getBoundingClientRect().width);
    const fittedWidth = await cardWidth();

    assert.equal(await page.locator('#zoom-value').textContent(), '100%');
    await page.getByRole('button', { name: '放大预览', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#zoom-value').textContent(), '125%');
    assert.ok(Math.abs(await cardWidth() / fittedWidth - 1.25) < .01, 'plus enlarges the whole image');
    await page.getByRole('button', { name: '缩小预览', exact: true }).click();
    assert.equal(await page.locator('#zoom-value').textContent(), '100%');
    for (let step = 0; step < 3; step += 1) await page.locator('#zoom-out').click();
    assert.equal(await page.locator('#zoom-value').textContent(), '25%');
    assert.equal(await page.locator('#zoom-out').isDisabled(), true);
    assert.ok(Math.abs(await cardWidth() / fittedWidth - .25) < .01, 'minus shrinks the whole image');
    for (let step = 0; step < 7; step += 1) await page.locator('#zoom-in').click();
    assert.equal(await page.locator('#zoom-value').textContent(), '200%');
    assert.equal(await page.locator('#zoom-in').isDisabled(), true);
    assert.ok(Math.abs(await cardWidth() / fittedWidth - 2) < .01, 'maximum zoom doubles the image');
    assert.equal(await page.locator('#preview-image').getAttribute('src'), imageURL, 'zoom reuses the rendered image');
    assert.equal(await page.locator('#preview-image').evaluate(image => image.naturalWidth), imageSize);
    assert.equal(await page.locator('#undo').isDisabled(), true, 'zoom does not add QR setting history');
    assert.equal(renderRequests, initialRequests, 'zoom does not request another QR image');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#download-png').click();
    const download = await downloadPromise;
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const png = Buffer.concat(chunks);
    assert.equal(png.readUInt32BE(16), imageSize, 'zoom preserves PNG export width');
    assert.equal(png.readUInt32BE(20), imageSize, 'zoom preserves PNG export height');

    const sizes = [[1440, 900], [1280, 720], [1024, 768], [800, 600], [768, 1024],
      [390, 844], [375, 667], [320, 568], [844, 390], [667, 375]];
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        if (await page.locator('.workspace-views').isVisible()) {
          await page.locator('button[data-view="preview"]').click();
        }
        await page.locator('#zoom-reset').click();
        const baseWidth = await cardWidth();
        for (let step = 0; step < 4; step += 1) await page.locator('#zoom-in').click();
        assert.ok(Math.abs(await cardWidth() / baseWidth - 2) < .01);
        const layout = await page.evaluate(() => {
          const viewport = document.querySelector('#preview-viewport');
          const card = document.querySelector('.preview-card');
          const zoom = document.querySelector('.preview-zoom').getBoundingClientRect();
          const canvas = document.querySelector('.preview-canvas').getBoundingClientRect();
          const exportPanel = document.querySelector('.export-panel').getBoundingClientRect();
          viewport.scrollTo(0, 0);
          const start = card.getBoundingClientRect();
          const bounds = viewport.getBoundingClientRect();
          viewport.scrollTo(viewport.scrollWidth, viewport.scrollHeight);
          const end = card.getBoundingClientRect();
          return {
            pageFits: document.documentElement.scrollWidth === innerWidth && document.documentElement.scrollHeight === innerHeight,
            controlsFit: zoom.left >= 0 && zoom.right <= innerWidth && zoom.top >= canvas.top && zoom.bottom <= exportPanel.top,
            centred: Math.abs((zoom.left + zoom.right) - (canvas.left + canvas.right)) < 2,
            imageReachable: start.left >= bounds.left - 1 && start.top >= bounds.top - 1 && end.right <= bounds.right + 1 && end.bottom <= bounds.bottom + 1,
            exportFits: exportPanel.bottom <= innerHeight + 1,
          };
        });
        assert.ok(Object.values(layout).every(Boolean), `${theme} ${width}×${height}: ${JSON.stringify(layout)}`);
        await page.locator('#zoom-reset').click();
        assert.equal(await page.locator('#zoom-value').textContent(), '100%');
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#content').fill('');
    await page.waitForFunction(() => document.querySelector('#preview-image').hidden);
    assert.equal(await page.locator('#zoom-in').isDisabled(), true, 'empty preview disables zoom');
    assert.equal(await page.locator('#zoom-out').isDisabled(), true);
    assert.equal(await page.locator('#zoom-reset').isDisabled(), true);
    assert.deepEqual(errors, []);
    process.stdout.write('preview zoom: controls, limits, export and 20 themed layouts ok\n');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
