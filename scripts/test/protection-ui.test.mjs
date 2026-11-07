// ADR-033, ADR-046: independent lifecycle/concurrency regressions and the view-only filter for the actual shared UI.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { createProtectionUi, PROTECTION_FEATURE_FILTER, PROTECTION_FILTERS, PROTECTION_GROUPS, PROTECTION_PARTIAL, protectionRuleMode, updateProtectionRule } from '../../apps/production-extension/protection-ui.js';

const background = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
const start = background.indexOf('// packages/contracts/src/protection.ts');
const end = background.indexOf('// packages/contracts/src/rtc-values.ts', start);
assert.ok(start >= 0 && end > start);
const realm = vm.createContext({ URL, isSanitizedHost: value => ['example.com', 'other.example.com', 'protection.invalid'].includes(value) });
vm.runInContext(background.slice(start, end) + '\nglobalThis.dependencies = { PROTECTION_FEATURES, MAX_PROTECTION_SITES, readProtectionSettings, readProtectionObservations, isProtectionHost, effectiveProtection };', realm);
const dependencies = realm.dependencies;
const plain = value => JSON.parse(JSON.stringify(value));
const settings = () => ({ schemaVersion: 1, revision: 7, enabled: false, preset: 'limited',
  global: [{ feature: 'canvas-readback', state: 'block' }],
  sites: [{ host: 'other.example.com', disabled: true, rules: [{ feature: 'webrtc', state: 'block' }] }] });
const turn = () => new Promise(resolve => setImmediate(resolve));
function event() {
  const listeners = new Set();
  const counts = { added: 0, removed: 0 };
  return { counts, addListener: callback => { counts.added++; listeners.add(callback); }, removeListener: callback => { counts.removed++; listeners.delete(callback); }, emit: (...values) => { for (const listener of [...listeners]) listener(...values); }, callbacks: () => [...listeners] };
}
function server() {
  const calls = [], opened = [];
  const value = { settings: settings(), documentId: 'native-document', host: 'example.com' };
  const snapshot = tabId => ({ schemaVersion: 1, type: 'protection-state', settings: plain(value.settings), registration: value.registration ?? (value.settings.enabled ? 'ready' : 'inactive'), cleanupIncomplete: value.cleanupIncomplete ?? false,
    tabId, host: tabId === null ? null : value.host, documentId: tabId === null ? null : value.documentId, configured: [], observations: [], liveRead: 'received', integrity: 'page-controlled' });
  const api = {
    runtime: { id: 'fixture', getURL: file => 'chrome-extension://fixture/' + file, sendMessage: async request => {
      calls.push(plain(request));
      if (value.intercept) { const intercepted = value.intercept(request); if (intercepted !== undefined) return intercepted; }
      if (request.type === 'ui-protection-set') {
        if (request.settings.revision !== value.settings.revision) return { schemaVersion: 1, type: 'protection-error', code: 'stale-revision' };
        const oldValue = plain(value.settings);
        value.settings = { ...plain(request.settings), revision: request.settings.revision + 1 };
        if (value.emitStorageOnSet) api.storage.onChanged.emit({ 'protection:v1': { oldValue, newValue: plain(value.settings) } }, 'local');
      }
      if (request.type === 'ui-protection-reload') {
        if (request.documentId !== value.documentId) return { schemaVersion: 1, type: 'protection-error', code: 'stale-document' };
        value.documentId = 'next-document';
        api.webNavigation.onCommitted.emit({ tabId: request.tabId, frameId: 0, documentId: value.documentId });
      }
      return snapshot(request.tabId);
    } },
    tabs: { create: async input => { opened.push(input); }, onRemoved: event() },
    webNavigation: { onCommitted: event() }, permissions: { onRemoved: event(), onAdded: event() },
    storage: { onChanged: event() },
  };
  return { api, value, calls, opened, snapshot };
}
function harness(api, component = 'ProtectionSettings', initialProps = { tabId: null, global: true }, { translate = key => key } = {}) {
  const slots = [], effects = [];
  let cursor = 0, dirty = true, props = initialProps, tree;
  const hooks = {
    useState(initial) {
      const index = cursor++, slot = slots[index] ??= { value: initial };
      return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }];
    },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback, dependencies) {
      const slot = slots[cursor++] ??= {};
      if (!slot.dependencies || !dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) {
        slot.dependencies = dependencies;
        effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); });
      }
    },
  };
  const ui = createProtectionUi({ ...dependencies, ...hooks, h: (type, props) => ({ type, props }), useLocale: () => 'en', translate, browserApi: api });
  function render(commit = true) {
    cursor = 0; dirty = false;
    tree = ui[component](props);
    if (commit) while (effects.length) effects.shift()();
    return tree;
  }
  async function settle() {
    for (let index = 0; index < 12; index++) { if (dirty) render(); await turn(); }
    if (dirty) render();
    return tree;
  }
  function nodes(predicate) {
    const result = [];
    const visit = node => {
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (!node || typeof node !== 'object' || !node.props) return;
      if (predicate(node)) result.push(node);
      visit(node.props.children);
    };
    visit(tree); return result;
  }
  const master = () => nodes(node => node.type?.name === 'MasterSwitch')[0];
  const action = name => nodes(node => node.props['data-protection-action'] === name)[0];
  const feature = name => nodes(node => node.props.feature === name)[0];
  return { render, settle, master, action, feature, nodes,
    update: (next, commit = true) => { props = { ...props, ...next }; dirty = true; return render(commit); },
    unmount: () => { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('the three API states retain existing priority semantics and touch only the selected override', () => {
  const base = [{ feature: 'audio', state: 'allow' }];
  const on = updateProtectionRule(base, 'window-management', 'on');
  const off = updateProtectionRule(on, 'window-management', 'off');
  const bypass = updateProtectionRule(off, 'window-management', 'bypass');
  assert.deepEqual(on, [...base, { feature: 'window-management', state: 'block' }]);
  assert.deepEqual(off, [...base, { feature: 'window-management', state: 'allow' }]);
  assert.deepEqual(bypass, base);
  assert.deepEqual(base, [{ feature: 'audio', state: 'allow' }]);
  assert.equal(protectionRuleMode(on, 'window-management'), 'on');
  assert.equal(protectionRuleMode(off, 'window-management'), 'off');
  assert.equal(protectionRuleMode(bypass, 'window-management'), 'bypass');
  const policy = { ...settings(), enabled: true, global: bypass };
  assert.ok(dependencies.effectiveProtection(policy, 'example.com').includes('window-management'), 'BYPASS inherits the Limited preset');
  assert.equal(dependencies.effectiveProtection({ ...policy, global: off }, 'example.com').includes('window-management'), false, 'OFF overrides the preset');
  assert.equal(dependencies.effectiveProtection({ ...policy, enabled: false, global: on }, 'example.com').length, 0, 'API ON does not override the master OFF');
});

test('mounting and opening settings read metadata without enabling or saving policy, retaining the site tab ID', async () => {
  const s = server(), h = harness(s.api, 'ProtectionLauncher', { tabId: 11, documentKey: '11:0:native-document' });
  try {
    h.render(); await h.settle();
    assert.equal(h.master().props.enabled, false);
    assert.equal(s.calls.every(call => call.type === 'ui-protection-get' && call.tabId === 11), true);
    await h.action('open').props.onClick(); await h.settle();
    assert.deepEqual(s.opened, [{ url: 'chrome-extension://fixture/options.html?tabId=11#api', active: true }]);
    assert.equal(s.calls.some(call => call.type === 'ui-protection-set'), false);
    assert.equal(s.value.settings.enabled, false);
  } finally { h.unmount(); }
});

test('master click preserves the requested ON intent if another editor enabled it before the fresh native read', async () => {
  const s = server(), h = harness(s.api, 'ProtectionLauncher', { tabId: 11, documentKey: '11:0:native-document' });
  try {
    h.render(); await h.settle();
    assert.equal(h.master().props.enabled, false);
    s.value.settings = { ...s.value.settings, enabled: true, revision: 8 };
    await h.master().props.onChange(); await h.settle();
    assert.equal(s.value.settings.enabled, true);
    assert.equal(h.master().props.enabled, true);
    assert.equal(s.calls.some(call => call.type === 'ui-protection-set'), false);
  } finally { h.unmount(); }
});

test('a local draft survives own master write but never rebases across another editor revision', async () => {
  for (const externalEdit of [false, true]) {
    const s = server(), h = harness(s.api);
    try {
      h.render(); await h.settle();
      h.feature('audio').props.onChange('on'); await h.settle();
      if (externalEdit) s.value.settings = { ...s.value.settings, revision: 8, global: [...s.value.settings.global, { feature: 'webrtc', state: 'block' }] };
      await h.master().props.onChange(); await h.settle();
      assert.equal(s.value.settings.enabled, true);
      assert.equal(h.feature('audio').props.value, externalEdit ? 'bypass' : 'on');
      assert.equal(h.feature('webrtc').props.value, externalEdit ? 'on' : 'bypass');
      if (!externalEdit) { await h.action('save').props.onClick(); await h.settle(); }
      assert.equal(s.value.settings.global.some(rule => rule.feature === (externalEdit ? 'webrtc' : 'audio') && rule.state === 'block'), true);
      assert.equal(s.value.settings.sites[0].host, 'other.example.com');
    } finally { h.unmount(); }
  }
});

test('a concurrent edit discovered by the save read cannot be replaced by the stale draft', async () => {
  const s = server(), h = harness(s.api);
  try {
    h.render(); await h.settle();
    h.feature('audio').props.onChange('on'); await h.settle();
    s.value.settings = { ...s.value.settings, revision: 8, global: [...s.value.settings.global, { feature: 'webrtc', state: 'allow' }] };
    await h.action('save').props.onClick(); await h.settle();
    assert.equal(s.calls.some(call => call.type === 'ui-protection-set'), false);
    assert.equal(s.value.settings.revision, 8);
    assert.equal(h.feature('audio').props.value, 'bypass');
    assert.equal(h.feature('webrtc').props.value, 'off');
    assert.ok(h.nodes(node => node.props.role === 'alert').length);
  } finally { h.unmount(); }
});

test('changing the document prop rejects an in-flight master response even before deferred effects run', async () => {
  const s = server(), h = harness(s.api, 'ProtectionLauncher', { tabId: 11, documentKey: '11:0:native-document' });
  let resolveRead;
  try {
    h.render(); await h.settle();
    const old = s.snapshot(11);
    s.value.intercept = request => request.type === 'ui-protection-get' ? new Promise(resolve => { resolveRead = resolve; }) : undefined;
    const clicked = h.master().props.onChange(); await turn();
    assert.equal(typeof resolveRead, 'function');
    h.update({ documentKey: '11:0:next-document' }, false);
    resolveRead(old);
    await clicked;
    assert.equal(s.calls.some(call => call.type === 'ui-protection-set'), false);
    assert.equal(s.value.settings.enabled, false);
    s.value.intercept = null; s.value.documentId = 'next-document';
    h.render(); await h.settle();
    assert.equal(h.master().props.enabled, false);
    assert.equal(h.master().props.disabled, false);
  } finally { h.unmount(); }
});

test('a timed-out native read keeps the physical lock and navigation queues one fresh read', async t => {
  const timers = new Map(); let timerId = 0;
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { assert.equal(delay, 5000); timers.set(++timerId, callback); return timerId; });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  const s = server(), h = harness(s.api, 'ProtectionLauncher', { tabId: 11, documentKey: '11:0:native-document' });
  let releaseRead;
  s.value.intercept = request => request.type === 'ui-protection-get' ? new Promise(resolve => { releaseRead = resolve; }) : undefined;
  try {
    h.render(); await h.settle();
    assert.equal(s.calls.length, 1);
    for (const callback of [...timers.values()]) callback();
    await h.settle();
    assert.equal(h.master().props.disabled, true);
    await h.master().props.onChange(); await h.settle();
    assert.equal(s.calls.length, 1, 'A logical timeout never frees the physical native operation');
    const old = s.snapshot(11);
    s.value.documentId = 'next-document'; s.value.intercept = null;
    s.api.webNavigation.onCommitted.emit({ tabId: 11, frameId: 0, documentId: 'next-document' });
    await h.settle();
    assert.equal(s.calls.length, 1, 'Navigation waits for the original physical read');
    releaseRead(old); await h.settle();
    assert.equal(s.calls.length, 2);
    assert.equal(s.calls.every(call => call.type === 'ui-protection-get'), true);
    assert.equal(h.master().props.disabled, false);
    assert.equal(h.master().props.enabled, false);
  } finally { h.unmount(); }
});

test('own save and reload refreshes the committed native document without stale completion or target drift', async () => {
  const s = server(), h = harness(s.api, 'ProtectionSettings', { tabId: 11, global: true, documentKey: null });
  try {
    h.render(); await h.settle();
    h.feature('audio').props.onChange('on'); await h.settle();
    await h.action('save-reload').props.onClick(); await h.settle();
    const reloads = s.calls.filter(call => call.type === 'ui-protection-reload');
    assert.deepEqual(reloads, [{ schemaVersion: 1, type: 'ui-protection-reload', tabId: 11, documentId: 'native-document' }]);
    assert.equal(s.value.documentId, 'next-document');
    assert.ok(s.value.settings.sites.some(site => site.host === 'example.com' && site.rules.some(rule => rule.feature === 'audio' && rule.state === 'block')));
    assert.equal(h.feature('audio').props.value, 'on');
    assert.equal(h.master().props.disabled, false);
    assert.equal(h.nodes(node => node.props.role === 'alert').length, 0);
  } finally { h.unmount(); }
});

test('Firefox subscriptions use own native event identity and remove the same callbacks while commands remain adapted', async () => {
  const s = server(), adapter = { ...s.api, webNavigation: { onCommitted: { addListener() { throw Error('adapter navigation callbacks cannot be removed'); } } } };
  let nativeCommands = 0;
  const native = { runtime: { id: 'fixture', sendMessage: () => { nativeCommands++; throw Error('commands must remain adapted'); } },
    webNavigation: { onCommitted: event() }, tabs: { onRemoved: event() }, permissions: { onRemoved: event(), onAdded: event() }, storage: { onChanged: event() } };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'browser');
  Object.defineProperty(globalThis, 'browser', { value: native, configurable: true });
  const h = harness(adapter, 'ProtectionLauncher', { tabId: 11, documentKey: '11:0:native-document' });
  try {
    h.render(); await h.settle();
    const events = [native.webNavigation.onCommitted, native.tabs.onRemoved, native.permissions.onRemoved, native.permissions.onAdded, native.storage.onChanged];
    assert.deepEqual(events.map(value => value.counts.added), [1, 1, 1, 1, 1]);
    const queuedCallback = native.webNavigation.onCommitted.callbacks()[0], baseline = s.calls.length;
    native.webNavigation.onCommitted.emit({ tabId: 12, frameId: 0 }); await h.settle();
    native.webNavigation.onCommitted.emit({ tabId: 11, frameId: 2 }); await h.settle();
    assert.equal(s.calls.length, baseline, 'Unrelated tabs and child frames do not invalidate the target');
    native.permissions.onRemoved.emit({ origins: ['https://example.com/*'] }); await h.settle();
    assert.equal(s.calls.length, baseline + 1);
    await h.master().props.onChange(); await h.settle();
    assert.equal(s.value.settings.enabled, true);
    assert.equal(nativeCommands, 0);
    h.unmount();
    assert.deepEqual(events.map(value => value.counts.removed), [1, 1, 1, 1, 1]);
    assert.deepEqual(events.map(value => value.callbacks().length), [0, 0, 0, 0, 0]);
    const after = s.calls.length;
    queuedCallback({ tabId: 11, frameId: 0 }); await h.settle();
    assert.equal(s.calls.length, after, 'A callback already queued before unmount cannot initiate fresh native work');
  } finally {
    if (original) Object.defineProperty(globalThis, 'browser', original); else delete globalThis.browser;
  }
});

test('a different extension global never supplies listeners or commands to the protection UI', async () => {
  const s = server(), original = Object.getOwnPropertyDescriptor(globalThis, 'browser');
  const foreignEvent = { addListener() { throw Error('foreign listener'); }, removeListener() { throw Error('foreign cleanup'); } };
  Object.defineProperty(globalThis, 'browser', { value: { runtime: { id: 'foreign' }, webNavigation: { onCommitted: foreignEvent }, tabs: { onRemoved: foreignEvent }, permissions: { onRemoved: foreignEvent, onAdded: foreignEvent }, storage: { onChanged: foreignEvent } }, configurable: true });
  const h = harness(s.api, 'ProtectionLauncher', { tabId: 11, documentKey: '11:0:native-document' });
  try {
    h.render(); await h.settle();
    assert.equal(s.api.webNavigation.onCommitted.counts.added, 1);
    await h.master().props.onChange(); await h.settle();
    assert.equal(s.value.settings.enabled, true);
    h.unmount();
    assert.equal(s.api.webNavigation.onCommitted.counts.removed, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, 'browser', original); else delete globalThis.browser;
  }
});

test('editor ON and OFF updates the existing launcher without navigation, reload or reopening', async () => {
  const s = server(); s.value.emitStorageOnSet = true;
  const launcher = harness(s.api, 'ProtectionLauncher', { tabId: 11, documentKey: '11:0:native-document' });
  const editor = harness(s.api, 'ProtectionSettings', { tabId: 11, global: true });
  try {
    launcher.render(); editor.render(); await launcher.settle(); await editor.settle();
    assert.equal(launcher.master().props.enabled, false);
    await editor.master().props.onChange(); await editor.settle(); await launcher.settle();
    assert.equal(s.value.settings.enabled, true);
    assert.equal(launcher.master().props.enabled, true);
    await editor.master().props.onChange(); await editor.settle(); await launcher.settle();
    assert.equal(s.value.settings.enabled, false);
    assert.equal(launcher.master().props.enabled, false);
    assert.equal(s.calls.filter(call => call.type === 'ui-protection-set').length, 2);
    assert.equal(s.calls.some(call => call.type === 'ui-protection-reload'), false);
    assert.deepEqual(s.opened, []);
    assert.equal(s.api.storage.onChanged.counts.added, 2);
  } finally { editor.unmount(); launcher.unmount(); }
  assert.equal(s.api.storage.onChanged.counts.removed, 2);
  assert.equal(s.api.storage.onChanged.callbacks().length, 0);
});

test('external stored policy updates the master while retaining a dirty draft at its old revision', async () => {
  const s = server(), h = harness(s.api);
  try {
    h.render(); await h.settle();
    h.feature('audio').props.onChange('on'); await h.settle();
    const oldValue = plain(s.value.settings);
    s.value.settings = { ...s.value.settings, enabled: true, revision: 8, global: [...s.value.settings.global, { feature: 'webrtc', state: 'block' }] };
    s.api.storage.onChanged.emit({ 'protection:v1': { oldValue, newValue: plain(s.value.settings) } }, 'local');
    await h.settle();
    assert.equal(h.master().props.enabled, true);
    assert.equal(h.feature('audio').props.value, 'on', 'External notification does not erase unsaved edits');
    await h.action('save').props.onClick(); await h.settle();
    assert.equal(s.calls.some(call => call.type === 'ui-protection-set'), false, 'Draft never acquires the external revision');
    assert.equal(s.value.settings.revision, 8);
    assert.ok(s.value.settings.global.some(rule => rule.feature === 'webrtc' && rule.state === 'block'));
    assert.equal(s.value.settings.global.some(rule => rule.feature === 'audio'), false);
    assert.ok(h.nodes(node => node.props.role === 'alert').length);
  } finally { h.unmount(); }
});

test('the storage notification queued by an own master SET preserves the draft before effects render', async () => {
  const s = server(); s.value.emitStorageOnSet = true;
  const h = harness(s.api);
  try {
    h.render(); await h.settle();
    h.feature('audio').props.onChange('on'); await h.settle();
    await h.master().props.onChange();
    await turn();
    await h.settle();
    assert.equal(s.value.settings.enabled, true);
    assert.equal(s.value.settings.revision, 8);
    assert.equal(h.feature('audio').props.value, 'on');
    assert.equal(s.value.settings.global.some(rule => rule.feature === 'audio'), false, 'Master stores only its own enabled change');
    await h.action('save').props.onClick(); await h.settle();
    assert.equal(s.calls.filter(call => call.type === 'ui-protection-set').length, 2);
    assert.equal(s.value.settings.revision, 9);
    assert.ok(s.value.settings.global.some(rule => rule.feature === 'audio' && rule.state === 'block'));
    assert.equal(h.action('save').props.disabled, true);
  } finally { h.unmount(); }
});

test('storage observation ignores unrelated keys and areas and removes its native callback', async () => {
  const s = server(), h = harness(s.api, 'ProtectionLauncher', { tabId: 11, documentKey: '11:0:native-document' });
  try {
    h.render(); await h.settle();
    const baseline = s.calls.length, callback = s.api.storage.onChanged.callbacks()[0];
    assert.equal(typeof callback, 'function');
    s.api.storage.onChanged.emit({ language: { newValue: 'ru' } }, 'local');
    s.api.storage.onChanged.emit({ 'protection:v1': { newValue: plain(s.value.settings) } }, 'session');
    s.api.storage.onChanged.emit({ 'protection:v1': { newValue: plain(s.value.settings) } }, 'sync');
    await h.settle();
    assert.equal(s.calls.length, baseline);
    h.unmount();
    assert.equal(s.api.storage.onChanged.counts.removed, 1);
    callback({ 'protection:v1': { newValue: plain(s.value.settings) } }, 'local'); await h.settle();
    assert.equal(s.calls.length, baseline, 'Late queued storage callback cannot start a read after unmount');
  } finally { if (s.api.storage.onChanged.callbacks().length) h.unmount(); }
});

test('an own master change after an external revision keeps a stale draft without acquiring write authority', async () => {
  const s = server(); s.value.emitStorageOnSet = true;
  const h = harness(s.api);
  try {
    h.render(); await h.settle();
    h.feature('audio').props.onChange('on'); await h.settle();
    const oldValue = plain(s.value.settings);
    s.value.settings = { ...s.value.settings, enabled: true, revision: 8, global: [...s.value.settings.global, { feature: 'webrtc', state: 'block' }] };
    s.api.storage.onChanged.emit({ 'protection:v1': { oldValue, newValue: plain(s.value.settings) } }, 'local'); await h.settle();
    assert.equal(h.master().props.enabled, true);
    assert.equal(h.feature('audio').props.value, 'on');
    await h.master().props.onChange(); await h.settle();
    assert.equal(s.value.settings.enabled, false);
    assert.equal(s.value.settings.revision, 9);
    assert.equal(h.master().props.enabled, false);
    assert.equal(h.feature('audio').props.value, 'on', 'Changing only the master does not erase an already stale unsaved edit');
    assert.ok(s.value.settings.global.some(rule => rule.feature === 'webrtc' && rule.state === 'block'));
    const writes = s.calls.filter(call => call.type === 'ui-protection-set').length;
    await h.action('save').props.onClick(); await h.settle();
    assert.equal(s.calls.filter(call => call.type === 'ui-protection-set').length, writes, 'Retained draft still has its original revision');
    assert.equal(s.value.settings.global.some(rule => rule.feature === 'audio'), false);
    assert.ok(h.nodes(node => node.props.role === 'alert').length);
  } finally { h.unmount(); }
});

test('an unchanged storage confirmation cannot hide an existing native registration or cleanup error', async () => {
  for (const failure of [{ registration: 'error' }, { cleanupIncomplete: true }]) {
    const s = server(); Object.assign(s.value, failure);
    const h = harness(s.api, 'ProtectionLauncher', { tabId: 11, documentKey: '11:0:native-document' });
    try {
      h.render(); await h.settle();
      assert.ok(h.nodes(node => node.props.role === 'alert').length);
      const reads = s.calls.length;
      s.api.storage.onChanged.emit({ 'protection:v1': { oldValue: plain(s.value.settings), newValue: plain(s.value.settings) } }, 'local');
      await h.settle();
      assert.equal(s.calls.length, reads + 1);
      assert.ok(h.nodes(node => node.props.role === 'alert').length, 'Confirmed native failure remains visible');
      assert.equal(s.calls.some(call => call.type === 'ui-protection-set'), false);
    } finally { h.unmount(); }
  }
});

// ADR-046: view-only category chips, partial-coverage badges and the limits note on the settings page.
const childrenOf = node => [node.props.children].flat(Infinity).filter(child => child && typeof child === 'object' && child.props);
function collect(root, predicate) {
  const result = [];
  const visit = node => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object' || !node.props) return;
    if (predicate(node)) result.push(node);
    visit(node.props.children);
  };
  visit(root); return result;
}
const hasClass = (node, name) => typeof node.props.class === 'string' && node.props.class.split(' ').includes(name);
// FilterChips is hook-free, so the harness renders it by calling the component directly.
function chips(h) {
  const node = h.nodes(entry => entry.type?.name === 'FilterChips')[0];
  assert.ok(node, 'FilterChips is rendered');
  const tree = node.type(node.props);
  return { node, tree, buttons: collect(tree, entry => entry.props.role === 'radio') };
}
const selectedChips = h => chips(h).buttons.filter(button => button.props['aria-checked'] === true).map(button => button.props['data-protection-filter']);
const chipCounts = h => Object.fromEntries(collect(chips(h).tree, node => typeof node.props['data-protection-filter-count'] === 'string').map(node => [node.props['data-protection-filter-count'], node.props.children]));
const rows = h => h.nodes(node => typeof node.props['data-protection-feature'] === 'string').map(node => node.props['data-protection-feature']);
const filterRow = h => h.nodes(node => hasClass(node, 'blocking-filter'))[0];
const searchInput = h => collect(filterRow(h), node => node.props['data-protection-search'] === true)[0];
const configuredInput = h => collect(filterRow(h), node => node.type === 'input' && node.props.type === 'checkbox')[0];
async function choose(h, id) { chips(h).node.props.onChange(id); await h.settle(); }
const canonical = PROTECTION_GROUPS.flatMap(group => group.features);
const tagged = tag => canonical.filter(feature => tag === 'all' || PROTECTION_FEATURE_FILTER[feature] === tag);
const fullCounts = () => Object.fromEntries(PROTECTION_FILTERS.map(id => [id, tagged(id).length]));

test('category chips sit between the search row and the first group as one radio group with a single tab stop', async () => {
  const s = server(), h = harness(s.api);
  try {
    h.render();
    assert.equal(h.nodes(node => node.type?.name === 'FilterChips').length, 0, 'no chips while the policy is loading');
    const tree = await h.settle(), top = childrenOf(tree);
    const index = name => top.findIndex(node => hasClass(node, name));
    const filter = index('blocking-filter'), categories = index('blocking-categories'), groups = index('blocking-groups');
    assert.ok(filter > 0);
    assert.equal(categories, filter + 1, 'chips follow the search row');
    assert.equal(groups, categories + 1, 'chips directly precede the groups');
    assert.equal(top[categories].props['data-protection-categories'], true);
    assert.equal(top[groups].props['data-protection-filter-active'], 'all');
    const { tree: group, buttons } = chips(h);
    assert.equal(group.props.role, 'radiogroup');
    assert.equal(group.props['aria-label'], 'protection_filter_label');
    assert.equal(group.props['data-protection-filters'], true);
    assert.deepEqual(buttons.map(button => button.props['data-protection-filter']), [...PROTECTION_FILTERS]);
    assert.deepEqual(buttons.map(button => collect(button, node => hasClass(node, 'blocking-chip__label'))[0].props.children), PROTECTION_FILTERS.map(id => 'protection_filter_' + id));
    assert.equal(buttons.filter(button => button.props['aria-checked'] === true).length, 1);
    assert.equal(buttons.filter(button => button.props.tabIndex === 0).length, 1);
    assert.deepEqual(selectedChips(h), ['all']);
    assert.equal(buttons.find(button => button.props.tabIndex === 0).props['data-protection-filter'], 'all');
    assert.ok(buttons.every(button => button.props.type === 'button' && !('disabled' in button.props)));
    assert.ok(collect(group, node => typeof node.props['data-protection-filter-count'] === 'string').every(node => node.props['aria-hidden'] === 'true'));
    assert.deepEqual(chipCounts(h), fullCounts());
    assert.equal(collect(group, node => 'data-protection-state' in node.props || 'data-protection-feature' in node.props || 'feature' in node.props).length, 0, 'chips never reuse rule-row hooks');
    assert.deepEqual(rows(h), canonical);
    assert.equal(h.nodes(node => node.props['data-protection-filter-live'] === true)[0].props.children, '');
  } finally { h.unmount(); }
});

test('every chip filters rows inside the existing groups without sending or dirtying anything', async () => {
  const s = server(), h = harness(s.api);
  try {
    h.render(); await h.settle();
    const reads = s.calls.length;
    for (const id of ['network', 'hardware', 'os', 'browser', 'social', 'all']) {
      await choose(h, id);
      assert.deepEqual(selectedChips(h), [id]);
      assert.deepEqual(rows(h), tagged(id), id);
      assert.equal(h.nodes(node => node.props['data-protection-filter-active'] !== undefined)[0].props['data-protection-filter-active'], id);
      const sections = h.nodes(node => typeof node.props['data-protection-group'] === 'string');
      assert.deepEqual(sections.map(section => section.props['data-protection-group']), PROTECTION_GROUPS.filter(group => group.features.some(feature => tagged(id).includes(feature))).map(group => group.id), id);
      for (const section of sections) {
        const count = collect(section, node => hasClass(node, 'blocking-group__count'))[0].props.children;
        const own = collect(section, node => typeof node.props['data-protection-feature'] === 'string').length;
        assert.ok(own > 0, id + '/' + section.props['data-protection-group']);
        assert.equal(count, own, id + '/' + section.props['data-protection-group']);
      }
      assert.deepEqual(chipCounts(h), fullCounts(), 'faceted counts ignore the selected chip');
      assert.equal(h.action('save').props.disabled, true, 'the draft stays clean');
      assert.equal(h.nodes(node => node.props['data-protection-empty'] === true).length, 0);
    }
    assert.equal(s.calls.length, reads, 'selecting chips sends no message');
    assert.equal(s.calls.every(call => call.type === 'ui-protection-get'), true);
    assert.deepEqual(s.value.settings, settings());
  } finally { h.unmount(); }
});

test('edits under a chip survive chip changes; Save and Reset still cover rows hidden by the filter', async () => {
  const s = server(), h = harness(s.api);
  try {
    h.render(); await h.settle();
    await choose(h, 'network');
    assert.equal(h.feature('canvas-readback'), undefined, 'hardware row is hidden');
    h.feature('webrtc').props.onChange('on'); await h.settle();
    assert.equal(h.action('save').props.disabled, false);
    await choose(h, 'all');
    assert.equal(h.feature('webrtc').props.value, 'on');
    assert.equal(h.feature('canvas-readback').props.value, 'on');
    await choose(h, 'social');
    assert.equal(h.feature('webrtc'), undefined);
    assert.equal(h.feature('canvas-readback'), undefined);
    await h.action('save').props.onClick(); await h.settle();
    assert.deepEqual([...s.value.settings.global].sort((left, right) => left.feature.localeCompare(right.feature)), [{ feature: 'canvas-readback', state: 'block' }, { feature: 'webrtc', state: 'block' }]);
    assert.equal(s.value.settings.revision, 8);
    assert.deepEqual(s.value.settings.sites, settings().sites);
    assert.deepEqual(selectedChips(h), ['social'], 'saving keeps the chip');
    assert.equal(h.action('save').props.disabled, true);
    h.nodes(node => node.props['data-protection-reset'] === true)[0].props.onClick(); await h.settle();
    assert.equal(h.action('save').props.disabled, false, 'reset under a chip resets hidden rows too');
    await choose(h, 'all');
    assert.equal(h.feature('webrtc').props.value, 'bypass');
    assert.equal(h.feature('canvas-readback').props.value, 'bypass');
    assert.equal(s.calls.filter(call => call.type === 'ui-protection-set').length, 1);
  } finally { h.unmount(); }
});

test('chips stay enabled while busy and with the master OFF; the chosen chip survives toggle and reload placeholders', async () => {
  const s = server(), h = harness(s.api);
  let release;
  try {
    h.render(); await h.settle();
    assert.equal(h.master().props.enabled, false);
    await choose(h, 'os');
    assert.ok(chips(h).buttons.every(button => !button.props.disabled));
    s.value.intercept = request => request.type === 'ui-protection-get' ? new Promise(resolve => { release = resolve; }) : undefined;
    const toggled = h.master().props.onChange(); await h.settle();
    assert.equal(h.master().props.disabled, true, 'the editor is busy');
    assert.ok(chips(h).buttons.every(button => !button.props.disabled));
    await choose(h, 'browser');
    assert.deepEqual(selectedChips(h), ['browser'], 'chips remain usable while busy');
    assert.deepEqual(rows(h), tagged('browser'));
    s.value.intercept = null; release(s.snapshot(null));
    await toggled; await h.settle();
    assert.equal(h.master().props.enabled, true);
    assert.deepEqual(selectedChips(h), ['browser']);
    assert.deepEqual(rows(h), tagged('browser'));
    s.api.permissions.onAdded.emit({});
    h.render();
    assert.equal(h.nodes(node => node.type?.name === 'FilterChips').length, 0, 'placeholder while re-reading');
    await h.settle();
    assert.deepEqual(selectedChips(h), ['browser'], 'state survives the placeholder');
    assert.equal(s.calls.filter(call => call.type === 'ui-protection-set').length, 1, 'only the master wrote');
  } finally { h.unmount(); }
});

test('an empty result offers a clear action that resets the chip, search and configured filter', async () => {
  const s = server(), h = harness(s.api);
  try {
    h.render(); await h.settle();
    await choose(h, 'hardware');
    configuredInput(h).props.onChange({ currentTarget: { checked: true } }); await h.settle();
    assert.ok(rows(h).length > 0 && rows(h).every(feature => PROTECTION_FEATURE_FILTER[feature] === 'hardware'));
    searchInput(h).props.onInput({ currentTarget: { value: 'zzzz' } }); await h.settle();
    assert.deepEqual(rows(h), []);
    assert.equal(h.nodes(node => typeof node.props['data-protection-group'] === 'string').length, 0);
    const empty = h.nodes(node => node.props['data-protection-empty'] === true)[0];
    assert.ok(empty);
    assert.equal(collect(empty, node => hasClass(node, 'blocking-message'))[0].props.children, 'protection_no_rows');
    assert.deepEqual(chipCounts(h), { all: 0, hardware: 0, os: 0, network: 0, browser: 0, social: 0 });
    assert.ok(chips(h).buttons.every(button => !button.props.disabled), 'zero-count chips stay selectable');
    const focused = [];
    chips(h).node.props.group.current = { querySelector: selector => ({ focus: () => focused.push(selector) }) };
    const clear = collect(empty, node => node.props['data-protection-filter-clear'] === true)[0];
    assert.equal(clear.props.type, 'button');
    assert.equal(clear.props.children, 'protection_filter_clear');
    clear.props.onClick(); await h.settle();
    assert.deepEqual(focused, ['[data-protection-filter="all"]']);
    assert.deepEqual(selectedChips(h), ['all']);
    assert.equal(searchInput(h).props.value, '');
    assert.equal(configuredInput(h).props.checked, false);
    assert.deepEqual(rows(h), canonical);
    assert.equal(h.nodes(node => node.props['data-protection-empty'] === true).length, 0);
    assert.equal(s.calls.every(call => call.type === 'ui-protection-get'), true);
  } finally { h.unmount(); }
});

test('chip arrows follow the document direction and move focus with the selection', async () => {
  const s = server(), h = harness(s.api), original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  try {
    h.render(); await h.settle();
    const focused = [];
    const buttons = PROTECTION_FILTERS.map(id => ({ focus: () => focused.push(id) }));
    chips(h).node.props.group.current = { querySelectorAll: selector => { assert.equal(selector, '[data-protection-filter]'); return buttons; } };
    let prevented = 0;
    const press = async key => { chips(h).tree.props.onKeyDown({ key, preventDefault: () => { prevented++; } }); await h.settle(); };
    await press('ArrowRight');
    assert.deepEqual(selectedChips(h), ['hardware'], 'LTR without a document');
    Object.defineProperty(globalThis, 'document', { value: { documentElement: { dir: 'rtl' } }, configurable: true, writable: true });
    await press('ArrowLeft');
    assert.deepEqual(selectedChips(h), ['os'], 'RTL: ArrowLeft selects the next chip');
    await press('ArrowRight');
    assert.deepEqual(selectedChips(h), ['hardware'], 'RTL: ArrowRight selects the previous chip');
    await press('End');
    assert.deepEqual(selectedChips(h), ['social']);
    await press('ArrowLeft');
    assert.deepEqual(selectedChips(h), ['all'], 'wraps');
    await press('Home');
    await press('Enter');
    assert.deepEqual(selectedChips(h), ['all']);
    assert.equal(prevented, 6, 'unhandled keys keep their default action');
    assert.deepEqual(focused, ['hardware', 'os', 'hardware', 'social', 'all', 'all']);
    assert.equal(s.calls.every(call => call.type === 'ui-protection-get'), true);
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document;
    h.unmount();
  }
  assert.equal(Object.hasOwn(globalThis, 'document'), Boolean(original));
});

test('the filter live region stays silent on load and announces the shown count after a 500 ms pause', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const translate = (key, values = []) => values.length ? key + ':' + values.join('/') : key;
  const s = server(), h = harness(s.api, 'ProtectionSettings', { tabId: null, global: true }, { translate });
  const live = () => h.nodes(node => node.props['data-protection-filter-live'] === true)[0];
  const total = dependencies.PROTECTION_FEATURES.length;
  try {
    h.render(); await h.settle();
    assert.equal(live().props.role, 'status');
    assert.equal(live().props.class, 'sr-only');
    assert.equal(live().props.children, '');
    t.mock.timers.tick(1000); await h.settle();
    assert.equal(live().props.children, '', 'nothing is announced on page load');
    await choose(h, 'network');
    assert.equal(live().props.children, '');
    t.mock.timers.tick(499); await h.settle();
    assert.equal(live().props.children, '');
    t.mock.timers.tick(1); await h.settle();
    assert.equal(live().props.children, 'protection_filter_shown:' + tagged('network').length + '/' + total);
    // Same count after a search change: emptied first, then announced again.
    searchInput(h).props.onInput({ currentTarget: { value: 'protection_feature' } }); await h.settle();
    assert.equal(live().props.children, '');
    t.mock.timers.tick(500); await h.settle();
    assert.equal(live().props.children, 'protection_filter_shown:' + tagged('network').length + '/' + total);
    // Typing is debounced.
    searchInput(h).props.onInput({ currentTarget: { value: 'protection_feature_w' } }); await h.settle();
    t.mock.timers.tick(300); await h.settle();
    searchInput(h).props.onInput({ currentTarget: { value: 'protection_feature_web' } }); await h.settle();
    t.mock.timers.tick(300); await h.settle();
    assert.equal(live().props.children, '');
    t.mock.timers.tick(200); await h.settle();
    const shown = rows(h).length;
    assert.ok(shown > 0 && shown < tagged('network').length);
    assert.equal(live().props.children, 'protection_filter_shown:' + shown + '/' + total);
    configuredInput(h).props.onChange({ currentTarget: { checked: true } }); await h.settle();
    t.mock.timers.tick(500); await h.settle();
    assert.equal(live().props.children, 'protection_filter_shown:' + rows(h).length + '/' + total);
  } finally { h.unmount(); }
});

test('partial-coverage badges mark exactly the documented rules and the limits note opens the footer', async () => {
  const s = server(), h = harness(s.api);
  try {
    h.render(); await h.settle();
    const badges = new Map();
    for (const row of h.nodes(node => typeof node.props['data-protection-feature'] === 'string')) {
      const found = collect(row, node => node.props['data-protection-partial'] === true);
      assert.ok(found.length <= 1);
      if (found.length) badges.set(row.props['data-protection-feature'], { row, badge: found[0] });
    }
    assert.equal(badges.size, 8);
    assert.deepEqual([...badges.keys()].sort(), [...PROTECTION_PARTIAL].sort());
    for (const { row, badge } of badges.values()) {
      assert.equal(badge.props.class, 'blocking-rule__partial');
      assert.equal(badge.props.title, 'protection_rule_partial_hint');
      const [label, hidden] = badge.props.children;
      assert.equal(label, 'protection_rule_partial');
      assert.equal(hidden.props.class, 'sr-only');
      assert.equal(hidden.props.children, ': protection_rule_partial_hint');
      const description = collect(row, node => hasClass(node, 'blocking-rule__description'))[0];
      assert.deepEqual(childrenOf(description).map(node => node.props.class), ['blocking-rule__name', 'blocking-rule__partial', 'blocking-rule__api'], 'badge follows the name');
    }
    const footer = h.nodes(node => hasClass(node, 'blocking-footer'))[0], first = childrenOf(footer)[0];
    assert.equal(first.type, 'p');
    assert.equal(first.props.class, 'blocking-note');
    assert.equal(first.props['data-protection-limits'], true);
    assert.equal(first.props.children, 'protection_limits');
    assert.equal(first.props['data-protection-status'], undefined);
    assert.equal(h.nodes(node => node.props['data-protection-limits'] === true).length, 1);
    assert.equal(childrenOf(footer)[1].props['data-protection-status'], true, 'status line keeps its place after the note');
  } finally { h.unmount(); }
});
