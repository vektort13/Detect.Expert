// E22-19 / ADR-066: coherent, portable global profiles. No browser calls or second settings store.
import { API_CONFIG_CATALOG, API_MATH_FUNCTIONS, API_PROFILE_MAX_TAGS, API_PROFILE_TAG_MAX, API_PROFILE_NOTE_MAX, validateApiConfiguration, validateApiValue, diffApiConfigurations, apiLabelSafe, apiNoteSafe } from './api-configuration.js';
import { buildDeviceValues, describeDevice, gpuValues, screenValues, identityValues, fontValues, generatedFontOptions, processorValues, memoryValues as deviceMemoryValues, storageValues, DEVICE_ROW_GROUPS, DEVICE_OS, DEVICE_BROWSERS, CPU_STEPS, RAM_STEPS, DISK_STEPS, GPU_PRESETS, SCREEN_PRESETS, browserVersions, normalizeEnvironment, screenScalesFor, WINDOWS_SCALES, WEBGPU_ARCHITECTURES, WINDOW_CHROME_MIN, neutralSensorValues, STRICT_BLOCK_ONLY, MEASURED_HEAP, heapClassMeasured, chromeLanguages, regionLocales, chromiumIdentity, memoryBound, gpuFamily, realGpuFamily, realGpuSoftware, SOFTWARE_RENDERER, STORAGE_CHROME_HEADROOM, claimableVersion } from './fingerprint-device-presets.js';
import { windowsFonts, regionFontGroup } from './fingerprint-font-groups.js';
import { canonicalTimeZone, standardOffsetMinutes } from './fingerprint-timezone-data.js';
import { regionDefaults, regionByCode, regionOfTimeZone } from './fingerprint-region-data.js';
// Window geometry and CSS media hold several independent keys; a device change only replaces its own.
const MERGED_ROWS = new Set(['screen-geometry', 'css-media']);
const portableSeed = (domain, seed) => { const hex = seed.toString(16).padStart(8, '0'); return domain + hex + '000000000000000000000000'.slice(0, 32 - domain.length - hex.length); };

export const FINGERPRINT_RECIPES = Object.freeze(['balanced', 'laptop', 'desktop', 'workstation', 'strict'].map(id => Object.freeze({ id })));
export const FINGERPRINT_DISPLAYS = Object.freeze(['preserve', 'hd', 'fullhd', 'qhd', 'retina'].map(id => Object.freeze({ id })));
export const FINGERPRINT_SYSTEMS = Object.freeze(['preserve', 'windows', 'macos', 'linux']);
// ADR-107: every locale of the offline region table (the five older entries first, in their old order; the UI names them with
// Intl.DisplayNames). 'preserve' keeps the browser's own language.
export const FINGERPRINT_LANGUAGES = Object.freeze([...new Set(['preserve', 'en-US', 'ru-RU', 'de-DE', 'fr-FR', 'ja-JP', ...regionLocales()])]);
export const FINGERPRINT_ISSUES = Object.freeze(['platform-agent', 'client-hints-agent', 'language-list', 'screen-available', 'screen-depth', 'orientation-size', 'gpu-pair', 'memory-bucket', 'timezone-metadata', 'network-ua', 'network-language', 'screen-css', 'worker-scope']);
// Every code fingerprintProfileIssues can return: the 13 above plus the coherence rules added with the realistic-device work
// (read-only hints; no rule rewrites a user value). The UI builds its set of known codes from this list.
export const FINGERPRINT_ISSUE_CODES = Object.freeze([...FINGERPRINT_ISSUES, 'dpr-step', 'window-bounds', 'window-chrome', 'media-geometry', 'touch-range', 'touch-media', 'screen-shape', 'color-depth', 'gpu-os', 'gpu-shape', 'webgpu-gpu', 'host-os', 'engine-version', 'cores-above-real', 'screen-vs-real', 'webrtc-shape', 'geolocation-timezone-mismatch',
  // ADR-107 (ShardBrowser comparison): this browser's memory, GPU and proxy state, and Chrome's own value shapes.
  'memory-above-real', 'language-timezone', 'proxy-locale-host', 'webgpu-missing', 'real-gpu-software', 'real-gpu-limits', 'real-gpu-vendor', 'real-gpu-webgpu',
  'storage-quota-shape', 'plugins-pdf', 'clock-precision-shape',
  // ADR-107 round 5: the user's own country tag of the connected or linked proxy against the region the applied rows imply.
  'proxy-country-region']);
const PROFILE_ID = /^fp-[a-f0-9]{32}$/;
const copy = value => structuredClone(value);
export class FingerprintProfileError extends Error { constructor(code = 'invalid-profile') { super(code); this.code = code; } }
const fail = code => { throw new FingerprintProfileError(code); };
function checked(input) { const result = validateApiConfiguration(input); if (!result.ok) fail('invalid-profile'); return result.value; }
function data(object, key) { return object && typeof object === 'object' ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined; }
function text(value, max = 160) { if (typeof value !== 'string' || !value.trim() || value.length > max) fail('invalid-value'); return value.trim(); }
// ADR-107: a new or renamed library label refuses C0/C1 controls and bidirectional formatting characters (the contract's
// apiLabelSafe) with 'unsafe-label'; labels already stored keep loading unchanged.
function label(value) { const result = text(value); if (!apiLabelSafe(result)) fail('unsafe-label'); return result; }
function generatedId() {
  const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes);
  return 'fp-' + [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}
function scopeRows(configuration) { return configuration.apis.map(({ id, mode, selected, settings }) => ({ id, mode, selected: copy(selected), settings: copy(settings) })); }
function profileById(configuration, id) { if (typeof id !== 'string' || !PROFILE_ID.test(id)) fail('invalid-profile'); const result = configuration.fingerprintProfiles.find(profile => profile.id === id); if (!result) fail('missing-profile'); return result; }

export function snapshotFingerprintProfile(configuration, name, id = generatedId()) {
  const base = checked(configuration);
  // Format 9 records: a new snapshot starts without tags and without a note.
  const profile = { id, label: label(name), preset: base.preset, webrtcNetworkPolicy: base.webrtcNetworkPolicy, apis: scopeRows(base), tags: [], note: '' };
  // The canonical validator also validates all profile rows, mode/value pairs and device conflicts.
  const result = checked({ ...base, fingerprintProfiles: [profile] });
  return result.fingerprintProfiles[0];
}
export function storeFingerprintProfile(configuration, profile) {
  const base = checked(configuration);
  if (base.fingerprintProfiles.some(value => value.id === data(profile, 'id'))) fail('duplicate-profile');
  if (base.fingerprintProfiles.length >= 128) fail('profile-limit');
  if (typeof data(profile, 'label') === 'string' && !apiLabelSafe(data(profile, 'label'))) fail('unsafe-label');
  // Format 9: a new profile's tags follow the label rules and its note the note rules (line feeds allowed).
  const tags = data(profile, 'tags'), note = data(profile, 'note');
  if (Array.isArray(tags) && tags.some(tag => typeof tag === 'string' && !apiLabelSafe(tag)) || typeof note === 'string' && !apiNoteSafe(note)) fail('unsafe-label');
  return checked({ ...base, fingerprintProfiles: [...base.fingerprintProfiles, profile] });
}
export function applyFingerprintProfile(configuration, id) {
  const base = checked(configuration), profile = profileById(base, id), rows = new Map(profile.apis.map(row => [row.id, row]));
  // ADR-068: a library recipe contains neither master; applying it preserves
  // the independently chosen API Guard and Antidetect activation state.
  return checked({ ...base, preset: profile.preset, webrtcNetworkPolicy: profile.webrtcNetworkPolicy,
    apis: base.apis.map(row => ({ ...row, ...copy(rows.get(row.id)) })) });
}
export function deleteFingerprintProfile(configuration, id) {
  const base = checked(configuration); profileById(base, id);
  return checked({ ...base, fingerprintProfiles: base.fingerprintProfiles.filter(profile => profile.id !== id) });
}
export function renameFingerprintProfile(configuration, id, name) {
  const base = checked(configuration); profileById(base, id); const nextLabel = label(name);
  return checked({ ...base, fingerprintProfiles: base.fingerprintProfiles.map(profile => profile.id === id ? { ...profile, label: nextLabel } : profile) });
}

// --- Format 9 tags and notes (ADR-107 round 5) -------------------------------------------------------------------------
// Pure helpers behind the library's tag chips and note field. Both are part of the portable profile record, so every input is
// normalized here and then validated by the contract. Codes: 'unsafe-label' for refused characters (the contract's apiLabelSafe
// for a tag, apiNoteSafe for a note), 'invalid-value' for the limits. Texts already stored on the profile are grandfathered.
export const PROFILE_META_LIMITS = Object.freeze({ tags: API_PROFILE_MAX_TAGS, tag: API_PROFILE_TAG_MAX, note: API_PROFILE_NOTE_MAX });
const CR = String.fromCharCode(13), LF = String.fromCharCode(10), compareUnits = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// Trim, collapse inner whitespace, drop empty entries, collapse duplicates ignoring case (the first spelling stays) and sort by
// UTF-16 code unit, the order the contract stores. `known` lists tags the profile already holds: they skip the character test.
export function normalizeProfileTags(input, { known = [] } = {}) {
  if (!Array.isArray(input) || input.length > 8 * API_PROFILE_MAX_TAGS) fail('invalid-value');
  const seen = new Set(), result = [], grandfathered = new Set(known);
  for (let index = 0; index < input.length; index++) {
    const raw = Object.getOwnPropertyDescriptor(input, index)?.value;
    if (typeof raw !== 'string' || raw.length > 4 * API_PROFILE_TAG_MAX) fail('invalid-value');
    const tag = raw.trim().replace(/\s+/gu, ' ');
    if (!tag) continue;
    if (tag.length > API_PROFILE_TAG_MAX) fail('invalid-value');
    if (!apiLabelSafe(tag) && !grandfathered.has(tag)) fail('unsafe-label');
    const folded = tag.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded); result.push(tag);
  }
  if (result.length > API_PROFILE_MAX_TAGS) fail('invalid-value');
  return result.sort(compareUnits);
}
// Line breaks become line feeds (CRLF, and a lone CR from old text), the ends are trimmed; a line feed is the only control character kept.
export function normalizeProfileNote(input, { known } = {}) {
  if (typeof input !== 'string' || input.length > 4 * API_PROFILE_NOTE_MAX) fail('invalid-value');
  const note = input.split(CR + LF).join(LF).split(CR).join(LF).trim();
  if (note.length > API_PROFILE_NOTE_MAX) fail('invalid-value');
  if (!apiNoteSafe(note) && note !== known) fail('unsafe-label');
  return note;
}
// Replaces the tags and/or the note of one library profile; a key that is not in `patch` keeps its stored value. Nothing else
// in the profile or the configuration changes.
export function editProfileMeta(configuration, id, patch = {}) {
  const base = checked(configuration), profile = profileById(base, id);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('invalid-value');
  for (const key of Reflect.ownKeys(patch)) if (!['tags', 'note'].includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(patch, key), 'value')) fail('invalid-value');
  const tags = Object.hasOwn(patch, 'tags') ? normalizeProfileTags(data(patch, 'tags'), { known: profile.tags ?? [] }) : profile.tags ?? [];
  const note = Object.hasOwn(patch, 'note') ? normalizeProfileNote(data(patch, 'note'), { known: profile.note }) : profile.note ?? '';
  return checked({ ...base, fingerprintProfiles: base.fingerprintProfiles.map(row => row.id === id ? { ...row, tags, note } : row) });
}

function systemOf(agent) {
  if (typeof agent !== 'string') return null;
  if (/Android|iPhone|iPad|iPod/.test(agent)) return 'mobile';
  if (/Windows|Win32|Win64/.test(agent)) return 'windows';
  if (/Macintosh|MacIntel|Mac OS|macOS/.test(agent)) return 'macos';
  if (/Linux|X11/.test(agent)) return 'linux';
  return null;
}
function engineOf(agent) { return typeof agent === 'string' ? /(?:Chrome|Chromium)\/(\d+)/.exec(agent)?.[1] ? 'chromium' : /Firefox\/\d+/.test(agent) ? 'firefox' : null : null; }
function memoryValues(environment) {
  const agent = data(environment, 'userAgent'), major = typeof agent === 'string' ? Number(/(?:Chrome|Chromium)\/(\d+)/.exec(agent)?.[1]) : 0;
  return major >= 147 ? systemOf(agent) === 'mobile' ? [1, 2, 4, 8] : [2, 4, 8, 16, 32] : [0.25, 0.5, 1, 2, 4, 8];
}
function options(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid-value');
  const keys = ['recipe', 'system', 'language', 'display', 'variant'];
  for (const key of Reflect.ownKeys(input)) if (!keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), 'value')) fail('invalid-value');
  const result = { recipe: data(input, 'recipe') ?? 'balanced', system: data(input, 'system') ?? 'preserve', language: data(input, 'language') ?? 'preserve', display: data(input, 'display') ?? 'preserve', variant: data(input, 'variant') ?? 0 };
  if (!FINGERPRINT_RECIPES.some(row => row.id === result.recipe) || !FINGERPRINT_DISPLAYS.some(row => row.id === result.display) || !FINGERPRINT_SYSTEMS.includes(result.system) || !FINGERPRINT_LANGUAGES.includes(result.language) || !Number.isSafeInteger(result.variant) || result.variant < 0 || result.variant > 0xffffffff) fail('invalid-value');
  return result;
}

export function generateFingerprintConfiguration(configuration, input = {}, environment = {}) {
  const base = checked(configuration), next = copy(base), settings = options(input);
  const activeValue = id => { const row = next.apis.find(item => item.id === id);return row?.mode === 'custom' && row.selected.kind === 'value' ? row.selected.value : undefined; };
  const set = (id, raw) => {
    const row = next.apis.find(item => item.id === id);
    // Generating metadata must not cancel an explicit API block or rewrite its inactive selection.
    if (row?.mode === 'on') return;
    const result = validateApiValue(id, raw);
    if (!row || !result.ok || !row.customSupported || result.value.kind === 'unset') fail('invalid-value');
    row.mode = 'custom'; row.selected = result.value;
  };
  const value = (id, raw) => set(id, { kind: 'value', value: raw });
  const cpu = { balanced: [4, 8, 16], laptop: [4, 8, 12], desktop: [8, 12, 16], workstation: [16, 24, 32], strict: [4, 8, 16] }[settings.recipe];
  const threads = cpu[settings.variant % cpu.length], availableMemory = memoryValues({ userAgent: activeValue('navigator-user-agent') ?? data(environment, 'userAgent') });
  const memory = threads >= 16 ? 32 : threads >= 8 ? 16 : 8;
  value('hardware-concurrency', threads);
  value('device-memory', availableMemory.includes(memory) ? memory : availableMemory.at(-1));
  // No fake mobile pointer/hover support and no automatic cross-engine or GPU identity.
  if (systemOf(data(environment, 'userAgent')) !== 'mobile') value('touch-points', 0);
  const canvas = next.apis.find(row => row.id === 'canvas-readback');
  if (canvas?.customSupported) value('canvas-readback', { algorithm: 'stable-rgb-v1' });
  value('math-transcendentals', { algorithm: 'deterministic-ulp-v1', functions: [...API_MATH_FUNCTIONS] });
  value('canvas-text-metrics', { scale: 1 + (settings.variant % 9 + 1) / 1000 });
  const portableSeed = domain => domain + settings.variant.toString(16).padStart(8, '0') + '0000000000000000';
  const disableProjection = id => { const row = next.apis.find(row => row.id === id);if (row.mode === 'custom') row.mode = 'off'; };
  if (settings.recipe !== 'strict' && next.apis.find(row => row.id === 'audio').mode !== 'on') value('audio-fingerprint', { seed: portableSeed('41554449'), amplitude: 0.00001 });
  else disableProjection('audio-fingerprint');
  if (settings.recipe !== 'strict' && next.apis.find(row => row.id === 'webgl').mode !== 'on') value('webgl-readback', { seed: portableSeed('57454247') });
  else disableProjection('webgl-readback');
  const rtc = next.apis.find(row => row.id === 'webrtc');
  if (rtc.mode !== 'on') {
    const rtcValue = rtc.mode === 'custom' && rtc.selected.kind === 'value' ? copy(rtc.selected.value) : { addresses: null, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session' };
    // Alias only existing devices; an explicit block retains its mode and dormant values.
    rtcValue.randomizeDevices = true; rtcValue.deviceLifetime = 'site'; value('webrtc', rtcValue);
  }
  const media = next.apis.find(row => row.id === 'media-enumeration'); if (media.mode === 'custom') media.mode = 'off';
  if (settings.system !== 'preserve') {
    const agent = data(environment, 'userAgent'), appVersion = data(environment, 'appVersion');
    if (!engineOf(agent) || systemOf(agent) === 'mobile') fail('invalid-value');
    const target = { windows: { platform: 'Win32', oscpu: 'Windows NT 10.0; Win64; x64', token: 'Windows NT 10.0; Win64; x64', hints: 'Windows' },
      macos: { platform: 'MacIntel', oscpu: 'Intel Mac OS X 10.15', token: 'Macintosh; Intel Mac OS X 10_15_7', hints: 'macOS' },
      linux: { platform: 'Linux x86_64', oscpu: 'Linux x86_64', token: 'X11; Linux x86_64', hints: 'Linux' } }[settings.system];
    // Retain a Firefox rv token; every engine/version token outside the platform stays intact.
    const oldPlatform = /\(([^)]*)\)/.exec(agent)?.[1]; if (!oldPlatform) fail('invalid-value');
    const rv = /(?:^|;\s*)(rv:[^;\s)]+)/.exec(oldPlatform)?.[1];
    const replacement = target.token + (rv ? '; ' + rv : '');
    value('navigator-user-agent', agent.replace(/\([^)]*\)/, '(' + replacement + ')'));
    if (typeof appVersion === 'string' && appVersion.length <= 4096 && /\([^)]*\)/.test(appVersion)) {
      const appPlatform = /\(([^)]*)\)/.exec(appVersion)[1], appRv = /(?:^|;\s*)(rv:[^;\s)]+)/.exec(appPlatform)?.[1];
      const appTarget = engineOf(agent) === 'firefox' ? { windows: 'Windows', macos: 'Macintosh', linux: 'X11' }[settings.system] : target.token;
      value('navigator-app-version', appVersion.replace(/\([^)]*\)/, '(' + appTarget + (appRv ? '; ' + appRv : '') + ')'));
    }
    value('navigator-platform', target.platform);
    if (data(environment, 'hasOscpu') === true) value('navigator-oscpu', target.oscpu);
    const hints = data(environment, 'uaData');
    if (hints && Array.isArray(data(hints, 'brands'))) value('client-hints', { brands: data(hints, 'brands'), mobile: false, platform: target.hints });
  }
  if (settings.language !== 'preserve') {
    value('navigator-language', settings.language);
    value('navigator-languages', chromeLanguages(settings.language));
    const zone = activeValue('timezone');
    value('intl-formatting', { ...(activeValue('intl-formatting') ?? {}), locale: settings.language, ...(zone ? { timeZone: zone.timeZone } : {}) });
  }
  if (settings.display !== 'preserve') {
    const [width, height, ratio, taskbar] = { hd: [1366, 768, 1, 40], fullhd: [1920, 1080, 1, 40], qhd: [2560, 1440, 1, 40], retina: [1440, 900, 2, 25] }[settings.display];
    for (const [id, raw] of Object.entries({ 'screen-width': width, 'screen-height': height, 'screen-avail-width': width, 'screen-avail-height': height - taskbar, 'screen-color-depth': 24, 'screen-pixel-depth': 24, 'window-device-pixel-ratio': ratio, 'screen-extended': false })) value(id, raw);
    value('screen-orientation', { type: 'landscape-primary', angle: 0 });
    const viewportHeight = height - taskbar;
    value('screen-geometry', { ...(activeValue('screen-geometry') ?? {}), availLeft: 0, availTop: 0, innerWidth: width, innerHeight: viewportHeight, outerWidth: width, outerHeight: viewportHeight });
    value('css-media', { ...(activeValue('css-media') ?? {}), viewportWidth: width, viewportHeight, resolutionDppx: ratio });
  }
  if (settings.recipe === 'strict') {
    next.preset = 'strict';
    for (const id of ['local-fonts', 'window-management', 'audio', 'webgl', 'webgpu', 'battery', 'network-information', 'performance-memory', 'keyboard', 'compute-pressure', 'generic-sensors', 'device-motion', 'geolocation', 'bluetooth', 'usb', 'hid', 'serial']) next.apis.find(row => row.id === id).mode = 'on';
    // One Strict definition with generateConsistentDevice: the Windows font allow-list (core group; the Windows 11 names need
    // a known Windows 11, which this recipe does not know). A claim of another system keeps the empty list: Windows font
    // names would contradict it.
    const claimedSystem = settings.system !== 'preserve' ? settings.system : systemOf(activeValue('navigator-user-agent') ?? data(environment, 'userAgent'));
    value('canvas-font-policy', { families: claimedSystem === 'windows' ? windowsFonts() : [], fallback: 'sans-serif' });
  }
  const result = checked(next), difference = diffApiConfigurations(base, result); if (!difference.ok) fail('invalid-profile'); const changes = difference.value;
  return { configuration: result, changes, affected: [...new Set(changes.filter(change => change.scope === 'global' && change.id).map(change => change.id))], issues: fingerprintProfileIssues(result, environment) };
}

// The environment the issue rules see: the older snapshot (own data properties only, no accessor is invoked) plus the optional
// real-browser description that a caller passes next to the options (normalized and bounded, see normalizeEnvironment).
function withRealBrowser(environment, extra) {
  const out = {};
  if (environment && typeof environment === 'object') for (const key of Object.keys(environment)) { const found = Object.getOwnPropertyDescriptor(environment, key); if (found && Object.hasOwn(found, 'value')) out[key] = found.value; }
  Object.assign(out, normalizeEnvironment(extra));
  // normalizeEnvironment keeps only the proxy state; the country tag (the user's own note) is carried over from the raw sources.
  const country = proxyCountryOf(extra) ?? proxyCountryOf(environment);
  if (country) out.proxy = Object.freeze({ state: data(out.proxy, 'state') ?? 'unknown', country });
  return out;
}
// ADR-107 round 5: the country tag of the connected or linked proxy that a caller puts into `environment.proxy.country`. It is the
// user's own note (ISO 3166-1 alpha-2, a code the offline region table knows); nothing is detected or looked up. null when absent
// or malformed. Read as an own data property only.
export function proxyCountryOf(environment) {
  const country = data(data(environment, 'proxy'), 'country');
  return typeof country === 'string' && /^[A-Z]{2}$/u.test(country) && regionByCode(country) !== null ? country : null;
}

// Canvas readback noise: sparse-rgb-v2 is the default once the contract accepts it (catalogue 11, ADR-112), then sparse-rgb-v1 (catalogue 8),
// then the stable one. The validator decides, so no catalogue version is compared here. `accepts` is injectable for tests. A saved profile
// keeps the algorithm it was saved with; only a profile that is generated or switched on again gets the default.
export const CANVAS_ALGORITHMS = Object.freeze(['sparse-rgb-v2', 'sparse-rgb-v1', 'stable-rgb-v1']);
export function canvasProjection(accepts = algorithm => validateApiValue('canvas-readback', { kind: 'value', value: { algorithm } }).ok) {
  return { algorithm: CANVAS_ALGORITHMS.find(algorithm => accepts(algorithm)) ?? CANVAS_ALGORITHMS[CANVAS_ALGORITHMS.length - 1] };
}

// Guarded row access shared by the two device generators. An explicit page block (mode 'on') is never cancelled, every value
// goes through the contract validator, `reset` returns only Custom rows to «as in the browser», and `intl` merges keys into the
// shared `intl-formatting` row (a key set to undefined is removed; an empty row is reset).
function rowTools(next) {
  const row = id => next.apis.find(item => item.id === id);
  const activeValue = id => { const found = row(id); return found?.mode === 'custom' && found.selected.kind === 'value' ? found.selected.value : undefined; };
  const set = (id, raw) => {
    const found = row(id);
    if (found?.mode === 'on') return;
    const result = validateApiValue(id, raw);
    if (!found || !result.ok || !found.customSupported || result.value.kind === 'unset') fail('invalid-value');
    found.mode = 'custom'; found.selected = result.value;
  };
  const value = (id, raw) => set(id, { kind: 'value', value: MERGED_ROWS.has(id) ? { ...(activeValue(id) ?? {}), ...raw } : raw });
  const reset = ids => { for (const id of ids) { const found = row(id); if (found?.mode === 'custom') { found.mode = 'bypass'; found.selected = { kind: 'unset' }; } } };
  const intl = changes => {
    const merged = { ...(activeValue('intl-formatting') ?? {}) };
    for (const [key, raw] of Object.entries(changes)) { if (raw === undefined) delete merged[key]; else merged[key] = raw; }
    if (Object.keys(merged).length) value('intl-formatting', merged); else reset(['intl-formatting']);
  };
  return { row, activeValue, set, value, reset, intl };
}
// A Chromium (Chrome/Edge) claim also needs Chrome's navigator.vendor 'Google Inc.' and no navigator.oscpu (Chrome has none: the
// Custom 'undefined' state). Written only when THIS browser is not Chromium (Firefox reports vendor '' and an oscpu string) or is
// unknown; a Chromium host already has both values natively and gets no extra Custom rows.
function writeChromiumExtras(tools, environment) {
  if (chromiumIdentity(undefined, environment)) return;
  tools.value('navigator-vendor', 'Google Inc.');
  tools.set('navigator-oscpu', { kind: 'undefined' });
}
// True while a row is Custom and still holds exactly `raw` (compared in the validator's canonical form).
function holdsValue(found, raw) {
  if (found?.mode !== 'custom' || found.selected.kind !== 'value') return false;
  const canonical = validateApiValue(found.id, { kind: 'value', value: raw });
  return canonical.ok && JSON.stringify(canonical.value.value) === JSON.stringify(found.selected.value);
}

// --- Region (ADR-104 addendum 4): one offline "where am I" statement ---------------------------------------------------
// A region owns the time zone, the language pair, the Intl locale and zone and, where the contract has the shape, the Custom
// geolocation of its default city. The data module is offline and pure: nothing is measured, fetched or looked up by IP.
export const REGION_GEOLOCATION_ACCURACY = 25;
const REGION_ROWS = Object.freeze(['timezone', 'navigator-language', 'navigator-languages', 'geolocation']);
export function regionClaim(raw) {
  // Two letters, case-insensitive; the data module decides which codes exist. Nothing else is coerced.
  if (typeof raw !== 'string' || !/^[A-Za-z]{2}$/u.test(raw)) fail('invalid-value');
  const defaults = regionDefaults(raw.toUpperCase());
  if (!defaults || typeof defaults.timeZone !== 'string' || typeof defaults.locale !== 'string' || !Array.isArray(defaults.languages) || defaults.languages.length === 0) fail('invalid-value');
  const timeZone = canonicalTimeZone(defaults.timeZone), offsetMinutes = standardOffsetMinutes(timeZone);
  if (offsetMinutes === null) fail('invalid-value');
  const placed = Number.isFinite(defaults.latitude) && Number.isFinite(defaults.longitude);
  return { code: defaults.code, timeZone, offsetMinutes, locale: defaults.locale, languages: [...defaults.languages],
    geolocation: placed ? { latitude: defaults.latitude, longitude: defaults.longitude, accuracy: Number.isFinite(defaults.accuracy) ? defaults.accuracy : REGION_GEOLOCATION_ACCURACY } : null };
}
export function writeRegionRows({ row, value, intl }, claim) {
  value('navigator-language', claim.languages[0]);
  value('navigator-languages', claim.languages);
  intl({ locale: claim.locale, timeZone: claim.timeZone });
  value('timezone', { timeZone: claim.timeZone, offsetMinutes: claim.offsetMinutes });
  // The Custom geolocation exists only where the contract has the shape; `value` keeps an explicit page block.
  if (claim.geolocation && row('geolocation')?.customSupported) value('geolocation', claim.geolocation);
}
function clearRegion({ reset, intl }) {
  reset(REGION_ROWS);
  intl({ locale: undefined, timeZone: undefined });
}

// --- Geolocation vs time zone hint -------------------------------------------------------------------------------------
// A page reads navigator.geolocation next to Intl and Date, so coordinates far from the chosen zone are a visible mismatch.
// The zone's principal point is its listed city in the region data; 2500 km is wider than any single zone of a small country
// and still flags "Tokyo coordinates, Berlin zone". Read-only: the hint never rewrites a value.
export const GEOLOCATION_ZONE_MAX_KM = 2500;
const EARTH_RADIUS_KM = 6371;
export function greatCircleKm(from, to) {
  const rad = Math.PI / 180, dLat = (to.latitude - from.latitude) * rad, dLon = (to.longitude - from.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(from.latitude * rad) * Math.cos(to.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
const ANCHORS = new Map();
// { latitude, longitude } of the listed city of a zone, or null when no region lists it (UTC, Etc/*, unknown ids).
export function zonePrincipalPoint(iana) {
  if (typeof iana !== 'string') return null;
  if (ANCHORS.has(iana)) return ANCHORS.get(iana);
  let anchor = null;
  const code = regionOfTimeZone(iana), region = typeof code === 'string' ? regionByCode(code) : null;
  if (region && Array.isArray(region.zones)) {
    const wanted = canonicalTimeZone(iana), zone = region.zones.find(entry => entry.iana === iana || canonicalTimeZone(entry.iana) === wanted);
    if (zone && Number.isFinite(zone.lat) && Number.isFinite(zone.lon)) anchor = { latitude: zone.lat, longitude: zone.lon };
  }
  if (ANCHORS.size >= 512) ANCHORS.clear();
  ANCHORS.set(iana, anchor);
  return anchor;
}

// ADR-104: build an internally consistent reported device (ТЗ «Рандомизировать»). Applies
// only values the validator already accepts, through the same guarded setter as above, and
// returns the same { configuration, changes, affected, issues } plus a device summary for the
// visual card. No new Custom type, API or capability; WebRTC/network stay on level 4.
export function generateConsistentDevice(configuration, input = {}, environment = {}) {
  const base = checked(configuration), next = copy(base);
  const seed = Number.isInteger(input.seed) ? input.seed >>> 0 : (globalThis.crypto?.getRandomValues(new Uint32Array(1))[0] ?? 0);
  // An explicit page block is never cancelled by generation (see rowTools).
  const tools = rowTools(next), { activeValue, value } = tools;
  // Protection preset (Отчёт/ТЗ), shaped by the live audit so that "keeping sites working" is true:
  // compatibility = identity values only (no behaviour change anywhere);
  // balanced (default, recommended) = identity + Canvas/Audio readback + Math (all keyed by the profile seed);
  // strict = balanced + the protections that can break sites (canvas text-metric scale, canvas font allow-list,
  // WebGL readPixels projection, window geometry/media viewport) + NEUTRAL Custom values for the high-entropy sensor/hardware
  // surfaces (battery, network, heap, Bluetooth, USB/HID/serial, game pads, voices); only the three rows that have no Custom
  // shape (STRICT_BLOCK_ONLY) are still blocked.
  const protection = ['compatibility', 'balanced', 'strict'].includes(input.protection) ? input.protection : 'balanced';
  const strict = protection === 'strict', render = protection !== 'compatibility';
  // `input.environment` (and the older environment snapshot) describe the real browser: its build numbers and Windows
  // version are reused only when the claim is that same browser, and a drawn thread count never exceeds the real one.
  const realBrowser = normalizeEnvironment(input.environment, environment);
  // ADR-110 addendum: `input.fontNoise === true` (read by buildDeviceValues; only Strict writes the font list) leaves about 3 % of the optional names out
  // of the generated Windows list, chosen by `seed` (fingerprint-font-noise.js): the same seed gives the same list.
  const { values, summary } = buildDeviceValues({ ...input, seed, geometry: strict, fonts: strict, environment: realBrowser });
  for (const { id, raw } of values) value(id, raw);
  writeChromiumExtras(tools, realBrowser);
  // ADR-107: no screen could hold this browser's real window, so the screen stays native, including rows of an earlier device.
  if (summary.screen === null) tools.reset(DEVICE_ROW_GROUPS.screen);
  // A preset is a complete statement: rows that belong to a STRONGER preset go back to "as in the browser" when a lighter one
  // is generated, so Compatibility after Strict really is minimal. Explicit page blocks are never touched.
  for (const [id, keep] of Object.entries({ 'canvas-readback': render, 'audio-fingerprint': render, 'math-transcendentals': render, 'canvas-text-metrics': strict, 'webgl-readback': strict, 'canvas-font-policy': strict, 'screen-geometry': strict, 'css-media': strict })) {
    const row = next.apis.find(item => item.id === id);
    if (!keep && row?.mode === 'custom') { row.mode = 'bypass'; row.selected = { kind: 'unset' }; }
  }
  // The neutral sensor values of Strict go back the same way, but only while a row still holds exactly the value Strict writes:
  // a value the user chose themselves is never removed by a preset, and neither is a block (mode 'on' is not Custom).
  if (!strict) for (const { id, raw } of neutralSensorValues()) if (holdsValue(next.apis.find(item => item.id === id), raw)) tools.reset([id]);
  // Deterministic render-fingerprint protections keyed by the profile seed (stable per profile,
  // not re-randomized per read). Skipped where the page explicitly blocks the API.
  if (render) {
    if (next.apis.find(row => row.id === 'canvas-readback')?.customSupported) value('canvas-readback', canvasProjection());
    value('math-transcendentals', { algorithm: 'deterministic-ulp-v1', functions: [...API_MATH_FUNCTIONS] });
    if (next.apis.find(row => row.id === 'audio').mode !== 'on') value('audio-fingerprint', { seed: portableSeed('a0d10', seed), amplitude: 0.00001 });
  }
  if (strict) {
    value('canvas-text-metrics', { scale: 1 + (seed % 9 + 1) / 1000 });
    if (next.apis.find(row => row.id === 'webgl').mode !== 'on') value('webgl-readback', { seed: portableSeed('e6102', seed) });
    // High-entropy sensor/hardware surfaces report NEUTRAL Custom values (typical desktop Chrome, not measured on this machine)
    // instead of disappearing (owner decision 2026-11-05). An explicit page block stays, and a row that is already Custom is the
    // user's own choice: both already keep the real value away from the page, so neither is overwritten.
    // ADR-107: the heap value is written only for its measured class (Chrome 156, deviceMemory >= 16); a Strict device of another
    // class takes back the measured value an earlier Strict device wrote.
    const claim = { chromeMajor: summary.version, reportedMemory: summary.reportedMemory };
    for (const { id, raw } of neutralSensorValues(claim)) {
      const row = next.apis.find(item => item.id === id);
      if (row && row.mode !== 'on' && row.mode !== 'custom') value(id, raw);
    }
    if (!heapClassMeasured(claim) && holdsValue(next.apis.find(item => item.id === 'performance-memory'), MEASURED_HEAP.value)) tools.reset(['performance-memory']);
    // The ONLY remaining blocks: the contract has no Custom shape for these rows (customSupported is false), so there is no
    // neutral value to report. Pinned by scripts/test/fingerprint-strict-neutral.test.mjs.
    for (const id of STRICT_BLOCK_ONLY) {
      const row = next.apis.find(item => item.id === id);
      if (row && row.mode !== 'custom') row.mode = 'on';
    }
  }
  // Region (ADR-104 addendum 4): undefined leaves the rows alone, a code writes them, null returns them to the browser. An
  // explicit language or time zone below still wins, as the finer choice.
  const region = data(input, 'region');
  if (region === null) clearRegion(tools);
  else if (region !== undefined) writeRegionRows(tools, regionClaim(region));
  // The browser reports ICU-canonical zone ids; writing the same spelling to the legacy `timezone` row and to `intl-formatting`
  // keeps one profile from showing two spellings of one zone.
  const zone = typeof input.timezone?.timeZone === 'string' ? canonicalTimeZone(input.timezone.timeZone) : null;
  if (typeof input.language === 'string' && input.language) {
    value('navigator-language', input.language);
    value('navigator-languages', chromeLanguages(input.language));
    value('intl-formatting', { ...(activeValue('intl-formatting') ?? {}), locale: input.language, ...(zone ? { timeZone: zone } : {}) });
  }
  if (zone !== null) value('timezone', { timeZone: zone, offsetMinutes: Number.isFinite(input.timezone.offsetMinutes) ? input.timezone.offsetMinutes : 0 });
  // ADR-110 addendum 2: the claimed region (the one the region card shows: derived from the time zone rows written above, or kept from an earlier claim) adds the
  // regional CJK group to the Windows font list that Strict wrote above; a region without a group leaves that list as it is. Nothing is detected or measured.
  const claimedRegion = strict ? describeDevice(activeValue).region : null;
  if (regionFontGroup(claimedRegion) !== null) for (const { id, raw } of fontValues(generatedFontOptions(input, summary.os, seed, claimedRegion))) value(id, raw);
  const result = checked(next), difference = diffApiConfigurations(base, result); if (!difference.ok) fail('invalid-profile'); const changes = difference.value;
  return { configuration: result, changes, summary, affected: [...new Set(changes.filter(change => change.scope === 'global' && change.id).map(change => change.id))], issues: fingerprintProfileIssues(result, withRealBrowser(environment, input.environment)) };
}

// `scale` is the Windows display scale of the screen (a number the panel really has, see screenScalesFor; null = the
// default of the ladder id). `environment` is plain data about the real browser (see normalizeEnvironment); it only keeps
// the claim from contradicting that browser and writes no row itself.
export const DEVICE_PATCH_KEYS = Object.freeze(['cores', 'ramGb', 'diskGb', 'gpu', 'screen', 'scale', 'os', 'browser', 'version', 'language', 'timezone', 'region', 'fonts', 'canvas', 'audio', 'webgl', 'seed', 'environment']);
// ADR-104 level controls (sliders, selects, switches): change exactly the rows a control owns plus
// the rows that must stay consistent with it. A `null` value returns the control to «as in preset».
export function applyDevicePatch(configuration, patch = {}, environment = {}) {
  const base = checked(configuration), next = copy(base);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('invalid-value');
  for (const key of Reflect.ownKeys(patch)) if (!DEVICE_PATCH_KEYS.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(patch, key), 'value')) fail('invalid-value');
  const has = key => Object.hasOwn(patch, key), input = key => data(patch, key);
  // An explicit page block is never cancelled by a level control (see rowTools).
  const tools = rowTools(next), { activeValue, value, reset, intl } = tools;
  const apply = rows => { for (const entry of rows) value(entry.id, entry.raw); };
  const current = describeDevice(activeValue), realBrowser = normalizeEnvironment(input('environment'), environment);
  // ADR-107: the version list reaches up to this browser's real major when it is newer than the static list.
  const versions = browserVersions(realBrowser);
  const os = has('os') ? input('os') : current.os ?? 'windows-11', browser = has('browser') ? input('browser') : current.browser ?? 'chrome', version = has('version') ? input('version') : current.version ?? versions[0];
  // A chosen version must be on this browser's list; a claimed one only has to be a real version (a profile saved on a newer
  // browser stays editable here).
  if (!DEVICE_OS.includes(os) || !DEVICE_BROWSERS.includes(browser) || !(has('version') ? versions.includes(version) : claimableVersion(version))) fail('invalid-value');
  // Identity-free controls: a number or id from a closed list, or null to reset.
  const closed = (key, list, group, build) => {
    if (!has(key)) return;
    const raw = input(key);
    if (raw === null) { reset(group); return; }
    if (!list.includes(raw)) fail('invalid-value');
    apply(build(raw));
  };
  closed('cores', CPU_STEPS, DEVICE_ROW_GROUPS.cores, processorValues);
  closed('ramGb', RAM_STEPS, DEVICE_ROW_GROUPS.ramGb, ramGb => deviceMemoryValues(ramGb, version));
  if (has('diskGb') && input('diskGb') !== null && !DISK_STEPS.includes(input('diskGb'))) fail('invalid-value');
  closed('gpu', GPU_PRESETS.map(entry => entry.id), DEVICE_ROW_GROUPS.gpu, gpuValues);
  // Fonts. `null` returns the row to the browser at once. A Windows list is written after the region and time zone steps below, because the claimed region
  // decides its regional CJK group (ADR-110 addendum 2): an explicit «Windows» writes the plain list (the Windows 11 only names only while Windows 11 is
  // claimed); a change of the claimed Windows, region or time zone keeps the groups of a Windows list, and a list with font noise stays noisy (the noise
  // follows the names it had left out).
  let fontList = null;
  if (has('fonts')) {
    const raw = input('fonts');
    if (raw === null) reset(DEVICE_ROW_GROUPS.fonts); else if (raw === 'windows') fontList = 'plain'; else fail('invalid-value');
  } else if ((has('os') || has('region') || has('timezone')) && current.fonts === 'windows') fontList = 'follow';
  // An explicit scale must be one the chosen (or current) panel has; without a known screen there is nothing to scale.
  let scale;
  if (has('scale') && input('scale') !== null) {
    scale = input('scale');
    if (typeof scale !== 'number' || !screenScalesFor(has('screen') ? input('screen') : current.screen).includes(scale)) fail('invalid-value');
  }
  const screenRows = id => screenValues(id, os, { geometry: activeValue('screen-geometry') !== undefined || activeValue('css-media') !== undefined, scale, browser });
  if (has('screen')) closed('screen', SCREEN_PRESETS.map(entry => entry.id), DEVICE_ROW_GROUPS.screen, screenRows);
  else if (has('scale') && current.screen) apply(screenRows(current.screen));
  // The taskbar differs per Windows version, so a known screen keeps its available area (and its scale) in step with the OS.
  else if (has('os') && current.screen) apply(screenValues(current.screen, os, { geometry: activeValue('screen-geometry') !== undefined, scale: current.scale ?? undefined, browser }));
  if (has('os') || has('browser') || has('version')) { apply(identityValues({ os, browser, version, environment: realBrowser })); writeChromiumExtras(tools, realBrowser); }
  // ADR-107 Disk control: Chrome reports a fixed quota (usage + 10 GiB) whatever the disk is, so for a Chromium identity (after the
  // identity rows above; without a claim, this browser's) the control returns the quota to native; it writes the quota share only
  // for another engine. null always returns it to native.
  if (has('diskGb')) {
    const disk = input('diskGb');
    if (disk === null || chromiumIdentity(activeValue('navigator-user-agent'), realBrowser)) reset(DEVICE_ROW_GROUPS.diskGb); else apply(storageValues(disk));
  }
  // Region first, so an explicit language or time zone in the same patch still wins as the finer choice.
  if (has('region')) {
    const code = input('region');
    if (code === null) clearRegion(tools); else writeRegionRows(tools, regionClaim(code));
  }
  if (has('language')) {
    const language = input('language');
    if (language === null) { reset(DEVICE_ROW_GROUPS.language); intl({ locale: undefined }); }
    else {
      if (typeof language !== 'string' || !FINGERPRINT_LANGUAGES.includes(language) || language === 'preserve') fail('invalid-value');
      value('navigator-language', language); value('navigator-languages', chromeLanguages(language)); intl({ locale: language });
    }
  }
  if (has('timezone')) {
    const zone = input('timezone');
    if (zone === null) { reset(DEVICE_ROW_GROUPS.timezone); intl({ timeZone: undefined }); }
    else {
      if (!zone || typeof zone !== 'object' || typeof data(zone, 'timeZone') !== 'string') fail('invalid-value');
      const offset = data(zone, 'offsetMinutes'), timeZone = canonicalTimeZone(data(zone, 'timeZone'));
      value('timezone', { timeZone, offsetMinutes: Number.isFinite(offset) ? offset : 0 });
      if (activeValue('intl-formatting') !== undefined) intl({ timeZone });
    }
  }
  if (fontList !== null) {
    // The list is rewritten for an explicit choice, for a change of the claimed Windows, or when the regional group of the claimed region differs; a region or
    // time zone patch that leaves the group as it is leaves the list (and its noise) alone.
    const region = describeDevice(activeValue).region;
    if (fontList === 'plain' || has('os') || regionFontGroup(region) !== current.fontRegion) {
      apply(fontList === 'plain' ? fontValues({ windows11: os === 'windows-11', region }) : fontValues({ ...current.fontGroups, windows11: os === 'windows-11', region, ...(current.fontNoise ? { followNoise: current.fontHidden } : {}) }));
    }
  }
  const seed = Number.isInteger(input('seed')) ? input('seed') >>> 0 : (globalThis.crypto?.getRandomValues(new Uint32Array(1))[0] ?? 0);
  for (const [key, id, build] of [['canvas', 'canvas-readback', canvasProjection], ['audio', 'audio-fingerprint', () => ({ seed: portableSeed('a0d10', seed), amplitude: 0.00001 })], ['webgl', 'webgl-readback', () => ({ seed: portableSeed('e6102', seed) })]]) {
    if (!has(key)) continue;
    const on = input(key);
    if (on !== true && on !== false && on !== null) fail('invalid-value');
    if (on === true) value(id, build()); else reset(DEVICE_ROW_GROUPS[key]);
  }
  const result = checked(next), difference = diffApiConfigurations(base, result); if (!difference.ok) fail('invalid-profile'); const changes = difference.value;
  const resultValue = id => { const found = result.apis.find(item => item.id === id); return found?.mode === 'custom' && found.selected.kind === 'value' ? found.selected.value : undefined; };
  return { configuration: result, changes, device: describeDevice(resultValue), affected: [...new Set(changes.filter(change => change.scope === 'global' && change.id).map(change => change.id))], issues: fingerprintProfileIssues(result, withRealBrowser(environment, input('environment'))) };
}

export function fingerprintProfileIssues(configuration, environment = {}) {
  const base = checked(configuration), rows = new Map(base.apis.map(row => [row.id, row]));
  const current = id => { const row = rows.get(id); return row?.mode === 'custom' && row.selected.kind === 'value' ? row.selected.value : undefined; };
  const issues = [], issue = (code, ids, severity = 'warning', detail = undefined) => { if (!issues.some(row => row.code === code)) issues.push({ code, ids, severity, ...(detail ? { detail } : {}) }); };
  const agent = current('navigator-user-agent'), platform = current('navigator-platform'), hints = current('client-hints');
  const targetSystem = systemOf(agent ?? data(environment, 'userAgent'));
  const platformSystem = targetSystem === 'mobile' && /Android/.test(agent ?? data(environment, 'userAgent') ?? '') && /^Linux (?:arm|aarch64)/i.test(platform ?? '') ? 'mobile' : systemOf(platform);
  if (platform && targetSystem && platformSystem && targetSystem !== platformSystem) issue('platform-agent', ['navigator-platform', 'navigator-user-agent']);
  if (hints && targetSystem && systemOf(hints.platform) && targetSystem !== systemOf(hints.platform)) issue('client-hints-agent', ['client-hints', 'navigator-user-agent']);
  const language = current('navigator-language'), languages = current('navigator-languages');
  if (language && languages && languages[0] !== language) issue('language-list', ['navigator-language', 'navigator-languages']);
  const width = current('screen-width'), height = current('screen-height'), aw = current('screen-avail-width'), ah = current('screen-avail-height');
  if (width !== undefined && aw !== undefined && aw > width || height !== undefined && ah !== undefined && ah > height) issue('screen-available', ['screen-width', 'screen-height', 'screen-avail-width', 'screen-avail-height']);
  const depth = current('screen-color-depth'), pixel = current('screen-pixel-depth');
  if (depth !== undefined && pixel !== undefined && depth !== pixel) issue('screen-depth', ['screen-color-depth', 'screen-pixel-depth']);
  const orientation = current('screen-orientation');
  if (orientation && width && height && (orientation.type.startsWith('landscape') ? width < height : width > height)) issue('orientation-size', ['screen-orientation', 'screen-width', 'screen-height']);
  const gl = current('webgl'), gpu = current('webgpu');
  const family = raw => typeof raw !== 'string' ? null : /\bnvidia\b/i.test(raw) ? 'nvidia' : /\bintel\b/i.test(raw) ? 'intel' : /\b(?:amd|ati)\b/i.test(raw) ? 'amd' : /\bapple\b/i.test(raw) ? 'apple' : null;
  if (gl && gpu && typeof gl.unmaskedVendor === 'string' && typeof gpu.vendor === 'string') {
    if (family(gl.unmaskedVendor) && family(gpu.vendor) && family(gl.unmaskedVendor) !== family(gpu.vendor)) issue('gpu-pair', ['webgl', 'webgpu']);
  }
  const memory = current('device-memory'); if (memory !== undefined && !memoryValues({ userAgent: agent ?? data(environment, 'userAgent') }).includes(memory)) issue('memory-bucket', ['device-memory']);
  if (current('timezone')) issue('timezone-metadata', ['timezone'], 'info');
  if (agent && typeof data(environment, 'userAgent') === 'string' && agent !== data(environment, 'userAgent') || hints && hints.platform !== data(data(environment, 'uaData'), 'platform')) issue('network-ua', ['navigator-user-agent', 'client-hints'], 'info');
  if (language && typeof data(environment, 'language') === 'string' && language !== data(environment, 'language')) issue('network-language', ['navigator-language', 'navigator-languages'], 'info');
  if (['screen-width', 'screen-height', 'window-device-pixel-ratio', 'screen-orientation'].some(id => current(id) !== undefined)) issue('screen-css', ['screen-width', 'screen-height', 'window-device-pixel-ratio'], 'info');
  if (base.apis.some(row => row.mode === 'custom')) issue('worker-scope', [], 'info');

  // Coherence rules added with the realistic-device work. Read-only hints: each one needs the rows it compares to be
  // set (a missing row never raises an issue) and none of them rewrites a value. `real` is the optional description of
  // the browser that runs the picker (normalizeEnvironment); rules that need it stay silent without it.
  const real = normalizeEnvironment(environment), isNumber = value => typeof value === 'number' && Number.isFinite(value);
  const ratio = current('window-device-pixel-ratio'), geometry = current('screen-geometry'), media = current('css-media'), touch = current('touch-points'), cores = current('hardware-concurrency');
  // Windows scaling steps; a custom scale (for example 110 %) exists on real machines but is rare.
  if (ratio !== undefined && !WINDOWS_SCALES.includes(ratio)) issue('dpr-step', ['window-device-pixel-ratio']);
  if (geometry) {
    // inner <= outer <= avail <= screen on both axes, and the window position inside the screen.
    const outOfOrder = (inner, outer, avail, size, position) => {
      const chain = [inner, outer, avail, size].filter(isNumber);
      return chain.some((entry, index) => index > 0 && entry < chain[index - 1]) || isNumber(position) && (position < 0 || isNumber(size) && position >= size);
    };
    if (outOfOrder(geometry.innerWidth, geometry.outerWidth, aw, width, geometry.screenX) || outOfOrder(geometry.innerHeight, geometry.outerHeight, ah, height, geometry.screenY)) issue('window-bounds', ['screen-geometry', 'screen-avail-width', 'screen-avail-height']);
    // Browser tabs and address bar take at least ~80 CSS px (measured: Chrome 86.7, Edge 84, a non-maximized window 94).
    if (isNumber(geometry.innerHeight) && isNumber(geometry.outerHeight) && geometry.outerHeight - geometry.innerHeight < WINDOW_CHROME_MIN) issue('window-chrome', ['screen-geometry']);
  }
  if (media) {
    const differs = (left, right) => left !== undefined && right !== undefined && left !== right;
    if (geometry && (differs(media.viewportWidth, geometry.innerWidth) || differs(media.viewportHeight, geometry.innerHeight)) || differs(media.resolutionDppx, ratio)) issue('media-geometry', ['css-media', 'screen-geometry', 'window-device-pixel-ratio']);
  }
  if (isNumber(touch) && touch > 10) issue('touch-range', ['touch-points']);
  // Windows reports a coarse pointer exactly when a touch screen exists.
  if (isNumber(touch) && media?.anyPointer !== undefined && (touch > 0) !== (media.anyPointer === 'coarse')) issue('touch-media', ['touch-points', 'css-media']);
  if (isNumber(width) && isNumber(height) && height > width || isNumber(width) && width < 1024 || isNumber(height) && height < 600) issue('screen-shape', ['screen-width', 'screen-height']);
  if ([depth, pixel].some(entry => entry !== undefined && entry !== 24 && entry !== 30)) issue('color-depth', ['screen-color-depth', 'screen-pixel-depth']);
  const claimedSystem = targetSystem ?? platformSystem ?? systemOf(hints?.platform);
  if (claimedSystem === 'windows' && typeof gl?.unmaskedRenderer === 'string' && gl.unmaskedRenderer !== '' && (!/^ANGLE \(.*Direct3D11/u.test(gl.unmaskedRenderer) || /SwiftShader|Basic Render|llvmpipe/iu.test(gl.unmaskedRenderer))) issue('gpu-os', ['webgl']);
  if (gpu) {
    // Chrome prints only vendor and architecture; device and description are blank.
    const vocabulary = WEBGPU_ARCHITECTURES[typeof gpu.vendor === 'string' ? gpu.vendor.toLowerCase() : ''];
    if (gpu.architecture === '' || vocabulary && !vocabulary.includes(gpu.architecture) || gpu.device !== '' || gpu.description !== '') issue('gpu-shape', ['webgpu']);
    const glFamily = family(gl?.unmaskedVendor) ?? family(gl?.unmaskedRenderer), gpuFamily = family(gpu.vendor);
    if (glFamily && gpuFamily && glFamily !== gpuFamily) issue('webgpu-gpu', ['webgl', 'webgpu']);
  }
  // Host rules need the real browser. They are information, not an error: the claim is a choice, and the hint says what a page can still measure.
  const claimedFamily = [agent, platform, hints?.platform].map(systemOf).find(Boolean);
  if (real.platform && claimedFamily && (claimedFamily === 'macos' ? 'mac' : claimedFamily) !== real.platform) issue('host-os', ['navigator-platform', 'navigator-user-agent'], 'info');
  // engine-version (info): since ADR-105 the HTTP headers (User-Agent, Accept-Language, Sec-CH-UA) follow the claim in Chrome with
  // all-sites access, so what still shows the real major is the engine itself (features and behaviour of that version; high-entropy
  // Client Hints are refused to servers) and, in Firefox or another scope, the headers too. issueFix retargets the claim.
  const claimedMajor = typeof agent === 'string' ? Number(/(?:Chrome|Chromium)\/(\d+)/.exec(agent)?.[1]) : Number(hints?.brands?.find(entry => entry.brand === 'Chromium')?.version);
  if (Number.isInteger(claimedMajor) && real.uaMajor !== undefined && claimedMajor !== real.uaMajor) issue('engine-version', ['navigator-user-agent', 'client-hints'], 'info');
  // Pages can time workers to count real threads, so a claim above the real count is measurable.
  if (isNumber(cores) && real.hardwareConcurrency !== undefined && cores > real.hardwareConcurrency) issue('cores-above-real', ['hardware-concurrency']);
  // Without a window-geometry row the native window stays real, and a native window cannot be larger than the claimed screen.
  if (!geometry && (isNumber(width) || isNumber(height))) {
    const reference = real.outer ?? real.screen;
    if (reference && (isNumber(width) && isNumber(reference.width) && width < reference.width || isNumber(height) && isNumber(reference.height) && height < reference.height)) issue('screen-vs-real', ['screen-width', 'screen-height']);
  }
  // A real browser shows host candidates next to its STUN/TURN ones.
  const rtc = current('webrtc')?.addresses;
  if (rtc?.ipv4 && rtc.ipv6 && !rtc.ipv4.host && !rtc.ipv6.host && [rtc.ipv4.stun, rtc.ipv4.turn, rtc.ipv6.stun, rtc.ipv6.turn].some(address => address !== null)) issue('webrtc-shape', ['webrtc']);
  // Coordinates far from where the chosen zone lies (the `timezone` row, else the zone of `intl-formatting`). Needs both rows and a
  // zone some region lists; a zone without a known principal point never raises it.
  const place = current('geolocation'), zoneRow = typeof current('timezone')?.timeZone === 'string' ? 'timezone' : 'intl-formatting', zoneId = current(zoneRow)?.timeZone;
  if (place && typeof zoneId === 'string') {
    const anchor = zonePrincipalPoint(zoneId);
    if (anchor && greatCircleKm(place, anchor) > GEOLOCATION_ZONE_MAX_KM) issue('geolocation-timezone-mismatch', ['geolocation', zoneRow]);
  }

  // --- ADR-107 rules (ShardBrowser comparison). Read-only like the rest; the ones about THIS browser need the environment. ---
  const chromium = chromiumIdentity(agent, real);
  // memory-above-real (info): the claimed deviceMemory is above this browser's own, where that is an upper bound (memoryBound).
  const realMemory = memoryBound(real);
  if (isNumber(memory) && realMemory !== undefined && memory > realMemory) issue('memory-above-real', ['device-memory'], 'info');
  // language-timezone (info): the primary language is not a language of the region the selected zone belongs to (base subtags;
  // English is in every non-English region's list). A zone no region lists is not judged.
  const zoneRegion = typeof zoneId === 'string' ? regionOfTimeZone(zoneId) : null;
  if (typeof language === 'string' && typeof zoneRegion === 'string') {
    const bases = new Set((regionByCode(zoneRegion)?.languages ?? []).map(tag => tag.split('-')[0].toLowerCase()));
    if (bases.size && !bases.has(language.split('-')[0].toLowerCase())) issue('language-timezone', ['navigator-language', zoneRow], 'info');
  }
  // proxy-locale-host (info): a proxy is connected while the time zone, the language or the Intl locale is still this computer's.
  if (real.proxy?.state === 'connected') {
    const nativeRows = [...(typeof zoneId === 'string' ? [] : ['timezone']), ...(language === undefined && languages === undefined ? ['navigator-language'] : []),
      ...(typeof current('intl-formatting')?.locale === 'string' ? [] : ['intl-formatting'])];
    if (nativeRows.length) issue('proxy-locale-host', nativeRows, 'info');
  }
  // proxy-country-region (ADR-107 round 5; warning, or info when only the language disagrees): the country tag of the connected or
  // linked proxy is the user's own note and is never detected, so this only says that the applied rows point elsewhere. It is compared
  // with the selected time zone (a zone no region lists is not judged), the Custom coordinates (farther than GEOLOCATION_ZONE_MAX_KM
  // from every zone of that country) and the primary language (its base subtag is not one of that country's languages, as in
  // language-timezone). A row that is not set implies nothing here; that case is proxy-locale-host's.
  const taggedCountry = proxyCountryOf(environment), taggedRegion = taggedCountry ? regionByCode(taggedCountry) : null;
  if (taggedRegion) {
    const zoneOff = typeof zoneId === 'string' && regionOfTimeZone(zoneId) !== null && !taggedRegion.zones.some(zone => zone.iana === zoneId || canonicalTimeZone(zone.iana) === canonicalTimeZone(zoneId));
    const placeOff = Boolean(place) && taggedRegion.zones.length > 0 && taggedRegion.zones.every(zone => greatCircleKm(place, { latitude: zone.lat, longitude: zone.lon }) > GEOLOCATION_ZONE_MAX_KM);
    const tongueOff = typeof language === 'string' && !taggedRegion.languages.some(tag => tag.split('-')[0].toLowerCase() === language.split('-')[0].toLowerCase());
    if (zoneOff || placeOff || tongueOff) issue('proxy-country-region', [...(zoneOff ? [zoneRow] : []), ...(placeOff ? ['geolocation'] : []), ...(tongueOff ? ['navigator-language'] : [])], zoneOff || placeOff ? 'warning' : 'info', { country: taggedCountry });
  }
  // webgpu-missing (warning): WebGL claims a catalogue card while WebGPU is neither Custom nor blocked, so navigator.gpu still shows the
  // real adapter. Not raised when this browser is known to have no WebGPU adapter.
  const webgpuRow = rows.get('webgpu'), claimedCard = typeof gl?.unmaskedRenderer === 'string' ? GPU_PRESETS.find(entry => entry.webgl.unmaskedRenderer === gl.unmaskedRenderer) : undefined;
  if (claimedCard && webgpuRow && webgpuRow.mode !== 'custom' && webgpuRow.mode !== 'on' && real.gpu?.webgpu !== null) issue('webgpu-missing', ['webgl', 'webgpu']);
  if (real.gpu) {
    const renderer = typeof gl?.unmaskedRenderer === 'string' ? gl.unmaskedRenderer : '', claimsHardware = renderer !== '' && !SOFTWARE_RENDERER.test(renderer);
    // real-gpu-software (warning): a hardware card is claimed while this browser renders in software (SwiftShader, WARP, llvmpipe or a
    // WebGPU fallback adapter); limits, extensions and timing still show the software renderer.
    if (claimsHardware && realGpuSoftware(real.gpu)) issue('real-gpu-software', ['webgl']);
    // real-gpu-limits (warning): a claimed WebGL limit above this GPU's own; the runtime then returns the native value, so the page sees
    // a limit the claimed card would not report.
    const claimedCaps = current('webgl-capabilities')?.parameters, realCaps = real.gpu.caps;
    const above = (claim, own) => Array.isArray(own) ? Array.isArray(claim) && claim.some((entry, index) => isNumber(entry) && entry > own[index]) : isNumber(claim) && claim > own;
    if (claimedCaps && realCaps && Object.keys(realCaps).some(key => above(claimedCaps[key], realCaps[key]))) issue('real-gpu-limits', ['webgl-capabilities']);
    // real-gpu-vendor (info): the claimed card's vendor family differs from this GPU's; extensions, shader precision and timing stay real.
    const cardFamily = gpuFamily(gl?.unmaskedVendor) ?? gpuFamily(renderer), hostFamily = realGpuFamily(real.gpu);
    if (cardFamily && hostFamily && cardFamily !== hostFamily) issue('real-gpu-vendor', ['webgl'], 'info');
    // real-gpu-webgpu (info): the WebGPU claim cannot match this browser's adapter: it has none (null), or another vendor family
    // (subgroup sizes, limits and features stay native).
    const adapter = current('webgpu');
    if (adapter && Object.hasOwn(real.gpu, 'webgpu')) {
      const hostAdapter = real.gpu.webgpu, hostAdapterFamily = hostAdapter ? gpuFamily(hostAdapter.vendor) : null, claimedAdapterFamily = gpuFamily(adapter.vendor);
      if (hostAdapter === null || hostAdapterFamily && claimedAdapterFamily && hostAdapterFamily !== claimedAdapterFamily) issue('real-gpu-webgpu', ['webgpu'], 'info');
    }
  }
  // storage-quota-shape (warning): Chrome reports quota = usage + 10 GiB whatever the disk is (measured on Chrome 156); any other
  // Custom quota on a Chromium identity is a shape no Chrome shows.
  const storage = current('storage-estimate');
  if (storage && chromium && storage.quota - storage.usage !== STORAGE_CHROME_HEADROOM) issue('storage-quota-shape', ['storage-estimate']);
  // plugins-pdf (warning): Chrome lists its five PDF viewer plugins exactly when navigator.pdfViewerEnabled is true. The flag comes from
  // the Custom navigator-metadata row, else from this browser when known; otherwise it is not judged.
  const pluginList = current('navigator-plugins')?.plugins, pdf = current('navigator-metadata')?.pdfViewerEnabled ?? real.pdfViewerEnabled;
  if (Array.isArray(pluginList) && typeof pdf === 'boolean' && (pluginList.length === 0) === pdf) issue('plugins-pdf', ['navigator-plugins', 'navigator-metadata']);
  // clock-precision-shape (warning): Chrome steps performance.now() in 0.1 ms; a coarser Custom step (1 or 10 ms) on a Chromium identity
  // is another browser's shape.
  const clock = current('clock-precision')?.resolutionMs;
  if (chromium && isNumber(clock) && clock > 0.1) issue('clock-precision-shape', ['clock-precision']);
  return issues;
}

// --- ADR-107 previews for the UI (interface 3). Pure: nothing is applied automatically, every value goes through the same guarded
// setter (an explicit page block is never cancelled) and the whole result through the validator. Each returns
// { configuration, changes } or null when there is nothing to change.
function preview(base, next) {
  const result = checked(next), difference = diffApiConfigurations(base, result);
  if (!difference.ok) fail('invalid-profile');
  return difference.value.length ? { configuration: result, changes: difference.value } : null;
}
const activeOf = configuration => id => { const found = configuration.apis.find(item => item.id === id); return found?.mode === 'custom' && found.selected.kind === 'value' ? found.selected.value : undefined; };

// Rebuild User-Agent, appVersion and client hints for THIS browser's real major, keeping the claimed OS and brand (the real build
// numbers are used when the claimed brand is this browser's, see identityValues). null without a usable real major (136 to
// BROWSER_VERSION_MAX + BROWSER_VERSION_REACH), without a Windows Chrome/Edge claim, or when nothing changes.
export function retargetIdentityVersion(configuration, environment = {}) {
  const base = checked(configuration), next = copy(base), real = normalizeEnvironment(environment), value = activeOf(base);
  if (!claimableVersion(real.uaMajor)) return null;
  const current = describeDevice(value), agent = value('navigator-user-agent');
  if (!current.browser || typeof agent !== 'string' || !/Windows NT/u.test(agent)) return null;
  const tools = rowTools(next);
  for (const { id, raw } of identityValues({ os: current.os ?? 'windows-11', browser: current.browser, version: real.uaMajor, environment: real })) tools.value(id, raw);
  writeChromiumExtras(tools, real);
  return preview(base, next);
}

// The codes issueFix can repair mechanically, and how:
//   geolocation-timezone-mismatch -> coordinates of the selected zone's principal city (accuracy kept);
//   language-list -> navigator-languages rebuilt from navigator-language in Chrome form (chromeLanguages);
//   dpr-step -> the nearest Windows scale (a tie takes the smaller), css-media resolution follows when it held the old ratio;
//   media-geometry -> css-media viewport and resolution copied from the window geometry and the pixel ratio (keys both sides have);
//   webgpu-missing -> the WebGPU adapter row of the claimed WebGL card; engine-version -> retargetIdentityVersion;
//   storage-quota-shape -> the quota back to native; clock-precision-shape -> Chrome's 0.1 ms step;
//   proxy-country-region -> «Match region»: the existing region rows (zone, languages, Intl locale, coordinates) of the proxy's country tag.
export const FIXABLE_ISSUES = Object.freeze(['geolocation-timezone-mismatch', 'language-list', 'dpr-step', 'media-geometry', 'webgpu-missing', 'engine-version', 'storage-quota-shape', 'clock-precision-shape', 'proxy-country-region']);
export function issueFix(configuration, issue, environment = {}) {
  const code = typeof issue === 'string' ? issue : data(issue, 'code');
  if (!FIXABLE_ISSUES.includes(code)) return null;
  if (code === 'engine-version') return retargetIdentityVersion(configuration, environment);
  const base = checked(configuration), next = copy(base), tools = rowTools(next), value = tools.activeValue;
  const finite = raw => typeof raw === 'number' && Number.isFinite(raw);
  if (code === 'geolocation-timezone-mismatch') {
    const zone = value('timezone')?.timeZone ?? value('intl-formatting')?.timeZone, place = value('geolocation'), anchor = zonePrincipalPoint(zone);
    if (!anchor || !place) return null;
    tools.value('geolocation', { latitude: anchor.latitude, longitude: anchor.longitude, accuracy: place.accuracy });
  } else if (code === 'language-list') {
    const list = chromeLanguages(value('navigator-language'));
    if (!list) return null;
    tools.value('navigator-languages', list);
  } else if (code === 'dpr-step') {
    const ratio = value('window-device-pixel-ratio');
    if (!finite(ratio)) return null;
    const nearest = WINDOWS_SCALES.reduce((best, step) => Math.abs(step - ratio) < Math.abs(best - ratio) ? step : best, WINDOWS_SCALES[0]);
    tools.value('window-device-pixel-ratio', nearest);
    if (value('css-media')?.resolutionDppx === ratio) tools.value('css-media', { resolutionDppx: nearest });
  } else if (code === 'media-geometry') {
    const media = value('css-media'), geometry = value('screen-geometry'), ratio = value('window-device-pixel-ratio'), sync = {};
    if (!media) return null;
    if (finite(media.viewportWidth) && finite(geometry?.innerWidth)) sync.viewportWidth = geometry.innerWidth;
    if (finite(media.viewportHeight) && finite(geometry?.innerHeight)) sync.viewportHeight = geometry.innerHeight;
    if (finite(media.resolutionDppx) && finite(ratio)) sync.resolutionDppx = ratio;
    if (!Object.keys(sync).length) return null;
    tools.value('css-media', sync);
  } else if (code === 'webgpu-missing') {
    const gl = value('webgl'), card = gl ? GPU_PRESETS.find(entry => entry.webgl.unmaskedRenderer === gl.unmaskedRenderer) : undefined;
    if (!card) return null;
    tools.value('webgpu', gpuValues(card.id).find(entry => entry.id === 'webgpu').raw);
  } else if (code === 'storage-quota-shape') tools.reset(['storage-estimate']);
  else if (code === 'clock-precision-shape') {
    if (value('clock-precision') === undefined) return null;
    tools.value('clock-precision', { resolutionMs: 0.1 });
  } else if (code === 'proxy-country-region') {
    // The same machinery as the Region control; the country comes from the environment (the user's own tag), never from a lookup.
    const country = proxyCountryOf(environment);
    if (!country) return null;
    writeRegionRows(tools, regionClaim(country));
  }
  return preview(base, next);
}

// The outer size for the "Fit window to the claimed screen" click (chrome.windows.update(currentWindowId, { state: 'normal', width,
// height }) in Options): the claimed available screen (else the claimed screen), never more than this computer's available screen
// (else its screen), and one CSS pixel less in height so Windows keeps a normal window rather than a maximized one. null when a size
// is unknown on either side.
export function fitWindowTarget(configuration, environment = {}) {
  const base = checked(configuration), value = activeOf(base), real = normalizeEnvironment(environment);
  const claimedWidth = value('screen-avail-width') ?? value('screen-width'), claimedHeight = value('screen-avail-height') ?? value('screen-height');
  const realWidth = real.screen?.availWidth ?? real.screen?.width, realHeight = real.screen?.availHeight ?? real.screen?.height;
  if (![claimedWidth, claimedHeight, realWidth, realHeight].every(size => Number.isSafeInteger(size) && size > 0)) return null;
  const width = Math.min(claimedWidth, realWidth), height = Math.min(claimedHeight, realHeight) - 1;
  return height >= 1 ? { width, height } : null;
}

export function editFingerprintRow(configuration, id, patch) {
  const base = checked(configuration); if (!API_CONFIG_CATALOG.some(row => row.id === id)) fail('invalid-value');
  if (!patch || typeof patch !== 'object' || Reflect.ownKeys(patch).some(key => !['mode', 'selected'].includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(patch, key), 'value'))) fail('invalid-value');
  // Let the canonical safe-data validator reject accessors, unknown fields and unsupported Custom values.
  return checked({ ...base, apis: base.apis.map(row => row.id === id ? { ...row, ...patch } : row) });
}

// ADR-104 follow-up: three-way merge of a pending draft with a newer saved revision. Every top-level field and every catalog
// row is taken from the side that changed it; a field both sides changed differently is a conflict and the result is null.
// This lets another surface (for example the header master switch) save without locking the editor that holds a preview.
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function resolveSide(base, mine, theirs) {
  if (sameJson(mine, base)) return { ok: true, value: theirs };
  if (sameJson(theirs, base) || sameJson(theirs, mine)) return { ok: true, value: mine };
  return { ok: false };
}
export function mergeConfigurations(base, mine, theirs) {
  if (!base || !mine || !theirs || !Array.isArray(base.apis) || !Array.isArray(mine.apis) || !Array.isArray(theirs.apis)) return null;
  const merged = {};
  for (const key of [...new Set([...Object.keys(theirs), ...Object.keys(mine)])]) {
    if (key === 'apis') { merged.apis = null; continue; }
    const side = resolveSide(base[key], mine[key], theirs[key]); if (!side.ok) return null;
    if (side.value !== undefined) merged[key] = side.value;
  }
  const baseRows = new Map(base.apis.map(row => [row.id, row])), mineRows = new Map(mine.apis.map(row => [row.id, row]));
  if (mine.apis.length !== theirs.apis.length || base.apis.length !== theirs.apis.length) return null;
  const apis = [];
  for (const row of theirs.apis) {
    const own = mineRows.get(row.id), origin = baseRows.get(row.id); if (!own || !origin) return null;
    const side = resolveSide(origin, own, row); if (!side.ok) return null;
    apis.push(side.value);
  }
  merged.apis = apis;
  const checked = validateApiConfiguration(merged);
  return checked.ok ? checked.value : null;
}
