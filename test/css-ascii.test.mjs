// ABOUTME: Guards CSS files against non-ASCII bytes in any position.
// ABOUTME: micro.blog's publish pipeline double-encodes them, so escapes are required.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';

test('no CSS file contains non-ASCII characters', () => {
  const offenders = [];
  for (const name of readdirSync('static/css').filter(f => f.endsWith('.css'))) {
    const text = readFileSync(`static/css/${name}`, 'utf8');
    text.split('\n').forEach((line, i) => {
      const bad = [...line].filter(ch => ch.codePointAt(0) > 127);
      if (bad.length) offenders.push(`${name}:${i + 1} ${JSON.stringify(bad.join(''))}`);
    });
  }
  assert.deepStrictEqual(offenders, [], `non-ASCII found:\n${offenders.join('\n')}`);
});
