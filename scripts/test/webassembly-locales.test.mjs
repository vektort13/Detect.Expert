// ADR-059: the subgroup is a technical name; its disclosure controls use all production locales.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { applyWebAssemblyCopy, WEBASSEMBLY_UI_KEYS, WEBASSEMBLY_UI_MESSAGES } from '../production-locales-webassembly.mjs';

test('WebAssembly controls cover exactly 21 languages, preserve unrelated copy and repeat deterministically', () => {
  assert.deepEqual(Object.keys(WEBASSEMBLY_UI_MESSAGES).sort(), PRODUCTION_LANGUAGES.map(row => row.id).sort());
  for (const { id } of PRODUCTION_LANGUAGES) {
    const unrelated = { message: 'Untouched', placeholders: { value: { content: '$1' } } }, table = { unrelated };
    assert.equal(applyWebAssemblyCopy(table, id), table); assert.equal(table.unrelated, unrelated);
    assert.equal(table.protection_group_webassembly.message, 'WebAssembly');
    for (const key of WEBASSEMBLY_UI_KEYS) {
      assert.equal(table[key].message, WEBASSEMBLY_UI_MESSAGES[id][key]);
      assert.ok(table[key].message.trim()); assert.doesNotMatch(table[key].message, /\uFFFD|undefined|TODO|\$[A-Z]/);
      if (id !== 'en' && key !== 'protection_group_webassembly') assert.notEqual(table[key].message, WEBASSEMBLY_UI_MESSAGES.en[key]);
    }
    const previous = JSON.stringify(table); applyWebAssemblyCopy(table, id); assert.equal(JSON.stringify(table), previous);
  }
});

test('WebAssembly locale application rejects unknown language or invalid table before mutation', () => {
  const table = { unrelated: { message: 'Untouched' } }, before = structuredClone(table);
  assert.throws(() => applyWebAssemblyCopy(table, 'missing'), /unknown locale/); assert.deepEqual(table, before);
  assert.throws(() => applyWebAssemblyCopy(null, 'en'), /message table/);
  assert.throws(() => applyWebAssemblyCopy([], 'en'), /message table/);
});
