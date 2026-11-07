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
  await check('F124/F127 late supplemental getters never run', async (page) => {
    await page.evaluate(() => {
      window.pageCalls = 0;
      Object.defineProperty(CanvasRenderingContext2D.prototype, 'canvas', { configurable: true, get() { window.pageCalls++; throw new Error('canvas getter'); } });
      Object.defineProperty(DOMException.prototype, 'name', { configurable: true, get() { window.pageCalls++; return 'SecurityError'; } });
    });
    await page.addScriptTag({ content: source });
    const result = await page.evaluate(() => {
      const runtime = new Sensors.SensorRuntime(Sensors.browserEnv(window));
      Sensors.installCanvasSensor(runtime, window);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.fillText('label', 0, 0);
      ctx.getImageData(0, 0, 1, 1);
      try { ctx.getImageData(0, 0, 0, 0); } catch { /* Original IndexSizeError. */ }
      return { calls: window.pageCalls, snapshot: runtime.snapshot() };
    });
    assert.equal(result.calls, 0);
    assert.equal(result.snapshot.observerErrors, 0);
    assert.ok(result.snapshot.flags.includes('hook-failed'));
    assert.ok(result.snapshot.counters.some((counter) => counter.phase === 'threw-sync'));
  });
  console.log(`${passed} browser sensor audit checks passed; Chromium ${browser.version()}`);
} finally { await browser.close(); }
