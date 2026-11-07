// ADR-107: Ctrl/Cmd+S is scoped to one editor and prevented only when accepted; the dirty guard is one listener.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isSaveShortcut, registerSaveShortcut, registerDirtyGuard, registerPaletteCommands, collectPaletteCommands, PALETTE_COMMAND_KINDS, PALETTE_COMMAND_LIMIT, PALETTE_SOURCE_LIMIT } from '../../apps/production-extension/ui-shortcuts.js';

class FakeTarget {
  constructor(parent = null) { this.parent = parent; this.listeners = new Map(); }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  count(type) { return this.listeners.get(type)?.size ?? 0; }
  contains(node) { for (let current = node; current; current = current.parent) if (current === this) return true; return false; }
}
// Keyboard events bubble from the focused element through its ancestors, as in the browser.
function press(target, init = {}) {
  const event = { type: 'keydown', key: 's', code: 'KeyS', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false, target, ...init, preventDefault() { this.defaultPrevented = true; } };
  for (let node = target; node; node = node.parent) for (const listener of [...(node.listeners.get('keydown') ?? [])]) listener(event);
  return event;
}

test('ADR-107 save chord: Ctrl+S or Cmd+S by physical key or letter; Alt (AltGr), Shift and IME composition never match', () => {
  const base = { key: 's', code: 'KeyS', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: false };
  assert.equal(isSaveShortcut(base), true);
  assert.equal(isSaveShortcut({ ...base, ctrlKey: false, metaKey: true }), true, 'Cmd on macOS');
  assert.equal(isSaveShortcut({ ...base, key: 'ы' }), true, 'Russian layout: the physical S key');
  assert.equal(isSaveShortcut({ ...base, code: 'KeyD', key: 'S' }), true, 'Dvorak and similar: the typed letter');
  for (const variant of [{ ctrlKey: false }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { key: 'k', code: 'KeyK' }]) assert.equal(isSaveShortcut({ ...base, ...variant }), false, JSON.stringify(variant));
  for (const value of [null, undefined, {}]) assert.equal(isSaveShortcut(value), false);
});

test('ADR-107 registerSaveShortcut: handled only with focus inside the root and prevented only when the handler returns true', () => {
  const page = new FakeTarget(), root = new FakeTarget(page), field = new FakeTarget(root), outside = new FakeTarget(page);
  let result = true, calls = 0;
  const unregister = registerSaveShortcut(root, event => { calls++; assert.equal(event.target, field); return result; });
  assert.equal(root.count('keydown'), 1);
  assert.equal(press(field).defaultPrevented, true); assert.equal(calls, 1);
  assert.equal(press(outside).defaultPrevented, false, 'focus outside the editor: the browser keeps Ctrl+S'); assert.equal(calls, 1);
  for (const answer of [false, undefined, 1, 'true', Promise.resolve(true)]) { result = answer; assert.equal(press(field).defaultPrevented, false, String(answer)); }
  assert.equal(calls, 6);
  result = true; assert.equal(press(field, { key: 'k', code: 'KeyK' }).defaultPrevented, false); assert.equal(calls, 6, 'other chords never reach the handler');
  unregister(); unregister();
  assert.equal(root.count('keydown'), 0); assert.equal(press(field).defaultPrevented, false); assert.equal(calls, 6);
});

test('ADR-107 registerSaveShortcut: auto-repeat never saves twice and follows the first press; a throwing handler counts as refused', () => {
  const root = new FakeTarget(), field = new FakeTarget(root);
  let calls = 0, result = true;
  registerSaveShortcut(root, () => { calls++; if (result === 'throw') throw new Error('boom'); return result; });
  assert.equal(press(field).defaultPrevented, true);
  assert.equal(press(field, { repeat: true }).defaultPrevented, true, 'held keys keep the browser dialog away');
  assert.equal(calls, 1);
  result = false; assert.equal(press(field).defaultPrevented, false);
  assert.equal(press(field, { repeat: true }).defaultPrevented, false, 'a refused press lets the repeats through'); assert.equal(calls, 2);
  result = 'throw'; assert.equal(press(field).defaultPrevented, false); assert.equal(calls, 3);
});

test('ADR-107 registerSaveShortcut: nested editors - the inner one wins, an already prevented event is left alone', () => {
  const outer = new FakeTarget(), inner = new FakeTarget(outer), field = new FakeTarget(inner), seen = [];
  registerSaveShortcut(outer, () => { seen.push('outer'); return true; });
  const unregisterInner = registerSaveShortcut(inner, () => { seen.push('inner'); return true; });
  press(field); assert.deepEqual(seen, ['inner']);
  unregisterInner(); press(field); assert.deepEqual(seen, ['inner', 'outer']);
});

test('ADR-107 registerSaveShortcut: a missing root or handler registers nothing and returns a no-op', () => {
  for (const [root, handler] of [[null, () => true], [undefined, () => true], [{}, () => true], [new FakeTarget(), null], [new FakeTarget(), 'save']]) {
    const unregister = registerSaveShortcut(root, handler);
    assert.equal(typeof unregister, 'function'); unregister();
    if (root instanceof FakeTarget) assert.equal(root.count('keydown'), 0);
  }
});

test('ADR-107 registerDirtyGuard: one beforeunload listener per registration that blocks leaving only while dirty', () => {
  const window = new FakeTarget(); let dirty = false;
  const unregister = registerDirtyGuard(() => dirty, window);
  assert.equal(window.count('beforeunload'), 1);
  const leave = () => { const event = { returnValue: '', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; for (const listener of [...window.listeners.get('beforeunload') ?? []]) listener(event); return event; };
  assert.equal(leave().defaultPrevented, false);
  dirty = true; const blocked = leave(); assert.equal(blocked.defaultPrevented, true); assert.equal(blocked.returnValue, true);
  dirty = 'yes'; assert.equal(leave().defaultPrevented, false, 'only exactly true blocks');
  const second = registerDirtyGuard(() => { throw new Error('broken view'); }, window);
  assert.equal(window.count('beforeunload'), 2); dirty = false; assert.equal(leave().defaultPrevented, false, 'a throwing check never traps the page');
  second(); unregister(); unregister();
  assert.equal(window.count('beforeunload'), 0);
});

test('ADR-107 registerDirtyGuard: the default target is the global window; invalid input is a no-op', t => {
  const window = new FakeTarget(), previous = ['addEventListener', 'removeEventListener'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  globalThis.addEventListener = (type, listener) => window.addEventListener(type, listener); globalThis.removeEventListener = (type, listener) => window.removeEventListener(type, listener);
  t.after(() => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const unregister = registerDirtyGuard(() => true);
  assert.equal(window.count('beforeunload'), 1); unregister(); assert.equal(window.count('beforeunload'), 0);
  registerDirtyGuard('dirty')(); registerDirtyGuard(() => true, null)(); assert.equal(window.count('beforeunload'), 0);
});

test('ADR-107 palette commands: a closed kind list, bounded and validated providers that live only while registered', () => {
  assert.deepEqual([...PALETTE_COMMAND_KINDS], ['load-profile', 'randomize', 'apply-profile', 'apply-network', 'export-profile', 'start-tour', 'resume-tour']);
  for (const kind of PALETTE_COMMAND_KINDS) assert.doesNotMatch(kind, /grant|permission|settings|request/u, 'no permission-requesting command');
  const run = () => {};
  let profiles = [{ kind: 'load-profile', key: 'p1', name: 'Офис', run }, { kind: 'load-profile', key: 'p2', name: 'Дом', run }];
  const unregister = registerPaletteCommands('fingerprint-profiles', () => [...profiles, { kind: 'randomize', run }, { kind: 'apply-profile', run },
    { kind: 'grant-early', run }, { kind: 'load-profile', key: 'p3', name: '', run }, { kind: 'load-profile', key: 'p4', name: 'x'.repeat(129), run }, { kind: 'randomize', run }, { kind: 'export-profile' }, null, 'randomize']);
  const listed = collectPaletteCommands();
  assert.deepEqual(listed.map(command => [command.id, command.kind, command.name]), [
    ['fingerprint-profiles:load-profile:p1', 'load-profile', 'Офис'], ['fingerprint-profiles:load-profile:p2', 'load-profile', 'Дом'],
    ['fingerprint-profiles:randomize:randomize', 'randomize', null], ['fingerprint-profiles:apply-profile:apply-profile', 'apply-profile', null]]);
  assert.ok(listed.every(command => Object.isFrozen(command) && command.run === run));
  profiles = Array.from({ length: PALETTE_COMMAND_LIMIT + 10 }, (_, index) => ({ kind: 'load-profile', key: 'p' + index, name: 'P' + index, run }));
  assert.equal(collectPaletteCommands().length, PALETTE_COMMAND_LIMIT, 'one source never floods the palette');
  const broken = registerPaletteCommands('broken-source', () => { throw new Error('unmounted'); });
  const replaced = registerPaletteCommands('antidetect-network', () => [{ kind: 'apply-network', run }]);
  assert.equal(collectPaletteCommands().filter(command => command.source === 'antidetect-network').length, 1, 'a throwing provider is skipped, the others stay');
  const stale = registerPaletteCommands('antidetect-network', () => []);
  replaced(); assert.equal(collectPaletteCommands().filter(command => command.source === 'antidetect-network').length, 0, 'an old unregister never removes its replacement');
  stale(); broken(); unregister(); unregister();
  assert.deepEqual(collectPaletteCommands(), []);
  for (const id of ['', 'Bad Id', 'x'.repeat(65), 7]) assert.equal(registerPaletteCommands(id, () => [{ kind: 'randomize', run }])(), undefined);
  assert.deepEqual(collectPaletteCommands(), []);
  const many = Array.from({ length: PALETTE_SOURCE_LIMIT + 2 }, (_, index) => registerPaletteCommands('source-' + index, () => [{ kind: 'randomize', run }]));
  assert.equal(collectPaletteCommands().length, PALETTE_SOURCE_LIMIT, 'the number of sources is bounded');
  for (const release of many) release();
  assert.deepEqual(collectPaletteCommands(), []);
});

test('ADR-107 shortcuts module: no storage, messages, network or permission requests', () => {
  const source = readFileSync(new URL('../../apps/production-extension/ui-shortcuts.js', import.meta.url), 'utf8').replace(/\/\/.*$/gmu, '');
  for (const banned of ['localStorage', 'sessionStorage', 'chrome.', 'browser.', 'sendMessage', 'permissions', 'fetch(', 'innerHTML']) assert.ok(!source.includes(banned), banned);
});
