// ADR-052: real browser adapter ownership/focus guards, without creating a desktop window in unit tests.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../..');
const built = await build({ entryPoints: [resolve(root, 'apps/production-protect/src/findings-window.ts')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const W = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';
const url = origin + 'findings.html?tab=7&document=7%3A0%3Adoc';
const owned = (id = 9) => ({ id, type: 'popup', tabs: [{ url }] });
function environment(run) {
  const before = globalThis.chrome;
  const state = {
    source: { id: 1, type: 'normal', focused: true, incognito: false, left: -1920, top: 100, width: 1600, height: 900 },
    tab: { id: 7, active: true, windowId: 1 }, popups: [], contexts: [], windows: new Map([[9, owned()]]), creates: [], removes: [], removeError: null,
  };
  globalThis.chrome = { runtime: { getURL: path => origin + path, getContexts: async () => state.contexts }, tabs: { get: async () => state.tab }, windows: {
    getAll: async () => state.popups,
    get: async id => { if (id === 1) return state.source; if (!state.windows.has(id)) throw new Error('closed'); return state.windows.get(id); },
    create: async options => { state.creates.push(options); return { id: 10, type: 'popup', tabs: [{ id: 80 }] }; },
    remove: async id => { state.removes.push(id); if (state.removeError) throw state.removeError; state.windows.delete(id); },
  } };
  return Promise.resolve().then(() => run(state)).finally(() => { if (before === undefined) delete globalThis.chrome; else globalThis.chrome = before; });
}

test('exact window ownership includes initial pending URL and rejects unrelated or navigated windows', () => environment(async () => {
  assert.deepEqual(W.ownedFindingsTarget(owned()), { tabId: 7, documentKey: '7:0:doc' });
  assert.deepEqual(W.ownedFindingsTarget({ ...owned(), tabs: [{ url: 'about:blank', pendingUrl: url }] }), { tabId: 7, documentKey: '7:0:doc' });
  for (const window of [
    { ...owned(), type: 'normal' }, { ...owned(), tabs: [{ url }, { url: 'about:blank' }] },
    { ...owned(), tabs: [{ url: url + '#x' }] }, { ...owned(), tabs: [{ url: url.replace('tab=7', 'tab=8') }] },
    { ...owned(), tabs: [{ url, pendingUrl: 'https://example.test/' }] },
    { ...owned(), tabs: [{ url: url.replace('chrome-extension:', 'https:') }] },
    { ...owned(), tabs: [{ url: url.replace('findings.html', 'options.html') }] },
  ]) assert.equal(W.ownedFindingsTarget(window), null);
}));

test('redacted extension tab URLs use exact native runtime context ownership without tabs permission', () => environment(async state => {
  const window = { id: 9, type: 'popup', tabs: [{ id: 70 }] };
  const context = { contextType: 'TAB', frameId: 0, windowId: 9, tabId: 70, documentOrigin: origin.slice(0, -1), documentUrl: url };
  assert.deepEqual(W.contextFindingsTarget(window, [context]), { tabId: 7, documentKey: '7:0:doc' });
  for (const wrong of [{ ...context, tabId: 71 }, { ...context, windowId: 10 }, { ...context, frameId: 1 }, { ...context, documentOrigin: 'https://example.test' }, { ...context, documentUrl: url.replace('findings.html', 'options.html') }]) {
    assert.equal(W.contextFindingsTarget(window, [wrong]), null);
  }
  assert.equal(W.contextFindingsTarget(window, [context, context]), null);
  state.windows.set(9, window); state.contexts = [context]; state.popups = [window];
  assert.equal(await W.findingsWindowExists(9), true);
  assert.deepEqual(await W.openFindingsWindows(), [{ tabId: 7, documentKey: '7:0:doc', windowId: 9 }]);
  await W.removeFindingsWindow(9);
  assert.deepEqual(state.removes, [9]);
}));

test('popup creation leaves initial placement to Chrome, avoids focus, and uses a fixed extension-only document URL', () => environment(async state => {
  assert.equal(await W.createFindingsWindow(7, '7:0:doc', 1, () => true), 10);
  assert.deepEqual(state.creates, [{ url, type: 'popup', focused: false, incognito: false, width: 420, height: 500 }]);
}));

test('no window for stale, inactive, unfocused, invalid or already open findings', () => environment(async state => {
  assert.equal(await W.createFindingsWindow(7, '8:0:doc', 1, () => true), null);
  assert.equal(await W.createFindingsWindow(7, '7:0:doc', 1, () => false), null);
  state.tab.active = false;
  assert.equal(await W.createFindingsWindow(7, '7:0:doc', 1, () => true), null);
  state.tab.active = true; state.source.focused = false;
  assert.equal(await W.createFindingsWindow(7, '7:0:doc', 1, () => true), null);
  state.source.focused = true; state.popups = [owned()];
  assert.equal(await W.createFindingsWindow(7, '7:0:doc', 1, () => true), null);
  assert.deepEqual(state.creates, []);
}));

test('removal never closes a foreign window and a live removal failure remains observable', () => environment(async state => {
  state.windows.set(11, { id: 11, type: 'popup', tabs: [{ url: 'https://example.test/' }] });
  await W.removeFindingsWindow(11);
  assert.deepEqual(state.removes, []);
  state.removeError = new Error('blocked');
  await assert.rejects(W.removeFindingsWindow(9), /blocked/);
  state.removeError = null;
  await W.removeFindingsWindow(9);
  assert.equal(await W.findingsWindowExists(9), false);
}));

test('creation provenance only reserves a loading slot and never authorizes closing a redacted foreign document', () => environment(async state => {
  await W.createFindingsWindow(7, '7:0:doc', 1, () => true);
  state.windows.set(10, { id: 10, type: 'popup', tabs: [{ id: 80 }] });
  assert.equal(await W.findingsWindowExists(10), true);
  await assert.rejects(W.removeFindingsWindow(10), /not-ready/);
  assert.deepEqual(state.removes, []);
  state.windows.set(10, { id: 10, type: 'popup', tabs: [{ id: 81 }] });
  assert.equal(await W.findingsWindowExists(10), false, 'a replacement tab loses provenance');
  await W.removeFindingsWindow(10);
  assert.deepEqual(state.removes, []);
  W.forgetFindingsWindow(10);
}));

test('restart recovery selects only exact owned windows and fails closed on excessive popup count', () => environment(async state => {
  state.popups = [owned(), { id: 11, type: 'popup', tabs: [{ url: 'https://example.test/' }] }];
  assert.deepEqual(await W.openFindingsWindows(), [{ tabId: 7, documentKey: '7:0:doc', windowId: 9 }]);
  state.popups = Array.from({ length: 257 }, (_, id) => ({ id, type: 'popup', tabs: [] }));
  await assert.rejects(W.createFindingsWindow(7, '7:0:doc', 1, () => true), /budget/);
  assert.deepEqual(state.creates, []);
}));
