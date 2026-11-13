import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const python = process.env.QRG_PYTHON || (existsSync(path.join(root, '.venv/bin/python')) ? path.join(root, '.venv/bin/python') : 'python3');
await mkdir(path.join(dist, 'static'), { recursive: true });
let html = execFileSync(python, [path.join(root, 'sites/export_index.py')], { cwd: root, encoding: 'utf8' });
html = html.replace('  <script src="/static/i18n.js" defer>', '  <script src="/static/site-runtime.js" defer></script>\n  <script src="/static/i18n.js" defer>');
if (!html.includes('/static/site-runtime.js')) throw new Error('The QRG template no longer has the expected script entry.');
await cp(path.join(root, 'web/static'), path.join(dist, 'static'), { recursive: true });
for (const name of ['app.js', 'qr-import.js', 'i18n.js']) {
  const destination = path.join(dist, 'static', name);
  let source = await readFile(destination, 'utf8');
  if (!source.includes('await fetch(')) throw new Error(`Missing API transport in ${name}`);
  source = source.replaceAll('await fetch(', 'await window.QRGSite.fetch(');
  if (name === 'i18n.js') {
    source = source.replace('window.QRGI18n.ready = Promise.resolve();', 'window.QRGI18n.ready = load(window.QRGSite.localePreference);');
  }
  await writeFile(destination, source);
}
await writeFile(path.join(dist, 'index.html'), html);
await cp(path.join(root, 'assets/icon.png'), path.join(dist, 'icon.png'));
await cp(path.join(root, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'), path.join(dist, 'static/zxing_reader.wasm'));
await build({
  entryPoints: [path.join(root, 'sites/src/runtime.js')],
  outfile: path.join(dist, 'static/site-runtime.js'),
  bundle: true, platform: 'browser', format: 'iife', target: ['es2022'],
  minify: true, legalComments: 'linked',
});
const notices = [];
for (const name of ['qrcode', 'dijkstrajs', 'zxing-wasm']) {
  const directory = path.join(root, 'node_modules', name);
  const licence = ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'license'].find(file => existsSync(path.join(directory, file)));
  if (licence) notices.push(`${name}\n${await readFile(path.join(directory, licence), 'utf8')}`);
}
notices.push(`ZXing-C++ and ZXingWasm.cpp\n${await readFile(path.join(root, 'sites/licenses/ZXING-APACHE-2.0.txt'), 'utf8')}`);
await writeFile(path.join(dist, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n'));
await writeFile(path.join(dist, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n');
console.log('Built browser-local QRG in dist/ (HTML, PNG/SVG renderer, QR reader and 8 languages).');
