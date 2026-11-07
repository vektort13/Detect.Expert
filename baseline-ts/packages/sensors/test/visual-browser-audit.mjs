// ADR-017/018: real native readback/return identity with automatic bounded capture and gated transport.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle = await build({ stdin: { contents: "export { SensorRuntime, browserEnv } from './packages/sensors/src/runtime'; export { installCanvasSensor } from './packages/sensors/src/canvas'; export { installGraphicsSensor } from './packages/sensors/src/webgl'; export { installVisualCapture } from './packages/sensors/src/visual'; export { startChildRealmManager } from './packages/sensors/src/child-realms'; export { validateVisualImage } from './packages/contracts/src/visual-preview';",
  resolveDir: process.cwd(), sourcefile: 'visual-native.ts', loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'VisualAudit', platform: 'browser', target: 'es2022', logLevel: 'silent' });
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const evidence = { measuredAt: new Date().toISOString(), chromium: browser.version(), cases: [] };
async function check(name, run) {
  const page = await browser.newPage();
  try {
    await page.goto('about:blank'); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await run(page); evidence.cases.push({ name, result }); console.log('PASS ' + name);
  } finally { await page.close(); }
}
try {
  await check('Canvas ImageData automatic early queue, native once, branded getters, exact bytes and ephemeral channel', async page => {
    const result = await page.evaluate(() => {
      const posted = []; const env = VisualAudit.browserEnv(window);
      const runtime = new VisualAudit.SensorRuntime({ ...env, postMessage: message => posted.push(message) });
      const prototype = CanvasRenderingContext2D.prototype;
      const original = Object.getOwnPropertyDescriptor(prototype, 'getImageData');
      let calls = 0; let actual; let hostileGets = 0;
      Object.defineProperty(prototype, 'getImageData', { ...original, value: new Proxy(original.value, { apply(target, receiver, args) {
        calls++; actual = Reflect.apply(target, receiver, args);
        for (const key of ['width', 'height', 'data']) Object.defineProperty(actual, key, { get() { hostileGets++; throw new Error('must use native brand getter'); } });
        return actual;
      } }) });
      const capture = VisualAudit.installVisualCapture(runtime, window);
      VisualAudit.installCanvasSensor(runtime, window);
      const noInstallReadback = calls === 0;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#804020'; ctx.fillRect(0, 0, 2, 2);
      const bytesGetter = Object.getOwnPropertyDescriptor(ImageData.prototype, 'data').get;
      const baseline = ctx.getImageData(0, 0, 2, 2);
      const expected = Array.from(Reflect.apply(bytesGetter, baseline, []));
      Reflect.apply(bytesGetter, baseline, []).fill(255); // Pending data must already be an independent bounded copy.
      const offHasNoImages = !posted.some(message => message.type === 'visual-image');
      dispatchEvent(new MessageEvent('message', { source: window, data: { channel: 'detect.expert/visual/v1', type: 'visual-config', sensorBootId: runtime.sensorBootId, enabled: true, remainingMs: 60_000 } }));
      const returned = ctx.getImageData(0, 0, 2, 2); const sameResult = returned === actual;
      const image = posted.find(message => message.type === 'visual-image')?.image;
      const imageMatches = image && Array.from(atob(image.data), character => character.charCodeAt(0)).every((byte, index) => byte === expected[index]);
      const view = Reflect.apply(bytesGetter, returned, []); view.fill(255);
      const copyIndependent = image && Array.from(atob(image.data), character => character.charCodeAt(0)).every((byte, index) => byte === expected[index]);
      let proxyGets = 0; capture.imageData(new Proxy({}, { get() { proxyGets++; throw new Error('hostile result'); } }));
      runtime.start(); dispatchEvent(new MessageEvent('message', { source: window, data: { channel: 'detect.expert/v1', sensorBootId: runtime.sensorBootId, type: 'bridge-hello', protocolVersion: 1, bridgeSessionId: 'visual-native', paused: false } }));
      runtime.flush();
      const metadata = JSON.stringify(posted.filter(message => message.channel !== 'detect.expert/visual/v1'));
      const noPreviewInMetadata = !metadata.includes(image.data) && !metadata.includes('"image"') && !metadata.includes('"width"');
      const cleanup = runtime.stop('local').cleanup;
      return { noInstallReadback, offHasNoImages, sameResult, imageMatches, copyIndependent, hostileGets, proxyGets, calls, noPreviewInMetadata,
        valid: VisualAudit.validateVisualImage(image).ok, source: image.source, width: image.width, height: image.height, encodedChars: image.data.length, cleanup };
    });
    for (const key of ['noInstallReadback', 'offHasNoImages', 'sameResult', 'imageMatches', 'copyIndependent', 'noPreviewInMetadata', 'valid']) assert.equal(result[key], true, key);
    assert.equal(result.hostileGets, 0); assert.equal(result.proxyGets, 0); assert.equal(result.calls, 2); assert.equal(result.cleanup, 'complete');
    assert.equal(result.source, 'getImageData'); return result;
  });

  await check('Canvas toDataURL original primitive PNG only, exact result, dimensions and no extra readbacks', async page => {
    const result = await page.evaluate(() => {
      const posted = []; const env = VisualAudit.browserEnv(window);
      const runtime = new VisualAudit.SensorRuntime({ ...env, postMessage: message => posted.push(message) });
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'toDataURL');
      let calls = 0; let actual;
      Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', { ...descriptor, value: new Proxy(descriptor.value, { apply(target, receiver, args) {
        calls++; actual = Reflect.apply(target, receiver, args); return actual;
      } }) });
      VisualAudit.installVisualCapture(runtime, window); VisualAudit.installCanvasSensor(runtime, window);
      const canvas = document.createElement('canvas'); canvas.width = 3; canvas.height = 2;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#123456'; ctx.fillRect(0, 0, 3, 2);
      dispatchEvent(new MessageEvent('message', { source: window, data: { channel: 'detect.expert/visual/v1', type: 'visual-config', sensorBootId: runtime.sensorBootId, enabled: true, remainingMs: 60_000 } }));
      canvas.toDataURL('image/jpeg'); const jpegSkipped = !posted.some(message => message.type === 'visual-image');
      const returned = canvas.toDataURL(); const sameResult = returned === actual;
      const image = posted.find(message => message.type === 'visual-image')?.image;
      canvas.toDataURL(); const imageCount = posted.filter(message => message.type === 'visual-image').length;
      runtime.stop('local');
      return { sameResult, jpegSkipped, calls, imageCount, exactPng: image.data === returned.slice(22), valid: VisualAudit.validateVisualImage(image).ok,
        source: image.source, width: image.width, height: image.height, encodedChars: image.data.length };
    });
    for (const key of ['sameResult', 'jpegSkipped', 'exactPng', 'valid']) assert.equal(result[key], true, key);
    assert.equal(result.calls, 3); assert.equal(result.imageCount, 1); assert.equal(result.width, 3); assert.equal(result.height, 2); return result;
  });

  for (const kind of ['webgl', 'webgl2']) await check(kind + ' readPixels exact destination bytes, native once and conservative pack exclusion', async page => {
    const result = await page.evaluate(kind => {
      const posted = []; const env = VisualAudit.browserEnv(window);
      const runtime = new VisualAudit.SensorRuntime({ ...env, postMessage: message => posted.push(message) });
      const prototype = kind === 'webgl' ? WebGLRenderingContext.prototype : WebGL2RenderingContext.prototype;
      const original = Object.getOwnPropertyDescriptor(prototype, 'readPixels');
      let calls = 0; let actual; let originalError; let errorCalls = 0;
      const getError = Object.getOwnPropertyDescriptor(prototype, 'getError');
      Object.defineProperty(prototype, 'getError', { ...getError, value: new Proxy(getError.value, { apply(target, receiver, args) { errorCalls++; return Reflect.apply(target, receiver, args); } }) });
      Object.defineProperty(prototype, 'readPixels', { ...original, value: new Proxy(original.value, { apply(target, receiver, args) {
        calls++; try { actual = Reflect.apply(target, receiver, args); return actual; } catch (error) { originalError = error; throw error; }
      } }) });
      VisualAudit.installVisualCapture(runtime, window); VisualAudit.installGraphicsSensor(runtime, window);
      const noInstallReadbacks = calls === 0 && errorCalls === 0;
      const gl = document.createElement('canvas').getContext(kind);
      if (!gl) return { unavailable: true };
      gl.clearColor(0.25, 0.5, 0.75, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      dispatchEvent(new MessageEvent('message', { source: window, data: { channel: 'detect.expert/visual/v1', type: 'visual-config', sensorBootId: runtime.sensorBootId, enabled: true, remainingMs: 60_000 } }));
      const excluded = document.createElement('canvas').getContext(kind);
      const excludedBytes = new Uint8Array(8);
      excluded.pixelStorei(excluded.PACK_ALIGNMENT, 8);
      excluded.readPixels(0, 0, 2, 1, excluded.RGBA, excluded.UNSIGNED_BYTE, excludedBytes);
      excluded.pixelStorei(excluded.PACK_ALIGNMENT, 4);
      excluded.readPixels(0, 0, 2, 1, excluded.RGBA, excluded.UNSIGNED_BYTE, excludedBytes);
      const excludedBeforeBudget = !posted.some(message => message.type === 'visual-image');
      const bytes = new Uint8Array(8); const expected = new Uint8Array(8);
      Reflect.apply(original.value, gl, [0, 0, 2, 1, gl.RGBA, gl.UNSIGNED_BYTE, expected]);
      const returned = gl.readPixels(0, 0, 2, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes); const sameResult = returned === actual;
      const image = posted.find(message => message.type === 'visual-image')?.image;
      const unchanged = bytes.every((byte, index) => byte === expected[index]);
      const matches = image && Array.from(atob(image.data), character => character.charCodeAt(0)).every((byte, index) => byte === expected[index]);
      let sameError = false; try { Reflect.apply(gl.readPixels, {}, []); } catch (error) { sameError = error === originalError; }
      const count = posted.filter(message => message.type === 'visual-image').length;
      const cleanup = runtime.stop('local').cleanup;
      return { unavailable: false, noInstallReadbacks, excludedBeforeBudget, sameResult, unchanged, matches, sameError, calls, errorCalls, count, cleanup,
        valid: VisualAudit.validateVisualImage(image).ok, width: image.width, height: image.height, source: image.source };
    }, kind);
    assert.equal(result.unavailable, false);
    for (const key of ['noInstallReadbacks', 'excludedBeforeBudget', 'sameResult', 'unchanged', 'matches', 'sameError', 'valid']) assert.equal(result[key], true, key);
    assert.equal(result.calls, 4); assert.equal(result.errorCalls, 0); assert.equal(result.count, 1); assert.equal(result.cleanup, 'complete'); return result;
  });

  await check('parent-captured native getters accept real sandbox child ImageData without child script evaluation', async page => {
    const result = await page.evaluate(async () => {
      const iframe = document.createElement('iframe'); iframe.sandbox = 'allow-same-origin';
      const loaded = new Promise(resolve => { iframe.onload = resolve; }); iframe.srcdoc = '<canvas width="2" height="1"></canvas>'; document.body.append(iframe); await loaded;
      const child = iframe.contentWindow; const posted = []; const env = VisualAudit.browserEnv(window);
      const runtime = new VisualAudit.SensorRuntime({ ...env, postMessage: message => posted.push(message) });
      VisualAudit.installVisualCapture(runtime, child); VisualAudit.installCanvasSensor(runtime, child);
      dispatchEvent(new MessageEvent('message', { source: window, data: { channel: 'detect.expert/visual/v1', type: 'visual-config', sensorBootId: runtime.sensorBootId, enabled: true, remainingMs: 60_000 } }));
      const ctx = child.document.querySelector('canvas').getContext('2d'); ctx.fillStyle = '#2468ac'; ctx.fillRect(0, 0, 2, 1);
      const value = ctx.getImageData(0, 0, 2, 1);
      const childBranded = value instanceof child.ImageData && !(value instanceof ImageData);
      const image = posted.find(message => message.type === 'visual-image')?.image;
      const equal = image && Array.from(atob(image.data), character => character.charCodeAt(0)).every((byte, index) => byte === value.data[index]);
      const cleanup = runtime.stop('local').cleanup;
      return { childBranded, equal, valid: VisualAudit.validateVisualImage(image).ok, cleanup };
    });
    assert.equal(result.childBranded, true); assert.equal(result.equal, true); assert.equal(result.valid, true); assert.equal(result.cleanup, 'complete'); return result;
  });

  for (const getterName of ['contentWindow', 'contentDocument']) await check('synchronous sandbox ' + getterName + ' captures cached-like first read before any await', async page => {
    const result = await page.evaluate(getterName => {
      const prototype = HTMLIFrameElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, getterName);
      const nativeWindow = Object.getOwnPropertyDescriptor(prototype, 'contentWindow').get;
      let getterCalls = 0; let originalResult; let originalError; let originalThis;
      const monitored = new Proxy(descriptor.get, { apply(target, receiver, args) {
        getterCalls++; originalThis = receiver;
        try { originalResult = Reflect.apply(target, receiver, args); return originalResult; } catch (error) { originalError = error; throw error; }
      } });
      Object.defineProperty(prototype, getterName, { ...descriptor, get: monitored });
      const parentRuntime = new VisualAudit.SensorRuntime(VisualAudit.browserEnv(window));
      if (getterName === 'contentDocument') parentRuntime.pause(); // Child lifecycle is independent of parent pause.
      const children = []; let readCalls = 0;
      const manager = VisualAudit.startChildRealmManager(parentRuntime, window, (runtime, realm) => {
        children.push(runtime);
        const proto = realm.CanvasRenderingContext2D.prototype;
        const read = Object.getOwnPropertyDescriptor(proto, 'getImageData');
        Object.defineProperty(proto, 'getImageData', { ...read, value: new Proxy(read.value, { apply(target, receiver, args) { readCalls++; return Reflect.apply(target, receiver, args); } }) });
        VisualAudit.installVisualCapture(runtime, realm); VisualAudit.installCanvasSensor(runtime, realm);
      });
      const iframe = document.createElement('iframe'); iframe.sandbox = 'allow-same-origin'; document.body.append(iframe);
      // Test-only isolated-transport stand-in is attached through a pre-captured native getter, before
      // the page's first wrapped getter. No script/eval/Function/timer is executed in the child.
      const child = Reflect.apply(nativeWindow, iframe, []); const posted = [];
      child.addEventListener('message', event => { if (event.source === child && event.data?.channel === 'detect.expert/visual/v1') posted.push(event.data); });
      const result = iframe[getterName]; const resultIdentity = result === originalResult; const receiverIdentity = originalThis === iframe;
      const childDocument = getterName === 'contentDocument' ? result : result.document;
      const canvas = childDocument.createElement('canvas'); canvas.width = 2; canvas.height = 1;
      const context = canvas.getContext('2d'); context.fillStyle = '#2468ac'; context.fillRect(0, 0, 2, 1);
      const pixels = context.getImageData(0, 0, 2, 1);
      const earlyCount = children[0]?.snapshot().counters.find(counter => counter.techniqueId === 'DET-002')?.count;
      const beforeConfig = posted.filter(message => message.type === 'visual-image').length;
      const config = enabled => child.dispatchEvent(new MessageEvent('message', { source: child, data: { channel: 'detect.expert/visual/v1', type: 'visual-config', sensorBootId: children[0].sensorBootId, enabled, remainingMs: enabled ? 60_000 : 0 } }));
      config(false); config(true);
      const image = posted.find(message => message.type === 'visual-image')?.image;
      const exactBytes = image && Array.from(atob(image.data), character => character.charCodeAt(0)).every((byte, index) => byte === pixels.data[index]);
      let sameError = false; try { Reflect.apply(Object.getOwnPropertyDescriptor(prototype, getterName).get, {}, []); } catch (error) { sameError = error === originalError; }
      const parentCounters = parentRuntime.snapshot().counters.length;
      parentRuntime.stop('local');
      return { resultIdentity, receiverIdentity, getterCalls, sameError, readCalls, earlyCount, beforeConfig, exactBytes, parentCounters,
        childCountAfterStop: manager.size, getterRestored: Object.getOwnPropertyDescriptor(prototype, getterName).get === monitored };
    }, getterName);
    for (const key of ['resultIdentity', 'receiverIdentity', 'sameError', 'exactBytes', 'getterRestored']) assert.equal(result[key], true, key);
    assert.equal(result.getterCalls, 2); assert.equal(result.readCalls, 1); assert.equal(result.earlyCount, 1); assert.equal(result.beforeConfig, 0);
    assert.equal(result.parentCounters, 0); assert.equal(result.childCountAfterStop, 0); return result;
  });

  await check('bounded dimensions, detached/shared/Proxy destinations and stop cannot expose data', async page => {
    const result = await page.evaluate(() => {
      const posted = []; const env = VisualAudit.browserEnv(window);
      const runtime = new VisualAudit.SensorRuntime({ ...env, postMessage: message => posted.push(message) });
      const capture = VisualAudit.installVisualCapture(runtime, window);
      dispatchEvent(new MessageEvent('message', { source: window, data: { channel: 'detect.expert/visual/v1', type: 'visual-config', sensorBootId: runtime.sensorBootId, enabled: true, remainingMs: 60_000 } }));
      let gets = 0;
      const hostile = new Proxy({}, { get() { gets++; throw new Error('no page getters'); } });
      capture.imageData(hostile);
      capture.imageData(new ImageData(513, 129));
      capture.imageData(new ImageData(1, 1, { colorSpace: 'display-p3' }));
      const args = (...values) => (function () { return arguments; })(...values);
      const options = { valueOf() { gets++; return 1; } };
      capture.readPixels({}, args(0, 0, options, 1, 0x1908, 0x1401, new Uint8Array(4)));
      capture.readPixels({}, args(0, 0, 1, 1, 0x1908, 0x1401, hostile));
      const detached = new Uint8Array(4); structuredClone(detached.buffer, { transfer: [detached.buffer] });
      capture.readPixels({}, args(0, 0, 1, 1, 0x1908, 0x1401, detached));
      const sharedAvailable = typeof SharedArrayBuffer === 'function';
      if (sharedAvailable) capture.readPixels({}, args(0, 0, 1, 1, 0x1908, 0x1401, new Uint8Array(new SharedArrayBuffer(4))));
      const beforeStop = posted.filter(message => message.type === 'visual-image').length;
      runtime.stop('revoked'); capture.imageData(new ImageData(1, 1));
      const afterStop = posted.filter(message => message.type === 'visual-image').length;
      return { gets, beforeStop, afterStop, sharedAvailable, rawInSnapshot: JSON.stringify(runtime.snapshot()).includes('"data"') };
    });
    assert.equal(result.gets, 0); assert.equal(result.beforeStop, 0); assert.equal(result.afterStop, 0); assert.equal(result.rawInSnapshot, false); return result;
  });
  writeFileSync('test-results/prod/reports/visual-native-acceptance.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log('Visual native acceptance: ' + evidence.cases.length + ' passed, Chromium ' + evidence.chromium);
} finally { await browser.close(); }
