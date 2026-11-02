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
const tabs = ['content', 'style', 'logo', 'advanced'];

async function geometry(page) {
  return page.evaluate(() => {
    const form = document.querySelector('#editor-form');
    const root = document.documentElement;
    const preview = document.querySelector('.preview-pane');
    const card = document.querySelector('.preview-card');
    const exportPanel = document.querySelector('.export-panel');
    const visible = element => getComputedStyle(element).display !== 'none';
    const within = element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1;
    };
    const controls = [...document.querySelectorAll('.editor-panel:not([hidden]) button, .editor-panel:not([hidden]) textarea, .editor-panel:not([hidden]) input:not(.qrg-native-control), .editor-panel:not([hidden]) .upload-button, .editor-panel:not([hidden]) .check-row')]
      .filter(element => visible(element) && !element.hidden);
    return {
      pageX: root.scrollWidth - innerWidth,
      pageY: root.scrollHeight - innerHeight,
      formScroll: form.scrollHeight - form.clientHeight,
      previewVisible: visible(preview),
      cardFits: !visible(preview) || within(card),
      exportFits: !visible(preview) || within(exportPanel),
      editorFits: within(form),
      clippedControls: controls.filter(element => !within(element)).map(element => element.id || element.className || element.tagName),
    };
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: browserPath,  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await page.locator('#preview-image').waitFor({ state: 'visible', timeout: 20000 });

    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      const narrow = await page.locator('.workspace-views').isVisible();
      for (const tab of tabs) {
        await page.locator(`#tab-${tab}`).click();
        const measure = await geometry(page);
        assert.ok(measure.pageX <= 1 && measure.pageY <= 1, `${width}×${height} ${tab}: page overflow ${JSON.stringify(measure)}`);
        assert.ok(measure.editorFits, `${width}×${height} ${tab}: editor clipped ${JSON.stringify(measure)}`);
        assert.ok(measure.formScroll <= 1, `${width}×${height} ${tab}: editor scroll ${JSON.stringify(measure)}`);
        assert.deepEqual(measure.clippedControls, [], `${width}×${height} ${tab}: controls clipped`);
        if (!narrow) {
          assert.ok(measure.cardFits && measure.exportFits, `${width}×${height} ${tab}: preview/export clipped ${JSON.stringify(measure)}`);
        }
      }
      if (narrow) {
        await page.locator('button[data-view="preview"]').click();
        const measure = await geometry(page);
        assert.ok(measure.pageX <= 1 && measure.pageY <= 1 && measure.cardFits && measure.exportFits,
          `${width}×${height}: preview/export clipped ${JSON.stringify(measure)}`);
        assert.ok(await page.locator('#download-png').isVisible(), `${width}×${height}: PNG export unavailable`);
        await page.locator('button[data-view="editor"]').click();
      }
      process.stdout.write(`layout ${width}×${height} ok\n`);
    }

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator('#tab-style').click();
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

    await page.locator('#tab-advanced').click();
    const sizeBefore = Number(await page.locator('#size').inputValue());
    await page.getByRole('button', { name: '导出尺寸（像素）增加' }).click();
    assert.equal(Number(await page.locator('#size').inputValue()), sizeBefore + 1);
    await page.locator('#size').fill('99999');
    assert.equal(await page.locator('#size').getAttribute('aria-invalid'), 'true');
    await page.locator('#size').blur();
    assert.equal(await page.locator('#size').getAttribute('aria-invalid'), 'false');
    assert.equal(await page.getByRole('button', { name: '导出尺寸（像素）增加' }).isEnabled(), true);

    const versionSelect = page.locator('#version').locator('xpath=following-sibling::button[1]');
    await versionSelect.click();
    assert.equal(await page.locator('.qrg-listbox [role="option"]').count(), 41);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.qrg-listbox').count(), 0);

    await page.locator('#tab-logo').click();
    await page.locator('#logo-file').setInputFiles('assets/icon.png');
    await page.locator('#apply-logo-crop').click();
    await page.locator('#remove-logo').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#logo-modules').isDisabled(), false);
    await page.setViewportSize({ width: 320, height: 568 });
    const logoGeometry = await geometry(page);
    assert.ok(logoGeometry.formScroll <= 1, `uploaded logo must fit: ${JSON.stringify(logoGeometry)}`);
    assert.deepEqual(logoGeometry.clippedControls, [], 'uploaded logo controls must remain visible');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator('#logo-modules').focus();
    for (let step = 0; step < 2; step += 1) await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#logo-modules-value').textContent(), '3 × 3 格');
    await page.locator('#remove-logo').click();
    assert.equal(await page.locator('#logo-modules').isDisabled(), true);

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
