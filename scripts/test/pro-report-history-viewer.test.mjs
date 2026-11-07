import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { namedFunction } from '../production/clear-reset-tools.mjs';
import { proReportHistoryIntent } from '../../apps/production-extension/pro-report-history.js';
import { stoppedProSession } from './pro-report-history-fixture.mjs';
const source = readFileSync(new URL('../../apps/production-extension/report.js', import.meta.url), 'utf8');
const readSource = namedFunction(source, 'readRecording', 'report.js').text;
const renderSource = namedFunction(source, 'ConsentedProReportApp', 'report.js').text;
function loader(search, saved, fails = false) {
  let liveReads = 0, archiveReads = 0;const live = stoppedProSession('live');
  const context = vm.createContext({ Promise, URLSearchParams, setTimeout, clearTimeout, location: { search }, reportSessionId: () => 'saved', proReportHistoryIntent, getProReportHistory: () => ({ get: async id => { assert.equal(id, 'saved');archiveReads++;if (fails) throw Error('ARCHIVE_FAILED');return saved; } }), validateProStateResponse: value => ({ ok: true, value }), chrome: { runtime: { sendMessage: async request => { assert.equal(request.type, 'ui-pro-get');liveReads++;return { schemaVersion: 1, type: 'pro-state', session: live, currentDomain: null, canStart: false }; } } } });
  vm.runInContext(readSource, context);return { read: () => context.readRecording('saved'), counts: () => ({ liveReads, archiveReads }) };
}
test('archive report lookup is independent of a later live recording', async () => {
  const f = loader('?id=saved&history=1', stoppedProSession('saved')), result = await f.read();assert.equal(result.ok, true);assert.equal(result.value.session.id, 'saved');assert.deepEqual(f.counts(), { liveReads: 0, archiveReads: 1 });
});
test('deleted or unavailable archive-only id never falls back to a different live report', async () => {
  for (const fails of [false, true]) { const f = loader('?id=saved&history=1', null, fails);assert.equal((await f.read()).ok, false);assert.equal(f.counts().liveReads, 0); }
});
test('ordinary existing preview keeps live fallback when no archive exists or IDB is unavailable', async () => {
  for (const fails of [false, true]) { const f = loader('?id=saved', null, fails), result = await f.read();assert.equal(result.value.session.id, 'live');assert.equal(f.counts().liveReads, 1); }
});
test('invalid duplicate history flags reject before opening either archive or live backend', async () => {
  const f = loader('?id=saved&history=1&history=0', stoppedProSession('saved'));assert.equal((await f.read()).ok, false);assert.deepEqual(f.counts(), { liveReads: 0, archiveReads: 0 });
});

function manualPrint(failSave = false) {
  const session = stoppedProSession('saved'), order = [], updates = [];let states = 0;
  const h = (type, props = {}) => ({ type, props }), context = vm.createContext({ URL, URLSearchParams, Promise,
    useLocale() {}, uiLocale: () => 'en', d2: initial => { const index = states++;return [index === 0 ? session : initial, value => updates.push({ index, value })]; }, A2: initial => ({ current: initial }), h2() {}, u3: h, t3: key => key,
    reportSaveIntent: () => false, location: { href: 'chrome-extension://owned/report.html?id=saved', search: '?id=saved' }, history: { state: null, replaceState: (_state, _title, url) => { order.push('archive-route');assert.match(url, /history=1/u); } },
    reportReadyForPrint: async () => { order.push('layout');return true; }, proReportHistoryIntent,
    getProReportHistory: () => ({ captureEpoch: async () => { order.push('epoch');return 'captured'; }, save: async (value, epoch) => { assert.equal(value, session);assert.equal(epoch, 'captured');order.push('archive');if (failSave) throw Object.assign(Error('history-full'), { code: 'history-full' }); } }),
    readRecording: async id => { order.push('fresh-read');assert.equal(id, 'saved');return { ok: true, value: { session } }; },
    window: { print: () => order.push('print') }, proReportHistoryError: (_locale, code) => code, LanguagePicker() {}, ProReportDocument() {}, ProRequestGraph() {},
  });
  vm.runInContext(renderSource, context);const tree = context.ConsentedProReportApp();
  function find(node) { if (Array.isArray(node)) return node.flatMap(find);if (!node || typeof node !== 'object') return [];return [...(node.type === 'button' && node.props.children === 'report_save' ? [node] : []), ...find(node.props.children)]; }
  const buttons = find(tree);assert.equal(buttons.length, 1);return { click: () => buttons[0].props.onClick(), order, updates };
}
test('manual PDF Save archives a fresh validated snapshot before invoking native print', async () => {
  const f = manualPrint();f.click();for (let i = 0; i < 4; i++) await new Promise(done => setImmediate(done));assert.deepEqual(f.order, ['layout', 'epoch', 'fresh-read', 'archive', 'archive-route', 'print']);
});
test('manual PDF Save capacity failure is visible and never silently prints an unsaved report', async () => {
  const f = manualPrint(true);f.click();for (let i = 0; i < 4; i++) await new Promise(done => setImmediate(done));assert.equal(f.order.includes('print'), false);assert.ok(f.updates.some(row => row.index === 3 && row.value === 'history-full'));
});
