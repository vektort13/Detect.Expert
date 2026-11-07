// ADR-076: actual Firefox resource timing and delivered bridge in an owned HTTPS fixture.
// The fixture is synthetic transport evidence, not a claimed Cloudflare deployment.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:https';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchOwnedManagement, until } from './management-browser-fixture.mjs';
import { readPrecursorSnapshot } from '../../packages/contracts/src/precursor.mjs';

const root = resolve(import.meta.dirname, '../..');
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const input = resolve(argument('--dist') ?? join(root, 'dist/firefox'));
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/precursor-timing-native-')), extension = join(run, 'extension');
cpSync(input, extension, { recursive: true });
const files = ['manifest.json', 'background.js', 'bridge.js', 'precursor-observer.js', 'precursor-timing.js', 'precursor-contracts.js'];
const evidence = { at: new Date().toISOString(), result: 'RUNNING', fixture: 'owned HTTPS synthetic resource transport', rawUrlsPersisted: false, checks: [], states: [],
  hashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
const adapter = readFileSync(join(root, 'apps/production-extension/browser-adapter.js'), 'utf8');
assert.ok(readFileSync(join(extension, 'bridge.js'), 'utf8').startsWith(adapter), 'packaged bridge starts with the exact reviewed Firefox adapter');
assert.ok(readFileSync(join(extension, 'background.js'), 'utf8').startsWith(adapter), 'packaged background starts with the exact reviewed Firefox adapter');
evidence.embeddedAdapterSha256 = createHash('sha256').update(adapter).digest('hex');
const certificate = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
  "$ErrorActionPreference = 'Stop'", '$rsa = [System.Security.Cryptography.RSA]::Create(2048)',
  "$request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=precursor.fixture.example.com', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)",
  '$certificate = $request.CreateSelfSigned([System.DateTimeOffset]::UtcNow.AddDays(-1), [System.DateTimeOffset]::UtcNow.AddDays(1))',
  "[Convert]::ToBase64String($certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, ''))", '$certificate.Dispose()', '$rsa.Dispose()'
].join('\n')], { encoding: 'utf8', windowsHide: true });
assert.equal(certificate.status, 0, 'ephemeral certificate generated');
const resourcePath = '/cdn-cgi/challenge-platform/h/g/scripts/precursor/a012b345c678/main.js';
const server = createServer({ pfx: Buffer.from(certificate.stdout.trim(), 'base64'), passphrase: '' }, (request, response) => {
  const path = new URL(request.url, 'https://fixture.invalid');
  response.setHeader('Cache-Control', 'no-store');
  if (path.pathname.startsWith('/cdn-cgi/')) {
    const kind = path.searchParams.get('kind');
    response.statusCode = kind === 'missing' ? 404 : 200;
    response.setHeader('Content-Type', kind === 'html' ? 'text/html' : 'application/javascript; charset=utf-8');
    response.end(kind === 'html' ? '<!doctype html><title>Not JavaScript</title>' : 'Math.sin(0.25);'); return;
  }
  const kind = ['positive', 'missing', 'html', 'wrong-path', 'empty'].includes(path.pathname.slice(1)) ? path.pathname.slice(1) : 'positive';
  const scriptPath = (kind === 'wrong-path' ? resourcePath.replace('/h/g/', '/h/b/') : resourcePath) + '?kind=' + kind + '&proof=URL_CANARY';
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><meta charset="utf-8"><title>Owned Precursor timing fixture</title><h1>Owned resource timing</h1>' +
    (kind === 'empty' ? '' : '<script src="' + scriptPath + '"></script>') +
    '<button id="load">Load owned script</button><script>setInterval(()=>Math.sin(0.5),100);document.getElementById("load").onclick=()=>{const e=document.createElement("script");e.src=' + JSON.stringify(resourcePath + '?kind=positive&proof=URL_CANARY') + '+"&n="+performance.now();document.head.append(e)};</script>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'https://precursor.fixture.example.com:' + server.address().port;
let opened, phase = 'launch', tabId;
const send = message => opened.evaluate(message => browser.runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const report = async () => (await send({ type: 'ui-get-report', tabId, frameId: 0 }))?.report;
const state = async () => {
  const current = await report(); if (!current) return null;
  const result = await send({ type: 'ui-get-precursor', tabId, frameId: 0, documentKey: current.documentKey });
  const value = readPrecursorSnapshot(result); assert.ok(value, 'delivered strict snapshot'); return value;
};
const log = (label, value) => { evidence.states.push({ label, presence: value.presence, coverageState: value.coverageState, evidenceSource: value.evidenceSource,
  integrity: value.integrity, ruleIds: value.ruleIds, mode: value.mode, capabilities: value.capabilities, truncated: value.truncated }); };
const check = label => { evidence.checks.push(label); console.log('ok ' + label); };
const ready = async expected => until(async () => { const result = await state(); if (result) evidence.lastState = { presence: result.presence, coverageState: result.coverageState, capabilities: result.capabilities }; return result?.presence === expected && result.capabilities.presenceDetection ? result : null; }, expected + ' timing result', 20000);
async function navigate(kind) {
  const previous = await report(); await opened.evaluate(({ tabId, url }) => browser.tabs.update(tabId, { url }), { tabId, url: origin + '/' + kind });
  await until(async () => { const current = await report(); return current && current.documentKey !== previous?.documentKey; }, 'replacement document');
  return previous;
}
async function control(type) {
  const current = await report(); assert.ok(current);
  const result = await send({ type, tabId, documentKey: current.documentKey, reportRevision: current.reportRevision }); assert.equal(result.type, 'ok');
}
try {
  opened = await launchOwnedManagement({ root, run, extension, browser: 'firefox', evidence, loopbackHosts: ['precursor.fixture.example.com'], acceptInsecureCerts: true });
  evidence.version = opened.version;
  await opened.goto(opened.base + 'options.html#settings');
  await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-management-shell]'))), 'Options');
  await opened.click('#options-scope-all-sites'); await opened.click('form.scope:has(#options-scope-all-sites) button[type="submit"]');
  await until(async () => (await send({ type: 'ui-get-scope' })).scope?.scopeMode === 'all-sites', 'scope all sites');
  phase = 'positive'; tabId = await opened.evaluate(async url => (await browser.tabs.create({ url, active: false })).id, origin + '/positive');
  const positive = await ready('observed'); assert.equal(positive.evidenceSource, 'browser-resource-timing'); assert.equal(positive.integrity, 'browser-observed'); assert.equal(positive.coverageState, 'partial'); assert.equal(positive.mode, 'unknown');
  log('positive', positive); check('native Firefox successful JavaScript timing reaches the exact document through delivered production bridge');
  phase = 'negative resource semantics';
  for (const kind of ['missing', 'html', 'wrong-path', 'empty']) {
    const old = await navigate(kind); const negative = await ready('not-observed'); assert.equal(negative.coverageState, 'partial'); log(kind, negative);
    const stale = await send({ type: 'ui-get-precursor', tabId, frameId: 0, documentKey: old.documentKey }); assert.notEqual(stale.presence, 'observed');
  }
  check('404, HTML, unverified path and absent loader never become positives; old document replies remain unavailable');
  phase = 'MAIN spoof rejection';
  await opened.evaluate(async tabId => browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'MAIN', func: () => {
    const fake = { name: location.origin + '/cdn-cgi/challenge-platform/h/g/scripts/precursor/a012b345c678/main.js', startTime: 1, initiatorType: 'script', responseStatus: 200, contentType: 'text/javascript' };
    performance.getEntriesByType = () => [fake];
    window.PerformanceObserver = class { constructor(callback) { this.callback = callback; } observe() { this.callback({ getEntries: () => [fake] }); } takeRecords() { return [fake]; } disconnect() {} };
    window.postMessage({ type: 'precursor-timing-cache', schemaVersion: 1, available: true, ruleIds: ['cf-precursor-versioned-loader-v1'], revision: 1, truncated: false }, '*');
  } }), tabId);
  assert.equal((await ready('not-observed')).presence, 'not-observed'); check('MAIN prototype spoof and forged window messages cannot supply native resource timing');
  phase = 'late load';
  await opened.evaluate(async tabId => browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'MAIN', func: () => document.querySelector('#load').click() }), tabId);
  const loaded = await ready('observed'); log('late owned load', loaded); check('actual later script resource updates the live selected document');
  phase = 'clear'; const beforeClear = await report(); await control('ui-clear');
  const afterClear = await send({ type: 'ui-get-precursor', tabId, frameId: 0, documentKey: beforeClear.documentKey }); assert.notEqual(afterClear.presence, 'observed');
  // ADR-073 deliberately hides an empty cleared report until a new ordinary observation.
  // Exercise a known observed API in our own fixture; never return the produced pixels.
  await opened.evaluate(async tabId => browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'MAIN', func: () => { document.createElement('canvas').toDataURL(); } }), tabId);
  const cleared = await ready('not-observed'); log('clear', cleared);
  await opened.evaluate(async tabId => browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'MAIN', func: () => document.querySelector('#load').click() }), tabId);
  log('post-clear fresh load', await ready('observed')); check('producer reset excludes old buffered entries and admits only newly loaded resources');
  phase = 'pause'; await control('ui-pause'); const paused = await state(); assert.equal(paused.coverageState, 'paused'); assert.equal(paused.presence, 'not-observed'); log('paused', paused);
  await control('ui-resume'); log('resumed', await ready('not-observed')); check('pause and resume create a fresh observation window');
  phase = 'permission scope';
  const previous = await report(); await opened.click('#options-scope-off'); await opened.click('form.scope:has(#options-scope-off) button[type="submit"]');
  await until(async () => (await send({ type: 'ui-get-scope' })).scope?.scopeMode === 'off', 'scope off');
  const denied = await send({ type: 'ui-get-precursor', tabId, frameId: 0, documentKey: previous.documentKey }); assert.notEqual(denied.presence, 'observed');
  check('scope revocation clears cached resource evidence');
  evidence.result = 'PASS';
} catch (error) {
  evidence.result = 'FAIL'; evidence.phase = phase; evidence.error = String(error.message).replace(/https?:\/\/\S+/g, '[url]').slice(0, 300); process.exitCode = 1;
  if (opened && tabId) try { evidence.diagnostic = await opened.evaluate(async tabId => {
    const rows = await browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: () => {
      const entries = performance.getEntriesByType('resource');
      return { bridge: Boolean(Object.getOwnPropertyDescriptor(globalThis, Symbol.for('detect.expert/bridge/v1'))), privateId: typeof globalThis.__detectExpertIsolatedDocumentV1 === 'string',
        count: Math.min(entries.length, 2049), scripts: entries.slice(0, 2048).filter(entry => entry.initiatorType === 'script').map(entry => ({ status: entry.responseStatus, mime: entry.contentType === 'text/javascript' ? 'text-javascript' : entry.contentType === 'application/javascript' ? 'application-javascript' : entry.contentType === '' ? 'empty' : 'other', pattern: /\/scripts\/precursor\/[a-f0-9]{12}\/main\.js/.test(entry.name) })) };
    } }); return rows[0]?.result ?? null;
  }, tabId); } catch {}
} finally {
  if (opened) await opened.close(); await new Promise(done => server.close(done));
  evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'test-results/precursor-modes-2026-10-30/firefox-timing-native.json'), JSON.stringify(evidence, null, 2) + '\n');
}
console.log(JSON.stringify({ result: evidence.result, phase: evidence.phase, error: evidence.error, checks: evidence.checks.length, lastState: evidence.lastState, diagnostic: evidence.diagnostic }));
