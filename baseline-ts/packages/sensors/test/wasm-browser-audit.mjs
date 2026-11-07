// DET-065 native source-module gate. Every module, Response and worker belongs to this fixture.
// The observer does not instantiate, inspect bytes/imports/exports, or handle returned Promises.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const built = await build({ stdin: { contents: "export { SensorRuntime, browserEnv } from './packages/sensors/src/runtime'; export { installWebAssemblySensor } from './packages/sensors/src/wasm';",
  resolveDir: process.cwd(), sourcefile: 'wasm-native-audit.ts', loader: 'ts' }, bundle: true, write: false,
  format: 'iife', globalName: 'WasmAudit', platform: 'browser', target: 'es2022', logLevel: 'silent' });
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const evidence = { measuredAt: new Date().toISOString(), browser: browser.version(), extensionLoaded: false,
  modulesCreatedBy: 'synthetic test page only', observerHandlesPromises: false, workersInstrumented: false,
  internalWasmExecutionObserved: false, moduleBytesOrImportsSaved: false, complete: false, cases: [] };
async function check(name, run) {
  const page = await browser.newPage();
  try {
    await page.goto('about:blank'); await page.addScriptTag({ content: built.outputFiles[0].text });
    const result = await run(page); evidence.cases.push({ name, result }); console.log('PASS ' + name);
  } finally { await page.close(); }
}
try {
  await check('all native JS methods: once, receiver/arguments, Promise identity, no then reads, input conversion', async page => {
    const result = await page.evaluate(async () => {
      const bytes = new Uint8Array([0,97,115,109,1,0,0,0]), apply = Reflect.apply, nativeThen = Promise.prototype.then;
      const states = {}, names = ['compile', 'instantiate', 'compileStreaming', 'instantiateStreaming', 'validate'];
      const nativeModule = new WebAssembly.Module(bytes);
      for (const name of names) {
        const d = Object.getOwnPropertyDescriptor(WebAssembly, name);
        const state = states[name] = { calls: 0, thenReads: 0, actual: null, receiver: null, args: null };
        Object.defineProperty(WebAssembly, name, { ...d, value: new Proxy(d.value, { apply(target, receiver, args) {
          state.calls++; state.receiver = receiver; state.args = args;
          const output = apply(target, receiver, args); state.actual = output;
          if (name !== 'validate') Object.defineProperty(output, 'then', { configurable: true, get() { state.thenReads++; return nativeThen; } });
          return output;
        } }) });
      }
      const runtime = new WasmAudit.SensorRuntime(WasmAudit.browserEnv(window)); WasmAudit.installWebAssemblySensor(runtime, window);
      const noInstallCalls = names.every(name => states[name].calls === 0);
      const outputs = [], rows = [];
      const response = () => new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } });
      const cases = [['compile', [bytes]], ['instantiate', [bytes, {}]], ['instantiate', [nativeModule, {}]],
        ['compileStreaming', [response()]], ['instantiateStreaming', [Promise.resolve(response()), {}]], ['validate', [bytes]], ['validate', [new Uint8Array([1])]]];
      for (const [name, args] of cases) {
        const receiver = {}, value = apply(WebAssembly[name], receiver, args), state = states[name];
        rows.push({ name, identity: value === state.actual, sameReceiver: state.receiver === receiver,
          sameArguments: args.length === state.args.length && args.every((arg, i) => arg === state.args[i]), thenReadsBeforeFixture: state.thenReads });
        if (name !== 'validate') outputs.push(new Promise((resolve, reject) => apply(nativeThen, value, [resolve, reject])));
      }
      const completed = await Promise.all(outputs);
      const nativeOutputs = completed[0] instanceof WebAssembly.Module && completed[1].module instanceof WebAssembly.Module &&
        completed[1].instance instanceof WebAssembly.Instance && completed[2] instanceof WebAssembly.Instance &&
        completed[3] instanceof WebAssembly.Module && completed[4].instance instanceof WebAssembly.Instance;
      const counters = runtime.snapshot().counters; runtime.stop('local');
      return { noInstallCalls, rows, nativeOutputs, counters, calls: Object.fromEntries(names.map(name => [name, states[name].calls])), thenReads: names.reduce((n, name) => n + states[name].thenReads, 0) };
    });
    assert.equal(result.noInstallCalls, true); assert.equal(result.nativeOutputs, true); assert.equal(result.thenReads, 0);
    for (const row of result.rows) { assert.equal(row.identity, true); assert.equal(row.sameReceiver, true); assert.equal(row.sameArguments, true); assert.equal(row.thenReadsBeforeFixture, 0); }
    assert.deepEqual(result.calls, { compile: 1, instantiate: 2, compileStreaming: 1, instantiateStreaming: 1, validate: 2 });
    assert.deepEqual(result.counters.map(c => [c.phase, c.count]), [['settlement-unobserved', 5], ['returned-sync', 2]]);
    return result;
  });

  await check('native Module/Instance: once, exact result/error, static identity, subclass and hostile newTarget', async page => {
    const result = await page.evaluate(() => {
      const bytes = new Uint8Array([0,97,115,109,1,0,0,0]), baselineModule = new WebAssembly.Module(bytes);
      const native = { Module: WebAssembly.Module, Instance: WebAssembly.Instance }, states = {};
      for (const name of ['Module', 'Instance']) {
        const d = Object.getOwnPropertyDescriptor(WebAssembly, name), state = states[name] = { constructs: 0, calls: 0, result: null, error: null };
        const monitor = new Proxy(d.value, {
          construct(target, args, newTarget) { state.constructs++; try { return state.result = Reflect.construct(target, args, newTarget === monitor ? target : newTarget); } catch (error) { state.error = error; throw error; } },
          apply(target, receiver, args) { state.calls++; try { return state.result = Reflect.apply(target, receiver, args); } catch (error) { state.error = error; throw error; } },
        });
        Object.defineProperty(WebAssembly, name, { ...d, value: monitor });
      }
      const runtime = new WasmAudit.SensorRuntime(WasmAudit.browserEnv(window)); WasmAudit.installWebAssemblySensor(runtime, window);
      const noInstallCalls = ['Module', 'Instance'].every(name => states[name].constructs === 0 && states[name].calls === 0), rows = [];
      for (const name of ['Module', 'Instance']) {
        const Original = native[name], Wrapped = WebAssembly[name], input = name === 'Module' ? bytes : baselineModule, state = states[name];
        const value = new Wrapped(input), sameResult = value === state.result;
        class Subclass extends Wrapped {} const child = new Subclass(input);
        let plainIdentity = false, invalidIdentity = false;
        try { Wrapped(input); } catch (error) { plainIdentity = error === state.error && error instanceof TypeError; }
        try { new Wrapped(null); } catch (error) { invalidIdentity = error === state.error && error instanceof TypeError; }
        const target = Constructor => {
          let reads = 0; const expected = Object.create(Original.prototype);
          const newTarget = new Proxy(function () {}, { get(object, key, receiver) { if (key === 'prototype') { if (++reads > 1) throw new Error('extra newTarget read'); return expected; } return Reflect.get(object, key, receiver); } });
          return { correct: Object.getPrototypeOf(Reflect.construct(Constructor, [input], newTarget)) === expected, reads };
        };
        const before = target(Original), after = target(Wrapped);
        rows.push({ name, sameResult, nativeInstance: value instanceof Original && value instanceof Wrapped, subclass: child instanceof Subclass && child instanceof Original,
          prototypeSame: Wrapped.prototype === Original.prototype, constructorIdentityKnownGap: value.constructor === Original && value.constructor !== Wrapped,
          plainIdentity, invalidIdentity, before, after, constructs: state.constructs, calls: state.calls,
          staticsUnchanged: name !== 'Module' || Wrapped.exports === Original.exports && Wrapped.imports === Original.imports && Wrapped.customSections === Original.customSections });
      }
      runtime.stop('local'); return { noInstallCalls, rows };
    });
    assert.equal(result.noInstallCalls, true);
    for (const row of result.rows) {
      for (const key of ['sameResult', 'nativeInstance', 'subclass', 'prototypeSame', 'constructorIdentityKnownGap', 'plainIdentity', 'invalidIdentity', 'staticsUnchanged']) assert.equal(row[key], true);
      assert.deepEqual(row.before, { correct: true, reads: 1 }); assert.deepEqual(row.after, row.before); assert.equal(row.constructs, 4); assert.equal(row.calls, 1);
    }
    return result;
  });

  await check('imports/start callbacks execute once; native sync failures retain identity and false validate is API use', async page => {
    const result = await page.evaluate(() => {
      const bytes = new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,2,13,1,3,101,110,118,5,115,116,97,114,116,0,0,8,1,0]);
      const module = new WebAssembly.Module(bytes), runtime = new WasmAudit.SensorRuntime(WasmAudit.browserEnv(window)); WasmAudit.installWebAssemblySensor(runtime, window);
      let envReads = 0, startReads = 0, startCalls = 0, failedReads = 0, sameError = false;
      const imports = { get env() { envReads++; return { get start() { startReads++; return () => { startCalls++; }; } }; } };
      const instance = new WebAssembly.Instance(module, imports), failure = new Error('CANARY_IMPORT_FAILURE');
      try { new WebAssembly.Instance(module, { get env() { failedReads++; throw failure; } }); } catch (error) { sameError = error === failure; }
      const validationFalse = WebAssembly.validate(new Uint8Array([1])) === false;
      const snapshot = runtime.snapshot(); runtime.stop('local');
      return { nativeInstance: instance instanceof WebAssembly.Instance, envReads, startReads, startCalls, failedReads, sameError, validationFalse,
        counters: snapshot.counters, noCanary: !JSON.stringify(snapshot).includes('CANARY') };
    });
    for (const key of ['nativeInstance', 'sameError', 'validationFalse', 'noCanary']) assert.equal(result[key], true);
    for (const key of ['envReads', 'startReads', 'startCalls', 'failedReads']) assert.equal(result[key], 1);
    assert.deepEqual(result.counters.map(c => [c.phase, c.count]), [['returned-sync', 2], ['threw-sync', 1]]); return result;
  });

  for (const wrapped of [false, true]) await check('native rejected Promise/unhandledrejection identity ' + (wrapped ? 'wrapped' : 'baseline'), async page => {
    const result = await page.evaluate(async wrapped => {
      const runtime = wrapped ? new WasmAudit.SensorRuntime(WasmAudit.browserEnv(window)) : null;
      if (runtime) WasmAudit.installWebAssemblySensor(runtime, window);
      const events = []; let rejected;
      addEventListener('unhandledrejection', event => { events.push({ samePromise: event.promise === rejected, name: event.reason.name }); event.preventDefault(); });
      rejected = WebAssembly.compile(new Uint8Array([1]));
      await new Promise(resolve => setTimeout(resolve, 150));
      const counters = runtime?.snapshot().counters ?? []; runtime?.stop('local'); return { events, counters };
    }, wrapped);
    assert.deepEqual(result.events, [{ samePromise: true, name: 'CompileError' }]);
    if (wrapped) assert.deepEqual(result.counters.map(c => [c.phase, c.count]), [['settlement-unobserved', 1]]);
    return result;
  });

  await check('native streaming failure and thenable input conversion are neither swallowed nor duplicated', async page => {
    const result = await page.evaluate(async () => {
      const bytes = new Uint8Array([0,97,115,109,1,0,0,0]), native = WebAssembly.compileStreaming;
      const run = async method => {
        let thenReads = 0, thenCalls = 0;
        const input = { get then() { thenReads++; return resolve => { thenCalls++; resolve(new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } })); }; } };
        const module = await Reflect.apply(method, WebAssembly, [input]);
        let rejected = false; try { await Reflect.apply(method, WebAssembly, [new Response(bytes)]); } catch (error) { rejected = error instanceof TypeError; }
        return { thenReads, thenCalls, nativeModule: module instanceof WebAssembly.Module, rejected };
      };
      const before = await run(native), runtime = new WasmAudit.SensorRuntime(WasmAudit.browserEnv(window)); WasmAudit.installWebAssemblySensor(runtime, window);
      const after = await run(WebAssembly.compileStreaming), counters = runtime.snapshot().counters; runtime.stop('local'); return { before, after, counters };
    });
    assert.deepEqual(result.after, result.before); assert.deepEqual(result.after, { thenReads: 1, thenCalls: 1, nativeModule: true, rejected: true });
    assert.deepEqual(result.counters.map(c => [c.phase, c.count]), [['settlement-unobserved', 2]]); return result;
  });

  await check('worker-only use is not attributed to the page; exported core execution adds no JS entry-point counts', async page => {
    const result = await page.evaluate(async () => {
      const runtime = new WasmAudit.SensorRuntime(WasmAudit.browserEnv(window)); WasmAudit.installWebAssemblySensor(runtime, window);
      const source = `onmessage = async () => { const bytes = new Uint8Array([0,97,115,109,1,0,0,0]); const module = await WebAssembly.compile(bytes); const instance = new WebAssembly.Instance(module); postMessage(instance instanceof WebAssembly.Instance); };`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })), worker = new Worker(url);
      const workerResult = await new Promise((resolve, reject) => { worker.onmessage = event => resolve(event.data); worker.onerror = reject; worker.postMessage(null); });
      worker.terminate(); URL.revokeObjectURL(url);
      const workerCallsSeenInPage = runtime.snapshot().counters.length;
      // (module (func (export "run") (result i32) i32.const 42)) — fixture-owned calculation only.
      const bytes = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,7,1,3,114,117,110,0,0,10,6,1,4,0,65,42,11]);
      const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
      const before = runtime.snapshot().counters.reduce((n, item) => n + item.count, 0);
      let sameResult = true; for (let i = 0; i < 100; i++) sameResult &&= instance.exports.run() === 42;
      const after = runtime.snapshot().counters.reduce((n, item) => n + item.count, 0);
      runtime.stop('local'); return { workerResult, workerCallsSeenInPage, before, after, sameResult };
    });
    assert.equal(result.workerResult, true); assert.equal(result.workerCallsSeenInPage, 0);
    assert.equal(result.before, 2); assert.equal(result.after, 2); assert.equal(result.sameResult, true); return result;
  });

  await check('pause and ownership cleanup preserve native behavior and foreign replacements', async page => {
    const result = await page.evaluate(() => {
      const bytes = new Uint8Array([0,97,115,109,1,0,0,0]), original = WebAssembly.validate;
      const runtime = new WasmAudit.SensorRuntime(WasmAudit.browserEnv(window)); WasmAudit.installWebAssemblySensor(runtime, window); WasmAudit.installWebAssemblySensor(runtime, window);
      WebAssembly.validate(bytes); runtime.pause(); const pausedResult = WebAssembly.validate(bytes); runtime.resume(); WebAssembly.validate(bytes);
      const foreign = () => null; WebAssembly.compile = foreign; const counters = runtime.snapshot().counters;
      runtime.stop('local'); return { pausedResult, counters, validateRestored: WebAssembly.validate === original, foreignPreserved: WebAssembly.compile === foreign };
    });
    assert.equal(result.pausedResult, true); assert.equal(result.validateRestored, true); assert.equal(result.foreignPreserved, true);
    assert.deepEqual(result.counters.map(c => [c.phase, c.count]), [['returned-sync', 2]]); return result;
  });

  await check('native validate raw wrapper microbenchmark', async page => {
    const result = await page.evaluate(() => {
      const bytes = new Uint8Array([0,97,115,109,1,0,0,0]), native = WebAssembly.validate, now = performance.now.bind(performance);
      const env = WasmAudit.browserEnv(window), runtime = new WasmAudit.SensorRuntime({ ...env, setTimeout: () => 0, clearTimeout() {}, postMessage() {} });
      WasmAudit.installWebAssemblySensor(runtime, window); const wrapped = WebAssembly.validate;
      const iterations = 30000, pairs = []; let output = false;
      const measure = fn => { const start = now(); for (let i = 0; i < iterations; i++) output = fn(bytes); return (now() - start) * 1000000 / iterations; };
      for (let i = 0; i < 2000; i++) { native(bytes); wrapped(bytes); }
      for (let i = 0; i < 5; i++) { let nativeNs, wrappedNs; if (i % 2 === 0) { nativeNs = measure(native); wrappedNs = measure(wrapped); } else { wrappedNs = measure(wrapped); nativeNs = measure(native); } pairs.push({ nativeNs, wrappedNs }); }
      runtime.stop('local'); return { iterations, warmup: 2000, trials: 5, pairs, outputValid: output === true };
    });
    assert.equal(result.outputValid, true); const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)];
    result.nativeMedianNs = median(result.pairs.map(pair => pair.nativeNs)); result.wrappedMedianNs = median(result.pairs.map(pair => pair.wrappedNs));
    result.deltaNs = result.wrappedMedianNs - result.nativeMedianNs;
    result.limitation = 'Source-module microbenchmark only; real validate native work, captured measurement clock, no transport timers; not a global performance gate';
    return result;
  });
  evidence.complete = true;
} finally {
  mkdirSync('test-results/prod/reports', { recursive: true });
  writeFileSync('test-results/prod/reports/2026-09-13-wasm-native-acceptance.json', JSON.stringify(evidence, null, 2) + '\n');
  await browser.close();
}
