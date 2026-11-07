// ADR-076: explicit Cloudflare zone configuration; credentials stay in trusted session memory.
import { readModesCommand } from './precursor-modes-contracts.js';

export const PRECURSOR_MODES_PORT = 'detect-expert-precursor-modes-v1';
export const PRECURSOR_MODES_STORAGE = 'precursor-modes:v1';
export const PRECURSOR_CREDENTIAL_STORAGE = 'precursor-credential:v1';
export const PRECURSOR_TRANSPORT_STORAGE = 'precursor-transport:v1';
export const PRECURSOR_MODES_ALARM = 'detect-expert/precursor-modes/v1';
const API_ORIGIN = 'https://api.cloudflare.com';
const KNOWN_MODES = new Set(['off', 'monitor', 'arm']);
const MAX_BYTES = 65536, MAX_HISTORY = 128, REQUEST_MS = 10000, POLL_MS = 60000, FRESH_MS = 180000, COOLDOWN_MS = 10000;
const ERROR_CODES = new Set(['invalid-input', 'unauthorized', 'consent-required', 'busy', 'disconnected', 'cooldown', 'permission-required', 'notifications-unavailable', 'api-unauthorized', 'api-forbidden', 'api-not-found', 'rate-limited', 'api-unavailable', 'network-error', 'timeout', 'invalid-response', 'response-too-large', 'storage-unavailable', 'session-unavailable', 'clock-changed']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const safeError = error => ERROR_CODES.has(error?.code) ? error.code : 'network-error';
const copy = value => structuredClone(value);
const validHost = value => typeof value === 'string' && value.length <= 253 && value === value.toLowerCase() && value.includes('.') && value.split('.').every(label => /^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$/.test(label));
const validZone = value => record(value) && typeof value.id === 'string' && /^[a-f0-9]{32}$/.test(value.id) && validHost(value.name);
const freshState = () => ({ status: 'disconnected', zone: null, mode: 'unknown', checkedAt: null, lastKnownMode: 'unknown', lastKnownAt: null, errorCode: null, history: [], notifications: false, connected: false });

function ownSettingsSender(api, sender) {
  try {
    const expected = new URL(api.runtime.getURL('precursor-settings.html'));
    const owns = raw => { const value = new URL(raw); return value.protocol === expected.protocol && value.host === expected.host && value.pathname === expected.pathname && !value.username && !value.password && !value.search; };
    return sender?.id === api.runtime.id && owns(sender.url) && (sender.frameId === undefined || sender.frameId === 0) &&
      (!sender.origin || sender.origin === expected.protocol + '//' + expected.host) && (!sender.documentLifecycle || sender.documentLifecycle === 'active') &&
      (sender.tab === undefined || sender.frameId === 0 && (sender.tab.url === undefined || owns(sender.tab.url)));
  } catch { return false; }
}

function readSaved(value) {
  if (!record(value) || value.version !== 1 || !validZone(value.zone) || !KNOWN_MODES.has(value.lastKnownMode) || !integer(value.lastKnownAt) || typeof value.notifications !== 'boolean' || !Array.isArray(value.history) || value.history.length > MAX_HISTORY) return null;
  let previous = 0;
  const history = [];
  for (const entry of value.history) {
    if (!record(entry) || !Number.isSafeInteger(entry.id) || entry.id <= previous || !KNOWN_MODES.has(entry.from) || !KNOWN_MODES.has(entry.to) || entry.from === entry.to || !integer(entry.at)) return null;
    history.push({ id: entry.id, from: entry.from, to: entry.to, at: entry.at }); previous = entry.id;
  }
  return { zone: { id: value.zone.id, name: value.zone.name }, lastKnownMode: value.lastKnownMode, lastKnownAt: value.lastKnownAt, history, notifications: value.notifications, monitoring: value.monitoring === true };
}

function readCredential(value) {
  if (!record(value) || Reflect.ownKeys(value).length !== 3 || !['version', 'zoneId', 'token'].every(key => { const field = Object.getOwnPropertyDescriptor(value, key); return field?.enumerable && own(field, 'value'); })) return null;
  if (value.version !== 1 || typeof value.zoneId !== 'string' || !/^[a-f0-9]{32}$/.test(value.zoneId) || typeof value.token !== 'string' || !/^[\x21-\x7e]{1,2048}$/.test(value.token)) return null;
  return { version: 1, zoneId: value.zoneId, token: value.token };
}

function readTransport(value) {
  if (value === undefined) return { lastAttempt: null, retryAt: 0, failures: 0, resetBaseline: false };
  const keys = ['version', 'lastAttempt', 'retryAt', 'failures', ...(own(value ?? {}, 'resetBaseline') ? ['resetBaseline'] : [])];
  if (!record(value) || Reflect.ownKeys(value).length !== keys.length || !keys.every(key => { const field = Object.getOwnPropertyDescriptor(value, key); return field?.enumerable && own(field, 'value'); }) || value.version !== 1 || !(value.lastAttempt === null || integer(value.lastAttempt)) || !integer(value.retryAt) || !Number.isSafeInteger(value.failures) || value.failures < 0 || value.failures > 6 || own(value, 'resetBaseline') && typeof value.resetBaseline !== 'boolean') return null;
  if (value.lastAttempt === null && (value.retryAt !== 0 || value.failures !== 0) || value.retryAt !== 0 && (value.retryAt < value.lastAttempt || value.retryAt - value.lastAttempt > 3610000)) return null;
  return { lastAttempt: value.lastAttempt, retryAt: value.retryAt, failures: value.failures, resetBaseline: value.resetBaseline === true };
}

export function installPrecursorModesService(api = globalThis.chrome, { fetchImpl = globalThis.fetch?.bind(globalThis), now = Date.now, env = globalThis, consent = () => false, whenReady = () => Promise.resolve(), storage = api?.storage?.local, onChange = () => {} } = {}) {
  let state = freshState(), token = null, activeZoneId = null, verifiedZone = null, generation = 0, disposed = false, pending = null, activeFetch = null, lastAttempt = null, retryAt = 0, failures = 0, nextHistoryId = 1, writeRevision = 0, writing = Promise.resolve(), notificationEvents = null;
  let vaultAvailable = false, credentialStored = false, monitoring = false, credentialRevision = 0, credentialWriting = Promise.resolve();
  let transportWriting = Promise.resolve(), transportRevision = 0, resetBaseline = false, notificationSequence = 0, notificationNonce = null;
  const issuedNotifications = new Set(), notificationClears = new Map();
  let notificationEnumeration = null;
  try { notificationNonce = globalThis.crypto.randomUUID().replaceAll('-', ''); } catch {}
  const sessionStorage = api?.storage?.session;
  const ports = new Map(), schedule = env.setTimeout?.bind(env) ?? setTimeout, cancel = env.clearTimeout?.bind(env) ?? clearTimeout;
  const clock = () => { const value = now(); return integer(value) ? value : 0; };
  const allowed = () => { try { return consent() === true; } catch { return false; } };
  const current = epoch => !disposed && generation === epoch && token !== null && allowed();
  const contains = async permissions => { try { return await api.permissions.contains(permissions) === true; } catch { return false; } };

  function getState() {
    const output = copy(state); output.connected = token !== null && !disposed && allowed();
    if (!output.connected) { output.mode = 'unknown'; if (output.status === 'ready' || output.status === 'connecting') output.status = 'disconnected'; }
    if (output.status === 'ready') {
      const age = clock() - output.checkedAt;
      if (age < 0 || age > FRESH_MS) { output.status = 'stale'; output.mode = 'unknown'; if (age < 0) output.errorCode = 'clock-changed'; }
    }
    return output;
  }
  function publish() {
    const snapshot = getState();
    try { onChange(snapshot); } catch {}
    for (const port of ports.keys()) { try { port.postMessage({ schemaVersion: 1, type: 'state', state: snapshot }); } catch {} }
  }
  function snapshotForHost(hostname) {
    if (!allowed() || typeof hostname !== 'string' || !state.zone || hostname.toLowerCase() !== state.zone.name) return null;
    return getState();
  }
  function persist(remove = false) {
    const revision = ++writeRevision;
    const value = state.zone && KNOWN_MODES.has(state.lastKnownMode) && integer(state.lastKnownAt) ? { version: 1, zone: copy(state.zone), lastKnownMode: state.lastKnownMode, lastKnownAt: state.lastKnownAt, history: copy(state.history), notifications: state.notifications, monitoring } : null;
    const operation = writing.then(async () => {
      if (revision !== writeRevision) return;
      if (!storage) fail('storage-unavailable');
      try { if (remove || !value) await storage.remove(PRECURSOR_MODES_STORAGE); else await storage.set({ [PRECURSOR_MODES_STORAGE]: value }); }
      catch { fail('storage-unavailable'); }
    });
    writing = operation.catch(() => {});
    return operation;
  }
  function persistCredential(value, epoch = generation) {
    const revision = ++credentialRevision;
    const operation = credentialWriting.then(async () => {
      if (revision !== credentialRevision) return;
      if (value !== null && (!vaultAvailable || !current(epoch))) fail(vaultAvailable ? 'disconnected' : 'session-unavailable');
      try {
        if (value === null) { if (typeof sessionStorage?.remove === 'function') await sessionStorage.remove(PRECURSOR_CREDENTIAL_STORAGE); }
        else await sessionStorage.set({ [PRECURSOR_CREDENTIAL_STORAGE]: value });
      } catch { fail('session-unavailable'); }
    });
    credentialWriting = operation.catch(() => {});
    return operation;
  }
  function persistTransport(remove = false) {
    const revision = ++transportRevision;
    const value = { version: 1, lastAttempt, retryAt: lastAttempt === null ? 0 : Math.max(0, Math.min(retryAt, lastAttempt + 3610000, Number.MAX_SAFE_INTEGER)), failures: lastAttempt === null ? 0 : failures, resetBaseline };
    const operation = transportWriting.then(async () => {
      if (revision !== transportRevision) return;
      try { if (remove) await storage.remove(PRECURSOR_TRANSPORT_STORAGE); else await storage.set({ [PRECURSOR_TRANSPORT_STORAGE]: value }); }
      catch { fail('storage-unavailable'); }
    });
    transportWriting = operation.catch(() => {});
    return operation;
  }
  async function persistRevocation(removeMetadata = false) {
    const results = await Promise.allSettled([persist(removeMetadata), persistCredential(null)]);
    if (results[1].status === 'rejected') fail('session-unavailable');
    if (results[0].status === 'rejected') fail('storage-unavailable');
  }
  async function prepareVault() {
    if (!sessionStorage || !['get', 'set', 'remove'].every(key => typeof sessionStorage[key] === 'function')) fail('session-unavailable');
    let trustedFirefox = false;
    try { trustedFirefox = api.runtime.getURL('').startsWith('moz-extension://'); } catch {}
    if (typeof sessionStorage.getKeys !== 'function' && !trustedFirefox) fail('session-unavailable');
    try {
      // Chrome uses key-only enumeration. Reviewed Firefox compatibility keeps
      // its native value map inside the trusted report-session-reader helper.
      if (typeof sessionStorage.getKeys === 'function') await sessionStorage.getKeys();
      if (typeof sessionStorage.setAccessLevel === 'function') await sessionStorage.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    } catch { fail('session-unavailable'); }
    vaultAvailable = true;
  }
  function stopAlarm() { try { Promise.resolve(api.alarms?.clear(PRECURSOR_MODES_ALARM)).catch(() => {}); } catch {} }
  async function ensureAlarm(epoch) {
    if (!current(epoch)) return;
    try { await api.alarms.create(PRECURSOR_MODES_ALARM, { periodInMinutes: 1 }); } catch { /* Manual refresh remains available. */ }
    if (!current(epoch)) stopAlarm();
  }
  function invalidate(resetThrottle = false) {
    generation++; token = null; activeZoneId = null; verifiedZone = null;
    credentialStored = false; monitoring = false;
    if (resetThrottle) { retryAt = 0; failures = 0; lastAttempt = null; resetBaseline = false; }
    if (activeFetch) { try { activeFetch.controller.abort(); } catch {} }
    stopAlarm();
  }
  function errorState(code) {
    state.mode = 'unknown'; state.status = KNOWN_MODES.has(state.lastKnownMode) ? 'stale' : 'error'; state.errorCode = code;
  }
  function recoverClock(at) {
    if (lastAttempt === null || at >= lastAttempt) return false;
    const delay = Math.max(COOLDOWN_MS, Math.min(3600000, retryAt > 0 ? retryAt - lastAttempt : COOLDOWN_MS));
    lastAttempt = at; retryAt = at + delay; resetBaseline = true; errorState('clock-changed');
    return true;
  }
  function dismissNotification(id) {
    issuedNotifications.delete(id);
    if (typeof api.notifications?.clear !== 'function' || notificationClears.has(id) || notificationClears.size >= MAX_HISTORY) return;
    const job = Promise.resolve().then(() => api.notifications.clear(id)); notificationClears.set(id, job);
    job.then(() => notificationClears.delete(id), () => notificationClears.delete(id));
  }
  function dismissIssuedNotifications() { for (const id of [...issuedNotifications]) dismissNotification(id); }
  const ownNotificationId = id => typeof id === 'string' && /^precursor-mode-(?:[a-f0-9]{32}-)?[1-9][0-9]{0,15}$/.test(id);
  function dismissPreviousNotifications(epoch) {
    if (typeof api.notifications?.getAll !== 'function') return;
    // Repeated Clear clicks share the same physical native enumeration. Only its
    // latest clear epoch may dismiss results; reconnect invalidates that epoch.
    if (notificationEnumeration) { notificationEnumeration.epoch = epoch; return; }
    const job = { epoch, promise: Promise.resolve().then(() => api.notifications.getAll()) }; notificationEnumeration = job;
    job.promise.then(values => {
      if (disposed || job.epoch !== generation || !record(values)) return;
      let admitted = 0;
      for (const id of Object.keys(values).slice(0, 2048)) {
        if (!ownNotificationId(id)) continue;
        dismissNotification(id); if (++admitted >= MAX_HISTORY) break;
      }
    }, () => {}).finally(() => { if (notificationEnumeration === job) notificationEnumeration = null; });
  }
  async function clear() {
    invalidate(true); const epoch = generation; state = freshState(); nextHistoryId = 1; dismissIssuedNotifications(); dismissPreviousNotifications(epoch); publish();
    try { await Promise.all([persistRevocation(true), persistTransport(true)]); return true; } catch (error) { if (epoch === generation && !disposed) { state.errorCode = safeError(error); publish(); } return false; }
  }
  async function readJson(response, job) {
    if (job.expired) fail('timeout');
    const mime = response.headers?.get?.('content-type');
    if (typeof mime !== 'string' || !/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|\s*$)/i.test(mime)) fail('invalid-response');
    const length = response.headers?.get?.('content-length');
    if (typeof length === 'string' && /^\d+$/.test(length) && Number(length) > MAX_BYTES) fail('response-too-large');
    if (!response.body || typeof response.body.getReader !== 'function') fail('invalid-response');
    const reader = response.body.getReader(), bytes = new Uint8Array(MAX_BYTES); let total = 0, reads = 0;
    try {
      while (true) {
        if (++reads > 8192) fail('response-too-large');
        const item = await reader.read();
        if (job.expired) fail('timeout');
        if (item.done) break;
        if (!(item.value instanceof Uint8Array)) fail('invalid-response');
        if (item.value.byteLength === 0) continue;
        if (total + item.value.byteLength > MAX_BYTES) fail('response-too-large');
        bytes.set(item.value, total); total += item.value.byteLength;
      }
    } catch (error) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} throw error; }
    finally { try { reader.releaseLock(); } catch {} }
    let json;
    try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total))); } catch { fail('invalid-response'); }
    if (!record(json) || json.success !== true || !record(json.result)) fail('invalid-response');
    return json.result;
  }
  async function request(path, epoch) {
    if (!current(epoch)) fail('disconnected');
    if (activeFetch) fail('busy');
    if (typeof fetchImpl !== 'function') fail('network-error');
    const controller = new AbortController(), job = { controller, expired: false, timer: null };
    activeFetch = job;
    const work = Promise.resolve().then(async () => {
      if (!current(epoch)) fail('disconnected');
      const response = await fetchImpl(API_ORIGIN + path, { method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal, headers: { Accept: 'application/json', Authorization: 'Bearer ' + token, 'Cloudflare-Version': '1.0' } });
      if (!current(epoch)) fail('disconnected');
      if (job.expired) fail('timeout');
      if (response.status !== 200) {
        try { Promise.resolve(response.body?.cancel?.()).catch(() => {}); } catch {}
        if (response.status === 429) {
          const header = response.headers?.get?.('retry-after');
          let delay = typeof header === 'string' && /^\d{1,8}$/.test(header.trim()) ? Number(header.trim()) * 1000 : typeof header === 'string' && header.length <= 128 ? Date.parse(header) - clock() : NaN;
          if (!Number.isFinite(delay) || delay <= 0) delay = POLL_MS;
          retryAt = clock() + Math.max(POLL_MS, Math.min(3600000, delay)); fail('rate-limited');
        }
        fail(({ 401: 'api-unauthorized', 403: 'api-forbidden', 404: 'api-not-found' })[response.status] ?? 'api-unavailable');
      }
      const result = await readJson(response, job);
      if (!current(epoch)) fail('disconnected');
      return result;
    });
    work.then(() => { if (activeFetch === job) activeFetch = null; }, () => { try { controller.abort(); } catch {} if (activeFetch === job) activeFetch = null; });
    const timeout = new Promise((_, reject) => { job.timer = schedule(() => { job.expired = true; try { controller.abort(); } catch {} reject(Object.assign(new Error('timeout'), { code: 'timeout' })); }, REQUEST_MS); });
    try { return await Promise.race([work, timeout]); }
    finally { cancel(job.timer); }
  }
  async function notifyTransition(entry, epoch) {
    if (!current(epoch) || !state.notifications || !await contains({ permissions: ['notifications'] }) || !current(epoch) || !state.notifications || !state.history.some(value => value.id === entry.id && value.at === entry.at && value.to === entry.to)) return;
    if (typeof api.notifications?.create !== 'function' || !/^[a-f0-9]{32}$/.test(notificationNonce ?? '') || notificationSequence >= Number.MAX_SAFE_INTEGER) return;
    bindNotificationEvents();
    const label = mode => ({ off: 'Off', monitor: 'Monitor', arm: 'Armed' })[mode];
    const title = api.i18n?.getMessage?.('precursor_modes_notification_title') || 'Precursor';
    const message = api.i18n?.getMessage?.('precursor_modes_notification_body', [state.zone.name, label(entry.from), label(entry.to)]) || state.zone.name + ': ' + label(entry.from) + ' → ' + label(entry.to);
    const id = 'precursor-mode-' + notificationNonce + '-' + ++notificationSequence;
    if (issuedNotifications.size >= MAX_HISTORY) dismissNotification(issuedNotifications.values().next().value);
    issuedNotifications.add(id);
    try {
      await api.notifications.create(id, { type: 'basic', iconUrl: api.runtime.getURL('icons/128.png'), title, message });
      if (!current(epoch) || !state.notifications) dismissNotification(id);
    } catch { issuedNotifications.delete(id); /* The durable in-app history remains available. */ }
  }
  async function poll(epoch) {
    if (!current(epoch)) fail('disconnected');
    if (!await contains({ origins: ['https://api.cloudflare.com/*'] })) fail('permission-required');
    if (!current(epoch)) fail('disconnected');
    if (!verifiedZone) {
      const rawZone = await request('/client/v4/zones/' + activeZoneId, epoch);
      if (!current(epoch)) fail('disconnected');
      const zone = { id: rawZone.id, name: rawZone.name };
      if (!validZone(zone) || zone.id !== activeZoneId) fail('invalid-response');
      verifiedZone = zone;
      if (!state.zone || state.zone.id !== zone.id || state.zone.name !== zone.name) {
        dismissIssuedNotifications();
        state.zone = copy(zone); state.checkedAt = null; state.lastKnownMode = 'unknown'; state.lastKnownAt = null; state.history = []; nextHistoryId = 1;
      }
    }
    const raw = await request('/client/v4/zones/' + activeZoneId + '/precursor', epoch);
    if (!own(raw, 'mode') || !KNOWN_MODES.has(raw.mode)) fail('invalid-response');
    if (!current(epoch)) fail('disconnected');
    const at = clock();
    // A fresh authenticated value is valid despite a wall-clock discontinuity.
    // Re-establish the baseline without inventing a transition across that gap.
    const clockChanged = resetBaseline || state.lastKnownAt !== null && at < state.lastKnownAt || lastAttempt !== null && at < lastAttempt;
    if (clockChanged) { resetBaseline = true; if (lastAttempt !== null && lastAttempt > at) lastAttempt = at; }
    const previous = state.lastKnownMode;
    let entry = null;
    if (!clockChanged && KNOWN_MODES.has(previous) && previous !== raw.mode) {
      if (!Number.isSafeInteger(nextHistoryId) || nextHistoryId >= Number.MAX_SAFE_INTEGER) fail('storage-unavailable');
      entry = { id: nextHistoryId++, from: previous, to: raw.mode, at };
      state.history = [...state.history, entry].slice(-MAX_HISTORY);
    }
    state.zone = copy(verifiedZone); state.lastKnownMode = raw.mode; state.lastKnownAt = at; state.mode = raw.mode; state.checkedAt = at; state.status = 'ready'; state.errorCode = null;
    failures = 0; retryAt = 0;
    if (!credentialStored) {
      await persistCredential({ version: 1, zoneId: activeZoneId, token }, epoch);
      if (!current(epoch)) fail('disconnected');
      credentialStored = true;
    }
    monitoring = true;
    await persist();
    if (!current(epoch)) fail('disconnected');
    resetBaseline = false;
    await persistTransport();
    if (!current(epoch)) fail('disconnected');
    publish();
    if (entry) await notifyTransition(entry, epoch);
    return getState();
  }
  async function refresh({ automatic = false } = {}) {
    if (!allowed()) { await clear(); fail('consent-required'); }
    if (!token || disposed) fail('disconnected');
    if (pending || activeFetch) fail('busy');
    const at = clock();
    if (recoverClock(at)) { await persistTransport(); publish(); await ensureAlarm(generation); fail('clock-changed'); }
    if (retryAt > at || lastAttempt !== null && at - lastAttempt < COOLDOWN_MS) fail('cooldown');
    lastAttempt = at; const epoch = generation;
    const operation = persistTransport().then(() => poll(epoch)).catch(async error => {
      if (!current(epoch)) throw error;
      const code = safeError(error); errorState(code); lastAttempt = clock();
      if (['api-unauthorized', 'api-forbidden', 'permission-required', 'session-unavailable'].includes(code)) {
        invalidate();
        try { await persistRevocation(); } catch (cleanupError) { errorState(safeError(cleanupError)); }
      }
      else { failures = Math.min(6, failures + 1); retryAt = Math.max(retryAt, clock() + Math.min(3600000, POLL_MS * 2 ** (failures - 1))); }
      try { await persistTransport(); } catch { errorState('storage-unavailable'); }
      publish();
      throw Object.assign(new Error(code), { code });
    });
    pending = operation;
    try { return await operation; }
    finally { if (pending === operation) pending = null; if (!automatic && current(epoch)) await ensureAlarm(epoch); }
  }
  async function command(action, payload = {}) {
    await ready;
    if (disposed) fail('disconnected');
    if (action === 'read') return getState();
    if (action === 'disconnect') {
      invalidate(); const epoch = generation; state.status = 'disconnected'; state.mode = 'unknown'; state.errorCode = null; publish();
      try { await persistRevocation(); } catch (error) { if (epoch === generation) { errorState(safeError(error)); publish(); } throw error; }
      return getState();
    }
    if (!allowed()) { await clear(); fail('consent-required'); }
    if (action === 'connect') {
      if (typeof payload.zoneId !== 'string' || !/^[a-fA-F0-9]{32}$/.test(payload.zoneId) || typeof payload.token !== 'string' || payload.token.length < 1 || payload.token.length > 2048 || /[^\x21-\x7e]/.test(payload.token)) fail('invalid-input');
      if (!vaultAvailable) fail('session-unavailable');
      if (pending || activeFetch) fail('busy');
      const at = clock();
      if (recoverClock(at)) { await persistTransport(); publish(); if (token !== null) await ensureAlarm(generation); fail('clock-changed'); }
      if (retryAt > at || lastAttempt !== null && at - lastAttempt < COOLDOWN_MS) fail('cooldown');
      invalidate(); const epoch = generation; await persistRevocation();
      if (disposed || generation !== epoch || !allowed()) fail('disconnected');
      token = payload.token; activeZoneId = payload.zoneId.toLowerCase(); state.status = 'connecting'; state.mode = 'unknown'; state.errorCode = null; publish();
      return refresh();
    }
    if (action === 'refresh') return refresh();
    if (action === 'notifications') {
      if (typeof payload.enabled !== 'boolean') fail('invalid-input');
      const epoch = generation;
      if (payload.enabled && !await contains({ permissions: ['notifications'] })) fail('permission-required');
      if (disposed || epoch !== generation || !allowed()) fail('disconnected');
      if (payload.enabled && typeof api.notifications?.create !== 'function') fail('notifications-unavailable');
      if (payload.enabled) bindNotificationEvents();
      state.notifications = payload.enabled; await persist(); publish(); return getState();
    }
    fail('invalid-input');
  }
  const onPort = port => {
    if (port.name !== PRECURSOR_MODES_PORT) return;
    if (disposed || !ownSettingsSender(api, port.sender) || ports.size >= 8) { try { port.disconnect(); } catch {} return; }
    const requests = new Set(); ports.set(port, requests);
    port.onDisconnect.addListener(() => ports.delete(port));
    port.onMessage.addListener(raw => {
      if (!ports.has(port) || disposed) return;
      const message = readModesCommand(raw);
      if (!message) { try { port.disconnect(); } catch {} return; }
      if (requests.has(message.id) || requests.size >= 2) { try { port.postMessage({ schemaVersion: 1, id: message.id, ok: false, state: getState(), errorCode: 'busy' }); } catch {} return; }
      requests.add(message.id);
      command(message.action, message).then(snapshot => { if (ports.has(port) && !disposed) try { port.postMessage({ schemaVersion: 1, id: message.id, ok: true, state: snapshot, errorCode: null }); } catch {} }, error => { if (ports.has(port) && !disposed) try { port.postMessage({ schemaVersion: 1, id: message.id, ok: false, state: getState(), errorCode: safeError(error) }); } catch {} }).finally(() => requests.delete(message.id));
    });
  };
  const onAlarm = alarm => {
    if (alarm.name !== PRECURSOR_MODES_ALARM || disposed) return;
    if (!token || !allowed()) { if (!allowed()) void clear(); else stopAlarm(); return; }
    void ready.then(() => refresh({ automatic: true })).catch(() => {});
  };
  const onPermissionsRemoved = removed => {
    if (disposed) return;
    if (removed.permissions?.includes('notifications')) { state.notifications = false; void persist().catch(() => {}); publish(); }
    const matchesApi = pattern => {
      if (pattern === '<all_urls>') return true;
      if (typeof pattern !== 'string') return false;
      const match = /^(?:\*|https):\/\/([^/]+)\//.exec(pattern);
      return Boolean(match && (match[1] === '*' || match[1] === 'api.cloudflare.com' || match[1].startsWith('*.') && ('api.cloudflare.com' === match[1].slice(2) || 'api.cloudflare.com'.endsWith('.' + match[1].slice(2)))));
    };
    if (removed.origins?.some(matchesApi)) {
      invalidate(); const epoch = generation; errorState('permission-required'); publish();
      void persistRevocation().catch(error => { if (!disposed && epoch === generation) { errorState(safeError(error)); publish(); } });
    }
  };
  const onNotificationClicked = id => {
    if (!ownNotificationId(id) || disposed) return;
    dismissNotification(id);
    try { Promise.resolve(api.tabs.create({ url: api.runtime.getURL('precursor-settings.html') })).catch(() => {}); } catch {}
  };
  function bindNotificationEvents() {
    const event = api.notifications?.onClicked;
    if (notificationEvents === event || typeof event?.addListener !== 'function') return;
    notificationEvents?.removeListener?.(onNotificationClicked); event.addListener(onNotificationClicked); notificationEvents = event;
  }
  // Listener registration is synchronous: an alarm/port can wake a suspended worker.
  api.runtime.onConnect.addListener(onPort);
  api.alarms?.onAlarm?.addListener(onAlarm);
  api.permissions?.onRemoved?.addListener(onPermissionsRemoved);
  bindNotificationEvents();
  const initialGeneration = generation;
  const ready = (async () => {
    stopAlarm();
    try {
      await whenReady();
      if (disposed || generation !== initialGeneration) return;
      if (!allowed()) { await clear(); return; }
      const saved = readSaved((await storage?.get(PRECURSOR_MODES_STORAGE))?.[PRECURSOR_MODES_STORAGE]);
      if (disposed || generation !== initialGeneration) return;
      if (saved) {
        const { monitoring: savedMonitoring, ...metadata } = saved;
        Object.assign(state, metadata); monitoring = savedMonitoring; state.checkedAt = saved.lastKnownAt;
        nextHistoryId = (saved.history.at(-1)?.id ?? 0) + 1;
        const enabled = saved.notifications && await contains({ permissions: ['notifications'] });
        if (disposed || generation !== initialGeneration) return;
        state.notifications = enabled;
      }
      const transport = readTransport((await storage.get(PRECURSOR_TRANSPORT_STORAGE))[PRECURSOR_TRANSPORT_STORAGE]);
      if (disposed || generation !== initialGeneration) return;
      if (!transport) fail('storage-unavailable');
      ({ lastAttempt, retryAt, failures, resetBaseline } = transport);
      if (recoverClock(clock())) await persistTransport();
      try { await prepareVault(); } catch {
        if (disposed || generation !== initialGeneration) return;
        monitoring = false; state.errorCode = 'session-unavailable'; state.status = 'error';
        await persistRevocation().catch(() => {}); publish(); return;
      }
      if (disposed || generation !== initialGeneration) return;
      let rawCredential;
      try { rawCredential = (await sessionStorage.get(PRECURSOR_CREDENTIAL_STORAGE))[PRECURSOR_CREDENTIAL_STORAGE]; }
      catch { fail('session-unavailable'); }
      if (disposed || generation !== initialGeneration) return;
      const credential = readCredential(rawCredential);
      if (!monitoring || !credential || credential.zoneId !== state.zone?.id) {
        monitoring = false;
        if (rawCredential !== undefined && !credential) state.errorCode = 'session-unavailable';
        await persistRevocation(); publish(); return;
      }
      token = credential.token; activeZoneId = credential.zoneId; credentialStored = true; state.status = 'connecting'; publish();
      await refresh().catch(error => { if (current(initialGeneration) && error?.code === 'cooldown') { errorState(state.errorCode === 'clock-changed' ? 'clock-changed' : 'cooldown'); publish(); } });
      if (current(initialGeneration)) await ensureAlarm(initialGeneration);
    } catch (error) { if (!disposed && generation === initialGeneration) { state.errorCode = ERROR_CODES.has(error?.code) ? error.code : 'storage-unavailable'; state.mode = 'unknown'; state.status = 'error'; } }
    if (!disposed && generation === initialGeneration) publish();
  })();
  return { ready, getState, snapshotForHost, command, clear, async dispose() {
    if (disposed) return; disposed = true; invalidate();
    api.runtime.onConnect.removeListener?.(onPort); api.alarms?.onAlarm?.removeListener?.(onAlarm); api.permissions?.onRemoved?.removeListener?.(onPermissionsRemoved); notificationEvents?.removeListener?.(onNotificationClicked);
    for (const port of ports.keys()) { try { port.disconnect(); } catch {} } ports.clear();
    await Promise.all([writing, credentialWriting, transportWriting]);
  } };
}
