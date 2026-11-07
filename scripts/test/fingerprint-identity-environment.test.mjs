// Identity from the real browser. Measured on Chrome 156 / Edge 156 (Windows 11 build 26200): platformVersion 19.0.0,
// fullVersionList [Not:A-Brand 8.0.0.0, Chromium 156.0.8078.80, Google Chrome 156.0.8078.80] (Edge: Microsoft Edge
// 156.0.4314.58). The HTTP Sec-CH-UA-* headers carry the real values and cannot be changed, so the JS values equal them
// when the claim IS the real browser; for any other claim the build part stays ${major}.0.0.0 (lower fidelity).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, applyDevicePatch, fingerprintProfileIssues } from '../../apps/production-extension/fingerprint-profiles.js';
import { describeDevice, identityValues, normalizeEnvironment, browserVersions } from '../../apps/production-extension/fingerprint-device-presets.js';

const base = createApiConfiguration();
const val = (configuration, id) => { const row = configuration.apis.find(a => a.id === id); return row?.mode === 'custom' && row.selected.kind === 'value' ? row.selected.value : undefined; };
const hintsOf = configuration => val(configuration, 'client-hints');
const CHROME = { uaMajor: 156, brand: 'chrome', platform: 'windows', platformVersion: '19.0.0', uaFullVersion: '156.0.8078.80',
  fullVersionList: [{ brand: 'Not:A-Brand', version: '8.0.0.0' }, { brand: 'Chromium', version: '156.0.8078.80' }, { brand: 'Google Chrome', version: '156.0.8078.80' }] };
const EDGE = { uaMajor: 156, brand: 'edge', platform: 'windows', platformVersion: '19.0.0', uaFullVersion: '156.0.4314.58',
  fullVersionList: [{ brand: 'Not:A-Brand', version: '8.0.0.0' }, { brand: 'Chromium', version: '156.0.8078.80' }, { brand: 'Microsoft Edge', version: '156.0.4314.58' }] };
const generate = (options, environment) => generateConsistentDevice(base, { deviceType: 'desktop', seed: 4, ...options, ...(environment ? { environment } : {}) });

test('an environment equal to the claim reuses the real build numbers, Windows 11 version and brand list', () => {
  for (const [brand, environment] of [['chrome', CHROME], ['edge', EDGE]]) {
    const hints = hintsOf(generate({ browser: brand, version: 156, os: 'windows-11' }, environment).configuration);
    assert.equal(hints.uaFullVersion, environment.uaFullVersion, brand);
    assert.deepEqual(hints.fullVersionList, environment.fullVersionList, brand);
    assert.equal(hints.platformVersion, '19.0.0');
    assert.deepEqual(hints.brands, environment.fullVersionList.map(({ brand: name, version }) => ({ brand: name, version: version.split('.')[0] })), brand + ' low-entropy brands are the real list reduced to majors');
    assert.equal(hints.platform, 'Windows'); assert.equal(hints.architecture, 'x86'); assert.equal(hints.bitness, '64'); assert.deepEqual(hints.formFactors, ['Desktop']);
  }
  // The user-agent string is the reduced one Chrome itself sends.
  assert.match(val(generate({ browser: 'edge', version: 156 }, EDGE).configuration, 'navigator-user-agent'), /Chrome\/156\.0\.0\.0 Safari\/537\.36 Edg\/156\.0\.0\.0$/u);
  // The generated lists are exactly what the real browser reports, in the same order (GREASE brand derived from the major).
  const fallback = hintsOf(generate({ browser: 'chrome', version: 156, os: 'windows-11' }).configuration);
  assert.deepEqual(fallback.brands, CHROME.fullVersionList.map(({ brand, version }) => ({ brand, version: version.split('.')[0] })), 'the major-only list equals Chrome 156');
  assert.deepEqual(fallback.fullVersionList, [{ brand: 'Not:A-Brand', version: '8.0.0.0' }, { brand: 'Chromium', version: '156.0.0.0' }, { brand: 'Google Chrome', version: '156.0.0.0' }]);
});

test('a different brand, major, OS family or a missing environment keeps the generic build numbers', () => {
  const generic = hints => assert.deepEqual([hints.uaFullVersion, hints.platformVersion], ['156.0.0.0', '19.0.0']) || assert.ok(hints.fullVersionList.every(entry => /^\d+\.0\.0\.0$/u.test(entry.version)));
  generic(hintsOf(generate({ browser: 'chrome', version: 156 }, EDGE).configuration));        // real Edge, claimed Chrome
  generic(hintsOf(generate({ browser: 'edge', version: 156 }, CHROME).configuration));        // real Chrome, claimed Edge
  generic(hintsOf(generate({ browser: 'chrome', version: 156 }, { ...CHROME, platform: 'mac' }).configuration));
  generic(hintsOf(generate({ browser: 'chrome', version: 156 }, { ...CHROME, platform: undefined }).configuration));
  generic(hintsOf(generate({ browser: 'chrome', version: 156 }).configuration));              // no environment
  generic(hintsOf(generate({ browser: 'chrome', version: 156 }, {}).configuration));
  const older = hintsOf(generate({ browser: 'chrome', version: 155 }, CHROME).configuration);  // real 156, claimed 155
  assert.equal(older.uaFullVersion, '155.0.0.0'); assert.equal(older.fullVersionList.find(entry => entry.brand === 'Google Chrome').version, '155.0.0.0');
  assert.equal(older.platformVersion, '19.0.0', 'the Windows 11 default does not need the real browser');
});

test('Windows platformVersion: 11 defaults to 19.0.0, 10 stays 10.0.0, a real Windows 11 value is reused only for a Windows 11 claim', () => {
  assert.equal(hintsOf(generate({ os: 'windows-11' }).configuration).platformVersion, '19.0.0');
  assert.equal(hintsOf(generate({ os: 'windows-10' }).configuration).platformVersion, '10.0.0');
  for (const real of ['13.0.0', '14.0.0', '15.0.0', '19.0.0']) assert.equal(hintsOf(generate({ browser: 'chrome', version: 156, os: 'windows-11' }, { ...CHROME, platformVersion: real }).configuration).platformVersion, real);
  // A Windows 10 claim keeps 10.0.0 even on a real Windows 11, and a real Windows 10 value cannot make a Windows 11 claim.
  assert.equal(hintsOf(generate({ browser: 'chrome', version: 156, os: 'windows-10' }, CHROME).configuration).platformVersion, '10.0.0');
  assert.equal(hintsOf(generate({ browser: 'chrome', version: 156, os: 'windows-11' }, { ...CHROME, platformVersion: '10.0.0' }).configuration).platformVersion, '19.0.0');
  for (const junk of ['abc', '15.0', '15', '', '1.2.3.4', 15, null, '15.0.0 ', '99999.0.0']) assert.equal(hintsOf(generate({ browser: 'chrome', version: 156, os: 'windows-11' }, { ...CHROME, platformVersion: junk }).configuration).platformVersion, '19.0.0', String(junk));
});

test('the Windows version read back from platformVersion: major 13 or higher is Windows 11, 1..10 is Windows 10', () => {
  const os = platformVersion => describeDevice(id => id === 'client-hints' ? { brands: [], mobile: false, platform: 'Windows', platformVersion } : undefined).os;
  for (const value of ['13.0.0', '14.0.0', '15.0.0', '19.0.0', '20.1.0']) assert.equal(os(value), 'windows-11', value);
  for (const value of ['10.0.0', '1.0.0', '8.0.0']) assert.equal(os(value), 'windows-10', value);
  for (const value of ['0.3.0', '11.0.0', '12.0.0', 'abc', '', undefined, 15]) assert.equal(os(value), null, String(value));
  // Another system's platformVersion (macOS 15 is also "15.0.0") is not Windows 11.
  assert.equal(describeDevice(id => id === 'client-hints' ? { brands: [], mobile: false, platform: 'macOS', platformVersion: '15.0.0' } : undefined).os, null);
  // Profiles saved before this change (Windows 11 = 15.0.0) are still Windows 11, and a round trip keeps the OS.
  const old = describeDevice(id => id === 'client-hints' ? { brands: [], mobile: false, platform: 'Windows', platformVersion: '15.0.0' } : undefined);
  assert.equal(old.os, 'windows-11');
  for (const choice of ['windows-10', 'windows-11']) assert.equal(applyDevicePatch(base, { os: choice, browser: 'chrome', version: 150 }).device.os, choice);
  for (const choice of ['windows-10', 'windows-11']) assert.equal(generate({ os: choice }).summary.os, choice);
  for (const choice of ['windows-10', 'windows-11']) assert.equal(describeDevice(id => val(generate({ os: choice }).configuration, id)).os, choice, 'Randomize output reads back as the chosen OS');
});

test('applyDevicePatch uses the environment for identity rows (patch field and third argument) and never rewrites a row on its own', () => {
  const viaPatch = applyDevicePatch(base, { os: 'windows-11', browser: 'edge', version: 156, environment: EDGE });
  assert.equal(hintsOf(viaPatch.configuration).uaFullVersion, '156.0.4314.58');
  assert.deepEqual(hintsOf(viaPatch.configuration).fullVersionList, EDGE.fullVersionList);
  const viaThird = applyDevicePatch(base, { os: 'windows-11', browser: 'chrome', version: 156 }, CHROME);
  assert.equal(hintsOf(viaThird.configuration).uaFullVersion, '156.0.8078.80');
  // The environment alone changes nothing; a core-only patch does not touch the identity.
  const alone = applyDevicePatch(base, { environment: CHROME });
  assert.deepEqual(alone.affected, []);
  assert.deepEqual(applyDevicePatch(base, { cores: 8, environment: CHROME }).affected, ['hardware-concurrency']);
  // The environment is plain data: malformed ones are dropped, not thrown on.
  for (const environment of [null, 5, 'x', [], { uaMajor: 'x', brand: 'firefox', platform: 'amiga' }]) assert.equal(hintsOf(applyDevicePatch(base, { os: 'windows-11', browser: 'chrome', version: 156, environment }).configuration).uaFullVersion, '156.0.0.0');
});

test('the environment is validated and bounded: bad fields are dropped, accessors are never run', () => {
  const clean = normalizeEnvironment(CHROME);
  assert.equal(clean.uaMajor, 156); assert.equal(clean.platform, 'windows'); assert.equal(clean.fullVersionList.length, 3);
  assert.ok(Object.isFrozen(clean) && Object.isFrozen(clean.fullVersionList));
  const drops = {
    uaMajor: [0, 1000, 156.5, '156', NaN], brand: ['firefox', 5, 'Chrome'], platform: ['amiga', 5, 'x'.repeat(100)],
    platformVersion: ['x', '1.2', '1.2.3.4', 7], uaFullVersion: ['x', '156', '1.2.3.4.5', 156], hardwareConcurrency: [0, 2.5, '8', 99999, NaN],
    devicePixelRatio: [0, 17, NaN, '1.5'], timeZone: ['', 'x'.repeat(129), 5], outer: [{ width: 1 }, { width: 0, height: 5 }, 'x'], screen: [{}, { width: 0 }, 'x', 5],
    fullVersionList: [[], 'x', Array.from({ length: 17 }, (_, index) => ({ brand: 'B' + index, version: '1.0' })), [{ brand: 'A', version: '1' }, { brand: 'A', version: '2' }], [{ brand: 'A', version: 'x' }], [{ brand: '', version: '1' }], [{ brand: 'A' }]],
  };
  for (const [key, list] of Object.entries(drops)) for (const bad of list) assert.equal(normalizeEnvironment({ [key]: bad })[key], undefined, `${key}: ${JSON.stringify(bad)}`);
  assert.deepEqual(normalizeEnvironment({ screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1032, colorDepth: 24, extra: 1 } }).screen, { width: 1920, height: 1080, availWidth: 1920, availHeight: 1032, colorDepth: 24 });
  assert.deepEqual(normalizeEnvironment({ outer: { width: 1200, height: 700, left: 5 } }).outer, { width: 1200, height: 700 });
  assert.equal(normalizeEnvironment({ timeZone: 'Asia/Dubai', devicePixelRatio: 1.5 }).timeZone, 'Asia/Dubai');
  // The older snapshot shape is understood: major and brand from the user agent, platform from navigator.platform / uaData.
  const legacy = normalizeEnvironment({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0', platform: 'Win32', uaData: { brands: [{ brand: 'Microsoft Edge', version: '156' }], platform: 'Windows' } });
  assert.deepEqual([legacy.uaMajor, legacy.brand, legacy.platform], [156, 'edge', 'windows']);
  assert.equal(normalizeEnvironment({ platform: 'MacIntel' }).platform, 'mac'); assert.equal(normalizeEnvironment({ platform: 'Linux x86_64' }).platform, 'linux'); assert.equal(normalizeEnvironment({ uaData: { platform: 'macOS' } }).platform, 'mac');
  // First valid source wins; later sources fill the gaps.
  const merged = normalizeEnvironment({ uaMajor: 150 }, { uaMajor: 156, brand: 'chrome' });
  assert.deepEqual([merged.uaMajor, merged.brand], [150, 'chrome']);
  let read = 0;
  const accessor = {}; for (const key of ['uaMajor', 'brand', 'platform', 'fullVersionList', 'screen', 'userAgent', 'uaData']) Object.defineProperty(accessor, key, { enumerable: true, get() { read++; return 'x'; } });
  assert.deepEqual({ ...normalizeEnvironment(accessor) }, {}); assert.equal(read, 0);
  const nested = { fullVersionList: [], screen: {} }; Object.defineProperty(nested.screen, 'width', { enumerable: true, get() { read++; return 5; } });
  Object.defineProperty(nested.fullVersionList, 0, { enumerable: true, get() { read++; return { brand: 'A', version: '1' }; } });
  assert.equal(normalizeEnvironment(nested).screen, undefined); assert.equal(normalizeEnvironment(nested).fullVersionList, undefined); assert.equal(read, 0, 'nested accessors are not invoked either');
});

test('a claim equal to the real browser raises no engine or OS hint; a different one raises information only', () => {
  const equal = generate({ browser: 'chrome', version: 156, os: 'windows-11' }, CHROME);
  assert.ok(!equal.issues.some(issue => ['host-os', 'engine-version'].includes(issue.code)));
  const other = fingerprintProfileIssues(generate({ browser: 'chrome', version: 150, os: 'windows-11' }).configuration, CHROME);
  const hint = other.find(issue => issue.code === 'engine-version');
  assert.equal(hint?.severity, 'info');
  assert.ok(browserVersions().includes(156) && identityValues({ os: 'windows-11', browser: 'chrome', version: 156, environment: CHROME }).length === 4);
});
