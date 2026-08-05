# Theme Registry, Sprite Fallbacks, and AA Contrast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the theme system's triplicated configuration into data-file
sources of truth, give category sprites a real fallback chain, ship the kaiju
theme, and bring every colour to WCAG AA.

**Architecture:** Hugo resolves at build time what it can see on disk (which sprite
files exist) and emits a manifest so the browser can resolve at runtime what only it
knows (which theme the reader picked). Two data files — `data/themes.json` and
`data/sprite-aliases.json` — replace literals currently duplicated across four JS
and template locations.

**Tech Stack:** Hugo 0.152 (extended), vanilla JS, plain CSS, Node 25 with the
built-in `node:test` runner, Puppeteer for DOM contrast measurement.

## Global Constraints

- Every file created must open with two `ABOUTME: ` comment lines, per CLAUDE.md.
- Never use `--no-verify` when committing.
- `fantasy` is the default theme and the only one that applies no `html` class.
  Nothing may change that.
- All CSS `content` values must be pure ASCII using unicode escapes. See Task 1 for
  why: micro.blog's publish pipeline double-encodes non-ASCII bytes.
- Hex escapes in CSS `content` consume a following whitespace character as the escape
  terminator. To emit a literal space next to an escape, write `\0020`, never a
  bare space.
- WCAG AA targets: 4.5:1 for body text, 3:1 for large text (≥24px, or ≥18.66px bold)
  and UI components.
- Existing sprite base names are the canonical vocabulary: `adhd, clown, cooking,
  crafting, default, gaming, health, music, notes, personal, pets, reading, tabletop,
  tech, travel, writing`.
- Do not commit the untracked `assets/` directory. Its placement is an open question
  tracked as `theme-pixel-art-iqc`.

## File Structure

| File | Responsibility |
|---|---|
| `data/themes.json` | Ordered theme registry: id, name, icon |
| `data/sprite-aliases.json` | Taxonomy term → sprite base name |
| `layouts/partials/sprite-name.html` | Resolve a page to a sprite base name |
| `layouts/partials/theme-data.html` | Emit `window.PIXEL_THEMES` + `window.SPRITE_MANIFEST` |
| `test/helpers/build.mjs` | Build a Hugo fixture site, return rendered HTML |
| `test/helpers/contrast.mjs` | WCAG luminance and ratio maths |
| `test/sprite-resolution.test.mjs` | Fallback chain assertions |
| `test/contrast.test.mjs` | Full matrix contrast audit |
| `test/fixtures/` | Hugo content exercising each fallback branch |

---

### Task 1: Fix the Read more arrow

Independent of everything else. Do it first for a quick green.

**Files:**
- Modify: `static/css/style.css:981`, `static/css/style.css:1688`
- Modify: `static/css/chaos.css:1417`
- Modify: `static/css/themes.css:493`
- Modify: `layouts/index.html:83`, `layouts/_default/list.html:67`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by later tasks

**Background — read this before editing.** The local CSS is correct UTF-8. The
*deployed* CSS at `https://dylan.blog/css/style.css:981` contains
`C3 A2 E2 80 A0 E2 80 99`, which is UTF-8(latin1(`E2 86 92`)) — the arrow bytes
re-encoded a second time. Git history and `theme-pixel-art.zip` are both clean, so
micro.blog's publish pipeline introduces the corruption. `@charset "UTF-8"` cannot
help, because the served bytes are already wrong and the header already says
`charset=utf-8`. ASCII escapes are the only durable fix.

Separately, the markup already emits `Read more &rarr;`, so a correct arrow in CSS
would produce two. Keep the CSS one (single place, themeable) and drop the entity.

- [ ] **Step 1: Write the failing test**

Create `test/css-ascii.test.mjs`:

```js
// ABOUTME: Guards CSS content values against non-ASCII bytes.
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/css-ascii.test.mjs
```

Expected: FAIL, listing the four `content:` lines plus the `═` box-drawing
characters used in section-divider comments.

- [ ] **Step 3: Replace the four content values**

`static/css/style.css:981` — note the leading space is literal, the escape is last:

```css
.post-link::after {
    content: " \2192";
}
```

`static/css/style.css:1688` — `\0020` for the spaces, because a bare space would be
eaten as the escape terminator:

```css
    content: "\2694\0020\2726\0020\2694";
```

`static/css/chaos.css:1417`:

```css
    content: "\2753\0020HELP\0020\2753";
```

`static/css/themes.css:493`:

```css
    content: "\25CB";
```

- [ ] **Step 4: Replace non-ASCII in comments**

The test also flags `═` in section-divider comments. Replace those runs of `═` with
`=` throughout the CSS files. They are decorative only.

```bash
sed -i '' 's/═/=/g' static/css/*.css
```

- [ ] **Step 5: Drop the duplicate arrow from markup**

`layouts/index.html:83` and `layouts/_default/list.html:67`, both become:

```html
                <a href="{{ .Permalink }}" class="post-link">Read more</a>
```

- [ ] **Step 6: Run the test and confirm it passes**

```bash
node --test test/css-ascii.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Verify the rendered result**

```bash
hugo --quiet && grep -o 'class="post-link">[^<]*<' public/index.html | head -3
```

Expected: `class="post-link">Read more<` — one arrow, contributed by CSS.

- [ ] **Step 8: Commit**

```bash
git add static/css layouts/index.html layouts/_default/list.html test/css-ascii.test.mjs
git commit -m "fix: escape non-ASCII CSS content and drop duplicate Read more arrow

micro.blog's publish pipeline re-encodes UTF-8 bytes a second time, so the
deployed stylesheet served a mojibaked arrow even though the source was clean.
ASCII escapes cannot be corrupted by re-encoding.

Closes theme-pixel-art-au1"
```

---

### Task 2: Test harness scaffold

**Files:**
- Create: `package.json`
- Create: `test/helpers/build.mjs`
- Create: `test/fixtures/config.json`
- Create: `test/fixtures/content/post/known-category.md`

**Interfaces:**
- Consumes: nothing
- Produces: `buildFixtures()` → `Promise<Map<string, string>>` mapping a post slug to
  its rendered HTML. Used by Task 3.

- [ ] **Step 1: Create package.json**

No runtime dependencies. Puppeteer arrives in Task 8.

```json
{
  "name": "theme-pixel-art",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/",
    "test:contrast": "node --test test/contrast.test.mjs"
  }
}
```

- [ ] **Step 2: Create the fixture site config**

`test/fixtures/config.json`:

```json
{
  "title": "fixture",
  "baseURL": "http://localhost/",
  "markup": { "goldmark": { "renderer": { "unsafe": true } } }
}
```

- [ ] **Step 3: Create the first fixture post**

`test/fixtures/content/post/known-category.md`:

```markdown
---
title: Known Category
date: 2026-01-01
categories: [gaming]
---

Body text.
```

- [ ] **Step 4: Write the build helper**

`test/helpers/build.mjs`:

```js
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
```

- [ ] **Step 5: Verify the harness builds something**

```bash
node -e "import('./test/helpers/build.mjs').then(m => console.log([...m.buildFixtures().keys()]))"
```

Expected: `[ 'known-category' ]`. If Hugo errors, read the message — do not add
`--ignoreErrors`.

- [ ] **Step 6: Commit**

```bash
git add package.json test/
git commit -m "test: add Hugo fixture build harness

Repo had no test infrastructure. Uses the Node built-in test runner so
this adds zero runtime dependencies.

Refs theme-pixel-art-2hp"
```

---

### Task 3: Data files and the sprite resolver

**Files:**
- Create: `data/themes.json`
- Create: `data/sprite-aliases.json`
- Create: `layouts/partials/sprite-name.html`
- Create: `test/sprite-resolution.test.mjs`
- Create: 5 more fixture posts under `test/fixtures/content/post/`
- Modify: `layouts/partials/post-sprite.html`

**Interfaces:**
- Consumes: `buildFixtures()` from Task 2
- Produces: `partial "sprite-name.html" .` returns a sprite base name as a string,
  never a path, never an empty string. `post-sprite.html` emits it as `data-sprite`.

- [ ] **Step 1: Write the failing test**

`test/sprite-resolution.test.mjs`:

```js
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
```

- [ ] **Step 2: Create the five remaining fixtures**

`test/fixtures/content/post/aliased-category.md`:

```markdown
---
title: Aliased Category
date: 2026-01-02
categories: [clowning]
---
Body.
```

`test/fixtures/content/post/unknown-category-known-tag.md`:

```markdown
---
title: Unknown Category Known Tag
date: 2026-01-03
categories: [cryptid-cataloger]
tags: [warhammer]
---
Body.
```

`test/fixtures/content/post/unknown-everything.md`:

```markdown
---
title: Unknown Everything
date: 2026-01-04
categories: [cryptid-cataloger]
tags: [nonsense]
---
Body.
```

`test/fixtures/content/post/no-category.md`:

```markdown
---
title: No Category
date: 2026-01-05
---
Body.
```

`test/fixtures/content/post/spaced-category.md`:

```markdown
---
title: Spaced Category
date: 2026-01-06
categories: ["blood bowl"]
---
Body.
```

- [ ] **Step 3: Run the test and watch it fail**

```bash
node --test test/sprite-resolution.test.mjs
```

Expected: FAIL. `known-category` currently yields `gaming` and passes, but
`aliased-category` yields `clowning` (the existing inline map only handles it by
luck of a different key), and the unknown cases yield the raw category name.

- [ ] **Step 4: Create data/themes.json**

Order drives the theme-cycle button. Kaiju is appended in Task 6, not here.

```json
[
  { "id": "fantasy",    "name": "Fantasy",    "icon": "/modes/fantasy.webp" },
  { "id": "sci-fi",     "name": "Sci-Fi",     "icon": "/modes/sci-fi.webp" },
  { "id": "cyberpunk",  "name": "Cyberpunk",  "icon": "/modes/cyberpunk.webp" },
  { "id": "cabin",      "name": "Cabin",      "icon": "/modes/cabin.webp" },
  { "id": "underwater", "name": "Underwater", "icon": "/modes/underwater.webp" }
]
```

- [ ] **Step 5: Create data/sprite-aliases.json**

Keys are `urlize`d taxonomy terms. Values must be canonical sprite base names.

```json
{
  "clowning": "clown",
  "food": "cooking",
  "books": "reading",
  "magpies-library": "reading",
  "magpie-book-club": "reading",
  "warhammer": "tabletop",
  "blood-bowl": "tabletop",
  "yarn": "crafting",
  "serial": "writing",
  "side-projects": "tech",
  "productivity": "adhd",
  "muppets": "personal"
}
```

`muppets` is the third-largest tag on the blog at 30 posts and had no sprite of
its own, so it resolved to `default`. `personal` is the established catch-all.
Because that makes `muppets` resolvable, the fixtures below use
`cryptid-cataloger` — which has no sprite and no alias — wherever the test needs a
genuinely unresolvable term.

- [ ] **Step 6: Write the resolver partial**

`layouts/partials/sprite-name.html`:

Two syntax traps to be aware of, both already handled below. First,
`.Site.Data.sprite-aliases` is invalid Go template syntax because of the hyphen —
`index .Site.Data "sprite-aliases"` is required. Second, Hugo's `append` puts the
piped value last, so `$terms | append .` where `.` is the tags slice nests the slice
as a single element rather than concatenating it. Build the term list by ranging
explicitly.

```go-html-template
{{- /* ABOUTME: Resolves a page to a category sprite base name. */ -}}
{{- /* ABOUTME: Chain is category, then alias map, then tags, then default. */ -}}
{{- $aliases := index .Site.Data "sprite-aliases" | default dict -}}
{{- $available := slice -}}
{{- range readDir "static/fantasy/sprites/category" -}}
    {{- if strings.HasSuffix .Name ".png" -}}
        {{- $available = $available | append (strings.TrimSuffix ".png" .Name) -}}
    {{- end -}}
{{- end -}}

{{- /* Ordered candidate terms: first category, then every tag. */ -}}
{{- $terms := slice -}}
{{- with .Params.categories -}}
    {{- $terms = $terms | append (index . 0) -}}
{{- end -}}
{{- with .Params.tags -}}
    {{- range . -}}
        {{- $terms = $terms | append . -}}
    {{- end -}}
{{- end -}}

{{- $resolved := "" -}}
{{- range $terms -}}
    {{- if not $resolved -}}
        {{- $key := . | urlize -}}
        {{- with index $aliases $key -}}{{- $key = . -}}{{- end -}}
        {{- if in $available $key -}}{{- $resolved = $key -}}{{- end -}}
    {{- end -}}
{{- end -}}

{{- if not $resolved -}}{{- $resolved = "default" -}}{{- end -}}
{{- return $resolved -}}
```

- [ ] **Step 7: Rewrite post-sprite.html to use it**

Replace the whole file:

```go-html-template
{{- /* ABOUTME: Renders the animated category sprite for a post. */ -}}
{{- /* ABOUTME: Sprite name is resolved at build time; chaos.js swaps the theme path. */ -}}
{{ $category := "" }}
{{ with .Params.categories }}{{ $category = index . 0 | lower }}{{ end }}

{{ $isArchive := false }}
{{ if not .IsPage }}
    {{ if .isArchive }}{{ $isArchive = true }}{{ end }}
{{ end }}

{{ $spriteFile := partial "sprite-name.html" . }}

<div class="{{ if $isArchive }}archive-sprite{{ else }}post-sprite{{ end }} theme-sprite-6x3" data-category="{{ $category }}" data-sprite="{{ $spriteFile }}">
    <img src="/fantasy/sprites/category/{{ $spriteFile }}.png" alt="Animated sprite for {{ $category | default "default" }} category">
</div>
```

- [ ] **Step 8: Run the test and confirm it passes**

```bash
node --test test/sprite-resolution.test.mjs
```

Expected: all 6 PASS. If `spaced-category` fails, confirm `urlize` turned
`blood bowl` into `blood-bowl` and that the alias key matches exactly.

- [ ] **Step 9: Confirm the real site still builds**

```bash
hugo --quiet && echo BUILD OK
```

- [ ] **Step 10: Commit**

```bash
git add data/ layouts/partials/sprite-name.html layouts/partials/post-sprite.html test/
git commit -m "feat: resolve category sprites through a fallback chain

Unknown categories emitted paths to files that do not exist. Resolution now
runs category, alias, tags, default at build time against the real sprite
directory, so a miss is impossible.

Closes theme-pixel-art-xsf"
```

---

### Task 4: Theme manifest partial

**Files:**
- Create: `layouts/partials/theme-data.html`
- Modify: `layouts/partials/head.html` (add the partial call before the CSS links)

**Interfaces:**
- Consumes: `data/themes.json` from Task 3
- Produces: two browser globals.
  `window.PIXEL_THEMES` is `Array<{id: string, name: string, icon: string}>` in cycle order.
  `window.SPRITE_MANIFEST` is `Record<themeId, string[]>` of available sprite base names.

- [ ] **Step 1: Write the failing test**

Append to `test/sprite-resolution.test.mjs`:

```js
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
  assert.strictEqual(themes.length, 5);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test test/sprite-resolution.test.mjs
```

Expected: FAIL with "SPRITE_MANIFEST not emitted".

- [ ] **Step 3: Write the partial**

`layouts/partials/theme-data.html`:

```go-html-template
{{- /* ABOUTME: Emits the theme registry and per-theme sprite manifest as browser globals. */ -}}
{{- /* ABOUTME: Hugo can see the filesystem; the browser cannot, so it gets told. */ -}}
{{- $themes := .Site.Data.themes -}}
{{- $manifest := dict -}}
{{- range $themes -}}
    {{- $names := slice -}}
    {{- $dir := printf "static/%s/sprites/category" .id -}}
    {{- if fileExists $dir -}}
        {{- range readDir $dir -}}
            {{- if strings.HasSuffix .Name ".png" -}}
                {{- $names = $names | append (strings.TrimSuffix ".png" .Name) -}}
            {{- end -}}
        {{- end -}}
    {{- end -}}
    {{- $manifest = merge $manifest (dict .id $names) -}}
{{- end -}}
<script>
window.PIXEL_THEMES = {{ $themes | jsonify }};
window.SPRITE_MANIFEST = {{ $manifest | jsonify }};
</script>
```

- [ ] **Step 4: Wire it into head.html**

Insert immediately before line 105 (`<link rel="stylesheet" href="/css/style.css">`):

```go-html-template
{{ partial "theme-data.html" . }}
```

- [ ] **Step 5: Run the test and confirm it passes**

```bash
node --test test/sprite-resolution.test.mjs
```

Expected: all PASS. `manifest['fantasy']` should hold 16 names; corporate, kaiju and
western are not in `themes.json` yet so they will not appear.

- [ ] **Step 6: Commit**

```bash
git add layouts/partials/theme-data.html layouts/partials/head.html test/
git commit -m "feat: emit theme registry and sprite manifest to the browser

Refs theme-pixel-art-gxe"
```

---

### Task 5: Migrate chaos.js and baseof.html to the registry

**Files:**
- Modify: `static/js/chaos.js:571-591` (`getCurrentTheme`, `getThemeSpriteSheet`)
- Modify: `static/js/chaos.js:781-892` (`updateCategorySprites`)
- Modify: `layouts/_default/baseof.html:72-86` (theme literals)

**Interfaces:**
- Consumes: `window.PIXEL_THEMES`, `window.SPRITE_MANIFEST` from Task 4
- Produces: `spriteUrl(theme, name)` → `string`, an absolute path that is guaranteed
  to exist given a correct manifest.

- [ ] **Step 1: Replace getCurrentTheme**

`static/js/chaos.js`, replacing lines 571-578:

```js
    function getCurrentTheme() {
        const html = document.documentElement;
        const themes = window.PIXEL_THEMES || [];
        for (const t of themes) {
            if (t.id !== 'fantasy' && html.classList.contains('theme-' + t.id)) return t.id;
        }
        return 'fantasy';
    }
```

- [ ] **Step 2: Add the manifest-backed URL resolver**

Insert directly above `updateCategorySprites`, replacing the entire `themeSprites`
literal and the `categories` array (lines 781-874):

```js
    // Resolve a sprite name to a path for a theme, degrading through the
    // theme's own default and then fantasy. Never returns a 404 path so
    // long as fantasy/default.png exists.
    function spriteUrl(theme, name) {
        const manifest = window.SPRITE_MANIFEST || {};
        const have = manifest[theme] || [];
        if (have.includes(name)) return '/' + theme + '/sprites/category/' + name + '.png';
        if (have.includes('default')) return '/' + theme + '/sprites/category/default.png';
        const fantasy = manifest.fantasy || [];
        if (fantasy.includes(name)) return '/fantasy/sprites/category/' + name + '.png';
        return '/fantasy/sprites/category/default.png';
    }
```

- [ ] **Step 3: Rewrite updateCategorySprites**

```js
    function updateCategorySprites() {
        const theme = getCurrentTheme();
        document.querySelectorAll('[data-sprite]').forEach(container => {
            const img = container.querySelector('img');
            if (!img) return;
            img.src = spriteUrl(theme, container.dataset.sprite);
            container.classList.add('theme-sprite-6x3');
        });
    }
```

Note the selector changed from `[data-category]` to `[data-sprite]`. The old code
early-returned for themes absent from its map, which is exactly the bug that made
corporate, kaiju and western silently serve fantasy art.

- [ ] **Step 4: Drive getThemeSpriteSheet from the manifest shape**

Replace lines 580-591. Falling-sprite sheets have inconsistent filenames, so keep an
explicit map but fall back rather than assume:

```js
    function getThemeSpriteSheet(theme) {
        const spriteFiles = {
            'fantasy': '/fantasy/sprites/falling/falling.png',
            'sci-fi': '/sci-fi/sprites/falling/falling_sprites.png',
            'cyberpunk': '/cyberpunk/sprites/falling/falling.png',
            'cabin': '/cabin/sprites/falling/falling_sprites.png',
            'underwater': '/underwater/sprites/falling/falling_sprites.png'
        };
        return spriteFiles[theme] || spriteFiles['fantasy'];
    }
```

- [ ] **Step 5: Drive baseof.html from the registry**

Replace `layouts/_default/baseof.html` lines 72-86:

```js
            const themes = (window.PIXEL_THEMES || []).map(t => t.id);
            const themeNames = Object.fromEntries((window.PIXEL_THEMES || []).map(t => [t.id, t.name]));
            const themeIcons = Object.fromEntries((window.PIXEL_THEMES || []).map(t => [t.id, t.icon]));
```

- [ ] **Step 6: Verify in a real browser**

```bash
hugo server --port 1337 &
```

Open `http://localhost:1337`, then in the console:

```js
window.SPRITE_MANIFEST.fantasy.length   // expect 16
document.querySelector('[data-sprite]').dataset.sprite
```

Cycle the theme button through all five and confirm sprites swap and no image 404s
appear in the Network tab. Then stop the server.

- [ ] **Step 7: Commit**

```bash
git add static/js/chaos.js layouts/_default/baseof.html
git commit -m "refactor: drive theme and sprite resolution from the manifest

Deletes six hardcoded per-theme sprite maps. The old code early-returned for
themes missing from its map, which is why corporate, kaiju and western
silently served fantasy sprites.

Closes theme-pixel-art-gxe"
```

---

### Task 6: Implement the kaiju theme

**Files:**
- Modify: `data/themes.json`
- Modify: `static/css/themes.css` (append a kaiju block; extend the easy-read
  selector list at line 1503)

**Interfaces:**
- Consumes: `data/themes.json` from Task 3
- Produces: an `html.theme-kaiju` CSS surface matching the structure cabin uses

**Palette**, sampled from `static/kaiju/headers/default.png` — a night street scene
with a crimson cinema marquee, amber bulbs, and a cyan screen. All values below were
measured against the panel colour and clear AA:

| Token | Value | On panel |
|---|---|---|
| `--kaiju-bg` | `#0b1416` | — |
| `--kaiju-panel` | `#16242a` | — |
| `--kaiju-border` | `#8b1a1a` | — |
| `--kaiju-text` | `#e8dcc0` | 11.69:1 |
| `--kaiju-heading` | `#ffc94a` | 10.38:1 |
| `--kaiju-link` | `#7fd4d6` | 9.31:1 |
| `--kaiju-hot` | `#ff5533` | 5.00:1 |
| `--kaiju-muted` | `#9ab0b3` | 7.00:1 |

- [ ] **Step 1: Add kaiju to the registry**

Append to `data/themes.json`:

```json
  { "id": "kaiju", "name": "Kaiju", "icon": "/modes/kaiju.webp" }
```

`/modes/kaiju.webp` does not exist yet. `applyThemeStyle` already installs an
`onerror` handler that falls back to `/modes/fantasy.webp`, so this degrades
cleanly. The art is tracked as `theme-pixel-art-vze`.

- [ ] **Step 2: Add kaiju to the easy-read selector list**

This is the hazard from the spec. At `static/css/themes.css:1503`, the easy-read
white-container rule enumerates theme classes purely to out-specify per-theme rules.
Add these four selectors to that list before adding any kaiju rules:

```css
html.easy-read.theme-kaiju .posts-container::before,
html.easy-read.theme-kaiju .post-container::before,
html.easy-read.theme-kaiju .page-container::before,
html.easy-read.theme-kaiju .archive-container::before,
```

Add the same `.theme-kaiju` variants to the `.h-feed::before`,
`.photos-grid-container::before` and `.archive_categories::before` groups in that
same rule.

- [ ] **Step 3: Append the kaiju theme block**

At the end of `static/css/themes.css`:

```css
/* ===============================================================
   KAIJU - Night street, cinema marquee, city-scale trouble
   =============================================================== */

html.theme-kaiju {
    --kaiju-bg: #0b1416;
    --kaiju-panel: #16242a;
    --kaiju-border: #8b1a1a;
    --kaiju-text: #e8dcc0;
    --kaiju-heading: #ffc94a;
    --kaiju-link: #7fd4d6;
    --kaiju-hot: #ff5533;
    --kaiju-muted: #9ab0b3;
}

html.theme-kaiju body {
    background: url("/kaiju/backgrounds/3.png");
    background-size: 75%;
    background-repeat: repeat;
}

html.theme-kaiju.night body {
    background: url("/kaiju/backgrounds/3_night.png");
    background-size: 75%;
    background-repeat: repeat;
}

html.theme-kaiju .posts-container::before,
html.theme-kaiju .post-container::before,
html.theme-kaiju .page-container::before,
html.theme-kaiju .archive-container::before,
html.theme-kaiju .h-feed::before,
html.theme-kaiju .photos-grid-container::before,
html.theme-kaiju .archive_categories::before {
    background: var(--kaiju-panel);
    background-image: none;
}

html.theme-kaiju body,
html.theme-kaiju .post-content,
html.theme-kaiju .page-content,
html.theme-kaiju .post-excerpt,
html.theme-kaiju article p {
    color: var(--kaiju-text);
}

html.theme-kaiju .post-content h2,
html.theme-kaiju .post-content h3,
html.theme-kaiju .post-title,
html.theme-kaiju .post-title a,
html.theme-kaiju .page-title,
html.theme-kaiju .category-title,
html.theme-kaiju .year-header {
    color: var(--kaiju-heading);
}

html.theme-kaiju .post-content a,
html.theme-kaiju .page-content a {
    color: var(--kaiju-link);
    text-decoration-color: rgba(127, 212, 214, 0.5);
}

html.theme-kaiju .post-meta,
html.theme-kaiju .note-date,
html.theme-kaiju .post-counter,
html.theme-kaiju .pagination {
    color: var(--kaiju-muted);
}

/* Marquee button */
html.theme-kaiju .post-link {
    background: linear-gradient(180deg, #8b1a1a 0%, #5e1010 100%);
    border: 3px solid var(--kaiju-hot);
    color: var(--kaiju-heading);
    box-shadow:
        inset 1px 1px 0 rgba(255, 201, 74, 0.35),
        inset -1px -1px 0 rgba(0, 0, 0, 0.4),
        0 0 12px rgba(255, 85, 51, 0.25),
        2px 2px 0 rgba(0, 0, 0, 0.3);
    border-radius: 2px;
}

html.theme-kaiju .post-link:hover {
    background: linear-gradient(180deg, #a52020 0%, #741414 100%);
    color: #fff3d0;
    box-shadow:
        inset 1px 1px 0 rgba(255, 201, 74, 0.5),
        inset -1px -1px 0 rgba(0, 0, 0, 0.4),
        0 0 18px rgba(255, 85, 51, 0.4),
        3px 3px 0 rgba(0, 0, 0, 0.3);
}

html.theme-kaiju .post-link:active {
    background: linear-gradient(180deg, #5e1010 0%, #8b1a1a 100%);
    box-shadow:
        inset -1px -1px 0 rgba(255, 201, 74, 0.3),
        inset 1px 1px 0 rgba(0, 0, 0, 0.4),
        1px 1px 0 rgba(0, 0, 0, 0.3);
}

html.theme-kaiju .header-image {
    background-image: url("/kaiju/headers/default.png");
}

html.theme-kaiju .note-scroll .note-content {
    color: var(--kaiju-text);
}
```

- [ ] **Step 4: Verify kaiju appears and renders**

```bash
hugo server --port 1337 &
```

Cycle the theme button to Kaiju. Confirm: background swaps, panel goes dark teal,
headings go amber, the Read more button reads as a cinema marquee, and the icon
falls back to the fantasy sprite without a console error. Then toggle easy-read and
confirm the container turns white — if it stays dark, Step 2 was incomplete.

- [ ] **Step 5: Commit**

```bash
git add data/themes.json static/css/themes.css
git commit -m "feat: implement the kaiju theme

Palette sampled from the existing kaiju header art and verified against AA
before use. Adds kaiju to the easy-read specificity enumeration so easy-read
still wins on this theme.

Closes theme-pixel-art-xzc"
```

---

### Task 7: Fix night-mode heading contrast

**Files:**
- Modify: `static/css/style.css` (append night and easy-read heading rules)

**Interfaces:**
- Consumes: nothing
- Produces: nothing

Measured: `#4a3020` on the night container `#3b454d` is **1.24:1**, against an AA
large-text floor of 3:1. On white the same brown is 12.11:1, which is why the bug
only appears at night. `#e8c9a0` on `#3b454d` measures **6.20:1** and clears even the
stricter body-text threshold.

- [ ] **Step 1: Append the night heading rule**

At the end of `static/css/style.css`:

```css
/* Night mode headings - the base brown is 1.24:1 on the night panel */
html.night .post-content h2,
html.night .post-content h3,
html.night .post-content h4,
html.night .post-content h5,
html.night .post-content h6,
html.night .page-content h2,
html.night .page-content h3 {
    color: #e8c9a0;
}

/* Easy-read never set heading colours, so they inherited the theme brown */
html.easy-read .post-content h2,
html.easy-read .post-content h3,
html.easy-read .post-content h4,
html.easy-read .post-content h5,
html.easy-read .post-content h6,
html.easy-read .page-content h2,
html.easy-read .page-content h3 {
    color: var(--corp-text) !important;
}
```

- [ ] **Step 2: Verify visually**

```bash
hugo server --port 1337 &
```

Open a post with `##` headings. Toggle night mode: headings must read as warm
parchment, not brown-on-grey. Toggle easy-read: headings must read as dark grey on
white.

- [ ] **Step 3: Commit**

```bash
git add static/css/style.css
git commit -m "fix: give headings a readable colour in night and easy-read modes

The heading rules hardcoded #4a3020 and neither mode overrode them. On the
night panel #3b454d that measured 1.24:1 against an AA floor of 3:1.
#e8c9a0 measures 6.20:1.

Closes theme-pixel-art-t1t"
```

---

### Task 8: Contrast harness and full AA audit

**Files:**
- Create: `test/helpers/contrast.mjs`
- Create: `test/contrast.test.mjs`
- Modify: `package.json` (add puppeteer)
- Modify: CSS files as failures dictate

**Interfaces:**
- Consumes: every theme shipped in `data/themes.json`
- Produces: `ratio(fg, bg)` → `number`; `audit(page)` → `Array<{selector, fg, bg,
  ratio, needed}>` listing only failures

- [ ] **Step 1: Add puppeteer**

```bash
npm install --save-dev puppeteer
```

- [ ] **Step 2: Write the contrast maths helper**

`test/helpers/contrast.mjs`:

```js
// ABOUTME: WCAG relative luminance and contrast ratio maths.
// ABOUTME: Kept separate from the browser driver so the maths is unit-testable.
export function relativeLuminance([r, g, b]) {
  const f = v => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function ratio(fg, bg) {
  const a = relativeLuminance(fg), b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function parseRgb(str) {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map(s => parseFloat(s.trim()));
  if (parts.length > 3 && parts[3] === 0) return null; // fully transparent
  return parts.slice(0, 3);
}

export function required(fontSizePx, fontWeight) {
  const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && Number(fontWeight) >= 700);
  return large ? 3 : 4.5;
}
```

- [ ] **Step 3: Write the failing audit test**

`test/contrast.test.mjs`:

```js
// ABOUTME: Measures rendered text contrast across every theme and mode combination.
// ABOUTME: Fails with an explicit list so a new colour cannot silently break AA.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
import { ratio, parseRgb, required } from './helpers/contrast.mjs';

const THEMES = JSON.parse(readFileSync('data/themes.json', 'utf8')).map(t => t.id);
const MODES = [[], ['night'], ['easy-read'], ['night', 'easy-read']];

let browser, server;
before(async () => {
  server = execFile('hugo', ['server', '--port', '1337', '--quiet']);
  await new Promise(r => setTimeout(r, 4000));
  browser = await puppeteer.launch();
});
after(async () => { await browser?.close(); server?.kill(); });

async function failuresFor(theme, modes) {
  const page = await browser.newPage();
  await page.goto('http://localhost:1337/', { waitUntil: 'networkidle0' });
  await page.evaluate((theme, modes) => {
    const html = document.documentElement;
    html.className = '';
    if (theme !== 'fantasy') html.classList.add('theme-' + theme);
    modes.forEach(m => html.classList.add(m));
  }, theme, modes);

  const samples = await page.evaluate(() => {
    const out = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    let node;
    while ((node = walk.nextNode())) {
      if (!node.textContent.trim()) continue;
      const el = node.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
      // Walk up for the first non-transparent background
      let bgEl = el, bg = null;
      while (bgEl) {
        const c = getComputedStyle(bgEl).backgroundColor;
        if (c && !/rgba\(.*,\s*0\)/.test(c) && c !== 'transparent') { bg = c; break; }
        bgEl = bgEl.parentElement;
      }
      out.push({
        selector: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
        fg: cs.color, bg: bg || 'rgb(255,255,255)',
        size: parseFloat(cs.fontSize), weight: cs.fontWeight,
        text: node.textContent.trim().slice(0, 40),
      });
    }
    return out;
  });

  await page.close();

  const failures = [];
  for (const s of samples) {
    const fg = parseRgb(s.fg), bg = parseRgb(s.bg);
    if (!fg || !bg) continue;
    const r = ratio(fg, bg), need = required(s.size, s.weight);
    if (r < need) failures.push({ ...s, ratio: +r.toFixed(2), needed: need });
  }
  return failures;
}

for (const theme of THEMES) {
  for (const modes of MODES) {
    const label = [theme, ...modes].join('+');
    test(`AA contrast: ${label}`, async () => {
      const failures = await failuresFor(theme, modes);
      const report = failures.map(f =>
        `  ${f.selector} "${f.text}" ${f.fg} on ${f.bg} = ${f.ratio}:1 (need ${f.needed}:1)`
      ).join('\n');
      assert.strictEqual(failures.length, 0, `${label} has ${failures.length} contrast failures:\n${report}`);
    });
  }
}
```

- [ ] **Step 4: Run it and collect the real failure list**

```bash
npm run test:contrast 2>&1 | tee /tmp/contrast-report.txt
```

Expected: FAIL. This run *is* the audit — the report is the work list. Do not guess
at fixes before reading it.

- [ ] **Step 5: Fix each reported failure**

Work the list from the report. For each failure, adjust the colour in the rule that
sets it, keeping the theme's character. Re-run after each theme's fixes rather than
changing everything at once. If a failure is on decorative text where a colour change
would wreck the design, raise it rather than silently lowering the bar — do not add
an exclusion list without asking.

- [ ] **Step 6: Confirm the whole matrix passes**

```bash
npm test
```

Expected: every test PASS, including the sprite and ASCII suites.

- [ ] **Step 7: Commit**

```bash
git add test/ package.json package-lock.json static/css
git commit -m "test: add WCAG AA contrast audit across the theme matrix

Measures computed foreground against effective background on rendered DOM
for every theme crossed with night and easy-read, and fixes the failures
it found. Doubles as the regression guard for new colours.

Closes theme-pixel-art-f98"
```

---

## Verification

After all tasks:

```bash
npm test              # all suites green
hugo --quiet          # site builds clean
git log --oneline -8  # one commit per task
bd list               # au1, xsf, gxe, xzc, t1t, f98 closed
```

Remaining open by design: `vze` (art), `iqc` (art placement question), `5v9`
(easy-read specificity tech debt), `2hp` (closes with Task 8).
