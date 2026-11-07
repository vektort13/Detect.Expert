// Native inspection fixtures are local/intercepted; the delivered optional permission is exercised by a UI click.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { buildProduction, validateProductionManifest } from './build-production.mjs';
import { BROWSER_DEBUG_CHROME_OPTIONAL } from '../apps/production-extension/browser-debug-shared.js';
import { readSocialSnapshot } from '../packages/contracts/src/inspection.mjs';
import { socialNativeFixtures, socialNativeExpected, socialNativeMain, socialNativePixel, socialNativeStub } from './test/social-native-fixtures.mjs';
import { socialLayoutMetrics } from './test/social-layout-metrics.mjs';
import { thirdPartyLayoutMetrics } from './test/third-party-layout-metrics.mjs';
import { readThirdPartySnapshot } from '../packages/contracts/src/third-party.mjs';
const root = resolve(import.meta.dirname, '..'), temporary = join(root, '.tmp');
const artifact = join(root, 'test-results/production-1.1.0/inspection');
mkdirSync(temporary, { recursive: true }); mkdirSync(artifact, { recursive: true });
const { output, manifest } = buildProduction('chrome');
assert.deepEqual(manifest.optional_permissions, [...BROWSER_DEBUG_CHROME_OPTIONAL, 'nativeMessaging', 'clipboardWrite']); assert.equal(manifest.permissions.includes('cookies'), false);
assert.deepEqual(validateProductionManifest(manifest, 'chrome'), []);
const run = mkdtempSync(join(temporary, 'inspection-native-')), extension = join(run, 'extension'), profile = join(run, 'profile');
cpSync(output, extension, { recursive: true });
const testManifest = manifest;
writeFileSync(join(extension, 'manifest.json'), JSON.stringify(testManifest));
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/api/binding') response.setHeader('Secure-Session-Registration', '(ES256);path="/bound";challenge="DBSC_HEADER_CANARY"');
  response.setHeader('Set-Cookie', ['_ga=COOKIE_VALUE_CANARY; Max-Age=3600; Path=/; SameSite=Lax', '_ga_ALPHA=FIRST_DYNAMIC_CANARY; Max-Age=3600; Path=/; SameSite=Lax', '_ga_BETA=SECOND_DYNAMIC_CANARY; Max-Age=3600; Path=/; SameSite=Lax', 'PHPSESSID=AUTH_VALUE_CANARY; HttpOnly; Path=/; SameSite=Lax']);
  if (new URL(request.url, 'http://local.test').pathname.endsWith('/main.js')) {
    response.setHeader('Content-Type', 'application/javascript');
    response.end(socialNativeMain);
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><html><title>Cookie and loader fixture</title><body><main>ready</main></body></html>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://site.cookies.example.com:' + server.address().port;
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1000, height: 760 }, args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-proxy-server', '--host-resolver-rules=MAP site.cookies.example.com 127.0.0.1'] });
const fixtureScripts = new Map([
  ['www.googletagmanager.com', `for(const url of ['https://connect.facebook.net/en_US/fbevents.js','https://static.hotjar.com/c/hotjar-123.js?sv=6','https://dynamic.criteo.com/js/ld/ld.js?a=1']){const script=document.createElement('script');script.src=url;document.head.appendChild(script);}`],
  ['connect.facebook.net', 'window.fixtureMetaLoaded=true;'],
  ['static.hotjar.com', 'window.fixtureHotjarLoaded=true;'],
  ['dynamic.criteo.com', 'window.fixtureCriteoLoaded=true;'],
  ['accounts.google.com', 'window.fixtureSocialGoogleLoaded=true;'],
  ['s.pinimg.com', 'window.fixtureSocialPinterestLoaded=true;'],
]);
const evidence = { browser: context.browser().version(), checks: [], errors: [], unexpectedRequests: [], fixtureRequests: [], testPermission: 'production optional cookies permission requested through an explicit UI click in the test profile', snapshots: [] };
evidence.packagedHashes = Object.fromEntries(['third-party-observer.js', 'third-party-contracts.js', 'identification-ui.js', 'identification-ui.css', 'bridge.js', 'background.js', 'popup.js', 'report.js'].map(file => [file, createHash('sha256').update(readFileSync(join(output, file))).digest('hex')]));
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.protocol !== 'https:') { await route.continue(); return; }
  const socialFixture = socialNativeFixtures.find(fixture => fixture.url === url.href);
  if (socialFixture) {
    evidence.fixtureRequests.push(url.hostname);
    await route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' },
      contentType: socialFixture.transport === 'script' ? 'application/javascript' : 'image/gif',
      body: socialFixture.transport === 'script' ? socialNativeStub : socialNativePixel }); return;
  }
  if (!fixtureScripts.has(url.hostname)) { evidence.unexpectedRequests.push(url.origin); await route.abort(); return; }
  evidence.fixtureRequests.push(url.hostname);
  await route.fulfill({ status: 200, contentType: 'application/javascript', body: fixtureScripts.get(url.hostname) });
});
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
  const ui = await context.newPage(); ui.on('pageerror', error => evidence.errors.push(error.message));
  await ui.goto('chrome-extension://' + id + '/popup.html');
  const send = message => ui.evaluate(message => chrome.runtime.sendMessage(message), message);
  assert.equal((await send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true })).accepted, true);
  assert.equal((await send({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' })).type, 'scope');
  await ui.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'ru' }));
  const page = await context.newPage(); page.on('pageerror', error => evidence.errors.push(error.message));
  await page.goto(origin); await page.evaluate(() => window.innerWidth); await page.waitForTimeout(700);
  const tab = await ui.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)), origin + '/');
  const report = await send({ schemaVersion: 1, type: 'ui-get-report', tabId: tab.id });
  assert.ok(report.report?.documentKey, JSON.stringify(report));
  const request = { schemaVersion: 1, type: 'ui-get-cookies', tabId: tab.id, frameId: 0, documentKey: report.report.documentKey };
  const missing = await send(request); assert.equal(missing.permission, 'required'); assert.equal(missing.entries.length, 0);
  await ui.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), tab.id);
  await ui.reload(); await ui.locator('[data-identification-tab="cookie"]').click();
  await ui.locator('[data-cookie-action="grant"]').click();
  await ui.waitForFunction(() => chrome.permissions.contains({ permissions: ['cookies'] }), null, { timeout: 5000 });
  evidence.checks.push('actual optional permission starts ungranted and is granted by explicit UI click');
  const cookieState = await send(request);
  assert.equal(cookieState.type, 'cookies-state', JSON.stringify(cookieState)); assert.equal(cookieState.permission, 'granted');
  assert.equal(cookieState.trackingCount, 3, JSON.stringify(cookieState.entries)); assert.equal(cookieState.entries.length, 4);
  assert.equal(cookieState.totalCount, 4); assert.equal(cookieState.siteCount, 4);
  assert.equal(cookieState.entries.filter(entry => entry.name === '_ga_*').length, 2, 'dynamic identifiers are masked without collapsing distinct cookies');
  assert.equal(cookieState.entries.find(entry => entry.name === 'PHPSESSID').httpOnly, true);
  assert.equal(cookieState.entries.find(entry => entry.name === 'PHPSESSID').tracking, false);
  evidence.snapshots.push(cookieState); evidence.checks.push('native selected-store cookie metadata', 'tracking badge excludes authentication cookies', 'dynamic cookie identities counted separately');
  const started = await send({ schemaVersion: 1, type: 'ui-pro-start', tabId: tab.id }); assert.equal(started.type, 'pro-state');
  await ui.goto('about:blank');
  await page.evaluate(() => { document.cookie = 'CLOSED_UI_FIXTURE=CLOSED_UI_VALUE_CANARY; Path=/; SameSite=Lax'; });
  let closedCapture;
  for (let attempt = 0; attempt < 40; attempt++) {
    closedCapture = await worker.evaluate(() => chrome.storage.session.get('pro-recording-v1').then(value => value['pro-recording-v1']?.session));
    if (closedCapture?.pages.some(page => page.cookies?.totalCount === 5)) break;
    await page.waitForTimeout(250);
  }
  assert.ok(closedCapture?.pages.some(page => page.cookies?.totalCount === 5), 'Pro captures a newly added cookie while its UI is closed');
  assert.equal(JSON.stringify(closedCapture).includes('CLOSED_UI_VALUE_CANARY'), false);
  await page.evaluate(() => { document.cookie = 'CLOSED_UI_FIXTURE=; Max-Age=0; Path=/; SameSite=Lax'; });
  for (let attempt = 0; attempt < 40; attempt++) {
    closedCapture = await worker.evaluate(() => chrome.storage.session.get('pro-recording-v1').then(value => value['pro-recording-v1']?.session));
    if (closedCapture?.pages.some(page => page.cookies?.totalCount === 4)) break;
    await page.waitForTimeout(250);
  }
  assert.ok(closedCapture?.pages.some(page => page.cookies?.totalCount === 4), 'closed UI inventory refreshes after cookie removal');
  evidence.checks.push('Pro automatically captures and refreshes cookie metadata with the popup closed, without any UI cookie query');
  await ui.goto('chrome-extension://' + id + '/popup.html');
  await page.evaluate(() => fetch('/api/binding')); await page.waitForTimeout(250);
  const binding = await send(request); assert.equal(Object.hasOwn(binding, 'sessionBinding'), false);
  assert.equal(binding.entries.length, 4); assert.equal(JSON.stringify(binding).includes('DBSC_HEADER_CANARY'), false);
  evidence.checks.push('removed DBSC state stays absent while current cookie inventory and header redaction remain intact');
  await page.evaluate(() => new Promise((resolve, reject) => { const script = document.createElement('script'); script.onload = resolve; script.onerror = reject; script.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-TEST&secret=GTM_URL_CANARY'; document.head.appendChild(script); }));
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => window.fixtureMetaLoaded && window.fixtureHotjarLoaded && window.fixtureCriteoLoaded, null, { timeout: 5000 });
  await page.waitForTimeout(900);
  let recorded = await send({ schemaVersion: 1, type: 'ui-pro-get', tabId: tab.id });
  const rows = recorded.session.pages.flatMap(page => page.tagManager ?? []).flatMap(document => document.rows);
  assert.deepEqual(rows.map(row => row.target).sort(), ['criteo', 'facebook-pixel', 'hotjar']);
  assert.ok(rows.every(row => row.attributionConfidence === 'exact-resource' && row.integrity === 'page-controlled' && row.count === 1), JSON.stringify(rows));
  await page.evaluate(() => new Promise(resolve => { const script = document.createElement('script'); script.onload = resolve; script.src = 'https://static.hotjar.com/c/hotjar-456.js?sv=6'; document.head.appendChild(script); }));
  await page.waitForTimeout(900);
  recorded = await send({ schemaVersion: 1, type: 'ui-pro-get', tabId: tab.id });
  assert.equal(recorded.session.pages.flatMap(page => page.tagManager ?? []).flatMap(document => document.rows).find(row => row.target === 'hotjar').count, 1, 'later independent script is not attributed to earlier GTM');
  evidence.checks.push('GTM currentScript chains to Meta Hotjar Criteo', 'polling does not recount loader edges', 'temporal cooccurrence creates no loader edge');
  await page.evaluate(() => new Promise((resolve, reject) => { const script = document.createElement('script'); script.onload = resolve; script.onerror = reject; script.src = '/private/SOCIAL_PATH_CANARY/main.js?secret=SOCIAL_SCRIPT_QUERY_CANARY'; document.head.appendChild(script); }));
  await page.waitForFunction(() => window.fixtureSocialReady && !window.fixtureSocialError, null, { timeout: 5000 });
  const socialRequest = { ...request, type: 'ui-get-social-networks' };
  let social;
  for (let attempt = 0; attempt < 20; attempt++) {
    social = readSocialSnapshot(await send(socialRequest));
    if (social?.rows.filter(row => row.script?.pathTemplate === '/main.js').length === socialNativeFixtures.length) break;
    await page.waitForTimeout(150);
  }
  assert.ok(social, 'native social response matches the canonical snapshot');
  const socialRows = social.rows.filter(row => row.script?.pathTemplate === '/main.js');
  assert.deepEqual(socialRows.map(row => row.service + ':' + row.kind).sort(), socialNativeExpected);
  assert.equal(socialRows.find(row => row.service === 'facebook').method, 'POST');
  assert.equal(socialRows.find(row => row.service === 'facebook').requestType, 'ping');
  assert.ok(socialRows.every(row => row.script.host === 'example.com' && row.attributionConfidence === 'exact-resource' && row.evidenceSource === 'page-hook' && row.integrity === 'page-controlled'), JSON.stringify(socialRows));
  assert.ok(social.rows.filter(row => row.evidenceSource === 'browser-network').every(row => row.script === null && row.integrity === 'browser-observed'));
  for (const sentinel of ['SOCIAL_SCRIPT_QUERY_CANARY', 'SOCIAL_REQUEST_QUERY_CANARY', 'SOCIAL_PATH_CANARY', 'SOCIAL_REQUEST_BODY_CANARY']) assert.equal(JSON.stringify(social).includes(sentinel), false);
  evidence.social = social;
  evidence.checks.push('13 passive Social rows across 11 providers distinguish tracking SDKs, ordinary SDKs and pixels from setAttribute and sendBeacon with exact initiating external script');
  const thirdParty = readThirdPartySnapshot(await send({ ...request, type: 'ui-get-third-party' }));
  assert.ok(thirdParty?.rows.length, 'third-party requests in the main document are present without an iframe');
  assert.ok(thirdParty.rows.some(row => row.domain === 'hotjar.com' && row.type === 'script'));
  assert.ok(thirdParty.rows.some(row => row.type === 'ping' || row.type === 'image'));
  assert.ok(thirdParty.rows.every(row => row.documentKey === request.documentKey && row.evidenceSource === 'browser-network' && row.script === null));
  for (const sentinel of ['GTM_URL_CANARY', 'SOCIAL_SCRIPT_QUERY_CANARY', 'SOCIAL_REQUEST_QUERY_CANARY', 'SOCIAL_PATH_CANARY', 'SOCIAL_REQUEST_BODY_CANARY']) assert.equal(JSON.stringify(thirdParty).includes(sentinel), false);
  evidence.thirdParty = thirdParty;
  evidence.checks.push('browser-observed third-party main-document scripts and pixel/beacon requests appear in the root inventory with no query/body/private path or fabricated initiating script');
  const stopped = await send({ schemaVersion: 1, type: 'ui-pro-stop', sessionId: started.session.id }); assert.equal(stopped.session.status, 'stopped');
  evidence.pro = stopped.session;
  assert.ok(stopped.session.pages.some(page => page.cookies?.entries.length === 4));
  assert.ok(stopped.session.pages.flatMap(page => page.socialNetworks ?? []).flatMap(document => document.rows).some(row => row.script?.pathTemplate === '/main.js'));
  assert.deepEqual(stopped.session.pages.flatMap(page => page.socialNetworks ?? []).flatMap(document => document.rows).filter(row => row.script?.pathTemplate === '/main.js').map(row => row.service + ':' + row.kind).sort(), socialNativeExpected);
  assert.equal(JSON.stringify(stopped.session).includes('SOCIAL_REQUEST_BODY_CANARY'), false);
  // ADR-037 intentionally records native outgoing Cookie headers in this one Pro channel.
  // Metadata, Light and every other Pro field retain the original redaction assertions.
  const withoutOutgoingCookies = { ...stopped.session, pages: stopped.session.pages.map(({ cookieValues, ...page }) => page) };
  for (const sentinel of ['COOKIE_VALUE_CANARY', 'AUTH_VALUE_CANARY', 'FIRST_DYNAMIC_CANARY', 'SECOND_DYNAMIC_CANARY', 'DBSC_HEADER_CANARY', 'GTM_URL_CANARY', '_ga_ALPHA', '_ga_BETA', 'CLOSED_UI_VALUE_CANARY', 'SOCIAL_SCRIPT_QUERY_CANARY', 'SOCIAL_REQUEST_QUERY_CANARY', 'SOCIAL_PATH_CANARY']) assert.equal(JSON.stringify(withoutOutgoingCookies).includes(sentinel), false, sentinel + ' absent from metadata and other recording channels');
  for (const sentinel of ['DBSC_HEADER_CANARY', 'GTM_URL_CANARY', 'CLOSED_UI_VALUE_CANARY', 'SOCIAL_SCRIPT_QUERY_CANARY', 'SOCIAL_REQUEST_QUERY_CANARY', 'SOCIAL_PATH_CANARY']) assert.equal(JSON.stringify(stopped.session).includes(sentinel), false, sentinel + ' absent from the whole recording');
  const sentCookies = stopped.session.pages.flatMap(page => page.cookieValues?.rows ?? []);
  assert.deepEqual([...new Set(sentCookies.map(row => row.name + '=' + row.value))].sort(), ['_ga=COOKIE_VALUE_CANARY', 'PHPSESSID=AUTH_VALUE_CANARY', '_ga_ALPHA=FIRST_DYNAMIC_CANARY', '_ga_BETA=SECOND_DYNAMIC_CANARY'].sort());
  assert.ok(sentCookies.every(row => row.documentKey === request.documentKey && row.destinationHost === new URL(origin).hostname && row.count > 0), 'only native fixture destination and current document supplied outgoing values');
  evidence.checks.push('ADR-037 native outgoing Cookie values appear only in their explicit Pro channel; metadata and all other redaction boundaries remain enforced');
  await ui.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), tab.id);
  await ui.reload(); await ui.locator('[data-identification-tab="cookie"]').waitFor();
  await ui.waitForFunction(() => document.querySelector('[data-identification-count="cookie"]')?.textContent === '3');
  assert.equal(await ui.locator('[data-identification-tab]').count(), 7);
  const layout = await ui.locator('.identification-tabs').evaluate(element => ({ columns: getComputedStyle(element).gridTemplateColumns.split(' ').map(Number.parseFloat), width: element.getBoundingClientRect().width }));
  assert.equal(layout.columns.length, 2, 'narrow popup uses two columns regardless of surrounding viewport');
  assert.ok(layout.columns.every(width => width >= 120), JSON.stringify(layout));
  evidence.tabLayout = layout;
  await ui.locator('[data-identification-tab="third-party"]').click();
  // ADR-103: request kinds lead the panel; the per-resource table is opened explicitly.
  await ui.locator('[data-third-party-techniques]').waitFor(); await ui.locator('[data-third-party-details] > summary').click();
  await ui.locator('[data-third-party-row]').first().waitFor();
  const thirdPartyLayout = await ui.evaluate(thirdPartyLayoutMetrics);
  assert.equal(thirdPartyLayout.display, 'block'); assert.equal(thirdPartyLayout.overflow, false);
  assert.ok(thirdPartyLayout.rows.every(row => row.cells === 4 && !row.overflow && row.labels && row.values));
  assert.ok(Number(await ui.locator('[data-identification-count="third-party"]').textContent()) > 0);
  assert.equal(await ui.locator('[data-identification-count="third-party"]').textContent(), await ui.locator('[data-third-party-requests]').getAttribute('data-third-party-requests'));
  assert.doesNotMatch(await ui.locator('.inspector-vendors').innerText(), /does not prove|не доказывает/);
  await ui.screenshot({ path: join(artifact, 'third-party-popup-chrome.png'), fullPage: true });
  evidence.thirdPartyLayout = thirdPartyLayout;
  evidence.checks.push('Third Party popup has a nonzero request badge matching root inventory, readable resource cards and concise anti-fraud empty state');
  await ui.locator('[data-identification-tab="social"]').click();
  await ui.locator('[data-identification-tab="cookie"]').press('End');
  assert.equal(await ui.locator('[data-identification-tab="background"]').getAttribute('aria-selected'), 'true');
  await ui.locator('[data-identification-tab="social"]').click();
  await ui.locator('[data-social-script]').first().waitFor();
  assert.ok((await ui.locator('[data-social-script]').allTextContents()).includes('example.com/main.js'));
  assert.equal(await ui.locator('[data-identification-count="social"]').textContent(), String(new Set(social.rows.map(row => row.service)).size));
  const socialLayout = await ui.evaluate(socialLayoutMetrics);
  assert.equal(socialLayout.tableDisplay, 'block'); assert.equal(socialLayout.headerPosition, 'absolute');
  assert.equal(socialLayout.overflow, false); assert.ok(socialLayout.width >= 280);
  assert.deepEqual(socialLayout.roles, ['table', 'rowgroup', 'rowgroup']);
  assert.ok(socialLayout.rows.every(row => row.role === 'row' && row.cells.length === 4 && row.cells.every(cell => cell.role === 'cell' && !cell.overflow && cell.labelDisplay === 'block' && cell.labelHiddenFromAT === 'true' && cell.value)));
  evidence.socialLayout = socialLayout;
  await ui.screenshot({ path: join(artifact, 'social-cards-popup-chrome.png'), fullPage: true });
  evidence.checks.push('narrow Social popup renders complete labeled cards with table accessibility semantics and no horizontal overflow on a wide browser viewport');
  await ui.locator('[data-identification-tab="social"]').press('Home');
  assert.equal(await ui.locator('[data-identification-tab="active"]').getAttribute('aria-selected'), 'true');
  await ui.locator('[data-identification-tab="cookie"]').click(); await ui.locator('[data-cookie-tracking="true"]').first().waitFor();
  assert.equal(await ui.locator('[data-cookie-tracking="true"]').count(), 3);
  assert.equal(await ui.locator('[data-cookie-tracking="false"]').count(), 1);
  assert.match(await ui.locator('[data-identification-tab="cookie"] .identification-tab__label').textContent(), /4/);
  assert.match(await ui.locator('[data-cookie-total]').textContent(), /4/);
  assert.equal(await ui.locator('[data-cookie-panel]').evaluate(element => element.firstElementChild?.dataset.cookieAction), 'clear');
  const visuals = await ui.locator('[data-cookie-panel]').evaluate(element => {
    const tracking = element.querySelector('[data-cookie-tracking="true"]');
    const functional = element.querySelector('[data-cookie-tracking="false"]');
    const image = element.querySelector('.cookie-entry__company [data-company-brand="google"] img');
    return { trackingBackground: getComputedStyle(tracking).backgroundColor, ordinaryBackground: getComputedStyle(functional).backgroundColor,
      imageLoaded: image?.complete && image.naturalWidth > 0, imageSource: image?.src };
  });
  assert.notEqual(visuals.trackingBackground, visuals.ordinaryBackground);
  assert.equal(visuals.imageLoaded, true); assert.ok(visuals.imageSource.startsWith('chrome-extension://' + id + '/icons/brands/'));
  evidence.cookieVisuals = visuals;
  evidence.checks.push('Cookie total remains separate from red tracking badge, top cleanup button, coloured tracking cards and packaged Google image');
  await ui.locator('[data-cookie-value-action="show"]').first().waitFor();
  assert.equal(await ui.locator('[data-cookie-value-action="show"]').count(), 4);
  assert.equal(await ui.locator('[data-cookie-tpm]').count(), 0, 'ADR-044 removed all TPM/DBSC UI states');
  assert.equal(await ui.locator('[data-cookie-tpm="protected"]').count(), 0);
  const shownValues = [];
  const cards = ui.locator('.cookie-entry');
  for (let index = 0; index < 4; index++) {
    const card = cards.nth(index);
    await card.locator('[data-cookie-value-action="show"]').click();
    await card.locator('[data-cookie-value-text]').waitFor();
    shownValues.push(await card.locator('[data-cookie-value-text]').textContent());
    assert.equal(await ui.locator('[data-cookie-value-text]').count(), 1, 'one live value visible at a time');
    await card.locator('[data-cookie-value-action="hide"]').click();
    assert.equal(await ui.locator('[data-cookie-value-text]').count(), 0);
  }
  assert.deepEqual(shownValues.sort(), ['COOKIE_VALUE_CANARY', 'FIRST_DYNAMIC_CANARY', 'SECOND_DYNAMIC_CANARY', 'AUTH_VALUE_CANARY'].sort());
  await cards.first().locator('[data-cookie-value-action="show"]').click();
  await cards.first().locator('[data-cookie-value-text]').waitFor();
  await ui.screenshot({ path: join(artifact, 'cookie-value-tpm-chrome.png'), fullPage: true });
  await ui.locator('[data-cookie-action="refresh"]').click();
  assert.equal(await ui.locator('[data-cookie-value-text]').count(), 0, 'refresh immediately resets displayed value');
  await ui.locator('[data-cookie-value-action="show"]').first().waitFor();
  const saved = await ui.evaluate(() => chrome.storage.local.get(null));
  for (const sentinel of shownValues) assert.equal(JSON.stringify(saved).includes(sentinel), false, 'local live value absent from storage');
  evidence.checks.push('explicit per-cookie values distinguish masked duplicate names and HttpOnly cookie; hide and refresh clear live text', 'removed TPM/DBSC UI remains absent and live values remain absent from persistent storage');
  await ui.screenshot({ path: join(artifact, 'cookie-tabs-chrome.png'), fullPage: true });
  const reportUi = await context.newPage(); reportUi.on('pageerror', error => evidence.errors.push(error.message));
  await reportUi.goto('chrome-extension://' + id + '/report.html?id=' + started.session.id);
  await reportUi.locator('[data-pro-cookies]').waitFor(); await reportUi.locator('[data-pro-tag-manager]').waitFor(); await reportUi.locator('[data-pro-social-networks]').waitFor();
  await reportUi.locator('[data-pro-third-party]').first().waitFor();
  const expectedThirdParty = stopped.session.pages.reduce((sum, page) => sum + page.resources.filter(resource => resource.relation === 'cross-site' && resource.requestCount > 0).length, 0);
  assert.equal(await reportUi.locator('[data-pro-third-party] [data-third-party-row]').count(), expectedThirdParty);
  evidence.checks.push('standalone Pro report includes every retained cross-site resource group in its localized Third Party section');
  const socialInventories = stopped.session.pages.filter(page => page.socialNetworks?.some(document => document.rows.length || document.truncated)).map(page => page.socialNetworks);
  const socialSections = reportUi.locator('[data-pro-social-networks]');
  assert.equal(await socialSections.count(), socialInventories.length);
  for (const [index, documents] of socialInventories.entries()) {
    const section = socialSections.nth(index), rows = documents.flatMap(document => document.rows);
    const rendered = await section.locator('tr[data-social-kind]').evaluateAll(nodes => nodes.map(node => [node.dataset.socialService, node.dataset.socialKind, node.dataset.socialEvidence].join(':')));
    assert.deepEqual(rendered, rows.map(row => [row.service, row.kind, row.evidenceSource].join(':')), 'every admitted Social row renders in the standalone Pro report');
    assert.deepEqual(await section.locator('[data-social-pro-document]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.socialProDocument))), documents.flatMap((document, documentIndex) => document.rows.map(() => documentIndex)), 'every report row retains the correct source document');
    assert.equal(await section.locator('[data-social-count-source]').count(), rows.length);
    assert.doesNotMatch(await section.textContent(), /social_kind_|social_endpoint_|social_resource_|\$COUNT\$|undefined|\[object Object\]/);
  }
  evidence.checks.push('standalone localized Pro report renders every admitted Social row and separate source counters with exact document/row totals');
  assert.equal(await reportUi.locator('[data-cookie-value-action]').count(), 0);
  assert.equal(await reportUi.locator('[data-cookie-value-text]').count(), 0);
  const savedInventories = stopped.session.pages.filter(page => page.cookies?.permission === 'granted').map(page => page.cookies);
  const tables = reportUi.locator('[data-cookie-report-table]');
  assert.equal(await tables.count(), savedInventories.length);
  for (const [index, inventory] of savedInventories.entries()) {
    const table = tables.nth(index), tableRows = table.locator('[data-cookie-report-row]');
    assert.equal(await table.locator('thead th').count(), 6, 'six current columns; retired DBSC/TPM column stays absent');
    assert.equal(await tableRows.count(), inventory.entries.length, 'every saved cookie has one report table row');
    assert.equal(await table.locator('details').count(), 0, 'cookie descriptions and sources are expanded in the printable report');
    assert.match(await table.locator('thead').textContent(), /Категория \/ отслеживание \/ подтверждение/);
    for (const [rowIndex, entry] of inventory.entries.entries()) {
      const row = tableRows.nth(rowIndex), rowText = await row.textContent();
      for (const detail of [entry.name, entry.domain, 'Secure=', 'HttpOnly=', 'SameSite=', ...entry.ruleIds]) assert.ok(rowText.includes(detail), detail + ' appears in cookie row');
      assert.deepEqual(await row.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href'))), entry.sourceUrls, 'all cookie source URLs retained');
      assert.equal(await row.locator('.cookie-report-analysis li').count(), 0, 'report attributes remain compact facts without duplicate analysis');
      assert.doesNotMatch(rowText, /\$[A-Z_]+\$|cookie_analysis_|cookie_category_|undefined|\[object Object\]/);
    }
  }
  assert.ok((await reportUi.locator('[data-pro-social-networks] [data-social-script]').allTextContents()).includes('example.com/main.js'));
  const text = await reportUi.locator('[data-pro-tag-manager]').textContent();
  for (const service of ['Google Tag Manager', 'Facebook Pixel', 'Hotjar', 'Criteo']) assert.ok(text.includes(service), service + ' shown in report');
  const summary = await reportUi.locator('[data-tag-manager-summary]').first().textContent();
  assert.match(summary, /Google Tag Manager инициировал загрузку:/);
  for (const service of ['Facebook Pixel', 'Hotjar', 'Criteo']) assert.equal(summary.split(service).length - 1, 1, service + ' appears once in the page summary');
  assert.doesNotMatch(summary, /\$SERVICES\$/);
  evidence.loaderSummary = summary;
  const reportSocialLayout = await reportUi.evaluate(socialLayoutMetrics);
  assert.equal(reportSocialLayout.tableDisplay, 'table'); assert.equal(reportSocialLayout.overflow, false);
  assert.equal(reportSocialLayout.headers.length, 6); assert.ok(reportSocialLayout.headers.every(header => header.text.trim().length > 0));
  assert.ok(reportSocialLayout.rows.every(row => row.cells.length === 6 && row.cells.every(cell => !cell.overflow)), 'all six current report columns fit their cells');
  await reportUi.emulateMedia({ media: 'print' });
  const printSocialLayout = await reportUi.evaluate(socialLayoutMetrics);
  assert.equal(printSocialLayout.tableDisplay, 'table'); assert.equal(printSocialLayout.headerDisplay, 'table-header-group');
  assert.ok(printSocialLayout.rows.every(row => row.cells.every(cell => cell.labelDisplay === null || cell.labelDisplay === 'none')));
  await reportUi.emulateMedia({ media: 'screen' });
  evidence.reportSocialLayout = { screen: reportSocialLayout, print: printSocialLayout };
  await reportUi.screenshot({ path: join(artifact, 'cookie-gtm-report-chrome.png'), fullPage: true });
  await reportUi.pdf({ path: join(artifact, 'cookie-gtm-report.pdf'), format: 'A4', printBackground: true });
  evidence.checks.push('seven native tabs with keyboard End/Home navigation and automatic tracking/service badges', 'Cookie metadata UI', 'Pro snapshot cookies and service chains', 'complete localized Cookie table with all saved rows, analysis, attributes and source URLs', 'Social Networks report retains redacted initiating scripts', 'report print projection');
  await ui.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), tab.id);
  await ui.waitForFunction(() => document.querySelector('[data-identification-count="cookie"]')?.textContent === '3');
  const seeded = await ui.evaluate(async () => {
    const stores = await chrome.cookies.getAllCookieStores(); const storeId = stores[0].id;
    const rows = [
      { url: 'https://site.cookies.example.com/auth', name: 'AMP_TEST_1791540000000', value: 'CLEAR_VALUE_CANARY', path: '/auth', secure: true, httpOnly: true, sameSite: 'strict' },
      { url: 'https://site.cookies.example.com/', domain: '.example.com', name: 'PATH_SCOPED_FIXTURE', value: 'PATH_ROOT_CANARY', path: '/' },
      { url: 'https://site.cookies.example.com/account', domain: '.example.com', name: 'PATH_SCOPED_FIXTURE', value: 'PATH_PRIVATE_CANARY', path: '/account', httpOnly: true },
      { url: 'https://api.cookies.example.com/', name: '_fw_crm_v', value: 'SUBDOMAIN_CANARY' },
      { url: 'https://site.cookies.example.com/', name: 'CURRENT_PARTITION_FIXTURE', value: 'PART_CURRENT_CANARY', secure: true, sameSite: 'no_restriction', partitionKey: { topLevelSite: 'http://example.com' } },
      { url: 'https://site.cookies.example.com/', name: 'OTHER_PARTITION_FIXTURE', value: 'PART_OTHER_CANARY', secure: true, sameSite: 'no_restriction', partitionKey: { topLevelSite: 'https://other.test' } },
      { url: 'https://foreign.other.test/', name: 'FOREIGN_SITE_FIXTURE', value: 'FOREIGN_CANARY' }
    ];
    for (const row of rows) { const result = await chrome.cookies.set({ ...row, storeId }); if (!result) return false; }
    return true;
  });
  assert.equal(seeded, true, 'local test cookie fixtures created through native API');
  const expanded = await send(request);
  assert.equal(expanded.totalCount, 9, JSON.stringify(expanded)); assert.equal(expanded.siteCount, 9);
  const probeCookie = expanded.entries.find(entry => entry.name === 'AMP_TEST_*');
  assert.equal(probeCookie.owner, 'Amplitude'); assert.equal(probeCookie.category, 'functional'); assert.equal(probeCookie.tracking, false);
  const referenceCookie = expanded.entries.find(entry => entry.name === '_fw_crm_v');
  assert.equal(referenceCookie.category, 'unknown'); assert.equal(referenceCookie.owner, ''); assert.equal(referenceCookie.tracking, false);
  assert.match(referenceCookie.purpose, /^Catalogue name match: Freshworks/);
  await ui.locator('[data-cookie-action="refresh"]').click();
  await ui.locator('[data-cookie-name-reference]').waitFor();
  assert.match(await ui.locator('[data-cookie-name-reference]').textContent(), /Freshworks/);
  assert.ok((await ui.locator('.cookie-entry').allTextContents()).some(text => text.includes('Совпадение имени в справочнике')));
  assert.equal(await ui.locator('[data-identification-count="cookie"]').textContent(), '3');
  evidence.checks.push('expanded catalogue renders documented Amplitude probe and neutral Freshworks name reference without increasing tracking badge');
  await ui.waitForFunction(() => document.querySelector('[data-cookie-action="clear"]')?.disabled === false);
  await ui.locator('[data-cookie-action="clear"]').click();
  await ui.waitForFunction(() => document.querySelector('[data-identification-count="cookie"]')?.textContent === '0', null, { timeout: 15000 });
  let cleared;
  for (let attempt = 0; attempt < 40; attempt++) {
    cleared = await send(request);
    if (cleared.type === 'cookies-state' && cleared.totalCount === 0) break;
    await ui.waitForTimeout(100);
  }
  assert.equal(cleared.type, 'cookies-state'); assert.equal(cleared.totalCount, 0); assert.equal(cleared.siteCount, 0); assert.deepEqual(cleared.entries, []);
  const cleanupText = await ui.locator('.cookie-clear-result').textContent(); assert.match(cleanupText, /9/); assert.match(cleanupText, /0/);
  const retained = await ui.evaluate(async () => ({ foreign: (await chrome.cookies.getAll({ domain: 'other.test' })).map(cookie => cookie.name), otherPartition: (await chrome.cookies.getAll({ domain: 'example.com', partitionKey: { topLevelSite: 'https://other.test' } })).map(cookie => cookie.name) }));
  assert.deepEqual(retained.foreign, ['FOREIGN_SITE_FIXTURE']); assert.deepEqual(retained.otherPartition, ['OTHER_PARTITION_FIXTURE']);
  evidence.checks.push('total counts include all same-site paths and subdomains before cleanup', 'explicit native UI cleanup removes Secure HttpOnly path duplicate and current-partition cookies', 'cleanup preserves foreign-site and other-partition cookies');
  evidence.cookieCleanup = { before: expanded.totalCount, after: cleared.totalCount, retainedForeign: retained.foreign.length, retainedOtherPartition: retained.otherPartition.length };
  await ui.screenshot({ path: join(artifact, 'cookie-cleanup-chrome.png'), fullPage: true });
  const revoked = await ui.evaluate(() => chrome.permissions.remove({ permissions: ['cookies'] })); assert.equal(revoked, true);
  let denied;
  for (let attempt = 0; attempt < 20; attempt++) { denied = await send(request); if (denied.permission === 'required') break; await page.waitForTimeout(100); }
  assert.equal(denied.permission, 'required', JSON.stringify(denied)); assert.deepEqual(denied.entries, []);
  await ui.waitForFunction(() => document.querySelector('[data-identification-count="cookie"]')?.textContent === '0');
  await ui.locator('[data-cookie-action="refresh"]').click();
  await ui.locator('[data-cookie-action="grant"]').waitFor();
  assert.equal((await send({ schemaVersion: 1, type: 'ui-pro-get', tabId: tab.id })).session.pages.some(page => page.cookies), false);
  evidence.checks.push('revocation clears native Cookie view and retained Pro snapshots');
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.unexpectedRequests, []);
  console.log('PASS: native Chrome Cookie table, autonomous Pro capture, seven tabs, Social Networks, GTM chains, privacy and revocation (' + evidence.checks.length + ' checks)');
} finally {
  writeFileSync(join(artifact, 'chrome.json'), JSON.stringify(evidence, null, 2) + '\n');
  await context.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
  assert.ok(run.startsWith(temporary + sep)); rmSync(run, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
