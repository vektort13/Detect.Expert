import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { build } from 'esbuild';
import { checkRegex, validAlternatives } from '../catalog-checks.mjs';
import { auditInputs, CODE_EXTENSIONS, isTestPath, isDataPath, scanCode } from '../code-checks.mjs';
import { validateManifest } from '../release-checks.mjs';
import { committedReport, perfRunErrors, positiveCounts, storedReports, waitForEvidence } from '../measurement-checks.mjs';
import { extensionEgress, installWireCapture, exportErrors, exportIdentityErrors, timestampAllowed, boundedConsoleValue, deferredExtensionEvents } from '../privacy-observers.mjs';
import { Hits, scanNode } from '../privacy-checks.mjs';

const regexErrors = (source) => { const errors = []; checkRegex(source, 'test.pathRegex', (error) => errors.push(error)); return errors; };
for (const source of ['^/never|.{0,256}$', '^/tags\\$', '^/tags[$]', '^/(?:a|aa){1,60}b$', '^/(?:a?){1,60}b$', '^/(?:a{1,2}){1,60}$', '^/a+$', '^/a*$','^/a{1,}$']) {
  test('F065/F066 rejects unsafe regex ' + source, () => assert.ok(regexErrors(source).length));
}
for (const source of ['^/(?:tags|scripts)\\.js$', '^/tags\\$$', '^/[|$]{1,4}$', '^/tags\\\\$']) {
  test('F065 accepts grouped alternatives and escaped literals ' + source, () => assert.deepEqual(regexErrors(source), []));
}
test('F066 rejected adversarial corpus terminates in a subprocess', () => {
  // Never test an unsafe regex in the parent process, even in regression tests.
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { checkRegex } from './scripts/catalog-checks.mjs';
    const source = '^/(?:a|aa){1,60}b$'; const errors = [];
    checkRegex(source, 'adversarial', (e) => errors.push(e));
    if (!errors.length) new RegExp(source).test('/' + 'a'.repeat(58) + 'c');
    process.exit(errors.length ? 0 : 1);
  `], { timeout: 2000 });
  assert.equal(result.status, 0, result.error?.message);
});
for (const value of [[], 'host', [1], [''], Array(17).fill('host')]) {
  test('F068 rejects invalid alternatives ' + JSON.stringify(value), () => assert.equal(validAlternatives(value), false));
}
test('F068 permits bounded typed alternatives', () => assert.equal(validAlternatives(['one', 'two']), true));

const manifest = JSON.parse(readFileSync(new URL('../../dist/local/manifest.json', import.meta.url), 'utf8'));
const allow = JSON.parse(readFileSync(new URL('../../apps/extension/permissions.allowlist.json', import.meta.url), 'utf8'));
test('F074 approved manifest passes unchanged', () => assert.deepEqual(validateManifest(manifest, allow), []));
for (const mutation of [{ optional_permissions: ['cookies', 'tabs'] }, { optional_permissions: [] }, { chrome_url_overrides: { newtab: 'popup.html' } }, { future_key: {} }]) {
  test('F074 rejects unapproved manifest fields ' + Object.keys(mutation)[0], () => assert.ok(validateManifest({ ...manifest, ...mutation }, allow).length));
}
for (const source of [
  "fetch('https://' + host)", 'const f = fetch; f(url)', "globalThis['fetch'](url)", "globalThis['f\\u0065tch'](url)",
  '(0, eval)(code)', 'Function(code)()', 'const F = Function; F(code)', 'new Function(code)',
  "chrome.storage['sync'].set(data)", "const { sync } = chrome.storage; sync.set(data)",
  'new XMLHttpRequest()', 'new WebSocket(url)', 'new EventSource(url)', 'new WebTransport(url)', 'new RTCPeerConnection()',
  'const beacon = navigator.sendBeacon.bind(navigator); beacon(url, data)', "navigator['sendBeacon'](url)", 'new Image().src = url',
  'importScripts(url)', 'import(url)', 'node.setHTMLUnsafe(markup)', 'range.createContextualFragment(markup)',
  'node.src = url', "node['src'] = url", "node.setAttribute('src', url)", "document.createElement('link')",
]) {
  test('F075/F155 rejects forbidden API reference: ' + source, () => assert.ok(scanCode(source, 'input.js').length));
}
test('F155 permits passive Function prototype intrinsics and ignores text/comments', () => {
  assert.deepEqual(scanCode('const apply = Function.prototype.call.bind(Object.prototype.hasOwnProperty); const note = "fetch Function"; // eval(code)', 'input.js'), []);
});

test('F155 regex tokenization terminates and continues auditing subsequent code', () => {
  const fixture = String.raw`const bad = /[?#@\s\\]/; fetch(url);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { scanCode } from './scripts/code-checks.mjs';
    const hits = scanCode(${JSON.stringify(fixture)}, 'regex.js');
    process.exit(hits.includes('network-reference: fetch') ? 0 : 1);
  `], { timeout: 5000 });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr.toString());
});
for (const ext of ['.mts', '.cts', '.jsx']) {
  test('F154 scans ' + ext, () => { assert.ok(CODE_EXTENSIONS.has(ext)); assert.ok(scanCode('fetch(url)', 'input' + ext).length); });
}
test('F154 exemptions are canonical roots only, and cannot enter production bundles', () => {
  assert.equal(isTestPath('packages/sensors/src/fixtures/relay.ts'), false);
  assert.equal(isTestPath('packages/sensors/src/relay.test.ts'), false);
  assert.equal(isDataPath('packages/sensors/src/docs/relay.ts'), false);
  assert.equal(isTestPath('packages/sensors/test/relay.ts'), true);
  assert.ok(auditInputs({ 'packages/sensors/test/relay.ts': {} }, 'main').length);
  assert.ok(auditInputs({ 'node_modules/third-party/index.js': {} }, 'main').length);
  assert.ok(auditInputs({ 'node_modules/third-party/index.js': {} }, 'isolated').length);
  assert.ok(auditInputs({ 'node_modules/third-party/index.js': {} }, 'sw').length);
  assert.deepEqual(auditInputs({ 'node_modules/preact/index.js': {} }, 'ui'), []);
});

const entries = ['DET-001', 'DET-002', 'DET-003'].map((techniqueId) => ({ techniqueId, count: 1 }));
const timings = { measureTextMs: 20, getImageDataMs: 10, totalMs: 30, measureTextCalls: 1_000_000, getImageDataCalls: 10_000 };
const perfRun = { mode: 'with', cold: timings, warm: timings, observation: { enabled: true }, observed: { counts: { 'DET-002': 1, 'DET-003': 1 } } };
test('F069 valid active run passes and high overhead is not an invented ADR threshold', () => assert.deepEqual(perfRunErrors({ ...perfRun, warm: { ...timings, measureTextMs: 2000, getImageDataMs: 1000, totalMs: 3000 } }), []));
test('F077 rejects the obsolete 100k workload', () => assert.ok(perfRunErrors({ ...perfRun, warm: { ...timings, measureTextCalls: 100_000 } }).length));
for (const mutation of [{ observation: { enabled: false } }, { observed: null }, { observed: { counts: { 'DET-001': 10 } } }, { observed: { counts: { 'DET-002': 1, 'DET-003': 0 } } }]) {
  test('F069 rejects inactive/missing sensors ' + JSON.stringify(mutation), () => assert.ok(perfRunErrors({ ...perfRun, ...mutation }).length));
}
for (const timing of [0, -1, NaN, Infinity, undefined]) {
  test('F069 rejects invalid timing ' + String(timing), () => assert.ok(perfRunErrors({ ...perfRun, warm: { ...timings, totalMs: timing } }).length));
}
test('F072 navigation-only reports and uncommitted sensors are not evidence', () => {
  const report = { schemaVersion: 1, documentKey: 'one', counters: [], watermark: null };
  assert.equal(committedReport(report), false);
  assert.equal(committedReport({ ...report, counters: entries }), false);
  assert.equal(committedReport({ ...report, counters: entries, watermark: { lastCommittedBatchSeq: 1 } }), true);
  assert.equal(storedReports({ doc: { report } }).filter((r) => committedReport(r)).length, 0);
  assert.equal(positiveCounts([{ techniqueId: 'DET-002', count: 0 }], ['DET-002']), false);
});
test('F069/F072 waits for delayed evidence, and missing evidence fails within a bound', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  // Keep the actual 100/5ms deadlines; advance logical time independently of host load.
  const advance = async () => {
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    t.mock.timers.tick(1);
  };
  let attempts = 0;
  const delayed = waitForEvidence(() => ++attempts, (n) => n === 2, { interval: 1, timeout: 100 });
  for (let step = 0; step < 10 && attempts < 2; step++) await advance();
  assert.equal(await delayed, 2);
  assert.equal(attempts, 2);
  const missingStarted = Date.now();
  const missing = assert.rejects(waitForEvidence(() => null, Boolean, { interval: 1, timeout: 5 }), /evidence missing/);
  for (let step = 0; step < 5; step++) await advance();
  await missing;
  assert.equal(Date.now() - missingStarted, 5);
  const hung = assert.rejects(waitForEvidence(() => new Promise(() => {}), Boolean, { timeout: 5 }), /evidence missing/);
  t.mock.timers.tick(5);
  await hung;
  await assert.rejects(waitForEvidence(() => Promise.reject(new Error('read failed')), Boolean), /read failed/);
});
test('F072 missing/error export previews fail', () => {
  for (const response of [null, { type: 'error' }, { type: 'export-preview', preview: {} }]) assert.ok(exportErrors(response).length);
  assert.deepEqual(exportErrors({ type: 'export-preview', preview: { redacted: true, report: {} } }), []);
});

function request(url, frameUrl = '', workerUrl = '') {
  return { url: () => url, frame: () => { if (workerUrl) throw new Error('no frame'); return { url: () => frameUrl }; }, serviceWorker: () => workerUrl ? { url: () => workerUrl } : null };
}
test('F070/F071 exact extension attribution detects UI/SW computed egress, excluding fixture and other extensions', () => {
  assert.equal(extensionEgress(request('https://remote.invalid/x', 'chrome-extension://ours/popup.html'), 'ours'), true);
  assert.equal(extensionEgress(request('https://remote.invalid/x', '', 'chrome-extension://ours/background.js'), 'ours'), true);
  assert.equal(extensionEgress(request('https://remote.invalid/x', 'chrome-extension://ours-other/popup.html'), 'ours'), false);
  assert.equal(extensionEgress(request('https://remote.invalid/x', 'http://127.0.0.1/'), 'ours'), false);
  assert.equal(extensionEgress(request('chrome-extension://ours/ui.css', 'chrome-extension://ours/popup.html'), 'ours'), false);
});
test('F070/F071 startup events are attributed after installation without losing early violations', () => {
  const seen = [];
  let overflow = false;
  const events = deferredExtensionEvents((event) => seen.push(event), () => { overflow = true; });
  const id = 'a'.repeat(32);
  events.push('chrome-extension://' + id + '/background.js', 'early-violation');
  events.push('chrome-extension://' + 'b'.repeat(32) + '/background.js', 'other-extension');
  assert.deepEqual(seen, []);
  events.setId(id);
  events.push('chrome-extension://' + id + '/popup.html', 'later-violation');
  assert.deepEqual(seen, ['early-violation', 'later-violation']);
  assert.equal(overflow, false);
  const flood = deferredExtensionEvents(() => {}, () => { overflow = true; });
  for (let i = 0; i < 2049; i++) flood.push('unknown', i);
  assert.equal(overflow, true);
  assert.throws(() => flood.setId(''), /identity/);
});
function wireRealm(globals = {}) {
  let listener;
  const window = { addEventListener: (_event, fn) => { listener = fn; } };
  vm.runInNewContext('(' + installWireCapture.toString() + ')()', { window, ...globals });
  return { capture: window.__privacyWire, send: (data) => listener({ source: window, data }) };
}
test('F071 observes canary on sensor wire before storage validation can strip it', () => {
  const realm = wireRealm();
  realm.send({ channel: 'detect.expert/v1', type: 'sensor-batch', observations: entries, secret: 'WIRE-CANARY' });
  const hits = new Hits();
  scanNode(hits, 'wire', realm.capture.messages, [{ id: 'wire', value: 'WIRE-CANARY' }]);
  assert.ok(hits.items.some((hit) => hit.rule === 'canary:wire'));
});
test('F071 bounds cyclic, oversized and flooded bridge captures with explicit failure', () => {
  for (const mode of ['cycle', 'oversize', 'flood']) {
    const realm = wireRealm();
    const data = { channel: 'detect.expert/v1', type: 'sensor-batch' };
    if (mode === 'cycle') data.self = data;
    if (mode === 'oversize') data.secret = 'x'.repeat(16_385);
    for (let i = 0; i < (mode === 'flood' ? 2049 : 1); i++) realm.send(data);
    assert.equal(realm.capture.overflow, true);
    assert.ok(realm.capture.messages.length <= 2048);
  }
});
test('F070 console payload scanner detects forbidden values in object arguments', () => {
  const hits = new Hits(); scanNode(hits, 'console-args', [{ nested: 'SECRET-CANARY' }], [{ id: 'console', value: 'SECRET-CANARY' }]); assert.ok(hits.count);
});
test('F070 console payload capture bounds cyclic and oversized values', () => {
  const cycle = {}; cycle.self = cycle;
  assert.equal(boundedConsoleValue(cycle).overflow, true);
  assert.equal(boundedConsoleValue('x'.repeat(16_385)).overflow, true);
  assert.equal(boundedConsoleValue({ value: 'ordinary' }).overflow, false);
  assert.equal(boundedConsoleValue({ ['x'.repeat(16_385)]: null }).overflow, true);
});
test('F071 bounds aggregate wire strings and keys before serialization', () => {
  for (const payload of [{ chunks: Array(100).fill('x'.repeat(512)) }, { ['x'.repeat(16_385)]: null }]) {
    let serialized = false;
    const realm = wireRealm({ JSON: { stringify: () => { serialized = true; throw new Error('must reject before serialization'); } } });
    realm.send({ channel: 'detect.expert/v1', ...payload });
    assert.equal(serialized, false);
    assert.equal(realm.capture.overflow, true);
    assert.equal(realm.capture.messages.length, 0);
  }
});
test('F181 host/IP and precise epoch leaks fail; rounded session retention times pass', () => {
  const hits = new Hits();
  scanNode(hits, 'storage.session', { host: 'randomlabel.localhost', privateHost: '192.168.77.213', eventAt: 1789225552196 }, [{ id: 'host', value: 'randomlabel' }]);
  for (const rule of ['canary:host', 'ipv4-literal', 'unapproved-epoch-time']) assert.ok(hits.items.some((hit) => hit.rule === rule));
  assert.equal(timestampAllowed('storage.session.doc.report.createdAt', 1789225552000), true);
  assert.equal(timestampAllowed('storage.session.doc.report.createdAt', 1789225552196), false);
  assert.equal(timestampAllowed('storage.session.index.savedAt', 1789225552000), true);
  assert.equal(timestampAllowed('scope-off.storage.session.doc.report.createdAt', 1789225552000), true);
  assert.equal(timestampAllowed('scope-off.storage.session.index.savedAt', 1789225552000), true);
  assert.equal(timestampAllowed('scope-off.storage.session.doc.report.createdAt', 1789225552196), false);
  assert.equal(timestampAllowed('scope-off.storage.session.doc.report.secretAt', 1789225552000), false);
  assert.equal(timestampAllowed('scope-off.storage.local.createdAt', 1789225552000), false);
  assert.equal(timestampAllowed('export.createdAt', 1789225552000), false);
  assert.ok(exportIdentityErrors({ report: { documentKey: '1:0:internal' } }).length);
  assert.deepEqual(exportIdentityErrors({ documentNumber: 1, report: { observedSince: 0 } }), []);
});

test('F181 fake browser events exercise host redaction without private-network traffic', async () => {
  const result = await build({ entryPoints: ['packages/background/src/network.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
  const { createNetworkListener } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  const events = [];
  let accessChecks = 0;
  const listener = createNetworkListener({ scope: { hasAnyHostAccess: () => { accessChecks++; return true; } }, dispatch: (event) => events.push(event), now: () => 1789225552000 });
  for (const host of ['canary-a73f901cd829.localhost', '192.168.77.213', '[fd00::1234]']) {
    listener({ url: 'http://' + host + '/fixture', type: 'xmlhttprequest', tabId: 1, frameId: 0, documentId: 'fixture' });
  }
  assert.equal(accessChecks, 3, 'each fake event must reach the actual network observer');
  assert.deepEqual(events, [], 'unapproved hosts must not leave the observer');
});
