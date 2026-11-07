// ADR-064: independent address families and strict, lossless historical imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  API_CONFIG_CATALOG, API_CONFIG_CATALOG_V1, API_CONFIG_CATALOG_V2, API_CONFIG_CATALOG_V3, API_CONFIG_CATALOG_V4, API_CONFIG_CATALOG_V5, API_CONFIG_CATALOG_V6, API_CONFIGURATION_VERSION, API_CONFIGURATION_CATALOG_VERSION,
  createApiConfiguration, validateApiConfiguration, validateWebRtcProfile, validateApiValue,
  upgradeApiConfiguration, importApiConfiguration, exportApiConfiguration
} from '../../packages/contracts/src/api-configuration.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const tagged = value => ({ kind: 'value', value });
const emptyFamily = () => ({ host: null, stun: null, turn: null });
const profile = addresses => ({ addresses, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session' });
const rtc = config => config.apis.find(row => row.id === 'webrtc');
function historical(version) {
  const catalog = [null, API_CONFIG_CATALOG_V1, API_CONFIG_CATALOG_V2, API_CONFIG_CATALOG_V3, API_CONFIG_CATALOG_V4][version];
  return { format: 'detect.expert/api-configuration', formatVersion: version === 4 ? 3 : version === 3 ? 2 : 1, catalogVersion: version,
    enabled: true, preset: 'custom', ...(version >= 3 ? { webrtcNetworkPolicy: 'disable_non_proxied_udp' } : {}),
    apis: catalog.map(row => ({ ...clone(row), mode: 'bypass', userValues: [], selected: { kind: 'unset' }, settings: {} })), sites: [] };
}

test('dual-family roles are independently nullable, correctly typed and canonical', () => {
  const addresses = { ipv4: { ...emptyFamily(), stun: '198.51.100.7' }, ipv6: { ...emptyFamily(), host: '2001:0DB8:0:0:0:0:0:10', turn: '::ffff:192.0.2.7' } };
  const value = validateWebRtcProfile(profile(addresses));
  assert.equal(value.ok, true, value.error?.message);
  assert.deepEqual(value.value.addresses, { ipv4: { host: null, stun: '198.51.100.7', turn: null }, ipv6: { host: '2001:db8::10', stun: null, turn: '::ffff:c000:207' } });
  assert.equal(validateWebRtcProfile(profile({ ipv4: emptyFamily(), ipv6: emptyFamily() })).ok, true);
  assert.equal(validateWebRtcProfile(profile(null)).ok, true, 'devices/certificates-only profiles preserve native address behavior');
  assert.equal(validateApiValue('webrtc', tagged(profile(addresses))).ok, true);
});

test('wrong family, omitted roles, zones, hostnames and old shapes are rejected in current format', () => {
  for (const [family, literal] of [['ipv4', '2001:db8::1'], ['ipv6', '192.0.2.1'], ['ipv6', 'fe80::1%eth0'], ['ipv4', 'host.local'], ['ipv6', '[::1]']]) {
    const addresses = { ipv4: emptyFamily(), ipv6: emptyFamily() }; addresses[family].stun = literal;
    const result = validateWebRtcProfile(profile(addresses)); assert.equal(result.ok, false, family + ':' + literal);
    assert.equal(result.error.path, '$.addresses.' + family + '.stun');
  }
  for (const addresses of [{}, { ipv4: emptyFamily() }, { ipv4: null, ipv6: emptyFamily() }, { ipv4: { host: null, stun: null }, ipv6: emptyFamily() }, { host: '192.0.2.1', stun: '192.0.2.2', turn: '192.0.2.3' }]) {
    assert.equal(validateWebRtcProfile(profile(addresses)).ok, false);
  }
  let reads = 0;
  const addresses = { ipv4: emptyFamily(), ipv6: emptyFamily() };
  Object.defineProperty(addresses.ipv4, 'host', { get() { reads++; return '192.0.2.1'; } });
  assert.equal(validateWebRtcProfile(profile(addresses)).ok, false); assert.equal(reads, 0);
});

test('historical v3 metadata remains frozen separately from the new dual-family catalogue', () => {
  assert.equal(API_CONFIG_CATALOG_V3.length, 142); assert.equal(API_CONFIG_CATALOG_V4.length, 142); assert.equal(API_CONFIG_CATALOG.length, 158);
  assert.deepEqual(API_CONFIG_CATALOG_V4.map(row => [row.id, row.order]), API_CONFIG_CATALOG_V3.map(row => [row.id, row.order]));
  assert.deepEqual(API_CONFIG_CATALOG_V4.filter(row => row.id !== 'webrtc'), API_CONFIG_CATALOG_V3.filter(row => row.id !== 'webrtc'));
  assert.deepEqual(API_CONFIG_CATALOG_V5.slice(0, 142), API_CONFIG_CATALOG_V4); assert.equal(API_CONFIG_CATALOG[142].id, 'math-transcendentals');
  assert.deepEqual(API_CONFIG_CATALOG_V6.filter(row => row.id !== 'canvas-readback'), API_CONFIG_CATALOG_V5.filter(row => row.id !== 'canvas-readback'));
  assert.deepEqual(API_CONFIG_CATALOG.slice(0, API_CONFIG_CATALOG_V6.length).map(row => [row.id, row.order]), API_CONFIG_CATALOG_V6.map(row => [row.id, row.order]));
  assert.ok(Object.isFrozen(API_CONFIG_CATALOG_V3)); assert.ok(Object.isFrozen(API_CONFIG_CATALOG_V3[8].presets[1].value.value.addresses));
  assert.equal(API_CONFIG_CATALOG_V3[8].presets[1].value.value.addresses.stun, '198.51.100.10');
  assert.deepEqual(API_CONFIG_CATALOG[8].presets[1].value.value.addresses.ipv6, emptyFamily());
  assert.equal(createHash('sha256').update(JSON.stringify(API_CONFIG_CATALOG_V1)).digest('hex'), 'b3e069dab278027ebecbe06af3dd5b2642b5d9b5b84061230253df87dfbeecc4');
  assert.equal(createHash('sha256').update(JSON.stringify(API_CONFIG_CATALOG_V2)).digest('hex'), '30118d27ae2c5ba117f4616dd4fbd4cfacd6814410d19a749b10464782aa4ff4');
  // Compared with the previously installed production distribution before sync.
  assert.equal(createHash('sha256').update(JSON.stringify(API_CONFIG_CATALOG_V3)).digest('hex'), 'c2e6678fb9e94f612ce3b7f4842c8dfeb933157797784c10a602a2216408bdac');
});

test('format2 catalogue3 migrates selected values, mixed-family libraries and all sites without loss', () => {
  const old = historical(3), addresses = { host: '192.0.2.1', stun: '2001:db8::20', turn: '203.0.113.30' };
  rtc(old).mode = 'custom'; rtc(old).selected = tagged(profile(addresses));
  rtc(old).userValues = [
    { id: 'mixed', label: 'Mixed families', value: tagged(profile(addresses)) },
    { id: 'native', label: 'Devices only', value: tagged({ ...profile(null), randomizeDevices: true, freshCertificates: true, deviceLifetime: 'site' }) }
  ];
  const local = old.apis.map(row => ({ id: row.id, mode: row.id === 'webrtc' ? 'custom' : 'bypass', selected: row.id === 'webrtc' ? tagged(profile({ host: '::1', stun: '::2', turn: '::3' })) : { kind: 'unset' }, settings: {} }));
  old.sites = [{ host: 'rtc.example', disabled: false, apis: local }, { host: 'disabled.example', disabled: true, apis: clone(local) }];
  const before = clone(old), result = upgradeApiConfiguration(old);
  assert.equal(result.ok, true, result.error?.message); assert.equal(result.migrated, true);
  assert.equal(result.value.formatVersion, API_CONFIGURATION_VERSION); assert.equal(result.value.catalogVersion, API_CONFIGURATION_CATALOG_VERSION);
  assert.equal(result.value.webrtcNetworkPolicy, old.webrtcNetworkPolicy); assert.equal(result.value.enabled, old.enabled); assert.equal(result.value.antidetectEnabled, old.enabled);
  assert.deepEqual(rtc(result.value).selected.value.addresses, { ipv4: { host: '192.0.2.1', stun: null, turn: '203.0.113.30' }, ipv6: { host: null, stun: '2001:db8::20', turn: null } });
  assert.deepEqual(rtc(result.value).userValues.map(row => [row.id, row.label]), rtc(old).userValues.map(row => [row.id, row.label]));
  assert.deepEqual(rtc(result.value).userValues.find(row => row.id === 'native').value, rtc(old).userValues.find(row => row.id === 'native').value);
  for (const site of result.value.sites) {
    assert.equal(site.disabled, old.sites.find(row => row.host === site.host).disabled);
    const row = site.apis.find(row => row.id === 'webrtc'); assert.equal(row.mode, 'custom');
    assert.deepEqual(row.selected.value.addresses, { ipv4: emptyFamily(), ipv6: { host: '::1', stun: '::2', turn: '::3' } });
  }
  assert.deepEqual(old, before); assert.equal(validateApiConfiguration(old).error.code, 'incompatible-version');
  const repeated = importApiConfiguration(exportApiConfiguration(result.value));
  assert.equal(repeated.ok, true); assert.equal(repeated.migrated, false);
  assert.equal(exportApiConfiguration(repeated.value), exportApiConfiguration(result.value));
});

test('all supported historical formats migrate strictly and invalid format2 data cannot enter migration', () => {
  for (const version of [1, 2, 3, 4]) {
    const old = historical(version); const result = importApiConfiguration(JSON.stringify(old));
    assert.equal(result.ok, true, version + ':' + result.error?.message); assert.equal(result.migrated, true);
    assert.equal(result.value.formatVersion, API_CONFIGURATION_VERSION); assert.equal(result.value.catalogVersion, API_CONFIGURATION_CATALOG_VERSION); assert.equal(result.value.antidetectEnabled, old.enabled);
    assert.deepEqual(result.value.apis.map(row => row.id).slice(0, old.apis.length), old.apis.map(row => row.id));
    assert.equal(result.value.webrtcNetworkPolicy, version >= 3 ? old.webrtcNetworkPolicy : 'system');
  }
  for (const mutate of [
    value => { rtc(value).presets[1].value.value.addresses.host = '192.0.2.99'; },
    value => { rtc(value).userValues = [{ id: 'bad', label: 'Bad', value: tagged(profile({ host: 'host.local', stun: '192.0.2.1', turn: '192.0.2.2' })) }]; },
    value => { value.apis.pop(); }, value => { value.formatVersion = 3; }
  ]) {
    const old = historical(3); mutate(old); const before = clone(old), result = upgradeApiConfiguration(old);
    assert.equal(result.ok, false); assert.equal(result.upgradeFailure, undefined); assert.deepEqual(old, before);
  }
  const current = createApiConfiguration(); assert.equal(current.formatVersion, API_CONFIGURATION_VERSION); assert.equal(current.catalogVersion, API_CONFIGURATION_CATALOG_VERSION); assert.equal(current.enabled, false); assert.equal(current.antidetectEnabled, false);
});
