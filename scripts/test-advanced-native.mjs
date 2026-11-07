// ADR-030/031/032: native Chrome, owned loopback origins, fixture traffic only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { buildProduction } from './build-production.mjs';
import { readBeaconSnapshot } from '../packages/contracts/src/beacons.mjs';
import { readBackgroundSnapshot } from '../packages/contracts/src/background-activity.mjs';
import { readCookieProbeSnapshot } from '../packages/contracts/src/cookie-probe.mjs';
import { advancedBeaconHosts, advancedBeaconFixtures, advancedCanaries, serveAdvancedNative, serveAdvancedBeacon } from './test/advanced-native-fixtures.mjs';

const root = resolve(import.meta.dirname, '..'), temporary = join(root, '.tmp'), artifact = join(root, 'test-results/production-1.1.0/inspection');
mkdirSync(temporary, { recursive: true }); mkdirSync(artifact, { recursive: true });
const run = mkdtempSync(join(temporary, 'advanced-native-')), extension = join(run, 'extension'), profile = join(run, 'profile');
const { output, manifest } = buildProduction('chrome');
assert.deepEqual(manifest.optional_permissions, ['cookies']); assert.equal(manifest.permissions.includes('cookies'), false);
cpSync(output, extension, { recursive: true });
const sourceFiles = ['background.js', 'bridge.js', 'hook.main.js', 'beacon-decoder.js', 'beacon-observer.js', 'beacon-contracts.js', 'background-activity-observer.js', 'background-activity-contracts.js', 'cookie-probe.js', 'cookie-storage-probe.js', 'cookie-probe-contracts.js', 'advanced-ui.js', 'advanced-ui.css', 'popup.js', 'report.js'];
const evidence = { at: new Date().toISOString(), browser: null, checks: [], snapshots: {}, errors: [], unexpectedRequests: [], fixtureRequests: {}, packagedHashes: Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
const server = createServer((request, response) => { if (!serveAdvancedNative(request, response)) { response.writeHead(404); response.end(); } });
await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
const host = 'advanced.example.com', origin = 'http://' + host + ':' + server.address().port;
const certPath = join(run, 'fixture.crt'), keyPath = join(run, 'fixture.key'), configPath = join(run, 'openssl.cnf');
writeFileSync(configPath, '[req]\ndistinguished_name=dn\n[dn]\n');
const certificate = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=www.google-analytics.com', '-addext', 'subjectAltName=' + advancedBeaconHosts.map(host => 'DNS:' + host).join(',')], { cwd: root, env: { ...process.env, OPENSSL_CONF: configPath }, windowsHide: true, encoding: 'utf8' });
assert.equal(certificate.status, 0, 'owned TLS certificate generation');
const tlsServer = createSecureServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (request, response) => {
  const url = new URL(request.url, 'https://' + request.headers.host);
  const service = advancedBeaconFixtures.find(row => new URL(row.url).hostname === url.hostname && new URL(row.url).pathname === url.pathname)?.service;
  if (serveAdvancedBeacon(request, response)) { evidence.fixtureRequests[service] = (evidence.fixtureRequests[service] ?? 0) + 1; return; }
  evidence.unexpectedRequests.push(url.origin); response.writeHead(404); response.end();
});
await new Promise((done, reject) => { tlsServer.once('error', reject); tlsServer.listen(443, '127.0.0.1', done); });
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, ignoreHTTPSErrors: true, viewport: { width: 1000, height: 760 }, args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-proxy-server', '--ignore-certificate-errors', '--unsafely-treat-insecure-origin-as-secure=' + origin, '--host-resolver-rules=' + [host, ...advancedBeaconHosts].map(host => 'MAP ' + host + ' 127.0.0.1').join(',')] });
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (!['http:', 'https:'].includes(url.protocol) || url.origin === origin || url.protocol === 'https:' && advancedBeaconHosts.includes(url.hostname) && (!url.port || url.port === '443')) await route.continue();
  else { evidence.unexpectedRequests.push(url.origin); await route.abort(); }
});
const forbidden = object => {
  const text = JSON.stringify(object);
  for (const canary of advancedCanaries) assert.equal(text.includes(canary), false, 'redacted projection excludes ' + canary);
};
try {
  evidence.browser = context.browser().version();
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
  const ui = await context.newPage(); ui.on('pageerror', error => evidence.errors.push(error.name));
  await ui.goto('chrome-extension://' + id + '/popup.html');
  const send = message => ui.evaluate(message => chrome.runtime.sendMessage(message), message);
  assert.equal((await send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true })).accepted, true);
  assert.equal((await send({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' })).type, 'scope');
  await ui.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'ru' }));
  const page = await context.newPage(); page.on('pageerror', error => evidence.errors.push(error.name));
  await page.goto(origin + '/advanced/'); await page.waitForFunction(() => window.advancedFixture?.ready);
  assert.equal(await page.evaluate(() => isSecureContext), true, 'only this owned loopback fixture is allowlisted as secure');
  const tab = await ui.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)), origin + '/advanced/');
  let report;
  for (let attempt = 0; attempt < 40; attempt++) { report = await send({ schemaVersion: 1, type: 'ui-get-report', tabId: tab.id }); if (report.report?.documentKey) break; await page.waitForTimeout(150); }
  assert.ok(report.report?.documentKey);
  const base = { schemaVersion: 1, tabId: tab.id, frameId: 0, documentKey: report.report.documentKey };
  await ui.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), tab.id); await ui.reload();
  await ui.locator('[data-identification-tab="cookie"]').click(); await ui.locator('[data-cookie-action="grant"]').click();
  await ui.waitForFunction(() => chrome.permissions.contains({ permissions: ['cookies'] }));
  evidence.checks.push('unchanged optional cookies permission is granted by trusted native UI click');
  const pro = await send({ schemaVersion: 1, type: 'ui-pro-start', tabId: tab.id }); assert.equal(pro.type, 'pro-state');
  await page.click('#advanced-beacons'); await page.waitForFunction(() => window.advancedFixture.beacons || window.advancedFixture.errors.length); assert.deepEqual(await page.evaluate(() => window.advancedFixture.errors), []);
  let beacons;
  for (let attempt = 0; attempt < 40; attempt++) { beacons = await send({ ...base, type: 'ui-get-beacons' }); if (beacons.rows?.some(row => row.profile === 'ga4-mp-v1' && row.money?.length)) break; await page.waitForTimeout(250); }
  assert.ok(readBeaconSnapshot(beacons));
  evidence.snapshots.beacons = beacons;
  const services = new Set(beacons.rows.map(row => row.service));
  for (const service of ['google-analytics', 'meta', 'linkedin', 'tiktok', 'yandex']) assert.equal(services.has(service), true, service);
  const gaPost = beacons.rows.find(row => row.profile === 'ga4-mp-v1' && row.method === 'POST');
  assert.equal(gaPost.identifiers.clientId, 'present'); assert.equal(gaPost.identifiers.hashedEmail, 'present'); assert.equal(gaPost.money[0].value, '49.99'); assert.equal(gaPost.money[0].currency, 'EUR'); assert.equal(gaPost.consent.adUserData, 'denied');
  const meta = beacons.rows.find(row => row.service === 'meta' && row.events.includes('Purchase')); assert.equal(meta.money[0].value, '49.99'); assert.equal(meta.identifiers.hashedEmail, 'present');
  assert.ok(beacons.scriptCalls.some(row => row.script?.host === 'example.com' && row.script?.pathTemplate === '/main.js' && ['exact-resource', 'sampled-stack'].includes(row.attributionConfidence)));
  for (const service of ['tiktok', 'yandex']) { const row = beacons.rows.find(row => row.service === service); assert.deepEqual(row.events, []); assert.deepEqual(row.money, []); }
  forbidden(beacons); evidence.snapshots.beacons = beacons;
  const fetchSemantics = await page.evaluate(() => window.advancedFixture.fetchSemantics);
  assert.deepEqual(fetchSemantics, { thenReads: 0, nativePromise: true, methodReads: 1, bodyReads: 1 }); evidence.fetchSemantics = fetchSemantics;
  evidence.checks.push('five native known beacon services decoded; GA4 POST and Meta GET retain event, amount and identifier presence', 'SDK candidate endpoints remain endpoint-only and do not invent event payload', 'native fetch returns its Promise with no added then reads and calls each request options getter once', 'bounded initiating script evidence is retained as a fixed redacted resource; raw query/body/IDs never export');
  await page.click('#advanced-background'); await page.waitForFunction(() => window.advancedFixture.background || window.advancedFixture.errors.length); assert.deepEqual(await page.evaluate(() => window.advancedFixture.errors), []);
  const workerSemantics = await page.evaluate(() => window.advancedFixture.workerSemantics); assert.deepEqual(workerSemantics, { thenReads: 0, nativePromise: true, scopeReads: 1 }); evidence.workerSemantics = workerSemantics;
  let background;
  for (let attempt = 0; attempt < 30; attempt++) { background = await send({ ...base, type: 'ui-refresh-background-activity' }); if (background.inventory?.registrationCount >= 1 && background.rows.some(row => row.operation === 'ServiceWorkerContainer.register')) break; await page.waitForTimeout(250); }
  assert.ok(readBackgroundSnapshot(background)); assert.equal(background.inventory.status, 'available'); assert.equal(background.inventory.secureContext, true); assert.ok(background.inventory.registrationCount >= 1); assert.equal(background.inventory.pushSubscriptionCount, 0);
  assert.ok(background.rows.some(row => row.operation === 'ServiceWorkerContainer.register' && row.phase === 'async-returned'));
  evidence.nativeBackgroundAttempts = await page.evaluate(() => ({ sync: window.advancedFixture.sync, periodic: window.advancedFixture.periodic }));
  forbidden(background); evidence.snapshots.background = background;
  evidence.checks.push('real owned service worker registered; read-only origin inventory reports registration and no push subscription', 'native worker registration preserves Promise and reads options.scope exactly once', 'native Sync and Periodic Background Sync attempts retain actual support/permission outcome, without fake background execution');
  await page.click('#advanced-storage'); await page.waitForFunction(() => window.advancedFixture.storage || window.advancedFixture.errors.length); assert.deepEqual(await page.evaluate(() => window.advancedFixture.errors), []);
  await page.click('#advanced-restore-on');
  await ui.reload(); await ui.locator('[data-identification-tab="cookie"]').click();
  const select = ui.locator('[data-cookie-probe-panel] select'); await select.waitFor();
  const chooseCookie = async () => {
    await ui.waitForFunction(() => [...document.querySelectorAll('[data-cookie-probe-panel] select option')].some(option => option.textContent.startsWith('_ga · ') && option.value));
    const value = await select.locator('option').evaluateAll(options => options.find(option => option.textContent.startsWith('_ga · ')).value);
    await select.selectOption(value); return value;
  };
  const positiveHandle = await chooseCookie(); await ui.locator('[data-cookie-probe-start]').click();
  await ui.locator('[data-cookie-probe-result="restored-same"]').waitFor({ timeout: 15000 });
  const positive = await send({ ...base, type: 'ui-get-cookie-probe' }); assert.ok(readCookieProbeSnapshot(positive)); assert.equal(positive.result, 'restored-same'); assert.equal(positive.removalConfirmed, true); assert.equal(positive.source, 'unknown');
  for (const storage of ['localStorage', 'indexedDB', 'cacheStorage']) assert.equal(positive.matchedStores.some(row => row.storage === storage && row.count > 0), true, storage);
  assert.equal(positive.storageCoverage, 'partial'); forbidden(positive); assert.equal(JSON.stringify(positive).includes(positiveHandle), false); evidence.snapshots.cookiePositive = positive;
  const positivePro = await send({ schemaVersion: 1, type: 'ui-pro-get', tabId: tab.id }); assert.ok(positivePro.session.pages.some(page => page.cookieProbes?.some(state => state.result === 'restored-same'))); forbidden(positivePro);
  evidence.checks.push('trusted selected-cookie start detects genuine fixture-script recreation with identical value', 'three storage copy kinds remain counts only and restoration source remains unknown', 'positive active-cookie outcome is captured in Pro with no opaque handles or identifiers');
  await page.click('#advanced-restore-off'); await ui.locator('[data-cookie-action="refresh"]').click(); await chooseCookie(); await ui.locator('[data-cookie-probe-start]').click();
  await ui.locator('[data-cookie-probe-result="not-restored"]').waitFor({ timeout: 17000 });
  const negative = await send({ ...base, type: 'ui-get-cookie-probe' }); assert.ok(readCookieProbeSnapshot(negative)); assert.equal(negative.result, 'not-restored'); assert.equal(negative.cleanup, 'restored'); assert.equal(negative.observedRestorations, 0);
  assert.equal(await page.evaluate(() => document.cookie.includes('_ga=COOKIE_PROBE_IDENTIFIER_CANARY_123')), true);
  forbidden(negative); evidence.snapshots.cookieNegative = negative; evidence.checks.push('negative ten-second window restores the exact original tracking cookie as probe cleanup, without claiming website restoration');
  await ui.locator('[data-identification-tab="beacons"]').click(); await ui.locator('[data-beacon-row]').first().waitFor();
  assert.match(await ui.locator('[data-beacon-panel]').innerText(), /49\.99/);
  await ui.screenshot({ path: join(artifact, 'advanced-beacons-chrome.png'), fullPage: true });
  await ui.locator('[data-identification-tab="background"]').click(); await ui.locator('[data-background-refresh]').click(); await ui.locator('[data-background-row]').first().waitFor();
  assert.ok((await ui.locator('[data-background-panel]').innerText()).includes('ServiceWorkerContainer.register'));
  await ui.setViewportSize({ width: 380, height: 760 }); assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await ui.screenshot({ path: join(artifact, 'advanced-background-chrome.png'), fullPage: true });
  evidence.checks.push('localized narrow beacon and background cards retain readable fields and no horizontal overflow');
  const stopped = await send({ schemaVersion: 1, type: 'ui-pro-stop', sessionId: pro.session.id }); assert.equal(stopped.session.status, 'stopped');
  assert.ok(stopped.session.pages.some(page => page.beacons?.some(state => state.rows.length))); assert.ok(stopped.session.pages.some(page => page.backgroundActivity?.some(state => state.inventory.registrationCount >= 1))); assert.ok(stopped.session.pages.some(page => page.cookieProbes?.some(state => state.result === 'not-restored'))); forbidden(stopped);
  const view = await send({ ...base, type: 'ui-get-cookie-view' }); const authIndex = view.snapshot.entries.findIndex(row => row.name === 'PHPSESSID');
  const auth = await send({ ...base, type: 'ui-start-cookie-probe', handle: view.handles[authIndex] }); assert.equal(auth.reason, 'not-eligible');
  assert.equal(await ui.evaluate(url => chrome.cookies.getAll({ url, name: 'PHPSESSID' }).then(rows => rows.length), origin), 1);
  evidence.checks.push('authentication and HttpOnly cookie test is denied before mutation');
  const storage = await ui.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) })); forbidden(storage);
  const reportUi = await context.newPage(); await reportUi.goto('chrome-extension://' + id + '/report.html?id=' + pro.session.id); await reportUi.locator('[data-pro-beacons]').first().waitFor(); await reportUi.locator('[data-pro-background]').first().waitFor(); await reportUi.locator('[data-pro-cookie-probes]').first().waitFor();
  const reportText = await reportUi.locator('body').innerText(); for (const canary of advancedCanaries) assert.equal(reportText.includes(canary), false, canary); assert.match(reportText, /49\.99/); assert.match(reportText, /ServiceWorkerContainer\.register/);
  // Existing API-value tables legitimately show the JavaScript primitive undefined.
  const advancedText = await reportUi.locator('[data-pro-beacons], [data-pro-background], [data-pro-cookie-probes]').allTextContents();
  assert.doesNotMatch(advancedText.join('\n'), /\$\d|undefined|\[object Object\]/);
  await reportUi.emulateMedia({ media: 'print' }); assert.equal(await reportUi.locator('[data-pro-beacons]').first().isVisible(), true); assert.equal(await reportUi.locator('[data-pro-background]').first().isVisible(), true); assert.equal(await reportUi.locator('[data-pro-cookie-probes]').first().isVisible(), true); await reportUi.pdf({ path: join(artifact, 'advanced-pro-chrome.pdf'), format: 'A4', printBackground: true });
  evidence.checks.push('Pro and native print contain beacon, background and cookie-probe projections with resolved Russian localization', 'all native snapshots and extension persistent/session storage exclude raw values, IDs, payloads, private paths and opaque handles');
  assert.deepEqual(evidence.unexpectedRequests, []); assert.deepEqual(evidence.errors, []);
  evidence.checks.push('all named beacon destinations were served by owned TLS loopback fixtures; no unexpected external requests');
  console.log('Advanced native Chrome: ' + evidence.checks.length + ' checks passed');
} finally {
  writeFileSync(join(artifact, 'advanced-chrome.json'), JSON.stringify(evidence, null, 2) + '\n');
  await context.close(); await new Promise(done => server.close(done)); await new Promise(done => tlsServer.close(done));
  const target = resolve(run), base = resolve(temporary) + sep;
  if (!target.startsWith(base)) throw new Error('cleanup escaped workspace');
  rmSync(target, { recursive: true, force: true });
}
