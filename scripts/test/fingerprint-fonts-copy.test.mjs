// ADR-110: the Fonts option copy (hint and the uncovered line) in all 21 languages. English and Russian are written by hand; the other 19 are
// machine translations that no native speaker has reviewed (docs/decisions/ADR-110-font-css-shield.md). The test fixes what every language must say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FINGERPRINT_DEVICE_LABELS, fingerprintDeviceLabels } from '../../apps/production-extension/fingerprint-device-labels.js';

const LANGUAGES = ['en', 'ru', 'zh_CN', 'vi', 'es', 'ar', 'uk', 'fr', 'pt_BR', 'hi', 'ur', 'ja', 'de', 'pl', 'id', 'mr', 'te', 'ko', 'ta', 'yue', 'wuu'];
const FORBIDDEN = /[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/u;

test('all 21 languages carry both strings, trimmed, bounded and without control or bidi characters', () => {
  assert.deepEqual(Object.keys(FINGERPRINT_DEVICE_LABELS).sort(), [...LANGUAGES].sort());
  for (const language of LANGUAGES) {
    const words = FINGERPRINT_DEVICE_LABELS[language];
    for (const key of ['fonts_hint', 'uncovered_fonts_metrics']) {
      const text = words[key];
      assert.equal(typeof text, 'string', language + '.' + key); assert.equal(text, text.trim()); assert.ok(!FORBIDDEN.test(text), language + '.' + key + ' has no control or bidi character');
      assert.ok(text.length >= 60 && text.length <= 720, language + '.' + key + ' length ' + text.length);
    }
  }
});

test('every language names the same technical facts: what is limited, what the page sees, and the gaps', () => {
  for (const language of LANGUAGES) {
    const { fonts_hint: hint, uncovered_fonts_metrics: gaps } = FINGERPRINT_DEVICE_LABELS[language];
    for (const token of ['Windows', 'HTML/CSS', 'SVG', 'Canvas', 'FontFace local()', 'document.fonts']) assert.ok(hint.includes(token), language + ' hint names ' + token);
    for (const token of ['Canvas', '@font-face local()', 'Workers']) assert.ok(gaps.includes(token), language + ' uncovered line names ' + token);
    assert.ok(!gaps.includes('FontFace local()') || gaps.includes('@font-face local()'));
  }
});

test('the two strings differ from each other and, outside English, from the English text; no two languages share a string', () => {
  const english = FINGERPRINT_DEVICE_LABELS.en;
  const seen = new Set();
  for (const language of LANGUAGES) {
    const { fonts_hint: hint, uncovered_fonts_metrics: gaps } = FINGERPRINT_DEVICE_LABELS[language];
    assert.notEqual(hint, gaps);
    if (language !== 'en') { assert.notEqual(hint, english.fonts_hint, language + ' hint is translated'); assert.notEqual(gaps, english.uncovered_fonts_metrics, language + ' uncovered line is translated'); }
    for (const text of [hint, gaps]) { assert.ok(!seen.has(text), language + ' repeats another language'); seen.add(text); }
  }
});

test('English and Russian keep the promises of ADR-110: a fallback font is possible, the hidden families are visible, nothing is promised beyond the list', () => {
  const en = fingerprintDeviceLabels('en'), ru = fingerprintDeviceLabels('ru');
  assert.match(en.fonts_hint, /next one in its list, so it may look different/u); assert.match(en.fonts_hint, /hidden families show up in document\.fonts/u); assert.match(en.fonts_hint, /built-in list/u);
  assert.match(en.uncovered_fonts_metrics, /^Not covered: font names outside the built-in list \(except on Canvas\)/u); assert.match(en.uncovered_fonts_metrics, /exact font metrics/u);
  assert.match(ru.fonts_hint, /получает следующий из своего списка, поэтому вид может отличаться/u); assert.match(ru.fonts_hint, /скрытые семейства видны в document\.fonts/u);
  assert.match(ru.uncovered_fonts_metrics, /^Не покрыто: имена шрифтов вне встроенного списка \(кроме Canvas\)/u); assert.match(ru.uncovered_fonts_metrics, /точные метрики шрифтов/u);
  // The old statement that HTML/CSS probing is untouched is gone from every language.
  assert.ok(!/is not changed|не меняется|unchanged/iu.test(en.fonts_hint + ru.fonts_hint));
  assert.ok(!/invisib|невидим|100 ?%/iu.test(en.fonts_hint + en.uncovered_fonts_metrics + ru.fonts_hint + ru.uncovered_fonts_metrics), 'no promise of invisibility or full coverage');
});

// ADR-110 addendum (2026-11-07): the switch of the font list noise. English and Russian by hand, the other 19 languages machine translations without native review.
test('the font list noise switch: label and hint in all 21 languages, trimmed, bounded, without control or bidi characters', () => {
  for (const language of LANGUAGES) {
    const words = FINGERPRINT_DEVICE_LABELS[language];
    for (const [key, min, max] of [['font_noise_label', 6, 60], ['font_noise_hint', 100, 480]]) {
      const text = words[key];
      assert.equal(typeof text, 'string', language + '.' + key); assert.equal(text, text.trim()); assert.ok(!FORBIDDEN.test(text), language + '.' + key + ' has no control or bidi character');
      assert.ok(text.length >= min && text.length <= max, language + '.' + key + ' length ' + text.length);
    }
  }
});

test('every language says the same facts about the noise: Strict only, about 3 %, the profile\'s random value, the list stays visible and editable, no promise', () => {
  for (const language of LANGUAGES) {
    const { font_noise_hint: hint, font_noise_label: label, preset_strict: strict } = FINGERPRINT_DEVICE_LABELS[language];
    assert.ok(hint.includes('Windows') && hint.includes('API') && /3 ?%/u.test(hint), language + ': names Windows, the API editor and the share');
    assert.ok(hint.includes(strict), language + ': names the Strict preset as the product calls it (' + strict + ')');
    assert.notEqual(hint, label);
  }
  const en = FINGERPRINT_DEVICE_LABELS.en, ru = FINGERPRINT_DEVICE_LABELS.ru;
  assert.equal(en.font_noise_label, 'Font list noise'); assert.equal(ru.font_noise_label, 'Шум списка шрифтов');
  assert.match(en.font_noise_hint, /^Strict preset only\./u); assert.match(en.font_noise_hint, /left out of the list, chosen by the profile's random seed, so lists of different profiles differ/u);
  assert.match(en.font_noise_hint, /does not make the list more genuine and promises nothing/u); assert.match(en.font_noise_hint, /visible and editable in the Fonts row of the API editor/u);
  assert.match(ru.font_noise_hint, /^Только в пресете «Строгий»\./u); assert.match(ru.font_noise_hint, /списки разных профилей различаются/u);
  assert.match(ru.font_noise_hint, /не становится «более настоящим» и ничего не обещает/u); assert.match(ru.font_noise_hint, /виден и редактируется в строке «Шрифты» редактора API/u);
  assert.ok(!/invisib|undetect|100 ?%|guarant|legitimate|real machine|anonym|невидим|необнаружим|гарантир|легитимн|анонимн/iu.test(en.font_noise_hint + en.font_noise_label + ru.font_noise_hint + ru.font_noise_label), 'no promise of invisibility, safety or full coverage');
});

test('the strings are distinct: outside English every language is translated, and no two languages share a string', () => {
  const english = FINGERPRINT_DEVICE_LABELS.en, seen = new Set();
  for (const language of LANGUAGES) {
    for (const key of ['font_noise_label', 'font_noise_hint']) {
      const text = FINGERPRINT_DEVICE_LABELS[language][key];
      if (language !== 'en') assert.notEqual(text, english[key], language + '.' + key + ' is translated');
      assert.ok(!seen.has(text), language + '.' + key + ' repeats another language'); seen.add(text);
    }
  }
});

// The row is no longer the Canvas font policy alone: it covers the DOM, SVG and CSS text as well (ADR-110), so its label is the plain word for fonts.
test('the row of the font policy is called Fonts in every language, with the word the product already uses for fonts', () => {
  const tables = {};
  for (const language of LANGUAGES) {
    const folder = language === 'yue' || language === 'wuu' ? 'ui-locales' : '_locales';
    tables[language] = JSON.parse(readFileSync(new URL('../../apps/production-extension/' + folder + '/' + language + '/messages.json', import.meta.url), 'utf8'));
  }
  assert.equal(tables.en.protection_feature_canvas_font_policy.message, 'Fonts'); assert.equal(tables.ru.protection_feature_canvas_font_policy.message, 'Шрифты');
  const seen = new Map();
  for (const language of LANGUAGES) {
    const label = tables[language].protection_feature_canvas_font_policy.message, group = tables[language].inspector_group_fonts.message;
    assert.ok(label.trim() && label === label.trim() && !FORBIDDEN.test(label), language);
    assert.ok(!/canvas/iu.test(label), language + ': the row is not named after Canvas any more (' + label + ')');
    // The inspector's heading for fonts, except two documented spellings: Telugu without the zero-width non-joiner (the form of the Antidetect panel), Cantonese 字型 (as in the same panel).
    const expected = { te: 'ఫాంట్లు', yue: '字型' }[language] ?? group;
    assert.equal(label, expected, language);
    assert.ok(FINGERPRINT_DEVICE_LABELS[language].fonts_label.toLowerCase().includes(label.toLowerCase()), language + ': the Antidetect panel says the same word (' + FINGERPRINT_DEVICE_LABELS[language].fonts_label + ')');
    seen.set(language, label);
  }
  assert.equal(new Set(seen.values()).size, 20, '21 languages, 20 spellings: only Mandarin (zh_CN) and Shanghainese (wuu) share one');
  // The other rows keep their names and the row is not confused with the local fonts permission.
  for (const language of LANGUAGES) assert.notEqual(tables[language].protection_feature_canvas_font_policy.message, tables[language].protection_feature_local_fonts.message, language);
});
