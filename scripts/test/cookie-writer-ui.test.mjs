import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createIdentificationUi } from '../../apps/production-extension/identification-ui.js';

const h = (type, props) => ({ type, props });
const english = JSON.parse(readFileSync(new URL('../../apps/production-extension/_locales/en/messages.json', import.meta.url)));
const translate = (key, replacements = []) => {
  let value = english[key]?.message ?? key;
  for (const [name, placeholder] of Object.entries(english[key]?.placeholders ?? {})) value = value.replaceAll('$' + name.toUpperCase() + '$', replacements[Number(placeholder.content.slice(1)) - 1]);
  return value;
};
const ui = createIdentificationUi({ h, useLocale: () => 'en', translate });
const row = (changes = {}) => ({ name: '_id', phase: 'returned-sync', script: { host: 'example.com', pathTemplate: '/tracker.js' }, attributionConfidence: 'exact-resource', evidenceSource: 'page-hook', integrity: 'page-controlled', count: 2, ...changes });
const snapshot = (rows = [row()], changes = {}) => ({ schemaVersion: 1, type: 'cookie-writers-state', documentKey: '42:0:main', coverageState: 'partial', rows, truncated: false, ...changes });
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== 'object') return node;
  if (typeof node.type === 'function') return expand(node.type(node.props));
  return { ...node, props: { ...node.props, children: expand(node.props.children) } };
}
function nodes(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...nodes(node.props.children, predicate)];
}
function visibleText(node) {
  if (Array.isArray(node)) return node.map(visibleText).join(' ');
  return node && typeof node === 'object' ? visibleText(node.props.children) : node == null ? '' : String(node);
}
test('writer UI omits empty, invalid and cookie-value-bearing snapshots', () => {
  for (const documents of [null, [], [snapshot([])], [snapshot([row({ value: 'RAW_COOKIE_CANARY' })])], [snapshot([row({ integrity: 'browser-observed' })])]]) assert.equal(ui.CookieWritersTable({ documents }), null);
});
test('writer UI preserves document, phase and script variants in alphabetical four-column rows', () => {
  const documents = [snapshot([row({ name: 'zeta' }), row({ name: 'Alpha', phase: 'threw-sync', attributionConfidence: 'sampled-stack' })]), snapshot([row({ name: 'Alpha', script: null, attributionConfidence: 'unknown', count: 7 })], { documentKey: '42:1:child' })];
  const tree = expand(ui.CookieWritersTable({ documents }));
  const rows = nodes(tree, node => node.props['data-cookie-writer-row'] !== undefined);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(item => visibleText(nodes(item, node => node.type === 'code')[0])), ['Alpha', 'Alpha', 'zeta']);
  assert.deepEqual(rows.map(item => nodes(item, node => node.type === 'td').length), [4, 4, 4]);
  assert.deepEqual(new Set(rows.map(item => item.props['data-cookie-writer-document'])), new Set(['42:0:main', '42:1:child']));
  const output = visibleText(tree);
  for (const key of ['cookie_writers_title', 'phase_returned_sync', 'phase_threw_sync', 'attribution_exact_resource', 'attribution_sampled_stack', 'attribution_unknown', 'social_script_unknown']) assert.ok(output.includes(translate(key)), key);
  assert.match(output, /example\.com\/tracker\.js/); assert.match(output, /7/);
  assert.equal(nodes(tree, node => node.type === 'a' || node.type === 'script' || node.props.dangerouslySetInnerHTML).length, 0);
  assert.equal(documents[0].rows[0].name, 'zeta', 'sorting must not mutate stored evidence');
});
test('writer UI represents saturated counts as lower bounds and a real cap once', () => {
  const tree = expand(ui.CookieWritersTable({ documents: [snapshot([row({ count: 2147483647 })], { truncated: true })] }));
  const output = visibleText(tree);
  assert.ok(output.includes('≥2147483647'));
  assert.equal(output.split(translate('status_partial')).length - 1, 1);
});
test('Cookie panel exposes names even without cookie-jar permission and refreshes both projections', () => {
  let cookieReads = 0, writerReads = 0;
  const tree = expand(ui.CookiePanel({ cookies: { state: null, refresh: () => ++cookieReads }, writers: { state: snapshot(), refresh: () => ++writerReads } }));
  assert.equal(nodes(tree, node => node.props['data-cookie-writers-table']).length, 1);
  nodes(tree, node => node.props['data-cookie-action'] === 'refresh')[0].props.onClick();
  assert.equal(cookieReads, 1); assert.equal(writerReads, 1);
});

const tick = async () => { for (let i = 0; i < 12; ++i) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const nativeEvent = () => { const listeners = new Set(); return { listeners, addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener), fire: () => { for (const listener of listeners) listener(); } }; };
const browserMock = sendMessage => ({ runtime: { sendMessage }, permissions: { onAdded: nativeEvent(), onRemoved: nativeEvent() } });
function hookHarness(browserApi) {
  const slots = []; let cursor = 0, effects = [];
  const ui = createIdentificationUi({ h, translate, useLocale: () => 'en', browserApi,
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: initial }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(effect, dependencies) { const index = cursor++, slot = slots[index] ??= {}; if (!slot.dependencies || dependencies.some((value, i) => value !== slot.dependencies[i])) effects.push(() => { slot.cleanup?.(); slot.dependencies = dependencies; slot.cleanup = effect(); }); }
  });
  return { render(session, visible = true) { cursor = 0; ui.useCookieWriters(session, visible); const work = effects; effects = []; work.forEach(effect => effect()); cursor = 0; return ui.useCookieWriters(session, visible); }, dispose() { slots.forEach(slot => slot.cleanup?.()); } };
}
const session = (documentKey = '42:0:main', coverageState = 'active') => ({ loaded: true, busy: false, tabId: 42, selectedFrameId: 0, report: { documentKey, observedSince: 1, coverageState } });
test('writer hook queries only the current visible document and validates its native identity', async t => {
  const calls = [], browser = browserMock(async request => { calls.push(request); return snapshot(); }), hook = hookHarness(browser); t.after(() => hook.dispose());
  hook.render(session(), false); await tick(); assert.equal(calls.length, 0);
  hook.render(session()); await tick(); assert.equal(hook.render(session()).state?.rows.length, 1);
  assert.deepEqual(calls[0], { schemaVersion: 1, type: 'ui-get-cookie-writers', tabId: 42, frameId: 0, documentKey: '42:0:main' });
  assert.equal(hook.render(session(), false).state, null);
  hook.render(session('42:0:main', 'paused')); await tick(); assert.equal(calls.length, 1);
});
test('writer hook discards stale navigation, permission, pause and hidden-panel replies', async t => {
  for (const kind of ['navigation', 'permission', 'pause', 'hidden', 'unmount']) {
    const gate = deferred(), browser = browserMock(() => gate.promise), hook = hookHarness(browser); t.after(() => hook.dispose());
    hook.render(session());
    let next = session(), visible = true;
    if (kind === 'navigation') next = session('42:0:next');
    if (kind === 'pause') next = session('42:0:main', 'paused');
    if (kind === 'hidden') visible = false;
    if (kind === 'permission') browser.permissions.onRemoved.fire();
    if (kind === 'unmount') hook.dispose(); else hook.render(next, visible);
    gate.resolve(snapshot()); await tick();
    if (kind !== 'unmount') assert.equal(hook.render(next, visible).state, null, kind);
    hook.dispose(); assert.equal(browser.permissions.onRemoved.listeners.size, 0); assert.equal(browser.permissions.onAdded.listeners.size, 0);
  }
});
test('writer hook rejects another document and private fields even from the runtime reply', async t => {
  for (const raw of [snapshot([], { documentKey: '42:0:other' }), snapshot([row({ value: 'FORBIDDEN' })])]) {
    const hook = hookHarness(browserMock(async () => raw)); t.after(() => hook.dispose()); hook.render(session()); await tick(); assert.equal(hook.render(session()).state, null);
  }
});
