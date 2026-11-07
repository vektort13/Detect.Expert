// ADR-111: the header buttons and the guided tour of EVERY section of the Options UI, in a real browser, driven by real key presses:
//   node scripts/test/ui-tour-tabs-native.mjs [--firefox] [--dist] [--keep] [--no-evidence] [--no-screens] [--quick]
// Default: the extension is assembled from apps/production-extension into a private folder under .tmp (no build, no locale regeneration); --dist tests dist/<browser>.
//   --quick: two widths, three languages and no screenshots (a development run, not the evidence run).
// UI_TOUR_TABS_NATIVE_MUTATION='{"file":"ui-tour-steps.js","from":"...","to":"..."}' edits the assembled COPY only; the run is expected to FAIL then.
// What it proves, in Chromium and Firefox: on every section the compact Tour button sits in the header row, immediately before the module switch (or as the last item of a header
// without one), on one line with it, never overlapping a neighbour, with a short label that is only hidden (not removed) in narrow windows, at 2576, 1180, 520 and 340 px, left to right
// and right to left, with no horizontal overflow and no header shift; in the Firewall header (Chromium) the module draws the row and the button is its MIDDLE child (the shell's toolSlot), so title,
// Tour button, switch are in this order in the DOM, on the screen and for the Tab key (real key presses, Shift+Tab back, all 21 languages, 7 palettes, forced colors); the strips under the headers are gone and Refresh/Export keep working as icon-only tools; every tour runs through all
// its steps by the Right arrow (ring on the real, visible target, popover inside the window, focus inside it, announcement, nothing behind it inert), Left, Esc, Enter on Done and Resume
// work, focus returns to the header button, the progress is stored under ui-tour:v2 only, the tour changes no setting and sends nothing; the command palette offers the tour of the
// section on screen first; all 21 languages keep the header in one row; the button keeps its contrast in all seven palettes, in forced colors (Chromium) and under 200 % zoom.
// Screenshots for review (ru, en, ar; light, dark; wide, narrow) go to .tmp/ui-tour-header-screens/<browser>/. Screen readers are NOT tested: names, roles and live regions are checked, not speech.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { archiveProduction, FIREFOX_ID } from '../build-production.mjs';
import { stageExtension, writeEvidence, fileHashes } from './native-evidence.mjs';
import { TOURS, TOUR_IDS, TOUR_TARGETS, TOUR_STORAGE_KEY, TOUR_LEGACY_STORAGE_KEY } from '../../apps/production-extension/ui-tour.js';
import { TOUR_LABELS } from '../../apps/production-extension/ui-tour-labels.js';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome', fromDist = process.argv.includes('--dist'), keep = process.argv.includes('--keep');
const quick = process.argv.includes('--quick'), writeEvidenceFile = !process.argv.includes('--no-evidence'), takeScreens = !process.argv.includes('--no-screens') && !quick;
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/ui-tour-tabs-' + browser + '-')), extension = join(run, 'extension'), screens = join(root, '.tmp/ui-tour-header-screens', browser);
const evidence = { browser, run, at: new Date().toISOString(), packaging: null, result: 'RUNNING', checks: [], headers: {}, tours: {}, phases: {}, limits: [], screenshots: [] };
const check = text => { evidence.checks.push(text); console.log('  ok ' + text); };
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(probe, label, timeout = 20000) { const deadline = Date.now() + timeout; let last; while (Date.now() < deadline) { last = await probe(); if (last) return last; await pause(60); } throw Error('timeout: ' + label); }

// ---- the package under test ----------------------------------------------------------------------------------------------------------
const staged = await stageExtension({ browser, target: extension, from: fromDist ? 'dist' : 'source' });
evidence.packaging = staged.packaging;
const mutation = process.env.UI_TOUR_TABS_NATIVE_MUTATION ? JSON.parse(process.env.UI_TOUR_TABS_NATIVE_MUTATION) : null;
if (mutation) {
  const target = join(extension, mutation.file), text = readFileSync(target, 'utf8');
  assert.ok(text.includes(mutation.from), 'mutation anchor is missing in ' + mutation.file);
  writeFileSync(target, text.replace(mutation.from, mutation.to)); evidence.mutation = mutation;
}
evidence.hashes = fileHashes(extension, ['ui-tour.js', 'ui-tour-steps.js', 'ui-tour.css', 'ui-tour-labels.js', 'workspace-controls-ui.js', 'workspace-controls-ui.css', 'workspace-tool-icons.js', 'management-ui.js', 'management-hub.js', 'options.html']);

// ---- launching ------------------------------------------------------------------------------------------------------------------------
const KEYCODES = { Enter: 0xE007, Escape: 0xE00C, Tab: 0xE004, ArrowLeft: 0xE012, ArrowUp: 0xE013, ArrowRight: 0xE014, ArrowDown: 0xE015, Shift: 0xE008, Control: 0xE009, Alt: 0xE00A };
const webdriverKey = name => Object.hasOwn(KEYCODES, name) ? String.fromCodePoint(KEYCODES[name]) : name.length === 1 ? name.toLowerCase() : null;
let opened, closeBrowser = async () => {};
async function launch() {
  const profile = join(run, 'profile'); mkdirSync(profile, { recursive: true });
  if (browser === 'chrome') {
    const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: false, viewport: { width: 1180, height: 900 }, args: ['--window-position=-10000,-10000', '--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-first-run'] });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), base = new URL('.', worker.url()).href, page = await context.newPage();
    page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors?.push(message.text()); });
    page.on('pageerror', error => evidence.consoleErrors?.push('pageerror ' + error.message));
    closeBrowser = () => context.close();
    return { version: context.browser().version(), base, page, evaluate: (fn, value) => page.evaluate(fn, value), goto: url => page.goto(url), press: combo => page.keyboard.press(combo), click: (x, y) => page.mouse.click(x, y), move: (x, y) => page.mouse.move(x, y), down: () => page.mouse.down(), up: () => page.mouse.up(), viewport: (width, height) => page.setViewportSize({ width, height }),
      media: options => page.emulateMedia(options), screenshot: path => page.screenshot({ path }), bringToFront: () => page.bringToFront() };
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
    media: async () => {}, screenshot: async path => writeFileSync(path, Buffer.from(await wd('/screenshot', undefined, 'GET'), 'base64')), bringToFront: async () => {} };
}

// ---- page-side helpers ------------------------------------------------------------------------------------------------------------------
const evaluate = (fn, value) => opened.evaluate(fn, value);
const press = async combo => { await opened.press(combo); await pause(60); };
const ALL_STEPS = Object.values(TOURS).flat(), english = TOUR_LABELS.en;
const TARGET_SELECTORS = Object.fromEntries(ALL_STEPS.map(step => [step.id, ['[data-tour~="' + step.target + '"]', ...TOUR_TARGETS[step.target]]]));
const KEY_OF_STEP = Object.fromEntries(ALL_STEPS.map(step => [step.id, step.target]));
const PANEL = tab => '[data-management-panel="' + tab + '"]', HEADER_BUTTON = tab => PANEL(tab) + ' [data-ui-tour-start="header"]';
// Sections whose header button has not been added yet (none: cookies-ui.js draws the `tourButton` the shell hands it); Firefox has no Firewall module.
const PENDING_HEADER = new Set(), NO_TOUR_IN_FIREFOX = new Set(['firewall']);
const HASH = { firewall: 'protect' };
// The Detector is visited only in the last phase of the run. Leaving it used to throw in Firefox (`webNavigation.onCommitted.removeListener is not a function`; fixed in
// browser-adapter.js, covered by firefox-adapter.test.mjs), and the order is kept so that this run does not depend on that fix. Nothing is opened after it.
const VISIT_ORDER = TOUR_IDS.filter(tab => tab !== 'detector');
const READY = { hub: '[data-management-hub]', detector: '[data-detector-app] [data-observation-master]', api: '[data-api-configuration-editor] [data-protection-master]', firewall: '[data-workspace-master="firewall"] button', antidetect: '[data-antidetect-app][aria-busy="false"] [data-antidetect-master]',
  autosurf: '[data-autosurf-workspace] [data-autosurf-master]', cookies: '[data-cookies-workspace] [data-cookies-load]', proxy: '[data-proxy-workspace][aria-busy="false"] [data-proxy-master], [data-proxy-workspace][aria-busy="false"] [data-proxy-disconnect]', integrations: '[data-management-integrations] [data-api-precursor]',
  settings: 'form.scope', contacts: '[data-contacts-app] [data-contact-copy]', 'browser-debug': '[data-browser-debug] [data-browser-debug-export]' };
const openTab = async tab => {
  await evaluate(hash => { location.hash = '#' + hash; }, HASH[tab] ?? tab);
  try { await until(() => evaluate(({ panel, ready }) => { const element = document.querySelector(panel); return Boolean(element) && !element.hidden && Boolean(element.querySelector(ready)); }, { panel: PANEL(tab), ready: READY[tab] }), 'section ' + tab); }
  catch (error) {
    const state = await evaluate(({ panel, ready }) => { const element = document.querySelector(panel), shell = document.querySelector('[data-management-shell]'); return { exists: Boolean(element), hidden: element?.hidden, ready: Boolean(element?.querySelector(ready)), active: shell?.dataset.managementActive, hash: location.hash, text: (element?.textContent ?? '').trim().slice(0, 50), errors: window.__tourLog?.errors.slice(0, 3), width: document.documentElement.clientWidth, visible: [...document.querySelectorAll('[data-management-panel]')].filter(p => !p.hidden).map(p => p.dataset.managementPanel) }; }, { panel: PANEL(tab), ready: READY[tab] });
    throw Error(error.message + ' ' + JSON.stringify(state));
  }
  await pause(450);
};
const setLanguage = async locale => { await evaluate(locale => (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-language-v1': locale }), locale); await until(() => evaluate(locale => document.querySelector('[data-management-shell]')?.lang === locale.replaceAll('_', '-') || document.documentElement.lang.startsWith(locale.split('_')[0]), locale), 'language ' + locale); await pause(250); };
const setTheme = (theme, effective) => evaluate(({ theme, effective }) => { const element = document.documentElement; element.setAttribute('data-ui-theme', theme); element.setAttribute('data-ui-theme-effective', effective); }, { theme, effective });
const focusSelector = selector => evaluate(selector => { const element = document.querySelector(selector); if (!element) throw Error('missing ' + selector); element.focus(); if (document.activeElement === element) return true; const a = document.activeElement; throw Error('cannot focus ' + selector + ': active ' + (a?.tagName ?? '-') + '.' + String(a?.className ?? '').slice(0, 40) + ', open dialog ' + Boolean(document.querySelector('dialog[open]')) + ', inert ancestor ' + Boolean(element.closest('[inert]')) + ', hidden ancestor ' + Boolean(element.closest('[hidden]')) + ', disabled ' + element.disabled); }, selector);
// ADR-111, the Firewall slot: which control of the Firewall header has the focus (by role, not by markup), and the Tab key pressed for real. The title, the Tour button and the switch
// are three children of the module's launcher row, so the focus walks them in the order the eye does.
const focusedControl = () => evaluate(() => { const a = document.activeElement, header = document.querySelector('[data-workspace-master="firewall"]'); if (!a || !header || !header.contains(a)) return !a || a === document.body ? 'outside' : 'outside:' + a.tagName.toLowerCase(); return a.hasAttribute('data-protect-open') ? 'title' : a.hasAttribute('data-ui-tour-start') ? 'tour' : a.getAttribute('role') === 'switch' ? 'switch' : 'other:' + a.tagName.toLowerCase(); });
async function firewallTabOrder(label) {
  await openTab('firewall');
  await until(() => evaluate(() => document.querySelector('[data-workspace-master="firewall"] [data-protect-toggle="status"]')?.disabled === false), 'the Firewall switch is ready ' + label);
  assert.equal(await focusSelector('[data-workspace-master="firewall"] [data-protect-open]'), true, label + ': the title takes the focus');
  const forward = [await focusedControl()]; for (let step = 0; step < 2; step++) { await press('Tab'); forward.push(await focusedControl()); }
  assert.deepEqual(forward, ['title', 'tour', 'switch'], label + ': Tab goes from the title to the Tour button, then to the switch');
  const backward = []; for (let step = 0; step < 2; step++) { await press('Shift+Tab'); backward.push(await focusedControl()); }
  assert.deepEqual(backward, ['tour', 'title'], label + ': Shift+Tab walks back from the switch, Tour button, then the title');
  // One more Tab from the switch leaves the header: nothing else of it takes the focus. Done last, and never walked back from: where the focus goes once it has left the page depends on the browser's own toolbar.
  assert.equal(await focusSelector('[data-workspace-master="firewall"] [role="switch"]'), true, label + ': the switch takes the focus');
  await press('Tab'); const past = await focusedControl(); assert.ok(past.startsWith('outside'), label + ': one more Tab leaves the header (' + past + ')');
  assert.equal(await focusSelector('[data-workspace-master="firewall"] [data-protect-open]'), true, label + ': the focus is brought back into the page');
  return { forward, backward, past };
}
const tourState = () => evaluate(key => localStorage.getItem(key), TOUR_STORAGE_KEY);
// The page reads the stored progress again on a storage event (that is how another Options window is followed), so a change made from here is announced the same way.
const clearTourStorage = () => evaluate(keys => { for (const key of keys) localStorage.removeItem(key); window.dispatchEvent(new StorageEvent('storage', { key: null })); }, [TOUR_STORAGE_KEY, TOUR_LEGACY_STORAGE_KEY]);
const stateOf = tours => JSON.stringify({ version: 2, tours });

// Everything about the header of one section, read in one go; geometry in viewport pixels.
const measureHeader = tab => evaluate(({ panelSelector, tab }) => {
  const panel = document.querySelector(panelSelector);
  const visible = element => { if (!element || !element.isConnected || element.closest('[hidden],[inert],[aria-hidden="true"]')) return false; const s = getComputedStyle(element); if (s.display === 'none' || s.visibility === 'hidden') return false; const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  const buttons = [...panel.querySelectorAll('[data-ui-tour-start="header"]')].filter(visible), root = document.documentElement;
  const base = { tab, count: buttons.length, overflow: root.scrollWidth > root.clientWidth + 1, viewport: root.clientWidth, strips: panel.querySelectorAll('.workspace-secondary-actions').length };
  if (!buttons.length) return base;
  const button = buttons[0], row = button.closest('header, .workspace-titlebar, .detector-workspace__master, .workspace-master--firewall, .cookies-workspace-header, .contacts-header, .browser-debug-header');
  // The controls of the header cluster. The Firewall launcher draws its own title and switch (ADR-111: the Tour button is its middle child), so there all three buttons of its row stand for it.
  const cluster = button.closest('.workspace-tools'), toggle = row.querySelector('[role="switch"], .observation-switch'), launcherRow = tab === 'firewall' ? row.querySelector('.blocking-launcher__controls') : null;
  const controls = (cluster ? [...cluster.querySelectorAll('button, [role="switch"], select, input, a')] : launcherRow ? [...launcherRow.children] : [button, toggle].filter(Boolean)).filter(visible), label = button.querySelector('.workspace-tool__label'), glyph = button.querySelector('svg');
  const heading = row.querySelector('h2') ?? row.querySelector('.blocking-launcher__open span'), style = getComputedStyle(button), labelStyle = getComputedStyle(label);
  const firewall = launcherRow ? { children: [...launcherRow.children].map(child => child.hasAttribute('data-protect-open') ? 'title' : child.hasAttribute('data-ui-tour-start') ? 'tour' : child.getAttribute('role') === 'switch' ? 'switch' : child.tagName.toLowerCase()), title: box(launcherRow.querySelector('[data-protect-open]')),
    parentIsRow: button.parentElement === launcherRow, position: style.position, rowDisplay: getComputedStyle(launcherRow).display, rowWrap: getComputedStyle(launcherRow).flexWrap } : null;
  return { ...base, firewall, button: box(button), forTour: button.dataset.tourFor, name: button.textContent.trim(), ariaLabel: button.getAttribute('aria-label'), tip: button.title, popup: button.getAttribute('aria-haspopup'), type: button.type, disabled: button.disabled,
    row: box(row), rowTag: row.tagName.toLowerCase() + '.' + String(row.className).split(/\s+/)[0], direction: getComputedStyle(row).direction, toggle: toggle && visible(toggle) ? box(toggle) : null, heading: heading && visible(heading) ? box(heading) : null,
    controls: controls.map(element => ({ box: box(element), cls: String(element.className).split(/\s+/)[0], hook: [...element.attributes].map(attribute => attribute.name).find(name => name.startsWith('data-') && !name.startsWith('data-ui-tour') && name !== 'data-tour-for') ?? '' })),
    label: { text: label?.textContent ?? null, box: label ? box(label) : null, position: labelStyle.position, display: labelStyle.display, clip: labelStyle.clipPath }, glyph: glyph ? { box: box(glyph), hidden: glyph.getAttribute('aria-hidden') } : null,
    color: style.color, background: style.backgroundColor, borderColor: style.borderTopColor, borderWidth: parseFloat(style.borderTopWidth), borderStyle: style.borderTopStyle, fontSize: parseFloat(style.fontSize), radius: style.borderTopLeftRadius };
}, { panelSelector: PANEL(tab), tab });

// Contrast of computed colours (WCAG 2.2).
const channels = value => (value.match(/[\d.]+/gu) ?? []).slice(0, 4).map(Number);
const luminance = ([r, g, b]) => { const [x, y, z] = [r, g, b].map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
const contrast = (a, b) => { const [high, low] = [luminance(channels(a)), luminance(channels(b))].sort((m, n) => n - m); return (high + 0.05) / (low + 0.05); };
const intersects = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;

// The rules of ADR-111 for one header at one width; returns the numbers it measured.
function headerProblems(info, { tab, width, rtl = false, locale = 'en', copy = english }) {
  const problems = [], b = info.button, wide = info.viewport > 560;
  if (info.count !== 1) return ['expected one header button, found ' + info.count];
  if (info.forTour !== tab) problems.push('the button starts ' + info.forTour);
  if (info.overflow) problems.push('the page scrolls sideways');
  if (info.strips !== 0) problems.push('a strip under the header is still there');
  if (b.left < -1 || b.right > info.viewport + 1) problems.push('the button leaves the window');
  if (b.top < info.row.top - 1 || b.bottom > info.row.bottom + 1) problems.push('the button is outside its header row ' + JSON.stringify([b.top, b.bottom, info.row.top, info.row.bottom]));
  if (b.width < 31.5 || b.height < 31.5) problems.push('the target is smaller than 32 px: ' + Math.round(b.width) + 'x' + Math.round(b.height));
  if (info.direction !== (rtl ? 'rtl' : 'ltr')) problems.push('direction ' + info.direction);
  if (info.type !== 'button' || info.popup !== 'dialog') problems.push('type/aria-haspopup ' + info.type + '/' + info.popup);
  if (info.ariaLabel !== null) problems.push('an aria-label would hide the visible label from the name');
  if (info.name !== copy.tour_label || info.tip !== copy.tour_tip) problems.push('name/tooltip are "' + info.name + '" / "' + info.tip + '", expected "' + copy.tour_label + '" / "' + copy.tour_tip + '"');
  if (info.glyph === null || info.glyph.hidden !== 'true') problems.push('the glyph must be hidden from assistive technology');
  if (wide) { if (!(info.label.box.width >= 14) || info.label.position === 'absolute') problems.push('the label must be visible in wide windows: ' + JSON.stringify(info.label.box)); }
  else { if (info.label.box.width > 2 || info.label.box.height > 2 || info.label.position !== 'absolute') problems.push('the label must be visually hidden in narrow windows: ' + JSON.stringify(info.label)); if (Math.abs(b.width - 32) > 1) problems.push('the narrow button is a 32 px square, not ' + b.width); if (info.name !== copy.tour_label) problems.push('the hidden label must stay in the name'); }
  const same = (box, other) => Math.abs(box.left - other.left) < 0.5 && Math.abs(box.top - other.top) < 0.5;
  if (info.toggle) {
    // Logically "left of the switch": before it in reading order, so on the right in right-to-left text.
    const gap = rtl ? b.left - info.toggle.right : info.toggle.left - b.right;
    if (gap < 2 || gap > 24) problems.push('the gap between the Tour button and the switch is ' + Math.round(gap) + ' px (expected 2 to 24)');
    if (Math.abs((b.top + b.height / 2) - (info.toggle.top + info.toggle.height / 2)) > 6) problems.push('the Tour button and the switch are not on one line');
  } else {
    const endGap = rtl ? b.left - info.row.left : info.row.right - b.right;
    if (endGap > 4 || endGap < -1) problems.push('without a switch the Tour button must be the last item of the row, ' + Math.round(endGap) + ' px from the end');
    for (const other of info.controls) if (!same(other.box, b) && (rtl ? other.box.left < b.left - 1 : other.box.right > b.right + 1)) problems.push('something is after the Tour button: ' + other.cls + ' ' + other.hook);
  }
  for (let i = 0; i < info.controls.length; i++) for (let j = i + 1; j < info.controls.length; j++) if (intersects(info.controls[i].box, info.controls[j].box)) problems.push('overlap: ' + info.controls[i].cls + ' ' + info.controls[i].hook + ' and ' + info.controls[j].cls + ' ' + info.controls[j].hook);
  if (info.heading && intersects(info.heading, b)) problems.push('the title runs under the Tour button');
  if (info.firewall) {
    // ADR-111, the Firewall slot: the Tour button is the middle child of the module's launcher row, so the order in the DOM (and for the Tab key) is the order on the screen, mirrored in right-to-left text.
    const f = info.firewall, before = (first, second) => rtl ? first.left >= second.right - 1 : first.right <= second.left + 1;
    if (JSON.stringify(f.children) !== '["title","tour","switch"]') problems.push('the launcher row holds ' + JSON.stringify(f.children) + ', expected the title, the Tour button and the switch in this order');
    if (!f.parentIsRow) problems.push('the Tour button is not a direct child of the launcher row'); if (f.position === 'absolute') problems.push('the Tour button is placed absolutely');
    if (f.rowDisplay !== 'flex' || f.rowWrap !== 'nowrap') problems.push('the launcher row is ' + f.rowDisplay + ' / ' + f.rowWrap + ', expected one flex row that never wraps');
    if (!before(f.title, b)) problems.push('the title is not before the Tour button on the screen'); if (info.toggle && !before(b, info.toggle)) problems.push('the Tour button is not before the switch on the screen');
    if (info.toggle && (Math.abs(info.toggle.width - 46) > 0.6 || Math.abs(info.toggle.height - 28) > 0.6)) problems.push('the switch is ' + info.toggle.width + ' x ' + info.toggle.height + ' px, expected 46 x 28');
    if (info.toggle) { const spacing = rtl ? b.left - info.toggle.right : info.toggle.left - b.right; if (Math.abs(spacing - 8) > 0.6) problems.push('the Tour button is ' + spacing + ' px from the switch, expected 8'); }
  }
  // One line: every control of the cluster is centred on the button.
  for (const control of info.controls) if (Math.abs((control.box.top + control.box.height / 2) - (b.top + b.height / 2)) > 10) problems.push('the cluster wraps: ' + control.cls + ' ' + control.hook);
  return problems.map(text => tab + ' @' + width + (locale === 'en' ? '' : ' ' + locale) + ': ' + text);
}

// Everything about the step on screen, read in one go. Null when no popover is open.
const observe = () => evaluate(({ selectors, keyOf }) => {
  const popover = document.querySelector('[data-ui-tour-popover]');
  if (!popover) return null;
  const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  const visible = element => { if (!element || !element.isConnected || element.closest('[hidden],[inert],[aria-hidden="true"]')) return false; const s = getComputedStyle(element); if (s.display === 'none' || s.visibility === 'hidden') return false; const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const id = popover.dataset.uiTourStep, ring = document.querySelector('[data-ui-tour-ring]'), scrim = document.querySelector('[data-ui-tour-scrim]');
  let target = null, via = -1; for (const [position, selector] of (selectors[id] ?? []).entries()) { target = [...document.querySelectorAll(selector)].find(visible) ?? null; if (target) { via = position; break; } }
  const textOfIds = ids => (ids ?? '').split(' ').filter(Boolean).map(token => document.getElementById(token)?.textContent ?? null);
  const active = document.activeElement, root = document.documentElement, shell = document.querySelector('[data-management-shell]');
  const ancestors = []; for (let node = shell; node; node = node.parentElement) ancestors.push({ inert: node.inert === true, hidden: node.getAttribute('aria-hidden') });
  const popoverBox = box(popover);
  return {
    id, mode: popover.dataset.uiTourMode, ready: popover.dataset.uiTourReady, busy: popover.getAttribute('aria-busy') === 'true', role: popover.getAttribute('role'), ariaModal: popover.getAttribute('aria-modal'), tourFor: document.querySelector('[data-ui-tour]')?.dataset.uiTourFor ?? null,
    title: popover.querySelector('[data-ui-tour-title]')?.textContent ?? null, body: popover.querySelector('[data-ui-tour-body]')?.textContent ?? null, counter: popover.querySelector('[data-ui-tour-counter]')?.textContent ?? null, eyebrow: popover.querySelector('.ui-tour__eyebrow-text')?.textContent ?? null,
    labelledBy: textOfIds(popover.getAttribute('aria-labelledby')), describedBy: textOfIds(popover.getAttribute('aria-describedby')),
    buttons: [...popover.querySelectorAll('button')].map(button => ({ kind: button.hasAttribute('data-ui-tour-skip') ? 'skip' : button.hasAttribute('data-ui-tour-back') ? 'back' : button.hasAttribute('data-ui-tour-next') ? 'next' : 'other', text: button.textContent, rect: box(button) })),
    skipped: [...popover.querySelectorAll('[data-ui-tour-skipped-step]')].map(item => item.dataset.uiTourSkippedStep), focus: { insidePopover: popover.contains(active), onPopover: active === popover },
    popover: popoverBox, ring: ring ? box(ring) : null, scrim: Boolean(scrim), target: target ? box(target) : null, targetFound: Boolean(target), targetVia: via,
    viewport: { width: root.clientWidth, height: root.clientHeight, overflow: root.scrollWidth > root.clientWidth + 1 }, scrollY: Math.round(scrollY), direction: getComputedStyle(popover).direction,
    live: document.querySelector('[data-ui-announcer="polite"]')?.textContent ?? '', shell: { inert: ancestors.some(node => node.inert), ariaHidden: ancestors.some(node => node.hidden === 'true'), panelInert: document.querySelector('[data-management-panel="' + (shell?.dataset.managementActive ?? '') + '"]')?.inert === true },
    rawKeys: /tour_[a-z]/.test(popover.textContent), section: shell?.dataset.managementActive ?? null,
  };
}, { selectors: TARGET_SELECTORS, keyOf: KEY_OF_STEP });
const stable = async () => { let last = null; for (let attempt = 0; attempt < 30; attempt++) { const now = await observe(); const key = now && JSON.stringify([now.ring, now.popover, now.ready, now.scrollY]); if (now && now.ready === 'true' && key === last) return now; last = key; await pause(120); } return observe(); };
const waitStep = async (id, label = id) => { await until(async () => { const now = await observe(); return now && now.id === id && now.ready === 'true' && !now.busy; }, 'step ' + label); return stable(); };
const waitClosed = async label => { await until(async () => !(await evaluate(() => Boolean(document.querySelector('[data-ui-tour]')))), 'tour closed ' + label); await pause(450); };
const ringProblems = (now, pad = 6) => {
  if (!now.ring || !now.target) return ['ring or target missing'];
  const vw = now.viewport.width, vh = now.viewport.height, t = now.target, problems = [];
  const left = Math.max(2, t.left - pad), top = Math.max(2, t.top - pad), right = Math.min(vw - 2, t.right + pad), bottom = Math.min(vh - 2, t.bottom + pad);
  for (const [name, got, want] of [['left', now.ring.left, left], ['top', now.ring.top, top], ['right', now.ring.right, right], ['bottom', now.ring.bottom, bottom]]) if (Math.abs(got - want) > 3) problems.push(name + ' ' + got.toFixed(1) + ' vs ' + want.toFixed(1));
  return problems;
};
const insideViewport = (box, now, slack = 1) => box.left >= -slack && box.top >= -slack && box.right <= now.viewport.width + slack && box.bottom <= now.viewport.height + slack;
const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
const clippedButtons = now => now.buttons.filter(button => button.rect.top < now.popover.top - 1 || button.rect.bottom > now.popover.bottom + 1 || button.rect.top < -1 || button.rect.bottom > now.viewport.height + 1).map(button => button.kind);

// Opens the tour of a section the way a person does: focus the header button, press Enter (the palette for a section whose button is still pending).
async function startTour(tab, via) {
  if (via === 'palette') {
    assert.equal(await focusSelector('[data-management-search]'), true, tab + ': the search button takes focus (palette start)'); await press('Control+K');
    await until(() => evaluate(() => Boolean(document.querySelector('dialog[open] [data-command-palette-input]'))), 'palette open');
    for (const key of ['t', 'o', 'u', 'r']) await press(key);
    const first = await until(() => evaluate(() => document.querySelector('dialog[open] [role="option"]')?.dataset.commandOption ?? null), 'palette result');
    assert.match(first, new RegExp(':(start|resume)-tour:' + tab.replace('-', '\\-') + '$', 'u'), tab + ': the tour of the section on screen is the first palette result: ' + first);
    await press('Enter');
  } else { assert.equal(await focusSelector(HEADER_BUTTON(tab)), true); await press('Enter'); }
}

// ---- the run ----------------------------------------------------------------------------------------------------------------------------
let phase = 'startup';
try {
  evidence.consoleErrors = [];
  opened = await launch(); evidence.version = opened.version;
  await opened.bringToFront();
  const hasFirewall = browser === 'chrome';

  // ---- 0. no header shift on first paint: a fresh load of each section, the Tour button sampled on every frame ------------------------------
  phase = 'header stability on first paint';
  const stability = {};
  // The button is waited for (a section that reads its state from the background draws its header when the state arrives), then sampled on every frame for 1.5 s. Its place is
  // measured against its own header row (end edge and top), so a page scrollbar that appears when the content below has loaded moves the whole row and is not mistaken for a shift.
  const sampleStability = async tab => {
    const samples = await evaluate(async ({ panelSelector, buttonSelector, patience }) => {
      const out = [], began = performance.now(); let appeared = null;
      await new Promise(resolve => { const tick = () => { const now = performance.now(), panel = document.querySelector(panelSelector), button = panel && !panel.hidden ? panel.querySelector(buttonSelector) : null; if (button) { appeared ??= now; const r = button.getBoundingClientRect(), q = button.closest('header, .workspace-titlebar, .detector-workspace__master, .workspace-master--firewall, .cookies-workspace-header, .contacts-header, .browser-debug-header').getBoundingClientRect(); out.push([Math.round((q.right - r.right) * 10) / 10, Math.round((r.top - q.top) * 10) / 10]); } if (appeared === null ? now - began < patience : now - appeared < 1500) requestAnimationFrame(tick); else resolve(); }; tick(); });
      return out;
    }, { panelSelector: PANEL(tab), buttonSelector: '[data-ui-tour-start="header"]', patience: (NO_TOUR_IN_FIREFOX.has(tab) && !hasFirewall) || PENDING_HEADER.has(tab) ? 2000 : 15000 });
    if (NO_TOUR_IN_FIREFOX.has(tab) && !hasFirewall) { assert.equal(samples.length, 0, tab + ': no button in this browser'); return null; }
    if (PENDING_HEADER.has(tab) && samples.length === 0) return null;
    assert.ok(samples.length >= 10, tab + ': the Tour button is drawn with the header and stays (' + samples.length + ' samples in 1.5 s after it appeared)');
    const first = samples[0], moved = Math.max(...samples.map(([left, top]) => Math.max(Math.abs(left - first[0]), Math.abs(top - first[1]))));
    assert.ok(moved <= 1, tab + ': the Tour button moved by ' + moved + ' px inside its header while the section loaded ' + JSON.stringify([...new Set(samples.map(sample => sample.join(',')))].slice(0, 6)));
    return { samples: samples.length, moved };
  };
  // Every section is opened here for the first time, so it is mounted and has loaded before any later phase (the Detector, which Firefox cannot leave cleanly, last).
  for (const tab of VISIT_ORDER) {
    await opened.goto(opened.base + 'options.html#' + (HASH[tab] ?? tab));
    await until(() => evaluate(() => Boolean(document.querySelector('[data-management-shell]'))), 'management shell ' + tab);
    const record = await sampleStability(tab); if (record) stability[tab] = record;
  }
  evidence.phases.stability = stability;
  check('first paint of ' + Object.keys(stability).length + ' of ' + TOUR_IDS.length + ' sections (the others have no button yet or in this browser): once drawn, the Tour button never moves (at most 1 px over 1.5 s of frames) while the section loads the rest of its state, so the header does not shift when the switch or the status arrives');
  await opened.goto(opened.base + 'options.html#hub');
  await until(() => evaluate(() => Boolean(document.querySelector('[data-management-shell]'))), 'management shell');
  await pause(900);
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
  const resetLog = () => evaluate(() => { const log = window.__tourLog; const copy = { errors: [...log.errors], writes: [...log.writes], messages: [...log.messages], network: [...log.network] }; log.errors.length = 0; log.writes.length = 0; log.messages.length = 0; log.network.length = 0; return copy; });
  const snapshotStorage = () => evaluate(async () => { const api = globalThis.browser ?? globalThis.chrome; return { local: await api.storage.local.get(null), session: api.storage.session ? await api.storage.session.get(null) : {}, web: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])) }; });
  await clearTourStorage();

  // ---- 1. every section: the header button sits where it should, at every width --------------------------------------------------------
  phase = 'headers at four widths';
  await resetLog();
  const WIDTHS = quick ? [1180, 340] : [2576, 1180, 520, 340], headerNumbers = {};
  for (const width of WIDTHS) {
    await opened.viewport(width, 900); await pause(500);
    for (const tab of VISIT_ORDER) {
      await openTab(tab);
      const info = await measureHeader(tab);
      if (info.count === 0) { assert.ok(PENDING_HEADER.has(tab) || (NO_TOUR_IN_FIREFOX.has(tab) && !hasFirewall), tab + ' @' + width + ': no header button, and it is not a pending section'); assert.equal(info.overflow, false, tab + ' @' + width + ': no horizontal overflow'); continue; }
      assert.ok(!(NO_TOUR_IN_FIREFOX.has(tab) && !hasFirewall), tab + ': Firefox has no such module, so no tour button either');
      assert.deepEqual(headerProblems(info, { tab, width }), []);
      (headerNumbers[tab] ??= {})[width] = { button: [Math.round(info.button.width), Math.round(info.button.height)], gapToSwitch: info.toggle ? Math.round(info.toggle.left - info.button.right) : null, endGap: Math.round(info.row.right - info.button.right), fontSize: info.fontSize, controlsInRow: info.controls.length };
    }
  }
  evidence.headers = headerNumbers;
  await opened.viewport(1180, 900); await pause(400);
  check('header check on ' + TOUR_IDS.length + ' sections x ' + WIDTHS.join('/') + ' px: one Tour button per header, on the header row, before the module switch (or last without one), one line, no overlap, 32 px target, label shown at 1180 and 2576 and hidden-not-removed at 520 and 340, no horizontal overflow, no strip under any header, no aria-label hiding the visible name' + (PENDING_HEADER.size ? ' (pending until its owner draws it: ' + [...PENDING_HEADER].join(', ') + ')' : ''));
  // The Firewall header (Chromium only): the Tab key follows the eye, pressed for real: title, Tour button, switch, and back (ADR-111, the Firewall slot), in a wide and in a narrow window, left to right and right to left.
  if (hasFirewall) {
    phase = 'firewall tab order'; evidence.phases.firewallTabOrder = {};
    for (const [locale, width] of [['en', 1180], ['en', 340], ['ar', 1180], ['ar', 340]]) {
      await setLanguage(locale); await opened.viewport(width, 900); await pause(350);
      evidence.phases.firewallTabOrder[locale + '@' + width] = await firewallTabOrder(locale + ' @' + width);
      assert.deepEqual(headerProblems(await measureHeader('firewall'), { tab: 'firewall', width, rtl: locale === 'ar', locale, copy: TOUR_LABELS[locale] }), [], 'the Firewall header after the Tab walk');
    }
    await setLanguage('en'); await opened.viewport(1180, 900); await pause(400);
    // The island is outside the host's hover and press rules, so the Tour button in it has rules of its own (redesign.css): it fades like the Tour button of any other header.
    const motionOf = selector => evaluate(selector => { const style = getComputedStyle(document.querySelector(selector)); return [style.transitionProperty, style.transitionDuration, style.transitionTimingFunction]; }, selector);
    await opened.media({ reducedMotion: 'no-preference' }); await openTab('autosurf'); const motionReference = await motionOf(HEADER_BUTTON('autosurf')); await openTab('firewall');
    assert.notEqual(motionReference[0], 'all', 'the other Tour buttons have a real transition list (moving is allowed here)'); assert.deepEqual(await motionOf(HEADER_BUTTON('firewall')), motionReference, 'the Tour button in the Firewall header fades like the others');
    // And the same momentary press: a real mouse button held down on the button (released elsewhere, so nothing is clicked) scales it below 1 like every other Tour button.
    const pressedOf = async selector => { const at = await evaluate(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, selector); await opened.move(at.x, at.y); await opened.down(); await pause(250); const transform = await evaluate(selector => getComputedStyle(document.querySelector(selector)).transform, selector); await opened.move(2, 2); await opened.up(); await pause(250); return transform; };
    const pressedFirewall = await pressedOf(HEADER_BUTTON('firewall')); await openTab('autosurf'); const pressedReference = await pressedOf(HEADER_BUTTON('autosurf'));
    assert.match(pressedReference, /^matrix\(0\.9\d*, 0, 0, 0\.9\d*, 0, 0\)$/u, 'the other Tour buttons shrink a little while pressed (' + pressedReference + ')'); assert.equal(pressedFirewall, pressedReference, 'the Tour button in the Firewall header is pressed like the others');
    assert.equal(await evaluate(() => Boolean(document.querySelector('[data-ui-tour]'))), false, 'releasing the button elsewhere started no tour'); await openTab('firewall');
    await opened.media({ reducedMotion: null });
    check('Firewall header: with real key presses Tab goes title, Tour button, switch and Shift+Tab goes back (the Tour button is the middle child of the launcher row, not a neighbour after it), one more Tab leaves the header, at 1180 and 340 px in English and in right-to-left Arabic; the button fades like the Tour button of any other header (the island is outside the host\'s motion rules)');
  }
  const baseline = await resetLog(); evidence.phases.baseline = { messages: [...new Set(baseline.messages)], writes: [...new Set(baseline.writes)] };

  // ---- 2. the strips are gone and Refresh and Export still work as icon-only tools -------------------------------------------------------
  phase = 'icon-only tools';
  for (const [tab, hook, icon] of [['antidetect', 'data-antidetect-refresh', 'refresh'], ['autosurf', 'data-autosurf-refresh', 'refresh'], ['proxy', 'data-proxy-export', 'export']]) {
    await openTab(tab);
    const tool = await evaluate(({ tab, hook }) => { const panel = document.querySelector('[data-management-panel="' + tab + '"]'), button = panel.querySelector('[' + hook + ']'), cluster = button.closest('.workspace-tools'), tour = cluster.querySelector('[data-ui-tour-start="header"]'), toggle = cluster.querySelector('[role="switch"]');
      const position = node => [...cluster.children].indexOf(node.closest('.workspace-tools > *') ?? node), rect = element => { const r = element.getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right }; };
      return { label: button.getAttribute('aria-label'), title: button.title, text: button.textContent.trim(), glyph: button.querySelectorAll('svg[aria-hidden="true"]').length, box: rect(button), tour: rect(tour), toggle: toggle ? rect(toggle) : null, order: [position(button), position(tour), position(toggle ?? tour)], disabled: button.disabled, strip: panel.querySelectorAll('.workspace-secondary-actions').length }; }, { tab, hook });
    assert.ok(tool.label && tool.label === tool.title && tool.text === '', tab + ': ' + hook + ' is icon-only, its name and tooltip are the same word (' + tool.label + ')'); assert.equal(tool.glyph, 1); assert.equal(tool.strip, 0, tab + ': no strip');
    assert.ok(Math.abs(tool.box.width - 32) <= 1 && Math.abs(tool.box.height - 32) <= 1, tab + ': a 32 px circle'); assert.ok(tool.order[0] < tool.order[1] && (tool.toggle === null || tool.order[1] < tool.order[2]), tab + ': tool, then Tour, then switch ' + tool.order);
    assert.ok(tool.box.right <= tool.tour.left + 1, tab + ': the tool is before the Tour button');
  }
  // Refresh still refreshes: the Autosurfer and Antidetect tools issue the same read as before (a message the page sends on its own as well), Export still downloads a file (not run here: needs a profile).
  await openTab('autosurf'); await resetLog();
  await evaluate(() => document.querySelector('[data-autosurf-refresh]').click()); await pause(700);
  const afterRefresh = await resetLog(); assert.deepEqual(afterRefresh.errors, [], 'Refresh raised no error'); evidence.phases.refresh = { messages: [...new Set(afterRefresh.messages)] };
  await openTab('antidetect'); await until(() => evaluate(() => !document.querySelector('[data-antidetect-refresh]').disabled), 'Antidetect Refresh enabled'); await resetLog();
  await evaluate(() => document.querySelector('[data-antidetect-refresh]').click()); await until(() => evaluate(() => document.querySelector('[data-antidetect-app]').getAttribute('aria-busy') === 'false'), 'Antidetect read again'); await pause(300);
  assert.deepEqual((await resetLog()).errors, [], 'the Antidetect Refresh tool read the state again without an error');
  check('Refresh (Antidetect, Autosurfer) and Export (Proxy) are 32 px icon-only tools before the Tour button with one name that is also the tooltip, their old data-* hooks, no strip left, and they still act (Refresh re-reads without error)');

  // ---- 3. the command palette offers the tour of the section on screen first, in every section ---------------------------------------------------
  phase = 'palette';
  const paletteCheck = async tab => {
    await openTab(tab); await clearTourStorage(); await pause(150);
    assert.equal(await focusSelector('[data-management-search]'), true, tab + ': the search button takes focus'); await press('Control+K');
    await until(() => evaluate(() => Boolean(document.querySelector('dialog[open] [data-command-palette-input]'))), 'palette open ' + tab);
    for (const key of ['t', 'o', 'u', 'r']) await press(key);
    const results = await until(() => evaluate(() => { const rows = [...document.querySelectorAll('dialog[open] [role="option"]')].map(row => ({ id: row.dataset.commandOption, text: row.textContent })); return rows.length ? rows : null; }), 'palette results ' + tab);
    assert.equal(results[0].id, 'ui-tour:start-tour:' + tab, tab + ': the tour of this section is the first result: ' + results[0].id); assert.ok(results[0].text.includes(english.start), tab + ': the label is "' + english.start + '"');
    const tourIds = results.map(row => row.id).filter(id => id.startsWith('ui-tour:')); assert.equal(tourIds.length, hasFirewall ? TOUR_IDS.length : TOUR_IDS.length - 1, tab + ': one tour per section is offered (' + tourIds.length + ')');
    assert.equal(tourIds.includes('ui-tour:start-tour:firewall'), hasFirewall, tab + ': the Firewall tour is offered only where the module exists');
    // A search field clears its text on the first Esc; the next one closes the dialog.
    for (let attempt = 0; attempt < 3 && await evaluate(() => Boolean(document.querySelector('dialog[open]'))); attempt++) { await press('Escape'); await pause(250); }
    assert.equal(await evaluate(() => Boolean(document.querySelector('dialog[open]'))), false, tab + ': Esc closes the palette');
  };
  for (const tab of VISIT_ORDER) { if (NO_TOUR_IN_FIREFOX.has(tab) && !hasFirewall) continue; await paletteCheck(tab); }
  check('Ctrl+K, typing "tour": in each of the ' + VISIT_ORDER.length + ' sections the first result is the tour of THAT section (group = its name), and the list holds one tour per section' + (hasFirewall ? '' : ' except the Firewall, which this browser does not have'));

  // ---- 4. every tour, every step, with real key presses ---------------------------------------------------------------------------------------------
  phase = 'tours';
  await opened.viewport(1180, 900); await pause(400);
  const storageBefore = await snapshotStorage(); await resetLog();
  // The keys are handled by the layer itself (Enter on Done never reaches the button), so only a real pointer exercises the buttons' own handlers: Next, Back, Done and Skip.
  {
    const tab = 'contacts', steps = TOURS[tab], total = steps.length;
    phase = 'popover buttons by mouse';
    const pointer = async (selector, label) => {
      const at = await evaluate(selector => { const button = document.querySelector(selector); if (!button) return null; const r = button.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y); return { x, y, covered: !(top && (top === button || button.contains(top))), disabled: button.disabled || button.getAttribute('aria-disabled') === 'true' }; }, selector);
      assert.ok(at, label + ': the button exists'); assert.equal(at.disabled, false, label + ': enabled'); assert.equal(at.covered, false, label + ': nothing covers the button at its centre');
      await opened.click(at.x, at.y); await pause(150);
    };
    const outcome = () => evaluate(() => ({ live: document.querySelector('[data-ui-announcer="polite"]')?.textContent ?? '', active: document.activeElement?.getAttribute('data-ui-tour-start') ?? null, popover: Boolean(document.querySelector('[data-ui-tour-popover]')) }));
    await openTab(tab); await clearTourStorage(); await startTour(tab, 'header'); await waitStep(steps[0].id);
    await pointer('[data-ui-tour-next]', 'Next'); assert.equal((await waitStep(steps[1].id)).counter, '2 / ' + total, 'a click on Next goes forward');
    await pointer('[data-ui-tour-back]', 'Back'); assert.equal((await waitStep(steps[0].id)).counter, '1 / ' + total, 'a click on Back goes back');
    await pointer('[data-ui-tour-next]', 'Next'); await waitStep(steps[1].id); await pointer('[data-ui-tour-next]', 'Next');
    const lastStep = await waitStep(steps[2].id); assert.equal(lastStep.buttons.at(-1).text, english.done, 'the last step offers Done');
    await pointer('[data-ui-tour-next]', 'Done'); await waitClosed('pointer done');
    const done = await outcome(); assert.equal(done.popover, false, 'a click on Done closes the tour'); assert.ok(done.live.includes(english.finished), 'and announces the end: ' + done.live); assert.equal(done.active, 'header', 'and the focus returns to the button that started it');
    assert.equal(await tourState(), stateOf({ [tab]: { completed: true, lastStep: 0 } }), 'a click on Done stores the tour as completed');
    await clearTourStorage(); await startTour(tab, 'header'); await waitStep(steps[0].id);
    await pointer('[data-ui-tour-next]', 'Next'); await waitStep(steps[1].id); await pointer('[data-ui-tour-skip]', 'Skip'); await waitClosed('pointer skip');
    const skipped = await outcome(); assert.equal(skipped.popover, false, 'a click on Skip closes the tour'); assert.ok(skipped.live.includes(english.closed) && !skipped.live.includes(english.finished), 'without announcing a finish: ' + skipped.live); assert.equal(skipped.active, 'header', 'and the focus returns to the button that started it');
    assert.equal(await tourState(), stateOf({ [tab]: { completed: false, lastStep: 1 } }), 'a click on Skip keeps the step for Resume and does not complete the tour');
    await clearTourStorage();
    check('the popover buttons answer a real mouse (Contacts tour): Next and Back move one step, Done closes it as finished with focus back on the header button and the progress stored as completed, Skip closes it as unfinished and keeps the step');
  }
  phase = 'tours';
  const walkTour = async tab => {
    const steps = TOURS[tab], total = steps.length;
    phase = 'tour ' + tab;
    await openTab(tab); await clearTourStorage();
    const pending = PENDING_HEADER.has(tab) && (await measureHeader(tab)).count === 0;
    await startTour(tab, pending ? 'palette' : 'header');
    const seen = [];
    for (let index = 0; index < total; index++) {
      const id = steps[index].id, now = await waitStep(id, tab + ':' + id), copy = english;
      seen.push({ id, via: now.targetVia, mode: now.mode });
      assert.equal(now.role, 'dialog'); assert.equal(now.ariaModal, 'false', id + ': a non-modal dialog'); assert.equal(now.tourFor, tab); assert.equal(now.section, tab, id + ': shown in the section of its tour');
      assert.deepEqual(now.labelledBy, [copy['step_' + id + '_title']], id + ': the dialog is named by its title'); assert.deepEqual(now.describedBy, [copy.step_label.replace('{n}', index + 1).replace('{total}', total), copy['step_' + id + '_body']], id + ': described by the step and its text');
      assert.equal(now.title, copy['step_' + id + '_title']); assert.equal(now.body, copy['step_' + id + '_body']); assert.equal(now.counter, (index + 1) + ' / ' + total); assert.equal(now.eyebrow, copy.eyebrow); assert.ok(!now.rawKeys, id + ': no raw message key on screen');
      assert.deepEqual(now.buttons.map(button => button.kind), index === 0 ? ['skip', 'next'] : index === total - 1 ? ['back', 'next'] : ['skip', 'back', 'next'], id + ': Skip, Back, Next/Done where they belong'); assert.equal(now.buttons.at(-1).text, index === total - 1 ? copy.done : copy.next);
      assert.equal(now.scrim, false, id + ': a ring, not the plain dimming (the part is there)'); assert.equal(now.targetFound, true, id + ': the target exists and is visible'); assert.deepEqual(ringProblems(now), [], id + ': the ring sits on the real target');
      assert.ok(now.target.bottom > 0 && now.target.top < now.viewport.height, id + ': the target is scrolled into view'); assert.ok(insideViewport(now.popover, now, 1), id + ': the popover is inside the window ' + JSON.stringify(now.popover));
      if (now.mode === 'float') assert.equal(overlaps(now.popover, now.ring), false, id + ': the popover does not cover the ring'); assert.equal(now.focus.insidePopover, true, id + ': focus is inside the popover'); assert.equal(now.viewport.overflow, false);
      assert.deepEqual(now.shell, { inert: false, ariaHidden: false, panelInert: false }, id + ': nothing behind the popover is inert or hidden'); assert.deepEqual(now.skipped, [], id + ': nothing skipped');
      if (index > 0) assert.ok(now.live.includes(copy.step_label.replace('{n}', index + 1).replace('{total}', total) + ': ' + copy['step_' + id + '_title']) && now.live.includes(copy['step_' + id + '_body']), id + ': announced through the live region');
      if (index === 1 && total > 2) { await press('ArrowLeft'); const back = await waitStep(steps[0].id); assert.equal(back.counter, '1 / ' + total); await press('ArrowLeft'); await pause(250); assert.equal((await observe()).id, steps[0].id, 'Left arrow on the first step does nothing'); await press('ArrowRight'); await waitStep(steps[1].id); }
      if (index < total - 1) await press('ArrowRight');
    }
    // The last step: Enter on Done closes, focus and the view return to where the run began, the progress says completed.
    await evaluate(() => document.querySelector('[data-ui-tour-next]').focus()); await press('Enter'); await waitClosed(tab + ' done');
    const after = await evaluate(() => ({ section: document.querySelector('[data-management-shell]').dataset.managementActive, active: document.activeElement?.getAttribute('data-ui-tour-start') ?? (document.activeElement === document.querySelector('[data-management-search]') ? 'search' : document.activeElement?.tagName), live: document.querySelector('[data-ui-announcer="polite"]')?.textContent ?? '', popover: Boolean(document.querySelector('[data-ui-tour-popover]')) }));
    assert.equal(after.section, tab, tab + ': back on the section it began on'); assert.equal(after.popover, false); assert.ok(after.live.includes(english.finished), tab + ': the end is announced: ' + after.live);
    assert.equal(after.active, pending ? 'search' : 'header', tab + ': focus returns to the button (or to what had it) that started the tour');
    assert.equal(await tourState(), stateOf({ [tab]: { completed: true, lastStep: 0 } }), tab + ': only this tour is stored, as completed');
    // An interrupted run: Esc at step 2 stores the step; the button then offers Resume and continues there.
    await startTour(tab, pending ? 'palette' : 'header'); await waitStep(steps[0].id); await press('ArrowRight'); await waitStep(steps[1].id); await press('Escape'); await waitClosed(tab + ' esc');
    assert.equal(await tourState(), stateOf({ [tab]: { completed: true, lastStep: 1 } }), tab + ': a replay stopped at step 2 keeps completed and remembers the step');
    if (!pending) {
      const tip = await evaluate(selector => { const button = document.querySelector(selector); return { title: button.title, resumable: button.dataset.uiTourResumable ?? null, focused: document.activeElement === button }; }, HEADER_BUTTON(tab));
      assert.deepEqual(tip, { title: english.tour_tip_resume.replace('{n}', '2').replace('{total}', String(total)), resumable: 'true', focused: true }, tab + ': the button says where the tour stopped and has the focus back');
      await press('Enter'); const resumed = await waitStep(steps[1].id); assert.equal(resumed.counter, '2 / ' + total, tab + ': Resume continues at the stored step'); await press('Escape'); await waitClosed(tab + ' resume');
    }
    evidence.tours[tab] = { steps: total, targets: seen };
  };
  for (const tab of VISIT_ORDER) { if (NO_TOUR_IN_FIREFOX.has(tab) && !hasFirewall) continue; await walkTour(tab); }
  const log = await resetLog(), storageAfter = await snapshotStorage();
  assert.deepEqual(storageAfter.local, storageBefore.local, 'chrome.storage.local is byte-for-byte unchanged by the tours'); assert.deepEqual(storageAfter.session, storageBefore.session, 'storage.session unchanged');
  const webBefore = { ...storageBefore.web }, webAfter = { ...storageAfter.web }; delete webAfter[TOUR_STORAGE_KEY]; delete webBefore[TOUR_STORAGE_KEY]; assert.deepEqual(webAfter, webBefore, 'localStorage changed in no key but ui-tour:v2'); assert.ok(!(TOUR_LEGACY_STORAGE_KEY in storageAfter.web), 'the round-5 key is not written');
  const tourWrites = log.writes.filter(write => !(evidence.phases.baseline.writes.includes(write))); assert.deepEqual(tourWrites, [], 'no extension storage write beyond what visiting the sections does anyway'); assert.deepEqual(log.network, [], 'no fetch, request, socket or beacon');
  const extra = [...new Set(log.messages)].filter(type => !evidence.phases.baseline.messages.includes(type)); assert.deepEqual(extra, [], 'no message type that plain navigation does not also send'); assert.deepEqual(log.errors, [], 'no script error, rejection or console error');
  evidence.phases.sideEffects = { messages: [...new Set(log.messages)], writes: [...new Set(log.writes)] };
  check(VISIT_ORDER.filter(tab => !(NO_TOUR_IN_FIREFOX.has(tab) && !hasFirewall)).length + ' tours / ' + Object.values(evidence.tours).reduce((sum, tour) => sum + tour.steps, 0) + ' steps walked with the Right arrow: each step is in its own section, its ring sits on the real visible target, the popover is inside the window and clear of the ring, focus is inside it, the live region announces it, nothing behind it is inert, no step skipped; Left arrow goes back; Enter on Done closes, returns focus to the header button and stores only that tour as completed; Esc stores the step, the button then says "Resume ... step 2" and continues there');
  check('storage.local and storage.session are unchanged by all tours, localStorage differs only by ui-tour:v2 (never the old v1 key), no storage write, network start or message type beyond what visiting the sections does anyway, no console error');

  // ---- 5. languages: the header stays one row, the button speaks the language, right to left mirrors ----------------------------------------------------
  phase = 'languages';
  const sweep = [];
  for (const language of PRODUCTION_LANGUAGES.filter(language => !quick || ['en', 'ru', 'ar'].includes(language.id))) {
    const locale = language.id, copy = TOUR_LABELS[locale], rtl = ['ar', 'ur'].includes(locale);
    await setLanguage(locale);
    for (const tab of ['autosurf', 'hub', 'proxy', 'contacts', ...(hasFirewall ? ['firewall'] : [])]) {
      await openTab(tab);
      for (const width of [1180, 340]) {
        await opened.viewport(width, width === 340 ? 740 : 900); await pause(350);
        assert.deepEqual(headerProblems(await measureHeader(tab), { tab, width, rtl, locale, copy }), []);
      }
    }
    await opened.viewport(1180, 900); await pause(300);
    // The Firewall slot in every language: the title, the Tour button and the switch are three children of one row, so the Tab key walks them in that order (mirrored on screen in Arabic and Urdu).
    if (hasFirewall) (evidence.phases.firewallTabOrderLanguages ??= {})[locale] = await firewallTabOrder(locale);
    // The first step of one tour arrives in the language; the second is reached with the arrow that goes forward in that direction; the button of the interrupted run says Resume in it.
    await openTab('contacts'); await clearTourStorage(); await focusSelector(HEADER_BUTTON('contacts')); await press('Enter');
    const first = await waitStep('contacts-sites', locale + ' contacts-sites');
    assert.equal(first.title, copy['step_contacts-sites_title'], locale + ' title'); assert.equal(first.body, copy['step_contacts-sites_body'], locale + ' body'); assert.equal(first.eyebrow, copy.eyebrow); assert.equal(first.direction, rtl ? 'rtl' : 'ltr', locale + ' direction'); assert.deepEqual(ringProblems(first), [], locale + ' ring');
    await press(rtl ? 'ArrowLeft' : 'ArrowRight'); const second = await waitStep('contacts-social', locale + ' second'); assert.equal(second.counter, '2 / ' + TOURS.contacts.length, locale + (rtl ? ': in right-to-left text the Left arrow goes forward' : ': the Right arrow goes forward'));
    assert.equal(second.title, copy['step_contacts-social_title'], locale + ' second title');
    await press('Escape'); await waitClosed(locale);
    const tip = await evaluate(selector => document.querySelector(selector).title, HEADER_BUTTON('contacts'));
    assert.equal(tip, copy.tour_tip_resume.replace('{n}', '2').replace('{total}', String(TOURS.contacts.length)), locale + ': the resume tooltip speaks the language');
    await clearTourStorage(); sweep.push(locale);
  }
  evidence.phases.languages = sweep; await setLanguage('en');
  check('all ' + sweep.length + ' languages: on Autosurfer, Control center, Proxy, Contacts' + (hasFirewall ? ' and the Firewall (title, Tour button and switch in one row, in the order the Tab key walks them)' : '') + ' the header keeps one row at 1180 and 340 px with the button named and explained in the language (no aria-label over the visible name), mirrored in Arabic and Urdu; the first step of a tour and the resume tooltip arrive exactly as authored');

  // ---- 6. themes and modes -------------------------------------------------------------------------------------------------------------------------------------
  phase = 'themes and modes';
  await openTab('antidetect');
  const palettes = [['system', 'system-light'], ['system', 'system-dark'], ['pearl', 'pearl'], ['aurora', 'aurora'], ['graphite', 'graphite'], ['orchid', 'orchid'], ['glass', 'glass']], ratios = {};
  for (const [theme, effective] of palettes) {
    await setTheme(theme, effective); await pause(450);
    const info = await measureHeader('antidetect'), text = contrast(info.color, info.background);
    assert.ok(text >= 4.5, effective + ': the Tour label contrast is ' + text.toFixed(2)); assert.ok(info.borderWidth >= 0.5 && info.borderStyle === 'solid', effective + ': the button keeps a visible frame (at least one device pixel) ' + JSON.stringify({ width: info.borderWidth, style: info.borderStyle, color: info.borderColor, background: info.background }));
    assert.deepEqual(headerProblems(info, { tab: 'antidetect', width: 1180 }), []); ratios[effective] = Number(text.toFixed(2));
  }
  await setTheme('system', 'system-light'); evidence.phases.contrast = ratios;
  check('the Tour button label reaches 4.5:1 on its own background and keeps a frame in all seven computed palettes; the header geometry does not depend on the palette');
  if (hasFirewall) {
    // The Firewall Tour button stands inside the module's island: the same colours, frame and geometry as everywhere else in every palette (the 46 x 28 switch, the 8 px gap, the order title, Tour, switch included).
    await openTab('firewall'); const firewallRatios = {};
    for (const [theme, effective] of palettes) {
      await setTheme(theme, effective); await pause(450);
      const info = await measureHeader('firewall'), text = contrast(info.color, info.background);
      assert.ok(text >= 4.5, 'firewall ' + effective + ': the Tour label contrast is ' + text.toFixed(2)); assert.ok(info.borderWidth >= 0.5 && info.borderStyle === 'solid', 'firewall ' + effective + ': the button keeps a visible frame ' + JSON.stringify({ width: info.borderWidth, style: info.borderStyle, color: info.borderColor, background: info.background }));
      assert.deepEqual(headerProblems(info, { tab: 'firewall', width: 1180 }), []); firewallRatios[effective] = Number(text.toFixed(2));
    }
    await setTheme('system', 'system-light'); evidence.phases.contrastFirewall = firewallRatios;
    check('Firewall: the Tour button (inside the module\'s launcher row) keeps 4.5:1, its frame, the 46 x 28 switch, the 8 px gap and the order title, Tour button, switch in all seven computed palettes');
  }
  await opened.viewport(640, 450); await pause(500);
  for (const tab of ['autosurf', 'proxy', 'hub', ...(hasFirewall ? ['firewall'] : [])]) { await openTab(tab); assert.deepEqual(headerProblems(await measureHeader(tab), { tab, width: 640 }), []); }
  await opened.viewport(1180, 900); await pause(400);
  if (browser === 'chrome') {
    await openTab('autosurf'); await opened.media({ forcedColors: 'active' }); await pause(300);
    const forced = await measureHeader('autosurf'); assert.ok(forced.borderWidth >= 0.5 && forced.borderStyle === 'solid' && channels(forced.borderColor).length >= 3 && (channels(forced.borderColor)[3] ?? 1) > 0, 'forced colors: the button keeps a visible system-colour frame ' + forced.borderColor); assert.deepEqual(headerProblems(forced, { tab: 'autosurf', width: 1180 }), []);
    await opened.media({ forcedColors: 'none' }); await pause(200);
    // The Firewall header in forced colors: the Tour button in the island keeps its system-colour frame and the row keeps its order and geometry.
    await openTab('firewall'); await opened.media({ forcedColors: 'active' }); await pause(300);
    const forcedFirewall = await measureHeader('firewall'); assert.ok(forcedFirewall.borderWidth >= 0.5 && forcedFirewall.borderStyle === 'solid' && channels(forcedFirewall.borderColor).length >= 3 && (channels(forcedFirewall.borderColor)[3] ?? 1) > 0, 'forced colors, Firewall: the button keeps a visible system-colour frame ' + forcedFirewall.borderColor); assert.deepEqual(headerProblems(forcedFirewall, { tab: 'firewall', width: 1180 }), []);
    await opened.media({ forcedColors: 'none' }); await pause(200);
    check('forced colors: the Tour button keeps a visible frame and the same one-row geometry (Autosurfer and Firewall); 200 % zoom equivalent (640 px) keeps Autosurfer, Proxy, Control center and Firewall in one row');
  } else { check('200 % zoom equivalent (640 px) keeps Autosurfer, Proxy and Control center in one row'); evidence.limits.push('forced-colors emulation is Chromium-only here; Firefox is covered by the static stylesheet checks'); }

  // ---- 7. screenshots for review ----------------------------------------------------------------------------------------------------------------------------------
  if (takeScreens) {
    phase = 'screenshots';
    mkdirSync(screens, { recursive: true });
    const shots = [];
    for (const [locale, dark] of [['en', false], ['en', true], ['ru', false], ['ru', true], ['ar', false], ['ar', true]]) {
      await setLanguage(locale); await setTheme(dark ? 'system' : 'system', dark ? 'system-dark' : 'system-light');
      for (const [width, height] of [[1180, 560], [340, 640]]) {
        await opened.viewport(width, height); await pause(400);
        for (const tab of ['antidetect', 'autosurf', 'proxy', 'hub', 'firewall', 'cookies']) {
          if (NO_TOUR_IN_FIREFOX.has(tab) && !hasFirewall) continue;
          await openTab(tab); const file = join(screens, tab + '-' + locale + '-' + (dark ? 'dark' : 'light') + '-' + width + '.png'); await opened.screenshot(file); shots.push(file);
        }
      }
    }
    // One step of a tour on a narrow screen, for the popover docked at the bottom.
    await setLanguage('en'); await setTheme('system', 'system-light'); await opened.viewport(340, 740); await pause(400); await openTab('proxy'); await clearTourStorage(); await focusSelector(HEADER_BUTTON('proxy')); await press('Enter'); await waitStep('proxy-switch');
    const tourShot = join(screens, 'proxy-tour-step1-en-light-340.png'); await opened.screenshot(tourShot); shots.push(tourShot); await press('Escape'); await waitClosed('screens');
    await setTheme('system', 'system-light'); await opened.viewport(1180, 900); await pause(300);
    evidence.screenshots = shots; check(shots.length + ' screenshots (en, ru, ar; light and dark; 1180 and 340 px; Antidetect, Autosurfer, Proxy, Control center, Firewall, Cookies, and a tour step docked at 340 px) written to ' + screens);
  }

  // ---- 8. the Detector, last: the same rules (first paint, header at 1180 and 340, palette, the whole tour); nothing is opened after it --------------------------
  phase = 'the Detector';
  await opened.viewport(1180, 900); await pause(400);
  await opened.evaluate(hash => { location.hash = '#' + hash; }, 'detector');
  await until(() => evaluate(() => Boolean(document.querySelector('[data-management-panel="detector"]') && !document.querySelector('[data-management-panel="detector"]').hidden)), 'detector shown');
  const detectorPaint = await sampleStability('detector'); assert.ok(detectorPaint, 'the Detector header button was drawn'); stability.detector = detectorPaint;
  await openTab('detector'); assert.deepEqual(headerProblems(await measureHeader('detector'), { tab: 'detector', width: 1180 }), []);
  await paletteCheck('detector'); await walkTour('detector');
  await clearTourStorage(); await opened.viewport(340, 740); await pause(500); assert.deepEqual(headerProblems(await measureHeader('detector'), { tab: 'detector', width: 340 }), []);
  check('the Detector, opened last (the order is kept, see the comment at VISIT_ORDER): its Tour button never moves while it loads, sits before the observation switch at 1180 and 340 px, the palette lists its tour first, and its 4-step tour runs through every step');

  // ---- 9. the browser saw no error --------------------------------------------------------------------------------------------------------------------------
  phase = 'errors';
  const final = await resetLog(); assert.deepEqual(final.errors, [], 'no error during the whole run: ' + final.errors.join(' | ')); assert.deepEqual(evidence.consoleErrors, [], 'no console error seen by the browser: ' + evidence.consoleErrors.join(' | '));
  check('the browser saw no console error, rejected promise or script error in the whole run');
  evidence.result = 'PASS'; console.log('UI tour tabs ' + browser + ' (' + evidence.version + '): ' + evidence.checks.length + ' checks PASS');
} catch (error) {
  evidence.result = 'FAIL'; evidence.phase = phase; evidence.error = error.stack ?? String(error); process.exitCode = 1;
  try { if (opened) await opened.screenshot(join(run, 'failure.png')); } catch { /* The browser may be gone. */ }
  console.error('FAIL ui tour tabs ' + browser + ' in phase "' + phase + '": ' + (error.message ?? error));
} finally {
  if (writeEvidenceFile) writeEvidence('ui-tour-tabs/' + browser + (mutation ? '-mutation' : '') + '.json', evidence);
  try { await closeBrowser(); } catch { /* Preserve the original result. */ }
  if (!keep && evidence.result === 'PASS') { try { rmSync(run, { recursive: true, force: true }); } catch { /* A locked browser file is cleaned by the next run. */ } }
}
