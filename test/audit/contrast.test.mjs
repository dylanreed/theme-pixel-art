// ABOUTME: Measures rendered text contrast across every theme, mode, and page combination.
// ABOUTME: Samples painted background pixels rather than computed styles, since most surfaces
// ABOUTME: here are background images (parchment, tiles, panel art) that backgroundColor cannot see.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import puppeteer from 'puppeteer';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { ratio, parseColor, blend, required } from '../helpers/contrast.mjs';

const PORT = 1337; // leet, and already the port this repo's plan used for manual verification
const BASE = `http://localhost:${PORT}`;

const THEMES = JSON.parse(readFileSync('data/themes.json', 'utf8')).map(t => t.id);
const MODE_COMBOS = [[], ['night'], ['easy-read'], ['night', 'easy-read']];

// Pages exercising the theme's three distinct text containers per the plan:
// the home page mixes .note-scroll (micro posts) with .posts-container
// (titled posts), a single post page uses .post-container, and the archive
// uses .archive-container. Covering only the home page is what let the
// kaiju note-scroll bug through originally.
const PAGES = [
  { label: 'home', path: '/' },
  { label: 'single-post', path: '/post/2024-01-15-beach-day/' },
  { label: 'archive', path: '/archive/' },
];

const VIEWPORT_WIDTH = 1280;

// Purely decorative effects. WCAG 1.4.3 governs text that conveys meaning;
// these are ambient particles that carry none, and every one of them sits on
// whatever happens to be behind it at the time, so a contrast figure for them
// is not even well defined. Excluded from measurement rather than accepted as
// a failure, because they are not content.
const DECORATIVE = [
  '.ramona', '.ramona-heart', '.ramona-dirt',
  '.sparkle', '.particle', '.seasonal-particle',
  '.falling-sprite', '.chaos-sprite', '.floating-sprite', '.floating-rune',
  '.rain-drop', '.snow-flake',
].join(',');

// Real failures that are a deliberate design decision to defer, not bugs to
// silently hide. These are still measured and still reported every run; they
// just do not fail the suite. Anything added here needs a reason and a
// tracking issue -- an entry without one is how an audit quietly rots.
// The site title used to live here. It is fixed now -- unified bottom-left
// placement with a theme-tinted backing -- so it is measured like anything
// else and must keep passing.
const ACCEPTED = [];

let browser, server;

before(async () => {
  server = execFile('hugo', ['server', '--port', String(PORT), '--quiet'], { cwd: process.cwd() });
  server.on('error', err => { throw err; });
  await waitForServer(`${BASE}/`);
  browser = await puppeteer.launch();
});

after(async () => {
  await browser?.close();
  server?.kill();
});

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`hugo server did not become ready at ${url} within ${timeoutMs}ms`);
}

// Collects every visible text element's bounding rect, computed colour,
// font metrics, a text sample, and a short ancestor-path selector for
// reporting. Runs inside the page.
function collectTextElements() {
  function describe(el) {
    const parts = [];
    let node = el, depth = 0;
    while (node && node.tagName && depth < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id) part += '#' + node.id;
      else if (typeof node.className === 'string' && node.className.trim()) {
        part += '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.');
      }
      parts.unshift(part);
      if (node.tagName === 'BODY') break;
      node = node.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  const out = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.textContent.trim()) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    if (window.__DECORATIVE__ && el.closest(window.__DECORATIVE__)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    // Off-canvas UI (skip link, Sierra panel before hover, etc.) still has a
    // rect, just one that sits above/left of the visible page.
    if (rect.bottom < 0 || rect.right < 0) continue;
    // Measure the text's own line boxes, not the element rect. An element
    // rect routinely extends past the surface the glyphs sit on -- a
    // .post-link rect is taller than its painted button, a nav-sign span is
    // wider than the wooden sign graphic -- and sampling those margins
    // reports the page background as though text were drawn on it. Range
    // rects bound the glyphs themselves.
    const range = document.createRange();
    range.selectNodeContents(node);
    const lineRects = Array.from(range.getClientRects())
      .filter(r => r.width >= 1 && r.height >= 1 && r.bottom > 0 && r.right > 0)
      .map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
    range.detach();
    if (!lineRects.length) continue;

    // A CSS filter on any ancestor means the declared colour is not what gets
    // painted -- night mode inverts note scrolls -- so those elements have to
    // be measured from pixels instead.
    let filtered = false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      if (getComputedStyle(n).filter !== 'none') { filtered = true; break; }
    }

    seen.add(el);
    out.push({
      selector: describe(el),
      filtered,
      text: node.textContent.trim().slice(0, 60),
      fg: cs.color,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: cs.fontWeight,
      lineRects,
    });
  }
  return out;
}

async function auditPage(page, pageLabel) {
  // Full-content viewport so getBoundingClientRect() coordinates line up
  // 1:1 with screenshot pixel coordinates -- no scroll offset to reconcile.
  const height = await page.evaluate(() =>
    Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)) + 4
  );
  await page.setViewport({ width: VIEWPORT_WIDTH, height });

  // Webfonts must be settled before anything is measured. networkidle0 does
  // not cover them -- @font-face requests start after it fires -- and if a
  // face lands between the lit and blanked screenshots the glyphs move, so
  // the pixel diff compares two different layouts and reports nonsense.
  await page.evaluate(() => document.fonts.ready);

  // Transitions must die before ANY measurement, not just before blanking.
  // Applying a mode class starts colour transitions (.archive-title carries
  // `transition: color .15s`), so reading computed colour or shooting the lit
  // screenshot straight afterwards captures a mid-animation value. That
  // reported settled, conforming text as failing -- archive titles measured
  // as their pre-night colour on the night panel.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      el.style.setProperty('transition', 'none', 'important');
      el.style.setProperty('animation', 'none', 'important');
    }
  });
  await new Promise(r => setTimeout(r, 50));

  await page.evaluate(sel => { window.__DECORATIVE__ = sel; }, DECORATIVE);
  const elements = await page.evaluate(collectTextElements);

  // Both sides of the ratio must come from painted pixels. Reading the
  // foreground from computed style and the background from the screenshot
  // silently mismatches wherever a CSS filter is in play -- night mode runs
  // `filter: invert(0.85) hue-rotate(180deg)` on note scrolls, so the declared
  // colour is a dark brown while the glyphs actually paint light. Comparing
  // those two produced a confident 1.06:1 on text that really measures ~8:1.
  //
  // So: shoot the page twice, once normally and once with every glyph made
  // transparent. Pixels that differ between the two ARE the glyphs; the same
  // coordinate in the blanked shot is the background behind them. Filters,
  // blend modes and gradients all apply equally to both shots, so whatever
  // they do cancels out.
  const litBuf = await page.screenshot({ type: 'png' });

  // Blanking must use inline styles, not an injected stylesheet: much of the
  // theme sets colour with !important at a specificity a bare `*` rule cannot
  // beat. Transitions have to die first, since a running transition outranks
  // even an important author declaration and the glyph would still be painted.
  await page.evaluate(() => {
    // Re-kill transitions: elements created since the first pass (Ramona, the
    // achievement toast, weather particles) still carry them, and a colour
    // transition outranks even an important declaration, so their glyphs would
    // survive the blanking and be sampled as background.
    for (const el of document.querySelectorAll('*')) {
      el.style.setProperty('transition', 'none', 'important');
      el.style.setProperty('animation', 'none', 'important');
    }
    for (const el of document.querySelectorAll('*')) {
      el.style.setProperty('color', 'transparent', 'important');
      el.style.setProperty('text-shadow', 'none', 'important');
      el.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
    }
  });

  const stillPainted = await page.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll('*')) {
      const m = /^rgba?\(([^)]+)\)$/.exec(getComputedStyle(el).color);
      if (!m) continue;
      const parts = m[1].split(',').map(s => parseFloat(s));
      if (parts.length < 4 || parts[3] > 0) n++;
    }
    return n;
  });
  assert.strictEqual(stillPainted, 0,
    `${stillPainted} elements resisted text blanking; the background screenshot would contain glyphs`);

  const darkBuf = await page.screenshot({ type: 'png' });
  const lit = PNG.sync.read(Buffer.from(litBuf));
  const dark = PNG.sync.read(Buffer.from(darkBuf));

  const failures = [];
  for (const el of elements) {
    const hit = glyphContrast(el, lit, dark);
    if (!hit) continue;                       // no glyph pixels found

    // WCAG is defined on the specified text colour, not the antialiased
    // rendering -- for small text no pixel is ever fully inked, so measuring
    // painted ink is stricter than the standard and flags text that conforms.
    // Use the declared colour, except where a filter means it is not what
    // reaches the screen.
    if (!el.filtered) {
      const declared = parseColor(el.fg);
      if (declared && declared.a > 0) {
        const fgc = declared.a < 1 ? blend(declared, hit.bg) : [declared.r, declared.g, declared.b];
        hit.ratio = ratio(fgc, hit.bg);
        hit.fg = fgc.map(Math.round);
      }
    }
    const needed = required(el.fontSize, el.fontWeight);
    if (hit.ratio < needed) {
      failures.push({
        page: pageLabel, selector: el.selector, text: el.text,
        fg: `rgb(${hit.fg.join(', ')})`, bg: `rgb(${hit.bg.join(', ')})`,
        declared: el.fg, ratio: +hit.ratio.toFixed(2), needed,
      });
    }
  }
  return failures;
}

/* Find the glyph pixels inside an element's line boxes and return the worst
   contrast among the well-covered ones. Coverage is how far a pixel moved
   when the text was blanked: a fully-inked pixel moves most, an antialiased
   edge only partly. Edge pixels are excluded because they are a blend of ink
   and background and would report a failure that no reader can see. */
function glyphContrast(el, lit, dark) {
  const cand = [];
  let maxDelta = 0;
  for (const r of el.lineRects) {
    const x0 = Math.max(0, Math.floor(r.x)), x1 = Math.min(lit.width,  Math.ceil(r.x + r.width));
    const y0 = Math.max(0, Math.floor(r.y)), y1 = Math.min(lit.height, Math.ceil(r.y + r.height));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (lit.width * y + x) << 2;
        const a = [lit.data[i], lit.data[i+1], lit.data[i+2]];
        const b = [dark.data[i], dark.data[i+1], dark.data[i+2]];
        const delta = Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]);
        if (delta > maxDelta) maxDelta = delta;
        if (delta > 0) cand.push({ a, b, delta });
      }
    }
  }
  if (!cand.length || maxDelta < 12) return null;   // nothing legibly painted
  const floor = maxDelta * 0.85;
  let worst = null;
  for (const c of cand) {
    if (c.delta < floor) continue;
    const v = ratio(c.a, c.b);
    if (!worst || v < worst.ratio) worst = { ratio: v, fg: c.a, bg: c.b };
  }
  return worst;
}

async function failuresFor(theme, modes) {
  // A fresh incognito context per combo keeps localStorage (theme, and
  // achievement-toast unlocks that a shared context would only show once
  // ever) from leaking between combos, so every combo sees the same
  // first-visit state and results are reproducible run to run.
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  // Theme is read from localStorage at parse time (see head.html), so it
  // needs a reload to take effect on the tab that set it. Modes are plain
  // html classes with no load-time storage read, so they apply immediately
  // and get reapplied on every navigation within this combo.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(t => localStorage.setItem('themeStyle', t), theme);
  await page.reload({ waitUntil: 'networkidle0' });

  const failures = [];
  for (const { label, path } of PAGES) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
    await page.evaluate(modes => {
      const html = document.documentElement;
      modes.forEach(m => html.classList.add(m));
    }, modes);
    failures.push(...await auditPage(page, label));
  }

  await context.close();
  return failures;
}

for (const theme of THEMES) {
  for (const modes of MODE_COMBOS) {
    const label = [theme, ...modes].join('+');
    test(`AA contrast: ${label}`, async () => {
      const all = await failuresFor(theme, modes);
      const fmt = f =>
        `  [${f.page}] ${f.selector} "${f.text}" painted ${f.fg} on ${f.bg}`
        + ` = ${f.ratio}:1 (need ${f.needed}:1)`
        + (f.declared && f.declared !== f.fg ? `  [declared ${f.declared}]` : '');

      const accepted = all.filter(f => ACCEPTED.some(a => a.match(f.selector)));
      const failures = all.filter(f => !ACCEPTED.some(a => a.match(f.selector)));

      // Surface deferred failures every run so they stay visible rather than
      // decaying into permanent silent debt.
      if (accepted.length) {
        console.log(`${label}: ${accepted.length} accepted (deferred) contrast failures`);
        for (const a of ACCEPTED) {
          if (accepted.some(f => a.match(f.selector))) console.log(`    - ${a.why}`);
        }
      }

      assert.strictEqual(failures.length, 0,
        `${label} has ${failures.length} contrast failures:\n${failures.map(fmt).join('\n')}`);
    });
  }
}
