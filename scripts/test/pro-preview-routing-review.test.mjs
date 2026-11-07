import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import vm from 'node:vm';
import { archiveCurrentProReport } from '../../apps/production-extension/pro-report-history.js';

const root = new URL('../../', import.meta.url), h = (type, props) => ({ type, props });
const read = name => readFileSync(new URL('apps/production-extension/' + name, root), 'utf8');
const nodes = (node, predicate) => Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : !node || typeof node !== 'object' ? [] : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const fragment = (source, first, last) => {
  const start = source.indexOf(first), end = source.indexOf(last, start);
  assert.ok(start >= 0 && end > start); return source.slice(start, end);
};
const row = (techniqueId, value) => ({ operation: 'Window.innerWidth', techniqueId, phase: 'returned-sync', value: { kind: 'number', value }, parameters: [], count: 1 });
const report = (key, techniques = []) => ({ documentKey: key, host: 'example.test', techniques, coverageFlags: [], coverageState: 'active', dropped: { counters: 0 } });

for (const name of ['popup.js', 'sidepanel.js']) {
  test(name + ': visit preview preserves every value document independently of findings and report joins', () => {
    const source = read(name), context = vm.createContext({ u3: h, d2: initial => [initial === false ? true : initial, () => {}], T2: compute => compute(), visitTechniqueIds: () => [], t3: (key, args) => key + (args ? ':' + args.join(',') : ''), ProCookieSnapshot() {}, CookieWritersTable() {}, ProSocialSnapshot() {}, ProAdvancedSnapshot() {}, ProTagManagerSection() {}, S: 'fragment', PRO_LIMITS: { maxResourcesPerPage: 1024 } });
    vm.runInContext(fragment(source, 'function ProApiValues(', 'function ProModeView('), context);
    const first = '7:0:main', child = '7:4:child', orphan = '7:6:retained';
    const documents = [
      { documentKey: first, rows: [row('DET-030', 100), row('DET-030', 200), row('DET-067', 300)], truncated: false },
      { documentKey: child, rows: [row('DET-030', 400)], truncated: false },
      { documentKey: orphan, rows: [row('DET-030', 500)], truncated: false },
      { documentKey: '7:7:empty', rows: [], truncated: false }
    ];
    const page = { id: 'page-1', url: 'https://example.test/', reports: [report(first, [{ techniqueId: 'DET-030', count: 0 }]), report(child)], apiValues: documents, resources: [], socialNetworks: [] };
    const rendered = context.PageDetails({ page, ordinal: 1, recording: true, onReport() {} });
    const sections = nodes(rendered, node => node.props?.['data-pro-values-document']);
    assert.deepEqual(sections.map(section => section.props['data-pro-values-document']), [first, child, orphan]);
    const renderedRows = nodes(rendered, node => node.type === context.ProApiValues).flatMap(node => node.props.rows);
    assert.equal(renderedRows.length, 5); assert.deepEqual(renderedRows.map(item => item.value.value), [100, 200, 300, 400, 500]);
    const renderedDocuments = nodes(rendered, node => node.type === context.DocumentDetails);
    assert.ok(renderedDocuments.every(node => !Object.hasOwn(node.props, 'values')));
    const social = nodes(rendered, node => node.type === context.ProSocialSnapshot);
    assert.equal(social.length, 1); assert.equal(social[0].props.page, page);
  });

  test(name + ': open, save and visit links route to the same complete standalone Pro report', async () => {
    const source = read(name), urls = [], order = [], stopped = { id: 'session-123', status: 'stopped' };
    const history = { captureEpoch: async () => { order.push('epoch');return 'captured-epoch'; }, save: async (session, epoch) => { assert.equal(session, stopped);assert.equal(epoch, 'captured-epoch');order.push('archive'); } };
    const context = vm.createContext({ archiveCurrentProReport, getProReportHistory: () => history, requestPro: async request => { assert.equal(request.type, 'ui-pro-get');assert.equal(Object.hasOwn(request, 'tabId'), false);order.push('fresh-source');return { ok: true, response: { session: stopped } }; }, chrome: { runtime: { getURL: path => 'chrome-extension://fixture/' + path }, tabs: { create: async options => { order.push('open');urls.push(options.url); } } } });
    vm.runInContext(fragment(source, 'async function openProReport(', '// packages/ui/src/components/ResponseHeaders.tsx'), context);
    assert.equal(await context.openProReport(stopped), true);
    assert.equal(await context.openProReport(stopped, undefined, 'save'), true);
    assert.equal(await context.openProReport(stopped, 'page-2'), true);
    assert.deepEqual(urls, ['chrome-extension://fixture/report.html?id=session-123', 'chrome-extension://fixture/report.html?id=session-123&history=1&print=1', 'chrome-extension://fixture/report.html?id=session-123#page-page-2']);
    assert.deepEqual(order, ['open', 'epoch', 'fresh-source', 'archive', 'open', 'open'], 'Only explicit Save archives, before opening PDF; ordinary preview remains unchanged');
    assert.equal(await context.openProReport({ ...stopped, status: 'recording' }), false);
    assert.equal(await context.openProReport({ ...stopped, id: 'bad&id=other' }), false); assert.equal(urls.length, 3);
    const pro = fragment(source, 'function ProModeView(', '// apps/production-extension/protection-ui');
    assert.ok(pro.includes('openProReport(')); assert.equal(pro.includes('ui-export-preview'), false); assert.equal(pro.includes('buildExportDownload'), false);
    const inspector = fragment(source, 'function InspectorView(', '// packages/contracts/src/data-consent.ts');
    const light = inspector.indexOf('hidden: mode.mode !== "light"'), preview = inspector.indexOf('u3(ExportPreviewDialog,'), proPanel = inspector.indexOf('hidden: mode.mode !== "pro"');
    assert.ok(light >= 0 && preview > light && proPanel > preview);
  });
}

test('standalone Pro report uses company/social components and session-wide summary, with image readiness before print', () => {
  const source = read('report.js'), report = fragment(source, 'function ProReportDocument(', '// ADR-020:');
  for (const component of ['Companies', 'Values', 'Summary']) assert.ok(report.includes('u3(ProTables.' + component + ','));
  assert.ok(report.includes('u3(ProSocialSnapshot, { snapshots: page.socialNetworks, page })'));
  assert.ok(report.includes('u3(ProTables.Summary, { session, cookies: true,'));
  assert.ok(source.includes('CompanyLabel, SiteLabel, extensionTargetLabel }'));
  const readiness = fragment(source, 'async function reportReadyForPrint()', 'function consumeSaveIntent()');
  assert.ok(readiness.includes('waitForCompanyImages(document)')); assert.ok(readiness.includes('document.fonts.ready'));
  const app = fragment(source, 'function ConsentedProReportApp()', '// apps/extension/entrypoints/report/report.tsx');
  assert.ok(app.indexOf('await reportReadyForPrint()') < app.indexOf('window.print()'));
  assert.equal(app.includes('buildExportDownload'), false);
});

test('preview generator agrees with the existing UI generators without source mutation', () => {
  for (const name of ['sync-pro-preview-values.mjs', 'sync-advanced-ui.mjs', 'sync-company-ui.mjs', 'sync-review-ui.mjs']) {
    const result = spawnSync(process.execPath, ['scripts/production/' + name, '--check'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, name + ': ' + result.stderr + result.stdout);
  }
});
