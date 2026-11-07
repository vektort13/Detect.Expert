// ADR-109: the storage layer of the Proxy Manager Geolocation API against a fake chrome.storage (structured clones, change events, call log,
// failure injection, an overlap detector). No real storage, no timers, no network.
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate as tick } from 'node:timers/promises';
import { createGeoStore } from '../../apps/production-extension/proxy-geo-store.js';
import {
  GEO_SETTINGS_KEY, GEO_CREDENTIALS_KEY, GEO_CACHE_KEY, GEO_LIMITS, defaultGeoSettings, emptyGeoCredentials, emptyGeoCache, geoEmptyFlags, geoSettingsPatch,
} from '../../apps/production-extension/proxy-geo-shared.js';

// A promise that never settles fails its own test after 15 s instead of hanging the whole run.
const test = (name, body) => nodeTest(name, { timeout: 15000 }, body);

const NOW = 1_800_000_000_000, DAY = 24 * 60 * 60 * 1000;
const MM = { accountId: '123456', licenseKey: 'CANARY_MM_LICENSE_0001' }, DATA = { apiKey: 'CANARY_IPDATA_KEY_0002' }, GEOLOC = { apiKey: 'CANARY_GEOLOC_KEY_0003' };
const container = items => ({ version: 1, items });
const BOTH = container({ maxmind: MM, ipdata: DATA });
const settingsOf = remember => geoSettingsPatch(defaultGeoSettings(), { remember });
const record = (ip, at = NOW - 1000) => ({ provider: 'ipdata', service: '', at, ip, country: 'US', countryName: 'United States', region: 'Virginia', city: 'Ashburn',
  timezone: 'America/New_York', asn: 15169, org: 'Google LLC', isp: '', kind: 'hosting', flags: { ...geoEmptyFlags(), hosting: true } });
const cacheOf = records => container(Object.fromEntries(records.map(item => [item.ip, item])));

// ---- The fake chrome.storage ------------------------------------------------------------------------------------------------------
function createBacking() {
  return { areas: { local: new Map(), session: new Map() }, listeners: new Set(), log: [], active: 0, maxActive: 0, failures: new Map(), accessLevels: [] };
}
function fakeApi(backing, { session = true, setAccessLevel = true, onChanged = true } = {}) {
  const guarded = name => async function run(op, detail, action) {
    backing.active++; backing.maxActive = Math.max(backing.maxActive, backing.active);
    try {
      await Promise.resolve(); // a yield inside the operation, so any overlap between two operations is visible
      const left = backing.failures.get(name + '.' + op) ?? 0;
      if (left > 0) { backing.failures.set(name + '.' + op, left - 1); throw new Error('CANARY_STORAGE_ERROR ' + JSON.stringify(detail)); }
      return action();
    } finally { backing.active--; }
  };
  const emit = (name, changes) => { if (Object.keys(changes).length) queueMicrotask(() => { for (const listener of [...backing.listeners]) listener(structuredClone(changes), name); }); };
  const area = name => {
    const map = backing.areas[name], run = guarded(name);
    const api = {
      get: keys => run('get', keys, () => {
        backing.log.push({ area: name, op: 'get', keys });
        const wanted = keys === null || keys === undefined ? [...map.keys()] : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        return Object.fromEntries(wanted.filter(key => map.has(key)).map(key => [key, structuredClone(map.get(key))]));
      }),
      set: items => run('set', Object.keys(items), () => {
        backing.log.push({ area: name, op: 'set', keys: Object.keys(items), json: JSON.stringify(items) });
        const changes = {};
        for (const [key, value] of Object.entries(items)) { changes[key] = { oldValue: map.get(key), newValue: structuredClone(value) }; map.set(key, structuredClone(value)); }
        emit(name, changes);
      }),
      remove: keys => run('remove', keys, () => {
        const list = Array.isArray(keys) ? keys : [keys], changes = {};
        backing.log.push({ area: name, op: 'remove', keys: list });
        for (const key of list) if (map.has(key)) { changes[key] = { oldValue: map.get(key) }; map.delete(key); }
        emit(name, changes);
      }),
    };
    if (name === 'session' && setAccessLevel) api.setAccessLevel = async value => { backing.log.push({ area: 'session', op: 'setAccessLevel', value }); backing.accessLevels.push(value); const left = backing.failures.get('session.setAccessLevel') ?? 0; if (left > 0) { backing.failures.set('session.setAccessLevel', left - 1); throw new Error('CANARY_STORAGE_ERROR level'); } };
    return api;
  };
  const storage = { local: area('local'), ...(session ? { session: area('session') } : {}) };
  if (onChanged) storage.onChanged = { addListener: fn => backing.listeners.add(fn), removeListener: fn => backing.listeners.delete(fn) };
  for (const name of ['sync', 'managed']) Object.defineProperty(storage, name, { get() { throw new Error('storage.' + name + ' must never be touched'); } });
  return { storage };
}
const open = (backing, options, extra = {}) => createGeoStore({ api: fakeApi(backing, options), now: () => NOW, ...extra });
const raw = (backing, name, key = GEO_CREDENTIALS_KEY) => backing.areas[name].get(key);
const writes = (backing, name, key) => backing.log.filter(entry => entry.area === name && entry.op === 'set' && entry.keys.includes(key));
const failNext = (backing, name, count = 1) => backing.failures.set(name, count);
const everything = backing => JSON.stringify([backing.log, [...backing.areas.local], [...backing.areas.session]]);

test('empty storage reads as the defaults and writes nothing', async () => {
  const backing = createBacking();
  const data = await open(backing).loadAll();
  assert.deepEqual(data, { settings: defaultGeoSettings(), credentials: emptyGeoCredentials(), cache: emptyGeoCache() });
  assert.ok(backing.log.every(entry => entry.op === 'get' || entry.op === 'setAccessLevel'), 'a first read changes nothing');
  assert.equal(backing.areas.local.size + backing.areas.session.size, 0);
});

test('everything read goes through the strict readers: junk is dropped, valid parts are kept', async () => {
  const backing = createBacking();
  backing.areas.local.set(GEO_SETTINGS_KEY, { version: 1, enabled: 'yes' });
  backing.areas.local.set(GEO_CACHE_KEY, { version: 2, items: {} });
  backing.areas.session.set(GEO_CREDENTIALS_KEY, { version: 1, items: { maxmind: { accountId: 'abc', licenseKey: MM.licenseKey }, ipdata: DATA, nope: DATA, ipgeolocation: { apiKey: 'short' } } });
  let data = await open(backing).loadAll();
  assert.deepEqual(data.settings, defaultGeoSettings()); assert.deepEqual(data.cache, emptyGeoCache());
  assert.deepEqual(data.credentials, container({ ipdata: DATA }), 'each provider is kept or dropped on its own');
  const backing2 = createBacking();
  backing2.areas.local.set(GEO_SETTINGS_KEY, settingsOf(true));
  backing2.areas.local.set(GEO_CACHE_KEY, cacheOf([record('8.8.8.8'), record('1.1.1.1', NOW - 31 * DAY), { ...record('9.9.9.9'), country: 'usa' }, record('10.0.0.1')]));
  backing2.areas.local.set(GEO_CREDENTIALS_KEY, { version: 1, items: { ipdata: DATA }, extra: 1 });
  data = await open(backing2).loadAll();
  assert.equal(data.settings.remember, true);
  assert.deepEqual(Object.keys(data.cache.items), ['8.8.8.8'], 'a record older than 30 days, a bad record and a private address are not read');
  assert.deepEqual(data.credentials, emptyGeoCredentials(), 'a container with an unknown field is not read at all');
});

test('remember false: the keys live in storage.session only, and storage.local never gets them', async () => {
  const backing = createBacking();
  const store = open(backing);
  assert.deepEqual(await store.saveSettings(defaultGeoSettings()), { ok: true, value: defaultGeoSettings() });
  assert.deepEqual(await store.saveCredentials(BOTH), { ok: true, value: BOTH });
  assert.deepEqual(raw(backing, 'session'), BOTH);
  assert.equal(raw(backing, 'local'), undefined);
  assert.equal(writes(backing, 'local', GEO_CREDENTIALS_KEY).length, 0);
  assert.ok(!JSON.stringify([...backing.areas.local]).includes('CANARY'), 'no secret anywhere in storage.local');
  assert.deepEqual((await store.loadAll()).credentials, BOTH);
  assert.ok(!JSON.stringify(writes(backing, 'local', GEO_SETTINGS_KEY)).includes('CANARY'));
});

test('remember true: the keys live in storage.local only, and the session copy is removed', async () => {
  const backing = createBacking();
  const store = open(backing);
  await store.saveSettings(settingsOf(true));
  backing.areas.session.set(GEO_CREDENTIALS_KEY, container({ ipgeolocation: GEOLOC })); // a stale RAM copy
  assert.deepEqual(await store.saveCredentials(BOTH), { ok: true, value: BOTH });
  assert.deepEqual(raw(backing, 'local'), BOTH);
  assert.equal(raw(backing, 'session'), undefined);
  assert.deepEqual((await store.loadAll()).credentials, BOTH);
});

test('the area follows the persisted choice at write time, even for a store that has not heard of the change', async () => {
  const backing = createBacking();
  const stale = open(backing), other = open(backing);
  await stale.loadAll();
  await other.saveSettings(settingsOf(true));
  await stale.saveCredentials(BOTH);
  assert.deepEqual(raw(backing, 'local'), BOTH); assert.equal(raw(backing, 'session'), undefined);
  await other.saveSettings(settingsOf(false));
  await stale.saveCredentials(container({ ipdata: DATA }));
  assert.deepEqual(raw(backing, 'session'), container({ ipdata: DATA }));
  assert.equal(raw(backing, 'local'), undefined, 'the disk copy is gone as soon as the choice is false');
});

test('without storage.session the keys stay in this store memory, whatever remember says, and nothing reaches the disk', async () => {
  for (const remember of [false, true]) {
    const backing = createBacking();
    const store = open(backing, { session: false });
    await store.saveSettings(settingsOf(remember));
    assert.deepEqual(await store.saveCredentials(BOTH), { ok: true, value: BOTH });
    assert.deepEqual((await store.loadAll()).credentials, BOTH);
    assert.equal(raw(backing, 'local'), undefined, 'remember ' + remember);
    assert.equal(writes(backing, 'local', GEO_CREDENTIALS_KEY).length, 0);
    assert.ok(!everything(backing).includes('CANARY'), 'no secret in any storage call or value');
    assert.deepEqual((await open(backing, { session: false }).loadAll()).credentials, emptyGeoCredentials(), 'another store does not share that memory');
    assert.deepEqual(await store.moveCredentials(remember), { ok: true });
    assert.deepEqual((await store.loadAll()).credentials, BOTH);
  }
  // A leftover on disk from an older run is still removed while remember is false.
  const backing = createBacking();
  backing.areas.local.set(GEO_CREDENTIALS_KEY, BOTH);
  const store = open(backing, { session: false });
  assert.deepEqual((await store.loadAll()).credentials, emptyGeoCredentials());
  assert.equal(raw(backing, 'local'), undefined);
});

test('loadAll uses only the area the choice names; a copy in the other area is not used and is removed', async () => {
  let backing = createBacking();
  backing.areas.local.set(GEO_SETTINGS_KEY, settingsOf(false));
  backing.areas.local.set(GEO_CREDENTIALS_KEY, container({ ipdata: DATA }));       // leftover on disk
  backing.areas.session.set(GEO_CREDENTIALS_KEY, container({ maxmind: MM }));
  let data = await open(backing).loadAll();
  assert.deepEqual(data.credentials, container({ maxmind: MM }), 'the session copy is the one in use');
  assert.equal(raw(backing, 'local'), undefined, 'the disk leftover was removed');
  assert.deepEqual(raw(backing, 'session'), container({ maxmind: MM }));
  backing = createBacking();
  backing.areas.local.set(GEO_SETTINGS_KEY, settingsOf(false));
  backing.areas.local.set(GEO_CREDENTIALS_KEY, container({ ipdata: DATA }));
  data = await open(backing).loadAll();
  assert.deepEqual(data.credentials, emptyGeoCredentials(), 'a leftover alone is not used');
  assert.equal(raw(backing, 'local'), undefined);
  backing = createBacking();
  backing.areas.local.set(GEO_SETTINGS_KEY, settingsOf(true));
  backing.areas.local.set(GEO_CREDENTIALS_KEY, container({ ipdata: DATA }));
  backing.areas.session.set(GEO_CREDENTIALS_KEY, container({ maxmind: MM }));
  data = await open(backing).loadAll();
  assert.deepEqual(data.credentials, container({ ipdata: DATA }));
  assert.equal(raw(backing, 'session'), undefined, 'the RAM leftover was removed');
  // A removal that fails does not fail the load and the leftover is still not used.
  backing = createBacking();
  backing.areas.local.set(GEO_SETTINGS_KEY, settingsOf(false));
  backing.areas.local.set(GEO_CREDENTIALS_KEY, container({ ipdata: DATA }));
  failNext(backing, 'local.remove');
  data = await open(backing).loadAll();
  assert.deepEqual(data.credentials, emptyGeoCredentials());
  assert.deepEqual((await open(backing).loadAll()).credentials, emptyGeoCredentials(), 'and the next load removes it');
  assert.equal(raw(backing, 'local'), undefined);
});

test('a load that is not tidy (a reload caused by another page) never removes a copy; the default load does', async () => {
  const stage = (remember, area) => {
    const backing = createBacking();
    backing.areas.local.set(GEO_SETTINGS_KEY, settingsOf(remember));
    backing.areas.local.set(GEO_CREDENTIALS_KEY, container({ ipdata: DATA }));
    backing.areas.session.set(GEO_CREDENTIALS_KEY, container({ maxmind: MM }));
    return { backing, store: open(backing), area };
  };
  for (const remember of [false, true]) {
    const kept = remember ? 'local' : 'session', stray = remember ? 'session' : 'local';
    let { backing, store } = stage(remember);
    const careful = await store.loadAll({ tidy: false });
    assert.deepEqual(careful.credentials, (remember ? container({ ipdata: DATA }) : container({ maxmind: MM })), 'the copy of the chosen area is the one in use');
    assert.notEqual(raw(backing, stray), undefined, 'remember ' + remember + ': the other copy is untouched');
    assert.ok(backing.log.every(entry => entry.op !== 'remove'), 'no removal at all');
    for (const options of [undefined, {}, { tidy: true }, null]) {
      ({ backing, store } = stage(remember));
      await store.loadAll(options);
      assert.equal(raw(backing, stray), undefined, 'a tidy load removes the other copy: ' + JSON.stringify(options));
      assert.notEqual(raw(backing, kept), undefined);
    }
  }
});

test('saving an empty container leaves no container and no residue in any area', async () => {
  for (const options of [{}, { session: false }]) {
    const backing = createBacking();
    const store = open(backing, options);
    await store.saveCredentials(BOTH);
    backing.areas.local.set(GEO_CREDENTIALS_KEY, BOTH); // even a stray disk copy
    assert.deepEqual(await store.saveCredentials(emptyGeoCredentials()), { ok: true, value: emptyGeoCredentials() });
    assert.equal(raw(backing, 'local'), undefined); assert.equal(raw(backing, 'session'), undefined);
    assert.deepEqual((await store.loadAll()).credentials, emptyGeoCredentials());
    assert.deepEqual(await store.saveCredentials({ junk: true }), { ok: true, value: emptyGeoCredentials() }, 'junk is the empty container');
  }
  const backing = createBacking();
  const store = open(backing);
  await store.saveCredentials(BOTH);
  failNext(backing, 'session.remove');
  assert.deepEqual(await store.saveCredentials(emptyGeoCredentials()), { ok: false, error: 'storage-unavailable' }, 'a removal that failed is reported');
});

test('moving the keys: the new area is written first, the old one is emptied after, both directions, and it can be repeated', async () => {
  const backing = createBacking();
  const store = open(backing);
  await store.saveCredentials(BOTH);
  backing.log.length = 0;
  assert.deepEqual(await store.moveCredentials(true), { ok: true });
  const order = backing.log.filter(entry => entry.op !== 'get' && entry.op !== 'setAccessLevel').map(entry => entry.area + '.' + entry.op);
  assert.deepEqual(order, ['local.set', 'session.remove'], 'write the new place before touching the old one');
  assert.deepEqual(raw(backing, 'local'), BOTH); assert.equal(raw(backing, 'session'), undefined);
  assert.deepEqual(await store.moveCredentials(true), { ok: true }, 'nothing left to move');
  assert.deepEqual(raw(backing, 'local'), BOTH);
  backing.log.length = 0;
  assert.deepEqual(await store.moveCredentials(false), { ok: true });
  assert.deepEqual(backing.log.filter(entry => entry.op !== 'get' && entry.op !== 'setAccessLevel').map(entry => entry.area + '.' + entry.op), ['session.set', 'local.remove']);
  assert.deepEqual(raw(backing, 'session'), BOTH); assert.equal(raw(backing, 'local'), undefined);
  for (const bad of [undefined, null, 'true', 1, {}]) assert.deepEqual(await store.moveCredentials(bad), { ok: false, error: 'storage-unavailable' }, 'only a boolean is a choice');
  assert.deepEqual(raw(backing, 'session'), BOTH);
});

test('moving the keys when there are none, or only junk, is harmless', async () => {
  const backing = createBacking();
  const store = open(backing);
  assert.deepEqual(await store.moveCredentials(true), { ok: true });
  assert.equal(backing.areas.local.size + backing.areas.session.size, 0);
  backing.areas.session.set(GEO_CREDENTIALS_KEY, { junk: 1 });
  assert.deepEqual(await store.moveCredentials(true), { ok: true });
  assert.equal(raw(backing, 'session'), undefined, 'a junk value in the old place is cleaned');
  assert.equal(raw(backing, 'local'), undefined);
});

test('a move that fails leaves the keys where they were and says so, without any platform error text', async () => {
  let backing = createBacking();
  let store = open(backing);
  await store.saveCredentials(BOTH);
  failNext(backing, 'local.set');
  let result = await store.moveCredentials(true);
  assert.deepEqual(result, { ok: false, error: 'storage-unavailable' });
  assert.deepEqual(raw(backing, 'session'), BOTH); assert.equal(raw(backing, 'local'), undefined);
  assert.ok(!JSON.stringify(result).includes('CANARY'));
  failNext(backing, 'session.remove');
  result = await store.moveCredentials(true);
  assert.deepEqual(result, { ok: false, error: 'storage-unavailable' });
  assert.deepEqual(raw(backing, 'session'), BOTH, 'the old copy is still there');
  assert.equal(raw(backing, 'local'), undefined, 'the new copy was taken back: no secret left on disk');
  assert.deepEqual(await store.moveCredentials(true), { ok: true }, 'and it works when storage does');
  backing = createBacking(); store = open(backing);
  await store.saveSettings(settingsOf(true)); await store.saveCredentials(BOTH);
  failNext(backing, 'session.set');
  assert.deepEqual(await store.moveCredentials(false), { ok: false, error: 'storage-unavailable' });
  assert.deepEqual(raw(backing, 'local'), BOTH);
  failNext(backing, 'local.get');
  assert.deepEqual(await store.moveCredentials(false), { ok: false, error: 'storage-unavailable' }, 'a failed read is a failed move');
  assert.deepEqual(raw(backing, 'local'), BOTH);
});

test('all writes of one store run one after another, in call order', async () => {
  const backing = createBacking();
  const store = open(backing);
  const calls = [
    store.saveSettings(settingsOf(false)), store.saveCredentials(container({ ipdata: DATA })), store.loadAll(), store.saveCredentials(BOTH),
    store.saveCache(cacheOf([record('8.8.8.8')])), store.moveCredentials(true), store.saveSettings(settingsOf(true)), store.saveCredentials(container({ maxmind: MM })),
    store.clearCache(), store.loadAll(), store.saveCache(cacheOf([record('1.1.1.1')])),
  ];
  const results = await Promise.all(calls);
  assert.equal(backing.maxActive, 1, 'two storage operations were in flight at once');
  assert.deepEqual(results[2].credentials, container({ ipdata: DATA }), 'a load sees the writes before it, and none after it');
  assert.deepEqual(results[9].credentials, container({ maxmind: MM }));
  assert.deepEqual(raw(backing, 'local'), container({ maxmind: MM }), 'the last write wins');
  assert.deepEqual(Object.keys(raw(backing, 'local', GEO_CACHE_KEY).items), ['1.1.1.1']);
  assert.deepEqual(raw(backing, 'local', GEO_SETTINGS_KEY), settingsOf(true));
});

test('a failed operation does not stop the queue behind it', async () => {
  const backing = createBacking();
  const store = open(backing);
  failNext(backing, 'local.set');
  const [first, second] = await Promise.all([store.saveSettings(settingsOf(true)), store.saveSettings(settingsOf(false))]);
  assert.deepEqual(first, { ok: false, error: 'storage-unavailable' });
  assert.equal(second.ok, true);
  failNext(backing, 'local.get');
  const [loadFailed, loadOk] = await Promise.allSettled([store.loadAll(), store.loadAll()]);
  assert.equal(loadFailed.status, 'rejected'); assert.equal(loadOk.status, 'fulfilled');
});

test('storage.session is made trusted-only before its first use, once; a refusal or a missing method does not matter', async () => {
  let backing = createBacking();
  let store = open(backing);
  await store.saveCredentials(BOTH); await store.loadAll(); await store.moveCredentials(true); await store.moveCredentials(false);
  assert.deepEqual(backing.accessLevels, [{ accessLevel: 'TRUSTED_CONTEXTS' }], 'one call, the trusted level');
  const level = backing.log.findIndex(entry => entry.op === 'setAccessLevel'), firstUse = backing.log.findIndex(entry => entry.area === 'session' && entry.op !== 'setAccessLevel');
  assert.ok(level >= 0 && level < firstUse, 'before the first session read or write');
  assert.ok(backing.log.filter(entry => entry.op === 'setAccessLevel').every(entry => entry.area === 'session'), 'never asked of storage.local');
  backing = createBacking(); failNext(backing, 'session.setAccessLevel', 5); store = open(backing);
  assert.deepEqual(await store.saveCredentials(BOTH), { ok: true, value: BOTH }, 'a browser that refuses the level is still used');
  assert.deepEqual(backing.accessLevels.length, 1, 'and asked once');
  backing = createBacking(); store = open(backing, { setAccessLevel: false });
  assert.deepEqual((await store.saveCredentials(BOTH)).ok, true);
  assert.deepEqual((await store.loadAll()).credentials, BOTH);
  backing = createBacking(); store = open(backing);
  await store.saveSettings(settingsOf(true)); await store.saveCache(emptyGeoCache()); await store.clearCache();
  assert.equal(backing.accessLevels.length, 0, 'a store that has not touched the session has not asked for a level');
});

test('watch: a change of one of the three values in local or session calls the listener without a payload; everything else is ignored', async () => {
  const backing = createBacking();
  const store = open(backing), calls = [];
  const stop = store.watch((...args) => calls.push(args));
  assert.equal(typeof stop, 'function');
  await store.saveSettings(settingsOf(true)); await tick();
  assert.equal(calls.length, 1); assert.deepEqual(calls[0], [], 'no payload');
  await store.saveCredentials(container({ ipdata: DATA })); await tick();   // local (remember true)
  await store.saveCache(cacheOf([record('8.8.8.8')])); await tick();
  assert.equal(calls.length, 3);
  await store.saveSettings(settingsOf(false)); await store.saveCredentials(container({ maxmind: MM })); await tick();   // session
  assert.equal(calls.length, 6);
  const before = calls.length;
  for (const listener of backing.listeners) {
    listener({ 'other-key': { newValue: 1 } }, 'local');
    listener({ [GEO_SETTINGS_KEY]: { newValue: 1 } }, 'sync');
    listener({ [GEO_CREDENTIALS_KEY]: { newValue: 1 } }, 'managed');
    listener({ [GEO_CACHE_KEY]: { newValue: 1 } }, undefined);
    listener(null, 'local'); listener(undefined, 'local'); listener('x', 'local'); listener({}, 'session');
  }
  assert.equal(calls.length, before, 'foreign keys, other areas and malformed events are ignored');
  for (const listener of backing.listeners) { listener({ [GEO_CACHE_KEY]: { newValue: 1 } }, 'session'); }
  assert.equal(calls.length, before + 1, 'any of the three keys in session counts');
  stop();
  assert.equal(backing.listeners.size, 0);
  stop(); // idempotent
  await store.saveSettings(settingsOf(true)); await tick();
  assert.equal(calls.length, before + 1, 'nothing after the unsubscribe');
});

test('watch: several watchers are independent, a throwing listener does not stop the others, and odd arguments are tolerated', async () => {
  const backing = createBacking();
  const store = open(backing), seen = [];
  const stopA = store.watch(() => { throw new Error('CANARY broken view'); });
  const stopB = store.watch(() => seen.push('b'));
  await store.saveCache(cacheOf([record('8.8.8.8')])); await tick();
  assert.deepEqual(seen, ['b']);
  stopA(); await store.saveCache(cacheOf([record('1.1.1.1')])); await tick();
  assert.deepEqual(seen, ['b', 'b']);
  stopB();
  for (const bad of [undefined, null, 'x', 5, {}]) { const stop = store.watch(bad); assert.equal(typeof stop, 'function'); stop(); }
  assert.equal(backing.listeners.size, 0);
  const none = open(createBacking(), { onChanged: false });
  const stop = none.watch(() => {});
  assert.equal(typeof stop, 'function'); stop();
  const bare = createGeoStore({ api: { storage: { local: fakeApi(createBacking()).storage.local } }, now: () => NOW });
  bare.watch(() => {})();
});

test('settings and cache are normalised on the way in and the stored value is what is returned; the cache is bounded; clearing removes it', async () => {
  const backing = createBacking();
  const store = open(backing);
  const odd = await store.saveSettings({ version: 1, enabled: true, junk: true });
  assert.deepEqual(odd, { ok: true, value: defaultGeoSettings() }, 'a settings value that does not validate is stored as the default');
  assert.deepEqual(raw(backing, 'local', GEO_SETTINGS_KEY), defaultGeoSettings());
  const next = geoSettingsPatch(defaultGeoSettings(), { enabled: true, columns: ['geotime', 'geo'] });
  assert.deepEqual((await store.saveSettings(next)).value, next);
  assert.deepEqual(raw(backing, 'local', GEO_SETTINGS_KEY).columns, ['geo', 'geotime'], 'canonical order');
  const many = Array.from({ length: 300 }, (_, index) => record('8.8.' + Math.floor(index / 250) + '.' + (index % 250 + 1), NOW - 1000 - index));
  const saved = await store.saveCache(cacheOf([...many, record('1.1.1.1', NOW - 40 * DAY), record('192.168.1.1')]));
  assert.equal(saved.ok, true);
  assert.equal(Object.keys(saved.value.items).length, GEO_LIMITS.cacheEntries);
  assert.deepEqual(raw(backing, 'local', GEO_CACHE_KEY), saved.value, 'the stored cache is the returned one');
  assert.ok(!('1.1.1.1' in saved.value.items) && !('192.168.1.1' in saved.value.items));
  assert.deepEqual(await store.clearCache(), { ok: true });
  assert.equal(raw(backing, 'local', GEO_CACHE_KEY), undefined);
  assert.deepEqual((await store.saveCache('junk')), { ok: true, value: emptyGeoCache() });
});

test('storage.sync and storage.managed are never touched by any operation', async () => {
  const backing = createBacking();
  const store = open(backing); // the fake throws on any access to those two
  const stop = store.watch(() => {});
  await store.loadAll(); await store.saveSettings(settingsOf(true)); await store.saveCredentials(BOTH); await store.moveCredentials(false); await store.saveCache(emptyGeoCache()); await store.clearCache();
  stop();
  const source = readFileSync(new URL('../../apps/production-extension/proxy-geo-store.js', import.meta.url), 'utf8');
  assert.ok(!/storage\.sync|\.sync\b|\bmanaged\b/.test(source));
  assert.ok(!/fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|setTimeout|setInterval|https?:\/\//.test(source), 'no network, no timer, no URL');
});

test('read failures reject the load; write failures are a plain code; no platform error text or secret leaves the store', async () => {
  const backing = createBacking();
  const store = open(backing);
  await store.saveCredentials(BOTH);
  failNext(backing, 'local.get');
  await assert.rejects(store.loadAll());
  failNext(backing, 'session.get');
  await assert.rejects(store.loadAll(), 'a key area that cannot be read is not silently empty');
  const results = [];
  for (const name of ['local.set', 'session.set']) {
    failNext(backing, name);
    results.push(await store.saveSettings(defaultGeoSettings()), await store.saveCredentials(BOTH), await store.saveCache(emptyGeoCache()));
  }
  failNext(backing, 'local.remove'); results.push(await store.clearCache());
  failNext(backing, 'local.get'); results.push(await store.saveCredentials(BOTH));
  assert.ok(results.some(result => !result.ok));
  for (const result of results) {
    assert.ok(result.ok === true || (result.ok === false && result.error === 'storage-unavailable' && Object.keys(result).length === 2));
    assert.ok(!JSON.stringify(result).includes('CANARY_STORAGE_ERROR'));
  }
  assert.deepEqual((await store.loadAll()).credentials.items.ipdata, DATA, 'and the store works again afterwards');
});

test('credentials never reach storage.local while remember is false, through any sequence of operations', async () => {
  // A seeded random walk over the store API as the controller drives it: keys saved, the choice flipped (keys move first, then the flag
  // is saved), loads, cache writes. After every step that settles the choice, the credentials key may be in storage.local only if the choice is true.
  let seed = 20261106;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const backing = createBacking();
  const store = open(backing);
  let remember = false;
  await store.saveSettings(settingsOf(false));
  const containers = [BOTH, container({ ipdata: DATA }), container({ maxmind: MM }), container({ ipgeolocation: GEOLOC, ipdata: DATA }), emptyGeoCredentials()];
  for (let step = 0; step < 300; step++) {
    const pick = Math.floor(random() * 6), mark = backing.log.length;
    let diskAllowed = remember;   // may this step write the credentials key to storage.local?
    if (pick === 0 || pick === 1) await store.saveCredentials(containers[Math.floor(random() * containers.length)]);
    else if (pick === 2) { const next = !remember; diskAllowed = next; await store.moveCredentials(next); await store.saveSettings(settingsOf(next)); remember = next; }
    else if (pick === 3) await store.loadAll();
    else if (pick === 4) await store.saveCache(cacheOf([record('8.8.4.' + (1 + Math.floor(random() * 200)))]));
    else await store.saveSettings(settingsOf(remember));
    if (!diskAllowed) assert.equal(backing.log.slice(mark).filter(entry => entry.area === 'local' && entry.op === 'set' && entry.keys.includes(GEO_CREDENTIALS_KEY)).length, 0, 'step ' + step + ': a key was written to disk while remember is false');
    if (!remember) {
      assert.equal(raw(backing, 'local'), undefined, 'step ' + step + ': a key on disk while remember is false');
      assert.equal(JSON.stringify(raw(backing, 'local', GEO_SETTINGS_KEY)).includes('CANARY'), false);
    } else assert.equal(raw(backing, 'session'), undefined, 'step ' + step + ': a RAM copy next to the disk copy');
    const stored = raw(backing, remember ? 'local' : 'session');
    if (stored !== undefined) assert.ok(Object.keys(stored.items).length > 0, 'an empty container is never kept');
  }
  const localCredentialWrites = writes(backing, 'local', GEO_CREDENTIALS_KEY);
  assert.ok(localCredentialWrites.length > 0 && backing.log.some(entry => entry.area === 'session' && entry.op === 'set'), 'the walk used both areas');
  assert.ok(!JSON.stringify([...backing.areas.local]).includes('CANARY') || remember, 'the disk holds secrets only if the last choice is true');
});

test('no secret appears in any value of storage.local while remember is false (settings, cache, log of local writes)', async () => {
  const backing = createBacking();
  const store = open(backing);
  await store.saveSettings(settingsOf(false));
  await store.saveCredentials(BOTH);
  await store.saveCache(cacheOf([record('8.8.8.8')]));
  await store.loadAll();
  const localText = JSON.stringify([...backing.areas.local]) + JSON.stringify(backing.log.filter(entry => entry.area === 'local'));
  for (const secret of [MM.licenseKey, DATA.apiKey]) assert.ok(!localText.includes(secret), secret);
  assert.ok(JSON.stringify([...backing.areas.session]).includes(DATA.apiKey), 'they are in the session area, where they belong');
});
