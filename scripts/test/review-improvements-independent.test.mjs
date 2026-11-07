// ADR-038 independent review regressions: transport identity, reset lifecycle and late realms.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import vm from 'node:vm';
import { createProParameterBudget, runtimeSource as proSource } from '../production/pro-values-runtime.mjs';
import { startCookieWriterBridge } from '../production/cookie-writer-bridge-runtime.mjs';
import { CookieWriterObserver } from '../../apps/production-extension/cookie-writer-observer.js';
import { readCookieWriterRows, readCookieWriterRequest } from '../../packages/contracts/src/cookie-writers.mjs';
import { readAdvancedPageFields } from '../../packages/contracts/src/advanced-inspection.mjs';
import { captureAdvancedChannels } from '../../apps/production-extension/pro-advanced-capture.js';

const row = { name: '_id', phase: 'returned-sync', script: null, attributionConfidence: 'unknown', evidenceSource: 'page-hook', integrity: 'page-controlled', count: 1 };
const request = { schemaVersion: 1, type: 'ui-get-cookie-writers', tabId: 7, frameId: 0, documentKey: '7:0:native' };
const snapshot = (key, rows = [row]) => ({ schemaVersion: 1, type: 'cookie-writers-state', documentKey: key, coverageState: 'partial', rows, truncated: false });
const params = (value, operation = 'CanvasRenderingContext2D.getImageData') => ({ operation, parameters: [{ name: 'arg0', kind: 'number', value }] });

test('late child parameter budget never captures replaced constructors/prototypes after module evaluation', () => {
  const context = vm.createContext({}); vm.runInContext(proSource, context);
  vm.runInContext(`
    globalThis.pageCalls=0;
    const trap=function(){pageCalls++;throw Error('page intrinsic');};
    Map.prototype.get=Map.prototype.set=Map.prototype.clear=trap;
    Set.prototype.has=Set.prototype.add=trap;
    Object.defineProperty(Set.prototype,'size',{get:trap});
    globalThis.Map=globalThis.Set=trap;Reflect.apply=trap;
    globalThis.budget=createProParameterBudget();
    globalThis.admission=budget.admit({operation:'CanvasRenderingContext2D.getImageData',parameters:[{name:'arg0',kind:'number',value:4}]});
    budget.reset();
  `, context);
  assert.equal(context.pageCalls, 0); assert.equal(context.admission, true);
});

test('parameter budget admits32 tuples per API, preserves repeats and other APIs, resets at the next session', () => {
  const budget = createProParameterBudget();
  for (let index = 0; index < 32; ++index) assert.equal(budget.admit(params(index)), true);
  assert.equal(budget.admit(params(32)), false); assert.equal(budget.admit(params(0)), true);
  assert.equal(budget.admit(params(32, 'OffscreenCanvasRenderingContext2D.getImageData')), true);
  assert.equal(budget.admit({ operation: 'CanvasRenderingContext2D.getImageData', parameters: [] }), true);
  budget.reset(); assert.equal(budget.admit(params(32)), true);
});

test('unrelated postMessage traffic and other request IDs do not consume writer candidate admission', () => {
  let page, command, posted; const replies = [];
  startCookieWriterBridge({ onPage: fn => { page = fn; }, onCommand: fn => { command = fn; }, onHide() {}, now: () => 0, later: () => 1, cancel() {}, post: value => { posted = value; } }, readCookieWriterRows);
  assert.equal(command(true, { schemaVersion: 1, type: 'cookie-writers-query' }, value => replies.push(value)), true);
  for (let index = 0; index < 100; ++index) {
    page(true, { channel: 'normal-site-application', type: 'normal-message' });
    page(true, { channel: 'detect.expert/cookie-writers/v1', type: 'cookie-writers-batch', requestId: 'cookie-writers-foreign' });
  }
  page(true, { ...posted, type: 'cookie-writers-batch', enabled: true, rows: [row], truncated: false });
  assert.equal(replies.length, 1); assert.equal(replies[0].available, true); assert.deepEqual(replies[0].rows, [row]);
});

test('eight matching malformed writer candidates still bound parser work and reject a later answer', () => {
  let page, command, posted, expire; const replies = [];
  startCookieWriterBridge({ onPage: fn => { page = fn; }, onCommand: fn => { command = fn; }, onHide() {}, now: () => 0, later: callback => { expire = callback; return 1; }, cancel() {}, post: value => { posted = value; } }, readCookieWriterRows);
  command(true, { schemaVersion: 1, type: 'cookie-writers-query' }, value => replies.push(value));
  for (let index = 0; index < 8; ++index) page(true, { ...posted, type: 'cookie-writers-batch', enabled: true, rows: 'bad', truncated: false });
  page(true, { ...posted, type: 'cookie-writers-batch', enabled: true, rows: [row], truncated: false });
  assert.equal(replies.length, 0); expire(); assert.equal(replies[0].available, false);
});

function observerFixture() {
  const binding = { apiResultsResetRequired: false }, sent = [], runtime = {
    now: () => 1800000000000, scope: { accessGeneration: 1, hasDataConsent: true },
    getProjection: () => ({ documentKey: request.documentKey, coverageState: 'active' }), canObserveNetworkDocument: () => true,
    apiResults: { binding: () => binding, authorize: async () => true },
    api: { tabs: { sendMessage: async (...args) => { sent.push(args); return { schemaVersion: 1, type: 'cookie-writers-cache', available: true, rows: [row], truncated: false }; } } },
  };
  const observer = new CookieWriterObserver(runtime, { redact: () => ({ kind: 'unknown' }) });
  return { binding, sent, runtime, observer };
}

test('a persisted failed-reset marker prevents stale MAIN writer data from repopulating a cleared result', async () => {
  const f = observerFixture(); f.binding.apiResultsResetRequired = true;
  const result = await f.observer.read(request); assert.deepEqual(result.rows, []); assert.equal(f.sent.length, 0); assert.equal(f.observer.documents.size, 0);
  f.binding.apiResultsResetRequired = false; assert.equal((await f.observer.read(request)).rows.length, 1);
});

test('a reset marker arriving during the native query discards both the reply and previously cached writers', async () => {
  const f = observerFixture(); await f.observer.read(request); assert.equal(f.observer.snapshot(request.documentKey).rows.length, 1);
  f.runtime.api.tabs.sendMessage = async () => { f.binding.apiResultsResetRequired = true; return { schemaVersion: 1, type: 'cookie-writers-cache', available: true, rows: [row], truncated: false }; };
  assert.deepEqual((await f.observer.read(request)).rows, []); assert.deepEqual(f.observer.snapshot(request.documentKey).rows, []);
});

test('writer Pro capture includes only current authorized documents of the same page and stores a detached aggregate', async () => {
  const keys = ['7:0:native', '7:2:child'], calls = [], page = { id: 'page', tabId: 7, documentKey: keys[0] };
  const runtime = { state: { reports: new Map([
    ['child', { tabId: 7, frameId: 2, documentKey: keys[1] }], ['foreign', { tabId: 8, frameId: 2, documentKey: '8:2:other' }], ['old', { tabId: 7, frameId: 3, documentKey: '7:3:old' }],
  ]) }, getProjection: (_tab, frame) => ({ documentKey: frame === 2 ? keys[1] : frame === 3 ? '7:3:new' : keys[0] }), canObserveNetworkDocument: () => true,
    cookieWriters: { read: async input => { calls.push(input.documentKey); return snapshot(input.documentKey); } } };
  const pro = { runtime, belongsToPage: key => !key.startsWith('8:'), size: () => true, mark() {}, flush: async () => {}, pageById: () => page };
  await captureAdvancedChannels(pro, page, request, { current: () => true }, new Set());
  assert.deepEqual(calls, keys); assert.deepEqual(page.cookieWriters.map(document => document.documentKey), keys);
  assert.notEqual(page.cookieWriters[0].rows[0], row); assert.ok(readAdvancedPageFields(page));
});

test('Pro capture removes a newly retained writer table if consent/current page is lost while flushing', async () => {
  let current = true, flushes = 0; const page = { id: 'page', tabId: 7, documentKey: request.documentKey };
  const runtime = { state: { reports: new Map() }, getProjection: () => ({ documentKey: request.documentKey }), canObserveNetworkDocument: () => true, cookieWriters: { read: async () => snapshot(request.documentKey) } };
  const pro = { runtime, size: () => true, mark() {}, pageById: () => page, flush: async () => { ++flushes; current = false; } };
  await captureAdvancedChannels(pro, page, request, { current: () => current }, new Set());
  assert.equal(Object.hasOwn(page, 'cookieWriters'), false); assert.equal(flushes, 2);
});

test('canonical Pro writer documents reject cross-tab identities, values and false browser attribution', () => {
  const base = { tabId: 7, documentKey: request.documentKey };
  assert.equal(readAdvancedPageFields({ ...base, cookieWriters: [snapshot('8:0:foreign')] }), false);
  for (const patch of [{ value: 'SECRET' }, { evidenceSource: 'browser-network', integrity: 'browser-observed' }]) assert.equal(readAdvancedPageFields({ ...base, cookieWriters: [snapshot(request.documentKey, [{ ...row, ...patch }])] }), false);
});

test('production cookie-writer route rejects content-script/foreign senders and arbitrary caller values', async () => {
  const source = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
  const verifier = source.slice(source.indexOf('function verifyUiSender('), source.indexOf('function redactSenderContext('));
  const handler = source.slice(source.indexOf('async function route(runtime, message, sender)'), source.indexOf('function createMessageListener(runtime)'));
  const origin = 'chrome-extension://fixture', context = vm.createContext({ readCookieWriterRequest, selfOrigin: () => origin, uiError: code => ({ type: 'error', code }) });
  vm.runInContext(verifier + '\n' + handler, context); const calls = [];
  const runtime = { api: { runtime: { id: 'fixture' } }, whenReady: async () => {}, scope: { hasDataConsent: true }, cookieWriters: { read: async input => { calls.push(input); return { type: 'owned' }; } } };
  const sender = { id: 'fixture', origin, url: origin + '/report.html' };
  for (const foreign of [{ ...sender, id: 'foreign' }, { id: 'fixture', origin: 'https://site.example', url: 'https://site.example', tab: { id: 7 }, frameId: 0 }]) assert.equal((await context.route(runtime, request, foreign)).code, 'unauthorized-sender');
  assert.equal((await context.route(runtime, { ...request, value: 'SECRET' }, sender)).code, 'invalid-request');
  assert.equal(calls.length, 0); assert.equal((await context.route(runtime, request, sender)).type, 'owned'); assert.equal(calls.length, 1);
  runtime.scope.hasDataConsent = false; assert.equal((await context.route(runtime, request, sender)).code, 'no-access');
});

test('all review synchronization checks agree without relocating each other’s existing generated blocks', () => {
  for (const script of ['sync-review-surfaces.mjs', 'sync-cookie-writers.mjs', 'sync-review-channels.mjs', 'sync-review-headers.mjs', 'sync-review-ui.mjs', 'sync-advanced-runtime.mjs']) {
    const result = spawnSync(process.execPath, ['scripts/production/' + script, '--check'], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, script + ': ' + result.stdout + result.stderr);
  }
});
