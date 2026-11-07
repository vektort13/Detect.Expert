// ADR-107 round 5: temporary profiles (fingerprint-temporary.js): the stored record and its strict validation, the start-up plan, the overlay that
// restores the remembered state, and the store over storage.local / storage.session.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiConfiguration, updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { applyFingerprintProfile, generateConsistentDevice, snapshotFingerprintProfile, storeFingerprintProfile } from '../../apps/production-extension/fingerprint-profiles.js';
import { TEMPORARY_KEY, TEMPORARY_LIVE_KEY, TEMPORARY_MAX_BYTES, TEMPORARY_LABEL_MAX, TemporaryError, temporaryLabel, readTemporaryRecord, buildTemporaryRecord, buildLiveMarker, isLiveMarker, temporaryStartupPlan, overlayProfile, revertTemporaryConfiguration, createTemporaryStore } from '../../apps/production-extension/fingerprint-temporary.js';
import { device, library, clone, fakeStorage, ENVIRONMENT, UNSAFE } from './fingerprint-identity-fixtures.mjs';

const START = 1_800_000_000_000;
const previousProfile = (label = 'previous') => device(label, { id: 'fp-' + '0d'.repeat(16), seed: 3 });
const record = (extra = {}) => ({ version: 1, startedAt: START, label: 'Temporary one', previous: previousProfile(), ...extra });
// The real generator's configuration layered over an empty one: what a temporary identity applies.
const generated = (seed, protection = 'balanced') => generateConsistentDevice(createApiConfiguration(), { deviceType: 'desktop', os: 'windows-11', browser: 'chrome', version: 153, protection, seed }, ENVIRONMENT).configuration;

test('keys and limits', () => {
  assert.equal(TEMPORARY_KEY, 'fingerprint-temporary:v1'); assert.equal(TEMPORARY_LIVE_KEY, 'fingerprint-temporary-live:v1'); assert.equal(TEMPORARY_MAX_BYTES, 262144); assert.equal(TEMPORARY_LABEL_MAX, 160);
});

test('the label is cosmetic: refused characters are dropped, whitespace collapses, the length is bounded without splitting a surrogate pair', () => {
  assert.equal(temporaryLabel('  Day ' + UNSAFE.rlo + ' trip' + String.fromCharCode(0xa0) + ' '), 'Day trip'); assert.equal(temporaryLabel(UNSAFE.rlo + UNSAFE.bell), ''); assert.equal(temporaryLabel(null), '');
  const long = temporaryLabel('x'.repeat(150) + String.fromCodePoint(0x1f600).repeat(8)); assert.ok(long.length <= TEMPORARY_LABEL_MAX);
  for (let index = 0; index < long.length; index++) { const unit = long.charCodeAt(index); if (unit >= 0xd800 && unit <= 0xdbff) assert.ok(long.charCodeAt(index + 1) >= 0xdc00); }
});

test('buildTemporaryRecord produces exactly {version, startedAt, label, previous} and refuses a bad label, time, snapshot or size', () => {
  const built = buildTemporaryRecord({ startedAt: START, label: ' Temporary one ', previous: previousProfile() });
  assert.deepEqual(Object.keys(built), ['version', 'startedAt', 'label', 'previous']); assert.equal(built.label, 'Temporary one'); assert.equal(built.version, 1);
  const code = input => { try { buildTemporaryRecord(input); } catch (failure) { assert.ok(failure instanceof TemporaryError); return failure.code; } return null; };
  const ok = { startedAt: START, label: 'x', previous: previousProfile() };
  for (const bad of [{ ...ok, label: '' }, { ...ok, label: '   ' }, { ...ok, label: 'x'.repeat(161) }, { ...ok, label: 'a' + UNSAFE.rlo }, { ...ok, label: 5 }, { ...ok, startedAt: 0 }, { ...ok, startedAt: 1.5 }, { ...ok, startedAt: '5' },
    { ...ok, previous: null }, { ...ok, previous: { ...ok.previous, id: 'x' } }, { ...ok, previous: { ...ok.previous, apis: [] } }]) assert.equal(code(bad), 'invalid', JSON.stringify(bad).slice(0, 80));
  assert.throws(() => buildTemporaryRecord(ok, 100), error => error.code === 'too-large');
});

test('readTemporaryRecord trusts nothing: shape, version, time, label and the profile snapshot are all checked', () => {
  const good = readTemporaryRecord(record()); assert.equal(good.startedAt, START); assert.equal(good.label, 'Temporary one'); assert.deepEqual(good.previous, previousProfile());
  for (const bad of [undefined, null, 5, 'x', [], {}, { ...record(), extra: 1 }, { ...record(), version: 2 }, { ...record(), version: '1' }, { ...record(), startedAt: 0 }, { ...record(), startedAt: 1.5 }, { ...record(), startedAt: '1' },
    { ...record(), label: 5 }, { ...record(), label: 'x'.repeat(161) }, { ...record(), previous: null }, { ...record(), previous: [] }, { ...record(), previous: { ...previousProfile(), apis: previousProfile().apis.slice(1) } },
    { ...record(), previous: { ...previousProfile(), id: 'bad' } }, { ...record(), previous: { ...previousProfile(), tags: ['a', 'A'] } }, { ...record(), previous: { ...previousProfile(), webrtcNetworkPolicy: 'nope' } }, { version: 1, startedAt: START, label: 'x' }]) {
    assert.equal(readTemporaryRecord(bad), null, JSON.stringify(bad)?.slice(0, 90));
  }
  assert.equal(readTemporaryRecord(record(), 100), null, 'over the size cap');
  assert.equal(readTemporaryRecord(record({ label: 'Trip ' + UNSAFE.rlo + 'x' })).label, 'Trip x', 'a refused character in the label is dropped, the record stays usable');
  let ran = false; const accessor = { ...record() }; Object.defineProperty(accessor, 'label', { enumerable: true, get() { ran = true; return 'x'; } });
  assert.equal(readTemporaryRecord(accessor), null); assert.equal(ran, false, 'an accessor is never invoked');
});

test('the live marker is {version, startedAt}; the start-up plan reverts only a valid record without it', () => {
  assert.deepEqual(buildLiveMarker(START), { version: 1, startedAt: START });
  for (const bad of [undefined, null, {}, { version: 1 }, { version: 2, startedAt: START }, { version: 1, startedAt: 0 }, { version: 1, startedAt: START, extra: 1 }, 'x', true]) assert.equal(isLiveMarker(bad), false, JSON.stringify(bad));
  assert.equal(isLiveMarker(buildLiveMarker(START)), true);
  assert.deepEqual(temporaryStartupPlan(undefined, undefined), { action: 'none' }); assert.deepEqual(temporaryStartupPlan(undefined, buildLiveMarker(START)), { action: 'none' });
  assert.equal(temporaryStartupPlan(record(), buildLiveMarker(START)).action, 'none', 'same browser session');
  const revert = temporaryStartupPlan(record(), undefined); assert.equal(revert.action, 'revert'); assert.deepEqual(revert.record.previous, previousProfile());
  assert.equal(temporaryStartupPlan(record(), { version: 1 }).action, 'revert', 'a malformed marker is no marker');
  for (const bad of [null, {}, { ...record(), version: 2 }, 'x']) assert.equal(temporaryStartupPlan(bad, buildLiveMarker(START)).action, 'discard');
});

test('overlayProfile equals applying a library profile: rows, preset and WebRTC policy are replaced, the masters, sites and library stay', () => {
  const profile = snapshotFingerprintProfile(generated(11, 'strict'), 'Layered', 'fp-' + '1a'.repeat(16)), other = device('Elsewhere', { id: 'fp-' + '2b'.repeat(16), seed: 4, tags: ['kept'], note: 'kept' });
  let base = storeFingerprintProfile(library([other]), profile);
  base = updateApiConfiguration({ ...base, enabled: true, antidetectEnabled: true, preset: 'limited', webrtcNetworkPolicy: 'system' }, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 6 } }, 'example.com').value;
  assert.equal(base.sites.length, 1);
  const expected = applyFingerprintProfile(base, profile.id), frozen = JSON.stringify(base), layered = overlayProfile(base, profile);
  assert.deepEqual(layered, expected); assert.equal(JSON.stringify(base), frozen, 'the input is not mutated');
  assert.equal(layered.enabled, true); assert.equal(layered.antidetectEnabled, true); assert.deepEqual(layered.sites, base.sites); assert.deepEqual(layered.fingerprintProfiles, base.fingerprintProfiles);
  assert.equal(layered.preset, profile.preset); assert.equal(layered.webrtcNetworkPolicy, profile.webrtcNetworkPolicy);
  for (const row of profile.apis) { const found = layered.apis.find(item => item.id === row.id); assert.equal(found.mode, row.mode, row.id); assert.deepEqual(found.selected, row.selected, row.id); }
  for (const bad of [null, {}, { apis: 'x' }]) assert.equal(overlayProfile(base, bad), null);
  assert.equal(overlayProfile({ apis: [] }, profile), null, 'an invalid configuration gives null, never a throw');
});

test('revertTemporaryConfiguration lays the remembered rows over the CURRENT configuration and says whether anything changed', () => {
  const before = generated(5), previous = snapshotFingerprintProfile(before, 'previous', 'fp-' + '3c'.repeat(16));
  const applied = overlayProfile(before, snapshotFingerprintProfile(generated(99, 'strict'), 'temp', 'fp-' + '4d'.repeat(16)));
  const withLibrary = storeFingerprintProfile({ ...applied, enabled: true }, device('Added during the session', { id: 'fp-' + '5e'.repeat(16) }));
  const reverted = revertTemporaryConfiguration(withLibrary, previous);
  assert.equal(reverted.changed, true); assert.deepEqual(reverted.configuration.apis.map(row => [row.id, row.mode, row.selected]), before.apis.map(row => [row.id, row.mode, row.selected]), 'the rows are the remembered ones');
  assert.equal(reverted.configuration.enabled, true, 'the master the user set meanwhile stays'); assert.equal(reverted.configuration.fingerprintProfiles.length, 1, 'a library change made meanwhile stays');
  const again = revertTemporaryConfiguration(reverted.configuration, previous); assert.equal(again.changed, false); assert.deepEqual(again.configuration, reverted.configuration);
  assert.equal(revertTemporaryConfiguration({ nope: true }, previous), null); assert.equal(revertTemporaryConfiguration(withLibrary, null), null);
});

test('the store: unavailable without session storage; begin writes the marker first, then the record; end removes the record first', async () => {
  assert.equal(createTemporaryStore(fakeStorage()).available(), false); assert.equal(createTemporaryStore(undefined).available(), false);
  const storage = fakeStorage({ session: {} }), store = createTemporaryStore(storage); assert.equal(store.available(), true);
  assert.deepEqual(await store.read(), { record: null, live: false, malformed: false });
  const written = await store.begin({ startedAt: START, label: 'Trip', previous: previousProfile() });
  assert.deepEqual(storage.log.map(entry => entry.slice(0, 2).join(':')), ['session:set', 'local:set'], 'the marker comes first');
  assert.deepEqual(storage.data.session[TEMPORARY_LIVE_KEY], buildLiveMarker(START)); assert.deepEqual(storage.data.local[TEMPORARY_KEY], written);
  const read = await store.read(); assert.equal(read.live, true); assert.equal(read.record.label, 'Trip'); assert.equal(read.malformed, false);
  storage.log.length = 0; await store.end();
  assert.deepEqual(storage.log.map(entry => entry.slice(0, 2).join(':')), ['local:remove', 'session:remove'], 'the record goes first'); assert.deepEqual(await store.read(), { record: null, live: false, malformed: false });
  // A malformed stored record reads as malformed, not as a record.
  storage.data.local[TEMPORARY_KEY] = { junk: true }; assert.deepEqual(await store.read(), { record: null, live: false, malformed: true });
});

test('begin leaves nothing behind when the record cannot be written, and refuses a bad record before writing anything', async () => {
  const storage = fakeStorage({ session: {}, failSet: area => area === 'local' }), store = createTemporaryStore(storage);
  await assert.rejects(store.begin({ startedAt: START, label: 'Trip', previous: previousProfile() }));
  assert.equal(Object.hasOwn(storage.data.session, TEMPORARY_LIVE_KEY), false, 'the marker is taken back'); assert.equal(Object.hasOwn(storage.data.local, TEMPORARY_KEY), false);
  const clean = fakeStorage({ session: {} }); await assert.rejects(createTemporaryStore(clean).begin({ startedAt: 0, label: 'x', previous: previousProfile() }), error => error instanceof TemporaryError); assert.deepEqual(clean.log, []);
  void clone;
});
