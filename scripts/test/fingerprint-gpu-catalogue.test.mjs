// ADR-104: the Windows GPU catalogue. Every card has the exact Chrome ANGLE/Direct3D11 renderer form and a
// valid WebGL value, a random device draws cores, screen and RAM that fit the card, and random choice is
// deterministic and favours common cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration, validateApiConfiguration, validateApiValue } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, applyDevicePatch } from '../../apps/production-extension/fingerprint-profiles.js';
import { GPU_PRESETS, SCREEN_PRESETS, CPU_STEPS, RAM_STEPS, DEVICE_TYPES, WEBGPU_ARCHITECTURES, buildDeviceValues, describeDevice, gpuValues, gpusFor, reportedDeviceMemory } from '../../apps/production-extension/fingerprint-device-presets.js';

const FORMAT = /^ANGLE \((NVIDIA|AMD|Intel), (.+) \(0x([0-9A-F]{8})\) Direct3D11 vs_5_0 ps_5_0, D3D11\)$/u;
const VENDORS = { nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel' };
const CONTRADICTIONS = ['platform-agent', 'client-hints-agent', 'language-list', 'screen-available', 'screen-depth', 'orientation-size', 'gpu-pair', 'memory-bucket'];

test('the catalogue holds fifty distinct adapters in Chrome ANGLE form with the Google vendor wrapper', () => {
  assert.equal(GPU_PRESETS.length, 50);
  assert.equal(new Set(GPU_PRESETS.map(card => card.id)).size, 50, 'unique ids');
  assert.equal(new Set(GPU_PRESETS.map(card => card.webgl.unmaskedRenderer)).size, 50, 'unique renderers');
  for (const card of GPU_PRESETS) {
    const match = FORMAT.exec(card.webgl.unmaskedRenderer);
    assert.ok(match, card.id + ': ' + card.webgl.unmaskedRenderer);
    assert.equal(match[1], VENDORS[card.vendorFamily], card.id + ' vendor in the renderer');
    assert.equal(card.webgl.unmaskedVendor, 'Google Inc. (' + match[1] + ')', card.id);
    assert.equal(card.webgl.vendor, 'WebKit'); assert.equal(card.webgl.renderer, 'WebKit WebGL', 'the masked pair stays the browser constant');
    assert.match(match[2], /^[A-Za-z0-9 ()]+$/u, card.id + ' description has no stray characters');
    const deviceId = parseInt(match[3], 16); assert.ok(deviceId > 0 && deviceId <= 0xFFFF, card.id + ' is a 16-bit PCI device id');
    assert.equal(validateApiValue('webgl', { kind: 'value', value: card.webgl }).ok, true, card.id + ' passes the WebGL validator');
    assert.ok(card.types.length >= 1 && card.types.every(type => DEVICE_TYPES.includes(type)), card.id + ' types');
    assert.ok([1, 2, 3, 4].includes(card.performance) && Number.isInteger(card.weight) && card.weight >= 1 && card.weight <= 10, card.id + ' class and weight');
    assert.ok(card.label.trim() && !/\((?:R|TM)\)/u.test(card.label), card.id + ' label is plain text');
  }
});

test('the example card and the five original cards keep their exact strings', () => {
  const byId = id => GPU_PRESETS.find(card => card.id === id).webgl;
  assert.equal(byId('nvidia-rtx-2080-super').unmaskedRenderer, 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 SUPER (0x00001E81) Direct3D11 vs_5_0 ps_5_0, D3D11)');
  assert.equal(byId('nvidia-rtx-2080-super').unmaskedVendor, 'Google Inc. (NVIDIA)');
  // Saved profiles recognise their card by this string, so it must never change.
  assert.equal(byId('intel-uhd-620').unmaskedRenderer, 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)');
  assert.equal(byId('intel-iris-xe').unmaskedRenderer, 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)');
  assert.equal(byId('nvidia-rtx-3060').unmaskedRenderer, 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)');
  assert.equal(byId('nvidia-rtx-4060').unmaskedRenderer, 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 (0x00002882) Direct3D11 vs_5_0 ps_5_0, D3D11)');
  assert.equal(byId('amd-rx-6600').unmaskedRenderer, 'ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)');
});

test('both device types get a real choice from all three vendors', () => {
  const desktop = gpusFor('desktop'), laptop = gpusFor('laptop');
  assert.ok(desktop.length >= 28 && laptop.length >= 18, desktop.length + ' desktop, ' + laptop.length + ' laptop');
  for (const list of [desktop, laptop]) assert.deepEqual([...new Set(list.map(card => card.vendorFamily))].sort(), ['amd', 'intel', 'nvidia']);
  // A discrete desktop card is never offered to a laptop and a laptop-only GPU never to a desktop.
  for (const card of laptop.filter(entry => entry.types.length === 1)) assert.ok(!desktop.includes(card), card.id);
});

test('a random device fits its card: cores, screen and RAM come from the card class', () => {
  for (const type of DEVICE_TYPES) for (const card of gpusFor(type)) for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { summary, screen } = buildDeviceValues({ deviceType: type, gpu: card.id, seed });
    const label = card.id + '/' + type + '/' + seed;
    assert.equal(summary.gpu, card.id, label);
    assert.ok(CPU_STEPS.includes(summary.cores), label + ' cores');
    // Threads come from the card's own CPU lineup (G2); an office card is capped at 8 threads only when its generation has
    // no 12+ thread CPU (Rembrandt, Alder/Raptor Lake-P, Meteor Lake and UHD 770 do, so 4/8 there would be impossible).
    assert.ok(card.threads.includes(summary.cores), label + ' threads ' + summary.cores + ' are in the card lineup');
    if (card.performance === 1 && Math.max(...card.threads) <= 8) assert.ok(summary.cores <= 8, label + ' office card, ' + summary.cores + ' threads');
    if (card.performance === 4) assert.ok(summary.cores >= 12, label + ' high-end card, ' + summary.cores + ' threads');
    assert.ok(screen.types.includes(type), label + ' screen exists for the type');
    if (screen.id === '3840x2160') assert.ok(type === 'desktop' && card.performance === 4, label + ' 4K only with a high-end desktop card');
    if (screen.id === '1366x768') assert.ok(type === 'laptop' && card.performance === 1, label + ' 1366x768 only with an office laptop');
    assert.ok(RAM_STEPS.includes(summary.ramGb) && summary.reportedMemory === reportedDeviceMemory(summary.ramGb, summary.version), label + ' RAM');
    assert.ok(SCREEN_PRESETS.some(entry => entry.id === summary.screen), label);
  }
});

test('random choice is deterministic for a seed and favours common cards', () => {
  const pick = seed => buildDeviceValues({ deviceType: 'desktop', seed }).summary.gpu;
  for (const seed of [0, 1, 42, 99999]) assert.equal(pick(seed), pick(seed));
  const counts = new Map(); for (let seed = 0; seed < 2000; seed++) counts.set(pick(seed), (counts.get(pick(seed)) ?? 0) + 1);
  const desktop = gpusFor('desktop');
  for (const card of desktop) assert.ok(counts.get(card.id) >= 1, card.id + ' is reachable');
  assert.ok(counts.get('nvidia-rtx-3060') > 3 * counts.get('intel-arc-a380'), 'weight 10 is drawn far more often than weight 1');
  assert.ok(counts.get('nvidia-rtx-3060') > counts.get('nvidia-rtx-4080'), 'a mainstream card beats an enthusiast card');
});

test('every card yields a valid contradiction-free configuration through Randomize', () => {
  const base = createApiConfiguration();
  for (const card of GPU_PRESETS) for (const deviceType of card.types) {
    const result = generateConsistentDevice(base, { deviceType, gpu: card.id, seed: 7 });
    assert.equal(validateApiConfiguration(result.configuration).ok, true, card.id);
    assert.equal(result.summary.gpu, card.id);
    const flagged = result.issues.map(issue => issue.code).filter(code => CONTRADICTIONS.includes(code));
    assert.deepEqual(flagged, [], card.id + '/' + deviceType);
    const webgl = result.configuration.apis.find(row => row.id === 'webgl').selected.value;
    assert.equal(webgl.unmaskedRenderer, card.webgl.unmaskedRenderer);
  }
});

// G3: the WebGPU adapter row follows the claimed card. Chrome 156 prints only vendor and architecture there (measured on an
// RTX 2080 SUPER: nvidia/turing, device and description blank); only "turing" is measured, the other architecture names are
// heuristics from the card generation and Dawn's vocabulary.
const gpuRow = (configuration, id) => { const row = configuration.apis.find(entry => entry.id === id); return row?.mode === 'custom' && row.selected.kind === 'value' ? row.selected.value : undefined; };

test('every card carries a WebGPU vendor and architecture from the Dawn vocabulary and gpuValues writes the closed four-string row', () => {
  for (const entry of GPU_PRESETS) {
    assert.equal(entry.webgpu.vendor, entry.vendorFamily, entry.id + ' vendor is the card vendor family');
    assert.ok(WEBGPU_ARCHITECTURES[entry.webgpu.vendor].includes(entry.webgpu.architecture), `${entry.id}: ${entry.webgpu.architecture} is in the ${entry.webgpu.vendor} vocabulary`);
    const row = gpuValues(entry.id).find(value => value.id === 'webgpu');
    assert.deepEqual(row.raw, { vendor: entry.webgpu.vendor, architecture: entry.webgpu.architecture, device: '', description: '' }, entry.id);
    assert.equal(validateApiValue('webgpu', { kind: 'value', value: row.raw }).ok, true, entry.id + ' passes the WebGPU validator');
    assert.deepEqual(gpuValues(entry.id).map(value => value.id), ['webgl', 'webgl-capabilities', 'webgpu'], 'the webgl-capabilities write is unchanged');
  }
  // The measured pair, and the generation families named in the task.
  assert.deepEqual({ ...GPU_PRESETS.find(entry => entry.id === 'nvidia-rtx-2080-super').webgpu }, { vendor: 'nvidia', architecture: 'turing' });
  const arch = id => GPU_PRESETS.find(entry => entry.id === id).webgpu.architecture;
  assert.deepEqual(['nvidia-gtx-1060', 'nvidia-rtx-3060', 'nvidia-rtx-4060', 'amd-rx-580', 'amd-radeon-cezanne', 'amd-rx-5700-xt', 'amd-radeon-rembrandt', 'amd-rx-7600', 'intel-uhd-630', 'intel-iris-plus', 'intel-iris-xe', 'intel-arc-a750', 'intel-arc-graphics'].map(arch),
    ['pascal', 'ampere', 'lovelace', 'gcn-4', 'gcn-5', 'rdna-1', 'rdna-2', 'rdna-3', 'gen-9', 'gen-11', 'gen-12lp', 'gen-12hp', 'xe-lpg']);
  assert.ok(WEBGPU_ARCHITECTURES.amd.includes('terascale-2') && WEBGPU_ARCHITECTURES.intel.includes('xe-3lpg-xs') && WEBGPU_ARCHITECTURES.nvidia.includes('blackwell'));
});

test('Randomize and the GPU control write the WebGPU row of the chosen card; Auto resets all three rows; a page block stays', () => {
  const base = createApiConfiguration();
  for (const entry of GPU_PRESETS) {
    const generated = generateConsistentDevice(base, { deviceType: entry.types[0], gpu: entry.id, seed: 5 });
    assert.deepEqual(gpuRow(generated.configuration, 'webgpu'), { vendor: entry.webgpu.vendor, architecture: entry.webgpu.architecture, device: '', description: '' }, entry.id);
    const codes = generated.issues.map(issue => issue.code);
    assert.ok(!codes.some(code => ['gpu-pair', 'webgpu-gpu', 'gpu-shape', 'gpu-os'].includes(code)), entry.id + ': ' + codes.join());
    assert.equal(describeDevice(id => gpuRow(generated.configuration, id)).gpu, entry.id, 'describeDevice still reads the card from the WebGL row');
  }
  const full = applyDevicePatch(base, { gpu: 'amd-rx-6600' }).configuration;
  assert.equal(gpuRow(full, 'webgpu').vendor, 'amd');
  const auto = applyDevicePatch(full, { gpu: null });
  for (const id of ['webgl', 'webgl-capabilities', 'webgpu']) assert.equal(auto.configuration.apis.find(row => row.id === id).mode, 'bypass', id + ' returns to the browser');
  assert.equal(auto.device.gpu, null);
  const blocked = structuredClone(base); blocked.apis.find(row => row.id === 'webgpu').mode = 'on';
  assert.equal(applyDevicePatch(blocked, { gpu: 'amd-rx-6600' }).configuration.apis.find(row => row.id === 'webgpu').mode, 'on', 'an explicit page block is never cancelled');
});
