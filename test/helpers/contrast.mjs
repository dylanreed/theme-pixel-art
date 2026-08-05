// ABOUTME: WCAG relative luminance, contrast ratio, and colour maths for the AA audit.
// ABOUTME: Kept separate from the Puppeteer driver so the maths is unit-testable without a browser.

export function relativeLuminance([r, g, b]) {
  const f = v => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function ratio(fg, bg) {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// getComputedStyle always renders `color` as rgb()/rgba(), never a keyword
// or hex, so that is the only shape this needs to parse. Returns null (not
// a colour) when the string does not match, which callers treat the same
// way as "skip this element" -- there is nothing paintable to measure.
export function parseColor(str) {
  const m = /^rgba?\(([^)]+)\)$/.exec(String(str || '').trim());
  if (!m) return null;
  const parts = m[1].split(',').map(s => parseFloat(s.trim()));
  const [r, g, b, a = 1] = parts;
  if ([r, g, b].some(Number.isNaN)) return null;
  return { r, g, b, a: Number.isNaN(a) ? 1 : a };
}

// Composites a possibly-translucent foreground colour over an opaque
// background pixel using standard "over" alpha compositing. This theme uses
// rgba() text colours for faint decorative flourishes, so an honest ratio
// has to be measured against what the eye actually receives, not the
// unblended foreground channel.
export function blend(fg, bg) {
  const a = fg.a;
  return [
    fg.r * a + bg[0] * (1 - a),
    fg.g * a + bg[1] * (1 - a),
    fg.b * a + bg[2] * (1 - a),
  ];
}

export function required(fontSizePx, fontWeight) {
  const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && Number(fontWeight) >= 700);
  return large ? 3 : 4.5;
}
