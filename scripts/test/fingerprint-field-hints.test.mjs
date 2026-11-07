// ADR-107: pure helpers of the Antidetect level controls (hint placement, value sources, explainer, zone search, roving, rebase).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEVEL_FIELDS, FIELD_ROWS, fieldOwns, placeIssues, issueTarget, fieldSource, gpuShortName, explainIssue, searchZones, zoneCountry, languageLabel, rovingIndex, rebaseConfiguration, pendingViews, PENDING_VIEWS } from '../../apps/production-extension/fingerprint-field-hints.js';
import { createApiConfiguration, updateApiConfiguration, validateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { regionDefaults } from '../../apps/production-extension/fingerprint-region-data.js';
import { fingerprintDeviceLabels } from '../../apps/production-extension/fingerprint-device-labels.js';

const issue = (code, ids, severity = 'warning') => ({ code, ids, severity });
const custom = (configuration, id, value) => updateApiConfiguration(configuration, id, { mode: 'custom', selected: { kind: 'value', value } }).value;

test('every level control owns rows, and placement puts a hint under the first owning control of the shown level only', () => {
  for (const [level, fields] of Object.entries(LEVEL_FIELDS)) for (const field of fields) assert.ok(FIELD_ROWS[field]?.length, level + '/' + field + ' owns rows');
  assert.ok(fieldOwns('screen', 'screen-orientation') && fieldOwns('screen', 'screen-some-future-row'), 'every screen-* row belongs to the screen control');
  assert.equal(fieldOwns('cpu', 'device-memory'), false); assert.equal(fieldOwns('cpu', 7), false);
  const cores = issue('cores-above-real', ['hardware-concurrency']), host = issue('host-os', ['navigator-platform', 'navigator-user-agent'], 'info'), pdf = issue('plugins-pdf', ['navigator-plugins', 'navigator-metadata']);
  const device = placeIssues([cores, host, pdf], 'device');
  assert.deepEqual([...device.byField.keys()], ['cpu']); assert.deepEqual(device.byField.get('cpu'), [cores]); assert.deepEqual(device.rest, [host, pdf], 'other levels and unowned rows stay in the list');
  const os = placeIssues([cores, host, pdf], 'os');
  assert.deepEqual(os.byField.get('os'), [host]); assert.deepEqual(os.rest, [cores, pdf]);
  const quick = placeIssues([cores, host], 'quick');
  assert.equal(quick.byField.size, 0); assert.deepEqual(quick.rest, [cores, host], 'the quick view keeps one list');
  const engine = issue('engine-version', ['navigator-user-agent', 'client-hints'], 'info');
  assert.deepEqual([...placeIssues([engine], 'browser').byField.keys()], ['version'], 'a version hint sits under the Version select, not the family');
  assert.deepEqual(issueTarget(engine), { level: 'browser', field: 'version' });
  assert.deepEqual(issueTarget(cores), { level: 'device', field: 'cpu' }); assert.deepEqual(issueTarget(host), { level: 'os', field: 'os' });
  assert.deepEqual(issueTarget(issue('geolocation-timezone-mismatch', ['geolocation', 'timezone'])), { level: 'os', field: 'region' });
  assert.equal(issueTarget(pdf), null, 'a row no control owns has no target'); assert.equal(issueTarget({ code: 'x' }), null);
});

test('a value source is real, the region\'s or custom, and is never guessed', () => {
  let configuration = createApiConfiguration();
  const valueOf = () => id => { const row = configuration.apis.find(item => item.id === id); return row.mode === 'custom' && row.selected.kind === 'value' ? row.selected.value : undefined; };
  for (const field of ['cpu', 'timezone', 'language', 'region', 'screen']) assert.equal(fieldSource(field, valueOf(), 'DE'), 'real', field);
  const de = regionDefaults('DE');
  configuration = custom(configuration, 'timezone', { timeZone: de.timeZone, offsetMinutes: 60 });
  configuration = custom(configuration, 'navigator-language', de.locale);
  configuration = custom(configuration, 'geolocation', { latitude: de.latitude, longitude: de.longitude, accuracy: 25 });
  assert.equal(fieldSource('timezone', valueOf(), 'DE'), 'region'); assert.equal(fieldSource('language', valueOf(), 'DE'), 'region'); assert.equal(fieldSource('region', valueOf(), 'DE'), 'region');
  assert.equal(fieldSource('timezone', valueOf(), null), 'custom', 'without a region a set value is custom');
  configuration = custom(configuration, 'timezone', { timeZone: 'Asia/Tokyo', offsetMinutes: 540 });
  assert.equal(fieldSource('timezone', valueOf(), 'DE'), 'custom', 'another zone than the region\'s');
  assert.equal(fieldSource('timezone', valueOf(), 'JP'), 'custom', 'a zone alone is not «from the region» it derives (the language and place are Germany\'s)');
  assert.equal(fieldSource('language', valueOf(), 'DE'), 'region', 'the language still is the German region\'s');
  configuration = custom(configuration, 'hardware-concurrency', 8);
  assert.equal(fieldSource('cpu', valueOf(), 'DE'), 'custom');
  configuration = custom(configuration, 'screen-width', 1920);
  assert.equal(fieldSource('screen', valueOf(), 'DE'), 'custom');
});

test('the GPU name and the «claimed / this browser» explainer read only what the snapshot has', () => {
  assert.equal(gpuShortName('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'NVIDIA GeForce RTX 3060');
  assert.equal(gpuShortName('ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'Intel(R) UHD Graphics 630');
  assert.equal(gpuShortName('Apple M2'), 'Apple M2'); assert.equal(gpuShortName(''), null); assert.equal(gpuShortName(42), null);
  assert.equal(gpuShortName('x'.repeat(500)).length, 96, 'bounded');
  const words = fingerprintDeviceLabels('en');
  assert.deepEqual(explainIssue('cores-above-real', { cores: 32 }, { hardwareConcurrency: 8 }, words), { claimed: '32', real: '8' });
  assert.deepEqual(explainIssue('cores-above-real', { cores: 32 }, {}, words), { claimed: '32', real: words.value_not_checked }, 'an unread fact is «not checked»');
  assert.deepEqual(explainIssue('memory-above-real', { reportedMemory: 32 }, { deviceMemory: 8 }, words), { claimed: '32 GB', real: '8 GB' });
  assert.deepEqual(explainIssue('host-os', { os: 'windows-11' }, { platform: 'mac' }, words), { claimed: 'Windows 11', real: 'macOS' });
  assert.deepEqual(explainIssue('screen-vs-real', { screen: '1366x768' }, { screen: { width: 1920, height: 1080 } }, words), { claimed: '1366 × 768', real: '1920 × 1080' });
  assert.deepEqual(explainIssue('engine-version', { version: 156 }, { uaMajor: 150 }, words), { claimed: 'Chrome 156', real: 'Chrome 150' });
  const gpu = { renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)' };
  assert.deepEqual(explainIssue('real-gpu-vendor', { gpu: 'nvidia-gtx-1060' }, { gpu }, words), { claimed: 'NVIDIA GeForce GTX 1060 6GB', real: 'NVIDIA GeForce RTX 3060' });
  assert.deepEqual(explainIssue('real-gpu-vendor', { gpu: null }, {}, words), { claimed: words.gpu_real_option, real: words.value_not_checked });
  assert.equal(explainIssue('real-gpu-webgpu', { gpu: null }, { gpu: { ...gpu, webgpu: null } }, words).real, 'WebGPU —', 'a browser without an adapter says so');
  assert.equal(explainIssue('real-gpu-webgpu', { gpu: null }, { gpu: { ...gpu, webgpu: { vendor: 'nvidia', architecture: 'ampere' } } }, words).real, 'nvidia · ampere');
  assert.equal(explainIssue('plugins-pdf', {}, {}, words), null, 'hints without a measurable counterpart have no explainer');
});

test('time-zone search: every word must match, accents are ignored, countries are found in the UI language', () => {
  const ids = (query, locale = 'en') => searchZones(query, locale).map(entry => entry.iana);
  assert.equal(ids('sao paulo')[0], 'America/Sao_Paulo'); assert.equal(ids('são paulo')[0], 'America/Sao_Paulo', 'accent folding');
  assert.equal(ids('york new')[0], 'America/New_York', 'word order does not matter');
  assert.deepEqual(ids('berlin de'), ['Europe/Berlin'], 'all words must match (city and country code)');
  assert.ok(ids('германия', 'ru').includes('Europe/Berlin'), 'the translated country name'); assert.ok(ids('Deutschland', 'de').includes('Europe/Berlin'));
  assert.deepEqual(ids('zzzz'), []); assert.ok(ids('').length > 0 && ids('').length <= 40, 'bounded, never the whole table');
  assert.ok(ids('united states').length > 1);
  assert.equal(zoneCountry(searchZones('berlin', 'ru')[0], 'ru'), 'Германия');
  assert.ok(searchZones('a'.repeat(5000), 'en').length === 0, 'a long query is cut, not scanned');
});

test('language names follow the UI language with the tag beside them, and fall back to the tag', () => {
  assert.equal(languageLabel('de-DE', 'ru'), 'немецкий (Германия) · de-DE');
  assert.match(languageLabel('pt-BR', 'en'), / · pt-BR$/u); assert.notEqual(languageLabel('pt-BR', 'en'), 'pt-BR');
  assert.match(languageLabel('de-DE', 'wuu'), /^德/u, 'Wu falls back to Simplified Chinese names'); assert.match(languageLabel('de-DE', 'yue'), /^德/u);
  assert.equal(languageLabel('xx-invalid!', 'en'), 'xx-invalid!', 'an invalid tag is shown as is');
  assert.equal(languageLabel('de-DE', { id: 'ru' }), languageLabel('de-DE', 'ru'), 'a locale object works like its id');
});

test('roving keys: Home/End, wrap-around, and left/right follow the text direction', () => {
  assert.equal(rovingIndex('ArrowRight', 0, 3), 1); assert.equal(rovingIndex('ArrowRight', 2, 3), 0); assert.equal(rovingIndex('ArrowLeft', 0, 3), 2);
  assert.equal(rovingIndex('ArrowDown', 1, 3), 2); assert.equal(rovingIndex('ArrowUp', 0, 3), 2);
  assert.equal(rovingIndex('ArrowLeft', 0, 3, true), 1, 'in RTL the left arrow moves forward'); assert.equal(rovingIndex('ArrowRight', 0, 3, true), 2);
  assert.equal(rovingIndex('Home', 2, 3), 0); assert.equal(rovingIndex('End', 0, 3), 2); assert.equal(rovingIndex('Enter', 0, 3), -1); assert.equal(rovingIndex('ArrowRight', 0, 0), -1);
});

test('«Keep my changes»: my rows win over the newer revision, untouched rows follow it, conflicts are reported', () => {
  const base = createApiConfiguration();
  const mine = custom(custom(base, 'hardware-concurrency', 12), 'timezone', { timeZone: 'Europe/Berlin', offsetMinutes: 60 });
  let theirs = custom(base, 'hardware-concurrency', 3); theirs = custom(theirs, 'device-memory', 4); theirs = { ...theirs, antidetectEnabled: true };
  const result = rebaseConfiguration(base, mine, theirs);
  assert.ok(result); assert.equal(validateApiConfiguration(result.configuration).ok, true);
  const row = id => result.configuration.apis.find(item => item.id === id).selected.value;
  assert.equal(row('hardware-concurrency'), 12, 'mine wins on a row both changed'); assert.equal(row('device-memory'), 4, 'their row is kept');
  assert.equal(row('timezone').timeZone, 'Europe/Berlin', 'my row only I changed'); assert.equal(result.configuration.antidetectEnabled, true, 'their top-level change is kept');
  assert.deepEqual(result.conflicts, ['hardware-concurrency']);
  const same = rebaseConfiguration(base, mine, custom(base, 'hardware-concurrency', 12));
  assert.deepEqual(same.conflicts, [], 'the same value on both sides is no conflict');
  const top = rebaseConfiguration(base, { ...mine, preset: 'strict' }, { ...theirs, preset: 'compatibility' });
  assert.ok(top.conflicts.includes('preset')); assert.equal(top.configuration.preset, 'strict');
  assert.equal(rebaseConfiguration(base, { ...mine, preset: 'no-such-preset' }, theirs), null, 'an invalid result is refused, never staged');
});

test('pending views: the quick view whenever anything is pending, a level for the rows its controls own', () => {
  assert.deepEqual(PENDING_VIEWS, ['quick', 'device', 'os', 'browser']); assert.ok(Object.isFrozen(PENDING_VIEWS));
  assert.deepEqual(pendingViews([]), []); assert.deepEqual(pendingViews(undefined), []);
  assert.deepEqual(pendingViews([{ scope: 'global', id: 'hardware-concurrency', field: 'selected' }]), ['quick', 'device']);
  assert.deepEqual(pendingViews([{ scope: 'global', id: 'timezone', field: 'mode' }, { scope: 'global', id: 'navigator-user-agent', field: 'selected' }]), ['quick', 'os', 'browser']);
  assert.deepEqual(pendingViews([{ scope: 'global', id: null, field: 'fingerprintProfiles' }]), ['quick'], 'the library is only on the quick view');
  assert.deepEqual(pendingViews([{ scope: 'example.com', id: 'hardware-concurrency', field: 'mode' }]), ['quick'], 'a site row is not a level control');
  assert.deepEqual(pendingViews([{ scope: 'global', id: 'navigator-plugins', field: 'selected' }]), ['quick'], 'a row no control owns');
});
