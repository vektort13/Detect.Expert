import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ThirdPartyObserver, startThirdPartyTimingBridge } from '../../apps/production-extension/third-party-observer.js';
import { readThirdPartyRequest, readThirdPartySnapshot, readThirdPartyRows, thirdPartyPathTemplate, THIRD_PARTY_RESOURCE_TYPES } from '../../packages/contracts/src/third-party.mjs';

const rootKey = '7:0:root', childKey = '7:3:child';
const request = { schemaVersion: 1, type: 'ui-get-third-party', tabId: 7, frameId: 0, documentKey: rootKey };
const root = { tabId: 7, frameId: 0, documentId: 'root', documentKey: rootKey, host: 'example.com', parentDocumentId: null, documentLifecycle: 'active' };
const child = { tabId: 7, frameId: 3, documentId: 'child', documentKey: childKey, host: 'foreign.org', parentDocumentId: 'root', documentLifecycle: 'active' };
const helpers = {
  host: raw => { try { return new URL(raw).hostname; } catch { return null; } },
  redact: host => typeof host === 'string' && !host.endsWith('.invalid') && host.includes('.') ? { kind: 'registrable', value: host.split('.').slice(-2).join('.') } : { kind: 'unknown' },
};
const timing = (rows = [{ domain: 'example.net', pathTemplate: '/:resource.js', type: 'script', requestCount: 2 }]) => ({ schemaVersion: 1, type: 'third-party-timing-cache', available: true, rows, truncated: false });
function fixture(firefox = false, children = true) {
  let now = 1700000000000, allowed = true, authorized = true;
  const bindings = new Map([['7:0', { ...root }], ...(children ? [['7:3', { ...child }]] : [])]);
  const runtime = { isReady: true, now: () => now, whenReady: async () => {}, scope: { hasDataConsent: true, accessReady: true, accessGeneration: 1, hasAnyHostAccess: () => true, isHostGrantedSync: () => true },
    state: { bindings, tabs: new Map([[7, { activeTopDocumentKey: rootKey }]]) },
    canObserveNetworkDocument: key => allowed && runtime.scope.hasDataConsent && runtime.state.bindings.get(key.slice(0, key.lastIndexOf(':')))?.documentKey === key,
    getProjection: () => ({ documentKey: runtime.state.tabs.get(7).activeTopDocumentKey }),
    apiResults: { authorize: async () => authorized },
    api: { ...(firefox ? { __detectExpertCapabilities: { networkDocumentIdentity: false } } : {}), webNavigation: { getAllFrames: async () => [...runtime.state.bindings.values()].map(binding => ({ ...binding, url: 'https://' + binding.host + '/' })) },
      tabs: { sendMessage: async (_tab, message) => message.type === 'third-party-timing-reset' ? { schemaVersion: 1, type: 'third-party-timing-reset-ack' } : timing() } } };
  return { runtime, observer: new ThirdPartyObserver(runtime, helpers), tick: delta => { now += delta; }, allow: value => { allowed = value; }, auth: value => { authorized = value; } };
}
const network = overrides => ({ tabId: 7, frameId: 0, documentId: 'root', requestId: 'request-1', documentLifecycle: 'active', type: 'script', url: 'https://random.private.example.net/customer/ACCOUNT_CANARY.js?token=URL_CANARY', initiator: 'https://private.example.com/path?secret=INITIATOR_CANARY', statusCode: 200, ...overrides });
const row = (overrides = {}) => ({ domain: 'example.net', pathTemplate: '/:resource.js', type: 'script', relation: 'cross-site', requestCount: 1, completedCount: 1, failedCount: 0, redirectCount: 0, statusCodes: [200], documentKey: rootKey, documentHost: 'example.com', initiatorHost: 'example.com', evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'frame-only', script: null, ...overrides });
test('third-party request, root snapshot and canonical copy have exact privileged shapes', () => {
  assert.deepEqual(readThirdPartyRequest(request), request);
  for (const change of [{ tabId: 8 }, { frameId: 3 }, { documentKey: childKey }, { type: 'sensor-events' }, { url: 'https://other.com/' }]) assert.equal(readThirdPartyRequest({ ...request, ...change }), null);
  const snapshot = { schemaVersion: 1, type: 'third-party-state', documentKey: rootKey, coverageState: 'partial', rows: [row()], truncated: false };
  assert.ok(readThirdPartySnapshot(snapshot));
  assert.equal(readThirdPartySnapshot({ ...snapshot, documentKey: childKey }), null);
  assert.equal(readThirdPartySnapshot({ ...snapshot, coverageState: 'no-access' }), null);
  assert.equal(readFileSync(new URL('../../apps/production-extension/third-party-contracts.js', import.meta.url), 'utf8'), readFileSync(new URL('../../packages/contracts/src/third-party.mjs', import.meta.url), 'utf8'));
});
test('third-party projection rejects secret fields, unsafe paths, mixed sources and hostile getters', () => {
  for (const change of [{ pathTemplate: '/user/ACCOUNT_CANARY' }, { query: 'SECRET' }, { requestBody: 'SECRET' }, { script: { host: 'example.com', pathTemplate: '/sdk.js' } }, { evidenceSource: 'page-dom' }, { statusCodes: [99] }]) assert.equal(readThirdPartyRows([row(change)]), null);
  const page = row({ pathTemplate: '/static/:resource.js', evidenceSource: 'page-dom', integrity: 'page-controlled', completedCount: 0, statusCodes: [] });
  assert.ok(readThirdPartyRows([page])); assert.equal(readThirdPartyRows([row(), page]), null);
  let getters = 0; const hostile = row(); Object.defineProperty(hostile, 'domain', { enumerable: true, get() { ++getters; throw Error('getter'); } });
  assert.equal(readThirdPartyRows([hostile]), null); assert.equal(getters, 0);
  assert.equal(thirdPartyPathTemplate('/customer/ACCOUNT_CANARY.js'), '/:segment/:resource.js');
});
test('native inventory observes all allowed resource types and redacts URL/source metadata', () => {
  const f = fixture(false, false); let secretReads = 0;
  for (const [index, type] of THIRD_PARTY_RESOURCE_TYPES.entries()) {
    const details = network({ type, requestId: 'request-' + index });
    for (const key of ['requestBody', 'requestHeaders', 'responseHeaders']) Object.defineProperty(details, key, { get() { ++secretReads; throw Error('secret'); } });
    f.observer.observe(details, 'before'); f.observer.observe(details, 'completed');
  }
  const snapshot = f.observer.snapshot(rootKey);
  assert.equal(snapshot.rows.length, THIRD_PARTY_RESOURCE_TYPES.length); assert.equal(secretReads, 0);
  assert.ok(snapshot.rows.every(row => row.requestCount === 1 && row.completedCount === 1 && row.script === null));
  assert.doesNotMatch(JSON.stringify(snapshot), /URL_CANARY|ACCOUNT_CANARY|INITIATOR_CANARY|random\.private|requestBody|requestHeaders/);
});
test('native child resources are classified against current top, not child initiator', () => {
  const f = fixture();
  f.observer.observe(network({ frameId: 3, documentId: 'child', type: 'image', url: 'https://foreign.org/pixel', initiator: 'https://foreign.org/' }));
  f.observer.observe(network({ requestId: 'frame', type: 'sub_frame', frameId: 3, documentId: 'child', parentFrameId: 0, parentDocumentId: 'root', url: 'https://foreign.org/embed' }));
  f.observer.observe(network({ requestId: 'own-child', frameId: 3, documentId: 'child', url: 'https://assets.example.com/own.js', initiator: 'https://foreign.org/' }));
  const result = f.observer.snapshot(rootKey);
  assert.equal(result.rows.length, 2); assert.equal(result.rows[0].documentKey, rootKey); // root frame comes first
  const childRow = result.rows.find(row => row.documentKey === childKey);
  assert.equal(childRow.relation, 'cross-site'); assert.equal(childRow.documentHost, 'foreign.org');
});
test('native identities, grant state, lifecycle and foreign-tab sources fail closed', () => {
  for (const overrides of [{ documentId: undefined }, { documentId: 'bad:id' }, { frameId: -1 }, { tabId: -1 }, { tabId: 8 }, { documentLifecycle: 'cached' }, { type: 'main_frame' }, { initiator: 'data:unknown' }]) {
    const f = fixture(); f.observer.observe(network(overrides)); assert.equal(f.observer.snapshot(rootKey).rows.length, 0);
  }
  for (const condition of ['ready', 'consent', 'access', 'grant', 'document']) {
    const f = fixture();
    if (condition === 'ready') f.runtime.isReady = false;
    if (condition === 'consent') f.runtime.scope.hasDataConsent = false;
    if (condition === 'access') f.runtime.scope.accessReady = false;
    if (condition === 'grant') f.runtime.scope.isHostGrantedSync = () => false;
    if (condition === 'document') f.allow(false);
    f.observer.observe(network()); assert.equal(f.observer.snapshot(rootKey).rows.length, 0);
  }
});
test('native missing initiator retains authorized resource with unknown source, denied origin does not', () => {
  const f = fixture(false, false);
  f.observer.observe(network({ initiator: undefined }));
  const row = f.observer.snapshot(rootKey).rows[0];
  assert.equal(row.initiatorHost, null); assert.equal(row.attributionConfidence, 'unknown');
  const denied = fixture(); denied.runtime.scope.isHostGrantedSync = host => host !== 'denied.org';
  denied.observer.observe(network({ initiator: 'https://denied.org/' }));
  assert.deepEqual(denied.observer.snapshot(rootKey).rows, []);
});
test('redirect/error/completed counts preserve actual attempts without terminal overflow duplication', () => {
  const f = fixture(false, false);
  f.observer.observe(network(), 'before'); f.observer.observe(network(), 'before');
  f.observer.observe(network({ statusCode: 302 }), 'redirect');
  f.observer.observe(network({ url: 'https://example.net/redirect' }), 'before');
  f.observer.observe(network({ url: 'https://example.net/redirect', statusCode: 404 }), 'completed');
  f.observer.observe(network({ requestId: 'error' }), 'before'); f.observer.observe(network({ requestId: 'error' }), 'error');
  const rows = f.observer.snapshot(rootKey).rows;
  assert.equal(rows.reduce((n, row) => n + row.requestCount, 0), 3);
  assert.equal(rows.reduce((n, row) => n + row.redirectCount, 0), 1);
  assert.equal(rows.reduce((n, row) => n + row.completedCount, 0), 1);
  assert.equal(rows.reduce((n, row) => n + row.failedCount, 0), 1);
  for (let i = 0; i < 515; ++i) f.observer.observe(network({ requestId: 'overflow-' + i }), 'before');
  const before = f.observer.snapshot(rootKey).rows.reduce((n, row) => n + row.requestCount, 0);
  f.observer.observe(network({ requestId: 'overflow-514' }), 'completed');
  assert.equal(f.observer.snapshot(rootKey).rows.reduce((n, row) => n + row.requestCount, 0), before);
  assert.ok(f.observer.pending.size <= 512); assert.equal(f.observer.snapshot(rootKey).truncated, true);
});
test('native read uses browser rows only and does not request duplicate timing copies', async () => {
  const f = fixture(false, false); f.observer.observe(network());
  f.runtime.api.tabs.sendMessage = async () => { throw Error('unexpected timing'); };
  const result = await f.observer.read(request);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].evidenceSource, 'browser-network');
});
test('Firefox excludes unowned browser events and returns current trusted timing per document', async () => {
  const f = fixture(true); f.observer.observe(network()); assert.deepEqual(f.observer.snapshot(rootKey).rows, []);
  let sends = 0;
  f.runtime.api.tabs.sendMessage = async (tab, message, options) => {
    ++sends; assert.equal(tab, 7); assert.equal(message.type, 'third-party-timing-query');
    assert.ok(['root', 'child'].includes(options.documentId)); return timing();
  };
  const result = await f.observer.read(request);
  assert.equal(sends, 2); assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every(row => row.evidenceSource === 'page-dom' && row.completedCount === 0 && row.statusCodes.length === 0));
});
test('authorized timing recovers a Chrome worker restart, remains sticky and never adds native counts', async () => {
  const f = fixture(false, false);
  const first = await f.observer.read(request), second = await f.observer.read(request);
  assert.equal(first.rows[0].requestCount, 2); assert.equal(second.rows[0].requestCount, 2);
  f.observer.observe(network({ requestId: 'new-pixel' }));
  assert.equal(f.observer.snapshot(rootKey).rows[0].evidenceSource, 'page-dom');
  assert.equal(f.observer.snapshot(rootKey).rows[0].requestCount, 2);
});
test('an early empty or first-party-only timing poll leaves Chrome native capture eligible', async () => {
  for (const cache of [timing([]), timing([{ domain: 'example.com', pathTemplate: '/main.js', type: 'script', requestCount: 5 }])]) {
    const f = fixture(false, false); f.runtime.api.tabs.sendMessage = async () => cache;
    assert.deepEqual((await f.observer.read(request)).rows, []);
    assert.deepEqual((await f.observer.read(request)).rows, []);
    assert.equal(f.observer.documents.has(rootKey), false);
    f.observer.observe(network(), 'before'); f.observer.observe(network(), 'completed');
    const result = await f.observer.read(request);
    assert.equal(result.rows.length, 1); assert.equal(result.rows[0].evidenceSource, 'browser-network');
    assert.equal(result.rows[0].requestCount, 1); assert.equal(result.rows[0].completedCount, 1);
    assert.deepEqual(result.rows[0].statusCodes, [200]);
  }
});
test('unknown-only timing at an IP/private root stays visible and yields to authoritative native capture', async () => {
  const f = fixture(false, false);
  f.runtime.state.bindings = new Map([['7:0', { ...root, host: null }]]);
  f.runtime.api.tabs.sendMessage = async () => timing([{ domain: 'unknown.invalid', pathTemplate: '/:resource.js', type: 'script', requestCount: 3 }]);
  const recovered = await f.observer.read(request);
  assert.equal(recovered.rows.length, 1); assert.equal(recovered.rows[0].evidenceSource, 'page-dom'); assert.equal(recovered.rows[0].relation, 'unknown');
  f.observer.observe(network(), 'before'); f.observer.observe(network(), 'completed');
  const result = await f.observer.read(request);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].evidenceSource, 'browser-network');
  assert.equal(result.rows[0].requestCount, 1); assert.equal(result.rows[0].completedCount, 1);
  assert.deepEqual(result.rows[0].statusCodes, [200]);
});
test('an authoritative native event during timing read takes precedence over delayed buffer reply', async () => {
  const f = fixture(false, false);
  f.runtime.api.tabs.sendMessage = async () => { f.observer.observe(network()); return timing(); };
  const result = await f.observer.read(request);
  assert.equal(result.rows[0].evidenceSource, 'browser-network'); assert.equal(result.rows[0].requestCount, 1);
});
test('a failing timing read cannot erase authoritative events admitted while it was pending', async () => {
  const f = fixture(false, false);
  f.runtime.api.tabs.sendMessage = async () => { f.observer.observe(network()); throw Error('missing bridge'); };
  const result = await f.observer.read(request);
  assert.equal(result.rows[0].evidenceSource, 'browser-network'); assert.equal(result.rows[0].requestCount, 1); assert.equal(result.truncated, true);
});
test('root permission, epoch and identity races return no stale rows', async () => {
  for (const mutate of [f => f.runtime.scope.accessGeneration++, f => f.allow(false), f => f.runtime.scope.hasDataConsent = false, f => f.observer.clear(), f => f.runtime.state.tabs.set(7, { activeTopDocumentKey: '7:0:new' })]) {
    const f = fixture(true, false); f.runtime.api.tabs.sendMessage = async () => { mutate(f); return timing(); };
    const result = await f.observer.read(request); assert.equal(result.coverageState, 'no-access'); assert.deepEqual(result.rows, []);
  }
  const f = fixture(); f.observer.observe(network()); f.auth(false); assert.deepEqual((await f.observer.read(request)).rows, []);
});
test('child frame replacement during a timing query cannot relabel the new document as the old one', async () => {
  const f = fixture(true);
  let replaced = false;
  f.runtime.api.tabs.sendMessage = async (_tab, _message, options) => { if (options.frameId === 3) replaced = true; return timing(); };
  f.runtime.api.webNavigation.getAllFrames = async () => [{ ...root }, { ...child, ...(replaced ? { documentId: 'replaced' } : {}) }];
  const result = await f.observer.read(request);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].documentKey, rootKey); assert.equal(result.truncated, true);
});
test('current root can only aggregate current attached descendants and row/document bounds are explicit', () => {
  const f = fixture(false, false);
  for (let i = 1; i <= 26; ++i) {
    const binding = { ...child, frameId: i, documentId: 'child-' + i, documentKey: '7:' + i + ':child-' + i };
    f.runtime.state.bindings = new Map(f.runtime.state.bindings).set('7:' + i, binding);
    f.observer.observe(network({ frameId: i, documentId: binding.documentId, requestId: 'child-' + i }));
  }
  assert.equal(f.observer.snapshot(rootKey).truncated, true);
  assert.ok(f.observer.snapshot(rootKey).rows.length <= 24);
  const key = f.runtime.state.bindings.get('7:1').documentKey;
  f.runtime.state.bindings = new Map(f.runtime.state.bindings); f.runtime.state.bindings.delete('7:1');
  assert.equal(f.observer.snapshot(rootKey).rows.some(row => row.documentKey === key), false);
  f.tick(600000); assert.deepEqual(f.observer.snapshot(rootKey).rows, []);
});
test('clear root resets timing on all current source documents before future trusted reads', async () => {
  const f = fixture(true); await f.observer.read(request); f.observer.forget(rootKey);
  const resets = [];
  f.runtime.api.tabs.sendMessage = async (_tab, message, options) => { if (message.type === 'third-party-timing-reset') { resets.push(options.documentId); return { schemaVersion: 1, type: 'third-party-timing-reset-ack' }; } return timing([]); };
  assert.deepEqual((await f.observer.read(request)).rows, []); assert.deepEqual(resets.sort(), ['child', 'root']);
});

function timingFixture({ fallback = false } = {}) {
  let command, hide, restore, full, callback, now = 10, disconnected = 0, reads = 0; const buffered = [];
  const entry = (name = 'https://private.example.net/ACCOUNT_CANARY.js?token=TOKEN_CANARY', initiator = 'script', start = 0) => ({ name, initiator, start });
  const entries = [entry(), entry()];
  const env = { name: entry => entry.name, start: entry => entry.start, initiator: entry => entry.initiator, redact: helpers.redact, path: thirdPartyPathTemplate, now: () => now,
    entries: () => { ++reads; return entries; }, observe: (record, replay) => { buffered.push(replay); if (fallback) throw Error('unsupported'); callback = record; if (replay) record(entries); return { disconnect: () => { ++disconnected; }, takeRecords: () => [] }; },
    onCommand: fn => { command = fn; }, onHide: fn => { hide = fn; }, onRestore: fn => { restore = fn; }, onBufferFull: fn => { full = fn; } };
  startThirdPartyTimingBridge(env);
  const query = (trusted = true) => { let result; command(trusted, { schemaVersion: 1, type: 'third-party-timing-query' }, value => { result = value; }); return result; };
  const reset = () => { let result; command(true, { schemaVersion: 1, type: 'third-party-timing-reset' }, value => { result = value; }); return result; };
  return { query, reset, control: value => command(true, { schemaVersion: 1, type: 'bridge-control', command: value }, () => {}), add: value => callback([value]), entry, hide: () => hide(), restore: () => restore(), full: () => full(), tick: () => { now += 10; }, buffered, reads: () => reads, disconnected: () => disconnected };
}
test('ISOLATED timing bridge excludes raw URL/private subdomains and is extension-command only', () => {
  const f = timingFixture(); assert.equal(f.query(false), undefined);
  const result = f.query(); assert.equal(result.rows[0].domain, 'example.net'); assert.equal(result.rows[0].requestCount, 2);
  assert.doesNotMatch(JSON.stringify(result), /ACCOUNT_CANARY|TOKEN_CANARY|private\.example|https:/);
  assert.equal(f.query().rows[0].requestCount, 2);
});
test('ISOLATED BFCache restore never replays historical entries or doubles counts', () => {
  const f = timingFixture(); f.hide(); f.restore(); assert.equal(f.disconnected(), 1);
  assert.deepEqual(f.buffered, [true, false]); assert.equal(f.query().rows[0].requestCount, 2);
});
test('ISOLATED unavailable observer fallback reads the old buffer once across refreshes', () => {
  const f = timingFixture({ fallback: true });
  assert.equal(f.query().rows[0].requestCount, 2); assert.equal(f.query().rows[0].requestCount, 2); assert.equal(f.reads(), 1);
  assert.equal(f.query().truncated, true);
});
test('ISOLATED reset/pause/resume respect cutoff and never restore cleared entries', () => {
  const f = timingFixture(); f.reset(); f.add(f.entry(undefined, 'script', 0)); assert.deepEqual(f.query().rows, []);
  f.add(f.entry(undefined, 'script', 20)); assert.equal(f.query().rows[0].requestCount, 1);
  f.control('pause'); assert.equal(f.query().available, false); f.tick(); f.control('resume');
  assert.deepEqual(f.query().rows, []); assert.deepEqual(f.buffered, [true, false]);
});
test('ISOLATED timing types distinguish CSS/font preload from other link and inherited labels', () => {
  const f = timingFixture(); f.reset();
  for (const [path, initiator] of [['/style.css', 'link'], ['/font.woff2', 'link'], ['/main.js', 'link'], ['/x.png', 'constructor'], ['/x2.png', '__proto__']]) f.add(f.entry('https://example.net' + path, initiator, 20));
  assert.deepEqual(f.query().rows.map(row => row.type), ['stylesheet', 'font', 'other', 'other']);
  assert.equal(f.query().rows.at(-1).requestCount, 2);
  f.full(); assert.equal(f.query().truncated, true);
});
