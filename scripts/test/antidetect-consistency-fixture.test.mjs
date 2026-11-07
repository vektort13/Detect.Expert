// Pure checks of antidetect-consistency-fixture.mjs: a coherent synthetic page passes, and each single broken surface is
// reported under its own check id. The known-limits ratchet and its JSON file are validated here without a browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice } from '../../apps/production-extension/fingerprint-profiles.js';
import { CONSISTENCY_CASES, CONSISTENCY_PRESETS, DATE_PROBE_INSTANT, applyLimits, childHtml, consistencyFindings, customValue, limitsProblems, realmSnapshot, topHtml, wireAcceptLanguage, wireBrands, zoneOffsetAt } from './antidetect-consistency-fixture.mjs';

const limitsFile = JSON.parse(readFileSync(join(import.meta.dirname, 'antidetect-consistency-limits.json'), 'utf8'));
const clone = value => structuredClone(value);
const gmt = minutes => 'GMT' + (minutes <= 0 ? '+' : '-') + String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0') + String(Math.abs(minutes) % 60).padStart(2, '0');

// A page that reads exactly what a coherent Chrome would show for the generated profile.
function coherentRun() {
  const configuration = generateConsistentDevice(createApiConfiguration(), { seed: 42, protection: 'balanced', deviceType: 'desktop', os: 'windows-11', browser: 'chrome', version: 150, region: 'DE' }).configuration;
  const value = id => customValue(configuration, id), hints = value('client-hints'), zone = value('timezone'), languages = value('navigator-languages'), ua = value('navigator-user-agent');
  const gl = value('webgl'), touch = value('touch-points') ?? 0;
  const top = { ua, appVersion: ua.replace(/^Mozilla\//u, ''), platform: value('navigator-platform'), vendor: 'Google Inc.', oscpu: null, language: languages[0], languages,
    cores: value('hardware-concurrency'), memory: value('device-memory'), touch, uaData: { brands: hints.brands, mobile: hints.mobile, platform: hints.platform },
    intl: { locale: languages[0], timeZone: zone.timeZone, calendar: 'gregory', numberingSystem: 'latn', number: languages[0] }, offset: zone.offsetMinutes,
    dateString: 'Thu Jan 15 2026 13:00:00 ' + gmt(zoneOffsetAt(zone.timeZone, DATE_PROBE_INSTANT)) + ' (Central European Standard Time)',
    screen: { width: value('screen-width'), height: value('screen-height'), availWidth: value('screen-avail-width'), availHeight: value('screen-avail-height'), colorDepth: value('screen-color-depth'), pixelDepth: value('screen-pixel-depth'), orientation: value('screen-orientation') },
    dpr: value('window-device-pixel-ratio'), media: { deviceWidth: true, deviceHeight: true, resolution: true, coarse: touch > 0 }, webgl: { ...gl } };
  const worker = { ua: 'native', platform: 'Win32', language: 'en-US', languages: ['en-US', 'en'], cores: 4, memory: 8, timeZone: 'Asia/Dubai', offset: -240, uaData: null };
  const headers = ['main_frame', 'sub_frame', 'fetch', 'popup'].map(type => ({ type, scheme: 'https', headers: { 'user-agent': ua, 'accept-language': wireAcceptLanguage(languages), 'sec-ch-ua': wireBrands(hints.brands), 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"' + hints.platform + '"' } }));
  const result = { top, realms: Object.fromEntries(['blank', 'srcdoc', 'same', 'popupBlank', 'popup'].map(name => [name, clone(top)])), high: { fullVersionList: hints.fullVersionList, uaFullVersion: hints.uaFullVersion, platform: hints.platform },
    gpu: { info: { vendor: /nvidia/iu.test(gl.unmaskedVendor) ? 'nvidia' : /amd/iu.test(gl.unmaskedVendor) ? 'amd' : 'intel', architecture: '' } }, worker: clone(worker), errors: [], asyncDone: true, popupState: 'loaded' };
  return { browser: 'chrome', configuration, environment: {}, issues: [], result, headers, nativeWorker: worker, now: DATE_PROBE_INSTANT };
}
const checksOf = run => [...new Set(consistencyFindings(run).failures.map(failure => failure.check))].sort();

test('a coherent page of a generated profile has no finding', () => {
  assert.deepEqual(consistencyFindings(coherentRun()), { failures: [], notes: [] });
});

test('each broken surface is reported under its own check (deliberate breakages)', () => {
  const cases = [
    ['apply:navigator-user-agent', run => { run.result.top.ua = run.result.top.ua.replace('150', '151'); for (const realm of Object.values(run.result.realms)) realm.ua = run.result.top.ua; }],
    ['ua-platform', run => { run.result.top.platform = 'MacIntel'; }],
    ['ua-brands', run => { run.result.top.uaData.brands = run.result.top.uaData.brands.map(item => item.brand === 'Chromium' ? { ...item, version: '149' } : item); }],
    ['ua-data-missing', run => { run.result.top.uaData = null; }],
    ['ua-vendor', run => { run.result.top.vendor = ''; }],
    ['language', run => { run.result.top.language = 'fr-FR'; }],
    ['language-intl', run => { run.result.top.intl.number = 'en-US'; }],
    ['header-accept-language', run => { run.headers[1].headers['accept-language'] = 'en-US,en;q=0.9'; }],
    ['header-user-agent', run => { run.headers[2].headers['user-agent'] = 'native'; }],
    ['header-client-hints', run => { run.headers[0].headers['sec-ch-ua'] = '"Chromium";v="150"'; }],
    ['timezone-offset', run => { run.result.top.offset = -240; }],
    ['date-string', run => { run.result.top.dateString = 'Thu Jan 15 2026 16:00:00 GMT+0400'; }],
    ['screen-shape', run => { run.result.top.screen.availWidth = run.result.top.screen.width + 1; }],
    ['screen-media', run => { run.result.top.media.deviceWidth = false; }],
    ['screen-dpr-media', run => { run.result.top.media.resolution = false; }],
    ['touch', run => { run.result.top.media.coarse = true; }],
    ['gpu-family', run => { run.result.gpu.info.vendor = /nvidia/u.test(run.result.gpu.info.vendor) ? 'amd' : 'nvidia'; }],
    ['realms', run => { run.result.realms.srcdoc.languages = ['en-US']; }],
    ['realms', run => { delete run.result.realms.popup; }],
    ['worker', run => { run.result.worker.ua = run.result.top.ua; }],
    ['device-memory', run => { run.result.top.memory = 3; for (const realm of Object.values(run.result.realms)) realm.memory = 3; run.configuration = clone(run.configuration); run.configuration.apis.find(item => item.id === 'device-memory').selected = { kind: 'value', value: 3 }; }],
    ['profile-issues', run => { run.issues = [{ code: 'gpu-pair', ids: [], severity: 'warning' }, { code: 'worker-scope', ids: [], severity: 'info' }]; }],
    ['realm-errors', run => { run.result.realms.blank.webgl = { error: 'SecurityError' }; run.result.top.webgl = { error: 'SecurityError' }; }],
    ['headers', run => { run.headers = []; }],
  ];
  let caught = 0;
  for (const [check, breakIt] of cases) {
    const run = coherentRun(); breakIt(run);
    const found = checksOf(run);
    assert.ok(found.includes(check), check + ' not reported; got ' + JSON.stringify(found));
    caught++;
  }
  assert.equal(caught, cases.length);
});

test('a fixed standard offset during daylight saving time is a dated note, not a failure', () => {
  const run = coherentRun(); run.now = Date.UTC(2026, 6, 15, 12);
  const outcome = consistencyFindings(run);
  assert.deepEqual(outcome.failures, []); assert.equal(outcome.notes.length, 1); assert.match(outcome.notes[0], /daylight saving time: Europe\/Berlin is at -120 today, the profile reports its fixed standard offset -60/u);
  // A page offset that is neither the profile's nor explained by DST, the same in every realm.
  for (const snapshot of [run.result.top, ...Object.values(run.result.realms)]) snapshot.offset = -120;
  run.now = DATE_PROBE_INSTANT;
  assert.deepEqual(checksOf(run), ['timezone-offset']);
});

test('page code: the fixed Date instant, escaping and wire formats', () => {
  assert.equal(DATE_PROBE_INSTANT, Date.UTC(2026, 0, 15, 12));
  assert.ok(realmSnapshot.toString().includes('new w.Date(' + DATE_PROBE_INSTANT + ')'), 'realmSnapshot reads the same fixed instant');
  for (const html of [topHtml('r</script>x'), childHtml('r</script>x')]) assert.equal(html.split('</script').length - 1, 1, 'run ids cannot close the inline script early');
  assert.equal(wireAcceptLanguage(['de-DE', 'de', 'en-US', 'en']), 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7');
  assert.equal(wireAcceptLanguage(Array.from({ length: 12 }, (_, index) => 'l' + index)).split(',').at(-1), 'l11;q=0.1');
  assert.equal(wireBrands([{ brand: 'Chromium', version: '150' }, { brand: 'Not.A/Brand', version: '24' }]), '"Chromium";v="150", "Not.A/Brand";v="24"');
  assert.equal(zoneOffsetAt('Asia/Kolkata', DATE_PROBE_INSTANT), -330); assert.equal(zoneOffsetAt('America/New_York', DATE_PROBE_INSTANT), 300);
  assert.equal(CONSISTENCY_CASES.length, 8); assert.deepEqual(CONSISTENCY_PRESETS, ['compatibility', 'balanced', 'strict']);
  assert.equal(new Set(CONSISTENCY_CASES.map(item => item.seed)).size, 8);
});

test('known limits: covered findings are known, uncovered ones unexpected, unused entries stale (ratchet)', () => {
  const limits = [{ check: 'date-string', browsers: ['chrome', 'firefox'], reason: 'x'.repeat(40) }, { check: 'ua-vendor', browsers: ['firefox'], presets: ['strict'], reason: 'y'.repeat(40) }];
  const findings = [{ check: 'date-string', browser: 'chrome', preset: 'balanced' }, { check: 'ua-vendor', browser: 'firefox', preset: 'balanced' }, { check: 'realms', browser: 'chrome', preset: 'strict' }];
  const verdict = applyLimits(findings, limits, { browsers: ['chrome', 'firefox'] });
  assert.deepEqual(verdict.known.map(item => item.check), ['date-string']);
  assert.deepEqual(verdict.unexpected.map(item => item.check), ['ua-vendor', 'realms'], 'a preset-scoped limit does not cover other presets');
  assert.deepEqual(verdict.stale, [{ check: 'date-string', browser: 'firefox', presets: null }, { check: 'ua-vendor', browser: 'firefox', presets: ['strict'] }]);
  assert.deepEqual(applyLimits(findings, limits, { browsers: ['chrome'] }).stale, [], 'a browser that did not run cannot make an entry stale');
  assert.deepEqual(applyLimits([], limits, { browsers: ['chrome', 'firefox'], complete: false }).stale, [], 'debug subsets never report stale entries');
});

test('the shipped known-limits file is well formed and every entry has a reason', () => {
  assert.equal(limitsFile.schema, 1);
  assert.deepEqual(limitsProblems(limitsFile.limits), []);
  assert.ok(limitsFile.limits.length >= 1);
  assert.deepEqual(limitsProblems([{ check: 'x', browsers: ['safari'], reason: 'short' }, { check: 'y', browsers: ['chrome'], presets: ['max'], reason: 'z'.repeat(40) }]),
    ['malformed limit {"check":"x","browsers":["safari"],"reason":"short"}', 'limit x needs a reason of at least 40 characters', 'bad presets in y']);
  assert.ok(limitsProblems([...limitsFile.limits, limitsFile.limits[0]]).some(problem => problem.startsWith('duplicate limit')));
});
