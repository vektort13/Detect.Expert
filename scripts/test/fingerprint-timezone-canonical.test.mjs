// Canonical time zone ids. Chrome reports ICU-canonical ids; six of the 84 ids of the list differ from their IANA spelling
// (measured on Chrome 156). The helper asks the running browser (never a hard-coded table), so one profile cannot show two
// spellings of a zone: the legacy `timezone` row returned the raw string while `intl-formatting` already canonicalized.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, applyDevicePatch } from '../../apps/production-extension/fingerprint-profiles.js';
import { describeDevice } from '../../apps/production-extension/fingerprint-device-presets.js';
import { canonicalTimeZone, sameTimeZone, standardOffsetMinutes, FINGERPRINT_TIMEZONES, searchTimezones, timezoneByIana } from '../../apps/production-extension/fingerprint-timezone-data.js';

const base = createApiConfiguration();
const val = (configuration, id) => { const row = configuration.apis.find(a => a.id === id); return row?.mode === 'custom' && row.selected.kind === 'value' ? row.selected.value : undefined; };
const viaIntl = id => new Intl.DateTimeFormat('en', { timeZone: id }).resolvedOptions().timeZone;
// Measured on Chrome 156 (Windows 11).
const CHROME_156 = { 'America/Argentina/Buenos_Aires': 'America/Buenos_Aires', 'Europe/Kyiv': 'Europe/Kiev', 'Asia/Kolkata': 'Asia/Calcutta', 'Asia/Kathmandu': 'Asia/Katmandu', 'Asia/Yangon': 'Asia/Rangoon', 'Asia/Ho_Chi_Minh': 'Asia/Saigon' };

test('all 84 zones round trip stable: valid, equal to the Intl round trip, and canonical twice gives the same id', () => {
  assert.equal(FINGERPRINT_TIMEZONES.length, 84);
  for (const { iana } of FINGERPRINT_TIMEZONES) {
    const canonical = canonicalTimeZone(iana);
    assert.equal(canonical, viaIntl(iana), iana + ' is the browser round trip');
    assert.equal(canonicalTimeZone(canonical), canonical, iana + ' is stable');
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: canonical }), iana);
  }
  // The running engine may canonicalize differently from Chrome (Firefox does), so which ids change is pinned in the next test only.
});

test('the six ids measured on Chrome 156 map to their ICU spelling (checked when this runtime canonicalizes like Chrome)', t => {
  if (viaIntl('Asia/Kolkata') !== 'Asia/Calcutta') { t.skip('this runtime does not canonicalize like Chrome 156'); return; }
  for (const [iana, canonical] of Object.entries(CHROME_156)) assert.equal(canonicalTimeZone(iana), canonical, iana);
  const changed = FINGERPRINT_TIMEZONES.filter(({ iana }) => canonicalTimeZone(iana) !== iana).map(({ iana }) => iana).sort();
  assert.deepEqual(changed, Object.keys(CHROME_156).sort(), 'exactly those six differ in this list');
});

test('an unknown id, an empty or oversized string and a non-string come back unchanged', () => {
  for (const value of ['Not/AZone', 'Europe/Nowhere', '', ' ', 'x'.repeat(129), 'Europe/Berlin\u0000', undefined, null, 5, {}, [], Symbol.for('zone')]) assert.equal(canonicalTimeZone(value), value, String(typeof value === 'symbol' ? 'symbol' : value).slice(0, 40));
  assert.equal(canonicalTimeZone('UTC'), viaIntl('UTC'));
  assert.equal(canonicalTimeZone('Europe/Berlin'), 'Europe/Berlin');
  const object = { toString() { throw new Error('coerced'); } };
  assert.equal(canonicalTimeZone(object), object, 'a non-string is never coerced');
});

test('the lookup finds a saved canonical id and the search finds the canonical spelling', () => {
  for (const { iana } of FINGERPRINT_TIMEZONES) {
    assert.equal(timezoneByIana(iana)?.iana, iana, iana + ' exact');
    assert.equal(timezoneByIana(canonicalTimeZone(iana))?.iana, iana, iana + ' by its canonical spelling');
  }
  assert.equal(timezoneByIana('Not/AZone'), null); assert.equal(timezoneByIana(''), null); assert.equal(timezoneByIana(5), null);
  if (viaIntl('Asia/Kolkata') === 'Asia/Calcutta') {
    assert.equal(timezoneByIana('Asia/Calcutta').city, 'Kolkata');
    assert.ok(searchTimezones('calcutta').some(entry => entry.iana === 'Asia/Kolkata'));
  }
  for (const { iana } of FINGERPRINT_TIMEZONES) assert.ok(sameTimeZone(iana, canonicalTimeZone(iana)), iana);
  assert.ok(!sameTimeZone('Europe/Berlin', 'Europe/Paris') && !sameTimeZone('Europe/Berlin', 5) && !sameTimeZone(undefined, undefined) && sameTimeZone('Not/AZone', 'Not/AZone'));
  assert.deepEqual(searchTimezones('berlin').map(entry => entry.iana), ['Europe/Berlin']);
  assert.equal(searchTimezones('').length, 84); assert.equal(searchTimezones(5).length, 84);
});

test('Randomize writes the same spelling to the legacy timezone row and to intl-formatting', () => {
  for (const { iana, offsetMinutes } of FINGERPRINT_TIMEZONES) {
    const result = generateConsistentDevice(base, { deviceType: 'laptop', seed: 3, language: 'en-US', timezone: { timeZone: iana, offsetMinutes } });
    const canonical = canonicalTimeZone(iana);
    assert.equal(val(result.configuration, 'timezone').timeZone, canonical, iana);
    assert.equal(val(result.configuration, 'intl-formatting').timeZone, canonical, iana);
    assert.equal(val(result.configuration, 'timezone').offsetMinutes, offsetMinutes);
  }
  // Without a language only the legacy row is written, still canonical; a missing zone writes none.
  assert.equal(val(generateConsistentDevice(base, { deviceType: 'desktop', seed: 1, timezone: { timeZone: 'Asia/Kolkata', offsetMinutes: -330 } }).configuration, 'timezone').timeZone, canonicalTimeZone('Asia/Kolkata'));
  assert.equal(val(generateConsistentDevice(base, { deviceType: 'desktop', seed: 1 }).configuration, 'timezone'), undefined);
});

test('the time zone control writes the canonical spelling to both rows and describeDevice reads it back', () => {
  for (const { iana, offsetMinutes } of FINGERPRINT_TIMEZONES) {
    const withIntl = applyDevicePatch(applyDevicePatch(base, { language: 'en-US' }).configuration, { timezone: { timeZone: iana, offsetMinutes } });
    const canonical = canonicalTimeZone(iana);
    assert.equal(val(withIntl.configuration, 'timezone').timeZone, canonical, iana);
    assert.equal(val(withIntl.configuration, 'intl-formatting').timeZone, canonical, iana);
    assert.equal(withIntl.device.timezone.timeZone, canonical, iana);
    assert.equal(describeDevice(id => val(withIntl.configuration, id)).timezone.timeZone, canonical);
  }
  // Without an Intl override none is invented, and an unknown id is refused by the validator as before.
  assert.equal(val(applyDevicePatch(base, { timezone: { timeZone: 'Asia/Kolkata', offsetMinutes: -330 } }).configuration, 'intl-formatting'), undefined);
  assert.throws(() => applyDevicePatch(base, { timezone: { timeZone: 'Not/AZone', offsetMinutes: 0 } }), /invalid-value/);
  assert.throws(() => applyDevicePatch(base, { timezone: { offsetMinutes: 0 } }), /invalid-value/);
});

// --- standardOffsetMinutes (region defaults need an offset for zones outside the 84-entry list) -------------------------------

test('standardOffsetMinutes equals the hand-authored standard offset of all 84 zones (getTimezoneOffset sign: east is negative)', () => {
  for (const { iana, offsetMinutes } of FINGERPRINT_TIMEZONES) {
    assert.equal(standardOffsetMinutes(iana), offsetMinutes, iana);
    assert.equal(standardOffsetMinutes(canonicalTimeZone(iana)), offsetMinutes, iana + ' by its canonical spelling');
  }
});

test('standardOffsetMinutes is the non-DST offset: southern summer time, fractional offsets, link names and Etc zones', () => {
  const cases = { 'Europe/Berlin': -60, 'America/New_York': 300, 'Australia/Sydney': -600, 'Australia/Adelaide': -570, 'Asia/Kolkata': -330, 'Asia/Calcutta': -330, 'Asia/Kathmandu': -345,
    'America/St_Johns': 210, 'Pacific/Chatham': -765, 'Europe/Dublin': 0, UTC: 0, 'Etc/GMT+5': 300, 'Etc/GMT-14': -840, 'Pacific/Kiritimati': -840, 'Pacific/Pago_Pago': 660, 'Asia/Tokyo': -540 };
  for (const [zone, offset] of Object.entries(cases)) assert.equal(standardOffsetMinutes(zone), offset, zone);
  assert.ok(Object.is(standardOffsetMinutes('UTC'), 0) && Object.is(standardOffsetMinutes('Europe/London'), 0), 'a zero offset is +0, never -0');
  for (const zone of Object.keys(cases)) assert.ok(standardOffsetMinutes(zone) >= -840 && standardOffsetMinutes(zone) <= 840, zone + ' is inside the contract range');
});

test('standardOffsetMinutes refuses what is not a zone id and never coerces', () => {
  for (const value of ['Not/AZone', 'Europe/Nowhere', '', ' ', 'x'.repeat(129), 'Europe/Berlin\u0000', undefined, null, 5, {}, [], Symbol.for('zone')]) assert.equal(standardOffsetMinutes(value), null, String(typeof value === 'symbol' ? 'symbol' : value).slice(0, 40));
  const object = { toString() { throw new Error('coerced'); } };
  assert.equal(standardOffsetMinutes(object), null);
});

test('standardOffsetMinutes reads no clock: it uses two fixed instants', () => {
  const RealDate = globalThis.Date;
  class NoClockDate extends RealDate {
    constructor(...args) { if (args.length === 0) throw new Error('clock read'); super(...args); }
    static now() { throw new Error('clock read'); }
  }
  globalThis.Date = NoClockDate;
  try {
    assert.equal(standardOffsetMinutes('Europe/Berlin'), -60);
    assert.equal(standardOffsetMinutes('Australia/Sydney'), -600);
  } finally { globalThis.Date = RealDate; }
});

test('standardOffsetMinutes parses every offset name ICU can print: signed zero, short hours, the Unicode minus, and refuses the rest', () => {
  const RealDateTimeFormat = Intl.DateTimeFormat, names = new Map();
  // A stand-in formatter: [January name, July name] per zone, so the parser is tested without depending on this runtime's ICU.
  class FakeDateTimeFormat {
    constructor(locale, options) { this.zone = options.timeZone; if (!names.has(this.zone)) throw new RangeError('Invalid time zone specified: ' + this.zone); }
    formatToParts(date) { const value = names.get(this.zone)[date.getUTCMonth() < 3 ? 0 : 1]; return value === null ? [{ type: 'hour', value: '1' }] : [{ type: 'hour', value: '1' }, { type: 'timeZoneName', value }]; }
  }
  const cases = [['Fake/SignedZero', ['GMT+00:00', 'GMT+00:00'], 0], ['Fake/MinusZero', ['GMT-00:00', 'GMT-00:00'], 0], ['Fake/Plain', ['GMT', 'GMT'], 0],
    ['Fake/ShortPlus', ['GMT+5', 'GMT+5'], -300], ['Fake/ShortMinus', ['GMT-3', 'GMT-3'], 180], ['Fake/ShortMinutes', ['GMT+5:30', 'GMT+5:30'], -330], ['Fake/Full', ['GMT+05:45', 'GMT+05:45'], -345],
    ['Fake/UnicodeMinus', ['GMT\u22125', 'GMT\u221204'], 300], ['Fake/UnicodeMinutes', ['GMT\u221203:30', 'GMT\u221202:30'], 210],
    ['Fake/NorthernDst', ['GMT-05:00', 'GMT-04:00'], 300], ['Fake/SouthernDst', ['GMT+11:00', 'GMT+10:00'], -600], ['Fake/NegativeDst', ['GMT', 'GMT+01:00'], 0]];
  const refused = [['Fake/UtcPrefix', ['UTC+01:00', 'UTC+01:00']], ['Fake/Junk', ['GMT+1:2:3', 'GMT+1:2:3']], ['Fake/Digits', ['GMT+100', 'GMT+100']], ['Fake/Text', ['Central European Time', 'Central European Time']],
    ['Fake/OneMissing', ['GMT+01:00', null]], ['Fake/NoName', [null, null]], ['Fake/Empty', ['', '']], ['Fake/Spaces', [' GMT+01:00', 'GMT+01:00 ']]];
  Intl.DateTimeFormat = FakeDateTimeFormat;
  try {
    for (const [zone, pair] of [...cases.map(([zone, pair]) => [zone, pair]), ...refused]) names.set(zone, pair);
    for (const [zone, , offset] of cases) {
      const result = standardOffsetMinutes(zone);
      assert.equal(result, offset, zone);
      assert.ok(!Object.is(result, -0), zone + ' is never negative zero');
    }
    for (const [zone] of refused) assert.equal(standardOffsetMinutes(zone), null, zone);
    assert.equal(standardOffsetMinutes('Fake/Unknown'), null, 'a formatter that throws gives null');
  } finally { Intl.DateTimeFormat = RealDateTimeFormat; }
  assert.equal(Intl.DateTimeFormat, RealDateTimeFormat, 'the real formatter is restored');
  assert.equal(standardOffsetMinutes('Europe/Berlin'), -60);
});
