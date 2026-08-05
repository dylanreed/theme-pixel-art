// ABOUTME: Verifies the category sprite fallback chain resolves through real Hugo output.
// ABOUTME: Chain is category, then alias, then tags, then default.
import { test, before } from 'node:test';
import assert from 'node:assert';
import { buildFixtures } from './helpers/build.mjs';

let pages;
before(() => { pages = buildFixtures(); });

function spriteOf(slug) {
  const html = pages.get(slug);
  assert.ok(html, `no rendered page for ${slug}`);
  const m = html.match(/data-sprite="([^"]*)"/);
  assert.ok(m, `no data-sprite attribute in ${slug}`);
  return m[1];
}

test('known category resolves to itself', () => {
  assert.strictEqual(spriteOf('known-category'), 'gaming');
});

test('aliased category resolves through the alias map', () => {
  assert.strictEqual(spriteOf('aliased-category'), 'clown');
});

test('unknown category falls through to a resolvable tag', () => {
  assert.strictEqual(spriteOf('unknown-category-known-tag'), 'tabletop');
});

test('unknown category with no resolvable tag falls back to default', () => {
  assert.strictEqual(spriteOf('unknown-everything'), 'default');
});

test('post with no category at all falls back to default', () => {
  assert.strictEqual(spriteOf('no-category'), 'default');
});

test('category containing a space is normalised before lookup', () => {
  assert.strictEqual(spriteOf('spaced-category'), 'tabletop');
});
