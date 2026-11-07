// DET-011/012/013 / ADR-006: real native API acceptance for the unconnected graphics module.
// No extension build or product wiring. Test code may inspect its own synthetic results; sensor may not.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { startFixtureServer } from '../../../tests/fixture-server.mjs';

const bundled = await build({ stdin: { contents: "export { SensorRuntime, browserEnv } from './packages/sensors/src/runtime'; export { installGraphicsSensor } from './packages/sensors/src/webgl'; export { interpretReport } from './packages/engine/src/interpret'; export { projectReport } from './packages/engine/src/projection';",
  resolveDir: process.cwd(), sourcefile: 'graphics-browser-audit.ts', loader: 'ts' }, bundle: true, write: false,
  format: 'iife', globalName: 'GraphicsAudit', platform: 'browser', target: 'es2022', logLevel: 'silent' });
const server = await startFixtureServer([4873]);
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const evidence = { measuredAt: new Date().toISOString(), chromium: browser.version(), forcedGpuFlags: false, cases: [] };
const pageFor = async (fixture = 'graphics-positive.html') => {
  const page = await browser.newPage();
  await page.addInitScript(() => { globalThis.__graphicsFixtureAutostart = false; });
  await page.goto(server.origins[0] + '/' + fixture);
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  return page;
};
async function check(name, run) {
  const page = await pageFor();
  try { const result = await run(page); evidence.cases.push({ name, result }); console.log('PASS ' + name); }
  finally { await page.close(); }
}
try {
  for (const kind of ['webgl', 'webgl2']) await check(kind + ' native differential, original once, bytes, coercion and brand', async (page) => {
    const result = await page.evaluate((kind) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
      const gl = canvas.getContext(kind);
      if (!gl) return { unavailable: true };
      const prototype = Object.getPrototypeOf(gl);
      const names = ['getParameter', 'getExtension', 'getSupportedExtensions', 'getShaderPrecisionFormat', 'readPixels'];
      const originals = Object.fromEntries(names.map((name) => [name, Object.getOwnPropertyDescriptor(prototype, name)]));
      const calls = {};
      let originalResult;
      let originalError;
      // Test-only native call monitor: every proxy apply invokes the actual browser method exactly once.
      for (const name of names) Object.defineProperty(prototype, name, { ...originals[name], value: new Proxy(originals[name].value, {
        apply(target, receiver, args) {
          calls[name] = (calls[name] ?? 0) + 1;
          try { const result = Reflect.apply(target, receiver, args); originalResult = result; return result; }
          catch (error) { originalError = error; throw error; }
        },
      }) });
      const query = () => {
        const pixels = new Uint8Array(4);
        let conversions = 0;
        const parameter = { valueOf() { conversions++; return gl.MAX_TEXTURE_SIZE; } };
        const extension = { toString() { conversions++; return 'WEBGL_debug_renderer_info'; } };
        const values = [];
        const identity = [];
        for (const [name, args] of [
          ['getParameter', [parameter]], ['getExtension', [extension]], ['getSupportedExtensions', []],
          ['getShaderPrecisionFormat', [gl.FRAGMENT_SHADER, gl.HIGH_FLOAT]],
        ]) {
          const result = Reflect.apply(gl[name], gl, args);
          identity.push(result === originalResult);
          // Fixture-owned comparison only; no capability value is returned to Node/artifacts.
          values.push(result === null ? null : typeof result === 'object' ? Object.prototype.toString.call(result) : typeof result);
        }
        gl.clearColor(0.25, 0.5, 0.75, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        const read = gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        identity.push(read === originalResult);
        const errors = [];
        for (const name of names) {
          try { Reflect.apply(gl[name], {}, []); } catch (error) { errors.push([name, error.name, error.message, error === originalError]); }
        }
        let construct;
        try { Reflect.construct(gl.getParameter, []); } catch (error) { construct = error.name; }
        return { pixels: Array.from(pixels), conversions, identity, values, errors, construct, nativeError: gl.getError() };
      };
      const before = query();
      const callsBefore = { ...calls };
      const runtime = new GraphicsAudit.SensorRuntime(GraphicsAudit.browserEnv(window));
      const installed = GraphicsAudit.installGraphicsSensor(runtime, window);
      const after = query();
      const callDelta = Object.fromEntries(names.map((name) => [name, calls[name] - callsBefore[name]]));
      let offsetBytesUnchanged = null;
      let bufferOffsetBytesUnchanged = null;
      if (kind === 'webgl2') {
        const nativePixels = new Uint8Array(8); const hookedPixels = new Uint8Array(8);
        Reflect.apply(originals.readPixels.value, gl, [0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, nativePixels, 4]);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, hookedPixels, 4);
        offsetBytesUnchanged = nativePixels.every((value, index) => value === hookedPixels[index]);
        const buffer = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, 8, gl.STREAM_READ);
        Reflect.apply(originals.readPixels.value, gl, [0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 4]);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, nativePixels);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, 8, gl.STREAM_READ);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 4);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, hookedPixels);
        bufferOffsetBytesUnchanged = nativePixels.every((value, index) => value === hookedPixels[index]);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.deleteBuffer(buffer);
      }
      const snapshot = runtime.snapshot();
      const stopped = runtime.stop('local');
      return { unavailable: false, differentialEqual: JSON.stringify(before) === JSON.stringify(after), bytesUnchanged: before.pixels.every((value, index) => value === after.pixels[index]),
        conversions: after.conversions, resultIdentity: after.identity.every(Boolean), errorsIdentity: after.errors.every((entry) => entry[3]),
        invalidThisCount: after.errors.length, construct: after.construct, callDelta, offsetBytesUnchanged, bufferOffsetBytesUnchanged,
        installed: installed.results.filter((entry) => entry.status === 'installed').length, counters: snapshot.counters,
        observerErrors: snapshot.observerErrors, cleanup: stopped.cleanup };
    }, kind);
    assert.equal(result.unavailable, false, 'native ' + kind + ' required for this acceptance run');
    assert.equal(result.differentialEqual, true); assert.equal(result.bytesUnchanged, true);
    assert.equal(result.conversions, 2); assert.equal(result.resultIdentity, true); assert.equal(result.errorsIdentity, true);
    assert.equal(result.invalidThisCount, 5); assert.equal(result.construct, 'TypeError');
    assert.ok(Object.values(result.callDelta).every((count) => count === 2));
    if (kind === 'webgl2') { assert.equal(result.offsetBytesUnchanged, true); assert.equal(result.bufferOffsetBytesUnchanged, true); }
    assert.equal(result.observerErrors, 0); assert.equal(result.cleanup, 'complete');
    return result;
  });

  await check('WebGPU native Promise identity, getter identity/brand and no injected handlers', async (page) => {
    const result = await page.evaluate(async () => {
      if (!navigator.gpu || typeof GPU === 'undefined') return { available: false };
      const original = GPU.prototype.requestAdapter;
      let calls = 0; let actualPromise; let thenReads = 0;
      const getterCalls = {}; let getterResult; let getterError;
      for (const name of ['info', 'features', 'limits']) {
        const descriptor = Object.getOwnPropertyDescriptor(GPUAdapter.prototype, name);
        if (!descriptor?.get) continue;
        Object.defineProperty(GPUAdapter.prototype, name, { ...descriptor, get: new Proxy(descriptor.get, {
          apply(target, receiver, args) {
            getterCalls[name] = (getterCalls[name] ?? 0) + 1;
            try { const result = Reflect.apply(target, receiver, args); getterResult = result; return result; }
            catch (error) { getterError = error; throw error; }
          },
        }) });
      }
      Object.defineProperty(GPU.prototype, 'requestAdapter', { ...Object.getOwnPropertyDescriptor(GPU.prototype, 'requestAdapter'), value: new Proxy(original, {
        apply(target, receiver, args) {
          calls++;
          const result = Reflect.apply(target, receiver, args);
          actualPromise = result;
          Object.defineProperty(result, 'then', { configurable: true, get() { thenReads++; return Promise.prototype.then; } });
          return result;
        },
      }) });
      const runtime = new GraphicsAudit.SensorRuntime(GraphicsAudit.browserEnv(window));
      GraphicsAudit.installGraphicsSensor(runtime, window);
      const promise = navigator.gpu.requestAdapter();
      const samePromise = promise === actualPromise;
      const readsBeforePageAwait = thenReads;
      const adapter = await promise;
      const getterFacts = [];
      for (const name of ['info', 'features', 'limits']) {
        const getter = Object.getOwnPropertyDescriptor(GPUAdapter.prototype, name)?.get;
        if (!getter) { getterFacts.push({ name, available: false }); continue; }
        let invalidThis; let errorIdentity = false;
        try { Reflect.apply(getter, {}, []); } catch (error) { invalidThis = error.name; errorIdentity = error === getterError; }
        let sameObject = null; let resultIdentity = null;
        if (adapter) { const first = adapter[name]; resultIdentity = first === getterResult; sameObject = first === adapter[name]; }
        getterFacts.push({ name, available: true, sameObject, resultIdentity, invalidThis, errorIdentity, originalCalls: getterCalls[name] });
      }
      return { available: true, adapterReturned: adapter !== null, samePromise, readsBeforePageAwait, calls, getterFacts,
        counters: runtime.snapshot().counters, observerErrors: runtime.snapshot().observerErrors };
    });
    assert.equal(result.available, true, 'WebGPU interface required; do not enable GPU feature flags to hide an absence');
    assert.equal(result.calls, 1); assert.equal(result.samePromise, true); assert.equal(result.readsBeforePageAwait, 0);
    assert.equal(result.observerErrors, 0);
    for (const fact of result.getterFacts.filter((fact) => fact.available)) {
      assert.equal(fact.invalidThis, 'TypeError');
      assert.equal(fact.errorIdentity, true);
      assert.equal(fact.originalCalls, result.adapterReturned ? 3 : 1);
      if (result.adapterReturned) { assert.equal(fact.sameObject, true); assert.equal(fact.resultIdentity, true); }
    }
    return result;
  });

  const rejection = [];
  for (const wrapped of [false, true]) await check('WebGPU unhandledrejection unchanged, wrapped=' + wrapped, async (page) => {
    const result = await page.evaluate(async (wrapped) => {
      const unhandled = []; let rejected;
      addEventListener('unhandledrejection', (event) => { unhandled.push({ same: event.promise === rejected, type: event.reason?.name }); event.preventDefault(); });
      if (wrapped) {
        const runtime = new GraphicsAudit.SensorRuntime(GraphicsAudit.browserEnv(window));
        GraphicsAudit.installGraphicsSensor(runtime, window);
      }
      rejected = Reflect.apply(GPU.prototype.requestAdapter, {}, []);
      await new Promise((resolve) => setTimeout(resolve, 100));
      rejected.catch(() => undefined); // The fixture attaches its own late handler only after measuring the event.
      return unhandled;
    }, wrapped);
    assert.deepEqual(result, [{ same: true, type: 'TypeError' }]); rejection.push(result); return result;
  });
  assert.deepEqual(rejection[0], rejection[1]);

  for (const mode of ['positive', 'negative']) await check(mode + ' fixture emits exact api-use only and no private wire values', async (page) => {
    if (mode === 'negative') { await page.goto(server.origins[0] + '/graphics-negative.html'); await page.addScriptTag({ content: bundled.outputFiles[0].text }); }
    const result = await page.evaluate(async () => {
      const posted = [];
      const environment = GraphicsAudit.browserEnv(window);
      const runtime = new GraphicsAudit.SensorRuntime({ ...environment, postMessage: (message) => posted.push(message) });
      GraphicsAudit.installGraphicsSensor(runtime, window); runtime.start();
      dispatchEvent(new MessageEvent('message', { source: window, data: { channel: 'detect.expert/v1', sensorBootId: runtime.sensorBootId,
        type: 'bridge-hello', protocolVersion: 1, bridgeSessionId: 'graphics-browser', paused: false } }));
      const fixture = await __runGraphicsFixture();
      runtime.flush();
      const counters = runtime.snapshot().counters;
      const rawReport = { schemaVersion: 1, documentKey: '1:0:graphics-fixture', tabId: 1, frameId: 0, documentId: 'graphics-fixture',
        host: null, lifecycle: 'committed', coverageState: 'active', coverageFlags: [], observedSince: 1000, revision: 1, createdAt: 1000, updatedAt: 1000,
        counters: counters.map((counter) => ({ techniqueId: counter.techniqueId, phase: counter.phase, signalCodes: counter.signalCodes,
          count: counter.count, countQuality: counter.countQuality, firstBucket: 0, lastBucket: 0 })), hosts: [], findings: [],
        dropped: { batches: 0, observations: 0, counters: 0, findings: 0, hosts: 0, transport: 0 }, watermark: null };
      const interpreted = GraphicsAudit.interpretReport(rawReport, { scopeMode: 'site', accessGranted: true, restricted: false, paused: false, inaccessibleFrames: 0 });
      const projection = GraphicsAudit.projectReport(interpreted.report, { scopeMode: 'site' });
      return { fixture, counters, techniques: projection.techniques, findings: projection.findings, posted };
    });
    for (const [id, expected] of Object.entries(result.fixture.expected)) assert.equal(result.counters.filter((counter) => counter.techniqueId === id).reduce((sum, counter) => sum + counter.count, 0), expected);
    assert.ok(result.techniques.every((technique) => technique.interpretation === 'api-use' && technique.interpretationConfidence === 'unassessed'));
    assert.ok(result.findings.every((finding) => finding.interpretation === 'api-use'));
    const wire = JSON.stringify(result.posted);
    for (const forbidden of ['WEBGL_debug_renderer_info', 'MAX_TEXTURE_SIZE', 'vendor', 'architecture', 'pixels', 'powerPreference']) assert.equal(wire.includes(forbidden), false);
    return result;
  });
  writeFileSync('test-results/prod/reports/graphics-browser-acceptance.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log('Graphics native acceptance: ' + evidence.cases.length + ' passed, Chromium ' + evidence.chromium);
} finally { await browser.close(); await server.close(); }
