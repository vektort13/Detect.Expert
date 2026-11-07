import { BUDGETS } from '@detect-expert/contracts';
import type { PageBatch, PageObservation } from '@detect-expert/contracts';
import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  isProjected,
  noopEngine,
  planEviction,
  reduce,
  selectDocumentKey,
} from '../src/index';
import type { DocumentEvent, DocumentsState, PageSenderContext, ReduceResult } from '../src/index';

const D1 = 'DOC000000000000000000000000000001';
const D2 = 'DOC000000000000000000000000000002';
const D3 = 'DOC000000000000000000000000000003';

function ctx(over: Partial<PageSenderContext> = {}): PageSenderContext {
  const tabId = over.tabId ?? 7;
  const frameId = over.frameId ?? 0;
  const documentId = over.documentId ?? D1;
  return {
    tabId,
    frameId,
    documentId,
    documentKey: `${tabId}:${frameId}:${documentId}`,
    host: 'example.com',
    originPattern: 'https://example.com/*',
    documentLifecycle: 'active',
    frameType: null,
    ...over,
  };
}

function obs(over: Partial<PageObservation> = {}): PageObservation {
  return { techniqueId: 'DET-001', count: 1, countQuality: 'exact', phase: 'attempted', signalCodes: ['api-use'], intervalBucket: 1, ...over };
}

function batchOf(batchSeq: number, observations: PageObservation[], over: Partial<PageBatch> = {}): PageBatch {
  return { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'boot-1', bridgeSessionId: 'bridge-1', batchSeq, observations, coverageDelta: [], ...over };
}

function commitEv(over: Partial<Extract<DocumentEvent, { type: 'navigation:committed' }>> = {}): DocumentEvent {
  return {
    type: 'navigation:committed',
    tabId: 7,
    frameId: 0,
    documentId: D1,
    parentDocumentId: null,
    frameType: 'outermost_frame',
    documentLifecycle: 'active',
    host: 'example.com',
    at: 1000,
    ...over,
  };
}

function batchEv(sender: PageSenderContext, batch: PageBatch, at = 1500): DocumentEvent {
  return { type: 'batch', sender, batch, at };
}

class Harness {
  state: DocumentsState = createInitialState();
  last: ReduceResult | null = null;
  apply(event: DocumentEvent): ReduceResult {
    const r = reduce(this.state, event, noopEngine);
    this.state = r.state;
    this.last = r;
    return r;
  }
  report(key: string) {
    return this.state.reports.get(key);
  }
  count(key: string, techniqueId = 'DET-001'): number | undefined {
    return this.report(key)?.counters.find((c) => c.techniqueId === techniqueId)?.count;
  }
}

describe('reducer: navigation table (spec A7)', () => {
  it('onBeforeNavigate creates a pending attempt and keeps the current report; abort keeps it too', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(batchEv(ctx(), batchOf(1, [obs({ count: 4 })])));
    const before = h.report('7:0:' + D1);
    expect(before?.counters[0]?.count).toBe(4);

    h.apply({ type: 'navigation:before', tabId: 7, frameId: 0, host: 'other.example', at: 2000 });
    expect(h.state.attempts.size).toBe(1);
    expect(h.report('7:0:' + D1)).toBe(before); // untouched object
    expect(selectDocumentKey(h.state, 7)).toBe('7:0:' + D1);

    h.apply({ type: 'navigation:error', tabId: 7, frameId: 0, documentId: D2, at: 2100 });
    expect(h.state.attempts.size).toBe(0);
    expect(h.report('7:0:' + D1)).toBe(before);
    expect(selectDocumentKey(h.state, 7)).toBe('7:0:' + D1);
    expect(h.last?.effects).toEqual([]);
  });

  it('onCommitted (active outermost) switches the projection; the old report stays until TTL', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(batchEv(ctx(), batchOf(1, [obs()])));
    h.apply(commitEv({ documentId: D2, at: 3000 }));
    expect(selectDocumentKey(h.state, 7)).toBe('7:0:' + D2);
    expect(h.report('7:0:' + D1)?.lifecycle).toBe('closed');
    expect(h.state.metas.get('7:0:' + D1)?.bound).toBe(false);
    expect(h.report('7:0:' + D2)?.counters).toEqual([]);
    expect(h.report('7:0:' + D1)?.counters.length).toBe(1);
  });

  it('BFCache-like re-commit with the same documentId keeps the report and rebinds it', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(batchEv(ctx(), batchOf(1, [obs({ count: 9 })])));
    h.apply(commitEv({ documentId: D2, at: 3000 }));
    h.apply(commitEv({ documentId: D1, at: 4000 })); // back
    const r = h.report('7:0:' + D1);
    expect(r?.lifecycle).toBe('committed');
    expect(r?.counters[0]?.count).toBe(9);
    expect(h.state.metas.get('7:0:' + D1)?.bound).toBe(true);
    expect(selectDocumentKey(h.state, 7)).toBe('7:0:' + D1);
    expect(h.report('7:0:' + D2)?.lifecycle).toBe('closed');
  });

  it('SPA route updates only bump the route segment counter; nothing is stored about the URL', () => {
    const h = new Harness();
    h.apply(commitEv());
    const rev = h.report('7:0:' + D1)?.revision;
    h.apply({ type: 'navigation:route', tabId: 7, frameId: 0, documentId: D1, documentLifecycle: 'active', at: 1200 });
    h.apply({ type: 'navigation:route', tabId: 7, frameId: 0, documentId: D1, documentLifecycle: 'active', at: 1300 });
    expect(h.state.metas.get('7:0:' + D1)?.routeSegments).toBe(2);
    expect(h.report('7:0:' + D1)?.revision).toBe(rev);
    expect(h.last?.effects).toEqual([]);
  });

  it('iframe navigation creates a new documentKey on the same frameId; old batches stay on the old document', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(commitEv({ frameId: 3, documentId: D2, frameType: 'sub_frame', parentDocumentId: D1 }));
    h.apply(batchEv(ctx({ frameId: 3, documentId: D2 }), batchOf(1, [obs({ count: 2 })])));
    h.apply(commitEv({ frameId: 3, documentId: D3, frameType: 'sub_frame', parentDocumentId: D1, at: 5000 }));
    expect(h.state.bindings.get('7:3')?.documentKey).toBe('7:3:' + D3);
    // Late batch from the old iframe document: merged into the old report, never into the new one.
    h.apply(batchEv(ctx({ frameId: 3, documentId: D2 }), batchOf(2, [obs({ count: 5 })]), 5100));
    expect(h.count('7:3:' + D2)).toBe(5);
    expect(h.report('7:3:' + D3)?.counters).toEqual([]);
    expect(selectDocumentKey(h.state, 7)).toBe('7:0:' + D1);
  });

  it('prerender documents are kept separately and are not projected until activation', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(commitEv({ frameId: 41, documentId: D2, documentLifecycle: 'prerender', at: 2000 }));
    expect(selectDocumentKey(h.state, 7)).toBe('7:0:' + D1);
    expect(h.report('7:41:' + D2)?.lifecycle).toBe('prerender');
    // A batch from the prerendering document lands in its own report.
    h.apply(batchEv(ctx({ frameId: 41, documentId: D2, documentLifecycle: 'prerender' }), batchOf(1, [obs({ count: 3 })]), 2100));
    expect(h.count('7:41:' + D2)).toBe(3);
    expect(h.report('7:0:' + D1)?.counters).toEqual([]);
    expect(selectDocumentKey(h.state, 7)).toBe('7:0:' + D1);
    // Activation: the same documentId commits as active outermost -> projected, nothing lost.
    h.apply(commitEv({ documentId: D2, documentLifecycle: 'active', at: 3000 }));
    expect(selectDocumentKey(h.state, 7)).toBe('7:0:' + D2);
    expect(h.report('7:0:' + D2)?.lifecycle).toBe('committed');
    expect(h.count('7:0:' + D2)).toBe(3);
    expect(h.state.bindings.has('7:41:p')).toBe(false);
  });

  it('activation seen through the sender lifecycle also promotes a prerender document', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(commitEv({ frameId: 41, documentId: D2, documentLifecycle: 'prerender', at: 2000 }));
    h.apply(batchEv(ctx({ documentId: D2, documentLifecycle: 'active' }), batchOf(1, [obs()]), 2500));
    expect(selectDocumentKey(h.state, 7)).toBe('7:0:' + D2);
    expect(h.report('7:0:' + D1)?.lifecycle).toBe('closed');
  });

  it('onCommitted without frameType/documentLifecycle falls back to frameId === 0 and records a note', () => {
    const h = new Harness();
    h.apply(commitEv({ frameType: null, documentLifecycle: null }));
    expect(selectDocumentKey(h.state, 7)).toBe('7:0:' + D1);
    expect(h.state.notes.lifecycleFallbackCommits).toBe(1);
    h.apply(commitEv({ frameId: 2, documentId: D2, frameType: null, documentLifecycle: null }));
    expect(selectDocumentKey(h.state, 7)).toBe('7:0:' + D1);
  });

  it('tabs.onReplaced keeps the replaced tab reports (unbound) and projects the prerendered document of the new tab', () => {
    const h = new Harness();
    h.apply(commitEv({ tabId: 7 }));
    h.apply(batchEv(ctx({ tabId: 7 }), batchOf(1, [obs({ count: 6 })])));
    h.apply(commitEv({ tabId: 9, documentId: D2, documentLifecycle: 'prerender', at: 2000 }));
    h.apply({ type: 'tab:replaced', addedTabId: 9, removedTabId: 7, at: 3000 });
    expect(h.count('7:0:' + D1)).toBe(6);
    expect(h.state.metas.get('7:0:' + D1)?.bound).toBe(false);
    expect(h.state.tabs.has(7)).toBe(false);
    expect(selectDocumentKey(h.state, 9)).toBe('9:0:' + D2);
    expect(h.report('9:0:' + D2)?.lifecycle).toBe('committed');
    expect(h.last?.effects.some((e) => e.type === 'remove')).toBe(false);
  });

  it('tabs.onRemoved deletes the tab documents, bindings and projection (retention)', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(commitEv({ frameId: 3, documentId: D2, frameType: 'sub_frame', parentDocumentId: D1 }));
    h.apply(commitEv({ tabId: 8, documentId: D3 }));
    const r = h.apply({ type: 'tab:removed', tabId: 7, at: 9000 });
    expect(h.state.reports.size).toBe(1);
    expect(h.report('8:0:' + D3)).toBeDefined();
    expect(h.state.bindings.size).toBe(1);
    expect(h.state.tabs.has(7)).toBe(false);
    expect(r.effects).toContainEqual({ type: 'remove', documentKeys: ['7:0:' + D1, '7:3:' + D2] });
  });
});

describe('reducer: batches (spec A6)', () => {
  it('dedup: a replayed (documentKey, bridgeSessionId, batchSeq) does not double count', () => {
    const h = new Harness();
    h.apply(commitEv());
    const b = batchOf(1, [obs({ count: 5 })]);
    const first = h.apply(batchEv(ctx(), b));
    expect(first.batch?.status).toBe('committed');
    expect(first.effects).toContainEqual({ type: 'persist', documentKey: '7:0:' + D1, immediate: true });
    const again = h.apply(batchEv(ctx(), b));
    expect(again.batch).toMatchObject({ status: 'duplicate', lastCommittedBatchSeq: 1, paused: false, protocolOk: true });
    expect(again.effects).toEqual([]);
    expect(h.count('7:0:' + D1)).toBe(5);
    expect(h.report('7:0:' + D1)?.watermark).toEqual({ bridgeSessionId: 'bridge-1', lastCommittedBatchSeq: 1 });
  });

  it('counters merge by max within a sensor boot and add up across boots', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(batchEv(ctx(), batchOf(1, [obs({ count: 5 })])));
    h.apply(batchEv(ctx(), batchOf(2, [obs({ count: 3 })]))); // redelivered lower total: no-op
    expect(h.count('7:0:' + D1)).toBe(5);
    h.apply(batchEv(ctx(), batchOf(3, [obs({ count: 9 })])));
    expect(h.count('7:0:' + D1)).toBe(9);
    h.apply(batchEv(ctx(), batchOf(4, [obs({ count: 2 })], { sensorBootId: 'boot-2' })));
    expect(h.count('7:0:' + D1)).toBe(11);
    expect(h.report('7:0:' + D1)?.counters.length).toBe(1);
  });

  it('a gap in batchSeq is an explicit channel-gap, and a new bridge session starts its own watermark', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(batchEv(ctx(), batchOf(1, [obs()])));
    h.apply(batchEv(ctx(), batchOf(4, [obs()])));
    const r = h.report('7:0:' + D1);
    expect(r?.dropped.batches).toBe(2);
    expect(r?.coverageFlags).toContain('channel-gap');
    const s2 = h.apply(batchEv(ctx(), batchOf(1, [obs()], { bridgeSessionId: 'bridge-2' })));
    expect(s2.batch?.status).toBe('committed');
    expect(h.report('7:0:' + D1)?.watermark).toEqual({ bridgeSessionId: 'bridge-2', lastCommittedBatchSeq: 1 });
    // The old session replayed is still a duplicate.
    expect(h.apply(batchEv(ctx(), batchOf(4, [obs()]))).batch?.status).toBe('duplicate');
  });

  it('counters are bounded per document: the 129th key is dropped with budget-exceeded', () => {
    const h = new Harness();
    h.apply(commitEv());
    let seq = 1;
    const ids = ['DET-001', 'DET-002', 'DET-003', 'DET-004', 'DET-005', 'DET-006', 'DET-007', 'DET-008'] as const;
    // 8 techniques x 5 phases x 4 signal combos = 160 distinct keys, delivered in batches of 32.
    const phases = ['attempted', 'returned-sync', 'threw-sync', 'async-returned', 'settlement-unobserved'] as const;
    const signals = [['api-use'], ['readback-after-text'], ['offline-render'], ['numeric-diversity']] as const;
    const all: PageObservation[] = [];
    for (const t of ids) for (const p of phases) for (const s of signals) all.push(obs({ techniqueId: t, phase: p, signalCodes: [...s] }));
    for (let i = 0; i < all.length; i += 32) h.apply(batchEv(ctx(), batchOf(seq++, all.slice(i, i + 32))));
    const r = h.report('7:0:' + D1);
    expect(r?.counters.length).toBe(BUDGETS.maxCountersPerDocumentGroup);
    expect(r?.dropped.counters).toBe(all.length - BUDGETS.maxCountersPerDocumentGroup);
    expect(r?.coverageFlags).toContain('budget-exceeded');
  });

  it('unknown documentId -> quarantine, drained on commit; expired entries become orphans with a reason', () => {
    const h = new Harness();
    const q = h.apply(batchEv(ctx({ documentId: D2 }), batchOf(1, [obs({ count: 7 })]), 1000));
    expect(q.batch).toMatchObject({ status: 'quarantined', lastCommittedBatchSeq: 0, protocolOk: true });
    expect(h.state.quarantine.length).toBe(1);
    h.apply(batchEv(ctx({ documentId: D2 }), batchOf(1, [obs({ count: 7 })]), 1100)); // same batch again: no duplicate entry
    expect(h.state.quarantine.length).toBe(1);
    h.apply(commitEv({ documentId: D2, at: 1500 }));
    expect(h.state.quarantine.length).toBe(0);
    expect(h.count('7:0:' + D2)).toBe(7);

    const t0 = 10_000;
    h.apply(batchEv(ctx({ documentId: D3 }), batchOf(1, [obs(), obs({ techniqueId: 'DET-002' })]), t0));
    h.apply({ type: 'ttl-tick', at: t0 + BUDGETS.outOfOrderTtlMs });
    expect(h.state.quarantine.length).toBe(0);
    expect(h.state.unattributed.orphanBatches).toBe(1);
    expect(h.state.unattributed.orphanObservations).toBe(2);
    expect(h.state.unattributed.lastOrphanReason).toBe('quarantine-expired');
    expect(h.report('7:0:' + D3)).toBeUndefined();
  });

  it('the quarantine is bounded to 128 entries globally', () => {
    const h = new Harness();
    for (let i = 0; i < BUDGETS.maxOutOfOrderEntriesGlobal + 5; i++) {
      h.apply(batchEv(ctx({ tabId: 100 + i }), batchOf(1, [obs()]), 1000));
    }
    expect(h.state.quarantine.length).toBe(BUDGETS.maxOutOfOrderEntriesGlobal);
    expect(h.state.unattributed.orphanBatches).toBe(5);
    expect(h.state.unattributed.lastOrphanReason).toBe('quarantine-full');
  });

  it('ui-clear discards history without inventing transport loss (F092)', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(batchEv(ctx(), batchOf(1, [obs()])));
    h.apply(batchEv(ctx(), batchOf(2, [obs()])));
    const cleared = h.apply({ type: 'ui:clear', documentKey: '7:0:' + D1, at: 2000,
      fence: { documentKey: '7:0:' + D1, bridgeSessionId: 'fresh-bridge', sensorBootIds: ['fresh-boot'], at: 2000, reportRevision: 100 } });
    expect(cleared.effects).toContainEqual({ type: 'persist', documentKey: '7:0:' + D1, immediate: true });
    expect(h.report('7:0:' + D1)?.counters).toEqual([]);
    expect(h.state.metas.get('7:0:' + D1)?.cleared).toBe(true);
    const r = h.apply(batchEv(ctx(), batchOf(1, [obs()], { bridgeSessionId: 'fresh-bridge', sensorBootId: 'fresh-boot' }), 2500));
    expect(r.batch?.status).toBe('committed');
    expect(h.count('7:0:' + D1)).toBe(1);
    expect(h.report('7:0:' + D1)?.coverageFlags).not.toContain('truncated');
    expect(h.report('7:0:' + D1)?.coverageFlags).not.toContain('channel-gap');
    expect(h.report('7:0:' + D1)?.dropped.batches).toBe(0);
  });

  it('pause blocks merges (ack paused) and resume keeps the paused interval visible', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(batchEv(ctx(), batchOf(1, [obs({ count: 1 })])));
    h.apply({ type: 'ui:pause', documentKey: '7:0:' + D1, at: 2000 });
    expect(h.report('7:0:' + D1)?.coverageState).toBe('paused');
    const p = h.apply(batchEv(ctx(), batchOf(2, [obs({ count: 50 })]), 2100));
    expect(p.batch).toMatchObject({ status: 'paused', paused: true, lastCommittedBatchSeq: 1 });
    expect(h.count('7:0:' + D1)).toBe(1);
    h.apply({ type: 'ui:resume', documentKey: '7:0:' + D1, at: 3000 });
    const r = h.report('7:0:' + D1);
    expect(r?.coverageState).toBe('active');
    expect(r?.coverageFlags).toContain('paused');
    expect(h.apply(batchEv(ctx(), batchOf(2, [obs({ count: 50 })]), 3100)).batch?.status).toBe('committed');
    expect(h.count('7:0:' + D1)).toBe(50);
  });

  it('late injection marks only the named document late-start', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply({ type: 'injection:late', documentKeys: ['7:0:' + D1], at: 1200 });
    expect(h.report('7:0:' + D1)?.coverageState).toBe('late-start');
    h.apply(batchEv(ctx(), batchOf(1, [obs()])));
    expect(h.report('7:0:' + D1)?.coverageFlags).toContain('late-start');
  });
});

describe('reducer: network hosts (spec A9)', () => {
  it('records sanitized hosts on the document by documentId, bounded to 128; tabId -1 stays unattributed', () => {
    const h = new Harness();
    h.apply(commitEv());
    const net = (host: string, over: Partial<Extract<DocumentEvent, { type: 'network:host' }>> = {}): DocumentEvent => ({
      type: 'network:host',
      tabId: 7,
      frameId: 0,
      documentId: D1,
      parentFrameId: -1,
      parentDocumentId: null,
      resourceType: 'script',
      host,
      at: 1100,
      ...over,
    });
    h.apply(net('cdn.vendor.net'));
    h.apply(net('cdn.vendor.net'));
    const r = h.report('7:0:' + D1);
    expect(r?.hosts).toEqual([
      { registrableDomain: 'vendor.net', relation: 'unknown', evidenceSource: 'browser-network', integrity: 'browser-observed', requestCount: 2, firstSeenBucket: 0, lastSeenBucket: 0, ruleIds: [] },
    ]);
    for (let i = 0; i < BUDGETS.maxHostsPerDocument + 3; i++) h.apply(net('h' + String(i) + '.com'));
    expect(h.report('7:0:' + D1)?.hosts.length).toBe(BUDGETS.maxHostsPerDocument);
    expect(h.report('7:0:' + D1)?.dropped.hosts).toBe(4);

    h.apply(net('worker.example', { tabId: -1, documentId: null }));
    expect(h.state.unattributed.requests).toBe(1);
    // sub_frame loads attribute to the parent document.
    h.apply(commitEv({ tabId: 8, documentId: D2 }));
    h.apply(net('frame.com', { tabId: 8, frameId: 5, documentId: D3, parentFrameId: 0, parentDocumentId: D2, resourceType: 'sub_frame' }));
    expect(h.report('8:0:' + D2)?.hosts[0]?.registrableDomain).toBe('frame.com');
  });
});

describe('reducer: retention and revoke', () => {
  it('ttl-tick evicts inactive (unbound) documents after 10 min; bound documents stay; re-commit is truncated', () => {
    const h = new Harness();
    h.apply(commitEv({ at: 0 }));
    h.apply(commitEv({ documentId: D2, at: 100 })); // D1 becomes unbound at 100
    h.apply({ type: 'ttl-tick', at: 100 + BUDGETS.inactiveDocumentTtlMs - 1 });
    expect(h.report('7:0:' + D1)).toBeDefined();
    const r = h.apply({ type: 'ttl-tick', at: 100 + BUDGETS.inactiveDocumentTtlMs });
    expect(h.report('7:0:' + D1)).toBeUndefined();
    expect(h.report('7:0:' + D2)).toBeDefined();
    expect(r.effects).toContainEqual({ type: 'remove', documentKeys: ['7:0:' + D1] });
    // BFCache return after expiry: a fresh report marked truncated.
    h.apply(commitEv({ documentId: D1, at: 900_000 }));
    expect(h.report('7:0:' + D1)?.coverageFlags).toEqual(['truncated']);
    expect(h.report('7:0:' + D1)?.coverageState).toBe('degraded');
  });

  it('planEviction orders unbound LRU first, then bound unprojected, never the projected document', () => {
    const h = new Harness();
    h.apply(commitEv({ at: 0 }));
    h.apply(commitEv({ frameId: 4, documentId: D3, frameType: 'sub_frame', parentDocumentId: D1, at: 50 }));
    h.apply(commitEv({ documentId: D2, at: 100 }));
    expect(planEviction(h.state)).toEqual(['7:0:' + D1, '7:4:' + D3]);
    expect(isProjected(h.state, '7:0:' + D2)).toBe(true);
    const evicted = h.apply({ type: 'document:evict', documentKeys: ['7:0:' + D1], at: 200 });
    expect(evicted.effects).toContainEqual({ type: 'remove', documentKeys: ['7:0:' + D1] });
    expect(h.state.evictedKeys).toEqual(['7:0:' + D1]);
  });

  it('scope:revoked purges the document data, keeps no-access/revoked status and stops further batches', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(batchEv(ctx(), batchOf(1, [obs({ count: 3 })])));
    h.apply({
      type: 'network:host',
      tabId: 7,
      frameId: 0,
      documentId: D1,
      parentFrameId: -1,
      parentDocumentId: null,
      resourceType: 'script',
      host: 'cdn.example',
      at: 1200,
    });
    const r = h.apply({ type: 'scope:revoked', documentKeys: ['7:0:' + D1], at: 2000 });
    expect(r.effects).toContainEqual({ type: 'persist', documentKey: '7:0:' + D1, immediate: true });
    const report = h.report('7:0:' + D1);
    expect(report?.counters).toEqual([]);
    expect(report?.hosts).toEqual([]);
    expect(report?.watermark).toBeNull();
    expect(report?.coverageState).toBe('no-access');
    expect(report?.coverageFlags).toEqual(['revoked']);
    const next = h.apply(batchEv(ctx(), batchOf(2, [obs({ count: 9 })]), 2100));
    expect(next.batch).toMatchObject({ status: 'revoked', paused: true, protocolOk: false, lastCommittedBatchSeq: 0 });
    expect(h.report('7:0:' + D1)?.counters).toEqual([]);
  });

  it('document:degraded truncates details and sets degraded; counters are kept', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(batchEv(ctx(), batchOf(1, [obs({ count: 3 })])));
    for (let i = 0; i < 4; i++) {
      h.apply({ type: 'network:host', tabId: 7, frameId: 0, documentId: D1, parentFrameId: -1, parentDocumentId: null, resourceType: 'script', host: 'h' + String(i) + '.com', at: 1100 });
    }
    h.apply({ type: 'document:degraded', documentKey: '7:0:' + D1, truncate: true, at: 3000 });
    const r = h.report('7:0:' + D1);
    expect(r?.coverageState).toBe('degraded');
    expect(r?.coverageFlags).toContain('truncated');
    expect(r?.hosts.length).toBe(2);
    expect(r?.dropped.hosts).toBe(2);
    expect(r?.counters.length).toBe(1);
  });

  it('never mutates the previous state object (purity)', () => {
    const h = new Harness();
    h.apply(commitEv());
    const before = h.state;
    const beforeReport = before.reports.get('7:0:' + D1);
    const snapshot = JSON.stringify(beforeReport);
    h.apply(batchEv(ctx(), batchOf(1, [obs({ count: 3 })])));
    expect(JSON.stringify(before.reports.get('7:0:' + D1))).toBe(snapshot);
    expect(before.reports.get('7:0:' + D1)).toBe(beforeReport);
  });
});

describe('audit regressions: document integrity and retention', () => {
  it.each(['revoked', 'paused', 'no-host-permission', 'restricted-page', 'truncated', 'late-start'] as const)(
    'F010/F011: page flag %s cannot claim browser control or retention loss', (flag) => {
      const h = new Harness();
      h.apply(commitEv());
      h.apply(batchEv(ctx(), batchOf(1, [obs()], { coverageDelta: [flag] })));
      expect(h.report('7:0:' + D1)?.coverageState).toBe('active');
      expect(h.report('7:0:' + D1)?.coverageFlags).not.toContain(flag);
      h.apply({ type: 'scope:revoked', documentKeys: ['7:0:' + D1], at: 2000 });
      expect(h.report('7:0:' + D1)?.coverageState).toBe('no-access');
      expect(h.apply(batchEv(ctx(), batchOf(2, [obs()]))).batch?.status).toBe('revoked');
    },
  );

  it.each(['throttled', 'channel-gap', 'protocol-mismatch', 'bridge-ring-overflow', 'budget-exceeded'] as const)(
    'F009: loss flag %s outranks trusted late injection', (flag) => {
      const h = new Harness();
      h.apply(commitEv());
      h.apply({ type: 'injection:late', documentKeys: ['7:0:' + D1], at: 1100 });
      h.apply(batchEv(ctx(), batchOf(1, [obs()], { coverageDelta: [flag] })));
      expect(h.report('7:0:' + D1)?.coverageState).toBe('degraded');
    },
  );

  it('F015: pause rejects both existing and new destinations without effects or timestamps; resume accepts', () => {
    const h = new Harness();
    h.apply(commitEv());
    const net = (host: string, at: number): DocumentEvent => ({ type: 'network:host', tabId: 7, frameId: 0, documentId: D1,
      parentDocumentId: null, parentFrameId: -1, resourceType: 'script', host, at });
    h.apply(net('first.example', 1100));
    h.apply({ type: 'ui:pause', documentKey: '7:0:' + D1, at: 1200 });
    const before = h.report('7:0:' + D1);
    expect(h.apply(net('first.example', 1300)).effects).toEqual([]);
    expect(h.apply(net('new.example', 1400)).effects).toEqual([]);
    expect(h.report('7:0:' + D1)).toBe(before);
    h.apply({ type: 'ui:resume', documentKey: '7:0:' + D1, at: 1500 });
    h.apply(net('first.example', 1600));
    expect(h.report('7:0:' + D1)?.hosts[0]).toMatchObject({ requestCount: 2, firstSeenBucket: 0, lastSeenBucket: 0 });
  });

  it('F095: missing IDs after a commit stay unattributed; explicit old identity remains old', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(commitEv({ documentId: D2, at: 2000 }));
    const net: DocumentEvent = { type: 'network:host', tabId: 7, frameId: 0, documentId: null,
      parentDocumentId: null, parentFrameId: -1, resourceType: 'script', host: 'third.example', at: 2100 };
    h.apply(net);
    expect(h.state.unattributed.requests).toBe(1);
    expect(h.report('7:0:' + D2)?.hosts).toEqual([]);
    h.apply({ ...net, documentId: D1 });
    expect(h.report('7:0:' + D1)?.hosts).toHaveLength(1);
    expect(h.report('7:0:' + D2)?.hosts).toEqual([]);
  });

  it('F169: fifth boot is rejected at capacity; replay of the oldest boot cannot double count', () => {
    const h = new Harness();
    h.apply(commitEv());
    for (let i = 1; i <= 5; i++) h.apply(batchEv(ctx(), batchOf(i, [obs({ count: 10 })], { sensorBootId: 'boot-' + i })));
    expect(h.count('7:0:' + D1)).toBe(40);
    expect(h.state.metas.get('7:0:' + D1)?.boots).toHaveLength(4);
    expect(h.state.metas.get('7:0:' + D1)?.folded).toEqual({});
    h.apply(batchEv(ctx(), batchOf(6, [obs({ count: 10 })], { sensorBootId: 'boot-1' })));
    expect(h.count('7:0:' + D1)).toBe(40);
    expect(h.report('7:0:' + D1)?.coverageState).toBe('degraded');
    expect(h.report('7:0:' + D1)?.counters[0]?.countQuality).toBe('lower-bound');
  });

  it.each(['commit', 'sender'] as const)('F012: nonzero prerender activation via %s retains counters and session sequence', (order) => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(commitEv({ frameId: 3, frameType: 'sub_frame', documentId: D3, parentDocumentId: D1 }));
    h.apply(commitEv({ frameId: 41, documentId: D2, documentLifecycle: 'prerender' }));
    h.apply(batchEv(ctx({ frameId: 41, documentId: D2, documentLifecycle: 'prerender' }), batchOf(1, [obs({ count: 5 })])));
    if (order === 'commit') h.apply(commitEv({ documentId: D2, at: 2000 }));
    h.apply(batchEv(ctx({ documentId: D2 }), batchOf(2, [obs({ count: 6 })])));
    if (order === 'sender') h.apply(commitEv({ documentId: D2, at: 2000 }));
    expect(h.count('7:0:' + D2)).toBe(6);
    expect(h.report('7:0:' + D2)?.dropped.batches).toBe(0);
    expect(h.state.bindings.has('7:41:p')).toBe(false);
    expect(h.state.reports.has('7:41:' + D2)).toBe(false);
    expect(h.state.metas.get('7:3:' + D3)?.bound).toBe(false);
    expect(selectDocumentKey(h.state, 7)).toBe('7:0:' + D2);
    h.apply(batchEv(ctx({ frameId: 41, documentId: D2, documentLifecycle: 'prerender' }), batchOf(1, [obs({ count: 5 })])));
    expect(h.count('7:0:' + D2)).toBe(6);
  });

  it('F013/F017/F096: iframe churn is bounded; top replacement detaches descendants and TTL reclaims them', () => {
    const h = new Harness();
    h.apply(commitEv());
    for (let i = 1; i <= 1500; i++) h.apply(commitEv({ frameId: i, documentId: 'frame-' + i, frameType: 'sub_frame', parentDocumentId: D1, at: 1200 }));
    expect(h.state.bindings.size).toBeLessThanOrEqual(128);
    expect(h.state.reports.size).toBeLessThanOrEqual(128);
    expect(h.report('7:0:' + D1)?.coverageFlags).toContain('budget-exceeded');
    h.apply(commitEv({ documentId: D2, at: 2000 }));
    expect(h.state.bindings.size).toBe(1);
    h.apply({ type: 'ttl-tick', at: 2000 + BUDGETS.inactiveDocumentTtlMs });
    expect(h.state.reports.size).toBe(1);
    expect(selectDocumentKey(h.state, 7)).toBe('7:0:' + D2);
  });

  it('F096: navigation reusing a frame cannot bypass the report admission cap', () => {
    const h = new Harness();
    for (let i = 0; i < 1200; i++) h.apply(commitEv({ documentId: 'doc-' + i, at: i }));
    expect(h.state.reports.size).toBeLessThanOrEqual(1024);
    expect(h.state.metas.size).toBeLessThanOrEqual(1024);
    expect(selectDocumentKey(h.state, 7)).toBe('7:0:doc-1199');
  });

  it('F017: cancellation detaches only the browser-identified prerender; ordinary abort preserves active report', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(commitEv({ frameId: 41, documentId: D2, documentLifecycle: 'prerender', at: 2000 }));
    h.apply({ type: 'navigation:error', tabId: 7, frameId: 41, documentId: D2, at: 2100 });
    expect(h.state.metas.get('7:41:' + D2)?.bound).toBe(false);
    expect(h.state.bindings.has('7:41:p')).toBe(false);
    expect(selectDocumentKey(h.state, 7)).toBe('7:0:' + D1);
  });
});
