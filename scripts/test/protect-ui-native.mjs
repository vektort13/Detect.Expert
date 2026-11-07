// ADR-047 (S3, port plan §2.5, §3, §5.2 «UI»): native render smoke of the module «Защита» islands in the shipped
// dist/chrome (Playwright channel 'chromium', fresh profile in .tmp). The module's service-worker answers are fixed by an
// init script only on pages opened with `?protectfixture=<name>` (as tests/extension/protect/ui-fixture.ts of 722fae8:
// nothing of it is bundled); every other request goes to the real production service worker. The state / projection
// builders are the vendored test support packages/ui/test/protect-firewall-support.ts (synthetic domains, no values).
// S4b: the firewall decision card is its own popup (firewall.html): the main popup shows one firewall line instead,
// the card states render in firewall.html at 400 px (screenshots in protect/firewall-popup/), the side panel has none.
// Checks: the popup / side panel island is empty while the module is off; the Options launcher row and the hash routes
// #protect|#firewall|#history|#requests; activation is one explicit click on the launcher / Options header switch without any
// dialog or inline consent (ADR-098, over ADR-053/062); the island survives
// the production polling and a language change; ru and en texts, other languages show English with lang="en" and the
// fallback note; no raw catalog keys, no page errors or console errors; no horizontal overflow; light and dark
// screenshots into test-results/production-1.1.0/protect/ui/. With the real service worker (after S2 wiring), the
// module-off answer of ui-protect-get-state is checked too; before that the check is reported as «после S2».
// With an explicit complete baseline package, the module-off popup is compared pixel for pixel against that build;
// popup open time and bundle growth are recorded without a threshold (E21-09). A historical pre-port package is not
// an implicit baseline for later authorized UI changes. Without --baseline, this comparison is reported as pending.
// Usage: node scripts/test/protect-ui-native.mjs [--dist <unpacked dir>] [--baseline <unpacked baseline extension>]
//        (default dist/chrome after pnpm build:chrome; choose a comparable pre-task baseline explicitly)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '../..');
const distArg = process.argv.indexOf('--dist');
const extensionInput = distArg > 0 ? resolve(process.argv[distArg + 1]) : join(root, 'dist/chrome');
const baselineArg = process.argv.indexOf('--baseline');
assert.ok(baselineArg < 0 || (typeof process.argv[baselineArg + 1] === 'string' && !process.argv[baselineArg + 1].startsWith('--')), '--baseline requires a complete unpacked extension directory');
const baseline = baselineArg > 0 ? resolve(process.argv[baselineArg + 1]) : null;
const artifact = join(root, 'test-results/production-1.1.0/protect/ui');
mkdirSync(artifact, { recursive: true });
/** S4b: screenshots of firewall.html (the firewall as its own popup) go next to the native popup check. */
const FIREWALL_DIR = 'firewall-popup';
mkdirSync(join(root, 'test-results/production-1.1.0/protect', FIREWALL_DIR), { recursive: true });
mkdirSync(join(root, '.tmp'), { recursive: true });
// Freeze native inputs before the release owner rebuilds the shared dist directory.
const extension = join(mkdtempSync(join(root, '.tmp/protect-ui-input-')), 'extension');
cpSync(extensionInput, extension, { recursive: true });
const RAW_KEY = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?:\[.*\])?$/;

for (const file of ['popup.js', 'sidepanel.js', 'options.js']) {
  assert.ok(readFileSync(join(extension, file), 'utf8').includes('import { createProtectHostUi } from "./protect-ui.js";'), file + ': dist/chrome is not built with the protect islands (run pnpm build:chrome)');
}

/** Vendored fixture builders (types only imports; bundled in memory). */
async function supportModule() {
  const vendor = join(root, 'vendor/protect-722fae8');
  const result = await build({ entryPoints: [join(vendor, 'packages/ui/test/protect-firewall-support.ts')], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent', absWorkingDir: vendor });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

const support = await supportModule();
const offState = support.fwState({ state: 'off', consentVersion: null, features: [], decisions: 0, history: null });
const activeState = support.fwState({ features: ['value-match', 'firewall', 'session-replay', 'history', 'gpc'], history: { records: 4, truncated: false } });
const fixtures = {};
for (const screen of support.FW_SCREENS) {
  // Snoozed relative to now: the vendored default instant (2026-10-18 10:00 UTC) would already be over.
  const s = support.fwScenario(screen, Date.now());
  fixtures[screen] = { state: s.state, reports: [s.report], decide: s.decide, rules: support.fwRuleRows(12) };
}
fixtures.off = { state: offState, reports: [null], decide: null, rules: [] };
fixtures['permission-denied'] = { ...fixtures.off, permissionDenied: true };
fixtures['managed-mid-edit'] = { ...fixtures.off };
fixtures.active = { state: activeState, reports: [support.fwScenario('sent').report], decide: null, rules: support.fwRuleRows(12) };

const evidence = { browser: null, startedAt: new Date().toISOString(), checks: [], pending: [], screens: [], errors: [], console: [], rawKeys: [], overflow: [], sizes: {},
  hashes: Object.fromEntries(['manifest.json', 'protect-ui.js', 'protect.css', 'options.js'].map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
const profile = mkdtempSync(join(root, '.tmp/protect-ui-profile-'));
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 400, height: 640 }, args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
evidence.browser = context.browser()?.version() ?? null;
context.on('page', (page) => {
  page.on('pageerror', (error) => evidence.errors.push(page.url() + ': ' + error.message));
  page.on('console', (message) => { if (message.type() === 'error') evidence.console.push(page.url() + ': ' + message.text()); });
});
const fixtureInit = ({ fixtures }) => {
  if (location.protocol !== 'chrome-extension:') return;
  const name = new URLSearchParams(location.search).get('protectfixture');
  if (name === null || !Object.hasOwn(fixtures, name)) return;
  const data = fixtures[name];
  const log = { requests: [], permissionRequests: [], enableRequests: [] };
  window.__protectFixture = log;
  let state = data.state;
  let current = data.reports[0] ?? null;
  let saved = null;
  let rules = data.rules ?? [];
  // Explicit UI fixtures only: deliver a changed valid state through the same
  // local-storage subscription used by useProtectState, without touching storage.
  const observers = new Set(), localEvent = chrome.storage.local.onChanged;
  const addLocal = localEvent.addListener.bind(localEvent), removeLocal = localEvent.removeListener.bind(localEvent);
  localEvent.addListener = callback => { observers.add(callback); return addLocal(callback); };
  localEvent.removeListener = callback => { observers.delete(callback); return removeLocal(callback); };
  log.setState = next => { state = next; for (const callback of [...observers]) callback({ protect: { newValue: {} } }, 'local'); };
  if (data.permissionDenied === true) chrome.permissions.request = request => { log.permissionRequests.push(request); return Promise.resolve(false); };
  const withoutPrompt = (r) => (r === null ? null : { ...r, firewall: { ...r.firewall, prompt: null } });
  const rulesAnswer = (request) => {
    let rows = rules;
    const filter = request.domainFilter;
    if (typeof filter === 'string') rows = rows.filter((r) => String(r.receiver).includes(filter) || String(r.site ?? '').includes(filter));
    if (request.action !== undefined) rows = rows.filter((r) => r.action === request.action);
    const offset = Number(request.offset ?? 0);
    const limit = Number(request.limit ?? 200);
    return { schemaVersion: 1, type: 'protect-rules', total: rows.length, rows: rows.slice(offset, offset + limit), preset: state.preset, stoppedDays: [{ day: '2026-10-18', count: 4 }] };
  };
  const answer = (request) => {
    switch (request.type) {
      case 'ui-protect-get-state': return { schemaVersion: 1, type: 'protect-state', state };
      case 'ui-protect-get-report': return { schemaVersion: 1, type: 'protect-report', report: current };
      case 'ui-protect-decide':
        saved = current;
        current = withoutPrompt(current);
        return { schemaVersion: 1, type: 'protect-decision', applied: data.decide?.applied ?? [], undoId: data.decide?.undoId ?? null, report: null };
      case 'ui-protect-undo': current = saved; return { schemaVersion: 1, type: 'protect-decision', applied: [], undoId: null, report: null };
      case 'ui-protect-dismiss': current = withoutPrompt(current); return { schemaVersion: 1, type: 'protect-decision', applied: [], undoId: null, report: null };
      case 'ui-protect-set-settings': state = { ...state, ...(typeof request.preset === 'string' ? { preset: request.preset } : {}) }; return { schemaVersion: 1, type: 'protect-state', state };
      case 'ui-protect-list-rules': return rulesAnswer(request);
      // ADR-098: one explicit toggle click is the whole activation. The fixture records the single enable command and
      // answers it like the controller does: the module becomes active with exactly the requested choices, and the other
      // islands of the page learn it through the same storage subscription (setState), as after a real storage write.
      case 'ui-protect-enable':
        log.enableRequests.push({ consentVersion: request.consentVersion, features: request.features, preset: request.preset });
        log.setState({ ...state, state: 'active', consentVersion: request.consentVersion, features: request.features, preset: request.preset });
        return { schemaVersion: 1, type: 'protect-state', state };
      default: return { schemaVersion: 1, type: 'ok', reportRevision: null };
    }
  };
  const original = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (request, ...rest) => {
    if (request !== null && typeof request === 'object' && typeof request.type === 'string' && request.type.startsWith('ui-protect-')) {
      log.requests.push(request.type);
      return Promise.resolve(answer(request));
    }
    return original(request, ...rest);
  };
};
await context.addInitScript(fixtureInit, { fixtures });

const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
const id = new URL(worker.url()).host;
const base = 'chrome-extension://' + id + '/';

async function rawKeysAndOverflow(page, label) {
  const found = await page.evaluate((pattern) => {
    const re = new RegExp(pattern);
    const out = { keys: [], overflow: document.documentElement.scrollWidth > innerWidth + 1 ? [document.documentElement.scrollWidth, innerWidth] : null };
    const scopes = [...document.querySelectorAll('[data-protect-island], .protect-page, .protect-firewall__bar, #root[data-protect-requests], body.protect-requests #root')];
    if (location.pathname === '/requests.html') scopes.push(document.body);
    for (const scope of scopes) {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node.textContent.trim();
        if (text.length > 0 && re.test(text)) out.keys.push(text);
      }
      for (const el of scope.querySelectorAll('[aria-label], [title], [placeholder]')) {
        for (const name of ['aria-label', 'title', 'placeholder']) {
          const value = el.getAttribute(name);
          if (value !== null && re.test(value.trim())) out.keys.push(name + '=' + value);
        }
      }
    }
    return out;
  }, RAW_KEY.source);
  if (found.keys.length > 0) evidence.rawKeys.push({ label, keys: found.keys });
  if (found.overflow !== null) evidence.overflow.push({ label, overflow: found.overflow });
}

async function shot(page, name, fullPage = true, dir = 'ui') {
  const file = join(root, 'test-results/production-1.1.0/protect', dir, name + '.png');
  await page.screenshot({ path: file, fullPage });
  evidence.screens.push({ file: 'test-results/production-1.1.0/protect/' + dir + '/' + name + '.png', sha256: createHash('sha256').update(readFileSync(file)).digest('hex') });
}

async function setLanguage(page, language) {
  await page.evaluate((value) => chrome.storage.local.set({ 'ui-language-v1': value }), language);
  await page.waitForFunction((value) => document.documentElement.lang.toLowerCase().startsWith(value), language);
}

/**
 * Light and dark screenshots. Popup (firstScreen): the first screen of a 400 x 600 popup, then the whole popup in a
 * tall viewport (the sticky decision row then sits in its place instead of over the card).
 */
async function themes(page, name, action = null, { firstScreen = false, dir = 'ui' } = {}) {
  const size = page.viewportSize();
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.waitForTimeout(120);
    if (action !== null) await action(theme);
    await rawKeysAndOverflow(page, name + '/' + theme);
    if (firstScreen) {
      await page.setViewportSize({ width: size.width, height: 600 });
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(80);
      await shot(page, name + '-' + theme + '-first', false, dir);
      await page.setViewportSize({ width: size.width, height: 2400 });
      await page.waitForTimeout(80);
      await shot(page, name + '-' + theme, true, dir);
      await page.setViewportSize(size);
    } else {
      await shot(page, name + '-' + theme, true, dir);
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

/** Opens popup.html (module off) in a context: light / dark PNGs of the whole popup and the median open time. */
async function popupProbe(ctx, origin) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 400, height: 600 });
  await p.goto(origin + 'options.html');
  await p.locator('.language-picker__trigger').waitFor();
  await p.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true }).catch(() => null));
  await p.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'ru' }));
  const times = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await p.goto(origin + 'popup.html?protectfixture=off');
    await p.locator('[data-observation-master]').waitFor();
    times.push(Date.now() - start);
  }
  await p.waitForTimeout(1500);
  const shots = {};
  for (const theme of ['light', 'dark']) {
    await p.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await p.waitForTimeout(250);
    shots[theme] = await p.screenshot({ fullPage: true });
  }
  await p.close();
  times.sort((a, b) => a - b);
  return { shots, medianMs: times[2], times };
}

/** Number of differing pixels of two PNGs (decoded by the browser, compared on a canvas). */
async function pixelDiff(page, a, b) {
  await page.goto('about:blank');
  return page.evaluate(async ([x, y]) => {
    const load = (data) => new Promise((done, fail) => { const img = new Image(); img.onload = () => done(img); img.onerror = fail; img.src = 'data:image/png;base64,' + data; });
    const [one, two] = await Promise.all([load(x), load(y)]);
    if (one.width !== two.width || one.height !== two.height) return { size: [one.width, one.height, two.width, two.height], pixels: -1 };
    const read = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const p = read(one);
    const q = read(two);
    let pixels = 0;
    for (let i = 0; i < p.length; i += 4) if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2] || p[i + 3] !== q[i + 3]) pixels++;
    return { size: [one.width, one.height], pixels };
  }, [a.toString('base64'), b.toString('base64')]);
}

/** Module off: compare two complete packages, preserving each build's own UI assets. */
async function compareWithBaseline(page) {
  if (baseline === null) {
    evidence.pending.push({ check: 'module-off popup equals the explicit baseline popup', status: 'no --baseline package supplied' });
    return;
  }
  assert.notEqual(baseline, extension, 'baseline must be a separately captured complete package');
  for (const file of ['manifest.json', 'popup.js', 'popup.html', 'popup.css', 'sidepanel.js', 'options.js']) {
    assert.ok(existsSync(join(baseline, file)), 'baseline package is missing ' + file + ': ' + baseline);
  }
  const dir = mkdtempSync(join(root, '.tmp/protect-ui-baseline-'));
  cpSync(baseline, join(dir, 'ext'), { recursive: true });
  const ours = await popupProbe(context, base);
  const other = await chromium.launchPersistentContext(join(dir, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 400, height: 640 }, args: ['--disable-extensions-except=' + join(dir, 'ext'), '--load-extension=' + join(dir, 'ext')] });
  let theirs;
  try {
    // Compare the same module-off state in both builds; modern baselines also render the launcher island.
    await other.addInitScript(fixtureInit, { fixtures });
    const w = other.serviceWorkers()[0] ?? await other.waitForEvent('serviceworker');
    theirs = await popupProbe(other, 'chrome-extension://' + new URL(w.url()).host + '/');
  } finally {
    await other.close();
  }
  const diff = {};
  for (const theme of ['light', 'dark']) {
    diff[theme] = await pixelDiff(page, ours.shots[theme], theirs.shots[theme]);
    writeFileSync(join(artifact, 'popup-off-current-' + theme + '.png'), ours.shots[theme]);
    writeFileSync(join(artifact, 'popup-off-baseline-' + theme + '.png'), theirs.shots[theme]);
  }
  evidence.baselineComparison = {
    baseline: baseline.split('\\').join('/'),
    baselineFilesSha256: Object.fromEntries(['manifest.json', 'popup.js', 'popup.html', 'popup.css', 'protect-ui.js', 'protect.css'].filter((f) => existsSync(join(baseline, f))).map((f) => [f, createHash('sha256').update(readFileSync(join(baseline, f))).digest('hex')])),
    pixelsDiffering: diff,
    popupOpenMedianMs: { current: ours.medianMs, baseline: theirs.medianMs, delta: ours.medianMs - theirs.medianMs, runs: { current: ours.times, baseline: theirs.times } },
    bundleBytes: Object.fromEntries(['popup.js', 'sidepanel.js', 'options.js'].map((f) => [f, { baseline: statSync(join(baseline, f)).size, current: statSync(join(extension, f)).size }])),
    moduleUiBytes: { 'protect-ui.js': statSync(join(extension, 'protect-ui.js')).size, 'protect.css': statSync(join(extension, 'protect.css')).size },
  };
  for (const theme of ['light', 'dark']) assert.equal(diff[theme].pixels, 0, 'module off: popup equals the explicit baseline popup (' + theme + ') ' + JSON.stringify(diff[theme]));
  evidence.checks.push('module off: popup pixel-identical to the explicit baseline popup (light, dark); open time and bundle growth recorded');
}

async function dnrPermissionProbe(page) {
  const manifest = JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8'));
  if (!(manifest.permissions ?? []).includes('declarativeNetRequestWithHostAccess')) {
    evidence.pending.push({ check: 'required DNR: permissions.request resolves true without a prompt', status: 'после S2 (manifest without the required permission)' });
    return;
  }
  await page.goto(base + 'options.html');
  await page.locator('.language-picker__trigger').waitFor();
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 's3-dnr-probe';
    button.textContent = 'probe';
    button.addEventListener('click', () => {
      window.__dnrProbe = { state: 'pending' };
      chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'], permissions: ['declarativeNetRequestWithHostAccess'] })
        .then((granted) => { window.__dnrProbe = { state: 'done', granted }; }, (error) => { window.__dnrProbe = { state: 'rejected', error: String(error) }; });
    });
    document.body.append(button);
  });
  await page.locator('#s3-dnr-probe').click();
  await page.waitForFunction(() => window.__dnrProbe !== undefined && window.__dnrProbe.state !== 'pending', null, { timeout: 5000 }).catch(() => null);
  const request = await page.evaluate(() => window.__dnrProbe ?? null);
  const contains = await page.evaluate(() => chrome.permissions.contains({ permissions: ['declarativeNetRequestWithHostAccess'] }));
  const remove = await page.evaluate(() => chrome.permissions.remove({ permissions: ['declarativeNetRequestWithHostAccess'] }).then((removed) => ({ removed }), (error) => ({ error: String(error) })));
  const after = await page.evaluate(() => chrome.permissions.contains({ permissions: ['declarativeNetRequestWithHostAccess'] }));
  evidence.dnrPermission = { request, contains, remove, containsAfterRemove: after };
  assert.deepEqual(request, { state: 'done', granted: true }, 'required DNR: permissions.request of the consent gesture resolves true without a prompt');
  assert.equal(contains, true);
  assert.equal(after, true, 'required DNR stays granted after permissions.remove');
  assert.notEqual(remove.removed, true, 'permissions.remove of a required permission does not succeed');
  evidence.checks.push('required DNR (Q1): permissions.request of the consent gesture resolves true without a prompt; permissions.remove is refused and the grant stays');
}

try {
  const page = await context.newPage();
  await page.goto(base + 'options.html');
  await page.locator('.language-picker__trigger').waitFor();
  const consent = await page.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true }).catch((error) => ({ error: String(error) })));
  evidence.dataConsent = consent?.accepted === true;
  await setLanguage(page, 'ru');

  // Real service worker: module-off answer (only once S2 wired protect-sw.js into background.js).
  const real = await page.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-protect-get-state' }).catch((error) => ({ error: String(error) })));
  if (real !== null && typeof real === 'object' && real.type === 'protect-state') {
    assert.equal(real.state.state, 'off', 'real SW: module off by default');
    evidence.checks.push('real SW: ui-protect-get-state from Options answers state off');
    await page.goto(base + 'popup.html');
    await page.locator('[data-protect-island="popup"]').waitFor({ state: 'attached' });
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('[data-protect-island="popup"] *').count(), 0, 'real SW: popup island empty while the module is off');
    evidence.checks.push('real SW: popup island empty while the module is off');
  } else {
    evidence.pending.push({ check: 'real SW: ui-protect-get-state answers off; popup island empty with the real module state', status: 'после S2', answer: real });
  }

  // 1. Popup, module off (fixture): island present and empty; the production popup is unchanged around it.
  await page.setViewportSize({ width: 400, height: 640 });
  await page.goto(base + 'popup.html?protectfixture=off');
  await page.locator('[data-protect-island="popup"]').waitFor({ state: 'attached' });
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('[data-protect-island="popup"] *').count(), 0, 'popup island empty while the module is off');
  assert.equal(await page.locator('[data-protect-island="popup"]').evaluate((el) => getComputedStyle(el).display), 'contents');
  evidence.checks.push('popup: island empty and display: contents while the module is off');
  await themes(page, 'popup-off', null, { firstScreen: true });

  // 2. S4b (owner requirement): the firewall card is its own popup, firewall.html, never a card among the findings.
  //    The main popup with a waiting prompt shows one firewall line (no decision card) that opens firewall.html.
  for (const screen of ['sent', 'snoozed']) {
    await page.goto(base + 'popup.html?protectfixture=' + screen);
    await page.locator('[data-fw-line]').waitFor();
    assert.equal(await page.locator('[data-fw-line]').getAttribute('data-fw-line'), screen === 'sent' ? 'pending' : 'snoozed');
    assert.equal(await page.locator('[data-fw-card], [data-fw-action], [data-fw-snoozed]').count(), 0, screen + ': no firewall card in the main popup');
    await themes(page, 'popup-' + screen, null, { firstScreen: true });
  }
  await page.goto(base + 'popup.html?protectfixture=sent');
  await page.locator('[data-fw-line-open]').click();
  await page.waitForURL(/\/firewall\.html\?tab=\d+$/);
  await page.locator('[data-protect-firewall]').waitFor();
  evidence.checks.push('popup: firewall line (pending / snoozed) instead of the decision card; the line opens firewall.html?tab=<id>');

  // 3. firewall.html: card states at the popup width (400 px).
  await page.setViewportSize({ width: 400, height: 640 });
  for (const screen of ['sent', 'stopped', 'multi', 'warn-only', 'snoozed']) {
    await page.goto(base + 'firewall.html?tab=1&protectfixture=' + screen);
    await page.locator(screen === 'snoozed' ? '[data-fw-snoozed]' : '[data-fw-card]').waitFor();
    await page.locator('.protect-firewall__empty').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.protect-firewall__empty').evaluate((el) => getComputedStyle(el).display), 'none', screen + ': the empty line stays hidden');
    if (screen !== 'snoozed') {
      const boxes = await page.locator('.fw-action').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { width: r.width, height: r.height }; }));
      if (screen !== 'warn-only') {
        assert.equal(boxes.length, 2, screen + ': two decision buttons');
        assert.ok(Math.abs(boxes[0].width - boxes[1].width) <= 1 && Math.abs(boxes[0].height - boxes[1].height) <= 1, screen + ': decision buttons of equal weight ' + JSON.stringify(boxes));
      }
    }
    await themes(page, 'fixture-' + screen, null, { firstScreen: true, dir: FIREWALL_DIR });
  }
  evidence.checks.push('firewall.html: card sent / stopped / multi / warn-only / snoozed rendered at 400 px; decision buttons equal');

  // 4. Decision and resolved state (firewall.html).
  await page.goto(base + 'firewall.html?tab=1&protectfixture=resolved-blocked');
  await page.locator('[data-fw-card]').waitFor();
  await page.locator('.fw-action').first().click();
  await page.locator('.fw-resolved, [data-fw-resolved]').first().waitFor();
  await themes(page, 'fixture-resolved-blocked', null, { firstScreen: true, dir: FIREWALL_DIR });
  evidence.checks.push('firewall.html: decision click shows the resolved state');
  await page.setViewportSize({ width: 400, height: 640 });

  // 5. The island survives the production polling (1 s) and a language change; fallback languages show English.
  await page.goto(base + 'popup.html?protectfixture=sent');
  await page.locator('[data-fw-line]').waitFor();
  await page.locator('[data-fw-line]').evaluate((el) => { el.dataset.s3Mark = 'kept'; });
  await page.waitForTimeout(3500);
  assert.equal(await page.locator('[data-fw-line][data-s3-mark="kept"]').count(), 1, 'island DOM kept across the production re-renders');
  const ruLine = await page.locator('[data-fw-line] .state__line').innerText();
  await setLanguage(page, 'en');
  await page.waitForFunction((before) => { const el = document.querySelector('[data-fw-line] .state__line'); return el !== null && el.textContent !== before; }, ruLine);
  assert.equal(await page.locator('[data-protect-island="popup"]').getAttribute('lang'), 'en');
  await rawKeysAndOverflow(page, 'popup-sent/en');
  await shot(page, 'popup-sent-en-light');
  await setLanguage(page, 'de');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-protect-island="popup"]').getAttribute('lang'), 'en', 'German UI: module island in English');
  assert.equal(await page.locator('[data-fw-line][data-s3-mark="kept"]').count(), 1, 'island DOM kept across the language changes');
  await rawKeysAndOverflow(page, 'popup-sent/de');
  await page.setViewportSize({ width: 400, height: 640 });
  await page.goto(base + 'firewall.html?tab=1&protectfixture=sent');
  await page.locator('[data-fw-card]').waitFor();
  assert.equal(await page.locator('[data-protect-firewall]').getAttribute('lang'), 'en', 'German UI: firewall page in English');
  await rawKeysAndOverflow(page, 'firewall-sent/de');
  // firewall.html reads the language once (a short-lived popup); the language goes back on a production page.
  await page.setViewportSize({ width: 400, height: 640 });
  await page.goto(base + 'popup.html?protectfixture=sent');
  await page.locator('[data-fw-line]').waitFor();
  await setLanguage(page, 'ru');
  evidence.checks.push('popup: island kept across 1 s polling and ru -> en -> de -> ru; de shows English with lang="en" (popup and firewall.html)');

  // 6. Side panel: no firewall decision card there either.
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto(base + 'sidepanel.html?protectfixture=active');
  await page.locator('[data-protect-sidepanel]').waitFor();
  assert.equal(await page.locator('[data-fw-card], [data-fw-action]').count(), 0, 'side panel: no firewall card');
  await themes(page, 'sidepanel-active');
  evidence.checks.push('side panel: tabs «Защита» / «Кто узнаёт» rendered, no firewall card');

  // 6. Compact launcher activation and the unified Options Firewall panel (module off).
  // ADR-098 (over ADR-053/062/090): one explicit click on the launcher / Options header switch is the whole activation.
  // The activation dialog and the Options inline consent no longer exist; only a dormant unrelated dialog may remain.
  const DEFAULT_FEATURES = ['value-match', 'firewall', 'session-replay'];
  const ACTIVATION_DIALOGS = '#firewall-launcher-consent, [data-protect-inline-consent], [data-consent-confirm], dialog[open], [aria-modal="true"]';
  await page.setViewportSize({ width: 400, height: 900 });
  await page.goto(base + 'popup.html?protectfixture=off');
  await page.locator('[data-protect-launcher]').waitFor();
  await themes(page, 'options-launcher-off', async () => { await page.locator('[data-protect-launcher]').scrollIntoViewIfNeeded(); });
  assert.deepEqual(await page.evaluate(() => window.__protectFixture.enableRequests), [], 'mounting the OFF launcher never enables');
  await page.locator('[data-protect-settings]').click();
  await page.locator('[data-protect-launcher] [data-protect-state="active"]').waitFor();
  assert.equal(new URL(page.url()).hash, '', 'launcher activation does not change the route');
  assert.equal(await page.locator(ACTIVATION_DIALOGS).count(), 0, 'launcher activation shows no dialog or inline consent');
  const launcherEnable = await page.evaluate(() => window.__protectFixture.enableRequests);
  assert.equal(launcherEnable.length, 1, 'one click sends one enable command'); assert.deepEqual(launcherEnable[0].features, DEFAULT_FEATURES); assert.equal(launcherEnable[0].preset, 'normal');
  assert.equal(await page.locator('[data-protect-settings]').getAttribute('aria-checked'), 'true');
  await themes(page, 'options-launcher-activated', async () => { await page.locator('[data-protect-launcher]').scrollIntoViewIfNeeded(); });
  evidence.checks.push('popup launcher: one click sends one enable command with the canonical defaults (value-match, firewall, session-replay; normal), no dialog, no route change, state follows the answer');
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto(base + 'options.html?protectfixture=off#protect');
  await page.locator('[data-protect-page]').waitFor();
  assert.equal(new URL(page.url()).hash, '#protect');
  // ADR-090/098: the workspace header switch owns power; the lower «enable» button stays in the DOM but hidden.
  const master = page.locator('[data-workspace-master="firewall"] [data-protect-toggle="status"]'); await master.waitFor();
  assert.equal(await master.getAttribute('aria-checked'), 'false'); await page.locator('[data-protect-enable]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('[data-protect-enable]').isVisible(), false, 'the lower enable button is hidden: the header switch is the single power control');
  const offFeatures = page.locator('[data-protect-features] input[type="checkbox"]'), offPresets = page.locator('[data-protect-preset-preview] input[type="radio"]');
  assert.equal(await offFeatures.count(), 5); assert.equal(await offPresets.count(), 3);
  for (const control of [...await offFeatures.all(), ...await offPresets.all()]) { assert.equal(await control.isVisible(), true); assert.equal(await control.isDisabled(), true); }
  evidence.offPreview = await page.evaluate(() => { const root = document.querySelector('[data-protect-page]'); return { text: getComputedStyle(root).color, groups: [...root.querySelectorAll('[data-protect-controls="disabled"]')].map(group => ({ color: getComputedStyle(group).color, opacity: getComputedStyle(group).opacity, labelColors: [...group.querySelectorAll('label')].map(label => getComputedStyle(label).color) })) }; });
  assert.equal(evidence.offPreview.groups.length, 2); for (const group of evidence.offPreview.groups) { assert.notEqual(group.color, evidence.offPreview.text, 'OFF preview has muted text'); assert.equal(group.opacity, '1', 'readable native disabled controls are not faded as one panel'); assert.ok(group.labelColors.every(color => color === group.color)); }
  const offMutations = await page.evaluate(() => window.__protectFixture.requests.filter(type => ['ui-protect-enable', 'ui-protect-disable', 'ui-protect-set-settings', 'ui-protect-purge'].includes(type)));
  assert.deepEqual(offMutations, [], 'viewing the disabled preview makes no privileged mutations');
  await themes(page, 'options-protect-off', async () => { await page.evaluate(() => scrollTo(0, 0)); });
  assert.equal(await page.locator(ACTIVATION_DIALOGS).count(), 0, 'the OFF Options page shows no activation dialog or inline consent');
  evidence.checks.push('Options #protect (off): five disabled features and three presets, no privileged mutation, the header switch is the single visible power control, no dialog or inline consent');
  // ADR-111: the Options shell hands the launcher its Tour button (`toolSlot`); the module's own Preact draws it as the MIDDLE child of the row. Real Preact, real pages: the header of Options has
  // title, Tour button, switch; a failing control or maker leaves the two module buttons (and a working switch); no slot (the other surfaces) leaves exactly two.
  const launcherKinds = () => [...document.querySelector('[data-workspace-master="firewall"] .blocking-launcher__controls').children].map(child => child.hasAttribute('data-protect-open') ? 'title' : child.hasAttribute('data-ui-tour-start') ? 'tour' : child.getAttribute('role') === 'switch' ? 'switch' : child.tagName.toLowerCase());
  assert.deepEqual(await page.evaluate(launcherKinds), ['title', 'tour', 'switch'], 'Options header: the Tour button stands between the title and the switch');
  const slot = await page.evaluate(async () => {
    const ui = await import(chrome.runtime.getURL('protect-ui.js')), wait = ms => new Promise(done => setTimeout(done, ms)), out = {};
    const kinds = host => [...host.querySelector('.blocking-launcher__controls').children].map(child => child.hasAttribute('data-protect-open') ? 'title' : child.getAttribute('role') === 'switch' ? 'switch' : child.hasAttribute('data-probe') ? 'probe' : child.tagName.toLowerCase());
    const mount = async toolSlot => { const host = document.createElement('div'); document.body.append(host); const handle = ui.mountIsland(host, 'launcher', toolSlot === undefined ? { locale: 'en' } : { locale: 'en', toolSlot }); await wait(250); return { host, handle }; };
    const probe = async (name, toolSlot) => { const { host, handle } = await mount(toolSlot), switchButton = host.querySelector('[role="switch"]'); out[name] = { kinds: kinds(host), switchChecked: switchButton?.getAttribute('aria-checked') ?? null, error: host.querySelector('[data-protect-island-error]') !== null }; return { host, handle }; };
    // The kit: the module's h and hooks, and the page's language; the component keeps state with them and re-renders in the module's tree.
    let kitKeys = null;
    const working = await probe('working', kit => { kitKeys = Object.keys(kit).sort(); return function Probe() { const [count, setCount] = kit.useState(0); kit.useEffect(() => { setCount(1); }, []); return kit.h('button', { type: 'button', 'data-probe': String(count), 'data-language': kit.useLocale(), children: 'probe' }); }; });
    out.kitKeys = kitKeys; out.workingState = working.host.querySelector('[data-probe]')?.getAttribute('data-probe') ?? null; out.workingLanguage = working.host.querySelector('[data-probe]')?.getAttribute('data-language') ?? null;
    out.workingParent = working.host.querySelector('[data-probe]')?.parentElement.className ?? null;
    // Later updates: an unrelated one keeps the control, no slot takes it away, a new maker brings a control back (the shell hands the same maker on every render; this is the island's own contract).
    working.handle.update({ locale: 'de' }); await wait(250); out.keptByOtherUpdate = kinds(working.host);
    working.handle.update({ toolSlot: null }); await wait(250); out.takenAway = kinds(working.host);
    working.handle.update({ toolSlot: kit => function Second() { return kit.h('button', { type: 'button', 'data-probe': 'second', children: 'second' }); } }); await wait(250); out.broughtBack = kinds(working.host); out.broughtBackProbe = working.host.querySelector('[data-probe]')?.getAttribute('data-probe') ?? null;
    working.handle.unmount(); working.host.remove();
    for (const [name, toolSlot] of [['none', undefined], ['null', null], ['not a function', 'tour'], ['maker throws', () => { throw new Error('maker failed'); }], ['not a component', () => 42],
      ['renders and throws', () => function Broken() { throw new Error('control failed'); }], ['throws after its first render', kit => function Late() { const [count, setCount] = kit.useState(0); kit.useEffect(() => { setCount(1); }, []); if (count === 1) throw new Error('late failure'); return kit.h('button', { type: 'button', 'data-probe': 'late', children: 'late' }); }]]) {
      const { host, handle } = await probe(name, toolSlot); handle.unmount(); host.remove();
    }
    return out;
  });
  assert.deepEqual(slot.kitKeys, ['h', 'useEffect', 'useLocale', 'useState'], 'the maker is handed the module\'s h, its two hooks and the language'); assert.deepEqual(slot.working.kinds, ['title', 'probe', 'switch'], 'a working control stands between the title and the switch');
  assert.equal(slot.workingState, '1', 'the control re-rendered after setState: the hooks it was given are the module\'s own and run in its tree'); assert.equal(slot.workingLanguage, 'en'); assert.equal(slot.workingParent, 'blocking-launcher__controls', 'a direct child of the row');
  assert.deepEqual(slot.keptByOtherUpdate, ['title', 'probe', 'switch'], 'an update that does not mention the slot keeps the control'); assert.deepEqual(slot.takenAway, ['title', 'switch'], 'an update with no slot takes it away');
  assert.deepEqual(slot.broughtBack, ['title', 'probe', 'switch'], 'an update with a new maker brings a control back'); assert.equal(slot.broughtBackProbe, 'second', 'and it is the new maker\'s control');
  for (const name of ['none', 'null', 'not a function', 'maker throws', 'not a component', 'renders and throws', 'throws after its first render']) { assert.deepEqual(slot[name].kinds, ['title', 'switch'], name + ': the row keeps exactly its two buttons'); assert.equal(slot[name].switchChecked, 'false', name + ': the switch works'); assert.equal(slot[name].error, false, name + ': a failure of the shell\'s control never reaches the launcher boundary'); }
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-workspace-master="firewall"] [data-ui-tour-start="header"]').length), 1, 'the Options header still has exactly one Tour button after the probes');
  evidence.checks.push('launcher toolSlot (ADR-111), real Preact: Options header = title, Tour button, switch; the maker gets the module\'s h, hooks and language and its control keeps state in the module\'s tree; no slot, a slot that is not a function, a maker that throws, a non-component and a control that throws at once or after its first render all leave exactly the two module buttons with a working switch and no launcher error');
  for (const language of ['en', 'de']) {
    await setLanguage(page, language);
    await page.waitForTimeout(200);
    const note = await page.locator('[data-protect-locale-note]').count();
    assert.equal(note, language === 'de' ? 1 : 0, language + ': fallback note');
    await rawKeysAndOverflow(page, 'options-protect-off/' + language);
    if (language === 'de') await shot(page, 'options-protect-off-de-light');
  }
  await setLanguage(page, 'ru');
  evidence.checks.push('Options #protect: en without note, de with the fallback note (lang="en")');

  // The Options header switch is the same trusted click: one enable command carrying exactly the choices the preview shows.
  const previewed = await page.evaluate(() => ({
    features: [...document.querySelectorAll('[data-protect-features] input[type="checkbox"]:checked')].map(input => input.id.replace('protect-preview-feature-', '')).sort(),
    preset: [...document.querySelectorAll('[data-protect-preset-preview] input[type="radio"]:checked')].map(input => input.id.replace('protect-preview-preset-', '')),
  }));
  assert.deepEqual(previewed, { features: [...DEFAULT_FEATURES].sort(), preset: ['normal'] }, 'the OFF preview shows the canonical initial choices');
  await master.click();
  await page.locator('[data-protect-section] [data-protect-state="active"]').waitFor();
  const optionsEnable = await page.evaluate(() => window.__protectFixture.enableRequests);
  assert.equal(optionsEnable.length, 1, 'one click sends one enable command'); assert.deepEqual([...optionsEnable[0].features].sort(), previewed.features); assert.equal(optionsEnable[0].preset, 'normal');
  assert.equal(await page.locator(ACTIVATION_DIALOGS).count(), 0, 'Options activation shows no dialog or inline consent');
  assert.equal(new URL(page.url()).hash, '#protect', 'Options activation stays on the Firewall route');
  evidence.checks.push('Options header switch: one click sends one enable command with the previewed canonical choices; no dialog, no route change, the page shows the active state');

  // Explicit test-only permission response: required production DNR has no native
  // Deny prompt. No service-worker response or controller activation is faked.
  await page.goto(base + 'options.html?protectfixture=permission-denied#protect');
  await master.waitFor(); await master.click();
  await page.locator('[data-protect-launcher] [role="alert"]').filter({ hasText: /\S/ }).waitFor();
  assert.equal(await page.locator('[data-protect-state="active"]').count(), 0);
  const denied = await page.evaluate(() => ({ permissions: window.__protectFixture.permissionRequests.length, enable: window.__protectFixture.requests.filter(type => type === 'ui-protect-enable').length }));
  assert.deepEqual(denied, { permissions: 1, enable: 0 });
  assert.equal(await master.getAttribute('aria-checked'), 'false'); assert.equal(await page.locator(ACTIVATION_DIALOGS).count(), 0);
  await themes(page, 'options-enable-permission-denied', async () => { await page.evaluate(() => scrollTo(0, 0)); await page.waitForFunction(() => scrollY === 0); });
  evidence.checks.push('controlled UI permission rejection shows an actual error beside the header switch, sends no enable command and never shows active (not an OS permission-denial proof)');

  // A valid managed-state response arrives while the OFF page is shown (there is no draft to cancel any more).
  // The fixture refreshes the real useProtectState subscription without a disk write.
  await page.goto(base + 'options.html?protectfixture=managed-mid-edit#protect'); await master.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-workspace-master="firewall"] [data-protect-toggle="status"]')?.disabled === false);
  assert.equal(await master.getAttribute('aria-checked'), 'false');
  await page.evaluate(state => window.__protectFixture.setState(state), { ...offState, state: 'organization-disabled', organizationDisabled: true });
  await page.locator('[data-protect-section] [data-protect-state="organization-disabled"]').waitFor(); await page.waitForFunction(() => document.querySelector('[data-workspace-master="firewall"] [data-protect-toggle="status"]')?.disabled === true);
  assert.equal(await page.locator('[data-protect-state="active"]').count(), 0); assert.equal(await page.evaluate(() => window.__protectFixture.requests.filter(type => type === 'ui-protect-enable').length), 0);
  assert.equal(await page.locator('[data-protect-features] input:disabled').count(), 5); assert.equal(await page.locator('[data-protect-preset-preview] input:disabled').count(), 3);
  await themes(page, 'options-managed-mid-edit', async () => { await page.evaluate(() => scrollTo(0, 0)); await page.waitForFunction(() => scrollY === 0); });
  evidence.checks.push('a controlled valid managed-state update reaches the OFF page: the header switch is disabled, all preview controls stay disabled and no enable command is sent');

  // 7. Options with the module on: full panel, #firewall rules, #history, #requests; back link.
  for (const hash of ['#protect', '#firewall', '#history', '#requests']) {
    await page.goto(base + 'options.html?protectfixture=active' + hash);
    await page.locator('[data-protect-page]').waitFor();
    await page.locator('[data-protect-section="full"]').waitFor();
    if (hash === '#protect') { assert.equal(await page.locator('[data-protect-features] input[type="checkbox"]').count(), 5); assert.equal(await page.locator('[data-protect-features] input:disabled').count(), 0); assert.equal(await page.locator('[data-fw-mode-form] input[type="radio"]').count(), 3); assert.equal(await page.locator('[data-fw-mode-form] input:disabled').count(), 0); }
    if (hash === '#firewall') await page.locator('[data-fw-rules]').waitFor();
    await themes(page, 'options-' + hash.slice(1) + '-active', async () => { if (hash === '#protect') await page.evaluate(() => scrollTo(0, 0)); });
  }
  await page.goto(base + 'options.html?protectfixture=active#protect');
  await page.locator('[data-protect-page]').waitFor();
  // ADR-088/103: below 1120 px the navigation is collapsed behind its menu button, so the selected tab is checked by state
  // (attached) and by its visible panel. ADR-103: clearing the hash returns to the start section «Пульт» (#hub), no longer Settings.
  await page.evaluate(() => { location.hash = ''; });
  await page.locator('[data-management-tab="hub"][aria-selected="true"]').waitFor({ state: 'attached' });
  await page.locator('#management-panel-hub').waitFor();
  await page.evaluate(() => { location.hash = '#settings'; });
  await page.locator('[data-management-tab="settings"][aria-selected="true"]').waitFor({ state: 'attached' });
  await page.locator('#management-panel-settings').waitFor();
  assert.equal(await page.locator('[data-management-panel="settings"] [data-protect-launcher]').count(), 0, 'management tabs replace duplicate launcher rows in Settings');
  evidence.checks.push('unified Options: #protect, #firewall, #history, #requests render the module panel; clearing the hash returns to the start section «Пульт», and Settings keeps no duplicate launcher rows');

  // 8. requests.html (the real service worker answers the journal).
  await page.goto(base + 'requests.html');
  await page.locator('#root *').first().waitFor();
  await page.waitForTimeout(600);
  await themes(page, 'requests');
  evidence.checks.push('requests.html renders');

  for (const file of ['protect-ui.js', 'protect.css', 'popup.js', 'options.js', 'sidepanel.js']) evidence.sizes[file] = statSync(join(extension, file)).size;

  // 9. Module off: the popup equals the explicit baseline package; open time and bundle growth recorded.
  await compareWithBaseline(page);

  // 10. Owner decision Q1 (DNR required): the consent gesture's chrome.permissions.request of the vendored UI
  // (all sites + declarativeNetRequestWithHostAccess) resolves true without a prompt, and permissions.remove of the
  // required permission is refused (the vendored UI treats that as false). Real click in options.html.
  await dnrPermissionProbe(page);
  assert.deepEqual(evidence.rawKeys, [], 'no raw catalog keys');
  assert.deepEqual(evidence.overflow, [], 'no horizontal overflow');
  assert.deepEqual(evidence.errors, [], 'no page errors');
  assert.deepEqual(evidence.console, [], 'no console errors');
  evidence.status = 'PASS';
  console.log('PASS protect UI native: ' + evidence.checks.length + ' checks, ' + evidence.screens.length + ' screenshots' + (evidence.pending.length > 0 ? '; pending: ' + evidence.pending.map((p) => p.check).join('; ') : ''));
} catch (error) {
  evidence.status = 'FAIL';
  evidence.failure = error instanceof Error ? error.message : String(error);
  console.error('FAIL protect UI native: ' + evidence.failure);
  process.exitCode = 1;
} finally {
  writeFileSync(join(artifact, 'ui.json'), JSON.stringify(evidence, null, 2) + '\n');
  await context.close();
}
