// ADR-107 UI helpers for the Antidetect level controls. Pure functions, no chrome.* access and no storage: which rows a control
// owns, under which control an issue is shown, where a value comes from (the real browser, a region or a custom value), the
// «claimed / this browser» explainer, a time-zone search over all words, keyboard roving and the «keep my changes» rebase.
import { validateApiConfiguration } from './api-configuration.js';
import { FINGERPRINT_TIMEZONES, sameTimeZone } from './fingerprint-timezone-data.js';
import { regionDefaults } from './fingerprint-region-data.js';
import { GPU_PRESETS } from './fingerprint-device-presets.js';

// Level order matters: an issue is shown under the first control (in this order) that owns one of its rows.
export const LEVEL_FIELDS = Object.freeze({ device: Object.freeze(['cpu', 'ram', 'disk', 'screen', 'gpu']), os: Object.freeze(['os', 'region', 'language', 'timezone', 'fonts']), browser: Object.freeze(['browser', 'version', 'canvas', 'webgl', 'audio']) });
const IDENTITY = Object.freeze(['navigator-user-agent', 'navigator-app-version', 'navigator-vendor', 'client-hints']);
export const FIELD_ROWS = Object.freeze({
  cpu: ['hardware-concurrency'], ram: ['device-memory', 'performance-memory'], disk: ['storage-estimate'],
  screen: ['screen-width', 'screen-height', 'screen-avail-width', 'screen-avail-height', 'screen-color-depth', 'screen-pixel-depth', 'screen-orientation', 'screen-geometry', 'window-device-pixel-ratio', 'css-media'],
  gpu: ['webgl', 'webgl-capabilities', 'webgpu', 'webgpu-capabilities'],
  os: ['navigator-platform', 'navigator-oscpu'], region: ['geolocation'], language: ['navigator-language', 'navigator-languages'], timezone: ['timezone', 'intl-formatting'], fonts: ['canvas-font-policy', 'local-fonts', 'canvas-text-metrics'],
  browser: IDENTITY, version: IDENTITY, canvas: ['canvas-readback'], webgl: ['webgl-readback'], audio: ['audio-fingerprint'],
});
export const fieldOwns = (field, id) => typeof id === 'string' && ((FIELD_ROWS[field] ?? []).includes(id) || field === 'screen' && id.startsWith('screen-'));
// A hint about the claimed version belongs to the Version control, although the browser family owns the same identity rows.
const CODE_FIELDS = Object.freeze({ 'engine-version': 'version' });
// ADR-107 round 5: a hint whose repair is one control's job is shown under that control whichever of its rows disagree (the proxy-country hint
// can name only the time zone, yet «Match region» is the Region control's job).
const CODE_HOMES = Object.freeze({ 'proxy-country-region': 'region' });
const owner = (fields, issue) => {
  const home = CODE_HOMES[issue?.code];
  if (home && fields.includes(home)) return home;
  const preferred = CODE_FIELDS[issue?.code];
  if (preferred && fields.includes(preferred) && (issue?.ids ?? []).some(id => fieldOwns(preferred, id))) return preferred;
  return fields.find(field => (issue?.ids ?? []).some(id => fieldOwns(field, id))) ?? null;
};
// Issues of the current level go under their control; everything else (and every issue of the quick view) stays in the list.
export function placeIssues(issues, view) {
  const fields = LEVEL_FIELDS[view] ?? [], byField = new Map(), rest = [];
  for (const issue of issues) {
    const field = owner(fields, issue);
    if (field) { if (!byField.has(field)) byField.set(field, []); byField.get(field).push(issue); } else rest.push(issue);
  }
  return { byField, rest };
}
// Where «Show» leads: the first level (device, os, browser) with a control that owns one of the rows.
export function issueTarget(issue) {
  for (const level of ['device', 'os', 'browser']) { const field = owner(LEVEL_FIELDS[level], issue); if (field) return { level, field }; }
  return null;
}
export const fieldControlId = field => 'fp-field-' + field;

// The views whose tabs hold unapplied changes. The quick view lists every pending change and applies them all, so it counts
// whenever anything is pending; a level counts when one of its controls owns a changed global row. Canonical order.
export const PENDING_VIEWS = Object.freeze(['quick', 'device', 'os', 'browser']);
export function pendingViews(changes) {
  const found = new Set();
  for (const change of changes ?? []) {
    found.add('quick');
    if (change?.scope !== 'global' || typeof change.id !== 'string') continue;
    const level = ['device', 'os', 'browser'].find(name => LEVEL_FIELDS[name].some(field => fieldOwns(field, change.id)));
    if (level) found.add(level);
  }
  return PENDING_VIEWS.filter(view => found.has(view));
}

// Source of a field's value: 'real' (no row of the control is overridden), 'region' (the rows equal the defaults of the region the
// zone belongs to) or 'custom'. `valueOf(id)` is the active Custom value of a row, as describeDevice reads it.
export function fieldSource(field, valueOf, region) {
  const rows = field === 'screen' ? ['screen-width', 'screen-height'] : FIELD_ROWS[field] ?? [];
  if (!rows.some(id => valueOf(id) !== undefined)) return 'real';
  const defaults = region ? regionDefaults(region) : null;
  if (defaults) {
    const zone = sameTimeZone(valueOf('timezone')?.timeZone ?? valueOf('intl-formatting')?.timeZone, defaults.timeZone), language = valueOf('navigator-language') === defaults.locale;
    const place = valueOf('geolocation'), coordinates = Boolean(place) && place.latitude === defaults.latitude && place.longitude === defaults.longitude;
    // A zone always matches the region derived from it, so it counts as the region's only when another value the region writes agrees.
    if (field === 'timezone' && zone && (language || coordinates)) return 'region';
    if (field === 'language' && language) return 'region';
    if (field === 'region' && coordinates) return 'region';
  }
  return 'custom';
}

// A readable GPU name: the adapter inside an ANGLE renderer string, else the string itself (bounded).
export function gpuShortName(renderer) {
  if (typeof renderer !== 'string' || !renderer) return null;
  const angle = /^ANGLE \([^,]{1,64}, (.{1,160}?)(?: \(0x[0-9a-f]{1,8}\))?(?: Direct3D|, )/iu.exec(renderer);
  return (angle ? angle[1] : renderer).slice(0, 96);
}
const OS_NAMES = Object.freeze({ 'windows-11': 'Windows 11', 'windows-10': 'Windows 10', windows: 'Windows', mac: 'macOS', linux: 'Linux' });
// «Claimed X / this browser Y» for the hints that compare the profile with this computer. `words` carries the localized
// «real graphics card» option and the «not checked» text; a fact the snapshot lacks is shown as not checked, never guessed.
export function explainIssue(code, device, environment = {}, words = {}) {
  const unknown = words.value_not_checked ?? '—', show = value => value === null || value === undefined || value === '' ? unknown : String(value);
  const claimedGpu = () => GPU_PRESETS.find(entry => entry.id === device.gpu)?.label ?? words.gpu_real_option ?? unknown;
  const realScreen = environment.screen?.width && environment.screen?.height ? environment.screen.width + ' × ' + environment.screen.height : null;
  switch (code) {
    case 'cores-above-real': return { claimed: show(device.cores), real: show(environment.hardwareConcurrency) };
    case 'memory-above-real': return { claimed: device.reportedMemory === null ? unknown : device.reportedMemory + ' GB', real: environment.deviceMemory === undefined ? unknown : environment.deviceMemory + ' GB' };
    case 'host-os': return { claimed: show(OS_NAMES[device.os]), real: show(OS_NAMES[environment.platform]) };
    case 'screen-vs-real': return { claimed: device.screen ? device.screen.replace('x', ' × ') : unknown, real: show(realScreen) };
    case 'engine-version': return { claimed: device.version ? 'Chrome ' + device.version : unknown, real: environment.uaMajor ? 'Chrome ' + environment.uaMajor : unknown };
    case 'gpu-os': case 'gpu-pair': case 'webgpu-gpu': case 'real-gpu-software': case 'real-gpu-limits': case 'real-gpu-vendor':
      return { claimed: claimedGpu(), real: show(gpuShortName(environment.gpu?.renderer)) };
    case 'real-gpu-webgpu': case 'webgpu-missing': {
      const webgpu = environment.gpu?.webgpu;
      return { claimed: claimedGpu(), real: webgpu === null ? 'WebGPU —' : webgpu ? show([webgpu.vendor, webgpu.architecture].filter(Boolean).join(' · ')) : unknown };
    }
    default: return null;
  }
}

// Time-zone search: every word must match the city, the English or the localized country name, the zone id or the country code.
const fold = text => String(text).normalize('NFD').replace(/[̀-ͯ]/gu, '').replace(/[’ʼ]/gu, "'").toLowerCase();
const countryNames = new Map();
function countryName(code, locale) {
  const tag = String(typeof locale === 'string' ? locale : locale?.id ?? 'en').replace('_', '-'), key = tag + ':' + code;
  if (!countryNames.has(key)) {
    let name = null;
    try { const supported = Intl.DisplayNames.supportedLocalesOf(tag === 'wuu' ? ['wuu', 'zh-CN'] : tag === 'yue' ? ['yue', 'zh-HK'] : [tag])[0]; name = supported ? new Intl.DisplayNames([supported], { type: 'region', fallback: 'none' }).of(code) ?? null : null; } catch { name = null; }
    if (countryNames.size > 4096) countryNames.clear();
    countryNames.set(key, name);
  }
  return countryNames.get(key);
}
export const zoneCountry = (entry, locale) => countryName(entry.countryCode, locale) ?? entry.country;
export function searchZones(query, locale, limit = 40) {
  const words = fold(String(query ?? '').slice(0, 64)).split(/\s+/u).filter(Boolean);
  const list = FINGERPRINT_TIMEZONES.map(entry => ({ entry, text: fold([entry.city, entry.country, zoneCountry(entry, locale), entry.iana.replace(/[/_]/gu, ' '), entry.countryCode].join(' ')), city: fold(entry.city) }));
  const matches = words.length ? list.filter(item => words.every(word => item.text.includes(word))) : list;
  // A city that starts with the first word comes first; otherwise the table order (grouped by region) stays.
  const ranked = words.length ? matches.map((item, index) => [item.city.startsWith(words[0]) ? 0 : 1, index, item]).sort((left, right) => left[0] - right[0] || left[1] - right[1]).map(row => row[2]) : matches;
  return ranked.slice(0, limit).map(item => item.entry);
}

// Language names in the UI language, with the tag kept beside them. The list has about 250 tags, so one formatter per UI language
// and the labels are cached (bounded like the country names).
const languageNames = new Map(), languageFormatters = new Map();
export function languageLabel(tag, locale) {
  const ui = String(typeof locale === 'string' ? locale : locale?.id ?? 'en').replace('_', '-'), key = ui + ':' + tag;
  if (languageNames.has(key)) return languageNames.get(key);
  let text = tag;
  try {
    if (!languageFormatters.has(ui)) {
      const supported = Intl.DisplayNames.supportedLocalesOf(ui === 'wuu' ? ['wuu', 'zh-CN'] : ui === 'yue' ? ['yue', 'zh-HK'] : [ui])[0];
      languageFormatters.set(ui, supported ? new Intl.DisplayNames([supported], { type: 'language', fallback: 'none' }) : null);
    }
    const name = languageFormatters.get(ui)?.of(tag);
    if (name) text = name + ' · ' + tag;
  } catch { text = tag; }
  if (languageNames.size > 4096) languageNames.clear();
  languageNames.set(key, text);
  return text;
}

// One tab stop for a group of radios: Home/End, and the arrows follow the visual direction (rtl swaps left and right).
export function rovingIndex(key, index, count, rtl = false) {
  if (count < 1) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const forward = key === 'ArrowDown' || key === (rtl ? 'ArrowLeft' : 'ArrowRight'), backward = key === 'ArrowUp' || key === (rtl ? 'ArrowRight' : 'ArrowLeft');
  return forward ? (index + 1) % count : backward ? (index - 1 + count) % count : -1;
}

// «Keep my changes»: the rows and fields I changed since `base` are laid onto the newer revision `theirs`. A row both sides
// changed differently is a conflict: mine is kept and the id is reported, so the preview can list those rows first.
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const TOP_FIELDS = Object.freeze(['enabled', 'antidetectEnabled', 'preset', 'webrtcNetworkPolicy', 'sites', 'fingerprintProfiles']);
export function rebaseConfiguration(base, mine, theirs) {
  const result = structuredClone(theirs), conflicts = [];
  const rowOf = (configuration, id) => configuration.apis.find(row => row.id === id);
  for (const row of mine.apis) {
    const before = rowOf(base, row.id), current = rowOf(result, row.id);
    if (!current || same(row, before)) continue;
    if (!same(current, before) && !same(current, row)) conflicts.push(row.id);
    result.apis[result.apis.indexOf(current)] = structuredClone(row);
  }
  for (const field of TOP_FIELDS) {
    if (same(mine[field], base[field])) continue;
    if (!same(theirs[field], base[field]) && !same(theirs[field], mine[field])) conflicts.push(field);
    result[field] = structuredClone(mine[field]);
  }
  const checked = validateApiConfiguration(result);
  return checked.ok ? { configuration: checked.value, conflicts } : null;
}
