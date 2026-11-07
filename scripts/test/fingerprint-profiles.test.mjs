// E22-19 / ADR-066: generator, full-profile library and cross-surface consistency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { API_CONFIG_CATALOG, createApiConfiguration, updateApiConfiguration, exportApiConfiguration, importApiConfiguration, effectiveApiConfiguration, validateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { generateFingerprintConfiguration, snapshotFingerprintProfile, storeFingerprintProfile, applyFingerprintProfile, deleteFingerprintProfile, renameFingerprintProfile, fingerprintProfileIssues, editFingerprintRow } from '../../apps/production-extension/fingerprint-profiles.js';
import { windowsFonts } from '../../apps/production-extension/fingerprint-font-groups.js';
const copy = value => structuredClone(value), id = n => 'fp-' + n.toString(16).padStart(32, '0');
const chrome = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', appVersion: '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', platform: 'Win32', vendor: 'Google Inc.', language: 'en-US', uaData: { brands: [{ brand: 'Chromium', version: '153' }, { brand: 'Not_A Brand', version: '99' }], platform: 'Windows', mobile: false }, hasOscpu: false };
const firefox = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0', appVersion: '5.0 (Windows)', platform: 'Win32', vendor: '', language: 'en-US', uaData: null, hasOscpu: true };
const row = (config, name) => config.apis.find(api => api.id === name);
function selected(config, name, value) { return editFingerprintRow(config, name, { mode: 'custom', selected: { kind: 'value', value } }); }

test('every recipe preserves master, exact-site overrides, existing libraries and native network policy', () => {
  let base = createApiConfiguration();
  base.webrtcNetworkPolicy = 'default_public_interface_only';
  base = updateApiConfiguration(base, 'hardware-concurrency', { userValues: [{ id: 'previous', label: 'Previous', value: { kind: 'value', value: 7 } }] }, null).value;
  base = updateApiConfiguration(base, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 3 } }, 'exact.fixture.invalid').value;
  const before = copy(base);
  for (const recipe of ['balanced', 'laptop', 'desktop', 'workstation', 'strict']) {
    const generated = generateFingerprintConfiguration(base, { recipe, variant: 1 }, chrome);
    assert.equal(generated.configuration.enabled, false); assert.equal(generated.configuration.antidetectEnabled, false); assert.deepEqual(generated.configuration.sites, base.sites);
    assert.deepEqual(row(generated.configuration, 'hardware-concurrency').userValues, row(base, 'hardware-concurrency').userValues);
    assert.equal(generated.configuration.webrtcNetworkPolicy, base.webrtcNetworkPolicy);
    assert.ok(generated.affected.includes('canvas-readback')); assert.ok(generated.affected.includes('webrtc'));
    assert.deepEqual(row(generated.configuration, 'canvas-readback').selected.value, { algorithm: 'stable-rgb-v1' });
    assert.deepEqual(row(generated.configuration, 'navigator-user-agent'), row(base, 'navigator-user-agent'));
    assert.deepEqual(row(generated.configuration, 'webgl').selected, row(base, 'webgl').selected);
    assert.equal(row(generated.configuration, 'webgl').mode, recipe === 'strict' ? 'on' : row(base, 'webgl').mode);
    assert.deepEqual(row(generated.configuration, 'timezone'), row(base, 'timezone'));
  }
  assert.deepEqual(base, before);
});

test('modern desktop, old desktop and Android recipes use their actual memory bucket ranges', () => {
  for (const [environment, expected] of [[chrome, 32], [{ ...chrome, userAgent: chrome.userAgent.replace('153.', '146.') }, 8], [{ ...chrome, userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/153.0.0.0 Mobile Safari/537.36' }, 8]]) {
    const generated = generateFingerprintConfiguration(createApiConfiguration(), { recipe: 'workstation' }, environment).configuration;
    assert.equal(row(generated, 'device-memory').selected.value, expected);
    assert.equal(fingerprintProfileIssues(generated, environment).some(issue => issue.code === 'memory-bucket'), false);
    if (environment.userAgent.includes('Android')) assert.equal(row(generated, 'touch-points').mode, 'bypass');
  }
});

test('OS simulation retains true engine/version, GREASE brands and Firefox appVersion shape', () => {
  const generated = generateFingerprintConfiguration(createApiConfiguration(), { system: 'macos' }, chrome).configuration;
  assert.match(row(generated, 'navigator-user-agent').selected.value, /Chrome\/153\.0\.0\.0/);
  assert.match(row(generated, 'navigator-user-agent').selected.value, /Macintosh; Intel Mac OS X 10_15_7/);
  assert.equal(row(generated, 'navigator-platform').selected.value, 'MacIntel');
  assert.deepEqual(row(generated, 'client-hints').selected.value.brands, chrome.uaData.brands);
  assert.equal(row(generated, 'client-hints').selected.value.platform, 'macOS');
  assert.ok(fingerprintProfileIssues(generated, chrome).some(issue => issue.code === 'network-ua'));
  const ff = generateFingerprintConfiguration(createApiConfiguration(), { system: 'linux' }, firefox).configuration;
  assert.match(row(ff, 'navigator-user-agent').selected.value, /X11; Linux x86_64; rv:138\.0/);
  assert.match(row(ff, 'navigator-user-agent').selected.value, /Firefox\/138\.0/);
  assert.equal(row(ff, 'navigator-app-version').selected.value, '5.0 (X11)');
  assert.equal(row(ff, 'client-hints').mode, 'bypass', 'absent Firefox UAData is not invented');
  assert.throws(() => generateFingerprintConfiguration(createApiConfiguration(), { system: 'windows' }, { userAgent: 'Unknown browser' }));
});

test('generated language and display tuples agree internally without promising CSS/header replacement', () => {
  for (const display of ['hd', 'fullhd', 'qhd', 'retina']) {
    const generated = generateFingerprintConfiguration(createApiConfiguration(), { display, language: 'de-DE' }, chrome);
    assert.equal(row(generated.configuration, 'navigator-languages').selected.value[0], row(generated.configuration, 'navigator-language').selected.value);
    assert.ok(row(generated.configuration, 'screen-avail-height').selected.value <= row(generated.configuration, 'screen-height').selected.value);
    assert.equal(row(generated.configuration, 'screen-color-depth').selected.value, row(generated.configuration, 'screen-pixel-depth').selected.value);
    assert.ok(generated.issues.some(issue => issue.code === 'screen-css'));
    assert.ok(generated.issues.some(issue => issue.code === 'network-language'));
    for (const code of ['language-list', 'screen-available', 'screen-depth', 'orientation-size']) assert.ok(!generated.issues.some(issue => issue.code === code));
  }
});

test('catalog7 generation couples Intl locale and CSS viewport/resolution to the selected language/display metadata', () => {
  for (const display of ['hd', 'fullhd', 'qhd', 'retina']) {
    const base = selected(createApiConfiguration(), 'intl-formatting', { calendar: 'gregory' });
    const result = generateFingerprintConfiguration(base, { display, language: 'de-DE' }, chrome).configuration;
    const geometry = row(result, 'screen-geometry').selected.value, media = row(result, 'css-media').selected.value;
    assert.equal(media.viewportWidth, geometry.innerWidth);assert.equal(media.viewportHeight, geometry.innerHeight);
    assert.equal(media.resolutionDppx, row(result, 'window-device-pixel-ratio').selected.value);
    assert.ok(geometry.innerWidth <= geometry.outerWidth);assert.ok(geometry.innerHeight <= geometry.outerHeight);
    assert.ok(geometry.outerWidth <= row(result, 'screen-width').selected.value);
    assert.ok(geometry.outerHeight <= row(result, 'screen-avail-height').selected.value);
    assert.deepEqual(row(result, 'intl-formatting').selected.value, { calendar: 'gregory', locale: 'de-DE' });
    assert.equal(row(base, 'intl-formatting').selected.value.calendar, 'gregory');
  }
});

test('portable variant projections are deterministic, separate audio/GL seeds and preserve absent native-capability selection', () => {
  const first = generateFingerprintConfiguration(createApiConfiguration(), { variant: 7 }, chrome).configuration;
  const again = generateFingerprintConfiguration(createApiConfiguration(), { variant: 7 }, chrome).configuration;
  const other = generateFingerprintConfiguration(createApiConfiguration(), { variant: 8 }, chrome).configuration;
  assert.deepEqual(first, again);
  const audio = row(first, 'audio-fingerprint').selected.value, gl = row(first, 'webgl-readback').selected.value;
  assert.match(audio.seed, /^[a-f0-9]{32}$/);assert.match(gl.seed, /^[a-f0-9]{32}$/);assert.notEqual(audio.seed, gl.seed);
  assert.notEqual(audio.seed, row(other, 'audio-fingerprint').selected.value.seed);
  assert.notEqual(row(first, 'canvas-text-metrics').selected.value.scale, 1);
  for (const id of ['navigator-plugins', 'webgl-capabilities', 'webgpu-capabilities', 'browser-surface', 'clock-precision']) assert.equal(row(first, id).mode, 'bypass');
});

test('blocked audio/GL and strict recipes never activate projections, preserve reusable values and constrain only Canvas fonts', () => {
  let base = selected(createApiConfiguration(), 'audio-fingerprint', { seed: 'ab'.repeat(16), amplitude: 0.00002 });
  base = selected(base, 'webgl-readback', { seed: 'cd'.repeat(16) });
  base = editFingerprintRow(base, 'audio', { mode: 'on' });base = editFingerprintRow(base, 'webgl', { mode: 'on' });
  for (const recipe of ['balanced', 'strict']) {
    const result = generateFingerprintConfiguration(base, { recipe }, chrome).configuration;
    for (const id of ['audio-fingerprint', 'webgl-readback']) {
      assert.equal(row(result, id).mode, 'off');assert.deepEqual(row(result, id).selected, row(base, id).selected);
    }
    // One Strict definition (G6): the old recipe writes the Windows font allow-list too, it used to write an empty list.
    if (recipe === 'strict') assert.deepEqual(row(result, 'canvas-font-policy').selected.value, { families: windowsFonts(), fallback: 'sans-serif' });
    else assert.equal(row(result, 'canvas-font-policy').mode, 'bypass');
  }
});

test('selected UA determines memory buckets and Android ARM platform is not falsely classified as desktop Linux', () => {
  const oldDesktop = selected(createApiConfiguration(), 'navigator-user-agent', chrome.userAgent.replace('153.', '146.'));
  const generated = generateFingerprintConfiguration(oldDesktop, { recipe: 'workstation' }, chrome).configuration;
  assert.equal(row(generated, 'device-memory').selected.value, 8);
  assert.equal(fingerprintProfileIssues(generated, chrome).some(issue => issue.code === 'memory-bucket'), false);
  let android = selected(createApiConfiguration(), 'navigator-user-agent', 'Mozilla/5.0 (Linux; Android 14) Chrome/153.0.0.0 Mobile Safari/537.36');
  android = selected(android, 'navigator-platform', 'Linux armv8l');android = selected(android, 'device-memory', 8);
  assert.equal(fingerprintProfileIssues(android, chrome).some(issue => issue.code === 'platform-agent'), false);
  android = selected(android, 'device-memory', 32);
  assert.equal(fingerprintProfileIssues(android, chrome).some(issue => issue.code === 'memory-bucket'), true);
});

test('alias recipes remove conflicting fabricated enumeration but preserve selected routing/certificates', () => {
  let base = selected(createApiConfiguration(), 'media-enumeration', [{ deviceId: 'old', groupId: '', label: 'Old microphone', kind: 'audioinput' }]);
  base = selected(base, 'webrtc', { addresses: null, iceTransportPolicy: 'relay', randomizeDevices: false, freshCertificates: true, deviceLifetime: 'session' });
  const generated = generateFingerprintConfiguration(base, {}, chrome).configuration;
  assert.equal(row(generated, 'media-enumeration').mode, 'off'); assert.deepEqual(row(generated, 'media-enumeration').selected, row(base, 'media-enumeration').selected);
  assert.deepEqual(row(generated, 'webrtc').selected.value, { addresses: null, iceTransportPolicy: 'relay', randomizeDevices: true, freshCertificates: true, deviceLifetime: 'site' });
});

test('generator never revives dormant Custom IP/relay/certificates when WebRTC is Allow/Bypass', () => {
  const former = selected(createApiConfiguration(), 'webrtc', { addresses: { ipv4: { host: '192.0.2.10', stun: '198.51.100.10', turn: '203.0.113.10' }, ipv6: { host: null, stun: null, turn: null } }, iceTransportPolicy: 'relay', randomizeDevices: false, freshCertificates: true, deviceLifetime: 'session' });
  for (const mode of ['off', 'bypass']) {
    const base = editFingerprintRow(former, 'webrtc', { mode }), generated = generateFingerprintConfiguration(base, {}, chrome).configuration;
    assert.deepEqual(row(generated, 'webrtc').selected.value, { addresses: null, iceTransportPolicy: 'preserve', randomizeDevices: true, freshCertificates: false, deviceLifetime: 'site' });
    assert.deepEqual(row(base, 'webrtc').selected, row(former, 'webrtc').selected);
  }
});

test('every recipe preserves an explicit WebRTC block and its dormant values without changing site overrides or the input', () => {
  const selectedRtc = { addresses: { ipv4: { host: '192.0.2.10', stun: '198.51.100.10', turn: '203.0.113.10' }, ipv6: { host: null, stun: null, turn: null } }, iceTransportPolicy: 'relay', randomizeDevices: false, freshCertificates: true, deviceLifetime: 'session' };
  let base = selected(createApiConfiguration(), 'webrtc', selectedRtc);
  base = editFingerprintRow(base, 'webrtc', { mode: 'on' });
  base = updateApiConfiguration(base, 'webrtc', { mode: 'off' }, 'allowed.fixture.invalid').value;
  base = updateApiConfiguration(base, 'webrtc', { mode: 'bypass' }, 'inherited.fixture.invalid').value;
  base = { ...base, enabled: true, antidetectEnabled: true };
  const before = copy(base), blocked = copy(row(base, 'webrtc'));
  for (const recipe of ['balanced', 'laptop', 'desktop', 'workstation', 'strict']) {
    for (const variant of [0, 7]) {
      const result = generateFingerprintConfiguration(base, { recipe, variant }, chrome);
      assert.deepEqual(row(result.configuration, 'webrtc'), blocked, recipe + ': block and inactive selection retained');
      assert.equal(result.affected.includes('webrtc'), false, recipe + ': generator does not turn blocking into an alias profile');
      assert.deepEqual(result.configuration.sites, before.sites, recipe + ': explicit Allow and inherited scopes retained');
      for (const host of ['new.fixture.invalid', 'inherited.fixture.invalid']) assert.equal(effectiveApiConfiguration(result.configuration, host).find(entry => entry.id === 'webrtc').mode, 'on', recipe + ': effective inherited block retained');
      assert.equal(effectiveApiConfiguration(result.configuration, 'allowed.fixture.invalid').find(entry => entry.id === 'webrtc').mode, 'off', recipe + ': explicit site Allow retained');
      assert.deepEqual(base, before, recipe + ': input remains immutable');
    }
  }
});

test('all recipes preserve every canonically accepted explicit block, including its dormant Custom selection', () => {
  const checked = new Set();
  for (const entry of API_CONFIG_CATALOG.filter(entry => entry.customSupported && entry.presets.length)) {
    const candidate = createApiConfiguration(), blocked = row(candidate, entry.id);
    candidate.enabled = true;candidate.antidetectEnabled = true;
    blocked.mode = 'on';blocked.selected = copy(entry.presets[0].value);
    const canonical = validateApiConfiguration(candidate);
    if (!canonical.ok) {
      assert.equal(canonical.error.code, 'unsupported-value', entry.id);
      assert.equal(canonical.error.path.endsWith('.mode'), true, entry.id);
      continue;
    }
    const base = canonical.value, before = copy(base), retained = copy(row(base, entry.id));checked.add(entry.id);
    for (const recipe of ['balanced', 'laptop', 'desktop', 'workstation', 'strict']) {
      const result = generateFingerprintConfiguration(base, { recipe, system: 'macos', language: 'de-DE', display: 'retina', variant: 1 }, chrome);
      assert.deepEqual(row(result.configuration, entry.id), retained, recipe + ': explicit ' + entry.id + ' retained');
      assert.equal(effectiveApiConfiguration(result.configuration, 'new.fixture.invalid').find(item => item.id === entry.id).mode, 'on', recipe + ': effective ' + entry.id + ' remains blocked');
      assert.deepEqual(base, before, recipe + ': input remains immutable');
    }
  }
  for (const id of ['webrtc', 'hardware-concurrency', 'device-memory', 'canvas-readback', 'client-hints', 'navigator-user-agent', 'navigator-platform', 'navigator-language', 'screen-width', 'screen-height']) assert.equal(checked.has(id), true, id + ': required block surface covered');
});

test('saved profiles persist all 158 modes and values, activate atomically and preserve unrelated scopes/libraries', () => {
  const original = createApiConfiguration(), generated = generateFingerprintConfiguration(original, { recipe: 'strict', display: 'retina' }, chrome).configuration;
  const profile = snapshotFingerprintProfile(generated, '  Work profile  ', id(1)); assert.equal(profile.label, 'Work profile'); assert.equal(profile.apis.length, 158);
  const stored = storeFingerprintProfile(original, profile); assert.deepEqual(stored.apis, original.apis, 'storing a library snapshot does not apply it');
  const exported = exportApiConfiguration(stored), imported = importApiConfiguration(exported); assert.equal(imported.ok, true); assert.equal(exportApiConfiguration(imported.value), exported);
  const applied = applyFingerprintProfile(imported.value, id(1)); assert.equal(applied.enabled, false); assert.equal(applied.antidetectEnabled, false);
  assert.deepEqual(applied.apis, generated.apis); assert.deepEqual(applied.sites, original.sites); assert.equal(applied.fingerprintProfiles.length, 1);
  const renamed = renameFingerprintProfile(applied, id(1), 'Renamed'); assert.equal(renamed.fingerprintProfiles[0].label, 'Renamed'); assert.deepEqual(renamed.apis, applied.apis);
  assert.deepEqual(deleteFingerprintProfile(renamed, id(1)).apis, applied.apis); assert.equal(deleteFingerprintProfile(renamed, id(1)).fingerprintProfiles.length, 0);
});

test('a hundred named configurations remain portable, deterministically ordered and searchable by label', () => {
  const base = createApiConfiguration(), generated = generateFingerprintConfiguration(base, {}, chrome).configuration;
  base.fingerprintProfiles = Array.from({ length: 100 }, (_, index) => snapshotFingerprintProfile(generated, 'Profile ' + index, id(100 - index)));
  const imported = importApiConfiguration(exportApiConfiguration(base)); assert.equal(imported.ok, true, imported.error?.message);
  assert.equal(imported.value.fingerprintProfiles.length, 100); assert.equal(imported.value.fingerprintProfiles[0].id, id(1));
  assert.deepEqual(applyFingerprintProfile(imported.value, id(100)).apis, generated.apis);
});

for (const enabled of [false, true]) for (const antidetectEnabled of [false, true]) {
  test(`ADR-068: profile generation and library operations preserve API Guard=${enabled}, Antidetect=${antidetectEnabled}`, () => {
    const base = { ...createApiConfiguration(), enabled, antidetectEnabled }, retained = copy(base);
    const generated = generateFingerprintConfiguration(base, { recipe: 'strict' }, chrome).configuration;
    assert.equal(generated.enabled, enabled); assert.equal(generated.antidetectEnabled, antidetectEnabled);
    const saved = snapshotFingerprintProfile(generated, 'Portable recipe', id(1));
    assert.equal(Object.hasOwn(saved, 'enabled'), false); assert.equal(Object.hasOwn(saved, 'antidetectEnabled'), false);
    const stored = storeFingerprintProfile(base, saved), applied = applyFingerprintProfile(stored, id(1));
    const renamed = renameFingerprintProfile(applied, id(1), 'Renamed'), deleted = deleteFingerprintProfile(renamed, id(1));
    for (const configuration of [stored, applied, renamed, deleted]) {
      assert.equal(configuration.enabled, enabled); assert.equal(configuration.antidetectEnabled, antidetectEnabled);
    }
    assert.deepEqual(base, retained, 'library operations never change their input or auto-enable either master');
  });
}

test('malformed, duplicate, absent and accessor profiles/options never partially change settings or invoke input getters', () => {
  const original = createApiConfiguration(), retained = copy(original), profile = snapshotFingerprintProfile(original, 'Own', id(1));
  const stored = storeFingerprintProfile(original, profile);
  assert.throws(() => storeFingerprintProfile(stored, profile), error => error.code === 'duplicate-profile');
  for (const fn of [applyFingerprintProfile, deleteFingerprintProfile]) assert.throws(() => fn(stored, id(99)), error => error.code === 'missing-profile');
  assert.throws(() => renameFingerprintProfile(stored, id(1), '\n'));
  let calls = 0; const malicious = { get recipe() { calls++; return 'balanced'; } };
  assert.throws(() => generateFingerprintConfiguration(original, malicious, chrome));
  assert.throws(() => editFingerprintRow(original, 'hardware-concurrency', { get mode() { calls++; return 'off'; } }));
  assert.equal(calls, 0); assert.deepEqual(original, retained);
});

test('consistency checks find independent OS/language/display/GPU mismatches without treating Imagination as ATI', () => {
  let config = selected(createApiConfiguration(), 'navigator-user-agent', chrome.userAgent);
  config = selected(config, 'navigator-platform', 'MacIntel');
  config = selected(config, 'client-hints', { brands: chrome.uaData.brands, mobile: false, platform: 'macOS' });
  config = selected(config, 'navigator-language', 'ru-RU'); config = selected(config, 'navigator-languages', ['de-DE']);
  config = selected(config, 'screen-width', 1920); config = selected(config, 'screen-height', 1080); config = selected(config, 'screen-avail-width', 2200);
  config = selected(config, 'screen-color-depth', 24); config = selected(config, 'screen-pixel-depth', 30); config = selected(config, 'screen-orientation', { type: 'portrait-primary', angle: 90 });
  config = selected(config, 'webgl', { vendor: 'WebKit', renderer: 'WebKit WebGL', unmaskedVendor: 'Imagination Technologies', unmaskedRenderer: 'PowerVR' });
  config = selected(config, 'webgpu', { vendor: 'intel', architecture: '', device: '', description: '' });
  const codes = fingerprintProfileIssues(config, chrome).map(issue => issue.code);
  for (const code of ['platform-agent', 'client-hints-agent', 'language-list', 'screen-available', 'screen-depth', 'orientation-size']) assert.ok(codes.includes(code), code);
  assert.ok(!codes.includes('gpu-pair'));
  config = selected(config, 'webgl', { vendor: 'WebKit', renderer: 'WebKit WebGL', unmaskedVendor: 'NVIDIA', unmaskedRenderer: 'GPU' });
  assert.ok(fingerprintProfileIssues(config, chrome).some(issue => issue.code === 'gpu-pair'));
});
