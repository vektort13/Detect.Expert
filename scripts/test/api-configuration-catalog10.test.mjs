// Round 5 contract: catalog 9 (format 8) is frozen as published, catalog 10 / format 9 is the round-5 pair (since ADR-112 it is frozen too: the
// current pair is pinned by api-configuration-catalog11.test.mjs). Catalog 10 changes only the
// media-capabilities row (type media-codecs: the flags plus hidden codec families); format 9 adds the library profile fields
// tags and note and the Firefox-only WebRTC policy proxy_only. Everything older keeps its exact value domains and field sets.
// A REAL catalog-9 export made by the published round-4 module (api-configuration-catalog9-export.fixture.json) imports and
// migrates. No browser or backend access; special characters are built from code points only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as contract from '../../packages/contracts/src/api-configuration.mjs';
import { snapshotFingerprintProfile, storeFingerprintProfile, renameFingerprintProfile, applyFingerprintProfile } from '../../apps/production-extension/fingerprint-profiles.js';

const clone = value => structuredClone(value);
const tagged = value => ({ kind: 'value', value });
const sha = text => createHash('sha256').update(text).digest('hex');
const char = code => String.fromCodePoint(code);
const row = (config, id) => config.apis.find(entry => entry.id === id);
const scopeRow = (holder, id) => holder.apis.find(entry => entry.id === id);
const media = (overrides = {}) => ({ supported: true, smooth: true, powerEfficient: false, hidden: [], ...overrides });
const check = (id, value) => contract.validateApiValue(id, tagged(value));
const verdict = config => contract.validateApiConfiguration(config);
// Output of exportApiConfiguration from release/Detect.Expert-2.0.0-chrome/api-configuration.js (sha256 fc7c6548...).
const FIXTURE = readFileSync(new URL('./api-configuration-catalog9-export.fixture.json', import.meta.url), 'utf8');
const FIXTURE_SHA256 = '1f9871a7d7dd8c4925117e780cdba9cf6a3859d3c33b3b878410b2217cbc44bb';
const V9_SHA256 = '2200ab966b82da57e0245cbc79d7ad3d3428675f8c8e554a48f58cc1c4f648a0';
const V8_SHA256 = '6a8d1b4ad09efee6237b4ac8bad9ed79a5789c1d86d01d24de50b7e36db6f447';
const V10_SHA256 = 'be9cdc97c5a279b9230ae94c1d30632f02d1ce144b8cfdacca226f2327c13599';
const MEDIA_REASON = 'Capability result metadata. A Custom flag can only lower what this browser reports: supported, smooth and power efficient are combined with the native answer, and hidden codec families are reported as unsupported by MediaCapabilities, canPlayType and isTypeSupported. Real decoding and encoding are unchanged.';
// [catalog, format] of every published pair before round 5, oldest first; the migration target is the current pair.
const PAIRS = [[1, 1], [2, 1], [3, 2], [4, 3], [5, 3], [6, 4], [6, 5], [7, 6], [8, 7], [9, 8]];
const metadata = ({ id, order, name, group, type, customSupported, customReason, valueHint, allowNull, allowUndefined, presets }) => ({ id, order, name, group, type, customSupported, customReason, valueHint, allowNull, allowUndefined, presets });

const scopeRows = () => contract.API_CONFIG_CATALOG.map(({ id }) => ({ id, mode: 'bypass', selected: { kind: 'unset' }, settings: {} }));
const profileId = suffix => 'fp-' + suffix.repeat(16);
const profile = (suffix, extra = {}) => ({ id: profileId(suffix), label: 'Profile ' + suffix, preset: 'custom', webrtcNetworkPolicy: 'system', apis: scopeRows(), tags: [], note: '', ...extra });
const withProfiles = (...profiles) => { const config = contract.createApiConfiguration(); config.fingerprintProfiles = profiles; return config; };

// A valid export of a published (catalog, format) pair carrying a media-capabilities value in every scope that pair has.
function older(version, format, { policy = 'default_public_interface_only', profilePolicy = policy, withMedia = true } = {}) {
  const catalog = contract['API_CONFIG_CATALOG_V' + version];
  const rows = () => catalog.map(({ id }) => ({ id, mode: 'bypass', selected: { kind: 'unset' }, settings: {} }));
  const doc = { format: contract.API_CONFIGURATION_FORMAT, formatVersion: format, catalogVersion: version, enabled: true, preset: 'custom',
    apis: catalog.map(entry => ({ ...clone(entry), mode: 'bypass', selected: { kind: 'unset' }, userValues: [], settings: {} })), sites: [{ host: 'exact.example', disabled: false, apis: rows() }] };
  if (format >= 2) doc.webrtcNetworkPolicy = policy;
  if (format >= 4) doc.fingerprintProfiles = [{ id: profileId('0a'), label: 'Older profile', preset: 'custom', webrtcNetworkPolicy: profilePolicy, apis: rows() }];
  if (format >= 5) doc.antidetectEnabled = true;
  if (withMedia) {
    const old = { supported: true, smooth: true, powerEfficient: false };
    Object.assign(row(doc, 'media-capabilities'), { mode: 'custom', selected: tagged(old), userValues: [{ id: 'custom-1', label: 'Saved media', value: tagged({ supported: true, smooth: false, powerEfficient: false }) }] });
    Object.assign(scopeRow(doc.sites[0], 'media-capabilities'), { mode: 'custom', selected: tagged({ supported: false, smooth: false, powerEfficient: false }) });
    if (doc.fingerprintProfiles) Object.assign(scopeRow(doc.fingerprintProfiles[0], 'media-capabilities'), { mode: 'off', selected: tagged(old) });
  }
  return doc;
}

test('catalog9 is frozen as published and the current tables can no longer change it', () => {
  assert.equal(sha(JSON.stringify(contract.API_CONFIG_CATALOG_V8)), V8_SHA256, 'catalog 8 of release 2.0.0');
  assert.equal(sha(JSON.stringify(contract.API_CONFIG_CATALOG_V9)), V9_SHA256, 'catalog 9 of the round-4 build');
  const v9 = contract.API_CONFIG_CATALOG_V9, v10 = contract.API_CONFIG_CATALOG_V10;
  assert.ok(Object.isFrozen(v9)); assert.ok(Object.isFrozen(v10)); assert.notEqual(v9, v10);
  const old = v9.find(entry => entry.id === 'media-capabilities'), now = v10.find(entry => entry.id === 'media-capabilities');
  assert.equal(old.type, 'media-capabilities'); assert.equal(now.type, 'media-codecs');
  assert.notEqual(old, now); assert.notEqual(old.presets, now.presets, 'no preset object is shared between the two catalogs');
  assert.ok(Object.isFrozen(old.presets) && Object.isFrozen(old.presets[0].value)); assert.ok(Object.isFrozen(now.presets) && Object.isFrozen(now.presets[0].value));
  assert.throws(() => { 'use strict'; old.presets[0].value.value.hidden = []; }, TypeError, 'a frozen catalog 9 cannot be edited in place');
});

test('catalog10 is the frozen round-5 catalog (format 9): it differs from catalog9 in exactly the media-capabilities row and is no longer the current one', () => {
  const v9 = contract.API_CONFIG_CATALOG_V9, v10 = contract.API_CONFIG_CATALOG_V10;
  assert.equal(sha(JSON.stringify(v10)), V10_SHA256, 'catalog 10 of the round-5 build, byte for byte'); assert.ok(Object.isFrozen(v10)); assert.notEqual(contract.API_CONFIG_CATALOG, v10, 'catalog 10 is not the current catalog any more');
  assert.deepEqual(v10.map(entry => [entry.id, entry.order]), v9.map(entry => [entry.id, entry.order]));
  assert.deepEqual(v10.filter((entry, index) => JSON.stringify(entry) !== JSON.stringify(v9[index])).map(entry => entry.id), ['media-capabilities']);
  assert.equal(v10.length, 158); assert.equal(v10.filter(entry => entry.customSupported).length, 56);
  assert.deepEqual(v10.filter(entry => entry.customSupported).map(entry => entry.id), v9.filter(entry => entry.customSupported).map(entry => entry.id));
  const old = v9.find(entry => entry.id === 'media-capabilities'), now = v10.find(entry => entry.id === 'media-capabilities');
  for (const key of ['id', 'order', 'name', 'group', 'customSupported', 'allowNull', 'allowUndefined']) assert.deepEqual(now[key], old[key], key);
  assert.equal(now.valueHint, 'media-codecs'); assert.equal(now.customReason, MEDIA_REASON);
  assert.equal(old.customReason, 'Capability result metadata only; codecs and actual decoding or encoding are unchanged.');
  assert.deepEqual(now.presets.map(preset => preset.value.value), [
    { supported: false, smooth: false, powerEfficient: false, hidden: [] }, { supported: true, smooth: true, powerEfficient: true, hidden: [] },
    { supported: true, smooth: true, powerEfficient: false, hidden: [] }, { supported: true, smooth: false, powerEfficient: false, hidden: [] }]);
  assert.deepEqual(now.presets.map(preset => preset.id), old.presets.map(preset => preset.id));
  // The current pair still carries this very row: catalog 11 changes other rows only.
  const fresh = contract.createApiConfiguration();
  assert.deepEqual(fresh.fingerprintProfiles, []);
  const exported = JSON.parse(contract.exportApiConfiguration(fresh));
  assert.deepEqual(exported.apis.find(entry => entry.id === 'media-capabilities').presets, JSON.parse(JSON.stringify(now.presets)));
});

test('media-codecs values: the flags plus hidden codec families, stored in the API_MEDIA_CODEC_FAMILIES order', () => {
  const families = contract.API_MEDIA_CODEC_FAMILIES;
  assert.deepEqual(families, ['h264', 'h265', 'av1', 'vp9', 'vp8', 'aac', 'opus', 'vorbis', 'flac', 'mp3', 'dolby']); assert.ok(Object.isFrozen(families));
  for (const preset of contract.API_CONFIG_CATALOG.find(entry => entry.id === 'media-capabilities').presets) assert.equal(check('media-capabilities', preset.value.value).ok, true);
  for (const family of families) assert.deepEqual(check('media-capabilities', media({ hidden: [family] })).value, tagged({ hidden: [family], powerEfficient: false, smooth: true, supported: true }), family);
  assert.equal(check('media-capabilities', media({ hidden: [...families] })).ok, true, 'all eleven families');
  assert.deepEqual(check('media-capabilities', media({ hidden: ['mp3', 'h264', 'dolby', 'av1'] })).value.value.hidden, ['h264', 'av1', 'mp3', 'dolby'], 'any input order is stored in the enum order');
  assert.deepEqual(check('media-capabilities', media({ supported: false, smooth: false, hidden: ['opus'] })).value.value, { hidden: ['opus'], powerEfficient: false, smooth: false, supported: false }, 'hiding under an unsupported flag is allowed');
  const bad = [
    [media({ hidden: ['h266'] }), 'invalid-value'], [media({ hidden: ['H264'] }), 'invalid-value'], [media({ hidden: [''] }), 'invalid-value'], [media({ hidden: ['h264 '] }), 'invalid-value'],
    [media({ hidden: [1] }), 'invalid-value'], [media({ hidden: [null] }), 'invalid-value'], [media({ hidden: [['h264']] }), 'invalid-value'],
    [media({ hidden: ['h264', 'h264'] }), 'duplicate-value'], [media({ hidden: ['h264', 'vp9', 'h264'] }), 'duplicate-value'],
    [media({ hidden: [...families, 'h264'] }), 'invalid-type'], [media({ hidden: 'h264' }), 'invalid-type'], [media({ hidden: null }), 'invalid-type'], [media({ hidden: { 0: 'h264' } }), 'invalid-type'],
    [{ supported: true, smooth: true, powerEfficient: false }, 'missing-field'], [media({ extra: true }), 'unknown-field'], [media({ supported: 1 }), 'invalid-value'], [media({ smooth: 'yes' }), 'invalid-value'],
    [media({ supported: false, smooth: true }), 'invalid-value'], [media({ supported: false, powerEfficient: true }), 'invalid-value'], [[], 'invalid-type'], [null, 'invalid-type'], ['h264', 'invalid-type']
  ];
  for (const [value, code] of bad) { const result = check('media-capabilities', value); assert.equal(result.ok, false, JSON.stringify(value)); assert.equal(result.error.code, code, JSON.stringify(value)); }
  for (const kind of [{ kind: 'null' }, { kind: 'undefined' }]) assert.equal(contract.validateApiValue('media-capabilities', kind).ok, false);
  assert.equal(contract.validateApiValue('media-capabilities', { kind: 'unset' }).ok, true);
  // The same text gives the same answer through a whole configuration: global row, saved value and exact site.
  let config = contract.updateApiConfiguration(contract.createApiConfiguration(), 'media-capabilities', { mode: 'custom', selected: tagged(media({ hidden: ['vp9', 'h264'] })), userValues: [{ id: 'custom-1', label: 'No VP9', value: tagged(media({ hidden: ['vp9'] })) }] });
  assert.equal(config.ok, true, config.error?.message);
  assert.deepEqual(row(config.value, 'media-capabilities').selected, tagged({ hidden: ['h264', 'vp9'], powerEfficient: false, smooth: true, supported: true }));
  config = contract.updateApiConfiguration(config.value, 'media-capabilities', { mode: 'custom', selected: tagged(media({ hidden: ['aac'] })) }, 'media.example');
  assert.equal(config.ok, true, config.error?.message);
  assert.equal(contract.updateApiConfiguration(config.value, 'media-capabilities', { mode: 'custom', selected: tagged(media({ hidden: ['nope'] })) }).error.code, 'invalid-value');
});

test('format 9 profile records are exactly id, label, preset, webrtcNetworkPolicy, apis, tags and note', () => {
  const result = verdict(withProfiles(profile('0a', { tags: ['b', 'a'], note: 'x' })));
  assert.equal(result.ok, true, result.error?.message);
  assert.deepEqual(Object.keys(result.value.fingerprintProfiles[0]), ['id', 'label', 'preset', 'webrtcNetworkPolicy', 'apis', 'tags', 'note']);
  assert.deepEqual(Object.keys(JSON.parse(contract.exportApiConfiguration(result.value)).fingerprintProfiles[0]), ['id', 'label', 'preset', 'webrtcNetworkPolicy', 'apis', 'tags', 'note']);
  assert.equal(contract.API_PROFILE_MAX_TAGS, 8); assert.equal(contract.API_PROFILE_TAG_MAX, 24); assert.equal(contract.API_PROFILE_NOTE_MAX, 500);
  for (const key of ['tags', 'note']) {
    const config = withProfiles(profile('0a')); delete config.fingerprintProfiles[0][key];
    const missing = verdict(config); assert.equal(missing.error.code, 'missing-field'); assert.equal(missing.error.path, '$.fingerprintProfiles[0].' + key);
  }
  const extra = withProfiles(profile('0a', { color: 'red' })); assert.equal(verdict(extra).error.code, 'unknown-field');
  assert.equal(verdict(withProfiles(profile('0a', { tags: undefined }))).ok, false); assert.equal(verdict(withProfiles(profile('0a', { note: undefined }))).ok, false);
});

test('tags: 0 to 8 items of 1 to 24 UTF-16 code units, trimmed and unique ignoring case; a bad item is an error and is never repaired', () => {
  const tagsOf = tags => verdict(withProfiles(profile('0a', { tags })));
  assert.equal(tagsOf([]).ok, true);
  const eight = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];
  assert.equal(tagsOf(eight).ok, true); assert.equal(tagsOf([...eight, 't9']).error.code, 'invalid-type'); assert.equal(tagsOf([...eight, 't9']).error.path, '$.fingerprintProfiles[0].tags');
  assert.equal(tagsOf(['a']).ok, true); assert.equal(tagsOf(['a'.repeat(24)]).ok, true);
  assert.equal(tagsOf(['']).error.code, 'invalid-value'); assert.equal(tagsOf(['a'.repeat(25)]).error.code, 'invalid-value'); assert.equal(tagsOf(['a'.repeat(25)]).error.path, '$.fingerprintProfiles[0].tags[0]');
  // Length counts UTF-16 code units: an astral character is two.
  assert.equal(tagsOf([char(0x1f600).repeat(12)]).ok, true); assert.equal(tagsOf([char(0x1f600).repeat(13)]).error.code, 'invalid-value');
  assert.equal(tagsOf(['a b']).ok, true, 'inner spaces are fine');
  // Whitespace at either end is an error (the validator does not trim for the caller); a tag of only spaces too.
  for (const space of [0x20, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0xa0, 0x1680, 0x2003, 0x2028, 0x2029, 0x202f, 0x3000, 0xfeff]) for (const tag of [char(space) + 'a', 'a' + char(space), 'a' + char(space) + 'a '.trim()].slice(0, 2)) {
    const result = tagsOf([tag]); assert.equal(result.ok, false, 'U+' + space.toString(16)); assert.equal(result.error.code, 'invalid-value', 'U+' + space.toString(16));
  }
  assert.equal(tagsOf([char(0x20)]).error.code, 'invalid-value');
  // Unique ignoring case (toLowerCase), reported at the later item.
  for (const pair of [['Work', 'work'], ['WORK', 'work'], ['a', 'A'], ['work', 'Work'], [char(0xc4) + 'b', char(0xe4) + 'b'], [char(0x414) + 'om', char(0x434) + 'om']]) {
    const result = tagsOf(pair); assert.equal(result.ok, false, JSON.stringify(pair)); assert.equal(result.error.code, 'duplicate-value', JSON.stringify(pair)); assert.equal(result.error.path, '$.fingerprintProfiles[0].tags[1]');
  }
  assert.equal(tagsOf(['work', 'x', 'WORK']).error.path, '$.fingerprintProfiles[0].tags[2]');
  assert.equal(tagsOf(['work', 'work2', 'Work 2']).ok, true, 'different strings stay different');
  for (const bad of [1, null, {}, [], true, false]) assert.equal(tagsOf([bad]).error.code, 'invalid-value', JSON.stringify(bad));
  assert.equal(tagsOf([undefined]).ok, false);
  for (const bad of ['work', null, {}, 1, true]) { const result = tagsOf(bad); assert.equal(result.ok, false); assert.equal(result.error.code, 'invalid-type', JSON.stringify(bad)); }
  assert.equal(tagsOf(Object.assign(['a'], { extra: 1 })).ok, false, 'a decorated array is not data');
});

test('tags are stored in ascending UTF-16 code unit order, whatever order they arrive in', () => {
  const stored = tags => verdict(withProfiles(profile('0a', { tags }))).value.fingerprintProfiles[0].tags;
  assert.deepEqual(stored(['zeta', 'Alpha', 'beta', 'alpha2']), ['Alpha', 'alpha2', 'beta', 'zeta']);
  assert.deepEqual(stored([char(0xe9), 'z', 'Y', 'a']), ['Y', 'a', 'z', char(0xe9)], 'code units, not locale order');
  assert.deepEqual(stored([char(0xff21), char(0x1f600)]), [char(0x1f600), char(0xff21)], 'a surrogate pair (D83D) sorts before U+FF21, unlike code point order');
  assert.deepEqual(stored(['b', 'a', 'c']), ['a', 'b', 'c']);
  assert.equal(contract.exportApiConfiguration(withProfiles(profile('0a', { tags: ['b', 'a', 'c'] }))), contract.exportApiConfiguration(withProfiles(profile('0a', { tags: ['c', 'a', 'b'] }))));
});

const NOTE_REFUSED = [0x00, 0x01, 0x08, 0x09, 0x0b, 0x0c, 0x0d, 0x0e, 0x1b, 0x1f, 0x7f, 0x80, 0x85, 0x9f, 0x61c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
const NOTE_ALLOWED = [0x0a, 0x20, 0x7e, 0xa0, 0x401, 0x5d0, 0x627, 0x200d, 0x1f600];

test('notes: 0 to 500 UTF-16 code units; line feeds are text, every other control and every bidirectional formatting character is not', () => {
  const noteOf = note => verdict(withProfiles(profile('0a', { note })));
  assert.equal(noteOf('').ok, true); assert.equal(noteOf('x'.repeat(500)).ok, true);
  assert.equal(noteOf('x'.repeat(501)).error.code, 'invalid-value'); assert.equal(noteOf('x'.repeat(501)).error.path, '$.fingerprintProfiles[0].note');
  assert.equal(noteOf(char(0x1f600).repeat(250)).ok, true); assert.equal(noteOf(char(0x1f600).repeat(251)).error.code, 'invalid-value');
  assert.equal(noteOf(char(10).repeat(500)).ok, true);
  for (const bad of [1, null, [], {}, true]) assert.equal(noteOf(bad).ok, false, JSON.stringify(bad));
  const multi = 'first line' + char(10) + char(10) + 'third line';
  const imported = contract.importApiConfiguration(contract.exportApiConfiguration(withProfiles(profile('0a', { note: multi }))));
  assert.equal(imported.ok, true, imported.error?.message); assert.equal(imported.value.fingerprintProfiles[0].note, multi, 'line feeds survive the JSON file');
  // The predicates: a note differs from a label in exactly one character.
  for (const code of NOTE_REFUSED) for (const text of [char(code), 'a' + char(code), char(code) + 'b', 'a' + char(code) + 'b']) assert.equal(contract.apiNoteSafe(text), false, 'U+' + code.toString(16));
  for (const code of NOTE_ALLOWED) assert.equal(contract.apiNoteSafe('Note ' + char(code) + ' end'), true, 'U+' + code.toString(16));
  assert.equal(contract.apiLabelSafe(char(10)), false, 'labels still refuse line feeds'); assert.equal(contract.apiNoteSafe(char(10)), true);
  assert.equal(contract.apiNoteSafe(''), true);
  for (const value of [null, undefined, 1, [], {}, { toString: () => 'x' }]) assert.equal(contract.apiNoteSafe(value), false);
});

test('unsafe tags and notes load like unsafe labels, but writes and files refuse them as unsafe-label', () => {
  const bidi = char(0x202e);
  const config = withProfiles(profile('0a', { tags: ['a' + bidi + 'b'], note: 'x' + bidi + 'y' }));
  assert.equal(verdict(config).ok, true, 'stored configurations keep loading');
  const write = contract.validateApiConfigurationWrite(config);
  assert.equal(write.ok, false); assert.equal(write.error.code, 'unsafe-label'); assert.equal(write.error.path, '$.fingerprintProfiles[0].tags[0]');
  const onlyNote = contract.validateApiConfigurationWrite(withProfiles(profile('0a', { note: 'x' + bidi + 'y' })));
  assert.equal(onlyNote.error.code, 'unsafe-label'); assert.equal(onlyNote.error.path, '$.fingerprintProfiles[0].note');
  const file = contract.importApiConfiguration(contract.exportApiConfiguration(config));
  assert.equal(file.ok, false); assert.equal(file.error.code, 'unsafe-label'); assert.equal(file.error.path, '$.fingerprintProfiles[0].tags[0]');
  for (const code of NOTE_REFUSED) {
    const note = withProfiles(profile('0a', { note: 'x' + char(code) + 'y' }));
    assert.equal(contract.validateApiConfigurationWrite(note).error?.code, 'unsafe-label', 'note U+' + code.toString(16));
    assert.equal(contract.importApiConfiguration(contract.exportApiConfiguration(note)).error?.code, 'unsafe-label', 'imported note U+' + code.toString(16));
    // A tag is a label: even a line feed is refused in the middle of it (the ends would already be whitespace).
    const tag = withProfiles(profile('0a', { tags: ['x' + char(code) + 'y'] }));
    assert.equal(contract.validateApiConfigurationWrite(tag).error?.code, code === 0x0a ? undefined : 'unsafe-label', 'tag U+' + code.toString(16));
  }
  assert.equal(contract.validateApiConfigurationWrite(withProfiles(profile('0a', { tags: ['x' + char(10) + 'y'] }))).error.code, 'unsafe-label');
  const clean = withProfiles(profile('0a', { tags: [char(0x5d0) + char(0x5d1), char(0x1f600), 'ok'], note: 'Mixed ' + char(0x627) + char(0x644) + ' text' + char(10) + char(0x401) + ' and ' + char(0x1f600) }));
  assert.equal(contract.validateApiConfigurationWrite(clean).ok, true); assert.equal(contract.importApiConfiguration(contract.exportApiConfiguration(clean)).ok, true);
});

test('validateApiConfigurationWrite grandfathers only the unchanged tags and note of the previous state, bound to the profile id; a file never does', () => {
  const bidi = char(0x202e), unsafeTag = 'a' + bidi + 'b', unsafeNote = 'old' + bidi + 'note';
  const previous = withProfiles(profile('0a', { tags: ['ok', unsafeTag], note: unsafeNote }), profile('0b', { tags: ['plain'] }));
  const write = (next, before = previous) => contract.validateApiConfigurationWrite(next, before);
  assert.equal(write(clone(previous)).ok, true, 'unchanged');
  const sorted = clone(previous); sorted.fingerprintProfiles[0].tags = [unsafeTag, 'ok']; assert.equal(write(sorted).ok, true, 'the same tags in another order are the same tags');
  const added = clone(previous); added.fingerprintProfiles[0].tags = ['new', 'ok', unsafeTag]; assert.equal(write(added).ok, true, 'a clean tag may be added next to a grandfathered one');
  const dropped = clone(previous); dropped.fingerprintProfiles[0].tags = ['ok']; dropped.fingerprintProfiles[0].note = 'clean'; assert.equal(write(dropped).ok, true, 'removing the unsafe texts is always fine');
  const editedTag = clone(previous); editedTag.fingerprintProfiles[0].tags = ['ok', 'a' + bidi + 'c'];
  assert.equal(write(editedTag).error.code, 'unsafe-label'); assert.equal(write(editedTag).error.path, '$.fingerprintProfiles[0].tags[0]', 'tags are sorted, so the edited one comes first');
  const editedNote = clone(previous); editedNote.fingerprintProfiles[0].note = unsafeNote + '!';
  assert.equal(write(editedNote).error.code, 'unsafe-label'); assert.equal(write(editedNote).error.path, '$.fingerprintProfiles[0].note');
  const movedTag = clone(previous); movedTag.fingerprintProfiles[1].tags = ['plain', unsafeTag];
  assert.equal(write(movedTag).error.code, 'unsafe-label', 'a tag is bound to its profile id'); assert.equal(write(movedTag).error.path, '$.fingerprintProfiles[1].tags[0]');
  const copiedNote = clone(previous); copiedNote.fingerprintProfiles[1].note = unsafeNote;
  assert.equal(write(copiedNote).error.code, 'unsafe-label', 'a note is bound to its profile id'); assert.equal(write(copiedNote).error.path, '$.fingerprintProfiles[1].note');
  const swapped = clone(previous); swapped.fingerprintProfiles[0].id = profileId('0c');
  assert.equal(write(swapped).error.code, 'unsafe-label', 'a new profile id inherits nothing');
  const cleaned = clone(previous); cleaned.fingerprintProfiles[0].note = '';
  assert.equal(write(cleaned).ok, true); assert.equal(write(clone(previous), cleaned).error.code, 'unsafe-label', 'once cleaned, the unsafe text is new input again');
  for (const missing of [null, undefined]) assert.equal(contract.validateApiConfigurationWrite(clone(previous), missing).error.code, 'unsafe-label');
  assert.equal(write(clone(previous), { broken: true }).error.code, 'unsafe-label', 'an invalid previous state grandfathers nothing');
  const other = clone(previous); other.fingerprintProfiles[0].tags = ['ok']; assert.equal(write(clone(previous), other).error.code, 'unsafe-label', 'only the previous state counts, not an older one');
  // A file never grandfathers anything, and ordinary API edits keep the stored book as it is.
  assert.equal(contract.importApiConfiguration(contract.exportApiConfiguration(previous)).error.code, 'unsafe-label');
  const edit = contract.updateApiConfiguration(previous, 'hardware-concurrency', { mode: 'custom', selected: tagged(8) });
  assert.equal(edit.ok, true, edit.error?.message); assert.deepEqual(edit.value.fingerprintProfiles, verdict(previous).value.fingerprintProfiles);
  const change = contract.diffApiConfigurations(previous, dropped);
  assert.deepEqual(change.value.map(item => [item.scope, item.id, item.field]), [['global', null, 'fingerprintProfiles']], 'a tag or note change is reported through the whole book');
});

test('proxy_only is a format 9 value: accepted at the top level and in profiles, refused in every older format', () => {
  const config = contract.createApiConfiguration();
  assert.deepEqual(contract.API_WEBRTC_NETWORK_POLICIES, ['system', 'default_public_interface_only', 'disable_non_proxied_udp', 'proxy_only']);
  assert.deepEqual(contract.API_WEBRTC_NETWORK_POLICIES_V8, ['system', 'default_public_interface_only', 'disable_non_proxied_udp']);
  assert.equal(verdict({ ...config, webrtcNetworkPolicy: 'proxy_only' }).ok, true);
  const library = withProfiles(profile('0a', { webrtcNetworkPolicy: 'proxy_only' })); assert.equal(verdict(library).ok, true);
  const restored = contract.importApiConfiguration(contract.exportApiConfiguration({ ...library, webrtcNetworkPolicy: 'proxy_only' }));
  assert.equal(restored.ok, true, restored.error?.message); assert.equal(restored.migrated, false);
  assert.equal(restored.value.webrtcNetworkPolicy, 'proxy_only'); assert.equal(restored.value.fingerprintProfiles[0].webrtcNetworkPolicy, 'proxy_only');
  assert.deepEqual(contract.diffApiConfigurations(config, { ...config, webrtcNetworkPolicy: 'proxy_only' }).value, [{ scope: 'global', id: null, field: 'webrtcNetworkPolicy', before: 'system', after: 'proxy_only' }]);
  for (const bad of ['Proxy_Only', 'proxy_only ', 'proxy-only', 'proxy', 'relay', '']) { assert.equal(verdict({ ...config, webrtcNetworkPolicy: bad }).ok, false, bad); assert.equal(verdict(withProfiles(profile('0a', { webrtcNetworkPolicy: bad }))).ok, false, bad); }
  // Applying a library profile carries its policy to the configuration, exactly as for the other policies.
  const applied = applyFingerprintProfile(library, profileId('0a'));
  assert.equal(applied.webrtcNetworkPolicy, 'proxy_only');
  for (const [version, format] of PAIRS) {
    const label = 'catalog' + version + '/format' + format;
    if (format >= 2) {
      const top = older(version, format, { policy: 'proxy_only', profilePolicy: 'system' }), kept = clone(top);
      for (const result of [contract.upgradeApiConfiguration(top), contract.importApiConfiguration(JSON.stringify(top))]) {
        assert.equal(result.ok, false, label); assert.equal(result.error.code, 'invalid-value', label); assert.equal(result.error.path, '$.webrtcNetworkPolicy', label); assert.equal(result.upgradeFailure, undefined, label);
      }
      assert.deepEqual(top, kept, label + ': the input is never mutated');
    } else {
      const smuggled = { ...older(version, format), webrtcNetworkPolicy: 'proxy_only' };
      assert.equal(contract.upgradeApiConfiguration(smuggled).error.code, 'unknown-field', label + ': format 1 has no policy field at all');
    }
    if (format >= 4) {
      const inside = older(version, format, { policy: 'system', profilePolicy: 'proxy_only' });
      for (const result of [contract.upgradeApiConfiguration(inside), contract.importApiConfiguration(JSON.stringify(inside))]) {
        assert.equal(result.ok, false, label); assert.equal(result.error.code, 'invalid-value', label); assert.equal(result.error.path, '$.fingerprintProfiles[0].webrtcNetworkPolicy', label);
      }
    }
    // The oldest policies still migrate unchanged, so the refusal is about proxy_only alone.
    if (format >= 2) for (const policy of contract.API_WEBRTC_NETWORK_POLICIES_V8) { const ok = contract.upgradeApiConfiguration(older(version, format, { policy })); assert.equal(ok.ok, true, label + ' ' + policy); assert.equal(ok.value.webrtcNetworkPolicy, policy); }
  }
});

test('every published older pair migrates to the current pair: media values gain an empty hidden list everywhere, profile records gain empty tags and note', () => {
  for (const [version, format] of PAIRS) {
    const label = 'catalog' + version + '/format' + format;
    const doc = older(version, format), kept = clone(doc);
    const result = contract.upgradeApiConfiguration(doc);
    assert.equal(result.ok, true, label + ': ' + result.error?.code + ' ' + result.error?.path + ' ' + result.error?.message);
    assert.equal(result.migrated, true, label); assert.equal(result.upgradeFailure, undefined, label); assert.deepEqual(doc, kept, label + ': the input is never mutated');
    const after = result.value;
    assert.equal(after.formatVersion, contract.API_CONFIGURATION_VERSION, label); assert.equal(after.catalogVersion, contract.API_CONFIGURATION_CATALOG_VERSION, label); assert.equal(after.apis.length, 158, label);
    assert.equal(after.webrtcNetworkPolicy, doc.webrtcNetworkPolicy ?? 'system', label); assert.equal(after.antidetectEnabled, doc.antidetectEnabled ?? doc.enabled, label);
    const withHidden = (kind, value) => tagged({ ...value, hidden: [] });
    assert.deepEqual(row(after, 'media-capabilities').selected, withHidden('value', { supported: true, smooth: true, powerEfficient: false }), label);
    assert.deepEqual(row(after, 'media-capabilities').mode, 'custom', label);
    assert.deepEqual(row(after, 'media-capabilities').userValues, [{ id: 'custom-1', label: 'Saved media', value: withHidden('value', { supported: true, smooth: false, powerEfficient: false }) }], label);
    assert.deepEqual(scopeRow(after.sites[0], 'media-capabilities'), { id: 'media-capabilities', mode: 'custom', selected: withHidden('value', { supported: false, smooth: false, powerEfficient: false }), settings: {} }, label);
    if (format >= 4) {
      assert.equal(after.fingerprintProfiles.length, 1, label);
      const migrated = after.fingerprintProfiles[0];
      assert.deepEqual(Object.keys(migrated), ['id', 'label', 'preset', 'webrtcNetworkPolicy', 'apis', 'tags', 'note'], label);
      assert.deepEqual(migrated.tags, [], label); assert.equal(migrated.note, '', label);
      assert.equal(migrated.label, 'Older profile', label); assert.equal(migrated.webrtcNetworkPolicy, doc.fingerprintProfiles[0].webrtcNetworkPolicy, label);
      assert.deepEqual(scopeRow(migrated, 'media-capabilities'), { id: 'media-capabilities', mode: 'off', selected: withHidden('value', { supported: true, smooth: true, powerEfficient: false }), settings: {} }, label + ': a dormant selection is migrated too');
    } else assert.deepEqual(after.fingerprintProfiles, [], label);
    for (const entry of after.apis) assert.deepEqual(entry.presets, contract.API_CONFIG_CATALOG.find(item => item.id === entry.id).presets, label + ' ' + entry.id);
    const again = contract.upgradeApiConfiguration(after);
    assert.equal(again.ok, true, label); assert.equal(again.migrated, false, label); assert.deepEqual(again.value, after, label);
    const viaFile = contract.importApiConfiguration(JSON.stringify(kept));
    assert.equal(viaFile.ok, true, label); assert.equal(viaFile.migrated, true, label); assert.deepEqual(viaFile.value, after, label);
    const round = contract.importApiConfiguration(contract.exportApiConfiguration(after));
    assert.equal(round.ok, true, label); assert.equal(round.migrated, false, label); assert.deepEqual(round.value, after, label);
    // A migrated book can use the new fields at once.
    const next = contract.updateApiConfiguration(after, 'media-capabilities', { mode: 'custom', selected: tagged(media({ hidden: ['h265', 'av1'] })) });
    assert.equal(next.ok, true, label + ': ' + next.error?.message);
  }
});

test('catalog10-only values are refused inside every older format, wherever they are stored, before any migration starts', () => {
  const hiding = tagged({ supported: true, smooth: true, powerEfficient: false, hidden: ['h265'] });
  const placements = {
    'global custom': (doc, id) => Object.assign(row(doc, id), { mode: 'custom', selected: hiding }),
    'global off with a stored selection': (doc, id) => Object.assign(row(doc, id), { mode: 'off', selected: hiding }),
    'saved value': (doc, id) => { row(doc, id).userValues = [{ id: 'saved', label: 'Saved', value: hiding }]; },
    'exact site': (doc, id) => Object.assign(scopeRow(doc.sites[0], id), { mode: 'custom', selected: hiding }),
    'library profile': (doc, id) => Object.assign(scopeRow(doc.fingerprintProfiles[0], id), { mode: 'custom', selected: hiding })
  };
  let refused = 0;
  for (const [version, format] of PAIRS) for (const [where, place] of Object.entries(placements)) {
    if (where === 'library profile' && format < 4) continue;
    const doc = older(version, format, { withMedia: false }); place(doc, 'media-capabilities'); const kept = clone(doc), label = 'catalog' + version + '/format' + format + ' ' + where;
    for (const result of [contract.upgradeApiConfiguration(doc), contract.importApiConfiguration(JSON.stringify(doc))]) {
      assert.equal(result.ok, false, label); assert.equal(result.error.code, 'unknown-field', label); assert.equal(result.upgradeFailure, undefined, label + ': refused before the upgrade started'); refused++;
    }
    assert.deepEqual(doc, kept, label + ': the input is never mutated');
  }
  assert.ok(refused >= 90, 'matrix size ' + refused);
  // Tags and note do not exist before format 9; a format 9 record cannot omit them.
  for (const [version, format] of PAIRS.filter(([, format]) => format >= 4)) for (const [field, value] of [['tags', []], ['note', ''], ['tags', ['work']]]) {
    const doc = older(version, format); doc.fingerprintProfiles[0][field] = value;
    const result = contract.upgradeApiConfiguration(doc);
    assert.equal(result.ok, false, 'catalog' + version + '/format' + format + ' ' + field); assert.equal(result.error.code, 'unknown-field'); assert.equal(result.error.path, '$.fingerprintProfiles[0].' + field);
  }
});

test('a real catalog9 export made by the published round-4 module imports and migrates without losing anything', () => {
  assert.equal(sha(FIXTURE), FIXTURE_SHA256, 'fixture bytes are the shipped module output');
  const before = JSON.parse(FIXTURE);
  assert.equal(before.formatVersion, 8); assert.equal(before.catalogVersion, 9);
  assert.equal(before.enabled, true); assert.equal(before.antidetectEnabled, true); assert.equal(before.webrtcNetworkPolicy, 'disable_non_proxied_udp');
  assert.deepEqual(before.apis.map(metadata), contract.API_CONFIG_CATALOG_V9.map(entry => JSON.parse(JSON.stringify(entry))), 'the fixture carries exactly the frozen catalog 9 metadata');
  assert.equal(before.sites.length, 4); assert.equal(before.fingerprintProfiles.length, 3);
  for (const saved of before.fingerprintProfiles) assert.deepEqual(Object.keys(saved), ['id', 'label', 'preset', 'webrtcNetworkPolicy', 'apis']);
  for (const id of ['canvas-readback', 'network-information', 'media-capabilities', 'speech-voices', 'webrtc']) assert.equal(row(before, id).mode, 'custom', id);
  // The controller's stored-configuration load path is upgradeApiConfiguration; the file path is importApiConfiguration.
  const stored = contract.upgradeApiConfiguration(clone(before));
  assert.equal(stored.ok, true, stored.error?.message); assert.equal(stored.migrated, true); assert.equal(stored.upgradeFailure, undefined);
  const after = stored.value, hidden = selected => selected.kind === 'value' ? tagged({ ...selected.value, hidden: [] }) : selected;
  assert.equal(after.formatVersion, contract.API_CONFIGURATION_VERSION); assert.equal(after.catalogVersion, contract.API_CONFIGURATION_CATALOG_VERSION);
  for (const key of ['enabled', 'antidetectEnabled', 'preset', 'webrtcNetworkPolicy']) assert.equal(after[key], before[key], key);
  assert.equal(after.apis.length, 158);
  for (const old of before.apis) {
    const current = row(after, old.id), isMedia = old.id === 'media-capabilities';
    assert.equal(current.mode, old.mode, old.id); assert.deepEqual(current.settings, old.settings, old.id);
    assert.deepEqual(current.selected, isMedia ? hidden(old.selected) : old.selected, old.id + '.selected');
    assert.deepEqual(current.userValues, isMedia ? old.userValues.map(saved => ({ ...saved, value: hidden(saved.value) })) : old.userValues, old.id + '.userValues');
    assert.deepEqual(current.presets, contract.API_CONFIG_CATALOG.find(entry => entry.id === old.id).presets, old.id + ' carries the current catalog metadata');
  }
  assert.deepEqual(row(after, 'media-capabilities').selected, tagged({ hidden: [], powerEfficient: false, smooth: true, supported: true }));
  assert.equal(row(after, 'media-capabilities').userValues.length, 2); assert.deepEqual(row(after, 'speech-voices').selected.value, { languages: ['en-US', 'de-DE'] });
  assert.deepEqual(row(after, 'canvas-readback').selected.value, { algorithm: 'sparse-rgb-v1' }); assert.equal(row(after, 'webrtc').selected.value.addresses.ipv4.host, 'mdns');
  assert.deepEqual(after.sites.map(site => [site.host, site.disabled]), before.sites.map(site => [site.host, site.disabled]));
  for (const [index, site] of before.sites.entries()) for (const old of site.apis) {
    const current = scopeRow(after.sites[index], old.id);
    assert.deepEqual(current, old.id === 'media-capabilities' ? { ...old, selected: hidden(old.selected) } : old, site.host + ' ' + old.id);
  }
  assert.deepEqual(scopeRow(after.sites.find(site => site.host === 'media.example'), 'media-capabilities').selected.value, { hidden: [], powerEfficient: false, smooth: false, supported: false });
  assert.deepEqual(after.fingerprintProfiles.map(saved => [saved.id, saved.label, saved.preset, saved.webrtcNetworkPolicy]), before.fingerprintProfiles.map(saved => [saved.id, saved.label, saved.preset, saved.webrtcNetworkPolicy]));
  for (const [index, saved] of before.fingerprintProfiles.entries()) {
    const current = after.fingerprintProfiles[index];
    assert.deepEqual(current.tags, [], saved.label); assert.equal(current.note, '', saved.label);
    for (const old of saved.apis) assert.deepEqual(scopeRow(current, old.id), old.id === 'media-capabilities' ? { ...old, selected: hidden(old.selected) } : old, saved.label + ' ' + old.id);
  }
  const plain = after.fingerprintProfiles.find(saved => saved.label === 'Plain and dormant');
  assert.deepEqual(scopeRow(plain, 'media-capabilities'), { id: 'media-capabilities', mode: 'off', selected: tagged({ hidden: [], powerEfficient: true, smooth: true, supported: true }), settings: {} }, 'a dormant selection is migrated');
  const file = contract.importApiConfiguration(FIXTURE);
  assert.equal(file.ok, true, file.error?.message); assert.equal(file.migrated, true); assert.deepEqual(file.value, after);
  const again = contract.upgradeApiConfiguration(after);
  assert.equal(again.ok, true); assert.equal(again.migrated, false); assert.deepEqual(again.value, after);
  const round = contract.importApiConfiguration(contract.exportApiConfiguration(after));
  assert.equal(round.ok, true); assert.equal(round.migrated, false); assert.deepEqual(round.value, after);
  // Everything new works on the migrated book at once.
  let next = contract.updateApiConfiguration(after, 'media-capabilities', { mode: 'custom', selected: tagged(media({ hidden: ['h265', 'av1', 'dolby'] })) });
  assert.equal(next.ok, true, next.error?.message);
  next = clone(next.value); next.webrtcNetworkPolicy = 'proxy_only';
  next.fingerprintProfiles[0].tags = ['work', 'laptop']; next.fingerprintProfiles[0].note = 'Berlin' + char(10) + 'second line'; next.fingerprintProfiles[1].webrtcNetworkPolicy = 'proxy_only';
  const written = contract.validateApiConfigurationWrite(next, after);
  assert.equal(written.ok, true, written.error?.message); assert.deepEqual(written.value.fingerprintProfiles[0].tags, ['laptop', 'work']);
  assert.equal(contract.importApiConfiguration(contract.exportApiConfiguration(written.value)).ok, true);
});

test('catalog10-only values inside the catalog9 export are refused wherever they are stored', () => {
  const hiding = tagged({ supported: true, smooth: true, powerEfficient: false, hidden: ['vp9'] });
  const placements = {
    'global custom': doc => Object.assign(row(doc, 'media-capabilities'), { mode: 'custom', selected: hiding }),
    'global off with a stored selection': doc => Object.assign(row(doc, 'media-capabilities'), { mode: 'off', selected: hiding }),
    'saved value': doc => { row(doc, 'media-capabilities').userValues = [{ id: 'custom-9', label: 'Hide VP9', value: hiding }]; },
    'exact site': doc => Object.assign(scopeRow(doc.sites[0], 'media-capabilities'), { mode: 'custom', selected: hiding }),
    'library profile': doc => Object.assign(scopeRow(doc.fingerprintProfiles[0], 'media-capabilities'), { mode: 'custom', selected: hiding }),
    'proxy_only at the top': doc => { doc.webrtcNetworkPolicy = 'proxy_only'; },
    'proxy_only in a profile': doc => { doc.fingerprintProfiles[1].webrtcNetworkPolicy = 'proxy_only'; },
    'tags in a profile': doc => { doc.fingerprintProfiles[0].tags = ['work']; },
    'note in a profile': doc => { doc.fingerprintProfiles[0].note = 'text'; }
  };
  for (const [where, place] of Object.entries(placements)) {
    const doc = JSON.parse(FIXTURE); place(doc); const kept = clone(doc);
    for (const result of [contract.upgradeApiConfiguration(doc), contract.importApiConfiguration(JSON.stringify(doc))]) {
      assert.equal(result.ok, false, where); assert.equal(result.upgradeFailure, undefined, where);
      assert.equal(result.error.code, where.startsWith('proxy_only') ? 'invalid-value' : 'unknown-field', where + ': ' + result.error.code);
    }
    assert.deepEqual(doc, kept, where);
  }
  // A catalog 9 file written by the round-4 module has no hidden field, no tags and no note anywhere.
  const exported = JSON.parse(FIXTURE);
  assert.equal(JSON.stringify(exported).includes('"hidden"'), false); assert.equal(JSON.stringify(exported.fingerprintProfiles).includes('"tags"'), false);
});

test('catalog10 metadata is pinned both ways against the published catalog9 (through the historical validators)', () => {
  const v9 = { format: contract.API_CONFIGURATION_FORMAT, formatVersion: 8, catalogVersion: 9, enabled: false, antidetectEnabled: false, preset: 'limited', webrtcNetworkPolicy: 'system',
    apis: contract.API_CONFIG_CATALOG_V9.map(entry => ({ ...JSON.parse(JSON.stringify(entry)), mode: 'bypass', userValues: [], selected: { kind: 'unset' }, settings: {} })), sites: [], fingerprintProfiles: [] };
  const v10 = { ...clone(v9), formatVersion: 9, catalogVersion: 10, apis: contract.API_CONFIG_CATALOG_V10.map(entry => ({ ...JSON.parse(JSON.stringify(entry)), mode: 'bypass', userValues: [], selected: { kind: 'unset' }, settings: {} })) };
  const index = contract.API_CONFIG_CATALOG_V10.findIndex(item => item.id === 'media-capabilities');
  const asV9 = contract.upgradeApiConfiguration({ ...v10, formatVersion: 8, catalogVersion: 9 });
  assert.equal(asV9.error.code, 'catalog-mismatch'); assert.equal(asV9.error.path, '$.apis[' + index + ']'); assert.equal(asV9.upgradeFailure, undefined);
  const asV10 = contract.upgradeApiConfiguration({ ...v9, formatVersion: 9, catalogVersion: 10, fingerprintProfiles: [] });
  assert.equal(asV10.error.code, 'catalog-mismatch'); assert.equal(asV10.error.path, '$.apis[' + index + ']');
  assert.equal(contract.upgradeApiConfiguration(v9).ok, true, 'a pristine catalog 9 export migrates');
  const old = contract.API_CONFIG_CATALOG_V9.find(item => item.id === 'media-capabilities'), now = contract.API_CONFIG_CATALOG_V10.find(item => item.id === 'media-capabilities');
  let differing = 0;
  for (const field of ['name', 'customReason', 'customSupported', 'presets', 'type', 'valueHint', 'group', 'order', 'allowNull', 'allowUndefined']) {
    if (JSON.stringify(old[field]) === JSON.stringify(now[field])) continue;
    differing++;
    const forged = clone(v9); row(forged, 'media-capabilities')[field] = JSON.parse(JSON.stringify(now[field]));
    assert.equal(contract.upgradeApiConfiguration(forged).error.code, 'catalog-mismatch', field + ' of catalog 10 in a catalog 9 file');
    const stale = clone(v10); row(stale, 'media-capabilities')[field] = JSON.parse(JSON.stringify(old[field]));
    assert.equal(contract.upgradeApiConfiguration(stale).error?.code, 'catalog-mismatch', field + ' of catalog 9 in a catalog 10 file');
  }
  assert.equal(differing, 4, 'type, valueHint, customReason and presets differ');
  assert.equal(contract.upgradeApiConfiguration({ ...v9, formatVersion: 9, catalogVersion: 9 }).error.code, 'incompatible-version');
  assert.equal(contract.upgradeApiConfiguration({ ...v10, formatVersion: 8, catalogVersion: 10 }).error.code, 'incompatible-version');
  assert.equal(contract.upgradeApiConfiguration({ ...v10, formatVersion: 10, catalogVersion: 10 }).error.code, 'incompatible-version');
  assert.equal(contract.upgradeApiConfiguration({ ...v10, formatVersion: 9, catalogVersion: 11 }).error.code, 'incompatible-version');
  assert.equal(contract.upgradeApiConfiguration({ ...v10, formatVersion: 10, catalogVersion: 11 }).error.code, 'catalog-mismatch', 'the current pair judges catalog 10 metadata by the current catalog');
});

test('library helpers write format 9 records: a snapshot starts without tags and note, rename keeps them, store refuses unsafe ones', () => {
  const base = contract.createApiConfiguration(), bidi = char(0x202e);
  const snapshot = snapshotFingerprintProfile(base, 'Snapshot', profileId('5a'));
  assert.deepEqual(Object.keys(snapshot), ['id', 'label', 'preset', 'webrtcNetworkPolicy', 'apis', 'tags', 'note']);
  assert.deepEqual(snapshot.tags, []); assert.equal(snapshot.note, '');
  const first = storeFingerprintProfile(base, snapshot);
  assert.deepEqual(first.fingerprintProfiles.map(saved => saved.id), [profileId('5a')]);
  const second = storeFingerprintProfile(first, { ...snapshot, id: profileId('5b'), label: 'Tagged', tags: ['b', 'a'], note: 'line one' + char(10) + 'line two' });
  assert.deepEqual(second.fingerprintProfiles.find(saved => saved.id === profileId('5b')).tags, ['a', 'b']);
  const renamed = renameFingerprintProfile(second, profileId('5b'), 'Renamed');
  assert.equal(renamed.fingerprintProfiles.find(saved => saved.id === profileId('5b')).label, 'Renamed');
  assert.deepEqual(renamed.fingerprintProfiles.find(saved => saved.id === profileId('5b')).tags, ['a', 'b']); assert.equal(renamed.fingerprintProfiles.find(saved => saved.id === profileId('5b')).note, 'line one' + char(10) + 'line two');
  const applied = applyFingerprintProfile(second, profileId('5b'));
  assert.deepEqual(applied.fingerprintProfiles, second.fingerprintProfiles, 'applying changes no library record');
  assert.equal(JSON.stringify({ ...applied, fingerprintProfiles: [] }).includes('line one'), false, 'tags and note stay in the library and never reach the applied rows');
  for (const [field, value] of [['tags', ['a' + bidi + 'b']], ['note', 'x' + bidi + 'y'], ['note', 'x' + char(13) + 'y'], ['note', 'x' + char(9) + 'y']]) {
    assert.throws(() => storeFingerprintProfile(base, { ...snapshot, id: profileId('5c'), [field]: value }), error => error.code === 'unsafe-label', field);
  }
  for (const [field, value] of [['tags', ['dup', 'DUP']], ['tags', ['x'.repeat(25)]], ['tags', [3]], ['note', 'x'.repeat(501)], ['note', 3], ['tags', undefined]]) {
    assert.throws(() => storeFingerprintProfile(base, { ...snapshot, id: profileId('5c'), [field]: value }), error => error.code === 'invalid-profile', field);
  }
});
