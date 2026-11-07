// Shared synthetic realms for the WebGL readPixels tests (ADR-066, ADR-107): a WebGL realm whose drawing buffer holds known canvas
// pixels (readPixels returns them bottom-up, like a real default framebuffer) running the serialized production surfaces installer,
// and a minimal 2D realm running the production Canvas installer, used as the reference: readPixels of a framebuffer must equal the
// Canvas projection (getImageData) of the same pixels on a canvas of the same size. Not a test file (no .test.mjs suffix).
import vm from 'node:vm';
import { installSurfaceCustom } from '../../apps/production-extension/api-custom-surfaces-runtime.js';
import { installCanvasCustom } from '../../apps/production-extension/api-custom-canvas-runtime.js';

export const CANVAS_KEY = '0123456789abcdef'.repeat(4), WEBGL_KEY = 'fedcba9876543210'.repeat(4);
export const TOP = 'https://top.example';

export function rng(seed) { let state = seed | 0; return () => (state = (Math.imul(state, 1664525) + 1013904223) | 0) >>> 0; }
// Top-down RGBA canvas pixels. kinds: 'mixed' (opaque, translucent, transparent, endpoints 0/1/254/255), 'opaque', 'flat'.
export function pixels(width, height, kind = 'mixed', salt = 1) {
  const next = rng(Math.imul(width, 73856093) ^ Math.imul(height, 19349663) ^ salt), data = new Uint8Array(width * height * 4), edges = [0, 1, 254, 255];
  for (let offset = 0; offset < data.length; offset += 4) {
    const r = next();
    if (kind === 'flat') { data.set([83, 129, 207, 255], offset); continue; }
    const alpha = kind === 'opaque' ? 255 : [255, 255, 255, 255, 0, 128, 254][r % 7];
    for (let channel = 0; channel < 3; channel++) data[offset + channel] = (r >>> (8 + channel * 5)) % 5 === 0 ? edges[(r >>> channel) & 3] : (r >>> (channel * 8 + 3)) & 255;
    data[offset + 3] = alpha;
  }
  return data;
}

// Ancestor chain like Chromium's Location.ancestorOrigins (DOMStringList with a prototype length getter); empty list = top-level.
function chainSetup(chain) {
  return `(() => {
    class DOMStringList { get length() { return chain.length; } }
    const chain = ${JSON.stringify(chain)}, list = Object.create(DOMStringList.prototype);
    chain.forEach((value, index) => Object.defineProperty(list, index, { value, enumerable: true }));
    const location = {}; Object.defineProperty(location, 'ancestorOrigins', { get() { return list; }, configurable: false });
    globalThis.DOMStringList = DOMStringList;
    Object.defineProperty(globalThis, 'location', { get() { return location; }, configurable: true });
  })();`;
}

// A WebGL realm with the serialized surfaces installer. `contexts` are made by makeContext(webgl2, width, height, pixelsKey, canvasKind):
// pixels come from globalThis.sources[pixelsKey] (top-down canvas rows); canvasKind 'element' | 'offscreen' | 'none' (no canvas
// getter); options.canvasSize overrides the canvas size reported by the element (a GPU-clamped drawing buffer).
export const GL_MOCKS = `(() => {
  const brands = new WeakMap(), sizes = new WeakMap(), reason = new TypeError('Synthetic native WebGL brand');
  globalThis.calls = { read: 0, query: 0, error: 0 }; globalThis.sources = {};
  function data(receiver, webgl2) { const found = brands.get(receiver); if (!found || found.webgl2 !== webgl2) throw reason; return found; }
  function size(receiver) { const found = sizes.get(receiver); if (!found) throw new TypeError('Illegal invocation'); return found; }
  class HTMLCanvasElement { get width() { return size(this).width; } get height() { return size(this).height; } }
  class OffscreenCanvas { get width() { return size(this).width; } get height() { return size(this).height; } }
  function makeClass(webgl2) { return class {
    get canvas() { return data(this, webgl2).canvas; }
    get drawingBufferWidth() { return data(this, webgl2).width; } get drawingBufferHeight() { return data(this, webgl2).height; }
    isContextLost() { data(this, webgl2); return false; }
    getError() { calls.error++; return 0; }
    getParameter(name) {
      const d = data(this, webgl2); calls.query++;
      if (name === 3333) return d.alignment; if (name === 35739) return 6408; if (name === 35738) return 5121; if (name === (webgl2 ? 36010 : 36006)) return null;
      if (webgl2) { if (name === 35053) return null; if (name === 3074) return 1029; if (name === 3330) return d.rowLength; if (name === 3331) return d.skipRows; if (name === 3332) return d.skipPixels; }
      throw reason;
    }
    readPixels(x, y, width, height, format, type, destination, offset = 0) {
      const d = data(this, webgl2), source = globalThis.sources[d.source]; calls.read++; globalThis.lastCall = { receiver: this, args: [...arguments] };
      const rowPixels = d.rowLength || width, stride = Math.ceil(rowPixels * 4 / d.alignment) * d.alignment, start = offset + d.skipRows * stride + d.skipPixels * 4;
      for (let row = 0; row < height; row++) {
        const line = d.height - 1 - (y + row);
        for (let pixel = 0; pixel < width; pixel++) for (let channel = 0; channel < 4; channel++) destination[start + row * stride + pixel * 4 + channel] = source[(line * d.width + x + pixel) * 4 + channel];
      }
    }
  }; }
  const WebGLRenderingContext = makeClass(false), WebGL2RenderingContext = makeClass(true);
  Object.assign(globalThis, { WebGLRenderingContext, WebGL2RenderingContext, HTMLCanvasElement, OffscreenCanvas });
  globalThis.makeContext = (webgl2, width, height, source, canvasKind = 'element', canvasSize = null) => {
    const context = Object.create((webgl2 ? WebGL2RenderingContext : WebGLRenderingContext).prototype);
    const canvas = canvasKind === 'none' ? null : Object.create((canvasKind === 'offscreen' ? OffscreenCanvas : HTMLCanvasElement).prototype);
    if (canvas) sizes.set(canvas, canvasSize ?? { width, height });
    brands.set(context, { webgl2, width, height, source, canvas, alignment: 4, rowLength: 0, skipRows: 0, skipPixels: 0 });
    return context;
  };
  globalThis.packState = (context, patch) => Object.assign(brands.get(context), patch);
})();`;

// options.origin null: the realm has no Window.origin at all.
export function glRealm(entries, { origin = TOP, chain = null, noCanvasGetter = false } = {}) {
  const context = vm.createContext({ DOMException });
  const originSetup = origin === null ? '' : 'Object.defineProperty(globalThis, "origin", { get() { return ' + JSON.stringify(origin) + '; }, configurable: true, enumerable: true });';
  vm.runInContext(GL_MOCKS + '\n' + originSetup + '\n' + (chain ? chainSetup(chain) : '') + '\n' + (noCanvasGetter ? 'for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) delete C.prototype.canvas;' : '') +
    '\nglobalThis.installSurfaceCustom = (' + installSurfaceCustom.toString() + ');', context);
  context.entries = entries;
  vm.runInContext('globalThis.guard = installSurfaceCustom(globalThis, entries)', context);
  const run = source => vm.runInContext(source, context);
  // Reads (x, y, w, h) through the wrapped readPixels of a fresh context over `source` pixels (top-down) and returns the bytes.
  run.read = (source, width, height, rect = [0, 0, width, height], { webgl2 = false, canvasKind = 'element', canvasSize = null, pack = null, offset = 0, extra = 0 } = {}) => {
    context.source = source; context.rect = rect; context.pack = pack; context.canvasSize = canvasSize;
    return run(`(() => {
      const key = 'p' + Object.keys(sources).length; sources[key] = source;
      const gl = makeContext(${webgl2}, ${width}, ${height}, key, ${JSON.stringify(canvasKind)}, canvasSize);
      if (pack) packState(gl, pack);
      const [x, y, w, h] = rect, d = pack || {}, rowPixels = d.rowLength || w, align = d.alignment || 4, stride = Math.ceil(rowPixels * 4 / align) * align;
      const bytes = new Uint8Array(${offset} + (d.skipRows || 0) * stride + (d.skipPixels || 0) * 4 + Math.max(0, h - 1) * stride + w * 4 + ${extra}).fill(51);
      if (${offset}) gl.readPixels(x, y, w, h, 6408, 5121, bytes, ${offset}); else gl.readPixels(x, y, w, h, 6408, 5121, bytes);
      return bytes;
    })()`);
  };
  return run;
}

// Packs bottom-up readPixels rows (no padding) into top-down canvas order, i.e. what getImageData of the same rectangle returns.
export function flipRows(bytes, width, height) {
  const out = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) out.set(bytes.subarray(row * width * 4, (row + 1) * width * 4), (height - 1 - row) * width * 4);
  return out;
}

// Reference: the production Canvas installer projecting getImageData of a 2D canvas of the same size holding the same pixels.
export function canvasReference({ algorithm = 'sparse-rgb-v1', seed = CANVAS_KEY, origin = TOP, chain = null } = {}) {
  const stores = new WeakMap(), contexts = new WeakMap(), images = new WeakMap(), brand = new TypeError('NATIVE_BRAND');
  const check = (map, key) => { const found = map.get(key); if (!found) throw brand; return found; };
  class ImageData {
    constructor(data, width, height) { images.set(this, { data, width, height }); }
    get data() { return check(images, this).data; } get width() { return check(images, this).width; } get height() { return check(images, this).height; }
    get colorSpace() { check(images, this); return 'srgb'; }
  }
  class CanvasRenderingContext2D {
    get canvas() { return check(contexts, this).canvas; }
    getContextAttributes() { check(contexts, this); return { alpha: true, colorSpace: 'srgb', colorType: 'unorm8' }; }
    getImageData(sx, sy, sw, sh) {
      const store = check(stores, check(contexts, this).canvas), data = new Uint8ClampedArray(sw * sh * 4);
      for (let row = 0; row < sh; row++) for (let column = 0; column < sw; column++) {
        const gx = sx + column, gy = sy + row; if (gx < 0 || gy < 0 || gx >= store.width || gy >= store.height) continue;
        data.set(store.data.subarray((gy * store.width + gx) * 4, (gy * store.width + gx) * 4 + 4), (row * sw + column) * 4);
      }
      return new ImageData(data, sw, sh);
    }
  }
  class HTMLCanvasElement {
    get width() { return check(stores, this).width; } get height() { return check(stores, this).height; }
    getContext(type) { const store = check(stores, this); if (type !== '2d') return null; if (!store.context) { store.context = Object.create(CanvasRenderingContext2D.prototype); contexts.set(store.context, { canvas: this }); } return store.context; }
  }
  const realm = { HTMLCanvasElement, CanvasRenderingContext2D, ImageData, DOMException, origin };
  if (chain) {
    class DOMStringList { get length() { return chain.length; } }
    const list = Object.create(DOMStringList.prototype); chain.forEach((value, index) => Object.defineProperty(list, index, { value, enumerable: true }));
    realm.DOMStringList = DOMStringList; Object.defineProperty(realm, 'location', { get() { return { get ancestorOrigins() { return list; } }; } });
  }
  const installer = vm.runInContext('(' + installCanvasCustom.toString() + ')', vm.createContext({ DOMException }));
  installer(realm, [{ id: 'canvas-readback', mode: 'custom', value: { algorithm }, canvasSeed: seed }]);
  // getImageData of (x, y, w, h) of a width x height canvas holding `source` (top-down RGBA).
  return (source, width, height, x = 0, y = 0, w = width, h = height) => {
    const canvas = Object.create(HTMLCanvasElement.prototype); stores.set(canvas, { width, height, data: source });
    return new Uint8Array(canvas.getContext('2d').getImageData(x, y, w, h).data.buffer);
  };
}
