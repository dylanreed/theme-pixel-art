// ABOUTME: Builds the theme against fixture content and returns rendered HTML per page.
// ABOUTME: Lets tests assert on real Hugo output instead of mocking template logic.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function buildFixtures() {
  const out = mkdtempSync(join(tmpdir(), 'pixel-art-test-'));
  const root = resolve('.');
  execFileSync('hugo', [
    '--quiet',
    '--source', root,
    '--contentDir', 'test/fixtures/content',
    '--destination', out,
  ], { stdio: 'pipe' });

  // Post pages are keyed by slug; taxonomy term pages by "categories/<term>"
  // so tests can cover both the real Page context and the synthetic dict
  // context that taxonomy.html builds.
  const pages = new Map();
  collect(join(out, 'post'), '', pages);
  collect(join(out, 'categories'), 'categories/', pages);
  return pages;
}

function collect(dir, prefix, pages) {
  if (!existsSync(dir)) return;
  for (const slug of readdirSync(dir)) {
    const file = join(dir, slug, 'index.html');
    if (existsSync(file)) pages.set(prefix + slug, readFileSync(file, 'utf8'));
  }
}
