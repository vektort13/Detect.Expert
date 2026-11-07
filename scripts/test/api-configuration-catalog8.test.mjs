// Catalog 8 (published in release 2.0.0): Custom geolocation, the sparse Canvas algorithm, the mDNS WebRTC host mode and
// the ADR-105/106 reasons. Published catalogs 1-8 stay byte-pinned; newer values are rejected inside every historical
// format and every valid older export still imports and migrates. No browser or backend access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as contract from '../../packages/contracts/src/api-configuration.mjs';

const clone = value => structuredClone(value);
const tagged = value => ({ kind: 'value', value });
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const row = (config, id) => config.apis.find(entry => entry.id === id);
const siteRow = (site, id) => site.apis.find(entry => entry.id === id);
const scopeRows = catalog => catalog.map(({ id }) => ({ id, mode: 'bypass', selected: { kind: 'unset' }, settings: {} }));
const geo = (latitude, longitude, accuracy = 25) => ({ latitude, longitude, accuracy });
const family = (overrides = {}) => ({ host: null, stun: null, turn: null, ...overrides });
const rtc = (addresses = null, extra = {}) => ({ addresses, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session', ...extra });
const mdns = (v4 = 'mdns', v6 = null) => rtc({ ipv4: family({ host: v4 }), ipv6: family({ host: v6 }) });
const check = (id, value) => contract.validateApiValue(id, tagged(value));
const PAIRS = [[1, 1], [2, 1], [3, 2], [4, 3], [5, 3], [6, 4], [6, 5], [7, 6], [8, 7], [9, 8]];
const HASHES = ['b3e069dab278027ebecbe06af3dd5b2642b5d9b5b84061230253df87dfbeecc4', '30118d27ae2c5ba117f4616dd4fbd4cfacd6814410d19a749b10464782aa4ff4', 'c2e6678fb9e94f612ce3b7f4842c8dfeb933157797784c10a602a2216408bdac', '8078b7f3f2eade1aba87a950fc1f8fa79ed75091267f798a90dcbbd9f2cc2f43', 'c10b94ac123076d428a254367649a4cc168c97947aa3787bf41f9b320bccf7e1', 'e03c14158d199bdac78dbdac56c748171a5fa1b89dc4b8b9301e899236d8f286', '04ab7486cfab75d88db1f55a6e47288f0f4864f61bfaf66801b9a07e1c25b646', '6a8d1b4ad09efee6237b4ac8bad9ed79a5789c1d86d01d24de50b7e36db6f447'];
// Catalog 8 (published in release 2.0.0) differs from catalog 7 in these rows, in catalog order: three widened value
// domains (canvas-readback, webrtc, geolocation), four ADR-105 header-following reasons and the ADR-106 storage reason.
const EXPANDED_ROWS = ['canvas-readback', 'webrtc', 'client-hints', 'geolocation', 'storage-estimate', 'navigator-user-agent', 'navigator-language', 'navigator-languages'];
const HEADER_ROWS = ['navigator-user-agent', 'client-hints', 'navigator-language', 'navigator-languages'];
const CITIES = [['New York', 40.7128, -74.006], ['London', 51.5074, -0.1278], ['Berlin', 52.52, 13.405], ['Paris', 48.8566, 2.3522], ['Tokyo', 35.6762, 139.6503], ['Sydney', -33.8688, 151.2093]];
function update(config, id, patch, host = null) {
  const result = contract.updateApiConfiguration(config, id, patch, host);
  assert.equal(result.ok, true, `${id}: ${result.error?.code} ${result.error?.path} ${result.error?.message}`);
  return result.value;
}

test('catalog8 is published and byte-pinned with catalogs 1-7, and differs from catalog7 in exactly the eight round-3 rows', () => {
  for (let version = 1; version <= 8; version++) assert.equal(sha(contract['API_CONFIG_CATALOG_V' + version]), HASHES[version - 1], 'frozen catalog ' + version);
  const v7 = contract.API_CONFIG_CATALOG_V7, v8 = contract.API_CONFIG_CATALOG_V8;
  assert.ok(Object.isFrozen(v8)); assert.equal(v8.length, 158); assert.equal(v7.length, 158);
  assert.deepEqual(v8.map(entry => [entry.id, entry.order]), v7.map(entry => [entry.id, entry.order]));
  assert.deepEqual(v8.map(entry => entry.order), Array.from({ length: 158 }, (_, index) => index));
  assert.deepEqual(v8.filter((entry, index) => JSON.stringify(entry) !== JSON.stringify(v7[index])).map(entry => entry.id), EXPANDED_ROWS);
  assert.equal(v7.filter(entry => entry.customSupported).length, 55); assert.equal(v8.filter(entry => entry.customSupported).length, 56);
  assert.deepEqual(v8.filter(entry => entry.customSupported && !v7.find(old => old.id === entry.id).customSupported).map(entry => entry.id), ['geolocation']);
  assert.ok(!contract.API_CUSTOM_ONLY_IDS.includes('geolocation'), 'geolocation keeps On = block');
});

test('catalog8 Custom reasons describe the three expanded domains and catalogs 1-7 keep their original text', () => {
  const reason = id => contract.API_CONFIG_CATALOG.find(entry => entry.id === id).customReason;
  assert.match(reason('geolocation'), /getCurrentPosition/); assert.match(reason('geolocation'), /watchPosition/);
  assert.match(reason('geolocation'), /prompt, denial, timeout and unavailable errors stay native/); assert.match(reason('geolocation'), /no location or permission is created/); assert.match(reason('geolocation'), /timestamp stays native/);
  const eight = id => contract.API_CONFIG_CATALOG_V8.find(entry => entry.id === id).customReason;
  assert.match(eight('canvas-readback'), /sparse-rgb-v1 \(default\)[^.]*about 1% of fully opaque pixels/); assert.match(eight('canvas-readback'), /stable-rgb-v1[^.]*older profiles/);
  assert.match(reason('canvas-readback'), /sparse-rgb-v2 \(default\)/, 'the current catalog describes the current default (ADR-112)');
  assert.match(reason('webrtc'), /mdns/); assert.match(reason('webrtc'), /<uuid>\.local/); assert.match(reason('webrtc'), /no name resolution is performed/);
  const old = id => contract.API_CONFIG_CATALOG_V7.find(entry => entry.id === id).customReason;
  assert.doesNotMatch(old('canvas-readback'), /sparse/); assert.doesNotMatch(old('webrtc'), /mdns/);
  assert.equal(old('geolocation'), 'This API requires native objects, permissions, or side effects; Custom is unavailable.');
});

test('catalog8 header-following reasons name the Chrome all-sites scope and ADR-105, while catalogs 1-7 keep the old "unchanged" texts', () => {
  const reason = id => contract.API_CONFIG_CATALOG.find(entry => entry.id === id).customReason;
  const old = id => contract.API_CONFIG_CATALOG_V7.find(entry => entry.id === id).customReason;
  assert.equal(reason('navigator-user-agent'), "JavaScript userAgent. In Chrome with Antidetect's all-sites scope the HTTP User-Agent request header follows the same value (ADR-105); other engines and scopes leave HTTP headers unchanged.");
  assert.equal(reason('client-hints'), "JavaScript userAgentData metadata. In Chrome with Antidetect's all-sites scope the low-entropy Sec-CH-UA headers follow it and high-entropy hints are removed from requests (ADR-105); other engines and scopes leave HTTP headers unchanged.");
  assert.match(reason('navigator-language'), /Accept-Language request header follows it when navigator-languages is not Custom \(ADR-105\)/);
  assert.match(reason('navigator-languages'), /Accept-Language request header follows this list \(ADR-105\)/);
  for (const id of HEADER_ROWS) { assert.match(reason(id), /^JavaScript .*In Chrome with Antidetect's all-sites scope .*\(ADR-105\); other engines and scopes leave HTTP headers unchanged\.$/, id); assert.ok(contract.API_CONFIG_CATALOG.find(entry => entry.id === id).customSupported, id); }
  assert.equal(old('navigator-user-agent'), 'JavaScript userAgent only; HTTP User-Agent headers are unchanged.');
  assert.equal(old('client-hints'), 'JavaScript metadata only; HTTP User-Agent Client Hints headers are unchanged.');
  assert.equal(old('navigator-language'), null); assert.equal(old('navigator-languages'), null);
  for (const version of [3, 4, 5, 6, 7]) for (const id of HEADER_ROWS) assert.doesNotMatch(String(contract['API_CONFIG_CATALOG_V' + version].find(entry => entry.id === id).customReason), /ADR-105/, `catalog ${version} ${id}`);
});

test('catalog8 storage-estimate reason lists every API answered by the selected snapshot; only the reason changed in catalog 8', () => {
  const now = contract.API_CONFIG_CATALOG_V8.find(entry => entry.id === 'storage-estimate'), before = contract.API_CONFIG_CATALOG_V7.find(entry => entry.id === 'storage-estimate');
  assert.equal(now.customReason, 'Quota and usage result metadata only; actual browser storage limits are unchanged. The same selected snapshot answers StorageManager.estimate, StorageBucket.estimate and the deprecated webkitTemporaryStorage/webkitPersistentStorage queryUsageAndQuota and requestQuota (ADR-106).');
  assert.equal(before.customReason, 'Quota and usage result metadata only; actual browser storage limits are unchanged.');
  assert.deepEqual(Object.keys(now).filter(key => JSON.stringify(now[key]) !== JSON.stringify(before[key])), ['customReason'], 'type, valueHint, presets and flags stay identical');
  for (const version of [1, 2, 3, 4, 5, 6, 7]) assert.doesNotMatch(String(contract['API_CONFIG_CATALOG_V' + version].find(entry => entry.id === 'storage-estimate').customReason), /ADR-106|StorageBucket/, `catalog ${version}`);
});

test('geolocation is Custom-capable with six city presets of 25 m accuracy in the stated order', () => {
  const entry = contract.API_CONFIG_CATALOG.find(item => item.id === 'geolocation');
  assert.equal(entry.type, 'geolocation'); assert.equal(entry.group, 'device'); assert.equal(entry.customSupported, true);
  assert.equal(entry.allowNull, false); assert.equal(entry.allowUndefined, false);
  assert.deepEqual(entry.presets.map(preset => [preset.id, preset.label, preset.value]), CITIES.map(([label, latitude, longitude], index) => [`preset-${index + 1}`, label, tagged(geo(latitude, longitude))]));
  for (const preset of entry.presets) {
    const result = contract.validateApiValue('geolocation', preset.value);
    assert.equal(result.ok, true, preset.label); assert.deepEqual(result.value, preset.value);
  }
  assert.equal(contract.API_CONFIG_CATALOG_V7.find(item => item.id === 'geolocation').customSupported, false);
});

test('geolocation accepts exactly the closed numeric ranges and canonicalizes -0 and key order', () => {
  for (const good of [geo(0, 0, 1), geo(90, 180, 100000), geo(-90, -180, 1), geo(89.99999999, 179.99999999, 99999.999), geo(40.7128, -74.006, 25.5), geo(1e-9, -1e-9, 1)]) {
    const result = check('geolocation', good);
    assert.equal(result.ok, true, JSON.stringify(good) + ' ' + result.error?.message); assert.deepEqual(result.value.value, good);
  }
  const zero = check('geolocation', geo(-0, -0, 25));
  assert.equal(zero.ok, true); assert.ok(Object.is(zero.value.value.latitude, 0)); assert.ok(Object.is(zero.value.value.longitude, 0));
  const shuffled = check('geolocation', { accuracy: 25, longitude: -74.006, latitude: 40.7128 });
  assert.equal(shuffled.ok, true); assert.deepEqual(Object.keys(shuffled.value.value), ['accuracy', 'latitude', 'longitude']);
  for (const [bad, path] of [
    [geo(90.0000001, 0), 'latitude'], [geo(-90.0000001, 0), 'latitude'], [geo(0, 180.0000001), 'longitude'], [geo(0, -180.0000001), 'longitude'],
    [geo(0, 0, 0.9999999), 'accuracy'], [geo(0, 0, 0), 'accuracy'], [geo(0, 0, -1), 'accuracy'], [geo(0, 0, 100000.0001), 'accuracy'], [geo(1000, 0), 'latitude']
  ]) {
    const result = check('geolocation', bad);
    assert.equal(result.ok, false, JSON.stringify(bad)); assert.equal(result.error.code, 'invalid-value'); assert.equal(result.error.path, '$.value.' + path);
  }
});

test('geolocation rejects non-numbers, non-finite numbers, missing or extra keys and non-objects without running page code', () => {
  for (const bad of [
    geo('40.7', 0), geo(0, '0'), geo(0, 0, '25'), geo(null, 0), geo(0, null), geo(0, 0, null), geo(undefined, 0), geo(true, 0), geo([], 0), geo({}, 0), geo([40], 0),
    geo(NaN, 0), geo(0, NaN), geo(0, 0, NaN), geo(Infinity, 0), geo(0, -Infinity), geo(0, 0, Infinity), geo(10n, 0), geo(Symbol('x'), 0)
  ]) assert.equal(check('geolocation', bad).ok, false, String(Object.values(bad).map(String)));
  for (const keys of [['longitude', 'accuracy'], ['latitude', 'accuracy'], ['latitude', 'longitude'], []]) {
    const partial = Object.fromEntries(Object.entries(geo(1, 2, 3)).filter(([key]) => keys.includes(key)));
    assert.equal(check('geolocation', partial).error.code, 'missing-field', keys.join());
  }
  for (const extra of ['altitude', 'altitudeAccuracy', 'heading', 'speed', 'timestamp', 'lat', 'lng', 'seed']) assert.equal(check('geolocation', { ...geo(1, 2, 3), [extra]: 0 }).error.code, 'unknown-field', extra);
  for (const bad of [null, 'Paris', 5, true, [], [48.8, 2.3, 25], [[48.8, 2.3, 25]]]) assert.equal(check('geolocation', bad).ok, false);
  for (const kind of ['null', 'undefined']) assert.equal(contract.validateApiValue('geolocation', { kind }).error.code, 'unsupported-value');
  let reads = 0;
  const trap = geo(1, 2, 3);
  Object.defineProperty(trap, 'latitude', { enumerable: true, get() { reads++; return 1; } });
  assert.equal(check('geolocation', trap).ok, false);
  const coercing = geo({ valueOf() { reads++; return 1; }, toString() { reads++; return '1'; }, toJSON() { reads++; return 1; } }, 2);
  assert.equal(check('geolocation', coercing).ok, false); assert.equal(reads, 0);
});

test('geolocation Custom works globally, per exact site, as saved value and in the profile library while On stays a block', () => {
  let config = contract.createApiConfiguration();
  assert.equal(contract.updateApiConfiguration(config, 'geolocation', { mode: 'custom' }).error.code, 'missing-value');
  assert.equal(contract.updateApiConfiguration(config, 'geolocation', { mode: 'custom', selected: { kind: 'null' } }).error.code, 'unsupported-value');
  assert.equal(contract.updateApiConfiguration(config, 'geolocation', { mode: 'custom', selected: tagged(geo(91, 0)) }).ok, false);
  const berlin = tagged(geo(52.52, 13.405)), paris = tagged(geo(48.8566, 2.3522)), office = tagged(geo(1.5, 2.5, 80));
  config = update(config, 'geolocation', { mode: 'custom', selected: berlin });
  const extreme = tagged(geo(-1e-9, 179.99999999999997, 99999.99999999999));
  config = update(config, 'geolocation', { userValues: [{ id: 'custom-2', label: 'Extreme', value: extreme }, { id: 'custom-1', label: 'Office', value: office }] });
  config = update(config, 'geolocation', { mode: 'custom', selected: paris }, 'paris.example');
  config = update(config, 'geolocation', { mode: 'on' }, 'blocked.example');
  config.enabled = true; config.antidetectEnabled = true;
  const effective = host => contract.effectiveApiConfiguration(config, host).find(entry => entry.id === 'geolocation');
  assert.deepEqual(effective('other.example'), { id: 'geolocation', mode: 'custom', value: berlin });
  assert.deepEqual(effective('paris.example'), { id: 'geolocation', mode: 'custom', value: paris });
  assert.deepEqual(effective('blocked.example'), { id: 'geolocation', mode: 'on', value: { kind: 'unset' } });
  assert.equal(row(config, 'geolocation').userValues[0].value.value.accuracy, 80);
  const legacy = contract.configurationToLegacy(config);
  assert.equal(legacy.global.find(rule => rule.feature === 'geolocation').state, 'allow', 'Custom cancels the block for its scope');
  assert.equal(legacy.sites.find(site => site.host === 'blocked.example').rules.find(rule => rule.feature === 'geolocation').state, 'block');
  const source = contract.exportApiConfiguration(config), restored = contract.importApiConfiguration(source);
  assert.equal(restored.ok, true); assert.equal(restored.migrated, false); assert.equal(contract.exportApiConfiguration(restored.value), source);
  assert.deepEqual(row(restored.value, 'geolocation').selected, berlin);
  assert.deepEqual(row(restored.value, 'geolocation').userValues.map(saved => [saved.id, saved.value]), [['custom-1', office], ['custom-2', extreme]], 'exponent and full-precision numbers survive the JSON file');
});

test('a dormant library profile may carry a Custom geolocation row and rejects an out-of-range one', () => {
  const config = contract.createApiConfiguration();
  const apis = contract.API_CONFIG_CATALOG.map(({ id }) => ({ id, mode: id === 'geolocation' ? 'custom' : 'bypass', selected: id === 'geolocation' ? tagged(geo(35.6762, 139.6503)) : { kind: 'unset' }, settings: {} }));
  config.fingerprintProfiles = [{ id: 'fp-' + '0b'.repeat(16), label: 'Tokyo profile', preset: 'custom', webrtcNetworkPolicy: 'system', apis, tags: [], note: '' }];
  assert.equal(contract.validateApiConfiguration(config).ok, true);
  assert.equal(contract.importApiConfiguration(contract.exportApiConfiguration(config)).ok, true);
  config.fingerprintProfiles[0].apis.find(entry => entry.id === 'geolocation').selected = tagged(geo(35.6762, 139.6503, 0));
  assert.equal(contract.validateApiConfiguration(config).ok, false);
});

test('canvas-readback offers sparse-rgb-v1 as the first preset in catalog 8, keeps stable-rgb-v1 and rejects everything else (sparse-rgb-v2 arrives with catalog 11)', () => {
  const entry = contract.API_CONFIG_CATALOG_V8.find(item => item.id === 'canvas-readback');
  assert.deepEqual(entry.presets.map(preset => [preset.id, preset.value]), [['preset-1', tagged({ algorithm: 'sparse-rgb-v1' })], ['preset-2', tagged({ algorithm: 'stable-rgb-v1' })]]);
  assert.deepEqual(contract.API_CONFIG_CATALOG.find(item => item.id === 'canvas-readback').presets.map(preset => preset.value.value.algorithm), ['sparse-rgb-v2', 'sparse-rgb-v1', 'stable-rgb-v1']);
  for (const algorithm of ['sparse-rgb-v1', 'stable-rgb-v1']) {
    const result = check('canvas-readback', { algorithm });
    assert.equal(result.ok, true, algorithm); assert.deepEqual(result.value, tagged({ algorithm }));
  }
  for (const bad of [{ algorithm: 'SPARSE-RGB-V1' }, { algorithm: 'Stable-rgb-v1' }, { algorithm: ' sparse-rgb-v1' }, { algorithm: 'sparse-rgb-v1 ' }, { algorithm: 'sparse-rgb-v3' }, { algorithm: 'stable-rgb-v2' },
    { algorithm: 'sparse' }, { algorithm: '' }, { algorithm: null }, { algorithm: 1 }, { algorithm: ['sparse-rgb-v1'] }, { algorithm: { toString: () => 'sparse-rgb-v1' } }]) {
    assert.equal(check('canvas-readback', bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(check('canvas-readback', {}).error.code, 'missing-field');
  assert.equal(check('canvas-readback', { algorithm: 'sparse-rgb-v1', seed: '00'.repeat(16) }).error.code, 'unknown-field');
  assert.equal(check('canvas-readback', 'sparse-rgb-v1').ok, false);
  // A catalog 8 file (format 7) refuses the algorithm that arrived with catalog 11.
  const eightFile = published(8, 7); Object.assign(eightFile.apis.find(item => item.id === 'canvas-readback'), { mode: 'custom', selected: tagged({ algorithm: 'sparse-rgb-v2' }) });
  const refused = contract.upgradeApiConfiguration(eightFile); assert.equal(refused.ok, false); assert.equal(refused.error.code, 'invalid-value'); assert.ok(refused.error.path.endsWith('.selected.value.algorithm'), refused.error.path);
  let config = contract.createApiConfiguration();
  config = update(config, 'canvas-readback', { mode: 'custom', selected: tagged({ algorithm: 'sparse-rgb-v1' }) });
  config = update(config, 'canvas-readback', { mode: 'custom', selected: tagged({ algorithm: 'stable-rgb-v1' }) }, 'older.example');
  const restored = contract.importApiConfiguration(contract.exportApiConfiguration(config));
  assert.equal(restored.ok, true); assert.equal(restored.migrated, false);
  assert.deepEqual(row(restored.value, 'canvas-readback').selected, tagged({ algorithm: 'sparse-rgb-v1' }));
  assert.deepEqual(siteRow(restored.value.sites[0], 'canvas-readback').selected, tagged({ algorithm: 'stable-rgb-v1' }));
});

test('webrtc accepts the mdns host mode only in the host slot of an IPv4 or IPv6 address object', () => {
  const ips = rtc({ ipv4: family({ host: 'mdns', stun: '198.51.100.7', turn: '203.0.113.7' }), ipv6: family({ host: 'mdns', stun: '2001:db8::7', turn: '2001:db8::8' }) });
  for (const good of [mdns('mdns', null), mdns(null, 'mdns'), mdns('mdns', 'mdns'), ips, rtc({ ipv4: family({ host: 'mdns' }), ipv6: family() }, { iceTransportPolicy: 'relay', randomizeDevices: true, freshCertificates: true, deviceLifetime: 'site' })]) {
    const profile = contract.validateWebRtcProfile(good), value = check('webrtc', good);
    assert.equal(profile.ok, true, profile.error?.message); assert.deepEqual(profile.value, good);
    assert.equal(value.ok, true, value.error?.message); assert.deepEqual(value.value, tagged(good));
  }
  for (const [path, slot] of [['ipv4', 'stun'], ['ipv4', 'turn'], ['ipv6', 'stun'], ['ipv6', 'turn']]) {
    const bad = rtc({ ipv4: family(), ipv6: family() }); bad.addresses[path][slot] = 'mdns';
    for (const result of [contract.validateWebRtcProfile(bad), check('webrtc', bad)]) {
      assert.equal(result.ok, false, `${path}.${slot}`); assert.equal(result.error.code, 'invalid-value'); assert.ok(result.error.path.endsWith(`.addresses.${path}.${slot}`), result.error.path);
    }
  }
});

test('webrtc mdns is an exact lowercase literal: other spellings, names, types and positions are rejected', () => {
  for (const host of ['MDNS', 'Mdns', 'mDNS', ' mdns', 'mdns ', 'mdns\n', 'mdns\u0000', 'mdns.local', '.local', 'mdns:', 'm-dns', '', '00000000-0000-4000-8000-000000000000.local', 'localhost', 'host.local', true, 0, [], {}, ['mdns'], { host: 'mdns' }, undefined]) {
    for (const side of ['ipv4', 'ipv6']) {
      const bad = rtc({ ipv4: side === 'ipv4' ? { host, stun: null, turn: null } : family(), ipv6: side === 'ipv6' ? { host, stun: null, turn: null } : family() });
      assert.equal(contract.validateWebRtcProfile(bad).ok, false, side + ':' + String(host));
      assert.equal(check('webrtc', bad).ok, false, side + ':' + String(host));
    }
  }
  assert.equal(contract.validateWebRtcProfile(rtc({ host: 'mdns', stun: '192.0.2.1', turn: '192.0.2.2' })).ok, false, 'flat historical address shape');
  assert.equal(contract.validateWebRtcProfile(rtc('mdns')).ok, false, 'mdns instead of the address object');
  for (const extra of [{ iceTransportPolicy: 'mdns' }, { deviceLifetime: 'mdns' }, { randomizeDevices: 'mdns' }, { freshCertificates: 'mdns' }]) assert.equal(contract.validateWebRtcProfile(rtc(null, extra)).ok, false, JSON.stringify(extra));
  assert.equal(contract.validateWebRtcProfile(rtc({ ipv4: family({ host: 'mdns' }) })).ok, false, 'both families remain required');
  assert.equal(contract.validateWebRtcProfile(rtc({ ipv4: family({ host: 'mdns', extra: 'x' }), ipv6: family() })).ok, false);
});

test('webrtc mdns survives global, exact-site, saved-value and library storage and export/import byte-for-byte', () => {
  let config = contract.createApiConfiguration();
  config = update(config, 'webrtc', { mode: 'custom', selected: tagged(mdns('mdns', null)), userValues: [{ id: 'custom-1', label: 'mDNS both', value: tagged(mdns('mdns', 'mdns')) }] });
  config = update(config, 'webrtc', { mode: 'custom', selected: tagged(mdns(null, 'mdns')) }, 'rtc.example');
  const libraryRows = contract.API_CONFIG_CATALOG.map(({ id }) => ({ id, mode: id === 'webrtc' ? 'custom' : 'bypass', selected: id === 'webrtc' ? tagged(mdns('mdns', 'mdns')) : { kind: 'unset' }, settings: {} }));
  config.fingerprintProfiles = [{ id: 'fp-' + '0c'.repeat(16), label: 'mDNS library', preset: 'custom', webrtcNetworkPolicy: 'default_public_interface_only', apis: libraryRows, tags: [], note: '' }];
  assert.equal(contract.validateApiConfiguration(config).ok, true);
  const source = contract.exportApiConfiguration(config), restored = contract.importApiConfiguration(source);
  assert.equal(restored.ok, true); assert.equal(restored.migrated, false); assert.equal(contract.exportApiConfiguration(restored.value), source);
  assert.equal(row(restored.value, 'webrtc').selected.value.addresses.ipv4.host, 'mdns');
  assert.equal(row(restored.value, 'webrtc').selected.value.addresses.ipv6.host, null);
  assert.equal(siteRow(restored.value.sites[0], 'webrtc').selected.value.addresses.ipv6.host, 'mdns');
  assert.equal(restored.value.fingerprintProfiles[0].apis.find(entry => entry.id === 'webrtc').selected.value.addresses.ipv4.host, 'mdns');
  assert.equal(JSON.parse(source).apis.find(entry => entry.id === 'webrtc').userValues[0].value.value.addresses.ipv6.host, 'mdns');
  const tampered = JSON.parse(source); row(tampered, 'webrtc').selected.value.addresses.ipv4.turn = 'mdns';
  assert.equal(contract.importApiConfiguration(JSON.stringify(tampered)).ok, false);
});

// A valid export of a published (catalog, format) pair carrying real content in every scope.
function published(version, format, { enabled = true, antidetectEnabled = false } = {}) {
  const catalog = contract['API_CONFIG_CATALOG_V' + version];
  const value = { format: contract.API_CONFIGURATION_FORMAT, formatVersion: format, catalogVersion: version, enabled, preset: 'custom',
    apis: catalog.map(entry => ({ ...clone(entry), mode: 'bypass', selected: { kind: 'unset' }, userValues: [], settings: {} })),
    sites: [{ host: 'exact.example', disabled: false, apis: scopeRows(catalog) }, { host: 'off.example', disabled: true, apis: scopeRows(catalog) }] };
  if (format >= 2) value.webrtcNetworkPolicy = 'disable_non_proxied_udp';
  if (format >= 4) value.fingerprintProfiles = [{ id: 'fp-' + '0a'.repeat(16), label: 'Saved library profile', preset: 'custom', webrtcNetworkPolicy: 'default_public_interface_only', apis: scopeRows(catalog) }];
  if (format >= 5) value.antidetectEnabled = antidetectEnabled;
  const scopes = [value.apis, value.sites[0].apis, ...(value.fingerprintProfiles ? [value.fingerprintProfiles[0].apis] : [])];
  const set = (id, patch) => scopes.forEach((rows, index) => Object.assign(rows.find(entry => entry.id === id), patch(index)));
  set('hardware-concurrency', index => ({ mode: 'custom', selected: tagged([8, 4, 32][index]) }));
  set('geolocation', index => ({ mode: index === 1 ? 'off' : 'on' }));
  row(value, 'hardware-concurrency').userValues = [{ id: 'custom-keep', label: 'Saved CPU', value: tagged(16) }];
  if (version >= 4) {
    const profile = rtc({ ipv4: family({ host: '192.0.2.10', stun: '198.51.100.10' }), ipv6: family({ turn: '2001:db8::30' }) }, { iceTransportPolicy: 'relay' });
    set('webrtc', index => ({ mode: 'custom', selected: tagged(index === 1 ? siteProfile(profile) : profile) }));
    row(value, 'webrtc').userValues = [{ id: 'saved-rtc', label: 'Saved RTC', value: tagged(profile) }];
  }
  if (version >= 6) set('canvas-readback', index => ({ mode: 'custom', selected: tagged({ algorithm: 'stable-rgb-v1' }) }));
  return value;
}
const siteProfile = profile => ({ ...profile, randomizeDevices: true });

function assertPreserved(before, after, label) {
  assert.equal(after.format, contract.API_CONFIGURATION_FORMAT, label);
  assert.equal(after.formatVersion, contract.API_CONFIGURATION_VERSION, label); assert.equal(after.catalogVersion, contract.API_CONFIGURATION_CATALOG_VERSION, label);
  assert.equal(after.enabled, before.enabled, label); assert.equal(after.antidetectEnabled, before.antidetectEnabled ?? before.enabled, label);
  assert.equal(after.preset, before.preset, label); assert.equal(after.webrtcNetworkPolicy, before.webrtcNetworkPolicy ?? 'system', label);
  const fresh = { mode: 'bypass', selected: { kind: 'unset' }, settings: {} };
  assert.equal(after.apis.length, 158, label);
  for (const current of after.apis) {
    const old = row(before, current.id);
    if (!old) { assert.deepEqual({ mode: current.mode, selected: current.selected, settings: current.settings, userValues: current.userValues }, { ...fresh, userValues: [] }, `${label}: new row ${current.id}`); continue; }
    for (const field of ['mode', 'selected', 'userValues', 'settings']) assert.deepEqual(current[field], old[field], `${label}: ${current.id}.${field}`);
    const metadata = contract.API_CONFIG_CATALOG.find(entry => entry.id === current.id);
    assert.deepEqual(current.presets, metadata.presets, `${label}: ${current.id} carries current catalog presets`);
  }
  assert.deepEqual(after.sites.map(site => [site.host, site.disabled]), before.sites.map(site => [site.host, site.disabled]), label);
  const scopes = [...after.sites.map((site, index) => [site.apis, before.sites[index].apis]), ...(before.fingerprintProfiles ?? []).map((profile, index) => [after.fingerprintProfiles[index].apis, profile.apis])];
  for (const [rows, oldRows] of scopes) {
    assert.deepEqual(rows.map(entry => entry.id), contract.API_CONFIG_CATALOG.map(entry => entry.id), label);
    for (const current of rows) assert.deepEqual(current, oldRows.find(entry => entry.id === current.id) ?? { id: current.id, ...fresh }, `${label}: scope row ${current.id}`);
  }
  // Format 9 gives every migrated record an empty tag list and an empty note.
  assert.deepEqual((after.fingerprintProfiles ?? []).map(({ apis, tags, note, ...rest }) => rest), (before.fingerprintProfiles ?? []).map(({ apis, ...rest }) => rest), label);
  for (const profile of after.fingerprintProfiles ?? []) { assert.deepEqual(profile.tags, [], label); assert.equal(profile.note, '', label); }
}

test('every published format/catalog pair, including format7/catalog8, upgrades to the current format losslessly and idempotently', () => {
  for (const [version, format] of PAIRS) for (const [enabled, antidetectEnabled] of [[false, false], [true, false], [false, true], [true, true]]) {
    if (format < 5 && antidetectEnabled) continue;
    const label = `catalog${version}/format${format}/enabled=${enabled}/antidetect=${antidetectEnabled}`;
    const before = published(version, format, { enabled, antidetectEnabled }), kept = clone(before);
    assert.equal(before.catalogVersion, version);
    const result = contract.upgradeApiConfiguration(before);
    assert.equal(result.ok, true, `${label}: ${result.error?.code} ${result.error?.path} ${result.error?.message}`);
    assert.equal(result.migrated, true, label); assert.equal(result.upgradeFailure, undefined, label);
    assertPreserved(kept, result.value, label);
    assert.deepEqual(before, kept, label + ': the input is never mutated');
    const again = contract.upgradeApiConfiguration(result.value);
    assert.equal(again.ok, true, label); assert.equal(again.migrated, false, label); assert.deepEqual(again.value, result.value, label);
    const imported = contract.importApiConfiguration(contract.exportApiConfiguration(result.value));
    assert.equal(imported.ok, true, label); assert.equal(imported.migrated, false, label); assert.deepEqual(imported.value, result.value, label);
    const viaFile = contract.importApiConfiguration(JSON.stringify(kept));
    assert.equal(viaFile.ok, true, label); assert.equal(viaFile.migrated, true, label); assert.deepEqual(viaFile.value, result.value, label);
  }
});

test('a migrated catalog7 export can use every catalog8 capability immediately and keeps the old defaults otherwise', () => {
  const migrated = contract.upgradeApiConfiguration(published(7, 6, { enabled: true, antidetectEnabled: true }));
  assert.equal(migrated.ok, true);
  let config = migrated.value;
  assert.equal(row(config, 'geolocation').mode, 'on', 'the old block survives');
  assert.deepEqual(row(config, 'canvas-readback').selected, tagged({ algorithm: 'stable-rgb-v1' }), 'the old Canvas algorithm is kept, not silently upgraded');
  assert.deepEqual(row(config, 'webrtc').selected.value.addresses.ipv4.host, '192.0.2.10');
  config = update(config, 'geolocation', { mode: 'custom', selected: tagged(geo(48.8566, 2.3522)) }, 'exact.example');
  config = update(config, 'canvas-readback', { mode: 'custom', selected: tagged({ algorithm: 'sparse-rgb-v1' }) });
  config = update(config, 'webrtc', { mode: 'custom', selected: tagged(mdns('mdns', null)) }, 'exact.example');
  assert.equal(contract.importApiConfiguration(contract.exportApiConfiguration(config)).ok, true);
  assert.equal(config.fingerprintProfiles.length, 1); assert.equal(config.webrtcNetworkPolicy, 'disable_non_proxied_udp');
});

// Where a V8-only value can hide in an older export: selected value in any mode, saved value, exact site, library profile.
const PLACEMENTS = {
  'global custom': (doc, id, value) => Object.assign(row(doc, id), { mode: 'custom', selected: value }),
  'global off with a stored selection': (doc, id, value) => Object.assign(row(doc, id), { mode: 'off', selected: value }),
  'saved value': (doc, id, value) => { row(doc, id).userValues = [{ id: 'saved', label: 'Saved', value }]; },
  'exact site': (doc, id, value) => Object.assign(siteRow(doc.sites[0], id), { mode: 'custom', selected: value }),
  'library profile': (doc, id, value) => Object.assign(siteRow(doc.fingerprintProfiles[0], id), { mode: 'custom', selected: value })
};
// [row, value, first catalog that accepts it, expected error code in older catalogs]
const NEWER_VALUES = [
  ['geolocation', tagged(geo(40.7128, -74.006)), 8, () => 'unsupported-value'],
  ['canvas-readback', tagged({ algorithm: 'sparse-rgb-v1' }), 8, version => version >= 6 ? 'invalid-value' : 'unsupported-value'],
  ['webrtc', tagged(mdns('mdns', null)), 8, version => version >= 3 ? 'invalid-value' : 'unsupported-value'],
  ['speech-voices', tagged({ languages: ['en-US'] }), 9, () => 'invalid-type'],
  ['media-capabilities', tagged({ supported: true, smooth: true, powerEfficient: false, hidden: ['h265'] }), 10, () => 'unknown-field']
];

test('values newer than a catalog are rejected by every older format, in every place they can be stored, before any migration starts', () => {
  let rejected = 0;
  for (const [version, format] of PAIRS) for (const [id, value, since, code] of NEWER_VALUES) for (const [where, place] of Object.entries(PLACEMENTS)) {
    if (version >= since || where === 'library profile' && format < 4) continue;
    const doc = published(version, format); place(doc, id, value);
    const kept = clone(doc), label = `catalog${version}/format${format} ${id} ${where}`;
    for (const result of [contract.upgradeApiConfiguration(doc), contract.importApiConfiguration(JSON.stringify(doc))]) {
      assert.equal(result.ok, false, label); assert.equal(result.upgradeFailure, undefined, label + ': refused before the upgrade started');
      assert.ok(['unsupported-value', 'invalid-value', 'missing-field', 'invalid-type', 'unknown-field'].includes(result.error.code), `${label}: ${result.error.code}`);
      if (version === since - 1) assert.equal(result.error.code, code(version), label);
      rejected++;
    }
    assert.deepEqual(doc, kept, label + ': the input is never mutated');
  }
  assert.ok(rejected > 100, 'matrix size: ' + rejected);
});

test('catalog7 still accepts every catalog7 value of the three expanded rows and their identity survives the upgrade', () => {
  const doc = published(7, 6);
  row(doc, 'webrtc').userValues = [{ id: 'saved-rtc', label: 'Saved RTC', value: tagged(rtc({ ipv4: family({ host: '192.0.2.10' }), ipv6: family({ host: '2001:db8::10' }) })) }];
  const result = contract.upgradeApiConfiguration(doc);
  assert.equal(result.ok, true); assert.deepEqual(row(result.value, 'webrtc').userValues, row(doc, 'webrtc').userValues);
  assert.deepEqual(row(result.value, 'canvas-readback').selected, tagged({ algorithm: 'stable-rgb-v1' }));
  for (const bad of [{ algorithm: 'stable-rgb-v2' }, { algorithm: 'random' }]) {
    const stale = published(7, 6); Object.assign(row(stale, 'canvas-readback'), { mode: 'custom', selected: tagged(bad) });
    assert.equal(contract.upgradeApiConfiguration(stale).error.code, 'invalid-value');
  }
});

test('the flat catalog3 address shape never accepts mdns either', () => {
  for (const flat of [{ host: 'mdns', stun: '198.51.100.10', turn: '203.0.113.10' }, { host: '192.0.2.10', stun: 'mdns', turn: '203.0.113.10' }, { host: '192.0.2.10', stun: '198.51.100.10', turn: 'mdns' }]) {
    const doc = published(3, 2); Object.assign(row(doc, 'webrtc'), { mode: 'custom', selected: tagged(rtc(flat)) });
    const result = contract.upgradeApiConfiguration(doc);
    assert.equal(result.ok, false, JSON.stringify(flat)); assert.equal(result.error.code, 'invalid-value'); assert.equal(result.upgradeFailure, undefined);
  }
  const doc = published(3, 2); Object.assign(row(doc, 'webrtc'), { mode: 'custom', selected: tagged(rtc({ host: '192.0.2.10', stun: '198.51.100.10', turn: '203.0.113.10' })) });
  const result = contract.upgradeApiConfiguration(doc);
  assert.equal(result.ok, true); assert.deepEqual(row(result.value, 'webrtc').selected.value.addresses, { ipv4: { host: '192.0.2.10', stun: '198.51.100.10', turn: '203.0.113.10' }, ipv6: family() });
});

test('catalog8 metadata is pinned both ways: catalog8 rows cannot hide in a catalog7 file and catalog7 rows cannot pose as catalog8', () => {
  const asV7 = contract.upgradeApiConfiguration({ ...published(8, 7), formatVersion: 6, catalogVersion: 7 });
  assert.equal(asV7.ok, false); assert.equal(asV7.error.code, 'catalog-mismatch'); assert.equal(asV7.upgradeFailure, undefined);
  assert.equal(asV7.error.path, '$.apis[' + contract.API_CONFIG_CATALOG.findIndex(item => item.id === 'canvas-readback') + ']', 'the first expanded row is named');
  const current = JSON.parse(contract.exportApiConfiguration(contract.createApiConfiguration()));
  for (const [format, catalog] of [[5, 6], [4, 6], [3, 5], [3, 4]]) assert.equal(contract.upgradeApiConfiguration({ ...current, formatVersion: format, catalogVersion: catalog }).ok, false, `${format}/${catalog}`);
  assert.equal(contract.upgradeApiConfiguration({ ...published(7, 6), formatVersion: 7, catalogVersion: 8 }).error.code, 'catalog-mismatch');
  for (const id of EXPANDED_ROWS) {
    const v7 = contract.API_CONFIG_CATALOG_V7.find(item => item.id === id), v8 = contract.API_CONFIG_CATALOG_V8.find(item => item.id === id);
    let differing = 0;
    for (const field of ['name', 'customReason', 'customSupported', 'presets', 'type', 'valueHint']) {
      if (JSON.stringify(v7[field]) === JSON.stringify(v8[field])) continue;
      differing++;
      const forged = published(7, 6); row(forged, id)[field] = clone(v8[field]);
      assert.equal(contract.upgradeApiConfiguration(forged).error.code, 'catalog-mismatch', `${id}.${field} of catalog8 in a catalog7 file`);
      const old = published(8, 7); row(old, id)[field] = clone(v7[field]);
      assert.equal(contract.upgradeApiConfiguration(old).error?.code, 'catalog-mismatch', `${id}.${field} of catalog7 in a catalog8 file`);
    }
    assert.ok(differing > 0, id + ' differs from catalog 7');
  }
});

test('only the published format/catalog pairs and the current one are accepted; every other label pair is incompatible', () => {
  const current = JSON.parse(contract.exportApiConfiguration(contract.createApiConfiguration()));
  const accepted = new Set(['10/11', '9/10']);
  for (let format = 0; format <= 11; format++) for (let catalog = 0; catalog <= 12; catalog++) {
    if (accepted.has(`${format}/${catalog}`)) continue;
    const result = contract.upgradeApiConfiguration({ ...current, formatVersion: format, catalogVersion: catalog });
    assert.equal(result.ok, false, `${format}/${catalog}`);
    if (!PAIRS.some(([version, published]) => version === catalog && published === format)) assert.equal(result.error.code, 'incompatible-version', `${format}/${catalog}`);
  }
  for (const [version, format] of PAIRS) assert.equal(contract.upgradeApiConfiguration(published(version, format)).ok, true, `${format}/${version}`);
  assert.equal(contract.upgradeApiConfiguration(current).migrated, false);
  assert.equal(contract.upgradeApiConfiguration({ ...current, formatVersion: 7, catalogVersion: 8, extra: true }).error.code, 'unknown-field');
});

test('the production contract mirror is the canonical contract with browser imports (run sync-api-configuration.mjs after edits)', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  const browserImports = source => source.replaceAll("from './protection-features.mjs'", "from './api-protection-features.js'").replaceAll("from './webassembly-apis.mjs'", "from './webassembly-apis.js'").replaceAll("from './math-functions.mjs'", "from './math-functions.js'").replaceAll("from './fingerprint-custom-values.mjs'", "from './fingerprint-custom-values.js'");
  assert.equal(read('../../apps/production-extension/api-configuration.js'), browserImports(read('../../packages/contracts/src/api-configuration.mjs')));
  assert.equal(read('../../apps/production-extension/fingerprint-custom-values.js'), read('../../packages/contracts/src/fingerprint-custom-values.mjs'));
});

test('the real catalog7 default export captured from the published code is reproduced byte-for-byte and imports as the current default', () => {
  const metadata = ({ id, order, name, group, type, customSupported, customReason, valueHint, allowNull, allowUndefined, presets }) => ({ id, order, name, group, type, customSupported, customReason, valueHint, allowNull, allowUndefined, presets });
  const doc = { format: contract.API_CONFIGURATION_FORMAT, formatVersion: 6, catalogVersion: 7, enabled: false, antidetectEnabled: false, preset: 'limited', webrtcNetworkPolicy: 'system',
    apis: contract.API_CONFIG_CATALOG_V7.map(entry => ({ ...metadata(entry), mode: 'bypass', userValues: [], selected: { kind: 'unset' }, settings: {} })), sites: [], fingerprintProfiles: [] };
  const source = JSON.stringify(doc, null, 2) + '\n';
  // SHA-256 of exportApiConfiguration(createApiConfiguration()) as produced by the catalog7 code before catalog8 existed.
  assert.equal(createHash('sha256').update(source).digest('hex'), '589b60d8f6e97dce7feb523b9f5915d0461bbf4803636419499548f953c74329');
  assert.equal(Buffer.byteLength(source), 129104);
  const result = contract.importApiConfiguration(source);
  assert.equal(result.ok, true, result.error?.message); assert.equal(result.migrated, true);
  assert.equal(contract.exportApiConfiguration(result.value), contract.exportApiConfiguration(contract.createApiConfiguration()));
});
