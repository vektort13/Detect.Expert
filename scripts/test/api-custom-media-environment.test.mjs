// Owner request (Camoufox / CloakBrowser comparison, task E1): matchMedia follows the plain screen and DPR rows.
//  a) (any-pointer: X) / (any-hover: X) and the boolean forms evaluate against the SET of the primary and the "any" value.
//  b) A Custom screen size or pixel ratio without a css-media row gets an implicit minimal css-media row in the registered source,
//     so JS (screen.width, devicePixelRatio) and CSS (device-width, resolution) agree in Balanced. Viewport width/height stay native.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createApiConfiguration, updateApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';
import { buildApiCustomScripts } from '../../apps/production-extension/api-custom-registration.js';

const source = readFileSync(new URL('../../apps/production-extension/api-custom-environment-runtime.js', import.meta.url), 'utf8').replace(/^export /m, '');
const entry = (id, value, mode = 'custom') => ({ id, value, mode });

// ------------------------------------------------------------------ E1a: installer level
function fixture(entries, nativeAnswer = false) {
  const context = vm.createContext({ input: structuredClone(entries), nativeAnswer });
  vm.runInContext(`
    const queries = new WeakMap();
    globalThis.calls = { match: 0, matches: 0 };
    globalThis.reason = new TypeError('Synthetic native brand');
    class MediaQueryList {
      constructor(query) { queries.set(this, query); }
      get media() { if (!queries.has(this)) throw reason; return queries.get(this); }
      get matches() { calls.matches++; if (!queries.has(this)) throw reason; return nativeAnswer; }
    }
    globalThis.realm = { Object, Array, Promise, MediaQueryList };
    realm.matchMedia = { matchMedia(query) { calls.match++; if (this !== realm) throw reason; return new MediaQueryList(String(query)); } }.matchMedia;
    ${source}
    globalThis.guard = installApiCustomEnvironment(realm, input);
  `, context);
  return { run: code => vm.runInContext(code, context) };
}
const ask = (f, query) => f.run('realm.matchMedia(' + JSON.stringify(query) + ').matches');
// The native engine of the fixture answers a constant, so a decided answer differs from one of the two runs and "native" equals both.
function answer(row, query) {
  const results = [true, false].map(nativeAnswer => ask(fixture([entry('css-media', row)], nativeAnswer), query));
  return results[0] === results[1] ? results[0] : 'native';
}

const SETS = [
  // pointing devices: primary fine mouse, a touch screen as additional coarse device
  [{ pointer: 'fine', anyPointer: 'coarse' }, [
    ['(any-pointer: fine)', true], ['(any-pointer: coarse)', true], ['(any-pointer: none)', false], ['(any-pointer)', true],
    ['(pointer: fine)', true], ['(pointer: coarse)', false], ['(pointer: none)', false], ['(pointer)', true],
    ['screen and (any-pointer: coarse)', true], ['not (any-pointer: fine)', false], ['not (any-pointer: none)', true],
    ['(any-pointer: fine) and (any-pointer: coarse)', true], ['(any-pointer: none), (any-pointer: banana)', false],
  ]],
  [{ pointer: 'coarse', anyPointer: 'fine' }, [['(any-pointer: fine)', true], ['(any-pointer: coarse)', true], ['(any-pointer: none)', false], ['(any-pointer)', true]]],
  // both rows say none: nothing to point with
  [{ pointer: 'none', anyPointer: 'none' }, [['(any-pointer: none)', true], ['(any-pointer: fine)', false], ['(any-pointer: coarse)', false], ['(any-pointer)', false], ['not (any-pointer)', true]]],
  // only the primary row
  [{ pointer: 'fine' }, [['(any-pointer: fine)', true], ['(any-pointer: coarse)', false], ['(any-pointer: none)', false], ['(any-pointer)', true]]],
  [{ pointer: 'none' }, [['(any-pointer: none)', true], ['(any-pointer: fine)', false], ['(any-pointer)', false]]],
  // only the any row (the case that used to work and must keep working)
  [{ anyPointer: 'coarse' }, [['(any-pointer: coarse)', true], ['(any-pointer: fine)', false], ['(any-pointer: none)', false], ['(any-pointer)', true], ['(pointer: coarse)', 'native']]],
  [{ anyPointer: 'none' }, [['(any-pointer: none)', true], ['(any-pointer: fine)', false], ['(any-pointer)', false]]],
  // a secondary mouse next to a primary none, and an inconsistent profile: the set still decides, none needs the set to be exactly {none}
  [{ pointer: 'none', anyPointer: 'fine' }, [['(any-pointer: fine)', true], ['(any-pointer: none)', false], ['(any-pointer)', true], ['(pointer: none)', true]]],
  [{ pointer: 'fine', anyPointer: 'none' }, [['(any-pointer: fine)', true], ['(any-pointer: none)', false], ['(any-pointer)', true]]],
  [{ pointer: 'fine', anyPointer: 'fine' }, [['(any-pointer: fine)', true], ['(any-pointer: coarse)', false]]],
  // hover
  [{ hover: 'hover', anyHover: 'none' }, [['(any-hover: hover)', true], ['(any-hover: none)', false], ['(any-hover)', true], ['(hover: hover)', true], ['(hover: none)', false]]],
  [{ hover: 'none', anyHover: 'hover' }, [['(any-hover: hover)', true], ['(any-hover: none)', false], ['(any-hover)', true], ['(hover: none)', true]]],
  [{ hover: 'none', anyHover: 'none' }, [['(any-hover: none)', true], ['(any-hover: hover)', false], ['(any-hover)', false]]],
  [{ anyHover: 'hover' }, [['(any-hover: hover)', true], ['(any-hover: none)', false], ['(any-hover)', true]]],
  [{ hover: 'hover' }, [['(any-hover: hover)', true], ['(any-hover: none)', false], ['(any-hover)', true]]],
  // a pointer set never decides hover and the other way round
  [{ pointer: 'fine', anyPointer: 'fine' }, [['(any-hover: hover)', 'native'], ['(any-hover)', 'native']]],
  [{ hover: 'hover', anyHover: 'hover' }, [['(any-pointer: fine)', 'native'], ['(any-pointer)', 'native']]],
];

test('E1a: any-pointer / any-hover evaluate against the set of the primary and the any value', () => {
  for (const [row, cases] of SETS) for (const [query, expected] of cases) assert.equal(answer(row, query), expected, JSON.stringify(row) + ' ' + query);
});

test('E1a: the regression this fixes: anyPointer coarse no longer hides a fine primary pointer from (any-pointer: fine)', () => {
  assert.equal(answer({ pointer: 'fine', anyPointer: 'coarse' }, '(any-pointer: fine)'), true);
  assert.equal(answer({ pointer: 'fine', anyPointer: 'coarse' }, '(any-pointer: coarse)'), true);
});

test('E1a: with neither row selected the query is unknown and keeps the native answer, also inside lists and negations', () => {
  const row = { colorScheme: 'dark' };
  for (const query of ['(any-pointer: fine)', '(any-pointer)', '(any-hover: hover)', '(any-hover)', 'not (any-pointer: fine)', 'screen and (any-pointer: fine)']) assert.equal(answer(row, query), 'native', query);
  // Three-valued logic (ADR-100): a decided part still decides AND / OR next to an unknown any-* part.
  for (const nativeAnswer of [true, false]) {
    const f = fixture([entry('css-media', row)], nativeAnswer);
    assert.equal(ask(f, '(any-pointer: fine) and (prefers-color-scheme: light)'), false);
    assert.equal(ask(f, '(any-pointer: fine), (prefers-color-scheme: dark)'), true);
    assert.equal(ask(f, '(any-pointer: fine) or (prefers-color-scheme: dark)'), true);
  }
});

test('E1a: set queries stay inside the three-valued logic when combined with other selected features', () => {
  const row = { pointer: 'fine', anyPointer: 'coarse', colorScheme: 'dark', hover: 'hover', anyHover: 'none' };
  for (const nativeAnswer of [true, false]) {
    const f = fixture([entry('css-media', row)], nativeAnswer);
    assert.equal(ask(f, '(any-pointer: coarse) and (prefers-color-scheme: dark)'), true);
    assert.equal(ask(f, '(any-pointer: coarse) and (prefers-color-scheme: light)'), false);
    assert.equal(ask(f, '(any-pointer: none), (any-hover: none)'), false, 'the hover set {hover, none} is not exactly {none}');
    assert.equal(ask(f, '(any-pointer: none), (any-hover: hover)'), true);
    assert.equal(ask(f, '(any-pointer: none) or (any-hover: hover)'), true);
    assert.equal(ask(f, '(any-pointer: none) and (any-hover: hover)'), false);
    assert.equal(ask(f, '(any-pointer: fine) and (unknown-feature: 1)'), nativeAnswer, 'an unknown part keeps the whole query native');
  }
});

test('E1a: one native matchMedia and one native matches read per query; stop() restores the native answer', () => {
  const f = fixture([entry('css-media', { pointer: 'fine', anyPointer: 'coarse' })], false);
  assert.equal(ask(f, '(any-pointer: coarse)'), true);
  assert.equal(f.run('calls.match'), 1); assert.equal(f.run('calls.matches'), 1);
  assert.throws(() => f.run('Reflect.apply(realm.matchMedia, {}, ["(any-pointer: fine)"])'), error => error === f.run('reason'));
  f.run('guard.stop()');
  assert.equal(ask(f, '(any-pointer: coarse)'), false, 'native answer after stop');
});

// ------------------------------------------------------------------ E1b: registered source
const tagged = value => ({ kind: 'value', value });
function configure(rows, { host = null, base = { ...createApiConfiguration(), enabled: true, antidetectEnabled: true } } = {}) {
  let config = base;
  for (const [id, value, mode = 'custom'] of rows) {
    const result = updateApiConfiguration(config, id, mode === 'custom' ? { mode, selected: tagged(value) } : { mode }, host);
    assert.equal(result.ok, true, id + ': ' + result.error?.message); config = result.value;
  }
  return config;
}
const packedOf = script => JSON.parse(/const packed = (.*);\n/.exec(script.js[0].code)[1]);
const mediaRows = script => packedOf(script).filter(row => row.id === 'css-media');
function realmFor(nativeAnswer) {
  const context = vm.createContext({});
  vm.runInContext(`
    globalThis.document = { querySelectorAll() { return []; } };
    globalThis.Navigator = function Navigator() {}; globalThis.navigator = new Navigator();
    globalThis.Screen = function Screen() {}; globalThis.screen = new Screen();
    for (const [key, value] of [['width', 1920], ['height', 1080]]) {
      Object.defineProperty(Screen.prototype, key, { configurable: true, enumerable: true, get() { if (this !== screen) throw new TypeError('Illegal invocation'); return value; } });
    }
    Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, enumerable: true, get() { return 1; } });
    class MediaQueryList { constructor(q) { this.q = q; } get media() { return this.q; } get matches() { return ${nativeAnswer}; } }
    globalThis.MediaQueryList = MediaQueryList;
    globalThis.matchMedia = function matchMedia(q) { return new MediaQueryList(String(q)); };
  `, context);
  return { context, run: code => vm.runInContext(code, context, { timeout: 3000 }) };
}
function install(script, nativeAnswer = false) {
  const f = realmFor(nativeAnswer);
  vm.runInContext(script.js[0].code, f.context, { timeout: 5000 });
  return f;
}
const media = (f, query) => f.run('matchMedia(' + JSON.stringify(query) + ').matches');
const SCREEN = [['screen-width', 1536], ['screen-height', 864], ['window-device-pixel-ratio', 1.25]];

test('E1b: Custom screen rows without a css-media row add an implicit minimal css-media row and the environment installer', () => {
  const [script] = buildApiCustomScripts(configure(SCREEN), ['https://*/*']);
  assert.deepEqual(mediaRows(script), [{ id: 'css-media', mode: 'custom', selected: { kind: 'value', value: { resolutionDppx: 1.25 } } }]);
  assert.ok(script.js[0].code.includes('installApiCustomEnvironment'));
  assert.equal(packedOf(script).at(-1).id, 'css-media', 'appended after the configured rows');
});

test('E1b: JS screen/DPR and matchMedia device features agree; viewport features stay native (live Balanced disagreement)', () => {
  const [script] = buildApiCustomScripts(configure(SCREEN), ['https://*/*']);
  for (const nativeAnswer of [false, true]) {
    const f = install(script, nativeAnswer);
    assert.equal(f.run('screen.width'), 1536); assert.equal(f.run('screen.height'), 864); assert.equal(f.run('devicePixelRatio'), 1.25);
    for (const query of ['(device-width: 1536px)', '(device-height: 864px)', '(resolution: 1.25dppx)', '(min-resolution: 120dpi)', '(-webkit-device-pixel-ratio: 1.25)',
      'screen and (device-width: 1536px)', '(min-device-width: 1500px)', '(device-width >= 1536px) and (resolution >= 1.25dppx)']) assert.equal(media(f, query), true, query);
    for (const query of ['(device-width: 1920px)', '(device-height: 1080px)', '(resolution: 1dppx)', '(-webkit-device-pixel-ratio: 1)', '(max-device-width: 1535px)']) assert.equal(media(f, query), false, query);
    for (const query of ['(min-width: 100px)', '(max-width: 100px)', '(orientation: landscape)', '(width: 1536px)', '(prefers-color-scheme: dark)']) assert.equal(media(f, query), nativeAnswer, 'native: ' + query);
  }
});

test('E1b: a pixel ratio alone selects resolution only; device-width needs its Screen row', () => {
  const [script] = buildApiCustomScripts(configure([['window-device-pixel-ratio', 2]]), ['https://*/*']);
  assert.deepEqual(mediaRows(script).map(row => row.selected.value), [{ resolutionDppx: 2 }]);
  for (const nativeAnswer of [false, true]) {
    const f = install(script, nativeAnswer);
    assert.equal(media(f, '(resolution: 2dppx)'), true); assert.equal(media(f, '(min-resolution: 192dpi)'), true); assert.equal(media(f, '(resolution: 1dppx)'), false);
    assert.equal(media(f, '(device-width: 1920px)'), nativeAnswer, 'no screen-width row: native');
  }
});

test('E1b: a screen size alone selects device-width / device-height only; resolution stays native', () => {
  const [script] = buildApiCustomScripts(configure([['screen-width', 1536]]), ['https://*/*']);
  assert.deepEqual(mediaRows(script).map(row => row.selected.value), [{}]);
  for (const nativeAnswer of [false, true]) {
    const f = install(script, nativeAnswer);
    assert.equal(media(f, '(device-width: 1536px)'), true); assert.equal(media(f, '(device-width: 1920px)'), false);
    assert.equal(media(f, '(device-height: 1080px)'), nativeAnswer, 'no screen-height row: native');
    assert.equal(media(f, '(resolution: 2dppx)'), nativeAnswer, 'no ratio row: native');
  }
});

test('E1b: an explicit css-media row is never changed or supplemented (and the contract has no On mode for it)', () => {
  const explicit = configure([['css-media', { colorScheme: 'dark' }], ...SCREEN]);
  const [script] = buildApiCustomScripts(explicit, ['https://*/*']);
  assert.deepEqual(mediaRows(script), [{ id: 'css-media', mode: 'custom', selected: { kind: 'value', value: { colorScheme: 'dark' } } }]);
  for (const nativeAnswer of [false, true]) {
    const f = install(script, nativeAnswer);
    assert.equal(media(f, '(prefers-color-scheme: dark)'), true);
    assert.equal(media(f, '(device-width: 1536px)'), true, 'device size still follows the Screen rows');
    assert.equal(media(f, '(resolution: 1.25dppx)'), nativeAnswer, 'the explicit row has no resolutionDppx: not merged from the ratio row');
  }
  const blocked = updateApiConfiguration(configure([]), 'css-media', { mode: 'on' }, null);
  assert.equal(blocked.ok, false, 'css-media cannot be hidden, so no Custom row can ever sit next to an On row');
});

test('E1b: nothing is added without a Custom screen size or ratio (other rows, Off rows)', () => {
  const [other] = buildApiCustomScripts(configure([['hardware-concurrency', 16]]), ['https://*/*']);
  assert.equal(mediaRows(other).length, 0); assert.equal(other.js[0].code.includes('installApiCustomEnvironment'), false);
  const [off] = buildApiCustomScripts(configure([['hardware-concurrency', 16], ['screen-width', 1536, 'off'], ['window-device-pixel-ratio', 2, 'off']]), ['https://*/*']);
  assert.equal(mediaRows(off).length, 0); assert.equal(off.js[0].code.includes('installApiCustomEnvironment'), false);
  const [metadata] = buildApiCustomScripts(configure([['navigator-metadata', { webdriver: false }]]), ['https://*/*']);
  assert.equal(mediaRows(metadata).length, 0, 'other environment rows do not imply a media row');
});

test('E1b: global and exact-site scripts decide independently; every script keeps complete inherited rows', () => {
  let config = configure([['hardware-concurrency', 16]]);
  config = configure([['screen-width', 1536]], { host: 'a.example', base: config });
  const scripts = buildApiCustomScripts(config, ['https://*/*']);
  const global = scripts.find(script => script.id.endsWith('global')), site = scripts.find(script => script.id !== global.id);
  assert.equal(mediaRows(global).length, 0); assert.equal(mediaRows(site).length, 1);
  assert.deepEqual(packedOf(site).map(row => row.id).sort(), ['css-media', 'hardware-concurrency', 'screen-width']);
});

test('E1b: the registered source is deterministic and keeps the smallest ratio as plain data', () => {
  const left = buildApiCustomScripts(configure(SCREEN), ['https://*/*']), right = buildApiCustomScripts(configure(SCREEN), ['https://*/*']);
  assert.deepEqual(left, right);
  const [script] = buildApiCustomScripts(configure([['window-device-pixel-ratio', 0.1]]), ['https://*/*']);
  assert.deepEqual(mediaRows(script).map(row => row.selected.value), [{ resolutionDppx: 0.1 }]);
});
