// ADR-053 / ADR-098 / ADR-020 §15: actual launcher clicks, direct activation (one explicit click, no dialog) and privileged backend persistence.
// No fixed UI replies. Faults affect only this isolated SW's own settings write / managed read APIs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '../..'), arg = process.argv.indexOf('--dist');
const input = arg < 0 ? join(root, 'dist/chrome') : resolve(process.argv[arg + 1]);
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/firewall-toggle-')), extension = join(run, 'extension');
const artifact = join(root, 'test-results/production-1.1.0/firewall-toggle'); mkdirSync(artifact, { recursive: true });
cpSync(input, extension, { recursive: true });
assert.ok(readFileSync(join(extension, 'protect-ui.js'), 'utf8').includes('data-protect-toggle'), 'build the toggle UI before running this probe');
const evidence = { at: new Date().toISOString(), run, checks: [], faults: [], errors: [], optionsOpened: [], noDialogChecks: [], result: 'RUNNING',
  hashes: Object.fromEntries(['manifest.json', 'protect-sw.js', 'protect-ui.js', 'protect.css', 'popup.js', 'ui-actions.css', 'button-surfaces.css', 'popup.css'].map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(probe, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await probe(); if (value) return value; await pause(50); } throw Error('timeout: ' + label); }
const check = text => { evidence.checks.push(text); console.log('  ok ' + text); };
const server = createServer((request, response) => { request.resume(); response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Owned Firewall toggle fixture</title><h1>Owned Firewall toggle fixture</h1>'); });
await new Promise(done => server.listen(0, '127.0.0.1', done));
const fixture = 'http://127.0.0.1:' + server.address().port + '/';
let context, worker, ui, base, phase = 'startup';
async function launch() {
  const browser = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 412, height: 700 },
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
  browser.on('page', page => { page.on('pageerror', error => evidence.errors.push({ phase, error: error.message })); page.on('framenavigated', frame => { if (frame === page.mainFrame() && base && frame.url().startsWith(base + 'options.html')) evidence.optionsOpened.push(frame.url()); }); });
  return browser;
}
try {
  context = await launch();
  evidence.browser = context.browser()?.version();
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); base = new URL('.', worker.url()).href;
  await worker.evaluate(() => {
    const log = { writes: [], removes: 0, failEnabled: null, remaining: 0, holdMs: 0, forceManaged: false };
    globalThis.__firewallToggleNative = log;
    const set = chrome.storage.local.set.bind(chrome.storage.local), remove = chrome.storage.local.remove.bind(chrome.storage.local);
    chrome.storage.local.set = async (values, ...rest) => {
      const record = values?.protect;
      if (!record) return set(values, ...rest);
      const row = { enabled: record.enabled, at: Date.now(), status: 'pending' }; log.writes.push(row);
      if (log.remaining > 0 && record.enabled === log.failEnabled) { log.remaining--; row.status = 'injected-rejection'; throw Error('Owned native settings fault'); }
      if (log.holdMs > 0) { const delay = log.holdMs; log.holdMs = 0; await new Promise(done => setTimeout(done, delay)); }
      try { const result = await set(values, ...rest); row.status = 'saved'; return result; } catch (error) { row.status = 'native-rejection'; throw error; }
    };
    chrome.storage.local.remove = (keys, ...rest) => { if (keys === 'protect' || Array.isArray(keys) && keys.includes('protect')) log.removes++; return remove(keys, ...rest); };
    const managed = chrome.storage.managed.get.bind(chrome.storage.managed);
    chrome.storage.managed.get = (...args) => log.forceManaged ? Promise.resolve({ ProtectModuleDisabled: true }) : managed(...args);
  });
  ui = await context.newPage(); await ui.goto(base + 'popup.html?toggle-native=1');
  await ui.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'ru' })); await ui.reload();
  const status = '[data-protect-settings]', launcher = '[data-protect-launcher]';
  const send = message => ui.evaluate(value => chrome.runtime.sendMessage(value), { schemaVersion: 1, ...message });
  const state = async () => (await send({ type: 'ui-protect-get-state' })).state;
  const stored = () => worker.evaluate(() => chrome.storage.local.get('protect').then(value => value.protect ?? null));
  const log = () => worker.evaluate(() => globalThis.__firewallToggleNative);
  const fault = (enabled, count, holdMs = 0) => worker.evaluate(value => Object.assign(globalThis.__firewallToggleNative, { failEnabled: value.enabled, remaining: value.count, holdMs: value.holdMs }), { enabled, count, holdMs });
  async function settled(enabled) {
    await ui.waitForFunction(value => { const root = document.querySelector('[data-protect-launcher]'), button = document.querySelector('[data-protect-settings]'); return root?.getAttribute('aria-busy') === 'false' && button?.disabled === false && button.getAttribute('aria-checked') === String(value); }, enabled);
    const actual = await state(); assert.equal(actual.state === 'off', !enabled); return actual;
  }
  async function durable(enabled) { const record = await stored(); assert.equal(record?.enabled, enabled); return record; }
  const unchanged = (record, previous) => { assert.equal(record.consentVersion, previous.consentVersion); assert.deepEqual(record.features, previous.features); assert.equal(record.preset, previous.preset); };
  const noOptions = () => assert.deepEqual(evidence.optionsOpened, [], 'launcher toggles never open Options');

  // ADR-098: one explicit click enables the module; the activation dialog / inline acknowledgement no longer exist.
  // Only the exact removed activation selectors are forbidden (unrelated dormant dialogs of other modules are not).
  const activationDialogs = '#firewall-launcher-consent,[data-protect-inline-consent],[data-consent-confirm]', defaultFeatures = ['value-match', 'firewall', 'session-replay'];
  const watchDialogs = () => ui.evaluate(selector => {
    window.__activationDialogs = [];
    new MutationObserver(rows => { for (const row of rows) for (const node of row.addedNodes) if (node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector)) && window.__activationDialogs.length < 32) window.__activationDialogs.push({ tag: node.tagName, id: node.id ?? null }); }).observe(document.body, { subtree: true, childList: true });
  }, activationDialogs);
  const noDialog = async label => { assert.equal(await ui.locator(activationDialogs).count(), 0, label + ': no activation dialog in the DOM'); assert.deepEqual(await ui.evaluate(() => window.__activationDialogs ?? []), [], label + ': no activation dialog was ever inserted'); evidence.noDialogChecks.push(label); };

  phase = 'first direct activation'; await settled(false); assert.equal((await state()).consentVersion, null); assert.equal(await stored(), null); assert.equal((await log()).writes.length, 0);
  await pause(1100); assert.equal((await log()).writes.length, 0, 'mount, refresh and polling never enable'); assert.equal((await state()).state, 'off'); await watchDialogs();
  evidence.header = await ui.evaluate(() => Object.fromEntries(['.inspector-header-controls', '.inspector-pin-button', '.language-picker__trigger'].map(selector => [selector, document.querySelector(selector).getBoundingClientRect().toJSON()])));
  assert.equal(evidence.header['.inspector-header-controls'].height, 32, 'ADR-103 header control size');
  await ui.locator(status).click(); await settled(true); const choices = await durable(true);
  assert.deepEqual(choices.features, defaultFeatures); assert.equal(choices.preset, 'normal');
  assert.equal(choices.consentVersion, (await state()).requiredConsentVersion); assert.equal((await log()).writes.length, 1);
  await noDialog('first click'); await ui.screenshot({ path: join(artifact, 'ru-direct-active.png'), fullPage: true }); noOptions();
  check('first trusted click directly persists the canonical three initial features, normal preset and the current consent version; no dialog or acknowledgement, no activation on mount, no Options tab');

  phase = 'saved consent toggles';
  for (const [selector, enabled] of [[status, false], [status, true], [status, false], [status, true]]) {
    await ui.locator(selector).click(); await settled(enabled); unchanged(await durable(enabled), choices); noOptions();
  }
  await noDialog('saved-choice toggles'); await ui.close(); ui = await context.newPage(); await ui.goto(base + 'popup.html?toggle-native=1'); await watchDialogs(); await settled(true); await durable(true);
  await ui.locator(status).click(); await settled(false); await ui.reload(); await watchDialogs(); await settled(false); await durable(false);
  check('the compact launcher button toggles real persisted ON/OFF with saved choices, survive reopen/reload, and create no Options tab');

  phase = 'double click'; await ui.locator(status).click(); await settled(true); const beforeBurst = (await log()).writes.length;
  await fault(false, 0, 250); await ui.locator(status).dblclick({ force: true, delay: 10 }); await settled(false);
  const burst = (await log()).writes.slice(beforeBurst); assert.equal(burst.length, 1); assert.equal(burst[0].enabled, false); await durable(false);
  check('trusted double click while a real backend save is pending produces one toggle and one settings write');

  phase = 'real action popup sender'; const source = await context.newPage(); await source.goto(fixture); await source.bringToFront();
  const tab = await worker.evaluate(url => chrome.tabs.query({}).then(rows => rows.find(row => row.url === url)), fixture);
  await worker.evaluate(async tab => { await chrome.action.setPopup({ tabId: tab.id, popup: 'popup.html' }); await chrome.action.openPopup({ windowId: tab.windowId }); }, tab);
  const cdp = await context.newCDPSession(source);
  const target = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find(row => row.type === 'page' && row.url === base + 'popup.html'), 'native action popup target');
  const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false }); const pending = new Map(); let command = 0;
  const handler = event => { if (event.sessionId !== attached.sessionId) return; const value = JSON.parse(event.message), job = pending.get(value.id); if (!job) return; pending.delete(value.id); clearTimeout(job.timer); value.error ? job.reject(Error(JSON.stringify(value.error))) : job.resolve(value.result); };
  cdp.on('Target.receivedMessageFromTarget', handler);
  const rpc = (method, params = {}) => new Promise((resolve, reject) => { const id = ++command, timer = setTimeout(() => reject(Error('CDP timeout: ' + method)), 10000); pending.set(id, { resolve, reject, timer }); cdp.send('Target.sendMessageToTarget', { sessionId: attached.sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject); });
  const evaluate = async expression => { const result = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result?.value; };
  for (const enabled of [true, false]) {
    const rect = await until(() => evaluate('(()=>{const b=document.querySelector("[data-protect-settings]");return b&&!b.disabled?b.getBoundingClientRect().toJSON():null;})()'), 'native launcher ready');
    for (const type of ['mousePressed', 'mouseReleased']) await rpc('Input.dispatchMouseEvent', { type, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, button: 'left', clickCount: 1 });
    await until(() => evaluate('document.querySelector("[data-protect-launcher]")?.getAttribute("aria-busy")==="false"&&document.querySelector("[data-protect-settings]")?.getAttribute("aria-checked")===' + JSON.stringify(String(enabled))), 'actual native popup toggle settled');
    const result = await evaluate('chrome.runtime.sendMessage({schemaVersion:1,type:"ui-protect-get-state"})'); assert.equal(result.state.state === 'off', !enabled); await durable(enabled);
  }
  await evaluate('setTimeout(()=>window.close(),0);true'); await until(async () => (await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['POPUP'] }))).length === 0, 'native popup closed'); cdp.off('Target.receivedMessageFromTarget', handler);
  await ui.bringToFront(); await noDialog('double click'); await ui.reload(); await watchDialogs(); await settled(false); noOptions();
  check('trusted clicks in the actual tabless Chrome action popup reach the real enable/disable backend and persist both states');

  phase = 'unauthorized web sender';
  const unauthorized = await worker.evaluate(async ({ tabId, choices }) => (await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: async choices => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-protect-enable', consentVersion: choices.consentVersion, features: choices.features, preset: choices.preset }), args: [choices] }))[0].result, { tabId: tab.id, choices });
  assert.equal(unauthorized.type, 'error'); assert.equal(unauthorized.code, 'unauthorized-sender'); await durable(false);
  check('real web content-script sender cannot enable the module even with a valid enable payload');

  phase = 'enable storage failure'; await fault(true, 1);
  await ui.evaluate(() => { window.__toggleChecked = []; new MutationObserver(() => window.__toggleChecked.push(document.querySelector('[data-protect-settings]')?.getAttribute('aria-checked'))).observe(document.querySelector('[data-protect-launcher]'), { subtree: true, attributes: true }); });
  await ui.locator(status).click(); await ui.locator(launcher + ' [role="alert"]').waitFor(); await settled(false); unchanged(await durable(false), choices);
  assert.equal(await ui.evaluate(() => window.__toggleChecked.includes('true')), false);
  check('a real backend settings rejection on enable rolls back, displays an error and never renders a fake ON');

  phase = 'disable bounded retry'; await fault(null, 0); await ui.locator(status).click(); await settled(true);
  const beforeRetry = (await log()).writes.length; await fault(false, 1); await ui.locator(status).click(); await settled(false); unchanged(await durable(false), choices);
  const retry = (await log()).writes.slice(beforeRetry); assert.deepEqual(retry.map(row => row.status), ['injected-rejection', 'saved']);
  check('one failed OFF write receives one bounded retry and durably preserves consent and choices');

  phase = 'disable full write outage'; await ui.locator(status).click(); await settled(true); await fault(false, 2); await ui.locator(status).click();
  await ui.locator(launcher + ' [role="alert"]').waitFor(); const stopped = await settled(false); assert.ok(stopped.degradedReasons.includes('storage-unavailable'));
  assert.equal((await stored()).enabled, true, 'the unavailable store has the old record; no restart durability is claimed');
  evidence.faults.push({ kind: 'both OFF writes rejected', memoryState: stopped.state, storedEnabled: true, restartDurability: 'not established while storage is unavailable' });
  await fault(null, 0); const recovery = await send({ type: 'ui-protect-disable', purge: false }); assert.equal(recovery.type, 'protect-state'); await durable(false);
  await noDialog('enable failure, bounded retry and write outage'); await ui.reload(); await watchDialogs(); await settled(false);
  check('two failed OFF writes leave runtime OFF with an explicit storage error; restoring storage and retrying recovers durable OFF');

  phase = 'managed prohibition'; await worker.evaluate(() => { globalThis.__firewallToggleNative.forceManaged = true; });
  await ui.locator(status).click(); await ui.locator(launcher + ' [role="alert"]').waitFor();
  await until(async () => (await state()).state === 'organization-disabled', 'real controller policy rejection');
  await until(() => ui.locator(status).isDisabled(), 'managed-disabled launcher'); assert.equal(await ui.locator(status).isDisabled(), true); await durable(false);
  evidence.faults.push({ kind: 'managed API test seam', source: 'controlled chrome.storage.managed.get response; real controller guard, not an OS registry policy proof' });
  check('controlled managed prohibition reaches the real backend guard and disables the compact toggle without activation');
  noOptions(); await noDialog('managed prohibition'); evidence.backendWrites = (await log()).writes;

  // A parser-admitted persisted record with no selected features is initialized by one explicit click (ADR-098).
  // Only storage is seeded; after a full browser restart the shipped controller loads and handles this record.
  phase = 'current consent with empty saved choices';
  await worker.evaluate(record => chrome.storage.local.set({ protect: record }), { ...choices, enabled: false, features: [] });
  await context.close(); context = await launch();
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  ui = await context.newPage(); await ui.goto(base + 'popup.html?toggle-native=1'); await settled(false);
  const empty = await state(); assert.equal(empty.consentVersion, empty.requiredConsentVersion); assert.deepEqual(empty.features, []);
  await watchDialogs(); await ui.locator(status).click(); await settled(true);
  const initialized = await durable(true); assert.deepEqual(initialized.features, defaultFeatures); assert.equal(initialized.preset, 'normal');
  await noDialog('empty saved features after restart'); noOptions();
  check('after an actual browser restart, empty saved features activate directly with exactly the canonical three initial features and the normal preset, without a dialog');

  // A non-empty saved choice (a custom feature set and the strict preset) is used unchanged by the same single click.
  phase = 'non-empty custom saved choices after restart';
  await ui.locator(status).click(); await settled(false);
  const custom = { ...initialized, enabled: false, features: ['firewall'], preset: 'strict' };
  await worker.evaluate(record => chrome.storage.local.set({ protect: record }), custom);
  await context.close(); context = await launch();
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  ui = await context.newPage(); await ui.goto(base + 'popup.html?toggle-native=1'); await settled(false);
  await watchDialogs(); await ui.locator(status).click(); await settled(true);
  const preserved = await durable(true); assert.deepEqual(preserved.features, ['firewall']); assert.equal(preserved.preset, 'strict'); assert.equal(preserved.consentVersion, custom.consentVersion);
  await noDialog('non-empty saved choices after restart'); await ui.locator(status).click(); await settled(false); noOptions();
  check('one explicit click after an actual restart preserves non-empty saved firewall-only features and the strict preset, then durably switches OFF without a dialog');
  assert.deepEqual(evidence.errors, []); evidence.result = 'PASS';
  console.log('PASS Firewall launcher toggle native: ' + evidence.checks.length + ' checks');
} catch (error) { evidence.failure = { phase, error: String(error.stack ?? error) }; evidence.result = 'FAIL'; console.error(JSON.stringify(evidence.failure, null, 2)); process.exitCode = 1; }
finally { writeFileSync(join(artifact, 'toggle-native.json'), JSON.stringify(evidence, null, 2) + '\n'); await context?.close(); await new Promise(done => server.close(done)); }
