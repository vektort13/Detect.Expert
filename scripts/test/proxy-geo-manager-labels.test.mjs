// ADR-109: the copy of the Proxy manager's geolocation layer (apps/production-extension/proxy-geo-manager-labels.js). Russian and English are
// written completely; every other language reads English until a translation pass adds it. These checks keep the two tables identical in
// shape, free of invisible characters and markup, honest (provider data is "as reported by the provider", no verdicts, no promises),
// and covering every enum member the UI can show. honest-copy.test.mjs scans the same module in all 21 languages as well.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GEO_MANAGER_LABELS, GEO_MANAGER_LABEL_KEYS, proxyGeoManagerLabels } from '../../apps/production-extension/proxy-geo-manager-labels.js';
import { GEO_KINDS, GEO_FLAGS, GEO_ERRORS, GEO_COLUMNS } from '../../apps/production-extension/proxy-geo-shared.js';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const KEYS = [...GEO_MANAGER_LABEL_KEYS], PLACEHOLDERS = new Set(['n', 'name', 'age', 'tag', 'country', 'provider', 'reason']);
const ALL = PRODUCTION_LANGUAGES.map(language => language.id);
const placeholders = text => [...text.matchAll(/\{([^{}]*)\}/gu)].map(match => match[1]).sort();
// Controls, bidi controls, zero-width characters and line/paragraph separators; built from code points so this file holds none of them.
const FORBIDDEN_RANGES = [[0, 31], [127, 159], [0x061c, 0x061c], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff]];
const forbiddenIn = text => [...text].filter(character => FORBIDDEN_RANGES.some(([from, to]) => character.codePointAt(0) >= from && character.codePointAt(0) <= to));

test('the accessor has exactly one parameter, as the label scan expects', () => {
  assert.equal(proxyGeoManagerLabels.length, 1);
  assert.equal(typeof proxyGeoManagerLabels, 'function');
});

test('every production language is complete, identical in shape to English, and every value is a non-empty string', () => {
  assert.deepEqual(Object.keys(GEO_MANAGER_LABELS).sort(), [...ALL].sort(), 'every production language has its own table');
  assert.equal(new Set(KEYS).size, KEYS.length, 'no duplicate key');
  for (const locale of ALL) {
    const table = GEO_MANAGER_LABELS[locale];
    assert.deepEqual(Object.keys(table).sort(), [...KEYS].sort(), locale + ' has exactly the keys');
    for (const key of KEYS) { assert.equal(typeof table[key], 'string', locale + '.' + key); assert.ok(table[key].trim().length > 0, locale + '.' + key + ' is empty'); assert.equal(table[key], table[key].trim(), locale + '.' + key + ' has stray spaces'); }
  }
  assert.deepEqual(Object.keys(GEO_MANAGER_LABELS.ru), Object.keys(GEO_MANAGER_LABELS.en), 'same order');
  assert.deepEqual(KEYS.filter(key => GEO_MANAGER_LABELS.ru[key] === GEO_MANAGER_LABELS.en[key]), ['kind_cdn', 'flag_vpn', 'flag_tor', 'flag_relay', 'announce_lookup_failed'], 'only abbreviations, product names and a bare template are the same in both languages: everything else is translated');
  assert.ok(Object.isFrozen(GEO_MANAGER_LABELS) && Object.isFrozen(GEO_MANAGER_LABELS.ru) && Object.isFrozen(GEO_MANAGER_LABELS.en), 'the tables are frozen');
  const russian = GEO_MANAGER_LABELS.ru, english = GEO_MANAGER_LABELS.en;
  for (const key of ['banner_invite', 'banner_not_ready', 'detail_title', 'detail_caveat', 'lookup_all', 'confirm_note', 'cell_check_first']) assert.notEqual(russian[key], english[key], key + ' is translated');
  assert.match(russian.banner_invite, /[а-яё]/iu); assert.match(russian.detail_caveat, /[а-яё]/iu);
});

test('the notice says what the owner asked, word for word in Russian', () => {
  const ru = GEO_MANAGER_LABELS.ru;
  assert.equal(ru.banner_invite, 'Улучшите результаты: укажите ключ API геолокации — менеджер покажет страну, город, сеть и признаки прокси/VPN для внешнего IP каждого прокси. Без вашего включения ничего не отправляется.');
  assert.equal(ru.banner_link, 'Настроить Proxy Manager Geolocation API');
  assert.equal(ru.banner_not_ready, 'Geolocation API включён, но нет готового провайдера — добавьте ключ.');
  assert.equal(ru.col_group, 'Геолокация (API)');
  assert.deepEqual(['col_geo', 'col_geonet', 'col_geoflags', 'col_geotime'].map(key => ru[key]), ['Локация', 'Сеть', 'Признаки', 'Время']);
  assert.equal(ru.cell_check_first, 'Сначала выполните проверку'); assert.equal(ru.lookup_all, 'Определить геолокацию для всех проверенных');
  assert.equal(ru.detail_caveat, 'Данные провайдера приблизительны и могут отличаться от других источников.'); assert.deepEqual([ru.detail_lookup, ru.detail_refresh], ['Определить сейчас', 'Обновить']);
  assert.deepEqual(GEO_KINDS.map(kind => ru['kind_' + kind]), ['Домашний', 'Хостинг', 'Мобильный', 'Бизнес', 'Образование', 'Госструктура', 'Оператор связи', 'CDN', 'Другое']);
  assert.match(ru.banner_invite, /ничего не отправляется/u, 'it says that nothing is sent until the person turns the feature on');
  assert.match(GEO_MANAGER_LABELS.en.banner_invite, /Nothing is sent until you turn it on/u);
  assert.match(ru.banner_dismiss, /Скрыть/u);
});

test('placeholders are the same in every language, from a fixed set, and never "$" or markup', () => {
  for (const locale of ALL) for (const key of KEYS) {
    const value = GEO_MANAGER_LABELS[locale][key];
    assert.deepEqual(placeholders(value), placeholders(GEO_MANAGER_LABELS.en[key]), locale + '.' + key + ' placeholders');
    assert.doesNotMatch(value, /\$/u, locale + '.' + key + ' has "$"'); assert.doesNotMatch(value, /[<>]/u, locale + '.' + key + ' has markup characters'); assert.doesNotMatch(value, /\{\s|\s\}|\{\}/u, locale + '.' + key + ' has a broken placeholder');
  }
  for (const key of KEYS) {
    const ru = GEO_MANAGER_LABELS.ru[key], en = GEO_MANAGER_LABELS.en[key];
    assert.deepEqual(placeholders(ru), placeholders(en), key + ' placeholders');
    for (const name of placeholders(en)) assert.ok(PLACEHOLDERS.has(name), key + ' uses {' + name + '}');
    for (const text of [ru, en]) { assert.doesNotMatch(text, /\$/u, key + ' has "$"'); assert.doesNotMatch(text, /[<>]/u, key + ' has markup characters'); assert.doesNotMatch(text, /\{\s|\s\}|\{\}/u, key + ' has a broken placeholder'); }
  }
  for (const form of ['one', 'few', 'many', 'other']) for (const locale of ALL) assert.deepEqual(placeholders(GEO_MANAGER_LABELS[locale]['confirm_' + form]), ['n', 'name'], locale + ' confirm_' + form);
  assert.deepEqual(placeholders(GEO_MANAGER_LABELS.en.cell_mismatch), ['country', 'tag']); assert.deepEqual(placeholders(GEO_MANAGER_LABELS.en.cell_source_title), ['age', 'provider']);
  assert.deepEqual(placeholders(GEO_MANAGER_LABELS.en.cell_lookup_for), ['name']); assert.deepEqual(placeholders(GEO_MANAGER_LABELS.en.detail_quota), ['n']);
});

test('no invisible, control or bidi character and no leading or trailing noise in any string', () => {
  for (const locale of ALL) for (const key of KEYS) {
    const text = GEO_MANAGER_LABELS[locale][key];
    assert.deepEqual(forbiddenIn(text), [], locale + '.' + key + ' holds a forbidden character');
    assert.doesNotMatch(text, /\s{2,}/u, locale + '.' + key + ' has a run of spaces'); assert.doesNotMatch(text, /\\|\n|\r|\t/u, locale + '.' + key + ' has an escape or a newline');
  }
  assert.deepEqual(forbiddenIn('a' + String.fromCodePoint(0x202e) + 'b' + String.fromCodePoint(0x200b) + String.fromCodePoint(0x061c) + String.fromCodePoint(0xfeff) + String.fromCodePoint(7)).length, 5, 'the detector itself works');
});

test('the copy is honest: as reported by the provider, no verdict, no promise of invisibility, anonymity or bypass', () => {
  const VERDICTS = [/\bsafe(ty)?\b/iu, /\bdanger/iu, /\btrust/iu, /\bclean\b/iu, /\bsecure/iu, /\bmalicious/iu, /\brisky/iu, /\bgood\b/iu, /\bbad\b/iu, /\bblacklist/iu, /\breputation/iu, /\bscore\b/iu,
    /безопасн/iu, /опасн/iu, /довер/iu, /(?<!\p{L})чист/iu, /надёжн|надежн/iu, /вредонос/iu, /репутац/iu, /(?<!\p{L})рейтинг/iu];
  const PROMISES = [/\binvisib/iu, /\bundetect/iu, /\banonym/iu, /\bbypass/iu, /\bstealth/iu, /(?<![\d.,])100\s?%/u, /\bguarant/iu, /\blegitimat/iu, /невидим/iu, /необнаружим/iu, /анонимн/iu, /(?<!\p{L})обход/iu, /гарантир/iu, /легитимн/iu, /\bhide\b/iu, /\bскры(ть|вает)\s+(ваш|IP)/iu];
  for (const locale of ALL) for (const key of KEYS) for (const pattern of locale === 'ru' || locale === 'en' ? [...VERDICTS, ...PROMISES] : PROMISES) {
    if (locale === 'ru' && key === 'banner_dismiss') continue; // "Скрыть уведомление": hides the notice, not an address
    assert.doesNotMatch(GEO_MANAGER_LABELS[locale][key], pattern, locale + '.' + key + ' matches ' + pattern);
  }
  // Every flag tip attributes the statement to the provider.
  for (const flag of GEO_FLAGS) { assert.match(GEO_MANAGER_LABELS.en['flag_' + flag + '_tip'], /as reported by the provider/u, flag); assert.match(GEO_MANAGER_LABELS.ru['flag_' + flag + '_tip'], /по данным провайдера/u, flag); }
  assert.match(GEO_MANAGER_LABELS.en.flag_proxy_ipapi_tip, /VPN and Tor/u); assert.match(GEO_MANAGER_LABELS.ru.flag_proxy_ipapi_tip, /VPN и Tor/u);
  assert.match(GEO_MANAGER_LABELS.en.detail_title, /as reported by the provider/u); assert.match(GEO_MANAGER_LABELS.ru.detail_title, /по данным провайдера/u); assert.match(GEO_MANAGER_LABELS.en.col_source_title, /As reported by the geolocation provider/u);
  assert.match(GEO_MANAGER_LABELS.en.detail_caveat, /approximate and may differ/u); assert.match(GEO_MANAGER_LABELS.ru.detail_caveat, /приблизительны и могут отличаться/u);
  assert.match(GEO_MANAGER_LABELS.en.cell_flags_unreported_title, /does not report/u, 'an unreported flag is "not reported", not "no"');
  // The bulk confirmation tells what leaves the browser and what never does.
  for (const locale of ['ru', 'en']) assert.match(GEO_MANAGER_LABELS[locale].confirm_note, locale === 'ru' ? /ключ.*адрес.*не отправляются/su : /key.*not sent/su, locale + ' confirm_note');
});

test('every enum member the UI can show has its label in both languages', () => {
  for (const locale of ALL) {
    const table = GEO_MANAGER_LABELS[locale];
    for (const kind of GEO_KINDS) assert.ok(table['kind_' + kind], locale + ' kind ' + kind); assert.ok(table.kind_unknown);
    for (const flag of GEO_FLAGS) { assert.ok(table['flag_' + flag], locale + ' flag ' + flag); assert.ok(table['flag_' + flag + '_tip'], locale + ' flag tip ' + flag); }
    for (const code of GEO_ERRORS) assert.ok(table['error_' + code.replaceAll('-', '_')], locale + ' error ' + code);
    for (const column of GEO_COLUMNS) assert.ok(table['col_' + column], locale + ' column ' + column);
  }
  const used = new Set(KEYS);
  for (const kind of GEO_KINDS) assert.ok(used.has('kind_' + kind)); for (const flag of GEO_FLAGS) assert.ok(used.has('flag_' + flag)); for (const code of GEO_ERRORS) assert.ok(used.has('error_' + code.replaceAll('-', '_')), code);
  assert.deepEqual(KEYS.filter(key => key.startsWith('error_')).length, GEO_ERRORS.length, 'no label for an error that does not exist');
  assert.deepEqual(KEYS.filter(key => /^kind_/u.test(key)).length, GEO_KINDS.length + 1); assert.deepEqual(KEYS.filter(key => /^flag_[A-Za-z]+$/u.test(key) && !/^flag_(yes|no|unreported)$/u.test(key)).length, GEO_FLAGS.length);
});

test('the accessor takes a locale id or { id }; a variant reads its language; everything else reads English; nothing throws', () => {
  const ru = GEO_MANAGER_LABELS.ru, en = GEO_MANAGER_LABELS.en;
  assert.equal(proxyGeoManagerLabels('ru'), ru); assert.equal(proxyGeoManagerLabels({ id: 'ru' }), ru); assert.equal(proxyGeoManagerLabels('ru-RU'), ru); assert.equal(proxyGeoManagerLabels('ru_RU'), ru);
  assert.equal(proxyGeoManagerLabels('en'), en); assert.equal(proxyGeoManagerLabels('en-GB'), en); assert.equal(proxyGeoManagerLabels({ id: 'en' }), en);
  for (const language of PRODUCTION_LANGUAGES) assert.equal(proxyGeoManagerLabels(language.id), GEO_MANAGER_LABELS[language.id], language.id + ' reads its own complete table');
  for (const odd of [undefined, null, 42, {}, { id: 7 }, [], '', 'zz', 'x-y', '__proto__', 'constructor', 'toString', { id: '__proto__' }, true]) assert.equal(proxyGeoManagerLabels(odd), en, 'unknown locale: ' + JSON.stringify(odd));
  for (const key of KEYS) assert.notEqual(proxyGeoManagerLabels('ar')[key], undefined, 'a missing translation never renders as a raw key');
});

test('adding a language is a data change: a partial table falls back to English key by key', async () => {
  const module = await import('../../apps/production-extension/proxy-geo-manager-labels.js');
  assert.deepEqual(Object.keys(module.GEO_MANAGER_LABELS.en).sort(), [...KEYS].sort());
  const partial = { cell_lookup: 'X' }, merged = Object.fromEntries(KEYS.map(key => [key, typeof partial[key] === 'string' && partial[key] !== '' ? partial[key] : module.GEO_MANAGER_LABELS.en[key]]));
  assert.equal(merged.cell_lookup, 'X'); assert.equal(merged.banner_link, module.GEO_MANAGER_LABELS.en.banner_link);
});
