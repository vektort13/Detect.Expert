import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { installPrecursorModesService, PRECURSOR_MODES_PORT, PRECURSOR_MODES_STORAGE, PRECURSOR_MODES_ALARM, PRECURSOR_CREDENTIAL_STORAGE, PRECURSOR_TRANSPORT_STORAGE } from '../../apps/production-extension/precursor-modes-service.js';
import { readModesState, readModesReply } from '../../apps/production-extension/precursor-modes-contracts.js';

const ZONE = '1'.repeat(32), OTHER_ZONE = '2'.repeat(32), TOKEN = 'PRECURSOR_TEST_ONLY_TOKEN_CANARY';
const event = () => { const listeners = new Set(); return { addListener(fn) { listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); }, fire(value) { for (const listener of [...listeners]) listener(value); }, get size() { return listeners.size; } }; };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const json = (result, status = 200, headers = {}) => new Response(JSON.stringify({ success: true, result }), { status, headers: { 'content-type': 'application/json', ...headers } });
const mode = value => json({ mode: value });
function harness({ saved = null, savedVault = null, savedTransport = null, consent = true, whenReady = () => Promise.resolve(), initialQueue = [], initialAt = 1000000, sessionSupported = true, firefox = false } = {}) {
  let at = initialAt, consentValue = consent, hostPermission = true, notificationPermission = true, failWrites = false, failCredentialWrites = false, failCredentialRemoves = false, timeoutId = 0;
  const data = { ...(saved ? { [PRECURSOR_MODES_STORAGE]: structuredClone(saved) } : {}), ...(savedTransport ? { [PRECURSOR_TRANSPORT_STORAGE]: structuredClone(savedTransport) } : {}) }, vault = savedVault ? { [PRECURSOR_CREDENTIAL_STORAGE]: structuredClone(savedVault) } : {}, sessionCalls = [], queue = [...initialQueue], requests = [], changes = [], notifications = [], dismissedNotifications = [], alarmCalls = [], timers = new Map(), tabs = [];
  const api = {
    runtime: { id: 'unit-test', getURL: path => (firefox ? 'moz-extension://' : 'chrome-extension://') + 'unit-test/' + path, onConnect: event() },
    permissions: { onRemoved: event(), async contains(value) { return value.origins ? hostPermission : notificationPermission; } },
    storage: {
      local: { async get(key) { return { [key]: structuredClone(data[key]) }; }, async set(value) { if (failWrites) throw Error('unavailable'); Object.assign(data, structuredClone(value)); }, async remove(key) { if (failWrites) throw Error('unavailable'); delete data[key]; } },
      session: { ...(sessionSupported ? { async getKeys() { sessionCalls.push(['getKeys']); return Object.keys(vault); } } : {}),
        async get(key) { assert.equal(key, PRECURSOR_CREDENTIAL_STORAGE); sessionCalls.push(['get', key]); return { [key]: structuredClone(vault[key]) }; },
        async set(value) { if (failCredentialWrites) throw Error('unavailable'); sessionCalls.push(['set']); Object.assign(vault, structuredClone(value)); },
        async remove(key) { if (failCredentialRemoves) throw Error('unavailable'); sessionCalls.push(['remove', key]); delete vault[key]; },
        async setAccessLevel(value) { sessionCalls.push(['setAccessLevel', value]); },
      },
    },
    alarms: { onAlarm: event(), async create(name, info) { alarmCalls.push(['create', name, info]); }, async clear(name) { alarmCalls.push(['clear', name]); } },
    notifications: { onClicked: event(), async create(id, options) { notifications.push({ id, ...options }); }, async clear(id) { dismissedNotifications.push(id); return true; } },
    tabs: { async create(value) { tabs.push(value); } },
    i18n: { getMessage: () => '' },
  };
  const service = installPrecursorModesService(api, {
    fetchImpl: async (url, options) => { requests.push({ url, options }); const answer = queue.shift(); if (typeof answer === 'function') return answer(url, options); if (answer === undefined) throw Error('no fixture'); return answer; },
    now: () => at, consent: () => consentValue, whenReady, onChange: value => changes.push(value),
    env: { setTimeout(fn, ms) { const id = ++timeoutId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); } },
  });
  const connect = async (value = 'monitor', zone = ZONE, name = 'example.com') => { queue.push(json({ id: zone, name }), mode(value)); return service.command('connect', { zoneId: zone, token: TOKEN }); };
  const refresh = async value => { at += 60000; queue.push(mode(value)); return service.command('refresh'); };
  return { api, service, data, vault, sessionCalls, queue, requests, changes, notifications, dismissedNotifications, alarmCalls, timers, tabs, connect, refresh,
    advance(ms) { at += ms; }, setTime(value) { at = value; }, revokeConsent() { consentValue = false; }, grantConsent() { consentValue = true; },
    hostPermission(value) { hostPermission = value; }, notificationPermission(value) { notificationPermission = value; }, failWrites(value) { failWrites = value; }, failCredentialWrites(value) { failCredentialWrites = value; }, failCredentialRemoves(value) { failCredentialRemoves = value; },
    timeout() { for (const [id, value] of [...timers]) { timers.delete(id); value.fn(); } },
  };
}
function makePort(sender = { id: 'unit-test', url: 'chrome-extension://unit-test/precursor-settings.html', origin: 'chrome-extension://unit-test', frameId: 0, documentLifecycle: 'active', tab: { id: 1, url: 'chrome-extension://unit-test/precursor-settings.html' } }) {
  return { name: PRECURSOR_MODES_PORT, sender, onMessage: event(), onDisconnect: event(), sent: [], disconnected: false, postMessage(value) { this.sent.push(value); }, disconnect() { this.disconnected = true; this.onDisconnect.fire(); } };
}
const error = code => value => value?.code === code;

test('disabled startup performs no network, canonical snapshots contain no credentials', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.service.ready;
  assert.equal(h.requests.length, 0); assert.equal(h.service.getState().mode, 'unknown'); assert.ok(readModesState(h.service.getState()));
  assert.equal(h.service.snapshotForHost('example.com'), null);
});

test('all three official modes use fixed authenticated GETs and exact zone identity', async t => {
  for (const value of ['off', 'monitor', 'arm']) {
    const h = harness(); t.after(() => h.service.dispose()); const state = await h.connect(value);
    assert.equal(state.mode, value); assert.equal(state.lastKnownMode, value); assert.equal(state.status, 'ready'); assert.equal(state.history.length, 0); assert.ok(readModesState(state));
    assert.deepEqual(h.requests.map(entry => entry.url), ['https://api.cloudflare.com/client/v4/zones/' + ZONE, 'https://api.cloudflare.com/client/v4/zones/' + ZONE + '/precursor']);
    for (const { options } of h.requests) { assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN); assert.equal(options.headers['Cloudflare-Version'], '1.0'); assert.equal(options.body, undefined); }
    assert.equal(h.service.snapshotForHost('sub.example.com'), null); assert.equal(h.service.snapshotForHost('badexample.com'), null); assert.equal(h.service.snapshotForHost('example.com').mode, value);
    assert.ok(!JSON.stringify([h.data, h.changes, state]).includes(TOKEN)); assert.ok(h.alarmCalls.some(call => call[0] === 'create' && call[1] === PRECURSOR_MODES_ALARM));
  }
});

test('six directed transitions persist once; initial and repeated answers do not notify', async t => {
  for (const from of ['off', 'monitor', 'arm']) for (const to of ['off', 'monitor', 'arm']) if (from !== to) {
    const h = harness(); t.after(() => h.service.dispose()); await h.connect(from); await h.service.command('notifications', { enabled: true });
    assert.equal(h.notifications.length, 0);
    await h.refresh(to); assert.equal(h.notifications.length, 1); assert.deepEqual(h.service.getState().history.map(({ from, to }) => ({ from, to })), [{ from, to }]);
    assert.equal(h.data[PRECURSOR_MODES_STORAGE].lastKnownMode, to); assert.equal(h.data[PRECURSOR_MODES_STORAGE].history.length, 1);
    await h.refresh(to); assert.equal(h.notifications.length, 1); assert.equal(h.service.getState().history.length, 1);
    assert.ok(!JSON.stringify(h.notifications).includes(TOKEN));
  }
});

test('browser restart without session vault preserves history but requires a fresh connection', async t => {
  const first = harness(); await first.connect('monitor'); await first.service.command('notifications', { enabled: true }); const saved = structuredClone(first.data[PRECURSOR_MODES_STORAGE]); await first.service.dispose();
  const h = harness({ saved }); t.after(() => h.service.dispose()); await h.service.ready;
  assert.equal(h.requests.length, 0); assert.equal(h.notifications.length, 0); assert.equal(h.service.getState().connected, false); assert.equal(h.service.getState().mode, 'unknown'); assert.equal(h.service.getState().lastKnownMode, 'monitor');
  await h.connect('arm'); assert.equal(h.service.getState().history.length, 1); assert.equal(h.notifications.length, 1);
});

test('different zone starts a fresh baseline and cannot inherit previous-zone mode', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.connect('monitor'); await h.refresh('arm'); await h.service.command('disconnect'); h.advance(60000);
  await h.connect('off', OTHER_ZONE, 'elsewhere.example');
  assert.equal(h.service.getState().history.length, 0); assert.equal(h.service.snapshotForHost('example.com'), null); assert.equal(h.service.snapshotForHost('elsewhere.example').mode, 'off');
});

test('mismatched zone ID and invalid hostname cannot authenticate user supplied identity', async t => {
  for (const zone of [{ id: OTHER_ZONE, name: 'example.com' }, { id: ZONE, name: 'example.com.attacker/' }, { id: ZONE, name: 'Example.COM' }]) {
    const h = harness(); t.after(() => h.service.dispose()); h.queue.push(json(zone));
    await assert.rejects(h.service.command('connect', { zoneId: ZONE, token: TOKEN }), error('invalid-response'));
    assert.equal(h.requests.length, 1); assert.equal(h.service.getState().mode, 'unknown'); assert.equal(h.service.getState().zone, null);
  }
});

test('missing/legacy/unknown values and invalid envelopes never mean Off', async t => {
  for (const result of [{}, { mode: null }, { mode: 'armed' }, { default_mode: 'min-friction' }, { mode: 'future-value' }]) {
    const h = harness(); t.after(() => h.service.dispose()); h.queue.push(json({ id: ZONE, name: 'example.com' }), json(result));
    await assert.rejects(h.service.command('connect', { zoneId: ZONE, token: TOKEN }), error('invalid-response'));
    assert.equal(h.service.getState().mode, 'unknown'); assert.equal(h.service.getState().history.length, 0);
  }
  const h = harness(); t.after(() => h.service.dispose()); h.queue.push(json({ id: ZONE, name: 'example.com' }), new Response('{"success":false,"result":{"mode":"off"}}', { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(h.service.command('connect', { zoneId: ZONE, token: TOKEN }), error('invalid-response')); assert.equal(h.service.getState().mode, 'unknown');
});

test('HTTP failures preserve last known facts without mode-change notifications', async t => {
  for (const [status, code] of [[401, 'api-unauthorized'], [403, 'api-forbidden'], [404, 'api-not-found'], [429, 'rate-limited'], [500, 'api-unavailable']]) {
    const h = harness(); t.after(() => h.service.dispose()); await h.connect('monitor'); await h.service.command('notifications', { enabled: true }); h.advance(60000); h.queue.push(json({ mode: 'off' }, status));
    await assert.rejects(h.service.command('refresh'), error(code)); const state = h.service.getState();
    assert.equal(state.mode, 'unknown'); assert.equal(state.lastKnownMode, 'monitor'); assert.equal(state.history.length, 0); assert.equal(h.notifications.length, 0); assert.ok(readModesState(state));
    if (status === 401 || status === 403) assert.equal(state.connected, false);
  }
});

test('refresh cooldown and Retry-After prevent repeated external calls', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.connect();
  await assert.rejects(h.service.command('refresh'), error('cooldown')); assert.equal(h.requests.length, 2);
  h.advance(60000); h.queue.push(json({}, 429, { 'retry-after': '600' }));
  await assert.rejects(h.service.command('refresh'), error('rate-limited')); h.advance(60000);
  await assert.rejects(h.service.command('refresh'), error('cooldown')); assert.equal(h.requests.length, 3);
  h.advance(600000); h.queue.push(mode('arm')); await h.service.command('refresh'); assert.equal(h.requests.length, 4);
});

test('stale TTL and backwards clock yield unknown while preserving baseline', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.connect('off'); h.advance(180001);
  assert.equal(h.service.getState().mode, 'unknown'); assert.equal(h.service.getState().status, 'stale'); assert.equal(h.service.getState().lastKnownMode, 'off');
  h.setTime(1); assert.equal(h.service.getState().errorCode, 'clock-changed'); assert.equal(h.service.getState().history.length, 0);
});

test('hung fetch retains physical slot after timeout and ignores late replies', async t => {
  const h = harness(); t.after(() => h.service.dispose()); const hold = deferred(); h.queue.push(() => hold.promise);
  const connecting = h.service.command('connect', { zoneId: ZONE, token: TOKEN }); await tick(); h.timeout();
  await assert.rejects(connecting, error('timeout')); assert.equal(h.requests[0].options.signal.aborted, true);
  h.advance(120000); await assert.rejects(h.service.command('refresh'), error('busy')); assert.equal(h.requests.length, 1);
  hold.resolve(json({ id: ZONE, name: 'example.com' })); await tick(); assert.equal(h.service.getState().mode, 'unknown'); assert.equal(h.requests.length, 1);
});

test('clear and disconnect invalidate inflight network and late mode replies', async t => {
  for (const clear of [true, false]) {
    const h = harness(); t.after(() => h.service.dispose()); await h.connect('monitor'); const hold = deferred(); h.advance(60000); h.queue.push(() => hold.promise);
    const refresh = h.service.command('refresh'); await tick(); if (clear) await h.service.clear(); else await h.service.command('disconnect');
    hold.resolve(mode('arm')); await assert.rejects(refresh, error('disconnected')); assert.equal(h.service.getState().mode, 'unknown'); assert.equal(h.service.getState().connected, false); assert.equal(h.notifications.length, 0);
    assert.equal(h.service.getState().history.length, 0); if (clear) assert.equal(h.data[PRECURSOR_MODES_STORAGE], undefined);
  }
});

test('oversized content length, streamed bytes, wrong MIME and malformed JSON fail closed', async t => {
  const answers = [new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '65537' } }), new Response(' '.repeat(65537), { headers: { 'content-type': 'application/json' } }), new Response('<html>', { headers: { 'content-type': 'text/html' } }), new Response('{invalid', { headers: { 'content-type': 'application/json' } })];
  for (const [index, answer] of answers.entries()) {
    const h = harness(); t.after(() => h.service.dispose()); h.queue.push(json({ id: ZONE, name: 'example.com' }), answer);
    await assert.rejects(h.service.command('connect', { zoneId: ZONE, token: TOKEN }), error(index < 2 ? 'response-too-large' : 'invalid-response')); assert.equal(h.service.getState().mode, 'unknown'); assert.equal(h.requests[1].options.signal.aborted, true);
  }
});

test('unconsented or withheld-host access never emits an external request', async t => {
  for (const blockedConsent of [true, false]) {
    const h = harness({ consent: !blockedConsent }); t.after(() => h.service.dispose()); if (!blockedConsent) h.hostPermission(false);
    await assert.rejects(h.service.command('connect', { zoneId: ZONE, token: TOKEN }), error(blockedConsent ? 'consent-required' : 'permission-required')); assert.equal(h.requests.length, 0);
  }
});

test('permission removal stops monitoring and notification revocation preserves in-app history', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.connect('monitor'); await h.service.command('notifications', { enabled: true });
  h.notificationPermission(false); h.api.permissions.onRemoved.fire({ permissions: ['notifications'] }); await tick();
  assert.equal(h.service.getState().notifications, false); await h.refresh('arm'); assert.equal(h.service.getState().history.length, 1); assert.equal(h.notifications.length, 0);
  h.hostPermission(false); h.api.permissions.onRemoved.fire({ origins: ['https://*/*'] }); await tick(); assert.equal(h.service.getState().connected, false); assert.equal(h.service.getState().mode, 'unknown');
});

test('consent revoke during pending fetch discards response and clear removes persisted facts', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.connect('monitor'); h.advance(60000); const hold = deferred(); h.queue.push(() => hold.promise);
  const refresh = h.service.command('refresh'); await tick(); h.revokeConsent(); await h.service.clear(); hold.resolve(mode('arm'));
  await assert.rejects(refresh, error('disconnected')); assert.equal(h.data[PRECURSOR_MODES_STORAGE], undefined); assert.equal(h.service.snapshotForHost('example.com'), null);
});

test('storage errors suppress OS notifications and expose factual unavailable state', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.connect('monitor'); await h.service.command('notifications', { enabled: true }); h.failWrites(true);
  await assert.rejects(h.refresh('arm'), error('storage-unavailable')); assert.equal(h.notifications.length, 0); assert.equal(h.service.getState().errorCode, 'storage-unavailable'); assert.equal(h.service.getState().mode, 'unknown');
  h.failWrites(false); await h.service.clear(); assert.equal(h.data[PRECURSOR_MODES_STORAGE], undefined);
});

test('native top-level dedicated page works; other extension pages and page senders disconnect', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.service.ready;
  for (const change of [{ url: 'https://example.com/' }, { url: 'chrome-extension://unit-test/options.html' }, { frameId: 1 }, { id: 'another-extension' }, { origin: 'https://example.com' }, { documentLifecycle: 'prerender' }, { tab: { id: 1, url: 'https://example.com' } }]) {
    const port = makePort({ ...makePort().sender, ...change }); h.api.runtime.onConnect.fire(port); assert.equal(port.disconnected, true);
  }
  const port = makePort(); h.api.runtime.onConnect.fire(port); assert.equal(port.disconnected, false); port.onMessage.fire({ schemaVersion: 1, id: 1, action: 'read' }); await tick();
  assert.equal(port.sent.at(-1).ok, true); assert.ok(readModesReply(port.sent.at(-1)));
  port.onMessage.fire({ schemaVersion: 1, id: 2, action: 'read', token: 'unexpected' }); assert.equal(port.disconnected, true);
});

test('alarm refreshes only while connected and notification click opens only dedicated UI', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.connect('monitor'); h.advance(60000); h.queue.push(mode('arm')); h.api.alarms.onAlarm.fire({ name: PRECURSOR_MODES_ALARM }); await tick();
  assert.equal(h.service.getState().mode, 'arm'); h.api.notifications.onClicked.fire('precursor-mode-1'); await tick(); assert.deepEqual(h.tabs, [{ url: 'chrome-extension://unit-test/precursor-settings.html' }]);
  await h.service.command('disconnect'); const count = h.requests.length; h.advance(60000); h.api.alarms.onAlarm.fire({ name: PRECURSOR_MODES_ALARM }); await tick(); assert.equal(h.requests.length, count);
});

test('history cap keeps newest 128 mode transitions with increasing IDs', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.connect('off');
  for (let index = 0; index < 140; index++) await h.refresh(index % 2 === 0 ? 'arm' : 'off');
  const history = h.service.getState().history; assert.equal(history.length, 128); assert.equal(history[0].id, 13); assert.equal(history.at(-1).id, 140); assert.ok(readModesState(h.service.getState()));
});

test('notification opt-out or permission revoke during permission IPC suppresses late delivery', async t => {
  for (const revoke of [false, true]) {
    const h = harness(); t.after(() => h.service.dispose()); await h.connect('monitor'); await h.service.command('notifications', { enabled: true });
    const permission = deferred(); h.api.permissions.contains = async value => value.origins ? true : permission.promise;
    const refreshing = h.refresh('arm'); await tick();
    if (revoke) h.api.permissions.onRemoved.fire({ permissions: ['notifications'] }); else await h.service.command('notifications', { enabled: false });
    permission.resolve(true); await refreshing;
    assert.equal(h.notifications.length, 0); assert.equal(h.service.getState().notifications, false); assert.equal(h.service.getState().history.length, 1);
  }
});

test('reconnect preserves transport backoff after a rate-limited request', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.connect('monitor'); h.advance(60000); h.queue.push(json({}, 429, { 'retry-after': '600' }));
  await assert.rejects(h.service.command('refresh'), error('rate-limited'));
  await assert.rejects(h.service.command('connect', { zoneId: ZONE, token: TOKEN }), error('cooldown'));
  await h.service.command('disconnect'); h.advance(60000);
  await assert.rejects(h.service.command('connect', { zoneId: ZONE, token: 'DIFFERENT_TEST_TOKEN' }), error('cooldown'));
  assert.equal(h.requests.length, 3);
});

test('empty response chunks are bounded without starving the request timeout', async t => {
  const h = harness(); t.after(() => h.service.dispose()); let reads = 0, cancelled = 0;
  const response = { status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: { getReader() { return { async read() { reads++; return { done: false, value: new Uint8Array() }; }, async cancel() { cancelled++; }, releaseLock() {} }; } } };
  h.queue.push(response);
  await assert.rejects(h.service.command('connect', { zoneId: ZONE, token: TOKEN }), error('response-too-large'));
  assert.equal(reads, 8192); assert.equal(cancelled, 1); assert.equal(h.requests[0].options.signal.aborted, true);
});

test('startup awaits authoritative consent before retaining or removing saved metadata', async t => {
  const saved = { version: 1, zone: { id: ZONE, name: 'example.com' }, lastKnownMode: 'monitor', lastKnownAt: 1000000, history: [], notifications: false };
  const starting = deferred(); const h = harness({ saved, consent: false, whenReady: () => starting.promise }); t.after(() => h.service.dispose());
  await tick(); assert.deepEqual(h.data[PRECURSOR_MODES_STORAGE], saved); h.grantConsent(); starting.resolve(); await h.service.ready;
  assert.equal(h.service.getState().lastKnownMode, 'monitor'); assert.equal(h.service.getState().connected, false);
  const denied = harness({ saved, consent: false }); t.after(() => denied.service.dispose()); await denied.service.ready;
  assert.equal(denied.data[PRECURSOR_MODES_STORAGE], undefined); assert.equal(denied.service.getState().lastKnownMode, 'unknown');
});

test('API host revoke synchronously invalidates active connection and aborts response', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.connect('monitor'); const hold = deferred(); h.queue.push(() => hold.promise); h.advance(60000);
  const refreshing = h.service.command('refresh'); await tick(); h.api.permissions.onRemoved.fire({ origins: ['https://*.cloudflare.com/*'] });
  assert.equal(h.service.getState().connected, false); assert.equal(h.requests.at(-1).options.signal.aborted, true);
  hold.resolve(mode('arm')); await assert.rejects(refreshing, error('disconnected')); assert.equal(h.service.getState().history.length, 0);
});

test('a validated connection stores credentials only in trusted session memory', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.connect('monitor');
  assert.deepEqual(h.vault[PRECURSOR_CREDENTIAL_STORAGE], { version: 1, zoneId: ZONE, token: TOKEN });
  assert.equal(h.data[PRECURSOR_MODES_STORAGE].monitoring, true);
  assert.ok(h.sessionCalls.some(call => call[0] === 'setAccessLevel' && call[1].accessLevel === 'TRUSTED_CONTEXTS'));
  assert.ok(!JSON.stringify([h.data, h.changes, h.service.getState(), h.notifications]).includes(TOKEN));
  assert.equal(h.sessionCalls.filter(call => call[0] === 'set').length, 1);
  await h.refresh('arm'); assert.equal(h.sessionCalls.filter(call => call[0] === 'set').length, 1, 'polling never rewrites the credential');
});

test('worker replacement restores its session vault and re-verifies the zone before polling', async t => {
  const first = harness(); await first.connect('monitor'); const saved = structuredClone(first.data[PRECURSOR_MODES_STORAGE]); const savedVault = structuredClone(first.vault[PRECURSOR_CREDENTIAL_STORAGE]); await first.service.dispose();
  for (const value of ['monitor', 'arm']) {
    const h = harness({ saved, savedVault, initialQueue: [json({ id: ZONE, name: 'example.com' }), mode(value)] }); t.after(() => h.service.dispose()); await h.service.ready;
    assert.equal(h.service.getState().connected, true); assert.equal(h.service.getState().mode, value); assert.equal(h.requests.length, 2);
    assert.ok(h.requests[0].url.endsWith('/zones/' + ZONE)); assert.ok(h.requests[1].url.endsWith('/precursor'));
    assert.equal(h.service.getState().history.length, value === 'monitor' ? 0 : 1);
    assert.ok(h.alarmCalls.some(call => call[0] === 'create'));
    h.advance(60000); h.queue.push(mode('off')); h.api.alarms.onAlarm.fire({ name: PRECURSOR_MODES_ALARM }); await tick();
    assert.equal(h.service.getState().mode, 'off'); assert.ok(!JSON.stringify(h.data).includes(TOKEN));
  }
});

test('missing session getKeys or denied trusted access rejects connecting before any API call', async t => {
  for (const kind of ['missing', 'getKeys-rejected', 'access-denied']) {
    const h = harness({ sessionSupported: kind !== 'missing' }); t.after(() => h.service.dispose());
    if (kind === 'getKeys-rejected') h.api.storage.session.getKeys = async () => { throw Error('unavailable'); };
    if (kind === 'access-denied') h.api.storage.session.setAccessLevel = async () => { throw Error('unavailable'); };
    await h.service.ready;
    await assert.rejects(h.service.command('connect', { zoneId: ZONE, token: TOKEN }), error('session-unavailable'));
    assert.equal(h.requests.length, 0); assert.equal(h.vault[PRECURSOR_CREDENTIAL_STORAGE], undefined); assert.ok(readModesState(h.service.getState()));
  }
});

test('documented trusted-default session storage remains usable without setAccessLevel', async t => {
  const h = harness(); delete h.api.storage.session.setAccessLevel; t.after(() => h.service.dispose());
  await h.connect('off'); assert.equal(h.service.getState().mode, 'off'); assert.equal(h.vault[PRECURSOR_CREDENTIAL_STORAGE].token, TOKEN);
});

test('Firefox trusted-default vault works without getKeys while Chrome remains gated', async t => {
  const h = harness({ firefox: true, sessionSupported: false }); delete h.api.storage.session.setAccessLevel; t.after(() => h.service.dispose());
  await h.connect('monitor'); assert.equal(h.service.getState().mode, 'monitor'); assert.equal(h.vault[PRECURSOR_CREDENTIAL_STORAGE].token, TOKEN);
  assert.equal(h.sessionCalls.some(call => call[0] === 'getKeys' || call[0] === 'setAccessLevel'), false);
  const unavailable = harness({ firefox: true }); unavailable.api.storage.session.getKeys = async () => { throw Error('denied'); }; t.after(() => unavailable.service.dispose());
  await unavailable.service.ready; await assert.rejects(unavailable.service.command('connect', { zoneId: ZONE, token: TOKEN }), error('session-unavailable')); assert.equal(unavailable.requests.length, 0);
});

test('Retry-After survives worker replacement and alarm wakeup cannot bypass it', async t => {
  const first = harness(); await first.connect('monitor'); first.advance(60000); first.queue.push(json({}, 429, { 'retry-after': '3600' }));
  await assert.rejects(first.service.command('refresh'), error('rate-limited'));
  const saved = structuredClone(first.data[PRECURSOR_MODES_STORAGE]), savedVault = structuredClone(first.vault[PRECURSOR_CREDENTIAL_STORAGE]), savedTransport = structuredClone(first.data[PRECURSOR_TRANSPORT_STORAGE]); await first.service.dispose();
  assert.equal(savedTransport.retryAt, 4660000); assert.equal(savedTransport.failures, 1);
  const h = harness({ saved, savedVault, savedTransport, initialAt: 1120000 }); t.after(() => h.service.dispose()); await h.service.ready;
  assert.equal(h.requests.length, 0); assert.equal(h.service.getState().connected, true); assert.equal(h.service.getState().mode, 'unknown'); assert.equal(h.service.getState().status, 'stale');
  assert.ok(h.alarmCalls.some(call => call[0] === 'create'));
  h.advance(60000); h.api.alarms.onAlarm.fire({ name: PRECURSOR_MODES_ALARM }); await tick(); assert.equal(h.requests.length, 0);
  await assert.rejects(h.service.command('connect', { zoneId: ZONE, token: TOKEN }), error('cooldown'));
  h.setTime(savedTransport.retryAt); h.queue.push(json({ id: ZONE, name: 'example.com' }), mode('arm')); h.api.alarms.onAlarm.fire({ name: PRECURSOR_MODES_ALARM }); await tick();
  assert.equal(h.requests.length, 2); assert.equal(h.service.getState().mode, 'arm'); assert.equal(h.data[PRECURSOR_TRANSPORT_STORAGE].retryAt, 0);
});

test('an initial rate limit without a known mode still persists its reconnect throttle', async t => {
  const first = harness(); first.queue.push(json({}, 429, { 'retry-after': '600' })); await assert.rejects(first.service.command('connect', { zoneId: ZONE, token: TOKEN }), error('rate-limited'));
  assert.equal(first.data[PRECURSOR_MODES_STORAGE], undefined); assert.equal(first.vault[PRECURSOR_CREDENTIAL_STORAGE], undefined);
  const savedTransport = structuredClone(first.data[PRECURSOR_TRANSPORT_STORAGE]); await first.service.dispose();
  const h = harness({ savedTransport, initialAt: 1060000 }); t.after(() => h.service.dispose()); await h.service.ready;
  await assert.rejects(h.service.command('connect', { zoneId: ZONE, token: TOKEN }), error('cooldown')); assert.equal(h.requests.length, 0);
  await h.service.clear(); assert.equal(h.data[PRECURSOR_TRANSPORT_STORAGE], undefined);
});

test('restored clock rollback keeps a bounded delay instead of issuing an immediate retry', async t => {
  const saved = { version: 1, zone: { id: ZONE, name: 'example.com' }, lastKnownMode: 'monitor', lastKnownAt: 1000000, history: [], notifications: false, monitoring: true };
  const savedVault = { version: 1, zoneId: ZONE, token: TOKEN }, savedTransport = { version: 1, lastAttempt: 1000000, retryAt: 4600000, failures: 1 };
  const h = harness({ saved, savedVault, savedTransport, initialAt: 1 }); t.after(() => h.service.dispose()); await h.service.ready;
  assert.equal(h.requests.length, 0); assert.equal(h.service.getState().errorCode, 'clock-changed'); assert.equal(h.data[PRECURSOR_TRANSPORT_STORAGE].retryAt, 3600001);
  assert.ok(h.alarmCalls.some(call => call[0] === 'create')); assert.equal(h.service.getState().mode, 'unknown');
});

test('malformed, extra-field and different-zone session vaults never restore or make network calls', async t => {
  const saved = { version: 1, zone: { id: ZONE, name: 'example.com' }, lastKnownMode: 'monitor', lastKnownAt: 1000000, history: [], notifications: false, monitoring: true };
  for (const savedVault of [{ version: 1, zoneId: ZONE, token: TOKEN, extra: 'not-authorized' }, { version: 1, zoneId: OTHER_ZONE, token: TOKEN }, { version: 1, zoneId: ZONE, token: 'bad\nheader' }, { version: 2, zoneId: ZONE, token: TOKEN }]) {
    const h = harness({ saved, savedVault }); t.after(() => h.service.dispose()); await h.service.ready;
    assert.equal(h.requests.length, 0); assert.equal(h.service.getState().connected, false); assert.equal(h.service.getState().mode, 'unknown');
    assert.equal(h.vault[PRECURSOR_CREDENTIAL_STORAGE], undefined); assert.equal(h.data[PRECURSOR_MODES_STORAGE].monitoring, false);
  }
});

test('disconnect and clear acknowledge only after the credential is removed', async t => {
  for (const clear of [false, true]) {
    const h = harness(); t.after(() => h.service.dispose()); await h.connect('monitor'); const removal = deferred(), original = h.api.storage.session.remove;
    h.api.storage.session.remove = async key => { await removal.promise; return original(key); };
    let finished = false;
    const stopping = (clear ? h.service.clear() : h.service.command('disconnect')).then(value => { finished = true; return value; }); await tick();
    assert.equal(h.service.getState().connected, false); assert.equal(h.service.getState().mode, 'unknown'); assert.equal(finished, false);
    removal.resolve(); await stopping; assert.equal(h.vault[PRECURSOR_CREDENTIAL_STORAGE], undefined);
    assert.equal(clear ? h.data[PRECURSOR_MODES_STORAGE] : h.data[PRECURSOR_MODES_STORAGE].monitoring, clear ? undefined : false);
  }
});

test('an in-flight credential write cannot resurrect a disconnected or cleared connection', async t => {
  for (const clear of [false, true]) {
    const h = harness(); t.after(() => h.service.dispose()); await h.service.ready; const writing = deferred(), original = h.api.storage.session.set;
    h.api.storage.session.set = async value => { await writing.promise; return original(value); };
    const connecting = h.connect('monitor'); await tick(); let stopped = false;
    const stopping = (clear ? h.service.clear() : h.service.command('disconnect')).then(() => { stopped = true; }); await tick();
    assert.equal(h.service.getState().connected, false); assert.equal(stopped, false);
    writing.resolve(); await assert.rejects(connecting, error('disconnected')); await stopping;
    assert.equal(h.vault[PRECURSOR_CREDENTIAL_STORAGE], undefined); assert.equal(h.service.getState().connected, false); assert.equal(h.notifications.length, 0);
    assert.equal(clear ? h.data[PRECURSOR_MODES_STORAGE] : h.data[PRECURSOR_MODES_STORAGE].monitoring, clear ? undefined : false);
  }
});

test('failed credential removal reports failure and persisted disable blocks next-worker restoration', async t => {
  const first = harness(); await first.connect('monitor'); first.failCredentialRemoves(true);
  await assert.rejects(first.service.command('disconnect'), error('session-unavailable'));
  assert.equal(first.service.getState().connected, false); assert.equal(first.data[PRECURSOR_MODES_STORAGE].monitoring, false); assert.ok(first.vault[PRECURSOR_CREDENTIAL_STORAGE]);
  const saved = structuredClone(first.data[PRECURSOR_MODES_STORAGE]), savedVault = structuredClone(first.vault[PRECURSOR_CREDENTIAL_STORAGE]); await first.service.dispose();
  const h = harness({ saved, savedVault }); t.after(() => h.service.dispose()); await h.service.ready;
  assert.equal(h.requests.length, 0); assert.equal(h.service.getState().connected, false); assert.equal(h.vault[PRECURSOR_CREDENTIAL_STORAGE], undefined);
});

test('auth rejection, API-host revoke and consent clear erase credentials and disable automatic restoration', async t => {
  for (const kind of ['auth', 'host', 'consent']) {
    const h = harness(); t.after(() => h.service.dispose()); await h.connect('monitor');
    if (kind === 'auth') { h.advance(60000); h.queue.push(json({}, 401)); await assert.rejects(h.service.command('refresh'), error('api-unauthorized')); }
    else if (kind === 'host') { h.api.permissions.onRemoved.fire({ origins: ['https://api.cloudflare.com/*'] }); await tick(); }
    else { h.revokeConsent(); await h.service.clear(); }
    assert.equal(h.vault[PRECURSOR_CREDENTIAL_STORAGE], undefined); assert.equal(h.service.getState().connected, false);
    assert.notEqual(h.data[PRECURSOR_MODES_STORAGE]?.monitoring, true);
  }
});

test('failed credential storage does not report a connected successful operation', async t => {
  const h = harness(); t.after(() => h.service.dispose()); h.failCredentialWrites(true);
  await assert.rejects(h.connect('monitor'), error('session-unavailable'));
  assert.equal(h.service.getState().connected, false); assert.equal(h.service.getState().mode, 'unknown'); assert.equal(h.vault[PRECURSOR_CREDENTIAL_STORAGE], undefined);
  assert.equal(h.data[PRECURSOR_MODES_STORAGE].monitoring, false); assert.equal(h.notifications.length, 0);
});

test('clearing during a redacted metadata write cannot recreate a transport checkpoint afterward', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.service.ready;
  const writing = deferred(), original = h.api.storage.local.set;
  h.api.storage.local.set = async value => { if (Object.hasOwn(value, PRECURSOR_MODES_STORAGE)) await writing.promise; return original(value); };
  const connecting = h.connect('monitor'); await tick(); const clearing = h.service.clear(); await tick();
  writing.resolve(); await assert.rejects(connecting, error('disconnected')); await clearing;
  assert.equal(h.data[PRECURSOR_MODES_STORAGE], undefined); assert.equal(h.data[PRECURSOR_TRANSPORT_STORAGE], undefined); assert.equal(h.vault[PRECURSOR_CREDENTIAL_STORAGE], undefined);
});

test('live worker recovers after clock rollback without waiting for the old date or inventing a transition', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.connect('monitor'); await h.service.command('notifications', { enabled: true });
  h.setTime(1000); await assert.rejects(h.service.command('refresh'), error('clock-changed'));
  assert.equal(h.requests.length, 2); assert.equal(h.service.getState().mode, 'unknown'); assert.equal(h.data[PRECURSOR_TRANSPORT_STORAGE].resetBaseline, true);
  assert.equal(h.data[PRECURSOR_TRANSPORT_STORAGE].retryAt, 11000);
  h.advance(10000); h.queue.push(mode('arm')); const rebased = await h.service.command('refresh');
  assert.equal(rebased.mode, 'arm'); assert.equal(rebased.status, 'ready'); assert.equal(rebased.lastKnownAt, 11000); assert.equal(rebased.errorCode, null);
  assert.equal(rebased.history.length, 0); assert.equal(h.notifications.length, 0); assert.equal(h.data[PRECURSOR_TRANSPORT_STORAGE].resetBaseline, false);
  await h.refresh('off'); assert.equal(h.service.getState().errorCode, null); assert.deepEqual(h.service.getState().history.map(({ from, to }) => ({ from, to })), [{ from: 'arm', to: 'off' }]); assert.equal(h.notifications.length, 1);
});

test('a future persisted baseline recovers after bounded restored backoff and does not notify across the gap', async t => {
  const saved = { version: 1, zone: { id: ZONE, name: 'example.com' }, lastKnownMode: 'monitor', lastKnownAt: 1000000000, history: [], notifications: true, monitoring: true };
  const savedVault = { version: 1, zoneId: ZONE, token: TOKEN }, savedTransport = { version: 1, lastAttempt: 1000000000, retryAt: 1003600000, failures: 1 };
  const h = harness({ saved, savedVault, savedTransport, initialAt: 1000 }); t.after(() => h.service.dispose()); await h.service.ready;
  assert.equal(h.requests.length, 0); assert.equal(h.service.getState().status, 'stale'); assert.equal(h.data[PRECURSOR_TRANSPORT_STORAGE].resetBaseline, true);
  h.setTime(3601000); h.queue.push(json({ id: ZONE, name: 'example.com' }), mode('arm')); h.api.alarms.onAlarm.fire({ name: PRECURSOR_MODES_ALARM }); await tick();
  assert.equal(h.service.getState().mode, 'arm'); assert.equal(h.service.getState().lastKnownAt, 3601000); assert.equal(h.service.getState().history.length, 0); assert.equal(h.notifications.length, 0);
  await h.refresh('off'); assert.equal(h.notifications.length, 1);
});

test('clock rollback inside a pending API response also resets transport time and uses a new baseline', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.connect('monitor'); await h.service.command('notifications', { enabled: true });
  const response = deferred(); h.advance(60000); h.queue.push(() => response.promise); const refreshing = h.service.command('refresh'); await tick();
  h.setTime(1000); response.resolve(mode('arm')); await refreshing;
  assert.equal(h.service.getState().mode, 'arm'); assert.equal(h.data[PRECURSOR_TRANSPORT_STORAGE].lastAttempt, 1000); assert.equal(h.notifications.length, 0);
  await h.refresh('monitor'); assert.equal(h.notifications.length, 1);
});

test('clock rollback inside a pending response is detected even when the previous baseline is older', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.connect('monitor'); await h.service.command('notifications', { enabled: true });
  const response = deferred(); h.advance(60000); h.queue.push(() => response.promise); const refreshing = h.service.command('refresh'); await tick();
  h.setTime(1030000); response.resolve(mode('arm')); await refreshing;
  assert.equal(h.service.getState().mode, 'arm'); assert.equal(h.service.getState().history.length, 0); assert.equal(h.notifications.length, 0);
  assert.equal(h.data[PRECURSOR_TRANSPORT_STORAGE].lastAttempt, 1030000);
  await h.refresh('off'); assert.equal(h.notifications.length, 1);
});

test('clock-reset baseline marker survives worker replacement even if previous baseline time is not in the future', async t => {
  const first = harness(); await first.connect('monitor'); first.advance(60000); first.queue.push(json({}, 503)); await assert.rejects(first.service.command('refresh'), error('api-unavailable'));
  first.setTime(1030000); await assert.rejects(first.service.command('refresh'), error('clock-changed'));
  const saved = structuredClone(first.data[PRECURSOR_MODES_STORAGE]), savedVault = structuredClone(first.vault[PRECURSOR_CREDENTIAL_STORAGE]), savedTransport = structuredClone(first.data[PRECURSOR_TRANSPORT_STORAGE]); await first.service.dispose();
  assert.equal(savedTransport.resetBaseline, true); assert.ok(saved.lastKnownAt < savedTransport.lastAttempt);
  const h = harness({ saved, savedVault, savedTransport, initialAt: savedTransport.retryAt, initialQueue: [json({ id: ZONE, name: 'example.com' }), mode('arm')] }); t.after(() => h.service.dispose()); await h.service.ready;
  assert.equal(h.service.getState().mode, 'arm'); assert.equal(h.service.getState().history.length, 0);
});

test('notification IDs remain distinct after history clear and zone replacement, and click clears only owned IDs', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.connect('off'); await h.service.command('notifications', { enabled: true }); await h.refresh('arm');
  const first = h.notifications.at(-1).id; await h.service.command('disconnect'); h.advance(60000); await h.connect('off', OTHER_ZONE, 'elsewhere.example');
  assert.ok(h.dismissedNotifications.includes(first)); await h.refresh('monitor'); const second = h.notifications.at(-1).id;
  assert.notEqual(first, second); assert.equal(h.service.getState().history[0].id, 1);
  await h.service.clear(); assert.ok(h.dismissedNotifications.includes(second)); await h.connect('off'); await h.service.command('notifications', { enabled: true }); await h.refresh('arm'); const third = h.notifications.at(-1).id;
  assert.equal(new Set([first, second, third]).size, 3);
  for (const id of [first, second, third]) { assert.match(id, /^precursor-mode-[a-f0-9]{32}-[1-9][0-9]*$/); assert.ok(!id.includes(TOKEN)); }
  h.api.notifications.onClicked.fire(third); await tick(); assert.equal(h.dismissedNotifications.at(-1), third); assert.equal(h.tabs.at(-1).url, 'chrome-extension://unit-test/precursor-settings.html');
  const count = h.dismissedNotifications.length, tabs = h.tabs.length; h.api.notifications.onClicked.fire('other-module-1'); h.api.notifications.onClicked.fire('precursor-mode-../../private'); await tick();
  assert.equal(h.dismissedNotifications.length, count); assert.equal(h.tabs.length, tabs);
  h.api.notifications.onClicked.fire('precursor-mode-1'); await tick(); assert.equal(h.dismissedNotifications.at(-1), 'precursor-mode-1');
});

test('notification creation completing after clear is dismissed again and cannot revive an alert', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.connect('off'); await h.service.command('notifications', { enabled: true }); const created = deferred(), original = h.api.notifications.create;
  h.api.notifications.create = async (id, value) => { await original(id, value); await created.promise; };
  const refreshing = h.refresh('arm'); await tick(); const id = h.notifications.at(-1).id; await h.service.clear(); assert.ok(h.dismissedNotifications.includes(id));
  created.resolve(); await refreshing; assert.ok(h.dismissedNotifications.filter(value => value === id).length >= 2); assert.equal(h.service.getState().mode, 'unknown');
});

test('bounded notification bookkeeping dismisses the oldest OS alert when capacity is exceeded', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.connect('off'); await h.service.command('notifications', { enabled: true });
  for (let index = 0; index < 130; index++) await h.refresh(index % 2 === 0 ? 'arm' : 'off');
  assert.equal(new Set(h.notifications.map(item => item.id)).size, 130); assert.deepEqual(h.dismissedNotifications, h.notifications.slice(0, 2).map(item => item.id));
  await h.service.clear(); assert.equal(new Set(h.dismissedNotifications).size, 130);
});

test('explicit Clear dismisses older-worker notifications by owned ID without reading their contents', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.service.ready; let reads = 0;
  const previous = 'precursor-mode-' + 'b'.repeat(32) + '-12', entries = { 'other-module': { message: 'unrelated' }, 'precursor-mode-1': {} };
  Object.defineProperty(entries, previous, { enumerable: true, get() { reads++; throw Error('notification contents must not be read'); } });
  h.api.notifications.getAll = async () => entries;
  await h.service.clear(); await tick();
  assert.deepEqual(new Set(h.dismissedNotifications), new Set([previous, 'precursor-mode-1'])); assert.equal(reads, 0);
});

test('repeated Clear shares one physical notification enumeration and reconnect invalidates its late results', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.service.ready; const list = deferred(); let enumerations = 0;
  h.api.notifications.getAll = () => { enumerations++; return list.promise; };
  for (let index = 0; index < 5; index++) await h.service.clear(); assert.equal(enumerations, 1);
  await h.connect('off'); await h.service.command('notifications', { enabled: true }); await h.refresh('arm'); const current = h.notifications.at(-1).id;
  list.resolve({ [current]: {} }); await tick(); assert.ok(!h.dismissedNotifications.includes(current));
});

test('native notification cleanup is bounded even if clear promises never settle', async t => {
  const h = harness(); t.after(() => h.service.dispose()); await h.service.ready; const pending = deferred(); let calls = 0;
  h.api.notifications.clear = () => { calls++; return pending.promise; };
  for (let index = 1; index <= 256; index++) h.api.notifications.onClicked.fire('precursor-mode-' + index);
  await tick(); assert.equal(calls, 128); pending.resolve(true); await tick();
});
