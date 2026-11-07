// ADR-113: the card of the setting on the Antidetect page. It asks the service worker with two messages, shows only what was answered,
// never keeps its own copy of the setting, drops answers that were overtaken, and sits in the Network level OUTSIDE the Save form.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createAntidetectQuietUi } from '../../apps/production-extension/antidetect-quiet-ui.js';
import { createAntidetectUi } from '../../apps/production-extension/antidetect-ui.js';
import { createApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { ANTIDETECT_QUIET_LABELS } from '../../apps/production-extension/antidetect-quiet-labels.js';
import { SENSOR_QUIET_KEY } from '../../apps/production-extension/sensor-quiet.js';

const EN = ANTIDETECT_QUIET_LABELS.en;
const plain = value => JSON.parse(JSON.stringify(value));
const turn = () => new Promise(resolve => setImmediate(resolve));
const state = (over = {}) => ({ schemaVersion: 1, type: 'sensor-quiet-state', setting: false, antidetect: false, scoped: true, effective: false, healthy: true, ...over });

function fake(handler) {
  const calls = [], listeners = new Set();
  const api = { runtime: { id: 'quiet-ui', sendMessage: async message => { calls.push(plain(message)); return handler(message, calls); } },
    storage: { onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } } };
  return { api, calls, listeners, emit: (changes, area = 'local') => { for (const fn of [...listeners]) fn(changes, area); } };
}
function harness(browserApi, { locale = 'en', active = true } = {}) {
  const slots = [], effects = []; let cursor = 0, changed = true, tree, props = { active };
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; changed = true; } }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies?.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } },
  };
  const ui = createAntidetectQuietUi({ ...hooks, h: (type, p) => ({ type, props: p }), useLocale: () => locale, browserApi });
  const render = () => { cursor = 0; changed = false; tree = ui.QuietSensorsCard(props); while (effects.length) effects.shift()(); return tree; };
  const settle = async () => { for (let index = 0; index < 12; index++) { if (changed) render(); await turn(); } if (changed) render(); return tree; };
  const nodes = predicate => { const out = []; (function visit(node) { if (Array.isArray(node)) { node.forEach(visit); return; } if (!node?.props) return; if (predicate(node)) out.push(node); visit(node.props.children); })(tree); return out; };
  const attr = (key, value = true) => nodes(node => node.props[key] === value)[0];
  const text = node => [].concat(node?.props?.children ?? []).flat(5).map(child => typeof child === 'string' ? child : text(child)).join('');
  return { render, settle, nodes, attr, text, get tree() { return tree; }, update(next) { props = { ...props, ...next }; changed = true; }, unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}
const checkbox = h => h.attr('data-antidetect-quiet-toggle');
const status = h => h.attr('data-antidetect-quiet-status', h.attr('data-antidetect-quiet-status')?.props['data-antidetect-quiet-status']);

test('mounting asks once and writes nothing; the card names its state, its limits and its reload rule', async () => {
  const f = fake(() => state());
  const h = harness(f.api); h.render(); await h.settle();
  assert.deepEqual(f.calls, [{ schemaVersion: 1, type: 'ui-sensor-quiet-get' }]);
  assert.equal(h.tree.props['data-antidetect-quiet'], 'off');
  assert.equal(checkbox(h).props.checked, false); assert.equal(checkbox(h).props.disabled, false);
  const line = h.nodes(node => node.props.id === 'antidetect-quiet-status')[0];
  assert.equal(h.text(line), EN.status_off); assert.equal(line.props.role, 'status');
  assert.equal(checkbox(h).props['aria-describedby'], 'antidetect-quiet-status');
  assert.equal(h.tree.props['aria-labelledby'], 'antidetect-quiet-title'); assert.equal(h.nodes(node => node.props.id === 'antidetect-quiet-title')[0].type, 'h3');
  assert.equal(h.text(h.attr('data-antidetect-quiet-what')), EN.what); assert.equal(h.text(h.attr('data-antidetect-quiet-reload')), EN.reload);
  const limits = h.attr('data-antidetect-quiet-limits'); assert.equal(limits.props.children.length, 2);
  assert.deepEqual(limits.props.children.map(item => h.text(item)), [EN.limit_own, EN.limit_other]);
  assert.equal(f.listeners.size, 1, 'one storage listener'); h.unmount(); assert.equal(f.listeners.size, 0, 'removed on unmount');
});

test('the four states read from the three booleans the service worker answered', async () => {
  const cases = [[{ setting: false, antidetect: true }, 'off', 'status_off'], [{ setting: true, antidetect: false }, 'waiting', 'status_waiting'],
    [{ setting: true, antidetect: true, effective: false }, 'idle', 'status_idle'], [{ setting: true, antidetect: true, scoped: true, effective: true }, 'active', 'status_active']];
  for (const [over, name, key] of cases) {
    const f = fake(() => state(over)); const h = harness(f.api); h.render(); await h.settle();
    assert.equal(h.tree.props['data-antidetect-quiet'], name); assert.equal(h.text(h.nodes(node => node.props.id === 'antidetect-quiet-status')[0]), EN[key]);
    assert.equal(checkbox(h).props.checked, over.setting === true);
    h.unmount();
  }
});

// A service worker that keeps what was written, as the real one does.
function keeping(initial, { onSet } = {}) {
  const current = { ...initial };
  return fake(async message => {
    if (message.type === 'ui-sensor-quiet-set') { if (onSet) await onSet(message); current.setting = message.enabled; current.effective = message.enabled && current.antidetect === true; }
    return state(current);
  });
}

test('the switch sends exactly one boolean write, is locked while it is pending, repaints from the answer and then reads again', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = keeping({ antidetect: true }, { onSet: () => gate });
  const h = harness(f.api); h.render(); await h.settle();
  checkbox(h).props.onChange({ currentTarget: { checked: true } }); h.render(); await turn();
  assert.deepEqual(f.calls.at(-1), { schemaVersion: 1, type: 'ui-sensor-quiet-set', enabled: true });
  h.render(); assert.equal(checkbox(h).props.disabled, true, 'locked while pending'); assert.equal(h.tree.props['aria-busy'], true);
  checkbox(h).props.onChange({ currentTarget: { checked: false } }); await turn();
  assert.equal(f.calls.filter(call => call.type === 'ui-sensor-quiet-set').length, 1, 'a second click while pending is ignored');
  release(); await h.settle();
  assert.equal(h.tree.props['data-antidetect-quiet'], 'active'); assert.equal(checkbox(h).props.checked, true); assert.equal(checkbox(h).props.disabled, false);
  assert.equal(f.calls.at(-1).type, 'ui-sensor-quiet-get', 'after a write the card reads the state again');
  checkbox(h).props.onChange({ currentTarget: { checked: false } }); await h.settle();
  assert.deepEqual(f.calls.filter(call => call.type === 'ui-sensor-quiet-set').map(call => call.enabled), [true, false]);
  assert.equal(h.tree.props['data-antidetect-quiet'], 'off');
  h.unmount();
});

test('a write that fails or an answer that is not the exact reply shows the failure in words, keeps the real state under it and clears on the next attempt', async () => {
  for (const [name, broken] of [['rejected', () => { throw new Error('port closed'); }], ['error code', () => ({ schemaVersion: 1, type: 'error', code: 'storage-error' })], ['extra field', () => ({ ...state(), extra: 1 })], ['garbage', () => 'ok']]) {
    let failing = true;
    const f = fake(message => message.type === 'ui-sensor-quiet-set' ? (failing ? broken() : state({ setting: true, antidetect: true, effective: true })) : state({ setting: false, antidetect: true }));
    const h = harness(f.api); h.render(); await h.settle();
    checkbox(h).props.onChange({ currentTarget: { checked: true } }); await h.settle();
    assert.equal(h.tree.props['data-antidetect-quiet'], 'failed', name); const line = h.nodes(node => node.props.id === 'antidetect-quiet-status')[0];
    assert.equal(h.text(line), EN.failed, name); assert.equal(line.props.role, 'alert', name);
    assert.equal(checkbox(h).props.checked, false, name + ': the switch shows what the service worker really has'); assert.equal(checkbox(h).props.disabled, false, name + ': the user can try again');
    failing = false; checkbox(h).props.onChange({ currentTarget: { checked: true } }); await h.settle();
    assert.notEqual(h.tree.props['data-antidetect-quiet'], 'failed', name + ': the failure ends with the next attempt');
    h.unmount();
  }
  const dead = fake(() => { throw new Error('no worker'); }); const h = harness(dead.api); h.render(); await h.settle();
  assert.equal(h.tree.props['data-antidetect-quiet'], 'failed'); assert.equal(checkbox(h).props.disabled, true, 'nothing to switch before a first good read'); h.unmount();
});

test('a browser that did not confirm the registration says so as an alert instead of a green state', async () => {
  const f = fake(() => state({ setting: true, antidetect: true, effective: true, healthy: false })); const h = harness(f.api); h.render(); await h.settle();
  assert.equal(h.tree.props['data-antidetect-quiet'], 'unconfirmed'); const line = h.nodes(node => node.props.id === 'antidetect-quiet-status')[0];
  assert.equal(h.text(line), EN.status_unconfirmed); assert.equal(line.props.role, 'alert'); h.unmount();
});

test('storage changes of the setting or of the Antidetect configuration read again; other keys and other areas do not', async () => {
  const f = fake(() => state()); const h = harness(f.api); h.render(); await h.settle();
  const reads = () => f.calls.filter(call => call.type === 'ui-sensor-quiet-get').length; assert.equal(reads(), 1);
  f.emit({ [SENSOR_QUIET_KEY]: {} }); await h.settle(); assert.equal(reads(), 2);
  f.emit({ 'api-configuration:v1': {} }); await h.settle(); assert.equal(reads(), 3);
  f.emit({ 'proxy-configuration:v1': {} }); f.emit({ [SENSOR_QUIET_KEY]: {} }, 'session'); await h.settle(); assert.equal(reads(), 3);
  h.unmount();
});

test('an answer that was overtaken by a newer read or a write is dropped, and nothing is painted after unmount', async () => {
  const pending = []; let slow = true; const current = { antidetect: true };
  const f = fake(message => {
    if (message.type === 'ui-sensor-quiet-set') { current.setting = message.enabled; current.effective = message.enabled; return state(current); }
    return slow ? new Promise(resolve => pending.push(resolve)) : state(current);
  });
  const h = harness(f.api); h.render(); await h.settle();
  pending.shift()(state({ antidetect: true })); await h.settle();               // the mount read: off
  f.emit({ [SENSOR_QUIET_KEY]: {} }); await h.settle();                          // a slow read is now in flight
  slow = false; checkbox(h).props.onChange({ currentTarget: { checked: true } }); await h.settle();
  assert.equal(h.tree.props['data-antidetect-quiet'], 'active');
  for (const resolve of pending.splice(0)) resolve(state({ setting: false, antidetect: true }));   // the old answer arrives late, from before the write
  await h.settle(); assert.equal(h.tree.props['data-antidetect-quiet'], 'active', 'an older answer never repaints an older state');
  // A read that starts or finishes while a write is pending never repaints: the storage event of our own write must not flash an in-between state.
  let release; const gate = new Promise(resolve => { release = resolve; }); let during = false, stored = { setting: true, antidetect: true, effective: true };
  const w = fake(async message => { if (message.type === 'ui-sensor-quiet-set') { during = true; await gate; stored = { setting: false, antidetect: true, effective: false }; return state(stored); } return during ? state({ setting: true, antidetect: true, effective: false }) : state(stored); });
  const k = harness(w.api); k.render(); await k.settle(); assert.equal(k.tree.props['data-antidetect-quiet'], 'active');
  checkbox(k).props.onChange({ currentTarget: { checked: false } }); await k.settle();
  w.emit({ [SENSOR_QUIET_KEY]: {} }); await k.settle();
  assert.equal(k.tree.props['data-antidetect-quiet'], 'active', 'an in-between answer during the write is not painted');
  release(); during = false; await k.settle(); assert.equal(k.tree.props['data-antidetect-quiet'], 'off'); k.unmount();
  const late = []; const g = harness(fake(() => new Promise(resolve => late.push(resolve))).api); g.render(); await turn(); g.unmount(); for (const resolve of late) resolve(state()); await turn();
  h.unmount();
});

test('a hidden page does not read, and reading resumes when it becomes active', async () => {
  const f = fake(() => state()); const h = harness(f.api, { active: false }); h.render(); await h.settle();
  assert.equal(f.calls.length, 0, 'a hidden page asks nothing');
  h.update({ active: true }); await h.settle(); assert.equal(f.calls.filter(call => call.type === 'ui-sensor-quiet-get').length, 1);
  h.update({ active: false }); await h.settle(); h.update({ active: true }); await h.settle(); assert.equal(f.calls.filter(call => call.type === 'ui-sensor-quiet-get').length, 2, 'every return to the page reads again'); h.unmount();
});

test('all 21 languages render the card with their own texts and never a raw key', async () => {
  for (const [locale, labels] of Object.entries(ANTIDETECT_QUIET_LABELS)) {
    const f = fake(() => state({ setting: true, antidetect: true, effective: true })); const h = harness(f.api, { locale }); h.render(); await h.settle();
    assert.equal(h.text(h.nodes(node => node.props.id === 'antidetect-quiet-title')[0]), labels.title, locale);
    assert.equal(h.text(h.attr('data-antidetect-quiet-what')), labels.what, locale);
    assert.equal(h.text(h.nodes(node => node.props.id === 'antidetect-quiet-status')[0]), labels.status_active, locale);
    assert.equal(h.text(checkbox(h).props ? h.nodes(node => node.type === 'label')[0] : null), labels.toggle, locale);
    h.unmount();
  }
});

// The card inside the real Antidetect page: Network level, after the form, never inside it.
test('the Antidetect page puts the card at the end of the Network level, outside the Save form, and builds it from the page hooks', async () => {
  const configuration = createApiConfiguration();
  const sent = [];
  const api = { runtime: { id: 'antidetect-fixture', getURL: path => 'chrome-extension://antidetect-fixture/' + path, sendMessage: async request => { sent.push(request.type);
    return { schemaVersion: 1, type: 'api-config-state', configuration: plain(configuration), revision: 1, host: null, documentId: null, registration: 'inactive', reloadRequired: false, earlyAccess: 'ready',
      webrtcNetwork: { desired: configuration.webrtcNetworkPolicy, status: 'inactive', value: null, levelOfControl: null } }; } },
    storage: { onChanged: { addListener() {}, removeListener() {} } }, permissions: { onRemoved: { addListener() {}, removeListener() {} } }, tabs: { create: async () => ({ id: 1 }) }, declarativeNetRequest: { getDynamicRules: async () => [] } };
  const previous = Object.fromEntries(['window', 'location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const ownWindow = {}; ownWindow.top = ownWindow;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: ownWindow });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'chrome-extension://antidetect-fixture/options.html#antidetect' } });
  const slots = [], effects = []; let cursor = 0, changed = true, tree;
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; changed = true; } }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies?.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } },
  };
  try {
    const ui = createAntidetectUi({ ...hooks, h: (type, p) => ({ type, props: p }), useLocale: () => 'en', translate: key => key, browserApi: api, ApiConfigurationEditor() { return null; } });
    const render = () => { cursor = 0; changed = false; tree = ui.AntidetectApp({ active: true }); while (effects.length) effects.shift()(); };
    for (let index = 0; index < 12; index++) { if (changed) render(); await turn(); }
    const find = (node, predicate, out = []) => { if (Array.isArray(node)) { node.forEach(child => find(child, predicate, out)); return out; } if (!node?.props) return out; if (predicate(node)) out.push(node); find(node.props.children, predicate, out); return out; };
    const [network] = find(tree, node => node.props['data-antidetect-network'] === true);
    assert.ok(network, 'the Network level is rendered');
    const children = network.props.children.filter(Boolean);
    assert.deepEqual(children.map(child => typeof child.type === 'function' ? child.type.name : child.type), ['ul', 'form', 'QuietSensorsCard'], 'disclosures, the Save form, then the card');
    assert.equal(children[2].props.active, true);
    assert.equal(find(children[1], node => typeof node.type === 'function' && node.type.name === 'QuietSensorsCard').length, 0, 'the card is not inside the Save form');
    assert.equal(sent.includes('ui-sensor-quiet-get') || sent.includes('ui-sensor-quiet-set'), false, 'the page itself sends neither message: only the card does, and only when it is rendered');
  } finally { for (const slot of slots) slot?.cleanup?.(); for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
});

test('the card is shipped as plain existing classes: no stylesheet, no script, no network, no innerHTML', () => {
  const source = readFileSync(new URL('../../apps/production-extension/antidetect-quiet-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|document\.write|fetch\(|XMLHttpRequest|WebSocket|eval\(|new Function/u);
  assert.doesNotMatch(source, /createElement|\.style\b|<style|stylesheet/u);
  const classes = [...source.matchAll(/class: '([^']+)'/g)].flatMap(match => match[1].split(' '));
  const css = ['antidetect-ui.css', 'fingerprint-profile-ui.css'].map(file => readFileSync(new URL('../../apps/production-extension/' + file, import.meta.url), 'utf8')).join('\n');
  for (const name of new Set(classes)) assert.ok(css.includes('.' + name), 'class ' + name + ' already has a rule in the shipped stylesheets');
});
