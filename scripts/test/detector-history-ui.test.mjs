import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetectorHistoryController } from '../../apps/production-extension/detector-history-ui.js';
import { PRO_REPORT_HISTORY_LABELS } from '../../apps/production-extension/pro-report-history-labels.js';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
const tick = () => new Promise(done => setImmediate(done));
const deferred = () => { let resolve;const promise = new Promise(done => { resolve = done; });return { promise, resolve }; };
const row = id => ({ id, domain: 'example.test', savedAt: 3000, startedAt: 1000, stoppedAt: 2000, pages: 1, bytes: 500 });
function fixture() {
  const storageListeners = new Set(), archiveListeners = new Set(), messages = [], opens = [];let accepted = true, records = [row('saved-1')], failOpen = false;
  const archive = { list: async () => records, get: async id => records.some(row => row.id === id) ? { id, status: 'stopped' } : null, remove: async id => { records = records.filter(row => row.id !== id); }, subscribe: listener => { archiveListeners.add(listener);return () => archiveListeners.delete(listener); } };
  const browserApi = { runtime: { sendMessage: async request => { messages.push(request);return { schemaVersion: 1, type: 'data-consent-state', version: 1, accepted }; }, getURL: path => 'chrome-extension://owned/' + path }, tabs: { create: async request => { if (failOpen) throw Error('OPEN_FAILED');opens.push(request); } }, storage: { onChanged: { addListener: listener => storageListeners.add(listener), removeListener: listener => storageListeners.delete(listener) } } };
  const controller = createDetectorHistoryController({ browserApi, getHistoryStore: async () => archive });
  return { controller, archive, browserApi, messages, opens, storageListeners, archiveListeners, setAccepted: value => { accepted = value;for (const listener of storageListeners) listener({ 'data-consent:v1': {} }, 'local'); }, setFailOpen: value => { failOpen = value; } };
}
test('existing saved reports list and open with no source tab and without starting PRO', async () => {
  const f = fixture();try { f.controller.setActive(true);await tick();assert.equal(f.controller.getSnapshot().items.length, 1);assert.equal(await f.controller.open('saved-1'), true);assert.equal(f.opens[0].url, 'chrome-extension://owned/report.html?id=saved-1&history=1');assert.ok(f.messages.every(request => request.type === 'ui-data-consent-get' && !Object.hasOwn(request, 'tabId'))); } finally { f.controller.dispose(); }
});
test('open failure is visible, retains report and allows a successful retry', async () => {
  const f = fixture();try { f.controller.setActive(true);await tick();f.setFailOpen(true);assert.equal(await f.controller.open('saved-1'), false);assert.equal(f.controller.getSnapshot().error, 'openFailed');assert.equal(f.controller.getSnapshot().items.length, 1);f.setFailOpen(false);assert.equal(await f.controller.open('saved-1', true), true);assert.match(f.opens[0].url, /&print=1$/u); } finally { f.controller.dispose(); }
});
test('late list callback after hidden/unmounted view cannot repopulate or notify it', async () => {
  const f = fixture(), pending = deferred(), notifications = [];f.archive.list = () => pending.promise;f.controller.subscribe(state => notifications.push(state));f.controller.setActive(true);await tick();f.controller.setActive(false);const count = notifications.length;pending.resolve([row('stale')]);await tick();assert.equal(notifications.length, count);assert.deepEqual(f.controller.getSnapshot().items, []);f.controller.dispose();assert.equal(f.storageListeners.size, 0);assert.equal(f.archiveListeners.size, 0);
});
test('a new active generation waits for old physical read and refreshes with the current archive', async () => {
  const f = fixture(), pending = deferred();let calls = 0;f.archive.list = () => ++calls === 1 ? pending.promise : Promise.resolve([row('new')]);try { f.controller.setActive(true);await tick();f.controller.setActive(false);f.controller.setActive(true);pending.resolve([row('old')]);await tick();await tick();assert.deepEqual(f.controller.getSnapshot().items.map(row => row.id), ['new']); } finally { f.controller.dispose(); }
});
test('stale report-open callback after dispose does not create a tab', async () => {
  const f = fixture(), pending = deferred();f.controller.setActive(true);await tick();f.archive.get = () => pending.promise;const opening = f.controller.open('saved-1');await tick();f.controller.dispose();pending.resolve({ id: 'saved-1', status: 'stopped' });assert.equal(await opening, false);assert.equal(f.opens.length, 0);
});
test('consent change immediately clears metadata and denied consent does not read the archive', async () => {
  const f = fixture();try { f.controller.setActive(true);await tick();let reads = 0;f.archive.list = async () => { reads++;return [row('forbidden')]; };f.setAccepted(false);await tick();assert.deepEqual(f.controller.getSnapshot().items, []);assert.equal(reads, 0); } finally { f.controller.dispose(); }
});
test('loading never deletes an archived report; removal requires explicit method call', async () => {
  const f = fixture();let removes = 0;f.archive.remove = async () => { removes++; };try { f.controller.setActive(true);await tick();await f.controller.refresh();assert.equal(removes, 0);assert.equal(await f.controller.remove('saved-1'), true);assert.equal(removes, 1); } finally { f.controller.dispose(); }
});
test('all twenty-one existing locales have complete concise history copy', () => {
  assert.deepEqual(Object.keys(PRO_REPORT_HISTORY_LABELS).sort(), PRODUCTION_LANGUAGES.map(row => row.id).sort());for (const copy of Object.values(PRO_REPORT_HISTORY_LABELS)) { assert.equal(Object.keys(copy).length, 15);assert.ok(Object.values(copy).every(value => typeof value === 'string' && value.trim().length > 0)); }
});
test('timeouts retain a cap of four physical native operations instead of accumulating retries', async () => {
  const pending = [], browserApi = { runtime: { sendMessage: () => new Promise(resolve => pending.push(resolve)) }, storage: { onChanged: { addListener() {}, removeListener() {} } } };
  const controller = createDetectorHistoryController({ browserApi, getHistoryStore: async () => { throw Error('must not reach archive'); }, timeoutMs: 2 });
  try { controller.setActive(true);await new Promise(done => setTimeout(done, 5));for (let i = 0; i < 6; i++) await controller.refresh();assert.equal(pending.length, 4);assert.equal(controller.getSnapshot().error, 'loadFailed'); }
  finally { controller.dispose();for (const resolve of pending) resolve({ schemaVersion: 1, type: 'data-consent-state', version: 1, accepted: false }); }
});
