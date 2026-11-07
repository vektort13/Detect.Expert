import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createBeaconEndpointProjector, createBeaconSensorSupport, startBeaconValuesBridge } from '../production/beacon-sensor-runtime.mjs';
import { readBeaconScriptRows } from '../../packages/contracts/src/beacons.mjs';
const url = 'https://www.facebook.com/tr?ev=Purchase&cd%5Bvalue%5D=49.99&cd%5Bcurrency%5D=EUR&fbp=PRIVATE_ID_SENTINEL';
const source = () => ({ attributionConfidence: 'exact-resource', script: { host: 'assets.example.com', pathTemplate: '/tracker.js' } });
const fixture = () => {
  const support = createBeaconSensorSupport(createBeaconEndpointProjector()), collector = support.createCollector(); let stop;
  const runtime = { apiResults: { beaconCollector: collector, generation: 0 }, hooks: { enabled: true }, onStop: listener => { stop = listener; } };
  support.install(runtime); return { support, collector, runtime, stop: () => stop() };
};
test('page collector keeps endpoint-only source metadata and separate attempt counts', () => {
  const f = fixture(); f.runtime.observeBeaconRequest(url, 'image', 'GET', source); f.runtime.observeBeaconRequest(url, 'image', 'GET', source);
  const result = f.collector.snapshot(); assert.equal(result.rows[0].count, 2); assert.equal(result.rows[0].completedCount, 0); assert.equal(result.rows[0].evidenceSource, 'page-hook');
  assert.equal(result.rows[0].script.pathTemplate, '/tracker.js'); assert.deepEqual(result.rows[0].money, []); assert.deepEqual(result.rows[0].events, []); assert.equal(result.rows[0].decodeStatus, 'endpoint-only'); assert.ok(readBeaconScriptRows(result.rows));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ID_SENTINEL|tr\?|fbevents\.js.*gtm/);
});
test('page decoder never inspects arbitrary URL objects, body/options/getters or Proxy traps', () => {
  const f = fixture(); let traps = 0, sources = 0;
  const hostile = new Proxy({ toString() { throw Error('coercion'); } }, { get() { traps++; throw Error('get'); }, ownKeys() { traps++; throw Error('keys'); }, getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
  f.runtime.observeBeaconRequest(hostile, 'xmlhttprequest', 'unknown', () => { sources++; return source(); });
  assert.equal(f.collector.snapshot().rows.length, 0); assert.equal(traps, 0); assert.equal(sources, 0);
  f.runtime.observeBeaconRequest(url, 'xmlhttprequest', 'unknown', source);
  assert.equal(f.collector.snapshot().rows[0].identifiers.hashedEmail, 'unknown');
});
test('XHR stores the safe projection only and snapshots source on send', () => {
  const f = fixture(), receiver = {};
  f.runtime.observeBeaconXhrOpen(receiver, ['POST', url], false); f.runtime.observeBeaconXhrSend(receiver, source);
  const row = f.collector.snapshot().rows[0]; assert.equal(row.method, 'POST'); assert.equal(row.decodeStatus, 'endpoint-only'); assert.equal(row.script.pathTemplate, '/tracker.js');
  f.runtime.observeBeaconXhrOpen(receiver, ['POST', url], true); f.runtime.observeBeaconXhrSend(receiver, source); assert.equal(f.collector.snapshot().rows[0].count, 1);
});
test('generation change, pause and stop reset or disable page observation', () => {
  const f = fixture(); f.runtime.observeBeaconRequest(url, 'image', 'GET', source); f.runtime.apiResults.generation++;
  f.runtime.observeBeaconRequest(url, 'image', 'GET', source); assert.equal(f.collector.snapshot().rows[0].count, 1);
  f.runtime.hooks.enabled = false; f.runtime.observeBeaconRequest(url, 'image', 'GET', source); assert.equal(f.collector.snapshot().rows[0].count, 1);
  f.stop(); assert.deepEqual(f.collector.snapshot().rows, []);
});
test('poisoned URL/query getters never run because MAIN does not parse a URL or query', () => {
  const f = fixture(), poisoned = [[URL.prototype, 'search'], [URL.prototype, 'searchParams'], [URLSearchParams.prototype, 'get'], [URLSearchParams.prototype, 'entries']];
  const originals = poisoned.map(([object, key]) => Object.getOwnPropertyDescriptor(object, key)); let reads = 0;
  try {
    for (const [object, key] of poisoned) Object.defineProperty(object, key, { configurable: true, get() { reads++; throw Error('page getter'); } });
    f.runtime.observeBeaconRequest(url, 'image', 'GET', source);
  } finally { poisoned.forEach(([object, key], index) => Object.defineProperty(object, key, originals[index])); }
  assert.equal(reads, 0); assert.equal(f.collector.snapshot().rows.length, 1); assert.equal(f.collector.snapshot().rows[0].decodeStatus, 'endpoint-only');
});
test('MAIN starts without URL APIs and does not inspect a primitive query', () => {
  const context = vm.createContext({ URL: undefined, URLSearchParams: undefined });
  vm.runInContext('var projector = (' + createBeaconEndpointProjector.toString() + ')(); var support = (' + createBeaconSensorSupport.toString() + ')(projector); var collector = support.createCollector();', context);
  const result = vm.runInContext('collector.record(collector.prepare("https://www.facebook.com/tr?ev=Purchase&ud[em]=RAW_HASH_SENTINEL", "GET"), "image", "GET", () => null); collector.snapshot()', context);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].service, 'meta'); assert.equal(result.rows[0].decodeStatus, 'endpoint-only');
  assert.doesNotMatch(JSON.stringify(result), /Purchase|RAW_HASH_SENTINEL/);
});
test('added inherited JSON hooks are detected without invoking page code', () => {
  const f = fixture(), original = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON'); let calls = 0;
  try {
    Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, get() { calls++; throw Error('page JSON getter'); } });
    f.runtime.observeBeaconRequest(url, 'image', 'GET', source);
  } finally { if (original) Object.defineProperty(Object.prototype, 'toJSON', original); else delete Object.prototype.toJSON; }
  assert.equal(calls, 0); assert.deepEqual(f.collector.snapshot().rows, []); assert.equal(f.collector.snapshot().truncated, true);
});
test('source/DOM dedup keeps explicit repeated sets but ignores one inserted node twice', () => {
  const f = fixture(), node = {};
  f.runtime.observeBeaconRequest(url, 'image', 'GET', source, node, false); f.runtime.observeBeaconRequest(url, 'image', 'GET', source, node, false);
  assert.equal(f.collector.snapshot().rows[0].count, 1);
  f.runtime.observeBeaconRequest(url, 'image', 'GET', source, node, true); assert.equal(f.collector.snapshot().rows[0].count, 2);
});
test('script-call budgets and cooldown are bounded', () => {
  const f = fixture();
  for (let index = 0; index < 50; ++index) f.runtime.observeBeaconRequest(url + '&cd%5Bvalue%5D=' + index, 'image', 'GET', () => ({ attributionConfidence: 'sampled-stack', script: { host: 'source' + index + '.example.com', pathTemplate: '/main.js' } }));
  const snapshot = f.collector.snapshot(); assert.equal(snapshot.truncated, true); assert.ok(snapshot.rows.length < 32); assert.ok(JSON.stringify(snapshot.rows).length <= 12000);
  let now = 10, sent = 0; const env = { now: () => now, postMessage: () => sent++ }, message = { channel: 'detect.expert/beacon/v1', type: 'beacon-values-read', requestId: 'beacon-1' };
  f.collector.handleControl(message, true, env); f.collector.handleControl(message, true, env); assert.equal(sent, 1); now += 500; f.collector.handleControl(message, true, env); assert.equal(sent, 2);
});
test('authorized bridge queues one read through cooldown and rejects forged shapes', () => {
  let page, command, hide, posted = [], now = 0, nextTimer = 0; const timers = new Map();
  startBeaconValuesBridge({ onPage: listener => { page = listener; }, onCommand: listener => { command = listener; }, onHide: listener => { hide = listener; }, post: value => posted.push(value), later: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; }, cancel: id => timers.delete(id), now: () => now }, readBeaconScriptRows);
  const data = { schemaVersion: 1, type: 'beacon-values-query' }; let first;
  assert.equal(command(false, data, () => {}), false); assert.equal(command(true, data, value => { first = value; }), true); assert.equal(posted.length, 1);
  const collector = fixture().collector; collector.record(collector.prepare(url, 'GET'), 'image', 'GET', source); const rows = collector.snapshot().rows;
  page(true, { channel: 'detect.expert/beacon/v1', type: 'beacon-values-batch', requestId: posted[0].requestId, enabled: true, rows: rows.map(row => ({ ...row, rawUrl: url })), truncated: false }); assert.equal(first, undefined);
  page(true, { channel: 'detect.expert/beacon/v1', type: 'beacon-values-batch', requestId: posted[0].requestId, enabled: true, rows, truncated: false }); assert.equal(first.available, true);
  let second; command(true, data, value => { second = value; }); assert.equal(posted.length, 1); now = 500;
  const ready = [...timers.entries()].filter(([, timer]) => timer.at <= now); for (const [id, timer] of ready) { timers.delete(id); timer.fn(); } assert.equal(posted.length, 2);
  hide(); assert.equal(second.available, false); assert.equal(timers.size, 0);
});
