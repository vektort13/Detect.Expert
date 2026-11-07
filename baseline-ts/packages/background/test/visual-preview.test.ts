import { afterEach, describe, expect, it, vi } from 'vitest';
import { VISUAL_LIMITS } from '@detect-expert/contracts';
import type { VisualImage } from '@detect-expert/contracts';
import { createBackground, route } from '../src/index';
import type { Background, FrameDetailsLike, MessageSenderLike } from '../src/index';
import { MAX_VISUAL_DOCUMENTS, VISUAL_IDLE_MS, VISUAL_OWNER_KEY, VISUAL_READ_TIMEOUT_MS } from '../src/visual-preview';
import { committed, createFakeChrome, pageSender, uiSender } from './fake-chrome';

const TOP = 'visualtop';
const CHILD = 'visualchild';
const key = (id = TOP, frameId = 0) => '7:' + frameId + ':' + id;
const image: VisualImage = { kind: 'canvas', source: 'getImageData', format: 'rgba', width: 1, height: 1, data: 'AQIDBA==' };
const webgl: VisualImage = { ...image, kind: 'webgl', source: 'readPixels' };
const instances: Background[] = [];
afterEach(() => { for (const bg of instances) bg.runtime.stop(); instances.length = 0; vi.useRealTimers(); });
const frame = (id = TOP, frameId = 0, url = 'https://example.com/page'): FrameDetailsLike => ({ frameId, documentId: id,
  documentLifecycle: 'active', frameType: frameId === 0 ? 'outermost_frame' : 'sub_frame', url,
  ...(frameId === 0 ? {} : { parentDocumentId: TOP, parentFrameId: 0 }) });
const sender = (id = TOP, frameId = 0, over: Partial<MessageSenderLike> = {}) => pageSender({ documentId: id, frameId, documentLifecycle: 'active', ...over });
async function setup(withChild = false) {
  const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
  fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
  const clock = { t: 1000, now() { return this.t; } };
  const bg = createBackground(fake, { ttlIntervalMs: 0, clock });
  instances.push(bg);
  await bg.start();
  fake.framesByTab.set(7, [frame(), ...(withChild ? [frame(CHILD, 2, 'about:blank')] : [])]);
  fake.tabList = [{ id: 7 }];
  bg.navigation.onCommitted(committed({ documentId: TOP }));
  if (withChild) bg.navigation.onCommitted(committed({ documentId: CHILD, frameId: 2, frameType: 'sub_frame', parentDocumentId: TOP, parentFrameId: 0, url: 'about:blank' }));
  const send = (message: unknown, from = sender()) => route(bg.runtime, message, from);
  const get = (id = TOP, frameId = 0) => send({ schemaVersion: 1, type: 'ui-visual-get', tabId: 7, documentKey: key(id, frameId) }, uiSender());
  const enable = (id = TOP, frameId = 0, enabled = true) => send({ schemaVersion: 1, type: 'ui-visual-set', tabId: 7,
    documentKey: key(id, frameId), reportRevision: bg.runtime.state.reports.get(key(id, frameId))!.revision, enabled }, uiSender());
  const capture = (value = image, id = TOP, frameId = 0) => send({ schemaVersion: 1, type: 'visual-frame', image: value }, sender(id, frameId));
  return { fake, bg, clock, send, get, enable, capture };
}

async function restart(s: Awaited<ReturnType<typeof setup>>) {
  await s.bg.runtime.persistNow(key());
  await s.bg.runtime.flushIndex();
  await s.bg.runtime.visual.flush();
  s.bg.runtime.stop();
  const bg = createBackground(s.fake, { ttlIntervalMs: 0, clock: s.clock });
  instances.push(bg);
  await bg.start();
  return { bg, get: () => route(bg.runtime, { schemaVersion: 1, type: 'ui-visual-get', tabId: 7, documentKey: key() }, uiSender()) };
}

describe('ADR-018 automatic volatile visual preview', () => {
  it('retains equal pixels from distinct canvases and ignores stale metadata updates', async () => {
    const fixture = await setup();
    const first: VisualImage = { ...image, canvas: { id: 'boot-' + 'a'.repeat(24) + ':1', renderer: '2d', operations: ['cropped-copy'], readbacks: 1 } };
    const second: VisualImage = { ...first, canvas: { ...first.canvas!, id: 'boot-' + 'a'.repeat(24) + ':2' } };
    await fixture.capture(first); await fixture.capture(second);
    expect(await fixture.get()).toMatchObject({ images: [first, second] });
    const newer: VisualImage = { ...first, canvas: { ...first.canvas!, readbacks: 2, operations: ['cropped-copy', 'repeat-readback'] } };
    await fixture.capture(newer); await fixture.capture(first);
    expect(await fixture.get()).toMatchObject({ images: [newer, second] });
    const actionOnly: VisualImage = { ...newer, data: 'BQYHCA==', canvas: { ...newer.canvas!, operations: ['flip-y'], readbacks: 2 } };
    await fixture.capture(actionOnly);
    const merged = await fixture.get();
    if (merged.type !== 'visual-state') throw new Error('missing gallery');
    expect(merged.images[0]?.data).toBe(first.data);
    expect(merged.images[0]?.canvas?.operations).toEqual(expect.arrayContaining(['cropped-copy', 'repeat-readback', 'flip-y']));
    expect(JSON.stringify([...fixture.fake.session.data])).not.toContain('cropped-copy');
    expect(JSON.stringify([...fixture.fake.session.data])).not.toContain(image.data);
  });

  it('marks a full gallery without discarding its accepted canvases or owner', async () => {
    const fixture = await setup();
    let owner: string | null = null;
    for (let index = 1; index <= VISUAL_LIMITS.maxImages + 1; index++) {
      const frame: VisualImage = { ...image, canvas: { id: index <= VISUAL_LIMITS.maxImages ? 'boot-' + 'a'.repeat(24) + ':' + index : 'boot-' + 'b'.repeat(24) + ':1', renderer: '2d', operations: [], readbacks: 1 } };
      const ack = await fixture.capture(frame);
      expect(ack).toMatchObject({ accepted: true });
      if (ack.type !== 'visual-frame-ack') throw new Error('missing frame ACK');
      owner ??= ack.cacheToken;
      expect(ack.cacheToken).toBe(owner);
      if (index > VISUAL_LIMITS.maxImages) expect(ack).toMatchObject({ retained: false, truncated: true });
    }
    const response = await fixture.get();
    expect(response).toMatchObject({ type: 'visual-state', truncated: true });
    if (response.type !== 'visual-state') throw new Error('missing gallery');
    expect(response.images).toHaveLength(VISUAL_LIMITS.maxImages);
  });

  it('restores multiple canvases and a loss marker after worker stop without persisting pixels', async () => {
    const fixture = await setup();
    const images: VisualImage[] = [1, 2].map(index => ({ ...image, canvas: { id: 'boot-' + 'a'.repeat(24) + ':' + index, renderer: '2d', operations: ['flip-y'], readbacks: 1 } }));
    const ack = await fixture.capture(images[0]!); await fixture.capture(images[1]!);
    if (ack.type !== 'visual-frame-ack') throw new Error('missing frame ACK');
    await fixture.send({ schemaVersion: 1, type: 'visual-limited' });
    fixture.fake.tabs.sendMessage = async (_tab, request) => (request as { type?: string }).type === 'visual-cache-read'
      ? { schemaVersion: 1, type: 'visual-cache-state', cacheToken: ack.cacheToken, images, truncated: true } : undefined;
    const resumed = await restart(fixture);
    expect(await resumed.get()).toMatchObject({ images, truncated: true });
    expect(JSON.stringify([...fixture.fake.session.data])).not.toContain('flip-y');
  });

  it('restores acknowledged images directly from the same renderer after SW stop; registry contains metadata only', async () => {
    const s = await setup();
    const ack = await s.capture();
    expect(ack).toMatchObject({ type: 'visual-frame-ack', accepted: true, remainingMs: VISUAL_IDLE_MS });
    if (ack.type !== 'visual-frame-ack' || !ack.cacheToken) throw new Error('missing accepted token');
    expect(ack.cacheToken).toMatch(/^[a-f0-9]{32}$/);
    await s.capture(webgl);
    const original = s.fake.tabs.sendMessage;
    s.fake.tabs.sendMessage = async (tab, message, options) => {
      await original(tab, message, options);
      if ((message as { type?: string }).type === 'visual-cache-read') {
        expect(tab).toBe(7); expect(options).toEqual({ frameId: 0, documentId: TOP });
        expect(message).toEqual({ schemaVersion: 1, type: 'visual-cache-read', cacheToken: ack.cacheToken });
        return { schemaVersion: 1, type: 'visual-cache-state', cacheToken: ack.cacheToken, images: [image, webgl] };
      }
      return undefined;
    };
    const registry = JSON.stringify(s.fake.session.data.get(VISUAL_OWNER_KEY));
    expect(registry).toContain(ack.cacheToken);
    expect(registry).not.toMatch(/AQIDBA|images|example\.com|https:|data/);
    const resumed = await restart(s);
    expect(await resumed.get()).toMatchObject({ enabled: true, images: [image, webgl] });
    expect(resumed.bg.runtime.getProjection(7)?.techniques).toEqual([]);
  });

  it('empty ready/UI requests never consume four image owner slots or evict a captured image', async () => {
    const s = await setup();
    await s.capture();
    const before = s.fake.session.data.get(VISUAL_OWNER_KEY);
    for (let i = 1; i <= 12; i++) {
      const id = 'empty' + i;
      s.fake.framesByTab.get(7)!.push(frame(id, i));
      s.bg.navigation.onCommitted(committed({ documentId: id, frameId: i, frameType: 'sub_frame', parentDocumentId: TOP, parentFrameId: 0 }));
      expect(await s.send({ schemaVersion: 1, type: 'visual-ready' }, sender(id, i))).toMatchObject({ enabled: true });
      expect(await s.get(id, i)).toMatchObject({ images: [] });
    }
    expect(s.fake.session.data.get(VISUAL_OWNER_KEY)).toEqual(before);
    expect(await s.get()).toMatchObject({ images: [image] });
  });

  it('a restored owner still recovers Canvas when a new WebGL kind arrives before the first UI read', async () => {
    const s = await setup(); const ack = await s.capture();
    if (ack.type !== 'visual-frame-ack') throw new Error('missing ack');
    s.fake.tabs.sendMessage = async (_tab, message) => (message as { type?: string }).type === 'visual-cache-read' ?
      { schemaVersion: 1, type: 'visual-cache-state', cacheToken: ack.cacheToken, images: [image, webgl] } : undefined;
    const resumed = await restart(s);
    expect(await route(resumed.bg.runtime, { schemaVersion: 1, type: 'visual-frame', image: webgl }, sender())).toMatchObject({ accepted: true, cacheToken: ack.cacheToken });
    const result = await resumed.get();
    expect(result).toMatchObject({ enabled: true });
    if (result.type !== 'visual-state') throw new Error('missing state');
    expect(result.images).toHaveLength(2); expect(result.images).toEqual(expect.arrayContaining([image, webgl]));
  });

  it('refuses wrong-token or malformed retained data; a later correct response can recover', async () => {
    const s = await setup(); const ack = await s.capture();
    if (ack.type !== 'visual-frame-ack') throw new Error('missing ack');
    let token = '0'.repeat(32);
    s.fake.tabs.sendMessage = async (_tab, message) => (message as { type?: string }).type === 'visual-cache-read' ?
      { schemaVersion: 1, type: 'visual-cache-state', cacheToken: token, images: [image] } : undefined;
    const resumed = await restart(s);
    expect(await resumed.get()).toMatchObject({ images: [] });
    token = ack.cacheToken!;
    expect(await resumed.get()).toMatchObject({ images: [image] });
  });

  it('policy clear during delayed recovery rejects late renderer pixels and persists invalidation', async () => {
    const s = await setup(); const ack = await s.capture();
    if (ack.type !== 'visual-frame-ack') throw new Error('missing ack');
    let answer!: (value: unknown) => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    s.fake.tabs.sendMessage = async (_tab, message) => {
      if ((message as { type?: string }).type !== 'visual-cache-read') return undefined;
      entered(); return new Promise(resolve => { answer = resolve; });
    };
    const resumed = await restart(s), pending = resumed.get();
    await started;
    await resumed.bg.runtime.clearSession();
    answer({ schemaVersion: 1, type: 'visual-cache-state', cacheToken: ack.cacheToken, images: [image] });
    expect(await pending).toMatchObject({ code: 'no-access' });
    expect(s.fake.session.data.get(VISUAL_OWNER_KEY)).toEqual({ v: 1, owners: [] });
  });

  it('unrelated tab navigation does not invalidate or delete another document image during authorization', async () => {
    const s = await setup(); await s.capture();
    let answer!: (value: FrameDetailsLike[]) => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const original = s.fake.webNavigation.getAllFrames;
    s.fake.webNavigation.getAllFrames = () => { entered(); return new Promise(resolve => { answer = resolve; }); };
    const pending = s.get(); await started;
    s.bg.navigation.onCommitted(committed({ tabId: 9, documentId: 'otherTab' }));
    answer([frame()]);
    expect(await pending).toMatchObject({ images: [image] });
    s.fake.webNavigation.getAllFrames = original;
    expect(await s.get()).toMatchObject({ images: [image] });
  });

  it('clearing one document removes only its owner and preserves another frame preview', async () => {
    const s = await setup(true);
    await s.capture(); await s.capture(webgl, CHILD, 2);
    const revision = s.bg.runtime.state.reports.get(key())!.revision;
    expect(await s.bg.runtime.clear(7, key(), revision)).toMatchObject({ type: 'ok' });
    expect(await s.get()).toMatchObject({ code: 'not-found' });
    expect(await s.get(CHILD, 2)).toMatchObject({ images: [webgl] });
    const registry = s.fake.session.data.get(VISUAL_OWNER_KEY) as { owners: Array<{ documentId: string }> };
    expect(registry.owners.map(owner => owner.documentId)).toEqual([CHILD]);
  });

  it('acceptance waits for durable owner metadata and failed storage cannot produce an accepted ACK', async () => {
    const s = await setup();
    const original = s.fake.session.set.bind(s.fake.session);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    s.fake.session.set = async items => { if (VISUAL_OWNER_KEY in items) { entered(); await gate; } await original(items); };
    let finished = false;
    const pending = s.capture().then(value => { finished = true; return value; });
    await started; expect(finished).toBe(false); expect(s.fake.session.data.has(VISUAL_OWNER_KEY)).toBe(false);
    release(); expect(await pending).toMatchObject({ accepted: true });
    s.fake.session.set = async items => { if (VISUAL_OWNER_KEY in items) throw new Error('storage failed'); await original(items); };
    expect(await s.capture(webgl)).toMatchObject({ accepted: false, cacheToken: null });
    expect(await s.get()).toMatchObject({ images: [] });
  });

  it('UI touches are bounded, never reconfigure MAIN, and cannot extend capture windows', async () => {
    const s = await setup(); await s.capture();
    const before = s.fake.sentToTabs.length;
    for (let i = 0; i < 10; i++) { s.clock.t += 1000; await s.get(); }
    expect(s.fake.sentToTabs).toHaveLength(before);
    s.clock.t += 60_000; await s.get();
    expect(s.fake.sentToTabs.slice(before).map(call => (call.message as { type: string }).type)).toEqual(['visual-cache-touch']);
    await s.bg.runtime.visual.flush();
    expect(JSON.stringify(s.fake.session.data.get(VISUAL_OWNER_KEY))).not.toContain(image.data);
  });

  it('concurrent recovery is deduplicated, times out, and releases bounded operation slots', async () => {
    const s = await setup(); await s.capture();
    const resumed = await restart(s);
    let reads = 0;
    s.fake.tabs.sendMessage = async (_tab, message) => {
      if ((message as { type?: string }).type !== 'visual-cache-read') return undefined;
      reads++; return new Promise(() => undefined);
    };
    vi.useFakeTimers();
    const pending = [resumed.get(), resumed.get(), resumed.get(), resumed.get()];
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(1);
    expect(await resumed.get()).toMatchObject({ code: 'no-access' });
    await vi.advanceTimersByTimeAsync(VISUAL_READ_TIMEOUT_MS + 1);
    for (const response of await Promise.all(pending)) expect(response).toMatchObject({ images: [] });
    s.fake.tabs.sendMessage = async () => undefined;
    expect(await resumed.get()).toMatchObject({ images: [] });
  });
  it('automatically accepts authorized pixels; pages cannot control policy, retrieve or redirect them', async () => {
    const s = await setup();
    expect(await s.capture()).toMatchObject({ type: 'visual-frame-ack', accepted: true });
    expect(await s.get()).toMatchObject({ enabled: true, images: [image] });
    expect(await s.send({ schemaVersion: 1, type: 'ui-visual-set', tabId: 7, documentKey: key(), reportRevision: 0, enabled: true })).toMatchObject({ code: 'unauthorized-sender' });
    await s.enable();
    expect(await s.send({ schemaVersion: 1, type: 'ui-visual-get', tabId: 7, documentKey: key() })).toMatchObject({ code: 'unauthorized-sender' });
    expect(await s.send({ schemaVersion: 1, type: 'visual-frame', image, documentKey: key() })).toMatchObject({ code: 'invalid-request' });
    expect(await s.send({ schemaVersion: 1, type: 'visual-frame', image }, sender(TOP, 0, { id: 'foreign' }))).toMatchObject({ code: 'unauthorized-sender' });
    expect(await s.get()).toMatchObject({ images: [image] });
  });

  it('requires the exact current report and fresh browser permission for UI opt-in', async () => {
    const s = await setup();
    const request = { schemaVersion: 1, type: 'ui-visual-set', tabId: 7, documentKey: key(), reportRevision: 9000, enabled: true };
    expect(await s.send(request, uiSender())).toMatchObject({ code: 'stale-revision' });
    expect(await s.send({ ...request, tabId: 9 }, uiSender())).toMatchObject({ code: 'document-mismatch' });
    s.fake.grantedOrigins.clear();
    expect(await s.enable()).toMatchObject({ code: 'no-access' });
  });

  it('captures two kinds only in SW memory; reports, exports and storage never include pixels', async () => {
    const s = await setup();
    expect(await s.enable()).toMatchObject({ enabled: true, remainingMs: 60_000, images: [] });
    await s.capture();
    await s.capture(webgl);
    await s.capture({ ...image, data: 'BQYHCA==' });
    expect(await s.get()).toMatchObject({ enabled: true, images: [image, webgl] });
    const report = s.bg.runtime.state.reports.get(key())!;
    const exported = await s.bg.runtime.exportPreview(7, key(), report.revision);
    await s.bg.runtime.persistNow(key());
    expect(JSON.stringify([s.bg.runtime.getProjection(7), exported, [...s.fake.session.data], [...s.fake.local.data]])).not.toContain(image.data);
    expect(s.bg.runtime.getProjection(7)?.techniques).toEqual([]);
    const resumed = createBackground(s.fake, { ttlIntervalMs: 0, clock: s.clock });
    instances.push(resumed);
    await resumed.start();
    expect(await route(resumed.runtime, { schemaVersion: 1, type: 'ui-visual-get', tabId: 7, documentKey: key() }, uiSender())).toMatchObject({ enabled: true, images: [] });
  });

  it('does not accept invalid dimensions, sizes, raw URLs or excess fields', async () => {
    const s = await setup();
    await s.enable();
    for (const invalid of [{ ...image, width: 1025 }, { ...image, height: 0 }, { ...image, width: 256, height: 257 },
      { ...image, data: 'https://example.com/pixels' }, { ...image, data: 'A'.repeat(VISUAL_LIMITS.maxBase64Chars + 4) },
      { ...image, width: 2 }, { ...image, cookie: 'secret' }, { ...image, kind: 'webgl' }]) {
      expect(await s.send({ schemaVersion: 1, type: 'visual-frame', image: invalid })).toMatchObject({ code: 'invalid-request' });
    }
    expect(await s.get()).toMatchObject({ images: [] });
  });

  it('accepts early child ready with browser identity before any child report or batch', async () => {
    const s = await setup();
    await s.enable();
    s.fake.framesByTab.get(7)!.push(frame(CHILD, 2, 'about:blank'));
    expect(s.bg.runtime.state.reports.has(key(CHILD, 2))).toBe(false);
    expect(await s.send({ schemaVersion: 1, type: 'visual-ready' }, sender(CHILD, 2, { url: 'about:blank' }))).toMatchObject({ enabled: true });
    expect(await s.capture(image, CHILD, 2)).toMatchObject({ accepted: true });
    expect(s.bg.runtime.state.reports.has(key(CHILD, 2))).toBe(false);
    expect(await s.get()).toMatchObject({ images: [] });
  });

  it('same-host children retain separate previews and per-document pause removes only selected pixels', async () => {
    const s = await setup(true);
    await s.enable(CHILD, 2);
    await s.capture(image, CHILD, 2);
    await s.capture(webgl);
    expect(await s.get(CHILD, 2)).toMatchObject({ images: [image] });
    expect(await s.get()).toMatchObject({ images: [webgl] });
    const revision = s.bg.runtime.state.reports.get(key(CHILD, 2))!.revision;
    await s.bg.runtime.pause(7, key(CHILD, 2), revision);
    expect(await s.capture(image, CHILD, 2)).toMatchObject({ accepted: false });
    expect(await s.get()).toMatchObject({ images: [webgl], enabled: true });
  });

  it('rejects unrelated tabs, cross-origin children, cached, prerender and unknown frame identities', async () => {
    const s = await setup();
    await s.enable();
    for (const over of [{ tab: { id: 8 } }, { origin: 'https://other.example', url: 'https://other.example/' },
      { documentLifecycle: 'cached' }, { documentLifecycle: 'prerender' }, { documentId: 'unknown' }, { frameId: 77 }]) {
      expect(await s.send({ schemaVersion: 1, type: 'visual-frame', image }, sender(TOP, 0, over))).toMatchObject({ accepted: false });
    }
    expect(await s.get()).toMatchObject({ images: [] });
  });

  it('reload discards old pixels and messages; new authorized documents start automatically', async () => {
    const s = await setup();
    await s.enable();
    await s.capture();
    s.clock.t += 10_000;
    s.fake.framesByTab.set(7, [frame('replacement')]);
    s.bg.navigation.onCommitted(committed({ documentId: 'replacement' }));
    expect(await s.capture()).toMatchObject({ accepted: false });
    expect(await s.send({ schemaVersion: 1, type: 'visual-ready' }, sender('replacement'))).toMatchObject({ enabled: true, remainingMs: 60_000 });
    expect(await s.get('replacement')).toMatchObject({ images: [], remainingMs: 60_000 });
    await s.capture(webgl, 'replacement');
    expect(await s.get('replacement')).toMatchObject({ images: [webgl] });
    s.fake.framesByTab.set(7, [frame('other', 0, 'https://other.example/')]);
    s.bg.navigation.onCommitted(committed({ documentId: 'other', url: 'https://other.example/' }));
    expect(await s.send({ schemaVersion: 1, type: 'visual-ready' }, sender('other', 0, { url: 'https://other.example/', origin: 'https://other.example' }))).toMatchObject({ enabled: false });
  });

  it('a separately authorized cross-host child keeps its own pixels and cannot spoof browser origin', async () => {
    const s = await setup();
    s.fake.grantedOrigins.add('http://*/*');
    s.fake.grantedOrigins.add('https://*/*');
    await s.bg.runtime.scope.setScope({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' });
    await s.bg.runtime.onPermissionsChanged();
    s.fake.framesByTab.get(7)!.push(frame(CHILD, 2, 'https://other.example/frame'));
    s.bg.navigation.onCommitted(committed({ documentId: CHILD, frameId: 2, frameType: 'sub_frame', parentDocumentId: TOP, parentFrameId: 0, url: 'https://other.example/frame' }));
    expect(await s.send({ schemaVersion: 1, type: 'visual-frame', image }, sender(CHILD, 2))).toMatchObject({ accepted: false });
    expect(await s.send({ schemaVersion: 1, type: 'visual-frame', image }, sender(CHILD, 2,
      { origin: 'https://other.example', url: 'https://other.example/frame' }))).toMatchObject({ accepted: true });
    expect(await s.get(CHILD, 2)).toMatchObject({ images: [image] });
    expect(await s.get()).toMatchObject({ images: [] });
  });

  it('cancelled navigation keeps current preview; subframe replacement removes only old child pixels', async () => {
    const s = await setup(true);
    await s.enable();
    await s.capture();
    await s.capture(webgl, CHILD, 2);
    s.bg.navigation.onBeforeNavigate(committed({ url: 'https://other.example/' }));
    s.bg.navigation.onErrorOccurred(committed({ url: 'https://other.example/' }));
    expect(await s.get()).toMatchObject({ images: [image] });
    s.fake.framesByTab.set(7, [frame(), frame('newchild', 2)]);
    s.bg.navigation.onCommitted(committed({ documentId: 'newchild', frameId: 2, frameType: 'sub_frame', parentDocumentId: TOP, parentFrameId: 0 }));
    expect(await s.capture(webgl, CHILD, 2)).toMatchObject({ accepted: false });
    expect(await s.send({ schemaVersion: 1, type: 'visual-ready' }, sender('newchild', 2))).toMatchObject({ enabled: true });
    expect(await s.get('newchild', 2)).toMatchObject({ images: [] });
    expect(await s.get()).toMatchObject({ images: [image] });
  });

  it('expires idle pixels, while clear, scope revoke and tab removal purge current images', async () => {
    const expiry = await setup();
    await expiry.capture();
    expiry.clock.t += VISUAL_IDLE_MS;
    expect(await expiry.get()).toMatchObject({ enabled: true, images: [] });
    for (const action of ['clear', 'revoke', 'tab'] as const) {
      const s = await setup();
      await s.capture();
      if (action === 'clear') {
        await s.bg.runtime.clearSession();
        expect(await s.get()).toMatchObject({ code: 'not-found' });
        s.bg.navigation.onCommitted(committed({ documentId: TOP }));
        expect(await s.get()).toMatchObject({ images: [] });
      }
      if (action === 'revoke') { s.fake.grantedOrigins.clear(); await s.bg.runtime.onPermissionsChanged(); }
      if (action === 'tab') { s.fake.framesByTab.delete(7); s.bg.runtime.dispatch({ type: 'tab:removed', tabId: 7, at: s.clock.t }); }
      if (action !== 'clear') expect(await s.capture()).toMatchObject({ accepted: false });
      expect(s.fake.sentToTabs.some((call) => (call.message as { type: string; enabled: boolean }).type === 'visual-control' && !(call.message as { enabled: boolean }).enabled)).toBe(true);
    }
  });

  it('bounds live frame caches and evicts oldest pixels without changing reports', async () => {
    const s = await setup();
    await s.enable();
    await s.capture();
    for (let i = 1; i <= MAX_VISUAL_DOCUMENTS; i++) {
      const id = 'child' + i;
      s.fake.framesByTab.get(7)!.push(frame(id, i));
      s.bg.navigation.onCommitted(committed({ documentId: id, frameId: i, frameType: 'sub_frame', parentDocumentId: TOP, parentFrameId: 0 }));
      await s.capture(image, id, i);
    }
    expect(await s.get()).toMatchObject({ enabled: true, images: [] });
    expect(await s.get('child4', 4)).toMatchObject({ enabled: true, images: [image] });
    expect(s.bg.runtime.state.reports.size).toBe(5);
  });

  it('bounds asynchronous page retention and does not commit data after a concurrent revoke', async () => {
    const s = await setup();
    await s.enable();
    const original = s.fake.webNavigation.getAllFrames;
    let resolve!: (frames: FrameDetailsLike[]) => void;
    const blocked = new Promise<FrameDetailsLike[]>((done) => { resolve = done; });
    s.fake.webNavigation.getAllFrames = () => blocked;
    const pending = Array.from({ length: 4 }, () => s.capture());
    expect(await s.capture()).toMatchObject({ accepted: false });
    s.bg.runtime.visual.clear();
    resolve([frame()]);
    expect(await Promise.all(pending)).toEqual(Array.from({ length: 4 }, () => ({ schemaVersion: 1, type: 'visual-frame-ack', accepted: false, cacheToken: null, remainingMs: 0 })));
    s.fake.webNavigation.getAllFrames = original;
    expect(await s.get()).toMatchObject({ images: [], enabled: true });
  });

  it('pause followed by resume cannot resurrect an image awaiting a browser frame lookup', async () => {
    const s = await setup();
    const original = s.fake.webNavigation.getAllFrames;
    let answer!: (frames: FrameDetailsLike[]) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    s.fake.webNavigation.getAllFrames = () => { entered(); return new Promise(resolve => { answer = resolve; }); };
    const pending = s.capture();
    await started;
    s.bg.runtime.dispatch({ type: 'ui:pause', documentKey: key(), at: s.clock.t });
    s.bg.runtime.dispatch({ type: 'ui:resume', documentKey: key(), at: s.clock.t });
    answer([frame()]);
    expect(await pending).toMatchObject({ accepted: false });
    s.fake.webNavigation.getAllFrames = original;
    expect(await s.get()).toMatchObject({ images: [] });
    expect(await s.capture()).toMatchObject({ accepted: true });
    expect(await s.get()).toMatchObject({ images: [image] });
  });
});
