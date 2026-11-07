// S07 / ADR-018: onBeforeRequest observer — filter feature detection, request classes, permission matrix per scope
// mode (ws/wss as http/https, active-tab by documentId), and redaction: the dispatched event never carries a path,
// query, port, IP literal or DNS label.
import { describe, expect, it } from 'vitest';
import { NETWORK_RESOURCE_TYPES, buildNetworkFilter, classifyRequest, createBackground, redactNetworkTarget } from '../src/index';
import type { Background, DocumentEvent, RequestDetailsLike } from '../src/index';
import { committed, createFakeChrome, settle, uiSender } from './fake-chrome';
import type { FakeChrome } from './fake-chrome';

const D1 = 'DOC000000000000000000000000000001';
const KEY1 = '7:0:' + D1;
const SALT = 'ffeeddccbbaa99887766554433221100';

function details(over: Partial<RequestDetailsLike> = {}): RequestDetailsLike {
  return { tabId: 7, frameId: 0, documentId: D1, parentFrameId: -1, type: 'xmlhttprequest', timeStamp: 1, initiator: 'https://example.com', url: 'https://cdn.vendor.net/collect?id=1', ...over };
}

async function setup(grants: string[], scope: 'site' | 'all-sites' | 'off' = 'site'): Promise<{ fake: FakeChrome; bg: Background; events: DocumentEvent[] }> {
  const fake = createFakeChrome({ grantedOrigins: grants });
  fake.local.data.set('scope', { v: 1, scopeMode: scope, hosts: ['example.com'] });
  const bg = createBackground(fake, { ttlIntervalMs: 0, persistDebounceMs: 1, networkSalt: SALT });
  await bg.start();
  bg.navigation.onCommitted(committed());
  const events: DocumentEvent[] = [];
  const dispatch = bg.runtime.dispatch.bind(bg.runtime);
  bg.runtime.dispatch = (event: DocumentEvent): void => {
    events.push(event);
    dispatch(event);
  };
  return { fake, bg, events };
}

function counts(bg: Background): Array<[string, number]> {
  return (bg.runtime.state.reports.get(KEY1)?.networkCounters ?? []).map((c) => [c.techniqueId, c.count]);
}

describe('filter and request classes', () => {
  it('has the ten base types; webtransport only when the browser enum lists it', () => {
    expect(buildNetworkFilter().types).toEqual([...NETWORK_RESOURCE_TYPES]);
    expect(NETWORK_RESOURCE_TYPES).toHaveLength(10);
    expect(buildNetworkFilter({ SCRIPT: 'script', WEBSOCKET: 'websocket' }).types).not.toContain('webtransport');
    expect(buildNetworkFilter({ WEBTRANSPORT: 'webtransport' }).types).toEqual([...NETWORK_RESOURCE_TYPES, 'webtransport']);
    expect(buildNetworkFilter(['webtransport']).types.at(-1)).toBe('webtransport');
    expect(buildNetworkFilter(null).urls).toEqual(['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']);
    expect(buildNetworkFilter().types).not.toContain('main_frame');
  });

  it.each([
    ['websocket', 'socket'], ['webtransport', 'socket'], ['xmlhttprequest', 'xhr'], ['ping', 'beacon'], ['sub_frame', 'frame'],
    ['script', 'subresource'], ['image', 'subresource'], ['media', 'subresource'], ['font', 'subresource'], ['stylesheet', 'subresource'], ['other', 'subresource'],
  ])('classifyRequest(%s) -> %s', (type, cls) => expect(classifyRequest(type)).toBe(cls));
});

describe('permission matrix per scope mode', () => {
  it('site: target AND initiator grants; ws/wss are checked as http/https', async () => {
    const { bg } = await setup(['https://example.com/*', 'http://rt.vendor.net/*', 'https://cdn.vendor.net/*']);
    bg.network.onBeforeRequest(details({ type: 'websocket', url: 'ws://rt.vendor.net/socket' }));
    bg.network.onBeforeRequest(details({ type: 'websocket', url: 'wss://rt.vendor.net/socket' })); // https not granted
    bg.network.onBeforeRequest(details({ type: 'xmlhttprequest' }));
    bg.network.onBeforeRequest(details({ type: 'xmlhttprequest', initiator: 'https://other.example' })); // initiator not granted
    bg.network.onBeforeRequest(details({ type: 'xmlhttprequest', initiator: undefined })); // no initiator
    expect(counts(bg)).toEqual([['DET-058', 1], ['DET-059', 1]]);
    expect(bg.runtime.state.reports.get(KEY1)?.hosts.map((h) => [h.registrableDomain, h.relation, h.requestCount])).toEqual([
      ['vendor.net', 'cross-site', 2],
    ]);
    bg.runtime.stop();
  });

  it('off: nothing is observed even with retained grants', async () => {
    const { bg, events } = await setup(['http://*/*', 'https://*/*'], 'off');
    bg.network.onBeforeRequest(details());
    expect(events).toEqual([]);
    bg.runtime.stop();
  });

  it('active-tab: only the captured document of the tab (documentId), no host grants needed', async () => {
    const fake = createFakeChrome();
    fake.framesByTab.set(7, [committed()]);
    const bg = createBackground(fake, { ttlIntervalMs: 0, networkSalt: SALT });
    await bg.start();
    bg.navigation.onCommitted(committed());
    await new Promise<unknown>((resolve) => { bg.onMessage({ schemaVersion: 1, type: 'ui-inject-now', tabId: 7 }, uiSender(), resolve); });
    expect(bg.runtime.scope.networkRequestAllowed(7, D1, 'cdn.vendor.net', 'https', 'example.com', 'https')).toBe(true);
    expect(bg.runtime.scope.networkRequestAllowed(7, 'OTHER', 'cdn.vendor.net', 'https', 'example.com', 'https')).toBe(false);
    expect(bg.runtime.scope.networkRequestAllowed(8, D1, 'cdn.vendor.net', 'https', 'example.com', 'https')).toBe(false);
    expect(bg.runtime.scope.networkRequestAllowed(7, D1, 'cdn.vendor.net', null, 'example.com', 'https')).toBe(false);
    bg.network.onBeforeRequest(details());
    bg.network.onBeforeRequest(details({ frameId: 4, documentId: 'CHILD' }));
    expect(counts(bg)).toEqual([['DET-059', 1]]);
    expect(bg.runtime.state.reports.get(KEY1)?.coverageFlags).toContain('network-limited');
    bg.runtime.stop();
  });

  it('paused documents and tabId -1 requests add nothing but an unattributed count', async () => {
    const { bg, events } = await setup(['http://*/*', 'https://*/*'], 'all-sites');
    bg.network.onBeforeRequest(details({ tabId: -1, documentId: undefined }));
    expect(bg.runtime.state.unattributed.requests).toBe(1);
    const report = bg.runtime.state.reports.get(KEY1)!;
    await new Promise<unknown>((resolve) => { bg.onMessage({ schemaVersion: 1, type: 'ui-pause', tabId: 7, documentKey: KEY1, reportRevision: report.revision }, uiSender(), resolve); });
    bg.network.onBeforeRequest(details());
    expect(events).toEqual([]);
    expect(counts(bg)).toEqual([]);
    bg.runtime.stop();
  });
});

describe('redaction: the dispatched event and the report carry enums and counts only', () => {
  it('local probes from a public page: ports/targets counts, no IP, port or path', async () => {
    const { bg, events } = await setup(['http://*/*', 'https://*/*'], 'all-sites');
    for (let p = 45123; p <= 45126; p++) bg.network.onBeforeRequest(details({ type: 'image', url: 'http://192.168.77.213:' + String(p) + '/probe.png?q=CANARY-QUERY-7a1c9e3f' }));
    bg.network.onBeforeRequest(details({ type: 'websocket', url: 'ws://[fd12::1]:45127/x' }));
    expect(events.at(-2)).toMatchObject({ category: 'private', local: { fromPublic: true, ports: 4, targets: 1 } });
    expect(events.at(-1)).toMatchObject({ category: 'ULA', requestClass: 'socket', local: { fromPublic: true, ports: 1, targets: 2 } });
    const text = JSON.stringify(events) + JSON.stringify([...bg.runtime.state.reports.values()]);
    expect(text).not.toMatch(/192\.168|fd12|4512[3-7]|CANARY|probe|\/x/);
    const report = bg.runtime.state.reports.get(KEY1)!;
    expect(report.networkPatterns).toEqual({ localPortsMax: 4, localTargetsMax: 2, randomSubdomainsMax: 0 });
    expect(counts(bg)).toEqual([['DET-058', 1], ['DET-060', 5]]);
    bg.runtime.stop();
  });

  it('local requests from a local page count DET-060 without window patterns', async () => {
    const { bg, events } = await setup(['http://*/*', 'https://*/*'], 'all-sites');
    bg.network.onBeforeRequest(details({ initiator: 'http://127.0.0.1:4173', url: 'http://127.0.0.1:4174/api' }));
    expect(events[0]).toMatchObject({ category: 'loopback', local: { fromPublic: false, ports: 0, targets: 0 } });
    expect(bg.runtime.state.reports.get(KEY1)?.networkPatterns).toEqual({ localPortsMax: 0, localTargetsMax: 0, randomSubdomainsMax: 0 });
    expect(bg.runtime.networkWindows.size).toBe(0);
    bg.runtime.stop();
  });

  it('random-looking subdomains: DET-061 counts and the window maximum; labels never leave the callback', async () => {
    const { bg, events } = await setup(['http://*/*', 'https://*/*'], 'all-sites');
    const labels = Array.from({ length: 10 }, (_, i) => 'p' + String(i) + 'k9x2q8w1z7m4n6b5v0');
    for (const label of labels) bg.network.onBeforeRequest(details({ type: 'image', url: 'https://' + label + '.dns.example.com/p.gif' }));
    bg.network.onBeforeRequest(details({ type: 'image', url: 'https://img1.example.com/p.gif' })); // not random
    expect(events.map((e) => (e.type === 'network:host' ? e.randomSubdomains : null)).slice(0, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(events.at(-1)).not.toHaveProperty('randomSubdomains');
    const text = JSON.stringify(events) + JSON.stringify([...bg.runtime.state.reports.values()]);
    for (const label of labels) expect(text).not.toContain(label);
    expect(text).not.toMatch(/dns\.example|img1|p\.gif/);
    expect(bg.runtime.state.reports.get(KEY1)?.networkPatterns.randomSubdomainsMax).toBe(10);
    expect(counts(bg)).toEqual([['DET-061', 10]]);
    expect(bg.runtime.state.reports.get(KEY1)?.hosts).toEqual([
      { registrableDomain: 'example.com', relation: 'same-site', evidenceSource: 'browser-network', integrity: 'browser-observed', requestCount: 11, firstSeenBucket: 0, lastSeenBucket: 0, ruleIds: [] },
    ]);
    bg.runtime.stop();
  });

  it('PT-2: a random label directly under a PSL PRIVATE suffix is folded into unknown, never stored, and counted for DET-061', async () => {
    const { bg, events } = await setup(['http://*/*', 'https://*/*'], 'all-sites');
    // Precondition: the offline PSL makes these labels registrable domains (PRIVATE section, ADR-008).
    expect(redactNetworkTarget('p0k9x2q8w1z7m4n6b5v0.ngrok-free.app')).toEqual({ redacted: { kind: 'unknown' }, randomSuffix: 'ngrok-free.app' });
    expect(redactNetworkTarget('my-app.workers.dev')).toEqual({ redacted: { kind: 'registrable', value: 'my-app.workers.dev' }, randomSuffix: null });
    expect(redactNetworkTarget('cdn.vendor.net')).toEqual({ redacted: { kind: 'registrable', value: 'vendor.net' }, randomSuffix: null });
    const labels = Array.from({ length: 9 }, (_, i) => 'p' + String(i) + 'k9x2q8w1z7m4n6b5v0');
    for (const label of labels) bg.network.onBeforeRequest(details({ url: 'https://' + label + '.ngrok-free.app/collect' }));
    bg.network.onBeforeRequest(details({ url: 'https://' + labels[0] + '.ngrok-free.app/again' })); // same host again
    bg.network.onBeforeRequest(details({ url: 'https://my-app.workers.dev/api' })); // a readable tenant name is kept
    const hostEvents = events.filter((e) => e.type === 'network:host');
    expect(hostEvents.slice(0, 10).map((e) => (e.type === 'network:host' ? [e.host, e.category, e.randomSubdomains] : null))).toEqual([
      ...labels.map((_, i) => ['', 'unknown', i + 1]),
      ['', 'unknown', 9],
    ]);
    const text = JSON.stringify(events) + JSON.stringify([...bg.runtime.state.reports.values()]);
    for (const label of labels) expect(text).not.toContain(label);
    expect(text).not.toContain('ngrok-free.app'); // the suffix only keys the ephemeral window
    const report = bg.runtime.state.reports.get(KEY1)!;
    expect(report.hosts.map((h) => [h.registrableDomain ?? null, h.category ?? null, h.requestCount])).toEqual([
      [null, 'unknown', 10],
      ['my-app.workers.dev', null, 1],
    ]);
    expect(report.networkPatterns.randomSubdomainsMax).toBe(9);
    // DET-061 counts requests to random labels (10, the repeat included); the pattern uses the distinct maximum (9).
    expect(counts(bg)).toEqual([['DET-059', 11], ['DET-061', 10]]);
    bg.runtime.stop();
  });

  it('events that wake the worker before hydration are deferred (bounded) and then pass every check', async () => {
    const fake = createFakeChrome({ grantedOrigins: ['http://*/*', 'https://*/*'] });
    fake.local.data.set('scope', { v: 1, scopeMode: 'all-sites', hosts: [] });
    fake.tabList = [{ id: 7 }];
    fake.framesByTab.set(7, [committed()]);
    const bg = createBackground(fake, { ttlIntervalMs: 0, networkSalt: SALT });
    bg.network.onBeforeRequest(details());
    expect(bg.runtime.ready).toBe(false);
    await bg.start();
    await settle();
    expect(counts(bg)).toEqual([['DET-059', 1]]);
    bg.runtime.stop();
  });
});

describe('I1: DET-060 only for local targets cross-origin to the requesting document (ADR-018)', () => {
  it('a page on a local address loading its own resources (script, favicon, HMR socket) is not DET-060', async () => {
    const { bg, events } = await setup(['http://*/*', 'https://*/*'], 'all-sites');
    const page = 'http://127.0.0.1:4173';
    bg.network.onBeforeRequest(details({ type: 'script', initiator: page, url: page + '/fixture-lib.js' }));
    bg.network.onBeforeRequest(details({ type: 'image', initiator: page, url: page + '/favicon.ico' }));
    bg.network.onBeforeRequest(details({ type: 'websocket', initiator: page, url: 'ws://127.0.0.1:4173/hmr' })); // ws compares as http
    bg.network.onBeforeRequest(details({ type: 'image', initiator: 'http://192.168.1.10', url: 'http://192.168.1.10:80/x.png' })); // default port
    bg.network.onBeforeRequest(details({ type: 'image', initiator: 'https://[fd12::1]', url: 'https://[FD12::1]:443/y.png' })); // WHATWG host
    expect(events.filter((e) => e.type === 'network:host' && e.local !== undefined)).toEqual([]);
    expect(counts(bg)).toEqual([['DET-058', 1]]);
    // The requests still appear as hosts (categories only), so the Sources tab stays honest.
    expect(bg.runtime.state.reports.get(KEY1)?.hosts.map((h) => [h.category, h.requestCount])).toEqual(
      expect.arrayContaining([['loopback', 3], ['private', 1], ['ULA', 1]]),
    );
    bg.runtime.stop();
  });

  it('a different port, scheme or local host than the page is still a local-address attempt (api-use, no window from a local page)', async () => {
    const { bg, events } = await setup(['http://*/*', 'https://*/*'], 'all-sites');
    bg.network.onBeforeRequest(details({ initiator: 'http://127.0.0.1:4173', url: 'http://127.0.0.1:4174/api' })); // other port
    bg.network.onBeforeRequest(details({ initiator: 'https://127.0.0.1:8443', url: 'http://127.0.0.1:8443/api' })); // other scheme
    bg.network.onBeforeRequest(details({ initiator: 'http://127.0.0.1:4173', url: 'http://192.168.1.10:4173/api' })); // other host
    expect(events.map((e) => (e.type === 'network:host' ? e.local : null))).toEqual([
      { fromPublic: false, ports: 0, targets: 0 }, { fromPublic: false, ports: 0, targets: 0 }, { fromPublic: false, ports: 0, targets: 0 },
    ]);
    expect(counts(bg)).toEqual([['DET-059', 3], ['DET-060', 3]]);
    expect(bg.runtime.networkWindows.size).toBe(0);
    bg.runtime.stop();
  });
});

describe('I1: a request whose document is unknown is an explicit gap (docs/PROJECT_RULES.md #9/#11)', () => {
  const D2 = 'DOC000000000000000000000000000002';

  it('no binding and no report (commit race, unknown after hydration): unattributed.requests, nothing dispatched', async () => {
    const { bg, events } = await setup(['http://*/*', 'https://*/*'], 'all-sites');
    bg.network.onBeforeRequest(details({ documentId: 'DOC0000000000000000000000000000FF' }));
    bg.network.onBeforeRequest(details({ type: 'sub_frame', frameId: 3, documentId: 'CHILD', parentFrameId: 0, parentDocumentId: 'DOC0000000000000000000000000000FE' }));
    expect(events).toEqual([]);
    expect(bg.runtime.state.unattributed.requests).toBe(2);
    expect(bg.runtime.networkDocumentLookup(7, 0, 'DOC0000000000000000000000000000FF')).toEqual({ kind: 'unbound' });
    bg.runtime.stop();
  });

  it('a document whose binding moved on keeps its own requests (keepalive beacon after the next commit); paused stays excluded', async () => {
    const { bg } = await setup(['http://*/*', 'https://*/*'], 'all-sites');
    bg.network.onBeforeRequest(details());
    bg.navigation.onCommitted(committed({ documentId: D2, url: 'https://example.com/next' }));
    expect(bg.runtime.networkDocumentLookup(7, 0, D1)).toEqual({ kind: 'document', key: KEY1 });
    bg.network.onBeforeRequest(details({ type: 'ping', url: 'https://cdn.vendor.net/beacon' }));
    expect(counts(bg)).toEqual([['DET-059', 2]]);
    expect(bg.runtime.state.unattributed.requests).toBe(0);
    const report = bg.runtime.state.reports.get(KEY1)!;
    await new Promise<unknown>((resolve) => { bg.onMessage({ schemaVersion: 1, type: 'ui-pause', tabId: 7, documentKey: KEY1, reportRevision: report.revision }, uiSender(), resolve); });
    expect(bg.runtime.networkDocumentLookup(7, 0, D1)).toEqual({ kind: 'excluded' });
    bg.network.onBeforeRequest(details({ type: 'ping', url: 'https://cdn.vendor.net/beacon2' }));
    expect(counts(bg)).toEqual([['DET-059', 2]]);
    expect(bg.runtime.state.unattributed.requests).toBe(0);
    bg.runtime.stop();
  });
});
