// ADR-107 (round 4, ShardBrowser comparison): the generator measured against THIS browser. Random choices respect the real
// machine (threads, window, memory, GPU family), language lists have Chrome's form, the version list reaches the real major,
// Chrome-shaped values (storage quota, heap class, clock step, PDF plugins) and the pure previews issueFix, retargetIdentityVersion
// and fitWindowTarget. Manual choices stay allowed and keep raising hints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration, validateApiConfiguration, validateApiValue } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, generateFingerprintConfiguration, applyDevicePatch, fingerprintProfileIssues, editFingerprintRow, retargetIdentityVersion, issueFix, fitWindowTarget, FIXABLE_ISSUES, FINGERPRINT_LANGUAGES, snapshotFingerprintProfile, storeFingerprintProfile, renameFingerprintProfile, zonePrincipalPoint } from '../../apps/production-extension/fingerprint-profiles.js';
import { buildDeviceValues, normalizeEnvironment, browserVersions, BROWSER_VERSION_MAX, BROWSER_VERSION_REACH, chromeLanguages, regionLocales, describeDevice, screenValues, BROWSER_CHROME_HEIGHTS, GPU_PRESETS, memoryBound, realGpuFamily, deviceMemoryBuckets, windowsTaskbar } from '../../apps/production-extension/fingerprint-device-presets.js';
import { regionCodes, regionByCode } from '../../apps/production-extension/fingerprint-region-data.js';

const base = createApiConfiguration();
const row = (configuration, id) => configuration.apis.find(entry => entry.id === id);
const val = (configuration, id) => { const found = row(configuration, id); return found?.mode === 'custom' && found.selected.kind === 'value' ? found.selected.value : undefined; };
const withRows = (rows, from = base) => rows.reduce((config, [id, value]) => editFingerprintRow(config, id, { mode: 'custom', selected: { kind: 'value', value } }), from);
const codes = (configuration, environment) => fingerprintProfileIssues(configuration, environment).map(issue => issue.code);
const raw = (values, id) => values.find(entry => entry.id === id)?.raw;
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const CHROME_156 = { uaMajor: 156, brand: 'chrome', platform: 'windows', platformVersion: '19.0.0', uaFullVersion: '156.0.8078.80',
  fullVersionList: [{ brand: 'Not:A-Brand', version: '8.0.0.0' }, { brand: 'Chromium', version: '156.0.8078.80' }, { brand: 'Google Chrome', version: '156.0.8078.80' }] };
const NVIDIA_GPU = { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 SUPER (0x00001E81) Direct3D11 vs_5_0 ps_5_0, D3D11)' };
const SWIFTSHADER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';

// --- the environment snapshot (interface 2) -------------------------------------------------------------------------------
test('normalizeEnvironment keeps the ADR-107 facts as bounded, frozen data and drops everything else', () => {
  const full = normalizeEnvironment({ deviceMemory: 32, jsHeapSizeLimit: 4395630592, pdfViewerEnabled: true, proxy: { state: 'connected' },
    gpu: { vendor: NVIDIA_GPU.vendor, renderer: NVIDIA_GPU.renderer, webgl2: true, caps: { MAX_TEXTURE_SIZE: 16384, MAX_VIEWPORT_DIMS: [32767, 32767], MAX_RENDERBUFFER_SIZE: 16384, MAX_SAMPLES: 16, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32, MAX_VERTEX_UNIFORM_VECTORS: 4096 },
      webgpu: { vendor: 'nvidia', architecture: 'turing', subgroupMinSize: 32, subgroupMaxSize: 32, isFallbackAdapter: false } } });
  assert.equal(full.deviceMemory, 32); assert.equal(full.jsHeapSizeLimit, 4395630592); assert.equal(full.pdfViewerEnabled, true); assert.deepEqual(full.proxy, { state: 'connected' });
  assert.deepEqual(full.gpu.caps.MAX_VIEWPORT_DIMS, [32767, 32767]); assert.equal(full.gpu.webgpu.architecture, 'turing'); assert.equal(full.gpu.webgl2, true);
  for (const part of [full, full.gpu, full.gpu.caps, full.gpu.caps.MAX_VIEWPORT_DIMS, full.gpu.webgpu, full.proxy]) assert.ok(Object.isFrozen(part));
  // null is a fact (no adapter), a missing or broken one is "not checked".
  assert.equal(normalizeEnvironment({ gpu: { vendor: 'x', webgpu: null } }).gpu.webgpu, null);
  for (const webgpu of [undefined, 'nvidia', 5, [], { subgroupMinSize: -1 }]) assert.equal(Object.hasOwn(normalizeEnvironment({ gpu: { vendor: 'x', webgpu } }).gpu, 'webgpu'), false, String(webgpu));
  const junk = normalizeEnvironment({ deviceMemory: '8', jsHeapSizeLimit: 1.5, pdfViewerEnabled: 'yes', proxy: { state: 'on' },
    gpu: { vendor: 'v'.repeat(513), renderer: '', webgl2: 'yes', caps: { MAX_TEXTURE_SIZE: 0, MAX_SAMPLES: 2 ** 21, MAX_VIEWPORT_DIMS: [1, 2, 3], MAX_RENDERBUFFER_SIZE: '16384', OTHER: 5 } } });
  assert.deepEqual(Object.keys(junk), [], 'nothing invalid survives: ' + JSON.stringify(junk));
  for (const memory of [0, -1, NaN, Infinity, 2048, null]) assert.equal(normalizeEnvironment({ deviceMemory: memory }).deviceMemory, undefined, String(memory));
  for (const memory of [0.25, 8, 32]) assert.equal(normalizeEnvironment({ deviceMemory: memory }).deviceMemory, memory);
  for (const state of ['connected', 'disconnected', 'conflict', 'unknown']) assert.equal(normalizeEnvironment({ proxy: { state } }).proxy.state, state);
  let read = false;
  const gpu = {}; Object.defineProperty(gpu, 'vendor', { enumerable: true, get() { read = true; return 'NVIDIA'; } });
  const environment = {}; Object.defineProperty(environment, 'deviceMemory', { enumerable: true, get() { read = true; return 8; } });
  assert.equal(normalizeEnvironment({ gpu }).gpu, undefined); assert.equal(normalizeEnvironment(environment).deviceMemory, undefined); assert.equal(read, false, 'accessors are never run');
});

// --- random picks respect THIS browser ------------------------------------------------------------------------------------
const WINDOWS = [[1920, 1032], [1536, 816], [2560, 1392], [1280, 672]], THREADS = [4, 8, 12, 16];
test('property: windows x threads x 2000 seeds x laptop/desktop: a Balanced draw never claims fewer threads or a smaller screen than this browser', () => {
  let draws = 0, native = 0;
  for (const [width, height] of WINDOWS) for (const threads of THREADS) for (const deviceType of ['laptop', 'desktop']) for (let seed = 0; seed < 2000; seed++) {
    const { values, summary } = buildDeviceValues({ deviceType, seed, geometry: false, environment: { outer: { width, height }, hardwareConcurrency: threads } });
    const cores = raw(values, 'hardware-concurrency'), screenWidth = raw(values, 'screen-width'), screenHeight = raw(values, 'screen-height');
    // The exact conditions of the rules cores-above-real and screen-vs-real.
    assert.ok(cores <= threads, `${width}x${height}/${threads}/${deviceType}/${seed}: ${cores} threads`);
    if (screenWidth === undefined) { native++; assert.equal(summary.screen, null); assert.equal(screenHeight, undefined); }
    else assert.ok(screenWidth >= width && screenHeight >= height, `${width}x${height}/${threads}/${deviceType}/${seed}: ${screenWidth}x${screenHeight}`);
    draws++;
  }
  assert.equal(draws, 64000);
  // Only a laptop cannot hold a 2560x1392 window (no laptop panel is that wide): those 8000 draws leave the screen native.
  assert.equal(native, 8000);
});

test('property, full pipeline: Balanced Randomize with this environment raises neither screen-vs-real nor cores-above-real', () => {
  for (const [width, height] of WINDOWS) for (const threads of THREADS) for (const deviceType of ['laptop', 'desktop']) for (let seed = 0; seed < 6; seed++) {
    const environment = { ...CHROME_156, outer: { width, height }, hardwareConcurrency: threads };
    const result = generateConsistentDevice(base, { deviceType, seed: seed * 7919, protection: 'balanced', environment });
    const raised = result.issues.map(issue => issue.code).filter(code => ['screen-vs-real', 'cores-above-real'].includes(code));
    assert.deepEqual(raised, [], `${width}x${height}/${threads}/${deviceType}/${seed}`);
  }
});

test('an environment that constrains nothing draws exactly the device of the same seed without one', () => {
  for (const deviceType of ['laptop', 'desktop']) for (let seed = 0; seed < 600; seed++) {
    const plain = buildDeviceValues({ deviceType, seed, geometry: false });
    const loose = buildDeviceValues({ deviceType, seed, geometry: false, environment: { hardwareConcurrency: 64, outer: { width: 640, height: 480 } } });
    assert.deepEqual(loose.values, plain.values, `${deviceType}/${seed}`);
  }
});

test('an environment changes only the draws that contradict it: a seed keeps its card and screen whenever they already fit', () => {
  const environment = { hardwareConcurrency: 16, outer: { width: 1920, height: 1032 } };
  let keptCards = 0, keptScreens = 0;
  for (const deviceType of ['laptop', 'desktop']) for (let seed = 0; seed < 1000; seed++) {
    const plain = buildDeviceValues({ deviceType, seed, geometry: false }).summary, real = buildDeviceValues({ deviceType, seed, geometry: false, environment }).summary;
    if (!GPU_PRESETS.find(card => card.id === plain.gpu).threads.some(count => count <= 16)) continue;
    assert.equal(real.gpu, plain.gpu, `${deviceType}/${seed}: a fitting card is kept`); keptCards++;
    if (plain.width >= 1920 && plain.height >= 1032) { assert.deepEqual([real.screen, real.scale], [plain.screen, plain.scale], `${deviceType}/${seed}: a fitting screen is kept`); keptScreens++; }
  }
  assert.ok(keptCards > 1900 && keptScreens > 1000, `${keptCards} cards, ${keptScreens} screens checked`);
});

test('a profile claiming a newer version than this browser stays editable; only a chosen version must be on this browser list', () => {
  const newer = applyDevicePatch(base, { os: 'windows-11', browser: 'chrome', version: 158 }, { uaMajor: 158 }).configuration;
  const edited = applyDevicePatch(newer, { cores: 8 }, CHROME_156);
  assert.equal(val(edited.configuration, 'hardware-concurrency'), 8); assert.equal(edited.device.version, 158);
  assert.throws(() => applyDevicePatch(newer, { version: 158 }, CHROME_156), /invalid-value/);
  assert.match(val(applyDevicePatch(newer, { version: 156 }, CHROME_156).configuration, 'navigator-user-agent'), /Chrome\/156\./u);
});

test('when no screen can hold the real window the screen stays native, and Randomize returns an earlier device screen to the browser', () => {
  const environment = { outer: { width: 2560, height: 1392 } };
  for (let seed = 0; seed < 50; seed++) assert.equal(buildDeviceValues({ deviceType: 'laptop', seed, geometry: false, environment }).summary.screen, null);
  const earlier = applyDevicePatch(base, { screen: '1920x1080', os: 'windows-11' }).configuration;
  const result = generateConsistentDevice(earlier, { deviceType: 'laptop', seed: 3, protection: 'balanced', environment });
  for (const id of ['screen-width', 'screen-height', 'screen-avail-width', 'window-device-pixel-ratio', 'screen-orientation']) assert.equal(row(result.configuration, id).mode, 'bypass', id);
  assert.ok(!result.issues.some(issue => issue.code === 'screen-vs-real'));
  // Strict writes the window geometry itself, so its screen is not limited by the real window.
  assert.notEqual(generateConsistentDevice(base, { deviceType: 'laptop', seed: 3, protection: 'strict', environment }).summary.screen, null);
});

test('manual choices are never filtered: a smaller screen or more threads stay, and the hints say so', () => {
  const environment = { ...CHROME_156, outer: { width: 1920, height: 1032 }, hardwareConcurrency: 4 };
  const result = generateConsistentDevice(base, { deviceType: 'laptop', seed: 1, screen: '1366x768', cores: 16, environment });
  assert.equal(val(result.configuration, 'screen-width'), 1366); assert.equal(val(result.configuration, 'hardware-concurrency'), 16);
  assert.ok(result.issues.some(issue => issue.code === 'screen-vs-real')); assert.ok(result.issues.some(issue => issue.code === 'cores-above-real'));
});

test('Randomize prefers cards of the real GPU vendor family, but the thread count wins, and a software GPU prefers nothing', () => {
  for (const [gpu, family] of [[NVIDIA_GPU, 'nvidia'], [{ vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6600)' }, 'amd'], [{ vendor: 'Google Inc. (Intel)' }, 'intel'], [{ webgpu: { vendor: 'nvidia', architecture: 'turing' } }, 'nvidia']]) {
    assert.equal(realGpuFamily(normalizeEnvironment({ gpu }).gpu), family);
    for (const deviceType of ['laptop', 'desktop']) for (let seed = 0; seed < 200; seed++) assert.equal(buildDeviceValues({ deviceType, seed, environment: { gpu } }).gpu.vendorFamily, family, `${family}/${deviceType}/${seed}`);
  }
  // A 4-thread laptop: no NVIDIA laptop card has 4 threads, so the fitting AMD and Intel cards are drawn.
  for (let seed = 0; seed < 200; seed++) { const { summary, gpu } = buildDeviceValues({ deviceType: 'laptop', seed, environment: { gpu: NVIDIA_GPU, hardwareConcurrency: 4 } }); assert.ok(summary.cores <= 4 && gpu.vendorFamily !== 'nvidia', String(seed)); }
  for (const software of [{ renderer: SWIFTSHADER }, { vendor: 'Google Inc. (NVIDIA)', webgpu: { vendor: 'nvidia', isFallbackAdapter: true } }, { vendor: 'Microsoft', renderer: 'Microsoft Basic Render Driver' }]) {
    assert.equal(realGpuFamily(normalizeEnvironment({ gpu: software }).gpu), null);
    for (let seed = 0; seed < 100; seed++) assert.equal(buildDeviceValues({ deviceType: 'desktop', seed, environment: { gpu: software } }).gpu.id, buildDeviceValues({ deviceType: 'desktop', seed }).gpu.id);
  }
});

test('a random RAM picture never reports more deviceMemory than this browser, where that value is an upper bound', () => {
  assert.equal(memoryBound({ deviceMemory: 8, uaMajor: 156 }), 8); assert.equal(memoryBound({ deviceMemory: 4 }), 4);
  assert.equal(memoryBound({ deviceMemory: 8, uaMajor: 140 }), undefined, 'Chrome before 147 reports 8 for every machine with 8 GB or more');
  assert.equal(memoryBound({ deviceMemory: 8 }), undefined); assert.equal(memoryBound({}), undefined);
  for (let seed = 0; seed < 300; seed++) for (const deviceType of ['laptop', 'desktop']) {
    const capped = buildDeviceValues({ deviceType, seed, environment: { deviceMemory: 8, uaMajor: 156 } });
    assert.ok(capped.summary.reportedMemory <= 8 && raw(capped.values, 'device-memory') === capped.summary.reportedMemory, `${deviceType}/${seed}`);
    assert.ok(deviceMemoryBuckets(capped.summary.version).includes(capped.summary.reportedMemory));
    assert.ok(buildDeviceValues({ deviceType, seed, version: 140, environment: { deviceMemory: 4 } }).summary.reportedMemory <= 4);
  }
  const chosen = generateConsistentDevice(base, { deviceType: 'desktop', seed: 2, ramGb: 32, version: 156, environment: { ...CHROME_156, deviceMemory: 8 } });
  assert.equal(val(chosen.configuration, 'device-memory'), 32, 'a chosen RAM size stays');
  assert.equal(chosen.issues.find(issue => issue.code === 'memory-above-real')?.severity, 'info');
});

// --- Chrome-form language lists -------------------------------------------------------------------------------------------
test('chromeLanguages: the locale, its base, then English; English locales keep only "en"; the region table list wins', () => {
  assert.deepEqual(chromeLanguages('de-DE'), ['de-DE', 'de', 'en-US', 'en']);
  assert.deepEqual(chromeLanguages('fr-CA'), ['fr-CA', 'fr', 'en-US', 'en'], 'not a region-table locale: the formula');
  assert.deepEqual(chromeLanguages('en-CA'), ['en-CA', 'en', 'fr-CA', 'fr'], 'the region table adds the second language');
  assert.deepEqual(chromeLanguages('en-IN'), ['en-IN', 'en', 'hi-IN', 'hi']);
  assert.deepEqual(chromeLanguages('en-GB'), ['en-GB', 'en']); assert.deepEqual(chromeLanguages('EN-us'), ['en-US', 'en']);
  assert.deepEqual(chromeLanguages('de'), ['de', 'en-US', 'en']); assert.deepEqual(chromeLanguages('en'), ['en']);
  for (const junk of ['', 'not a tag!', 'x'.repeat(65), 5, null, undefined, {}]) assert.equal(chromeLanguages(junk), null, String(junk));
  for (const code of regionCodes()) { const region = regionByCode(code); assert.deepEqual(chromeLanguages(region.locale), [...region.languages], code); }
  for (const locale of regionLocales()) { const list = chromeLanguages(locale); assert.equal(list[0], locale); assert.equal(new Set(list.map(tag => tag.toLowerCase())).size, list.length); }
});

test('the language control offers every region-table locale and writes the Chrome-form list on every path', () => {
  assert.deepEqual(FINGERPRINT_LANGUAGES.slice(0, 6), ['preserve', 'en-US', 'ru-RU', 'de-DE', 'fr-FR', 'ja-JP']);
  assert.ok(Object.isFrozen(FINGERPRINT_LANGUAGES) && new Set(FINGERPRINT_LANGUAGES).size === FINGERPRINT_LANGUAGES.length);
  for (const locale of regionLocales()) assert.ok(FINGERPRINT_LANGUAGES.includes(locale), locale);
  assert.equal(FINGERPRINT_LANGUAGES.length, 1 + regionLocales().length);
  assert.deepEqual(val(applyDevicePatch(base, { language: 'pt-BR' }).configuration, 'navigator-languages'), ['pt-BR', 'pt', 'en-US', 'en']);
  assert.deepEqual(val(generateConsistentDevice(base, { seed: 1, language: 'ko-KR' }).configuration, 'navigator-languages'), ['ko-KR', 'ko', 'en-US', 'en']);
  const chrome = { userAgent: WIN_UA, appVersion: WIN_UA.replace('Mozilla/', ''), platform: 'Win32', language: 'en-US', uaData: { brands: [{ brand: 'Chromium', version: '156' }], platform: 'Windows', mobile: false }, hasOscpu: false };
  assert.deepEqual(val(generateFingerprintConfiguration(base, { language: 'de-DE' }, chrome).configuration, 'navigator-languages'), ['de-DE', 'de', 'en-US', 'en']);
  assert.throws(() => applyDevicePatch(base, { language: 'xx-YY' }), /invalid-value/);
});

// --- versions -------------------------------------------------------------------------------------------------------------
test('the version list reaches up to the real major when this browser is newer, at most BROWSER_VERSION_REACH majors past the list', () => {
  assert.equal(BROWSER_VERSION_REACH, 24);
  assert.deepEqual(browserVersions().slice(0, 1), [BROWSER_VERSION_MAX]); assert.deepEqual(browserVersions({ uaMajor: 150 }), browserVersions());
  assert.equal(browserVersions({ uaMajor: 158 })[0], 158); assert.equal(browserVersions({ uaMajor: 158 }).length, browserVersions().length + 2);
  assert.equal(browserVersions({ uaMajor: BROWSER_VERSION_MAX + BROWSER_VERSION_REACH })[0], BROWSER_VERSION_MAX + BROWSER_VERSION_REACH);
  assert.deepEqual(browserVersions({ uaMajor: BROWSER_VERSION_MAX + BROWSER_VERSION_REACH + 1 }), browserVersions(), 'beyond the reach the major is not believed');
  assert.equal(browserVersions({ userAgent: WIN_UA.replace('156.', '159.') })[0], 159, 'the older snapshot shape works too');
  assert.throws(() => applyDevicePatch(base, { os: 'windows-11', browser: 'chrome', version: 158 }), /invalid-value/, 'without the environment 158 is not in the list');
  const newer = applyDevicePatch(base, { os: 'windows-11', browser: 'chrome', version: 158 }, { uaMajor: 158 });
  assert.match(val(newer.configuration, 'navigator-user-agent'), /Chrome\/158\.0\.0\.0/u); assert.equal(newer.device.version, 158);
  assert.equal(buildDeviceValues({ seed: 1, environment: { uaMajor: 158 } }).summary.version, 158, 'Randomize defaults to the real major');
});

test('retargetIdentityVersion rebuilds UA, appVersion and client hints for the real major and keeps OS and brand', () => {
  const claim = applyDevicePatch(base, { os: 'windows-10', browser: 'chrome', version: 150 }).configuration;
  assert.ok(codes(claim, CHROME_156).includes('engine-version'));
  const result = retargetIdentityVersion(claim, CHROME_156);
  assert.ok(result && result.changes.length > 0 && validateApiConfiguration(result.configuration).ok);
  assert.match(val(result.configuration, 'navigator-user-agent'), /Chrome\/156\.0\.0\.0 Safari\/537\.36$/u);
  const hints = val(result.configuration, 'client-hints');
  assert.equal(hints.uaFullVersion, '156.0.8078.80', 'the real build numbers for the same brand'); assert.equal(hints.platformVersion, '10.0.0', 'Windows 10 is kept');
  assert.ok(!codes(result.configuration, CHROME_156).includes('engine-version'));
  assert.equal(retargetIdentityVersion(result.configuration, CHROME_156), null, 'nothing left to change');
  const edge = retargetIdentityVersion(applyDevicePatch(base, { os: 'windows-11', browser: 'edge', version: 150 }).configuration, CHROME_156);
  assert.match(val(edge.configuration, 'navigator-user-agent'), /Edg\/156\.0\.0\.0$/u, 'the brand is kept');
  assert.equal(val(edge.configuration, 'client-hints').uaFullVersion, '156.0.0.0', 'another brand gets generic build numbers');
  const before = structuredClone(claim);
  for (const [configuration, environment] of [[base, CHROME_156], [claim, {}], [claim, { uaMajor: 999 }], [claim, { uaMajor: 100 }],
    [withRows([['navigator-user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36']]), CHROME_156]])
    assert.equal(retargetIdentityVersion(configuration, environment), null);
  assert.deepEqual(claim, before, 'the input is not mutated');
  assert.deepEqual(issueFix(claim, { code: 'engine-version', ids: [], severity: 'info' }, CHROME_156).configuration, result.configuration);
});

// --- issueFix and fitWindowTarget -----------------------------------------------------------------------------------------
const fixed = (configuration, code, environment) => { const preview = issueFix(configuration, code, environment); assert.ok(preview, code + ' has a fix'); assert.ok(!codes(preview.configuration, environment).includes(code), code + ' is gone after the fix'); return preview.configuration; };
test('issueFix repairs each mechanical code as a preview only, and refuses the rest', () => {
  assert.deepEqual([...FIXABLE_ISSUES], ['geolocation-timezone-mismatch', 'language-list', 'dpr-step', 'media-geometry', 'webgpu-missing', 'engine-version', 'storage-quota-shape', 'clock-precision-shape', 'proxy-country-region']);
  const geo = withRows([['timezone', { timeZone: 'Europe/Berlin', offsetMinutes: -60 }], ['geolocation', { latitude: 35.6762, longitude: 139.6503, accuracy: 100 }]]), before = structuredClone(geo);
  const berlin = zonePrincipalPoint('Europe/Berlin');
  assert.deepEqual(val(fixed(geo, 'geolocation-timezone-mismatch'), 'geolocation'), { latitude: berlin.latitude, longitude: berlin.longitude, accuracy: 100 });
  assert.deepEqual(geo, before, 'a preview never changes its input');
  assert.equal(issueFix(withRows([['timezone', { timeZone: 'UTC', offsetMinutes: 0 }], ['geolocation', { latitude: 1, longitude: 1, accuracy: 25 }]]), 'geolocation-timezone-mismatch'), null);
  assert.deepEqual(val(fixed(withRows([['navigator-language', 'de-DE'], ['navigator-languages', ['fr-FR']]]), 'language-list'), 'navigator-languages'), ['de-DE', 'de', 'en-US', 'en']);
  for (const [ratio, step] of [[1.3, 1.25], [1.4, 1.5], [1.375, 1.25], [2.2, 2], [3.5, 3], [0.9, 1]]) {
    const result = fixed(withRows([['window-device-pixel-ratio', ratio], ['css-media', { resolutionDppx: ratio }]]), 'dpr-step');
    assert.equal(val(result, 'window-device-pixel-ratio'), step, String(ratio)); assert.equal(val(result, 'css-media').resolutionDppx, step, 'the media resolution follows');
  }
  const media = fixed(withRows([['screen-geometry', { innerWidth: 1900, innerHeight: 900 }], ['window-device-pixel-ratio', 1.5], ['css-media', { viewportWidth: 1800, viewportHeight: 899, resolutionDppx: 1.25, colorScheme: 'dark' }]]), 'media-geometry');
  assert.deepEqual(val(media, 'css-media'), { viewportWidth: 1900, viewportHeight: 900, resolutionDppx: 1.5, colorScheme: 'dark' });
  const card = GPU_PRESETS.find(entry => entry.id === 'nvidia-rtx-3060');
  assert.deepEqual(val(fixed(withRows([['webgl', { ...card.webgl }]]), 'webgpu-missing'), 'webgpu'), { vendor: 'nvidia', architecture: 'ampere', device: '', description: '' });
  assert.equal(row(fixed(withRows([['navigator-user-agent', WIN_UA], ['storage-estimate', { quota: 1073741824, usage: 0 }]]), 'storage-quota-shape'), 'storage-estimate').mode, 'bypass');
  assert.deepEqual(val(fixed(withRows([['navigator-user-agent', WIN_UA], ['clock-precision', { resolutionMs: 1 }]]), 'clock-precision-shape'), 'clock-precision'), { resolutionMs: 0.1 });
  // Round 5: «Match region» writes the region rows of the proxy's own country tag; without that tag there is nothing to match.
  const abroad = withRows([['timezone', { timeZone: 'Asia/Tokyo', offsetMinutes: -540 }], ['navigator-language', 'ja-JP'], ['geolocation', { latitude: 35.6762, longitude: 139.6503, accuracy: 25 }]]), germany = { proxy: { state: 'connected', country: 'DE' } };
  const matched = fixed(abroad, 'proxy-country-region', germany);
  assert.equal(val(matched, 'timezone').timeZone, 'Europe/Berlin'); assert.equal(val(matched, 'navigator-language'), 'de-DE'); assert.ok(zonePrincipalPoint('Europe/Berlin') && val(matched, 'geolocation').latitude > 47 && val(matched, 'geolocation').latitude < 55);
  assert.equal(issueFix(abroad, 'proxy-country-region'), null, 'no country tag, nothing to match'); assert.equal(issueFix(abroad, 'proxy-country-region', { proxy: { state: 'connected', country: 'de' } }), null, 'the tag must be an uppercase code');
  for (const code of ['screen-shape', 'cores-above-real', 'unknown', '', null, 42, { code: 'nope' }]) assert.equal(issueFix(geo, code), null, String(code));
  assert.equal(issueFix(base, 'dpr-step'), null, 'nothing to repair'); assert.equal(issueFix(withRows([['window-device-pixel-ratio', 1.5]]), 'dpr-step'), null, 'already a step');
  // An explicit block is never cancelled by a fix.
  const blocked = structuredClone(withRows([['webgl', { ...card.webgl }]])); row(blocked, 'webgpu').mode = 'on';
  assert.ok(!codes(blocked).includes('webgpu-missing')); assert.equal(issueFix(blocked, 'webgpu-missing'), null);
});

test('fitWindowTarget: the claimed available screen, never more than the real one, one pixel lower; null when a size is unknown', () => {
  const claim = applyDevicePatch(base, { screen: '1536x864', os: 'windows-11' }).configuration;
  assert.deepEqual(fitWindowTarget(claim, { screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1032 } }), { width: 1536, height: 864 - windowsTaskbar('windows-11') - 1 });
  const large = applyDevicePatch(base, { screen: '2560x1440', os: 'windows-11' }).configuration;
  assert.deepEqual(fitWindowTarget(large, { screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1032 } }), { width: 1920, height: 1031 });
  assert.deepEqual(fitWindowTarget(withRows([['screen-width', 1600], ['screen-height', 900]]), { screen: { width: 1920, height: 1080 } }), { width: 1600, height: 899 }, 'screen size stands in for the available one');
  assert.equal(fitWindowTarget(base, { screen: { availWidth: 1920, availHeight: 1032 } }), null);
  assert.equal(fitWindowTarget(claim, {}), null); assert.equal(fitWindowTarget(claim, { outer: { width: 1920, height: 1032 } }), null);
});

test('a disk picture is read back only from the Disk control share; a Chrome-shaped quota (usage + 10 GiB) is not a disk', () => {
  const firefox = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0' };
  for (const diskGb of [512, 1024, 2048, 4096, 8192]) assert.equal(applyDevicePatch(base, { diskGb }, firefox).device.diskGb, diskGb);
  for (const usage of [0, 1048576, 104857600]) assert.equal(describeDevice(withRows([['storage-estimate', { quota: 10737418240 + usage, usage }]])).diskGb, null);
  assert.equal(describeDevice(withRows([['storage-estimate', { quota: 300 * 1024 ** 3, usage: 0 }]])).diskGb, null, 'not a share of a ladder step');
});

// --- per-brand window chrome, labels and the remaining ADR-107 hints ----------------------------------------------------------
test('the window geometry loses the measured tab strip of the claimed brand: Chrome 87 CSS px, Edge 84', () => {
  assert.deepEqual({ ...BROWSER_CHROME_HEIGHTS }, { chrome: 87, edge: 84 });
  const read = list => id => list.find(entry => entry.id === id)?.raw;
  for (const [browser, height] of [['chrome', 87], ['edge', 84], [undefined, 87]]) {
    const values = read(screenValues('2560x1440', 'windows-11', { scale: 1, ...(browser ? { browser } : {}) }));
    assert.equal(values('screen-geometry').outerHeight - values('screen-geometry').innerHeight, height, String(browser));
  }
  // Measured on Chrome 156: a 3840x2160 panel at 150 % gives a maximized window of 2560x1392 outer and 2560x1305 inner.
  assert.equal(read(screenValues('3840x2160', 'windows-11', { scale: 1.5, browser: 'chrome' }))('screen-geometry').innerHeight, 1305);
  const edge = generateConsistentDevice(base, { deviceType: 'desktop', browser: 'edge', protection: 'strict', seed: 5 }).configuration, geometry = val(edge, 'screen-geometry');
  assert.equal(geometry.outerHeight - geometry.innerHeight, 84); assert.ok(!codes(edge).includes('window-chrome'));
});

test('a Chromium claim on a non-Chromium or unknown host also reports Chrome vendor and no oscpu; a Chromium host gets no extra rows', () => {
  const firefox = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0' };
  for (const environment of [firefox, {}, undefined]) {
    const generated = generateConsistentDevice(base, { seed: 4, ...(environment ? { environment } : {}) }, environment ?? {}).configuration;
    const patched = applyDevicePatch(base, { os: 'windows-10', browser: 'chrome', version: 150 }, environment ?? {}).configuration;
    for (const configuration of [generated, patched]) {
      assert.equal(val(configuration, 'navigator-vendor'), 'Google Inc.', JSON.stringify(environment));
      assert.equal(row(configuration, 'navigator-oscpu').mode, 'custom'); assert.deepEqual(row(configuration, 'navigator-oscpu').selected, { kind: 'undefined' });
      assert.equal(validateApiConfiguration(configuration).ok, true);
    }
  }
  for (const environment of [CHROME_156, { uaMajor: 156, brand: 'edge' }, { userAgent: WIN_UA }]) {
    for (const configuration of [generateConsistentDevice(base, { seed: 4, environment }).configuration, applyDevicePatch(base, { os: 'windows-11', browser: 'edge', version: 150 }, environment).configuration])
      for (const id of ['navigator-vendor', 'navigator-oscpu']) assert.equal(row(configuration, id).mode, 'bypass', id + ' stays native on a Chromium host');
  }
  // Only identity changes write them, and an explicit page block on either row stays.
  assert.deepEqual(applyDevicePatch(base, { cores: 8 }, firefox).affected, ['hardware-concurrency']);
  const blocked = structuredClone(base); row(blocked, 'navigator-vendor').mode = 'on'; row(blocked, 'navigator-oscpu').mode = 'on';
  const kept = generateConsistentDevice(blocked, { seed: 4, environment: firefox }).configuration;
  assert.equal(row(kept, 'navigator-vendor').mode, 'on'); assert.equal(row(kept, 'navigator-oscpu').mode, 'on');
});

test('the remaining hints follow every state of their inputs', () => {
  for (const state of ['disconnected', 'conflict', 'unknown']) assert.ok(!codes(base, { proxy: { state } }).includes('proxy-locale-host'), state);
  const card = GPU_PRESETS.find(entry => entry.id === 'nvidia-rtx-3060'), claim = withRows([['webgl', { ...card.webgl }]]);
  assert.ok(codes(claim).includes('webgpu-missing')); assert.ok(!codes(claim, { gpu: { vendor: 'x', webgpu: null } }).includes('webgpu-missing'), 'no adapter here: nothing leaks');
  assert.ok(codes(withRows([['webgpu', { vendor: 'nvidia', architecture: 'ampere', device: '', description: '' }]]), { gpu: { vendor: 'x', webgpu: null } }).includes('real-gpu-webgpu'), 'the claimed adapter cannot appear');
  assert.ok(codes(claim, { gpu: { ...NVIDIA_GPU, webgpu: { vendor: 'nvidia', isFallbackAdapter: true } } }).includes('real-gpu-software'), 'a WebGPU fallback adapter is software');
  const plugins = withRows([['navigator-plugins', { plugins: [] }]]);
  assert.ok(codes(plugins, { pdfViewerEnabled: true }).includes('plugins-pdf')); assert.ok(!codes(plugins, { pdfViewerEnabled: false }).includes('plugins-pdf'));
  assert.ok(!codes(withRows([['navigator-metadata', { pdfViewerEnabled: false }]], plugins), { pdfViewerEnabled: true }).includes('plugins-pdf'), 'the Custom flag wins over this browser');
  assert.ok(codes(withRows([['device-memory', 8]]), { deviceMemory: 4 }).includes('memory-above-real'));
  assert.ok(!codes(withRows([['device-memory', 32]]), { deviceMemory: 8, uaMajor: 140 }).includes('memory-above-real'), 'an old Chrome 8 bounds nothing');
  const quota = withRows([['storage-estimate', { quota: 1073741824, usage: 0 }]]);
  assert.ok(codes(quota, { uaMajor: 156, brand: 'chrome' }).includes('storage-quota-shape'), 'without a claim this browser decides');
  assert.ok(!codes(quota, { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0' }).includes('storage-quota-shape'));
  assert.ok(codes(withRows([['clock-precision', { resolutionMs: 1 }]]), { uaMajor: 156 }).includes('clock-precision-shape'));
  // Generated profiles stay quiet about all of them when the environment matches.
  const environment = { ...CHROME_156, deviceMemory: 32, hardwareConcurrency: 32, outer: { width: 1280, height: 672 }, pdfViewerEnabled: true, gpu: { ...NVIDIA_GPU, webgpu: { vendor: 'nvidia', architecture: 'turing' } } };
  for (const protection of ['compatibility', 'balanced', 'strict']) for (let seed = 0; seed < 20; seed++) {
    const result = generateConsistentDevice(base, { deviceType: seed % 2 ? 'laptop' : 'desktop', protection, seed, region: 'US', language: 'en-US', environment });
    const loud = result.issues.filter(issue => !['screen-css', 'worker-scope', 'timezone-metadata', 'network-ua', 'network-language'].includes(issue.code)).map(issue => issue.code);
    assert.deepEqual(loud, [], `${protection}/${seed}`);
  }
});

test('library labels refuse control and bidirectional formatting characters with unsafe-label; stored ones keep working', () => {
  const char = code => String.fromCharCode(code), id = n => 'fp-' + n.toString(16).padStart(32, '0');
  for (const bad of ['a' + char(0x202e) + 'b', 'x' + char(0x7) + 'y', 'tab' + char(0x9) + 'name', 'c1' + char(0x85), 'lrm' + char(0x200e), 'iso' + char(0x2066) + 'x', 'alm' + char(0x61c)])
    assert.throws(() => snapshotFingerprintProfile(base, bad, id(1)), error => error.code === 'unsafe-label', JSON.stringify(bad));
  const stored = storeFingerprintProfile(base, snapshotFingerprintProfile(base, 'Ordinary', id(2)));
  assert.throws(() => renameFingerprintProfile(stored, id(2), 'New' + char(0x202d)), error => error.code === 'unsafe-label');
  assert.equal(renameFingerprintProfile(stored, id(2), 'Renamed').fingerprintProfiles[0].label, 'Renamed');
  const crafted = { ...snapshotFingerprintProfile(base, 'Ok', id(3)), label: 'Evil' + char(0x202e) };
  assert.throws(() => storeFingerprintProfile(base, crafted), error => error.code === 'unsafe-label');
  // A label stored by an older build still loads; only new or renamed labels are checked.
  const legacy = structuredClone(stored); legacy.fingerprintProfiles[0].label = 'Old' + char(0x202e);
  assert.equal(validateApiConfiguration(legacy).ok, true);
  assert.equal(renameFingerprintProfile(legacy, id(2), 'Fixed').fingerprintProfiles[0].label, 'Fixed');
});
