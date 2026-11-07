// Local native semantics proof only. No remote resources or observed bytes/values are exported.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { WASM_SURFACES, WASM_OPERATION_DEFINITIONS } from '../../packages/contracts/src/webassembly-apis.mjs';
import { createWebAssemblyObserverSupport } from '../production/webassembly-runtime.mjs';

export async function nativeWebAssemblyObserverProof(createSupport, wrappers, surfaces, definitions) {
  const namespace = WebAssembly, checks = [], counts = Object.create(null), previews = [], limitations = [];
  const privateValue = new Proxy({}, { get() { throw Error('Private object read by observer'); }, ownKeys() { throw Error('Private object enumerated by observer'); } });
  const code = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,5,1,1,102,0,0,10,6,1,4,0,65,42,11]);
  const nativeCompile = namespace.compile, nativeModule = namespace.Module, nativeMemory = namespace.Memory;
  const originalGlobal = Object.getOwnPropertyDescriptor(namespace.Global.prototype, 'value');
  let compileCalls = 0, nativePromise, thenReads = 0;
  // Test-only tap holds the exact native Promise so identity and absence of handlers are observable.
  namespace.compile = { compile() {
    compileCalls++; nativePromise = Reflect.apply(nativeCompile, this, arguments);
    Object.defineProperty(nativePromise, 'then', { configurable: true, get() { thenReads++; throw Error('Observer touched a foreign Promise'); } });
    return nativePromise;
  } }.compile;
  const runtime = { hooks: { enabled: true, observerErrors: 0 }, handles: [], flags: [],
    attach(handles) { this.handles.push(...handles); }, addFlag(flag) { this.flags.push(flag); },
    recordOperation(index, phase) { const key = definitions[index][0] + ':' + phase; counts[key] = (counts[key] ?? 0) + 1; },
    recordResult(operation) { previews.push(operation); }
  };
  const registry = { operationIndex: Object.fromEntries(definitions.map(([name], index) => [name, index])), phaseIndex: { 'returned-sync': 1, 'threw-sync': 2, 'settlement-unobserved': 4 } };
  const installation = createSupport(registry, surfaces).install(runtime, globalThis, wrappers);
  const check = (name, actual) => { if (!actual) throw Error(name); checks.push(name); };
  check('compile original once and exact Promise identity, no .then access', namespace.compile(code) === nativePromise && compileCalls === 1 && thenReads === 0);
  delete nativePromise.then; const compiled = await nativePromise;
  check('validate return and Module native brand', namespace.validate(code) === true && compiled instanceof namespace.Module && compiled instanceof nativeModule);
  const module = new namespace.Module(code), instance = new namespace.Instance(module);
  check('module statics and prototype constructor alias', namespace.Module.prototype.constructor === namespace.Module && namespace.Module.imports(module).length === 0 && namespace.Module.exports(module)[0].name === 'f' && namespace.Module.customSections(module, 'private-fixture').length === 0);
  check('Instance exports keep exact native Wasm function and execute normally', instance.exports === instance.exports && instance.exports.f() === 42 && Function.prototype.toString.call(instance.exports.f).includes('[native code]'));
  const instantiated = await namespace.instantiate(code);
  check('instantiate native Promise settlement remains functional', instantiated.instance.exports.f() === 42);
  for (const name of ['compileStreaming', 'instantiateStreaming']) if (typeof namespace[name] === 'function') {
    const result = await namespace[name](new Response(code, { headers: { 'Content-Type': 'application/wasm' } }));
    check(name + ' consumes only the native Response stream', name === 'compileStreaming' ? result instanceof namespace.Module : result.instance.exports.f() === 42);
  }
  const memory = new namespace.Memory({ initial: 1, maximum: 3 });
  check('Memory buffer identity and grow result', memory.buffer === memory.buffer && memory.grow(0) === 1 && memory instanceof nativeMemory);
  class ChildMemory extends namespace.Memory {}
  check('native constructor subclassing', Object.getPrototypeOf(new ChildMemory({ initial: 1 })) === ChildMemory.prototype);
  let coercions = 0; check('grow native numeric coercion exactly once', memory.grow({ valueOf() { coercions++; return 0; } }) === 1 && coercions === 1);
  for (const name of ['toFixedLengthBuffer', 'toResizableBuffer']) if (typeof memory[name] === 'function') {
    const value = memory[name](); check(name + ' returns native buffer', value === memory.buffer && value.byteLength === 65536);
  }
  const table = new namespace.Table({ element: 'externref', initial: 1, maximum: 3 });
  table.set(0, privateValue);
  check('Table opaque externref identity, length and grow', table.get(0) === privateValue && table.length === 1 && table.grow(1) === 1 && table.length === 2);
  const global = new namespace.Global({ value: 'externref', mutable: true }, privateValue);
  check('Global opaque externref getter and valueOf identity', global.value === privateValue && global.valueOf() === privateValue);
  global.value = privateValue; check('Global setter returns original value unchanged', global.value === privateValue);
  const field = Object.getOwnPropertyDescriptor(namespace.Global.prototype, 'value');
  check('Global native accessor prototypes preserved', Object.getPrototypeOf(field.get) === Object.getPrototypeOf(originalGlobal.get) && Object.getPrototypeOf(field.set) === Object.getPrototypeOf(originalGlobal.set));
  for (const [name, fn] of [['Global getter', field.get], ['Global setter', field.set], ['Table.get', namespace.Table.prototype.get]]) {
    let invalid = false, construction = false;
    try { Reflect.apply(fn, {}, []); } catch (error) { invalid = error instanceof TypeError; }
    try { Reflect.construct(String, [], fn); } catch (error) { construction = error instanceof TypeError; }
    check(name + ' native receiver and non-constructibility', invalid && construction && !Object.hasOwn(fn, 'prototype'));
  }
  let sentinelCalls = 0; const sentinel = new Error('NATIVE_SENTINEL');
  try { memory.grow({ valueOf() { sentinelCalls++; throw sentinel; } }); check('unreachable throw', false); }
  catch (error) { check('native exception identity and one coercion', error === sentinel && sentinelCalls === 1); }
  if (typeof namespace.Tag === 'function' && typeof namespace.Exception === 'function') {
    const tag = new namespace.Tag({ parameters: ['externref'] }), exception = new namespace.Exception(tag, [privateValue], { traceStack: true });
    check('Tag/Exception native branding and opaque payload identity', exception.is(tag) && exception.getArg(tag, 0) === privateValue && exception instanceof namespace.Exception);
    const stack = Object.getOwnPropertyDescriptor(namespace.Exception.prototype, 'stack');
    if (typeof stack?.get === 'function') {
      const ownStack = Object.getOwnPropertyDescriptor(exception, 'stack');
      const value = Reflect.apply(stack.get, exception, []);
      check('Exception prototype stack getter remains native; contents unrecorded', typeof value === 'string' || value === undefined);
      if (ownStack) {
        const before = counts['WebAssembly.Exception.stack:1'] ?? 0;
        const ownValue = exception.stack;
        check('normal own Exception stack getter counts without recording stack contents', (typeof ownValue === 'string' || ownValue === undefined) && counts['WebAssembly.Exception.stack:1'] === before + 1);
      }
    }
    if (typeof tag.type === 'function') { tag.type(); check('optional native Tag.type only when present', true); }
  }
  for (const name of ['CompileError', 'LinkError', 'RuntimeError', 'SuspendError']) if (typeof namespace[name] === 'function') {
    check(name + ' native Error subclass', new namespace[name]('local fixture') instanceof Error);
  }
  if (typeof namespace.Suspending === 'function') check('JSPI Suspending constructor remains native', new namespace.Suspending(() => Promise.resolve(7)) instanceof namespace.Suspending);
  if (typeof namespace.promising === 'function') {
    const promised = namespace.promising(instance.exports.f);
    check('JSPI promising returns a callable native function and expected Promise', typeof promised === 'function' && await promised() === 42);
  }
  check('new operation results never enter previews', previews.every(name => definitions.slice(0, 10).some(([operation]) => operation === name)));
  check('observer had no errors', runtime.hooks.observerErrors === 0 && runtime.flags.length === 0);
  const covered = surfaces.filter(row => counts[row.operation + ':1'] || counts[row.operation + ':4']).map(row => row.operation);
  const nativeAbsent = installation.skipped;
  const iterations = 200000;
  // The same Reflect.apply baseline isolates wrapper + bounded counter cost; no threshold tuning.
  let boundedCount = 0;
  runtime.recordOperation = () => { boundedCount = boundedCount === 2147483647 ? boundedCount : boundedCount + 1; };
  const currentGet = Object.getOwnPropertyDescriptor(namespace.Global.prototype, 'value').get;
  const measure = fn => { const start = performance.now(); for (let index = 0; index < iterations; index++) Reflect.apply(fn, global, []); return (performance.now() - start) * 1000000 / iterations; };
  for (let i = 0; i < 20000; i++) { Reflect.apply(originalGlobal.get, global, []); Reflect.apply(currentGet, global, []); }
  const timing = { iterations, units: 'ns/op', scope: 'native Global getter versus wrapper with saturated fixture counter; not full SW/bridge cost', samples: [] };
  for (let round = 0; round < 5; round++) timing.samples.push({ native: measure(originalGlobal.get), observed: measure(currentGet) });
  const oldCount = boundedCount;
  runtime.hooks.enabled = false; check('pause preserves native value and suppresses all counters', global.value === privateValue && boundedCount === oldCount);
  for (const handle of [...runtime.handles].reverse()) handle.restore();
  check('ownership restoration returns original namespace constructor and alias', namespace.Module === nativeModule && namespace.Module.prototype.constructor === nativeModule);
  limitations.push('Wasm-internally created/thrown exceptions and previously saved native entry points are not intercepted; no exported native Wasm function is wrapped.');
  return { checks, covered, nativeAbsent, limitations, thenReads, observerErrors: runtime.hooks.observerErrors, timing };
}

async function main() {
  const root = resolve(import.meta.dirname, '../..'), installed = process.argv.includes('--installed-chrome');
  const outputIndex = process.argv.indexOf('--output');
  const output = resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : join(root, 'test-results/production-1.1.0/webassembly-observer-' + (installed ? 'chrome155' : 'chromium153') + '.json'));
  const hook = readFileSync(join(root, 'apps/production-extension/hook.main.js'), 'utf8');
  const from = hook.indexOf('// packages/sensors/src/wrap.ts'), to = hook.indexOf('// packages/sensors/src/intrinsics.ts', from);
  assert.ok(from >= 0 && to > from);
  const supportSource = readFileSync(join(root, 'scripts/production/webassembly-runtime.mjs'));
  const evidence = { at: new Date().toISOString(), scope: 'local native API semantics; exact production wrapper section and canonical observer helper, not extension delivery/worker coverage',
    hashes: { hook: createHash('sha256').update(hook).digest('hex'), helper: createHash('sha256').update(supportSource).digest('hex') }, checks: [], result: 'RUNNING' };
  const browser = await chromium.launch({ channel: installed ? 'chrome' : 'chromium', headless: true });
  try {
    evidence.browser = browser.version(); const page = await browser.newPage();
    await page.addScriptTag({ content: hook.slice(from, to) + '\nglobalThis.wasmTestWrappers = { wrapConstructor, wrapGetter, wrapSetter, wrapOutcomeMethod, wrapResultMethod };' });
    const source = '(' + nativeWebAssemblyObserverProof.toString() + ')((' + createWebAssemblyObserverSupport.toString() + '), wasmTestWrappers, ' + JSON.stringify(WASM_SURFACES) + ', ' + JSON.stringify(WASM_OPERATION_DEFINITIONS) + ')';
    const proof = await page.evaluate(source);
    Object.assign(evidence, proof); evidence.result = 'PASS';
    const required = WASM_SURFACES.filter(row => !proof.nativeAbsent.includes(row.operation)).map(row => row.operation);
    assert.deepEqual([...proof.covered].sort(), [...required].sort());
  } catch (error) { evidence.result = 'FAIL'; evidence.error = error.message; throw error; }
  finally { await browser.close(); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n'); }
  console.log(JSON.stringify({ result: evidence.result, browser: evidence.browser, checks: evidence.checks.length, covered: evidence.covered.length, absent: evidence.nativeAbsent, output }));
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();
