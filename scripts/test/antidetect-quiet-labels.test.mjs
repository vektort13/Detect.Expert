// ADR-113: the copy of the setting "do not run the observation sensors while Antidetect is on" exists in all 21 languages with the same keys,
// no refused characters, no markup or placeholders, no English fallback, and states the limits instead of promising anything (REQ-014).
// English and Russian are written by hand; the other 19 languages are machine-translated and still wait for native review.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANTIDETECT_QUIET_KEYS, ANTIDETECT_QUIET_LABELS, antidetectQuietLabels } from '../../apps/production-extension/antidetect-quiet-labels.js';
import { apiLabelSafe } from '../../apps/production-extension/api-configuration.js';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const EN = ANTIDETECT_QUIET_LABELS.en;

test('21 languages in product order, the same 18 keys once, frozen', () => {
  assert.deepEqual(Object.keys(ANTIDETECT_QUIET_LABELS), PRODUCTION_LANGUAGES.map(language => language.id));
  assert.equal(new Set(ANTIDETECT_QUIET_KEYS).size, ANTIDETECT_QUIET_KEYS.length); assert.equal(ANTIDETECT_QUIET_KEYS.length, 18);
  for (const [locale, table] of Object.entries(ANTIDETECT_QUIET_LABELS)) assert.deepEqual(Object.keys(table), [...ANTIDETECT_QUIET_KEYS], locale);
  assert.ok(Object.isFrozen(ANTIDETECT_QUIET_LABELS) && Object.isFrozen(EN) && Object.isFrozen(ANTIDETECT_QUIET_KEYS));
});

test('every text is a trimmed, non-empty string without control or text-direction characters, markup, placeholders or dollar patterns, and is translated', () => {
  for (const [locale, table] of Object.entries(ANTIDETECT_QUIET_LABELS)) {
    for (const key of ANTIDETECT_QUIET_KEYS) {
      const value = table[key], where = locale + '/' + key;
      assert.ok(typeof value === 'string' && value.trim(), where); assert.equal(value, value.trim(), where + ' has no outer whitespace');
      assert.ok(apiLabelSafe(value), where + ' has no control or bidi formatting characters');
      assert.doesNotMatch(value, /[<>{}$]/u, where + ' carries no markup, placeholder or dollar pattern');
      assert.ok(value.length <= 300, where + ' stays a short sentence');
      if (locale !== 'en') assert.notEqual(value, EN[key], where + ' is not the English text');
    }
  }
});

test('the toggle names what it does in every language, and the product name Antidetect is kept as written', () => {
  for (const [locale, table] of Object.entries(ANTIDETECT_QUIET_LABELS)) {
    for (const key of ['title', 'toggle', 'what', 'limit_own', 'paused_now', 'paused_ended', 'paused_setting', 'status_idle', 'status_waiting']) assert.ok(table[key].includes('Antidetect'), locale + '/' + key + ' names Antidetect');
    assert.notEqual(table.toggle, table.title, locale);
  }
});

test('the copy states the limits (REQ-014): what stays noticeable, what is not touched, that open tabs keep their state, and why a page reads paused', () => {
  assert.match(EN.limit_own, /can in principle still be noticed/); assert.match(EN.limit_own, /only the observation sensors/);
  assert.match(EN.limit_other, /Firewall module/); assert.match(EN.limit_other, /real hardware/); assert.match(EN.limit_other, /IP address/); assert.match(EN.limit_other, /TLS/);
  assert.match(EN.reload, /already open keep their current state until you reload/);
  assert.match(EN.effect, /paused/); assert.match(EN.paused_now, /enabled and Antidetect is on/); assert.match(EN.paused_ended, /Reload the page/);
  assert.match(EN.paused_calls, /requests seen by the browser may still be listed/);
  for (const text of Object.values(EN)) assert.doesNotMatch(text, /invisib|undetectab|anonym|bypass|stealth|guarant|legitimat|100 ?%/iu, text);
  const RU = ANTIDETECT_QUIET_LABELS.ru;
  assert.match(RU.limit_own, /в принципе/); assert.match(RU.reload, /не перезагрузите/); assert.match(RU.paused_calls, /могут по-прежнему попадать в списки/);
  for (const text of Object.values(RU)) assert.doesNotMatch(text, /невидим|необнаружим|анонимн|(?<!\p{L})обход|гарантир|легитимн/iu, text);
});

test('the accessor falls back like its siblings: an unknown or malformed locale reads English, a region form reads its language, an object with an id works', () => {
  assert.equal(antidetectQuietLabels('ru'), ANTIDETECT_QUIET_LABELS.ru); assert.equal(antidetectQuietLabels('de-AT'), ANTIDETECT_QUIET_LABELS.de);
  assert.equal(antidetectQuietLabels('pt_BR'), ANTIDETECT_QUIET_LABELS.pt_BR); assert.equal(antidetectQuietLabels({ id: 'ja' }), ANTIDETECT_QUIET_LABELS.ja);
  for (const bad of [undefined, null, 5, '', 'xx', {}, { id: 5 }]) assert.equal(antidetectQuietLabels(bad), EN);
  assert.equal(antidetectQuietLabels.length, 1, 'honest-copy.test.mjs finds label modules by a one-argument <name>Labels accessor');
});
