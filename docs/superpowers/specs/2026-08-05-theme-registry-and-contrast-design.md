# Theme Registry, Sprite Fallbacks, and AA Contrast

**Date:** 2026-08-05
**Status:** Approved design, pending implementation plan

## Problem

Six reported issues share one root cause: the theme system has no single source of
truth. Adding a theme means editing four files. Adding a sprite means editing three.
Header categories are hand-enumerated in CSS, sixteen selectors per theme.

The duplication:

| Data | Lives in |
|---|---|
| Theme list | `layouts/_default/baseof.html:72`, `static/js/chaos.js:571` (`getCurrentTheme`), `chaos.js:580` (`getThemeSpriteSheet`), `chaos.js:794` (`themeSprites`) |
| Sprite list | `layouts/partials/post-sprite.html:19-23`, `chaos.js:785`, six per-theme maps in `chaos.js:794-874` |
| Header categories | `static/css/themes.css:1574+`, enumerated `[style*="…webp"]` selectors |

The six issues:

1. **Unknown categories 404.** `post-sprite.html` falls back to `default.png` only when
   a post has no category at all. A category with no sprite emits a path to a file that
   does not exist. Tags are never consulted.
2. **Three themes have no sprites.** `corporate`, `kaiju` and `western` have empty
   `sprites/category/` directories. `updateCategorySprites()` early-returns when a theme
   is missing from `themeSprites`, leaving the Hugo-emitted fantasy path in place, so
   those themes silently serve fantasy art.
3. **Kaiju is unreachable.** It has 43 assets on disk — day and night backgrounds,
   sixteen headers, cursors, dropdown, menu, note scrolls — but is absent from the
   `themes` array, has no `html.theme-kaiju` CSS, and `getCurrentTheme()` cannot return it.
4. **Read more button renders mojibake.** `static/css/style.css:981` sets
   `content: " →"` as a literal UTF-8 arrow. No stylesheet declares `@charset "UTF-8"`,
   so browsers decode the bytes as latin-1 and render `â†'`. The markup at
   `layouts/index.html:83` and `layouts/_default/list.html:67` already emits
   `Read more &rarr;`, so a correct fix still leaves two arrows. The same latent
   encoding bug sits at `style.css:1688`, `chaos.css:1417`, `themes.css:493`.
5. **Headings are invisible in night mode.** `.post-content h2` and `h3`
   (`style.css:739`, `747`) hardcode `#4a3020`. `html.night .post-content`
   (`style.css:384`) overrides body text but never the heading rules, and the night
   container is `#3b454d` (`style.css:296-303`). Measured contrast: **1.24:1**, against
   an AA large-text requirement of 3:1. On white the same brown measures 12.11:1, which
   is why the bug only appears at night.
6. **Contrast is unverified everywhere else.** No measurement has been done across the
   theme × day/night × easy-read matrix.

## Approach

Resolve at build time what Hugo can see, and hand the browser a manifest for what it
cannot. Hugo knows which sprite files exist on disk; the browser knows which theme the
reader picked. Split the work along that line.

### Layer 0 — Data files

**`data/themes.json`** — ordered array; order drives the theme-cycle button.

```json
[
  { "id": "fantasy", "name": "Fantasy", "icon": "/modes/fantasy.webp" },
  { "id": "sci-fi",  "name": "Sci-Fi",  "icon": "/modes/sci-fi.webp" }
]
```

`fantasy` stays the default and remains the only theme that applies no `html` class.

**`data/sprite-aliases.json`** — flat map from taxonomy term to sprite base name.
Seeded from the real blog's taxonomy: `clowning→clown`, `food→cooking`,
`books→reading`, `magpies-library→reading`, `magpie-book-club→reading`,
`warhammer→tabletop`, `blood-bowl→tabletop`, `yarn→crafting`, `serial→writing`,
`side-projects→tech`, `productivity→adhd`.

### Layer 1 — Hugo resolution

**`layouts/partials/sprite-name.html`** — takes a page context, returns a resolved
sprite base name. The chain, in order:

1. First category, normalised through `urlize` (so `blood bowl` becomes `blood-bowl`)
2. Alias lookup against `sprite-aliases.json`
3. Existence check against the canonical sprite set, read via
   `readDir "static/fantasy/sprites/category"`
4. On miss, walk the post's tags through steps 1–3 and take the first that resolves
5. On total miss, `default`

Fantasy is the canonical set because it is the only complete one. The partial returns a
name, never a path.

**`layouts/partials/theme-data.html`** — emits two globals from data files and
`readDir`, so the browser learns what exists without hardcoding:

```js
window.PIXEL_THEMES = [ /* from data/themes.json */ ];
window.SPRITE_MANIFEST = { "fantasy": ["adhd", "clown", …], "kaiju": [], … };
```

### Layer 2 — Consumers

**`post-sprite.html`** emits the pre-resolved name and stops guessing:

```html
<div class="post-sprite theme-sprite-6x3" data-category="…" data-sprite="{{ $name }}">
```

**`chaos.js`** replaces the six hardcoded maps with a manifest lookup. Per-theme URL
resolution, in order:

1. `/{theme}/sprites/category/{name}.png` if the manifest lists it
2. `/{theme}/sprites/category/default.png` if the theme has a default
3. `/fantasy/sprites/category/{name}.png`
4. `/fantasy/sprites/category/default.png`

This deletes roughly ninety lines and fixes issue 2 as a side effect: corporate, kaiju
and western get their own default the moment the art lands, and degrade to fantasy
until then instead of early-returning.

`getCurrentTheme()` and `getThemeSpriteSheet()` read `window.PIXEL_THEMES` rather than
their own literals. `baseof.html` builds its `themes`, `themeNames` and `themeIcons`
from the same global.

### Layer 3 — Kaiju

With the registry in place, kaiju is one row in `themes.json` plus one
`html.theme-kaiju` block in `themes.css`, following the structure cabin and underwater
already use: panel, border, button, note-scroll, nav-sign, header-image, and the
easy-read container override.

The palette will be drawn from the existing kaiju header art and checked against AA
before it is written, not after.

### Layer 4 — Contrast

Headings get explicit night-mode and easy-read colours. Then the whole matrix is
measured and every failure fixed.

## Testing

The repository currently has no test infrastructure. Two harnesses, both integration
level, both required by work that cannot be verified by eye.

**Sprite resolution.** Fixture posts under a test content directory exercising each
branch: known category, aliased category, unknown category with a resolvable tag,
unknown category with no resolvable tag, no category at all, category with a space in
it. Build with Hugo, assert on `data-sprite` in the rendered HTML. Written before the
partial, per TDD.

**Contrast.** A headless-Chrome checker that walks the rendered DOM, reads computed
foreground and effective background for every text node, computes the WCAG ratio, and
reports failures with selector, colours and measured value. Driven across the full
matrix by setting `themeStyle` and the `night` / `easy-read` classes. This is the only
honest way to verify a cascade this deep, and it doubles as the regression guard that
stops a new colour from silently failing.

Both runners live under `test/`, invoked from a `package.json` script.

## Order of work

Contrast comes last on purpose. Kaiju's CSS does not exist yet and the heading fix
changes colours; auditing before those land means auditing twice.

1. Read more encoding fix — independent, no dependencies
2. Test harness scaffold
3. Data files and Hugo resolver partials
4. `post-sprite.html` and `chaos.js` migration to the registry
5. Kaiju theme CSS
6. Heading contrast fix
7. Full AA audit and remediation

## Out of scope

- **Pixel art.** Per-theme `default.png` for corporate, kaiju and western, and a
  `/modes/kaiju.webp` cycle icon, are Dylan's to draw. The code degrades gracefully
  without them: sprites fall back to fantasy, and `applyThemeStyle` already has an
  `onerror` handler that falls back to the fantasy icon.
- **Western.** Thirteen `.gitkeep` files and no art. Registry work makes it cheap to add
  later; there is nothing to implement now.
- **The untracked `assets/` directory.** Contains `garden`, `food`, `home`, `day` and
  `night` sprites not yet installed into any theme. Needs a decision on where they go.
- **dylan.blog content errors.** TinyLytics reports 24 broken links and 34 mixed-content
  warnings. Different repository; needs its own issue.

## Hazards

- Writing `html.theme-kaiju` rules will break easy-read on kaiju. The easy-read
  white-container override at `themes.css:1503` wins by enumerating theme classes to
  out-specify them; a new theme must be added to that selector list or its own rules
  will win. This pattern is fragile and worth revisiting, but replacing it is not in
  this scope.
- `readDir` and `fileExists` resolve against the project root. `header.html:57` already
  relies on `fileExists` with a `static/` prefix in the micro.blog build, so the
  approach is proven in this pipeline, but the sprite partials should be verified
  against a real build early rather than assumed.
