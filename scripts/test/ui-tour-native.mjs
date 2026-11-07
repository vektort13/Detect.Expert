// Round 5, ADR-111: the Antidetect guided tour (apps/production-extension/ui-tour.js) in a real browser, driven by real key presses: node scripts/test/ui-tour-native.mjs [--firefox] [--dist] [--keep] [--no-evidence]
// (--no-evidence keeps the run out of test-results/). The other tours and the header buttons of every section are walked by ui-tour-tabs-native.mjs.
// Default: the extension is assembled from apps/production-extension into a private folder under .tmp and its locale tables are regenerated THERE (the shared
// bundles of the project are never touched); --dist tests dist/<browser> instead (it must already contain the tour_* messages). The run folder is deleted unless --keep.
// Deliberate-breakage check: UI_TOUR_NATIVE_MUTATION='{"file":"ui-tour.js","from":"...","to":"..."}' edits the assembled COPY only; the run is expected to FAIL then.
// What it proves, in Chromium and Firefox: open from the checklist, from the header button and from the palette; every step by Right arrow (ring on the real target,
// popover inside the window, focus inside it, announcement, nothing inert or hidden behind it); Left arrow, Esc, Tab cycling, Enter on Done; Resume; skipping a missing
// part with a visible note; focus and view returned to the invoker; storage untouched except ui-tour:v1; no network; no console error; 21 languages (and a language switched
// under a running tour); RTL; 7 palettes; 1180/640/320 px with every button still in view when a long text scrolls; reduced motion, forced colors, more contrast (Chromium). Screen readers are NOT tested: the announcer text and ARIA wiring are checked, not their speech.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { archiveProduction, FIREFOX_ID } from '../build-production.mjs';
import { stageExtension, writeEvidence, fileHashes } from './native-evidence.mjs';
import { TOURS, TOUR_TARGETS, TOUR_STORAGE_KEY } from '../../apps/production-extension/ui-tour.js';
const TOUR_STEPS = TOURS.antidetect; // this file walks the Antidetect tour; ui-tour-tabs-native.mjs walks every other tour and the header buttons
import { TOUR_LABELS } from '../../apps/production-extension/ui-tour-labels.js';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome', fromDist = process.argv.includes('--dist'), keep = process.argv.includes('--keep');
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/ui-tour-' + browser + '-')), extension = join(run, 'extension');
const evidence = { browser, run, at: new Date().toISOString(), packaging: null, result: 'RUNNING', checks: [], steps: [], phases: {}, limits: [] };
const check = text => { evidence.checks.push(text); console.log('  ok ' + text); };
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(probe, label, timeout = 20000) { const deadline = Date.now() + timeout; let last; while (Date.now() < deadline) { last = await probe(); if (last) return last; await pause(60); } throw Error('timeout: ' + label); }

// ---- the package under test ----------------------------------------------------------------------------------------------------------
const staged = await stageExtension({ browser, target: extension, from: fromDist ? 'dist' : 'source' });
evidence.packaging = staged.packaging;
const mutation = process.env.UI_TOUR_NATIVE_MUTATION ? JSON.parse(process.env.UI_TOUR_NATIVE_MUTATION) : null;
if (mutation) {
  const target = join(extension, mutation.file), text = readFileSync(target, 'utf8');
  assert.ok(text.includes(mutation.from), 'mutation anchor is missing in ' + mutation.file);
  writeFileSync(target, text.replace(mutation.from, mutation.to)); evidence.mutation = mutation;
}
evidence.hashes = fileHashes(extension, ['ui-tour.js', 'ui-tour-steps.js', 'ui-tour.css', 'ui-tour-labels.js', 'workspace-controls-ui.js', 'workspace-controls-ui.css', 'management-ui.js', 'antidetect-ui.js', 'options.html']);

// ---- launching ------------------------------------------------------------------------------------------------------------------------
const KEYCODES = { Enter: 0xE007, Escape: 0xE00C, Tab: 0xE004, ArrowLeft: 0xE012, ArrowUp: 0xE013, ArrowRight: 0xE014, ArrowDown: 0xE015, Shift: 0xE008, Control: 0xE009, Alt: 0xE00A };
const webdriverKey = name => Object.hasOwn(KEYCODES, name) ? String.fromCodePoint(KEYCODES[name]) : name.length === 1 ? name.toLowerCase() : null;
let opened, closeBrowser = async () => {}, cdp = null;
async function launch() {
  const profile = join(run, 'profile'); mkdirSync(profile, { recursive: true });
  if (browser === 'chrome') {
    const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: false, viewport: { width: 1180, height: 900 }, args: ['--window-position=-10000,-10000', '--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-first-run'] });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), base = new URL('.', worker.url()).href, page = await context.newPage();
    page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors?.push(message.text()); });
    page.on('pageerror', error => evidence.consoleErrors?.push('pageerror ' + error.message));
    closeBrowser = () => context.close();
    return { version: context.browser().version(), base, evaluate: (fn, value) => page.evaluate(fn, value), goto: url => page.goto(url), press: combo => page.keyboard.press(combo), click: (x, y) => page.mouse.click(x, y), viewport: (width, height) => page.setViewportSize({ width, height }),
      media: options => page.emulateMedia(options), screenshot: path => page.screenshot({ path }), cdp: async () => cdp ??= await context.newCDPSession(page), bringToFront: () => page.bringToFront() };
  }
  const driverPath = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe'); assert.ok(existsSync(driverPath), 'geckodriver is required (.tmp/firefox/tools)');
  let binary = process.env.FIREFOX_BINARY;
  if (!binary && process.platform === 'win32') binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  assert.ok(binary, 'the installed Firefox binary is required');
  const uuid = randomUUID(), prefs = { 'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }), 'browser.shell.checkDefaultBrowser': false, 'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0, 'browser.newtabpage.enabled': false,
    'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false, 'extensions.webextOptionalPermissionPrompts': false, 'network.proxy.type': 0 };
  writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ',' + JSON.stringify(value) + ');').join('\n'));
  const ports = createServer(); await new Promise(done => ports.listen(0, '127.0.0.1', done)); const port = ports.address().port; await new Promise(done => ports.close(done));
  const endpoint = 'http://127.0.0.1:' + port, log = createWriteStream(join(run, 'geckodriver.log'));
  const child = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(port), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true }); child.stdout.pipe(log); child.stderr.pipe(log);
  async function command(path, body, method = 'POST') { const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(60000) }); const value = (await response.json()).value; if (!response.ok || value?.error) throw Error((value?.error ?? 'WebDriver error') + ': ' + (value?.message ?? path)); return value; }
  await until(async () => { try { await command('/status', undefined, 'GET'); return true; } catch { return false; } }, 'geckodriver');
  const result = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } }), session = result.sessionId;
  const wd = (path, body, method) => command('/session/' + session + path, body, method);
  closeBrowser = async () => { try { await command('/session/' + session, undefined, 'DELETE'); } finally { child.kill(); log.end(); } };
  const xpi = join(run, 'owned.xpi'); writeFileSync(xpi, archiveProduction(extension)); assert.equal(await wd('/moz/addon/install', { path: xpi, temporary: true }), FIREFOX_ID);
  const keyActions = names => ({ type: 'key', id: 'keyboard', actions: [...names.map(name => ({ type: 'keyDown', value: webdriverKey(name) })), ...[...names].reverse().map(name => ({ type: 'keyUp', value: webdriverKey(name) }))] });
  return { version: result.capabilities.browserVersion, base: 'moz-extension://' + uuid + '/', goto: url => wd('/url', { url }),
    evaluate: async (fn, value) => { const out = await wd('/execute/async', { script: 'const done=arguments[arguments.length-1];Promise.resolve((' + fn.toString() + ')(arguments[0])).then(value=>done({ok:true,value}),error=>done({ok:false,error:error?.code??error?.message??"error"}));', args: [value ?? null] }); if (!out.ok) throw Error(out.error); return out.value; },
    click: async (x, y) => { await wd('/actions', { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y), origin: 'viewport' }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] }); await wd('/actions', undefined, 'DELETE'); },
    press: async combo => { const names = combo.split('+'); assert.ok(names.every(name => webdriverKey(name) !== null), 'key ' + combo); await wd('/actions', { actions: [keyActions(names)] }); await wd('/actions', undefined, 'DELETE'); },
    viewport: async (width, height) => { let outerWidth = width, outerHeight = height; for (let attempt = 0; attempt < 3; attempt++) { await wd('/window/rect', { width: outerWidth, height: outerHeight }); const now = await wd('/execute/sync', { script: 'return {innerWidth,innerHeight,outerWidth,outerHeight};', args: [] }); if (now.innerWidth === width && now.innerHeight === height) return; outerWidth = width + now.outerWidth - now.innerWidth; outerHeight = height + now.outerHeight - now.innerHeight; } },
    media: async () => {}, screenshot: async path => writeFileSync(path, Buffer.from(await wd('/screenshot', undefined, 'GET'), 'base64')), cdp: async () => null, bringToFront: async () => {} };
}

// ---- page-side helpers ------------------------------------------------------------------------------------------------------------------
const evaluate = (fn, value) => opened.evaluate(fn, value);
const press = async combo => { await opened.press(combo); await pause(60); };
const TARGET_SELECTORS = Object.fromEntries(TOUR_STEPS.map(step => [step.id, ['[data-tour~="' + step.target + '"]', ...TOUR_TARGETS[step.target]]]));
const STEP_IDS = TOUR_STEPS.map(step => step.id), TOTAL = TOUR_STEPS.length;
const english = TOUR_LABELS.en;
// What each data-tour anchor must sit on: the named part of the page is the anchored element or inside it. Every step of the
// Antidetect tour must be found by its anchor (the Proxy step moved to the Proxy tour, ADR-111).
const ANCHOR_CONTENT = { levels: '[role="tab"]', generator: '[data-profile-preset]', region: '[data-profile-region]', hints: '[data-profile-option]', library: '[data-profile-library-status]', apply: '[data-profile-apply]', master: '[data-antidetect-master]' };
const PENDING_ANCHORS = new Set([]);
const KEY_OF_STEP = Object.fromEntries(TOUR_STEPS.map(step => [step.id, step.target]));
const anchored = id => !PENDING_ANCHORS.has(KEY_OF_STEP[id]);

// Everything about the step on screen, read in one go. Null when no popover is open.
const observe = () => evaluate(({ selectors, content, keyOf }) => {
  const popover = document.querySelector('[data-ui-tour-popover]');
  if (!popover) return null;
  const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  const visible = element => { if (!element || !element.isConnected || element.closest('[hidden],[inert],[aria-hidden="true"]')) return false; const s = getComputedStyle(element); if (s.display === 'none' || s.visibility === 'hidden') return false; const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const id = popover.dataset.uiTourStep, ring = document.querySelector('[data-ui-tour-ring]'), scrim = document.querySelector('[data-ui-tour-scrim]');
  let target = null, via = -1; for (const [position, selector] of (selectors[id] ?? []).entries()) { target = [...document.querySelectorAll(selector)].find(visible) ?? null; if (target) { via = position; break; } }
  const wanted = content[keyOf[id]], anchorHas = via === 0 && wanted ? Boolean(target.matches(wanted) || target.querySelector(wanted)) : null;
  const textOfIds = ids => (ids ?? '').split(' ').filter(Boolean).map(token => document.getElementById(token)?.textContent ?? null);
  const active = document.activeElement, root = document.documentElement, shell = document.querySelector('[data-management-shell]');
  const ancestors = []; for (let node = shell; node; node = node.parentElement) ancestors.push({ tag: node.tagName, inert: node.inert === true, hidden: node.getAttribute('aria-hidden') });
  const search = document.querySelector('[data-management-search]'), searchBox = search ? search.getBoundingClientRect() : null;
  const hit = searchBox && searchBox.width > 0 ? document.elementFromPoint(searchBox.left + searchBox.width / 2, searchBox.top + searchBox.height / 2) : null;
  const popoverBox = box(popover);
  return {
    id, mode: popover.dataset.uiTourMode, ready: popover.dataset.uiTourReady, busy: popover.getAttribute('aria-busy') === 'true', role: popover.getAttribute('role'), ariaModal: popover.getAttribute('aria-modal'), tabIndex: popover.tabIndex,
    title: popover.querySelector('[data-ui-tour-title]')?.textContent ?? null, body: popover.querySelector('[data-ui-tour-body]')?.textContent ?? null, counter: popover.querySelector('[data-ui-tour-counter]')?.textContent ?? null,
    eyebrow: popover.querySelector('.ui-tour__eyebrow-text')?.textContent ?? null, labelledBy: textOfIds(popover.getAttribute('aria-labelledby')), describedBy: textOfIds(popover.getAttribute('aria-describedby')),
    buttons: [...popover.querySelectorAll('button')].map(button => ({ kind: button.hasAttribute('data-ui-tour-skip') ? 'skip' : button.hasAttribute('data-ui-tour-back') ? 'back' : button.hasAttribute('data-ui-tour-next') ? 'next' : 'other', text: button.textContent, disabled: button.getAttribute('aria-disabled') === 'true', rect: box(button) })),
    skipped: [...popover.querySelectorAll('[data-ui-tour-skipped-step]')].map(item => ({ id: item.dataset.uiTourSkippedStep, text: item.textContent })),
    focus: { insidePopover: popover.contains(active), onPopover: active === popover, onNext: Boolean(active?.hasAttribute?.('data-ui-tour-next')), tag: active?.tagName ?? null, start: Boolean(active?.hasAttribute?.('data-ui-tour-start')), search: active === search },
    popover: popoverBox, ring: ring ? box(ring) : null, scrim: Boolean(scrim), target: target ? box(target) : null, targetFound: Boolean(target), targetVia: via, anchorHas,
    viewport: { width: root.clientWidth, height: root.clientHeight, overflow: root.scrollWidth > root.clientWidth + 1 }, scrollY: Math.round(scrollY), direction: getComputedStyle(popover).direction, lang: shell?.lang ?? null,
    live: document.querySelector('[data-ui-announcer="polite"]')?.textContent ?? '', shell: { inert: ancestors.some(node => node.inert), ariaHidden: ancestors.some(node => node.hidden === 'true'), shellInert: shell?.inert === true,
      panelInert: document.querySelector('[data-management-panel="' + (shell?.dataset.managementActive ?? '') + '"]')?.inert === true },
    shield: { present: Boolean(document.querySelector('.ui-tour__shield')), searchBlocked: hit ? hit.classList.contains('ui-tour__shield') : null, searchCoveredByPopover: hit ? popover.contains(hit) : null },
    rawKeys: /tour_[a-z]/.test(popover.textContent), view: { section: shell?.dataset.managementActive ?? null, level: document.querySelector('[data-antidetect-category][aria-selected="true"]')?.dataset.antidetectCategory ?? null },
  };
}, { selectors: TARGET_SELECTORS, content: ANCHOR_CONTENT, keyOf: KEY_OF_STEP });
const stable = async () => { let last = null; for (let attempt = 0; attempt < 30; attempt++) { const now = await observe(); const key = now && JSON.stringify([now.ring, now.popover, now.ready, now.scrollY]); if (now && now.ready === 'true' && key === last) return now; last = key; await pause(120); } return observe(); };
const waitStep = async (id, label = id) => { await until(async () => { const now = await observe(); return now && now.id === id && now.ready === 'true' && !now.busy; }, 'step ' + label); return stable(); };
const waitClosed = async label => { await until(async () => !(await evaluate(() => Boolean(document.querySelector('[data-ui-tour]')))), 'tour closed ' + label); await pause(450); };
const tourState = () => evaluate(key => localStorage.getItem(key), TOUR_STORAGE_KEY);
// The page reads the stored progress again on a storage event (that is how another Options window is followed), so a change made here is announced the same way.
const setTourState = value => evaluate(({ key, value }) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); window.dispatchEvent(new StorageEvent('storage', { key, newValue: value, storageArea: localStorage })); }, { key: TOUR_STORAGE_KEY, value });
const openAt = async index => { await setTourState(index === 0 ? null : stateText(false, index)); await evaluate(() => document.querySelector('[data-ui-tour-start="header"][data-tour-for="antidetect"]').click()); return waitStep(STEP_IDS[index], 'open at ' + index); };
const stateText = (completed, lastStep) => JSON.stringify({ version: 2, tours: { antidetect: { completed, lastStep } } });
const setLanguage = async locale => { await evaluate(locale => (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-language-v1': locale }), locale); await until(() => evaluate(locale => document.querySelector('[data-management-shell]')?.lang === locale.replaceAll('_', '-') || document.documentElement.lang.startsWith(locale.split('_')[0]), locale), 'language ' + locale); await pause(250); };
const readyAntidetect = () => until(() => evaluate(() => document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy') === 'false' && Boolean(document.querySelector('[data-antidetect-master]'))), 'Antidetect loaded');
const focusSelector = selector => evaluate(selector => { const element = document.querySelector(selector); if (!element) throw Error('missing ' + selector); element.focus(); return document.activeElement === element; }, selector);
const hideTargets = ids => evaluate(({ ids, selectors }) => { const style = document.createElement('style'); style.id = 'tour-test-hide'; style.textContent = ids.flatMap(id => selectors[id]).map(selector => selector + ' { display: none !important; }').join('\n'); document.head.append(style); }, { ids, selectors: TARGET_SELECTORS });
const showTargets = () => evaluate(() => document.getElementById('tour-test-hide')?.remove());
const ringProblems = (now, pad = 6) => {
  if (!now.ring || !now.target) return ['ring or target missing'];
  const vw = now.viewport.width, vh = now.viewport.height, t = now.target, problems = [];
  const left = Math.max(2, t.left - pad), top = Math.max(2, t.top - pad), right = Math.min(vw - 2, t.right + pad), bottom = Math.min(vh - 2, t.bottom + pad);
  for (const [name, got, want] of [['left', now.ring.left, left], ['top', now.ring.top, top], ['right', now.ring.right, right], ['bottom', now.ring.bottom, bottom]]) if (Math.abs(got - want) > 3) problems.push(name + ' ' + got.toFixed(1) + ' vs ' + want.toFixed(1));
  return problems;
};
const insideViewport = (box, now, slack = 1) => box.left >= -slack && box.top >= -slack && box.right <= now.viewport.width + slack && box.bottom <= now.viewport.height + slack;
// A long text may scroll inside the popover; the buttons must not scroll away with it (they are fully inside the popover's visible box and the window).
const clippedButtons = now => now.buttons.filter(button => button.rect.top < now.popover.top - 1 || button.rect.bottom > now.popover.bottom + 1 || button.rect.left < now.popover.left - 1 || button.rect.right > now.popover.right + 1 || button.rect.top < -1 || button.rect.bottom > now.viewport.height + 1).map(button => button.kind);
const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;

// Contrast of computed colours (WCAG 2.2): parses rgb()/rgba() strings read from the page.
const channels = value => (value.match(/[\d.]+/gu) ?? []).slice(0, 4).map(Number);
const luminance = ([r, g, b]) => { const [x, y, z] = [r, g, b].map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
const contrast = (a, b) => { const [high, low] = [luminance(channels(a)), luminance(channels(b))].sort((m, n) => n - m); return (high + 0.05) / (low + 0.05); };

// ---- the run ----------------------------------------------------------------------------------------------------------------------------
let phase = 'startup';
try {
  evidence.consoleErrors = [];
  opened = await launch(); evidence.version = opened.version;
  await opened.bringToFront();
  await opened.goto(opened.base + 'options.html#antidetect');
  await until(() => evaluate(() => Boolean(document.querySelector('[data-management-shell]'))), 'management shell');
  await readyAntidetect(); await pause(800);
  // In-page guards: console errors, and a log of every storage write, message type and network start, kept until read.
  await evaluate(() => {
    const api = globalThis.browser ?? globalThis.chrome, log = window.__tourLog = { errors: [], writes: [], messages: [], network: [] };
    window.addEventListener('error', event => log.errors.push('error ' + event.message)); window.addEventListener('unhandledrejection', event => log.errors.push('rejection ' + String(event.reason?.message ?? event.reason)));
    const original = console.error; console.error = (...args) => { log.errors.push('console ' + args.map(String).join(' ').slice(0, 200)); return original.apply(console, args); };
    for (const area of ['local', 'session', 'sync', 'managed']) for (const method of ['set', 'remove', 'clear']) { const target = api.storage?.[area]; if (target && typeof target[method] === 'function') { const fn = target[method]; target[method] = function (...args) { log.writes.push(area + '.' + method); return fn.apply(this, args); }; } }
    const send = api.runtime.sendMessage; api.runtime.sendMessage = function (...args) { log.messages.push(String(args[0]?.type ?? typeof args[0])); return send.apply(this, args); };
    const nativeFetch = window.fetch; window.fetch = function (...args) { log.network.push('fetch'); return nativeFetch.apply(this, args); };
    const open = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (...args) { log.network.push('xhr'); return open.apply(this, args); };
    const NativeSocket = window.WebSocket; window.WebSocket = function (...args) { log.network.push('websocket'); return new NativeSocket(...args); };
    const beacon = navigator.sendBeacon?.bind(navigator); if (beacon) navigator.sendBeacon = (...args) => { log.network.push('beacon'); return beacon(...args); };
  });
  const snapshotStorage = () => evaluate(async () => { const api = globalThis.browser ?? globalThis.chrome; return { local: await api.storage.local.get(null), session: api.storage.session ? await api.storage.session.get(null) : {}, web: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])) }; });
  const resetLog = () => evaluate(() => { const log = window.__tourLog; const copy = { errors: [...log.errors], writes: [...log.writes], messages: [...log.messages], network: [...log.network] }; log.errors.length = 0; log.writes.length = 0; log.messages.length = 0; log.network.length = 0; return copy; });
  await setTourState(null);

  // ---- baseline: the same moves without the tour (what the app itself reads while sections change) ---------------------------------
  phase = 'baseline navigation';
  await resetLog();
  for (const hash of ['#antidetect', '#proxy', '#antidetect']) { await evaluate(hash => { location.hash = hash; }, hash); await pause(900); }
  await evaluate(() => document.querySelector('[data-antidetect-category="os"]')?.click()); await pause(500);
  await evaluate(() => document.querySelector('[data-antidetect-category="quick"]')?.click()); await pause(500);
  const baseline = await resetLog(); evidence.phases.baseline = { messages: [...new Set(baseline.messages)], writes: baseline.writes };
  await readyAntidetect();

  // ---- listeners: nothing is left behind after a run (Chromium: the debugger's own list) --------------------------------------------
  const listenerCounts = async () => { const client = await opened.cdp(); if (!client) return null; const counts = {}; for (const expression of ['window', 'document']) { const { result } = await client.send('Runtime.evaluate', { expression }); const { listeners } = await client.send('DOMDebugger.getEventListeners', { objectId: result.objectId }); for (const listener of listeners) counts[expression + '.' + listener.type + (listener.useCapture ? '(capture)' : '')] = (counts[expression + '.' + listener.type + (listener.useCapture ? '(capture)' : '')] ?? 0) + 1; } return counts; };
  const listenersBefore = await listenerCounts();
  const storageBefore = await snapshotStorage(); await resetLog();

  // ---- 1. open from the checklist with the keyboard, go through every step with Right arrow ---------------------------------------
  phase = 'checklist entry and forward walk';
  const checklistButton = await evaluate(() => Boolean(document.querySelector('[data-ui-tour-start="checklist"]')));
  const entry = checklistButton ? '[data-ui-tour-start="checklist"]' : '[data-ui-tour-start="header"][data-tour-for="antidetect"]';
  evidence.entry = entry;
  assert.equal(await focusSelector(entry), true); await press('Enter');
  const seen = [];
  for (let index = 0; index < TOTAL; index++) {
    const id = STEP_IDS[index], now = await waitStep(id), copy = english;
    seen.push(now);
    assert.equal(now.role, 'dialog'); assert.equal(now.ariaModal, 'false', id + ': a non-modal dialog'); assert.equal(now.tabIndex, -1);
    assert.deepEqual(now.labelledBy, [copy['step_' + id + '_title']], id + ': the dialog is named by its title');
    assert.deepEqual(now.describedBy, [copy.step_label.replace('{n}', index + 1).replace('{total}', TOTAL), copy['step_' + id + '_body']], id + ': described by the step and its text');
    assert.equal(now.title, copy['step_' + id + '_title']); assert.equal(now.body, copy['step_' + id + '_body']); assert.equal(now.counter, (index + 1) + ' / ' + TOTAL); assert.equal(now.eyebrow, copy.eyebrow);
    assert.ok(!now.rawKeys, id + ': no raw message key on screen');
    const kinds = now.buttons.map(button => button.kind); assert.deepEqual(kinds, index === 0 ? ['skip', 'next'] : index === TOTAL - 1 ? ['back', 'next'] : ['skip', 'back', 'next'], id + ': Skip, Back, Next/Done where they belong');
    assert.equal(now.buttons.at(-1).text, index === TOTAL - 1 ? copy.done : copy.next); assert.equal(now.scrim, false); assert.equal(now.targetFound, true, id + ': the target exists');
    assert.deepEqual(ringProblems(now), [], id + ': the ring sits on the real target');
    if (anchored(id)) { assert.equal(now.targetVia, 0, id + ': the ring sits on the element that carries data-tour="' + KEY_OF_STEP[id] + '", not on an older hook'); assert.equal(now.anchorHas, true, id + ': the anchor sits on the intended part of the page'); }
    assert.ok(insideViewport(now.popover, now, 1), id + ': the popover is inside the window ' + JSON.stringify(now.popover));
    assert.ok(now.target.bottom > 0 && now.target.top < now.viewport.height, id + ': the target is scrolled into view');
    if (now.mode === 'float') assert.equal(overlaps(now.popover, now.ring), false, id + ': the popover does not cover the ring');
    assert.equal(now.focus.insidePopover, true, id + ': focus is inside the popover'); assert.equal(now.viewport.overflow, false);
    assert.deepEqual(now.shell, { inert: false, ariaHidden: false, shellInert: false, panelInert: false }, id + ': nothing behind the popover is inert or hidden');
    assert.equal(now.shield.present, true); if (now.shield.searchCoveredByPopover !== true) assert.equal(now.shield.searchBlocked, true, id + ': a stray click on the page cannot land');
    if (index > 0) assert.ok(now.live.includes(copy.step_label.replace('{n}', index + 1).replace('{total}', TOTAL) + ': ' + copy['step_' + id + '_title']) && now.live.includes(copy['step_' + id + '_body']), id + ': announced through the live region: ' + now.live.slice(0, 80));
    assert.deepEqual(now.skipped, [], id + ': nothing skipped yet');
    if (index === 0) assert.equal(now.focus.onPopover, true, 'the first step puts focus on the dialog itself');
    evidence.steps.push({ id, view: now.view, mode: now.mode, ring: now.ring, popover: now.popover, target: now.target, focus: now.focus, scrollY: now.scrollY });
    if (index === 1) { // back and forth: Left arrow returns, the first step has no Back
      await press('ArrowLeft'); const back = await waitStep(STEP_IDS[0]); assert.equal(back.counter, '1 / ' + TOTAL); assert.equal(back.focus.insidePopover, true);
      await press('ArrowLeft'); await pause(300); assert.equal((await observe()).id, STEP_IDS[0], 'Left arrow on the first step does nothing'); await press('ArrowRight'); await waitStep(STEP_IDS[1]);
    }
    if (index === 3) { // Tab cycles inside the popover and never leaves it
      const order = []; for (let key = 0; key < 6; key++) { await press('Tab'); order.push(await evaluate(() => { const a = document.activeElement; return a?.hasAttribute('data-ui-tour-skip') ? 'skip' : a?.hasAttribute('data-ui-tour-back') ? 'back' : a?.hasAttribute('data-ui-tour-next') ? 'next' : a?.hasAttribute('data-ui-tour-popover') ? 'popover' : 'OUTSIDE ' + a?.tagName; })); }
      assert.ok(!order.some(name => name.startsWith('OUTSIDE')), 'Tab stays inside: ' + order.join(',')); assert.deepEqual(order.slice(0, 4), ['skip', 'back', 'next', 'skip'], 'Tab wraps from the last button to the first: ' + order.join(','));
      const kindOfActive = () => evaluate(() => { const a = document.activeElement; return a?.hasAttribute('data-ui-tour-skip') ? 'skip' : a?.hasAttribute('data-ui-tour-back') ? 'back' : a?.hasAttribute('data-ui-tour-next') ? 'next' : a?.hasAttribute('data-ui-tour-popover') ? 'popover' : 'OUTSIDE ' + a?.tagName; });
      const backwards = []; for (let key = 0; key < 3; key++) { await press('Shift+Tab'); backwards.push(await kindOfActive()); }
      assert.deepEqual(backwards, ['back', 'skip', 'next'], 'Shift+Tab walks back and wraps from the first button to the last: ' + backwards.join(','));
      await evaluate(() => document.querySelector('[data-ui-tour-popover]').focus()); // arrows work from the dialog frame
    }
    if (index < TOTAL - 1) { await press('ArrowRight'); }
  }
  evidence.phases.forward = { steps: seen.length, anchors: Object.fromEntries(seen.map(now => [KEY_OF_STEP[now.id], now.targetVia === 0 ? 'data-tour anchor' : 'older hook ' + now.targetVia])) };
  check('opened from the first-run checklist with Enter; ' + TOTAL + ' steps reached with the Right arrow, each with its ring on the real target (the element that carries its data-tour anchor), a popover fully inside the window, focus inside it, a live-region announcement, and nothing behind it inert or hidden');
  check('Left arrow goes back (nothing before step 1); Tab and Shift+Tab cycle inside the popover and never reach the page behind');

  // ---- 2. Enter on Done closes; focus and view return to the invoker; the state says completed ------------------------------------------
  phase = 'finish';
  const last = await observe(); assert.equal(last.buttons.at(-1).text, english.done);
  await evaluate(() => document.querySelector('[data-ui-tour-next]').focus()); await press('Enter'); await waitClosed('done');
  const afterDone = await evaluate(entry => ({ view: document.querySelector('[data-management-shell]').dataset.managementActive, level: document.querySelector('[data-antidetect-category][aria-selected="true"]')?.dataset.antidetectCategory, onInvoker: document.activeElement === document.querySelector(entry), live: document.querySelector('[data-ui-announcer="polite"]')?.textContent ?? '', popover: Boolean(document.querySelector('[data-ui-tour-popover]')) }), entry);
  assert.deepEqual([afterDone.view, afterDone.level, afterDone.onInvoker, afterDone.popover], ['antidetect', 'quick', true, false], 'back on the page it began on, focus on the button that opened the tour');
  assert.ok(afterDone.live.includes(english.finished), 'the end is announced: ' + afterDone.live);
  assert.equal(await tourState(), stateText(true, 0)); check('Enter on Done closes the tour, announces the end, returns the page to where it began and focus to the invoker, and stores { completed: true, lastStep: 0 }');

  // ---- 3. nothing but the tour state changed; no network; no write; only messages plain navigation also sends ---------------------------
  phase = 'side effects';
  const log = await resetLog(), storageAfter = await snapshotStorage();
  assert.deepEqual(storageAfter.local, storageBefore.local, 'chrome.storage.local is byte-for-byte unchanged'); assert.deepEqual(storageAfter.session, storageBefore.session, 'storage.session unchanged');
  const webBefore = { ...storageBefore.web }, webAfter = { ...storageAfter.web }; delete webAfter[TOUR_STORAGE_KEY]; assert.deepEqual(webAfter, webBefore, 'localStorage changed in no key but ui-tour:v1'); assert.equal(storageAfter.web[TOUR_STORAGE_KEY], stateText(true, 0));
  assert.deepEqual(log.writes, [], 'the tour wrote through no extension storage API'); assert.deepEqual(log.network, [], 'no fetch, request, socket or beacon');
  const extra = [...new Set(log.messages)].filter(type => !evidence.phases.baseline.messages.includes(type)); assert.deepEqual(extra, [], 'no message type that plain navigation does not also send');
  assert.deepEqual(log.errors, [], 'no script error, rejection or console error'); evidence.phases.sideEffects = { messages: [...new Set(log.messages)], writes: log.writes };
  check('storage.local and storage.session are unchanged and localStorage differs only by ui-tour:v2; no storage write, no network start, no message type beyond what plain navigation sends; no console error');
  const listenersAfter = await listenerCounts();
  if (listenersBefore && listenersAfter) { assert.deepEqual(listenersAfter, listenersBefore, 'window and document listeners are exactly what they were before the tour'); check('window and document event listeners (CDP) are identical before the tour and after it closed'); }
  else evidence.limits.push('listener counts need the Chromium debugger; not measured in Firefox');

  // ---- 4. palette command, Esc, Resume, view restore ------------------------------------------------------------------------------------
  phase = 'palette, Esc, Resume';
  await evaluate(() => document.querySelector('[data-antidetect-category="network"]').click()); await pause(400);
  assert.equal(await focusSelector('[data-management-search]'), true); await press('Control+K');
  await until(() => evaluate(() => Boolean(document.querySelector('dialog[open] [data-command-palette-input]'))), 'palette open');
  for (const key of ['t', 'o', 'u', 'r']) await press(key);
  const option = await until(() => evaluate(() => document.querySelector('dialog[open] [role="option"]')?.textContent ?? null), 'palette result');
  assert.ok(option.includes(english.start), 'the palette finds the tour by typing: ' + option); assert.equal(await tourState(), stateText(true, 0)); await press('Enter');
  await waitStep(STEP_IDS[0]); await press('ArrowRight'); await waitStep(STEP_IDS[1]); await press('ArrowRight'); const third = await waitStep(STEP_IDS[2]);
  assert.deepEqual([third.view.section, third.view.level], ['antidetect', 'os'], 'the tour moved to the OS level for the Region step');
  await press('Escape'); await waitClosed('esc');
  const afterEsc = await evaluate(() => ({ level: document.querySelector('[data-antidetect-category][aria-selected="true"]')?.dataset.antidetectCategory, onSearch: document.activeElement === document.querySelector('[data-management-search]'), popover: Boolean(document.querySelector('[data-ui-tour-popover]')), live: document.querySelector('[data-ui-announcer="polite"]')?.textContent ?? '' }));
  assert.deepEqual([afterEsc.level, afterEsc.onSearch, afterEsc.popover], ['network', true, false], 'Esc closed the tour, restored the Network level and gave focus back to what had it before the palette');
  assert.ok(afterEsc.live.includes(english.closed)); assert.equal(await tourState(), stateText(true, 2), 'a replay stopped at step 3 keeps completed and remembers the step');
  check('Ctrl+K, typing "tour" and Enter start the tour; Esc at step 3 closes it, restores the level and the focus the page had, announces it and stores the step');
  assert.equal(await focusSelector('[data-management-search]'), true); await press('Control+K');
  await until(() => evaluate(() => Boolean(document.querySelector('dialog[open] [data-command-palette-input]'))), 'palette open again');
  for (const key of ['t', 'o', 'u', 'r']) await press(key);
  const resumeOption = await until(() => evaluate(() => document.querySelector('dialog[open] [role="option"]')?.textContent ?? null), 'palette resume result');
  assert.ok(resumeOption.includes(english.resume), 'the palette now offers Resume: ' + resumeOption); await press('Enter');
  const resumed = await waitStep(STEP_IDS[2]); assert.equal(resumed.counter, '3 / ' + TOTAL, 'Resume continues at the stored step');
  await press('Escape'); await waitClosed('resume esc'); await setTourState(stateText(false, 3));
  const hint = await evaluate(() => document.querySelector('[data-ui-tour-entry="checklist"] .ui-tour-entry__hint')?.textContent ?? null);
  if (checklistButton) assert.equal(hint, english.resume_hint.replace('{n}', '4').replace('{total}', String(TOTAL)), 'the checklist block says where it stopped');
  check('the palette offers Resume after an interruption and continues at the stored step; the checklist block names the step and offers Start over');
  await focusSelector('[data-ui-tour-start="header"][data-tour-for="antidetect"]'); await press('Enter'); const link = await waitStep(STEP_IDS[3]); assert.equal(link.counter, '4 / ' + TOTAL, 'the header button resumes too');
  await press('Escape'); await waitClosed('link'); assert.equal(await evaluate(() => document.activeElement?.getAttribute('data-ui-tour-start')), 'header', 'focus returns to the header button');
  await setTourState(null);

  // ---- 5. a part that is not there: the step is skipped and says so --------------------------------------------------------------------------
  phase = 'skipped steps';
  await hideTargets(['region']);
  await focusSelector('[data-ui-tour-start="header"][data-tour-for="antidetect"]'); await press('Enter'); await waitStep(STEP_IDS[0]); await press('ArrowRight'); await waitStep(STEP_IDS[1]); await press('ArrowRight');
  const skipped = await waitStep(STEP_IDS[3]); assert.equal(skipped.counter, '4 / ' + TOTAL, 'the counter shows the real position');
  assert.deepEqual(skipped.skipped.map(row => row.id), ['region']); assert.equal(skipped.skipped[0].text, english.skipped.replace('{title}', english.step_region_title));
  assert.ok(skipped.live.includes(english.skipped.replace('{title}', english.step_region_title)), 'the skip is announced with the step: ' + skipped.live.slice(-90));
  await press('ArrowLeft'); const backOver = await waitStep(STEP_IDS[1]); assert.equal(backOver.skipped.map(row => row.id).join(), 'region', 'Back skips the missing step in the other direction too');
  await press('ArrowRight'); await waitStep(STEP_IDS[3]); await press('Escape'); await waitClosed('skip'); await showTargets();
  await hideTargets(['levels']); await setTourState(null);
  await focusSelector('[data-ui-tour-start="header"][data-tour-for="antidetect"]'); await press('Enter'); const firstMissing = await waitStep(STEP_IDS[1]);
  assert.equal(firstMissing.counter, '2 / ' + TOTAL); assert.deepEqual(firstMissing.skipped.map(row => row.id), ['levels'], 'a missing first part is skipped with a note'); assert.equal(firstMissing.focus.onPopover, true);
  assert.ok(firstMissing.live.includes(english.skipped.replace('{title}', english.step_levels_title)), 'the note about the skipped first step is announced (the dialog itself carries the step text): ' + firstMissing.live.slice(0, 100));
  await press('Escape'); await waitClosed('first missing'); await showTargets(); await setTourState(null);
  // Without any data-tour anchor the registry of older hooks finds every target by itself. Anchors of parts that mount later (another level) are stripped as they appear.
  await evaluate(() => {
    const strip = node => { if (node.nodeType !== 1) return; node.removeAttribute('data-tour'); for (const element of node.querySelectorAll('[data-tour]')) element.removeAttribute('data-tour'); };
    strip(document.documentElement);
    window.__tourAnchorStripper = new MutationObserver(records => { for (const record of records) { if (record.type === 'attributes') strip(record.target); for (const node of record.addedNodes) strip(node); } });
    window.__tourAnchorStripper.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tour'] });
  });
  await focusSelector('[data-ui-tour-start="header"][data-tour-for="antidetect"]'); await press('Enter'); await waitStep(STEP_IDS[0]);
  for (let index = 1; index < TOTAL; index++) { await press('ArrowRight'); const now = await waitStep(STEP_IDS[index]); assert.deepEqual(now.skipped, [], STEP_IDS[index] + ': found through the fallback selectors'); assert.equal(now.targetFound, true); assert.ok(now.targetVia > 0, STEP_IDS[index] + ': with its anchor gone an older hook finds it (' + now.targetVia + ')'); assert.deepEqual(ringProblems(now), []); }
  await press('Escape'); await waitClosed('fallback');
  await evaluate(() => { window.__tourAnchorStripper?.disconnect(); }); await opened.goto(opened.base + 'options.html#antidetect'); await readyAntidetect(); await pause(800); // the anchors are back
  check('a missing target skips its step with a visible and announced "not available here" note (forward, backward, and as the very first step); the counter stays truthful; with every data-tour anchor removed all steps are still found by the older hooks');

  // ---- 6. focus stays reachable for assistive technology; a stray click is absorbed; the palette over the tour keeps its own Esc -----------
  phase = 'page access';
  await setTourState(null); await focusSelector('[data-ui-tour-start="header"][data-tour-for="antidetect"]'); await press('Enter'); await waitStep(STEP_IDS[0]);
  const reach = await evaluate(() => { const search = document.querySelector('[data-management-search]'); search.focus(); const focused = document.activeElement === search; return { focused, inert: document.querySelector('[data-management-shell]').inert, shield: document.querySelector('.ui-tour__shield') !== null }; });
  assert.deepEqual(reach, { focused: true, inert: false, shield: true }, 'the page behind can still take focus programmatically, as a screen reader would');
  // A real mouse click on the page behind the tour (the header search button) is absorbed: nothing opens, the focus stays in the popover.
  const center = await evaluate(() => { const box = document.querySelector('[data-management-search]').getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; });
  await evaluate(() => document.querySelector('[data-ui-tour-popover]').focus()); await resetLog(); await opened.click(center.x, center.y); await pause(500);
  const stray = await evaluate(() => ({ palette: Boolean(document.querySelector('dialog[open] [data-command-palette-input]')), tour: Boolean(document.querySelector('[data-ui-tour-popover]')), focusInside: Boolean(document.querySelector('[data-ui-tour-popover]')?.contains(document.activeElement)) }));
  assert.deepEqual(stray, { palette: false, tour: true, focusInside: true }, 'a real mouse click on the page behind the tour does nothing and leaves the focus in the popover'); assert.deepEqual((await resetLog()).writes, []);
  await press('Control+K'); await until(() => evaluate(() => Boolean(document.querySelector('dialog[open] [data-command-palette-input]'))), 'palette over the tour'); await press('Escape'); await pause(400);
  assert.equal(await evaluate(() => Boolean(document.querySelector('dialog[open] [data-command-palette-input]'))), false, 'Esc closed the palette');
  assert.equal(await evaluate(() => Boolean(document.querySelector('[data-ui-tour-popover]'))), true, 'and left the tour open');
  await evaluate(() => document.querySelector('[data-ui-tour-popover]').focus()); await press('Escape'); await waitClosed('page access');
  check('the page behind a running tour is not inert or hidden and still takes focus, while a real mouse click on it is absorbed; the command palette opened over the tour closes with its own Esc and leaves the tour running');

  // ---- 7. languages: every text really arrives, direction follows the language ---------------------------------------------------------------
  phase = 'languages';
  const sweep = [];
  for (const language of PRODUCTION_LANGUAGES) {
    const locale = language.id, copy = TOUR_LABELS[locale], rtl = ['ar', 'ur'].includes(locale);
    await setLanguage(locale);
    const lengthOf = id => (copy['step_' + id + '_title'] + copy['step_' + id + '_body']).length, longest = STEP_IDS.reduce((best, id, index) => lengthOf(id) > lengthOf(STEP_IDS[best]) ? index : best, 0);
    for (const index of [...new Set([0, 4, TOTAL - 1, longest])]) {
      await setTourState(index === 0 ? null : stateText(false, index));
      await evaluate(() => document.querySelector('[data-ui-tour-start="header"][data-tour-for="antidetect"]').click());
      const now = await waitStep(STEP_IDS[index], locale + ':' + STEP_IDS[index]);
      assert.equal(now.title, copy['step_' + STEP_IDS[index] + '_title'], locale + ' title'); assert.equal(now.body, copy['step_' + STEP_IDS[index] + '_body'], locale + ' body'); assert.equal(now.eyebrow, copy.eyebrow);
      assert.deepEqual(now.describedBy, [copy.step_label.replace('{n}', index + 1).replace('{total}', TOTAL), copy['step_' + STEP_IDS[index] + '_body']], locale + ' described by');
      assert.equal(now.buttons.at(-1).text, index === TOTAL - 1 ? copy.done : copy.next, locale + ' next/done'); if (index < TOTAL - 1) assert.equal(now.buttons[0].text, copy.skip, locale + ' skip');
      assert.ok(!now.rawKeys, locale + ': no raw key'); assert.equal(now.direction, rtl ? 'rtl' : 'ltr', locale + ' direction'); assert.deepEqual(ringProblems(now), [], locale + ' ring'); assert.ok(insideViewport(now.popover, now, 1), locale + ' popover inside');
      if (rtl && index === 0) { await press('ArrowLeft'); const mirrored = await waitStep(STEP_IDS[1], locale + ' mirrored'); assert.equal(mirrored.counter, '2 / ' + TOTAL, locale + ': in right-to-left text the Left arrow goes forward'); await press('ArrowRight'); await waitStep(STEP_IDS[0], locale + ' mirrored back'); }
      if (index === 4 || index === longest) { // narrow window: the popover docks, nothing overflows, the buttons stay in view
        await opened.viewport(340, 740); await pause(500); const narrow = await stable();
        assert.equal(narrow.mode, 'dock', locale + ': docked at 340 px'); assert.ok(insideViewport(narrow.popover, narrow, 1), locale + ' popover inside at 340 px ' + JSON.stringify(narrow.popover)); assert.equal(narrow.viewport.overflow, false, locale + ': no horizontal overflow at 340 px');
        assert.ok(narrow.popover.height <= 740 * 0.6 + 2, locale + ': the sheet leaves room for the page'); assert.deepEqual(clippedButtons(narrow), [], locale + ' step ' + STEP_IDS[index] + ': every button stays in view at 340 px even when a long text scrolls ' + JSON.stringify(narrow.buttons.map(button => [button.kind, Math.round(button.rect.top), Math.round(button.rect.bottom)])) + ' popover ' + JSON.stringify(narrow.popover)); await opened.viewport(1180, 900); await pause(400);
      }
      await press('Escape'); await waitClosed(locale + ' ' + index);
    }
    sweep.push(locale);
  }
  evidence.phases.languages = sweep; await setLanguage('en'); await setTourState(null);
  check('all ' + sweep.length + ' languages: title, text, buttons, step label and description arrive exactly as authored on the first, a long and the last step, with no raw key, the right direction (Left arrow forward in Arabic and Urdu), a docked sheet inside a 340 px window with every button still in view even for the longest text of the language, and no overflow');

  // ---- 8. themes, layouts, motion, forced colors, more contrast ----------------------------------------------------------------------------------
  phase = 'themes and layouts';
  await focusSelector('[data-ui-tour-start="header"][data-tour-for="antidetect"]'); await press('Enter'); await waitStep(STEP_IDS[0]); await press('ArrowRight'); await waitStep(STEP_IDS[1]);
  const palettes = [['system', 'system-light'], ['system', 'system-dark'], ['pearl', 'pearl'], ['aurora', 'aurora'], ['graphite', 'graphite'], ['orchid', 'orchid'], ['glass', 'glass']], ratios = {};
  for (const [theme, effective] of palettes) {
    await evaluate(({ theme, effective }) => { const root = document.documentElement; root.setAttribute('data-ui-theme', theme); root.setAttribute('data-ui-theme-effective', effective); }, { theme, effective });
    await pause(450); const now = await stable();
    const colors = await evaluate(() => { const p = document.querySelector('[data-ui-tour-popover]'), c = selector => getComputedStyle(p.querySelector(selector)); const next = p.querySelector('[data-ui-tour-next]');
      return { surface: getComputedStyle(p).backgroundColor, title: c('[data-ui-tour-title]').color, body: c('[data-ui-tour-body]').color, eyebrow: c('.ui-tour__eyebrow').color, counter: c('.ui-tour__counter').color, counterBg: c('.ui-tour__counter').backgroundColor, next: getComputedStyle(next).color, nextBg: getComputedStyle(next).backgroundColor, focus: getComputedStyle(p).outlineColor, ringShadow: getComputedStyle(document.querySelector('[data-ui-tour-ring]')).boxShadow }; });
    const row = { title: contrast(colors.title, colors.surface), body: contrast(colors.body, colors.surface), eyebrow: contrast(colors.eyebrow, colors.surface), counter: contrast(colors.counter, colors.counterBg), next: contrast(colors.next, colors.nextBg) };
    for (const [name, value] of Object.entries(row)) assert.ok(value >= 4.5, effective + ': ' + name + ' contrast ' + value.toFixed(2));
    assert.ok(colors.ringShadow.includes('rgb'), effective + ': the ring has its shadows'); assert.deepEqual(ringProblems(now), [], effective + ': the ring follows the target after a theme change'); assert.ok(insideViewport(now.popover, now, 1));
    ratios[effective] = Object.fromEntries(Object.entries(row).map(([name, value]) => [name, Number(value.toFixed(2))]));
  }
  // The language can change under a running tour: the same step is shown again in the new language, in the right direction, still aligned.
  for (const locale of ['de', 'ar', 'en']) {
    await setLanguage(locale); const switched = await stable(), copy = TOUR_LABELS[locale], at = STEP_IDS.indexOf(switched.id);
    assert.equal(switched.title, copy['step_' + switched.id + '_title'], locale + ': the title follows the language'); assert.equal(switched.body, copy['step_' + switched.id + '_body'], locale + ': the text follows the language');
    assert.equal(switched.counter, (at + 1) + ' / ' + TOUR_STEPS.length); assert.equal(switched.direction, locale === 'ar' ? 'rtl' : 'ltr'); assert.deepEqual(ringProblems(switched), [], locale + ': the ring is still on the target'); assert.ok(insideViewport(switched.popover, switched, 1), locale + ': popover inside');
  }
  evidence.phases.contrast = ratios;
  check('popover text, eyebrow, counter and primary button reach 4.5:1 in all seven computed palettes (switched while the tour was open; the ring re-measured each time); switching the language under a running tour re-renders the same step in German, Arabic (right-to-left) and English');
  for (const [width, height, label] of [[1180, 900, 'desktop'], [640, 450, '200% zoom equivalent'], [320, 640, '320 px']]) {
    await opened.viewport(width, height); await pause(500);
    for (const index of [1, 4, 6]) {
      await evaluate(() => document.querySelector('[data-ui-tour-popover]')?.focus()); await press('Escape'); await waitClosed('layout');
      const wanted = STEP_IDS[index]; await openAt(index);
      const shown = await stable();
      assert.ok(insideViewport(shown.popover, shown, 1), label + ' ' + wanted + ': popover inside ' + JSON.stringify([shown.popover, shown.viewport])); assert.equal(shown.viewport.overflow, false, label + ': no horizontal overflow'); assert.deepEqual(clippedButtons(shown), [], label + ' ' + wanted + ': every button stays in view');
      assert.equal(shown.mode, width < 640 ? 'dock' : shown.mode, label + ': narrow windows dock'); assert.equal(shown.ring !== null, true);
      if (shown.mode === 'dock') assert.ok(shown.ring.height <= 120 ? !overlaps(shown.ring, shown.popover) : shown.ring.top < shown.popover.top || shown.ring.bottom > shown.popover.bottom, label + ' ' + wanted + ': the docked sheet leaves a small target uncovered and part of a tall one ' + JSON.stringify([shown.ring, shown.popover]));
      if (shown.mode === 'dock') assert.ok(shown.popover.height <= height * 0.6 + 2, label + ': a docked sheet takes at most about 58% of the height');
    }
  }
  await opened.viewport(1180, 900); await pause(400);
  check('the popover stays inside the window without horizontal overflow at 1180, 640 (200% zoom of 1280) and 320 CSS px, its buttons always in view; below 640 px it docks to the bottom edge');
  if (browser === 'chrome') {
    await opened.media({ reducedMotion: 'reduce' }); await pause(200);
    const reduced = await evaluate(() => getComputedStyle(document.querySelector('[data-ui-tour-ring]')).transitionDuration);
    await opened.media({ reducedMotion: 'no-preference' }); await pause(200);
    const allowed = await evaluate(() => getComputedStyle(document.querySelector('[data-ui-tour-ring]')).transitionDuration);
    assert.equal(reduced, '0s', 'reduced motion: no transition'); assert.notEqual(allowed, '0s', 'normal motion: the ring glides (' + allowed + ')'); await opened.media({ reducedMotion: null });
    await opened.media({ forcedColors: 'active' }); await pause(300);
    const forced = await evaluate(() => { const ring = getComputedStyle(document.querySelector('[data-ui-tour-ring]')), popover = getComputedStyle(document.querySelector('[data-ui-tour-popover]')); return { shadow: ring.boxShadow, outlineStyle: ring.outlineStyle, outlineWidth: ring.outlineWidth, border: popover.borderTopStyle, borderWidth: popover.borderTopWidth }; });
    assert.equal(forced.shadow, 'none'); assert.equal(forced.outlineStyle, 'solid'); assert.equal(forced.outlineWidth, '4px'); assert.equal(forced.border, 'solid'); assert.equal(forced.borderWidth, '2px'); await opened.media({ forcedColors: 'none' });
    let more = null; try { await opened.media({ contrast: 'more' }); await pause(300); more = await evaluate(() => getComputedStyle(document.querySelector('[data-ui-tour-popover]')).borderTopWidth); await opened.media({ contrast: null }); } catch (error) { evidence.limits.push('prefers-contrast emulation is not available in this Playwright: ' + String(error.message).slice(0, 80)); }
    if (more !== null) assert.equal(more, '2px', 'more contrast: a 2 px frame');
    evidence.phases.media = { reduced, allowed, forced, more };
    check('reduced motion removes the ring transition; forced colors replace the shadows by a 4 px system-colour outline and a 2 px frame' + (more !== null ? '; prefers-contrast: more draws a 2 px frame' : ''));
  } else evidence.limits.push('media emulation (reduced motion, forced colors, more contrast) is Chromium-only here; Firefox is covered by the static stylesheet checks of ui-tour-css.test.mjs');
  await press('Escape'); await waitClosed('themes');

  // ---- 9. the tour never throws into a page that changes under it ------------------------------------------------------------------------------------
  phase = 'robustness';
  await setTourState(null); await focusSelector('[data-ui-tour-start="header"][data-tour-for="antidetect"]'); await press('Enter'); await waitStep(STEP_IDS[0]);
  // Scrolling the page moves the target under the ring; the ring follows it.
  await press('ArrowRight'); const beforeScroll = await waitStep(STEP_IDS[1]);
  for (const delta of [160, -320]) { await evaluate(delta => window.scrollBy(0, delta), delta); await pause(500); const moved = await stable(); assert.deepEqual(ringProblems(moved), [], 'the ring follows the target after the page scrolled by ' + delta); assert.notEqual(moved.scrollY, beforeScroll.scrollY, 'the page really scrolled'); }
  await press('ArrowLeft'); await waitStep(STEP_IDS[0]);
  await evaluate(() => { location.hash = '#hub'; }); await pause(900);
  const afterHash = await observe(); assert.ok(afterHash, 'the tour survives the person changing the section behind it'); await press('ArrowRight'); const recovered = await waitStep(STEP_IDS[1]); assert.equal(recovered.targetFound, true, 'and the next step navigates back by itself');
  await press('Escape'); await waitClosed('hash change');
  const final = await resetLog(); assert.deepEqual(final.errors, [], 'no error during the whole run: ' + final.errors.join(' | ')); assert.deepEqual(evidence.consoleErrors, [], 'no console error seen by the browser: ' + evidence.consoleErrors.join(' | '));
  check('the ring follows the target when the page is scrolled; changing the section under a running tour neither breaks it nor raises an error; the browser saw no console error in the whole run');
  evidence.result = 'PASS'; console.log('UI tour ' + browser + ' (' + evidence.version + '): ' + evidence.checks.length + ' checks PASS');
} catch (error) {
  evidence.result = 'FAIL'; evidence.phase = phase; evidence.error = error.stack ?? String(error); process.exitCode = 1;
  try { if (opened) await opened.screenshot(join(run, 'failure.png')); } catch { /* The browser may be gone. */ }
  console.error('FAIL ui tour ' + browser + ' in phase "' + phase + '": ' + (error.message ?? error));
} finally {
  if (!process.argv.includes('--no-evidence')) writeEvidence('ui-tour/' + browser + (mutation ? '-mutation' : '') + '.json', evidence);
  try { await closeBrowser(); } catch { /* Preserve the original result. */ }
  if (!keep && evidence.result === 'PASS') { try { rmSync(run, { recursive: true, force: true }); } catch { /* A locked browser file is cleaned by the next run. */ } }
}
