import { createExportPreview } from '../../export/src/index';
import type { Ack, PageBatch, PageObservation, UiResponse } from '@detect-expert/contracts';
import { describe, expect, it } from 'vitest';
import { ISOLATED_SCRIPT_ID, MAIN_SCRIPT_ID, createBackground } from '../src/index';
import type { Background, MessageSenderLike } from '../src/index';
import { RUNTIME_ID, committed, createFakeChrome, pageSender, settle, uiSender } from './fake-chrome';
import type { FakeChrome } from './fake-chrome';

const D1 = 'DOC000000000000000000000000000001';
const D2 = 'DOC000000000000000000000000000002';
const KEY1 = '7:0:' + D1;

function obs(over: Partial<PageObservation> = {}): PageObservation {
  return { techniqueId: 'DET-001', count: 1, countQuality: 'exact', phase: 'attempted', signalCodes: ['api-use'], intervalBucket: 1, ...over };
}

function batchOf(batchSeq: number, observations: PageObservation[] = [obs()], over: Partial<PageBatch> = {}): PageBatch {
  return { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'boot-1', bridgeSessionId: 'bridge-1', batchSeq, observations, coverageDelta: [], ...over };
}

function send(bg: Background, message: unknown, sender: MessageSenderLike): Promise<Ack | UiResponse> {
  return new Promise((resolve) => {
    const returned = bg.onMessage(message, sender, resolve);
    expect(returned).toBe(true);
  });
}

interface Setup {
  fake: FakeChrome;
  bg: Background;
  clock: { t: number; now(): number };
}

async function setup(options: { grantedOrigins?: string[]; hostPermissions?: string[]; testBootstrap?: boolean } = {}): Promise<Setup> {
  const fake = createFakeChrome(options);
  if (options.grantedOrigins?.includes('https://example.com/*')) fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
  const clock = {
    t: 1_000_000,
    now() {
      return this.t;
    },
  };
  const bg = createBackground(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1, testBootstrap: options.testBootstrap ?? false });
  // Same wiring as apps/extension/entrypoints/background.ts, against the fake events.
  fake.events.onCommitted.addListener(bg.navigation.onCommitted);
  fake.events.onBeforeNavigate.addListener(bg.navigation.onBeforeNavigate);
  fake.events.onErrorOccurred.addListener(bg.navigation.onErrorOccurred);
  fake.events.tabRemoved.addListener(bg.navigation.onTabRemoved);
  fake.events.tabReplaced.addListener(bg.navigation.onTabReplaced);
  fake.events.onAdded.addListener(bg.navigation.onPermissionsAdded);
  fake.events.onRemoved.addListener(bg.navigation.onPermissionsRemoved);
  fake.webRequest.onCompleted.addListener(bg.network.onCompleted, bg.network.filter);
  await bg.start();
  return { fake, bg, clock };
}

describe('onMessage dispatcher: trust boundary (REQ-004, E04-02)', () => {
  it('the listener is synchronous, returns true and answers via sendResponse', async () => {
    const { bg } = await setup();
    let answered = false;
    const returned = bg.onMessage({ schemaVersion: 1, type: 'ui-get-scope' }, uiSender(), () => {
      answered = true;
    });
    expect(returned).toBe(true);
    expect(answered).toBe(false);
    await settle();
    expect(answered).toBe(true);
  });

  it('ui-* from a page sender is rejected as unauthorized-sender; a PageBatch from an extension page is not a batch', async () => {
    const { bg } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    expect(await send(bg, { schemaVersion: 1, type: 'ui-get-report', tabId: 7 }, pageSender())).toEqual({
      schemaVersion: 1,
      type: 'error',
      code: 'unauthorized-sender',
    });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-export-preview', tabId: 7, documentKey: KEY1, reportRevision: 0 }, pageSender())).toEqual({
      schemaVersion: 1,
      type: 'error',
      code: 'unauthorized-sender',
    });
    const fromUi = await send(bg, batchOf(1), uiSender());
    expect(fromUi).toEqual({ schemaVersion: 1, type: 'error', code: 'invalid-request' });
    expect(bg.runtime.state.reports.get(KEY1)?.counters).toEqual([]);
    // Another extension id, or a sender without a tab, never reaches the content channel.
    expect(await send(bg, batchOf(1), pageSender({ id: 'b'.repeat(32) }))).toEqual({ schemaVersion: 1, type: 'error', code: 'unauthorized-sender' });
    expect(await send(bg, batchOf(1), { id: RUNTIME_ID, origin: 'https://example.com', url: 'https://example.com/' })).toEqual({
      schemaVersion: 1,
      type: 'error',
      code: 'unauthorized-sender',
    });
  });

  it('forged tabId/documentId in the payload are rejected by the validator; ids come from MessageSender', async () => {
    const { bg } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    const forged = { ...batchOf(1), tabId: 99, documentId: D2 };
    const ack = await send(bg, forged, pageSender());
    expect(ack).toEqual({ schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: 0, paused: false, protocolOk: true });
    expect(bg.runtime.state.reports.has('99:0:' + D2)).toBe(false);
    expect(bg.runtime.getProjection(7)?.dropped.transport).toBe(1);
    expect(bg.runtime.getProjection(7)?.coverageFlags).toContain('throttled');
  });

  it('unknown schemaVersion -> protocolOk false; out-of-scope sender -> stop instruction', async () => {
    const { bg } = await setup({ grantedOrigins: ['https://example.com/*'] });
    expect(await send(bg, { ...batchOf(1), schemaVersion: 2 }, pageSender())).toEqual({
      schemaVersion: 1,
      type: 'ack',
      lastCommittedBatchSeq: 0,
      paused: true,
      protocolOk: false,
    });
    const stranger = pageSender({ url: 'https://not-granted.example/x', origin: 'https://not-granted.example' });
    expect(await send(bg, batchOf(1), stranger)).toEqual({ schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: 0, paused: true, protocolOk: true, stopReason: 'revoked' });
  });
});

describe('content channel: commit, dedup, merge (REQ-009)', () => {
  it('commits after a single storage.session.set (snapshot + watermark + index) and acks the committed seq', async () => {
    const { bg, fake } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    await settle(10);
    const setsBefore = fake.session.setCalls.length;
    const ack = await send(bg, batchOf(1, [obs({ count: 4 })]), pageSender());
    expect(ack).toEqual({ schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: 1, paused: false, protocolOk: true });
    const call = fake.session.setCalls[setsBefore];
    expect(call).toBeDefined();
    expect(Object.keys(call ?? {})).toContain('doc:' + KEY1);
    const stored = fake.session.data.get('doc:' + KEY1) as { report: { watermark: unknown; counters: unknown[] } };
    expect(stored.report.watermark).toEqual({ bridgeSessionId: 'bridge-1', lastCommittedBatchSeq: 1 });
    expect(stored.report.counters.length).toBe(1);
    expect(fake.session.accessLevel).toBe('TRUSTED_CONTEXTS');
    expect([...fake.local.data.keys()]).toEqual(['scope']);
  });

  it('replay does not double count; a lower redelivered total is a no-op (merge = max)', async () => {
    const { bg } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    const b1 = batchOf(1, [obs({ count: 5 })]);
    await send(bg, b1, pageSender());
    const replay = await send(bg, b1, pageSender());
    expect(replay).toEqual({ schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: 1, paused: false, protocolOk: true });
    await send(bg, batchOf(2, [obs({ count: 3 })]), pageSender());
    const projection = await send(bg, { schemaVersion: 1, type: 'ui-get-report', tabId: 7 }, uiSender());
    expect(projection.type).toBe('report');
    if (projection.type !== 'report') return;
    expect(projection.report?.techniques[0]).toMatchObject({ techniqueId: 'DET-001', count: 5, countQuality: 'exact', evidenceSource: 'page-hook', integrity: 'page-controlled' });
    expect(projection.report?.coverageState).toBe('active');
    expect(projection.report?.host).toBe('example.com');
  });

  it('applies the per-document token bucket: the 21st batch in one second is throttled and counted', async () => {
    const { bg } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    let last: Ack | UiResponse | null = null;
    for (let i = 1; i <= 21; i++) last = await send(bg, batchOf(i, [obs({ count: i })]), pageSender());
    expect(last).toEqual({ schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: 20, paused: false, protocolOk: true });
    await settle(10);
    const r = bg.runtime.state.reports.get(KEY1);
    expect(r?.dropped.transport).toBe(1);
    expect(r?.coverageFlags).toContain('throttled');
    expect(r?.counters[0]?.count).toBe(20);
  });

  it('batches before hydration wait for readiness instead of being lost', async () => {
    const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
    fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
    const bg = createBackground(fake, { ttlIntervalMs: 0 });
    bg.navigation.onCommitted(committed()); // buffered
    const pending = send(bg, batchOf(1), pageSender());
    await bg.start();
    expect(await pending).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 1, protocolOk: true });
  });
});

describe('UI channel', () => {
  it('pause/resume/clear/export verify documentKey + reportRevision and act on the document', async () => {
    const { bg, fake } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    await send(bg, batchOf(1, [obs({ count: 2 })]), pageSender());
    const rep = await send(bg, { schemaVersion: 1, type: 'ui-get-report', tabId: 7 }, uiSender());
    if (rep.type !== 'report' || rep.report === null) throw new Error('expected a report');
    const rev = rep.report.reportRevision;

    expect(await send(bg, { schemaVersion: 1, type: 'ui-pause', tabId: 7, documentKey: KEY1, reportRevision: rev + 1 }, uiSender())).toEqual({
      schemaVersion: 1,
      type: 'error',
      code: 'stale-revision',
    });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-pause', tabId: 8, documentKey: KEY1, reportRevision: rev }, uiSender())).toEqual({
      schemaVersion: 1,
      type: 'error',
      code: 'document-mismatch',
    });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-pause', tabId: 7, documentKey: '7:0:' + D2, reportRevision: rev }, uiSender())).toEqual({
      schemaVersion: 1,
      type: 'error',
      code: 'not-found',
    });
    const paused = await send(bg, { schemaVersion: 1, type: 'ui-pause', tabId: 7, documentKey: KEY1, reportRevision: rev }, uiSender());
    expect(paused).toMatchObject({ type: 'ok' });
    expect(await send(bg, batchOf(2, [obs({ count: 50 })]), pageSender())).toEqual({
      schemaVersion: 1,
      type: 'ack',
      lastCommittedBatchSeq: 1,
      paused: true,
      protocolOk: true,
    });
    expect(bg.runtime.state.reports.get(KEY1)?.counters[0]?.count).toBe(2);
    expect((fake.session.data.get('doc:' + KEY1) as { meta: { paused: boolean } }).meta.paused).toBe(true);

    expect(await send(bg, { schemaVersion: 1, type: 'ui-resume', tabId: 7, documentKey: KEY1, reportRevision: bg.runtime.state.reports.get(KEY1)!.revision }, uiSender())).toMatchObject({ type: 'ok' });
    expect(await send(bg, batchOf(2, [obs({ count: 50 })]), pageSender())).toMatchObject({ lastCommittedBatchSeq: 2, paused: false });

    const current = bg.runtime.state.reports.get(KEY1)?.revision ?? -1;
    const preview = await send(bg, { schemaVersion: 1, type: 'ui-export-preview', tabId: 7, documentKey: KEY1, reportRevision: current }, uiSender());
    expect(preview.type).toBe('export-preview');
    if (preview.type !== 'export-preview') return;
    expect(preview.preview.redacted).toBe(true);
    const shown = await send(bg, { schemaVersion: 1, type: 'ui-get-report', tabId: 7 }, uiSender());
    expect(shown.type === 'report' && shown.report && createExportPreview(shown.report, bg.runtime.now())).toEqual(preview.preview);
    expect(JSON.stringify(preview)).not.toMatch(/documentKey|observedSince|exportedAt/);
    // Only the projection: no boot/session ids, no raw counter entries, no meta (REQ-013).
    expect(JSON.stringify(preview)).not.toMatch(/boot-1|bridge-1|sensorBootId|"counters":\[|"boots"|"sessions"|"folded"/);

    expect(await send(bg, { schemaVersion: 1, type: 'ui-clear', tabId: 7, documentKey: KEY1, reportRevision: current }, uiSender())).toEqual({
      schemaVersion: 1,
      type: 'ok',
      reportRevision: null,
    });
    await settle(10);
    expect(fake.session.data.has('doc:' + KEY1)).toBe(false);
    expect(await send(bg, { schemaVersion: 1, type: 'ui-get-report', tabId: 7 }, uiSender())).toEqual({ schemaVersion: 1, type: 'report', report: null });
  });

  it('ui-get-report with frameId returns the current document of that frame', async () => {
    const { bg } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    bg.navigation.onCommitted(committed({ frameId: 3, documentId: D2, frameType: 'sub_frame', parentDocumentId: D1 }));
    const r = await send(bg, { schemaVersion: 1, type: 'ui-get-report', tabId: 7, frameId: 3 }, uiSender());
    expect(r.type === 'report' && r.report?.documentKey).toBe('7:3:' + D2);
  });

  it('ui-inject-now injects both worlds under activeTab and marks the tab late-start; failure -> no-access', async () => {
    const { bg, fake } = await setup();
    bg.navigation.onCommitted(committed());
    fake.framesByTab.set(7, [committed()]);
    const ok = await send(bg, { schemaVersion: 1, type: 'ui-inject-now', tabId: 7 }, uiSender());
    expect(ok).toMatchObject({ type: 'ok' });
    expect(fake.executeScriptCalls.map((c) => [c.world, c.files[0], c.target.documentIds, c.injectImmediately])).toEqual([
      ['ISOLATED', 'bridge.js', [D1], true],
      ['MAIN', 'hook.main.js', [D1], true],
    ]);
    expect(bg.runtime.state.reports.get(KEY1)?.coverageState).toBe('late-start');
    // The injected tab is now accepted by the content channel without a host permission (activeTab).
    expect(await send(bg, batchOf(1), pageSender())).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 1, protocolOk: true });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-inject-now', tabId: 7, extra: 1 }, uiSender())).toEqual({ schemaVersion: 1, type: 'error', code: 'invalid-request' });
    fake.failExecuteScript = true;
    expect(await send(bg, { schemaVersion: 1, type: 'ui-inject-now', tabId: 8 }, uiSender())).toEqual({ schemaVersion: 1, type: 'error', code: 'no-access' });
  });

  it('ui-clear-session discards every visible report and stores only reset metadata; a page sender cannot send it', async () => {
    const { bg, fake } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    bg.navigation.onCommitted(committed({ frameId: 3, documentId: D2, frameType: 'sub_frame', parentDocumentId: D1 }));
    expect(await send(bg, batchOf(1), pageSender())).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 1 });
    expect(await send(bg, batchOf(1), pageSender({ frameId: 3, documentId: D2 }))).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 1 });
    await settle(10);
    expect([...fake.session.data.keys()].filter((k) => k.startsWith('doc:')).sort()).toEqual(['doc:' + KEY1, 'doc:7:3:' + D2]);
    expect(await send(bg, { schemaVersion: 1, type: 'ui-clear-session' }, pageSender())).toEqual({ schemaVersion: 1, type: 'error', code: 'unauthorized-sender' });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-clear-session' }, uiSender())).toEqual({ schemaVersion: 1, type: 'ok', reportRevision: null });
    await settle(10);
    expect([...bg.runtime.state.reports.keys()].map((key) => bg.runtime.projectionByKey(key))).toEqual([null, null]);
    for (const [key, record] of fake.session.data) if (key.startsWith('doc:')) expect(record).toMatchObject({
      report: { counters: [], findings: [], hosts: [], host: null, watermark: null }, meta: { cleared: true },
    });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-get-report', tabId: 7 }, uiSender())).toEqual({ schemaVersion: 1, type: 'report', report: null });
    // The binding survives: the next batch of the same document starts a fresh report.
    expect(await send(bg, batchOf(1, [obs()], fake.historyEpochs.get(KEY1)), pageSender())).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 1 });
    expect(bg.runtime.state.reports.get(KEY1)?.counters[0]?.count).toBe(1);
  });
});

describe('scope modes and revoke (spec A3, ADR-003)', () => {
  it('ui-set-scope site without the permission -> no-access; with it -> registers both scripts for the host', async () => {
    const { bg, fake } = await setup();
    expect(await send(bg, { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: 'example.com' }, uiSender())).toEqual({
      schemaVersion: 1,
      type: 'error',
      code: 'no-access',
    });
    fake.grant(['http://example.com/*', 'https://example.com/*']); // as the popup's permissions.request would
    const res = await send(bg, { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: 'example.com' }, uiSender());
    expect(res).toEqual({ schemaVersion: 1, type: 'scope', scope: { scopeMode: 'site', hosts: ['example.com'], grantedAllSites: false, managed: false } });
    const iso = fake.registered.get(ISOLATED_SCRIPT_ID);
    const main = fake.registered.get(MAIN_SCRIPT_ID);
    expect(iso).toMatchObject({ js: ['bridge.js'], world: 'ISOLATED', runAt: 'document_start', allFrames: true, persistAcrossSessions: true, matchOriginAsFallback: true });
    expect(main).toMatchObject({ js: ['hook.early.js'], world: 'MAIN', matches: ['http://example.com/*', 'https://example.com/*'] });
    expect(fake.local.data.get('scope')).toEqual({ v: 1, scopeMode: 'site', hosts: ['example.com'] });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-get-scope' }, uiSender())).toMatchObject({ type: 'scope', scope: { scopeMode: 'site' } });
    // off -> unregister
    await send(bg, { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'off' }, uiSender());
    expect(fake.registered.size).toBe(0);
  });

  it('all-sites registers http/https wildcards; matchOriginAsFallback is feature-detected', async () => {
    const { bg, fake } = await setup({ grantedOrigins: ['http://*/*', 'https://*/*'] });
    fake.rejectMatchOriginAsFallback = true;
    const res = await send(bg, { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' }, uiSender());
    expect(res).toMatchObject({ type: 'scope', scope: { scopeMode: 'all-sites', grantedAllSites: true } });
    expect(fake.registered.get(MAIN_SCRIPT_ID)?.matches).toEqual(['http://*/*', 'https://*/*']);
    expect(fake.registered.get(MAIN_SCRIPT_ID)?.matchOriginAsFallback).toBeUndefined();
  });

  it('test profile: static host_permissions are detected and registered at startup', async () => {
    const { fake } = await setup({ testBootstrap: true, hostPermissions: ['http://127.0.0.1/*'], grantedOrigins: ['http://127.0.0.1/*'] });
    expect(fake.registered.get(ISOLATED_SCRIPT_ID)?.matches).toEqual(['http://127.0.0.1/*']);
    expect(fake.registered.get(MAIN_SCRIPT_ID)?.matches).toEqual(['http://127.0.0.1/*']);
  });

  it('permissions.onRemoved unregisters, purges the scope data, marks no-access/revoked and stops the bridge', async () => {
    const { bg, fake } = await setup({ grantedOrigins: ['http://*/*', 'https://*/*'] });
    await send(bg, { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' }, uiSender());
    bg.navigation.onCommitted(committed());
    await send(bg, batchOf(1, [obs({ count: 3 })]), pageSender());
    expect(fake.registered.size).toBe(2);

    fake.revoke(['http://*/*', 'https://*/*']); // fires permissions.onRemoved -> runtime
    await settle(20);
    expect(fake.registered.size).toBe(0);
    const r = bg.runtime.state.reports.get(KEY1);
    expect(r?.coverageState).toBe('no-access');
    expect(r?.coverageFlags).toEqual(['revoked']);
    expect(r?.counters).toEqual([]);
    const stored = fake.session.data.get('doc:' + KEY1) as { report: { counters: unknown[]; coverageState: string } };
    expect(stored.report.counters).toEqual([]);
    expect(stored.report.coverageState).toBe('no-access');
    // Next batch from the still-injected script: stop instruction, nothing accepted.
    expect(await send(bg, batchOf(2, [obs({ count: 9 })]), pageSender())).toEqual({ schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: 0, paused: true, protocolOk: true, stopReason: 'revoked' });
  });
});

describe('network observer', () => {
  it('omits unreviewed network destinations even with host access (F016/F022)', async () => {
    const { bg, fake } = await setup();
    bg.navigation.onCommitted(committed());
    const details = { tabId: 7, frameId: 0, url: 'https://cdn.vendor.net/sdk.js?token=SECRET#f', type: 'script', timeStamp: 1, documentId: D1, parentFrameId: -1 };
    bg.network.onCompleted(details); // no host access yet -> ignored
    expect(bg.runtime.state.reports.get(KEY1)?.hosts).toEqual([]);
    fake.grant(['https://example.com/*']); // fires permissions.onAdded -> runtime refreshes grants
    await settle(10);
    fake.events.webRequestCompleted.emit(details);
    fake.events.webRequestCompleted.emit({ ...details, type: 'image' });
    fake.events.webRequestCompleted.emit({ ...details, tabId: -1, documentId: undefined });
    const hosts = bg.runtime.state.reports.get(KEY1)?.hosts ?? [];
    expect(hosts).toEqual([]);
    expect(JSON.stringify([...fake.session.data])).not.toContain('cdn.vendor.net');
    expect(JSON.stringify(bg.runtime.state.reports.get(KEY1))).not.toContain('SECRET');
    expect(bg.runtime.state.unattributed.requests).toBe(0);
    expect(bg.network.filter).toEqual({ urls: ['http://*/*', 'https://*/*'], types: ['script', 'xmlhttprequest', 'sub_frame', 'other'] });
  });
});

describe('audit regressions: scope, startup and privacy', () => {
  it('F001/F014: fresh off navigation, iframes and restart persist no browsing hosts and project no-access', async () => {
    const { bg, fake } = await setup({ grantedOrigins: ['http://*/*', 'https://*/*'] });
    bg.navigation.onCommitted(committed({ url: 'https://bank.example/' }));
    bg.navigation.onCommitted(committed({ frameId: 3, documentId: D2, frameType: 'sub_frame', parentDocumentId: D1, url: 'https://clinic.example/' }));
    await settle(10);
    await bg.runtime.flushIndex();
    expect(bg.runtime.getProjection(7)).toMatchObject({ host: null, coverageState: 'no-access' });
    expect(JSON.stringify([...fake.session.data])).not.toMatch(/bank\.example|clinic\.example/);
    bg.runtime.stop();
    fake.tabList = [{ id: 7 }];
    fake.framesByTab.set(7, [committed({ url: 'https://bank.example/' })]);
    const next = createBackground(fake, { ttlIntervalMs: 0, persistDebounceMs: 1 });
    await next.start();
    await settle(10);
    await next.runtime.flushIndex();
    expect(JSON.stringify([...fake.session.data])).not.toMatch(/bank\.example|clinic\.example/);
    expect(next.runtime.getProjection(7)).toMatchObject({ host: null, coverageState: 'no-access' });
    next.runtime.stop();
  });

  it.each(['off', 'site', 'active-tab'] as const)('F002/F021/F028: narrowing all-sites to %s rejects already-injected senders despite retained broad grants', async (mode) => {
    const { bg, fake } = await setup({ grantedOrigins: ['http://*/*', 'https://*/*'] });
    await send(bg, { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' }, uiSender());
    bg.navigation.onCommitted(committed());
    await send(bg, batchOf(1), pageSender());
    const result = await send(bg, { schemaVersion: 1, type: 'ui-set-scope', scopeMode: mode, ...(mode === 'site' ? { host: 'selected.example' } : {}) }, uiSender());
    expect(result.type).toBe('scope');
    expect(fake.grantedOrigins.has('https://*/*')).toBe(true);
    expect(await send(bg, batchOf(2, [obs({ count: 99 })]), pageSender())).toMatchObject({ paused: true, lastCommittedBatchSeq: 0 });
    bg.runtime.dispatch({ type: 'network:host', tabId: 7, frameId: 0, documentId: D1, parentFrameId: -1, parentDocumentId: null, resourceType: 'script', host: 'secret.example', at: 2 });
    expect(bg.runtime.state.reports.get(KEY1)).toMatchObject({ host: null, counters: [], hosts: [], coverageState: 'no-access' });
    expect(bg.runtime.state.reports.get(KEY1)?.coverageFlags).toContain('revoked');
    await settle(10);
    expect(JSON.stringify([...fake.session.data])).not.toContain('example.com');
    bg.runtime.stop();
  });

  it('F003: document-bound activeTab survives SW restart without any host permission', async () => {
    const { bg, fake } = await setup();
    fake.tabList = [{ id: 7 }];
    fake.framesByTab.set(7, [committed()]);
    bg.navigation.onCommitted(committed());
    expect(await send(bg, { schemaVersion: 1, type: 'ui-inject-now', tabId: 7 }, uiSender())).toMatchObject({ type: 'ok' });
    expect(await send(bg, batchOf(1, [obs({ count: 4 })]), pageSender())).toMatchObject({ lastCommittedBatchSeq: 1 });
    await bg.runtime.flushIndex();
    bg.runtime.stop();
    const next = createBackground(fake, { ttlIntervalMs: 0, persistDebounceMs: 1 });
    await next.start();
    expect(fake.grantedOrigins.size).toBe(0);
    expect(await send(next, batchOf(2, [obs({ count: 6 })]), pageSender())).toMatchObject({ lastCommittedBatchSeq: 2, protocolOk: true });
    expect(next.runtime.getProjection(7)?.techniques[0]?.count).toBe(6);
    next.runtime.stop();
  });

  it.each(['https://other.example/', 'http://example.com/', 'https://example.com:8443/', 'about:blank'])(
    'F110/F112/F172: activeTab identity expires on a new document at %s', async (url) => {
      const { bg, fake } = await setup();
      fake.framesByTab.set(7, [committed()]);
      bg.navigation.onCommitted(committed());
      await send(bg, { schemaVersion: 1, type: 'ui-clear-session' }, uiSender());
      expect(await send(bg, { schemaVersion: 1, type: 'ui-inject-now', tabId: 7 }, uiSender())).toMatchObject({ type: 'ok' });
      // The clear happened before this realm had access: its first verified delivery completes the pending reset.
      expect(await send(bg, batchOf(1), pageSender())).toMatchObject({ lastCommittedBatchSeq: 0 });
      expect(await send(bg, batchOf(1, [obs()], fake.historyEpochs.get(KEY1)), pageSender())).toMatchObject({ lastCommittedBatchSeq: 1 });
      bg.navigation.onCommitted(committed({ documentId: D2, url }));
      await bg.runtime.onPermissionsChanged();
      expect(await send(bg, batchOf(2), pageSender())).toMatchObject({ paused: true, lastCommittedBatchSeq: 0 });
      expect(bg.runtime.scope.isTabActiveTabGranted(7, null, D1)).toBe(false);
      bg.runtime.stop();
    },
  );

  it('F110/F172: unknown injection identity is never a wildcard and causes no script execution', async () => {
    const { bg, fake } = await setup();
    expect(await send(bg, { schemaVersion: 1, type: 'ui-inject-now', tabId: 7 }, uiSender())).toMatchObject({ type: 'error', code: 'no-access' });
    expect(fake.executeScriptCalls).toHaveLength(0);
    expect(bg.runtime.scope.isTabActiveTabGranted(7, 'any.example', D1)).toBe(false);
  });

  it.each(['http', 'https'] as const)('F111/F113: %s-only access registers only that scheme and revocation reconciles scope preferences', async (scheme) => {
    const { bg, fake } = await setup({ grantedOrigins: [scheme + '://only.example/*'] });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: 'only.example' }, uiSender())).toMatchObject({ type: 'scope' });
    expect(fake.registered.get(MAIN_SCRIPT_ID)?.matches).toEqual([scheme + '://only.example/*']);
    bg.navigation.onCommitted(committed({ url: (scheme === 'https' ? 'http' : 'https') + '://only.example/' }));
    expect(bg.runtime.getProjection(7)).toMatchObject({ host: null, coverageState: 'no-access' });
    fake.revoke([scheme + '://only.example/*']);
    await bg.runtime.onPermissionsChanged();
    expect(await send(bg, { schemaVersion: 1, type: 'ui-get-scope' }, uiSender())).toMatchObject({ scope: { scopeMode: 'off', hosts: [] } });
    expect(fake.local.data.get('scope')).toEqual({ v: 1, scopeMode: 'off', hosts: [] });
  });

  it('F113: startup also prunes a grant removed while the worker was stopped', async () => {
    const fake = createFakeChrome();
    fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['revoked.example'] });
    const bg = createBackground(fake, { ttlIntervalMs: 0 });
    await bg.start();
    expect(await send(bg, { schemaVersion: 1, type: 'ui-get-scope' }, uiSender())).toMatchObject({ scope: { scopeMode: 'off', hosts: [] } });
  });

  it.each([ISOLATED_SCRIPT_ID, MAIN_SCRIPT_ID])('F114/F173: partial registration %s recovers and concurrent changes finish at off', async (id) => {
    const { bg, fake } = await setup({ grantedOrigins: ['https://partial.example/*'] });
    fake.registered.set(id, { id });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: 'partial.example' }, uiSender())).toMatchObject({ type: 'scope' });
    expect([...fake.registered.keys()].sort()).toEqual([ISOLATED_SCRIPT_ID, MAIN_SCRIPT_ID].sort());
    const first = bg.runtime.scope.ensureRegistration();
    const second = bg.runtime.scope.setScope({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'off' });
    await Promise.all([first, second, bg.runtime.onPermissionsChanged()]);
    expect(fake.registered.size).toBe(0);
    expect(bg.runtime.scope.registrationHealthy).toBe(true);
  });

  it('F020: a failed permissions query yields a retryable non-Ack and is not cached as denial', async () => {
    const { bg, fake } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    const contains = fake.permissions.contains;
    let calls = 0;
    fake.permissions.contains = async (p) => { if (++calls === 1) throw new Error('temporary'); return contains(p); };
    expect(await send(bg, batchOf(1), pageSender())).toMatchObject({ type: 'error' });
    expect(await send(bg, batchOf(1), pageSender())).toMatchObject({ lastCommittedBatchSeq: 1, protocolOk: true });
    expect(calls).toBe(2);
    expect(bg.runtime.getProjection(7)?.coverageFlags).not.toContain('protocol-mismatch');
  });

  it('F025: scope-dependent UI waits for deferred preferences and mutations cannot race loading', async () => {
    const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
    fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
    const get = fake.local.get.bind(fake.local);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    fake.local.get = async (keys) => { await gate; return get(keys); };
    const bg = createBackground(fake, { ttlIntervalMs: 0 });
    const starting = bg.start();
    let answered = false;
    const read = send(bg, { schemaVersion: 1, type: 'ui-get-scope' }, uiSender()).then((r) => { answered = true; return r; });
    await settle();
    expect(answered).toBe(false);
    release();
    await starting;
    expect(await read).toMatchObject({ scope: { scopeMode: 'site', hosts: ['example.com'] } });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'off' }, uiSender())).toMatchObject({ scope: { scopeMode: 'off' } });
  });

  it.each(['http://127.0.0.2/', 'http://2130706434/', 'http://0x7f000002/', 'http://10.255.255.1/', 'http://169.254.1.1/', 'http://[fe80::1]/', 'https://RANDOM_CANARY.dnsprobe.example/'])(
    'F016/F022: completed request %s leaves no destination in session storage', async (url) => {
      const { bg, fake } = await setup({ grantedOrigins: ['http://*/*', 'https://*/*'] });
      await send(bg, { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' }, uiSender());
      bg.navigation.onCommitted(committed());
      bg.network.onCompleted({ tabId: 7, frameId: 0, documentId: D1, url, type: 'xmlhttprequest', timeStamp: 1 });
      await settle(10);
      expect(bg.runtime.state.reports.get(KEY1)?.hosts).toEqual([]);
      expect(JSON.stringify([...fake.session.data])).not.toContain(new URL(url).hostname);
      bg.runtime.stop();
    },
  );

  it('F098: same-extension opaque-origin sensor gets a terminal Ack, foreign extension stays unauthorized', async () => {
    const { bg } = await setup();
    expect(await send(bg, batchOf(1), pageSender({ url: 'data:text/html,x', origin: 'null' }))).toMatchObject({ type: 'ack', protocolOk: true, stopReason: 'revoked', paused: true });
    expect(await send(bg, batchOf(1), pageSender({ id: 'foreign', url: 'data:text/html,x', origin: 'null' }))).toMatchObject({ type: 'error', code: 'unauthorized-sender' });
  });
});

describe('audit regressions: asynchronous scope transitions', () => {
  it('F001/F002: an older in-flight index write cannot restore hosts after scope off', async () => {
    const { bg, fake } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    const set = fake.session.set.bind(fake.session);
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((r) => { entered = r; });
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    fake.session.set = async (items) => {
      if (first && Object.keys(items).some((k) => k.startsWith('doc:'))) { first = false; entered(); await gate; }
      await set(items);
    };
    const pending = send(bg, batchOf(1), pageSender());
    await blocked;
    const off = send(bg, { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'off' }, uiSender());
    await settle();
    release();
    await Promise.all([pending, off]);
    await bg.runtime.flushIndex();
    expect(JSON.stringify([...fake.session.data])).not.toContain('example.com');
    expect(bg.runtime.state.reports.get(KEY1)?.coverageState).toBe('no-access');
    bg.runtime.stop();
  });

  it('F003/F110: a collector arriving during injection waits for its grant instead of receiving terminal denial', async () => {
    const { bg, fake } = await setup();
    fake.framesByTab.set(7, [committed()]);
    bg.navigation.onCommitted(committed());
    const execute = fake.scripting.executeScript;
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((r) => { entered = r; });
    const gate = new Promise<void>((r) => { release = r; });
    fake.scripting.executeScript = async (injection) => { entered(); await gate; return execute(injection); };
    const injecting = send(bg, { schemaVersion: 1, type: 'ui-inject-now', tabId: 7 }, uiSender());
    await blocked;
    let answered = false;
    const batch = send(bg, batchOf(1), pageSender()).then((answer) => { answered = true; return answer; });
    await settle();
    expect(answered).toBe(false);
    release();
    expect(await injecting).toMatchObject({ type: 'ok' });
    expect(await batch).toMatchObject({ protocolOk: true, lastCommittedBatchSeq: 1 });
    bg.runtime.stop();
  });

  it('F110/F173: scope off queued during injection wins and subsequent navigation scrubs expired data without a permission event', async () => {
    const { bg, fake } = await setup();
    fake.framesByTab.set(7, [committed()]);
    bg.navigation.onCommitted(committed());
    await send(bg, { schemaVersion: 1, type: 'ui-inject-now', tabId: 7 }, uiSender());
    await send(bg, batchOf(1), pageSender());
    bg.navigation.onCommitted(committed({ documentId: D2, url: 'https://new.example/' }));
    await settle(10);
    expect(bg.runtime.state.reports.get(KEY1)).toMatchObject({ host: null, counters: [], coverageState: 'no-access' });
    expect(JSON.stringify([...fake.session.data])).not.toContain('example.com');
    bg.runtime.stop();
  });

  it('F098: a rejected opaque child marks its browser-identified parent partial', async () => {
    const { bg } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    await send(bg, batchOf(1), pageSender());
    bg.navigation.onCommitted(committed({ frameId: 3, documentId: D2, parentDocumentId: D1, frameType: 'sub_frame', url: 'data:text/html,x' }));
    expect(await send(bg, batchOf(1), pageSender({ frameId: 3, documentId: D2, origin: 'null', url: 'data:text/html,x' }))).toMatchObject({ protocolOk: true, stopReason: 'revoked' });
    expect(bg.runtime.getProjection(7)).toMatchObject({ coverageState: 'partial' });
    expect(bg.runtime.getProjection(7)?.coverageFlags).toContain('frames-inaccessible');
  });

  it('P06: an ungranted HTTP child marks its parent partial without sending any batch', async () => {
    const { bg } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    await send(bg, batchOf(1), pageSender());
    bg.navigation.onCommitted(committed({ frameId: 3, documentId: D2, parentDocumentId: D1, frameType: 'sub_frame', url: 'https://ungranted.test/' }));
    expect(bg.runtime.getProjection(7, 3)).toMatchObject({ coverageState: 'no-access', techniques: [] });
    expect(bg.runtime.getProjection(7)).toMatchObject({ coverageState: 'partial', coverageFlags: ['frames-inaccessible'] });
    bg.runtime.stop();
  });

  it.each([null, 'old-parent-document'])('P06: denied child cannot mark an unrelated parent (%s)', async (parentDocumentId) => {
    const { bg } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    await send(bg, batchOf(1), pageSender());
    bg.navigation.onCommitted(committed({ frameId: 3, documentId: D2, ...(parentDocumentId === null ? {} : { parentDocumentId }), frameType: 'sub_frame', url: 'https://ungranted.test/' }));
    expect(bg.runtime.getProjection(7)?.coverageFlags).not.toContain('frames-inaccessible');
    bg.runtime.stop();
  });

  it('P06: an accessible child does not claim a frame coverage gap', async () => {
    const { bg } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    await send(bg, batchOf(1), pageSender());
    bg.navigation.onCommitted(committed({ frameId: 3, documentId: D2, parentDocumentId: D1, frameType: 'sub_frame' }));
    expect(bg.runtime.getProjection(7)?.coverageFlags).not.toContain('frames-inaccessible');
    bg.runtime.stop();
  });

  it('P06: an inherited-origin commit waits for sender access evidence before marking a gap', async () => {
    const { bg } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    await send(bg, batchOf(1), pageSender());
    bg.navigation.onCommitted(committed({ frameId: 3, documentId: D2, parentDocumentId: D1, frameType: 'sub_frame', url: 'about:blank' }));
    expect(bg.runtime.getProjection(7)?.coverageFlags).not.toContain('frames-inaccessible');
    expect(await send(bg, batchOf(1), pageSender({ frameId: 3, documentId: D2, origin: 'https://example.com', url: 'about:blank' }))).toMatchObject({ lastCommittedBatchSeq: 1 });
    expect(bg.runtime.getProjection(7)?.coverageFlags).not.toContain('frames-inaccessible');
    bg.runtime.stop();
  });

  it('F026: global and tab limits run before validation and permission lookups, including malformed envelopes', async () => {
    const { bg, fake } = await setup({ grantedOrigins: ['https://example.com/*'] });
    let queries = 0;
    const contains = fake.permissions.contains;
    fake.permissions.contains = async (p) => { queries++; return contains(p); };
    for (let i = 0; i < 100; i++) {
      const sender = pageSender({ frameId: i, documentId: 'doc-' + i });
      await send(bg, { ...batchOf(1), unexpected: true }, sender);
    }
    expect(bg.runtime.admitBatch({ tabId: 7, frameId: 999, documentId: 'last', documentKey: '7:999:last', host: 'example.com', originPattern: 'https://example.com/*', documentLifecycle: 'active', frameType: 'sub_frame' })).toBe(false);
    for (let i = 0; i < 100; i++) await send(bg, { ...batchOf(1), unexpected: true }, pageSender({ tabId: 8, frameId: i, documentId: 'other-' + i }));
    expect(bg.runtime.admitBatch({ tabId: 9, frameId: 0, documentId: 'last', documentKey: '9:0:last', host: 'example.com', originPattern: 'https://example.com/*', documentLifecycle: 'active', frameType: null })).toBe(false);
    expect(queries).toBe(0);
  });
});

describe('integration round 2: bridge-control, coverage-only batches, uninjected documents', () => {
  it('ui-pause / ui-resume send bridge-control to the document (F030); resume requires the current revision (F039)', async () => {
    const { bg, fake } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    await send(bg, batchOf(1, [obs({ count: 2 })]), pageSender());
    const rep = await send(bg, { schemaVersion: 1, type: 'ui-get-report', tabId: 7 }, uiSender());
    if (rep.type !== 'report' || rep.report === null) throw new Error('expected a report');
    expect(await send(bg, { schemaVersion: 1, type: 'ui-pause', tabId: 7, documentKey: KEY1, reportRevision: rep.report.reportRevision }, uiSender())).toMatchObject({ type: 'ok' });
    expect(fake.sentToTabs).toEqual([{ tabId: 7, message: { schemaVersion: 1, type: 'bridge-control', command: 'pause' }, options: { frameId: 0, documentId: D1 } }]);
    const paused = await send(bg, { schemaVersion: 1, type: 'ui-get-report', tabId: 7 }, uiSender());
    if (paused.type !== 'report' || paused.report === null) throw new Error('expected a report');
    expect(paused.report.coverageState).toBe('paused');
    expect(await send(bg, { schemaVersion: 1, type: 'ui-resume', tabId: 7, documentKey: KEY1 }, uiSender())).toEqual({ schemaVersion: 1, type: 'error', code: 'invalid-request' });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-resume', tabId: 7, documentKey: KEY1, reportRevision: paused.report.reportRevision + 1 }, uiSender())).toEqual({ schemaVersion: 1, type: 'error', code: 'stale-revision' });
    expect(await send(bg, { schemaVersion: 1, type: 'ui-resume', tabId: 7, documentKey: KEY1, reportRevision: paused.report.reportRevision }, uiSender())).toMatchObject({ type: 'ok' });
    expect(fake.sentToTabs.map((m) => (m.message as { command: string }).command)).toEqual(['pause', 'resume']);
    expect(bg.runtime.getProjection(7)?.coverageState).not.toBe('paused');
  });

  it('accepts a coverage-only batch (observations: []): flags merge, no boot identity or counter is created', async () => {
    const { bg } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    const ack = await send(bg, batchOf(1, [], { coverageDelta: ['protocol-mismatch', 'channel-gap'] }), pageSender());
    expect(ack).toEqual({ schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: 1, paused: false, protocolOk: true });
    const r = bg.runtime.state.reports.get(KEY1);
    expect(r?.coverageFlags).toEqual(expect.arrayContaining(['protocol-mismatch', 'channel-gap']));
    expect(r?.counters).toEqual([]);
    expect(bg.runtime.state.metas.get(KEY1)?.boots).toEqual([]);
    expect(bg.runtime.state.metas.get(KEY1)?.firstObservationAt).toBeNull();
    expect(bg.runtime.getProjection(7)?.coverageState).not.toBe('active');
    expect(bg.runtime.getProjection(7)?.techniques).toEqual([]);
    // Nothing to report at all is rejected by the validator and counted as a transport drop.
    expect(await send(bg, batchOf(2, [], { coverageDelta: [] }), pageSender())).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 1 });
    // A later real batch still counts normally.
    expect(await send(bg, batchOf(2, [obs({ count: 3 })]), pageSender())).toMatchObject({ lastCommittedBatchSeq: 2 });
    expect(bg.runtime.state.reports.get(KEY1)?.counters[0]?.count).toBe(3);
    expect(bg.runtime.state.metas.get(KEY1)?.boots).toHaveLength(1);
  });

  it('a document whose sensors are not registered and never connected is projected as no-access, not partial (F162)', async () => {
    const { bg, fake, clock } = await setup({ grantedOrigins: ['https://example.com/*'] });
    bg.navigation.onCommitted(committed());
    // Registration is not evidence of injection into this particular document (F162).
    const before = await send(bg, { schemaVersion: 1, type: 'ui-get-report', tabId: 7 }, uiSender());
    expect(before.type === 'report' && before.report?.coverageState).toBe('no-access');
    // Registration disappears behind the SW's back (e.g. the browser dropped it): nobody can have injected sensors.
    await fake.scripting.unregisterContentScripts({ ids: ['detector-isolated-v1', 'detector-main-v1'] });
    clock.t += 2000;
    const after = await send(bg, { schemaVersion: 1, type: 'ui-get-report', tabId: 7 }, uiSender());
    if (after.type !== 'report' || after.report === null) throw new Error('expected a report');
    expect(after.report.coverageState).toBe('no-access');
    expect(after.report.coverageFlags).toContain('no-host-permission');
    expect(after.report.techniques).toEqual([]);
    // A connected sensor always wins over the registration heuristic.
    await send(bg, batchOf(1, [obs({ count: 1 })]), pageSender());
    expect(bg.runtime.getProjection(7)?.coverageState).toBe('active');
  });
});

// F083/F137: injection must neither reclassify existing sensors nor mutate scope on a navigation race.
describe('integration injection races', () => {
  it('keeps an already observed document free of late-start on reinjection', async () => {
    const { bg, fake } = await setup({ grantedOrigins: ['https://example.com/*'] });
    fake.framesByTab.set(7, [committed()]);
    bg.navigation.onCommitted(committed());
    await send(bg, batchOf(1), pageSender());
    expect(await send(bg, { schemaVersion: 1, type: 'ui-inject-now', tabId: 7 }, uiSender())).toMatchObject({ type: 'ok' });
    expect(bg.runtime.getProjection(7)?.coverageFlags).not.toContain('late-start');
    expect(bg.runtime.scope.getScopeMode()).toBe('active-tab');
    bg.navigation.onCommitted(committed({ documentId: D2 }));
    expect(bg.runtime.scope.isTabActiveTabGranted(7, 'example.com', D2)).toBe(false);
    expect(bg.runtime.getProjection(7)?.coverageState).toBe('no-access');
  });

  it('navigation during injection preserves prior scope and never marks the replacement late', async () => {
    const { bg, fake } = await setup({ grantedOrigins: ['https://example.com/*'] });
    fake.framesByTab.set(7, [committed()]);
    bg.navigation.onCommitted(committed());
    const execute = fake.scripting.executeScript;
    fake.scripting.executeScript = async (injection) => {
      const result = await execute(injection);
      fake.framesByTab.set(7, [committed({ documentId: D2 })]);
      bg.navigation.onCommitted(committed({ documentId: D2 }));
      return result;
    };
    expect(await send(bg, { schemaVersion: 1, type: 'ui-inject-now', tabId: 7 }, uiSender())).toMatchObject({ type: 'error', code: 'no-access' });
    expect(bg.runtime.scope.getScopeMode()).toBe('site');
    expect(bg.runtime.getProjection(7)?.coverageFlags).not.toContain('late-start');
    expect(fake.executeScriptCalls.every((c) => c.target.documentIds?.[0] === D1)).toBe(true);
  });
});
