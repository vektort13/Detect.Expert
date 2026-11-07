// ADR-049: real userScripts cleanup recovery, with one owned SW API failure and no page-value restore channel.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';

const root = resolve(import.meta.dirname, '../..'), argument = process.argv.indexOf('--dist');
const input = argument < 0 ? join(root, 'dist/chrome') : resolve(process.argv[argument + 1]);
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/api-config-recovery-')), extension = join(run, 'extension');
cpSync(input, extension, { recursive: true });
assert.ok(readFileSync(join(extension, 'api-configuration-controller.js'), 'utf8').includes('recoverRegistration'), 'build the bounded recovery controller first');
const output = join(root, 'test-results/production-1.1.0/api-config-recovery-native.json'); mkdirSync(resolve(output, '..'), { recursive: true });
const chosen = 257, prefix = 'detector-api-custom-profile-v2-', fallback = 'detector-api-custom-fallback-v2-';
const evidence = { at: new Date().toISOString(), input, run, result: 'RUNNING', checks: [], stages: [], hashes: Object.fromEntries(
  ['manifest.json', 'api-configuration-controller.js', 'api-custom-registration.js', 'api-custom-document-runtime.js', 'api-custom-runtime.js'].map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
const server = createServer((request, response) => { request.resume(); response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.setHeader('Cache-Control', 'no-store');
  response.end('<!doctype html><title>Owned Custom recovery fixture</title><script>const saved=Object.getOwnPropertyDescriptor(Navigator.prototype,"hardwareConcurrency").get;window.readOwnedCpu=()=>({direct:navigator.hardwareConcurrency,prototype:Reflect.apply(Object.getOwnPropertyDescriptor(Navigator.prototype,"hardwareConcurrency").get,navigator,[]),saved:Reflect.apply(saved,navigator,[])});window.firstOwnedCpu=readOwnedCpu();</script><h1>Owned Custom recovery fixture</h1>'); });
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
let context, settings, worker, phase = 'startup';
const send = message => settings.evaluate(value => chrome.runtime.sendMessage({ schemaVersion: 1, ...value }), message);
const counts = () => settings.evaluate(async ({ prefix, fallback }) => ({
  user: (await chrome.userScripts.getScripts()).filter(row => row.id.startsWith(prefix)).length,
  opaque: (await chrome.scripting.getRegisteredContentScripts()).filter(row => row.id.startsWith(fallback)).length,
  pending: (await chrome.storage.local.get('protection:pending:v1'))['protection:pending:v1'],
}), { prefix, fallback });
const check = message => { evidence.checks.push(message); console.log('  ok ' + message); };
try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true,
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
  evidence.browser = context.browser().version();
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); const base = new URL('.', worker.url()).href;
  // A script-free extension page: the Options UI would itself read the state after a write and start the
  // bounded read-triggered recovery before this test can inspect the failed state.
  settings = await context.newPage(); await settings.goto(base + 'privacy.html');
  settings = await enableChromeUserScripts(context, settings, new URL(base).host, evidence);
  worker = context.serviceWorkers().find(value => value.url().startsWith(base)) ?? await context.waitForEvent('serviceworker');
  assert.equal((await send({ type: 'ui-data-consent-set', version: 1, accepted: true })).accepted, true);
  assert.equal((await send({ type: 'ui-set-scope', scopeMode: 'all-sites' })).type, 'scope');
  const baselinePage = await context.newPage(); await baselinePage.goto(origin + '/baseline');
  const native = await baselinePage.evaluate(() => firstOwnedCpu); assert.notEqual(native.direct, chosen); await baselinePage.close();

  phase = 'real early Custom activation';
  const initial = await send({ type: 'ui-api-config-get', tabId: null }); assert.equal(initial.earlyAccess, 'ready');
  const configuration = { ...initial.configuration, enabled: true, antidetectEnabled: true, preset: 'custom', sites: [], apis: initial.configuration.apis.map(row => ({ ...row,
    mode: row.id === 'hardware-concurrency' ? 'custom' : 'bypass', selected: row.id === 'hardware-concurrency' ? { kind: 'value', value: chosen } : { kind: 'unset' } })) };
  const enabled = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: initial.revision, configuration });
  assert.equal(enabled.registration, 'ready'); assert.deepEqual(await counts(), { user: 1, opaque: 1, pending: false });
  const protectedPage = await context.newPage(); await protectedPage.goto(origin + '/protected');
  assert.deepEqual(await protectedPage.evaluate(() => firstOwnedCpu), { direct: chosen, prototype: chosen, saved: chosen });
  check('the real native early profile applies Custom before the owned page first inline script');

  phase = 'one owned native unregister failure on OFF';
  await worker.evaluate(prefix => {
    const unregister = chrome.userScripts.unregister.bind(chrome.userScripts);
    const fault = { armed: true, failures: 0, calls: 0 }; globalThis.__ownedRecoveryFault = fault;
    chrome.userScripts.unregister = async request => {
      if (request?.ids?.some(id => id.startsWith(prefix))) {
        fault.calls++;
        if (fault.armed) { fault.armed = false; fault.failures++; throw Error('Owned one-shot unregister rejection'); }
      }
      return unregister(request);
    };
  }, prefix);
  const off = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: enabled.revision, configuration: { ...configuration, enabled: false, antidetectEnabled: false } });
  assert.equal(off.configuration.enabled, false); assert.equal(off.configuration.antidetectEnabled, false); assert.equal(off.registration, 'error');
  const failedCounts = await counts(); assert.deepEqual(failedCounts, { user: 1, opaque: 1, pending: true });
  assert.deepEqual(await worker.evaluate(() => globalThis.__ownedRecoveryFault), { armed: false, failures: 1, calls: 1 });
  assert.deepEqual(await protectedPage.evaluate(() => readOwnedCpu()), { direct: chosen, prototype: chosen, saved: chosen });
  evidence.stages.push({ stage: 'OFF saved, application failed', enabled: false, registration: off.registration, ...failedCounts });
  check('one real unregister rejection leaves explicit pending/error and old native registrations without restoring the open document');

  phase = 'bounded trusted read recovery';
  const recovered = await send({ type: 'ui-api-config-get', tabId: null });
  assert.equal(recovered.configuration.enabled, false); assert.equal(recovered.registration, 'inactive');
  assert.equal(recovered.revision, off.revision); assert.deepEqual(recovered.configuration, off.configuration);
  assert.deepEqual(await counts(), { user: 0, opaque: 0, pending: false });
  const attempts = await worker.evaluate(() => globalThis.__ownedRecoveryFault.calls); assert.equal(attempts, 2);
  for (let count = 0; count < 3; count++) await send({ type: 'ui-api-config-get', tabId: null });
  assert.equal(await worker.evaluate(() => globalThis.__ownedRecoveryFault.calls), attempts);
  assert.deepEqual(await protectedPage.evaluate(() => readOwnedCpu()), { direct: chosen, prototype: chosen, saved: chosen });
  evidence.stages.push({ stage: 'trusted read recovered', enabled: false, registration: recovered.registration, ...await counts() });
  check('one trusted read removes the actual userScripts and opaque registrations, clears pending once and preserves configuration/revision');

  phase = 'forged page messages and fresh native document';
  await protectedPage.evaluate(() => {
    for (const channel of ['detect.expert/api-custom/v1', 'detect.expert/api-custom/v2']) {
      window.postMessage({ channel, type: 'stop' }, '*');
      window.postMessage({ channel, type: 'apply', revision: Number.MAX_SAFE_INTEGER, entries: [] }, '*');
    }
    const oldHandle = Object.getOwnPropertyDescriptor(window, Symbol.for('detect.expert/api-custom/installation/v1'))?.value;
    if (typeof oldHandle?.stop === 'function') oldHandle.stop();
  });
  await protectedPage.waitForTimeout(50);
  assert.deepEqual(await protectedPage.evaluate(() => readOwnedCpu()), { direct: chosen, prototype: chosen, saved: chosen });
  assert.deepEqual((await send({ type: 'ui-api-config-get', tabId: null })).configuration, recovered.configuration);
  const fresh = await context.newPage(); await fresh.goto(origin + '/fresh-after-off');
  assert.deepEqual(await fresh.evaluate(() => firstOwnedCpu), native);
  evidence.freshNativeMatchesBaseline = true;
  check('forged page stop/apply messages cannot restore native in the old document; only a fresh OFF document uses its native API');
  evidence.result = 'PASS'; console.log('PASS API configuration recovery native: ' + evidence.checks.length + ' checks');
} catch (error) { evidence.result = 'FAIL'; evidence.failure = { phase, error: String(error.stack ?? error) }; process.exitCode = 1; console.error('FAIL API configuration recovery: ' + phase + ': ' + error.message); }
finally { writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n'); await context?.close(); await new Promise(done => server.close(done)); }
