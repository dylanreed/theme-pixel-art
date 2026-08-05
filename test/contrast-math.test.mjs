// ABOUTME: Unit tests for the WCAG contrast maths, isolated from the browser driver.
// ABOUTME: Runs without Puppeteer or a Hugo server, so it stays fast in the default suite.
import { test } from 'node:test';
import assert from 'node:assert';
import { relativeLuminance, ratio, parseColor, blend, required } from './helpers/contrast.mjs';

test('relativeLuminance of black is 0 and white is 1', () => {
  assert.strictEqual(relativeLuminance([0, 0, 0]), 0);
  assert.strictEqual(relativeLuminance([255, 255, 255]), 1);
});

test('ratio of black on white is the WCAG maximum, 21:1', () => {
  assert.ok(Math.abs(ratio([0, 0, 0], [255, 255, 255]) - 21) < 0.01);
});

test('ratio is symmetric regardless of argument order', () => {
  const a = ratio([20, 40, 60], [200, 210, 220]);
  const b = ratio([200, 210, 220], [20, 40, 60]);
  assert.ok(Math.abs(a - b) < 1e-9);
});

test('ratio of a colour against itself is 1:1', () => {
  assert.ok(Math.abs(ratio([100, 100, 100], [100, 100, 100]) - 1) < 1e-9);
});

test('parseColor reads rgb() as fully opaque', () => {
  assert.deepStrictEqual(parseColor('rgb(232, 220, 192)'), { r: 232, g: 220, b: 192, a: 1 });
});

test('parseColor reads rgba() alpha', () => {
  assert.deepStrictEqual(parseColor('rgba(139, 105, 20, 0.2)'), { r: 139, g: 105, b: 20, a: 0.2 });
});

test('parseColor returns null for unparseable input', () => {
  assert.strictEqual(parseColor('transparent'), null);
  assert.strictEqual(parseColor(''), null);
  assert.strictEqual(parseColor(undefined), null);
});

test('blend at alpha 1 returns the foreground untouched', () => {
  const fg = { r: 10, g: 20, b: 30, a: 1 };
  assert.deepStrictEqual(blend(fg, [200, 200, 200]), [10, 20, 30]);
});

test('blend at alpha 0 returns the background untouched', () => {
  const fg = { r: 10, g: 20, b: 30, a: 0 };
  assert.deepStrictEqual(blend(fg, [200, 200, 200]), [200, 200, 200]);
});

test('blend at alpha 0.5 is the midpoint', () => {
  const fg = { r: 0, g: 0, b: 0, a: 0.5 };
  const [r, g, b] = blend(fg, [200, 200, 200]);
  assert.ok(Math.abs(r - 100) < 1e-9 && Math.abs(g - 100) < 1e-9 && Math.abs(b - 100) < 1e-9);
});

test('required is 4.5:1 for normal body text', () => {
  assert.strictEqual(required(16, '400'), 4.5);
});

test('required drops to 3:1 at 24px regardless of weight', () => {
  assert.strictEqual(required(24, '400'), 3);
  assert.strictEqual(required(23.99, '400'), 4.5);
});

test('required drops to 3:1 at 18.66px only when bold (>=700)', () => {
  assert.strictEqual(required(18.66, '700'), 3);
  assert.strictEqual(required(18.66, '400'), 4.5);
  assert.strictEqual(required(18, '700'), 4.5);
});
