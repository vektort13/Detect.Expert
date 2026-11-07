// ADR-029: native geometry and interaction checks against the shipped Third Party component.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { companyFixtureFiles, companyFixtureContentType } from './production/company-test-files.mjs';
import { PRODUCTION_LANGUAGES } from './production-languages.mjs';
import { applyThirdPartyCopy } from './production-locales-third-party.mjs';
import { readThirdPartySnapshot } from '../packages/contracts/src/third-party.mjs';

const root = resolve(import.meta.dirname, '..'), temporary = join(root, '.tmp');
const artifact = join(root, 'test-results/production-1.1.0/inspection');
mkdirSync(temporary, { recursive: true }); mkdirSync(artifact, { recursive: true });
const run = mkdtempSync(join(temporary, 'third-party-layout-native-'));
const files = new Map([
  ...companyFixtureFiles(root),
  ...['identification-ui.js', 'inspection-contracts.js', 'third-party-contracts.js', 'cookie-branding.js', 'cookie-purpose-localization.js',
    'ui.css', 'identification-ui.css', 'popup.css', 'sidepanel.css', 'pro.css', 'report.css', 'pro-request-graph.css']
    .map(name => ['/production/' + name, join(root, 'apps/production-extension', name)]),
  ['/preact.module.js', join(root, 'node_modules/preact/dist/preact.module.js')],
  ['/preact.hooks.js', join(root, 'node_modules/preact/hooks/dist/hooks.module.js')]
]);
const longHost = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(56), 'test'].join('.');
assert.equal(longHost.length, 253);
const row = changes => ({ domain: 'third.test', pathTemplate: '/scripts/:resource.js', type: 'script', relation: 'cross-site', requestCount: 1,
  completedCount: 1, failedCount: 0, redirectCount: 0, statusCodes: [200], documentKey: '42:0:layout', documentHost: 'example.test', initiatorHost: 'example.test',
  evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'frame-only', script: null, ...changes });
const rows = [row({ domain: longHost, requestCount: 2147483647, failedCount: 8, redirectCount: 4, statusCodes: Array.from({ length: 16 }, (_, index) => 200 + index) }),
  row({ domain: 'cdn.test', type: 'font', pathTemplate: '/fonts/:resource.woff2', requestCount: 7 }),
  row({ domain: 'widget.test', documentKey: '42:1:widget', documentHost: 'widget.test', initiatorHost: 'widget.test', type: 'xmlhttprequest', pathTemplate: '/api/:segment', requestCount: 3,
    evidenceSource: 'page-dom', integrity: 'page-controlled', completedCount: 0, statusCodes: [] })];
const snapshot = { schemaVersion: 1, type: 'third-party-state', documentKey: '42:0:layout', coverageState: 'partial', rows, truncated: false };
assert.ok(readThirdPartySnapshot(snapshot));
const resource = (item, index) => ({ id: 'resource-' + index, url: 'https:' + '//' + item.domain + item.pathTemplate, domain: item.domain, relation: item.relation, type: item.type,
  requestCount: item.requestCount, completedCount: item.completedCount, failedCount: item.failedCount, redirectCount: item.redirectCount,
  firstSeenAt: 1, lastSeenAt: 2, statusCodes: item.statusCodes, durationTotalMs: 1 });
const page = { id: 'page-layout', documentKey: '42:0:layout', url: 'https:' + '//example.test/', resources: rows.map(resource) };
const maximum = { ...page, resources: Array.from({ length: 500 }, (_, index) => resource(row({ ...rows[index % rows.length], domain: index === 0 ? longHost : 'third-' + index + '.test' }), index)) };
const interactive = { ...snapshot, rows: Array.from({ length: 125 }, (_, index) => row({ domain: 'third-' + index + '.test', requestCount: index + 1 })) };
assert.ok(readThirdPartySnapshot(interactive));

const fixtureScript = `
import { h, render } from '/preact.module.js';
import { useState, useEffect, useRef } from '/preact.hooks.js';
import { createIdentificationUi } from '/production/identification-ui.js';
const surface = document.getElementById('surface'), mount = document.getElementById('root');
const link = document.getElementById('surface-style');
let count = 0;
window.renderThirdPartyFixture = async ({ locale, tag, table, width, mode, snapshot, page }) => {
  document.documentElement.lang = tag; document.documentElement.dir = ['ar', 'ur'].includes(locale) ? 'rtl' : 'ltr';
  const css = mode === 'report' ? 'report.css' : mode === 'popup' ? 'popup.css' : 'sidepanel.css';
  if (!link.href.endsWith('/' + css)) await new Promise((done, fail) => { link.onload = done; link.onerror = fail; link.href = '/production/' + css; });
  document.getElementById('pro-style').disabled = mode === 'report'; document.getElementById('graph-style').disabled = mode !== 'report';
  surface.className = mode === 'report' ? 'pro-report-app' : 'app inspector app--' + (mode === 'popup' ? 'popup' : 'panel');
  surface.style.width = mode === 'report' ? '' : width + 'px'; mount.className = mode === 'report' ? 'pro-report' : '';
  mount.style.width = mode === 'report' ? width + 'px' : '';
  const translate = (key, substitutions = []) => {
    const entry = table[key]; if (!entry) throw new Error('Missing localized key: ' + key); let output = entry.message;
    for (const [name, placeholder] of Object.entries(entry.placeholders ?? {})) output = output.replaceAll('$' + name.toUpperCase() + '$', substitutions[Number(placeholder.content.slice(1)) - 1] ?? '');
    return output;
  };
  const ui = createIdentificationUi({ h, useState, useEffect, useRef, useLocale: () => locale, translate });
  render(mode === 'report' ? h(ui.ProThirdPartySnapshot, { key: ++count, page }) : h(ui.ThirdPartyPanel, {
    key: ++count, thirdParty: { state: snapshot, pending: false, refresh() { window.thirdPartyRefreshes = (window.thirdPartyRefreshes ?? 0) + 1; } }
  }), mount);
  await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
};
window.thirdPartyLayoutReady = true;
`;
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Local production Third Party layout fixture</title><link rel="stylesheet" href="/production/ui.css"><link rel="stylesheet" href="/production/identification-ui.css">' +
  '<link id="pro-style" rel="stylesheet" href="/production/pro.css"><link id="surface-style" rel="stylesheet" href="/production/sidepanel.css">' +
  '<link id="graph-style" rel="stylesheet" href="/production/pro-request-graph.css" disabled></head><body><main id="surface"><div id="root"></div></main>' +
  '<script type="module" src="/fixture.js"></script></body></html>';
const evidence = { checks: [], cases: [], errors: [], unexpectedRequests: [], fixture: 'Owned loopback fixtures, shipped production Preact/CSS, canonical redacted metadata' };
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store'); const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  if (pathname === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html.replace('</head>', '<link rel="stylesheet" href="/production/company-ui.css"></head>')); return; }
  if (pathname === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(fixtureScript); return; }
  const file = files.get(pathname); if (!file) { evidence.unexpectedRequests.push(pathname); response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', companyFixtureContentType(file));
  const content = readFileSync(file); response.end(pathname === '/preact.hooks.js' ? content.toString('utf8').replaceAll('from"preact"', 'from"/preact.module.js"') : content);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
let context;
try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1120, height: 900 }, args: ['--no-proxy-server'] });
  evidence.browser = context.browser().version();
  await context.route('**/*', async route => { if (new URL(route.request().url()).origin === origin) await route.continue(); else { evidence.unexpectedRequests.push(route.request().url()); await route.abort(); } });
  const browserPage = await context.newPage(); browserPage.on('pageerror', error => evidence.errors.push(error.message));
  await browserPage.goto(origin); await browserPage.waitForFunction(() => window.thirdPartyLayoutReady);
  const catalogues = new Map(PRODUCTION_LANGUAGES.map(language => [language.id, applyThirdPartyCopy(JSON.parse(readFileSync(join(root, 'apps/production-extension', language.uiOnly ? 'ui-locales' : '_locales', language.id, 'messages.json'), 'utf8')), language.id)]));
  const configure = async (language, width, mode, fixturePage = page, fixtureSnapshot = snapshot) => browserPage.evaluate(payload => window.renderThirdPartyFixture(payload), {
    locale: language.id, tag: language.tag, table: catalogues.get(language.id), width, mode, page: fixturePage, snapshot: fixtureSnapshot });
  const inspect = async () => browserPage.evaluate(() => {
    const rect = element => { const value = element.getBoundingClientRect(); return { width: value.width, height: value.height }; };
    const tables = [...document.querySelectorAll('[data-third-party-table]')], rows = [...document.querySelectorAll('[data-third-party-row]')], overflow = [];
    for (const element of document.querySelectorAll('.third-party-panel, .third-party-heading, .third-party-summary, .third-party-filter, .third-party-observations, .third-party-table td, .social-cell-label, .social-cell-value')) {
      if (getComputedStyle(element).display !== 'none' && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1) overflow.push({ class: element.className, width: element.clientWidth, scrollWidth: element.scrollWidth, text: element.textContent.slice(0, 60) });
    }
    return { direction: document.documentElement.dir, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, overflow, rows: rows.length,
      cellCounts: rows.map(row => row.querySelectorAll(':scope > td').length), longDomain: document.querySelector('[data-third-party-row] strong')?.textContent,
      maximumCount: document.querySelector('[data-third-party-requests]')?.textContent.includes('2147483647'), sources: rows.map(row => row.dataset.thirdPartySource),
      tables: tables.map(table => ({ display: getComputedStyle(table).display, containerWidth: rect(table.closest('.social-observations')).width, header: {
        display: getComputedStyle(table.tHead).display, position: getComputedStyle(table.tHead).position, ...rect(table.tHead) },
        headers: [...table.querySelectorAll('th')].map(header => ({ text: header.textContent, wrap: getComputedStyle(header).overflowWrap, scope: header.scope, role: header.getAttribute('role') })),
        labels: [...table.querySelectorAll('.social-cell-label')].map(label => ({ display: getComputedStyle(label).display, wrap: getComputedStyle(label).overflowWrap, hidden: label.getAttribute('aria-hidden') })),
        roles: { table: table.getAttribute('role'), rowgroups: [...table.querySelectorAll('thead, tbody')].map(item => item.getAttribute('role')),
          rows: [...table.querySelectorAll('tr')].map(item => item.getAttribute('role')), cells: [...table.querySelectorAll('td')].map(item => item.getAttribute('role')) }
      })) };
  });
  const verify = (result, description, expectedRows = rows.length, printing = false) => {
    assert.equal(result.rows, expectedRows, description + ': every row'); assert.ok(result.cellCounts.every(count => count === 4), description + ': four fields');
    assert.equal(result.longDomain, longHost, description + ': full redacted long domain retained'); assert.equal(result.maximumCount, true, description + ': saturating count retained');
    assert.deepEqual(result.overflow, [], description + ': element overflow'); assert.ok(result.documentWidth <= result.viewport + 1, description + ': document overflow');
    for (const table of result.tables) {
      const stacked = !printing && table.containerWidth <= 640;
      assert.equal(table.display === 'table', !stacked, description + ': container responsive');
      assert.equal(table.roles.table, 'table'); assert.deepEqual(table.roles.rowgroups, ['rowgroup', 'rowgroup']);
      assert.ok(table.roles.rows.every(role => role === 'row')); assert.ok(table.roles.cells.every(role => role === 'cell'));
      assert.ok(table.headers.every(header => header.wrap === 'normal' && header.scope === 'col' && header.role === 'columnheader'));
      assert.ok(table.labels.every(label => label.hidden === 'true' && (label.display === 'none' || label.wrap === 'normal')));
      if (stacked) assert.ok(table.labels.every(label => label.display !== 'none'), description + ': card captions');
      else { assert.equal(table.header.display, 'table-header-group'); assert.equal(table.header.position, 'static'); assert.ok(table.header.width > 1 && table.header.height > 1); assert.ok(table.labels.every(label => label.display === 'none')); }
    }
    evidence.cases.push({ description, direction: result.direction, viewport: result.viewport, rows: result.rows, containers: result.tables.map(table => ({ width: table.containerWidth, layout: table.display })) });
  };
  for (const language of PRODUCTION_LANGUAGES) for (const width of [280, 380, 560, 760]) { await configure(language, width, 'sidepanel'); const result = await inspect(); verify(result, language.id + ': sidepanel ' + width); assert.equal(result.direction, ['ar', 'ur'].includes(language.id) ? 'rtl' : 'ltr'); }
  evidence.checks.push('21 locales at 280/380/560/760 px retain every field, domain, count and source without horizontal overflow');
  const english = PRODUCTION_LANGUAGES.find(language => language.id === 'en');
  await browserPage.setViewportSize({ width: 380, height: 900 }); await configure(english, 380, 'popup'); verify(await inspect(), 'Actual popup 380');
  await browserPage.screenshot({ path: join(artifact, 'third-party-layout-chrome.png'), fullPage: true });
  evidence.checks.push('actual 380 px popup displays complete labeled cards');
  await browserPage.setViewportSize({ width: 1120, height: 900 });
  for (const width of [380, 560, 760, 1056]) { await configure(english, width, 'report'); verify(await inspect(), 'Pro report ' + width); }
  await configure(english, 1056, 'report', maximum); verify(await inspect(), 'All 500 Pro resource groups', 500);
  evidence.checks.push('Pro preserves all 500 admitted resource groups and adapts to its container');
  await browserPage.setViewportSize({ width: 794, height: 1123 }); await configure(english, 680, 'report', maximum); verify(await inspect(), 'A4 preview 500 rows', 500);
  await browserPage.emulateMedia({ media: 'print' }); verify(await inspect(), 'A4 print 500 rows', 500, true);
  await browserPage.pdf({ path: join(artifact, 'third-party-layout-chrome.pdf'), format: 'A4', printBackground: true }); await browserPage.emulateMedia({ media: 'screen' });
  evidence.checks.push('print restores complete tables and repeated headers with all 500 rows');
  await browserPage.setViewportSize({ width: 380, height: 900 }); await configure(english, 380, 'popup', page, interactive);
  assert.equal(await browserPage.locator('[data-third-party-row]').count(), 100);
  await browserPage.getByRole('button', { name: catalogues.get('en').pro_show_more.message, exact: true }).click(); assert.equal(await browserPage.locator('[data-third-party-row]').count(), 125);
  await browserPage.locator('input[type=search]').fill('third-124.test'); assert.equal(await browserPage.locator('[data-third-party-row]').count(), 1);
  assert.equal(await browserPage.locator('[data-third-party-row]').getAttribute('data-third-party-domain'), 'third-124.test');
  await browserPage.locator('input[type=search]').fill('missing.test'); assert.equal(await browserPage.locator('[data-third-party-row]').count(), 0);
  await browserPage.getByRole('button', { name: catalogues.get('en').action_refresh.message, exact: true }).click(); assert.equal(await browserPage.evaluate(() => window.thirdPartyRefreshes), 1);
  evidence.checks.push('real Preact load-more and filter retain every admitted row; refresh dispatches its owned action');
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.unexpectedRequests, []);
  evidence.checks.push('no page exceptions or external requests');
  console.log('PASS: native Third Party layout (' + evidence.cases.length + ' cases, ' + evidence.checks.length + ' checks)');
} finally {
  writeFileSync(join(artifact, 'third-party-layout-chrome.json'), JSON.stringify(evidence, null, 2) + '\n');
  await context?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
  const ownedRun = resolve(run); assert.ok(ownedRun.startsWith(temporary + sep)); rmSync(ownedRun, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
