// ADR-070/103/107 round 5: pure helpers of the Proxy manager view. No DOM, no chrome.*, no network, no stored secrets: the list
// filters and sorts saved metadata and the last manual check results, keeps view preferences (columns, density, sort) in one small
// validated local value, and models selection, the grid keyboard, the check queue, domain chips and per-field draft errors.
import { PROXY_LIMITS, PROXY_TYPES, PROXY_DIRECT_TYPES, proxyEndpointLabel, proxyHost, normalizeVlessUri } from './proxy-shared.js';
import { proxyHistoryOf } from './proxy-history.js';

// ---- View preferences -------------------------------------------------------------------------------------------------------
// Local UI state only (never part of the proxy configuration, an export, a report or a log): density, the visible optional columns and
// the sort. Read strictly: anything unexpected is the default.
export const PROXY_VIEW_KEY = 'proxy-view:v1';
export const PROXY_VIEW_COLUMNS = Object.freeze(['type', 'address', 'country', 'linked', 'check', 'ip', 'checked']);
export const PROXY_VIEW_SORTS = Object.freeze(['name', 'type', 'host', 'country', 'latency', 'health', 'checked']);
export const PROXY_VIEW_DENSITIES = Object.freeze(['comfortable', 'compact']);
export const DEFAULT_PROXY_VIEW = Object.freeze({ density: 'comfortable', columns: PROXY_VIEW_COLUMNS, sort: 'name', dir: 'asc' });
const VIEW_MAX_CHARS = 1024;
const ownData = (object, key) => Object.hasOwn(object, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(object, key), 'value');
export function normalizeProxyView(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) return DEFAULT_PROXY_VIEW;
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== 5 || !['version', 'density', 'columns', 'sort', 'dir'].every(key => ownData(raw, key)) || raw.version !== 1) return DEFAULT_PROXY_VIEW;
  const { density, columns, sort, dir } = raw;
  if (!PROXY_VIEW_DENSITIES.includes(density) || !PROXY_VIEW_SORTS.includes(sort) || !['asc', 'desc'].includes(dir)) return DEFAULT_PROXY_VIEW;
  if (!Array.isArray(columns) || columns.length > PROXY_VIEW_COLUMNS.length || columns.some(column => typeof column !== 'string' || !PROXY_VIEW_COLUMNS.includes(column)) || new Set(columns).size !== columns.length) return DEFAULT_PROXY_VIEW;
  // Canonical column order, whatever order was stored.
  return Object.freeze({ density, columns: Object.freeze(PROXY_VIEW_COLUMNS.filter(column => columns.includes(column))), sort, dir });
}
// The view after a patch: every part of the patch that is not valid is ignored, so one bad value never resets the rest.
export function proxyViewPatch(view, patch) {
  const base = normalizeProxyView({ version: 1, ...view }), next = { version: 1, density: base.density, columns: [...base.columns], sort: base.sort, dir: base.dir };
  if (patch !== null && typeof patch === 'object') {
    if (PROXY_VIEW_DENSITIES.includes(patch.density)) next.density = patch.density;
    if (PROXY_VIEW_SORTS.includes(patch.sort)) next.sort = patch.sort;
    if (patch.dir === 'asc' || patch.dir === 'desc') next.dir = patch.dir;
    if (Array.isArray(patch.columns) && patch.columns.every(column => PROXY_VIEW_COLUMNS.includes(column))) next.columns = [...new Set(patch.columns)];
  }
  return normalizeProxyView(next);
}
// `area` is a Storage-like object ({ getItem, setItem }); every access is guarded because storage can be disabled or throw.
export function readProxyView(area) {
  try {
    const text = area?.getItem?.(PROXY_VIEW_KEY);
    if (typeof text !== 'string' || text.length === 0 || text.length > VIEW_MAX_CHARS) return DEFAULT_PROXY_VIEW;
    return normalizeProxyView(JSON.parse(text));
  } catch { return DEFAULT_PROXY_VIEW; }
}
export function writeProxyView(area, view) {
  try {
    const value = normalizeProxyView({ version: 1, density: view?.density, columns: view?.columns, sort: view?.sort, dir: view?.dir });
    area.setItem(PROXY_VIEW_KEY, JSON.stringify({ version: 1, density: value.density, columns: [...value.columns], sort: value.sort, dir: value.dir }));
    return true;
  } catch { return false; }
}
// Removes the stored value; the next read is the default view.
export function clearProxyView(area) { try { area.removeItem(PROXY_VIEW_KEY); return true; } catch { return false; } }
export function localViewStorage() { try { return globalThis.localStorage ?? null; } catch { return null; } }

// ---- Check results as the list shows them ---------------------------------------------------------------------------------------
// Presentation steps only; they say nothing about the quality of a provider.
export const PROXY_LATENCY_STEPS = Object.freeze({ fast: 300, ok: 1000 });
export function proxyLatencyBucket(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  return ms <= PROXY_LATENCY_STEPS.fast ? 'fast' : ms <= PROXY_LATENCY_STEPS.ok ? 'ok' : 'slow';
}
// The newest saved history entry as a check result of the same shape the live results have.
export function proxyEntryDiagnostic(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.ok === true) return { state: 'pass', reachable: true, remoteDns: entry.dns === 'ok', tlsVerified: entry.tls === 'ok', httpStatus: entry.status, ip: entry.ip || null, elapsedMs: entry.ms };
  if (entry.ok === false && typeof entry.code === 'string') return { state: 'fail', code: entry.code };
  return null;
}
// Live results of this visit win; otherwise the last saved manual check (marked `stored`). Both are results of manual checks.
export function proxyMergedChecks(checks, history, profiles) {
  const merged = {};
  for (const profile of profiles) {
    const entry = proxyHistoryOf(history, profile.id).at(-1), diagnostic = proxyEntryDiagnostic(entry);
    if (diagnostic) merged[profile.id] = { diagnostic, checkedAt: entry.lastAt, stored: true };
  }
  for (const profile of profiles) if (checks && Object.hasOwn(checks, profile.id) && checks[profile.id]?.diagnostic) merged[profile.id] = checks[profile.id];
  return merged;
}
export function proxyCheckStateOf(checks, id) {
  const state = checks && Object.hasOwn(checks, id) ? checks[id]?.diagnostic?.state : null;
  return state === 'pass' || state === 'fail' ? state : 'unchecked';
}

// ---- Relative time ----------------------------------------------------------------------------------------------------------------
const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
// { unit, value } with a negative value for the past, or null for a time that is not a finite number.
export function proxyRelativeParts(then, now) {
  if (!Number.isFinite(then) || !Number.isFinite(now)) return null;
  const diff = then - now, abs = Math.abs(diff), sign = diff < 0 ? -1 : 1;
  if (abs < 45000) return { unit: 'second', value: 0 };
  if (abs < 45 * MINUTE) return { unit: 'minute', value: sign * Math.max(1, Math.round(abs / MINUTE)) };
  if (abs < 22 * HOUR) return { unit: 'hour', value: sign * Math.max(1, Math.round(abs / HOUR)) };
  if (abs < 26 * DAY) return { unit: 'day', value: sign * Math.max(1, Math.round(abs / DAY)) };
  if (abs < 320 * DAY) return { unit: 'month', value: sign * Math.max(1, Math.round(abs / (30 * DAY))) };
  return { unit: 'year', value: sign * Math.max(1, Math.round(abs / (365 * DAY))) };
}
const formatters = new Map();
export function proxyFormatRelative(then, now, languageTag = 'en') {
  const parts = proxyRelativeParts(then, now);
  if (!parts) return '';
  try {
    let formatter = formatters.get(languageTag);
    if (!formatter) { formatter = new Intl.RelativeTimeFormat(languageTag, { numeric: 'auto', style: 'short' }); if (formatters.size > 8) formatters.clear(); formatters.set(languageTag, formatter); }
    return formatter.format(parts.value, parts.unit);
  } catch { return ''; }
}

// ---- Latency sparkline ------------------------------------------------------------------------------------------------------------
// Coordinates of a small trend line for the successful response times (oldest first): null with fewer than two numbers.
export function proxySparkline(values, { width = 140, height = 36, pad = 3 } = {}) {
  const numbers = (Array.isArray(values) ? values : []).filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  if (numbers.length < 2) return null;
  const min = Math.min(...numbers), max = Math.max(...numbers), span = max - min, step = (width - 2 * pad) / (numbers.length - 1);
  const round = value => Math.round(value * 10) / 10;
  const points = numbers.map((value, index) => ({ x: round(pad + index * step), y: round(span === 0 ? height / 2 : height - pad - (value - min) / span * (height - 2 * pad)) }));
  const line = points.map((point, index) => (index === 0 ? 'M' : 'L') + point.x + ' ' + point.y).join('');
  const area = line + 'L' + points.at(-1).x + ' ' + (height - pad) + 'L' + points[0].x + ' ' + (height - pad) + 'Z';
  const sorted = [...numbers].sort((a, b) => a - b), median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
  return { width, height, line, area, points, last: points.at(-1), min, max, median, count: numbers.length };
}

// ---- Filtering, facets, sorting -----------------------------------------------------------------------------------------------------
const TYPE_LABELS = Object.freeze({ socks5: 'SOCKS5', http: 'HTTP', https: 'HTTPS', vless: 'VLESS', openvpn: 'OpenVPN' });
export const PROXY_STATUS_FILTERS = Object.freeze(['all', 'pass', 'fail', 'unchecked']);
function matches(profile, { query = '', type = 'all', status = 'all', country = 'all' }, checks, needle) {
  if (type !== 'all' && profile.type !== type) return false;
  if (country !== 'all' && (country === 'none' ? Boolean(profile.country) : profile.country !== country)) return false;
  if (status !== 'all' && proxyCheckStateOf(checks, profile.id) !== status) return false;
  return !needle || [profile.name, profile.host, proxyEndpointLabel(profile.host, profile.port), TYPE_LABELS[profile.type], profile.country].some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(needle));
}
export function proxyFilterProfiles(profiles, filters = {}, checks = {}) {
  const needle = String(filters.query ?? '').trim().toLocaleLowerCase();
  return profiles.filter(profile => matches(profile, filters, checks, needle));
}
// Counts for the chips: each facet counts what the OTHER active filters leave, so a chip predicts what choosing it shows.
export function proxyFacetCounts(profiles, filters = {}, checks = {}) {
  const needle = String(filters.query ?? '').trim().toLocaleLowerCase();
  const type = { all: 0 }, status = { all: 0, pass: 0, fail: 0, unchecked: 0 }, country = new Map();
  for (const kind of PROXY_TYPES) type[kind] = 0;
  let none = 0;
  for (const profile of profiles) {
    const state = proxyCheckStateOf(checks, profile.id);
    if (matches(profile, { ...filters, type: 'all' }, checks, needle)) { type.all++; type[profile.type]++; }
    if (matches(profile, { ...filters, status: 'all' }, checks, needle)) { status.all++; status[state]++; }
    if (matches(profile, { ...filters, country: 'all' }, checks, needle)) { if (profile.country) country.set(profile.country, (country.get(profile.country) ?? 0) + 1); else none++; }
  }
  return { type, status, country: [...country].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : 1)), none };
}
// Every country that any saved profile carries (not narrowed by other filters), for a stable menu.
export function proxyCountriesPresent(profiles) {
  const counts = new Map();
  for (const profile of profiles) if (profile.country) counts.set(profile.country, (counts.get(profile.country) ?? 0) + 1);
  return [...counts].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : 1));
}
export function proxyHasFilters(filters = {}) {
  return String(filters.query ?? '').trim() !== '' || (filters.type ?? 'all') !== 'all' || (filters.status ?? 'all') !== 'all' || (filters.country ?? 'all') !== 'all';
}
const compareText = (left, right) => { const a = String(left ?? '').toLocaleLowerCase(), b = String(right ?? '').toLocaleLowerCase(); return a < b ? -1 : a > b ? 1 : 0; };
// The comparator of the list: the existing sort keys, plus country, in either direction; ties fall back to name and ID so the order is
// stable. 'asc' is the natural order of each key (A to Z, fast to slow, pass before fail, oldest check first); a missing value (no
// country, no successful response) is always last, in either direction.
export function proxyCompare(sort, dir, checks) {
  const read = profile => checks && Object.hasOwn(checks, profile.id) ? checks[profile.id] : null;
  const health = profile => read(profile)?.diagnostic?.state === 'pass' ? 0 : read(profile)?.diagnostic?.state === 'fail' ? 1 : 2;
  const sign = dir === 'desc' ? -1 : 1;
  const missingLast = (a, b, compare) => a == null || b == null ? (a == null) - (b == null) : sign * compare(a, b);
  const byName = (left, right) => compareText(left.name, right.name) || compareText(left.id, right.id);
  return (left, right) => {
    let order = 0;
    if (sort === 'type') order = sign * compareText(left.type, right.type);
    else if (sort === 'host') order = sign * (compareText(left.host, right.host) || (left.port ?? 0) - (right.port ?? 0));
    else if (sort === 'country') order = missingLast(left.country || null, right.country || null, compareText);
    else if (sort === 'latency') { const ms = profile => read(profile)?.diagnostic?.state === 'pass' ? read(profile).diagnostic.elapsedMs : null; order = missingLast(ms(left), ms(right), (a, b) => a - b); }
    else if (sort === 'health') order = sign * (health(left) - health(right));
    else if (sort === 'checked') order = missingLast(read(left)?.checkedAt || null, read(right)?.checkedAt || null, (a, b) => a - b);
    else order = sign * compareText(left.name, right.name);
    return order || byName(left, right);
  };
}

// ---- Selection ---------------------------------------------------------------------------------------------------------------------
export const proxyToggleSelection = (selected, id) => selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
// The IDs from `from` to `to` inclusive in the order shown; a missing end selects only the target.
export function proxySelectRange(order, from, to) {
  const a = order.indexOf(from), b = order.indexOf(to);
  if (b < 0) return [];
  if (a < 0) return [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}
export const proxyReconcileSelection = (selected, validIds) => { const valid = new Set(validIds); const next = selected.filter(id => valid.has(id)); return next.length === selected.length ? selected : next; };

// ---- Grid keyboard -----------------------------------------------------------------------------------------------------------------
// The action for a key pressed on a row: { type: 'focus', index, extend } moves the roving focus (Shift extends the selection),
// 'toggle' flips the selection of the focused row, 'select-all', 'open' (details), 'delete' (asks first), 'check', 'search' and
// 'escape'. null means the key is not the grid's. IME composition and Alt combinations never act.
export function proxyGridKeyAction(event, { index = 0, count = 0, page = 10 } = {}) {
  if (!event || event.isComposing === true || event.altKey === true || count < 0) return null;
  const key = event.key, command = event.ctrlKey === true || event.metaKey === true, shift = event.shiftKey === true;
  const move = target => count > 0 ? { type: 'focus', index: Math.max(0, Math.min(count - 1, target)), extend: shift && !command } : null;
  if (key === 'ArrowDown') return move(index + 1);
  if (key === 'ArrowUp') return move(index - 1);
  if (key === 'Home') return move(0);
  if (key === 'End') return move(count - 1);
  if (key === 'PageDown') return move(index + page);
  if (key === 'PageUp') return move(index - page);
  if (command && (key === 'a' || key === 'A')) return count > 0 ? { type: 'select-all' } : null;
  if (command) return null;
  if (key === ' ' || key === 'Spacebar') return shift ? null : { type: 'toggle' };
  if (key === 'Enter') return { type: 'open' };
  if (key === 'Delete') return { type: 'delete' };
  if ((key === 'c' || key === 'C') && !shift) return { type: 'check' };
  if (key === '/') return { type: 'search' };
  if (key === 'Escape') return { type: 'escape' };
  return null;
}

// ---- Toolbars (chip groups, density) ------------------------------------------------------------------------------------------
// Each group is one tab stop; inside it the arrow keys move the focus (mirrored in right-to-left languages, wrapping at the ends), Home
// and End jump to the ends. The result is the index to focus, or null when the key is not the toolbar's (a modifier, composition,
// anything else), so the page keeps it.
export function proxyRovingTarget(event, { index = 0, count = 0, rtl = false } = {}) {
  if (!event || event.isComposing === true || event.altKey === true || event.ctrlKey === true || event.metaKey === true || event.shiftKey === true || !(count > 0) || !(index >= 0 && index < count)) return null;
  const flip = rtl === true ? -1 : 1;
  if (event.key === 'ArrowRight') return (index + flip + count) % count;
  if (event.key === 'ArrowLeft') return (index - flip + count) % count;
  if (event.key === 'Home') return 0;
  if (event.key === 'End') return count - 1;
  return null;
}

// ---- Check queue ---------------------------------------------------------------------------------------------------------------------
// Runs `check(id)` for every ID, at most `limit` at a time, in order. Nothing new starts once `stopped()` is true; checks already
// running finish. `onStart(id)` and `onResult(id, result)` are called around each check. The check function never throws here: a
// throwing check is reported as a result of { error }.
export async function runProxyCheckQueue({ ids, limit = 1, check, stopped = () => false, onStart = () => {}, onResult = () => {} }) {
  const queue = [...ids], size = Math.max(1, Math.min(8, Math.floor(limit) || 1));
  let started = 0, finished = 0;
  async function worker() {
    while (queue.length > 0 && !stopped()) {
      const id = queue.shift(); started++; onStart(id);
      let result;
      try { result = await check(id); } catch (error) { result = { error }; }
      finished++; onResult(id, result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, worker));
  return { started, finished, total: ids.length, cancelled: queue.length > 0 };
}

// ---- Domain chips -------------------------------------------------------------------------------------------------------------------
// One routing entry: an exact host or *.domain, normalized like the service does. reason: 'empty', 'invalid', 'duplicate' (already in
// this list), 'conflict' (in the other list), 'limit'.
export function proxyDomainEntry(text, { list = [], other = [] } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty' };
  let value;
  try {
    const wildcard = raw.startsWith('*.'), host = proxyHost(wildcard ? raw.slice(2) : raw);
    if (wildcard && (host.includes(':') || /^[0-9.]+$/.test(host) || !host.includes('.'))) return { ok: false, reason: 'invalid' };
    value = (wildcard ? '*.' : '') + host;
  } catch { return { ok: false, reason: 'invalid' }; }
  if (list.includes(value)) return { ok: false, reason: 'duplicate', value };
  if (other.includes(value)) return { ok: false, reason: 'conflict', value };
  if (list.length >= PROXY_LIMITS.domains) return { ok: false, reason: 'limit', value };
  return { ok: true, value };
}
// Pasted text may carry many entries separated by white space, commas or semicolons.
export const proxyDomainTokens = text => String(text ?? '').split(/[\s,;]+/).filter(Boolean).slice(0, PROXY_LIMITS.domains + 1);

// ---- Per-field draft errors ---------------------------------------------------------------------------------------------------------
// The reason each field of a profile draft is not acceptable, mirroring proxyProfileInput: an object with only the failing fields.
export function proxyDraftErrors(draft, maxConfig = PROXY_LIMITS.openVpnBytes) {
  const errors = {};
  if (!draft || !PROXY_TYPES.includes(draft.type)) return errors;
  const name = typeof draft.name === 'string' ? draft.name : '';
  if (!name.trim()) errors.name = 'required'; else if (name.length > PROXY_LIMITS.name) errors.name = 'long';
  if (PROXY_DIRECT_TYPES.includes(draft.type)) {
    const host = typeof draft.host === 'string' ? draft.host : '', port = typeof draft.port === 'string' ? draft.port : '';
    if (!host.trim()) errors.host = 'required'; else if (/[\s/@?#]/.test(host)) errors.host = 'invalid';
    const number = Number(port);
    if (!/^\d{1,5}$/.test(port) || !Number.isInteger(number) || number < 1 || number > 65535) errors.port = 'invalid';
  } else if (draft.type === 'vless') {
    if (!draft.uri) { if (!draft.id) errors.uri = 'required'; } else { try { normalizeVlessUri(draft.uri); } catch { errors.uri = 'invalid'; } }
  } else if (!draft.config) { if (!draft.id) errors.config = 'required'; } else if (draft.config.length > maxConfig) errors.config = 'long';
  return errors;
}
