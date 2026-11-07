// ADR-104 follow-up: the REAL first-run journey of a Chrome user. Chrome's per-extension "Allow user scripts" switch starts OFF.
// The Options tab must say exactly what to do, master-first must not lock Apply, Apply must be reachable in a floating bar,
// the real switch must be picked up without a reload, and the applied values must reach a NEW page before its first script.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';
import { FINGERPRINT_DEVICE_LABELS } from '../../apps/production-extension/fingerprint-device-labels.js';
const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
if (browser === 'firefox') { console.log('Antidetect flow firefox: skipped (Firefox grants the optional userScripts permission with a click, covered by antidetect-ui-native)'); process.exit(0); }
const labels = FINGERPRINT_DEVICE_LABELS.en;
mkdirSync(join(root, '.tmp'), { recursive: true }); const run = mkdtempSync(join(root, '.tmp/antidetect-flow-')), extension = join(run, 'extension'); cpSync(join(root, 'dist', browser), extension, { recursive: true });
const evidence = { browser, run, at: new Date().toISOString(), result: 'RUNNING', checks: [], layouts: [] };
const server = createServer((request, response) => { request.resume(); response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><script>window.__first={cpu:navigator.hardwareConcurrency,platform:navigator.platform,userAgent:navigator.userAgent,width:screen.width,height:screen.height,language:navigator.language,gl:(()=>{try{const g=document.createElement("canvas").getContext("webgl"),e=g&&g.getExtension("WEBGL_debug_renderer_info");return g&&e?{vendor:g.getParameter(e.UNMASKED_VENDOR_WEBGL),renderer:g.getParameter(e.UNMASKED_RENDERER_WEBGL)}:null}catch(error){return null}})()};</script><h1>Flow fixture</h1>'); });
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen)); const origin = 'http://127.0.0.1:' + server.address().port;
let opened, phase = 'startup', navigation = 0;
const check = value => { evidence.checks.push(value); console.log('  ok ' + value); };
const evaluate = (fn, value) => opened.evaluate(fn, value);
const send = message => evaluate(message => chrome.runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const state = () => send({ type: 'ui-api-config-get', tabId: null });
const customRows = value => value.configuration.apis.filter(row => row.mode === 'custom').length;
const select = (selector, value) => evaluate(({ selector, value }) => { const input = document.querySelector(selector); if (!input) throw Error('Missing field ' + selector); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); }, { selector, value });
const ready = () => until(() => evaluate(() => document.querySelector('[data-profile-panel]')?.getAttribute('aria-busy') === 'false' && document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy') === 'false' && Boolean(document.querySelector('[data-profile-generate]'))), 'profile ready');
async function openQuick() {
  await opened.goto(opened.base + 'options.html?flow=' + (++navigation) + '#antidetect');
  await until(() => evaluate(() => document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy') === 'false' && Boolean(document.querySelector('[data-antidetect-category="quick"]'))), 'Antidetect ready');
  await opened.click('[data-antidetect-category="quick"]'); await ready();
}
// ADR-107: an Apply that cannot run stays focusable and says why (aria-disabled plus a visible reason), so «usable» reads both.
const ui = () => evaluate(() => {
  const usable = selector => { const button = document.querySelector(selector); return button ? !button.disabled && button.getAttribute('aria-disabled') !== 'true' : null; };
  const reason = document.querySelector('[data-profile-apply-reason]'), applies = ['[data-profile-apply]', '[data-profile-apply-inline]', '[data-profile-bar-apply]'].map(selector => document.querySelector(selector)).filter(Boolean);
  return {
    stale: Boolean(document.querySelector('[data-profile-stale]')), bar: document.querySelector('[data-profile-bar]')?.getAttribute('data-profile-bar') ?? null,
    error: document.querySelector('[data-profile-error]')?.textContent.trim() ?? null, callout: document.querySelector('[data-antidetect-early-access]')?.getAttribute('data-antidetect-early-access') ?? null,
    calloutText: document.querySelector('[data-antidetect-early-access]')?.textContent.replace(/\s+/g, ' ').trim() ?? null, status: document.querySelector('[data-antidetect-master-status]')?.textContent.trim() ?? null,
    master: document.querySelector('[data-antidetect-master]')?.getAttribute('aria-checked'),
    applyFooter: usable('[data-profile-apply]') === null ? null : !usable('[data-profile-apply]'), applyInline: usable('[data-profile-apply-inline]'), barApply: usable('[data-profile-bar-apply]'),
    reason: reason?.textContent.trim() ?? null, reasonShown: Boolean(reason && reason.textContent.trim() && reason.getClientRects().length && getComputedStyle(reason).visibility !== 'hidden'),
    applyFocusable: applies.every(button => !button.disabled && button.tabIndex >= 0), applyDescribedBy: applies.map(button => button.getAttribute('aria-describedby')),
    barButtons: [...document.querySelectorAll('[data-profile-bar] button')].map(button => button.textContent.trim()),
  };
});
// Ctrl+S on a focused control of the panel: true when the panel took the save (the browser's own «Save page» is then prevented).
const saveShortcut = selector => evaluate(selector => { const target = document.querySelector(selector); target.focus(); const event = new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }); target.dispatchEvent(event); return event.defaultPrevented; }, selector);
async function probe() {
  return evaluate(async origin => { const api = globalThis.browser ?? globalThis.chrome, url = origin + '/probe?' + Date.now(), tab = await api.tabs.create({ url, active: false });
    try { for (let index = 0; index < 150; index++) { const tabState = await api.tabs.get(tab.id); if (tabState.status === 'complete' && tabState.url === url) { const result = await api.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: () => globalThis.__first ?? null }); if (result[0]?.result) return result[0].result; } await new Promise(resolveTimer => setTimeout(resolveTimer, 40)); } throw Error('Flow probe timeout'); } finally { await api.tabs.remove(tab.id); } }, origin);
}
try {
  opened = await launchOwnedManagement({ root, run, extension, browser, evidence, userScripts: false }); evidence.version = opened.version;
  await opened.goto(opened.base + 'options.html#settings'); await until(() => evaluate(() => Boolean(document.querySelector('[data-management-shell]'))), 'shell');
  await send({ type: 'ui-data-consent-set', version: 1, accepted: true }); await send({ type: 'ui-set-scope', scopeMode: 'all-sites' });

  phase = 'first run without the switch';
  assert.equal(await evaluate(() => typeof chrome.userScripts), 'undefined', 'the harness must start like a real user: Allow user scripts is OFF');
  const baseline = await probe(); evidence.nativeWebgl = baseline.gl;
  await openQuick(); let now = await ui();
  assert.equal(now.callout, 'browser-toggle-required'); assert.ok(now.calloutText.includes(labels.early_blocked_title) && now.calloutText.includes(labels.early_blocked_steps), now.calloutText);
  assert.equal(await evaluate(() => Boolean(document.querySelector('[data-antidetect-early-settings]') && document.querySelector('[data-antidetect-early-recheck]'))), true);
  check('with Chrome\'s user-script switch OFF the tab opens with a prominent callout that names the exact fix and offers Open settings and Check again');

  phase = 'master first, Randomize, Apply';
  await opened.click('[data-antidetect-master]'); await until(async () => (await state()).configuration.antidetectEnabled, 'master saved'); await pause(500);
  now = await ui(); assert.equal(now.master, 'true'); assert.equal(now.status, labels.status_needs_scripts); assert.equal(now.stale, false, 'the master switch must not lock the editor');
  const gpuId = baseline.gl?.renderer?.includes('RX 6600') ? 'nvidia-rtx-3060' : 'amd-rx-6600';
  await select('[data-profile-gpu]', gpuId); await opened.click('[data-profile-generate]'); await pause(400);
  now = await ui(); assert.equal(now.stale, false, 'the master switch must not lock the editor'); assert.equal(now.bar, 'early');
  assert.deepEqual(now.barButtons, [now.barButtons[0], labels.early_recheck, labels.bar_cancel, labels.bar_apply]);
  const placement = await evaluate(() => { const generate = document.querySelector('[data-profile-generate]'), inline = document.querySelector('[data-profile-apply-inline]'), bar = document.querySelector('[data-profile-bar]').getBoundingClientRect(); return { sibling: generate.nextElementSibling === inline, barInside: bar.top >= 0 && bar.bottom <= innerHeight + 1 && bar.left >= 0 && bar.right <= innerWidth + 1 }; });
  assert.deepEqual(placement, { sibling: true, barInside: true }); check('master first does not lock the editor: Randomize gives a floating Apply/Cancel bar inside the viewport and an Apply button right next to Randomize');
  // ADR-107: the worker refuses Custom rows while Chrome forbids user scripts, so every Apply says so BEFORE a click: aria-disabled,
  // still focusable, the exact reason visible and linked by aria-describedby; a scripted click or Ctrl+S does nothing.
  assert.deepEqual([now.applyInline, now.barApply, now.applyFooter], [false, false, true], 'all three Apply buttons are unavailable');
  assert.equal(now.reason, labels.reason_scripts); assert.equal(now.reasonShown, true, 'the reason is on screen, not only announced');
  assert.equal(now.applyFocusable, true, 'aria-disabled keeps the buttons focusable'); assert.deepEqual(now.applyDescribedBy, ['fp-apply-reason', 'fp-apply-reason', 'fp-apply-reason']);
  const blockedRevision = (await state()).revision;
  await evaluate(() => { document.querySelector('[data-profile-bar-apply]').click(); document.querySelector('[data-profile-apply-inline]').click(); });
  assert.equal(await saveShortcut('[data-profile-apply-inline]'), false, 'Ctrl+S leaves the browser alone while Apply cannot run'); await pause(400);
  now = await ui(); assert.equal(now.error, null, 'no failed attempt, no generic "Could not save the settings"'); assert.equal((await state()).revision, blockedRevision, 'nothing was sent');
  assert.equal(customRows(await state()), 0, 'nothing was saved while the browser forbids user scripts'); assert.deepEqual(await probe(), baseline, 'pages keep native values');
  await opened.screenshot(join(run, 'flow-1-blocked.png')); check('with the switch OFF every Apply is unavailable before the click and names the exact fix ("' + labels.reason_scripts + '"); clicks and Ctrl+S save nothing and pages stay native');

  phase = 'flip the real switch and come back';
  await evaluate(() => { window.__flowDocument = 'kept'; });
  const before = opened.context.pages().length; await opened.click('[data-profile-bar-settings]');
  const details = await until(() => opened.context.pages().find(page => page.url().startsWith('chrome://extensions/?id=')), 'extension page opened'); assert.ok(opened.context.pages().length > before);
  const toggle = details.locator('extensions-detail-view #allow-user-scripts'); await toggle.waitFor();
  if (!await toggle.evaluate(element => element.checked ?? element.shadowRoot?.querySelector('cr-toggle')?.checked)) await toggle.click();
  await pause(1500); await details.close(); await opened.bringToFront(); await opened.dispatchFocus();
  await until(async () => (await ui()).callout === null, 'callout cleared by the automatic re-check', 15000);
  // The panel re-reads the user-script state on focus/visibility: Apply becomes available in this same document, with no reload.
  await until(async () => (await ui()).barApply === true, 'Apply available again without a reload', 15000);
  now = await ui(); assert.equal(await evaluate(() => window.__flowDocument), 'kept', 'the same document, never reloaded');
  assert.equal(now.bar, 'dirty'); assert.equal(now.error, null); assert.deepEqual([now.applyInline, now.barApply, now.applyFooter], [true, true, false]); assert.equal(now.reason, '');
  assert.equal(await evaluate(() => typeof chrome.userScripts), 'object');
  check('flipping the real Chrome switch is noticed on return without a reload: the guidance and the Apply reason disappear, all three Apply buttons become available and the preview is kept');
  await opened.click('[data-profile-bar-apply]'); await until(async () => (await state()).registration === 'ready', 'registration ready');
  const applied = await state(); assert.ok(customRows(applied) >= 20); assert.equal(applied.configuration.antidetectEnabled, true); assert.equal((await ui()).bar, null, 'the bar closes after Apply');
  const gpu = applied.configuration.apis.find(row => row.id === 'webgl').selected.value, cores = applied.configuration.apis.find(row => row.id === 'hardware-concurrency').selected.value;
  const observed = await probe();
  assert.equal(observed.cpu, cores); assert.equal(observed.platform, 'Win32'); assert.equal(observed.userAgent, applied.configuration.apis.find(row => row.id === 'navigator-user-agent').selected.value);
  assert.equal(observed.width, applied.configuration.apis.find(row => row.id === 'screen-width').selected.value);
  if (baseline.gl) { assert.deepEqual(observed.gl, { vendor: gpu.unmaskedVendor, renderer: gpu.unmaskedRenderer }); assert.notEqual(baseline.gl.renderer, gpu.unmaskedRenderer); }
  check('after Apply a NEW page sees the chosen CPU, platform, User-Agent, screen' + (baseline.gl ? ' and the exact ANGLE/Direct3D11 WebGL pair of ' + gpuId : ' (this browser exposes no WebGL)') + ' at its first script');

  phase = 'repeat without a reload';
  await opened.click('[data-profile-generate]'); await pause(400); now = await ui(); assert.equal(now.stale, false); assert.equal(now.bar, 'dirty');
  const revision = (await state()).revision; await opened.click('[data-profile-apply-inline]'); await until(async () => (await state()).revision > revision, 'second Apply saved');
  check('a second Randomize and the inline Apply work in the same document, with no reload and no stale lock');

  phase = 'layout';
  await opened.click('[data-profile-generate]'); await pause(400);
  for (const width of [1180, 520, 340]) {
    await opened.viewport(width, 900); await pause(150);
    const layout = await evaluate(() => { const bar = document.querySelector('[data-profile-bar]').getBoundingClientRect(); return { width: innerWidth, scroll: document.documentElement.scrollWidth, inside: bar.left >= -1 && bar.right <= innerWidth + 1 && bar.bottom <= innerHeight + 1, buttons: [...document.querySelectorAll('[data-profile-bar] button')].every(button => { const rect = button.getBoundingClientRect(); return rect.right <= innerWidth + 1 && rect.left >= -1; }) }; });
    evidence.layouts.push(layout); assert.ok(layout.scroll <= layout.width + 1, JSON.stringify(layout)); assert.ok(layout.inside && layout.buttons, JSON.stringify(layout));
  }
  await opened.screenshot(join(run, 'flow-2-narrow.png')); check('the floating bar and its buttons stay inside the viewport without horizontal scrolling at 1180/520/340px');
  evidence.result = 'PASS';
} catch (error) { evidence.result = 'FAIL'; evidence.phase = phase; evidence.error = String(error.message).slice(0, 600); if (opened) try { evidence.ui = await ui(); } catch {} throw error; }
finally { if (opened) await opened.close(); await new Promise(resolveClose => server.close(resolveClose)); const output = join(root, 'test-results/production-1.1.0/antidetect-flow/flow-' + browser + '.json'); mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n'); }
console.log('Antidetect flow ' + browser + ': ' + evidence.checks.length + ' checks PASS');
