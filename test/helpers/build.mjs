// ABOUTME: Builds the theme against fixture content and returns rendered HTML per post.
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

  const pages = new Map();
  const postDir = join(out, 'post');
  if (!existsSync(postDir)) return pages;
  for (const slug of readdirSync(postDir)) {
    const file = join(postDir, slug, 'index.html');
    if (existsSync(file)) pages.set(slug, readFileSync(file, 'utf8'));
  }
  return pages;
}
