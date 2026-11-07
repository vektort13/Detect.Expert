// E22-21: delivered Options + owned HTTP parent/child documents, no user profiles.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { API_OBSERVED_DELIVERY_FILES, expectedDelivered } from './api-observed-delivery.mjs';

const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/api-observed-usage-')), extension = join(run, 'extension');
cpSync(join(root, 'dist', browser), extension, { recursive: true });
const files = API_OBSERVED_DELIVERY_FILES;
const evidence = { browser, run, result: 'RUNNING', at: new Date().toISOString(), ownedLoopbackOnly: true, rawValuesPersisted: false, checks: [],
  hashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
evidence.sourceHashes = Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(root, 'apps/production-extension', file))).digest('hex')]));
for (const file of files) {
  const expected = expectedDelivered(join(root, 'apps/production-extension'), file, browser);
  assert.ok(readFileSync(join(extension, file)).equals(expected), 'stale or unexpectedly transformed delivered asset: ' + file);
}
evidence.sourceDistMatch = true;
const hosts = ['source.example.com', 'frame.example.net'];
let port;
const server = createServer((request, response) => {
  request.resume(); response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (request.url.startsWith('/frame')) response.end('<!doctype html><script>const probe=()=>WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0]));probe();setTimeout(probe,300);setTimeout(probe,800);globalThis.ownedReady=true;</script>Owned child');
  else if (request.url.startsWith('/empty')) response.end('<!doctype html>Owned empty page');
  else response.end('<!doctype html><script>const c=document.createElement("canvas");c.width=8;c.height=8;c.getContext("2d").getImageData(0,0,1,1);globalThis.ownedReady=true;try{const pc=new RTCPeerConnection();pc.close();}catch{}</script><iframe src="http://' + hosts[1] + ':' + port + '/frame"></iframe>Owned source');
});
await new Promise(done => server.listen(0, '127.0.0.1', done)); port = server.address().port;
const origin = 'http://' + hosts[0] + ':' + port;
let opened, sourceTabId, phase = 'startup';
const check = message => { evidence.checks.push(message); console.log('  ok ' + message); };
const evaluate = (fn, value) => opened.evaluate(fn, value);
const send = message => evaluate(message => (globalThis.browser ?? globalThis.chrome).runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const source = action => evaluate(async ({ tabId, action }) => {
  const api = globalThis.browser ?? globalThis.chrome;
  if (action.url) await api.tabs.update(tabId, { url: action.url });
  if (action.removeFrames) await api.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: () => { for (const frame of document.querySelectorAll('iframe')) frame.remove(); } });
}, { tabId: sourceTabId, action });
const ready = () => until(() => evaluate(() => document.querySelector('[data-management-panel="api"] [data-api-configuration-editor]')?.getAttribute('aria-busy') === 'false'), 'API editor ready');
const select = (selector, value) => evaluate(({ selector, value }) => { const input = document.querySelector(selector); assertField(input); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); function assertField(input) { if (!input) throw Error('Missing fixture field'); } }, { selector, value });
async function hasBadge(id, panel = 'api') {
  return evaluate(({ id, panel }) => Boolean(document.querySelector('[data-management-panel="' + panel + '"] [data-api-observed-badge="' + id + '"]')), { id, panel });
}
try {
  opened = await launchOwnedManagement({ root, run, extension, browser, evidence, loopbackHosts: hosts, dark: browser === 'firefox' }); evidence.version = opened.version;
  await opened.goto(opened.base + 'options.html#settings');
  await until(() => evaluate(() => Boolean(document.querySelector('[data-management-shell]'))), 'management shell');
  await send({ type: 'ui-data-consent-set', version: 1, accepted: true }); await send({ type: 'ui-set-scope', scopeMode: 'all-sites' });
  sourceTabId = await evaluate(async url => (await (globalThis.browser ?? globalThis.chrome).tabs.create({ url, active: false })).id, origin + '/parent');
  await opened.goto(opened.base + 'options.html?tabId=' + sourceTabId + '#api'); await ready();
  phase = 'parent and cross-site frame observations';
  await until(() => hasBadge('canvas-readback'), 'source Canvas observation', 30000);
  await until(() => hasBadge('webassembly'), 'child WebAssembly observation', 30000);
  const observed = await evaluate(() => {
    const panel = document.querySelector('[data-management-panel="api"]');
    return { source: panel.querySelector('[data-api-observed-context]')?.textContent,
      crossSite: Boolean(panel.querySelector('[data-api-observed-badge="webassembly"] [data-api-observed-party="third_party"]')),
      falseFingerprint: Boolean(panel.querySelector('[data-api-observed-fingerprint="canvas-readback"]')) };
  });
  assert.equal(observed.crossSite, true); assert.equal(observed.falseFingerprint, false); assert.ok(observed.source.includes('example.com'));
  const before = await send({ type: 'ui-api-config-get', tabId: null }); assert.equal(before.configuration.enabled, false);
  await opened.screenshot(join(run, 'observed-api.png'));
  check('native Canvas in the source document and WebAssembly in a real cross-site frame are highlighted with API Guard master OFF; a Canvas call alone is not a fingerprint verdict');

  phase = 'used-only filter and drafts';
  await select('[data-protection-preset-select]', 'strict');
  await opened.click('[data-management-panel="api"] [data-api-observed-filter]');
  const onlyUsed = await evaluate(() => { const rows = [...document.querySelectorAll('[data-management-panel="api"] [data-protection-feature]')]; return rows.length > 0 && rows.every(row => row.hasAttribute('data-api-observed')); });
  assert.equal(onlyUsed, true); assert.equal((await send({ type: 'ui-api-config-get', tabId: null })).revision, before.revision);
  check('used-only filtering is a view action and changes no persisted API setting');

  phase = 'child removal'; await source({ removeFrames: true });
  await until(async () => !(await hasBadge('webassembly')), 'removed child observation cleared'); assert.equal(await hasBadge('canvas-readback'), true);
  check('removing the observed child removes its API highlight while the current parent observation remains');

  phase = 'navigation reset'; await source({ url: origin + '/empty' });
  await until(async () => !(await hasBadge('canvas-readback')) && !(await hasBadge('webassembly')), 'new empty document has no old highlights');
  assert.equal(await evaluate(() => document.querySelector('[data-protection-preset-select]').value), 'strict');
  assert.equal((await send({ type: 'ui-api-config-get', tabId: null })).revision, before.revision);
  await opened.click('[data-management-panel="api"] [data-api-observed-filter]'); await select('[data-protection-preset-select]', before.configuration.preset);
  check('top-document navigation clears old highlights and retains the unsaved editor draft without writes');

  phase = 'Antidetect shows no page observation'; await source({ url: origin + '/parent' });
  await until(() => hasBadge('canvas-readback'), 'source observation after navigation');
  await opened.click('[data-management-tab="antidetect"]');
  await until(() => evaluate(() => document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy') === 'false'), 'Antidetect ready');
  for (const category of ['quick', 'device', 'os', 'browser', 'network']) {
    await opened.click('[data-antidetect-category="' + category + '"]');
    assert.equal(await evaluate(() => Boolean(document.querySelector('[data-management-panel="antidetect"] [data-api-observed-context], [data-management-panel="antidetect"] [data-api-observed-badge], [data-management-panel="antidetect"] [data-api-observed]'))), false, 'ADR-104: ' + category + ' has no page-observation UI');
  }
  assert.equal((await send({ type: 'ui-api-config-get', tabId: null })).revision, before.revision);
  await opened.screenshot(join(run, 'observed-antidetect-removed.png'));
  check('Antidetect shows no page observation on any level while API Guard keeps its own live source; no setting is reset or saved');

  phase = 'scope cancellation'; await opened.click('[data-management-tab="api"]'); await ready();
  await until(() => hasBadge('canvas-readback'), 'API observation before scope OFF');
  await send({ type: 'ui-set-scope', scopeMode: 'off' });
  await until(async () => !(await hasBadge('canvas-readback')), 'scope OFF clears observations');
  check('stopping observation clears the live highlights instead of leaving stale positive badges');

  phase = 'localization and layout';
  await send({ type: 'ui-set-scope', scopeMode: 'all-sites' }); await source({ url: origin + '/parent?layout' });
  await until(() => hasBadge('canvas-readback'), 'active observation in localized layouts');
  for (const language of PRODUCTION_LANGUAGES) {
    await evaluate(async language => { await (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-language-v1': language }); }, language.id); await pause(40);
    assert.equal(await evaluate(() => /api_observed_[a-z_]+/.test(document.querySelector('[data-management-panel="api"]').textContent)), false);
  }
  await evaluate(async () => { await (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-language-v1': 'ar' }); }); await opened.media({ colorScheme: 'dark' });
  for (const width of [1180, 520, 340]) { await opened.viewport(width, 900); await pause(60); assert.equal(await evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.dir === 'rtl'), true); }
  await opened.screenshot(join(run, 'observed-ar-narrow.png'));
  await evaluate(() => document.querySelector('[data-management-panel="api"] [data-api-observed-badge="canvas-readback"]').scrollIntoView({ block: 'center' }));
  await opened.screenshot(join(run, 'observed-ar-badge.png'));
  check('all 21 locale labels resolve and the shared panel fits dark Arabic RTL at 1180/520/340px');

  phase = 'closed source'; await evaluate(async tabId => { await (globalThis.browser ?? globalThis.chrome).tabs.remove(tabId); }, sourceTabId); sourceTabId = null;
  await until(() => evaluate(() => document.querySelector('[data-management-panel="api"] [data-api-observed-context]')?.getAttribute('data-api-observed-status') === 'no-site'), 'source closed');
  check('closing the explicit source tab clears context and never silently adopts an unrelated tab');
  evidence.result = 'PASS';
} catch (error) {
  evidence.result = 'FAIL'; evidence.phase = phase; evidence.error = String(error.message).slice(0, 400);
  if (opened) {
    try { await opened.screenshot(join(run, 'failure.png')); } catch {}
    if (sourceTabId !== undefined && sourceTabId !== null) try {
      evidence.metadataDiagnostic = await evaluate(async tabId => {
        const api = globalThis.browser ?? globalThis.chrome, frames = await api.webNavigation.getAllFrames({ tabId });
        return Promise.all(frames.slice(0,32).map(async frame => {
          const reply = await api.runtime.sendMessage({ schemaVersion:1,type:'ui-get-report',tabId,frameId:frame.frameId });
          const report = reply?.type === 'report' ? reply.report : null;
          return { frameId:frame.frameId,errorOccurred:frame.errorOccurred === true, host: report?.host ?? null,
            status:report?.coverageState ?? reply?.code ?? 'missing', flags:report?.coverageFlags ?? [],
            techniques:(report?.techniques??[]).slice(0,128).map(row=>row.techniqueId), operations:(report?.apiOperations??[]).slice(0,128).map(row=>row.apiOperation) };
        }));
      }, sourceTabId);
    } catch {}
  }
  throw error;
}
finally {
  if (opened) { if (sourceTabId !== undefined && sourceTabId !== null) try { await evaluate(async tabId => { await (globalThis.browser ?? globalThis.chrome).tabs.remove(tabId); }, sourceTabId); } catch {} await opened.close(); }
  await new Promise(done => server.close(done)); const output = join(root, 'test-results/production-1.1.0/api-observed/usage-' + browser + '.json'); mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
}
console.log('Observed API usage ' + browser + ': ' + evidence.checks.length + ' checks PASS');
