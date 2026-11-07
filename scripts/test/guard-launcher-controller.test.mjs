import assert from 'node:assert/strict';
import test from 'node:test';
import { API_CONFIGURATION_VERSION, createApiConfiguration, updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { createGuardLauncherController } from '../../apps/production-extension/guard-launcher-controller.js';

const copy = value => structuredClone(value), turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function event() { const listeners = new Set(); return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: (...args) => { for (const fn of [...listeners]) fn(...args); }, get size() { return listeners.size; } }; }
function fixture(t, { href = 'chrome-extension://owned/popup.html', framed = false, masterKey = 'enabled', deadlineMs = 100, firefox = false } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const before = Object.fromEntries(['window', 'document', 'location', 'browser'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const win = {}; win.top = framed ? {} : win;
  const visibility = event(), doc = { visibilityState: 'visible', addEventListener: (_type, fn) => visibility.addListener(fn), removeEventListener: (_type, fn) => visibility.removeListener(fn) };
  const changes = event(), added = event(), removed = event(), views = [], calls = [], writes = [];
  let state = { schemaVersion: 1, type: 'api-config-state', revision: 1, configuration: createApiConfiguration(), registration: 'ready', reloadRequired: false }, handler;
  const api = { runtime: { id: 'owned', getURL: path => (firefox ? 'moz' : 'chrome') + '-extension://owned/' + path, async sendMessage(message) {
    calls.push(copy(message)); if (handler) return handler(message);
    if (message.type === 'ui-api-config-set') {
      if (message.expectedRevision !== state.revision) return { schemaVersion: 1, type: 'api-config-error', code: 'stale-revision' };
      state = { ...state, revision: state.revision + 1, configuration: copy(message.configuration) };
    }
    return copy(state);
  } }, storage: { onChanged: changes, local: { set: value => writes.push(value) } }, permissions: { onAdded: added, onRemoved: removed } };
  for (const [key, value] of Object.entries({ window: win, document: doc, location: { href }, browser: firefox ? api : undefined })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const controller = createGuardLauncherController(api, { onChange: value => views.push(copy(value)), masterKey, deadlineMs });
  t.after(() => { controller.dispose(); for (const key of Object.keys(before)) if (before[key]) Object.defineProperty(globalThis, key, before[key]); else delete globalThis[key]; });
  return { controller, api, calls, writes, views, changes, added, removed, visibility, doc, state: () => copy(state), patch: value => { state = { ...state, ...copy(value) }; }, handler: value => { handler = value; }, tick: ms => t.mock.timers.tick(ms) };
}

test('own top popup, sidepanel and Options load only safe master state', async t => {
  for (const path of ['popup.html', 'sidepanel.html', 'options.html?tabId=7#antidetect']) await t.test(path, async subtest => {
    const f = fixture(subtest, { href: 'chrome-extension://owned/' + path });
    assert.deepEqual(await f.controller.load(), { enabled: false, busy: false, error: null });
    assert.deepEqual(f.calls, [{ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }]);
    assert.deepEqual(Object.keys(f.controller.getState()), ['enabled', 'busy', 'error']);
    assert.deepEqual(f.writes, []); f.controller.dispose();
  });
});
test('foreign, web, wrong-path, userinfo and framed contexts cannot read or mutate', async t => {
  for (const [href, framed] of [['https://owned/popup.html', false], ['chrome-extension://other/popup.html', false], ['chrome-extension://owned/protection.html', false], ['chrome-extension://owned/dir/popup.html', false], ['chrome-extension://user@owned/popup.html', false], ['chrome-extension://owned/popup.html', true]]) await t.test(href + ':' + framed, async subtest => {
    const f = fixture(subtest, { href, framed });
    assert.equal((await f.controller.load()).error, 'inactive'); await f.controller.toggle(); assert.deepEqual(f.calls, []); f.controller.dispose();
  });
});
test('toggle fresh-reads CAS and changes exactly one field while preserving current foreign edits and libraries', async t => {
  const f = fixture(t); await f.controller.load();
  const changed = updateApiConfiguration(f.state().configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 16 }, userValues: [{ id: 'custom-1', label: 'Saved CPU', value: { kind: 'value', value: 16 } }] });
  assert.equal(changed.ok, true); f.patch({ revision: 9, configuration: changed.value });
  assert.deepEqual(await f.controller.toggle(), { enabled: true, busy: false, error: null });
  const sent = f.calls.at(-1); assert.equal(sent.type, 'ui-api-config-set'); assert.equal(sent.expectedRevision, 9); assert.equal(sent.tabId, null);
  assert.deepEqual(sent.configuration, { ...changed.value, enabled: true }); assert.deepEqual(f.writes, []);
});

test('Antidetect launcher toggles only its format5 master and preserves the latest independent API Guard state in all four combinations', async t => {
  for (const enabled of [false, true]) for (const antidetectEnabled of [false, true]) await t.test(`API Guard=${enabled}, Antidetect=${antidetectEnabled}`, async subtest => {
    const f = fixture(subtest, { masterKey: 'antidetectEnabled' });
    const initial = { ...createApiConfiguration(), enabled, antidetectEnabled };
    f.patch({ revision: 7, configuration: initial });
    assert.deepEqual(await f.controller.load(), { enabled: antidetectEnabled, busy: false, error: null });
    const changed = updateApiConfiguration(initial, 'hardware-concurrency', {
      mode: 'custom', selected: { kind: 'value', value: 16 },
      userValues: [{ id: 'saved-cpu', label: 'Saved CPU', value: { kind: 'value', value: 16 } }]
    }, 'exact.fixture.invalid');
    assert.equal(changed.ok, true);
    const fresh = { ...changed.value, enabled: !enabled, preset: 'strict', webrtcNetworkPolicy: 'disable_non_proxied_udp' };
    fresh.fingerprintProfiles = [{ id: 'fp-' + '1'.repeat(32), label: 'Unrelated saved profile', preset: 'limited', webrtcNetworkPolicy: 'system',
      apis: fresh.apis.map(({ id, mode, selected, settings }) => ({ id, mode, selected: copy(selected), settings: copy(settings) })), tags: [], note: '' }];
    f.patch({ revision: 19, configuration: fresh });
    assert.deepEqual(await f.controller.toggle(), { enabled: !antidetectEnabled, busy: false, error: null });
    const sent = f.calls.at(-1);
    assert.equal(sent.type, 'ui-api-config-set'); assert.equal(sent.expectedRevision, 19); assert.equal(sent.tabId, null);
    assert.equal(sent.configuration.formatVersion, API_CONFIGURATION_VERSION);
    assert.deepEqual(sent.configuration, { ...fresh, antidetectEnabled: !antidetectEnabled });
    assert.equal(sent.configuration.enabled, !enabled, 'the fresh API Guard change survives the Antidetect toggle');
    assert.equal(f.calls.filter(message => message.type === 'ui-api-config-set').length, 1);
    assert.deepEqual(f.writes, [], 'the launcher uses the canonical CAS, never direct storage');
    f.controller.dispose();
  });
});
test('a fresh value already matching clicked intent is adopted without redundant write', async t => {
  const f = fixture(t); await f.controller.load(); const configuration = f.state().configuration; configuration.enabled = true; f.patch({ revision: 2, configuration });
  await f.controller.toggle(); assert.equal(f.controller.getState().enabled, true); assert.equal(f.calls.filter(call => call.type === 'ui-api-config-set').length, 0);
});
test('stale write rejection is exposed once without retry or corrupting loaded master', async t => {
  const f = fixture(t); await f.controller.load(); f.handler(message => message.type === 'ui-api-config-get' ? f.state() : { schemaVersion: 1, type: 'api-config-error', code: 'stale-revision' });
  assert.equal((await f.controller.toggle()).error, 'stale-revision'); assert.equal(f.controller.getState().enabled, false);
  assert.equal(f.calls.filter(call => call.type === 'ui-api-config-set').length, 1); f.tick(60000); await turn(); assert.equal(f.calls.length, 3);
});
test('backwards or unchanged write revisions and wrong acknowledged master are never adopted', async t => {
  const f = fixture(t); await f.controller.load();
  for (const patch of [{ revision: 0 }, { revision: 1 }, { revision: 2, unchanged: true }]) {
    f.handler(message => message.type === 'ui-api-config-get' ? f.state() : { ...f.state(), revision: patch.revision, configuration: patch.unchanged ? f.state().configuration : message.configuration });
    assert.equal((await f.controller.toggle()).error, 'stale-revision'); assert.equal(f.controller.getState().enabled, false);
  }
});
test('malformed response/accessors and exception codes do not execute page-like getters or leak details', async t => {
  const f = fixture(t); let reads = 0;
  const accessor = { ...f.state() }; Object.defineProperty(accessor, 'configuration', { get() { reads++; throw Error('SECRET'); } });
  const nested = f.state(); Object.defineProperty(nested.configuration.apis[0], 'mode', { get() { reads++; return 'custom'; } });
  const thrown = {}; Object.defineProperty(thrown, 'message', { get() { reads++; return 'SECRET'; } });
  for (const value of [accessor, nested, { schemaVersion: 1, type: 'api-config-error', code: 'SECRET' }, null]) {
    f.handler(() => value); assert.equal((await f.controller.load()).error, 'operation-failed');
  }
  f.handler(() => Promise.reject(thrown)); assert.equal((await f.controller.load()).error, 'operation-failed'); assert.equal(reads, 0);
});
test('registration failure keeps actual persisted enabled state and reports application error', async t => {
  const f = fixture(t); await f.controller.load(); f.handler(message => message.type === 'ui-api-config-get' ? f.state() : { ...f.state(), revision: 2, configuration: message.configuration, registration: 'error' });
  assert.deepEqual(await f.controller.toggle(), { enabled: true, busy: false, error: 'operation-failed' });
});
test('double clicks share no second request and a timed-out read holds physical lock until settlement', async t => {
  const f = fixture(t); await f.controller.load(); const held = deferred(); f.handler(() => held.promise);
  const job = f.controller.toggle(); await turn(); void f.controller.toggle(); assert.equal(f.calls.length, 2);
  f.tick(101); assert.deepEqual(await job, { enabled: false, busy: true, error: 'timeout' });
  for (let index = 0; index < 5; index++) void f.controller.toggle(); assert.equal(f.calls.length, 2);
  held.resolve(f.state()); await turn(); assert.deepEqual(f.controller.getState(), { enabled: false, busy: false, error: 'timeout' }); assert.equal(f.calls.length, 2, 'expired fresh read never starts a write');
});
test('timed-out write is not retried; one confirming read follows physical settlement', async t => {
  const f = fixture(t); await f.controller.load(); const held = deferred(); let writing = false;
  f.handler(message => { if (message.type === 'ui-api-config-get') return f.state(); writing = true; return held.promise; });
  const job = f.controller.toggle(); await turn(); assert.equal(writing, true); f.tick(101); assert.equal((await job).error, 'timeout'); assert.equal(f.controller.getState().busy, true);
  const configuration = f.state().configuration; configuration.enabled = true; f.patch({ revision: 2, configuration }); held.resolve(f.state()); await turn(); await turn();
  assert.equal(f.calls.filter(call => call.type === 'ui-api-config-set').length, 1); assert.equal(f.calls.length, 4); assert.deepEqual(f.controller.getState(), { enabled: true, busy: false, error: null });
});
test('storage changes during a fresh read abort stale mutation and queue exactly one confirming read', async t => {
  const f = fixture(t); await f.controller.load(); const held = deferred(); f.handler(() => held.promise);
  const job = f.controller.toggle(); await turn(); const old = f.state(); const configuration = old.configuration; configuration.enabled = true; f.patch({ revision: 2, configuration });
  f.changes.emit({ 'api-configuration:v1': { newValue: { revision: 2 } } }, 'local'); f.changes.emit({ 'api-configuration:v1': {} }, 'local');
  f.handler(null); held.resolve({ ...old, configuration: { ...old.configuration, enabled: false } }); await job; await turn();
  assert.equal(f.calls.length, 3); assert.equal(f.calls.filter(call => call.type === 'ui-api-config-set').length, 0); assert.equal(f.controller.getState().enabled, true);
});
test('own storage notification during set queues confirmation without clobbering actual outcome', async t => {
  const f = fixture(t); await f.controller.load();
  f.handler(message => {
    if (message.type === 'ui-api-config-get') return f.state();
    f.patch({ revision: 2, configuration: message.configuration }); f.changes.emit({ 'api-configuration:v1': {} }, 'local'); return f.state();
  });
  await f.controller.toggle(); await turn(); assert.equal(f.calls.length, 4); assert.equal(f.controller.getState().enabled, true);
  f.changes.emit({ unrelated: {} }, 'local'); f.changes.emit({ 'api-configuration:v1': {} }, 'session'); await turn(); assert.equal(f.calls.length, 4);
});
test('permissions and hiding invalidate pending results and cannot start a stale write', async t => {
  const f = fixture(t); await f.controller.load(); const held = deferred(); f.handler(() => held.promise);
  const job = f.controller.toggle(); await turn(); f.doc.visibilityState = 'hidden'; f.visibility.emit(); assert.equal(f.controller.getState().enabled, null);
  held.resolve(f.state()); await job; assert.equal(f.calls.length, 2); assert.equal(f.controller.getState().enabled, null);
  f.handler(null); f.doc.visibilityState = 'visible'; f.visibility.emit(); await turn(); assert.equal(f.controller.getState().enabled, false);
  f.removed.emit({ permissions: ['userScripts'] }); assert.equal(f.controller.getState().enabled, null); await turn(); assert.equal(f.controller.getState().enabled, false);
});
test('a changed own page binding cannot accept the old request or retain cached state', async t => {
  const f = fixture(t); await f.controller.load(); const held = deferred(); f.handler(() => held.promise); const job = f.controller.toggle(); await turn();
  globalThis.location.href = 'chrome-extension://owned/options.html'; held.resolve(f.state()); await job;
  assert.equal(f.controller.getState().enabled, null); assert.equal(f.calls.length, 2);
});
test('dispose removes listeners and late fulfillment cannot write, publish, or refresh', async t => {
  const f = fixture(t); await f.controller.load(); const held = deferred(); f.handler(() => held.promise); const job = f.controller.toggle(); await turn();
  f.controller.dispose(); const count = f.views.length; for (const event of [f.changes, f.added, f.removed, f.visibility]) assert.equal(event.size, 0);
  held.resolve(f.state()); await job; f.tick(60000); await f.controller.load(); await f.controller.toggle(); assert.equal(f.views.length, count); assert.equal(f.calls.length, 2);
});
test('Firefox uses the matching native runtime and passive listeners rather than adapter transports', async t => {
  const f = fixture(t, { firefox: true, href: 'moz-extension://owned/sidepanel.html' });
  const adapter = { runtime: { id: 'owned', getURL() { throw Error('adapter must not be used'); }, sendMessage() { throw Error('adapter must not be used'); } } };
  const controller = createGuardLauncherController(adapter); await controller.load(); assert.equal(controller.getState().enabled, false); assert.equal(f.calls.length, 1); controller.dispose();
});
test('unsupported master keys cannot route a mutation or silently fall back to API Guard', async t => {
  const f = fixture(t, { masterKey: '__proto__' }); assert.equal((await f.controller.load()).error, 'inactive'); await f.controller.toggle(); assert.deepEqual(f.calls, []);
});
