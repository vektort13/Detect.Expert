// Per-card thread sets: the hardwareConcurrency of a random device comes from the public CPU lineups of the card's
// generation and form factor (heuristic, unverified against telemetry), so an iGPU of a 12-16 thread generation is never
// paired with 4 or 8 threads. A real hardwareConcurrency (environment) caps a drawn value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, applyDevicePatch, fingerprintProfileIssues } from '../../apps/production-extension/fingerprint-profiles.js';
import { GPU_PRESETS, CPU_STEPS, DEVICE_TYPES, buildDeviceValues, gpusFor } from '../../apps/production-extension/fingerprint-device-presets.js';

const base = createApiConfiguration();
const val = (configuration, id) => { const row = configuration.apis.find(a => a.id === id); return row?.mode === 'custom' && row.selected.kind === 'value' ? row.selected.value : undefined; };
const card = id => GPU_PRESETS.find(entry => entry.id === id);
const draw = (gpu, deviceType, seed, environment) => buildDeviceValues({ deviceType, gpu, seed, ...(environment ? { environment } : {}) }).summary.cores;
// The four iGPU generations with 12+ thread CPUs only, plus the desktop UHD 770 (12th/13th gen desktop CPUs).
const MANY_THREADS = ['amd-radeon-rembrandt', 'intel-iris-xe-alder-lake', 'intel-iris-xe-raptor-lake', 'intel-arc-graphics', 'intel-uhd-770'];

test('every one of the 50 cards has a non-empty, sorted, unique thread list inside the CPU_STEPS ladder', () => {
  assert.equal(GPU_PRESETS.length, 50);
  for (const entry of GPU_PRESETS) {
    assert.ok(Array.isArray(entry.threads) && entry.threads.length >= 1 && Object.isFrozen(entry.threads), entry.id + ' has a frozen list');
    assert.ok(entry.threads.every(count => CPU_STEPS.includes(count)), entry.id + ' stays inside the slider ladder');
    assert.deepEqual([...entry.threads], [...new Set(entry.threads)].sort((a, b) => a - b), entry.id + ' sorted and unique');
  }
  // The generations with only 12+ thread CPUs say so in their lists.
  for (const id of MANY_THREADS) assert.ok(Math.min(...card(id).threads) >= 12, id + ' lineup starts at 12 threads');
  // Meteor Lake exact thread counts (14, 18, 22) are mostly not on the ladder: only 18 is kept.
  assert.deepEqual([...card('intel-arc-graphics').threads], [18]);
});

test('exhaustive: 50 cards x every device type x 200 seeds draw a value of the card lineup', () => {
  let checked = 0;
  for (const entry of GPU_PRESETS) for (const deviceType of entry.types) for (let seed = 0; seed < 200; seed++) {
    const cores = draw(entry.id, deviceType, seed);
    assert.ok(entry.threads.includes(cores), `${entry.id}/${deviceType}/${seed}: ${cores} is not in [${entry.threads}]`);
    checked++;
  }
  assert.ok(checked >= 200 * 50);
});

test('iGPU generations with 12+ thread CPUs never get 4 or 8 threads, on any path (builder, Randomize, every device type)', () => {
  for (const id of MANY_THREADS) for (const deviceType of card(id).types) for (let seed = 0; seed < 300; seed++) {
    const cores = draw(id, deviceType, seed);
    assert.ok(cores >= 12, `${id}/${deviceType}/${seed}: ${cores}`);
  }
  for (const id of MANY_THREADS) {
    const result = generateConsistentDevice(base, { deviceType: card(id).types[0], gpu: id, seed: 77 });
    assert.ok(val(result.configuration, 'hardware-concurrency') >= 12, id);
  }
  // Random draws over the whole catalogue: how often does an old pairing like "UHD 770 desktop with 4/6/8" still occur?
  let impossible = 0;
  for (const deviceType of DEVICE_TYPES) for (let seed = 0; seed < 4000; seed++) {
    const { summary } = buildDeviceValues({ deviceType, seed });
    if (MANY_THREADS.includes(summary.gpu) && summary.cores < 12) impossible++;
  }
  assert.equal(impossible, 0);
});

test('a card keeps the class pool when it overlaps the lineup (the draw is the overlap, not the whole lineup)', () => {
  // RTX 3060 (performance 3, desktop pool 8/12/16) lists up to 24 threads but a class-3 desktop draws only 8/12/16.
  const seen = new Set(); for (let seed = 0; seed < 400; seed++) seen.add(draw('nvidia-rtx-3060', 'desktop', seed));
  assert.deepEqual([...seen].sort((a, b) => a - b), [8, 12, 16]);
  // UHD 770 (class 1, pool 4/6/8) has no overlap, so the whole lineup is used and every value occurs.
  const wide = new Set(); for (let seed = 0; seed < 400; seed++) wide.add(draw('intel-uhd-770', 'desktop', seed));
  assert.deepEqual([...wide].sort((a, b) => a - b), [12, 16, 20, 24]);
  // Cezanne (laptop and desktop, class 1) overlaps both pools at 8.
  for (const deviceType of ['laptop', 'desktop']) for (let seed = 0; seed < 100; seed++) assert.equal(draw('amd-radeon-cezanne', deviceType, seed), 8);
  // A thread count the user chose is never replaced by the card lineup.
  assert.equal(buildDeviceValues({ deviceType: 'desktop', gpu: 'intel-uhd-770', cores: 4, seed: 1 }).summary.cores, 4);
  assert.equal(val(applyDevicePatch(base, { gpu: 'intel-uhd-770', cores: 4 }).configuration, 'hardware-concurrency'), 4);
});

test('a real hardwareConcurrency caps a drawn value: the largest value of the card that fits, else the card smallest', () => {
  // GTX 1060 lineup 4/6/8/12/16 (class 2 desktop pool 6/8/12).
  for (let seed = 0; seed < 200; seed++) {
    assert.equal(draw('nvidia-gtx-1060', 'desktop', seed, { hardwareConcurrency: 4 }), 4);
    const capped = draw('nvidia-gtx-1060', 'desktop', seed, { hardwareConcurrency: 10 });
    assert.ok([4, 6, 8].includes(capped), 'capped at 10 -> ' + capped);
    assert.ok(capped <= 10);
    // A machine with enough threads changes nothing.
    assert.equal(draw('nvidia-gtx-1060', 'desktop', seed, { hardwareConcurrency: 32 }), draw('nvidia-gtx-1060', 'desktop', seed));
  }
  // Nothing of the lineup fits (RTX 4080 starts at 16): the card smallest value is used and the hint says so.
  for (let seed = 0; seed < 50; seed++) assert.equal(draw('nvidia-rtx-4080', 'desktop', seed, { hardwareConcurrency: 8 }), 16);
  const above = generateConsistentDevice(base, { deviceType: 'desktop', gpu: 'nvidia-rtx-4080', seed: 3, environment: { hardwareConcurrency: 8 } });
  assert.equal(val(above.configuration, 'hardware-concurrency'), 16);
  assert.ok(above.issues.some(issue => issue.code === 'cores-above-real'));
  // The older environment argument (third parameter) works as well, and an environment that fits adds no hint.
  const third = generateConsistentDevice(base, { deviceType: 'desktop', gpu: 'nvidia-gtx-1060', seed: 3 }, { hardwareConcurrency: 4 });
  assert.equal(val(third.configuration, 'hardware-concurrency'), 4);
  assert.ok(!third.issues.some(issue => issue.code === 'cores-above-real'));
  // A user-chosen value above the real count is kept (the hint is the answer), a drawn one never exceeds it when something fits.
  const chosen = applyDevicePatch(base, { cores: 24, environment: { hardwareConcurrency: 8 } });
  assert.equal(val(chosen.configuration, 'hardware-concurrency'), 24);
  assert.ok(fingerprintProfileIssues(chosen.configuration, { hardwareConcurrency: 8 }).some(issue => issue.code === 'cores-above-real'));
  for (const entry of gpusFor('laptop')) for (let seed = 0; seed < 30; seed++) {
    const cores = draw(entry.id, 'laptop', seed, { hardwareConcurrency: 12 });
    assert.ok(cores <= 12 || cores === Math.min(...entry.threads), `${entry.id}: ${cores}`);
  }
});

test('an unusable real hardwareConcurrency is ignored', () => {
  for (const value of [0, -4, 2.5, '8', NaN, Infinity, null, 5000, {}, [8]]) {
    for (let seed = 0; seed < 20; seed++) assert.equal(draw('nvidia-rtx-4080', 'desktop', seed, { hardwareConcurrency: value }), draw('nvidia-rtx-4080', 'desktop', seed), String(value));
  }
  let read = false;
  const accessor = {}; Object.defineProperty(accessor, 'hardwareConcurrency', { enumerable: true, get() { read = true; return 2; } });
  assert.equal(draw('nvidia-rtx-4080', 'desktop', 1, accessor), draw('nvidia-rtx-4080', 'desktop', 1));
  assert.equal(read, false, 'an accessor on the environment is never invoked');
});
