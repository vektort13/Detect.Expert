// ADR-109: the controller of the Proxy Manager Geolocation API: state, queue, pacing, cache, failover, error memory, key test, settings and
// keys, changes made elsewhere. Everything is faked: storage, network (scripted answers), clock, sleep, providers. No real timer, no real
// network: the injected fetch is reached only through the real client, and the tests assert that.
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate as tick } from 'node:timers/promises';
import { createGeoController } from '../../apps/production-extension/proxy-geo-controller.js';
import {
  GEO_SETTINGS_KEY, GEO_CREDENTIALS_KEY, GEO_CACHE_KEY, GEO_PROVIDERS, GEO_PROVIDER_INFO, GEO_COLUMNS, GEO_ERRORS, GEO_FAILOVER_ERRORS, GEO_TRANSIENT_ERRORS, GEO_LIMITS, GEO_TEST_IP,
  defaultGeoSettings, geoSettingsPatch, geoEmptyFlags, normalizeGeoRecord,
} from '../../apps/production-extension/proxy-geo-shared.js';

// A promise that never settles fails its own test after 15 s instead of hanging the whole run.
const test = (name, body) => nodeTest(name, { timeout: 15000 }, body);

const NOW = 1_800_000_000_000, SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const KEYS = {
  maxmind: { accountId: '987654321', licenseKey: 'CANARY_MAXMIND_LICENSE_KEY' }, ipgeolocation: { apiKey: 'CANARY_IPGEOLOCATION_API_KEY' },
  ipdata: { apiKey: 'CANARY_IPDATA_API_KEY' }, ipapi: { apiKey: 'CANARY_IPAPI_PRO_API_KEY' },
};
const SECRETS = ['987654321', 'CANARY_MAXMIND_LICENSE_KEY', 'CANARY_IPGEOLOCATION_API_KEY', 'CANARY_IPDATA_API_KEY', 'CANARY_IPAPI_PRO_API_KEY'];
const ip = n => '8.8.8.' + n;
const container = items => ({ version: 1, items });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
// Virtual time: a sleeper wakes only when everything else is idle, and the clock then jumps to the earliest wake-up, so the times the fake
// network records are the times a real clock would have shown. Tests never wait for real time.
function world(start = NOW) {
  const clock = { t: start }, timers = [], sleeps = [];
  let pumping = false;
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (timers.length) {
        await tick();
        if (!timers.length) break;
        timers.sort((a, b) => a.at - b.at);
        const next = timers.shift();
        clock.t = Math.max(clock.t, next.at);
        next.resolve();
      }
    } finally { pumping = false; }
  };
  return {
    clock, sleeps, sleep: ms => new Promise(resolve => { sleeps.push(ms); timers.push({ at: clock.t + ms, resolve }); pump(); }),
    async settle() { for (let round = 0; round < 3; round++) await tick(); while (timers.length || pumping) await tick(); for (let round = 0; round < 3; round++) await tick(); },
  };
}
let ambient = world(); // the world of the controller made last: tests run one after another
const settle = () => ambient.settle();

// ---- Fake chrome.storage (shared backing = several pages of one browser profile) ---------------------------------------------------
function createBacking() { return { areas: { local: new Map(), session: new Map() }, listeners: new Set(), log: [], failures: new Map() }; }
function fakeApi(backing, { session = true } = {}) {
  const area = name => {
    const map = backing.areas[name];
    const run = async (op, detail, action) => {
      await Promise.resolve();
      const left = backing.failures.get(name + '.' + op) ?? 0;
      if (left > 0) { backing.failures.set(name + '.' + op, left - 1); throw new Error('CANARY_STORAGE_ERROR ' + JSON.stringify(detail)); }
      return action();
    };
    const emit = changes => { if (Object.keys(changes).length) queueMicrotask(() => { for (const listener of [...backing.listeners]) listener(structuredClone(changes), name); }); };
    return {
      get: keys => run('get', keys, () => {
        backing.log.push({ area: name, op: 'get', keys });
        const wanted = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : [...map.keys()];
        return Object.fromEntries(wanted.filter(key => map.has(key)).map(key => [key, structuredClone(map.get(key))]));
      }),
      set: items => run('set', Object.keys(items), () => {
        if (backing.failKeys && Object.keys(items).some(key => backing.failKeys.has(key))) throw new Error('CANARY_STORAGE_ERROR keyed write');
        backing.log.push({ area: name, op: 'set', keys: Object.keys(items), json: JSON.stringify(items) });
        const changes = {};
        for (const [key, value] of Object.entries(items)) { changes[key] = { oldValue: map.get(key), newValue: structuredClone(value) }; map.set(key, structuredClone(value)); }
        emit(changes);
      }),
      remove: keys => run('remove', keys, () => {
        const list = Array.isArray(keys) ? keys : [keys], changes = {};
        backing.log.push({ area: name, op: 'remove', keys: list });
        for (const key of list) if (map.has(key)) { changes[key] = { oldValue: map.get(key) }; map.delete(key); }
        emit(changes);
      }),
      ...(name === 'session' ? { setAccessLevel: async () => {} } : {}),
    };
  };
  const storage = { local: area('local'), ...(session ? { session: area('session') } : {}), onChanged: { addListener: fn => backing.listeners.add(fn), removeListener: fn => backing.listeners.delete(fn) } };
  for (const name of ['sync', 'managed']) Object.defineProperty(storage, name, { get() { throw new Error('storage.' + name + ' must never be touched'); } });
  return { storage };
}
const stored = (backing, area, key) => backing.areas[area].get(key);
const failNext = (backing, name, count = 1) => backing.failures.set(name, count);
const reads = backing => backing.log.filter(entry => entry.op === 'get').length;

// ---- Fake providers: the real client talks to these, the controller never does ---------------------------------------------------
const ORIGIN_OF = { maxmind: GEO_PROVIDER_INFO.maxmind.origins[0], ipgeolocation: GEO_PROVIDER_INFO.ipgeolocation.origins[0], ipdata: GEO_PROVIDER_INFO.ipdata.origins[0] };
const FREE = GEO_PROVIDER_INFO.ipapi.origins[0], PRO = GEO_PROVIDER_INFO.ipapi.origins[1];
function recordFor(providerId, address, at, body = {}) {
  return { provider: providerId, service: providerId === 'maxmind' ? 'geolite-city' : '', at, ip: body.ip ?? address, country: body.country ?? 'DE', countryName: 'Germany', region: 'Hesse', city: body.city ?? 'Frankfurt',
    timezone: 'Europe/Berlin', asn: 3320, org: 'Example Telecom', isp: '', kind: 'isp', flags: { ...geoEmptyFlags(), proxy: false } };
}
function fakeProviders() {
  return {
    geoBuildRequest(providerId, address, { credential, settings }) {
      const free = providerId === 'ipapi' && !credential;
      if (!credential && !free) return { ok: false, error: 'no-key' };
      if (free && settings.providers.ipapi.http !== true) return { ok: false, error: 'http-not-allowed' };
      const origin = providerId === 'ipapi' ? (credential ? PRO : FREE) : ORIGIN_OF[providerId], secret = credential ? (credential.apiKey ?? credential.licenseKey) : '';
      return { ok: true, url: origin + '/lookup/' + address + (secret ? '?k=' + secret : ''), headers: providerId === 'maxmind' ? { Authorization: 'Basic ' + secret } : {}, origin, bucket: free ? 'ipapi-free' : providerId };
    },
    geoParseResponse(providerId, { headers, text }, { ip: address, now }) {
      let body;
      try { body = JSON.parse(text); } catch { return { ok: false, error: 'bad-response', retryAfterMs: null, quota: null }; }
      const remaining = headers['x-rl'] === undefined ? null : Number(headers['x-rl']), quota = remaining === null ? null : { remaining, pausedMs: remaining === 0 ? Number(headers['x-ttl']) * SECOND : null };
      if (body.error) return { ok: false, error: body.error, retryAfterMs: body.retryAfterMs ?? null, quota };
      return { ok: true, record: body.junk ? { provider: 'nope' } : recordFor(providerId, address, now, body), quota };
    },
  };
}
const answer = (body = {}, extra = {}) => ({ body, ...extra });
const fail = (error, extra = {}) => ({ body: { error, ...extra } });
function network(clock) {
  const net = { calls: [], inFlight: 0, maxInFlight: 0, scripts: new Map(), started: [] };
  const owner = url => GEO_PROVIDERS.find(id => GEO_PROVIDER_INFO[id].origins.some(origin => url.startsWith(origin + '/')));
  net.script = (provider, ...steps) => net.scripts.set(provider, [...(net.scripts.get(provider) ?? []), ...steps]);
  net.to = provider => net.calls.filter(call => call.provider === provider);
  net.fetchImpl = async (url, options) => {
    const provider = owner(url), call = { url, options, provider, at: clock.t, ip: url.split('/lookup/')[1].split('?')[0] };
    net.calls.push(call);
    const step = net.scripts.get(provider)?.shift() ?? {};
    net.inFlight++; net.maxInFlight = Math.max(net.maxInFlight, net.inFlight);
    try {
      if (step.hold) await step.hold.promise;
      if (step.reject) throw step.reject;
      return new Response(typeof step.body === 'string' ? step.body : JSON.stringify(step.body ?? {}), { status: step.status ?? 200, headers: { 'content-type': 'application/json', ...step.headers } });
    } finally { net.inFlight--; }
  };
  return net;
}

// ---- Builders --------------------------------------------------------------------------------------------------------------------
const enabledSettings = (ids, patch = {}) => geoSettingsPatch(defaultGeoSettings(), { enabled: true, providers: Object.fromEntries(ids.map(id => [id, id === 'ipapi' ? { enabled: true, http: true } : { enabled: true }])), ...patch });
const keysFor = ids => container(Object.fromEntries(ids.filter(id => id !== 'ipapi' || KEYS.ipapi).map(id => [id, KEYS[id]])));
function seed(backing, { settings, credentials, cache }) {
  if (settings) backing.areas.local.set(GEO_SETTINGS_KEY, structuredClone(settings));
  if (credentials) backing.areas[settings?.remember ? 'local' : 'session'].set(GEO_CREDENTIALS_KEY, structuredClone(credentials));
  if (cache) backing.areas.local.set(GEO_CACHE_KEY, structuredClone(cache));
}
// A controller on a fresh (or the given) storage. `ids` are providers that are enabled AND have their key; ipapi gets its Pro key.
async function make({ ids = ['ipdata'], backing = createBacking(), settings, credentials, cache, patch, start = NOW, load = true, api, client, store, time = world(start) } = {}) {
  ambient = time;
  const { clock, sleeps, sleep } = time, net = network(clock), providers = fakeProviders();
  if (ids !== null) seed(backing, { settings: settings ?? enabledSettings(ids, patch), credentials: credentials ?? keysFor(ids), cache });
  const controller = createGeoController({ api: fakeApi(backing, api), fetchImpl: net.fetchImpl, now: () => clock.t, sleep, providers, client, store });
  if (load) await controller.load();
  return { controller, clock, net, backing, sleeps, providers, time, state: () => controller.getState() };
}
const cachedRecord = (address, at = NOW - 1000, patch = {}) => ({ ...recordFor('ipdata', address, at), ...patch });
const cacheOf = records => container(Object.fromEntries(records.map(item => [item.ip, item])));
const plain = value => JSON.parse(JSON.stringify(value)); // dictionaries without a prototype, as ordinary objects
const deepFrozen = value => { if (value === null || typeof value !== 'object') return true; return Object.isFrozen(value) && Reflect.ownKeys(value).every(key => deepFrozen(value[key])); };

test('before load: a frozen default state; load() reads storage once, is idempotent and returns the state', async () => {
  const { controller, backing } = await make({ load: false });
  const before = controller.getState();
  assert.equal(before.loaded, false); assert.equal(before.revision, 0); assert.equal(before.enabled, false); assert.equal(before.ready, false);
  assert.deepEqual(before.readyProviders, []); assert.deepEqual(before.settings, defaultGeoSettings());
  assert.deepEqual(before.hasCredentials, { maxmind: false, ipgeolocation: false, ipdata: false, ipapi: false });
  assert.equal(before.cacheCount, 0);
  for (const key of ['records', 'pending', 'errors']) { assert.equal(Object.getPrototypeOf(before[key]), null, key); assert.deepEqual(Object.keys(before[key]), []); }
  assert.deepEqual(Object.keys(before.providers), GEO_PROVIDERS);
  assert.deepEqual(before.providers.ipdata, { enabled: false, ready: false, reason: 'disabled', status: 'idle', error: null, okAt: null, remaining: null, pausedUntil: null });
  assert.ok(deepFrozen(before)); assert.equal(controller.getState(), before, 'the same object while nothing changes');
  assert.equal(reads(backing), 0, 'creating a controller reads nothing');
  const [first, second] = await Promise.all([controller.load(), controller.load()]);
  assert.equal(first, second); assert.equal(first.loaded, true);
  assert.equal(await controller.load(), controller.getState());
  assert.equal(reads(backing), 1 + 1, 'one load: one read of the three values and one of the key area');
  assert.equal(controller.getState().ready, true); assert.deepEqual(controller.getState().readyProviders, ['ipdata']);
});

test('a failed first load leaves the state unloaded, writes refuse, and the next load() tries again', async () => {
  const backing = createBacking();
  seed(backing, { settings: enabledSettings(['ipdata']), credentials: keysFor(['ipdata']) });
  const { controller } = await make({ ids: null, backing, load: false });
  failNext(backing, 'local.get', 3);
  const state = await controller.load();
  assert.equal(state.loaded, false); assert.equal(state.enabled, false);
  assert.deepEqual(await controller.setEnabled(true), { ok: false, error: 'storage-unavailable' }, 'a setter tries to load first, and refuses when it cannot');
  assert.deepEqual(await controller.saveCredential('ipdata', { apiKey: 'CANARY_IPDATA_API_KEY' }), { ok: false, error: 'storage-unavailable' });
  assert.equal(stored(backing, 'local', GEO_SETTINGS_KEY).enabled, true, 'nothing was overwritten with defaults');
  assert.equal(controller.getState().loaded, false);
  const again = await controller.load();
  assert.equal(again.loaded, true); assert.equal(again.enabled, true); assert.equal(again.ready, true);
  assert.deepEqual(await controller.load(), controller.getState());
});

test('a state is deep frozen, every change makes a new object, dictionaries have no prototype, and no secret is in it', async () => {
  const { controller, state } = await make({ ids: ['maxmind', 'ipdata'], cache: cacheOf([cachedRecord(ip(1))]) });
  const first = state();
  assert.ok(deepFrozen(first)); assert.equal(state(), first);
  assert.equal(first.loaded, true); assert.equal(first.enabled, true); assert.equal(first.ready, true); assert.deepEqual(first.readyProviders, ['maxmind', 'ipdata']);
  assert.deepEqual(first.hasCredentials, { maxmind: true, ipgeolocation: false, ipdata: true, ipapi: false });
  assert.ok(Object.values(first.hasCredentials).every(value => typeof value === 'boolean'));
  assert.equal(first.cacheCount, 1); assert.deepEqual(Object.keys(first.records), [ip(1)]); assert.equal(Object.getPrototypeOf(first.records), null);
  assert.deepEqual(first.providers.maxmind, { enabled: true, ready: true, reason: '', status: 'idle', error: null, okAt: null, remaining: null, pausedUntil: null });
  assert.throws(() => { first.enabled = false; }, TypeError); assert.throws(() => { first.records[ip(2)] = {}; }, TypeError); assert.throws(() => { first.settings.columns.push('geo'); }, TypeError);
  assert.throws(() => { first.records[ip(1)].flags.proxy = true; }, TypeError); assert.throws(() => { first.readyProviders.push('x'); }, TypeError);
  assert.ok(!SECRETS.some(secret => JSON.stringify(first).includes(secret)));
  await controller.setColumns(['geo']);
  const second = state();
  assert.notEqual(second, first); assert.ok(second.revision > first.revision); assert.deepEqual(second.settings.columns, ['geo']); assert.deepEqual(first.settings.columns, GEO_COLUMNS, 'an old snapshot never changes');
  assert.equal(second.records[ip(1)], first.records[ip(1)], 'unchanged records are shared between snapshots');
});

test('subscribers are called once for a batch of changes, in a microtask; unsubscribe works; a throwing subscriber stops nobody', async () => {
  const { controller, net, state } = await make();
  const hold = deferred(); net.script('ipdata', { hold }, { hold }, { hold });
  const seen = [], other = [];
  const stop = controller.subscribe(() => { seen.push(state().revision); });
  controller.subscribe(() => { throw new Error('CANARY broken view'); });
  controller.subscribe(() => other.push(1));
  const baseline = state().revision;
  const jobs = [controller.lookup(ip(1)), controller.lookup(ip(2)), controller.lookup(ip(3))];
  assert.equal(seen.length, 0, 'nothing is called synchronously');
  await tick();
  assert.equal(seen.length, 1, 'three pending flags are one notification'); assert.equal(other.length, 1);
  assert.equal(seen[0] - baseline, 3, 'the one call saw all three changes'); assert.deepEqual(Object.keys(state().pending).sort(), [ip(1), ip(2), ip(3)]);
  stop();
  hold.resolve(); await Promise.all(jobs); await settle();
  assert.equal(seen.length, 1, 'no call after the unsubscribe'); assert.ok(other.length > 1, 'the others went on');
  assert.equal(typeof controller.subscribe('nope'), 'function'); assert.equal(typeof controller.subscribe(null), 'function');
});

test('lookup: an address that is not a public one is refused first, with no load, no network and no storage read', async () => {
  const { controller, net, backing } = await make({ load: false });
  for (const bad of ['10.0.0.1', '127.0.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fe80::1', '100.64.0.1', 'example.com', '', ' 8.8.8.8', '8.8.8.8:53', '8.8.8.8/24', null, undefined, 5, {}, ['8.8.8.8']]) {
    assert.deepEqual(await controller.lookup(bad), { ok: false, error: 'not-public' }, String(bad));
  }
  assert.equal(net.calls.length, 0); assert.equal(reads(backing), 0); assert.equal(controller.getState().loaded, false);
});

test('lookup: the order of refusals is public address, master switch, ready providers; none of them touches the network', async () => {
  let h = await make({ ids: ['ipdata'], patch: { enabled: false } });
  assert.deepEqual(await h.controller.lookup(ip(1)), { ok: false, error: 'disabled' });
  h = await make({ ids: [] });
  assert.deepEqual(await h.controller.lookup(ip(1)), { ok: false, error: 'no-provider' });
  h = await make({ ids: ['ipdata'], credentials: container({}) });
  assert.deepEqual(await h.controller.lookup(ip(1)), { ok: false, error: 'no-provider' }, 'enabled, but no key');
  h = await make({ ids: ['ipapi'], settings: geoSettingsPatch(defaultGeoSettings(), { enabled: true, providers: { ipapi: { enabled: true } } }), credentials: container({}) });
  assert.deepEqual(await h.controller.lookup(ip(1)), { ok: false, error: 'no-provider' }, 'ip-api without a key needs the http acknowledgement');
  h = await make({ ids: ['ipdata'], patch: { enabled: false }, cache: cacheOf([cachedRecord(ip(1))]) });
  assert.deepEqual(await h.controller.lookup(ip(1)), { ok: false, error: 'disabled' }, 'a cached record is not served while the feature is off');
  assert.deepEqual(await h.controller.lookup('10.1.1.1'), { ok: false, error: 'not-public' }, 'the address is checked before the switch');
  assert.equal(h.net.calls.length, 0);
});

test('lookup: a canonical address is used whatever the spelling; the cache is keyed by it', async () => {
  const { controller, net, state } = await make();
  const result = await controller.lookup('::ffff:8.8.8.1');
  assert.equal(result.ok, true); assert.equal(result.record.ip, '8.8.8.1');
  assert.equal(net.calls.length, 1); assert.equal(net.calls[0].ip, '8.8.8.1');
  assert.deepEqual(Object.keys(state().records), ['8.8.8.1']);
  assert.equal((await controller.lookup('8.8.8.1')).fromCache, true);
  const v6 = await controller.lookup('2001:4860:4860:0:0:0:0:8888');
  assert.equal(v6.ok, true); assert.equal(v6.record.ip, '2001:4860:4860::8888');
});

test('lookup: success returns the checked record, keeps it in the state and in storage, and clears the pending flag', async () => {
  const { controller, net, backing, state } = await make();
  const hold = deferred(); net.script('ipdata', { hold });
  const job = controller.lookup(ip(1));
  await tick();
  assert.deepEqual(plain(state().pending), { [ip(1)]: true }); assert.equal(Object.getPrototypeOf(state().pending), null);
  hold.resolve();
  const result = await job;
  assert.equal(result.ok, true); assert.equal(result.fromCache, false); assert.ok(Object.isFrozen(result));
  assert.equal(result.record.country, 'DE'); assert.equal(result.record.provider, 'ipdata'); assert.ok(deepFrozen(result.record));
  assert.deepEqual(normalizeGeoRecord(result.record, NOW), { ...result.record, flags: { ...result.record.flags } });
  assert.equal(state().records[ip(1)], result.record, 'the record in the state is the one returned');
  assert.deepEqual(plain(state().pending), {}); assert.equal(state().cacheCount, 1);
  assert.deepEqual(Object.keys(stored(backing, 'local', GEO_CACHE_KEY).items), [ip(1)]);
  assert.equal(state().providers.ipdata.status, 'ok'); assert.equal(state().providers.ipdata.okAt, NOW);
  assert.equal(net.calls.length, 1);
  const { options } = net.calls[0];
  assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); assert.equal(options.referrerPolicy, 'no-referrer');
});

test('cache: a fresh record answers without the network and is the same object; force asks again; an old record is refreshed', async () => {
  const { controller, net, state, clock } = await make({ cache: cacheOf([cachedRecord(ip(1), NOW - HOUR)]) });
  const hit = await controller.lookup(ip(1));
  assert.equal(hit.ok, true); assert.equal(hit.fromCache, true); assert.equal(hit.record, state().records[ip(1)]); assert.equal(net.calls.length, 0);
  const forced = await controller.lookup(ip(1), { force: true });
  assert.equal(forced.fromCache, false); assert.equal(net.calls.length, 1); assert.equal(state().records[ip(1)].at, NOW, 'the new record replaced the old');
  assert.equal((await controller.lookup(ip(1))).fromCache, true);
  clock.t += DAY + MINUTE; // the record is now older than 24 hours: shown, but not fresh
  assert.ok(state().records[ip(1)], 'still shown');
  const refreshed = await controller.lookup(ip(1));
  assert.equal(refreshed.fromCache, false); assert.equal(net.calls.length, 2);
  for (const odd of [null, undefined, 5, 'force', { force: 'yes' }, { force: 1 }]) assert.equal((await controller.lookup(ip(1), odd)).fromCache, true, 'only force:true forces');
  assert.equal(net.calls.length, 2);
});

test('cache: an old record stays visible when the refresh fails, and a record older than 30 days is not loaded at all', async () => {
  const { controller, net, state } = await make({ cache: cacheOf([cachedRecord(ip(1), NOW - 2 * DAY), cachedRecord(ip(2), NOW - 31 * DAY)]) });
  assert.deepEqual(Object.keys(state().records), [ip(1)]);
  net.script('ipdata', fail('server'));
  assert.deepEqual(await controller.lookup(ip(1)), { ok: false, error: 'server' });
  assert.ok(state().records[ip(1)], 'the older answer is still there');
});

test('in-flight dedupe: two lookups of one address are one request and one result; a forced one joins them', async () => {
  const { controller, net, state } = await make();
  const hold = deferred(); net.script('ipdata', { hold });
  const first = controller.lookup(ip(1)), second = controller.lookup(ip(1)), forced = controller.lookup(ip(1), { force: true }), spelled = controller.lookup('::ffff:8.8.8.1');
  await tick();
  assert.equal(net.calls.length, 1); assert.deepEqual(plain(state().pending), { [ip(1)]: true });
  hold.resolve();
  const results = await Promise.all([first, second, forced, spelled]);
  assert.equal(net.calls.length, 1, 'one request');
  assert.ok(results.every(result => result === results[0]), 'the same result for everyone');
  assert.equal(results[0].ok, true);
  assert.equal((await controller.lookup(ip(1))).fromCache, true);
});

test('error memory: a non-transient error is remembered for ten minutes per address; force and time end it', async () => {
  const { controller, net, state, clock } = await make();
  net.script('ipdata', fail('not-found'));
  assert.deepEqual(await controller.lookup(ip(1)), { ok: false, error: 'not-found' });
  assert.deepEqual(plain(state().errors), { [ip(1)]: { code: 'not-found', at: NOW } }); assert.equal(Object.getPrototypeOf(state().errors), null); assert.ok(deepFrozen(state().errors));
  assert.deepEqual(await controller.lookup(ip(1)), { ok: false, error: 'not-found' }); assert.equal(net.calls.length, 1, 'remembered: no second request');
  assert.equal((await controller.lookup(ip(2))).ok, true, 'other addresses are unaffected'); assert.equal(net.calls.length, 2);
  net.script('ipdata', fail('not-found'));
  assert.equal((await controller.lookup(ip(1), { force: true })).error, 'not-found'); assert.equal(net.calls.length, 3, 'force asks again');
  clock.t += 10 * MINUTE - 1;
  assert.equal((await controller.lookup(ip(1))).error, 'not-found'); assert.equal(net.calls.length, 3, 'still remembered a moment before the end');
  clock.t += 2;
  assert.equal((await controller.lookup(ip(1))).ok, true); assert.equal(net.calls.length, 4, 'ten minutes later it asks again');
  assert.deepEqual(plain(state().errors), {}, 'and a success forgets the error');
});

test('error memory: transient errors and local conditions are never remembered; every other provider error is', async () => {
  for (const code of GEO_ERRORS) {
    if (['disabled', 'no-provider', 'no-key', 'http-not-allowed'].includes(code)) continue;
    const { controller, net, state } = await make({ ids: ['ipdata'], patch: { failover: false } });
    net.script('ipdata', fail(code), fail(code));
    assert.deepEqual(await controller.lookup(ip(1)), { ok: false, error: code }, code);
    await controller.lookup(ip(1));
    const transient = GEO_TRANSIENT_ERRORS.includes(code);
    // A rate-limited provider is not asked again for any address while its pause lasts (pausing is tested separately), so it also stays at one request.
    assert.equal(net.calls.length, transient && code !== 'rate-limited' ? 2 : 1, code + (transient ? ': asked again' : ': remembered'));
    assert.deepEqual(Object.keys(state().errors), transient ? [] : [ip(1)], code);
  }
  // Local conditions are answered before any request and are not remembered either.
  const { controller, state } = await make({ ids: ['ipdata'], patch: { enabled: false } });
  await controller.lookup(ip(1));
  assert.deepEqual(plain(state().errors), {});
});

test('error memory: a change of keys or provider settings ends it, so fixing the setup is tried at once', async () => {
  const { controller, net } = await make({ ids: ['ipdata'] });
  net.script('ipdata', fail('unauthorized'));
  assert.equal((await controller.lookup(ip(1))).error, 'unauthorized');
  assert.equal((await controller.lookup(ip(1))).error, 'unauthorized'); assert.equal(net.calls.length, 1);
  assert.deepEqual(await controller.saveCredential('ipdata', { apiKey: 'CANARY_IPDATA_API_KEY_NEW' }), { ok: true });
  assert.equal((await controller.lookup(ip(1))).ok, true); assert.equal(net.calls.length, 2);
  net.script('ipdata', fail('not-found'));
  assert.equal((await controller.lookup(ip(2))).error, 'not-found');
  await controller.setProvider('ipgeolocation', { enabled: true });
  assert.equal((await controller.lookup(ip(2))).ok, true, 'the remembered answer belonged to the old setup'); assert.equal(net.calls.length, 4);
});

test('failover: providers are asked in priority order, the next one only after an error another provider may cure', async () => {
  const { controller, net, state } = await make({ ids: ['maxmind', 'ipgeolocation', 'ipdata', 'ipapi'] });
  net.script('maxmind', fail('unauthorized')); net.script('ipgeolocation', fail('quota'));
  const result = await controller.lookup(ip(1));
  assert.equal(result.ok, true); assert.equal(result.record.provider, 'ipdata');
  assert.deepEqual(net.calls.map(call => call.provider), ['maxmind', 'ipgeolocation', 'ipdata']);
  assert.equal(state().providers.maxmind.status, 'error'); assert.equal(state().providers.maxmind.error, 'unauthorized');
  assert.equal(state().providers.ipgeolocation.error, 'quota'); assert.equal(state().providers.ipdata.status, 'ok'); assert.equal(state().providers.ipapi.status, 'idle');
  assert.deepEqual(state().readyProviders, ['maxmind', 'ipgeolocation', 'ipdata', 'ipapi']);
});

test('failover: exactly the codes in GEO_FAILOVER_ERRORS go on to the next provider; every other code is the answer', async () => {
  for (const code of GEO_ERRORS) {
    const { controller, net } = await make({ ids: ['maxmind', 'ipdata'] });
    net.script('maxmind', fail(code));
    const result = await controller.lookup(ip(1));
    if (GEO_FAILOVER_ERRORS.includes(code)) {
      assert.deepEqual(net.calls.map(call => call.provider), ['maxmind', 'ipdata'], code); assert.equal(result.ok, true, code);
    } else {
      assert.deepEqual(net.calls.map(call => call.provider), ['maxmind'], code); assert.deepEqual(result, { ok: false, error: code }, code);
    }
  }
});

test('failover: with the option off only the first ready provider is ever asked, even when it is paused or refused', async () => {
  const { controller, net, state } = await make({ ids: ['maxmind', 'ipdata'], patch: { failover: false } });
  net.script('maxmind', fail('server'), fail('rate-limited', { retryAfterMs: 5000 }));
  assert.deepEqual(await controller.lookup(ip(1)), { ok: false, error: 'server' });
  assert.deepEqual(net.calls.map(call => call.provider), ['maxmind']);
  assert.deepEqual(await controller.lookup(ip(2)), { ok: false, error: 'rate-limited' });
  assert.deepEqual(await controller.lookup(ip(3)), { ok: false, error: 'rate-limited' }, 'paused: answered without the network, the second provider is not tried');
  assert.deepEqual(net.calls.map(call => call.provider), ['maxmind', 'maxmind']);
  assert.equal(state().providers.ipdata.status, 'idle');
  await controller.setOption('failover', true);
  assert.equal((await controller.lookup(ip(4))).record.provider, 'ipdata', 'the same setup with failover on goes on to the next');
});

test('failover: at most three providers are asked for one address; the answer is the last one asked', async () => {
  const { controller, net } = await make({ ids: ['maxmind', 'ipgeolocation', 'ipdata', 'ipapi'] });
  net.script('maxmind', fail('unauthorized')); net.script('ipgeolocation', fail('forbidden')); net.script('ipdata', fail('plan')); net.script('ipapi', {});
  assert.deepEqual(await controller.lookup(ip(1)), { ok: false, error: 'plan' });
  assert.deepEqual(net.calls.map(call => call.provider), ['maxmind', 'ipgeolocation', 'ipdata'], 'the fourth is never asked');
  assert.equal(net.to('ipapi').length, 0);
});

test('failover: a paused provider is skipped without using up one of the three attempts', async () => {
  const { controller, net } = await make({ ids: ['maxmind', 'ipgeolocation', 'ipdata', 'ipapi'] });
  net.script('maxmind', fail('rate-limited', { retryAfterMs: 30 * SECOND }));
  net.script('ipgeolocation', fail('server'), fail('server')); net.script('ipdata', fail('server'), fail('server'));
  assert.deepEqual(await controller.lookup(ip(1)), { ok: false, error: 'server' });
  assert.deepEqual(net.calls.map(call => call.provider), ['maxmind', 'ipgeolocation', 'ipdata']);
  const second = await controller.lookup(ip(2));
  assert.deepEqual(net.calls.slice(3).map(call => call.provider), ['ipgeolocation', 'ipdata', 'ipapi'], 'maxmind is passed over, so three providers are really asked');
  assert.equal(second.ok, true); assert.equal(second.record.provider, 'ipapi');
});

test('failover: a record the checks refuse is bad-response and goes on; a record about another address is refused', async () => {
  let h = await make({ ids: ['maxmind', 'ipdata'] });
  h.net.script('maxmind', answer({ junk: true }));
  let result = await h.controller.lookup(ip(1));
  assert.equal(result.ok, true); assert.equal(result.record.provider, 'ipdata'); assert.equal(h.state().providers.maxmind.error, 'bad-response');
  h = await make({ ids: ['ipdata'] });
  h.net.script('ipdata', answer({ ip: ip(77) }));
  result = await h.controller.lookup(ip(1));
  assert.deepEqual(result, { ok: false, error: 'bad-response' }, 'data about 8.8.8.77 is not data about 8.8.8.1');
  assert.equal(h.state().cacheCount, 0);
  h = await make({ ids: ['ipdata'] });
  h.net.script('ipdata', answer({ country: 'germany' }));
  assert.deepEqual(await h.controller.lookup(ip(1)), { ok: false, error: 'bad-response' }, 'normalizeGeoRecord decides what a record is');
  assert.deepEqual(plain(h.state().records), {}); assert.equal(h.backing.areas.local.has(GEO_CACHE_KEY), false);
});

test('the cache is bounded to 200 records: the newest stay, in the state and in storage', async () => {
  const { controller, state, backing } = await make({ ids: ['ipdata'] });
  const addresses = Array.from({ length: GEO_LIMITS.cacheEntries + 8 }, (_, index) => '8.8.' + (1 + Math.floor(index / 200)) + '.' + (1 + (index % 200)));
  for (const address of addresses) assert.equal((await controller.lookup(address)).ok, true);
  assert.equal(state().cacheCount, GEO_LIMITS.cacheEntries); assert.equal(Object.keys(state().records).length, GEO_LIMITS.cacheEntries);
  assert.equal(Object.keys(stored(backing, 'local', GEO_CACHE_KEY).items).length, GEO_LIMITS.cacheEntries);
  assert.ok(state().records[addresses.at(-1)], 'the newest is kept');
});

test('results that arrive together are one cache write; every result is in storage when its lookup resolves', async () => {
  const { controller, net, backing } = await make({ ids: ['ipdata'] });
  const holds = [deferred(), deferred(), deferred(), deferred()];
  net.script('ipdata', ...holds.map(hold => ({ hold })));
  const jobs = [1, 2, 3, 4].map(n => controller.lookup(ip(n)));
  await settle();
  for (const hold of holds) hold.resolve();
  const results = await Promise.all(jobs);
  assert.ok(results.every(result => result.ok));
  const cacheWrites = backing.log.filter(entry => entry.op === 'set' && entry.keys.includes(GEO_CACHE_KEY)).length;
  assert.ok(cacheWrites >= 1 && cacheWrites < 4, 'writes: ' + cacheWrites);
  assert.deepEqual(Object.keys(stored(backing, 'local', GEO_CACHE_KEY).items).sort(), [1, 2, 3, 4].map(ip));
});

test('pausing: rate-limited and quota pause the provider for the hint, or a default, at most an hour; the state says so', async () => {
  const cases = [['rate-limited', undefined, MINUTE], ['quota', undefined, 10 * MINUTE], ['rate-limited', 5 * SECOND, 5 * SECOND], ['quota', 2 * MINUTE, 2 * MINUTE],
    ['rate-limited', 10 * HOUR, HOUR], ['quota', 3 * DAY, HOUR], ['rate-limited', 0, MINUTE], ['rate-limited', -5, MINUTE]];
  for (const [code, hint, expected] of cases) {
    const { controller, net, state, clock } = await make({ ids: ['ipdata'] });
    net.script('ipdata', fail(code, hint === undefined ? {} : { retryAfterMs: hint }));
    assert.deepEqual(await controller.lookup(ip(1)), { ok: false, error: code }, code + ' ' + hint);
    const provider = state().providers.ipdata;
    assert.equal(provider.status, 'error'); assert.equal(provider.error, code); assert.equal(provider.pausedUntil, NOW + expected, code + ' ' + hint);
    assert.equal(provider.ready, true, 'the setup is fine; only the provider is paused'); assert.equal(state().ready, true);
    // While it lasts nothing is sent to the provider, forced or not, for any address.
    assert.deepEqual(await controller.lookup(ip(2)), { ok: false, error: code });
    assert.deepEqual(await controller.lookup(ip(1), { force: true }), { ok: false, error: code });
    assert.equal(net.calls.length, 1);
    clock.t = NOW + expected - 1;
    assert.equal((await controller.lookup(ip(3))).error, code, 'a moment before the end');
    assert.equal(net.calls.length, 1);
    clock.t = NOW + expected;
    assert.equal((await controller.lookup(ip(3))).ok, true, 'at the end it is asked again'); assert.equal(net.calls.length, 2);
    assert.equal(state().providers.ipdata.status, 'ok'); assert.equal(state().providers.ipdata.pausedUntil, null);
  }
});

test('pausing: a pause hint can also come from the quota snapshot (ip-api X-Rl and X-Ttl)', async () => {
  const { controller, net, state } = await make({ ids: ['ipdata'] });
  net.script('ipdata', { body: { error: 'rate-limited' }, headers: { 'x-rl': '0', 'x-ttl': '30' } });
  await controller.lookup(ip(1));
  assert.equal(state().providers.ipdata.pausedUntil, NOW + 30 * SECOND); assert.equal(state().providers.ipdata.remaining, 0);
});

test('unauthorized marks the provider until its credential changes; the chain skips it meanwhile', async () => {
  const { controller, net, state } = await make({ ids: ['ipgeolocation', 'ipdata'] });
  net.script('ipgeolocation', fail('unauthorized'));
  assert.equal((await controller.lookup(ip(1))).ok, true);
  assert.deepEqual(plain(state().providers.ipgeolocation), { enabled: true, ready: true, reason: '', status: 'error', error: 'unauthorized', okAt: null, remaining: null, pausedUntil: null });
  assert.equal((await controller.lookup(ip(2))).ok, true); assert.equal((await controller.lookup(ip(3), { force: true })).ok, true);
  assert.equal(net.to('ipgeolocation').length, 1, 'a key the provider refused is not sent again');
  await controller.setProvider('ipgeolocation', { enabled: false }); await controller.setProvider('ipgeolocation', { enabled: true }); await controller.setEnabled(false); await controller.setEnabled(true);
  assert.equal(state().providers.ipgeolocation.error, 'unauthorized', 'switches do not clear it');
  assert.deepEqual(await controller.saveCredential('ipgeolocation', { apiKey: 'CANARY_NEW_IPGEO_KEY_1' }), { ok: true });
  assert.equal(state().providers.ipgeolocation.status, 'idle'); assert.equal(state().providers.ipgeolocation.error, null);
  assert.equal((await controller.lookup(ip(4))).record.provider, 'ipgeolocation', 'a new key is tried at once');
  assert.equal(state().providers.ipgeolocation.status, 'ok');
});

test('unauthorized is also cleared by forgetting the key, by a change of the provider options, and by a key test that works', async () => {
  const lock = async h => { h.net.script('ipgeolocation', fail('unauthorized')); await h.controller.lookup(ip(1)); assert.equal(h.state().providers.ipgeolocation.error, 'unauthorized'); };
  let h = await make({ ids: ['ipgeolocation', 'ipdata'] });
  await lock(h); await h.controller.forgetCredential('ipgeolocation');
  assert.equal(h.state().providers.ipgeolocation.status, 'idle'); assert.equal(h.state().providers.ipgeolocation.ready, false);
  h = await make({ ids: ['ipgeolocation', 'ipdata'] });
  await lock(h); await h.controller.setProvider('ipgeolocation', { security: true });
  assert.equal(h.state().providers.ipgeolocation.status, 'idle', 'the request is different now');
  h = await make({ ids: ['ipgeolocation', 'ipdata'] });
  await lock(h);
  const tested = await h.controller.testProvider('ipgeolocation');
  assert.equal(tested.ok, true); assert.equal(tested.record.ip, GEO_TEST_IP);
  assert.equal(h.state().providers.ipgeolocation.status, 'ok'); assert.equal(h.state().providers.ipgeolocation.error, null);
  assert.equal((await h.controller.lookup(ip(2))).record.provider, 'ipgeolocation', 'unlocked: asked first again');
});

test('provider status: an answer sets ok, okAt and remaining; address-level answers leave it alone; any other failure marks it', async () => {
  const { controller, net, state, clock } = await make({ ids: ['ipdata'], patch: { failover: false } });
  net.script('ipdata', { body: {}, headers: { 'x-rl': '44', 'x-ttl': '30' } });
  await controller.lookup(ip(1));
  assert.deepEqual(plain(state().providers.ipdata), { enabled: true, ready: true, reason: '', status: 'ok', error: null, okAt: NOW, remaining: 44, pausedUntil: null });
  for (const code of ['not-found', 'not-public']) {
    net.script('ipdata', fail(code)); await controller.lookup(ip(2), { force: true });
    assert.equal(state().providers.ipdata.status, 'ok', code + ' says nothing against the provider'); assert.equal(state().providers.ipdata.error, null);
  }
  for (const code of ['server', 'forbidden', 'plan', 'bad-response', 'timeout', 'network']) {
    net.script('ipdata', fail(code)); await controller.lookup(ip(3), { force: true });
    assert.equal(state().providers.ipdata.status, 'error', code); assert.equal(state().providers.ipdata.error, code); assert.equal(state().providers.ipdata.pausedUntil, null);
  }
  const later = clock.t;
  await controller.lookup(ip(4), { force: true });
  assert.equal(state().providers.ipdata.status, 'ok'); assert.equal(state().providers.ipdata.error, null); assert.ok(state().providers.ipdata.okAt >= later);
  assert.equal(state().providers.ipdata.remaining, 44, 'the last known quota is kept when an answer has none');
});

test('concurrency: at most two requests are in flight for the whole feature, started first in first out', async () => {
  const { controller, net } = await make({ ids: ['ipdata'] });
  const holds = Array.from({ length: 6 }, () => deferred());
  net.script('ipdata', ...holds.map(hold => ({ hold })));
  const jobs = [1, 2, 3, 4, 5, 6].map(n => controller.lookup(ip(n)));
  await settle();
  assert.equal(net.inFlight, 2); assert.deepEqual(net.calls.map(call => call.ip), [ip(1), ip(2)]);
  holds[1].resolve(); await settle();
  assert.equal(net.inFlight, 2); assert.deepEqual(net.calls.map(call => call.ip), [ip(1), ip(2), ip(3)], 'the next in line starts when a place is free');
  holds[0].resolve(); holds[2].resolve(); await settle();
  assert.deepEqual(net.calls.map(call => call.ip), [1, 2, 3, 4, 5].map(ip));
  assert.equal(net.inFlight, 2);
  holds[3].resolve(); holds[4].resolve(); holds[5].resolve();
  const results = await Promise.all(jobs);
  assert.ok(results.every(result => result.ok)); assert.deepEqual(net.calls.map(call => call.ip), [1, 2, 3, 4, 5, 6].map(ip));
  assert.equal(net.maxInFlight, 2, 'never a third');
  assert.equal(GEO_LIMITS.concurrency, 2);
});

test('concurrency: the limit is shared by lookups and key tests, and a failing request frees its place', async () => {
  const { controller, net } = await make({ ids: ['maxmind', 'ipdata'], patch: { failover: false } });
  const holds = [deferred(), deferred()];
  net.script('maxmind', ...holds.map(hold => ({ hold })));
  const lookups = [controller.lookup(ip(1)), controller.lookup(ip(2))];
  await settle();
  const test = controller.testProvider('ipdata');
  await settle();
  assert.equal(net.calls.length, 2, 'the key test waits for a place'); assert.equal(net.inFlight, 2); assert.equal(net.to('ipdata').length, 0);
  holds[0].reject(new TypeError('boom')); await settle();
  assert.equal(net.calls.length, 3, 'a failed request freed its place'); assert.equal(net.to('ipdata').length, 1);
  holds[1].resolve();
  const results = await Promise.all([...lookups, test]);
  assert.deepEqual(results[0], { ok: false, error: 'network' }); assert.equal(results[1].ok, true); assert.equal(results[2].ok, true);
  assert.equal(net.maxInFlight, 2);
});

test('pacing: requests to one provider start at least 200 ms apart, by sleeping; nothing is slept when nothing is needed', async () => {
  const { controller, net, sleeps, clock } = await make({ ids: ['ipdata'] });
  await Promise.all([1, 2, 3, 4].map(n => controller.lookup(ip(n))));
  assert.deepEqual(net.calls.map(call => call.at), [NOW, NOW + 200, NOW + 400, NOW + 600]);
  assert.ok(sleeps.length > 0 && sleeps.every(ms => ms > 0 && ms <= 600));
  const slept = sleeps.length;
  clock.t += 5 * SECOND;
  await controller.lookup(ip(5));
  assert.equal(sleeps.length, slept, 'an idle provider is asked at once');
  assert.equal(net.calls.at(-1).at, NOW + 600 + 5 * SECOND);
});

test('pacing: every provider keeps its own rhythm', async () => {
  const { controller, net, sleeps } = await make({ ids: ['maxmind', 'ipdata'] });
  net.script('maxmind', fail('server'));
  await controller.lookup(ip(1));
  assert.deepEqual(net.calls.map(call => [call.provider, call.at]), [['maxmind', NOW], ['ipdata', NOW]], 'two providers, no waiting');
  assert.deepEqual(sleeps, []);
});

test('pacing: the free ip-api endpoint takes at most 40 requests in any rolling minute', async () => {
  const { controller, net, sleeps } = await make({ ids: ['ipapi'], credentials: container({}) });
  const addresses = Array.from({ length: 95 }, (_, index) => '8.8.' + Math.floor(index / 100) + '.' + (index + 1));
  const results = await Promise.all(addresses.map(address => controller.lookup(address)));
  assert.ok(results.every(result => result.ok)); assert.equal(net.calls.length, 95); assert.ok(net.calls.every(call => call.url.startsWith(FREE + '/')));
  const starts = net.calls.map(call => call.at).sort((a, b) => a - b);
  for (let index = 0; index + 40 < starts.length; index++) assert.ok(starts[index + 40] - starts[index] >= MINUTE, 'window at ' + index + ': ' + (starts[index + 40] - starts[index]));
  assert.equal(starts.slice(0, 40).every(at => at === NOW), true, 'the first forty need no waiting');
  assert.ok(sleeps.includes(MINUTE), 'the forty-first waited for the first to age out');
  assert.ok(starts.at(-1) >= NOW + 2 * MINUTE, 'ninety-five requests need more than two minutes');
});

test('pacing: the paid ip-api endpoint and the other providers have no per-minute cap, only the 200 ms rhythm', async () => {
  const { controller, net } = await make({ ids: ['ipapi'] });
  await Promise.all(Array.from({ length: 45 }, (_, index) => controller.lookup('8.8.0.' + (index + 1))));
  assert.ok(net.calls.every(call => call.url.startsWith(PRO + '/')));
  const starts = net.calls.map(call => call.at);
  assert.equal(starts.at(-1) - starts[0], 44 * 200);
});

test('pacing: X-Rl 0 with X-Ttl makes the next request wait that long; over 90 seconds it pauses the provider instead of sleeping', async () => {
  let h = await make({ ids: ['ipapi'], credentials: container({}) });
  h.net.script('ipapi', { body: {}, headers: { 'x-rl': '0', 'x-ttl': '30' } });
  await h.controller.lookup(ip(1));
  const after = await h.controller.lookup(ip(2));
  assert.equal(after.ok, true); assert.deepEqual(h.sleeps, [30 * SECOND]); assert.equal(h.net.calls[1].at, NOW + 30 * SECOND);
  h = await make({ ids: ['ipapi'], credentials: container({}) });
  h.net.script('ipapi', { body: {}, headers: { 'x-rl': '0', 'x-ttl': '120' } });
  await h.controller.lookup(ip(1));
  assert.deepEqual(await h.controller.lookup(ip(2)), { ok: false, error: 'rate-limited' });
  assert.deepEqual(h.sleeps, [], 'no two-minute sleep'); assert.equal(h.net.calls.length, 1);
  assert.equal(h.state().providers.ipapi.status, 'error'); assert.equal(h.state().providers.ipapi.pausedUntil, NOW + 120 * SECOND);
});

test('noteExitIp: looks up in the background only when everything allows it and nothing is known; it returns nothing and never fails', async () => {
  const asked = async (h, address) => { const before = h.net.calls.length; const returned = h.controller.noteExitIp(address); await settle(); return { returned, count: h.net.calls.length - before }; };
  let h = await make();
  let result = await asked(h, ip(1));
  assert.equal(result.returned, undefined); assert.equal(result.count, 1); assert.ok(h.state().records[ip(1)], 'the answer is in the state');
  assert.equal((await asked(h, ip(1))).count, 0, 'now there is a fresh record');
  for (const [name, options, address] of [
    ['the master switch is off', { patch: { enabled: false } }, ip(2)],
    ['the automatic lookup is off', { patch: { auto: false } }, ip(2)],
    ['no provider is ready', { ids: [] }, ip(2)],
    ['the address is private', {}, '10.1.2.3'],
    ['the address is not an address', {}, 'example.com'],
    ['the controller has not loaded yet', { load: false }, ip(2)],
    ['a fresh record is cached', { cache: cacheOf([cachedRecord(ip(2), NOW - HOUR)]) }, ip(2)],
  ]) {
    h = await make(options);
    assert.equal((await asked(h, address)).count, 0, name);
  }
  h = await make({ cache: cacheOf([cachedRecord(ip(2), NOW - 2 * DAY)]) });
  assert.equal((await asked(h, ip(2))).count, 1, 'an old record does not count as known');
  h = await make();
  const hold = deferred(); h.net.script('ipdata', { hold });
  const first = h.controller.lookup(ip(2));
  await settle();
  assert.equal((await asked(h, ip(2))).count, 0, 'the same address is already being asked'); hold.resolve(); await first;
  h = await make();
  h.net.script('ipdata', fail('not-found'));
  await h.controller.lookup(ip(2));
  assert.equal((await asked(h, ip(2))).count, 0, 'a recent answer of "no data" is not asked again');
  h = await make();
  h.net.script('ipdata', fail('rate-limited', { retryAfterMs: 30 * SECOND }));
  await h.controller.lookup(ip(2));
  assert.equal((await asked(h, ip(3))).count, 0, 'a paused provider is not asked');
  h = await make();
  h.controller.dispose();
  assert.equal((await asked(h, ip(2))).count, 0, 'a disposed controller does nothing');
  h = await make();
  h.net.script('ipdata', { reject: new TypeError('CANARY_NET ' + KEYS.ipdata.apiKey) });
  result = await asked(h, ip(4));
  assert.equal(result.returned, undefined); assert.equal(result.count, 1, 'a failure is quiet: no throw, no unhandled rejection');
  assert.deepEqual(plain(h.state().records), {}); assert.deepEqual(plain(h.state().pending), {});
});

test('noteExitIp: a spelling of an address that is already known is the same address', async () => {
  const h = await make({ cache: cacheOf([cachedRecord('8.8.8.1', NOW - HOUR)]) });
  h.controller.noteExitIp('::ffff:8.8.8.1'); await settle();
  assert.equal(h.net.calls.length, 0);
});

test('testProvider: one request for the test address to that provider only, with the feature off, no cache, no failover', async () => {
  const h = await make({ ids: [], settings: defaultGeoSettings(), credentials: keysFor(['maxmind', 'ipdata']) });
  assert.equal(h.state().enabled, false); assert.deepEqual(h.state().readyProviders, []);
  h.net.script('ipdata', { body: {}, headers: { 'x-rl': '12', 'x-ttl': '30' } });
  const result = await h.controller.testProvider('ipdata');
  assert.equal(result.ok, true); assert.equal(result.record.ip, GEO_TEST_IP); assert.equal(result.record.provider, 'ipdata'); assert.ok(Object.isFrozen(result) && deepFrozen(result.record));
  assert.equal(h.net.calls.length, 1); assert.equal(h.net.calls[0].provider, 'ipdata'); assert.equal(h.net.calls[0].ip, GEO_TEST_IP);
  assert.equal(h.state().cacheCount, 0); assert.deepEqual(plain(h.state().records), {}); assert.equal(h.backing.areas.local.has(GEO_CACHE_KEY), false, 'no cache write');
  assert.deepEqual(plain(h.state().errors), {}); assert.deepEqual(plain(h.state().pending), {});
  assert.deepEqual(plain(h.state().providers.ipdata), { enabled: false, ready: false, reason: 'disabled', status: 'ok', error: null, okAt: NOW, remaining: 12, pausedUntil: null });
  h.net.script('maxmind', fail('unauthorized'));
  assert.deepEqual(await h.controller.testProvider('maxmind'), { ok: false, error: 'unauthorized' });
  assert.deepEqual(h.net.calls.map(call => call.provider), ['ipdata', 'maxmind'], 'no failover to the other keyed provider');
  assert.equal(h.state().providers.maxmind.status, 'error'); assert.equal(h.state().providers.maxmind.error, 'unauthorized');
  assert.equal(h.state().cacheCount, 0);
  assert.deepEqual(await h.controller.lookup(ip(1)), { ok: false, error: 'disabled' }, 'and the switch is still off');
});

test('testProvider: a provider without a key is refused before the network; ip-api needs its acknowledgement or a key', async () => {
  const h = await make({ ids: [], settings: defaultGeoSettings(), credentials: container({}) });
  for (const id of ['maxmind', 'ipgeolocation', 'ipdata']) assert.deepEqual(await h.controller.testProvider(id), { ok: false, error: 'no-key' }, id);
  assert.deepEqual(await h.controller.testProvider('ipapi'), { ok: false, error: 'http-not-allowed' });
  assert.equal(h.net.calls.length, 0);
  await h.controller.setProvider('ipapi', { http: true });
  assert.equal((await h.controller.testProvider('ipapi')).ok, true);
  assert.ok(h.net.calls[0].url.startsWith(FREE + '/') && h.net.calls[0].ip === GEO_TEST_IP, 'the free endpoint');
  await h.controller.saveCredential('ipapi', { apiKey: 'CANARY_IPAPI_PRO_API_KEY' });
  assert.equal((await h.controller.testProvider('ipapi')).ok, true);
  assert.ok(h.net.calls[1].url.startsWith(PRO + '/'), 'with a key: the paid endpoint');
  for (const bad of ['nope', '', null, undefined, 5, {}, '__proto__', 'constructor']) assert.deepEqual(await h.controller.testProvider(bad), { ok: false, error: 'no-provider' });
  assert.equal(h.net.calls.length, 2);
});

test('testProvider: a paused provider is not tested; a locked one is; a record about another address or a junk record is bad-response', async () => {
  let h = await make({ ids: ['ipdata'] });
  h.net.script('ipdata', fail('quota'));
  await h.controller.lookup(ip(1));
  assert.deepEqual(await h.controller.testProvider('ipdata'), { ok: false, error: 'quota' }); assert.equal(h.net.calls.length, 1, 'the pause holds for a key test too');
  h.clock.t += 10 * MINUTE;
  assert.equal((await h.controller.testProvider('ipdata')).ok, true);
  h = await make({ ids: ['ipdata'] });
  h.net.script('ipdata', answer({ junk: true }), answer({ ip: ip(5) }));
  assert.deepEqual(await h.controller.testProvider('ipdata'), { ok: false, error: 'bad-response' });
  assert.deepEqual(await h.controller.testProvider('ipdata'), { ok: false, error: 'bad-response' });
  assert.equal(h.state().providers.ipdata.status, 'error'); assert.equal(h.state().providers.ipdata.error, 'bad-response');
});

test('testProvider: tests of one provider at a time are one request; every code of an answer is reported as it is', async () => {
  const h = await make({ ids: ['ipdata'] });
  const hold = deferred(); h.net.script('ipdata', { hold });
  const first = h.controller.testProvider('ipdata'), second = h.controller.testProvider('ipdata');
  await settle();
  assert.equal(h.net.calls.length, 1); hold.resolve();
  const results = await Promise.all([first, second]);
  assert.equal(results[0], results[1]);
  for (const code of GEO_ERRORS) {
    if (['disabled', 'no-provider', 'no-key', 'http-not-allowed'].includes(code)) continue;
    const g = await make({ ids: ['ipdata', 'maxmind'] });
    g.net.script('ipdata', fail(code));
    assert.deepEqual(await g.controller.testProvider('ipdata'), { ok: false, error: code }, code);
    assert.equal(g.state().providers.ipdata.status, 'error', 'a key test reports every failure on the provider, even "not found"');
    assert.equal(g.net.calls.length, 1, 'no second provider for ' + code);
  }
});

test('setters: each persists through the store and the state follows the write; an unchanged value writes nothing', async () => {
  const h = await make({ ids: [], settings: defaultGeoSettings(), credentials: container({}) });
  const writes = () => h.backing.log.filter(entry => entry.area === 'local' && entry.op === 'set' && entry.keys.includes(GEO_SETTINGS_KEY)).length;
  const check = expected => { assert.deepEqual(plain(h.state().settings), expected); assert.deepEqual(stored(h.backing, 'local', GEO_SETTINGS_KEY), expected); };
  let expected = defaultGeoSettings();
  const pending = h.controller.setEnabled(true);
  assert.equal(h.state().enabled, false, 'the state shows what is stored, not what is asked');
  assert.deepEqual(await pending, { ok: true });
  expected = geoSettingsPatch(expected, { enabled: true }); check(expected); assert.equal(h.state().enabled, true);
  const steps = [
    [() => h.controller.setOption('auto', false), { auto: false }], [() => h.controller.setOption('failover', false), { failover: false }],
    [() => h.controller.setColumns(['geotime', 'geo']), { columns: ['geo', 'geotime'] }],
    [() => h.controller.setProvider('maxmind', { enabled: true, service: 'geoip-insights' }), { providers: { maxmind: { enabled: true, service: 'geoip-insights' } } }],
    [() => h.controller.setProvider('ipgeolocation', { security: true }), { providers: { ipgeolocation: { security: true } } }],
    [() => h.controller.setProvider('ipapi', { http: true, enabled: true }), { providers: { ipapi: { http: true, enabled: true } } }],
    [() => h.controller.setColumns([]), { columns: [] }],
  ];
  for (const [run, patch] of steps) {
    assert.deepEqual(await run(), { ok: true }); expected = geoSettingsPatch(expected, patch); check(expected);
    const count = writes();
    assert.deepEqual(await run(), { ok: true }); assert.equal(writes(), count, 'the same value again is not written');
  }
  const before = h.state();
  assert.deepEqual(await h.controller.setProvider('maxmind', { service: 'enterprise' }), { ok: true }, 'an unknown service is ignored');
  assert.equal(h.state(), before, 'and changes nothing');
  assert.equal(h.state().providers.maxmind.enabled, true); assert.equal(h.state().providers.ipapi.ready, true, 'enabled and acknowledged: ready without a key');
});

test('setters: bad arguments are refused with "invalid" and write nothing', async () => {
  const h = await make();
  const count = () => h.backing.log.filter(entry => entry.op === 'set' || entry.op === 'remove').length;
  const before = count(), snapshot = h.state();
  for (const answerOf of [
    h.controller.setEnabled('yes'), h.controller.setEnabled(1), h.controller.setEnabled(undefined), h.controller.setOption('nope', true), h.controller.setOption('enabled', true), h.controller.setOption('auto', 'yes'),
    h.controller.setOption('__proto__', true), h.controller.setColumns(['nope']), h.controller.setColumns('geo'), h.controller.setColumns(null), h.controller.setColumns(['geo', 5]),
    h.controller.setProvider('nope', { enabled: true }), h.controller.setProvider('__proto__', {}), h.controller.setProvider('ipdata', null), h.controller.setProvider('ipdata', 'x'), h.controller.setProvider(5, {}),
    h.controller.forgetCredential('nope'), h.controller.forgetCredential('__proto__'), h.controller.forgetCredential(undefined),
  ]) assert.deepEqual(await answerOf, { ok: false, error: 'invalid' });
  assert.equal(count(), before); assert.equal(h.state(), snapshot, 'nothing changed, not even the revision');
});

test('setters: calls made together are applied one after another, none is lost', async () => {
  const h = await make({ ids: [], settings: defaultGeoSettings(), credentials: container({}) });
  const results = await Promise.all([h.controller.setEnabled(true), h.controller.setOption('auto', false), h.controller.setColumns(['geonet']), h.controller.setProvider('ipdata', { enabled: true }), h.controller.setOption('failover', false)]);
  assert.ok(results.every(result => result.ok));
  const settings = plain(h.state().settings);
  assert.equal(settings.enabled, true); assert.equal(settings.auto, false); assert.deepEqual(settings.columns, ['geonet']); assert.equal(settings.providers.ipdata.enabled, true); assert.equal(settings.failover, false);
  assert.deepEqual(stored(h.backing, 'local', GEO_SETTINGS_KEY), settings);
});

test('setters: a call before the first load loads first and then applies on top of what was stored', async () => {
  const h = await make({ load: false });
  assert.deepEqual(await h.controller.setOption('auto', false), { ok: true });
  assert.equal(h.state().loaded, true); assert.equal(h.state().enabled, true, 'the stored switch is not reset'); assert.equal(h.state().settings.auto, false);
  assert.equal(stored(h.backing, 'local', GEO_SETTINGS_KEY).enabled, true);
});

test('setters: a storage failure is reported, and the state and the stored value stay as they were', async () => {
  const h = await make();
  const snapshot = h.state(), saved = structuredClone(stored(h.backing, 'local', GEO_SETTINGS_KEY));
  failNext(h.backing, 'local.set');
  const result = await h.controller.setEnabled(false);
  assert.deepEqual(result, { ok: false, error: 'storage-unavailable' }); assert.ok(!JSON.stringify(result).includes('CANARY'));
  assert.equal(h.state(), snapshot); assert.deepEqual(stored(h.backing, 'local', GEO_SETTINGS_KEY), saved);
  assert.deepEqual(await h.controller.setEnabled(false), { ok: true }, 'and it works again when storage does');
});

test('remember: the keys move first and the flag is saved after; the keys follow the flag in both directions', async () => {
  const h = await make({ ids: ['maxmind', 'ipdata'] });
  assert.deepEqual(stored(h.backing, 'session', GEO_CREDENTIALS_KEY), keysFor(['maxmind', 'ipdata']));
  const mark = h.backing.log.length;
  assert.deepEqual(await h.controller.setOption('remember', true), { ok: true });
  const order = h.backing.log.slice(mark).filter(entry => entry.op === 'set' || entry.op === 'remove').map(entry => entry.area + '.' + entry.op + ':' + entry.keys[0]);
  assert.deepEqual(order.slice(0, 3), ['local.set:' + GEO_CREDENTIALS_KEY, 'session.remove:' + GEO_CREDENTIALS_KEY, 'local.set:' + GEO_SETTINGS_KEY], 'new area, then the old one emptied, then the flag');
  assert.deepEqual(stored(h.backing, 'local', GEO_CREDENTIALS_KEY), keysFor(['maxmind', 'ipdata'])); assert.equal(stored(h.backing, 'session', GEO_CREDENTIALS_KEY), undefined);
  assert.equal(h.state().settings.remember, true); assert.deepEqual(h.state().hasCredentials, { maxmind: true, ipgeolocation: false, ipdata: true, ipapi: false }); assert.equal(h.state().ready, true);
  assert.deepEqual(await h.controller.saveCredential('ipgeolocation', { apiKey: 'CANARY_IPGEOLOCATION_API_KEY' }), { ok: true });
  assert.ok(stored(h.backing, 'local', GEO_CREDENTIALS_KEY).items.ipgeolocation, 'a key saved with remember on goes to the disk area'); assert.equal(stored(h.backing, 'session', GEO_CREDENTIALS_KEY), undefined);
  assert.deepEqual(await h.controller.setOption('remember', true), { ok: true }, 'repeating it is harmless');
  assert.deepEqual(await h.controller.setOption('remember', false), { ok: true });
  assert.equal(stored(h.backing, 'local', GEO_CREDENTIALS_KEY), undefined, 'switching it off takes the keys off the disk');
  assert.deepEqual(Object.keys(stored(h.backing, 'session', GEO_CREDENTIALS_KEY).items).sort(), ['ipdata', 'ipgeolocation', 'maxmind']);
  assert.equal(h.state().settings.remember, false);
  assert.equal((await h.controller.lookup(ip(1))).ok, true, 'and lookups work throughout');
});

test('remember: when the keys cannot be moved the flag does not change and the state shows nothing new', async () => {
  const h = await make({ ids: ['maxmind', 'ipdata'] });
  const snapshot = h.state();
  failNext(h.backing, 'local.set');
  assert.deepEqual(await h.controller.setOption('remember', true), { ok: false, error: 'storage-unavailable' });
  assert.equal(h.state(), snapshot); assert.equal(h.state().settings.remember, false);
  assert.equal(stored(h.backing, 'local', GEO_CREDENTIALS_KEY), undefined, 'nothing reached the disk');
  assert.deepEqual(stored(h.backing, 'session', GEO_CREDENTIALS_KEY), keysFor(['maxmind', 'ipdata']), 'the keys are where they were');
  assert.equal(stored(h.backing, 'local', GEO_SETTINGS_KEY).remember, false);
});

test('remember: when the flag cannot be saved after the move, the keys are put back', async () => {
  const h = await make({ ids: ['maxmind', 'ipdata'] });
  const snapshot = h.state();
  h.backing.failKeys = new Set([GEO_SETTINGS_KEY]);
  assert.deepEqual(await h.controller.setOption('remember', true), { ok: false, error: 'storage-unavailable' });
  h.backing.failKeys = null;
  assert.equal(h.state(), snapshot);
  assert.equal(stored(h.backing, 'local', GEO_CREDENTIALS_KEY), undefined, 'no secret left on the disk');
  assert.deepEqual(stored(h.backing, 'session', GEO_CREDENTIALS_KEY), keysFor(['maxmind', 'ipdata']));
  assert.equal(stored(h.backing, 'local', GEO_SETTINGS_KEY).remember, false);
  assert.deepEqual(await h.controller.setOption('remember', true), { ok: true }, 'a later try works');
});

test('setProvider: a changed request option clears that provider status; switching it on or off does not', async () => {
  const h = await make({ ids: ['ipgeolocation', 'ipdata'], patch: { failover: false } });
  h.net.script('ipgeolocation', fail('plan'));
  await h.controller.lookup(ip(1));
  assert.equal(h.state().providers.ipgeolocation.error, 'plan');
  await h.controller.setProvider('ipgeolocation', { enabled: false }); await h.controller.setProvider('ipgeolocation', { enabled: true });
  assert.equal(h.state().providers.ipgeolocation.error, 'plan');
  await h.controller.setProvider('ipgeolocation', { security: true });
  assert.equal(h.state().providers.ipgeolocation.status, 'idle'); assert.equal(h.state().providers.ipgeolocation.error, null);
});

test('saveCredential: a key that does not validate stores nothing and changes nothing', async () => {
  const h = await make({ ids: [], settings: defaultGeoSettings(), credentials: container({}) });
  const snapshot = h.state(), count = () => h.backing.log.filter(entry => entry.op === 'set' || entry.op === 'remove').length, before = count();
  const bad = [
    ['ipdata', { apiKey: 'short' }], ['ipdata', { apiKey: 'has a space in it' }], ['ipdata', { apiKey: 'x'.repeat(300) }], ['ipdata', { apiKey: 12345678 }], ['ipdata', { apiKey: 'CANARY_OK_KEY_12345', extra: 1 }],
    ['ipdata', {}], ['ipdata', null], ['ipdata', 'CANARY_OK_KEY_12345'], ['ipdata', undefined], ['ipdata', { apiKey: 'CANARY_KEY\n_WITH_NEWLINE' }],
    ['maxmind', { accountId: 'abc', licenseKey: 'CANARY_LICENSE_KEY_1' }], ['maxmind', { accountId: '123', licenseKey: 'x' }], ['maxmind', { apiKey: 'CANARY_LICENSE_KEY_1' }], ['maxmind', { accountId: '1234567890123', licenseKey: 'CANARY_LICENSE_KEY_1' }],
    ['nope', { apiKey: 'CANARY_OK_KEY_12345' }], ['__proto__', { apiKey: 'CANARY_OK_KEY_12345' }], [undefined, { apiKey: 'CANARY_OK_KEY_12345' }],
  ];
  for (const [id, input] of bad) assert.deepEqual(await h.controller.saveCredential(id, input), { ok: false, error: 'invalid-key' }, JSON.stringify([id, input]));
  assert.equal(count(), before, 'no storage call at all'); assert.equal(h.state(), snapshot);
});

test('saveCredential: a valid key goes to the area the remember flag names, is reported as a boolean, and clears only that provider status', async () => {
  const h = await make({ ids: ['maxmind', 'ipdata'], patch: { failover: false } });
  h.net.script('maxmind', fail('forbidden'));
  await h.controller.lookup(ip(1));
  assert.equal(h.state().providers.maxmind.error, 'forbidden');
  h.net.script('ipdata', fail('server'));
  await h.controller.testProvider('ipdata'); // a second provider in trouble
  assert.equal(h.state().providers.ipdata.error, 'server');
  assert.deepEqual(await h.controller.saveCredential('ipdata', { apiKey: 'CANARY_IPDATA_API_KEY_B' }), { ok: true });
  assert.equal(h.state().providers.ipdata.status, 'idle'); assert.equal(h.state().providers.maxmind.error, 'forbidden', 'another provider keeps its trouble');
  assert.equal(stored(h.backing, 'session', GEO_CREDENTIALS_KEY).items.ipdata.apiKey, 'CANARY_IPDATA_API_KEY_B'); assert.equal(stored(h.backing, 'local', GEO_CREDENTIALS_KEY), undefined);
  assert.deepEqual(h.state().hasCredentials, { maxmind: true, ipgeolocation: false, ipdata: true, ipapi: false });
  assert.ok(Object.values(h.state().hasCredentials).every(value => value === true || value === false));
  assert.deepEqual(await h.controller.saveCredential('ipgeolocation', { apiKey: ' CANARY_GEO_KEY_PADDED ' }), { ok: true });
  assert.equal(stored(h.backing, 'session', GEO_CREDENTIALS_KEY).items.ipgeolocation.apiKey, 'CANARY_GEO_KEY_PADDED', 'a key is stored trimmed');
  await h.controller.setOption('remember', true);
  await h.controller.saveCredential('ipapi', { apiKey: 'CANARY_IPAPI_PRO_API_KEY' });
  assert.equal(stored(h.backing, 'local', GEO_CREDENTIALS_KEY).items.ipapi.apiKey, 'CANARY_IPAPI_PRO_API_KEY'); assert.equal(stored(h.backing, 'session', GEO_CREDENTIALS_KEY), undefined);
});

test('saveCredential: a storage failure is reported and nothing changes', async () => {
  const h = await make({ ids: [] });
  const snapshot = h.state();
  failNext(h.backing, 'session.set');
  assert.deepEqual(await h.controller.saveCredential('ipdata', { apiKey: 'CANARY_IPDATA_API_KEY' }), { ok: false, error: 'storage-unavailable' });
  assert.equal(h.state(), snapshot); assert.equal(h.state().hasCredentials.ipdata, false);
  assert.deepEqual(await h.controller.saveCredential('ipdata', { apiKey: 'CANARY_IPDATA_API_KEY' }), { ok: true });
});

test('forgetCredential and forgetAllCredentials remove the keys from storage and from the state', async () => {
  const h = await make({ ids: ['maxmind', 'ipgeolocation', 'ipdata'] });
  assert.deepEqual(await h.controller.forgetCredential('ipdata'), { ok: true });
  assert.deepEqual(Object.keys(stored(h.backing, 'session', GEO_CREDENTIALS_KEY).items).sort(), ['ipgeolocation', 'maxmind']);
  assert.deepEqual(h.state().hasCredentials, { maxmind: true, ipgeolocation: true, ipdata: false, ipapi: false }); assert.deepEqual(h.state().readyProviders, ['maxmind', 'ipgeolocation']);
  assert.equal(h.state().providers.ipdata.reason, 'no-key'); assert.equal(h.state().providers.ipdata.ready, false);
  await settle();
  const writes = () => h.backing.log.filter(entry => entry.op === 'set' || entry.op === 'remove').length, count = writes();
  assert.deepEqual(await h.controller.forgetCredential('ipdata'), { ok: true }, 'forgetting what is not there is fine'); assert.equal(writes(), count, 'and writes nothing');
  assert.deepEqual(await h.controller.forgetAllCredentials(), { ok: true });
  assert.equal(stored(h.backing, 'session', GEO_CREDENTIALS_KEY), undefined); assert.equal(stored(h.backing, 'local', GEO_CREDENTIALS_KEY), undefined);
  assert.deepEqual(h.state().hasCredentials, { maxmind: false, ipgeolocation: false, ipdata: false, ipapi: false }); assert.equal(h.state().ready, false); assert.deepEqual(h.state().readyProviders, []);
  assert.deepEqual(await h.controller.lookup(ip(1)), { ok: false, error: 'no-provider' });
  assert.equal(h.net.calls.length, 0);
  const g = await make({ ids: ['ipdata'], patch: { remember: true } });
  assert.ok(stored(g.backing, 'local', GEO_CREDENTIALS_KEY));
  failNext(g.backing, 'local.remove');
  const snapshot = g.state();
  assert.deepEqual(await g.controller.forgetAllCredentials(), { ok: false, error: 'storage-unavailable' }); assert.equal(g.state(), snapshot);
  assert.deepEqual(await g.controller.forgetAllCredentials(), { ok: true }); assert.equal(stored(g.backing, 'local', GEO_CREDENTIALS_KEY), undefined);
});

test('clearCache empties the records in the state and the stored cache, and forgets remembered errors; a failure changes nothing', async () => {
  const h = await make({ ids: ['ipdata'], cache: cacheOf([cachedRecord(ip(1), NOW - HOUR), cachedRecord(ip(2), NOW - HOUR)]) });
  h.net.script('ipdata', fail('not-found'));
  await h.controller.lookup(ip(3));
  assert.equal(h.state().cacheCount, 2); assert.deepEqual(Object.keys(h.state().errors), [ip(3)]);
  failNext(h.backing, 'local.remove');
  const snapshot = h.state();
  assert.deepEqual(await h.controller.clearCache(), { ok: false, error: 'storage-unavailable' }); assert.equal(h.state(), snapshot);
  assert.deepEqual(await h.controller.clearCache(), { ok: true });
  assert.equal(h.state().cacheCount, 0); assert.deepEqual(plain(h.state().records), {}); assert.deepEqual(plain(h.state().errors), {});
  assert.equal(h.backing.areas.local.has(GEO_CACHE_KEY), false);
  assert.equal((await h.controller.lookup(ip(1))).fromCache, false, 'cleared means asked again');
  assert.equal((await h.controller.lookup(ip(3))).ok, true, 'and the remembered error is gone');
});

test('a request that waited for its turn is checked again before it is sent: a provider that has said stop in the meantime is not asked', async () => {
  const { controller, net } = await make({ ids: ['maxmind', 'ipdata'] });
  const gates = [deferred(), deferred()];
  net.script('maxmind', { hold: gates[0], body: { error: 'rate-limited', retryAfterMs: 5000 } }, { hold: gates[1], body: { error: 'rate-limited', retryAfterMs: 5000 } });
  const jobs = [1, 2, 3, 4].map(n => controller.lookup(ip(n)));
  await settle();
  assert.equal(net.to('maxmind').length, 2, 'two in flight, the other two are waiting for a place');
  gates[0].resolve(); gates[1].resolve();
  const results = await Promise.all(jobs);
  assert.equal(net.to('maxmind').length, 2, 'the lookups that were waiting never reached the provider that had refused');
  assert.ok(results.every(result => result.ok && result.record.provider === 'ipdata'), JSON.stringify(results));
  assert.equal(net.maxInFlight, 2);
});

test('a request that waited for its turn is checked again before it is sent: switched off meanwhile, nothing more is sent and nothing is kept', async () => {
  const { controller, net, state, backing } = await make({ ids: ['ipdata'] });
  const holds = [deferred(), deferred()];
  net.script('ipdata', { hold: holds[0] }, { hold: holds[1] });
  const jobs = [1, 2, 3, 4].map(n => controller.lookup(ip(n)));
  await settle();
  assert.equal(net.calls.length, 2);
  assert.deepEqual(await controller.setEnabled(false), { ok: true });
  holds[0].resolve(); holds[1].resolve();
  const results = await Promise.all(jobs);
  assert.equal(net.calls.length, 2, 'the two that were waiting were not sent');
  assert.ok(results.every(result => result.ok === false && result.error === 'disabled'), JSON.stringify(results));
  assert.equal(state().cacheCount, 0, 'and the two answers that arrived after the switch was turned off are not kept'); assert.equal(backing.areas.local.has(GEO_CACHE_KEY), false);
  assert.deepEqual(plain(state().errors), {}); assert.deepEqual(plain(state().pending), {});
  await controller.setEnabled(true);
  const again = await Promise.all([controller.lookup(ip(1)), controller.lookup(ip(2))]);
  assert.ok(again.every(result => result.ok), 'and nothing was left behind that could block a later lookup');
  await controller.setProvider('ipdata', { enabled: false });
  assert.deepEqual(await controller.lookup(ip(9)), { ok: false, error: 'no-provider' });
});

test('limits that keep the queue bounded: at most 256 addresses at a time; a clock that jumps back or a sleep that does not sleep cannot hold a request for ever', async () => {
  const { controller, net, state } = await make({ ids: ['ipdata'] });
  const holds = [deferred(), deferred()];
  net.script('ipdata', { hold: holds[0] }, { hold: holds[1] });
  const addresses = Array.from({ length: 258 }, (_, index) => '8.8.' + (1 + Math.floor(index / 250)) + '.' + (1 + index % 250));
  const jobs = addresses.map(address => controller.lookup(address));
  await settle();
  assert.equal(Object.keys(state().pending).length, 256);
  const refused = (await Promise.all(jobs.slice(256)));
  assert.deepEqual(refused, [{ ok: false, error: 'rate-limited' }, { ok: false, error: 'rate-limited' }], 'the 257th and 258th are refused at once');
  holds[0].resolve(); holds[1].resolve();
  const done = await Promise.all(jobs.slice(0, 256));
  assert.ok(done.every(result => result.ok)); assert.equal(net.calls.length, 256); assert.equal(net.maxInFlight, 2);
  const time = world(), clockwise = await make({ ids: ['ipdata'], time });
  await clockwise.controller.lookup(ip(1));
  time.clock.t -= 2 * HOUR;
  assert.deepEqual(await clockwise.controller.lookup(ip(2)), { ok: false, error: 'rate-limited' }, 'a turn hours away is not slept');
  assert.deepEqual(time.sleeps, []);
  const stuck = await make({ ids: ['ipdata'], load: false });
  const impatient = createGeoController({ api: fakeApi(stuck.backing), fetchImpl: stuck.net.fetchImpl, now: () => stuck.clock.t, sleep: async () => {}, providers: fakeProviders() });
  await impatient.load();
  assert.equal((await impatient.lookup(ip(1))).ok, true);
  assert.deepEqual(await impatient.lookup(ip(2)), { ok: false, error: 'rate-limited' }, 'a sleep that does not let time pass ends after a few rounds');
  impatient.dispose();
});

test('another page of the same profile is followed: settings, keys, cache; published once; our own writes do not loop', async () => {
  const time = world(), backing = createBacking();
  const a = await make({ ids: ['ipdata'], backing, time });
  const b = await make({ ids: null, backing, time });
  const seenByB = [];
  b.controller.subscribe(() => seenByB.push(b.state().revision));
  assert.equal(b.state().enabled, true);
  assert.deepEqual(await a.controller.setEnabled(false), { ok: true }); await settle();
  assert.equal(b.state().enabled, false, 'settings');
  assert.ok(seenByB.length >= 1);
  await a.controller.setEnabled(true); await settle();
  assert.deepEqual(await a.controller.saveCredential('ipgeolocation', { apiKey: 'CANARY_IPGEOLOCATION_API_KEY' }), { ok: true }); await settle();
  assert.equal(b.state().hasCredentials.ipgeolocation, true, 'keys'); assert.deepEqual(b.state().readyProviders, a.state().readyProviders);
  assert.equal((await a.controller.lookup(ip(1))).ok, true); await settle();
  assert.ok(b.state().records[ip(1)], 'cache'); assert.equal(b.net.calls.length, 0, 'the other page asked nobody');
  assert.equal((await b.controller.lookup(ip(1))).fromCache, true);
  await a.controller.clearCache(); await settle();
  assert.equal(b.state().cacheCount, 0);
  // Quiet: after everything has settled nothing is read or written any more, and the writer's own echo did not publish a state.
  const log = backing.log.length, revisionA = a.state().revision, revisionB = b.state().revision, seen = seenByB.length;
  for (let round = 0; round < 5; round++) await settle();
  assert.equal(backing.log.length, log, 'no loop of reads and writes'); assert.equal(a.state().revision, revisionA); assert.equal(b.state().revision, revisionB); assert.equal(seenByB.length, seen);
  const reads = backing.log.filter(entry => entry.op === 'get').length, notesA = [], notesB = [];
  a.controller.subscribe(() => notesA.push(a.state().revision)); b.controller.subscribe(() => notesB.push(b.state().revision));
  await a.controller.setOption('auto', false); await settle();
  assert.ok(backing.log.filter(entry => entry.op === 'get').length - reads <= 4, 'one write is read back once by each of the two pages');
  assert.equal(notesA.length, 1, 'page a is told once, about its own change; the echo of the write adds nothing');
  assert.equal(notesB.length, 1, 'page b is told once, about the change made elsewhere');
  const echo = a.state().revision;
  for (let round = 0; round < 3; round++) await settle();
  assert.equal(a.state().revision, echo, 'the echo of our own write changes nothing'); assert.equal(notesA.length, 1);
});

test('another page: trouble that belongs to an old key or setup ends when the key or the setup changes elsewhere', async () => {
  const time = world(), backing = createBacking();
  const a = await make({ ids: ['ipgeolocation', 'ipdata'], backing, time });
  const b = await make({ ids: null, backing, time });
  b.net.script('ipgeolocation', fail('unauthorized'));
  await b.controller.lookup(ip(1));
  assert.equal(b.state().providers.ipgeolocation.error, 'unauthorized');
  b.net.script('ipdata', fail('not-found'));
  await b.controller.lookup(ip(2)); await b.controller.lookup(ip(2));
  assert.deepEqual(Object.keys(b.state().errors), [ip(2)], 'remembered on page b');
  await a.controller.saveCredential('ipgeolocation', { apiKey: 'CANARY_IPGEO_NEW_KEY_01' }); await settle();
  assert.equal(b.state().providers.ipgeolocation.status, 'idle', 'the key changed elsewhere: the refusal of the old key is over');
  assert.deepEqual(plain(b.state().errors), {}, 'and so is what was remembered about addresses');
  b.net.script('ipgeolocation', fail('plan'));
  await b.controller.lookup(ip(3));
  assert.equal(b.state().providers.ipgeolocation.error, 'plan');
  await a.controller.setProvider('ipgeolocation', { security: true }); await settle();
  assert.equal(b.state().providers.ipgeolocation.status, 'idle', 'a request option changed elsewhere');
  await a.controller.setOption('remember', true); await settle();
  assert.equal(b.state().settings.remember, true); assert.equal(b.state().hasCredentials.ipdata, true, 'the keys moved: the other page reads them from the new area');
  assert.equal((await b.controller.lookup(ip(4))).ok, true);
});

test('another page moving the keys: a reload caused by storage events never removes a copy, at any step of the move, in either direction', async () => {
  const time = world(), backing = createBacking();
  const b = await make({ ids: ['maxmind', 'ipdata'], backing, time });
  const keys = keysFor(['maxmind', 'ipdata']);
  const wake = () => { for (const listener of [...backing.listeners]) listener({ [GEO_CREDENTIALS_KEY]: { newValue: 1 } }, 'local'); return settle(); };
  const flag = remember => backing.areas.local.set(GEO_SETTINGS_KEY, structuredClone(geoSettingsPatch(stored(backing, 'local', GEO_SETTINGS_KEY), { remember })));
  // Moving to the disk: the disk copy is written, the RAM copy removed, and only then the flag is saved.
  backing.areas.local.set(GEO_CREDENTIALS_KEY, structuredClone(keys));
  await wake();
  assert.deepEqual(stored(backing, 'local', GEO_CREDENTIALS_KEY), keys, 'step 1: the new copy is still there'); assert.deepEqual(stored(backing, 'session', GEO_CREDENTIALS_KEY), keys);
  backing.areas.session.delete(GEO_CREDENTIALS_KEY);
  await wake();
  assert.deepEqual(stored(backing, 'local', GEO_CREDENTIALS_KEY), keys, 'step 2: the only copy is still there');
  flag(true);
  await wake();
  assert.deepEqual(stored(backing, 'local', GEO_CREDENTIALS_KEY), keys); assert.equal(b.state().hasCredentials.maxmind, true, 'step 3: the page has the keys from the new area'); assert.equal(b.state().ready, true);
  // Moving back to RAM.
  backing.areas.session.set(GEO_CREDENTIALS_KEY, structuredClone(keys));
  await wake();
  assert.deepEqual(stored(backing, 'session', GEO_CREDENTIALS_KEY), keys, 'step 1 back: the new copy is still there'); assert.deepEqual(stored(backing, 'local', GEO_CREDENTIALS_KEY), keys);
  flag(false);
  await wake();
  assert.deepEqual(stored(backing, 'session', GEO_CREDENTIALS_KEY), keys, 'step 2 back: nothing removed by a reload'); assert.deepEqual(stored(backing, 'local', GEO_CREDENTIALS_KEY), keys, 'the actor removes the old copy, not a reader');
  assert.equal(b.state().hasCredentials.ipdata, true);
  assert.ok(b.net.calls.length === 0 && backing.log.filter(entry => entry.op === 'remove').length === 0, 'a reader removed nothing');
});

test('dispose: stops following storage, ends queued work without sending it, clears pending, silences subscribers and refuses new work', async () => {
  const h = await make();
  const holds = [deferred(), deferred()];
  h.net.script('ipdata', ...holds.map(hold => ({ hold })));
  const seen = [];
  h.controller.subscribe(() => seen.push(1));
  const jobs = [1, 2, 3, 4, 5].map(n => h.controller.lookup(ip(n)));
  await settle();
  assert.equal(h.net.calls.length, 2); assert.equal(Object.keys(h.state().pending).length, 5);
  const listeners = h.backing.listeners.size;
  h.controller.dispose();
  assert.equal(h.backing.listeners.size, listeners - 1, 'unsubscribed from storage');
  assert.deepEqual(plain(h.controller.getState().pending), {}); assert.ok(deepFrozen(h.controller.getState()));
  const noise = seen.length;
  for (const hold of holds) hold.resolve();
  const results = await Promise.all(jobs); await settle();
  assert.equal(h.net.calls.length, 2, 'the three queued requests were not sent');
  assert.ok(results.every(result => result.ok === false && result.error === 'disabled'), JSON.stringify(results));
  assert.equal(h.state().cacheCount, 0); assert.equal(h.backing.areas.local.has(GEO_CACHE_KEY), false, 'nothing is kept after dispose');
  assert.equal(seen.length, noise, 'no notification after dispose');
  assert.deepEqual(await h.controller.lookup(ip(9)), { ok: false, error: 'disabled' }); assert.deepEqual(await h.controller.lookup('10.0.0.1'), { ok: false, error: 'not-public' });
  assert.deepEqual(await h.controller.setEnabled(false), { ok: false, error: 'disabled' }); assert.deepEqual(await h.controller.saveCredential('ipdata', { apiKey: 'CANARY_IPDATA_API_KEY' }), { ok: false, error: 'disabled' });
  assert.deepEqual(await h.controller.testProvider('ipdata'), { ok: false, error: 'disabled' });
  h.controller.noteExitIp(ip(8)); assert.equal(typeof h.controller.subscribe(() => {}), 'function'); assert.equal((await h.controller.load()).loaded, true);
  const other = createGeoController({ api: fakeApi(h.backing), fetchImpl: network({ t: NOW }).fetchImpl, now: () => NOW, sleep: async () => {}, providers: fakeProviders() });
  await other.load(); await other.setOption('auto', false); await settle();
  assert.equal(h.backing.listeners.size, 1, 'only the other page listens'); assert.equal(other.getState().settings.auto, false);
  assert.equal(h.controller.getState().settings.auto, true, 'a disposed controller does not follow');
  h.controller.dispose(); other.dispose();
  assert.equal(h.backing.listeners.size, 0);
});

test('dispose before anything was asked is harmless, and a controller that was never loaded can be disposed', async () => {
  const h = await make({ load: false });
  h.controller.dispose(); h.controller.dispose();
  assert.equal(h.backing.listeners.size, 0); assert.equal(h.net.calls.length, 0);
  assert.equal((await h.controller.load()).loaded, false);
});

test('keys: a key is only ever in the credentials value of its area, whatever the answer was; never in a state, a result, the cache or any other value', async () => {
  const scan = (h, results, { area, disk }) => {
    const texts = { state: JSON.stringify(h.state()), results: JSON.stringify(results), settings: JSON.stringify(stored(h.backing, 'local', GEO_SETTINGS_KEY) ?? null), cache: JSON.stringify(stored(h.backing, 'local', GEO_CACHE_KEY) ?? null) };
    for (const secret of SECRETS) for (const [name, text] of Object.entries(texts)) assert.ok(!text.includes(secret), name + ' holds ' + secret);
    for (const areaName of ['local', 'session']) for (const [key, value] of h.backing.areas[areaName]) {
      const holds = SECRETS.some(secret => JSON.stringify(value).includes(secret));
      if (key === GEO_CREDENTIALS_KEY) assert.equal(holds, areaName === area, 'the credentials value of ' + areaName);
      else assert.equal(holds, false, 'a secret in ' + areaName + '.' + key);
    }
    for (const entry of h.backing.log) if (entry.op === 'set' && SECRETS.some(secret => entry.json.includes(secret))) {
      assert.deepEqual(entry.keys, [GEO_CREDENTIALS_KEY]); assert.ok(entry.area === 'session' || disk, 'a key was written to the disk without the user asking');
    }
  };
  for (const code of GEO_ERRORS) {
    if (['disabled', 'no-provider', 'no-key', 'http-not-allowed'].includes(code)) continue;
    const h = await make({ ids: ['maxmind', 'ipgeolocation', 'ipdata', 'ipapi'] });
    const echo = { message: SECRETS.join(' ') + ' ' + JSON.stringify(KEYS), detail: KEYS.ipdata.apiKey };
    for (const id of GEO_PROVIDERS) h.net.script(id, fail(code, echo), { reject: new TypeError('Failed to fetch https://example.invalid/?k=' + SECRETS.join(',')) }, { status: 500, body: '<html>' + SECRETS.join(' ') + '</html>' }, { body: 'x'.repeat(GEO_LIMITS.responseBytes + 5) });
    const results = [await h.controller.lookup(ip(1)), await h.controller.lookup(ip(2), { force: true }), await h.controller.testProvider('maxmind'), await h.controller.testProvider('ipdata'), await h.controller.lookup(ip(3), { force: true })];
    h.controller.noteExitIp(ip(4)); await settle();
    scan(h, results, { area: 'session', disk: false });
    await h.controller.setOption('remember', true);
    results.push(await h.controller.lookup(ip(5), { force: true }), await h.controller.testProvider('ipapi'));
    scan(h, results, { area: 'local', disk: true });
    await h.controller.setOption('remember', false);
    scan(h, results, { area: 'session', disk: true });
    assert.equal(stored(h.backing, 'local', GEO_CREDENTIALS_KEY), undefined);
  }
  const h = await make({ ids: ['maxmind', 'ipdata'] });
  const results = [await h.controller.lookup(ip(1)), await h.controller.lookup(ip(1)), await h.controller.testProvider('maxmind')];
  scan(h, results, { area: 'session', disk: false });
  assert.ok(JSON.stringify(stored(h.backing, 'session', GEO_CREDENTIALS_KEY)).includes('CANARY_MAXMIND_LICENSE_KEY'), 'the scan is not vacuous: the key is there');
  assert.ok(h.net.calls.some(call => call.url.includes('CANARY_MAXMIND_LICENSE_KEY')), 'and the request carried it, as the provider requires');
});

test('keys are handed to the client for the one provider asked and to nobody else', async () => {
  const seen = [];
  const client = { async request(input) { seen.push(input); return { ok: true, record: recordFor(input.providerId, input.ip, NOW), quota: null }; } };
  const h = await make({ ids: ['maxmind', 'ipdata'], client });
  await h.controller.lookup(ip(1)); await h.controller.testProvider('ipdata'); h.controller.noteExitIp(ip(2)); await settle();
  assert.equal(seen.length, 3); assert.equal(h.net.calls.length, 0, 'with a client of its own the controller never touches the injected fetch');
  for (const input of seen) assert.deepEqual(Object.keys(input), ['providerId', 'ip', 'credential', 'settings']);
  assert.deepEqual(seen.map(input => input.providerId), ['maxmind', 'ipdata', 'maxmind']);
  assert.deepEqual(seen[0].credential, KEYS.maxmind); assert.deepEqual(seen[1].credential, KEYS.ipdata);
  assert.ok(seen.every(input => Object.isFrozen(input.settings) && !JSON.stringify(input.settings).includes('CANARY')));
  assert.equal(seen[1].ip, GEO_TEST_IP);
});

test('the injected fetch is called only by the real client: one request per successful build, with the hardened options', async () => {
  const h = await make({ ids: ['maxmind', 'ipdata'] });
  let builds = 0;
  const original = h.providers.geoBuildRequest;
  h.providers.geoBuildRequest = (...args) => { const built = original(...args); if (built.ok) builds++; return built; };
  h.net.script('maxmind', fail('server'));
  await h.controller.lookup(ip(1)); await h.controller.lookup(ip(2)); await h.controller.testProvider('maxmind'); await h.controller.lookup(ip(1)); await h.controller.setEnabled(false); await h.controller.lookup(ip(3));
  assert.ok(h.net.calls.length >= 4); assert.equal(h.net.calls.length, builds, 'every fetch has exactly one request built by the providers module for it');
  for (const call of h.net.calls) {
    assert.deepEqual(Object.keys(call.options).sort(), ['cache', 'credentials', 'headers', 'method', 'mode', 'redirect', 'referrerPolicy', 'signal']);
    assert.equal(call.options.credentials, 'omit'); assert.equal(call.options.redirect, 'error'); assert.equal(call.options.method, 'GET');
  }
});

test('the controller and the store hold no network call, no timer of their own, no remote address and no unsafe API (source check)', () => {
  const read = name => readFileSync(new URL('../../apps/production-extension/' + name, import.meta.url), 'utf8');
  for (const [name, source] of [['controller', read('proxy-geo-controller.js')], ['store', read('proxy-geo-store.js')]]) {
    for (const [pattern, why] of [[/\bfetch\b/, 'fetch'], [/XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|RTCPeerConnection|WebTransport/, 'another network API'], [/\bimport\(/, 'dynamic import'],
      [/setInterval/, 'an interval'], [/https?:\/\//, 'a URL'], [/\bstorage\.sync\b|\.sync\b|\bmanaged\b/, 'storage.sync'], [/\beval\b|new Function|innerHTML|document\.|window\./, 'unsafe API'], [/console\./, 'console output'],
      [/localStorage|sessionStorage|indexedDB/, 'another storage']]) assert.ok(!pattern.test(source), name + ' contains ' + why);
  }
  assert.equal((read('proxy-geo-controller.js').match(/setTimeout/g) ?? []).length, 1, 'the only timer is the default sleep');
  assert.equal((read('proxy-geo-store.js').match(/setTimeout/g) ?? []).length, 0);
  assert.ok(/fetchImpl/.test(read('proxy-geo-controller.js')), 'the controller only passes the injected transport on to the client');
});

test('the controller starts no timer of its own: nothing is scheduled by loading, looking up, setting or disposing', async () => {
  const originals = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval }, ours = [];
  // The caller of the timer function is the second frame; the client arms its own deadline timer below the controller, which is its business.
  const spy = name => (...args) => { if (/proxy-geo-(controller|store)\.js/.test(new Error('timer').stack.split('\n')[2] ?? '')) ours.push(name); return originals[name](...args); };
  globalThis.setTimeout = spy('setTimeout'); globalThis.setInterval = spy('setInterval');
  try {
    const h = await make({ ids: ['ipdata', 'maxmind'] });
    await h.controller.lookup(ip(1)); await h.controller.lookup(ip(2)); await h.controller.testProvider('ipdata'); await h.controller.setOption('remember', true); await h.controller.saveCredential('ipapi', { apiKey: 'CANARY_IPAPI_PRO_API_KEY' });
    h.controller.noteExitIp(ip(3)); await settle(); h.controller.dispose();
    assert.ok(h.sleeps.length > 0, 'the injected sleep was used for pacing');
  } finally { globalThis.setTimeout = originals.setTimeout; globalThis.setInterval = originals.setInterval; }
  assert.deepEqual(ours, []);
});

test('the controller uses the store only through its contract, in the right order, with whole normalised values', async () => {
  const log = [];
  const initial = { settings: enabledSettings(['ipdata']), credentials: keysFor(['ipdata']), cache: cacheOf([]) };
  let current = structuredClone(initial);
  const store = {
    async loadAll() { log.push(['loadAll']); return structuredClone(current); },
    async saveSettings(value) { log.push(['saveSettings', structuredClone(value)]); current.settings = structuredClone(value); return { ok: true, value }; },
    async saveCredentials(value) { log.push(['saveCredentials', structuredClone(value)]); current.credentials = structuredClone(value); return { ok: true, value }; },
    async moveCredentials(value) { log.push(['moveCredentials', value]); return { ok: true }; },
    async saveCache(value) { log.push(['saveCache', structuredClone(value)]); current.cache = structuredClone(value); return { ok: true, value }; },
    async clearCache() { log.push(['clearCache']); return { ok: true }; },
    watch(listener) { log.push(['watch']); store.fire = listener; return () => log.push(['unwatch']); },
  };
  const h = await make({ ids: null, store });
  assert.deepEqual(log.map(entry => entry[0]), ['loadAll', 'watch']);
  await h.controller.setOption('remember', true);
  assert.deepEqual(log.slice(2).map(entry => entry[0]), ['moveCredentials', 'saveSettings']); assert.equal(log[2][1], true); assert.equal(log[3][1].remember, true);
  await h.controller.saveCredential('ipgeolocation', { apiKey: 'CANARY_IPGEOLOCATION_API_KEY' });
  const saved = log.filter(entry => entry[0] === 'saveCredentials').at(-1)[1];
  assert.deepEqual(Object.keys(saved), ['version', 'items']); assert.deepEqual(Object.keys(saved.items).sort(), ['ipdata', 'ipgeolocation']);
  await h.controller.lookup(ip(1));
  const cacheSaved = log.filter(entry => entry[0] === 'saveCache').at(-1)[1];
  assert.deepEqual(Object.keys(cacheSaved.items), [ip(1)]); assert.equal(cacheSaved.version, 1);
  await h.controller.clearCache();
  assert.equal(log.at(-1)[0], 'clearCache');
  h.controller.dispose();
  assert.equal(log.at(-1)[0], 'unwatch');
  assert.equal(h.net.calls.length, 1);
});

test('a store that answers badly cannot make the controller accept an unchecked value', async () => {
  const store = {
    async loadAll() { return { settings: { enabled: true, junk: 1 }, credentials: { items: { ipdata: { apiKey: 'x' } } }, cache: 5 }; },
    async saveSettings() { return { ok: true, value: { version: 1, enabled: 'yes' } }; }, async saveCredentials() { return { ok: true, value: 'junk' }; },
    async moveCredentials() { return { ok: true }; }, async saveCache() { return { ok: true }; }, async clearCache() { return { ok: true }; }, watch() { return () => {}; },
  };
  const h = await make({ ids: null, store });
  assert.deepEqual(h.state().settings, defaultGeoSettings()); assert.equal(h.state().cacheCount, 0); assert.equal(h.state().hasCredentials.ipdata, false);
  assert.deepEqual(await h.controller.setEnabled(true), { ok: true });
  assert.deepEqual(h.state().settings, defaultGeoSettings(), 'what the store hands back is read strictly too');
});

test('a client that throws, rejects or answers nonsense is a network or bad-response failure, never an exception or an accepted value', async () => {
  const cases = [
    [() => { throw new Error('CANARY_ERROR ' + KEYS.ipdata.apiKey); }, 'network'], [() => Promise.reject(new Error('CANARY_ERROR')), 'network'], [() => undefined, 'bad-response'], [() => null, 'bad-response'],
    [() => 'ok', 'bad-response'], [() => ({}), 'bad-response'], [() => ({ ok: true }), 'bad-response'], [() => ({ ok: true, record: {} }), 'bad-response'], [() => ({ ok: true, record: { provider: 'ipdata' } }), 'bad-response'],
    [() => ({ ok: false, error: 'weird' }), 'bad-response'], [() => ({ ok: false, error: 'CANARY_ERROR' }), 'bad-response'], [() => ({ ok: false, error: 'not-found', retryAfterMs: 'x', quota: 5 }), 'not-found'],
  ];
  for (const [respond, expected] of cases) {
    const client = { request: async () => respond() };
    const h = await make({ client, patch: { failover: false } });
    const result = await h.controller.lookup(ip(1));
    assert.deepEqual(result, { ok: false, error: expected }); assert.ok(!JSON.stringify([result, h.state()]).includes('CANARY'));
    assert.equal(h.state().cacheCount, 0);
  }
  const h = await make({ ids: ['ipdata'] });
  const broken = createGeoController({ api: fakeApi(h.backing), fetchImpl: h.net.fetchImpl, now: () => NOW, sleep: async () => { throw new Error('no sleeping'); }, providers: fakeProviders() });
  await broken.load();
  assert.equal((await broken.lookup(ip(1))).ok, true, 'the first request needs no sleep');
  assert.deepEqual(await broken.lookup(ip(2)), { ok: false, error: 'network' }, 'a failing sleep is a failed request, not a hang or an exception');
  broken.dispose();
});

test('no method rejects or throws, whatever it is given', async () => {
  const h = await make();
  const junk = [undefined, null, 0, 1, NaN, '', 'x', true, false, {}, [], () => {}, Symbol.iterator.description, { get ok() { throw new Error('getter'); } }, Object.create(null)];
  const outcomes = [];
  for (const value of junk) {
    for (const call of [() => h.controller.lookup(value), () => h.controller.lookup(ip(1), value), () => h.controller.testProvider(value), () => h.controller.setEnabled(value), () => h.controller.setOption(value, value),
      () => h.controller.setColumns(value), () => h.controller.setProvider(value, value), () => h.controller.saveCredential(value, value), () => h.controller.forgetCredential(value), () => h.controller.subscribe(value),
      () => h.controller.noteExitIp(value)]) outcomes.push(await call());
  }
  assert.ok(outcomes.length > 100);
  assert.ok(!JSON.stringify(h.state()).includes('CANARY'));
});

// @@END-OF-TESTS@@
