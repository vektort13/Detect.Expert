// ADR-047: native check of the module «Защита» in the delivered Chrome package (dist/chrome), Playwright channel
// 'chromium', profile and loopback fixture inside this project. S2 implements `--smoke` (port plan §6 S2); the full
// scenario list of §5.2 arrives in S4.
//   --smoke: the SW starts and answers module and production messages; module-off invariants; the required DNR
//   permission (request = true, remove refused, no extra install warning); enable from options.html registers the
//   module and DNR works without an extension reload (SP-1 gone); the API-blocking send-beacon rule still removes
//   sendBeacon in both registration orders while the module's send hooks run; observation still builds its report;
//   disable with purge removes registrations, DNR rules, storage keys and the IndexedDB database.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
if (!argv.includes('--smoke')) {
  console.error('test-protect-chrome: only --smoke is implemented (S2); the full mode is step S4');
  process.exit(2);
}
const root = resolve(import.meta.dirname, '..'), temporary = join(root, '.tmp'), artifact = join(root, 'test-results/production-1.1.0/protect');
mkdirSync(temporary, { recursive: true }); mkdirSync(artifact, { recursive: true });
const run = mkdtempSync(join(temporary, 'protect-chrome-')), extension = join(run, 'extension');
cpSync(join(root, 'dist/chrome'), extension, { recursive: true });
const DNR = 'declarativeNetRequestWithHostAccess', ORIGINS = ['http://*/*', 'https://*/*'];
const files = ['manifest.json', 'background.js', 'protect-sw.js', 'protect.js', 'protect.main.js', 'protect-on.send.js', 'protection.send-beacon.js'];
const evidence = { mode: 'smoke', at: new Date().toISOString(), checks: [], facts: {}, errors: [], workerErrors: [], unexpectedRequests: [],
  packagedHashes: Object.fromEntries(files.map((file) => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
const check = (text) => { evidence.checks.push(text); console.log('  ok ' + text); };

const hits = [];
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  if (url.pathname === '/collect') {
    hits.push({ kind: url.searchParams.get('k'), method: request.method, gpc: request.headers['sec-gpc'] ?? null });
    request.resume(); response.writeHead(204); response.end(); return;
  }
  if (url.pathname === '/fixture.js') {
    response.setHeader('Content-Type', 'application/javascript');
    response.end('window.fixtureReady=true;try{document.createElement("canvas").toDataURL();}catch(e){}'); return;
  }
  hits.push({ kind: 'document', method: request.method, gpc: request.headers['sec-gpc'] ?? null });
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><html><head><title>Protect smoke fixture</title></head><body><p>fixture</p><script src="/fixture.js"></script></body></html>');
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const host = 'protect.example.com', origin = 'http://' + host + ':' + server.address().port;

let context;
try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1080, height: 900 },
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-proxy-server', '--unsafely-treat-insecure-origin-as-secure=' + origin, '--host-resolver-rules=MAP ' + host + ' 127.0.0.1'] });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === origin) await route.continue();
    else { evidence.unexpectedRequests.push(url.origin); await route.abort(); }
  });
  evidence.browser = context.browser()?.version() ?? null;
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
  assert.equal(new URL(worker.url()).pathname, '/background.js');
  await worker.evaluate(() => {
    globalThis.__protectSmokeErrors = [];
    addEventListener('error', (event) => globalThis.__protectSmokeErrors.push('error: ' + String(event.message)));
    addEventListener('unhandledrejection', (event) => globalThis.__protectSmokeErrors.push('rejection: ' + String(event.reason?.message ?? event.reason)));
  });

  // Extension page = UI sender (options.html, as the module's consent screen).
  const options = await context.newPage(); options.on('pageerror', (error) => evidence.errors.push(error.message));
  await options.goto('chrome-extension://' + id + '/options.html');
  const send = (message) => options.evaluate((m) => chrome.runtime.sendMessage(m), message);
  const consent = await send({ schemaVersion: 1, type: 'ui-data-consent-get' });
  assert.equal(consent.accepted, true, 'production data consent default (all sites) as before');
  const offState = await send({ schemaVersion: 1, type: 'ui-protect-get-state' });
  assert.equal(offState.type, 'protect-state'); assert.equal(offState.state.state, 'off');
  // While off the module reads no permission (ADR-020 §A): its flags stay false; the browser grant is checked directly.
  evidence.facts.offPermissions = offState.state.permissions;
  assert.equal(await options.evaluate((dnr) => chrome.permissions.contains({ permissions: [dnr] }), DNR), true, 'required DNR is granted at install');
  assert.equal(await options.evaluate((origins) => chrome.permissions.contains({ origins }), ORIGINS), true);
  check('SW started: module answers ui-protect-get-state (off), production answers ui-data-consent-get; DNR granted at install');

  const fixture = await context.newPage(); fixture.on('pageerror', (error) => evidence.errors.push(error.message));
  await fixture.goto(origin + '/'); await fixture.waitForFunction(() => window.fixtureReady === true);
  const tab = await options.evaluate((url) => chrome.tabs.query({}).then((tabs) => tabs.find((t) => t.url === url)), origin + '/');
  assert.ok(Number.isInteger(tab?.id));
  const registered = () => options.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((rows) => rows.map((r) => ({ id: r.id, js: r.js, world: r.world }))));
  const pageProbe = () => fixture.evaluate(() => ({
    gpc: navigator.globalPrivacyControl,
    beaconOwn: Object.prototype.hasOwnProperty.call(Navigator.prototype, 'sendBeacon'),
    beaconType: typeof navigator.sendBeacon,
    policySlot: Object.getOwnPropertyDescriptor(window, Symbol.for('detect.expert/protect-policy/v1')) !== undefined,
    mainMark: Object.getOwnPropertyDescriptor(window, Symbol.for('detect.expert/protect-main/v1'))?.value === true,
  }));
  const storageKeys = () => options.evaluate(async () => ({
    // Module keys: storage.local "protect", storage.session "protect-tabs" / "protect-runtime" / "protect-doc:*" (production "protection:*" excluded).
    local: Object.keys(await chrome.storage.local.get(null)).filter((k) => /^protect(?:$|[-:])/.test(k)),
    session: (await chrome.storage.session.getKeys()).filter((k) => /^protect(?:$|[-:])/.test(k)),
    databases: (await indexedDB.databases()).map((d) => d.name).filter((n) => /protect/.test(n)),
  }));
  const dnrRules = () => worker.evaluate(async () => ({ dynamic: (await chrome.declarativeNetRequest.getDynamicRules()).length, session: (await chrome.declarativeNetRequest.getSessionRules()).length }));

  // Module off (default): nothing of the module anywhere.
  const before = await registered();
  assert.equal(before.some((r) => r.id.startsWith('detector-protect-')), false);
  assert.ok(before.some((r) => r.id === 'detector-main-v1') && before.some((r) => r.id === 'detector-isolated-v1'), 'observation registrations as before');
  assert.deepEqual(await storageKeys(), { local: [], session: [], databases: [] });
  assert.deepEqual(await dnrRules(), { dynamic: 0, session: 0 });
  const offProbe = await pageProbe();
  assert.equal(offProbe.gpc, undefined); assert.equal(offProbe.policySlot, false); assert.equal(offProbe.mainMark, false);
  assert.equal(offProbe.beaconType, 'function');
  check('module off: no detector-protect-* registration, no protect* keys, no IndexedDB, no DNR rule, no GPC/policy slot in the page');

  // Production messages behave as before (UI sender): report projection and the blocking settings.
  const observed = async () => {
    let answer = null;
    for (let i = 0; i < 60; i++) {
      answer = await send({ schemaVersion: 1, type: 'ui-get-report', tabId: tab.id });
      if (answer?.report?.techniques?.some((item) => item.count > 0)) break;
      await options.waitForTimeout(150);
    }
    return answer;
  };
  const report = await observed();
  assert.equal(report?.type, 'report'); assert.ok(report.report.techniques.some((item) => item.count > 0), 'observation records the fixture canvas read');
  const blocking = await send({ schemaVersion: 1, type: 'ui-protection-get', tabId: tab.id });
  assert.equal(blocking.settings.enabled, false);
  const unknown = await send({ schemaVersion: 1, type: 'ui-protect-not-a-type' });
  assert.deepEqual(unknown, { schemaVersion: 1, type: 'error', code: 'invalid-request' }, 'an unknown ui-protect-* type stays a production invalid-request');
  evidence.facts.reportBefore = { type: report.type, techniques: report.report.techniques.filter((t) => t.count > 0).map((t) => t.techniqueId) };
  check('production ui-get-report / ui-protection-get answered as before; non-module types never reach the module');

  // Required DNR (owner Q1): the vendored request shape inside a real click resolves true; removal is refused.
  await options.evaluate(({ origins, dnr }) => {
    const button = document.createElement('button'); button.id = 'dnr-probe'; button.textContent = 'probe';
    button.addEventListener('click', () => {
      window.__dnrRequest = 'pending';
      Promise.resolve(chrome.permissions.request({ origins, permissions: [dnr] })).then((granted) => { window.__dnrRequest = granted; }, (error) => { window.__dnrRequest = 'error: ' + error.message; });
    });
    document.body.append(button);
  }, { origins: ORIGINS, dnr: DNR });
  await options.click('#dnr-probe');
  await options.waitForFunction(() => window.__dnrRequest !== 'pending' && window.__dnrRequest !== undefined, null, { timeout: 5000 });
  const requested = await options.evaluate(() => window.__dnrRequest);
  const removed = await options.evaluate((dnr) => chrome.permissions.remove({ permissions: [dnr] }).then((r) => r, (e) => 'error: ' + e.message), DNR);
  const stillGranted = await options.evaluate((dnr) => chrome.permissions.contains({ permissions: [dnr] }), DNR);
  evidence.facts.dnrRequest = requested; evidence.facts.dnrRemove = removed; evidence.facts.dnrAfterRemove = stillGranted;
  assert.equal(requested, true, 'permissions.request of the vendored consent shape');
  assert.notEqual(removed, true, 'a required permission cannot be removed');
  assert.equal(stillGranted, true);
  check('required DNR: click-time permissions.request({origins, [DNR]}) = true; permissions.remove refused (' + JSON.stringify(removed) + '); still granted');
  const warnings = await options.evaluate(async (dnr) => {
    if (typeof chrome.management?.getPermissionWarningsByManifest !== 'function') return { available: false };
    const manifest = chrome.runtime.getManifest();
    const withDnr = await chrome.management.getPermissionWarningsByManifest(JSON.stringify(manifest));
    const without = await chrome.management.getPermissionWarningsByManifest(JSON.stringify({ ...manifest, permissions: manifest.permissions.filter((p) => p !== dnr) }));
    return { available: true, withDnr, without };
  }, DNR).catch((error) => ({ available: false, error: error.message }));
  evidence.facts.installWarnings = warnings;
  if (warnings.available) {
    assert.deepEqual(warnings.withDnr, warnings.without, 'declarativeNetRequestWithHostAccess adds no install warning');
    check('install warnings with and without the DNR permission are identical (' + warnings.withDnr.length + ' warnings)');
  } else check('install-warning comparison unavailable in this browser build (recorded as candidate)');

  // Enable from options.html (the consent click sends this after the permission request).
  const features = ['value-match', 'firewall', 'session-replay', 'gpc'];
  const enabled = await send({ schemaVersion: 1, type: 'ui-protect-enable', consentVersion: 1, features, preset: 'normal' });
  assert.equal(enabled.type, 'protect-state', JSON.stringify(enabled).slice(0, 300));
  evidence.facts.enabledState = { state: enabled.state.state, degradedReasons: enabled.state.degradedReasons, permissions: enabled.state.permissions };
  assert.equal(enabled.state.state, 'active', JSON.stringify(enabled.state));
  assert.deepEqual(enabled.state.permissions, { broadHosts: true, dnr: true });
  assert.equal(enabled.state.degradedReasons.includes('blocking-unavailable'), false, 'SP-1: no reload needed with a required DNR permission');
  let rows = [];
  for (let i = 0; i < 50; i++) { rows = await registered(); if (rows.some((r) => r.id === 'detector-protect-main-v1')) break; await options.waitForTimeout(100); }
  const isolated = rows.find((r) => r.id === 'detector-protect-isolated-v1'), main = rows.find((r) => r.id === 'detector-protect-main-v1');
  evidence.facts.registrationsAfterEnable = rows.map((r) => r.id); evidence.facts.moduleMain = main?.js ?? null;
  assert.deepEqual(isolated?.js, ['protect.js']); assert.equal(main?.world, 'MAIN');
  assert.ok(main.js.includes('protect-on.send.js') && main.js.includes('protect.main.js') && main.js.includes('gpc.main.js'), JSON.stringify(main.js));
  check('enable (' + features.join(', ') + '): active, no blocking-unavailable; MAIN = ' + main.js.join(' + '));

  // GPC proves DNR rules apply immediately (no extension reload); the module's MAIN ran in the page.
  hits.length = 0;
  await fixture.reload(); await fixture.waitForFunction(() => window.fixtureReady === true);
  const onProbe = await pageProbe();
  evidence.facts.pageWithModule = onProbe;
  assert.equal(onProbe.gpc, true); assert.equal(onProbe.mainMark, true);
  assert.equal(hits.find((h) => h.kind === 'document')?.gpc, '1', 'Sec-GPC: 1 on the navigation request');
  evidence.facts.dnrAfterEnable = await dnrRules();
  check('module on: navigator.globalPrivacyControl = true, Sec-GPC: 1 at the server, module MAIN ran (protect-main mark)');

  // Send hooks of the module (owner Q2) keep the page's own requests intact: one request per call.
  hits.length = 0;
  const sent = await fixture.evaluate(async () => {
    const response = await fetch('/collect?k=fetch', { method: 'POST', body: 'x' });
    const beacon = navigator.sendBeacon('/collect?k=beacon', 'y');
    return { fetchStatus: response.status, beacon };
  });
  for (let i = 0; i < 50 && hits.filter((h) => h.kind === 'beacon').length === 0; i++) await fixture.waitForTimeout(100);
  assert.equal(sent.fetchStatus, 204); assert.equal(sent.beacon, true);
  assert.equal(hits.filter((h) => h.kind === 'fetch').length, 1); assert.equal(hits.filter((h) => h.kind === 'beacon').length, 1);
  check('module send hooks: fetch and sendBeacon reach the server exactly once each');

  // API blocking send-beacon with the module on, in both registration orders.
  const setBeacon = (enabledFlag) => send({ schemaVersion: 1, type: 'ui-protection-get', tabId: tab.id }).then((state) =>
    send({ schemaVersion: 1, type: 'ui-protection-set', tabId: tab.id, settings: { ...state.settings, enabled: enabledFlag, preset: 'custom', global: [{ feature: 'send-beacon', state: 'block' }], sites: [] } }));
  const blockedProbe = async (label) => {
    await fixture.reload(); await fixture.waitForFunction(() => window.fixtureReady === true);
    const probe = await pageProbe();
    const order = (await registered()).map((r) => r.id).filter((x) => x === 'detector-main-v1' || x.startsWith('detector-protect-') || x === 'detector-protection-v1-send-beacon');
    evidence.facts['beacon-' + label] = { probe, order };
    assert.equal(probe.beaconOwn, false, label + ': Navigator.prototype.sendBeacon removed');
    assert.equal(probe.beaconType, 'undefined', label);
    assert.equal(probe.mainMark, true, label + ': the module still ran');
    return order;
  };
  const first = await setBeacon(true);
  assert.equal(first.registration, 'ready', JSON.stringify(first).slice(0, 200));
  const orderA = await blockedProbe('blocking-after-module');
  const reenabled = await send({ schemaVersion: 1, type: 'ui-protect-set-settings', features: ['value-match', 'firewall', 'session-replay'] });
  assert.equal(reenabled.type, 'protect-state', JSON.stringify(reenabled).slice(0, 200));
  for (let i = 0; i < 50; i++) { const now = await registered(); const m = now.find((r) => r.id === 'detector-protect-main-v1'); if (m && !m.js.includes('gpc.main.js')) break; await options.waitForTimeout(100); }
  const orderB = await blockedProbe('module-after-blocking');
  check('send-beacon blocking keeps sendBeacon removed with the module on (orders ' + orderA.join(',') + ' | ' + orderB.join(',') + ')');
  await setBeacon(false);

  // Observation still builds the report of the fixture document with the module on.
  await fixture.reload(); await fixture.waitForFunction(() => window.fixtureReady === true);
  const projection = await observed();
  evidence.facts.reportWithModule = { type: projection?.type ?? null, techniques: (projection?.report?.techniques ?? []).filter((t) => t.count > 0).map((t) => t.techniqueId) };
  assert.equal(projection?.type, 'report'); assert.ok(evidence.facts.reportWithModule.techniques.length > 0, 'observation report has a technique');
  check('observation report builds with the module on (technique recorded for the fixture document)');

  // Disable with purge, then the vendored grant removal (refused for a required permission) does not break it.
  const disabled = await send({ schemaVersion: 1, type: 'ui-protect-disable', purge: true });
  assert.equal(disabled.type, 'protect-state'); assert.equal(disabled.state.state, 'off');
  const removeAfter = await options.evaluate((dnr) => chrome.permissions.remove({ permissions: [dnr] }).then((r) => r === true, () => false), DNR);
  assert.equal(removeAfter, false);
  const offAgain = await send({ schemaVersion: 1, type: 'ui-protect-get-state' });
  assert.equal(offAgain.state.state, 'off'); assert.equal(offAgain.state.permissions.dnr, true);
  let leftovers;
  for (let i = 0; i < 50; i++) { leftovers = { rows: (await registered()).filter((r) => r.id.startsWith('detector-protect-')).length, ...(await storageKeys()), dnr: await dnrRules() }; if (leftovers.rows === 0 && leftovers.databases.length === 0) break; await options.waitForTimeout(100); }
  evidence.facts.afterPurge = leftovers;
  assert.deepEqual(leftovers, { rows: 0, local: [], session: [], databases: [], dnr: { dynamic: 0, session: 0 } });
  hits.length = 0;
  await fixture.reload(); await fixture.waitForFunction(() => window.fixtureReady === true);
  const purgedProbe = await pageProbe();
  assert.equal(purgedProbe.gpc, undefined); assert.equal(purgedProbe.mainMark, false); assert.equal(purgedProbe.beaconType, 'function');
  assert.equal(hits.find((h) => h.kind === 'document')?.gpc, null);
  check('disable(purge): off, no registrations / keys / IndexedDB / DNR rules, no GPC; refused grant removal changes nothing');

  evidence.workerErrors = await worker.evaluate(() => globalThis.__protectSmokeErrors ?? []);
  assert.deepEqual(evidence.workerErrors, [], 'no SW error or unhandled rejection during the run');
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.unexpectedRequests, []);
  evidence.result = 'PASS';
} catch (error) {
  evidence.result = 'FAIL'; evidence.failure = String(error?.stack ?? error);
  throw error;
} finally {
  writeFileSync(join(artifact, 'chrome-smoke.json'), JSON.stringify(evidence, null, 2) + '\n');
  await context?.close(); server.close();
}
console.log('PASS: protect smoke in delivered Chrome (' + evidence.checks.length + ' checks) -> test-results/production-1.1.0/protect/chrome-smoke.json');
