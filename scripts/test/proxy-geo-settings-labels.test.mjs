// ADR-109: the texts of the Proxy Manager Geolocation API settings page. English and Russian are complete now; the other 19 languages are
// a later translation pass (pure data), so they fall back to English key by key. This test enforces ru/en today, enforces any table that
// appears for another language as soon as it appears, and prints which languages still wait.
import assert from 'node:assert/strict';
import test from 'node:test';
import { GEO_ERRORS } from '../../apps/production-extension/proxy-geo-shared.js';
import {
  PROXY_GEO_SETTINGS_LOCALES, PROXY_GEO_SETTINGS_MESSAGES, proxyGeoFill, proxyGeoSettingsLabels, proxyGeoSettingsLocale,
} from '../../apps/production-extension/proxy-geo-settings-labels.js';
import { LANGUAGES } from '../../apps/production-extension/precursor-settings-locales.js';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const EN = PROXY_GEO_SETTINGS_MESSAGES.en, RU = PROXY_GEO_SETTINGS_MESSAGES.ru;
// Every production language has its own complete table (the 19 translations are plain data in proxy-geo-settings-i18n.js).
const ENFORCED = Object.freeze(PRODUCTION_LANGUAGES.map(language => language.id));
// Invisible, bidi and control characters never belong in a label: built from code points, so this source holds none of them.
const FORBIDDEN = [[0, 31], [127, 159], [0x061c, 0x061c], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff]];
const forbidden = text => [...text].filter(char => FORBIDDEN.some(([from, to]) => char.codePointAt(0) >= from && char.codePointAt(0) <= to));
const placeholders = text => [...text.matchAll(/\{([A-Za-z]+)\}/g)].map(match => match[1]).sort();
// The placeholders each template takes (the page fills exactly these); every other label has none.
const PLACEHOLDERS = Object.freeze({
  state_ready: ['list'], test_help: ['ip'], status_ok: ['time'], status_error: ['error'], status_remaining: ['n'], status_paused: ['time'], docs_aria: ['name'],
  test_ok: ['ip', 'summary'], test_ok_empty: ['ip'], clear_cache: ['n'], clear_cache_armed: ['n'],
});

const complete = (language, table) => {
  assert.deepEqual(Object.keys(table).sort(), Object.keys(EN).sort(), language + ': the same keys as English');
  for (const [key, value] of Object.entries(table)) {
    assert.equal(typeof value, 'string', language + '/' + key); assert.ok(value.trim().length > 0, language + '/' + key + ' is not empty');
    assert.equal(value, value.trim(), language + '/' + key + ' has no outer spaces'); assert.deepEqual(forbidden(value), [], language + '/' + key + ' has no invisible or control character');
    assert.doesNotMatch(value, /\$/, language + '/' + key + ' has no dollar pattern'); assert.doesNotMatch(value, /[<>]/, language + '/' + key + ' has no markup');
    assert.deepEqual(placeholders(value), PLACEHOLDERS[key] ?? [], language + '/' + key + ': placeholders');
    assert.doesNotMatch(value.replace(/\{[A-Za-z]+\}/g, ''), /[{}]/, language + '/' + key + ' has no stray brace');
  }
};

test('English and Russian are complete, with the same keys and the same placeholders; no invisible character, markup or dollar pattern', () => {
  complete('en', EN); complete('ru', RU);
  assert.ok(Object.keys(EN).length > 90);
  assert.equal(EN.title, 'Proxy Manager Geolocation API'); assert.equal(RU.title, EN.title, 'the proper name is the same in every language');
  assert.notEqual(RU.master_title, EN.master_title); assert.ok(/[а-яё]/i.test(RU.subtitle));
  assert.ok(Object.isFrozen(PROXY_GEO_SETTINGS_MESSAGES) && Object.isFrozen(EN) && Object.isFrozen(RU));
});

test('the 21 production languages: every one has its own complete table with the English keys and placeholders', t => {
  const waiting = [];
  for (const { id } of PRODUCTION_LANGUAGES) {
    const labels = proxyGeoSettingsLabels(id), own = Object.hasOwn(PROXY_GEO_SETTINGS_MESSAGES, id);
    if (ENFORCED.includes(id)) assert.ok(own, id + ' must have its own table');
    if (own) complete(id, { ...PROXY_GEO_SETTINGS_MESSAGES[id] });
    else waiting.push(id);
    assert.deepEqual(Object.keys(labels).sort(), Object.keys(EN).sort(), id + ': nothing renders as a raw key');
    for (const [key, value] of Object.entries(labels)) assert.ok(value.length > 0, id + '/' + key);
    if (!own) assert.equal(labels, EN, id + ' has no table yet: the English labels, as one object');
  }
  assert.deepEqual(PRODUCTION_LANGUAGES.map(language => language.id).filter(id => !waiting.includes(id)).sort(), Object.keys(PROXY_GEO_SETTINGS_MESSAGES).sort());
  t.diagnostic('languages still waiting for a translation of ' + Object.keys(EN).length + ' labels (' + waiting.length + '): ' + waiting.join(', '));
  console.log('# proxy-geo-settings-labels: waiting for translation (' + waiting.length + '): ' + waiting.join(', '));
});

test('the accessor takes one parameter, falls back silently and merges a partial table over English', () => {
  assert.equal(proxyGeoSettingsLabels.length, 1, 'the honest-copy test finds label accessors by name and by exactly one parameter');
  for (const odd of [undefined, null, 5, {}, '', 'zz', 'xx-YY']) assert.equal(proxyGeoSettingsLabels(odd), EN);
  assert.equal(proxyGeoSettingsLabels('ru-RU'), proxyGeoSettingsLabels('ru')); assert.equal(proxyGeoSettingsLabels('ru').master_title, RU.master_title);
  assert.equal(proxyGeoSettingsLabels('en-GB'), EN);
  assert.equal(proxyGeoSettingsLabels('tlh'), EN, 'a language without a table is English');
  assert.ok(Object.isFrozen(proxyGeoSettingsLabels('ru')));
  assert.equal(proxyGeoSettingsLabels('ru'), proxyGeoSettingsLabels('ru'), 'cached: the cache holds at most one entry per language');
});

test('the locale chooser agrees with the precursor page and the production language list', () => {
  assert.deepEqual([...PROXY_GEO_SETTINGS_LOCALES].sort(), PRODUCTION_LANGUAGES.map(language => language.id).sort());
  assert.deepEqual([...PROXY_GEO_SETTINGS_LOCALES].sort(), LANGUAGES.map(language => language.id).sort(), 'the page offers the languages the labels know');
  for (const id of PROXY_GEO_SETTINGS_LOCALES) assert.equal(proxyGeoSettingsLocale(id), id);
  const cases = { 'zh-TW': 'zh_CN', 'zh-Hans': 'zh_CN', cmn: 'zh_CN', 'pt-PT': 'pt_BR', pt: 'pt_BR', 'de-AT': 'de', 'ru-RU': 'ru', 'EN-us': 'en', 'ar-EG': 'ar', 'yue-Hant': 'yue', zz: 'en', '': 'en', 5: 'en' };
  for (const [input, expected] of Object.entries(cases)) assert.equal(proxyGeoSettingsLocale(isNaN(input) ? input : Number(input)), expected, String(input));
  for (const odd of [undefined, null, {}, [], Symbol.iterator.description]) assert.equal(proxyGeoSettingsLocale(odd), 'en');
});

test('every error code of the module has its own sentence, in both languages, and the unknown code has one too', () => {
  for (const [language, table] of [['en', EN], ['ru', RU]]) {
    const sentences = GEO_ERRORS.map(code => table['error_' + code.replaceAll('-', '_')]);
    assert.ok(sentences.every(sentence => typeof sentence === 'string' && sentence.length > 10), language + ': a sentence for each of ' + GEO_ERRORS.length + ' codes');
    assert.equal(new Set([...sentences, table.error_unknown]).size, GEO_ERRORS.length + 1, language + ': all different');
  }
  assert.equal(GEO_ERRORS.length, 15);
});

test('placeholders are filled by code, never by a replacement pattern, and an unknown one stays visible', () => {
  assert.equal(proxyGeoFill('a {n} b {x}', { n: 3 }), 'a 3 b {x}');
  assert.equal(proxyGeoFill('{list}', { list: '$& $1 $$ $` $\'' }), '$& $1 $$ $` $\'', 'a value is never read as a pattern');
  assert.equal(proxyGeoFill('{n}', { n: '{n}' }), '{n}'); assert.equal(proxyGeoFill('x {toString}', {}), 'x {toString}', 'only own properties');
  assert.equal(proxyGeoFill('plain', null), 'plain'); assert.equal(proxyGeoFill(undefined, {}), ''); assert.equal(proxyGeoFill(5, {}), '');
  assert.equal(proxyGeoFill(EN.clear_cache, { n: 12 }), 'Clear cached results (12)'); assert.equal(proxyGeoFill(RU.state_ready, { list: 'MaxMind GeoIP / GeoLite' }), 'Включено — готов: MaxMind GeoIP / GeoLite');
});

test('copy rules: provider facts say "per the documentation", the remember text is plain, nothing promises or rates', () => {
  for (const [language, table, documentation] of [['en', EN, /Per the provider’s documentation\.$/], ['ru', RU, /По документации провайдера\.$/]]) {
    for (const id of ['maxmind', 'ipgeolocation', 'ipdata', 'ipapi']) assert.match(table['fact_' + id], documentation, language + '/fact_' + id);
    assert.match(table.fact_ipgeolocation, language === 'en' ? /1,000 credits/ : /1 000 кредитов/); assert.match(table.fact_ipapi, /45/);
    assert.match(table.option_remember_help, language === 'en' ? /unencrypted/ : /без шифрования/);
    assert.match(table.option_remember_help, language === 'en' ? /never go into exports, reports, logs or sync/ : /никогда не попадают в экспорт, отчёты, журналы и синхронизацию/);
    assert.match(table.sent_never, language === 'en' ? /no proxy host or port, no proxy login or password/ : /ни адреса и порта прокси, ни логина и пароля прокси/);
    assert.match(table.sent_learn, language === 'en' ? /may learn/ : /может со временем узнать/);
    assert.match(table.sent_claim, language === 'en' ? /approximate/ : /приблизительны/);
  }
  const promises = [/\binvisib/i, /\bundetectab/i, /\banonym/i, /\bbypass/i, /\bstealth/i, /(?<![\d.,])100\s?%/, /\bguarant/i, /\blegitimat/i, /\b(?:safe|safety|dangerous|trusted|malicious|reliable|accurate|best)\b/i,
    /(?<!\p{L})невидим/iu, /(?<!\p{L})необнаружим/iu, /(?<!\p{L})анонимн/iu, /(?<!\p{L})обход/iu, /(?<!\p{L})гарантир/iu, /(?<!\p{L})легитимн/iu, /(?<!\p{L})(?:опасн|вредонос|доверенн|надёжн|точн|лучш)/iu];
  for (const [language, table] of [['en', EN], ['ru', RU]]) for (const [key, value] of Object.entries(table)) for (const pattern of promises) assert.doesNotMatch(value, pattern, language + '/' + key);
});
