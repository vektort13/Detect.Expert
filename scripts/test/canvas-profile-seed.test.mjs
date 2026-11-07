// ADR-066 / ADR-106: stored profile Canvas settings stay dormant; only an applied global/site value needs the private profile key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration, exportApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { customEntries } from '../../apps/production-extension/api-configuration-controller.js';
import { buildApiCustomScripts } from '../../apps/production-extension/api-custom-registration.js';
import { snapshotFingerprintProfile, storeFingerprintProfile, editFingerprintRow } from '../../apps/production-extension/fingerprint-profiles.js';
const active = { id: 'canvas-readback', mode: 'custom', selected: { kind: 'value', value: { algorithm: 'stable-rgb-v1' } } };
test('stored profile Canvas settings are dormant; only applying a global/site value needs a seed', () => {
  const base = createApiConfiguration(), changed = editFingerprintRow(base, active.id, { mode: active.mode, selected: active.selected });
  const saved = storeFingerprintProfile(base, snapshotFingerprintProfile(changed, 'Stored', 'fp-' + 'ab'.repeat(16))); saved.enabled = true;
  assert.deepEqual(customEntries(saved, null), []); assert.deepEqual(buildApiCustomScripts(saved, ['https://*/*']), []);
  changed.antidetectEnabled = true; assert.throws(() => buildApiCustomScripts(changed, ['https://*/*']), /persisted profile seed/);
  const scripts = buildApiCustomScripts(changed, ['https://*/*'], { canvasSeed: 'ab'.repeat(32) }); assert.equal(scripts.length, 1);
  assert.match(scripts[0].js[0].code, /installCanvasCustom/); assert.ok(!exportApiConfiguration(saved).includes('canvasSeed'));
});

// Catalog V8 (ADR-104 addendum 3) added sparse-rgb-v1; catalog 11 (ADR-112) adds sparse-rgb-v2 as the first preset. Every algorithm stays a valid
// saved value, and the registered document-start source carries the chosen algorithm and the private seed to the installer, which then
// produces the oracle pixels.
import { API_CONFIGURATION_CATALOG_VERSION, validateApiValue } from '../../apps/production-extension/api-configuration.js';
import { canvasRealm, makeImage, sameBytes, sessionKey, sparseExpected, sparseExpectedV2 } from './canvas-sparse-kit.mjs';
const seed64 = 'ab'.repeat(32);
function registered(algorithm) {
  const changed = editFingerprintRow(createApiConfiguration(), 'canvas-readback', { mode: 'custom', selected: { kind: 'value', value: { algorithm } } });
  changed.antidetectEnabled = true;
  const code = buildApiCustomScripts(changed, ['https://*/*'], { canvasSeed: seed64 })[0].js[0].code;
  return { code, entry: JSON.parse(/const packed = (\[.*\]);\n/.exec(code)[1]).find(row => row.id === 'canvas-readback'), changed };
}
test('catalog 11: sparse-rgb-v2 is preset 1, sparse-rgb-v1 and stable-rgb-v1 stay valid, anything else is rejected', () => {
  assert.ok(API_CONFIGURATION_CATALOG_VERSION >= 11);
  const row = createApiConfiguration().apis.find(item => item.id === 'canvas-readback');
  assert.deepEqual(row.presets.map(preset => preset.value.value.algorithm), ['sparse-rgb-v2', 'sparse-rgb-v1', 'stable-rgb-v1']);
  const accepts = value => validateApiValue('canvas-readback', { kind: 'value', value }).ok;
  assert.equal(accepts({ algorithm: 'sparse-rgb-v2' }), true); assert.equal(accepts({ algorithm: 'sparse-rgb-v1' }), true); assert.equal(accepts({ algorithm: 'stable-rgb-v1' }), true);
  for (const value of [{ algorithm: 'sparse-rgb-v3' }, { algorithm: 'Sparse-RGB-v2' }, { algorithm: 'Sparse-RGB-v1' }, { algorithm: 'sparse-rgb-v1', density: 5 }, {}, { algorithm: 7 }]) assert.equal(accepts(value), false, JSON.stringify(value));
});
test('registration: the chosen algorithm and the private seed reach the installer, which produces the oracle pixels (no seed in the exported JSON)', () => {
  for (const algorithm of ['sparse-rgb-v2', 'sparse-rgb-v1', 'stable-rgb-v1']) {
    const { code, entry, changed } = registered(algorithm);
    assert.equal(entry.selected.value.algorithm, algorithm); assert.equal(entry.canvasSeed, seed64); assert.match(code, /installCanvasCustom/);
    assert.ok(!exportApiConfiguration(changed).includes(seed64), 'the portable JSON never carries the seed');
    const f = canvasRealm({ entries: [{ id: 'canvas-readback', mode: 'custom', value: entry.selected.value, canvasSeed: entry.canvasSeed }] }), source = f.canvas(300, 150, 'mixed'), read = source.read();
    if (algorithm === 'sparse-rgb-v2') assert.ok(sameBytes(read, sparseExpectedV2(source.pixels, 300, 150, sessionKey(seed64)).data), 'registered sparse-rgb-v2 profile == its oracle');
    else if (algorithm === 'sparse-rgb-v1') assert.ok(sameBytes(read, sparseExpected(source.pixels, 300, 150, sessionKey(seed64)).data), 'registered sparse profile == oracle');
    else assert.ok(!sameBytes(read, sparseExpected(source.pixels, 300, 150, sessionKey(seed64)).data) && !sameBytes(read, source.pixels), 'registered stable profile keeps its own function');
  }
});
