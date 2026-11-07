import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { backgroundSensorSupport, createBackgroundResourceRedactor } from '../production/background-activity-runtime.mjs';
import { createBackgroundInventoryReader, startBackgroundValuesBridge } from '../production/background-activity-bridge-runtime.mjs';
import { backgroundActivityContracts as contracts, readBackgroundRows, readBackgroundSnapshot, readBackgroundRequest, readBackgroundInventory, readBackgroundDocuments } from '../../packages/contracts/src/background-activity.mjs';

const redact = createBackgroundResourceRedactor(true);
const empty = () => ({ status: 'unavailable', secureContext: true, supported: { serviceWorker: true, push: true, sync: true, periodicSync: true }, permissions: { notifications: 'unknown', push: 'unknown', sync: 'unknown', periodicSync: 'unknown' }, registrationCount: null, pushSubscriptionCount: null, syncTagCount: null, periodicTagCount: null, registrations: [], truncated: false, checkedAt: 0 });
function wrappers() {
  const source = readFileSync(new URL('../../apps/production-extension/hook.main.js', import.meta.url), 'utf8');
  const start = source.indexOf('// packages/sensors/src/wrap.ts'), end = source.indexOf('// packages/sensors/src/intrinsics.ts', start), context = vm.createContext({});
  vm.runInContext(source.slice(start, end) + ';globalThis.wrappers={wrapMethod};', context); return context.wrappers;
}
function sensor() {
  let executing = { source: 'https://static.site.example.com/main.js?SOURCE_SECRET' };
  class Document { get currentScript() { return executing; } get URL() { return 'https://site.example.com/private-account?SITE_SECRET'; } }
  class HTMLScriptElement { get src() { return this.source; } }
  Object.setPrototypeOf(executing, HTMLScriptElement.prototype);
  const runtime = { hooks: { enabled: true, observerErrors: 0 }, apiResults: { generation: 0, backgroundCollector: backgroundSensorSupport.createCollector() }, attach() {}, onStop(fn) { this.stop = fn; } };
  const wrap = wrappers(); backgroundSensorSupport.install(runtime, { Document, HTMLScriptElement, document: new Document() }, wrap, value => typeof value === 'function');
  return { runtime, wrap, executing(value) { executing = value; } };
}
test('background contracts accept only fixed labels, phases and provenance', () => {
  const f = sensor(); f.runtime.observeBackgroundOperation('ServiceWorkerContainer.register', ['https://site.example.com/user/PRIVATE/sw.js?TOKEN_SECRET', {}], false);
  const rows = f.runtime.apiResults.backgroundCollector.snapshot().rows; assert.ok(readBackgroundRows(rows)); assert.equal(rows[0].worker.pathTemplate, '/sw.js');
  for (const patch of [{ operation: 'fetch' }, { phase: 'fulfilled' }, { evidenceSource: 'browser-network' }, { integrity: 'browser-observed' }, { count: 0 }, { secret: 'value' }, { script: null }, { worker: { host: 'site.example.com', pathTemplate: '/PRIVATE' } }]) assert.equal(readBackgroundRows([{ ...rows[0], ...patch }]), null);
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE|SECRET|TOKEN|user\/|account/);
});
test('background native wrapper keeps this, arguments, Promise identity and original synchronous errors', () => {
  const f = sensor(); let calls = 0, thenReads = 0, received;
  const result = Object.defineProperty({}, 'then', { get() { ++thenReads; throw Error('foreign then'); } });
  const error = new RangeError('native throw');
  const target = { register() { ++calls; received = { receiver: this, args: [...arguments] }; if (arguments[0] === 'throw') throw error; return result; } };
  f.wrap.wrapMethod(target, 'register', (_receiver, args, threw) => f.runtime.observeBackgroundOperation('ServiceWorkerContainer.register', args, threw), { context: f.runtime.hooks });
  const options = new Proxy({}, { get() { throw Error('options'); }, ownKeys() { throw Error('options'); }, getOwnPropertyDescriptor() { throw Error('options'); } });
  assert.equal(target.register('/sw.js?PRIVATE', options), result); assert.equal(received.receiver, target); assert.equal(received.args[1], options); assert.equal(calls, 1); assert.equal(thenReads, 0);
  assert.throws(() => target.register('throw'), value => value === error); assert.equal(calls, 2); assert.equal(thenReads, 0);
  assert.equal(f.runtime.apiResults.backgroundCollector.snapshot().rows.find(row => row.phase === 'threw-sync').count, 1);
});
test('background ignores arbitrary URL coercion, tags, subscription options and results', () => {
  const f = sensor(); let reads = 0;
  const opaque = new Proxy({}, { get() { ++reads; throw Error('get'); }, ownKeys() { ++reads; throw Error('keys'); }, getOwnPropertyDescriptor() { ++reads; throw Error('descriptor'); }, getPrototypeOf() { ++reads; throw Error('prototype'); } });
  for (const operation of contracts.operations) f.runtime.observeBackgroundOperation(operation, [opaque, opaque], false);
  assert.equal(reads, 0); const rows = f.runtime.apiResults.backgroundCollector.snapshot().rows;
  assert.equal(rows.length, 12); assert.ok(rows.every(row => row.worker === null)); assert.ok(readBackgroundRows(rows));
});
test('background respects pause, reset, generation and bounded counts', () => {
  const f = sensor(); for (let index = 0; index < 100; ++index) f.runtime.observeBackgroundOperation('PushManager.subscribe', [], false);
  assert.equal(f.runtime.apiResults.backgroundCollector.snapshot().rows[0].count, 100);
  f.runtime.hooks.enabled = false; f.runtime.observeBackgroundOperation('PushManager.subscribe', [], false); assert.equal(f.runtime.apiResults.backgroundCollector.snapshot().rows[0].count, 100);
  f.runtime.hooks.enabled = true; ++f.runtime.apiResults.generation; f.runtime.observeBackgroundOperation('PushManager.getSubscription', [], false);
  assert.equal(f.runtime.apiResults.backgroundCollector.snapshot().rows.length, 1); f.runtime.stop(); assert.equal(f.runtime.apiResults.backgroundCollector.snapshot().rows.length, 0);
});
test('background redactor strips private paths, query, fragment and rejects coercion and non-web schemes', () => {
  assert.deepEqual(redact('/session/PRIVATE/worker-X.js?TOKEN#SECRET', 'https://site.example.com/base'), { host: 'site.example.com', pathTemplate: '/<worker>' });
  assert.deepEqual(redact('https://site.example.com/user/SECRET/', undefined, 'scope'), { host: 'site.example.com', pathTemplate: '/<scope>' });
  for (const value of [{ toString() { throw Error('coercion'); } }, 'data:text/plain,secret', 'javascript:alert(1)', 'file:///private']) assert.equal(redact(value), null);
});

function inventoryFixture({ syncAvailable = true, periodicAvailable = true, count = 1, badOrigin = false, rejected = false, accessorGlobals = false, inheritedGlobals = false, serviceWorkerAvailable = true } = {}) {
  const registrations = [], calls = { register: 0, subscribe: 0, requestPermission: 0, endpoint: 0, tags: 0, getRegistrations: 0, globals: {} };
  class PushManager { getSubscription() { return Promise.resolve(Object.defineProperty({}, 'endpoint', { get() { ++calls.endpoint; throw Error('endpoint'); } })); } subscribe() { ++calls.subscribe; throw Error('subscribe'); } }
  class SyncManager { getTags() { ++calls.tags; return Promise.resolve(['PRIVATE_SYNC_TAG', 'PRIVATE_SYNC_TAG2']); } register() { ++calls.register; throw Error('register'); } }
  class PeriodicSyncManager { getTags() { ++calls.tags; return Promise.resolve(['PRIVATE_PERIODIC_TAG']); } register() { ++calls.register; throw Error('register'); } }
  class ServiceWorker { get scriptURL() { return 'https://site.example.com/private/ACCOUNT/sw.js?SCRIPT_SECRET'; } get state() { return 'activated'; } }
  class ServiceWorkerRegistration { get scope() { return `https://${badOrigin ? 'other.example.net' : 'site.example.com'}/private/ACCOUNT/`; } get active() { return new ServiceWorker(); } get waiting() { return null; } get installing() { return null; } get pushManager() { return new PushManager(); } }
  if (syncAvailable) Object.defineProperty(ServiceWorkerRegistration.prototype, 'sync', { get() { return new SyncManager(); } });
  if (periodicAvailable) Object.defineProperty(ServiceWorkerRegistration.prototype, 'periodicSync', { get() { return new PeriodicSyncManager(); } });
  for (let index = 0; index < count; ++index) registrations.push(new ServiceWorkerRegistration());
  class ServiceWorkerContainer { getRegistrations() { ++calls.getRegistrations; return rejected ? Promise.reject(Error('denied')) : Promise.resolve(registrations); } }
  class PermissionStatus { constructor(value) { this.value = value; } get state() { return this.value; } }
  class Permissions { query(options) { return Promise.resolve(new PermissionStatus(options.name === 'periodic-background-sync' ? 'denied' : 'granted')); } }
  class Navigator { get permissions() { return new Permissions(); } }
  if (serviceWorkerAvailable) Object.defineProperty(Navigator.prototype, 'serviceWorker', { get() { return new ServiceWorkerContainer(); } });
  class Notification { static get permission() { return 'default'; } static requestPermission() { ++calls.requestPermission; throw Error('prompt'); } }
  class Document { get URL() { return 'https://site.example.com/private/page?SECRET'; } }
  let realm = { Navigator, ServiceWorkerContainer, ServiceWorkerRegistration, ServiceWorker, PushManager, SyncManager, PeriodicSyncManager, Permissions, PermissionStatus, Notification, Document, URL, navigator: new Navigator(), document: new Document(), isSecureContext: true };
  if (!serviceWorkerAvailable) for (const name of ['ServiceWorkerContainer', 'ServiceWorkerRegistration', 'ServiceWorker', 'PushManager']) delete realm[name];
  if (accessorGlobals) for (const [name, value] of Object.entries(realm)) Object.defineProperty(realm, name, { configurable: true, get() { calls.globals[name] = (calls.globals[name] ?? 0) + 1; return value; } });
  if (inheritedGlobals) realm = Object.create(realm);
  return { reader: createBackgroundInventoryReader(realm, redact, true), calls, realm };
}
test('isolated read-only inventory reports registrations/subscription presence/tag counts and exact permission without private values', async () => {
  const f = inventoryFixture(), output = await f.reader.read(); assert.ok(readBackgroundInventory(output));
  assert.equal(output.status, 'available'); assert.equal(output.registrationCount, 1); assert.equal(output.pushSubscriptionCount, 1); assert.equal(output.syncTagCount, 2); assert.equal(output.periodicTagCount, 1);
  assert.equal(output.permissions.periodicSync, 'denied'); assert.equal(output.permissions.notifications, 'prompt'); assert.equal(output.registrations[0].script.pathTemplate, '/sw.js');
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE|SECRET|ACCOUNT|endpoint|p256dh|auth|TAG/);
  assert.deepEqual({ register: f.calls.register, subscribe: f.calls.subscribe, requestPermission: f.calls.requestPermission, endpoint: f.calls.endpoint }, { register: 0, subscribe: 0, requestPermission: 0, endpoint: 0 });
});
test('Firefox-like sync/periodic absence and native rejection remain unknown counts, not zero', async () => {
  const f = inventoryFixture({ syncAvailable: false, periodicAvailable: false }), output = await f.reader.read();
  assert.equal(output.supported.serviceWorker, true); assert.equal(output.supported.push, true); assert.equal(output.supported.sync, false); assert.equal(output.supported.periodicSync, false); assert.equal(output.syncTagCount, null); assert.equal(output.periodicTagCount, null); assert.equal(output.permissions.periodicSync, 'unsupported');
  const rejected = await inventoryFixture({ rejected: true }).reader.read(); assert.equal(rejected.registrationCount, null); assert.equal(rejected.status, 'unavailable');
});
test('Firefox-style native global accessors retain Service Worker and Push inventory', async () => {
  // Structural WebIDL accessor fixture. Native acceptance is supplied explicitly;
  // installed Firefox evidence validates real Xray descriptors separately.
  const f = inventoryFixture({ accessorGlobals: true, syncAvailable: false, periodicAvailable: false });
  const result = await f.reader.read(); assert.ok(readBackgroundInventory(result));
  assert.equal(result.status, 'available'); assert.equal(result.supported.serviceWorker, true); assert.equal(result.supported.push, true); assert.equal(result.registrationCount, 1); assert.equal(result.pushSubscriptionCount, 1);
  assert.equal(result.syncTagCount, null); assert.equal(result.periodicTagCount, null); assert.equal(result.registrations[0].script.pathTemplate, '/sw.js');
  for (const name of ['Navigator', 'ServiceWorkerContainer', 'ServiceWorkerRegistration', 'ServiceWorker', 'URL', 'Notification', 'Permissions', 'PermissionStatus', 'PushManager']) assert.equal(f.calls.globals[name], 1, name + ': captured once');
  assert.equal(f.calls.getRegistrations, 1); assert.equal(f.calls.endpoint, 0); assert.equal(f.calls.register, 0); assert.equal(f.calls.subscribe, 0); assert.equal(f.calls.requestPermission, 0);
});
test('inventory rejects unverified global accessors without invoking them', async () => {
  const f = inventoryFixture(); let reads = 0;
  Object.defineProperty(f.realm, 'Navigator', { configurable: true, get() { ++reads; throw Error('arbitrary global getter'); } });
  const reader = createBackgroundInventoryReader(f.realm, redact, false), result = await reader.read();
  assert.equal(reads, 0); assert.equal(result.status, 'unsupported'); assert.equal(result.supported.serviceWorker, false); assert.equal(result.registrationCount, null); assert.equal(f.calls.getRegistrations, 0);
});
test('Firefox-style inherited native globals are resolved without own-global assumptions', async () => {
  const f = inventoryFixture({ inheritedGlobals: true, syncAvailable: false, periodicAvailable: false });
  assert.equal(Object.getOwnPropertyDescriptor(f.realm, 'Navigator'), undefined);
  const result = await f.reader.read(); assert.ok(readBackgroundInventory(result));
  assert.equal(result.status, 'available'); assert.equal(result.registrationCount, 1); assert.equal(result.pushSubscriptionCount, 1); assert.equal(result.registrations[0].scope.pathTemplate, '/<scope>'); assert.equal(f.calls.getRegistrations, 1);
});
test('genuine Firefox isolated Service Worker absence preserves unsupported inventory and null counts', async () => {
  const f = inventoryFixture({ inheritedGlobals: true, serviceWorkerAvailable: false, syncAvailable: false, periodicAvailable: false });
  const result = await f.reader.read(); assert.ok(readBackgroundInventory(result)); assert.equal(result.secureContext, true);
  assert.equal(result.status, 'unsupported'); assert.equal(result.supported.serviceWorker, false); assert.equal(result.registrationCount, null); assert.equal(result.pushSubscriptionCount, null); assert.equal(result.registrations.length, 0); assert.equal(f.calls.getRegistrations, 0);
});
test('inherited unverified global accessors remain opaque even when the sandbox has no own property', async () => {
  const f = inventoryFixture({ inheritedGlobals: true }); let reads = 0;
  Object.defineProperty(Object.getPrototypeOf(f.realm), 'Navigator', { configurable: true, get() { ++reads; throw Error('arbitrary inherited getter'); } });
  const result = await createBackgroundInventoryReader(f.realm, redact, false).read(); assert.equal(reads, 0); assert.equal(result.registrationCount, null);
});
test('inventory origin isolation and registration bounds retain truncation', async () => {
  const wrong = await inventoryFixture({ badOrigin: true }).reader.read(); assert.equal(wrong.registrations.length, 0); assert.equal(wrong.truncated, true);
  assert.equal(wrong.pushSubscriptionCount, null); assert.equal(wrong.syncTagCount, null); assert.equal(wrong.periodicTagCount, null);
  const many = await inventoryFixture({ count: 30 }).reader.read(); assert.equal(many.registrationCount, 30); assert.equal(many.registrations.length, 16); assert.equal(many.truncated, true); assert.ok(readBackgroundInventory(many)); assert.equal(many.pushSubscriptionCount, null); assert.equal(many.syncTagCount, null); assert.equal(many.periodicTagCount, null);
});
test('background canonical requests reject frame/document mismatch and additional options', () => {
  const request = { schemaVersion: 1, type: 'ui-refresh-background-activity', tabId: 1, frameId: 0, documentKey: '1:0:doc' };
  assert.ok(readBackgroundRequest(request)); assert.equal(readBackgroundRequest({ ...request, documentKey: '1:2:doc' }), null); assert.equal(readBackgroundRequest({ ...request, refresh: true }), null); assert.equal(readBackgroundRequest({ ...request, type: 'background-values-query' }), null);
});
test('background snapshots and Pro documents enforce shape, admission and inaccessible empty states', () => {
  const f = sensor(); f.runtime.observeBackgroundOperation('PushManager.subscribe', [], false);
  const snapshot = { schemaVersion: 1, type: 'background-activity-state', documentKey: '1:0:doc', coverageState: 'partial', observedAt: 1, rows: f.runtime.apiResults.backgroundCollector.snapshot().rows, inventory: empty(), truncated: false };
  assert.ok(readBackgroundSnapshot(snapshot)); assert.equal(readBackgroundSnapshot({ ...snapshot, coverageState: 'no-access' }), null); assert.ok(readBackgroundDocuments([snapshot])); assert.equal(readBackgroundDocuments([snapshot, snapshot]), null); assert.equal(readBackgroundDocuments(Array.from({ length: 25 }, (_, index) => ({ ...snapshot, documentKey: `1:${index}:doc` }))), null);
});

function bridgeFixture() {
  let now = 0, sequence = 0, onPage, onCommand, onHide, onShow, reads = 0;
  const tasks = new Map(), sent = [], responses = [];
  const env = { now: () => now, later(fn, delay) { const id = ++sequence; tasks.set(id, { fn, at: now + delay }); return id; }, cancel(id) { tasks.delete(id); }, post(value) { sent.push(value); }, onPage(fn) { onPage = fn; }, onCommand(fn) { onCommand = fn; }, onHide(fn) { onHide = fn; }, onShow(fn) { onShow = fn; } };
  const reader = { empty, async read() { ++reads; return { ...empty(), checkedAt: 1 }; } };
  startBackgroundValuesBridge(env, contracts, reader);
  return { sent, responses, reads: () => reads, command(trusted = true, refresh = false) { return onCommand(trusted, { schemaVersion: 1, type: 'background-values-query', refresh }, value => responses.push(value)); }, reply(extra = {}) { onPage(true, { channel: 'detect.expert/background/v1', type: 'background-values-batch', requestId: sent.at(-1)?.requestId, enabled: true, rows: [], truncated: false, ...extra }); }, hide() { onHide(); }, show() { onShow(); }, advance(ms) { now += ms; for (const [id, task] of [...tasks]) if (task.at <= now) { tasks.delete(id); task.fn(); } } };
}
test('background bridge diagnostics require explicit trusted refresh and passive reads remain read-only', async () => {
  const f = bridgeFixture(); assert.equal(f.command(false, true), false); assert.equal(f.reads(), 0);
  assert.equal(f.command(), true); f.reply(); assert.equal(f.responses.length, 1); assert.equal(f.reads(), 0);
  assert.equal(f.command(true, true), true); assert.equal(f.sent.length, 1); f.advance(500); f.reply(); await new Promise(setImmediate);
  assert.equal(f.reads(), 1); assert.equal(f.responses.length, 2); assert.equal(f.responses[1].inventory.checkedAt, 1);
});
test('background bridge timeout, pagehide and BFCache restore do not admit stale page replies', () => {
  const f = bridgeFixture(); f.command(); f.advance(400); assert.equal(f.responses[0].available, false);
  f.advance(500); f.command(); const prior = f.sent.at(-1).requestId; f.hide(); assert.equal(f.responses.at(-1).available, false); f.reply({ requestId: prior }); assert.equal(f.responses.length, 2);
  f.show(); f.advance(500); f.command(); f.reply(); assert.equal(f.responses.at(-1).available, true);
});
test('background bridge enforces one pending request and rejects page privilege/provenance upgrades', () => {
  const f = bridgeFixture(); f.command(); assert.equal(f.command(), false); assert.equal(f.responses[0].available, false); f.reply({ rows: [{ integrity: 'browser-observed' }] }); assert.equal(f.responses.length, 1); f.advance(400); assert.equal(f.responses.length, 2); assert.equal(f.responses[1].available, false);
});
