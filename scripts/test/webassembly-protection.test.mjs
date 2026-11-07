// ADR-059: semantic denial, independent accessors, native resources and ownership restoration.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import { WASM_SURFACES } from '../../packages/contracts/src/webassembly-apis.mjs';
import { syncWebAssemblyProtection } from '../production/sync-webassembly-protection.mjs';

const file = resolve(import.meta.dirname, '../../apps/production-extension/protection-runtime.js');
const source = readFileSync(file, 'utf8').replace('export function installProtection(', 'function installProtection(');
function fixture(withoutWeakRef = false) {
  const context = createContext({ DOMException });
  if (withoutWeakRef) runInContext('delete globalThis.WeakRef;', context);
  runInContext(source + '\nglobalThis.install = installProtection;', context);
  return { context, realm: runInContext('globalThis', context), evaluate: code => runInContext(code, context) };
}
const blocked = fn => assert.throws(fn, error => error.name === 'SecurityError');

test('canonical cases are deterministic and exactly synchronized', () => {
  assert.equal(new Set(WASM_SURFACES.map(row => row.feature)).size, WASM_SURFACES.length);
  assert.equal(new Set(WASM_SURFACES.map(row => row.operation)).size, WASM_SURFACES.length);
  assert.deepEqual(syncWebAssemblyProtection({ check: true }), { surfaces: 37 });
});

test('namespace async denial rejects before byte/options coercion and restores original Promise function', async () => {
  const f = fixture(), original = f.realm.WebAssembly.compile;
  const installation = f.realm.install(f.realm, 'webassembly-compile');
  let reads = 0; const bytes = new Proxy({}, { get() { reads++; throw new Error('must not inspect'); } });
  await assert.rejects(f.realm.WebAssembly.compile(bytes), error => error.name === 'SecurityError');
  assert.equal(reads, 0); assert.equal(installation.snapshot().blocked, 1);
  const retained = f.realm.WebAssembly.compile;
  installation.stop(); assert.equal(f.realm.WebAssembly.compile, original);
  assert.ok(await retained(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])));
  assert.throws(() => new retained(), error => error.name === 'TypeError');
});

test('constructor and its exact native prototype alias deny without evaluating the descriptor', () => {
  const f = fixture(), original = f.realm.WebAssembly.Memory;
  const installation = f.realm.install(f.realm, 'webassembly-memory');
  let reads = 0; const descriptor = { get initial() { reads++; return 1; } };
  const blockedConstructor = f.realm.WebAssembly.Memory;
  assert.equal(blockedConstructor.prototype.constructor, blockedConstructor);
  blocked(() => new blockedConstructor(descriptor)); blocked(() => new blockedConstructor.prototype.constructor(descriptor));
  assert.equal(reads, 0); installation.stop(); assert.equal(f.realm.WebAssembly.Memory, original);
  assert.equal(original.prototype.constructor, original);
  const memory = new blockedConstructor({ initial: 1 }); assert.equal(memory.buffer.byteLength, 65536);
  class Derived extends blockedConstructor {}
  const derived = new Derived({ initial: 1 }); assert.equal(Object.getPrototypeOf(derived), Derived.prototype);
  assert.throws(() => blockedConstructor({ initial: 1 }), error => error.name === 'TypeError');
});

test('method denial preserves native non-constructibility and other methods', () => {
  const f = fixture(); f.evaluate('globalThis.table = new WebAssembly.Table({element:"externref",initial:1}); table.set(0,42);');
  const installation = f.realm.install(f.realm, 'webassembly-table-get');
  blocked(() => f.evaluate('table.get(0)')); assert.equal(f.evaluate('table.length'), 1);
  assert.throws(() => f.evaluate('new WebAssembly.Table.prototype.get()'), error => error.name === 'TypeError');
  const retained = f.realm.WebAssembly.Table.prototype.get; installation.stop();
  assert.equal(Reflect.apply(retained, f.realm.table, [0]), 42);
});

test('Global getter and setter decisions remain independent across either stop order', () => {
  for (const order of ['get-first', 'set-first']) {
    const f = fixture(); f.evaluate('globalThis.value = new WebAssembly.Global({value:"i32",mutable:true},5);');
    const getter = f.realm.install(f.realm, 'webassembly-global-value');
    const setter = f.realm.install(f.realm, 'webassembly-global-value-set');
    blocked(() => f.evaluate('value.value')); blocked(() => f.evaluate('value.value=7'));
    const descriptor = Object.getOwnPropertyDescriptor(f.realm.WebAssembly.Global.prototype, 'value');
    for (const fn of [descriptor.get, descriptor.set]) assert.throws(() => Reflect.construct(fn, []), error => error.name === 'TypeError');
    if (order === 'get-first') {
      getter.stop(); assert.equal(f.evaluate('value.value'), 5); blocked(() => f.evaluate('value.value=7')); setter.stop();
    } else {
      setter.stop(); f.evaluate('value.value=7'); blocked(() => f.evaluate('value.value')); getter.stop();
    }
    f.evaluate('value.value=9'); assert.equal(f.evaluate('value.value'), 9);
  }
});

test('page-owned replacement survives stop and absent APIs are never created', () => {
  const f = fixture(), installation = f.realm.install(f.realm, 'webassembly-memory');
  const replacement = function PageMemory() {}; f.realm.WebAssembly.Memory = replacement; installation.stop();
  assert.equal(f.realm.WebAssembly.Memory, replacement);
  f.evaluate('delete WebAssembly.Tag.prototype.type');
  const missing = f.realm.install(f.realm, 'webassembly-tag-type'); assert.equal(missing.snapshot().installed, 0);
  assert.equal(missing.snapshot().unavailable, 1); assert.equal(Object.hasOwn(f.realm.WebAssembly.Tag.prototype, 'type'), false);
  const noWasm = { ...f.realm, WebAssembly: undefined }; const absent = f.realm.install(noWasm, 'webassembly-table');
  assert.equal(absent.snapshot().installed, 0); assert.equal(noWasm.WebAssembly, undefined);
});

test('normal own Exception.stack is denied across the weak cleanup ring without inspecting stack contents', () => {
  const f = fixture();
  // Node and browser V8 expose stack differently. Model the actual Chrome/Firefox
  // accessor descriptors here; the packaged native harness covers their engines.
  f.evaluate(`globalThis.stackReads = 0;
    WebAssembly.Exception = class AccessorException {
      constructor() { Object.defineProperty(this,'stack',{ configurable:true,
        get() { stackReads++; return 'fixture-stack'; }, set(value) {} }); }
      get stack() { stackReads++; return 'fixture-prototype-stack'; }
    };`);
  const installation = f.realm.install(f.realm, 'webassembly-exception-stack');
  f.evaluate('globalThis.tag = new WebAssembly.Tag({parameters:[]}); globalThis.exceptions = []; for(let i=0;i<140;i++) exceptions.push(new WebAssembly.Exception(tag,[],{traceStack:true}));');
  assert.equal(f.realm.WebAssembly.Exception.prototype.constructor, f.realm.WebAssembly.Exception);
  for (let index = 0; index < 140; index++) blocked(() => f.realm.exceptions[index].stack);
  assert.equal(f.realm.stackReads, 0);
  const object = f.realm.exceptions[139], before = Object.getOwnPropertyDescriptor(object, 'stack');
  const replacement = () => 'page-owned'; Object.defineProperty(object, 'stack', { ...before, get: replacement });
  installation.stop(); assert.equal(Object.getOwnPropertyDescriptor(object, 'stack').get, replacement);
  // The evicted object's retained getter forwards to native after stop too.
  assert.equal(typeof f.realm.exceptions[0].stack, 'string');
  assert.equal(f.realm.stackReads, 1);
});

test('missing WeakRef does not prevent unrelated Guard rules from installing', async () => {
  const f = fixture(true), installation = f.realm.install(f.realm, 'webassembly-compile');
  assert.equal(installation.snapshot().installed, 1);
  await assert.rejects(f.realm.WebAssembly.compile(new Uint8Array()), error => error.name === 'SecurityError');
  installation.stop();
});
