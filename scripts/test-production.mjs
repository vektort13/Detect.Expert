// Native delivered-extension verification. Profiles, fixtures and evidence stay in this project.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { chromium } from 'playwright';
import { buildProduction } from './build-production.mjs';
import { PRODUCTION_LANGUAGES } from './production-languages.mjs';
const root = resolve(import.meta.dirname, '..');
const temporary = join(root, '.tmp');
const artifact = join(root, 'test-results', 'production-1.1.0');
mkdirSync(temporary, { recursive: true }); mkdirSync(artifact, { recursive: true });
const { output } = buildProduction('chrome');
const server = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Cache-Control', 'no-store');
  if (request.url?.startsWith('/api/fail')) {
    request.socket.destroy();
    return;
  }
  if (request.url?.startsWith('/api/redirect')) {
    response.writeHead(302, { Location: '/api/final' });
    response.end();
    return;
  }
  if (request.url?.startsWith('/api/')) {
    response.writeHead(request.url.startsWith('/api/not-found') ? 404 : 200, { 'Content-Type': 'application/json' });
    response.end('{}');
    return;
  }
  if (request.url?.startsWith('/images/')) {
    response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<!doctype html><html><head><title>Pro fixture</title></head><body><main>ready</main></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
// Reserved example.com/net names resolve only to this loopback fixture. No external service is contacted.
const sharedOrigin = origin.replace('127.0.0.1', 'shared-graph.example.com');
const otherOrigin = origin.replace('127.0.0.1', 'other-graph.example.net');
const profile = mkdtempSync(join(temporary, 'production-profile-'));
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1000, height: 700 }, args: ['--disable-extensions-except=' + output, '--load-extension=' + output, '--no-proxy-server', '--host-resolver-rules=MAP shared-graph.example.com 127.0.0.1,MAP other-graph.example.net 127.0.0.1'] });
const evidence = { browser: context.browser().version(), checks: [], errors: [], outbound: [] };
context.on('request', request => { const url = new URL(request.url()); if ((url.protocol === 'http:' || url.protocol === 'https:') && ![origin, sharedOrigin, otherOrigin].includes(url.origin)) evidence.outbound.push(url.origin); });
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const ui = await context.newPage(); ui.on('pageerror', error => evidence.errors.push(error.message));
  await ui.goto('chrome-extension://' + extensionId + '/popup.html');
  const send = message => ui.evaluate(message => chrome.runtime.sendMessage(message), message);
  assert.equal((await send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true })).accepted, true);
  const scope = await send({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' });
  assert.ok(scope.type === 'scope' || scope.type === 'ok', JSON.stringify(scope));
  await new Promise(resolve => setTimeout(resolve, 500));
  const page = await context.newPage(); page.on('pageerror', error => evidence.errors.push(error.message));
  await page.goto(origin);
  const tab = await ui.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)), origin + '/');
  assert.ok(tab?.id !== undefined);
  const start = await send({ schemaVersion: 1, type: 'ui-pro-start', tabId: tab.id });
  assert.equal(start.type, 'pro-state', JSON.stringify(start)); assert.equal(start.session.status, 'recording');
  await page.evaluate(async ({ sharedOrigin, otherOrigin, origin }) => {
    for (const url of [origin + '/api/data', sharedOrigin + '/api/data?secret=GRAPH_QUERY_CANARY', sharedOrigin + '/api/data?secret=GRAPH_QUERY_CANARY', sharedOrigin + '/api/redirect', sharedOrigin + '/api/not-found', otherOrigin + '/api/data', otherOrigin + '/api/fail']) {
      try { await fetch(url); } catch {}
    }
    await new Promise(resolve => { const image = new Image(); image.onload = image.onerror = resolve; image.src = otherOrigin + '/images/pixel.svg?secret=GRAPH_QUERY_CANARY'; });
  }, { sharedOrigin, otherOrigin, origin });
  const expected = [];
  for (const width of [1000, 800, 1000]) {
    await page.setViewportSize({ width, height: 700 });
    expected.push(await page.evaluate(() => {
      const width = window.innerWidth;
      const memory = new WebAssembly.Memory({ initial: 1 });
      const before = memory.grow(1);
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      const maximum = gl?.getParameter(gl.MAX_TEXTURE_SIZE);
      canvas.getContext('2d');
      const second = document.createElement('canvas').getContext('2d');
      second.getImageData(0, 0, 1, 1);
      second.measureText('PRO_FORM_TEXT_CANARY');
      const fontChecked = document.fonts.check('12px sans-serif');
      const layoutWidth = document.body.offsetWidth;
      document.body.getBoundingClientRect();
      RTCRtpSender.getCapabilities('audio'); RTCRtpSender.getCapabilities('video');
      sessionStorage.setItem('credential-canary-key', 'PRO_PASSWORD_CANARY');
      const forbidden = sessionStorage.getItem('credential-canary-key');
      return { width, before, maximum, forbidden, fontChecked, layoutWidth };
    }));
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  async function revisionCommand(type) {
    const current = await send({ schemaVersion: 1, type: 'ui-get-report', tabId: tab.id });
    assert.equal(current.type, 'report'); assert.ok(current.report);
    const response = await send({ schemaVersion: 1, type, tabId: tab.id, documentKey: current.report.documentKey, reportRevision: current.report.reportRevision });
    assert.equal(response.type, 'ok', JSON.stringify(response));
  }
  const beforeClear = await send({ schemaVersion: 1, type: 'ui-pro-get', tabId: tab.id });
  const geometryReport = await send({ schemaVersion: 1, type: 'ui-get-report', tabId: tab.id });
  assert.equal(geometryReport.type, 'report');
  assert.equal(geometryReport.report.coverageFlags.includes('hook-failed'), false, 'font and geometry observations do not create a sensor failure');
  const firstPageId = beforeClear.session.pages.at(-1).id;
  await revisionCommand('ui-clear');
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.innerWidth);
  await page.waitForTimeout(1100);
  await revisionCommand('ui-pause');
  await page.setViewportSize({ width: 999, height: 700 });
  await page.evaluate(() => window.innerWidth);
  await page.waitForTimeout(1100);
  await revisionCommand('ui-resume');
  await page.waitForTimeout(2000);
  await page.setViewportSize({ width: 900, height: 700 });
  await page.evaluate(() => window.innerWidth);
  await page.waitForTimeout(1100);
  // SPA visits own separate history despite sharing a browser document.
  await page.evaluate(() => history.pushState({}, '', '/next'));
  await page.waitForTimeout(2000);
  await page.evaluate(async (sharedOrigin) => { await fetch(sharedOrigin + '/api/data?secret=GRAPH_QUERY_CANARY'); }, sharedOrigin);
  await page.setViewportSize({ width: 600, height: 700 });
  await page.evaluate(() => window.innerWidth);
  await page.waitForTimeout(1100);
  const stopped = await send({ schemaVersion: 1, type: 'ui-pro-stop', sessionId: start.session.id });
  assert.equal(stopped.type, 'pro-state', JSON.stringify(stopped)); assert.equal(stopped.session.status, 'stopped');
  evidence.session = stopped.session;
  const samples = stopped.session.pages.flatMap(page => page.apiValues ?? []).flatMap(document => document.rows);
  evidence.samples = samples;
  const widths = samples.filter(row => row.operation === 'Window.innerWidth' && row.value.kind === 'number');
  assert.ok(widths.some(row => row.value.value === 1000), 'first distinct width is retained');
  assert.ok(widths.some(row => row.value.value === 800), 'second distinct width is retained');
  assert.ok(widths.find(row => row.value.value === 1000).count >= 2, 'repeated values have separate sample counts');
  const font = samples.find(row => row.operation === 'FontFaceSet.check');
  assert.equal(font?.value.kind, 'boolean', 'font availability result is retained');
  assert.equal(font.value.value, expected[0].fontChecked);
  const layout = samples.filter(row => row.operation === 'HTMLElement.offsetWidth' && row.value.kind === 'number');
  assert.ok(layout.some(row => row.value.value === expected[0].layoutWidth), 'geometry getter result is retained');
  const grow = samples.find(row => row.operation === 'WebAssembly.Memory.grow');
  assert.ok(grow, 'Memory.grow result is retained');
  assert.deepEqual(grow.parameters, [{ name: 'arg0', kind: 'number', value: 1 }], 'technical arguments are retained');
  const canvas = samples.find(row => row.operation === 'CanvasRenderingContext2D.getImageData');
  assert.ok(canvas); assert.deepEqual(canvas.parameters.map(parameter => parameter.value), [0, 0, 1, 1]);
  const capabilities = samples.filter(row => row.operation === 'RTCRtpSender.getCapabilities');
  assert.ok(capabilities.some(row => row.parameters[0]?.value === 'audio') && capabilities.some(row => row.parameters[0]?.value === 'video'), 'RTP capability requests retain both media kinds');
  assert.equal(JSON.stringify(stopped.session).includes('PRO_PASSWORD_CANARY'), false, 'credentials are excluded');
  assert.equal(JSON.stringify(stopped.session).includes('PRO_FORM_TEXT_CANARY'), false, 'measured text is excluded');
  assert.equal(JSON.stringify(stopped.session).includes('GRAPH_QUERY_CANARY'), false, 'graph source excludes request query values');
  const sharedResources = stopped.session.pages.flatMap(page => page.resources).filter(resource => resource.domain === 'example.com');
  const failedResources = stopped.session.pages.flatMap(page => page.resources).filter(resource => resource.domain === 'example.net');
  assert.ok(stopped.session.pages.filter(page => page.resources.some(resource => resource.domain === 'example.com')).length >= 2, 'shared destination is observed across page visits');
  assert.ok(sharedResources.some(resource => resource.statusCodes.includes(404) && resource.completedCount > 0 && resource.failedCount === 0), 'HTTP error status is preserved as a completion');
  assert.ok(sharedResources.some(resource => resource.redirectCount > 0), 'redirect counts recorded');
  assert.ok(failedResources.some(resource => resource.failedCount > 0), 'transport failures recorded');
  const firstRows = stopped.session.pages.find(page => page.id === firstPageId).apiValues.flatMap(document => document.rows);
  assert.ok(firstRows.some(row => row.operation === 'Window.innerWidth' && row.value.value === 800), 'Light clear preserves existing Pro variants');
  assert.ok(firstRows.some(row => row.operation === 'Window.innerWidth' && row.value.value === 900), 'resume retains new Pro values');
  assert.equal(firstRows.some(row => row.operation === 'Window.innerWidth' && row.value.value === 999), false, 'paused reads excluded');
  const nextRows = stopped.session.pages.at(-1).apiValues.flatMap(document => document.rows);
  assert.notEqual(stopped.session.pages.at(-1).id, firstPageId);
  assert.ok(nextRows.some(row => row.operation === 'Window.innerWidth' && row.value.value === 600));
  assert.equal(nextRows.some(row => row.operation === 'Window.innerWidth' && row.value.value === 800), false, 'SPA history excludes prior-visit samples');
  await page.setViewportSize({ width: 500, height: 700 }); await page.evaluate(() => window.innerWidth); await page.waitForTimeout(1100);
  const afterStop = await send({ schemaVersion: 1, type: 'ui-pro-get', tabId: tab.id });
  assert.deepEqual(afterStop.session, stopped.session, 'stopped recording stays unchanged');
  evidence.checks.push('multiple values', 'per-value counts', 'technical arguments and Canvas dimensions', 'sensitive canaries absent', 'Light clear preserves Pro', 'pause excludes reads', 'resume records again', 'SPA visit history isolated', 'recording stopped');
  await ui.reload();
  const fromStorage = await send({ schemaVersion: 1, type: 'ui-pro-get', tabId: tab.id });
  assert.equal(fromStorage.type, 'pro-state'); assert.ok(fromStorage.session.pages.some(page => page.apiValues?.length));
  evidence.checks.push('UI validator accepts recorded values');
  const report = await context.newPage(); report.on('pageerror', error => evidence.errors.push(error.message));
  await report.goto('chrome-extension://' + extensionId + '/report.html?id=' + stopped.session.id);
  await report.locator('.pro-api-values').first().waitFor();
  const rendered = await report.locator('.pro-api-values').allTextContents();
  assert.ok(rendered.some(text => text.includes('Window.innerWidth') && text.includes('1000') && text.includes('800')));
  assert.ok(rendered.some(text => text.includes('WebAssembly.Memory.grow') && text.includes('arg0 = 1')));
  const graph = report.locator('.pro-request-graph');
  await graph.waitFor();
  assert.equal(await graph.locator('[data-pro-graph-domain]').count(), 2);
  const sharedButton = graph.locator('button[data-pro-graph-domain="example.com"]');
  await sharedButton.focus(); await report.keyboard.press('Enter');
  await graph.locator('button[data-pro-graph-domain="example.com"][aria-pressed="true"]').waitFor();
  assert.equal(await report.evaluate(() => document.activeElement?.getAttribute('data-pro-graph-domain')), 'example.com', 'keyboard selection preserves focus');
  const details = graph.locator('.pro-request-graph__details');
  assert.ok((await details.textContent()).includes('404'));
  assert.ok((await details.textContent()).includes('302'));
  for (const page of stopped.session.pages.filter(page => page.resources.some(resource => resource.domain === 'example.com'))) {
    assert.ok(await details.locator('a[href="#page-' + encodeURIComponent(page.id) + '"]').count() > 0, 'selected domain links each matching page visit');
  }
  await graph.locator('select[data-pro-graph-filter="type"]').selectOption('image');
  assert.deepEqual(await graph.locator('[data-pro-graph-domain]').evaluateAll(nodes => nodes.map(node => node.dataset.proGraphDomain)), ['example.net']);
  assert.equal(await graph.locator('[data-pro-graph-domain][aria-pressed="true"]').count(), 0, 'type change clears hidden selection');
  await graph.locator('select[data-pro-graph-filter="type"]').selectOption('all');
  await graph.locator('select[data-pro-graph-filter="party"]').selectOption('all');
  assert.ok(await graph.locator('button[data-pro-graph-domain="127.0.0.1"]').count() > 0, 'all-domains filter includes first-party requests');
  await graph.locator('button[data-pro-graph-domain="example.com"]').click();
  await graph.locator('button[data-pro-graph-clear]').click();
  assert.equal(await graph.locator('[data-pro-graph-domain][aria-pressed="true"]').count(), 0);
  // Changes to the language picker update the graph and its numeric substitutions.
  for (const language of PRODUCTION_LANGUAGES) {
    const catalog = JSON.parse(readFileSync(join(root, 'apps/production-extension', language.uiOnly ? 'ui-locales' : '_locales', language.id, 'messages.json'), 'utf8'));
    await report.evaluate(locale => chrome.storage.local.set({ 'ui-language-v1': locale }), language.id);
    await report.waitForFunction(tag => document.documentElement.lang === tag, language.tag);
    await report.waitForFunction(title => document.querySelector('.pro-request-graph h2')?.textContent === title, catalog.pro_graph_title.message);
    await graph.locator('svg').waitFor();
    assert.equal(await graph.evaluate(node => /\$(NUMBER|PAGES|DOMAINS|EDGES)\$/.test(node.textContent)), false, 'graph substitutions render in ' + language.id);
    assert.equal(await graph.locator('h2').textContent(), catalog.pro_graph_title.message);
  }
  await report.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'ru' }));
  await report.waitForFunction(() => document.documentElement.lang === 'ru');
  await graph.locator('button[data-pro-graph-domain="example.com"]').click();
  await graph.screenshot({ path: join(artifact, 'pro-request-graph-ru.png') });
  await report.setViewportSize({ width: 560, height: 800 });
  assert.ok((await graph.boundingBox()).width <= 560, 'narrow graph fits the viewport');
  await graph.screenshot({ path: join(artifact, 'pro-request-graph-narrow.png') });
  await report.setViewportSize({ width: 1000, height: 700 });
  assert.equal((await graph.textContent()).includes('GRAPH_QUERY_CANARY'), false);
  evidence.checks.push('interactive graph captures shared destinations across visits', 'domain details preserve 404 completion and redirect statuses', 'domain keyboard selection', 'resource type filter and selection reset', 'all-domains filter includes first party', '21 graph languages and substitutions', 'narrow graph fits report viewport', 'graph query canary absent');
  await report.emulateMedia({ media: 'print' });
  assert.equal(await graph.isVisible(), false, 'interactive graph is excluded from print projection');
  assert.ok(await report.locator('.pro-api-values').first().isVisible());
  await report.pdf({ path: join(artifact, 'pro-values.pdf'), format: 'A4', printBackground: true });
  evidence.checks.push('standalone report renders all variants', 'print and PDF retain samples');
  const cleared = await send({ schemaVersion: 1, type: 'ui-pro-clear', sessionId: stopped.session.id });
  assert.equal(cleared.type, 'pro-state'); assert.equal(cleared.session, null);
  await report.waitForFunction(() => !document.querySelector('.pro-request-graph') && !document.querySelector('.pro-report'));
  evidence.checks.push('clearing recording removes graph and cached preview');
  assert.deepEqual(evidence.outbound, [], 'no HTTP traffic outside local fixture observed');
  evidence.checks.push('no extension outbound traffic observed');
  assert.deepEqual(evidence.errors, [], 'native page and extension runtime has no uncaught errors');
  console.log('PASS: Chrome delivered extension, Pro distinct values/counts/arguments/privacy/validation');
} finally {
  writeFileSync(join(artifact, 'chrome.json'), JSON.stringify(evidence, null, 2) + '\n');
  await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  assert.ok(profile.startsWith(temporary + sep));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
