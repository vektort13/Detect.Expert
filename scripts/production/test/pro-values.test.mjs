import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { proValueParameters, proValueRows, proValueDocuments, proValueKey, runtimeSource } from '../pro-values-runtime.mjs';
import { readCookieSnapshot, normalizeProCookieMetadata, readLoaderRows, readTagManagerDocuments } from '../../../packages/contracts/src/inspection.mjs';
import { readAdvancedPageFields } from '../../../packages/contracts/src/advanced-inspection.mjs';

const root = new URL('../../../', import.meta.url);
const background = readFileSync(new URL('apps/production-extension/background.js', root), 'utf8');
const contracts = background.slice(0, background.indexOf('// packages/attribution/src/psl-index.json')).replace(/^import[^\n]*\n/gm, '');
function fixture() {
  const context = vm.createContext({ atob, btoa, TextEncoder, URL, readCookieSnapshot, normalizeProCookieMetadata, readLoaderRows, readTagManagerDocuments, readAdvancedPageFields });
  vm.runInContext(contracts + '\n' + runtimeSource + '\nvar arrayPush = (array, value) => Array.prototype.push.call(array, value); var arraySlice = array => Array.prototype.slice.call(array);', context);
  const hook = readFileSync(new URL('apps/production-extension/hook.main.js', root), 'utf8');
  const first = hook.indexOf('// ADR-030 beacon MAIN sensor start');
  const last = hook.indexOf('// packages/sensors/src/runtime.ts', first);
  assert.ok(last > first);
  vm.runInContext(hook.slice(first, last) + ';globalThis.recorder = new ApiResultRecorder();', context);
  return context;
}
function number(operation = 'Window.innerWidth', value = 1000, count = 1, parameters = []) {
  return { operation, techniqueId: 'DET-030', phase: 'returned-sync', value: { kind: 'number', value }, count, parameters };
}

test('technical arguments never coerce arbitrary values or inspect option objects', () => {
  let calls = 0;
  const forbidden = new Proxy({}, { get() { calls++; throw Error('secret object read'); } });
  assert.deepEqual(proValueParameters('WebAssembly.Memory.grow', [forbidden]), []);
  assert.deepEqual(proValueParameters('Storage.setItem', ['token', forbidden]), []);
  assert.deepEqual(proValueParameters('Window.fetch', ['https://example.com/?secret=token', forbidden]), []);
  assert.equal(calls, 0);
  assert.deepEqual(proValueParameters('WebAssembly.Memory.grow', [2]), [{ name: 'arg0', kind: 'number', value: 2 }]);
});

test('schema validates the actual operation/technique and blocks sensitive result values', () => {
  const context = fixture(), validate = value => context.readApiResultEntries(value);
  assert.ok(proValueRows([number()], validate));
  assert.equal(proValueRows([number('Storage.getItem')], validate), null);
  const wrongTechnique = number(); wrongTechnique.techniqueId = 'DET-002';
  assert.equal(proValueRows([wrongTechnique], validate), null);
  const wrongArgument = number('Window.innerWidth', 1000, 1, [{ name: 'arg0', kind: 'string', value: 'SECRET' }]);
  assert.equal(proValueRows([wrongArgument], validate), null);
  const canvas = { operation: 'CanvasRenderingContext2D.getImageData', techniqueId: 'DET-002', phase: 'returned-sync', value: { kind: 'unobserved', reason: 'sensitive' }, parameters: proValueParameters('CanvasRenderingContext2D.getImageData', [0, 0, 1, 1]), count: 1 };
  assert.ok(proValueRows([canvas], validate));
  assert.equal(proValueRows([{ ...canvas, value: { kind: 'string', value: 'SECRET_PIXELS' } }], validate), null);
  let reads = 0;
  const accessor = { reason: 'sensitive', get kind() { reads++; return 'unobserved'; } };
  assert.equal(proValueRows([{ ...canvas, value: accessor }], validate), null); assert.equal(reads, 0);
});

test('duplicate, accessor, oversized and extra fields are rejected before report persistence', () => {
  const context = fixture(), validate = value => context.readApiResultEntries(value);
  assert.equal(proValueRows([number(), number()], validate), null);
  assert.equal(proValueRows(Array.from({ length: 257 }, (_, i) => number('Window.innerWidth', i)), validate), null);
  const accessor = number(); let reads = 0;
  Object.defineProperty(accessor, 'count', { get() { reads++; return 1; } });
  assert.equal(proValueRows([accessor], validate), null); assert.equal(reads, 0);
  const extra = number(); extra.requestBody = 'SECRET';
  assert.equal(proValueRows([extra], validate), null);
  assert.equal(proValueDocuments([{ documentKey: '1:0:fixture', rows: [number()], truncated: false, tabId: 9 }], validate), null);
  let coercions = 0;
  const hostileName = { [Symbol.toPrimitive]() { coercions++; return 'arg0'; } };
  const coercing = number('WebAssembly.Memory.grow', 1, 1, [{ name: hostileName, kind: 'number', value: 1 }]);
  coercing.techniqueId = 'DET-065';
  assert.equal(proValueRows([coercing], validate), null);
  assert.equal(coercions, 0);
});

test('Pro history is off until explicit start, aggregates variants, saturates and clears independently', () => {
  const context = fixture();
  vm.runInContext(`
    recorder.recordPro('Window.innerWidth', 'returned-sync', 1000);
    if (recorder.proRows.size !== 0) throw Error('capture was enabled without recording');
    recorder.proSession = 'fixture';
    recorder.recordPro('Window.innerWidth', 'returned-sync', 1000);
    recorder.recordPro('Window.innerWidth', 'returned-sync', 800);
    recorder.recordPro('Window.innerWidth', 'returned-sync', 1000);
    globalThis.samples = [...recorder.proRows.values()];
  `, context);
  assert.equal(context.samples.length, 2);
  assert.equal(context.samples.find(row => row.value.value === 1000).count, 2);
  vm.runInContext(`
    [...recorder.proRows.values()][0].count = 2147483647;
    recorder.recordPro('Window.innerWidth', 'returned-sync', 1000);
    if ([...recorder.proRows.values()][0].count !== 2147483647) throw Error('counter overflow');
    recorder.clear();
    if (recorder.proSession || recorder.proRows.size) throw Error('pause/reset retained live sensor history');
  `, context);
});

test('history admits at most 256 variants and records a visible truncation condition', () => {
  const context = fixture();
  vm.runInContext(`recorder.proSession = 'fixture'; for (let index = 0; index < 1000; index++) recorder.recordPro('Window.innerWidth', 'returned-sync', index);`, context);
  assert.ok(context.recorder.proRows.size <= 256);
  assert.ok(context.recorder.proBytes <= 65536);
  assert.equal(context.recorder.proTruncated, true);
});

test('captured argument helpers do not invoke page-poisoned prototype functions', () => {
  const context = fixture();
  vm.runInContext(`
    let calls = 0;
    const poison = () => { calls++; throw Error('page code executed'); };
    Array.prototype.push = poison; Array.prototype.includes = poison;
    RegExp.prototype.test = poison; Number.isFinite = poison; Object.hasOwn = poison;
    Math.abs = poison;
    const args = proValueParameters('WebAssembly.Memory.grow', [1]);
    if (args.length !== 1 || args[0].value !== 1 || calls !== 0) throw Error('observer used mutable page intrinsics');
  `, context);
});

test('sample identity distinguishes values, phases and technical arguments', () => {
  assert.notEqual(proValueKey(number()), proValueKey(number('Window.innerWidth', 800)));
  assert.notEqual(proValueKey(number()), proValueKey({ ...number(), phase: 'threw-sync' }));
  assert.notEqual(proValueKey(number('Window.innerWidth', 1, 1, [])), proValueKey(number('Window.innerWidth', 1, 1, [{ name: 'arg0', kind: 'number', value: 2 }])));
});
