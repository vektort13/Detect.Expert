// ADR-103: static guards for redesign.css rules that earlier owner decisions and native checks depend on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(import.meta.dirname, '../../apps/production-extension');
const css = readFileSync(resolve(directory, 'redesign.css'), 'utf8');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

test('ADR-103 switches keep a legible font size; only decorative children are removed', () => {
  assert.doesNotMatch(rules, /font-size:\s*0[;\s}]/, 'no zero font size (button text rules require 12px or more)');
  assert.match(rules, /\[role=switch\]\) > :not\(\.sr-only\) \{ display: none; \}/, 'decorative switch children are hidden');
  assert.match(rules, /\[role=switch\]\) > \.sr-only \{/, 'live regions inside switches stay readable');
  assert.match(rules, /:dir\(rtl\)::before \{ inset: 2px 2px auto auto; \}/, 'right-to-left thumb starts at the inline start');
});

test('ADR-103 keeps the component focus rings, including forced colors', () => {
  assert.doesNotMatch(rules, /#root#root :focus-visible \{/, 'no global focus override over the 3px component rings');
  assert.match(rules, /--focus: var\(--rd-focus\)/, 'legacy focus rules use the redesign focus colour');
});

test('ADR-103 keeps the ADR-094 brand layer and the ADR-099 identity hues', () => {
  assert.doesNotMatch(rules, /\.management-brand::(before|after)[^{]*\{[^}]*content:\s*none/, 'brand corner marks and scan line stay');
  assert.doesNotMatch(rules, /--theme-category-(hardware|os|browser):/, 'palette category hues are not neutralized');
  assert.doesNotMatch(rules, /\.antidetect-category \.antidetect-icon \{[^}]*currentColor/, 'Antidetect category icons keep their hue');
  assert.match(rules, /\.proxy-workspace-protocol-card \{[^}]*color: var\(--proxy-color\)/, 'Proxy protocol cards keep their hue');
  assert.doesNotMatch(rules, /--theme-site-stroke:\s*var\(--rd-/, 'Autosurfer topic and system chips keep their hue');
});

test('ADR-103 narrow Options header grows with its rows instead of overlapping the navigation', () => {
  for (const width of [1119, 600, 380]) assert.ok(css.includes('@media screen and (max-width: ' + width + 'px)'), width + 'px block');
  const narrow = rules.slice(rules.indexOf('@media screen and (max-width: 1119px)'));
  assert.match(narrow, /\.management-header \{[^}]*height: auto;/, 'header height follows its rows');
  assert.match(narrow, /\.management-navigation \{[^}]*position: relative;[^}]*height: auto;/, 'navigation stays in flow below the header');
  assert.match(narrow, /grid-template-areas: "brand brand brand brand" "menu search theme language"/, 'very narrow widths give the brand its own row');
});

test('ADR-103 composite fields keep one frame: the wrapper is the field and the inner input stays borderless', () => {
  for (const wrapper of ['.autosurf-sites-search', '.autosurf-sites-system-search', '.autosurf-sites-country__search', '.antidetect-math-search']) assert.ok(rules.includes(wrapper), wrapper);
  assert.ok(rules.includes('.antidetect-math-search) :is(input:not([type=checkbox]):not([type=radio]):not([type=range])):focus-visible { border: 0; border-radius: 0; background: transparent; box-shadow: none; outline: 0; }'), 'inner inputs stay borderless, also on focus');
});

test('ADR-103 motion layer is gated, transform-free on measured elements and keeps forced-colors last', () => {
  const opener = '@media screen and (prefers-reduced-motion: no-preference) {';
  const start = rules.indexOf(opener);
  assert.ok(start >= 0, 'motion block is gated on prefers-reduced-motion: no-preference');
  const end = rules.indexOf('\n}\n', start);
  assert.ok(end > start, 'motion block is closed');
  const motion = rules.slice(start, end);
  for (const banned of ['infinite', 'translateX', 'will-change', '!important', 'animation-delay']) assert.ok(!motion.includes(banned), 'motion block has no ' + banned);
  assert.doesNotMatch(motion, /transition[^;{}]*\b(all|transform|width|height|margin|inset|grid-template)/, 'transitions animate paint properties only');
  assert.doesNotMatch(motion, /scale\((1\.\d*[1-9]|[2-9])/, 'nothing scales above 1');
  assert.doesNotMatch(motion, /api-config-overlay/, 'the fixed API overlay never gets a transform');
  const media = [...rules.matchAll(/@media[^{]*\{/g)].map(match => match[0]);
  assert.equal(media.at(-1), '@media (forced-colors: active) {', 'forced-colors stays the last block');
});

// ---- ADR-107: dark palettes follow the chosen theme. light-dark() reads the root color-scheme, which theme-bootstrap.js and
// themes.css set from the chosen theme in popup, side panel and Options, and which ui.css sets to `light dark` (the system) in the
// windows without themes. The few rules that cannot be light-dark() pairs are keyed on [data-ui-theme-effective] or, for the
// windows without themes, on a root without data-ui-theme inside the system media query.
const THEMED_FILES = Object.freeze(['ui.css', 'button-surfaces.css', 'identification-ui.css', 'protection-ui.css', 'api-configuration-ui.css', 'antidetect-math-ui.css', 'cookies-ui.css', 'autosurf.css', 'autosurf-sites.css', 'proxy-ui.css', 'popup.css', 'antidetect-ui.css']);
const DARK_EFFECTIVE = Object.freeze(['system-dark', 'aurora', 'graphite', 'glass']), LIGHT_EFFECTIVE = Object.freeze(['system-light', 'pearl', 'orchid']);
function cssRules(source, media = []) {
  const out = []; let at = 0;
  while (at < source.length) {
    const open = source.indexOf('{', at); if (open < 0) break;
    let depth = 0, end = open;
    for (; end < source.length; end++) { if (source[end] === '{') depth++; else if (source[end] === '}' && --depth === 0) break; }
    const prelude = source.slice(at, open).trim(), body = source.slice(open + 1, end);
    if (prelude.startsWith('@media') || prelude.startsWith('@supports') || prelude.startsWith('@container')) out.push(...cssRules(body, [...media, prelude]));
    else if (!prelude.startsWith('@')) out.push({ media, selector: prelude, body });
    at = end + 1;
  }
  return out;
}
// Splits light-dark(a, b) at its top-level comma; the arguments may hold color-mix(), rgb() or var().
function lightDarkPairs(text) {
  const pairs = []; let from = 0;
  for (;;) {
    const start = text.indexOf('light-dark(', from); if (start < 0) return pairs;
    let depth = 0, comma = -1, end = start + 'light-dark('.length;
    for (; end < text.length; end++) {
      const char = text[end];
      if (char === '(') depth++; else if (char === ')') { if (depth === 0) break; depth--; } else if (char === ',' && depth === 0 && comma < 0) comma = end;
    }
    pairs.push([text.slice(start + 11, comma).trim(), text.slice(comma + 1, end).trim()]); from = end + 1;
  }
}
// Which dark-only rules apply: on a themed page the effective theme decides, on a page without theme the system does.
function darkRulesApplying(source, { effective = null, system }) {
  return cssRules(source).filter(rule => {
    const systemDark = rule.media.some(media => /prefers-color-scheme:\s*dark/u.test(media));
    const keyed = /data-ui-theme-effective="/u.test(rule.selector), untheme = /:not\(\[data-ui-theme\]\)/u.test(rule.selector);
    if (systemDark) return effective === null && system === 'dark' && untheme;
    if (keyed) return effective !== null && rule.selector.split(/,(?![^()]*\))/u).every(part => [...part.matchAll(/data-ui-theme-effective="([^"]+)"/gu)].some(match => match[1] === effective));
    return false;
  });
}
const sheet = file => readFileSync(resolve(directory, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('ADR-107 every theme-aware stylesheet follows the chosen theme: no system-only dark block on a themed page', () => {
  for (const file of THEMED_FILES) {
    const source = sheet(file), parsed = cssRules(source);
    for (const rule of parsed.filter(item => item.media.some(media => /prefers-color-scheme/u.test(media)))) {
      for (const part of rule.selector.split(/,(?![^()]*\))/u)) assert.match(part, /:not\(\[data-ui-theme\]\)/u, file + ': a system dark rule must be limited to a root without theme: ' + part.trim());
    }
    for (const rule of parsed.filter(item => /data-ui-theme-effective="/u.test(item.selector))) {
      for (const part of rule.selector.split(/,(?![^()]*\))/u)) {
        assert.deepEqual([...part.matchAll(/data-ui-theme-effective="([^"]+)"/gu)].map(match => match[1]).sort(), [...DARK_EFFECTIVE].sort(), file + ': keyed on all four dark palettes and no light one');
        assert.match(part, /:(?:where|is)\(/u, file + ': the condition adds no specificity');
      }
    }
    const pairs = lightDarkPairs(source);
    assert.ok(pairs.length > 0 || parsed.some(item => /data-ui-theme-effective="/u.test(item.selector)), file + ': has theme-aware values');
    for (const [light, dark] of pairs) { assert.ok(light && dark, file + ': two arguments'); assert.notEqual(light, dark, file + ': ' + light); }
  }
  // report.html pins `color-scheme: light` for its paper, so the files it loads (ui.css, identification-ui.css, button-surfaces.css)
  // use keyed whole rules instead of light-dark() pairs; every other file uses light-dark().
  for (const file of ['ui.css', 'identification-ui.css', 'button-surfaces.css']) assert.equal(lightDarkPairs(sheet(file)).length, 0, file + ': no light-dark() on the report page');
  for (const [file, pair] of [['ui.css', '--error: #ff9a91;'], ['ui.css', '.technique-icon__wash:where(:root:not([data-ui-theme]) *) { fill-opacity: 0.18; }'],
    ['identification-ui.css', '.identification-tab[data-identification-tab="active"]:where(:root:not([data-ui-theme]) *) { --identification-ink: #88adff; }'], ['protection-ui.css', '.blocking-segmented__option--on { color: light-dark(#176d3e, #7cdda3); }'],
    ['api-configuration-ui.css', '.api-usage-badge--observed { color: light-dark(#17626b, #a1dfe7); background: light-dark(#e7f5f7, #183b43); border-color: light-dark(#c9e8ec, #345b65); }'],
    ['api-configuration-ui.css', '--acu-text: var(--rd-text, var(--text, light-dark(#131a29, #e8ecf4)))'], ['antidetect-math-ui.css', 'color: light-dark(#8251b7, #cfaaef)'],
    ['cookies-ui.css', '--cw-partition: light-dark(#7a58bd, #c7a6f2)'], ['autosurf.css', '--as-ok: var(--rd-ok, light-dark(#16764f, #7bd8ba))'],
    ['autosurf-sites.css', '.autosurf-sites-feedback.is-error { color: light-dark(#b8324c, #fb7185); }'], ['autosurf-sites.css', 'linear-gradient(135deg, light-dark(transparent, #3978f10d), transparent 50%)'],
    ['proxy-ui.css', '--proxy-tint: light-dark(#2866ce14, #6a9bea18)'], ['popup.css', '--popup-scroll-thumb: light-dark(#647c9f, #91a7c6)']]) assert.ok(sheet(file).includes(pair), file + ': ' + pair);
  assert.match(sheet('ui.css'), /:root \{\s*color-scheme: light dark;/u, 'windows without themes keep following the system');
});

test('ADR-107 a light theme on a dark system and a dark theme on a light system, file by file', () => {
  for (const file of THEMED_FILES) {
    const source = sheet(file);
    for (const effective of LIGHT_EFFECTIVE) assert.deepEqual(darkRulesApplying(source, { effective, system: 'dark' }).map(rule => rule.selector), [], file + ': ' + effective + ' on a dark system gets no dark rule');
    const keyed = cssRules(source).filter(rule => /data-ui-theme-effective="/u.test(rule.selector) && !rule.media.some(media => /prefers-color-scheme/u.test(media)));
    const fallback = cssRules(source).filter(rule => rule.media.some(media => /prefers-color-scheme:\s*dark/u.test(media)));
    for (const effective of DARK_EFFECTIVE) assert.equal(darkRulesApplying(source, { effective, system: 'light' }).length, keyed.length, file + ': ' + effective + ' on a light system gets every dark rule');
    assert.equal(darkRulesApplying(source, { system: 'dark' }).length, fallback.length, file + ': without a theme the system decides, as before');
    assert.equal(darkRulesApplying(source, { system: 'light' }).length, 0, file);
    assert.equal(keyed.length, fallback.length, file + ': every keyed dark rule has its system twin for windows without themes');
  }
  // The same rules in both forms: the keyed set and the system twin declare identical selectors and values.
  const strip = rule => rule.selector.replaceAll(/:where\(:root:is\([^)]*\]\) \*\)|:where\(\[data-ui-theme-effective[^)]*\]\)/gu, '').replaceAll(/:where\(:root:not\(\[data-ui-theme\]\) \*\)|:where\(:not\(\[data-ui-theme\]\)\)/gu, '').replace(/\s+/gu, ' ').trim() + '{' + rule.body.replace(/\s+/gu, ' ').trim();
  for (const [file, minimum] of [['button-surfaces.css', 10], ['ui.css', 3], ['identification-ui.css', 7]]) {
    const parsed = cssRules(sheet(file));
    const keyedSet = parsed.filter(rule => /data-ui-theme-effective="/u.test(rule.selector)).map(strip), fallbackSet = parsed.filter(rule => rule.media.some(media => /prefers-color-scheme/u.test(media))).map(strip);
    assert.ok(keyedSet.length >= minimum, file); assert.deepEqual(keyedSet, fallbackSet, file);
  }
});

test('ADR-107 the Firewall overlay, built from ui.css and button-surfaces.css, keeps following the system', () => {
  // The same two rewrites as scripts/production/build-protect.mjs (overlay-styles.ts): the overlay has no :root, html or body.
  const overlay = ['ui.css', 'button-surfaces.css'].map(sheet).join('\n').replace(/:root\s+body\b/g, '.protect-overlay-page').replace(/:root\b|\bbody\b|\bhtml\b/g, '.protect-overlay-page');
  const parsed = cssRules(overlay);
  assert.ok(parsed.some(rule => rule.selector === '.protect-overlay-page' && /color-scheme: light dark/u.test(rule.body)), 'light-dark() pairs take the system side inside the overlay');
  const keyed = parsed.filter(rule => /data-ui-theme-effective/u.test(rule.selector)), fallback = parsed.filter(rule => rule.media.some(media => /prefers-color-scheme/u.test(media)));
  assert.ok(keyed.length >= 10 && fallback.length === keyed.length);
  for (const rule of keyed) for (const part of rule.selector.split(/,(?![^()]*\))/u)) assert.match(part, /\.protect-overlay-page:(?:where|is)\(\[data-ui-theme-effective/u, 'a chosen-theme rule never matches the overlay page: ' + part);
  for (const rule of fallback) for (const part of rule.selector.split(/,(?![^()]*\))/u)) {
    assert.match(part, /\.protect-overlay-page(?::where\(:not\(\[data-ui-theme\]\)\)|:not\(\[data-ui-theme\]\) \*)/u, 'the system twin matches the overlay page: ' + part);
    assert.doesNotMatch(part, /\.protect-overlay-page\S*\s+\.protect-overlay-page/u, 'no doubled page element: ' + part);
  }
});

test('ADR-107 every page with these stylesheets has the scheme light-dark() reads: chosen theme or the system', () => {
  const pages = ['options.html', 'popup.html', 'sidepanel.html', 'protection.html', 'report.html', 'findings.html', 'firewall.html', 'requests.html', 'activation-toast.html', 'precursor-settings.html', 'proxy-geo-settings.html', 'privacy.html'];
  for (const page of pages) {
    const html = readFileSync(resolve(directory, page), 'utf8'), links = [...html.matchAll(/href="([a-z0-9-]+\.css)"/gu)].map(match => match[1]);
    if (!links.some(name => THEMED_FILES.includes(name))) continue;
    assert.ok(links.includes('ui.css'), page + ': ui.css provides color-scheme: light dark');
    const themed = html.includes('theme-bootstrap.js');
    if (themed) assert.ok(links.includes('themes.css') && links.indexOf('themes.css') > Math.max(...links.filter(name => THEMED_FILES.includes(name)).map(name => links.indexOf(name))), page + ': themes.css follows and sets the chosen scheme');
    // Without a theme, light-dark() follows the system only while no stylesheet pins the root scheme (report.css does, for paper).
    const pinned = links.filter(name => /:root\s*\{[^}]*color-scheme:\s*(?:light|dark)\s*;/u.test(sheet(name)));
    if (!themed && pinned.length) for (const name of links.filter(item => THEMED_FILES.includes(item))) assert.equal(lightDarkPairs(sheet(name)).length, 0, page + ': ' + name + ' uses light-dark() under the scheme pinned by ' + pinned.join(', '));
  }
});
