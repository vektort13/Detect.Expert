// F013/F017/F098 / REQ-004/006/009/011: browser identities and bounded lifecycle bookkeeping.
import { describe, expect, it, vi } from 'vitest';
import { BUDGETS } from '@detect-expert/contracts';
import type { PageBatch } from '@detect-expert/contracts';
import { BackgroundRuntime, createInitialState, noopEngine, reduce } from '../src/index';
import type { DocumentEvent, DocumentsState } from '../src/index';
import { createFakeChrome } from './fake-chrome';

const key = (id: string, frameId = 0) => '7:' + frameId + ':' + id;
const commit = (id: string, frameId: number, parent: string | null, at = 1000,
  lifecycle: 'active' | 'prerender' | 'cached' = 'active'): Extract<DocumentEvent, { type: 'navigation:committed' }> => ({ type: 'navigation:committed', tabId: 7,
    frameId, documentId: id, parentDocumentId: parent, frameType: frameId === 0 ? 'outermost_frame' : 'sub_frame',
    documentLifecycle: lifecycle, scheme: 'https', host: 'example.com', accessGranted: true, at });
const unavailable = (id: string, frameId: number, at = 1000): DocumentEvent => ({ type: 'frame:unavailable', tabId: 7, frameId, documentId: id, at });
const apply = (state: DocumentsState, event: DocumentEvent) => reduce(state, event, noopEngine).state;
const top = () => apply(createInitialState(), commit('top', 0, null));
const pageBatch = (seq: number): PageBatch => ({ schemaVersion: 1, type: 'sensor-events', sensorBootId: 'frameboot',
  bridgeSessionId: 'framebridge', batchSeq: seq, coverageDelta: [], observations: [{ techniqueId: 'DET-001', count: seq,
    countQuality: 'exact', phase: 'returned-sync', signalCodes: ['api-use'], intervalBucket: 1 }] });
const context = (id: string, frameId = 0) => ({ tabId: 7, frameId, documentId: id, documentKey: key(id, frameId),
  host: 'example.com', originPattern: 'https://example.com/*', documentLifecycle: 'active' as const, frameType: null });

describe('F098: unavailable before browser navigation binding', () => {
  it('waits for exact child and parent identities, then projects the gap without an observation', () => {
    let state = apply(createInitialState(), unavailable('child', 2));
    state = apply(state, commit('child', 2, 'top', 1200));
    expect(state.unavailableFrames.has(key('child', 2))).toBe(true);
    state = apply(state, commit('top', 0, null, 1500));
    expect(state.reports.get(key('top'))).toMatchObject({ coverageState: 'partial', coverageFlags: ['frames-inaccessible'], counters: [] });
    expect(state.unavailableFrames.size).toBe(0);
  });

  it('cannot transfer an old child marker to a replacement document or a different tab', () => {
    let state = apply(top(), unavailable('old', 2));
    state = apply(state, commit('replacement', 2, 'top', 1200));
    state = apply(state, { ...commit('old', 2, 'top', 1300), tabId: 8 });
    expect(state.reports.get(key('top'))?.coverageFlags).toEqual([]);
  });

  it('expires at the bounded quarantine TTL and cannot grow beyond 128 trusted identities', () => {
    let state = top();
    for (let i = 0; i < 200; i++) state = apply(state, unavailable('pending' + i, i + 1));
    expect(state.unavailableFrames.size).toBe(BUDGETS.maxOutOfOrderEntriesGlobal);
    expect(state.unavailableFrames.has(key('pending0', 1))).toBe(false);
    state = apply(state, commit('pending199', 200, 'top', 1000 + BUDGETS.outOfOrderTtlMs));
    expect(state.unavailableFrames.size).toBe(0);
    expect(state.reports.get(key('top'))?.coverageFlags).toEqual([]);
  });

  it('tab closure removes its pending identities', () => {
    let state = apply(top(), unavailable('pending', 2));
    state = apply(state, { type: 'tab:removed', tabId: 7, at: 1200 });
    expect(state.unavailableFrames.size).toBe(0);
  });
});

describe('F013/F017: frame tree retirement', () => {
  it('iframe navigation retires old descendants while preserving sibling and prerender trees', () => {
    let state = apply(top(), commit('child', 2, 'top'));
    state = apply(state, commit('nested', 3, 'child'));
    state = apply(state, commit('sibling', 4, 'top'));
    state = apply(state, commit('hidden', 2, 'top', 1000, 'prerender'));
    state = apply(state, commit('new-child', 2, 'top', 1500));
    expect([...state.bindings.values()].map((entry) => entry.documentId)).toEqual(expect.arrayContaining(['top', 'new-child', 'sibling', 'hidden']));
    expect(state.bindings.size).toBe(4);
    for (const [id, frame] of [['child', 2], ['nested', 3]] as const) expect(state.metas.get(key(id, frame))?.bound).toBe(false);
  });

  it('cancelling an exact prerender document retires its hidden descendants only', () => {
    let state = apply(top(), commit('hidden', 8, null, 1000, 'prerender'));
    state = apply(state, commit('hidden-child', 9, 'hidden', 1000, 'prerender'));
    state = apply(state, { type: 'navigation:error', tabId: 7, frameId: 8, documentId: 'hidden', at: 1500 });
    expect([...state.bindings.values()].map((entry) => entry.documentId)).toEqual(['top']);
    expect(state.metas.get(key('hidden-child', 9))?.bound).toBe(false);
    expect(state.reports.get(key('top'))?.lifecycle).toBe('committed');
  });

  it('reuses slots and bounded history for more than 1024 sequential removed iframes without top reload', () => {
    let state = top();
    for (let i = 1; i <= 1100; i++) {
      state = apply(state, commit('child' + i, i, 'top', i + 1000));
      expect(state.bindings.size).toBe(2);
      state = apply(state, { type: 'frames:retired', documentKeys: [key('child' + i, i)], at: i + 1001 });
    }
    expect(state.bindings.size).toBe(1);
    expect(state.reports.size).toBeLessThanOrEqual(1024);
    expect(state.tabs.get(7)?.activeTopDocumentKey).toBe(key('top'));
    expect(state.reports.get(key('top'))?.coverageFlags).toEqual([]);
    expect(state.metas.get(key('child1100', 1100))?.bound).toBe(false);
  });

  it('rebinding an existing history document at the report cap retains its counters and other history', () => {
    let state = apply(top(), commit('returning', 2, 'top'));
    state = apply(state, { type: 'batch', sender: context('returning', 2), batch: pageBatch(1), at: 1000 });
    state = apply(state, { type: 'frames:retired', documentKeys: [key('returning', 2)], at: 1001 });
    for (let i = 3; i < 1025; i++) {
      state = apply(state, commit('history' + i, i, 'top', i + 1000));
      state = apply(state, { type: 'frames:retired', documentKeys: [key('history' + i, i)], at: i + 1001 });
    }
    expect(state.reports.size).toBe(1024);
    state = apply(state, commit('returning', 2, 'top', 3000));
    expect(state.reports.size).toBe(1024);
    expect(state.reports.get(key('returning', 2))?.counters[0]?.count).toBe(1);
    expect(state.reports.get(key('returning', 2))?.coverageFlags).not.toContain('truncated');
    expect(state.metas.get(key('returning', 2))?.bound).toBe(true);
    expect(state.evictedKeys).toEqual([]);
  });
});

const frame = (id: string, frameId: number, parent = 'top') => ({ documentId: id, frameId,
  parentDocumentId: frameId === 0 ? undefined : parent, frameType: frameId === 0 ? 'outermost_frame' : 'sub_frame',
  documentLifecycle: 'active', url: 'https://example.com/' });

async function started() {
  const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
  fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
  fake.tabList = [{ id: 7 }];
  fake.framesByTab.set(7, [frame('top', 0)]);
  const clock = { t: 1000, now() { return this.t; } };
  const runtime = new BackgroundRuntime(fake, { ttlIntervalMs: 0, clock });
  await runtime.start();
  return { fake, clock, runtime };
}

describe('F013: bounded browser frame reconciliation', () => {
  it('F092: after clearing 257 documents and restarting, a displaced marker gives unknown prior state instead of fake dropped batches', async () => {
    const { runtime, fake, clock } = await started();
    await runtime.handleBatch(context('top'), pageBatch(1));
    for (let i = 0; i < 256; i++) runtime.dispatch({ ...commit('other' + i, 0, null), tabId: i + 8 });
    expect(runtime.state.reports.size).toBe(257);
    await runtime.clearSession();
    expect(runtime.state.evictedKeys).toHaveLength(256);
    expect(runtime.state.evictedKeys).not.toContain(key('top'));
    runtime.stop();
    const next = new BackgroundRuntime(fake, { ttlIntervalMs: 0, clock });
    await next.start();
    expect(next.state.reports.get(key('top'))?.coverageFlags).not.toContain('truncated');
    expect(await next.handleBatch(context('top'), pageBatch(37))).toMatchObject({ lastCommittedBatchSeq: 37 });
    expect(next.state.reports.get(key('top'))?.coverageFlags).toContain('truncated');
    expect(next.state.reports.get(key('top'))?.dropped.batches).toBe(0);
    expect(next.state.reports.get(key('top'))?.coverageFlags).not.toContain('channel-gap');
    await next.handleBatch(context('top'), pageBatch(39));
    expect(next.state.reports.get(key('top'))?.dropped.batches).toBe(1);
    expect(next.state.reports.get(key('top'))?.coverageFlags).toContain('channel-gap');
    next.stop();
  });
  it('retires removed HTTP frames and descendants but retains cached/prerender/non-enumerable realms', async () => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch(commit('removed', 2, 'top'));
    runtime.dispatch(commit('nested', 3, 'removed'));
    runtime.dispatch(commit('cached', 4, 'top', 1000, 'cached'));
    runtime.dispatch(commit('prerender', 5, 'top', 1000, 'prerender'));
    const blob = commit('blob', 6, 'top');
    if (blob.type === 'navigation:committed') delete blob.scheme;
    runtime.dispatch(blob);
    clock.t += 10_000;
    await runtime.reconcileFrames();
    expect([...runtime.state.bindings.values()].map((binding) => binding.documentId).sort()).toEqual(['blob', 'cached', 'prerender', 'top']);
    expect(runtime.state.metas.get(key('removed', 2))?.bound).toBe(false);
    expect(runtime.state.metas.get(key('nested', 3))?.bound).toBe(false);
    // An inherited frame exposed by browser enumeration can be retired after it disappears.
    fake.framesByTab.set(7, [frame('top', 0), { ...frame('blank', 8), url: 'about:blank' }]);
    const blank = commit('blank', 8, 'top');
    if (blank.type === 'navigation:committed') delete blank.scheme;
    runtime.dispatch(blank);
    clock.t += 10_000;
    await runtime.reconcileFrames();
    fake.framesByTab.set(7, [frame('top', 0)]);
    clock.t += 10_000;
    await runtime.reconcileFrames();
    expect(runtime.state.metas.get(key('blank', 8))?.bound).toBe(false);
    expect(runtime.state.metas.get(key('blob', 6))?.bound).toBe(true);
    runtime.stop();
  });

  it.each(['reject', 'null', 'wrong-top', 'oversize'] as const)('preserves bindings on %s enumeration', async (kind) => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch(commit('child', 2, 'top'));
    vi.spyOn(fake.webNavigation, 'getAllFrames').mockImplementation(async () => {
      if (kind === 'reject') throw new Error('browser unavailable');
      if (kind === 'null') return null;
      if (kind === 'wrong-top') return [frame('different-top', 0)];
      return Array.from({ length: 1025 }, (_, i) => frame('oversize' + i, i));
    });
    clock.t += 10_000;
    await runtime.reconcileFrames();
    expect(runtime.state.metas.get(key('child', 2))?.bound).toBe(true);
    runtime.stop();
  });

  it('never applies stale asynchronous absence to a replacement frame, and concurrent ticks do not overlap', async () => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch(commit('old', 2, 'top'));
    let release: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const lookup = vi.spyOn(fake.webNavigation, 'getAllFrames').mockImplementation(async () => { await barrier; return [frame('top', 0)]; });
    clock.t += 10_000;
    const pending = runtime.reconcileFrames();
    await runtime.reconcileFrames();
    expect(lookup).toHaveBeenCalledTimes(1);
    runtime.dispatch(commit('replacement', 2, 'top', clock.t));
    release();
    await pending;
    expect(runtime.state.metas.get(key('replacement', 2))?.bound).toBe(true);
    runtime.stop();
  });

  it('scans at most 16 tabs per pass and rotates to later tabs after the cooldown', async () => {
    const { runtime, fake, clock } = await started();
    for (let tabId = 8; tabId < 40; tabId++) runtime.dispatch({ ...commit('top' + tabId, 0, null), tabId });
    const lookup = vi.spyOn(fake.webNavigation, 'getAllFrames');
    clock.t += 10_000;
    await runtime.reconcileFrames();
    expect(lookup).toHaveBeenCalledTimes(16);
    await runtime.reconcileFrames();
    expect(lookup).toHaveBeenCalledTimes(16);
    clock.t += 10_000;
    await runtime.reconcileFrames();
    expect(lookup).toHaveBeenCalledTimes(32);
    expect(new Set(lookup.mock.calls.map(([arg]) => arg.tabId)).size).toBe(32);
    runtime.stop();
  });
});
