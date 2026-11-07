// DET-005..009 / ADR-006: native source-module acceptance; no extension build or production wiring.
// Only fixture-owned DOM/font values are compared, in-page. Artifacts contain facts and booleans.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { startFixtureServer } from '../../../tests/fixture-server.mjs';

const bundle = await build({ stdin: { contents: "export { SensorRuntime, browserEnv } from './packages/sensors/src/runtime'; export { installGeometrySensor } from './packages/sensors/src/geometry'; export { interpretReport } from './packages/engine/src/interpret'; export { projectReport } from './packages/engine/src/projection';",
  resolveDir: process.cwd(), sourcefile: 'geometry-browser-audit.ts', loader: 'ts' }, bundle: true, write: false,
  format: 'iife', globalName: 'GeometryAudit', platform: 'browser', target: 'es2022', logLevel: 'silent' });
const server = await startFixtureServer([4873]);
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const evidence = { measuredAt: new Date().toISOString(), chromium: browser.version(), cases: [] };
async function check(name, run, mode = 'positive') {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.addInitScript(() => { globalThis.__geometryFixtureAutostart = false; });
    await page.goto(server.origins[0] + '/geometry-' + mode + '.html');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await run(page);
    evidence.cases.push({ name, result }); console.log('PASS ' + name);
  } finally { await context.close(); }
}

try {
  await check('Element, HTMLElement, Range and SVG native differential, original once and brand', async (page) => {
    const result = await page.evaluate(() => {
      const element = document.getElementById('measured');
      const range = document.createRange(); range.selectNodeContents(element);
      const rect = document.getElementById('shape'); const text = document.getElementById('svg-text');
      const targets = [
        [Element.prototype, 'getClientRects', element], [Element.prototype, 'getBoundingClientRect', element],
        [HTMLElement.prototype, 'offsetWidth', element, 'get'], [HTMLElement.prototype, 'offsetHeight', element, 'get'],
        [Range.prototype, 'getClientRects', range], [Range.prototype, 'getBoundingClientRect', range],
        [SVGGraphicsElement.prototype, 'getBBox', rect], [SVGTextContentElement.prototype, 'getComputedTextLength', text],
        [SVGTextContentElement.prototype, 'getSubStringLength', text],
      ];
      const states = targets.map(([prototype, key, receiver, getter]) => {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
        const state = { prototype, key, receiver, getter, descriptor, calls: 0, value: undefined, error: undefined, lastThis: undefined, lastArgs: undefined };
        const field = getter ? 'get' : 'value';
        Object.defineProperty(prototype, key, { ...descriptor, [field]: new Proxy(descriptor[field], { apply(target, self, args) {
          state.calls++; state.lastThis = self; state.lastArgs = args;
          try { const value = Reflect.apply(target, self, args); state.value = value; return value; }
          catch (error) { state.error = error; throw error; }
        } }) });
        return state;
      });
      const query = () => {
        let coercions = 0; let dictionaryReads = 0;
        const values = []; const identity = []; const errors = []; const construct = []; const argumentsUnchanged = [];
        for (const state of states) {
          const fn = Object.getOwnPropertyDescriptor(state.prototype, state.key)[state.getter ? 'get' : 'value'];
          const args = state.key === 'getSubStringLength' ? [{ valueOf() { coercions++; return 0; } }, { valueOf() { coercions++; return 2; } }]
            : state.key === 'getBBox' ? [{ get fill() { dictionaryReads++; return true; } }] : [];
          const value = Reflect.apply(fn, state.receiver, args);
          identity.push(Object.is(value, state.value));
          argumentsUnchanged.push(state.lastThis === state.receiver && args.every((value, index) => value === state.lastArgs[index]));
          // Internal deterministic comparison of synthetic layout only, not sensor output.
          values.push(typeof value === 'number' ? value : state.key === 'getClientRects'
            ? Array.from(value, rect => [rect.x, rect.y, rect.width, rect.height]) : [value.x, value.y, value.width, value.height]);
          try { Reflect.apply(fn, {}, args); } catch (error) { errors.push([error.name, error.message, error === state.error]); }
          try { Reflect.construct(fn, []); } catch (error) { construct.push(error.name); }
        }
        const substring = states.at(-1);
        try { text.getSubStringLength(10000, 1); } catch (error) { errors.push([error.name, error.message, error === substring.error]); }
        return { values, identity, errors, construct, argumentsUnchanged, coercions, dictionaryReads };
      };
      const before = query(); const callsBefore = states.map(state => state.calls);
      const runtime = new GeometryAudit.SensorRuntime(GeometryAudit.browserEnv(window));
      GeometryAudit.installGeometrySensor(runtime, window);
      const noInstallMeasurements = states.every((state, index) => state.calls === callsBefore[index]);
      const after = query(); const snapshot = runtime.snapshot();
      const nativeCalls = states.map((state, index) => ({ name: state.key, calls: state.calls - callsBefore[index] }));
      const cleanup = runtime.stop('local').cleanup;
      return { noInstallMeasurements, differentialEqual: JSON.stringify(before) === JSON.stringify(after),
        resultIdentity: after.identity.every(Boolean), argumentsUnchanged: after.argumentsUnchanged.every(Boolean),
        errorIdentity: after.errors.every(error => error[2]), errors: after.errors.map(error => error[0]),
        nonconstructible: after.construct.every(value => value === 'TypeError') && after.construct.length === states.length,
        coercions: after.coercions, dictionaryReads: after.dictionaryReads, nativeCalls, counters: snapshot.counters, observerErrors: snapshot.observerErrors, cleanup };
    });
    for (const key of ['noInstallMeasurements', 'differentialEqual', 'resultIdentity', 'argumentsUnchanged', 'errorIdentity', 'nonconstructible']) assert.equal(result[key], true, key);
    assert.deepEqual(result.errors, [...Array(9).fill('TypeError'), 'IndexSizeError']);
    assert.equal(result.coercions, 2); assert.equal(result.observerErrors, 0); assert.equal(result.cleanup, 'complete');
    for (const call of result.nativeCalls) assert.equal(call.calls, call.name === 'getSubStringLength' ? 3 : 2, call.name);
    return result;
  });

  await check('FontFaceSet native iteration, callbacks, coercion, exceptions and untouched load Promise', async (page) => {
    const result = await page.evaluate(async () => {
      const marker = new FontFace('GEOMETRY-FONT-CANARY', 'local("Arial")');
      document.fonts.add(marker); // No load of this fixture-owned FontFace is requested.
      const keys = ['check', 'load', 'values', 'keys', 'entries', 'forEach', Symbol.iterator];
      const states = keys.map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(FontFaceSet.prototype, key);
        const state = { key, descriptor, calls: 0, value: undefined, error: undefined, promiseReads: 0 };
        Object.defineProperty(FontFaceSet.prototype, key, { ...descriptor, value: new Proxy(descriptor.value, { apply(target, receiver, args) {
          state.calls++;
          try {
            const result = Reflect.apply(target, receiver, args); state.value = result;
            if (key === 'load') Object.defineProperty(result, 'then', { configurable: true, get() { state.promiseReads++; return Promise.prototype.then; } });
            return result;
          } catch (error) { state.error = error; throw error; }
        } }) });
        return state;
      });
      const query = async () => {
        let conversions = 0; const identity = []; const errors = []; const iteration = []; const callbacks = [];
        const font = { toString() { conversions++; return '12px serif'; } };
        const testText = { toString() { conversions++; return 'FONT-TEXT-CANARY'; } };
        const check = document.fonts.check(font, testText); identity.push(check === states[0].value);
        const promise = document.fonts.load(font, testText); identity.push(promise === states[1].value);
        const promiseReadsBeforeAwait = states[1].promiseReads;
        await promise; // Page-owned await; wrapper must not await/chain it.
        for (const state of states.slice(2)) {
          const receiver = {};
          const value = state.key === 'forEach'
            ? document.fonts.forEach(function (font, sameFont, set) { callbacks.push(font === marker && sameFont === marker && set === document.fonts && this === receiver); }, receiver)
            : document.fonts[state.key]();
          identity.push(value === state.value);
          if (state.key !== 'forEach') {
            const first = value.next();
            iteration.push(first.done === false && (state.key === 'entries' ? first.value[0] === marker && first.value[1] === marker : first.value === marker) && value.next().done === true);
          }
        }
        for (const state of states.filter(state => state.key !== 'load')) {
          try { Reflect.apply(FontFaceSet.prototype[state.key], {}, ['12px serif']); }
          catch (error) { errors.push({ type: error.name, same: error === state.error }); }
        }
        return { conversions, identity, errors, iteration, callbacks, promiseReadsBeforeAwait };
      };
      const before = await query(); const callsBefore = states.map(state => state.calls);
      const runtime = new GeometryAudit.SensorRuntime(GeometryAudit.browserEnv(window));
      GeometryAudit.installGeometrySensor(runtime, window);
      const noInstallCalls = states.every((state, index) => state.calls === callsBefore[index]);
      const after = await query(); const snapshot = runtime.snapshot(); runtime.stop('local');
      return { noInstallCalls, differentialEqual: JSON.stringify(before) === JSON.stringify(after),
        resultIdentity: after.identity.every(Boolean), errorIdentity: after.errors.every(error => error.same),
        errors: after.errors.map(error => error.type), iteration: after.iteration, callbacks: after.callbacks,
        conversions: after.conversions, promiseReads: after.promiseReadsBeforeAwait,
        nativeCalls: states.map((state, index) => ({ name: typeof state.key === 'symbol' ? 'Symbol.iterator' : state.key, calls: state.calls - callsBefore[index] })),
        counters: snapshot.counters, observerErrors: snapshot.observerErrors };
    });
    for (const key of ['noInstallCalls', 'differentialEqual', 'resultIdentity', 'errorIdentity']) assert.equal(result[key], true, key);
    assert.deepEqual(result.errors, Array(6).fill('TypeError')); assert.deepEqual(result.iteration, Array(4).fill(true));
    assert.deepEqual(result.callbacks, [true]); assert.equal(result.promiseReads, 0); assert.equal(result.conversions, 4);
    assert.equal(result.observerErrors, 0);
    for (const call of result.nativeCalls) assert.equal(call.calls, call.name === 'load' ? 1 : 2, call.name);
    return result;
  });

  await check('queryLocalFonts denied request preserves native Promise without reading returned fonts', async (page) => {
    const cdp = await page.context().newCDPSession(page);
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    await cdp.send('Browser.setPermission', { permission: { name: 'local-fonts' }, setting: 'denied', origin: server.origins[0], browserContextId: targetInfo.browserContextId });
    const result = await page.evaluate(async () => {
      if (typeof queryLocalFonts !== 'function') return { available: false };
      const permission = (await navigator.permissions.query({ name: 'local-fonts' })).state;
      const descriptor = Object.getOwnPropertyDescriptor(window, 'queryLocalFonts');
      let baselineRejectedWith = null;
      try { await Reflect.apply(descriptor.value, window, []); } catch (error) { baselineRejectedWith = error.name; }
      let calls = 0; let reads = 0; let actual;
      Object.defineProperty(window, 'queryLocalFonts', { ...descriptor, value: new Proxy(descriptor.value, { apply(target, receiver, args) {
        calls++; const result = Reflect.apply(target, receiver, args); actual = result;
        Object.defineProperty(result, 'then', { configurable: true, get() { reads++; return Promise.prototype.then; } }); return result;
      } }) });
      const runtime = new GeometryAudit.SensorRuntime(GeometryAudit.browserEnv(window));
      GeometryAudit.installGeometrySensor(runtime, window);
      const noInstallCalls = calls === 0;
      const promise = queryLocalFonts(); const samePromise = promise === actual; const readsBeforeAwait = reads;
      let rejectedWith = null; try { await promise; } catch (error) { rejectedWith = error.name; }
      const snapshot = runtime.snapshot(); runtime.stop('local');
      return { available: true, permission, noInstallCalls, calls, samePromise, readsBeforeAwait, baselineRejectedWith, rejectedWith, counters: snapshot.counters };
    });
    assert.equal(result.available, true, 'Actual support required for this case; absence must be reported as unverified');
    assert.equal(result.permission, 'denied');
    assert.equal(result.noInstallCalls, true); assert.equal(result.calls, 1); assert.equal(result.samePromise, true); assert.equal(result.readsBeforeAwait, 0);
    // Conformance and hook transparency are separate: Chromium may resolve a denied request.
    // Compare its native outcome; never inspect any returned font list or assert it is empty.
    assert.equal(result.rejectedWith, result.baselineRejectedWith);
    assert.ok(result.counters.some(counter => counter.techniqueId === 'DET-009' && counter.phase === 'settlement-unobserved' && counter.count === 1));
    return result;
  });

  const rejectionResults = [];
  for (const wrapped of [false, true]) await check('FontFaceSet load unhandledrejection unchanged, wrapped=' + wrapped, async (page) => {
    const result = await page.evaluate(async (wrapped) => {
      const events = []; let rejected;
      addEventListener('unhandledrejection', event => { events.push({ same: event.promise === rejected, type: event.reason?.name }); event.preventDefault(); });
      if (wrapped) {
        const runtime = new GeometryAudit.SensorRuntime(GeometryAudit.browserEnv(window)); GeometryAudit.installGeometrySensor(runtime, window);
      }
      rejected = document.fonts.load('not a valid CSS font value');
      await new Promise(resolve => setTimeout(resolve, 100));
      rejected.catch(() => undefined); // Page handler is deliberately attached after observing the event.
      return events;
    }, wrapped);
    assert.deepEqual(result, [{ same: true, type: 'SyntaxError' }]); rejectionResults.push(result); return result;
  });
  assert.deepEqual(rejectionResults[0], rejectionResults[1]);

  for (const mode of ['positive', 'negative']) await check(mode + ' fixture has exact api-use counts, unassessed interpretation and private wire', async (page) => {
    const result = await page.evaluate(async () => {
      const posted = []; const environment = GeometryAudit.browserEnv(window);
      const runtime = new GeometryAudit.SensorRuntime({ ...environment, postMessage: message => posted.push(message) });
      GeometryAudit.installGeometrySensor(runtime, window); runtime.start();
      dispatchEvent(new MessageEvent('message', { source: window, data: { channel: 'detect.expert/v1', sensorBootId: runtime.sensorBootId,
        type: 'bridge-hello', protocolVersion: 1, bridgeSessionId: 'geometry-browser', paused: false } }));
      const fixture = await __runGeometryFixture(); runtime.flush();
      const counters = runtime.snapshot().counters;
      const rawReport = { schemaVersion: 1, documentKey: '1:0:geometry-fixture', tabId: 1, frameId: 0, documentId: 'geometry-fixture',
        host: null, lifecycle: 'committed', coverageState: 'active', coverageFlags: [], observedSince: 1000, revision: 1, createdAt: 1000, updatedAt: 1000,
        counters: counters.map(counter => ({ techniqueId: counter.techniqueId, phase: counter.phase, signalCodes: counter.signalCodes,
          count: counter.count, countQuality: counter.countQuality, firstBucket: 0, lastBucket: 0 })), hosts: [], findings: [],
        dropped: { batches: 0, observations: 0, counters: 0, findings: 0, hosts: 0, transport: 0 }, watermark: null };
      const interpreted = GeometryAudit.interpretReport(rawReport, { scopeMode: 'site', accessGranted: true, restricted: false, paused: false, inaccessibleFrames: 0 });
      const projection = GeometryAudit.projectReport(interpreted.report, { scopeMode: 'site' });
      return { fixture, counters, techniques: projection.techniques, findings: projection.findings, posted };
    });
    for (const [id, count] of Object.entries(result.fixture.expected)) assert.equal(result.counters.filter(counter => counter.techniqueId === id).reduce((sum, counter) => sum + counter.count, 0), count, id);
    assert.ok(result.techniques.every(technique => technique.interpretation === 'api-use' && technique.interpretationConfidence === 'unassessed'));
    assert.ok(result.findings.every(finding => finding.interpretation === 'api-use'));
    const wire = JSON.stringify(result.posted);
    for (const forbidden of ['CANARY', 'serif', 'Arial', 'DOMRect', '137', 'offsetWidth', 'width', 'height', 'FontFace']) assert.equal(wire.includes(forbidden), false, forbidden);
    return result;
  }, mode);
  writeFileSync('test-results/prod/reports/geometry-browser-acceptance.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log('Geometry native acceptance: ' + evidence.cases.length + ' passed, Chromium ' + evidence.chromium);
} finally { await browser.close(); await server.close(); }
