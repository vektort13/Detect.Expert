import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { WASM_SURFACES, WASM_OPERATION_DEFINITIONS } from '../../packages/contracts/src/webassembly-apis.mjs';
import { createWebAssemblyObserverSupport } from '../production/webassembly-runtime.mjs';
import { synchronizeWebAssemblySource, WEBASSEMBLY_BUNDLES } from '../production/sync-webassembly-runtime.mjs';

const operationIndex = Object.fromEntries(WASM_OPERATION_DEFINITIONS.map(([name], index) => [name, index]));
const registry = { operationIndex, phaseIndex: { 'returned-sync': 1, 'threw-sync': 2, 'settlement-unobserved': 4 } };
function wrappers() {
  const source = readFileSync(new URL('../../apps/production-extension/hook.main.js', import.meta.url), 'utf8');
  const from = source.indexOf('// packages/sensors/src/wrap.ts'), to = source.indexOf('// packages/sensors/src/intrinsics.ts', from);
  assert.ok(from >= 0 && to > from);
  return vm.runInNewContext(source.slice(from, to) + ';({ wrapConstructor, wrapGetter, wrapSetter, wrapOutcomeMethod, wrapResultMethod })', {});
}
function fixture({ install = true, ownStack = false } = {}) {
  const calls = [], records = [], previews = [], handles = [], flags = [], failure = new Error('NATIVE_FAILURE');
  const brands = new WeakSet(), namespace = {}, realm = { WebAssembly: namespace };
  let privateReads = 0, thenReads = 0, stackReads = 0, stackSets = 0;
  const privateValue = new Proxy({}, { get() { privateReads++; throw Error('PRIVATE_VALUE_READ'); }, ownKeys() { privateReads++; throw Error('PRIVATE_VALUE_KEYS'); } });
  const promise = Promise.resolve();
  Object.defineProperty(promise, 'then', { get() { thenReads++; throw Error('PROMISE_READ'); } });
  const values = new WeakMap();
  for (const row of WASM_SURFACES.filter(row => row.kind === 'construct')) {
    const original = function(value) {
      calls.push({ operation: row.operation, receiver: this, args: [...arguments], newTarget: new.target });
      if (!new.target || value === failure) throw failure;
      brands.add(this); values.set(this, value);
      if (ownStack && row.property === 'Exception') Object.defineProperty(this, 'stack', { configurable: true, enumerable: false,
        get() { stackReads++; if (!brands.has(this)) throw failure; return 'PRIVATE_STACK_CANARY'; },
        set(value) { stackSets++; values.set(this, value); }
      });
      return this;
    };
    namespace[row.property] = original;
  }
  const target = row => row.target === 'namespace' ? namespace : row.target === 'static' ? namespace[row.owner] : namespace[row.owner].prototype;
  for (const row of WASM_SURFACES.filter(row => row.kind !== 'construct')) {
    const object = target(row), field = Object.getOwnPropertyDescriptor(object, row.property);
    const invoke = (receiver, args) => {
      calls.push({ operation: row.operation, receiver, args });
      if (row.target === 'prototype' && !brands.has(receiver) || args[0] === failure) throw failure;
      return row.kind === 'async-call' ? promise : row.operation === 'WebAssembly.validate' ? true : row.operation === 'WebAssembly.Memory.grow' ? -0 : privateValue;
    };
    if (row.kind === 'get') Object.defineProperty(object, row.property, { ...field, configurable: true, enumerable: true, get: { get() { return invoke(this, [...arguments]); } }.get });
    else if (row.kind === 'set') Object.defineProperty(object, row.property, { ...field, configurable: true, enumerable: true, set: { set(value) { invoke(this, [...arguments]); values.set(this, value); } }.set });
    else Object.defineProperty(object, row.property, { configurable: true, writable: true, value: { method() { return invoke(this, [...arguments]); } }.method });
  }
  const originals = Object.fromEntries(WASM_SURFACES.filter(row => row.kind === 'construct').map(row => [row.property, namespace[row.property]]));
  const instances = Object.fromEntries(Object.entries(originals).map(([name, Constructor]) => [name, new Constructor()])); calls.length = 0;
  const runtime = { hooks: { enabled: true, observerErrors: 0 }, attach(next) { handles.push(...next); },
    recordOperation(index, phase) { records.push({ operation: WASM_OPERATION_DEFINITIONS[index][0], phase }); },
    recordResult(...args) { previews.push(args); }, addFlag(flag) { flags.push(flag); }
  };
  const support = createWebAssemblyObserverSupport(registry, WASM_SURFACES), wrap = wrappers();
  const bind = () => support.install(runtime, realm, wrap, ownStack ? fn => typeof fn === 'function' : undefined);
  if (install) bind();
  return { calls, records, previews, handles, flags, runtime, realm, namespace, originals, instances, failure, privateValue, promise, values, bind,
    privateReads: () => privateReads, thenReads: () => thenReads, stackReads: () => stackReads, stackSets: () => stackSets };
}
function invoke(f, row, args = [f.privateValue, -0, Infinity]) {
  const owner = row.target === 'namespace' ? f.namespace : row.target === 'static' ? f.namespace[row.owner] : f.instances[row.owner];
  if (row.kind === 'construct') return Reflect.construct(owner[row.property], args);
  if (row.kind === 'get') return Reflect.apply(Object.getOwnPropertyDescriptor(f.originals[row.owner].prototype, row.property).get, owner, args);
  if (row.kind === 'set') return Reflect.apply(Object.getOwnPropertyDescriptor(f.originals[row.owner].prototype, row.property).set, owner, args);
  return Reflect.apply(owner[row.property], owner, args);
}

for (const row of WASM_SURFACES) test(row.operation + ' preserves native call, arguments, result and phase without reading content', () => {
  const f = fixture(), value = invoke(f, row);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].operation, row.operation);
  assert.equal(f.calls[0].args[0], f.privateValue); assert.ok(Object.is(f.calls[0].args[1], -0)); assert.equal(f.calls[0].args[2], Infinity);
  assert.deepEqual(f.records, [{ operation: row.operation, phase: row.kind === 'async-call' ? 4 : 1 }]);
  if (row.kind === 'construct') { assert.ok(value instanceof f.originals[row.property]); assert.equal(f.calls[0].newTarget, f.originals[row.property]); }
  else if (row.kind === 'async-call') assert.equal(value, f.promise);
  else if (row.kind === 'set') { assert.equal(value, undefined); assert.equal(f.values.get(f.instances[row.owner]), f.privateValue); }
  else if (row.operation === 'WebAssembly.validate') assert.equal(value, true);
  else if (row.operation === 'WebAssembly.Memory.grow') assert.ok(Object.is(value, -0));
  else assert.equal(value, f.privateValue);
  assert.equal(f.privateReads(), 0); assert.equal(f.thenReads(), 0);
  const legacy = WASM_SURFACES.indexOf(row) < 10;
  assert.equal(f.previews.length, legacy ? 1 : 0, 'new operations have no result/argument preview channel');
  assert.equal(JSON.stringify(f.records).includes('PRIVATE'), false);
});

for (const row of WASM_SURFACES.filter(row => row.kind !== 'get')) test(row.operation + ' preserves original exception identity', () => {
  const f = fixture(); assert.throws(() => invoke(f, row, [f.failure]), error => error === f.failure);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.records, [{ operation: row.operation, phase: 2 }]);
});

test('Global.value accessor slots preserve invalid receiver, descriptors, non-constructibility and native-only value coercion', () => {
  const f = fixture(), prototype = f.originals.Global.prototype;
  const field = Object.getOwnPropertyDescriptor(prototype, 'value');
  assert.equal(field.enumerable, true); assert.equal(field.configurable, true);
  for (const fn of [field.get, field.set]) {
    assert.equal(Object.hasOwn(fn, 'prototype'), false);
    assert.throws(() => Reflect.construct(String, [], fn), TypeError);
    assert.throws(() => Reflect.apply(fn, {}, [f.privateValue]), error => error === f.failure);
  }
  assert.equal(f.privateReads(), 0);
});

test('namespace constructor, prototype alias and statics share the observed functions, preserving subclass new.target', () => {
  const f = fixture(), Module = f.namespace.Module;
  assert.equal(Module.prototype.constructor, Module);
  assert.equal(Module.imports, f.originals.Module.imports);
  Module.prototype.constructor.imports(f.privateValue);
  const aliasValue = new Module.prototype.constructor(f.privateValue);
  assert.ok(aliasValue instanceof Module);
  class Subclass extends Module {}
  const derived = new Subclass(f.privateValue);
  assert.ok(derived instanceof Subclass); assert.equal(f.calls.at(-1).newTarget, Subclass);
  assert.deepEqual(f.records.map(row => row.operation), ['WebAssembly.Module.imports', 'WebAssembly.Module', 'WebAssembly.Module']);
});

test('pause, observer failures and stop do not change native behavior; page descriptor replacement survives restore', () => {
  const f = fixture(), field = Object.getOwnPropertyDescriptor(f.originals.Global.prototype, 'value');
  f.runtime.hooks.enabled = false; assert.equal(f.instances.Global.value, f.privateValue); f.instances.Global.value = f.privateValue;
  assert.equal(f.records.length, 0); f.runtime.hooks.enabled = true;
  f.runtime.recordOperation = () => { throw Error('OBSERVER_FAILURE'); };
  assert.equal(f.instances.Global.value, f.privateValue); f.instances.Global.value = f.privateValue;
  assert.equal(f.runtime.hooks.observerErrors, 2);
  const foreign = () => 'page'; Object.defineProperty(f.originals.Global.prototype, 'value', { get: foreign, set: field.set, configurable: true });
  const getterHandle = f.handles.find(handle => handle.target === f.originals.Global.prototype && handle.key === 'value');
  assert.equal(getterHandle.restore(), false); assert.equal(f.instances.Global.value, 'page');
  f.runtime.hooks.enabled = false;
  for (const handle of [...f.handles].reverse()) if (handle.status === 'installed') handle.restore();
  assert.equal(f.namespace.Module, f.originals.Module); assert.equal(f.originals.Module.prototype.constructor, f.originals.Module);
});

test('absent and frozen APIs are not fabricated, duplicate install is inert, foreign constructor aliases are preserved', () => {
  const f = fixture({ install: false }); delete f.namespace.promising; delete f.namespace.Tag.prototype.type;
  Object.defineProperty(f.namespace, 'validate', { ...Object.getOwnPropertyDescriptor(f.namespace, 'validate'), configurable: false });
  Object.defineProperty(f.namespace.Global.prototype, 'value', { ...Object.getOwnPropertyDescriptor(f.namespace.Global.prototype, 'value'), configurable: false });
  const foreign = function() {}; f.namespace.Module.prototype.constructor = foreign;
  const first = f.bind(), length = f.handles.length, second = f.bind();
  assert.ok(first.skipped.includes('WebAssembly.promising')); assert.ok(first.skipped.includes('WebAssembly.Tag.type'));
  assert.equal('promising' in f.namespace, false); assert.equal('type' in f.namespace.Tag.prototype, false);
  assert.equal(f.handles.length, length); assert.deepEqual(second.results, []);
  assert.equal(f.namespace.Module.prototype.constructor, foreign);
  assert.equal(f.handles.filter(handle => handle.status === 'unsupported' && handle.coverageFlag === 'descriptor-nonconfigurable').length, 2);
});

test('own Exception stack getter is observed without reading it during construction; setter and payload stay untouched', () => {
  const f = fixture({ ownStack: true }), value = new f.namespace.Exception(f.privateValue);
  assert.equal(f.stackReads(), 0); assert.equal(f.stackSets(), 0);
  const field = Object.getOwnPropertyDescriptor(value, 'stack');
  assert.equal(Object.hasOwn(field.get, 'prototype'), false);
  assert.throws(() => Reflect.construct(String, [], field.get), TypeError);
  assert.equal(value.stack, 'PRIVATE_STACK_CANARY'); assert.equal(f.stackReads(), 1);
  value.stack = f.privateValue; assert.equal(f.stackSets(), 1); assert.equal(f.values.get(value), f.privateValue);
  assert.equal(f.privateReads(), 0); assert.equal(f.previews.length, 0);
  assert.deepEqual(f.records.map(row => row.operation), ['WebAssembly.Exception', 'WebAssembly.Exception.stack']);
  assert.equal(JSON.stringify(f.records).includes('PRIVATE'), false);
  assert.throws(() => Reflect.apply(field.get, {}, []), error => error === f.failure);
});

test('own stack restore records are bounded while later Exception getters still count; eviction reports partial cleanup', () => {
  const f = fixture({ ownStack: true }), values = Array.from({ length: 140 }, () => new f.namespace.Exception());
  assert.equal(f.stackReads(), 0);
  for (const value of values) assert.equal(value.stack, 'PRIVATE_STACK_CANARY');
  assert.equal(f.records.filter(row => row.operation === 'WebAssembly.Exception.stack').length, 140);
  const aggregates = f.handles.filter(handle => handle.label === 'WebAssembly.Exception.stack.instances');
  assert.equal(aggregates.length, 1, 'one runtime handle, not a strong handle per result object');
  f.runtime.hooks.enabled = false;
  assert.equal(aggregates[0].restore(), false, 'evicted still-live wrappers need reload for physical removal');
  const before = f.records.length;
  for (const value of values) assert.equal(value.stack, 'PRIVATE_STACK_CANARY');
  assert.equal(f.records.length, before);
});

test('own stack cleanup preserves a page replacement and restores only its owned getter', () => {
  const f = fixture({ ownStack: true }), first = new f.namespace.Exception(), second = new f.namespace.Exception();
  const firstField = Object.getOwnPropertyDescriptor(first, 'stack'), secondField = Object.getOwnPropertyDescriptor(second, 'stack');
  const foreign = () => 'page'; Object.defineProperty(first, 'stack', { ...firstField, get: foreign });
  const aggregate = f.handles.find(handle => handle.label === 'WebAssembly.Exception.stack.instances');
  assert.equal(aggregate.restore(), false);
  assert.equal(Object.getOwnPropertyDescriptor(first, 'stack').get, foreign);
  assert.notEqual(Object.getOwnPropertyDescriptor(second, 'stack').get, secondField.get);
  assert.equal(Object.getOwnPropertyDescriptor(second, 'stack').set, secondField.set);
});

test('synchronization is deterministic, retains all prior operation indexes and rejects incompatible registries', () => {
  for (const name of WEBASSEMBLY_BUNDLES) {
    const before = readFileSync(new URL('../../apps/production-extension/' + name, import.meta.url), 'utf8');
    const result = synchronizeWebAssemblySource(before, name);
    assert.equal(synchronizeWebAssemblySource(result, name), result);
    const expression = text => text.slice(text.indexOf('var API_OPERATION_DEFINITIONS = ') + 32, text.indexOf(', API_OPERATIONS ='));
    if (!before.includes('var API_OPERATION_DEFINITIONS = ')) continue;
    const previous = vm.runInNewContext('(' + expression(before) + ')'), after = vm.runInNewContext('(' + expression(result) + ')');
    assert.deepEqual(JSON.parse(JSON.stringify(after.slice(0, previous.length))), JSON.parse(JSON.stringify(previous)));
    assert.ok(after.some(row => row[0] === 'WebAssembly.Global.value.set'));
  }
  assert.throws(() => synchronizeWebAssemblySource('var API_OPERATION_DEFINITIONS = [["WebAssembly.validate","DET-001","wasm","call"]], API_OPERATIONS = [];', 'bridge.js'), /incompatible/);
});
