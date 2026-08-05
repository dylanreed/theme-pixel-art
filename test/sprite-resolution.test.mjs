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

// taxonomy.html hands the partial a synthetic dict rather than a Page. Go
// templates return nil for a missing map key instead of erroring, so a
// context-dependent lookup silently no-ops there. Resolution must not care
// which kind of context it was handed.
test('taxonomy term page resolves a known category', () => {
  assert.strictEqual(spriteOf('categories/gaming'), 'gaming');
});

test('taxonomy term page resolves through the alias map', () => {
  assert.strictEqual(spriteOf('categories/clowning'), 'clown');
});

test('taxonomy term page falls back to default for an unknown term', () => {
  assert.strictEqual(spriteOf('categories/cryptid-cataloger'), 'default');
});

test('theme manifest is emitted with every theme key', () => {
  const html = pages.get('known-category');
  const m = html.match(/window\.SPRITE_MANIFEST\s*=\s*(\{.*?\});/s);
  assert.ok(m, 'SPRITE_MANIFEST not emitted');
  const manifest = JSON.parse(m[1]);
  for (const id of ['fantasy', 'sci-fi', 'cyberpunk', 'cabin', 'underwater']) {
    assert.ok(Array.isArray(manifest[id]), `${id} missing from manifest`);
  }
  assert.ok(manifest.fantasy.includes('gaming'), 'fantasy should list gaming');
  assert.ok(manifest.fantasy.includes('default'), 'fantasy should list default');
});

test('theme registry is emitted in cycle order', () => {
  const html = pages.get('known-category');
  const m = html.match(/window\.PIXEL_THEMES\s*=\s*(\[.*?\]);/s);
  assert.ok(m, 'PIXEL_THEMES not emitted');
  const themes = JSON.parse(m[1]);
  assert.strictEqual(themes[0].id, 'fantasy', 'fantasy must be first');
  assert.strictEqual(themes.length, 6);
  assert.ok(themes.some(t => t.id === 'kaiju'), 'kaiju must be in the registry');
});
