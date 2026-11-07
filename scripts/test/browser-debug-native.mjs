// ADR-063: real native browser data, disposable profiles and owned fixture records only.
// Builds nothing. The immutable production input and the explicit permission-fixture manifest are hashed separately.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { archiveProduction, FIREFOX_ID } from '../build-production.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const root = resolve(import.meta.dirname, '../..');
const argument = key => { const index = process.argv.indexOf(key); return index < 0 ? null : process.argv[index + 1]; };
const browser = argument('--browser') ?? 'chrome'; assert.ok(['chrome', 'firefox'].includes(browser));
const input = resolve(argument('--dist') ?? join(root, 'dist', browser));
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/browser-debug-' + browser + '-'));
const frozen = join(run, 'frozen'); cpSync(input, frozen, { recursive: true });
const output = resolve(argument('--output') ?? join(root, 'test-results/production-1.1.0/browser-debug', browser + '.json'));
mkdirSync(resolve(output, '..'), { recursive: true });
const files = ['manifest.json', 'options.html', 'options.js', 'management-ui.js', 'management-ui.css', 'browser-debug-shared.js', 'browser-debug-data.js', 'browser-debug-controller.js', 'browser-debug-environment.js', 'browser-debug-ui.js', 'browser-debug-ui.css'];
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const evidence = { at: new Date().toISOString(), browser, input, run, result: 'RUNNING', permissionMode: 'production optional access baseline, then isolated promoted-permission fixture', hashes: Object.fromEntries(files.map(file => [file, hash(join(frozen, file))])), checks: [], screenshots: [], layouts: [], limits: ['Native optional permission prompt acceptance/revocation is not simulated or claimed. Only owned fixture records are mutated.'] };
if (browser === 'firefox') evidence.limits.push('Firefox screenshots record actual native media state; no unsupported color-scheme/forced-colors override is claimed.');
const pause = ms => new Promise(done => setTimeout(done, ms));
const check = text => { evidence.checks.push(text); console.log('  ok ' + text); };
async function until(probe, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await probe(); if (value) return value; await pause(50); } throw Error('timeout: ' + label); }
const server = createServer((request, response) => { request.resume(); response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Owned Browser Debug fixture</title><h1>Owned Browser Debug fixture</h1>'); });
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
let opened, phase = 'production optional baseline';

async function launch(extension, label) {
  const profile = join(run, label + '-profile'); mkdirSync(profile, { recursive: true });
  if (browser === 'chrome') {
    // Native system.display.getInfo crashes Chromium 153's headless process in a bare MV3 fixture.
    // A normal off-screen window exercises the real supported desktop API, without a foreground lab window.
    const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: false, viewport: { width: 1180, height: 900 }, args: ['--window-position=-10000,-10000', '--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-first-run'] });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const base = worker.url().slice(0, worker.url().indexOf('/', 'chrome-extension://'.length) + 1);
    const page = await context.newPage();
    return { version: context.browser().version(), base, evaluate: (fn, value) => page.evaluate(fn, value), goto: url => page.goto(url), click: selector => page.locator(selector).click(), fill: (selector, value) => page.locator(selector).fill(value),
      screenshot: path => page.screenshot({ path, fullPage: true }), viewport: (width, height) => page.setViewportSize({ width, height }), media: options => page.emulateMedia(options), close: () => context.close() };
  }
  const driverPath = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe'); assert.ok(existsSync(driverPath));
  let binary = process.env.FIREFOX_BINARY;
  if (!binary && process.platform === 'win32') binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  assert.ok(binary, 'Installed Firefox binary is required');
  const uuid = randomUUID(), prefs = { 'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }), 'browser.shell.checkDefaultBrowser': false, 'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0, 'browser.newtabpage.enabled': false, 'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false, 'extensions.webextOptionalPermissionPrompts': false, 'network.proxy.type': 0 };
  writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ',' + JSON.stringify(value) + ');').join('\n'));
  const portServer = createServer(); await new Promise(done => portServer.listen(0, '127.0.0.1', done)); const port = portServer.address().port; await new Promise(done => portServer.close(done));
  const endpoint = 'http://127.0.0.1:' + port, log = createWriteStream(join(run, label + '-geckodriver.log'));
  const child = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(port), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true }); child.stdout.pipe(log); child.stderr.pipe(log);
  async function command(path, body, method = 'POST') { const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(30000) }); const value = (await response.json()).value; if (!response.ok || value?.error) throw Error(value?.error ?? 'WebDriver error'); return value; }
  await until(async () => { try { await command('/status', undefined, 'GET'); return true; } catch { return false; } }, 'geckodriver');
  let session;
  try {
    const result = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } }); session = result.sessionId;
    const wd = (path, body, method) => command('/session/' + session + path, body, method);
    const xpi = join(run, label + '.xpi'); writeFileSync(xpi, archiveProduction(extension)); assert.equal(await wd('/moz/addon/install', { path: xpi, temporary: true }), FIREFOX_ID);
    const element = async selector => (await wd('/element', { using: 'css selector', value: selector }))['element-6066-11e4-a52e-4f735466cecf'];
    return { version: result.capabilities.browserVersion, base: 'moz-extension://' + uuid + '/',
      evaluate: async (fn, value) => { const result = await wd('/execute/async', { script: 'const done=arguments[arguments.length-1];Promise.resolve((' + fn.toString() + ')(arguments[0])).then(value=>done({ok:true,value}),error=>done({ok:false,error:error?.code??error?.message??"error"}));', args: [value ?? null] }); if (!result.ok) throw Error(result.error); return result.value; },
      goto: url => wd('/url', { url }),
      // The redesigned shell has a sticky header (ADR-103). WebDriver does not scroll an element that is inside the viewport but covered by it
      // and then fails with "element click intercepted", so wait until the target is clickable and centre it first, like management-browser-fixture.mjs.
      click: async selector => {
        await until(async () => { try { return await wd('/execute/sync', { script: 'const e=document.querySelector(arguments[0]);return Boolean(e&&!e.disabled&&e.getClientRects().length);', args: [selector] }); } catch { return false; } }, 'clickable ' + selector);
        await wd('/execute/sync', { script: 'document.querySelector(arguments[0]).scrollIntoView({block:"center"});', args: [selector] });
        return wd('/element/' + await element(selector) + '/click', {});
      }, fill: async (selector, text) => { const id = await element(selector); await wd('/element/' + id + '/clear', {}); await wd('/element/' + id + '/value', { text, value: [...text] }); },
      screenshot: async path => writeFileSync(path, Buffer.from(await wd('/screenshot', undefined, 'GET'), 'base64')), viewport: (width, height) => wd('/window/rect', { width, height }), media: async () => {},
      close: async () => { try { await command('/session/' + session, undefined, 'DELETE'); } finally { child.kill(); log.end(); } } };
  } catch (error) { if (session) try { await command('/session/' + session, undefined, 'DELETE'); } catch {} child.kill(); log.end(); throw error; }
}
async function present(selector) { return opened.evaluate(selector => Boolean(document.querySelector(selector)), selector); }
async function select(id, load = true) {
  await opened.click('[data-browser-debug-dataset="' + id + '"]');
  await until(() => present('[data-browser-debug-view="' + id + '"]'), id + ' selected');
  if (load) { await opened.click('[data-browser-debug-load]'); await until(() => opened.evaluate(() => document.querySelector('[data-browser-debug]')?.getAttribute('aria-busy') === 'false' && Boolean(document.querySelector('[data-browser-debug-count]'))), id + ' loaded'); }
}
async function record(text) {
  const handle = await until(() => opened.evaluate(text => [...document.querySelectorAll('[data-browser-debug-record]')].find(row => row.textContent.includes(text))?.getAttribute('data-browser-debug-record') ?? null, text), 'owned record ' + text);
  return '[data-browser-debug-record="' + handle + '"]';
}
async function saved() { await until(() => opened.evaluate(() => document.querySelector('[data-browser-debug]')?.getAttribute('aria-busy') === 'false' && !document.querySelector('[data-browser-debug-editor]') && Boolean(document.querySelector('[data-browser-debug-count]'))), 'saved and refreshed'); }
async function boot() {
  await opened.goto(opened.base + 'options.html#browser-debug');
  await until(() => present('[data-browser-debug]'), 'Browser Debug mount');
  await opened.evaluate(async fixture => { const api = globalThis.browser ?? globalThis.chrome, module = await import(api.runtime.getURL('browser-debug-controller.js')), controller = module.createBrowserDebugController(api); window.__browserDebugNative = { api, module, controller }; if (fixture) { const bridge = await import(api.runtime.getURL('browser-debug-native-bridge.js')); window.__browserDebugNative.mutate = (...args) => bridge.mutate(controller, ...args); } return true; }, opened.fixture === true);
}
const action = async (id, operation, predicate, patch) => opened.evaluate(async ({ id, operation, predicate, patch }) => {
  const c = window.__browserDebugNative.controller, snap = await c.load(id), row = snap.rows.find(row => row.values[predicate.key] === predicate.value); if (!row) throw Error('owned-record-missing');
  return window.__browserDebugNative.mutate(id, operation, row.handle, patch);
}, { id, operation, predicate, patch });

try {
  const production = JSON.parse(readFileSync(join(frozen, 'manifest.json')));
  for (const permission of ['history', 'bookmarks', 'cookies', 'tabs', 'privacy', 'management']) { assert.ok(production.optional_permissions.includes(permission), permission + ' remains optional'); assert.equal(production.permissions.includes(permission), false); }
  opened = await launch(frozen, 'production'); evidence.version = opened.version; await boot();
  for (const id of ['history', 'bookmarks']) { await select(id, false); await until(() => present('[data-browser-debug-status="permission-required"]'), id + ' permission required'); assert.equal(await present('[data-browser-debug-record]'), false); assert.equal(await opened.evaluate(() => document.querySelector('[data-browser-debug-load]').disabled), true); }
  check('unchanged production manifest denies history/bookmarks reads before optional access; visiting creates no snapshot');
  await opened.close(); opened = null;

  phase = 'permission fixture startup';
  const extension = join(run, 'permission-fixture'); cpSync(frozen, extension, { recursive: true });
  const promoted = ['history', 'bookmarks', 'downloads', 'cookies', 'tabs', 'sessions', 'topSites', 'privacy', 'management', ...(browser === 'chrome' ? ['readingList', 'contentSettings', 'identity', 'identity.email', 'system.cpu', 'system.memory', 'system.storage', 'system.display'] : [])];
  const manifest = JSON.parse(readFileSync(join(extension, 'manifest.json')));
  for (const permission of promoted) { assert.ok(manifest.optional_permissions.includes(permission)); manifest.optional_permissions = manifest.optional_permissions.filter(value => value !== permission); manifest.permissions.push(permission); }
  writeFileSync(join(extension, 'manifest.json'), JSON.stringify(manifest, null, 2));
  // Firefox WebDriver runs in a sandbox. Parse mutation inputs in the actual own-extension module realm,
  // preserving the production controller's strict plain-object guard instead of weakening it for tests.
  writeFileSync(join(extension, 'browser-debug-native-bridge.js'), 'export function mutate(controller,id,operation,handle,patch){return controller.mutate(id,operation,handle,JSON.parse(JSON.stringify(patch)));}\n');
  evidence.fixture = { promoted, manifestSha256: hash(join(extension, 'manifest.json')), unchangedProductHashes: Object.fromEntries(files.filter(file => file !== 'manifest.json').map(file => { const digest = hash(join(extension, file)); assert.equal(digest, evidence.hashes[file]); return [file, digest]; })) };
  evidence.fixture.nativeRealmBridgeSha256 = hash(join(extension, 'browser-debug-native-bridge.js'));
  opened = await launch(extension, 'granted-fixture'); opened.fixture = true; await boot();
  assert.equal(await present('[data-browser-debug-record]'), false); assert.equal(await present('[data-browser-debug-count]'), false);
  await opened.click('[data-browser-debug-load]'); await until(() => present('[data-browser-debug-count]'), 'explicit overview Load');
  assert.ok(await opened.evaluate(() => Number(document.querySelector('[data-browser-debug-count]').dataset.browserDebugCount)) > 0);
  check('overview is empty until explicit Load and then projects actual browser/runtime metadata');

  phase = 'bookmark UI CRUD';
  const native = await opened.evaluate(async origin => { const api = window.__browserDebugNative.api, roots = await api.bookmarks.getTree(), parent = roots[0].children.find(item => !item.url), folder = await api.bookmarks.create({ parentId: parent.id, title: 'Owned Browser Debug folder' }), destination = await api.bookmarks.create({ parentId: parent.id, title: 'Owned Browser Debug destination' }); return { folder: folder.id, destination: destination.id }; }, origin);
  await select('bookmarks'); await opened.click('[data-browser-debug-create]'); await opened.fill('[data-browser-debug-field="title"]', 'Owned Browser Debug bookmark'); await opened.fill('[data-browser-debug-field="url"]', origin + '/bookmark'); await opened.fill('[data-browser-debug-field="parentId"]', native.folder);
  assert.equal(await present('[data-browser-debug-diff]'), true); await opened.click('[data-browser-debug-cancel]');
  assert.equal(await opened.evaluate(async origin => (await window.__browserDebugNative.api.bookmarks.search({ url: origin + '/bookmark' })).length, origin), 0);
  await opened.click('[data-browser-debug-create]'); await opened.fill('[data-browser-debug-field="title"]', 'Owned Browser Debug bookmark'); await opened.fill('[data-browser-debug-field="url"]', origin + '/bookmark'); await opened.fill('[data-browser-debug-field="parentId"]', native.folder); await opened.click('[data-browser-debug-save]'); await saved();
  let row = await record('Owned Browser Debug bookmark'); await opened.click(row + ' [data-browser-debug-action="edit"]'); await opened.fill('[data-browser-debug-field="title"]', 'Owned Browser Debug edited'); await opened.click('[data-browser-debug-save]'); await saved();
  row = await record('Owned Browser Debug edited'); await opened.click(row + ' [data-browser-debug-action="move"]'); await opened.fill('[data-browser-debug-field="parentId"]', native.destination); await opened.click('[data-browser-debug-save]'); await saved();
  assert.equal(await opened.evaluate(async origin => (await window.__browserDebugNative.api.bookmarks.search({ url: origin + '/bookmark' }))[0].parentId, origin), native.destination);
  row = await record('Owned Browser Debug edited'); await opened.click(row + ' [data-browser-debug-action="remove"]'); assert.equal(await present('[data-browser-debug-confirmation]'), true); await opened.click('[data-browser-debug-save]'); await saved();
  assert.equal(await opened.evaluate(async origin => (await window.__browserDebugNative.api.bookmarks.search({ url: origin + '/bookmark' })).length, origin), 0);
  check('actual bookmark UI Create/Cancel/diff/Edit/Move/nonrecursive Remove changes only owned native records');

  phase = 'history';
  const historyUrl = origin + '/history?owned=fixture';
  await opened.evaluate(async url => window.__browserDebugNative.mutate('history', 'create', null, { url }), historyUrl);
  await action('history', 'remove', { key: 'url', value: historyUrl }, {});
  assert.equal(await opened.evaluate(async url => (await window.__browserDebugNative.api.history.search({ text: url, startTime: 0, maxResults: 100 })).some(item => item.url === url), historyUrl), false);
  check('history adds the current native visit and deletes only the selected owned URL');

  phase = 'cookie metadata and native removal';
  evidence.cookieFixture = await opened.evaluate(async origin => { const api = window.__browserDebugNative.api; const selected = await api.cookies.set({ url: origin + '/private/deep', name: 'owned-browser-debug', value: 'FIXTURE_SECRET_NEVER_PROJECT', path: '/private', httpOnly: true, secure: false }); const found = await api.cookies.getAll({ domain: new URL(origin).hostname, partitionKey: {}, ...(typeof api.runtime.getBrowserInfo === 'function' ? { firstPartyDomain: null } : {}) }); const snapshot = await window.__browserDebugNative.controller.load('cookies', { origin }); return { seeded: Boolean(selected), selectedMetadata: { path: selected.path, partitionKeyState: selected.partitionKey === null ? 'null' : selected.partitionKey === undefined ? 'undefined' : 'object', partitionKey: selected.partitionKey ?? null, firstPartyDomain: selected.firstPartyDomain ?? null }, nativeMatches: found.filter(item => item.name === 'owned-browser-debug').length, projected: snapshot.rows.length, truncated: snapshot.truncated }; }, origin);
  await select('cookies', false); await opened.fill('[data-browser-debug-origin]', origin); await opened.click('[data-browser-debug-load]'); await until(() => present('[data-browser-debug-count]'), 'cookies loaded');
  row = await record('owned-browser-debug'); assert.equal(await opened.evaluate(() => document.body.textContent.includes('FIXTURE_SECRET_NEVER_PROJECT')), false);
  await opened.click('[data-browser-debug-export]');
  const preview = await opened.evaluate(() => document.querySelector('[data-browser-debug-export-preview] textarea').value);
  assert.equal(preview.includes('FIXTURE_SECRET_NEVER_PROJECT'), false); assert.equal(preview.includes('"value"'), false); assert.equal(JSON.parse(preview).dataset, 'cookies');
  await opened.click('[data-browser-debug-export-preview] button:last-child'); row = await record('owned-browser-debug'); await opened.click(row + ' [data-browser-debug-action="remove"]'); await opened.click('[data-browser-debug-save]'); await saved();
  assert.equal(await opened.evaluate(async origin => window.__browserDebugNative.api.cookies.get({ url: origin + '/private/deep', name: 'owned-browser-debug' }), origin), null);
  check('scoped deep-path cookie metadata/export omit the known secret; exact native cookie Remove succeeds');

  phase = 'owned tab edit';
  const ownTab = await opened.evaluate(async origin => { const tab = await window.__browserDebugNative.api.tabs.create({ url: origin + '/owned-tab', active: false }); return tab.id; }, origin);
  await until(() => opened.evaluate(async ({ origin, id }) => { const tab = await window.__browserDebugNative.api.tabs.get(id); return tab.url === origin + '/owned-tab' && tab.status === 'complete'; }, { origin, id: ownTab }), 'owned tab navigation committed');
  await action('tabs', 'edit', { key: 'url', value: origin + '/owned-tab' }, { pinned: true, muted: true });
  assert.deepEqual(await opened.evaluate(async id => { const tab = await window.__browserDebugNative.api.tabs.get(id); return { pinned: tab.pinned, muted: tab.mutedInfo.muted }; }, ownTab), { pinned: true, muted: true });
  check('tab action edits only pin/mute on an exact owned native tab');

  phase = 'native read-only namespaces and owned recent restore';
  evidence.nativeReads = await opened.evaluate(async () => {
    const controller = window.__browserDebugNative.controller, result = {};
    for (const id of ['downloads', 'sessions', 'top-sites', 'extensions']) {
      const access = await controller.access(id);
      result[id] = { status: access.status };
      if (access.status === 'ready') { const snapshot = await controller.load(id); result[id] = { ...result[id], rows: snapshot.rows.length, truncated: snapshot.truncated, actions: [...new Set(snapshot.rows.flatMap(row => row.actions))] }; }
    }
    return result;
  });
  for (const id of ['downloads', 'sessions', 'top-sites', 'extensions']) assert.equal(evidence.nativeReads[id].status, 'ready');
  await opened.evaluate(async id => window.__browserDebugNative.api.tabs.remove(id), ownTab);
  await until(() => opened.evaluate(async origin => (await window.__browserDebugNative.api.sessions.getRecentlyClosed({ maxResults: 25 })).some(session => session.tab?.url === origin + '/owned-tab'), origin), 'native recent owned tab');
  await action('sessions', 'restore', { key: 'url', value: origin + '/owned-tab' }, {});
  assert.equal(await opened.evaluate(async origin => (await window.__browserDebugNative.api.tabs.query({})).filter(tab => tab.url === origin + '/owned-tab').length, origin), 1);
  check('native download/session/top-site/extension projections load; Restore reopens exactly the owned recent tab');

  phase = 'native privacy own-layer setting';
  const privacy = await opened.evaluate(async () => { const { api, controller, mutate } = window.__browserDebugNative, snapshot = await controller.load('privacy'), row = snapshot.rows.find(row => row.values.name === 'network.networkPredictionEnabled' && row.actions.includes('edit')); if (!row) throw Error('privacy-positive-control-missing'); const before = await api.privacy.network.networkPredictionEnabled.get({ incognito: false }); await mutate('privacy', 'edit', row.handle, { value: !row.values.value }); const changed = await api.privacy.network.networkPredictionEnabled.get({ incognito: false }); const updated = await controller.load('privacy'), current = updated.rows.find(row => row.values.name === 'network.networkPredictionEnabled'); await mutate('privacy', 'clear', current.handle, {}); const after = await api.privacy.network.networkPredictionEnabled.get({ incognito: false }); return { before: before.value, changed: changed.value, changedControl: changed.levelOfControl, after: after.value, afterControl: after.levelOfControl }; });
  assert.equal(privacy.changed, !privacy.before); assert.equal(privacy.changedControl, 'controlled_by_this_extension'); assert.equal(privacy.after, privacy.before); assert.notEqual(privacy.afterControl, 'controlled_by_this_extension'); evidence.privacy = privacy;
  check('privacy native setting changes, verifies extension ownership, and clears only its own layer back to baseline');

  if (browser === 'chrome') {
    phase = 'native system and signed-out account reads';
    evidence.environmentReads = await opened.evaluate(async () => {
      const controller = window.__browserDebugNative.controller, system = await controller.load('system'), account = await controller.load('account');
      return { systemRows: system.rows.length, systemTruncated: system.truncated, accountRows: account.rows.length, accountEmpty: account.rows.every(row => row.values.value === ''), accountActions: account.rows.flatMap(row => row.actions) };
    });
    assert.ok(evidence.environmentReads.systemRows > 0); assert.equal(evidence.environmentReads.accountRows, 2); assert.equal(evidence.environmentReads.accountEmpty, true); assert.deepEqual(evidence.environmentReads.accountActions, []);
    check('native system getInfo and signed-out account metadata read successfully without OAuth or account mutation');
    phase = 'reading list and exact origin settings';
    await opened.evaluate(async origin => window.__browserDebugNative.mutate('reading-list', 'create', null, { url: origin + '/reading', title: 'Owned reading', hasBeenRead: false }), origin);
    await action('reading-list', 'edit', { key: 'url', value: origin + '/reading' }, { title: 'Owned edited reading', hasBeenRead: true });
    assert.equal(await opened.evaluate(async origin => (await window.__browserDebugNative.api.readingList.query({ url: origin + '/reading' }))[0].hasBeenRead, origin), true);
    await action('reading-list', 'remove', { key: 'url', value: origin + '/reading' }, {});
    const site = await opened.evaluate(async origin => { const { api, controller, mutate } = window.__browserDebugNative, snapshot = await controller.load('site-permissions', { origin }), row = snapshot.rows.find(row => row.values.name === 'images'), before = row.values.value; await mutate('site-permissions', 'edit', row.handle, { value: before === 'block' ? 'allow' : 'block' }); const changed = await api.contentSettings.images.get({ primaryUrl: origin + '/' }), another = new URL(origin); another.port = String(Number(another.port) + 1); const other = await api.contentSettings.images.get({ primaryUrl: another.href }); const fresh = await controller.load('site-permissions', { origin }); await mutate('site-permissions', 'edit', fresh.rows.find(row => row.values.name === 'images').handle, { value: before }); return { before, changed: changed.setting, other: other.setting }; }, origin);
    assert.notEqual(site.changed, site.before); assert.equal(site.other, site.before); evidence.site = site;
    check('native reading list CRUD and exact-port site setting writes succeed without affecting a neighboring origin');
  } else {
    const unsupported = await opened.evaluate(async () => { const c = window.__browserDebugNative.controller; return { reading: (await c.access('reading-list')).status, site: (await c.access('site-permissions')).status, system: (await c.access('system')).status, account: (await c.access('account')).status }; });
    assert.equal(unsupported.reading, 'unsupported'); assert.equal(unsupported.site, 'unsupported'); evidence.unsupported = unsupported;
    check('Firefox reports unsupported native reading-list/site-setting namespaces explicitly');
  }

  phase = 'locales and layouts'; await select('overview');
  for (const locale of PRODUCTION_LANGUAGES) { const messages = JSON.parse(readFileSync(join(frozen, locale.uiOnly ? 'ui-locales' : '_locales', locale.id, 'messages.json'))); for (const key of ['management_tab_browser_debug', 'browser_debug_load', 'browser_debug_dataset_history', 'browser_debug_action_remove']) assert.ok(messages[key]?.message, locale.id + ':' + key); }
  for (const [locale, theme, width, forced] of [['ru', 'light', 1180, false], ['en', 'dark', 520, false], ['ar', 'dark', 520, false], ['ru', 'light', 520, true]]) {
    await opened.evaluate(async locale => { await window.__browserDebugNative.api.storage.local.set({ 'ui-language-v1': locale }); return true; }, locale);
    await opened.media({ colorScheme: theme, forcedColors: forced ? 'active' : 'none' }); await opened.viewport(width, 900);
    await until(() => opened.evaluate(locale => document.documentElement.dir === (locale === 'ar' ? 'rtl' : 'ltr') && document.documentElement.lang.toLowerCase().startsWith(locale), locale), locale + ' locale');
    const geometry = await opened.evaluate(() => { const root = document.querySelector('[data-browser-debug]'); return { overflow: document.documentElement.scrollWidth > innerWidth + 1, width: innerWidth, dir: getComputedStyle(root).direction, dark: matchMedia('(prefers-color-scheme:dark)').matches, forcedColors: matchMedia('(forced-colors:active)').matches, missingLabels: /browser_debug_/.test(root.textContent) }; });
    assert.equal(geometry.overflow, false); assert.equal(geometry.missingLabels, false); assert.equal(geometry.dir, locale === 'ar' ? 'rtl' : 'ltr');
    if (browser === 'chrome') assert.equal(geometry.width, width, 'actual Chromium viewport');
    if (geometry.forcedColors) {
      geometry.selectedControls = await opened.evaluate(() => {
        const probe = document.createElement('button');
        probe.style.cssText = 'position:fixed;left:-10000px;color:ButtonText;background-color:ButtonFace;outline:2px solid Highlight'; document.body.append(probe);
        const system = getComputedStyle(probe), expected = { color: system.color, background: system.backgroundColor, highlight: system.outlineColor }; probe.remove();
        return { expected, controls: ['[data-browser-debug-dataset].is-selected', '[data-management-tab][aria-selected="true"]'].map(selector => {
          const button = document.querySelector(selector), label = button?.querySelector('span'), style = button && getComputedStyle(button);
          return { selector, text: label?.textContent.trim() ?? '', color: style?.color, labelColor: label && getComputedStyle(label).color, background: style?.backgroundColor, border: style?.borderColor, outlineColor: style?.outlineColor, outlineStyle: style?.outlineStyle, outlineWidth: style?.outlineWidth };
        }) };
      });
      for (const control of geometry.selectedControls.controls) {
        const expected = geometry.selectedControls.expected;
        assert.ok(control.text, control.selector + ': visible selected label');
        assert.equal(control.color, expected.color); assert.equal(control.labelColor, expected.color); assert.equal(control.background, expected.background);
        assert.notEqual(control.labelColor, control.background, control.selector + ': selected text contrasts with background');
        assert.equal(control.outlineStyle, 'solid'); assert.equal(control.outlineWidth, '2px'); assert.equal(control.outlineColor, expected.highlight);
      }
    }
    await opened.evaluate(() => { window.scrollTo(0, 0); return true; });
    const name = browser + '-' + locale + '-' + (geometry.dark ? 'dark' : 'light') + '-' + geometry.width + (geometry.forcedColors ? '-forced' : '') + '.png', path = join(resolve(output, '..'), name); await opened.screenshot(path); evidence.screenshots.push(path); evidence.layouts.push({ locale, requestedWidth: width, requestedTheme: theme, requestedForced: forced, ...geometry });
  }
  check('21 catalogs contain Browser Debug labels; real RU/EN/AR layouts remain localized and within the viewport');
  evidence.result = 'PASS'; console.log('PASS Browser Debug ' + browser + ': ' + evidence.checks.length + ' checks');
} catch (error) { evidence.result = 'FAIL'; evidence.phase = phase; evidence.failure = error.stack ?? String(error); process.exitCode = 1; console.error('FAIL Browser Debug ' + browser + ' [' + phase + ']: ' + error.message); }
finally { if (opened) try { await opened.close(); } catch {} await new Promise(done => server.close(done)); writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n'); }
