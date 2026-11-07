// DET-CF-PRECURSOR-001 / ADR-074/076/090: observed-only cards, real hook epochs and physical transport bounds.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createPrecursorUi } from '../../apps/production-extension/precursor-ui.js';
import { PRECURSOR_RULE_IDS } from '../../apps/production-extension/precursor-contracts.js';
import { PRECURSOR_UI_KEYS, PRECURSOR_UI_MESSAGES, applyPrecursorCopy } from '../production-locales-precursor.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const session = patch => ({ tabId: 7, selectedFrameId: 0, loaded: true, busy: false,
  report: { documentKey: '7:0:document-a', coverageState: 'active', observedSince: 1000 }, ...patch });
function snapshot(patch = {}) {
  const value = { schemaVersion: 1, type: 'precursor-state', documentKey: '7:0:document-a', coverageState: 'active',
    presence: 'observed', mode: 'unknown', lastObservedAt: 2000, ruleIds: [PRECURSOR_RULE_IDS.at(-1)],
    evidenceSource: 'browser-network', integrity: 'browser-observed', capabilities: { presenceDetection: true, modeDetection: false }, truncated: false, ...patch };
  if (value.presence === 'not-observed') Object.assign(value, { lastObservedAt: null, ruleIds: [], evidenceSource: null, integrity: null });
  return value;
}

function harness({ locale = 'en', send = () => Promise.resolve(snapshot()), initialSession = session(), enabled = true } = {}) {
  let slots = [], cursor = 0, dirty = true, tree, props = { session: initialSession, enabled };
  const effects = [], calls = [], table = applyPrecursorCopy({}, locale);
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; dirty = true; }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } }
  };
  const { PrecursorPanel } = createPrecursorUi({ ...hooks, h: (type, properties) => ({ type, props: properties }), useLocale: () => locale,
    browserApi: { runtime: { sendMessage(value) { calls.push(value); return send(value, calls.length); } } },
    translate: key => table[key]?.message ?? key });
  function render() { cursor = 0; dirty = false; tree = PrecursorPanel(props); while (effects.length) effects.shift()(); return tree; }
  async function settle() { for (let turn = 0; turn < 8; turn++) { if (dirty) render(); await Promise.resolve(); } if (dirty) render(); return tree; }
  function cleanup() { for (const slot of slots) slot.cleanup?.(); }
  function nodes(predicate) { const found = []; const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!node?.props) return; if (predicate(node)) found.push(node); visit(node.props.children); }; visit(tree); return found; }
  function text(node = tree) { if (Array.isArray(node)) return node.map(value => text(value)).join(' '); if (node?.props) return text(node.props.children); return typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
  return { calls, table, render, settle, cleanup, text, nodes,
    get tree() { return tree; },
    get status() { return tree?.props['data-precursor-status']; },
    get presence() { return tree?.props['data-precursor-presence']; },
    update(next) { props = { ...props, ...next }; dirty = true; render(); },
    remount() { cleanup(); slots = []; cursor = 0; dirty = true; render(); }
  };
}

test('all 21 catalogs have complete authored presence, availability and unknown-mode copy', () => {
  assert.deepEqual(Object.keys(PRECURSOR_UI_MESSAGES).sort(), PRODUCTION_LANGUAGES.map(language => language.id).sort());
  for (const { id } of PRODUCTION_LANGUAGES) {
    const table = applyPrecursorCopy({}, id);
    assert.deepEqual(Object.keys(table).sort(), [...PRECURSOR_UI_KEYS].sort());
    for (const key of PRECURSOR_UI_KEYS) assert.ok(table[key].message.trim(), id + '/' + key);
    assert.equal(table.precursor_title.message, 'Cloudflare Precursor');
    if (id !== 'en') assert.notEqual(table.precursor_not_observed.message, PRECURSOR_UI_MESSAGES.en.precursor_not_observed);
  }
  assert.throws(() => applyPrecursorCopy({}, 'unrecognized'));
});

test('coverage labels used by the panel exist in every packaged language including UI-only catalogs', () => {
  for (const language of PRODUCTION_LANGUAGES) {
    const file = new URL(`../../apps/production-extension/${language.uiOnly ? 'ui-locales' : '_locales'}/${language.id}/messages.json`, import.meta.url);
    const table = JSON.parse(readFileSync(file, 'utf8'));
    for (const state of ['active', 'partial', 'late_start', 'paused', 'unsupported', 'no_access', 'degraded']) {
      assert.ok(table['status_' + state]?.message?.trim(), language.id + '/status_' + state);
    }
  }
});

test('poll addresses the selected exact frame only and displays resource observation with unknown mode', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const documentKey = '7:4:child-document', current = harness({ initialSession: session({ selectedFrameId: 4,
    report: { documentKey, observedSince: 1000, coverageState: 'partial' }, frames: [{ frameId: 0, documentKey: '7:0:top-document' }] }),
    send: () => Promise.resolve(snapshot({ documentKey, coverageState: 'partial' })) });
  try {
    current.render(); await current.settle();
    assert.deepEqual(current.calls, [{ schemaVersion: 1, type: 'ui-get-precursor', tabId: 7, frameId: 4, documentKey }]);
    assert.equal(current.status, 'ready'); assert.equal(current.presence, 'observed');
    assert.equal(current.tree.props['data-precursor-mode'], 'unknown');
    assert.match(current.text(), /Resource observed/); assert.match(current.text(), /Mode :  Unknown/);
    assert.equal(current.nodes(node => node.props['data-precursor-coverage'] === 'partial').length, 1);
    t.mock.timers.tick(999); await current.settle(); assert.equal(current.calls.length, 1);
    t.mock.timers.tick(1); await current.settle(); assert.equal(current.calls.length, 2);
  } finally { current.cleanup(); }
});

test('only observed resources render a card; absence keeps polling and can recover without a remount', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let value = snapshot({ presence: 'not-observed' });
  const current = harness({ send: () => Promise.resolve(value) });
  try {
    assert.equal(current.render(), null);
    await current.settle(); assert.equal(current.tree, null); assert.equal(current.calls.length, 1);
    assert.equal(current.nodes(node => node.props['data-precursor-settings']).length, 0);
    assert.equal(current.nodes(node => typeof node.type === 'function').length, 0);
    value = snapshot();
    t.mock.timers.tick(1000); await current.settle(); assert.equal(current.presence, 'observed'); assert.equal(current.calls.length, 2);
    assert.equal(current.nodes(node => node.props['data-precursor-settings']).length, 1);
    value = snapshot({ presence: 'not-observed' });
    t.mock.timers.tick(1000); await current.settle(); assert.equal(current.tree, null); assert.equal(current.calls.length, 3);
    value = snapshot({ presence: 'not-observed', capabilities: { presenceDetection: false, modeDetection: false } });
    t.mock.timers.tick(1000); await current.settle(); assert.equal(current.tree, null); assert.equal(current.calls.length, 4);
    value = snapshot();
    t.mock.timers.tick(1000); await current.settle(); assert.equal(current.presence, 'observed'); assert.equal(current.calls.length, 5);
    assert.doesNotMatch(current.text(), /\bOff\b|Armed|Monitor/);
  } finally { current.cleanup(); }
});

test('Firefox Resource Timing evidence renders observed with partial coverage and unknown mode', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const current = harness({ send: () => Promise.resolve(snapshot({ evidenceSource: 'browser-resource-timing', coverageState: 'partial' })) });
  try {
    assert.equal(current.render(), null);
    await current.settle(); assert.equal(current.presence, 'observed');
    assert.equal(current.tree.props['data-precursor-mode'], 'unknown');
    assert.equal(current.nodes(node => node.props['data-precursor-coverage'] === 'partial').length, 1);
    assert.match(current.text(), /Resource observed/);
  } finally { current.cleanup(); }
});

test('unavailable observers render no card; observed coverage describes its own bounded evidence', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let value = snapshot({ presence: 'not-observed', coverageState: 'unsupported', capabilities: { presenceDetection: false, modeDetection: false } });
  const current = harness({ initialSession: session({ report: { documentKey: '7:0:document-a', observedSince: 1000, coverageState: 'partial' } }), send: () => Promise.resolve(value) });
  const badges = () => current.nodes(node => node.props['data-precursor-coverage']).map(node => node.props['data-precursor-coverage']);
  try {
    assert.equal(current.render(), null); assert.deepEqual(badges(), []);
    await current.settle(); assert.equal(current.tree, null); assert.deepEqual(badges(), []);
    for (const coverageState of ['paused', 'no-access']) {
      value = snapshot({ presence: 'not-observed', coverageState, capabilities: { presenceDetection: false, modeDetection: false } });
      t.mock.timers.tick(1000); await current.settle();
      assert.equal(current.tree, null); assert.deepEqual(badges(), []);
    }
    value = snapshot({ coverageState: 'active', truncated: true });
    t.mock.timers.tick(1000); await current.settle(); assert.equal(current.status, 'ready'); assert.equal(current.presence, 'observed'); assert.deepEqual(badges(), ['partial']);
    value = { malformed: true };
    t.mock.timers.tick(1000); await current.settle(); assert.equal(current.tree, null); assert.deepEqual(badges(), []);
    value = snapshot({ coverageState: 'active' });
    t.mock.timers.tick(1000); await current.settle(); assert.equal(current.presence, 'observed'); assert.deepEqual(badges(), ['active']);
    current.update({ session: session({ report: null }) }); assert.equal(current.tree, null);
    await current.settle(); assert.deepEqual(badges(), []);
  } finally { current.cleanup(); }
});

test('malformed, forged-mode, wrong-document and accessor replies never become observations or execute getters', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let getterReads = 0;
  const poison = snapshot(); Object.defineProperty(poison, 'mode', { enumerable: true, get() { ++getterReads; return 'unknown'; } });
  const values = [snapshot(), snapshot({ documentKey: '7:0:other-document' }), snapshot({ mode: 'arm' }), snapshot({ mode: 'off' }),
    snapshot({ ruleIds: ['https://PRIVATE.example/path?token=SECRET'] }), { ...snapshot(), unexpected: 'SECRET' }, poison];
  const current = harness({ send: () => Promise.resolve(values.shift()) });
  try {
    current.render(); await current.settle(); assert.equal(current.presence, 'observed');
    for (let index = 0; index < 6; index++) {
      t.mock.timers.tick(1000); await current.settle();
      assert.equal(current.tree, null);
      assert.doesNotMatch(current.text(), /SECRET|PRIVATE|Armed|\bOff\b/);
    }
    assert.equal(getterReads, 0);
    values.push(snapshot());
    t.mock.timers.tick(1000); await current.settle(); assert.equal(current.presence, 'observed');
  } finally { current.cleanup(); }
});

test('timeout preserves one physical request slot until actual settlement and discards its late success', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const first = deferred(), current = harness({ send: (_request, index) => index === 1 ? first.promise : Promise.resolve(snapshot({ presence: 'not-observed' })) });
  try {
    assert.equal(current.render(), null); await current.settle(); assert.equal(current.calls.length, 1);
    t.mock.timers.tick(6000); await current.settle(); assert.equal(current.tree, null);
    t.mock.timers.tick(60000); await current.settle(); assert.equal(current.calls.length, 1);
    first.resolve(snapshot()); await current.settle(); assert.equal(current.tree, null);
    t.mock.timers.tick(1000); await current.settle(); assert.equal(current.calls.length, 2); assert.equal(current.tree, null);
  } finally { current.cleanup(); }
});

test('navigation invalidates previous document replies while retaining the physical slot', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const first = deferred(), documentKey = '7:0:document-b';
  const current = harness({ send: (request, index) => index === 2 ? first.promise : Promise.resolve(snapshot({ documentKey: request.documentKey })) });
  try {
    current.render(); await current.settle(); assert.equal(current.presence, 'observed');
    t.mock.timers.tick(1000); await current.settle(); assert.equal(current.calls.length, 2);
    current.update({ session: session({ report: { documentKey, coverageState: 'active', observedSince: 3000 } }) }); assert.equal(current.tree, null);
    await current.settle();
    t.mock.timers.tick(1000); await current.settle(); assert.equal(current.calls.length, 2); assert.equal(current.tree, null);
    first.resolve(snapshot()); await current.settle(); assert.equal(current.tree, null);
    t.mock.timers.tick(1000); await current.settle(); assert.equal(current.calls.length, 3);
    assert.equal(current.calls[2].documentKey, documentKey); assert.equal(current.presence, 'observed');
  } finally { current.cleanup(); }
});

test('busy clear round trip creates a new epoch even when document key and observedSince are unchanged', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const old = deferred(), fresh = deferred();
  const current = harness({ send: (_request, index) => index === 1 ? Promise.resolve(snapshot()) : index === 2 ? old.promise : fresh.promise });
  try {
    current.render(); await current.settle(); assert.equal(current.presence, 'observed');
    t.mock.timers.tick(1000); await current.settle(); assert.equal(current.calls.length, 2);
    current.update({ session: session({ busy: true }) }); assert.equal(current.tree, null);
    current.update({ session: session() }); assert.equal(current.tree, null);
    old.resolve(snapshot()); await current.settle(); assert.equal(current.tree, null);
    t.mock.timers.tick(1000); await current.settle(); assert.equal(current.calls.length, 3);
    fresh.resolve(snapshot()); await current.settle(); assert.equal(current.presence, 'observed');
  } finally { current.cleanup(); }
});

test('pause, revoked access and disabled panel stop polling and immediately hide prior observations', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const current = harness();
  try {
    current.render(); await current.settle(); assert.equal(current.presence, 'observed');
    for (const coverageState of ['paused', 'no-access', 'unsupported']) {
      current.update({ session: session({ report: { documentKey: '7:0:document-a', observedSince: 1000, coverageState } }) }); assert.equal(current.tree, null);
      await current.settle(); assert.equal(current.tree, null);
      t.mock.timers.tick(5000); await current.settle(); assert.equal(current.calls.length, 1);
    }
    current.update({ enabled: false }); await current.settle(); assert.equal(current.tree, null);
    t.mock.timers.tick(5000); await current.settle(); assert.equal(current.calls.length, 1);
    current.update({ enabled: true, session: session() }); assert.equal(current.tree, null);
    await current.settle(); assert.equal(current.calls.length, 2); assert.equal(current.presence, 'observed');
  } finally { current.cleanup(); }
});

test('pause, revoke and disable fence pending replies across resuming the same document', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  for (const boundary of [
    { session: session({ report: { documentKey: '7:0:document-a', observedSince: 1000, coverageState: 'paused' } }) },
    { session: session({ report: { documentKey: '7:0:document-a', observedSince: 1000, coverageState: 'no-access' } }) },
    { enabled: false }
  ]) {
    const old = deferred(), current = harness({ send: (_request, index) => index === 2 ? old.promise : Promise.resolve(snapshot()) });
    try {
      current.render(); await current.settle(); assert.equal(current.presence, 'observed');
      t.mock.timers.tick(1000); await current.settle(); assert.equal(current.calls.length, 2);
      current.update(boundary); assert.equal(current.tree, null);
      t.mock.timers.tick(5000); await current.settle(); assert.equal(current.calls.length, 2);
      current.update({ enabled: true, session: session() }); assert.equal(current.tree, null);
      t.mock.timers.tick(1000); await current.settle(); assert.equal(current.calls.length, 2);
      old.resolve(snapshot()); await current.settle(); assert.equal(current.tree, null);
      t.mock.timers.tick(1000); await current.settle(); assert.equal(current.calls.length, 3); assert.equal(current.presence, 'observed');
    } finally { current.cleanup(); }
  }
});

test('disabled, busy and not-loaded sessions expose no setup trigger or privileged request until eligible', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  for (const initial of [{ enabled: false }, { initialSession: session({ busy: true }) }, { initialSession: session({ loaded: false }) }]) {
    const current = harness(initial);
    try {
      assert.equal(current.render(), null);
      await current.settle(); assert.equal(current.tree, null);
      assert.equal(current.nodes(node => node.props['data-precursor-settings']).length, 0);
      t.mock.timers.tick(10000); await current.settle(); assert.equal(current.calls.length, 0);
      current.update({ enabled: true, session: session() }); assert.equal(current.tree, null);
      await current.settle(); assert.equal(current.calls.length, 1); assert.equal(current.presence, 'observed');
    } finally { current.cleanup(); }
  }
});

test('unmount/remount in the same factory cannot accumulate unresolved native calls', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const first = deferred(), current = harness({ send: (_request, index) => index === 1 ? first.promise : Promise.resolve(snapshot({ presence: 'not-observed' })) });
  try {
    current.render(); await current.settle();
    for (let index = 0; index < 5; index++) { current.remount(); await current.settle(); t.mock.timers.tick(7000); await current.settle(); }
    assert.equal(current.calls.length, 1); assert.equal(current.tree, null);
    first.resolve(snapshot()); await current.settle(); assert.equal(current.tree, null);
    t.mock.timers.tick(1000); await current.settle(); assert.equal(current.calls.length, 2); assert.equal(current.tree, null);
  } finally { current.cleanup(); }
});

test('synchronous and asynchronous failures reveal no raw error and recover on a later bounded poll', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const current = harness({ send: (_request, index) => { if (index === 1) throw Error('SECRET_SYNC'); if (index === 2) return Promise.reject(Error('SECRET_ASYNC')); return Promise.resolve(snapshot()); } });
  try {
    current.render(); await current.settle(); assert.equal(current.tree, null);
    t.mock.timers.tick(1000); await current.settle(); assert.equal(current.tree, null); assert.doesNotMatch(current.text(), /SECRET/);
    t.mock.timers.tick(1000); await current.settle(); assert.equal(current.status, 'ready');
  } finally { current.cleanup(); }
});

test('invalid or missing selected-document binding never issues privileged requests', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const current = harness({ initialSession: session({ selectedFrameId: 2 }) });
  try {
    current.render(); await current.settle(); assert.equal(current.tree, null);
    t.mock.timers.tick(10000); await current.settle(); assert.equal(current.calls.length, 0);
    current.update({ session: session({ report: null }) }); await current.settle(); assert.equal(current.tree, null); assert.equal(current.calls.length, 0);
  } finally { current.cleanup(); }
});
