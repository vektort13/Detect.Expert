// ADR-038 independent regression: native Pro start/stop must survive lost acknowledgements.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { test } from 'node:test';
import { runtimeSource } from '../production/pro-values-runtime.mjs';
import { classMember } from '../production/clear-reset-tools.mjs';
import { patchRuntimeResumeLifecycle } from '../production/sync-pro-values-lifecycle.mjs';
import { readCookieSnapshot, normalizeProCookieMetadata, readLoaderRows, readTagManagerDocuments, readSocialRows, readSocialDocuments, mergeLoaderRows } from '../../packages/contracts/src/inspection.mjs';
import { readAdvancedPageFields } from '../../packages/contracts/src/advanced-inspection.mjs';
import { ProCookieCapture } from '../../apps/production-extension/pro-cookie-capture.js';
import { createVendorRedirectTracker } from '../../apps/production-extension/vendor-redirects.js';

const root = new URL('../../', import.meta.url);
const source = readFileSync(new URL('apps/production-extension/background.js', root), 'utf8');
const contracts = source.slice(0, source.indexOf('// packages/attribution/src/psl-index.json')).replace(/^import[^\n]*\n/gm, '');
const first = source.indexOf('// packages/background/src/pro-recording.ts'), last = source.indexOf('// packages/background/src/local-probe-window.ts', first);
assert.ok(first > 0 && last > first);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture() {
  // Stop/authorization cases do not observe network resources.
  const createRuntimeVendorRedirects = () => createVendorRedirectTracker({ match: () => [] });
  const context = vm.createContext({ atob, btoa, TextEncoder, structuredClone, setTimeout, clearTimeout, crypto: webcrypto, readCookieSnapshot, normalizeProCookieMetadata, readLoaderRows, readTagManagerDocuments, readSocialRows, readSocialDocuments, mergeLoaderRows, readAdvancedPageFields, ProCookieCapture, createRuntimeVendorRedirects });
  vm.runInContext(contracts + '\n' + runtimeSource + '\n' + source.slice(first, last), context);
  const page = { id: 'page-1', tabId: 1, documentKey: '1:0:native-doc', apiValues: [], reports: [], resources: [] };
  const binding = { documentKey: page.documentKey, documentId: 'native-doc', tabId: 1, frameId: 0, documentLifecycle: 'active' };
  const calls = [], sensor = { token: '' };
  // Production reducer indexes this Map by tab/frame slot, not documentKey.
  const runtime = { now: () => 100, scope: { hasDataConsent: true, accessGeneration: 1 }, state: { bindings: new Map([['1:0', binding]]) }, apiResults: { authorize: async () => true, trackOperation: () => true, releaseOperation() {} }, api: { tabs: { sendMessage: async (tabId, request, target) => {
    calls.push({ tabId, ...request, target });
    if (request.type === 'pro-values-stop') { if (request.sessionId === sensor.token) sensor.token = ''; return { schemaVersion: 1, type: 'pro-values-stopped' }; }
    if (request.type === 'pro-values-start') sensor.token = request.sessionId;
    return { schemaVersion: 1, type: 'pro-values-cache', sessionId: request.sessionId, available: request.sessionId === sensor.token, truncated: false, rows: [] };
  } } } };
  const manager = new context.ProRecordingManager(runtime);
  manager.session = { id: 'test-session', status: 'recording', deadlineAt: 1000, pages: [page], limitations: [] };
  manager.trackedTabs.add(1); manager.currentPages.set(1, page.id); manager.belongsToPage = () => true; manager.mark = () => {};
  const capture = async () => { await manager.captureValues(); clearTimeout(manager.proValueTimer); manager.proValueTimer = null; };
  const stop = () => { manager.stopValueCapture(); manager.session.status = 'stopped'; };
  return { manager, runtime, page, binding, calls, sensor, capture, stop };
}

for (const outcome of ['unavailable', 'invalid', 'reject', 'timeout']) test('stop retains the native target when the start response is ' + outcome, async () => {
  const f = fixture(), native = f.runtime.api.tabs.sendMessage, pending = deferred();
  f.runtime.api.tabs.sendMessage = async (...args) => {
    const response = await native(...args);
    if (args[1].type === 'pro-values-stop') return response;
    if (outcome === 'unavailable') return { ...response, available: false };
    if (outcome === 'invalid') return { ...response, rows: null };
    if (outcome === 'reject') throw Error('lost acknowledgement');
    return pending.promise;
  };
  await f.capture(); assert.notEqual(f.sensor.token, ''); assert.equal(f.manager.proValueCaptures.size, 0);
  f.runtime.state.bindings.clear(); f.stop();
  assert.equal(f.sensor.token, ''); assert.equal(f.calls.at(-1).type, 'pro-values-stop');
  assert.equal(f.calls.at(-1).target.documentId, 'native-doc'); assert.equal(f.manager.proValueAttempts.size, 0);
  pending.resolve(null);
});

test('production frame-slot indexing admits the current native document and excludes a different slot owner', async () => {
  const f = fixture();
  assert.equal(f.runtime.state.bindings.has(f.binding.documentKey), false);
  await f.capture(); assert.notEqual(f.sensor.token, '');
  assert.equal(f.calls[0].type, 'pro-values-start'); assert.equal(f.calls[0].target.documentId, 'native-doc');
  const authorization = deferred(); f.runtime.apiResults.authorize = () => authorization.promise;
  const work = f.capture(); await Promise.resolve();
  f.runtime.state.bindings.set('1:0', { ...f.binding, documentKey: '1:0:new-owner', documentId: 'new-owner' });
  authorization.resolve(true); await work;
  assert.equal(f.calls.length, 1); f.stop(); assert.equal(f.sensor.token, '');
});

test('an unavailable read after a successful start cannot remove stop ownership', async () => {
  const f = fixture(); await f.capture(); const native = f.runtime.api.tabs.sendMessage;
  f.runtime.api.tabs.sendMessage = async (...args) => { const response = await native(...args); return args[1].type === 'pro-values-read' ? { ...response, available: false } : response; };
  await f.capture(); assert.equal(f.manager.proValueCaptures.size, 0); f.stop(); assert.equal(f.sensor.token, '');
});

test('stop while authorization is pending prevents later start and polling timer', async () => {
  const f = fixture(), authorization = deferred(); f.runtime.apiResults.authorize = () => authorization.promise;
  const work = f.capture(); await Promise.resolve(); f.stop(); authorization.resolve(true); await work;
  assert.equal(f.calls.length, 0); assert.equal(f.manager.proValueAttempts.size, 0); assert.equal(f.manager.proValueTimer, null);
});

test('stop between authorization and queued native dispatch prevents the start', async () => {
  const f = fixture(), bounded = f.manager.boundedPro.bind(f.manager); let operations = 0;
  f.manager.boundedPro = operation => bounded(() => { if (++operations === 2) f.stop(); return operation(); });
  await f.capture(); assert.equal(operations, 2); assert.equal(f.calls.length, 0); assert.equal(f.sensor.token, '');
});

test('permission generation change or navigation during authorization prevents stale dispatch', async () => {
  for (const change of ['permission', 'navigation']) {
    const f = fixture(), authorization = deferred(); f.runtime.apiResults.authorize = () => authorization.promise;
    const work = f.capture(); await Promise.resolve();
    if (change === 'permission') f.runtime.scope.accessGeneration++;
    else f.runtime.state.bindings.set('1:0', { ...f.binding, documentId: 'next-native-document', documentKey: '1:0:next-native-document' });
    authorization.resolve(true); await work; assert.equal(f.calls.length, 0); f.stop();
  }
});

test('a newly started session waits for old work then starts its own current epoch', async () => {
  const f = fixture(), authorization = deferred(); let authorizations = 0;
  f.runtime.apiResults.authorize = () => ++authorizations === 1 ? authorization.promise : Promise.resolve(true);
  const oldWork = f.manager.captureValues(); await Promise.resolve(); f.stop();
  f.manager.session = { ...f.manager.session, id: 'new-session', status: 'recording' };
  const newWork = f.capture(); authorization.resolve(true); await Promise.all([oldWork, newWork]);
  assert.equal(f.calls.filter(call => call.type === 'pro-values-start').length, 1);
  assert.match(f.sensor.token, /^new-session-/); f.stop(); assert.equal(f.sensor.token, '');
});

test('rearming capture within the same session and page uses a fresh non-retired MAIN token', async () => {
  const f = fixture(); await f.capture(); const oldToken = f.sensor.token;
  f.manager.stopValueCapture(); assert.equal(f.sensor.token, '');
  await f.capture(); const newToken = f.sensor.token;
  assert.notEqual(newToken, ''); assert.notEqual(newToken, oldToken);
  const bridge = bridgeFixture(); bridge.command('pro-values-stop', oldToken);
  assert.equal(bridge.command('pro-values-start', newToken), true);
  assert.equal(bridge.posts.at(-1).sessionId, newToken); f.stop();
});

for (const pauseAt of ['native-response', 'second-authorization']) test('same-session stop invalidates stale capture after pending ' + pauseAt, async () => {
  const f = fixture(), entered = deferred(), pending = deferred(), native = f.runtime.api.tabs.sendMessage;
  let authorizationCount = 0;
  const savedRow = { operation: 'Window.innerWidth', techniqueId: 'DET-030', phase: 'returned-sync', value: { kind: 'number', value: 12345 }, parameters: [], count: 1 };
  f.runtime.api.tabs.sendMessage = async (...args) => {
    const response = await native(...args);
    if (args[1].type === 'pro-values-stop') return response;
    if (pauseAt === 'native-response') { entered.resolve(); await pending.promise; }
    return { ...response, rows: [savedRow] };
  };
  f.runtime.apiResults.authorize = async () => {
    if (++authorizationCount === 2 && pauseAt === 'second-authorization') { entered.resolve(); await pending.promise; }
    return true;
  };
  const work = f.capture(); await entered.promise;
  // Lifecycle cleanup can run before the recording ID/page is replaced.
  f.manager.stopValueCapture(); pending.resolve(); await work;
  assert.equal(f.page.apiValues.length, 0); assert.equal(f.manager.proValueCaptures.size, 0);
  assert.equal(f.sensor.token, ''); f.stop();
});

test('temporarily missing and BFCache bindings retain one eventual stop target and may rejoin', async () => {
  const f = fixture(); await f.capture(); const token = f.sensor.token;
  f.runtime.state.bindings.clear(); await f.capture(); assert.equal(f.manager.proValueAttempts.size, 1);
  f.runtime.state.bindings.set('1:0', { ...f.binding, documentLifecycle: 'cached' }); await f.capture();
  f.runtime.state.bindings.set('1:0', f.binding); await f.capture();
  assert.equal(f.sensor.token, token); assert.equal(f.calls.filter(call => call.type === 'pro-values-stop').length, 0);
  f.stop(); assert.equal(f.calls.filter(call => call.type === 'pro-values-stop').length, 1);
});

test('128 retained targets bound memory and stop fanout without starting an untracked 129th realm', async () => {
  const f = fixture();
  for (let index = 0; index < 129; index++) {
    const key = '1:0:doc-' + index, binding = { ...f.binding, documentKey: key, documentId: 'doc-' + index };
    f.runtime.state.bindings = new Map([['1:0', binding]]); await f.capture();
  }
  assert.equal(f.manager.proValueAttempts.size, 128); assert.equal(f.calls.filter(call => call.type === 'pro-values-start').length, 128);
  assert.ok(f.manager.session.limitations.includes('document-limit')); f.stop();
  assert.equal(f.calls.filter(call => call.type === 'pro-values-stop').length, 128); assert.equal(f.manager.proValueAttempts.size, 0);
});

function bridgeFixture() {
  const source = readFileSync(new URL('apps/production-extension/bridge.js', root), 'utf8');
  const first = source.indexOf('  function startProValuesBridge() {'), last = source.indexOf('  // packages/collector/src/social-network.ts', first);
  assert.ok(first > 0 && last > first);
  const posts = [], replies = [], events = new Map(), timers = new Map(); let listener, timerId = 0;
  const window = { addEventListener: (name, callback) => events.set(name, callback), postMessage: data => posts.push(data) };
  const context = vm.createContext({ window, chrome: { runtime: { onMessage: { addListener: callback => { listener = callback; } } } }, isOwnServiceWorker: sender => sender?.trusted === true, proValueRows: rows => Array.isArray(rows) ? rows : null, readApiResultEntries: () => [], readLoaderRows: rows => Array.isArray(rows) ? rows : null, proValueKey: () => '', setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id) });
  vm.runInContext(source.slice(first, last) + '\nstartProValuesBridge();', context);
  const command = (type, sessionId, trusted = true) => listener({ schemaVersion: 1, type, sessionId }, { trusted }, response => replies.push(response));
  return { posts, replies, events, timers, window, command };
}

test('trusted stop retires a token before a delayed trusted start or read arrives', () => {
  const f = bridgeFixture(); f.command('pro-values-stop', 'retired');
  f.command('pro-values-start', 'retired'); f.command('pro-values-read', 'retired');
  assert.equal(f.posts.length, 1); assert.equal(f.posts[0].type, 'pro-values-stop');
  assert.ok(f.replies.slice(1).every(reply => reply.available === false)); assert.equal(f.timers.size, 0);
});

test('stop cancels matching pending response and rejects its delayed page data', () => {
  const f = bridgeFixture(); assert.equal(f.command('pro-values-start', 'same'), true);
  const sent = f.posts[0]; f.command('pro-values-stop', 'same'); assert.equal(f.timers.size, 0);
  f.events.get('message')({ source: f.window, data: { ...sent, type: 'pro-values-batch', batchSeq: 0, final: true, enabled: true, truncated: false, rows: [] } });
  assert.equal(f.replies.length, 2); assert.equal(f.replies[0].available, false);
});

test('old session stop does not cancel a newer session pending read', () => {
  const f = bridgeFixture(); f.command('pro-values-start', 'new'); f.command('pro-values-stop', 'old');
  assert.equal(f.timers.size, 1); const sent = f.posts[0];
  f.events.get('message')({ source: f.window, data: { ...sent, type: 'pro-values-batch', batchSeq: 0, final: true, enabled: true, truncated: false, rows: [] } });
  assert.equal(f.replies.at(-1).sessionId, 'new'); assert.equal(f.replies.at(-1).available, true);
});

test('untrusted stop cannot retire a token or cancel a trusted current command', () => {
  const f = bridgeFixture(); f.command('pro-values-stop', 'session', false); assert.equal(f.posts.length, 0);
  assert.equal(f.command('pro-values-start', 'session'), true); f.command('pro-values-stop', 'session', false);
  assert.equal(f.posts.length, 1); assert.equal(f.timers.size, 1); assert.equal(f.replies.length, 0);
});

test('retired-token capacity never evicts old stops and rejects new starts after saturation', () => {
  const f = bridgeFixture(); for (let index = 0; index < 129; index++) f.command('pro-values-stop', 'token-' + index);
  f.command('pro-values-start', 'token-0'); f.command('pro-values-start', 'new');
  assert.equal(f.posts.length, 129); assert.equal(f.replies.at(-1).available, false); assert.equal(f.timers.size, 0);
});

test('inactive Pro Light resume waits for actual native bridge delivery without altering Pro records', async () => {
  const f = fixture(), bridge = deferred(); f.manager.session = null;
  f.manager.proValueCaptures.set('other-document', 'other-token');
  const epoch = f.manager.proValueControlEpoch;
  let called = 0, done = false;
  const work = f.manager.resumeValueCapture(f.page.documentKey, () => { ++called; return bridge.promise; }).then(() => { done = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(called, 1); assert.equal(done, false, 'UI resume must not finish before native bridge delivery');
  assert.equal(f.manager.proValueCaptures.get('other-document'), 'other-token');
  assert.equal(f.manager.proValueControlEpoch, epoch); assert.equal(f.manager.proValueTimer, null); assert.equal(f.calls.length, 0);
  bridge.resolve(); await work; assert.equal(done, true);
  assert.equal(f.manager.proValueCaptures.get('other-document'), 'other-token');
});

test('inactive Pro resume does not acknowledge a rejected bridge delivery', async () => {
  const f = fixture(); f.manager.session = null;
  await assert.rejects(f.manager.resumeValueCapture(f.page.documentKey, () => Promise.reject(Error('native delivery failed'))), /native delivery failed/);
});

test('Light resume starts the reset MAIN document before acknowledgement and keeps other tokens', async () => {
  const f = fixture(); await f.capture(); const token = f.sensor.token, bridge = deferred();
  f.sensor.token = ''; // api-results-reset used by Light pause.
  f.manager.proValueCaptures.set('1:7:other', 'other-active-token');
  f.manager.proValueBaselines.set(token + '|' + f.page.documentKey, ['old baseline']);
  f.manager.proLoaderBaselines.set(token + '|' + f.page.documentKey, ['old loaders']);
  let done = false;
  const work = f.manager.resumeValueCapture(f.page.documentKey, () => bridge.promise).then(() => { done = true; });
  await Promise.resolve(); assert.equal(done, false); assert.equal(f.calls.length, 1);
  assert.equal(f.manager.proValueCaptures.get('1:7:other'), 'other-active-token');
  bridge.resolve(); await work;
  assert.equal(f.calls.length, 2); assert.equal(f.calls.at(-1).type, 'pro-values-start');
  assert.equal(f.sensor.token, token); assert.equal(f.calls.some(call => call.type === 'pro-values-stop'), false);
  assert.equal(f.manager.proLoaderBaselines.get(token + '|' + f.page.documentKey).length, 0);
  f.stop();
});

test('Light resume rejects an old in-flight read and waits for the new START response', async () => {
  const f = fixture(); await f.capture(); const native = f.runtime.api.tabs.sendMessage;
  const readEntered = deferred(), oldRead = deferred(), startEntered = deferred(), newStart = deferred();
  f.runtime.api.tabs.sendMessage = async (...args) => {
    const response = await native(...args);
    if (args[1].type === 'pro-values-read') { readEntered.resolve(); await oldRead.promise; return { ...response, rows: [{ operation: 'Window.innerWidth', techniqueId: 'DET-030', phase: 'returned-sync', value: { kind: 'number', value: 999 }, parameters: [], count: 1 }] }; }
    if (args[1].type === 'pro-values-start') { startEntered.resolve(); await newStart.promise; }
    return response;
  };
  const oldWork = f.capture(); await readEntered.promise; f.sensor.token = '';
  let done = false;
  const resume = f.manager.resumeValueCapture(f.page.documentKey, () => Promise.resolve()).then(() => { done = true; });
  oldRead.resolve(); await startEntered.promise; assert.equal(done, false);
  assert.equal(f.page.apiValues.flatMap(item => item.rows).some(row => row.value.value === 999), false);
  newStart.resolve(); await Promise.all([oldWork, resume]);
  assert.equal(f.calls.at(-1).type, 'pro-values-start'); assert.notEqual(f.sensor.token, '');
  assert.equal(f.page.apiValues.flatMap(item => item.rows).some(row => row.value.value === 999), false); f.stop();
});

test('trusted UI resume awaits bounded bridge delivery and Pro start before returning OK', async () => {
  const member = classMember(source, 'BackgroundRuntime', 'resume', 'background.js').text;
  const method = Function('return ({' + member + '}).resume;')();
  let recoveries = 0;
  const gate = deferred(), steps = [], runtime = {
    ensureHistory: async () => { recoveries++; },
    ready: Promise.resolve(), repository: { run: (_key, callback) => callback() }, checkDocument: () => null,
    apply: () => steps.push('apply'), now: () => 100, persistNow: async () => { steps.push('persist'); },
    sendControl: () => { steps.push('bridge'); }, state: { reports: new Map([['doc', { revision: 2 }]]) },
    pro: { async resumeValueCapture(key, resumeBridge) { assert.equal(key, 'doc'); resumeBridge(); await gate.promise; steps.push('started'); } }
  };
  let done = false; const response = method.call(runtime, 1, 'doc', 1).then(value => { done = true; return value; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(done, false); assert.deepEqual(steps, ['apply', 'persist', 'bridge']);
  gate.resolve(); assert.equal((await response).type, 'ok'); assert.deepEqual(steps, ['apply', 'persist', 'bridge', 'started']);
  assert.equal(recoveries, 1);
});

test('resume lifecycle migration preserves old minified input, accepts reviewed ADR-073 and rejects edited guards', () => {
  const legacy = `class BackgroundRuntime {
  async resume(tabId, documentKey3, reportRevision) {
    return await this.ready, this.repository.run(documentKey3, async () => {
      let error4 = this.checkDocument(tabId, documentKey3, reportRevision);
      return error4 !== null ? uiError(error4) : (this.apply({ type: "ui:resume", documentKey: documentKey3, at: this.now() }, documentKey3), await this.persistNow(documentKey3), this.sendControl(documentKey3, "resume"), { schemaVersion: 1, type: "ok", reportRevision: this.state.reports.get(documentKey3)?.revision ?? null });
    });
  }
}`;
  const patched = patchRuntimeResumeLifecycle(legacy);
  assert.ok(patched.includes('await this.pro.resumeValueCapture(documentKey3, () => this.sendControl(documentKey3, "resume"))'));
  assert.equal(patchRuntimeResumeLifecycle(patched), patched);
  assert.equal(patchRuntimeResumeLifecycle(source), source);
  for (const changed of [
    source.replace('await this.pro.resumeValueCapture(documentKey, () => this.sendControl(documentKey, "resume"));', 'this.pro.resumeValueCapture(documentKey, () => this.sendControl(documentKey, "resume"));'),
    source.replace('async resume(tabId, documentKey, reportRevision) {\n    await this.ready;\n    await this.ensureHistory();', 'async resume(tabId, documentKey, reportRevision) {\n    await this.ready;'),
    legacy.replace('await this.persistNow(documentKey3)', 'this.persistNow(documentKey3)'),
  ]) assert.throws(() => patchRuntimeResumeLifecycle(changed), /source drift/);
});

test('failed resume bridge delivery keeps bounded Pro polling alive', async () => {
  const f = fixture(); await f.capture(); f.sensor.token = '';
  await f.manager.resumeValueCapture(f.page.documentKey, () => Promise.reject(Error('native delivery failure')));
  assert.ok(f.manager.session.limitations.includes('event-limit'));
  assert.ok(f.manager.proValueTimer); assert.equal(f.calls.at(-1).type, 'pro-values-start'); f.stop();
});

test('production lifecycle synchronization is idempotent in read-only mode', () => {
  assert.equal(source.split('  async resumeValueCapture(documentKey, resumeBridge) {').length - 1, 1);
  const result = spawnSync(process.execPath, ['scripts/production/sync-pro-values-lifecycle.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});
