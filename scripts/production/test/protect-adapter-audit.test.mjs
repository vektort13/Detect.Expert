// ADR-050: moving code into an adapter must not make a second collector value reader pass the source gate.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditProtectSource } from '../build-protect.mjs';

for (const name of ['env', 'classify']) test('adapter ' + name + ' retains collector value-read prohibition', () => {
  const file = 'apps/production-protect/src/patches/packages/collector/src/protect/' + name + '.ts';
  for (const source of ['const secret = input.value;', 'Reflect.get(input, "value");', 'const { value } = input;']) {
    assert.ok(auditProtectSource(source, file).some(v => v.startsWith('field-value-read:')), source);
  }
});
test('only the known reader permits value; credential attributes and API ownership remain checked', () => {
  const file = 'apps/production-protect/src/patches/packages/collector/src/protect/field-value.ts';
  assert.deepEqual(auditProtectSource('const text = input.value;', file), []);
  assert.ok(auditProtectSource('input.getAttribute("value");', file).length > 0);
  assert.ok(auditProtectSource('indexedDB.open("leak");', file).some(v => v.startsWith('api-owner:')));
  assert.ok(auditProtectSource('indexedDB.open("leak");', 'apps/production-protect/src/patches/value-match/decode.ts').length > 0);
});
