// ADR-041: fresh native Chrome profile; no extension UI or enabling command before capture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..'), extension = join(root, 'dist/chrome');
const run = join(root, '.tmp/automatic-observation-' + Date.now());
mkdirSync(run, { recursive: true });
const evidence = { at: new Date().toISOString(), checks: [], errors: [], packagedHashes: Object.fromEntries(
  ['background.js', 'popup.js', 'sidepanel.js', 'options.js', 'report.js', 'manifest.json'].map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  response.end('<!doctype html><html><title>Automatic observation fixture</title><body><h1>Automatic observation</h1><script>setTimeout(()=>{window.readWidth=innerWidth;window.canvasResult=document.createElement("canvas").toDataURL();window.fixtureDone=true;},600);</script></body></html>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const host = 'auto-observation.example.com';
const origin = 'http://' + host + ':' + server.address().port;
let context;
const launch = async () => {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true,
    viewport: { width: 620, height: 900 }, args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension,
      '--no-proxy-server', '--host-resolver-rules=MAP auto-observation.example.com 127.0.0.1'] });
  context.on('page', page => page.on('pageerror', error => evidence.errors.push(error.message)));
  return context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
};
const sleep = ms => new Promise(done => setTimeout(done, ms));
try {
  let worker = await launch(); evidence.browser = context.browser().version();
  const id = new URL(worker.url()).host, extensionUrl = 'chrome-extension://' + id + '/';
  // Read-only worker polling does not alter grants/settings and opens no UI.
  for (let i = 0; i < 80; i++) {
    if ((await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length === 2) break;
    await sleep(100);
  }
  assert.equal((await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length, 2);
  let page = await context.newPage(); await page.goto(origin); await page.waitForFunction(() => window.fixtureDone);
  assert.match(await page.evaluate(() => window.canvasResult), /^data:image\//);
  await sleep(1000);
  let ui = await context.newPage(); await ui.goto(extensionUrl + 'popup.html');
  const send = message => ui.evaluate(value => chrome.runtime.sendMessage(value), message);
  const tab = await ui.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(item => item.url === url)), origin + '/');
  let report;
  for (let i = 0; i < 60; i++) {
    report = await send({ schemaVersion: 1, type: 'ui-get-report', tabId: tab.id });
    if (report.report?.techniques?.some(item => item.count > 0)) break;
    await sleep(150);
  }
  assert.ok(report.report?.techniques.some(item => item.count > 0), 'API calls before first UI opening are recorded');
  evidence.initialReport = report;
  assert.equal((await send({ schemaVersion: 1, type: 'ui-data-consent-get' })).accepted, true);
  assert.equal(await ui.locator('[data-action="accept-data-consent"]').count(), 0);
  assert.equal(await ui.locator('[data-observation-control]').count(), 0);
  assert.equal((await send({ schemaVersion: 1, type: 'ui-pro-get', tabId: tab.id })).session, null);
  assert.equal((await send({ schemaVersion: 1, type: 'ui-protection-get', tabId: tab.id })).settings.enabled, false);
  assert.equal(await ui.evaluate(() => chrome.permissions.contains({ permissions: ['cookies'] })), false);
  const dbsc = await send({ schemaVersion: 1, type: 'ui-dbsc-state', tabId: tab.id, frameId: 0, documentKey: report.report.documentKey });
  assert.equal(dbsc.type, 'error'); assert.equal((await worker.evaluate(() => chrome.runtime.getManifest())).permissions.includes('debugger'), false);
  evidence.checks.push('capture before first UI opening', 'no disclosure gate', 'Canvas result preserved', 'Pro off', 'API blocking off', 'DBSC route removed; no debugger permission', 'cookies permission not requested');
  await ui.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), tab.id); await ui.reload();
  await ui.locator('[data-identification-tab="active"]').waitFor();
  await ui.screenshot({ path: join(run, 'fresh-popup.png'), fullPage: true });

  const master = ui.locator('[data-observation-master]');
  await ui.locator('[data-observation-master][aria-checked="true"]:not(:disabled)').waitFor();
  const recording = await send({ schemaVersion: 1, type: 'ui-pro-start', tabId: tab.id });
  assert.equal(recording.session.status, 'recording');
  await master.click(); await ui.locator('[data-observation-master][aria-checked="false"]:not(:disabled)').waitFor();
  assert.equal((await send({ schemaVersion: 1, type: 'ui-get-scope' })).scope.scopeMode, 'off');
  assert.equal((await ui.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length, 0);
  const paused = await send({ schemaVersion: 1, type: 'ui-pro-get', tabId: tab.id });
  assert.equal(paused.session.id, recording.session.id); assert.notEqual(paused.session.status, 'recording');
  await master.click(); await ui.locator('[data-observation-master][aria-checked="true"]:not(:disabled)').waitFor();
  assert.equal((await send({ schemaVersion: 1, type: 'ui-get-scope' })).scope.scopeMode, 'all-sites');
  evidence.checks.push('header master stops registration and Pro recording while retaining the Pro report', 'header master restores the previous observation scope');

  // Exercise the real compact setting, then restart the entire browser profile.
  await ui.goto(extensionUrl + 'options.html');
  const revoke = ui.locator('[data-action="revoke-data-consent"]');
  await revoke.evaluate(button => { button.closest('details').open = true; }); await revoke.click();
  await ui.locator('[data-action="accept-data-consent"]:not(:disabled)').waitFor();
  assert.equal((await send({ schemaVersion: 1, type: 'ui-data-consent-get' })).accepted, false);
  assert.equal((await ui.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length, 0);
  await ui.screenshot({ path: join(run, 'compact-off.png'), fullPage: true });
  await context.close(); worker = await launch();
  ui = await context.newPage(); await ui.goto(extensionUrl + 'popup.html');
  await ui.locator('[data-observation-master][aria-checked="false"]:not(:disabled)').waitFor();
  assert.equal((await send({ schemaVersion: 1, type: 'ui-data-consent-get' })).accepted, false);
  assert.equal((await ui.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length, 0);
  evidence.checks.push('native Turn off and clear action', 'disabled state survives full browser restart');
  await ui.locator('[data-observation-master]').click();
  await ui.waitForFunction(() => chrome.scripting.getRegisteredContentScripts().then(items => items.length === 2));
  page = await context.newPage(); await page.goto(origin); await page.waitForFunction(() => window.fixtureDone);
  const resumedTab = await ui.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.filter(item => item.url === url).at(-1)), origin + '/');
  for (let i = 0; i < 60; i++) {
    report = await send({ schemaVersion: 1, type: 'ui-get-report', tabId: resumedTab.id });
    if (report.report?.techniques?.some(item => item.count > 0)) break;
    await sleep(150);
  }
  assert.ok(report.report?.techniques.some(item => item.count > 0));
  assert.deepEqual(evidence.errors, []);
  evidence.checks.push('compact Enable action restores observation', 'no page exceptions');
  evidence.status = 'PASS';
  console.log('PASS automatic observation: Chromium ' + evidence.browser + ', ' + evidence.checks.join('; '));
} finally {
  writeFileSync(join(run, 'chrome.json'), JSON.stringify(evidence, null, 2) + '\n');
  writeFileSync(join(root, '.tmp/automatic-observation-chrome-latest.json'), JSON.stringify({ run, ...evidence }, null, 2) + '\n');
  await context?.close(); await new Promise(done => server.close(done));
}
