// ADR-043: actual completed Chrome requests, UI and saved multi-visit Pro report.
// All vendor resources are intercepted locally; no vendor JavaScript is executed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '../..'), output = join(root, 'dist/chrome');
const artifact = join(root, 'test-results/production-1.1.0/forter'); mkdirSync(artifact, { recursive: true });
const run = mkdtempSync(join(root, '.tmp/forter-native-'));
const evidence = { checks: [], errors: [], blockedUnknownRequests: [], hashes: Object.fromEntries(['background.js', 'popup.js', 'report.js'].map(file => [file, createHash('sha256').update(readFileSync(join(output, file))).digest('hex')])) };
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  response.end('<!doctype html><title>Owned Forter fixture</title><h1>Owned fixture</h1>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://site.forter-fixture.example.com:' + server.address().port;
const frameOrigin = origin.replace('site.forter-fixture.example.com', 'frame.forter-fixture.example.net');
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
let context;
try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1100, height: 850 }, args: ['--disable-extensions-except=' + output, '--load-extension=' + output, '--no-proxy-server', '--host-resolver-rules=MAP site.forter-fixture.example.com 127.0.0.1,MAP frame.forter-fixture.example.net 127.0.0.1'] });
  evidence.browser = context.browser().version();
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if ([origin, frameOrigin].includes(url.origin)) return route.continue();
    if (url.protocol !== 'https:') return route.continue();
    if (url.pathname === '/abort') return route.abort();
    const status = url.pathname === '/failure' ? 403 : 200;
    return route.fulfill({ status, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
      contentType: request.resourceType() === 'image' ? 'image/gif' : request.resourceType() === 'script' ? 'application/javascript' : 'text/plain',
      body: request.resourceType() === 'image' ? gif : request.resourceType() === 'script' ? 'window.ownedForterFixtureLoaded=true;' : 'fixture' });
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
  const ui = await context.newPage(); ui.on('pageerror', error => evidence.errors.push(error.message));
  await ui.goto('chrome-extension://' + id + '/popup.html');
  const send = message => ui.evaluate(message => chrome.runtime.sendMessage(message), message);
  await ui.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'ru' }));
  await ui.waitForTimeout(800);
  const site = await context.newPage(); await site.goto(origin); await site.waitForTimeout(1000);
  const tab = await ui.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)), origin + '/'); assert.ok(tab?.id);
  const getReport = () => send({ schemaVersion: 1, type: 'ui-get-report', tabId: tab.id });
  const load = (page, url, type = 'script') => page.evaluate(({ url, type }) => {
    if (type === 'xhr') return fetch(url).then(() => true, () => false);
    if (type === 'ping') return navigator.sendBeacon(url, 'owned-fixture');
    return new Promise(done => { const element = document.createElement(type === 'image' ? 'img' : 'script'); element.onload = element.onerror = () => done(true); element.src = url; document.body.append(element); });
  }, { url, type });
  // A string/DOM entry and corporate/shared-CDN resources cannot become vendor proof.
  await site.evaluate(() => { const text = document.createElement('pre'); text.textContent = 'https://cdn4.forter.com/script.js'; document.body.append(text); const script = document.createElement('script'); script.src = 'https://cdn4.forter.com/never-appended.js'; });
  for (const url of ['https://www.forter.com/script.js', 'https://unrelated.cloudfront.net/script.js', 'https://cdn4.forter.com.attacker.example/script.js', 'https://cdn4.forter.com/failure', 'https://cdn4.forter.com/abort']) await load(site, url);
  await site.waitForTimeout(500); assert.deepEqual((await getReport()).report.vendors, []);
  evidence.checks.push('corporate/shared CDN, lookalike, DOM-only, failed and aborted requests: no Forter');
  // Light mode must detect this single image without any CDN loader or Pro recording.
  await load(site, 'https://d3nocrch4qti4v.cloudfront.net/logo_small.gif?session=FORTER_PRIVATE_CANARY', 'image');
  await ui.waitForFunction(async tabId => (await chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-get-report', tabId })).report?.vendors.some(row => row.vendorId === 'forter'), tab.id);
  const light = await getReport(); assert.ok(light.report.vendors.find(row => row.vendorId === 'forter').ruleIds.includes('forter-cloudfront-connect-v1'));
  assert.equal(JSON.stringify(light.report).includes('FORTER_PRIVATE_CANARY'), false);
  await ui.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), tab.id); await ui.reload();
  await ui.locator('.recognized-vendors [data-company-logo="forter"]').waitFor();
  await ui.locator('.recognized-vendors [data-company-logo="forter"]').evaluate(image => image.decode());
  assert.equal((await ui.locator('.recognized-vendors').first().textContent()).includes('Forter 3DS'), false);
  await ui.screenshot({ path: join(artifact, 'chrome-light.png'), fullPage: true });
  evidence.checks.push('Light: exact screenshot CloudFront image recognizes Forter with decoded logo');
  const started = await send({ schemaVersion: 1, type: 'ui-pro-start', tabId: tab.id }); assert.equal(started.type, 'pro-state');
  await site.goto(origin + '/second'); await site.waitForTimeout(800);
  await load(site, 'https://123456abcdef.cdn4.forter.com/sn/123456abcdef/script.js');
  await load(site, 'https://cdn9.forter.com/collect?token=FORTER_PRIVATE_CANARY', 'xhr');
  await load(site, 'https://d3nocrch4qti4v.cloudfront.net/beacon', 'ping');
  await site.evaluate(url => new Promise(done => { const frame = document.createElement('iframe'); frame.src = url; frame.onload = done; document.body.append(frame); }), frameOrigin + '/child');
  const frame = site.frames().find(frame => frame.url().startsWith(frameOrigin)); assert.ok(frame); await frame.waitForTimeout(600);
  await load(frame, 'https://dlthst9q2beh8.cloudfront.net/script.js');
  await site.waitForTimeout(1000);
  const current = await getReport(); assert.ok(current.report.vendors.some(row => row.ruleIds.includes('forter-cdn-resource-v1')));
  const before = await send({ schemaVersion: 1, type: 'ui-pro-get', tabId: tab.id });
  writeFileSync(join(artifact, 'chrome-session.json'), JSON.stringify(before.session, null, 2));
  assert.ok(before.session.pages.some(page => page.reports.some(document => document.vendors.some(row => row.ruleIds.includes('forter-cloudfront-script-v1')))), 'child script recognized in Pro page');
  await site.goto(origin + '/third'); await site.waitForTimeout(600);
  await load(site, 'https://d3nocrch4qti4v.cloudfront.net/logo_small.gif', 'image'); await site.waitForTimeout(600);
  const stopped = await send({ schemaVersion: 1, type: 'ui-pro-stop', sessionId: started.session.id }); assert.equal(stopped.session.status, 'stopped');
  const vendorRows = stopped.session.pages.flatMap(page => page.reports.flatMap(document => document.vendors));
  for (const rule of ['forter-cdn-resource-v1', 'forter-cloudfront-connect-v1', 'forter-cloudfront-script-v1']) assert.ok(vendorRows.some(row => row.ruleIds.includes(rule)), rule);
  evidence.checks.push('Pro: script, XHR, beacon, child frame and multiple visits retain Forter rule IDs');
  const report = await context.newPage(); report.on('pageerror', error => evidence.errors.push(error.message));
  await report.goto('chrome-extension://' + id + '/report.html?id=' + encodeURIComponent(started.session.id));
  await report.locator('.pro-report [data-company-logo="forter"]').first().waitFor();
  await report.locator('.pro-report [data-company-logo="forter"]').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  const text = await report.locator('.pro-report').textContent(); assert.ok(text.includes('Forter')); assert.equal(text.includes('Forter 3DS'), false);
  await report.screenshot({ path: join(artifact, 'chrome-report.png'), fullPage: true });
  await report.pdf({ path: join(artifact, 'chrome-report.pdf'), format: 'A4', printBackground: true });
  evidence.checks.push('saved Pro report and PDF: Forter name and decoded packaged logos');
  assert.deepEqual(evidence.errors, []);
  evidence.visits = stopped.session.pages.length; evidence.ruleIds = [...new Set(vendorRows.flatMap(row => row.ruleIds))];
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  writeFileSync(join(artifact, 'chrome.json'), JSON.stringify(evidence, null, 2));
  await context?.close(); await new Promise(done => server.close(done));
}
