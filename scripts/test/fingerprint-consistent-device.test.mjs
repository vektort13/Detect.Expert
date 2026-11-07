// ADR-104: the consistent-device generator must produce an internally consistent, valid,
// honest reported profile. No contradiction issues, deviceMemory clamped, UA↔UA-CH↔platform
// agree, GPU↔WebGL agree, and every value stays inside the existing validated domains.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration, validateApiConfiguration, exportApiConfiguration, importApiConfiguration, API_CUSTOM_ONLY_IDS } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, applyDevicePatch } from '../../apps/production-extension/fingerprint-profiles.js';
import { DEVICE_TYPES, DEVICE_OS, DEVICE_BROWSERS, browserVersions, GPU_PRESETS, gpusFor, reportedDeviceMemory, RAM_STEPS, STRICT_BLOCK_ONLY } from '../../apps/production-extension/fingerprint-device-presets.js';

const base = createApiConfiguration();
const CONTRADICTIONS = ['platform-agent', 'client-hints-agent', 'language-list', 'screen-available', 'screen-depth', 'orientation-size', 'gpu-pair', 'memory-bucket'];
const val = (configuration, id) => { const row = configuration.apis.find(a => a.id === id); return row?.mode === 'custom' && row.selected.kind === 'value' ? row.selected.value : undefined; };

test('every device/os/browser combination yields a valid configuration with no contradiction issues', () => {
  for (const deviceType of DEVICE_TYPES) for (const os of DEVICE_OS) for (const browser of DEVICE_BROWSERS) {
    const result = generateConsistentDevice(base, { deviceType, os, browser, version: browserVersions()[0], seed: 5, language: 'en-US', timezone: { timeZone: 'America/New_York', offsetMinutes: 300 } });
    const checked = validateApiConfiguration(result.configuration);
    assert.equal(checked.ok, true, `${deviceType}/${os}/${browser}: ${JSON.stringify(checked.error)}`);
    const flagged = result.issues.map(issue => issue.code).filter(code => CONTRADICTIONS.includes(code));
    assert.deepEqual(flagged, [], `${deviceType}/${os}/${browser} contradictions: ${flagged.join(',')}`);
  }
});

test('reported deviceMemory is a bucket of the claimed Chrome major (147+ reports 2/4/8/16/32, older at most 8)', () => {
  for (const ramGb of RAM_STEPS) {
    assert.ok([2, 4, 8, 16, 32].includes(reportedDeviceMemory(ramGb, 153)), 'new Chrome bucket for ' + ramGb);
    const old = reportedDeviceMemory(ramGb, 140);
    assert.ok([0.5, 1, 2, 4, 8].includes(old) && old <= 8, 'old Chrome never reports above 8');
  }
  assert.deepEqual(RAM_STEPS.map(gb => reportedDeviceMemory(gb, 153)), [4, 8, 16, 32, 32, 32]);
  assert.equal(val(generateConsistentDevice(base, { deviceType: 'desktop', ramGb: 128, seed: 1, version: 153 }).configuration, 'device-memory'), 32);
  assert.equal(val(generateConsistentDevice(base, { deviceType: 'desktop', ramGb: 128, seed: 1, version: 140 }).configuration, 'device-memory'), 8);
});

test('Randomize leaves the storage quota "as in the browser": Chrome reports usage + 10 GiB whatever the disk is, so even a chosen disk is not written', () => {
  // ADR-107 (measured on Chrome 156): every device the generator builds is a Chromium claim, so the quota stays native.
  for (const diskGb of [undefined, 512, 1024, 8192]) {
    const result = generateConsistentDevice(base, { deviceType: 'desktop', seed: 1, ...(diskGb ? { diskGb } : {}) });
    assert.equal(val(result.configuration, 'storage-estimate'), undefined, String(diskGb));
    assert.equal(result.configuration.apis.find(row => row.id === 'storage-estimate').mode, 'bypass');
    assert.equal(result.summary.diskGb, null);
  }
});

test('the Disk control writes a quota share (never the disk itself) only for a non-Chromium identity; for a Chromium one it returns the quota to native', () => {
  const firefox = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0' };
  const storage = val(applyDevicePatch(base, { diskGb: 8192 }, firefox).configuration, 'storage-estimate');
  assert.equal(typeof storage.quota, 'number'); assert.equal(storage.usage, 0);
  // 8 TiB pictured capacity must NOT be reported verbatim as the quota.
  assert.ok(storage.quota < 8192 * 1024 * 1024 * 1024, 'quota is a fraction, not the disk');
  // A Chrome claim (or, without a claim, a real Chrome) keeps the quota native, and an earlier share goes back.
  const written = applyDevicePatch(base, { diskGb: 1024 }, firefox).configuration;
  const chrome = { uaMajor: 156, brand: 'chrome', platform: 'windows' };
  assert.equal(applyDevicePatch(written, { diskGb: 2048 }, chrome).configuration.apis.find(row => row.id === 'storage-estimate').mode, 'bypass');
  const claimed = applyDevicePatch(written, { os: 'windows-11', browser: 'edge', version: 150, diskGb: 2048 }, firefox).configuration;
  assert.equal(val(claimed, 'storage-estimate'), undefined, 'the identity of this same patch decides');
  assert.throws(() => applyDevicePatch(base, { diskGb: 100 }, chrome), /invalid-value/, 'a value off the ladder is still refused');
});

test('UA, UA-CH and platform agree with the chosen browser and OS', () => {
  const chrome = generateConsistentDevice(base, { deviceType: 'laptop', os: 'windows-10', browser: 'chrome', version: 140, seed: 2 }).configuration;
  const edge = generateConsistentDevice(base, { deviceType: 'desktop', os: 'windows-11', browser: 'edge', version: 140, seed: 2 }).configuration;
  assert.match(val(chrome, 'navigator-user-agent'), /Chrome\/140\.0\.0\.0 Safari\/537\.36$/);
  assert.doesNotMatch(val(chrome, 'navigator-user-agent'), /Edg\//);
  assert.match(val(edge, 'navigator-user-agent'), /Edg\/140\.0\.0\.0$/);
  assert.equal(val(chrome, 'navigator-platform'), 'Win32');
  assert.equal(val(edge, 'navigator-platform'), 'Win32');
  const chromeHints = val(chrome, 'client-hints'), edgeHints = val(edge, 'client-hints');
  assert.ok(chromeHints.brands.some(b => b.brand === 'Google Chrome'));
  assert.ok(!chromeHints.brands.some(b => b.brand === 'Microsoft Edge'));
  assert.ok(edgeHints.brands.some(b => b.brand === 'Microsoft Edge'));
  assert.equal(chromeHints.platformVersion, '10.0.0');
  // Windows 11 default is 19.0.0 (measured on Chrome 156 / Edge 156, build 26200); it used to be 15.0.0 (23H2).
  assert.equal(edgeHints.platformVersion, '19.0.0');
  assert.equal(edgeHints.platform, 'Windows');
});

test('GPU and WebGL agree: the reported renderer is a catalogue GPU valid for the device type', () => {
  for (const deviceType of DEVICE_TYPES) {
    const result = generateConsistentDevice(base, { deviceType, seed: 9 });
    const webgl = val(result.configuration, 'webgl');
    const match = GPU_PRESETS.find(g => g.webgl.unmaskedRenderer === webgl.unmaskedRenderer);
    assert.ok(match, 'renderer is from the catalogue');
    assert.ok(match.types.includes(deviceType), `${match.id} is valid for ${deviceType}`);
    assert.ok(val(result.configuration, 'webgl-capabilities'), 'capabilities are set alongside the renderer');
    assert.equal(result.summary.gpu, match.id);
  }
});

test('protection presets: compatibility is identity-only, balanced adds render protection, strict reports neutral sensor values', () => {
  const compat = generateConsistentDevice(base, { deviceType: 'desktop', protection: 'compatibility', seed: 3 }).configuration;
  const balanced = generateConsistentDevice(base, { deviceType: 'desktop', protection: 'balanced', seed: 3 }).configuration;
  const strict = generateConsistentDevice(base, { deviceType: 'desktop', protection: 'strict', seed: 3 }).configuration;
  assert.equal(val(compat, 'math-transcendentals'), undefined, 'compatibility leaves Math native');
  assert.equal(val(compat, 'audio-fingerprint'), undefined, 'compatibility leaves Audio native');
  assert.ok(val(balanced, 'math-transcendentals'), 'balanced protects Math');
  assert.ok(val(balanced, 'audio-fingerprint'), 'balanced protects Audio');
  // ADR-104 addendum 4: Strict reports neutral Custom values (see fingerprint-strict-neutral.test.mjs); the only blocks left are the
  // three rows that have no Custom shape in the contract.
  assert.deepEqual(strict.apis.filter(a => a.mode === 'on').map(a => a.id).sort(), [...STRICT_BLOCK_ONLY].sort(), 'strict blocks only the rows without a Custom shape');
  for (const id of ['battery', 'network-information', 'performance-memory', 'bluetooth', 'usb', 'hid', 'serial', 'gamepads', 'speech-voices']) assert.equal(strict.apis.find(a => a.id === id).mode, 'custom', id + ' is neutral Custom, not a block');
  assert.equal(balanced.apis.filter(a => a.mode === 'on').length, 0, 'balanced blocks nothing');
});

test('generation is deterministic for a seed and portable through export/import', () => {
  const options = { deviceType: 'laptop', os: 'windows-11', browser: 'chrome', version: 145, seed: 123456, language: 'de-DE', timezone: { timeZone: 'Europe/Berlin', offsetMinutes: -60 } };
  const a = generateConsistentDevice(base, options).configuration;
  const b = generateConsistentDevice(base, options).configuration;
  assert.deepEqual(a, b, 'same seed and options reproduce the same device');
  const imported = importApiConfiguration(exportApiConfiguration(a));
  assert.equal(imported.ok, true, imported.error?.message);
  assert.deepEqual(imported.value.apis, a.apis, 'the generated device survives a portable JSON round-trip');
});

test('an out-of-range or missing browser version falls back to the newest supported version', () => {
  const newest = browserVersions()[0];
  for (const version of [1, 999, undefined, 'abc']) {
    const result = generateConsistentDevice(base, { browser: 'chrome', version, seed: 1 });
    assert.equal(result.summary.version, newest);
    assert.match(val(result.configuration, 'navigator-user-agent'), new RegExp(`Chrome\\/${newest}\\.`));
  }
});

test('generation never blocks a Custom-only API and respects an explicit page block', () => {
  // A pre-existing explicit block (mode on) on a blockable API must survive generation.
  const withBlock = structuredClone(base);
  withBlock.apis.find(a => a.id === 'audio').mode = 'on';
  const result = generateConsistentDevice(withBlock, { deviceType: 'desktop', protection: 'balanced', seed: 7 }).configuration;
  assert.equal(result.apis.find(a => a.id === 'audio').mode, 'on', 'explicit audio block is preserved');
  // Custom-only ids are never switched to the block mode by generation.
  for (const id of API_CUSTOM_ONLY_IDS) assert.notEqual(result.apis.find(a => a.id === id)?.mode, 'on', `${id} not blocked`);
});
