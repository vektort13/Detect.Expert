import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_COUNT } from '@detect-expert/contracts';
import { createBackground, readStoredDocument, requestScopeAccess, route } from '../src/index';
import type { Background, RequestDetailsLike } from '../src/index';
import { incrementNetworkCounters, readNetworkCounters } from '../src/network-counters';
import { committed, createFakeChrome, pageSender, settle } from './fake-chrome';

const D1 = 'DOC000000000000000000000000000001', D2 = 'DOC000000000000000000000000000002';
const KEY = '7:0:' + D1;
const ORIGINS = ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'];
const running: Background[] = [];
afterEach(() => { for (const bg of running.splice(0)) bg.runtime.stop(); vi.useRealTimers(); });
function cold(origins = ORIGINS, mode: 'all-sites' | 'site' | 'off' = 'all-sites') {
  const fake = createFakeChrome({ grantedOrigins: origins });
  fake.local.data.set('scope', { v: 1, scopeMode: mode, hosts: ['example.com'] });
  fake.tabList = [{ id: 7 }]; fake.framesByTab.set(7, [committed()]);
  const clock = { t: 100000, now() { return this.t; } };
  const bg = createBackground(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 }); running.push(bg);
  return { bg, fake, clock };
}
async function setup(origins = ORIGINS, mode: 'all-sites' | 'site' | 'off' = 'all-sites') { const state = cold(origins, mode); await state.bg.start(); return state; }
function request(id: string, port = 61001, over: Partial<RequestDetailsLike> = {}): RequestDetailsLike {
  return { tabId: 7, frameId: 0, documentId: D1, requestId: id, type: 'websocket',
    url: 'ws://127.0.0.1:' + port + '/CANARY_PATH?CANARY_QUERY#CANARY_FRAGMENT', initiator: 'https://example.com', timeStamp: 999999999, ...over };
}
function local(bg: Background, frame?: number) { return bg.runtime.getProjection(7, frame)?.techniques.find(t => t.techniqueId === 'DET-060'); }
function dns(bg: Background, frame?: number) { return bg.runtime.getProjection(7, frame)?.techniques.find(entry => entry.techniqueId === 'DET-061'); }
function dnsRequest(index: number, over: Partial<RequestDetailsLike> = {}) {
  return request('dns-' + index, 1, { type: 'xmlhttprequest', url: 'https://a1b2c3d' + index + '.dns.example.net/CANARY?CANARY', ...over });
}
async function hashesDrained(bg: Background) {
  await vi.waitFor(() => expect((bg.runtime.networkAttempts as unknown as { hashing: Set<unknown> }).hashing.size).toBe(0));
}

describe('ADR-025 native request-attempt admission', () => {
  it('ADR-031 keeps a sorted requested port list through storage/restart and clears it with the document', async () => {
    const { bg, fake, clock } = await setup();
    for (const [index, port] of [3389, 80, 65535, 443, 3389].entries()) bg.network.onBeforeRequest(request('ports-' + index, port));
    bg.network.onBeforeRequest(request('ports-0', 3389));
    expect(bg.runtime.getProjection(7)?.requestedLocalPorts).toEqual({ ports: [80, 443, 3389, 65535], truncated: false });
    expect(local(bg)?.count).toBe(5);
    expect(await bg.runtime.persistNow(KEY)).toBe(true);
    await bg.runtime.flushIndex();
    const stored = readStoredDocument('doc:' + KEY, fake.session.data.get('doc:' + KEY));
    expect(stored?.meta.requestedLocalPorts).toEqual({ ports: [80, 443, 3389, 65535], truncated: false });
    expect(JSON.stringify(stored)).not.toMatch(/CANARY|127\.0\.0\.1|ws:\/\//);
    bg.runtime.stop();
    const restored = createBackground(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 }); running.push(restored);
    await restored.start();
    expect(restored.runtime.getProjection(7)?.requestedLocalPorts).toEqual(stored?.meta.requestedLocalPorts);
    await restored.runtime.clear(7, KEY, restored.runtime.getProjection(7)!.reportRevision);
    expect(restored.runtime.getProjection(7)?.requestedLocalPorts).toBeUndefined();
  });

  it('ADR-031 preserves loss before the first local port and bounds the retained list independently of classifier windows', async () => {
    const { bg, clock } = await setup();
    bg.runtime.dispatch({ type: 'network:limited', documentKey: KEY, at: clock.t });
    bg.network.onBeforeRequest(request('first-after-gap', 443));
    expect(bg.runtime.getProjection(7)?.requestedLocalPorts).toEqual({ ports: [443], truncated: true });
    await bg.runtime.clear(7, KEY, bg.runtime.getProjection(7)!.reportRevision);
    for (let index = 0; index < 129; index++) {
      clock.t += 10001;
      bg.network.onBeforeRequest(request('bounded-' + index, 20000 + index));
    }
    expect(bg.runtime.getProjection(7)?.requestedLocalPorts).toEqual({ ports: Array.from({ length: 128 }, (_, index) => 20000 + index), truncated: true });
    expect(local(bg)?.count).toBe(129);
  });

  it('ADR-031 records protocol defaults and explicit zero, never public targets or forged page port lists', async () => {
    const { bg } = await setup();
    for (const [index, url] of ['ws://127.0.0.1/', 'wss://127.0.0.1/', 'http://127.0.0.1:0/'].entries()) {
      bg.network.onBeforeRequest(request('defaults-' + index, 1, { url, type: url.startsWith('http:') ? 'xmlhttprequest' : 'websocket' }));
    }
    bg.network.onBeforeRequest(request('public-number', 1, { url: 'wss://public.example:65535/' }));
    const expected = { ports: [0, 80, 443], truncated: false };
    expect(bg.runtime.getProjection(7)?.requestedLocalPorts).toEqual(expected);
    await route(bg.runtime, { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'FORGED_BOOT', bridgeSessionId: 'FORGED_BRIDGE',
      batchSeq: 1, observations: [], coverageDelta: ['hook-failed'], requestedLocalPorts: { ports: [3389], truncated: false } }, pageSender());
    expect(bg.runtime.getProjection(7)?.requestedLocalPorts).toEqual(expected);
  });

  it.each(['target', 'all'] as const)('ADR-031 removes a loss-only port marker when %s access is revoked', async mode => {
    const { bg, fake, clock } = await setup();
    bg.runtime.dispatch({ type: 'network:limited', documentKey: KEY, at: clock.t });
    expect(bg.runtime.state.metas.get(KEY)?.requestedLocalPorts).toEqual({ ports: [], truncated: true });
    expect(bg.runtime.state.metas.get(KEY)?.networkCounters ?? []).toEqual([]);
    fake.revoke(mode === 'target' ? ['ws://*/*'] : ORIGINS);
    await bg.runtime.onPermissionsChanged();
    expect(bg.runtime.state.metas.get(KEY)?.requestedLocalPorts).toBeUndefined();
    expect(bg.runtime.getProjection(7)?.requestedLocalPorts).toBeUndefined();
  });

  it('ADR-031 rejects corrupted stored port lists and never invokes their accessor', async () => {
    const { bg, fake } = await setup();
    bg.network.onBeforeRequest(request('stored-number', 3389));
    expect(await bg.runtime.persistNow(KEY)).toBe(true);
    const saved = fake.session.data.get('doc:' + KEY) as { meta: Record<string, unknown> };
    for (const details of [{ ports: [65536], truncated: false }, { ports: [80, 80], truncated: false },
      { ports: [80], truncated: false, host: 'PRIVATE' }, { ports: [80], truncated: 'false' }]) {
      expect(readStoredDocument('doc:' + KEY, { ...saved, meta: { ...saved.meta, requestedLocalPorts: details } })).toBeNull();
    }
    const read = vi.fn(() => ({ ports: [80], truncated: false }));
    const meta = { ...saved.meta };
    Object.defineProperty(meta, 'requestedLocalPorts', { enumerable: true, get: read });
    expect(readStoredDocument('doc:' + KEY, { ...saved, meta })).toBeNull();
    expect(read).not.toHaveBeenCalled();
    const legacy = structuredClone(saved);
    delete legacy.meta['requestedLocalPorts'];
    expect(readStoredDocument('doc:' + KEY, legacy)?.meta.requestedLocalPorts).toBeUndefined();
  });

  it('observes a DNS-like fetch series as browser evidence without persisting random labels or hashes', async () => {
    const { bg, fake } = await setup();
    const dispatch = vi.spyOn(bg.runtime, 'dispatch');
    for (let index = 0; index < 8; index++) bg.network.onBeforeRequest(request('dns-' + index, 1, {
      type: 'xmlhttprequest', url: 'https://a1b2c3d' + index + '.dns.example.net/CANARY_PATH?CANARY_QUERY',
    }));
    await vi.waitFor(() => expect(bg.runtime.getProjection(7)?.techniques.find(entry => entry.techniqueId === 'DET-061')).toMatchObject({
      count: 8, countQuality: 'lower-bound', signalCodes: ['api-use', 'unique-subdomains'], phases: ['attempted'],
      evidenceSource: 'browser-network', integrity: 'browser-observed', interpretation: 'dns-test-pattern', interpretationConfidence: 'low',
    }));
    expect(JSON.stringify(dispatch.mock.calls)).not.toMatch(/a1b2c3d|dns\.example|CANARY|dnsToken|dnsTargetGranted/);
    await settle(20);
    const report = bg.runtime.getProjection(7)!;
    const preview = await bg.runtime.exportPreview(7, KEY, report.reportRevision, false);
    expect(JSON.stringify([preview, [...fake.session.data]])).not.toMatch(/a1b2c3d|dns\.example|CANARY|dnsToken|hashSalt/);
  });

  it('records subsecond failed attempts once, preserves attempted semantics and emits only redacted browser evidence', async () => {
    const { bg, fake, clock } = await setup();
    const observed = vi.spyOn(bg.runtime, 'dispatch');
    for (let i = 0; i < 4; i++) {
      bg.network.onBeforeRequest(request('r' + i, 61001 + i));
      bg.network.onBeforeRequest(request('r' + i, 61001 + i)); // browser identity retry: no second count
      bg.network.onCompleted(request('r' + i, 61001 + i, { error: 'ERR_CANARY', statusCode: 0 }));
      clock.t += 15;
    }
    expect(local(bg)).toMatchObject({ count: 4, phases: ['attempted'], evidenceSource: 'browser-network', integrity: 'browser-observed',
      attributionConfidence: 'frame-only', interpretation: 'local-probe-pattern', interpretationConfidence: 'low' });
    expect(bg.runtime.getProjection(7)?.techniques.find(t => t.techniqueId === 'DET-058')?.count).toBe(4);
    expect(bg.runtime.getProjection(7)?.findings.find(f => f.techniqueId === 'DET-060')?.limitationCodes).toContain('uncalibrated-threshold');
    expect(bg.runtime.state.reports.get(KEY)?.counters).toEqual([]);
    expect(JSON.stringify(observed.mock.calls)).not.toMatch(/CANARY|127\.0\.0\.1|ws:\/\//);
    await settle(15);
    const projection = bg.runtime.getProjection(7)!;
    const exported = await bg.runtime.exportPreview(7, KEY, projection.reportRevision, false);
    expect(exported).toMatchObject({ type: 'export-preview', preview: { report: { requestedLocalPorts: { ports: [61001, 61002, 61003, 61004], truncated: false } } } });
    expect(JSON.stringify([exported, [...fake.session.data]])).not.toMatch(/CANARY|127\.0\.0\.1|ws:\/\//);
    expect(readStoredDocument('doc:' + KEY, fake.session.data.get('doc:' + KEY))?.meta.networkCounters).toHaveLength(3);
  });

  it.each(['ws:', 'wss:', 'http:', 'https:'])('counts local %s attempts, and only WebSocket type contributes DET058', async scheme => {
    const { bg } = await setup();
    bg.network.onBeforeRequest(request('r', 1, { url: scheme + '//[::1]:62001/', type: scheme.startsWith('ws') ? 'websocket' : 'xmlhttprequest' }));
    expect(local(bg)).toMatchObject({ count: 1, interpretation: 'api-use', interpretationConfidence: 'unassessed' });
    expect(bg.runtime.getProjection(7)?.techniques.some(t => t.techniqueId === 'DET-058')).toBe(scheme.startsWith('ws'));
  });

  it.each(['127.0.0.1', '127.1', '0x7f000001', '[::1]', '[::ffff:127.0.0.1]', '10.0.0.1', '172.16.1.2', '192.168.1.1', '169.254.1.1', '[fe80::1]', '[fc00::1]', 'localhost.', 'printer.local', 'dev.localhost'])('normalizes local target %s without retaining it', async host => {
    const { bg } = await setup();
    bg.network.onBeforeRequest(request('r', 1, { url: 'ws://' + host + ':62001/' }));
    expect(local(bg)?.count).toBe(1);
    expect(JSON.stringify(bg.runtime.state.metas.get(KEY))).not.toContain(host);
  });

  it.each(['localhost.evil.example', 'public.example', 'printer', '8.8.8.8', '[2001:4860:4860::8888]'])('public or ambiguous %s many-port WebSockets do not identify local probing', async host => {
    const { bg } = await setup();
    for (let i = 0; i < 8; i++) bg.network.onBeforeRequest(request('r' + i, 1, { url: 'ws://' + host + ':' + (62001 + i) + '/' }));
    expect(local(bg)).toBeUndefined();
    expect(bg.runtime.getProjection(7)?.techniques.find(t => t.techniqueId === 'DET-058')?.count).toBe(8);
  });

  it('single desktop-service retries, distinct targets, and stale windows remain neutral', async () => {
    const { bg, clock } = await setup();
    for (let i = 0; i < 12; i++) bg.network.onBeforeRequest(request('same' + i));
    for (let i = 0; i < 4; i++) bg.network.onBeforeRequest(request('host' + i, 1, { url: 'ws://192.168.0.' + (i + 1) + ':62001/' }));
    clock.t += 10000;
    for (let i = 0; i < 4; i++) { bg.network.onBeforeRequest(request('slow' + i, 62001 + i)); clock.t += 10001; }
    expect(local(bg)).toMatchObject({ count: 20, interpretation: 'api-use' });
  });

  it('missing native owner, opaque/foreign initiator and nonactive documents never acquire top-frame attribution', async () => {
    const { bg } = await setup();
    for (const [i, over] of [{ tabId: -1 }, { documentId: undefined }, { frameId: -1 }, { initiator: 'null' }, { initiator: 'chrome-extension://abcdefghijklmnop/' }, { documentLifecycle: 'cached' }, { documentId: D2 }].entries()) bg.network.onBeforeRequest(request('r' + i, 62001, over));
    expect(local(bg)).toBeUndefined();
    expect(bg.runtime.state.unattributed.requests).toBeGreaterThan(0);
  });

  it('a blob worker browser identity stays in its exact child document and cannot mix parent ports', async () => {
    const { bg } = await setup();
    const child = committed({ frameId: 3, documentId: D2, parentDocumentId: D1, frameType: 'sub_frame', url: 'https://child.example/' });
    bg.navigation.onCommitted(child);
    for (let i = 0; i < 3; i++) bg.network.onBeforeRequest(request('top' + i, 62001 + i));
    for (let i = 0; i < 4; i++) bg.network.onBeforeRequest(request('child' + i, 62001 + i, { frameId: 3, documentId: D2, initiator: 'blob:https://child.example/CANARY_BLOB' }));
    expect(local(bg)).toMatchObject({ count: 3, interpretation: 'api-use' });
    expect(local(bg, 3)).toMatchObject({ count: 4, interpretation: 'local-probe-pattern' });
  });

  it.each(['about:blank', 'about:srcdoc', 'blob:https://example.com/owned-child'])('retains early worker requests while %s awaits its verified sender origin', async url => {
    const { bg, clock } = await setup();
    bg.navigation.onCommitted(committed({ frameId: 3, documentId: D2, parentDocumentId: D1, frameType: 'sub_frame', url }));
    const childKey = '7:3:' + D2;
    expect(bg.runtime.state.bindings.get('7:3')).toMatchObject({ originPending: true, accessGranted: false });
    for (let index = 0; index < 4; index++) bg.network.onBeforeRequest(request('early-child-' + index, 61001 + index,
      { frameId: 3, documentId: D2, initiator: 'https://example.com' }));
    clock.t += 250;
    bg.runtime.networkAttempts.flush();
    expect(local(bg, 3)).toBeUndefined();
    expect(await route(bg.runtime, { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'EARLY_BOOT', bridgeSessionId: 'EARLY_BRIDGE',
      batchSeq: 1, observations: [], coverageDelta: ['hook-failed'] },
    pageSender({ frameId: 3, documentId: D2, url, origin: 'https://example.com' }))).toMatchObject({ type: 'ack', lastCommittedBatchSeq: 1 });
    expect(bg.runtime.state.bindings.get('7:3')).toMatchObject({ documentKey: childKey, originPending: false, accessGranted: true });
    expect(local(bg, 3)).toMatchObject({ count: 4, interpretation: 'local-probe-pattern', evidenceSource: 'browser-network', integrity: 'browser-observed' });
    expect(local(bg)).toBeUndefined();
  });

  it('expires unresolved inherited requests with a gap, never replaying raw targets after the deadline', async () => {
    const { bg, fake, clock } = await setup();
    bg.navigation.onCommitted(committed({ frameId: 3, documentId: D2, parentDocumentId: D1, frameType: 'sub_frame', url: 'about:blank' }));
    bg.network.onBeforeRequest(request('late-child', 61001, { frameId: 3, documentId: D2 }));
    clock.t += 2000;
    bg.runtime.networkAttempts.flush();
    expect((bg.runtime.networkAttempts as unknown as { pending: unknown[] }).pending).toEqual([]);
    expect(await route(bg.runtime, { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'BOOT', bridgeSessionId: 'BRIDGE',
      batchSeq: 1, observations: [], coverageDelta: ['hook-failed'] },
    pageSender({ frameId: 3, documentId: D2, url: 'about:blank', origin: 'https://example.com' }))).toMatchObject({ type: 'ack' });
    expect(local(bg, 3)).toBeUndefined();
    expect(bg.runtime.getProjection(7, 3)?.coverageFlags).toContain('network-limited');
    await settle(15);
    expect(JSON.stringify([...fake.session.data])).not.toMatch(/CANARY|127\.0\.0\.1|61001|ws:\/\//);
    bg.network.onBeforeRequest(request('after-inherited-gap', 61002, { frameId: 3, documentId: D2 }));
    expect(bg.runtime.getProjection(7, 3)?.requestedLocalPorts).toEqual({ ports: [61002], truncated: true });
  });

  it('late inherited replay after a recording reset preserves the parent fresh port window', async () => {
    const { bg, clock } = await setup();
    bg.navigation.onCommitted(committed({ frameId: 3, documentId: D2, parentDocumentId: D1, frameType: 'sub_frame', url: 'about:blank' }));
    bg.network.onBeforeRequest(request('old-child', 62001, { frameId: 3, documentId: D2 }));
    clock.t += 50;
    bg.runtime.resetNetworkProbeWindows([KEY, '7:3:' + D2], 7, clock.t);
    for (let index = 0; index < 3; index++) {
      clock.t += 100;
      bg.network.onBeforeRequest(request('fresh-parent-' + index, 63001 + index));
    }
    clock.t += 50;
    await route(bg.runtime, { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'BOOT', bridgeSessionId: 'BRIDGE',
      batchSeq: 1, observations: [], coverageDelta: ['hook-failed'] },
    pageSender({ frameId: 3, documentId: D2, url: 'about:blank', origin: 'https://example.com' }));
    clock.t += 100;
    bg.network.onBeforeRequest(request('fresh-parent-fourth', 63004));
    expect(local(bg)).toMatchObject({ count: 4, interpretation: 'local-probe-pattern' });
    expect(local(bg, 3)).toMatchObject({ count: 1, interpretation: 'api-use' });
  });

  it.each(['opaque', 'paused', 'replaced', 'revoked'] as const)('does not restore unresolved requests after %s', async reason => {
    const { bg, fake } = await setup();
    const child = committed({ frameId: 3, documentId: D2, parentDocumentId: D1, frameType: 'sub_frame', url: 'about:blank' });
    bg.navigation.onCommitted(child);
    bg.network.onBeforeRequest(request('discard-child', 61001, { frameId: 3, documentId: D2 }));
    const childKey = '7:3:' + D2;
    if (reason === 'paused') bg.runtime.dispatch({ type: 'ui:pause', documentKey: childKey, at: 100001 });
    if (reason === 'replaced') bg.navigation.onCommitted({ ...child, documentId: 'replacement-child' });
    if (reason === 'revoked') { fake.revoke(['ws://*/*']); await bg.runtime.onPermissionsChanged(); }
    await route(bg.runtime, { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'BOOT', bridgeSessionId: 'BRIDGE',
      batchSeq: 1, observations: [], coverageDelta: ['hook-failed'] },
    pageSender({ frameId: 3, documentId: D2, url: 'about:blank', origin: reason === 'opaque' ? 'null' : 'https://example.com' }));
    bg.runtime.networkAttempts.flush();
    expect(local(bg, 3)).toBeUndefined();
    expect(local(bg)).toBeUndefined();
    expect((bg.runtime.networkAttempts as unknown as { pending: unknown[] }).pending).toEqual([]);
  });

  it('page-supplied DET060 cannot set browser counts/signals/findings or invoke the internal event', async () => {
    const { bg } = await setup();
    expect(await route(bg.runtime, { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'BOOT', bridgeSessionId: 'BRIDGE', batchSeq: 1,
      observations: [{ techniqueId: 'DET-060', phase: 'attempted', signalCodes: ['api-use', 'local-multi-port'], count: 999, countQuality: 'exact', intervalBucket: 1 }], coverageDelta: [] }, pageSender())).toMatchObject({ type: 'ack' });
    expect(local(bg)).toMatchObject({ count: 999, integrity: 'page-controlled' });
    bg.network.onBeforeRequest(request('real'));
    expect(local(bg)).toMatchObject({ count: 1, signalCodes: ['api-use'], interpretation: 'api-use', integrity: 'browser-observed' });
    const before = JSON.stringify(bg.runtime.getProjection(7));
    await route(bg.runtime, { type: 'network:observed', documentKey: KEY, websocket: true, local: true, multiPort: true, limited: false, epoch: 'FORGED', at: 100000 }, pageSender());
    expect(JSON.stringify(bg.runtime.getProjection(7))).toBe(before);
  });

  it('clear and pause discard classifier state; fresh report receives a new epoch', async () => {
    const { bg } = await setup();
    for (let i = 0; i < 3; i++) bg.network.onBeforeRequest(request('pre' + i, 62001 + i));
    const epoch = bg.runtime.state.metas.get(KEY)?.networkCounterEpoch;
    await bg.runtime.clear(7, KEY, bg.runtime.getProjection(7)!.reportRevision);
    bg.network.onBeforeRequest(request('post', 62004));
    expect(local(bg)).toMatchObject({ count: 1, interpretation: 'api-use' });
    expect(bg.runtime.state.metas.get(KEY)?.networkCounterEpoch).not.toBe(epoch);
    await bg.runtime.pause(7, KEY, bg.runtime.getProjection(7)!.reportRevision);
    bg.network.onBeforeRequest(request('paused', 62005));
    expect(local(bg)?.count).toBe(1);
    await bg.runtime.resume(7, KEY, bg.runtime.getProjection(7)!.reportRevision);
    bg.network.onBeforeRequest(request('resumed', 62006));
    expect(local(bg)).toMatchObject({ count: 2, interpretation: 'api-use' });
  });

  it('explicit recording-window reset preserves Light history but requires a fresh four-port window', async () => {
    const { bg } = await setup();
    for (let i = 0; i < 3; i++) bg.network.onBeforeRequest(request('pre' + i, 62001 + i));
    bg.runtime.resetNetworkProbeWindows([KEY]);
    bg.network.onBeforeRequest(request('post', 62004));
    expect(local(bg)).toMatchObject({ count: 4, interpretation: 'api-use' });
    for (let i = 0; i < 3; i++) bg.network.onBeforeRequest(request('new' + i, 63001 + i));
    expect(local(bg)).toMatchObject({ count: 7, interpretation: 'local-probe-pattern' });
  });
});

describe('ADR-025 scope, startup and bounded persistence', () => {
  it('does not hash for a restored paused document while frame reconciliation is pending', async () => {
    const { bg, fake, clock } = await setup();
    bg.network.onBeforeRequest(request('persist-before-pause'));
    expect(await bg.runtime.pause(7, KEY, bg.runtime.getProjection(7)!.reportRevision)).toMatchObject({ type: 'ok' });
    expect(await bg.runtime.persistNow(KEY)).toBe(true);
    await bg.runtime.flushIndex();
    bg.runtime.stop();
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const getFrames = fake.webNavigation.getAllFrames.bind(fake.webNavigation);
    let reconciling = false;
    fake.webNavigation.getAllFrames = async details => {
      reconciling = true;
      await barrier;
      return getFrames(details);
    };
    const restored = createBackground(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
    running.push(restored);
    const digest = vi.spyOn(crypto.subtle, 'digest');
    const startup = restored.start();
    try {
      await vi.waitFor(() => expect(reconciling).toBe(true));
      expect(restored.runtime.hydrationComplete).toBe(false);
      expect(restored.runtime.scope.getScopeMode()).toBe('all-sites');
      expect(restored.runtime.state.metas.get(KEY)?.paused).toBe(true);
      restored.network.onBeforeRequest(dnsRequest(1));
      expect(digest).not.toHaveBeenCalled();
      expect((restored.runtime.networkAttempts as unknown as { pending: unknown[] }).pending).toEqual([]);
    } finally {
      release();
      await startup;
      digest.mockRestore();
    }
    expect(dns(restored)).toBeUndefined();
    expect(restored.runtime.state.metas.get(KEY)?.paused).toBe(true);
  });

  it('does not hash DNS names before startup grants or while the restored scope is off', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest');
    try {
      for (const mode of ['off', 'all-sites'] as const) {
        const { bg } = cold(ORIGINS, mode);
        bg.network.onBeforeRequest(dnsRequest(1));
        expect(digest).not.toHaveBeenCalled();
        if (mode === 'off') {
          await bg.runtime.scope.startup();
          bg.network.onBeforeRequest(dnsRequest(2));
          expect(digest).not.toHaveBeenCalled();
        }
        expect((bg.runtime.networkAttempts as unknown as { pending: unknown[] }).pending).toEqual([]);
      }
      const narrow = cold(['https://example.com/*'], 'site');
      await narrow.bg.runtime.scope.startup();
      narrow.bg.network.onBeforeRequest(dnsRequest(3));
      expect(digest).not.toHaveBeenCalled();
    } finally { digest.mockRestore(); }
  });

  it.each(['repeat-host', 'repeat-request', 'short-shards', 'images', 'base-domain', 'unknown-suffix', 'separate-domains'] as const)('keeps DNS negative %s outside classification', async scenario => {
    const { bg } = await setup();
    for (let index = 0; index < 12; index++) {
      const over: Partial<RequestDetailsLike> = {};
      if (scenario === 'repeat-host') over.url = 'https://images12.example.net/CANARY?cache=' + index;
      if (scenario === 'repeat-request') over.requestId = 'repeated-browser-id';
      if (scenario === 'short-shards') over.url = 'https://cdn' + index + '.example.net/';
      if (scenario === 'images') over.type = 'image';
      if (scenario === 'base-domain') over.url = 'https://example.net/';
      if (scenario === 'unknown-suffix') over.url = 'https://a1b2c3d' + index + '.example.invalid/';
      if (scenario === 'separate-domains') over.url = 'https://a1b2c3d' + index + '.domain' + index + '.com/';
      bg.network.onBeforeRequest(dnsRequest(index, over));
    }
    await hashesDrained(bg);
    expect(dns(bg)).toBeUndefined();
  });

  it('uses exact target permissions before hashing without confusing a registrable domain with a grant', async () => {
    const { bg } = await setup(['https://example.com/*', 'https://*.dns.example.net/*'], 'site');
    for (let index = 0; index < 8; index++) bg.network.onBeforeRequest(dnsRequest(index));
    await hashesDrained(bg); expect(dns(bg)?.count).toBe(8);
    for (const origins of [['https://example.com/*'], ['https://*.dns.example.net/*'], ['http://*/*']]) {
      const denied = await setup(origins, 'site');
      for (let index = 0; index < 8; index++) denied.bg.network.onBeforeRequest(dnsRequest(index));
      await hashesDrained(denied.bg); expect(dns(denied.bg)).toBeUndefined();
    }
  });

  it.each(['clear', 'pause', 'revoke', 'replacement', 'recording-reset', 'timeout'] as const)('delayed DNS digests cannot restore observations after %s', async change => {
    const releases: Array<(value: ArrayBuffer) => void> = [];
    const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementation(() => new Promise<ArrayBuffer>(resolve => releases.push(resolve)));
    try {
      const { bg, fake, clock } = await setup();
      for (let index = 0; index < 8; index++) bg.network.onBeforeRequest(dnsRequest(index));
      expect(releases).toHaveLength(8);
      if (change === 'clear') bg.runtime.dispatch({ type: 'ui:clear', documentKey: KEY, at: clock.t });
      if (change === 'pause') bg.runtime.dispatch({ type: 'ui:pause', documentKey: KEY, at: clock.t });
      if (change === 'revoke') { fake.revoke(['https://*/*']); await bg.runtime.onPermissionsChanged(); }
      if (change === 'replacement') bg.navigation.onCommitted(committed({ documentId: D2 }));
      if (change === 'recording-reset') bg.runtime.resetNetworkProbeWindows([KEY], 7, clock.t);
      if (change === 'timeout') { clock.t += 2000; bg.runtime.networkAttempts.flush(); }
      releases.forEach((release, index) => release(new Uint8Array(32).fill(index).buffer));
      await hashesDrained(bg);
      expect(dns(bg)).toBeUndefined();
      expect((bg.runtime.networkAttempts as unknown as { pending: unknown[] }).pending).toEqual([]);
    } finally { digest.mockRestore(); }
  });

  it('bounds physical hashing work during stalls and turns failures into explicit coverage loss', async () => {
    const releases: Array<(value: ArrayBuffer) => void> = [];
    const buffers: Uint8Array[] = [];
    const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementation((_algorithm, input) => {
      expect(input).toBeInstanceOf(Uint8Array);
      buffers.push(input as Uint8Array);
      return new Promise<ArrayBuffer>(resolve => releases.push(resolve));
    });
    try {
      const { bg, clock } = await setup();
      for (let index = 0; index < 80; index++) bg.network.onBeforeRequest(dnsRequest(index));
      expect(releases).toHaveLength(64);
      expect(buffers.every(buffer => buffer.length > 16 && buffer.every(value => value === 0))).toBe(true);
      clock.t += 2000; bg.runtime.networkAttempts.flush();
      for (let index = 80; index < 160; index++) bg.network.onBeforeRequest(dnsRequest(index));
      expect(releases).toHaveLength(64);
      expect(bg.runtime.getProjection(7)?.coverageFlags).toContain('network-limited');
      releases.forEach(release => release(new ArrayBuffer(32))); await hashesDrained(bg);
      expect(dns(bg)).toBeUndefined();
      digest.mockRejectedValue(new Error('digest failed'));
      bg.network.onBeforeRequest(dnsRequest(999)); await hashesDrained(bg);
      expect(dns(bg)).toBeUndefined();
    } finally { digest.mockRestore(); }
  });

  it('HTTP(S), wildcard HTTP and missing initiating grants cannot substitute for actual WS/WSS grants', async () => {
    for (const origins of [['http://*/*', 'https://*/*'], ['*://*/*'], ['https://example.com/*'], ['ws://127.0.0.1/*']]) {
      const { bg } = await setup(origins, 'site');
      bg.network.onBeforeRequest(request('r'));
      expect(local(bg)).toBeUndefined();
      expect(bg.runtime.scope.isHostGrantedSync('127.0.0.1', 'wss')).toBe(false);
    }
    const { bg } = await setup(['https://example.com/*', 'ws://127.0.0.1/*'], 'site');
    bg.network.onBeforeRequest(request('ws'));
    bg.network.onBeforeRequest(request('wss', 62002, { url: 'wss://127.0.0.1:62002/' }));
    expect(local(bg)?.count).toBe(1);
    expect(bg.runtime.getProjection(7)?.coverageFlags).toContain('network-limited');
  });

  it('permission requests include four schemes while scripting registration remains HTTP(S) only', async () => {
    const request = vi.fn(async () => true);
    await requestScopeAccess({ request }, 'all-sites');
    expect(request).toHaveBeenLastCalledWith({ origins: ORIGINS });
    await requestScopeAccess({ request }, 'site', 'example.com');
    expect(request).toHaveBeenLastCalledWith({ origins: ORIGINS.map(pattern => pattern.replace('*', 'example.com')) });
    const { fake } = await setup();
    for (const script of fake.registered.values()) expect(script.matches).toEqual(ORIGINS.slice(0, 2));
  });

  it('startup replays only within two seconds after verified broad four-scheme access', async () => {
    const { bg } = cold(); await bg.runtime.scope.load(); bg.network.onBeforeRequest(request('r')); await bg.start();
    expect(local(bg)?.count).toBe(1);
    for (const mode of ['site', 'off'] as const) {
      const other = cold(ORIGINS, mode); await other.bg.runtime.scope.load(); other.bg.network.onBeforeRequest(request('r')); await other.bg.start();
      expect(local(other.bg)).toBeUndefined();
    }
    const expired = cold(); await expired.bg.runtime.scope.load(); expired.bg.network.onBeforeRequest(request('r')); expired.clock.t += 2000; await expired.bg.start();
    expect(local(expired.bg)).toBeUndefined();
    expect(expired.bg.runtime.getProjection(7)?.coverageFlags).toContain('network-limited');
  });

  it('precommit attempts wait for their exact document only, with explicit expiration/overflow loss', async () => {
    const { bg, clock } = await setup();
    bg.network.onBeforeRequest(request('child', 62001, { frameId: 3, documentId: D2 }));
    expect(local(bg)).toBeUndefined();
    bg.navigation.onCommitted(committed({ frameId: 3, documentId: D2, parentDocumentId: D1, frameType: 'sub_frame' }));
    expect(local(bg, 3)?.count).toBe(1);
    for (let i = 0; i < 129; i++) bg.network.onBeforeRequest(request('pending' + i, 62001, { frameId: 4, documentId: 'PENDING' }));
    expect(bg.runtime.state.unattributed.requests).toBeGreaterThan(0);
    clock.t += 2000; bg.runtime.networkAttempts.flush();
    expect(bg.runtime.state.unattributed.requests).toBeGreaterThanOrEqual(129);
    bg.navigation.onCommitted(committed({ frameId: 4, documentId: 'PENDING', parentDocumentId: D1, frameType: 'sub_frame' }));
    expect(local(bg, 4)).toBeUndefined();
    expect(bg.runtime.getProjection(7, 4)?.coverageFlags).toContain('network-limited');
  });

  it('revoke purges counters and pending attempts; restore preserves counters but never prior port-window state', async () => {
    const { bg, fake, clock } = await setup();
    for (let i = 0; i < 3; i++) bg.network.onBeforeRequest(request('pre' + i, 62001 + i));
    await settle(15); await bg.runtime.flushIndex(); bg.runtime.stop();
    const next = createBackground(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 }); running.push(next); await next.start();
    next.network.onBeforeRequest(request('post', 62004));
    expect(local(next)).toMatchObject({ count: 4, interpretation: 'api-use' });
    next.network.onBeforeRequest(request('pending', 62001, { frameId: 3, documentId: D2 }));
    fake.revoke(['ws://*/*']); await next.runtime.onPermissionsChanged();
    expect(local(next)).toBeUndefined();
    fake.grant(['ws://*/*']); await next.runtime.onPermissionsChanged();
    next.navigation.onCommitted(committed({ frameId: 3, documentId: D2, parentDocumentId: D1, frameType: 'sub_frame' }));
    expect(local(next, 3)).toBeUndefined();
  });

  it('internal aggregate admission rejects rogue fields, duplicate keys, invalid signals, and saturated counts become lower-bound', () => {
    const valid = incrementNetworkCounters([], false, true, false, false, 0);
    expect(readNetworkCounters([{ ...valid[0], endpoint: 'CANARY' }])).toEqual([]);
    expect(readNetworkCounters([...valid, ...valid])).toEqual([]);
    expect(readNetworkCounters([{ ...valid[0], signalCodes: ['local-multi-port'] }])).toEqual([]);
    expect(incrementNetworkCounters([{ ...valid[0]!, count: MAX_COUNT }], false, true, false, false, 1)[0]).toMatchObject({ count: MAX_COUNT, countQuality: 'lower-bound' });
  });

  it('a pending two-second deadline preempts an existing ten-second classifier cleanup timer', async () => {
    vi.useFakeTimers();
    const { bg, clock } = await setup();
    bg.network.onBeforeRequest(request('known'));
    clock.t += 1000; await vi.advanceTimersByTimeAsync(1000);
    bg.network.onBeforeRequest(request('unknown', 63001, { frameId: 3, documentId: D2 }));
    const pending = () => (bg.runtime.networkAttempts as unknown as { pending: unknown[] }).pending;
    expect(pending()).toHaveLength(1);
    clock.t += 2000; await vi.advanceTimersByTimeAsync(2000);
    expect(pending()).toEqual([]);
    expect(bg.runtime.state.unattributed.requests).toBe(1);
  });

  it('stalled hydration expires raw pending metadata; later off scope records no diagnostic or attempt', async () => {
    vi.useFakeTimers();
    const { bg, clock } = cold(ORIGINS, 'off');
    bg.network.onBeforeRequest(request('pending'));
    bg.network.onBeforeRequest(request('ownerless', 61001, { documentId: undefined }));
    clock.t += 2000; await vi.advanceTimersByTimeAsync(2000);
    expect((bg.runtime.networkAttempts as unknown as { pending: unknown[] }).pending).toEqual([]);
    await bg.start();
    expect(bg.runtime.state.unattributed.requests).toBe(0);
    expect(local(bg)).toBeUndefined();
    expect(bg.runtime.getProjection(7)?.coverageFlags).not.toContain('network-limited');
  });

  it.each(['off', 'site'] as const)('ownerless retained browser grants cannot create diagnostics outside %s scope', async mode => {
    const { bg } = await setup(ORIGINS, mode);
    bg.network.onBeforeRequest(request('ownerless', 62001, { documentId: undefined }));
    expect(bg.runtime.state.unattributed.requests).toBe(0);
    expect(local(bg)).toBeUndefined();
  });

  it('off policy during pending delay and tab close remove work without resurrecting evidence', async () => {
    const { bg, clock } = await setup();
    bg.network.onBeforeRequest(request('pending', 62001, { frameId: 3, documentId: D2 }));
    await bg.runtime.scope.setScope({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'off' });
    clock.t += 2000; bg.runtime.networkAttempts.flush();
    expect(bg.runtime.state.unattributed.requests).toBe(0);
    await bg.runtime.scope.setScope({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' });
    await bg.runtime.onPermissionsChanged();
    bg.network.onBeforeRequest(request('close-pending', 62001, { frameId: 3, documentId: D2 }));
    bg.runtime.dispatch({ type: 'tab:removed', tabId: 7, at: clock.t });
    expect((bg.runtime.networkAttempts as unknown as { pending: unknown[] }).pending).toEqual([]);
    bg.navigation.onCommitted(committed());
    bg.navigation.onCommitted(committed({ frameId: 3, documentId: D2, parentDocumentId: D1, frameType: 'sub_frame' }));
    expect(local(bg, 3)).toBeUndefined();
  });

  it('request-ID capacity causes explicit lower-bound counts without double-counting evicted retries', async () => {
    const { bg } = await setup();
    for (let i = 0; i < 140; i++) bg.network.onBeforeRequest(request('r' + i));
    bg.network.onBeforeRequest(request('r0'));
    expect(local(bg)).toMatchObject({ count: 128, countQuality: 'lower-bound', interpretation: 'api-use' });
    expect(bg.runtime.getProjection(7)?.coverageFlags).toContain('network-limited');
  });

  it('classification eviction marks the document whose window was lost as well as the incoming one', async () => {
    const { bg } = await setup();
    bg.network.onBeforeRequest(request('top'));
    for (let i = 1; i <= 32; i++) {
      bg.navigation.onCommitted(committed({ frameId: i, documentId: 'child' + i, parentDocumentId: D1, frameType: 'sub_frame' }));
      bg.network.onBeforeRequest(request('r' + i, 61001, { frameId: i, documentId: 'child' + i }));
    }
    expect(bg.runtime.getProjection(7)?.coverageFlags).toContain('network-limited');
    expect(bg.runtime.getProjection(7, 32)?.coverageFlags).toContain('network-limited');
  });
});
