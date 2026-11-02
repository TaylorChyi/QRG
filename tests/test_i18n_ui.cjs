#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.QRG_PLAYWRIGHT_MODULE || 'playwright-core');
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8000';
const languages = { 'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English', ja: '日本語',
  ko: '한국어', es: 'Español', fr: 'Français', de: 'Deutsch' };

async function chooseLanguage(page, code) {
  await page.locator('#language + button').click();
  await page.locator('.qrg-listbox [role="option"]').filter({ hasText: languages[code] }).click();
  await page.waitForFunction(code => document.documentElement.lang === code, code);
  await page.waitForFunction(() => !document.getElementById('download-png').disabled);
}

async function main() {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const context = await browser.newContext({ locale: 'en-GB', acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(baseURL);
    await page.waitForFunction(() => !document.getElementById('download-png').disabled);
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('#language').inputValue(), 'auto');
    await page.locator('#content').fill('https://example.org/localised?keep=1');
    await page.waitForFunction(() => !document.getElementById('download-png').disabled);

    for (const code of Object.keys(languages)) {
      await chooseLanguage(page, code);
      const messages = code === 'zh-CN' ? {} : JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', `${code}.json`), 'utf8'));
      const t = source => messages[source] || source;
      assert.equal(await page.locator('label[for="color"]').textContent(), t('码颜色'));
      assert.equal(await page.locator('#download-png span').textContent(), t('导出 PNG'));
      assert.equal(await page.locator('#preview-image').getAttribute('alt'), t('生成的二维码预览'));
      assert.equal(await page.locator('#content').inputValue(), 'https://example.org/localised?keep=1');
      for (const [width, height] of [[1280, 800], [320, 568]]) {
        await page.setViewportSize({ width, height });
        for (const theme of ['light', 'dark']) {
          await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
          for (const view of ['editor', 'preview']) {
            if (await page.locator('.workspace-views').isVisible()) await page.locator(`[data-view="${view}"]`).first().click();
            const layout = await page.evaluate(() => {
              const root = document.documentElement;
              const top = document.querySelector('.topbar-controls').getBoundingClientRect();
              const brand = document.querySelector('.brand').getBoundingClientRect();
              const exported = document.querySelector('#download-png').getBoundingClientRect();
              return { overflow: root.scrollWidth - innerWidth, headerFits: top.right <= innerWidth && top.left >= brand.right,
                exportFits: !exported.width || exported.bottom <= innerHeight + 1 };
            });
            assert.ok(layout.overflow <= 1 && layout.headerFits && layout.exportFits,
              `${code} ${width} ${theme} ${view}: ${JSON.stringify(layout)}`);
          }
        }
      }
      if (await page.locator('.workspace-views').isVisible()) await page.locator('[data-view="editor"]').first().click();
      process.stdout.write(`${code}: translated controls, preserved input, light/dark desktop/mobile ok\n`);
    }

    await page.goto(baseURL);
    assert.equal(await page.locator('html').getAttribute('lang'), 'de', 'explicit choice survives navigation');
    await page.locator('#language + button').click();
    await page.locator('.qrg-listbox [role="option"]').first().click();
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en', 'browser language can be restored');
    assert.equal(await page.locator('#language').inputValue(), 'auto');

    await page.locator('.colour-field:has(#color) .qrg-colour-trigger').click();
    assert.equal(await page.locator('.qrg-colour-popup').getAttribute('aria-label'), 'Code colour picker');
    assert.ok((await page.locator('.qrg-rgb-row input').first().getAttribute('aria-label')).includes('Red'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('download-png').disabled);
    if (await page.locator('.workspace-views').isVisible()) await page.locator('[data-view="preview"]').first().click();
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#download-png').click();
    assert.equal((await downloadEvent).suggestedFilename(), 'qrg.png');

    await page.goto(`${baseURL}/?lang=ja`);
    await chooseLanguage(page, 'en');
    assert.equal(new URL(page.url()).searchParams.has('lang'), false, 'manual choice removes an outdated URL override');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    await page.route('**/api/i18n?*', route => route.abort());
    await page.locator('#language + button').click();
    await page.locator('.qrg-listbox [role="option"]').filter({ hasText: '日本語' }).click();
    await page.waitForFunction(() => document.getElementById('status').className === 'preview-error');
    assert.equal(await page.locator('html').getAttribute('lang'), 'en', 'failed catalogue request keeps current language');
    assert.equal(await page.locator('#language').inputValue(), 'en');
    assert.deepEqual(errors, []);
    process.stdout.write('persistence, automatic language, colour accessibility and export ok\n');
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
