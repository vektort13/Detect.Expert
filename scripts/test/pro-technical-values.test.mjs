import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { PRO_TECHNICAL_OPERATIONS as operations, PRO_TECHNICAL_FIELDS as fields, readProTechnicalValue, readProTechnicalRow, proTechnicalContractSource } from '../../packages/contracts/src/pro-technical-values.mjs';
import { createProTechnicalProjector, proTechnicalRuntimeSource } from '../production/pro-technical-values-runtime.mjs';
import { proValueParameters, proValueKey, proValueRows, proValueDocuments, createProParameterBudget, runtimeSource } from '../production/pro-values-runtime.mjs';
const value = (profile, entries, truncated = false) => ({ kind: 'technical', profile, fields: entries, truncated });
const field = (name, content, index = 0) => ({ name, index, kind: typeof content, value: content });
const row = (operation, entries, parameters = []) => ({ operation, techniqueId: operations[operation][1], phase: 'returned-sync', value: value(operations[operation][0], entries), parameters, count: 1 });
const project = realm => createProTechnicalProjector(realm, true, operations, fields);
function fakeRealm() {
  // Native intrinsics model the brand check without weakening production's guard.
  const size = Object.getOwnPropertyDescriptor(Map.prototype, 'size').get;
  const nativeMethod = Object;
  const Native = members => ({ prototype: Object.defineProperties({}, members) });
  return {
    Intl,
    Navigator: Native({ languages: { get: size }, plugins: { get: size }, mimeTypes: { get: size } }),
    NavigatorUAData: Native({ brands: { get: size }, toJSON: { value: nativeMethod } }),
    Element: Native({ getBoundingClientRect: { value: nativeMethod }, getClientRects: { value: nativeMethod } }),
    DOMRectReadOnly: Native(Object.fromEntries(Object.keys(fields.geometry).map(name => [name, { get: size }]))),
    TextMetrics: Native({ width: { get: size }, actualBoundingBoxLeft: { get: size } }),
    CanvasRenderingContext2D: Native({ measureText: { value: nativeMethod } }),
    WebGLRenderingContext: Native({ getSupportedExtensions: { value: nativeMethod } }),
    matchMedia: Object,
    MediaQueryList: Native({ matches: { get: size } })
  };
}
test('every allowed operation has a fixed profile and technique', () => {
  for (const [operation, [profile, techniqueId]] of Object.entries(operations)) {
    assert.ok(fields[profile]); assert.match(techniqueId, /^DET-\d{3}$/);
    assert.deepEqual(readProTechnicalRow({ operation, techniqueId, phase: 'returned-sync', value: value(profile, []) })?.[0].value, value(profile, []));
  }
});
test('canonical reader rejects wrong profile, sensitive operation, wrong technique and non-return phases', () => {
  const r = row('Navigator.languages', [field('language', 'en-US')]);
  const base = { operation: r.operation, techniqueId: r.techniqueId, phase: r.phase, value: r.value };
  for (const change of [{ operation: 'Document.cookie' }, { techniqueId: 'DET-049' }, { phase: 'settlement-unobserved' }, { value: value('intl', []) }]) assert.equal(readProTechnicalRow({ ...base, ...change }), null);
  assert.equal(readProTechnicalValue(value('languages', [field('cookie', 'secret')]), 'Navigator.languages'), null);
});
test('canonical fields reject object coercion, getters, duplicates, extra fields and malformed numbers', () => {
  let touched = 0;
  const getter = { name: 'language', index: 0, kind: 'string', get value() { touched++; return 'secret'; } };
  const coercer = { toString() { touched++; return 'secret'; } };
  for (const entries of [[getter], [field('language', coercer)], [field('language', 'en'), field('language', 'ru')], [{ ...field('language', 'en'), extra: true }]]) assert.equal(readProTechnicalValue(value('languages', entries), 'Navigator.languages'), null);
  for (const content of [NaN, Infinity, -Infinity, -0]) assert.equal(readProTechnicalValue(value('geometry', [field('width', content)]), 'Element.getBoundingClientRect'), null);
  assert.equal(touched, 0);
});
test('all special numbers and Intl boolean/string unions remain typed', () => {
  for (const content of ['NaN', 'Infinity', '-Infinity', '-0']) assert.ok(readProTechnicalValue(value('geometry', [{ name: 'x', index: 0, kind: 'special-number', value: content }]), 'Element.getBoundingClientRect'));
  for (const content of [true, false, 'auto', 'always']) assert.ok(readProTechnicalValue(value('intl', [field('numeric', content)]), 'Intl.Collator.resolvedOptions'));
});
test('value-level budgets reject oversized fields, arrays and byte totals', () => {
  assert.equal(readProTechnicalValue(value('languages', [field('language', 'a'.repeat(257))]), 'Navigator.languages'), null);
  assert.equal(readProTechnicalValue(value('languages', Array.from({ length: 129 }, (_, i) => field('language', 'en', i))), 'Navigator.languages'), null);
  assert.equal(readProTechnicalValue(value('languages', Array.from({ length: 32 }, (_, i) => field('language', 'x'.repeat(256), i))), 'Navigator.languages'), null);
});
test('native Intl resolvedOptions results retain locale, timezone and typed settings', () => {
  const capture = project({ Intl });
  for (const [name, instance] of [['DateTimeFormat', new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dubai', hour: 'numeric', hour12: false })], ['Collator', new Intl.Collator('en', { numeric: true })], ['NumberFormat', new Intl.NumberFormat('en', { maximumFractionDigits: 2 })], ['PluralRules', new Intl.PluralRules('en')]]) {
    const operation = 'Intl.' + name + '.resolvedOptions', result = capture(operation, 'returned-sync', instance.resolvedOptions());
    assert.ok(result.fields.some(item => item.name === 'locale')); assert.ok(readProTechnicalValue(result, operation));
    if (name === 'DateTimeFormat') assert.equal(result.fields.find(item => item.name === 'timeZone').value, 'Asia/Dubai');
    if (name === 'Collator') assert.equal(result.fields.find(item => item.name === 'numeric').value, true);
  }
});
test('late, nonnative, wrong phase and Promise results are never inspected', () => {
  let reads = 0; const dangerous = new Proxy({}, { getOwnPropertyDescriptor() { reads++; throw Error('page trap'); }, get() { reads++; throw Error('page trap'); } });
  assert.equal(createProTechnicalProjector({ Intl }, false, operations, fields)('Intl.DateTimeFormat.resolvedOptions', 'returned-sync', dangerous), null);
  const capture = project({ Intl: { DateTimeFormat: { prototype: { resolvedOptions() {} } } } });
  assert.equal(capture('Intl.DateTimeFormat.resolvedOptions', 'returned-sync', dangerous), null);
  assert.equal(project({ Intl })('Intl.DateTimeFormat.resolvedOptions', 'settlement-unobserved', dangerous), null);
  assert.equal(project({ Intl })('NavigatorUAData.getHighEntropyValues', 'settlement-unobserved', Promise.resolve('secret')), null);
  assert.equal(reads, 0);
});
test('fixed native dictionary projection never invokes own getters, coercion or iterators', () => {
  let reads = 0;
  const result = { locale: 'en', get timeZone() { reads++; return 'secret'; }, other: { toString() { reads++; } }, [Symbol.iterator]() { reads++; } };
  assert.deepEqual(project({ Intl })('Intl.DateTimeFormat.resolvedOptions', 'returned-sync', result).fields, [field('locale', 'en')]);
  assert.equal(reads, 0);
});
test('native string collections preserve distinct entries and bounds without iterating result', () => {
  const capture = project(fakeRealm()), languages = ['en-US', 'ru-RU'];
  languages[Symbol.iterator] = () => { throw Error('iterator must not run'); };
  assert.deepEqual(capture('Navigator.languages', 'returned-sync', languages).fields, [field('language', 'en-US'), field('language', 'ru-RU', 1)]);
  const oversized = capture('WebGLRenderingContext.getSupportedExtensions', 'returned-sync', Array.from({ length: 1000 }, () => 'EXT_one'));
  assert.equal(oversized.truncated, true); assert.ok(oversized.fields.length <= 128); assert.ok(readProTechnicalValue(oversized, 'WebGLRenderingContext.getSupportedExtensions'));
});
test('geometry uses captured brand getters, ignores shadow getters and rejects proxies', () => {
  const capture = project(fakeRealm()), object = new Map([['x', 1], ['y', 2]]);
  let reads = 0; Object.defineProperty(object, 'width', { get() { reads++; throw Error(); } });
  const result = capture('Element.getBoundingClientRect', 'returned-sync', object);
  assert.equal(result.fields.length, 8); assert.ok(result.fields.every(item => item.value === 2));
  const proxy = new Proxy(object, { get() { reads++; throw Error(); }, getOwnPropertyDescriptor() { reads++; throw Error(); } });
  assert.equal(capture('Element.getBoundingClientRect', 'returned-sync', proxy), null);
  assert.equal(reads, 0);
});
test('missing native brands remain unobserved while genuine empty collections are retained', () => {
  const capture = project(fakeRealm());
  assert.equal(capture('CanvasRenderingContext2D.measureText', 'returned-sync', {}), null);
  assert.equal(capture('Element.getBoundingClientRect', 'returned-sync', {}), null);
  assert.equal(capture('Window.matchMedia', 'returned-sync', {}), null);
  assert.deepEqual(capture('Navigator.languages', 'returned-sync', []), value('languages', []));
  assert.deepEqual(capture('WebGLRenderingContext.getSupportedExtensions', 'returned-sync', []), value('webgl-extensions', []));
});
test('UA low entropy toJSON and brands preserve brand/version/mobile/platform only', () => {
  const capture = project(fakeRealm());
  const result = capture('NavigatorUAData.toJSON', 'returned-sync', { brands: [{ brand: 'Browser', version: '123', secret: 'discard' }], mobile: false, platform: 'Linux', fullVersionList: 'discard' });
  assert.deepEqual(result.fields.map(item => item.name), ['mobile', 'platform', 'brand', 'version']);
  assert.ok(readProTechnicalValue(result, 'NavigatorUAData.toJSON'));
});
test('technical query arguments retain font/CSS/media variants without coercion or sample text', () => {
  let reads = 0; const input = { toString() { reads++; return 'secret'; } };
  assert.deepEqual(proValueParameters('CSS.supports', ['display', 'grid']), [field('arg0', 'display'), field('arg1', 'grid')].map(({ index: _index, ...rest }) => rest));
  assert.deepEqual(proValueParameters('FontFaceSet.check', ['12px Arial', 'FORM_PASSWORD']), [{ name: 'arg0', kind: 'string', value: '12px Arial' }]);
  for (const operation of ['Window.matchMedia', 'HTMLMediaElement.canPlayType', 'MediaSource.isTypeSupported', 'ImageDecoder.isTypeSupported']) assert.equal(proValueParameters(operation, ['test']).length, 1);
  for (const operation of ['CanvasRenderingContext2D.measureText', 'Document.cookie', 'Clipboard.readText', 'Storage.setItem']) assert.deepEqual(proValueParameters(operation, ['SECRET']), []);
  for (const query of [input, 'url(https://example.test/?secret)', 'data:secret', 'a'.repeat(257), 'a\nsecret']) assert.deepEqual(proValueParameters('CSS.supports', [query]), []);
  assert.equal(reads, 0);
});
test('Pro canonical rows preserve technical variants and per-document ownership', () => {
  const first = row('Navigator.languages', [field('language', 'en')]), second = row('Navigator.languages', [field('language', 'ru')]);
  assert.notEqual(proValueKey(first), proValueKey(second));
  assert.equal(proValueRows([first, second], () => null).length, 2);
  assert.equal(proValueRows([first, first], () => null), null);
  assert.equal(proValueDocuments([{ documentKey: 'first:doc', rows: [first], truncated: false }, { documentKey: 'third:party', rows: [second], truncated: false }], () => null).length, 2);
  const number = row('Intl.NumberFormat.resolvedOptions', [field('useGrouping', false)]), text = row('Intl.NumberFormat.resolvedOptions', [field('useGrouping', 'false')]);
  assert.notEqual(proValueKey(number), proValueKey(text));
});
test('technical parameters retain existing 32-variant operation and 256-row budgets', () => {
  const budget = createProParameterBudget();
  for (let i = 0; i < 32; i++) assert.equal(budget.admit({ operation: 'CSS.supports', parameters: proValueParameters('CSS.supports', ['width', i + 'px']) }), true);
  assert.equal(budget.admit({ operation: 'CSS.supports', parameters: proValueParameters('CSS.supports', ['width', '33px']) }), false);
  budget.reset(); assert.equal(budget.admit({ operation: 'CSS.supports', parameters: proValueParameters('CSS.supports', ['width', '33px']) }), true);
  assert.equal(proValueRows(Array.from({ length: 257 }, (_, i) => row('Navigator.languages', [field('language', 'lang' + i)])), () => null), null);
});
test('projector and contract use early captured intrinsics after page mutation', () => {
  const context = vm.createContext({});
  vm.runInContext(proTechnicalContractSource + proTechnicalRuntimeSource + `
    var result = new Intl.DateTimeFormat('en-US', {timeZone:'UTC'}).resolvedOptions();
    var realm = {Intl};
    Object.getOwnPropertyDescriptor = () => { throw Error('page patch'); };
    Reflect.apply = () => { throw Error('page patch'); };
    Array.prototype.push = () => { throw Error('page patch'); };
    Array.prototype[Symbol.iterator] = () => { throw Error('page iterator'); };
    String.prototype.split = () => { throw Error('page split'); };
    RegExp.prototype.exec = () => { throw Error('page regexp dispatch'); };
    var capture = createProTechnicalProjector(realm, true, PRO_TECHNICAL_OPERATIONS, PRO_TECHNICAL_FIELDS);
    var recorded = capture('Intl.DateTimeFormat.resolvedOptions', 'returned-sync', result);
    var accepted = readProTechnicalValue(recorded, 'Intl.DateTimeFormat.resolvedOptions');
  `, context);
  assert.ok(context.accepted.fields.some(item => item.name === 'timeZone' && item.value === 'UTC'));
});
test('prototype accessors, indexed array setters and string symbol hooks cannot execute inside capture', () => {
  const context = vm.createContext({});
  vm.runInContext(runtimeSource + proTechnicalRuntimeSource + `
    var define = Object.defineProperty, calls = 0;
    var original = new Intl.DateTimeFormat('en-US', {timeZone:'UTC'}).resolvedOptions();
    var realm = {Intl};
    define(Array.prototype, '0', {configurable:true, set(){calls++; throw Error('indexed setter');}});
    define(String.prototype, Symbol.split, {configurable:true, value(){calls++; throw Error('symbol split');}});
    define(Object.prototype, 'value', {configurable:true, get(){calls++; throw Error('inherited descriptor value');}});
    define(Object.prototype, 'get', {__proto__:null, configurable:true, get(){calls++; throw Error('inherited descriptor get');}});
    RegExp.prototype.exec = () => {calls++; throw Error('regexp exec dispatch');};
    var capture = createProTechnicalProjector(realm, true, PRO_TECHNICAL_OPERATIONS, PRO_TECHNICAL_FIELDS);
    var recorded = capture('Intl.DateTimeFormat.resolvedOptions', 'returned-sync', original);
    var accepted = readProTechnicalValue(recorded, 'Intl.DateTimeFormat.resolvedOptions');
    var args = proValueParameters('CSS.supports', ['display','grid']);
    delete Array.prototype['0']; delete String.prototype[Symbol.split]; delete Object.prototype.value; delete Object.prototype.get;
  `, context);
  assert.equal(context.calls, 0); assert.ok(context.accepted); assert.equal(context.args.length, 2);
});
test('both shipped hooks pass original text result, never measured text, and install projector before wrappers', () => {
  for (const name of ['hook.early.js', 'hook.main.js']) {
    const source = readFileSync(new URL('../../apps/production-extension/' + name, import.meta.url), 'utf8');
    assert.match(source, /textMeasure = operation => \(_receiver, _args, threw, _error, result\)/);
    assert.match(source, /recordPro\(operation, PHASES\[threw \? P_THREW : P_RETURNED\], result, void 0, "DET-003"\)/);
    assert.ok(source.indexOf('runtime.apiResults.projectTechnical = createProTechnicalProjector') < source.indexOf('mathSignatureSupport.install(runtime'));
    assert.doesNotMatch(source, /wrapOutcomeMethod\([^\n]+"measureText"/);
  }
});
