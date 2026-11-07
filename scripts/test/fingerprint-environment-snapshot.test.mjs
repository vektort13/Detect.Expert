// ADR-107 (b, c): the memory-only snapshot of THIS browser (memory, GPU, WebGPU adapter, proxy state) and the explicit window fit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { createFingerprintProfilesController, readWebGl, readWebGpu, readProxyState, GPU_CAPS, GPU_TEXT_MAX } from '../../apps/production-extension/fingerprint-profiles-controller.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// WebGL constants as browsers number them; the fake records every method that is called on the context and on its extensions.
const GL = { MAX_TEXTURE_SIZE: 0x0D33, MAX_VIEWPORT_DIMS: 0x0D3A, MAX_RENDERBUFFER_SIZE: 0x84E8, MAX_SAMPLES: 0x8D57, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D, MAX_VERTEX_UNIFORM_VECTORS: 0x8DFB };
const DEBUG = { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 };
function fakeGl({ webgl2 = true, values = {}, debug = true, throwing = [] } = {}) {
  const calls = [], lost = [];
  const answers = { [DEBUG.UNMASKED_VENDOR_WEBGL]: 'Google Inc. (NVIDIA)', [DEBUG.UNMASKED_RENDERER_WEBGL]: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)', [GL.MAX_TEXTURE_SIZE]: 16384, [GL.MAX_VIEWPORT_DIMS]: new Int32Array([32767, 32767]), [GL.MAX_RENDERBUFFER_SIZE]: 16384, [GL.MAX_SAMPLES]: 16, [GL.MAX_COMBINED_TEXTURE_IMAGE_UNITS]: 32, [GL.MAX_VERTEX_UNIFORM_VECTORS]: 4096, ...values };
  const constants = webgl2 ? GL : Object.fromEntries(Object.entries(GL).filter(([key]) => key !== 'MAX_SAMPLES'));
  const extensions = { WEBGL_debug_renderer_info: debug ? { ...DEBUG } : null, WEBGL_lose_context: { loseContext: () => { lost.push(1); calls.push('loseContext'); } } };
  const target = { ...constants, getExtension: name => extensions[name] ?? null, getParameter: name => { if (throwing.includes(name)) throw new Error('lost'); return answers[name] ?? null; } };
  const gl = new Proxy(target, { get(object, key) { const value = object[key]; if (typeof value === 'function') return (...args) => { calls.push(key); return value(...args); }; if (typeof key === 'string' && /^[a-z]/u.test(key)) calls.push(key); return value; } });
  return { gl, calls, lost };
}
function fakeDocument({ webgl2, webgl, throwing = false } = {}) {
  const asked = [];
  return { asked, document: { createElement(tag) { asked.push('createElement:' + tag); return { getContext(kind) { asked.push(kind); if (throwing) throw new Error('blocked'); return kind === 'webgl2' ? webgl2 ?? null : kind === 'webgl' ? webgl ?? null : null; } }; } } };
}
function defineGlobals(values) {
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return () => { for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; };
}
function fixture({ navigator = {}, document, performance, proxy, windows, gpuTimeoutMs = 50, proxyTimeoutMs = 50 } = {}) {
  const own = {}; own.top = own;
  // Descriptors, not a spread: a throwing getter must throw when the controller reads it, not while the fixture is built.
  const navigatorObject = Object.defineProperties({ userAgent: 'Mozilla/5.0 Chrome/156.0.0.0', language: 'en-US', languages: ['en-US'] }, Object.getOwnPropertyDescriptors(navigator));
  const restore = defineGlobals({ location: { href: 'chrome-extension://owned/options.html#antidetect' }, window: own, navigator: navigatorObject, document, performance: performance ?? {} });
  const calls = [], environments = [], factoryCalls = [];
  const api = { runtime: { id: 'owned', getURL: path => 'chrome-extension://owned/' + path, async sendMessage(request) { calls.push(structuredClone(request)); return { schemaVersion: 1, type: 'api-config-state', revision: 3, configuration: createApiConfiguration(), registration: 'inactive', reloadRequired: false, earlyAccess: 'ready' }; } }, storage: { onChanged: { addListener() {}, removeListener() {} } }, ...(windows ? { windows } : {}) };
  const proxyFactory = proxy ? (target, options) => { factoryCalls.push({ target, options }); return proxy; } : () => { throw new Error('no proxy port in this fixture'); };
  const controller = createFingerprintProfilesController(api, { onEnvironment: value => environments.push(value), proxyFactory, gpuTimeoutMs, proxyTimeoutMs });
  return { api, calls, environments, factoryCalls, controller, close() { controller.dispose(); restore(); } };
}
const settleExtras = async () => { for (let index = 0; index < 6; index++) await turn(); await pause(80); for (let index = 0; index < 6; index++) await turn(); };

test('memory facts: deviceMemory and the JS heap limit are kept only as plain finite numbers', async () => {
  for (const [memory, heap, expected] of [[8, 4294705152, { deviceMemory: 8, jsHeapSizeLimit: 4294705152 }], [0.5, undefined, { deviceMemory: 0.5 }], [Number.NaN, -1, {}], ['8', 2 ** 60, {}], [2048, 1.5, {}], [undefined, undefined, {}]]) {
    const f = fixture({ navigator: { deviceMemory: memory }, performance: heap === undefined ? {} : { memory: { jsHeapSizeLimit: heap } } });
    try {
      const environment = (await f.controller.load()).environment;
      assert.deepEqual({ deviceMemory: environment.deviceMemory, jsHeapSizeLimit: environment.jsHeapSizeLimit }, { deviceMemory: undefined, jsHeapSizeLimit: undefined, ...expected }, String(memory) + '/' + String(heap));
      assert.deepEqual(JSON.parse(JSON.stringify(environment)), environment, 'no undefined placeholders');
    } finally { f.close(); }
  }
  // A throwing getter is a missing fact, not a failed load.
  const f = fixture({ navigator: { get deviceMemory() { throw new Error('blocked'); } }, performance: { get memory() { throw new Error('blocked'); } } });
  try { const environment = (await f.controller.load()).environment; assert.equal('deviceMemory' in environment, false); assert.equal('jsHeapSizeLimit' in environment, false); } finally { f.close(); }
});

test('GPU from one WebGL2 context: unmasked strings and six capabilities, only getExtension/getParameter, and the context is released', () => {
  const { gl, calls, lost } = fakeGl(), { document, asked } = fakeDocument({ webgl2: gl });
  const gpu = readWebGl(document);
  assert.deepEqual(gpu, { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)', caps: { MAX_TEXTURE_SIZE: 16384, MAX_VIEWPORT_DIMS: [32767, 32767], MAX_RENDERBUFFER_SIZE: 16384, MAX_SAMPLES: 16, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32, MAX_VERTEX_UNIFORM_VECTORS: 4096 }, webgl2: true });
  assert.deepEqual(asked, ['createElement:canvas', 'webgl2'], 'one canvas, one context');
  assert.deepEqual([...new Set(calls.filter(name => typeof name === 'string' && !/^MAX_|^[A-Z_]+$/u.test(name)))].sort(), ['getExtension', 'getParameter', 'loseContext']);
  for (const forbidden of ['drawArrays', 'drawElements', 'readPixels', 'createShader', 'shaderSource', 'compileShader', 'createProgram', 'linkProgram', 'bufferData', 'texImage2D', 'clear', 'finish', 'flush']) assert.equal(calls.includes(forbidden), false, forbidden);
  assert.equal(lost.length, 1, 'the context is released at once');
  assert.deepEqual(GPU_CAPS, Object.keys(GL));
  assert.ok(Array.isArray(gpu.caps.MAX_VIEWPORT_DIMS) && !ArrayBuffer.isView(gpu.caps.MAX_VIEWPORT_DIMS), 'plain data, not a typed array');
});

test('GPU: WebGL 1 fallback, missing debug extension, hostile values and a throwing context are reduced, never invented', () => {
  const one = fakeGl({ webgl2: false }), first = fakeDocument({ webgl2: null, webgl: one.gl });
  const gpu = readWebGl(first.document);
  assert.equal(gpu.webgl2, false); assert.equal('MAX_SAMPLES' in gpu.caps, false, 'WebGL 1 has no MAX_SAMPLES'); assert.deepEqual(first.asked, ['createElement:canvas', 'webgl2', 'webgl']); assert.equal(one.lost.length, 1);
  const hidden = fakeGl({ debug: false }), noDebug = readWebGl(fakeDocument({ webgl2: hidden.gl }).document);
  assert.equal('vendor' in noDebug, false); assert.equal('renderer' in noDebug, false); assert.equal(noDebug.caps.MAX_TEXTURE_SIZE, 16384, 'the capabilities are still read');
  const hostile = fakeGl({ values: { [DEBUG.UNMASKED_RENDERER_WEBGL]: 'x'.repeat(GPU_TEXT_MAX + 1), [DEBUG.UNMASKED_VENDOR_WEBGL]: '', [GL.MAX_TEXTURE_SIZE]: -1, [GL.MAX_SAMPLES]: Number.NaN, [GL.MAX_RENDERBUFFER_SIZE]: 2 ** 40, [GL.MAX_VIEWPORT_DIMS]: [1, 2, 3], [GL.MAX_VERTEX_UNIFORM_VECTORS]: '4096' }, throwing: [GL.MAX_COMBINED_TEXTURE_IMAGE_UNITS] });
  const reduced = readWebGl(fakeDocument({ webgl2: hostile.gl }).document);
  assert.deepEqual(reduced, { webgl2: true }, 'every hostile value is dropped, nothing is filled in'); assert.equal(hostile.lost.length, 1);
  assert.equal(readWebGl(fakeDocument({ throwing: true }).document), undefined); assert.equal(readWebGl(fakeDocument({}).document), undefined, 'no context at all');
  assert.equal(readWebGl(undefined), undefined); assert.equal(readWebGl({ createElement() { throw new Error('no'); } }), undefined);
  assert.equal(readWebGl({ createElement: () => ({}) }), undefined);
  const edge = fakeGl({ values: { [DEBUG.UNMASKED_RENDERER_WEBGL]: 'r'.repeat(GPU_TEXT_MAX) } }); assert.equal(readWebGl(fakeDocument({ webgl2: edge.gl }).document).renderer.length, GPU_TEXT_MAX, 'exactly the limit is kept');
});

test('WebGPU: adapter info is read without a device; no adapter is null; a hang or failure is «not checked»', async () => {
  const info = { vendor: 'nvidia', architecture: 'turing', subgroupMinSize: 32, subgroupMaxSize: 32, isFallbackAdapter: false, device: 'should not be copied', description: 'neither this' };
  let devices = 0;
  const adapter = { info, requestDevice() { devices++; } };
  assert.deepEqual(await readWebGpu({ gpu: { requestAdapter: async () => adapter } }), { vendor: 'nvidia', architecture: 'turing', subgroupMinSize: 32, subgroupMaxSize: 32, isFallbackAdapter: false });
  assert.equal(devices, 0, 'no device is ever requested');
  assert.equal(await readWebGpu({ gpu: { requestAdapter: async () => null } }), null, 'no adapter is a fact');
  assert.equal(await readWebGpu({}), null, 'no WebGPU at all is a fact'); assert.equal(await readWebGpu(undefined), null);
  assert.equal(await readWebGpu({ gpu: {} }), undefined, 'an unusable API is not a fact');
  assert.equal(await readWebGpu({ gpu: { requestAdapter: async () => { throw new Error('denied'); } } }), undefined);
  const started = Date.now(); assert.equal(await readWebGpu({ gpu: { requestAdapter: () => new Promise(() => {}) } }, 40), undefined); assert.ok(Date.now() - started < 1000, 'the race ends at the deadline');
  // Older Chrome: requestAdapterInfo(); the fallback flag may live on the adapter.
  assert.deepEqual(await readWebGpu({ gpu: { requestAdapter: async () => ({ isFallbackAdapter: true, requestAdapterInfo: async () => ({ vendor: 'intel', architecture: 'gen-12lp' }) }) } }), { vendor: 'intel', architecture: 'gen-12lp', isFallbackAdapter: true });
  assert.deepEqual(await readWebGpu({ gpu: { requestAdapter: async () => ({ info: { vendor: 'v'.repeat(129), architecture: '', subgroupMinSize: 0, subgroupMaxSize: 4096, isFallbackAdapter: 'no' } }) } }), { architecture: '' }, 'hostile fields are dropped');
});

test('proxy state: one read through the proxy port, mapped to four states, and the port is always closed', async () => {
  const mapped = {};
  for (const state of ['connected', 'off', 'conflict', 'connecting', 'error', 'blocked', 'permission-required']) {
    let disposed = 0; const client = { load: async () => ({ status: { state }, configuration: { profiles: [{ password: 'secret' }] } }), dispose: () => { disposed++; } };
    mapped[state] = await readProxyState({ runtime: {} }, () => client, {}); assert.equal(disposed, 1, state);
  }
  assert.deepEqual(mapped, { connected: { state: 'connected' }, off: { state: 'disconnected' }, conflict: { state: 'conflict' }, connecting: { state: 'unknown' }, error: { state: 'unknown' }, blocked: { state: 'unknown' }, 'permission-required': { state: 'unknown' } });
  assert.equal(JSON.stringify(mapped).includes('secret'), false, 'nothing but the state is kept');
  let disposed = 0;
  assert.equal(await readProxyState({}, () => ({ load: async () => { throw new Error('unauthorized'); }, dispose: () => { disposed++; } }), {}), undefined); assert.equal(disposed, 1);
  assert.equal(await readProxyState({}, () => ({ load: () => new Promise(() => {}), dispose: () => { disposed++; } }), {}, 30), undefined, 'a hung port is not a state'); assert.equal(disposed, 2);
  assert.equal(await readProxyState({}, () => { throw new Error('no port'); }, {}), undefined);
  assert.equal(await readProxyState({}, () => ({ load: async () => ({}), dispose() {} }), {}), undefined);
});

test('the slow facts never delay a load, arrive once through onEnvironment, are read once per view and are never sent', async () => {
  const { gl } = fakeGl(), { document } = fakeDocument({ webgl2: gl });
  let adapters = 0, loads = 0, releaseAdapter;
  const gpu = { requestAdapter: () => { adapters++; return new Promise(resolve => { releaseAdapter = () => resolve({ info: { vendor: 'nvidia', architecture: 'turing' } }); }); } };
  const proxy = { load: async () => { loads++; return { status: { state: 'connected' } }; }, dispose() {} };
  const f = fixture({ navigator: { gpu, deviceMemory: 8 }, document, proxy, gpuTimeoutMs: 1000 });
  try {
    const first = await f.controller.load();
    assert.equal('gpu' in first.environment, false, 'the load does not wait for the GPU and the adapter'); assert.equal(first.environment.deviceMemory, 8, 'the synchronous facts are there at once');
    assert.equal(f.environments.length, 0);
    releaseAdapter(); await settleExtras();
    assert.equal(f.environments.length, 1, 'one repaint when the facts arrive');
    const environment = f.environments[0];
    assert.equal(environment.gpu.renderer.includes('RTX 3060'), true); assert.deepEqual(environment.gpu.webgpu, { vendor: 'nvidia', architecture: 'turing' }); assert.deepEqual(environment.proxy, { state: 'connected' });
    assert.deepEqual(f.controller.environment(), environment);
    const second = await f.controller.load(); assert.deepEqual(second.environment.gpu, environment.gpu, 'later loads carry the facts');
    assert.equal(adapters, 1); assert.equal(loads, 1, 'read once per view'); assert.equal(f.factoryCalls.length, 1); assert.equal(f.factoryCalls[0].options.env, globalThis);
    assert.deepEqual(f.calls.map(call => call.type), ['ui-api-config-get', 'ui-api-config-get']);
    assert.equal(/RTX|turing|nvidia|connected/u.test(JSON.stringify(f.calls)), false, 'no request carries a snapshot value');
  } finally { f.close(); }
  // A view that is closed before the facts arrive never repaints.
  let late; const quiet = fixture({ navigator: { gpu: { requestAdapter: () => new Promise(resolve => { late = resolve; }) } }, document: fakeDocument({ webgl2: fakeGl().gl }).document, gpuTimeoutMs: 1000 });
  try { await quiet.controller.load(); quiet.controller.dispose(); late(null); await settleExtras(); assert.equal(quiet.environments.length, 0); } finally { quiet.close(); }
});

test('fit window: an explicit call resizes the current window to whole pixel sizes and reports what the browser kept', async () => {
  const updates = [], windows = { getCurrent: async () => ({ id: 7 }), update: async (id, details) => { updates.push([id, details]); return { id, width: details.width - 2, height: details.height }; } };
  const f = fixture({ windows });
  try {
    assert.deepEqual(await f.controller.fitWindow({ width: 1920, height: 1080 }), { requested: { width: 1920, height: 1080 }, actual: { width: 1918, height: 1080 } });
    assert.deepEqual(updates, [[7, { state: 'normal', width: 1920, height: 1080 }]], 'only state, width and height');
    for (const bad of [{ width: 0, height: 1080 }, { width: -5, height: 10 }, { width: 70000, height: 10 }, { width: '1920', height: 1080 }, { width: 1920.5, height: 1080 }, null, undefined]) await assert.rejects(f.controller.fitWindow(bad), error => error.code === 'invalid-value', JSON.stringify(bad));
    assert.equal(updates.length, 1, 'invalid targets never reach the browser');
    assert.equal(f.calls.length, 0, 'no message is sent');
  } finally { f.close(); }
  const broken = fixture({ windows: { getCurrent: async () => ({ id: 7 }), update: async () => { throw new Error('refused'); } } });
  try { await assert.rejects(broken.controller.fitWindow({ width: 800, height: 600 }), error => error.code === 'operation-failed'); } finally { broken.close(); }
  const none = fixture();
  try { await assert.rejects(none.controller.fitWindow({ width: 800, height: 600 }), error => error.code === 'operation-failed', 'no windows API'); } finally { none.close(); }
  const odd = fixture({ windows: { getCurrent: async () => ({}), update: async () => ({}) } });
  try { await assert.rejects(odd.controller.fitWindow({ width: 800, height: 600 }), error => error.code === 'operation-failed'); } finally { odd.close(); }
  const framed = fixture({ windows }); framed.controller.setVisible(false);
  try { await assert.rejects(framed.controller.fitWindow({ width: 800, height: 600 }), error => error.code === 'inactive', 'a hidden view cannot resize'); } finally { framed.close(); }
});
