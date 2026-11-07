// ADR-047 (S2, port plan §2.3, B3): the per-tab firewall badge of the module «Защита» coexists with the production
// toolbar. Runs the shipped BadgeManager in vm (as toolbar-appearance.test.mjs) with an injected `protect`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../apps/production-extension/background.js', import.meta.url), 'utf8');
const from = source.indexOf('// packages/background/src/badge.ts'), to = source.indexOf('// packages/background/src/pro-redaction.ts', from);
const badgeSource = source.slice(from, to);
const BLUE = '#2456B3';

function fixture(max = 256) {
  const state = { tabs: new Map(), bindings: new Map(), reports: new Map(), metas: new Map() };
  const controls = { observing: true, blocking: false }, calls = [];
  const action = Object.fromEntries(['setIcon', 'setBadgeBackgroundColor', 'setBadgeTextColor', 'setTitle', 'setBadgeText'].map((method) => [method, async (args) => calls.push([method, JSON.parse(JSON.stringify(args))])]));
  const api = { action, webNavigation: { getAllFrames: async () => [{ frameId: 0, documentId: 'top', documentLifecycle: 'active' }] },
    storage: { local: { get: async () => ({}) }, onChanged: { addListener() {}, removeListener() {} } }, tabs: { query: async () => [{ id: 7 }] } };
  const context = vm.createContext({ TECHNIQUE_IDS: ['DET-001', 'DET-002'], MAX_DOCUMENTS_GLOBAL: max, MAX_BINDINGS_PER_TAB: 128,
    BADGE_LANGUAGE_KEY: 'language', badgeLanguage: () => null, badgeLabel: () => null, badgeBrowserLanguage: () => null, setTimeout: () => 1, clearTimeout() {} });
  vm.runInContext(badgeSource, context);
  const manager = new context.BadgeManager(api, () => state, () => true, () => controls);
  const pending = new Map(), asked = [];
  manager.protect = (tabId, language) => {
    asked.push([tabId, language]);
    const n = pending.get(tabId) ?? 0;
    return n > 0 ? { text: n > 9 ? '9+' : String(n), color: BLUE, title: 'Firewall: ' + n } : null;
  };
  const render = async (id = null) => { manager.mark(id); const item = manager.work.get(id); if (!item) return; item.dirty = false; await manager.update(id, item); if (!item.dirty) manager.work.delete(id); };
  const addCount = (tabId = 7) => {
    const doc = 'doc' + tabId;
    state.tabs.set(tabId, { activeTopDocumentKey: doc });
    state.bindings.set('binding' + tabId, { tabId, frameId: 0, documentId: 'top', documentKey: doc, parentDocumentId: null, documentLifecycle: 'active', accessGranted: true });
    state.metas.set(doc, { bound: true, revoked: false, accessGranted: true });
    state.reports.set(doc, { tabId, counters: [{ techniqueId: 'DET-001', count: 3 }, { techniqueId: 'DET-002', count: 4 }] });
  };
  const tabCalls = (tabId) => calls.filter(([, args]) => args.tabId === tabId);
  const lastOf = (method, tabId) => calls.filter(([name, args]) => name === method && args.tabId === tabId).at(-1)?.[1];
  return { state, controls, calls, manager, render, addCount, pending, asked, tabCalls, lastOf };
}

test('no prompts: the shipped badge behaves exactly as before (no per-tab colour or title, no module tab)', async () => {
  const f = fixture(); f.addCount(); await f.render(); await f.render(7);
  assert.equal(f.lastOf('setBadgeText', 7).text, '2');
  assert.equal(f.lastOf('setBadgeBackgroundColor', 7), undefined);
  assert.equal(f.lastOf('setTitle', 7), undefined);
  assert.equal(f.manager.protectTabs.size, 0);
  assert.deepEqual(f.asked.at(-1), [7, null], 'the module is asked with the production language (null = browser default in B8)');
  assert.equal(f.asked.some(([tabId]) => tabId === null), false, 'the global appearance never asks the module');
});

for (const mode of ['observing', 'blocking', 'off']) test('prompts win in ' + mode + ' mode: module text, colour and tooltip on that tab only', async () => {
  const f = fixture(); f.addCount();
  if (mode === 'blocking') f.controls.blocking = true;
  if (mode === 'off') f.controls.observing = false;
  f.pending.set(7, 1); await f.render(); await f.render(7);
  assert.equal(f.lastOf('setBadgeText', 7).text, '1');
  assert.equal(f.lastOf('setBadgeBackgroundColor', 7).color, BLUE);
  assert.equal(f.lastOf('setTitle', 7).title, 'Firewall: 1');
  assert.notEqual(f.lastOf('setBadgeBackgroundColor', undefined).color, BLUE, 'the global colour stays production');
  f.pending.set(7, 12); await f.render(7);
  assert.equal(f.lastOf('setBadgeText', 7).text, '9+');
  const writes = f.calls.length; await f.render(7);
  assert.equal(f.calls.length, writes, 'unchanged prompts write nothing');
});

test('prompts gone: the tab text, colour and title go back to the production appearance once', async () => {
  const f = fixture(); f.addCount(); f.pending.set(7, 2); await f.render(); await f.render(7);
  f.pending.delete(7); await f.render(7);
  assert.equal(f.lastOf('setBadgeText', 7).text, '2', 'technique count again');
  assert.equal(f.lastOf('setBadgeBackgroundColor', 7).color, '#DC2626');
  assert.equal(f.lastOf('setTitle', 7).title, 'Detect Expert');
  const writes = f.calls.length; await f.render(7);
  assert.equal(f.calls.length, writes, 'restored once, then quiet');
  // A later global change repaints the restored tab so its own colour never goes stale.
  f.controls.blocking = true; f.manager.markAll();
  assert.ok(f.manager.work.has(7));
  await f.render(); await f.render(7);
  assert.equal(f.lastOf('setBadgeBackgroundColor', 7).color, '#168451');
  assert.equal(f.lastOf('setTitle', 7).title, 'Detect Expert — ON');
  assert.equal(f.lastOf('setBadgeText', 7).text, null, 'the global ON shows');
});

test('a zero count is never shown and a throwing or malformed module answer falls back to production', async () => {
  for (const answer of [() => { throw new Error('x'); }, () => ({ text: '', color: BLUE, title: 't' }), () => ({ text: 1, color: BLUE, title: 't' }), () => 'nope', () => undefined]) {
    const f = fixture(); f.addCount(); f.manager.protect = answer; await f.render(); await f.render(7);
    assert.equal(f.lastOf('setBadgeText', 7).text, '2');
    assert.equal(f.lastOf('setBadgeBackgroundColor', 7), undefined);
    assert.equal(f.manager.protectTabs.size, 0);
  }
});

test('module tabs are bounded, cleared on tab removal and on stop', async () => {
  const f = fixture(2);
  for (const id of [1, 2, 3]) f.pending.set(id, 1);
  for (const id of [1, 2, 3]) await f.render(id);
  assert.deepEqual([...f.manager.protectTabs.keys()].sort(), [1, 2]);
  assert.equal(f.lastOf('setBadgeBackgroundColor', 3), undefined, 'over the bound: production badge only');
  f.manager.afterEvent({ type: 'tab:removed', tabId: 1 }, f.state);
  assert.equal(f.manager.protectTabs.has(1), false);
  f.manager.stop();
  assert.equal(f.manager.protectTabs.size, 0);
});
