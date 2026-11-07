// ADR-107 catalog 9 (format 8, published in round 4): Chrome-measured presets/names and the speech-voices language filter on
// top of the published catalog 8 (release 2.0.0). Catalogs 8 and 9 stay byte-pinned (catalog 9 is no longer the current one;
// api-configuration-catalog10.test.mjs pins the current pair). A REAL catalog-8 export produced by the published module
// (api-configuration-catalog8-export.fixture.json) imports and migrates, and catalog-9-only values are rejected inside
// catalog-8 files. No browser or backend access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as contract from '../../packages/contracts/src/api-configuration.mjs';

const clone = value => structuredClone(value);
const tagged = value => ({ kind: 'value', value });
const row = (config, id) => config.apis.find(entry => entry.id === id);
const siteRow = (scope, id) => scope.apis.find(entry => entry.id === id);
const check = (id, value) => contract.validateApiValue(id, tagged(value));
const sha = text => createHash('sha256').update(text).digest('hex');
// Catalog 9 differs from catalog 8 in exactly these rows, in catalog order.
const V9_ROWS = ['network-information', 'speech-voices', 'storage-estimate', 'performance-memory', 'navigator-plugins', 'audio-fingerprint', 'clock-precision'];
// Output of exportApiConfiguration from release/Detect.Expert-2.0.0-chrome/api-configuration.js (sha256 1ec62fbd...).
const FIXTURE = readFileSync(new URL('./api-configuration-catalog8-export.fixture.json', import.meta.url), 'utf8');

// A valid catalog 9 / format 8 document: every row of the frozen catalog 9, nothing selected, as the round-4 build exports it.
const metadata = ({ id, order, name, group, type, customSupported, customReason, valueHint, allowNull, allowUndefined, presets }) => ({ id, order, name, group, type, customSupported, customReason, valueHint, allowNull, allowUndefined, presets });
const v9Document = () => ({ format: contract.API_CONFIGURATION_FORMAT, formatVersion: 8, catalogVersion: 9, enabled: false, antidetectEnabled: false, preset: 'limited', webrtcNetworkPolicy: 'system',
  apis: contract.API_CONFIG_CATALOG_V9.map(entry => ({ ...clone(metadata(entry)), mode: 'bypass', userValues: [], selected: { kind: 'unset' }, settings: {} })), sites: [], fingerprintProfiles: [] });

test('catalog9 is published (format 8) and frozen byte for byte: catalog8 is frozen too and catalog9 differs from it in exactly seven rows', () => {
  assert.equal(sha(JSON.stringify(contract.API_CONFIG_CATALOG_V8)), '6a8d1b4ad09efee6237b4ac8bad9ed79a5789c1d86d01d24de50b7e36db6f447', 'catalog 8 of release 2.0.0');
  // JSON.stringify(API_CONFIG_CATALOG_V9) of the round-4 build installed at the owner (release/Detect.Expert-2.0.0-chrome, api-configuration.js sha256 fc7c6548...).
  assert.equal(sha(JSON.stringify(contract.API_CONFIG_CATALOG_V9)), '2200ab966b82da57e0245cbc79d7ad3d3428675f8c8e554a48f58cc1c4f648a0', 'catalog 9 of the round-4 build');
  const v8 = contract.API_CONFIG_CATALOG_V8, v9 = contract.API_CONFIG_CATALOG_V9;
  assert.ok(Object.isFrozen(v9)); assert.notEqual(contract.API_CONFIG_CATALOG, v9, 'catalog 9 is not the current catalog any more');
  assert.deepEqual(v9.map(entry => [entry.id, entry.order]), v8.map(entry => [entry.id, entry.order]));
  assert.deepEqual(v9.filter((entry, index) => JSON.stringify(entry) !== JSON.stringify(v8[index])).map(entry => entry.id), V9_ROWS);
  assert.equal(v9.length, 158); assert.equal(v9.filter(entry => entry.customSupported).length, 56);
  assert.deepEqual(v9.filter(entry => entry.customSupported).map(entry => entry.id), v8.filter(entry => entry.customSupported).map(entry => entry.id));
  // A document made of the frozen catalog 9 is still a valid format 8 / catalog 9 export: it migrates to the current pair.
  const upgraded = contract.upgradeApiConfiguration(v9Document());
  assert.equal(upgraded.ok, true, upgraded.error?.message); assert.equal(upgraded.migrated, true);
  assert.equal(upgraded.value.formatVersion, contract.API_CONFIGURATION_VERSION); assert.equal(upgraded.value.catalogVersion, contract.API_CONFIGURATION_CATALOG_VERSION);
});

// Chrome 156 measurements (Windows, deviceMemory 32) the presets are built from.
const presetValues = id => contract.API_CONFIG_CATALOG_V9.find(entry => entry.id === id).presets.map(preset => preset.value.value);
const v8Row = id => contract.API_CONFIG_CATALOG_V8.find(entry => entry.id === id);
const onGrid = (value, step) => Math.abs(value / step - Math.round(value / step)) < 1e-9;

test('ADR-107 network presets are Chrome-possible: rtt on 50 ms steps up to 3000, downlink on 0.05 Mbps steps up to 10, no desktop type', () => {
  const values = presetValues('network-information');
  assert.deepEqual(values[0], { downlink: 1.5, effectiveType: '4g', rtt: 100, saveData: false }, 'the typical measured desktop connection comes first');
  assert.deepEqual(values.slice(3), [{ downlink: 0.1, effectiveType: '2g', rtt: 1450, saveData: true }, { downlink: 0.05, effectiveType: 'slow-2g', rtt: 2050, saveData: true }]);
  // Chrome 156 (measured in Chrome 156) derives effectiveType from the raw rtt only: >= 272 3g, >= 1420 2g, >= 2010 slow-2g.
  const chromeType = rtt => rtt >= 2010 ? 'slow-2g' : rtt >= 1420 ? '2g' : rtt >= 272 ? '3g' : '4g';
  for (const value of values) assert.equal(value.effectiveType, chromeType(value.rtt), 'self-consistent preset ' + JSON.stringify(value));
  for (const value of values) {
    assert.ok(onGrid(value.rtt, 50) && value.rtt > 0 && value.rtt <= 3000, JSON.stringify(value)); assert.ok(onGrid(value.downlink, 0.05) && value.downlink > 0 && value.downlink <= 10, JSON.stringify(value));
    assert.equal(Object.hasOwn(value, 'type'), false); assert.equal(check('network-information', value).ok, true);
  }
  assert.ok(!values.some(value => value.downlink === 100 || value.downlink === 0.01), 'the old impossible presets are gone');
  for (const old of [{ downlink: 100, effectiveType: '4g', rtt: 0, saveData: false }, { downlink: 0.01, effectiveType: 'slow-2g', rtt: 2000, saveData: true }]) assert.equal(check('network-information', old).ok, true, 'catalog 1-7 values stay valid');
});

test('ADR-107 storage, memory and clock presets follow Chrome: quota = usage + 10 GiB, the 4395630592-byte heap limit, a 0.1 ms clock', () => {
  const storage = presetValues('storage-estimate');
  assert.deepEqual(storage[0], { quota: 10737418240, usage: 0 }); assert.deepEqual(storage[1], { quota: 10738466816, usage: 1048576 });
  for (const value of storage) { assert.equal(value.quota - value.usage, 10737418240); assert.equal(check('storage-estimate', value).ok, true); }
  const memory = presetValues('performance-memory');
  assert.deepEqual(memory[0], { jsHeapSizeLimit: 4395630592, totalJSHeapSize: 1573038, usedJSHeapSize: 1092582 });
  for (const value of memory) { assert.equal(value.jsHeapSizeLimit, 4395630592); assert.ok(value.usedJSHeapSize <= value.totalJSHeapSize && value.totalJSHeapSize <= value.jsHeapSizeLimit); }
  assert.deepEqual(presetValues('clock-precision'), [{ resolutionMs: 0.1 }, { resolutionMs: 1 }, { resolutionMs: 10 }]);
  assert.equal(check('clock-precision', { resolutionMs: 0.1 }).ok, true); assert.equal(check('clock-precision', { resolutionMs: 0.09 }).ok, false);
  assert.deepEqual(v8Row('clock-precision').presets.map(preset => preset.value.value), [{ resolutionMs: 1 }, { resolutionMs: 10 }], 'catalog 8 presets stay frozen');
  for (const id of ['storage-estimate', 'performance-memory', 'clock-precision', 'network-information']) {
    const now = contract.API_CONFIG_CATALOG_V9.find(entry => entry.id === id), before = v8Row(id);
    for (const key of ['type', 'valueHint', 'allowNull', 'allowUndefined', 'customSupported', 'group', 'order', 'name']) assert.deepEqual(now[key], before[key], `${id}.${key}`);
  }
});

test('ADR-107 navigator-plugins preset is the five built-in Chrome PDF viewer plugins with the native metadata', () => {
  const entry = contract.API_CONFIG_CATALOG_V9.find(item => item.id === 'navigator-plugins'), [pdf, empty] = presetValues('navigator-plugins');
  assert.deepEqual(entry.presets.map(preset => preset.label), ['Chrome built-in PDF viewer (5 plugins)', 'No plugins']);
  assert.deepEqual(pdf.plugins.map(plugin => plugin.name), ['PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer', 'Microsoft Edge PDF Viewer', 'WebKit built-in PDF']);
  for (const plugin of pdf.plugins) {
    assert.equal(plugin.filename, 'internal-pdf-viewer'); assert.equal(plugin.description, 'Portable Document Format');
    assert.deepEqual(plugin.mimeTypes, [{ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }, { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' }]);
  }
  assert.deepEqual(empty, { plugins: [] }); assert.equal(check('navigator-plugins', pdf).ok, true);
  assert.deepEqual(v8Row('navigator-plugins').presets.map(preset => preset.value.value), [{ plugins: [] }], 'catalog 8 presets stay frozen');
});

test('ADR-107 audio-fingerprint row names AnalyserNode readouts; catalog 8 keeps its name and value domain', () => {
  const entry = contract.API_CONFIG_CATALOG_V9.find(item => item.id === 'audio-fingerprint');
  assert.equal(entry.name, 'AudioBuffer.getChannelData / copyFromChannel / AnalyserNode readouts');
  assert.match(entry.customReason, /AnalyserNode readouts/); assert.match(entry.customReason, /getChannelData, copyFromChannel/);
  assert.equal(v8Row('audio-fingerprint').name, 'AudioBuffer.getChannelData / copyFromChannel'); assert.equal(v8Row('audio-fingerprint').customReason, null);
  assert.deepEqual(entry.presets, v8Row('audio-fingerprint').presets); assert.equal(entry.type, 'audio-fingerprint');
});

test('ADR-107 speech-voices accepts the historical empty list or 1-8 canonical BCP 47 tags; catalog 8 keeps only the empty list', () => {
  const entry = contract.API_CONFIG_CATALOG_V9.find(item => item.id === 'speech-voices');
  assert.equal(entry.type, 'speech-voices'); assert.equal(v8Row('speech-voices').type, 'empty-array');
  assert.deepEqual(presetValues('speech-voices'), [{ languages: ['en-US'] }, { languages: ['en-US', 'en-GB'] }, []]);
  assert.match(entry.customReason, /native voices filtered to the selected languages/); assert.match(entry.customReason, /No voice is created/);
  assert.deepEqual(check('speech-voices', []).value, tagged([]));
  assert.deepEqual(check('speech-voices', { languages: ['EN-us', 'de', 'zh-hant-tw'] }).value, tagged({ languages: ['en-US', 'de', 'zh-Hant-TW'] }), 'tags are stored canonically');
  const eight = ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'ja-JP', 'ru-RU'];
  assert.equal(check('speech-voices', { languages: eight }).ok, true);
  for (const [bad, code] of [[{ languages: [...eight, 'pt-BR'] }, 'invalid-type'], [{ languages: [] }, 'invalid-value'], [{ languages: ['en-US', 'en-us'] }, 'duplicate-value'],
    [{ languages: ['x'] }, 'invalid-value'], [{ languages: ['*'] }, 'invalid-value'], [{ languages: [''] }, 'invalid-value'], [{ languages: ['a'.repeat(65)] }, 'invalid-value'], [{ languages: [1] }, 'invalid-value'],
    [{ languages: 'en-US' }, 'invalid-type'], [{ languages: ['en-US'], voices: [] }, 'unknown-field'], [{}, 'missing-field'], [['en-US'], 'invalid-type'], [[{}], 'invalid-type'], [null, 'invalid-type'], ['en-US', 'invalid-type']]) {
    const result = check('speech-voices', bad);
    assert.equal(result.ok, false, JSON.stringify(bad)); assert.equal(result.error.code, code, JSON.stringify(bad));
  }
});


test('a real catalog8 export made by the published release-2.0.0 module imports and migrates without losing anything', () => {
  assert.equal(sha(FIXTURE), '311b47e0aa0ce841dfaa9658c75873a6ec2abf77af8b2764cac99282fac5ec12', 'fixture bytes are the release output');
  const before = JSON.parse(FIXTURE);
  assert.equal(before.formatVersion, 7); assert.equal(before.catalogVersion, 8);
  // The controller's stored-configuration load path.
  const stored = contract.upgradeApiConfiguration(clone(before));
  assert.equal(stored.ok, true, stored.error?.message); assert.equal(stored.migrated, true); assert.equal(stored.upgradeFailure, undefined);
  const after = stored.value;
  assert.equal(after.formatVersion, contract.API_CONFIGURATION_VERSION); assert.equal(after.catalogVersion, contract.API_CONFIGURATION_CATALOG_VERSION);
  for (const key of ['enabled', 'antidetectEnabled', 'preset', 'webrtcNetworkPolicy']) assert.equal(after[key], before[key], key);
  assert.equal(after.apis.length, 158);
  for (const old of before.apis) {
    const current = row(after, old.id);
    for (const field of ['mode', 'selected', 'userValues', 'settings']) assert.deepEqual(current[field], old[field], `${old.id}.${field}`);
    assert.deepEqual(current.presets, contract.API_CONFIG_CATALOG.find(entry => entry.id === old.id).presets, old.id + ' carries the current catalog metadata');
  }
  assert.deepEqual(after.sites, before.sites, 'exact sites and their rows are kept as they were');
  assert.deepEqual(after.fingerprintProfiles, before.fingerprintProfiles.map(profile => ({ ...profile, tags: [], note: '' })), 'library profiles are kept as they were, plus the empty tags and note of format 9');
  assert.equal(row(after, 'geolocation').selected.value.latitude, 48.8566); assert.deepEqual(row(after, 'canvas-readback').selected.value, { algorithm: 'sparse-rgb-v1' });
  assert.equal(siteRow(after.sites.find(site => site.host === 'rtc.example'), 'webrtc').selected.value.addresses.ipv4.host, 'mdns');
  assert.deepEqual(row(after, 'speech-voices').selected.value, []); assert.deepEqual(row(after, 'storage-estimate').selected.value, { quota: 1073741824, usage: 0 }, 'old preset values stay valid');
  const file = contract.importApiConfiguration(FIXTURE);
  assert.equal(file.ok, true, file.error?.message); assert.equal(file.migrated, true); assert.deepEqual(file.value, after);
  const again = contract.upgradeApiConfiguration(after);
  assert.equal(again.ok, true); assert.equal(again.migrated, false);
  const round = contract.importApiConfiguration(contract.exportApiConfiguration(after));
  assert.equal(round.ok, true); assert.equal(round.migrated, false); assert.deepEqual(round.value, after);
  const next = contract.updateApiConfiguration(after, 'speech-voices', { mode: 'custom', selected: tagged({ languages: ['de-DE'] }) });
  assert.equal(next.ok, true, next.error?.message);
});

test('catalog9-only values inside a catalog8 file are rejected wherever they are stored, before any migration starts', () => {
  const filter = tagged({ languages: ['en-US'] });
  const placements = {
    'global custom': doc => Object.assign(row(doc, 'speech-voices'), { mode: 'custom', selected: filter }),
    'global off with a stored selection': doc => Object.assign(row(doc, 'speech-voices'), { mode: 'off', selected: filter }),
    'saved value': doc => { row(doc, 'speech-voices').userValues = [{ id: 'custom-1', label: 'English', value: filter }]; },
    'exact site': doc => Object.assign(siteRow(doc.sites[0], 'speech-voices'), { mode: 'custom', selected: filter }),
    'library profile': doc => Object.assign(siteRow(doc.fingerprintProfiles[0], 'speech-voices'), { mode: 'custom', selected: filter })
  };
  for (const [where, place] of Object.entries(placements)) {
    const doc = JSON.parse(FIXTURE); place(doc); const kept = clone(doc);
    for (const result of [contract.upgradeApiConfiguration(doc), contract.importApiConfiguration(JSON.stringify(doc))]) {
      assert.equal(result.ok, false, where); assert.equal(result.error.code, 'invalid-type', where); assert.equal(result.upgradeFailure, undefined, where);
    }
    assert.deepEqual(doc, kept, where);
  }
});

test('catalog9 metadata is pinned both ways against the published catalog8', () => {
  const v8 = JSON.parse(FIXTURE), v9 = v9Document();
  const asV8 = contract.upgradeApiConfiguration({ ...v9, formatVersion: 7, catalogVersion: 8 });
  assert.equal(asV8.error.code, 'catalog-mismatch'); assert.equal(asV8.error.path, '$.apis[' + contract.API_CONFIG_CATALOG.findIndex(item => item.id === 'network-information') + ']');
  assert.equal(contract.upgradeApiConfiguration({ ...v8, formatVersion: 8, catalogVersion: 9 }).error.code, 'catalog-mismatch');
  for (const id of V9_ROWS) {
    const old = contract.API_CONFIG_CATALOG_V8.find(item => item.id === id), now = contract.API_CONFIG_CATALOG_V9.find(item => item.id === id);
    let differing = 0;
    for (const field of ['name', 'customReason', 'customSupported', 'presets', 'type', 'valueHint']) {
      if (JSON.stringify(old[field]) === JSON.stringify(now[field])) continue;
      differing++;
      const forged = JSON.parse(FIXTURE); row(forged, id)[field] = clone(now[field]);
      assert.equal(contract.upgradeApiConfiguration(forged).error.code, 'catalog-mismatch', `${id}.${field} of catalog9 in a catalog8 file`);
      const stale = clone(v9); row(stale, id)[field] = clone(old[field]);
      assert.equal(contract.upgradeApiConfiguration(stale).error?.code, 'catalog-mismatch', `${id}.${field} of catalog8 in a catalog9 file`);
    }
    assert.ok(differing > 0, id);
  }
  assert.equal(contract.upgradeApiConfiguration({ ...v9, formatVersion: 7, catalogVersion: 9 }).error.code, 'incompatible-version');
  assert.equal(contract.upgradeApiConfiguration({ ...v8, formatVersion: 8, catalogVersion: 8 }).error.code, 'incompatible-version');
});
