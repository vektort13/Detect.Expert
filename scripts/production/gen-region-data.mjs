// Antidetect region table generator: "country -> language, time zone, coordinates", offline.
// Reads the pinned IANA tz database snapshot (packages/catalog/data/tzdata) and the ICU/CLDR data built into the running Node,
// writes apps/production-extension/fingerprint-region-data.js. The extension never reads these inputs and never uses the network.
//
//   node scripts/production/gen-region-data.mjs                   write the module
//   node scripts/production/gen-region-data.mjs --check           fail unless the committed module is byte-identical to a fresh run
//   node scripts/production/gen-region-data.mjs --input-dir DIR   read zone.tab, zone1970.tab, iso3166.tab, version from DIR
//   node scripts/production/gen-region-data.mjs --output FILE     write (or, with --check, compare) FILE instead of the module
//
// Exit codes: 0 ok; 1 stale or edited output, or bad input; 3 --check cannot decide because the ICU/CLDR/Unicode/tz versions of this
// Node differ from the ones recorded in the committed header (regenerate under the new toolchain and review the diff).
// Re-running with unchanged inputs gives identical bytes. REGION_DATA_VERSION grows by one only when the content changes.
//
// RULES
//  - One region per ISO 3166-1 code with at least one zone in zone.tab. zone.tab (not zone1970.tab) is the zone list because it keeps
//    the ids people really have (Europe/Copenhagen, Europe/Stockholm); zone1970.tab is only cross-checked.
//  - zones[].iana is the spelling this runtime's Intl reports (ICU canonical, the spelling Chrome reports: Asia/Calcutta,
//    Europe/Kiev). Ids Intl rejects are dropped and reported. canonicalTimeZone() of the extension must agree with Intl here.
//  - zones keep the zone.tab order (the file puts the most populous zones first where geography allows). lat/lon come from the
//    ISO 6709 column, rounded to 6 decimals (about 0.1 m).
//  - city = last segment of the IANA id with "_" as space, as CLDR exemplar locations do (ids of islands and countries stay as they
//    are: Qatar, Jamaica). CITY_LABELS fixes spelling only.
//  - defaultZone: the only zone of a single-zone region; otherwise DEFAULT_ZONE (the zone of the capital or of the most populous
//    area, or the one the tab marks "most areas"); a multi-zone region missing there falls back to the "(most areas)"/"most of"/
//    "mainland" comment, then to the first zone, and the run says so.
//  - locale: CLDR likely subtags of und-XX with the script dropped (de-Latn-DE -> de-DE, zh-Hant-TW -> zh-TW). The tag must be
//    canonical, backed by ICU locale data, and its language must have an OS/browser UI (UI_LANGUAGES). Otherwise a curated
//    LOCALE_OVERRIDES entry is required (the run fails instead of emitting an implausible navigator.language such as wo-SN).
//    Overrides also fix the cases where CLDR's single language is not the dominant browser language (IN, BY, UG, SS, NA).
//  - languages (Chrome navigator.languages style): [locale, base, ...ALSO_LANGUAGES tags and their bases, "en-US", "en"], no
//    duplicates; when the base language is English the English tail is not added: GB -> [en-GB, en], US -> [en-US, en],
//    IN -> [en-IN, en, hi-IN, hi], DE -> [de-DE, de, en-US, en]. Every tag passes Intl.getCanonicalLocales unchanged.
//  - nameEn: Intl.DisplayNames('en', region), falling back to the iso3166.tab name.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalTimeZone } from '../../apps/production-extension/fingerprint-timezone-data.js';

const root = resolve(import.meta.dirname, '../..');
export const INPUT_DIR = resolve(root, 'packages/catalog/data/tzdata');
export const OUTPUT_FILE = resolve(root, 'apps/production-extension/fingerprint-region-data.js');
export const INPUT_FILES = ['zone.tab', 'zone1970.tab', 'iso3166.tab', 'version'];

// ---- curated tables -------------------------------------------------------------------------------------------------------

// Multi-zone regions: default zone as spelled in zone.tab. Rule: the capital's zone or the most populous area; the tab's
// "(most areas)" zone where it exists.
export const DEFAULT_ZONE = {
  AQ: 'Antarctica/McMurdo', // largest station
  AR: 'America/Argentina/Buenos_Aires', // capital
  AU: 'Australia/Sydney', // most populous
  BR: 'America/Sao_Paulo', // "southeast", includes the capital district
  CA: 'America/Toronto', // "Eastern (most areas)"
  CD: 'Africa/Kinshasa', // capital
  CL: 'America/Santiago', // "most of Chile"
  CN: 'Asia/Shanghai', // "Beijing Time", the whole country but Xinjiang
  CY: 'Asia/Nicosia', // "most of Cyprus"
  DE: 'Europe/Berlin', // "most of Germany"
  EC: 'America/Guayaquil', // "mainland"
  ES: 'Europe/Madrid', // "mainland"
  FM: 'Pacific/Pohnpei', // capital (Palikir)
  GL: 'America/Nuuk', // "most of Greenland"
  ID: 'Asia/Jakarta', // capital, Java
  KI: 'Pacific/Tarawa', // capital
  KZ: 'Asia/Almaty', // "most of Kazakhstan"
  MH: 'Pacific/Majuro', // "most of Marshall Islands"
  MN: 'Asia/Ulaanbaatar', // "most of Mongolia"
  MX: 'America/Mexico_City', // "Central Mexico"
  MY: 'Asia/Kuala_Lumpur', // "peninsula", capital
  NZ: 'Pacific/Auckland', // "most of New Zealand"
  PF: 'Pacific/Tahiti', // capital
  PG: 'Pacific/Port_Moresby', // "most of Papua New Guinea"
  PS: 'Asia/Hebron', // West Bank, the larger population
  PT: 'Europe/Lisbon', // "mainland"
  RU: 'Europe/Moscow', // capital
  UA: 'Europe/Kyiv', // "most of Ukraine"
  UM: 'Pacific/Midway', // first listed
  US: 'America/New_York', // "Eastern (most areas)"
  UZ: 'Asia/Tashkent', // capital
};

// Spelling fixes for city labels, keyed by the IANA id as in zone.tab (the derived label would be wrong or abbreviated).
export const CITY_LABELS = {
  'America/Lower_Princes': "Lower Prince's Quarter",
  'America/St_Barthelemy': 'St. Barthelemy',
  'America/St_Johns': "St. John's",
  'America/St_Kitts': 'St. Kitts',
  'America/St_Lucia': 'St. Lucia',
  'America/St_Thomas': 'St. Thomas',
  'America/St_Vincent': 'St. Vincent',
  'Antarctica/DumontDUrville': "Dumont d'Urville",
  'Asia/Ho_Chi_Minh': 'Ho Chi Minh City',
  'Atlantic/St_Helena': 'St. Helena',
};

// Languages that have a browser or operating-system UI (Chrome UI languages plus the Windows display languages of countries where
// the language is national). A CLDR likely language outside this set needs a LOCALE_OVERRIDES entry. Curated, not measured.
export const UI_LANGUAGES = new Set((
  'af am ar az be bg bn bs ca cs da de el en es et fa fi fil fr gu he hi hr hu hy id is it ja ka kk km kn ko ky lo lt lv mk ml mn mr ' +
  'ms mt my nb ne nl pl pt ro ru si sk sl sq sr sv sw ta te tg th tk tr uk ur uz vi zh').split(' '));

// Primary locale overrides. Every tag must be canonical and backed by ICU locale data (checked on every run).
export const LOCALE_OVERRIDES = {
  // CLDR language without an OS/browser UI (Samoan, Kirundi, Papiamento, Sango, Akan, Greenlandic, Haitian Creole, Sesotho,
  // Bambara, Dhivehi, Hausa, Tok Pisin, Palauan, Guarani, Kinyarwanda, Wolof, Somali, Shona, Tigrinya, Tongan, Tuvaluan, Bislama,
  // Tokelauan, Faroese, Malagasy, Dzongkha, Malay in Arabic script): the official or common language that has one
  // (FO gets da-DK because CLDR has no da-FO).
  AS: 'en-AS', BI: 'fr-BI', BQ: 'nl-BQ', CC: 'en-CC', CF: 'fr-CF', CW: 'nl-CW', ER: 'en-ER', FO: 'da-DK', GH: 'en-GH', GL: 'da-GL',
  HT: 'fr-HT', LS: 'en-LS', MG: 'fr-MG', ML: 'fr-ML', MV: 'en-MV', NE: 'fr-NE', PG: 'en-PG', PW: 'en-PW', PY: 'es-PY', RW: 'en-RW',
  SN: 'fr-SN', SO: 'ar-SO', TK: 'en-TK', TO: 'en-TO', TV: 'en-TV', VU: 'en-VU', WS: 'en-WS', ZW: 'en-ZW',
  // No resident population or no usable language: the universal English fallback (Antarctica: the largest station is a US one).
  AQ: 'en-US', BT: 'en-US',
  // The tag CLDR derives has no locale data of its own (fr-TF, nb-SJ): the locale of the administering country.
  SJ: 'nb-NO', TF: 'fr-FR',
  // CLDR's single language is not the dominant browser language: Russian in Belarus, English in India, Uganda, South Sudan, Namibia.
  BY: 'ru-BY', IN: 'en-IN', NA: 'en-NA', SS: 'en-SS', UG: 'en-UG',
};

// Extra languages after the primary one (locale tags only; their base languages follow automatically).
export const ALSO_LANGUAGES = {
  CA: ['fr-CA'],
  IN: ['hi-IN'],
};

export const ACCURACY_METRES = 25;

export const TABLES = { defaultZone: DEFAULT_ZONE, localeOverrides: LOCALE_OVERRIDES, alsoLanguages: ALSO_LANGUAGES };

// ---- parsing ----------------------------------------------------------------------------------------------------------------

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const normalizeNewlines = (text) => text.replace(/\r\n?/g, '\n');

const ISO6709 = /^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$/;

function degrees(sign, deg, min, sec, limit, text) {
  const d = Number(deg);
  const m = Number(min);
  const s = sec === undefined ? 0 : Number(sec);
  if (d > limit || m > 59 || s > 59 || (d === limit && (m > 0 || s > 0))) throw new Error('coordinates out of range: ' + text);
  const value = Number(((sign === '-' ? -1 : 1) * (d + m / 60 + s / 3600)).toFixed(6));
  return value === 0 ? 0 : value;
}

// "+4230+00131" (+-DDMM+-DDDMM) or "+404251-0740023" (+-DDMMSS+-DDDMMSS) -> decimal degrees, at most 6 decimals.
export function parseIso6709(text) {
  const match = typeof text === 'string' ? ISO6709.exec(text) : null;
  if (match === null || (match[4] === undefined) !== (match[8] === undefined)) throw new Error('bad ISO 6709 coordinates: ' + String(text));
  return {
    lat: degrees(match[1], match[2], match[3], match[4], 90, text),
    lon: degrees(match[5], match[6], match[7], match[8], 180, text),
  };
}

function dataLines(text) {
  const out = [];
  normalizeNewlines(text).split('\n').forEach((line, index) => {
    if (line !== '' && !line.startsWith('#')) out.push({ line, number: index + 1 });
  });
  return out;
}

export function parseZoneTab(text) {
  const rows = dataLines(text).map(({ line, number }) => {
    const cells = line.split('\t');
    if (cells.length < 3 || cells.length > 4) throw new Error('zone.tab line ' + number + ': expected 3 or 4 tab-separated columns');
    const [code, coordinates, tz, comment = ''] = cells;
    if (!/^[A-Z]{2}$/.test(code)) throw new Error('zone.tab line ' + number + ': bad country code');
    if (!/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(tz)) throw new Error('zone.tab line ' + number + ': bad zone id');
    return { code, tz, comment, ...parseIso6709(coordinates) };
  });
  if (rows.length === 0) throw new Error('zone.tab has no rows');
  return rows;
}

export function parseIsoTab(text) {
  const names = new Map();
  for (const { line, number } of dataLines(text)) {
    const cells = line.split('\t');
    if (cells.length !== 2 || !/^[A-Z]{2}$/.test(cells[0]) || cells[1] === '') throw new Error('iso3166.tab line ' + number + ': bad row');
    names.set(cells[0], cells[1]);
  }
  if (names.size === 0) throw new Error('iso3166.tab has no rows');
  return names;
}

export function parseZone1970(text) {
  return dataLines(text).map(({ line, number }) => {
    const cells = line.split('\t');
    if (cells.length < 3 || !cells[0].split(',').every((code) => /^[A-Z]{2}$/.test(code))) throw new Error('zone1970.tab line ' + number + ': bad row');
    return { codes: cells[0].split(','), tz: cells[2] };
  });
}

export function readInputs(dir) {
  const files = {};
  for (const name of INPUT_FILES) {
    const path = resolve(dir, name);
    if (!existsSync(path)) throw new Error('missing input file: ' + path);
    files[name] = normalizeNewlines(readFileSync(path, 'utf8'));
  }
  const version = files.version.trim();
  if (!/^\d{4}[a-z]$/.test(version)) throw new Error('unexpected tz database version: ' + version);
  const hashes = {};
  for (const name of INPUT_FILES) if (name !== 'version') hashes[name] = sha256(files[name]);
  return { files, version, hashes };
}

// ---- building ---------------------------------------------------------------------------------------------------------------

function icuZone(id) {
  try {
    const zone = new Intl.DateTimeFormat('en', { timeZone: id }).resolvedOptions().timeZone;
    return typeof zone === 'string' && zone !== '' ? zone : null;
  } catch {
    return null;
  }
}

export function cityOf(id) {
  const label = CITY_LABELS[id] ?? id.slice(id.lastIndexOf('/') + 1).replaceAll('_', ' ');
  if (!/^[\x20-\x7e]{1,40}$/.test(label) || label !== label.trim()) throw new Error('bad city label for ' + id + ': ' + label);
  return label;
}

function isCanonicalTag(tag) {
  try {
    const list = Intl.getCanonicalLocales(tag);
    return list.length === 1 && list[0] === tag;
  } catch {
    return false;
  }
}

// True when ICU has locale data for exactly this tag (or the tag is the default region of its language: nb-NO is "nb").
export function isBackedLocale(tag) {
  const want = new Intl.Locale(tag);
  const resolved = new Intl.DateTimeFormat(tag).resolvedOptions().locale;
  if (resolved === tag) return true;
  const likely = new Intl.Locale(resolved).maximize();
  return likely.language === want.language && likely.region === want.region;
}

function checkTag(tag, what) {
  if (!isCanonicalTag(tag)) throw new Error(what + ': "' + tag + '" is not a canonical language tag');
  if (!isBackedLocale(tag)) throw new Error(what + ': ICU has no locale data for "' + tag + '"');
}

export function buildLanguages(locale, also = []) {
  const out = [];
  const add = (tag) => {
    if (!out.includes(tag)) out.push(tag);
  };
  const base = locale.split('-')[0];
  add(locale);
  add(base);
  for (const tag of also) {
    add(tag);
    add(tag.split('-')[0]);
  }
  if (base !== 'en') {
    add('en-US');
    add('en');
  }
  return out;
}

function chooseLocale(code, report, overrides) {
  const likely = new Intl.Locale('und-' + code).maximize();
  const derived = likely.language + '-' + code;
  const override = overrides[code];
  if (override !== undefined) {
    checkTag(override, 'LOCALE_OVERRIDES.' + code);
    if (override === derived) report.warnings.push('LOCALE_OVERRIDES.' + code + ' repeats the CLDR locale ' + derived);
    report.localeOverrides.push(code + ': ' + derived + ' -> ' + override);
    return override;
  }
  if (likely.language === 'und' || !UI_LANGUAGES.has(likely.language) || !isCanonicalTag(derived) || !isBackedLocale(derived)) {
    throw new Error(code + ': CLDR likely locale ' + likely.toString() + ' (' + derived + ') needs a LOCALE_OVERRIDES entry');
  }
  return derived;
}

function pickDefault(code, zones, report, defaults) {
  if (zones.length === 1) return zones[0].iana;
  const wanted = defaults[code];
  if (wanted !== undefined) {
    const hit = zones.find((zone) => zone.source === wanted);
    if (hit === undefined) throw new Error('DEFAULT_ZONE.' + code + ' (' + wanted + ') is not a zone of the region');
    return hit.iana;
  }
  report.defaultFallback.push(code);
  const mostly = zones.find((zone) => /\bmost (?:areas|of)\b|\bmainland\b/i.test(zone.comment));
  return (mostly ?? zones[0]).iana;
}

function icuZonesOf(code) {
  const locale = new Intl.Locale('und-' + code);
  if (typeof locale.getTimeZones === 'function') return locale.getTimeZones();
  return Array.isArray(locale.timeZones) ? locale.timeZones : null;
}

export function buildRegions({ zoneRows, isoNames, zone1970 = [], tables = TABLES }) {
  const report = {
    rejected: [], respelled: [], duplicates: [], droppedRegions: [], localeOverrides: [], defaultFallback: [], warnings: [], icu: [],
  };
  const byCode = new Map();
  const owner = new Map();
  for (const row of zoneRows) {
    if (!isoNames.has(row.code)) throw new Error('zone.tab country ' + row.code + ' is missing from iso3166.tab');
    const iana = icuZone(row.tz);
    if (iana === null) {
      report.rejected.push(row.tz);
      continue;
    }
    if (canonicalTimeZone(row.tz) !== iana) throw new Error('canonicalTimeZone() disagrees with Intl for ' + row.tz);
    if (iana !== row.tz) report.respelled.push(row.tz + ' -> ' + iana);
    if (owner.has(iana) && owner.get(iana) !== row.code) throw new Error('zone ' + iana + ' belongs to ' + owner.get(iana) + ' and ' + row.code);
    const list = byCode.get(row.code) ?? [];
    if (list.some((zone) => zone.iana === iana)) {
      report.duplicates.push(row.code + ': ' + row.tz + ' = ' + iana);
      continue;
    }
    owner.set(iana, row.code);
    list.push({ iana, source: row.tz, city: cityOf(row.tz), lat: row.lat, lon: row.lon, comment: row.comment });
    byCode.set(row.code, list);
  }
  for (const code of new Set(zoneRows.map((row) => row.code))) if (!byCode.has(code)) report.droppedRegions.push(code);
  for (const table of [tables.localeOverrides, tables.alsoLanguages, tables.defaultZone]) {
    for (const code of Object.keys(table)) if (!byCode.has(code)) throw new Error('curated entry for unknown region ' + code);
  }
  for (const code of Object.keys(tables.defaultZone)) {
    if (byCode.get(code).length < 2) report.warnings.push('DEFAULT_ZONE.' + code + ' is unnecessary: the region has one zone');
  }

  const names = new Intl.DisplayNames('en', { type: 'region', fallback: 'none' });
  const regions = [];
  for (const code of [...byCode.keys()].sort()) {
    const zones = byCode.get(code);
    const locale = chooseLocale(code, report, tables.localeOverrides);
    const also = tables.alsoLanguages[code] ?? [];
    for (const tag of also) checkTag(tag, 'ALSO_LANGUAGES.' + code);
    const languages = buildLanguages(locale, also);
    for (const tag of languages) if (!isCanonicalTag(tag)) throw new Error(code + ': language tag "' + tag + '" is not canonical');
    regions.push({
      code,
      nameEn: names.of(code) ?? isoNames.get(code),
      locale,
      languages,
      defaultZone: pickDefault(code, zones, report, tables.defaultZone),
      zones: zones.map(({ iana, city, lat, lon }) => ({ iana, city, lat, lon })),
    });
  }

  // zone1970.tab must not disagree with zone.tab: every country and every main zone of it is present.
  const tabCodes = new Set(byCode.keys());
  const tabSources = new Set(zoneRows.map((row) => row.tz));
  for (const { codes, tz } of zone1970) {
    for (const code of codes) if (!tabCodes.has(code) && !report.droppedRegions.includes(code)) throw new Error('zone1970.tab country ' + code + ' is missing from zone.tab');
    if (!tabSources.has(tz)) throw new Error('zone1970.tab zone ' + tz + ' is missing from zone.tab');
  }

  // ICU's own opinion, informational: the per-region zone list and the supported time zone list.
  const supported = new Set(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []);
  for (const region of regions) {
    const mine = region.zones.map((zone) => zone.iana);
    const icu = icuZonesOf(region.code);
    if (icu !== null && (icu.length !== mine.length || icu.some((id) => !mine.includes(id)))) {
      report.icu.push(region.code + ': ICU ' + icu.join(',') + ' / table ' + mine.join(','));
    }
    if (supported.size > 0) for (const id of mine) if (!supported.has(id)) report.icu.push(region.code + ': ' + id + ' is not in Intl.supportedValuesOf');
  }
  if (regions.length === 0) throw new Error('no regions built');
  return { regions, report };
}

// ---- rendering --------------------------------------------------------------------------------------------------------------

export function q(text) {
  let out = "'";
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (ch === "'" || ch === '\\') out += '\\' + ch;
    else if (cp < 0x20 || cp > 0x7e) out += cp > 0xffff ? '\\u{' + cp.toString(16) + '}' : '\\u' + cp.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + "'";
}

const num = (value) => String(value === 0 ? 0 : value);

function renderRow(region) {
  const head = [q(region.code), q(region.nameEn), q(region.locale), '[' + region.languages.map(q).join(', ') + ']', q(region.defaultZone)];
  const zones = region.zones.map((zone) => '[' + [q(zone.iana), q(zone.city), num(zone.lat), num(zone.lon)].join(', ') + ']');
  if (zones.length === 1) return '  [' + head.join(', ') + ', [' + zones[0] + ']],';
  return '  [' + head.join(', ') + ', [\n' + zones.map((zone) => '    ' + zone + ',').join('\n') + '\n  ]],';
}

export const toolchain = () => ({
  icu: process.versions.icu,
  cldr: process.versions.cldr,
  unicode: process.versions.unicode,
  tz: process.versions.tz,
});

const VERSION_LINE = /^export const REGION_DATA_VERSION = (\d+);$/m;

// The part of the module that runs in the extension, emitted as written (String.raw keeps the regex backslashes).
const RUNTIME = String.raw`
const ACCURACY_METRES = ${ACCURACY_METRES};
const CODE_PATTERN = /^[A-Za-z]{2}$/;
const MAX_ZONE_ID_LENGTH = 128;

let regions = null;
// Frozen Region objects, built once on first use.
function table() {
  if (regions === null) {
    regions = new Map();
    for (const [code, nameEn, locale, languages, defaultZone, zones] of ROWS) {
      regions.set(code, Object.freeze({
        code,
        nameEn,
        locale,
        languages: Object.freeze(languages.slice()),
        zones: Object.freeze(zones.map(([iana, city, lat, lon]) => Object.freeze({ iana, city, lat, lon }))),
        defaultZone,
      }));
    }
  }
  return regions;
}

// ISO 3166-1 alpha-2 codes, uppercase, sorted. A fresh array on every call.
export function regionCodes() {
  return Array.from(table().keys());
}

// Case-insensitive; anything but two ASCII letters (or an unknown code) gives null. The result is frozen and shared.
export function regionByCode(code) {
  if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
    return null;
  }
  return table().get(code.toUpperCase()) ?? null;
}

let stored = null;
let browser = null;

// Region code of a time zone id. Exact match in the stored (ICU canonical, Chrome) spelling first; then any alias the running
// browser canonicalizes to a stored zone (Asia/Kolkata -> Asia/Calcutta); then the stored zones in the browser's own spelling
// (Firefox spells some ids differently). Only Area/Location ids count: UTC, EST, CET and the legacy country names (Japan) do not
// name a place, so they never imply a region. Unknown or non-string input gives null.
export function regionOfTimeZone(iana) {
  if (typeof iana !== 'string' || iana.length > MAX_ZONE_ID_LENGTH || !iana.includes('/')) {
    return null;
  }
  if (stored === null) {
    stored = new Map();
    for (const region of table().values()) {
      for (const zone of region.zones) {
        stored.set(zone.iana, region.code);
      }
    }
  }
  const exact = stored.get(iana);
  if (exact !== undefined) {
    return exact;
  }
  const canonical = canonicalTimeZone(iana);
  if (typeof canonical !== 'string') {
    return null;
  }
  const alias = canonical === iana ? undefined : stored.get(canonical);
  if (alias !== undefined) {
    return alias;
  }
  if (browser === null) {
    browser = new Map();
    for (const [id, code] of stored) {
      const spelling = canonicalTimeZone(id);
      if (spelling !== id) {
        browser.set(spelling, code);
      }
    }
  }
  return browser.get(canonical) ?? null;
}

// Everything a device preset needs for a region: zone, language list and the coordinates of the default zone. Fresh copies.
export function regionDefaults(code) {
  const region = regionByCode(code);
  if (region === null) {
    return null;
  }
  const zone = region.zones.find((entry) => entry.iana === region.defaultZone);
  return {
    code: region.code,
    timeZone: zone.iana,
    locale: region.locale,
    languages: region.languages.slice(),
    latitude: zone.lat,
    longitude: zone.lon,
    accuracy: ACCURACY_METRES,
  };
}
`;

export function renderModule({ regions, inputs, version }) {
  const tools = toolchain();
  const zoneCount = regions.reduce((sum, region) => sum + region.zones.length, 0);
  return [
    '// Generated by scripts/production/gen-region-data.mjs from packages/catalog/data/tzdata. Do not edit by hand.',
    '// Offline table "country -> language, time zone, coordinates" for the Antidetect region picker. No network, no clock.',
    '// Notice and license texts: REGION-DATA-NOTICE.txt. Inputs and tools recorded here; any change needs a regeneration.',
    '//   IANA tz database ' + inputs.version + ' (public domain), sha256 of the files as published:',
    '//     zone.tab      ' + inputs.hashes['zone.tab'],
    '//     zone1970.tab  ' + inputs.hashes['zone1970.tab'],
    '//     iso3166.tab   ' + inputs.hashes['iso3166.tab'],
    '//   Unicode CLDR ' + tools.cldr + ' through ICU ' + tools.icu + ' (Unicode ' + tools.unicode + ', ICU tz data ' + tools.tz + ') as built into',
    '//   Node: likely locales, English region names, canonical time zone spelling (Unicode License v3).',
    '// Toolchain: icu=' + tools.icu + ' cldr=' + tools.cldr + ' unicode=' + tools.unicode + ' tz=' + tools.tz,
    '// ' + regions.length + ' regions, ' + zoneCount + ' zones. Row: [code, nameEn, locale, languages, defaultZone, [[iana, city, lat, lon], ...]].',
    '// iana is the spelling Chrome reports (ICU canonical); coordinates are decimal degrees of the zone.tab principal location.',
    "import { canonicalTimeZone } from './fingerprint-timezone-data.js';",
    '',
    '// Bumped by the generator whenever the content below changes.',
    'export const REGION_DATA_VERSION = ' + version + ';',
    '',
    'const ROWS = [',
    ...regions.map(renderRow),
    '];',
    RUNTIME,
  ].join('\n');
}

// Version rule: unchanged content keeps the committed number, any other change adds one. First run: 1.
export function chooseVersion(previous, render) {
  const probe = render(1);
  const match = previous === null ? null : VERSION_LINE.exec(previous);
  if (match === null) return 1;
  const same = previous.replace(VERSION_LINE, 'export const REGION_DATA_VERSION = 1;') === probe;
  return same ? Number(match[1]) : Number(match[1]) + 1;
}

export function generate(inputs, previous) {
  const { regions, report } = buildRegions({
    zoneRows: parseZoneTab(inputs.files['zone.tab']),
    isoNames: parseIsoTab(inputs.files['iso3166.tab']),
    zone1970: parseZone1970(inputs.files['zone1970.tab']),
  });
  const render = (version) => renderModule({ regions, inputs, version });
  const version = chooseVersion(previous, render);
  return { text: render(version), version, regions, report };
}

// ---- command line -----------------------------------------------------------------------------------------------------------

function recordedToolchain(text) {
  const match = /^\/\/ Toolchain: icu=(\S+) cldr=(\S+) unicode=(\S+) tz=(\S+)$/m.exec(text);
  return match === null ? null : { icu: match[1], cldr: match[2], unicode: match[3], tz: match[4] };
}

function firstDifference(expected, actual) {
  const left = expected.split('\n');
  const right = actual.split('\n');
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    if (left[index] !== right[index]) {
      const clip = (line) => (line === undefined ? '(end of file)' : line.length > 160 ? line.slice(0, 160) + '...' : line);
      return 'line ' + (index + 1) + '\n  fresh run: ' + clip(left[index]) + '\n  committed:  ' + clip(right[index]);
    }
  }
  return 'no line differs';
}

function parseArgs(argv) {
  const args = { check: false, inputDir: INPUT_DIR, output: OUTPUT_FILE };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--check') args.check = true;
    else if (flag === '--input-dir' || flag === '--output') {
      const value = argv[++index];
      if (value === undefined || value.startsWith('--')) throw new Error(flag + ' needs a value');
      if (flag === '--input-dir') args.inputDir = resolve(value);
      else args.output = resolve(value);
    } else throw new Error('unknown argument: ' + flag);
  }
  return args;
}

function summary(result, inputs) {
  const { regions, report, version, text } = result;
  const lines = [
    'region data: ' + regions.length + ' regions, ' + regions.reduce((sum, region) => sum + region.zones.length, 0) + ' zones, ' +
      Buffer.byteLength(text) + ' bytes, REGION_DATA_VERSION ' + version,
    '  tz database ' + inputs.version + '; ICU ' + process.versions.icu + ', CLDR ' + process.versions.cldr + ', Unicode ' + process.versions.unicode,
    '  ids rejected by Intl: ' + (report.rejected.length === 0 ? 'none' : report.rejected.join(', ')),
    '  ids respelled by Intl (' + report.respelled.length + '): ' + report.respelled.join('; '),
    '  duplicate ids after canonicalization: ' + (report.duplicates.length === 0 ? 'none' : report.duplicates.join('; ')),
    '  locale overrides (' + report.localeOverrides.length + '): ' + report.localeOverrides.join('; '),
    '  default zone chosen by the fallback rule: ' + (report.defaultFallback.length === 0 ? 'none' : report.defaultFallback.join(', ')),
    '  ICU cross-check (Locale#getTimeZones, supportedValuesOf): ' + (report.icu.length === 0 ? 'agrees for every region' : report.icu.join(' | ')),
  ];
  for (const warning of report.warnings) lines.push('  warning: ' + warning);
  return lines.join('\n');
}

export function main(argv) {
  const args = parseArgs(argv);
  const inputs = readInputs(args.inputDir);
  const committed = existsSync(OUTPUT_FILE) ? normalizeNewlines(readFileSync(OUTPUT_FILE, 'utf8')) : null;
  const result = generate(inputs, committed);
  if (!args.check) {
    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, result.text, 'utf8');
    console.log(summary(result, inputs));
    console.log('  wrote ' + args.output);
    return 0;
  }
  const target = args.output === OUTPUT_FILE ? committed : existsSync(args.output) ? normalizeNewlines(readFileSync(args.output, 'utf8')) : null;
  if (target === null) {
    console.error('region data: ' + args.output + ' is missing; run node scripts/production/gen-region-data.mjs');
    return 1;
  }
  if (target === result.text) {
    console.log(summary(result, inputs));
    console.log('  --check: ' + args.output + ' is up to date');
    return 0;
  }
  const recorded = recordedToolchain(target);
  const now = toolchain();
  if (recorded === null || Object.keys(now).some((key) => recorded[key] !== now[key])) {
    console.error('region data: --check cannot verify ' + args.output + ': this Node has ICU ' + now.icu + ', CLDR ' + now.cldr + ', Unicode ' +
      now.unicode + ', tz ' + now.tz + '; the file records ' + (recorded === null ? 'no toolchain' : JSON.stringify(recorded)) +
      '. Regenerate under this toolchain and review the diff.');
    return 3;
  }
  console.error('region data: ' + args.output + ' is stale or was edited by hand; first difference at ' + firstDifference(result.text, target));
  console.error('  run node scripts/production/gen-region-data.mjs and review the diff');
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error('region data: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
