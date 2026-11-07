// E22-21 / ADR-067: read-only lifecycle tests using native identity snapshots
// and ordinary report metadata; never technical result/value channels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiObservedUsageController, observedSourceTabId } from '../../apps/production-extension/api-observed-usage-controller.js';

const TAB = 17, ownHref = 'chrome-extension://owned/options.html?tabId=17#api';
const turn = () => new Promise(done => setImmediate(done));
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const copy = value => structuredClone(value);
function event() { const callbacks = new Set(); return { addListener: fn => callbacks.add(fn), removeListener: fn => callbacks.delete(fn), emit: (...args) => { for (const fn of [...callbacks]) fn(...args); }, get size() { return callbacks.size; } }; }
function report(frameId = 0, document = frameId ? 'child-' + frameId : 'main-1', { host = 'fixture.invalid', operation = 'Screen.width', technique = 'DET-029', count = 1, phase = 'returned-sync', ...patch } = {}) {
  return { reportRevision: 1, documentKey: TAB + ':' + frameId + ':' + document, host, coverageState: 'active', coverageFlags: [], scopeMode: 'all-sites',
    techniques: [{ techniqueId: technique, count, countQuality: 'exact', phases: [phase], signalCodes: ['api-use'], evidenceSource: 'page-hook', integrity: 'page-controlled', interpretation: 'api-use', interpretationConfidence: 'unassessed', attributionConfidence: 'frame-only', firstBucket: 0, lastBucket: 0 }],
    apiOperations: [{ apiOperation: operation, phase, count, countQuality: 'exact' }], findings: [], vendors: [],
    dropped: { observations: 0, batches: 0, findings: 0, hosts: 0, counters: 0, transport: 0 }, observedSince: 1, ...patch };
}
function fixture(t, { href = ownHref, framed = false, deadlineMs = 100, hidden = false, nativeBrowser } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const prior = Object.fromEntries(['window', 'location', 'document', 'browser'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const visibility = event(), doc = { visibilityState: hidden ? 'hidden' : 'visible', addEventListener: (_name, fn) => visibility.addListener(fn), removeEventListener: (_name, fn) => visibility.removeListener(fn) };
  const win = {}; win.top = framed ? {} : win;
  for (const [key, value] of Object.entries({ window: win, location: { href }, document: doc, browser: nativeBrowser })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const events = { committed: event(), updated: event(), removed: event(), replaced: event(), permissionAdded: event(), permissionRemoved: event(), storage: event() };
  const changes = [], requests = [], reads = [], writes = []; let getFrames, handler;
  const state = { frames: [{ frameId: 0, documentId: 'main-1', documentLifecycle: 'active', url: 'https://top.fixture.invalid/path?QUERY_SENTINEL#FRAGMENT_SENTINEL' }], reports: new Map([[0, report()]]) };
  const api = { runtime: { id: 'owned', getURL: path => 'chrome-extension://owned/' + path },
    webNavigation: { onCommitted: events.committed, async getAllFrames(request) { reads.push(copy(request)); return getFrames ? getFrames(request) : copy(state.frames); } },
    tabs: { onUpdated: events.updated, onRemoved: events.removed, onReplaced: events.replaced, update: (...args) => writes.push(['tabs.update', args]), reload: (...args) => writes.push(['tabs.reload', args]) },
    permissions: { onAdded: events.permissionAdded, onRemoved: events.permissionRemoved, request: (...args) => writes.push(['permissions.request', args]) },
    storage: { onChanged: events.storage, local: { set: (...args) => writes.push(['storage.set', args]) } } };
  const sendRequest = async request => { requests.push(copy(request)); if (handler) return handler(request); return { ok: true, response: { schemaVersion: 1, type: 'report', report: copy(state.reports.get(request.frameId ?? 0) ?? null) } }; };
  const controller = createApiObservedUsageController(api, { sendRequest, onChange: value => changes.push(copy(value)), pollMs: 60000, deadlineMs });
  const f = { api, controller, events, state, requests, reads, writes, changes, doc, win,
    handler: value => { handler = value; }, getFrames: value => { getFrames = value; },
    reply: (request, value = state.reports.get(request.frameId ?? 0) ?? null) => ({ ok: true, response: { schemaVersion: 1, type: 'report', report: copy(value) } }),
    hide(value = true) { doc.visibilityState = value ? 'hidden' : 'visible'; visibility.emit(); },
    start() { controller.setActive(true); return controller.refresh(); },
    tick(ms) { t.mock.timers.tick(ms); },
    get visibilityListeners() { return visibility.size; } };
  t.after(() => { controller.dispose(); for (const key of ['window', 'location', 'document', 'browser']) { if (prior[key]) Object.defineProperty(globalThis, key, prior[key]); else delete globalThis[key]; } });
  return f;
}
const used = f => Object.keys(f.controller.getState().byApi ?? {});

test('source binding accepts one exact safe native ID and rejects duplicates, coercion syntax and oversized IDs', () => {
  for (const value of [0, 17, 2147483647]) assert.equal(observedSourceTabId('chrome-extension://owned/options.html?tabId=' + value), value);
  for (const query of ['', '?tabId=', '?tabId=01', '?tabId=-1', '?tabId=1.0', '?tabId=1e2', '?tabId=2147483648', '?tabId=1&tabId=2', '?tabId=1&tabId=1']) assert.equal(observedSourceTabId('chrome-extension://owned/options.html' + query), null);
});
test('own top-level Options boundary prevents every native read on foreign routes and framed contexts', async t => {
  const f = fixture(t);
  for (const href of ['https://owned/options.html?tabId=17', 'chrome-extension://other/options.html?tabId=17', 'chrome-extension://owned/popup.html?tabId=17', 'chrome-extension://owned/options.html/child?tabId=17']) {
    globalThis.location.href = href; await f.start(); assert.equal(f.reads.length, 0); assert.equal(f.requests.length, 0);
    f.controller.setActive(false);
  }
  globalThis.location.href = ownHref; f.win.top = {}; await f.start(); assert.equal(f.reads.length, 0);
});
test('no source and inactive/hidden panels perform no reads or writes', async t => {
  const f = fixture(t, { href: 'chrome-extension://owned/options.html#antidetect' }); await f.start(); f.tick(60000); await turn();
  assert.equal(f.reads.length, 0); assert.equal(f.requests.length, 0); assert.equal(f.controller.getState().status, 'no-site'); assert.deepEqual(f.writes, []);
});
test('a positive ordinary report is bound to current native document IDs and excludes full URLs and values', async t => {
  const f = fixture(t); await f.start(); const value = f.controller.getState();
  assert.equal(value.documentKey, '17:0:main-1'); assert.equal(value.host, 'fixture.invalid'); assert.ok(used(f).includes('screen-width'));
  assert.equal(f.reads.length, 2); assert.deepEqual(f.requests, [{ schemaVersion: 1, type: 'ui-get-report', tabId: 17 }]); assert.deepEqual(f.writes, []);
  const serialized = JSON.stringify(value); for (const secret of ['QUERY_SENTINEL', 'FRAGMENT_SENTINEL', 'https://', 'api-results', 'pro-values', 'configuration']) assert.equal(serialized.includes(secret), false, secret);
});
test('source tab activation changes never retarget the explicitly pinned source', async t => {
  const f = fixture(t); await f.start(); await f.controller.refresh();
  assert.ok(f.requests.every(request => request.tabId === TAB)); assert.ok(f.reads.every(request => request.tabId === TAB));
  assert.equal(f.api.tabs.onActivated, undefined, 'there is no active-tab fallback subscription');
});
test('main document changes during a held response immediately clear usage and ignore the late old document', async t => {
  const f = fixture(t); await f.start(); const held = defer(); f.handler(() => held.promise); const old = f.controller.refresh(); await turn();
  const oldReport = report(); f.state.frames[0].documentId = 'main-2'; f.state.reports.set(0, report(0, 'main-2'));
  f.events.committed.emit({ tabId: TAB, frameId: 0, documentId: 'main-2' }); assert.deepEqual(used(f), []);
  const before = f.requests.length; void f.controller.refresh(); await turn(); assert.equal(f.requests.length, before, 'physical request remains reserved');
  held.resolve(f.reply({}, oldReport)); await old; assert.deepEqual(used(f), []);
  f.handler(null); await f.controller.refresh(); assert.equal(f.controller.getState().documentKey, '17:0:main-2'); assert.ok(used(f).includes('screen-width'));
});
test('navigation without a UI event is caught by final native revalidation', async t => {
  const f = fixture(t); let reads = 0;
  f.getFrames(() => ++reads === 1 ? copy(f.state.frames) : [{ ...f.state.frames[0], documentId: 'silently-new' }]);
  await f.start(); assert.deepEqual(used(f), []); assert.equal(f.controller.getState().documentKey, null);
});
test('unavailable/paused results also revalidate the native document before publishing its old identity', async t => {
  const f = fixture(t); const held = defer(); f.handler(() => held.promise); const job = f.start(); await turn();
  f.state.frames[0].documentId = 'main-2'; held.resolve(f.reply({}, report(0, 'main-1', { coverageState: 'paused' }))); await job;
  assert.notEqual(f.controller.getState().documentKey, '17:0:main-1'); assert.deepEqual(used(f), []);
});
test('hiding/deactivating during a held request clears state and stale settlement cannot reopen it', async t => {
  const f = fixture(t); await f.start(); const held = defer(); f.handler(() => held.promise); const job = f.controller.refresh(); await turn();
  f.hide(); assert.deepEqual(used(f), []); const reads = f.reads.length; f.tick(120000); await turn(); assert.equal(f.reads.length, reads);
  held.resolve(f.reply({})); await job; assert.deepEqual(used(f), []); f.controller.setActive(false); f.hide(false); f.tick(60000); await turn(); assert.equal(f.reads.length, reads);
});
test('deadline invalidates state while keeping one physical request until the native promise settles', async t => {
  const f = fixture(t, { deadlineMs: 100 }); await f.start(); const held = defer(); f.handler(() => held.promise); const job = f.controller.refresh(); await turn();
  f.tick(101); assert.equal(f.controller.getState().status, 'error'); assert.deepEqual(used(f), []);
  const before = f.requests.length; for (let index = 0; index < 8; index++) void f.controller.refresh(); f.tick(60000); await turn(); assert.equal(f.requests.length, before);
  held.resolve(f.reply({})); await job; assert.deepEqual(used(f), []);
  f.handler(null); await f.controller.refresh(); assert.ok(used(f).includes('screen-width'));
});
test('source close/replacement cannot resurrect cached usage or select another tab', async t => {
  const f = fixture(t); await f.start(); f.events.removed.emit(TAB); assert.deepEqual(used(f), []); assert.equal(f.controller.getState().status, 'no-site');
  const reads = f.reads.length; f.tick(120000); await f.controller.refresh(); assert.equal(f.reads.length, reads); assert.deepEqual(f.writes, []);
});
test('permission and canonical scope/consent storage changes invalidate usage before refreshing', async t => {
  const f = fixture(t); await f.start();
  for (const [area, key] of [['local', 'scope'], ['local', 'data-consent:v1'], ['session', 'data-consent:pending-v1']]) {
    f.events.storage.emit({ [key]: { newValue: false } }, area); assert.deepEqual(used(f), [], area + ':' + key); await f.controller.refresh();
  }
  f.events.permissionRemoved.emit({ origins: ['https://top.fixture.invalid/*'] }); assert.deepEqual(used(f), []);
});
test('relation describes frame contexts; stale/replaced child documents are excluded', async t => {
  const f = fixture(t);
  f.state.frames.push({ frameId: 1, documentId: 'child-1', documentLifecycle: 'active', url: 'https://other.invalid/frame' }); f.state.reports.set(1, report(1, 'child-1', { host: 'other.invalid', count: 2 }));
  await f.start(); let row = f.controller.getState().byApi['screen-width']; assert.equal(row.count, 3); assert.equal(row.thirdPartyCount, 2); assert.equal(row.firstPartyCount, 1);
  let reads = 0; f.getFrames(() => { const frames = copy(f.state.frames); if (++reads > 1) frames[1].documentId = 'child-replaced'; return frames; });
  await f.controller.refresh(); row = f.controller.getState().byApi['screen-width']; assert.equal(row.count, 1); assert.equal(f.controller.getState().truncated, true);
});
test('partial, late and degraded child coverage lowers the combined context and preserves admitted flags', async t => {
  const f = fixture(t);
  f.state.frames.push({ frameId: 1, documentId: 'child-1', documentLifecycle: 'active', url: 'https://other.invalid/frame' });
  for (const coverageState of ['partial', 'late-start', 'degraded']) {
    f.state.reports.set(1, report(1, 'child-1', { host: 'other.invalid', coverageState, coverageFlags: ['late-start', 'hook-failed'] }));
    await f.start(); const usage = f.controller.getState();
    assert.equal(usage.byApi['screen-width'].count, 2, coverageState + ': available observations are retained');
    assert.equal(usage.coverageState, 'partial', coverageState + ': an active parent cannot hide partial child coverage');
    assert.equal(usage.truncated, true);
    assert.ok(usage.coverageFlags.includes('late-start')); assert.ok(usage.coverageFlags.includes('hook-failed'));
  }
});
test('frame request budget is32 with at most4 simultaneous child report requests', async t => {
  const f = fixture(t); for (let index = 1; index <= 40; index++) { f.state.frames.push({ frameId: index, documentId: 'child-' + index, documentLifecycle: 'active', url: 'https://other.invalid/' }); f.state.reports.set(index, report(index)); }
  const gates = []; let active = 0, maximum = 0, release = false;
  f.handler(async request => { if (!request.frameId || release) return f.reply(request); active++; maximum = Math.max(maximum, active); const held = defer(); gates.push(held); try { await held.promise; return f.reply(request); } finally { active--; } });
  const job = f.start(); await turn(); assert.equal(gates.length, 4); assert.equal(maximum, 4); release = true; for (const gate of gates) gate.resolve(); await job;
  assert.equal(f.requests.length, 32); assert.equal(f.controller.getState().documentCount, 32); assert.equal(f.controller.getState().truncated, true);
});
test('route/source binding changes revoke cached state even while a physical request is held', async t => {
  const f = fixture(t); await f.start(); const held = defer(); f.handler(() => held.promise); const job = f.controller.refresh(); await turn();
  globalThis.location.href = 'chrome-extension://owned/options.html?tabId=99#api';
  held.resolve(f.reply({})); await job; assert.deepEqual(used(f), []); assert.equal(f.controller.getState().documentKey, null);
});
test('dispose removes every listener and prevents delayed publication/read/write', async t => {
  const f = fixture(t); const held = defer(); f.handler(() => held.promise); const job = f.start(); await turn(); f.controller.dispose();
  for (const item of Object.values(f.events)) assert.equal(item.size, 0); assert.equal(f.visibilityListeners, 0);
  held.resolve(f.reply({})); await job; f.tick(120000); await f.controller.refresh(); assert.deepEqual(used(f), []); assert.deepEqual(f.writes, []);
});
test('Firefox frame reads preserve adapter document identities while native passive events invalidate and clean up', async t => {
  const nativeEvents = { committed: event(), updated: event(), removed: event(), replaced: event(), permissionAdded: event(), permissionRemoved: event(), storage: event() };
  let nativeReads = 0;
  const nativeBrowser = { runtime: { id: 'owned', getURL: path => 'chrome-extension://owned/' + path },
    webNavigation: { onCommitted: nativeEvents.committed, async getAllFrames() { nativeReads++; return [{ frameId: 0, url: 'https://top.fixture.invalid/' }]; } },
    tabs: { onUpdated: nativeEvents.updated, onRemoved: nativeEvents.removed, onReplaced: nativeEvents.replaced },
    permissions: { onAdded: nativeEvents.permissionAdded, onRemoved: nativeEvents.permissionRemoved }, storage: { onChanged: nativeEvents.storage } };
  const f = fixture(t, { nativeBrowser }); await f.start();
  assert.ok(used(f).includes('screen-width')); assert.equal(f.reads.length, 2, 'before/after identity snapshots use the supplied adapter'); assert.equal(nativeReads, 0, 'native Firefox138 records lack the adapter documentId');
  assert.equal(f.events.committed.size, 0, 'adapter event wrappers need not expose removal'); assert.equal(nativeEvents.committed.size, 1);
  const held = defer(); f.handler(() => held.promise); const job = f.controller.refresh(); await turn();
  f.state.frames[0].documentId = 'main-2'; nativeEvents.committed.emit({ tabId: TAB, frameId: 0 }); assert.deepEqual(used(f), [], 'native event requires no documentId to invalidate');
  held.resolve(f.reply({}, report())); await job; assert.deepEqual(used(f), []);
  f.controller.dispose(); for (const item of Object.values(nativeEvents)) assert.equal(item.size, 0); assert.equal(f.visibilityListeners, 0);
});
test('Firefox safe-integer frame IDs retain exact report routing while source tab IDs stay32-bit', async t => {
  const f = fixture(t), frameId = 12884901889;
  f.state.frames.push({ frameId, documentId: 'firefox-large-frame', documentLifecycle: 'active', url: 'https://other.invalid/frame' });
  f.state.reports.set(frameId, report(frameId, 'firefox-large-frame', { host: 'other.invalid', count: 2 }));
  await f.start();
  assert.deepEqual(f.requests.find(request => request.frameId === frameId), { schemaVersion: 1, type: 'ui-get-report', tabId: TAB, frameId });
  const row = f.controller.getState().byApi['screen-width']; assert.equal(row.count, 3); assert.equal(row.thirdPartyCount, 2);
  assert.ok(row.sources.some(source => source.documentKey === '17:12884901889:firefox-large-frame'));
  assert.equal(observedSourceTabId('chrome-extension://owned/options.html?tabId=' + frameId), null, 'large frame support does not widen tab identity');
});
