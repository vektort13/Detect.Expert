// ADR-107 round 5: the 7-day trash of deleted library profiles. One small machine-local storage.local key; nothing here is part of
// the portable configuration, exported, sent or logged. The module reads and writes only 'fingerprint-trash:v1':
//   { version: 1, items: [{ profile, deletedAt, index }] }
// profile = a complete valid format-9 profile record, deletedAt = integer milliseconds, index = the old list position.
// Bounds: TRASH_MAX_ITEMS items, TRASH_MAX_BYTES serialized, TRASH_TTL_MS of age. Stored data is never trusted: every item is
// re-validated on read (the profile through validateApiConfiguration of a wrapper configuration), a malformed item or record is
// discarded, and a read or write that changed anything prunes the key. Pure functions take `now`; the store takes a clock.
import { API_CONFIGURATION_MAX_PROFILES, createApiConfiguration, validateApiConfiguration } from './api-configuration.js';

export const TRASH_KEY = 'fingerprint-trash:v1';
export const TRASH_VERSION = 1;
export const TRASH_DAY_MS = 86400000;
export const TRASH_TTL_MS = 7 * TRASH_DAY_MS;
export const TRASH_MAX_ITEMS = 32;
export const TRASH_MAX_BYTES = 1572864;
// The caps as a value, so a test can run the same code with small ones.
export const TRASH_LIMITS = Object.freeze({ items: TRASH_MAX_ITEMS, bytes: TRASH_MAX_BYTES });
// A trash copy is the first half of a delete: for a moment the profile is in the library AND in the trash. A copy that is that young is never
// taken for a leftover, whichever page reads the trash meanwhile; only an older copy of a profile that is back unchanged is dropped.
export const TRASH_PRUNE_GRACE_MS = 60000;
// A clock that moved backwards must not keep an item alive for longer than the TTL: a deletion time from the future is read as "now".
const FUTURE_SKEW_MS = 60000;

export class TrashError extends Error { constructor(code) { super(code); this.name = 'TrashError'; this.code = code; } }

const has = (object, key) => Object.hasOwn(object, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(object, key), 'value');
function plain(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const found = Reflect.ownKeys(value);
  return found.length === keys.length && keys.every(key => has(value, key));
}
const newest = (left, right) => right.deletedAt - left.deletedAt || (left.profile.id < right.profile.id ? -1 : left.profile.id > right.profile.id ? 1 : 0);
export const trashBytes = items => JSON.stringify({ version: TRASH_VERSION, items }).length;

// A profile record is trusted only after the contract accepted it inside a wrapper configuration (all rows, modes, values, tags and note).
function readProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const wrapped = validateApiConfiguration({ ...createApiConfiguration(), fingerprintProfiles: [raw] });
  return wrapped.ok && wrapped.value.fingerprintProfiles.length === 1 ? wrapped.value.fingerprintProfiles[0] : null;
}
function readItem(raw, now) {
  if (!plain(raw, ['profile', 'deletedAt', 'index'])) return null;
  const { deletedAt, index } = raw;
  if (!Number.isSafeInteger(deletedAt) || deletedAt < 1 || !Number.isSafeInteger(index) || index < 0 || index >= API_CONFIGURATION_MAX_PROFILES) return null;
  const profile = readProfile(raw.profile);
  return profile ? { profile, deletedAt: deletedAt > now + FUTURE_SKEW_MS ? now : deletedAt, index } : null;
}
// Evicts the oldest items until the count and the serialized size fit. `evicted` counts them.
export function fitTrash(items, limits = TRASH_LIMITS) {
  const kept = [...items].sort(newest);
  let evicted = 0;
  while (kept.length > limits.items || kept.length > 0 && trashBytes(kept) > limits.bytes) { kept.pop(); evicted++; }
  return { items: kept, evicted };
}
/**
 * Reads the stored value: { items (newest first, valid, unexpired, unique ids, within the caps), changed }. `changed` is true when
 * the stored value differs from the returned list (something expired, was malformed, duplicated or over a cap), so the caller can
 * write the pruned list back. Anything that is not a version-1 record reads as an empty trash.
 */
export function readTrash(raw, now = Date.now(), limits = TRASH_LIMITS) {
  if (raw === undefined) return { items: [], changed: false };
  if (!plain(raw, ['version', 'items']) || raw.version !== TRASH_VERSION || !Array.isArray(raw.items)) return { items: [], changed: true };
  const seen = new Set(), valid = [];
  let changed = raw.items.length > 4 * TRASH_MAX_ITEMS;
  for (const entry of raw.items.slice(0, 4 * TRASH_MAX_ITEMS)) {
    const item = readItem(entry, now);
    if (!item || now - item.deletedAt >= TRASH_TTL_MS) { changed = true; continue; }
    // A corrected deletion time (a clock that had moved forward) is written back, so the item then ages from now instead of never.
    if (item.deletedAt !== entry.deletedAt) changed = true;
    valid.push(item);
  }
  // The newest copy of an id wins.
  const unique = [];
  for (const item of valid.sort(newest)) { if (seen.has(item.profile.id)) { changed = true; continue; } seen.add(item.profile.id); unique.push(item); }
  const result = fitTrash(unique, limits);
  return { items: result.items, changed: changed || result.evicted > 0 };
}
/** Days left before the item is removed, rounded up: 7 right after the deletion, 1 during the last 24 hours (shown as "expires within a day"). */
export function trashDaysLeft(item, now = Date.now()) {
  const left = TRASH_TTL_MS - Math.max(0, now - item.deletedAt);
  return Math.max(1, Math.min(7, Math.ceil(left / TRASH_DAY_MS)));
}
/** Adds one deleted profile (an existing copy of the same id is replaced). Throws TrashError('too-large') when it alone cannot fit. */
export function addTrashItem(items, profile, index, now = Date.now(), limits = TRASH_LIMITS) {
  const record = readProfile(profile);
  if (!record) throw new TrashError('invalid');
  const item = { profile: record, deletedAt: now, index: Number.isSafeInteger(index) ? Math.min(Math.max(index, 0), API_CONFIGURATION_MAX_PROFILES - 1) : 0 };
  if (trashBytes([item]) > limits.bytes) throw new TrashError('too-large');
  const result = fitTrash([item, ...items.filter(other => other.profile.id !== record.id)], limits);
  return { items: result.items, evicted: result.evicted, item };
}
export const removeTrashItem = (items, id) => items.filter(item => item.profile.id !== id);
/**
 * Drops the items whose profile is back in the library unchanged (same id and the same content): that is the trash copy left behind
 * by a delete whose second step failed, or by a restore whose cleanup failed. A different profile with the same id keeps the item, and so
 * does a copy younger than TRASH_PRUNE_GRACE_MS (a delete in progress, possibly on another page).
 */
export function dropRestored(items, libraryProfiles, now = Date.now()) {
  const byId = new Map((Array.isArray(libraryProfiles) ? libraryProfiles : []).map(profile => [profile?.id, JSON.stringify(profile)]));
  return items.filter(item => now - item.deletedAt < TRASH_PRUNE_GRACE_MS || byId.get(item.profile.id) !== JSON.stringify(item.profile));
}
/**
 * What Restore should do with `item` against the current library:
 *   'restore'  the id is free: the profile goes back as it was;
 *   'present'  the library holds this very profile already: nothing to put back, only the trash copy goes;
 *   'fresh'    another profile holds the id: the profile comes back under a new id (it never replaces the other one).
 */
export function restorePlan(libraryProfiles, item) {
  const other = (Array.isArray(libraryProfiles) ? libraryProfiles : []).find(profile => profile?.id === item.profile.id);
  return !other ? 'restore' : JSON.stringify(other) === JSON.stringify(item.profile) ? 'present' : 'fresh';
}

/**
 * The trash over a browser storage object ({ local: { get, set, remove }, onChanged }). Operations are serialized in one chain
 * (this page never interleaves two read-modify-write cycles); every result is the pruned list, newest first.
 */
export function createTrashStore(storage, { now = Date.now, key = TRASH_KEY, limits = TRASH_LIMITS } = {}) {
  let chain = Promise.resolve();
  const serialize = task => { const next = chain.then(task, task); chain = next.catch(() => {}); return next; };
  async function load() { const stored = await storage.local.get(key); return readTrash(Object.hasOwn(stored ?? {}, key) ? stored[key] : undefined, now(), limits); }
  async function save(items) { if (items.length) await storage.local.set({ [key]: { version: TRASH_VERSION, items } }); else await storage.local.remove(key); }
  return {
    // `library` (the saved profiles) lets the read drop copies of profiles that are back in the library unchanged.
    read: ({ library = null } = {}) => serialize(async () => {
      const { items, changed } = await load();
      const kept = library ? dropRestored(items, library, now()) : items;
      if (changed || kept.length !== items.length) { try { await save(kept); } catch { /* The pruned list is still the truth for this call. */ } }
      return kept;
    }),
    // Throws before changing anything when the write fails: the caller then must not delete the profile.
    add: (profile, index, { library = null } = {}) => serialize(async () => {
      const { items } = await load();
      const added = addTrashItem(library ? dropRestored(items, library, now()) : items, profile, index, now(), limits);
      await save(added.items);
      return { items: added.items, evicted: added.evicted, item: added.item };
    }),
    remove: id => serialize(async () => { const { items } = await load(), next = removeTrashItem(items, id); await save(next); return next; }),
    empty: () => serialize(async () => { await storage.local.remove(key); return []; }),
    // The callback runs when another page (or this one) changed the key; it only means "read again". Returns an unsubscribe function.
    watch(callback) {
      const listener = (changes, area) => { if (area === 'local' && changes && Object.hasOwn(changes, key)) { try { callback(); } catch { /* A repaint has no privileged effects. */ } } };
      storage.onChanged?.addListener(listener);
      return () => storage.onChanged?.removeListener(listener);
    }
  };
}
