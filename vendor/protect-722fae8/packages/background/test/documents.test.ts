import { BUDGETS } from '@detect-expert/contracts';
import type { PageBatch, PageObservation } from '@detect-expert/contracts';
import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  estimateReportBytes,
  hostAggregateKey,
  isProjected,
  noopEngine,
  planEviction,
  readStoredDocument,
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

  it('ADR-017: different operation codes are separate counters; no operation keeps the v1 counter shape', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(batchEv(ctx(), batchOf(1, [
      obs({ techniqueId: 'DET-025', phase: 'returned-sync', operationCode: 'user-agent', count: 2 }),
      obs({ techniqueId: 'DET-025', phase: 'returned-sync', operationCode: 'platform', count: 1 }),
      obs({ techniqueId: 'DET-025', phase: 'returned-sync', count: 4 }),
    ])));
    h.apply(batchEv(ctx(), batchOf(2, [obs({ techniqueId: 'DET-025', phase: 'returned-sync', operationCode: 'user-agent', count: 5 })])));
    const counters = h.report('7:0:' + D1)?.counters ?? [];
    expect(counters.map((c) => [c.operationCode, c.count])).toEqual([['user-agent', 5], ['platform', 1], [undefined, 4]]);
    expect(Object.prototype.hasOwnProperty.call(counters[2], 'operationCode')).toBe(false);
  });

  it('ADR-017: snapshots keep allowlisted operations, read legacy counters and reject an invalid operation', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(batchEv(ctx(), batchOf(1, [obs({ techniqueId: 'DET-011', phase: 'returned-sync', operationCode: 'param-renderer' })])));
    const key = '7:0:' + D1;
    const report = h.report(key)!;
    const meta = h.state.metas.get(key)!;
    const stored = (counters: unknown[]): unknown => JSON.parse(JSON.stringify({ v: 1, report: { ...report, counters }, meta }));
    const valid = readStoredDocument('doc:' + key, stored(report.counters));
    expect(valid?.report.counters[0]?.operationCode).toBe('param-renderer');
    const legacy = report.counters.map((c) => {
      const copy: Record<string, unknown> = { ...c };
      delete copy['operationCode'];
      return copy;
    });
    expect(readStoredDocument('doc:' + key, stored(legacy))?.report.counters[0]?.operationCode).toBeUndefined();
    for (const operationCode of ['bogus', 'https://x', '', 7, null, 'user-agent']) {
      const broken = report.counters.map((c) => ({ ...c, operationCode }));
      expect(readStoredDocument('doc:' + key, stored(broken)), String(operationCode)).toBeNull();
    }
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
    const cleared = h.apply({ type: 'ui:clear', documentKey: '7:0:' + D1, at: 2000 });
    expect(cleared.effects).toContainEqual({ type: 'remove', documentKeys: ['7:0:' + D1] });
    expect(h.report('7:0:' + D1)).toBeUndefined();
    const r = h.apply(batchEv(ctx(), batchOf(3, [obs()]), 2500));
    expect(r.batch?.status).toBe('committed');
    expect(h.report('7:0:' + D1)?.coverageFlags).toContain('truncated');
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

// S07 / ADR-018: browser-network counters, window patterns and the monotonic network-limited flag.
describe('reducer: browser-network counters (S07)', () => {
  type NetEvent = Extract<DocumentEvent, { type: 'network:host' }>;
  const net = (over: Partial<NetEvent> = {}): DocumentEvent => ({
    type: 'network:host', tabId: 7, frameId: 0, documentId: D1, parentFrameId: -1, parentDocumentId: null,
    resourceType: 'xmlhttprequest', host: 'vendor.net', relation: 'cross-site', at: 1100, ...over,
  });

  class CountingHarness extends Harness {
    runs = 0;
    override apply(event: DocumentEvent): ReduceResult {
      const r = reduce(this.state, event, { deriveFindings: () => { this.runs++; return []; } });
      this.state = r.state;
      this.last = r;
      return r;
    }
  }

  it('maps request classes to DET-058/059, local to DET-060, random subdomains to DET-061; buckets are seconds', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(net({ requestClass: 'socket', resourceType: 'websocket' }));
    h.apply(net({ requestClass: 'xhr' }));
    h.apply(net({ requestClass: 'beacon', resourceType: 'ping', at: 4500 }));
    h.apply(net({ requestClass: 'subresource', resourceType: 'image', host: '', category: 'private', local: { fromPublic: true, ports: 3, targets: 1 } }));
    h.apply(net({ requestClass: 'frame', resourceType: 'sub_frame' }));
    h.apply(net({ requestClass: 'subresource', resourceType: 'image', randomSubdomains: 5 }));
    const r = h.report('7:0:' + D1)!;
    expect(r.networkCounters).toEqual([
      { techniqueId: 'DET-058', phase: 'attempted', signalCodes: ['api-use'], count: 1, countQuality: 'exact', firstBucket: 0, lastBucket: 0 },
      { techniqueId: 'DET-059', phase: 'attempted', signalCodes: ['api-use'], count: 2, countQuality: 'exact', firstBucket: 0, lastBucket: 3 },
      { techniqueId: 'DET-060', phase: 'attempted', signalCodes: ['api-use'], count: 1, countQuality: 'exact', firstBucket: 0, lastBucket: 0 },
      { techniqueId: 'DET-061', phase: 'attempted', signalCodes: ['api-use'], count: 1, countQuality: 'exact', firstBucket: 0, lastBucket: 0 },
    ]);
    expect(r.networkPatterns).toEqual({ localPortsMax: 3, localTargetsMax: 1, randomSubdomainsMax: 5 });
    expect(r.counters).toEqual([]);
  });

  it('patterns keep the maximum, clamp to 32, and local fields count only from a public initiator', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(net({ requestClass: 'xhr', host: '', category: 'loopback', local: { fromPublic: false, ports: 30, targets: 30 } }));
    expect(h.report('7:0:' + D1)?.networkPatterns).toEqual({ localPortsMax: 0, localTargetsMax: 0, randomSubdomainsMax: 0 });
    expect(h.report('7:0:' + D1)?.networkCounters.map((c) => c.techniqueId)).toEqual(['DET-059', 'DET-060']);
    h.apply(net({ host: '', category: 'loopback', local: { fromPublic: true, ports: 6, targets: 2 } }));
    h.apply(net({ host: '', category: 'loopback', local: { fromPublic: true, ports: 2, targets: 99 } }));
    h.apply(net({ randomSubdomains: 1000 }));
    expect(h.report('7:0:' + D1)?.networkPatterns).toEqual({ localPortsMax: 6, localTargetsMax: 32, randomSubdomainsMax: 32 });
  });

  it('re-runs the engine only for a new counter key, a pattern change or a flag change', () => {
    const h = new CountingHarness();
    h.apply(commitEv());
    const base = h.runs;
    h.apply(net({ requestClass: 'xhr' }));
    expect(h.runs).toBe(base + 1);
    for (let i = 0; i < 20; i++) h.apply(net({ requestClass: 'xhr' }));
    h.apply(net({ requestClass: 'subresource', resourceType: 'image', host: 'cdn.other.net' }));
    expect(h.runs).toBe(base + 1);
    h.apply(net({ requestClass: 'xhr', randomSubdomains: 2 }));
    expect(h.runs).toBe(base + 2);
    h.apply(net({ requestClass: 'xhr', randomSubdomains: 2 }));
    expect(h.runs).toBe(base + 2);
    expect(h.report('7:0:' + D1)?.networkCounters.find((c) => c.techniqueId === 'DET-059')?.count).toBe(23);
  });

  it('network:limited is monotonic and only for documents with access', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(commitEv({ tabId: 8, documentId: D2, accessGranted: false }));
    h.apply({ type: 'network:limited', documentKeys: ['7:0:' + D1, '8:0:' + D2, 'missing'], at: 1200 });
    const r = h.report('7:0:' + D1)!;
    expect(r.coverageFlags).toEqual(['network-limited']);
    expect(h.report('8:0:' + D2)?.coverageFlags).not.toContain('network-limited');
    const revision = r.revision;
    h.apply({ type: 'network:limited', documentKeys: ['7:0:' + D1], at: 1300 });
    expect(h.report('7:0:' + D1)?.revision).toBe(revision);
    // Re-confirming access keeps the flag: earlier requests stayed unobserved.
    h.apply({ type: 'scope:access', documentKey: '7:0:' + D1, host: 'example.com', accessGranted: true, at: 1400 });
    expect(h.report('7:0:' + D1)?.coverageFlags).toContain('network-limited');
    h.apply(batchEv(ctx(), batchOf(1, [obs()])));
    expect(h.report('7:0:' + D1)?.coverageState).toBe('partial');
  });

  it('page observations of DET-058…061 are ignored and SW-only signals are stripped from page counters', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(batchEv(ctx(), batchOf(1, [
      obs({ techniqueId: 'DET-060', count: 50, signalCodes: ['api-use', 'local-multi-port'] }),
      obs({ techniqueId: 'DET-061', count: 9, signalCodes: ['api-use', 'unique-subdomains'] }),
      obs({ techniqueId: 'DET-058', count: 2 }),
      obs({ techniqueId: 'DET-059', count: 3 }),
      obs({ techniqueId: 'DET-001', count: 4, signalCodes: ['api-use', 'local-multi-port', 'unique-subdomains'] }),
    ])));
    const r = h.report('7:0:' + D1)!;
    expect(r.counters).toEqual([
      { techniqueId: 'DET-001', phase: 'attempted', signalCodes: ['api-use'], count: 4, countQuality: 'exact', firstBucket: 1, lastBucket: 1 },
    ]);
    expect(r.networkCounters).toEqual([]);
    expect(r.networkPatterns).toEqual({ localPortsMax: 0, localTargetsMax: 0, randomSubdomainsMax: 0 });
  });

  it('revocation zeroes the network fields; oversized network counters make the estimate Infinity', () => {
    const h = new Harness();
    h.apply(commitEv());
    h.apply(net({ requestClass: 'xhr', randomSubdomains: 9 }));
    h.apply({ type: 'scope:revoked', documentKeys: ['7:0:' + D1], at: 1500 });
    const r = h.report('7:0:' + D1)!;
    expect(r.networkCounters).toEqual([]);
    expect(r.networkPatterns).toEqual({ localPortsMax: 0, localTargetsMax: 0, randomSubdomainsMax: 0 });
    const meta = h.state.metas.get('7:0:' + D1)!;
    const counter = { techniqueId: 'DET-059' as const, phase: 'attempted' as const, signalCodes: ['api-use' as const], count: 1, countQuality: 'exact' as const, firstBucket: 0, lastBucket: 0 };
    expect(estimateReportBytes({ ...r, networkCounters: Array.from({ length: 8 }, () => counter) }, meta)).toBeLessThan(Infinity);
    expect(estimateReportBytes({ ...r, networkCounters: Array.from({ length: 9 }, () => counter) }, meta)).toBe(Infinity);
  });

  it('hostAggregateKey distinguishes representation and relation', () => {
    expect(hostAggregateKey({ registrableDomain: 'vendor.net', relation: 'cross-site' })).toBe('d:vendor.net|cross-site');
    expect(hostAggregateKey({ category: 'loopback', relation: 'same-site' })).toBe('c:loopback|same-site');
    expect(hostAggregateKey({ registrableDomain: 'vendor.net', relation: 'same-site' })).not.toBe(hostAggregateKey({ registrableDomain: 'vendor.net', relation: 'cross-site' }));
  });
});
