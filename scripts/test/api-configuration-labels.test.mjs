// ADR-107 label hardening: imported files and new or renamed labels refuse C0/C1 controls and bidirectional formatting
// controls, while configurations that are already stored keep loading. Characters are built from code points only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as contract from '../../packages/contracts/src/api-configuration.mjs';

const char = code => String.fromCodePoint(code);
const tagged = value => ({ kind: 'value', value });
const row = (config, id) => config.apis.find(entry => entry.id === id);
const copy = value => structuredClone(value);
const REFUSED = [0x00, 0x01, 0x09, 0x0a, 0x0d, 0x1b, 0x1f, 0x7f, 0x80, 0x85, 0x9f, 0x61c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
// Letters of right-to-left scripts, no-break space, zero-width joiner (emoji sequences) and astral emoji stay allowed.
const ALLOWED = [0x20, 0x7e, 0xa0, 0x401, 0x5d0, 0x627, 0x200d, 0x1f600];
const saved = (id, label, value = 16) => ({ id, label, value: tagged(value) });
const profileRows = () => contract.API_CONFIG_CATALOG.map(({ id }) => ({ id, mode: 'bypass', selected: { kind: 'unset' }, settings: {} }));
const profile = (suffix, label) => ({ id: 'fp-' + suffix.repeat(16), label, preset: 'custom', webrtcNetworkPolicy: 'system', apis: profileRows(), tags: [], note: '' });
// Older formats have no tags and no note (exact field sets).
const olderProfiles = profiles => profiles.map(({ tags, note, ...rest }) => rest);
const unsafe = 'Work ' + char(0x202e) + 'txt.exe';
// A configuration as it may already sit in storage from an older build: labels were not checked before catalog 8.
function stored() {
  const config = contract.createApiConfiguration();
  row(config, 'hardware-concurrency').userValues = [saved('custom-1', unsafe), saved('custom-2', 'Clean label')];
  config.fingerprintProfiles = [profile('0a', 'Profile ' + char(0x0a) + 'two lines'), profile('0b', 'Clean profile')];
  return config;
}

test('apiLabelSafe refuses every listed control at any position and keeps right-to-left letters and emoji', () => {
  for (const code of REFUSED) for (const label of [char(code), 'a' + char(code), char(code) + 'b', 'a' + char(code) + 'b']) assert.equal(contract.apiLabelSafe(label), false, 'U+' + code.toString(16));
  for (const code of ALLOWED) assert.equal(contract.apiLabelSafe('Label ' + char(code) + ' end'), true, 'U+' + code.toString(16));
  assert.equal(contract.apiLabelSafe(char(0x5d0) + char(0x5d1) + ' ' + char(0x627) + char(0x644)), true, 'plain RTL text without formatting controls');
  for (const value of [null, undefined, 1, [], {}, { toString: () => 'x' }]) assert.equal(contract.apiLabelSafe(value), false);
  assert.equal(contract.apiLabelSafe(''), true, 'length limits are checked by the validators, not here');
});

test('configurations already stored keep loading, validating and upgrading with their old labels', () => {
  const config = stored(), before = copy(config);
  const read = contract.validateApiConfiguration(config);
  assert.equal(read.ok, true, read.error?.message);
  assert.equal(row(read.value, 'hardware-concurrency').userValues[0].label, unsafe);
  const upgraded = contract.upgradeApiConfiguration(config);
  assert.equal(upgraded.ok, true); assert.equal(upgraded.migrated, false);
  assert.ok(contract.exportApiConfiguration(config).length > 0, 'the stored state can still be exported as shown');
  assert.deepEqual(config, before);
  // The same holds for an older stored catalog that the controller migrates on startup.
  const legacy = copy(config); legacy.formatVersion = 6; legacy.catalogVersion = 7; legacy.fingerprintProfiles = olderProfiles(legacy.fingerprintProfiles);
  legacy.apis = legacy.apis.map(entry => ({ ...copy(contract.API_CONFIG_CATALOG_V7.find(item => item.id === entry.id)), mode: entry.mode, userValues: entry.userValues, selected: entry.selected, settings: entry.settings }));
  const migrated = contract.upgradeApiConfiguration(legacy);
  assert.equal(migrated.ok, true, migrated.error?.message); assert.equal(migrated.migrated, true);
  assert.equal(migrated.value.fingerprintProfiles[0].label, 'Profile ' + char(0x0a) + 'two lines');
});

test('importing a file refuses unsafe saved-value and profile labels in current and historical formats', () => {
  const config = stored();
  const both = contract.importApiConfiguration(contract.exportApiConfiguration(config));
  assert.equal(both.ok, false); assert.equal(both.error.code, 'unsafe-label');
  assert.match(both.error.path, /^\$\.apis\[\d+\]\.userValues\[0\]\.label$/);
  const profileOnly = copy(config); row(profileOnly, 'hardware-concurrency').userValues = [saved('custom-2', 'Clean label')];
  const second = contract.importApiConfiguration(JSON.stringify(profileOnly));
  assert.equal(second.error.code, 'unsafe-label'); assert.equal(second.error.path, '$.fingerprintProfiles[0].label');
  const historical = copy(profileOnly); historical.formatVersion = 6; historical.catalogVersion = 7; historical.fingerprintProfiles = olderProfiles(historical.fingerprintProfiles);
  historical.apis = historical.apis.map(entry => ({ ...copy(contract.API_CONFIG_CATALOG_V7.find(item => item.id === entry.id)), mode: entry.mode, userValues: entry.userValues, selected: entry.selected, settings: entry.settings }));
  assert.equal(contract.upgradeApiConfiguration(historical).ok, true, 'storage path stays lenient');
  assert.equal(contract.importApiConfiguration(JSON.stringify(historical)).error.code, 'unsafe-label', 'file path is strict for every format');
  for (const code of REFUSED) {
    const clean = contract.createApiConfiguration(); row(clean, 'hardware-concurrency').userValues = [saved('custom-1', 'x' + char(code))];
    assert.equal(contract.importApiConfiguration(JSON.stringify(clean)).error?.code, 'unsafe-label', 'U+' + code.toString(16));
  }
  const fine = contract.createApiConfiguration();
  row(fine, 'hardware-concurrency').userValues = [saved('custom-1', char(0x5d0) + ' ' + char(0x1f600) + ' ' + char(0x401))];
  fine.fingerprintProfiles = [profile('0c', 'Profile ' + char(0x627))];
  const accepted = contract.importApiConfiguration(contract.exportApiConfiguration(fine));
  assert.equal(accepted.ok, true, accepted.error?.message); assert.equal(accepted.migrated, false);
});

test('updateApiConfiguration refuses new or renamed unsafe labels and keeps unchanged stored ones', () => {
  const config = stored(), before = copy(config), list = row(config, 'hardware-concurrency').userValues;
  const update = (patch, host = null) => contract.updateApiConfiguration(config, 'hardware-concurrency', patch, host);
  const kept = update({ mode: 'custom', selected: tagged(8) });
  assert.equal(kept.ok, true, kept.error?.message);
  assert.equal(update({ userValues: [...list, saved('custom-3', 'New ' + char(0x2066))] }).error.code, 'unsafe-label');
  assert.equal(update({ userValues: [saved('custom-1', unsafe + ' renamed'), list[1]] }).error.code, 'unsafe-label', 'a renamed label is new input');
  assert.equal(update({ userValues: [list[0], list[1], saved('custom-9', unsafe)] }).error.code, 'unsafe-label', 'an old label copied to another id is new input');
  assert.equal(update({ userValues: [saved('custom-1', unsafe, 32), list[1]] }).ok, true, 'changing only the value keeps the stored label');
  const renamed = update({ userValues: [saved('custom-1', 'Work file'), list[1]] });
  assert.equal(renamed.ok, true); assert.equal(row(renamed.value, 'hardware-concurrency').userValues[0].label, 'Work file');
  assert.equal(update({ userValues: [...list, saved('custom-3', 'Site ' + char(0x1b))] }, 'exact.example').error.code, 'unsafe-label', 'site edits share the global library');
  assert.equal(update({ mode: 'custom', selected: tagged(4) }, 'exact.example').ok, true);
  assert.deepEqual(config, before);
});

test('validateApiConfigurationWrite grandfathers only unchanged labels of the previous stored state', () => {
  const previous = stored(), next = copy(previous);
  const same = contract.validateApiConfigurationWrite(next, previous);
  assert.equal(same.ok, true); assert.deepEqual(same.value, contract.validateApiConfiguration(next).value);
  for (const missing of [null, undefined]) assert.equal(contract.validateApiConfigurationWrite(next, missing).error.code, 'unsafe-label');
  assert.equal(contract.validateApiConfigurationWrite(next).error.code, 'unsafe-label');
  assert.equal(contract.validateApiConfigurationWrite(next, { broken: true }).error.code, 'unsafe-label', 'an invalid previous state grandfathers nothing');
  const added = copy(previous); added.fingerprintProfiles.push(profile('0d', 'New ' + char(0x200f)));
  assert.equal(contract.validateApiConfigurationWrite(added, previous).error.path, '$.fingerprintProfiles[2].label');
  const renamed = copy(previous); renamed.fingerprintProfiles[0].label = 'Profile ' + char(0x0d) + 'changed';
  assert.equal(contract.validateApiConfigurationWrite(renamed, previous).error.code, 'unsafe-label');
  const moved = copy(previous); moved.fingerprintProfiles[1].label = moved.fingerprintProfiles[0].label;
  assert.equal(contract.validateApiConfigurationWrite(moved, previous).error.code, 'unsafe-label', 'a label is bound to its profile id');
  const cleaned = copy(previous); cleaned.fingerprintProfiles[0].label = 'Profile two lines'; row(cleaned, 'hardware-concurrency').userValues[0].label = 'Work file';
  assert.equal(contract.validateApiConfigurationWrite(cleaned, previous).ok, true);
  const invalid = copy(previous); invalid.apis.pop();
  assert.equal(contract.validateApiConfigurationWrite(invalid, previous).error.code, 'missing-api', 'structural errors are reported first');
});
