import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VISUAL_CHANNEL, VISUAL_CACHE_IDLE_MS, VISUAL_LIMITS } from '@detect-expert/contracts';
import type { BridgeVisualControl, VisualConfigMessage, VisualPageRequest, VisualCacheState } from '@detect-expert/contracts';
import { startVisualBridge } from '../src/visual';
import type { VisualBridgeEnv } from '../src/visual';
import { FakeEnv } from './fake-env';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const boot = 'boot-' + 'a'.repeat(24);
const hello = { channel: VISUAL_CHANNEL, type: 'visual-hello', sensorBootId: boot };
const canvas = { channel: VISUAL_CHANNEL, type: 'visual-image', sensorBootId: boot, image: { kind: 'canvas', source: 'getImageData', format: 'rgba', width: 1, height: 1, data: 'AQIDBA==' } };
const webgl = { ...canvas, image: { ...canvas.image, kind: 'webgl', source: 'readPixels' } };
const config = (enabled: boolean, remainingMs = 60_000): BridgeVisualControl => ({ schemaVersion: 1, type: 'visual-control', enabled, remainingMs: enabled ? remainingMs : 0 });
function setup(response: (request: VisualPageRequest) => Promise<unknown> = async () => config(false)) {
  const base = new FakeEnv();
  const posted: VisualConfigMessage[] = [];
  const sent: VisualPageRequest[] = [];
  let cacheRequest!: (fromExtension: boolean, raw: unknown) => VisualCacheState | null;
  const env: VisualBridgeEnv = {
    onWindowMessage: base.onWindowMessage.bind(base), onControlMessage: base.onControlMessage.bind(base),
    onPageHide: base.onPageHide.bind(base), onPageShow: base.onPageShow.bind(base),
    setTimer: base.setTimer.bind(base), clearTimer: base.clearTimer.bind(base), now: base.now.bind(base),
    isContextAlive: base.isContextAlive.bind(base),
    postToPage: message => { posted.push(message); base.emit(message); },
    sendToBackground: async request => { sent.push(request); return response(request); },
    onCacheRequest: listener => { cacheRequest = listener; },
  };
  startVisualBridge(env);
  return { base, posted, sent, cacheRequest: (raw: unknown, fromExtension = true) => cacheRequest(fromExtension, raw) };
}
describe('ADR-017 isolated preview consent boundary', () => {
  it('never forwards pixels by default or following page-forged enable controls', async () => {
    const h = setup(); await vi.advanceTimersByTimeAsync(0);
    h.base.emit(hello);
    h.base.emit({ channel: VISUAL_CHANNEL, type: 'visual-config', sensorBootId: boot, enabled: true, remainingMs: 60_000 });
    h.base.control(config(true), false);
    for (let i = 0; i < 1000; i++) h.base.emit(canvas);
    expect(h.sent).toEqual([{ schemaVersion: 1, type: 'visual-ready' }]);
    expect(h.posted.at(-1)?.enabled).toBe(false);
  });
  it('requires current-world known sensor routing, allows both image kinds and bounds flood/in-flight work', async () => {
    const h = setup(async request => request.type === 'visual-ready' ? config(true) : new Promise(() => undefined));
    await vi.advanceTimersByTimeAsync(0);
    h.base.emit(canvas); h.base.emit(hello, false); h.base.emit(canvas);
    expect(h.sent).toHaveLength(1);
    h.base.emit(hello); h.base.emit(canvas); h.base.emit(webgl);
    for (let i = 0; i < 1000; i++) { h.base.emit(canvas); h.base.emit(webgl); }
    await vi.advanceTimersByTimeAsync(2000);
    h.base.emit(canvas); h.base.emit(webgl);
    expect(h.sent.filter(r => r.type === 'visual-frame')).toHaveLength(2);
  });
  it('expires its own lease even if MAIN continues sending images', async () => {
    const h = setup(async () => config(true, 1000)); await vi.advanceTimersByTimeAsync(0);
    h.base.emit(hello); await vi.advanceTimersByTimeAsync(1001); h.base.emit(canvas);
    expect(h.sent.filter(request => request.type === 'visual-frame')).toHaveLength(0);
    expect(h.sent.filter(request => request.type === 'visual-limited')).toHaveLength(1);
  });
  it('ignores a delayed enable response after trusted disable or terminal stop', async () => {
    let answer!: (value: unknown) => void;
    const h = setup(() => new Promise(resolve => { answer = resolve; }));
    h.base.emit(hello); h.base.control(config(false)); answer(config(true));
    await vi.advanceTimersByTimeAsync(0); h.base.emit(canvas);
    expect(h.sent).toHaveLength(1);
    h.base.control({ schemaVersion: 1, type: 'bridge-control', command: 'stop' });
    h.base.control(config(true)); h.base.emit(canvas);
    expect(h.posted.at(-1)?.enabled).toBe(false);
    expect(h.sent).toHaveLength(1);
  });
  it('trusted pause/pagehide disables capture and malformed large image does not reach SW', async () => {
    const h = setup(async () => config(true)); await vi.advanceTimersByTimeAsync(0);
    h.base.emit(hello); h.base.emit({ ...canvas, image: { ...canvas.image, width: 100000 } });
    expect(h.sent).toHaveLength(1);
    h.base.control({ schemaVersion: 1, type: 'bridge-control', command: 'pause' }); h.base.emit(canvas);
    expect(h.sent).toHaveLength(1);
    h.base.control(config(true)); h.base.pagehide(false); h.base.emit(canvas);
    expect(h.sent).toHaveLength(1);
  });
  it('bounds hello routes and configuration echo under a page flood', async () => {
    const h = setup(); await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 1000; i++) h.base.emit({ ...hello, sensorBootId: 'boot-' + i.toString(16).padStart(24, '0') });
    expect(h.posted).toHaveLength(4);
    expect(h.sent).toHaveLength(1);
  });
});

const token = 'c'.repeat(32);
const cacheRead = (cacheToken = token) => ({ schemaVersion: 1, type: 'visual-cache-read', cacheToken });
const retainedAck = (cacheToken = token) => ({ schemaVersion: 1, type: 'visual-frame-ack', accepted: true, cacheToken, remainingMs: VISUAL_CACHE_IDLE_MS });
async function retaining() {
  const h = setup(async request => request.type === 'visual-ready' ? config(true) : retainedAck());
  await vi.advanceTimersByTimeAsync(0); h.base.emit(hello); h.base.emit(canvas); h.base.emit(webgl);
  await vi.advanceTimersByTimeAsync(0);
  return h;
}
describe('renderer-memory preview recovery', () => {
  it('accepts metadata-only updates when the retained pixel budget is nearly full', async () => {
    const fixture = setup(async request => request.type === 'visual-ready' ? config(true) : retainedAck());
    await vi.advanceTimersByTimeAsync(0); fixture.base.emit(hello);
    const data = Buffer.alloc(4 * VISUAL_LIMITS.maxPixels).toString('base64');
    const count = Math.floor(VISUAL_LIMITS.maxTotalBase64Chars / data.length);
    for (let index = 1; index <= count; index++) {
      fixture.base.emit({ ...canvas, image: { ...canvas.image, width: 256, height: 256, data,
        canvas: { id: boot + ':' + index, renderer: '2d', operations: [], readbacks: 1 } } });
      await vi.advanceTimersByTimeAsync(0);
    }
    fixture.base.emit({ ...canvas, image: { ...canvas.image, width: 256, height: 256, data,
      canvas: { id: boot + ':1', renderer: '2d', operations: ['flip-y'], readbacks: 1 } } });
    await vi.advanceTimersByTimeAsync(0);
    const response = fixture.cacheRequest(cacheRead());
    expect(response?.images).toHaveLength(count);
    expect(response?.images[0]?.canvas?.operations).toContain('flip-y');
    expect(response?.truncated).not.toBe(true);
  });
  it('keeps new operation metadata at the same or saturated readback count without replacing first pixels', async () => {
    const fixture = setup(async request => request.type === 'visual-ready' ? config(true) : retainedAck());
    await vi.advanceTimersByTimeAsync(0); fixture.base.emit(hello);
    const metadata = { id: boot + ':1', renderer: '2d', operations: [], readbacks: VISUAL_LIMITS.maxReadbacks };
    fixture.base.emit({ ...canvas, image: { ...canvas.image, canvas: metadata } });
    await vi.advanceTimersByTimeAsync(0);
    fixture.base.emit({ ...canvas, image: { ...canvas.image, data: 'BQYHCA==', canvas: { ...metadata, operations: ['flip-y'] } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.cacheRequest(cacheRead())?.images[0]).toMatchObject({ data: canvas.image.data, canvas: { operations: ['flip-y'], readbacks: VISUAL_LIMITS.maxReadbacks } });
  });
  it('discards queued frames before a later enable and ignores the old pending ACKs', async () => {
    const replies: Array<(value: unknown) => void> = [];
    const fixture = setup(async request => request.type === 'visual-ready' ? config(true) : new Promise(resolve => replies.push(resolve)));
    await vi.advanceTimersByTimeAsync(0); fixture.base.emit(hello);
    for (let index = 1; index <= 3; index++) fixture.base.emit({ ...canvas, image: { ...canvas.image,
      canvas: { id: boot + ':' + index, renderer: '2d', operations: [], readbacks: 1 } } });
    expect(replies).toHaveLength(2);
    fixture.base.control(config(false)); fixture.base.control(config(true));
    for (const reply of replies) reply(retainedAck());
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.sent.filter(request => request.type === 'visual-frame')).toHaveLength(2);
    expect(fixture.cacheRequest(cacheRead())).toBeNull();
  });

  it('delivers a burst of distinct canvases without the old one-per-kind throttle', async () => {
    const fixture = setup(async request => request.type === 'visual-ready' ? config(true) : retainedAck());
    await vi.advanceTimersByTimeAsync(0); fixture.base.emit(hello);
    for (let index = 1; index <= 30; index++) fixture.base.emit({ ...canvas, image: { ...canvas.image,
      canvas: { id: boot + ':' + index, renderer: '2d', operations: ['cropped-copy'], readbacks: 1 } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.sent.filter(request => request.type === 'visual-frame')).toHaveLength(30);
    expect(fixture.cacheRequest(cacheRead())?.images).toHaveLength(30);
    expect(fixture.cacheRequest(cacheRead())?.truncated).toBeUndefined();
  });
  it('bounds queued identities and preserves a visible loss marker with the acknowledged gallery', async () => {
    const fixture = setup(async request => request.type === 'visual-ready' ? config(true) : retainedAck());
    await vi.advanceTimersByTimeAsync(0); fixture.base.emit(hello);
    for (let index = 1; index <= VISUAL_LIMITS.maxImages; index++) fixture.base.emit({ ...canvas, image: { ...canvas.image,
      canvas: { id: boot + ':' + index, renderer: '2d', operations: [], readbacks: 1 } } });
    const otherBoot = 'boot-' + 'b'.repeat(24);
    fixture.base.emit({ ...hello, sensorBootId: otherBoot });
    fixture.base.emit({ ...canvas, sensorBootId: otherBoot, image: { ...canvas.image,
      canvas: { id: otherBoot + ':1', renderer: '2d', operations: [], readbacks: 1 } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.cacheRequest(cacheRead())?.images).toHaveLength(VISUAL_LIMITS.maxImages);
    expect(fixture.cacheRequest(cacheRead())?.truncated).toBe(true);
    expect(fixture.sent.filter(request => request.type === 'visual-limited')).toHaveLength(1);
  });
  it('coalesces newer metadata for a pending canvas and rejects unrelated boot identities', async () => {
    const fixture = setup(async request => request.type === 'visual-ready' ? config(true) : retainedAck());
    await vi.advanceTimersByTimeAsync(0); fixture.base.emit(hello);
    const metadata = { id: boot + ':1', renderer: '2d', operations: [], readbacks: 1 };
    fixture.base.emit({ ...canvas, image: { ...canvas.image, canvas: metadata } });
    fixture.base.emit({ ...canvas, image: { ...canvas.image, canvas: { ...metadata, readbacks: 2, operations: ['flip-y'] } } });
    fixture.base.emit({ ...canvas, image: { ...canvas.image, canvas: { ...metadata, readbacks: 3, operations: ['flip-y', 'repeat-readback'] } } });
    fixture.base.emit({ ...canvas, image: { ...canvas.image, canvas: { ...metadata, id: 'boot-' + 'b'.repeat(24) + ':1' } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.cacheRequest(cacheRead())?.images).toHaveLength(1);
    expect(fixture.cacheRequest(cacheRead())?.images[0]?.canvas?.readbacks).toBe(3);
    expect(fixture.sent.filter(request => request.type === 'visual-frame')).toHaveLength(2);
  });

  it('returns only acknowledged copies to the trusted matching owner after capture expiry, without replay to MAIN', async () => {
    const h = await retaining(); const posted = h.posted.length;
    await vi.advanceTimersByTimeAsync(65_000);
    expect(h.cacheRequest(cacheRead())).toEqual({ schemaVersion: 1, type: 'visual-cache-state', cacheToken: token, images: [canvas.image, webgl.image] });
    expect(h.posted).toHaveLength(posted);
    expect(h.sent).toHaveLength(3);
    expect(JSON.stringify(h.posted)).not.toContain(token);
    expect(JSON.stringify(h.posted)).not.toContain(canvas.image.data);
    expect(h.cacheRequest(cacheRead(), false)).toBeNull();
    expect(h.cacheRequest(cacheRead('a'.repeat(32)))).toBeNull();
    expect(h.cacheRequest({ ...cacheRead(), tabId: 7 })).toBeNull();
    h.base.alive = false; expect(h.cacheRequest(cacheRead())).toBeNull();
  });
  it('pending/unacknowledged frames cannot be read; an early miss does not cancel their later ACK', async () => {
    let answer!: (value: unknown) => void;
    const h = setup(async request => request.type === 'visual-ready' ? config(true) : new Promise(resolve => { answer = resolve; }));
    await vi.advanceTimersByTimeAsync(0); h.base.emit(hello); h.base.emit(canvas);
    expect(h.cacheRequest(cacheRead())).toBeNull(); answer(retainedAck());
    await vi.advanceTimersByTimeAsync(0);
    expect(h.cacheRequest(cacheRead())?.images).toEqual([canvas.image]);
  });
  it('keeps first accepted copies under later page floods, without retaining a third kind', async () => {
    const h = await retaining(); await vi.advanceTimersByTimeAsync(1001);
    h.base.emit({ ...canvas, image: { ...canvas.image, data: 'BQYHCA==' } });
    h.base.emit({ ...canvas, image: { ...canvas.image, kind: 'audio' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.cacheRequest(cacheRead())?.images).toEqual([canvas.image, webgl.image]);
  });
  for (const action of ['pause', 'stop', 'discard', 'pagehide'] as const) it(action + ' immediately clears copies and old owners cannot recover after resume', async () => {
    const h = await retaining();
    if (action === 'pagehide') h.base.pagehide(true);
    else h.base.control(action === 'discard' ? config(false) : { schemaVersion: 1, type: 'bridge-control', command: action });
    expect(h.cacheRequest(cacheRead())).toBeNull();
    h.base.control(config(true)); expect(h.cacheRequest(cacheRead())).toBeNull();
  });
  it('late ACK after trusted discard cannot restore a cleared copy', async () => {
    let answer!: (value: unknown) => void;
    const h = setup(async request => request.type === 'visual-ready' ? config(true) : new Promise(resolve => { answer = resolve; }));
    await vi.advanceTimersByTimeAsync(0); h.base.emit(hello); h.base.emit(canvas);
    h.base.control(config(false)); answer(retainedAck()); await vi.advanceTimersByTimeAsync(0);
    expect(h.cacheRequest(cacheRead())).toBeNull();
  });
  it('expires after ten idle minutes; trusted touch prolongs recovery without reopening capture', async () => {
    const idle = await retaining(); await vi.advanceTimersByTimeAsync(VISUAL_CACHE_IDLE_MS);
    expect(idle.cacheRequest(cacheRead())).toBeNull();
    const active = await retaining(); const posted = active.posted.length;
    await vi.advanceTimersByTimeAsync(VISUAL_CACHE_IDLE_MS - 1000);
    expect(active.cacheRequest({ ...cacheRead(), type: 'visual-cache-touch' })).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(active.cacheRequest(cacheRead())?.images).toHaveLength(2);
    active.base.emit(canvas); await vi.advanceTimersByTimeAsync(0);
    expect(active.sent.filter(request => request.type === 'visual-frame')).toHaveLength(2);
    expect(active.sent.filter(request => request.type === 'visual-limited')).toHaveLength(1);
    expect(active.posted).toHaveLength(posted);
  });
  it('transient transport failure does not erase already acknowledged renderer copies', async () => {
    let fail = false;
    const h = setup(async request => { if (fail) throw new Error('worker restarting'); return request.type === 'visual-ready' ? config(true) : retainedAck(); });
    await vi.advanceTimersByTimeAsync(0); h.base.emit(hello); h.base.emit(canvas); await vi.advanceTimersByTimeAsync(0);
    fail = true; h.base.emit(webgl); await vi.advanceTimersByTimeAsync(0);
    expect(h.cacheRequest(cacheRead())?.images).toEqual([canvas.image]);
  });
});
