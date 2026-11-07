// Live audit 2026-11-05 (D-screen-1/2/3/8): who owns the viewport, media types in the JS media
// evaluator, device/orientation features and CSS.supports text normalisation.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createApiConfiguration, updateApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';
import { buildApiCustomScripts } from '../../apps/production-extension/api-custom-registration.js';

const source = readFileSync(new URL('../../apps/production-extension/api-custom-environment-runtime.js', import.meta.url), 'utf8').replace(/^export /m, '');
const entry = (id, value, mode = 'custom') => ({ id, value, mode });

// ---- Reference evaluator: an independent three-valued subset of Media Queries (true / false / undefined = unknown).
const TYPES = { all: true, screen: true, print: false, speech: false, tty: false, tv: false, projection: false, handheld: false, braille: false, embossed: false, aural: false };
const and3 = (a, b) => (a === false || b === false ? false : a === undefined || b === undefined ? undefined : true);
const or3 = (a, b) => (a === true || b === true ? true : a === undefined || b === undefined ? undefined : false);
const not3 = a => (a === undefined ? undefined : !a);
const NUMERIC = ['width', 'height', 'device-width', 'device-height', 'resolution', '-webkit-device-pixel-ratio'];
function amount(text, name) {
  const match = /^(-?\d+(?:\.\d+)?)(px|dppx|dpi|x)?$/.exec(text.trim());
  if (!match) return undefined;
  const number = Number(match[1]), unit = match[2];
  if (name === 'resolution') return unit === 'dppx' || unit === 'x' ? number : unit === 'dpi' ? number / 96 : undefined;
  if (name === '-webkit-device-pixel-ratio') return unit === undefined ? number : undefined;
  return unit === 'px' || (unit === undefined && number === 0) ? number : undefined;
}
function read(name, state) {
  if (name === 'orientation') return state.width === undefined || state.height === undefined ? undefined : state.height >= state.width ? 'portrait' : 'landscape';
  return name === '-webkit-device-pixel-ratio' ? state.resolution : state[name];
}
function group(text, state) {
  const inner = text.slice(1, -1).trim();
  if (/[()]/.test(inner)) return undefined;
  let match = /^([a-z-]+)$/.exec(inner);
  if (match) { const value = read(match[1], state); return value === undefined ? undefined : value !== 0 && value !== 'none'; }
  match = /^([a-z-]+)\s*:\s*(.+)$/.exec(inner);
  if (match) {
    let name = match[1], mode = '=';
    const prefixed = /^-webkit-(min-|max-)(device-pixel-ratio)$/.exec(name), plain = /^(min-|max-)(.+)$/.exec(name);
    if (prefixed) { mode = prefixed[1]; name = '-webkit-' + prefixed[2]; } else if (plain && NUMERIC.includes(plain[2])) { mode = plain[1]; name = plain[2]; }
    const value = read(name, state);
    if (value === undefined) return undefined;
    if (typeof value === 'string') return mode === '=' ? value === match[2].trim() : undefined;
    const bound = amount(match[2], name);
    if (bound === undefined) return undefined;
    return mode === 'min-' ? value >= bound : mode === 'max-' ? value <= bound : value === bound;
  }
  const flip = { '<': '>', '>': '<', '<=': '>=', '>=': '<=', '=': '=' };
  let name, operator, bound;
  if ((match = /^([a-z-]+)\s*(<=|>=|<|>|=)\s*([^<>=]+)$/.exec(inner))) { name = match[1]; operator = match[2]; bound = match[3]; }
  else if ((match = /^([^<>=]+?)\s*(<=|>=|<|>|=)\s*([a-z-]+)$/.exec(inner))) { name = match[3]; operator = flip[match[2]]; bound = match[1]; }
  if (!name || !NUMERIC.includes(name) || name === '-webkit-device-pixel-ratio') return undefined;
  const value = read(name, state), limit = amount(bound, name);
  if (value === undefined || limit === undefined) return undefined;
  return operator === '<' ? value < limit : operator === '<=' ? value <= limit : operator === '>' ? value > limit : operator === '>=' ? value >= limit : value === limit;
}
// Bottom-up reference: every innermost "( ... )" is replaced by a token T / F / U (true / false / unknown), then the
// remaining "[not|only] type [and tokens]" or token expression is reduced. Anything malformed is unknown.
const TOKEN = { true: 'T', false: 'F', undefined: 'U' }, VALUE = { T: true, F: false, U: undefined };
function reduce(expression) {
  const words = expression.trim().split(/\s+/);
  if (words.length === 1) return Object.hasOwn(VALUE, words[0]) ? words[0] : null;
  if (words.length === 2 && words[0] === 'not' && Object.hasOwn(VALUE, words[1])) return TOKEN[not3(VALUE[words[1]])];
  const joiner = words[1];
  if (words.length < 3 || words.length % 2 === 0 || (joiner !== 'and' && joiner !== 'or') || !Object.hasOwn(VALUE, words[0])) return null;
  let result = VALUE[words[0]];
  for (let index = 1; index < words.length; index += 2) {
    if (words[index] !== joiner || !Object.hasOwn(VALUE, words[index + 1])) return null;
    result = joiner === 'and' ? and3(result, VALUE[words[index + 1]]) : or3(result, VALUE[words[index + 1]]);
  }
  return TOKEN[result];
}
function collapse(text, state) {
  for (let guard = 0; guard < 64 && text.includes('('); guard++) {
    const match = /\(([^()]*)\)/.exec(text);
    if (!match) return null;
    const inner = match[1].trim(), condition = reduce(inner);
    text = text.slice(0, match.index) + (condition !== null ? condition : TOKEN[group('(' + inner + ')', state)]) + text.slice(match.index + match[0].length);
  }
  return text.includes(')') ? null : text;
}
// unknownType: undefined = the evaluator does not know such a media type; false = the real engine (never matches).
function alternative(text, state, types, unknownType) {
  const collapsed = collapse(text.trim(), state);
  if (collapsed === null) return undefined;
  const condition = reduce(collapsed);
  if (condition !== null) return VALUE[condition];
  const match = /^(?:(not|only)\s+)?([a-z]+)(?:\s+and\s+(.+))?$/.exec(collapsed);
  if (!match) return undefined;
  const known = Object.hasOwn(types, match[2]);
  if (!known && unknownType === undefined) return undefined;
  let result = known ? types[match[2]] : unknownType;
  if (match[3] !== undefined) {
    const rest = /\bor\b/.test(match[3]) ? null : reduce(match[3]);
    if (rest === null) return undefined;
    result = and3(result, VALUE[rest]);
  }
  return match[1] === 'not' ? not3(result) : result;
}
const reference = (query, state, types = TYPES, unknownType = undefined) => query.toLowerCase().split(',').map(part => alternative(part, state, types, unknownType)).reduce(or3, false);

// The real browser window (viewport 1280x720 on a 1920x1080 screen at DPR 1) and the selected profile
// (a 1366x768 laptop at DPR 1.5, dark scheme). The profile says nothing about hover/pointer.
const REAL = { width: 1280, height: 720, 'device-width': 1920, 'device-height': 1080, resolution: 1, 'prefers-color-scheme': 'light', hover: 'hover', pointer: 'fine' };
const PROFILE = { width: 1366, height: 768, 'device-width': 1366, 'device-height': 768, resolution: 1.5, 'prefers-color-scheme': 'dark' };
const FRAME = { ...PROFILE, width: undefined, height: undefined };
const NATIVE = query => reference(query, REAL, TYPES, false) === true;
// Decided by the selection when possible, otherwise the whole native answer.
const expected = (query, state, real = REAL) => { const selected = reference(query, state); return selected !== undefined ? selected : reference(query, real, TYPES, false) === true; };

function fixture(entries, { frame = false, opener = false, top = true, broken = false, size = [1280, 720], native = NATIVE, supports = true, extra = '' } = {}) {
  const context = vm.createContext({ input: structuredClone(entries), nativeEngine: native, nativeSupports: supports, mode: { frame, opener, top, broken }, size });
  vm.runInContext(`
    const D = Object.defineProperty, A = Reflect.apply;
    globalThis.calls = { match: 0, matches: 0, media: 0, supports: 0, top: 0, opener: 0 };
    globalThis.reason = new TypeError('Synthetic native brand');
    const queries = new WeakMap();
    class MediaQueryList {
      constructor(query) { queries.set(this, query); }
      get media() { calls.media++; if (!queries.has(this)) throw reason; return queries.get(this); }
      get matches() { calls.matches++; if (!queries.has(this)) throw reason; return nativeEngine(queries.get(this)); }
    }
    globalThis.realm = { Object, Array, Promise, MediaQueryList };
    const nativeNumbers = { innerWidth: size[0], innerHeight: size[1], outerWidth: 1290, outerHeight: 800, screenX: 7, screenY: 8 };
    for (const key of Object.keys(nativeNumbers)) D(realm, key, { configurable: true, enumerable: true, get() { if (this !== realm) throw reason; return nativeNumbers[key]; } });
    const other = {};
    if (mode.top) D(realm, 'top', { configurable: false, enumerable: true, get() { calls.top++; if (mode.broken) throw reason; return mode.frame ? other : realm; } });
    D(realm, 'opener', { configurable: true, enumerable: true, get() { calls.opener++; return mode.opener ? other : null; }, set() {} });
    realm.matchMedia = { matchMedia(query) { calls.match++; if (this !== realm) throw reason; return new MediaQueryList(String(query)); } }.matchMedia;
    realm.CSS = { supports: { supports(a, b) { calls.supports++; if (arguments.length === 0) throw reason; return nativeSupports; } }.supports };
    ${extra}
    ${source}
    globalThis.guard = installApiCustomEnvironment(realm, input);
  `, context);
  return { context, run: code => vm.runInContext(code, context) };
}
const ask = (f, query) => f.run(`realm.matchMedia(${JSON.stringify(query)}).matches`);
function mismatches(f, queries, state, real = REAL) {
  const wrong = [];
  for (const query of queries) { const got = ask(f, query), want = expected(query, state, real); if (got !== want) wrong.push(`${query} => ${got}, expected ${want}`); }
  return wrong;
}

test('reference evaluator sanity (the oracle itself)', () => {
  assert.equal(reference('screen and (min-width: 1300px)', PROFILE), true);
  assert.equal(reference('screen and (max-width: 1300px)', PROFILE), false);
  assert.equal(reference('not all and (min-width: 1300px)', PROFILE), false);
  assert.equal(reference('not print and (hover: hover)', PROFILE), true);
  assert.equal(reference('(min-width: 1300px) and (hover: hover)', PROFILE), undefined);
  assert.equal(reference('(min-width: 1300px) and (hover: hover)', REAL), false);
  assert.equal(reference('(max-width: 1300px), (hover: hover)', PROFILE), undefined);
  assert.equal(reference('print, (min-width: 1300px)', PROFILE), true);
  assert.equal(reference('(orientation: landscape)', PROFILE), true);
  assert.equal(reference('(device-width >= 1500px)', REAL), true);
  assert.equal(reference('not ((min-width: 1300px) and (orientation: landscape))', PROFILE), false);
  assert.equal(reference('(max-width: 1px) or (hover: hover)', PROFILE), undefined);
  assert.equal(reference('not ((max-width: 1px) and (hover: hover))', PROFILE), true);
  assert.equal(reference('screen and not (min-width: 1300px)', PROFILE), false);
  assert.equal(reference('(min-width: 1300px) and (max-width: 1400px) or (min-height: 1px)', PROFILE), undefined);
  assert.equal(reference('foo and (min-width: 1px)', REAL, TYPES, false), false);
  assert.equal(reference('not foo and (max-width: 1px)', REAL, TYPES, false), true);
});

// ---------------------------------------------------------------- D-screen-1
const GEOMETRY = { innerWidth: 1920, innerHeight: 947, outerWidth: 1920, outerHeight: 1032, screenX: 0, screenY: 0 };
const MEDIA = { viewportWidth: 1920, viewportHeight: 947, resolutionDppx: 1.5 };
const GEOMETRY_ROWS = [entry('screen-geometry', GEOMETRY), entry('css-media', MEDIA)];
const windowValues = f => JSON.parse(f.run('JSON.stringify([realm.innerWidth, realm.innerHeight, realm.outerWidth, realm.outerHeight, realm.screenX, realm.screenY])'));

test('D-screen-1: a top-level window gets the selected inner/outer size and viewport media', () => {
  const f = fixture(GEOMETRY_ROWS);
  assert.deepEqual(windowValues(f), [1920, 947, 1920, 1032, 0, 0]);
  assert.equal(ask(f, '(min-width: 1500px)'), true);
  assert.equal(ask(f, 'screen and (min-width: 1500px)'), true);
  assert.equal(ask(f, '(max-height: 900px)'), false);
});

test('D-screen-1: a frame keeps its own inner size and viewport media; window-wide values stay selected', () => {
  const f = fixture(GEOMETRY_ROWS, { frame: true });
  assert.deepEqual(windowValues(f), [1280, 720, 1920, 1032, 0, 0]);
  assert.equal(ask(f, '(min-width: 1500px)'), false, 'native frame viewport, not the selected 1920');
  assert.equal(ask(f, '(min-width: 1000px)'), true, 'native frame viewport');
  assert.equal(ask(f, 'screen and (min-width: 1500px)'), false);
  assert.equal(ask(f, '(max-height: 740px)'), true, 'native frame height 720');
  assert.equal(ask(f, '(min-resolution: 1.25dppx)'), true, 'device pixel ratio stays selected');
});

test('D-screen-1: the audited 300x150 frame reports 300x150 and a narrow-viewport answer', () => {
  const real = { ...REAL, width: 300, height: 150 };
  const f = fixture(GEOMETRY_ROWS, { frame: true, size: [300, 150], native: query => reference(query, real, TYPES, false) === true });
  assert.deepEqual(windowValues(f), [300, 150, 1920, 1032, 0, 0]);
  assert.equal(ask(f, '(min-width: 1000px)'), false);
  assert.equal(ask(f, '(max-width: 400px)'), true);
  assert.equal(ask(f, 'only screen and (max-width: 400px)'), true);
});

test('D-screen-1: a popup (non-null opener) keeps its own inner size; window-wide values stay selected', () => {
  const f = fixture(GEOMETRY_ROWS, { opener: true });
  assert.deepEqual(windowValues(f), [1280, 720, 1920, 1032, 0, 0]);
  assert.equal(ask(f, '(min-width: 1500px)'), false);
  assert.equal(ask(f, '(min-resolution: 1.25dppx)'), true);
});

test('D-screen-1: a realm without Window.top is not a browsing context and keeps the old behaviour; an unreadable top is a frame', () => {
  assert.deepEqual(windowValues(fixture(GEOMETRY_ROWS, { top: false })), [1920, 947, 1920, 1032, 0, 0]);
  const broken = fixture(GEOMETRY_ROWS, { broken: true });
  assert.deepEqual(windowValues(broken), [1280, 720, 1920, 1032, 0, 0]);
  assert.equal(ask(broken, '(min-width: 1500px)'), false);
});

test('D-screen-1: the viewport decision is taken once at installation and cannot be flipped later', () => {
  const frame = fixture(GEOMETRY_ROWS, { frame: true });
  frame.run('mode.frame = false; mode.opener = false;');
  assert.deepEqual(windowValues(frame), [1280, 720, 1920, 1032, 0, 0]);
  assert.equal(ask(frame, '(min-width: 1500px)'), false);
  const top = fixture(GEOMETRY_ROWS);
  top.run('mode.frame = true; mode.opener = true;');
  assert.deepEqual(windowValues(top), [1920, 947, 1920, 1032, 0, 0]);
  assert.equal(ask(top, '(min-width: 1500px)'), true);
});

test('D-screen-1: Window.top/opener are read only when a viewport value is selected, once per installation', () => {
  const none = fixture([entry('screen-geometry', { outerWidth: 1000 }), entry('navigator-metadata', { product: 'Gecko' })]);
  assert.equal(none.run('calls.top + calls.opener'), 0, 'passive for window-wide and metadata rows');
  const both = fixture(GEOMETRY_ROWS);
  assert.equal(both.run('calls.top'), 1);
  assert.equal(both.run('calls.opener'), 1);
});

test('D-screen-1: On (hide) mode and the frame rule for viewport media do not change window-wide hiding', () => {
  const f = fixture([entry('screen-geometry', {}, 'on')], { frame: true });
  assert.equal(f.run(`'innerWidth' in realm || 'outerWidth' in realm || 'screenX' in realm`), false);
});

test('D-screen-1: stop() restores the native inner size of a top-level window', () => {
  const f = fixture(GEOMETRY_ROWS);
  f.run('guard.stop()');
  assert.deepEqual(windowValues(f), [1280, 720, 1290, 800, 7, 8]);
});

// ---------------------------------------------------------------- D-screen-2 / D-screen-3
const PROFILE_ROWS = [
  entry('css-media', { viewportWidth: 1366, viewportHeight: 768, resolutionDppx: 1.5, colorScheme: 'dark' }),
  entry('screen-width', 1366), entry('screen-height', 768),
];
const MATRIX = [
  // plain forms (regression)
  '(min-width: 1300px)', '(max-width: 1300px)', '(width >= 1300px)', '(1300px > width)', '(min-height: 740px)', '(max-height: 740px)',
  // media type x feature (D-screen-2)
  'screen and (min-width: 1300px)', 'screen and (max-width: 1300px)',
  'only screen and (min-width: 1300px)', 'only screen and (max-width: 1300px)',
  'all and (min-width: 1300px)', 'all and (max-width: 1300px)',
  'not all and (min-width: 1300px)', 'not all and (max-width: 1300px)',
  'not screen and (min-width: 1300px)', 'not screen and (max-width: 1300px)',
  'print and (min-width: 1300px)', 'print and (max-width: 1300px)',
  'not print and (min-width: 1300px)', 'not print and (max-width: 1300px)',
  'speech and (max-width: 1300px)', 'tv and (min-width: 1300px)',
  'screen and (min-width: 1300px) and (max-width: 1400px)', 'screen and (min-width: 1300px) and (min-height: 740px)', 'screen and (min-width: 1300px) and (max-height: 740px)',
  'only screen and (min-width: 1300px) and (max-width: 1400px)', 'SCREEN AND (MIN-WIDTH: 1300PX)',
  // preferences and resolution behind a type
  'screen and (prefers-color-scheme: dark)', 'screen and (prefers-color-scheme: light)', 'not screen and (prefers-color-scheme: dark)',
  'only screen and (min-resolution: 1.25dppx)', 'screen and (max-resolution: 1.25dppx)', 'not screen and (min-resolution: 1.25dppx)',
  // comma lists
  '(min-width: 1300px), print', 'print, (min-width: 1300px)', 'print, (max-width: 1300px)', 'speech, print', 'not all, (max-width: 1300px)',
  'screen and (max-width: 1300px), (min-width: 1300px)', '(max-width: 1300px), (max-height: 740px)', 'print and (min-width: 1px), screen and (min-width: 1300px)',
  // decided although another part is unresolved (three-valued logic, ADR-100)
  '(max-width: 1300px) and (hover: hover)', '(hover: hover) and (max-width: 1300px)', 'print and (hover: hover)', 'not print and (hover: hover)',
  '(min-width: 1300px), (hover: hover)', 'screen and (max-width: 1300px) and (pointer: fine)',
  // undecided: the WHOLE query keeps the native answer
  '(min-width: 1300px) and (hover: hover)', 'screen and (min-width: 1300px) and (pointer: fine)', 'not screen and (min-width: 1300px) and (hover: hover)',
  'only screen and (min-width: 1300px) and (hover: hover)', '(max-width: 1300px), (hover: hover)', '(hover: hover), (max-width: 1300px)', 'not all and (hover: hover)',
  'screen and (unknown-feature: 1)', 'screen and (min-width: 20em)', '(min-width: 1300px) or (max-width: 10px)', 'screen and ((min-width: 1300px))',
  // nested groups, or and media-not (the s17 audit pair with nested parentheses included)
  '((min-width: 1300px) or (max-width: 10px)) and (min-height: 1px)', 'not ((min-width: 1300px))', '((min-width: 1300px) and (max-width: 1400px))',
  'not ((min-width: 1300px) and (orientation: landscape))', '(min-width: 1300px) and (orientation: landscape)', '(((min-width: 1300px)))',
  'screen and not (min-width: 1300px)', 'screen and (not (min-width: 1300px))', 'print or (min-width: 1px)', '(min-width: 1300px) and (max-width: 1400px) or (min-height: 1px)',
  '(max-width: 1299px) or (hover: hover)', '(min-width: 1300px) or (hover: hover)', '((max-width: 1299px) and (hover: hover)) or (min-height: 740px)',
  'not ((max-width: 1299px) and (hover: hover))', 'not ((min-width: 1300px) and (hover: hover))', 'not (not (min-width: 1300px))', 'not not (min-width: 1px)',
  'screen and ((min-width: 1300px) or (max-width: 10px))', '((min-device-width: 1500px) or (orientation: portrait)), (max-width: 1px)',
  // an unknown media type is never decided from the features next to it (not/only qualify the whole alternative)
  'not foo and (max-width: 1px)', 'not foo and (min-width: 1300px)', 'only foo and (min-width: 1300px)', 'foo and (max-width: 1px)', 'foo and (min-width: 1300px)',
  // device size (D-screen-3)
  '(min-device-width: 1500px)', '(max-device-width: 1500px)', '(device-width: 1366px)', 'screen and (device-width: 1366px)', 'screen and (device-width: 1920px)',
  '(device-height: 768px)', '(max-device-height: 900px)', '(device-width >= 1500px)', 'not (device-width: 1366px)',
  'screen and (min-device-width: 1300px) and (max-device-width: 1400px)', '(device-width)',
  // orientation (D-screen-3)
  '(orientation: landscape)', '(orientation: portrait)', 'screen and (orientation: landscape)', 'not (orientation: landscape)', '(orientation)',
  '(min-width: 1300px) and (orientation: landscape)', '(max-width: 1300px) and (orientation: portrait)',
  // pixel ratio (D-screen-3)
  '(-webkit-min-device-pixel-ratio: 1.25)', '(-webkit-max-device-pixel-ratio: 1.25)', '(-webkit-device-pixel-ratio: 1.5)',
  'screen and (-webkit-min-device-pixel-ratio: 1.25)', '(resolution: 1.5x)', '(min-resolution: 1.25x)', '(resolution: 144dpi)',
];

test('D-screen-2: the query matrix of a top-level window equals the reference (decided -> selection, else the whole native answer)', () => {
  assert.ok(MATRIX.length >= 30);
  const f = fixture(PROFILE_ROWS);
  assert.deepEqual(mismatches(f, MATRIX, PROFILE), []);
  assert.equal(f.run('calls.match'), MATRIX.length, 'the page call reaches the native matchMedia exactly once per query');
  // The matrix is not vacuous: many answers differ from the real window, many stay native.
  const decided = MATRIX.filter(query => reference(query, PROFILE) !== undefined);
  assert.ok(decided.filter(query => reference(query, PROFILE) !== NATIVE(query)).length >= 20, 'selected answers that differ from the real window');
  assert.ok(MATRIX.length - decided.length >= 8, 'undecided queries');
});

test('D-screen-2: a frame or popup uses the selection only for device-level features; viewport features stay native', () => {
  for (const options of [{ frame: true }, { opener: true }]) {
    const f = fixture(PROFILE_ROWS, options);
    assert.deepEqual(mismatches(f, MATRIX, FRAME), [], JSON.stringify(options));
  }
});

test('D-screen-2: complementary queries never contradict each other', () => {
  const pairs = [
    ['(min-width: 1300px)', '(max-width: 1299px)'],
    ['screen and (min-width: 1300px)', 'screen and (max-width: 1299px)'],
    ['only screen and (min-width: 1300px)', 'only screen and (max-width: 1299px)'],
    ['(min-width: 1300px)', 'not all and (min-width: 1300px)'],
    ['screen and (min-width: 1300px)', 'not screen and (min-width: 1300px)'],
    ['all and (min-width: 1300px)', 'not all and (min-width: 1300px)'],
    ['print and (min-width: 1300px)', 'not print and (min-width: 1300px)'],
    ['only screen and (min-width: 1300px) and (min-height: 740px)', 'not screen and (min-width: 1300px) and (min-height: 740px)'],
    ['screen and (prefers-color-scheme: dark)', 'screen and (prefers-color-scheme: light)'],
    ['screen and (prefers-color-scheme: dark)', 'not screen and (prefers-color-scheme: dark)'],
    ['screen and (min-resolution: 1.25dppx)', 'not screen and (min-resolution: 1.25dppx)'],
    ['(min-device-width: 1500px)', '(max-device-width: 1499px)'],
    ['(device-width: 1366px)', 'not (device-width: 1366px)'],
    ['(orientation: landscape)', '(orientation: portrait)'],
    ['(min-width: 1300px) and (orientation: landscape)', 'not ((min-width: 1300px) and (orientation: landscape))'],
    ['(min-width: 1300px) or (max-width: 10px)', 'not ((min-width: 1300px) or (max-width: 10px))'],
    ['screen and ((min-width: 1300px) and (min-height: 740px))', 'not screen and ((min-width: 1300px) and (min-height: 740px))'],
    ['(-webkit-min-device-pixel-ratio: 1.25)', '(-webkit-max-device-pixel-ratio: 1.24)'],
  ];
  const f = fixture(PROFILE_ROWS);
  for (const [a, b] of pairs) assert.notEqual(ask(f, a), ask(f, b), `${a} | ${b}`);
});

test('D-screen-2: the audited impossible pairs are consistent for a 1366x768 profile', () => {
  const f = fixture(PROFILE_ROWS);
  assert.equal(ask(f, 'screen and (min-width: 1366px)'), true);
  assert.equal(ask(f, 'screen and (max-width: 1365px)'), false);
  assert.equal(ask(f, 'only screen and (min-width: 1366px)'), true);
  assert.equal(ask(f, 'only screen and (max-width: 1365px)'), false);
  assert.equal(ask(f, '(min-width: 1366px)'), true);
  assert.equal(ask(f, 'not all and (min-width: 1366px)'), false);
  assert.equal(ask(f, 'screen and (max-width: 768px)'), false);
  assert.equal(ask(f, 'screen and (prefers-color-scheme: dark)'), true);
  assert.equal(ask(f, 'screen and (min-resolution: 1.5dppx)'), true);
});

test('D-screen-2: undecided mixed queries are answered natively as a whole, decided ones never consult native', () => {
  const undecided = ['(min-width: 1300px) and (hover: hover)', 'screen and (min-width: 1300px) and (pointer: fine)', 'not screen and (min-width: 1300px) and (hover: hover)',
    '(max-width: 1300px), (hover: hover)', 'not all and (hover: hover)', 'only screen and (min-width: 1300px) and (unknown: 1)', 'screen and (min-width: 20em)'];
  const decidedFalse = ['(max-width: 1300px) and (hover: hover)', '(hover: hover) and (max-width: 1300px)', 'screen and (max-width: 1300px) and (pointer: fine)',
    'print and (min-width: 1px) and (hover: hover)'];
  const decidedTrue = ['(min-width: 1300px), (hover: hover)', '(hover: hover), (min-width: 1300px)', 'print and (min-width: 1px), screen and (min-width: 1300px)',
    'not screen and (max-width: 1px) and (hover: hover)'];
  for (const answer of [true, false]) {
    const f = fixture(PROFILE_ROWS, { native: () => answer });
    for (const query of undecided) assert.equal(ask(f, query), answer, `${query} must equal the native answer ${answer}`);
    for (const query of decidedFalse) assert.equal(ask(f, query), false, query);
    for (const query of decidedTrue) assert.equal(ask(f, query), true, query);
  }
});

test('D-screen-2: unbalanced, malformed, over-deep and over-long conditions stay native as a whole', () => {
  const deep = '('.repeat(10) + 'min-width: 1300px' + ')'.repeat(10);
  const long = '(min-width: 1300px)' + ' and (min-width: 1300px)'.repeat(40);
  const odd = ['(min-width: 1300px', 'min-width: 1300px)', ')(', 'screen and', 'not', 'only screen', 'screen and (min-width: 1300px) and', '(min-width: 1300px) and',
    'and (min-width: 1300px)', '(min-width: 1300px)\tand\t(max-width: 1400px)', '(min-width: 1300px)and (max-width: 1400px)', 'screen and(min-width: 1300px)', deep, long];
  for (const answer of [true, false]) {
    const f = fixture(PROFILE_ROWS, { native: () => answer });
    for (const query of odd) assert.equal(ask(f, query), answer, query.slice(0, 60));
    assert.equal(ask(f, '(((((((((min-width: 1300px)))))))))'), true, 'nine levels are still evaluated');
  }
});

test('D-screen-2: pure media-type queries stay native (print preview keeps working) while typed queries use the selection', () => {
  const PRINT_TYPES = { ...TYPES, screen: false, print: true };
  const f = fixture(PROFILE_ROWS, { native: query => reference(query, REAL, PRINT_TYPES, false) === true });
  assert.equal(ask(f, 'print'), true);
  assert.equal(ask(f, 'screen'), false);
  assert.equal(ask(f, 'not print'), false);
  assert.equal(ask(f, 'screen, print'), true);
  assert.equal(ask(f, 'speech'), false);
  assert.equal(ask(f, 'print and (hover: hover)'), true, 'no selected feature took part');
  assert.equal(ask(f, 'screen and (min-width: 1300px)'), true, 'typed query with a selected feature');
});

test('D-screen-2: repeated .matches reads of decided and undecided queries are stable and each reaches native once', () => {
  const f = fixture(PROFILE_ROWS);
  f.run(`globalThis.a = realm.matchMedia('only screen and (min-width: 1300px)'); globalThis.b = realm.matchMedia('(min-width: 1300px) and (hover: hover)');`);
  const first = f.run('[a.matches, b.matches, a.matches, b.matches, a.matches, b.matches]');
  assert.deepEqual([...first], [true, false, true, false, true, false]);
  assert.equal(f.run('calls.matches'), 6);
});

test('D-screen-3: orientation follows the selected viewport; frames keep the native orientation', () => {
  const portrait = { ...PROFILE, width: 600, height: 900 };
  const rows = [entry('css-media', { viewportWidth: 600, viewportHeight: 900, resolutionDppx: 1.5 })];
  const queries = ['(orientation: portrait)', '(orientation: landscape)', 'screen and (orientation: portrait)', 'not (orientation: landscape)', '(orientation)',
    '(min-width: 500px) and (orientation: portrait)', '(min-aspect-ratio: 1/1)', '(max-width: 700px), (orientation: landscape)'];
  assert.deepEqual(mismatches(fixture(rows), queries, portrait), []);
  assert.deepEqual(mismatches(fixture(rows, { frame: true }), queries, { ...portrait, width: undefined, height: undefined }), []);
  assert.equal(ask(fixture(rows), '(orientation: portrait)'), true);
  assert.equal(ask(fixture(rows, { frame: true }), '(orientation: portrait)'), false, 'native landscape frame');
});

test('D-screen-3: device-width/height need a selected Screen row and fall back to native without one', () => {
  const noScreen = fixture([entry('css-media', { viewportWidth: 1366, resolutionDppx: 1.5 })]);
  assert.equal(ask(noScreen, '(min-device-width: 1500px)'), true, 'native device width 1920');
  assert.equal(ask(noScreen, '(device-width: 1366px)'), false);
  const off = fixture([entry('css-media', { viewportWidth: 1366, resolutionDppx: 1.5 }), entry('screen-width', 1366, 'off')]);
  assert.equal(ask(off, '(device-width: 1366px)'), false, 'Off row is not a selection');
  const selected = fixture(PROFILE_ROWS);
  assert.equal(ask(selected, '(device-width: 1366px)'), true);
  assert.equal(ask(selected, '(min-device-height: 800px)'), false);
});

// The installer is serialized with Function.prototype.toString into the registered MAIN script: run that exact text.
test('serialized installer (registration + document runtime): top-level, frame and popup take the same decisions', () => {
  const tagged = value => ({ kind: 'value', value });
  let config = { ...createApiConfiguration(), enabled: true, antidetectEnabled: true };
  for (const [id, value] of [
    ['screen-geometry', GEOMETRY], ['css-media', MEDIA], ['screen-width', 1920], ['screen-height', 1080],
    ['css-supports', { queries: [{ query: 'display:grid', supported: false }] }],
  ]) {
    const result = updateApiConfiguration(config, id, { mode: 'custom', selected: tagged(value) }, null);
    assert.equal(result.ok, true, id); config = result.value;
  }
  const [script] = buildApiCustomScripts(config, ['https://*/*']);
  assert.ok(script.js[0].code.includes('installApiCustomEnvironment'));
  const probe = (frame, opener) => {
    const context = vm.createContext({});
    vm.runInContext(`
      globalThis.document = { querySelectorAll() { return []; } };
      globalThis.Navigator = function Navigator() {}; globalThis.navigator = new Navigator();
      const other = {};
      for (const [key, value] of [['innerWidth', 1280], ['innerHeight', 720], ['outerWidth', 1290], ['outerHeight', 800], ['screenX', 7], ['screenY', 8]]) {
        Object.defineProperty(globalThis, key, { configurable: true, enumerable: true, get() { return value; } });
      }
      Object.defineProperty(globalThis, 'top', { configurable: false, enumerable: true, get() { return ${frame} ? other : globalThis; } });
      Object.defineProperty(globalThis, 'opener', { configurable: true, enumerable: true, get() { return ${opener} ? other : null; }, set() {} });
      class MediaQueryList { constructor(q) { this.q = q; } get media() { return this.q; } get matches() { return false; } }
      globalThis.MediaQueryList = MediaQueryList;
      globalThis.matchMedia = function matchMedia(q) { return new MediaQueryList(String(q)); };
      globalThis.CSS = { supports() { return true; } };
    `, context, { timeout: 3000 });
    vm.runInContext(script.js[0].code, context, { timeout: 5000 });
    return JSON.parse(vm.runInContext(`JSON.stringify({
      size: [innerWidth, innerHeight, outerWidth, outerHeight, screenX, screenY],
      wide: matchMedia('screen and (min-width: 1500px)').matches, dpr: matchMedia('(min-resolution: 1.25dppx)').matches, device: matchMedia('(device-width: 1920px)').matches,
      supports: [CSS.supports('display: grid'), CSS.supports('DISPLAY', 'GRID'), CSS.supports('display', 'flex')] })`, context, { timeout: 3000 }));
  };
  assert.deepEqual(probe(false, false), { size: [1920, 947, 1920, 1032, 0, 0], wide: true, dpr: true, device: true, supports: [false, false, true] });
  assert.deepEqual(probe(true, false), { size: [1280, 720, 1920, 1032, 0, 0], wide: false, dpr: true, device: true, supports: [false, false, true] });
  assert.deepEqual(probe(false, true), { size: [1280, 720, 1920, 1032, 0, 0], wide: false, dpr: true, device: true, supports: [false, false, true] });
});

// ---------------------------------------------------------------- D-screen-8
test('D-screen-8: CSS.supports ignores case, outer parentheses and spaces around the colon; conjunctions follow a selected false', () => {
  const f = fixture([entry('css-supports', { queries: [
    { query: 'display:grid', supported: false }, { query: 'selector(:has(a))', supported: false }, { query: '(color: rgb(0 0 0 / 50%))', supported: false },
  ] })]);
  const calls = [
    ["'display', 'grid'", false], ["'display: grid'", false], ["'(display: grid)'", false], ["'(display:grid)'", false], ["'((display: grid))'", false],
    ["'DISPLAY', 'GRID'", false], ["' display ', ' grid '", false], ["'display : grid'", false],
    ["'(display: grid) and (display: flex)'", false], ["'(display: flex) and (display: grid)'", false],
    ["'selector(:has(a))'", false], ["'SELECTOR(:HAS(A))'", false],
    ["'color', 'rgb(0 0 0 / 50%)'", false], ["'color: rgb(0 0 0 / 50%)'", false],
    ["'display', 'flex'", true], ["'(display: flex) and (display: block)'", true], ["'not (display: grid)'", true], ["'(display', 'grid)'", true],
    ["'x'.repeat(5000)", true],
  ];
  for (const [args, want] of calls) assert.equal(f.run(`realm.CSS.supports(${args})`), want, args);
  assert.equal(f.run('calls.supports'), calls.length, 'native supports reached exactly once per page call');
  assert.throws(() => f.run('realm.CSS.supports()'), error => error === f.run('reason'));
  assert.equal(f.run('calls.supports'), calls.length + 1);
});

test('D-screen-8: a selected true answers a conjunction only when every part is selected true', () => {
  const f = fixture([entry('css-supports', { queries: [{ query: 'display: grid', supported: true }, { query: '(display:flex)', supported: true }] })], { supports: false });
  assert.equal(f.run(`realm.CSS.supports('display', 'grid')`), true);
  assert.equal(f.run(`realm.CSS.supports('(DISPLAY: GRID) and (display: flex)')`), true);
  assert.equal(f.run(`realm.CSS.supports('(display: grid) and (display: block)')`), false, 'unselected part keeps the native answer');
  assert.equal(f.run(`realm.CSS.supports('display', 'block')`), false);
});
