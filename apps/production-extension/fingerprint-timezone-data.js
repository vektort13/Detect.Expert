// ADR-104: offline timezone dataset for the Antidetect privacy picker. Pure data; no network.
//
// offsetMinutes uses the JS Date.prototype.getTimezoneOffset sign convention
// (UTC minus local): zones east of UTC are negative, west of UTC are positive.
// Values are STANDARD-time offsets (never DST). Sign anchors used while authoring:
// America/New_York 300, Europe/Berlin -60, Asia/Tokyo -540, Europe/London 0, UTC 0.

const DATA = [
  // North America
  { iana: 'America/New_York', city: 'New York', country: 'United States', countryCode: 'US', offsetMinutes: 300, suggestedLocale: 'en-US' },
  { iana: 'America/Chicago', city: 'Chicago', country: 'United States', countryCode: 'US', offsetMinutes: 360, suggestedLocale: 'en-US' },
  { iana: 'America/Denver', city: 'Denver', country: 'United States', countryCode: 'US', offsetMinutes: 420, suggestedLocale: 'en-US' },
  { iana: 'America/Los_Angeles', city: 'Los Angeles', country: 'United States', countryCode: 'US', offsetMinutes: 480, suggestedLocale: 'en-US' },
  { iana: 'America/Phoenix', city: 'Phoenix', country: 'United States', countryCode: 'US', offsetMinutes: 420, suggestedLocale: 'en-US' },
  { iana: 'America/Anchorage', city: 'Anchorage', country: 'United States', countryCode: 'US', offsetMinutes: 540, suggestedLocale: 'en-US' },
  { iana: 'Pacific/Honolulu', city: 'Honolulu', country: 'United States', countryCode: 'US', offsetMinutes: 600, suggestedLocale: 'en-US' },
  { iana: 'America/Toronto', city: 'Toronto', country: 'Canada', countryCode: 'CA', offsetMinutes: 300, suggestedLocale: 'en-CA' },
  { iana: 'America/Vancouver', city: 'Vancouver', country: 'Canada', countryCode: 'CA', offsetMinutes: 480, suggestedLocale: 'en-CA' },
  { iana: 'America/Edmonton', city: 'Edmonton', country: 'Canada', countryCode: 'CA', offsetMinutes: 420, suggestedLocale: 'en-CA' },
  { iana: 'America/Halifax', city: 'Halifax', country: 'Canada', countryCode: 'CA', offsetMinutes: 240, suggestedLocale: 'en-CA' },
  { iana: 'America/Mexico_City', city: 'Mexico City', country: 'Mexico', countryCode: 'MX', offsetMinutes: 360, suggestedLocale: 'es-MX' },

  // Central & South America
  { iana: 'America/Bogota', city: 'Bogota', country: 'Colombia', countryCode: 'CO', offsetMinutes: 300, suggestedLocale: 'es-CO' },
  { iana: 'America/Lima', city: 'Lima', country: 'Peru', countryCode: 'PE', offsetMinutes: 300, suggestedLocale: 'es-PE' },
  { iana: 'America/Santiago', city: 'Santiago', country: 'Chile', countryCode: 'CL', offsetMinutes: 240, suggestedLocale: 'es-CL' },
  { iana: 'America/Sao_Paulo', city: 'Sao Paulo', country: 'Brazil', countryCode: 'BR', offsetMinutes: 180, suggestedLocale: 'pt-BR' },
  { iana: 'America/Argentina/Buenos_Aires', city: 'Buenos Aires', country: 'Argentina', countryCode: 'AR', offsetMinutes: 180, suggestedLocale: 'es-AR' },
  { iana: 'America/Caracas', city: 'Caracas', country: 'Venezuela', countryCode: 'VE', offsetMinutes: 240, suggestedLocale: 'es-VE' },
  { iana: 'America/Montevideo', city: 'Montevideo', country: 'Uruguay', countryCode: 'UY', offsetMinutes: 180, suggestedLocale: 'es-UY' },

  // Europe
  { iana: 'Europe/London', city: 'London', country: 'United Kingdom', countryCode: 'GB', offsetMinutes: 0, suggestedLocale: 'en-GB' },
  { iana: 'Europe/Dublin', city: 'Dublin', country: 'Ireland', countryCode: 'IE', offsetMinutes: 0, suggestedLocale: 'en-IE' },
  { iana: 'Europe/Lisbon', city: 'Lisbon', country: 'Portugal', countryCode: 'PT', offsetMinutes: 0, suggestedLocale: 'pt-PT' },
  { iana: 'Europe/Madrid', city: 'Madrid', country: 'Spain', countryCode: 'ES', offsetMinutes: -60, suggestedLocale: 'es-ES' },
  { iana: 'Europe/Paris', city: 'Paris', country: 'France', countryCode: 'FR', offsetMinutes: -60, suggestedLocale: 'fr-FR' },
  { iana: 'Europe/Berlin', city: 'Berlin', country: 'Germany', countryCode: 'DE', offsetMinutes: -60, suggestedLocale: 'de-DE' },
  { iana: 'Europe/Rome', city: 'Rome', country: 'Italy', countryCode: 'IT', offsetMinutes: -60, suggestedLocale: 'it-IT' },
  { iana: 'Europe/Amsterdam', city: 'Amsterdam', country: 'Netherlands', countryCode: 'NL', offsetMinutes: -60, suggestedLocale: 'nl-NL' },
  { iana: 'Europe/Brussels', city: 'Brussels', country: 'Belgium', countryCode: 'BE', offsetMinutes: -60, suggestedLocale: 'nl-BE' },
  { iana: 'Europe/Zurich', city: 'Zurich', country: 'Switzerland', countryCode: 'CH', offsetMinutes: -60, suggestedLocale: 'de-CH' },
  { iana: 'Europe/Vienna', city: 'Vienna', country: 'Austria', countryCode: 'AT', offsetMinutes: -60, suggestedLocale: 'de-AT' },
  { iana: 'Europe/Warsaw', city: 'Warsaw', country: 'Poland', countryCode: 'PL', offsetMinutes: -60, suggestedLocale: 'pl-PL' },
  { iana: 'Europe/Prague', city: 'Prague', country: 'Czechia', countryCode: 'CZ', offsetMinutes: -60, suggestedLocale: 'cs-CZ' },
  { iana: 'Europe/Stockholm', city: 'Stockholm', country: 'Sweden', countryCode: 'SE', offsetMinutes: -60, suggestedLocale: 'sv-SE' },
  { iana: 'Europe/Oslo', city: 'Oslo', country: 'Norway', countryCode: 'NO', offsetMinutes: -60, suggestedLocale: 'nb-NO' },
  { iana: 'Europe/Copenhagen', city: 'Copenhagen', country: 'Denmark', countryCode: 'DK', offsetMinutes: -60, suggestedLocale: 'da-DK' },
  { iana: 'Europe/Budapest', city: 'Budapest', country: 'Hungary', countryCode: 'HU', offsetMinutes: -60, suggestedLocale: 'hu-HU' },
  { iana: 'Europe/Athens', city: 'Athens', country: 'Greece', countryCode: 'GR', offsetMinutes: -120, suggestedLocale: 'el-GR' },
  { iana: 'Europe/Helsinki', city: 'Helsinki', country: 'Finland', countryCode: 'FI', offsetMinutes: -120, suggestedLocale: 'fi-FI' },
  { iana: 'Europe/Bucharest', city: 'Bucharest', country: 'Romania', countryCode: 'RO', offsetMinutes: -120, suggestedLocale: 'ro-RO' },
  { iana: 'Europe/Kyiv', city: 'Kyiv', country: 'Ukraine', countryCode: 'UA', offsetMinutes: -120, suggestedLocale: 'uk-UA' },
  { iana: 'Europe/Istanbul', city: 'Istanbul', country: 'Turkey', countryCode: 'TR', offsetMinutes: -180, suggestedLocale: 'tr-TR' },
  { iana: 'Europe/Moscow', city: 'Moscow', country: 'Russia', countryCode: 'RU', offsetMinutes: -180, suggestedLocale: 'ru-RU' },
  { iana: 'Atlantic/Reykjavik', city: 'Reykjavik', country: 'Iceland', countryCode: 'IS', offsetMinutes: 0, suggestedLocale: 'is-IS' },

  // Africa
  { iana: 'Africa/Lagos', city: 'Lagos', country: 'Nigeria', countryCode: 'NG', offsetMinutes: -60, suggestedLocale: 'en-NG' },
  { iana: 'Africa/Cairo', city: 'Cairo', country: 'Egypt', countryCode: 'EG', offsetMinutes: -120, suggestedLocale: 'ar-EG' },
  { iana: 'Africa/Johannesburg', city: 'Johannesburg', country: 'South Africa', countryCode: 'ZA', offsetMinutes: -120, suggestedLocale: 'en-ZA' },
  { iana: 'Africa/Nairobi', city: 'Nairobi', country: 'Kenya', countryCode: 'KE', offsetMinutes: -180, suggestedLocale: 'sw-KE' },
  { iana: 'Africa/Accra', city: 'Accra', country: 'Ghana', countryCode: 'GH', offsetMinutes: 0, suggestedLocale: 'en-GH' },
  { iana: 'Africa/Algiers', city: 'Algiers', country: 'Algeria', countryCode: 'DZ', offsetMinutes: -60, suggestedLocale: 'ar-DZ' },

  // Middle East
  { iana: 'Asia/Jerusalem', city: 'Jerusalem', country: 'Israel', countryCode: 'IL', offsetMinutes: -120, suggestedLocale: 'he-IL' },
  { iana: 'Asia/Riyadh', city: 'Riyadh', country: 'Saudi Arabia', countryCode: 'SA', offsetMinutes: -180, suggestedLocale: 'ar-SA' },
  { iana: 'Asia/Dubai', city: 'Dubai', country: 'United Arab Emirates', countryCode: 'AE', offsetMinutes: -240, suggestedLocale: 'ar-AE' },
  { iana: 'Asia/Tehran', city: 'Tehran', country: 'Iran', countryCode: 'IR', offsetMinutes: -210, suggestedLocale: 'fa-IR' },
  { iana: 'Asia/Baghdad', city: 'Baghdad', country: 'Iraq', countryCode: 'IQ', offsetMinutes: -180, suggestedLocale: 'ar-IQ' },
  { iana: 'Asia/Qatar', city: 'Doha', country: 'Qatar', countryCode: 'QA', offsetMinutes: -180, suggestedLocale: 'ar-QA' },

  // South, Southeast & East Asia
  { iana: 'Asia/Karachi', city: 'Karachi', country: 'Pakistan', countryCode: 'PK', offsetMinutes: -300, suggestedLocale: 'ur-PK' },
  { iana: 'Asia/Kolkata', city: 'Kolkata', country: 'India', countryCode: 'IN', offsetMinutes: -330, suggestedLocale: 'hi-IN' },
  { iana: 'Asia/Colombo', city: 'Colombo', country: 'Sri Lanka', countryCode: 'LK', offsetMinutes: -330, suggestedLocale: 'si-LK' },
  { iana: 'Asia/Kathmandu', city: 'Kathmandu', country: 'Nepal', countryCode: 'NP', offsetMinutes: -345, suggestedLocale: 'ne-NP' },
  { iana: 'Asia/Dhaka', city: 'Dhaka', country: 'Bangladesh', countryCode: 'BD', offsetMinutes: -360, suggestedLocale: 'bn-BD' },
  { iana: 'Asia/Yangon', city: 'Yangon', country: 'Myanmar', countryCode: 'MM', offsetMinutes: -390, suggestedLocale: 'my-MM' },
  { iana: 'Asia/Bangkok', city: 'Bangkok', country: 'Thailand', countryCode: 'TH', offsetMinutes: -420, suggestedLocale: 'th-TH' },
  { iana: 'Asia/Jakarta', city: 'Jakarta', country: 'Indonesia', countryCode: 'ID', offsetMinutes: -420, suggestedLocale: 'id-ID' },
  { iana: 'Asia/Ho_Chi_Minh', city: 'Ho Chi Minh City', country: 'Vietnam', countryCode: 'VN', offsetMinutes: -420, suggestedLocale: 'vi-VN' },
  { iana: 'Asia/Singapore', city: 'Singapore', country: 'Singapore', countryCode: 'SG', offsetMinutes: -480, suggestedLocale: 'en-SG' },
  { iana: 'Asia/Kuala_Lumpur', city: 'Kuala Lumpur', country: 'Malaysia', countryCode: 'MY', offsetMinutes: -480, suggestedLocale: 'ms-MY' },
  { iana: 'Asia/Manila', city: 'Manila', country: 'Philippines', countryCode: 'PH', offsetMinutes: -480, suggestedLocale: 'en-PH' },
  { iana: 'Asia/Shanghai', city: 'Shanghai', country: 'China', countryCode: 'CN', offsetMinutes: -480, suggestedLocale: 'zh-CN' },
  { iana: 'Asia/Hong_Kong', city: 'Hong Kong', country: 'Hong Kong', countryCode: 'HK', offsetMinutes: -480, suggestedLocale: 'zh-HK' },
  { iana: 'Asia/Taipei', city: 'Taipei', country: 'Taiwan', countryCode: 'TW', offsetMinutes: -480, suggestedLocale: 'zh-TW' },
  { iana: 'Asia/Seoul', city: 'Seoul', country: 'South Korea', countryCode: 'KR', offsetMinutes: -540, suggestedLocale: 'ko-KR' },
  { iana: 'Asia/Tokyo', city: 'Tokyo', country: 'Japan', countryCode: 'JP', offsetMinutes: -540, suggestedLocale: 'ja-JP' },

  // Central Asia
  { iana: 'Asia/Tashkent', city: 'Tashkent', country: 'Uzbekistan', countryCode: 'UZ', offsetMinutes: -300, suggestedLocale: 'uz-UZ' },
  { iana: 'Asia/Almaty', city: 'Almaty', country: 'Kazakhstan', countryCode: 'KZ', offsetMinutes: -300, suggestedLocale: 'kk-KZ' },

  // Oceania
  { iana: 'Australia/Perth', city: 'Perth', country: 'Australia', countryCode: 'AU', offsetMinutes: -480, suggestedLocale: 'en-AU' },
  { iana: 'Australia/Adelaide', city: 'Adelaide', country: 'Australia', countryCode: 'AU', offsetMinutes: -570, suggestedLocale: 'en-AU' },
  { iana: 'Australia/Brisbane', city: 'Brisbane', country: 'Australia', countryCode: 'AU', offsetMinutes: -600, suggestedLocale: 'en-AU' },
  { iana: 'Australia/Sydney', city: 'Sydney', country: 'Australia', countryCode: 'AU', offsetMinutes: -600, suggestedLocale: 'en-AU' },
  { iana: 'Pacific/Auckland', city: 'Auckland', country: 'New Zealand', countryCode: 'NZ', offsetMinutes: -720, suggestedLocale: 'en-NZ' },
  { iana: 'Pacific/Fiji', city: 'Suva', country: 'Fiji', countryCode: 'FJ', offsetMinutes: -720, suggestedLocale: 'en-FJ' },
  { iana: 'Pacific/Guam', city: 'Hagatna', country: 'Guam', countryCode: 'GU', offsetMinutes: -600, suggestedLocale: 'en-GU' },

  // Russia (additional zones)
  { iana: 'Asia/Yekaterinburg', city: 'Yekaterinburg', country: 'Russia', countryCode: 'RU', offsetMinutes: -300, suggestedLocale: 'ru-RU' },
  { iana: 'Asia/Novosibirsk', city: 'Novosibirsk', country: 'Russia', countryCode: 'RU', offsetMinutes: -420, suggestedLocale: 'ru-RU' },
  { iana: 'Asia/Vladivostok', city: 'Vladivostok', country: 'Russia', countryCode: 'RU', offsetMinutes: -600, suggestedLocale: 'ru-RU' },
];

for (const entry of DATA) {
  Object.freeze(entry);
}

export const FINGERPRINT_TIMEZONES = Object.freeze(DATA);

// Chrome reports ICU-canonical zone ids: measured on Chrome 156 (Windows 11), six ids of this list differ from their
// IANA spelling (Asia/Kolkata -> Asia/Calcutta, Europe/Kyiv -> Europe/Kiev, Asia/Kathmandu -> Asia/Katmandu,
// Asia/Yangon -> Asia/Rangoon, Asia/Ho_Chi_Minh -> Asia/Saigon, America/Argentina/Buenos_Aires ->
// America/Buenos_Aires). Firefox canonicalizes differently, so nothing is hard-coded: the browser that runs this code
// is asked, and an id it cannot resolve (or a non-string) is returned unchanged. Pure; the zone is never used for
// anything else, so no clock is read.
export function canonicalTimeZone(id) {
  if (typeof id !== 'string' || id === '' || id.length > 128) {
    return id;
  }
  try {
    const zone = new Intl.DateTimeFormat('en', { timeZone: id }).resolvedOptions().timeZone;
    return typeof zone === 'string' && zone !== '' ? zone : id;
  } catch {
    return id;
  }
}

// Standard-time offset of a zone in the Date#getTimezoneOffset convention (UTC minus local, east of UTC is negative), read
// from the running browser's own tz data at two fixed instants of 2026 (mid January and mid July; the larger value is the
// non-DST one). No clock is read. null for an id this browser does not know. Region defaults (ADR-104 addendum 4) need an
// offset for zones that are not in the list above; for all 84 entries the result equals the hand-authored offsetMinutes
// (checked by scripts/test/fingerprint-timezone-canonical.test.mjs).
const OFFSET_INSTANTS = Object.freeze([Date.UTC(2026, 0, 15, 12), Date.UTC(2026, 6, 15, 12)]);
function offsetAt(zone, instant) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(new Date(instant));
  const name = parts.find((part) => part.type === 'timeZoneName')?.value;
  const match = /^GMT(?:([+\-\u2212])(\d{1,2})(?::(\d{2}))?)?$/u.exec(typeof name === 'string' ? name : '');
  if (match === null) {
    return null;
  }
  if (match[1] === undefined) {
    return 0;
  }
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  // 0 - x, never -x: a zero offset must stay +0.
  return 0 - (match[1] === '+' ? minutes : -minutes);
}
export function standardOffsetMinutes(id) {
  if (typeof id !== 'string' || id === '' || id.length > 128) {
    return null;
  }
  try {
    const winter = offsetAt(id, OFFSET_INSTANTS[0]);
    const summer = offsetAt(id, OFFSET_INSTANTS[1]);
    return winter === null || summer === null ? null : Math.max(winter, summer);
  } catch {
    return null;
  }
}

// True when two ids name the same zone in the browser's own spelling (Asia/Kolkata and Asia/Calcutta on Chrome).
export function sameTimeZone(left, right) {
  return typeof left === 'string' && typeof right === 'string' && canonicalTimeZone(left) === canonicalTimeZone(right);
}

// Canonical spelling of every list entry, resolved lazily once (84 entries, so a keystroke search stays cheap).
const CANONICAL = new Map();
function canonicalOf(entry) {
  let value = CANONICAL.get(entry.iana);
  if (value === undefined) {
    value = canonicalTimeZone(entry.iana);
    CANONICAL.set(entry.iana, value);
  }
  return value;
}

// Case-insensitive substring search over city, country, countryCode and iana (and the browser's canonical spelling).
// No RegExp is built from user input; an empty/blank query returns every entry.
export function searchTimezones(query) {
  if (typeof query !== 'string') {
    return FINGERPRINT_TIMEZONES.slice();
  }
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return FINGERPRINT_TIMEZONES.slice();
  }
  return FINGERPRINT_TIMEZONES.filter(
    (entry) =>
      entry.city.toLowerCase().includes(needle) ||
      entry.country.toLowerCase().includes(needle) ||
      entry.countryCode.toLowerCase().includes(needle) ||
      entry.iana.toLowerCase().includes(needle) ||
      canonicalOf(entry).toLowerCase().includes(needle),
  );
}

// IANA lookup; returns the matching entry or null. A profile stores the browser-canonical spelling (see
// canonicalTimeZone), so a saved id such as Asia/Calcutta still finds the Asia/Kolkata entry.
export function timezoneByIana(iana) {
  if (typeof iana !== 'string') {
    return null;
  }
  for (const entry of FINGERPRINT_TIMEZONES) {
    if (entry.iana === iana) {
      return entry;
    }
  }
  const wanted = canonicalTimeZone(iana);
  for (const entry of FINGERPRINT_TIMEZONES) {
    if (canonicalOf(entry) === wanted) {
      return entry;
    }
  }
  return null;
}
