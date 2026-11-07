import { describe, expect, it } from 'vitest';
import type { PageBatch, PageObservation, UiResponse } from '@detect-expert/contracts';
import { BackgroundRuntime, createMessageListener, route } from '../src/index';
import { BUDGETS } from '@detect-expert/contracts';
import type { PageSenderContext } from '../src/index';
import { CLEAR_FENCES_KEY } from '../src/repository';
import { committed, createFakeChrome, pageSender, settle, uiSender } from './fake-chrome';
import type { FakeChrome } from './fake-chrome';
const D1 = 'DOC000000000000000000000000000001', D2 = 'DOC000000000000000000000000000002';
const KEY = '7:0:' + D1, OTHER = '8:0:' + D2;
function sender(tabId = 7, documentId = D1): PageSenderContext {
  return { tabId, frameId: 0, documentId, documentKey: `${tabId}:0:${documentId}`, host: 'example.com', originPattern: 'https://example.com/*', documentLifecycle: 'active', frameType: 'outermost_frame' };
}
function batch(sequence: number, count: number, epoch?: { bridgeSessionId: string; sensorBootId: string }, techniqueId: 'DET-001' | 'DET-002' = 'DET-001'): PageBatch {
  const observation: PageObservation = { techniqueId, phase: 'attempted', signalCodes: ['api-use'], count, countQuality: 'exact', intervalBucket: 1 };
  return { schemaVersion: 1, type: 'sensor-events', batchSeq: sequence, bridgeSessionId: epoch?.bridgeSessionId ?? 'bridge-1', sensorBootId: epoch?.sensorBootId ?? 'boot-1', observations: [observation], coverageDelta: [] };
}
function fresh(fake: FakeChrome, key = KEY) { return fake.historyEpochs.get(key)!; }
async function setup(two = false) {
  const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
  fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
  const clock = { t: 1_000_000, now() { return this.t; } };
  fake.tabList = [{ id: 7 }, ...(two ? [{ id: 8 }] : [])]; fake.framesByTab.set(7, [committed()]);
  if (two) fake.framesByTab.set(8, [committed({ tabId: 8, documentId: D2 })]);
  const runtime = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
  await runtime.start(); await runtime.handleBatch(sender(), batch(1, 100));
  if (two) await runtime.handleBatch(sender(8, D2), batch(1, 50));
  return { runtime, fake, clock };
}

describe('CORE-01/02 authoritative reset barrier', () => {
  it.each(['read failure', 'invalid journal'] as const)('keeps ingress and persistence closed after authority %s, then retries safely', async failure => {
    const { runtime, fake, clock } = await setup();
    await runtime.clearSession(); runtime.stop();
    const authority = fake.session.data.get(CLEAR_FENCES_KEY);
    const get = fake.session.get.bind(fake.session);
    if (failure === 'read failure') fake.session.get = async keys => { if (keys === null) throw Error('authority unread'); return get(keys); };
    else fake.session.data.set(CLEAR_FENCES_KEY, { v: 1, documents: [{ documentKey: KEY }] });
    const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0 }); await next.start();
    expect(next.diagnostics().degraded).toBe(true); expect(next.projectionByKey(KEY)).toBeNull();
    const writes = fake.session.setCalls.length;
    next.dispatch({ type: 'navigation:committed', tabId: 7, frameId: 0, documentId: D1, parentDocumentId: null, frameType: 'outermost_frame', documentLifecycle: 'active', host: 'example.com', scheme: 'https', at: clock.t });
    await expect(route(next, batch(9, 999), pageSender())).rejects.toThrow();
    await expect(next.clearSession()).rejects.toThrow();
    expect(await next.persistNow(KEY)).toBe(false); await next.flushIndex();
    expect(fake.session.setCalls).toHaveLength(writes); expect(fake.session.data.has('doc:' + KEY)).toBe(false);
    expect(next.projectionByKey(KEY)).toBeNull();
    fake.session.get = get; fake.session.data.set(CLEAR_FENCES_KEY, authority);
    expect(await route(next, batch(10, 1000), pageSender())).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 0 });
    expect(next.projectionByKey(KEY)).toBeNull();
    await next.handleBatch(sender(), batch(1, 1, fresh(fake)));
    expect(next.state.reports.get(KEY)?.counters.map(row => row.count)).toEqual([1]); next.stop();
  });
  it('bounds native routed batches across a shared post-start authority retry and restores scope before ACK', async () => {
    const { runtime, fake, clock } = await setup(); await runtime.clearSession(); runtime.stop();
    const get = fake.session.get.bind(fake.session); let reads = 0, release!: () => void;
    const held = new Promise<void>(yes => { release = yes; });
    fake.session.get = async keys => {
      if (keys === null) { reads++; if (reads === 1) throw Error('startup read failed'); await held; }
      return get(keys);
    };
    const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0 }); await next.start();
    let answered = 0;
    const requests = Array.from({ length: 160 }, (_, index) => {
      if (index % 10 === 0) clock.t += 1000;
      return route(next, batch(index + 1, 999), pageSender()).then(reply => { answered++; return reply; });
    });
    await settle();
    expect(reads).toBe(2); expect(answered).toBe(32); expect(next.diagnostics().pendingDropped).toBe(32);
    release(); const replies = await Promise.all(requests);
    expect(replies.every(reply => reply.type === 'ack' && reply.lastCommittedBatchSeq === 0 && reply.stopReason === undefined)).toBe(true);
    expect(next.projectionByKey(KEY)).toBeNull();
    clock.t += 1000;
    expect(await route(next, batch(1, 1, fresh(fake)), pageSender())).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 1 });
    expect(next.state.reports.get(KEY)?.counters.map(row => row.count)).toEqual([1]); next.stop();
  });
  it('reserves journal bytes inside the fixed session budget and includes them in fallback accounting', async () => {
    const { runtime, fake } = await setup();
    fake.session.bytesInUseOverride = BUDGETS.maxSessionTotalBytes;
    await expect(runtime.clearSession()).rejects.toThrow('clear-storage');
    expect(fake.session.data.has(CLEAR_FENCES_KEY)).toBe(false); expect(runtime.state.reports.get(KEY)?.counters[0]?.count).toBe(100);
    fake.session.bytesInUseOverride = null;
    await runtime.clearSession();
    const bytes = new TextEncoder().encode(CLEAR_FENCES_KEY + JSON.stringify(fake.session.data.get(CLEAR_FENCES_KEY))).byteLength;
    expect(runtime.repository.clearFenceBytes).toBe(bytes); expect(runtime.diagnostics().estimatedBytes).toBeGreaterThanOrEqual(bytes); runtime.stop();
  });
  it('keeps the durable revision floor above a cached pre-clear action after worker restart', async () => {
    const { runtime, fake, clock } = await setup();
    for (let sequence = 2; sequence <= 15; sequence++) await runtime.handleBatch(sender(), batch(sequence, sequence + 99));
    const cached = runtime.projectionByKey(KEY)!.reportRevision;
    await runtime.clear(7, KEY, cached); runtime.stop();
    const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0 }); await next.start();
    await next.handleBatch(sender(), batch(1, 1, fresh(fake)));
    expect(next.projectionByKey(KEY)!.reportRevision).toBeGreaterThan(cached);
    expect(await next.pause(7, KEY, cached)).toMatchObject({ type: 'error', code: 'stale-revision' });
    expect(next.state.metas.get(KEY)?.paused).toBe(false); next.stop();
  });
  it('preserves an empty paused projection and a usable Resume across clear and worker restart', async () => {
    const { runtime, fake, clock } = await setup();
    await runtime.pause(7, KEY, runtime.projectionByKey(KEY)!.reportRevision);
    await runtime.clear(7, KEY, runtime.projectionByKey(KEY)!.reportRevision);
    expect(runtime.projectionByKey(KEY)).toMatchObject({ coverageState: 'paused', techniques: [], findings: [], vendors: [] });
    runtime.stop(); const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0 }); await next.start();
    const paused = next.projectionByKey(KEY)!;
    expect(paused.coverageState).toBe('paused');
    expect(await next.resume(7, KEY, paused.reportRevision)).toMatchObject({ type: 'ok' });
    await next.handleBatch(sender(), batch(1, 1, fresh(fake)));
    expect(next.state.reports.get(KEY)?.counters[0]?.count).toBe(1); next.stop();
  });
  it('clears revoked history without requiring a stopped or inaccessible actor to respond', async () => {
    const { runtime, fake } = await setup();
    runtime.dispatch({ type: 'scope:revoked', documentKeys: [KEY], at: runtime.now() });
    const before = fake.sentToTabs.length;
    expect(await runtime.clear(7, KEY, runtime.projectionByKey(KEY)!.reportRevision)).toMatchObject({ type: 'ok' });
    expect(fake.sentToTabs.length).toBe(before); expect(runtime.projectionByKey(KEY)).toBeNull(); expect(fake.session.data.has('doc:' + KEY)).toBe(false); runtime.stop();
  });
  it('completes a revoked-document deferred reset after verified access is granted again', async () => {
    const { runtime, fake } = await setup();
    runtime.dispatch({ type: 'scope:revoked', documentKeys: [KEY], at: runtime.now() });
    await runtime.clear(7, KEY, runtime.projectionByKey(KEY)!.reportRevision);
    const before = fake.sentToTabs.length;
    expect((await runtime.handleBatch(sender(), batch(9, 999))).lastCommittedBatchSeq).toBe(0);
    expect(fake.sentToTabs.length).toBe(before + 1); expect(runtime.state.metas.get(KEY)?.clearBootIds).toHaveLength(1);
    expect(runtime.projectionByKey(KEY)).toBeNull();
    await runtime.handleBatch(sender(), batch(1, 1, fresh(fake)));
    expect(runtime.state.reports.get(KEY)?.counters.map(row => row.count)).toEqual([1]); runtime.stop();
  });
  it('rejects buffered known/unseen keys and counts the first fresh call as one across worker restart', async () => {
    const { runtime, fake, clock } = await setup();
    await runtime.clear(7, KEY, runtime.projectionByKey(KEY)!.reportRevision);
    expect(runtime.projectionByKey(KEY)).toBeNull(); expect(fake.session.data.has('doc:' + KEY)).toBe(false);
    expect(fake.session.data.get(CLEAR_FENCES_KEY)).toMatchObject({ v: 1, documents: [{ documentKey: KEY }] });
    for (const old of [batch(1, 100), batch(2, 110), batch(3, 900, undefined, 'DET-002')]) {
      expect((await runtime.handleBatch(sender(), old)).lastCommittedBatchSeq).toBe(0); expect(runtime.projectionByKey(KEY)).toBeNull();
    }
    await runtime.handleBatch(sender(), batch(1, 1, fresh(fake))); await runtime.handleBatch(sender(), batch(1, 1, fresh(fake)));
    expect(runtime.state.reports.get(KEY)?.counters.map(row => row.count)).toEqual([1]); runtime.stop();
    const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0 }); await next.start();
    await next.handleBatch(sender(), batch(9, 999)); expect(next.state.reports.get(KEY)?.counters[0]?.count).toBe(1);
    await next.handleBatch(sender(), batch(2, 2, fresh(fake))); expect(next.state.reports.get(KEY)?.counters[0]?.count).toBe(2); next.stop();
  });
  it('fails before the authoritative commit when an active actor does not reset', async () => {
    const { runtime, fake } = await setup(); fake.tabs.sendMessage = async () => undefined;
    await expect(runtime.clear(7, KEY, runtime.projectionByKey(KEY)!.reportRevision)).rejects.toThrow('reset-invalid');
    expect(runtime.state.reports.get(KEY)?.counters[0]?.count).toBe(100); expect(fake.session.data.has(CLEAR_FENCES_KEY)).toBe(false); runtime.stop();
  });
  it('returns a generic UI error on authority write failure without clearing either ACKed report', async () => {
    const { runtime, fake, clock } = await setup(true); const set = fake.session.set.bind(fake.session); let attempts = 0;
    fake.session.set = async items => { if (Object.hasOwn(items, CLEAR_FENCES_KEY)) { attempts++; throw Error('owned failure'); } await set(items); };
    const response = await new Promise<UiResponse>(resolve => { createMessageListener(runtime)({ schemaVersion: 1, type: 'ui-clear-session' }, uiSender(), resolve as never); });
    expect(response).toMatchObject({ type: 'error', code: 'invalid-request' }); expect(attempts).toBe(1);
    expect(runtime.state.reports.get(KEY)?.counters[0]?.count).toBe(100); expect(runtime.state.reports.get(OTHER)?.counters[0]?.count).toBe(50);
    fake.session.set = set; runtime.stop(); const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0 }); await next.start();
    expect(next.state.reports.get(KEY)?.counters[0]?.count).toBe(100); expect(next.state.reports.get(OTHER)?.counters[0]?.count).toBe(50); next.stop();
  });
  it('recovers torn multi-key cleanup using its one committed authority item', async () => {
    const { runtime, fake, clock } = await setup(true); const remove = fake.session.remove.bind(fake.session);
    fake.session.remove = async keys => { const list = Array.isArray(keys) ? keys : [keys]; if (list.includes('doc:' + KEY) && list.includes('doc:' + OTHER)) { await remove(['doc:' + KEY]); throw Error('torn cleanup'); } await remove(keys); };
    await expect(runtime.clearSession()).rejects.toThrow('clear-cleanup');
    expect(runtime.projectionByKey(KEY)).toBeNull(); expect(runtime.projectionByKey(OTHER)).toBeNull();
    const writes = fake.session.setCalls.filter(items => Object.hasOwn(items, CLEAR_FENCES_KEY)); expect(writes).toHaveLength(1); expect(Object.keys(writes[0]!)).toEqual([CLEAR_FENCES_KEY]);
    fake.session.remove = remove; runtime.stop(); const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0 }); await next.start();
    expect(next.projectionByKey(KEY)).toBeNull(); expect(next.projectionByKey(OTHER)).toBeNull();
    expect(next.state.reports.get(KEY)?.counters).toEqual([]); expect(next.state.reports.get(OTHER)?.counters).toEqual([]);
    await next.handleBatch(sender(), batch(1, 1, fresh(fake))); expect(next.state.reports.get(KEY)?.counters[0]?.count).toBe(1); next.stop();
  });
  it('reconciles a single authority item that committed but lost its write response', async () => {
    const { runtime, fake } = await setup(); const set = fake.session.set.bind(fake.session);
    fake.session.set = async items => { await set(items); if (Object.hasOwn(items, CLEAR_FENCES_KEY)) throw Error('response lost'); };
    expect(await runtime.clearSession()).toMatchObject({ type: 'ok' }); expect(runtime.projectionByKey(KEY)).toBeNull(); expect(fake.session.data.has('doc:' + KEY)).toBe(false); runtime.stop();
  });
  it('reserves document queues during reset and rejects the late old delivery after commit', async () => {
    const { runtime, fake } = await setup(true); const send = fake.tabs.sendMessage.bind(fake.tabs);
    let entered!: () => void, release!: () => void; const ready = new Promise<void>(yes => { entered = yes; }), held = new Promise<void>(yes => { release = yes; });
    fake.tabs.sendMessage = async (...args) => { entered(); await held; return send(...args); };
    const clearing = runtime.clearSession(); await ready; let accepted = false;
    const old = runtime.handleBatch(sender(), batch(2, 111)).then(reply => { accepted = true; return reply; }); await settle(); expect(accepted).toBe(false);
    release(); await clearing; expect((await old).lastCommittedBatchSeq).toBe(0); expect(runtime.projectionByKey(KEY)).toBeNull();
    await runtime.handleBatch(sender(), batch(1, 1, fresh(fake))); expect(runtime.state.reports.get(KEY)?.counters[0]?.count).toBe(1); runtime.stop();
  });
  it('clears inactive history without an actor and establishes a real epoch before accepting restored data', async () => {
    const { runtime, fake, clock } = await setup();
    const navigate = (documentId: string) => runtime.dispatch({ type: 'navigation:committed', tabId: 7, frameId: 0, documentId, parentDocumentId: null, frameType: 'outermost_frame', documentLifecycle: 'active', host: 'example.com', scheme: 'https', at: clock.t });
    navigate(D2); await runtime.repository.run(KEY, async () => undefined); const before = fake.sentToTabs.length;
    await runtime.clear(7, KEY, runtime.projectionByKey(KEY)!.reportRevision); expect(fake.sentToTabs.length).toBe(before); expect(runtime.state.metas.get(KEY)?.clearBootIds).toEqual([]);
    navigate(D1); expect((await runtime.handleBatch(sender(), batch(8, 999))).lastCommittedBatchSeq).toBe(0); expect(runtime.projectionByKey(KEY)).toBeNull();
    await runtime.handleBatch(sender(), batch(1, 1, fresh(fake))); expect(runtime.state.reports.get(KEY)?.counters[0]?.count).toBe(1); runtime.stop();
  });
});
