// ADR-054: transient browser confirmation is bounded and never borrows ownership from an arbitrary window ID.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../../..');
const result = await build({ entryPoints: [resolve(root, 'apps/production-protect/src/activation-toast-window.ts')], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
const { ActivationToastWindow } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';
const url = activation => origin + 'activation-toast.html?activation=' + activation;
const own = (id = 9, activation = 1) => ({ id, type: 'popup', tabs: [{ id: id + 70, url: url(activation) }] });
const flush = async () => { for (let turn = 0; turn < 30; turn++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function environment(run) {
  const prior = globalThis.chrome;
  let next = 100;
  const state = { windows: new Map(), contexts: [], creates: [], removes: [], removeError: null, create: null, all: null, getContexts: null };
  globalThis.chrome = { runtime: { getURL: path => origin + path, getContexts: async query => state.getContexts ? state.getContexts(query) : state.contexts }, windows: {
    getAll: async () => state.all ? state.all() : [...state.windows.values()],
    get: async id => { if (!state.windows.has(id)) throw Error('closed'); return state.windows.get(id); },
    create: async options => {
      state.creates.push(options);
      const made = state.create ? await state.create(options) : own(next++, Number(new URL(options.url).searchParams.get('activation')));
      state.windows.set(made.id, made); return made;
    },
    remove: async id => { state.removes.push(id); if (state.removeError) throw state.removeError; state.windows.delete(id); },
  } };
  const toast = new ActivationToastWindow();
  try { await run(toast, state); }
  finally {
    state.getContexts = null; state.contexts = []; state.removeError = null; state.all = null; state.windows.clear();
    // Invalidate any bounded cleanup timer before restoring the host browser global.
    await toast.show(Number.MAX_SAFE_INTEGER, () => false); toast.cancel(); await flush();
    if (prior === undefined) delete globalThis.chrome; else globalThis.chrome = prior;
  }
}

test('only positive eligible activations create an unfocused fixed own popup; the activation token is deduplicated', () => environment(async (toast, state) => {
  for (const activation of [0, -1, NaN, Infinity, 1.5]) await toast.show(activation, () => true);
  await toast.show(1, () => false); await toast.show(2, () => { throw Error('stale state'); });
  assert.deepEqual(state.creates, []);
  await toast.show(3, () => true); await toast.show(3, () => true); await toast.show(2, () => true);
  assert.deepEqual(state.creates, [{ url: url(3), type: 'popup', focused: false, width: 360, height: 210 }]);
  toast.cancel(); await flush(); assert.deepEqual(state.removes, [100]);
}));

test('cancel before queued creation and loss of eligibility during the native scan prevent any creation', () => environment(async (toast, state) => {
  const first = toast.show(1, () => true); toast.cancel(); await first; await flush(); assert.equal(state.creates.length, 0);
  const scan = deferred(); state.all = () => scan.promise; let eligible = true;
  const second = toast.show(2, () => eligible); await flush(); eligible = false; scan.resolve([]); await second;
  assert.equal(state.creates.length, 0);
}));

test('a late native create result after cancel is removed only after its exact current document is verified', () => environment(async (toast, state) => {
  const create = deferred(); state.create = () => create.promise;
  const pending = toast.show(1, () => true); await flush(); assert.equal(state.creates.length, 1);
  toast.cancel(); create.resolve(own(90)); await pending; await flush();
  assert.deepEqual(state.removes, [90]); assert.equal(state.windows.size, 0);
}));

test('eligibility lost while native create is pending removes the late confirmation without a cancel event', () => environment(async (toast, state) => {
  const create = deferred(); state.create = () => create.promise; let eligible = true;
  const pending = toast.show(1, () => eligible); await flush(); eligible = false;
  create.resolve(own(90)); await pending;
  assert.deepEqual(state.removes, [90]); assert.equal(state.windows.size, 0);
}));

test('newer activation supersedes an in-flight result and keeps only the newest confirmation', () => environment(async (toast, state) => {
  const create = deferred(); let calls = 0; state.create = () => ++calls === 1 ? create.promise : own(91, 2);
  const older = toast.show(1, () => true); await flush(); const newer = toast.show(2, () => true);
  create.resolve(own(90)); await older; await newer;
  assert.deepEqual(state.removes, [90]); assert.deepEqual([...state.windows.keys()], [91]);
}));

test('cleanup queued for a superseded loading toast cannot close the next valid confirmation', () => environment(async (toast, state) => {
  const create = deferred(); let calls = 0, contextReads = 0;
  state.create = () => ++calls === 1 ? create.promise : own(91, 2);
  state.getContexts = () => ++contextReads === 1 ? [] : [{ contextType: 'TAB', frameId: 0, windowId: 90, tabId: 70, documentOrigin: origin.slice(0, -1), documentUrl: url(1) }];
  const older = toast.show(1, () => true); await flush(); const newer = toast.show(2, () => true);
  create.resolve({ id: 90, type: 'popup', tabs: [{ id: 70 }] }); await older; await newer;
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.deepEqual(state.removes, [90]); assert.deepEqual([...state.windows.keys()], [91]);
}));

test('a loading reservation never authorizes closing a foreign/replaced document', () => environment(async (toast, state) => {
  state.create = () => ({ id: 90, type: 'popup', tabs: [{ id: 70 }] });
  await toast.show(1, () => true); toast.cancel(); await flush();
  assert.deepEqual(state.removes, []);
  await toast.show(2, () => true); assert.equal(state.creates.length, 1, 'unknown loading window reserves the one-window slot');
  state.windows.set(90, { id: 90, type: 'popup', tabs: [{ id: 71, url: 'https://example.test/' }] });
  toast.cancel(); await flush(); assert.deepEqual(state.removes, []);
  await toast.show(3, () => true); assert.equal(state.creates.length, 2);
}));

test('pending foreign navigation wins over an old own context; only exact native TAB ownership allows removal', () => environment(async (toast, state) => {
  const current = { id: 9, type: 'popup', tabs: [{ id: 79 }] };
  const context = { contextType: 'TAB', frameId: 0, windowId: 9, tabId: 79, documentOrigin: origin.slice(0, -1), documentUrl: url(1) };
  state.windows.set(9, current);
  for (const changed of [{ tabId: 80 }, { windowId: 10 }, { frameId: 1 }, { documentOrigin: 'https://example.test' }, { documentUrl: origin + 'findings.html?activation=1' }]) {
    state.contexts = [{ ...context, ...changed }]; toast.cancel(); await flush(); assert.deepEqual(state.removes, []);
  }
  state.contexts = [context]; state.windows.set(9, { ...current, tabs: [{ id: 79, pendingUrl: 'https://example.test/' }] });
  toast.cancel(); await flush(); assert.deepEqual(state.removes, []);
  state.windows.set(9, current); toast.cancel(); await flush(); assert.deepEqual(state.removes, [9]);
}));

test('foreign navigation or tab replacement during an asynchronous context query cannot authorize closing its window', async () => {
  for (const tabs of [[{ id: 79, pendingUrl: 'https://example.test/' }], [{ id: 80 }]]) {
    await environment(async (toast, state) => {
      const context = deferred(); state.windows.set(9, { id: 9, type: 'popup', tabs: [{ id: 79 }] });
      state.getContexts = () => context.promise;
      toast.cancel(); await flush();
      state.windows.set(9, { id: 9, type: 'popup', tabs });
      context.resolve([{ contextType: 'TAB', frameId: 0, windowId: 9, tabId: 79, documentOrigin: origin.slice(0, -1), documentUrl: url(1) }]);
      await flush(); assert.deepEqual(state.removes, []);
    });
  }
});

test('restart survivors are closed before create; unrelated windows, additional tabs and malformed target queries remain untouched', () => environment(async (toast, state) => {
  state.windows.set(9, own());
  const invalid = [
    { ...own(10), type: 'normal' }, { ...own(11), tabs: [{ url: url(1) }, { url: 'about:blank' }] },
    { ...own(12), tabs: [{ url: url(1) + '#fragment' }] }, { ...own(13), tabs: [{ url: url(1) + '&activation=2' }] },
    { ...own(14), tabs: [{ url: url('01') }] }, { ...own(15), tabs: [{ url: url(1).replace('activation-toast.html', 'options.html') }] },
    { ...own(16), tabs: [{ url: 'https://example.test/activation-toast.html?activation=1' }] },
  ];
  for (const window of invalid) state.windows.set(window.id, window);
  await toast.show(2, () => true); assert.deepEqual(state.removes, [9]);
  assert.deepEqual([...state.windows.keys()], [...invalid.map(window => window.id), 100]);
}));

test('failure to remove an owned window reserves the slot and suppresses creation until cleanup succeeds', () => environment(async (toast, state) => {
  state.windows.set(9, own()); state.removeError = Error('browser refused');
  await toast.show(1, () => true); assert.equal(state.creates.length, 0);
  state.removeError = null; await toast.show(2, () => true);
  assert.equal(state.creates.length, 1); assert.deepEqual([...state.windows.keys()], [100]);
}));
