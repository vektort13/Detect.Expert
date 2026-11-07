// The native registry (native-suites.mjs) matches scripts/test/*-native.mjs and the release scripts; the runner plans
// what the registry says; the evidence helper stays inside its folder and mirrors the production build.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { FULL_RELEASE_GROUP, NATIVE_FILES, NATIVE_GROUPS, NATIVE_SUITES, PACKAGE_CHECKS, browsersOf, registryProblems } from './native-suites.mjs';
import { ADAPTER_WRAPPED, BACKGROUND_ORIGIN, BRIDGE_CONTEXT, BRIDGE_ORIGIN, LEGACY_EVIDENCE_VERSIONS, ROOT, evidencePath, evidenceRoot, findEvidence, productionVersion, readEvidence, writeEvidence } from './native-evidence.mjs';
import { buildPlan, parseArguments, renderMarkdown, runKey } from '../run-natives.mjs';

const files = readdirSync(join(ROOT, 'scripts/test')), scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;

test('every native file is registered exactly once and every registered file exists', () => {
  assert.deepEqual(registryProblems(files, NATIVE_SUITES, scripts), []);
  assert.deepEqual([...NATIVE_FILES].sort(), files.filter(file => file.endsWith('-native.mjs')).sort());
  assert.ok(PACKAGE_CHECKS.every(item => existsSync(join(ROOT, 'scripts/test', item.file))));
});

test('registry problems are reported for unlisted, duplicated, missing and malformed entries', () => {
  const extra = [...files, 'zz-unlisted-native.mjs'];
  assert.ok(registryProblems(extra, NATIVE_SUITES, scripts).includes('not listed: zz-unlisted-native.mjs'));
  const twice = [...NATIVE_SUITES, NATIVE_SUITES[0]];
  assert.ok(registryProblems(files, twice, scripts).includes('listed 2 times: ' + NATIVE_SUITES[0].file));
  const ghost = [...NATIVE_SUITES, { file: 'ghost-native.mjs', run: { chrome: [] }, group: 'tools', gate: 'suite' }];
  assert.ok(registryProblems(files, ghost, scripts).includes('ghost-native.mjs: listed but missing in scripts/test'));
  const dropped = NATIVE_SUITES.filter(item => item.file !== 'math-transcendentals-native.mjs');
  assert.ok(registryProblems(files, dropped, scripts).includes('not listed: math-transcendentals-native.mjs'));
  const broken = NATIVE_SUITES.map(item => item.file === 'webrtc-ui-native.mjs' ? { ...item, gate: 'manual' } : item.file === 'forter-native.mjs' ? { ...item, run: { safari: [] } } : item.file === 'clear-reset-native.mjs' ? { ...item, run: { chrome: ['--build'] } } : item);
  const problems = registryProblems(files, broken, scripts);
  assert.ok(problems.includes('webrtc-ui-native.mjs: manual entries need a reason'));
  assert.ok(problems.includes('forter-native.mjs: run must name chrome and/or firefox'));
  assert.ok(problems.includes('clear-reset-native.mjs: the runner never builds (no --build/--release)'));
});

test('release gates: release:verify natives are release-gated and release:verify:full adds the Antidetect group', () => {
  const releaseNatives = [...scripts['release:verify'].matchAll(/scripts\/test\/([a-z0-9-]+-native\.mjs)/gu)].map(match => match[1]);
  assert.deepEqual(releaseNatives, ['protect-privacy-native.mjs', 'protect-overlay-native.mjs', 'management-native.mjs', 'browser-debug-native.mjs']);
  for (const file of releaseNatives) assert.equal(NATIVE_SUITES.find(item => item.file === file).gate, 'release', file);
  const full = scripts['release:verify:full'];
  assert.match(full, /^pnpm release:verify && node scripts\/run-natives\.mjs /u);
  const options = parseArguments(full.split(' && ')[1].split(' ').slice(2));
  assert.deepEqual(options.groups, [FULL_RELEASE_GROUP]); assert.equal(options.gate, 'release'); assert.deepEqual(options.browsers, ['chrome', 'firefox']);
  const plan = buildPlan(options);
  assert.ok(plan.length >= 40 && plan.every(step => step.group === FULL_RELEASE_GROUP && !step.skip));
  for (const browser of ['chrome', 'firefox']) assert.ok(plan.some(step => step.file === 'antidetect-consistency-native.mjs' && step.browser === browser), browser);
  assert.equal(plan.at(-1).file, 'antidetect-package.mjs'); assert.equal(plan.at(-1).kind, 'package');
  assert.ok(!plan.some(step => step.file === 'api-custom-cold-firefox-native.mjs'), 'manual entries are never selected by gate');
  const natives = parseArguments(scripts['test:natives'].split(' ').slice(2));
  assert.deepEqual(natives.groups, NATIVE_GROUPS); assert.equal(natives.continueOnFailure, true);
});

test('the runner plans manual skips, explicit runs, browser filters and last-failed reruns', () => {
  const plan = buildPlan(parseArguments(['--group', 'antidetect']));
  const cold = plan.find(step => step.file === 'api-custom-cold-firefox-native.mjs');
  assert.equal(cold.skip, true); assert.match(cold.reason, /Nightly/u);
  const forced = buildPlan(parseArguments(['--only', 'api-custom-cold-firefox-native.mjs']));
  assert.deepEqual(forced.map(step => [step.file, step.browser, step.skip ?? false]), [['api-custom-cold-firefox-native.mjs', 'firefox', false]]);
  const chrome = buildPlan(parseArguments(['--group', 'antidetect', '--browser', 'chrome']));
  assert.ok(chrome.every(step => step.browser === 'chrome' || step.kind === 'package'));
  assert.ok(!chrome.some(step => step.file === 'webrtc-ui-firefox-native.mjs'));
  const math = buildPlan(parseArguments(['--only', 'math-transcendentals-native.mjs']));
  assert.deepEqual(math.map(step => [step.browser, step.args]), [['chrome', []], ['firefox', ['--firefox']]]);
  const previous = { results: buildPlan(parseArguments(['--group', 'antidetect'])).map(step => ({ ...step, status: step.skip ? 'skipped' : step.file === 'canvas-sparse-native.mjs' && step.browser === 'firefox' ? 'fail' : step.file === 'webrtc-native.mjs' ? 'timeout' : 'pass' })) };
  const again = buildPlan(parseArguments(['--group', 'antidetect', '--last-failed']), NATIVE_SUITES, previous);
  assert.deepEqual(again.map(runKey), ['canvas-sparse-native.mjs|firefox', 'webrtc-native.mjs|chrome']);
  assert.throws(() => buildPlan(parseArguments(['--last-failed'])), /previous/u);
  for (const bad of [['--group', 'nope'], ['--browser', 'safari'], ['--gate', 'manual'], ['--only', 'nope-native.mjs'], ['--timeout', '0'], ['--frobnicate']]) assert.throws(() => parseArguments(bad), Error, bad.join(' '));
  const markdown = renderMarkdown({ version: '9.9.9', startedAt: 'a', finishedAt: 'b', command: ['node', 'x'], totals: { pass: 1, fail: 1 }, dist: { chrome: { exists: true, version: '9.9.9', builtAt: 'c', stale: true, newestSource: 'apps/x.js', newestSourceAt: 'd' } },
    results: [{ file: 'a-native.mjs', browser: 'chrome', group: 'tools', gate: 'suite', status: 'pass', durationMs: 60000, log: 'l' }, { file: 'b-native.mjs', browser: 'firefox', group: 'tools', gate: 'suite', status: 'fail', durationMs: 1, tail: ['boom'], log: 'm' }] });
  assert.match(markdown, /# Native tests 9\.9\.9/u); assert.match(markdown, /OLDER than apps\/x\.js/u); assert.match(markdown, /### b-native\.mjs \(firefox\) — fail[\s\S]*boom/u);
});

test('every registered browser selection is real: flags named in run exist in the native source', () => {
  for (const item of NATIVE_SUITES) for (const browser of browsersOf(item)) for (const flag of item.run[browser].filter(argument => argument.startsWith('--'))) {
    const source = readFileSync(join(ROOT, 'scripts/test', item.file), 'utf8');
    // Either the literal flag or a parser that prefixes '--' to a bare name (argument('browser')).
    assert.ok(source.includes("'" + flag + "'") || source.includes("'--' + name") && source.includes("('" + flag.slice(2) + "'"), item.file + ' does not read ' + flag);
  }
});

test('evidence paths follow the production manifest version and never leave their folder', () => {
  const version = JSON.parse(readFileSync(join(ROOT, 'apps/production-extension/manifest.json'), 'utf8')).version;
  assert.equal(productionVersion(), version); assert.equal(evidenceRoot(), join(ROOT, 'test-results', 'production-' + version));
  assert.equal(evidencePath('math-transcendentals/chrome.json'), join(ROOT, 'test-results', 'production-' + version, 'math-transcendentals', 'chrome.json'));
  for (const bad of ['', '../x.json', 'a/../../x.json', 'C:/x.json', '/x.json', 'a//b.json', './a.json']) assert.throws(() => evidencePath(bad), /evidence path/u, bad);
  assert.ok(!LEGACY_EVIDENCE_VERSIONS.includes(version));
  const probe = 'native-evidence-selftest/' + process.pid + '.json';
  try {
    const written = writeEvidence(probe, { ok: true }); assert.equal(readFileSync(written, 'utf8'), '{\n  "ok": true\n}\n');
    assert.deepEqual(readEvidence(probe), { path: written, version, legacy: false, value: { ok: true } });
    assert.equal(findEvidence('native-evidence-selftest/absent.json'), null);
  } finally { rmSync(join(evidenceRoot(), 'native-evidence-selftest'), { recursive: true, force: true }); }
});

test('the source assembly mirrors scripts/build-production.mjs (tripwire for its anchors)', () => {
  const build = readFileSync(join(ROOT, 'scripts/build-production.mjs'), 'utf8');
  assert.ok(build.includes(JSON.stringify(ADAPTER_WRAPPED).replaceAll('"', "'").replaceAll(',', ', ')), 'adapter-wrapped entry list changed in build-production.mjs');
  assert.ok(build.includes(JSON.stringify(BRIDGE_CONTEXT).replaceAll('"', "'").replaceAll(',', ', ')), 'bridge context list changed in build-production.mjs');
  // The build writes these inside single-quoted literals, so its source spells each backslash twice.
  const literal = value => value.replaceAll('\\', '\\\\');
  for (const anchor of [literal(BACKGROUND_ORIGIN.from), literal(BACKGROUND_ORIGIN.to), literal(BRIDGE_ORIGIN.from), literal(BRIDGE_ORIGIN.to), "['manifest.json', 'browser-adapter.js', 'PROVENANCE.json'].includes(entry) || entry.endsWith('.md')", 'PROTECT_CHROME_ONLY.includes(entry)', 'PROTECT_FIREFOX_STUBS', "var chrome = createFirefoxAdapter(globalThis.browser, ' + JSON.stringify(context) + ');"]) assert.ok(build.includes(anchor), 'build-production.mjs no longer contains: ' + anchor);
});
