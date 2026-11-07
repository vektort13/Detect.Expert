// ADR-069: pure Unix-seconds <-> date/time conversion for the cookie editor. No DOM, no chrome.*, no storage and no free-text Date parsing.
// Unix seconds travel as decimal text, so the fraction digits of a value such as 1797166957.97721 (Chrome reports fractions) move verbatim in both
// directions and a round trip cannot drift. Only whole seconds go through Date arithmetic.

/** The largest instant a Date can hold: 8.64e15 ms. */
export const MAX_UNIX_SECONDS = 8640000000000;
const MAX_FRACTION_DIGITS = 9;
const DECIMAL = /^(\d+)(?:\.(\d+))?$/u;
const NEGATIVE = /^-\d+(?:\.\d+)?$/u;
// YYYY-MM-DD, a space or T, HH:mm with optional :ss and .fraction, then optional Z or an offset (+hh, +hh:mm, +hhmm).
const DATE_TIME = /^(\d{4,6})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(?:(Z)|([+-])(\d{2})(?::?(\d{2}))?)?$/iu;
const NON_ZERO = /[1-9]/u;
const pad = (value, length = 2) => String(value).padStart(length, '0');

/** Minutes east of UTC that the browser's own time zone has at the instant `ms`. */
export const localOffsetMinutes = ms => -new Date(ms).getTimezoneOffset();

export function formatOffset(minutes) {
  const absolute = Math.abs(minutes);
  return (minutes < 0 ? '-' : '+') + pad(Math.trunc(absolute / 60)) + ':' + pad(absolute % 60);
}
export const offsetLabel = minutes => 'UTC' + formatOffset(minutes);

/** Positive Unix seconds as text: digits with an optional '.' fraction (up to nine digits). Returns the parts so callers never need Number() on the text. */
export function parseUnixSeconds(text) {
  if (typeof text !== 'string') return { ok: false, code: 'format' };
  const value = text.trim();
  if (value === '') return { ok: false, code: 'empty' };
  if (NEGATIVE.test(value)) return { ok: false, code: 'range' };
  const match = DECIMAL.exec(value);
  if (!match || (match[2]?.length ?? 0) > MAX_FRACTION_DIGITS) return { ok: false, code: 'format' };
  const digits = match[1].replace(/^0+(?=\d)/u, ''), fraction = match[2] ?? '';
  if (digits.length > 13) return { ok: false, code: 'range' };
  const whole = Number(digits), beyond = whole > MAX_UNIX_SECONDS || whole === MAX_UNIX_SECONDS && NON_ZERO.test(fraction);
  if (beyond || whole === 0 && !NON_ZERO.test(fraction)) return { ok: false, code: 'range' };
  const normalized = fraction === '' ? digits : digits + '.' + fraction;
  return { ok: true, whole, fraction, text: normalized, seconds: Number(normalized) };
}

/** Unix seconds -> 'YYYY-MM-DD HH:mm:ss[.fraction]' plus 'Z' (UTC) or the explicit '+hh:mm' offset the zone had at that instant. */
export function unixSecondsToDateTime(text, { zone = 'local', offsetMinutesAt = localOffsetMinutes } = {}) {
  const parsed = parseUnixSeconds(text);
  if (!parsed.ok) return parsed;
  const offset = zone === 'utc' ? 0 : offsetMinutesAt(parsed.whole * 1000);
  if (!Number.isFinite(offset) || Math.abs(offset) >= 24 * 60) return { ok: false, code: 'range' };
  const wall = new Date(parsed.whole * 1000 + offset * 60000);
  if (Number.isNaN(wall.getTime())) return { ok: false, code: 'range' };
  const date = pad(wall.getUTCFullYear(), 4) + '-' + pad(wall.getUTCMonth() + 1) + '-' + pad(wall.getUTCDate());
  const time = pad(wall.getUTCHours()) + ':' + pad(wall.getUTCMinutes()) + ':' + pad(wall.getUTCSeconds()) + (parsed.fraction === '' ? '' : '.' + parsed.fraction);
  return { ok: true, text: date + ' ' + time + (zone === 'utc' ? 'Z' : formatOffset(offset)), offsetMinutes: offset };
}

const leap = year => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const daysIn = (year, month) => month === 2 ? (leap(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;

// Every UTC instant whose local wall clock reads `wall` (the wall time written as if it were UTC). Real offsets lie within -12h..+14h, so the true
// instant is within [wall - 14h, wall + 12h]; sample the zone hourly there to learn which offsets it uses, then keep the offsets that are consistent.
function localInstants(wall, offsetMinutesAt) {
  const offsets = new Set();
  for (let hours = -14; hours <= 12; hours++) {
    const offset = offsetMinutesAt(wall + hours * 3600000);
    if (Number.isFinite(offset)) offsets.add(offset);
  }
  const instants = [];
  for (const offset of offsets) { const instant = wall - offset * 60000; if (offsetMinutesAt(instant) === offset) instants.push(instant); }
  return instants;
}

/** 'YYYY-MM-DD HH:mm[:ss[.fraction]]' with an optional Z / +hh:mm offset -> Unix seconds text. Without an offset `zone` ('local' or 'utc') applies;
 * a local time that does not exist (clock change) or occurs twice is refused instead of guessed. */
export function dateTimeToUnixSeconds(text, { zone = 'local', offsetMinutesAt = localOffsetMinutes } = {}) {
  if (typeof text !== 'string') return { ok: false, code: 'format' };
  const value = text.trim();
  if (value === '') return { ok: false, code: 'empty' };
  const match = DATE_TIME.exec(value);
  if (!match) return { ok: false, code: 'format' };
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(part => part === undefined ? 0 : Number(part)), fraction = match[7] ?? '';
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month) || hour > 23 || minute > 59 || second > 59) return { ok: false, code: 'format' };
  let explicit = null;
  if (match[8] !== undefined) explicit = 0;
  else if (match[9] !== undefined) {
    const hours = Number(match[10]), minutes = match[11] === undefined ? 0 : Number(match[11]);
    if (hours > 23 || minutes > 59) return { ok: false, code: 'format' };
    explicit = (match[9] === '-' ? -1 : 1) * (hours * 60 + minutes);
  }
  if (year < 1970) return { ok: false, code: 'range' };
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(wall)) return { ok: false, code: 'range' };
  let instant;
  if (explicit !== null) instant = wall - explicit * 60000;
  else if (zone === 'utc') instant = wall;
  else {
    const found = localInstants(wall, offsetMinutesAt);
    if (found.length === 0) return { ok: false, code: 'gap' };
    if (found.length > 1) return { ok: false, code: 'ambiguous' };
    instant = found[0];
  }
  const seconds = instant / 1000;
  return parseUnixSeconds(String(seconds) + (fraction === '' ? '' : '.' + fraction));
}

const UNITS = Object.freeze([['year', 365.25 * 86400], ['month', 30.4375 * 86400], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]]);

/** The Intl tag for an interface language id ('pt_BR' -> 'pt-BR'; Wu has no Intl data and reads as Simplified Chinese); 'en' when Intl does not know it. */
export function intlTag(locale, intl = globalThis.Intl) {
  const raw = typeof locale === 'string' && locale ? locale : 'en', tag = raw === 'wuu' ? 'zh-Hans' : raw.replaceAll('_', '-');
  try { return intl.DateTimeFormat.supportedLocalesOf([tag]).length ? tag : 'en'; } catch { return 'en'; }
}

/** The moment as a localized date and time with the zone name of this browser; null when it cannot be shown. */
export function readableDateTime(seconds, locale, intl = globalThis.Intl) {
  try {
    const date = new Date(seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : new intl.DateTimeFormat(intlTag(locale, intl), { dateStyle: 'medium', timeStyle: 'long' }).format(date);
  } catch { return null; }
}

/** 'in 3 days' / '2 months ago' for a distance in seconds, whole units rounded toward zero; '' when Intl has no relative-time support. */
export function relativeTime(deltaSeconds, locale, intl = globalThis.Intl) {
  if (!Number.isFinite(deltaSeconds)) return '';
  const distance = Math.abs(deltaSeconds), sign = deltaSeconds < 0 ? -1 : 1;
  const [unit, size] = distance >= 730.5 * 86400 ? UNITS[0] : distance >= 60 * 86400 ? UNITS[1] : distance >= 86400 ? UNITS[2] : distance >= 3600 ? UNITS[3] : distance >= 60 ? UNITS[4] : UNITS[5];
  const amount = Math.trunc(distance / size);
  try { return new intl.RelativeTimeFormat(intlTag(locale, intl), { numeric: amount === 0 ? 'auto' : 'always' }).format(amount === 0 ? 0 : sign * amount, unit); } catch { return ''; }
}
