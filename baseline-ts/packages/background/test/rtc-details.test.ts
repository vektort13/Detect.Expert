import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUDGETS } from '@detect-expert/contracts';
import type { RtcSnapshot } from '@detect-expert/contracts';
import { createBackground, route } from '../src/index';
import type { Background, FrameDetailsLike, MessageSenderLike } from '../src/index';
import { RTC_IDLE_MS, RTC_MAX_DOCUMENTS, RTC_MAX_GRANTS, RTC_MAX_PENDING, RTC_STORAGE_KEY } from '../src/rtc-details';
import { committed, createFakeChrome, pageSender, uiSender } from './fake-chrome';

const TOP = 'rtctop';
const CHILD = 'rtcchild';
const key = (id = TOP, frameId = 0) => '7:' + frameId + ':' + id;
const snapshot = (revision = 1): RtcSnapshot => ({ revision, total: 1, omitted: 0, captureLimited: false,
  connections: [{ id: 1, created: true, closed: true, connected: false, state: 'closed', duration: 'under-1s',
    configurationChanges: 0, truncated: false, servers: [{ scheme: 'turn', host: 'relay.example', port: 3478, transport: 'udp',
      configured: true, candidate: false, error: true }] }] });
const instances: Background[] = [];
afterEach(() => { for (const bg of instances) bg.runtime.stop(); instances.length = 0; vi.useRealTimers(); });
const frame = (id = TOP, frameId = 0, url = 'https://example.com/page'): FrameDetailsLike => ({ frameId, documentId: id,
  documentLifecycle: 'active', frameType: frameId === 0 ? 'outermost_frame' : 'sub_frame', url,
  ...(frameId === 0 ? {} : { parentDocumentId: TOP, parentFrameId: 0 }) });
const sender = (id = TOP, frameId = 0, over: Partial<MessageSenderLike> = {}) => pageSender({ documentId: id, frameId, documentLifecycle: 'active', ...over });
async function setup(withChild = false, now = 1000) {
  const fake = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
  fake.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
  const clock = { t: now, now() { return this.t; } };
  const bg = createBackground(fake, { ttlIntervalMs: 0, clock }); instances.push(bg);
  await bg.start();
  fake.framesByTab.set(7, [frame(), ...(withChild ? [frame(CHILD, 2, 'about:blank')] : [])]);
  fake.tabList = [{ id: 7 }];
  bg.navigation.onCommitted(committed({ documentId: TOP }));
  if (withChild) bg.navigation.onCommitted(committed({ documentId: CHILD, frameId: 2, frameType: 'sub_frame', parentDocumentId: TOP, parentFrameId: 0, url: 'about:blank' }));
  const send = (message: unknown, from = sender()) => route(bg.runtime, message, from);
  const get = (id = TOP, frameId = 0) => send({ schemaVersion: 1, type: 'ui-rtc-get', tabId: 7, documentKey: key(id, frameId) }, uiSender());
  const ready = async (id = TOP, frameId = 0) => {
    const result = await send({ schemaVersion: 1, type: 'rtc-ready' }, sender(id, frameId));
    expect(result).toMatchObject({ type: 'rtc-control', enabled: true, reset: false });
    if (result.type !== 'rtc-control' || result.token === null) throw new Error('No authorized RTC token');
    return result.token;
  };
  const deliver = (token: string, data = snapshot(), id = TOP, frameId = 0) => send({ schemaVersion: 1, type: 'rtc-snapshot', token, snapshot: data }, sender(id, frameId));
  return { fake, bg, clock, send, get, ready, deliver };
}
async function restart(s: Awaited<ReturnType<typeof setup>>) {
  await s.bg.runtime.persistNow(key()); await s.bg.runtime.flushIndex(); await s.bg.runtime.rtc.flush(); s.bg.runtime.stop();
  const bg = createBackground(s.fake, { ttlIntervalMs: 0, clock: s.clock }); instances.push(bg); await bg.start();
  return { bg, send: (message: unknown, from = sender()) => route(bg.runtime, message, from),
    get: () => route(bg.runtime, { schemaVersion: 1, type: 'ui-rtc-get', tabId: 7, documentKey: key() }, uiSender()) };
}

describe('ADR-020 bounded WebRTC server details', () => {
  const vendorNow = Date.parse('2026-09-13T12:00:00Z');
  const threatSnapshot = (revision = 1): RtcSnapshot => {
    const value = snapshot(revision);
    value.connections[0]!.servers[0]!.host = 'aa.online-metrix.net';
    return value;
  };

  it('ADR-024: a closed subsecond configured TURN server derives only a page-controlled ThreatMetrix hint', async () => {
    const s = await setup(false, vendorNow), token = await s.ready();
    const before = s.bg.runtime.getProjection(7)!;
    expect(await s.deliver(token, threatSnapshot())).toMatchObject({ accepted: true });
    const report = s.bg.runtime.getProjection(7)!;
    expect(report.reportRevision).toBeGreaterThan(before.reportRevision);
    expect(report.vendors).toEqual([{ vendorId: 'threatmetrix', ruleIds: ['threatmetrix-aa-turn-v1'],
      vendorConfidence: 'weak-signal', evidenceSource: 'page-hook', integrity: 'page-controlled' }]);
    expect(report.observedSince).toBe(vendorNow);
    expect(report.techniques).toEqual([]);
    expect(report.findings).toEqual([]);
    expect(s.bg.runtime.state.reports.get(key())!.hosts).toEqual([]);
    expect(s.bg.runtime.state.metas.get(key())!.sensorSeen).toBe(false);
    const exported = await s.bg.runtime.exportPreview(7, key(), report.reportRevision);
    expect(JSON.stringify([report, exported])).toContain('threatmetrix-aa-turn-v1');
    expect(JSON.stringify([report, exported])).not.toMatch(/aa\.online-metrix|3478|configured|candidate|under-1s/);
    const resumed = await restart(s);
    expect(resumed.bg.runtime.getProjection(7)?.vendors).toEqual(report.vendors);
  });

  it('ADR-024: an undocumented stuns endpoint cannot satisfy the reviewed protocol rule', async () => {
    const s = await setup(false, vendorNow), token = await s.ready();
    const value = threatSnapshot(); value.connections[0]!.servers[0]!.scheme = 'stuns';
    await s.deliver(token, value);
    expect(s.bg.runtime.getProjection(7)?.vendors).toEqual([]);
  });

  it('ADR-024: TTL and pause clear derived Light names, without stale-token resurrection', async () => {
    const s = await setup(false, vendorNow), token = await s.ready();
    await s.deliver(token, threatSnapshot());
    s.clock.t += RTC_IDLE_MS;
    expect(s.bg.runtime.getProjection(7)?.vendors).toEqual([]);
    expect(s.bg.runtime.getProjection(7)?.observedSince).toBeNull();
    expect(await s.get()).toMatchObject({ snapshot: null });
    const fresh = await s.ready();
    expect(fresh).not.toBe(token);
    await s.deliver(fresh, threatSnapshot());
    expect(s.bg.runtime.getProjection(7)?.vendors).toHaveLength(1);
    const report = s.bg.runtime.getProjection(7)!;
    await s.bg.runtime.pause(7, key(), report.reportRevision);
    expect(s.bg.runtime.getProjection(7)?.vendors).toEqual([]);
    expect(await s.deliver(fresh, threatSnapshot(2))).toMatchObject({ accepted: false });
  });

  it.each([true, false])('ADR-024: mixed HTTP/RTC evidence keeps one honest HTTP summary (RTC first=%s)', async rtcFirst => {
    const s = await setup(false, vendorNow);
    s.fake.grant(['http://*/*', 'https://*/*']);
    await s.bg.runtime.onPermissionsChanged();
    const token = await s.ready();
    const http = () => s.bg.network.onCompleted({ tabId: 7, frameId: 0, documentId: TOP, type: 'script',
      url: 'https://h.online-metrix.net/fp/tags.js', initiator: 'https://example.com', statusCode: 200, timeStamp: vendorNow });
    if (rtcFirst) { await s.deliver(token, threatSnapshot()); http(); }
    else { http(); await s.deliver(token, threatSnapshot()); }
    expect(s.bg.runtime.getProjection(7)?.vendors).toEqual([{ vendorId: 'threatmetrix', ruleIds: ['threatmetrix-h-loader-v1'],
      vendorConfidence: 'documented-resource', evidenceSource: 'browser-network', integrity: 'browser-observed' }]);
    expect(await s.get()).toMatchObject({ snapshot: threatSnapshot() });
  });

  it('ADR-024: child identity, clear and browser permission revoke cannot transfer or resurrect a vendor', async () => {
    const s = await setup(true, vendorNow), token = await s.ready();
    await s.deliver(token, threatSnapshot());
    expect(s.bg.runtime.getProjection(7, 2)?.vendors).toEqual([]);
    await s.bg.runtime.clear(7, key(), s.bg.runtime.getProjection(7)!.reportRevision);
    expect(s.bg.runtime.getProjection(7)).toBeNull();
    expect(await s.deliver(token, threatSnapshot(2))).toMatchObject({ accepted: false });
    s.bg.navigation.onCommitted(committed({ documentId: TOP }));
    const next = await s.ready(); await s.deliver(next, threatSnapshot());
    expect(s.bg.runtime.getProjection(7)?.vendors).toHaveLength(1);
    s.fake.revoke(['https://example.com/*']);
    await s.bg.runtime.onPermissionsChanged();
    expect(s.bg.runtime.getProjection(7)?.vendors).toEqual([]);
    expect(await s.deliver(next, threatSnapshot(2))).toMatchObject({ accepted: false });
  });

  it('retains a subsecond closed connection across SW restart without ordinary report/export data', async () => {
    const s = await setup(); const token = await s.ready();
    expect(token).toMatch(/^[a-f0-9]{32}$/);
    expect(await s.deliver(token)).toEqual({ schemaVersion: 1, type: 'rtc-ack', accepted: true, reset: false });
    expect(await s.get()).toMatchObject({ type: 'rtc-state', documentKey: key(), snapshot: snapshot() });
    const report = s.bg.runtime.state.reports.get(key())!;
    const exported = await s.bg.runtime.exportPreview(7, key(), report.revision);
    expect(JSON.stringify([s.bg.runtime.getProjection(7), exported, [...s.fake.local.data]])).not.toContain('relay.example');
    const stored = JSON.stringify(s.fake.session.data.get(RTC_STORAGE_KEY));
    expect(stored).toContain('relay.example'); expect(stored).not.toMatch(/example\.com|https:|username|credential|sdp|candidateAddress/);
    const resumed = await restart(s);
    expect(await resumed.get()).toMatchObject({ snapshot: snapshot() });
    expect(await resumed.send({ schemaVersion: 1, type: 'rtc-ready' })).toMatchObject({ enabled: true, token });
    expect(await resumed.send({ schemaVersion: 1, type: 'rtc-snapshot', token, snapshot: snapshot(2) })).toMatchObject({ accepted: true });
    expect(await resumed.get()).toMatchObject({ snapshot: snapshot(2) });
  });

  it('rejects page UI commands, payload browser identities, foreign senders and cross-document tokens', async () => {
    const s = await setup(true); const token = await s.ready(); const childToken = await s.ready(CHILD, 2);
    expect(childToken).not.toBe(token);
    expect(await s.deliver(token, snapshot(), CHILD, 2)).toMatchObject({ accepted: false, reset: true });
    expect(await s.send({ schemaVersion: 1, type: 'ui-rtc-get', tabId: 7, documentKey: key() })).toMatchObject({ code: 'unauthorized-sender' });
    expect(await s.send({ schemaVersion: 1, type: 'rtc-snapshot', token, snapshot: snapshot(), documentId: CHILD })).toMatchObject({ code: 'invalid-request' });
    expect(await s.send({ schemaVersion: 1, type: 'rtc-ready' }, sender(TOP, 0, { id: 'foreign' }))).toMatchObject({ code: 'unauthorized-sender' });
    expect(await s.get()).toMatchObject({ snapshot: null });
    expect(await s.get(CHILD, 2)).toMatchObject({ snapshot: null });
    expect(await s.send({ schemaVersion: 1, type: 'rtc-ready' }, uiSender())).toMatchObject({ code: 'invalid-request' });
  });

  it('accepts early inherited child identity from the browser, without creating or merging a parent report', async () => {
    const s = await setup(); s.fake.framesByTab.get(7)!.push(frame(CHILD, 2, 'about:blank'));
    const token = await s.ready(CHILD, 2);
    expect(await s.deliver(token, snapshot(), CHILD, 2)).toMatchObject({ accepted: true });
    expect(s.bg.runtime.state.reports.has(key(CHILD, 2))).toBe(false);
    expect(await s.get()).toMatchObject({ snapshot: null });
  });

  it('requires exact current browser frame, lifecycle, origin and permissions on upload and UI reads', async () => {
    const s = await setup(); const token = await s.ready();
    for (const over of [{ tab: { id: 9 } }, { frameId: 77 }, { documentId: 'unknown' }, { documentLifecycle: 'cached' },
      { documentLifecycle: 'prerender' }, { origin: 'https://other.example', url: 'https://other.example/' }]) {
      expect(await s.send({ schemaVersion: 1, type: 'rtc-snapshot', token, snapshot: snapshot() }, sender(TOP, 0, over))).toMatchObject({ accepted: false });
    }
    // An unannounced browser permission change is picked up after ScopeController's existing 5s cache.
    s.clock.t += 5000; s.fake.grantedOrigins.clear();
    expect(await s.deliver(token)).toMatchObject({ accepted: false });
    expect(await s.get()).toMatchObject({ code: 'no-access' });
  });

  it('only persists validated allowlisted server metadata and rejects secret/oversized fields', async () => {
    const s = await setup(); const token = await s.ready();
    const bad = [
      { ...snapshot(), secret: 'AUTHORIZATION_CANARY' },
      { ...snapshot(), connections: [{ ...snapshot().connections[0]!, sdp: 'SDP_CANARY' }] },
      { ...snapshot(), connections: [{ ...snapshot().connections[0]!, servers: [{ ...snapshot().connections[0]!.servers[0]!, credential: 'CREDENTIAL_CANARY' }] }] },
      { ...snapshot(), connections: [{ ...snapshot().connections[0]!, servers: [{ ...snapshot().connections[0]!.servers[0]!, host: 'user:pass@relay.example/path?session=x' }] }] },
      { ...snapshot(), connections: Array.from({ length: 33 }, (_, index) => ({ ...snapshot().connections[0]!, id: index + 1 })), total: 33 },
    ];
    for (const data of bad) expect(await s.send({ schemaVersion: 1, type: 'rtc-snapshot', token, snapshot: data })).toMatchObject({ code: 'invalid-request' });
    expect(await s.get()).toMatchObject({ snapshot: null });
    expect(JSON.stringify([...s.fake.session.data])).not.toMatch(/CANARY|user:pass|relay\.example/);
  });

  it('deduplicates replay/out-of-order revisions and retains cumulative latest snapshot', async () => {
    const s = await setup(); const token = await s.ready();
    await s.deliver(token, snapshot(8));
    const writes = s.fake.session.setCalls.filter(call => RTC_STORAGE_KEY in call).length;
    expect(await s.deliver(token, snapshot(8))).toMatchObject({ accepted: true });
    expect(await s.deliver(token, snapshot(2))).toMatchObject({ accepted: true });
    expect(s.fake.session.setCalls.filter(call => RTC_STORAGE_KEY in call)).toHaveLength(writes);
    expect(await s.get()).toMatchObject({ snapshot: snapshot(8) });
  });

  it('empty ready/snapshots never evict useful records; grants and persisted records are independently bounded', async () => {
    const s = await setup(); const token = await s.ready(); await s.deliver(token);
    const before = s.fake.session.data.get(RTC_STORAGE_KEY);
    for (let i = 1; i <= RTC_MAX_GRANTS + 2; i++) {
      s.clock.t += 100;
      const id = 'empty' + i;
      s.fake.framesByTab.get(7)!.push(frame(id, i));
      const other = await s.ready(id, i);
      expect(await s.deliver(other, { revision: 1, total: 0, omitted: 0, captureLimited: false, connections: [] }, id, i)).toMatchObject({ accepted: true });
    }
    expect(await s.get()).toMatchObject({ snapshot: snapshot() });
    expect(s.fake.session.data.get(RTC_STORAGE_KEY)).toEqual(before);
    expect((s.bg.runtime.rtc as unknown as { grants: Map<string, unknown> }).grants.size).toBe(RTC_MAX_GRANTS);
    for (let i = 1; i <= RTC_MAX_DOCUMENTS; i++) {
      s.clock.t += 1000;
      const id = 'full' + i, frameId = 200 + i;
      s.fake.framesByTab.get(7)!.push(frame(id, frameId));
      const other = await s.ready(id, frameId); await s.deliver(other, snapshot(), id, frameId);
    }
    await s.bg.runtime.rtc.flush();
    expect((s.fake.session.data.get(RTC_STORAGE_KEY) as { documents: unknown[] }).documents).toHaveLength(RTC_MAX_DOCUMENTS);
    expect(await s.get()).toMatchObject({ snapshot: null });
    expect(s.fake.sentToTabs.some(call => call.options?.documentId === TOP && (call.message as { type: string }).type === 'rtc-reset')).toBe(true);
  });

  it('pause and selected-document clear invalidate old tokens and preserve unrelated retained connections', async () => {
    const s = await setup(true); const token = await s.ready(); const child = await s.ready(CHILD, 2);
    await s.deliver(token); await s.deliver(child, snapshot(), CHILD, 2);
    const revision = s.bg.runtime.state.reports.get(key(CHILD, 2))!.revision;
    await s.bg.runtime.pause(7, key(CHILD, 2), revision);
    expect(await s.deliver(child, snapshot(2), CHILD, 2)).toMatchObject({ accepted: false, reset: true });
    expect(await s.get()).toMatchObject({ snapshot: snapshot() });
    const childReport = s.bg.runtime.state.reports.get(key(CHILD, 2))!;
    await s.bg.runtime.resume(7, key(CHILD, 2), childReport.revision);
    const newToken = await s.ready(CHILD, 2); expect(newToken).not.toBe(child);
    await s.deliver(newToken, snapshot(), CHILD, 2);
    await s.bg.runtime.clear(7, key(), s.bg.runtime.state.reports.get(key())!.revision);
    expect(await s.get(CHILD, 2)).toMatchObject({ snapshot: snapshot() });
    const stored = s.fake.session.data.get(RTC_STORAGE_KEY) as { documents: { documentId: string }[] };
    expect(stored.documents.map(record => record.documentId)).toEqual([CHILD]);
  });

  it('ignores cancelled navigation, retires replaced children/top documents, and rejects old tokens', async () => {
    const s = await setup(true); const token = await s.ready(); const child = await s.ready(CHILD, 2);
    await s.deliver(token); await s.deliver(child, snapshot(), CHILD, 2);
    s.bg.navigation.onBeforeNavigate(committed({ url: 'https://other.example/' }));
    s.bg.navigation.onErrorOccurred(committed({ url: 'https://other.example/' }));
    expect(await s.get()).toMatchObject({ snapshot: snapshot() });
    s.fake.framesByTab.set(7, [frame(), frame('replacement', 2)]);
    s.bg.navigation.onCommitted(committed({ documentId: 'replacement', frameId: 2, frameType: 'sub_frame', parentDocumentId: TOP, parentFrameId: 0 }));
    expect(await s.deliver(child, snapshot(2), CHILD, 2)).toMatchObject({ accepted: false });
    expect(await s.get()).toMatchObject({ snapshot: snapshot() });
    s.fake.framesByTab.set(7, [frame('newtop')]);
    s.bg.navigation.onCommitted(committed({ documentId: 'newtop' }));
    expect(await s.deliver(token, snapshot(2))).toMatchObject({ accepted: false });
    await s.bg.runtime.rtc.flush();
    expect((s.fake.session.data.get(RTC_STORAGE_KEY) as { documents: unknown[] }).documents).toEqual([]);
  });

  it('TTL is based on the last accepted update, not UI polling or repeated acknowledgements', async () => {
    const s = await setup(); const token = await s.ready(); await s.deliver(token);
    s.clock.t += RTC_IDLE_MS - 1000;
    expect(await s.get()).toMatchObject({ snapshot: snapshot() });
    expect(await s.deliver(token)).toMatchObject({ accepted: true });
    s.clock.t += 1000;
    expect(await s.get()).toMatchObject({ snapshot: null });
    await s.bg.runtime.rtc.flush();
    expect((s.fake.session.data.get(RTC_STORAGE_KEY) as { documents: unknown[] }).documents).toEqual([]);
  });

  it('retires early nested frame details on trusted ancestor replacement even before a sensor report exists', async () => {
    const s = await setup(true);
    s.fake.framesByTab.get(7)!.push({ ...frame('nested', 3, 'about:blank'), parentDocumentId: CHILD, parentFrameId: 2 });
    const token = await s.ready('nested', 3); await s.deliver(token, snapshot(), 'nested', 3);
    expect(s.bg.runtime.state.metas.has(key('nested', 3))).toBe(false);
    s.fake.framesByTab.set(7, [frame(), frame('replacement', 2)]);
    s.bg.navigation.onCommitted(committed({ documentId: 'replacement', frameId: 2, frameType: 'sub_frame', parentDocumentId: TOP, parentFrameId: 0 }));
    await s.bg.runtime.rtc.flush();
    expect((s.fake.session.data.get(RTC_STORAGE_KEY) as { documents: unknown[] }).documents).toEqual([]);
    expect(s.fake.sentToTabs.some(call => call.options?.documentId === 'nested' && (call.message as { type: string }).type === 'rtc-reset')).toBe(true);
  });

  it('rechecks browser identity after a storage await even without a delivered navigation notification', async () => {
    const s = await setup(); const token = await s.ready();
    const original = s.fake.session.set.bind(s.fake.session);
    let changed = false;
    s.fake.session.set = async items => {
      await original(items);
      if (RTC_STORAGE_KEY in items && !changed) { changed = true; s.fake.framesByTab.set(7, [frame('replacement')]); }
    };
    expect(await s.deliver(token)).toMatchObject({ accepted: false, reset: true });
    await s.bg.runtime.rtc.flush();
    expect((s.fake.session.data.get(RTC_STORAGE_KEY) as { documents: unknown[] }).documents).toEqual([]);
  });

  it('bounds pending authorization and drops a pre-clear upload after pause/resume', async () => {
    const s = await setup(); const token = await s.ready();
    const original = s.fake.webNavigation.getAllFrames;
    let release!: (frames: FrameDetailsLike[]) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    s.fake.webNavigation.getAllFrames = () => { entered(); return new Promise(resolve => { release = resolve; }); };
    const pending = s.deliver(token); await started;
    s.bg.runtime.dispatch({ type: 'ui:pause', documentKey: key(), at: s.clock.t });
    s.bg.runtime.dispatch({ type: 'ui:resume', documentKey: key(), at: s.clock.t });
    release([frame()]);
    expect(await pending).toMatchObject({ accepted: false, reset: true });
    s.fake.webNavigation.getAllFrames = original;
    expect(await s.get()).toMatchObject({ snapshot: null });
    const next = await s.ready(); expect(next).not.toBe(token);
    expect(await s.deliver(next)).toMatchObject({ accepted: true });
  });

  it('never acknowledges a snapshot before persistence and cannot resurrect data during delayed storage', async () => {
    const s = await setup(); const token = await s.ready();
    const original = s.fake.session.set.bind(s.fake.session);
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    s.fake.session.set = async items => {
      if (RTC_STORAGE_KEY in items && !release) { entered(); await new Promise<void>(resolve => { release = resolve; }); }
      await original(items);
    };
    let settled = false; const pending = s.deliver(token).then(value => { settled = true; return value; });
    await started; expect(settled).toBe(false);
    s.bg.runtime.rtc.clearDocument(key()); release();
    expect(await pending).toMatchObject({ accepted: false, reset: true });
    await s.bg.runtime.rtc.flush();
    expect((s.fake.session.data.get(RTC_STORAGE_KEY) as { documents: unknown[] }).documents).toEqual([]);
    expect(await s.get()).toMatchObject({ snapshot: null });
  });

  it('does not discard a different document upload when unrelated navigation invalidates an operation', async () => {
    const s = await setup(true); const token = await s.ready(); const child = await s.ready(CHILD, 2);
    await s.deliver(child, snapshot(), CHILD, 2);
    const original = s.fake.webNavigation.getAllFrames;
    let release!: (frames: FrameDetailsLike[]) => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    s.fake.webNavigation.getAllFrames = () => { entered(); return new Promise(resolve => { release = resolve; }); };
    const pending = s.deliver(token); await started;
    s.fake.webNavigation.getAllFrames = original;
    s.bg.navigation.onCommitted(committed({ documentId: 'newchild', frameId: 2, frameType: 'sub_frame', parentDocumentId: TOP, parentFrameId: 0 }));
    s.fake.framesByTab.set(7, [frame(), frame('newchild', 2)]); release([frame(), frame('newchild', 2)]);
    expect(await pending).toMatchObject({ accepted: true });
    expect(await s.get()).toMatchObject({ snapshot: snapshot() });
  });

  it('storage failures never produce accepted ACK and metadata capacity contributes to total budget', async () => {
    const s = await setup(); const token = await s.ready();
    const original = s.fake.session.set.bind(s.fake.session);
    s.fake.session.set = async items => { if (RTC_STORAGE_KEY in items) throw new Error('storage unavailable'); await original(items); };
    expect(await s.deliver(token)).toMatchObject({ code: 'invalid-request' });
    expect(await s.get()).toMatchObject({ snapshot: null });
    s.fake.session.set = original; await s.bg.runtime.rtc.flush();
    const next = await s.ready(); await s.deliver(next);
    expect(s.bg.runtime.diagnostics().estimatedBytes).toBeGreaterThan(JSON.stringify(snapshot()).length);
    s.fake.session.bytesInUseOverride = BUDGETS.maxSessionTotalBytes + 1;
    await s.bg.runtime.enforceTotalBudget(true);
    expect(await s.get()).toMatchObject({ snapshot: null });
    expect(s.bg.runtime.state.reports.has(key())).toBe(true);
  });

  it('session clear, scope revoke and tab removal persist purges and do not restore them on restart', async () => {
    for (const action of ['clear', 'scope', 'tab'] as const) {
      const s = await setup(); const token = await s.ready(); await s.deliver(token);
      if (action === 'clear') await s.bg.runtime.clearSession();
      if (action === 'scope') { s.fake.grantedOrigins.clear(); await s.bg.runtime.onPermissionsChanged(); }
      if (action === 'tab') { s.fake.framesByTab.delete(7); s.bg.runtime.dispatch({ type: 'tab:removed', tabId: 7, at: s.clock.t }); }
      await s.bg.runtime.rtc.flush();
      expect((s.fake.session.data.get(RTC_STORAGE_KEY) as { documents: unknown[] }).documents).toEqual([]);
      const resumed = await restart(s);
      const value = await resumed.get();
      expect(value.type === 'rtc-state' ? value.snapshot : null).toBeNull();
    }
  });

  it('rehydration refuses expired, replaced and malformed saved records instead of trusting stored ownership', async () => {
    for (const change of ['expired', 'replacement', 'extra-secret', 'bad-token'] as const) {
      const s = await setup(); const token = await s.ready(); await s.deliver(token);
      await s.bg.runtime.persistNow(key()); await s.bg.runtime.flushIndex(); await s.bg.runtime.rtc.flush(); s.bg.runtime.stop();
      const saved = s.fake.session.data.get(RTC_STORAGE_KEY) as { documents: Record<string, unknown>[] };
      if (change === 'expired') s.clock.t += RTC_IDLE_MS;
      if (change === 'replacement') s.fake.framesByTab.set(7, [frame('replacement')]);
      if (change === 'extra-secret') saved.documents[0]!['credential'] = 'CREDENTIAL_CANARY';
      if (change === 'bad-token') saved.documents[0]!['token'] = 'bad';
      const bg = createBackground(s.fake, { ttlIntervalMs: 0, clock: s.clock }); instances.push(bg); await bg.start();
      expect((s.fake.session.data.get(RTC_STORAGE_KEY) as { documents: unknown[] }).documents).toEqual([]);
      expect(JSON.stringify([...s.fake.session.data])).not.toContain('CREDENTIAL_CANARY');
    }
  });

  it('pre-ready page bursts cannot starve authorization of retained history during worker restart', async () => {
    const s = await setup(); const token = await s.ready(); await s.deliver(token);
    await s.bg.runtime.persistNow(key()); await s.bg.runtime.flushIndex(); await s.bg.runtime.rtc.flush(); s.bg.runtime.stop();
    const bg = createBackground(s.fake, { ttlIntervalMs: 0, clock: s.clock }); instances.push(bg);
    const waiting = Array.from({ length: RTC_MAX_PENDING }, (_, i) => route(bg.runtime,
      { schemaVersion: 1, type: 'rtc-ready' }, sender('preload' + i, i + 1)));
    await bg.start(); await Promise.all(waiting);
    expect(await route(bg.runtime, { schemaVersion: 1, type: 'ui-rtc-get', tabId: 7, documentKey: key() }, uiSender())).toMatchObject({ snapshot: snapshot() });
    expect((s.fake.session.data.get(RTC_STORAGE_KEY) as { documents: { token: string }[] }).documents[0]?.token).toBe(token);
  });

  it('policy acknowledgement waits for a persisted purge and reports storage failures honestly', async () => {
    const s = await setup(); const token = await s.ready(); await s.deliver(token);
    const original = s.fake.session.set.bind(s.fake.session);
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    s.fake.session.set = async items => {
      if (RTC_STORAGE_KEY in items && !release) { entered(); await new Promise<void>(resolve => { release = resolve; }); }
      await original(items);
    };
    let done = false;
    const pending = s.bg.runtime.pause(7, key(), s.bg.runtime.state.reports.get(key())!.revision).then(result => { done = true; return result; });
    await started; expect(done).toBe(false); release();
    expect(await pending).toMatchObject({ type: 'ok' });
    expect((s.fake.session.data.get(RTC_STORAGE_KEY) as { documents: unknown[] }).documents).toEqual([]);
    s.fake.session.set = async items => { if (RTC_STORAGE_KEY in items) throw new Error('unavailable'); await original(items); };
    await expect(s.bg.runtime.clearSession()).rejects.toThrow('unavailable');
    s.fake.session.set = original; await s.bg.runtime.rtc.flush();
  });

  it('bounds concurrent requests across documents and rate limits immediate floods', async () => {
    const s = await setup();
    const original = s.fake.webNavigation.getAllFrames;
    const releases: ((frames: FrameDetailsLike[]) => void)[] = [];
    s.fake.webNavigation.getAllFrames = () => new Promise(resolve => { releases.push(resolve); });
    const pending = Array.from({ length: RTC_MAX_PENDING }, (_, i) => s.send({ schemaVersion: 1, type: 'rtc-ready' }, sender('pending' + i, i)));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(await s.send({ schemaVersion: 1, type: 'rtc-ready' }, sender('overflow', 99))).toMatchObject({ accepted: false });
    s.bg.runtime.rtc.clear(); for (const release of releases) release([frame()]); await Promise.all(pending);
    s.fake.webNavigation.getAllFrames = original;
    const answers = [];
    for (let i = 0; i < 10; i++) answers.push(await s.send({ schemaVersion: 1, type: 'rtc-ready' }));
    expect(answers.some(answer => answer.type === 'rtc-ack' && !answer.accepted)).toBe(true);
  });
});
