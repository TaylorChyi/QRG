#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { chromium } = require(process.env.QRG_PLAYWRIGHT_MODULE || 'playwright-core');

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8000';
const browserPath = process.env.BROWSER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sizes = [
  [1440, 900], [1280, 720], [1024, 768], [800, 600],
  [768, 1024], [390, 844], [375, 667], [320, 568], [844, 390], [667, 375],
];
async function geometry(page) {
  return page.evaluate(() => {
    const form = document.querySelector('#editor-form');
    const root = document.documentElement;
    const preview = document.querySelector('.preview-pane');
    const card = document.querySelector('.preview-card');
    const image = document.querySelector('#preview-image');
    const exportPanel = document.querySelector('.export-panel');
    const visible = element => getComputedStyle(element).display !== 'none';
    const within = element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1;
    };
    const controls = [...document.querySelectorAll('#editor-form button, #editor-form textarea, #editor-form input:not(.qrg-native-control), #editor-form .upload-button, #editor-form .check-row')]
      .filter(element => visible(element) && !element.hidden);
    const frame = card.getBoundingClientRect();
    const picture = image.getBoundingClientRect();
    return {
      pageX: root.scrollWidth - innerWidth,
      pageY: root.scrollHeight - innerHeight,
      formOverflowX: form.scrollWidth - form.clientWidth,
      previewVisible: visible(preview),
      previewInsets: !visible(preview) ? [] : [picture.left - frame.left, picture.top - frame.top,
        frame.right - picture.right, frame.bottom - picture.bottom],
      cardFits: !visible(preview) || within(card),
      exportFits: !visible(preview) || within(exportPanel),
      editorFits: within(form),
      horizontallyClippedControls: controls.filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
      }).map(element => element.id || element.className || element.tagName),
    };
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: browserPath,  });
  const context = await browser.newContext({ locale: 'zh-CN', acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await page.locator('#preview-image').waitFor({ state: 'visible', timeout: 20000 });

    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      const narrow = await page.locator('.workspace-views').isVisible();
      const measure = await geometry(page);
      assert.ok(measure.pageX <= 1 && measure.pageY <= 1, `${width}×${height}: page overflow ${JSON.stringify(measure)}`);
      assert.ok(measure.editorFits && measure.formOverflowX <= 1, `${width}×${height}: editor overflow ${JSON.stringify(measure)}`);
      assert.deepEqual(measure.horizontallyClippedControls, [], `${width}×${height}: controls clipped horizontally`);
      if (!narrow) {
        assert.ok(measure.cardFits && measure.exportFits, `${width}×${height}: preview/export clipped ${JSON.stringify(measure)}`);
        assert.ok(measure.previewInsets.every(inset => Math.abs(inset - 1) <= 1),
          `${width}×${height}: preview adds space around the exported image: ${measure.previewInsets}`);
      }
      const lastSetting = page.locator('#version').locator('xpath=following-sibling::button[1]');
      await lastSetting.scrollIntoViewIfNeeded();
      assert.ok(await lastSetting.isVisible(), `${width}×${height}: final editor setting cannot be reached`);
      if (narrow) {
        await page.locator('button[data-view="preview"]').click();
        const measure = await geometry(page);
        assert.ok(measure.pageX <= 1 && measure.pageY <= 1 && measure.cardFits && measure.exportFits,
          `${width}×${height}: preview/export clipped ${JSON.stringify(measure)}`);
        assert.ok(measure.previewInsets.every(inset => Math.abs(inset - 1) <= 1),
          `${width}×${height}: preview adds space around the exported image: ${measure.previewInsets}`);
        assert.ok(await page.locator('#download-png').isVisible(), `${width}×${height}: PNG export unavailable`);
        assert.ok(await page.locator('#size').locator('xpath=following-sibling::button[1]').isVisible(), `${width}×${height}: export size unavailable`);
        assert.ok(await page.locator('#margin').locator('xpath=following-sibling::button[1]').isVisible(), `${width}×${height}: export margin unavailable`);
        await page.locator('button[data-view="editor"]').click();
      }
      process.stdout.write(`layout ${width}×${height} ok\n`);
    }

    await page.setViewportSize({ width: 1280, height: 720 });
    assert.equal(await page.locator('[role="tablist"], [role="tab"], [data-preset]').count(), 0);
    const theme = page.locator('#theme').locator('xpath=following-sibling::button[1]');
    await theme.click();
    await page.locator('.qrg-listbox [role="option"]').filter({ hasText: '深色' }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await theme.click();
    await page.locator('.qrg-listbox [role="option"]').filter({ hasText: '浅色' }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await theme.click();
    await page.locator('.qrg-listbox [role="option"]').filter({ hasText: '跟随系统' }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), null);
    await page.emulateMedia({ colorScheme: 'dark' });
    const darkBackground = await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor);
    const darkGeometry = await geometry(page);
    assert.ok(darkGeometry.previewInsets.every(inset => Math.abs(inset - 1) <= 1),
      `dark theme adds a preview margin: ${darkGeometry.previewInsets}`);
    await page.emulateMedia({ colorScheme: 'light' });
    assert.notEqual(await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor), darkBackground);
    assert.deepEqual(await geometry(page), darkGeometry, 'system theme must preserve layout');

    const moduleSelect = page.locator('#module-shape').locator('xpath=following-sibling::button[1]');
    await moduleSelect.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#module-shape').inputValue(), 'circle');

    const colour = page.locator('#color').locator('xpath=following-sibling::button[1]');
    await colour.click();
    const previousColour = await page.locator('#color').inputValue();
    const red = page.locator('.qrg-rgb-row input').first();
    await red.fill('100');
    assert.equal(await page.locator('#color').inputValue(), previousColour, 'RGB adjustment waits for apply');
    assert.equal((await page.locator('.qrg-hex-input').inputValue()).slice(1, 3), '64');
    await page.locator('.qrg-hex-input').fill('invalid');
    await page.locator('.qrg-hex-apply').click();
    assert.equal(await page.locator('.qrg-hex-input').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('.qrg-hex-error').isVisible(), true);
    await page.locator('.qrg-hex-input').fill('#123ABC');
    await page.locator('.qrg-hex-apply').click();
    assert.equal((await page.locator('#color').inputValue()).toLowerCase(), '#123abc');
    await page.locator('#undo').click();
    assert.notEqual((await page.locator('#color').inputValue()).toLowerCase(), '#123abc');

    const sizeSelect = page.getByRole('combobox', { name: /^导出尺寸/ });
    const marginSelect = page.getByRole('combobox', { name: /^边距/ });
    assert.equal(await page.locator('#size').inputValue(), '1024');
    assert.equal(await page.locator('#margin').inputValue(), '4');
    assert.equal(await page.locator('#editor-form .qrg-stepper').count(), 0);
    assert.equal(await page.locator('.export-panel #size').count(), 1);
    assert.equal(await page.locator('.export-panel #margin').count(), 1);
    await sizeSelect.click();
    assert.deepEqual(await page.getByRole('option').allTextContents(), ['256 像素', '512 像素', '1024 像素', '2048 像素', '4096 像素']);
    await page.getByRole('option', { name: '512 像素', exact: true }).click();
    await sizeSelect.click();
    await page.getByRole('option', { name: '256 像素', exact: true }).click();
    await page.locator('#undo').click();
    assert.equal(await page.locator('#size').inputValue(), '512', 'each size selection can be undone');
    assert.match(await sizeSelect.getAttribute('aria-label'), /512 像素$/);
    await page.locator('#redo').click();
    assert.equal(await page.locator('#size').inputValue(), '256');
    assert.match(await sizeSelect.getAttribute('aria-label'), /256 像素$/);
    await marginSelect.click();
    assert.deepEqual(await page.getByRole('option').allTextContents(), ['0 个码点', '2 个码点', '4 个码点', '8 个码点']);
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#margin').inputValue(), '0');
    await page.locator('#undo').click();
    assert.equal(await page.locator('#margin').inputValue(), '4');
    assert.match(await marginSelect.getAttribute('aria-label'), /4 个码点$/);
    await page.locator('#redo').click();
    assert.equal(await page.locator('#margin').inputValue(), '0');
    await page.waitForFunction(() => !document.querySelector('#download-png').disabled, null, { timeout: 20000 });
    assert.equal(await page.locator('#preview-image').evaluate(image => image.naturalWidth), 256);
    const edgeInk = await page.locator('#preview-image').evaluate(image => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = image.naturalWidth;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const size = canvas.width;
      return [[0, 0, size, 1], [0, size - 1, size, 1], [0, 0, 1, size], [size - 1, 0, 1, size]]
        .map(edge => context.getImageData(...edge).data.some((value, index) => index % 4 < 3 && value < 200));
    });
    assert.deepEqual(edgeInk, [true, true, true, true], 'zero-margin preview must reach every image edge');

    const versionSelect = page.locator('#version').locator('xpath=following-sibling::button[1]');
    await versionSelect.click();
    assert.deepEqual(await page.getByRole('option').allTextContents(), ['自动选择', '1 · 21 × 21', '3 · 29 × 29', '5 · 37 × 37', '10 · 57 × 57']);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.qrg-listbox').count(), 0);

    assert.equal(await page.locator('#logo-options').isVisible(), false);
    await page.locator('#logo-file').setInputFiles('assets/icon.png');
    await page.locator('#apply-logo-crop').click();
    await page.locator('#remove-logo').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#logo-modules').isDisabled(), false);
    assert.equal(await page.locator('#logo-options').isVisible(), true);
    await page.setViewportSize({ width: 320, height: 568 });
    const logoGeometry = await geometry(page);
    assert.ok(logoGeometry.formOverflowX <= 1, `uploaded logo must not overflow horizontally: ${JSON.stringify(logoGeometry)}`);
    await page.locator('#logo-padding-modules').locator('xpath=following-sibling::button[1]').scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 1280, height: 720 });
    const logoSizeSelect = page.locator('#logo-modules').locator('xpath=following-sibling::button[1]');
    await logoSizeSelect.click();
    await page.getByRole('option', { name: '3 × 3 格' }).click();
    assert.equal(await page.locator('#logo-modules').inputValue(), '3');
    await page.locator('#remove-logo').click();
    assert.equal(await page.locator('#logo-options').isVisible(), false);

    await page.locator('#preview-image').waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('#download-png').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#download-png').disabled, null, { timeout: 20000 });
    for (const [selector, suffix] of [['#download-png', '.png'], ['#download-svg', '.svg']]) {
      const downloadPromise = page.waitForEvent('download');
      await page.locator(selector).click();
      const download = await downloadPromise;
      assert.ok(download.suggestedFilename().endsWith(suffix), `${selector}: wrong filename`);
      assert.equal(await download.failure(), null, `${selector}: failed download`);
    }
    assert.deepEqual(errors, [], `JavaScript errors: ${errors.join('; ')}`);
    process.stdout.write('interactions and downloads ok\n');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
