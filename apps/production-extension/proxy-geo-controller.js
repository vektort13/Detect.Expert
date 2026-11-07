// ADR-109 (owner order, 2026-11-06): the state and the rules of the Proxy Manager Geolocation API for every page that shows it. It owns the
// settings, the keys, the result cache and what each provider answered last; it asks providers one address at a time through the client
// (its only way out), under four limits: the master switch, two requests at once for the whole feature, a pause between requests per
// provider, and at most three providers per address. Nothing runs on a schedule and nothing is sent unless a caller asks (a button, or the
// automatic lookup after a manual proxy check, which the user can turn off). A key lives only in the closure and in the credentials
// container; it is never part of the state, a record, an error, the cache or a result.
//
// GeoState (frozen, a new object per change): { loaded, revision, settings, enabled, ready, readyProviders, hasCredentials, providers,
//   records, pending, errors, cacheCount } as in docs/coverage/proxy-geolocation.md. records / pending / errors have no prototype.
// Setters answer { ok:true } or { ok:false, error } where error is 'invalid', 'invalid-key', 'storage-unavailable' or 'disabled' (disposed).
import {
  GEO_PROVIDERS, GEO_COLUMNS, GEO_ERRORS, GEO_FAILOVER_ERRORS, GEO_TRANSIENT_ERRORS, GEO_LIMITS, GEO_TEST_IP,
  defaultGeoSettings, normalizeGeoSettings, geoSettingsPatch, emptyGeoCredentials, normalizeGeoCredentials, geoCleanCredential, geoProviderState, geoReadyProviders,
  emptyGeoCache, normalizeGeoCache, geoCachePut, geoCacheLookup, normalizeGeoRecord, geoCanonicalIp, geoIsPublicIp,
} from './proxy-geo-shared.js';
import { createGeoStore } from './proxy-geo-store.js';
import { createGeoClient } from './proxy-geo-client.js';

const ATTEMPTS = 3, PENDING_MAX = 256, ROUNDS = 16;
const FREE_PER_WINDOW = 40, FREE_WINDOW_MS = 60000, GAP_MS = 200; // ip-api free: 45 a minute by its docs, 40 here
const QUEUE_MAX_MS = 600000, HOLD_MAX_MS = 90000; // the longest turn a request waits for, and the longest hold from a provider that is slept through
const PAUSE_MS = Object.freeze({ 'rate-limited': 60000, quota: 600000 }), PAUSE_MAX_MS = 3600000;
const LOCAL_ERRORS = Object.freeze(['disabled', 'no-provider', 'no-key', 'http-not-allowed']); // about this browser's setup: never remembered
const ADDRESS_ERRORS = Object.freeze(['not-found', 'not-public']); // about the address, not about the provider's health
const OPTIONS = Object.freeze(['auto', 'failover', 'remember']);
const ok = Object.freeze({ ok: true });
const fail = error => Object.freeze({ ok: false, error });
const failed = (error, retryAfterMs = null) => ({ ok: false, error, retryAfterMs, quota: null });
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const idle = () => ({ status: 'idle', error: null, okAt: null, remaining: null, pausedUntil: null, pauseCode: null, locked: false });
const amount = value => (Number.isFinite(value) && value >= 0 ? value : null);
const quotaOf = value => (value !== null && typeof value === 'object' ? { remaining: amount(value.remaining), pausedMs: amount(value.pausedMs) } : null);
function freezeDeep(value) { // children first, so a frozen parent always has frozen children
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) freezeDeep(value[key]);
  return Object.freeze(value);
}
const dictionary = entries => { const out = Object.create(null); for (const [key, value] of entries) out[key] = freezeDeep(value); return Object.freeze(out); };

export function createGeoController({
  api = globalThis.chrome, fetchImpl, now = Date.now, sleep = ms => new Promise(resolve => globalThis.setTimeout(resolve, ms)), providers, client, store,
} = {}) {
  const geoStore = store ?? createGeoStore({ api, now }), geoClient = client ?? createGeoClient({ fetchImpl, now, providers });
  let settings = freezeDeep(defaultGeoSettings()), credentials = emptyGeoCredentials(), cache = emptyGeoCache();
  let loaded = false, disposed = false, revision = 0, snapshot = null, loading = null, unwatch = null, notifying = false;
  let queue = Promise.resolve(), staged = [], stageJob = null, reloadJob = null, active = 0;
  const waiting = [], listeners = new Set(), inflight = new Map(), testing = new Map(), remembered = new Map(), buckets = new Map();
  const runtime = Object.fromEntries(GEO_PROVIDERS.map(id => [id, idle()]));

  // ---- State and notifications -----------------------------------------------------------------------------------------------
  function touch() {
    if (disposed) return;
    revision++; snapshot = null;
    if (notifying || listeners.size === 0) return;
    notifying = true; // many changes in one turn are one call
    queueMicrotask(() => { notifying = false; for (const listener of [...listeners]) { try { listener(); } catch { /* a broken view must not stop the others */ } } });
  }
  function build() {
    const at = now(), readyProviders = geoReadyProviders(settings, credentials), hasCredentials = {}, providerStates = {};
    for (const id of GEO_PROVIDERS) {
      const state = geoProviderState(settings, credentials, id), run = runtime[id];
      hasCredentials[id] = state.hasKey === true;
      providerStates[id] = { enabled: state.enabled, ready: state.ready, reason: state.reason, status: run.status, error: run.error, okAt: run.okAt, remaining: run.remaining, pausedUntil: run.pausedUntil !== null && run.pausedUntil > at ? run.pausedUntil : null };
    }
    return freezeDeep({
      loaded, revision, settings, enabled: settings.enabled, ready: settings.enabled && readyProviders.length > 0, readyProviders, hasCredentials, providers: providerStates,
      records: dictionary(Object.entries(cache.items)), pending: dictionary(disposed ? [] : [...inflight.keys()].map(ip => [ip, true])),
      errors: dictionary([...remembered].filter(([, entry]) => at - entry.at >= 0 && at - entry.at < GEO_LIMITS.errorMemoryMs).map(([ip, entry]) => [ip, { code: entry.code, at: entry.at }])),
      cacheCount: Object.keys(cache.items).length,
    });
  }
  const getState = () => (snapshot ??= build());
  function subscribe(listener) {
    if (typeof listener !== 'function' || disposed) return () => {};
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }
  const adoptCache = next => { for (const record of Object.values(next.items)) freezeDeep(record); cache = next; };
  const resetRuntime = id => { runtime[id] = idle(); };

  // ---- Loading and changes made elsewhere ------------------------------------------------------------------------------------
  function adoptLoaded(data) {
    settings = freezeDeep(normalizeGeoSettings(data?.settings)); credentials = normalizeGeoCredentials(data?.credentials); adoptCache(normalizeGeoCache(data?.cache, now()));
  }
  async function readInitial() {
    try {
      const data = await geoStore.loadAll();
      if (!disposed) { adoptLoaded(data); loaded = true; unwatch ??= geoStore.watch(scheduleReload); touch(); }
    } catch { /* stays unloaded; the next load() tries again */ }
    return getState();
  }
  function load() {
    if (loaded || disposed) return Promise.resolve(getState());
    if (loading === null) loading = readInitial().finally(() => { loading = null; });
    return loading;
  }
  const serial = job => { // storage work, one job at a time; a job never rejects
    const run = queue.then(async () => { if (disposed) return fail('disabled'); try { return await job(); } catch { return fail('storage-unavailable'); } });
    queue = run;
    return run;
  };
  const mutate = job => load().then(() => (loaded ? serial(job) : fail('storage-unavailable')));
  const optionsKey = (value, id) => JSON.stringify({ ...value.providers[id], enabled: null });
  function applyExternal(data) { // another page (or our own write coming back) changed storage: take what is there, publish only a difference
    const nextSettings = normalizeGeoSettings(data?.settings), nextCredentials = normalizeGeoCredentials(data?.credentials), nextCache = normalizeGeoCache(data?.cache, now());
    let changed = false, configuration = !sameJson(nextSettings, settings);
    for (const id of GEO_PROVIDERS) if (!sameJson(nextCredentials.items[id], credentials.items[id]) || optionsKey(nextSettings, id) !== optionsKey(settings, id)) { resetRuntime(id); configuration = true; }
    if (!sameJson(nextCredentials, credentials)) configuration = true;
    if (configuration) { settings = freezeDeep(nextSettings); credentials = nextCredentials; remembered.clear(); changed = true; }
    if (!sameJson(nextCache, cache)) { adoptCache(nextCache); changed = true; }
    if (changed) touch();
  }
  function scheduleReload() {
    if (disposed || !loaded) return;
    reloadJob ??= serial(async () => {
      reloadJob = null;
      let data;
      try { data = await geoStore.loadAll({ tidy: false }); } catch { return ok; } // another page may be moving the keys right now
      applyExternal(data);
      return ok;
    });
  }

  // ---- Pacing and concurrency ------------------------------------------------------------------------------------------------
  // A bucket is one rate-limit domain: a provider, or the free ip-api endpoint on its own. `next` is when its next turn is free, `starts` the
  // booked starts of the free endpoint, `until` a hold the provider itself asked for (X-Rl / X-Ttl, Retry-After).
  const bucketOf = name => { let bucket = buckets.get(name); if (!bucket) buckets.set(name, bucket = { next: 0, until: 0, starts: [] }); return bucket; };
  // Every request books its own turn when it joins a bucket's line: the line is first in, first out, and costs one sleep per request.
  function book(name, at) {
    const bucket = bucketOf(name);
    let turn = Math.max(at, bucket.until);
    if (name === 'ipapi-free') { // a rolling minute: the forty-first booked start comes a minute after the first of the forty before it
      bucket.starts = bucket.starts.filter(start => start + FREE_WINDOW_MS > at);
      if (bucket.starts.length >= FREE_PER_WINDOW) turn = Math.max(turn, bucket.starts[bucket.starts.length - FREE_PER_WINDOW] + FREE_WINDOW_MS);
      bucket.starts.push(turn);
    } else {
      turn = Math.max(turn, bucket.next);
      bucket.next = turn + GAP_MS;
    }
    return turn;
  }
  // null when the request may start now; otherwise the outcome that replaces it. A hold longer than HOLD_MAX_MS is not slept through.
  async function pace(name) {
    const bucket = bucketOf(name), turn = book(name, now());
    if (turn - now() > QUEUE_MAX_MS) return failed('rate-limited');
    for (let round = 0; round < ROUNDS; round++) {
      if (disposed) return failed('disabled');
      const at = now(), hold = bucket.until - at, wait = Math.max(turn - at, hold);
      if (hold > HOLD_MAX_MS) return failed('rate-limited', hold);
      if (wait <= 0) return null;
      await sleep(wait);
    }
    return failed('rate-limited');
  }
  function slot() { // a first-in first-out semaphore: GEO_LIMITS.concurrency requests in flight for the whole feature
    const handle = () => { let spent = false; return () => { if (spent) return; spent = true; const next = waiting.shift(); if (next) next(handle()); else active--; }; };
    if (active < GEO_LIMITS.concurrency) { active++; return Promise.resolve(handle()); }
    return new Promise(resolve => waiting.push(resolve));
  }

  // ---- One request to one provider -------------------------------------------------------------------------------------------
  const credentialOf = id => (Object.hasOwn(credentials.items, id) ? credentials.items[id] : null);
  function testBlock(id) { // why a key test cannot be sent now, or null
    if (credentialOf(id) !== null) return null;
    return id === 'ipapi' ? (settings.providers.ipapi.http === true ? null : 'http-not-allowed') : 'no-key';
  }
  function pauseOf(id) {
    const run = runtime[id];
    return run.pausedUntil !== null && run.pausedUntil > now() ? run.pauseCode : null;
  }
  const blockOf = id => (runtime[id].locked ? 'unauthorized' : pauseOf(id));
  function stillAllowed(id, purpose) { // the user may have changed their mind, or the provider has said stop, while the request waited for its turn
    if (disposed) return failed('disabled');
    if (purpose === 'lookup' && !(settings.enabled && geoProviderState(settings, credentials, id).ready)) return failed('disabled');
    const block = purpose === 'lookup' ? blockOf(id) : testBlock(id) ?? pauseOf(id);
    return block === null ? null : failed(block);
  }
  function shape(raw, ip) { // what the client said, as a checked outcome
    if (raw !== null && typeof raw === 'object' && raw.ok === true) {
      const record = normalizeGeoRecord(raw.record, now());
      return record !== null && record.ip === ip ? { ok: true, record: freezeDeep(record), quota: quotaOf(raw.quota) } : failed('bad-response');
    }
    const code = raw !== null && typeof raw === 'object' && GEO_ERRORS.includes(raw.error) ? raw.error : 'bad-response';
    return { ok: false, error: code, retryAfterMs: amount(raw?.retryAfterMs), quota: quotaOf(raw?.quota) };
  }
  async function send(id, ip) {
    let raw = null;
    try { raw = await geoClient.request({ providerId: id, ip, credential: credentialOf(id), settings }); } catch { raw = failed('network'); }
    return { ...shape(raw, ip), sent: true };
  }
  function settle(id, bucket, outcome, purpose) { // what the provider's answer says about the provider
    if (disposed) return;
    const run = runtime[id], at = now(), quota = outcome.quota ?? null, hint = outcome.retryAfterMs ?? quota?.pausedMs ?? null;
    if (quota !== null && quota.remaining !== null) run.remaining = quota.remaining;
    if (hint !== null && hint > 0) { const entry = bucketOf(bucket); entry.until = Math.max(entry.until, at + Math.min(hint, PAUSE_MAX_MS)); }
    if (outcome.ok) Object.assign(run, { status: 'ok', error: null, okAt: at, pausedUntil: null, pauseCode: null, locked: false });
    else if (!LOCAL_ERRORS.includes(outcome.error) && !(purpose === 'lookup' && ADDRESS_ERRORS.includes(outcome.error))) {
      run.status = 'error'; run.error = outcome.error;
      if (outcome.error === 'unauthorized') run.locked = true;
      if (Object.hasOwn(PAUSE_MS, outcome.error)) { run.pausedUntil = at + Math.min(PAUSE_MAX_MS, hint !== null && hint > 0 ? hint : PAUSE_MS[outcome.error]); run.pauseCode = outcome.error; }
    }
    touch();
  }
  async function attempt(id, ip, purpose) {
    const bucket = id === 'ipapi' && credentialOf(id) === null ? 'ipapi-free' : id;
    let outcome = await pace(bucket), report = outcome !== null; // a refusal by the pacing rules is reported: it pauses the provider
    if (outcome === null) {
      const release = await slot();
      try {
        outcome = stillAllowed(id, purpose);
        if (outcome === null) { outcome = await send(id, ip); report = true; }
      } finally { release(); }
    }
    if (report) settle(id, bucket, outcome, purpose);
    return outcome;
  }

  // ---- Lookup ----------------------------------------------------------------------------------------------------------------
  function pickProvider(tried) { // the next ready provider in priority order that is not paused or locked; with failover off, only the first
    if (disposed || !settings.enabled) return { id: null, error: 'disabled' };
    const ready = geoReadyProviders(settings, credentials), pool = settings.failover ? ready : ready.slice(0, 1);
    let skipped = null;
    for (const id of pool) {
      if (tried.has(id)) continue;
      const block = blockOf(id);
      if (block === null) return { id };
      skipped ??= block;
    }
    return { id: null, error: skipped ?? 'no-provider' };
  }
  async function chain(ip) {
    const tried = new Set();
    let last = null;
    for (let n = 0; n < ATTEMPTS; n++) {
      const pick = pickProvider(tried);
      if (pick.id === null) return last ?? { ok: false, error: pick.error, asked: false };
      tried.add(pick.id);
      const outcome = await attempt(pick.id, ip, 'lookup');
      if (outcome.ok) return outcome;
      last = { ok: false, error: outcome.error, asked: outcome.sent === true };
      if (!settings.failover || !GEO_FAILOVER_ERRORS.includes(outcome.error)) return last;
    }
    return last;
  }
  function commit(record) { // results arriving together are one cache write
    staged.push(record);
    stageJob ??= serial(async () => {
      stageJob = null;
      let next = cache;
      for (const item of staged.splice(0)) next = geoCachePut(next, item, now());
      adoptCache(next); touch();
      await geoStore.saveCache(cache); // a failed write keeps the result for this page only
      return ok;
    });
    return stageJob;
  }
  function remember(ip, code) {
    remembered.delete(ip); remembered.set(ip, { code, at: now() });
    if (remembered.size > GEO_LIMITS.cacheEntries) remembered.delete(remembered.keys().next().value);
  }
  function rememberedError(ip) {
    const entry = remembered.get(ip);
    if (!entry) return null;
    const age = now() - entry.at;
    if (age >= 0 && age < GEO_LIMITS.errorMemoryMs) return entry.code;
    remembered.delete(ip);
    return null;
  }
  async function run(ip) { // never rejects
    try {
      const outcome = await chain(ip);
      if (outcome.ok) {
        if (disposed || !settings.enabled) return fail('disabled'); // switched off while the request was out: nothing new is kept
        remembered.delete(ip);
        await commit(outcome.record);
        return Object.freeze({ ok: true, record: Object.hasOwn(cache.items, ip) ? cache.items[ip] : outcome.record, fromCache: false });
      }
      if (outcome.asked && !GEO_TRANSIENT_ERRORS.includes(outcome.error) && !LOCAL_ERRORS.includes(outcome.error)) remember(ip, outcome.error);
      return fail(outcome.error);
    } catch { return fail('network'); }
  }
  async function lookup(ip, options) {
    const canonical = geoCanonicalIp(ip);
    if (canonical === null || !geoIsPublicIp(canonical)) return fail('not-public');
    await load();
    if (disposed || !settings.enabled) return fail('disabled');
    if (geoReadyProviders(settings, credentials).length === 0) return fail('no-provider');
    let force = false;
    try { force = options?.force === true; } catch { /* a hostile options object means no force */ }
    if (!force) {
      if (geoCacheLookup(cache, canonical, now())?.fresh === true) return Object.freeze({ ok: true, record: cache.items[canonical], fromCache: true });
      const known = rememberedError(canonical);
      if (known !== null) return fail(known);
    }
    const running = inflight.get(canonical);
    if (running) return running; // one request per address at a time
    if (inflight.size >= PENDING_MAX) return fail('rate-limited');
    let finish;
    const job = new Promise(resolve => { finish = resolve; });
    inflight.set(canonical, job); touch();
    run(canonical).then(result => { inflight.delete(canonical); touch(); finish(result); });
    return job;
  }
  function noteExitIp(ip) { // the automatic lookup after a manual check: only when everything allows it and nothing is known
    const canonical = geoCanonicalIp(ip);
    if (disposed || !loaded || canonical === null || !geoIsPublicIp(canonical) || !settings.enabled || !settings.auto) return;
    if (geoReadyProviders(settings, credentials).length === 0 || inflight.has(canonical) || rememberedError(canonical) !== null) return;
    if (geoCacheLookup(cache, canonical, now())?.fresh === true) return;
    lookup(canonical).catch(() => {});
  }

  // ---- Key test --------------------------------------------------------------------------------------------------------------
  async function probe(id) {
    try {
      await load();
      if (disposed) return fail('disabled');
      const block = testBlock(id) ?? pauseOf(id);
      if (block !== null) return fail(block);
      const outcome = await attempt(id, GEO_TEST_IP, 'test'); // this provider only, no failover, no cache
      return outcome.ok ? Object.freeze({ ok: true, record: outcome.record }) : fail(outcome.error);
    } catch { return fail('network'); }
  }
  function testProvider(id) {
    if (!GEO_PROVIDERS.includes(id)) return Promise.resolve(fail('no-provider'));
    const running = testing.get(id);
    if (running) return running;
    const job = probe(id).finally(() => { testing.delete(id); });
    testing.set(id, job);
    return job;
  }

  // ---- Settings, keys, cache -------------------------------------------------------------------------------------------------
  const change = patch => mutate(async () => {
    const next = geoSettingsPatch(settings, patch);
    if (sameJson(next, settings)) return ok;
    const moving = next.remember !== settings.remember;
    if (moving && !(await geoStore.moveCredentials(next.remember)).ok) return fail('storage-unavailable'); // the flag changes only after the keys moved
    const saved = await geoStore.saveSettings(next);
    if (!saved.ok) { if (moving) await geoStore.moveCredentials(settings.remember); return fail('storage-unavailable'); }
    const stored = normalizeGeoSettings(saved.value);
    for (const id of GEO_PROVIDERS) if (optionsKey(stored, id) !== optionsKey(settings, id)) resetRuntime(id);
    if (!sameJson([stored.enabled, stored.failover, stored.providers], [settings.enabled, settings.failover, settings.providers])) remembered.clear();
    settings = freezeDeep(stored); touch();
    return ok;
  });
  const invalid = () => Promise.resolve(fail('invalid'));
  const setEnabled = value => (typeof value === 'boolean' ? change({ enabled: value }) : invalid());
  const setOption = (name, value) => (OPTIONS.includes(name) && typeof value === 'boolean' ? change({ [name]: value }) : invalid());
  const columnList = list => { try { return Array.isArray(list) && list.every(column => GEO_COLUMNS.includes(column)); } catch { return false; } };
  const setColumns = list => (columnList(list) ? change({ columns: list }) : invalid());
  const setProvider = (id, patch) => (GEO_PROVIDERS.includes(id) && patch !== null && typeof patch === 'object' ? change({ providers: { [id]: patch } }) : invalid());
  async function replaceCredentials(items, touched) {
    const saved = await geoStore.saveCredentials({ version: 1, items });
    if (!saved.ok) return fail('storage-unavailable');
    credentials = normalizeGeoCredentials(saved.value);
    for (const id of touched) resetRuntime(id);
    remembered.clear(); touch();
    return ok;
  }
  function saveCredential(id, input) {
    const cleaned = geoCleanCredential(id, input);
    return cleaned === null ? Promise.resolve(fail('invalid-key')) : mutate(() => replaceCredentials({ ...credentials.items, [id]: cleaned }, [id]));
  }
  const forgetCredential = id => (GEO_PROVIDERS.includes(id)
    ? mutate(() => (credentialOf(id) === null ? ok : replaceCredentials(Object.fromEntries(Object.entries(credentials.items).filter(([key]) => key !== id)), [id])))
    : invalid());
  const forgetAllCredentials = () => mutate(() => replaceCredentials({}, GEO_PROVIDERS));
  const clearCache = () => mutate(async () => {
    if (!(await geoStore.clearCache()).ok) return fail('storage-unavailable');
    cache = emptyGeoCache(); remembered.clear(); touch();
    return ok;
  });
  function dispose() {
    if (disposed) return;
    disposed = true; snapshot = null;
    try { unwatch?.(); } catch { /* already gone */ }
    unwatch = null; listeners.clear(); inflight.clear(); remembered.clear();
  }

  return Object.freeze({
    load, getState, subscribe, lookup, noteExitIp, testProvider, setEnabled, setOption, setColumns, setProvider,
    saveCredential, forgetCredential, forgetAllCredentials, clearCache, dispose,
  });
}
