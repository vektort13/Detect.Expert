// ADR-020 §G (S12): the history lane through the real controller (fake chrome + MemoryProtectDb): feature off → no
// history record at all; folding two sites; flush before query; value-match on two sites → high; retention
// 7/30/90 at the next event; limits with eviction (`truncated`); clear; feature off clears; export = preview
// (sites redacted by default); storage failure and database reset; accumulator overflow is counted.

import { describe, expect, it } from 'vitest';
import { HISTORY_EXPORT_SITE_REF_PATTERN, validateProtectUiRequest } from '@detect-expert/contracts';
import type { DocumentReport, HistoryExport, HistoryProjection, HostEntry, ProtectEvidence, ProtectUiRequest, UiResponse } from '@detect-expert/contracts';
import { serializeHistoryExport } from '../../../export/src/protect-history';
import type { FrameBinding } from '../../src/documents';
import { HistoryService } from '../../src/protect/history/service';
import type { HistoryServiceOptions } from '../../src/protect/history/service';
import { BLOCKED_BY_CLIENT } from '../../src/protect/outcomes';
import type { FirewallVerdict } from '../../src/protect/outcomes';
import type { ProtectFeatureService } from '../../src/protect/services';
import { createValueMatchService } from '../../src/protect/value-match/index';
import { MemoryProtectDb } from './memory-db';
import { ALL_SITES, DNR_PERMISSION, ENABLED_SETTINGS, optionsSender, setupController, settleProtect } from './support';
import type { ControllerSetup, RecordingService } from './support';
import { CANARY_EMAIL, commitTop, emitRequest, emitSent, hello, input, pageCtx, request, seededRandom, sha256Hex, transfers } from './value-match-support';

const GRANTED = { grantedOrigins: ALL_SITES, permissions: [DNR_PERMISSION] };
const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const DAY_MS = 86_400_000;
const HISTORY_STORES = ['sightings', 'receivers', 'sites'] as const;

interface Setup extends ControllerSetup {
  history: HistoryService;
}

async function setup(options: { features?: string[]; history?: HistoryServiceOptions; db?: MemoryProtectDb; retention?: number } = {}): Promise<Setup> {
  const history = new HistoryService({ flushMs: 60_000, ...(options.history ?? {}) });
  const s = await setupController({
    chrome: GRANTED,
    settings: { ...ENABLED_SETTINGS, features: options.features ?? ['history'], historyRetentionDays: options.retention ?? 30 },
    services: () => [history as unknown as RecordingService],
    load: false,
    ...(options.db === undefined ? {} : { controller: { dbFactory: () => options.db! } }),
  });
  s.clock.t = NOW;
  await s.controller.load();
  return { ...s, ...(options.db === undefined ? {} : { db: options.db }), history };
}

function report(documentKey: string, hostName: string, hosts: string[], over: Partial<DocumentReport> = {}): DocumentReport {
  const [tab, frame, doc] = documentKey.split(':');
  return {
    schemaVersion: 1, documentKey, tabId: Number(tab), frameId: Number(frame), documentId: doc!, host: hostName, lifecycle: 'committed', createdAt: 1, updatedAt: 2,
    revision: 1, coverageState: 'active', coverageFlags: [], counters: [], findings: [],
    hosts: hosts.map((h): HostEntry => ({ registrableDomain: h, relation: 'cross-site', evidenceSource: 'browser-network', integrity: 'browser-observed', requestCount: 1, firstSeenBucket: 0, lastSeenBucket: 0, ruleIds: [] })),
    networkCounters: [], networkPatterns: { localPortsMax: 0, localTargetsMax: 0, randomSubdomainsMax: 0 }, watermark: null,
    dropped: { observations: 0, batches: 0, findings: 0, hosts: 0, counters: 0, transport: 0 }, ...over,
  };
}

function topBinding(r: DocumentReport): FrameBinding {
  return { tabId: r.tabId, frameId: 0, documentId: r.documentId, documentKey: r.documentKey, parentDocumentId: null, frameType: 'outermost_frame', documentLifecycle: 'active', host: r.host, boundAt: 1 };
}

function visit(s: Setup, tab: number, site: string, receivers: string[]): void {
  const r = report(String(tab) + ':0:DOC' + String(tab) + site.replace(/\W/g, ''), 'www.' + site, receivers);
  s.controller.onReportPersisted(r, topBinding(r), { paused: false, bindingOf: () => null });
}

function valueMatch(s: Setup, site: string, receiver: string, encodings: string[], fieldKind = 'email'): void {
  const evidence = {
    evidenceId: 'pe-1', frameContext: 'top', attributionConfidence: 'unknown', count: 1, countQuality: 'exact', firstSecond: 0, lastSecond: 0,
    evidenceSource: 'derived', integrity: 'derived', ruleVersion: '1', limitationCodes: [], protectKind: 'value-match', ruleId: 'form-leak',
    transferClass: 'third-party-before-submit', fieldKind, encodings, receiver, relation: 'cross-site', method: 'POST', requestKind: 'xhr',
    endpointHost: receiver, endpointPathTemplate: '/c', submitTiming: 'before-submit', deliveryState: 'sent', interpretationConfidence: 'high',
  } as unknown as ProtectEvidence;
  s.controller.eventBus.publish({ kind: 'evidence', documentKey: '1:0:X', tabId: 1, site, evidence });
}

async function route(s: Setup, request: Record<string, unknown>): Promise<UiResponse> {
  const checked = validateProtectUiRequest({ schemaVersion: 1, ...request });
  if (!checked.ok) throw new Error('invalid request ' + JSON.stringify(request));
  return s.controller.routeUi(checked.value as ProtectUiRequest, optionsSender());
}

async function query(s: Setup, extra: Record<string, unknown> = {}): Promise<HistoryProjection> {
  const r = await route(s, { type: 'ui-protect-history-query', windowDays: 30, offset: 0, limit: 50, ...extra });
  if (r.type !== 'protect-history') throw new Error('unexpected ' + JSON.stringify(r));
  return r.history;
}

async function exportPreview(s: Setup, includeSites: boolean): Promise<HistoryExport> {
  const r = await route(s, { type: 'ui-protect-history-export', includeSites });
  if (r.type !== 'protect-history-export') throw new Error('unexpected ' + JSON.stringify(r));
  return r.preview;
}

function storeSizes(db: MemoryProtectDb): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of HISTORY_STORES) out[name] = db.stores.get(name)?.size ?? 0;
  out['meta.history'] = [...(db.stores.get('meta')?.keys() ?? [])].filter((k) => k.includes('history')).length;
  return out;
}

const EMPTY = { sightings: 0, receivers: 0, sites: 0, 'meta.history': 0 };

describe('history lane: feature off writes nothing', () => {
  it('module on without the history feature: no delta, no history record, history routes answer feature-disabled', async () => {
    const s = await setup({ features: ['value-match'] });
    expect(s.controller.isActive).toBe(true);
    visit(s, 1, 'a.com', ['tracker.net']);
    valueMatch(s, 'a.com', 'tracker.net', ['sha256-hex']);
    await settleProtect(5);
    expect(storeSizes(s.db)).toEqual(EMPTY);
    expect(await route(s, { type: 'ui-protect-history-query', windowDays: 30, offset: 0, limit: 50 })).toEqual({ schemaVersion: 1, type: 'error', code: 'feature-disabled' });
    expect(s.controller.getState().history).toBeNull();
  });

  it('module off: the history service never starts and the database is never opened', async () => {
    const s = await setup({ features: ['history'] });
    await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-disable', purge: true }, optionsSender());
    visit(s, 1, 'a.com', ['tracker.net']);
    expect(s.history.debug()['pending']).toBe(0);
    expect(s.db.created).toBe(false);
  });
});

describe('history lane: recording and queries', () => {
  it('one receiver on two sites → sites = 2 (flush happens before the query)', async () => {
    const s = await setup();
    visit(s, 1, 'a.com', ['tracker.net', 'cdn-a.net']);
    visit(s, 2, 'b.com', ['tracker.net']);
    expect(s.history.debug()['pending']).toBeGreaterThan(0);
    expect(storeSizes(s.db)['sightings']).toBe(0);
    const h = await query(s);
    expect(h.rows.map((r) => [r.rowKey, r.sites, r.mechanisms.map((m) => m.mechanism)])).toEqual([['d:tracker.net', 2, ['requests-only']]]);
    expect(h.singleSiteReceivers).toBe(1);
    expect(h.sitesInWindow).toBe(2);
    expect(h.today).toBe('2026-10-18');
    expect(h.since).toBe('2026-10-18');
    expect(h.storage).toBe('ok');
    expect(storeSizes(s.db)).toEqual({ sightings: 3, receivers: 2, sites: 2, 'meta.history': 1 });
    const site = await query(s, { site: 'a.com', minSites: 1 });
    expect(site.site?.receivers).toEqual([{ rowKey: 'd:tracker.net', sites: 2 }, { rowKey: 'd:cdn-a.net', sites: 1 }]);
    // The volume indicator of the module state counts the stored sightings.
    expect((await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-get-state' }, optionsSender())).type).toBe('protect-state');
    expect(s.controller.getState().history).toEqual({ records: 3, truncated: false });
  });

  it('value-match on two sites with a hash of an e-mail → value-match high; receiver card', async () => {
    const s = await setup();
    valueMatch(s, 'a.com', 'collector.net', ['sha256-hex']);
    valueMatch(s, 'b.com', 'collector.net', ['plain']);
    const h = await query(s, { mechanismsOnly: true });
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]!.mechanisms).toEqual([{ mechanism: 'value-match', sites: 2, evidenceSource: 'derived', integrity: 'derived', attributionConfidence: 'unknown', interpretationConfidence: 'high' }]);
    const card = await route(s, { type: 'ui-protect-history-receiver', rowKey: 'd:collector.net', windowDays: 30 });
    expect(card.type === 'protect-history-receiver' ? card.card?.sites.map((x) => x.site).sort() : null).toEqual(['a.com', 'b.com']);
    // Plain values only → medium.
    const p = await setup();
    valueMatch(p, 'a.com', 'collector.net', ['plain']);
    valueMatch(p, 'b.com', 'collector.net', ['md5-hex'], 'name');
    expect((await query(p)).rows[0]!.mechanisms[0]!.interpretationConfidence).toBe('medium');
  });

  it('excluded sites write no history', async () => {
    const s = await setup();
    await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'a.com', excluded: true }, optionsSender());
    visit(s, 1, 'a.com', ['tracker.net']);
    valueMatch(s, 'a.com', 'tracker.net', ['plain']);
    visit(s, 2, 'b.com', ['tracker.net']);
    const h = await query(s, { minSites: 1 });
    expect(h.rows.map((r) => r.sites)).toEqual([1]);
    expect(storeSizes(s.db)['sites']).toBe(1);
  });
});

describe('history lane: lifecycle', () => {
  it('retention 7 days: data older than the window is removed at the next event (no alarms)', async () => {
    const s = await setup({ retention: 7 });
    visit(s, 1, 'a.com', ['tracker.net']);
    visit(s, 2, 'b.com', ['tracker.net']);
    expect((await query(s, { windowDays: 7 })).rows).toHaveLength(1);
    s.clock.t += 6 * DAY_MS;
    expect((await query(s, { windowDays: 7 })).rows).toHaveLength(1);
    s.clock.t += 2 * DAY_MS;
    const h = await query(s, { windowDays: 90 });
    expect(h.rows).toHaveLength(0);
    expect(storeSizes(s.db)).toEqual({ sightings: 0, receivers: 0, sites: 0, 'meta.history': 1 });
    expect(h.since).toBe('2026-10-20');
  });

  it('the harness day offset of 91 days empties a 90-day history (test profile)', async () => {
    const s = await setup({ retention: 90 });
    visit(s, 1, 'a.com', ['tracker.net']);
    await s.history.debugInject({ flush: true });
    expect(storeSizes(s.db)['sightings']).toBe(1);
    await s.history.debugInject({ dayOffset: 91 });
    expect(storeSizes(s.db)).toEqual({ sightings: 0, receivers: 0, sites: 0, 'meta.history': 1 });
    await expect(s.history.debugInject({ dayOffset: 10_000 })).rejects.toThrow();
  });

  it('limits: beyond maxSightings the oldest go down to 95 % and the history says it is incomplete', async () => {
    const s = await setup({ history: { limits: { sightings: 40, receivers: 1000, sites: 1000 } } });
    for (let day = 0; day < 5; day++) {
      for (let i = 0; i < 10; i++) visit(s, 10 + i, 's' + String(day) + '-' + String(i) + '.com', ['r' + String(day) + '.net']);
      await s.history.debugInject({ flush: true });
      s.clock.t += DAY_MS;
    }
    const h = await query(s, { minSites: 1 });
    expect(storeSizes(s.db)['sightings']).toBeLessThanOrEqual(40);
    expect(storeSizes(s.db)['sightings']).toBeGreaterThanOrEqual(38);
    expect(h.limitations).toContain('history-truncated');
    expect(h.dropped.evictedSightings).toBeGreaterThan(0);
    // The newest day survives eviction.
    expect(h.rows.map((r) => r.rowKey)).toContain('d:r4.net');
  });

  it('«Удалить всю историю» (purge history) empties the stores without a false storage-reset', async () => {
    const s = await setup();
    visit(s, 1, 'a.com', ['tracker.net']);
    visit(s, 2, 'b.com', ['tracker.net']);
    await query(s);
    expect((await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-purge', what: 'history' }, optionsSender())).type).toBe('protect-state');
    expect(storeSizes(s.db)).toEqual(EMPTY);
    const h = await query(s);
    expect(h.rows).toEqual([]);
    expect(h.storage).toBe('ok');
    expect(h.limitations).not.toContain('storage-reset');
    // New observations after the purge are recorded again (a new state, nothing counted as lost).
    visit(s, 3, 'a.com', ['tracker.net']);
    visit(s, 4, 'b.com', ['tracker.net']);
    const again = await query(s);
    expect(again.rows.map((r) => r.sites)).toEqual([2]);
    expect(again.dropped.pending).toBe(0);
  });

  it('purge with deltas waiting: the next batch starts a new state instead of being dropped', async () => {
    const s = await setup();
    visit(s, 1, 'a.com', ['tracker.net']);
    await query(s);
    await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-purge', what: 'history' }, optionsSender());
    visit(s, 2, 'b.com', ['tracker.net']);
    await s.history.debugInject({ flush: true });
    expect(storeSizes(s.db)).toEqual({ sightings: 1, receivers: 1, sites: 1, 'meta.history': 1 });
    expect((await query(s, { minSites: 1 })).dropped.pending).toBe(0);
  });

  it('turning the history feature off deletes every history record', async () => {
    const s = await setup({ features: ['value-match', 'history'] });
    visit(s, 1, 'a.com', ['tracker.net']);
    await query(s);
    expect(storeSizes(s.db)['sightings']).toBe(1);
    const r = await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-settings', features: ['value-match'] }, optionsSender());
    expect(r.type).toBe('protect-state');
    expect(storeSizes(s.db)).toEqual(EMPTY);
  });

  it('delete a row and a site', async () => {
    const s = await setup();
    visit(s, 1, 'a.com', ['tracker.net', 'ads.net']);
    visit(s, 2, 'b.com', ['tracker.net', 'ads.net']);
    visit(s, 3, 'c.com', ['ads.net']);
    expect((await query(s)).rows.map((r) => r.rowKey)).toEqual(['d:ads.net', 'd:tracker.net']);
    const del = await route(s, { type: 'ui-protect-history-delete', target: 'row', key: 'd:ads.net' });
    expect(del.type === 'protect-history' ? del.history.rows.map((r) => r.rowKey) : null).toEqual(['d:tracker.net']);
    await route(s, { type: 'ui-protect-history-delete', target: 'site', key: 'a.com' });
    const h = await query(s, { minSites: 1 });
    expect(h.rows.map((r) => [r.rowKey, r.sites])).toEqual([['d:tracker.net', 1]]);
    expect(storeSizes(s.db)).toEqual({ sightings: 1, receivers: 1, sites: 2, 'meta.history': 1 });
  });
});

describe('history lane: export and storage failures', () => {
  it('export = preview: sites are site-N by default, names only when asked; deterministic text', async () => {
    const s = await setup();
    visit(s, 1, 'a.com', ['tracker.net']);
    visit(s, 2, 'b.com', ['tracker.net']);
    const redacted = await exportPreview(s, false);
    expect(redacted.sitesIncluded).toBe(false);
    expect(redacted.receivers[0]!.sites.every((x) => HISTORY_EXPORT_SITE_REF_PATTERN.test(x.site))).toBe(true);
    expect(redacted.sites.map((x) => x.site).sort()).toEqual(['site-1', 'site-2']);
    const text = serializeHistoryExport(redacted);
    expect(text).not.toContain('a.com');
    expect(text).not.toMatch(/https?:|T\d\d:\d\d/);
    expect(serializeHistoryExport(await exportPreview(s, false))).toBe(text);
    const named = await exportPreview(s, true);
    expect(named.sites.map((x) => x.site).sort()).toEqual(['a.com', 'b.com']);
  });

  it('a failing write degrades the storage state and counts the lost deltas', async () => {
    const s = await setup();
    await query(s);
    visit(s, 1, 'a.com', ['tracker.net']);
    s.db.failNext = 1;
    await s.history.debugInject({ flush: true });
    expect(s.history.debug()['storageOk']).toBe(false);
    // The next successful write clears the degraded state; the lost deltas stay counted.
    visit(s, 2, 'b.com', ['tracker.net']);
    await s.history.debugInject({ flush: true });
    const h = await query(s);
    expect(h.dropped.pending).toBeGreaterThan(0);
    expect(h.storage).toBe('ok');
    s.db.failNext = 100;
    visit(s, 3, 'c.com', ['tracker.net']);
    const failed = await route(s, { type: 'ui-protect-history-query', windowDays: 30, offset: 0, limit: 50 });
    expect(failed.type === 'protect-history' ? [failed.history.storage, failed.history.limitations] : failed).toEqual(['degraded', ['storage-unavailable']]);
    s.db.failNext = 0;
  });

  it('the database removed by the browser while the history is on → storage-reset', async () => {
    const s = await setup();
    visit(s, 1, 'a.com', ['tracker.net']);
    await query(s);
    await s.db.destroy();
    visit(s, 2, 'b.com', ['tracker.net']);
    const h = await query(s, { minSites: 1 });
    expect(h.storage).toBe('reset');
    expect(h.limitations).toContain('storage-reset');
    expect(h.since).toBe('2026-10-18');
    expect(h.rows.map((r) => r.sites)).toEqual([1]);
  });

  it('accumulator overflow while a flush is writing is counted in dropped.pending', async () => {
    const db = new MemoryProtectDb();
    const slow = db.putMany.bind(db);
    let gate: Promise<void> = Promise.resolve();
    db.putMany = async (store, values) => {
      await gate;
      return slow(store, values);
    };
    const s = await setup({ db, history: { maxPending: 4 } });
    let release: () => void = () => undefined;
    gate = new Promise((r) => (release = r));
    for (let i = 0; i < 20; i++) visit(s, 100 + i, 's' + String(i) + '.com', ['tracker.net']);
    release();
    gate = Promise.resolve();
    const h = await query(s, { minSites: 1 });
    expect(h.dropped.pending).toBeGreaterThan(0);
    expect(s.history.debug()['pending']).toBe(0);
  });
});

describe('history service in isolation', () => {
  it('is a lane of the history feature only', () => {
    const svc: ProtectFeatureService = new HistoryService();
    expect(svc.name).toBe('history');
    expect(svc.features).toEqual(['history']);
  });

  it('stop("module-off") writes what was folded, then forgets', async () => {
    const s = await setup();
    visit(s, 1, 'a.com', ['tracker.net']);
    await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-disable', purge: false }, optionsSender());
    await settleProtect(5);
    expect(storeSizes(s.db)['sightings']).toBe(1);
    expect(s.history.debug()['pending']).toBe(0);
  });
});

// Review round 1 (S12 × S07): the real publish order. The matcher publishes value-match evidence at onBeforeRequest
// time with `deliveryState: 'unknown'`; the outcome arrives later on the bus. The history counts the record only when
// Chrome reported the send (onSendHeaders → `sent`); `stopped` (our rule), `stopped-other` (another extension) and
// `unknown` never become «received».
describe('history lane: value-match through the real matcher and outcome tracker', () => {
  const OTHER_DOC = 'DOC000000000000000000000000000002';
  const OTHER_HOST = 'www.other-shop.com';
  const BLOCK_RULE = 'site:shop-site.com>example.net';

  async function setupReal(): Promise<Setup> {
    const history = new HistoryService({ flushMs: 60_000 });
    const vm = createValueMatchService({ random: seededRandom() });
    // Stand-in for the firewall lane's local DNR evaluation (S08): our block rule for /blocked, active long before.
    const firewallPort = {
      name: 'firewall',
      features: 'module',
      start(ctx: { ports: { firewallEvaluate: (d: { url: string }) => FirewallVerdict | null } }) {
        ctx.ports.firewallEvaluate = (d) => (d.url.includes('/blocked') ? { ruleKey: BLOCK_RULE, action: 'block', activatedAt: 0 } : null);
      },
      stop() {},
    } as unknown as RecordingService;
    const s = await setupController({
      chrome: GRANTED,
      settings: { ...ENABLED_SETTINGS, features: ['value-match', 'history'], historyRetentionDays: 30 },
      services: () => [vm as unknown as RecordingService, history as unknown as RecordingService, firewallPort],
      load: false,
    });
    s.clock.t = NOW;
    await s.controller.load();
    return { ...s, history };
  }

  /** The typed e-mail on tab 7 (shop-site.com) and tab 8 (other-shop.com); both tabs armed. */
  async function typeOnTwoSites(s: Setup): Promise<void> {
    commitTop(s);
    await input(s, await hello(s), [{ kind: 'email', value: CANARY_EMAIL }]);
    const ctx8 = pageCtx({ tabId: 8, documentId: OTHER_DOC, documentKey: '8:0:' + OTHER_DOC, host: OTHER_HOST, originPattern: 'https://' + OTHER_HOST + '/*' });
    commitTop(s, 'https://' + OTHER_HOST + '/form', OTHER_DOC, 8);
    await input(s, await hello(s, ctx8), [{ kind: 'email', value: CANARY_EMAIL }], { ctx: ctx8 });
  }

  function pixel(tabId: 7 | 8, path: string): ReturnType<typeof request> {
    const top = tabId === 7 ? { documentId: pageCtx().documentId, initiator: 'https://' + pageCtx().host } : { documentId: OTHER_DOC, initiator: 'https://' + OTHER_HOST };
    return request({ tabId, ...top, type: 'image', url: 'https://px.tracker.example.net' + path + '?ud[em]=' + sha256Hex(CANARY_EMAIL.toLowerCase()) });
  }

  function blockedByClient(s: Setup, d: ReturnType<typeof request>): void {
    s.fake.webRequestEvents.errorOccurred.emit({ ...d, requestBody: undefined, error: BLOCKED_BY_CLIENT });
  }

  it('our rule (stopped) and another extension (stopped-other) on two sites: no valueMatch, nothing «received»', async () => {
    const s = await setupReal();
    await typeOnTwoSites(s);
    const a = emitRequest(s, pixel(7, '/blocked'));
    const b = emitRequest(s, pixel(8, '/tr'));
    // Published at onBeforeRequest time as `unknown`: parked, not counted.
    expect(transfers(s, 7).map((e) => e.deliveryState)).toEqual(['unknown']);
    expect(s.history.debug()['awaitingSends']).toBe(2);
    expect(s.history.debug()['events']).toBe(0);
    blockedByClient(s, a);
    blockedByClient(s, b);
    expect(transfers(s, 7).map((e) => e.deliveryState)).toEqual(['stopped']);
    expect(transfers(s, 8).map((e) => e.deliveryState)).toEqual(['stopped-other']);
    expect(s.history.debug()).toMatchObject({ awaitingSends: 0, unsent: 2, events: 0 });
    const h = await query(s, { minSites: 1 });
    expect(h.rows.flatMap((r) => r.mechanisms.map((m) => m.mechanism))).not.toContain('value-match');
    expect(h.rows).toEqual([]);
    expect(storeSizes(s.db)['sightings']).toBe(0);
  });

  it('completed without onSendHeaders (unknown) is not counted either', async () => {
    const s = await setupReal();
    await typeOnTwoSites(s);
    const a = emitRequest(s, pixel(7, '/tr'));
    const b = emitRequest(s, pixel(8, '/tr'));
    s.fake.webRequestEvents.completed.emit({ ...a, requestBody: undefined });
    s.fake.webRequestEvents.completed.emit({ ...b, requestBody: undefined });
    expect(s.history.debug()).toMatchObject({ awaitingSends: 0, unsent: 2, events: 0 });
    expect((await query(s, { minSites: 1 })).rows).toEqual([]);
  });

  it('control: Chrome sent both requests (onSendHeaders) → value-match on 2 sites, high (hash of an e-mail)', async () => {
    const s = await setupReal();
    await typeOnTwoSites(s);
    const a = emitRequest(s, pixel(7, '/tr'));
    const b = emitRequest(s, pixel(8, '/tr'));
    expect((await query(s, { minSites: 1 })).rows).toEqual([]);
    emitSent(s, a);
    emitSent(s, b);
    expect(s.history.debug()).toMatchObject({ awaitingSends: 0, unsent: 0, events: 2 });
    const h = await query(s, { mechanismsOnly: true });
    expect(h.rows.map((r) => [r.rowKey, r.sites, r.mechanisms.map((m) => [m.mechanism, m.interpretationConfidence])])).toEqual([['d:example.net', 2, [['value-match', 'high']]]]);
    // A later network error does not undo a send that already happened.
    blockedByClient(s, a);
    expect(s.history.debug()['unsent']).toBe(0);
  });

  it('a closed tab drops its parked records (the tracker forgets them without an event)', async () => {
    const s = await setupReal();
    await typeOnTwoSites(s);
    emitRequest(s, pixel(7, '/tr'));
    expect(s.history.debug()['awaitingSends']).toBe(1);
    s.controller.onTabRemoved(7);
    expect(s.history.debug()).toMatchObject({ awaitingSends: 0, awaitingDropped: 1, events: 0 });
  });
});
