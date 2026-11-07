// ADR-073: execute the delivered runtime after narrow synchronization, retaining its production sidecars.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { namedClass } from '../production/clear-reset-tools.mjs';
import { patchClearRuntime, clearRuntimeMembers } from '../production/clear-runtime-patches.mjs';
import { createProReportHistory, withProReportHistoryPurge } from '../../apps/production-extension/pro-report-history.js';
import { canonicalSessionValidator, stoppedProSession, memoryHistoryBackend } from './pro-report-history-fixture.mjs';

const source = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
const patched = patchClearRuntime(source);
const original = namedClass(source, 'BackgroundRuntime', 'background.js');
const updated = namedClass(patched, 'BackgroundRuntime', 'background.js');
const methodName = node => node.name?.text ?? 'constructor';
const before = new Map(original.node.members.map(node => [methodName(node), node.getText(original.tree)]));
const after = new Map(updated.node.members.map(node => [methodName(node), node.getText(updated.tree)]));
const key = '9:2:doc-native';
const state = () => ({ reports: new Map(), metas: new Map(), tabs: new Map(), bindings: new Map(), evictedKeys: [] });
const budgets = { maxCount: 2147483647, maxOutOfOrderEntriesGlobal: 128, maxReportSerializedBytes: 262144, maxCountersPerDocumentGroup: 128 };
const ok = () => undefined;
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function fixture() {
  const calls = [], timers = new Map(); let timerId = 0;
  const context = vm.createContext({
    console, crypto: webcrypto, BUDGETS: budgets, createInitialState: state,
    // Archive transactions/races have their own semantic suite. This fixture
    // preserves the existing reset runtime and executes its nested operation.
    withProReportHistoryPurge: async operation => ({ ok: true, value: await operation() }),
    ack2: (seq, paused, protocolOk) => ({ schemaVersion: 1, type: 'ack', lastCommittedBatchSeq: seq, paused, protocolOk }),
    uiError: code => ({ schemaVersion: 1, type: 'error', code }),
    // Contract reader has independent hostile-descriptor tests; here the real control routing is exercised.
    validateBridgeResetAck: raw => raw?.type === 'bridge-reset-ack' ? { ok: true, value: raw } : { ok: false },
    estimateReportBytes: () => 100,
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    reduce: (current, event) => {
      calls.push(['reduce', event.type]);
      if (event.type === 'ui:clear') {
        const report = current.reports.get(event.documentKey), meta = current.metas.get(event.documentKey);
        current = { ...current, reports: new Map(current.reports), metas: new Map(current.metas) };
        current.reports.set(event.documentKey, { ...report, revision: event.fence.reportRevision, counters: [], findings: [], hosts: [] });
        current.metas.set(event.documentKey, { ...meta, cleared: true, clearEpoch: event.fence.bridgeSessionId, clearBootIds: event.fence.sensorBootIds });
      }
      if (event.type === 'scope:access') current.metas.set(event.documentKey, { ...current.metas.get(event.documentKey), accessGranted: event.accessGranted, revoked: !event.accessGranted });
      return { state: current, effects: [] };
    },
    hasPendingFrameOrigin: () => false, deriveCoverageState: () => 'partial', coverageRef: () => 'coverage',
    projectReport2: report => report, reportHost: value => value, redactSenderContext: value => value, DATA_CONSENT_PENDING_KEY: 'consent-pending',
  });
  vm.runInContext('var BackgroundRuntime = ' + updated.node.getText(updated.tree) + ';', context);
  const runtime = Object.create(context.BackgroundRuntime.prototype);
  Object.assign(runtime, {
    state: state(), isReady: true, historyLoaded: true, historyLoading: null, ready: Promise.resolve(),
    api: { tabs: { sendMessage: async (tabId, message, options) => {
      calls.push(['send', tabId, message, options]);
      return { schemaVersion: 1, type: 'bridge-reset-ack', resetId: message.resetId, bridgeSessionId: 'fresh-session', sensorBootIds: ['fresh-boot'] };
    }, query: async () => [] } },
    scope: { hasDataConsent: true, accessReady: true, accessGeneration: 1, dataConsentLoaded: true,
      getScopeMode: () => 'all-sites', getState: () => ({ grantedAllSites: true }), hasBroadNetworkAccess: () => true, inScope: () => true },
    engine: {}, clock: { now: () => 1000 },
    clearingDocs: new Set(), resetRequests: new Map(), dirtyDocs: new Set(), persistTimers: new Map(),
    transportDrops: new Map(), persisted: new Map(), estimated: new Map(), documentAccess: new Map([[key, 1]]),
    pending: [], pendingPageDrops: new Map(), pendingPageBatches: 0, pendingDropped: 0, pendingNetworkLoss: false,
    persistFailures: 0, degraded: false, maxPending: 256, persistCooldownUntil: 0, maxPersistAttempts: 1,
    indexDirty: false, indexRevision: 0, indexTimer: null, enumeratedFrames: new Set(),
    repository: { run: async (_, fn) => fn(), runMany: async (_, fn) => fn(), clearFenceBytes: 0,
      commitClear: async (fences, bytes) => { calls.push(['commit', fences, bytes]); return { committed: true, cleaned: true }; },
      commit: async () => ({ ok: true }), clearAll: async () => true,
    },
    apiResults: { prepareClear: async () => ({ ready: true, reset: true }), invalidate: () => calls.push(['invalidate']), afterEvent: event => calls.push(['api-event', event.type]) },
    visual: { clearDocument: value => calls.push(['visual', value]), flush: async () => {}, clear: ok, afterEvent: ok, onBrowserEvent: ok, start: async () => {} },
    rtc: { clearDocument: value => calls.push(['rtc', value]), flush: async () => {}, clear: ok, afterEvent: ok, onBrowserEvent: ok, start: async () => {}, estimatedBytes: () => 0, vendorEvidence: () => ({ observations: [], observedAt: null }) },
    googleIds: { clear: ok, afterEvent: ok, onBrowserEvent: ok }, responseHeaders: { clear: ok, onBrowserEvent: ok },
    badge: { mark: value => calls.push(['badge', value]), markAll: ok, afterEvent: ok, start: ok },
    networkAttempts: { clear: ok, flush: ok, afterEvent: ok },
    pro: { onLightClear: value => calls.push(['pro-light', value]), flush: async () => {}, clear: async () => true, start: async () => {},
      afterEvent: ok, resumeValueCapture: async (value, resume) => { calls.push(['resume-values', value]); resume(); },
      vendorRedirects: { clearDocument: value => calls.push(['pro-redirect', value]), clear: ok } },
    vendorRedirects: { clearDocument: value => calls.push(['redirect', value]), clear: ok },
    cookieProbe: { invalidate: value => calls.push(['probe', value]) },
    siteIcons: { invalidate: async () => {}, refresh: async () => {} }, protection: { suspendAccess: async () => {}, start: async () => {} },
    keepProtectSessionKey: () => true,
    markApiResultsReset: ok, persistApiResultsReset: async () => true, markIndexDirty: ok,
    runEffects: ok, reconcileAccess: ok, reconcile: async () => {}, schedulePersist: ok, enforceTotalBudget: ok,
    scheduleIndexFlush: ok,
  });
  for (const name of ['cookies', 'proCookieValues', 'proRequestValues', 'social', 'thirdParty', 'beacons', 'backgroundActivity', 'cookieWriters']) runtime[name] = {
    forget: value => calls.push([name, 'forget', value]), clear: () => calls.push([name, 'clear']), onEvent: event => calls.push([name, event.type]),
  };
  runtime.state.reports.set(key, { tabId: 9, frameId: 2, documentId: 'doc-native', documentKey: key, revision: 7, lifecycle: 'active', counters: [{ count: 100 }], findings: [], hosts: [], coverageFlags: [], dropped: { transport: 0 } });
  runtime.state.metas.set(key, { documentKey: key, bound: true, paused: false, revoked: false, accessGranted: true, sensorSeen: true, boots: [{ sensorBootId: 'old' }], sessions: [] });
  return { runtime, calls, timers, context };
}

test('runtime sync is idempotent, preserves constructor and every unowned byte, rejects edited ownership', () => {
  assert.equal(patchClearRuntime(patched), patched);
  for (const [name, text] of before) if (!clearRuntimeMembers.includes(name)) assert.equal(after.get(name), text, name);
  assert.equal(patched.slice(0, updated.node.getStart(updated.tree)), source.slice(0, original.node.getStart(original.tree)));
  assert.equal(patched.slice(updated.node.end), source.slice(original.node.end));
  assert.throws(() => patchClearRuntime(patched.replace('clear-storage', 'clear-forged')), /inserted member drift/);
});

test('actual reset routes to browser-derived document; hung requests hold cap4 even after timeout', async () => {
  const { runtime, calls, timers } = fixture();
  const fence = await runtime.resetHistoryActor(key);
  const send = calls.find(call => call[0] === 'send');
  assert.equal(send[1], 9); assert.equal(send[3].frameId, 2); assert.equal(send[3].documentId, 'doc-native');
  assert.equal(send[2].command, 'reset'); assert.equal(fence.bridgeSessionId, 'fresh-session'); assert.equal(runtime.resetRequests.size, 0);
  runtime.api.tabs.sendMessage = () => new Promise(() => {});
  for (let i = 0; i < 4; i++) {
    const next = key + i; runtime.state.reports.set(next, { ...runtime.state.reports.get(key), documentKey: next }); runtime.state.metas.set(next, { ...runtime.state.metas.get(key), documentKey: next });
    const pending = runtime.resetHistoryActor(next), rejection = assert.rejects(pending, /reset-timeout/);
    const [id, timer] = [...timers].at(-1); assert.equal(timer.delay, 2500); timers.delete(id); timer.fn(); await rejection;
  }
  assert.equal(runtime.resetRequests.size, 4);
  await assert.rejects(runtime.resetHistoryActor(key), /reset-busy/);
});

test('clear awaits durable authority, keeps production sidecars and Pro Light semantics, advances revision floor', async () => {
  const { runtime, calls } = fixture(); let release;
  runtime.repository.commitClear = async fences => { calls.push(['commit', fences]); await new Promise(resolve => { release = resolve; }); return { committed: true, cleaned: true }; };
  const operation = runtime.clear(9, key, 7); await settle(); await settle();
  assert.equal(runtime.clearingDocs.has(key), true); assert.equal(runtime.projectionByKey(key), null);
  release(); const result = await operation;
  assert.equal(result.type, 'ok'); assert.equal(runtime.state.reports.get(key).counters.length, 0); assert.equal(runtime.clearingDocs.size, 0);
  assert.equal(runtime.state.reports.get(key).revision, 8);
  assert.ok(calls.some(call => call[0] === 'pro-light')); assert.ok(calls.some(call => call[0] === 'pro-redirect'));
  for (const name of ['cookies', 'proCookieValues', 'proRequestValues', 'social', 'thirdParty', 'beacons', 'backgroundActivity', 'cookieWriters']) assert.ok(calls.some(call => call[0] === name && call[1] === 'forget'), name);
  assert.ok(calls.some(call => call[0] === 'api-event' && call[1] === 'ui:clear'));
});

test('clear rejects failed authority and failed cleanup instead of returning false success', async () => {
  for (const result of [{ committed: false, cleaned: false }, { committed: true, cleaned: false }]) {
    const { runtime } = fixture(); runtime.repository.commitClear = async () => result;
    await assert.rejects(runtime.clear(9, key, 7), result.committed ? /clear-cleanup/ : /clear-storage/);
    assert.equal(runtime.clearingDocs.size, 0);
    assert.equal(runtime.state.reports.get(key).counters.length, result.committed ? 0 : 1);
  }
});

test('paused empty record remains resumable through original Pro value-capture lifecycle', async () => {
  const { runtime, calls } = fixture(); runtime.state.metas.get(key).paused = true;
  await runtime.clear(9, key, 7);
  const revision = runtime.state.reports.get(key).revision;
  assert.notEqual(runtime.projectionByKey(key), null);
  assert.equal((await runtime.resume(9, key, revision)).type, 'ok');
  assert.ok(calls.some(call => call[0] === 'resume-values' && call[1] === key));
  assert.ok(calls.some(call => call[0] === 'send' && call[2].command === 'resume'));
});

test('session clear still clears Protect session and every production sidecar', async () => {
  const { runtime, calls } = fixture(); runtime.onProtectClearSession = () => calls.push(['protect-session']);
  assert.equal((await runtime.clearSession()).type, 'ok');
  assert.ok(calls.some(call => call[0] === 'protect-session'));
  for (const name of ['cookies', 'proCookieValues', 'proRequestValues', 'social', 'thirdParty', 'beacons', 'backgroundActivity', 'cookieWriters']) assert.ok(calls.some(call => call[0] === name && call[1] === 'clear'), name);
});

for (const deniedAt of ['ready', 'authority', 'module-callback']) test('ADR-097 session clear does not touch saved history when ' + deniedAt + ' rejects before reset', async () => {
  const f = fixture(), storage = memoryHistoryBackend(), history = createProReportHistory({ storage, validateSession: canonicalSessionValidator(), now: () => 3000 });
  const captured = await history.captureEpoch();
  await history.save(stoppedProSession(), captured);
  const stopped = Error(deniedAt);
  let purgeCalls = 0, callbackCalls = 0;
  f.context.withProReportHistoryPurge = operation => { purgeCalls++; return withProReportHistoryPurge(operation, { storage, makeEpoch: () => 'must-not-purge' }); };
  f.runtime.onProtectClearSession = () => { callbackCalls++; if (deniedAt === 'module-callback') throw stopped; };
  if (deniedAt === 'ready') f.runtime.ready = Promise.reject(stopped);
  if (deniedAt === 'authority') f.runtime.ensureHistory = async () => { throw stopped; };
  await assert.rejects(f.runtime.clearSession(), error => error === stopped);
  assert.equal(purgeCalls, 0);
  assert.equal(callbackCalls, deniedAt === 'module-callback' ? 1 : 0);
  assert.equal(await history.captureEpoch(), captured);
  assert.equal((await history.list()).length, 1);
});

for (const method of ['clearSession', 'discardUnconsentedData']) test('ADR-097 actual ' + method + ' purges saved snapshots with all UI closed and rejects stale saves', async () => {
  const f = fixture(), storage = memoryHistoryBackend(), history = createProReportHistory({ storage, validateSession: canonicalSessionValidator(), now: () => 3000 });let epoch = 0, during;
  f.context.withProReportHistoryPurge = operation => withProReportHistoryPurge(operation, { storage, makeEpoch: () => 'runtime-purge-' + ++epoch });
  const before = await history.captureEpoch();await history.save(stoppedProSession(), before);
  f.runtime.pro.clear = async () => { assert.deepEqual(await history.list(), [], 'archive is erased before the old live-session reset');during = await history.captureEpoch();await history.save(stoppedProSession('during-old-reset'), during); };
  const result = await f.runtime[method]();assert.equal(method === 'clearSession' ? result.type === 'ok' : result, true);
  assert.equal(epoch, 2);assert.deepEqual(await history.list(), []);assert.deepEqual(storage.dump('reports'), []);
  for (const captured of [before, during]) await assert.rejects(history.save(stoppedProSession('late'), captured), /history-stale/);
});

for (const method of ['clearSession', 'discardUnconsentedData']) test('ADR-097 actual ' + method + ' reports failed archive erase while still running the existing clear', async () => {
  const f = fixture(), storage = memoryHistoryBackend();let epoch = 0, cleared = 0;
  f.context.withProReportHistoryPurge = operation => withProReportHistoryPurge(operation, { storage, makeEpoch: () => 'failed-purge-' + ++epoch });
  storage.failNext('reports');f.runtime.pro.clear = async () => { cleared++; };
  const result = await f.runtime[method]();assert.equal(cleared, 1);assert.equal(epoch, 2);
  if (method === 'clearSession') { assert.equal(result.type, 'error');assert.equal(result.code, 'no-access'); } else assert.equal(result, false);
});

test('ADR-097 generator rejects edits to the reviewed purge wrapper instead of accepting arbitrary method changes', () => {
  assert.throws(() => patchClearRuntime(patched.replace('savedReportsPurge.ok ?', 'true ?')), /source drift/);
  const archiveImport = 'import { withProReportHistoryPurge } from "./pro-report-history.js";\n';
  assert.throws(() => patchClearRuntime(archiveImport + patched.replace(archiveImport, '')), /existing first-line Protect import/);
  assert.throws(() => patchClearRuntime(patched + '\n' + archiveImport), /Duplicate archive purge import/);
});

test('ADR-076 global clear and consent purge wait for credential erasure and reject a failed erase',async()=>{
  for(const method of ['clearSession','discardUnconsentedData'])for(const success of [true,false]) {
    const {runtime}=fixture();let finish,settled=false;
    runtime.precursorModes={clear:()=>new Promise(resolve=>{finish=resolve;})};
    const pending=runtime[method]().then(value=>{settled=true;return value;});await settle();assert.equal(settled,false);assert.equal(typeof finish,'function');
    finish(success);const result=await pending;
    if(method==='clearSession')assert.equal(result.type,success?'ok':'error');else assert.equal(result,success);
  }
});

test('production persistence callback and Firefox network capability remain effective', async () => {
  const { runtime, calls } = fixture(); runtime.onProtectReportPersisted = (...args) => calls.push(['protect-persist', ...args]);
  assert.equal(await runtime.persistNow(key), true); assert.ok(calls.some(call => call[0] === 'protect-persist' && call[1] === key));
  runtime.api.__detectExpertCapabilities = { networkDocumentIdentity: false };
  assert.ok(runtime.projectionByKey(key).coverageFlags.includes('network-limited'));
});

test('authority failure closes persistence and retries share one bounded recovery', async () => {
  const { runtime } = fixture(); runtime.historyLoaded = false; let reads = 0, release;
  runtime.repository.loadAll = async () => { reads++; await new Promise(resolve => { release = resolve; }); return { index: null, documents: [] }; };
  runtime.hydrate = ok;
  const pending = Array.from({ length: 160 }, () => runtime.whenPageReady(key));
  await settle(); assert.equal(reads, 1); assert.equal(runtime.pendingPageBatches, 128); assert.equal(runtime.pendingDropped, 32);
  assert.equal(await runtime.persistNow(key), false);
  release(); const results = await Promise.all(pending);
  assert.equal(results.filter(Boolean).length, 128); assert.equal(runtime.pendingPageBatches, 0); assert.equal(runtime.historyLoaded, true);
  runtime.historyLoaded = false; runtime.repository.loadAll = async () => { throw Error('read-failed'); };
  await assert.rejects(runtime.whenPageReady(key), /read-failed/);
  assert.equal(runtime.historyLoaded, false); assert.equal(runtime.state.reports.size, 0); assert.equal(runtime.documentAccess.size, 0);
});

test('restored inactive fence performs a real reset after verified regrant and discards its first old batch', async () => {
  const { runtime, calls } = fixture();
  Object.assign(runtime.state.metas.get(key), { clearEpoch: 'retired', clearBootIds: [], accessGranted: false, revoked: true });
  runtime.documentAccess.clear();
  const response = await runtime.handleBatch({ documentKey: key, tabId: 9, frameId: 2, documentId: 'doc-native', host: 'example.com', originPattern: 'https://example.com/*' }, { bridgeSessionId: 'old-session', batchSeq: 44 }, true);
  assert.equal(response.lastCommittedBatchSeq, 0);
  assert.equal(response.paused, false);
  assert.ok(calls.some(call => call[0] === 'send' && call[2].command === 'reset'));
  assert.equal(runtime.state.metas.get(key).clearEpoch, 'fresh-session');
  assert.equal(runtime.state.reports.get(key).counters.length, 0);
});

test('TTL payload removal retains the routing fence while the document tab remains open', async () => {
  const { runtime, calls } = fixture();
  runtime.repository.remove = async (keys, forget) => { calls.push(['remove', keys, forget]); return true; };
  runtime.state.tabs.set(9, {});
  runtime.queueRemove(key, false); await settle();
  assert.equal(calls.findLast(call => call[0] === 'remove')[2], false);
  runtime.state.tabs.delete(9);
  runtime.queueRemove(key, false); await settle();
  assert.equal(calls.findLast(call => call[0] === 'remove')[2], true);
});
