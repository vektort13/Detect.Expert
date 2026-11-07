// ADR-107 round 5: temporary profiles. A profile (a library one, or a freshly generated identity) is applied for THIS BROWSER SESSION
// only: the state that was applied before is remembered here and restored when the user ends the temporary profile or when the
// browser restarts. Two machine-local keys, both written and read only by the extension itself:
//   storage.local   'fingerprint-temporary:v1'       { version: 1, startedAt, label, previous }
//                   previous = a complete valid format-9 profile record of the applied rows before the temporary profile
//   storage.session 'fingerprint-temporary-live:v1'  { version: 1, startedAt }   (cleared by the browser when its session ends)
// A local record without the session marker means the browser (or the extension) restarted since: the service worker then restores
// `previous` before it registers anything. Nothing here is exported, sent or logged. This module is also bundled into the service
// worker, so it imports only the contract (no device tables, no UI code). Stored data is never trusted: the record is re-validated
// on every read (`previous` through validateApiConfiguration of a wrapper configuration) and a malformed one is discarded.
import { createApiConfiguration, validateApiConfiguration, apiLabelSafe } from './api-configuration.js';

export const TEMPORARY_KEY = 'fingerprint-temporary:v1';
export const TEMPORARY_LIVE_KEY = 'fingerprint-temporary-live:v1';
export const TEMPORARY_VERSION = 1;
export const TEMPORARY_LABEL_MAX = 160;
// A profile snapshot is about 15-20 KB; 256 KiB is far above any real one and keeps the key small.
export const TEMPORARY_MAX_BYTES = 262144;

export class TemporaryError extends Error { constructor(code) { super(code); this.name = 'TemporaryError'; this.code = code; } }

const has = (object, key) => Object.hasOwn(object, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(object, key), 'value');
function plain(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const found = Reflect.ownKeys(value);
  return found.length === keys.length && keys.every(key => has(value, key));
}
const bytesOf = record => JSON.stringify(record).length;

// A cosmetic label: characters the contract refuses for labels are dropped, whitespace collapses, the length is bounded.
export function temporaryLabel(text) {
  let clean = '';
  for (const char of typeof text === 'string' ? text : '') if (apiLabelSafe(char)) clean += char;
  clean = clean.replace(/\s+/gu, ' ').trim();
  if (clean.length > TEMPORARY_LABEL_MAX) { clean = clean.slice(0, TEMPORARY_LABEL_MAX); const last = clean.charCodeAt(clean.length - 1); if (last >= 0xd800 && last <= 0xdbff) clean = clean.slice(0, -1); }
  return clean;
}
// `previous` is trusted only after the contract accepted it inside a wrapper configuration.
function readPrevious(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const wrapped = validateApiConfiguration({ ...createApiConfiguration(), fingerprintProfiles: [raw] });
  return wrapped.ok && wrapped.value.fingerprintProfiles.length === 1 ? wrapped.value.fingerprintProfiles[0] : null;
}
/** The stored record as { startedAt, label, previous }, or null when it is missing or not exactly the version-1 shape. */
export function readTemporaryRecord(raw, maxBytes = TEMPORARY_MAX_BYTES) {
  if (!plain(raw, ['version', 'startedAt', 'label', 'previous']) || raw.version !== TEMPORARY_VERSION) return null;
  if (!Number.isSafeInteger(raw.startedAt) || raw.startedAt < 1 || typeof raw.label !== 'string' || raw.label.length > TEMPORARY_LABEL_MAX) return null;
  const previous = readPrevious(raw.previous);
  if (!previous) return null;
  const record = { startedAt: raw.startedAt, label: temporaryLabel(raw.label), previous };
  return bytesOf(record) <= maxBytes ? record : null;
}
/** The value to store. Throws TemporaryError('invalid') for a bad label, time or snapshot and 'too-large' over the size cap. */
export function buildTemporaryRecord({ startedAt, label, previous }, maxBytes = TEMPORARY_MAX_BYTES) {
  const profile = readPrevious(previous);
  if (!profile || !Number.isSafeInteger(startedAt) || startedAt < 1 || typeof label !== 'string' || !label.trim() || label.length > TEMPORARY_LABEL_MAX || !apiLabelSafe(label)) throw new TemporaryError('invalid');
  const record = { version: TEMPORARY_VERSION, startedAt, label: label.trim(), previous: profile };
  if (bytesOf(record) > maxBytes) throw new TemporaryError('too-large');
  return record;
}
export const buildLiveMarker = startedAt => ({ version: TEMPORARY_VERSION, startedAt });
export const isLiveMarker = raw => plain(raw, ['version', 'startedAt']) && raw.version === TEMPORARY_VERSION && Number.isSafeInteger(raw.startedAt) && raw.startedAt >= 1;

/**
 * What the service worker does at start-up with the two stored values:
 *   'none'     no record, or the record is live (same browser session);
 *   'revert'   a valid record without the marker: the browser restarted, so restore `record.previous`;
 *   'discard'  a record that is not valid: nothing can be restored, the key is removed.
 */
export function temporaryStartupPlan(rawRecord, rawLive) {
  if (rawRecord === undefined) return { action: 'none' };
  const record = readTemporaryRecord(rawRecord);
  if (!record) return { action: 'discard' };
  return isLiveMarker(rawLive) ? { action: 'none', record } : { action: 'revert', record };
}

/**
 * The rows, preset and WebRTC policy of `profile` laid over `configuration`, exactly as applying a library profile does (the masters,
 * the sites and the library stay as they are). The noise keys of Canvas, Math, Audio and the like are not stored in a profile: they
 * are derived from the applied rows, so they follow whatever is applied. null when the result is not a valid configuration.
 */
export function overlayProfile(configuration, profile) {
  if (!profile || !Array.isArray(profile.apis) || !configuration || !Array.isArray(configuration.apis)) return null;
  const rows = new Map(profile.apis.map(row => [row.id, row]));
  const next = { ...configuration, preset: profile.preset, webrtcNetworkPolicy: profile.webrtcNetworkPolicy,
    apis: configuration.apis.map(row => ({ ...row, ...(rows.has(row.id) ? structuredClone(rows.get(row.id)) : {}) })) };
  const checked = validateApiConfiguration(next);
  return checked.ok ? checked.value : null;
}
/** { configuration, changed } with the remembered state laid back over the current configuration; null when it cannot be valid. */
export function revertTemporaryConfiguration(current, previous) {
  const before = validateApiConfiguration(current), next = before.ok ? overlayProfile(before.value, previous) : null;
  return next ? { configuration: next, changed: JSON.stringify(next) !== JSON.stringify(before.value) } : null;
}

/**
 * The two keys over a browser storage object ({ local: { get, set, remove }, session: { get, set, remove } }). The UI side only: the
 * service worker reads the keys itself (api-configuration-controller.js) before anything is registered.
 */
export function createTemporaryStore(storage) {
  const local = storage?.local, session = storage?.session;
  const read = async (area, key) => { const stored = await area.get(key); return Object.hasOwn(stored ?? {}, key) ? stored[key] : undefined; };
  return {
    // Session storage is what tells "same browser session" from "restarted"; without it a temporary profile could never be ended
    // safely, so it is not offered at all.
    available: () => ['get', 'set', 'remove'].every(name => typeof local?.[name] === 'function' && typeof session?.[name] === 'function'),
    // { record, live } with the record validated (null when missing or malformed) and `live` true while the marker is present.
    async read() {
      const [raw, marker] = await Promise.all([read(local, TEMPORARY_KEY), read(session, TEMPORARY_LIVE_KEY)]), record = raw === undefined ? null : readTemporaryRecord(raw);
      return { record, live: isLiveMarker(marker), malformed: raw !== undefined && record === null };
    },
    // The marker is written first: a crash between the two writes leaves a harmless marker, never a record the browser would revert.
    async begin(record) {
      const value = buildTemporaryRecord(record);
      await session.set({ [TEMPORARY_LIVE_KEY]: buildLiveMarker(value.startedAt) });
      try { await local.set({ [TEMPORARY_KEY]: value }); } catch (failure) { try { await session.remove(TEMPORARY_LIVE_KEY); } catch { /* Harmless without a record. */ } throw failure; }
      return value;
    },
    // The record goes first, then the marker; a failure of the second step leaves a marker without a record, which is harmless.
    async end() { await local.remove(TEMPORARY_KEY); try { await session.remove(TEMPORARY_LIVE_KEY); } catch { /* Harmless without a record. */ } }
  };
}
