// ADR-038: real extension, local fixtures, no third-party account or service.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '../..'), output = join(root, 'dist/chrome');
const artifact = join(root, 'test-results/review-surfaces-2026-10-10'); mkdirSync(artifact, { recursive: true });
const server = createServer((request, response) => {
  if (request.url === '/worker.js' || request.url === '/module.mjs') { response.setHeader('Content-Type', 'text/javascript'); response.end('self.onmessage = e => self.postMessage(e.data + 1)'); return; }
  if (request.url === '/shared.js') { response.setHeader('Content-Type', 'text/javascript'); response.end('onconnect = e => { const p = e.ports[0]; p.onmessage = e => p.postMessage(e.data + 1); p.start(); }'); return; }
  if (request.url?.startsWith('/main.js')) { response.setHeader('Content-Type', 'text/javascript'); response.end('document.cookie = "review_cookie=COOKIE_VALUE_PRIVATE; SameSite=Lax; path=/"; window.mathBefore = Math.sin; window.reviewMath = () => [Math.sin(-1e300),Math.cos(10.000000000123),Math.pow(Math.PI,-100)];'); return; }
  response.setHeader('Content-Type', 'text/html'); response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; worker-src 'self' blob:"); response.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.end('<!doctype html><title>Local review fixture</title><script src="/main.js?private=QUERY_CANARY"></script><form action="/success"><input name="user"><button>Log in</button></form>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://review.example.com:' + server.address().port;
const profile = mkdtempSync(join(root, '.tmp/review-native-profile-'));
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: ['--disable-extensions-except=' + output, '--load-extension=' + output, '--no-proxy-server', '--host-resolver-rules=MAP review.example.com 127.0.0.1'] });
const evidence = { browser: context.browser().version(), checks: [], errors: [], packagedHashes: Object.fromEntries(['manifest.json', 'hook.early.js', 'hook.main.js', 'bridge.js', 'background.js', 'identification-ui.js', 'report.js', 'cookie-writer-observer.js', 'cookie-writers-contracts.js'].map(file => [file, createHash('sha256').update(readFileSync(join(output, file))).digest('hex')])) };
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const ui = await context.newPage(); ui.on('pageerror', error => evidence.errors.push(error.message));
  await ui.goto('chrome-extension://' + new URL(worker.url()).host + '/popup.html');
  const send = message => ui.evaluate(message => chrome.runtime.sendMessage(message), message);
  assert.equal((await send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true })).accepted, true);
  await send({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' });
  await ui.waitForTimeout(500);
  const page = await context.newPage(); page.on('pageerror', error => evidence.errors.push(error.message)); await page.goto(origin);
  const tab = await ui.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)), origin + '/');
  const ordinary = await page.evaluate(() => Math.sin === window.mathBefore); assert.equal(ordinary, true);
  const start = await send({ schemaVersion: 1, type: 'ui-pro-start', tabId: tab.id }); assert.equal(start.type, 'pro-state');
  await page.waitForTimeout(1100);
  const values = await page.evaluate(async () => {
    const workers = [];
    for (const [url, options] of [['/worker.js', undefined], ['/module.mjs', { type: 'module' }], [URL.createObjectURL(new Blob(['self.onmessage=e=>postMessage(e.data+1)'], { type: 'text/javascript' })), undefined]]) {
      const worker = new Worker(url, options);
      workers.push(await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Worker timeout')), 3000); worker.onmessage = e => { clearTimeout(timer); resolve(e.data); }; worker.onerror = reject; worker.postMessage(7); }));
      worker.terminate(); if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    const shared = new SharedWorker('/shared.js'); shared.port.start();
    const sharedValue = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('SharedWorker timeout')), 3000); shared.port.onmessage = e => { clearTimeout(timer); resolve(e.data); }; shared.port.postMessage(9); }); shared.port.close();
    window.addEventListener('deviceorientation', () => {}); window.ondevicemotion = () => {};
    document.cookie = 'review_second=COOKIE_VALUE_PRIVATE; SameSite=Lax; path=/';
    const math = window.reviewMath(), active = Math.sin !== window.mathBefore;
    const child = document.createElement('iframe'); document.body.appendChild(child); const width = child.contentWindow.innerWidth;
    const cookie = document.cookie;
    return { workers, sharedValue, math, active, width, cookiesWork: cookie.includes('review_cookie=COOKIE_VALUE_PRIVATE') && cookie.includes('review_second=COOKIE_VALUE_PRIVATE') };
  });
  evidence.native = values;
  evidence.proStart = start;
  assert.deepEqual(values.workers, [8, 8, 8]); assert.equal(values.sharedValue, 10); assert.equal(values.active, true); assert.equal(values.cookiesWork, true);
  await page.waitForTimeout(1400);
  const report = await send({ schemaVersion: 1, type: 'ui-get-report', tabId: tab.id }); assert.equal(report.type, 'report');
  evidence.report = report.report;
  for (const id of ['DET-064', 'DET-042', 'DET-022', 'DET-023', 'DET-049']) assert.ok(report.report.techniques.some(row => row.techniqueId === id && row.count > 0), id);
  for (const row of report.report.techniques.filter(row => ['DET-022', 'DET-023'].includes(row.techniqueId))) {
    assert.equal(row.interpretation, 'api-use'); assert.equal(row.interpretationConfidence, 'unassessed'); assert.ok(row.signalCodes.includes('known-numeric-pattern'));
  }
  const writers = await send({ schemaVersion: 1, type: 'ui-get-cookie-writers', tabId: tab.id, frameId: 0, documentKey: report.report.documentKey });
  assert.equal(writers.type, 'cookie-writers-state'); assert.ok(writers.rows.some(row => row.name === 'review_cookie' && row.script?.pathTemplate === '/main.js')); evidence.writers = writers;
  assert.equal(JSON.stringify(writers).includes('COOKIE_VALUE_PRIVATE'), false); assert.equal(JSON.stringify(writers).includes('QUERY_CANARY'), false);
  await ui.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), tab.id); await ui.reload();
  await ui.locator('[data-identification-tab="active"]').click();
  for (const mechanism of ['worker', 'device-sensor', 'storage']) {
    const group = ui.locator('[data-api-mechanism="' + mechanism + '"]').first(); await group.waitFor();
    const title = await group.locator('summary strong').textContent(); assert.ok(title && !title.startsWith('api_mechanism_'));
  }
  await ui.locator('[data-identification-tab="cookie"]').click(); await ui.locator('[data-cookie-writers-table]').waitFor();
  await ui.setViewportSize({ width: 420, height: 800 });
  assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.equal(await ui.locator('[data-cookie-writers-table] td').first().evaluate(node => getComputedStyle(node).display), 'block');
  await ui.screenshot({ path: join(artifact, 'cookie-writers-popup-chrome.png'), fullPage: true });
  evidence.checks.push('localized live operation groups and narrow Cookie writer table');
  await page.waitForTimeout(1100);
  const stopped = await send({ schemaVersion: 1, type: 'ui-pro-stop', sessionId: start.session.id }); assert.equal(stopped.type, 'pro-state');
  assert.ok(stopped.session.pages.some(page => page.cookieWriters?.some(doc => doc.rows.some(row => row.name === 'review_cookie'))));
  evidence.proWriterDocuments = stopped.session.pages.flatMap(page => page.cookieWriters ?? []);
  const preview = await context.newPage(); preview.on('pageerror', error => evidence.errors.push(error.message));
  await preview.goto('chrome-extension://' + new URL(worker.url()).host + '/report.html?id=' + start.session.id);
  await preview.locator('[data-cookie-writers-table]').first().waitFor();
  assert.ok((await preview.locator('[data-cookie-writers-table]').allTextContents()).join(' ').includes('review_cookie'));
  await preview.screenshot({ path: join(artifact, 'pro-writers-chrome.png'), fullPage: true });
  await preview.pdf({ path: join(artifact, 'pro-writers-chrome.pdf'), printBackground: true, preferCSSPageSize: true });
  evidence.checks.push('standalone Pro cookie-writer table and PDF');
  await page.waitForTimeout(700); assert.equal(await page.evaluate(() => Math.sin === window.mathBefore), true);
  await page.locator('input').fill('local-fixture'); await page.locator('button').click(); await page.waitForURL('**/success?user=local-fixture');
  evidence.checks.push('classic/module/blob/SharedWorker messages unchanged', 'cookie write/read and currentScript metadata', 'motion event registration', 'Math Pro install and physical restore', 'same-origin child window access', 'Pro writer capture', 'native form navigation');
  assert.deepEqual(evidence.errors, []);
  evidence.passed = true;
} finally { await context.close(); await new Promise(resolve => server.close(resolve)); writeFileSync(join(artifact, 'native-chrome.json'), JSON.stringify(evidence, null, 2)); }
console.log(JSON.stringify({ browser: evidence.browser, checks: evidence.checks, errors: evidence.errors }));
