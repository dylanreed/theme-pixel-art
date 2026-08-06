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

    seen.add(el);
    out.push({
      selector: describe(el),
      text: node.textContent.trim().slice(0, 60),
      fg: cs.color,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: cs.fontWeight,
      lineRects,
    });
  }
  return out;
}

// A grid inside a text line box. Kept away from the edges because a line box
// includes half-leading above and below the glyphs, which on a small button
// or pill can fall outside the painted surface. Sampling several points and
// keeping the worst is what catches gradients and busy pixel art that
// averaging would hide.
function samplePoints(rect, imgW, imgH) {
  const xs = rect.width < 8 ? [0.5] : [0.2, 0.5, 0.8];
  const ys = rect.height < 8 ? [0.5] : [0.35, 0.5, 0.65];
  const points = [];
  for (const gx of xs) {
    for (const gy of ys) {
      const x = Math.min(imgW - 1, Math.max(0, Math.round(rect.x + gx * rect.width)));
      const y = Math.min(imgH - 1, Math.max(0, Math.round(rect.y + gy * rect.height)));
      points.push([x, y]);
    }
  }
  return points;
}

async function auditPage(page, pageLabel) {
  // Full-content viewport so getBoundingClientRect() coordinates line up
  // 1:1 with screenshot pixel coordinates -- no scroll offset to reconcile.
  const height = await page.evaluate(() =>
    Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)) + 4
  );
  await page.setViewport({ width: VIEWPORT_WIDTH, height });

  await page.evaluate(sel => { window.__DECORATIVE__ = sel; }, DECORATIVE);
  const elements = await page.evaluate(collectTextElements);

  // True painted background: make every glyph transparent, then screenshot.
  // This must be done with inline styles, not a stylesheet. Much of the theme
  // sets colour with !important at a specificity a bare `*` rule cannot beat
  // (html.easy-read .post-link, and similar), so an injected stylesheet leaves
  // text visible and the "background" screenshot ends up full of glyphs that
  // then get sampled as though they were background. An inline !important
  // declaration outranks any stylesheet !important.
  // Transitions must die first. A running transition outranks even an
  // important author declaration in the cascade, so setting colour on an
  // element with `transition: color` reads back the mid-flight value and the
  // glyph is still painted when the screenshot is taken.
  await page.evaluate(() => {
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

  // Fail loudly rather than silently measuring glyphs as background.
  const stillPainted = await page.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll('*')) {
      const c = getComputedStyle(el).color;
      const m = /^rgba?\(([^)]+)\)$/.exec(c);
      if (!m) continue;
      const parts = m[1].split(',').map(s => parseFloat(s));
      if (parts.length < 4 || parts[3] > 0) n++;
    }
    return n;
  });
  assert.strictEqual(stillPainted, 0,
    `${stillPainted} elements resisted text blanking; the background screenshot would contain glyphs`);

  const buf = await page.screenshot({ type: 'png' });
  const png = PNG.sync.read(Buffer.from(buf));

  const failures = [];
  for (const el of elements) {
    const fg = parseColor(el.fg);
    if (!fg || fg.a === 0) continue; // not actually painted

    let worstRatio = Infinity;
    let worstBg = null;
    for (const lineRect of el.lineRects) {
      for (const [px, py] of samplePoints(lineRect, png.width, png.height)) {
        const idx = (png.width * py + px) << 2;
        const bgPixel = [png.data[idx], png.data[idx + 1], png.data[idx + 2]];
        const effectiveFg = fg.a < 1 ? blend(fg, bgPixel) : [fg.r, fg.g, fg.b];
        const r = ratio(effectiveFg, bgPixel);
        if (r < worstRatio) {
          worstRatio = r;
          worstBg = bgPixel;
        }
      }
    }
    if (worstRatio === Infinity) continue;

    const needed = required(el.fontSize, el.fontWeight);
    if (worstRatio < needed) {
      failures.push({
        page: pageLabel,
        selector: el.selector,
        text: el.text,
        fg: el.fg,
        bg: `rgb(${worstBg[0]}, ${worstBg[1]}, ${worstBg[2]})`,
        ratio: +worstRatio.toFixed(2),
        needed,
      });
    }
  }
  return failures;
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
        `  [${f.page}] ${f.selector} "${f.text}" ${f.fg} on ${f.bg} = ${f.ratio}:1 (need ${f.needed}:1)`;

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
