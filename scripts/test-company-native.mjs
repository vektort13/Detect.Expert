// ADR-034/035: delivered Chrome UI, intercepted vendor resources and an owned favicon.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { advancedBeaconFixtures } from './test/advanced-native-fixtures.mjs';
import { readOwnedTechnicalValues, assertTechnicalValues } from './test/pro-values-native-fixtures.mjs';
const root = resolve(import.meta.dirname, '..'), output = join(root, 'dist/chrome');
const artifact = join(root, 'test-results/production-1.1.0/company-logos'); mkdirSync(artifact, { recursive: true });
const run = mkdtempSync(join(root, '.tmp/company-native-')), extension = join(run, 'extension'); cpSync(output, extension, { recursive: true });
assert.ok(resolve(run).startsWith(join(root, '.tmp') + sep), 'temporary run stays in the project');
const urls = ['https://www.google.com/recaptcha/api.js', 'https://js.datadome.co/tags.js', 'https://h.online-metrix.net/fp/tags.js', 'https://www.googletagmanager.com/gtm.js?id=GTM-TEST'];
const gtmChildren = ['https://connect.facebook.net/en_US/fbevents.js', 'https://static.hotjar.com/c/hotjar-123.js?sv=6', 'https://dynamic.criteo.com/js/ld/ld.js?a=1'];
const stub = 'window.companyFixtureLoaded=(window.companyFixtureLoaded||0)+1;';
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/favicon.svg') { response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#167a83"/><path d="M8 25L16 7l8 18z" fill="#fff"/></svg>'); return; }
  response.setHeader('Set-Cookie', ['_ga=COMPANY_COOKIE_CANARY; Max-Age=3600; Path=/; SameSite=Lax', '_fbp=COMPANY_META_CANARY; Max-Age=3600; Path=/; SameSite=Lax', 'PHPSESSID=COMPANY_AUTH_CANARY; HttpOnly; Path=/; SameSite=Lax']);
  response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><html><head><title>Owned company logo fixture</title><link rel="icon" href="/favicon.svg"></head><body><h1>Owned company logo fixture</h1></body></html>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done)); const origin = 'http://site.company.example.com:' + server.address().port;
const evidence = { errors: [], unexpectedRequests: [], checks: [], packagedHashes: Object.fromEntries(['manifest.json', 'icons/brands/COMPANY-PROVENANCE.json', 'company-branding.js', 'company-ui.js', 'company-ui.css', 'site-favicon.js', 'site-favicon-ui.js', 'site-favicon.css', 'identification-ui.js', 'advanced-ui.js', 'pro-report-tables.js', 'report.css', 'background.js', 'popup.js', 'sidepanel.js', 'report.js'].map(file => [file, createHash('sha256').update(readFileSync(join(output, file))).digest('hex')])) };
// Create an ephemeral local certificate entirely in memory; no OS trust store is changed.
const certificate = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
  "$ErrorActionPreference = 'Stop'",
  '$rsa = [System.Security.Cryptography.RSA]::Create(2048)',
  "$request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=cookie.company.example.net', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)",
  '$certificate = $request.CreateSelfSigned([System.DateTimeOffset]::UtcNow.AddDays(-1), [System.DateTimeOffset]::UtcNow.AddDays(1))',
  "[Convert]::ToBase64String($certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, ''))",
  '$certificate.Dispose()', '$rsa.Dispose()',
].join('\n')], { cwd: root, encoding: 'utf8', windowsHide: true });
assert.equal(certificate.status, 0, 'generate the owned HTTPS fixture certificate: ' + certificate.stderr);
evidence.thirdPartyCookie = { prepared: true, sent: false, recorded: false, receivedRequests: 0 };
const cookieServer = createHttpsServer({ pfx: Buffer.from(certificate.stdout.trim(), 'base64'), passphrase: '' }, (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Access-Control-Allow-Credentials', 'true'); response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/outgoing-cookie') {
    ++evidence.thirdPartyCookie.receivedRequests;
    evidence.thirdPartyCookie.sent ||= (request.headers.cookie ?? '').includes('_fbp=OWNED_THIRD_PARTY_COOKIE_CANARY');
  }
  response.end('owned HTTPS response');
});
await new Promise(done => cookieServer.listen(0, '127.0.0.1', done));
const cookieOrigin = 'https://cookie.company.example.net:' + cookieServer.address().port;
let context;
const technicalSamples = [];
async function logos(page, section) {
  return page.locator(section + ' [data-company-logo]').evaluateAll(images => images.map(image => ({ brand: image.dataset.companyLogo, decoded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0, width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height, source: new URL(image.src).protocol })));
}
async function requireLogos(page, section, minimum = 1) {
  await page.locator(section + ' [data-company-logo]').first().waitFor();
  await page.locator(section + ' [data-company-logo]').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  const rows = await logos(page, section); assert.ok(rows.length >= minimum, section + ': company images');
  assert.ok(rows.every(row => row.decoded && row.width === row.height && [18, 20, 28].includes(row.width) && row.source === 'chrome-extension:'), section + ': local decoded fixed-size images'); return rows;
}
try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, ignoreHTTPSErrors: true, viewport: { width: 1080, height: 850 }, args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-proxy-server', '--host-resolver-rules=MAP site.company.example.com 127.0.0.1,MAP frame.company.example.net 127.0.0.1,MAP cookie.company.example.net 127.0.0.1'] });
  evidence.browser = context.browser().version();
  await context.addCookies([{ name: '_fbp', value: 'OWNED_THIRD_PARTY_COOKIE_CANARY', domain: 'cookie.company.example.net', path: '/', secure: true, httpOnly: true, sameSite: 'None' }]);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()); if (url.protocol !== 'https:') return route.continue();
    if (url.origin === cookieOrigin) return route.continue();
    if (urls.includes(url.href) || gtmChildren.includes(url.href)) return route.fulfill({ contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: url.hostname === 'www.googletagmanager.com' ? 'for(const url of ' + JSON.stringify(gtmChildren) + '){const node=document.createElement("script");node.src=url;document.head.appendChild(node);}' : stub });
    if (advancedBeaconFixtures.some(row => row.url === url.href)) {
      const ownedThirdParty = url.hostname === 'www.facebook.com';
      return route.fulfill({ contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': ownedThirdParty ? origin : '*', ...(ownedThirdParty ? { 'Access-Control-Allow-Credentials': 'true' } : {}), 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' });
    }
    evidence.unexpectedRequests.push(url.origin); return route.abort();
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
  const ui = await context.newPage(); ui.on('pageerror', error => evidence.errors.push(error.message)); await ui.goto('chrome-extension://' + id + '/popup.html');
  const send = message => ui.evaluate(message => chrome.runtime.sendMessage(message), message);
  assert.equal((await send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true })).accepted, true);
  await send({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' }); await ui.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'ru' }));
  const site = await context.newPage(); site.on('pageerror', error => evidence.errors.push(error.message)); await site.goto(origin); await site.waitForTimeout(500);
  const tab = await ui.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)), origin + '/'); assert.ok(tab?.id);
  await ui.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), tab.id); await ui.reload();
  await ui.locator('[data-identification-tab="cookie"]').click(); await ui.locator('[data-cookie-action="grant"]').click();
  await ui.waitForFunction(() => chrome.permissions.contains({ permissions: ['cookies'] }));
  evidence.cookies = await requireLogos(ui, '.cookie-entry', 2);
  const started = await send({ schemaVersion: 1, type: 'ui-pro-start', tabId: tab.id }); assert.equal(started.type, 'pro-state');
  await site.waitForTimeout(900);
  technicalSamples.push(await site.evaluate(readOwnedTechnicalValues, 137));
  const frameOrigin = 'http://frame.company.example.net:' + server.address().port;
  await site.evaluate(url => new Promise(done => { const frame = document.createElement('iframe'); frame.src = url; frame.onload = done; document.body.append(frame); }), frameOrigin + '/frame');
  await site.waitForTimeout(1000);
  const thirdPartyFrame = site.frames().find(frame => frame.url().startsWith(frameOrigin)); assert.ok(thirdPartyFrame);
  const nativeChild = await ui.evaluate(async ({ tabId, url }) => (await chrome.webNavigation.getAllFrames({ tabId })).find(frame => frame.url === url), { tabId: tab.id, url: frameOrigin + '/frame' });
  assert.ok(nativeChild?.documentId && nativeChild.frameId > 0);
  evidence.technicalChildDocument = tab.id + ':' + nativeChild.frameId + ':' + nativeChild.documentId;
  technicalSamples.push(await thirdPartyFrame.evaluate(readOwnedTechnicalValues, 271));
  await thirdPartyFrame.evaluate(() => fetch('/frame-observation'));
  await site.evaluate(async ({ urls, beacons, cookieOrigin }) => {
    await Promise.all(urls.map(url => new Promise(done => { const node = document.createElement('script'); node.src = url; node.onload = node.onerror = done; document.head.appendChild(node); })));
    await Promise.all(beacons.map(row => fetch(row.url, { method: row.method, credentials: row.url.startsWith('https://www.facebook.com/') ? 'include' : 'same-origin', ...(row.body ? { body: row.body } : {}) }).catch(() => null)));
    await fetch('/cookie-observation', { credentials: 'same-origin' });
    await fetch(cookieOrigin + '/outgoing-cookie', { credentials: 'include' });
    void window.innerWidth; void window.innerHeight;
  }, { urls, beacons: advancedBeaconFixtures, cookieOrigin });
  assert.ok(evidence.thirdPartyCookie.receivedRequests > 0, 'the local HTTPS server received the actual cross-site request');
  await site.waitForTimeout(1200); await ui.reload();
  await ui.locator('[data-identification-tab="active"]').waitFor();
  evidence.antifraud = await requireLogos(ui, '.recognized-vendors', 3);
  await ui.locator('[data-identification-tab="social"]').click(); evidence.social = await requireLogos(ui, '[data-social-table]', 1);
  await ui.locator('[data-identification-tab="beacons"]').click(); evidence.beacons = await requireLogos(ui, '[data-beacon-row]', 5);
  await ui.locator('.inspector-site [data-site-icon-state="ready"] img').waitFor();
  evidence.siteIcon = await ui.locator('.inspector-site [data-site-icon] img').evaluate(async image => { await image.decode(); return { decoded: image.complete && image.naturalWidth === 32 && image.naturalHeight === 32, width: image.getBoundingClientRect().width, source: image.src.slice(0, 22) }; });
  assert.equal(evidence.siteIcon.decoded, true); assert.equal(evidence.siteIcon.width, 24); assert.equal(evidence.siteIcon.source, 'data:image/png;base64,');
  const cache = await ui.evaluate(() => chrome.storage.local.get('site-icons:v1').then(value => value['site-icons:v1']));
  assert.ok(cache.entries.length > 0 && cache.entries.length <= 64);
  assert.ok(cache.entries.every(entry => Object.keys(entry).sort().join(',') === 'at,host,png' && !entry.host.includes('/') && entry.png.startsWith('data:image/png;base64,')));
  await ui.screenshot({ path: join(artifact, 'native-popup.png'), fullPage: true });
  await ui.locator('#popup-mode-tab-pro').click();
  await ui.locator('dd [data-site-icon-state="ready"] img').first().waitFor();
  evidence.proSiteIcons = await ui.locator('dd [data-site-icon] img').evaluateAll(images => Promise.all(images.map(async image => { await image.decode(); return { decoded: image.naturalWidth === 32 && image.naturalHeight === 32, width: image.getBoundingClientRect().width }; })));
  assert.ok(evidence.proSiteIcons.length > 0 && evidence.proSiteIcons.every(image => image.decoded && image.width === 20));
  await ui.screenshot({ path: join(artifact, 'native-pro-mode.png'), fullPage: true });
  await site.goto(origin + '/second-visit'); await site.waitForTimeout(1000);
  technicalSamples.push(await site.evaluate(readOwnedTechnicalValues, 389));
  await site.evaluate(() => fetch('/second-observation'));
  await site.waitForTimeout(1000);
  const stopped = await send({ schemaVersion: 1, type: 'ui-pro-stop', sessionId: started.session.id }); assert.equal(stopped.session.status, 'stopped');
  const report = await context.newPage(); report.on('pageerror', error => evidence.errors.push(error.message)); await report.goto('chrome-extension://' + id + '/report.html?id=' + started.session.id);
  await report.locator('[data-pro-cookies]').first().waitFor();
  evidence.report = {};
  for (const [name, selector, minimum] of [['antifraud', 'tr[data-vendor-id]', 3], ['social', '[data-pro-social-networks]', 1], ['cookie', '[data-pro-cookies]', 2], ['gtm', '[data-pro-tag-manager]', 4], ['beacons', '[data-pro-beacons]', 5]]) evidence.report[name] = await requireLogos(report, selector, minimum);
  const expectedVendorIds = [...new Set(stopped.session.pages.flatMap(page => page.reports.flatMap(document => document.vendors.map(vendor => vendor.vendorId))))].sort();
  assert.ok(expectedVendorIds.length >= 3);
  assert.deepEqual(await report.locator('[data-pro-vendors] tr[data-vendor-id]').evaluateAll(rows => rows.map(row => row.dataset.vendorId).sort()), expectedVendorIds);
  assert.ok(evidence.report.antifraud.every(row => row.width === 28), 'every recognized company keeps its large local logo in the vendor table');
  const expected = {
    cookies: stopped.session.pages.reduce((sum, page) => sum + (page.cookies?.entries.length ?? 0), 0),
    social: stopped.session.pages.flatMap(page => page.socialNetworks ?? []).reduce((sum, document) => sum + document.rows.length, 0),
    beacons: stopped.session.pages.flatMap(page => page.beacons ?? []).reduce((sum, document) => sum + document.rows.length + document.scriptCalls.length, 0),
    values: stopped.session.pages.flatMap(page => page.apiValues ?? []).reduce((sum, document) => sum + document.rows.length, 0),
    gtm: stopped.session.pages.flatMap(page => page.tagManager ?? []).reduce((sum, document) => sum + document.rows.length, 0),
  };
  evidence.reportTables = await report.evaluate(() => {
    const count = selector => document.querySelectorAll('.pro-report ' + selector).length;
    const sections = [...document.querySelectorAll('.pro-report [data-pro-cookies], .pro-report [data-pro-social-networks], .pro-report [data-pro-beacons], .pro-report [data-pro-background], .pro-report [data-pro-third-party], .pro-report [data-pro-tag-manager]')];
    return { counts: { cookies: count('tr[data-cookie-report-row]'), social: count('tr[data-social-row]'), beacons: count('tr[data-beacon-row]'), values: count('tr[data-pro-value-row]'), gtm: count('.tag-manager-table tbody tr') },
      tables: count('table.pro-data-table'), emptyTables: [...document.querySelectorAll('.pro-report table')].filter(table => !table.querySelector('tbody tr')).length,
      emptySections: sections.filter(section => !section.querySelector('tbody tr')).length, emptyCards: count('.inspector-empty'),
      outsideReport: [...document.querySelectorAll('[data-pro-tag-manager]')].filter(section => !section.closest('.pro-report')).length };
  });
  assert.deepEqual(evidence.reportTables.counts, expected, 'every saved company-related row and technical value is present in the report');
  assert.ok(evidence.reportTables.tables >= 4);
  for (const name of ['emptyTables', 'emptySections', 'emptyCards', 'outsideReport']) assert.equal(evidence.reportTables[name], 0, name);
  evidence.summaries = await report.locator('[data-pro-summary]').evaluateAll(sections => sections.map(section => ({
    kind: section.dataset.proSummary, columns: section.querySelectorAll('thead th').length,
    rows: [...section.querySelectorAll('tbody tr')].map(row => [...row.children].map(cell => cell.textContent)),
    fontSizes: [...new Set([...section.querySelectorAll('th,td,code')].map(node => getComputedStyle(node).fontSize))],
  })));
  assert.deepEqual(evidence.summaries.map(summary => summary.kind).sort(), ['browser', 'cookies']);
  evidence.technicalValues = assertTechnicalValues(stopped.session, technicalSamples, evidence.summaries.find(item => item.kind === 'browser').rows);
  assert.ok(evidence.technicalValues.visits >= 2 && evidence.technicalValues.documents >= 3, 'all visits and cross-site frame are saved');
  assert.ok(stopped.session.pages.some(page => page.apiValues.some(document => document.documentKey === evidence.technicalChildDocument && document.documentKey !== page.documentKey && document.rows.some(row => row.value.kind === 'technical' && row.value.fields.some(field => field.name === 'width' && field.value === 271)))), 'third-party native result is associated with the exact browser child document');
  const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'variant' });
  for (const summary of evidence.summaries) {
    assert.equal(summary.columns, 3); assert.ok(summary.rows.length > 0); assert.deepEqual(summary.fontSizes, ['16px']);
    assert.ok(summary.rows.every((row, index) => row.length === 3 && row[0] === String(index + 1)));
    assert.deepEqual(summary.rows.map(row => row.slice(1)), summary.rows.map(row => row.slice(1)).sort((left, right) => collator.compare(left[0], right[0]) || collator.compare(left[1], right[1])), 'summary is alphabetical by name and retains distinct values');
  }
  for (const value of ['COMPANY_COOKIE_CANARY', 'COMPANY_META_CANARY', 'COMPANY_AUTH_CANARY']) {
    assert.equal((await report.locator('body').textContent()).includes(value), true, 'Pro report includes the cookie value observed in the owned outgoing request');
  }
  evidence.thirdPartyCookie.recorded = (await report.locator('body').textContent()).includes('OWNED_THIRD_PARTY_COOKIE_CANARY');
  assert.equal(evidence.thirdPartyCookie.recorded, evidence.thirdPartyCookie.sent, 'the report reflects whether the browser actually sent the owned third-party cookie');
  await report.locator('[data-site-icon-state="ready"] img').first().waitFor();
  evidence.reportSiteIcons = await report.locator('[data-site-icon] img').evaluateAll(images => Promise.all(images.map(async image => { await image.decode(); return { decoded: image.complete && image.naturalWidth === 32, source: image.src.slice(0, 22) }; })));
  assert.ok(evidence.reportSiteIcons.length >= 2 && evidence.reportSiteIcons.every(image => image.decoded && image.source === 'data:image/png;base64,'));
  evidence.printGate = await report.evaluate(async () => {
    const company = await import(chrome.runtime.getURL('company-ui.js'));
    const site = await import(chrome.runtime.getURL('site-favicon-ui.js'));
    return Promise.all([company.waitForCompanyImages(document), site.waitForSiteIcons(document)]);
  });
  assert.deepEqual(evidence.printGate, [true, true]);
  const screenLogoBrands = (await logos(report, 'body')).map(row => row.brand).sort();
  await report.emulateMedia({ media: 'print' }); evidence.print = await requireLogos(report, 'body', 20);
  assert.deepEqual(evidence.print.map(row => row.brand).sort(), screenLogoBrands, 'printing retains every company logo visible in the preview');
  assert.equal(await report.locator('.pro-report table.pro-data-table').evaluateAll(tables => tables.every(table => getComputedStyle(table).display === 'table' && table.getBoundingClientRect().width > 0)), true, 'data tables remain visible in print');
  evidence.summaryPrint = await report.locator('[data-pro-summary]').evaluateAll(sections => sections.map(section => ({ kind: section.dataset.proSummary, breakBefore: getComputedStyle(section).breakBefore,
    fontSizes: [...new Set([...section.querySelectorAll('th,td,code')].map(node => getComputedStyle(node).fontSize))] })));
  assert.ok(evidence.summaryPrint.every(summary => summary.breakBefore === 'page' && summary.fontSizes.length === 1 && summary.fontSizes[0] === '16px'), 'each summary starts on a new PDF page and retains 12pt text');
  await report.screenshot({ path: join(artifact, 'native-report-print.png'), fullPage: true }); await report.pdf({ path: join(artifact, 'native-report.pdf'), format: 'A4', printBackground: true });
  await report.emulateMedia({ media: 'screen' }); await report.screenshot({ path: join(artifact, 'native-report.png'), fullPage: true });
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.unexpectedRequests, []); evidence.passed = true;
  console.log(JSON.stringify({ browser: evidence.browser, antifraud: evidence.antifraud.length, report: Object.fromEntries(Object.entries(evidence.report).map(([name, rows]) => [name, rows.length])), print: evidence.print.length, passed: true }));
} finally {
  writeFileSync(join(artifact, 'native-chrome.json'), JSON.stringify(evidence, null, 2) + '\n'); await context?.close(); await new Promise(done => server.close(done)); await new Promise(done => cookieServer.close(done)); rmSync(run, { recursive: true, force: true });
}
