// ADR-066 / ADR-103 / ADR-107: the saved-profiles library of the Antidetect quick view.
// Every library edit commits only `fingerprintProfiles` through the panel's CAS writer; viewing (Peek), search, filters and
// Load never write. Facts, fit hints and search text are derived in memory from the saved profiles: never stored, sent or logged.
import { API_CONFIGURATION_MAX_PROFILES, validateApiConfiguration, diffApiConfigurations, apiLabelSafe, apiNoteSafe } from './api-configuration.js';
import { FINGERPRINT_ISSUE_CODES, FingerprintProfileError, snapshotFingerprintProfile, storeFingerprintProfile, applyFingerprintProfile, deleteFingerprintProfile, renameFingerprintProfile, fingerprintProfileIssues, editProfileMeta, normalizeProfileTags, normalizeProfileNote, PROFILE_META_LIMITS } from './fingerprint-profiles.js';
// ADR-107 round 5: tags and notes, the 7-day trash, temporary profiles and the profile-to-proxy link (their labels, pure helpers and stores).
import { fingerprintIdentityLabels } from './fingerprint-identity-labels.js';
import { restorePlan, trashDaysLeft } from './fingerprint-trash.js';
import { profilesOfProxy } from './identity-bundles.js';
import { GPU_PRESETS, describeDevice } from './fingerprint-device-presets.js';
import { fingerprintDeviceLabels } from './fingerprint-device-labels.js';
import { regionName } from './fingerprint-region-names.js';
import { fingerprintLibraryLabels, fingerprintLibraryPlural } from './fingerprint-library-labels.js';
import { announce } from './ui-announcer.js';
import { registerDirtyGuard, registerPaletteCommands, registerSaveShortcut } from './ui-shortcuts.js';

// The Undo line stays this long (paused while pointed at or focused); fit results are memoised for this many profiles.
export const LIBRARY_UNDO_MS = 8000;
export const LIBRARY_FIT_CACHE_MAX = 256;
export const LIBRARY_FIT_SLICE_MS = 12;
export const LIBRARY_PALETTE_MAX = 64;
export const LIBRARY_FILTER_GROUPS = Object.freeze(['os', 'browser', 'gpu', 'device', 'preset', 'status']);
export const LIBRARY_FILTER_OPTIONS = Object.freeze({ os: Object.freeze(['windows-11', 'windows-10', 'other']), browser: Object.freeze(['chrome', 'edge', 'other']), gpu: Object.freeze(['nvidia', 'amd', 'intel', 'other']), device: Object.freeze(['laptop', 'desktop', 'other']), preset: Object.freeze(['compatibility', 'balanced', 'strict', 'none']), status: Object.freeze(['applied', 'preview', 'conflicts', 'fit']) });
const LABEL_MAX = 160, SEARCH_MAX = 120, PALETTE_NAME_MAX = 128, FACT_MAX = 48, COLUMNS = 4;
const ISSUE_CODES = new Set(FINGERPRINT_ISSUE_CODES), EMPTY = Object.freeze([]), NO_STATUSES = new Map();
// ADR-107 round 5: the tags in use form one more filter group. Its options are the tags themselves (not a fixed list), so it is not part
// of LIBRARY_FILTER_OPTIONS; inside a group the chosen values combine with OR, across groups with AND, as for the other groups.
export const LIBRARY_TAG_GROUP = 'tag';
export const LIBRARY_TAG_FILTER_MAX = 64, LIBRARY_TAG_SUGGESTIONS = 8, LIBRARY_RESULT_MS = 12000;
const GROUPS = Object.freeze([...LIBRARY_FILTER_GROUPS, LIBRARY_TAG_GROUP]);
const NO_FILTERS = Object.freeze(Object.fromEntries(GROUPS.map(group => [group, EMPTY])));
const NO_DRAFTS = Object.freeze({}), NO_LINKS = Object.freeze({}), NO_PICKS = Object.freeze({}), NO_PROXIES = Object.freeze({ status: 'idle', profiles: EMPTY, connectedId: null });
const NO_TRASH = Object.freeze({ status: 'idle', items: EMPTY });
const NO_PROXIES_LOADING = Object.freeze({ status: 'loading', profiles: EMPTY, connectedId: null }), UNAVAILABLE_PROXIES = Object.freeze({ status: 'unavailable', profiles: EMPTY, connectedId: null });
const REASON_ID = 'fp-library-peek-reason', API_PROFILE_NOTE_LIMIT = PROFILE_META_LIMITS.note, PEEK_ID = 'fp-library-peek', MENU_ID = 'fp-library-menu', FILTERS_ID = 'fp-library-filters', KEYS_ID = 'fp-library-keys', NAME_ERROR_ID = 'fp-library-name-error', RENAME_ERROR_ID = 'fp-library-rename-error';
const SYSTEM_CLOCK = Object.freeze({ now: () => Date.now(), set: (task, ms) => globalThis.setTimeout(task, ms), clear: handle => globalThis.clearTimeout(handle) });
// Fit hints are computed while the browser is idle; without requestIdleCallback (unit tests) rows wait and the Peek computes its own.
function idleDefer(task) {
  const request = globalThis.requestIdleCallback, cancel = globalThis.cancelIdleCallback;
  if (typeof request !== 'function') return null;
  const handle = request.call(globalThis, deadline => task(deadline), { timeout: 2000 });
  return () => { try { cancel?.call(globalThis, handle); } catch { /* already ran */ } };
}

const clone = value => structuredClone(value);
export const attributeValue = value => String(value).replace(/["\\]/gu, '\\$&');
const compareUnits = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const omit = (object, key) => { const { [key]: dropped, ...rest } = object; void dropped; return rest; };
const keepKnown = (object, ids) => Object.keys(object).every(id => ids.has(id)) ? object : Object.fromEntries(Object.entries(object).filter(([id]) => ids.has(id)));
const TAG_SEPARATOR = String.fromCharCode(1);
// The tag filter shows the most used tags first (then code unit order); a tag that is switched on stays listed even when nothing has it now.
const tagOptions = (counts, chosen) => {
  const ranked = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || compareUnits(a, b)).slice(0, LIBRARY_TAG_FILTER_MAX);
  for (const tag of chosen) if (!ranked.includes(tag)) ranked.push(tag);
  return ranked;
};
const PROXY_TYPE_NAMES = Object.freeze({ socks5: 'SOCKS5', http: 'HTTP', https: 'HTTPS', vless: 'VLESS', openvpn: 'OpenVPN' });
const formatters = new Map();
// A deletion time in the UI language ("Nov 6, 2026, 9:41 AM"); a locale the engine does not know falls back to an ISO-like date.
function formatWhen(locale, milliseconds) {
  const tag = String(typeof locale === 'string' ? locale : locale?.id ?? 'en').replace('_', '-');
  try {
    let formatter = formatters.get(tag);
    if (!formatter) { formatter = new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' }); if (formatters.size >= 24) formatters.clear(); formatters.set(tag, formatter); }
    return formatter.format(milliseconds);
  } catch { return new Date(milliseconds).toISOString().slice(0, 16).split('T').join(' '); }
}
// UTF-16 bound (the contract counts code units) without splitting a surrogate pair.
function clip(text, max) {
  if (text.length <= max) return text;
  const head = text.slice(0, max), last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
}
// Same folding as the Region picker: Latin/Cyrillic/Greek combining accents dropped, typographic apostrophes unified.
export const foldText = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/gu, '').replace(/[’ʼ]/gu, "'").replace(/×/gu, 'x').toLowerCase();
export function fillTemplate(template, values) { return String(template).replace(/\{(\w+)\}/gu, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match); }
// Stored labels may hold characters the contract refuses for new names: visible text stays in <bdi>, while attribute text,
// announcements and generated names use this copy without them (same character test as the contract's apiLabelSafe).
export function sanitizeLabel(label) {
  let result = '';
  for (const char of String(label ?? '')) if (apiLabelSafe(char)) result += char;
  return result.replace(/\s+/gu, ' ').trim();
}
const plainLabel = profile => sanitizeLabel(profile?.label) || '—';
const initialOf = profile => Array.from(sanitizeLabel(profile.label))[0]?.toLocaleUpperCase() ?? '·';

// Short card names for the row facts: vendor and marketing words go, the model stays ("RTX 3060", "UHD 630", "Iris Xe").
export function shortGpuName(text) {
  if (typeof text !== 'string') return null;
  const original = text.replace(/\((?:R|TM)\)/gu, '').replace(/\s+/gu, ' ').trim();
  if (!original) return null;
  const name = original.replace(/^(?:NVIDIA|AMD|ATI|Intel)\s+/iu, '').replace(/^GeForce\s+/iu, '').replace(/^Radeon\s+(?=(?:RX|R\d|Pro|VII)\b)/iu, '')
    .replace(/\s+Laptop GPU\b/iu, ' Laptop').replace(/\bGraphics\b/giu, '').replace(/\s+/gu, ' ').replace(/\(\s+/gu, '(').replace(/\s+\)/gu, ')').trim();
  return clip(name || original, FACT_MAX);
}
// "ANGLE (Vendor, Card (0x…) Direct3D11 …, D3D11)" as Chrome prints it; any other renderer string is shortened as is.
export function rendererName(renderer) {
  if (typeof renderer !== 'string' || !renderer.trim()) return null;
  const angle = /^ANGLE \([^,]*,\s*(.+?)(?:\s*\(0x[0-9a-f]+\))?(?:\s+Direct3D[^,]*)?(?:,[^)]*)?\)$/iu.exec(renderer.trim());
  return shortGpuName(angle ? angle[1] : renderer);
}
const vendorFamily = text => typeof text !== 'string' ? null : /\bnvidia\b|geforce/iu.test(text) ? 'nvidia' : /\b(?:amd|ati|radeon)\b/iu.test(text) ? 'amd' : /\bintel\b/iu.test(text) ? 'intel' : null;
// A profile stores no preset name. Heuristic: the strongest Quick-setup preset whose own rows are Custom (generateConsistentDevice):
// Strict adds text metrics, font policy, WebGL readPixels and window geometry; Balanced adds Canvas/Audio/Math; Compatibility is identity only.
const STRICT_ROWS = Object.freeze(['canvas-text-metrics', 'webgl-readback', 'canvas-font-policy', 'screen-geometry', 'css-media']);
const RENDER_ROWS = Object.freeze(['canvas-readback', 'audio-fingerprint', 'math-transcendentals']);
export function profileProtection(profile) {
  const custom = new Set(profile.apis.filter(row => row.mode === 'custom').map(row => row.id));
  if (!custom.size) return 'none';
  if (STRICT_ROWS.some(id => custom.has(id))) return 'strict';
  return RENDER_ROWS.some(id => custom.has(id)) ? 'balanced' : 'compatibility';
}

const readers = new WeakMap(), factsCache = new WeakMap(), searchCache = new WeakMap(), contentKeys = new WeakMap(), environmentKeys = new WeakMap(), differences = new WeakMap(), fitCache = new Map();
function readerOf(profile) {
  let read = readers.get(profile);
  if (!read) {
    const rows = new Map(profile.apis.map(row => [row.id, row]));
    read = id => { const row = rows.get(id); return row?.mode === 'custom' && row.selected?.kind === 'value' ? row.selected.value : undefined; };
    readers.set(profile, read);
  }
  return read;
}
// What a saved profile claims, read from its own Custom rows (describeDevice is the panel's reader); identity-cached.
export function profileFacts(profile) {
  let facts = factsCache.get(profile); if (facts) return facts;
  const read = readerOf(profile), device = describeDevice(read), agent = read('navigator-user-agent'), hints = read('client-hints'), webgl = read('webgl');
  const edge = device.browser === 'edge';
  const fromAgent = typeof agent === 'string' ? (edge ? /\bEdg\/(\d{1,4})\./u : /\bChrome\/(\d{1,4})\./u).exec(agent)?.[1] : undefined;
  const fromHints = Array.isArray(hints?.brands) ? hints.brands.find(entry => entry?.brand === (edge ? 'Microsoft Edge' : 'Google Chrome'))?.version ?? hints.brands.find(entry => entry?.brand === 'Chromium')?.version : undefined;
  const major = Number.parseInt(fromAgent ?? fromHints ?? '', 10), card = GPU_PRESETS.find(entry => entry.id === device.gpu) ?? null;
  const width = read('screen-width'), height = read('screen-height'), renderer = typeof webgl?.unmaskedRenderer === 'string' ? webgl.unmaskedRenderer : null;
  facts = Object.freeze({
    device, os: device.os, browser: device.browser, major: Number.isSafeInteger(major) && major > 0 && major < 10000 ? major : null,
    gpuName: card ? shortGpuName(card.label) : rendererName(renderer), gpuLabel: card?.label ?? (renderer ? clip(renderer, 512) : null),
    gpuVendor: card?.vendorFamily ?? vendorFamily(webgl?.unmaskedVendor) ?? vendorFamily(renderer),
    deviceType: device.deviceType, screen: Number.isSafeInteger(width) && Number.isSafeInteger(height) ? width + ' × ' + height : null,
    region: device.region ?? null, language: typeof device.language === 'string' ? device.language : null,
    timeZone: typeof device.timezone?.timeZone === 'string' ? device.timezone.timeZone : null,
    protection: profileProtection(profile), custom: profile.apis.filter(row => row.mode === 'custom').length });
  factsCache.set(profile, facts); return facts;
}
// Short content hash for cache keys (FNV-1a in two lanes); collisions only cost a stale hint, never a write.
function hash(text) {
  let one = 0x811c9dc5, two = 0x01000193 ^ text.length;
  for (let index = 0; index < text.length; index++) { const code = text.charCodeAt(index); one = Math.imul(one ^ code, 0x01000193); two = Math.imul(two ^ code, 0x5bd1e995); }
  return (one >>> 0).toString(36) + '.' + (two >>> 0).toString(36) + '.' + text.length.toString(36);
}
function contentKey(profile) {
  let key = contentKeys.get(profile);
  if (!key) { key = profile.id + ':' + hash(JSON.stringify([profile.preset, profile.webrtcNetworkPolicy, profile.apis])); contentKeys.set(profile, key); }
  return key;
}
const hasEnvironment = environment => Boolean(environment) && typeof environment === 'object' && Object.keys(environment).length > 0;
function environmentKey(environment) {
  if (!hasEnvironment(environment)) return 'none';
  let key = environmentKeys.get(environment);
  if (!key) { key = hash(JSON.stringify(environment)); environmentKeys.set(environment, key); }
  return key;
}
// The library exactly as one window last saw it: ids, contents and labels in order.
export function libraryKey(profiles) { return profiles.map(profile => contentKey(profile) + '\u0001' + profile.label + '\u0001' + (profile.tags ?? []).join('\u0003') + '\u0001' + (profile.note ?? '')).join('\u0002'); }
const withProfile = (base, profile) => { const rows = new Map(profile.apis.map(row => [row.id, row])); return { ...base, preset: profile.preset, webrtcNetworkPolicy: profile.webrtcNetworkPolicy, apis: base.apis.map(row => rows.has(row.id) ? { ...row, ...rows.get(row.id) } : row) }; };
// fingerprintProfileIssues of the profile as if applied over `base`, against this browser; memoised by content and environment.
// `compute: false` only reads the cache. `conflicts` counts warnings; `checked` says whether this browser's snapshot was there.
export function profileFit(profile, base, environment, { compute = true } = {}) {
  const key = environmentKey(environment) + '/' + contentKey(profile);
  if (fitCache.has(key)) { const value = fitCache.get(key); fitCache.delete(key); fitCache.set(key, value); return value; }
  if (!compute) return null;
  let value;
  try {
    const issues = fingerprintProfileIssues({ ...withProfile(base, profile), fingerprintProfiles: [] }, environment ?? {}).filter(issue => ISSUE_CODES.has(issue.code))
      .map(issue => Object.freeze({ code: issue.code, severity: issue.severity === 'info' ? 'info' : 'warning', ids: Object.freeze([...(issue.ids ?? [])]), ...(typeof issue.detail?.country === 'string' ? { detail: Object.freeze({ country: issue.detail.country }) } : {}) }));
    value = Object.freeze({ issues: Object.freeze(issues), conflicts: issues.filter(issue => issue.severity === 'warning').length, checked: hasEnvironment(environment), failed: false });
  } catch { value = Object.freeze({ issues: EMPTY, conflicts: 0, checked: false, failed: true }); }
  fitCache.set(key, value);
  if (fitCache.size > LIBRARY_FIT_CACHE_MAX) fitCache.delete(fitCache.keys().next().value);
  return value;
}
// Rows (and the preset / WebRTC policy fields) that applying the profile would change in `base`, by the canonical diff.
export function profileDifference(profile, base) {
  const cached = differences.get(profile); if (cached?.base === base) return cached.count;
  let count = null;
  try { const result = diffApiConfigurations(base, withProfile(base, profile)); if (result.ok) count = new Set(result.value.map(change => change.id ?? change.field)).size; } catch { count = null; }
  differences.set(profile, { base, count }); return count;
}

// A copy of the environment whose proxy carries the country tag of the LINKED proxy of one profile (the user's own note); identity-cached so
// the fit memo, keyed by the environment, does not recompute for every row. Without a country the environment itself is used.
const derivedEnvironments = new WeakMap();
export function withProxyCountry(environment, country) {
  if (typeof country !== 'string' || !environment || typeof environment !== 'object') return environment;
  let byCountry = derivedEnvironments.get(environment);
  if (!byCountry) { byCountry = new Map(); derivedEnvironments.set(environment, byCountry); }
  let derived = byCountry.get(country);
  if (!derived) { derived = Object.freeze({ ...environment, proxy: Object.freeze({ state: environment.proxy?.state ?? 'unknown', country }) }); byCountry.set(country, derived); }
  return derived;
}
// The hint text of an issue with the country of its proxy filled in ("Germany (DE)"); a text without the placeholder is returned as is.
export function fillIssueDetail(text, issue, locale) {
  const country = issue?.detail?.country;
  return typeof country === 'string' && text.includes('{country}') ? text.replace('{country}', () => (regionName(locale, country) ?? country) + ' (' + country + ')') : text;
}
// A profile that comes back from the trash (or the Undo line) may hold texts the contract now refuses for new ones: they return cleaned,
// an empty label gets the copy word, tags that are refused are dropped.
export function cleanProfileTexts(profile, copySuffix) {
  const label = apiLabelSafe(profile.label) ? profile.label : sanitizeLabel(profile.label) || copyLabel('', copySuffix);
  const tags = (profile.tags ?? []).filter(tag => apiLabelSafe(tag));
  const note = typeof profile.note === 'string' && !apiNoteSafe(profile.note) ? Array.from(profile.note).filter(char => apiNoteSafe(char)).join('') : profile.note ?? '';
  return { ...profile, label, tags, note };
}

export function generatedProfileId() {
  const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes);
  return 'fp-' + [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}
// "Name (copy)", "Name (copy 2)", … within the contract's 160 units; the source label is cleaned of refused characters.
export function copyLabel(label, suffix, taken = []) {
  const head = sanitizeLabel(label), word = sanitizeLabel(suffix) || 'copy', used = new Set(taken);
  for (let number = 1; number <= 999; number++) {
    const tail = '(' + word + (number > 1 ? ' ' + number : '') + ')', room = LABEL_MAX - tail.length - 1;
    const stem = room > 0 ? clip(head, room).trimEnd() : '', candidate = stem ? stem + ' ' + tail : tail;
    if (!used.has(candidate)) return candidate;
  }
  return null;
}
// Pure: a copy with a new id and a suffixed label, appended through storeFingerprintProfile (limit, duplicate id, validation).
export function duplicateFingerprintProfile(configuration, id, suffix, newId = generatedProfileId()) {
  const checked = validateApiConfiguration(configuration); if (!checked.ok) throw new FingerprintProfileError('invalid-profile');
  const source = checked.value.fingerprintProfiles.find(item => item.id === id); if (!source) throw new FingerprintProfileError('missing-profile');
  const label = copyLabel(source.label, suffix, checked.value.fingerprintProfiles.map(item => item.label)); if (!label) throw new FingerprintProfileError('invalid-value');
  const profile = { ...clone(source), id: newId, label };
  return { configuration: storeFingerprintProfile(checked.value, profile), profile };
}
// Pure Undo: puts a deleted profile back at its old position (clamped). It refuses rather than replaces: an existing id,
// a full library, a refused label or an invalid result throw, so a re-insert is never blind.
export function restoreFingerprintProfile(configuration, profile, index) {
  const checked = validateApiConfiguration(configuration); if (!checked.ok) throw new FingerprintProfileError('invalid-profile');
  const library = checked.value.fingerprintProfiles, id = profile && typeof profile === 'object' ? profile.id : undefined;
  if (typeof id !== 'string') throw new FingerprintProfileError('invalid-profile');
  if (library.some(item => item.id === id)) throw new FingerprintProfileError('duplicate-profile');
  if (library.length >= API_CONFIGURATION_MAX_PROFILES) throw new FingerprintProfileError('profile-limit');
  if (!apiLabelSafe(profile.label)) throw new FingerprintProfileError('unsafe-label');
  const at = Number.isSafeInteger(index) ? Math.min(Math.max(index, 0), library.length) : library.length;
  const result = validateApiConfiguration({ ...checked.value, fingerprintProfiles: [...library.slice(0, at), profile, ...library.slice(at)] });
  if (!result.ok) throw new FingerprintProfileError('invalid-profile');
  return result.value;
}
// Every query word must start a word of the profile's facts; when nothing matches that way (CJK, mid-word digits) any
// substring of the folded text counts.
export function searchProfiles(entries, query) {
  const tokens = foldText(String(query ?? '').slice(0, SEARCH_MAX)).split(/\s+/u).filter(Boolean);
  if (!tokens.length) return entries.map(entry => entry.profile);
  const prefixed = entries.filter(entry => tokens.every(token => entry.words.some(word => word.startsWith(token))));
  return (prefixed.length ? prefixed : entries.filter(entry => tokens.every(token => entry.text.includes(token)))).map(entry => entry.profile);
}
const osName = os => os === 'windows-11' ? 'Windows 11' : os === 'windows-10' ? 'Windows 10' : null;
const issueText = (code, dwords, translate) => { const key = 'issue_' + code.replaceAll('-', '_'); return dwords[key] || translate('fingerprint_' + key); };
const isRtl = element => { try { return globalThis.getComputedStyle?.(element)?.direction === 'rtl'; } catch { return false; } };

// `Icon` is the panel's icon component; hooks come from the host (Preact in Options, positional fakes in unit tests).
export function createFingerprintLibraryUi({ h, useState, useEffect, useRef, useLocale, translate, Icon, clock = SYSTEM_CLOCK, defer = idleDefer }) {
  const t = key => translate('fingerprint_' + key), editor = key => translate('antidetect_editor_' + key);
  // Own stroke glyphs in the shared icon style (24-unit box, 1.6 stroke, round caps).
  const GLYPHS = { check: 'M5 12.5 9.5 17 19 7.5', close: 'M6.5 6.5l11 11m0-11-11 11', more: 'M5.5 12h.01M12 12h.01M18.5 12h.01', filter: 'M4 5.5h16l-6.2 7.4V19l-3.6 1.5v-7.6Z', undo: 'M9 14.5 4.5 10 9 5.5M4.5 10H14a5.5 5.5 0 0 1 0 11h-3', copy: 'M9 9h10v10H9ZM15 9V5H5v10h4' };
  function Glyph({ name, size = 16 }) {
    return h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': name === 'more' ? 2.8 : 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true, focusable: 'false', children: h('path', { d: GLYPHS[name] }) });
  }
  function heading(title, icon) { return h('h4', { class: 'fingerprint-heading', children: [h('span', { class: 'fingerprint-icon fingerprint-icon--' + icon, children: h(Icon, { name: icon }) }), title] }); }
  // Template text with the profile name isolated in <bdi>.
  function rich(template, label) {
    const parts = String(template).split('{name}');
    return parts.flatMap((part, index) => index ? [h('bdi', { key: 'name' + index, class: 'fingerprint-library__name', children: label }), part] : [part]).filter(part => part !== '');
  }

  // Called by the panel once per render, unconditionally (its hooks belong to the panel); returns [card slot, library] or null.
  function FingerprintLibrary({ visible = true, saved = null, draft = null, savedRef, draftRef, statuses = NO_STATUSES, busy = false, locked = false, dirty = false,
    commit, stage, setError, safeError = () => 'antidetect_failed', card = () => null, onRandomize = null, onImport = null, layout = null,
    // ADR-107 round 5: the stores come from the panel's controller (null = the feature is not offered); onTemporary(profile) starts a temporary profile.
    trash = null, bundles = null, proxies = null, onTemporary = null }) {
    const locale = useLocale(), words = fingerprintLibraryLabels(locale), dwords = fingerprintDeviceLabels(locale), iw = fingerprintIdentityLabels(locale);
    const [query, setQuery] = useState(''), [filters, setFilters] = useState(NO_FILTERS), [filtersOpen, setFiltersOpen] = useState(false), [saveName, setSaveName] = useState(''),
      [focus, setFocus] = useState(null), [peekId, setPeekId] = useState(null), [menuOpen, setMenuOpen] = useState(false), [renaming, setRenaming] = useState(null),
      [fieldError, setFieldError] = useState(null), [undo, setUndo] = useState(null), [undoPaused, setUndoPaused] = useState(false), [notice, setNotice] = useState(null),
      [, setFitTick] = useState(0), [wide, setWide] = useState(true), [focusTick, setFocusTick] = useState(0);
    // Round 5: the trash view and its data, the open confirmation, the tag/note drafts per profile, the profile-to-proxy links, the saved proxies,
    // a pending "share this exit" pick per profile and the outcome of the last "Apply with proxy" / "Apply temporarily".
    const [trashView, setTrashView] = useState(false), [trashData, setTrashData] = useState(NO_TRASH), [trashConfirm, setTrashConfirm] = useState(null), [drafts, setDrafts] = useState(NO_DRAFTS),
      [links, setLinks] = useState(NO_LINKS), [proxyInfo, setProxyInfo] = useState(NO_PROXIES), [picks, setPicks] = useState(NO_PICKS), [outcome, setOutcome] = useState(null);
    const rootRef = useRef(null), searchRef = useRef(null), nameRef = useRef(null), renameRef = useRef(null), menuRef = useRef(null), menuButtonRef = useRef(null), toggleRef = useRef(null),
      pendingFocus = useRef(null), undoTimer = useRef({ handle: null, remaining: 0, started: 0 }), noticeTimer = useRef(null), hover = useRef({ pointer: false, focus: false }), latest = useRef(null), outcomeTimer = useRef(null), draftsRef = useRef(NO_DRAFTS);
    const profiles = saved?.configuration.fingerprintProfiles ?? EMPTY, base = saved?.configuration ?? null, environment = saved?.environment;
    const realMajor = Number.isSafeInteger(environment?.uaMajor) ? environment.uaMajor : null, mounted = Boolean(visible && saved), wideNow = layout ? layout === 'wide' : wide;
    // The linked proxy of a profile (when the proxy list is known) and its country tag, which the fit hints compare with the profile's rows.
    const linkedProxy = profile => { const id = links[profile.id]; return id ? proxyInfo.profiles.find(entry => entry.id === id) ?? null : null; };
    const envFor = profile => withProxyCountry(environment, linkedProxy(profile)?.country);
    const fitOf = profile => base ? profileFit(profile, base, envFor(profile), { compute: false }) : null;
    const presetLabel = value => value === 'none' ? dwords.value_browser : dwords['preset_' + value] ?? value;
    const optionLabel = (group, value) => group === LIBRARY_TAG_GROUP ? value : value === 'other' ? words.other : group === 'os' ? osName(value) : group === 'browser' ? (value === 'edge' ? 'Microsoft Edge' : 'Google Chrome')
      : group === 'gpu' ? { nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel' }[value] : group === 'device' ? (value === 'laptop' ? dwords.device_laptop : dwords.device_desktop)
        : group === 'preset' ? presetLabel(value) : { applied: words.applied, preview: words.inPreview, conflicts: words.withConflicts, fit: words.fit }[value];
    const groupLabel = group => ({ os: words.filterOs, browser: words.filterBrowser, gpu: words.filterGpu, device: words.filterDevice, preset: words.filterPreset, status: words.status, [LIBRARY_TAG_GROUP]: iw.filterTag })[group];
    function groupValues(profile) {
      const facts = profileFacts(profile), status = statuses.get(profile.id), fit = fitOf(profile);
      const fitValue = !fit || fit.failed ? null : fit.conflicts > 0 ? 'conflicts' : fit.checked ? 'fit' : null;
      return { os: [facts.os ?? 'other'], browser: [facts.browser ?? 'other'], gpu: [facts.gpuVendor ?? 'other'], device: [facts.deviceType ?? 'other'], preset: [facts.protection], [LIBRARY_TAG_GROUP]: profile.tags ?? EMPTY,
        status: [...(status === 'applied' || status === 'preview' ? [status] : []), ...(fitValue ? [fitValue] : [])] };
    }
    function searchEntry(profile) {
      let byLocale = searchCache.get(profile); if (!byLocale) { byLocale = new Map(); searchCache.set(profile, byLocale); }
      const tag = typeof locale === 'string' ? locale : locale?.id ?? 'en'; let entry = byLocale.get(tag);
      if (!entry) {
        const facts = profileFacts(profile), place = facts.region ? [facts.region, regionName(locale, facts.region), regionName('en', facts.region)] : [];
        const text = foldText([profile.label, profile.id, osName(facts.os), facts.browser === 'edge' ? 'Microsoft Edge' : facts.browser === 'chrome' ? 'Google Chrome' : null, facts.major,
          facts.gpuLabel, facts.gpuName, facts.screen, facts.screen?.replace(' × ', 'x'), ...place, facts.language, facts.timeZone, presetLabel(facts.protection),
          facts.deviceType ? optionLabel('device', facts.deviceType) : null, ...(profile.tags ?? []), profile.note ?? ''].filter(part => part !== null && part !== undefined && part !== '').join(' \u0001 '));
        entry = { profile, text, words: text.split(/[^\p{L}\p{N}]+/u).filter(Boolean) };
        if (byLocale.size >= 24) byLocale.clear();
        byLocale.set(tag, entry);
      }
      return entry;
    }
    const valuesById = new Map(profiles.map(profile => [profile.id, groupValues(profile)]));
    const searched = query.trim() ? searchProfiles(profiles.map(searchEntry), query) : profiles;
    const passes = (profile, skip) => GROUPS.every(group => group === skip || !filters[group].length || valuesById.get(profile.id)[group].some(value => filters[group].includes(value)));
    const rows = searched.filter(profile => passes(profile, null)), active = GROUPS.flatMap(group => filters[group].map(value => [group, value]));
    const peekProfile = peekId ? profiles.find(profile => profile.id === peekId) ?? null : null;
    const enabledColumns = [true, !busy, !locked, !locked];
    const current = focus && rows.some(profile => profile.id === focus.id) ? { id: focus.id, col: enabledColumns[focus.col] ? focus.col : 0 } : rows.length ? { id: rows[0].id, col: 0 } : null;
    latest.current = { rows, profiles, busy, locked, dirty, commit, stage, setError, safeError, saveName, renaming, undo, peekId, words, menuOpen, iw, trash, bundles, proxies, onTemporary, drafts, links, proxyInfo, picks, trashData, trashConfirm };

    // Focus moves at once when the target is already in the DOM (fast key repeat never acts on a stale row); otherwise
    // the effect below focuses it after the next render (a restored or newly created row).
    const moveFocus = (id, col = 0) => {
      setFocus({ id, col });
      let element = null; try { element = rootRef.current?.querySelector?.('[data-profile-focus="' + id + ':' + col + '"]') ?? null; } catch { element = null; }
      if (element && typeof element.focus === 'function') { element.focus(); return; }
      pendingFocus.current = id + ':' + col; setFocusTick(value => value + 1);
    };
    const focusLater = target => { pendingFocus.current = target; setFocusTick(value => value + 1); };
    // Callback refs focus an element the moment it mounts (the rename field, the opened menu) instead of a frame later.
    const mountRef = (holder, target, pick = element => element) => element => {
      holder.current = element;
      if (element && pendingFocus.current === target) { pendingFocus.current = null; try { pick(element)?.focus?.(); } catch { /* detached meanwhile */ } }
    };
    const noteFocus = (id, col) => { if (!focus || focus.id !== id || focus.col !== col) setFocus({ id, col }); };
    function showNotice(kind, text) {
      if (noticeTimer.current !== null) clock.clear(noticeTimer.current);
      setNotice({ kind, text }); noticeTimer.current = clock.set(() => { noticeTimer.current = null; setNotice(null); }, LIBRARY_UNDO_MS);
    }
    // --- Undo timer: LIBRARY_UNDO_MS of visible time, paused while the line is hovered or holds focus. ---
    function clearUndoTimer() { const timer = undoTimer.current; if (timer.handle !== null) clock.clear(timer.handle); timer.handle = null; }
    function resumeUndoTimer() {
      const timer = undoTimer.current; if (timer.handle !== null || timer.remaining <= 0) return;
      timer.started = clock.now(); timer.handle = clock.set(() => { timer.handle = null; timer.remaining = 0; setUndo(null); setUndoPaused(false); }, timer.remaining);
    }
    function pauseUndoTimer() { const timer = undoTimer.current; if (timer.handle === null) return; clock.clear(timer.handle); timer.handle = null; timer.remaining = Math.max(0, timer.remaining - (clock.now() - timer.started)); }
    function armUndo(entry) {
      clearUndoTimer(); undoTimer.current = { handle: null, remaining: LIBRARY_UNDO_MS, started: 0 }; hover.current = { pointer: false, focus: false };
      setUndo(entry); setUndoPaused(false); setNotice(null); resumeUndoTimer();
    }
    function dropUndo() { clearUndoTimer(); undoTimer.current.remaining = 0; setUndo(null); setUndoPaused(false); }
    function undoHover(kind, on) {
      hover.current = { ...hover.current, [kind]: on };
      const paused = hover.current.pointer || hover.current.focus; setUndoPaused(paused);
      if (paused) pauseUndoTimer(); else resumeUndoTimer();
    }

    // --- Actions. Async handlers read the latest props through `latest`; every write is the panel's CAS commit. ---
    function loadProfile(id, quiet = false) {
      const state = latest.current; if (state.busy || !draftRef?.current || !id) return false;
      const profile = savedRef?.current?.configuration.fingerprintProfiles.find(item => item.id === id);
      if (!profile) { state.setError('fingerprint_missing_profile'); return false; }
      try {
        const preview = draftRef.current;
        // FP05 / ADR-083: resolve the displayed saved snapshot, retaining the pending book.
        const applied = applyFingerprintProfile({ ...preview, fingerprintProfiles: [profile] }, profile.id);
        const checked = validateApiConfiguration({ ...applied, fingerprintProfiles: preview.fingerprintProfiles });
        if (!checked.ok) { state.setError('antidetect_invalid'); return false; }
        state.stage(checked.value);
        if (!quiet) announce(fillTemplate(state.words.loaded, { name: plainLabel(profile) }));
        return true;
      } catch (failure) { state.setError(state.safeError(failure)); return false; }
    }
    async function saveProfile() {
      const state = latest.current; if (state.locked || !draftRef?.current) return;
      const name = state.saveName.trim();
      if (!name) { state.setError('antidetect_editor_nameRequired'); return; }
      if (!apiLabelSafe(name)) { setFieldError({ field: 'save' }); focusLater('name'); return; }
      try {
        const profile = snapshotFingerprintProfile(draftRef.current, name);
        if (await state.commit(storeFingerprintProfile(savedRef.current.configuration, profile), true)) { setSaveName(''); setFieldError(null); setFocus({ id: profile.id, col: 0 }); }
      } catch (failure) { if (failure?.code === 'unsafe-label') setFieldError({ field: 'save' }); else state.setError(state.safeError(failure)); }
    }
    function clearAll() { setQuery(''); setFilters(NO_FILTERS); }
    function startRename(profile) {
      const state = latest.current; if (state.locked) return;
      if (!state.rows.some(item => item.id === profile.id)) clearAll();
      const text = sanitizeLabel(profile.label);
      setRenaming({ id: profile.id, text, initial: text, original: profile.label }); setFieldError(null); setMenuOpen(false); setFocus({ id: profile.id, col: 0 }); focusLater('rename');
    }
    function cancelRename(refocus = true) { const editing = latest.current.renaming; setRenaming(null); setFieldError(null); if (refocus && editing) moveFocus(editing.id, 0); }
    async function saveRename() {
      const state = latest.current, editing = state.renaming; if (!editing || state.locked) return;
      const name = editing.text.trim();
      if (!name) { state.setError('antidetect_editor_nameRequired'); return; }
      if (name === editing.original) { cancelRename(); return; }
      if (!apiLabelSafe(name)) { setFieldError({ field: 'rename' }); focusLater('rename'); return; }
      try {
        const next = renameFingerprintProfile(savedRef.current.configuration, editing.id, name);
        if (await state.commit(next, true)) { setRenaming(null); setFieldError(null); moveFocus(editing.id, 0); announce(fillTemplate(state.words.renamed, { name: sanitizeLabel(name) })); }
      } catch (failure) { if (failure?.code === 'unsafe-label') setFieldError({ field: 'rename' }); else state.setError(state.safeError(failure)); }
    }
    async function duplicateProfile(profile) {
      const state = latest.current; if (state.locked || !savedRef?.current) return;
      setMenuOpen(false);
      let result; try { result = duplicateFingerprintProfile(savedRef.current.configuration, profile.id, state.words.copySuffix); } catch (failure) { state.setError(state.safeError(failure)); return; }
      if (await state.commit(result.configuration, true)) { announce(fillTemplate(state.words.duplicated, { name: plainLabel(result.profile) })); moveFocus(result.profile.id, 0); }
    }
    // Delete: the trash copy is written FIRST, then the profile leaves the library through the panel's CAS commit. A failed trash write
    // leaves the profile where it is; a failed commit takes the trash copy back (a copy left behind is dropped by the next trash read,
    // because the same profile is still in the library). The Undo line below restores from the profile snapshot held here.
    async function deleteProfile(profile) {
      const state = latest.current; if (state.locked || !savedRef?.current) return;
      const library = savedRef.current.configuration.fingerprintProfiles, index = library.findIndex(item => item.id === profile.id);
      if (index < 0) { state.setError('fingerprint_missing_profile'); return; }
      const position = state.rows.findIndex(item => item.id === profile.id), neighbour = position < 0 ? null : state.rows[position + 1]?.id ?? state.rows[position - 1]?.id ?? null;
      const snapshot = clone(library[index]);
      let next; try { next = deleteFingerprintProfile(savedRef.current.configuration, profile.id); } catch (failure) { state.setError(state.safeError(failure)); return; }
      let kept = null;
      if (state.trash) {
        try { kept = await state.trash.add(snapshot, index, library); }
        catch { const message = fillTemplate(state.iw.trashFailed, { name: plainLabel(snapshot) }); showNotice('trash', message); announce(message, { assertive: true }); return; }
        setTrashData({ status: 'ready', items: kept.items });
      }
      if (!await state.commit(next, true)) { if (kept) void state.trash.remove(snapshot.id).then(items => setTrashData({ status: 'ready', items }), () => {}); return; }
      setMenuOpen(false);
      if (latest.current.renaming?.id === profile.id) { setRenaming(null); setFieldError(null); }
      if (latest.current.peekId === profile.id) setPeekId(null);
      writeDrafts(omit(draftsRef.current, profile.id));
      armUndo({ profile: snapshot, index, key: libraryKey(savedRef.current.configuration.fingerprintProfiles), trashed: Boolean(kept), evicted: (kept?.evicted ?? 0) > 0 });
      announce(fillTemplate(state.words.deleted, { name: plainLabel(snapshot) }) + ' ' + state.words.undoHint + (kept ? ' ' + state.iw.trashKept : '') + (kept?.evicted ? ' ' + state.iw.trashEvicted : ''));
      if (neighbour) moveFocus(neighbour, 0); else focusLater('search');
    }
    async function undoDelete() {
      const state = latest.current, entry = state.undo; if (!entry || state.locked) return;
      const stored = savedRef?.current;
      // Another window (or this one) changed the library since the deletion: say so and keep the newer library as it is.
      if (!stored || libraryKey(stored.configuration.fingerprintProfiles) !== entry.key) { dropUndo(); showNotice('stale', state.words.undoStale); announce(state.words.undoStale); return; }
      // A stored label the contract would now refuse comes back cleaned (an empty result gets the copy word).
      const profile = cleanProfileTexts(entry.profile, state.words.copySuffix);
      let next; try { next = restoreFingerprintProfile(stored.configuration, profile, entry.index); } catch (failure) { dropUndo(); state.setError(state.safeError(failure)); return; }
      pauseUndoTimer();
      if (!await state.commit(next, true)) { resumeUndoTimer(); return; }
      dropUndo(); announce(fillTemplate(state.words.restored, { name: plainLabel(profile) })); moveFocus(profile.id, 0);
      // The trash copy has done its job; a failure here is harmless (the next trash read drops a copy of a profile that is back unchanged).
      if (entry.trashed && state.trash) void state.trash.remove(profile.id).then(items => setTrashData({ status: 'ready', items }), () => {});
    }

    // --- Trash view (ADR-107 round 5): Restore, Delete forever (confirmed), Empty trash (confirmed). ---
    function toggleTrash() { setTrashConfirm(null); setMenuOpen(false); setTrashView(open => !open); focusLater('sel:[data-profile-trash-toggle]'); }
    async function dropTrashed(id) {
      const state = latest.current; if (!state.trash) return;
      try { setTrashData({ status: 'ready', items: await state.trash.remove(id) }); } catch { /* the next trash read prunes it */ }
    }
    // After an item leaves the trash, focus goes to the Restore button of its neighbour, else back to the Trash toggle.
    function focusAfterTrash(id) {
      const items = latest.current.trashData.items, at = items.findIndex(item => item.profile.id === id), next = items[at + 1] ?? items[at - 1] ?? null;
      focusLater(next ? 'sel:[data-profile-trash-restore="' + next.profile.id + '"]' : 'sel:[data-profile-trash-toggle]');
    }
    // The id is free: the profile returns as it was; another profile holds the id: it returns under a new id and never replaces that one;
    // this very profile is already back: only the trash copy goes. A full library keeps the profile in the trash with the usual limit error.
    async function restoreTrashed(item) {
      const state = latest.current; if (state.locked || !savedRef?.current) return;
      const library = savedRef.current.configuration.fingerprintProfiles, plan = restorePlan(library, item), name = plainLabel(item.profile);
      if (plan === 'present') { focusAfterTrash(item.profile.id); await dropTrashed(item.profile.id); announce(fillTemplate(state.iw.trashAlreadyBack, { name })); return; }
      const cleaned = cleanProfileTexts(item.profile, state.words.copySuffix), profile = plan === 'fresh' ? { ...cleaned, id: generatedProfileId() } : cleaned;
      let next; try { next = restoreFingerprintProfile(savedRef.current.configuration, profile, item.index); } catch (failure) { state.setError(state.safeError(failure)); return; }
      if (!await state.commit(next, true)) return;
      focusAfterTrash(item.profile.id); await dropTrashed(item.profile.id);
      announce(fillTemplate(state.iw.trashRestored, { name }));
    }
    function askTrash(confirm) { setTrashConfirm(confirm); focusLater('sel:[data-profile-trash-confirm-cancel]'); }
    function cancelTrashConfirm() {
      const asked = latest.current.trashConfirm; setTrashConfirm(null);
      focusLater(asked?.kind === 'one' ? 'sel:[data-profile-trash-delete="' + asked.id + '"]' : 'sel:[data-profile-trash-empty]');
    }
    async function deleteForever(item) {
      const state = latest.current; if (!state.trash) return;
      setTrashConfirm(null); focusAfterTrash(item.profile.id);
      try { setTrashData({ status: 'ready', items: await state.trash.remove(item.profile.id) }); announce(fillTemplate(state.iw.trashRemoved, { name: plainLabel(item.profile) })); }
      catch { announce(state.iw.trashUnreadable, { assertive: true }); }
    }
    async function emptyTrash() {
      const state = latest.current; if (!state.trash) return;
      setTrashConfirm(null); focusLater('sel:[data-profile-trash-toggle]');
      try { await state.trash.empty(); setTrashData({ status: 'ready', items: EMPTY }); announce(state.iw.trashEmptied); }
      catch { announce(state.iw.trashUnreadable, { assertive: true }); }
    }

    // --- Tags and notes (ADR-107 round 5). A draft per profile holds the tags, the note and the text of the tag field; nothing is
    // written until Save (or Ctrl/Cmd+S in the section). The pure helpers of fingerprint-profiles.js normalize and validate every step. ---
    // Every change goes through here: the ref is current at once, the state repaints.
    const writeDrafts = next => { draftsRef.current = next; setDrafts(next); };
    const seedDraft = profile => ({ tags: [...(profile.tags ?? [])], note: profile.note ?? '', input: '', error: null });
    const draftDirty = (profile, draft) => Boolean(draft) && (draft.input.trim() !== '' || draft.note !== (profile.note ?? '') || draft.tags.join(TAG_SEPARATOR) !== (profile.tags ?? []).join(TAG_SEPARATOR));
    function patchDraft(profile, patch) { const previous = draftsRef.current; writeDrafts({ ...previous, [profile.id]: { ...(previous[profile.id] ?? seedDraft(profile)), ...patch } }); }
    // Adds the given texts to the draft's tags (a pasted list adds several); `rest` stays in the field. Duplicates collapse; limits and
    // refused characters become the field's message.
    function addTags(profile, texts, rest = '') {
      const state = latest.current, draft = draftsRef.current[profile.id] ?? seedDraft(profile), limit = PROFILE_META_LIMITS.tags;
      let tags; try { tags = normalizeProfileTags([...draft.tags, ...texts], { known: [...(profile.tags ?? []), ...draft.tags] }); }
      catch (failure) { const key = failure?.code === 'unsafe-label' ? 'tagUnsafe' : 'tagLimit'; patchDraft(profile, { error: key }); announce(key === 'tagLimit' ? fillTemplate(state.iw.tagLimit, { max: limit }) : state.iw.tagUnsafe); return false; }
      const added = tags.filter(tag => !draft.tags.includes(tag));
      patchDraft(profile, { tags, input: rest, error: null });
      if (added.length) announce(fillTemplate(state.iw.tagAdded, { name: added.at(-1), n: tags.length, max: limit }));
      else if (texts.some(entry => entry.trim())) announce(fillTemplate(state.iw.tagDuplicate, { name: texts.find(entry => entry.trim()).trim() }));
      return added.length > 0;
    }
    function removeTag(profile, tag) {
      const state = latest.current, draft = draftsRef.current[profile.id] ?? seedDraft(profile);
      patchDraft(profile, { tags: draft.tags.filter(item => item !== tag), error: null }); announce(fillTemplate(state.iw.tagRemoved, { name: tag }));
    }
    function onTagInput(profile, value) {
      const parts = value.split(',');
      if (parts.length === 1) { patchDraft(profile, { input: value, error: null }); return; }
      addTags(profile, parts.slice(0, -1), parts.at(-1));
    }
    function onTagKey(profile, event) {
      const draft = draftsRef.current[profile.id] ?? seedDraft(profile);
      if ((event.key === 'Enter' || event.key === ',') && !event.isComposing) { event.preventDefault(); if (draft.input.trim()) addTags(profile, [draft.input]); }
      else if (event.key === 'Backspace' && draft.input === '' && draft.tags.length && !event.isComposing) { event.preventDefault(); removeTag(profile, draft.tags.at(-1)); }
      else if (event.key === 'Escape' && draft.input) { event.preventDefault(); event.stopPropagation(); patchDraft(profile, { input: '', error: null }); }
    }
    function onNoteInput(profile, value) {
      let error = null; try { normalizeProfileNote(value, { known: profile.note }); } catch (failure) { error = failure?.code === 'unsafe-label' ? 'noteUnsafe' : null; }
      patchDraft(profile, { note: value, error });
    }
    function discardDraft(profile) { writeDrafts(omit(draftsRef.current, profile.id)); }
    async function saveMeta(profile) {
      const state = latest.current, draft = draftsRef.current[profile.id]; if (!draft || state.locked || !savedRef?.current) return false;
      let tags = draft.tags;
      if (draft.input.trim()) {
        try { tags = normalizeProfileTags([...tags, draft.input], { known: [...(profile.tags ?? []), ...tags] }); }
        catch (failure) { patchDraft(profile, { error: failure?.code === 'unsafe-label' ? 'tagUnsafe' : 'tagLimit' }); return false; }
      }
      let next; try { next = editProfileMeta(savedRef.current.configuration, profile.id, { tags, note: draft.note }); }
      catch (failure) {
        if (failure?.code === 'missing-profile') { state.setError(state.safeError(failure)); return false; }
        patchDraft(profile, { error: failure?.code === 'unsafe-label' ? 'noteUnsafe' : 'tagLimit' }); return false;
      }
      if (!await state.commit(next, true)) return false;
      writeDrafts(omit(draftsRef.current, profile.id));
      announce(fillTemplate(state.iw.metaSaved, { name: plainLabel(profile) })); return true;
    }

    // --- Profile-to-proxy link and the two "apply" actions of the Peek (ADR-107 round 5). ---
    const proxyName = (state, id) => state.proxyInfo.profiles.find(entry => entry.id === id)?.name || id;
    function showOutcome(value) {
      if (outcomeTimer.current !== null) clock.clear(outcomeTimer.current);
      setOutcome(value); outcomeTimer.current = clock.set(() => { outcomeTimer.current = null; setOutcome(null); }, LIBRARY_RESULT_MS);
    }
    // Writes (proxy id) or removes (null) the link; dead links are pruned in the same write. The links never leave this computer.
    async function writeLink(profile, proxy) {
      const state = latest.current; if (!state.bundles) return;
      const context = { profileIds: new Set(state.profiles.map(item => item.id)), ...(state.proxyInfo.status === 'ready' ? { proxyIds: new Set(state.proxyInfo.profiles.map(item => item.id)) } : {}) };
      try {
        const next = proxy ? await state.bundles.link(profile.id, proxy, context) : await state.bundles.unlink(profile.id, context);
        setLinks(next); setPicks(previous => omit(previous, profile.id));
        announce(proxy ? fillTemplate(state.iw.bundleLinked, { proxy: proxyName(state, proxy) }) : state.iw.bundleUnlinked);
      } catch { showNotice('bundle', state.iw.bundleLinkFailed); announce(state.iw.bundleLinkFailed, { assertive: true }); }
    }
    // A proxy already linked to another profile needs the explicit "share this exit on purpose" confirmation before it is linked again.
    function chooseProxy(profile, value) {
      const state = latest.current;
      if (!value) { setPicks(previous => omit(previous, profile.id)); void writeLink(profile, null); return; }
      if (value === state.links[profile.id]) { setPicks(previous => omit(previous, profile.id)); return; }
      if (profilesOfProxy(state.links, value).some(id => id !== profile.id)) { setPicks(previous => ({ ...previous, [profile.id]: { proxy: value, confirmed: false } })); return; }
      void writeLink(profile, value);
    }
    async function refreshProxies() {
      const state = latest.current; if (!state.proxies) return;
      setProxyInfo(NO_PROXIES_LOADING);
      try { const list = await state.proxies.load({ fresh: true }); setProxyInfo(list ? { status: 'ready', ...list } : UNAVAILABLE_PROXIES); } catch { setProxyInfo(UNAVAILABLE_PROXIES); }
    }
    // The profile is applied through the normal commit; only when that succeeded the linked saved proxy is connected. Your click is the explicit
    // connect (permissions are asked inside it); no setting of the Proxy workspace changes. The two outcomes are reported separately.
    async function applyWithProxy(profile) {
      const state = latest.current; if (state.busy || state.locked || state.dirty || !state.proxies || !draftRef?.current) return;
      const proxy = state.proxyInfo.profiles.find(entry => entry.id === state.links[profile.id]); if (!proxy) return;
      let attempt; try { attempt = state.proxies.begin(proxy); } catch { attempt = null; }
      const staged = loadProfile(profile.id, true), applied = staged && await state.commit(draftRef.current);
      if (!applied) { attempt?.cancel(); return; }
      const name = plainLabel(profile); announce(fillTemplate(state.iw.bundleProfileDone, { name }));
      if (!attempt) { showOutcome({ id: profile.id, profile: true, proxy: { ok: false, code: 'operation-failed' } }); announce(fillTemplate(state.iw.bundleProxyFail, { code: 'operation-failed' }), { assertive: true }); return; }
      const proxyResult = await attempt.finish();
      showOutcome({ id: profile.id, profile: true, proxy: proxyResult, proxyName: proxy.name || proxy.id });
      announce(proxyResult.ok ? fillTemplate(state.iw.bundleProxyDone, { proxy: proxy.name || proxy.id }) : fillTemplate(state.iw.bundleProxyFail, { code: proxyResult.code }), { assertive: !proxyResult.ok });
    }
    async function applyTemporarily(profile) {
      const state = latest.current; if (state.busy || state.locked || state.dirty || !state.onTemporary) return;
      showOutcome(null);
      await state.onTemporary(profile);
    }
    function togglePeek(profile) { setMenuOpen(false); setPeekId(open => open === profile.id ? null : profile.id); setFocus({ id: profile.id, col: 0 }); }
    function closePeek(refocus) { const id = latest.current.peekId; setMenuOpen(false); setPeekId(null); if (refocus && id) moveFocus(id, 0); }
    function toggleFilter(group, value) {
      setFilters(previous => ({ ...previous, [group]: previous[group].includes(value) ? previous[group].filter(item => item !== value) : [...previous[group], value] }));
    }
    function removeChip(group, value) {
      const index = active.findIndex(([g, v]) => g === group && v === value), next = active[index + 1] ?? active[index - 1] ?? null;
      toggleFilter(group, value); focusLater(next ? 'chip:' + next[0] + ':' + next[1] : 'filters-toggle');
    }

    // --- Keyboard: the list is one Tab stop; arrows move between rows and the row's buttons (mirrored in RTL). ---
    function onCellKey(event, profile, col) {
      const key = event.key, modifier = event.ctrlKey || event.metaKey, state = latest.current, list = state.rows, index = list.findIndex(item => item.id === profile.id);
      if (modifier && !event.altKey && !event.shiftKey && (key === 'z' || key === 'Z' || event.code === 'KeyZ')) { if (state.undo) { event.preventDefault(); void undoDelete(); } return; }
      if (index < 0 || event.altKey || event.isComposing) return;
      const enabled = [true, !state.busy, !state.locked, !state.locked];
      const step = (from, delta) => { let next = from + delta; while (next >= 0 && next < COLUMNS && !enabled[next]) next += delta; return next >= 0 && next < COLUMNS ? next : from; };
      let target = null;
      if (key === 'Home' || key === 'End') target = [key === 'Home' ? 0 : list.length - 1, col];
      else if (modifier) return;
      else if (key === 'ArrowDown') target = [Math.min(index + 1, list.length - 1), col];
      else if (key === 'ArrowUp') target = [Math.max(index - 1, 0), col];
      else if (key === 'ArrowRight' || key === 'ArrowLeft') target = [index, step(col, (key === 'ArrowRight') !== isRtl(event.currentTarget) ? 1 : -1)];
      else if (key === 'F2') { event.preventDefault(); startRename(profile); return; }
      else if (key === 'Delete') { event.preventDefault(); void deleteProfile(profile); return; }
      else if (key === 'Escape') { if (state.peekId) { event.preventDefault(); closePeek(false); } return; }
      else return;
      event.preventDefault();
      const row = list[target[0]]; if (row) moveFocus(row.id, enabled[target[1]] ? target[1] : 0);
    }
    function onMenuKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); try { menuButtonRef.current?.focus?.(); } catch { /* detached */ } return; }
      if (event.key === 'Tab') { setMenuOpen(false); return; }
      const items = [...(menuRef.current?.querySelectorAll?.('[role="menuitem"]:not([disabled])') ?? [])];
      if (!items.length) return;
      const index = items.indexOf(globalThis.document?.activeElement);
      const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); items[next].focus();
    }
    function openMenu() { setMenuOpen(true); focusLater('menu'); }

    // --- Effects (all unconditional). ---
    // A profile removed elsewhere closes its Peek and its rename editor.
    useEffect(() => {
      const ids = new Set((saved?.configuration.fingerprintProfiles ?? EMPTY).map(profile => profile.id));
      if (peekId && !ids.has(peekId)) { setPeekId(null); setMenuOpen(false); }
      if (renaming && !ids.has(renaming.id)) { setRenaming(null); setFieldError(null); }
      writeDrafts(keepKnown(draftsRef.current, ids)); setPicks(previous => keepKnown(previous, ids));
    }, [saved]);
    // The trash is read (and pruned) when the library opens, when its view is toggled and whenever another page changes it.
    useEffect(() => {
      if (!mounted || !trash) return undefined;
      let stopped = false;
      const read = () => {
        setTrashData(previous => previous.status === 'idle' ? { status: 'loading', items: EMPTY } : previous);
        Promise.resolve().then(() => trash.read(latest.current.profiles)).then(items => { if (!stopped) setTrashData({ status: 'ready', items }); }, () => { if (!stopped) setTrashData({ status: 'error', items: EMPTY }); });
      };
      read();
      const stop = trash.watch?.(read);
      return () => { stopped = true; stop?.(); };
    }, [mounted, trashView]);
    // The profile-to-proxy links are read as they are; dead ones are pruned only by the next link write (a read never writes).
    useEffect(() => {
      if (!mounted || !bundles) return undefined;
      let stopped = false;
      const read = () => { Promise.resolve().then(() => bundles.read(null)).then(next => { if (!stopped) setLinks(next); }, () => {}); };
      read();
      const stop = bundles.watch?.(read);
      return () => { stopped = true; stop?.(); };
    }, [mounted]);
    // The saved proxies, once per mount (the select has a Refresh button).
    useEffect(() => {
      if (!mounted || !proxies) return undefined;
      let stopped = false;
      setProxyInfo(previous => previous.status === 'idle' ? NO_PROXIES_LOADING : previous);
      Promise.resolve().then(() => proxies.load()).then(list => { if (!stopped) setProxyInfo(list ? { status: 'ready', ...list } : UNAVAILABLE_PROXIES); }, () => { if (!stopped) setProxyInfo(UNAVAILABLE_PROXIES); });
      return () => { stopped = true; };
    }, [mounted]);
    // Fit hints in idle slices, rows of the current view first; results are cached by content, so a new revision costs nothing.
    useEffect(() => {
      if (!mounted || !base) return undefined;
      const order = [...rows, ...profiles.filter(profile => !rows.includes(profile))], queue = order.filter(profile => !profileFit(profile, base, envFor(profile), { compute: false }));
      if (!queue.length) return undefined;
      let cancel = null, stopped = false;
      const work = deadline => {
        cancel = null; if (stopped) return;
        const started = clock.now(); let done = 0;
        while (queue.length && (done === 0 || (typeof deadline?.timeRemaining === 'function' ? deadline.timeRemaining() > 2 : clock.now() - started < LIBRARY_FIT_SLICE_MS))) { const next = queue.shift(); profileFit(next, base, envFor(next)); done++; }
        setFitTick(value => value + 1);
        if (queue.length && !stopped) cancel = defer(work);
      };
      cancel = defer(work);
      return () => { stopped = true; cancel?.(); };
    }, [mounted, saved, links, proxyInfo]);
    // Side by side (wide) the Peek takes the device-card slot; stacked (narrow) it opens under its row.
    useEffect(() => {
      if (layout || !mounted) return undefined;
      const root = rootRef.current, pair = root?.parentElement, Observer = globalThis.ResizeObserver;
      if (!pair || typeof Observer !== 'function') return undefined;
      const measure = () => {
        const slot = [...pair.children].find(child => child !== root); if (!slot) return;
        const a = slot.getBoundingClientRect(), b = root.getBoundingClientRect();
        setWide(Math.abs(a.top - b.top) < 8 && (b.left >= a.right - 1 || a.left >= b.right - 1));
      };
      const observer = new Observer(measure); observer.observe(pair); measure();
      return () => observer.disconnect();
    }, [mounted, layout]);
    useEffect(() => {
      const target = pendingFocus.current; if (!target) return;
      pendingFocus.current = null;
      const root = rootRef.current, find = selector => root?.querySelector?.(selector) ?? null;
      const element = target === 'search' ? searchRef.current : target === 'name' ? nameRef.current : target === 'rename' ? renameRef.current
        : target === 'menu' ? menuRef.current?.querySelector?.('[role="menuitem"]:not([disabled])') : target === 'menu-button' ? menuButtonRef.current : target === 'filters-toggle' ? toggleRef.current
          : target.startsWith('chip:') ? find('[data-profile-filter-chip="' + attributeValue(target.slice(5)) + '"]') : target.startsWith('sel:') ? find(target.slice(4)) : find('[data-profile-focus="' + target + '"]');
      try { element?.focus?.(); } catch { /* detached meanwhile */ }
    }, [focusTick]);
    // A pointer press outside the open "…" menu closes it (focus moves on with the press).
    useEffect(() => {
      const document = globalThis.document; if (!menuOpen || typeof document?.addEventListener !== 'function') return undefined;
      const close = event => { const wrap = menuButtonRef.current?.parentElement; if (wrap && !wrap.contains(event.target)) setMenuOpen(false); };
      document.addEventListener('pointerdown', close, true);
      return () => document.removeEventListener('pointerdown', close, true);
    }, [menuOpen]);
    // Ctrl/Cmd+S saves the field being edited (rename or "Save as profile"); elsewhere the panel's own handler decides.
    useEffect(() => registerSaveShortcut(rootRef.current, event => {
      const state = latest.current, target = event?.target;
      if (state.renaming && target && target === renameRef.current) { void saveRename(); return true; }
      if (target && target === nameRef.current && state.saveName.trim() && !state.locked) { void saveProfile(); return true; }
      const section = typeof target?.closest === 'function' ? target.closest('[data-profile-meta]') : null, metaId = section?.getAttribute?.('data-profile-meta');
      const owner = metaId ? state.profiles.find(item => item.id === metaId) : null;
      if (owner && draftsRef.current[owner.id] && !state.locked) { void saveMeta(owner); return true; }
      return false;
    }), [mounted]);
    useEffect(() => registerDirtyGuard(() => {
      const state = latest.current, editing = state?.renaming;
      return Boolean(editing) && editing.text !== editing.initial || Boolean(state) && state.profiles.some(profile => draftDirty(profile, draftsRef.current[profile.id]));
    }), []);
    // The command palette offers "Load into preview" for saved profiles (current view first, at most LIBRARY_PALETTE_MAX).
    useEffect(() => registerPaletteCommands('fingerprint-library', () => {
      const state = latest.current; if (!state) return [];
      const order = [...state.rows, ...state.profiles.filter(profile => !state.rows.includes(profile))].slice(0, LIBRARY_PALETTE_MAX);
      return order.map(profile => { const name = plainLabel(profile); return { kind: 'load-profile', key: profile.id, name: name.length > PALETTE_NAME_MAX ? clip(name, PALETTE_NAME_MAX - 1) + '…' : name, run: () => { loadProfile(profile.id); } }; });
    }), []);
    useEffect(() => () => { clearUndoTimer(); if (noticeTimer.current !== null) clock.clear(noticeTimer.current); if (outcomeTimer.current !== null) clock.clear(outcomeTimer.current); }, []);

    if (!visible || !saved) return null;

    // --- Rendering. ---
    const focusable = (profile, col) => Boolean(current) && current.id === profile.id && current.col === col;
    function actionButton(profile, attribute, col, icon, caption, inactive, onClick, danger = false) {
      return h('button', { type: 'button', class: 'fingerprint-row-action' + (danger ? ' fingerprint-row-action--danger' : ''), title: caption, 'aria-label': caption + ': ' + plainLabel(profile), disabled: inactive,
        tabIndex: focusable(profile, col) ? 0 : -1, 'data-profile-focus': profile.id + ':' + col, ['data-profile-' + attribute]: true, onClick, onKeyDown: event => onCellKey(event, profile, col), onFocus: () => noteFocus(profile.id, col),
        children: h(Icon, { name: icon, size: 17 }) });
    }
    function statusPill(status) { return status ? h('span', { class: 'fingerprint-pill ' + (status === 'applied' ? 'fingerprint-pill--ok' : 'fingerprint-pill--preview'), 'data-profile-status': status, children: status === 'applied' ? words.applied : words.inPreview }) : null; }
    function fitPill(fit) {
      if (!fit || fit.failed) return null;
      if (fit.conflicts > 0) return h('span', { class: 'fingerprint-pill fingerprint-pill--warn', 'data-profile-fit': 'conflicts', 'data-profile-conflicts': fit.conflicts, dir: 'auto', children: fillTemplate(fingerprintLibraryPlural(locale, words.conflicts, fit.conflicts), { n: fit.conflicts }) });
      return fit.checked ? h('span', { class: 'fingerprint-pill fingerprint-pill--fit', 'data-profile-fit': 'fit', children: words.fit }) : null;
    }
    function factParts(profile) {
      const facts = profileFacts(profile), parts = [], family = facts.browser === 'edge' ? 'Edge' : facts.browser === 'chrome' ? 'Chrome' : null;
      if (facts.os) parts.push(h('bdi', { key: 'os', children: osName(facts.os) }));
      if (family || facts.major !== null) {
        const text = (family ?? 'Chromium') + (facts.major !== null ? ' ' + facts.major : ''), differs = facts.major !== null && realMajor !== null && facts.major !== realMajor;
        parts.push(differs ? h('span', { key: 'browser', class: 'fingerprint-row__chip', title: fillTemplate(words.versionDiffers, { real: realMajor }), 'data-profile-version-chip': facts.major,
          children: [h('bdi', { dir: 'ltr', children: text }), h('span', { class: 'fingerprint-visually-hidden', children: ' (' + fillTemplate(words.versionDiffers, { real: realMajor }) + ')' })] })
          : h('bdi', { key: 'browser', dir: 'ltr', children: text }));
      }
      if (facts.gpuName) parts.push(h('bdi', { key: 'gpu', dir: 'ltr', children: facts.gpuName }));
      if (facts.screen) parts.push(h('bdi', { key: 'screen', dir: 'ltr', children: facts.screen }));
      const place = facts.region ? regionName(locale, facts.region) ?? facts.region : facts.language;
      if (place) parts.push(h('bdi', { key: 'place', children: place }));
      if (facts.protection !== 'none') parts.push(h('bdi', { key: 'preset', children: presetLabel(facts.protection) }));
      return parts;
    }
    function renameEditor(profile) {
      const invalid = fieldError?.field === 'rename';
      return h('div', { class: 'fingerprint-row__rename', 'data-profile-rename': profile.id, children: [
        h('input', { type: 'text', class: 'fingerprint-row__rename-input', value: renaming.text, maxLength: LABEL_MAX, spellcheck: false, autoComplete: 'off', ref: mountRef(renameRef, 'rename'), 'aria-label': words.renameInput,
          'aria-invalid': invalid || undefined, 'aria-describedby': invalid ? RENAME_ERROR_ID : undefined, 'data-profile-rename-input': true,
          onInput: event => { const text = event.currentTarget.value; setRenaming(editing => editing && { ...editing, text }); if (fieldError) setFieldError(null); },
          onKeyDown: event => {
            if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void saveRename(); }
            else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelRename(); }
          } }),
        h('button', { type: 'button', class: 'fingerprint-row-action', title: editor('save'), 'aria-label': editor('save'), disabled: locked || !renaming.text.trim(), 'data-profile-rename-save': true, onClick: () => { void saveRename(); }, children: h(Glyph, { name: 'check', size: 17 }) }),
        h('button', { type: 'button', class: 'fingerprint-row-action', title: editor('cancel'), 'aria-label': editor('cancel'), 'data-profile-rename-cancel': true, onClick: () => cancelRename(), children: h(Glyph, { name: 'close', size: 17 }) }),
        invalid ? h('p', { class: 'fingerprint-field-error', id: RENAME_ERROR_ID, role: 'alert', 'data-profile-rename-error': true, children: words.unsafeLabel }) : null
      ] });
    }
    function menuWrap(profile) {
      const name = plainLabel(profile), caption = fillTemplate(words.more, { name }), full = profiles.length >= API_CONFIGURATION_MAX_PROFILES;
      const items = [['rename', t('rename'), locked, () => startRename(profile)], ['duplicate', words.duplicate, locked || full, () => { void duplicateProfile(profile); }],
        ['delete', editor('delete'), locked, () => { void deleteProfile(profile); }, true], ['close', words.close, false, () => closePeek(true)]];
      return h('div', { class: 'fingerprint-menu-wrap', onFocusOut: event => { if (latest.current.menuOpen && event.relatedTarget && !event.currentTarget.contains?.(event.relatedTarget)) setMenuOpen(false); }, children: [
        h('button', { type: 'button', class: 'fingerprint-row-action fingerprint-menu-button', ref: menuButtonRef, title: caption, 'aria-label': caption, 'aria-haspopup': 'menu', 'aria-expanded': menuOpen,
          'aria-controls': menuOpen ? MENU_ID : undefined, 'data-profile-peek-menu': true, onClick: () => { if (menuOpen) setMenuOpen(false); else openMenu(); },
          onKeyDown: event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openMenu(); } }, children: h(Glyph, { name: 'more', size: 17 }) }),
        menuOpen ? h('div', { class: 'fingerprint-menu', role: 'menu', id: MENU_ID, 'aria-label': caption, ref: mountRef(menuRef, 'menu', element => element.querySelector?.('[role="menuitem"]:not([disabled])')), 'data-profile-peek-menu-list': true, onKeyDown: onMenuKey,
          children: items.map(([key, text, inactive, run, danger]) => h('button', { type: 'button', role: 'menuitem', key, tabIndex: -1, disabled: inactive, class: 'fingerprint-menu__item' + (danger ? ' fingerprint-menu__item--danger' : ''),
            'data-profile-menu-item': key, onClick: () => { setMenuOpen(false); run(); }, children: text })) }) : null
      ] });
    }
    const applyBlocked = busy || locked || dirty;
    const metaMessage = key => key === 'tagLimit' ? fillTemplate(iw.tagLimit, { max: PROFILE_META_LIMITS.tags }) : key === 'tagHint' ? fillTemplate(iw.tagHint, { max: PROFILE_META_LIMITS.tags, length: PROFILE_META_LIMITS.tag }) : iw[key];
    // Tags and note of one profile: chips with remove buttons, a tag field (Enter or comma adds, Backspace on an empty field removes the last
    // chip, Escape clears the field), the tags already in use as suggestions, counters, a note field and an explicit Save.
    function metaSection(profile) {
      const draft = drafts[profile.id] ?? null, shown = draft ?? seedDraft(profile), unsaved = draftDirty(profile, draft), limits = PROFILE_META_LIMITS;
      const used = new Map(); for (const other of profiles) for (const tag of other.tags ?? []) used.set(tag, (used.get(tag) ?? 0) + 1);
      const typed = foldText(shown.input.trim());
      const suggestions = shown.tags.length >= limits.tags ? EMPTY : [...used.keys()].filter(tag => !shown.tags.some(own => own.toLowerCase() === tag.toLowerCase()) && (!typed || foldText(tag).includes(typed)))
        .sort((a, b) => used.get(b) - used.get(a) || compareUnits(a, b)).slice(0, LIBRARY_TAG_SUGGESTIONS);
      const key = profile.id, inputId = 'fp-tag-input-' + key, noteId = 'fp-note-input-' + key, hintId = 'fp-tag-hint-' + key, countId = 'fp-tag-count-' + key, errorId = 'fp-meta-error-' + key, noteHintId = 'fp-note-hint-' + key;
      const noteBad = shown.error === 'noteUnsafe', message = shown.error ? metaMessage(shown.error) : '';
      return h('section', { class: 'fingerprint-peek__meta', 'data-profile-meta': key, 'aria-label': iw.tagsHeading, children: [
        h('h5', { class: 'fingerprint-peek__subtitle', children: iw.tagsHeading }),
        shown.tags.length ? h('ul', { class: 'fingerprint-taglist', 'data-profile-taglist': true, children: shown.tags.map(tag => h('li', { key: tag, class: 'fingerprint-tag fingerprint-tag--editable', 'data-profile-tag-chip': tag, children: [
          h('bdi', { children: tag }),
          h('button', { type: 'button', class: 'fingerprint-tag__remove', disabled: locked, 'aria-label': fillTemplate(iw.tagRemove, { name: tag }), 'data-profile-tag-remove': tag, onClick: () => removeTag(profile, tag), children: h(Glyph, { name: 'close', size: 12 }) })] })) }) : null,
        h('div', { class: 'fingerprint-meta__field', children: [
          h('label', { class: 'fingerprint-visually-hidden', for: inputId, children: iw.tagInput }),
          h('input', { type: 'text', id: inputId, class: 'fingerprint-meta__input', value: shown.input, maxLength: limits.tag, spellcheck: false, autoComplete: 'off', disabled: locked, placeholder: iw.tagInput, 'aria-describedby': hintId + ' ' + countId + (shown.error && !noteBad ? ' ' + errorId : ''),
            'aria-invalid': shown.error && !noteBad ? true : undefined, 'data-profile-tag-input': true, onInput: event => onTagInput(profile, event.currentTarget.value), onKeyDown: event => onTagKey(profile, event) }),
          shown.input.length ? h('span', { class: 'fingerprint-meta__count', 'data-profile-tag-length': shown.input.length, children: shown.input.length + '/' + limits.tag }) : null] }),
        h('p', { class: 'fingerprint-note', id: hintId, children: fillTemplate(iw.tagHint, { max: limits.tags, length: limits.tag }) }),
        h('p', { class: 'fingerprint-note fingerprint-meta__counter', id: countId, 'data-profile-tag-count': shown.tags.length, children: fillTemplate(iw.tagCount, { n: shown.tags.length, max: limits.tags }) }),
        suggestions.length ? h('div', { class: 'fingerprint-meta__suggestions', role: 'group', 'aria-label': iw.tagSuggestions, 'data-profile-tag-suggestions': true, children: suggestions.map(tag => h('button', { type: 'button', key: tag, class: 'fingerprint-tag fingerprint-tag--suggestion', disabled: locked,
          'aria-label': fillTemplate(iw.tagAdd, { name: tag }), 'data-profile-tag-suggestion': tag, onClick: () => { addTags(profile, [tag], shown.input); }, children: [h('span', { 'aria-hidden': true, children: '+' }), h('bdi', { children: tag })] })) }) : null,
        h('label', { class: 'fingerprint-meta__label', for: noteId, children: iw.noteLabel }),
        h('textarea', { id: noteId, class: 'fingerprint-meta__note', rows: 3, value: shown.note, maxLength: API_PROFILE_NOTE_LIMIT, spellcheck: true, disabled: locked, 'aria-describedby': noteHintId + (noteBad ? ' ' + errorId : ''), 'aria-invalid': noteBad ? true : undefined, 'data-profile-note-input': true,
          onInput: event => onNoteInput(profile, event.currentTarget.value) }),
        h('p', { class: 'fingerprint-note', id: noteHintId, children: [iw.noteHint, ' ', h('span', { class: 'fingerprint-meta__count', 'data-profile-note-length': shown.note.length, children: shown.note.length + '/' + API_PROFILE_NOTE_LIMIT })] }),
        message ? h('p', { class: 'fingerprint-field-error', id: errorId, role: 'alert', 'data-profile-meta-error': shown.error, children: message }) : null,
        h('div', { class: 'fingerprint-meta__actions', children: [
          h('button', { type: 'button', class: 'button button--primary', disabled: locked || !unsaved || noteBad, 'data-profile-meta-save': true, onClick: () => { void saveMeta(profile); }, children: iw.metaSave }),
          h('button', { type: 'button', class: 'button', disabled: !unsaved, 'data-profile-meta-discard': true, onClick: () => discardDraft(profile), children: iw.metaDiscard }),
          unsaved ? h('span', { class: 'fingerprint-pill fingerprint-pill--preview', role: 'status', 'data-profile-meta-unsaved': true, children: iw.metaUnsaved }) : null] })] });
    }
    const optionText = entry => {
      const place = entry.host ? ' ' + entry.host + (entry.port ? ':' + entry.port : '') : '', country = entry.country ? ' · ' + (regionName(locale, entry.country) ?? entry.country) : '';
      return (entry.name || entry.id) + ' · ' + (PROXY_TYPE_NAMES[entry.type] ?? entry.type) + place + country;
    };
    // A closed select clips a long option; the whole text of the chosen proxy is the tooltip.
    const selectedProxyText = (info, value) => { const entry = value ? info.profiles.find(item => item.id === value) : null; return entry ? optionText(entry) : undefined; };
    // "Proxy of this profile": a select over the saved proxies of the Proxy workspace, with the states unavailable / none saved / linked proxy
    // gone, a warning (and a confirmation) before one proxy is shared by two profiles, and the outcome of the last "Apply with proxy".
    function bundleSection(profile) {
      if (!bundles || !proxies) return null;
      const id = profile.id, linkedId = links[id] ?? null, pick = picks[id] ?? null, info = proxyInfo, present = info.profiles.find(entry => entry.id === linkedId) ?? null, selectId = 'fp-bundle-select-' + id;
      const waiting = info.status === 'idle' || info.status === 'loading', note = (key, extra = {}) => h('p', { class: 'fingerprint-note', 'data-profile-bundle-state': key, ...extra, children: iw[key] });
      const refresh = h('button', { type: 'button', class: 'button button--text', disabled: waiting, 'data-profile-bundle-refresh': true, onClick: () => { void refreshProxies(); }, children: iw.bundleRefresh });
      const unlink = h('button', { type: 'button', class: 'button button--text', disabled: locked, 'data-profile-bundle-unlink': true, onClick: () => { void writeLink(profile, null); }, children: iw.bundleRemove });
      const owners = pick ? profilesOfProxy(links, pick.proxy).filter(other => other !== id).map(other => { const found = profiles.find(item => item.id === other); return found ? plainLabel(found) : other; }) : EMPTY;
      let body;
      if (waiting) body = [note('bundleLoading')];
      else if (info.status === 'unavailable') body = [note('bundleUnavailable'), linkedId ? h('p', { class: 'fingerprint-note', 'data-profile-bundle-linked': linkedId, children: h('code', { dir: 'ltr', children: linkedId }) }) : null, h('div', { class: 'fingerprint-meta__actions', children: [refresh, linkedId ? unlink : null] })];
      else if (!info.profiles.length) body = [note('bundleNoProxies'), h('div', { class: 'fingerprint-meta__actions', children: [h('a', { href: '#proxy', class: 'fingerprint-library__link', 'data-profile-bundle-open': true, children: iw.bundleOpen }), refresh, linkedId ? unlink : null] })];
      else body = [
        h('label', { class: 'fingerprint-meta__label', for: selectId, children: iw.bundleSelect }),
        h('select', { id: selectId, class: 'fingerprint-bundle__select', value: pick?.proxy ?? (present ? present.id : ''), title: selectedProxyText(info, pick?.proxy ?? (present ? present.id : '')), disabled: locked, 'data-profile-bundle-select': true, onChange: event => chooseProxy(profile, event.currentTarget.value),
          children: [h('option', { value: '', key: 'none', children: iw.bundleNone }), ...info.profiles.map(entry => h('option', { value: entry.id, key: entry.id, children: optionText(entry) }))] }),
        linkedId && !present ? h('p', { class: 'fingerprint-warning', role: 'status', 'data-profile-bundle-state': 'bundleMissing', children: iw.bundleMissing }) : null,
        pick ? h('div', { class: 'fingerprint-bundle__shared', role: 'group', 'data-profile-bundle-shared': pick.proxy, children: [
          h('p', { class: 'fingerprint-warning', children: rich(iw.bundleShared, owners.join(', ')) }),
          h('label', { class: 'fingerprint-bundle__confirm', children: [h('input', { type: 'checkbox', checked: pick.confirmed, 'data-profile-bundle-confirm': true, onChange: event => { const confirmed = event.currentTarget.checked; setPicks(previous => ({ ...previous, [id]: { ...pick, confirmed } })); } }), h('span', { children: iw.bundleSharedConfirm })] }),
          h('div', { class: 'fingerprint-meta__actions', children: [
            h('button', { type: 'button', class: 'button button--primary', disabled: locked || !pick.confirmed, 'data-profile-bundle-link': true, onClick: () => { void writeLink(profile, pick.proxy); }, children: iw.bundleLink }),
            h('button', { type: 'button', class: 'button', 'data-profile-bundle-cancel': true, onClick: () => setPicks(previous => omit(previous, id)), children: editor('cancel') })] })] }) : null,
        h('div', { class: 'fingerprint-meta__actions', children: [refresh, linkedId ? unlink : null] })];
      const result = outcome && outcome.id === id ? h('ul', { class: 'fingerprint-bundle__result', role: 'status', 'data-profile-bundle-result': true, children: [
        outcome.profile ? h('li', { 'data-profile-bundle-result-profile': 'ok', children: fillTemplate(iw.bundleProfileDone, { name: plainLabel(profile) }) }) : null,
        outcome.proxy ? h('li', { 'data-profile-bundle-result-proxy': outcome.proxy.ok ? 'ok' : outcome.proxy.code, class: outcome.proxy.ok ? '' : 'is-failed', children: outcome.proxy.ok ? fillTemplate(iw.bundleProxyDone, { proxy: outcome.proxyName }) : fillTemplate(iw.bundleProxyFail, { code: outcome.proxy.code }) }) : null] }) : null;
      return h('section', { class: 'fingerprint-peek__bundle', 'data-profile-bundle': id, 'aria-label': iw.bundleHeading, children: [h('h5', { class: 'fingerprint-peek__subtitle', children: iw.bundleHeading }), ...body, h('p', { class: 'fingerprint-note', children: iw.bundleLocal }), result] });
    }
    // The read-only Peek: facts the saved profile reports, how far it is from the applied settings and its hints. It never writes.
    function peekNode(profile, placement) {
      const facts = profileFacts(profile), device = facts.device, read = readerOf(profile), status = statuses.get(profile.id), name = plainLabel(profile), browserText = dwords.value_browser;
      const fit = profileFit(profile, base, envFor(profile)), difference = profileDifference(profile, base), quota = read('storage-estimate')?.quota, ratio = read('window-device-pixel-ratio');
      const factRows = [
        ['os', dwords.os_label, osName(facts.os) ?? browserText],
        ['browser', dwords.browser_family_label, facts.browser ? (facts.browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome') + (facts.major !== null ? ' ' + facts.major : '') : browserText],
        ['cpu', dwords.cpu_label, device.cores ?? browserText],
        ['ram', dwords.ram_label, device.reportedMemory !== null ? device.reportedMemory + ' GB' : browserText],
        ['disk', dwords.disk_label, typeof quota === 'number' ? '≈ ' + Math.round(quota / 1024 ** 3) + ' GiB' : browserText],
        ['gpu', dwords.gpu_label, facts.gpuLabel ?? browserText],
        ['screen', dwords.screen_label, facts.screen ? facts.screen + (typeof ratio === 'number' && ratio !== 1 ? ' @' + ratio + 'x' : '') : browserText],
        ['timezone', dwords.timezone_label, [facts.timeZone, facts.language].filter(Boolean).join(' · ') || browserText],
        ['region', dwords.region_card_label, facts.region ? regionName(locale, facts.region) ?? facts.region : dwords.region_card_unset],
        ['fonts', dwords.fonts_label, device.fonts === 'windows' ? 'Windows' : device.fonts === 'custom' ? 'Custom' : browserText],
        ['custom', words.customValues, String(facts.custom)]];
      const issues = fit.failed ? EMPTY : [...fit.issues].sort((left, right) => (left.severity === 'info') - (right.severity === 'info'));
      const hintState = fit.conflicts > 0 ? 'issues' : fit.checked && !fit.failed ? 'none' : 'unchecked';
      return h('section', { key: 'peek-' + placement, class: 'fingerprint-peek fingerprint-peek--' + placement, id: PEEK_ID, role: 'region', 'aria-label': fillTemplate(words.peekLabel, { name }), 'data-profile-peek': profile.id, 'data-profile-peek-placement': placement,
        onKeyDown: event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); closePeek(true); } }, children: [
          h('header', { class: 'fingerprint-peek__head', children: [
            h('span', { class: 'fingerprint-row__avatar', 'aria-hidden': true, children: initialOf(profile) }),
            h('div', { class: 'fingerprint-peek__heading', children: [h('h4', { class: 'fingerprint-peek__title', children: h('bdi', { children: profile.label }) }), statusPill(status)] }),
            menuWrap(profile)] }),
          h('p', { class: 'fingerprint-note fingerprint-peek__note', children: words.peekNote }),
          h('div', { class: 'fingerprint-peek__actions', children: [
            h('button', { type: 'button', class: 'button button--primary', disabled: busy, 'data-profile-peek-load': true, onClick: () => { loadProfile(profile.id); }, children: [h(Icon, { name: 'load', size: 16 }), t('load_profile')] }),
            // Both applying actions commit at once, so they wait for pending changes (aria-disabled keeps them focusable and the reason is read).
            onTemporary ? h('button', { type: 'button', class: 'button', 'aria-disabled': applyBlocked, 'aria-describedby': dirty ? REASON_ID : undefined, 'data-profile-peek-temporary': true, onClick: () => { if (!applyBlocked) void applyTemporarily(profile); }, children: iw.tempApply }) : null,
            linkedProxy(profile) ? h('button', { type: 'button', class: 'button', 'aria-disabled': applyBlocked, 'aria-describedby': dirty ? REASON_ID : undefined, title: iw.bundleApplyHint, 'data-profile-peek-apply-proxy': true, onClick: () => { if (!applyBlocked) void applyWithProxy(profile); }, children: iw.bundleApply }) : null,
            (onTemporary || linkedProxy(profile)) && dirty ? h('p', { class: 'fingerprint-note fingerprint-peek__reason', id: REASON_ID, 'data-profile-peek-reason': true, children: iw.tempDirty }) : null] }),
          metaSection(profile), bundleSection(profile),
          h('dl', { class: 'fingerprint-peek__facts', 'data-profile-peek-facts': true, children: factRows.map(([key, caption, value]) => h('div', { class: 'fingerprint-peek__fact', key, 'data-profile-peek-fact': key, children: [h('dt', { children: caption }), h('dd', { children: h('bdi', { children: String(value) }) })] })) }),
          h('p', { class: 'fingerprint-peek__diff', 'data-profile-peek-diff': difference === null ? 'unknown' : difference, children: difference === null ? words.notChecked : difference === 0 ? words.diffNone : fillTemplate(fingerprintLibraryPlural(locale, words.diffRows, difference), { n: difference }) }),
          h('section', { class: 'fingerprint-peek__hints', 'aria-label': words.hints, 'data-profile-peek-hints': hintState, children: [
            h('h5', { class: 'fingerprint-peek__subtitle', children: words.hints }),
            hintState === 'issues' ? null : h('p', { class: 'fingerprint-note', 'data-profile-peek-hint-state': hintState, children: hintState === 'none' ? words.hintsNone : words.notChecked }),
            issues.length ? h('ul', { class: 'fingerprint-issues fingerprint-peek__issues' + (fit.conflicts ? '' : ' fingerprint-peek__issues--info'), children: issues.map(issue => h('li', { key: issue.code, 'data-profile-peek-issue': issue.code, 'data-severity': issue.severity, children: [h('span', { children: fillIssueDetail(issueText(issue.code, dwords, translate), issue, locale) }), issue.ids.length ? h('code', { dir: 'ltr', children: issue.ids.join(', ') }) : null] })) }) : null] })
        ] });
    }
    // At most three tags on the row and "+N" for the rest (the full list is in the title and in the hidden text for screen readers).
    function tagLine(profile) {
      const tags = profile.tags ?? EMPTY; if (!tags.length) return null;
      const shown = tags.slice(0, 3), extra = tags.length - shown.length;
      return h('span', { class: 'fingerprint-row__tags', 'data-profile-tags': profile.id, children: [
        h('span', { class: 'fingerprint-visually-hidden', children: fillTemplate(iw.tagsOfRow, { names: tags.join(', ') }) }),
        ...shown.map(tag => h('bdi', { key: tag, class: 'fingerprint-tag', 'aria-hidden': true, 'data-profile-tag': tag, children: tag })),
        extra > 0 ? h('span', { class: 'fingerprint-tag fingerprint-tag--more', dir: 'ltr', 'aria-hidden': true, title: fillTemplate(iw.moreTags, { names: tags.slice(3).join(', ') }), 'data-profile-tags-more': extra, children: '+' + extra }) : null] });
    }
    function libraryRow(profile, index) {
      const facts = profileFacts(profile), status = statuses.get(profile.id), peeked = peekProfile?.id === profile.id, editing = renaming?.id === profile.id, statusId = 'fp-row-status-' + profile.id;
      return h('div', { role: 'row', key: profile.id, class: 'fingerprint-row' + (peeked ? ' is-selected' : '') + (editing ? ' is-editing' : ''), 'aria-rowindex': index + 1, 'aria-selected': peeked, 'data-profile-row': profile.id, 'data-profile-preset': facts.protection, children: [
        h('div', { role: 'gridcell', class: 'fingerprint-row__cell', children: editing ? renameEditor(profile) : h('button', { type: 'button', class: 'fingerprint-row__main', 'aria-expanded': peeked, 'aria-controls': peeked ? PEEK_ID : undefined, 'aria-describedby': statusId,
          tabIndex: focusable(profile, 0) ? 0 : -1, 'data-profile-focus': profile.id + ':0', 'data-profile-pick': true, onClick: () => togglePeek(profile), onKeyDown: event => onCellKey(event, profile, 0), onFocus: () => noteFocus(profile.id, 0), children: [
            h('span', { class: 'fingerprint-row__avatar', 'aria-hidden': true, children: initialOf(profile) }),
            h('span', { class: 'fingerprint-row__text', children: [h('bdi', { class: 'fingerprint-row__name', children: profile.label }), h('span', { class: 'fingerprint-row__meta', 'data-profile-facts': true, children: factParts(profile) }), tagLine(profile)] })] }) }),
        h('div', { role: 'gridcell', class: 'fingerprint-row__status', id: statusId, children: [statusPill(status), fitPill(fitOf(profile))] }),
        h('div', { role: 'gridcell', class: 'fingerprint-row__actions', children: [
          actionButton(profile, 'load', 1, 'load', t('load_profile'), !enabledColumns[1], () => { loadProfile(profile.id); }),
          actionButton(profile, 'rename', 2, 'edit', t('rename'), !enabledColumns[2], () => startRename(profile)),
          actionButton(profile, 'delete', 3, 'delete', editor('delete'), !enabledColumns[3], () => { void deleteProfile(profile); }, true)] }),
        peeked && !wideNow ? h('div', { role: 'gridcell', class: 'fingerprint-row__peek', 'aria-colspan': 3, children: peekNode(profile, 'row') }) : null
      ] });
    }
    function filterPanel() {
      return h('div', { class: 'fingerprint-filters', id: FILTERS_ID, role: 'group', 'aria-label': words.filters, 'data-profile-filters': true, children: GROUPS.map(group => {
        const counts = new Map(); for (const profile of searched) if (passes(profile, group)) for (const value of valuesById.get(profile.id)[group]) counts.set(value, (counts.get(value) ?? 0) + 1);
        const options = group === LIBRARY_TAG_GROUP ? tagOptions(counts, filters[group]) : LIBRARY_FILTER_OPTIONS[group].filter(value => counts.get(value) || filters[group].includes(value));
        return options.length ? h('fieldset', { class: 'fingerprint-filters__group', key: group, 'data-profile-filter-group': group, children: [h('legend', { children: groupLabel(group) }), h('div', { class: 'fingerprint-filters__options', children: options.map(value => {
          const on = filters[group].includes(value);
          return h('button', { type: 'button', key: value, class: 'fingerprint-filter' + (on ? ' is-on' : ''), 'aria-pressed': on, 'data-profile-filter': group + ':' + value, onClick: () => toggleFilter(group, value),
            children: [h('bdi', { children: optionLabel(group, value) }), h('span', { class: 'fingerprint-filter__count', children: String(counts.get(value) ?? 0) })] });
        }) })] }) : null;
      }) });
    }
    const filtered = Boolean(query.trim()) || active.length > 0, saveInvalid = fieldError?.field === 'save';
    const countText = fillTemplate(filtered ? words.countShown : words.countTotal, { shown: rows.length, total: profiles.length, max: API_CONFIGURATION_MAX_PROFILES });
    const empty = !profiles.length ? h('div', { class: 'fingerprint-empty', 'data-profile-empty': 'library', children: [
      h('span', { class: 'fingerprint-icon fingerprint-icon--library', children: h(Icon, { name: 'library' }) }), h('p', { class: 'fingerprint-empty__title', children: words.emptyTitle }), h('p', { class: 'fingerprint-note', children: words.emptyHint }),
      h('div', { class: 'fingerprint-empty__actions', children: [
        onRandomize ? h('button', { type: 'button', class: 'button button--primary', disabled: busy, 'data-profile-empty-randomize': true, onClick: () => onRandomize(), children: dwords.randomize_button }) : null,
        onImport ? h('button', { type: 'button', class: 'button', disabled: busy, 'data-profile-empty-import': true, onClick: () => onImport(), children: editor('import') }) : null] })] })
      : rows.length ? null : active.length ? h('div', { class: 'fingerprint-empty fingerprint-empty--filtered', 'data-profile-empty': 'filters', children: [h('p', { class: 'fingerprint-note', children: words.emptyFiltered }), h('button', { type: 'button', class: 'button', 'data-profile-empty-clear': 'filters', onClick: () => { clearAll(); focusLater('search'); }, children: words.clearFilters })] })
        : h('div', { class: 'fingerprint-note fingerprint-empty fingerprint-empty--search', 'data-profile-empty': 'search', children: [h('p', { children: t('no_profiles') }), h('button', { type: 'button', class: 'button', 'data-profile-empty-clear': 'search', onClick: () => { setQuery(''); focusLater('search'); }, children: words.clearSearch })] });
    const status = undo ? h('div', { class: 'fingerprint-undo' + (undoPaused ? ' is-paused' : ''), 'data-profile-undo': undo.profile.id,
      onMouseEnter: () => undoHover('pointer', true), onMouseLeave: () => undoHover('pointer', false), onFocusIn: () => undoHover('focus', true),
      onFocusOut: event => { if (!event.currentTarget.contains?.(event.relatedTarget)) undoHover('focus', false); }, children: [
        h('span', { class: 'fingerprint-undo__text', children: [...rich(words.deleted, undo.profile.label), ...(undo.trashed ? [' ', h('span', { class: 'fingerprint-undo__kept', 'data-profile-undo-kept': true, children: iw.trashKept + (undo.evicted ? ' ' + iw.trashEvicted : '') })] : [])] }),
        h('button', { type: 'button', class: 'button button--text fingerprint-undo__button', disabled: locked, 'data-profile-undo-button': true, onClick: () => { void undoDelete(); }, children: [h(Glyph, { name: 'undo', size: 15 }), words.undo] }),
        h('span', { class: 'fingerprint-undo__bar', 'aria-hidden': true })] })
      : notice ? h('p', { class: 'fingerprint-warning fingerprint-library__notice', 'data-profile-library-notice': notice.kind, children: notice.text }) : null;
    const libraryHead = h('div', { class: 'fingerprint-library__head', children: [heading(t('library'), 'library'), h('span', { class: 'fingerprint-count', dir: 'auto', 'data-profile-count': true, children: countText })] });
    const cookiesLine = h('p', { class: 'fingerprint-note fingerprint-library__cookies', 'data-profile-cookies-note': true, children: [words.cookiesNote, ' ', h('a', { href: '#cookies', class: 'fingerprint-library__link', 'data-profile-cookies-link': true, children: words.cookiesLink })] });
    const trashToggle = trash ? h('button', { type: 'button', class: 'button fingerprint-trash-toggle' + (trashView ? ' is-open' : ''), 'aria-pressed': trashView, 'data-profile-trash-toggle': true, onClick: toggleTrash,
      children: [h(Icon, { name: 'delete', size: 16 }), h('span', { children: fillTemplate(iw.trashView, { n: trashData.items.length }) })] }) : null;
    // The trash: rows with the deletion time and the days left, Restore, Delete forever and Empty trash (each delete asks first).
    function trashConfirmBox(kind, item) {
      const name = item ? plainLabel(item.profile) : '';
      return h('div', { class: 'fingerprint-confirm fingerprint-trash__confirm', role: 'group', 'aria-label': kind === 'all' ? iw.trashEmptyAll : fillTemplate(iw.trashForeverNamed, { name }), 'data-profile-trash-confirm': kind,
        onKeyDown: event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelTrashConfirm(); } }, children: [
          h('p', { class: 'fingerprint-trash__confirm-text', children: kind === 'all' ? iw.trashConfirmAll : rich(iw.trashConfirmOne, item.profile.label) }),
          h('div', { class: 'fingerprint-trash__confirm-actions', children: [
            h('button', { type: 'button', class: 'button button--primary fingerprint-danger-button', 'data-profile-trash-confirm-yes': true, onClick: () => { void (kind === 'all' ? emptyTrash() : deleteForever(item)); }, children: kind === 'all' ? iw.trashEmptyAll : iw.trashForever }),
            h('button', { type: 'button', class: 'button', 'data-profile-trash-confirm-cancel': true, onClick: cancelTrashConfirm, children: editor('cancel') })] })] });
    }
    function trashRow(item) {
      const name = plainLabel(item.profile), days = trashDaysLeft(item, clock.now()), left = days <= 1 ? iw.trashSoon : fillTemplate(fingerprintLibraryPlural(locale, iw.trashDays, days), { n: days });
      const confirming = trashConfirm?.kind === 'one' && trashConfirm.id === item.profile.id;
      return h('li', { key: item.profile.id, class: 'fingerprint-trash-row' + (days <= 1 ? ' is-expiring' : ''), 'data-profile-trash-row': item.profile.id, 'data-profile-trash-days': days, children: [
        h('span', { class: 'fingerprint-row__avatar', 'aria-hidden': true, children: initialOf(item.profile) }),
        h('span', { class: 'fingerprint-trash-row__text', children: [h('bdi', { class: 'fingerprint-row__name', children: item.profile.label }), h('span', { class: 'fingerprint-row__meta', 'data-profile-trash-when': true, children: fillTemplate(iw.trashDeleted, { when: formatWhen(locale, item.deletedAt) }) })] }),
        h('span', { class: 'fingerprint-pill' + (days <= 1 ? ' fingerprint-pill--warn' : ''), 'data-profile-trash-left': true, children: left }),
        h('div', { class: 'fingerprint-trash-row__actions', children: [
          h('button', { type: 'button', class: 'button', disabled: locked, 'aria-label': fillTemplate(iw.trashRestoreNamed, { name }), 'data-profile-trash-restore': item.profile.id, onClick: () => { void restoreTrashed(item); }, children: iw.trashRestore }),
          h('button', { type: 'button', class: 'button button--text fingerprint-danger', 'aria-label': fillTemplate(iw.trashForeverNamed, { name }), 'data-profile-trash-delete': item.profile.id, onClick: () => askTrash({ kind: 'one', id: item.profile.id }), children: iw.trashForever })] }),
        confirming ? trashConfirmBox('one', item) : null] });
    }
    function trashSection() {
      const items = trashData.items, unreadable = trashData.status === 'error';
      return h('section', { class: 'fingerprint-trash', role: 'region', 'aria-label': iw.trashHeading, 'data-profile-trash': true, 'data-profile-trash-count': items.length, children: [
        h('p', { class: 'fingerprint-note', children: iw.trashNote }),
        unreadable ? h('p', { class: 'fingerprint-warning', role: 'alert', 'data-profile-trash-error': true, children: iw.trashUnreadable }) : null,
        items.length ? h('ul', { class: 'fingerprint-trash-list', 'data-profile-trash-list': true, children: items.map(trashRow) }) : unreadable ? null : h('div', { class: 'fingerprint-empty', 'data-profile-empty': 'trash', children: h('p', { class: 'fingerprint-note', children: iw.trashEmpty }) }),
        items.length ? h('div', { class: 'fingerprint-trash__footer', children: trashConfirm?.kind === 'all' ? trashConfirmBox('all', null) : h('button', { type: 'button', class: 'button', 'data-profile-trash-empty': true, onClick: () => askTrash({ kind: 'all' }), children: iw.trashEmptyAll }) }) : null] });
    }
    if (trashView && trash) {
      return [peekProfile && wideNow ? peekNode(peekProfile, 'card') : card(), h('div', { class: 'fingerprint-library', ref: rootRef, 'data-profile-library-panel': true, 'data-tour': 'library', 'data-profile-view': 'trash', children: [
        libraryHead, h('div', { class: 'fingerprint-library__toolbar', children: [trashToggle] }), trashSection(), h('div', { class: 'fingerprint-library__status', 'data-profile-library-status': true, children: status }), cookiesLine] })];
    }
    return [peekProfile && wideNow ? peekNode(peekProfile, 'card') : card(), h('div', { class: 'fingerprint-library', ref: rootRef, 'data-profile-library-panel': true, 'data-tour': 'library', 'data-profile-view': 'library', children: [
      libraryHead,
      h('div', { class: 'fingerprint-library__toolbar', children: [
        h('label', { class: 'fingerprint-search', children: [h('span', { class: 'fingerprint-visually-hidden', children: t('search_profiles') }), h(Icon, { name: 'search', size: 16 }), h('input', { type: 'search', value: query, maxLength: SEARCH_MAX, placeholder: t('search_profiles'), ref: searchRef, 'data-profile-search': true,
          onInput: event => setQuery(event.currentTarget.value),
          onKeyDown: event => { if (event.key === 'ArrowDown' && current && !event.altKey) { event.preventDefault(); moveFocus(current.id, current.col); } } })] }),
        profiles.length ? h('button', { type: 'button', class: 'button fingerprint-filters-toggle' + (filtersOpen ? ' is-open' : ''), ref: toggleRef, 'aria-expanded': filtersOpen, 'aria-controls': FILTERS_ID, 'data-profile-filters-toggle': true, onClick: () => setFiltersOpen(open => !open),
          children: [h(Glyph, { name: 'filter' }), h('span', { children: words.filters }), active.length ? h('span', { class: 'fingerprint-filters-toggle__count', children: String(active.length) }) : null] }) : null,
        trashToggle,
        h('div', { class: 'fingerprint-name-row', children: [
          h('label', { class: 'fingerprint-name-field', children: [h('span', { class: 'fingerprint-visually-hidden', children: editor('label') }), h('input', { type: 'text', value: saveName, maxLength: LABEL_MAX, placeholder: editor('label'), disabled: busy, ref: nameRef,
            'aria-invalid': saveInvalid || undefined, 'aria-describedby': saveInvalid ? NAME_ERROR_ID : undefined, 'data-profile-name': true,
            onInput: event => { setSaveName(event.currentTarget.value); if (fieldError?.field === 'save') setFieldError(null); },
            onKeyDown: event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void saveProfile(); } } })] }),
          h('button', { type: 'button', class: 'button button--primary', disabled: locked || !saveName.trim(), onClick: () => { void saveProfile(); }, 'data-profile-save-named': true, children: t('save_profile') })] })
      ] }),
      saveInvalid ? h('p', { class: 'fingerprint-field-error', id: NAME_ERROR_ID, role: 'alert', 'data-profile-name-error': true, children: words.unsafeLabel }) : null,
      filtersOpen && profiles.length ? filterPanel() : null,
      active.length ? h('div', { class: 'fingerprint-chips', 'data-profile-filter-chips': true, children: [
        ...active.map(([group, value]) => { const label = groupLabel(group) + ': ' + optionLabel(group, value); return h('button', { type: 'button', key: group + ':' + value, class: 'fingerprint-chip', 'aria-label': fillTemplate(words.removeFilter, { name: label }), 'data-profile-filter-chip': group + ':' + value, onClick: () => removeChip(group, value),
          children: [h('span', { class: 'fingerprint-chip__group', children: groupLabel(group) + ':' }), h('bdi', { children: optionLabel(group, value) }), h(Glyph, { name: 'close', size: 12 })] }); }),
        h('button', { type: 'button', class: 'button button--text', 'data-profile-clear-filters': true, onClick: () => { clearAll(); focusLater('search'); }, children: words.clearFilters })] }) : null,
      rows.length ? h('div', { class: 'fingerprint-library__columns', 'aria-hidden': true, children: [h('span', { children: words.name }), h('span', { children: words.status }), h('span', { children: words.actions })] }) : null,
      h('div', { class: 'fingerprint-library-list', role: 'grid', 'aria-label': t('library'), 'aria-describedby': KEYS_ID, 'aria-rowcount': rows.length, hidden: !rows.length, 'data-profile-library': true, children: rows.map(libraryRow) }),
      empty,
      h('div', { class: 'fingerprint-library__status', 'data-profile-library-status': true, children: status }),
      h('p', { class: 'fingerprint-visually-hidden', id: KEYS_ID, children: words.keysHint }),
      cookiesLine
    ] })];
  }
  return { FingerprintLibrary };
}
