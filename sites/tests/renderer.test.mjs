import assert from 'node:assert/strict';
import test from 'node:test';
import { logoClearance, logoOptions, patternPositions, render } from '../src/renderer.js';

test('SVG render returns the original Web API metadata and a drawable QR', async () => {
  const response = await render({ content: 'https://example.com', format: 'svg' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/svg+xml');
  assert.equal(response.headers.get('X-QRG-Version'), '3');
  assert.equal(response.headers.get('X-QRG-Modules'), '29');
  assert.deepEqual(JSON.parse(response.headers.get('X-QRG-Logo-Options')),
    { 2: [0, 1, 2], 3: [0, 1, 2], 5: [0, 1, 2], 7: [0, 1, 2] });
  const svg = await response.text();
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<mask id="eye0">/);
  assert.match(svg, /<rect x="0" y="0" width="37" height="37"/);
});

test('fixed version reports minimum fitting version and oversized content fails cleanly', async () => {
  const overflow = await render({ content: 'A'.repeat(100), version: 1, format: 'svg' });
  assert.equal(overflow.status, 400);
  const details = await overflow.json();
  assert.equal(details.code, 'capacity_exceeded');
  assert.ok(details.minimum_version > 1);
  const tooLong = await render({ content: '界'.repeat(3000), format: 'svg' });
  assert.equal(tooLong.status, 400);
  assert.match((await tooLong.json()).error, /8192/);
});

test('unicode and markup in QR content never become SVG markup', async () => {
  const content = 'https://example.com/路径?<script>&emoji=🐟';
  const response = await render({ content, format: 'svg', module_shape: 'circle', image_shape: 'rounded' });
  assert.equal(response.status, 200);
  const svg = await response.text();
  assert.doesNotMatch(svg, /<script>|🐟|路径/);
  assert.match(svg, /<clipPath id="image-corners">/);
  assert.match(svg, /rx="0.5"/);
  assert.ok(Number(response.headers.get('X-QRG-Image-Corner-Radius')) > 0);
});

test('logo clearance keeps alignment and finder patterns clear', () => {
  assert.deepEqual(patternPositions(32), [6, 34, 60, 86, 112, 138]);
  assert.deepEqual(patternPositions(40), [6, 30, 58, 86, 114, 142, 170]);
  assert.throws(() => logoClearance([20, 20, 25, 25], 7, 45, 0), /定位结构/);
  assert.throws(() => logoClearance([1, 1, 4, 4], 1, 21, 0), /定位结构/);
  assert.deepEqual(logoClearance([9, 9, 12, 12], 1, 21, 1), [8, 8, 13, 13]);
  assert.deepEqual(logoOptions(1, 21), { 2: [0, 1, 2], 3: [0, 1, 2], 5: [0, 1] });
});
