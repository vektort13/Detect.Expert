import { describe, expect, it, vi } from 'vitest';
import type { PageBatch } from '@detect-expert/contracts';
import { BackgroundRuntime } from '../src/runtime';
import { route } from '../src/handlers';
import { CLEAR_FENCES_KEY } from '../src/repository';
import { committed, createFakeChrome, pageSender } from './fake-chrome';

const D1 = 'DOC000000000000000000000000000001', D2 = 'DOC000000000000000000000000000002';
const KEY = '7:0:' + D1;
const batch = (count: number, sequence = 1, epoch = { bridgeSessionId: 'old-session', sensorBootId: 'old-boot' }): PageBatch => ({
  schemaVersion: 1, type: 'sensor-events', batchSeq: sequence, ...epoch,
  observations: [{ techniqueId: 'DET-001', phase: 'attempted', signalCodes: ['api-use'], count, countQuality: 'exact', intervalBucket: 1 }], coverageDelta: [],
});

async function setup() {
  const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
  fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
  fake.tabList = [{ id: 7 }]; fake.framesByTab.set(7, [committed()]);
  const clock = { t: 1_000_000, now() { return this.t; } };
  let epoch = { bridgeSessionId: 'unused-session', sensorBootId: 'unused-boot' }, resets = 0;
  const send = fake.tabs.sendMessage.bind(fake.tabs);
  fake.tabs.sendMessage = async (tabId, message, options) => {
    await send(tabId, message, options);
    const fields = message as { type?: string; command?: string; resetId?: string };
    if (fields.type === 'api-results-reset') return { schemaVersion: 1, type: 'api-results-reset-ack', epoch: 1 };
    if (fields.type !== 'bridge-control' || fields.command !== 'reset') return undefined;
    resets++; epoch = { bridgeSessionId: 'fresh-session-' + resets, sensorBootId: 'fresh-boot-' + resets };
    return { schemaVersion: 1, type: 'bridge-reset-ack', resetId: fields.resetId, bridgeSessionId: epoch.bridgeSessionId, sensorBootIds: [epoch.sensorBootId] };
  };
  const runtime = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 }); await runtime.start();
  expect(await route(runtime, batch(100), pageSender())).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 1 });
  return { runtime, fake, clock, fresh: () => epoch, resets: () => resets };
}

describe('production clear authority recovery and lifecycle', () => {
  it('does not migrate a captured old snapshot after data-consent purge completes during recovery', async () => {
    const { runtime, fake, clock } = await setup(); runtime.stop();
    const get = fake.session.get.bind(fake.session); let reads = 0, release!: () => void, entered!: () => void;
    const held = new Promise<void>(yes => { release = yes; }), reading = new Promise<void>(yes => { entered = yes; });
    fake.session.get = async keys => {
      if (keys === null) {
        reads++;
        if (reads === 1) throw Error('startup read failed');
        if (reads === 2) { const snapshot = await get(keys); entered(); await held; return snapshot; }
      }
      return get(keys);
    };
    const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0 }); await next.start();
    try {
      const pending = next.whenPageReady(KEY), rejected = expect(pending).rejects.toThrow('history-access-changed');
      await reading;
      expect(await next.changeDataConsent(false)).toBe(true);
      expect(fake.session.data.has('doc:' + KEY)).toBe(false);
      release(); await rejected;
      expect(fake.session.data.has('doc:' + KEY)).toBe(false);
      expect(next.state.reports.size).toBe(0); expect(next.scope.hasDataConsent).toBe(false);
    } finally { release(); next.stop(); }
  });
  it.each(['read', 'shape'] as const)('keeps native ingress closed after failed authority %s and recovers before scope checks', async failure => {
    const { runtime, fake, clock, fresh } = await setup(); await runtime.clearSession(); runtime.stop();
    const authority = fake.session.data.get(CLEAR_FENCES_KEY), get = fake.session.get.bind(fake.session);
    if (failure === 'read') fake.session.get = async keys => { if (keys === null) throw Error('authority unread'); return get(keys); };
    else fake.session.data.set(CLEAR_FENCES_KEY, { v: 1, documents: [{ documentKey: KEY }] });
    const next = new BackgroundRuntime(fake, { clock, ttlIntervalMs: 0 }); await next.start();
    try {
      const writes = fake.session.setCalls.length;
      await expect(route(next, batch(999, 9), pageSender())).rejects.toThrow();
      expect(await next.persistNow(KEY)).toBe(false); await next.flushIndex();
      expect(fake.session.setCalls).toHaveLength(writes); expect(next.projectionByKey(KEY)).toBeNull();
      fake.session.get = get; fake.session.data.set(CLEAR_FENCES_KEY, authority);
      expect(await route(next, batch(1000, 10), pageSender())).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 0 });
      expect(next.projectionByKey(KEY)).toBeNull();
      expect(await route(next, batch(1, 1, fresh()), pageSender())).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 1 });
      expect(next.state.reports.get(KEY)?.counters.map(row => row.count)).toEqual([1]);
    } finally { next.stop(); }
  });

  it('invalidates pending API capture and preserves Pro Light lifecycle when an inactive clear resets on restore', async () => {
    const { runtime, clock, fresh, resets } = await setup();
    const navigate = (documentId: string) => runtime.dispatch({ type: 'navigation:committed', tabId: 7, frameId: 0, documentId, parentDocumentId: null, frameType: 'outermost_frame', documentLifecycle: 'active', host: 'example.com', scheme: 'https', at: clock.t });
    try {
      navigate(D2);
      expect(await runtime.clear(7, KEY, runtime.projectionByKey(KEY)!.reportRevision)).toMatchObject({ type: 'ok' });
      expect(resets()).toBe(0); expect(runtime.state.metas.get(KEY)?.clearBootIds).toEqual([]);
      const operation = { documentKey: KEY, tabId: 7, invalid: false };
      expect(runtime.apiResults.trackOperation(operation as never)).toBe(true);
      const pro = vi.spyOn(runtime.pro, 'onLightClear');
      navigate(D1);
      expect(await route(runtime, batch(999, 9), pageSender())).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 0 });
      expect(resets()).toBe(1); expect(operation.invalid).toBe(true); expect(pro).toHaveBeenCalledWith(KEY);
      expect(runtime.projectionByKey(KEY)).toBeNull();
      await route(runtime, batch(1, 1, fresh()), pageSender());
      expect(runtime.state.reports.get(KEY)?.counters.map(row => row.count)).toEqual([1]);
    } finally { runtime.stop(); }
  });
});
