// Round 5: ui-tour.css. Contrast of every colour pair the tour draws, in all seven palettes of redesign.css (WCAG 2.2: 4.5:1 for text, 3:1 for the
// ring and the focus outline), plus static guards: motion, forced colors, more contrast, right-to-left, no hard-coded colours, no external resources.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const directory = new URL('../../apps/production-extension/', import.meta.url);
const redesign = readFileSync(new URL('redesign.css', directory), 'utf8');
const tour = readFileSync(new URL('ui-tour.css', directory), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');

const PALETTES = {
  'system-light': ':root, :root[data-ui-theme="system"] {',
  'system-dark': ':root[data-ui-theme="system"][data-ui-theme-effective="system-dark"] {',
  pearl: ':root[data-ui-theme="pearl"] {', aurora: ':root[data-ui-theme="aurora"] {', graphite: ':root[data-ui-theme="graphite"] {', orchid: ':root[data-ui-theme="orchid"] {', glass: ':root[data-ui-theme="glass"] {',
};
function tokens(selector) {
  const start = redesign.indexOf(selector);
  assert.ok(start >= 0, 'palette block ' + selector);
  const body = redesign.slice(start + selector.length, redesign.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--rd-([a-z0-9-]+):\s*(#[0-9a-f]{6})/giu)].map(match => [match[1], match[2]]));
}
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high + 0.05) / (low + 0.05); };

// [foreground token, background token, minimum, what it is]
const PAIRS = [
  ['text', 'surface', 4.5, 'popover title'], ['text-2', 'surface', 4.5, 'popover text and the entry hint'], ['text-3', 'surface', 4.5, 'eyebrow'],
  ['accent', 'accent-soft', 4.5, 'step counter'], ['warn', 'warn-bg', 4.5, 'skipped-step note'],
  ['accent-ink', 'accent', 4.5, 'primary button of the popover'],
  ['focus', 'surface', 3, 'focus outline on the popover and its buttons'], ['accent', 'surface', 3, 'ring against its inner halo'],
  ['text', 'surface', 3, 'ring under more contrast against its inner halo'],
];
for (const [name, selector] of Object.entries(PALETTES)) {
  test('tour colours meet WCAG 2.2 contrast in the ' + name + ' palette', () => {
    const palette = tokens(selector), failures = [];
    for (const [foreground, background, minimum, what] of PAIRS) {
      assert.ok(palette[foreground] && palette[background], name + ': tokens ' + foreground + '/' + background);
      const ratio = contrast(palette[foreground], palette[background]);
      if (ratio < minimum) failures.push(what + ': ' + foreground + ' on ' + background + ' = ' + ratio.toFixed(2) + ' < ' + minimum);
    }
    assert.deepEqual(failures, []);
  });
}

test('every token the tour stylesheet reads exists in all seven palettes', () => {
  const used = new Set([...tour.matchAll(/var\(--rd-([a-z0-9-]+)/gu)].map(match => match[1]));
  const shared = new Set([...redesign.slice(0, redesign.indexOf(':root, :root[data-ui-theme="system"] {')).matchAll(/--rd-([a-z0-9-]+):/gu)].map(match => match[1]));
  for (const [name, selector] of Object.entries(PALETTES)) {
    const palette = tokens(selector), shadows = redesign.slice(redesign.indexOf(selector), redesign.indexOf('}', redesign.indexOf(selector)));
    for (const token of used) assert.ok(palette[token] || shared.has(token) || shadows.includes('--rd-' + token + ':'), name + ': --rd-' + token);
  }
  assert.ok(used.size >= 12);
});

test('tour stylesheet: only palette tokens and system colours, no external resource, nothing that fights the page', () => {
  assert.doesNotMatch(tour, /#[0-9a-f]{3,8}\b/iu, 'no hex colours: every colour is a token');
  assert.doesNotMatch(tour, /\burl\(|@import|!important/u);
  const declarations = [...tour.matchAll(/(?:^|[;{\s])((?:background|border|outline|box-shadow|color|background-color|border-color|outline-color)):\s*([^;{}]+);/gu)];
  const words = declarations.flatMap(match => match[2].replace(/(?:var|rgb|calc|min|max)\((?:[^()]|\([^()]*\))*\)/gu, ' ').match(/[A-Za-z]+/gu) ?? []).filter(word => !/^(?:solid|none|transparent|px|em|rem|vmax|vw|vh)$/u.test(word));
  for (const word of words) assert.ok(['Canvas', 'CanvasText', 'Highlight'].includes(word), 'unexpected colour word: ' + word);
  assert.ok(declarations.length >= 15, 'the scan reads the colour declarations (' + declarations.length + ')');
  // The dimming is a colour, not an image or a filter; its alpha leaves the page readable behind it.
  assert.match(tour, /--ui-tour-scrim:\s*rgb\(6 10 20 \/ \.6\)/u);
  assert.match(tour, /\.ui-tour__ring \{[^}]*box-shadow: 0 0 0 2px var\(--rd-surface\), 0 0 0 5px var\(--rd-accent\), 0 0 0 100vmax var\(--ui-tour-scrim\)/u, 'two-tone ring, then the dimming');
  assert.match(tour, /\.ui-tour__shield \{[^}]*pointer-events: auto/u); assert.match(tour, /\.ui-tour \{[^}]*pointer-events: none/u);
  assert.doesNotMatch(tour, /\b(?:filter|backdrop-filter|mix-blend-mode)\s*:/u, 'no filter over the page');
  const z = [...tour.matchAll(/z-index:\s*(\d+)/gu)].map(match => Number(match[1]));
  assert.ok(Math.max(...z) >= 100 && Math.max(...z) < 10000, 'above every sticky bar of the page (at most 60) and below the page-level overlays');
});

test('tour stylesheet: reduced motion, more contrast, forced colors and print are handled; docking and right-to-left use logical properties', () => {
  assert.match(tour, /@media \(prefers-reduced-motion: no-preference\) \{[^@]*\.ui-tour__ring \{ transition: left/u, 'the ring glides only when motion is welcome');
  assert.match(tour, /@media \(prefers-reduced-motion: reduce\) \{[^}]*transition: none/u);
  const outsideMotion = tour.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/u, ''); assert.doesNotMatch(outsideMotion.replace(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\}\s*\}/u, ''), /transition:\s*(?!none)/u, 'no transition outside the no-preference block');
  assert.doesNotMatch(tour, /\banimation(?:-name)?\s*:/u, 'no keyframe animation at all');
  assert.match(tour, /@media \(prefers-contrast: more\) \{[^@]*border: 2px solid var\(--rd-text\)/u); assert.match(tour, /@media \(prefers-contrast: more\) \{[^@]*outline-width: 4px/u);
  const forced = tour.slice(tour.indexOf('@media (forced-colors: active)'), tour.indexOf('@media print'));
  assert.match(forced, /\.ui-tour__ring \{ box-shadow: none; outline: 4px solid Highlight/u, 'shadows are not drawn in forced colors, so the ring becomes an outline');
  assert.match(forced, /\.ui-tour__scrim \{ background: transparent/u); assert.match(forced, /background: Canvas; color: CanvasText/u);
  assert.match(tour, /@media print \{ \.ui-tour \{ display: none/u);
  assert.doesNotMatch(tour, /\b(?:margin|padding|border)-(?:left|right)\b|text-align:\s*(?:left|right)|\bfloat:\s*(?:left|right)|(?<![-a-z])(?:left|right):\s*[0-9]/u, 'no physical side in the stylesheet (the script places the popover in physical pixels, inline)');
  assert.match(tour, /\[data-ui-tour-mode="dock"\] \{[^}]*inset-inline: 8px; inset-block: auto 8px; width: auto; max-height: min\(58vh, 30rem\)/u, 'narrow windows: a sheet at the bottom edge with its own scrolling');
  assert.match(tour, /\[data-ui-tour-mode="dock"\]\[data-ui-tour-dock="top"\] \{[^}]*inset-block: 8px auto/u, 'the sheet can sit along the top edge when the target is in the lower half');
  assert.match(tour, /\.ui-tour__popover \{[^}]*width: min\(26rem, calc\(100vw - 24px\)\)[^}]*overflow: auto/u, 'never wider than the window; long text scrolls inside');
  assert.match(tour, /\[data-ui-tour-ready="false"\] \{ opacity: 0; pointer-events: none; \}/u, 'hidden (not display:none) until placed, so it can take focus at once');
  assert.match(tour, /\.ui-tour__popover:focus-visible \{ outline: 2px solid var\(--rd-focus\)/u); assert.match(tour, /\.ui-tour__popover \.button:focus-visible \{ outline: 3px solid var\(--rd-focus\)/u);
  assert.match(tour, /\.ui-tour__counter \{[^}]*font-variant-numeric: tabular-nums/u);
  assert.match(tour, /overflow-wrap: anywhere/u, 'long words of any language wrap instead of overflowing');
});

test('tour stylesheet: a long text scrolls, the buttons stay in view (sticky row on a popover without bottom padding)', () => {
  const rule = selector => { const start = tour.indexOf(selector + ' {'); assert.ok(start >= 0, selector + ' has a rule'); return tour.slice(start, tour.indexOf('}', start)); };
  assert.ok(rule('.ui-tour__popover').includes('padding: 16px 18px 0;'), 'no bottom padding on the scrolling popover, so the bottom edge for the sticky row is unambiguous');
  assert.ok(rule('.ui-tour__popover').includes('overflow: auto'), 'the popover itself scrolls');
  const actions = rule('.ui-tour__actions');
  for (const part of ['position: sticky', 'inset-block-end: 0', 'background: var(--rd-surface)', 'margin-inline: -18px', 'padding: 8px 18px 14px']) assert.ok(actions.includes(part), 'the action row: ' + part);
  assert.ok(tour.includes('.ui-tour__popover[data-ui-tour-mode="dock"] .ui-tour__actions { padding-block-end: calc(14px + env(safe-area-inset-bottom, 0px)); }'), 'the bottom safe area is added by the row, not by the popover');
  assert.ok(tour.includes('.ui-tour__popover[data-ui-tour-mode="dock"][data-ui-tour-dock="top"] .ui-tour__actions { padding-block-end: 14px; }'), 'a sheet along the top edge needs no safe area');
  assert.ok(!rule('.ui-tour__popover[data-ui-tour-mode="dock"]').includes('padding-block-end'), 'the dock rule of the popover adds no bottom padding');
  const forced = tour.slice(tour.indexOf('@media (forced-colors: active)'), tour.indexOf('@media print'));
  assert.ok(forced.includes('.ui-tour__actions { background: Canvas; }'), 'forced colors: the sticky row paints in the system canvas colour');
  const surfaces = [...redesign.matchAll(/--rd-surface:\s*([^;]+);/gu)].map(match => match[1].trim());
  assert.ok(surfaces.length >= 7 && surfaces.every(value => /^#[0-9a-f]{6}$/iu.test(value)), 'every palette has an opaque surface colour, so the text scrolled under the sticky row never shows through: ' + surfaces.join(' '));
});
