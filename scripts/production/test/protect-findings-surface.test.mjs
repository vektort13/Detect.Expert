import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../../..');
const built = await build({ stdin: { resolveDir: root, contents: "export * from './apps/production-protect/src/findings.ts';export * from './apps/production-protect/src/findings-surface.ts';", loader: 'ts' },
  bundle: true, write: false, platform: 'neutral', format: 'esm', logLevel: 'silent', plugins: [{ name: 'vendor-contracts', setup(builder) { builder.onResolve({ filter: /^@detect-expert\/contracts$/ }, () => ({ path: resolve(root, 'vendor/protect-722fae8/packages/contracts/src/index.ts') })); } }] });
const { positiveFindings, positiveFindingSnapshot, isPositiveTransfer, isPositiveReplay, FindingsSurfacer, MAX_FINDINGS_TABS, MAX_FINDINGS_SEEN_PER_DOCUMENT, MAX_FINDINGS_SEEN, MAX_FINDINGS_SCHEDULED } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const transfer = changes => ({ evidenceId: 'pe-1', protectKind: 'value-match', ruleId: 'form-leak', ruleVersion: 'form-leak-v1', frameContext: 'top', attributionConfidence: 'unknown',
  count: 1, countQuality: 'lower-bound', firstSecond: 0, lastSecond: 0, evidenceSource: 'derived', integrity: 'derived', limitationCodes: [], fieldKind: 'email', fieldRef: 1,
  transferClass: 'third-party-before-submit', encodings: ['plain'], location: 'body-json', receiver: 'example.net', relation: 'cross-site', method: 'POST', requestKind: 'xhr',
  endpointHost: 'example.net', endpointPathTemplate: '/collect', submitTiming: 'before-submit', deliveryState: 'unknown', interpretationConfidence: 'medium', ...changes });
const replay = changes => ({ ruleId: 'session-replay-behavior', ruleVersion: 'replay-v1', level: 'replay-like', interpretationConfidence: 'low', attributionConfidence: 'unknown',
  signals: [{ code: 'root-mutation-observe', count: 1, countQuality: 'exact', evidenceSource: 'page-hook', integrity: 'page-controlled' }],
  periodicHosts: [{ registrableDomain: 'example.net', runMax: 4, sends: 4, largeInRunMax: 2, bodySize: 'under-1k' }], vendors: [], inputMasking: 'unconfirmed', limitationCodes: [], ...changes });
const report = changes => ({ documentKey: '1:0:doc1', site: 'example.com', moduleState: 'active', coverageState: 'active', features: ['value-match', 'session-replay'], evidence: [transfer()], replay: null, ...changes });

test('only actual matched transfers or assessed positive replay summaries become findings', () => {
  assert.equal(isPositiveTransfer(transfer()), true); assert.equal(isPositiveReplay(replay()), true);
  assert.equal(positiveFindings(report()).transfers.length, 1); assert.equal(positiveFindings(report({ evidence: [], replay: replay() })).replay.level, 'replay-like');
  for (const changes of [{ evidence: [] }, { moduleState: 'off' }, { moduleState: 'needs-consent' }, { moduleState: 'organization-disabled' }, { features: [] }, { coverageState: 'paused' }, { coverageState: 'no-access' }, { site: null }, { documentKey: '1:1:subframe' }]) assert.equal(positiveFindingSnapshot(report(changes)), null, JSON.stringify(changes));
  for (const changes of [{ protectKind: 'opaque-after-input' }, { protectKind: 'password-field-listener' }, { count: 0 }, { encodings: [] }, { transferClass: 'opaque-after-input' }, { interpretationConfidence: 'unassessed' }, { endpointPathTemplate: '/secret?raw=value' }, { method: 'INVALID' }]) assert.equal(isPositiveTransfer(transfer(changes)), false, JSON.stringify(changes));
  for (const changes of [{ level: 'none' }, { level: 'signals-only' }, { interpretationConfidence: 'unassessed' }, { signals: [] }, { signals: [{ code: 'made-up', count: 1 }] }]) assert.equal(isPositiveReplay(replay(changes)), false, JSON.stringify(changes));
  for (const deliveryState of ['unknown', 'sent', 'stopped', 'stopped-other']) assert.equal(isPositiveTransfer(transfer({ deliveryState, relation: 'same-site', transferClass: 'first-party-before-submit' })), true);
});

test('semantic keys ignore record IDs, counts, delivery, signal totals and receiver order', () => {
  const first = positiveFindingSnapshot(report({ replay: replay() }));
  const changed = positiveFindingSnapshot(report({ evidence: [transfer({ evidenceId: 'pe-2', count: 50, deliveryState: 'sent' })], replay: replay({ periodicHosts: [{ registrableDomain: 'example.net', runMax: 10, sends: 100, largeInRunMax: 8, bodySize: 'over-16k' }] }) }));
  assert.deepEqual(changed, first);
  assert.notDeepEqual(positiveFindingSnapshot(report({ replay: replay({ level: 'replay-recording', interpretationConfidence: 'medium' }) })).keys, first.keys);
  let reads = 0; const forbidden = transfer(); Object.defineProperty(forbidden, 'count', { get() { reads++; return 1; } });
  assert.equal(isPositiveTransfer(forbidden), false); assert.equal(reads, 0);
});

function fixture() {
  let now = 0, timerId = 0, nextWindow = 100;
  const timers = new Map(), snapshots = new Map(), tabs = new Map(), live = new Set(), shown = [], removed = [];
  const deps = { now: () => now, snapshot: tabId => snapshots.get(tabId) ?? null, tab: async tabId => tabs.get(tabId) ?? null,
    show: async (tabId, documentKey, sourceWindowId) => { const id = nextWindow++; live.add(id); shown.push({ id, tabId, documentKey, sourceWindowId }); return id; },
    existing: async id => live.has(id), remove: async id => { live.delete(id); removed.push(id); },
    setTimer: (callback, delay) => { const id = ++timerId; timers.set(id, { at: now + delay, callback }); return id; }, clearTimer: id => timers.delete(id) };
  const surface = new FindingsSurfacer(deps);
  const set = (tabId = 1, keys = ['one'], documentKey = `${tabId}:0:doc1`) => { snapshots.set(tabId, { documentKey, site: 'example.com', keys }); tabs.set(tabId, { windowId: tabId + 10, active: true, focused: true }); };
  async function tick(ms = 0) {
    const end = now + ms;
    for (let turns = 0; turns < 5000; turns++) {
      const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].callback(); await surface.settled();
      if (turns === 4999) throw Error('timer loop');
    }
    now = end; await Promise.resolve();
  }
  async function begin(ms = 300) {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    for (let index = 0; index < 12; index++) await Promise.resolve();
  }
  return { surface, deps, snapshots, tabs, live, shown, removed, timers, set, tick, begin };
}

test('300ms grouping opens once; unchanged keys and count updates never reopen', async () => {
  const f = fixture(); f.set(); f.surface.schedule(1); f.surface.schedule(1);
  await f.tick(299); assert.equal(f.shown.length, 0); await f.tick(1); assert.equal(f.shown.length, 1);
  f.surface.schedule(1); await f.tick(300); assert.equal(f.shown.length, 1);
  const opened = f.shown[0].id; f.live.delete(opened); f.surface.closed(opened); f.surface.schedule(1); await f.tick(20_000); assert.equal(f.shown.length, 1);
  f.snapshots.set(1, null); f.surface.schedule(1); await f.tick(300); assert.equal(f.surface.snapshot().tabs, 0);
});

test('background/unfocused source waits for activation and is rechecked immediately before creation', async () => {
  const f = fixture(); f.set(); f.tabs.get(1).active = false; f.surface.schedule(1); await f.tick(300);
  assert.equal(f.shown.length, 0); assert.equal(f.surface.snapshot().waiting, 1);
  f.tabs.get(1).active = true; f.tabs.get(1).focused = false; f.surface.activated(1); await f.tick(); assert.equal(f.shown.length, 0);
  f.tabs.get(1).focused = true; let calls = 0;
  f.deps.tab = async () => ({ windowId: 11, active: true, focused: ++calls === 1 });
  f.surface.activated(1); await f.tick(); assert.equal(f.shown.length, 0);
  f.deps.tab = async () => ({ windowId: 11, active: true, focused: true }); f.surface.activated(1); await f.tick(); assert.equal(f.shown.length, 1);
});

test('one global window queues another document; current-document updates are consumed without replacement', async () => {
  const f = fixture(); f.set(1); f.set(2); f.surface.schedule(1); await f.tick(300);
  f.surface.schedule(2); await f.tick(300); assert.equal(f.shown.length, 1); assert.equal(f.surface.snapshot().waiting, 1);
  f.set(1, ['one', 'two']); f.surface.schedule(1); await f.tick(300); assert.equal(f.shown.length, 1);
  f.live.delete(f.shown[0].id); f.surface.closed(f.shown[0].id); await f.tick(9100); assert.equal(f.shown.length, 1);
  await f.tick(300); assert.equal(f.shown.length, 2); assert.equal(f.shown[1].tabId, 2); assert.deepEqual(f.removed, []);
});

test('historical seed and verified SW-restart adoption do not emit startup notifications', async () => {
  const f = fixture(); f.set(1); f.set(2);
  f.surface.seed([{ tabId: 1, snapshot: f.snapshots.get(1) }]); f.surface.schedule(1); await f.tick(300); assert.equal(f.shown.length, 0);
  assert.equal(f.surface.adopt({ windowId: 7, tabId: 1, documentKey: '1:0:wrong' }), false);
  f.live.add(7); assert.equal(f.surface.adopt({ windowId: 7, tabId: 1, documentKey: '1:0:doc1' }), true);
  assert.equal(f.surface.adopt({ windowId: 8, tabId: 2, documentKey: '2:0:doc1' }), false);
  f.surface.schedule(2); await f.tick(300); assert.equal(f.shown.length, 0);
  f.live.delete(7); f.surface.closed(7); await f.tick(); assert.equal(f.shown.length, 1); assert.equal(f.shown[0].tabId, 2);
});

test('navigation, disable/exclusion and late focus loss remove an asynchronously created stale window', async () => {
  for (const reason of ['navigation', 'disabled', 'focus']) {
    const f = fixture(); f.set(); let resolveShow;
    f.deps.show = () => new Promise(resolve => { resolveShow = resolve; });
    f.surface.schedule(1); await f.begin(); assert.equal(typeof resolveShow, 'function');
    if (reason === 'navigation') { f.set(1, ['new'], '1:0:newdoc'); f.surface.forget(1); }
    if (reason === 'disabled') f.snapshots.set(1, null);
    if (reason === 'focus') f.tabs.get(1).focused = false;
    f.live.add(90); resolveShow(90); await f.surface.settled();
    assert.deepEqual(f.removed, [90], reason); assert.equal(f.surface.snapshot().window, null, reason); assert.equal(f.surface.snapshot().opened, 0, reason);
  }
});

test('a failed stale-window removal reserves the global slot until closure', async () => {
  const f = fixture(); f.set(); let resolveShow; f.deps.show = () => new Promise(resolve => { resolveShow = resolve; });
  f.surface.schedule(1); await f.begin(); f.tabs.get(1).focused = false; f.deps.remove = async () => { throw Error('browser refused'); };
  f.live.add(90); resolveShow(90); await f.surface.settled(); assert.equal(f.surface.snapshot().window.windowId, 90);
  f.set(2); f.surface.schedule(2); await f.tick(300); assert.equal(f.surface.snapshot().opened, 0); assert.equal(f.surface.snapshot().waiting, 2);
  f.surface.closed(90); f.live.delete(90); f.deps.show = async () => 91; await f.tick(10_000); assert.equal(f.surface.snapshot().window.tabId, 2);
});

test('failed creation does not consume finding keys and is rate-limited before retry', async () => {
  const f = fixture(); f.set(); let attempts = 0;
  f.deps.show = async () => { if (++attempts === 1) throw Error('denied'); return 90; };
  f.surface.schedule(1); await f.tick(300); assert.equal(f.surface.snapshot().seen, 0); assert.equal(attempts, 1);
  f.surface.activated(1); await f.tick(9999); assert.equal(attempts, 1); await f.tick(1); assert.equal(attempts, 2); assert.equal(f.surface.snapshot().seen, 1);
});

test('tab and scheduled queues are bounded; stop removes the owned window without future notifications', async () => {
  const f = fixture();
  for (let tab = 0; tab < MAX_FINDINGS_SCHEDULED + 10; tab++) { f.set(tab); f.tabs.get(tab).active = false; f.surface.schedule(tab); }
  assert.equal(f.surface.snapshot().scheduled, MAX_FINDINGS_SCHEDULED); await f.tick(300); assert.equal(f.surface.snapshot().tabs, MAX_FINDINGS_TABS);
  const one = fixture(); one.set(); one.surface.schedule(1); await one.tick(300); one.surface.stop(); await Promise.resolve();
  assert.deepEqual(one.removed, [100]); one.surface.schedule(1); await one.tick(100_000); assert.equal(one.shown.length, 1); assert.equal(one.surface.snapshot().scheduled, 0);
});

test('per-document seen-key saturation stays bounded and suppresses repeated overflow alerts', async () => {
  const f = fixture(); f.set(); f.surface.schedule(1); await f.tick(300);
  for (let key = 0; key < MAX_FINDINGS_SEEN_PER_DOCUMENT + 2; key++) { f.set(1, ['key-' + key]); f.surface.schedule(1, 0); await f.tick(); }
  assert.equal(f.surface.snapshot().seen, MAX_FINDINGS_SEEN_PER_DOCUMENT); assert.ok(f.surface.snapshot().budget > 0); assert.equal(f.shown.length, 1);
});

test('global seen-key budget suppresses excess documents until navigation and frees storage on forget', async () => {
  const f = fixture(), entries = [];
  for (let tab = 1; tab <= MAX_FINDINGS_SEEN / MAX_FINDINGS_SEEN_PER_DOCUMENT; tab++) {
    f.set(tab, Array.from({ length: 64 }, (_, key) => `first-${key}`));
    entries.push({ tabId: tab, snapshot: f.snapshots.get(tab) });
  }
  f.surface.seed(entries);
  for (const entry of entries) {
    f.set(entry.tabId, Array.from({ length: 64 }, (_, key) => `second-${key}`));
  }
  f.surface.seed(entries.map(entry => ({ tabId: entry.tabId, snapshot: f.snapshots.get(entry.tabId) })));
  assert.equal(f.surface.snapshot().seen, MAX_FINDINGS_SEEN);
  f.set(20); f.surface.schedule(20); await f.tick(300);
  assert.equal(f.shown.length, 0); assert.equal(f.surface.snapshot().seen, MAX_FINDINGS_SEEN); assert.ok(f.surface.snapshot().budget > 0);
  f.surface.forget(1); assert.equal(f.surface.snapshot().seen, MAX_FINDINGS_SEEN - MAX_FINDINGS_SEEN_PER_DOCUMENT);
  f.surface.activated(20); await f.tick(); assert.equal(f.shown.length, 0);
  f.set(20, ['new'], '20:0:nextdoc'); f.surface.activated(20); await f.tick(); assert.equal(f.shown.length, 1);
  f.surface.stop(); assert.equal(f.surface.snapshot().seen, 0);
});

test('historical seeds beyond the total dedup budget remain quiet after storage is freed', async () => {
  const f = fixture(), entries = [];
  for (let tab = 0; tab < MAX_FINDINGS_TABS; tab++) {
    f.set(tab, Array.from({ length: 64 }, (_, key) => `${tab}-${key}`));
    entries.push({ tabId: tab, snapshot: f.snapshots.get(tab) });
  }
  f.surface.seed(entries); assert.equal(f.surface.snapshot().seen, MAX_FINDINGS_SEEN);
  f.surface.forget(0); f.surface.forget(1);
  f.surface.activated(MAX_FINDINGS_TABS - 1); await f.tick(); assert.equal(f.shown.length, 0);
  assert.ok(f.surface.snapshot().seen <= MAX_FINDINGS_SEEN);
});
