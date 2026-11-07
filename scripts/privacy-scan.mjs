import { Hits, scanNode, scanString } from './privacy-checks.mjs';
import { committedReport, positiveCounts, storedReports, waitForEvidence } from './measurement-checks.mjs';
import { belongsToExtension, extensionEgress, installWireCapture, exportErrors, exportIdentityErrors, boundedConsoleValue, deferredExtensionEvents } from './privacy-observers.mjs';
// Privacy scan (REQ-005, REQ-010, spec A11 gate 6, E14-01 cases 2/6/8, docs/data-inventory.md §8).
// 1. Builds the test and local profiles (unless --no-build).
// 2. Launches the test build in Playwright's Chromium (persistent context, channel chromium), enables the
//    stand scope through ui-set-scope, opens fixtures that plant canaries (canvas text, cookie, query,
//    fragment, path id, local IP, Math argument, stack frame name, form text, localStorage, title) plus
//    ordinary pages, and waits for the sensors to flush.
// 3. Requires positive DET-001/002/003 counts, committed watermarks and a canary export preview.
// P01: scanString also rejects RFC1918, link-local and ULA address patterns.
// 4. Scans storage, preview, bounded pre-validation wire capture and verified UI/SW consoles.
// 5. Observes attributed extension requests; a locally fulfilled UI request verifies the observer.
// 6. Scans dist/local for http(s) URLs and dynamic code. Any hit/invalid measurement fails.
// --allow-vacuous is exploratory only; it cannot waive missing wire/report/export/observer evidence.
// Usage: node scripts/privacy-scan.mjs [--no-build] [--headed] [--allow-vacuous]

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

async function main() {
  if (!flags.has('--no-build')) {
    build('test');
    build('local');
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
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: !flags.has('--headed'),
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

  const distFiles = scanDist(hits);
  log('dist/local files scanned: ' + String(distFiles));
  for (const note of notes) log('note: ' + note);
  if (hits.count > 0) {
    for (const h of hits.items) console.error('privacy-scan: HIT [' + h.rule + '] at ' + h.at + (h.preview ? ' value ' + h.preview : ''));
    console.error('privacy-scan: FAILED with ' + String(hits.count) + ' hit(s)');
    process.exit(1);
  }
  log('OK: no forbidden patterns, no canaries in storage/export/console/wire, attributed extension egress absent, dist/local clean');
}

await main();
