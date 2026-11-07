// ADR-104 level controls: applyDevicePatch / describeDevice. A slider, select or switch must change
// exactly the rows it owns plus the rows that have to stay consistent with it, refuse values between
// steps, return to «as in preset» on null and never run page-supplied accessors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration, exportApiConfiguration, importApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, applyDevicePatch, DEVICE_PATCH_KEYS } from '../../apps/production-extension/fingerprint-profiles.js';
import { describeDevice, diskFromQuota, ramImageFromReported, reportedDeviceMemory, browserVersions, DISK_STEPS, CPU_STEPS, RAM_STEPS, SCREEN_PRESETS, GPU_PRESETS, windowsTaskbar } from '../../apps/production-extension/fingerprint-device-presets.js';

const base = createApiConfiguration();
const val = (configuration, id) => { const row = configuration.apis.find(a => a.id === id); return row?.mode === 'custom' && row.selected.kind === 'value' ? row.selected.value : undefined; };
const valueOf = configuration => id => val(configuration, id);
const ids = result => [...result.affected].sort();

test('a slider changes exactly the row it owns', () => {
  assert.deepEqual(ids(applyDevicePatch(base, { cores: 12 })), ['hardware-concurrency']);
  assert.deepEqual(ids(applyDevicePatch(base, { ramGb: 32 })), ['device-memory']);
  assert.deepEqual(ids(applyDevicePatch(base, { diskGb: 2048 })), ['storage-estimate']);
  const cores = applyDevicePatch(base, { cores: 16 });
  assert.equal(val(cores.configuration, 'hardware-concurrency'), 16);
  assert.equal(cores.device.cores, 16);
});

test('every fixed CPU step is accepted and anything between steps is refused', () => {
  for (const cores of CPU_STEPS) assert.equal(val(applyDevicePatch(base, { cores }).configuration, 'hardware-concurrency'), cores);
  for (const cores of [1, 3, 5, 7, 10, 64, 2.5, '8', NaN]) assert.throws(() => applyDevicePatch(base, { cores }), /invalid-value/);
});

test('RAM and disk pictures report honest, invertible values', () => {
  for (const ramGb of RAM_STEPS) {
    const memory = val(applyDevicePatch(base, { ramGb }).configuration, 'device-memory');
    assert.equal(memory, reportedDeviceMemory(ramGb, browserVersions()[0]), `${ramGb} GB reports ${memory}`);
  }
  for (const diskGb of DISK_STEPS) {
    const result = applyDevicePatch(base, { diskGb });
    const quota = val(result.configuration, 'storage-estimate').quota;
    assert.ok(quota < diskGb * 1024 ** 3, 'the quota is a share of the disk, never the disk');
    assert.equal(diskFromQuota(quota), diskGb, 'the pictured disk is recoverable from the reported quota');
    assert.equal(describeDevice(valueOf(result.configuration)).diskGb, diskGb);
  }
  // Chrome before 147 reports 8 for every machine of 8 GB and more; 147+ reports 16/32 itself.
  assert.equal(ramImageFromReported(8, 'laptop', 140), 16);
  assert.equal(ramImageFromReported(8, 'desktop', 140), 32);
  assert.equal(ramImageFromReported(8, 'laptop'), 8);
  assert.equal(ramImageFromReported(16, 'desktop'), 16);
  assert.equal(ramImageFromReported(32, 'laptop'), 32);
  assert.equal(ramImageFromReported(4), 4);
});

test('choosing a GPU keeps WebGL and its capabilities in step and never disagrees with the vendor family', () => {
  for (const gpu of GPU_PRESETS) {
    const result = applyDevicePatch(base, { gpu: gpu.id });
    // The WebGPU adapter row follows the same card (vendor and architecture), so a claimed AMD card is not NVIDIA there.
    assert.deepEqual(ids(result), ['webgl', 'webgl-capabilities', 'webgpu']);
    assert.equal(val(result.configuration, 'webgl').unmaskedRenderer, gpu.webgl.unmaskedRenderer);
    assert.equal(val(result.configuration, 'webgl').renderer, 'WebKit WebGL', 'the masked renderer stays the browser constant');
    assert.equal(result.device.gpu, gpu.id);
    assert.ok(!result.issues.some(issue => issue.code === 'gpu-pair'));
  }
});

test('the Windows version keeps identity and screen available area consistent', () => {
  const start = applyDevicePatch(base, { os: 'windows-10', browser: 'chrome', version: 140, screen: '1920x1080' }).configuration;
  assert.equal(val(start, 'screen-avail-height'), 1080 - windowsTaskbar('windows-10'));
  const upgraded = applyDevicePatch(start, { os: 'windows-11' });
  // Windows 11 default is 19.0.0 (measured on Chrome 156 / Edge 156, build 26200); it used to be 15.0.0 (23H2).
  assert.equal(val(upgraded.configuration, 'client-hints').platformVersion, '19.0.0');
  assert.equal(val(upgraded.configuration, 'screen-avail-height'), 1080 - windowsTaskbar('windows-11'), 'the taskbar differs between Windows 10 and 11');
  assert.match(val(upgraded.configuration, 'navigator-user-agent'), /Chrome\/140\.0\.0\.0 Safari/u, 'browser and version are kept when only the OS changes');
  assert.ok(!upgraded.affected.includes('hardware-concurrency'), 'device rows are not touched by an OS change');
  assert.ok(!upgraded.issues.some(issue => ['platform-agent', 'client-hints-agent'].includes(issue.code)));
});

test('browser family and version rewrite UA, app version and client hints together', () => {
  const edge = applyDevicePatch(base, { os: 'windows-11', browser: 'edge', version: 150 });
  // An unknown host also gets Chrome's vendor and no oscpu; a Chromium host already has both natively (ADR-107 follow-up).
  assert.deepEqual(ids(edge), ['client-hints', 'navigator-app-version', 'navigator-oscpu', 'navigator-platform', 'navigator-user-agent', 'navigator-vendor']);
  assert.deepEqual(ids(applyDevicePatch(base, { os: 'windows-11', browser: 'edge', version: 150 }, { uaMajor: 156, brand: 'chrome' })), ['client-hints', 'navigator-app-version', 'navigator-platform', 'navigator-user-agent']);
  assert.match(val(edge.configuration, 'navigator-user-agent'), /Chrome\/150\.0\.0\.0 .*Edg\/150\.0\.0\.0$/u);
  assert.ok(val(edge.configuration, 'client-hints').brands.some(entry => entry.brand === 'Microsoft Edge' && entry.version === '150'));
  const chrome = applyDevicePatch(edge.configuration, { browser: 'chrome' });
  assert.doesNotMatch(val(chrome.configuration, 'navigator-user-agent'), /Edg\//u);
  assert.equal(chrome.device.version, 150, 'the version survives a family change');
  assert.equal(chrome.device.os, 'windows-11');
});

test('the screen control moves resolution, DPR and available area; window geometry and media follow only where the profile already has them', () => {
  const strictBase = generateConsistentDevice(base, { deviceType: 'desktop', protection: 'strict', seed: 3 }).configuration;
  for (const preset of SCREEN_PRESETS) {
    const plain = applyDevicePatch(base, { screen: preset.id, os: 'windows-11' }).configuration;
    assert.equal(val(plain, 'screen-width'), preset.width); assert.equal(val(plain, 'window-device-pixel-ratio'), preset.dpr);
    assert.equal(val(plain, 'screen-geometry'), undefined, 'a plain profile gets no window geometry'); assert.equal(val(plain, 'css-media'), undefined);
    const result = applyDevicePatch(strictBase, { screen: preset.id, os: 'windows-11' });
    assert.equal(val(result.configuration, 'screen-width'), preset.width);
    assert.equal(val(result.configuration, 'window-device-pixel-ratio'), preset.dpr);
    const geometry = val(result.configuration, 'screen-geometry'), media = val(result.configuration, 'css-media');
    assert.ok(geometry.innerHeight <= geometry.outerHeight && geometry.outerHeight <= val(result.configuration, 'screen-avail-height'), 'inner <= outer <= available');
    assert.equal(media.viewportWidth, geometry.innerWidth);
    assert.equal(media.viewportHeight, geometry.innerHeight);
    assert.equal(media.resolutionDppx, preset.dpr);
    assert.ok(!result.issues.some(issue => ['screen-available', 'orientation-size'].includes(issue.code)));
  }
});

test('a null patch value returns the control to «as in preset» without touching its neighbours', () => {
  const full = applyDevicePatch(base, { cores: 8, gpu: 'intel-iris-xe', screen: '1920x1080', fonts: 'windows', diskGb: 512 }).configuration;
  const reset = applyDevicePatch(full, { cores: null, gpu: null, screen: null, fonts: null });
  for (const id of ['hardware-concurrency', 'webgl', 'webgl-capabilities', 'webgpu', 'screen-width', 'screen-geometry', 'css-media', 'canvas-font-policy']) assert.equal(reset.configuration.apis.find(row => row.id === id).mode, 'bypass', id);
  assert.equal(reset.configuration.apis.find(row => row.id === 'storage-estimate').mode, 'custom', 'the disk control was not part of the reset');
  assert.equal(reset.device.cores, null);
  assert.equal(reset.device.gpu, null);
});

test('language and time zone stay in step with Intl formatting and can be cleared', () => {
  const language = applyDevicePatch(base, { language: 'de-DE' }).configuration;
  assert.deepEqual(val(language, 'navigator-languages'), ['de-DE', 'de', 'en-US', 'en'], 'the Chrome-form list (ADR-107)');
  assert.equal(val(language, 'intl-formatting').locale, 'de-DE');
  const zoned = applyDevicePatch(language, { timezone: { timeZone: 'Europe/Berlin', offsetMinutes: -60 } }).configuration;
  assert.equal(val(zoned, 'timezone').timeZone, 'Europe/Berlin');
  assert.equal(val(zoned, 'intl-formatting').timeZone, 'Europe/Berlin', 'an existing Intl override follows the time zone');
  assert.equal(val(applyDevicePatch(base, { timezone: { timeZone: 'Asia/Tokyo', offsetMinutes: -540 } }).configuration, 'intl-formatting'), undefined, 'no Intl override is invented');
  const cleared = applyDevicePatch(zoned, { language: null, timezone: null }).configuration;
  assert.equal(cleared.apis.find(row => row.id === 'intl-formatting').mode, 'bypass');
  assert.equal(cleared.apis.find(row => row.id === 'navigator-language').mode, 'bypass');
  assert.equal(cleared.apis.find(row => row.id === 'timezone').mode, 'bypass');
  assert.throws(() => applyDevicePatch(base, { language: 'xx-YY' }), /invalid-value/);
  assert.throws(() => applyDevicePatch(base, { timezone: { offsetMinutes: 0 } }), /invalid-value/);
});

test('render switches are deterministic for a seed, portable and fully reversible', () => {
  const on = applyDevicePatch(base, { canvas: true, audio: true, webgl: true, seed: 99 });
  assert.deepEqual(ids(on), ['audio-fingerprint', 'canvas-readback', 'webgl-readback']);
  assert.deepEqual(applyDevicePatch(base, { canvas: true, audio: true, webgl: true, seed: 99 }).configuration, on.configuration);
  assert.match(val(on.configuration, 'audio-fingerprint').seed, /^[a-f0-9]{32}$/u);
  assert.equal(importApiConfiguration(exportApiConfiguration(on.configuration)).ok, true);
  const off = applyDevicePatch(on.configuration, { canvas: false, audio: false, webgl: false });
  assert.deepEqual(off.configuration.apis.filter(row => row.mode !== 'bypass').map(row => row.id), []);
});

test('an explicit page block is never cancelled by a level control', () => {
  const blocked = structuredClone(base);
  blocked.apis.find(row => row.id === 'webgl').mode = 'on';
  const result = applyDevicePatch(blocked, { gpu: 'amd-rx-6600' }).configuration;
  assert.equal(result.apis.find(row => row.id === 'webgl').mode, 'on');
});

test('malformed patches change nothing and never run accessors', () => {
  const before = structuredClone(base);
  for (const patch of [null, [], 'cores', { unknown: 1 }, { os: 'macos' }, { browser: 'firefox' }, { version: 99 }, { gpu: 'nope' }, { screen: '640x480' }, { fonts: 'macos' }, { canvas: 'yes' }, { diskGb: 100 }, { ramGb: 6 }])
    assert.throws(() => applyDevicePatch(base, patch), /invalid/, JSON.stringify(patch));
  let read = false;
  const accessor = {}; Object.defineProperty(accessor, 'cores', { enumerable: true, get() { read = true; return 8; } });
  assert.throws(() => applyDevicePatch(base, accessor), /invalid-value/);
  assert.equal(read, false, 'the getter was never invoked');
  assert.deepEqual(base, before, 'the input configuration is not mutated');
  assert.ok(DEVICE_PATCH_KEYS.includes('cores') && !DEVICE_PATCH_KEYS.includes('__proto__'));
});

test('describeDevice reads back what the Randomize generator produced', () => {
  const generated = generateConsistentDevice(base, { deviceType: 'laptop', os: 'windows-10', browser: 'edge', version: 142, seed: 21, protection: 'strict', language: 'ru-RU', timezone: { timeZone: 'Europe/Moscow', offsetMinutes: -180 } });
  const device = describeDevice(valueOf(generated.configuration));
  assert.equal(describeDevice(valueOf(generateConsistentDevice(base, { deviceType: 'laptop', seed: 21 }).configuration)).fonts, null, 'Balanced does not write the canvas font allow-list');
  assert.equal(device.os, 'windows-10');
  assert.equal(device.browser, 'edge');
  assert.equal(device.version, 142);
  assert.equal(device.gpu, generated.summary.gpu);
  assert.equal(device.screen, generated.summary.screen);
  assert.equal(device.cores, generated.summary.cores);
  assert.equal(device.reportedMemory, generated.summary.reportedMemory);
  assert.equal(device.diskGb, generated.summary.diskGb);
  assert.equal(device.fonts, 'windows');
  assert.equal(device.language, 'ru-RU');
  assert.equal(device.timezone.timeZone, 'Europe/Moscow');
  const empty = describeDevice(() => undefined);
  assert.ok(Object.values(empty).every(entry => entry === null), 'nothing is invented for an untouched configuration');
});

test('only the strict preset reports window metrics; compatibility and balanced leave them native', () => {
  const geometry = protection => generateConsistentDevice(base, { deviceType: 'desktop', protection, seed: 4 }).configuration.apis.find(row => row.id === 'screen-geometry').mode;
  assert.equal(geometry('compatibility'), 'bypass');
  assert.equal(geometry('balanced'), 'bypass');
  assert.equal(geometry('strict'), 'custom');
});

test('presets are complete statements: a lighter preset generated over a stronger one returns the extra rows to the browser', () => {
  const mode = (configuration, id) => configuration.apis.find(row => row.id === id).mode;
  const strict = generateConsistentDevice(base, { deviceType: 'desktop', protection: 'strict', seed: 4 }).configuration;
  // Strict also writes nine neutral sensor values (ADR-104 addendum 4); a lighter preset takes them back like the other Strict-only rows.
  const neutralRows = ['battery', 'network-information', 'performance-memory', 'bluetooth', 'usb', 'hid', 'serial', 'gamepads', 'speech-voices'];
  const strongOnly = ['canvas-text-metrics', 'webgl-readback', 'canvas-font-policy', 'screen-geometry', 'css-media', ...neutralRows], renderRows = ['canvas-readback', 'audio-fingerprint', 'math-transcendentals'];
  for (const id of [...strongOnly, ...renderRows]) assert.equal(mode(strict, id), 'custom', id + ' is part of Strict');
  const balanced = generateConsistentDevice(strict, { deviceType: 'desktop', protection: 'balanced', seed: 5 }).configuration;
  for (const id of strongOnly) assert.equal(mode(balanced, id), 'bypass', id + ' leaves with Strict');
  for (const id of renderRows) assert.equal(mode(balanced, id), 'custom', id + ' stays in Balanced');
  const compatibility = generateConsistentDevice(strict, { deviceType: 'desktop', protection: 'compatibility', seed: 6 }).configuration;
  for (const id of [...strongOnly, ...renderRows]) assert.equal(mode(compatibility, id), 'bypass', id + ' leaves with Balanced');
  assert.equal(mode(compatibility, 'hardware-concurrency'), 'custom', 'identity rows stay');
  const blocked = (() => { const copy = structuredClone(strict); copy.apis.find(row => row.id === 'webgl').mode = 'on'; return generateConsistentDevice(copy, { deviceType: 'desktop', protection: 'strict', seed: 7 }).configuration; })();
  assert.equal(mode(blocked, 'webgl'), 'on', 'an explicit page block is never cancelled');
});
