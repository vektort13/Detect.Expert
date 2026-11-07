// ADR-073 / CORE-01/02: exercise the delivered MAIN, ISOLATED and background in owned profiles.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';

const root = resolve(import.meta.dirname, '../..');
const browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/clear-reset-' + browser + '-'));
const extension = join(run, 'extension');
cpSync(join(root, 'dist', browser), extension, { recursive: true });
const evidence = { browser, at: new Date().toISOString(), result: 'RUNNING', run, checks: [],
  hashes: Object.fromEntries(['background.js', 'bridge.js', 'hook.early.js', 'hook.main.js'].map(file =>
    [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
if (browser === 'firefox') {
  // Firefox executeScript sandboxes do not replace the already-running collector's API wrapper.
  // Hold exactly its original native Promise at one attested transport boundary in the owned copy.
  const path = join(extension, 'bridge.js'), original = readFileSync(path, 'utf8');
  const anchor = 'return chrome.runtime.sendMessage(batch);';
  assert.equal(original.split(anchor).length, 2, 'one collector transport boundary');
  const replacement = `if (!globalThis.__clearAuditHeld && batch.type === 'sensor-events' && batch.observations.some(row => row.techniqueId === 'DET-001')) {
    globalThis.__clearAuditHeld = true;
    document.documentElement.setAttribute('data-clear-audit-held', '1');
    return new Promise(resolve => document.addEventListener('detect-clear-release-fixture', () => resolve(chrome.runtime.sendMessage(batch)), { once: true }));
  }
  return chrome.runtime.sendMessage(batch);`;
  const instrumented = original.replace(anchor, replacement); writeFileSync(path, instrumented);
  evidence.instrumentation = { file: 'bridge.js', purpose: 'hold one old native send until explicit release', replacements: 1,
    deliveredSha256: evidence.hashes['bridge.js'], instrumentedSha256: createHash('sha256').update(instrumented).digest('hex') };
}
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  response.end('<!doctype html><html><head><title>Owned reset fixture</title></head><body>ready</body></html>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
let opened, tabId;
const check = label => { evidence.checks.push(label); console.log('  ok ' + label); };
const count = (report, techniqueId) => report?.techniques.filter(row => row.techniqueId === techniqueId).reduce((sum, row) => sum + row.count, 0) ?? 0;
const send = message => opened.evaluate(message => (globalThis.browser ?? chrome).runtime.sendMessage(message), message);
const report = async () => { const result = await send({ schemaVersion: 1, type: 'ui-get-report', tabId }); assert.equal(result.type, 'report', JSON.stringify(result)); return result.report; };
const readPixels = n => opened.evaluate(async ({ tabId, n }) => {
  const api = globalThis.browser ?? chrome;
  const results = await api.scripting.executeScript({ target: { tabId }, world: 'MAIN', args: [n], func: n => {
    const ctx = document.createElement('canvas').getContext('2d');
    for (let i = 0; i < n; i++) if (ctx.getImageData(0, 0, 1, 1).data.length !== 4) throw Error('native readback changed');
    return n;
  } }); return results[0].result;
}, { tabId, n });
const exportCanvas = () => opened.evaluate(async tabId => (await (globalThis.browser ?? chrome).scripting.executeScript({ target: { tabId }, world: 'MAIN', func: () => document.createElement('canvas').toDataURL().startsWith('data:image/png') }))[0].result, tabId);
const command = async type => {
  const current = await report(); assert.ok(current, 'control projection available');
  const value = await send({ schemaVersion: 1, type, tabId, documentKey: current.documentKey, reportRevision: current.reportRevision });
  assert.equal(value.type, 'ok', JSON.stringify(value)); return current;
};
try {
  opened = await launchOwnedManagement({ root, run, extension, browser, evidence }); evidence.version = opened.version;
  if (browser === 'firefox') await opened.goto(opened.base + 'options.html#settings');
  assert.equal((await send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true })).accepted, true);
  const scope = await send({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' });
  assert.ok(['ok', 'scope'].includes(scope.type), JSON.stringify(scope));
  await pause(500);
  tabId = await opened.evaluate(async origin => (await (globalThis.browser ?? chrome).tabs.create({ url: origin, active: false })).id, origin);
  await until(() => opened.evaluate(async tabId => (await (globalThis.browser ?? chrome).tabs.get(tabId)).status === 'complete', tabId), 'owned tab loaded');
  await until(async () => Boolean(await report()), 'observed production report');
  assert.equal(await readPixels(100), 100);
  const before = await until(async () => { const value = await report(); return count(value, 'DET-002') === 100 && value; }, '100 native pixel calls');
  if (browser === 'chrome') await opened.evaluate(async tabId => {
    await (globalThis.browser ?? chrome).scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
      // CollectorEnv uses the chrome namespace in both delivered browser builds.
      const api = chrome, original = api.runtime.sendMessage;
      globalThis.__clearHeld = false;
      api.runtime.sendMessage = function (...args) {
        const batch = args[0];
        if (!globalThis.__clearHeld && batch?.type === 'sensor-events' && batch.observations?.some(row => row.techniqueId === 'DET-001')) {
          globalThis.__clearHeld = true;
          return new Promise(resolve => { globalThis.__releaseClearBatch = () => { delete globalThis.__releaseClearBatch; resolve(Reflect.apply(original, api.runtime, args)); }; });
        }
        return Reflect.apply(original, api.runtime, args);
      };
    } });
  }, tabId);
  assert.equal(await exportCanvas(), true);
  await until(() => opened.evaluate(async ({ tabId, firefox }) => (await (globalThis.browser ?? chrome).scripting.executeScript({ target: { tabId }, world: firefox ? 'MAIN' : 'ISOLATED', args: [firefox], func: firefox => firefox ? document.documentElement.getAttribute('data-clear-audit-held') === '1' : globalThis.__clearHeld }))[0].result, { tabId, firefox: browser === 'firefox' }), 'old unseen export held');
  await command('ui-clear');
  const empty = await report(); assert.equal(count(empty, 'DET-002'), 0); assert.equal(count(empty, 'DET-001'), 0);
  assert.equal(await readPixels(1), 1); assert.equal(await exportCanvas(), true);
  await opened.evaluate(async ({ tabId, firefox }) => { await (globalThis.browser ?? chrome).scripting.executeScript({ target: { tabId }, world: firefox ? 'MAIN' : 'ISOLATED', args: [firefox], func: firefox => { if (firefox) document.dispatchEvent(new Event('detect-clear-release-fixture')); else globalThis.__releaseClearBatch?.(); } }); }, { tabId, firefox: browser === 'firefox' });
  const fresh = await until(async () => { const value = await report(); return count(value, 'DET-002') === 1 && count(value, 'DET-001') === 1 && value; }, 'only new calls after old delivery release');
  assert.equal(fresh.documentKey, before.documentKey);
  await pause(600); assert.equal(count(await report(), 'DET-002'), 1); assert.equal(count(await report(), 'DET-001'), 1);
  check('old cumulative and buffered unseen key stay absent; both new calls count1; native results preserved');
  await command('ui-pause'); await command('ui-clear');
  const paused = await report(); assert.ok(paused, 'paused clear retains Resume projection'); assert.equal(paused.coverageState, 'paused');
  assert.equal(count(paused, 'DET-002'), 0);
  await command('ui-resume'); await readPixels(1);
  await until(async () => count(await report(), 'DET-002') === 1, 'resume after paused clear');
  check('paused clear keeps reachable Resume and resumes counting from1');
  if (browser === 'chrome') {
    const ui = opened.context.pages().find(page => page.url().startsWith(opened.base));
    const worker = opened.context.serviceWorkers()[0], cdp = await opened.context.newCDPSession(ui); let versionId;
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => { for (const version of versions) if (version.scriptURL === worker.url() && version.runningStatus === 'running') versionId = version.versionId; });
    try { await cdp.send('ServiceWorker.enable'); await until(() => versionId, 'worker identity'); await cdp.send('ServiceWorker.stopWorker', { versionId }); }
    finally { await cdp.detach(); }
    await readPixels(1);
    await until(async () => count(await report(), 'DET-002') === 2, 'durable clear after worker restart');
    assert.equal(count(await report(), 'DET-001'), 0);
    check('service worker restart preserves cleared history and new epoch counts');
  }
  evidence.result = 'PASS';
} catch (error) { evidence.result = 'FAIL'; evidence.error = error.stack; throw error; }
finally {
  try { if (opened) await opened.close(); }
  finally {
    await new Promise(done => server.close(done));
    const artifacts = join(root, 'test-results/production-1.1.0'); mkdirSync(artifacts, { recursive: true });
    writeFileSync(join(artifacts, 'clear-reset-' + browser + '.json'), JSON.stringify(evidence, null, 2));
  }
}
console.log('PASS clear reset ' + browser + ': ' + evidence.checks.length + ' checks');
