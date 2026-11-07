import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../../..');
const built = await build({ entryPoints: [resolve(root, 'apps/production-protect/src/activation-focus.ts')], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
const M = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const target = { tabId: 7, windowId: 3, documentId: 'document-a', documentKey: '7:0:document-a' };
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const state = { eligible: true, tab: { id: 7, windowId: 3, active: true }, window: { type: 'normal', focused: true }, frame: { documentId: 'document-a', documentLifecycle: 'active' }, calls: 0 };
  const api = { tabs: { get: async () => { state.calls++; return state.tab; } }, windows: { get: async () => state.window }, webNavigation: { getFrame: async () => state.frame } };
  return { state, api, run: () => M.waitForActivationFocus(target, () => state.eligible, api), tick: async ms => { t.mock.timers.tick(ms); await settle(); } };
}
test('focused current native source delivers immediately without a retry', async t => {
  const f = fixture(t); assert.equal(await f.run(), true); assert.equal(f.state.calls, 1);
});
test('temporary action popup focus is deferred until the same source regains focus', async t => {
  const f = fixture(t); f.state.window.focused = false;
  let done = false; const pending = f.run().then(value => { done = true; return value; });
  await settle(); assert.equal(done, false); await f.tick(100); assert.equal(done, false);
  f.state.window.focused = true; await f.tick(100); assert.equal(await pending, true); assert.equal(f.state.calls, 3);
});
test('OFF and changed source tab/document/window cancel the queued activation', async t => {
  for (const change of [f => { f.state.eligible = false; }, f => { f.state.tab.active = false; }, f => { f.state.frame.documentId = 'document-b'; }, f => { f.state.tab.windowId = 4; }, f => { f.state.tab.pendingUrl = 'https://next.example/'; }]) {
    const f = fixture(t); f.state.window.focused = false; const pending = f.run(); await settle();
    change(f); f.state.window.focused = true; await f.tick(100); assert.equal(await pending, false); t.mock.timers.reset();
  }
});
test('inactive/error frames and non-normal browser windows are rejected', async t => {
  for (const change of [f => { f.state.frame = null; }, f => { f.state.frame.errorOccurred = true; }, f => { f.state.frame.documentLifecycle = 'prerender'; }, f => { f.state.window.type = 'popup'; }]) {
    const f = fixture(t); change(f); assert.equal(await f.run(), false); t.mock.timers.reset();
  }
});
test('unfocused source expires after a bounded five seconds', async t => {
  const f = fixture(t); f.state.window.focused = false; const pending = f.run(); await settle();
  for (let count = 0; count < 50; count++) await f.tick(100);
  assert.equal(await pending, false); assert.equal(f.state.calls, 50);
});
test('hung or failed native reads fail closed without later revival', async t => {
  const f = fixture(t); let resolve;
  f.api.tabs.get = () => new Promise(done => { resolve = done; });
  const pending = f.run(); await settle(); await f.tick(500); assert.equal(await pending, false);
  resolve(f.state.tab); await settle();
  f.api.tabs.get = async () => { throw new Error('tab gone'); }; assert.equal(await f.run(), false);
});
