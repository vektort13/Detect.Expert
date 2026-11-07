// Round 3: real Chromium compares the browser's own quota numbers (Custom off) with the Custom snapshot on every surface
// that reports them: StorageManager.estimate, StorageBucket.estimate and the deprecated webkit*Storage objects.
// Usage: node scripts/test/api-custom-storage-surfaces-native.mjs [--chrome]   (--chrome = installed Chrome, default = Playwright Chromium)
// The production installer is serialized exactly like the page bootstrap does. No extension or dist/ build is needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright';
import { pathToFileURL } from 'node:url';
// STORAGE_SURFACES_RUNTIME_SOURCE points at a mutated or older copy of the runtime (deliberate-breakage and before/after runs).
const { installApiCustom } = await import(process.env.STORAGE_SURFACES_RUNTIME_SOURCE ? pathToFileURL(process.env.STORAGE_SURFACES_RUNTIME_SOURCE).href : '../../apps/production-extension/api-custom-runtime.js');

const SELECTED = { quota: 123456789, usage: 4242 };
const installer = installApiCustom.toString();
const useFirefox = process.argv.includes('--firefox');
// Playwright Firefox is pinned to one revision; an older installed revision still speaks the protocol (FIREFOX_BINARY overrides).
async function launchFirefox() {
  try { return await firefox.launch({ headless: true }); }
  catch { return await firefox.launch({ headless: true, executablePath: process.env.FIREFOX_BINARY || join(process.env.LOCALAPPDATA || '', 'ms-playwright/firefox-1538/firefox/firefox.exe') }); }
}
const browser = useFirefox ? await launchFirefox() : await chromium.launch({ headless: true, ...(process.argv.includes('--chrome') ? { channel: 'chrome' } : {}) });
const report = { browser: browser.version(), checks: [] };
const ok = label => { report.checks.push(label); console.log('  ok ' + label); };

async function open(url) {
  const page = await browser.newPage();
  await page.route(url, route => route.fulfill({ body: '<!doctype html><title>Storage surfaces</title>', contentType: 'text/html' }));
  await page.goto(url);
  await page.evaluate(`globalThis.__installer = (${installer})`);
  return page;
}

// Runs in the page. Counting probes sit under the installer, so the original is observed from below.
async function secureProbe(selected) {
  const out = { calls: {}, errors: {}, real: {}, custom: {}, order: {} };
  const count = name => { out.calls[name] = 0; };
  const wrap = (target, key, name, record) => {
    const original = target[key];
    count(name);
    Object.defineProperty(target, key, { value: { [key]() { out.calls[name]++; if (record) record(this); return Reflect.apply(original, this, arguments); } }[key], configurable: true, writable: true, enumerable: true });
    return original;
  };
  const describe = error => error && typeof error === 'object' ? { name: error.name, message: error.message, ctor: error.constructor === TypeError } : { primitive: String(error) };
  const trial = fn => { try { return { returned: fn() }; } catch (error) { return { thrown: describe(error) }; } };
  const settle = async promise => { try { return { value: await promise }; } catch (error) { return { rejected: describe(error) }; } };
  const tasks = () => new Promise(resolve => setTimeout(resolve, 25));
  const quotaObject = navigator.webkitTemporaryStorage;
  const quotaPrototype = Object.getPrototypeOf(quotaObject);
  const bucketA = await navigator.storageBuckets.open('probe-a');
  const bucketQ = await navigator.storageBuckets.open('probe-q', { quota: 1048576 });
  const sentinels = [];
  wrap(StorageManager.prototype, 'estimate', 'managerEstimate', receiver => sentinels.push(['manager', receiver]));
  wrap(StorageBucket.prototype, 'estimate', 'bucketEstimate', receiver => sentinels.push(['bucket', receiver]));
  wrap(quotaPrototype, 'queryUsageAndQuota', 'legacyQuery', receiver => sentinels.push(['query', receiver]));
  wrap(quotaPrototype, 'requestQuota', 'legacyRequest', receiver => sentinels.push(['request', receiver]));
  const legacyQuery = target => new Promise(resolve => {
    const state = { sync: true };
    target.queryUsageAndQuota(function () { 'use strict'; resolve({ args: Array.from(arguments), thisUndefined: this === undefined, sync: state.sync }); });
    state.sync = false;
  });
  const legacyRequest = (target, size) => new Promise(resolve => target.requestQuota(size, function () { 'use strict'; resolve({ args: Array.from(arguments), thisUndefined: this === undefined }); }));
  const surfaces = async () => {
    const estimate = await navigator.storage.estimate(), bucket = await bucketA.estimate(), withQuota = await bucketQ.estimate();
    return {
      estimate: [estimate.quota, estimate.usage, Object.keys(estimate).join()],
      bucket: [bucket.quota, bucket.usage, Object.keys(bucket).join()],
      bucketWithQuota: [withQuota.quota, withQuota.usage],
      temporary: (await legacyQuery(navigator.webkitTemporaryStorage)).args,
      persistent: (await legacyQuery(navigator.webkitPersistentStorage)).args,
      requestHuge: (await legacyRequest(navigator.webkitTemporaryStorage, 2 ** 53)).args,
      requestSmall: (await legacyRequest(navigator.webkitPersistentStorage, 1024)).args
    };
  };
  const foreign = async () => {
    const results = {};
    const q = quotaPrototype.queryUsageAndQuota, r = quotaPrototype.requestQuota, e = StorageBucket.prototype.estimate, m = StorageManager.prototype.estimate;
    const noop = () => {};
    for (const [label, receiver] of Object.entries({ plain: {}, nul: null, undef: undefined, number: 3, manager: navigator.storage, bucket: bucketA, quotaObject, proxyOfBucket: new Proxy(bucketA, {}), proxyOfQuota: new Proxy(quotaObject, {}), derived: Object.create(bucketA) })) {
      results['query:' + label] = receiver === quotaObject ? 'genuine' : trial(() => Reflect.apply(q, receiver, [noop]));
      results['request:' + label] = receiver === quotaObject ? 'genuine' : trial(() => Reflect.apply(r, receiver, [1, noop]));
      results['bucket:' + label] = receiver === bucketA ? 'genuine' : await settle(Reflect.apply(e, receiver, []));
      results['manager:' + label] = receiver === navigator.storage ? 'genuine' : await settle(Reflect.apply(m, receiver, []));
    }
    const bad = {
      'query()': () => quotaObject.queryUsageAndQuota(), 'query(1)': () => quotaObject.queryUsageAndQuota(1), 'query(null)': () => quotaObject.queryUsageAndQuota(null),
      'query(undefined)': () => quotaObject.queryUsageAndQuota(undefined), 'query({})': () => quotaObject.queryUsageAndQuota({}), 'query(proxyObject)': () => quotaObject.queryUsageAndQuota(new Proxy({}, {})),
      'query(noop,1)': () => quotaObject.queryUsageAndQuota(noop, 1), 'query(1,noop)': () => quotaObject.queryUsageAndQuota(1, noop), 'query(noop,null)': () => quotaObject.queryUsageAndQuota(noop, null),
      'query(noop,undefined)': () => quotaObject.queryUsageAndQuota(noop, undefined), 'query(class)': () => quotaObject.queryUsageAndQuota(class {}), 'query(proxyFunction)': () => quotaObject.queryUsageAndQuota(new Proxy(noop, {})),
      'query(document.all)': () => quotaObject.queryUsageAndQuota(document.all), 'query(noop,noop,extra)': () => quotaObject.queryUsageAndQuota(noop, noop, 1, 2),
      'request()': () => quotaObject.requestQuota(), 'request(1,1)': () => quotaObject.requestQuota(1, 1), 'request(1,noop,1)': () => quotaObject.requestQuota(1, noop, 1),
      'request(1,null,null)': () => quotaObject.requestQuota(1, null, null), 'request(1n)': () => quotaObject.requestQuota(1n, noop), 'request(Symbol)': () => quotaObject.requestQuota(Symbol('x'), noop),
      'request(1,noop) tail': () => quotaObject.requestQuota(1), 'new query': () => new quotaObject.queryUsageAndQuota()
    };
    for (const [label, call] of Object.entries(bad)) results[label] = trial(call);
    let valueOf = 0;
    results.valueOfOrder = trial(() => quotaObject.requestQuota({ valueOf() { valueOf++; return 5; } }, 5));
    results.valueOfCountOnBadCallback = valueOf;
    return results;
  };
  const conversions = async () => {
    const cases = { zero: 0, one: 1, k: 1024, fraction: 1.9, minusOne: -1, minusHalf: -0.5, nan: NaN, inf: Infinity, minusInf: -Infinity, text: '5', junk: 'abc', nul: null, undef: undefined, yes: true,
      big: 2 ** 33, selectedQuota: selected.quota, over: selected.quota + 1, p53: 2 ** 53, p63: 2 ** 63, p64: 2 ** 64, p64plus: 2 ** 64 + 4096, minusP64: -(2 ** 64), minusP64plus: -(2 ** 64 - 2048), huge: 1e20,
      array: [7], object: {}, belowQuota: 1000 };
    const results = {};
    for (const [label, size] of Object.entries(cases)) results[label] = (await legacyRequest(navigator.webkitTemporaryStorage, size)).args[0];
    let calls = 0; results.valueOf = (await legacyRequest(navigator.webkitTemporaryStorage, { valueOf() { calls++; return 9; } })).args[0]; results.valueOfCalls = calls;
    return results;
  };
  const ordering = async () => {
    const histogram = {}, after = {};
    for (let index = 0; index < 100; index++) {
      for (const queued of [true, false]) {
        const order = [];
        await new Promise(resolve => {
          let pending = 3; const done = () => { if (--pending === 0) resolve(); };
          const channel = new MessageChannel(); channel.port1.onmessage = () => { order.push('M'); channel.port1.close(); done(); };
          const queue = () => { setTimeout(() => { order.push('T'); done(); }, 0); channel.port2.postMessage(1); };
          if (queued) queue();
          navigator.webkitTemporaryStorage.queryUsageAndQuota(() => { order.push('Q'); done(); });
          if (!queued) queue();
        });
        const key = order.join(''), table = queued ? histogram : after; table[key] = (table[key] || 0) + 1;
      }
    }
    let micro = 0; const chain = []; const task = new Promise(resolve => navigator.webkitTemporaryStorage.queryUsageAndQuota(() => { chain.push('callback'); resolve(); }));
    Promise.resolve().then(() => chain.push('m1')).then(() => chain.push('m2')).then(() => chain.push('m3')).then(() => chain.push('m4')).then(() => chain.push('m5'));
    const idA = setTimeout(() => {}, 0); navigator.webkitTemporaryStorage.queryUsageAndQuota(() => {}); const idB = setTimeout(() => {}, 0);
    await task; await tasks();
    return { histogram, after, chain, timerIdDelta: idB - idA, micro };
  };
  const reported = async () => {
    const events = [], handler = event => { events.push(event.message); event.preventDefault(); };
    addEventListener('error', handler);
    let failureCallbacks = 0;
    await new Promise(resolve => { navigator.webkitTemporaryStorage.queryUsageAndQuota(() => { setTimeout(resolve, 40); throw new RangeError('boom'); }, () => { failureCallbacks++; }); });
    await new Promise(resolve => { navigator.webkitTemporaryStorage.requestQuota(5, () => { setTimeout(resolve, 40); throw new RangeError('boom2'); }, () => { failureCallbacks++; }); });
    removeEventListener('error', handler);
    return { events, failureCallbacks };
  };
  out.real = await surfaces();
  out.errors.real = await foreign();
  await tasks();
  out.reported = { real: await reported() };
  out.conversionsReal = await conversions();
  out.order.real = await ordering();
  const before = { ...out.calls };
  out.beforeStats = { descriptors: {
    estimate: Object.getOwnPropertyDescriptor(StorageBucket.prototype, 'estimate'), query: Object.getOwnPropertyDescriptor(quotaPrototype, 'queryUsageAndQuota'),
    accessorTemporary: Object.getOwnPropertyDescriptor(Navigator.prototype, 'webkitTemporaryStorage'), accessorPersistent: Object.getOwnPropertyDescriptor(Navigator.prototype, 'webkitPersistentStorage') } };
  const identity = { query: quotaPrototype.queryUsageAndQuota, request: quotaPrototype.requestQuota, bucket: StorageBucket.prototype.estimate, manager: StorageManager.prototype.estimate };
  // Install Custom.
  for (const key of Object.keys(out.calls)) out.calls[key] = 0;
  sentinels.length = 0;
  const guard = globalThis.__installer(globalThis, [{ id: 'storage-estimate', mode: 'custom', value: selected }]);
  out.afterInstall = { installed: guard.snapshot().installed, unavailable: guard.snapshot().unavailable,
    queryIsStillProbe: quotaPrototype.queryUsageAndQuota === identity.query, bucketIsStillProbe: StorageBucket.prototype.estimate === identity.bucket };
  const sameObjectTemporary = navigator.webkitTemporaryStorage === quotaObject && navigator.webkitPersistentStorage === navigator.webkitTemporaryStorage;
  out.afterInstall.afterFirstAccess = { queryWrapped: quotaPrototype.queryUsageAndQuota !== identity.query, requestWrapped: quotaPrototype.requestQuota !== identity.request, installed: guard.snapshot().installed, sameObjectTemporary };
  const installedAfterAccess = guard.snapshot().installed;
  for (let index = 0; index < 5; index++) { navigator.webkitTemporaryStorage; navigator.webkitPersistentStorage; }
  out.afterInstall.installedStable = guard.snapshot().installed === installedAfterAccess;
  out.custom = await surfaces();
  out.callsAfterSurfaces = { ...out.calls };
  // The task channel belongs to the installer: page spies on the global channel and the message port see none of its traffic.
  {
    let spied = 0, windowMessages = 0;
    const listener = () => { windowMessages++; }; addEventListener('message', listener);
    const savedChannel = globalThis.MessageChannel, savedPost = MessagePort.prototype.postMessage, savedClose = MessagePort.prototype.close;
    globalThis.MessageChannel = function () { spied++; throw new Error('page channel'); };
    MessagePort.prototype.postMessage = function () { spied++; return Reflect.apply(savedPost, this, arguments); };
    MessagePort.prototype.close = function () { spied++; return Reflect.apply(savedClose, this, arguments); };
    const answers = [(await legacyQuery(navigator.webkitTemporaryStorage)).args, (await legacyRequest(navigator.webkitTemporaryStorage, 7)).args];
    await tasks();
    globalThis.MessageChannel = savedChannel; MessagePort.prototype.postMessage = savedPost; MessagePort.prototype.close = savedClose; removeEventListener('message', listener);
    out.spies = { spied, windowMessages, answers };
  }
  out.errors.custom = await foreign();
  out.callsAfterForeign = { ...out.calls };
  out.sentinels = sentinels.map(([kind, receiver]) => [kind, receiver === null || typeof receiver !== 'object' ? 'primitive' : Object.getPrototypeOf(receiver) === null && Object.isFrozen(receiver) ? 'sentinel' : 'other']);
  for (const key of Object.keys(out.calls)) out.calls[key] = 0;
  await tasks();
  out.reported.custom = await reported();
  out.conversionsCustom = await conversions();
  out.order.custom = await ordering();
  out.callsAfterConversions = { ...out.calls };
  out.descriptors = {
    estimate: (({ writable, enumerable, configurable }) => ({ writable, enumerable, configurable }))(Object.getOwnPropertyDescriptor(StorageBucket.prototype, 'estimate')),
    query: (({ writable, enumerable, configurable }) => ({ writable, enumerable, configurable }))(Object.getOwnPropertyDescriptor(quotaPrototype, 'queryUsageAndQuota')),
    realEstimate: (({ writable, enumerable, configurable }) => ({ writable, enumerable, configurable }))(out.beforeStats.descriptors.estimate),
    realQuery: (({ writable, enumerable, configurable }) => ({ writable, enumerable, configurable }))(out.beforeStats.descriptors.query),
    accessor: (({ enumerable, configurable }) => ({ enumerable, configurable }))(Object.getOwnPropertyDescriptor(Navigator.prototype, 'webkitTemporaryStorage')),
    realAccessor: (({ enumerable, configurable }) => ({ enumerable, configurable }))(out.beforeStats.descriptors.accessorTemporary),
    wrapperHasPrototype: 'prototype' in quotaPrototype.queryUsageAndQuota, bucketWrapperHasPrototype: 'prototype' in StorageBucket.prototype.estimate,
    ownKeysOfQuotaObject: Reflect.ownKeys(quotaObject).length, tag: Object.prototype.toString.call(quotaObject) };
  // Stop: native behavior returns.
  const wrappersQuery = quotaPrototype.queryUsageAndQuota, wrappersBucket = StorageBucket.prototype.estimate;
  const pending = legacyQuery(navigator.webkitTemporaryStorage);
  guard.stop();
  out.afterStop = { queryIsProbe: quotaPrototype.queryUsageAndQuota === identity.query, bucketIsProbe: StorageBucket.prototype.estimate === identity.bucket, managerIsProbe: StorageManager.prototype.estimate === identity.manager,
    scheduledSurvives: (await pending).args };
  for (const key of Object.keys(out.calls)) out.calls[key] = 0;
  const retained = await new Promise(resolve => wrappersQuery.call(navigator.webkitTemporaryStorage, (usage, quota) => resolve([usage, quota])));
  const retainedBucket = await wrappersBucket.call(bucketA);
  out.afterStop.retained = { query: retained, bucket: [retainedBucket.quota, retainedBucket.usage], calls: { ...out.calls } };
  out.afterStop.real = await surfaces();
  out.before = before;
  delete out.beforeStats;
  return out;
}

async function run() {
  console.log('Browser ' + report.browser);
  const page = await open('https://quota-measure.invalid/');
  const out = await page.evaluate(secureProbe, SELECTED);
  const real = out.real;
  // Real browser numbers are the control: they must differ from the selection, otherwise the comparison proves nothing.
  assert.notEqual(real.estimate[0], SELECTED.quota); assert.notEqual(real.estimate[1], SELECTED.quota);
  assert.deepEqual(real.temporary, [real.estimate[1], real.estimate[0]], 'real legacy temporary = (usage, quota) of estimate');
  assert.deepEqual(real.persistent, real.temporary, 'real persistent storage reports the temporary numbers (same object in Chromium)');
  assert.equal(real.requestHuge[0], real.estimate[0], 'real requestQuota(2**53) leaks the real quota');
  ok('control: real estimate, bucket, temporary, persistent and requestQuota(huge) report the same browser quota ' + real.estimate[0]);
  assert.equal(real.bucketWithQuota[0], 1048576, 'explicit bucket quota option is visible natively');
  const snapshot = [SELECTED.quota, SELECTED.usage];
  const custom = out.custom;
  // ADR-107: the Chromium dictionary shape (quota, usage, usageDetails) is kept, exactly like the real keys measured above.
  assert.equal(real.estimate[2], 'quota,usage,usageDetails');
  assert.deepEqual(custom.estimate, [...snapshot, real.estimate[2]]);
  assert.deepEqual(custom.bucket, [...snapshot, real.bucket[2]]);
  assert.deepEqual(custom.bucketWithQuota, snapshot);
  assert.deepEqual(custom.temporary, [SELECTED.usage, SELECTED.quota]);
  assert.deepEqual(custom.persistent, [SELECTED.usage, SELECTED.quota]);
  assert.deepEqual(custom.requestHuge, [SELECTED.quota]);
  assert.deepEqual(custom.requestSmall, [1024]);
  ok('Custom: estimate, bucket (default and explicit-quota), temporary, persistent and requestQuota all report the selected snapshot');
  assert.equal(out.callsAfterSurfaces.managerEstimate, 0); assert.equal(out.callsAfterSurfaces.bucketEstimate, 0);
  assert.equal(out.callsAfterSurfaces.legacyQuery, 0); assert.equal(out.callsAfterSurfaces.legacyRequest, 0);
  ok('Custom: no genuine receiver reaches the original (0 native calls on all four operations)');
  assert.deepEqual(out.spies, { spied: 0, windowMessages: 0, answers: [[SELECTED.usage, SELECTED.quota], [7]] });
  ok('the private task channel is invisible: replaced MessageChannel/postMessage/close and window message listeners are never touched');
  assert.equal(out.afterInstall.queryIsStillProbe, true, 'install alone does not touch the legacy prototype (no instance exists yet)');
  assert.equal(out.afterInstall.afterFirstAccess.queryWrapped, true); assert.equal(out.afterInstall.afterFirstAccess.requestWrapped, true);
  assert.equal(out.afterInstall.installedStable, true, 'repeated accessor reads never wrap the prototype again');
  ok('legacy prototype is hooked once, from the first accessor read, and never twice');
  assert.deepEqual(out.errors.custom, out.errors.real, 'foreign receivers and bad arguments produce the exact native errors/rejections');
  ok('foreign receivers, bad callbacks and conversion errors are byte-identical to the native results (' + Object.keys(out.errors.real).length + ' cases)');
  assert.equal(out.errors.real['query:plain'].thrown.message, 'Illegal invocation');
  assert.equal(out.errors.real['bucket:plain'].rejected.message, "Failed to execute 'estimate' on 'StorageBucket': Illegal invocation");
  assert.equal(out.errors.real['query(1)'].thrown.message, "Failed to execute 'queryUsageAndQuota' on 'DeprecatedStorageQuota': parameter 1 is not of type 'Function'.");
  assert.equal(out.errors.real['query(noop,null)'].returned, undefined); assert.equal(out.errors.real['query(document.all)'].returned, undefined);
  const callsAfterForeign = out.callsAfterForeign;
  // Unknown receivers reach the original exactly once each, and only as the private sentinel; the only live object that reaches it is
  // the genuine quota object whose arguments the original must reject itself (it throws before any quota work).
  const shapes = kind => out.sentinels.filter(entry => entry[0] === kind);
  const delegated = Object.entries(out.errors.custom).filter(([label, result]) => result && result.thrown && !/^(query|request|bucket|manager):/.test(label) && label !== 'new query').length;
  assert.equal(out.sentinels.filter(([, shape]) => shape === 'sentinel').length, 36, '9 unknown receivers x 4 operations');
  assert.equal(out.sentinels.filter(([, shape]) => shape === 'primitive').length, 0, 'a primitive receiver is replaced by the sentinel too');
  assert.equal(out.sentinels.filter(([, shape]) => shape === 'other').length, delegated, 'only argument-error delegations carry the genuine quota object');
  assert.equal(shapes('bucket').every(([, shape]) => shape === 'sentinel'), true); assert.equal(shapes('manager').every(([, shape]) => shape === 'sentinel'), true);
  ok('unknown receivers reach the original with the private sentinel only (' + JSON.stringify(callsAfterForeign) + ')');
  assert.deepEqual(out.reported.custom, out.reported.real, 'a throwing callback is reported as an uncaught error exactly like the native task, and the error callback stays silent');
  assert.deepEqual(out.reported.real.events, ['Uncaught RangeError: boom', 'Uncaught RangeError: boom2']); assert.equal(out.reported.real.failureCallbacks, 0);
  ok('a throwing success callback surfaces as the same uncaught error event as natively; the error callback is never called');
  assert.deepEqual(out.conversionsCustom.valueOfCalls, 1); assert.equal(out.conversionsCustom.valueOf, 9);
  for (const [label, grantedReal] of Object.entries(out.conversionsReal)) {
    if (label === 'valueOfCalls' || label === 'valueOf') continue;
    const expected = Math.min(grantedReal, SELECTED.quota);
    // Real: min(request, realQuota). Custom: min(request, selectedQuota). The request itself is recovered when it is below both.
    const realQuota = real.estimate[0];
    const converted = grantedReal >= realQuota ? Infinity : grantedReal;
    assert.equal(out.conversionsCustom[label], Math.min(converted, SELECTED.quota), 'requestQuota conversion ' + label);
  }
  ok('requestQuota: every WebIDL unsigned long long conversion case equals min(native-converted request, selected quota); valueOf runs exactly once');
  assert.ok(Object.keys(out.order.custom.histogram).length > 0);
  report.order = { real: out.order.real.histogram, custom: out.order.custom.histogram, realAfterCall: out.order.real.after, customAfterCall: out.order.custom.after, realChain: out.order.real.chain, customChain: out.order.custom.chain, timerIdDelta: { real: out.order.real.timerIdDelta, custom: out.order.custom.timerIdDelta } };
  // Native invariant (measured): the callback comes last when the page queues a timer and a message in the same turn, before or after the call.
  for (const [label, table] of Object.entries({ realQueuedFirst: out.order.real.histogram, realQueuedAfter: out.order.real.after, customQueuedFirst: out.order.custom.histogram, customQueuedAfter: out.order.custom.after })) {
    const last = Object.entries(table).filter(([key]) => key.endsWith('Q')).reduce((sum, [, count]) => sum + count, 0);
    assert.ok(last >= 95, label + ' (callback last in >= 95 of 100 runs) ' + JSON.stringify(table));
  }
  assert.deepEqual(out.order.custom.chain.slice(0, 5), ['m1', 'm2', 'm3', 'm4', 'm5'], 'the callback is never delivered inside the microtask chain');
  assert.equal(out.order.custom.timerIdDelta, 1, 'delivery does not allocate a timer id');
  ok('task delivery: callback after the 5-step microtask chain, no timer id allocated; order histogram real=' + JSON.stringify(out.order.real.histogram) + ' custom=' + JSON.stringify(out.order.custom.histogram));
  assert.deepEqual(out.descriptors.estimate, out.descriptors.realEstimate); assert.deepEqual(out.descriptors.query, out.descriptors.realQuery); assert.deepEqual(out.descriptors.accessor, out.descriptors.realAccessor);
  assert.equal(out.descriptors.wrapperHasPrototype, false); assert.equal(out.descriptors.bucketWrapperHasPrototype, false);
  assert.equal(out.descriptors.ownKeysOfQuotaObject, 0); assert.equal(out.descriptors.tag, '[object DeprecatedStorageQuota]');
  ok('descriptors keep native writable/enumerable/configurable; wrappers are non-constructors; the quota object gains no own properties');
  assert.equal(out.afterStop.queryIsProbe, true); assert.equal(out.afterStop.bucketIsProbe, true); assert.equal(out.afterStop.managerIsProbe, true);
  assert.deepEqual(out.afterStop.scheduledSurvives, [SELECTED.usage, SELECTED.quota], 'a callback scheduled before stop keeps the selected snapshot');
  assert.deepEqual(out.afterStop.retained.query, [real.temporary[0], real.temporary[1]], 'retained wrapper delegates to the native after stop');
  assert.equal(out.afterStop.retained.calls.legacyQuery, 1); assert.equal(out.afterStop.retained.calls.bucketEstimate, 1);
  assert.deepEqual(out.afterStop.real.estimate.slice(0, 2), real.estimate.slice(0, 2));
  ok('stop restores every owned descriptor; retained wrappers delegate once; a pending virtual callback survives');
  await page.close();
  return out;
}

async function child() {
  const page = await open('https://quota-measure.invalid/');
  const out = await page.evaluate(async selected => {
    const frame = document.createElement('iframe'); document.body.append(frame);
    const view = frame.contentWindow;
    const guard = globalThis.__installer(globalThis, [{ id: 'storage-estimate', mode: 'custom', value: selected }]);
    const childGuard = globalThis.__installer(view, [{ id: 'storage-estimate', mode: 'custom', value: selected }]);
    const result = {};
    const trial = fn => { try { return fn(); } catch (error) { return { ctor: error.constructor === view.TypeError ? 'child' : error.constructor === TypeError ? 'parent' : 'other', message: error.message }; } };
    result.childBadCallback = trial(() => view.navigator.webkitTemporaryStorage.queryUsageAndQuota(1));
    result.childLegacy = await new Promise(resolve => view.navigator.webkitTemporaryStorage.queryUsageAndQuota((usage, quota) => resolve([usage, quota])));
    const childBucket = await view.navigator.storageBuckets.open('child');
    const estimate = childBucket.estimate();
    result.childPromise = Object.getPrototypeOf(estimate) === view.Promise.prototype;
    const value = await estimate;
    result.childBucket = [value.quota, value.usage, Object.getPrototypeOf(value) === view.Object.prototype];
    // Borrowed calls between windows use the method's realm for the answer.
    const parentBucket = await navigator.storageBuckets.open('parent');
    const borrowed = view.StorageBucket.prototype.estimate.call(parentBucket);
    result.borrowedPromise = Object.getPrototypeOf(borrowed) === view.Promise.prototype;
    result.borrowedValue = (await borrowed).quota;
    result.borrowedLegacy = await new Promise(resolve => view.Navigator.prototype.__lookupGetter__('webkitTemporaryStorage').call(navigator).queryUsageAndQuota((usage, quota) => resolve([usage, quota])));
    const parentQuota = navigator.webkitTemporaryStorage;
    result.borrowedQuotaObject = await new Promise(resolve => Object.getPrototypeOf(view.navigator.webkitTemporaryStorage).queryUsageAndQuota.call(parentQuota, (usage, quota) => resolve([usage, quota])));
    result.snapshot = { parent: guard.snapshot().unavailable, child: childGuard.snapshot().unavailable };
    childGuard.stop(); guard.stop();
    return result;
  }, SELECTED);
  assert.equal(out.childBadCallback.ctor, 'child', 'the native TypeError of the child realm is thrown');
  assert.deepEqual(out.childLegacy, [SELECTED.usage, SELECTED.quota]);
  assert.equal(out.childPromise, true); assert.deepEqual(out.childBucket, [SELECTED.quota, SELECTED.usage, true]);
  assert.equal(out.borrowedPromise, true); assert.equal(out.borrowedValue, SELECTED.quota);
  assert.deepEqual(out.borrowedLegacy, [SELECTED.usage, SELECTED.quota]); assert.deepEqual(out.borrowedQuotaObject, [SELECTED.usage, SELECTED.quota]);
  ok('same-origin child realm: native child TypeError, child Promise/dictionary, borrowed bucket and quota-object calls answer with the selected snapshot');
  await page.close();
}

async function insecure() {
  const page = await open('http://quota-measure.invalid/');
  const out = await page.evaluate(async selected => {
    const result = { storage: typeof navigator.storage, buckets: typeof navigator.storageBuckets, bucketCtor: typeof StorageBucket };
    result.real = await new Promise(resolve => navigator.webkitTemporaryStorage.queryUsageAndQuota((usage, quota) => resolve([usage, quota])));
    const guard = globalThis.__installer(globalThis, [{ id: 'storage-estimate', mode: 'custom', value: selected }]);
    result.custom = await new Promise(resolve => navigator.webkitPersistentStorage.queryUsageAndQuota((usage, quota) => resolve([usage, quota])));
    result.granted = await new Promise(resolve => navigator.webkitTemporaryStorage.requestQuota(2 ** 53, resolve));
    result.snapshot = { installed: guard.snapshot().installed, unavailable: guard.snapshot().unavailable };
    guard.stop();
    return result;
  }, SELECTED);
  assert.deepEqual([out.storage, out.buckets, out.bucketCtor], ['undefined', 'undefined', 'undefined']);
  assert.notEqual(out.real[1], SELECTED.quota); assert.deepEqual(out.custom, [SELECTED.usage, SELECTED.quota]); assert.equal(out.granted, SELECTED.quota);
  assert.equal(out.snapshot.unavailable, 1, 'only the absent StorageManager is reported');
  ok('insecure context (no StorageManager/buckets): the deprecated API alone is virtualized; the missing StorageManager is the only unavailable item');
  await page.close();
}

async function documentAll() {
  const page = await open('https://quota-measure.invalid/');
  const out = await page.evaluate(async selected => {
    // A counting probe under the installer shows whether the original is ever reached.
    const prototype = Object.getPrototypeOf(navigator.webkitTemporaryStorage), reached = [];
    for (const key of ['queryUsageAndQuota', 'requestQuota']) {
      const original = prototype[key];
      Object.defineProperty(prototype, key, { value: { [key]() { reached.push(key); return Reflect.apply(original, this, arguments); } }[key], configurable: true, writable: true, enumerable: true });
    }
    const guard = globalThis.__installer(globalThis, [{ id: 'storage-estimate', mode: 'custom', value: selected }]);
    // document.all is callable although typeof is "undefined": the native API accepts it, so the wrapper must too.
    const errors = [];
    const attempt = fn => { try { fn(); } catch (error) { errors.push(error.message); } };
    attempt(() => navigator.webkitTemporaryStorage.queryUsageAndQuota(document.all));
    attempt(() => navigator.webkitTemporaryStorage.requestQuota(5, document.all));
    attempt(() => navigator.webkitTemporaryStorage.queryUsageAndQuota(document.all, document.all));
    await new Promise(resolve => setTimeout(resolve, 30));
    guard.stop();
    return { typeofAll: typeof document.all, reached, errors };
  }, SELECTED);
  assert.equal(out.typeofAll, 'undefined');
  assert.deepEqual(out.reached, [], 'document.all is a valid callback: nothing reaches the original');
  assert.deepEqual(out.errors, []);
  ok('document.all (IsHTMLDDA) is accepted as a callback without reaching the original or throwing');
  await page.close();
}

async function worker() {
  // A dedicated worker has StorageManager and StorageBucket but no deprecated quota API: the bucket and manager are virtual there too.
  const page = await open('https://quota-measure.invalid/');
  const out = await page.evaluate(async ([installerText, selected]) => {
    const code = '(async () => { const install = (' + installerText + ');' +
      'const real = await (await (await navigator.storageBuckets.open("w")).estimate()); const realManager = await navigator.storage.estimate();' +
      'const guard = install(self, [{ id: "storage-estimate", mode: "custom", value: ' + JSON.stringify(selected) + ' }]);' +
      'const bucket = await (await navigator.storageBuckets.open("w")).estimate(), manager = await navigator.storage.estimate();' +
      'const snapshot = guard.snapshot(); guard.stop();' +
      'const after = await (await navigator.storageBuckets.open("w")).estimate();' +
      'postMessage({ real: [real.quota, realManager.quota], bucket: [bucket.quota, bucket.usage], manager: [manager.quota, manager.usage], installed: snapshot.installed, unavailable: snapshot.unavailable, after: after.quota, legacy: typeof navigator.webkitTemporaryStorage }); })();';
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    return await new Promise(resolve => { const w = new Worker(url); w.onmessage = event => { resolve(event.data); w.terminate(); }; w.onerror = event => resolve({ error: event.message }); setTimeout(() => resolve({ timeout: true }), 8000); });
  }, [installer, SELECTED]);
  assert.equal(out.legacy, 'undefined');
  assert.deepEqual(out.bucket, [SELECTED.quota, SELECTED.usage]); assert.deepEqual(out.manager, [SELECTED.quota, SELECTED.usage]);
  assert.equal(out.after, out.real[0]); assert.equal(out.unavailable, 0);
  ok('dedicated worker realm: StorageBucket and StorageManager are virtual, nothing is reported unavailable, stop restores the native bucket (' + out.installed + ' handles)');
  await page.close();
}

async function opaque() {
  // An inaccessible (opaque-origin) realm gets the generated neutral guard before page code, exactly like the extension injects it.
  const bundle = readFileSync(new URL('../../apps/production-extension/api-custom-opaque.storage-estimate.js', import.meta.url), 'utf8');
  const probe = `(async () => {
    const out = { protocol: location.protocol, secure: isSecureContext };
    const settle = async (label, run) => { try { out[label] = await Promise.race([run(), new Promise(resolve => setTimeout(() => resolve('pending'), 1500))]); } catch (error) { out[label] = 'error:' + (error && error.name); } };
    await settle('estimate', async () => { const value = await navigator.storage.estimate(); return [value.quota, value.usage]; });
    await settle('bucket', async () => { const bucket = await navigator.storageBuckets.open('x'); const value = await bucket.estimate(); return [value.quota, value.usage]; });
    await settle('temporary', () => new Promise((resolve, reject) => navigator.webkitTemporaryStorage.queryUsageAndQuota((usage, quota) => resolve([quota, usage]), reject)));
    await settle('persistent', () => new Promise((resolve, reject) => navigator.webkitPersistentStorage.queryUsageAndQuota((usage, quota) => resolve([quota, usage]), reject)));
    await settle('request', () => new Promise(resolve => navigator.webkitTemporaryStorage.requestQuota(2 ** 53, resolve)));
    parent.postMessage({ channel: 'quota-opaque', out }, '*');
  })();`;
  const page = await open('https://quota-measure.invalid/');
  const frames = await page.evaluate(async ([bundleText, probeText]) => {
    const frame = (label, source) => new Promise(resolve => {
      const element = document.createElement('iframe'); element.setAttribute('sandbox', 'allow-scripts');
      const listener = event => { if (event.data && event.data.channel === 'quota-opaque' && event.source === element.contentWindow) { removeEventListener('message', listener); resolve(event.data.out); } };
      addEventListener('message', listener);
      element.srcdoc = '<!doctype html><script>' + source.split('</script').join('<\\/script') + '</script>';
      document.body.append(element);
      setTimeout(() => resolve({ timeout: label }), 8000);
    });
    return { control: await frame('control', probeText), guarded: await frame('guarded', bundleText + ';\n' + probeText) };
  }, [bundle, probe]);
  report.opaque = frames;
  assert.equal(frames.control.protocol, 'about:'); assert.equal(frames.guarded.protocol, 'about:');
  assert.deepEqual(frames.guarded.estimate, [0, 0]);
  assert.ok(frames.guarded.bucket === 'error:SecurityError' || JSON.stringify(frames.guarded.bucket) === '[0,0]', 'an opaque origin cannot open buckets natively; if it could, the answer is 0/0');
  assert.deepEqual(frames.guarded.temporary, [0, 0]); assert.deepEqual(frames.guarded.persistent, [0, 0]); assert.equal(frames.guarded.request, 0);
  ok('opaque sandboxed srcdoc realm: the generated guard answers 0/0 on estimate, bucket, temporary, persistent and requestQuota (control realm without guard: ' + JSON.stringify(frames.control) + ')');
  await page.close();
}

async function firefoxScenario() {
  // Firefox has neither StorageBucket nor the deprecated quota API: only StorageManager.estimate is hooked and nothing is reported missing.
  const page = await open('https://quota-measure.invalid/');
  const out = await page.evaluate(async selected => {
    const result = { bucket: typeof StorageBucket, legacy: typeof navigator.webkitTemporaryStorage };
    result.real = (await navigator.storage.estimate()).quota;
    const guard = globalThis.__installer(globalThis, [{ id: 'storage-estimate', mode: 'custom', value: selected }]);
    const value = await navigator.storage.estimate();
    result.custom = [value.quota, value.usage, Object.keys(value).join()];
    result.snapshot = { installed: guard.snapshot().installed, unavailable: guard.snapshot().unavailable };
    guard.stop();
    result.restored = (await navigator.storage.estimate()).quota === result.real;
    return result;
  }, SELECTED);
  assert.deepEqual([out.bucket, out.legacy], ['undefined', 'undefined']);
  assert.deepEqual(out.custom, [SELECTED.quota, SELECTED.usage, 'quota,usage']);
  assert.deepEqual(out.snapshot, { installed: 3, unavailable: 0 }, 'estimate, Navigator.storage getter and the passive Window.open hint, exactly as before the round-3 change');
  assert.equal(out.restored, true);
  ok('Firefox: StorageManager.estimate keeps the ADR-085 behavior with the same 3 handles as before; absent StorageBucket/deprecated API install nothing and report nothing unavailable');
  await page.close();
}

try { if (useFirefox) await firefoxScenario(); else { await run(); await child(); await insecure(); await documentAll(); await worker(); await opaque(); } report.result = 'PASS'; }
catch (error) { report.result = 'FAIL'; console.error(error); process.exitCode = 1; }
finally { await browser.close(); console.log(JSON.stringify({ browser: report.browser, result: report.result, checks: report.checks.length, order: report.order, opaque: report.opaque }, null, 1)); }
