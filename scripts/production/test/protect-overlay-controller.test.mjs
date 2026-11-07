import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../../..');
const built = await build({ entryPoints: [resolve(root, 'apps/production-protect/src/overlay-controller.ts')], bundle: true, write: false, platform: 'neutral', format: 'esm', logLevel: 'silent',
  plugins: [{ name: 'contracts', setup(builder) { builder.onResolve({ filter: /^@detect-expert\/contracts$/ }, () => ({ path: resolve(root, 'vendor/protect-722fae8/packages/contracts/src/index.ts') })); } }] });
const { ProtectOverlayController, OVERLAY_MAX_TABS, OVERLAY_MAX_SEEN, OVERLAY_MAX_SEEN_PER_DOCUMENT, OVERLAY_NATIVE_TIMEOUT_MS } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let count = 0; count < 100; count++) await Promise.resolve(); };
function transfer(changes = {}) { return { evidenceId: 'pe-1', protectKind: 'value-match', ruleId: 'form-leak', ruleVersion: 'form-leak-v1', frameContext: 'top', attributionConfidence: 'unknown', count: 1,
  countQuality: 'lower-bound', firstSecond: 0, lastSecond: 0, evidenceSource: 'derived', integrity: 'derived', limitationCodes: [], fieldKind: 'email', fieldRef: 1, transferClass: 'third-party-before-submit', encodings: ['plain'],
  location: 'body-json', receiver: 'receiver.test', relation: 'cross-site', method: 'POST', requestKind: 'xhr', endpointHost: 'receiver.test', endpointPathTemplate: '/collect', submitTiming: 'before-submit', deliveryState: 'unknown', interpretationConfidence: 'medium', ...changes }; }
function fixture() {
  let now = 0, generation = 100, timerId = 0;
  const snapshots = new Map(), native = new Map(), windows = new Map(), timers = new Map(), injections = [], messages = [];
  const hooks = { inject: null, send: null, frame: null, tab: null, window: null };
  const api = { runtime: { id: extensionId },
    scripting: { executeScript: async options => { injections.push(options); if (hooks.inject) await hooks.inject(options); return []; } },
    tabs: { get: async id => hooks.tab ? hooks.tab(id) : native.get(id)?.tab,
      sendMessage: async (tabId, message, options) => { messages.push({ tabId, message, options }); if (hooks.send) return hooks.send(tabId, message, options); return { schemaVersion: 1, type: 'protect-overlay-ack', kind: message.kind, generation: message.generation, accepted: true }; } },
    windows: { get: async id => hooks.window ? hooks.window(id) : windows.get(id) },
    webNavigation: { getFrame: async details => hooks.frame ? hooks.frame(details) : native.get(details.tabId)?.frame },
  };
  const deps = { api, now: () => now, generation: () => ++generation, snapshot: id => snapshots.get(id) ?? null,
    setTimer(callback, delay) { const id = ++timerId; timers.set(id, { at: now + delay, callback }); return id; }, clearTimer(id) { timers.delete(id); } };
  const controller = new ProtectOverlayController(deps);
  function set(tabId = 1, documentId = 'doc1', changes = {}) {
    const target = { tabId, documentId, documentKey: `${tabId}:0:${documentId}` };
    const state = { state: 'active', consentVersion: 1, requiredConsentVersion: 1, features: ['value-match', 'firewall'], preset: 'normal', snoozedUntil: null, excludedSites: [], historyRetentionDays: 30, history: null,
      decisions: 0, permissions: { broadHosts: true, dnr: true }, organizationDisabled: false, organizationPolicyInvalid: false, degradedReasons: [] };
    const report = { protectRevision: 1, documentKey: target.documentKey, site: 'source.test', moduleState: 'active', coverageState: 'active', features: ['value-match', 'firewall'], limitations: [], evidence: [transfer()], previousDocumentEvidence: 0,
      firewall: { prompt: null, receivers: [] }, replay: null, gpc: null, dropped: {} };
    const snapshot = { target, state, report, locale: 'ru', ...changes }; snapshots.set(tabId, snapshot);
    native.set(tabId, { tab: { id: tabId, windowId: tabId + 10, active: true, url: 'https://source.test/' }, frame: { documentId, url: 'https://source.test/', documentLifecycle: 'active' } });
    windows.set(tabId + 10, { focused: true, type: 'normal' }); return snapshot;
  }
  async function tick(ms = 0) {
    const end = now + ms;
    for (let count = 0; count < 2000; count++) {
      const due = [...timers].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].callback(); await controller.settled();
      assert.notEqual(count, 1999, 'timers remain bounded');
    }
    now = end; await controller.settled();
  }
  async function advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } await flush(); }
  const shows = () => messages.filter(item => item.message.type === 'protect-overlay-show');
  const hides = () => messages.filter(item => item.message.type === 'protect-overlay-hide');
  const sender = (tabId = 1, documentId = 'doc1') => ({ id: extensionId, tab: { id: tabId }, frameId: 0, documentId, url: 'https://source.test/', documentLifecycle: 'active' });
  const action = (shown, changes = {}) => ({ schemaVersion: 1, type: 'protect-overlay-action', kind: shown.kind, generation: shown.generation, documentKey: shown.documentKey, action: 'refresh', ...changes });
  return { controller, snapshots, native, windows, timers, injections, messages, hooks, set, tick, advance, shows, hides, sender, action };
}

test('activation injects one exact native document in ISOLATED and sends only its bounded current state', async () => {
  const f = fixture(), snapshot = f.set();
  assert.equal(await f.controller.showActivation(1, 1, () => true), true);
  assert.deepEqual(f.injections, [{ target: { tabId: 1, documentIds: ['doc1'] }, world: 'ISOLATED', files: ['firewall-overlay.js'] }]);
  const sent = f.shows()[0]; assert.deepEqual(sent.options, { documentId: 'doc1', frameId: 0 });
  assert.deepEqual(sent.message, { schemaVersion: 1, type: 'protect-overlay-show', kind: 'activation', generation: 101, tabId: 1, documentKey: '1:0:doc1', locale: 'ru', state: snapshot.state, report: null, activation: 1 });
  assert.notEqual(sent.message.state, snapshot.state);
  assert.equal(await f.controller.showActivation(1, 1, () => true), false); assert.equal(f.shows().length, 1);
});

test('OFF, stale consent, policy, missing access, snooze and background tabs cannot show activation', async () => {
  const states = [{ state: 'off' }, { state: 'degraded' }, { consentVersion: null }, { organizationDisabled: true }, { organizationPolicyInvalid: true }, { snoozedUntil: 500 }, { permissions: { broadHosts: false, dnr: true } }];
  for (const changes of states) { const f = fixture(), snapshot = f.set(); Object.assign(snapshot.state, changes); assert.equal(await f.controller.showActivation(1, 1, () => true), false); assert.equal(f.injections.length, 0); }
  for (const mutate of [f => { f.native.get(1).tab.active = false; }, f => { f.windows.get(11).focused = false; }, f => { f.native.get(1).frame.documentId = 'other'; }, f => { f.native.get(1).tab.pendingUrl = 'https://other.test/'; }, f => { f.native.get(1).tab.url = 'chrome://settings/'; }]) {
    const f = fixture(); f.set(); mutate(f); assert.equal(await f.controller.showActivation(1, 1, () => true), false); assert.equal(f.injections.length, 0);
  }
});

test('cancel or navigation during injection never sends active content into a successor document', async () => {
  for (const mode of ['cancel', 'navigate', 'off']) {
    const f = fixture(), snapshot = f.set(), injection = deferred(); f.hooks.inject = () => injection.promise;
    const pending = f.controller.showActivation(1, 1, () => true); await flush(); assert.equal(f.injections.length, 1);
    if (mode === 'cancel') f.controller.cancelActivation();
    if (mode === 'navigate') f.native.get(1).frame.documentId = 'successor';
    if (mode === 'off') snapshot.state.state = 'off';
    injection.resolve(); assert.equal(await pending, false); await f.controller.settled(); assert.equal(f.shows().length, 0);
  }
});

test('an acknowledged show that becomes stale while awaiting the renderer is hidden by its exact old generation', async () => {
  const f = fixture(); f.set(); const ack = deferred();
  f.hooks.send = (_tab, message) => message.type === 'protect-overlay-show' ? ack.promise : Promise.resolve({});
  const pending = f.controller.showActivation(1, 1, () => true); await flush(); const shown = f.shows()[0].message;
  f.controller.cancelActivation(); ack.resolve({ schemaVersion: 1, type: 'protect-overlay-ack', kind: shown.kind, generation: shown.generation, accepted: true });
  assert.equal(await pending, false); await f.controller.settled();
  assert.ok(f.hides().length > 0); assert.ok(f.hides().every(row => row.message.generation === shown.generation && row.options.documentId === 'doc1'));
});

test('closeAll invalidates findings work already queued behind a pending native activation operation', async () => {
  const f = fixture(); f.set(); const injection = deferred(); f.hooks.inject = () => injection.promise;
  const activation = f.controller.showActivation(1, 1, () => true); await flush();
  f.controller.schedule(1); const ticking = f.tick(300); await flush();
  f.controller.closeAll(); injection.resolve(); assert.equal(await activation, false); await ticking; await f.controller.settled();
  assert.equal(f.shows().length, 0, 'a controller snapshot still awaiting OFF cannot revive a cancelled scheduled finding');
});

test('wrong or rejected renderer ACK does not mark a finding as seen', async () => {
  const f = fixture(); f.set(); f.hooks.send = async (_tab, message) => ({ schemaVersion: 1, type: 'protect-overlay-ack', kind: message.kind, generation: message.generation + 1, accepted: true });
  f.controller.schedule(1); await f.tick(300); assert.equal(f.controller.diagnostics().seen, 0); assert.equal(f.hides().length, 1);
  f.hooks.send = null; f.controller.schedule(1); await f.tick(300); assert.equal(f.controller.diagnostics().seen, 1);
});

test('a never-resolving renderer ACK expires, permits another document and cannot revive after its late acknowledgement', async () => {
  const f = fixture(); f.set(1); f.set(2); const held = deferred();
  f.hooks.send = async (tabId, message) => tabId === 1 && message.type === 'protect-overlay-show' ? held.promise : { schemaVersion: 1, type: 'protect-overlay-ack', kind: message.kind, generation: message.generation, accepted: true };
  const first = f.controller.showActivation(1, 1, () => true); await flush(); assert.equal(f.shows().length, 1);
  f.controller.schedule(2); await f.advance(300); await f.advance(OVERLAY_NATIVE_TIMEOUT_MS - 300);
  assert.equal(await first, false); await f.controller.settled(); assert.equal(f.shows().length, 2); assert.equal(f.controller.diagnostics().seen, 1);
  const shown = f.shows()[0].message; assert.ok(f.hides().some(row => row.message.generation === shown.generation));
  held.resolve({ schemaVersion: 1, type: 'protect-overlay-ack', kind: shown.kind, generation: shown.generation, accepted: true }); await flush();
  assert.equal(f.shows().length, 2); assert.equal(f.controller.diagnostics().activation, false);
});

test('never-resolving injection and hide calls have the same bound and do not block subsequent documents', async () => {
  for (const phase of ['injection', 'hide']) {
    const f = fixture(); f.set(1); f.set(2);
    if (phase === 'injection') f.hooks.inject = options => options.target.tabId === 1 ? new Promise(() => {}) : Promise.resolve();
    const first = f.controller.showActivation(1, 1, () => true); await flush();
    if (phase === 'hide') {
      assert.equal(await first, true);
      f.hooks.send = async (tabId, message) => tabId === 1 && message.type === 'protect-overlay-hide' ? new Promise(() => {}) : { schemaVersion: 1, type: 'protect-overlay-ack', kind: message.kind, generation: message.generation, accepted: true };
      f.controller.cancelActivation(); await flush();
    }
    f.controller.schedule(2); await f.advance(300); await f.advance(OVERLAY_NATIVE_TIMEOUT_MS - 300); await f.controller.settled();
    if (phase === 'injection') assert.equal(await first, false);
    assert.ok(f.shows().some(row => row.tabId === 2)); assert.equal(f.controller.diagnostics().seen, 1);
  }
});

test('findings group at 300ms, stay deduplicated after close and reopen only for a fresh semantic finding', async () => {
  const f = fixture(), snapshot = f.set(); f.controller.schedule(1); f.controller.schedule(1);
  await f.tick(299); assert.equal(f.shows().length, 0); await f.tick(1); assert.equal(f.shows().length, 1);
  const first = f.shows()[0].message; await f.controller.close(1, 'findings', first.generation);
  snapshot.report.evidence[0].count = 25; f.controller.schedule(1); await f.tick(20_000); assert.equal(f.shows().length, 1);
  snapshot.report.evidence.push(transfer({ evidenceId: 'pe-2', fieldKind: 'phone' })); f.controller.schedule(1); await f.tick(300); assert.equal(f.shows().length, 2);
  assert.notEqual(f.shows()[1].message.generation, first.generation);
});

test('historical seed is quiet and false-positive reports cannot create an overlay', async () => {
  const f = fixture(); f.set(); f.controller.seed([{ tabId: 1, snapshot: { documentKey: '1:0:doc1', site: 'source.test', keys: ['ignored-untrusted-input'] } }]);
  f.controller.schedule(1); await f.tick(300); assert.equal(f.shows().length, 0); assert.equal(f.controller.diagnostics().seen, 1);
  for (const changes of [{ evidence: [] }, { coverageState: 'paused' }, { evidence: [transfer({ count: 0 })] }, { evidence: [transfer({ protectKind: 'password-field-listener' })] }, { features: [] }]) {
    const next = fixture(), snapshot = next.set(); Object.assign(snapshot.report, changes); next.controller.schedule(1); await next.tick(300); assert.equal(next.injections.length, 0);
  }
});

test('native content actions require the current top-level document, extension sender and live generation', async () => {
  const f = fixture(); f.set(); f.controller.schedule(1); await f.tick(300); const shown = f.shows()[0].message, sender = f.sender();
  assert.equal((await f.controller.handleAction(f.action(shown), sender)).target.documentId, 'doc1');
  for (const changes of [{ id: 'another-extension' }, { frameId: 1 }, { documentId: 'other' }, { tab: { id: 2 } }, { url: 'chrome-extension://' + extensionId + '/options.html' }, { documentLifecycle: 'prerender' }]) assert.equal(await f.controller.handleAction(f.action(shown), { ...sender, ...changes }), null);
  for (const changes of [{ generation: shown.generation - 1 }, { documentKey: '1:0:other' }, { action: 'enable' }, { kind: 'activation' }, { schemaVersion: 2 }]) assert.equal(await f.controller.handleAction(f.action(shown, changes), sender), null);
  let getters = 0; const request = {}; Object.defineProperty(request, 'receivers', { enumerable: true, get() { getters++; return ['receiver.test']; } });
  assert.equal(await f.controller.handleAction(f.action(shown, { action: 'decide', request }), sender), null); assert.equal(getters, 0);
  const snooze = await f.controller.handleAction(f.action(shown, { action: 'snooze', request: { schemaVersion: 1, type: 'ui-protect-snooze', minutes: 60 } }), sender);
  assert.equal(snooze.action, 'snooze');
  await f.controller.close(1, 'findings', shown.generation); assert.equal(await f.controller.handleAction(f.action(shown), sender), null);
});

test('activation cannot authorize rule decisions and actions recheck native identity after awaits', async () => {
  const f = fixture(); f.set(); await f.controller.showActivation(1, 1, () => true); const shown = f.shows()[0].message;
  assert.equal(await f.controller.handleAction(f.action(shown, { action: 'decide' }), f.sender()), null);
  const pendingFrame = deferred(); f.hooks.frame = () => pendingFrame.promise;
  const pending = f.controller.handleAction(f.action(shown), f.sender()); await flush();
  f.controller.cancelActivation(); pendingFrame.resolve({ documentId: 'doc1', url: 'https://source.test/' });
  assert.equal(await pending, null); await f.controller.settled();
});

test('current-document updates keep the generation and never run an injection or reset activation', async () => {
  const f = fixture(), snapshot = f.set(); await f.controller.showActivation(1, 1, () => true); const first = f.shows()[0].message;
  assert.equal(await f.controller.refresh(1, 'activation', first.generation), true); assert.equal(f.shows()[1].message.generation, first.generation); assert.equal(f.injections.length, 1);
  snapshot.state.state = 'off'; assert.equal(await f.controller.refresh(1, 'activation', first.generation), false);
});

test('navigation forgets the old document and cannot reuse its token for a new report', async () => {
  const f = fixture(); f.set(); f.controller.schedule(1); await f.tick(300); const first = f.shows()[0].message;
  f.controller.forget(1); await f.controller.settled(); f.set(1, 'doc2'); f.controller.schedule(1); await f.tick(10_000);
  const second = f.shows().at(-1).message; assert.equal(second.documentKey, '1:0:doc2'); assert.notEqual(second.generation, first.generation);
  assert.equal(await f.controller.handleAction(f.action(first), f.sender()), null);
});

test('memory and scheduling are bounded and closing all removes only targeted own overlay generations', async () => {
  const f = fixture(); for (let id = 0; id < OVERLAY_MAX_TABS + 10; id++) { f.set(id); f.controller.seed([{ tabId: id, snapshot: { documentKey: `${id}:0:doc1`, site: 'source.test', keys: ['seed'] } }]); }
  assert.equal(f.controller.diagnostics().tabs, OVERLAY_MAX_TABS); assert.ok(f.controller.diagnostics().seen <= OVERLAY_MAX_SEEN);
  for (let id = 0; id < 2000; id++) f.controller.schedule(id); assert.equal(f.controller.diagnostics().scheduled, 1024);
  f.controller.closeAll(); await f.controller.settled(); assert.equal(f.controller.diagnostics().tabs, 0); assert.equal(f.controller.diagnostics().scheduled, 0); assert.equal(f.controller.diagnostics().seen, 0);
  assert.ok(OVERLAY_MAX_SEEN_PER_DOCUMENT >= 100);
});
