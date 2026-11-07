import { describe, expect, it } from 'vitest';
import { UNBOUND_SENSOR_BOOT_ID, VISUAL_CHANNEL, VISUAL_LIMITS } from '@detect-expert/contracts';
import type { VisualSensorMessage } from '@detect-expert/contracts';
import { SensorRuntime } from '../src/runtime';
import { installVisualCapture } from '../src/visual';
import { installBrowserRequestSensor } from '../src/browser-requests';
import { VisualActivity } from '../src/visual-activity';
import { bridgeHello, deliver, makeEnv } from './helpers';

// A bounded synthetic PNG with an IHDR; no decoder is involved in these routing/lifecycle cases.
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
function setup() {
  const fake = makeEnv(); const runtime = new SensorRuntime(fake.env); const capture = installVisualCapture(runtime);
  const config = (enabled = true, remainingMs = 60_000) => deliver(fake, { channel: VISUAL_CHANNEL, type: 'visual-config', sensorBootId: runtime.sensorBootId, enabled, remainingMs });
  const images = () => fake.posted.filter((value): value is Extract<VisualSensorMessage, { type: 'visual-image' }> =>
    typeof value === 'object' && value !== null && 'type' in value && value.type === 'visual-image');
  return { fake, runtime, capture, config, images };
}

describe('ADR-017 visual lease and bounded passive capture', () => {
  it('captures the requested pixels from a larger destination without adjacent buffer bytes', () => {
    const fixture = setup(); fixture.config();
    const args = function (..._values: unknown[]): IArguments { return arguments; };
    const backing = new Uint8Array([91, 92, 1, 2, 3, 4, 93, 94]);
    const destination = new Uint8Array(backing.buffer, 2, 6);
    fixture.capture.readPixels({}, args(0, 0, 1, 1, 0x1908, 0x1401, destination));
    expect(fixture.images()).toHaveLength(1);
    expect(fixture.images()[0]?.image.data).toBe('AQIDBA==');
    expect(Array.from(backing)).toEqual([91, 92, 1, 2, 3, 4, 93, 94]);
  });

  it('keeps readbacks from different WebGL contexts even when their pixels are identical', () => {
    const fixture = setup(); fixture.config();
    const args = function (..._values: unknown[]): IArguments { return arguments; };
    const firstContext = {}, secondContext = {};
    const pixels = new Uint8Array([1, 2, 3, 4]);
    fixture.capture.readPixels(firstContext, args(0, 0, 1, 1, 0x1908, 0x1401, pixels));
    fixture.capture.readPixels(secondContext, args(0, 0, 1, 1, 0x1908, 0x1401, pixels));
    fixture.fake.advance(250);
    expect(fixture.images()).toHaveLength(2);
    expect(fixture.runtime.snapshot().counters).toEqual([]);
  });

  it('reannounces a lost first hello on bridge startup with four total hellos and one bounded timer', () => {
    const f = setup();
    const hello = bridgeHello(f.runtime, { sensorBootId: UNBOUND_SENSOR_BOOT_ID });
    for (let i = 0; i < 100; i++) deliver(f.fake, hello);
    expect(f.fake.pendingTimers()).toBe(2); // Capture expiry plus one coalesced hello retry.
    f.fake.advance(249); expect(f.fake.posted).toHaveLength(1);
    f.fake.advance(1); expect(f.fake.posted).toHaveLength(2);
    for (let i = 0; i < 10; i++) { deliver(f.fake, hello); f.fake.advance(250); }
    expect(f.fake.posted).toHaveLength(4); expect(f.fake.pendingTimers()).toBe(1);
    const other = setup(); deliver(other.fake, bridgeHello(other.runtime));
    expect(other.fake.pendingTimers()).toBe(2);
    other.runtime.stop('local'); expect(other.fake.pendingTimers()).toBe(0);
  });
  it('queues automatic capture until routed transport authorization; never becomes a report counter', () => {
    const f = setup(); f.capture.dataUrl(png); expect(f.images()).toEqual([]);
    deliver(f.fake, { channel: VISUAL_CHANNEL, type: 'visual-config', sensorBootId: 'a'.repeat(32), enabled: true, remainingMs: 60_000 });
    f.capture.dataUrl(png); expect(f.images()).toEqual([]);
    f.config(true, 60_001); f.capture.dataUrl(png); expect(f.images()).toEqual([]);
    f.config(false, 0); expect(f.images()).toEqual([]);
    f.config(); expect(f.images()).toHaveLength(1); // The sole early read survives a not-ready reply.
    expect(f.runtime.snapshot().counters).toEqual([]);
    expect(JSON.stringify(f.runtime.snapshot())).not.toContain('iVBOR');
  });

  it('duplicate configs neither reset the image budget nor extend the lease', () => {
    const f = setup(); f.config(true, 1000); f.fake.advance(900); f.config(true, 60_000);
    f.fake.advance(101); f.capture.dataUrl(png); expect(f.images()).toEqual([]);
    f.config(); f.capture.dataUrl(png); expect(f.images()).toEqual([]); // Expiry cannot be restarted by a page config.
    const fresh = setup(); fresh.config(); fresh.capture.dataUrl(png); fresh.config(); fresh.capture.dataUrl(png);
    fresh.config(false); fresh.config(); fresh.capture.dataUrl(png); expect(fresh.images()).toHaveLength(1);
  });

  it('pause invalidates the lease across resume; stop removes listener and timer', () => {
    const f = setup(); f.config(); expect(f.fake.pendingTimers()).toBe(1);
    f.runtime.pause(); f.runtime.resume(); f.capture.dataUrl(png); expect(f.images()).toEqual([]);
    f.config(); f.capture.dataUrl(png); expect(f.images()).toEqual([]);
    f.runtime.stop('revoked'); expect(f.fake.listenerCount('message')).toBe(0); expect(f.fake.pendingTimers()).toBe(0);
    f.config(); f.capture.dataUrl(png); expect(f.images()).toEqual([]);
  });

  it('rejects hostile/coercible payloads and oversized PNG headers without spending a capture', () => {
    const f = setup(); f.config(); let gets = 0;
    const hostile = new Proxy({}, { get() { gets++; throw new Error('must not read page properties'); } });
    f.capture.dataUrl(hostile); f.capture.imageData(hostile);
    f.capture.dataUrl('data:image/svg+xml;base64,PHN2Zz4=');
    f.capture.dataUrl('data:image/png;base64,' + 'A'.repeat(524_292));
    const decoded = Buffer.from(png.slice(22), 'base64'); decoded.writeUInt32BE(100_000, 16);
    f.capture.dataUrl('data:image/png;base64,' + decoded.toString('base64'));
    expect(gets).toBe(0); expect(f.images()).toEqual([]);
    f.capture.dataUrl(png); expect(f.images()).toHaveLength(1);
  });

  it('captures supported RGBA byte spans while rejecting exotic and unknown pack modes', () => {
    const f = setup(); f.config();
    const args = function (..._values: unknown[]): IArguments { return arguments; };
    const gl = {};
    f.capture.readPixels(gl, args(0, 0, 1, 1, 0x1908, 0x1401, new Uint8Array([1, 2, 3, 4])));
    f.capture.readPixels(gl, args(0, 0, 1, 1, 0x1908, 0x1401, new Uint8Array([5, 6, 7, 8])));
    f.capture.dataUrl(png); f.fake.advance(250);
    expect(new Set(f.images().map((frame: any) => frame.image.canvas?.id ?? frame.image.kind)).size).toBe(2);
    const fresh = setup(); fresh.config();
    fresh.capture.pixelStore(gl, args(0x0d02, 3)); fresh.capture.pixelStore(gl, args(0x0d02, 0));
    fresh.capture.readPixels(gl, args(0, 0, 1, 1, 0x1908, 0x1401, new Uint8Array(4)));
    fresh.capture.readPixels({}, args(0, 0, 1, 1, 0x1908, 0x1401, new Float32Array(4)));
    fresh.capture.readPixels({}, args(0, 0, 1, 1, 0x1908, 0x1401, new Uint8Array(3)));
    fresh.capture.readPixels({}, args(0, 0, 1, 1, 0x1908, 0x1401, new Uint8Array(4), 1), true);
    fresh.capture.readPixels({}, args(0, 0, 1, 1, 0x1908, 0x1401, new Uint8Array(new SharedArrayBuffer(4))));
    expect(fresh.images()).toEqual([]);
  });

  it('uses WebGL2 destination offsets relative to the view without reading neighboring bytes', () => {
    const fixture = setup(); fixture.config();
    const args = function (..._values: unknown[]): IArguments { return arguments; };
    const backing = new Uint8Array([81, 82, 83, 1, 2, 3, 4, 84, 85]);
    const destination = new Uint8Array(backing.buffer, 1, 7);
    let properties = 0;
    for (const name of ['length', 'buffer', 'byteOffset', 'subarray']) Object.defineProperty(destination, name, {
      get() { properties++; throw new Error('must use native brand getters'); },
    });
    fixture.capture.readPixels({}, args(0, 0, 1, 1, 0x1908, 0x1401, destination, 2), true);
    expect(fixture.images()[0]?.image.data).toBe('AQIDBA==');
    expect(properties).toBe(0);
    expect(Array.from(backing)).toEqual([81, 82, 83, 1, 2, 3, 4, 84, 85]);
  });

  it('ignores a WebGL1 extra argument and treats an omitted WebGL2 offset as zero', () => {
    const fixture = setup(); fixture.config();
    const args = function (..._values: unknown[]): IArguments { return arguments; };
    const destination = new Uint8Array([1, 2, 3, 4, 91, 92]);
    const webgl1 = args(0, 0, 1, 1, 0x1908, 0x1401, destination, 4);
    let reads = 0;
    Object.defineProperty(webgl1, '7', { get() { reads++; throw new Error('WebGL1 ignores this argument'); } });
    fixture.capture.readPixels({}, webgl1);
    fixture.capture.readPixels({}, args(0, 0, 1, 1, 0x1908, 0x1401, destination, undefined), true);
    fixture.fake.advance(250);
    expect(fixture.images()).toHaveLength(2);
    expect(fixture.images().every(frame => frame.image.data === 'AQIDBA==')).toBe(true);
    expect(reads).toBe(0);
  });

  it('rejects invalid or opaque offsets, detached buffers and PBO addresses without coercion', () => {
    const fixture = setup(); fixture.config();
    const args = function (..._values: unknown[]): IArguments { return arguments; };
    let reads = 0;
    const opaque = new Proxy({}, { get() { reads++; throw new Error('opaque offset'); } });
    const destination = new Uint8Array([1, 2, 3, 4]);
    for (const offset of [-1, 0.5, 1, NaN, Infinity, Number.MAX_SAFE_INTEGER, '0', null, opaque]) {
      fixture.capture.readPixels({}, args(0, 0, 1, 1, 0x1908, 0x1401, destination, offset), true);
    }
    fixture.capture.readPixels({}, args(0, 0, 1, 1, 0x1908, 0x1401, 0), true);
    const detached = new Uint8Array(4);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    fixture.capture.readPixels({}, args(0, 0, 1, 1, 0x1908, 0x1401, detached), true);
    expect(fixture.images()).toEqual([]);
    expect(reads).toBe(0);
  });

  it('bounds the pending handshake gallery and clears it on expiry or stop', () => {
    const f = setup(); const args = function (..._values: unknown[]): IArguments { return arguments; };
    const buffer = new Uint8Array([1, 2, 3, 4]);
    for (let i = 0; i < VISUAL_LIMITS.maxImages * 2; i++) {
      f.capture.dataUrl(png); f.capture.readPixels({}, args(0, 0, 1, 1, 0x1908, 0x1401, buffer));
    }
    buffer.fill(255); expect(f.images()).toEqual([]);
    f.config(false, 0); f.config(); expect(f.images()).toHaveLength(VISUAL_LIMITS.maxImages);
    expect(JSON.stringify(f.images())).toContain('AQIDBA==');
    const expired = setup(); expired.capture.dataUrl(png); expired.fake.advance(60_001); expired.config(); expect(expired.images()).toEqual([]);
    const stopped = setup(); stopped.capture.dataUrl(png); stopped.runtime.stop('revoked'); stopped.config(); expect(stopped.images()).toEqual([]);
  });

  it('links 2D and WebGL canvases and records transforms/crops without inspecting object arguments', () => {
    const fixture = setup(); fixture.config();
    const canvas = {}, context = {}, glCanvas = {}, gl = {};
    const args = function (..._values: unknown[]): IArguments { return arguments; };
    let reads = 0;
    const hostile = new Proxy({}, { get() { reads++; throw new Error('opaque argument'); } });
    fixture.capture.context(canvas, context, '2d'); fixture.capture.context(glCanvas, gl, 'webgl2');
    fixture.capture.action(context, 'setTransform', args(hostile));
    fixture.capture.action(context, 'scale', args(1, -1));
    fixture.capture.action(context, 'translate', args(0.5, 0));
    fixture.capture.action(context, 'drawImage', args(glCanvas, 0, 0, 1, 1, 0, 0, 1, 1));
    fixture.capture.action(gl, 'texImage2D', args(0, 0, 0, 0, 0, canvas));
    fixture.capture.dataUrl(png, canvas); fixture.capture.dataUrl(png, glCanvas);
    fixture.fake.advance(250);
    expect(reads).toBe(0);
    expect(fixture.images().map((frame: any) => frame.image.kind)).toEqual(['canvas', 'webgl']);
    expect(fixture.images()[0]?.image.canvas?.operations).toEqual(expect.arrayContaining(['flip-y', 'fractional', 'cropped-copy', 'webgl-to-2d']));
    expect(fixture.images()[1]?.image.canvas?.operations).toEqual(expect.arrayContaining(['texture-upload', '2d-to-webgl']));
    expect(JSON.stringify(fixture.runtime.snapshot())).not.toContain('flip-y');
  });

  it('keeps the first passive pixels and coalesces later action metadata', () => {
    const fixture = setup(); fixture.config(); const canvas = {}, context = {};
    const args = function (..._values: unknown[]): IArguments { return arguments; };
    fixture.capture.context(canvas, context, '2d'); fixture.capture.dataUrl(png, canvas);
    fixture.capture.action(context, 'globalAlpha', args(0.5)); fixture.capture.action(context, 'globalCompositeOperation', args('multiply'));
    fixture.capture.dataUrl(png, canvas); fixture.fake.advance(250);
    expect(fixture.images()).toHaveLength(2);
    expect(fixture.images()[1]?.image.canvas?.operations).toEqual(expect.arrayContaining(['alpha', 'composite', 'repeat-readback']));
    expect(fixture.images()[1]?.image.data).toBe(fixture.images()[0]?.image.data);
  });

  it('does not confuse boolean UNPACK settings with an unsafe readPixels PACK layout', () => {
    const fixture = setup(); fixture.config(); const gl = {};
    const args = function (..._values: unknown[]): IArguments { return arguments; };
    fixture.capture.pixelStore(gl, args(0x9240, true));
    fixture.capture.readPixels(gl, args(0, 0, 1, 1, 0x1908, 0x1401, new Uint8Array([1, 2, 3, 4])));
    expect(fixture.images()).toHaveLength(1);
  });

  it('never reads inherited numeric arguments of the setTransform dictionary or default overload', () => {
    const fixture = setup(); fixture.config(); const canvas = {}, context = {};
    const args = function (..._values: unknown[]): IArguments { return arguments; };
    const empty = args(), dictionary = args({});
    fixture.capture.context(canvas, context, '2d');
    let reads = 0;
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, '1');
    Object.defineProperty(Object.prototype, '1', { configurable: true, get() { reads++; throw new Error('inherited numeric argument'); } });
    try { fixture.capture.action(context, 'setTransform', empty); fixture.capture.action(context, 'setTransform', dictionary); }
    finally { if (previous) Object.defineProperty(Object.prototype, '1', previous); else Reflect.deleteProperty(Object.prototype, '1'); }
    expect(reads).toBe(0);
  });

  it('flushes a second canvas captured just before the deadline without extending capture', () => {
    const fixture = setup(); fixture.config();
    fixture.capture.dataUrl(png, {});
    fixture.fake.advance(59_900);
    fixture.capture.dataUrl(png, {});
    expect(fixture.images()).toHaveLength(2);
    fixture.fake.advance(101); fixture.capture.dataUrl(png, {});
    expect(fixture.images()).toHaveLength(2);
  });

  it('records an inline SVG source through the existing src owner without retaining its text', () => {
    const fixture = setup(); fixture.config();
    class ImageFixture { set src(_value: unknown) {} }
    installBrowserRequestSensor(fixture.runtime, { HTMLImageElement: ImageFixture });
    const image = new ImageFixture(), canvas = {}, context = {};
    const args = function (..._values: unknown[]): IArguments { return arguments; };
    const privateSvg = 'data:image/svg+xml,' + encodeURIComponent('<svg>PRIVATE_SVG_SOURCE</svg>');
    image.src = privateSvg;
    fixture.capture.context(canvas, context, '2d');
    fixture.capture.action(context, 'drawImage', args(image, 0, 0)); fixture.capture.dataUrl(png, canvas);
    expect(fixture.images()[0]?.image.canvas?.operations).toContain('svg-source');
    expect(JSON.stringify(fixture.images())).not.toContain('PRIVATE_SVG_SOURCE');
    image.src = { toString() { throw new Error('observer must not coerce'); } };
    const next = {}, nextContext = {};
    fixture.capture.context(next, nextContext, '2d'); fixture.capture.action(nextContext, 'drawImage', args(image, 0, 0));
    fixture.capture.dataUrl(png, next); fixture.fake.advance(250);
    expect(fixture.images().at(-1)?.image.canvas?.operations).not.toContain('svg-source');
    fixture.runtime.stop('local');
  });

  it('coalesces hot readback metadata without a callback per call', () => {
    let updates = 0;
    const activity = new VisualActivity('boot-' + 'a'.repeat(24), record => { updates++; record.queued = true; }, () => undefined);
    const canvas = {}, context = {};
    activity.context(canvas, context, '2d');
    const record = activity.readback(context, '2d', 1)!;
    record.image = { kind: 'canvas', source: 'getImageData', format: 'rgba', width: 1, height: 1, data: 'AQIDBA==' };
    for (let index = 0; index < 10000; index++) activity.readback(context, '2d', 1);
    expect(updates).toBe(1);
    expect(record.readbacks).toBe(10001);
  });

  it('marks an unsent drain tail when the capture deadline passes during transport', () => {
    const fake = makeEnv();
    let reads = 0, draining = false;
    const runtime = new SensorRuntime({ ...fake.env, now: () => draining ? (++reads <= 4 ? 60999 : 61001) : 1000 });
    const capture = installVisualCapture(runtime);
    capture.dataUrl(png, {}); capture.dataUrl(png, {});
    draining = true;
    deliver(fake, { channel: VISUAL_CHANNEL, type: 'visual-config', sensorBootId: runtime.sensorBootId, enabled: true, remainingMs: 60000 });
    expect(fake.posted.some(value => typeof value === 'object' && value !== null && 'type' in value && value.type === 'visual-limited')).toBe(true);
    runtime.stop('local');
  });

  it('links an ordinary transferControlToOffscreen return without requiring a Worker', () => {
    const fixture = setup(); fixture.config();
    const canvas = {}, offscreen = {}, context = {};
    fixture.capture.offscreen(canvas, offscreen);
    fixture.capture.context(offscreen, context, '2d');
    fixture.capture.dataUrl(png, offscreen);
    expect(fixture.images()[0]?.image.canvas?.operations).toContain('offscreen-transfer');
    expect(fixture.images()[0]?.image.canvas?.renderer).toBe('2d');
  });

  it('rejects a full RGBA budget before touching the pixel argument and never retries that object', () => {
    const fixture = setup();
    const args = function (..._values: unknown[]): IArguments { return arguments; };
    const pixels = new Uint8Array(4 * VISUAL_LIMITS.maxPixels);
    const encodedLength = Math.ceil(pixels.length / 3) * 4;
    const capacity = Math.floor(VISUAL_LIMITS.maxTotalBase64Chars / encodedLength);
    for (let index = 0; index < capacity; index++) fixture.capture.readPixels({}, args(0, 0, 256, 256, 0x1908, 0x1401, pixels));
    let reads = 0;
    const full = args(0, 0, 256, 256, 0x1908, 0x1401, pixels), receiver = {};
    Object.defineProperty(full, '6', { get() { reads++; throw new Error('budget must short-circuit first'); } });
    for (let index = 0; index < 1000; index++) fixture.capture.readPixels(receiver, full);
    expect(reads).toBe(0);
    fixture.config();
    expect(fixture.images()).toHaveLength(capacity);
    expect(fixture.fake.posted.some(value => typeof value === 'object' && value !== null && 'type' in value && value.type === 'visual-limited')).toBe(true);
  });
});
