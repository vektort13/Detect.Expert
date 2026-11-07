// Canvas readback algorithm of generated profiles: 'sparse-rgb-v2' once the contract accepts it (catalogue 11, ADR-112), then 'sparse-rgb-v1'
// (catalogue 8), otherwise the older 'stable-rgb-v1'. The contract's own validator decides, so there is no catalogue-version comparison in
// the generator. A profile that was saved with an older algorithm keeps it until it is generated or switched on again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { API_CONFIGURATION_CATALOG_VERSION, createApiConfiguration, validateApiConfiguration, validateApiValue, exportApiConfiguration, importApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, applyDevicePatch, canvasProjection, CANVAS_ALGORITHMS } from '../../apps/production-extension/fingerprint-profiles.js';

const base = createApiConfiguration();
const row = (configuration, id) => configuration.apis.find(entry => entry.id === id);
const accepts = algorithm => validateApiValue('canvas-readback', { kind: 'value', value: { algorithm } }).ok;
const generate = (protection, from = base, seed = 3) => generateConsistentDevice(from, { deviceType: 'desktop', protection, seed }).configuration;
const SPARSE_ALLOWED = accepts('sparse-rgb-v2');
const DEFAULT = SPARSE_ALLOWED ? 'sparse-rgb-v2' : accepts('sparse-rgb-v1') ? 'sparse-rgb-v1' : 'stable-rgb-v1';

test('the helper prefers sparse-rgb-v2, then sparse-rgb-v1, and falls back to stable-rgb-v1 when a contract does not accept them', () => {
  assert.deepEqual([...CANVAS_ALGORITHMS], ['sparse-rgb-v2', 'sparse-rgb-v1', 'stable-rgb-v1']);
  assert.deepEqual(canvasProjection(() => true), { algorithm: 'sparse-rgb-v2' });
  assert.deepEqual(canvasProjection(algorithm => algorithm !== 'sparse-rgb-v2'), { algorithm: 'sparse-rgb-v1' });
  assert.deepEqual(canvasProjection(algorithm => algorithm === 'stable-rgb-v1'), { algorithm: 'stable-rgb-v1' });
  // An older contract that accepts neither still gets the older name, and the validating setter then refuses it as before.
  assert.deepEqual(canvasProjection(() => false), { algorithm: 'stable-rgb-v1' });
  // A fresh object each time, so a caller can never mutate a shared default.
  const first = canvasProjection(() => true); first.algorithm = 'changed';
  assert.deepEqual(canvasProjection(() => true), { algorithm: 'sparse-rgb-v2' });
});

test('the real contract decides: catalogue 11 accepts all three algorithms, and the default follows the validator', () => {
  assert.equal(accepts('stable-rgb-v1'), true); assert.equal(accepts('sparse-rgb-v1'), true);
  assert.equal(SPARSE_ALLOWED, API_CONFIGURATION_CATALOG_VERSION >= 11, 'sparse-rgb-v2 arrives with catalogue 11');
  assert.equal(canvasProjection().algorithm, DEFAULT);
  assert.equal(accepts('random'), false); assert.equal(accepts('sparse-rgb-v3'), false);
});

test('Balanced and Strict write the default algorithm; Compatibility leaves Canvas native', () => {
  const expected = { algorithm: DEFAULT };
  for (const protection of ['balanced', 'strict']) {
    const canvas = row(generate(protection), 'canvas-readback');
    assert.equal(canvas.mode, 'custom'); assert.deepEqual(canvas.selected, { kind: 'value', value: expected }, protection);
  }
  const compatibility = row(generate('compatibility'), 'canvas-readback');
  assert.equal(compatibility.mode, 'bypass'); assert.deepEqual(compatibility.selected, { kind: 'unset' });
});

test('a profile that still holds an older algorithm keeps it while it is only saved or applied, and moves to the default when it is generated again', () => {
  for (const older of ['stable-rgb-v1', 'sparse-rgb-v1']) {
    const old = structuredClone(base), canvas = row(old, 'canvas-readback');
    canvas.mode = 'custom'; canvas.selected = { kind: 'value', value: { algorithm: older } };
    assert.equal(validateApiConfiguration(old).ok, true, older + ' stays valid');
    assert.equal(row(old, 'canvas-readback').selected.value.algorithm, older, 'nothing rewrites a saved value');
    assert.equal(row(generate('balanced', old), 'canvas-readback').selected.value.algorithm, canvasProjection().algorithm);
  }
});

test('an explicit page block on Canvas is never cancelled by generation or by the level switch', () => {
  const blocked = structuredClone(base); row(blocked, 'canvas-readback').mode = 'on';
  for (const protection of ['balanced', 'strict']) assert.equal(row(generate(protection, blocked), 'canvas-readback').mode, 'on', protection);
  const switched = applyDevicePatch(blocked, { canvas: true, seed: 5 }).configuration;
  assert.equal(row(switched, 'canvas-readback').mode, 'on'); assert.deepEqual(row(switched, 'canvas-readback').selected, { kind: 'unset' });
});

test('the Canvas switch of the level controls writes the default algorithm and a null or false value returns it to the browser', () => {
  const on = applyDevicePatch(base, { canvas: true }).configuration;
  assert.equal(row(on, 'canvas-readback').mode, 'custom');
  assert.deepEqual(row(on, 'canvas-readback').selected.value, canvasProjection());
  for (const off of [false, null]) {
    const reset = applyDevicePatch(on, { canvas: off }).configuration;
    assert.equal(row(reset, 'canvas-readback').mode, 'bypass'); assert.deepEqual(row(reset, 'canvas-readback').selected, { kind: 'unset' });
  }
  assert.throws(() => applyDevicePatch(base, { canvas: 'sparse-rgb-v1' }), /invalid-value/);
});

test('the generated Canvas row survives portable JSON export and import', () => {
  const generated = generate('balanced');
  const imported = importApiConfiguration(exportApiConfiguration(generated));
  assert.equal(imported.ok, true, imported.error?.message);
  assert.deepEqual(row(imported.value, 'canvas-readback'), row(generated, 'canvas-readback'));
});
