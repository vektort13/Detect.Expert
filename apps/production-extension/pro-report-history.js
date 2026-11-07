// ADR-097: explicit local snapshots of validated stopped PRO sessions.
export const PRO_REPORT_HISTORY_DATABASE = 'detect-expert-pro-report-history';
export const PRO_REPORT_HISTORY_LIMITS = Object.freeze({ records: 20, bytes: 8 * 1024 * 1024 });
const STORES = Object.freeze(['state', 'reports', 'summaries']);
const CHANNEL = 'detect.expert/pro-report-history/v1', listeners = new Set();
function publish() {
  try { if (typeof globalThis.BroadcastChannel === 'function') { const channel = new BroadcastChannel(CHANNEL);channel.postMessage('changed');channel.close();return; } } catch {}
  for (const listener of [...listeners]) try { listener(); } catch {}
}
export function subscribeProReportHistory(listener) {
  listeners.add(listener);let channel;
  try { if (typeof globalThis.BroadcastChannel === 'function') { channel = new BroadcastChannel(CHANNEL);channel.onmessage = event => { if (event.data === 'changed') try { listener(); } catch {} }; } } catch {}
  return () => { listeners.delete(listener);channel?.close(); };
}
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,64}$/u.test(value);
const validEpoch = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
const failure = code => Object.assign(new Error(code), { code });
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const clock = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
function domainLabel(value) {
  if (typeof value !== 'string' || value.length > 253 || /[\s/?#@\\]/u.test(value)) return null;
  try { const url = new URL('https://' + value);return !url.username && !url.password && !url.port && url.pathname === '/' ? url.hostname : null; } catch { return null; }
}
function summaryRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !validId(own(value, 'id')) || !clock(own(value, 'savedAt')) || !clock(own(value, 'startedAt')) || !clock(own(value, 'stoppedAt')) || own(value, 'stoppedAt') < own(value, 'startedAt') || !Number.isInteger(own(value, 'pages')) || own(value, 'pages') < 0 || own(value, 'pages') > 100 || !Number.isSafeInteger(own(value, 'bytes')) || own(value, 'bytes') <= 0 || own(value, 'bytes') > PRO_REPORT_HISTORY_LIMITS.bytes) throw failure('history-corrupt');
  const domain = own(value, 'domain');if (domain !== null && domainLabel(domain) !== domain) throw failure('history-corrupt');
  return { id: value.id, domain, savedAt: value.savedAt, startedAt: value.startedAt, stoppedAt: value.stoppedAt, pages: value.pages, bytes: value.bytes };
}
const request = native => new Promise((resolve, reject) => { native.onsuccess = () => resolve(native.result);native.onerror = () => reject(native.error ?? failure('history-unavailable')); });

// All asynchronous work inside a transaction is an IndexedDB request. No timers,
// validators, native messaging or other external awaits can let it auto-commit.
export function createProReportHistoryBackend(indexedDB = globalThis.indexedDB) {
  async function open() {
    if (!indexedDB || typeof indexedDB.open !== 'function') throw failure('history-unavailable');
    return new Promise((resolve, reject) => {
      let settled = false;const native = indexedDB.open(PRO_REPORT_HISTORY_DATABASE, 1);
      const timer = setTimeout(() => { if (!settled) { settled = true;reject(failure('history-unavailable')); } }, 5000);
      native.onupgradeneeded = () => { const db = native.result;for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: name === 'state' ? 'key' : 'id' });native.transaction.objectStore('state').put({ key: 'epoch', value: 'initial-v1' }); };
      native.onerror = () => { if (!settled) { settled = true;clearTimeout(timer);reject(native.error ?? failure('history-unavailable')); } };
      native.onsuccess = () => { if (settled) { native.result.close();return; }settled = true;clearTimeout(timer);native.result.onversionchange = () => native.result.close();resolve(native.result); };
    });
  }
  return Object.freeze({
    async transaction(names, mode, operation) {
      const db = await open();let tx, timer;
      try {
        tx = db.transaction(names, mode);
        timer = setTimeout(() => { try { tx.abort(); } catch {} }, 5000);
        const complete = new Promise((resolve, reject) => { tx.oncomplete = resolve;tx.onabort = () => reject(tx.error ?? failure('history-unavailable'));tx.onerror = () => {}; });
        // Register the rejection immediately so a request error cannot create an
        // unhandled transaction rejection before operation() reaches its await.
        const settled = complete.then(() => ({ ok: true }), error => ({ ok: false, error }));
        const io = { get: (store, key) => request(tx.objectStore(store).get(key)), all: store => request(tx.objectStore(store).getAll(undefined, PRO_REPORT_HISTORY_LIMITS.records + 1)), put: (store, value) => request(tx.objectStore(store).put(value)), remove: (store, key) => request(tx.objectStore(store).delete(key)), clear: store => request(tx.objectStore(store).clear()) };
        let value;
        try { value = await operation(io); } catch (error) { try { tx.abort(); } catch {}await settled;throw error; }
        const result = await settled;if (!result.ok) throw result.error;return value;
      } finally { clearTimeout(timer);db.close(); }
    },
  });
}
let sharedBackend;
const backend = () => sharedBackend ??= createProReportHistoryBackend();
const nextEpoch = () => { if (typeof globalThis.crypto?.randomUUID !== 'function') throw failure('history-unavailable');return globalThis.crypto.randomUUID(); };
async function epoch(io) { const record = await io.get('state', 'epoch');if (!validEpoch(own(record, 'value'))) throw failure('history-corrupt');return record.value; }

export async function purgeProReportHistory({ storage = backend(), makeEpoch = nextEpoch } = {}) {
  const value = makeEpoch();if (!validEpoch(value)) throw failure('history-unavailable');
  await storage.transaction(STORES, 'readwrite', async io => { const previous = await io.get('state', 'epoch');if (own(previous, 'value') === value) throw failure('history-unavailable');await io.put('state', { key: 'epoch', value });await io.clear('reports');await io.clear('summaries'); });
  publish();
  return value;
}

// Used by the existing global clear and consent-discard methods, even with all
// UI pages closed. A second atomic fence closes captures during the old reset.
export async function withProReportHistoryPurge(operation, options) {
  let before = false, after = false, value, operationError, operationFailed = false;
  try { await purgeProReportHistory(options);before = true; } catch {}
  try { value = await operation(); } catch (error) { operationError = error;operationFailed = true; }
  finally { try { await purgeProReportHistory(options);after = true; } catch {} }
  if (operationFailed) throw operationError;
  return { ok: before && after, value };
}

export function createProReportHistory({ validateSession, storage = backend(), now = () => Date.now(), makeEpoch = nextEpoch } = {}) {
  if (typeof validateSession !== 'function') throw new TypeError('Existing PRO session validator required');
  function checkedSession(input) {
    const checked = validateSession(input);
    if (!checked?.ok || checked.value?.status !== 'stopped') throw failure('history-invalid');
    // Clone after the canonical bounded-plain validator. This copy never comes
    // from an arbitrary page or an unvalidated archive record.
    const session = structuredClone(checked.value);if (!validId(session.id)) throw failure('history-invalid');return session;
  }
  return Object.freeze({
    subscribe: subscribeProReportHistory,
    captureEpoch: () => storage.transaction(['state'], 'readonly', epoch),
    async save(input, expectedEpoch) {
      if (!validEpoch(expectedEpoch)) throw failure('history-stale');
      const session = checkedSession(input), bytes = new TextEncoder().encode(JSON.stringify(session)).byteLength, savedAt = now();
      if (!clock(savedAt)) throw failure('history-unavailable');if (bytes > PRO_REPORT_HISTORY_LIMITS.bytes) throw failure('history-full');
      const summary = summaryRecord({ id: session.id, domain: domainLabel(session.domain), savedAt, startedAt: session.startedAt, stoppedAt: session.stoppedAt, pages: session.pages.length, bytes });
      const result = await storage.transaction(STORES, 'readwrite', async io => {
        if (await epoch(io) !== expectedEpoch) throw failure('history-stale');
        const summaries = (await io.all('summaries')).map(summaryRecord);if (summaries.length > PRO_REPORT_HISTORY_LIMITS.records || new Set(summaries.map(row => row.id)).size !== summaries.length) throw failure('history-corrupt');
        const existing = summaries.find(row => row.id === summary.id), total = summaries.reduce((sum, row) => sum + row.bytes, 0) - (existing?.bytes ?? 0) + bytes;
        if (summaries.length + (existing ? 0 : 1) > PRO_REPORT_HISTORY_LIMITS.records || total > PRO_REPORT_HISTORY_LIMITS.bytes) throw failure('history-full');
        await io.put('reports', { id: session.id, session });await io.put('summaries', summary);return { ...summary };
      });
      publish();return result;
    },
    async list() {
      return storage.transaction(['summaries'], 'readonly', async io => { const rows = (await io.all('summaries')).map(summaryRecord);if (rows.length > PRO_REPORT_HISTORY_LIMITS.records || new Set(rows.map(row => row.id)).size !== rows.length || rows.reduce((sum, row) => sum + row.bytes, 0) > PRO_REPORT_HISTORY_LIMITS.bytes) throw failure('history-corrupt');return rows.sort((a, b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id, 'en')); });
    },
    async get(id) {
      if (!validId(id)) throw failure('history-invalid');
      const value = await storage.transaction(['reports'], 'readonly', io => io.get('reports', id));if (value === undefined) return null;
      if (own(value, 'id') !== id) throw failure('history-corrupt');const session = checkedSession(own(value, 'session'));if (session.id !== id) throw failure('history-corrupt');return session;
    },
    async remove(id) {
      if (!validId(id)) throw failure('history-invalid');
      const value = makeEpoch();if (!validEpoch(value)) throw failure('history-unavailable');
      await storage.transaction(STORES, 'readwrite', async io => { if (await epoch(io) === value) throw failure('history-unavailable');await io.put('state', { key: 'epoch', value });await io.remove('reports', id);await io.remove('summaries', id); });
      publish();
    },
  });
}

// The epoch must be captured before the fresh authoritative read. A stopped
// snapshot from before global clear cannot be committed after either fence.
export async function archiveCurrentProReport({ history, candidateId, readCurrent, isCurrent = () => true }) {
  if (!validId(candidateId) || !isCurrent()) throw failure('history-stale');
  const captured = await history.captureEpoch();if (!isCurrent()) throw failure('history-stale');
  const current = await readCurrent();if (!isCurrent()) throw failure('history-stale');
  const session = current?.ok ? current.response?.session : null;
  if (!session || session.id !== candidateId || session.status !== 'stopped') throw failure('history-stale');
  await history.save(session, captured);return session;
}

export function proReportHistoryIntent(search) {
  try { const values = new URLSearchParams(search).getAll('history');return values.length === 0 ? 'fallback' : values.length === 1 && values[0] === '1' ? 'archive' : 'invalid'; } catch { return 'invalid'; }
}
