#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { chromium } = require(process.env.QRG_PLAYWRIGHT_MODULE || 'playwright-core');

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8000';
const browserPath = process.env.BROWSER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function ready(page) {
  await page.waitForFunction(() => {
    const image = document.querySelector('#preview-image');
    const button = document.querySelector('#download-png');
    return image && !image.hidden && image.complete && button && !button.disabled;
  }, null, { timeout: 20000 });
}

async function previewHash(page) {
  return page.locator('#preview-image').evaluate(image => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return `${bytes.length}:${hash}`;
  });
}

async function previewCentre(page) {
  return page.locator('#preview-image').evaluate(image => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    context.drawImage(image, -Math.floor(image.naturalWidth / 2), -Math.floor(image.naturalHeight / 2));
    return [...context.getImageData(0, 0, 1, 1).data];
  });
}

async function changedFootprint(page, settings) {
  return page.locator('#preview-image').evaluate(async (image, settings) => {
    const baseline = await fetch('/api/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...settings, logo: null, logo_crop: null }),
    });
    if (!baseline.ok) throw new Error('Cannot render QR baseline');
    const bitmaps = await Promise.all([
      createImageBitmap(await baseline.blob()), createImageBitmap(image),
    ]);
    const pixels = bitmaps.map(bitmap => {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    });
    let left = settings.size, top = settings.size, right = -1, bottom = -1;
    for (let y = 0; y < settings.size; y += 1) {
      for (let x = 0; x < settings.size; x += 1) {
        const i = (y * settings.size + x) * 4;
        if ([0, 1, 2, 3].some(channel => pixels[0][i + channel] !== pixels[1][i + channel])) {
          left = Math.min(left, x); top = Math.min(top, y);
          right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
      }
    }
    return { left, top, right, bottom };
  }, settings);
}

async function syntheticIcon(page) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 16;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f00000';
    context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#0000f0';
    context.fillRect(16, 0, 16, 16);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return { name: 'two-colour-icon.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}

async function setCrop(page, { top = 0, bottom = 0, left = 0, right = 0 }) {
  await page.locator('#reset-logo-crop').click();
  for (const [field, value] of Object.entries({ top, bottom, left, right })) {
    await page.locator(`#crop-${field}`).fill(String(value));
  }
}

async function chooseSetting(page, selector, value) {
  await page.locator(selector).selectOption(String(value));
}

async function cropFields(page) {
  const result = {};
  for (const field of ['top', 'bottom', 'left', 'right']) result[field] = Number(await page.locator(`#crop-${field}`).inputValue());
  return result;
}

async function latestPayload(requests) {
  assert.ok(requests.length, 'no /api/render request');
  return requests.at(-1);
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  const context = await browser.newContext({ locale: 'zh-CN', acceptDownloads: true });
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/render' && request.method() === 'POST') {
      requests.push(request.postDataJSON());
    }
  });
  try {
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await ready(page);
    const version = page.locator('#version');
    await version.selectOption('5');
    await ready(page);
    const icon = await syntheticIcon(page);
    const originalHash = await previewHash(page);

    await page.locator('#logo-file').setInputFiles(icon);
    await page.locator('#logo-crop-dialog').waitFor({ state: 'visible' });
    await page.locator('#cancel-logo-crop').click();
    assert.equal(await page.locator('#logo-crop-dialog').isVisible(), false);
    assert.equal(await page.locator('#remove-logo').isVisible(), false);
    assert.equal(await previewHash(page), originalHash, 'cancelled upload changed preview');

    await page.locator('#logo-file').setInputFiles(icon);
    await page.locator('#logo-crop-dialog').waitFor({ state: 'visible' });
    assert.deepEqual(await cropFields(page), { top: 0, bottom: 0, left: 0, right: 0 });
    await setCrop(page, { top: 2, bottom: 3, left: 4, right: 5 });
    await page.locator('#apply-logo-crop').click();
    await ready(page);
    assert.deepEqual((await latestPayload(requests)).logo_crop, { x: 4, y: 2, width: 23, height: 11 },
      'four crop insets must map to the selected source rectangle');
    await page.locator('#edit-logo-crop').click();
    assert.deepEqual(await cropFields(page), { top: 2, bottom: 3, left: 4, right: 5 }, 're-edit lost edge insets');
    await setCrop(page, { left: 16 });
    assert.deepEqual(await cropFields(page), { top: 0, bottom: 0, left: 16, right: 0 });
    await page.locator('#apply-logo-crop').click();
    await ready(page);
    const applied = await latestPayload(requests);
    assert.deepEqual(applied.logo_crop, { x: 16, y: 0, width: 16, height: 16 });
    assert.ok(applied.logo?.startsWith('data:image/png;base64,'));
    const croppedHash = await previewHash(page);
    assert.notEqual(croppedHash, originalHash);
    const centre = await previewCentre(page);
    assert.ok(centre[2] > 200 && centre[0] < 40 && centre[1] < 40, `cropped preview centre is not blue: ${centre}`);

    await chooseSetting(page, '#logo-padding-modules', 0);
    await chooseSetting(page, '#logo-modules', 2);
    await ready(page);
    const twoCells = await latestPayload(requests);
    assert.equal(await page.locator('#logo-modules').inputValue(), '2');
    assert.equal(twoCells.logo_padding_modules, 0);
    assert.equal('logo_padding_px' in twoCells, false);
    const cell = Math.floor(twoCells.size / (37 + twoCells.margin * 2));
    const offset = (twoCells.size - (37 + twoCells.margin * 2) * cell) / 2;
    const edge = offset + (twoCells.margin + Math.floor((37 - 2) / 2)) * cell;
    assert.deepEqual(await changedFootprint(page, twoCells), {
      left: edge, top: edge, right: edge + cell * 2 - 1, bottom: edge + cell * 2 - 1,
    }, '2×2 Logo at zero padding must change exactly two grid rows and columns');

    await chooseSetting(page, '#logo-modules', 3);
    await ready(page);
    const smallHash = await previewHash(page);
    await chooseSetting(page, '#logo-modules', 7);
    await ready(page);
    assert.notEqual(await previewHash(page), smallHash, 'small uploaded icon ignores Logo module count');
    assert.equal((await latestPayload(requests)).logo_modules, 7);
    assert.equal('logo_scale' in (await latestPayload(requests)), false);
    assert.equal(await page.locator('#logo-modules').inputValue(), '7');
    await chooseSetting(page, '#logo-padding-modules', 0);
    await ready(page);
    const tightHash = await previewHash(page);
    await chooseSetting(page, '#logo-padding-modules', 2);
    await ready(page);
    assert.notEqual(await previewHash(page), tightHash, 'Logo clearance did not change preview');
    assert.equal((await latestPayload(requests)).logo_padding_modules, 2);

    await page.locator('#edit-logo-crop').click();
    await page.locator('#logo-crop-dialog').waitFor({ state: 'visible' });
    assert.deepEqual(await cropFields(page), { top: 0, bottom: 0, left: 16, right: 0 }, 're-edit lost crop');
    const beforeCancel = await previewHash(page);
    for (const [edge, value] of [['top', '16'], ['bottom', '16'], ['left', '32'], ['right', '16'],
      ['top', '-1'], ['bottom', '1.5'], ['left', '']]) {
      const field = page.locator(`#crop-${edge}`);
      await field.fill(value);
      assert.equal(await field.getAttribute('aria-invalid'), 'true', `${edge}: accepted invalid inset ${value}`);
      assert.equal(await page.locator('#apply-logo-crop').isDisabled(), true);
      await field.blur();
      assert.equal(await page.locator('#apply-logo-crop').isDisabled(), false);
      assert.deepEqual(await cropFields(page), { top: 0, bottom: 0, left: 16, right: 0 }, 'invalid edit changed crop');
    }

    const canvas = page.locator('#logo-crop-canvas');
    const box = await canvas.boundingBox();
    const point = (x, y) => ({ x: box.x + x * box.width, y: box.y + y * box.height });
    const start = point(.1, .1), end = point(.45, .85);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    const drawn = await cropFields(page);
    assert.ok(drawn.left < 16 && drawn.left + drawn.right > 16 && drawn.top + drawn.bottom > 0,
      `pointer drag did not draw a new crop: ${JSON.stringify(drawn)}`);
    const corner = point(1 - drawn.right / 32, 1 - drawn.bottom / 16);
    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    await page.mouse.move(corner.x + box.width / 16, corner.y, { steps: 4 });
    await page.mouse.up();
    const resized = await cropFields(page);
    assert.ok(resized.right < drawn.right && resized.left === drawn.left, `pointer corner did not resize crop: ${JSON.stringify(resized)}`);
    await canvas.focus();
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await cropFields(page), { ...resized, left: resized.left + 1, right: resized.right - 1 },
      'keyboard movement must update both opposing insets');
    await setCrop(page, { right: 16 });
    await page.locator('#cancel-logo-crop').click();
    assert.equal(await previewHash(page), beforeCancel, 'cancelled re-edit changed preview');
    await page.locator('#edit-logo-crop').click();
    assert.deepEqual(await cropFields(page), { top: 0, bottom: 0, left: 16, right: 0 });
    await setCrop(page, { right: 16 });
    await page.locator('#apply-logo-crop').click();
    await ready(page);
    assert.deepEqual((await latestPayload(requests)).logo_crop, { x: 0, y: 0, width: 16, height: 16 });
    await page.locator('#undo').click();
    await ready(page);
    assert.deepEqual((await latestPayload(requests)).logo_crop, { x: 16, y: 0, width: 16, height: 16 });
    await page.locator('#redo').click();
    await ready(page);
    assert.deepEqual((await latestPayload(requests)).logo_crop, { x: 0, y: 0, width: 16, height: 16 });

    await page.locator('#edit-logo-crop').click();
    await page.locator('#reset-logo-crop').click();
    assert.deepEqual(await cropFields(page), { top: 0, bottom: 0, left: 0, right: 0 }, 'whole image must clear all four insets');
    await page.locator('#apply-logo-crop').click();
    await ready(page);
    const reset = await latestPayload(requests);
    assert.ok(reset.logo?.startsWith('data:image/png;base64,'), 'reset lost source image');
    assert.ok(reset.logo_crop === null || (reset.logo_crop.x === 0 && reset.logo_crop.y === 0 &&
      reset.logo_crop.width === 32 && reset.logo_crop.height === 16), `reset did not restore full image: ${JSON.stringify(reset.logo_crop)}`);

    await page.locator('#download-png').waitFor({ state: 'visible' });
    const svgRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/render' && request.postDataJSON()?.format === 'svg');
    const download = page.waitForEvent('download');
    await page.locator('#download-svg').click();
    assert.deepEqual((await svgRequest).postDataJSON().logo_crop, reset.logo_crop);
    assert.equal(await (await download).failure(), null);

    for (const theme of ['light', 'dark']) {
      await page.locator('#theme').selectOption(theme);
      await page.locator('#edit-logo-crop').click();
      await page.locator('#logo-crop-dialog').waitFor({ state: 'visible' });
      const colour = await page.locator('#logo-crop-dialog').evaluate(element => getComputedStyle(element).backgroundColor);
      assert.ok(colour && colour !== 'rgba(0, 0, 0, 0)', `${theme}: dialog has transparent background`);
      const rect = await page.locator('#logo-crop-dialog').boundingBox();
      assert.ok(rect.width > 0 && rect.height > 0, `${theme}: empty dialog`);
      await page.locator('#cancel-logo-crop').click();
    }
    await page.setViewportSize({ width: 320, height: 568 });
    await page.locator('#edit-logo-crop').click();
    const measure = await page.locator('#logo-crop-dialog').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        viewportWidth: innerWidth, viewportHeight: innerHeight };
    });
    assert.ok(measure.left >= -1 && measure.right <= measure.viewportWidth + 1 &&
      measure.top >= -1 && measure.bottom <= measure.viewportHeight + 1,
    `narrow crop dialog clipped: ${JSON.stringify(measure)}`);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#logo-crop-dialog').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'edit-logo-crop', 'Escape did not restore focus');

    const square = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      canvas.getContext('2d').fillRect(0, 0, 32, 32);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#logo-file').setInputFiles({ name: 'square.png', mimeType: 'image/png', buffer: Buffer.from(square, 'base64') });
    await page.locator('#logo-crop-dialog').waitFor({ state: 'visible' });
    const squareGeometry = await page.evaluate(() => {
      const dialog = document.querySelector('#logo-crop-dialog');
      const button = document.querySelector('#apply-logo-crop');
      const rect = button.getBoundingClientRect();
      return { buttonBottom: rect.bottom, buttonTop: rect.top, buttonLeft: rect.left, buttonRight: rect.right,
        viewportHeight: innerHeight, viewportWidth: innerWidth, dialogOverflowX: dialog.scrollWidth - dialog.clientWidth };
    });
    assert.ok(squareGeometry.buttonTop >= -1 && squareGeometry.buttonBottom <= squareGeometry.viewportHeight + 1 &&
      squareGeometry.buttonLeft >= -1 && squareGeometry.buttonRight <= squareGeometry.viewportWidth + 1,
    `square-image Apply button is below fold: ${JSON.stringify(squareGeometry)}`);
    assert.ok(squareGeometry.dialogOverflowX <= 1, `square-image dialog has horizontal overflow: ${JSON.stringify(squareGeometry)}`);
    await page.locator('#cancel-logo-crop').click();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator('#content').fill('A');
    await page.locator('#version').selectOption('1');
    await ready(page);
    assert.equal((await latestPayload(requests)).logo_modules, 5, 'smaller QR must cap Logo to five cells');
    assert.equal(await page.locator('#logo-modules').inputValue(), '5');
    assert.deepEqual(await page.locator('#logo-modules option').allTextContents(), ['2 × 2 格', '3 × 3 格', '5 × 5 格']);
    await page.locator('#undo').click();
    await ready(page);
    assert.equal((await latestPayload(requests)).logo_modules, 7, 'undo must restore previous module count');
    assert.ok((await page.locator('#logo-modules option').allTextContents()).includes('7 × 7 格'));
    await page.locator('#redo').click();
    await ready(page);
    assert.equal((await latestPayload(requests)).logo_modules, 5);
    assert.deepEqual(errors, [], `JavaScript errors: ${errors.join('; ')}`);
    process.stdout.write('logo crop and preview regressions ok\n');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
