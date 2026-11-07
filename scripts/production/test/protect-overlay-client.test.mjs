// ADR-058: client ticket lifetime only. The trusted-event objects below are explicit unit stubs;
// real browser isTrusted, hit-testing and ISOLATED boundaries require the separate native fixture.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../../..');
const built = await build({ entryPoints: [resolve(root, 'apps/production-protect/src/overlay-client.ts')], bundle: true, write: false, platform: 'neutral', format: 'iife', globalName: 'OverlayClientTest', logLevel: 'silent' });
const target = (over = {}) => ({ schemaVersion: 1, type: 'protect-overlay-show', kind: 'findings', generation: 1, tabId: 12, documentKey: '12:0:document', locale: 'ru', state: {}, report: {}, ...over });
function fixture({ held = false } = {}) {
  let nextTimer = 0, now = 0, release;
  const timers = new Map(), sent = [];
  const reply = held ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ ok: true, value: null });
  const context = vm.createContext({
    setTimeout(callback, milliseconds) { const id = ++nextTimer; timers.set(id, { callback, at: now + milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); },
    chrome: { runtime: { sendMessage: message => { sent.push(message); return reply; } } },
  });
  vm.runInContext(built.outputFiles[0].text, context);
  const client = context.OverlayClientTest;
  const advance = milliseconds => {
    now += milliseconds;
    for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (timer.at <= now && timers.delete(id)) timer.callback();
  };
  client.setOverlayTarget(target());
  return { client, timers, sent, advance, release: value => release(value) };
}
const trusted = Object.freeze({ isTrusted: true });
const untrusted = Object.freeze({ isTrusted: false });

test('a trusted capture ticket survives the real microtask checkpoint until its one button action', async () => {
  const f = fixture(); f.client.allowOverlayGesture(trusted);
  await Promise.resolve(); await Promise.resolve();
  assert.equal((await f.client.overlayAction('settings')).ok, true);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].action, 'settings');
  assert.equal((await f.client.overlayAction('settings')).code, 'unauthorized-sender');
  assert.equal(f.sent.length, 1);
});

test('the next timer task expires an unused gesture and synthetic event stubs grant nothing', async () => {
  const f = fixture(); f.client.allowOverlayGesture(trusted); f.advance(0);
  assert.equal((await f.client.overlayAction('decide', {})).code, 'unauthorized-sender');
  f.client.allowOverlayGesture(untrusted);
  assert.equal((await f.client.overlayAction('settings')).code, 'unauthorized-sender'); assert.equal(f.sent.length, 0);
});

test('one authorized request consumes the ticket before its response settles, preventing double dispatch', async () => {
  const f = fixture({ held: true }); f.client.allowOverlayGesture(trusted);
  const first = f.client.overlayAction('decide', { scope: 'once' });
  const second = await f.client.overlayAction('decide', { scope: 'once' });
  assert.equal(second.code, 'unauthorized-sender'); assert.equal(f.sent.length, 1);
  f.release({ ok: true, value: null }); assert.equal((await first).ok, true); assert.equal(f.timers.size, 0);
});

test('closing the target clears its ticket and cannot authorize a later reopened card', async () => {
  const f = fixture(); f.client.allowOverlayGesture(trusted);
  f.client.setOverlayTarget(null); assert.equal(f.timers.size, 0);
  assert.equal((await f.client.overlayAction('settings')).code, 'document-mismatch');
  f.client.setOverlayTarget(target({ generation: 2 }));
  assert.equal((await f.client.overlayAction('settings')).code, 'unauthorized-sender'); assert.equal(f.sent.length, 0);
});

test('same-generation state refresh preserves the current event ticket, without granting an extra action', async () => {
  const f = fixture(); f.client.allowOverlayGesture(trusted);
  f.client.setOverlayTarget(target({ report: { protectRevision: 2 } }));
  assert.equal((await f.client.overlayAction('settings')).ok, true);
  assert.equal((await f.client.overlayAction('settings')).code, 'unauthorized-sender'); assert.equal(f.sent.length, 1);
});

test('a new generation, kind or document cannot spend the previous card event ticket', async () => {
  for (const over of [{ generation: 2 }, { kind: 'activation' }, { documentKey: '12:0:successor' }]) {
    const f = fixture(); f.client.allowOverlayGesture(trusted);
    f.client.setOverlayTarget(target(over));
    assert.equal(f.timers.size, 0);
    assert.equal((await f.client.overlayAction('settings')).code, 'unauthorized-sender'); assert.equal(f.sent.length, 0);
    f.client.allowOverlayGesture(trusted);
    assert.equal((await f.client.overlayAction('settings')).ok, true);
    assert.equal(f.sent[0].generation, over.generation ?? 1);
    assert.equal(f.sent[0].kind, over.kind ?? 'findings');
    assert.equal(f.sent[0].documentKey, over.documentKey ?? '12:0:document');
  }
});

test('a cancelled old expiry cannot clear a newer gesture ticket', async () => {
  const f = fixture(); f.client.allowOverlayGesture(trusted);
  const olderExpiry = [...f.timers.values()][0].callback;
  f.client.allowOverlayGesture(trusted); olderExpiry();
  assert.equal((await f.client.overlayAction('settings')).ok, true);
  f.advance(0); assert.equal((await f.client.overlayAction('settings')).code, 'unauthorized-sender'); assert.equal(f.sent.length, 1);
});
