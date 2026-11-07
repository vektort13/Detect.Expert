// ADR-038 / DET-064: exercise the shipped wrapper implementation, not substitute wrappers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { createWorkerSurfacesSupport, workerSurfacesRuntimeSource } from '../production/worker-surfaces-runtime.mjs';

const operations = { Worker: 701, SharedWorker: 702, 'Worklet.addModule': 703 };
const phases = { 'returned-sync': 1, 'threw-sync': 2, 'settlement-unobserved': 4 };
function wrappers() {
  const source = readFileSync(new URL('../../apps/production-extension/hook.main.js', import.meta.url), 'utf8');
  const start = source.indexOf('// packages/sensors/src/wrap.ts'), end = source.indexOf('// packages/sensors/src/intrinsics.ts', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end) + ';globalThis.wrappers={wrapConstructor,wrapMethod};', context);
  return context.wrappers;
}
function fixture(realm, options = {}) {
  const rows = [], flags = new Set(), handles = [];
  const runtime = { hooks: { enabled: options.enabled ?? true, observerErrors: 0 },
    recordOperation(operation, phase) { if (options.observerError) throw options.observerError; rows.push({ operation, phase }); },
    addFlag(flag) { flags.add(flag); },
    attach(results) { for (const handle of results) if (handle.status === 'installed') { if (!handles.includes(handle)) handles.push(handle); } else flags.add(handle.coverageFlag); },
  };
  const support = createWorkerSurfacesSupport(), wrap = wrappers();
  const installed = support.install(runtime, realm, wrap, options.operations ?? operations, phases, options.nativeCheck ?? (value => typeof value === 'function'));
  return { runtime, rows, flags, handles, installed, support, wrap };
}

test('Worker constructor preserves prototype, statics, arguments and direct new.target with one native call', () => {
  const marker = Symbol('static'), calls = [];
  function Worker(url, options) { calls.push({ target: new.target, args: [...arguments] }); this.url = url; this.options = options; }
  Worker[marker] = 'constant'; const realm = { Worker }, options = { type: 'module', credentials: 'include' };
  const f = fixture(realm), result = new realm.Worker('/private/worker.js?SECRET', options);
  assert.equal(calls.length, 1); assert.equal(calls[0].target, Worker); assert.deepEqual(calls[0].args, ['/private/worker.js?SECRET', options]);
  assert.equal(result.options, options); assert.equal(Object.getPrototypeOf(result), Worker.prototype); assert.ok(result instanceof realm.Worker);
  assert.equal(realm.Worker[marker], 'constant'); assert.equal(realm.Worker.name, Worker.name); assert.equal(realm.Worker.length, Worker.length);
  assert.deepEqual(f.rows, [{ operation: 701, phase: 1 }]); assert.ok(f.flags.has('worker-not-observed'));
  assert.doesNotMatch(JSON.stringify(f.rows), /SECRET|private|module|credentials/);
});

test('subclass and Reflect.construct retain the caller supplied new.target', () => {
  const targets = [];
  function Worker() { targets.push(new.target); }
  const realm = { Worker }; fixture(realm);
  class Child extends realm.Worker {}
  const child = new Child('/worker.js'); assert.equal(targets[0], Child); assert.equal(Object.getPrototypeOf(child), Child.prototype);
  function Alternate() {}
  const alternate = Reflect.construct(realm.Worker, ['/worker.js'], Alternate);
  assert.equal(targets[1], Alternate); assert.equal(Object.getPrototypeOf(alternate), Alternate.prototype);
});

test('constructor synchronous failures and missing new retain exact exception identity', () => {
  const exception = new TypeError('native failure'); let calls = 0;
  function Worker() { ++calls; throw exception; }
  const realm = { Worker }, f = fixture(realm);
  assert.throws(() => new realm.Worker('invalid'), error => error === exception);
  assert.throws(() => realm.Worker('invalid'), error => error === exception);
  assert.equal(calls, 2); assert.deepEqual(f.rows, [{ operation: 701, phase: 2 }, { operation: 701, phase: 2 }]);
  assert.equal(f.flags.has('worker-not-observed'), false);
});

test('native URL/options coercion happens once and the observer reads no extra page properties', () => {
  let stringReads = 0, optionReads = 0;
  const url = { [Symbol.toPrimitive]() { ++stringReads; return '/worker.js'; } };
  const options = new Proxy({}, { get(_target, key) { assert.equal(key, 'type'); ++optionReads; return 'module'; }, ownKeys() { throw Error('observer enumeration'); }, getOwnPropertyDescriptor() { throw Error('observer descriptor'); } });
  function Worker(raw, opts) { this.url = String(raw); this.kind = opts.type; }
  const realm = { Worker }; fixture(realm); const worker = new realm.Worker(url, options);
  assert.equal(worker.url, '/worker.js'); assert.equal(worker.kind, 'module'); assert.equal(stringReads, 1); assert.equal(optionReads, 1);
});

test('SharedWorker legacy name and opaque options are forwarded untouched', () => {
  let reads = 0; const calls = [];
  const opaque = new Proxy({}, { get() { ++reads; throw Error('get'); }, ownKeys() { ++reads; throw Error('keys'); }, getOwnPropertyDescriptor() { ++reads; throw Error('descriptor'); }, getPrototypeOf() { ++reads; throw Error('prototype'); } });
  function SharedWorker() { calls.push([...arguments]); }
  const realm = { SharedWorker }, f = fixture(realm);
  new realm.SharedWorker(opaque, 'private shared-worker name'); new realm.SharedWorker(opaque, opaque);
  assert.equal(reads, 0); assert.equal(calls[0][0], opaque); assert.equal(calls[1][1], opaque);
  assert.deepEqual(f.rows, [{ operation: 702, phase: 1 }, { operation: 702, phase: 1 }]);
});

test('Worklet.addModule keeps this and Promise identity without inspecting the result', () => {
  const calls = []; let thenReads = 0;
  const promise = Object.defineProperty({}, 'then', { get() { ++thenReads; throw Error('foreign then'); } });
  class Worklet { addModule() { calls.push({ receiver: this, args: [...arguments] }); return promise; } }
  const f = fixture({ Worklet }), worklet = new Worklet(), options = { credentials: 'omit' };
  assert.equal(worklet.addModule('/module.js', options), promise);
  assert.equal(calls.length, 1); assert.equal(calls[0].receiver, worklet); assert.equal(calls[0].args[1], options); assert.equal(thenReads, 0);
  assert.deepEqual(f.rows, [{ operation: 703, phase: 4 }]); assert.ok(f.flags.has('worker-not-observed'));
});

test('Worklet rejected Promise is not observed or replaced', async () => {
  const error = new Error('native rejection'), promise = Promise.reject(error); let thenReads = 0;
  Object.defineProperty(promise, 'then', { get() { ++thenReads; throw Error('observer then'); } });
  class Worklet { addModule() { return promise; } }
  const f = fixture({ Worklet }), returned = new Worklet().addModule('/module.js');
  assert.equal(returned, promise); assert.equal(thenReads, 0);
  await Reflect.apply(Promise.prototype.then, promise, [() => assert.fail('must reject'), reason => assert.equal(reason, error)]);
  assert.equal(thenReads, 0); assert.deepEqual(f.rows, [{ operation: 703, phase: 4 }]);
});

test('Worklet sync exception is preserved and adds no successful-return coverage flag', () => {
  const error = new TypeError('wrong receiver'); let calls = 0;
  class Worklet { addModule() { ++calls; throw error; } }
  const f = fixture({ Worklet }); assert.throws(() => Worklet.prototype.addModule.call(null, '/module.js'), reason => reason === error);
  assert.equal(calls, 1); assert.deepEqual(f.rows, [{ operation: 703, phase: 2 }]); assert.equal(f.flags.has('worker-not-observed'), false);
});

test('pause suppresses worker observations while originals continue exactly once', () => {
  let calls = 0; function Worker() { ++calls; }
  const realm = { Worker }, f = fixture(realm);
  f.runtime.hooks.enabled = false; new realm.Worker('/worker.js'); assert.equal(calls, 1); assert.equal(f.rows.length, 0); assert.equal(f.flags.size, 0);
  f.runtime.hooks.enabled = true; new realm.Worker('/worker.js'); assert.equal(calls, 2); assert.equal(f.rows.length, 1);
  const pausedRealm = { Worker }; const paused = fixture(pausedRealm, { enabled: false }); assert.equal(pausedRealm.Worker, Worker); assert.equal(paused.handles.length, 0);
});

test('observer exceptions do not change constructor or module result', () => {
  const observerError = new Error('observer only'), result = {};
  function Worker() { return result; }
  class Worklet { addModule() { return result; } }
  const realm = { Worker, Worklet }, f = fixture(realm, { observerError });
  assert.equal(new realm.Worker('/worker.js'), result); assert.equal(new Worklet().addModule('/module.js'), result);
  assert.equal(f.runtime.hooks.observerErrors, 2);
});

test('owned restore reverts hooks and never overwrites a later page replacement', () => {
  function Worker() {} function SharedWorker() {}
  const realm = { Worker, SharedWorker }, f = fixture(realm);
  const workerHandle = f.handles.find(handle => handle.key === 'Worker'), sharedHandle = f.handles.find(handle => handle.key === 'SharedWorker');
  assert.equal(workerHandle.restore(), true); assert.equal(realm.Worker, Worker);
  const replacement = function Replacement() {}; realm.SharedWorker = replacement;
  assert.equal(sharedHandle.restore(), false); assert.equal(realm.SharedWorker, replacement);
});

test('shared Worklet prototype installs once and covers subtype calls', () => {
  class Worklet { addModule() { return null; } }
  class AudioWorklet extends Worklet {} class PaintWorklet extends Worklet {}
  const f = fixture({ Worklet, AudioWorklet, PaintWorklet });
  assert.equal(f.handles.filter(handle => handle.key === 'addModule').length, 1);
  new AudioWorklet().addModule('a'); new PaintWorklet().addModule('b'); assert.equal(f.rows.length, 2);
});

test('subtype-only exposure and inherited data globals resolve without reading audio/CSS getters', () => {
  class BaseWorklet { addModule() { return null; } } class AudioWorklet extends BaseWorklet {}
  function Worker() {}
  const realm = Object.create({ Worker, AudioWorklet });
  Object.defineProperty(realm, 'CSS', { get() { throw Error('CSS getter'); } });
  const f = fixture(realm); new realm.Worker('a'); new AudioWorklet().addModule('b');
  assert.deepEqual(f.rows, [{ operation: 701, phase: 1 }, { operation: 703, phase: 4 }]);
});

test('unknown global accessors are not evaluated and missing APIs do not imply worker activity', () => {
  let reads = 0; const realm = {};
  for (const name of ['Worker', 'SharedWorker', 'Worklet', 'AudioWorklet', 'PaintWorklet']) Object.defineProperty(realm, name, { get() { ++reads; throw Error('getter'); } });
  const f = fixture(realm); assert.equal(reads, 0); assert.equal(f.handles.length, 0); assert.equal(f.rows.length, 0); assert.equal(f.flags.has('worker-not-observed'), false);
});

test('non-native functions and nonconfigurable descriptors are not forcibly replaced', () => {
  function Worker() {}
  const untrusted = { Worker }, skipped = fixture(untrusted, { nativeCheck: () => false });
  assert.equal(untrusted.Worker, Worker); assert.equal(skipped.handles.length, 0);
  const locked = {}; Object.defineProperty(locked, 'Worker', { value: Worker, configurable: false });
  const unsupported = fixture(locked); assert.equal(locked.Worker, Worker); assert.equal(unsupported.handles.length, 0); assert.ok(unsupported.flags.has('descriptor-nonconfigurable'));
});

test('missing canonical operation binding does not install an unreportable hook', () => {
  function Worker() {} const realm = { Worker }, f = fixture(realm, { operations: {} });
  assert.equal(realm.Worker, Worker); assert.equal(f.handles.length, 0); assert.ok(f.flags.has('hook-failed'));
});

test('repeated installation uses existing owned handles and does not duplicate observations', () => {
  function Worker() {} const realm = { Worker }, f = fixture(realm);
  f.support.install(f.runtime, realm, f.wrap, operations, phases, value => typeof value === 'function');
  new realm.Worker('a'); assert.equal(f.handles.length, 1); assert.equal(f.rows.length, 1);
});

test('serialized browser runtime is standalone and avoids ambient Array iteration', () => {
  const context = vm.createContext({});
  vm.runInContext(workerSurfacesRuntimeSource, context);
  assert.equal(typeof context.workerSurfacesSupport.install, 'function');
  vm.runInContext('Array.prototype.every = () => { throw new Error("page every"); }; Array.prototype[Symbol.iterator] = () => { throw new Error("page iterator"); };', context);
  const runtime = { hooks: { enabled: true }, addFlag() {}, recordOperation() {}, attach() {} };
  assert.doesNotThrow(() => context.workerSurfacesSupport.install(runtime, {}, {}, operations, phases));
});
