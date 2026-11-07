// ADR-028: native layout checks use the production component/CSS and local synthetic observations.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { companyFixtureFiles, companyFixtureContentType } from './production/company-test-files.mjs';
import { PRODUCTION_LANGUAGES } from './production-languages.mjs';
import { readSocialSnapshot, readSocialDocuments } from '../packages/contracts/src/inspection.mjs';

const root = resolve(import.meta.dirname, '..'), temporary = join(root, '.tmp');
const artifact = join(root, 'test-results/production-1.1.0/inspection');
mkdirSync(temporary, { recursive: true }); mkdirSync(artifact, { recursive: true });
const run = mkdtempSync(join(temporary, 'social-layout-native-'));
const files = new Map([
  ...companyFixtureFiles(root),
  ...['identification-ui.js', 'inspection-contracts.js', 'third-party-contracts.js', 'cookie-branding.js', 'cookie-purpose-localization.js',
    'ui.css', 'identification-ui.css', 'popup.css', 'sidepanel.css', 'pro.css', 'report.css', 'pro-request-graph.css']
    .map(name => ['/production/' + name, join(root, 'apps/production-extension', name)]),
  ['/preact.module.js', join(root, 'node_modules/preact/dist/preact.module.js')]
]);
const longHost = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(56), 'test'].join('.');
assert.equal(longHost.length, 253);
const rows = [
  { service: 'google', kind: 'sdk-load', endpoint: 'sdk', method: 'GET', requestType: 'script', count: 1,
    evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'frame-only', initiatorHost: 'example.test', script: null },
  { service: 'facebook', kind: 'tracking-sdk', endpoint: 'sdk', method: 'GET', requestType: 'script', count: 2147483647,
    evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'frame-only', initiatorHost: longHost, script: null },
  { service: 'reddit', kind: 'tracking-pixel', endpoint: 'pixel', method: 'POST', requestType: 'ping', count: 2147483647,
    evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'exact-resource', initiatorHost: 'example.test', script: { host: longHost, pathTemplate: '/analytics.mjs' } },
  { service: 'unknown', kind: 'service-request', endpoint: 'service', method: 'UNKNOWN', requestType: 'other', count: 3,
    evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'unknown', initiatorHost: null, script: null }
];
const snapshot = { schemaVersion: 1, type: 'social-networks-state', documentKey: '42:0:layout', coverageState: 'partial', rows, truncated: false };
assert.ok(readSocialSnapshot(snapshot));
const documents = Array.from({ length: 24 }, (_, index) => ({ ...snapshot, documentKey: '42:' + index + ':layout-' + index,
  rows: Array.from({ length: index === 23 ? 26 : 10 }, (_, rowIndex) => rows[rowIndex % rows.length]) }));
assert.ok(readSocialDocuments(documents));
const fixtureScript = `
import { h, render } from '/preact.module.js';
import { createIdentificationUi } from '/production/identification-ui.js';
const surface = document.getElementById('surface'), mount = document.getElementById('root');
const link = document.getElementById('surface-style');
window.renderSocialFixture = async ({ locale, tag, table, width, mode, snapshots }) => {
  document.documentElement.lang = tag; document.documentElement.dir = ['ar', 'ur'].includes(locale) ? 'rtl' : 'ltr';
  const css = mode === 'report' ? 'report.css' : mode === 'popup' ? 'popup.css' : 'sidepanel.css';
  if (!link.href.endsWith('/' + css)) {
    await new Promise((done, fail) => { link.onload = done; link.onerror = fail; link.href = '/production/' + css; });
  }
  document.getElementById('pro-style').disabled = mode === 'report';
  document.getElementById('graph-style').disabled = mode !== 'report';
  surface.className = mode === 'report' ? 'pro-report-app' : 'app inspector app--' + (mode === 'popup' ? 'popup' : 'panel');
  surface.style.width = mode === 'report' ? '' : width + 'px';
  mount.className = mode === 'report' ? 'pro-report' : '';
  mount.style.width = mode === 'report' ? width + 'px' : '';
  const translate = (key, substitutions = []) => {
    const entry = table[key]; if (!entry) throw new Error('Missing localized key: ' + key);
    let result = entry.message;
    for (const [name, placeholder] of Object.entries(entry.placeholders ?? {})) {
      result = result.replaceAll('$' + name.toUpperCase() + '$', substitutions[Number(placeholder.content.slice(1)) - 1] ?? '');
    }
    return result;
  };
  const ui = createIdentificationUi({ h, useState() {}, useEffect() {}, useRef() {}, useLocale: () => locale, translate });
  render(mode === 'report' ? h(ui.ProSocialSnapshot, { snapshots }) : h(ui.SocialPanel, {
    social: { state: snapshots[0], pending: false, refresh() {} }
  }), mount);
  await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
};
window.socialLayoutReady = true;
`;
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Local production Social layout fixture</title><link rel="stylesheet" href="/production/ui.css">' +
  '<link rel="stylesheet" href="/production/identification-ui.css"><link id="pro-style" rel="stylesheet" href="/production/pro.css">' +
  '<link id="surface-style" rel="stylesheet" href="/production/sidepanel.css">' +
  '<link id="graph-style" rel="stylesheet" href="/production/pro-request-graph.css" disabled></head>' +
  '<body><main id="surface"><div id="root"></div></main><script type="module" src="/fixture.js"></script></body></html>';
const evidence = { checks: [], cases: [], errors: [], unexpectedRequests: [], fixture: 'Loopback-only native Chromium; production Social component and all production surface styles; canonical synthetic metadata only' };
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  if (pathname === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html.replace('</head>', '<link rel="stylesheet" href="/production/company-ui.css"></head>')); return; }
  if (pathname === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(fixtureScript); return; }
  const file = files.get(pathname);
  if (!file) { evidence.unexpectedRequests.push(pathname); response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', companyFixtureContentType(file)); response.end(readFileSync(file));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
let context;
try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true,
    viewport: { width: 1120, height: 900 }, args: ['--no-proxy-server'] });
  evidence.browser = context.browser().version();
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === origin) await route.continue();
    else { evidence.unexpectedRequests.push(route.request().url()); await route.abort(); }
  });
  const page = await context.newPage(); page.on('pageerror', error => evidence.errors.push(error.message));
  await page.goto(origin); await page.waitForFunction(() => window.socialLayoutReady);
  const catalogues = new Map(PRODUCTION_LANGUAGES.map(language => [language.id,
    JSON.parse(readFileSync(join(root, 'apps/production-extension', language.uiOnly ? 'ui-locales' : '_locales', language.id, 'messages.json'), 'utf8'))]));
  const configure = async (language, width, mode, snapshots = [snapshot]) => {
    await page.evaluate(payload => window.renderSocialFixture(payload), { locale: language.id, tag: language.tag,
      table: catalogues.get(language.id), width, mode, snapshots });
  };
  const inspect = async () => page.evaluate(() => {
    const rect = element => { const value = element.getBoundingClientRect(); return { left: value.left, right: value.right, width: value.width, height: value.height }; };
    const tables = [...document.querySelectorAll('[data-social-table]')], rows = [...document.querySelectorAll('[data-social-row]')];
    const overflow = [];
    for (const element of document.querySelectorAll('.social-observations, .social-report-table td, .social-cell-label, .social-cell-value')) {
      if (getComputedStyle(element).display !== 'none' && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1) {
        overflow.push({ class: element.className, width: element.clientWidth, scrollWidth: element.scrollWidth, text: element.textContent.slice(0, 60) });
      }
    }
    return { direction: document.documentElement.dir, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
      overflow, rows: rows.length, cellCounts: rows.map(row => row.querySelectorAll(':scope > td').length),
      maximumCounts: [...document.querySelectorAll('[data-social-count-source]')].filter(element => element.textContent.includes('2147483647')).length,
      script: document.querySelector('[data-social-script]')?.textContent, tables: tables.map(table => ({
        display: getComputedStyle(table).display, width: rect(table).width, containerWidth: rect(table.closest('.social-observations')).width,
        header: { display: getComputedStyle(table.tHead).display, position: getComputedStyle(table.tHead).position, ...rect(table.tHead) },
        headers: [...table.querySelectorAll('th')].map(header => {
          const range = document.createRange(); range.selectNodeContents(header);
          return { text: header.textContent, wrap: getComputedStyle(header).overflowWrap, textLines: range.getClientRects().length,
            scope: header.scope, role: header.getAttribute('role'), ...rect(header) };
        }),
        labels: [...table.querySelectorAll('.social-cell-label')].map(label => ({ text: label.textContent, display: getComputedStyle(label).display,
          wrap: getComputedStyle(label).overflowWrap, hidden: label.getAttribute('aria-hidden') })),
        roles: { table: table.getAttribute('role'), rowgroups: [...table.querySelectorAll('thead, tbody')].map(item => item.getAttribute('role')),
          rows: [...table.querySelectorAll('tr')].map(item => item.getAttribute('role')), cells: [...table.querySelectorAll('td')].map(item => item.getAttribute('role')) }
      })) };
  });
  const verify = (result, description, expectedRows = rows.length, printing = false) => {
    assert.equal(result.rows, expectedRows, description + ': all rows');
    assert.ok(result.cellCounts.every(count => count === 4), description + ': four fields retained');
    assert.ok(result.maximumCounts > 0, description + ': maximum counts retained');
    assert.equal(result.script, longHost + '/analytics.mjs', description + ': long script retained');
    assert.deepEqual(result.overflow, [], description + ': inner horizontal overflow');
    assert.ok(result.documentWidth <= result.viewport + 1, description + ': document horizontal overflow');
    for (const table of result.tables) {
      const stacked = !printing && table.containerWidth <= 640;
      assert.equal(table.display === 'table', !stacked, description + ': container-responsive layout');
      assert.equal(table.roles.table, 'table'); assert.deepEqual(table.roles.rowgroups, ['rowgroup', 'rowgroup']);
      assert.ok(table.roles.rows.every(role => role === 'row')); assert.ok(table.roles.cells.every(role => role === 'cell'));
      assert.ok(table.headers.every(header => header.wrap === 'normal' && header.scope === 'col' && header.role === 'columnheader'));
      assert.ok(table.labels.every(label => label.hidden === 'true' && (label.display === 'none' || label.wrap === 'normal')));
      if (stacked) assert.ok(table.labels.every(label => label.display !== 'none'), description + ': visible field labels');
      else {
        assert.equal(table.header.display, 'table-header-group'); assert.equal(table.header.position, 'static');
        assert.ok(table.header.width > 1 && table.header.height > 1, description + ': full visible header');
        for (const header of table.headers) if (/^[A-Za-z]+$/.test(header.text)) {
          assert.equal(header.textLines, 1, description + ': single-word header stays on one line');
        }
        assert.ok(table.labels.every(label => label.display === 'none'), description + ': no duplicate printed labels');
      }
    }
    evidence.cases.push({ description, direction: result.direction, viewport: result.viewport, rows: result.rows,
      containers: result.tables.map(table => ({ width: table.containerWidth, layout: table.display })) });
  };
  for (const language of PRODUCTION_LANGUAGES) {
    for (const width of [280, 380, 560, 760]) {
      await configure(language, width, 'sidepanel'); const result = await inspect();
      verify(result, language.id + ': sidepanel ' + width + ' in wide viewport');
      assert.equal(result.direction, ['ar', 'ur'].includes(language.id) ? 'rtl' : 'ltr');
    }
  }
  evidence.checks.push('all 21 locales at 280/380/560/760 px containers retain four fields, source labels, maximum counts and safe long scripts without horizontal overflow');
  const english = PRODUCTION_LANGUAGES.find(language => language.id === 'en');
  await page.setViewportSize({ width: 380, height: 900 });
  await configure(english, 380, 'popup'); verify(await inspect(), 'English native popup CSS 380');
  await page.screenshot({ path: join(artifact, 'social-layout-chrome.png'), fullPage: true });
  evidence.checks.push('actual popup styles at 380 px show labeled cards and preserve all four fields');
  await page.setViewportSize({ width: 1120, height: 900 });
  for (const width of [380, 560, 760, 1056]) {
    await configure(english, width, 'report'); verify(await inspect(), 'English report ' + width);
  }
  evidence.checks.push('Pro report adapts to the container independently of the large viewport and restores a table on wide reports');
  await configure(english, 1056, 'report', documents); verify(await inspect(), 'All 256 Pro rows across 24 documents', 256);
  evidence.checks.push('all 256 admitted Pro entries across 24 documents preserve their four cells');
  await page.setViewportSize({ width: 794, height: 1123 });
  await configure(english, 680, 'report', documents); verify(await inspect(), 'A4-width preview retains all 256 Pro rows', 256);
  await page.emulateMedia({ media: 'print' });
  verify(await inspect(), 'A4 print restores full tables and repeated headers for 256 rows', 256, true);
  await page.pdf({ path: join(artifact, 'social-layout-chrome.pdf'), format: 'A4', printBackground: true });
  evidence.checks.push('print restores real table layout and full repeatable headers without duplicate card labels or data loss');
  await page.emulateMedia({ media: 'screen' });
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.unexpectedRequests, []);
  evidence.checks.push('no page exceptions or external requests');
  console.log('PASS: native Social layout (' + evidence.cases.length + ' cases, ' + evidence.checks.length + ' checks)');
} finally {
  writeFileSync(join(artifact, 'social-layout-chrome.json'), JSON.stringify(evidence, null, 2) + '\n');
  await context?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
  const ownedRun = resolve(run); assert.ok(ownedRun.startsWith(temporary + sep));
  rmSync(ownedRun, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
