// ADR-101: bounded top-level Options client. Mutations are never replayed.
import { FINGERPRINT_ENGINE_PORT, FINGERPRINT_ENGINE_VERSION } from './fingerprint-engine-shared.js';

const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const failure = code => Object.assign(new Error(code), { code });
const CODES = new Set(['unsupported', 'invalid-input', 'stale-revision', 'inactive', 'permission-required', 'empty-profile', 'profile-conflict', 'scope-denied', 'busy', 'timeout', 'native-error', 'debugger-detached', 'profile-changed', 'not-ready', 'unauthorized']);
const STATUSES = new Set(['ready', 'starting', 'running', 'partial', 'stopping', 'stopped', 'detached', 'error', 'unsupported']);
const NATIVE = new Set(['idle', 'starting', 'ready', 'partial', 'stopping', 'unavailable', 'unsupported']);
const EXCLUDED = new Set(['shared-worker', 'service-worker', 'worklet']);
const REASONS = new Set(['native-override-unavailable', 'incomplete-native-user-agent-metadata', 'fixed-offset-is-not-native-timezone']);
function freeze(value) { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
function dataArray(value, max) {
  if (!Array.isArray(value) || value.length > max) throw failure('invalid-input');
  const output = [];
  for (let index = 0; index < value.length; index++) { const field = Object.getOwnPropertyDescriptor(value, String(index)); if (!field || !Object.hasOwn(field, 'value')) throw failure('invalid-input'); output.push(field.value); }
  return output;
}
export function readFingerprintEngineState(value) {
  const supported = own(value, 'supported'), status = own(value, 'status'), sequence = own(value, 'sequence'), sessionOpen = own(value, 'sessionOpen'), revision = own(value, 'revision'), partial = own(value, 'partial'), error = own(value, 'error'), native = own(value, 'native');
  if (typeof supported !== 'boolean' || !STATUSES.has(status) || !integer(sequence) || typeof sessionOpen !== 'boolean' || revision !== null && !integer(revision) || typeof partial !== 'boolean' || error !== null && !CODES.has(error)) throw failure('invalid-input');
  const nativeStatus = own(native, 'status'), attached = own(native, 'attached'), workerCount = own(native, 'workerCount'), bootstrappedWorkers = own(native, 'bootstrappedWorkers');
  if (!NATIVE.has(nativeStatus) || typeof attached !== 'boolean' || !integer(workerCount) || workerCount > 64 || !integer(bootstrappedWorkers)) throw failure('invalid-input');
  const unsupported = dataArray(own(native, 'unsupported'), 3);
  if (unsupported.some(item => !EXCLUDED.has(item)) || new Set(unsupported).size !== unsupported.length) throw failure('invalid-input');
  const unsupportedFields = dataArray(own(value, 'unsupportedFields'), 512).map(row => {
    const id = own(row, 'id'), fields = dataArray(own(row, 'fields'), 64), reason = own(row, 'reason');
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(id) || !REASONS.has(reason) || fields.some(field => typeof field !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(field))) throw failure('invalid-input');
    return { id, fields, reason };
  });
  return freeze({ supported, status, sequence, sessionOpen, revision, partial, error, native: { status: nativeStatus, attached, workerCount, bootstrappedWorkers, unsupported }, unsupportedFields });
}
function ownOptions(api, env) {
  try {
    const expected = new URL(api.runtime.getURL('options.html')), actual = new URL(env.location.href);
    return env.top === env && actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname && !actual.username && !actual.password;
  } catch { return false; }
}
function startPayload(url, expectedRevision) {
  if (typeof url !== 'string' || url.length < 1 || url.length > 4096 || url.trim() !== url || /[\u0000-\u0020\u007f-\u009f\u202a-\u202e\u2066-\u2069\\]/u.test(url) || !integer(expectedRevision)) throw failure('invalid-input');
  let parsed; try { parsed = new URL(url); } catch { throw failure('invalid-input'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw failure('invalid-input');
  return { url: parsed.href, expectedRevision };
}
export function createFingerprintEngineClient(api = globalThis.chrome, { env = globalThis, deadlineMs = 12000, onChange = () => {}, onDisconnect = () => {} } = {}) {
  let port = null, pending = null, disposed = false, active = true, certain = false, sequence = 0, current = null;
  const check = () => { if (disposed || !active) throw failure('inactive'); if (!ownOptions(api, env)) throw failure('unauthorized'); };
  function disconnect() { const previous = port; port = null; try { previous?.disconnect(); } catch {} }
  function abandon(code) { const item = pending; pending = null; if (item) { clearTimeout(item.timer); item.reject(failure(code)); } certain = false; }
  function accept(value) {
    const snapshot = readFingerprintEngineState(value);
    if (!current || snapshot.sequence >= current.sequence) { current = snapshot; if (!disposed && active) try { onChange(snapshot); } catch {} }
    return current;
  }
  function open() {
    if (port) return port;
    const connected = api.runtime.connect({ name: FINGERPRINT_ENGINE_PORT }); port = connected; current = null;
    connected.onDisconnect.addListener(() => {
      if (port !== connected) return;
      try { void api.runtime.lastError; } catch {}
      port = null; abandon('native-error');
      if (!disposed && active) try { onDisconnect(); } catch {}
    });
    connected.onMessage.addListener(message => {
      if (disposed || !active || port !== connected || own(message, 'v') !== FINGERPRINT_ENGINE_VERSION) return;
      if (own(message, 'type') === 'state') { try { accept(own(message, 'value')); } catch {} return; }
      const item = pending;
      if (!item || own(message, 'id') !== item.id || typeof own(message, 'ok') !== 'boolean') return;
      pending = null; clearTimeout(item.timer);
      if (own(message, 'ok') !== true) { item.reject(failure(CODES.has(own(message, 'error')) ? own(message, 'error') : 'native-error')); return; }
      try { const value = accept(own(message, 'value')); certain = true; item.resolve(value); }
      catch { certain = false; item.reject(failure('invalid-input')); }
    });
    return connected;
  }
  function request(op, payload) {
    try {
      check(); if (pending) throw failure('busy'); if (op === 'start' && !certain) throw failure('not-ready');
      const connected = open(), id = 'engine-' + (++sequence);
      return new Promise((resolve, reject) => {
        const item = { id, resolve, reject, timer: null }; pending = item;
        item.timer = setTimeout(() => { if (pending !== item) return; abandon('timeout'); disconnect(); }, Math.max(1, Math.min(30000, deadlineMs)));
        try { connected.postMessage({ v: FINGERPRINT_ENGINE_VERSION, id, op, ...(payload === undefined ? {} : { payload }) }); }
        catch { abandon('native-error'); disconnect(); }
      });
    } catch (error) { return Promise.reject(failure(CODES.has(error?.code) ? error.code : 'native-error')); }
  }
  return {
    load: () => request('load'), start(url, revision) { try { return request('start', startPayload(url, revision)); } catch (error) { return Promise.reject(error); } }, stop: () => request('stop'),
    recover() { if (pending) return Promise.reject(failure('busy')); disconnect(); certain = false; return request('load'); },
    isBusy: () => pending !== null, isCertain: () => certain,
    setActive(value) { active = value === true; if (!active) { abandon('inactive'); disconnect(); } },
    dispose() { disposed = true; active = false; abandon('inactive'); disconnect(); },
  };
}
