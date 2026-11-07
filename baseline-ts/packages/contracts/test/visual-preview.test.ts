import { describe, expect, it } from 'vitest';
import { retainVisualImage, validateVisualImages, visualImageKey } from '../src/visual-preview';
import type { VisualImage } from '../src/visual-preview';
import { VISUAL_CHANNEL, VISUAL_LIMITS, VISUAL_CACHE_IDLE_MS, validateVisualConfigMessage, validateVisualImage, validateVisualPageRequest, validateVisualSensorMessage, validateVisualUiRequest, validateVisualFrameAck, validateVisualCacheRequest, validateVisualCacheState } from '../src/index';

const image = { kind: 'canvas', source: 'getImageData', format: 'rgba', width: 1, height: 1, data: 'AQIDBA==' };
describe('ADR-017 separate visual contracts', () => {
  it('keeps separate canvas identities with equal pixels and bounded operation metadata', () => {
    const first = { ...image, canvas: { id: 'boot-' + 'a'.repeat(24) + ':1', renderer: '2d', operations: ['cropped-copy', 'flip-y'], readbacks: 1 } };
    const second = { ...first, canvas: { ...first.canvas, id: 'boot-' + 'a'.repeat(24) + ':2' } };
    expect(validateVisualImages([first, second]).ok).toBe(true);
    expect(validateVisualImages([first, first]).ok).toBe(false);
    for (const canvas of [{ ...first.canvas, id: 'boot-' + 'a'.repeat(24) + ':513' }, { ...first.canvas, renderer: 'cpu' },
      { ...first.canvas, operations: ['fingerprinting-proven'] }, { ...first.canvas, operations: ['flip-y', 'flip-y'] },
      { ...first.canvas, readbacks: 0 }, { ...first.canvas, coordinates: [1, 2] }]) expect(validateVisualImage({ ...first, canvas }).ok).toBe(false);
    let calls = 0;
    expect(validateVisualImage({ ...first, canvas: { ...first.canvas, get operations() { calls++; return []; } } }).ok).toBe(false);
    const sparse = new Array(1);
    Object.defineProperty(sparse, 0, { get() { calls++; return first; } });
    expect(validateVisualImages(sparse).ok).toBe(false);
    expect(calls).toBe(0);
  });
  it('bounds gallery bytes, preserves old entries on overflow and ignores replayed older readbacks', () => {
    const parsed = validateVisualImage({ ...image, canvas: { id: 'boot-' + 'a'.repeat(24) + ':1', renderer: '2d', operations: [], readbacks: 1 } });
    expect(parsed.ok).toBe(true); if (!parsed.ok) return;
    const images = new Map<string, VisualImage>();
    expect(retainVisualImage(images, parsed.value)).toBe(true);
    const newer = { ...parsed.value, canvas: { ...parsed.value.canvas!, readbacks: 2 } };
    expect(retainVisualImage(images, newer)).toBe(true);
    expect(retainVisualImage(images, parsed.value)).toBe(true);
    expect(images.get(visualImageKey(newer))?.canvas?.readbacks).toBe(2);
    const large = { ...parsed.value, width: 256, height: 256, data: Buffer.alloc(4 * VISUAL_LIMITS.maxPixels).toString('base64') };
    const capacity = Math.floor(VISUAL_LIMITS.maxTotalBase64Chars / large.data.length);
    const frames = Array.from({ length: capacity + 1 }, (_, index) => ({ ...large, canvas: { ...large.canvas!, id: 'boot-' + 'a'.repeat(24) + ':' + (index + 1) } }));
    expect(validateVisualImages(frames).ok).toBe(false);
    const limited = new Map<string, VisualImage>();
    for (const frame of frames.slice(0, capacity)) expect(retainVisualImage(limited, frame)).toBe(true);
    expect(retainVisualImage(limited, frames[capacity]!)).toBe(false);
    expect(limited.size).toBe(capacity);
    expect(validateVisualPageRequest({ schemaVersion: 1, type: 'visual-limited' }).ok).toBe(true);
  });
  it('accepts tightly packed RGBA and rejects inconsistent sizes/formats and extra identities', () => {
    expect(validateVisualImage(image).ok).toBe(true);
    for (const bad of [{ ...image, width: 2 }, { ...image, kind: 'webgl' }, { ...image, format: 'svg' }, { ...image, data: 'data:image/png;base64,AQIDBA==' }, { ...image, tabId: 1 }, { ...image, width: 0 }, { ...image, data: 'AQIDBA=!' }]) expect(validateVisualImage(bad).ok).toBe(false);
  });
  it('admits the exact largest RGBA payload and rejects larger input before decoding', () => {
    expect(validateVisualImage({ ...image, width: 256, height: 256, data: Buffer.alloc(4 * VISUAL_LIMITS.maxPixels).toString('base64') }).ok).toBe(true);
    expect(validateVisualImage({ ...image, data: 'A'.repeat(VISUAL_LIMITS.maxBase64Chars + 4) }).ok).toBe(false);
  });
  it('checks PNG IHDR dimensions independently of page-supplied dimensions', () => {
    const bytes = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12); bytes.writeUInt32BE(1, 16); bytes.writeUInt32BE(1, 20);
    const png = { ...image, source: 'toDataURL', format: 'png', data: bytes.toString('base64') };
    expect(validateVisualImage(png).ok).toBe(true);
    bytes.writeUInt32BE(100_000, 16);
    expect(validateVisualImage({ ...png, data: bytes.toString('base64') }).ok).toBe(false);
    expect(validateVisualImage({ ...png, data: Buffer.alloc(33).toString('base64') }).ok).toBe(false);
  });
  it('does not call accessor payloads, including nested image getters', () => {
    let called = 0;
    const hostile = { ...image, get data() { called++; return image.data; } };
    expect(validateVisualImage(hostile).ok).toBe(false);
    expect(validateVisualPageRequest({ schemaVersion: 1, type: 'visual-frame', get image() { called++; return image; } }).ok).toBe(false);
    expect(called).toBe(0);
  });
  it('keeps sender identities and UI authority out of the page envelope', () => {
    expect(validateVisualPageRequest({ schemaVersion: 1, type: 'visual-frame', image }).ok).toBe(true);
    expect(validateVisualPageRequest({ schemaVersion: 1, type: 'visual-ready' }).ok).toBe(true);
    expect(validateVisualPageRequest({ schemaVersion: 1, type: 'visual-ready', documentKey: 'forged' }).ok).toBe(false);
    expect(validateVisualPageRequest({ schemaVersion: 1, type: 'ui-visual-set', tabId: 1, documentKey: '1:0:x', enabled: true, reportRevision: 1 }).ok).toBe(false);
  });
  it('requires exact privileged request shape and bounded lease control', () => {
    expect(validateVisualUiRequest({ schemaVersion: 1, type: 'ui-visual-set', tabId: 1, documentKey: '1:0:x', reportRevision: 1, enabled: true }).ok).toBe(true);
    expect(validateVisualUiRequest({ schemaVersion: 1, type: 'ui-visual-get', tabId: -1, documentKey: '1:0:x' }).ok).toBe(false);
    const config = { channel: VISUAL_CHANNEL, type: 'visual-config', sensorBootId: 'boot-' + 'a'.repeat(24), enabled: true, remainingMs: 60_000 };
    expect(validateVisualConfigMessage(config).ok).toBe(true);
    expect(validateVisualConfigMessage({ ...config, remainingMs: 60_001 }).ok).toBe(false);
    expect(validateVisualSensorMessage({ channel: VISUAL_CHANNEL, type: 'visual-image', sensorBootId: 'boot-' + 'a'.repeat(24), image }).ok).toBe(true);
    expect(validateVisualSensorMessage(config).ok).toBe(false);
  });
  it('separates recovery tokens and retention deadlines from page and capture controls', () => {
    const ack = { schemaVersion: 1, type: 'visual-frame-ack', accepted: true, cacheToken: 'a'.repeat(32), remainingMs: VISUAL_CACHE_IDLE_MS };
    expect(validateVisualFrameAck(ack).ok).toBe(true);
    expect(validateVisualFrameAck({ ...ack, accepted: false, cacheToken: null, remainingMs: 0 }).ok).toBe(true);
    for (const bad of [{ ...ack, remainingMs: VISUAL_CACHE_IDLE_MS + 1 }, { ...ack, remainingMs: 0 }, { ...ack, cacheToken: '' },
      { ...ack, cacheToken: null }, { ...ack, accepted: false }, { ...ack, documentKey: '7:0:x' }]) expect(validateVisualFrameAck(bad).ok).toBe(false);
    for (const type of ['visual-cache-read', 'visual-cache-touch'] as const) {
      const request = { schemaVersion: 1, type, cacheToken: ack.cacheToken };
      expect(validateVisualCacheRequest(request).ok).toBe(true);
      expect(validateVisualPageRequest(request).ok).toBe(false);
      expect(validateVisualSensorMessage({ ...request, channel: VISUAL_CHANNEL, sensorBootId: 'boot-' + 'a'.repeat(24) }).ok).toBe(false);
      expect(validateVisualCacheRequest({ ...request, tabId: 7 }).ok).toBe(false);
      expect(validateVisualCacheRequest({ ...request, cacheToken: 'a'.repeat(33) }).ok).toBe(false);
    }
  });
  it('recovery replies cannot carry extra fields, duplicate kinds or oversized pixels', () => {
    const response = { schemaVersion: 1, type: 'visual-cache-state', cacheToken: 'a'.repeat(32), images: [image] };
    expect(validateVisualCacheState(response).ok).toBe(true);
    expect(validateVisualCacheState({ ...response, images: [] }).ok).toBe(true);
    for (const bad of [{ ...response, images: [image, image] }, { ...response, images: [image, image, image] },
      { ...response, images: [{ ...image, width: 2000 }] }, { ...response, cacheToken: null }, { ...response, host: 'example.com' }]) expect(validateVisualCacheState(bad).ok).toBe(false);
    let calls = 0;
    expect(validateVisualCacheState({ ...response, get images() { calls++; return [image]; } }).ok).toBe(false);
    expect(validateVisualFrameAck({ get schemaVersion() { calls++; return 1; } }).ok).toBe(false);
    expect(validateVisualCacheRequest({ schemaVersion: 1, type: 'visual-cache-read', get cacheToken() { calls++; return response.cacheToken; } }).ok).toBe(false);
    expect(calls).toBe(0);
  });
});
