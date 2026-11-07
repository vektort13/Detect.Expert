// Three-way merge of a pending draft with a newer saved revision (master switch vs Randomize preview).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration, updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, mergeConfigurations, snapshotFingerprintProfile, storeFingerprintProfile } from '../../apps/production-extension/fingerprint-profiles.js';

const clone = value => structuredClone(value);
const base = () => createApiConfiguration();
const row = (configuration, id) => configuration.apis.find(item => item.id === id);

test('a draft nobody edited takes the newer revision unchanged', () => {
  const origin = base(), theirs = { ...clone(origin), antidetectEnabled: true };
  assert.deepEqual(mergeConfigurations(origin, clone(origin), theirs), theirs);
});

test('the master switch saved elsewhere is kept together with every previewed row', () => {
  const origin = base(), mine = generateConsistentDevice(origin, { seed: 5 }).configuration, theirs = { ...clone(origin), antidetectEnabled: true, enabled: true };
  const merged = mergeConfigurations(origin, mine, theirs);
  assert.ok(merged); assert.equal(merged.antidetectEnabled, true); assert.equal(merged.enabled, true);
  assert.deepEqual(merged.apis, mine.apis, 'the previewed rows survive');
  assert.deepEqual(Object.keys(merged), Object.keys(theirs), 'key order follows the saved state');
});

test('edits to different rows on both sides are combined', () => {
  const origin = base();
  const mine = updateApiConfiguration(origin, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 8 } }).value;
  const theirs = updateApiConfiguration(origin, 'device-memory', { mode: 'custom', selected: { kind: 'value', value: 4 } }).value;
  const merged = mergeConfigurations(origin, mine, theirs);
  assert.ok(merged); assert.equal(row(merged, 'hardware-concurrency').selected.value, 8); assert.equal(row(merged, 'device-memory').selected.value, 4);
});

test('the same row edited differently on both sides is a conflict, an identical edit is not', () => {
  const origin = base(), edit = value => updateApiConfiguration(origin, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value } }).value;
  assert.equal(mergeConfigurations(origin, edit(8), edit(12)), null);
  assert.ok(mergeConfigurations(origin, edit(8), edit(8)));
});

test('a profile saved elsewhere joins the library without touching the preview', () => {
  const origin = base(), mine = generateConsistentDevice(origin, { seed: 9 }).configuration;
  const theirs = storeFingerprintProfile(origin, snapshotFingerprintProfile(mine, 'Saved in another window'));
  const merged = mergeConfigurations(origin, mine, theirs);
  assert.ok(merged); assert.equal(merged.fingerprintProfiles.length, 1); assert.deepEqual(merged.apis, mine.apis);
});

test('missing or malformed input and a changed catalogue are refused instead of guessed', () => {
  const origin = base();
  assert.equal(mergeConfigurations(null, origin, origin), null); assert.equal(mergeConfigurations(origin, null, origin), null); assert.equal(mergeConfigurations(origin, origin, undefined), null);
  const shorter = { ...clone(origin), apis: clone(origin.apis).slice(1) };
  assert.equal(mergeConfigurations(origin, origin, shorter), null);
  assert.equal(mergeConfigurations(origin, shorter, origin), null);
});
