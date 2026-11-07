import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EXTENDED_API_OPERATIONS, createExtendedSurfacesSupport, extendedSurfacesRuntimeSource } from '../production/extended-surfaces-runtime.mjs';

const operations = Object.fromEntries(EXTENDED_API_OPERATIONS.map(([name], index) => [name, index]));
const registry = { operationIndex: operations, techniqueIndex: { 'DET-014': 13, 'DET-042': 41, 'DET-058': 57, 'DET-069': 68 }, phaseIndex: { 'returned-sync': 1, 'threw-sync': 2, 'settlement-unobserved': 4 }, apiUse: 1 };
function wrappers() {
  const source = readFileSync(new URL('../../apps/production-extension/hook.main.js', import.meta.url), 'utf8');
  const from = source.indexOf('// packages/sensors/src/wrap.ts'), to = source.indexOf('// packages/sensors/src/intrinsics.ts', from);
  assert.ok(from >= 0 && to > from);
  const context = vm.createContext({});
  vm.runInContext(source.slice(from, to) + ';globalThis.api = {wrapMethod,wrapConstructor,wrapSetter};', context);
  return context.api;
}
function fixture({ install = true, selectedRegistry = registry } = {}) {
  const support = createExtendedSurfacesSupport(selectedRegistry, EXTENDED_API_OPERATIONS), wrappersApi = wrappers();
  const calls = [], events = [], construction = [], setterCalls = [];
  const failure = new Error('NATIVE_FAILURE'), brandFailure = new Error('NATIVE_BRAND_FAILURE'), throwArgument = {};
  const promise = Promise.resolve('PRIVATE_CREDENTIAL_CLIPBOARD_CANARY');
  let thenReads = 0;
  Object.defineProperty(promise, 'then', { get() { ++thenReads; throw new Error('Promise must remain untouched'); } });
  const buffer = new ArrayBuffer(4); new Uint8Array(buffer).set([71, 80, 85, 33]);
  const realm = {};
  for (const [name, , , kind] of EXTENDED_API_OPERATIONS) if (kind === 'construct') {
    const Constructor = function(arg) {
      construction.push({ name, arg, newTarget: new.target });
      if (!new.target || arg === throwArgument) throw failure;
      this.marker = name;
    };
    Object.defineProperty(Constructor, 'supported', { value: true, configurable: true });
    realm[name] = Constructor;
  }
  const instances = {};
  for (const family of ['CredentialsContainer', 'Clipboard', 'GPUBuffer']) {
    const brands = new WeakSet();
    realm[family] = class { constructor() { brands.add(this); } };
    for (const [operation] of EXTENDED_API_OPERATIONS.filter(([operation]) => operation.startsWith(family + '.'))) {
      const name = operation.slice(family.length + 1);
      Object.defineProperty(realm[family].prototype, name, { configurable: true, writable: true, value: function(...args) {
        calls.push({ operation, receiver: this, args });
        if (!brands.has(this)) throw brandFailure;
        if (args[0] === throwArgument) throw failure;
        return name === 'getMappedRange' ? buffer : name === 'unmap' ? undefined : promise;
      } });
    }
    instances[family] = new realm[family]();
  }
  realm.EventTarget = class { addEventListener(type, callback, options) { events.push({ receiver: this, type, callback, options }); if (options === throwArgument) throw failure; return undefined; } };
  for (const name of ['deviceorientation', 'devicemotion', 'deviceorientationabsolute']) Object.defineProperty(realm, 'on' + name, { configurable: true, get() { return null; }, set(callback) { setterCalls.push({ name, receiver: this, callback }); if (callback === throwArgument) throw failure; } });
  const runtime = { hooks: { enabled: true, observerErrors: 0 }, records: [], handles: [], stops: [], flags: [],
    attach(handles) { this.handles.push(...handles); }, onStop(callback) { this.stops.push(callback); }, addFlag(flag) { this.flags.push(flag); },
    recordOperation(index, phase) { this.records.push({ operation: EXTENDED_API_OPERATIONS[index][0], phase }); },
    record(technique, phase, signal) { this.records.push({ technique, phase, signal }); }, recordResult() { throw Error('Content/result channel must not be used'); }
  };
  const bind = () => support.install(runtime, realm, wrappersApi, fn => typeof fn === 'function');
  if (install) bind();
  // Integration into the existing EventTarget callback, without installing a second wrapper.
  wrappersApi.wrapMethod(realm.EventTarget.prototype, 'addEventListener', (receiver, args, threw) => support.observeDeviceEvent(runtime, receiver, args, threw), { context: runtime.hooks });
  return { support, runtime, realm, instances, calls, events, construction, setterCalls, failure, brandFailure, throwArgument, promise, buffer, bind, wrappersApi, thenReads: () => thenReads };
}

test('extended registry is fixed, unique, bounded and preserves the existing Clipboard DET binding', () => {
  assert.equal(EXTENDED_API_OPERATIONS.length, 22);
  assert.equal(new Set(EXTENDED_API_OPERATIONS.map(([name]) => name)).size, 22);
  assert.ok(EXTENDED_API_OPERATIONS.every(row => Object.isFrozen(row) && row[0].length <= 80));
  for (const row of EXTENDED_API_OPERATIONS.filter(([name]) => name.startsWith('Clipboard.'))) assert.equal(row[1], 'DET-069');
});

for (const [operation, , , kind] of EXTENDED_API_OPERATIONS.filter(([, , , kind]) => kind === 'call' || kind === 'async-call').filter(([name]) => !name.startsWith('Window.'))) {
  test(operation + ' calls the original once with original this and arguments and preserves its result', () => {
    const f = fixture(), [family, method] = operation.split('.'), receiver = f.instances[family];
    let touched = 0;
    const arg = new Proxy({}, { get() { touched++; throw Error('PRIVATE_ARG'); }, ownKeys() { touched++; throw Error('PRIVATE_ARG'); }, getOwnPropertyDescriptor() { touched++; throw Error('PRIVATE_ARG'); } });
    const result = receiver[method](arg, -0, Infinity);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].receiver, receiver); assert.equal(f.calls[0].args[0], arg);
    assert.ok(Object.is(f.calls[0].args[1], -0)); assert.equal(f.calls[0].args[2], Infinity);
    assert.equal(result, method === 'getMappedRange' ? f.buffer : method === 'unmap' ? undefined : f.promise);
    assert.deepEqual(f.runtime.records, [{ operation, phase: kind === 'async-call' ? 4 : 1 }]);
    assert.equal(touched, 0); assert.equal(f.thenReads(), 0);
    assert.equal(JSON.stringify(f.runtime.records).includes('PRIVATE'), false);
  });
  test(operation + ' preserves native exceptions and illegal receiver behavior', () => {
    const f = fixture(), [family, method] = operation.split('.');
    assert.throws(() => f.instances[family][method](f.throwArgument), error => error === f.failure);
    assert.throws(() => Reflect.apply(f.realm[family].prototype[method], {}, []), error => error === f.brandFailure);
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.runtime.records, [{ operation, phase: 2 }, { operation, phase: 2 }]);
  });
}

for (const [operation] of EXTENDED_API_OPERATIONS.filter(([, , , kind]) => kind === 'construct')) test(operation + ' preserves construction, subclass new.target, static properties and native throws', () => {
  const f = fixture(), arg = new Proxy({}, { get() { throw Error('Do not inspect options/URL'); } });
  const Constructor = f.realm[operation], Native = Object.getOwnPropertyDescriptor(Constructor, 'prototype').value.constructor;
  const value = new Constructor(arg);
  assert.equal(value.marker, operation); assert.ok(value instanceof Native); assert.ok(value instanceof Constructor);
  assert.equal(Constructor.supported, true); assert.equal(f.construction[0].arg, arg); assert.equal(f.construction[0].newTarget, Native);
  class Subclass extends Constructor {}
  const derived = new Subclass(arg);
  assert.ok(derived instanceof Subclass); assert.equal(f.construction[1].newTarget, Subclass);
  assert.throws(() => new Constructor(f.throwArgument), error => error === f.failure);
  assert.throws(() => Constructor(arg), error => error === f.failure);
  assert.equal(f.construction.length, 4);
  assert.deepEqual(f.runtime.records.map(row => row.phase), [1, 1, 2, 2]);
});

test('Window device listeners are exact-type API-use observations with no option/callback reads', () => {
  const f = fixture(), add = f.realm.EventTarget.prototype.addEventListener;
  const callback = new Proxy({}, { get() { throw Error('handleEvent must not be read'); } });
  const options = new Proxy({}, { get() { throw Error('options must not be inspected'); } });
  for (const name of ['deviceorientation', 'devicemotion', 'deviceorientationabsolute']) Reflect.apply(add, f.realm, [name, callback, options]);
  assert.equal(f.events.length, 3);
  assert.deepEqual(f.runtime.records.map(row => row.operation), ['Window.addEventListener.deviceorientation', 'Window.addEventListener.devicemotion', 'Window.addEventListener.deviceorientationabsolute']);
  Reflect.apply(add, new f.realm.EventTarget(), ['deviceorientation', callback]);
  Reflect.apply(add, f.realm, ['deviceorientation', null]);
  Reflect.apply(add, f.realm, [new String('deviceorientation'), callback]);
  assert.equal(f.runtime.records.length, 3, 'custom EventTargets, absent handlers and coerced event-name objects do not become device evidence');
  assert.throws(() => Reflect.apply(add, f.realm, ['devicemotion', callback, f.throwArgument]), error => error === f.failure);
  assert.equal(f.runtime.records.at(-1).phase, 2);
});

test('credential options and attestation accessors are read only by the original method', () => {
  const f = fixture({ install: false }); let calls = 0, publicKeyReads = 0, attestationReads = 0;
  const publicKey = { get attestation() { attestationReads++; return 'direct'; } };
  const options = { get publicKey() { publicKeyReads++; return publicKey; } };
  f.realm.CredentialsContainer.prototype.create = function(input) { calls++; assert.equal(input.publicKey.attestation, 'direct'); return f.promise; };
  f.bind();
  assert.equal(f.instances.CredentialsContainer.create(options), f.promise);
  assert.equal(calls, 1); assert.equal(publicKeyReads, 1); assert.equal(attestationReads, 1);
  assert.deepEqual(f.runtime.records, [{ operation: 'CredentialsContainer.create', phase: 4 }]);
  assert.equal(f.thenReads(), 0);
});

test('ordinary event types return before observer state and callback access, including a hot loop', () => {
  const support = createExtendedSurfacesSupport(registry, EXTENDED_API_OPERATIONS);
  let touched = 0;
  const runtime = new Proxy({}, { get() { touched++; throw Error('Observer work for irrelevant type'); } });
  const args = { 0: 'click', get 1() { touched++; throw Error('Callback inspected'); } };
  for (let i = 0; i < 100000; i++) support.observeDeviceEvent(runtime, null, args, false);
  assert.equal(touched, 0);
});

test('ondevice event setters preserve assignment and count callable handlers only', () => {
  const f = fixture(), callback = () => {};
  f.realm.ondeviceorientation = callback;
  f.realm.ondevicemotion = callback;
  f.realm.ondeviceorientationabsolute = callback;
  f.realm.ondeviceorientation = null;
  assert.equal(f.setterCalls.length, 4);
  assert.equal(f.setterCalls[0].callback, callback); assert.equal(f.setterCalls[0].receiver, f.realm);
  assert.deepEqual(f.runtime.records.map(row => row.operation), ['Window.ondeviceorientation', 'Window.ondevicemotion', 'Window.ondeviceorientationabsolute']);
});

test('pause and observer exceptions never change original result or native exception', () => {
  const f = fixture();
  f.runtime.hooks.enabled = false;
  assert.equal(f.instances.Clipboard.readText(), f.promise);
  assert.equal(f.runtime.records.length, 0); assert.equal(f.calls.length, 1);
  f.runtime.hooks.enabled = true;
  f.runtime.recordOperation = () => { throw Error('observer'); };
  assert.equal(f.instances.Clipboard.readText(), f.promise);
  assert.throws(() => f.instances.Clipboard.readText(f.throwArgument), error => error === f.failure);
  assert.equal(f.calls.length, 3); assert.equal(f.runtime.hooks.observerErrors, 2);
});

test('installation is idempotent, lifecycle cleanup removes realm registrations and preserves page replacements', () => {
  const f = fixture(), before = f.runtime.handles.length;
  f.bind(); assert.equal(f.runtime.handles.length, before); assert.equal(f.runtime.stops.length, 1);
  const replacement = () => 'page'; f.realm.Clipboard.prototype.read = replacement;
  for (const handle of f.runtime.handles) if (handle.status === 'installed') handle.restore();
  assert.equal(f.realm.Clipboard.prototype.read, replacement);
  f.runtime.stops[0]();
  f.support.observeDeviceEvent(f.runtime, f.realm, ['devicemotion', () => {}], false);
  assert.equal(f.runtime.records.length, 0);
});

test('missing, non-configurable and accessor-only surfaces do not invoke getters or block other hooks', () => {
  const f = fixture({ install: false }); let reads = 0;
  delete f.realm.Gyroscope;
  Object.defineProperty(f.realm, 'Accelerometer', { configurable: true, get() { reads++; throw Error('constructor getter'); } });
  Object.defineProperty(f.realm.Clipboard.prototype, 'read', { configurable: true, get() { reads++; throw Error('method getter'); } });
  Object.defineProperty(f.realm.Clipboard.prototype, 'write', { configurable: false, writable: true, value() { return f.promise; } });
  const result = f.bind();
  assert.equal(reads, 0); assert.ok(result.skipped.includes('Accelerometer')); assert.ok(result.skipped.includes('Clipboard.read')); assert.ok(result.skipped.includes('Gyroscope'));
  assert.ok(result.results.some(handle => handle.reason === 'non-configurable'));
  assert.equal(f.instances.Clipboard.writeText('PRIVATE'), f.promise);
  assert.equal(f.runtime.records.at(-1).operation, 'Clipboard.writeText');
});

test('missing operation registry entries retain bounded technique-level API-use without value reads', () => {
  const f = fixture({ selectedRegistry: { ...registry, operationIndex: {} } });
  f.instances.Clipboard.readText();
  assert.deepEqual(f.runtime.records, [{ technique: 68, phase: 4, signal: 1 }]);
});

test('serialized runtime factory is self-contained and keeps constructor/event hooks in an isolated context', () => {
  const context = vm.createContext({ TECHNIQUE_INDEX: registry.techniqueIndex, API_OPERATION_INDEX: operations, PHASE_INDEX: registry.phaseIndex, SIGNAL_BIT: { 'api-use': 1 } });
  vm.runInContext(extendedSurfacesRuntimeSource, context);
  assert.equal(typeof context.extendedSurfacesSupport.install, 'function');
  assert.equal(typeof context.extendedSurfacesSupport.observeDeviceEvent, 'function');
  assert.equal(context.extendedSurfaceDefinitions.length, 22);
});
