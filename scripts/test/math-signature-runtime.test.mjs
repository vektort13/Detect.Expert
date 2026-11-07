// ADR-038 / DET-022/023: real shipped wrapper semantics, no substituted wrapper.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { createMathSignatureSupport, mathSignatureRuntimeSource } from '../production/math-signature-runtime.mjs';

const names = ['sin', 'cos', 'tan', 'acos', 'acosh', 'asin', 'pow'];
const techniques = { 'DET-022': 21, 'DET-023': 22 }, phases = { 'returned-sync': 1, 'threw-sync': 2 }, signals = { 'api-use': 1, 'known-numeric-pattern': 8 };
const argumentsByName = { sin: [-1e300], cos: [10.000000000123], tan: [-1e300], acos: [0.123124234234234242], acosh: [1e308], asin: [0.123124234234234242], pow: [Math.PI, -100] };
function shippedWrappers() {
  const source = readFileSync(new URL('../../apps/production-extension/hook.main.js', import.meta.url), 'utf8');
  const start = source.indexOf('// packages/sensors/src/wrap.ts'), end = source.indexOf('// packages/sensors/src/intrinsics.ts', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end) + ';globalThis.wrappers={wrapMethod};', context);
  return context.wrappers;
}
function fixture(options = {}) {
  const original = Object.fromEntries(names.map(name => [name, Math[name]]));
  const math = Object.defineProperties({}, Object.getOwnPropertyDescriptors(Math));
  Object.assign(math, options.methods);
  const realm = options.realm ?? { Math: math }, rows = [], flags = new Set(), cleanups = [], attachments = [];
  const runtime = {
    hooks: { enabled: options.enabled ?? true, observerErrors: 0 }, apiResults: { proSession: options.session ?? '', onProSessionChanged: options.previous },
    record(...args) { if (options.observeError) throw options.observeError; rows.push(args); },
    recordResult() { assert.fail('Math values must never be recorded'); },
    recordOperation() { assert.fail('Math signal mask must survive generic aggregate'); },
    addFlag(flag) { flags.add(flag); },
    attach(items) { attachments.push(...items); },
    onStop(callback) { if (options.stopped) callback(); else cleanups.push(callback); },
  };
  const wrappers = shippedWrappers(), support = options.support ?? createMathSignatureSupport();
  const state = support.install(runtime, realm, wrappers, options.techniques ?? techniques, phases, signals, options.nativeCheck);
  const activate = () => runtime.apiResults.onProSessionChanged(true), deactivate = () => runtime.apiResults.onProSessionChanged(false);
  return { original, math, realm, runtime, rows, flags, cleanups, attachments, wrappers, support, state, activate, deactivate };
}

test('ordinary mode has original descriptors, function identities and no Math observation', () => {
  const f = fixture();
  for (const name of names) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(f.math, name), Object.getOwnPropertyDescriptor(Math, name));
    assert.equal(f.math[name], Math[name]); f.math[name](...argumentsByName[name]);
  }
  assert.equal(f.state.installed, 0); assert.equal(f.state.active, false); assert.deepEqual(f.rows, []); assert.equal(f.cleanups.length, 1);
});

test('all seven primitive markers record only technique/phase/signal, preserving results and metadata', () => {
  const f = fixture(); f.activate();
  for (const name of names) {
    assert.equal(f.math[name](...argumentsByName[name]), Math[name](...argumentsByName[name]));
    assert.equal(f.math[name].name, Math[name].name); assert.equal(f.math[name].length, Math[name].length);
    assert.equal(Object.getPrototypeOf(f.math[name]), Object.getPrototypeOf(Math[name]));
  }
  assert.equal(f.state.installed, 7); assert.equal(f.rows.length, 7);
  assert.deepEqual(f.rows, names.map(name => [name === 'pow' ? 22 : 21, 1, 9]));
  assert.doesNotMatch(JSON.stringify(f.rows), /1e\+?300|1e\+?308|123124|000000000123|141592|100|result|arg|script/);
});

test('normal scientific, graphic and burst workloads produce no signal', () => {
  const f = fixture(); f.activate();
  for (let index = 0; index < 250; ++index) {
    const angle = index / 251;
    f.math.sin(angle); f.math.cos(angle); f.math.tan(angle); f.math.acos(angle); f.math.asin(angle); f.math.acosh(1 + angle); f.math.pow(angle, 2);
  }
  assert.deepEqual(f.rows, []);
});

test('a scientific use of a marker remains only api-use plus the numeric marker, never a vendor or intent verdict', () => {
  const f = fixture(); f.activate(); f.math.acosh(1e308);
  assert.deepEqual(f.rows, [[21, 1, 9]]); assert.deepEqual([...f.flags], []);
});

test('NaN, signed zero, infinities, missing and extra arguments preserve native output without matching', () => {
  const f = fixture(); f.activate();
  for (const name of names) for (const input of [NaN, -0, 0, Infinity, -Infinity]) {
    assert.ok(Object.is(f.math[name](input), Math[name](input)));
  }
  for (const name of names) {
    assert.ok(Object.is(f.math[name](), Math[name]()));
    const args = [...argumentsByName[name], 'ignored'];
    assert.ok(Object.is(f.math[name](...args), Math[name](...args)));
  }
  assert.deepEqual(f.rows, []);
});

test('numeric strings and boxed marker numbers are forwarded but not classified', () => {
  const f = fixture(); f.activate();
  for (const name of names) {
    const strings = argumentsByName[name].map(String), boxed = argumentsByName[name].map(value => new Number(value));
    assert.ok(Object.is(f.math[name](...strings), Math[name](...strings)));
    assert.ok(Object.is(f.math[name](...boxed), Math[name](...boxed)));
  }
  assert.deepEqual(f.rows, []);
});

test('Proxy coercion occurs once solely in the original native function', () => {
  const f = fixture(); f.activate(); let reads = 0, calls = 0;
  const argument = new Proxy({}, { get(_target, key) { assert.equal(key, Symbol.toPrimitive); ++reads; return hint => { assert.equal(hint, 'number'); ++calls; return -1e300; }; }, ownKeys() { assert.fail('enumerated argument'); }, getOwnPropertyDescriptor() { assert.fail('argument descriptor'); } });
  assert.equal(f.math.sin(argument), Math.sin(-1e300)); assert.equal(reads, 1); assert.equal(calls, 1); assert.deepEqual(f.rows, []);
});

test('native coercion errors and thrown object identity survive the observer unchanged', () => {
  const f = fixture(); f.activate(); const exception = new Error('coercion sentinel'); let coercions = 0;
  assert.throws(() => f.math.sin({ [Symbol.toPrimitive]() { ++coercions; throw exception; } }), error => error === exception);
  assert.equal(coercions, 1);
  for (const value of [1n, Symbol('not a number')]) assert.throws(() => f.math.sin(value), TypeError);
  assert.deepEqual(f.rows, []);
});

test('original is called once with exact this/arguments and original thrown value is preserved', () => {
  const calls = [], receiver = {}, exception = Symbol('throw');
  const f = fixture({ methods: { sin() { calls.push({ receiver: this, args: [...arguments] }); throw exception; } }, nativeCheck: value => typeof value === 'function' });
  f.activate(); assert.throws(() => Reflect.apply(f.math.sin, receiver, [-1e300]), error => error === exception);
  assert.equal(calls.length, 1); assert.equal(calls[0].receiver, receiver); assert.deepEqual(calls[0].args, [-1e300]); assert.deepEqual(f.rows, [[21, 2, 9]]);
});

test('observer failure cannot change a successful Math result', () => {
  const f = fixture({ observeError: new Error('observer') }); f.activate();
  assert.equal(f.math.sin(-1e300), Math.sin(-1e300)); assert.equal(f.runtime.hooks.observerErrors, 1);
});

test('pause prevents observations and clear physically restores every original descriptor', () => {
  const f = fixture(); f.activate(); f.runtime.hooks.enabled = false; f.math.sin(-1e300);
  assert.deepEqual(f.rows, []); f.deactivate(); assert.equal(f.state.installed, 0);
  for (const name of names) assert.deepEqual(Object.getOwnPropertyDescriptor(f.math, name), Object.getOwnPropertyDescriptor(Math, name));
  f.runtime.hooks.enabled = true; f.math.sin(-1e300); assert.deepEqual(f.rows, []);
});

test('clear also disables previously saved wrapper references', () => {
  const f = fixture(); f.activate(); const saved = f.math.sin; f.deactivate();
  assert.equal(saved(-1e300), Math.sin(-1e300)); assert.deepEqual(f.rows, []);
});

test('repeated Pro sessions are bounded, idempotent and do not accumulate runtime handles or cleanup callbacks', () => {
  const f = fixture();
  for (let cycle = 0; cycle < 100; ++cycle) {
    f.activate(); const sin = f.math.sin; f.activate(); assert.equal(f.math.sin, sin); assert.equal(f.state.installed, 7);
    f.math.sin(-1e300); f.deactivate(); f.deactivate(); assert.equal(f.state.installed, 0); assert.equal(f.math.sin, Math.sin);
  }
  assert.equal(f.rows.length, 100); assert.equal(f.cleanups.length, 1); assert.deepEqual(f.attachments, []);
});

test('ownership restoration preserves later page replacements and never wraps them on the next session', () => {
  const f = fixture(); f.activate(); const replacement = () => 'page-owned'; f.math.sin = replacement; f.deactivate();
  assert.equal(f.math.sin, replacement); assert.ok(f.flags.has('hook-failed'));
  f.activate(); assert.equal(f.math.sin, replacement); assert.equal(f.state.installed, 6); f.deactivate();
});

test('stop restores owned methods, removes its callback and cannot restart', () => {
  let previousCalls = 0; const previous = () => { ++previousCalls; }, f = fixture({ previous });
  const callback = f.runtime.apiResults.onProSessionChanged; f.activate(); f.cleanups[0]();
  for (const name of names) assert.equal(f.math[name], Math[name]);
  assert.equal(f.runtime.apiResults.onProSessionChanged, previous); callback(true); assert.equal(f.state.installed, 0); assert.equal(f.state.active, false);
  assert.equal(previousCalls, 2);
});

test('immediate stop during installation cannot activate hooks even when a session was present', () => {
  const f = fixture({ session: 'existing-pro', stopped: true });
  assert.equal(f.state.installed, 0); assert.equal(f.state.active, false); assert.equal(f.math.sin, Math.sin);
});

test('already-active session is installed once and a duplicate install shares lifecycle state', () => {
  const f = fixture({ session: 'existing-pro' }); assert.equal(f.state.installed, 7);
  assert.equal(f.support.install(f.runtime, f.realm, f.wrappers, techniques, phases, signals), f.state); assert.equal(f.cleanups.length, 1);
  f.deactivate();
});

test('unknown Math getter is never read and missing/non-native/non-configurable functions do not get replaced', () => {
  let reads = 0; const realm = Object.defineProperty({}, 'Math', { get() { ++reads; throw Error('page getter'); } });
  const noMath = fixture({ realm }); noMath.activate(); assert.equal(reads, 0); assert.equal(noMath.state.installed, 0); assert.ok(noMath.flags.has('hook-failed'));
  const f = fixture({ methods: { sin() { return 1; } } });
  const original = f.math.sin; Object.defineProperty(f.math, 'cos', { value: Math.cos, configurable: false }); delete f.math.tan;
  f.activate(); assert.equal(f.math.sin, original); assert.equal(f.math.cos, Math.cos); assert.equal(f.state.installed, 4); assert.equal(f.attachments.length, 1);
});

test('missing canonical indices fail closed before installing any hook or callback', () => {
  const f = fixture({ techniques: { 'DET-022': 21 } }); assert.equal(f.state, null); assert.equal(f.cleanups.length, 0); assert.equal(f.math.sin, Math.sin); assert.ok(f.flags.has('hook-failed'));
});

test('the serialized module works with hostile live array iterators and methods without executing them', () => {
  const context = vm.createContext({});
  vm.runInContext(mathSignatureRuntimeSource + ';globalThis.support=mathSignatureSupport;', context);
  vm.runInContext('Array.prototype[Symbol.iterator]=function(){throw Error("iterator")};Array.prototype.push=function(){throw Error("push")};Array.prototype.every=function(){throw Error("every")};', context);
  const f = fixture({ support: context.support }); f.activate(); f.math.sin(-1e300); assert.deepEqual(f.rows, [[21, 1, 9]]); f.deactivate(); assert.equal(f.math.sin, Math.sin);
});
