// ADR-047 (S3, port plan §2.5 «Внешний вид», §5.2): palette of the module «Защита» in the production look. The
// effective tokens are computed from the shipped stylesheets in their load order (ui.css, button-surfaces.css,
// protect.css: :root blocks under `screen` and `(prefers-color-scheme: dark)`), the module token --accent-bg included;
// every text / background pair the recolouring layer relies on reaches WCAG AA 4.5:1 in light and dark. The production
// layer (apps/production-protect/src/styles/*.css) uses tokens only, no animation, is scoped to the module containers
// (no production surface changes), keeps the two decision buttons alike and has a forced-colors block.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../..');
const ext = join(root, 'apps/production-extension');
const stylesDir = join(root, 'apps/production-protect/src/styles');
const read = (path) => readFileSync(path, 'utf8');

/** CSS without block comments. */
function withoutComments(css) {
  let out = '';
  let i = 0;
  for (;;) {
    const start = css.indexOf('/*', i);
    if (start < 0) return out + css.slice(i);
    out += css.slice(i, start);
    const end = css.indexOf('*/', start + 2);
    if (end < 0) return out;
    i = end + 2;
  }
}

/** Rules in source order: { media: [conditions], selector, body } (at-rules other than @media/@supports skipped). */
function rules(css, media = []) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    let depth = 0;
    let j = open;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}' && --depth === 0) break;
    }
    const prelude = css.slice(i, open).trim();
    const body = css.slice(open + 1, j);
    if (prelude.startsWith('@media')) out.push(...rules(body, [...media, prelude.slice(6).trim()]));
    else if (prelude.startsWith('@supports')) out.push(...rules(body, [...media, 'supports']));
    else if (!prelude.startsWith('@')) out.push({ media, selector: prelude, body });
    i = j + 1;
  }
  return out;
}

function declarations(body) {
  const out = [];
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    out.push([part.slice(0, colon).trim(), part.slice(colon + 1).trim()]);
  }
  return out;
}

// ADR-107: the module pages and the Firewall overlay have no chosen theme (no data-ui-theme on the root) and ui.css gives them
// `color-scheme: light dark`, so light-dark() pairs take the system side and the roots keyed on a missing theme apply; the
// roots keyed on a chosen theme ([data-ui-theme-effective=…]) never apply there.
const UNTHEMED_ROOTS = new Set([':root', ':root:where(:not([data-ui-theme]))']);
/** light-dark(a, b) with a top-level comma (the arguments may hold rgb(...)); other values are returned unchanged. */
function scheme(value, theme) {
  const match = /^light-dark\((.*)\)$/s.exec(value.trim());
  if (match === null) return value;
  let depth = 0;
  for (let index = 0; index < match[1].length; index++) {
    const char = match[1][index];
    if (char === '(') depth++; else if (char === ')') depth--;
    else if (char === ',' && depth === 0) return (theme === 'dark' ? match[1].slice(index + 1) : match[1].slice(0, index)).trim();
  }
  return value;
}
/** Effective custom properties of :root for a theme, in cascade (source) order of the given stylesheets. */
function tokens(files, theme) {
  const active = (condition) => condition === 'screen' || (theme === 'dark' && condition === '(prefers-color-scheme: dark)');
  const values = {};
  for (const file of files) {
    for (const rule of rules(withoutComments(read(join(ext, file))))) {
      if (!UNTHEMED_ROOTS.has(rule.selector) || !rule.media.every(active)) continue;
      for (const [name, value] of declarations(rule.body)) if (name.startsWith('--')) values[name] = scheme(value, theme);
    }
  }
  const resolveValue = (value, depth = 0) => {
    const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    if (ref === null || depth > 8) return value;
    return resolveValue(values[ref[1]] ?? '', depth + 1);
  };
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, resolveValue(v)]));
}

function luminance(hex) {
  const full = hex.length === 4 ? '#' + [...hex.slice(1)].map((c) => c + c).join('') : hex;
  const channels = [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Solid colours of a token: the colour itself, or every stop of a gradient. */
function colours(value) {
  return [...value.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)].map((m) => m[0]);
}

const STACK = ['ui.css', 'button-surfaces.css', 'protect.css'];
/** [text token, background token, where the module uses the pair]. */
const PAIRS = [
  ['--text', '--surface', 'card text'],
  ['--muted', '--surface', 'notes, site line, scope summary'],
  ['--text', '--surface-2', 'unselected scope segment, grouped settings rows'],
  ['--muted', '--surface-2', 'fieldset legends'],
  ['--accent', '--surface', 'chosen scope segment, text actions, evidence summary'],
  ['--accent', '--accent-bg', 'card icon, active state label'],
  ['--accent-contrast', '--accent', 'primary action token'],
  ['--text', '--attention-bg', 'sent alert'],
  ['--attention', '--attention-bg', 'attention state label'],
  ['--error', '--surface', 'rule that did not apply'],
  ['--accent', '--selected-fill', 'chosen history retention'],
  ['--text', '--control-fill', 'chips'],
  ['--accent', '--surface-2', 'firewall popup (S4b): text actions on the footer band'],
];

for (const theme of ['light', 'dark']) {
  test('AA 4.5:1 for the module pairs in the production palette (' + theme + ')', () => {
    const t = tokens(STACK, theme);
    assert.equal(t['--accent-bg'], t['--accent-soft'], 'module --accent-bg follows the production --accent-soft');
    for (const [fg, bg, use] of PAIRS) {
      const fgs = colours(t[fg] ?? '');
      const bgs = colours(t[bg] ?? '');
      assert.equal(fgs.length, 1, theme + ' ' + fg + ' = ' + t[fg]);
      assert.ok(bgs.length >= 1, theme + ' ' + bg + ' = ' + t[bg]);
      for (const colour of bgs) {
        const ratio = contrast(fgs[0], colour);
        assert.ok(ratio >= 4.5, theme + ': ' + fg + ' ' + fgs[0] + ' on ' + bg + ' ' + colour + ' = ' + ratio.toFixed(2) + ' (' + use + ')');
      }
    }
  });
}

test('the light and dark palettes differ (dark mode is real, not the light tokens)', () => {
  const light = tokens(STACK, 'light');
  const dark = tokens(STACK, 'dark');
  for (const name of ['--surface', '--text', '--accent', '--accent-bg', '--attention-bg']) assert.notEqual(light[name], dark[name], name);
});

const OWN = readdirSync(stylesDir).filter((name) => name.endsWith('.css')).sort();
// S4b: .protect-firewall = firewall.html, the firewall as its own action popup (body.protect-firewall-page, main.protect-firewall).
// ADR-051 explicitly shares the API/Firewall launcher row; all other selectors remain module-scoped.
const SCOPES = ['.protect-island', '.protect-page', '.protect-launcher', '.protect-requests', '.protect-firewall', '.protect-findings', '.protect-activation', '.protect-overlay'];

/** Top-level comma split (commas inside parentheses stay). */
function selectors(prelude) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < prelude.length; i++) {
    if (prelude[i] === '(') depth++;
    else if (prelude[i] === ')') depth--;
    else if (prelude[i] === ',' && depth === 0) {
      out.push(prelude.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(prelude.slice(start).trim());
  return out;
}

test('production layer: tokens only, no animation, module/shared-row scopes, decision buttons alike', () => {
  assert.deepEqual(OWN, ['activation-toast.css', 'findings-popup.css', 'firewall-popup.css', 'inline-settings.css', 'overlay.css', 'production.css', 'surfaces.css']);
  const shipped = read(join(ext, 'protect.css'));
  for (const name of OWN) {
    const css = withoutComments(read(join(stylesDir, name)));
    assert.ok(shipped.includes(read(join(stylesDir, name)).replace(/\r\n/g, '\n').replace(/\n*$/, '\n')), name + ' is part of protect.css');
    assert.equal(/#[0-9a-f]{3,8}\b/i.test(css), false, name + ': literal hex colour');
    assert.equal(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i.test(css), false, name + ': literal colour function');
    assert.equal(/\b(?:animation|transition)\s*:|@keyframes/.test(css.replace(/\b(?:animation|transition)\s*:\s*none\s*;/g, '')), false, name + ': animation');
    for (const rule of rules(css)) {
      for (const selector of selectors(rule.selector)) {
        if (name === 'overlay.css' && /^:host(?:\(\[data-protect-overlay-kind="(?:activation|findings)"\]\))?(?:::backdrop)?$/.test(selector)) continue;
        if (selector === ':root') {
          assert.deepEqual(declarations(rule.body).map(([k]) => k), ['--accent-bg'], name + ': :root only maps the module token');
          continue;
        }
        const sharedRow = name === 'production.css' && /(?:^|[\s>])\.inspector-tools(?=[\s:.\[]|$)/.test(selector);
        assert.ok(sharedRow || SCOPES.some((scope) => selector.includes(scope)), name + ': unscoped selector ' + selector);
        assert.equal(selector.includes('data-fw-action'), false, name + ': the decision buttons are styled alike');
      }
    }
  }
  const surfaces = read(join(stylesDir, 'surfaces.css'));
  assert.ok(surfaces.includes('@media (forced-colors: active)'), 'forced-colors block');
  assert.ok(surfaces.includes('@media (prefers-contrast: more)'), 'prefers-contrast block');
});
