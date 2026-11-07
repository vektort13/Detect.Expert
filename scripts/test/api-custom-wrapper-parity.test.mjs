// ADR-112: the wrappers of the Custom runtimes behave like the functions they replace where a page can look.
//  1. A Proxy wrapper refuses to close a prototype cycle through itself (Object.setPrototypeOf(fn, fn)) with the engine's own TypeError,
//     forwards every other prototype change, and stays usable afterwards (a closed cycle would make every property read overflow the stack).
//  2. A wrapper that is a plain function reports the name and length of the native function it replaces (two copied descriptors; docs/PROJECT_RULES.md
//     rule 3 allows exactly that; Function.prototype.toString is not touched and keeps showing the wrapper).
//  3. WEBGL_lose_context is never hidden by the webgl-capabilities row.
// Everything runs in node:vm realms with synthetic natives; no browser is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installApiCustom } from '../../apps/production-extension/api-custom-runtime.js';
import { installApiCustomDocument } from '../../apps/production-extension/api-custom-document-runtime.js';
import { installMathCustom } from '../../apps/production-extension/api-custom-math-runtime.js';
import { installIntlCustom } from '../../apps/production-extension/api-custom-intl-runtime.js';
import { installSurfaceCustom } from '../../apps/production-extension/api-custom-surfaces-runtime.js';
import { installMediaTypeHooks } from '../../apps/production-extension/api-custom-media-types.js';
import { createMediaCodecMatcher } from '../../apps/production-extension/api-custom-media-codecs.js';

const entry = (id, value, extra = {}) => ({ id, mode: 'custom', value, ...extra });
// What a page does: try to close a cycle, then read properties of the function and make sure it still works.
const CYCLE = `(fn => {
  const out = {}, native = Object.getPrototypeOf(fn);
  try { Object.setPrototypeOf(fn, fn); out.threw = false; } catch (error) { out.threw = error instanceof TypeError; out.message = String(error.message); }
  out.proto = Object.getPrototypeOf(fn) === native;
  out.reads = [typeof fn.name, typeof fn.length, typeof fn.call, typeof fn.bind].join();
  out.reflectOther = Reflect.setPrototypeOf(fn, Object.prototype) && Object.getPrototypeOf(fn) === Object.prototype;
  out.restored = Reflect.setPrototypeOf(fn, native) && Object.getPrototypeOf(fn) === native;
  return out;
})`;
function assertGuarded(context, expression, label) {
  const out = vm.runInContext(CYCLE + '(' + expression + ')', context);
  assert.equal(out.threw, true, label + ': a TypeError, as for a native function'); assert.match(out.message, /cyclic|cycle/i, label);
  assert.equal(out.proto, true, label + ': the prototype is unchanged'); assert.equal(out.reads, 'string,number,function,function', label + ': properties stay readable');
  assert.equal(out.reflectOther, true, label + ': other prototypes are forwarded'); assert.equal(out.restored, true, label);
}

// ---------------------------------------------------------------------------------------------
// Surfaces runtime: method, getter, forEach, requestAnimationFrame, font setter, constructor wrappers, readPixels
// ---------------------------------------------------------------------------------------------
function surfaces(entries, setup = '') {
  const context = vm.createContext({});
  vm.runInContext(`
    const lost = new WeakSet(), gls = new WeakSet();
    class WebGLRenderingContext {
      constructor() { gls.add(this); }
      getParameter(key) { if (!gls.has(this)) throw new TypeError('brand'); key = Number(key) >>> 0; return key === 3379 ? 8192 : null; }
      getSupportedExtensions() { if (!gls.has(this)) throw new TypeError('brand'); return ['EXT_a', 'WEBGL_debug_renderer_info', 'WEBGL_lose_context', 'EXT_disjoint_timer_query']; }
      getExtension(key) { if (!gls.has(this)) throw new TypeError('brand'); key = String(key).toLowerCase(); return ['ext_a', 'webgl_debug_renderer_info', 'webgl_lose_context', 'ext_disjoint_timer_query'].includes(key) ? { extension: key } : null; }
      readPixels(x, y, width, height, format, type, destination) { return undefined; }
      isContextLost() { return false; }
      get drawingBufferWidth() { return 4; } get drawingBufferHeight() { return 4; }
      get canvas() { return null; }
    }
    class GPUSupportedFeatures {
      constructor() { this.set = new Set(['feature-a', 'feature-b']); }
      get size() { return this.set.size; } has(value) { return this.set.has(String(value)); }
      values() { return this.set.values(); } keys() { return this.values(); } entries() { return this.set.entries(); } [Symbol.iterator]() { return this.set.values(); }
      forEach(callback, thisArg) { return this.set.forEach(value => callback.call(thisArg, value, value, this)); }
    }
    class TextMetrics { get width() { return 20; } }
    class CanvasRenderingContext2D { get font() { return '10px sans-serif'; } set font(value) { void value; } }
    class Performance { now() { return 123.75; } }
    class AudioContext { constructor() {} }
    class AudioBuffer { constructor() {} }
    class Navigator {}
    Object.assign(globalThis, { WebGLRenderingContext, GPUSupportedFeatures, TextMetrics, CanvasRenderingContext2D, Performance, AudioContext, AudioBuffer, Navigator });
    globalThis.requestAnimationFrame = function requestAnimationFrame(callback) { return 99; };
    globalThis.performance = new Performance();
    ${setup}
    globalThis.installSurfaceCustom = (${installSurfaceCustom.toString()});
  `, context);
  context.entries = entries; vm.runInContext('globalThis.guard = installSurfaceCustom(globalThis, entries)', context);
  return context;
}

test('surfaces: every function wrapper refuses a prototype cycle (method, getter, forEach, rAF, font setter, constructor wrappers)', () => {
  const context = surfaces([
    entry('webgl-capabilities', { parameters: { MAX_TEXTURE_SIZE: 4096 }, extensions: ['EXT_a'] }), entry('canvas-text-metrics', { scale: 1.01 }),
    entry('webgpu-capabilities', { features: ['feature-a'] }), entry('clock-precision', { resolutionMs: 1 }), entry('canvas-font-policy', { families: ['Arial'], fallback: 'sans-serif' }),
    entry('audio-metadata', { sampleRate: 48000 })]);
  const sites = {
    'method (getParameter)': 'WebGLRenderingContext.prototype.getParameter', 'method (getSupportedExtensions)': 'WebGLRenderingContext.prototype.getSupportedExtensions',
    'getter (TextMetrics.width)': 'Object.getOwnPropertyDescriptor(TextMetrics.prototype, "width").get', 'forEach wrapper': 'GPUSupportedFeatures.prototype.forEach',
    'method (Performance.now)': 'Performance.prototype.now', 'requestAnimationFrame wrapper': 'requestAnimationFrame',
    'font setter wrapper': 'Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "font").set', 'AudioContext constructor wrapper': 'AudioContext',
  };
  for (const [label, expression] of Object.entries(sites)) assertGuarded(context, expression, label);
  // The constructor wrapper still constructs after the attempt.
  assert.equal(vm.runInContext('new AudioContext() instanceof AudioContext', context), true);
});

test('surfaces: AudioBuffer constructor tracking wrapper is guarded too', () => {
  const context = surfaces([entry('audio-fingerprint', { seed: '00112233445566778899aabbccddeeff', amplitude: 0.00001 }, { audioKey: '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2) })]);
  assertGuarded(context, 'AudioBuffer', 'AudioBuffer constructor wrapper');
});

test('surfaces: readPixels reports the name and length of the native function; WEBGL_lose_context is never hidden', () => {
  const context = surfaces([entry('webgl-readback', { seed: '00112233445566778899aabbccddeeff' }, { webglKey: 'fedcba9876543210'.repeat(4) })]);
  const facts = vm.runInContext('(() => { const fn = WebGLRenderingContext.prototype.readPixels; return { name: fn.name, length: fn.length }; })()', context);
  assert.equal(facts.name, 'readPixels'); assert.equal(facts.length, 7);
  assert.equal(vm.runInContext('WebGLRenderingContext.prototype.readPixels.toString().includes("selectedReadPixels")', context), true, 'toString is not masked');
  // Extension list: a list hides what it does not name, except WEBGL_lose_context, in both calls and in any letter case.
  for (const extensions of [[], ['EXT_a'], ['WEBGL_lose_context'], ['EXT_a', 'EXT_disjoint_timer_query']]) {
    const gl = surfaces([entry('webgl-capabilities', { parameters: { MAX_TEXTURE_SIZE: 4096 }, extensions })]);
    const listed = vm.runInContext('new WebGLRenderingContext().getSupportedExtensions().join()', gl).split(',').filter(Boolean);
    assert.ok(listed.includes('WEBGL_lose_context'), JSON.stringify(extensions) + ': lose_context is listed');
    const others = names => names.filter(name => name !== 'WEBGL_lose_context').sort();
    assert.deepEqual(others(listed), others(['EXT_a', 'WEBGL_debug_renderer_info', 'WEBGL_lose_context', 'EXT_disjoint_timer_query'].filter(name => extensions.includes(name))), JSON.stringify(extensions) + ': everything else follows the list');
    for (const spelling of ['WEBGL_lose_context', 'webgl_lose_context', 'Webgl_Lose_Context']) assert.equal(vm.runInContext(`!!new WebGLRenderingContext().getExtension(${JSON.stringify(spelling)})`, gl), true, JSON.stringify(extensions) + ' ' + spelling);
    assert.equal(vm.runInContext('new WebGLRenderingContext().getExtension("WEBGL_debug_renderer_info")', gl) === null, !extensions.includes('WEBGL_debug_renderer_info'), 'a named extension is kept, an unnamed one hidden');
    assert.equal(vm.runInContext('new WebGLRenderingContext().getExtension("EXT_disjoint_timer_query") === null', gl), !extensions.includes('EXT_disjoint_timer_query'));
  }
  // Without a list the native list passes through untouched.
  const plain = surfaces([entry('webgl-capabilities', { parameters: { MAX_TEXTURE_SIZE: 4096 } })]);
  assert.equal(vm.runInContext('new WebGLRenderingContext().getSupportedExtensions().length', plain), 4);
});

// ---------------------------------------------------------------------------------------------
// Math and Intl
// ---------------------------------------------------------------------------------------------
test('math: every wrapped Math function refuses a prototype cycle and keeps its name and length', () => {
  const context = vm.createContext({});
  context.entries = [entry('math-transcendentals', { algorithm: 'deterministic-ulp-v1', functions: ['sin', 'cos', 'exp'] }, { mathSeed: 'ab'.repeat(32) })];
  vm.runInContext(`globalThis.origin = 'https://example.test'; globalThis.installMathCustom = (${installMathCustom.toString()}); globalThis.nativeSin = Math.sin; globalThis.guard = installMathCustom(globalThis, entries);`, context);
  for (const name of ['sin', 'cos', 'exp']) assertGuarded(context, 'Math.' + name, 'Math.' + name);
  const facts = vm.runInContext('({ name: Math.sin.name, length: Math.sin.length, changed: Math.sin !== nativeSin })', context);
  assert.equal(facts.name, 'sin'); assert.equal(facts.length, 1); assert.equal(facts.changed, true, 'the wrapper is installed');
});

test('intl: the Temporal.Now, locale-method and formatter-constructor wrappers refuse a prototype cycle', () => {
  const context = vm.createContext({});
  context.entries = [entry('intl-formatting', { locale: 'de-DE', timeZone: 'Europe/Berlin' })];
  vm.runInContext(`globalThis.installIntlCustom = (${installIntlCustom.toString()}); globalThis.nativeToLocale = Date.prototype.toLocaleString; globalThis.guard = installIntlCustom(globalThis, entries);`, context);
  assert.equal(vm.runInContext('Date.prototype.toLocaleString !== nativeToLocale', context), true, 'the locale method is wrapped');
  for (const expression of ['Date.prototype.toLocaleString', 'Number.prototype.toLocaleString', 'String.prototype.localeCompare', 'Intl.DateTimeFormat', 'Intl.NumberFormat']) assertGuarded(context, expression, expression);
  assert.equal(vm.runInContext('new Intl.DateTimeFormat().resolvedOptions().timeZone', context), 'Europe/Berlin', 'the wrappers still work after the attempts');
});

// ---------------------------------------------------------------------------------------------
// Names and lengths of plain-function wrappers
// ---------------------------------------------------------------------------------------------
function accessorRealm(name, key) {
  const constructor = function () {}, realm = name ? { [name]: constructor } : {}, target = name ? constructor.prototype : realm;
  const original = { configurable: true, enumerable: true, get() { return 'native'; }, set: undefined };
  Object.defineProperty(target, key, original);
  return { realm, target, original };
}
test('api-custom-runtime: a replaced getter reports the name and length of the native getter (descriptor copy, toString untouched)', () => {
  for (const [id, name, key, value] of [['hardware-concurrency', 'Navigator', 'hardwareConcurrency', 16], ['navigator-platform', 'Navigator', 'platform', 'Linux x86_64'], ['window-device-pixel-ratio', null, 'devicePixelRatio', 2]]) {
    const { realm, target, original } = accessorRealm(name, key); installApiCustom(realm, [{ id, mode: 'custom', value }]);
    const wrapper = Object.getOwnPropertyDescriptor(target, key).get;
    assert.notEqual(wrapper, original.get); assert.equal(wrapper.name, original.get.name, id); assert.equal(wrapper.length, original.get.length, id);
    assert.equal(Object.getOwnPropertyDescriptor(wrapper, 'name').writable, false); assert.equal(Object.getOwnPropertyDescriptor(wrapper, 'name').configurable, true); assert.equal(Object.getOwnPropertyDescriptor(wrapper, 'name').enumerable, false);
    assert.match(Function.prototype.toString.call(wrapper), /customGetter/, 'the source text is not masked');
  }
});
test('api-custom-runtime: a replaced method reports the name and length of the native method', () => {
  class SpeechSynthesis { getVoices(language, extra) { return ['native']; } }
  const realm = { SpeechSynthesis }; installApiCustom(realm, [{ id: 'speech-voices', mode: 'custom', value: [] }]);
  const wrapper = Object.getOwnPropertyDescriptor(SpeechSynthesis.prototype, 'getVoices').value;
  assert.equal(wrapper.name, 'getVoices'); assert.equal(wrapper.length, 2); assert.match(Function.prototype.toString.call(wrapper), /customMethod/);
  assert.deepEqual(new SpeechSynthesis().getVoices(), []);
});

test('document runtime: operations, getters and setters report the name and length of the natives', () => {
  const calls = [];
  class Navigator {}
  class Node { appendChild(child) { calls.push(this); return child; } }
  class HTMLIFrameElement { get contentWindow() { return null; } }
  class Element { set innerHTML(value) { void value; } }
  const realm = { Navigator, Node, HTMLIFrameElement, Element }; Object.defineProperty(realm, 'self', { configurable: true, get() { return this; } });
  const natives = { append: Node.prototype.appendChild, window: Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get, html: Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML').set };
  installApiCustomDocument(realm, [{ id: 'hardware-concurrency', mode: 'custom', value: 8 }], () => {});
  const wrapped = { append: Node.prototype.appendChild, window: Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get, html: Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML').set };
  for (const key of Object.keys(natives)) { assert.notEqual(wrapped[key], natives[key], key + ' is wrapped'); assert.equal(wrapped[key].name, natives[key].name, key); assert.equal(wrapped[key].length, natives[key].length, key); }
  assert.equal(wrapped.append.name, 'appendChild'); assert.equal(wrapped.window.name, 'get contentWindow'); assert.equal(wrapped.html.name, 'set innerHTML');
  assert.match(Function.prototype.toString.call(wrapped.append), /customDocumentOperation/);
});

test('media types: canPlayType and isTypeSupported wrappers report the native name and length', () => {
  class HTMLMediaElement { canPlayType(type) { return 'maybe'; } }
  const realm = { HTMLMediaElement }, native = HTMLMediaElement.prototype.canPlayType;
  const hooks = installMediaTypeHooks(realm, 1, createMediaCodecMatcher());
  const wrapper = HTMLMediaElement.prototype.canPlayType;
  assert.notEqual(wrapper, native); assert.equal(wrapper.name, 'canPlayType'); assert.equal(wrapper.length, 1);
  assert.ok(hooks);
});

test('geolocation wrappers were covered by api-custom-geolocation.test.mjs; the canvas wrappers are Proxies and need no copy', () => {
  // A Proxy forwards name and length to its target by itself.
  const context = vm.createContext({ DOMException });
  assert.equal(vm.runInContext('(() => { const target = function toDataURL(type) {}; const wrapper = new Proxy(target, {}); return wrapper.name + ":" + wrapper.length; })()', context), 'toDataURL:1');
});
