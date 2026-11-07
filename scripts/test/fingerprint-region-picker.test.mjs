// ADR-104 addendum 4: offline country names, search and coordinate text of the Region picker.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { regionPicker, regionName, searchRegions, formatCoordinates, regionCity, languageTag } from '../../apps/production-extension/fingerprint-region-names.js';
import { regionCodes, regionByCode } from '../../apps/production-extension/fingerprint-region-data.js';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

// Collation tags exactly as the module chains them (Wu has no CLDR data, Cantonese borrows Hong Kong).
const CHAIN = { wuu: ['wuu', 'zh-CN'], yue: ['yue', 'zh-HK'] };
const codesOf = list => list.map(entry => entry.code);

test('every product language lists every region once, with a name in its own language, sorted by its own collation', () => {
  const all = regionCodes();
  assert.equal(PRODUCTION_LANGUAGES.length, 21);
  for (const { id } of PRODUCTION_LANGUAGES) {
    const picker = regionPicker(id), tag = languageTag(id);
    assert.deepEqual([...codesOf(picker.list)].sort(), [...all].sort(), id + ': all regions, none twice');
    assert.equal(picker.byCode.size, all.length);
    for (const entry of picker.list) { assert.ok(entry.name.trim(), id + '/' + entry.code + ' has a name'); assert.equal(entry.english, regionByCode(entry.code).nameEn); }
    const collator = new Intl.Collator(CHAIN[tag] ?? tag);
    for (let index = 1; index < picker.list.length; index++) assert.ok(collator.compare(picker.list[index - 1].name, picker.list[index].name) <= 0, id + ': sorted at ' + picker.list[index].code);
    if (id !== 'en') assert.notEqual(picker.byCode.get('DE').name, 'Germany', id + ': Germany is named in the UI language, not in English');
    assert.equal(regionPicker(id), picker, id + ': one cached list per language');
    assert.ok(Object.isFrozen(picker.list) && Object.isFrozen(picker.list[0]));
  }
});

test('names come from Intl.DisplayNames in the UI language and fall back to the English name of the region data', () => {
  for (const [id, expected] of [['en', 'Germany'], ['ru', 'Германия'], ['zh_CN', '德国'], ['pt_BR', 'Alemanha'], ['ar', 'ألمانيا'], ['ja', 'ドイツ'], ['hi', 'जर्मनी'], ['de', 'Deutschland']]) assert.equal(regionName(id, 'DE'), expected, id);
  assert.equal(regionName({ id: 'pt_BR' }, 'DE'), 'Alemanha', 'a locale object works like its id');
  assert.equal(regionName('wuu', 'DE'), '德国', 'Wu has no CLDR names: the Simplified Chinese ones are used');
  assert.equal(regionName('yue', 'DE'), '德國', 'Cantonese uses its own traditional names');
  // A language without any name data shows the English names and still lists everything.
  const unknown = regionPicker('xx');
  assert.equal(unknown.byCode.size, regionCodes().length);
  for (const entry of unknown.list) assert.equal(entry.name, entry.english, entry.code);
  assert.equal(regionName('en', 'ZZ'), null); assert.equal(regionName('en', undefined), null);
});

test('search matches the localized name, the English name and the code; the exact code is first; accents and case do not matter', () => {
  const ru = regionPicker('ru').list, en = regionPicker('en').list;
  assert.equal(searchRegions(ru, ''), ru, 'an empty query keeps the whole sorted list');
  assert.equal(searchRegions(ru, '   '), ru);
  assert.equal(searchRegions(ru, 'герм')[0].code, 'DE', 'localized prefix');
  assert.equal(searchRegions(ru, 'ГЕРМАНИЯ')[0].code, 'DE', 'case');
  assert.ok(codesOf(searchRegions(ru, 'germany')).includes('DE'), 'English name in a Russian UI');
  assert.equal(searchRegions(ru, 'jap')[0].code, 'JP', 'English prefix');
  assert.equal(searchRegions(ru, 'de')[0].code, 'DE', 'exact code beats every name containing "de"');
  assert.equal(searchRegions(ru, 'Jp')[0].code, 'JP');
  assert.equal(searchRegions(ru, 'японы'.slice(0, 4))[0].code, 'JP');
  assert.deepEqual(codesOf(searchRegions(en, 'cote')).slice(0, 1), ['CI'], 'a missing accent still finds Côte d’Ivoire');
  assert.deepEqual(codesOf(searchRegions(en, "d'ivoire")), ['CI'], 'an ASCII apostrophe matches the typographic one');
  assert.ok(codesOf(searchRegions(en, 'curacao')).includes('CW'));
  assert.equal(searchRegions(regionPicker('hi').list, 'जर्मनी')[0].code, 'DE', 'Devanagari vowel signs are not stripped');
  assert.equal(searchRegions(regionPicker('ar').list, 'ألمانيا')[0].code, 'DE');
  assert.equal(searchRegions(regionPicker('ja').list, 'ドイツ')[0].code, 'DE');
  // Names that start with the query come before names that only contain it.
  const ranks = codesOf(searchRegions(en, 'in'));
  assert.ok(ranks.indexOf('IN') === 0 && ranks.indexOf('ID') !== -1);
  assert.deepEqual(searchRegions(en, 'zzzzz'), []);
});

test('search is bounded and never throws on hostile input', () => {
  const en = regionPicker('en').list;
  assert.deepEqual(searchRegions(en, 'a'.repeat(100000)), []);
  assert.doesNotThrow(() => searchRegions(en, undefined)); assert.doesNotThrow(() => searchRegions(en, null)); assert.doesNotThrow(() => searchRegions(en, { toString() { return 'de'; } }));
  assert.equal(searchRegions(en, '\u0000')[0] ?? null, null);
  // A query longer than the bound is cut, so a long tail after a real name cannot change what the first 64 characters select.
  assert.equal(searchRegions(en, 'germany' + ' '.repeat(70) + 'x')[0].code, 'DE');
});

test('coordinates are written with two decimals and never with a negative zero', () => {
  assert.equal(formatCoordinates(52.5, 13.366667), '52.50, 13.37');
  assert.equal(formatCoordinates(-33.8688, 151.2093), '-33.87, 151.21');
  assert.equal(formatCoordinates(-0.001, 0.004), '0.00, 0.00');
  assert.equal(formatCoordinates(0, -0), '0.00, 0.00');
  assert.equal(formatCoordinates(90, -180), '90.00, -180.00');
  assert.equal(formatCoordinates(35.6895, 139.6917), '35.69, 139.69');
});

test('the city is the one the coordinates name; without coordinates it is the zone\'s city; coordinates elsewhere name none', () => {
  const berlin = regionByCode('DE').zones.find(zone => zone.iana === 'Europe/Berlin');
  assert.equal(regionCity('DE', { latitude: berlin.lat, longitude: berlin.lon, accuracy: 25 }, null), 'Berlin');
  assert.equal(regionCity('DE', { latitude: berlin.lat, longitude: berlin.lon, accuracy: 25 }, 'Europe/Busingen'), 'Berlin', 'the coordinates win over the zone');
  assert.equal(regionCity('DE', { latitude: berlin.lat + 0.001, longitude: berlin.lon - 0.001, accuracy: 25 }, null), 'Berlin', 'equal to the shown precision');
  assert.equal(regionCity('DE', null, 'Europe/Berlin'), 'Berlin');
  assert.equal(regionCity('DE', null, 'Europe/Busingen'), 'Busingen');
  assert.equal(regionCity('DE', { latitude: 0, longitude: 0, accuracy: 25 }, 'Europe/Berlin'), null, 'the zone city is not shown beside other coordinates');
  assert.equal(regionCity('DE', { latitude: 0, longitude: 0, accuracy: 25 }, null), null);
  assert.equal(regionCity('DE', null, null), null);
  assert.equal(regionCity('ZZ', null, 'Europe/Berlin'), null);
  assert.equal(regionCity(null, null, null), null);
});

test('the picker is offline: it imports only the bundled region data and the zone table and calls no network API', () => {
  const source = readFileSync(new URL('../../apps/production-extension/fingerprint-region-names.js', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/^import .* from '([^']+)';$/gmu)].map(match => match[1]).sort(), ['./fingerprint-region-data.js', './fingerprint-timezone-data.js']);
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|import\s*\(|chrome\.|browser\./u);
});
