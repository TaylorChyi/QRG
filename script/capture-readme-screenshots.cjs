#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.QRG_PLAYWRIGHT_MODULE || '../build/browser-qa/node_modules/playwright-core');

const baseURL = process.env.QRG_SCREENSHOT_URL || 'https://qrg.taylorchyi.chatgpt.site/';
const output = process.env.QRG_SCREENSHOT_DIR || path.resolve(__dirname, '../assets/screenshots');
const executablePath = process.env.BROWSER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const locales = process.argv.slice(2).length ? process.argv.slice(2)
  : ['en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de'];
const allowed = new Set(['en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de']);
const content = 'https://qrg.taylorchyi.chatgpt.site';

async function ready(page) {
  await page.waitForFunction(() => {
    const image = document.getElementById('preview-image');
    return !document.getElementById('download-png').disabled
      && !document.getElementById('download-svg').disabled
      && !document.getElementById('preview-stage').classList.contains('is-loading')
      && image.complete && image.naturalWidth === 1024 && image.naturalHeight === 1024;
  }, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  assert.notEqual(await page.locator('#status').getAttribute('class'), 'preview-error');
}

async function capture(browser, locale) {
  const context = await browser.newContext({
    locale, colorScheme: 'dark', deviceScaleFactor: 1,
    viewport: { width: 602, height: 804 }, acceptDownloads: false,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const url = new URL(baseURL);
    url.searchParams.set('lang', locale);
    const response = await page.goto(url.href, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200, `${locale}: site must load`);
    await page.waitForFunction(value => document.documentElement.lang === value, locale);
    const previousPreview = await page.locator('#preview-image').getAttribute('src');
    await page.locator('#content').fill(content);
    await page.waitForFunction(previous => {
      const image = document.getElementById('preview-image');
      return image.src && image.getAttribute('src') !== previous;
    }, previousPreview, { timeout: 30000 });
    await ready(page);
    const renderedContent = await page.evaluate(async () => {
      const image = document.getElementById('preview-image');
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1024;
      canvas.getContext('2d').drawImage(image, 0, 0);
      const response = await window.QRGSite.fetch('/api/decode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: canvas.toDataURL('image/png') }),
      });
      if (!response.ok) throw new Error(`QR decode failed: ${response.status}`);
      return (await response.json()).content;
    });
    assert.equal(renderedContent, content, `${locale}: screenshot QR must contain the public Site URL`);
    await page.locator('#content').blur();
    await page.locator('button[data-view="editor"]').click();
    await page.waitForFunction(() => document.querySelector('.workspace').dataset.view === 'editor');
    assert.equal(await page.locator('#content').inputValue(), content);
    assert.equal(await page.locator('#theme').inputValue(), 'system');
    assert.equal(await page.locator('#language').inputValue(), locale);
    for (const [selector, expected] of [
      ['#module-shape', 'tile'], ['#eye-shape', 'rounded'], ['#image-shape', 'square'],
      ['#error-correction', 'H'], ['#version', 'auto'], ['#size', '1024'], ['#margin', '4'],
      ['#color', '#000000'], ['#background', '#ffffff'],
    ]) assert.equal(await page.locator(selector).inputValue(), expected, `${locale}: ${selector}`);
    assert.equal(await page.locator('#transparent').isChecked(), false);
    assert.equal(await page.locator('#logo-options').isVisible(), false);
    assert.equal(await page.locator('dialog[open]').count(), 0);
    assert.equal(await page.locator('.qrg-popup').count(), 0);

    const directory = path.join(output, locale);
    await fs.mkdir(directory, { recursive: true });
    const editor = path.join(directory, 'editor.jpg');
    await page.screenshot({ path: editor, type: 'jpeg', quality: 90, animations: 'disabled' });

    await page.locator('button[data-view="preview"]').click();
    await page.waitForFunction(() => document.querySelector('.workspace').dataset.view === 'preview');
    await ready(page);
    assert.equal(await page.locator('dialog[open]').count(), 0);
    assert.equal(await page.locator('.qrg-popup').count(), 0);
    const preview = path.join(directory, 'preview.jpg');
    await page.screenshot({ path: preview, type: 'jpeg', quality: 90, animations: 'disabled' });

    const audit = await page.evaluate(() => {
      const bounds = selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      };
      return {
        title: document.title, lang: document.documentElement.lang,
        language: document.getElementById('language').selectedOptions[0].textContent,
        editor: document.querySelector('button[data-view="editor"] span').textContent,
        preview: document.querySelector('button[data-view="preview"] span').textContent,
        png: document.querySelector('#download-png span').textContent,
        svg: document.querySelector('#download-svg span').textContent,
        qr: bounds('.preview-card'), pngButton: bounds('#download-png'), svgButton: bounds('#download-svg'),
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    assert.equal(audit.lang, locale);
    assert.ok(audit.qr.left >= -1 && audit.qr.right <= 603, `${locale}: QR preview fits`);
    assert.ok(audit.pngButton.left >= -1 && audit.pngButton.right <= 603, `${locale}: PNG button fits`);
    assert.ok(audit.svgButton.left >= -1 && audit.svgButton.right <= 603, `${locale}: SVG button fits`);
    assert.ok(audit.pngButton.bottom <= 804 && audit.svgButton.bottom <= 804,
      `${locale}: download buttons visible`);
    assert.ok(audit.pageOverflow <= 1, `${locale}: horizontal page overflow`);
    assert.deepEqual(errors, [], `${locale}: page scripts must not fail`);
    process.stdout.write(`${locale}: ${JSON.stringify(audit)}\n`);
    return { locale, editor, preview };
  } finally {
    await context.close();
  }
}

async function main() {
  for (const locale of locales) assert.ok(allowed.has(locale), `unsupported locale: ${locale}`);
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    for (const locale of locales) await capture(browser, locale);
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
