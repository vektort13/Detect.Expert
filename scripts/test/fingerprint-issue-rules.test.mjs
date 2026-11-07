// Coherence rules of fingerprintProfileIssues: read-only hints, each needs the rows it compares. Table-driven per code
// (positive and negative) plus a sweep proving the generator itself raises none of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration, API_CONFIG_CATALOG } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, fingerprintProfileIssues, editFingerprintRow, FINGERPRINT_ISSUES, FINGERPRINT_ISSUE_CODES } from '../../apps/production-extension/fingerprint-profiles.js';
import { DEVICE_TYPES, DEVICE_OS, DEVICE_BROWSERS, WINDOWS_SCALES, WEBGPU_ARCHITECTURES, buildDeviceValues, browserVersions, GPU_PRESETS } from '../../apps/production-extension/fingerprint-device-presets.js';
import { regionCodes } from '../../apps/production-extension/fingerprint-region-data.js';

const OLD = ['platform-agent', 'client-hints-agent', 'language-list', 'screen-available', 'screen-depth', 'orientation-size', 'gpu-pair', 'memory-bucket', 'timezone-metadata', 'network-ua', 'network-language', 'screen-css', 'worker-scope'];
const NEW = ['dpr-step', 'window-bounds', 'window-chrome', 'media-geometry', 'touch-range', 'touch-media', 'screen-shape', 'color-depth', 'gpu-os', 'gpu-shape', 'webgpu-gpu', 'host-os', 'engine-version', 'cores-above-real', 'screen-vs-real', 'webrtc-shape', 'geolocation-timezone-mismatch',
  'memory-above-real', 'language-timezone', 'proxy-locale-host', 'webgpu-missing', 'real-gpu-software', 'real-gpu-limits', 'real-gpu-vendor', 'real-gpu-webgpu',
  'storage-quota-shape', 'plugins-pdf', 'clock-precision-shape', 'proxy-country-region'];
const INFO = new Set(['host-os', 'engine-version', 'memory-above-real', 'language-timezone', 'proxy-locale-host', 'real-gpu-vendor', 'real-gpu-webgpu']);
// Notes that come with any generated profile (rows exist, a zone is set, an environment is given): not contradictions.
const STANDING = new Set(['screen-css', 'worker-scope', 'timezone-metadata', 'network-ua', 'network-language']);
const withRows = rows => rows.reduce((config, [id, value]) => editFingerprintRow(config, id, { mode: 'custom', selected: { kind: 'value', value } }), createApiConfiguration());
const issuesOf = (rows, environment) => fingerprintProfileIssues(withRows(rows), environment);
const has = (code, rows, environment) => issuesOf(rows, environment).some(issue => issue.code === code);
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const webgl = (unmaskedVendor, unmaskedRenderer) => ['webgl', { vendor: 'WebKit', renderer: 'WebKit WebGL', unmaskedVendor, unmaskedRenderer }];
const webgpu = (vendor, architecture, device = '', description = '') => ['webgpu', { vendor, architecture, device, description }];
const CARD = GPU_PRESETS.find(entry => entry.id === 'nvidia-rtx-3060');
const rtc = (ipv4, ipv6 = { host: null, stun: null, turn: null }) => ['webrtc', { addresses: { ipv4, ipv6 }, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session' }];
const place = (latitude, longitude) => ({ latitude, longitude, accuracy: 25 });
const BERLIN = ['timezone', { timeZone: 'Europe/Berlin', offsetMinutes: -60 }];
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0';
const SWIFTSHADER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
const AMD = GPU_PRESETS.find(entry => entry.id === 'amd-rx-6600'), INTEL = GPU_PRESETS.find(entry => entry.id === 'intel-uhd-630');
// The five PDF viewer plugins Chrome lists (catalogue 8 preset of navigator-plugins).
const PDF_PLUGINS = API_CONFIG_CATALOG.find(entry => entry.id === 'navigator-plugins').presets[0].value.value.plugins;
const GEOMETRY_OK = [['screen-width', 1920], ['screen-height', 1080], ['screen-avail-width', 1920], ['screen-avail-height', 1032],
  ['screen-geometry', { innerWidth: 1920, outerWidth: 1920, innerHeight: 945, outerHeight: 1032, screenX: 0, screenY: 0 }]];

test('FINGERPRINT_ISSUE_CODES lists every old and new code once and the old export is unchanged', () => {
  assert.ok(Object.isFrozen(FINGERPRINT_ISSUE_CODES) && Object.isFrozen(FINGERPRINT_ISSUES));
  assert.deepEqual([...FINGERPRINT_ISSUES], OLD);
  assert.deepEqual([...FINGERPRINT_ISSUE_CODES], [...OLD, ...NEW]);
  assert.equal(new Set(FINGERPRINT_ISSUE_CODES).size, 42);
});

// [code, positive scenarios, negative scenarios, environment]; a scenario is a list of rows.
const CASES = [
  ['dpr-step', [[['window-device-pixel-ratio', 1.3]], [['window-device-pixel-ratio', 1.1]], [['window-device-pixel-ratio', 4]]], [...WINDOWS_SCALES.map(scale => [['window-device-pixel-ratio', scale]]), []]],
  ['window-bounds', [
    [['screen-geometry', { innerWidth: 1900, outerWidth: 1800 }]],
    [['screen-avail-height', 1040], ['screen-geometry', { outerHeight: 1080 }]],
    [['screen-height', 1000], ['screen-geometry', { outerHeight: 1100 }]],
    [['screen-geometry', { innerHeight: 1100, outerHeight: 900 }]],
    [['screen-width', 1920], ['screen-geometry', { screenX: 1920 }]], [['screen-geometry', { screenY: -1 }]], [['screen-height', 1080], ['screen-geometry', { screenY: 1080 }]]],
  [GEOMETRY_OK, [['screen-geometry', { innerWidth: 800, outerWidth: 900 }]], [['screen-width', 1920], ['screen-geometry', { screenX: 1919 }]], [['screen-geometry', { screenX: 0, screenY: 0 }]], []]],
  ['window-chrome', [[['screen-geometry', { innerHeight: 1000, outerHeight: 1040 }]], [['screen-geometry', { innerHeight: 1000, outerHeight: 1079 }]], [['screen-geometry', { innerHeight: 1000, outerHeight: 1000 }]]],
    [[['screen-geometry', { innerHeight: 1000, outerHeight: 1080 }]], [['screen-geometry', { innerHeight: 945, outerHeight: 1032 }]], [['screen-geometry', { innerWidth: 800 }]], []]],
  ['media-geometry', [
    [['screen-geometry', { innerWidth: 1900 }], ['css-media', { viewportWidth: 1800 }]], [['screen-geometry', { innerHeight: 900 }], ['css-media', { viewportHeight: 899 }]],
    [['window-device-pixel-ratio', 1.5], ['css-media', { resolutionDppx: 1.25 }]]],
  [[['screen-geometry', { innerWidth: 1900, innerHeight: 900 }], ['css-media', { viewportWidth: 1900, viewportHeight: 900 }]], [['window-device-pixel-ratio', 1.5], ['css-media', { resolutionDppx: 1.5 }]],
    [['css-media', { viewportWidth: 1800 }]], [['css-media', { resolutionDppx: 1.25 }]], [['screen-geometry', { innerWidth: 1900 }]], []]],
  ['touch-range', [[['touch-points', 11]], [['touch-points', 256]]], [[['touch-points', 10]], [['touch-points', 0]], []]],
  ['touch-media', [[['touch-points', 5], ['css-media', { anyPointer: 'fine' }]], [['touch-points', 1], ['css-media', { anyPointer: 'none' }]], [['touch-points', 0], ['css-media', { anyPointer: 'coarse' }]]],
    [[['touch-points', 5], ['css-media', { anyPointer: 'coarse' }]], [['touch-points', 0], ['css-media', { anyPointer: 'fine' }]], [['touch-points', 5]], [['touch-points', 5], ['css-media', { pointer: 'fine' }]], [['css-media', { anyPointer: 'coarse' }]]]],
  ['screen-shape', [[['screen-width', 1080], ['screen-height', 1920]], [['screen-width', 800], ['screen-height', 450]], [['screen-width', 1366], ['screen-height', 599]], [['screen-width', 1023]]],
    [[['screen-width', 1366], ['screen-height', 768]], [['screen-width', 1024], ['screen-height', 600]], [['screen-width', 1920], ['screen-height', 1080]], [['screen-width', 1280]], []]],
  ['color-depth', [[['screen-color-depth', 16], ['screen-pixel-depth', 16]], [['screen-color-depth', 32]], [['screen-pixel-depth', 8]]], [[['screen-color-depth', 24], ['screen-pixel-depth', 24]], [['screen-color-depth', 30], ['screen-pixel-depth', 30]], []]],
  ['gpu-os', [
    [['navigator-user-agent', WIN_UA], webgl('Google Inc. (Google)', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')],
    [['navigator-user-agent', WIN_UA], webgl('Mesa', 'llvmpipe (LLVM 15.0.7, 256 bits)')],
    [['navigator-user-agent', WIN_UA], webgl('Microsoft', 'Microsoft Basic Render Driver')],
    [['navigator-user-agent', WIN_UA], webgl('Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D9Ex vs_3_0 ps_3_0, D3D9Ex)')],
    [['navigator-user-agent', WIN_UA], webgl('Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)')],
    [['navigator-platform', 'Win32'], webgl('Mesa', 'Mesa DRI Intel')]],
  [[['navigator-user-agent', WIN_UA], webgl(CARD.webgl.unmaskedVendor, CARD.webgl.unmaskedRenderer)], [['navigator-user-agent', MAC_UA], webgl('Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)')],
    [['navigator-user-agent', WIN_UA], webgl('Google Inc.', '')], [webgl('Mesa', 'llvmpipe')], []]],
  ['gpu-shape', [[webgpu('nvidia', '')], [webgpu('amd', 'turing')], [webgpu('intel', 'gen-99')], [webgpu('nvidia', 'turing', '0x2503')], [webgpu('intel', 'gen-12lp', '', 'Intel Iris Xe Graphics')], [webgpu('apple', '')]],
    [[webgpu('nvidia', 'turing')], [webgpu('amd', 'rdna-2')], [webgpu('intel', 'xe-lpg')], [webgpu('apple', 'common-3')], []]],
  ['webgpu-gpu', [[webgl('Google Inc. (NVIDIA)', CARD.webgl.unmaskedRenderer), webgpu('amd', 'rdna-2')], [webgl('Google Inc.', 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)'), webgpu('nvidia', 'turing')]],
    [[webgl(CARD.webgl.unmaskedVendor, CARD.webgl.unmaskedRenderer), webgpu('nvidia', 'ampere')], [webgl('Google Inc.', 'something'), webgpu('amd', 'rdna-2')], [webgl(CARD.webgl.unmaskedVendor, CARD.webgl.unmaskedRenderer), webgpu('qualcomm', 'adreno')], [webgpu('amd', 'rdna-2')], []]],
  ['host-os', [[['navigator-user-agent', WIN_UA]], [['navigator-platform', 'Win32']], [['client-hints', { brands: [{ brand: 'Chromium', version: '156' }], mobile: false, platform: 'Windows' }]]], [[['navigator-user-agent', MAC_UA]], [['navigator-platform', 'MacIntel']], []], { platform: 'mac' }],
  ['engine-version', [[['navigator-user-agent', WIN_UA.replace('156.', '150.')]], [['client-hints', { brands: [{ brand: 'Chromium', version: '150' }], mobile: false, platform: 'Windows' }]]], [[['navigator-user-agent', WIN_UA]], []], { uaMajor: 156 }],
  ['cores-above-real', [[['hardware-concurrency', 16]], [['hardware-concurrency', 9]]], [[['hardware-concurrency', 8]], [['hardware-concurrency', 4]], []], { hardwareConcurrency: 8 }],
  ['screen-vs-real', [[['screen-width', 1536], ['screen-height', 864]], [['screen-width', 1920], ['screen-height', 1000]], [['screen-width', 1440]]],
    [[['screen-width', 1920], ['screen-height', 1080]], [['screen-width', 2560], ['screen-height', 1440]], [...GEOMETRY_OK.slice(0, 4), ['screen-width', 1536], ['screen-height', 864], GEOMETRY_OK[4]], []], { outer: { width: 1920, height: 1080 } }],
  ['webrtc-shape', [[rtc({ host: null, stun: '198.51.100.10', turn: null })], [rtc({ host: null, stun: null, turn: null }, { host: null, stun: null, turn: '2001:db8::30' })]],
    [[rtc({ host: '192.0.2.10', stun: '198.51.100.10', turn: null })], [rtc({ host: null, stun: null, turn: null })], [rtc({ host: null, stun: '198.51.100.10', turn: null }, { host: '2001:db8::10', stun: null, turn: null })], []]],
  // Coordinates more than 2500 km from the principal point of the selected zone (the `timezone` row, else the zone of `intl-formatting`).
  ['geolocation-timezone-mismatch', [
    [BERLIN, ['geolocation', place(35.6762, 139.6503)]], [['timezone', { timeZone: 'Asia/Tokyo', offsetMinutes: -540 }], ['geolocation', place(40.7128, -74.006)]],
    [['intl-formatting', { timeZone: 'Europe/London' }], ['geolocation', place(-33.8688, 151.2093)]]],
  [[BERLIN, ['geolocation', place(52.52, 13.405)]], [BERLIN, ['geolocation', place(48.8566, 2.3522)]], [BERLIN, ['geolocation', place(55.7558, 37.6173)]], [['geolocation', place(35.6762, 139.6503)]], [BERLIN],
    [['timezone', { timeZone: 'UTC', offsetMinutes: 0 }], ['geolocation', place(35.6762, 139.6503)]], []]],
  // --- ADR-107 rules ---
  ['memory-above-real', [[['device-memory', 16]], [['device-memory', 32]]], [[['device-memory', 8]], [['device-memory', 4]], []], { deviceMemory: 8, uaMajor: 156 }],
  ['language-timezone', [[['navigator-language', 'fr-FR'], BERLIN], [['navigator-language', 'de-DE'], ['timezone', { timeZone: 'America/New_York', offsetMinutes: 300 }]], [['navigator-language', 'ja-JP'], ['intl-formatting', { timeZone: 'Europe/Paris' }]]],
    [[['navigator-language', 'de-AT'], BERLIN], [['navigator-language', 'en-GB'], BERLIN], [['navigator-language', 'fr-CA'], ['timezone', { timeZone: 'America/Toronto', offsetMinutes: 300 }]], [['navigator-language', 'fr-FR']], [BERLIN],
      [['navigator-language', 'fr-FR'], ['timezone', { timeZone: 'UTC', offsetMinutes: 0 }]], []]],
  ['proxy-locale-host', [[], [['navigator-language', 'de-DE'], ['intl-formatting', { locale: 'de-DE' }]], [BERLIN, ['intl-formatting', { locale: 'de-DE', timeZone: 'Europe/Berlin' }]], [BERLIN, ['navigator-language', 'de-DE']]],
    [[BERLIN, ['navigator-language', 'de-DE'], ['intl-formatting', { locale: 'de-DE', timeZone: 'Europe/Berlin' }]], [['navigator-languages', ['de-DE', 'de']], ['intl-formatting', { locale: 'de-DE', timeZone: 'Europe/Berlin' }]]], { proxy: { state: 'connected' } }],
  ['webgpu-missing', [[webgl(CARD.webgl.unmaskedVendor, CARD.webgl.unmaskedRenderer)]], [[webgl(CARD.webgl.unmaskedVendor, CARD.webgl.unmaskedRenderer), webgpu('nvidia', 'ampere')], [webgl('Google Inc.', 'something')], [webgpu('nvidia', 'ampere')], []]],
  ['real-gpu-software', [[webgl(CARD.webgl.unmaskedVendor, CARD.webgl.unmaskedRenderer)]], [[webgl('Google Inc. (Google)', SWIFTSHADER)], [webgl('Google Inc.', '')], []], { gpu: { vendor: 'Google Inc. (Google)', renderer: SWIFTSHADER } }],
  ['real-gpu-limits', [[['webgl-capabilities', { parameters: { MAX_TEXTURE_SIZE: 16384 } }]], [['webgl-capabilities', { parameters: { MAX_VIEWPORT_DIMS: [16384, 8192] } }]]],
    [[['webgl-capabilities', { parameters: { MAX_TEXTURE_SIZE: 8192 } }]], [['webgl-capabilities', { parameters: { MAX_VERTEX_ATTRIBS: 16 } }]], [['webgl-capabilities', { parameters: { MAX_VIEWPORT_DIMS: [8192, 8192] } }]], []],
    { gpu: { vendor: 'Google Inc. (Intel)', renderer: INTEL.webgl.unmaskedRenderer, caps: { MAX_TEXTURE_SIZE: 8192, MAX_VIEWPORT_DIMS: [8192, 8192], MAX_RENDERBUFFER_SIZE: 8192 } } }],
  ['real-gpu-vendor', [[webgl(AMD.webgl.unmaskedVendor, AMD.webgl.unmaskedRenderer)], [webgl(INTEL.webgl.unmaskedVendor, INTEL.webgl.unmaskedRenderer)]],
    [[webgl(CARD.webgl.unmaskedVendor, CARD.webgl.unmaskedRenderer)], [webgl('Google Inc.', 'something')], []], { gpu: { vendor: 'Google Inc. (NVIDIA)', renderer: CARD.webgl.unmaskedRenderer } }],
  ['real-gpu-webgpu', [[webgpu('amd', 'rdna-2')], [webgpu('intel', 'gen-12lp')]], [[webgpu('nvidia', 'ampere')], [webgl(CARD.webgl.unmaskedVendor, CARD.webgl.unmaskedRenderer)], []],
    { gpu: { vendor: 'Google Inc. (NVIDIA)', webgpu: { vendor: 'nvidia', architecture: 'turing', subgroupMinSize: 32, subgroupMaxSize: 32, isFallbackAdapter: false } } }],
  ['storage-quota-shape', [[['navigator-user-agent', WIN_UA], ['storage-estimate', { quota: 1073741824, usage: 0 }]], [['navigator-user-agent', WIN_UA], ['storage-estimate', { quota: 10737418240, usage: 1048576 }]]],
    [[['navigator-user-agent', WIN_UA], ['storage-estimate', { quota: 10737418240 + 1048576, usage: 1048576 }]], [['navigator-user-agent', FIREFOX_UA], ['storage-estimate', { quota: 1073741824, usage: 0 }]], [['storage-estimate', { quota: 1073741824, usage: 0 }]], []]],
  ['plugins-pdf', [[['navigator-plugins', { plugins: [] }], ['navigator-metadata', { pdfViewerEnabled: true }]], [['navigator-plugins', { plugins: PDF_PLUGINS }], ['navigator-metadata', { pdfViewerEnabled: false }]]],
    [[['navigator-plugins', { plugins: [] }], ['navigator-metadata', { pdfViewerEnabled: false }]], [['navigator-plugins', { plugins: PDF_PLUGINS }], ['navigator-metadata', { pdfViewerEnabled: true }]], [['navigator-plugins', { plugins: [] }]], [['navigator-metadata', { pdfViewerEnabled: true }]], []]],
  ['clock-precision-shape', [[['navigator-user-agent', WIN_UA], ['clock-precision', { resolutionMs: 1 }]], [['navigator-user-agent', WIN_UA], ['clock-precision', { resolutionMs: 10 }]], [['navigator-user-agent', WIN_UA], ['clock-precision', { resolutionMs: 0.5 }]]],
    [[['navigator-user-agent', WIN_UA], ['clock-precision', { resolutionMs: 0.1 }]], [['navigator-user-agent', FIREFOX_UA], ['clock-precision', { resolutionMs: 1 }]], [['clock-precision', { resolutionMs: 1 }]], []]],
  // Round 5: the user's own country tag of the proxy (here Germany) against the zone, the coordinates and the language the rows imply. The harness checks the
  // warning form; the information-only form (language alone) has its own test in fingerprint-proxy-region.test.mjs.
  ['proxy-country-region', [[['timezone', { timeZone: 'Asia/Tokyo', offsetMinutes: -540 }]], [['geolocation', place(35.6762, 139.6503)]], [['intl-formatting', { timeZone: 'America/New_York' }]], [BERLIN, ['geolocation', place(40.7128, -74.006)]]],
    [[BERLIN], [['geolocation', place(52.52, 13.405)]], [['geolocation', place(48.1351, 11.582)]], [['timezone', { timeZone: 'Europe/Busingen', offsetMinutes: -60 }]], [['timezone', { timeZone: 'UTC', offsetMinutes: 0 }]], [['navigator-language', 'de-DE']], [['navigator-language', 'en-US']], []],
    { proxy: { state: 'connected', country: 'DE' } }],
];

for (const [code, positives, negatives, environment] of CASES) {
  test(`${code}: raised for each positive scenario, silent for each negative one`, () => {
    assert.ok(NEW.includes(code));
    positives.forEach((rows, index) => {
      const found = issuesOf(rows, environment).find(issue => issue.code === code);
      assert.ok(found, `positive #${index} ${JSON.stringify(rows).slice(0, 160)}`);
      assert.equal(found.severity, INFO.has(code) ? 'info' : 'warning', code + ' severity');
      assert.ok(Array.isArray(found.ids), code + ' lists the rows it concerns');
    });
    negatives.forEach((rows, index) => assert.ok(!has(code, rows, environment), `negative #${index} ${JSON.stringify(rows).slice(0, 160)}`));
    // Rules that need the real browser stay silent without it; the rest do not depend on it.
    if (environment) for (const rows of positives) assert.ok(!has(code, rows, {}), code + ' needs the environment');
    else for (const rows of positives) assert.ok(has(code, rows, { uaMajor: 156, platform: 'windows' }), code + ' does not depend on the environment');
  });
}

test('the host rules read the older environment snapshot too, and any code returned is a known one', () => {
  const legacy = { userAgent: WIN_UA, platform: 'MacIntel', uaData: { brands: [{ brand: 'Google Chrome', version: '150' }], platform: 'macOS' } };
  assert.ok(has('host-os', [['navigator-user-agent', WIN_UA]], legacy));
  assert.ok(has('engine-version', [['navigator-user-agent', WIN_UA.replace('156.', '150.')]], { userAgent: WIN_UA }));
  assert.ok(!has('engine-version', [['navigator-user-agent', WIN_UA]], { userAgent: WIN_UA }));
  for (const [rows, environment] of [[GEOMETRY_OK, {}], [[['hardware-concurrency', 16]], { hardwareConcurrency: 4 }], [[['navigator-user-agent', MAC_UA]], legacy]])
    for (const issue of issuesOf(rows, environment)) assert.ok(FINGERPRINT_ISSUE_CODES.includes(issue.code), issue.code);
  // Environment values that are not plain data are ignored (and never invoked).
  let read = false;
  const accessor = {}; Object.defineProperty(accessor, 'hardwareConcurrency', { enumerable: true, get() { read = true; return 1; } });
  assert.ok(!has('cores-above-real', [['hardware-concurrency', 16]], accessor)); assert.equal(read, false);
  for (const junk of [null, 5, 'x', [], { hardwareConcurrency: '4' }]) assert.ok(!has('cores-above-real', [['hardware-concurrency', 16]], junk), String(junk));
});

test('the rules never change the configuration they read', () => {
  const config = withRows([...GEOMETRY_OK, ['navigator-user-agent', WIN_UA], ['hardware-concurrency', 16], webgpu('nvidia', ''), ['touch-points', 12]]);
  const before = structuredClone(config);
  const issues = fingerprintProfileIssues(config, { hardwareConcurrency: 4, outer: { width: 3000, height: 2000 }, platform: 'mac', uaMajor: 100 });
  assert.deepEqual(config, before);
  for (const code of ['cores-above-real', 'gpu-shape', 'touch-range', 'host-os']) assert.ok(issues.some(issue => issue.code === code), code);
  assert.equal(new Set(issues.map(issue => issue.code)).size, issues.length, 'one entry per code');
});

test('the WebGPU vocabulary is the Dawn one (nvidia, amd, intel) and the vocabulary check follows it', () => {
  assert.deepEqual(Object.keys(WEBGPU_ARCHITECTURES), ['nvidia', 'amd', 'intel']);
  for (const [vendor, names] of Object.entries(WEBGPU_ARCHITECTURES)) for (const name of names) assert.ok(!has('gpu-shape', [webgpu(vendor, name)]), `${vendor}/${name}`);
});

const FLAGS = ['compatibility', 'balanced', 'strict'];
const unexpected = issues => issues.filter(issue => !STANDING.has(issue.code)).map(issue => issue.code + '(' + issue.severity + ')');
test('sweep: 5,000 seeds x device type x Windows x browser x protection raise no contradiction, with and without a matching environment', () => {
  const combos = DEVICE_TYPES.flatMap(deviceType => DEVICE_OS.flatMap(os => DEVICE_BROWSERS.flatMap(browser => FLAGS.map(protection => ({ deviceType, os, browser, protection })))));
  assert.equal(combos.length, 24);
  const versions = browserVersions();
  for (let seed = 0; seed < 5000; seed++) {
    const combo = combos[seed % combos.length], version = versions[(seed * 7) % versions.length], strict = combo.protection === 'strict';
    const { values } = buildDeviceValues({ ...combo, version, seed, geometry: strict, fonts: strict });
    const config = createApiConfiguration();
    for (const { id, raw } of values) { const row = config.apis.find(entry => entry.id === id); row.mode = 'custom'; row.selected = { kind: 'value', value: raw }; }
    // The same rows the real generator writes, evaluated by the validating issue function (which also rejects any invalid value).
    const environment = seed % 2 ? { uaMajor: version, brand: combo.browser, platform: 'windows', hardwareConcurrency: 32, outer: { width: 1000, height: 600 } } : undefined;
    const found = unexpected(fingerprintProfileIssues(config, environment));
    assert.deepEqual(found, [], `seed ${seed} ${JSON.stringify(combo)} v${version}${environment ? ' with environment' : ''}`);
  }
});

test('sweep: the full generator pipeline (600 profiles over all 24 combinations, each with another region) raises no contradiction either', () => {
  const base = createApiConfiguration(), versions = browserVersions(), regions = regionCodes();
  let index = 0;
  for (const deviceType of DEVICE_TYPES) for (const os of DEVICE_OS) for (const browser of DEVICE_BROWSERS) for (const protection of FLAGS) for (let round = 0; round < 25; round++, index++) {
    const version = versions[(index * 5) % versions.length], seed = index * 2654435761 >>> 0;
    const environment = round % 2 ? { uaMajor: version, brand: browser, platform: 'windows', hardwareConcurrency: 32, outer: { width: 1000, height: 600 } } : undefined;
    // A region adds the zone, the language pair and the default-city geolocation: none of them may contradict the rest.
    const region = regions[(index * 7) % regions.length];
    const result = generateConsistentDevice(base, { deviceType, os, browser, version, protection, seed, region, ...(environment ? { environment } : {}) });
    assert.deepEqual(unexpected(result.issues), [], `${deviceType}/${os}/${browser}/${protection}/${version}/${seed}/${region}`);
  }
});
