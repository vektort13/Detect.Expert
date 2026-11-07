// ADR-107: the shared live regions are rendered once and filled with bounded plain text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { announce, announcerRegions, ANNOUNCER_ATTRIBUTE, ANNOUNCE_MAX_LENGTH, ANNOUNCE_CLEAR_MS, ANNOUNCE_GAP_MS, ANNOUNCE_BATCH, ANNOUNCE_MODAL_WAIT_MS } from '../../apps/production-extension/ui-announcer.js';

class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.parentNode = null; this.attributes = {}; this._text = ''; this.connected = false; }
  get isConnected() { let node = this; while (node.parentNode) node = node.parentNode; return node.connected === true; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(node) { node.parentNode?.children.splice(node.parentNode.children.indexOf(node), 1); node.parentNode = this; this.children.push(node); }
  remove() { if (!this.parentNode) return; this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  contains(node) { for (let current = node; current; current = current.parentNode) if (current === this) return true; return false; }
}
function fakeDocument({ modalSupported = true } = {}) {
  const body = new FakeNode('body'); body.connected = true;
  const regions = { polite: new FakeNode('div'), assertive: new FakeNode('div') };
  for (const [kind, region] of Object.entries(regions)) { region.attributes[ANNOUNCER_ATTRIBUTE] = kind; body.append(region); }
  let modal = null, created = [];
  const document = {
    body, regions, created,
    createElement(tag) { const node = new FakeNode(tag); created.push(node); return node; },
    querySelector(selector) {
      if (selector === ':modal') { if (!modalSupported) throw new SyntaxError('unknown pseudo-class'); return modal; }
      const match = /^\[data-ui-announcer="(polite|assertive)"\]$/u.exec(selector);
      return match && regions[match[1]].parentNode ? regions[match[1]] : null;
    },
    openModal() { modal = new FakeNode('dialog'); body.append(modal); return modal; },
    closeModal() { modal?.remove(); modal = null; },
  };
  return document;
}
function withDocument(t, document) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return document;
}
const texts = region => region.children.map(child => child.textContent);
// The mock clock runs only the timers due when tick() starts, so polling is advanced in small steps.
const advance = (t, ms, step = 10) => { for (let elapsed = 0; elapsed < ms; elapsed += step) t.mock.timers.tick(Math.min(step, ms - elapsed)); };

test('ADR-107 announcer regions: one polite status and one assertive alert, visually hidden, keyed so the shell mounts them once', () => {
  const regions = announcerRegions((type, props) => ({ type, props }));
  assert.equal(regions.length, 2);
  assert.deepEqual(regions.map(node => [node.type, node.props.role, node.props['aria-live'], node.props['aria-atomic'], node.props[ANNOUNCER_ATTRIBUTE], node.props.key]), [
    ['div', 'status', 'polite', 'true', 'polite', 'ui-announcer-polite'], ['div', 'alert', 'assertive', 'true', 'assertive', 'ui-announcer-assertive']]);
  for (const node of regions) { assert.match(node.props.class, /\bsr-only\b/u); assert.equal(node.props.children, undefined, 'the regions start empty and are filled only by announce()'); }
});

test('ADR-107 announce: polite by default, assertive on request, plain text in a new element after the gap', t => {
  const document = withDocument(t, fakeDocument());
  assert.equal(announce('Профиль загружен'), true);
  assert.deepEqual(texts(document.regions.polite), [], 'delivered asynchronously');
  t.mock.timers.tick(0);
  assert.deepEqual(texts(document.regions.polite), ['Профиль загружен']); assert.deepEqual(texts(document.regions.assertive), []);
  assert.equal(announce('Не удалось сохранить', { assertive: true }), true); t.mock.timers.tick(0);
  assert.deepEqual(texts(document.regions.assertive), ['Не удалось сохранить']);
  assert.ok(document.created.every(node => node.tag === 'div'), 'only plain elements are created');
});

test('ADR-107 announce: a repeated identical message is removed first and shown again after the gap; messages clear themselves', t => {
  const document = withDocument(t, fakeDocument());
  announce('Сохранено'); t.mock.timers.tick(0);
  const first = document.regions.polite.children[0];
  announce('Сохранено');
  assert.deepEqual(texts(document.regions.polite), [], 'the previous message leaves at once');
  t.mock.timers.tick(ANNOUNCE_GAP_MS - 1); assert.deepEqual(texts(document.regions.polite), []);
  t.mock.timers.tick(1); assert.deepEqual(texts(document.regions.polite), ['Сохранено']);
  assert.notEqual(document.regions.polite.children[0], first, 'a new element, so the change is announced again');
  t.mock.timers.tick(ANNOUNCE_CLEAR_MS - 1); assert.equal(document.regions.polite.children.length, 1);
  t.mock.timers.tick(1); assert.equal(document.regions.polite.children.length, 0, 'stale text never stays in the virtual buffer');
});

test('ADR-107 announce: a burst is joined into one bounded announcement that keeps the newest messages', t => {
  const document = withDocument(t, fakeDocument());
  for (const word of ['one', 'two', 'three', 'four', 'five']) announce(word);
  t.mock.timers.tick(0);
  assert.equal(ANNOUNCE_BATCH, 3); assert.deepEqual(texts(document.regions.polite), ['three four five']);
  announce('x'.repeat(ANNOUNCE_MAX_LENGTH + 40)); t.mock.timers.tick(ANNOUNCE_GAP_MS);
  assert.equal(texts(document.regions.polite)[0].length, ANNOUNCE_MAX_LENGTH);
  announce('y'.repeat(ANNOUNCE_MAX_LENGTH - 1) + '😀'); t.mock.timers.tick(ANNOUNCE_GAP_MS);
  assert.equal(texts(document.regions.polite)[0], 'y'.repeat(ANNOUNCE_MAX_LENGTH - 1), 'a cut never leaves half a surrogate pair');
});

test('ADR-107 announce: only non-empty strings are accepted and nothing is coerced', t => {
  const document = withDocument(t, fakeDocument());
  let coerced = 0; const hostile = { toString() { coerced++; return 'x'; } };
  for (const value of [undefined, null, 7, '', '   ', hostile, ['a'], Symbol('s')]) assert.equal(announce(value), false);
  assert.equal(announce('ok', null), true, 'a null options object means polite');
  t.mock.timers.tick(0);
  assert.equal(coerced, 0); assert.deepEqual(texts(document.regions.polite), ['ok']); assert.deepEqual(texts(document.regions.assertive), []);
});

test('ADR-107 announce: without mounted regions or without a document it is a quiet no-op', t => {
  const document = withDocument(t, fakeDocument());
  document.regions.polite.remove(); document.regions.assertive.remove();
  assert.equal(announce('nobody hears this'), false); assert.equal(announce('nor this', { assertive: true }), false);
  delete globalThis.document;
  assert.equal(announce('no document'), false);
});

test('ADR-107 announce: delivery waits while a modal dialog makes the regions inert, bounded by the modal wait', t => {
  const document = withDocument(t, fakeDocument());
  document.openModal(); announce('после закрытия'); t.mock.timers.tick(0);
  assert.deepEqual(texts(document.regions.polite), [], 'held back while the dialog is modal');
  advance(t, 200); assert.deepEqual(texts(document.regions.polite), []);
  document.closeModal(); advance(t, 50);
  assert.deepEqual(texts(document.regions.polite), ['после закрытия']);
  document.openModal(); announce('stuck dialog'); advance(t, ANNOUNCE_GAP_MS);
  advance(t, ANNOUNCE_MODAL_WAIT_MS - 50); assert.deepEqual(texts(document.regions.polite), []);
  advance(t, 50); assert.deepEqual(texts(document.regions.polite), ['stuck dialog'], 'never waits forever');
});

test('ADR-107 announce: engines without the :modal selector deliver at once', t => {
  const document = withDocument(t, fakeDocument({ modalSupported: false }));
  announce('direct'); t.mock.timers.tick(0);
  assert.deepEqual(texts(document.regions.polite), ['direct']);
});

test('ADR-107 announcer module: textContent only, no markup sinks, storage, messages or network', () => {
  const source = readFileSync(new URL('../../apps/production-extension/ui-announcer.js', import.meta.url), 'utf8').replace(/\/\/.*$/gmu, '');
  for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'localStorage', 'sessionStorage', 'chrome.', 'browser.', 'sendMessage', 'fetch(', 'console.']) assert.ok(!source.includes(banned), banned);
  assert.match(source, /node\.textContent = text/u);
});
