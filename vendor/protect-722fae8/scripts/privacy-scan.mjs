import { Hits, scanNode, scanString } from './privacy-checks.mjs';
import { committedReport, positiveCounts, storedReports, waitForEvidence } from './measurement-checks.mjs';
import { belongsToExtension, extensionEgress, installWireCapture, exportErrors, exportIdentityErrors, boundedConsoleValue, deferredExtensionEvents, canaryNeedles, installIsolatedCapture, protectInputErrors } from './privacy-observers.mjs';
// Privacy scan (REQ-005, REQ-010, spec A11 gate 6, E14-01 cases 2/6/8, docs/data-inventory.md §8).
// 1. Builds the test and local profiles (unless --no-build).
// 2. Launches the test build in Playwright's Chromium (persistent context, channel chromium, userAgent = the
//    user-agent canary), enables the stand scope through ui-set-scope, opens fixtures that plant canaries (canvas
//    text, cookie, query, fragment, path id, local IP, Math argument, stack frame name, form text, localStorage,
//    title, user agent) plus ordinary pages, and waits for the sensors to flush.
// 3. Requires positive DET-001/002/003 counts, committed watermarks and a canary export preview.
// P01: scanString also rejects RFC1918, link-local and ULA address patterns.
// 4. Scans storage, preview, bounded pre-validation wire capture and verified UI/SW consoles.
// 5. Observes attributed extension requests; a locally fulfilled UI request verifies the observer.
// 6. Scans dist/local for http(s) URLs and dynamic code. Any hit/invalid measurement fails.
// 7. S15, ADR-020 «Защита» (run 2, separate profile): enables the module with every feature through the real Options
//    consent screen (all-sites + DNR granted by click), restarts the browser (SP-1: DNR writes need a reload), types the
//    module canaries (canaries.json `protect`) into fixtures/privacy/protect-canary-page.html with trusted input (the
//    page itself sends them in plain text and as SHA-256 to tracker.example.net), makes a firewall decision, waits for
//    the history flush and saves a journal record. Then it searches every canary and its variants (md5/sha1/sha256/
//    sha512 hex and base64, URL encoding, Base64; canaryNeedles) in storage.session/local, the IndexedDB dump, the DNR
//    rules, the module projections, state, rules, history query and export, request draft and journal, the observation
//    export preview, the Options diagnostics preview, popup/side panel text, UI and SW consoles, both MAIN <-> ISOLATED
//    channels and the protect-* messages of the ISOLATED world (protect-input: keyed fingerprints only). Extension
//    egress must be 0 (with a locally fulfilled control). Every non-vacuity condition is required.
// --allow-vacuous is exploratory only; it cannot waive missing wire/report/export/observer evidence.
// --protect-only is exploratory only (debugging run 2): it skips the observation run and never reports a full OK.
// Usage: node scripts/privacy-scan.mjs [--no-build] [--headed] [--allow-vacuous] [--protect-only]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startFixtureServer } from '../tests/fixture-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distTest = path.join(root, 'dist', 'test');
const distLocal = path.join(root, 'dist', 'local');
const canariesFile = path.join(root, 'fixtures', 'privacy', 'canaries.json');
const ALLOWED_DIST_HOSTS = new Set(['www.w3.org']);
const flags = new Set(process.argv.slice(2));
const FIXTURE_HOST = '127.0.0.1';

const PAGES = [
  '/canvas-fp-positive.html',
  '/privacy/canary-page.html?q=CANARY-QUERY-7a1c9e3f#CANARY-FRAGMENT-2d5f8b1a',
  '/canvas-tainted.html',
  '/spa-navigation.html',
  '/iframe-parent.html',
  '/canvas-chart-negative.html',
];

function log(message) {
  console.log('privacy-scan: ' + message);
}

function build(profile) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'build.mjs'), '--profile', profile], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('privacy-scan: build of profile "' + profile + '" failed');
    process.exit(1);
  }
}

function walkFiles(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
}

function scanDist(hits) {
  if (!existsSync(path.join(distLocal, 'manifest.json'))) {
    hits.add('dist-local-missing', distLocal);
    return 0;
  }
  const files = [];
  walkFiles(distLocal, files);
  let scanned = 0;
  for (const file of files) {
    const ext = path.extname(file);
    if (!['.js', '.html', '.css', '.json'].includes(ext)) continue;
    scanned++;
    const rel = path.relative(root, file).split(path.sep).join('/');
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const at = rel + ':' + String(i + 1);
      for (const m of line.matchAll(/\bhttps?:\/\/([a-z0-9][a-z0-9.-]*)/gi)) {
        if (!ALLOWED_DIST_HOSTS.has(m[1].toLowerCase())) hits.add('dist-remote-url', at, m[0]);
      }
      if (/\beval\s*\(/.test(line)) hits.add('dist-eval', at, line.trim());
      if (/\bnew\s+Function\b/.test(line) || /\bFunction\s*\(\s*['"`]/.test(line)) hits.add('dist-function-constructor', at, line.trim());
      if (/\bimportScripts\s*\(/.test(line)) hits.add('dist-importScripts', at, line.trim());
      if (/\bset(?:Timeout|Interval)\s*\(\s*['"`]/.test(line)) hits.add('dist-string-timer', at, line.trim());
    });
  }
  return scanned;
}

async function getServiceWorker(context) {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return context.waitForEvent('serviceworker');
}

async function sendUi(ui, request) {
  return ui.evaluate((r) => chrome.runtime.sendMessage(r), request);
}

const STAND_SCRIPT_IDS = ['detector-isolated-v1', 'detector-main-v1'];

function coversStand(matches) {
  return matches.some((m) => m === 'http://' + FIXTURE_HOST + '/*' || m === '*://' + FIXTURE_HOST + '/*' || m === '<all_urls>' || m === 'http://*/*' || m === '*://*/*');
}

/** Same rule as tests/extension/helpers.ts ensureObserved: static test grant registered at startup, else ui-set-scope. */
async function ensureObserved(sw, ui) {
  await sendUi(ui, { schemaVersion: 1, type: 'ui-get-scope' }); // awaits SW readiness; registration follows it
  const deadline = Date.now() + 10_000;
  let scripts = [];
  for (;;) {
    scripts = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => ({ id: s.id, matches: s.matches ?? [] })));
    const ids = scripts.filter((s) => coversStand(s.matches)).map((s) => s.id);
    if (STAND_SCRIPT_IDS.every((id) => ids.includes(id))) return { enabled: true, how: 'static test grant: ' + ids.join(',') + ' registered at startup' };
    if (Date.now() >= deadline) break;
    await ui.waitForTimeout(200);
  }
  const scope = await sendUi(ui, { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: FIXTURE_HOST });
  const enabled = scope !== undefined && (scope.type === 'ok' || scope.type === 'scope');
  return { enabled, how: 'ui-set-scope site ' + FIXTURE_HOST + ' -> ' + JSON.stringify(scope) };
}

async function waitForFixtureResult(page, timeout) {
  await page.waitForFunction(() => window.__fixtureResult !== undefined, undefined, { timeout });
  return page.evaluate(() => window.__fixtureResult);
}

async function checkFreshScopeOff(origin, hits) {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'detect-expert-privacy-off-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: !flags.has('--headed'),
      args: ['--disable-extensions-except=' + distLocal, '--load-extension=' + distLocal],
    });
    const sw = await getServiceWorker(context);
    const ui = await context.newPage();
    await ui.goto('chrome-extension://' + new URL(sw.url()).host + '/options.html');
    const scope = await sendUi(ui, { schemaVersion: 1, type: 'ui-get-scope' });
    if (scope?.type !== 'scope' || scope.scope?.scopeMode !== 'off') throw new Error('fresh local profile must start with scope off');
    const page = await context.newPage();
    await page.goto(origin + '/canvas-fp-positive.html');
    await waitForFixtureResult(page, 20_000);
    await page.waitForTimeout(1500);
    const session = await sw.evaluate(() => chrome.storage.session.get(null));
    scanNode(hits, 'scope-off.storage.session', session, [{ id: 'scope-off-host', value: FIXTURE_HOST }]);
    log('fresh scope-off storage checked after fixture navigation');
  } finally {
    if (context) await context.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Run 2: the opt-in module «Защита» (ADR-020 §12, §15 п. 4; S15)
// ---------------------------------------------------------------------------------------------------------------

/** Fixture-only names resolved to loopback without DNS traffic (as tests/extension/protect/support.ts). */
const PROTECT_RESOLVER = 'MAP *.example.com 127.0.0.1, MAP *.example.net 127.0.0.1, MAP *.example.org 127.0.0.1';
const PROTECT_FEATURES = ['value-match', 'firewall', 'session-replay', 'history', 'gpc'];
const ALL_SITES = ['http://*/*', 'https://*/*'];
/** Our DNR id ranges (packages/contracts/src/protect.ts DNR_RULE_IDS). */
const OUR_DNR_RANGES = [[1, 99], [100000, 100999], [101000, 101023], [200000, 200127]];
const PROTECT_DB = 'detect-expert-protect';
const CANARY_FIELDS = [['#email', 'protect-email'], ['#phone', 'protect-phone'], ['#name', 'protect-name'], ['#password', 'protect-password']];

function standUrl(origin, host, pathname) {
  const url = new URL(origin);
  url.hostname = host;
  return url.origin + pathname;
}

async function until(what, fn, timeout = 20_000, step = 250) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    if (Date.now() > deadline) throw new Error('privacy-scan (protect): timed out waiting for ' + what + (last instanceof Error ? ': ' + last.message : ''));
    await new Promise((resolve) => setTimeout(resolve, step));
  }
}

/** Every needle (canary variant) found in `node` (serialized once; the needles are ASCII). */
function scanNeedles(hits, at, node, needles) {
  let text;
  try {
    text = typeof node === 'string' ? node : JSON.stringify(node) ?? '';
  } catch {
    hits.add('protect-unserializable', at);
    return;
  }
  for (const n of needles) if (text.includes(n.value)) hits.add('protect-canary:' + n.id, at, n.value);
}

async function launchProtectContext(profile) {
  return chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: !flags.has('--headed'),
    args: ['--disable-extensions-except=' + distTest, '--load-extension=' + distTest, '--host-resolver-rules=' + PROTECT_RESOLVER, '--no-proxy-server'],
  });
}

/** Extension egress and console observers of one browser launch (attributed once the extension id is known). */
function observeProtectContext(context, state, hits) {
  const requests = deferredExtensionEvents(({ url, owner }) => {
    const request = { url: () => url, serviceWorker: () => null, frame: () => ({ url: () => owner }) };
    if (!extensionEgress(request, state.extensionId)) return;
    if (url === state.egressControl) state.egressControlSeen = true;
    else hits.add('protect-extension-egress', 'network', url);
  }, () => hits.add('protect-network-capture-overflow', 'run 2'));
  context.on('request', (request) => {
    let owner = request.serviceWorker()?.url() ?? '';
    if (!owner) { try { owner = request.frame()?.url() ?? ''; } catch { /* No frame for worker requests. */ } }
    requests.push(owner, { owner, url: request.url() });
  });
  const consoles = deferredExtensionEvents((entry) => state.consoleTexts.push(entry), () => hits.add('protect-console-capture-overflow', 'run 2'));
  context.on('console', (message) => {
    const owner = message.worker()?.url() ?? message.page()?.url() ?? '';
    if (!owner.startsWith('chrome-extension://')) return;
    if (message.text() === 'privacy-observer-ready') { state.consoleReady.add(owner); return; }
    if (state.consoleTexts.length >= 2048 || message.args().length > 32) { hits.add('protect-console-capture-overflow', owner); return; }
    const task = Promise.all(message.args().map((arg) => arg.evaluate(boundedConsoleValue))).then((values) => {
      if (values.some((value) => value.overflow)) hits.add('protect-console-capture-overflow', owner);
      else consoles.push(owner, { text: message.text(), values: values.map((entry) => entry.value) });
    }).catch(() => hits.add('protect-console-capture-failed', owner));
    state.consoleTasks.add(task);
    task.finally(() => state.consoleTasks.delete(task));
  });
  return { setId: (id) => { requests.setId(id); consoles.setId(id); } };
}

async function extensionPage(context, id, file) {
  const page = await context.newPage();
  await page.goto('chrome-extension://' + id + '/' + file);
  return page;
}

async function protectState(ui) {
  const r = await sendUi(ui, { schemaVersion: 1, type: 'ui-protect-get-state' });
  return r?.type === 'protect-state' ? r.state : null;
}

/** Every record of every store of the module database; {} when it does not exist (never creates it). */
async function dumpProtectDb(sw) {
  return sw.evaluate(async (name) => {
    if (!(await indexedDB.databases()).some((d) => d.name === name)) return {};
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => req.transaction?.abort();
    });
    try {
      const out = {};
      for (const store of Array.from(db.objectStoreNames)) {
        out[store] = await new Promise((resolve, reject) => {
          const req = db.transaction(store, 'readonly').objectStore(store).getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }
      return out;
    } finally {
      db.close();
    }
  }, PROTECT_DB);
}

async function dnrRules(sw) {
  return sw.evaluate(async () => {
    const dnr = chrome.declarativeNetRequest;
    if (dnr === undefined) return { api: false, dynamic: [], session: [] };
    return { api: true, dynamic: await dnr.getDynamicRules(), session: await dnr.getSessionRules() };
  });
}

function ourRuleIds(rules) {
  return [...rules.dynamic, ...rules.session].map((r) => r.id).filter((id) => OUR_DNR_RANGES.some(([lo, hi]) => id >= lo && id <= hi));
}

async function protectScan(hits, notes) {
  const registry = JSON.parse(readFileSync(canariesFile, 'utf8'));
  const canaries = registry.protect;
  if (!Array.isArray(canaries) || canaries.length === 0) throw new Error('canaries.json: the protect canaries are missing');
  for (const [, id] of CANARY_FIELDS) if (!canaries.some((c) => c.id === id)) throw new Error('canaries.json: ' + id + ' missing');
  const needles = canaryNeedles(canaries);
  const value = (id) => canaries.find((c) => c.id === id).value;
  const server = await startFixtureServer();
  const profile = mkdtempSync(path.join(os.tmpdir(), 'detect-expert-privacy-protect-'));
  const state = { extensionId: '', egressControl: server.origins[0] + '/privacy-observer-control-protect', egressControlSeen: false, consoleTexts: [], consoleTasks: new Set(), consoleReady: new Set() };
  const facts = {};
  let context;
  try {
    // Launch 1: all-sites access and the module with every feature, through the real Options pages (clicks).
    context = await launchProtectContext(profile);
    let observers = observeProtectContext(context, state, hits);
    let sw = await getServiceWorker(context);
    state.extensionId = new URL(sw.url()).host;
    observers.setId(state.extensionId);
    const id = state.extensionId;
    const settings = await context.newPage();
    await settings.goto('chrome://extensions');
    await settings.evaluate(async ({ extensionId, patterns }) => {
      for (const pattern of patterns) await chrome.developerPrivate.addHostPermission(extensionId, pattern);
    }, { extensionId: id, patterns: ALL_SITES });
    await settings.close();
    let options = await extensionPage(context, id, 'options.html');
    await options.locator('#options-scope-all-sites').check();
    await options.locator('form.scope button[type=submit]').click();
    await until('all-sites access', () => sw.evaluate((origins) => chrome.permissions.contains({ origins }), ALL_SITES));
    await options.goto('chrome-extension://' + id + '/options.html#protect');
    await options.locator('[data-protect-enable]').click();
    await options.locator('#protect-consent').waitFor();
    for (const feature of PROTECT_FEATURES) await options.locator('#protect-consent-feature-' + feature).setChecked(true);
    await options.locator('#protect-consent-preset-normal').check();
    await options.locator('#protect-consent-ack').check();
    await options.locator('[data-consent-confirm]').click();
    await options.locator('#protect-consent').waitFor({ state: 'detached', timeout: 15_000 });
    const enabled = await protectState(options);
    if (enabled === null || !['active', 'degraded'].includes(enabled.state) || enabled.features.length !== PROTECT_FEATURES.length) throw new Error('module not enabled: ' + JSON.stringify(enabled));
    await options.close();

    // Launch 2 with the same profile: DNR writes work once the extension loads with the grant (SP-1).
    await context.close();
    context = await launchProtectContext(profile);
    observers = observeProtectContext(context, state, hits);
    sw = await getServiceWorker(context);
    observers.setId(id);
    await context.addInitScript(installWireCapture);
    const ui = await extensionPage(context, id, 'options.html#protect');
    await until('module active after the restart', async () => (await protectState(ui))?.state === 'active');
    await context.route(state.egressControl, (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }));
    await ui.evaluate((url) => { const image = document.createElement('img'); image.src = url; document.body.append(image); }, state.egressControl);
    await until('the egress control request', () => state.egressControlSeen);
    // Console observers verified with readiness markers (SW and an extension page), as in run 1.
    await sw.evaluate(() => console.log('privacy-observer-ready'));
    await ui.evaluate(() => console.log('privacy-observer-ready'));
    await until('console observers', () => state.consoleReady.has(sw.url()) && state.consoleReady.has(ui.url()));

    // The canary page: typed with trusted input, the page sends the values itself.
    const page = await context.newPage();
    const pageUrl = standUrl(server.origins[0], 'www.example.com', '/privacy/protect-canary-page.html') + '?rp=' + new URL(server.origins[1]).port;
    await page.goto(pageUrl);
    await waitForFixtureResult(page, 20_000);
    const isolated = await installIsolatedCapture(page, id);
    for (const [selector, canaryId] of CANARY_FIELDS) {
      await page.locator(selector).click();
      await page.keyboard.type(value(canaryId), { delay: 5 });
      await page.waitForTimeout(500);
      await page.locator('#title').click();
      await page.waitForTimeout(400);
    }
    await page.locator('#send-all').click();
    const sent = await until('the page sent its requests', async () => {
      const r = await page.evaluate(() => window.__fixtureResult);
      return r?.counts?.posts >= 1 && r.counts.pixels >= 4 ? r : null;
    });
    facts.pageSent = sent.counts;
    const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id ?? -1, page.url());
    if (tabId < 0) throw new Error('canary tab not found');
    const report = await until('value-match evidence of the canary page', async () => {
      const r = await sendUi(ui, { schemaVersion: 1, type: 'ui-protect-get-report', tabId });
      const p = r?.report;
      return p && p.evidence.some((e) => e.protectKind === 'value-match') && p.firewall.prompt !== null ? p : null;
    });
    facts.evidence = report.evidence.length;

    // A firewall decision (IndexedDB decisions + a DNR rule), then the history flush (every 5 s) and a journal record.
    const prompt = report.firewall.prompt;
    const decision = await sendUi(ui, { schemaVersion: 1, type: 'ui-protect-decide', tabId, documentKey: report.documentKey, protectRevision: report.protectRevision, promptId: prompt.promptId, receivers: prompt.receivers.slice(0, 1), action: 'block', scope: 'site' });
    if (decision?.type !== 'protect-decision') hits.add('protect-decision-failed', 'ui-protect-decide', JSON.stringify(decision));
    await page.evaluate(() => { const img = new Image(); img.src = window.formsLib.receiver('px.tracker.example.net') + '/tr?after=decision'; });
    await page.waitForTimeout(6500);
    const evidenceId = report.evidence.find((e) => e.protectKind === 'value-match')?.evidenceId;
    const draft = await sendUi(ui, { schemaVersion: 1, type: 'ui-protect-request-draft', sourceKind: 'evidence', recordId: evidenceId });
    const journalBefore = await sendUi(ui, { schemaVersion: 1, type: 'ui-protect-requests-get', view: 'summary' });
    const ctxDraft = draft?.type === 'protect-request-draft' ? draft.draft : null;
    const request = {
      sourceKind: 'evidence', jurisdiction: 'gdpr-eu-eea', kinds: ['erasure'], letterLang: 'en', templateId: 'gdpr-eu-eea', templateVersion: '2026-10-17',
      subject: ctxDraft?.subjects?.[0] ?? { role: 'receiver', vendorId: null, domain: 'example.net', entityName: 'example.net' },
      recipient: { source: 'none' }, facts: (ctxDraft?.facts ?? []).slice(0, 8), identityKinds: ['sender-address'], delivery: 'copy', mentionGpc: false,
    };
    let saved = await sendUi(ui, { schemaVersion: 1, type: 'ui-protect-request-save', expectedRevision: journalBefore?.revision ?? 0, request });
    if (saved?.type !== 'protect-requests') {
      notes.push('protect: request-save with facts answered ' + JSON.stringify(saved).slice(0, 160) + '; saved a manual record instead');
      saved = await sendUi(ui, { schemaVersion: 1, type: 'ui-protect-request-save', expectedRevision: journalBefore?.revision ?? 0, request: { ...request, sourceKind: 'manual', facts: [] } });
    }

    // Everything the module keeps or shows.
    const outputs = {
      'storage.session': await sw.evaluate(() => chrome.storage.session.get(null)),
      'storage.local': await sw.evaluate(() => chrome.storage.local.get(null)),
      indexedDB: await dumpProtectDb(sw),
      dnr: await dnrRules(sw),
      'ui-protect-get-state': await sendUi(ui, { schemaVersion: 1, type: 'ui-protect-get-state' }),
      'ui-protect-get-report': await sendUi(ui, { schemaVersion: 1, type: 'ui-protect-get-report', tabId }),
      'ui-protect-list-rules': await sendUi(ui, { schemaVersion: 1, type: 'ui-protect-list-rules', offset: 0, limit: 50 }),
      'ui-protect-history-query': await sendUi(ui, { schemaVersion: 1, type: 'ui-protect-history-query', windowDays: 30, offset: 0, limit: 50, minSites: 1 }),
      'ui-protect-history-export': await sendUi(ui, { schemaVersion: 1, type: 'ui-protect-history-export', includeSites: false }),
      'ui-protect-history-export(sites)': await sendUi(ui, { schemaVersion: 1, type: 'ui-protect-history-export', includeSites: true }),
      'ui-protect-request-draft': draft,
      'ui-protect-request-save': saved,
      'ui-protect-requests-get': await sendUi(ui, { schemaVersion: 1, type: 'ui-protect-requests-get', view: 'full' }),
    };
    const observation = await sendUi(ui, { schemaVersion: 1, type: 'ui-get-report', tabId });
    outputs['ui-get-report'] = observation;
    if (observation?.type === 'report' && observation.report) {
      outputs['ui-export-preview'] = await sendUi(ui, { schemaVersion: 1, type: 'ui-export-preview', tabId, documentKey: observation.report.documentKey, reportRevision: observation.report.reportRevision });
    } else hits.add('protect-observation-report-missing', 'ui-get-report', JSON.stringify(observation).slice(0, 160));
    const diag = await extensionPage(context, id, 'options.html');
    await diag.locator('section[aria-labelledby="options-diagnostics-title"] button').first().click();
    outputs['options-diagnostics-preview'] = await diag.locator('section[aria-labelledby="options-diagnostics-title"] pre').innerText();
    await diag.close();
    const popup = await extensionPage(context, id, 'popup.html?tabId=' + String(tabId));
    await popup.locator('[data-protect-leaks="popup"]').waitFor({ timeout: 15_000 });
    outputs['popup-text'] = await popup.locator('body').innerText();
    const panel = await extensionPage(context, id, 'sidepanel.html?tabId=' + String(tabId));
    await panel.waitForTimeout(1500);
    outputs['sidepanel-text'] = await panel.locator('body').innerText();
    outputs['protect-* (ISOLATED -> SW)'] = await isolated.read();
    await isolated.detach();
    const wires = [];
    for (const frame of page.frames()) wires.push(await frame.evaluate(() => window.__privacyWire ?? null));
    outputs['window channels'] = wires.map((w) => w?.messages ?? null);
    outputs.tripwire = await page.evaluate(() => ({ isolated: document.documentElement.dataset.pwTripwireIsolated ?? null, main: document.documentElement.dataset.pwTripwireMain ?? null }));

    // Positive control: the typed text of the e-mail, phone and name fields is found by the needles (typing worked,
    // the needles match); the password field is not read here (the MAIN tripwire would count it).
    const typed = await page.evaluate(() => ['email', 'phone', 'name'].map((id) => document.getElementById(id).value));
    const control = new Hits();
    scanNeedles(control, 'control', typed, needles);
    for (const id of ['protect-email', 'protect-phone', 'protect-name']) if (!control.items.some((h) => h.rule === 'protect-canary:' + id)) hits.add('protect-control-missed', id);
    for (const [at, node] of Object.entries(outputs)) scanNeedles(hits, at, node, needles);
    await Promise.all([...state.consoleTasks]);
    state.consoleTexts.forEach((entry, i) => scanNeedles(hits, 'console[' + i + ']', entry, needles));

    // protect-input: keyed fingerprints only.
    const inputs = outputs['protect-* (ISOLATED -> SW)'].map((s) => JSON.parse(s)).filter((m) => m.type === 'protect-input');
    for (const m of inputs) for (const error of protectInputErrors(m)) hits.add('protect-input-shape', error);
    facts.protectInputs = inputs.length;
    facts.fingerprintFields = inputs.reduce((n, m) => n + (Array.isArray(m.fields) ? m.fields.length : 0), 0);

    // Non-vacuity: every surface had module data to leak.
    const db = outputs.indexedDB;
    const rules = outputs.dnr;
    facts.sessionKeys = Object.keys(outputs['storage.session']).filter((k) => k.startsWith('protect')).length;
    facts.localProtect = outputs['storage.local'].protect !== undefined;
    facts.decisions = (db.decisions ?? []).length;
    facts.sightings = (db.sightings ?? []).length;
    facts.requests = (db.requests ?? []).length;
    facts.ourDnrRules = ourRuleIds(rules);
    facts.protectChannel = wires.reduce((n, w) => n + (w?.channels?.['detect.expert/protect/v1'] ?? 0), 0);
    facts.observationChannel = wires.reduce((n, w) => n + (w?.channels?.['detect.expert/v1'] ?? 0), 0);
    facts.consoleMessages = state.consoleTexts.length;
    const tw = outputs.tripwire;
    const tripIso = tw.isolated === null ? null : JSON.parse(tw.isolated);
    const tripMain = tw.main === null ? null : JSON.parse(tw.main);
    facts.tripwire = { isolated: tripIso, main: tripMain };
    if (wires.some((w) => w === null || w.overflow)) hits.add('protect-wire-capture-failed-or-overflow', page.url());
    const required = {
      'value-match evidence': facts.evidence > 0,
      'protect-input with fingerprints': facts.fingerprintFields > 0,
      'protect-* session keys': facts.sessionKeys > 0,
      'storage.local protect settings': facts.localProtect,
      'IndexedDB decisions': facts.decisions > 0,
      'IndexedDB sightings (history)': facts.sightings > 0,
      'IndexedDB requests (journal)': facts.requests > 0,
      'our DNR rules (decision and GPC)': facts.ourDnrRules.some((r) => r >= 100000 && r <= 100999) && facts.ourDnrRules.some((r) => r >= 1 && r <= 99),
      'module channel messages': facts.protectChannel > 0,
      'observation channel messages': facts.observationChannel > 0,
      'observation export preview': outputs['ui-export-preview']?.type === 'export-preview',
      'history export preview': outputs['ui-protect-history-export']?.type === 'protect-history-export',
      'diagnostics preview': typeof outputs['options-diagnostics-preview'] === 'string' && outputs['options-diagnostics-preview'].length > 0,
      'tripwire ran in both worlds': tripIso !== null && tripMain !== null,
    };
    for (const [what, ok] of Object.entries(required)) if (!ok) hits.add('protect-vacuous', what, JSON.stringify(facts).slice(0, 200));
    if (tripIso !== null && tripIso.hits !== 0) hits.add('protect-tripwire-isolated', 'password read in ISOLATED', String(tripIso.hits));
    // The page reads its own password (blur, send-all); the MAIN tripwire counts those reads too. Any extra read is ours.
    const ownReads = (await page.evaluate(() => window.__fixtureResult?.counts?.passwordReads)) ?? -1;
    facts.pagePasswordReads = ownReads;
    if (tripMain !== null && tripMain.hits !== ownReads) hits.add('protect-tripwire-main', 'password reads in MAIN beyond the page own reads (' + String(ownReads) + ')', String(tripMain.hits));
    if (!state.egressControlSeen) hits.add('protect-egress-observer-unverified', 'run 2');
    log('protect: ' + JSON.stringify(facts));
    log('protect: needles ' + String(needles.length) + ' (' + String(canaries.length) + ' canaries with variants); surfaces scanned ' + String(Object.keys(outputs).length) + ' + ' + String(state.consoleTexts.length) + ' console messages');
  } finally {
    if (context) await context.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    await server.close();
  }
}

function finish(hits, notes, okMessage) {
  for (const note of notes) log('note: ' + note);
  if (hits.count > 0) {
    for (const h of hits.items) console.error('privacy-scan: HIT [' + h.rule + '] at ' + h.at + (h.preview ? ' value ' + h.preview : ''));
    console.error('privacy-scan: FAILED with ' + String(hits.count) + ' hit(s)');
    process.exit(1);
  }
  log(okMessage);
}

async function main() {
  if (!flags.has('--no-build')) {
    build('test');
    build('local');
  }
  if (flags.has('--protect-only')) {
    const hits = new Hits();
    const notes = ['--protect-only: the observation run and the dist/local scan were skipped (exploratory, not the full scan)'];
    await protectScan(hits, notes);
    finish(hits, notes, 'protect run only: no module canaries or variants anywhere, extension egress absent (NOT the full scan)');
    return;
  }
  const registry = JSON.parse(readFileSync(canariesFile, 'utf8'));
  const canaries = registry.canaries;
  const hits = new Hits();
  const notes = [];
  const server = await startFixtureServer();
  const origin = server.origins[0];
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'detect-expert-privacy-'));
  const consoleTexts = [];
  const consoleTasks = new Set();
  const consoleReady = new Set();
  let extensionId = '';
  let egressControlSeen = false;
  const egressControl = origin + '/privacy-observer-control';
  let context;
  try {
    await checkFreshScopeOff(origin, hits);
    // S06: the measured context reports the user-agent canary as navigator.userAgent, so the environment sensor
    // (DET-025) observes a canary-valued read; the scan proves the value reaches no storage, export, console or wire.
    const userAgentCanary = canaries.find((c) => c.id === 'user-agent');
    if (userAgentCanary === undefined) throw new Error('canaries.json: user-agent canary missing');
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: !flags.has('--headed'),
      userAgent: userAgentCanary.value,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging'],
    });
    const startupRequests = deferredExtensionEvents(({ url, owner }) => {
      const request = { url: () => url, serviceWorker: () => null, frame: () => ({ url: () => owner }) };
      if (!extensionEgress(request, extensionId)) return;
      if (url === egressControl) egressControlSeen = true;
      else hits.add('extension-egress', 'network', url);
    }, () => hits.add('network-capture-overflow', 'startup'));
    context.on('request', (request) => {
      let owner = request.serviceWorker()?.url() ?? '';
      if (!owner) { try { owner = request.frame()?.url() ?? ''; } catch { /* No frame for worker requests. */ } }
      startupRequests.push(owner, { owner, url: request.url() });
    });
    const startupConsole = deferredExtensionEvents((entry) => consoleTexts.push(entry), () => hits.add('console-capture-overflow', 'startup'));
    context.on('console', (message) => {
      const owner = message.worker()?.url() ?? message.page()?.url() ?? '';
      if (!owner.startsWith('chrome-extension://') || (extensionId && !belongsToExtension(owner, extensionId))) return;
      const text = message.text();
      if (text === 'privacy-observer-ready') { consoleReady.add(owner); return; }
      if (consoleTexts.length >= 2048 || consoleTasks.size >= 128) { hits.add('console-capture-overflow', owner); return; }
      if (text.length > 16_384 || message.args().length > 32) { hits.add('console-capture-overflow', owner); return; }
      const task = Promise.all(message.args().map((arg) => arg.evaluate(boundedConsoleValue))).then((values) => {
        if (values.some((value) => value.overflow)) hits.add('console-capture-overflow', owner);
        else startupConsole.push(owner, { text, values: values.map((entry) => entry.value) });
      }).catch(() => hits.add('console-capture-failed', owner));
      consoleTasks.add(task);
      task.finally(() => consoleTasks.delete(task));
    });
    await context.addInitScript(installWireCapture);
    // Install only after observers are attached: startup is part of the measurement.
    const cdp = await context.browser().newBrowserCDPSession();
    const installed = await cdp.send('Extensions.loadUnpacked', { path: distTest });
    extensionId = installed.id;
    startupRequests.setId(extensionId);
    startupConsole.setId(extensionId);
    await cdp.detach();
    const sw = await getServiceWorker(context);
    const id = new URL(sw.url()).host;
    if (id !== extensionId) throw new Error('service worker does not belong to the measured extension');
    const ui = await context.newPage();
    await ui.goto('chrome-extension://' + id + '/popup.html');
    await sw.evaluate(() => console.log('privacy-observer-ready'));
    for (const surface of ['popup.html', 'sidepanel.html', 'options.html']) {
      const surfacePage = surface === 'popup.html' ? ui : await context.newPage();
      if (surfacePage !== ui) await surfacePage.goto('chrome-extension://' + id + '/' + surface);
      await surfacePage.evaluate(() => console.log('privacy-observer-ready'));
      await waitForEvidence(() => consoleReady.has(surfacePage.url()), Boolean);
    }
    await waitForEvidence(() => consoleReady.has(sw.url()), Boolean);
    // Negative control: a request from the extension UI, fulfilled locally before any network I/O.
    await context.route(egressControl, (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }));
    await ui.evaluate((url) => { const image = document.createElement('img'); image.src = url; document.body.append(image); }, egressControl);
    await waitForEvidence(() => egressControlSeen, Boolean);
    const observation = await ensureObserved(sw, ui);
    const observationEnabled = observation.enabled;
    log('observation: ' + observation.how + (observationEnabled ? '' : '  (NOT enabled)'));

    const pages = [];
    for (const route of PAGES) {
      const page = await context.newPage();
      await page.goto(origin + route);
      const result = await waitForFixtureResult(page, 20_000);
      if (route.startsWith('/privacy/canary-page.html')) {
        for (const c of canaries) {
          if (result.used?.[c.id] !== c.value) hits.add('canary-not-exercised:' + c.id, 'fixtures/privacy/canary-page.html', String(result.used?.[c.id]));
        }
        if (result.queryFromUrl !== 'CANARY-QUERY-7a1c9e3f') hits.add('canary-not-exercised:query-param', 'location.search', String(result.queryFromUrl));
      }
      pages.push(page);
      await page.waitForTimeout(1200);
    }
    // Each positive document must reach sensor -> committed storage, not just navigation persistence.
    for (const page of pages) {
      const positive = page.url().includes('/canvas-fp-positive.html') || page.url().includes('/privacy/canary-page.html');
      if (positive) {
        const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id ?? -1, page.url());
        await waitForEvidence(async () => {
          const response = await sendUi(ui, { schemaVersion: 1, type: 'ui-get-report', tabId });
          const snapshot = await sw.evaluate(() => chrome.storage.session.get(null));
          return response?.type === 'report' && positiveCounts(response.report?.techniques, ['DET-001', 'DET-002', 'DET-003']) && storedReports(snapshot).some((report) => report.documentKey === response.report.documentKey && committedReport(report));
        }, Boolean);
      }
      for (const frame of page.frames()) {
        const wire = await frame.evaluate(() => window.__privacyWire);
        if (!wire || wire.overflow) hits.add('wire-capture-failed-or-overflow', page.url());
        else {
          scanNode(hits, 'wire', wire.messages, canaries);
          if (positive && frame === page.mainFrame() && !wire.messages.some((message) => message.type === 'sensor-batch' && positiveCounts(message.observations, ['DET-001', 'DET-002', 'DET-003']))) hits.add('positive-wire-missing', page.url());
        }
      }
    }

    const session = await sw.evaluate(() => chrome.storage.session.get(null));
    const local = await sw.evaluate(() => chrome.storage.local.get(null));
    const reports = storedReports(session).filter((report) => committedReport(report)).length;
    log('storage.session keys: ' + String(Object.keys(session).length) + ' (document reports: ' + String(reports) + '); storage.local keys: ' + String(Object.keys(local).length));

    scanNode(hits, 'storage.session', session, canaries);
    scanNode(hits, 'storage.local', local, canaries);

    // Export preview of the canary document (E14-01: export = preview, redacted), when the SW implements it.
    const canaryTabId = await sw.evaluate(async (prefix) => {
      const tabs = await chrome.tabs.query({});
      const hit = tabs.find((t) => typeof t.url === 'string' && t.url.startsWith(prefix));
      return hit && typeof hit.id === 'number' ? hit.id : -1;
    }, origin + '/privacy/canary-page.html');
    if (canaryTabId >= 0) {
      const reportResponse = await sendUi(ui, { schemaVersion: 1, type: 'ui-get-report', tabId: canaryTabId });
      const report = reportResponse && reportResponse.type === 'report' ? reportResponse.report : null;
      if (report) {
        // S06: the user-agent canary is meaningful only if the environment sensor saw the reads (not vacuous).
        if (!positiveCounts(report.techniques, ['DET-025', 'DET-029'])) hits.add('canary-env-not-observed', 'canary', JSON.stringify(report.techniques?.map((t) => t.techniqueId)));
        scanNode(hits, 'ui-get-report(canary)', report, canaries);
        const exportResponse = await sendUi(ui, { schemaVersion: 1, type: 'ui-export-preview', tabId: canaryTabId, documentKey: report.documentKey, reportRevision: report.reportRevision });
        if (exportResponse && exportResponse.type === 'export-preview') {
          scanNode(hits, 'ui-export-preview(canary)', exportResponse.preview, canaries);
          for (const error of [...exportErrors(exportResponse), ...exportIdentityErrors(exportResponse.preview)]) hits.add('export-policy', error);
          log('export preview scanned');
        } else {
          hits.add('export-preview-missing', 'canary', JSON.stringify(exportResponse));
        }
      } else {
        hits.add('canary-report-missing', 'canary', JSON.stringify(reportResponse));
      }
    } else hits.add('canary-tab-missing', 'canary');

    await Promise.all([...consoleTasks]);
    if (consoleTexts.length > 0) {
      consoleTexts.forEach((entry, i) => { scanString(hits, 'console[' + i + ']', entry.text, canaries); scanNode(hits, 'console-args[' + i + ']', entry.values, canaries); });
      log('console messages scanned: ' + String(consoleTexts.length));
    } else {
      log('UI/SW console observers verified with readiness markers; no application logs');
    }

    const vacuous = !observationEnabled || reports === 0;
    if (vacuous) {
      const reason = !observationEnabled ? 'observation could not be enabled (ui-set-scope refused)' : 'no document report was stored';
      if (flags.has('--allow-vacuous')) notes.push('VACUOUS RUN: ' + reason + '; storage contains no page-derived data, so this scan is not evidence of redaction');
      else hits.add('vacuous-run', reason + '; empty storage proves nothing (REQ-015). Use --allow-vacuous to downgrade to a warning');
    }
  } finally {
    if (context) await context.close();
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
    await server.close();
  }

  // Run 2: the module «Защита» in its own profile (S15).
  await protectScan(hits, notes);

  const distFiles = scanDist(hits);
  log('dist/local files scanned: ' + String(distFiles));
  finish(hits, notes, 'OK: no forbidden patterns, no canaries in storage/export/console/wire, attributed extension egress absent, dist/local clean; module «Защита»: no canaries or variants in storage/IndexedDB/DNR/exports/consoles/wire, protect-input fingerprints only, extension egress absent');
}

await main();
