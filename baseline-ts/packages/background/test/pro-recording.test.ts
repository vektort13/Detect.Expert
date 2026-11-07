import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_COUNT, PRO_LIMITS, validateProSession } from '@detect-expert/contracts';
import type { PageBatch, ProSession, ProStateResponse, RtcSnapshot } from '@detect-expert/contracts';
import { createBackground, PRO_ALARM_NAME, PRO_STORAGE_KEY, readPageSender, route } from '../src/index';
import type { BackgroundRuntime, RequestDetailsLike, TabDetailsLike } from '../src/index';
import { committed, createFakeChrome, FakeEvent, pageSender, uiSender } from './fake-chrome';
import { safeProResourceUrl, safeProTitle, safeProUrl } from '../src/pro-redaction';
import { runRules } from '../../engine/src/index';

const DOC = 'DOC000000000000000000000000000001';
const DOC2 = 'DOC000000000000000000000000000002';
const active: BackgroundRuntime[] = [];
afterEach(() => { for (const runtime of active.splice(0)) runtime.stop(); vi.useRealTimers(); });

async function fixture(now = 1_000_000) {
  const clock = { t: now, now() { return this.t; } };
  const fake = createFakeChrome({ hostPermissions: ['http://*/*', 'https://*/*'], grantedOrigins: ['http://*/*', 'https://*/*'] });
  const tab: TabDetailsLike = { id: 7, url: 'https://example.com/', title: 'Example' };
  fake.tabList.push({ id: 7 });
  fake.tabs.get = async id => id === 7 ? { ...tab } : { id, url: 'https://example.com/catalog', title: 'Catalog' };
  fake.framesByTab.set(7, [{ frameId: 0, documentId: DOC, url: tab.url!, documentLifecycle: 'active' }]);
  const alarms = new Map<string, number>();
  fake.alarms = { async create(name, info) { alarms.set(name, info.when); }, async clear(name) { return alarms.delete(name); }, onAlarm: new FakeEvent() };
  const bg = createBackground(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1, engine: { deriveFindings(report) { return runRules({ counters: report.counters, coverageFlags: report.coverageFlags }).findings; } } });
  active.push(bg.runtime);
  await bg.start();
  const navigate = (url: string, documentId = DOC2, tabId = 7, routeChange = false) => {
    clock.t += 10;
    if (tabId === 7) tab.url = url;
    fake.framesByTab.set(tabId, [{ frameId: 0, documentId, url, documentLifecycle: 'active' }]);
    const event = committed({ tabId, url, documentId, timeStamp: clock.t });
    if (routeChange) bg.navigation.onHistoryStateUpdated(event); else bg.navigation.onCommitted(event);
  };
  return { bg, fake, clock, alarms, tab, navigate };
}

async function command(runtime: BackgroundRuntime, request: object): Promise<ProStateResponse> {
  const response = await route(runtime, { schemaVersion: 1, ...request }, uiSender());
  if (response.type !== 'pro-state') throw new Error(JSON.stringify(response));
  if (response.session) expect(validateProSession(response.session).ok).toBe(true);
  return response;
}
async function session(runtime: BackgroundRuntime): Promise<ProSession> {
  const result = (await command(runtime, { type: 'ui-pro-get' })).session;
  if (!result) throw new Error('no session');
  return result;
}
async function observe(runtime: BackgroundRuntime, count: number, seq: number, doc = DOC, tabId = 7, frameId = 0) {
  const sender = readPageSender(pageSender({ tabId, docId: doc, frameId }), runtime.api.runtime.id);
  if (!sender.ok) throw new Error('bad sender');
  const batch: PageBatch = { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'boot-1', bridgeSessionId: 'bridge-1', batchSeq: seq,
    observations: [{ techniqueId: 'DET-001', count, countQuality: 'exact', phase: 'attempted', signalCodes: ['api-use'], intervalBucket: seq }], coverageDelta: [] };
  await runtime.handleBatch(sender.context, batch, true);
}
async function observeBoot(runtime: BackgroundRuntime, boot: string, seq: number, counts: Array<[PageBatch['observations'][number]['techniqueId'], number]>) {
  const sender = readPageSender(pageSender(), runtime.api.runtime.id);
  if (!sender.ok) throw new Error('bad sender');
  await runtime.handleBatch(sender.context, { schemaVersion: 1, type: 'sensor-events', sensorBootId: boot, bridgeSessionId: 'bridge-' + boot, batchSeq: seq,
    observations: counts.map(([techniqueId, count]) => ({ techniqueId, count, countQuality: 'exact', phase: 'attempted', signalCodes: ['api-use'], intervalBucket: seq })), coverageDelta: [] }, true);
}
async function clearLight(runtime: BackgroundRuntime) {
  const report = runtime.getProjection(7)!;
  expect(await runtime.clear(7, report.documentKey, report.reportRevision)).toMatchObject({ type: 'ok' });
}
function techniqueCounts(value: ProSession, page = 0) {
  return Object.fromEntries(value.pages[page]!.reports.flatMap(report => report.techniques.map(item => [item.techniqueId, item.count])));
}
function request(overrides: Partial<RequestDetailsLike> = {}): RequestDetailsLike {
  return { requestId: '1', tabId: 7, frameId: 0, documentId: DOC, url: 'https://cdn.other.com/scripts/main.js?token=SECRET#PRIVATE', type: 'script', timeStamp: 1000000, initiator: 'https://example.com', ...overrides };
}

describe('Pro recording', () => {
  it('ADR-038: startup replay keeps each queued navigation response in its own Pro visit', async () => {
    const state = await fixture();
    state.fake.grantedOrigins.add('ws://*/*'); state.fake.grantedOrigins.add('wss://*/*');
    await state.bg.runtime.onPermissionsChanged();
    await command(state.bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    await state.bg.runtime.pro.flush(); await state.bg.runtime.flushIndex(); state.bg.runtime.stop();
    let reached!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const write = state.fake.session.set.bind(state.fake.session);
    let held = false;
    vi.spyOn(state.fake.session, 'set').mockImplementation(async items => {
      if (!held && Object.hasOwn(items, PRO_STORAGE_KEY)) { held = true; reached(); await blocked; }
      await write(items);
    });
    const restored = createBackground(state.fake, { clock: state.clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
    active.push(restored.runtime);
    const start = restored.start(); await entered;
    try {
      for (const [documentId, name] of [['queued-first', 'NEL'], ['queued-second', 'Report-To']] as const) {
        state.clock.t++;
        const navigation = { tabId: 7, frameId: 0, url: 'https://example.com/' + documentId, timeStamp: state.clock.t };
        const browserRequest = { ...navigation, requestId: documentId, type: 'main_frame' };
        restored.navigation.onBeforeNavigate(navigation); restored.runtime.responseHeaders.onBeforeRequest(browserRequest);
        restored.network.onResponseCompleted({ ...browserRequest, responseHeaders: [{ name }] });
        state.clock.t++;
        restored.navigation.onCommitted(committed({ ...navigation, documentId, timeStamp: state.clock.t }));
      }
      release(); await start;
      const value = await session(restored.runtime);
      for (const [documentId, name] of [['queued-first', 'nel'], ['queued-second', 'report-to']] as const) {
        const page = value.pages.find(page => page.documentKey === '7:0:' + documentId);
        expect(page?.reports[0]?.responseHeaders?.entries).toEqual([{ name, count: 1, clientHints: [] }]);
        expect(restored.runtime.state.metas.get('7:0:' + documentId)?.responseHeaders?.entries).toEqual([{ name, count: 1, clientHints: [] }]);
      }
      await restored.runtime.pro.flush();
      expect(JSON.stringify([...state.fake.session.data.values()])).not.toContain('proPeriod');
    } finally { release(); await start; }
  });

  it.each([false, true])('ADR-038: pending navigation headers respect the exact Pro start boundary (preStart=%s)', async preStart => {
    const state = await fixture();
    if (!preStart) await command(state.bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    const navigation = { tabId: 7, frameId: 0, url: 'https://example.com/catalog', timeStamp: state.clock.t };
    const browserRequest = { ...navigation, type: 'main_frame', requestId: 'header-navigation' };
    state.bg.navigation.onBeforeNavigate(navigation);
    state.bg.runtime.responseHeaders.onBeforeRequest(browserRequest);
    state.bg.network.onResponseCompleted({ ...browserRequest, responseHeaders: [{ name: 'NEL', value: 'PRO_START_SECRET' }] });
    if (preStart) await command(state.bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    state.navigate(navigation.url);
    expect(state.bg.runtime.getProjection(7)?.responseHeaders?.entries[0]?.count).toBe(1);
    const value = await session(state.bg.runtime);
    const headers = value.pages.flatMap(page => page.reports).flatMap(report => report.responseHeaders?.entries ?? []);
    expect(headers).toEqual(preStart ? [] : [{ name: 'nel', count: 1, clientHints: [] }]);
    expect(JSON.stringify(value)).not.toContain('PRO_START_SECRET');
  });

  it('ADR-028: named targets stay separate across baseline, Light clear, restore and export', async () => {
    const state = await fixture();
    const send = async (runtime: BackgroundRuntime, batchSeq: number, first: number, second: number) => {
      const sender = readPageSender(pageSender(), runtime.api.runtime.id);
      if (!sender.ok) throw new Error('bad sender');
      await runtime.handleBatch(sender.context, { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'targets-boot',
        bridgeSessionId: 'targets-bridge', batchSeq, coverageDelta: [], observations: [
          { techniqueId: 'DET-059', extensionResource: { target: 'lanfdkkpgfjfdikkncbnojekcppdebfp', method: 'fetch' }, count: first, phase: 'settlement-unobserved', countQuality: 'exact', signalCodes: ['api-use'], intervalBucket: batchSeq },
          { techniqueId: 'DET-059', extensionResource: { target: 'pkehgijcmpdhfbdbbnkijodmdjhbjlgp', method: 'fetch' }, count: second, phase: 'settlement-unobserved', countQuality: 'exact', signalCodes: ['api-use'], intervalBucket: batchSeq },
        ] }, true);
    };
    const counts = (value: ProSession) => value.pages.flatMap(page => page.reports.flatMap(report => report.extensionResources ?? [])).map(row => row.count);
    await send(state.bg.runtime, 1, 2, 5);
    await command(state.bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    expect(counts(await session(state.bg.runtime))).toEqual([]);
    await send(state.bg.runtime, 2, 4, 8);
    expect(counts(await session(state.bg.runtime))).toEqual([2, 3]);
    await clearLight(state.bg.runtime); await state.bg.runtime.pro.flush();
    expect(await state.bg.runtime.persistNow('7:0:' + DOC)).toBe(true);
    await state.bg.runtime.flushIndex(); state.bg.runtime.stop();
    const restored = createBackground(state.fake, { clock: state.clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
    active.push(restored.runtime); await restored.start();
    expect(counts(await session(restored.runtime))).toEqual([2, 3]);
    await send(restored.runtime, 3, 5, 10);
    expect(counts(await session(restored.runtime))).toEqual([3, 5]);
    const light = restored.runtime.getProjection(7)!;
    const exported = await restored.runtime.exportPreview(7, light.documentKey, light.reportRevision, false);
    expect(exported).toMatchObject({ type: 'export-preview', preview: { report: { extensionResources: light.extensionResources } } });
  });
  it('ADR-029: distinct operations survive active restart and Light clear without replaying pre-Start totals', async () => {
    const state = await fixture();
    const send = async (runtime: BackgroundRuntime, seq: number, adapter: number, device: number) => {
      const sender = readPageSender(pageSender(), runtime.api.runtime.id);
      if (!sender.ok) throw new Error('bad sender');
      await runtime.handleBatch(sender.context, { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'operation-boot',
        bridgeSessionId: 'operation-bridge', batchSeq: seq, coverageDelta: [], observations: [
          { techniqueId: 'DET-013', apiOperation: 'GPUAdapter.info', phase: 'returned-sync', count: adapter, countQuality: 'exact', signalCodes: ['api-use'], intervalBucket: seq },
          { techniqueId: 'DET-013', apiOperation: 'GPUDevice.adapterInfo', phase: 'returned-sync', count: device, countQuality: 'exact', signalCodes: ['api-use'], intervalBucket: seq },
        ] }, true);
    };
    const counts = (value: ProSession) => Object.fromEntries(value.pages.flatMap(page => page.reports.flatMap(report =>
      (report.apiOperations ?? []).map(operation => [operation.apiOperation, operation.count]))));
    await send(state.bg.runtime, 1, 2, 5);
    await command(state.bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    expect(counts(await session(state.bg.runtime))).toEqual({});
    await send(state.bg.runtime, 2, 4, 8);
    expect(counts(await session(state.bg.runtime))).toEqual({ 'GPUAdapter.info': 2, 'GPUDevice.adapterInfo': 3 });
    await clearLight(state.bg.runtime);
    await state.bg.runtime.pro.flush();
    expect(await state.bg.runtime.persistNow('7:0:' + DOC)).toBe(true);
    await state.bg.runtime.flushIndex(); state.bg.runtime.stop();
    const restored = createBackground(state.fake, { clock: state.clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
    active.push(restored.runtime); await restored.start();
    expect((await session(restored.runtime)).status).toBe('recording');
    expect(counts(await session(restored.runtime))).toEqual({ 'GPUAdapter.info': 2, 'GPUDevice.adapterInfo': 3 });
    await send(restored.runtime, 3, 5, 10);
    expect(counts(await session(restored.runtime))).toEqual({ 'GPUAdapter.info': 3, 'GPUDevice.adapterInfo': 5 });
    await send(restored.runtime, 4, 5, 10);
    expect(counts(await session(restored.runtime))).toEqual({ 'GPUAdapter.info': 3, 'GPUDevice.adapterInfo': 5 });
  });

  async function localAttempts(state: Awaited<ReturnType<typeof fixture>>, ports: number[]) {
    if (!state.fake.grantedOrigins.has('ws://*/*')) {
      state.fake.grantedOrigins.add('ws://*/*');
      state.fake.grantedOrigins.add('wss://*/*');
      await state.bg.runtime.onPermissionsChanged();
    }
    for (const port of ports) {
      state.clock.t += 5;
      state.bg.network.onBeforeRequest(request({ requestId: 'local-' + state.clock.t, type: 'websocket',
        url: 'ws://127.0.0.1:' + port + '/?LOCAL_PROBE_PRO_CANARY', timeStamp: state.clock.t }));
    }
  }

  it('ADR-025: Pro starts a fresh local-port window and excludes every pre-Start browser attempt', async () => {
    const state = await fixture();
    await localAttempts(state, [8001, 8002, 8003]);
    await command(state.bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    await localAttempts(state, [8004]);
    let current = await session(state.bg.runtime);
    expect(techniqueCounts(current)['DET-060']).toBe(1);
    expect(current.pages[0]!.reports.flatMap(r => r.techniques).find(t => t.techniqueId === 'DET-060'))
      .toMatchObject({ interpretation: 'api-use', integrity: 'browser-observed' });
    await localAttempts(state, [8005, 8006, 8007]);
    current = await session(state.bg.runtime);
    expect(techniqueCounts(current)['DET-060']).toBe(4);
    expect(current.pages[0]!.reports.flatMap(r => r.techniques).find(t => t.techniqueId === 'DET-060'))
      .toMatchObject({ interpretation: 'local-probe-pattern', interpretationConfidence: 'low' });
    expect(JSON.stringify(current)).not.toMatch(/127\.0\.0\.1|LOCAL_PROBE_PRO_CANARY/);
    expect(current.pages[0]!.reports[0]?.requestedLocalPorts).toEqual({ ports: [8004, 8005, 8006, 8007], truncated: false });
  });

  it('ADR-031: Pro records requested ports after Start, including repeats, across Light clear and restart', async () => {
    const state = await fixture();
    await localAttempts(state, [8001, 8002]);
    await command(state.bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    expect((await session(state.bg.runtime)).pages.flatMap(page => page.reports).every(report => report.requestedLocalPorts === undefined)).toBe(true);
    await localAttempts(state, [8001, 8003, 8003]);
    expect((await session(state.bg.runtime)).pages[0]!.reports[0]?.requestedLocalPorts).toEqual({ ports: [8001, 8003], truncated: false });
    await clearLight(state.bg.runtime);
    expect(state.bg.runtime.getProjection(7)?.requestedLocalPorts).toBeUndefined();
    await state.bg.runtime.pro.flush();
    expect(await state.bg.runtime.persistNow('7:0:' + DOC)).toBe(true);
    await state.bg.runtime.flushIndex(); state.bg.runtime.stop();
    const restored = createBackground(state.fake, { clock: state.clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
    active.push(restored.runtime); await restored.start();
    expect((await session(restored.runtime)).pages[0]!.reports[0]?.requestedLocalPorts).toEqual({ ports: [8001, 8003], truncated: false });
    state.clock.t += 5;
    restored.network.onBeforeRequest(request({ requestId: 'after-restart', type: 'websocket', url: 'ws://127.0.0.1:8004/' }));
    expect((await session(restored.runtime)).pages[0]!.reports[0]?.requestedLocalPorts).toEqual({ ports: [8001, 8003, 8004], truncated: false });
    expect(restored.runtime.getProjection(7)?.requestedLocalPorts).toEqual({ ports: [8004], truncated: false });
  });

  it('ADR-031: Pro marks missing ports when Light committed ahead of the recording checkpoint', async () => {
    const state = await fixture();
    await localAttempts(state, []);
    await command(state.bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    await localAttempts(state, [8001]);
    await state.bg.runtime.pro.flush();
    const checkpoint = structuredClone(state.fake.session.data.get(PRO_STORAGE_KEY));
    await localAttempts(state, [8002]);
    expect(await state.bg.runtime.persistNow('7:0:' + DOC)).toBe(true);
    await state.bg.runtime.flushIndex(); state.bg.runtime.stop();
    state.fake.session.data.set(PRO_STORAGE_KEY, checkpoint);
    const restored = createBackground(state.fake, { clock: state.clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
    active.push(restored.runtime); await restored.start();
    const value = await session(restored.runtime);
    expect(techniqueCounts(value)['DET-060']).toBe(2);
    expect(value.pages[0]!.reports[0]?.requestedLocalPorts).toEqual({ ports: [8001], truncated: true });
  });

  it('ADR-031: saturated pre-Start counters cannot hide newly requested ports from Pro', async () => {
    const state = await fixture();
    await localAttempts(state, [8001]);
    const counter = state.bg.runtime.state.metas.get('7:0:' + DOC)!.networkCounters!.find(item => item.techniqueId === 'DET-060')!;
    counter.count = MAX_COUNT;
    await command(state.bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    expect(techniqueCounts(await session(state.bg.runtime))['DET-060'] ?? 0).toBe(0);
    await localAttempts(state, [8002, 8003]);
    const value = await session(state.bg.runtime);
    expect(techniqueCounts(value)['DET-060']).toBe(2);
    expect(value.pages[0]!.reports[0]?.requestedLocalPorts).toEqual({ ports: [8002, 8003], truncated: true });
    expect(value.pages[0]!.reports[0]?.techniques.find(item => item.techniqueId === 'DET-060')?.countQuality).toBe('lower-bound');
    await clearLight(state.bg.runtime);
    await localAttempts(state, [8004]);
    expect((await session(state.bg.runtime)).pages[0]!.reports[0]?.requestedLocalPorts).toEqual({ ports: [8002, 8003, 8004], truncated: true });
    expect(techniqueCounts(await session(state.bg.runtime))['DET-060']).toBe(3);
  });

  it('ADR-031: a visit remembers a lost request before its first port without importing an earlier visit', async () => {
    const state = await fixture();
    await localAttempts(state, []);
    await command(state.bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    state.bg.runtime.dispatch({ type: 'network:limited', documentKey: '7:0:' + DOC, at: state.clock.t });
    await localAttempts(state, [8001]);
    expect((await session(state.bg.runtime)).pages[0]!.reports[0]?.requestedLocalPorts).toEqual({ ports: [8001], truncated: true });
    state.navigate('https://example.com/next', DOC, 7, true);
    await localAttempts(state, [8002]);
    const value = await session(state.bg.runtime);
    expect(value.pages[1]!.reports[0]?.requestedLocalPorts).toEqual({ ports: [8002], truncated: false });
    expect(value.pages[0]!.reports[0]?.requestedLocalPorts).toEqual({ ports: [8001], truncated: true });
  });

  it('ADR-025: browser attempts survive repeated Light clear without counting an epoch twice', async () => {
    const state = await fixture();
    await command(state.bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    await localAttempts(state, [8001, 8002, 8003, 8004]);
    expect(techniqueCounts(await session(state.bg.runtime))['DET-060']).toBe(4);
    await clearLight(state.bg.runtime);
    await localAttempts(state, [8001, 8001]);
    expect(techniqueCounts(await session(state.bg.runtime))['DET-060']).toBe(6);
    expect(techniqueCounts(await session(state.bg.runtime))['DET-060']).toBe(6);
    await clearLight(state.bg.runtime);
    await localAttempts(state, [8001]);
    expect(techniqueCounts(await session(state.bg.runtime))['DET-060']).toBe(7);
    state.navigate('https://example.com/catalog', DOC, 7, true);
    await localAttempts(state, [8001, 8002]);
    const current = await session(state.bg.runtime);
    expect(techniqueCounts(current, 0)['DET-060']).toBe(7);
    expect(techniqueCounts(current, 1)['DET-060']).toBe(2);
    expect(current.pages[1]!.reports.flatMap(r => r.techniques).find(t => t.techniqueId === 'DET-060')?.interpretation).toBe('api-use');
  });

  it('ADR-025: browser clear epochs and pre-Start baselines survive an immediate worker restart', async () => {
    const state = await fixture();
    await localAttempts(state, [8001, 8002]);
    await command(state.bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    await localAttempts(state, [8001, 8002, 8003, 8004]);
    await clearLight(state.bg.runtime);
    state.bg.runtime.stop();
    const restored = createBackground(state.fake, { clock: state.clock, ttlIntervalMs: 0 }); active.push(restored.runtime);
    await restored.start();
    await localAttempts({ ...state, bg: restored }, [8001, 8002]);
    expect(techniqueCounts(await session(restored.runtime))['DET-060']).toBe(6);
    expect(techniqueCounts(await session(restored.runtime))['DET-060']).toBe(6);
  });

  it('ADR-027: active restart restores all four network baseline shapes without recounting pre-Start DNS', async () => {
    const state = await fixture();
    const sendDns = async (background: typeof state.bg, series: number, expected: number) => {
      for (let index = 0; index < 8; index++) {
        state.clock.t += 1;
        background.network.onBeforeRequest(request({ requestId: 'dns-' + series + '-' + index, type: 'xmlhttprequest',
          url: 'https://q7p9v2s4n6s' + series + 'x' + index + '.dns.example.net/?DNS_PRO_CANARY' }));
      }
      await vi.waitFor(() => expect(background.runtime.getProjection(7)?.techniques.find(entry => entry.techniqueId === 'DET-061')?.count).toBe(expected));
    };
    await localAttempts(state, [8001, 8002, 8003, 8004]);
    await sendDns(state.bg, 1, 8);
    const started = await command(state.bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    const initial = state.fake.session.data.get(PRO_STORAGE_KEY) as { baselines: Array<{ browserCounts: Array<[string, number]> }> };
    expect(initial.baselines[0]!.browserCounts.map(([key]) => key).sort()).toEqual([
      'DET-058|attempted|api-use', 'DET-060|attempted|api-use', 'DET-060|attempted|api-use,local-multi-port',
      'DET-061|attempted|api-use,unique-subdomains',
    ]);
    expect(techniqueCounts(await session(state.bg.runtime))['DET-061'] ?? 0).toBe(0);
    await localAttempts(state, [8010]);
    await sendDns(state.bg, 2, 16);
    expect(techniqueCounts(await session(state.bg.runtime))).toMatchObject({ 'DET-058': 1, 'DET-060': 1, 'DET-061': 8 });
    await state.bg.runtime.pro.flush();
    expect(await state.bg.runtime.persistNow('7:0:' + DOC)).toBe(true);
    await state.bg.runtime.flushIndex();
    state.bg.runtime.stop();
    const restored = createBackground(state.fake, { clock: state.clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
    active.push(restored.runtime);
    await restored.start();
    const continuing = await session(restored.runtime);
    expect(continuing).toMatchObject({ id: started.session!.id, status: 'recording' });
    expect(techniqueCounts(continuing)).toMatchObject({ 'DET-058': 1, 'DET-060': 1, 'DET-061': 8 });
    await sendDns(restored, 3, 24);
    const current = await session(restored.runtime);
    expect(techniqueCounts(current)).toMatchObject({ 'DET-058': 1, 'DET-060': 1, 'DET-061': 16 });
    expect(JSON.stringify([current, [...state.fake.session.data]])).not.toMatch(/q7p9v2s4n6|DNS_PRO_CANARY|dnsToken|hashSalt/);
  });

  it.each([null, [['DET-060|attempted|api-use', 2], ['DET-060|attempted|api-use', 3]], [['DET-058|attempted|api-use,local-multi-port', 1]]])(
    'ADR-025: rejects corrupt browser baselines instead of recounting old attempts (%j)', async invalid => {
      const state = await fixture();
      await localAttempts(state, [8001]);
      await command(state.bg.runtime, { type: 'ui-pro-start', tabId: 7 });
      const saved = structuredClone(state.fake.session.data.get(PRO_STORAGE_KEY)) as { baselines: Array<{ browserCounts: unknown }> };
      saved.baselines[0]!.browserCounts = invalid;
      state.fake.session.data.set(PRO_STORAGE_KEY, saved);
      state.bg.runtime.stop();
      const restored = createBackground(state.fake, { clock: state.clock, ttlIntervalMs: 0 }); active.push(restored.runtime);
      await restored.start();
      const result = await session(restored.runtime);
      expect(result.status).toBe('stopped');
      expect(result.stopReason).toBe('storage-error');
    },
  );

  it.each([0, 1000])('ADR-025: queued child attempts before Start stay outside Pro even with %dms clock separation', async delay => {
    const state = await fixture();
    await localAttempts(state, []);
    const pending = request({ requestId: 'pending-local', frameId: 2, documentId: DOC2, type: 'websocket',
      url: 'ws://127.0.0.1:8001/?LOCAL_PROBE_PRO_CANARY' });
    state.bg.network.onBeforeRequest(pending);
    state.clock.t += delay;
    await command(state.bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    state.fake.framesByTab.set(7, [
      { frameId: 0, documentId: DOC, url: 'https://example.com/', documentLifecycle: 'active' },
      { frameId: 2, parentFrameId: 0, parentDocumentId: DOC, documentId: DOC2, url: 'https://example.com/child', documentLifecycle: 'active' },
    ]);
    state.bg.navigation.onCommitted(committed({ frameId: 2, parentFrameId: 0, parentDocumentId: DOC,
      frameType: 'sub_frame', documentId: DOC2, url: 'https://example.com/child' }));
    await expect.poll(() => state.bg.runtime.getProjection(7, 2)?.techniques.find(t => t.techniqueId === 'DET-060')?.count).toBe(1);
    expect(techniqueCounts(await session(state.bg.runtime))['DET-060'] ?? 0).toBe(0);
    expect((await session(state.bg.runtime)).pages.flatMap(page => page.reports).every(report => report.requestedLocalPorts === undefined)).toBe(true);
    for (const port of [8002, 8003, 8004]) {
      state.clock.t += 1;
      state.bg.network.onBeforeRequest({ ...pending, requestId: 'post-' + port, url: 'ws://127.0.0.1:' + port + '/' });
    }
    const current = await session(state.bg.runtime);
    expect(techniqueCounts(current)['DET-060']).toBe(3);
    expect(current.pages[0]!.reports.flatMap(r => r.techniques).find(t => t.techniqueId === 'DET-060')?.interpretation).toBe('api-use');
    expect(current.pages[0]!.reports.find(report => report.documentKey === '7:2:' + DOC2)?.requestedLocalPorts)
      .toEqual({ ports: [8002, 8003, 8004], truncated: false });
  });

  const vendorNow = Date.parse('2026-09-13T12:00:00Z');
  const vendorUrl = 'https://h.online-metrix.net/fp/tags.js?org_id=PRO_ORG_CANARY&session_id=PRO_SESSION_CANARY';
  const rtcSnapshot = (revision: number, connections = 1): RtcSnapshot => ({ revision, total: connections, omitted: 0, captureLimited: false,
    connections: Array.from({ length: connections }, (_, index) => ({ id: index + 1, created: true, closed: true, connected: false,
      state: 'closed', duration: 'under-1s', configurationChanges: 0, truncated: false,
      servers: [{ scheme: 'turn', host: 'aa.online-metrix.net', port: 3478, transport: 'udp', configured: true, candidate: false, error: true }] })) });
  async function rtcReady(runtime: BackgroundRuntime): Promise<string> {
    const result = await route(runtime, { schemaVersion: 1, type: 'rtc-ready' }, pageSender());
    if (result.type !== 'rtc-control' || !result.token) throw new Error('No RTC token');
    return result.token;
  }
  async function rtcDeliver(runtime: BackgroundRuntime, token: string, revision: number, connections = 1) {
    expect(await route(runtime, { schemaVersion: 1, type: 'rtc-snapshot', token, snapshot: rtcSnapshot(revision, connections) }, pageSender())).toMatchObject({ accepted: true });
  }

  it('ADR-024: Pro includes new RTC occurrences after Start while excluding pre-Start history and duplicate revisions', async () => {
    const { bg, clock, fake } = await fixture(vendorNow);
    const token = await rtcReady(bg.runtime);
    await rtcDeliver(bg.runtime, token, 1);
    expect(bg.runtime.getProjection(7)?.vendors).toHaveLength(1);
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    clock.t += 1000;
    await rtcDeliver(bg.runtime, token, 2);
    expect((await session(bg.runtime)).pages[0]!.reports.flatMap(r => r.vendors)).toEqual([]);
    clock.t += 1000;
    await rtcDeliver(bg.runtime, token, 3, 2);
    const result = await session(bg.runtime);
    expect(result.pages[0]!.reports[0]?.vendors).toEqual([{ vendorId: 'threatmetrix', ruleIds: ['threatmetrix-aa-turn-v1'],
      vendorConfidence: 'weak-signal', evidenceSource: 'page-hook', integrity: 'page-controlled' }]);
    expect(result.pages[0]!.reports[0]?.observedSince).toBe(clock.t);
    await bg.runtime.pro.flush();
    expect(JSON.stringify(fake.session.data.get(PRO_STORAGE_KEY))).not.toMatch(/aa\.online-metrix|3478|under-1s|configured|candidate/);
    const stopped = await command(bg.runtime, { type: 'ui-pro-stop', sessionId: result.id });
    clock.t += 1000;
    await rtcDeliver(bg.runtime, token, 4, 3);
    expect((await session(bg.runtime)).pages).toEqual(stopped.session!.pages);
  });

  it('ADR-024: captured Pro identity survives Light clear and RTC expiry, and HTTP upgrades without copying weak rule IDs', async () => {
    const { bg, clock } = await fixture(vendorNow);
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    const token = await rtcReady(bg.runtime);
    await rtcDeliver(bg.runtime, token, 1);
    expect((await session(bg.runtime)).pages[0]!.reports[0]?.vendors[0]?.vendorConfidence).toBe('weak-signal');
    const req = request({ url: vendorUrl });
    bg.runtime.pro.onRequest(req, 'before'); bg.network.onCompleted({ ...req, statusCode: 200 });
    bg.runtime.pro.onRequest({ ...req, statusCode: 200 }, 'completed');
    const expected = [{ vendorId: 'threatmetrix', ruleIds: ['threatmetrix-h-loader-v1'],
      vendorConfidence: 'documented-resource', evidenceSource: 'browser-network', integrity: 'browser-observed' }];
    expect((await session(bg.runtime)).pages[0]!.reports[0]?.vendors).toEqual(expected);
    await clearLight(bg.runtime);
    expect(bg.runtime.getProjection(7)).toBeNull();
    expect((await session(bg.runtime)).pages[0]!.reports[0]?.vendors).toEqual(expected);
    clock.t += PRO_LIMITS.durationMs;
    expect((await session(bg.runtime)).pages[0]!.reports[0]?.vendors).toEqual(expected);
  });

  it('ADR-009: completed vendor resources before commit retain exact top/child identity and redacted evidence', async () => {
    const { bg, fake, navigate, clock } = await fixture(vendorNow);
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    const early = request({ documentId: DOC2, url: vendorUrl });
    bg.runtime.pro.onRequest(early, 'before');
    bg.runtime.pro.onRequest({ ...early, statusCode: 200 }, 'completed');
    await bg.runtime.pro.flush();
    const saved = JSON.stringify(fake.session.data.get(PRO_STORAGE_KEY));
    expect(saved).toContain('threatmetrix-h-loader-v1');
    expect(saved).not.toMatch(/PRO_ORG_CANARY|PRO_SESSION_CANARY|org_id|session_id/);
    navigate('https://example.com/register');
    let page = (await session(bg.runtime)).pages[1]!;
    expect(page.resources[0]?.completedCount).toBe(1);
    expect(page.reports.find(r => r.documentKey === `7:0:${DOC2}`)?.vendors.map(v => v.vendorId)).toEqual(['threatmetrix']);
    expect(page.reports[0]?.observedSince).toBe(clock.t);
    const childId = 'CHILD0000000000000000000000000001';
    const child = request({ requestId: 'child-vendor', frameId: 3, documentId: childId, url: 'https://js.hcaptcha.com/1/api.js' });
    bg.runtime.pro.onRequest(child, 'before');
    bg.runtime.pro.onRequest({ ...child, statusCode: 304 }, 'completed');
    bg.navigation.onCommitted(committed({ frameId: 3, documentId: childId, parentFrameId: 0,
      parentDocumentId: DOC2, frameType: 'sub_frame', url: 'https://third.com/' }));
    page = (await session(bg.runtime)).pages[1]!;
    expect(page.reports.find(r => r.documentKey === `7:3:${childId}`)?.vendors.map(v => v.vendorId)).toEqual(['hcaptcha']);
    expect(page.reports.find(r => r.documentKey === `7:0:${DOC2}`)?.vendors.map(v => v.vendorId)).toEqual(['threatmetrix']);
  });

  it('ADR-009: vendor-only Pro reports are created without a page-hook and survive later snapshot updates', async () => {
    const { bg, clock } = await fixture(vendorNow);
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    const req = request({ url: vendorUrl });
    bg.runtime.pro.onRequest(req, 'before');
    bg.runtime.pro.onRequest({ ...req, statusCode: 200 }, 'completed');
    let report = (await session(bg.runtime)).pages[0]!.reports[0]!;
    expect(report.vendors.map(v => v.vendorId)).toEqual(['threatmetrix']);
    expect(report.techniques).toEqual([]);
    expect(report.observedSince).toBe(clock.t);
    bg.navigation.onHistoryStateUpdated(committed({ url: 'https://example.com/' }));
    expect((await session(bg.runtime)).pages[0]!.reports[0]!.vendors).toEqual(report.vendors);
    bg.network.onCompleted({ ...req, statusCode: 200 });
    report = (await session(bg.runtime)).pages[1]!.reports[0]!;
    expect(report.vendors.map(v => v.vendorId)).toEqual(['threatmetrix']);
  });

  it.each([{ documentId: undefined }, { documentId: 'UNBOUND_DOCUMENT' }])(
    'ADR-009: unresolved request document %j never falls back to a parent vendor report', async over => {
      const { bg } = await fixture(vendorNow);
      await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
      await observe(bg.runtime, 1, 1);
      const req = request({ url: vendorUrl, ...over });
      bg.runtime.pro.onRequest(req, 'before');
      bg.runtime.pro.onRequest({ ...req, statusCode: 200 }, 'completed');
      expect((await session(bg.runtime)).pages[0]!.reports.flatMap(r => r.vendors)).toEqual([]);
    });

  it('ADR-009: a completion attributed to a different document cannot redirect vendor evidence', async () => {
    const { bg } = await fixture(vendorNow);
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    const req = request({ url: vendorUrl });
    bg.runtime.pro.onRequest(req, 'before');
    bg.runtime.pro.onRequest({ ...req, documentId: DOC2, statusCode: 200 }, 'completed');
    expect((await session(bg.runtime)).pages[0]!.reports.flatMap(r => r.vendors)).toEqual([]);
  });

  it.each([404, 500, 302])('ADR-009: unsuccessful status %i never records a Pro vendor', async statusCode => {
    const { bg } = await fixture(vendorNow);
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    const req = request({ url: vendorUrl });
    bg.runtime.pro.onRequest(req, 'before');
    bg.runtime.pro.onRequest({ ...req, statusCode }, 'completed');
    expect((await session(bg.runtime)).pages[0]!.reports.flatMap(r => r.vendors)).toEqual([]);
  });

  it('ADR-009: pause cannot be bypassed by the separate Pro resource callback', async () => {
    const { bg } = await fixture(vendorNow);
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    const light = bg.runtime.getProjection(7)!;
    await bg.runtime.pause(7, light.documentKey, light.reportRevision);
    const req = request({ url: vendorUrl });
    bg.runtime.pro.onRequest(req, 'before');
    bg.runtime.pro.onRequest({ ...req, statusCode: 200 }, 'completed');
    expect((await session(bg.runtime)).pages[0]!.reports.flatMap(r => r.vendors)).toEqual([]);
  });

  it('requires an extension UI sender and is idle until an explicit Start', async () => {
    const { bg } = await fixture();
    expect((await command(bg.runtime, { type: 'ui-pro-get', tabId: 7 })).canStart).toBe(true);
    bg.runtime.pro.onRequest(request(), 'before');
    expect((await command(bg.runtime, { type: 'ui-pro-get' })).session).toBeNull();
    const rejected = await route(bg.runtime, { schemaVersion: 1, type: 'ui-pro-start', tabId: 7 }, pageSender());
    expect(rejected).toMatchObject({ type: 'error', code: 'unauthorized-sender' });
  });

  it('excludes pre-Start totals, captures document/SPA deltas and keeps frozen earlier visits', async () => {
    const { bg, navigate } = await fixture();
    await observe(bg.runtime, 4, 1);
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    await observe(bg.runtime, 7, 2);
    expect((await session(bg.runtime)).pages[0]!.reports[0]!.techniques[0]!.count).toBe(3);
    navigate('https://example.com/catalog', DOC, 7, true);
    await observe(bg.runtime, 9, 3);
    const second = await session(bg.runtime);
    expect(second.pages.map(p => p.reports[0]?.techniques[0]?.count)).toEqual([3, 2]);
    navigate('https://example.com/register', DOC2);
    await observe(bg.runtime, 2, 1, DOC2);
    const third = await session(bg.runtime);
    expect(third.pages.map(p => p.url)).toEqual(['https://example.com/', 'https://example.com/catalog', 'https://example.com/register']);
    expect(third.pages.map(p => p.reports[0]?.techniques[0]?.count)).toEqual([3, 2, 2]);
    await command(bg.runtime, { type: 'ui-pro-stop', sessionId: third.id });
    await observe(bg.runtime, 20, 2, DOC2);
    expect((await session(bg.runtime)).pages[2]!.reports[0]!.techniques[0]!.count).toBe(2);
  });

  it('marks the initial receipt boundary when a buffered first batch arrives only after Start', async () => {
    const { bg } = await fixture();
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    // MAIN buckets have no wall-clock mapping: an ISO-buffered batch cannot reveal when its calls ran.
    await observe(bg.runtime, 3, 1);
    const result = await session(bg.runtime);
    expect(result.limitations).toContain('started-mid-page');
    expect(result.pages[0]!.reports[0]!.techniques[0]!.count).toBe(3);
    expect(result.pages[0]!.reports[0]!.observedSince).toBeGreaterThanOrEqual(result.startedAt);
  });

  it('captures third-party 0ms completion, failures and redirects without URL secrets', async () => {
    const { bg } = await fixture();
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    bg.runtime.pro.onRequest(request(), 'before');
    bg.runtime.pro.onRequest(request({ statusCode: 200 }), 'completed');
    bg.runtime.pro.onRequest(request({ requestId: '2', url: 'https://other.com/api/user/12345?email=person@example.com', type: 'xmlhttprequest' }), 'before');
    bg.runtime.pro.onRequest(request({ requestId: '2', url: 'https://other.com/api/user/12345?email=person@example.com', type: 'xmlhttprequest', error: 'net::ERR_FAILED secret' }), 'error');
    bg.runtime.pro.onRequest(request({ requestId: '3' }), 'before');
    bg.runtime.pro.onRequest(request({ requestId: '3', statusCode: 302, redirectUrl: 'https://other.com/main.js?SECRET' }), 'redirect');
    const result = await session(bg.runtime);
    expect(result.pages[0]!.resources).toHaveLength(2);
    expect(result.pages[0]!.resources[0]).toMatchObject({ domain: 'other.com', relation: 'cross-site', requestCount: 2, completedCount: 1, redirectCount: 1, durationTotalMs: 0 });
    expect(result.pages[0]!.resources[1]).toMatchObject({ url: 'https://other.com/api/user/:segment', failedCount: 1 });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|PRIVATE|person@|12345|ERR_FAILED/);
  });

  it('holds early completed top/iframe resources until browser ancestry resolves', async () => {
    const { bg, navigate } = await fixture();
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    const early = request({ documentId: DOC2 });
    bg.runtime.pro.onRequest(early, 'before'); bg.runtime.pro.onRequest({ ...early, statusCode: 200 }, 'completed');
    expect((await session(bg.runtime)).pages[0]!.resources).toHaveLength(0);
    navigate('https://example.com/register');
    expect((await session(bg.runtime)).pages[1]!.resources[0]?.completedCount).toBe(1);
    const child = 'CHILD0000000000000000000000000001';
    const sub = request({ requestId: 'child', documentId: child, frameId: 3, url: 'https://third.com/main.js' });
    bg.runtime.pro.onRequest(sub, 'before'); bg.runtime.pro.onRequest({ ...sub, statusCode: 200 }, 'completed');
    bg.navigation.onCommitted(committed({ frameId: 3, parentFrameId: 0, parentDocumentId: DOC2, documentId: child, frameType: 'sub_frame', url: 'https://third.com/' }));
    expect((await session(bg.runtime)).pages[1]!.resources.find(r => r.domain === 'third.com')?.completedCount).toBe(1);
  });

  it('records outside-target local/IP probes as categories and deduplicates repeated browser starts', async () => {
    const { bg } = await fixture();
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    const req = request({ url: 'http://127.0.0.42:8080/test?CANARY' });
    bg.runtime.pro.onRequest(req, 'before'); bg.runtime.pro.onRequest(req, 'before'); bg.runtime.pro.onRequest({ ...req, statusCode: 200 }, 'completed');
    const result = await session(bg.runtime);
    expect(result.pages[0]!.resources[0]).toMatchObject({ url: 'http://loopback.invalid:8080/test', domain: 'loopback.invalid', relation: 'unknown', requestCount: 1, completedCount: 1 });
    expect(JSON.stringify(result)).not.toMatch(/127\.0\.0\.42|CANARY/);
    expect(safeProResourceUrl(safeProUrl('http://127.0.0.1:8073/catalog')!, '127.0.0.1').url).toBe('http://127.0.0.1:8073/catalog');
  });

  it('re-derives interpretation only from post-Start counter evidence', async () => {
    const { bg } = await fixture();
    const sender = readPageSender(pageSender(), bg.runtime.api.runtime.id); if (!sender.ok) throw new Error('sender');
    const evidence = (readouts: number, seq: number): PageBatch => ({ schemaVersion: 1, type: 'sensor-events', sensorBootId: 'boot-pattern', bridgeSessionId: 'bridge-pattern', batchSeq: seq, coverageDelta: [], observations: [
      { techniqueId: 'DET-003', count: 4, countQuality: 'exact', phase: 'returned-sync', signalCodes: ['api-use', 'text-drawn'], intervalBucket: seq },
      { techniqueId: 'DET-001', count: readouts, countQuality: 'exact', phase: 'returned-sync', signalCodes: ['api-use', 'export-after-text'], intervalBucket: seq },
    ] });
    await bg.runtime.handleBatch(sender.context, evidence(8, 1), true);
    expect(bg.runtime.getProjection(7)?.findings.some(f => f.interpretation === 'possible-fingerprinting')).toBe(true);
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    await bg.runtime.handleBatch(sender.context, evidence(9, 2), true);
    const reports = (await session(bg.runtime)).pages[0]!.reports;
    expect(reports.flatMap(r => r.techniques).map(t => [t.techniqueId, t.count, t.interpretation])).toEqual([['DET-001', 1, 'api-use']]);
    expect(reports.flatMap(r => r.findings).every(f => f.interpretation === 'api-use')).toBe(true);
  });

  it('keeps separate SPA visits when identifier redaction maps their URLs to the same template', async () => {
    const { bg, navigate } = await fixture();
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    navigate('https://example.com/user/123', DOC, 7, true);
    navigate('https://example.com/user/456', DOC, 7, true);
    expect((await session(bg.runtime)).pages.map(p => p.url)).toEqual(['https://example.com/', 'https://example.com/user/:segment', 'https://example.com/user/:segment']);
  });

  it('attributes navigation requests to the committed visit and includes bound iframe detectors', async () => {
    const { bg, navigate } = await fixture();
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    const main = request({ requestId: 'main', type: 'main_frame', documentId: undefined, url: 'https://example.com/register' });
    bg.runtime.pro.onRequest(main, 'before');
    navigate('https://example.com/register');
    bg.runtime.pro.onRequest({ ...main, statusCode: 200 }, 'completed');
    const child = 'CHILD0000000000000000000000000001';
    bg.navigation.onCommitted(committed({ frameId: 2, parentFrameId: 0, parentDocumentId: DOC2, documentId: child, frameType: 'sub_frame', url: 'https://example.com/frame' }));
    await observe(bg.runtime, 2, 1, child, 7, 2);
    const result = await session(bg.runtime);
    expect(result.pages[0]!.resources).toHaveLength(0);
    expect(result.pages[1]!.resources[0]).toMatchObject({ type: 'main_frame', completedCount: 1 });
    expect(result.pages[1]!.reports.find(r => r.documentKey === '7:2:' + child)?.techniques[0]?.count).toBe(2);
  });

  it('suspends on another site, follows only opener-related same-site tabs and resumes on return', async () => {
    const { bg, fake, navigate } = await fixture();
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    bg.runtime.pro.onTabCreated({ id: 8, openerTabId: 7 });
    fake.tabList.push({ id: 8 });
    navigate('https://shop.example.com/catalog', DOC2, 8);
    await observe(bg.runtime, 3, 1, DOC2, 8);
    navigate('https://unrelated.com/', DOC2);
    bg.runtime.pro.onRequest(request({ documentId: DOC2 }), 'before');
    bg.runtime.pro.onRequest(request({ documentId: DOC2, statusCode: 200 }), 'completed');
    navigate('https://example.com/register', 'RETURN00000000000000000000000001');
    const result = await session(bg.runtime);
    expect(result.pages.map(p => p.tabId)).toEqual([7, 8, 7]);
    expect(result.pages.every(p => !p.url.includes('unrelated'))).toBe(true);
    expect(result.pages.flatMap(p => p.resources)).toHaveLength(0);
  });

  it('stops at the exact deadline even when the alarm is delayed and rejects later events', async () => {
    const { bg, clock, alarms } = await fixture();
    const started = (await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 })).session!;
    expect(alarms.get(PRO_ALARM_NAME)).toBe(started.deadlineAt);
    clock.t += PRO_LIMITS.durationMs + 42000;
    bg.runtime.pro.onRequest(request(), 'before');
    bg.runtime.pro.onAlarm(PRO_ALARM_NAME);
    const stopped = await session(bg.runtime);
    expect(stopped).toMatchObject({ status: 'stopped', stopReason: 'timeout', stoppedAt: started.deadlineAt });
    expect(stopped.pages[0]!.endedAt).toBe(started.deadlineAt);
    expect(stopped.pages[0]!.resources).toHaveLength(0);
  });

  it('persists active recording, baselines and in-flight requests across worker restart', async () => {
    const { bg, fake, clock } = await fixture();
    await observe(bg.runtime, 5, 1);
    const start = (await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 })).session!;
    await observe(bg.runtime, 8, 2);
    bg.runtime.pro.onRequest(request(), 'before');
    await bg.runtime.pro.flush();
    bg.runtime.stop();
    const restored = createBackground(fake, { clock, ttlIntervalMs: 0 }); active.push(restored.runtime);
    await restored.start();
    restored.runtime.pro.onRequest(request({ statusCode: 200 }), 'completed');
    await observe(restored.runtime, 9, 3);
    const result = await session(restored.runtime);
    expect(result.id).toBe(start.id);
    expect(result.limitations).toContain('service-worker-restarted');
    expect(result.pages[0]!.reports[0]!.techniques[0]!.count).toBe(4);
    expect(result.pages[0]!.resources[0]!.completedCount).toBe(1);
  });

  it('preserves Pro boot maxima and missing counter keys while Light starts a fresh report', async () => {
    const { bg } = await fixture();
    await observeBoot(bg.runtime, 'boot-A', 1, [['DET-001', 5], ['DET-032', 2]]);
    await observeBoot(bg.runtime, 'boot-B', 1, [['DET-001', 2]]);
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    await observeBoot(bg.runtime, 'boot-A', 2, [['DET-001', 5], ['DET-032', 3]]);
    await observeBoot(bg.runtime, 'boot-B', 2, [['DET-001', 3]]);
    expect(techniqueCounts(await session(bg.runtime))).toEqual({ 'DET-001': 1, 'DET-032': 1 });
    await clearLight(bg.runtime);
    expect(bg.runtime.getProjection(7)).toBeNull();
    await observeBoot(bg.runtime, 'boot-B', 3, [['DET-001', 4]]);
    expect(bg.runtime.getProjection(7)?.techniques.map(item => [item.techniqueId, item.count])).toEqual([['DET-001', 4]]);
    expect(techniqueCounts(await session(bg.runtime))).toEqual({ 'DET-001': 2, 'DET-032': 1 });
    await observeBoot(bg.runtime, 'boot-B', 4, [['DET-001', 4]]);
    await clearLight(bg.runtime);
    await observeBoot(bg.runtime, 'boot-A', 3, [['DET-001', 6], ['DET-032', 3]]);
    expect(techniqueCounts(await session(bg.runtime))).toEqual({ 'DET-001': 3, 'DET-032': 1 });
  });

  it('persists continuity before Light removal and resumes after an immediate worker restart', async () => {
    const { bg, fake, clock } = await fixture();
    await observeBoot(bg.runtime, 'boot-A', 1, [['DET-001', 5], ['DET-032', 2]]);
    await observeBoot(bg.runtime, 'boot-B', 1, [['DET-001', 2]]);
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    await observeBoot(bg.runtime, 'boot-A', 2, [['DET-032', 3]]);
    await observeBoot(bg.runtime, 'boot-B', 2, [['DET-001', 3]]);
    await clearLight(bg.runtime);
    expect(fake.session.data.get(PRO_STORAGE_KEY)).toHaveProperty('counterHistory');
    bg.runtime.stop();
    const restored = createBackground(fake, { clock, ttlIntervalMs: 0 }); active.push(restored.runtime); await restored.start();
    await observeBoot(restored.runtime, 'boot-B', 3, [['DET-001', 4]]);
    expect(techniqueCounts(await session(restored.runtime))).toEqual({ 'DET-001': 2, 'DET-032': 1 });
    await observeBoot(restored.runtime, 'boot-A', 3, [['DET-001', 6]]);
    expect(techniqueCounts(await session(restored.runtime))).toEqual({ 'DET-001': 3, 'DET-032': 1 });
    expect(await session(restored.runtime)).not.toHaveProperty('counterHistory');
    await restored.runtime.pro.flush();
    expect(new TextEncoder().encode(JSON.stringify(fake.session.data.get(PRO_STORAGE_KEY))).byteLength).toBeLessThan(PRO_LIMITS.maxBytes);
  });

  it.each([false, true])('starts an SPA visit from retained totals after clear (intermediate batch=%s)', async intermediate => {
    const { bg, navigate } = await fixture();
    await observeBoot(bg.runtime, 'boot-A', 1, [['DET-001', 5]]);
    await observeBoot(bg.runtime, 'boot-B', 1, [['DET-001', 2]]);
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    await observeBoot(bg.runtime, 'boot-B', 2, [['DET-001', 3]]);
    await clearLight(bg.runtime);
    if (intermediate) await observeBoot(bg.runtime, 'boot-B', 3, [['DET-001', 4]]);
    navigate('https://example.com/catalog', DOC, 7, true);
    await observeBoot(bg.runtime, 'boot-A', 2, [['DET-001', 5]]);
    expect(techniqueCounts(await session(bg.runtime), 1)).toEqual({});
    await observeBoot(bg.runtime, 'boot-A', 3, [['DET-001', 6]]);
    const result = await session(bg.runtime);
    expect(result.pages.map((_, index) => techniqueCounts(result, index))).toEqual([{ 'DET-001': intermediate ? 2 : 1 }, { 'DET-001': 1 }]);
  });

  it('fails closed on malformed continuity metadata and keeps it out of the stopped report', async () => {
    const { bg, fake, clock } = await fixture();
    await observe(bg.runtime, 5, 1);
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    await clearLight(bg.runtime);
    bg.runtime.stop();
    const saved = structuredClone(fake.session.data.get(PRO_STORAGE_KEY)) as { counterHistory: Array<Record<string, unknown>> };
    saved.counterHistory[0]!['pixels'] = 'CANARY_NOT_A_COUNTER';
    fake.session.data.set(PRO_STORAGE_KEY, saved);
    const restored = createBackground(fake, { clock, ttlIntervalMs: 0 }); active.push(restored.runtime); await restored.start();
    const result = await session(restored.runtime);
    expect(result.status).toBe('stopped'); expect(result.stopReason).toBe('storage-error');
    expect(result.limitations).toContain('storage-error');
    expect(JSON.stringify(fake.session.data.get(PRO_STORAGE_KEY))).not.toContain('CANARY_NOT_A_COUNTER');
  });

  it('retains lower-bound uncertainty after a Light report with dropped counters is cleared', async () => {
    const { bg } = await fixture();
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    await observe(bg.runtime, 5, 1);
    const key = bg.runtime.getProjection(7)!.documentKey;
    const report = bg.runtime.state.reports.get(key)!;
    // Counter admission overflow weakens the report even when each retained entry was exact.
    report.dropped.counters = 1;
    expect(bg.runtime.getProjection(7)!.techniques[0]!.countQuality).toBe('lower-bound');
    await clearLight(bg.runtime);
    await observe(bg.runtime, 6, 2);
    expect(bg.runtime.getProjection(7)!.techniques[0]!.countQuality).toBe('exact');
    const result = await session(bg.runtime);
    expect(result.pages[0]!.reports[0]!.techniques[0]).toMatchObject({ count: 6, countQuality: 'lower-bound' });
    expect(result.limitations).toContain('event-limit');
  });

  it('bounds retained boot identities and reports a lower bound instead of double-counting new boots', async () => {
    const { bg, fake } = await fixture();
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    for (const boot of ['A', 'B', 'C', 'D']) await observeBoot(bg.runtime, boot, 1, [['DET-001', 1]]);
    await clearLight(bg.runtime);
    await observeBoot(bg.runtime, 'E', 1, [['DET-001', 100]]);
    const result = await session(bg.runtime);
    expect(result.pages[0]!.reports[0]!.techniques[0]).toMatchObject({ count: 4, countQuality: 'lower-bound' });
    expect(result.limitations).toContain('event-limit');
    await bg.runtime.pro.flush();
    const saved = fake.session.data.get(PRO_STORAGE_KEY) as { counterHistory: Array<{ boots: unknown[] }> };
    expect(saved.counterHistory[0]!.boots).toHaveLength(4);
  });

  it('clears an active Pro recording, alarm and checkpoints without clearing Light, then starts cleanly', async () => {
    const { bg, fake, alarms } = await fixture();
    await observe(bg.runtime, 5, 1);
    const first = (await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 })).session!;
    await clearLight(bg.runtime);
    await observe(bg.runtime, 6, 2);
    const light = structuredClone(bg.runtime.getProjection(7));
    expect((await command(bg.runtime, { type: 'ui-pro-clear', sessionId: first.id })).session).toBeNull();
    expect(fake.session.data.has(PRO_STORAGE_KEY)).toBe(false);
    expect(alarms.has(PRO_ALARM_NAME)).toBe(false);
    expect(bg.runtime.getProjection(7)).toEqual(light);
    const next = (await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 })).session!;
    expect(next.id).not.toBe(first.id);
    expect(await route(bg.runtime, { schemaVersion: 1, type: 'ui-pro-clear', sessionId: first.id }, uiSender())).toMatchObject({ type: 'error', code: 'stale-revision' });
    await observe(bg.runtime, 7, 3);
    expect(techniqueCounts(await session(bg.runtime))).toEqual({ 'DET-001': 1 });
  });

  it('stops on lost access, allows a new stopped-session replacement and clears session storage', async () => {
    const { bg, fake } = await fixture();
    const first = (await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 })).session!;
    await command(bg.runtime, { type: 'ui-pro-stop', sessionId: first.id });
    const next = (await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 })).session!;
    expect(next.id).not.toBe(first.id);
    fake.grantedOrigins.clear();
    await bg.runtime.onPermissionsChanged();
    expect((await session(bg.runtime)).stopReason).toBe('access-revoked');
    await command(bg.runtime, { type: 'ui-pro-clear', sessionId: next.id });
    expect(fake.session.data.has(PRO_STORAGE_KEY)).toBe(false);
  });

  it('reports bounded storage failure instead of falsely continuing a recording', async () => {
    const { bg, fake } = await fixture();
    fake.session.failNextSets = 2;
    const result = (await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 })).session!;
    expect(result.status).toBe('stopped');
    expect(result.stopReason).toBe('storage-error');
    expect(result.limitations).toContain('storage-error');
  });

  it('caps visited pages and rejects stale stop/clear controls', async () => {
    const { bg, navigate } = await fixture();
    const start = (await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 })).session!;
    for (let i = 0; i < PRO_LIMITS.maxPages; i++) navigate('https://example.com/catalog', 'PAGE' + i);
    const result = await session(bg.runtime);
    expect(result.pages).toHaveLength(PRO_LIMITS.maxPages); expect(result.stopReason).toBe('limit'); expect(result.dropped.pages).toBe(1);
    const stale = await route(bg.runtime, { schemaVersion: 1, type: 'ui-pro-clear', sessionId: 'old-session' }, uiSender());
    expect(stale).toMatchObject({ type: 'error', code: 'stale-revision' });
    expect((await session(bg.runtime)).id).toBe(start.id);
  });

  it('bounds a busy session before snapshot persistence without losing its explicit limitation', async () => {
    const { bg, navigate, fake } = await fixture();
    await command(bg.runtime, { type: 'ui-pro-start', tabId: 7 });
    for (let page = 0; page < 8; page++) {
      navigate('https://example.com/catalog', 'LOAD' + page);
      for (let i = 0; i < 500; i++) {
        const req = request({ requestId: page + '-' + i, documentId: 'LOAD' + page, url: 'https://resource' + i + '.com/main.js' });
        bg.runtime.pro.onRequest(req, 'before'); bg.runtime.pro.onRequest({ ...req, statusCode: 200 }, 'completed');
      }
    }
    await bg.runtime.pro.flush();
    const result = await session(bg.runtime);
    expect(result.status).toBe('stopped'); expect(result.stopReason).toBe('limit'); expect(result.limitations).toContain('resource-limit');
    expect(new TextEncoder().encode(JSON.stringify(fake.session.data.get(PRO_STORAGE_KEY))).byteLength).toBeLessThan(PRO_LIMITS.maxBytes);
    expect(result.pages.flatMap(p => p.resources).length).toBeLessThan(PRO_LIMITS.maxResources);
  });
});

describe('Pro display redaction', () => {
  it('keeps only finite path templates and normalizes domain and strips credentials/query/hash', () => {
    expect(safeProUrl('https://user:pass@randomlabel.example.com:8443/account/JohnDoe/12345/app.123456.js?password=secret#hidden')?.url)
      .toBe('https://example.com:8443/account/:segment/:segment/:resource.js');
    expect(safeProUrl('data:text/html,secret')).toBeNull();
    expect(safeProTitle('A person@example.com https://example.com/?token=secret 123456789')).toBe('A [email] [URL] [id]');
  });
});
