#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { chromium } = require(process.env.QRG_PLAYWRIGHT_MODULE || 'playwright-core');

async function main() {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const blobs = new Map();
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      const url = create(blob);
      blobs.set(url, blob);
      return url;
    };
    URL.revokeObjectURL = url => { blobs.delete(url); revoke(url); };
    window.previewBlobBytes = async url => [...new Uint8Array(await blobs.get(url).arrayBuffer())];
  });
  const ready = async () => {
    await page.waitForFunction(() => !document.querySelector('#download-png').disabled);
    await page.locator('#preview-image').evaluate(image => image.decode());
  };
  const choose = async (name, option) => {
    await page.getByRole('combobox', { name: new RegExp(`^${name}：`) }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
    await ready();
  };
  const silhouette = () => page.locator('#preview-image').evaluate(image => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = image.naturalWidth;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const end = canvas.width - 1;
    return [[0, 0], [end, 0], [0, end], [end, end], [Math.floor(end / 2), 0]]
      .map(([x, y]) => context.getImageData(x, y, 1, 1).data[3]);
  });
  try {
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
    await ready();
    assert.equal(await page.locator('#image-shape').inputValue(), 'square');
    assert.equal(await page.locator('#eye-shape').inputValue(), 'rounded');
    assert.deepEqual(await silhouette(), [255, 255, 255, 255, 255]);

    // Keyboard selection, independent eye settings, and history all reach the renderer.
    const imageShape = page.getByRole('combobox', { name: /^图片外角：/ });
    await imageShape.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await ready();
    assert.equal(await page.locator('#image-shape').inputValue(), 'rounded');
    assert.equal(await page.locator('#eye-shape').inputValue(), 'rounded');
    assert.deepEqual(await silhouette(), [0, 0, 0, 0, 255]);
    await page.locator('#undo').click();
    await ready();
    assert.equal(await page.locator('#image-shape').inputValue(), 'square');
    assert.match(await imageShape.getAttribute('aria-label'), /直角$/);
    assert.deepEqual(await silhouette(), [255, 255, 255, 255, 255]);
    await page.locator('#redo').click();
    await ready();
    assert.match(await imageShape.getAttribute('aria-label'), /圆角$/);
    await choose('码眼形状', '方形');
    assert.equal(await page.locator('#image-shape').inputValue(), 'rounded');
    assert.deepEqual(await silhouette(), [0, 0, 0, 0, 255]);

    // The checkerboard, border and shadow share the actual image silhouette in both themes.
    let geometry;
    for (const theme of ['浅色', '深色']) {
      await choose('界面外观', theme);
      const measure = await page.locator('.preview-card').evaluate(card => {
        const stage = card.querySelector('.preview-stage');
        const image = card.querySelector('img');
        return { radius: getComputedStyle(card).borderTopLeftRadius,
          stageRadius: getComputedStyle(stage).borderTopLeftRadius,
          width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height };
      });
      assert.ok(parseFloat(measure.radius) > 0);
      assert.equal(measure.radius, measure.stageRadius);
      if (geometry) assert.deepEqual(measure, geometry, 'theme changes preserve image geometry');
      geometry = measure;
      assert.deepEqual(await silhouette(), [0, 0, 0, 0, 255]);
    }
    await choose('界面外观', '跟随系统');
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.deepEqual(await silhouette(), [0, 0, 0, 0, 255]);

    // PNG download is byte-for-byte the preview; SVG independently renders transparent corners.
    const previewBytes = Buffer.from(await page.locator('#preview-image').evaluate(image => window.previewBlobBytes(image.src)));
    for (const format of ['png', 'svg']) {
      const waiting = page.waitForEvent('download');
      await page.locator(`#download-${format}`).click();
      const download = await waiting;
      assert.equal(await download.failure(), null);
      const chunks = [];
      for await (const chunk of await download.createReadStream()) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      if (format === 'png') assert.ok(bytes.equals(previewBytes), 'PNG download must equal the displayed preview bytes');
      else {
        const svgCorners = await page.evaluate(async svg => {
          const image = new Image();
          const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
          try {
            image.src = url;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = image.naturalWidth;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const end = canvas.width - 1;
            return [[0, 0], [end, 0], [0, end], [end, end], [Math.floor(end / 2), 0]]
              .map(([x, y]) => context.getImageData(x, y, 1, 1).data[3]);
          } finally { URL.revokeObjectURL(url); }
        }, bytes.toString('utf8'));
        assert.deepEqual(svgCorners, [0, 0, 0, 0, 255]);
      }
    }

    await choose('边距', '0 个码点');
    assert.deepEqual(await silhouette(), [0, 0, 0, 0, 255]);
    await choose('图片外角', '直角');
    assert.deepEqual(await silhouette(), [255, 255, 255, 255, 255]);
    assert.equal(await page.locator('.preview-card').evaluate(card => getComputedStyle(card).borderTopLeftRadius), '0%');
    assert.deepEqual(errors, []);
    process.stdout.write('image corners: history, independent eyes, themes, zero margin and PNG/SVG downloads ok\n');
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
