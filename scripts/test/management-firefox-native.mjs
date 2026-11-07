// ADR-055: actual Firefox management routes, inert Firewall and native own-tab reuse. No fixture UI replies.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { archiveProduction, FIREFOX_ID } from '../build-production.mjs';

const root = resolve(import.meta.dirname, '../..');
const arg = process.argv.indexOf('--dist'), input = arg < 0 ? join(root, 'dist/firefox') : resolve(process.argv[arg + 1]);
const driverPath = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe');
assert.ok(existsSync(driverPath), 'Existing geckodriver is required; this test downloads no tools');
let binary = process.env.FIREFOX_BINARY;
if (!binary && process.platform === 'win32') binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { encoding: 'utf8', windowsHide: true }).stdout.trim();
assert.ok(binary, 'Set FIREFOX_BINARY to the installed Firefox executable');
const run = join(root, '.tmp/firefox/runs', Date.now() + '-management'), profile = join(run, 'profile'), extension = join(run, 'extension');
mkdirSync(profile, { recursive: true }); cpSync(input, extension, { recursive: true });
const artifact = join(root, 'test-results/production-1.1.0/management'); mkdirSync(artifact, { recursive: true });
const uuid = randomUUID(), base = 'moz-extension://' + uuid + '/';
const prefs = { 'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }), 'browser.shell.checkDefaultBrowser': false,
  'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0, 'browser.newtabpage.enabled': false,
  'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false,
  'network.proxy.type': 0, 'extensions.webextOptionalPermissionPrompts': false,
  'ui.systemUsesDarkTheme': 1, 'layout.css.prefers-color-scheme.content-override': 0 };
writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ', ' + JSON.stringify(value) + ');').join('\n'));
const evidence = { at: new Date().toISOString(), input, run, result: 'RUNNING', checks: [], layouts: [], hashes: Object.fromEntries(
  ['options.html', 'options.js', 'protection-ui.js', 'management-ui.js', 'management-navigation.js', 'management-ui.css', 'management-workspaces.css', 'protect-ui.js', 'manifest.json',
    'browser-debug-controller.js', 'browser-debug-data.js', 'browser-debug-environment.js', 'browser-debug-shared.js', 'browser-debug-ui.js', 'browser-debug-ui.css'].map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
let endpoint, session, driver, driverError;
const log = createWriteStream(join(run, 'geckodriver.log'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function command(path, body, method = 'POST') {
  const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(30000) });
  const value = (await response.json()).value; if (!response.ok || value?.error) throw Error(JSON.stringify(value)); return value;
}
const wd = (path, body, method) => command('/session/' + session + path, body, method);
const script = (source, args = []) => wd('/execute/sync', { script: source, args });
const asyncScript = (source, args = []) => wd('/execute/async', { script: source, args });
const send = value => asyncScript('const done=arguments[arguments.length-1];browser.runtime.sendMessage(arguments[0]).then(done,error=>done({error:String(error)}));', [value]);
async function until(source, args = []) { for (let n = 0; n < 100; n++) { if (await script(source, args)) return; await pause(60); } throw Error('Firefox condition timed out: ' + source); }
async function click(selector) { const element = await wd('/element', { using: 'css selector', value: selector }); await wd('/element/' + element['element-6066-11e4-a52e-4f735466cecf'] + '/click', {}); }
async function selected(name) {
  await until('return document.querySelector("[data-management-tab="+arguments[0]+"]")?.getAttribute("aria-selected")==="true" && document.querySelector("[data-management-shell]")?.dataset.managementActive===arguments[1] && document.querySelector("[data-management-panel="+arguments[1]+"]")?.hidden===false;', [name === 'browser-debug' ? 'settings' : name, name]);
  const status = await script('return [...document.querySelectorAll("[data-management-panel]")].map(p=>({id:p.dataset.managementPanel,hidden:p.hidden,inert:p.inert}));');
  assert.equal(status.length, 12, 'hub, ten primary sections and Browser Debug');
  for (const row of status) { assert.equal(row.hidden, row.id !== name); assert.equal(row.inert, row.id !== name); }
}
async function openNavigation() {
  if (await script('const toggle=document.querySelector("[data-management-menu-toggle]"),nav=document.querySelector("[data-management-navigation]");return Boolean(toggle?.getClientRects().length&&nav?.hidden);')) await click('[data-management-menu-toggle]');
  await until('const nav=document.querySelector("[data-management-navigation]");return Boolean(nav&&!nav.hidden&&nav.getClientRects().length);');
  assert.equal(await script('return document.querySelector("[data-management-navigation] [role=tablist]")?.getAttribute("aria-orientation");'), 'vertical');
}
async function choose(name) {
  if (name === 'browser-debug') { await choose('settings'); await click('[data-settings-browser-debug]'); }
  else { await openNavigation(); await click('[data-management-tab="' + name + '"]'); }
  await selected(name);
}
const check = text => { evidence.checks.push(text); console.log('  ok ' + text); };

try {
  const portServer = createServer(); await new Promise(done => portServer.listen(0, '127.0.0.1', done));
  const port = portServer.address().port; await new Promise(done => portServer.close(done)); endpoint = 'http://127.0.0.1:' + port;
  driver = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(port), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true });
  driver.once('error', error => { driverError = error; }); driver.stdout.pipe(log); driver.stderr.pipe(log);
  for (let n = 0; n < 80; n++) { if (driverError) throw driverError; try { await command('/status', undefined, 'GET'); break; } catch { await pause(100); } }
  const opened = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } });
  session = opened.sessionId; evidence.browser = opened.capabilities.browserVersion;
  const archive = join(run, 'detect-expert-management.xpi'); writeFileSync(archive, archiveProduction(extension));
  assert.equal(await wd('/moz/addon/install', { path: archive, temporary: true }), FIREFOX_ID);
  await wd('/url', { url: base + 'options.html#settings' }); await selected('settings');
  await send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true });
  await wd('/refresh', {}); await selected('settings');
  const managementHandle = await wd('/window', undefined, 'GET');
  const identity = await asyncScript('const done=arguments[arguments.length-1];browser.tabs.getCurrent().then(t=>done({tabId:t.id,windowId:t.windowId}));');
  const token = randomUUID(); await script('window.__managementSmoke=arguments[0];', [token]);
  const before = await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }); assert.equal(before.type, 'api-config-state');
  for (const name of ['hub', 'firewall', 'api', 'antidetect', 'settings', 'cookies', 'autosurf', 'proxy', 'contacts']) {
    await choose(name); assert.equal(await script('return window.__managementSmoke;'), token);
    assert.equal((await script('return [...document.querySelectorAll("[data-management-tab]")].map(e=>e.dataset.managementTab);')).at(-1), 'contacts');
  }
  assert.equal((await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null })).revision, before.revision);
  await choose('firewall'); await until('return Boolean(document.querySelector("[data-management-unavailable=firewall]"));');
  assert.equal(await script('return document.querySelectorAll("[data-protect-enable]").length;'), 0);
  check('the hub and eight tabs share one Firefox document; visiting does not save API settings; Firewall remains explicitly unavailable');

  const source = await asyncScript('const done=arguments[arguments.length-1];browser.tabs.create({url:"about:blank",active:false}).then(t=>done({tabId:t.id}));');
  await wd('/url', { url: base + 'protection.html?tabId=' + source.tabId }); await selected('api');
  const legacy = new URL(await script('return location.href;'));
  assert.equal(legacy.pathname, '/options.html'); assert.equal(legacy.hash, '#api'); assert.equal(legacy.searchParams.get('tabId'), String(source.tabId));
  await choose('settings'); assert.equal(new URL(await script('return location.href;')).searchParams.get('tabId'), String(source.tabId));
  check('legacy protection entry redirects within its existing tab and preserves the canonical source-tab query during section changes');

  const popupHandle = (await wd('/window/new', { type: 'tab' })).handle; await wd('/window', { handle: popupHandle });
  await wd('/url', { url: base + 'popup.html' }); await until('return Boolean(document.querySelector("[data-protection-open]"));');
  const queried = await asyncScript('const done=arguments[arguments.length-1];browser.tabs.query({url:browser.runtime.getURL("options.html")+"*"}).then(rows=>done(rows.map(t=>({id:t.id,url:t.url}))),e=>done({error:String(e)}));');
  assert.ok(Array.isArray(queried)); assert.equal(queried.length, 1); assert.equal(queried[0].id, identity.tabId);
  await click('[data-protection-open]');
  await until('return !document.querySelector("[data-protection-open]")?.disabled;');
  const reused = await asyncScript('const done=arguments[arguments.length-1];browser.tabs.query({url:browser.runtime.getURL("options.html")+"*"}).then(rows=>done(rows.map(t=>({id:t.id,windowId:t.windowId,url:t.url}))));');
  assert.equal(reused.length, 1); assert.equal(reused[0].id, identity.tabId); assert.equal(reused[0].windowId, identity.windowId); assert.equal(new URL(reused[0].url).hash, '#api');
  evidence.reused = reused;
  await asyncScript('const done=arguments[arguments.length-1];browser.runtime.openOptionsPage().then(()=>done(true),e=>done({error:String(e)}));');
  await until('return Boolean(document.querySelector("[data-protection-open]"));');
  let menuTabs;
  for (let attempt = 0; attempt < 60; attempt++) {
    menuTabs = await asyncScript('const done=arguments[arguments.length-1];browser.tabs.query({url:browser.runtime.getURL("options.html")+"*"}).then(rows=>done(rows.map(t=>({id:t.id,windowId:t.windowId,url:t.url}))));');
    if (menuTabs.length === 1 && new URL(menuTabs[0].url).hash === '#hub') break;
    await pause(50);
  }
  assert.equal(menuTabs.length, 1); assert.equal(menuTabs[0].id, identity.tabId); assert.equal(menuTabs[0].windowId, identity.windowId);
  assert.equal(new URL(menuTabs[0].url).hash, '#hub');
  evidence.browserOptionsMenu = menuTabs;
  await wd('/window', { handle: managementHandle }); await selected('hub'); await choose('api');
  check('real Firefox own-extension URL query and API launcher reuse and focus the existing management tab');

  await asyncScript('const done=arguments[arguments.length-1];browser.storage.local.set({"ui-language-v1":"ar"}).then(()=>done(true));');
  await until('return document.documentElement.dir==="rtl";'); await wd('/window/rect', { width: 520, height: 900 });
  for (const name of ['firewall', 'api', 'antidetect', 'settings', 'browser-debug', 'cookies', 'autosurf', 'proxy', 'contacts']) {
    await choose(name);
    if (name === 'browser-debug') {
      await click('[data-browser-debug-load]');
      await until('return document.querySelector("[data-browser-debug]")?.getAttribute("aria-busy")==="false" && document.querySelectorAll("[data-browser-debug-record]").length>0;');
      assert.equal(await script('return Boolean(document.querySelector("[data-browser-debug-error]"));'), false);
      await script('scrollTo(0,0);');
    }
    await openNavigation();
    const geometry = await script('const s=document.querySelector("[data-management-shell]");return {section:s.dataset.managementActive,dir:getComputedStyle(s).direction,dark:matchMedia("(prefers-color-scheme:dark)").matches,overflow:document.documentElement.scrollWidth>innerWidth+1,width:innerWidth,labels:[...s.querySelectorAll("[data-management-tab]")].map(t=>({text:t.textContent.trim(),clipped:t.scrollWidth>t.clientWidth+1}))};');
    assert.equal(geometry.dir, 'rtl'); assert.equal(geometry.dark, true); assert.equal(geometry.overflow, false);
    for (const row of geometry.labels) { assert.ok(row.text && !row.text.includes('management_')); assert.equal(row.clipped, false); }
    if (name === 'browser-debug') {
      assert.ok(geometry.width < 650, 'loaded Browser Debug must use an actual narrow native viewport');
      geometry.browserDebugRows = await script('return document.querySelectorAll("[data-browser-debug-record]").length;');
      const screenshot = join(root, 'test-results/production-1.1.0/browser-debug/firefox-ar-dark-narrow.png');
      mkdirSync(resolve(screenshot, '..'), { recursive: true });
      writeFileSync(screenshot, Buffer.from(await wd('/screenshot', undefined, 'GET'), 'base64'));
      evidence.browserDebugScreenshot = screenshot;
    }
    evidence.layouts.push(geometry);
  }
  check('Arabic RTL and actual dark-theme narrow layouts retain eight localized unclipped labels without document overflow, including explicitly loaded Browser Debug rows');
  const after = await send({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null }); assert.equal(after.revision, before.revision); assert.equal(after.configuration.enabled, false);
  evidence.result = 'PASS'; console.log('PASS management Firefox native: ' + evidence.checks.length + ' checks');
} catch (error) { evidence.failure = error.stack ?? String(error); evidence.result = 'FAIL'; process.exitCode = 1; console.error('FAIL management Firefox: ' + error.message); }
finally {
  if (session) try { await command('/session/' + session, undefined, 'DELETE'); } catch { /* Preserve the original test failure. */ }
  driver?.kill(); log.end(); writeFileSync(join(artifact, 'management-firefox.json'), JSON.stringify(evidence, null, 2) + '\n');
}
