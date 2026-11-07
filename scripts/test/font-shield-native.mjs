// ADR-110: the HTML/CSS font shield of the Fonts option, in a real, owned, disposable browser, with the extension staged FROM SOURCE into a
// private run folder (.tmp/font-shield-<browser>-*; never dist/ or release/).
//   node scripts/test/font-shield-native.mjs             Chrome (Playwright Chromium)
//   node scripts/test/font-shield-native.mjs --chrome    the installed Chrome (extension loaded over CDP)
//   node scripts/test/font-shield-native.mjs --firefox   the installed Firefox (WebDriver)
// What it proves, over classic font enumeration (width difference through DOM, SVG, Canvas and OffscreenCanvas text, FontFace local()
// loads, document.fonts, queryLocalFonts) run in the first inline script of the top page, a script-written about:blank frame, a srcdoc
// frame, a cross-origin frame and a shadow root: with the Fonts option OFF the answers equal those of a browser without the extension;
// ON, every hidden probe name measures like a font that does not exist and every other name measures like the plain browser; a web font that
// the page defines under a hidden name still wins; a strict page CSP changes nothing and reports no violation; ordinary font stacks fall
// through to Arial or the generic family. What the shield exposes about itself (document.fonts lists the hidden families) is asserted too.
// ADR-110 addendum (owner decision 2026-11-07): the five platform aliases a genuine Windows browser resolves (Courier, Helvetica, MS Sans Serif, MS Serif, Times)
// are part of the Windows list and measure as in the plain browser, the Firefox-only aliases stay hidden; and a Windows list with font list noise (about 3 % of the
// optional names left out by a seed) hides exactly the left-out families, those the host resolves natively included.
// ADR-110 addendum 2 (owner decision 2026-11-07): a claimed region (Japan, Korea, China, Taiwan) keeps its regional CJK group and the base-script families of that region visible under the noise,
// the list of every other claim (the United States here) hides them; the proof is both the measurement and the shield faces of document.fonts. A host without the Windows supplemental language
// packs resolves few of those names natively: the evidence records how many names were checked and how many of them this host resolves.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { stageExtension } from './native-evidence.mjs';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';
import { FONT_PROBE_NAMES, PLATFORM_ALIASES, hiddenFontNames } from '../../apps/production-extension/font-probe-names.js';
import { windowsFonts, WINDOWS_FONT_GROUPS, REGION_FONT_GROUP_KEYS, regionFontRoots } from '../../apps/production-extension/fingerprint-font-groups.js';
import { fontNoiseHidden, noisyFontList } from '../../apps/production-extension/fingerprint-font-noise.js';
import { topPageHtml, framePageHtml, webFontPageHtml, webFontCss } from './font-shield-fixture.mjs';

const root = resolve(import.meta.dirname, '../..');
const browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome', installedChrome = process.argv.includes('--chrome') && browser === 'chrome';
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/font-shield-' + browser + (installedChrome ? '-installed' : '') + '-')), extension = join(run, 'extension');
const CONTROL = 'ZzNoSuchFont-9f2c', ROUTE_ORDINARY = 'Century Gothic';
// Probe names: every name of the shield list (the platform aliases are in it) and names that no list holds.
const UNLISTED = [CONTROL, 'Zz Another Missing Font', 'Detect Expert Sample Face'];
const NAMES = [...FONT_PROBE_NAMES, ...UNLISTED];
// The sandboxed frame (no allow-same-origin) is an opaque realm that the parent cannot hand a profile to: measured, compared with the plain browser
// when the option is OFF, and reported (not asserted) when it is ON, because the shield does not reach it (ADR-110, uncovered).
const CONTEXTS = ['top', 'blank', 'shadow', 'srcdoc', 'cross'], OPAQUE = ['sandbox'], METHODS = ['dom', 'canvas', 'svg', 'offscreen'];
const evidence = { at: new Date().toISOString(), browser: installedChrome ? 'chrome-installed' : browser, run, extensionSource: 'source', result: 'RUNNING', checks: [], scenarios: {} };
const check = message => { evidence.checks.push(message); console.log('  ok ' + message); };
const servers = [];
let opened = null, plain = null, phase = 'startup';

// ---- owned servers: the top page, a cross-origin frame host, a web font file ----------------------------------------------------------
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; font-src 'self'; frame-src *";
const fontFile = ['C:/Windows/Fonts/comicbd.ttf', 'C:/Windows/Fonts/arialbd.ttf'].find(path => existsSync(path)) ?? null;
async function server(handler) {
  const value = createServer((request, response) => { request.resume(); handler(new URL(request.url, 'http://x'), response); });
  await new Promise(done => value.listen(0, '127.0.0.1', done)); servers.push(value); return value.address().port;
}
const send = (response, body, type = 'text/html; charset=utf-8', headers = {}) => { response.setHeader('Content-Type', type); response.setHeader('Cache-Control', 'no-store'); for (const [key, value] of Object.entries(headers)) response.setHeader(key, value); response.end(body); };
const crossPort = await server((url, response) => send(response, framePageHtml(NAMES, 'cross')));
const port = await server((url, response) => {
  if (url.pathname === '/webfont.ttf' && fontFile) return send(response, readFileSync(fontFile), 'font/ttf');
  if (url.pathname === '/webfont.css') return send(response, webFontCss(ROUTE_ORDINARY), 'text/css; charset=utf-8');
  if (url.pathname === '/webfont') return send(response, webFontPageHtml(ROUTE_ORDINARY), 'text/html; charset=utf-8', url.searchParams.has('csp') ? { 'Content-Security-Policy': CSP } : {});
  send(response, topPageHtml(NAMES, { crossPort, ordinary: ROUTE_ORDINARY }), 'text/html; charset=utf-8', url.searchParams.has('csp') ? { 'Content-Security-Policy': CSP } : {});
});
const urls = { top: n => 'http://127.0.0.1:' + port + '/top?v=' + n, csp: n => 'http://127.0.0.1:' + port + '/top?csp=1&v=' + n, webfont: n => 'http://127.0.0.1:' + port + '/webfont?v=' + n, webfontCsp: n => 'http://127.0.0.1:' + port + '/webfont?csp=1&v=' + n };
let serial = 0;

// ---- a browser without the extension: the reference for "OFF equals plain" ----------------------------------------------------------------
async function startPlain() {
  if (browser === 'chrome') {
    const handle = await chromium.launch({ channel: installedChrome ? 'chrome' : 'chromium', headless: false, args: ['--window-position=-10000,-10000', '--no-first-run'] });
    const page = await (await handle.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
    return { version: handle.version(), probe: async url => { await page.goto(url); for (let i = 0; i < 300; i++) { const value = await page.evaluate(() => globalThis.__fontShield?.done ? globalThis.__fontShield : null); if (value) return value; await pause(100); } throw Error('plain probe timeout'); }, close: () => handle.close() };
  }
  const driver = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe'); assert.ok(existsSync(driver), 'geckodriver is required');
  let binary = process.env.FIREFOX_BINARY;
  if (!binary && process.platform === 'win32') binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  assert.ok(binary, 'Installed Firefox binary required');
  const profile = join(run, 'plain-firefox-profile'); mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, 'user.js'), ['browser.shell.checkDefaultBrowser', 'datareporting.policy.dataSubmissionEnabled', 'toolkit.telemetry.enabled', 'app.update.auto'].map(key => 'user_pref(' + JSON.stringify(key) + ',false);').join('\n') + '\nuser_pref("browser.startup.page",0);user_pref("network.proxy.type",0);');
  const ports = createServer(); await new Promise(done => ports.listen(0, '127.0.0.1', done)); const gdPort = ports.address().port; await new Promise(done => ports.close(done));
  const endpoint = 'http://127.0.0.1:' + gdPort, log = createWriteStream(join(run, 'plain-geckodriver.log'));
  const child = spawn(driver, ['--host', '127.0.0.1', '--port', String(gdPort), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true }); child.stdout.pipe(log); child.stderr.pipe(log);
  async function command(path, body, method = 'POST') { const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(60000) }); const value = (await response.json()).value; if (!response.ok || value?.error) throw Error(value?.error ?? 'WebDriver error'); return value; }
  await until(async () => { try { await command('/status', undefined, 'GET'); return true; } catch { return false; } }, 'plain geckodriver');
  const created = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } }), session = created.sessionId;
  const wd = (path, body, method) => command('/session/' + session + path, body, method);
  return { version: created.capabilities.browserVersion, probe: async url => { await wd('/url', { url }); for (let i = 0; i < 300; i++) { const text = await wd('/execute/sync', { script: 'return globalThis.__fontShield && globalThis.__fontShield.done ? JSON.stringify(globalThis.__fontShield) : null;', args: [] }); if (text) return JSON.parse(text); await pause(100); } throw Error('plain probe timeout'); },
    close: async () => { try { await command('/session/' + session, undefined, 'DELETE'); } finally { child.kill(); log.end(); } } };
}

// ---- the installed Chrome: the extension is loaded over the debugging pipe, as Chrome 137+ requires -------------------------------------
async function launchInstalled() {
  const profile = join(run, 'chrome-profile'); mkdirSync(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false, viewport: { width: 1180, height: 900 }, ignoreDefaultArgs: ['--disable-extensions'], args: ['--window-position=-10000,-10000', '--no-first-run', '--enable-unsafe-extension-debugging'] });
  try {
    const cdp = await context.browser().newBrowserCDPSession(); await cdp.send('Extensions.loadUnpacked', { path: extension }); await cdp.detach();
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); const base = worker.url().slice(0, worker.url().indexOf('/', 'chrome-extension://'.length) + 1);
    let page = await context.newPage(); await page.goto(base + 'options.html#settings'); page = await enableChromeUserScripts(context, page, new URL(base).host, evidence);
    return { version: context.browser().version(), base, evaluate: (fn, value) => page.evaluate(fn, value), goto: url => page.goto(url), click: selector => page.locator(selector).click(), close: () => context.close() };
  } catch (error) { await context.close(); throw error; }
}

const evaluate = (fn, value) => opened.evaluate(fn, value);
const message = body => evaluate(body => (globalThis.browser ?? globalThis.chrome).runtime.sendMessage({ schemaVersion: 1, ...body }), body);
const state = () => message({ type: 'ui-api-config-get', tabId: null });
async function ready() { await until(() => evaluate(() => document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy') === 'false' && Boolean(document.querySelector('[data-antidetect-master]'))), 'Antidetect ready'); }
async function probeExtension(url) {
  return JSON.parse(await evaluate(async url => {
    const api = globalThis.browser ?? globalThis.chrome, tab = await api.tabs.create({ url, active: false });
    try {
      for (let index = 0; index < 600; index++) {
        const current = await api.tabs.get(tab.id);
        if (current.status === 'complete') {
          // Firefox grants the all-sites host permission a moment after the scope is set: the first reads may be refused.
          let rows = [];
          try { rows = await api.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: () => globalThis.__fontShield?.done ? globalThis.__fontShield : null }); } catch (error) { if (!/host permission/iu.test(String(error?.message))) throw error; }
          // WebDriver writes doubles with 16 digits; the result travels as JSON text so that widths arrive exactly.
          if (rows[0]?.result) return JSON.stringify(rows[0].result);
        }
        await new Promise(done => setTimeout(done, 100));
      }
      throw Error('font fixture timeout');
    } finally { await api.tabs.remove(tab.id); }
  }, url));
}
// The Fonts option as a Custom row: `custom` with an allow-list, `bypass` for OFF; every other row stays Bypass. antidetectEnabled false is the master switch OFF.
async function configure({ mode, families = [], antidetectEnabled = true }) {
  const current = await state();
  const configuration = { ...current.configuration, enabled: false, antidetectEnabled, preset: 'custom', sites: [], apis: current.configuration.apis.map(row => row.id === 'canvas-font-policy'
    ? { ...row, mode, selected: mode === 'custom' ? { kind: 'value', value: { families, fallback: 'sans-serif' } } : { kind: 'unset' } } : { ...row, mode: 'bypass', selected: { kind: 'unset' } }) };
  const result = await message({ type: 'ui-api-config-set', tabId: null, expectedRevision: current.revision, configuration });
  assert.equal(result.type, 'api-config-state', JSON.stringify(result).slice(0, 300));
  if (mode === 'custom' && antidetectEnabled) assert.equal(result.registration, 'ready', 'the font row registers');
  return result;
}

// ---- comparisons -----------------------------------------------------------------------------------------------------------------------
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const comparable = result => ({ contexts: Object.fromEntries([...CONTEXTS, ...OPAQUE].filter(key => result.contexts[key]).map(key => [key, result.contexts[key].vectors])), localLoads: result.localLoads, localFontAccess: result.localFontAccess, ordinary: result.ordinary, fontEvents: result.fontEvents, fontsSettled: result.fontsSettled });
// A fresh Firefox still builds its font list in the background (measured: 211-214 probe names resolve in the first second, 232 from about the fifth
// second on, the same in every session): a measurement counts once the browser has had time to finish and three runs two seconds apart agree.
async function settled(read, need = 3) {
  if (browser === 'firefox') await pause(8000);
  let previous = await read(), streak = 1;
  for (let attempt = 0; attempt < 16 && streak < need; attempt++) { await pause(2000); const next = await read(); streak = same(comparable(previous), comparable(next)) ? streak + 1 : 1; previous = next; }
  if (streak < need) throw Error('the browser keeps changing its font answers');
  return previous;
}
// Firefox builds its table of alternative family names (Segoe UI Variable Display / Small, ...) in the background, so two Firefox processes can disagree on a few names for a
// while after start. A comparison with the plain browser is therefore repeated before it counts as a failure; a real difference stays through every attempt.
async function agreeing(attempt, tries = browser === 'firefox' ? 5 : 1) {
  let failure;
  for (let index = 0; index < tries; index++) {
    try { return await attempt(); } catch (error) { failure = error; if (index + 1 < tries) await pause(7000); }
  }
  throw failure;
}
function assertEqualsPlain(result, label) {
  assert.deepEqual(result.errors, [], label + ': page errors');
  assert.deepEqual(result.violations, [], label + ': CSP violations reported to the page');
  for (const key of [...CONTEXTS, ...OPAQUE]) assert.ok(result.contexts[key], label + ': context ' + key + ' reported');
  const a = comparable(plain.reference), b = comparable(result);
  for (const key of [...CONTEXTS, ...OPAQUE]) for (const method of METHODS) {
    const wrong = Object.keys(a.contexts[key][method] ?? {}).filter(name => !same(a.contexts[key][method][name], b.contexts[key][method]?.[name]));
    if (wrong.length) writeFileSync(join(run, 'mismatch-' + label.replace(/W+/gu, '-') + '-' + key + '-' + method + '.json'), JSON.stringify({ names: wrong.map(name => ({ name, plain: a.contexts[key][method][name], now: b.contexts[key][method]?.[name] })), plainControl: a.contexts[key][method][CONTROL], nowControl: b.contexts[key][method]?.[CONTROL] }, null, 1));
    assert.deepEqual(wrong, [], label + ': ' + key + '/' + method + ' differs from the plain browser for ' + wrong.slice(0, 8).join(', '));
  }
  assert.deepEqual(b.localLoads, a.localLoads, label + ': FontFace local() loads'); assert.equal(b.localFontAccess, a.localFontAccess, label + ': queryLocalFonts');
  assert.deepEqual(b.ordinary, a.ordinary, label + ': ordinary stacks');
  for (const key of CONTEXTS) { const facts = result.contexts[key].facts; if (facts) { assert.equal(facts.fontsSize, 0, label + ': ' + key + ' document.fonts is empty'); assert.equal(facts.adoptedStyleSheets, 0, label + ': ' + key + ' adopts nothing'); } }
}
// ON: hidden names measure like the control, every other name like the plain browser; the shield shows itself in document.fonts.
function assertShield(result, allowed, label) {
  assert.deepEqual(result.errors, [], label + ': page errors');
  assert.deepEqual(result.violations, [], label + ': CSP violations reported to the page');
  const hidden = new Set(hiddenFontNames(allowed)), summary = { hidden: hidden.size, installedAndHidden: [], installedAndKept: 0, contexts: {} };
  for (const key of CONTEXTS) {
    assert.ok(result.contexts[key], label + ': context ' + key + ' reported');
    for (const method of METHODS) {
      const on = result.contexts[key].vectors[method], off = plain.reference.contexts[key].vectors[method];
      if (method === 'offscreen' && !result.contexts[key].vectors.offscreenAvailable) continue;
      assert.ok(on && off, label + ': ' + key + '/' + method + ' measured');
      assert.deepEqual(on[''], off[''], label + ': ' + key + '/' + method + ' generic families are untouched');
      const failures = [];
      for (const name of NAMES) {
        const expected = hidden.has(name) ? on[CONTROL] : off[name];
        if (!same(on[name], expected)) failures.push(name + (hidden.has(name) ? ' (hidden)' : ' (kept)'));
      }
      assert.deepEqual(failures, [], label + ': ' + key + '/' + method + ' -> ' + failures.length + ' names measure wrongly: ' + failures.slice(0, 10).join(', '));
      if (key === 'top' && method === 'dom') {
        for (const name of NAMES) if (!same(off[name], off[CONTROL])) { if (hidden.has(name)) summary.installedAndHidden.push(name); else summary.installedAndKept++; }
      }
    }
    const facts = result.contexts[key].facts;
    if (facts) {
      assert.equal(facts.fontsSize, hidden.size, label + ': ' + key + ' document.fonts lists exactly the hidden families (the shield is not masked)');
      assert.equal(facts.adoptedStyleSheets, 1, label + ': ' + key + ' adopts one sheet'); assert.equal(facts.styleSheets, 0, label + ': ' + key + ' adds no <style>/<link> sheet');
      assert.ok(facts.faces.length && facts.faces.every(face => face.endsWith('|U+10FFFF|200%')), label + ': ' + key + ' faces carry the marker range');
      assert.deepEqual(facts.check, plain.reference.contexts[key].facts.check, label + ': ' + key + ' document.fonts.check() answers are the plain ones');
    }
  }
  // The sandboxed frame is reported, not asserted: how many natively resolved hidden names it still resolves.
  const opaque = result.contexts.sandbox;
  if (opaque) {
    const on = opaque.vectors, off = plain.reference.contexts.sandbox.vectors;
    const resolved = method => NAMES.filter(name => hidden.has(name) && !same(off[method][name], off[method][CONTROL])), still = method => resolved(method).filter(name => !same(on[method][name], on[method][CONTROL]));
    summary.sandbox = { domResolvedNatively: resolved('dom').length, domStillResolved: still('dom').length, canvasResolvedNatively: resolved('canvas').length, canvasStillResolved: still('canvas').length, fontsSize: opaque.facts?.fontsSize, adoptedStyleSheets: opaque.facts?.adoptedStyleSheets };
  }
  // FontFace local(): a hidden installed font fails like a missing one; everything else keeps the plain answer.
  const control = result.localLoads[CONTROL], localFailures = [];
  for (const name of NAMES) { const expected = hidden.has(name) ? control : plain.reference.localLoads[name]; if (result.localLoads[name] !== expected) localFailures.push(name + ': ' + result.localLoads[name] + ' vs ' + expected); }
  assert.deepEqual(localFailures, [], label + ': FontFace local() loads');
  summary.localInstalledAndHidden = NAMES.filter(name => hidden.has(name) && plain.reference.localLoads[name] === 'resolved').length;
  assert.equal(result.localFontAccess, plain.reference.localFontAccess, label + ': queryLocalFonts is not changed by the Fonts option');
  // Ordinary stacks keep rendering: a hidden family falls through to the next family of the list.
  const o = result.ordinary, p = plain.reference.ordinary;
  if (hidden.has(ROUTE_ORDINARY)) {
    assert.equal(o.hiddenThenArial, p.arial, label + ': "' + ROUTE_ORDINARY + '", Arial renders as Arial'); assert.equal(o.hiddenThenGeneric, p.generic, label + ': "' + ROUTE_ORDINARY + '", sans-serif renders as sans-serif');
    assert.equal(o.hiddenOnly, p.defaultFont, label + ': the hidden family alone renders in the default font'); assert.ok(o.hiddenOnly > 0 && o.hiddenThenArial > 0, label + ': text is not invisible');
  } else assert.equal(o.hiddenThenArial, p.hiddenThenArial, label + ': a kept family renders as before');
  assert.equal(o.computed, p.computed, label + ': getComputedStyle().fontFamily is the page value');
  // The shield is visible to the page in one more way (Chrome): the first layout with a hidden family makes the font set report loading and fire loading/loadingdone once.
  assert.equal(result.fontsSettled, 'loaded', label + ': document.fonts settles to loaded'); summary.fontEvents = result.fontEvents; summary.statusAfterFirstUse = o.fontsStatus;
  return summary;
}

async function main() {
  phase = 'stage';
  await stageExtension({ browser, target: extension, from: 'source' });
  phase = 'plain browser'; plain = await startPlain(); evidence.plainVersion = plain.version;
  plain.reference = await settled(() => plain.probe(urls.top(++serial))); plain.webfont = fontFile ? await plain.probe(urls.webfont(++serial)) : null;
  evidence.installedAmongProbeNames = NAMES.filter(name => !same(plain.reference.contexts.top.vectors.dom[name], plain.reference.contexts.top.vectors.dom[CONTROL])).length;
  assert.ok(evidence.installedAmongProbeNames >= 1, 'the plain browser must resolve at least one probe name, otherwise nothing can be hidden');
  assert.ok(plain.reference.contexts.top.vectors.dom[CONTROL] && !same(plain.reference.contexts.top.vectors.dom[CONTROL], plain.reference.contexts.top.vectors.dom['Arial']), 'the control name is absent and Arial is not');
  assert.equal(plain.reference.contexts.top.facts.fontsSize, 0);
  check('plain browser (' + plain.version + '): ' + NAMES.length + ' probe names, ' + evidence.installedAmongProbeNames + ' resolved natively, 5 contexts (top, about:blank, srcdoc, cross-origin, shadow root) x 4 measuring methods');

  phase = 'launch extension';
  opened = installedChrome ? await launchInstalled() : await launchOwnedManagement({ root, run, extension, browser, evidence });
  evidence.version = opened.version;
  await opened.goto(opened.base + 'options.html#settings'); await until(() => evaluate(() => Boolean(document.querySelector('[data-management-shell]'))), 'management mount');
  await message({ type: 'ui-data-consent-set', version: 1, accepted: true }); await message({ type: 'ui-set-scope', scopeMode: 'all-sites' });
  await opened.goto(opened.base + 'options.html?font-shield-native=1#antidetect'); await ready();
  if (browser === 'firefox') { await opened.click('[data-antidetect-grant-early]'); await ready(); assert.equal((await state()).earlyAccess, 'ready'); }

  // 1. The option OFF (row Bypass, master ON): byte-identical answers.
  phase = 'OFF'; await configure({ mode: 'bypass' });
  await agreeing(async () => assertEqualsPlain(await settled(() => probeExtension(urls.top(++serial))), 'Fonts OFF'));
  check('Fonts option OFF (master ON, row Bypass): every measurement, FontFace local() load, document.fonts fact and ordinary stack equals the plain browser');

  // 2. A realistic Windows 11 allow-list.
  phase = 'ON windows list'; const windows = windowsFonts({ windows11: true }); await configure({ mode: 'custom', families: windows });
  let result, summary;
  await agreeing(async () => { result = await probeExtension(urls.top(++serial)); summary = assertShield(result, windows, 'Windows list'); });
  evidence.scenarios.windowsList = { allowed: windows.length, ...summary, installedAndHidden: summary.installedAndHidden.length, sample: summary.installedAndHidden.slice(0, 12) };
  console.log('  sandboxed frame without allow-same-origin (not reached by the shield, reported): ' + JSON.stringify(summary.sandbox));
  check('Fonts ON with the Windows 11 list (' + windows.length + ' allowed, ' + summary.hidden + ' hidden): ' + summary.installedAndHidden.length + ' natively resolved probe names now measure like a missing font in top/about:blank/srcdoc/cross-origin/shadow root through DOM, SVG, Canvas and OffscreenCanvas; ' + summary.installedAndKept + ' kept names measure as before; FontFace local() hides ' + summary.localInstalledAndHidden + ' installed names');

  // 2b. The platform aliases: the five of a genuine Windows browser are in the list (measured as in the plain browser), the Firefox-only four are not (measured like a missing font).
  const resolvedHere = name => !same(plain.reference.contexts.top.vectors.dom[name], plain.reference.contexts.top.vectors.dom[CONTROL]);
  const shownAliases = PLATFORM_ALIASES.filter(name => windows.includes(name)), hiddenAliases = PLATFORM_ALIASES.filter(name => !windows.includes(name));
  assert.deepEqual(shownAliases, ['Courier', 'Helvetica', 'MS Sans Serif', 'MS Serif', 'Times']); assert.deepEqual(hiddenAliases, ['Helv', 'MS Shell Dlg', 'MS Shell Dlg 2', 'Tms Rmn']);
  for (const key of CONTEXTS) for (const method of METHODS) {
    const on = result.contexts[key].vectors[method], off = plain.reference.contexts[key].vectors[method];
    if (method === 'offscreen' && !result.contexts[key].vectors.offscreenAvailable) continue;
    for (const name of shownAliases) assert.ok(same(on[name], off[name]), 'alias ' + name + ' (' + key + '/' + method + ') measures as in the plain browser');
    for (const name of hiddenAliases) assert.ok(same(on[name], on[CONTROL]), 'alias ' + name + ' (' + key + '/' + method + ') measures like a missing font');
  }
  for (const name of shownAliases) assert.equal(result.localLoads[name], plain.reference.localLoads[name], 'FontFace local(' + name + ') answers as in the plain browser');
  for (const name of hiddenAliases) assert.equal(result.localLoads[name], result.localLoads[CONTROL], 'FontFace local(' + name + ') fails like a missing font');
  const aliasesResolved = shownAliases.filter(resolvedHere);
  if (process.platform === 'win32') assert.ok(aliasesResolved.length >= 1, 'this Windows host resolves at least one of the five platform aliases natively (got ' + aliasesResolved.length + ')');
  evidence.scenarios.windowsListAliases = { shown: shownAliases, shownResolvedNatively: aliasesResolved, hidden: hiddenAliases, hiddenResolvedNatively: hiddenAliases.filter(resolvedHere) };
  check('The five platform aliases (' + shownAliases.join(', ') + ') are in the Windows list and answer as in the plain browser (' + aliasesResolved.length + ' resolved natively on this host); the Firefox-only aliases (' + hiddenAliases.join(', ') + ') measure like a missing font in every context and method');

  // 3. A small allow-list: guarantees installed fonts are hidden on any Windows host.
  phase = 'ON small list'; const small = ['Arial', 'Times New Roman', 'Courier New']; await configure({ mode: 'custom', families: small });
  await agreeing(async () => { result = await probeExtension(urls.top(++serial)); summary = assertShield(result, small, 'Small list'); });
  assert.ok(summary.installedAndHidden.length >= 5, 'the small list hides at least five natively resolved names (got ' + summary.installedAndHidden.length + ')');
  evidence.scenarios.smallList = { allowed: small.length, ...summary, installedAndHidden: summary.installedAndHidden.length, sample: summary.installedAndHidden.slice(0, 12) };
  check('Fonts ON with a 3-name list: ' + summary.installedAndHidden.length + ' natively resolved names hidden everywhere, Arial / Times New Roman / Courier New measure as in the plain browser, ordinary stacks fall through to Arial');

  // 4. A strict page CSP changes nothing: the shield makes no fetch and no inline style.
  phase = 'ON under CSP';
  await agreeing(async () => { result = await probeExtension(urls.csp(++serial)); assert.ok(result.contexts.top.facts.fontsSize > 0, 'the CSP page still carries the shield'); summary = assertShield(result, small, 'Small list under CSP'); });
  check('Under a page CSP (default-src self, style-src self, font-src self) the shield hides the same names and the page receives no securitypolicyviolation event');

  // 5. A page-defined web font under a hidden name still wins.
  if (fontFile) {
    phase = 'web font'; const off = plain.webfont, on = await probeExtension(urls.webfont(++serial));
    assert.equal(on.loadError, undefined, 'the page face loads'); assert.ok(off.widths.w700 !== off.monospace, 'the web font renders in the plain browser');
    assert.deepEqual(on.widths, off.widths, 'the page web font renders exactly as in the plain browser for weights 300, 400, 700, 900 and italic');
    const csp = await probeExtension(urls.webfontCsp(++serial)); assert.deepEqual(csp.widths, off.widths, 'also under the CSP');
    check('A web font the page defines under a hidden family name (weight 700 only) is chosen for every request exactly as in the plain browser (font-stretch:200% keeps the shield the worst candidate)');
  } else check('No system font file for the web font check on this host (skipped)');

  // 5b. Font list noise: the Windows 11 list of a generated profile with noise. A seed that leaves out a family this host resolves natively makes the proof non-vacuous.
  phase = 'ON windows list with noise';
  let noiseSeed = 1; while (noiseSeed < 20000 && !fontNoiseHidden(windows, noiseSeed).some(resolvedHere)) noiseSeed++;
  const leftOut = fontNoiseHidden(windows, noiseSeed), noisy = noisyFontList(windows, noiseSeed), leftOutResolved = leftOut.filter(resolvedHere);
  assert.ok(leftOutResolved.length >= 1, 'a seed that leaves out a natively resolved family exists (seed ' + noiseSeed + ')');
  await configure({ mode: 'custom', families: noisy });
  await agreeing(async () => { result = await probeExtension(urls.top(++serial)); summary = assertShield(result, noisy, 'Windows list with font noise'); });
  for (const key of CONTEXTS) for (const method of METHODS) {
    const on = result.contexts[key].vectors[method], off = plain.reference.contexts[key].vectors[method];
    if (method === 'offscreen' && !result.contexts[key].vectors.offscreenAvailable) continue;
    for (const name of leftOutResolved) { assert.ok(!same(off[name], off[CONTROL]), name + ' resolves natively in the plain browser'); assert.ok(same(on[name], on[CONTROL]), name + ' (' + key + '/' + method + ') left out by the noise now measures like a missing font'); }
    for (const name of noisy.filter(resolvedHere)) assert.ok(same(on[name], off[name]), name + ' (' + key + '/' + method + ') kept by the noise measures as in the plain browser');
  }
  for (const name of leftOutResolved) assert.equal(result.localLoads[name], result.localLoads[CONTROL], 'FontFace local(' + name + ') fails like a missing font');
  evidence.scenarios.windowsListNoise = { seed: noiseSeed, allowed: noisy.length, leftOut, leftOutResolvedNatively: leftOutResolved, hidden: summary.hidden };
  check('Fonts ON with the Windows 11 list and font list noise (seed ' + noiseSeed + ': ' + leftOut.join(', ') + ' left out of the ' + windows.length + '): the ' + leftOutResolved.length + ' natively resolved left-out name(s) measure like a missing font everywhere, every kept name measures as in the plain browser');

  // 5c. ADR-110 addendum 2 (owner decision 2026-11-07): the claimed region keeps its regional CJK group and the base-script families of that region visible; the list of every other
  // claim hides them like any other name it does not allow. Run with the font list noise (the default), with a seed that leaves out a family this host resolves natively. Two proofs:
  // what the page can read without measuring (document.fonts has a shield face for each hidden family and none for a kept one) and what it measures (every probe name, as in 5b).
  // A host without the Windows supplemental language packs (Feature on Demand) resolves few of the regional names natively, so the counts are recorded, never assumed.
  phase = 'ON regional lists';
  const regionalClaims = [['Japan', 'regionJa'], ['Korea', 'regionKo'], ['China', 'regionZhHans'], ['Taiwan', 'regionZhHant'], ['United States', null]], regional = {};
  const regionalNames = REGION_FONT_GROUP_KEYS.flatMap(key => WINDOWS_FONT_GROUPS[key]), lowerName = name => name.toLowerCase();
  for (const [claim, group] of regionalClaims) {
    const list = windowsFonts({ windows11: true, regionGroup: group }), roots = regionFontRoots(group), own = group ? WINDOWS_FONT_GROUPS[group] : [], others = regionalNames.filter(name => !own.includes(name));
    let seed = 1; while (seed < 20000 && !fontNoiseHidden(list, seed, roots).some(resolvedHere)) seed++;
    const gone = fontNoiseHidden(list, seed, roots), kept = noisyFontList(list, seed, roots), goneResolved = gone.filter(resolvedHere), ownResolved = roots.filter(resolvedHere), othersResolved = others.filter(resolvedHere);
    assert.ok(goneResolved.length >= 1, claim + ': a seed that leaves out a natively resolved family exists (seed ' + seed + ')');
    for (const name of roots) assert.ok(kept.includes(name) && !gone.includes(name), claim + ': ' + name + ' (region or base-script family) is never left out by the noise');
    for (const name of others) assert.ok(!kept.includes(name), claim + ': ' + name + ' belongs to another region and is not in the list');
    await configure({ mode: 'custom', families: kept });
    await agreeing(async () => { result = await probeExtension(urls.top(++serial)); summary = assertShield(result, kept, claim + ' claim with noise'); });
    const hiddenCount = summary.hidden; let contextsRead = 0;
    for (const key of CONTEXTS) {
      const families = result.contexts[key].facts?.families; if (!families) continue;
      contextsRead++; const faces = new Set(families.map(lowerName));
      for (const name of roots) assert.ok(!faces.has(lowerName(name)), claim + ' (' + key + '): ' + name + ' has no shield face, it is kept');
      for (const name of [...others, ...gone]) assert.ok(faces.has(lowerName(name)), claim + ' (' + key + '): ' + name + ' has a shield face, it is hidden');
    }
    assert.ok(contextsRead >= 3, claim + ': document.fonts read in at least three contexts');
    for (const key of CONTEXTS) for (const method of METHODS) {
      const on = result.contexts[key].vectors[method], off = plain.reference.contexts[key].vectors[method];
      if (method === 'offscreen' && !result.contexts[key].vectors.offscreenAvailable) continue;
      for (const name of ownResolved) assert.ok(same(on[name], off[name]), claim + ': ' + name + ' (' + key + '/' + method + ') of the claimed region measures as in the plain browser');
      for (const name of [...othersResolved, ...goneResolved]) assert.ok(same(on[name], on[CONTROL]), claim + ': ' + name + ' (' + key + '/' + method + ') measures like a missing font');
    }
    for (const name of ownResolved) assert.equal(result.localLoads[name], plain.reference.localLoads[name], claim + ': FontFace local(' + name + ') answers as in the plain browser');
    for (const name of [...othersResolved, ...goneResolved]) assert.equal(result.localLoads[name], result.localLoads[CONTROL], claim + ': FontFace local(' + name + ') fails like a missing font');
    // The lock at work on names this host resolves natively (Japan): a seed whose noise WITHOUT the lock would leave out one of the base-script families of Japan is measured first as the
    // negative control (the name measures like a missing font), then with the lock (the name stays and measures as in the plain browser). The 17 supplemental names cannot be measured here.
    let lockEvidence = null;
    if (group === 'regionJa') {
      let lockSeed = 1; while (lockSeed < 20000 && !fontNoiseHidden(list, lockSeed).some(name => ownResolved.includes(name))) lockSeed++;
      const lost = fontNoiseHidden(list, lockSeed).filter(name => ownResolved.includes(name)), lockedList = noisyFontList(list, lockSeed, roots);
      assert.ok(lost.length >= 1, claim + ': a seed whose unlocked noise leaves out a natively resolved family of the region exists (seed ' + lockSeed + ')');
      for (const name of lost) assert.ok(lockedList.includes(name), claim + ': ' + name + ' is kept by the lock');
      for (const [state, families] of [['without the lock', noisyFontList(list, lockSeed)], ['with the lock', lockedList]]) {
        await configure({ mode: 'custom', families });
        await agreeing(async () => { result = await probeExtension(urls.top(++serial)); summary = assertShield(result, families, claim + ' ' + state); });
        for (const key of CONTEXTS) for (const method of METHODS) {
          const on = result.contexts[key].vectors[method], off = plain.reference.contexts[key].vectors[method];
          if (method === 'offscreen' && !result.contexts[key].vectors.offscreenAvailable) continue;
          for (const name of lost) assert.ok(same(on[name], state === 'with the lock' ? off[name] : on[CONTROL]), claim + ': ' + name + ' (' + key + '/' + method + ') ' + state + ' measures ' + (state === 'with the lock' ? 'as in the plain browser' : 'like a missing font'));
        }
      }
      lockEvidence = { seed: lockSeed, lost };
    }
    regional[claim] = { group, allowed: kept.length, hidden: hiddenCount, seed, leftOut: gone, leftOutResolvedNatively: goneResolved, regionNamesChecked: roots.length, regionNamesResolvedNatively: ownResolved, otherRegionNamesChecked: others.length, otherRegionNamesResolvedNatively: othersResolved, contextsRead, ...(lockEvidence ? { lock: lockEvidence } : {}) };
  }
  evidence.scenarios.regionalLists = regional;
  check('Fonts ON with regional Windows 11 lists and font list noise: ' + regionalClaims.map(([claim]) => claim + ' (' + regional[claim].allowed + ' allowed; ' + regional[claim].regionNamesChecked + ' names of the region and its base scripts kept, ' + regional[claim].regionNamesResolvedNatively.length + ' resolved natively here; ' + regional[claim].otherRegionNamesChecked + ' names of other regions hidden, ' + regional[claim].otherRegionNamesResolvedNatively.length + ' resolved natively here; ' + regional[claim].leftOutResolvedNatively.length + ' natively resolved noise name(s) hidden)').join('; ') + '; the lock at work: seed ' + regional.Japan.lock.seed + ' without it would leave out ' + regional.Japan.lock.lost.join(', ') + ' of Japan (measured like a missing font), with it the name stays (measured as in the plain browser) - every probe name measures right in top/about:blank/srcdoc/cross-origin/shadow root through all four methods, and document.fonts carries a shield face exactly for the hidden families');

  // 6. Strict claim: an empty allow-list hides the whole list, the platform aliases included (a Windows list shows five of them: scenario 2b; the noise: 5b).
  phase = 'ON empty list'; await configure({ mode: 'custom', families: [] });
  await agreeing(async () => { result = await probeExtension(urls.top(++serial)); summary = assertShield(result, [], 'Empty list'); });
  assert.ok(summary.installedAndHidden.length > evidence.scenarios.smallList.installedAndHidden, 'the empty list hides more than the small one');
  for (const alias of PLATFORM_ALIASES) assert.ok(same(result.contexts.top.vectors.dom[alias], result.contexts.top.vectors.dom[CONTROL]), 'platform alias ' + alias + ' is hidden like every unlisted-by-the-profile name');
  check('Fonts ON with an empty list (non-Windows claim): all ' + summary.hidden + ' probe names hidden (' + summary.installedAndHidden.length + ' natively resolved), the platform aliases (' + PLATFORM_ALIASES.join(', ') + ') included: a Windows list shows five of them, no list shows none');

  // 7. Back to native on new documents: Bypass, master OFF, Off.
  phase = 'revert';
  for (const [label, options] of [['row Bypass', { mode: 'bypass' }], ['master OFF with a Custom row', { mode: 'custom', families: windows, antidetectEnabled: false }], ['row Off', { mode: 'off' }]]) {
    await configure(options); await agreeing(async () => assertEqualsPlain(await probeExtension(urls.top(++serial)), label));
  }
  check('Bypass, master OFF with a retained Custom row and row Off all give the plain browser answers on new documents');

  evidence.result = 'PASS';
}

try { await main(); }
catch (failure) { evidence.result = 'FAIL'; evidence.phase = phase; evidence.failure = failure?.message ?? String(failure); throw failure; }
finally {
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(join(run, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  await opened?.close(); await plain?.close();
  for (const value of servers) await new Promise(done => value.close(done));
  console.log((evidence.result === 'PASS' ? 'PASS ' : 'FAIL ') + evidence.browser + ': ' + evidence.checks.length + ' checks; evidence in ' + run);
}
