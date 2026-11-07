import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration, updateApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';
import { compileFingerprintEngineProfile as compile, FINGERPRINT_ENGINE_NATIVE_FEATURES, FINGERPRINT_ENGINE_LIMITS } from '../../apps/production-extension/fingerprint-engine-profile.js';

const base = () => ({ ...createApiConfiguration(), antidetectEnabled: true });
function custom(config, id, value, host = null) {
  const result = updateApiConfiguration(config, id, { mode: 'custom', selected: { kind: value === null ? 'null' : value === undefined ? 'undefined' : 'value', ...(value !== null && value !== undefined ? { value } : {}) } }, host);
  assert.equal(result.ok, true, result.error?.message); return result.value;
}
function plan(rows) { let config = base(); for (const [id, value] of rows) config = custom(config, id, value); const result = compile(config); assert.equal(result.ok, true, result.error?.code); return result; }
const command = (result, method) => result.commands.find(item => item.method === method);

test('disabled masters, off/bypass and disabled exact sites do not start an engine plan', () => {
  let config = custom(base(), 'hardware-concurrency', 3);
  assert.equal(compile({ ...config, antidetectEnabled: false }).status, 'empty');
  const off = updateApiConfiguration(config, 'hardware-concurrency', { mode: 'off' }).value;
  assert.equal(compile(off).commands.length, 0);
  config = custom(config, 'hardware-concurrency', 6, 'qa.example'); config.sites[0].disabled = true;
  assert.equal(compile(config, { host: 'qa.example' }).status, 'empty');
  assert.equal(command(compile(config, { host: 'other.example' }), 'Emulation.setHardwareConcurrencyOverride').params.hardwareConcurrency, 3);
});

test('site inheritance is exact and does not put host, site libraries or labels into the plan', () => {
  let config = custom(base(), 'hardware-concurrency', 3);
  config = custom(config, 'hardware-concurrency', 7, 'qa.example');
  assert.equal(command(compile(config, { host: 'qa.example' }), 'Emulation.setHardwareConcurrencyOverride').params.hardwareConcurrency, 7);
  assert.equal(command(compile(config, { host: 'sub.qa.example' }), 'Emulation.setHardwareConcurrencyOverride').params.hardwareConcurrency, 3);
  assert.equal(JSON.stringify(compile(config, { host: 'qa.example' })).includes('qa.example'), false);
});

test('invalid configuration and accessor options fail without invoking the getter', () => {
  let reads = 0; const options = Object.defineProperty({}, 'host', { get() { reads++; throw Error('no'); } });
  assert.equal(compile(base(), options).error.code, 'invalid-options'); assert.equal(reads, 0);
  assert.equal(compile(base(), { host: 'https://qa.example/path' }).error.code, 'invalid-host');
  assert.equal(compile(base(), { host: 'UPPER.example' }).error.code, 'invalid-host');
  assert.equal(compile({}).error.code, 'invalid-configuration');
  const config = base(); Object.defineProperty(config, 'antidetectEnabled', { get() { reads++; throw Error('no'); } });
  assert.equal(compile(config).error.code, 'invalid-configuration'); assert.equal(reads, 0);
});

test('metrics compile genuine viewport, DPR, screen and orientation with a single fixed command', () => {
  const result = plan([['screen-geometry', { innerWidth: 960, innerHeight: 640 }], ['css-media', { viewportWidth: 960, viewportHeight: 640, resolutionDppx: 1.5 }], ['window-device-pixel-ratio', 1.5], ['screen-width', 1440], ['screen-height', 900], ['screen-orientation', { type: 'landscape-primary', angle: 0 }]]);
  assert.equal(result.status, 'ready');
  assert.deepEqual(command(result, 'Emulation.setDeviceMetricsOverride').params, { width: 960, height: 640, deviceScaleFactor: 1.5, mobile: false, screenWidth: 1440, screenHeight: 900, screenOrientation: { type: 'landscapePrimary', angle: 0 } });
  assert.equal(result.resetCommands[0].method, 'Emulation.clearDeviceMetricsOverride');
});

test('native zero sentinels preserve unselected viewport and DPR without reading the browser', () => {
  const result = plan([['screen-width', 1440], ['screen-height', 900]]);
  assert.deepEqual(command(result, 'Emulation.setDeviceMetricsOverride').params, { width: 0, height: 0, deviceScaleFactor: 0, mobile: false, screenWidth: 1440, screenHeight: 900 });
  const dpr = plan([['window-device-pixel-ratio', 2]]);
  assert.deepEqual(command(dpr, 'Emulation.setDeviceMetricsOverride').params, { width: 0, height: 0, deviceScaleFactor: 2, mobile: false });
});

test('selected viewport/screen pixel areas obey a 64Mi-pixel budget including selected DPR', () => {
  let config = custom(base(), 'css-media', { viewportWidth: 4096, viewportHeight: 4096, resolutionDppx: 2 });
  assert.equal(compile(config).ok, true, 'exact boundary');
  config = custom(config, 'css-media', { viewportWidth: 4097, viewportHeight: 4096, resolutionDppx: 2 });
  assert.equal(compile(config).error.code, 'engine-pixel-budget');
  config = custom(custom(base(), 'screen-width', 32768), 'screen-height', 32768);
  assert.equal(compile(config).error.code, 'engine-pixel-budget');
  assert.equal(compile(custom(base(), 'window-device-pixel-ratio', 16)).ok, true, 'unselected size is not sampled or invented');
});

test('conflicting viewport/DPR sources and incomplete pairs fail instead of silently preferring metadata', () => {
  for (const rows of [
    [['screen-geometry', { innerWidth: 900, innerHeight: 600 }], ['css-media', { viewportWidth: 901, viewportHeight: 600 }]],
    [['window-device-pixel-ratio', 1.5], ['css-media', { resolutionDppx: 2 }]],
  ]) { let config = base(); for (const [id, value] of rows) config = custom(config, id, value); assert.equal(compile(config).error.code, 'conflicting-values'); }
  assert.equal(compile(custom(base(), 'css-media', { viewportWidth: 900 })).error.code, 'incomplete-viewport');
  assert.equal(compile(custom(base(), 'screen-width', 1440)).error.code, 'incomplete-screen');
});

test('only the five measured media features reach native CDP and unsupported fields stay explicit', () => {
  const result = plan([['css-media', { colorScheme: 'dark', reducedMotion: 'reduce', contrast: 'more', forcedColors: 'active', colorGamut: 'p3', hover: 'none', pointer: 'coarse', dynamicRange: 'high', grid: false }]]);
  assert.equal(result.status, 'partial');
  assert.deepEqual(command(result, 'Emulation.setEmulatedMedia').params.features.map(item => item.name), ['prefers-color-scheme', 'prefers-reduced-motion', 'prefers-contrast', 'forced-colors', 'color-gamut']);
  assert.deepEqual(new Set(result.unsupported[0].fields), new Set(['hover', 'pointer', 'dynamicRange', 'grid']));
  assert.equal(FINGERPRINT_ENGINE_NATIVE_FEATURES.pointer, false);
});

test('native IANA zone is canonical, fixed legacy offset is explicit partial and conflicts reject', () => {
  const result = plan([['timezone', { timeZone: 'asia/tokyo', offsetMinutes: -540 }], ['intl-formatting', { timeZone: 'Asia/Tokyo', locale: 'fr-FR', calendar: 'gregory' }]]);
  assert.equal(command(result, 'Emulation.setTimezoneOverride').params.timezoneId, 'Asia/Tokyo');
  assert.equal(command(result, 'Emulation.setLocaleOverride').params.locale, 'fr-FR');
  assert.deepEqual(result.unsupported.find(item => item.id === 'timezone'), { id: 'timezone', fields: ['offsetMinutes'], reason: 'fixed-offset-is-not-native-timezone' });
  assert.deepEqual(result.unsupported.find(item => item.id === 'intl-formatting').fields, ['calendar']);
  let config = custom(base(), 'timezone', { timeZone: 'Asia/Tokyo', offsetMinutes: -540 });
  config = custom(config, 'intl-formatting', { timeZone: 'UTC' }); assert.equal(compile(config).error.code, 'conflicting-values');
});

test('UA headers change only with explicitly selected UA; auxiliary identity fields alone stay unsupported', () => {
  const selected = [['navigator-language', 'fr-FR'], ['navigator-languages', ['fr-FR', 'fr']], ['navigator-platform', 'Linux x86_64']];
  const without = plan(selected); assert.equal(without.commands.length, 0); assert.equal(without.status, 'partial');
  const withUa = plan([['navigator-user-agent', 'Selected QA Browser/1.0'], ...selected]);
  assert.deepEqual(command(withUa, 'Emulation.setUserAgentOverride').params, { userAgent: 'Selected QA Browser/1.0', platform: 'Linux x86_64', acceptLanguage: 'fr-FR,fr' });
  assert.deepEqual(withUa.resetCommands.find(item => item.method === 'Emulation.setUserAgentOverride'), { method: 'Emulation.setUserAgentOverride', params: { userAgent: '' } });
  assert.equal(without.resetCommands.some(item => item.method === 'Emulation.setUserAgentOverride'), false);
  let config = custom(base(), 'navigator-language', 'de-DE'); config = custom(config, 'navigator-languages', ['fr-FR']);
  assert.equal(compile(config).error.code, 'conflicting-values');
  config = custom(base(), 'navigator-user-agent', 'selected\r\nunsafe'); assert.equal(compile(config).error.code, 'invalid-user-agent');
  config = custom(base(), 'navigator-user-agent', 'Selected QA/1'); config = custom(config, 'navigator-platform', 'unsafe\r\nplatform');
  assert.equal(compile(config).error.code, 'invalid-user-agent-metadata');
});

test('client hints are forwarded only with explicit UA and complete required CDP metadata', () => {
  const hints = { brands: [{ brand: 'Selected QA', version: '1' }], mobile: false, platform: 'Linux' };
  const incomplete = plan([['navigator-user-agent', 'Selected QA/1'], ['client-hints', hints]]);
  assert.equal(own(command(incomplete, 'Emulation.setUserAgentOverride').params, 'userAgentMetadata'), false);
  assert.equal(incomplete.unsupported.find(item => item.id === 'client-hints').reason, 'incomplete-native-user-agent-metadata');
  const complete = { ...hints, platformVersion: '1', architecture: 'x86', model: '', uaFullVersion: '1.2.3.4' };
  const result = plan([['navigator-user-agent', 'Selected QA/1'], ['client-hints', complete]]);
  const metadata = command(result, 'Emulation.setUserAgentOverride').params.userAgentMetadata;
  assert.equal(metadata.fullVersion, '1.2.3.4'); assert.equal(own(metadata, 'uaFullVersion'), false); assert.equal(result.status, 'ready');
});
const own = (value, key) => Object.hasOwn(value, key);

test('unhandled geometry, CSS parser selections, null values and unrelated APIs are never declared applied', () => {
  const result = plan([['screen-geometry', { outerWidth: 1400, outerHeight: 900, screenX: 0 }], ['css-supports', { queries: [{ query: '(invented: yes)', supported: true }] }], ['webgpu', null], ['device-memory', 8]]);
  assert.equal(result.commands.length, 0); assert.equal(result.status, 'partial');
  assert.deepEqual(new Set(result.unsupported.map(item => item.id)), new Set(['screen-geometry', 'css-supports', 'webgpu', 'device-memory']));
  assert.deepEqual(result.handledIds, []);
});

test('plans are bounded, immutable copies and contain no arbitrary protocol/evaluate/automation commands', () => {
  let config = base();
  for (const [id, value] of [['css-media', { colorScheme: 'dark', viewportWidth: 960, viewportHeight: 640 }], ['intl-formatting', { locale: 'fr-FR', timeZone: 'America/New_York' }], ['hardware-concurrency', 3], ['navigator-user-agent', 'Selected QA/1']]) config = custom(config, id, value);
  const result = compile(config); assert.equal(result.ok, true);
  assert.ok(result.commands.length <= FINGERPRINT_ENGINE_LIMITS.maxCommands); assert.ok(result.resetCommands.length <= FINGERPRINT_ENGINE_LIMITS.maxResetCommands);
  assert.equal(Object.isFrozen(result.commands[0].params), true);
  assert.throws(() => { result.commands[0].params.width = 1; }, TypeError);
  config.apis.find(item => item.id === 'hardware-concurrency').selected.value = 99;
  assert.equal(command(result, 'Emulation.setHardwareConcurrencyOverride').params.hardwareConcurrency, 3);
  assert.equal(JSON.stringify(result).includes('Runtime.evaluate'), false); assert.equal(JSON.stringify(result).includes('setAutomationOverride'), false);
  assert.deepEqual(result.lifecycle, { ownedTabOnly: true, detachRequired: true, closeOwnedTarget: true, hardwareConcurrencyReset: 'detach', userAgentReset: 'close-owned-target', outerGeometryRestored: false });
});
