// Round 3: StorageBucket.estimate and the deprecated webkit*Storage objects report the same quota numbers as
// StorageManager.estimate, so `storage-estimate: Custom` must answer them from the selected snapshot too.
// Synthetic vm realms mimic Chromium (measured on 153 and 156): every brand, error text and value below is a mock.
// STORAGE_SURFACES_RUNTIME_SOURCE points the suite at a mutated copy of the runtime (deliberate-breakage runs).
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const sourceUrl = process.env.STORAGE_SURFACES_RUNTIME_SOURCE ? pathToFileURL(process.env.STORAGE_SURFACES_RUNTIME_SOURCE) : new URL('../../apps/production-extension/api-custom-runtime.js', import.meta.url);
const installerSource = readFileSync(sourceUrl, 'utf8').replace(/^export /m, '');
const SELECTED = { quota: 1024, usage: 12 };
const entry = (mode = 'custom', value = SELECTED) => [{ id: 'storage-estimate', mode, value }];
const flush = async (turns = 4) => { for (let index = 0; index < turns; index++) await new Promise(resolve => setImmediate(resolve)); };
const drainMicrotasks = async (turns = 40) => { for (let index = 0; index < turns; index++) await Promise.resolve(); };

function brandSet() {
  return { buckets: new WeakSet(), quotaObjects: new WeakSet(), managers: new WeakSet(), navigators: new WeakSet(), windows: new WeakSet(),
    navigatorManagers: new WeakMap(), bucketNames: new WeakMap(), windowNavigators: new WeakMap(), windowOpeners: new WeakMap(), ports: new WeakMap(),
    navigatorClasses: new WeakMap(), temporaryObjects: new WeakMap(), persistentObjects: new WeakMap() };
}

// options: channel (default true), bucket (true), legacy (true), manager (true), distinctPersistent, distinctPrototypes, windowAccessors
function makeRealm(label, brands, options = {}) {
  const context = vm.createContext({
    fixtureBrands: brands, fixtureOptions: options, fixtureLabel: label,
    hostTask: (task, report) => setImmediate(() => { try { task(); } catch (error) { report(error); } }),
    pageTask: task => setImmediate(task)
  });
  vm.runInContext(`'use strict';
    const brands = fixtureBrands, options = fixtureOptions, label = fixtureLabel;
    delete globalThis.fixtureBrands; delete globalThis.fixtureOptions; delete globalThis.fixtureLabel;
    const A = Reflect.apply, D = Object.defineProperty, P = Promise;
    const has = WeakSet.prototype.has, add = WeakSet.prototype.add, mapGet = WeakMap.prototype.get, mapSet = WeakMap.prototype.set;
    globalThis.calls = { managerQuota: 0, bucketQuota: 0, bucketRejection: 0, legacyQuery: 0, legacyRequest: 0, legacyRejection: 0, legacyArgumentErrors: 0, posts: 0, getterReads: 0, pageReads: 0 };
    globalThis.reported = []; globalThis.receivers = { bucket: [], query: [], request: [] }; globalThis.callbacks = [];
    globalThis.REAL = { quota: 8192, usage: 81 };
    globalThis.illegal = new TypeError('Illegal invocation');
    globalThis.bucketRejection = new TypeError("Failed to execute 'estimate' on 'StorageBucket': Illegal invocation");
    globalThis.managerRejection = new TypeError("Failed to execute 'estimate' on 'StorageManager': Illegal invocation");
    const report = error => reported.push(error);
    // Chromium WebIDL oracle for unsigned long long, written with BigInt so it shares no code with the installer.
    const oracle = value => {
      const number = +value;
      if (number !== number || number === Infinity || number === -Infinity) return 0n;
      return BigInt.asUintN(64, BigInt(Math.trunc(number)));
    };
    globalThis.oracle = oracle;
    ${options.manager === false ? '' : `
    globalThis.StorageManager = class StorageManager {
      constructor() { A(add, brands.managers, [this]); }
      estimate() {
        if (!A(has, brands.managers, [this])) return P.reject(managerRejection);
        calls.managerQuota++; return P.resolve({ quota: REAL.quota, usage: REAL.usage, usageDetails: {} });
      }
    };`}
    ${options.bucket === false ? '' : `
    globalThis.StorageBucket = class StorageBucket {
      constructor(name) { A(add, brands.buckets, [this]); A(mapSet, brands.bucketNames, [this, name]); }
      get name() { if (!A(has, brands.buckets, [this])) throw illegal; return A(mapGet, brands.bucketNames, [this]); }
      estimate() {
        receivers.bucket.push(this);
        if (!A(has, brands.buckets, [this])) { calls.bucketRejection++; return P.reject(bucketRejection); }
        calls.bucketQuota++; return P.resolve({ quota: REAL.quota, usage: REAL.usage, usageDetails: {} });
      }
    };`}
    ${options.channel === false ? '' : `
    class MessagePort {
      postMessage(data) {
        calls.posts++; const peer = A(mapGet, brands.ports, [this]);
        hostTask(() => { if (A(has, closedPorts, [peer])) return; const handler = A(mapGet, handlers, [peer]); if (handler) A(handler, peer, [{ data }]); }, report);
      }
      set onmessage(handler) { A(mapSet, handlers, [this, handler]); }
      get onmessage() { const handler = A(mapGet, handlers, [this]); return handler === undefined ? null : handler; }
      close() { A(add, closedPorts, [this]); }
    }
    const handlers = new WeakMap(), closedPorts = new WeakSet(), channelPorts = new WeakMap();
    globalThis.MessagePort = MessagePort;
    globalThis.MessageChannel = class MessageChannel {
      constructor() { const one = new MessagePort(), two = new MessagePort(); A(mapSet, brands.ports, [one, two]); A(mapSet, brands.ports, [two, one]); A(mapSet, channelPorts, [this, [one, two]]); }
      get port1() { return A(mapGet, channelPorts, [this])[0]; }
      get port2() { return A(mapGet, channelPorts, [this])[1]; }
    };`}
    ${options.legacy === false ? '' : `
    const unsignedLong = value => {
      if (typeof value === 'bigint' || typeof value === 'symbol') throw new TypeError("Failed to execute 'requestQuota' on 'DeprecatedStorageQuota': Cannot convert a " + typeof value + " value to a number");
      return oracle(value);
    };
    const callable = value => typeof value === 'function';
    const fail = (method, message) => { calls.legacyArgumentErrors++; return new TypeError("Failed to execute '" + method + "' on 'DeprecatedStorageQuota': " + message); };
    const makeQuota = () => class DeprecatedStorageQuota {
      queryUsageAndQuota(success, failure) {
        receivers.query.push(this);
        if (!A(has, brands.quotaObjects, [this])) { calls.legacyRejection++; throw illegal; }
        if (arguments.length < 1) throw fail('queryUsageAndQuota', '1 argument required, but only 0 present.');
        if (!callable(success)) throw fail('queryUsageAndQuota', "parameter 1 is not of type 'Function'.");
        if (failure !== undefined && failure !== null && !callable(failure)) throw fail('queryUsageAndQuota', "parameter 2 is not of type 'Function'.");
        calls.legacyQuery++; hostTask(() => A(success, undefined, [REAL.usage, REAL.quota]), report);
      }
      requestQuota(size, success, failure) {
        receivers.request.push(this);
        if (!A(has, brands.quotaObjects, [this])) { calls.legacyRejection++; throw illegal; }
        if (arguments.length < 1) throw fail('requestQuota', '1 argument required, but only 0 present.');
        const requested = unsignedLong(size);
        if (success !== undefined && success !== null && !callable(success)) throw fail('requestQuota', "parameter 2 is not of type 'Function'.");
        if (failure !== undefined && failure !== null && !callable(failure)) throw fail('requestQuota', "parameter 3 is not of type 'Function'.");
        calls.legacyRequest++;
        const quota = BigInt(REAL.quota), granted = requested < quota ? requested : quota;
        if (success) hostTask(() => A(success, undefined, [Number(granted)]), report);
      }
    };
    const Quota = makeQuota(), OtherQuota = options.distinctPrototypes ? makeQuota() : Quota;
    // Like Chromium the object is cached on the Navigator (shared by every realm) and belongs to the Navigator's own realm.
    const quotaFor = (navigator, persistent) => {
      const separate = persistent && options.distinctPersistent, cache = separate ? brands.persistentObjects : brands.temporaryObjects;
      let object = A(mapGet, cache, [navigator]);
      if (object === undefined) {
        const classes = A(mapGet, brands.navigatorClasses, [navigator]);
        object = new classes[separate ? 1 : 0](); A(add, brands.quotaObjects, [object]); A(mapSet, cache, [navigator, object]);
      }
      return object;
    };`}
    globalThis.Navigator = class Navigator {
      constructor(manager) { A(add, brands.navigators, [this]); A(mapSet, brands.navigatorManagers, [this, manager]); ${options.legacy === false ? '' : 'A(mapSet, brands.navigatorClasses, [this, [Quota, OtherQuota]]);'} }
      ${options.manager === false ? '' : `get storage() { calls.getterReads++; if (!A(has, brands.navigators, [this])) throw illegal; return A(mapGet, brands.navigatorManagers, [this]); }`}
      ${options.legacy === false ? '' : `
      get webkitTemporaryStorage() { calls.getterReads++; if (!A(has, brands.navigators, [this])) throw illegal; return quotaFor(this, false); }
      get webkitPersistentStorage() {
        calls.getterReads++; if (!A(has, brands.navigators, [this])) throw illegal;
        return quotaFor(this, true);
      }`}
    };
    globalThis.nativeAccessors = {};
    for (const key of ['storage', 'webkitTemporaryStorage', 'webkitPersistentStorage']) { const field = Object.getOwnPropertyDescriptor(Navigator.prototype, key); if (field) nativeAccessors[key] = field.get; }
    globalThis.nativeMethods = {
      managerEstimate: globalThis.StorageManager && StorageManager.prototype.estimate,
      bucketEstimate: globalThis.StorageBucket && StorageBucket.prototype.estimate,
      bucketName: globalThis.StorageBucket && Object.getOwnPropertyDescriptor(StorageBucket.prototype, 'name').get,
      query: ${options.legacy === false ? 'undefined' : 'Quota.prototype.queryUsageAndQuota'}, request: ${options.legacy === false ? 'undefined' : 'Quota.prototype.requestQuota'}
    };
    ${options.legacy === false ? '' : `globalThis.quotaPrototype = Quota.prototype; globalThis.otherQuotaPrototype = OtherQuota.prototype;`}
    globalThis.manager = ${options.manager === false ? 'undefined' : 'new StorageManager()'};
    globalThis.nav = new Navigator(manager);
    globalThis.makeBucket = name => new StorageBucket(name);
    globalThis.apply = A; globalThis.define = D; globalThis.capturedPromise = P; globalThis.capturedTypeError = TypeError;
    globalThis.objectPrototype = Object.prototype; globalThis.promisePrototype = P.prototype; globalThis.getPrototype = Object.getPrototypeOf;
    ${options.windowAccessors ? `
    A(add, brands.windows, [globalThis]); A(mapSet, brands.windowNavigators, [globalThis, nav]);
    const windowOnly = getter => function () { if (!A(has, brands.windows, [this])) throw illegal; return getter.call(this); };
    D(globalThis, 'navigator', { configurable: true, enumerable: true, get: windowOnly(function () { return A(mapGet, brands.windowNavigators, [this]); }) });
    D(globalThis, 'document', { configurable: true, get: windowOnly(function () { return {}; }) });
    D(globalThis, 'self', { configurable: true, get: windowOnly(function () { return this; }) });
    D(globalThis, 'parent', { configurable: true, get: windowOnly(function () { return this; }) });
    D(globalThis, 'top', { configurable: true, get: windowOnly(function () { return this; }) });
    D(globalThis, 'opener', { configurable: true, get: windowOnly(function () { const opener = A(mapGet, brands.windowOpeners, [this]); return opener === undefined ? null : opener; }) });
    D(globalThis, 'length', { configurable: true, get: windowOnly(function () { return 0; }) });
    globalThis.openedWindows = []; globalThis.nextPopup = null;
    D(globalThis, 'open', { configurable: true, writable: true, enumerable: true, value: { open() { openedWindows.push(this); return nextPopup; } }.open });
    ` : `D(globalThis, 'navigator', { configurable: true, enumerable: true, get() { return nav; } });`}
  `, context);
  const run = code => vm.runInContext(code, context);
  return { context, run, global: run('globalThis'), calls: () => JSON.parse(run('JSON.stringify(calls)')) };
}

function install(f, entries = entry()) {
  f.context.entries = structuredClone(entries);
  f.run(`${installerSource}\nglobalThis.installer = installApiCustom; globalThis.guard = installApiCustom(globalThis, entries);`);
  return f;
}
function fixture(options = {}, entries = entry()) { return install(makeRealm('main', brandSet(), options), entries); }
const quotaCalls = f => { const calls = f.calls(); return calls.managerQuota + calls.bucketQuota + calls.legacyQuery + calls.legacyRequest; };
// Reads the page-visible quota object and awaits one legacy answer.
const query = (f, expression = 'nav.webkitTemporaryStorage') => f.run(`new Promise(resolve => ${expression}.queryUsageAndQuota(function () { 'use strict'; resolve({ args: Array.from(arguments), thisUndefined: this === undefined }); }))`);
const request = (f, size, expression = 'nav.webkitTemporaryStorage') => f.run(`new Promise(resolve => ${expression}.requestQuota(${size}, function () { 'use strict'; resolve(Array.from(arguments)); }))`);
const sentinelOnly = (f, list) => JSON.parse(f.run(`JSON.stringify(receivers.${list}.map(item => item === null || typeof item !== 'object' ? 'primitive' : Object.getPrototypeOf(item) === null && Object.isFrozen(item) ? 'sentinel' : 'other'))`));

test('bucket: a genuine bucket answers from the selected snapshot, with fresh target-realm values and zero native calls', async () => {
  const f = fixture();
  const first = f.run('globalThis.bucket = makeBucket("a"); globalThis.pending = bucket.estimate(); pending');
  assert.equal(f.run('getPrototype(pending) === promisePrototype'), true);
  const value = await first;
  assert.equal(Object.getPrototypeOf(value), f.run('objectPrototype'));
  // Chromium shape (ADR-107, measured): quota, usage, usageDetails; the details sum to usage ({} at usage 0).
  assert.deepEqual(Object.keys(value), ['quota', 'usage', 'usageDetails']);
  assert.equal(value.quota, 1024); assert.equal(value.usage, 12);
  assert.equal(Object.getPrototypeOf(value.usageDetails), f.run('objectPrototype'));
  assert.deepEqual(JSON.parse(JSON.stringify(value.usageDetails)), { indexedDB: 12 });
  assert.deepEqual(Object.getOwnPropertyDescriptor(value, 'usageDetails').writable, true);
  value.quota = 1; value.usageDetails.indexedDB = 0;
  const second = await f.run('bucket.estimate()');
  assert.notEqual(second, value); assert.equal(second.quota, 1024); assert.equal(second.usageDetails.indexedDB, 12, 'fresh details per call');
  assert.equal(quotaCalls(f), 0); assert.equal(f.calls().bucketRejection, 0);
  assert.deepEqual(f.run('receivers.bucket.length'), 0);
});

test('usageDetails: {} at usage 0 on both surfaces; Firefox-shaped realms (no StorageBucket, no deprecated API) keep quota/usage only', async () => {
  const f = fixture({}, entry('custom', { quota: 10737418240, usage: 0 }));
  const manager = await f.run('manager.estimate()'), bucket = await f.run('makeBucket("z").estimate()');
  for (const value of [manager, bucket]) { assert.deepEqual(Object.keys(value), ['quota', 'usage', 'usageDetails']); assert.deepEqual(Object.keys(value.usageDetails), []); }
  assert.notEqual(manager.usageDetails, bucket.usageDetails);
  const firefox = fixture({ bucket: false, legacy: false });
  assert.deepEqual(Object.keys(await firefox.run('manager.estimate()')), ['quota', 'usage']);
});

test('bucket: the answer is asynchronous and the promise settles after the call returns', async () => {
  const f = fixture();
  f.run('globalThis.order = []; const pending = makeBucket("a").estimate(); pending.then(() => order.push("settled")); order.push("returned");');
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(order)')), ['returned']);
  await drainMicrotasks();
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(order)')), ['returned', 'settled']);
});

test('bucket: foreign receivers reach the original once with the private sentinel and get the native rejection', async () => {
  const f = fixture();
  const receivers = ['undefined', 'null', '0', '"x"', '({})', 'Object.create(makeBucket("b"))', 'manager', 'nav', 'new Proxy(makeBucket("c"), { get() { calls.pageReads++; throw Error("trap"); }, getPrototypeOf() { calls.pageReads++; throw Error("trap"); } })', 'StorageBucket.prototype'];
  for (const receiver of receivers) {
    const result = f.run(`apply(StorageBucket.prototype.estimate, ${receiver}, [])`);
    assert.equal(Object.getPrototypeOf(result), f.run('promisePrototype'), receiver);
    await assert.rejects(result, error => error === f.run('bucketRejection'), receiver);
  }
  assert.equal(f.calls().pageReads, 0);
  assert.equal(quotaCalls(f), 0);
  assert.deepEqual(sentinelOnly(f, 'bucket'), receivers.map(() => 'sentinel'));
  assert.equal(f.calls().bucketRejection, receivers.length);
});

test('bucket: arguments are never inspected or coerced', async () => {
  const f = fixture();
  const result = f.run(`const trap = new Proxy({}, { get() { calls.pageReads++; throw Error('argument'); }, getPrototypeOf() { calls.pageReads++; throw Error('argument'); } });
    makeBucket('a').estimate(trap, trap, { valueOf() { calls.pageReads++; return 1; } })`);
  assert.equal((await result).quota, 1024); assert.equal(f.calls().pageReads, 0);
});

test('bucket: a page that replaces StorageBucket.prototype.name or the globals afterwards cannot change authentication', async () => {
  const f = fixture();
  f.run(`globalThis.late = makeBucket('late'); globalThis.method = StorageBucket.prototype.estimate;
    define(StorageBucket.prototype, 'name', { configurable: true, get() { calls.pageReads++; throw Error('Late name'); } });
    for (const key of ['Promise', 'Object', 'StorageBucket']) define(globalThis, key, { configurable: true, get() { calls.pageReads++; throw Error('Late ' + key); } });`);
  assert.equal((await f.run('apply(method, late, [])')).quota, 1024);
  await assert.rejects(f.run('apply(method, {}, [])'), error => error === f.run('bucketRejection'));
  assert.equal(f.calls().pageReads, 0); assert.equal(quotaCalls(f), 0);
});

test('bucket: a bucket of another realm is recognised by the shared native brand and answered by the method realm', async () => {
  const brands = brandSet(), parent = makeRealm('parent', brands), child = makeRealm('child', brands);
  parent.context.entries = structuredClone(entry());
  parent.context.child = child.global;
  parent.run(`${installerSource}\nglobalThis.guard = installApiCustom(globalThis, entries); globalThis.childGuard = installApiCustom(child, entries);`);
  const bucket = child.run('makeBucket("kid")');
  parent.context.childBucket = bucket;
  const borrowed = parent.run('apply(StorageBucket.prototype.estimate, childBucket, [])');
  assert.equal(Object.getPrototypeOf(borrowed), parent.run('promisePrototype'));
  assert.equal((await borrowed).quota, 1024);
  assert.equal(Object.getPrototypeOf(await parent.run('apply(StorageBucket.prototype.estimate, childBucket, [])')), parent.run('objectPrototype'));
  const own = child.run('globalThis.mine = makeBucket("own"); mine.estimate()');
  assert.equal(Object.getPrototypeOf(own), child.run('promisePrototype'));
  assert.equal(Object.getPrototypeOf(await own), child.run('objectPrototype'));
  assert.equal(quotaCalls(parent) + quotaCalls(child), 0);
});

test('bucket: OFF and bypass leave the native method; stop restores it and a retained wrapper delegates exactly once', async () => {
  for (const mode of ['off', 'bypass']) {
    const f = fixture({}, entry(mode));
    assert.equal(f.run('StorageBucket.prototype.estimate === nativeMethods.bucketEstimate'), true, mode);
    assert.equal((await f.run('makeBucket("a").estimate()')).quota, 8192); assert.equal(f.calls().bucketQuota, 1);
  }
  const f = fixture();
  f.run('globalThis.wrapper = StorageBucket.prototype.estimate; globalThis.bucket = makeBucket("a"); globalThis.pending = bucket.estimate(); guard.stop(); guard.stop();');
  assert.equal(f.run('StorageBucket.prototype.estimate === nativeMethods.bucketEstimate'), true);
  assert.equal((await f.run('pending')).quota, 1024, 'a virtual snapshot created before stop survives it');
  assert.equal((await f.run('apply(wrapper, bucket, [])')).quota, 8192);
  assert.equal(f.calls().bucketQuota, 1);
  assert.deepEqual(sentinelOnly(f, 'bucket'), ['other']);
});

test('bucket: descriptor attributes are kept, the wrapper is a non-constructor and a newer owner survives stop', async () => {
  const f = fixture();
  const state = JSON.parse(f.run(`JSON.stringify((({ writable, enumerable, configurable }) => ({ writable, enumerable, configurable }))(Object.getOwnPropertyDescriptor(StorageBucket.prototype, 'estimate')))`));
  assert.deepEqual(state, { writable: true, enumerable: false, configurable: true });
  assert.equal(f.run('"prototype" in StorageBucket.prototype.estimate'), false);
  assert.throws(() => f.run('new StorageBucket.prototype.estimate()'), error => error instanceof f.run('capturedTypeError'));
  f.run('globalThis.replacement = function () { return "page"; }; define(StorageBucket.prototype, "estimate", { value: replacement, configurable: true, writable: true }); guard.stop();');
  assert.equal(f.run('StorageBucket.prototype.estimate === replacement'), true);
});

test('bucket: an absent StorageBucket (Firefox, insecure context) creates nothing; an immutable estimate stays unchanged and unavailable', () => {
  const absent = fixture({ bucket: false, legacy: false });
  assert.equal(absent.run('typeof StorageBucket'), 'undefined');
  assert.equal(JSON.parse(absent.run('JSON.stringify(guard.snapshot())')).installed, 2, 'only StorageManager.estimate and the storage getter exist to hook');
  const frozen = makeRealm('frozen', brandSet());
  frozen.run('define(StorageBucket.prototype, "estimate", { value: nativeMethods.bucketEstimate, configurable: false, writable: false });');
  install(frozen);
  assert.equal(frozen.run('StorageBucket.prototype.estimate === nativeMethods.bucketEstimate'), true);
  assert.ok(JSON.parse(frozen.run('JSON.stringify(guard.snapshot())')).unavailable >= 1);
});

test('bucket: a missing name getter fails closed (every receiver gets the native rejection) and is reported as unavailable', async () => {
  const f = makeRealm('no-brand', brandSet());
  f.run('delete StorageBucket.prototype.name;');
  install(f);
  assert.ok(JSON.parse(f.run('JSON.stringify(guard.snapshot())')).unavailable >= 1);
  await assert.rejects(f.run('makeBucket("a").estimate()'), error => error === f.run('bucketRejection'));
  assert.equal(quotaCalls(f), 0);
});

test('bucket: thousands of buckets keep working (no registry cap applies to a pure brand check)', async () => {
  const f = fixture();
  const answer = await f.run('(async () => { let last; for (let index = 0; index < 3000; index++) last = await makeBucket("b" + index).estimate(); return last; })()');
  assert.equal(answer.quota, 1024); assert.equal(quotaCalls(f), 0);
});

test('legacy: installation is passive; the accessor and prototype are hooked only when the page first reads the accessor', async () => {
  const f = makeRealm('lazy', brandSet());
  f.run('globalThis.before = { query: quotaPrototype.queryUsageAndQuota, request: quotaPrototype.requestQuota };');
  install(f);
  assert.equal(f.calls().getterReads, 0, 'install reads no accessor');
  assert.equal(f.run('quotaPrototype.queryUsageAndQuota === before.query'), true);
  assert.equal(f.run('Object.getOwnPropertyDescriptor(Navigator.prototype, "webkitTemporaryStorage").get !== nativeAccessors.webkitTemporaryStorage'), true);
  const installedAtStart = JSON.parse(f.run('JSON.stringify(guard.snapshot())')).installed;
  f.run('nav.webkitTemporaryStorage');
  assert.equal(f.run('quotaPrototype.queryUsageAndQuota !== before.query && quotaPrototype.requestQuota !== before.request'), true);
  const installed = JSON.parse(f.run('JSON.stringify(guard.snapshot())')).installed;
  assert.equal(installed, installedAtStart + 2);
  for (let index = 0; index < 5; index++) f.run('nav.webkitTemporaryStorage; nav.webkitPersistentStorage;');
  assert.equal(JSON.parse(f.run('JSON.stringify(guard.snapshot())')).installed, installed, 'repeated reads never wrap the prototype again');
  assert.equal(f.calls().getterReads, 1 + 10);
});

test('legacy: a prototype the page swaps onto the quota object later is never wrapped (only a new object hooks)', () => {
  const f = fixture();
  f.run('nav.webkitTemporaryStorage;');
  f.run(`globalThis.mine = { queryUsageAndQuota() { return 'page'; }, requestQuota() { return 'page'; } };
    Object.setPrototypeOf(nav.webkitTemporaryStorage, mine); nav.webkitTemporaryStorage; nav.webkitPersistentStorage;`);
  assert.equal(f.run('nav.webkitTemporaryStorage.queryUsageAndQuota(() => {})'), 'page');
  assert.equal(f.run('nav.webkitTemporaryStorage.requestQuota(5)'), 'page');
});

test('legacy: objects of other navigators share the already wrapped prototype: it is wrapped once per installation, never stacked', async () => {
  const f = fixture();
  f.run('nav.webkitTemporaryStorage; globalThis.wrapped = quotaPrototype.queryUsageAndQuota; globalThis.wrappedRequest = quotaPrototype.requestQuota;');
  const installed = JSON.parse(f.run('JSON.stringify(guard.snapshot())')).installed;
  f.run('for (let index = 0; index < 5; index++) new Navigator(manager).webkitTemporaryStorage;');
  assert.equal(f.run('quotaPrototype.queryUsageAndQuota === wrapped && quotaPrototype.requestQuota === wrappedRequest'), true, 'same wrapper identity');
  assert.equal(JSON.parse(f.run('JSON.stringify(guard.snapshot())')).installed, installed, 'no extra handles');
  assert.deepEqual(JSON.parse(JSON.stringify((await query(f, 'new Navigator(manager).webkitTemporaryStorage')).args)), [12, 1024]);
  f.run('guard.stop();');
  assert.equal(f.run('quotaPrototype.queryUsageAndQuota === nativeMethods.query'), true, 'one stop unwinds everything');
});

test('legacy: the accessor wrapper calls the original once with the same receiver and returns the SameObject unchanged', () => {
  const f = fixture();
  assert.equal(f.run('nav.webkitTemporaryStorage === nav.webkitTemporaryStorage && nav.webkitPersistentStorage === nav.webkitTemporaryStorage'), true);
  const before = f.calls().getterReads;
  f.run('nav.webkitTemporaryStorage');
  assert.equal(f.calls().getterReads, before + 1);
  assert.throws(() => f.run('apply(Object.getOwnPropertyDescriptor(Navigator.prototype, "webkitTemporaryStorage").get, {}, [])'), error => error === f.run('illegal'));
  assert.equal(f.run('Object.getOwnPropertyNames(nav.webkitTemporaryStorage).length'), 0);
});

test('legacy: queryUsageAndQuota answers (usage, quota) with this undefined, returns undefined and never calls the original', async () => {
  const f = fixture();
  assert.equal(f.run('nav.webkitTemporaryStorage.queryUsageAndQuota(() => {})'), undefined);
  const answer = await query(f);
  assert.deepEqual(JSON.parse(JSON.stringify(answer.args)), [12, 1024]);
  assert.equal(answer.thisUndefined, true);
  assert.deepEqual(JSON.parse(JSON.stringify((await query(f, 'nav.webkitPersistentStorage')).args)), [12, 1024]);
  assert.equal(quotaCalls(f), 0); assert.equal(f.calls().legacyRejection, 0);
  assert.equal(f.run('receivers.query.length'), 0);
});

test('legacy: delivery is never synchronous and never a microtask; it is a later task', async () => {
  const f = fixture();
  f.run('globalThis.seen = []; nav.webkitTemporaryStorage.queryUsageAndQuota(() => seen.push("callback")); seen.push("returned");');
  await drainMicrotasks(60);
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(seen)')), ['returned'], 'still pending after 60 microtask turns');
  await flush();
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(seen)')), ['returned', 'callback']);
});

test('legacy: the callback comes after tasks the page queued in the same turn, before or after the call (native order)', async () => {
  for (const queuedFirst of [true, false]) {
    const f = fixture();
    f.run(`globalThis.order = [];
      const page = () => pageTask(() => order.push('page'));
      ${queuedFirst ? 'page();' : ''}
      nav.webkitTemporaryStorage.queryUsageAndQuota(() => order.push('callback'));
      ${queuedFirst ? '' : 'page();'}`);
    await flush();
    assert.deepEqual(JSON.parse(f.run('JSON.stringify(order)')), ['page', 'callback'], queuedFirst ? 'queued first' : 'queued after the call');
  }
});

test('legacy: the private task channel uses captured natives; a page that spies on or replaces MessageChannel afterwards sees nothing', async () => {
  const f = fixture();
  f.run(`globalThis.spied = 0; globalThis.windowMessages = 0;
    define(globalThis, 'MessageChannel', { configurable: true, writable: true, value: function () { spied++; throw Error('page channel'); } });
    define(MessagePort.prototype, 'postMessage', { configurable: true, writable: true, value() { spied++; } });
    define(MessagePort.prototype, 'onmessage', { configurable: true, set() { spied++; }, get() { return null; } });
    define(MessagePort.prototype, 'close', { configurable: true, writable: true, value() { spied++; } });`);
  const answer = await query(f);
  assert.deepEqual(JSON.parse(JSON.stringify(answer.args)), [12, 1024]);
  assert.deepEqual(JSON.parse(JSON.stringify(await request(f, '99'))), [99]);
  assert.equal(f.run('spied'), 0); assert.equal(quotaCalls(f), 0);
});

test('legacy: without a MessageChannel the answer still arrives (after a microtask) and the loss of a task source is reported', async () => {
  const f = fixture({ channel: false });
  assert.ok(JSON.parse(f.run('JSON.stringify(guard.snapshot())')).unavailable >= 1);
  assert.deepEqual(JSON.parse(JSON.stringify((await query(f)).args)), [12, 1024]);
  assert.equal(quotaCalls(f), 0);
});

test('legacy: a throwing success callback is reported by the task, the error callback is not called and the other callbacks still run', async () => {
  const f = fixture();
  f.run(`globalThis.errorCallbacks = 0; globalThis.delivered = 0;
    nav.webkitTemporaryStorage.queryUsageAndQuota(() => { throw new RangeError('page'); }, () => { errorCallbacks++; });
    nav.webkitTemporaryStorage.queryUsageAndQuota(() => { delivered++; });`);
  await flush();
  assert.equal(f.run('reported.length'), 1); assert.equal(f.run('reported[0] instanceof RangeError'), true);
  assert.equal(f.run('errorCallbacks'), 0); assert.equal(f.run('delivered'), 1);
});

test('legacy: argument errors are the exact native errors and nothing is delivered or counted as an answer', async () => {
  const f = fixture();
  const cases = {
    'zero arguments': 'nav.webkitTemporaryStorage.queryUsageAndQuota()', 'number': 'nav.webkitTemporaryStorage.queryUsageAndQuota(1)', 'null': 'nav.webkitTemporaryStorage.queryUsageAndQuota(null)',
    'undefined': 'nav.webkitTemporaryStorage.queryUsageAndQuota(undefined)', 'object': 'nav.webkitTemporaryStorage.queryUsageAndQuota({})',
    'proxy object': 'nav.webkitTemporaryStorage.queryUsageAndQuota(new Proxy({}, {}))', 'bad second': 'nav.webkitTemporaryStorage.queryUsageAndQuota(() => {}, 1)',
    'bad first with good second': 'nav.webkitTemporaryStorage.queryUsageAndQuota(1, () => {})'
  };
  for (const [label, call] of Object.entries(cases)) {
    f.run('calls.legacyArgumentErrors = 0;');
    assert.throws(() => f.run(call), error => error instanceof f.run('capturedTypeError') && /Failed to execute 'queryUsageAndQuota' on 'DeprecatedStorageQuota'/.test(error.message), label);
    assert.equal(f.calls().legacyArgumentErrors, 1, label + ': the original produced the error');
  }
  assert.equal(quotaCalls(f), 0);
  await flush();
  assert.equal(f.calls().posts, 0, 'a rejected call schedules no task');
});

test('legacy: valid unusual callbacks are answered virtually: null/undefined error callback, class, callable Proxy, extra arguments', async () => {
  const f = fixture();
  f.run(`globalThis.hits = [];
    const note = label => function () { hits.push(label + ':' + Array.from(arguments).join('/')); };
    const quota = nav.webkitTemporaryStorage;
    quota.queryUsageAndQuota(note('null'), null); quota.queryUsageAndQuota(note('undefined'), undefined);
    quota.queryUsageAndQuota(new Proxy(note('proxy'), {})); quota.queryUsageAndQuota(note('extra'), note('error'), { valueOf() { calls.pageReads++; return 1; } }, 2);
    quota.queryUsageAndQuota(class Callback { static [Symbol.hasInstance]() { return false; } });`);
  await flush(8);
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(hits)')), ['null:12/1024', 'undefined:12/1024', 'proxy:12/1024', 'extra:12/1024']);
  assert.equal(f.run('reported.length'), 1, 'a class constructor throws when called, exactly like the native task would');
  assert.equal(f.calls().pageReads, 0); assert.equal(quotaCalls(f), 0);
});

test('legacy: foreign receivers get the native synchronous TypeError through the private sentinel; arguments stay untouched', () => {
  const f = fixture();
  f.run('nav.webkitTemporaryStorage;');
  const receivers = ['undefined', 'null', '0', '({})', 'manager', 'makeBucket("x")', 'Object.create(nav.webkitTemporaryStorage)', 'new Proxy(nav.webkitTemporaryStorage, { get() { calls.pageReads++; throw Error("trap"); }, getPrototypeOf() { calls.pageReads++; throw Error("trap"); } })', 'quotaPrototype'];
  for (const method of ['queryUsageAndQuota', 'requestQuota']) {
    f.run('receivers.query.length = 0; receivers.request.length = 0;');
    for (const receiver of receivers) assert.throws(() => f.run(`apply(quotaPrototype.${method}, ${receiver}, [{ valueOf() { calls.pageReads++; return 1; } }, 1])`), error => error === f.run('illegal'), method + ' ' + receiver);
    assert.deepEqual(sentinelOnly(f, method === 'queryUsageAndQuota' ? 'query' : 'request'), receivers.map(() => 'sentinel'), method);
  }
  assert.equal(f.calls().pageReads, 0); assert.equal(quotaCalls(f), 0);
});

test('legacy: an object that never passed the hooked accessor is recognised through the captured Window.navigator and the pristine getter', async () => {
  const f = makeRealm('cached', brandSet(), { windowAccessors: true, distinctPersistent: true });
  install(f);
  // The page object comes straight from the pristine accessor (as a pre-install cache would); a second navigator hooks the prototype.
  f.run('globalThis.cached = apply(nativeAccessors.webkitTemporaryStorage, nav, []); new Navigator(manager).webkitTemporaryStorage; calls.getterReads = 0;');
  assert.equal(f.run('quotaPrototype.queryUsageAndQuota !== nativeMethods.query'), true);
  const answer = await f.run('new Promise(resolve => apply(quotaPrototype.queryUsageAndQuota, cached, [(usage, quota) => resolve([usage, quota])]))');
  assert.deepEqual(JSON.parse(JSON.stringify(answer)), [12, 1024]);
  assert.equal(quotaCalls(f), 0); assert.equal(f.calls().legacyRejection, 0);
  assert.equal(f.calls().getterReads, 1, 'one pristine-accessor read authenticated it');
});

test('legacy: a distinct persistent object that never passed the hooked accessor is recognised through its own pristine getter', async () => {
  const f = makeRealm('cached-persistent', brandSet(), { windowAccessors: true, distinctPersistent: true, distinctPrototypes: true });
  install(f);
  f.run('globalThis.cached = apply(nativeAccessors.webkitPersistentStorage, nav, []); new Navigator(manager).webkitPersistentStorage;');
  assert.equal(f.run('otherQuotaPrototype.queryUsageAndQuota !== nativeMethods.query'), true);
  const answer = await f.run('new Promise(resolve => apply(otherQuotaPrototype.queryUsageAndQuota, cached, [(usage, quota) => resolve([usage, quota])]))');
  assert.deepEqual(JSON.parse(JSON.stringify(answer)), [12, 1024]);
  assert.equal(quotaCalls(f), 0); assert.equal(f.calls().legacyRejection, 0);
});

test('legacy: a quota object of an uninstalled same-origin popup is recognised by the bounded window search (ADR-086 rules)', async () => {
  const brands = brandSet(), parent = makeRealm('parent', brands, { windowAccessors: true }), popup = makeRealm('popup', brands, { windowAccessors: true });
  parent.context.entries = structuredClone(entry()); parent.context.popup = popup.global;
  parent.run(`${installerSource}\nglobalThis.guard = installApiCustom(globalThis, entries); globalThis.nextPopup = popup; open();`);
  popup.run('globalThis.popupQuota = nav.webkitTemporaryStorage;');
  parent.context.popupQuota = popup.run('popupQuota');
  parent.run('nav.webkitTemporaryStorage');
  const answer = await parent.run('new Promise(resolve => apply(quotaPrototype.queryUsageAndQuota, popupQuota, [(usage, quota) => resolve([usage, quota])]))');
  assert.deepEqual(JSON.parse(JSON.stringify(answer)), [12, 1024]);
  assert.equal(quotaCalls(parent) + quotaCalls(popup), 0);
  // An object that no reachable pristine navigator returns is rejected.
  parent.context.stranger = popup.run('new Navigator(manager).webkitTemporaryStorage');
  assert.throws(() => parent.run('apply(quotaPrototype.queryUsageAndQuota, stranger, [() => {}])'), error => error === parent.run('illegal'));
});

test('legacy: the quota registry cap fails closed for new objects and keeps registered ones; the manager registry is separate', async () => {
  const f = fixture();
  f.run(`globalThis.first = nav.webkitTemporaryStorage; globalThis.lastRegistered = null; globalThis.overCap = null;
    for (let index = 0; index < 1024; index++) { const quota = new Navigator(manager).webkitTemporaryStorage; if (index === 1022) lastRegistered = quota; if (index === 1023) overCap = quota; }`);
  assert.deepEqual(JSON.parse(JSON.stringify((await query(f, 'first')).args)), [12, 1024]);
  assert.deepEqual(JSON.parse(JSON.stringify((await query(f, 'lastRegistered')).args)), [12, 1024]);
  assert.throws(() => f.run('overCap.queryUsageAndQuota(() => {})'), error => error === f.run('illegal'));
  assert.deepEqual(sentinelOnly(f, 'query'), ['sentinel']);
  assert.equal((await f.run('new Navigator(manager).storage.estimate()')).quota, 1024, 'managers keep their own cap');
  assert.equal(quotaCalls(f), 0);
});

test('legacy: persistent and temporary objects that differ (other Chromium builds) are both virtual and each prototype is wrapped once', async () => {
  const f = fixture({ distinctPersistent: true, distinctPrototypes: true });
  f.run('globalThis.original = { other: otherQuotaPrototype.queryUsageAndQuota };');
  assert.equal(f.run('nav.webkitTemporaryStorage !== nav.webkitPersistentStorage'), true);
  assert.deepEqual(JSON.parse(JSON.stringify((await query(f, 'nav.webkitTemporaryStorage')).args)), [12, 1024]);
  assert.deepEqual(JSON.parse(JSON.stringify((await query(f, 'nav.webkitPersistentStorage')).args)), [12, 1024]);
  assert.equal(f.run('otherQuotaPrototype.queryUsageAndQuota !== nativeMethods.query'), true);
  const installed = JSON.parse(f.run('JSON.stringify(guard.snapshot())')).installed;
  f.run('for (let index = 0; index < 4; index++) { nav.webkitTemporaryStorage; nav.webkitPersistentStorage; }');
  assert.equal(JSON.parse(f.run('JSON.stringify(guard.snapshot())')).installed, installed);
  assert.equal(quotaCalls(f), 0);
});

test('legacy: a page-replaced accessor present before a late inherited install cannot register or hook what it returns', () => {
  const brands = brandSet(), parent = makeRealm('parent', brands), child = makeRealm('child', brands);
  parent.context.entries = structuredClone(entry()); parent.context.child = child.global;
  child.run(`globalThis.fake = { queryUsageAndQuota() { calls.pageReads++; return 'page'; }, requestQuota() {} };
    define(Navigator.prototype, 'webkitTemporaryStorage', { configurable: true, get() { calls.pageReads++; return fake; } });`);
  parent.run(`${installerSource}
globalThis.guard = installApiCustom(globalThis, entries); globalThis.childGuard = installApiCustom(child, entries); nav.webkitTemporaryStorage;`);
  parent.context.fake = child.run('nav.webkitTemporaryStorage');
  assert.equal(parent.context.fake, child.run('fake'));
  assert.equal(child.run('fake.queryUsageAndQuota()'), 'page', 'the page object keeps its own methods; nothing was wrapped on it');
  assert.throws(() => parent.run('apply(quotaPrototype.queryUsageAndQuota, fake, [() => {}])'), error => error === parent.run('illegal'), 'and the fake is not an authenticated quota object');
  assert.deepEqual(sentinelOnly(parent, 'query'), ['sentinel']);
});

test('requestQuota: the granted size is min(request, selected quota) for every WebIDL conversion, matching the BigInt oracle of the mock browser', async () => {
  const f = fixture({}, entry('custom', { quota: 1000000, usage: 5 }));
  const cases = ['0', '1', '1.9', '-1', '-0.5', 'NaN', 'Infinity', '-Infinity', '"5"', '"abc"', 'null', 'undefined', 'true', '[7]', '({})', '999999', '1000000', '1000001', '2 ** 33', '2 ** 53', '2 ** 63', '2 ** 64', '2 ** 64 + 4096', '-(2 ** 64)', '-(2 ** 64 - 2048)', '1e20', '5e-324', '-5e-324', '({ valueOf() { return 9; } })'];
  for (const expression of cases) {
    const granted = (await request(f, expression))[0];
    const requested = f.run(`oracle(${expression})`);
    const expected = Number(requested < 1000000n ? requested : 1000000n);
    assert.equal(Object.is(granted, expected), true, expression + ' -> ' + granted + ' (expected ' + expected + ')');
  }
  assert.equal(quotaCalls(f), 0);
});

test('requestQuota: the size is converted exactly once (page valueOf included) and conversion errors keep their precedence over callback errors', async () => {
  const f = fixture();
  f.run('globalThis.conversions = 0; globalThis.size = { valueOf() { conversions++; return 7; } };');
  assert.deepEqual(JSON.parse(JSON.stringify(await request(f, 'size'))), [7]);
  assert.equal(f.run('conversions'), 1);
  f.run('conversions = 0;');
  assert.throws(() => f.run('nav.webkitTemporaryStorage.requestQuota(size, 5)'), error => error instanceof f.run('capturedTypeError') && /parameter 2/.test(error.message));
  assert.equal(f.run('conversions'), 1, 'the native conversion ran once; the wrapper did not coerce before delegating');
  assert.throws(() => f.run('nav.webkitTemporaryStorage.requestQuota({ valueOf() { throw new RangeError("page"); } }, () => {})'), error => error instanceof f.run('RangeError'));
  for (const size of ['1n', 'Symbol("x")']) assert.throws(() => f.run(`nav.webkitTemporaryStorage.requestQuota(${size}, () => {})`), error => error instanceof f.run('capturedTypeError') && /Cannot convert a/.test(error.message), size);
  assert.throws(() => f.run('nav.webkitTemporaryStorage.requestQuota()'), error => /1 argument required/.test(error.message));
  assert.equal(quotaCalls(f), 0);
});

test('requestQuota: callbacks are optional/nullable like native, a lone size is a valid call, and a bad callback is the native error', async () => {
  const f = fixture();
  for (const call of ['requestQuota(5)', 'requestQuota(5, null)', 'requestQuota(5, undefined, null)', 'requestQuota(5, () => {}, undefined)']) assert.equal(f.run(`nav.webkitTemporaryStorage.${call}`), undefined, call);
  for (const call of ['requestQuota(5, 1)', 'requestQuota(5, "x")', 'requestQuota(5, () => {}, 1)', 'requestQuota(5, null, {})']) assert.throws(() => f.run(`nav.webkitTemporaryStorage.${call}`), error => error instanceof f.run('capturedTypeError'), call);
  await flush();
  assert.equal(quotaCalls(f), 0);
});

test('requestQuota: the huge request that would reveal the native quota returns the selected quota instead', async () => {
  const f = fixture();
  assert.deepEqual(JSON.parse(JSON.stringify(await request(f, '2 ** 53'))), [1024]);
  assert.deepEqual(JSON.parse(JSON.stringify(await request(f, '1e12', 'nav.webkitPersistentStorage'))), [1024]);
  assert.equal(quotaCalls(f), 0);
});

test('legacy stop: owned descriptors return, a retained wrapper delegates once with the real receiver, and a pending answer survives', async () => {
  const f = fixture();
  f.run('globalThis.wrapper = quotaPrototype.queryUsageAndQuota; nav.webkitTemporaryStorage; globalThis.hooked = quotaPrototype.queryUsageAndQuota; globalThis.pending = new Promise(resolve => nav.webkitTemporaryStorage.queryUsageAndQuota((usage, quota) => resolve([usage, quota]))); guard.stop(); guard.stop();');
  assert.equal(f.run('quotaPrototype.queryUsageAndQuota === nativeMethods.query && quotaPrototype.requestQuota === nativeMethods.request'), true);
  assert.equal(f.run('Object.getOwnPropertyDescriptor(Navigator.prototype, "webkitTemporaryStorage").get === nativeAccessors.webkitTemporaryStorage'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(await f.run('pending'))), [12, 1024]);
  const retained = await f.run('new Promise(resolve => apply(hooked, nav.webkitTemporaryStorage, [(usage, quota) => resolve([usage, quota])]))');
  assert.deepEqual(JSON.parse(JSON.stringify(retained)), [81, 8192]);
  assert.equal(f.calls().legacyQuery, 1);
  assert.deepEqual(sentinelOnly(f, 'query'), ['other']);
});

test('legacy OFF/bypass: accessors, prototypes and answers are untouched', async () => {
  for (const mode of ['off', 'bypass']) {
    const f = fixture({}, entry(mode));
    assert.equal(f.run('Object.getOwnPropertyDescriptor(Navigator.prototype, "webkitTemporaryStorage").get === nativeAccessors.webkitTemporaryStorage'), true, mode);
    assert.deepEqual(JSON.parse(JSON.stringify((await query(f)).args)), [81, 8192], mode);
    assert.equal(f.calls().legacyQuery, 1);
  }
});

test('overlay: a second installation on the same realm (neutral guard, then the profile) answers on every surface and unwinds in order', async () => {
  const f = fixture({}, entry('custom', { quota: 0, usage: 0 }));
  f.context.second = structuredClone(entry('custom', { quota: 5000, usage: 50 }));
  f.run('globalThis.guardTwo = installer(globalThis, second);');
  const values = async () => {
    const estimate = await f.run('manager.estimate()'), bucket = await f.run('makeBucket("a").estimate()');
    return [estimate.quota, estimate.usage, bucket.quota, bucket.usage, ...(await query(f)).args, ...(await request(f, '2 ** 53'))];
  };
  assert.deepEqual(await values(), [5000, 50, 5000, 50, 50, 5000, 5000], 'the later installation wins on all surfaces');
  f.run('guardTwo.stop();');
  assert.deepEqual(await values(), [0, 0, 0, 0, 0, 0, 0], 'the earlier installation answers again');
  f.run('guard.stop();');
  assert.deepEqual(await values(), [8192, 81, 8192, 81, 81, 8192, 8192], 'native again');
  assert.equal(f.calls().managerQuota, 1);
});

test('mode on keeps its meaning: it hides StorageManager.estimate only and leaves the other quota surfaces untouched', () => {
  const f = fixture({}, entry('on'));
  assert.equal(f.run('"estimate" in StorageManager.prototype'), false);
  assert.equal(f.run('StorageBucket.prototype.estimate === nativeMethods.bucketEstimate'), true);
  assert.equal(f.run('Object.getOwnPropertyDescriptor(Navigator.prototype, "webkitTemporaryStorage").get === nativeAccessors.webkitTemporaryStorage'), true);
});

test('insecure-context shape (no StorageManager, no buckets): the deprecated API alone is virtual and only the absent manager is unavailable', async () => {
  const f = fixture({ manager: false, bucket: false });
  const snapshot = JSON.parse(f.run('JSON.stringify(guard.snapshot())'));
  assert.equal(snapshot.unavailable, 1); assert.ok(snapshot.installed >= 2, 'both accessors');
  assert.deepEqual(JSON.parse(JSON.stringify((await query(f)).args)), [12, 1024]);
  assert.deepEqual(JSON.parse(JSON.stringify(await request(f, '2 ** 53'))), [1024]);
  assert.equal(quotaCalls(f), 0);
});

test('the three surfaces share one snapshot and one quota/usage order across calls', async () => {
  const f = fixture({}, entry('custom', { quota: 777, usage: 7 }));
  const estimate = await f.run('manager.estimate()'), bucket = await f.run('makeBucket("a").estimate()');
  const legacy = (await query(f)).args, persistent = (await query(f, 'nav.webkitPersistentStorage')).args;
  assert.deepEqual([estimate.quota, estimate.usage, bucket.quota, bucket.usage], [777, 7, 777, 7]);
  assert.deepEqual(JSON.parse(JSON.stringify(legacy)), [7, 777]); assert.deepEqual(JSON.parse(JSON.stringify(persistent)), [7, 777]);
  assert.deepEqual(JSON.parse(JSON.stringify(await request(f, '10'))), [10]);
  assert.deepEqual(JSON.parse(JSON.stringify(await request(f, '778'))), [777]);
  // Every virtual answer is counted as one applied change (manager, bucket, 2 queries, 2 requests); delegated errors are not.
  assert.equal(JSON.parse(f.run('JSON.stringify(guard.snapshot())')).changed, 6);
  assert.throws(() => f.run('nav.webkitTemporaryStorage.queryUsageAndQuota(1)'));
  assert.equal(JSON.parse(f.run('JSON.stringify(guard.snapshot())')).changed, 6);
});

test('the neutral opaque-realm guard (generated bundle) answers zero on all surfaces and never reaches a native quota operation', async () => {
  const bundle = readFileSync(new URL('../../apps/production-extension/api-custom-opaque.storage-estimate.js', import.meta.url), 'utf8');
  const f = makeRealm('opaque', brandSet());
  f.context.location = { protocol: 'about:' };
  f.run(bundle);
  const estimate = await f.run('manager.estimate()'), bucket = await f.run('makeBucket("a").estimate()');
  assert.deepEqual([estimate.quota, estimate.usage, bucket.quota, bucket.usage], [0, 0, 0, 0]);
  assert.deepEqual(JSON.parse(JSON.stringify((await query(f)).args)), [0, 0]);
  assert.deepEqual(JSON.parse(JSON.stringify(await request(f, '2 ** 53'))), [0]);
  assert.equal(quotaCalls(f), 0);
});
