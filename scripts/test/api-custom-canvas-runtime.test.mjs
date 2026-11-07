import baseTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { installCanvasCustom } from '../../apps/production-extension/api-custom-canvas-runtime.js';

const seed = '0123456789abcdef'.repeat(4);
// Every behaviour below that does not depend on the pixel function runs for both algorithms (stable-rgb-v1 older saved values,
// sparse-rgb-v1 default). Tests that pin pixel values branch on `stable`; the sparse function itself is pinned in api-custom-canvas-sparse.test.mjs.
function defineSuite(algorithm) {
const test = (name, fn) => baseTest(`${name} [${algorithm}]`, fn);
const stable = algorithm === 'stable-rgb-v1';
const profile = { algorithm };
const entry = (patch = {}) => ({ id: 'canvas-readback', mode: 'custom', value: profile, canvasSeed: seed, ...patch });
const visualDeny = Symbol.for('detect.expert/api-custom/value-capture-deny/v1');
const digestOf = bytes => { let hash = 2166136261; for (let index = 0; index < bytes.length; index++) hash = Math.imul(hash ^ bytes[index], 16777619); return hash >>> 0; };
function fixture(options = {}) {
  const fixtureOptions = options;
  const records = new WeakMap(), images = new WeakMap(), contexts = new WeakMap(), calls = [], callbacks = [], conversions = [];
  const invalid = new TypeError('NATIVE_BRAND'), tainted = new DOMException('NATIVE_TAINT', 'SecurityError');
  const check = (map, value) => { const found = map.get(value); if (!found) throw invalid; return found; };
  const log = (name, receiver, args) => calls.push({ name, receiver, args });
  const integer = value => { const number = +value; if (!Number.isFinite(number) || Math.trunc(number) < -2147483648 || Math.trunc(number) > 2147483647) throw new TypeError('NATIVE_RANGE'); return Math.trunc(number); };
  // Canvases beyond 10000 pixels have no pixel store (and read back as zeros) unless fullPixels is set.
  function allocate(record) { record.data = new Uint8ClampedArray(record.width * record.height <= 10000 || fixtureOptions.fullPixels ? record.width * record.height * 4 : 0); }
  class ImageData {
    constructor(data, width, height, colorSpace = 'srgb') { images.set(this, { data, width, height, colorSpace }); }
    get data() { return check(images, this).data; } get width() { return check(images, this).width; } get height() { return check(images, this).height; } get colorSpace() { return check(images, this).colorSpace; }
  }
  // Copies the in-bounds part of a rectangle row by row; `from` and `to` are { data, width, height } stores.
  function copyRows(from, fx, fy, to, tx, ty, width, height, opaqueOnly) {
    if (!from.data.length || !to.data.length) return;
    for (let y = 0; y < height; y++) {
      if (fy + y < 0 || fy + y >= from.height || ty + y < 0 || ty + y >= to.height) continue;
      const x0 = Math.max(0, -fx, -tx), x1 = Math.min(width, from.width - fx, to.width - tx);
      if (x1 <= x0) continue;
      const source = ((fy + y) * from.width + fx + x0) * 4, target = ((ty + y) * to.width + tx + x0) * 4, length = (x1 - x0) * 4;
      if (!opaqueOnly) { to.data.set(from.data.subarray(source, source + length), target); continue; }
      for (let offset = 0; offset < length; offset += 4) if (from.data[source + offset + 3] !== 0) for (let c = 0; c < 4; c++) to.data[target + offset + c] = from.data[source + offset + c];
    }
  }
  function getImageData(sx, sy, sw, sh) {
    const context = check(contexts, this), source = check(records, context.canvas); log('getImageData', this, [...arguments]);
    if (arguments.length < 4) throw new TypeError('NATIVE_ARITY');
    sx = integer(sx); sy = integer(sy); sw = integer(sw); sh = integer(sh);
    if (sw === 0 || sh === 0) throw new DOMException('NATIVE_SIZE', 'IndexSizeError'); if (source.tainted) throw tainted;
    if (sw < 0) { sx += sw; sw = -sw; } if (sh < 0) { sy += sh; sh = -sh; }
    const readLimit = fixtureOptions.fullPixels ? Infinity : fixtureOptions.fullReadback ? 4 * 1024 * 1024 : 10000;
    const data = new Uint8ClampedArray(sw * sh <= readLimit ? sw * sh * 4 : 0);
    if (data.length) copyRows(source, sx, sy, { data, width: sw, height: sh }, 0, 0, sw, sh, false);
    return new ImageData(data, sw, sh, context.colorSpace);
  }
  function putImageData(image, dx, dy) {
    const context = check(contexts, this), record = check(records, context.canvas), input = check(images, image); log('putImageData', this, [...arguments]);
    copyRows(input, 0, 0, record, dx, dy, input.width, input.height, false);
  }
  // drawImage(source, dx, dy) and drawImage(source, sx, sy, sw, sh, dx, dy, sw, sh) with 1:1 scale;
  // source pixels with alpha 0 leave the destination untouched, others replace it.
  function drawImage(source, ...rest) {
    const context = check(contexts, this), destination = check(records, context.canvas), input = check(records, source); log('drawImage', this, [source, ...rest]);
    if (input.tainted) destination.tainted = true;
    const crop = rest.length === 8 ? rest : [0, 0, input.width, input.height, rest[0] ?? 0, rest[1] ?? 0];
    assert.ok(rest.length === 0 || rest.length === 2 || rest.length === 8, 'unsupported drawImage form');
    if (rest.length === 8) assert.ok(rest[2] === rest[6] && rest[3] === rest[7], 'drawImage must not scale');
    copyRows(input, crop[0], crop[1], destination, crop[4], crop[5], crop[2], crop[3], true);
  }
  class CanvasRenderingContext2D {
    constructor(canvas, settings = {}) { contexts.set(this, { canvas, colorSpace: settings.colorSpace || 'srgb', colorType: settings.colorType || 'unorm8' }); }
    get canvas() { return check(contexts, this).canvas; }
    getContextAttributes() { const row = check(contexts, this); return { alpha: true, colorSpace: row.colorSpace, colorType: row.colorType }; }
    getImageData(...args) { return Reflect.apply(getImageData, this, args); }
    putImageData(...args) { return Reflect.apply(putImageData, this, args); }
    drawImage(...args) { return Reflect.apply(drawImage, this, args); }
  }
  class OffscreenCanvasRenderingContext2D {
    constructor(canvas, settings = {}) { contexts.set(this, { canvas, colorSpace: settings.colorSpace || 'srgb', colorType: settings.colorType || 'unorm8' }); }
    get canvas() { return check(contexts, this).canvas; }
    getContextAttributes() { const row = check(contexts, this); return { alpha: true, colorSpace: row.colorSpace, colorType: row.colorType }; }
    getImageData(...args) { return Reflect.apply(getImageData, this, args); }
    putImageData(...args) { return Reflect.apply(putImageData, this, args); }
    drawImage(...args) { return Reflect.apply(drawImage, this, args); }
  }
  function mime(type) { type = type === undefined ? 'image/png' : `${type}`.toLowerCase(); return ['image/png', 'image/jpeg', 'image/webp'].includes(type) ? type : 'image/png'; }
  // Stores beyond 10000 pixels are summarised by a digest so large canvases stay cheap to encode.
  const encoded = (record, type, quality) => JSON.stringify({ width: record.width, height: record.height, ...(record.data.length > 40000 ? { digest: digestOf(record.data) } : { data: [...record.data] }), type, quality: typeof quality === 'number' && quality >= 0 && quality <= 1 ? quality : null });
  class HTMLCanvasElement {
    constructor() { records.set(this, { width: 0, height: 0, data: new Uint8ClampedArray(), tainted: false }); }
    get width() { return check(records, this).width; } set width(value) { const record = check(records, this); record.width = Number(value); allocate(record); }
    get height() { return check(records, this).height; } set height(value) { const record = check(records, this); record.height = Number(value); allocate(record); }
    getContext(type, settings) { const record = check(records, this); log('getContext', this, [...arguments]); type = `${type}`; if (type !== '2d') return null; return record.context ??= new CanvasRenderingContext2D(this, settings); }
    toDataURL(type, quality) { const record = check(records, this); log('toDataURL', this, [...arguments]); type = mime(type); if (record.tainted) throw tainted; if (!record.width || !record.height) return 'data:,'; return 'data:' + type + ';base64,' + Buffer.from(encoded(record, type, quality)).toString('base64'); }
    toBlob(callback, type, quality) { const record = check(records, this); log('toBlob', this, [...arguments]); if (typeof callback !== 'function') throw new TypeError('NATIVE_CALLBACK'); type = mime(type); if (record.tainted) throw tainted;
      const blob = record.width && record.height ? new Blob([encoded(record, type, quality)], { type }) : null;
      const deliver = () => Reflect.apply(callback, undefined, [blob]); if (options.holdCallbacks) callbacks.push(deliver); else queueMicrotask(deliver);
    }
  }
  class OffscreenCanvas {
    constructor(width, height) { records.set(this, { width, height, data: new Uint8ClampedArray(width * height * 4), tainted: false }); }
    get width() { return check(records, this).width; } set width(value) { const record = check(records, this); record.width = Number(value); allocate(record); }
    get height() { return check(records, this).height; } set height(value) { const record = check(records, this); record.height = Number(value); allocate(record); }
    getContext(type, settings) { const record = check(records, this); log('getContext', this, [...arguments]); type = `${type}`; if (type !== '2d') return null; return record.context ??= new OffscreenCanvasRenderingContext2D(this, settings); }
    convertToBlob(options = {}) { const record = check(records, this); log('convertToBlob', this, [...arguments]); let quality, type;
      try { quality = options?.quality; if (quality !== undefined) quality = +quality; type = mime(options?.type); } catch (error) { return Promise.reject(error); }
      if (record.tainted) return Promise.reject(tainted); if (!record.width || !record.height) return Promise.reject(new DOMException('NATIVE_SIZE', 'IndexSizeError'));
      const blob = new Blob([encoded(record, type, quality)], { type });
      if (fixtureOptions.holdConversions) return new Promise((resolve, reject) => conversions.push({ resolve: () => resolve(blob), reject }));
      const result = Promise.resolve(blob);
      if (fixtureOptions.speciesError) Object.defineProperty(result, 'constructor', { get() { fixtureOptions.speciesReads = (fixtureOptions.speciesReads ?? 0) + 1; throw fixtureOptions.speciesError; } });
      return result;
    }
  }
  class Document { createElement(tag) { if (this.detached) throw new Error('DETACHED_DOCUMENT'); assert.equal(tag, 'canvas'); return new HTMLCanvasElement(); } }
  const realm = { HTMLCanvasElement, CanvasRenderingContext2D, OffscreenCanvas, OffscreenCanvasRenderingContext2D, ImageData, Document, Blob, DOMException, origin: options.origin ?? 'https://example.test', document: new Document() };
  const original = { read: CanvasRenderingContext2D.prototype.getImageData, url: HTMLCanvasElement.prototype.toDataURL, blob: HTMLCanvasElement.prototype.toBlob, convert: OffscreenCanvas.prototype.convertToBlob };
  if (options.prepare) options.prepare(realm);
  // A fixture has new JS-only mock brands; browser-native accessors instead
  // accept genuine objects across same-origin realms. Isolate those brands.
  const intrinsicContext = options.intrinsicContext ?? vm.createContext({ DOMException });
  const installer = options.installer ?? vm.runInContext(`(${installCanvasCustom.toString()})`, intrinsicContext);
  const installation = installer(realm, options.entries ?? [entry(options.entry)]);
  function source(width = 8, height = 4, offscreen = false) {
    const canvas = offscreen ? new OffscreenCanvas(width, height) : new HTMLCanvasElement();
    if (!offscreen) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext('2d', options.settings), data = check(records, canvas).data;
    for (let offset = 0; offset < data.length; offset += 4) { data[offset + 3] = offset % 12 === 4 ? 80 : offset % 12 === 8 ? 0 : 255; if (data[offset + 3]) { data[offset] = 10 + offset % 180; data[offset + 1] = 30 + offset % 100; data[offset + 2] = 60 + offset % 120; } }
    return { canvas, context, before: [...data] };
  }
  return { realm, records, contexts, images, calls, invalid, tainted, installation, original, source, callbacks, conversions, installer, intrinsicContext };
}
const decodeUrl = value => JSON.parse(Buffer.from(value.slice(value.indexOf(',') + 1), 'base64').toString());
const blob = canvas => new Promise(resolve => canvas.toBlob(resolve));
const decodeBlob = async value => JSON.parse(await value.text());

test('opaque RGB projection is deterministic, bounded by one and leaves alpha/translucent/transparent pixels unchanged (an engine whose conversions were not measured)', () => {
  const f = fixture(), { canvas, context, before } = f.source(), a = context.getImageData(0, 0, 8, 4), b = context.getImageData(0, 0, 8, 4);
  assert.deepEqual([...a.data], [...b.data]); assert.equal(a instanceof f.realm.ImageData, true);
  let moved = 0;
  for (let pixel = 0; pixel < before.length / 4; pixel++) {
    const deltas = [0, 1, 2, 3].map(channel => Math.abs(a.data[pixel * 4 + channel] - before[pixel * 4 + channel])), opaque = before[pixel * 4 + 3] === 255;
    if (stable) assert.deepEqual(deltas, opaque ? [1, 1, 1, 0] : [0, 0, 0, 0]);
    else { assert.equal(deltas[3], 0); assert.ok(opaque || deltas.every(delta => delta === 0)); assert.ok(deltas.slice(0, 3).every(delta => delta <= 1) && deltas.filter(delta => delta).length <= 1); moved += deltas.some(delta => delta) ? 1 : 0; }
  }
  if (!stable) assert.ok(moved >= 1, 'the 8x4 canvas moves a quarter of its pixels (the opaque ones)');
  assert.deepEqual([...f.records.get(canvas).data], before);
});

test('crop, negative-size, out-of-bounds and primitive WebIDL coordinates match the full projection', () => {
  const f = fixture(), { context } = f.source(), full = context.getImageData(0, 0, 8, 4).data;
  for (const coords of [[2, 1, 3, 2], [5, 3, -3, -2], ['2.9', '1.4', '3.9', '2.1']]) {
    const data = context.getImageData(...coords).data;
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) for (let c = 0; c < 4; c++) assert.equal(data[(y * 3 + x) * 4 + c], full[((y + 1) * 8 + x + 2) * 4 + c]);
  }
  const outside = context.getImageData(-1, -1, 3, 3).data; assert.deepEqual([...outside.slice(0, 16)], Array(16).fill(0));
});

test('HTML URL/Blob and Offscreen Blob encode the same projection without changing source state', async () => {
  const f = fixture(), first = f.source(), off = f.source(8, 4, true), expected = [...first.context.getImageData(0, 0, 8, 4).data];
  assert.deepEqual(decodeUrl(first.canvas.toDataURL()).data, expected);
  assert.deepEqual((await decodeBlob(await blob(first.canvas))).data, expected);
  assert.deepEqual((await decodeBlob(await off.canvas.convertToBlob())).data, expected);
  assert.deepEqual([...f.records.get(first.canvas).data], first.before); assert.deepEqual([...f.records.get(off.canvas).data], off.before);
});

test('async encoders snapshot before source mutation and invoke the callback exactly once', async () => {
  const f = fixture(), first = f.source(), off = f.source(8, 4, true), expected = [...first.context.getImageData(0, 0, 8, 4).data];
  let calls = 0;
  const encoded = new Promise(resolve => first.canvas.toBlob(value => { calls++; resolve(value); }));
  const converted = off.canvas.convertToBlob(); f.records.get(first.canvas).data.fill(0); f.records.get(off.canvas).data.fill(0);
  assert.deepEqual((await decodeBlob(await encoded)).data, expected); assert.deepEqual((await decodeBlob(await converted)).data, expected); assert.equal(calls, 1);
});

test('source native methods run once; allowed internal reads and encoders target private copies', async () => {
  const f = fixture(), { canvas, context } = f.source(), off = f.source(8, 4, true); f.calls.length = 0;
  context.getImageData(0, 0, 8, 4); canvas.toDataURL(); await blob(canvas); await off.canvas.convertToBlob();
  assert.equal(f.calls.filter(row => row.name === 'getImageData' && row.receiver === context).length, 1);
  assert.equal(f.calls.filter(row => row.name === 'toDataURL' && row.receiver === canvas).length, 1);
  assert.equal(f.calls.filter(row => row.name === 'toBlob' && row.receiver === canvas).length, 1);
  assert.equal(f.calls.filter(row => row.name === 'convertToBlob' && row.receiver === off.canvas).length, 1);
  assert.ok(f.calls.some(row => row.name === 'toDataURL' && row.receiver !== canvas));
});

test('origin/session inputs separate stable output while independent canvases with equal pixels agree', () => {
  const output = options => { const f = fixture(options), first = f.source(); return [...first.context.getImageData(0, 0, 8, 4).data]; };
  const first = output({}); assert.deepEqual(output({}), first); assert.notDeepEqual(output({ origin: 'https://other.test' }), first); assert.notDeepEqual(output({ entry: { canvasSeed: 'a'.repeat(64) } }), first);
});

test('native conversion/error identity remains first; opaque coordinate success is denied after coercion once', async () => {
  const f = fixture(), { canvas, context } = f.source(); let reads = 0;
  const value = { [Symbol.toPrimitive](hint) { assert.equal(hint, 'number'); reads++; return 0; } };
  assert.throws(() => context.getImageData(value, 0, 8, 4), error => error.name === 'SecurityError'); assert.equal(reads, 1);
  const marker = new Error('COERCION'); assert.throws(() => context.getImageData({ valueOf() { throw marker; } }, 0, 8, 4), error => error === marker);
  f.records.get(canvas).tainted = true;
  for (const invoke of [() => context.getImageData(0, 0, 8, 4), () => canvas.toDataURL(), () => canvas.toBlob(() => {})]) assert.throws(invoke, error => error === f.tainted);
  const off = f.source(8, 4, true); f.records.get(off.canvas).tainted = true; await assert.rejects(off.canvas.convertToBlob(), error => error === f.tainted);
});

test('MIME comes from native results: type-object conversion is not repeated and HTML quality objects stay ignored', async () => {
  const f = fixture(), { canvas } = f.source(); let reads = 0;
  const type = { [Symbol.toPrimitive](hint) { assert.equal(hint, 'string'); reads++; return 'IMAGE/JPEG'; } }, quality = { valueOf() { assert.fail('HTML quality must not be coerced'); } };
  const encoded = decodeUrl(canvas.toDataURL(type, quality)); assert.equal(encoded.type, 'image/jpeg'); assert.equal(reads, 1); assert.equal(encoded.quality, null);
  const result = await new Promise(resolve => canvas.toBlob(resolve, type, quality)); assert.equal(reads, 2); assert.equal(result.type, 'image/jpeg');
  assert.equal(decodeUrl(canvas.toDataURL('unknown-format')).type, 'image/png');
});

test('Offscreen dictionary getters/coercion run only natively; ambiguous converted quality never leaks raw bytes', async () => {
  const f = fixture(), { canvas } = f.source(8, 4, true), order = [];
  const options = { get quality() { assert.equal(this, options); order.push('quality'); return '0.4'; }, get type() { assert.equal(this, options); order.push('type'); return 'image/jpeg'; } };
  const result = await decodeBlob(await canvas.convertToBlob(options)); assert.equal(result.quality, 0.4); assert.deepEqual(order, ['quality', 'type']);
  let conversions = 0; const opaque = { get quality() { return { valueOf() { conversions++; return 0.4; } }; } };
  await assert.rejects(canvas.convertToBlob(opaque), error => error.name === 'SecurityError'); assert.equal(conversions, 1);
  const marker = new Error('DICT'); await assert.rejects(canvas.convertToBlob({ get type() { throw marker; } }), error => error === marker);
});

test('invalid/missing seeds fail closed, while Allow/Bypass install nothing', async () => {
  for (const canvasSeed of [undefined, '', 'a'.repeat(63), 'A'.repeat(64)]) {
    const f = fixture({ entry: { canvasSeed } }), { canvas, context } = f.source(), off = f.source(8, 4, true);
    assert.throws(() => context.getImageData(0, 0, 8, 4), error => error.name === 'SecurityError'); assert.throws(() => canvas.toDataURL(), error => error.name === 'SecurityError'); assert.equal(await blob(canvas), null); await assert.rejects(off.canvas.convertToBlob(), error => error.name === 'SecurityError');
  }
  for (const mode of ['off', 'bypass', 'on']) { const f = fixture({ entry: { mode } }); assert.equal(f.realm.HTMLCanvasElement.prototype.toDataURL, f.original.url); assert.equal(f.installation.snapshot().installed, 0); }
});

test('oversized valid source readbacks are denied without native fallback; zero-size and native errors retain their outcomes', async () => {
  const f = fixture(), { canvas, context } = f.source(); canvas.width = 16 * 1024 * 1024 + 1; canvas.height = 1;
  assert.throws(() => canvas.toDataURL(), error => error.name === 'SecurityError'); assert.equal(await blob(canvas), null);
  assert.throws(() => context.getImageData(0, 0, canvas.width, 1), error => error.name === 'SecurityError');
  canvas.width = 0; assert.equal(canvas.toDataURL(), 'data:,'); assert.equal(await blob(canvas), null);
  assert.throws(() => context.getImageData(0, 0, 0, 1), error => error.name === 'IndexSizeError'); assert.throws(() => context.getImageData(NaN, 0, 1, 1), TypeError);
});

test('borrowed methods retain native receiver checks and installation exposes counters only', () => {
  const f = fixture(), { canvas } = f.source();
  assert.throws(() => Reflect.apply(f.realm.HTMLCanvasElement.prototype.toDataURL, {}, []), error => error === f.invalid);
  assert.deepEqual(Object.keys(f.installation), ['snapshot']);
  const data = JSON.stringify(f.installation.snapshot()); assert.equal(data.includes(seed), false); assert.equal(data.includes('https://'), false);
  const retained = canvas.toDataURL; canvas.toDataURL = () => 'page'; assert.notEqual(Reflect.apply(retained, canvas, []), 'page');
});

test('color-space metadata is preserved and float16/unknown context metadata is withheld', async () => {
  const f = fixture({ settings: { colorSpace: 'display-p3' } }), source = f.source();
  assert.equal(source.context.getImageData(0, 0, 8, 4).colorSpace, 'display-p3');
  assert.deepEqual(decodeUrl(source.canvas.toDataURL()).data, [...source.context.getImageData(0, 0, 8, 4).data]);
  for (const settings of [{ colorType: 'float16' }, { colorSpace: 'future-space' }]) {
    const f = fixture({ settings }), source = f.source();
    assert.throws(() => source.context.getImageData(0, 0, 8, 4), error => error.name === 'SecurityError');
    assert.throws(() => source.canvas.toDataURL(), error => error.name === 'SecurityError');
    assert.equal(await blob(source.canvas), null);
  }
});

test('RGB endpoint channels stay bounded and EnforceRange boundaries retain native errors', () => {
  const f = fixture(), { canvas, context } = f.source(stable ? 1 : 20, stable ? 1 : 20), pixels = f.records.get(canvas).data;
  if (stable) { pixels.set([0, 255, 128, 255]); assert.deepEqual([...context.getImageData(0, 0, 1, 1).data].slice(0, 2), [1, 254]); }
  else {
    for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([0, 255, 128, 255], offset);
    const moved = [...context.getImageData(0, 0, 20, 20).data]; let changed = 0;
    for (let offset = 0; offset < moved.length; offset += 4) { assert.ok(moved[offset] <= 1 && moved[offset + 1] >= 254 && moved[offset + 3] === 255); changed += (moved[offset] === 1) + (moved[offset + 1] === 254) + (moved[offset + 2] !== 128); }
    assert.ok(changed >= 50, 'about a quarter of the 400 pixels moved one channel, reflected at the ends: ' + changed);
  }
  for (const invalid of [Infinity, -Infinity, NaN, 2147483648, -2147483649, 4294967295, -4294967295, 1n, Symbol('x')]) {
    assert.throws(() => context.getImageData(invalid, 0, 1, 1), TypeError);
  }
});

test('pending HTML encoder snapshots are bounded at 256, over-budget returns null and completed slots can be reused', () => {
  const f = fixture({ holdCallbacks: true }), { canvas, context } = f.source(), results = [], limit = 256;
  const snapshots = () => f.calls.filter(row => row.name === 'getImageData' && row.receiver !== context).length;
  f.calls.length = 0;
  for (let index = 0; index < limit + 1; index++) canvas.toBlob(blob => results.push(blob));
  assert.equal(f.calls.filter(row => row.name === 'toBlob' && row.receiver === canvas).length, limit + 1);
  assert.equal(snapshots(), limit, 'only 256 derived snapshots are retained');
  for (let index = 0; index < limit + 1; index++) f.callbacks.shift()();
  assert.deepEqual(results, [null]);
  // Even after the source callbacks, pending private encodes retain their slots.
  canvas.toBlob(blob => results.push(blob)); assert.equal(snapshots(), limit);
  while (f.callbacks.length) f.callbacks.shift()();
  assert.equal(results.filter(value => value === null).length, 2); assert.equal(results.filter(value => value instanceof Blob).length, limit);
  canvas.toBlob(blob => results.push(blob)); while (f.callbacks.length) f.callbacks.shift()(); assert.ok(results.at(-1) instanceof Blob);
});

test('Offscreen rejection releases a pending slot and keeps the original rejection identity', async () => {
  const f = fixture({ holdConversions: true }), { canvas } = f.source(8, 4, true), limit = 256;
  const pending = Array.from({ length: limit + 1 }, () => canvas.convertToBlob());
  const marker = new Error('ORIGINAL_REJECTION'), rejected = assert.rejects(pending[0], error => error === marker);
  f.conversions[0].reject(marker); await rejected;
  const reused = canvas.convertToBlob();
  const overBudget = assert.rejects(pending[limit], error => error.name === 'SecurityError');
  for (let index = 1; index < f.conversions.length; index++) f.conversions[index].resolve();
  await overBudget;
  for (const promise of [...pending.slice(1, limit), reused]) assert.ok(await promise instanceof Blob);
  const next = canvas.convertToBlob(); f.conversions.at(-1).resolve(); assert.ok(await next instanceof Blob);
});

test('the pending pixel budget admits eight four-megapixel snapshots and denies the ninth', () => {
  const f = fixture({ holdCallbacks: true, fullReadback: true }), { canvas, context } = f.source(2048, 2048), results = [];
  f.calls.length = 0;
  for (let index = 0; index < 9; index++) canvas.toBlob(value => results.push(value));
  const retained = new Set(f.calls.filter(row => row.name === 'getImageData' && row.receiver !== context).map(row => row.receiver));
  assert.equal(retained.size, 8, 'thirty-two megapixels are retained across eight requests');
  for (let index = 0; index < 9; index++) f.callbacks.shift()(); assert.deepEqual(results, [null]);
  while (f.callbacks.length) f.callbacks.shift()(); assert.equal(results.filter(value => value instanceof Blob).length, 8);
});

test('an immutable native Promise constructor fails closed without reading its getter and releases every Offscreen snapshot', async () => {
  const marker = new Error('SPECIES'), options = { speciesError: marker }, f = fixture(options), { canvas } = f.source(8, 4, true);
  for (let index = 0; index < 5; index++) assert.throws(() => canvas.convertToBlob(), error => error.name === 'TypeError');
  assert.equal(options.speciesReads ?? 0, 0);
  options.speciesError = null;
  assert.ok(await canvas.convertToBlob() instanceof Blob, 'all failed then constructions released their reservations');
});

test('private canvases use the current document after an initial about:blank document is replaced', async () => {
  const f = fixture(), { canvas } = f.source(), previous = f.realm.document;
  f.realm.document = new f.realm.Document(); previous.detached = true;
  assert.ok(canvas.toDataURL().startsWith('data:image/png;'));
  assert.ok(await blob(canvas) instanceof Blob);
});

test('cached JavaScript intrinsics survive page poisoning and still install fresh child DOM bundles', async () => {
  const f = fixture(), source = f.source(), expected = [...source.context.getImageData(0, 0, 8, 4).data];
  vm.runInContext(`const poison=()=>{throw Error('PAGE_INTRINSIC');};Reflect.apply=poison;Reflect.get=poison;Object.getOwnPropertyDescriptor=poison;Object.defineProperty=poison;Object.getPrototypeOf=poison;Object.freeze=poison;Array.isArray=poison;Array.prototype[Symbol.iterator]=poison;WeakMap.prototype.get=poison;WeakMap.prototype.set=poison;WeakSet.prototype.has=poison;WeakSet.prototype.add=poison;String.prototype.charCodeAt=poison;Math.trunc=poison;Number=poison;Symbol.for=poison;`, f.intrinsicContext);
  assert.deepEqual([...source.context.getImageData(0, 0, 8, 4).data], expected);
  assert.deepEqual(decodeUrl(source.canvas.toDataURL()).data, expected);
  assert.deepEqual((await decodeBlob(await blob(source.canvas))).data, expected);
  const child = fixture({ installer: f.installer, intrinsicContext: f.intrinsicContext }), second = child.source();
  assert.equal(Object.getOwnPropertyDescriptor(child.realm, visualDeny).configurable, false);
  assert.deepEqual([...second.context.getImageData(0, 0, 8, 4).data], expected);
  assert.deepEqual(decodeUrl(second.canvas.toDataURL()).data, expected);
});

test('Custom seals a deny-only preview marker even with missing seeds or forged false/accessor fields', () => {
  for (const configurable of [false, true]) for (const accessor of [false, true]) {
    let gets = 0;
    const f = fixture({ prepare(realm) { Object.defineProperty(realm, visualDeny, accessor ? { get() { gets++; throw Error('MARKER_GETTER'); }, configurable } : { value: false, configurable }); } });
    const { context } = f.source(); assert.equal(context.getImageData(0, 0, 1, 1).data.length, 4);
    assert.equal(Object.getOwnPropertyDescriptor(f.realm, visualDeny).configurable, false); assert.equal(gets, 0);
  }
  const invalid = fixture({ entry: { canvasSeed: undefined } }); assert.equal(Object.getOwnPropertyDescriptor(invalid.realm, visualDeny).configurable, false);
  for (const mode of ['on', 'off', 'bypass']) assert.equal(Object.getOwnPropertyDescriptor(fixture({ entry: { mode } }).realm, visualDeny), undefined);
  assert.equal(Object.getOwnPropertyDescriptor(fixture({ entries: [] }).realm, visualDeny), undefined);
});

test('if a preview veto cannot be sealed, covered reads fail before an inner observer/native can see pixels', () => {
  const f = fixture({ prepare: Object.preventExtensions }), source = f.source(), off = f.source(8, 4, true); f.calls.length = 0;
  for (const invoke of [() => source.context.getImageData(0, 0, 1, 1), () => source.canvas.toDataURL(), () => source.canvas.toBlob(() => {}), () => off.canvas.convertToBlob()]) assert.throws(invoke, error => error.name === 'SecurityError');
  assert.equal(f.calls.filter(row => ['getImageData', 'toDataURL', 'toBlob', 'convertToBlob'].includes(row.name)).length, 0);
});

test('opaque inherited guard denies every covered readback even after a forged public marker', () => {
  const code = readFileSync(new URL('../../apps/production-extension/api-custom-canvas-opaque.entry.js', import.meta.url), 'utf8');
  const context = vm.createContext({ DOMException });
  vm.runInContext(`class HTMLCanvasElement{toDataURL(){return 'raw';}toBlob(){return 'raw';}}class CanvasRenderingContext2D{getImageData(){return 'raw';}}class OffscreenCanvas{convertToBlob(){return 'raw';}}class OffscreenCanvasRenderingContext2D{getImageData(){return 'raw';}}Object.assign(globalThis,{HTMLCanvasElement,CanvasRenderingContext2D,OffscreenCanvas,OffscreenCanvasRenderingContext2D,location:{protocol:'about:'},origin:'null'});Object.defineProperty(globalThis,Symbol.for('detect.expert/api-custom/document/v2'),{value:true});`, context);
  vm.runInContext(code, context);
  for (const expression of ['new HTMLCanvasElement().toDataURL()', 'new HTMLCanvasElement().toBlob()', 'new CanvasRenderingContext2D().getImageData()', 'new OffscreenCanvas().convertToBlob()', 'new OffscreenCanvasRenderingContext2D().getImageData()']) assert.throws(() => vm.runInContext(expression, context), error => error.name === 'SecurityError');
});

// ---------------------------------------------------------------------------------------------
// S1: the session key follows the top-level site (the last Location.ancestorOrigins entry), not only the frame's own origin, so
// one third-party frame embedded on two sites no longer reports one hash. Top-level documents keep their values byte for byte.
// ---------------------------------------------------------------------------------------------
// getImageData digests recorded from the installer BEFORE site scoping existed (default fixture and seed above).
const SITE_GOLDEN_STABLE = { 'https://example.test': 74209137, 'https://top.test': 1535185689, 'https://tracker.test': 978204039, 'null': 3461057827 };
const trips = { count: 0 };
// prepare() hook: a Chromium-shaped Location chain. `location` is an unforgeable accessor and ancestorOrigins a DOMStringList-like
// value (own indexed entries, length on the prototype) whose item()/contains()/iterator/toString/forEach/at are counted tripwires.
function chain(entries, { data = false, length, ownLength, listThrows = false, lengthThrows = false, locationThrows = false, none = false } = {}) {
  return realm => {
    const trap = () => { trips.count++; throw new Error('PAGE_METHOD'); };
    class DOMStringList {
      get length() { if (lengthThrows) throw new Error('LENGTH'); return length === undefined ? entries.length : length; }
      item() { trap(); } contains() { trap(); } toString() { trap(); } forEach() { trap(); } at() { trap(); } [Symbol.iterator]() { trap(); }
    }
    const list = data ? [...entries] : Object.create(DOMStringList.prototype);
    if (!data) { entries.forEach((value, index) => Object.defineProperty(list, index, { value, enumerable: true, writable: true, configurable: true })); realm.DOMStringList = DOMStringList; }
    if (ownLength !== undefined) Object.defineProperty(list, 'length', { value: ownLength, configurable: true });
    const location = {};
    if (!none) Object.defineProperty(location, 'ancestorOrigins', { get() { if (listThrows) throw new Error('LIST'); return list; }, enumerable: true });
    Object.defineProperty(realm, 'location', { get() { if (locationThrows) throw new Error('LOCATION'); return location; }, enumerable: true, configurable: true });
    realm.chainList = list;
  };
}
// sparse-rgb-v1 moves a quarter of an 8x4 canvas, so a larger canvas keeps two different sites from sharing a digest by chance.
const siteDigest = options => stable ? digestOf(fixture(options).source().context.getImageData(0, 0, 8, 4).data) : digestOf(fixture(options).source(60, 40).context.getImageData(0, 0, 60, 40).data);
// Stable pins the values recorded before site scoping existed; sparse is pinned by comparing frames with plain top-level documents.
const SITE_GOLDEN = stable ? SITE_GOLDEN_STABLE : Object.fromEntries(Object.keys(SITE_GOLDEN_STABLE).map(origin => [origin, siteDigest({ origin })]));

test('S1: top-level documents keep their pre-scoping values, with no Location, an empty chain or an opaque origin', () => {
  for (const [origin, digest] of Object.entries(SITE_GOLDEN)) {
    assert.equal(siteDigest({ origin }), digest, origin + ': no location');
    assert.equal(siteDigest({ origin, prepare: chain([]) }), digest, origin + ': empty ancestorOrigins');
  }
});

test('S1: a frame is keyed by the last ancestorOrigins entry (the top-level site), not by its own origin', () => {
  const frame = siteDigest({ origin: 'https://tracker.test', prepare: chain(['https://a.test', 'https://top.test']) });
  assert.equal(frame, SITE_GOLDEN['https://top.test'], 'equals a top-level document at top.test');
  assert.notEqual(frame, SITE_GOLDEN['https://tracker.test']);
  assert.equal(siteDigest({ origin: 'https://top.test', prepare: chain(['https://top.test']) }), SITE_GOLDEN['https://top.test'], 'same-origin frame equals its top');
  assert.equal(siteDigest({ origin: 'https://tracker.test', prepare: chain(['https://top.test']) }), SITE_GOLDEN['https://top.test'], 'direct child of the top');
  // A realm whose list is a plain Array (no DOMStringList.prototype getter) is read through its own length, like a data-property origin.
  assert.equal(siteDigest({ origin: 'https://tracker.test', prepare: chain(['https://a.test', 'https://top.test'], { data: true }) }), SITE_GOLDEN['https://top.test']);
});

test('S1: one frame origin embedded under two tops gets two values, each stable across reinstall; encoders agree with readback', () => {
  const under = top => ({ origin: 'https://tracker.test', prepare: chain([top]) });
  const first = siteDigest(under('https://a.test')), second = siteDigest(under('https://top.test'));
  assert.notEqual(first, second); assert.equal(second, SITE_GOLDEN['https://top.test']);
  assert.equal(siteDigest(under('https://a.test')), first);
  const f = fixture(under('https://top.test')), top = fixture({ origin: 'https://top.test' }), s = f.source(), t = top.source();
  assert.deepEqual(decodeUrl(s.canvas.toDataURL()).data, decodeUrl(t.canvas.toDataURL()).data, 'toDataURL follows the same key as a top-level document');
  assert.deepEqual([...s.context.getImageData(0, 0, 8, 4).data], [...t.context.getImageData(0, 0, 8, 4).data]);
});

test('S1: sandboxed (opaque) frames follow their top; an opaque top or any unusable chain keeps today\'s frame-origin value', async () => {
  assert.equal(siteDigest({ origin: 'null', prepare: chain(['https://top.test']) }), SITE_GOLDEN['https://top.test'], 'opaque frame under a normal top');
  const fallbacks = {
    'opaque top': chain(['https://a.test', 'null']), 'empty entry': chain(['']), 'non-string entry': chain([42]), 'oversized entry': chain(['https://' + 'x'.repeat(520)]),
    'no ancestorOrigins (Firefox, workers)': chain([], { none: true }), 'length is not a number': chain(['https://top.test'], { length: '1' }),
    'fractional length': chain(['https://top.test'], { length: 0.5 }), 'length over the bound': chain(['https://top.test'], { length: 5000 }), 'zero length': chain(['https://top.test'], { length: 0 }),
    'throwing list getter': chain(['https://top.test'], { listThrows: true }), 'throwing length getter': chain(['https://top.test'], { lengthThrows: true }),
    'throwing location getter': chain(['https://top.test'], { locationThrows: true }),
    'location is a primitive': realm => { Object.defineProperty(realm, 'location', { value: 'https://top.test', configurable: true }); },
    'list is a primitive': realm => { Object.defineProperty(realm, 'location', { value: { ancestorOrigins: 'https://top.test' }, configurable: true }); },
  };
  for (const [label, prepare] of Object.entries(fallbacks)) {
    assert.equal(siteDigest({ origin: 'https://tracker.test', prepare }), SITE_GOLDEN['https://tracker.test'], label + ' -> frame origin');
    assert.equal(siteDigest({ origin: 'null', prepare }), SITE_GOLDEN['null'], label + ' with an opaque frame -> today\'s null-origin key');
  }
  // 512 characters is the largest accepted entry.
  const edge = 'https://' + 'y'.repeat(504);
  assert.equal(edge.length, 512);
  assert.equal(siteDigest({ origin: 'https://tracker.test', prepare: chain([edge]) }), siteDigest({ origin: edge }), 'a 512-character top is used');
});

test('S1: a page-planted own length on the list cannot hide the chain (length comes from the DOMStringList.length getter)', () => {
  assert.equal(siteDigest({ origin: 'https://tracker.test', prepare: chain(['https://a.test', 'https://top.test'], { ownLength: 0 }) }), SITE_GOLDEN['https://top.test']);
  assert.equal(siteDigest({ origin: 'https://tracker.test', prepare: chain(['https://a.test', 'https://top.test'], { ownLength: 1 }) }), SITE_GOLDEN['https://top.test']);
});

test('S1: the chain is read once at install through captured accessors; no page-patchable method runs and later edits are ignored', () => {
  trips.count = 0;
  const [w, h] = stable ? [8, 4] : [60, 40];
  const f = fixture({ origin: 'https://tracker.test', prepare: chain(['https://a.test', 'https://top.test']) }), s = f.source(w, h);
  const first = [...s.context.getImageData(0, 0, w, h).data];
  assert.equal(digestOf(first), SITE_GOLDEN['https://top.test']);
  f.realm.chainList[1] = 'https://evil.test'; Object.defineProperty(f.realm.DOMStringList.prototype, 'length', { get() { trips.count++; return 1; } });
  Object.defineProperty(f.realm, 'location', { get() { trips.count++; throw new Error('PAGE'); }, configurable: true });
  assert.deepEqual([...s.context.getImageData(0, 0, w, h).data], first, 'a later page edit cannot rekey a document that is already installed');
  assert.equal(trips.count, 0, 'item/contains/iterator/toString/forEach/at and the edited accessors never ran');
  assert.deepEqual(Object.keys(f.installation), ['snapshot']);
});
}
for (const algorithm of ['stable-rgb-v1', 'sparse-rgb-v1']) defineSuite(algorithm);
