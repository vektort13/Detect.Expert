// Management opens only the exact owned Options tab; no sender, permission or settings API is replaced.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import test from 'node:test';
import { adoptManagementEntry, openManagement } from '../../../apps/production-extension/management-navigation.js';
import { syncManagementNavigation } from '../sync-management-navigation.mjs';

const root = resolve(import.meta.dirname, '../../..');
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture({ firefox = false } = {}) {
  const base = (firefox ? 'moz-extension://private-uuid/' : 'chrome-extension://fixture/');
  const rows = new Map(), calls = [], values = { contextHook: null, getHook: null, contextCalls: 0, getCalls: 0 };
  let next = 40;
  const api = {
    runtime: { getURL: file => base + file },
    tabs: {
      getCurrent: async () => rows.has(values.currentId) ? { ...rows.get(values.currentId) } : undefined,
      query: async input => { calls.push(['query', input]); return [...rows.values()].map(value => ({ ...value })); },
      get: async id => { values.getCalls++; await values.getHook?.(id, values.getCalls); if (!rows.has(id)) throw Error('missing'); return { ...rows.get(id) }; },
      update: async (id, input) => { calls.push(['update', id, input]); const row = rows.get(id); if (!row) throw Error('missing'); Object.assign(row, { url: input.url, contextUrl: input.url }); delete row.pendingUrl; return { ...row }; },
      create: async input => { calls.push(['create', input]); const row = { id: ++next, windowId: input.windowId ?? 7, url: input.url, contextUrl: input.url }; rows.set(row.id, row); return { ...row }; },
    },
    windows: {
      getLastFocused: async input => { calls.push(['lastFocused', input]); return { id: 7, type: 'normal' }; },
      update: async (id, input) => { calls.push(['focus', id, input]); return { id, type: 'normal' }; },
    },
  };
  if (!firefox) api.runtime.getContexts = async filter => {
    values.contextCalls++; await values.contextHook?.(filter, values.contextCalls);
    return [...rows.values()].filter(row => typeof row.contextUrl === 'string' && (!filter.tabIds || filter.tabIds.includes(row.id))).map(row => ({
      contextType: 'TAB', frameId: row.frameId ?? 0, tabId: row.id, windowId: row.windowId,
      documentOrigin: row.contextOrigin ?? base.slice(0, -1), documentUrl: row.contextUrl,
    }));
  };
  const add = (id, path = 'options.html', { redacted = false, ...rest } = {}) => rows.set(id, {
    id, windowId: 3, ...(redacted ? {} : { url: base + path }), contextUrl: base + path, ...rest,
  });
  return { api, base, rows, calls, values, add, mutations: () => calls.filter(call => ['create', 'update'].includes(call[0])) };
}

test('generated browser helper is synchronized with its typed source', async () => {
  await syncManagementNavigation({ check: true });
});

test('first opening creates a normal-window Options tab and never calls a product mutation', async () => {
  const f = fixture();
  assert.equal(await openManagement('api', 17, f.api), true);
  assert.deepEqual(f.mutations(), [['create', { url: f.base + 'options.html?tabId=17#api', active: true, windowId: 7 }]]);
  assert.deepEqual(f.calls.filter(call => call[0] === 'focus'), [['focus', 7, { focused: true }]]);
});

test('Chrome discovers a redacted native own TAB context and reuses, activates and focuses it', async () => {
  const f = fixture(); f.add(8, 'options.html?tabId=12#api', { redacted: true });
  assert.equal(await openManagement('firewall', null, f.api), true);
  assert.deepEqual(f.mutations(), [['update', 8, { url: f.base + 'options.html?tabId=12#firewall', active: true }]]);
  assert.deepEqual(f.calls.filter(call => call[0] === 'focus'), [['focus', 3, { focused: true }]]);
  assert.equal(f.calls.some(call => call[0] === 'query'), false);
});

test('API and Antidetect launchers replace the source target; explicit global clears it; other sections preserve one valid target', async () => {
  const f = fixture(); f.add(8, 'options.html?tabId=12&ignored=secret#api');
  for (const [section, target, suffix] of [
    ['api', 27, '?tabId=27#api'], ['antidetect', 31, '?tabId=31#antidetect'], ['settings', null, '?tabId=31#settings'], ['contacts', null, '?tabId=31#contacts'], ['antidetect', null, '#antidetect'], ['api', null, '#api'],
  ]) {
    assert.equal(await openManagement(section, target, f.api), true);
    assert.equal(f.mutations().at(-1)[2].url, f.base + 'options.html' + suffix);
  }
  f.rows.get(8).url = f.base + 'options.html?tabId=3&tabId=4';
  assert.equal(await openManagement('settings', null, f.api), true);
  assert.equal(f.mutations().at(-1)[2].url, f.base + 'options.html#settings');
});

test('exact document, origin and top-frame checks reject lookalikes and foreign contexts', async () => {
  const f = fixture();
  f.add(1, 'options.html.evil'); f.add(2, 'nested/options.html'); f.add(3, '%6fptions.html');
  f.add(4, 'options.html', { contextOrigin: 'https://foreign.test' });
  f.add(5, 'options.html', { frameId: 1 }); f.add(6, 'findings.html'); f.add(7, 'firewall.html');
  assert.equal(await openManagement('settings', null, f.api), true);
  assert.equal(f.mutations().length, 1); assert.equal(f.mutations()[0][0], 'create');
});

test('foreign pending navigation supersedes an earlier own context even after an awaited read', async () => {
  const f = fixture(); f.add(8, 'options.html', { redacted: true });
  const entered = deferred(), release = deferred();
  f.values.contextHook = async (_, n) => { if (n === 2) { entered.resolve(); await release.promise; } };
  const work = openManagement('firewall', null, f.api); await entered.promise;
  f.rows.get(8).pendingUrl = 'https://foreign.test/'; release.resolve();
  assert.equal(await work, true);
  assert.equal(f.mutations().some(call => call[0] === 'update'), false);
  assert.equal(f.rows.get(8).pendingUrl, 'https://foreign.test/');
});

test('closed or replaced candidates are not navigated', async () => {
  const f = fixture(); f.add(8); f.values.getHook = id => { f.rows.delete(id); };
  assert.equal(await openManagement('contacts', null, f.api), true);
  assert.equal(f.mutations().some(call => call[0] === 'update'), false);
  assert.equal(f.mutations().filter(call => call[0] === 'create').length, 1);
});

test('Firefox uses native own URL query and still rejects prefix and foreign pending matches', async () => {
  const f = fixture({ firefox: true }); f.add(1, 'options.html.evil');
  f.add(2, 'options.html', { pendingUrl: 'https://foreign.test/' }); f.add(3, 'options.html#settings');
  assert.equal(await openManagement('api', 9, f.api), true);
  assert.deepEqual(f.mutations(), [['update', 3, { url: f.base + 'options.html?tabId=9#api', active: true }]]);
  assert.deepEqual(f.calls.find(call => call[0] === 'query'), ['query', { url: f.base + 'options.html*' }]);
});

test('all bounded legacy Firewall aliases remain usable on the exact same Options document', async () => {
  const f = fixture(); f.add(8);
  for (const alias of ['protect', 'firewall', 'history', 'requests']) {
    assert.equal(await openManagement(alias, null, f.api), true);
    assert.equal(f.mutations().at(-1)[2].url, f.base + 'options.html#' + alias);
  }
});

test('invalid sections, contexts and non-extension runtime origins cause no browser actions', async () => {
  const f = fixture();
  for (const section of ['', 'api#contacts', '../options.html', 'https://foreign.test', null, {}]) assert.equal(await openManagement(section, null, f.api), false);
  for (const id of [-1, 1.2, 2147483648, NaN, '2', {}]) assert.equal(await openManagement('api', id, f.api), false);
  f.api.runtime.getURL = file => 'https://foreign.test/' + file;
  assert.equal(await openManagement('settings', null, f.api), false);
  assert.deepEqual(f.calls, []);
});

test('failed context discovery, tab update or focus reports failure without creating a duplicate tab', async () => {
  for (const failure of ['contexts', 'update', 'focus']) {
    const f = fixture(); f.add(8);
    if (failure === 'contexts') f.api.runtime.getContexts = async () => { throw Error('unavailable'); };
    if (failure === 'update') f.api.tabs.update = async () => { throw Error('unavailable'); };
    if (failure === 'focus') f.api.windows.update = async () => { throw Error('unavailable'); };
    assert.equal(await openManagement('settings', null, f.api), false, failure);
    assert.equal(f.mutations().some(call => call[0] === 'create'), false, failure);
  }
});

test('native locks coordinate different UI API instances and wait for the new TAB to become discoverable', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let lockTail = Promise.resolve(), lockCalls = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (name, action) => {
    assert.equal(name, 'detect.expert/management-navigation/v1'); lockCalls++;
    const next = lockTail.then(action); lockTail = next.then(() => undefined); return next;
  } } } });
  try {
    const f = fixture();
    const nativeCreate = f.api.tabs.create;
    f.api.tabs.create = async input => { await turn(); return nativeCreate(input); };
    assert.deepEqual(await Promise.all([openManagement('api', 9, f.api), openManagement('firewall', null, { ...f.api })]), [true, true]);
    assert.equal(lockCalls, 2);
    assert.equal(f.mutations().filter(call => call[0] === 'create').length, 1);
    assert.equal(f.mutations().filter(call => call[0] === 'update').length, 1);
  } finally { if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator; }
});

test('without Web Locks, concurrent calls from one UI serialize instead of creating duplicate tabs', async () => {
  const f = fixture();
  assert.deepEqual(await Promise.all([openManagement('api', 9, f.api), openManagement('contacts', null, f.api)]), [true, true]);
  assert.equal(f.mutations().filter(call => call[0] === 'create').length, 1);
  assert.equal(f.mutations().filter(call => call[0] === 'update').length, 1);
});

test('messaging adapter differs only by relative import paths and the reviewed Options navigation helper', () => {
  const original = resolve(root, 'vendor/protect-722fae8/packages/ui/src/messaging.ts');
  const adapter = resolve(root, 'apps/production-protect/src/patches/ui-messaging.ts');
  let expected = readFileSync(original, 'utf8').replace(/\r\n/g, '\n').replace(/from '(\.{1,2}\/[^']+)'/g, (_, spec) => {
    let target = relative(dirname(adapter), resolve(dirname(original), spec)).replaceAll('\\', '/');
    if (!target.startsWith('.')) target = './' + target;
    return "from '" + target + "'";
  });
  const before = "/** Opens the module's Options tab (`options.html#<hash>`) in a new tab; no `tabs` permission is needed. */\nexport async function openProtectOptions(hash: ProtectOptionsHash = 'protect'): Promise<boolean> {\n  try {\n    await chrome.tabs.create({ url: chrome.runtime.getURL('options.html#' + hash) });\n    return true;\n  } catch {\n    return false;\n  }\n}";
  assert.equal(expected.split(before).length, 2);
  expected = "// Production adapter: management navigation only; vendor messaging and privileged requests stay unchanged.\nimport { openManagement } from '../ui/management-navigation';\n" + expected.replace(before,
    "/** Opens the existing owned management tab, retaining the bounded Firewall deep-link aliases. */\nexport async function openProtectOptions(hash: ProtectOptionsHash = 'protect'): Promise<boolean> {\n  return openManagement(hash);\n}");
  assert.equal(readFileSync(adapter, 'utf8').replace(/\r\n/g, '\n'), expected);
});

function entryWindow(f, id, suffix = '', { closeAllowed = true } = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const own = { closed: false, document: {}, location: { href: f.base + 'options.html' + suffix }, top: null,
    close() { f.calls.push(['closeEntry', id]); if (closeAllowed) { own.closed = true; f.rows.delete(id); } } };
  own.top = own; f.values.currentId = id;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: own });
  return { own, restore() { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; } };
}

test('the first canonical browser Options entry renders without navigation or closing itself', async () => {
  const f = fixture(); f.add(8); const entry = entryWindow(f, 8);
  try { assert.equal(await adoptManagementEntry(f.api), true); assert.deepEqual(f.mutations(), []); assert.equal(entry.own.closed, false); }
  finally { entry.restore(); }
});

test('a new canonical browser Options entry forwards to the older contextual tab and closes only itself', async () => {
  const f = fixture(); f.add(8, 'options.html?tabId=12#api', { redacted: true }); f.add(9, 'options.html', { redacted: true });
  const entry = entryWindow(f, 9);
  try {
    assert.equal(await adoptManagementEntry(f.api), false);
    assert.deepEqual(f.mutations(), [['update', 8, { url: f.base + 'options.html?tabId=12#hub', active: true }]]);
    assert.deepEqual(f.calls.filter(row => row[0] === 'closeEntry'), [['closeEntry', 9]]);
    assert.equal(f.rows.has(8), true); assert.equal(f.rows.has(9), false);
  } finally { entry.restore(); }
});

test('direct deep links and query-bearing entries retain their own route without adoption', async () => {
  for (const suffix of ['#api', '#settings', '#firewall', '?tabId=4', '?tabId=4#api']) {
    const f = fixture(); f.add(8); f.add(9, 'options.html' + suffix); const entry = entryWindow(f, 9, suffix);
    try { assert.equal(await adoptManagementEntry(f.api), true); assert.deepEqual(f.mutations(), []); assert.equal(entry.own.closed, false); }
    finally { entry.restore(); }
  }
});

test('a navigation of the new entry while forwarding is awaited defeats the close authorization', async () => {
  const f = fixture(); f.add(8, 'options.html?tabId=12#api'); f.add(9); const entry = entryWindow(f, 9);
  const update = f.api.tabs.update;
  f.api.tabs.update = async (...args) => { const result = await update(...args); f.rows.get(9).pendingUrl = 'https://foreign.test/'; return result; };
  try {
    assert.equal(await adoptManagementEntry(f.api), true);
    assert.equal(entry.own.closed, false); assert.equal(f.calls.some(row => row[0] === 'closeEntry'), false);
    assert.equal(f.rows.get(9).pendingUrl, 'https://foreign.test/');
  } finally { entry.restore(); }
});

test('a winner navigation during the awaited entry check is detected immediately before forwarding', async () => {
  const f = fixture(); f.add(8, 'options.html?tabId=12#api'); f.add(9); const entry = entryWindow(f, 9);
  const entered = deferred(), release = deferred(); let entryChecks = 0;
  f.values.getHook = async id => { if (id === 9 && ++entryChecks === 2) { entered.resolve(); await release.promise; } };
  try {
    const work = adoptManagementEntry(f.api); await entered.promise;
    f.rows.get(8).pendingUrl = 'https://foreign.test/'; release.resolve();
    assert.equal(await work, true);
    assert.deepEqual(f.mutations(), []); assert.equal(entry.own.closed, false);
    assert.equal(f.rows.get(8).pendingUrl, 'https://foreign.test/');
  } finally { entry.restore(); }
});

test('document replacement and native close refusal never leave a blank render gate', async () => {
  for (const condition of ['replaced-document', 'close-refused']) {
    const f = fixture(); f.add(8); f.add(9); const entry = entryWindow(f, 9, '', { closeAllowed: condition !== 'close-refused' });
    const focus = f.api.windows.update;
    f.api.windows.update = async (...args) => { const result = await focus(...args); if (condition === 'replaced-document') entry.own.document = {}; return result; };
    try { assert.equal(await adoptManagementEntry(f.api), true, condition); assert.equal(entry.own.closed, false); }
    finally { entry.restore(); }
  }
});

test('adoption failure, lack of a current native tab and a non-owned entry all leave rendering enabled', async () => {
  for (const condition of ['unavailable-current', 'discovery-failed', 'foreign-entry']) {
    const f = fixture(); f.add(8); f.add(9); const entry = entryWindow(f, 9);
    if (condition === 'unavailable-current') f.values.currentId = 999;
    if (condition === 'discovery-failed') f.api.runtime.getContexts = async () => { throw Error('unavailable'); };
    if (condition === 'foreign-entry') entry.own.location.href = 'https://foreign.test/options.html';
    try { assert.equal(await adoptManagementEntry(f.api), true); assert.equal(entry.own.closed, false); assert.deepEqual(f.mutations(), []); }
    finally { entry.restore(); }
  }
});
