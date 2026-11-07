// ADR-104 addendum 4 + ADR-107: "Максимальная защита" reports NEUTRAL Custom values instead of blocking sensor/hardware APIs
// (owner decision 2026-11-05). Ten rows get a Chrome-shaped value: typical desktop answers, Chrome's own 0.1 ms clock step, and the
// heap limit measured on Chrome 156 (written only for that class: Chromium 156 with deviceMemory >= 16). The three rows that have no
// Custom shape in the contract (compute-pressure, generic-sensors, device-motion) are the only remaining blocks. An explicit page
// block is never overwritten and a lighter preset takes the rows back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { API_CONFIG_CATALOG, API_CUSTOM_ONLY_IDS, createApiConfiguration, validateApiConfiguration, validateApiValue, exportApiConfiguration, importApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, applyDevicePatch, fingerprintProfileIssues } from '../../apps/production-extension/fingerprint-profiles.js';
import { neutralSensorValues, STRICT_BLOCK_ONLY, MEASURED_HEAP, heapClassMeasured } from '../../apps/production-extension/fingerprint-device-presets.js';

const base = createApiConfiguration();
// The documented table: pinned literally so that a silent change of a value fails here.
const NEUTRAL = Object.freeze({
  battery: { charging: true, chargingTime: 0, dischargingTime: null, level: 1 },
  'network-information': { downlink: 1.5, effectiveType: '4g', rtt: 100, saveData: false },
  'performance-memory': { jsHeapSizeLimit: 4395630592, totalJSHeapSize: 1573038, usedJSHeapSize: 1092582 },
  bluetooth: { available: false, devices: [] },
  usb: [], hid: [], serial: [], gamepads: [], 'speech-voices': [],
  'clock-precision': { resolutionMs: 0.1 },
});
const NEUTRAL_IDS = Object.keys(NEUTRAL);
const BLOCK_ONLY = ['compute-pressure', 'generic-sensors', 'device-motion'];
// clock-precision is a Custom-only row (it has no Block mode), so the block tests leave it out.
const BLOCKABLE = NEUTRAL_IDS.filter(id => !API_CUSTOM_ONLY_IDS.includes(id));
const row = (configuration, id) => configuration.apis.find(entry => entry.id === id);
const mode = (configuration, id) => row(configuration, id).mode;
const val = (configuration, id) => { const found = row(configuration, id); return found?.mode === 'custom' && found.selected.kind === 'value' ? found.selected.value : undefined; };
// The default claim is the measured heap class (Chrome 156, 32 GB -> deviceMemory 32), so all ten rows are written.
const generate = (protection, over = {}, from = base, seed = 3) => generateConsistentDevice(from, { deviceType: 'desktop', protection, seed, version: 156, ramGb: 32, ...over });
const withMode = (configuration, id, next) => { const copy = structuredClone(configuration); row(copy, id).mode = next; return copy; };
const withCustom = (configuration, id, value) => { const copy = structuredClone(configuration); const found = row(copy, id); found.mode = 'custom'; found.selected = validateApiValue(id, { kind: 'value', value }).value; return copy; };

test('Strict writes the documented neutral Custom value on all ten rows, and none of them is a block', () => {
  const strict = generate('strict').configuration;
  assert.equal(NEUTRAL_IDS.length, 10);
  for (const id of NEUTRAL_IDS) {
    assert.equal(mode(strict, id), 'custom', id + ' is Custom, not a block');
    assert.deepEqual(val(strict, id), NEUTRAL[id], id + ' holds the documented neutral value');
  }
  // The generator's own table is the same table.
  assert.deepEqual(Object.fromEntries(neutralSensorValues().map(({ id, raw }) => [id, raw])), NEUTRAL);
});

test('the neutral values are valid under the contract validators and every one is a preset of its row in catalogue 8', () => {
  for (const [id, raw] of Object.entries(NEUTRAL)) {
    assert.equal(validateApiValue(id, { kind: 'value', value: raw }).ok, true, id);
    const entry = API_CONFIG_CATALOG.find(item => item.id === id);
    assert.equal(entry.customSupported, true, id + ' accepts Custom values');
    assert.ok(entry.presets.some(preset => preset.value.kind === 'value' && isDeepStrictEqual(preset.value.value, raw)), id + ' equals a catalogue preset');
  }
  assert.equal(validateApiConfiguration(generate('strict').configuration).ok, true);
});

test('the heap row belongs to the measured class only: Chromium 156 with deviceMemory 16 or 32; other claims keep it native', () => {
  assert.deepEqual(MEASURED_HEAP.value, NEUTRAL['performance-memory']);
  for (const [claim, measured] of [[{ chromeMajor: 156, reportedMemory: 32 }, true], [{ chromeMajor: 156, reportedMemory: 16 }, true], [{ chromeMajor: 156, reportedMemory: 8 }, false],
    [{ chromeMajor: 155, reportedMemory: 32 }, false], [{ chromeMajor: 157, reportedMemory: 32 }, false], [null, false], [{}, false]]) assert.equal(heapClassMeasured(claim), measured, JSON.stringify(claim));
  assert.ok(neutralSensorValues().some(entry => entry.id === 'performance-memory'), 'without a claim every row Strict can write is listed');
  assert.ok(!neutralSensorValues({ chromeMajor: 150, reportedMemory: 32 }).some(entry => entry.id === 'performance-memory'));
  for (const over of [{ ramGb: 8 }, { version: 150 }, { version: 140, ramGb: 128 }, { browser: 'edge', ramGb: 4 }]) {
    const strict = generate('strict', over).configuration;
    assert.equal(mode(strict, 'performance-memory'), 'bypass', JSON.stringify(over) + ' keeps the heap native');
    for (const id of NEUTRAL_IDS.filter(item => item !== 'performance-memory')) assert.deepEqual(val(strict, id), NEUTRAL[id], JSON.stringify(over) + ' ' + id);
  }
  assert.deepEqual(val(generate('strict', { browser: 'edge' }).configuration, 'performance-memory'), NEUTRAL['performance-memory'], 'Edge 156 shares the Chromium heap sizing');
  // A Strict device of another class takes back the measured value an earlier Strict device wrote, but never a user value.
  const measured = generate('strict').configuration;
  assert.equal(mode(generate('strict', { ramGb: 8 }, measured, 4).configuration, 'performance-memory'), 'bypass');
  const mine = { jsHeapSizeLimit: 2172649472, totalJSHeapSize: 20000000, usedJSHeapSize: 10000000 }, own = structuredClone(base);
  row(own, 'performance-memory').mode = 'custom'; row(own, 'performance-memory').selected = validateApiValue('performance-memory', { kind: 'value', value: mine }).value;
  assert.deepEqual(val(generate('strict', { ramGb: 8 }, own).configuration, 'performance-memory'), mine);
});

test('the neutral table hands out fresh mutable copies, so a caller can never change the table or another configuration', () => {
  const first = neutralSensorValues();
  first[0].raw.level = 0.5; first.find(entry => entry.id === 'bluetooth').raw.devices.push('x'); first.find(entry => entry.id === 'usb').raw.push('x');
  assert.deepEqual(Object.fromEntries(neutralSensorValues().map(({ id, raw }) => [id, raw])), NEUTRAL, 'the table is untouched');
  assert.notEqual(neutralSensorValues()[0].raw, neutralSensorValues()[0].raw, 'every call returns new objects');
  // The configuration keeps its own copy as well.
  const strict = generate('strict').configuration; first[0].raw.charging = false;
  assert.equal(val(strict, 'battery').charging, true);
});

test('the heap value is the measured Chrome 156 limit with a plausible shape: used < total < limit', () => {
  const memory = val(generate('strict').configuration, 'performance-memory');
  assert.equal(memory.jsHeapSizeLimit, 4395630592, 'measured on Chrome 156 with deviceMemory 32 (4 GiB + 96 MiB)');
  assert.ok(memory.usedJSHeapSize < memory.totalJSHeapSize && memory.totalJSHeapSize < memory.jsHeapSizeLimit);
  assert.ok(Object.values(memory).every(Number.isSafeInteger));
});

test('exactly three rows stay blocked under Strict, and the only reason is that the contract has no Custom shape for them', () => {
  assert.deepEqual([...STRICT_BLOCK_ONLY], BLOCK_ONLY);
  const strict = generate('strict').configuration;
  assert.deepEqual(strict.apis.filter(entry => entry.mode === 'on').map(entry => entry.id).sort(), [...BLOCK_ONLY].sort());
  for (const id of BLOCK_ONLY) {
    const entry = API_CONFIG_CATALOG.find(item => item.id === id);
    // If this fails the contract gained a Custom shape: give the row a neutral value in fingerprint-device-presets.js and drop it from STRICT_BLOCK_ONLY.
    assert.equal(entry.customSupported, false, id + ' still has no Custom shape');
    assert.equal(mode(strict, id), 'on', id + ' is blocked');
  }
  // Nothing that can report a Custom value is blocked by Strict.
  for (const entry of strict.apis) if (entry.mode === 'on') assert.equal(entry.customSupported, false, entry.id + ' is blocked although it could report a value');
});

test('Compatibility and Balanced write none of these twelve rows', () => {
  for (const protection of ['compatibility', 'balanced']) {
    const result = generate(protection).configuration;
    for (const id of [...NEUTRAL_IDS, ...BLOCK_ONLY]) assert.equal(mode(result, id), 'bypass', protection + '/' + id);
  }
});

test('the neutral values do not depend on the seed, the device type or the claimed system (a crowd value, not a fingerprint)', () => {
  const reference = JSON.stringify(NEUTRAL_IDS.map(id => val(generate('strict').configuration, id)));
  for (const [seed, over] of [[1, {}], [999, { deviceType: 'laptop' }], [42, { os: 'windows-10', browser: 'edge' }]])
    assert.equal(JSON.stringify(NEUTRAL_IDS.map(id => val(generate('strict', over, base, seed).configuration, id))), reference, JSON.stringify(over));
});

test('an explicit page block is never cancelled by Strict, on a neutral row or on a block-only row', () => {
  for (const id of [...BLOCKABLE, ...BLOCK_ONLY]) {
    const blocked = withMode(base, id, 'on');
    const result = generate('strict', {}, blocked).configuration;
    assert.equal(mode(result, id), 'on', id + ' stays blocked');
    assert.deepEqual(row(result, id).selected, row(blocked, id).selected, id + ' keeps its dormant selection');
    // The other neutral rows are still written.
    for (const other of NEUTRAL_IDS.filter(item => item !== id)) assert.deepEqual(val(result, other), NEUTRAL[other], other);
  }
});

test('a Custom value the user already chose on a neutral row is kept by Strict', () => {
  const mine = { charging: false, chargingTime: null, dischargingTime: 3600, level: 0.5 };
  const result = generate('strict', {}, withCustom(base, 'battery', mine)).configuration;
  assert.deepEqual(val(result, 'battery'), mine);
  assert.deepEqual(val(result, 'usb'), []);
});

test('Strict over Strict changes nothing on these rows (idempotent), and the result survives portable JSON', () => {
  const first = generate('strict').configuration, again = generate('strict', {}, first, 4);
  for (const id of [...NEUTRAL_IDS, ...BLOCK_ONLY]) assert.deepEqual(row(again.configuration, id), row(first, id), id);
  assert.ok(!again.affected.some(id => [...NEUTRAL_IDS, ...BLOCK_ONLY].includes(id)));
  const imported = importApiConfiguration(exportApiConfiguration(first));
  assert.equal(imported.ok, true, imported.error?.message);
  for (const id of [...NEUTRAL_IDS, ...BLOCK_ONLY]) assert.deepEqual(row(imported.value, id), row(first, id), id);
});

test('the first Strict reports the nine neutral rows and the three blocks as changed', () => {
  const result = generate('strict');
  for (const id of [...NEUTRAL_IDS, ...BLOCK_ONLY]) assert.ok(result.affected.includes(id), id);
});

test('a lighter preset generated afterwards returns the nine Custom rows to "as in the browser"', () => {
  const strict = generate('strict').configuration;
  for (const protection of ['balanced', 'compatibility']) {
    const lighter = generate(protection, {}, strict, 5).configuration;
    for (const id of NEUTRAL_IDS) {
      assert.equal(mode(lighter, id), 'bypass', protection + '/' + id);
      assert.deepEqual(row(lighter, id).selected, { kind: 'unset' }, protection + '/' + id);
    }
    assert.equal(mode(lighter, 'hardware-concurrency'), 'custom', 'identity rows stay');
  }
});

test('a lighter preset keeps user blocks and a Custom value that is not the one Strict writes', () => {
  const mine = { charging: false, chargingTime: null, dischargingTime: 3600, level: 0.5 };
  const start = withCustom(withMode(base, 'usb', 'on'), 'battery', mine);
  const strict = generate('strict', {}, start).configuration;
  assert.equal(mode(strict, 'usb'), 'on'); assert.deepEqual(val(strict, 'battery'), mine);
  const lighter = generate('balanced', {}, strict, 6).configuration;
  assert.equal(mode(lighter, 'usb'), 'on', 'the user block is not touched');
  assert.deepEqual(val(lighter, 'battery'), mine, 'the user value is not removed by a preset');
  for (const id of NEUTRAL_IDS.filter(item => !['usb', 'battery'].includes(item))) assert.equal(mode(lighter, id), 'bypass', id);
  // A user block on a row Strict has not touched stays too.
  for (const id of BLOCKABLE) assert.equal(mode(generate('compatibility', {}, withMode(strict, id, 'on')).configuration, id), 'on', id);
});

test('known limit: a block that Strict wrote on a block-only row cannot be told from a user block, so a lighter preset keeps it', () => {
  const lighter = generate('compatibility', {}, generate('strict').configuration, 7).configuration;
  for (const id of BLOCK_ONLY) assert.equal(mode(lighter, id), 'on', id);
});

test('strict neutral rows raise no contradiction hint and keep the validators happy', () => {
  const result = generate('strict');
  const codes = result.issues.map(issue => issue.code);
  for (const code of codes) assert.ok(['screen-css', 'worker-scope', 'timezone-metadata', 'network-ua', 'network-language'].includes(code), code);
  assert.deepEqual(fingerprintProfileIssues(result.configuration).map(issue => issue.code).filter(code => !['screen-css', 'worker-scope', 'network-ua', 'network-language'].includes(code)), []);
});

test('level controls never write these rows: a patch leaves the neutral and blocked sensor rows alone', () => {
  const strict = generate('strict').configuration;
  const patched = applyDevicePatch(strict, { cores: 12, gpu: 'intel-iris-xe', language: 'de-DE' });
  for (const id of [...NEUTRAL_IDS, ...BLOCK_ONLY]) assert.deepEqual(row(patched.configuration, id), row(strict, id), id);
});
