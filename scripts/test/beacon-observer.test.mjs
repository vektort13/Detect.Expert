import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BeaconObserver, startBeaconTimingBridge } from '../../apps/production-extension/beacon-observer.js';
import { decodeBeacon } from '../../apps/production-extension/beacon-decoder.js';
import { readBeaconSnapshot, readBeaconTiming } from '../../packages/contracts/src/beacons.mjs';
const key = '7:0:doc', request = { schemaVersion: 1, type: 'ui-get-beacons', tabId: 7, frameId: 0, documentKey: key };
const decoded = () => decodeBeacon({ url: 'https://www.facebook.com/tr?ev=Purchase&cd%5Bvalue%5D=49.99&cd%5Bcurrency%5D=EUR&ud%5Bem%5D=' + 'e'.repeat(64), method: 'unknown', bodyAvailable: false });
const timingRow = () => ({ ...decoded(), method: 'unknown', requestType: 'image', count: 1, completedCount: 0, failedCount: 0, redirectCount: 0, statusCodes: [], evidenceSource: 'page-dom', integrity: 'page-controlled', attributionConfidence: 'unknown', initiatorHost: null, script: null });
const pageRow = () => ({ ...timingRow(), evidenceSource: 'page-hook', method: 'GET', attributionConfidence: 'exact-resource', script: { host: 'private.assets.example.com', pathTemplate: '/tracker.js' } });
const network = overrides => ({ tabId: 7, frameId: 0, documentId: 'doc', documentLifecycle: 'active', type: 'image', url: 'https://www.facebook.com/tr?ev=Purchase&cd%5Bvalue%5D=49.99&cd%5Bcurrency%5D=EUR&token=SECRET_SENTINEL', method: 'GET', initiator: 'https://private.site.example.com/path?token=SECRET_SENTINEL', requestId: 'request-1', ...overrides });
function fixture() {
  let now = 1700000000000, allowed = true, authorize = true;
  const scope = { hasDataConsent: true, accessReady: true, accessGeneration: 1, hasAnyHostAccess: () => true, isHostGrantedSync: () => true };
  const runtime = { isReady: true, scope, now: () => now, canObserveNetworkDocument: () => allowed, getProjection: () => ({ documentKey: key, coverageState: 'partial' }),
    state: { bindings: new Map([['7:0', { documentKey: key }]]) }, apiResults: { authorize: async () => authorize }, api: { tabs: { sendMessage: async (_tab, message) => message.type === 'beacon-values-query' ? { schemaVersion: 1, type: 'beacon-values-cache', available: true, rows: [pageRow()], truncated: false } : message.type === 'beacon-timing-reset' ? { schemaVersion: 1, type: 'beacon-timing-reset-ack' } : { schemaVersion: 1, type: 'beacon-timing-cache', available: true, rows: [timingRow()], truncated: false } } }, pro: { session: null, mark() {} } };
  const helpers = { host: raw => { try { return new URL(raw).hostname; } catch { return null; } }, redact: host => ({ kind: 'registrable', value: host.split('.').slice(-2).join('.') }) };
  return { observer: new BeaconObserver(runtime, helpers), runtime, tick: ms => { now += ms; }, allow: value => { allowed = value; }, auth: value => { authorize = value; } };
}
test('beacon observer keeps canonical metadata only and terminal outcome separate from preparation', () => {
  const f = fixture(); let reads = 0; const details = network();
  Object.defineProperties(details, { headers: { get() { reads++; throw Error('headers'); } }, responseBody: { get() { reads++; throw Error('body'); } } });
  f.observer.observe(details); f.observer.observe(details);
  let result = f.observer.snapshot(key); assert.equal(result.requestCount, 1); assert.equal(result.rows[0].completedCount, 0);
  f.observer.observe(network({ statusCode: 204 }), 'completed'); f.observer.observe(network({ statusCode: 204 }), 'completed');
  result = f.observer.snapshot(key); assert.equal(result.rows[0].completedCount, 1); assert.deepEqual(result.rows[0].statusCodes, [204]);
  assert.equal(result.rows[0].script, null); assert.equal(result.rows[0].initiatorHost, 'example.com'); assert.equal(reads, 0);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_SENTINEL|private\.site|request-1|requestBody|responseBody|tr\?/);
  assert.doesNotMatch(JSON.stringify([...f.observer.pending.values()]), /SECRET_SENTINEL|https|Purchase|49\.99/); assert.ok(readBeaconSnapshot(result));
});
test('native decoder requires consent, destination + initiator access and authoritative active identity', () => {
  for (const overrides of [{ documentId: undefined }, { documentId: 'bad:id' }, { frameId: -1 }, { tabId: -1 }, { documentLifecycle: 'cached' }, { initiator: undefined }, { requestId: undefined }]) { const f = fixture(); f.observer.observe(network(overrides)); assert.equal(f.observer.snapshot(key).rows.length, 0); }
  for (const control of ['ready', 'consent', 'access', 'destination', 'initiator', 'document', 'firefox']) {
    const f = fixture();
    if (control === 'ready') f.runtime.isReady = false;
    if (control === 'consent') f.runtime.scope.hasDataConsent = false;
    if (control === 'access') f.runtime.scope.accessReady = false;
    if (control === 'destination') f.runtime.scope.isHostGrantedSync = host => host !== 'www.facebook.com';
    if (control === 'initiator') f.runtime.scope.isHostGrantedSync = host => host === 'www.facebook.com';
    if (control === 'document') f.allow(false);
    if (control === 'firefox') f.runtime.api.__detectExpertCapabilities = { networkDocumentIdentity: false };
    f.observer.observe(network()); assert.equal(f.observer.snapshot(key).rows.length, 0, control);
  }
});
test('request bodies are not inspected before scope, identity and endpoint checks', () => {
  let reads = 0; const body = { get formData() { reads++; throw Error('body'); } };
  for (const raw of ['https://www.facebook.com/login', 'https://www.facebook.com.attacker.test/tr']) { const f = fixture(); f.observer.observe(network({ url: raw, requestBody: body })); }
  const f = fixture(); f.runtime.scope.hasDataConsent = false; f.observer.observe(network({ requestBody: body })); assert.equal(reads, 0);
});
test('redirects and HTTP errors are distinct, and late/foreign request outcomes stay empty', () => {
  const f = fixture(); f.observer.observe(network()); f.observer.observe(network({ statusCode: 302 }), 'redirect');
  assert.equal(f.observer.snapshot(key).rows[0].redirectCount, 1); assert.equal(f.observer.snapshot(key).rows[0].completedCount, 0);
  f.observer.observe(network({ requestId: 'request-2' })); f.observer.observe(network({ requestId: 'request-2' }), 'error');
  assert.equal(f.observer.snapshot(key).rows[0].failedCount, 1); assert.equal(f.observer.snapshot(key).requestCount, 2);
  f.observer.observe(network({ requestId: 'foreign', documentId: 'other', statusCode: 200 }), 'completed');
  assert.equal(f.observer.snapshot(key).rows[0].completedCount, 0);
});
test('native body decoding retains event/money presence but no email/hash/body in state', () => {
  const f = fixture();
  f.observer.observe(network({ url: 'https://www.facebook.com/tr?token=SECRET_SENTINEL', method: 'POST', requestBody: { formData: { ev: ['Purchase'], 'cd[value]': ['49.99'], 'cd[currency]': ['EUR'], 'ud[em]': ['e'.repeat(64)], account: ['SECRET_SENTINEL'] } } }));
  const result = f.observer.snapshot(key); assert.equal(result.rows[0].identifiers.hashedEmail, 'present'); assert.equal(result.rows[0].money[0].value, '49.99');
  assert.doesNotMatch(JSON.stringify([...f.observer.documents.values()]), /SECRET_SENTINEL|eeeeeeee|requestBody|account/);
});
test('live read retrieves page script calls separately and never adds them to native counts', async () => {
  const f = fixture(); f.observer.observe(network());
  const result = await f.observer.read(request);
  assert.equal(result.requestCount, 1); assert.equal(result.rows.length, 1); assert.equal(result.scriptCalls.length, 1);
  assert.equal(result.scriptCalls[0].script.host, 'example.com'); assert.equal(result.scriptCalls[0].script.pathTemplate, '/tracker.js'); assert.equal(result.scriptCalls[0].completedCount, 0);
  assert.ok(readBeaconSnapshot(result));
});
test('Firefox timing query projects positive URL fields and keeps native body unknown', async () => {
  const f = fixture(); f.runtime.api.__detectExpertCapabilities = { networkDocumentIdentity: false };
  f.observer.observe(network()); const result = await f.observer.read(request);
  assert.equal(result.rows[0].evidenceSource, 'page-dom'); assert.equal(result.rows[0].integrity, 'page-controlled'); assert.equal(result.rows[0].method, 'unknown');
  assert.equal(result.rows[0].identifiers.hashedEmail, 'present'); assert.equal(result.rows[0].identifiers.clientId, 'unknown'); assert.equal(result.rows[0].completedCount, 0);
  assert.equal(result.requestCount, 1);
});
test('empty timing recovery before the first hit never prevents native capture', async () => {
  const f = fixture(), send = f.runtime.api.tabs.sendMessage;
  f.runtime.api.tabs.sendMessage = async (tab, message) => message.type === 'beacon-timing-query' ? { schemaVersion: 1, type: 'beacon-timing-cache', available: true, rows: [], truncated: false } : send(tab, message);
  assert.equal((await f.observer.read(request)).rows.length, 0);
  assert.equal(f.observer.documents.get(key).source, null);
  f.observer.observe(network());
  const result = await f.observer.read(request);
  assert.equal(result.requestCount, 1); assert.equal(result.rows[0].evidenceSource, 'browser-network'); assert.equal(result.rows[0].method, 'GET');
});
test('a native POST takes priority over recovered GET rows without double counting', async () => {
  const f = fixture(); assert.equal((await f.observer.read(request)).rows[0].evidenceSource, 'page-dom');
  f.observer.observe(network({ url: 'https://www.facebook.com/tr', method: 'POST', requestBody: { formData: { ev: ['Purchase'], 'cd[value]': ['49.99'], 'cd[currency]': ['EUR'], 'ud[em]': ['e'.repeat(64)] } } }));
  f.observer.observe(network({ statusCode: 204 }), 'completed');
  const result = await f.observer.read(request);
  assert.equal(result.requestCount, 1); assert.equal(result.rows.length, 1); assert.equal(result.rows[0].evidenceSource, 'browser-network');
  assert.equal(result.rows[0].method, 'POST'); assert.equal(result.rows[0].identifiers.hashedEmail, 'present'); assert.equal(result.rows[0].completedCount, 1); assert.equal(result.truncated, true);
});
test('a pending timing response or rejection cannot replace newly arriving native rows', async () => {
  for (const outcome of ['response', 'rejection']) {
    const f = fixture(), send = f.runtime.api.tabs.sendMessage; let arrived, resolve, reject;
    const started = new Promise(done => { arrived = done; });
    f.runtime.api.tabs.sendMessage = (tab, message) => {
      if (message.type !== 'beacon-timing-query') return send(tab, message);
      arrived(); return new Promise((done, fail) => { resolve = done; reject = fail; });
    };
    const reading = f.observer.read(request); await started;
    f.observer.observe(network({ method: 'POST', url: 'https://www.facebook.com/tr', requestBody: { formData: { ev: ['Purchase'], 'cd[value]': ['49.99'] } } }));
    if (outcome === 'response') resolve({ schemaVersion: 1, type: 'beacon-timing-cache', available: true, rows: [timingRow()], truncated: false });
    else reject(Error('timing-unavailable'));
    const result = await reading;
    assert.equal(result.requestCount, 1, outcome); assert.equal(result.rows.length, 1, outcome); assert.equal(result.rows[0].evidenceSource, 'browser-network', outcome); assert.equal(result.rows[0].method, 'POST', outcome);
  }
});
test('authorization, permission and navigation races discard both retained sources', async () => {
  const f = fixture(); f.observer.observe(network()); f.auth(false);
  assert.deepEqual((await f.observer.read(request)).rows, []); assert.deepEqual((await f.observer.read(request)).scriptCalls, []);
  f.auth(true); f.runtime.api.tabs.sendMessage = async () => { f.runtime.scope.accessGeneration++; return { schemaVersion: 1, type: 'beacon-values-cache', available: true, rows: [pageRow()], truncated: false }; };
  const result = await f.observer.read(request); assert.equal(result.coverageState, 'no-access'); assert.deepEqual(result.rows, []); assert.deepEqual(result.scriptCalls, []);
});
test('grants are rechecked on Firefox timing rows before cache admission', async () => {
  const f = fixture(); f.runtime.scope.isHostGrantedSync = host => host !== 'www.facebook.com';
  const result = await f.observer.read(request); assert.equal(result.requestCount, 0); assert.deepEqual(result.rows, []); assert.deepEqual(result.scriptCalls, []); assert.equal(result.truncated, true);
});
test('clear/forget and TTL remove retained beacons and invalidate Pro copies', () => {
  const f = fixture(); f.observer.observe(network()); f.tick(600000); assert.deepEqual(f.observer.snapshot(key).rows, []);
  f.observer.observe(network()); f.observer.forget(key); assert.deepEqual(f.observer.snapshot(key).rows, []); assert.equal(f.observer.pending.size, 0);
  f.observer.observe(network()); f.runtime.pro.session = { pages: [{ beacons: [] }] }; f.observer.clear(); assert.equal(Object.hasOwn(f.runtime.pro.session.pages[0], 'beacons'), false); assert.deepEqual(f.observer.snapshot(key).rows, []);
});
test('capture rate is bounded; repeated values aggregate and overflow is visible', () => {
  const f = fixture(); for (let index = 0; index < 21; ++index) f.observer.observe(network({ requestId: 'request-' + index }));
  assert.equal(f.observer.snapshot(key).requestCount, 20); assert.equal(f.observer.snapshot(key).truncated, true);
  f.tick(1000); f.observer.observe(network({ requestId: 'request-next' })); assert.equal(f.observer.snapshot(key).requestCount, 21);
});
test('ISOLATED timing bridge discards query/body canaries and respects reset/pause', () => {
  let command, record, hidden, restore, full, now = 5;
  const environment = { decode: decodeBeacon, name: entry => entry.name, start: entry => entry.start, initiator: entry => entry.type, now: () => now,
    observe: listener => { record = listener; return { disconnect() {}, takeRecords: () => [] }; }, entries: () => [], onCommand: listener => { command = listener; }, onHide: listener => { hidden = listener; }, onRestore: listener => { restore = listener; }, onBufferFull: listener => { full = listener; } };
  startBeaconTimingBridge(environment);
  record([{ name: network().url, start: 1, type: 'img' }]);
  const query = () => { let result; command(true, { schemaVersion: 1, type: 'beacon-timing-query' }, value => { result = value; }); return result; };
  const result = query(); assert.ok(readBeaconTiming(result)); assert.equal(result.rows[0].events[0], 'Purchase'); assert.doesNotMatch(JSON.stringify(result), /SECRET_SENTINEL|tr\?|requestBody/);
  command(true, { schemaVersion: 1, type: 'beacon-timing-reset' }, () => {}); record([{ name: network().url, start: 1, type: 'img' }]); assert.equal(query().rows.length, 0);
  command(true, { schemaVersion: 1, type: 'bridge-control', command: 'pause' }, () => {}); assert.equal(query().available, false);
  now = 10; command(true, { schemaVersion: 1, type: 'bridge-control', command: 'resume' }, () => {}); record([{ name: network().url, start: 11, type: 'img' }]); assert.equal(query().rows.length, 1);
  full(); assert.equal(query().truncated, true); hidden(); restore(); assert.equal(query().rows.length, 1);
});
