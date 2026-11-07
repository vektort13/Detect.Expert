// ADR-047 (S2, port plan §2.1 B1–B8; S4: B9): the service worker of the module «Защита» is linked into background.js only by
// the injection fields; every message has exactly one responder; the patched production pieces behave as before when
// the module is absent (vm tests run them without protectHost).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { EDITS, PROTECT_SW_IMPORT, patchBackground } from '../sync-protect-sw.mjs';

const root = resolve(import.meta.dirname, '../../..');
const ext = join(root, 'apps/production-extension');
const source = readFileSync(join(ext, 'background.js'), 'utf8');

test('sync-protect-sw --check: background.js carries B1–B9 exactly once; a second run changes nothing', () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts/production/sync-protect-sw.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.equal(patchBackground(source), source);
  assert.ok(source.startsWith(PROTECT_SW_IMPORT), 'B1 is the first line');
  assert.equal(source.split('from "./protect-sw.js"').length - 1, 1);
  const b8 = source.indexOf('// ADR-047 protect integration start'), start = source.indexOf('\nbackground.start();\n');
  assert.ok(b8 > 0 && b8 < start && source.indexOf('// ADR-047 protect integration end') < start, 'B8 precedes background.start()');
  assert.ok(source.indexOf('chrome.runtime.onMessage.addListener(background.onMessage);') < b8, 'production listener registration is unchanged');
  for (const edit of EDITS) if (edit.kind === 'block') assert.equal(source.split(edit.begin).length - 1, 1, edit.id);
  assert.match(source, /\nfunction createMessageListener\(runtime\) \{\n/, 'header the vm tests cut at is unchanged');
});

test('markers and imports remain strict instead of guessing', () => {
  assert.throws(() => patchBackground(source + '\n// ADR-047 protect integration start\n'), /B8/);
  assert.throws(() => patchBackground('// x\n' + source), /B1/);
});

for (const id of ['B5', 'B6']) for (const variant of [0, 1]) test(id + ' variant' + variant + ': reverted anchors migrate once; duplicate or mixed forms fail', () => {
  const edit = EDITS.find(edit => edit.id.startsWith(id + ' '));
  const pairs = [{ before: edit.before, after: edit.after }, ...edit.variants];
  const current = pairs.filter(pair => source.includes(pair.after));
  assert.equal(current.length, 1, 'one shipped applied form');
  const expected = source.replace(current[0].after, pairs[variant].after);
  assert.equal(patchBackground(expected), expected, 'the reviewed applied form is idempotent');
  const reverted = expected.replace(pairs[variant].after, pairs[variant].before);
  assert.notEqual(reverted, expected);
  assert.equal(patchBackground(reverted), expected, 'the same form is re-applied without changing other integration');
  assert.throws(() => patchBackground(reverted + '\n' + pairs[variant].before), new RegExp(id));
  assert.throws(() => patchBackground(expected + '\n' + pairs[variant].after), new RegExp(id));
  assert.throws(() => patchBackground(expected + '\n' + pairs[1 - variant].before), new RegExp(id));
  assert.throws(() => patchBackground(expected + '\n' + pairs[1 - variant].after), new RegExp(id));
});

test('B6 refuses to move the module clear callback before an existing authority guard', () => {
  const edit = EDITS.find(edit => edit.id.startsWith('B6 '));
  const reordered = source.replace(edit.variants[0].after, edit.after + '    await this.ensureHistory();\n');
  assert.notEqual(reordered, source);
  assert.throws(() => patchBackground(reordered), /B6.*authority guard/);
});

/** Minimal chrome stub (as protect-build.test.mjs): events record listeners; storage and scripting answer empty. */
function chromeStub() {
  const events = {};
  const event = (name) => (events[name] = { listeners: [], addListener(fn) { this.listeners.push(fn); }, removeListener() {}, hasListener: () => false });
  const area = () => ({ get: async () => ({}), set: async () => undefined, remove: async () => undefined, getBytesInUse: async () => 0, getKeys: async () => [], onChanged: event('area') });
  return {
    events,
    chrome: {
      runtime: { id: 'abcdefghijklmnopabcdefghijklmnop', onMessage: event('onMessage'), getURL: (p) => 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/' + p, sendMessage: async () => undefined },
      webNavigation: { onCommitted: event('onCommitted') },
      tabs: { onRemoved: event('onRemoved'), onReplaced: event('onReplaced'), onActivated: event('onActivated'), sendMessage: async () => undefined, query: async () => [] },
      windows: { onFocusChanged: event('onFocusChanged'), onRemoved: event('onWindowRemoved') },
      permissions: { onAdded: event('onAdded'), onRemoved: event('onRemoved2'), contains: async () => true },
      storage: { local: area(), session: area(), managed: { get: async () => ({}), onChanged: event('managed') }, onChanged: event('storage') },
      scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => undefined, unregisterContentScripts: async () => undefined, updateContentScripts: async () => undefined },
      webRequest: { onBeforeRequest: event('wr1'), onSendHeaders: event('wr2'), onErrorOccurred: event('wr3'), onCompleted: event('wr4') },
      action: { setBadgeText: async () => undefined },
      i18n: { getUILanguage: () => 'ru', getMessage: () => '' },
    },
  };
}

/** The shipped createMessageListener, run in vm with a recording route (the production router answers everything). */
function productionListener(ownsMessage) {
  const from = source.indexOf('function createMessageListener(runtime) {'), to = source.indexOf('// packages/background/src/network.ts', from);
  assert.ok(from > 0 && to > from);
  const routed = [];
  const context = vm.createContext({ uiError: (code) => ({ schemaVersion: 1, type: 'error', code }), route: async (_runtime, message) => (routed.push(message), { schemaVersion: 1, type: 'ok' }) });
  vm.runInContext(source.slice(from, to) + '\nglobalThis.make = createMessageListener;', context);
  return { listener: context.make(ownsMessage === undefined ? {} : { ownsMessage }), routed };
}

const MODULE_PAGE = ['protect-hello', 'protect-arm', 'protect-input', 'protect-events'];
const FOREIGN = ['sensor-events', 'ui-get-report', 'ui-protection-get', 'ui-protection-set', 'ui-clear-session', 'protection-query', 'protect-ack', 'protect-control', 'ui-protect-', 'UI-PROTECT-GET-STATE', ''];

test('B2: exactly one responder per message — module types only protect-sw.js, everything else only production', async () => {
  const stub = chromeStub();
  globalThis.chrome = stub.chrome;
  try {
    const mod = await import(pathToFileURL(join(ext, 'protect-sw.js')).href + '?integration=' + Date.now());
    const contracts = readFileSync(join(root, 'vendor/protect-722fae8/packages/contracts/src/messages.ts'), 'utf8');
    const ui = [...new Set([...contracts.matchAll(/'(ui-protect-[a-z-]+)'/g)].map((m) => m[1]))];
    assert.equal(ui.length, 22, 'the 22 ui-protect-* request types of 722fae8');
    const owned = [...MODULE_PAGE, ...ui];
    const moduleListener = stub.events.onMessage.listeners[0];
    const { listener, routed } = productionListener((m) => mod.protectHost.owns(m));
    const sender = { id: stub.chrome.runtime.id, origin: 'chrome-extension://' + stub.chrome.runtime.id, url: 'chrome-extension://' + stub.chrome.runtime.id + '/options.html', tab: { id: 9 } };
    for (const type of owned) {
      let productionAnswers = 0;
      assert.equal(listener({ schemaVersion: 1, type }, sender, () => productionAnswers++), false, 'production ' + type);
      assert.equal(productionAnswers, 0);
      assert.equal(mod.protectHost.owns({ schemaVersion: 1, type }), true, type);
    }
    assert.equal(routed.length, 0, 'module types never reach the production router');
    for (const type of FOREIGN) {
      let moduleAnswers = 0;
      assert.equal(moduleListener({ schemaVersion: 1, type }, sender, () => moduleAnswers++), false, 'module ' + type);
      assert.equal(moduleAnswers, 0);
      const answer = await new Promise((done) => assert.equal(listener({ schemaVersion: 1, type }, sender, done), true, 'production ' + type));
      assert.deepEqual(answer, { schemaVersion: 1, type: 'ok' });
    }
    // Not plain own data: an inherited `type`, a non-object, null.
    for (const message of [Object.create({ type: 'protect-hello' }), 'ui-protect-get-state', null, 7]) {
      assert.equal(listener(message, sender, () => undefined), true);
      assert.equal(moduleListener(message, sender, () => undefined), false);
    }
  } finally {
    delete globalThis.chrome;
  }
});

test('B2: without the injection field (vm tests, Firefox stub) the production listener answers everything as before', async () => {
  for (const ownsMessage of [undefined, () => false]) {
    const { listener, routed } = productionListener(ownsMessage);
    for (const type of [...MODULE_PAGE, 'ui-protect-get-state', ...FOREIGN]) assert.equal(listener({ schemaVersion: 1, type }, {}, () => undefined), true);
    await Promise.resolve();
    assert.equal(routed.length, MODULE_PAGE.length + 1 + FOREIGN.length);
  }
  const { listener } = productionListener(() => { throw new Error('owner failed'); });
  assert.throws(() => listener({ type: 'x' }, {}, () => undefined), /owner failed/, 'B8 wraps owns() in try/catch, the listener itself does not');
  assert.match(source, /background\.runtime\.ownsMessage = \(message\) => \{\n  try \{\n    return protectHost\.owns\(message\) === true;\n  \} catch \{\n    return false;\n  \}\n\};/);
});

test('Firefox stub: same export names as protect-sw.js; B1 imports only exported names; every member inert', async () => {
  const stub = await import(pathToFileURL(join(root, 'apps/production-protect/firefox/protect-sw.js')).href);
  const real = readFileSync(join(ext, 'protect-sw.js'), 'utf8');
  const exported = real.slice(real.lastIndexOf('export {')).match(/\{([^}]*)\}/)[1].split(',').map((s) => s.trim()).filter(Boolean).sort();
  assert.deepEqual(Object.keys(stub).sort(), exported);
  for (const name of PROTECT_SW_IMPORT.match(/\{([^}]*)\}/)[1].split(',').map((s) => s.trim())) assert.ok(exported.includes(name), name);
  const host = stub.protectHost;
  assert.equal(Object.isFrozen(host), true);
  assert.equal(host.owns({ type: 'protect-hello' }), false);
  assert.equal(host.badgeFor(1, 'ru'), null);
  assert.deepEqual(host.sessionKeys(), []);
  assert.equal(stub.isProtectSessionKey('protect-tabs'), false);
  for (const fn of ['attach', 'reportPersisted', 'clearSession', 'observationMainRegistered']) assert.equal(host[fn](), undefined, fn);
});

// B4: ScopeController (as automatic-observation.test.mjs) — the hook runs after a successful registration only.
const scopeStart = source.indexOf('// packages/contracts/src/data-consent.ts');
const scopeEnd = source.indexOf('// packages/background/src/visual-preview.ts', scopeStart);
function scopeFixture({ failRegister = false } = {}) {
  const local = {}, scripts = new Map();
  const area = (store) => ({
    get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => Object.hasOwn(store, key)).map((key) => [key, store[key]])),
    set: async (value) => { Object.assign(store, structuredClone(value)); },
    remove: async (key) => { delete store[key]; },
  });
  const api = {
    storage: { local: area(local), session: area({}) },
    runtime: { getManifest: () => ({ host_permissions: ['http://*/*', 'https://*/*'] }) },
    permissions: { getAll: async () => ({ origins: ['<all_urls>'] }), contains: async () => true },
    scripting: {
      getRegisteredContentScripts: async () => [...scripts.values()],
      registerContentScripts: async (entries) => { if (failRegister) throw new Error('register failed'); for (const entry of entries) scripts.set(entry.id, structuredClone(entry)); },
      updateContentScripts: async (entries) => { for (const entry of entries) scripts.set(entry.id, structuredClone(entry)); },
      unregisterContentScripts: async ({ ids }) => { for (const id of ids) scripts.delete(id); },
    },
  };
  const realm = vm.createContext({ api, SCOPE_MODES: ['off', 'all-sites', 'site', 'active-tab'], BUDGETS: { maxHostsPerDocument: 32 },
    isSanitizedHost: (value) => typeof value === 'string' && /^[a-z0-9.-]+$/.test(value), clock: { now: () => 10000 } });
  vm.runInContext(source.slice(scopeStart, scopeEnd) + '\nglobalThis.controller = new ScopeController(api, clock);', realm);
  return { controller: realm.controller, scripts };
}

test('B4: onMainRegistered follows each successful detector-main-v1 registration/update, never a failed one', async () => {
  const ok = scopeFixture();
  assert.equal(ok.controller.onMainRegistered, null);
  let calls = 0;
  ok.controller.onMainRegistered = () => { calls++; throw new Error('module failure stays local'); };
  await ok.controller.startup();
  assert.equal(ok.scripts.size, 2);
  assert.ok(calls >= 1, 'called after registration');
  assert.equal(ok.controller.registrationOk, true, 'a throwing hook does not fail the production registration');
  const before = calls;
  await ok.controller.ensureRegistration();
  assert.equal(calls, before + 1, 'called again after an update (the module re-orders its MAIN)');
  const failed = scopeFixture({ failRegister: true });
  let failedCalls = 0;
  failed.controller.onMainRegistered = () => failedCalls++;
  await failed.controller.startup();
  assert.equal(failed.scripts.size, 0);
  assert.equal(failedCalls, 0);
  const absent = scopeFixture();
  await absent.controller.startup();
  assert.equal(absent.scripts.size, 2, 'no hook assigned: registration as before');
});

/** A BackgroundRuntime method of the shipped bundle, as a plain function (vm, no Function constructor). */
function runtimeMethod(signature, next, globals = {}) {
  const from = source.indexOf(signature), to = source.indexOf(next, from);
  assert.ok(from > 0 && to > from, signature);
  return vm.runInNewContext('({' + source.slice(from, to) + '})', { Math, Array, PRO_STORAGE_KEY: 'pro-recording-v1', PRO_LIMITS: { maxBytes: 2097152 }, ...globals });
}

test('B7: the module session keys are subtracted (bounded at 1 MiB) before the Pro allowance; absent module = as before', async () => {
  const { ordinaryMeasuredBytes } = runtimeMethod('  async ordinaryMeasuredBytes() {', '  /** Ordinary session budget:');
  const sizes = { all: 3_000_000, 'protect-tabs': 1000, 'protect-runtime': 500, 'protect-doc:1:0:A': 200_000, 'pro-recording-v1': 400_000 };
  const self = (protectSessionKeys, pro = false) => ({
    repository: { bytesInUse: async (keys = null) => keys === null ? sizes.all : keys.reduce((sum, key) => sum + (sizes[key] ?? 0), 0) },
    pro: { hasSession: () => pro },
    ...(protectSessionKeys === undefined ? {} : { protectSessionKeys }),
  });
  assert.equal(await ordinaryMeasuredBytes.call(self(undefined)), 3_000_000);
  const keys = async () => ['protect-tabs', 'protect-runtime', 'protect-doc:1:0:A'];
  const measured = self(keys);
  assert.equal(await ordinaryMeasuredBytes.call(measured), 3_000_000 - 201_500);
  assert.equal(measured.lastMeasuredBytes, 3_000_000, 'diagnostics keep the raw browser figure');
  assert.equal(await ordinaryMeasuredBytes.call(self(keys, true)), 3_000_000 - 201_500 - 400_000);
  assert.equal(await ordinaryMeasuredBytes.call(self(async () => [])), 3_000_000);
  assert.equal(await ordinaryMeasuredBytes.call(self(async () => { throw new Error('x'); })), 3_000_000);
  sizes['protect-doc:1:0:A'] = 5_000_000; sizes.all = 6_000_000;
  assert.equal(await ordinaryMeasuredBytes.call(self(keys)), 6_000_000 - 1_048_576, 'a runaway module cannot hide more than its 1 MiB');
});

test('B5/B6: persisted reports and ui-clear-session reach the module only through optional fields', () => {
  const b5 = EDITS.find(edit => edit.id.startsWith('B5 ')), b6 = EDITS.find(edit => edit.id.startsWith('B6 '));
  assert.equal(source.split(b5.variants[0].after).length - 1, 1);
  assert.equal(source.split(b6.variants[0].after).length - 1, 1);
  for (const field of ['onProtectReportPersisted', 'onProtectClearSession', 'protectSessionKeys', 'ownsMessage']) {
    assert.equal(source.split('background.runtime.' + field + ' = ').length - 1, 1, field);
  }
});

test('B5 notifies history only after a successful durable persist; unread authority stays closed', async () => {
  const { persistNow } = runtimeMethod('  async persistNow(documentKey) {', '  /** ADR-023 gives', {
    BUDGETS: { maxReportSerializedBytes: 102400 }, estimateReportBytes: () => 10, planEviction: () => [],
  });
  const report = {}, meta = { sessions: [{ bridgeSessionId: 'owned', lastCommittedBatchSeq: 1 }] };
  const fixture = (committed, historyLoaded = true) => {
    const calls = [];
    return { calls, self: {
      historyLoaded, now: () => 10, persistCooldownUntil: 0, maxPersistAttempts: 1, persistFailures: 0,
      state: { reports: new Map([['doc', report]]), metas: new Map([['doc', meta]]) }, dirtyDocs: new Set(['doc']),
      indexDirty: false, estimated: new Map(), persisted: new Map(), foldTransportDrops() {}, apply() {},
      repository: { async commit() { calls.push('commit'); return { ok: committed }; } },
      enforceTotalBudget() { calls.push('budget'); },
      onProtectReportPersisted(key, actualReport, actualMeta) { calls.push('module'); assert.equal(key, 'doc'); assert.equal(actualReport, report); assert.equal(actualMeta, meta); },
    } };
  };
  const success = fixture(true); assert.equal(await persistNow.call(success.self, 'doc'), true); assert.deepEqual(success.calls, ['commit', 'budget', 'module']);
  const failure = fixture(false); assert.equal(await persistNow.call(failure.self, 'doc'), false); assert.deepEqual(failure.calls, ['commit']);
  const unread = fixture(true, false); assert.equal(await persistNow.call(unread.self, 'doc'), false); assert.deepEqual(unread.calls, []);
  const absent = fixture(true); delete absent.self.onProtectReportPersisted; assert.equal(await persistNow.call(absent.self, 'doc'), true); assert.deepEqual(absent.calls, ['commit', 'budget']);
});

test('B6 waits for authority before clearing module data, and a rejected authority never calls the module', async () => {
  const { clearSession } = runtimeMethod('  async clearSession() {', '  /** Export preview');
  let release, called = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const stopped = Error('stop after the checked callback');
  const work = clearSession.call({ ready: Promise.resolve(), ensureHistory: () => pending, onProtectClearSession() { called++; throw stopped; } });
  const checked = assert.rejects(work, error => error === stopped);
  await Promise.resolve(); await Promise.resolve(); assert.equal(called, 0);
  release(); await checked; assert.equal(called, 1);
  await assert.rejects(clearSession.call({ ready: Promise.resolve(), async ensureHistory() { throw Error('authority unread'); }, onProtectClearSession() { called++; } }), /authority unread/);
  assert.equal(called, 1);
});

// B9 (S4): discardUnconsentedData wipes storage.session through SessionRepository.clearAll; the module's own keys stay.
test('B9: the production data-consent wipe keeps exactly the module session keys; absent field or stub = wipe as before', async () => {
  const from = source.indexOf('var SessionRepository = class {'), to = source.indexOf('// packages/contracts/src/data-consent.ts', from);
  assert.ok(from > 0 && to > from);
  const realm = vm.createContext({ CLEAR_FENCES_KEY: 'clear-epochs:v1' });
  const helperStart = source.indexOf('/* clear-reset:session-key-enumeration:start */'), helperEnd = source.indexOf('/* clear-reset:session-key-enumeration:end */');
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  vm.runInContext(source.slice(helperStart, helperEnd) + source.slice(from, to) + '\nglobalThis.Repository = SessionRepository;', realm);
  const stub = chromeStub();
  globalThis.chrome = stub.chrome;
  let real;
  try {
    real = await import(pathToFileURL(join(ext, 'protect-sw.js')).href + '?b9=' + Date.now());
  } finally {
    delete globalThis.chrome;
  }
  const firefox = await import(pathToFileURL(join(root, 'apps/production-protect/firefox/protect-sw.js')).href);
  // The shipped B8 binding, evaluated as it is in background.js.
  const b8 = source.split('\n').filter((line) => line.startsWith('background.runtime.keepProtectSessionKey = '));
  assert.equal(b8.length, 1, 'B8 assigns keepProtectSessionKey once');
  const bind = (isProtectSessionKey) => {
    const holder = vm.createContext({ background: { runtime: {} }, isProtectSessionKey });
    vm.runInContext(b8[0], holder);
    return holder.background.runtime.keepProtectSessionKey;
  };
  const PENDING = 'data-consent:pending-v1';
  const KEYS = [PENDING, 'detector-index-v1', 'doc:1:0:A', 'clear-epochs:v1', 'precursor-credential:v1', 'protect-tabs', 'protect-runtime', 'protect-doc:7:0:abc', 'protection:v1', 'protect', 'protectx', 'protect-docs', 'pro-recording-v1'];
  const wipe = async (keepKeys, keepKey) => {
    const store = Object.fromEntries(KEYS.map((key) => [key, { v: 1 }]));
    let cleared = 0;
    const storage = {
      get: async () => ({ ...store }),
      remove: async (list) => { for (const key of list) delete store[key]; },
      clear: async () => { cleared++; for (const key of Object.keys(store)) delete store[key]; },
    };
    const repository = new realm.Repository(storage);
    repository.fences.set('owned', {});
    const ok = keepKey === undefined ? await repository.clearAll(keepKeys) : await repository.clearAll(keepKeys, keepKey);
    assert.equal(repository.fences.size, 0, 'the observation clear authority and its in-memory cache are wiped');
    return { ok, kept: Object.keys(store).sort(), cleared };
  };
  const moduleKeys = ['protect-doc:7:0:abc', 'protect-runtime', 'protect-tabs'];
  assert.deepEqual(await wipe([PENDING]), { ok: true, kept: [PENDING], cleared: 0 }, 'production call without the field: as before');
  assert.deepEqual(await wipe([PENDING], undefined), { ok: true, kept: [PENDING], cleared: 0 }, 'this.keepProtectSessionKey unassigned (vm tests)');
  assert.deepEqual(await wipe([PENDING], bind(real.isProtectSessionKey)), { ok: true, kept: [PENDING, ...moduleKeys].sort(), cleared: 0 }, 'module keys survive, nothing else');
  assert.deepEqual(await wipe([PENDING], bind(firefox.isProtectSessionKey)), { ok: true, kept: [PENDING], cleared: 0 }, 'Firefox stub keeps nothing');
  assert.deepEqual(await wipe([PENDING], () => { throw new Error('x'); }), { ok: true, kept: [PENDING], cleared: 0 }, 'a throwing predicate removes');
  assert.deepEqual(await wipe([PENDING], () => 1), { ok: true, kept: [PENDING], cleared: 0 }, 'only an exact true keeps');
  assert.deepEqual(await wipe([]), { ok: true, kept: [], cleared: 1 }, 'no keep list: storage.clear() as before');
  assert.deepEqual(await wipe([], bind(real.isProtectSessionKey)), { ok: true, kept: moduleKeys, cleared: 0 });
  // The keep rule is the exact module rule: storage.local "protect", production "protection:*" and look-alikes go.
  const keep = bind(real.isProtectSessionKey);
  for (const key of ['protect', 'protectx', 'protect-docs', 'protection:v1', 'Protect-tabs', 7, null]) assert.equal(keep(key), false, String(key));
  // Call site: discardUnconsentedData passes the injection field; no other clearAll call exists.
  const discard = source.slice(source.indexOf('  async discardUnconsentedData() {'), source.indexOf('  /** Permission change (grant or revoke)'));
  assert.ok(discard.includes('cleared = await this.repository.clearAll([DATA_CONSENT_PENDING_KEY], this.keepProtectSessionKey);'));
  assert.equal(source.split('.clearAll(').length - 1, 1, 'one clearAll call site');
});
