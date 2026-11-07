// ADR-112 contract: catalog 11 / format 10 is current, catalogs 1-10 are frozen as published (byte-pinned) and strictly migrate. Catalog 11
// changes exactly four rows of catalog 10: canvas-readback gains the algorithm sparse-rgb-v2 (first preset), and the first presets of the
// webgl-capabilities, webgpu and webgpu-capabilities rows are what a real Chrome reports. Format 10 has the field set of format 9.
// A REAL catalog-10 export (api-configuration-catalog10-export.fixture.json, made by the module as it was before this change) imports and
// migrates without losing a saved value. No browser or backend access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as contract from '../../packages/contracts/src/api-configuration.mjs';
import { generateConsistentDevice } from '../../apps/production-extension/fingerprint-profiles.js';

const clone = value => structuredClone(value);
const tagged = value => ({ kind: 'value', value });
const sha = text => createHash('sha256').update(text).digest('hex');
const row = (config, id) => config.apis.find(entry => entry.id === id);
const scopeRow = (holder, id) => holder.apis.find(entry => entry.id === id);
const check = (id, value) => contract.validateApiValue(id, tagged(value));
const metadata = ({ id, order, name, group, type, customSupported, customReason, valueHint, allowNull, allowUndefined, presets }) => ({ id, order, name, group, type, customSupported, customReason, valueHint, allowNull, allowUndefined, presets });
// sha256 of JSON.stringify(API_CONFIG_CATALOG_Vn) recorded before catalog 11 existed: the published tables can never change again.
const HASHES = {
  1: 'b3e069dab278027ebecbe06af3dd5b2642b5d9b5b84061230253df87dfbeecc4', 2: '30118d27ae2c5ba117f4616dd4fbd4cfacd6814410d19a749b10464782aa4ff4', 3: 'c2e6678fb9e94f612ce3b7f4842c8dfeb933157797784c10a602a2216408bdac',
  4: '8078b7f3f2eade1aba87a950fc1f8fa79ed75091267f798a90dcbbd9f2cc2f43', 5: 'c10b94ac123076d428a254367649a4cc168c97947aa3787bf41f9b320bccf7e1', 6: 'e03c14158d199bdac78dbdac56c748171a5fa1b89dc4b8b9301e899236d8f286',
  7: '04ab7486cfab75d88db1f55a6e47288f0f4864f61bfaf66801b9a07e1c25b646', 8: '6a8d1b4ad09efee6237b4ac8bad9ed79a5789c1d86d01d24de50b7e36db6f447', 9: '2200ab966b82da57e0245cbc79d7ad3d3428675f8c8e554a48f58cc1c4f648a0',
  10: 'be9cdc97c5a279b9230ae94c1d30632f02d1ce144b8cfdacca226f2327c13599',
};
const CHANGED = ['canvas-readback', 'webgpu', 'webgl-capabilities', 'webgpu-capabilities']; // in catalog order
const FIXTURE = readFileSync(new URL('./api-configuration-catalog10-export.fixture.json', import.meta.url), 'utf8');
const FIXTURE_SHA256 = '84f3f4f3081745fbc32c5758e87f6353ebae6c3db394f48d9313f84834995226';
const profileId = suffix => 'fp-' + suffix.repeat(16);

test('catalogs 1 to 10 are frozen byte for byte and the current tables can no longer change them', () => {
  for (const [version, hash] of Object.entries(HASHES)) {
    const catalog = contract['API_CONFIG_CATALOG_V' + version];
    assert.equal(sha(JSON.stringify(catalog)), hash, 'catalog ' + version); assert.ok(Object.isFrozen(catalog), 'catalog ' + version + ' is frozen');
  }
  const v10 = contract.API_CONFIG_CATALOG_V10, v11 = contract.API_CONFIG_CATALOG_V11;
  assert.ok(Object.isFrozen(v11)); assert.notEqual(v10, v11); assert.equal(contract.API_CONFIG_CATALOG, v11);
  // No preset object is shared between a changed row of catalog 10 and of catalog 11, and the frozen ones cannot be edited in place.
  for (const id of CHANGED) {
    const old = v10.find(entry => entry.id === id), now = v11.find(entry => entry.id === id);
    assert.notEqual(old, now, id); assert.notEqual(old.presets, now.presets, id + ': presets are not shared');
    assert.ok(Object.isFrozen(old.presets) && Object.isFrozen(old.presets[0].value) && Object.isFrozen(now.presets[0].value), id);
  }
  assert.throws(() => { 'use strict'; v10.find(entry => entry.id === 'canvas-readback').presets[0].value.value.algorithm = 'sparse-rgb-v2'; }, TypeError);
});

test('catalog 11 / format 10 is current and differs from catalog 10 in exactly four rows; every other row is the frozen catalog 10 object', () => {
  const v10 = contract.API_CONFIG_CATALOG_V10, v11 = contract.API_CONFIG_CATALOG_V11;
  assert.equal(contract.API_CONFIGURATION_VERSION, 10); assert.equal(contract.API_CONFIGURATION_CATALOG_VERSION, 11);
  assert.deepEqual(v11.map(entry => [entry.id, entry.order]), v10.map(entry => [entry.id, entry.order]));
  assert.deepEqual(v11.filter((entry, index) => JSON.stringify(entry) !== JSON.stringify(v10[index])).map(entry => entry.id), CHANGED);
  v11.forEach((entry, index) => { if (!CHANGED.includes(entry.id)) assert.equal(entry, v10[index], entry.id + ' is the same object'); });
  assert.equal(v11.length, 158); assert.equal(v11.filter(entry => entry.customSupported).length, 56);
  assert.deepEqual(v11.filter(entry => entry.customSupported).map(entry => entry.id), v10.filter(entry => entry.customSupported).map(entry => entry.id));
  for (const id of CHANGED) {
    const old = v10.find(entry => entry.id === id), now = v11.find(entry => entry.id === id);
    for (const key of ['id', 'order', 'name', 'group', 'customSupported', 'type', 'allowNull', 'allowUndefined']) assert.deepEqual(now[key], old[key], id + ' ' + key);
  }
  const fresh = contract.createApiConfiguration();
  assert.equal(fresh.formatVersion, 10); assert.equal(fresh.catalogVersion, 11); assert.deepEqual(fresh.fingerprintProfiles, []);
  const exported = JSON.parse(contract.exportApiConfiguration(fresh));
  assert.equal(exported.formatVersion, 10); assert.equal(exported.catalogVersion, 11);
  assert.deepEqual(exported.apis.map(entry => entry.id), v11.map(entry => entry.id));
  assert.equal(contract.importApiConfiguration(contract.exportApiConfiguration(fresh)).migrated, false);
});

test('canvas-readback: sparse-rgb-v2 is preset 1, sparse-rgb-v1 and stable-rgb-v1 stay valid saved values, the catalog 10 domain is unchanged, anything else is rejected', () => {
  const entry = contract.API_CONFIG_CATALOG.find(item => item.id === 'canvas-readback');
  assert.deepEqual(entry.presets.map(preset => [preset.id, preset.value]), [['preset-1', tagged({ algorithm: 'sparse-rgb-v2' })], ['preset-2', tagged({ algorithm: 'sparse-rgb-v1' })], ['preset-3', tagged({ algorithm: 'stable-rgb-v1' })]]);
  assert.deepEqual(contract.API_CONFIG_CATALOG_V10.find(item => item.id === 'canvas-readback').presets.map(preset => preset.value.value.algorithm), ['sparse-rgb-v1', 'stable-rgb-v1']);
  for (const algorithm of ['sparse-rgb-v2', 'sparse-rgb-v1', 'stable-rgb-v1']) { const result = check('canvas-readback', { algorithm }); assert.equal(result.ok, true, algorithm); assert.deepEqual(result.value, tagged({ algorithm })); }
  for (const bad of [{ algorithm: 'SPARSE-RGB-V2' }, { algorithm: ' sparse-rgb-v2' }, { algorithm: 'sparse-rgb-v2 ' }, { algorithm: 'sparse-rgb-v3' }, { algorithm: 'sparse-rgb-v20' }, { algorithm: 'stable-rgb-v2' }, { algorithm: 'sparse-rgb-v' },
    { algorithm: '' }, { algorithm: null }, { algorithm: 2 }, { algorithm: ['sparse-rgb-v2'] }, { algorithm: { toString: () => 'sparse-rgb-v2' } }]) assert.equal(check('canvas-readback', bad).ok, false, JSON.stringify(bad));
  assert.equal(check('canvas-readback', {}).error.code, 'missing-field'); assert.equal(check('canvas-readback', { algorithm: 'sparse-rgb-v2', density: 1 }).error.code, 'unknown-field');
  let config = contract.updateApiConfiguration(contract.createApiConfiguration(), 'canvas-readback', { mode: 'custom', selected: tagged({ algorithm: 'sparse-rgb-v2' }) });
  assert.equal(config.ok, true, config.error?.message);
  config = contract.updateApiConfiguration(config.value, 'canvas-readback', { mode: 'custom', selected: tagged({ algorithm: 'sparse-rgb-v1' }) }, 'older.example');
  assert.equal(config.ok, true, config.error?.message);
  const restored = contract.importApiConfiguration(contract.exportApiConfiguration(config.value));
  assert.equal(restored.ok, true); assert.equal(restored.migrated, false);
  assert.deepEqual(row(restored.value, 'canvas-readback').selected, tagged({ algorithm: 'sparse-rgb-v2' })); assert.deepEqual(scopeRow(restored.value.sites[0], 'canvas-readback').selected, tagged({ algorithm: 'sparse-rgb-v1' }));
});

test('the reasons: catalog 11 describes the v2 projection, the WebGL extension rule and the WebGPU filter; catalog 10 keeps its texts', () => {
  const reason = (catalog, id) => catalog.find(entry => entry.id === id).customReason;
  const now = contract.API_CONFIG_CATALOG, old = contract.API_CONFIG_CATALOG_V10;
  assert.match(reason(now, 'canvas-readback'), /sparse-rgb-v2 \(default\)/); assert.match(reason(now, 'canvas-readback'), /lowest bit/); assert.match(reason(now, 'canvas-readback'), /262,144 pixels/); assert.match(reason(now, 'canvas-readback'), /four colours/);
  assert.match(reason(now, 'canvas-readback'), /sparse-rgb-v1 and stable-rgb-v1 are kept for saved profiles/); assert.match(reason(now, 'canvas-readback'), /A page that knows its own drawing can still tell that a profile is active/);
  assert.match(reason(now, 'canvas-readback'), /WebGL canvases/);
  assert.match(reason(now, 'webgl-capabilities'), /WEBGL_lose_context, which is never hidden/); assert.match(reason(now, 'webgpu-capabilities'), /never added/);
  assert.equal(reason(old, 'webgl-capabilities'), null); assert.equal(reason(old, 'webgpu-capabilities'), null);
  assert.match(reason(old, 'canvas-readback'), /sparse-rgb-v1 \(default\)[^.]*about 1% of fully opaque pixels/);
  // No catalog 11 text promises what this tool cannot give.
  for (const entry of now) assert.doesNotMatch(entry.customReason ?? '', /invisib|undetectab|anonymous|guarantee|100 ?%/i, entry.id);
});

test('catalog 11 first presets are what a real Chrome reports: every extension stays native, device and description are blank, features are real names', () => {
  const caps = contract.API_CONFIG_CATALOG.find(entry => entry.id === 'webgl-capabilities'), gpu = contract.API_CONFIG_CATALOG.find(entry => entry.id === 'webgpu'), features = contract.API_CONFIG_CATALOG.find(entry => entry.id === 'webgpu-capabilities');
  for (const entry of [caps, gpu, features]) for (const preset of entry.presets) { const result = contract.validateApiValue(entry.id, preset.value); assert.equal(result.ok, true, entry.id + ' ' + preset.id + ': ' + result.error?.message); assert.ok(preset.label.length > 0); }
  // webgl-capabilities: limits of a desktop GPU, and no extension list at all, so WEBGL_debug_renderer_info, the timer queries and WEBGL_lose_context stay native.
  assert.deepEqual(caps.presets.map(preset => Object.keys(preset.value.value)), [['parameters'], ['parameters']]);
  assert.equal(caps.presets[0].value.value.parameters.MAX_TEXTURE_SIZE, 16384); assert.ok(caps.presets[1].value.value.parameters.MAX_TEXTURE_SIZE < 16384);
  for (const preset of caps.presets) assert.equal(Object.hasOwn(preset.value.value, 'extensions'), false);
  // webgpu: Chrome blanks adapter.info.device and description; the vendor and architecture come from the measured vocabulary; one preset is a null adapter.
  assert.deepEqual(gpu.presets.map(preset => preset.value.kind), ['value', 'value', 'value', 'null']);
  for (const preset of gpu.presets.filter(item => item.value.kind === 'value')) { assert.equal(preset.value.value.device, ''); assert.equal(preset.value.value.description, ''); assert.notEqual(preset.value.value.architecture, ''); }
  assert.deepEqual(gpu.presets.slice(0, 3).map(preset => [preset.value.value.vendor, preset.value.value.architecture]), [['intel', 'gen-12lp'], ['nvidia', 'turing'], ['amd', 'rdna-2']]);
  assert.ok(!JSON.stringify(gpu.presets).includes('Iris Xe Graphics'), 'the invented adapter descriptions are gone');
  // webgpu-capabilities: a real feature list instead of an empty one.
  assert.ok(features.presets[0].value.value.features.length >= 15); assert.ok(features.presets[1].value.value.features.length >= 5);
  for (const preset of features.presets) { const list = preset.value.value.features; assert.equal(new Set(list).size, list.length); for (const name of list) assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/); }
  assert.ok(features.presets[0].value.value.features.includes('timestamp-query') && features.presets[0].value.value.features.includes('shader-f16'));
  // The frozen catalog keeps the old first presets, so a saved choice that equals one of them still names a preset of its own catalog.
  const oldCaps = contract.API_CONFIG_CATALOG_V10.find(entry => entry.id === 'webgl-capabilities'), oldFeatures = contract.API_CONFIG_CATALOG_V10.find(entry => entry.id === 'webgpu-capabilities'), oldGpu = contract.API_CONFIG_CATALOG_V10.find(entry => entry.id === 'webgpu');
  assert.deepEqual(oldCaps.presets[0].value.value, { parameters: { MAX_TEXTURE_SIZE: 4096 }, extensions: [] }); assert.deepEqual(oldFeatures.presets[0].value.value, { features: [] });
  assert.equal(oldGpu.presets[0].value.value.description, 'Intel Iris Xe Graphics');
});

test('the generator already used the realistic WebGL limits: its webgl-capabilities row is preset 1 of catalog 11', () => {
  const generated = generateConsistentDevice(contract.createApiConfiguration(), { deviceType: 'desktop', protection: 'balanced', seed: 3 }).configuration;
  const caps = row(generated, 'webgl-capabilities'); assert.equal(caps.mode, 'custom');
  const first = contract.API_CONFIG_CATALOG.find(entry => entry.id === 'webgl-capabilities').presets[0].value.value;
  assert.deepEqual(caps.selected.value.parameters, first.parameters); assert.equal(Object.hasOwn(caps.selected.value, 'extensions'), false);
});

test('a real catalog-10 export made by the module before this change imports and migrates to format 10 / catalog 11 without losing a saved value', () => {
  assert.equal(sha(FIXTURE), FIXTURE_SHA256, 'fixture bytes are the module output');
  const before = JSON.parse(FIXTURE);
  assert.equal(before.formatVersion, 9); assert.equal(before.catalogVersion, 10); assert.equal(before.enabled, true); assert.equal(before.antidetectEnabled, true);
  assert.deepEqual(before.apis.map(metadata), contract.API_CONFIG_CATALOG_V10.map(entry => JSON.parse(JSON.stringify(entry))), 'the fixture carries exactly the frozen catalog 10 metadata');
  assert.equal(before.sites.length, 4); assert.equal(before.fingerprintProfiles.length, 3);
  for (const saved of before.fingerprintProfiles) assert.deepEqual(Object.keys(saved), ['id', 'label', 'preset', 'webrtcNetworkPolicy', 'apis', 'tags', 'note']);
  const stored = contract.upgradeApiConfiguration(clone(before));
  assert.equal(stored.ok, true, stored.error?.message); assert.equal(stored.migrated, true); assert.equal(stored.upgradeFailure, undefined);
  const after = stored.value;
  assert.equal(after.formatVersion, 10); assert.equal(after.catalogVersion, 11); assert.equal(after.apis.length, 158);
  for (const key of ['enabled', 'antidetectEnabled', 'preset', 'webrtcNetworkPolicy']) assert.equal(after[key], before[key], key);
  for (const old of before.apis) {
    const current = row(after, old.id);
    assert.equal(current.mode, old.mode, old.id); assert.deepEqual(current.settings, old.settings, old.id); assert.deepEqual(current.selected, old.selected, old.id + '.selected'); assert.deepEqual(current.userValues, old.userValues, old.id + '.userValues');
    assert.deepEqual(current.presets, contract.API_CONFIG_CATALOG.find(entry => entry.id === old.id).presets, old.id + ' carries the catalog 11 metadata');
  }
  assert.deepEqual(row(after, 'canvas-readback').selected, tagged({ algorithm: 'sparse-rgb-v1' }), 'a saved profile keeps its algorithm');
  assert.deepEqual(row(after, 'media-capabilities').selected.value.hidden, ['h265', 'dolby'], 'hidden codec families are kept');
  assert.equal(row(after, 'media-capabilities').userValues[0].label, 'No H.265');
  assert.deepEqual(row(after, 'webgl-capabilities').selected, tagged({ extensions: [], parameters: { MAX_TEXTURE_SIZE: 4096 } }), 'a value chosen from an old preset is still valid and unchanged');
  assert.deepEqual(row(after, 'webgpu-capabilities').selected, tagged({ features: [] }));
  assert.deepEqual(after.sites.map(site => [site.host, site.disabled]), before.sites.map(site => [site.host, site.disabled]));
  for (const [index, site] of before.sites.entries()) for (const old of site.apis) assert.deepEqual(scopeRow(after.sites[index], old.id), old, site.host + ' ' + old.id);
  assert.deepEqual(after.fingerprintProfiles.map(saved => [saved.id, saved.label, saved.preset, saved.webrtcNetworkPolicy, saved.tags, saved.note]), before.fingerprintProfiles.map(saved => [saved.id, saved.label, saved.preset, saved.webrtcNetworkPolicy, saved.tags, saved.note]));
  assert.deepEqual(after.fingerprintProfiles[0].tags, ['eu', 'work'], 'tags are stored in code unit order'); assert.equal(after.fingerprintProfiles[0].note, 'Round 5 profile\nwith a second line');
  for (const [index, saved] of before.fingerprintProfiles.entries()) for (const old of saved.apis) assert.deepEqual(scopeRow(after.fingerprintProfiles[index], old.id), old, saved.label + ' ' + old.id);
  const file = contract.importApiConfiguration(FIXTURE);
  assert.equal(file.ok, true, file.error?.message); assert.equal(file.migrated, true); assert.deepEqual(file.value, after);
  const again = contract.upgradeApiConfiguration(after);
  assert.equal(again.ok, true); assert.equal(again.migrated, false); assert.deepEqual(again.value, after);
  const round = contract.importApiConfiguration(contract.exportApiConfiguration(after));
  assert.equal(round.ok, true); assert.equal(round.migrated, false); assert.deepEqual(round.value, after);
  assert.deepEqual(before, JSON.parse(FIXTURE), 'the input is never mutated');
  // The new algorithm can be chosen at once, globally, per site and in a library profile.
  let next = contract.updateApiConfiguration(after, 'canvas-readback', { mode: 'custom', selected: tagged({ algorithm: 'sparse-rgb-v2' }) });
  assert.equal(next.ok, true, next.error?.message);
  next = contract.updateApiConfiguration(next.value, 'canvas-readback', { mode: 'custom', selected: tagged({ algorithm: 'sparse-rgb-v2' }) }, 'media.example');
  assert.equal(next.ok, true, next.error?.message);
  const withProfile = clone(next.value); scopeRow(withProfile.fingerprintProfiles[0], 'canvas-readback').selected = tagged({ algorithm: 'sparse-rgb-v2' }); scopeRow(withProfile.fingerprintProfiles[0], 'canvas-readback').mode = 'custom';
  assert.equal(contract.validateApiConfigurationWrite(withProfile, after).ok, true);
});

test('catalog-11-only values are refused inside every older format and catalog 10 file, wherever they are stored, before any migration starts', () => {
  const v2 = tagged({ algorithm: 'sparse-rgb-v2' });
  const placements = {
    'global custom': doc => Object.assign(row(doc, 'canvas-readback'), { mode: 'custom', selected: v2 }),
    'global off with a stored selection': doc => Object.assign(row(doc, 'canvas-readback'), { mode: 'off', selected: v2 }),
    'saved value': doc => { row(doc, 'canvas-readback').userValues = [{ id: 'saved', label: 'Saved', value: v2 }]; },
    'exact site': doc => Object.assign(scopeRow(doc.sites[0], 'canvas-readback'), { mode: 'custom', selected: v2 }),
    'library profile': doc => Object.assign(scopeRow(doc.fingerprintProfiles[0], 'canvas-readback'), { mode: 'custom', selected: v2 }),
  };
  for (const [where, place] of Object.entries(placements)) {
    const doc = JSON.parse(FIXTURE); place(doc); const kept = clone(doc);
    for (const result of [contract.upgradeApiConfiguration(doc), contract.importApiConfiguration(JSON.stringify(doc))]) {
      assert.equal(result.ok, false, where); assert.equal(result.upgradeFailure, undefined, where + ': refused before the upgrade started');
      assert.equal(result.error.code, 'invalid-value', where + ': ' + result.error.code); assert.match(result.error.path, /\.(selected|value)\.(value\.)?algorithm$|algorithm$/, where);
    }
    assert.deepEqual(doc, kept, where + ': the input is never mutated');
  }
  // The catalog 10 metadata of the changed rows is judged by the catalog of its own label pair, and by the current one under the current pair.
  const asCurrent = contract.upgradeApiConfiguration({ ...JSON.parse(FIXTURE), formatVersion: 10, catalogVersion: 11 });
  assert.equal(asCurrent.ok, false); assert.equal(asCurrent.error.code, 'catalog-mismatch'); assert.equal(asCurrent.error.path, '$.apis[' + contract.API_CONFIG_CATALOG.findIndex(entry => entry.id === 'canvas-readback') + ']');
  const current = JSON.parse(contract.exportApiConfiguration(contract.createApiConfiguration()));
  for (const id of CHANGED) {
    const stale = clone(current); row(stale, id).presets = JSON.parse(JSON.stringify(contract.API_CONFIG_CATALOG_V10.find(entry => entry.id === id).presets));
    const result = contract.validateApiConfiguration(stale); assert.equal(result.ok, false, id); assert.equal(result.error.code, 'catalog-mismatch', id);
  }
});

test('only the published format/catalog pairs and the current one are accepted; format 10 files carry the field set of format 9', () => {
  const current = JSON.parse(contract.exportApiConfiguration(contract.createApiConfiguration()));
  assert.equal(contract.upgradeApiConfiguration(current).migrated, false);
  assert.equal(contract.upgradeApiConfiguration({ ...current, formatVersion: 9, catalogVersion: 11 }).error.code, 'incompatible-version');
  assert.equal(contract.upgradeApiConfiguration({ ...current, formatVersion: 10, catalogVersion: 10 }).error.code, 'incompatible-version');
  assert.equal(contract.upgradeApiConfiguration({ ...current, formatVersion: 11, catalogVersion: 12 }).error.code, 'incompatible-version');
  assert.equal(contract.upgradeApiConfiguration({ ...current, extra: true }).error.code, 'unknown-field');
  // Tags and note are required in format 10 profiles exactly as in format 9.
  const profile = { id: profileId('0a'), label: 'P', preset: 'custom', webrtcNetworkPolicy: 'proxy_only', apis: current.apis.map(({ id }) => ({ id, mode: 'bypass', selected: { kind: 'unset' }, settings: {} })), tags: ['b', 'a'], note: 'x\ny' };
  const ok = contract.validateApiConfiguration({ ...current, fingerprintProfiles: [profile] }); assert.equal(ok.ok, true, ok.error?.message); assert.deepEqual(ok.value.fingerprintProfiles[0].tags, ['a', 'b']);
  for (const field of ['tags', 'note']) { const bad = clone(profile); delete bad[field]; assert.equal(contract.validateApiConfiguration({ ...current, fingerprintProfiles: [bad] }).error.code, 'missing-field', field); }
});

test('the production contract mirror is the canonical contract with browser imports (run sync-api-configuration.mjs after edits)', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  const browserImports = source => source.replaceAll("from './protection-features.mjs'", "from './api-protection-features.js'").replaceAll("from './webassembly-apis.mjs'", "from './webassembly-apis.js'").replaceAll("from './math-functions.mjs'", "from './math-functions.js'").replaceAll("from './fingerprint-custom-values.mjs'", "from './fingerprint-custom-values.js'");
  assert.equal(read('../../apps/production-extension/api-configuration.js'), browserImports(read('../../packages/contracts/src/api-configuration.mjs')));
  assert.equal(read('../../apps/production-extension/fingerprint-custom-values.js'), read('../../packages/contracts/src/fingerprint-custom-values.mjs'));
});
