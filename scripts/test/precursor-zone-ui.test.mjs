// ADR-076: API zone snapshots cannot survive a document/consent epoch boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPrecursorZoneUi } from '../../apps/production-extension/precursor-zone-ui.js';
import { PRECURSOR_MODES_MESSAGES } from '../production-locales-precursor-modes.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const session = patch => ({ tabId: 7, selectedFrameId: 0, loaded: true, busy: false, report: { documentKey: '7:0:document-a', coverageState: 'active', observedSince: 1000 }, ...patch });
const state = patch => ({ status: 'ready', zoneName: 'example.com', mode: 'arm', checkedAt: 2000, lastChange: null, ...patch });
const reply = patch => ({ schemaVersion: 1, type: 'precursor-zone-state', documentKey: '7:0:document-a', state: state(), ...patch });
function harness(send = () => Promise.resolve(reply()), initial = session(), initialLocale = 'en') {
  let slots = [], cursor = 0, dirty = true, tree = null, locale = initialLocale, props = { session: initial, enabled: true };
  const effects = [], calls = [];
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; dirty = true; }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } },
  };
  const { PrecursorZone } = createPrecursorZoneUi({ ...hooks, useLocale: () => locale, h: (type, props) => ({ type, props }), translate: key => PRECURSOR_MODES_MESSAGES[locale]?.[key] ?? key, browserApi: { runtime: { sendMessage(value) { calls.push(value); return send(value, calls.length); } } } });
  function render() { cursor = 0; dirty = false; tree = PrecursorZone(props); while (effects.length) effects.shift()(); return tree; }
  async function settle() { for (let count = 0; count < 10; count++) { if (dirty) render(); await Promise.resolve(); } if (dirty) render(); }
  function cleanup() { for (const slot of slots) slot.cleanup?.(); }
  return { render, settle, cleanup, calls, get tree() { return tree; }, get mode() { return tree?.props['data-zone-mode'] ?? null; }, update(patch) { props = { ...props, ...patch }; dirty = true; render(); }, setLocale(value) { locale = value; dirty = true; render(); }, remount() { cleanup(); slots = []; dirty = true; render(); } };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (predicate(tree)) return tree;
  const children = Array.isArray(tree.props?.children) ? tree.props.children : [tree.props?.children];
  for (const child of children) { const found = find(child, predicate); if (found) return found; }
  return null;
}

test('zone panel displays only the validated native-selected document snapshot', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }); const h = harness(); t.after(h.cleanup); h.render(); await h.settle();
  assert.deepEqual(h.calls[0], { schemaVersion: 1, type: 'ui-get-precursor-zone', tabId: 7, frameId: 0, documentKey: '7:0:document-a' }); assert.equal(h.mode, 'arm');
  t.mock.timers.tick(5000); await h.settle(); assert.equal(h.calls.length, 2);
});

test('zone dates follow all 21 app locales and RTL transitions preserve From to To without refetching', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const at = Date.UTC(2026, 9, 30, 11, 45, 59), value = state({ status: 'stale', mode: 'unknown', checkedAt: at, lastChange: { from: 'off', to: 'arm', at } });
  const h = harness(() => Promise.resolve(reply({ state: value }))); t.after(h.cleanup); h.render(); await h.settle();
  for (const locale of Object.keys(PRECURSOR_MODES_MESSAGES)) {
    h.setLocale(locale); await h.settle();
    const direction = ['ar', 'ur'].includes(locale) ? 'rtl' : 'ltr';
    const tag = ({ zh_CN: 'zh-CN', pt_BR: 'pt-BR', yue: 'zh-CN', wuu: 'zh-CN' })[locale] ?? locale;
    assert.equal(h.tree.props.dir, direction);
    const mode = find(h.tree, node => node.type === 'strong');
    assert.equal(mode.props.dir, 'auto'); assert.equal(mode.props.children, PRECURSOR_MODES_MESSAGES[locale].precursor_modes_mode_unknown);
    const checked = find(h.tree, node => node.props['data-zone-checked']);
    assert.equal(checked.type, 'bdi'); assert.equal(checked.props.children, new Intl.DateTimeFormat(tag, { timeStyle: 'medium' }).format(at));
    const changed = find(h.tree, node => node.props['data-zone-changed-at']);
    assert.equal(changed.type, 'bdi'); assert.equal(changed.props.children, new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'medium' }).format(at));
    const transition = find(h.tree, node => node.props['data-zone-transition']);
    assert.equal(transition.props.dir, direction);
    assert.deepEqual(transition.props.children.map(node => node.props.children), ['Off', direction === 'rtl' ? '←' : '→', 'Armed']);
    assert.equal(transition.props.children[0].type, 'bdi'); assert.equal(transition.props.children[2].type, 'bdi');
    assert.equal(find(h.tree, node => node.props.children === 'example.com').props.dir, 'ltr');
    assert.equal(h.calls.length, 1, 'language change only reformats the current validated snapshot');
  }
  const css = readFileSync(new URL('../../apps/production-extension/precursor-ui.css', import.meta.url), 'utf8');
  assert.match(css, /\.precursor-zone__transition\s*\{[^}]*display:\s*inline-flex/);
});

test('out-of-Date-range canonical integers cannot crash the zone panel', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const value = state({ checkedAt: Number.MAX_SAFE_INTEGER, lastChange: { from: 'off', to: 'monitor', at: Number.MAX_SAFE_INTEGER } });
  const h = harness(() => Promise.resolve(reply({ state: value }))); t.after(h.cleanup); h.render(); await h.settle();
  assert.equal(h.mode, 'arm');
  assert.equal(find(h.tree, node => node.props['data-zone-checked']).props.children, '—');
  assert.equal(find(h.tree, node => node.props['data-zone-changed-at']).props.children, '—');
});

test('A to busy-clear or pause to A never resurrects the previous Armed value', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  for (const blocked of [session({ busy: true }), session({ report: { documentKey: '7:0:document-a', coverageState: 'paused', observedSince: 1000 } })]) {
    const late = deferred(), fresh = deferred(), h = harness((_request, index) => index === 1 ? Promise.resolve(reply()) : index === 2 ? late.promise : fresh.promise);
    try {
      h.render(); await h.settle(); assert.equal(h.mode, 'arm'); t.mock.timers.tick(5000); await h.settle(); assert.equal(h.calls.length, 2);
      h.update({ session: blocked }); assert.equal(h.mode, null); h.update({ session: session() }); assert.equal(h.mode, null);
      t.mock.timers.tick(6000); await h.settle(); assert.equal(h.mode, null); assert.equal(h.calls.length, 2);
      late.resolve(reply()); await h.settle(); assert.equal(h.mode, null);
      t.mock.timers.tick(5000); await h.settle(); assert.equal(h.calls.length, 3); fresh.resolve(reply({ state: null })); await h.settle(); assert.equal(h.mode, null);
    } finally { h.cleanup(); }
  }
});

test('a request timeout keeps its physical slot and discards the eventual Armed response', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }); const late = deferred(), h = harness((_request, index) => index === 1 ? late.promise : Promise.resolve(reply({ state: state({ status: 'stale', mode: 'unknown' }) })));
  t.after(h.cleanup); h.render(); await h.settle(); t.mock.timers.tick(6000); await h.settle(); assert.equal(h.mode, null);
  t.mock.timers.tick(60000); await h.settle(); assert.equal(h.calls.length, 1); late.resolve(reply()); await h.settle(); assert.equal(h.mode, null);
  t.mock.timers.tick(5000); await h.settle(); assert.equal(h.mode, 'unknown'); assert.equal(h.calls.length, 2);
});

test('navigation and remount retain the one physical slot without admitting previous-document data', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }); const late = deferred(), h = harness((request, index) => index === 1 ? late.promise : Promise.resolve(reply({ documentKey: request.documentKey })));
  t.after(h.cleanup); h.render(); await h.settle();
  h.update({ session: session({ report: { documentKey: '7:0:document-b', observedSince: 3000, coverageState: 'active' } }) });
  for (let index = 0; index < 3; index++) { h.remount(); t.mock.timers.tick(7000); await h.settle(); assert.equal(h.mode, null); }
  assert.equal(h.calls.length, 1); late.resolve(reply()); await h.settle(); assert.equal(h.mode, null);
  t.mock.timers.tick(5000); await h.settle(); assert.equal(h.calls[1].documentKey, '7:0:document-b'); assert.equal(h.mode, 'arm');
});

test('invalid, cross-document and secret-bearing replies cannot render a mode', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }); let getterReads = 0;
  const poison = state(); Object.defineProperty(poison, 'mode', { enumerable: true, get() { getterReads++; return 'off'; } });
  const samples = [reply({ documentKey: '7:0:other' }), reply({ state: { ...state(), token: 'SECRET' } }), reply({ state: state({ mode: 'armed' }) }), reply({ state: poison }), { malformed: true }];
  const h = harness(() => Promise.resolve(samples.shift())); t.after(h.cleanup); h.render(); await h.settle(); assert.equal(h.mode, null);
  for (let index = 1; index < 5; index++) { t.mock.timers.tick(5000); await h.settle(); assert.equal(h.mode, null); }
  assert.equal(getterReads, 0);
});

test('unavailable coverage, disabled UI and missing exact binding never issue a read', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  for (const current of [session({ report: null }), session({ selectedFrameId: 9 }), session({ loaded: false }), session({ busy: true }), ...['paused', 'no-access', 'unsupported'].map(coverageState => session({ report: { documentKey: '7:0:document-a', observedSince: 1000, coverageState } }))]) {
    const h = harness(undefined, current); try { h.render(); await h.settle(); t.mock.timers.tick(10000); await h.settle(); assert.equal(h.calls.length, 0); assert.equal(h.mode, null); } finally { h.cleanup(); }
  }
  const h = harness(); t.after(h.cleanup); h.update({ enabled: false }); await h.settle(); assert.equal(h.calls.length, 0); assert.equal(h.mode, null);
});

test('unrelated optional permission changes do not erase API connector; explicit clear and consent revoke do', () => {
  const full = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
  const runtimeAt = full.indexOf('var BackgroundRuntime = class'); assert.ok(runtimeAt >= 0);
  const source = full.slice(runtimeAt);
  const method = (name, next) => { const start = source.indexOf('  async ' + name + '('), end = source.indexOf('\n  ' + next, start + 1); assert.ok(start >= 0 && end > start); return source.slice(start, end); };
  const permissions = method('onPermissionsChanged', 'reconcileAccess(');
  assert.doesNotMatch(permissions, /precursorModes\?\.clear/);
  const clearStart = source.indexOf('  async clearSession('), revokeStart = source.indexOf('  async discardUnconsentedData('), permissionStart = source.indexOf('  async onPermissionsChanged(');
  assert.ok(clearStart >= 0 && revokeStart > clearStart && permissionStart > revokeStart);
  assert.match(source.slice(clearStart, revokeStart), /precursorModes\?\.clear/);
  assert.match(source.slice(revokeStart, permissionStart), /precursorModes\?\.clear/);
});
