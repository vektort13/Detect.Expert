import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { runtimeSource } from '../pro-values-runtime.mjs';
import { readCookieSnapshot, normalizeProCookieMetadata, readLoaderRows, readTagManagerDocuments, readSocialRows, readSocialDocuments, mergeLoaderRows } from '../../../packages/contracts/src/inspection.mjs';
import { readAdvancedPageFields } from '../../../packages/contracts/src/advanced-inspection.mjs';
import { ProCookieCapture } from '../../../apps/production-extension/pro-cookie-capture.js';
import { createVendorRedirectTracker } from '../../../apps/production-extension/vendor-redirects.js';

const root = new URL('../../../', import.meta.url);
const source = readFileSync(new URL('apps/production-extension/background.js', root), 'utf8');
const contracts = source.slice(0, source.indexOf('// packages/attribution/src/psl-index.json')).replace(/^import[^\n]*\n/gm, '');
const first = source.indexOf('// packages/background/src/pro-recording.ts');
const last = source.indexOf('// packages/background/src/local-probe-window.ts', first);
assert.ok(first > 0 && last > first);
const number = count => ({ operation: 'Window.innerWidth', techniqueId: 'DET-030', phase: 'returned-sync', value: { kind: 'number', value: 1000 }, parameters: [], count });

function fixture({ rows = [], sensor = { token: 'earlier-worker', count: 20 } } = {}) {
  // This isolated Pro-value suite has no network events or approved resource matcher.
  const createRuntimeVendorRedirects = () => createVendorRedirectTracker({ match: () => [] });
  const context = vm.createContext({ atob, btoa, TextEncoder, structuredClone, setTimeout, clearTimeout, crypto: webcrypto, readCookieSnapshot, normalizeProCookieMetadata, readLoaderRows, readTagManagerDocuments, readSocialRows, readSocialDocuments, mergeLoaderRows, readAdvancedPageFields, ProCookieCapture, createRuntimeVendorRedirects });
  vm.runInContext(contracts + '\n' + runtimeSource + '\n' + source.slice(first, last), context);
  const page = { id: 'page-1', tabId: 1, documentKey: '1:0:fixture', apiValues: rows.length ? [{ documentKey: '1:0:fixture', rows, truncated: false }] : [], reports: [], resources: [] };
  const calls = [];
  const binding = { documentKey: page.documentKey, documentId: 'fixture', tabId: 1, frameId: 0, documentLifecycle: 'active' };
  const runtime = {
    now: () => 100,
    scope: { hasDataConsent: true, accessGeneration: 1 },
    state: { bindings: new Map([[page.documentKey, binding]]) },
    apiResults: { authorize: async () => true, trackOperation: () => true, releaseOperation() {} },
    api: { tabs: { sendMessage: async (_tab, request) => {
      calls.push(request);
      if (request.type === 'pro-values-stop') { if (request.sessionId === sensor.token) sensor.token = ''; return; }
      if (request.type === 'pro-values-start' && request.sessionId !== sensor.token) { sensor.token = request.sessionId; sensor.count = 0; }
      return { schemaVersion: 1, type: 'pro-values-cache', sessionId: request.sessionId, available: request.sessionId === sensor.token, truncated: false, rows: sensor.count ? [number(sensor.count)] : [] };
    } } },
  };
  const manager = new context.ProRecordingManager(runtime);
  manager.session = { id: 'fixture-session', status: 'recording', deadlineAt: 1000, pages: [page], limitations: [] };
  manager.trackedTabs.add(1); manager.currentPages.set(1, page.id);
  manager.belongsToPage = () => true; manager.mark = () => {};
  const capture = async () => { await manager.captureValues(); clearTimeout(manager.proValueTimer); manager.proValueTimer = null; };
  return { manager, runtime, page, calls, sensor, capture };
}

test('native operation capacity is checked before invoking the operation', async () => {
  const { manager } = fixture();
  const releases = []; let calls = 0;
  const operation = () => { calls++; return new Promise(resolve => releases.push(resolve)); };
  const jobs = Array.from({ length: 4 }, () => manager.boundedPro(operation));
  await Promise.resolve();
  await assert.rejects(manager.boundedPro(operation), /pro-read-capacity/);
  assert.equal(calls, 4); assert.equal(manager.proValuePending.size, 4);
  releases.forEach(release => release('done')); await Promise.all(jobs);
  assert.equal(manager.proValuePending.size, 0);
});

test('timeout retains physical capacity until native work actually settles', async () => {
  const { manager } = fixture(); let release;
  const job = manager.boundedPro(() => new Promise(resolve => { release = resolve; }));
  await assert.rejects(job, /pro-read-timeout/);
  assert.equal(manager.proValuePending.size, 1);
  release(); await Promise.resolve(); await Promise.resolve();
  assert.equal(manager.proValuePending.size, 0);
});

test('a restored report starts a new sensor epoch and adds new counts once', async () => {
  const f = fixture({ rows: [number(3)] });
  await f.capture();
  const token = f.calls[0].sessionId;
  assert.match(token, /^[A-Za-z0-9-]{1,64}$/); assert.notEqual(token, 'earlier-worker');
  assert.equal(f.sensor.count, 0); assert.equal(f.page.apiValues[0].rows[0].count, 3);
  f.sensor.count = 2; await f.capture();
  assert.equal(f.calls.at(-1).type, 'pro-values-read'); assert.equal(f.page.apiValues[0].rows[0].count, 5);
  await f.capture(); assert.equal(f.page.apiValues[0].rows[0].count, 5);
  f.sensor.count = 3; await f.capture(); assert.equal(f.page.apiValues[0].rows[0].count, 6);
});

test('a cleared MAIN history restarts while preserving the previous report', async () => {
  const f = fixture(); await f.capture(); f.sensor.count = 2; await f.capture();
  f.sensor.token = ''; f.sensor.count = 0; await f.capture();
  assert.equal(f.manager.proValueCaptures.size, 0);
  await f.capture(); f.sensor.count = 1; await f.capture();
  assert.equal(f.page.apiValues[0].rows[0].count, 3);
});

test('old page and absent binding capture references are removed', async () => {
  const f = fixture(); await f.capture();
  f.manager.proValueBaselines.set('old-token|1:0:old', [number(9)]);
  f.runtime.state.bindings.clear(); await f.capture();
  assert.equal(f.manager.proValueCaptures.size, 0); assert.equal(f.manager.proValueBaselines.size, 0);
  assert.equal(f.page.apiValues.length, 1);
});
