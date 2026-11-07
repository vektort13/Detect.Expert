// ADR-069: pure Unix-seconds <-> date/time conversion of the cookie editor. Zone rules are injected, so the tests do not depend on the machine's time zone.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_UNIX_SECONDS, dateTimeToUnixSeconds, formatOffset, intlTag, localOffsetMinutes, offsetLabel, parseUnixSeconds, readableDateTime, relativeTime, unixSecondsToDateTime } from '../../apps/production-extension/cookie-time.js';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const utc = text => Date.parse(text.replace(' ', 'T') + 'Z') / 1000;
// A zone is a list of [UTC instant in ms, offset in minutes east of UTC] steps; the first step is the offset before every other one.
const zone = steps => ms => { let offset = steps[0][1]; for (const [from, minutes] of steps) if (ms >= from) offset = minutes; return offset; };
const fixed = minutes => zone([[-Infinity, minutes]]);
// New York 2026: clocks go 02:00 -> 03:00 on 2026-03-08 and 02:00 -> 01:00 on 2026-11-01.
const newYork = zone([[-Infinity, -300], [Date.UTC(2026, 2, 8, 7), -240], [Date.UTC(2026, 10, 1, 6), -300]]);
// Sydney 2026 (southern hemisphere): clocks go 03:00 -> 02:00 on 2026-04-05 and 02:00 -> 03:00 on 2026-10-04.
const sydney = zone([[-Infinity, 660], [Date.UTC(2026, 3, 4, 16), 600], [Date.UTC(2026, 9, 3, 16), 660]]);

test('Unix seconds parse as strict positive decimals; every refusal has a code', () => {
  const chrome = parseUnixSeconds('1797166957.97721');
  assert.deepEqual({ ok: chrome.ok, whole: chrome.whole, fraction: chrome.fraction, text: chrome.text, seconds: chrome.seconds }, { ok: true, whole: 1797166957, fraction: '97721', text: '1797166957.97721', seconds: 1797166957.97721 });
  assert.equal(parseUnixSeconds('  42  ').text, '42'); assert.equal(parseUnixSeconds('0001797166957').text, '1797166957', 'leading zeros are dropped'); assert.equal(parseUnixSeconds('0.5').seconds, 0.5);
  assert.equal(parseUnixSeconds('1.123456789').fraction, '123456789'); assert.equal(parseUnixSeconds(String(MAX_UNIX_SECONDS)).ok, true);
  for (const empty of ['', ' ', '\t\n']) assert.deepEqual(parseUnixSeconds(empty), { ok: false, code: 'empty' }, JSON.stringify(empty));
  for (const bad of ['abc', 'NaN', 'Infinity', '1e9', '0x10', '1,5', '1.', '.5', '--1', '+5', '1 2', '1_000', '1.1234567890', '１２３']) assert.deepEqual(parseUnixSeconds(bad), { ok: false, code: 'format' }, bad);
  for (const bad of [null, undefined, 5, {}, []]) assert.equal(parseUnixSeconds(bad).code, 'format');
  for (const range of ['-1', '-0', '-1.5', '0', '0.0', '0.000000000', String(MAX_UNIX_SECONDS + 1), '8640000000000.1', '10000000000000', '99999999999999999999']) assert.deepEqual(parseUnixSeconds(range), { ok: false, code: 'range' }, range);
});

test('Unix seconds become a date and time with the explicit offset of the zone at that instant', () => {
  assert.equal(new Date(1797166957 * 1000).toISOString(), '2026-12-13T13:02:37.000Z', 'the expected value is independent of the code under test');
  assert.deepEqual(unixSecondsToDateTime('1797166957.97721', { zone: 'utc' }), { ok: true, text: '2026-12-13 13:02:37.97721Z', offsetMinutes: 0 });
  assert.equal(unixSecondsToDateTime('1797166957.97721', { offsetMinutesAt: fixed(180) }).text, '2026-12-13 16:02:37.97721+03:00');
  assert.equal(unixSecondsToDateTime('1797166957', { offsetMinutesAt: fixed(-330) }).text, '2026-12-13 07:32:37-05:30');
  assert.equal(unixSecondsToDateTime('1797166957', { offsetMinutesAt: fixed(345) }).text, '2026-12-13 18:47:37+05:45');
  assert.equal(unixSecondsToDateTime('0.5', { zone: 'utc' }).text, '1970-01-01 00:00:00.5Z');
  assert.equal(unixSecondsToDateTime('1', { zone: 'utc' }).text, '1970-01-01 00:00:01Z');
  // The offset belongs to the instant: the same zone shows -05:00 in winter and -04:00 in summer.
  assert.equal(unixSecondsToDateTime(String(utc('2026-01-15 12:00:00')), { offsetMinutesAt: newYork }).text, '2026-01-15 07:00:00-05:00');
  assert.equal(unixSecondsToDateTime(String(utc('2026-07-15 12:00:00')), { offsetMinutesAt: newYork }).text, '2026-07-15 08:00:00-04:00');
  assert.equal(unixSecondsToDateTime(String(MAX_UNIX_SECONDS), { zone: 'utc' }).text, '275760-09-13 00:00:00Z');
  assert.deepEqual(unixSecondsToDateTime(String(MAX_UNIX_SECONDS), { offsetMinutesAt: fixed(840) }), { ok: false, code: 'range' }, 'the shifted wall clock would pass the last Date');
  for (const [text, code] of [['', 'empty'], ['x', 'format'], ['-5', 'range'], ['0', 'range'], [String(MAX_UNIX_SECONDS + 1), 'range']]) assert.deepEqual(unixSecondsToDateTime(text, { zone: 'utc' }), { ok: false, code }, text);
  assert.deepEqual(unixSecondsToDateTime('5', { offsetMinutesAt: () => NaN }), { ok: false, code: 'range' });
  assert.deepEqual(unixSecondsToDateTime('5', { offsetMinutesAt: () => 24 * 60 }), { ok: false, code: 'range' });
});

test('a date and time becomes Unix seconds: UTC, explicit offsets and the chosen zone', () => {
  const expected = utc('2026-12-13 12:02:37');
  for (const [text, options] of [['2026-12-13 12:02:37Z', {}], ['2026-12-13T12:02:37Z', {}], ['2026-12-13t12:02:37z', {}], ['2026-12-13 15:02:37+03:00', {}], ['2026-12-13 15:02:37 +03:00', {}], ['2026-12-13 15:02:37+0300', {}], ['2026-12-13 15:02:37+03', {}],
    ['2026-12-13 06:32:37-05:30', {}], ['2026-12-13 12:02:37', { zone: 'utc' }], ['2026-12-13 15:02:37', { offsetMinutesAt: fixed(180) }], ['  2026-12-13 12:02:37Z  ', {}], ['2026-12-13 15:02:37+03:00', { zone: 'utc' }]]) {
    assert.deepEqual(dateTimeToUnixSeconds(text, options), { ok: true, whole: expected, fraction: '', text: String(expected), seconds: expected }, text);
  }
  assert.equal(dateTimeToUnixSeconds('2026-12-13 12:02Z').text, String(expected - 37), 'seconds are optional');
  assert.equal(dateTimeToUnixSeconds('2026-12-13 12:02:37.97721Z').text, expected + '.97721'); assert.equal(dateTimeToUnixSeconds('2026-12-13 12:02:37.977210Z').text, expected + '.977210', 'fraction digits travel verbatim');
  assert.equal(dateTimeToUnixSeconds('2026-12-13 12:02:37.123456789Z').fraction, '123456789'); assert.equal(dateTimeToUnixSeconds('2026-12-13 12:02:37.5Z').seconds, expected + 0.5);
  assert.equal(dateTimeToUnixSeconds('1970-01-01 00:00:00.5Z').text, '0.5'); assert.equal(dateTimeToUnixSeconds('1970-01-01 00:00:01Z').text, '1');
  assert.equal(dateTimeToUnixSeconds('275760-09-13 00:00:00Z').text, String(MAX_UNIX_SECONDS)); assert.equal(dateTimeToUnixSeconds('2028-02-29 12:00:00Z').ok, true, '2028 is a leap year');
});

test('invalid or out-of-range text is refused with a code and never guessed', () => {
  for (const empty of ['', '   ']) assert.deepEqual(dateTimeToUnixSeconds(empty, { zone: 'utc' }), { ok: false, code: 'empty' });
  for (const bad of ['foo', '2026-12-13', '12/13/2026 10:00', '2026-12-13 10', '2026-12-13  10:00:00Z', '2026-12-13 10:00:00.Z', '2026-12-13 10:00:00,5Z', '2026-12-13 10:00:00.1234567890Z', '26-12-13 10:00:00Z', '2026-1-3 10:00:00Z',
    '2026-13-01 00:00:00Z', '2026-00-10 00:00:00Z', '2026-12-00 00:00:00Z', '2026-02-29 00:00:00Z', '2026-04-31 00:00:00Z', '2026-12-13 24:00:00Z', '2026-12-13 12:60:00Z', '2026-12-13 12:00:60Z',
    '2026-12-13 12:00:00+24:00', '2026-12-13 12:00:00+03:60', '2026-12-13 12:00:00 UTC', '2026-12-13 12:00:00Z+03:00', 'NaN-01-01 00:00:00Z']) assert.deepEqual(dateTimeToUnixSeconds(bad, { zone: 'utc' }), { ok: false, code: 'format' }, bad);
  for (const bad of [null, undefined, 1, {}]) assert.equal(dateTimeToUnixSeconds(bad).code, 'format');
  // Date.UTC reads the years 0..99 as 1900..1999: "0070-01-02" must not turn into 1970-01-02.
  for (const range of ['1969-12-31 23:59:59Z', '1960-01-01 00:00:00Z', '0001-01-01 00:00:00Z', '0070-01-02 00:00:00Z', '0099-12-31 23:59:59Z', '1970-01-01 00:00:00Z', '1970-01-01 00:00:00.000Z', '1970-01-01 03:00:00+03:00', '1970-01-01 00:00:00+03:00', '275760-09-13 00:00:00.1Z', '275760-09-14 00:00:00Z', '275761-01-01 00:00:00Z', '999999-12-31 23:59:59Z'])
    assert.deepEqual(dateTimeToUnixSeconds(range, { zone: 'utc' }), { ok: false, code: 'range' }, range);
  assert.deepEqual(dateTimeToUnixSeconds('2026-12-13 12:00:00', { offsetMinutesAt: () => NaN }), { ok: false, code: 'gap' }, 'a zone that answers nothing finds no instant');
});

test('a local time that does not exist (clock forward) or occurs twice (clock back) is refused; an offset or UTC resolves it', () => {
  for (const [name, rules, gap, repeated, ordinary] of [['New York', newYork, '2026-03-08 02:30:00', '2026-11-01 01:30:00', ['2026-03-08 01:59:59', '2026-03-08 03:00:00', '2026-11-01 00:59:59', '2026-11-01 02:00:00', '2026-07-01 12:00:00']],
    ['Sydney', sydney, '2026-10-04 02:30:00', '2026-04-05 02:30:00', ['2026-10-04 01:59:59', '2026-10-04 03:00:00', '2026-04-05 01:59:59', '2026-04-05 03:00:00', '2026-07-01 12:00:00']]]) {
    assert.deepEqual(dateTimeToUnixSeconds(gap, { offsetMinutesAt: rules }), { ok: false, code: 'gap' }, name + ' gap'); assert.deepEqual(dateTimeToUnixSeconds(repeated, { offsetMinutesAt: rules }), { ok: false, code: 'ambiguous' }, name + ' overlap');
    for (const text of [gap, repeated]) {
      assert.equal(dateTimeToUnixSeconds(text, { zone: 'utc', offsetMinutesAt: rules }).ok, true, name + ' UTC needs no zone rules');
      assert.equal(dateTimeToUnixSeconds(text + (rules === newYork ? '-04:00' : '+10:00'), { offsetMinutesAt: rules }).ok, true, name + ' an explicit offset is never ambiguous');
    }
    for (const text of ordinary) {
      const found = dateTimeToUnixSeconds(text, { offsetMinutesAt: rules });
      assert.equal(found.ok, true, name + ' ' + text);
      // Converting back shows the same wall clock with the offset the zone really had.
      assert.equal(unixSecondsToDateTime(found.text, { offsetMinutesAt: rules }).text.slice(0, 19), text, name + ' ' + text);
    }
  }
  // The two readings of the repeated hour differ by exactly the clock change.
  assert.equal(dateTimeToUnixSeconds('2026-11-01 01:30:00-04:00').seconds - dateTimeToUnixSeconds('2026-11-01 01:30:00-05:00').seconds, -3600);
});

test('fractional seconds round-trip without drifting, in UTC, in other zones and in the real local zone of this machine', () => {
  // Chrome reports values like this one; the text must come back digit for digit, and the number bit for bit.
  const chrome = '1797166957.97721';
  for (const options of [{ zone: 'utc' }, { offsetMinutesAt: fixed(180) }, { offsetMinutesAt: fixed(-330) }, { offsetMinutesAt: newYork }, { offsetMinutesAt: sydney }, {}]) {
    const shown = unixSecondsToDateTime(chrome, options), back = dateTimeToUnixSeconds(shown.text, options);
    assert.equal(back.text, chrome, JSON.stringify(shown)); assert.equal(Object.is(back.seconds, 1797166957.97721), true);
  }
  let state = 12345; const next = limit => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state % limit; };
  for (let index = 0; index < 600; index++) {
    const whole = 1 + next(4102444800), digits = next(10), fraction = digits === 0 ? '' : Array.from({ length: digits }, () => next(10)).join(''), text = whole + (fraction ? '.' + fraction : '');
    const options = [{ zone: 'utc' }, { offsetMinutesAt: newYork }, { offsetMinutesAt: sydney }, { offsetMinutesAt: fixed(next(1700) - 720) }][index % 4];
    const shown = unixSecondsToDateTime(text, options); assert.equal(shown.ok, true, text);
    const back = dateTimeToUnixSeconds(shown.text, options); assert.equal(back.text, text, text + ' -> ' + shown.text); assert.equal(back.seconds, Number(text));
  }
  // Starting from the date side: the digits survive, trailing zeros included.
  for (const text of ['2026-12-13 15:02:37.977210+03:00', '2026-12-13 12:02:37.000001Z', '2026-12-13 12:02:37.123456789Z', '2038-01-19 03:14:07Z', '2100-12-31 23:59:59.999999999Z']) {
    const unix = dateTimeToUnixSeconds(text), again = unixSecondsToDateTime(unix.text, text.endsWith('Z') ? { zone: 'utc' } : { offsetMinutesAt: fixed(180) });
    assert.equal(again.text, text);
  }
});

test('offsets and labels', () => {
  assert.deepEqual([0, 180, -330, 345, -570, 840, -720].map(formatOffset), ['+00:00', '+03:00', '-05:30', '+05:45', '-09:30', '+14:00', '-12:00']);
  assert.equal(offsetLabel(-570), 'UTC-09:30'); assert.equal(offsetLabel(0), 'UTC+00:00');
  for (const ms of [0, Date.UTC(2026, 0, 1), Date.UTC(2026, 6, 1)]) assert.equal(localOffsetMinutes(ms), -new Date(ms).getTimezoneOffset());
});

test('every interface language maps to a working Intl tag; Wu reads as Simplified Chinese', () => {
  assert.equal(intlTag('pt_BR'), 'pt-BR'); assert.equal(intlTag('zh_CN'), 'zh-CN'); assert.equal(intlTag('wuu'), 'zh-Hans'); assert.equal(intlTag('en'), 'en'); assert.equal(intlTag(undefined), 'en'); assert.equal(intlTag(''), 'en'); assert.equal(intlTag('qq'), 'en');
  assert.equal(intlTag('de', { DateTimeFormat: { supportedLocalesOf() { throw Error('no Intl'); } } }), 'en');
  for (const language of PRODUCTION_LANGUAGES) {
    const tag = intlTag(language.id);
    assert.ok(Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0, language.id + ' -> ' + tag);
    assert.ok(readableDateTime(1797166957, language.id)?.length > 5, language.id); assert.ok(relativeTime(3 * 86400, language.id).length > 0, language.id);
  }
});

test('relative time rounds toward zero and picks one readable unit', () => {
  const cases = [[45.9, 'in 45 seconds'], [0.4, 'now'], [-0.4, 'now'], [60, 'in 1 minute'], [3599, 'in 59 minutes'], [3 * 3600 + 5, 'in 3 hours'], [3 * 86400 + 100, 'in 3 days'], [-2 * 86400, '2 days ago'], [59 * 86400, 'in 59 days'],
    [60 * 86400, 'in 1 month'], [400 * 86400, 'in 13 months'], [729 * 86400, 'in 23 months'], [731 * 86400, 'in 2 years'], [-800 * 86400, '2 years ago'], [-45, '45 seconds ago']];
  for (const [delta, expected] of cases) assert.equal(relativeTime(delta, 'en'), expected, String(delta));
  assert.equal(relativeTime(NaN, 'en'), ''); assert.equal(relativeTime(Infinity, 'en'), ''); assert.equal(relativeTime(5, 'en', {}), '');
  assert.match(readableDateTime(1797166957, 'en'), /2026/); assert.equal(readableDateTime(NaN, 'en'), null); assert.equal(readableDateTime(1e20, 'en'), null); assert.equal(readableDateTime(5, 'en', {}), null);
});
