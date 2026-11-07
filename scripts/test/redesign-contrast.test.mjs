// ADR-103: WCAG 2.2 contrast of the seven redesign palettes, read from redesign.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(import.meta.dirname, '../../apps/production-extension/redesign.css'), 'utf8');
const PALETTES = {
  'system-light': ':root, :root[data-ui-theme="system"] {',
  'system-dark': ':root[data-ui-theme="system"][data-ui-theme-effective="system-dark"] {',
  pearl: ':root[data-ui-theme="pearl"] {',
  aurora: ':root[data-ui-theme="aurora"] {',
  graphite: ':root[data-ui-theme="graphite"] {',
  orchid: ':root[data-ui-theme="orchid"] {',
  glass: ':root[data-ui-theme="glass"] {',
};
function tokens(selector) {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, 'palette block ' + selector);
  const body = css.slice(start + selector.length, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--rd-([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map(match => [match[1], match[2]]));
}
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
// [foreground, background, minimum]: text pairs need 4.5:1, component boundaries 3:1.
const PAIRS = [
  ['text', 'surface', 4.5], ['text', 'ground', 4.5], ['text-2', 'surface', 4.5], ['text-2', 'ground', 4.5],
  ['text-3', 'surface', 4.5], ['text-3', 'ground', 4.5], ['text-3', 'surface-2', 4.5], ['text-3', 'sunken', 4.5],
  ['accent', 'surface', 4.5], ['accent', 'accent-soft', 4.5], ['accent-ink', 'accent', 4.5],
  ['ok', 'ok-bg', 4.5], ['warn', 'warn-bg', 4.5], ['err', 'err-bg', 4.5], ['off', 'off-bg', 4.5], ['custom', 'custom-bg', 4.5],
  ['err', 'surface', 4.5], ['control', 'surface', 3], ['switch-line', 'surface', 3], ['ok-fill', 'surface', 3], ['ok-fill', 'thumb', 3],
  // ADR-107, WCAG 1.4.11: the focus outline against every surface it can sit on; warning and success text on plain surfaces too.
  ['focus', 'surface', 3], ['focus', 'ground', 3], ['focus', 'surface-2', 3], ['focus', 'sunken', 3], ['focus', 'accent-soft', 3],
  ['warn', 'surface', 4.5], ['warn', 'ground', 4.5], ['warn', 'surface-2', 4.5], ['ok', 'surface', 4.5], ['ok', 'ground', 4.5], ['ok', 'surface-2', 4.5],
];

for (const [name, selector] of Object.entries(PALETTES)) {
  test('ADR-103 palette ' + name + ' meets WCAG 2.2 AA contrast for text and component boundaries', () => {
    const palette = tokens(selector);
    const failures = [];
    for (const [fg, bg, minimum] of PAIRS) {
      assert.ok(palette[fg] && palette[bg], name + ': tokens ' + fg + '/' + bg);
      const ratio = contrast(palette[fg], palette[bg]);
      if (ratio < minimum) failures.push(fg + ' on ' + bg + ' = ' + ratio.toFixed(2) + ' < ' + minimum);
    }
    assert.deepEqual(failures, []);
  });
}

// ADR-107: under prefers-contrast: more the secondary text and the hairlines are mixed from each palette's own text and surface.
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
function highContrastMixes() {
  const start = rules.indexOf('@media (prefers-contrast: more) {');
  assert.ok(start >= 0, 'prefers-contrast: more block');
  const block = rules.slice(start, rules.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--rd-([a-z0-9-]+):\s*color-mix\(in srgb, var\(--rd-text\) (\d+)%, var\(--rd-surface\)\)/g)].map(match => [match[1], Number(match[2]) / 100]));
}
// color-mix(in srgb, A p, B) interpolates the gamma-encoded channels.
const mixHex = (a, b, share) => '#' + [1, 3, 5].map(index => Math.round(parseInt(a.slice(index, index + 2), 16) * share + parseInt(b.slice(index, index + 2), 16) * (1 - share)).toString(16).padStart(2, '0')).join('');
test('ADR-107 prefers-contrast: more raises secondary text to 7:1 and hairlines to 3:1 in every palette', () => {
  const mixes = highContrastMixes();
  assert.deepEqual(Object.keys(mixes).sort(), ['control', 'line', 'line-2', 'text-2', 'text-3']);
  const failures = [];
  for (const [name, selector] of Object.entries(PALETTES)) {
    const palette = tokens(selector), mixed = Object.fromEntries(Object.entries(mixes).map(([key, share]) => [key, mixHex(palette.text, palette.surface, share)]));
    for (const key of ['text-2', 'text-3']) for (const background of ['surface', 'ground', 'surface-2', 'sunken']) if (contrast(mixed[key], palette[background]) < 7) failures.push(name + ' ' + key + '/' + background);
    for (const key of ['line', 'line-2', 'control']) for (const background of ['surface', 'ground']) if (contrast(mixed[key], palette[background]) < 3) failures.push(name + ' ' + key + '/' + background);
    for (const key of ['text-2', 'text-3', 'line', 'control']) if (contrast(mixed[key], palette.surface) <= contrast(palette[key], palette.surface)) failures.push(name + ' ' + key + ' did not gain contrast');
  }
  assert.deepEqual(failures, []);
  assert.match(rules, /@media \(prefers-contrast: more\) \{[^@]*--rd-switch-line: var\(--rd-control\)/u, 'the switch track outline follows the stronger control line');
});

test('ADR-107 focus indicators use the full focus colour: no translucent rings, 3 px under prefers-contrast: more', () => {
  const antidetect = readFileSync(resolve(import.meta.dirname, '../../apps/production-extension/antidetect-ui.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [file, source] of [['redesign.css', rules], ['antidetect-ui.css', antidetect]]) {
    assert.doesNotMatch(source, /:focus(?:-visible|-within)[^{]*\{[^}]*color-mix\(in srgb, var\(--rd-focus\) \d+%, transparent\)/u, file + ': no translucent focus ring');
  }
  assert.match(rules, /textarea\):focus-visible \{\s*border-color: var\(--rd-focus\); outline: 2px solid var\(--rd-focus\); outline-offset: 0;/u, 'inputs: a 2 px outline in the focus colour');
  assert.match(rules, /@media \(prefers-contrast: more\) \{[\s\S]*?textarea\):focus-visible \{ outline-width: 3px; \}/u, 'inputs: 3 px under more contrast');
  assert.match(antidetect, /\.fp-combobox:focus-within \{ border-color: var\(--rd-focus\); outline: 2px solid var\(--rd-focus\);/u, 'combobox frame');
  assert.match(antidetect, /@media \(prefers-contrast: more\) \{ \.management-shell \.fp-combobox:focus-within \{ outline-width: 3px; \} \}/u);
  assert.match(rules, /\.command-palette__field:focus-within \{ outline: 2px solid var\(--rd-focus\);/u, 'the palette search field shows focus');
  assert.doesNotMatch(rules, /#root#root :focus-visible \{/u, 'still no global focus override');
});

test('ADR-107 WCAG 2.4.11: Options scroll padding keeps focus clear of the sticky header and the sticky bottom bars', () => {
  const management = readFileSync(resolve(import.meta.dirname, '../../apps/production-extension/management-ui.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const base = /:root:has\(> body\.management-page\) \{ scroll-padding-block: (\d+)px (\d+)px; \}/u.exec(management);
  assert.ok(base, 'scroll padding on the Options root scroller');
  const header = Number(/\.management-header \{[^}]*min-height: (\d+)px/u.exec(management)[1]);
  assert.ok(Number(base[1]) >= header + 12, 'start padding clears the ' + header + ' px sticky header');
  assert.ok(Number(base[2]) >= 96, 'end padding clears a sticky save or action bar');
  assert.match(management, /@media \(max-width: 1119px\) \{ :root:has\(> body\.management-page\) \{ scroll-padding-block-start: 16px; \} \}/u, 'the narrow header scrolls away');
  assert.match(management, /@media \(max-width: 480px\) \{ :root:has\(> body\.management-page\) \{ scroll-padding-block-end: (1[5-9]\d|[2-9]\d\d)px; \} \}/u, 'wrapped phone bars');
});
