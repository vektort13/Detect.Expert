import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyAdvancedCopy, ADVANCED_KEYS } from '../production-locales-advanced.mjs';
import { ADVANCED_COPY } from '../production-advanced-copy.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

for (const language of PRODUCTION_LANGUAGES) test('advanced live/Pro/print copy complete: ' + language.id, () => {
  const table = {}; applyAdvancedCopy(table, language.id);
  assert.deepEqual(Object.keys(table), ADVANCED_KEYS);
  for (const key of ADVANCED_KEYS) {
    const message = table[key].message;
    assert.equal(typeof message, 'string'); assert.ok(message.trim()); assert.doesNotMatch(message, /\uFFFD|\$\{|undefined|TODO|<script/i);
    const baselinePlaceholders = [...ADVANCED_COPY[key][0].matchAll(/\$([A-Z]+)\$/g)].map(match => match[1]);
    const actualPlaceholders = [...message.matchAll(/\$([A-Z]+)\$/g)].map(match => match[1]);
    assert.deepEqual(actualPlaceholders, baselinePlaceholders);
    if (baselinePlaceholders.length) assert.deepEqual(table[key].placeholders, { count: { content: '$1' } });
    else assert.equal(table[key].placeholders, undefined);
  }
});
test('advanced static presentation keys all have shared locale entries', () => {
  const source = readFileSync(new URL('../../apps/production-extension/advanced-ui.js', import.meta.url), 'utf8');
  const literals = new Set([...source.matchAll(/['"]((?:advanced_|beacon_|background_|cookie_probe_)[a-zA-Z0-9_]+)['"]/g)].map(match => match[1]));
  for (const key of literals) if (!key.endsWith('_')) assert.ok(Object.hasOwn(ADVANCED_COPY, key), 'missing key ' + key);
  assert.ok(ADVANCED_KEYS.includes('background_state_activated')); assert.ok(ADVANCED_KEYS.includes('beacon_event_purchase')); assert.ok(ADVANCED_KEYS.includes('cookie_probe_reason_access_changed'));
});
test('advanced overlay refuses unknown locales without English fallback', () => {
  assert.throws(() => applyAdvancedCopy({}, 'unsupported'), /unknown locale/);
  assert.throws(() => applyAdvancedCopy([], 'en'), /message table/);
});
test('advanced presentation reuses only existing localized base keys', () => {
  const source = readFileSync(new URL('../../apps/production-extension/advanced-ui.js', import.meta.url), 'utf8');
  const literals = new Set([...source.matchAll(/(?:text|fact)\(['"]([a-zA-Z0-9_]+)['"]/g)].map(match => match[1]).filter(key => !key.endsWith('_')));
  for (const language of PRODUCTION_LANGUAGES) {
    const table = JSON.parse(readFileSync(new URL(`../../apps/production-extension/${language.uiOnly ? 'ui-locales' : '_locales'}/${language.id}/messages.json`, import.meta.url), 'utf8')); applyAdvancedCopy(table, language.id);
    for (const key of literals) assert.ok(Object.hasOwn(table, key), 'Missing ' + language.id + '/' + key);
  }
});
