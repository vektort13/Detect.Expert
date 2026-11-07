// ADR-107 round 5: the labels of tags and notes, the trash, temporary profiles and the profile-to-proxy link exist in all 21 languages with the same
// placeholders as the English text, valid plural forms, no refused characters, and every key is used by the interface (and every use is a key).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FINGERPRINT_IDENTITY_KEYS, FINGERPRINT_IDENTITY_LABELS, FINGERPRINT_IDENTITY_PLURALS, fingerprintIdentityLabels } from '../../apps/production-extension/fingerprint-identity-labels.js';
import { fingerprintLibraryPlural } from '../../apps/production-extension/fingerprint-library-labels.js';
import { apiLabelSafe } from '../../apps/production-extension/api-configuration.js';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const placeholders = value => [...new Set([...String(value).matchAll(/\{(\w+)\}/gu)].map(match => match[1]))].sort().join(',');
const source = name => readFileSync(new URL('../../apps/production-extension/' + name, import.meta.url), 'utf8');

test('21 languages, the full key set once, in order', () => {
  assert.deepEqual(Object.keys(FINGERPRINT_IDENTITY_LABELS), PRODUCTION_LANGUAGES.map(language => language.id));
  assert.equal(new Set(FINGERPRINT_IDENTITY_KEYS).size, FINGERPRINT_IDENTITY_KEYS.length); assert.equal(FINGERPRINT_IDENTITY_KEYS.length, 82);
  for (const [locale, table] of Object.entries(FINGERPRINT_IDENTITY_LABELS)) assert.deepEqual(Object.keys(table), [...FINGERPRINT_IDENTITY_KEYS], locale);
  assert.ok(Object.isFrozen(FINGERPRINT_IDENTITY_LABELS) && Object.isFrozen(FINGERPRINT_IDENTITY_LABELS.en) && Object.isFrozen(FINGERPRINT_IDENTITY_KEYS));
});

test('every text is a non-empty string without control or text-direction characters, with the placeholders of the English text, and translated', () => {
  const english = FINGERPRINT_IDENTITY_LABELS.en;
  for (const [locale, table] of Object.entries(FINGERPRINT_IDENTITY_LABELS)) {
    let same = 0;
    for (const key of FINGERPRINT_IDENTITY_KEYS) {
      const value = table[key]; assert.ok(typeof value === 'string' && value.trim(), locale + '/' + key); assert.ok(apiLabelSafe(value), locale + '/' + key + ' has no control or bidi formatting characters');
      assert.equal(value, value.trim(), locale + '/' + key + ' has no outer whitespace');
      if (!FINGERPRINT_IDENTITY_PLURALS.includes(key)) assert.equal(placeholders(value), placeholders(english[key]), locale + '/' + key);
      if (locale !== 'en' && value === english[key]) same++;
    }
    if (locale !== 'en') assert.ok(same <= 2, locale + ': ' + same + ' strings are still the English ones');
  }
});

test('the days-left plural forms are valid CLDR forms and give a text with the number for every count the list can show (2 to 7)', () => {
  for (const [locale, table] of Object.entries(FINGERPRINT_IDENTITY_LABELS)) {
    const forms = table.trashDays.split('|'); assert.ok(forms.every(form => /^(zero|one|two|few|many|other)=./su.test(form)), locale); assert.ok(forms.some(form => form.startsWith('other=')), locale + ' has other');
    for (let count = 2; count <= 7; count++) {
      const text = fingerprintLibraryPlural(locale, table.trashDays, count), category = new Intl.PluralRules(locale.replace('_', '-')).select(count);
      assert.ok(text.trim() && !text.includes('|') && !/^\w+=/u.test(text), locale + '/' + count);
      // The Arabic "two" form says "two days" in words; every other form carries the number.
      if (!(locale === 'ar' && count === 2)) assert.ok(text.includes('{n}'), locale + '/' + count + ' carries the number');
      // A language with a plural category for this count must name it (or fall back to other on purpose): the forms listed cover what the rules select.
      assert.ok(forms.some(form => form.startsWith(category + '=')) || forms.some(form => form.startsWith('other=')), locale + '/' + count + ' category ' + category);
    }
  }
  assert.deepEqual([2, 3, 4, 5, 6, 7].map(count => fingerprintLibraryPlural('ru', FINGERPRINT_IDENTITY_LABELS.ru.trashDays, count).replace('{n}', count)), ['осталось 2 дня', 'осталось 3 дня', 'осталось 4 дня', 'осталось 5 дней', 'осталось 6 дней', 'осталось 7 дней']);
  assert.deepEqual([2, 5].map(count => fingerprintLibraryPlural('pl', FINGERPRINT_IDENTITY_LABELS.pl.trashDays, count).replace('{n}', count)), ['zostały 2 dni', 'zostało 5 dni']);
  assert.equal(fingerprintLibraryPlural('ar', FINGERPRINT_IDENTITY_LABELS.ar.trashDays, 2), 'متبقٍ يومان'); assert.equal(fingerprintLibraryPlural('en', FINGERPRINT_IDENTITY_LABELS.en.trashDays, 3).replace('{n}', 3), '3 days left');
});

test('the accessor resolves a locale variant and falls back to English', () => {
  assert.equal(fingerprintIdentityLabels('pt-BR'), FINGERPRINT_IDENTITY_LABELS.pt_BR); assert.equal(fingerprintIdentityLabels({ id: 'de' }), FINGERPRINT_IDENTITY_LABELS.de); assert.equal(fingerprintIdentityLabels('de-AT'), FINGERPRINT_IDENTITY_LABELS.de);
  assert.equal(fingerprintIdentityLabels('xx'), FINGERPRINT_IDENTITY_LABELS.en); assert.equal(fingerprintIdentityLabels(undefined), FINGERPRINT_IDENTITY_LABELS.en); assert.equal(fingerprintIdentityLabels(5), FINGERPRINT_IDENTITY_LABELS.en);
});

test('the interface uses exactly these keys: every iw.<key> exists, and no key is dead copy', () => {
  const used = new Set(), keys = new Set(FINGERPRINT_IDENTITY_KEYS);
  for (const name of ['fingerprint-library-ui.js', 'fingerprint-profile-ui.js']) {
    const code = source(name);
    for (const match of code.matchAll(/\biw\.(\w+)/gu)) { assert.ok(keys.has(match[1]), name + ' uses an unknown key iw.' + match[1]); used.add(match[1]); }
    // Keys chosen by name at run time ("iw[key]", the messages of the tag field and the bundle states) appear as quoted literals.
    for (const key of keys) if (code.includes("'" + key + "'")) used.add(key);
  }
  assert.deepEqual([...keys].filter(key => !used.has(key)), [], 'keys nothing uses (remove the copy, or use it)');
});

test('the honest wording: the trash says seven days and not exported, the link says it stays on this computer, nothing promises invisibility, anonymity or a guarantee', () => {
  const banned = /invisib|undetectab|anonym|bypass|stealth|guarant|legitimat|невидим|необнаружим|анонимн|обход|гарантир|легитимн/iu;
  for (const [locale, table] of Object.entries(FINGERPRINT_IDENTITY_LABELS)) for (const key of FINGERPRINT_IDENTITY_KEYS) assert.doesNotMatch(table[key], banned, locale + '/' + key);
  const en = FINGERPRINT_IDENTITY_LABELS.en;
  assert.match(en.trashNote, /7 days/u); assert.match(en.trashNote, /not exported/u); assert.match(en.trashKept, /7 days/u); assert.match(en.bundleLocal, /not exported/u); assert.match(en.noteHint, /export/u);
  assert.match(en.tempBanner, /restart the browser/u); assert.match(en.bundleApplyHint, /explicit/u);
  for (const [locale, table] of Object.entries(FINGERPRINT_IDENTITY_LABELS)) for (const key of ['trashNote', 'trashKept']) assert.ok(table[key].includes('7'), locale + '/' + key + ' names the seven days');
});
