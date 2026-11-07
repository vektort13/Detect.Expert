// REQ-004/009/012: independent tests against the delivered protection route and revision gate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'reviewed production module boundaries: ' + start);
  return source.slice(from, to);
}
const contracts = section('// packages/contracts/src/protection.ts', '// packages/contracts/src/rtc-values.ts');
const senderVerifier = section('function verifyUiSender(', 'function redactSenderContext(');
const controllerSource = section('// packages/background/src/protection-plan.ts', '// ADR-017: Pro values');
const initialSettings = () => ({
  schemaVersion: 1, revision: 7, enabled: false, preset: 'limited',
  global: [{ feature: 'audio', state: 'allow' }, { feature: 'canvas-readback', state: 'block' }],
  sites: [
    { host: 'example.com', disabled: false, rules: [{ feature: 'local-fonts', state: 'allow' }] },
    { host: 'other.example.com', disabled: true, rules: [{ feature: 'webrtc', state: 'block' }] },
  ],
});

function fixture(origin = 'chrome-extension://fixture') {
  const events = [], registered = [], store = {
    'protection:v1': initialSettings(), 'protection:compatibility:1.1.0': true,
  };
  let documentId = 'native-document';
  const api = {
    runtime: { id: 'fixture' },
    storage: { local: {
      get: async () => ({ ...store }),
      set: async value => { events.push({ type: 'storage', value }); Object.assign(store, value); },
    } },
    scripting: {
      getRegisteredContentScripts: async () => [...registered],
      registerContentScripts: async items => { events.push({ type: 'register' }); registered.push(...items); },
      updateContentScripts: async items => {
        events.push({ type: 'update' });
        for (const item of items) registered[registered.findIndex(entry => entry.id === item.id)] = item;
      },
      unregisterContentScripts: async ({ ids }) => {
        events.push({ type: 'unregister' });
        for (let index = registered.length - 1; index >= 0; --index) if (ids.includes(registered[index].id)) registered.splice(index, 1);
      },
    },
    tabs: {
      query: async () => [{ id: 11 }],
      get: async tabId => { events.push({ type: 'tab', tabId }); return { id: tabId, windowId: 2, url: 'https://example.com/', status: 'complete' }; },
      sendMessage: async (tabId, message) => { events.push({ type: message.type, tabId }); return []; },
      reload: async tabId => { events.push({ type: 'reload', tabId }); documentId = 'next-document'; },
    },
    webNavigation: { getAllFrames: async ({ tabId }) => {
      events.push({ type: 'frames', tabId });
      return [{ frameId: 0, documentId, url: 'https://example.com/' }];
    } },
  };
  const scope = { accessReady: true, accessGeneration: 1,
    desiredMatches: () => ['https://example.com/*', 'https://other.example.com/*'],
    isGranted: async () => true };
  const realm = vm.createContext({ api, scope, URL, setTimeout, clearTimeout,
    selfOrigin: () => origin,
    isSanitizedHost: value => ['example.com', 'other.example.com', 'protection.invalid'].includes(value),
    hostPatterns: host => ['http://' + host + '/*', 'https://' + host + '/*'],
    patternCoversHost: () => true,
    sanitizeHost: raw => new URL(raw).hostname,
    bounded: async operation => operation,
  });
  vm.runInContext(contracts + '\n' + senderVerifier + '\n' + controllerSource +
    '\nglobalThis.controller = new ProtectionController(api, scope);', realm);
  const controller = realm.controller;
  const sender = { id: 'fixture', origin, url: origin + '/protection.html?tabId=11', tab: { id: 90 }, frameId: 0 };
  const route = (message, providedSender = sender) => controller.route(message, providedSender, async () => {});
  return { api, scope, controller, events, store, sender, route, origin };
}
const get = tabId => ({ schemaVersion: 1, type: 'ui-protection-get', tabId });
const set = settings => ({ schemaVersion: 1, type: 'ui-protection-set', tabId: null, settings });
const plain = value => JSON.parse(JSON.stringify(value));

for (const origin of ['chrome-extension://fixture', 'moz-extension://private-uuid']) {
  test('own standalone protection tab remains an authorized UI: ' + origin.split(':')[0], async () => {
    const f = fixture(origin);
    await f.controller.start();
    f.events.length = 0;
    const state = await f.route(get(null));
    assert.equal(state.type, 'protection-state');
    assert.equal(state.settings.enabled, false);
    assert.deepEqual(plain(state.settings), initialSettings());
    assert.equal(f.events.some(event => ['storage', 'register', 'reload', 'protection-stop'].includes(event.type)), false);
  });
}

test('site, foreign extension and contradictory own-tab senders cannot dispatch any protection action', async () => {
  const f = fixture(), badSenders = [
    { ...f.sender, id: 'foreign' },
    { ...f.sender, origin: 'https://example.com', url: 'https://example.com/protection.html', tab: { id: 11 } },
    { ...f.sender, origin: 'chrome-extension://foreign', url: 'chrome-extension://foreign/protection.html' },
    { ...f.sender, origin: undefined },
    { ...f.sender, url: 'https://example.com/protection.html' },
    { ...f.sender, url: f.origin + '.foreign/protection.html' },
    { ...f.sender, url: undefined },
  ];
  for (const sender of badSenders) for (const message of [get(null), set(initialSettings()),
    { schemaVersion: 1, type: 'ui-protection-reload', tabId: 11, documentId: 'native-document' }]) {
    assert.equal((await f.route(message, sender)).code, 'unauthorized-sender');
  }
  assert.deepEqual(f.events, []);
});

test('protection tab admits only the existing exact schemas and does not evaluate settings getters', async () => {
  const f = fixture(); let reads = 0;
  const getterSettings = initialSettings();
  Object.defineProperty(getterSettings, 'enabled', { enumerable: true, get() { reads++; throw Error('unexpected getter'); } });
  for (const message of [
    { ...get(null), host: 'foreign.example.com' },
    { ...set(initialSettings()), bypass: true },
    set({ ...initialSettings(), hostname: 'foreign.example.com' }),
    set({ ...initialSettings(), enabled: 'on' }),
    set({ ...initialSettings(), revision: -1 }),
    set({ ...initialSettings(), global: [{ feature: 'webgl', state: 'bypass' }] }),
    set(getterSettings),
    { schemaVersion: 1, type: 'ui-protection-reload', tabId: 11, documentId: 'native-document', url: 'https://foreign.example.com/' },
  ]) assert.equal((await f.route(message)).code, 'invalid-request');
  assert.equal(reads, 0);
  assert.deepEqual(f.events, []);
});

test('a master enable and disable changes only enabled and the optimistic revision, retaining every rule', async () => {
  const f = fixture(), base = (await f.route(get(null))).settings;
  const on = await f.route(set({ ...base, enabled: true }));
  assert.equal(on.type, 'protection-state');
  assert.deepEqual(plain(on.settings), { ...initialSettings(), enabled: true, revision: 8 });
  const off = await f.route(set({ ...on.settings, enabled: false }));
  assert.equal(off.type, 'protection-state');
  assert.deepEqual(plain(off.settings), { ...initialSettings(), revision: 9 });
  assert.deepEqual(plain(f.store['protection:v1']), { ...initialSettings(), revision: 9 });
  assert.equal(f.events.some(event => event.type === 'reload'), false);
});

test('parallel saves from an editor and launcher cannot overwrite each other at the same revision', async () => {
  const f = fixture(), base = (await f.route(get(null))).settings;
  const edited = { ...base, global: [...base.global, { feature: 'webrtc', state: 'block' }] };
  const [editor, launcher] = await Promise.all([f.route(set(edited)), f.route(set({ ...base, enabled: true }))]);
  assert.equal(editor.type, 'protection-state');
  assert.equal(launcher.code, 'stale-revision');
  assert.deepEqual(plain(f.store['protection:v1']), { ...plain(edited), revision: 8 });
  const current = await f.route(get(null));
  const retry = await f.route(set({ ...current.settings, enabled: true }));
  assert.equal(retry.type, 'protection-state');
  assert.equal(retry.settings.enabled, true);
  assert.deepEqual(plain(retry.settings.global), plain(edited.global));
  assert.equal(retry.settings.revision, 9);
});

test('native reload remains bound to the originating site tab and its current document', async () => {
  const f = fixture();
  const before = await f.route(get(11));
  assert.equal(before.documentId, 'native-document');
  const stale = await f.route({ schemaVersion: 1, type: 'ui-protection-reload', tabId: 11, documentId: 'replaced-document' });
  assert.equal(stale.code, 'stale-document');
  assert.equal(f.events.some(event => event.type === 'reload'), false);
  const current = await f.route({ schemaVersion: 1, type: 'ui-protection-reload', tabId: 11, documentId: before.documentId });
  assert.equal(current.type, 'protection-state');
  assert.equal(current.documentId, 'next-document');
  assert.deepEqual(f.events.filter(event => event.type === 'reload'), [{ type: 'reload', tabId: 11 }]);
  assert.equal(f.events.some(event => event.type === 'frames' && event.tabId === f.sender.tab.id), false);
});

test('a pending navigation cannot be cancelled by the previous committed document reload', async () => {
  for (const navigation of [
    { pendingUrl: 'https://other.example.com/new', status: 'loading' },
    { pendingUrl: 'https://example.com/', status: 'complete' },
  ]) {
    const f = fixture(); await f.controller.start(); f.events.length = 0;
    const getTab = f.api.tabs.get;
    f.api.tabs.get = async tabId => ({ ...await getTab(tabId), ...navigation });
    const result = await f.route({ schemaVersion: 1, type: 'ui-protection-reload', tabId: 11, documentId: 'native-document' });
    assert.equal(result.code, 'stale-document');
    assert.equal(f.events.some(event => event.type === 'reload'), false);
    assert.equal(f.events.some(event => event.type === 'frames'), false, 'reject the pending native tab before using its old frame');
  }
});

test('the current document may reload while its existing subresources are still loading', async () => {
  const f = fixture(); await f.controller.start(); f.events.length = 0;
  const getTab = f.api.tabs.get;
  f.api.tabs.get = async tabId => ({ ...await getTab(tabId), status: 'loading' });
  const result = await f.route({ schemaVersion: 1, type: 'ui-protection-reload', tabId: 11, documentId: 'native-document' });
  assert.equal(result.type, 'protection-state');
  assert.equal(result.documentId, 'next-document');
  assert.deepEqual(f.events.filter(event => event.type === 'reload'), [{ type: 'reload', tabId: 11 }]);
});

test('reload rechecks native pending navigation and URL immediately after its awaited document lookup', async () => {
  for (const navigation of [
    { pendingUrl: 'https://other.example.com/new', status: 'loading' },
    { url: 'https://other.example.com/new', status: 'complete' },
  ]) {
    const f = fixture(); await f.controller.start(); f.events.length = 0;
    let release, frameLookupStarted;
    const held = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { frameLookupStarted = resolve; });
    f.api.webNavigation.getAllFrames = async ({ tabId }) => {
      f.events.push({ type: 'frames', tabId }); frameLookupStarted(); await held;
      return [{ frameId: 0, documentId: 'native-document', url: 'https://example.com/' }];
    };
    const pending = f.route({ schemaVersion: 1, type: 'ui-protection-reload', tabId: 11, documentId: 'native-document' });
    await started;
    assert.equal(f.events.filter(event => event.type === 'tab').length, 1);
    const getTab = f.api.tabs.get;
    f.api.tabs.get = async tabId => ({ ...await getTab(tabId), ...navigation });
    release();
    const result = await pending;
    assert.equal(result.code, 'stale-document');
    assert.equal(f.events.filter(event => event.type === 'tab').length, 2);
    assert.equal(f.events.some(event => event.type === 'reload'), false);
  }
});

test('a missing native source tab cannot fall back to reloading a current or UI tab', async () => {
  const f = fixture(); await f.controller.start(); f.events.length = 0;
  f.api.tabs.get = async () => { throw Error('The source tab is closed'); };
  const result = await f.route({ schemaVersion: 1, type: 'ui-protection-reload', tabId: 11, documentId: 'native-document' });
  assert.equal(result.code, 'no-access');
  assert.equal(f.events.some(event => event.type === 'reload'), false);
});
