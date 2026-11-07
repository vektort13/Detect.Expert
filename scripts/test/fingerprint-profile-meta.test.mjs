// ADR-107 round 5: tags and notes of library profiles (portable, part of the format 9 profile record). Pure helpers of fingerprint-profiles.js:
// normalizeProfileTags, normalizeProfileNote and editProfileMeta; duplicates keep them, export/import carries them, stored texts are grandfathered.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiConfiguration, validateApiConfiguration, validateApiConfigurationWrite, importApiConfiguration, exportApiConfiguration, API_PROFILE_MAX_TAGS, API_PROFILE_TAG_MAX, API_PROFILE_NOTE_MAX } from '../../apps/production-extension/api-configuration.js';
import { normalizeProfileTags, normalizeProfileNote, editProfileMeta, snapshotFingerprintProfile, storeFingerprintProfile, PROFILE_META_LIMITS, FingerprintProfileError } from '../../apps/production-extension/fingerprint-profiles.js';
import { duplicateFingerprintProfile } from '../../apps/production-extension/fingerprint-library-ui.js';
import { device, library, clone, UNSAFE, LF, CR } from './fingerprint-identity-fixtures.mjs';

const codeOf = action => { try { action(); } catch (failure) { assert.ok(failure instanceof FingerprintProfileError, String(failure)); return failure.code; } return null; };

test('the limits are the contract constants', () => {
  assert.deepEqual({ ...PROFILE_META_LIMITS }, { tags: API_PROFILE_MAX_TAGS, tag: API_PROFILE_TAG_MAX, note: API_PROFILE_NOTE_MAX });
  assert.deepEqual([API_PROFILE_MAX_TAGS, API_PROFILE_TAG_MAX, API_PROFILE_NOTE_MAX], [8, 24, 500]);
});

test('tags are trimmed, inner whitespace collapses, empty entries go, duplicates collapse ignoring case keeping the first spelling, and the result is in code unit order', () => {
  assert.deepEqual(normalizeProfileTags(['  work ', 'Eu', 'WORK', 'x   y', '', '   ', 'Work']), ['Eu', 'work', 'x y'], 'the first spelling of a duplicate stays: "work"');
  assert.deepEqual(normalizeProfileTags(['WORK', 'work']), ['WORK']);
  // Code unit order, not locale order: capitals before lower case, accented letters after ASCII.
  assert.deepEqual(normalizeProfileTags(['zed', 'beta', 'Alpha', String.fromCodePoint(0xc9) + 'clair']), ['Alpha', 'beta', 'zed', String.fromCodePoint(0xc9) + 'clair']);
  assert.deepEqual(normalizeProfileTags([]), []);
  assert.deepEqual(normalizeProfileTags(['a'.repeat(API_PROFILE_TAG_MAX)]), ['a'.repeat(API_PROFILE_TAG_MAX)], 'exactly 24 units is allowed');
  // Eight distinct tags are allowed even when the input holds more entries that collapse into them.
  const eight = Array.from({ length: 8 }, (_, index) => 'tag' + index);
  assert.deepEqual(normalizeProfileTags([...eight, ...eight.map(tag => tag.toUpperCase())]), eight);
  // The input is not mutated.
  const input = ['b', 'a']; normalizeProfileTags(input); assert.deepEqual(input, ['b', 'a']);
});

test('tag limits and shapes: nine tags, 25 units, empty-only text and non-strings are invalid values', () => {
  assert.equal(codeOf(() => normalizeProfileTags(Array.from({ length: 9 }, (_, index) => 'tag' + index))), 'invalid-value');
  assert.equal(codeOf(() => normalizeProfileTags(['a'.repeat(API_PROFILE_TAG_MAX + 1)])), 'invalid-value');
  for (const junk of [null, undefined, 'tag', 5, {}, [1], [null], [['a']], [{ toString: () => 'x' }]]) assert.equal(codeOf(() => normalizeProfileTags(junk)), 'invalid-value', JSON.stringify(junk));
  assert.equal(codeOf(() => normalizeProfileTags(Array.from({ length: 1000 }, () => 'x'))), 'invalid-value', 'an absurd input is refused before it is walked');
  // A sparse array is not data.
  const sparse = ['a']; sparse.length = 3; assert.equal(codeOf(() => normalizeProfileTags(sparse)), 'invalid-value');
  // A tag counts UTF-16 code units, like the contract.
  assert.equal(codeOf(() => normalizeProfileTags([String.fromCodePoint(0x1f600).repeat(13)])), 'invalid-value', '13 emoji are 26 units');
  assert.deepEqual(normalizeProfileTags([String.fromCodePoint(0x1f600).repeat(12)]), [String.fromCodePoint(0x1f600).repeat(12)]);
});

test('control characters and text-direction marks in a tag are unsafe-label; a stored tag that already has them is grandfathered', () => {
  for (const [name, char] of Object.entries(UNSAFE)) assert.equal(codeOf(() => normalizeProfileTags(['a' + char + 'b'])), name === 'tab' ? null : 'unsafe-label', name);
  const stored = 'old' + UNSAFE.rlo + 'tag';
  assert.deepEqual(normalizeProfileTags([stored], { known: [stored] }), [stored]);
  assert.equal(codeOf(() => normalizeProfileTags([stored + 'x'], { known: [stored] })), 'unsafe-label', 'only the exact stored text is grandfathered');
});

test('notes: line breaks become line feeds, the ends are trimmed, 500 units is the limit, controls other than the line feed are unsafe-label', () => {
  assert.equal(normalizeProfileNote('  first' + CR + LF + 'second' + CR + 'third  '), 'first' + LF + 'second' + LF + 'third');
  assert.equal(normalizeProfileNote(LF + LF + 'x' + LF), 'x');
  assert.equal(normalizeProfileNote(''), '');
  assert.equal(normalizeProfileNote('a'.repeat(API_PROFILE_NOTE_MAX)).length, API_PROFILE_NOTE_MAX);
  assert.equal(codeOf(() => normalizeProfileNote('a'.repeat(API_PROFILE_NOTE_MAX + 1))), 'invalid-value');
  assert.equal(normalizeProfileNote('a'.repeat(API_PROFILE_NOTE_MAX) + '   ').length, API_PROFILE_NOTE_MAX, 'the limit applies to the trimmed text');
  for (const junk of [null, undefined, 5, [], {}]) assert.equal(codeOf(() => normalizeProfileNote(junk)), 'invalid-value', String(junk));
  assert.equal(codeOf(() => normalizeProfileNote('a'.repeat(5000))), 'invalid-value');
  for (const [name, char] of Object.entries(UNSAFE)) assert.equal(codeOf(() => normalizeProfileNote('a' + char + 'b')), 'unsafe-label', name);
  assert.equal(normalizeProfileNote('one' + LF + 'two'), 'one' + LF + 'two', 'a line feed inside the note stays');
  const stored = 'old' + UNSAFE.bell + 'note';
  assert.equal(normalizeProfileNote(stored, { known: stored }), stored);
  assert.equal(codeOf(() => normalizeProfileNote(stored + '!', { known: stored })), 'unsafe-label');
});

test('editProfileMeta replaces tags and note of one profile and nothing else; the stored result is canonical and the input is untouched', () => {
  const first = device('First'), second = device('Second', { id: 'fp-' + 'ab'.repeat(16), tags: ['keep'], note: 'kept' }), base = library([first, second]), frozen = JSON.stringify(base);
  const next = editProfileMeta(base, first.id, { tags: ['  Zed', 'alpha ', 'ALPHA'], note: 'line one' + CR + LF + 'line two  ' });
  assert.equal(JSON.stringify(base), frozen, 'the input configuration is not mutated');
  const edited = next.fingerprintProfiles.find(profile => profile.id === first.id);
  assert.deepEqual(edited.tags, ['Zed', 'alpha']); assert.equal(edited.note, 'line one' + LF + 'line two');
  assert.deepEqual({ ...edited, tags: first.tags, note: first.note }, first, 'label, preset, policy and rows are unchanged');
  assert.deepEqual(next.fingerprintProfiles.find(profile => profile.id === second.id), base.fingerprintProfiles.find(profile => profile.id === second.id), 'the other profile is untouched');
  assert.deepEqual({ ...next, fingerprintProfiles: [] }, { ...base, fingerprintProfiles: [] }, 'the applied settings are untouched');
  assert.ok(validateApiConfiguration(next).ok); assert.ok(validateApiConfigurationWrite(next, base).ok, 'a UI write accepts it');
  // A key that is not in the patch keeps its stored value.
  assert.equal(editProfileMeta(next, first.id, { tags: ['only'] }).fingerprintProfiles.find(profile => profile.id === first.id).note, 'line one' + LF + 'line two');
  assert.deepEqual(editProfileMeta(next, first.id, { note: '' }).fingerprintProfiles.find(profile => profile.id === first.id).tags, ['Zed', 'alpha']);
  assert.deepEqual(editProfileMeta(next, first.id, {}), next, 'an empty patch changes nothing');
  assert.deepEqual(editProfileMeta(next, first.id, { tags: [] }).fingerprintProfiles.find(profile => profile.id === first.id).tags, [], 'tags can be cleared');
});

test('editProfileMeta refuses unknown keys, accessors, missing profiles and bad values with the established codes', () => {
  const profile = device('P'), base = library([profile]);
  assert.equal(codeOf(() => editProfileMeta(base, profile.id, { label: 'x' })), 'invalid-value');
  assert.equal(codeOf(() => editProfileMeta(base, profile.id, { tags: ['a'], extra: 1 })), 'invalid-value');
  assert.equal(codeOf(() => editProfileMeta(base, profile.id, null)), 'invalid-value'); assert.equal(codeOf(() => editProfileMeta(base, profile.id, [])), 'invalid-value');
  let ran = false; const accessor = {}; Object.defineProperty(accessor, 'tags', { enumerable: true, get() { ran = true; return ['x']; } });
  assert.equal(codeOf(() => editProfileMeta(base, profile.id, accessor)), 'invalid-value'); assert.equal(ran, false, 'an accessor is never invoked');
  assert.equal(codeOf(() => editProfileMeta(base, 'fp-' + 'f'.repeat(32), { note: 'x' })), 'missing-profile');
  assert.equal(codeOf(() => editProfileMeta(base, 'not-an-id', { note: 'x' })), 'invalid-profile');
  assert.equal(codeOf(() => editProfileMeta({ not: 'a configuration' }, profile.id, { note: 'x' })), 'invalid-profile');
  assert.equal(codeOf(() => editProfileMeta(base, profile.id, { tags: Array.from({ length: 9 }, (_, index) => 't' + index) })), 'invalid-value');
  assert.equal(codeOf(() => editProfileMeta(base, profile.id, { tags: ['a' + UNSAFE.rlo] })), 'unsafe-label');
  assert.equal(codeOf(() => editProfileMeta(base, profile.id, { note: 'x'.repeat(501) })), 'invalid-value');
  assert.equal(codeOf(() => editProfileMeta(base, profile.id, { note: 'a' + UNSAFE.alm })), 'unsafe-label');
});

test('stored texts are grandfathered: editing the note keeps an old unsafe tag, adding a new unsafe one still fails', () => {
  const oldTag = 'old' + UNSAFE.lrm, profile = { ...device('P'), tags: [oldTag] };
  // The base validator does not look at the characters of tags and notes; only writes and imports do.
  const base = validateApiConfiguration({ ...createApiConfiguration(), fingerprintProfiles: [profile] }); assert.ok(base.ok);
  const next = editProfileMeta(base.value, profile.id, { tags: [oldTag], note: 'a note' });
  assert.deepEqual(next.fingerprintProfiles[0].tags, [oldTag]);
  assert.ok(validateApiConfigurationWrite(next, base.value).ok, 'the contract grandfathers the same text at the same identity');
  assert.equal(codeOf(() => editProfileMeta(base.value, profile.id, { tags: [oldTag, 'new' + UNSAFE.lrm] })), 'unsafe-label');
});

test('a new snapshot starts without tags and note; a duplicate and an export/import round trip keep them', () => {
  const profile = snapshotFingerprintProfile(createApiConfiguration(), 'Fresh');
  assert.deepEqual(profile.tags, []); assert.equal(profile.note, '');
  const stored = editProfileMeta(storeFingerprintProfile(createApiConfiguration(), profile), profile.id, { tags: ['b', 'a'], note: 'two' + LF + 'lines' });
  const copy = duplicateFingerprintProfile(stored, profile.id, 'copy');
  assert.notEqual(copy.profile.id, profile.id); assert.deepEqual(copy.profile.tags, ['a', 'b']); assert.equal(copy.profile.note, 'two' + LF + 'lines');
  assert.deepEqual(copy.configuration.fingerprintProfiles.find(item => item.id === copy.profile.id).tags, ['a', 'b']);
  const imported = importApiConfiguration(exportApiConfiguration(copy.configuration));
  assert.ok(imported.ok, imported.error?.message);
  assert.deepEqual(imported.value.fingerprintProfiles.map(item => [item.label, item.tags, item.note]).sort(), copy.configuration.fingerprintProfiles.map(item => [item.label, item.tags, item.note]).sort());
  // A file with an unsafe tag or note is refused as new input.
  const hostile = clone(copy.configuration); hostile.fingerprintProfiles[0].tags = ['x' + UNSAFE.rlo];
  assert.equal(importApiConfiguration(JSON.stringify(hostile)).ok, false);
  const hostileNote = clone(copy.configuration); hostileNote.fingerprintProfiles[0].note = 'x' + UNSAFE.bell;
  assert.equal(importApiConfiguration(JSON.stringify(hostileNote)).ok, false);
});
