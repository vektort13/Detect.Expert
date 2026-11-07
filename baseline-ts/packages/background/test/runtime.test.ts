import { coverageRef } from '../../engine/src/coverage';
import { runRules } from '../../engine/src/rules';
import { BUDGETS, SIGNAL_CODES, TECHNIQUE_IDS, counterKey } from '@detect-expert/contracts';
import type { Finding, PageBatch, PageObservation } from '@detect-expert/contracts';
import { describe, expect, it, vi } from 'vitest';
import { BackgroundRuntime, SessionRepository, readStoredDocument, route } from '../src/index';
import type { PageSenderContext } from '../src/index';
import { FakeStorageArea, committed, createFakeChrome, settle } from './fake-chrome';
import { PRO_STORAGE_KEY } from '../src/pro-recording';

const D1 = 'DOC000000000000000000000000000001';
const D2 = 'DOC000000000000000000000000000002';
const KEY1 = '7:0:' + D1;

describe('ADR-023 separate scenario budget', () => {
  it('does not truncate Light reports just because the separately bounded Pro recording exists', async () => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch(committedEvent(D1, clock.t));
    await runtime.handleBatch(ctx(), batchOf(1));
    vi.spyOn(runtime.pro, 'hasSession').mockReturnValue(true);
    fake.session.data.set(PRO_STORAGE_KEY, { data: 'x'.repeat(1024 * 1024) });
    fake.session.bytesInUseOverride = BUDGETS.maxSessionTotalBytes + 100;
    await runtime.enforceTotalBudget(true);
    expect(runtime.state.reports.get(KEY1)?.coverageFlags).not.toContain('truncated');
    expect(runtime.diagnostics().lastMeasuredBytes).toBe(BUDGETS.maxSessionTotalBytes + 100);
    runtime.stop();
  });
});

function ctx(over: Partial<PageSenderContext> = {}): PageSenderContext {
  const tabId = over.tabId ?? 7;
  const frameId = over.frameId ?? 0;
  const documentId = over.documentId ?? D1;
  return { tabId, frameId, documentId, documentKey: `${tabId}:${frameId}:${documentId}`, host: 'example.com', originPattern: 'https://example.com/*', documentLifecycle: 'active', frameType: null, ...over };
}

function obs(over: Partial<PageObservation> = {}): PageObservation {
  return { techniqueId: 'DET-001', count: 1, countQuality: 'exact', phase: 'attempted', signalCodes: ['api-use'], intervalBucket: 1, ...over };
}

function batchOf(batchSeq: number, observations: PageObservation[] = [obs()], over: Partial<PageBatch> = {}): PageBatch {
  return { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'boot-1', bridgeSessionId: 'bridge-1', batchSeq, observations, coverageDelta: [], ...over };
}

function makeClock(start = 1_000_000) {
  return {
    t: start,
    now() {
      return this.t;
    },
  };
}

async function started(fake = createFakeChrome(), clock = makeClock()) {
  fake.grantedOrigins.add('https://example.com/*');
  fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
  const runtime = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
  await runtime.start();
  return { runtime, fake, clock };
}

describe('SessionRepository', () => {
  it('serializes tasks per document and runs different documents independently', async () => {
    const repo = new SessionRepository(new FakeStorageArea());
    const order: string[] = [];
    const slow = repo.run('a', async () => {
      await settle(10);
      order.push('a1');
    });
    const second = repo.run('a', async () => {
      order.push('a2');
    });
    const other = repo.run('b', async () => {
      order.push('b1');
    });
    await Promise.all([slow, second, other]);
    expect(order).toEqual(['b1', 'a1', 'a2']);
    // A rejected task does not block the queue.
    await repo.run('a', async () => {
      throw new Error('x');
    }).catch(() => undefined);
    await repo.run('a', async () => {
      order.push('a3');
    });
    expect(order.at(-1)).toBe('a3');
  });

  it('discards records with an unknown version or a broken shape without throwing', async () => {
    const storage = new FakeStorageArea();
    storage.data.set('doc:1:0:X', { v: 2, report: {}, meta: {} });
    storage.data.set('doc:1:0:Y', 'garbage');
    storage.data.set('index', { v: 1, bindings: 'no', tabs: [] });
    const repo = new SessionRepository(storage);
    const loaded = await repo.loadAll();
    expect(loaded.documents).toEqual([]);
    expect(loaded.index).toBeNull();
    expect(loaded.discarded).toBe(3);
    expect(readStoredDocument('doc:k', { v: 1, report: { schemaVersion: 1, documentKey: 'other' }, meta: {} })).toBeNull();
  });
});

describe('BackgroundRuntime persistence (E05-02)', () => {
  it('P07: validated batches awaiting hydration are bounded and excess is counted after readiness', async () => {
    const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
    fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
    fake.tabList = [{ id: 7 }];
    fake.framesByTab.set(7, [committed()]);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const original = fake.session.get.bind(fake.session);
    fake.session.get = async (keys) => { if (keys !== 'data-consent:pending-v1') await held; return original(keys); };
    const clock = makeClock();
    const runtime = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
    const starting = runtime.start();
    await vi.waitFor(() => expect(runtime.scope.dataConsentLoaded).toBe(true));
    let answered = 0;
    const requests = Array.from({ length: 160 }, (_, i) => {
      if (i % 10 === 0) clock.t += 1000;
      return route(runtime, batchOf(i + 1, [obs({ count: i + 1 })]), {
        id: fake.runtime.id, tab: { id: 7 }, frameId: 0, documentId: D1,
        origin: 'https://example.com', url: 'https://example.com/', documentLifecycle: 'active',
      }).then((reply) => { answered++; return reply; });
    });
    await settle();
    expect(answered).toBe(160 - BUDGETS.maxOutOfOrderEntriesGlobal);
    expect(runtime.diagnostics()).toMatchObject({ pendingDropped: 32, pendingPageBatches: 128 });
    release();
    await starting;
    const replies = await Promise.all(requests);
    expect(replies.slice(0, 128).every((reply) => reply.type === 'ack' && reply.lastCommittedBatchSeq > 0)).toBe(true);
    expect(replies.slice(128).every((reply) => reply.type === 'ack' && reply.lastCommittedBatchSeq === 0)).toBe(true);
    const report = runtime.state.reports.get(KEY1)!;
    expect(report.counters[0]?.count).toBe(128);
    expect(report.watermark?.lastCommittedBatchSeq).toBe(128);
    expect(report.dropped.transport).toBe(32);
    expect(report.coverageFlags).toContain('throttled');
    expect(readStoredDocument('doc:' + KEY1, fake.session.data.get('doc:' + KEY1))?.report.watermark?.lastCommittedBatchSeq).toBe(128);
    expect(runtime.diagnostics().pendingPageBatches).toBe(0);
    runtime.stop();
  });

  it('P07: malformed startup traffic neither waits for hydration nor records data outside scope', async () => {
    const fake = createFakeChrome();
    fake.tabList = [{ id: 7 }];
    fake.framesByTab.set(7, [committed()]);
    const runtime = new BackgroundRuntime(fake, { ttlIntervalMs: 0, persistDebounceMs: 1 });
    await runtime.scope.load();
    const reply = await route(runtime, { ...batchOf(1), observations: 'invalid' }, {
      id: fake.runtime.id, tab: { id: 7 }, frameId: 0, documentId: D1,
      origin: 'https://example.com', url: 'https://example.com/', documentLifecycle: 'active',
    });
    expect(reply).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 0 });
    expect(runtime.diagnostics().pendingPageBatches).toBe(0);
    await runtime.start();
    expect(runtime.state.reports.get(KEY1)).toMatchObject({ host: null, counters: [], dropped: { transport: 0 } });
    runtime.stop();
  });

  it('P02: repeated event sweeps are constant work between bounded full scans', async () => {
    const { runtime, clock } = await started();
    runtime.dispatch(committedEvent(D1, clock.t));
    const meta = runtime.state.metas.get(KEY1)!;
    runtime.state = { ...runtime.state, metas: new Map(Array.from({ length: 1024 }, (_, i) => {
      const key = '7:0:perf-' + i;
      return [key, { ...meta, documentKey: key, bound: true }];
    })) };
    const scans: number[] = [];
    const amortized: number[] = [];
    for (let sample = 0; sample < 20; sample++) {
      clock.t += 30_000;
      const fullStart = performance.now();
      runtime.sweepExpired(clock.t);
      scans.push(performance.now() - fullStart);
      const state = runtime.state;
      const start = performance.now();
      for (let event = 0; event < 10_000; event++) runtime.sweepExpired(clock.t);
      amortized.push((performance.now() - start) / 10_000);
      expect(runtime.state).toBe(state);
    }
    const stats = (values: number[]) => {
      values.sort((a, b) => a - b);
      return { p50Ms: values[9], p95Ms: values[18] };
    };
    console.log('P02 sweep measurements: ' + JSON.stringify({ documents: 1024, samples: 20, scan: stats(scans), amortizedEvent: stats(amortized) }));
    runtime.stop();
  });

  it.each(['navigation', 'tab-removed', 'batch', 'ui'] as const)('P02: %s sweeps expired history with a 30 second amortization window', async (trigger) => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch(committedEvent(D1, clock.t));
    await runtime.handleBatch(ctx(), batchOf(1));
    runtime.dispatch(committedEvent(D2, clock.t));
    const triggerEvent = async () => {
      if (trigger === 'navigation') runtime.dispatch(committedEvent(D2, clock.t));
      if (trigger === 'tab-removed') runtime.dispatch({ type: 'tab:removed', tabId: 99, at: clock.t });
      if (trigger === 'batch') await runtime.handleBatch(ctx({ documentId: D2 }), batchOf(1));
      if (trigger === 'ui') await route(runtime, { schemaVersion: 1, type: 'ui-get-scope' }, {
        id: fake.runtime.id, origin: 'chrome-extension://' + fake.runtime.id,
        url: 'chrome-extension://' + fake.runtime.id + '/options.html',
      });
    };
    clock.t += BUDGETS.inactiveDocumentTtlMs - 1;
    await triggerEvent();
    expect(runtime.state.reports.has(KEY1)).toBe(true);
    clock.t += 1;
    for (let i = 0; i < 20; i++) await triggerEvent();
    expect(runtime.state.reports.has(KEY1)).toBe(true);
    clock.t += 29_999;
    await triggerEvent();
    await settle(10);
    await runtime.flushIndex();
    expect(runtime.state.reports.has(KEY1)).toBe(false);
    expect(fake.session.data.has('doc:' + KEY1)).toBe(false);
    expect(runtime.buildIndex().bindings.some((b) => b.documentKey === KEY1)).toBe(false);
    expect(runtime.state.reports.has('7:0:' + D2)).toBe(true);
    runtime.stop();
  });

  it('P02: measured session usage takes precedence over JSON sizes and accounts for index/other keys', async () => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch(committedEvent(D1, clock.t));
    await runtime.handleBatch(ctx(), batchOf(1));
    runtime.dispatch(committedEvent(D2, clock.t));
    await settle(10);
    const usage = vi.spyOn(fake.session, 'getBytesInUse').mockImplementation(async (keys) => {
      if (keys === null) return BUDGETS.maxSessionTotalBytes + 100_000;
      return 200_000; // Chrome memory estimate deliberately differs from this tiny JSON report.
    });
    await runtime.enforceTotalBudget(true);
    await settle(10);
    expect(usage).toHaveBeenCalledWith(null);
    expect(usage).toHaveBeenCalledWith(['doc:' + KEY1]);
    expect(runtime.state.reports.has(KEY1)).toBe(false);
    expect(runtime.state.reports.get('7:0:' + D2)?.coverageFlags).not.toContain('truncated');
    usage.mockRejectedValue(new Error('unavailable'));
    await runtime.enforceTotalBudget(true);
    expect(runtime.diagnostics().lastMeasuredBytes).toBeNull();
    expect(runtime.state.reports.has('7:0:' + D2)).toBe(true);
    runtime.stop();
  });

  it.each(['activation', 'removal'] as const)('P02: budget measurement revalidates victims after concurrent %s', async (change) => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch(committedEvent(D1, clock.t));
    await runtime.handleBatch(ctx(), batchOf(1));
    runtime.dispatch(committedEvent(D2, clock.t));
    await settle(10);
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let measuring = false;
    vi.spyOn(fake.session, 'getBytesInUse').mockImplementation(async (keys) => {
      if (keys === null) return BUDGETS.maxSessionTotalBytes + 1;
      measuring = true;
      await blocked;
      throw new Error('measurement unavailable');
    });
    const budget = runtime.enforceTotalBudget(true);
    await vi.waitFor(() => expect(measuring).toBe(true));
    if (change === 'activation') runtime.dispatch(committedEvent(D1, clock.t));
    else runtime.dispatch({ type: 'tab:removed', tabId: 7, at: clock.t });
    release();
    await expect(budget).resolves.toBeUndefined();
    if (change === 'activation') {
      expect(runtime.state.reports.has(KEY1)).toBe(true);
      expect(runtime.getProjection(7)?.documentKey).toBe(KEY1);
    } else expect(runtime.state.reports.size).toBe(0);
    runtime.stop();
  });

  it('P02: hydration expires a stale bound snapshot and removes its closed tab projection in one sweep', async () => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch(committedEvent(D1, clock.t));
    await runtime.handleBatch(ctx(), batchOf(1));
    await runtime.flushIndex();
    runtime.stop();
    clock.t += BUDGETS.inactiveDocumentTtlMs;
    fake.tabList = [];
    const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0 });
    await next.start();
    await settle(10);
    await next.flushIndex();
    expect(next.state.reports.has(KEY1)).toBe(false);
    expect(next.state.tabs.has(7)).toBe(false);
    expect(fake.session.data.has('doc:' + KEY1)).toBe(false);
    expect(next.buildIndex().bindings).toEqual([]);
    expect(next.state.evictedKeys).toContain(KEY1);
    next.stop();
  });

  it.each(['reject', 'null'] as const)('P02: unavailable frame enumeration (%s) cannot prove a bound document expired', async (failure) => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch(committedEvent(D1, clock.t));
    await runtime.handleBatch(ctx(), batchOf(1, [obs({ count: 9 })]));
    await runtime.flushIndex();
    runtime.stop();
    clock.t += BUDGETS.inactiveDocumentTtlMs;
    fake.tabList = [{ id: 7 }];
    vi.spyOn(fake.webNavigation, 'getAllFrames').mockImplementation(async () => {
      if (failure === 'reject') throw new Error('browser unavailable');
      return null;
    });
    const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0 });
    await next.start();
    // Unverified access still follows the existing fail-closed scope policy; it is not TTL evidence.
    expect(next.state.reports.get(KEY1)?.documentKey).toBe(KEY1);
    expect(next.state.reports.get(KEY1)?.coverageFlags).toContain('revoked');
    expect(next.state.reports.get(KEY1)?.counters).toEqual([]);
    expect(next.state.evictedKeys).not.toContain(KEY1);
    expect(next.state.metas.get(KEY1)?.bound).toBe(true);
    expect(next.diagnostics().degraded).toBe(true);
    expect(fake.session.data.has('doc:' + KEY1)).toBe(true);
    next.stop();
  });

  it('P02: concurrent close remeasures usage before truncating another active tab', async () => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch(committedEvent(D1, clock.t));
    await runtime.handleBatch(ctx(), batchOf(1));
    runtime.dispatch(committedEvent(D2, clock.t));
    const survivor = '8:0:survivor';
    runtime.dispatch({ ...committedEvent('survivor', clock.t), tabId: 8 });
    await settle(10);
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let measuring = false;
    vi.spyOn(fake.session, 'getBytesInUse').mockImplementation(async (keys) => {
      if (keys === null) return runtime.state.reports.has(KEY1) ? BUDGETS.maxSessionTotalBytes + 1 : 2000;
      measuring = true;
      await blocked;
      return 0;
    });
    const budget = runtime.enforceTotalBudget(true);
    await vi.waitFor(() => expect(measuring).toBe(true));
    runtime.dispatch({ type: 'tab:removed', tabId: 7, at: clock.t });
    release();
    await budget;
    expect(runtime.state.reports.get(survivor)?.coverageFlags).not.toContain('truncated');
    expect(runtime.diagnostics().lastMeasuredBytes).toBe(2000);
    runtime.stop();
  });

  it('quota error -> degraded + truncated, LRU eviction, bounded retry (no infinite loop), ack stays behind', async () => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch({ ...committedEvent(D2, 0), at: 0 });
    runtime.dispatch(committedEvent(D1, 100)); // D2 becomes inactive (LRU victim)
    await runtime.handleBatch(ctx(), batchOf(1));
    await settle(5);
    const setsBefore = fake.session.setCalls.length;
    fake.session.failNextSets = 100;
    const ack = await runtime.handleBatch(ctx(), batchOf(2, [obs({ count: 7 })]));
    expect(ack).toEqual({ schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: 1, paused: false, protocolOk: true });
    expect(fake.session.failNextSets).toBe(100 - 3); // exactly maxPersistAttempts set() calls, then stop
    expect(fake.session.setCalls.length).toBe(setsBefore);
    const r = runtime.state.reports.get(KEY1);
    expect(r?.coverageState).toBe('degraded');
    expect(r?.coverageFlags).toContain('truncated');
    expect(r?.counters[0]?.count).toBe(7); // in memory, not acked
    expect(runtime.state.reports.has('7:0:' + D2)).toBe(false); // LRU inactive document evicted
    expect(runtime.diagnostics().persistFailures).toBe(3);
    // Storage recovers: the redelivered batch (duplicate in memory) persists and is acked.
    // F116: repeated attempts during cooldown neither write nor evict; recovery is delayed, not lost.
    const failures = runtime.diagnostics().persistFailures;
    await runtime.handleBatch(ctx(), batchOf(2, [obs({ count: 7 })]));
    expect(runtime.diagnostics().persistFailures).toBe(failures);
    clock.t += 5000;
    fake.session.failNextSets = 0;
    const retry = await runtime.handleBatch(ctx(), batchOf(2, [obs({ count: 7 })]));
    expect(retry).toMatchObject({ lastCommittedBatchSeq: 2 });
    expect((fake.session.data.get('doc:' + KEY1) as { report: { watermark: { lastCommittedBatchSeq: number } } }).report.watermark.lastCommittedBatchSeq).toBe(2);
  });

  it('keeps the total under 4 MiB by evicting inactive LRU documents when getBytesInUse reports pressure', async () => {
    const clock = makeClock();
    const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
    fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
    const { runtime } = await started(fake, clock);
    for (let i = 0; i < 5; i++) {
      clock.t += 1000;
      runtime.dispatch(committedEvent('DOC00000000000000000000000000000' + String(i), clock.t));
      await runtime.handleBatch(ctx({ documentId: 'DOC00000000000000000000000000000' + String(i) }), batchOf(1));
    }
    expect(runtime.state.reports.size).toBe(5);
    // Slightly over budget: exactly the least recently active (unbound) document is evicted first.
    fake.session.bytesInUseOverride = BUDGETS.maxSessionTotalBytes + 1;
    await runtime.enforceTotalBudget(true);
    await settle(5);
    expect(runtime.state.reports.size).toBe(4);
    expect(runtime.state.reports.has('7:0:DOC000000000000000000000000000000')).toBe(false);
    expect(fake.session.data.has('doc:7:0:DOC000000000000000000000000000000')).toBe(false);
    // Far over budget: every evictable document goes, the projected (active) document stays and is never evicted.
    fake.session.bytesInUseOverride = BUDGETS.maxSessionTotalBytes * 2;
    await runtime.enforceTotalBudget(true);
    await settle(5);
    expect(runtime.state.reports.size).toBe(1);
    expect(runtime.state.reports.has('7:0:DOC000000000000000000000000000004')).toBe(true);
    expect(runtime.state.reports.get('7:0:DOC000000000000000000000000000004')?.counters.length).toBe(1);
  });

  it('per-report budget (100 KiB): an oversized report is truncated before the write, counters survive', async () => {
    const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
    fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
    const fatEngine = {
      deriveFindings(): Finding[] {
        const out: Finding[] = [];
        for (let i = 0; i < 300; i++) {
          out.push({
            findingId: 'finding-' + String(i),
            ruleId: 'rule-canvas-readback',
            ruleVersion: '1.0.0',
            techniqueId: 'DET-001',
            interpretation: 'api-use',
            interpretationConfidence: 'low',
            evidenceIds: ['ev-0', 'ev-1', 'ev-2', 'ev-3', 'ev-4', 'ev-5', 'ev-6', 'ev-7'],
            counterEvidenceCodes: [],
            limitationCodes: [],
            vendorMatchIds: [],
          });
        }
        return out;
      },
    };
    const runtime = new BackgroundRuntime(fake, { engine: fatEngine, ttlIntervalMs: 0, persistDebounceMs: 1 });
    await runtime.start();
    runtime.dispatch(committedEvent(D1, 0));
    for (let i = 0; i < 128; i++) {
      runtime.dispatch({ type: 'network:host', tabId: 7, frameId: 0, documentId: D1, parentFrameId: -1, parentDocumentId: null, resourceType: 'script', host: 'h' + String(i) + 'x'.repeat(55) + '.com', at: 1 });
    }
    const ack = await runtime.handleBatch(ctx(), batchOf(1, [obs({ count: 5 })]));
    expect(ack).toMatchObject({ lastCommittedBatchSeq: 1, protocolOk: true });
    const r = runtime.state.reports.get(KEY1);
    expect(r?.findings.length).toBe(BUDGETS.maxFindingsPerDocument / 2); // 300 -> 256 (budget) -> 128 (truncation)
    expect(r?.dropped.findings).toBeGreaterThan(0);
    expect(r?.coverageFlags).toContain('truncated');
    expect(r?.coverageState).toBe('degraded');
    expect(r?.counters[0]?.count).toBe(5);
    expect(fake_size(runtime)).toBeLessThanOrEqual(BUDGETS.maxReportSerializedBytes);
    expect(fake.session.data.has('doc:' + KEY1)).toBe(true);
    const omitted = r?.dropped.findings;
    await runtime.handleBatch(ctx(), batchOf(2, [obs({ count: 6 })]));
    expect(runtime.state.reports.get(KEY1)?.dropped.findings).toBe(omitted);
    expect(runtime.state.reports.get(KEY1)?.findings.length).toBe(r?.findings.length);
    expect(fake_size(runtime)).toBeLessThanOrEqual(BUDGETS.maxReportSerializedBytes);
  });

  it('TTL sweep removes inactive documents after 10 minutes using the injected clock', async () => {
    const clock = makeClock();
    const { runtime, fake } = await started(createFakeChrome(), clock);
    runtime.dispatch(committedEvent(D1, clock.t));
    await runtime.handleBatch(ctx(), batchOf(1));
    clock.t += 1000;
    runtime.dispatch(committedEvent(D2, clock.t));
    await settle(10);
    clock.t += BUDGETS.inactiveDocumentTtlMs;
    runtime.ttlTick();
    await settle(10);
    expect(runtime.state.reports.has(KEY1)).toBe(false);
    expect(runtime.state.reports.has('7:0:' + D2)).toBe(true);
    expect(fake.session.data.has('doc:' + KEY1)).toBe(false);
  });

  it('hydration restores snapshots, watermarks and bindings; events before readiness are buffered (bounded)', async () => {
    const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
    fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
    const first = new BackgroundRuntime(fake, { ttlIntervalMs: 0, persistDebounceMs: 1 });
    await first.start();
    first.dispatch(committedEvent(D1, 10));
    await first.handleBatch(ctx(), batchOf(3, [obs({ count: 4 })]));
    await first.flushIndex();
    first.stop();

    // New SW life: the tab still shows the same document.
    fake.framesByTab.set(7, [{ frameId: 0, url: 'https://example.com/path', documentId: D1, frameType: 'outermost_frame', documentLifecycle: 'active', parentFrameId: -1 }]);
    fake.tabList = [{ id: 7 }];
    const second = new BackgroundRuntime(fake, { ttlIntervalMs: 0, persistDebounceMs: 1, maxPendingEvents: 2 });
    second.dispatch(committedEvent(D2, 20));
    second.dispatch(committedEvent(D2, 21));
    second.dispatch(committedEvent(D1, 22)); // overflow drops the oldest buffered event
    await second.start();
    expect(second.diagnostics().pendingDropped).toBe(1);
    expect(second.state.reports.get(KEY1)?.counters[0]?.count).toBe(4);
    expect(second.state.metas.get(KEY1)?.bound).toBe(true);
    // The persisted watermark survives: a replay of batch 3 is a no-op and acked at 3.
    expect(await second.handleBatch(ctx(), batchOf(3, [obs({ count: 4 })]))).toMatchObject({ lastCommittedBatchSeq: 3 });
    expect(await second.handleBatch(ctx(), batchOf(4, [obs({ count: 9 })]))).toMatchObject({ lastCommittedBatchSeq: 4 });
    expect(second.state.reports.get(KEY1)?.counters[0]?.count).toBe(9);
  });

  it('stale bindings from storage are dropped during reconciliation when the frame is gone', async () => {
    const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
    fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
    const first = new BackgroundRuntime(fake, { ttlIntervalMs: 0, persistDebounceMs: 1 });
    await first.start();
    first.dispatch(committedEvent(D1, 10));
    await first.handleBatch(ctx(), batchOf(1));
    await first.flushIndex();
    fake.tabList = []; // the tab was closed while the SW was dead
    const second = new BackgroundRuntime(fake, { ttlIntervalMs: 0, persistDebounceMs: 1 });
    await second.start();
    expect(second.state.metas.get(KEY1)?.bound).toBe(false);
    expect(second.state.bindings.size).toBe(0);
  });
});

function committedEvent(documentId: string, at: number) {
  const c = committed({ documentId, timeStamp: at });
  return {
    type: 'navigation:committed' as const,
    tabId: c.tabId,
    frameId: c.frameId,
    documentId,
    parentDocumentId: null,
    frameType: 'outermost_frame' as const,
    documentLifecycle: 'active' as const,
    host: 'example.com',
    at,
  };
}

function fake_size(runtime: BackgroundRuntime): number {
  const report = runtime.state.reports.get(KEY1);
  const meta = runtime.state.metas.get(KEY1);
  return JSON.stringify({ v: 1, report, meta }).length;
}

describe('audit regressions: persistence and projection', () => {
  it('F094/F024/F102: real engine references finalized coverage; projection strips unknown fields without guessing vendors', async () => {
    const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
    fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
    const seen: string[] = [];
    const runtime = new BackgroundRuntime(fake, { clock: makeClock(Date.parse('2026-09-13T12:00:00Z')), ttlIntervalMs: 0, engine: {
      deriveFindings(report) {
        seen.push(report.coverageState);
        return runRules({ counters: report.counters, coverageFlags: report.coverageFlags,
          coverageRef: coverageRef(report.coverageState, report.coverageFlags) }).findings;
      },
    } });
    await runtime.start();
    runtime.dispatch(committedEvent(D1, 1000));
    await runtime.handleBatch(ctx(), batchOf(1));
    expect(seen[0]).toBe('active');
    await runtime.handleBatch(ctx(), batchOf(2, [obs({ count: 2 })], { coverageDelta: ['budget-exceeded'] }));
    expect(seen.at(-1)).toBe('degraded');
    const report = runtime.state.reports.get(KEY1)!;
    expect(report.findings.length).toBeGreaterThan(0);
    for (const finding of report.findings) expect(finding.coverageRef).toBe(coverageRef(report.coverageState, report.coverageFlags));
    Object.assign(report.findings[0]!, { sampleLocations: ['SECRET_STACK_CANARY'] });
    const projection = runtime.getProjection(7)!;
    expect(projection.findings[0]?.limitationCodes).not.toContain('catalog-disabled');
    expect(projection.vendors).toEqual([]);
    expect(JSON.stringify(projection)).not.toContain('SECRET_STACK_CANARY');
    const exported = await runtime.exportPreview(7, KEY1, report.revision);
    expect(exported.type).toBe('export-preview');
    expect(JSON.stringify(exported)).not.toContain('SECRET_STACK_CANARY');
    report.findings[0]!.findingId = 'x'.repeat(600);
    expect(runtime.getProjection(7)).toBeNull();
    expect(await runtime.exportPreview(7, KEY1, report.revision)).toMatchObject({ type: 'error', code: 'not-found' });
    runtime.stop();
  });

  it('F104: interleaved sessions retain separate persisted ACKs through duplicate, failure and restart', async () => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch(committedEvent(D1, clock.t));
    const a = batchOf(1, [obs({ count: 2 })], { bridgeSessionId: 'session-A' });
    const b = batchOf(1, [obs({ count: 3 })], { bridgeSessionId: 'session-B' });
    await runtime.handleBatch(ctx(), a);
    await runtime.handleBatch(ctx(), b);
    expect(await runtime.handleBatch(ctx(), a)).toMatchObject({ lastCommittedBatchSeq: 1 });
    fake.session.failNextSets = 3;
    expect(await runtime.handleBatch(ctx(), { ...a, batchSeq: 2 })).toMatchObject({ lastCommittedBatchSeq: 1 });
    expect(runtime.lastPersistedSeq(KEY1, 'session-B')).toBe(1);
    fake.session.failNextSets = 0;
    clock.t += 5000;
    await runtime.handleBatch(ctx(), { ...a, batchSeq: 2 });
    await runtime.flushIndex();
    runtime.stop();
    fake.tabList = [{ id: 7 }];
    fake.framesByTab.set(7, [committed()]);
    const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0 });
    await next.start();
    expect(await next.handleBatch(ctx(), b)).toMatchObject({ lastCommittedBatchSeq: 1 });
    expect(await next.handleBatch(ctx(), a)).toMatchObject({ lastCommittedBatchSeq: 2 });
    expect(next.state.reports.get(KEY1)?.counters[0]?.count).toBe(3);
    next.stop();
  });

  it('F171/F092: expired history is removed before a restart rebind; restored sequence is not fictitious transport loss', async () => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch(committedEvent(D1, clock.t));
    await runtime.handleBatch(ctx(), batchOf(1, [obs({ count: 9 })]));
    clock.t += 1000;
    runtime.dispatch(committedEvent(D2, clock.t));
    await settle(10);
    await runtime.flushIndex();
    runtime.stop();
    clock.t += BUDGETS.inactiveDocumentTtlMs;
    fake.tabList = [{ id: 7 }];
    fake.framesByTab.set(7, [committed()]);
    const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
    await next.start();
    expect(next.state.reports.get(KEY1)?.coverageFlags).toContain('truncated');
    expect(next.state.reports.get(KEY1)?.counters).toEqual([]);
    expect(await next.handleBatch(ctx(), batchOf(37, [obs({ count: 10 })]))).toMatchObject({ lastCommittedBatchSeq: 37 });
    expect(next.state.reports.get(KEY1)?.dropped.batches).toBe(0);
    expect(next.state.reports.get(KEY1)?.coverageFlags).not.toContain('channel-gap');
    next.stop();
  });

  it('F092: clearing history records a bounded reset marker that survives restart', async () => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch(committedEvent(D1, clock.t));
    await runtime.handleBatch(ctx(), batchOf(1));
    await runtime.clearSession();
    runtime.stop();
    fake.tabList = [{ id: 7 }];
    fake.framesByTab.set(7, [committed()]);
    const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0 });
    await next.start();
    await next.handleBatch(ctx(), batchOf(37));
    expect(next.state.reports.get(KEY1)?.dropped.batches).toBe(0);
    expect(next.state.reports.get(KEY1)?.coverageFlags).toContain('truncated');
    next.stop();
  });

  it('F016/F022: hydration scrubs legacy literal IP and random-label network destinations', async () => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch(committedEvent(D1, clock.t));
    await runtime.handleBatch(ctx(), batchOf(1));
    await runtime.flushIndex();
    runtime.stop();
    const stored = fake.session.data.get('doc:' + KEY1) as { report: { hosts: unknown[] } };
    stored.report.hosts = ['10.0.0.5', '[fe80::1]', 'RANDOM_DNS_CANARY.dns.example'].map((host) => ({ host }));
    fake.tabList = [{ id: 7 }];
    fake.framesByTab.set(7, [committed()]);
    const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
    await next.start();
    await settle(10);
    expect(JSON.stringify([...fake.session.data])).not.toMatch(/10\.0\.0\.5|fe80|RANDOM_DNS_CANARY/);
    next.stop();
  });

  it('F027/F107: persistence rounds receipt times and export excludes sensitive local hosts', async () => {
    const { runtime, fake, clock } = await started();
    clock.t = 1_750_000_001_789;
    runtime.dispatch(committedEvent(D1, clock.t));
    await runtime.handleBatch(ctx(), batchOf(1));
    const stored = fake.session.data.get('doc:' + KEY1) as { report: { createdAt: number; updatedAt: number }; meta: { firstObservationAt: number; lastActivityAt: number } };
    expect(stored.report.createdAt % 1000).toBe(0);
    expect(stored.report.updatedAt % 1000).toBe(0);
    expect(stored.meta.firstObservationAt % 1000).toBe(0);
    expect(stored.meta.lastActivityAt % 1000).toBe(0);
    expect(runtime.buildIndex().savedAt % 1000).toBe(0);
    for (const host of ['hr-payroll.local', 'hr.internal', 'intranet', '192.168.1.1', '[::1]']) {
      const report = runtime.state.reports.get(KEY1)!;
      report.host = host;
      const preview = await runtime.exportPreview(7, KEY1, report.revision);
      expect(preview.type).toBe('export-preview');
      if (preview.type === 'export-preview') {
        expect(preview.preview.report.host).toBeNull();
        expect(preview.preview.documentOrdinal).toBe(1);
        expect(JSON.stringify(preview.preview)).not.toMatch(/documentKey|exportedAt|observedSince/);
        expect(JSON.stringify(preview)).not.toContain(host);
      }
    }
    runtime.stop();
  });

  it('F115: fake storage uses JSON serialization rather than structuredClone', async () => {
    const storage = new FakeStorageArea();
    await storage.set({ value: { absent: undefined, nested: [undefined], date: new Date(0), map: new Map([['x', 1]]) } });
    expect(await storage.get('value')).toEqual({ value: { nested: [null], date: '1970-01-01T00:00:00.000Z', map: {} } });
  });

  it('F026: rejected flood preserves state-map identity, projects pending drops and persists them for restart', async () => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch(committedEvent(D1, clock.t));
    await runtime.handleBatch(ctx(), batchOf(1));
    const reports = runtime.state.reports;
    for (let i = 0; i < 10_000; i++) runtime.countTransportDrop(KEY1);
    expect(runtime.state.reports).toBe(reports);
    expect(runtime.getProjection(7)?.dropped.transport).toBe(10_000);
    expect(runtime.getProjection(7)?.coverageState).toBe('degraded');
    await settle(10);
    await runtime.flushIndex();
    runtime.stop();
    fake.tabList = [{ id: 7 }];
    fake.framesByTab.set(7, [committed()]);
    const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0 });
    await next.start();
    expect(next.getProjection(7)?.dropped.transport).toBe(10_000);
    next.stop();
  });
});


describe('audit regression: serialized budgets', () => {
  it('F097: four boots persist every batch within budget and retain exact maxima after restart/replay', async () => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch(committedEvent(D1, clock.t));
    const codes = [...SIGNAL_CODES].sort((a, b) => b.length - a.length).slice(0, 8);
    let lastBatch = batchOf(0);
    let largestRecord = 0;
    let seq = 0;
    for (let boot = 0; boot < 4; boot++) {
      for (let group = 0; group < 4; group++) {
        const observations = Array.from({ length: 32 }, (_, j) => {
          const i = group * 32 + j;
          return obs({ techniqueId: TECHNIQUE_IDS[i % TECHNIQUE_IDS.length]!,
            phase: i < TECHNIQUE_IDS.length ? 'attempted' : 'returned-sync', signalCodes: codes, count: 10 });
        });
        seq++;
        lastBatch = batchOf(seq, observations, { sensorBootId: 'budget-boot-' + boot });
        const answer = await runtime.handleBatch(ctx(), lastBatch);
        expect(answer.lastCommittedBatchSeq).toBe(seq);
        const saved = fake.session.data.get('doc:' + KEY1) as { report: { watermark: { lastCommittedBatchSeq: number } | null } };
        expect(answer.lastCommittedBatchSeq).toBe(saved.report.watermark?.lastCommittedBatchSeq ?? 0);
        const bytes = new TextEncoder().encode(JSON.stringify(saved)).byteLength;
        largestRecord = Math.max(largestRecord, bytes);
        expect(bytes).toBeLessThanOrEqual(BUDGETS.maxReportSerializedBytes);
      }
    }
    const before = runtime.state.reports.get(KEY1)!;
    expect(before.counters).toHaveLength(128);
    expect(before.counters.every((counter) => counter.count === 40 && counter.countQuality === 'exact')).toBe(true);
    expect(before.coverageState).toBe('active');
    expect(before.coverageFlags).not.toContain('truncated');
    expect(Object.values(before.dropped).every((count) => count === 0)).toBe(true);
    await runtime.flushIndex();
    runtime.stop();
    fake.tabList = [{ id: 7 }];
    fake.framesByTab.set(7, [committed()]);
    const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
    await next.start();
    expect(await next.handleBatch(ctx(), lastBatch)).toMatchObject({ lastCommittedBatchSeq: 16 });
    expect(next.state.reports.get(KEY1)?.counters).toEqual(before.counters);
    const continued = obs({ techniqueId: TECHNIQUE_IDS[0]!, signalCodes: codes, count: 11 });
    expect(await next.handleBatch(ctx(), batchOf(17, [continued], { sensorBootId: 'budget-boot-0' }))).toMatchObject({ lastCommittedBatchSeq: 17 });
    expect(next.state.reports.get(KEY1)?.counters[0]?.count).toBe(41);
    expect(await next.handleBatch(ctx(), batchOf(18, [{ ...continued, count: 9 }], { sensorBootId: 'budget-boot-0' }))).toMatchObject({ lastCommittedBatchSeq: 18 });
    expect(next.state.reports.get(KEY1)?.counters[0]?.count).toBe(41);
    expect(readStoredDocument('doc:' + KEY1, fake.session.data.get('doc:' + KEY1))?.report.watermark?.lastCommittedBatchSeq).toBe(18);
    console.info('F097 snapshot evidence: ' + JSON.stringify({ batches: seq, counters: 128, boots: 4, largestRecord, limit: BUDGETS.maxReportSerializedBytes, resumedAck: 18, resumedCount: 41 }));
    next.stop();
  });

  it('F097: legacy counter-key storage migrates losslessly and rejects invalid slot references', async () => {
    const { runtime, fake, clock } = await started();
    runtime.dispatch(committedEvent(D1, clock.t));
    await runtime.handleBatch(ctx(), batchOf(1, [obs({ count: 5 })]));
    await runtime.handleBatch(ctx(), batchOf(2, [obs({ count: 7 })], { sensorBootId: 'boot-2' }));
    await runtime.flushIndex();
    const stored = readStoredDocument('doc:' + KEY1, fake.session.data.get('doc:' + KEY1))!;
    const canonical = counterKey('DET-001', 'attempted', ['api-use']);
    for (const boot of stored.meta.boots) boot.counts = { [canonical]: boot.counts['0']! };
    delete stored.meta.counterKeyFormat;
    fake.session.data.set('doc:' + KEY1, stored);
    runtime.stop();
    fake.tabList = [{ id: 7 }];
    fake.framesByTab.set(7, [committed()]);
    const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
    await next.start();
    expect(next.state.reports.get(KEY1)?.counters[0]?.count).toBe(12);
    expect(next.state.metas.get(KEY1)?.boots.map((boot) => boot.counts)).toEqual([{ '0': 5 }, { '0': 7 }]);
    expect(await next.handleBatch(ctx(), batchOf(2, [obs({ count: 7 })], { sensorBootId: 'boot-2' }))).toMatchObject({ lastCommittedBatchSeq: 2 });
    expect(await next.handleBatch(ctx(), batchOf(3, [obs({ count: 6 })]))).toMatchObject({ lastCommittedBatchSeq: 3 });
    expect(next.state.reports.get(KEY1)?.counters[0]?.count).toBe(13);
    const migrated = readStoredDocument('doc:' + KEY1, fake.session.data.get('doc:' + KEY1))!;
    expect(migrated.meta.counterKeyFormat).toBe('index-v1');
    for (const key of ['-1', '00', '1', 'Infinity']) {
      const corrupt = { ...migrated, meta: { ...migrated.meta, boots: [{ sensorBootId: 'boot-1', counts: { [key]: 1 } }] } };
      expect(readStoredDocument('doc:' + KEY1, corrupt)).toBeNull();
    }
    next.stop();
  });

  it('F026 measurement: rejecting 100k drops has no report-map copying at either state size', async () => {
    const timings: Array<{ reports: number; milliseconds: number }> = [];
    for (const count of [1, 256]) {
      const { runtime, clock } = await started();
      for (let i = 0; i < count; i++) runtime.dispatch(committedEvent('measurement-' + i, clock.t));
      const key = '7:0:measurement-' + (count - 1);
      const reports = runtime.state.reports;
      const start = performance.now();
      for (let i = 0; i < 100_000; i++) runtime.countTransportDrop(key);
      timings.push({ reports: reports.size, milliseconds: Number((performance.now() - start).toFixed(2)) });
      expect(runtime.state.reports).toBe(reports);
      expect(runtime.getProjection(7)?.dropped.transport).toBe(100_000);
      runtime.stop();
    }
    console.info('F026 rejection microbenchmark (100000 drops, observational): ' + JSON.stringify(timings));
  });
});
