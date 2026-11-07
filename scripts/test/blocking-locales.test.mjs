import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBlockingCopy, BLOCKING_KEYS, REMOVED_BLOCKING_KEYS } from '../production-locales-blocking.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const english = applyBlockingCopy({}, 'en');
for (const language of PRODUCTION_LANGUAGES) test('blocking page complete localized copy and removed labels: ' + language.id, () => {
  const preservedPermission = { message: 'Unrelated cookie permission', placeholders: { count: { content: '$1' } } };
  const table = {
    cookie_allow_access: preservedPermission,
    protection_missing: { message: 'Obsolete installation notice' },
    protection_allow: { message: 'Obsolete rule label' },
    protection_high_risk: { message: 'Obsolete risk notice' },
  };
  assert.equal(applyBlockingCopy(table, language.id), table);
  assert.equal(table.cookie_allow_access, preservedPermission);
  for (const key of REMOVED_BLOCKING_KEYS) assert.equal(Object.hasOwn(table, key), false);
  for (const key of BLOCKING_KEYS) {
    assert.equal(typeof table[key].message, 'string');
    assert.ok(table[key].message.trim(), language.id + '/' + key);
    assert.doesNotMatch(table[key].message, /\uFFFD|\$\{|undefined|TODO|<script/);
    if (key === 'protection_title' || key === 'protection_master') assert.equal(table[key].message, 'API Guard');
    else if (language.id !== 'en') assert.notEqual(table[key].message, english[key].message, 'English fallback: ' + language.id + '/' + key);
    assert.equal(table[key].placeholders, undefined);
  }
  const first = JSON.stringify(table);
  applyBlockingCopy(table, language.id);
  assert.equal(JSON.stringify(table), first, 'Overlay must be repeatable');
});

test('blocking copy refuses unavailable languages without modifying the table', () => {
  const table = { protection_missing: { message: 'Existing text' } };
  assert.throws(() => applyBlockingCopy(table, 'unsupported'), /unknown locale/);
  assert.deepEqual(table, { protection_missing: { message: 'Existing text' } });
  assert.throws(() => applyBlockingCopy([], 'en'), /message table/);
  assert.throws(() => applyBlockingCopy(null, 'en'), /message table/);
});
