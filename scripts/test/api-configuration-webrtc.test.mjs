// E22-08: portable desired settings, never native certificates, device IDs or network state.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  API_CONFIG_CATALOG, API_CONFIGURATION_VERSION, API_CONFIGURATION_CATALOG_VERSION, API_WEBRTC_NETWORK_POLICIES, API_WEBRTC_NETWORK_POLICIES_V8, createApiConfiguration,
  validateApiConfiguration, validateApiValue, validateWebRtcProfile,
  updateApiConfiguration, importApiConfiguration, exportApiConfiguration,
  diffApiConfigurations, configurationToLegacy
} from '../../packages/contracts/src/api-configuration.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const tagged = value => ({ kind: 'value', value });
const profile = (patch = {}) => ({ addresses: null, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session', ...patch });
const addresses = value => ({ ipv4: { host: null, stun: null, turn: null }, ipv6: { host: null, stun: null, turn: null }, ...value });
const row = (value, id) => value.apis.find(entry => entry.id === id);
function set(config, id, patch, host = null) {
  const result = updateApiConfiguration(config, id, patch, host); assert.equal(result.ok, true, result.error?.message); return result.value;
}

test('WebRTC catalogue exposes five complete typed profiles and preserves original API identity', () => {
  const rtc = API_CONFIG_CATALOG.find(entry => entry.id === 'webrtc');
  assert.equal(rtc.order, 8); assert.equal(rtc.name, 'webrtc'); assert.equal(rtc.group, 'media');
  assert.equal(rtc.type, 'webrtc'); assert.equal(rtc.customSupported, true); assert.equal(rtc.presets.length, 5);
  assert.deepEqual(rtc.presets[0].value, tagged(profile()));
  for (const preset of rtc.presets) {
    assert.equal(validateApiValue('webrtc', preset.value).ok, true);
    assert.deepEqual(Object.keys(preset.value.value).sort(), ['addresses', 'deviceLifetime', 'freshCertificates', 'iceTransportPolicy', 'randomizeDevices']);
  }
  assert.equal(validateApiValue('webrtc', { kind: 'null' }).ok, false);
  assert.equal(validateApiValue('webrtc', { kind: 'undefined' }).ok, false);
  assert.equal(validateApiValue('webrtc', tagged(null)).ok, false);
  assert.equal(updateApiConfiguration(createApiConfiguration(), 'webrtc', { mode: 'custom' }).error.code, 'missing-value');
});

test('literal IP validation accepts IPv4 and IPv6 and normalizes only IPv6 spelling', () => {
  for (const address of ['0.0.0.0', '127.0.0.1', '192.0.2.10', '255.255.255.255', '::', '::1', '2001:db8::10', '2001:DB8:0:0:0:0:0:10', '::ffff:192.0.2.1']) {
    const family = address.includes(':') ? 'ipv6' : 'ipv4';
    const result = validateWebRtcProfile(profile({ addresses: addresses({ [family]: { host: address, stun: address, turn: address } }) }));
    assert.equal(result.ok, true, address);
    const normalized = address === '2001:DB8:0:0:0:0:0:10' ? '2001:db8::10' : address === '::ffff:192.0.2.1' ? '::ffff:c000:201' : address;
    assert.deepEqual(result.value.addresses, addresses({ [family]: { host: normalized, stun: normalized, turn: normalized } }));
  }
  for (const address of ['', ' ', ' 192.0.2.1', '192.0.2.1 ', 'localhost', 'test.example', 'https://192.0.2.1', '192.0.2.1:3478', '192.0.2.1/32', '192.000.2.1', '127.1', '0x7f000001', '256.0.0.1', '1.2.3.4.', '[::1]', 'fe80::1%eth0', '2001:db8::/32', '2001:::1', '1:2:3:4:5:6:7:8:9', '::ffff:999.0.0.1', '::1#fragment', 'user@::1', '\n::1']) {
    const result = validateWebRtcProfile(profile({ addresses: addresses({ ipv4: { host: address, stun: '192.0.2.1', turn: '203.0.113.1' } }) }));
    assert.equal(result.ok, false, address); assert.equal(result.error.path, '$.addresses.ipv4.host', address);
  }
});

test('profiles reject omissions, extra controls, credentials, non-JSON values and implicit coercion', () => {
  const invalid = [
    value => { delete value.addresses; }, value => { value.addresses = {}; }, value => { value.addresses = { host: '192.0.2.1', stun: '192.0.2.2' }; },
    value => { value.addresses = { host: '192.0.2.1', stun: '192.0.2.2', turn: '192.0.2.3', port: 3478 }; },
    value => { value.iceTransportPolicy = 'all'; }, value => { value.deviceLifetime = 'connection'; },
    value => { value.randomizeDevices = 1; }, value => { value.freshCertificates = 'true'; },
    value => { value.iceServers = []; }, value => { value.username = 'user'; }, value => { value.credential = 'secret'; },
    value => { value.certificates = []; }, value => { value.fingerprints = ['fake']; }, value => { value.seed = 'persisted'; }
  ];
  for (const mutate of invalid) { const value = profile(); mutate(value); assert.equal(validateWebRtcProfile(value).ok, false); assert.equal(validateApiValue('webrtc', tagged(value)).ok, false); }
  let reads = 0;
  const value = profile(); Object.defineProperty(value, 'randomizeDevices', { get() { reads++; return true; } });
  assert.equal(validateWebRtcProfile(value).ok, false); assert.equal(reads, 0);
  const address = { toString() { reads++; return '192.0.2.1'; } };
  assert.equal(validateWebRtcProfile(profile({ addresses: { host: address, stun: address, turn: address } })).ok, false); assert.equal(reads, 0);
});

test('native network policy is complete, global and independent from API master/site choices', () => {
  // Format 9 adds the Firefox-only proxy_only; formats 2-8 keep exactly the three older values (api-configuration-catalog10.test.mjs).
  assert.deepEqual(API_WEBRTC_NETWORK_POLICIES, ['system', 'default_public_interface_only', 'disable_non_proxied_udp', 'proxy_only']);
  assert.deepEqual(API_WEBRTC_NETWORK_POLICIES_V8, ['system', 'default_public_interface_only', 'disable_non_proxied_udp']);
  assert.ok(Object.isFrozen(API_WEBRTC_NETWORK_POLICIES)); assert.ok(Object.isFrozen(API_WEBRTC_NETWORK_POLICIES_V8));
  const config = createApiConfiguration(); assert.equal(config.formatVersion, API_CONFIGURATION_VERSION); assert.equal(config.catalogVersion, API_CONFIGURATION_CATALOG_VERSION);
  assert.equal(config.webrtcNetworkPolicy, 'system'); assert.equal(config.enabled, false);
  for (const policy of API_WEBRTC_NETWORK_POLICIES) {
    const desired = { ...config, webrtcNetworkPolicy: policy }, imported = importApiConfiguration(exportApiConfiguration(desired));
    assert.equal(imported.ok, true); assert.equal(imported.value.webrtcNetworkPolicy, policy); assert.equal(imported.value.enabled, false);
    assert.deepEqual(configurationToLegacy(desired), configurationToLegacy(config));
  }
  const absent = clone(config); delete absent.webrtcNetworkPolicy; assert.equal(validateApiConfiguration(absent).error.code, 'missing-field');
  for (const invalid of [null, true, 'default', 'Proxy_Only', 'proxy_only ', 'proxy-only', 'relay', 'disable_non_proxied_udp ']) assert.equal(validateApiConfiguration({ ...config, webrtcNetworkPolicy: invalid }).ok, false);
  const foreignState = { ...config, levelOfControl: 'controlled_by_this_extension' }; assert.equal(validateApiConfiguration(foreignState).error.code, 'unknown-field');
  const changed = { ...config, webrtcNetworkPolicy: 'disable_non_proxied_udp' };
  assert.deepEqual(diffApiConfigurations(config, changed).value, [{ scope: 'global', id: null, field: 'webrtcNetworkPolicy', before: 'system', after: 'disable_non_proxied_udp' }]);
});

test('1000 WebRTC profile library records and exact-site overrides export deterministically without realized session data', () => {
  const values = Array.from({ length: 1000 }, (_, index) => ({ id: 'custom-' + index, label: 'Owned RTC profile ' + index, value: tagged(profile({ randomizeDevices: index % 2 === 0, freshCertificates: true, deviceLifetime: index % 2 ? 'site' : 'session' })) }));
  let config = set(createApiConfiguration(), 'webrtc', { userValues: values, mode: 'custom', selected: values[0].value });
  config = set(config, 'webrtc', { mode: 'custom', selected: tagged(profile({ addresses: addresses({ ipv6: { host: '::1', stun: '2001:db8::1', turn: '2001:db8::2' } }), iceTransportPolicy: 'relay' })) }, 'rtc.example');
  config.webrtcNetworkPolicy = 'default_public_interface_only';
  const reordered = clone(config); reordered.apis.reverse(); row(reordered, 'webrtc').userValues.reverse(); reordered.sites[0].apis.reverse();
  assert.equal(exportApiConfiguration(config), exportApiConfiguration(reordered));
  const imported = importApiConfiguration(exportApiConfiguration(config)); assert.equal(imported.ok, true); assert.equal(imported.migrated, false);
  assert.equal(row(imported.value, 'webrtc').userValues.length, 1000); assert.equal(imported.value.sites[0].apis.find(row => row.id === 'webrtc').mode, 'custom');
  assert.deepEqual(Object.keys(row(imported.value, 'webrtc').selected.value).sort(), ['addresses', 'deviceLifetime', 'freshCertificates', 'iceTransportPolicy', 'randomizeDevices']);
  assert.deepEqual(configurationToLegacy(config).global.find(row => row.feature === 'webrtc'), { feature: 'webrtc', state: 'allow' });
});

test('effective device conflicts reject active global combinations but permit inactive values and dormant libraries', () => {
  let config = set(createApiConfiguration(), 'webrtc', { mode: 'custom', selected: tagged(profile({ randomizeDevices: true })) });
  config = set(config, 'media-enumeration', { mode: 'custom', selected: tagged([]) });
  assert.equal(validateApiConfiguration(config).ok, true, 'master Off keeps the dormant configuration editable');
  config.antidetectEnabled = true; const retained = clone(config), rejected = validateApiConfiguration(config);
  assert.equal(rejected.error.code, 'conflicting-webrtc-devices'); assert.equal(rejected.error.path, '$.apis'); assert.deepEqual(config, retained);
  for (const mode of ['on', 'off', 'bypass']) { const inactive = clone(config); row(inactive, 'webrtc').mode = mode; assert.equal(validateApiConfiguration(inactive).ok, true, mode); }
  const fixed = clone(config); row(fixed, 'webrtc').selected = tagged(profile({ freshCertificates: true })); assert.equal(validateApiConfiguration(fixed).ok, true);
  row(fixed, 'webrtc').userValues.push({ id: 'dormant', label: 'Inactive randomization', value: tagged(profile({ randomizeDevices: true })) }); assert.equal(validateApiConfiguration(fixed).ok, true);
  const before = exportApiConfiguration({ ...config, antidetectEnabled: false });
  assert.equal(importApiConfiguration(JSON.stringify(config)).error.code, 'conflicting-webrtc-devices'); assert.equal(exportApiConfiguration({ ...config, antidetectEnabled: false }), before);
});

test('device conflicts follow exact-host Bypass inheritance, explicit overrides and disabled sites', () => {
  let config = set(createApiConfiguration(), 'webrtc', { mode: 'custom', selected: tagged(profile({ randomizeDevices: true })) });
  config = set(config, 'media-enumeration', { mode: 'custom', selected: tagged([]) }, 'rtc.example'); config.antidetectEnabled = true;
  assert.equal(validateApiConfiguration(config).error.code, 'conflicting-webrtc-devices', 'site inherits global WebRTC Custom');
  const localOff = clone(config); localOff.sites[0].apis.find(row => row.id === 'webrtc').mode = 'off'; assert.equal(validateApiConfiguration(localOff).ok, true);
  const disabled = clone(config); disabled.sites[0].disabled = true; assert.equal(validateApiConfiguration(disabled).ok, true);
  let inverse = set(createApiConfiguration(), 'media-enumeration', { mode: 'custom', selected: tagged([]) });
  inverse = set(inverse, 'webrtc', { mode: 'custom', selected: tagged(profile({ randomizeDevices: true, deviceLifetime: 'site' })) }, 'rtc.example'); inverse.antidetectEnabled = true;
  const failure = validateApiConfiguration(inverse); assert.equal(failure.error.code, 'conflicting-webrtc-devices'); assert.equal(failure.error.path, '$.sites[0].apis');
  const absent = clone(inverse); absent.sites[0].apis.find(row => row.id === 'webrtc').mode = 'bypass'; assert.equal(validateApiConfiguration(absent).ok, true);
});
