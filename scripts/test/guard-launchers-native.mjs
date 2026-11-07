// E22-22: real persisted master switches and first-inline probes in owned profiles.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';
import { createApiConfiguration, updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { GUARD_LAUNCHER_FILES, expectedGuardDelivery } from './guard-launchers-delivery.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/guard-launchers-')), extension = join(run, 'extension');
cpSync(join(root, 'dist', browser), extension, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = { at: new Date().toISOString(), browser, run, result: 'RUNNING', ownedLoopbackOnly: true, rawUserDataRead: false, checks: [], hashes: {} };
for (const file of GUARD_LAUNCHER_FILES) {
  const bytes = readFileSync(join(extension, file)); assert.ok(bytes.equals(expectedGuardDelivery(root, file, browser)), 'stale delivered file: ' + file);
  evidence.hashes[file] = sha(bytes);
}
const server = createServer((request, response) => { request.resume(); response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><script>globalThis.ownedGuardProbe={cpu:navigator.hardwareConcurrency,wasm:typeof WebAssembly,sin:Math.sin(1)};</script>Owned first-script probe'); });
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
let opened, phase = 'startup';
const check = message => { evidence.checks.push(message); console.log('  ok ' + message); };
const evaluate = (fn, value) => opened.evaluate(fn, value);
const send = message => evaluate(message => (globalThis.browser ?? globalThis.chrome).runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const state = () => send({ type: 'ui-api-config-get', tabId: null });
const configSet = async configuration => { const current = await state(); const reply = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: current.revision, configuration }); assert.equal(reply.type, 'api-config-state', reply.code); return reply; };
const probe = () => evaluate(async origin => {
  const api = globalThis.browser ?? globalThis.chrome, url = origin + '/probe?' + Math.random(), tab = await api.tabs.create({ url, active: false });
  try { for (let i = 0; i < 100; i++) { const current = await api.tabs.get(tab.id); if (current.status === 'complete' && current.url === url) { const result = await api.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: () => globalThis.ownedGuardProbe ?? null }); if (result[0]?.result) return result[0].result; } await new Promise(done => setTimeout(done, 30)); } throw Error('probe-timeout'); }
  finally { await api.tabs.remove(tab.id); }
}, origin);
async function settled(apiEnabled, antidetectEnabled) {
  await until(() => evaluate(({ apiEnabled, antidetectEnabled }) => {
    const anti = document.querySelector('[data-antidetect-launcher-master]'), api = document.querySelector('[data-protection-master]');
    return anti && api && !anti.disabled && !api.disabled && anti.getAttribute('aria-checked') === String(antidetectEnabled) && api.getAttribute('aria-checked') === String(apiEnabled);
  }, { apiEnabled, antidetectEnabled }), 'persisted launcher state');
  const saved = await state(); assert.equal(saved.configuration.enabled, apiEnabled); assert.equal(saved.configuration.antidetectEnabled, antidetectEnabled); return saved;
}
try {
  opened = await launchOwnedManagement({ root, run, extension, browser, evidence, dark: browser === 'firefox' }); evidence.version = opened.version;
  await opened.goto(opened.base + 'options.html#settings');
  await until(() => evaluate(() => Boolean(document.querySelector('[data-management-shell]'))), 'management ready');
  await send({ type: 'ui-data-consent-set', version: 1, accepted: true }); await send({ type: 'ui-set-scope', scopeMode: 'all-sites' });
  if (browser === 'firefox') {
    await opened.goto(opened.base + 'options.html#antidetect');
    await until(() => evaluate(() => Boolean(document.querySelector('[data-antidetect-grant-early]'))), 'native Firefox early-access choice');
    await opened.click('[data-antidetect-grant-early]'); await until(async () => (await state()).earlyAccess === 'ready', 'Firefox early access');
  }
  const baseline = await probe(); assert.equal(baseline.wasm, 'object');
  let configuration = createApiConfiguration(); configuration.preset = 'custom';
  const chosenCpu = baseline.cpu === 173 ? 174 : 173;
  configuration = updateApiConfiguration(configuration, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: chosenCpu }, userValues: [{ id: 'owned-value', label: 'Owned CPU', value: { kind: 'value', value: chosenCpu } }] }).value;
  configuration = updateApiConfiguration(configuration, 'webassembly', { mode: 'on' }).value;
  const math = configuration.apis.find(row => row.id === 'math-transcendentals');
  configuration = updateApiConfiguration(configuration, 'math-transcendentals', { mode: 'custom', selected: { kind: 'value', value: { ...math.presets[0].value.value, functions: ['sin'] } } }).value;
  assert.ok(configuration); await configSet(configuration);
  await opened.goto(opened.base + 'popup.html'); await settled(false, false);
  const dormant = await state(); assert.deepEqual(await probe(), baseline);
  check('both masters start OFF with saved Custom values and blocked modes dormant; no preset or device value enables either master');

  phase = 'four independent combinations';
  const snapshot = value => ({ apis: value.apis, sites: value.sites, fingerprintProfiles: value.fingerprintProfiles, preset: value.preset, webrtcNetworkPolicy: value.webrtcNetworkPolicy });
  for (const [selector, apiEnabled, antidetectEnabled] of [['[data-antidetect-launcher-master]', false, true], ['[data-protection-master]', true, true], ['[data-antidetect-launcher-master]', true, false], ['[data-protection-master]', false, false]]) {
    await opened.click(selector); const saved = await settled(apiEnabled, antidetectEnabled); assert.deepEqual(snapshot(saved.configuration), snapshot(dormant.configuration));
    const actual = await probe(); assert.equal(actual.cpu, antidetectEnabled ? chosenCpu : baseline.cpu); assert.equal(actual.wasm, apiEnabled ? 'undefined' : baseline.wasm);
    if (antidetectEnabled) { assert.notEqual(actual.sin, baseline.sin); assert.ok(Math.abs(actual.sin - baseline.sin) <= Number.EPSILON); } else assert.equal(actual.sin, baseline.sin);
  }
  check('all four persisted master combinations independently control first-inline CPU/Math Custom and WebAssembly blocking without changing libraries or modes');

  phase = 'DPI and browser availability';
  const beforeDpi = await state();
  assert.deepEqual(await evaluate(() => [...document.querySelectorAll('[data-dpi-guard-launcher] button')].map(button => ({ disabled: button.disabled, on: button.getAttribute('aria-checked') }))), [{ disabled: true, on: null }, { disabled: true, on: 'false' }]);
  await evaluate(() => { for (const button of document.querySelectorAll('[data-dpi-guard-launcher] button')) button.click(); });
  assert.equal((await state()).revision, beforeDpi.revision);
  assert.equal(await evaluate(() => Boolean(document.querySelector('[data-firewall-unavailable-launcher]'))), browser === 'firefox');
  check('DPI Guard stays disabled OFF and causes no mutation; Firefox Firewall is an unavailable OFF card without module permissions');

  phase = 'geometry and locales';
  for (const language of PRODUCTION_LANGUAGES) {
    await evaluate(language => (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-language-v1': language }), language.id); await pause(35);
    const layout = await evaluate(() => {
      const selectors = ['[data-antidetect-launcher]', '[data-protection-launcher]', '[data-dpi-guard-launcher]', '[data-protect-launcher], [data-firewall-unavailable-launcher]'];
      const boxes = selectors.map(selector => { const r = document.querySelector('.inspector-tools ' + selector)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, bottom: r.bottom } : null; });
      return { boxes, raw: /guard_launcher_[a-z_]+/.test(document.querySelector('.inspector-tools').textContent), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    assert.ok(layout.boxes.every(Boolean)); assert.equal(layout.raw, false); assert.equal(layout.overflow, false); const [antidetect, api, dpi, firewall] = layout.boxes; for (const [upper, lower] of [[api, firewall], [firewall, dpi], [dpi, antidetect]]) { assert.ok(lower.y >= upper.bottom - 0.5, language.id + ': ADR-103 grouped rows stack in order without overlap'); assert.ok(Math.abs(lower.x - upper.x) < 2 && Math.abs(lower.width - upper.width) < 2, language.id + ': ADR-103 grouped rows share one column'); }
  }
  await evaluate(() => (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-language-v1': 'ru' })); await opened.viewport(580, 900); await pause(80);
  if (browser === 'chrome') await until(() => evaluate(() => document.querySelector('[data-protect-launcher] [data-protect-state]')?.getAttribute('data-protect-state') === 'off'), 'settled Firewall OFF screenshot');
  await opened.screenshot(join(run, 'ru-popup.png'));
  await opened.goto(opened.base + 'sidepanel.html'); await settled(false, false);
  await evaluate(() => (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-language-v1': 'ar' })); await opened.media({ colorScheme: 'dark' });
  evidence.narrowLayouts = [];
  for (const width of [340, 234]) {
    await opened.viewport(width, 900); await pause(80);
    if (browser === 'chrome') await until(() => evaluate(() => document.querySelector('[data-protect-launcher] [data-protect-state]')?.getAttribute('data-protect-state') === 'off'), 'localized Firewall OFF screenshot');
    const layout = await evaluate(() => ({ width: innerWidth, height: innerHeight, dark: matchMedia('(prefers-color-scheme: dark)').matches, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      clipped: [...document.querySelectorAll('.inspector-tools button > span:first-child')].filter(span => {
        if (span.classList.contains('blocking-master__dot')) return false;
        const label = span.getBoundingClientRect(), control = span.parentElement.getBoundingClientRect();
        return label.left < control.left || label.right > control.right || label.top < control.top || label.bottom > control.bottom || span.scrollWidth > span.clientWidth + 1;
      }).map(span => span.textContent) }));
    assert.equal(layout.width, width); assert.equal(layout.height, 900); assert.equal(layout.dark, true); assert.equal(layout.overflow, false); assert.deepEqual(layout.clipped, []);
    evidence.narrowLayouts.push(layout); await opened.screenshot(join(run, width === 340 ? 'ar-sidebar.png' : 'ar-sidebar-234.png'));
  }
  check('the ADR-103 grouped launcher column resolves all21 locale catalogs and fits the fixed-width Russian popup and dark Arabic narrow sidebar');

  phase = 'persisted reopen and navigation';
  await opened.viewport(580, 900);
  await opened.goto(opened.base + 'popup.html'); await settled(false, false);
  await opened.click('[data-antidetect-launcher-master]'); await settled(false, true); await opened.goto(opened.base + 'sidepanel.html'); await settled(false, true);
  await opened.click('[data-antidetect-launcher-master]'); await settled(false, false); await opened.goto(opened.base + 'popup.html'); await settled(false, false);
  check('Antidetect master persists and synchronizes across popup and sidebar without enabling API Guard or losing the saved profile');
  await opened.click('[data-antidetect-open]');
  const managementTabs = () => evaluate(async () => {
    const api = globalThis.browser ?? globalThis.chrome;
    const tabs = typeof api.runtime.getContexts === 'function' ? (await api.runtime.getContexts({ contextTypes: ['TAB'] })).filter(row => row.frameId === 0).map(row => ({ id: row.tabId, url: row.documentUrl })) : await api.tabs.query({ url: api.runtime.getURL('options.html') + '*' });
    return tabs.flatMap(tab => { try { const url = new URL(tab.url); return url.pathname === '/options.html' ? [{ id: tab.id, pathname: url.pathname, hash: url.hash }] : []; } catch { return []; } });
  });
  const destinations = await until(async () => { const tabs = await managementTabs(); return tabs.length === 1 && tabs[0].hash === '#antidetect' ? tabs : null; }, 'Antidetect management entry');
  assert.equal(destinations.length, 1); assert.equal(destinations[0].hash, '#antidetect');
  await opened.click('[data-antidetect-open]');
  await until(async () => { const tabs = await managementTabs(); return tabs.length === 1 && tabs[0].id === destinations[0].id; }, 'reused management tab');
  check('the Antidetect title opens and reuses the unified management section while its state button toggles without navigation');
  evidence.result = 'PASS';
} catch (error) { evidence.result = 'FAIL'; evidence.phase = phase; evidence.error = String(error.message).slice(0, 400); if (opened) try { await opened.screenshot(join(run, 'failure.png')); } catch {} throw error; }
finally { if (opened) await opened.close(); await new Promise(done => server.close(done)); const output = join(root, 'test-results/production-1.1.0/guard-launchers', browser + '.json'); mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n'); }
console.log('Guard launchers ' + browser + ': ' + evidence.checks.length + ' checks PASS');
