// ADR-076: unchanged packaged Firefox UI and native permissions in an owned profile.
// No API token, external request, intercepted API response, or user profile is used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { launchOwnedManagement, until } from './management-browser-fixture.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { PRECURSOR_MODES_MESSAGES } from '../production-locales-precursor-modes.mjs';

const root = resolve(import.meta.dirname, '../..');
const arg = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const input = resolve(arg('--dist') ?? join(root, 'dist/firefox'));
const output = resolve(arg('--output') ?? join(root, 'test-results/precursor-modes-2026-10-30/native-settings-firefox.json'));
mkdirSync(join(root, '.tmp'), { recursive: true }); mkdirSync(dirname(output), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/precursor-settings-firefox-')), extension = join(run, 'extension');
cpSync(input, extension, { recursive: true });
const files = ['manifest.json','precursor-settings.html','precursor-settings.js','precursor-settings.css','precursor-settings-locales.js','precursor-modes-contracts.js'];
const evidence = { startedAt: new Date().toISOString(), input, run, result: 'RUNNING', checks: [], layouts: [], screenshots: [], externalApiRequests: null,
  hashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
let opened, fixtureServer;
const check = name => { evidence.checks.push(name); console.log('  ok ' + name); };
const get = (fn, value) => opened.evaluate(fn, value);
async function language(id) { await get(id => browser.storage.local.set({ 'ui-language-v1': id }), id); await until(() => get(id => document.querySelector('#pm-language')?.value === id, id), 'locale ' + id); }
async function layout(name, width, height) {
  await opened.viewport(width, height);
  await get(() => scrollTo(0, 0));
  const result = await get(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, direction: document.documentElement.dir,
    visible: ['#pm-connect','#pm-token','#pm-zone-id','#pm-notifications'].every(selector => document.querySelector(selector)?.getClientRects().length > 0),
    unresolved: [...document.querySelectorAll('[data-i18n]')].some(node => !node.textContent.trim() || node.textContent.includes('precursor_modes_')) }));
  assert.equal(result.scrollWidth <= result.width, true, name + ': no horizontal page overflow'); assert.equal(result.visible, true); assert.equal(result.unresolved, false);
  evidence.layouts.push({ name, ...result });
  const path = join(dirname(output), name + '.png'); await opened.screenshot(path); evidence.screenshots.push(path);
}
try {
  opened = await launchOwnedManagement({ root, run, extension, browser: 'firefox', evidence, dark: true }); evidence.browser = opened.version;
  await opened.goto(opened.base + 'precursor-settings.html');
  await until(() => get(() => document.querySelector('#precursor-settings')?.getAttribute('aria-busy') === 'false' && !document.querySelector('#pm-connect')?.disabled), 'settings initial read');
  assert.equal(await get(() => document.querySelector('#pm-status').dataset.status), 'disconnected');
  assert.equal(await get(() => document.querySelector('#pm-mode').dataset.mode), 'unknown');
  assert.equal(await get(() => document.querySelector('#pm-token').type), 'password');
  await get(() => { document.documentElement.dataset.precursorApiRequests = '0'; browser.webRequest.onBeforeRequest.addListener(() => { document.documentElement.dataset.precursorApiRequests = String(Number(document.documentElement.dataset.precursorApiRequests) + 1); }, { urls: ['https://api.cloudflare.com/*'] }); });
  check('actual Firefox privileged settings port opens with disconnected/unknown and password input');

  evidence.sessionCapability = await get(async () => {
    const area = browser.storage.session;
    const methods = Object.fromEntries(['getKeys','get','set','remove','setAccessLevel'].map(name => [name, typeof area?.[name] === 'function']));
    let enumerate = false; if (methods.getKeys) { await area.getKeys(); enumerate = true; }
    if (methods.setAccessLevel) await area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    return { ...methods, enumerate };
  });
  for (const method of ['get','set','remove']) assert.equal(evidence.sessionCapability[method], true, 'native Firefox session capability ' + method);
  evidence.sessionCapability.nativeKeyEnumeration = evidence.sessionCapability.getKeys && evidence.sessionCapability.enumerate;
  check(evidence.sessionCapability.nativeKeyEnumeration ? 'Firefox session supports native key-only enumeration' : 'Firefox session lacks native getKeys; capability recorded without assuming API-mode support');

  fixtureServer = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end('<!doctype html><html><head><title>Owned local storage boundary fixture</title></head><body>Owned local fixture</body></html>'); });
  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  const fixtureUrl = 'http://127.0.0.1:' + fixtureServer.address().port + '/', sessionKey = 'precursor-native-session-fixture', controlKey = 'precursor-native-control-fixture';
  const tabId = await get(async url => (await browser.tabs.create({ url, active: false })).id, fixtureUrl);
  try {
    await until(() => get(async id => (await browser.tabs.get(id)).status === 'complete', tabId), 'owned local fixture loaded');
    const installed = await get(async ({ tabId, sessionKey, controlKey }) => {
      const result = await browser.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', args: [sessionKey, controlKey], func: (sessionKey, controlKey) => {
        const api = globalThis.browser ?? globalThis.chrome;
        document.documentElement.dataset.precursorSessionEvents = '0'; document.documentElement.dataset.precursorControlEvents = '0';
        api.storage.onChanged.addListener((changes, area) => {
          if (area === 'session' && Object.hasOwn(changes, sessionKey)) document.documentElement.dataset.precursorSessionEvents = String(Number(document.documentElement.dataset.precursorSessionEvents) + 1);
          if (area === 'local' && Object.hasOwn(changes, controlKey)) document.documentElement.dataset.precursorControlEvents = String(Number(document.documentElement.dataset.precursorControlEvents) + 1);
        });
        return true;
      } }); return result[0].result;
    }, { tabId, sessionKey, controlKey }); assert.equal(installed, true);
    await get(async ({ sessionKey, controlKey }) => { await browser.storage.session.set({ [sessionKey]: { fixture: true, token: 'not-a-real-credential' } }); await browser.storage.local.set({ [controlKey]: 1 }); }, { sessionKey, controlKey });
    const inspect = () => get(async ({ tabId, sessionKey }) => {
      const result = await browser.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', args: [sessionKey], func: async key => {
        const api = globalThis.browser ?? globalThis.chrome; let readDenied = false, valueReturned = false;
        try { const value = await api.storage.session.get(key); valueReturned = Object.hasOwn(value, key); } catch { readDenied = true; }
        return { readDenied, valueReturned, sessionEvents: Number(document.documentElement.dataset.precursorSessionEvents), controlEvents: Number(document.documentElement.dataset.precursorControlEvents) };
      } }); return result[0].result;
    }, { tabId, sessionKey });
    await until(async () => (await inspect()).controlEvents > 0, 'content-script control storage event');
    evidence.isolatedSessionBoundaryBeforeRemove = await inspect();
    assert.equal(evidence.isolatedSessionBoundaryBeforeRemove.readDenied, true); assert.equal(evidence.isolatedSessionBoundaryBeforeRemove.valueReturned, false); assert.equal(evidence.isolatedSessionBoundaryBeforeRemove.sessionEvents, 0);
    await get(async ({ sessionKey, controlKey }) => { await browser.storage.session.remove(sessionKey); await browser.storage.local.set({ [controlKey]: 2 }); }, { sessionKey, controlKey });
    await until(async () => (await inspect()).controlEvents > 1, 'content-script second control event');
    evidence.isolatedSessionBoundary = await inspect();
    assert.equal(evidence.isolatedSessionBoundary.readDenied, true); assert.equal(evidence.isolatedSessionBoundary.valueReturned, false); assert.equal(evidence.isolatedSessionBoundary.sessionEvents, 0);
    check('ISOLATED session read denied and no session credential-value events; local event control proves listener active');
  } finally {
    await get(async ({ tabId, sessionKey, controlKey }) => { await browser.storage.session.remove(sessionKey); await browser.storage.local.remove(controlKey); await browser.tabs.remove(tabId); }, { tabId, sessionKey, controlKey });
  }

  await opened.fill('#pm-zone-id', 'not-a-zone'); await opened.fill('#pm-token', 'fixture-not-a-secret'); await opened.click('#pm-connect');
  assert.equal(await get(() => document.querySelector('#pm-token').value.length), 0);
  assert.equal(await get(() => document.querySelector('#pm-zone-id').getAttribute('aria-invalid')), 'true');
  assert.equal(await get(() => document.querySelector('#pm-message').hidden), false);
  assert.equal(await get(async () => JSON.stringify(await browser.storage.local.get(null)).includes('fixture-not-a-secret')), false);
  check('invalid connect clears token immediately and makes no credential storage write');

  const initialPermission = await get(() => browser.permissions.contains({ permissions: ['notifications'] })); assert.equal(initialPermission, false);
  await opened.click('#pm-notifications');
  await until(() => get(() => document.querySelector('#pm-notifications').getAttribute('aria-checked') === 'true'), 'native notification preference');
  assert.equal(await get(() => browser.permissions.contains({ permissions: ['notifications'] })), true);
  await opened.click('#pm-notifications'); await until(() => get(() => document.querySelector('#pm-notifications').getAttribute('aria-checked') === 'false'), 'notifications disabled');
  check('notifications permission requested by actual click, preference can be enabled and disabled');

  for (const { id, tag } of PRODUCTION_LANGUAGES) {
    await language(id);
    const actual = await get(() => ({ tag: document.documentElement.lang, dir: document.documentElement.dir, heading: document.querySelector('h1').textContent, button: document.querySelector('#pm-connect').textContent }));
    assert.equal(actual.tag, tag); assert.equal(actual.dir, ['ar','ur'].includes(id) ? 'rtl' : 'ltr'); assert.equal(actual.heading, 'Cloudflare Precursor'); assert.equal(actual.button, PRECURSOR_MODES_MESSAGES[id].precursor_modes_connect);
  }
  check('all 21 languages follow saved extension preference and RTL direction');
  await language('ru'); await layout('precursor-settings-firefox-ru', 1180, 900);
  await language('ar'); await layout('precursor-settings-firefox-ar-mobile', 360, 900);
  check('native dark desktop and narrow RTL layouts have no page overflow');

  evidence.externalApiRequests = await get(() => Number(document.documentElement.dataset.precursorApiRequests ?? -1)); assert.equal(evidence.externalApiRequests, 0);
  await opened.goto(opened.base + 'options.html#settings');
  const rejected = await get(() => new Promise(resolve => {
    const port = browser.runtime.connect({ name: 'detect-expert-precursor-modes-v1' }); let delivered = false;
    const timer = setTimeout(() => { port.disconnect(); resolve(false); }, 5000);
    port.onMessage.addListener(() => { delivered = true; });
    port.onDisconnect.addListener(() => { clearTimeout(timer); resolve(!delivered); });
    try { port.postMessage({ schemaVersion: 1, id: 1, action: 'read' }); } catch { clearTimeout(timer); resolve(true); }
  }));
  assert.equal(rejected, true); check('other own page cannot access the settings-only port');
  await opened.goto(opened.base + 'precursor-settings.html');
  await until(() => get(() => document.querySelector('#precursor-settings')?.getAttribute('aria-busy') === 'false' && document.querySelector('#pm-language')?.value === 'ar' && document.documentElement.dir === 'rtl'), 'reopened page and saved locale');
  assert.equal(await get(() => document.querySelector('#pm-token').value.length), 0); assert.equal(await get(() => document.documentElement.dir), 'rtl');
  check('reopening retains chosen language without restoring token input');
  evidence.result = 'PASS';
} catch (failure) {
  evidence.result = 'FAIL'; evidence.failure = failure?.message ?? 'native test failed'; throw failure;
} finally {
  evidence.finishedAt = new Date().toISOString(); writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  await opened?.close();
  if (fixtureServer) await new Promise(resolve => fixtureServer.close(resolve));
}
