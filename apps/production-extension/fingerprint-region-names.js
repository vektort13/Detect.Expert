// ADR-104 addendum 4: offline country names and search for the Region picker. Names come from Intl.DisplayNames in the UI
// language (the browser's own CLDR data, no network); the English name of the region data is the fallback. Pure functions.
import { regionCodes, regionByCode } from './fingerprint-region-data.js';
import { sameTimeZone } from './fingerprint-timezone-data.js';

const MAX_QUERY = 64, MAX_LOCALES = 24;
// Wu Chinese has no CLDR names and its UI text is Simplified Chinese; Cantonese falls back to Traditional Chinese (Hong Kong).
const NAME_CHAIN = Object.freeze({ wuu: ['wuu', 'zh-CN'], yue: ['yue', 'zh-HK'] });
const pickers = new Map();

export const languageTag = locale => String(typeof locale === 'string' ? locale : locale?.id ?? 'en').replace('_', '-');
// Only the Latin/Cyrillic/Greek combining accents are dropped; Indic and Arabic marks are part of the letters.
// A typographic apostrophe (Côte d’Ivoire) matches the typed ASCII one.
const fold = text => String(text).normalize('NFD').replace(/[̀-ͯ]/gu, '').replace(/[’ʼ]/gu, "'").toLowerCase();

function displayNames(tag) {
  try {
    if (typeof Intl.DisplayNames !== 'function') return null;
    const supported = Intl.DisplayNames.supportedLocalesOf(NAME_CHAIN[tag] ?? [tag])[0];
    return supported ? new Intl.DisplayNames([supported], { type: 'region', fallback: 'none' }) : null;
  } catch { return null; }
}

// One sorted list per UI language: { code, name, english } plus folded copies for matching.
export function regionPicker(locale) {
  const tag = languageTag(locale), cached = pickers.get(tag); if (cached) return cached;
  const names = displayNames(tag);
  let collator; try { collator = new Intl.Collator(NAME_CHAIN[tag] ?? tag); } catch { collator = new Intl.Collator('en'); }
  const list = regionCodes().map(code => {
    const english = regionByCode(code)?.nameEn ?? code; let local; try { local = names?.of(code); } catch { local = undefined; }
    const name = typeof local === 'string' && local.trim() && local !== code ? local : english;
    return Object.freeze({ code, name, english, folded: fold(name), foldedEnglish: fold(english), foldedCode: code.toLowerCase() });
  }).sort((left, right) => collator.compare(left.name, right.name) || (left.code < right.code ? -1 : 1));
  const picker = Object.freeze({ tag, list: Object.freeze(list), byCode: new Map(list.map(entry => [entry.code, entry])) });
  if (pickers.size >= MAX_LOCALES) pickers.delete(pickers.keys().next().value);
  pickers.set(tag, picker); return picker;
}
export const regionName = (locale, code) => regionPicker(locale).byCode.get(code)?.name ?? null;

// Exact code first, then names that start with the query, then names that contain it, then codes that start with it.
export function searchRegions(list, query) {
  const needle = fold(String(query ?? '').slice(0, MAX_QUERY)).trim();
  if (!needle) return list;
  const ranked = [];
  for (const entry of list) {
    const rank = entry.foldedCode === needle ? 0
      : entry.folded.startsWith(needle) ? 1 : entry.foldedEnglish.startsWith(needle) ? 2
      : entry.folded.includes(needle) || entry.foldedEnglish.includes(needle) ? 3
      : entry.foldedCode.startsWith(needle) ? 4 : -1;
    if (rank >= 0) ranked.push([rank, entry]);
  }
  return ranked.sort((left, right) => left[0] - right[0]).map(item => item[1]);
}

// Coordinates are shown rounded to two decimals; a value that rounds to zero never shows a minus sign.
const place = value => { const rounded = Math.round(value * 100) / 100; return (Object.is(rounded, -0) ? 0 : rounded).toFixed(2); };
export const formatCoordinates = (latitude, longitude) => place(latitude) + ', ' + place(longitude);

// The city that the coordinates name (to the shown precision); without coordinates, the principal city of the current time zone.
// Coordinates that match no city of the region name none: the zone's city must not be shown beside a place it does not describe.
export function regionCity(code, geolocation, timeZone) {
  const zones = regionByCode(code)?.zones ?? [];
  if (geolocation) return zones.find(zone => place(zone.lat) === place(geolocation.latitude) && place(zone.lon) === place(geolocation.longitude))?.city ?? null;
  return timeZone ? zones.find(zone => sameTimeZone(zone.iana, timeZone))?.city ?? null : null;
}
