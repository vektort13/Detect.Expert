// F047/F124/F127/F129/F133: real MAIN-realm regression checks; no extension permissions or external traffic.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['packages/sensors/src/index.ts'], bundle: true, format: 'iife',
  globalName: 'Sensors', write: false, platform: 'browser', target: 'es2022' });
const source = bundle.outputFiles[0].text;
const browser = await chromium.launch({ channel: 'chromium', headless: true });
let passed = 0;
async function check(name, run) {
  const page = await browser.newPage();
  try { await run(page); passed++; console.log('PASS ' + name); }
  finally { await page.close(); }
}
try {
  for (const key of ['setTimeout', 'addEventListener', 'readyState']) {
    await check('F129 preinstall ' + key, async (page) => {
      const result = await page.evaluate(({ key, source }) => {
        window.pageCalls = 0;
        const replacement = () => { window.pageCalls++; throw new Error('page replacement'); };
        if (key === 'readyState') Object.defineProperty(document, key, { configurable: true, get: replacement });
        else Object.defineProperty(window, key, { configurable: true, value: replacement });
        const script = document.createElement('script');
        script.textContent = source;
        document.documentElement.appendChild(script);
        let declined = false;
        try { Sensors.browserEnv(window); } catch { declined = true; }
        return { declined, calls: window.pageCalls };
      }, { key, source });
      assert.deepEqual(result, { declined: true, calls: 0 });
    });
  }
  await check('F133 captured MessageEvent getters and ownership cleanup', async (page) => {
    await page.addScriptTag({ content: source });
    const result = await page.evaluate(() => {
      const runtime = new Sensors.SensorRuntime(Sensors.browserEnv(window));
      const original = HTMLCanvasElement.prototype.toDataURL;
      Sensors.installCanvasSensor(runtime, window);
      runtime.start();
      let reads = 0;
      Object.defineProperty(MessageEvent.prototype, 'data', { configurable: true, get() { reads++; return null; } });
      Object.defineProperty(MessageEvent.prototype, 'source', { configurable: true, get() { reads++; return null; } });
      const base = { channel: 'detect.expert/v1', sensorBootId: runtime.sensorBootId };
      dispatchEvent(new MessageEvent('message', { source: window, data: { ...base, type: 'bridge-hello', protocolVersion: 1, bridgeSessionId: 'bridge-1', paused: false } }));
      const handshaken = runtime.snapshot().handshake;
      dispatchEvent(new MessageEvent('message', { source: window, data: { ...base, type: 'bridge-stop', reason: 'revoked' } }));
      return { reads, handshaken, enabled: runtime.hooks.enabled, restored: HTMLCanvasElement.prototype.toDataURL === original };
    });
    assert.deepEqual(result, { reads: 0, handshaken: true, enabled: false, restored: true });
  });
  await check('F047 synchronous incompatible hello race', async (page) => {
    await page.addScriptTag({ content: source });
    const result = await page.evaluate(async () => {
      const runtime = new Sensors.SensorRuntime(Sensors.browserEnv(window));
      addEventListener('message', (event) => {
        if (event.data?.type === 'sensor-hello') {
          dispatchEvent(new MessageEvent('message', { source: window, data: {
            channel: 'detect.expert/v1', sensorBootId: runtime.sensorBootId, type: 'bridge-hello',
            protocolVersion: 2, bridgeSessionId: 'forged', paused: false,
          } }));
          postMessage({ channel: 'detect.expert/v1', sensorBootId: runtime.sensorBootId, type: 'bridge-hello',
            protocolVersion: 1, bridgeSessionId: 'genuine', paused: false }, '*');
        }
      });
      runtime.start();
      runtime.record(1, 1, 1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { handshake: runtime.snapshot().handshake, enabled: runtime.hooks.enabled, seq: runtime.snapshot().sensorSeq };
    });
    assert.deepEqual(result, { handshake: true, enabled: true, seq: 1 });
  });
  for (const earlyCaptureGuaranteed of [false, true]) {
  await check('F124/F127 supplemental getters never run (claimed early capture=' + earlyCaptureGuaranteed + ')', async (page) => {
    await page.evaluate(() => {
      window.pageCalls = 0;
      Object.defineProperty(CanvasRenderingContext2D.prototype, 'canvas', { configurable: true, get() { window.pageCalls++; throw new Error('canvas getter'); } });
      Object.defineProperty(OffscreenCanvasRenderingContext2D.prototype, 'canvas', { configurable: true,
        get: new Proxy(Object.getOwnPropertyDescriptor(OffscreenCanvasRenderingContext2D.prototype, 'canvas').get,
          { apply() { window.pageCalls++; throw new Error('native-looking canvas getter'); } }) });
      Object.defineProperty(DOMException.prototype, 'name', { configurable: true,
        get: new Proxy(Object.getOwnPropertyDescriptor(DOMException.prototype, 'name').get,
          { apply() { window.pageCalls++; return 'SecurityError'; } }) });
    });
    await page.addScriptTag({ content: source });
    const result = await page.evaluate((earlyCaptureGuaranteed) => {
      // Claiming an early capture does not authenticate descriptors replaced before this module loaded.
      const runtime = new Sensors.SensorRuntime({ ...Sensors.browserEnv(window), startedLate: !earlyCaptureGuaranteed, earlyCaptureGuaranteed });
      Sensors.installCanvasSensor(runtime, window);
      let contextIdentity = true;
      for (const canvas of [document.createElement('canvas'), new OffscreenCanvas(10, 10)]) {
        const ctx = canvas.getContext('2d');
        contextIdentity &&= canvas.getContext('2d') === ctx;
        ctx.fillText('CANARY-F127-TEXT', 0, 0);
        ctx.getImageData(0, 0, 1, 1);
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillText('CANARY-F127-TEXT', 0, 0);
        if (canvas instanceof HTMLCanvasElement) canvas.toDataURL();
        try { ctx.getImageData(0, 0, 0, 0); } catch { /* Original IndexSizeError. */ }
      }
      return { calls: window.pageCalls, contextIdentity, snapshot: runtime.snapshot() };
    }, earlyCaptureGuaranteed);
    assert.equal(result.calls, 0);
    assert.equal(result.snapshot.observerErrors, 0);
    assert.equal(result.contextIdentity, true);
    assert.ok(!result.snapshot.flags.includes('hook-failed'));
    assert.ok(result.snapshot.counters.some((counter) => counter.phase === 'threw-sync'));
    assert.ok(result.snapshot.counters.some((counter) => counter.techniqueId === 'DET-001' && counter.signalCodes.includes('readback-after-text')));
    assert.ok(result.snapshot.counters.every((counter) => !counter.signalCodes.includes('tainted-canvas-attempt')));
    assert.ok(!JSON.stringify(result.snapshot).includes('CANARY-F127-TEXT'));
  });
  }
  await check('F127 native getContext differential: conversions, identity, exceptions and descriptors', async (page) => {
    await page.addScriptTag({ content: source });
    const result = await page.evaluate(() => {
      function facts() {
        return [document.createElement('canvas'), new OffscreenCanvas(10, 10)].map((canvas) => {
          let conversions = 0;
          let optionReads = 0;
          const kind = { toString() { conversions++; return '2d'; } };
          const options = { get alpha() { optionReads++; return true; } };
          const ctx = canvas.getContext(kind, options);
          const again = canvas.getContext('2d');
          let wrongReceiver;
          let construct;
          try { Reflect.apply(canvas.getContext, {}, ['2d']); } catch (error) { wrongReceiver = [error.name, error.message]; }
          try { Reflect.construct(canvas.getContext, ['2d']); } catch (error) { construct = [error.name, error.message]; }
          const method = canvas.getContext;
          const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(canvas), 'getContext');
          return { conversions, optionReads, same: ctx === again, owner: ctx.canvas === canvas,
            wrongReceiver, construct, functionName: method.name, functionLength: method.length,
            flags: [descriptor.configurable, descriptor.enumerable, descriptor.writable] };
        });
      }
      const before = facts();
      const runtime = new Sensors.SensorRuntime(Sensors.browserEnv(window));
      Sensors.installCanvasSensor(runtime, window);
      const after = facts();
      return { before, after, counters: runtime.snapshot().counters, observerErrors: runtime.snapshot().observerErrors };
    });
    // Reflect.construct rejects both nonconstructible functions before a call. Chromium includes their
    // detectable source text in that engine-created TypeError; masking it would violate REQ-003.
    for (const facts of [...result.before, ...result.after]) {
      assert.equal(facts.construct[0], 'TypeError');
      assert.ok(facts.construct[1].includes('is not a constructor'));
    }
    const callFacts = (facts) => ({ ...facts, construct: facts.construct[0] });
    assert.deepEqual(result.after.map(callFacts), result.before.map(callFacts));
    assert.deepEqual(result.before.map((facts) => [facts.conversions, facts.optionReads, facts.same, facts.owner]), [[1, 1, true, true], [1, 1, true, true]]);
    assert.deepEqual(result.counters, []);
    assert.equal(result.observerErrors, 0);
  });
  await check('F127 parent installs canvas hooks in a same-origin sandbox without enabling its scripts', async (page) => {
    await page.addScriptTag({ content: source });
    const result = await page.evaluate(() => {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-same-origin');
      document.body.appendChild(frame);
      const realm = frame.contentWindow;
      const canvas = realm.document.createElement('canvas');
      const runtime = new Sensors.SensorRuntime(Sensors.browserEnv(window));
      Sensors.installCanvasSensor(runtime, realm);
      const ctx = canvas.getContext('2d');
      ctx.fillText('sandbox label', 0, 0);
      ctx.getImageData(0, 0, 1, 1);
      canvas.toDataURL();
      canvas.width = 100;
      ctx.fillText('new sandbox label', 0, 0);
      canvas.toDataURL();
      return { sandbox: frame.getAttribute('sandbox'), same: canvas.getContext('2d') === ctx, snapshot: runtime.snapshot() };
    });
    assert.equal(result.sandbox, 'allow-same-origin');
    assert.equal(result.same, true);
    assert.equal(result.snapshot.observerErrors, 0);
    assert.equal(result.snapshot.counters.find((item) => item.techniqueId === 'DET-001' && item.signalCodes.includes('readback-after-text'))?.count, 2);
  });
  console.log(`${passed} browser sensor audit checks passed; Chromium ${browser.version()}`);
} finally { await browser.close(); }
