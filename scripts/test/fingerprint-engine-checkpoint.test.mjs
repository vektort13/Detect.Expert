import test from 'node:test';
import assert from 'node:assert/strict';
import { createFingerprintEngineCheckpoint as create, FINGERPRINT_ENGINE_CHECKPOINT_KEY as KEY, FINGERPRINT_ENGINE_CHECKPOINT_LIMITS as LIMITS } from '../../apps/production-extension/fingerprint-engine-checkpoint.js';
const turn = () => new Promise(done => setImmediate(done));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const ownWindow = (windowId = 40, tabId = 41) => ({ id: windowId, type: 'normal', tabs: [{ id: tabId, windowId, url: 'https://native.example/secret-query-not-stored' }] });
function fixture(options = {}) {
  const calls = [], memory = { ...(options.stored === undefined ? {} : { [KEY]: options.stored }) };
  const api = { storage: { session: { async get(key) { calls.push(['get', key]); if (options.get) return options.get(key); return { ...memory }; }, async set(value) { calls.push(['set', structuredClone(value)]); if (options.set) await options.set(value); Object.assign(memory, structuredClone(value)); }, async remove(key) { calls.push(['remove', key]); if (options.remove) await options.remove(key); delete memory[key]; } } }, windows: { async get(id, flags) { calls.push(['window', id, flags]); if (options.windowGet) return options.windowGet(id); return options.window ?? ownWindow(); }, async getAll(flags) { calls.push(['all', flags]); if (options.getAll) return options.getAll(); return []; } } };
  return { api, memory, calls, checkpoint: create(api) };
}

test('ownership journal stores exactly version and native IDs in session only, without URL/profile/effects', async () => {
  const f = fixture(); await f.checkpoint.save(40, 41);
  assert.deepEqual(f.memory, { [KEY]: { v: 1, windowId: 40, tabId: 41 } });
  assert.deepEqual(f.calls, [['set', { [KEY]: { v: 1, windowId: 40, tabId: 41 } }]]);
  const window = await f.checkpoint.restore(); assert.equal(window.tabs[0].id, 41);
  assert.equal(f.calls.some(row => row[0] === 'attach' || row[0] === 'close'), false); assert.equal(JSON.stringify(f.memory).includes('secret'), false);
  await f.checkpoint.clear(); assert.deepEqual(f.memory, {}); assert.equal(await f.checkpoint.restore(), null);
});

test('normal native window and exact current tab/window identity are required; stale metadata is cleared without closing user work', async () => {
  for (const window of [{ ...ownWindow(), type: 'popup' }, ownWindow(40, 99), { ...ownWindow(), tabs: [{ id: 41, windowId: 99 }] }]) {
    const f = fixture({ stored: { v: 1, windowId: 40, tabId: 41 }, window }); assert.equal(await f.checkpoint.restore(), null); assert.equal(KEY in f.memory, false);
    assert.equal(f.calls.filter(row => row[0] === 'remove').length, 1); assert.equal(f.calls.some(row => row[0] === 'close'), false);
  }
});

test('native get failure requires a complete bounded getAll proof; existing target is recovered without guessing absence', async () => {
  const exists = fixture({ stored: { v: 1, windowId: 40, tabId: 41 }, windowGet() { throw Error('get failed'); }, getAll: () => [ownWindow()] });
  assert.equal((await exists.checkpoint.restore()).id, 40); assert.equal(exists.calls.some(row => row[0] === 'remove'), false);
  const absent = fixture({ stored: { v: 1, windowId: 40, tabId: 41 }, windowGet() { throw Error('get failed'); } });
  assert.equal(await absent.checkpoint.restore(), null); assert.deepEqual(absent.calls.find(row => row[0] === 'all')[1], { populate: true, windowTypes: ['normal'] }); assert.equal(KEY in absent.memory, false);
  for (const getAll of [() => { throw Error('unavailable'); }, () => Array.from({ length: 257 }, (_, index) => ownWindow(index + 100, index + 1000))]) {
    const f = fixture({ stored: { v: 1, windowId: 40, tabId: 41 }, windowGet() { throw Error('get failed'); }, getAll });
    await assert.rejects(f.checkpoint.restore(), error => error.code === 'not-ready'); assert.equal(KEY in f.memory, true); assert.equal(f.calls.some(row => row[0] === 'remove'), false);
  }
});

test('malformed stored fields and invalid input IDs never invoke getters or native window operations', async () => {
  const f = fixture({ stored: { v: 1, windowId: 40, tabId: 41, url: 'must-not-be-accepted' } }); assert.equal(await f.checkpoint.restore(), null); assert.equal(f.calls.some(row => row[0] === 'window'), false);
  const g = fixture(); for (const pair of [[-1, 1], [1, 1.5], ['40', 41], [Infinity, 41], [NaN, 41]]) await assert.rejects(g.checkpoint.save(...pair), /not-ready/);
  assert.deepEqual(g.calls, []);
  let reads = 0; const bad = { v: 1, tabId: 41 }; Object.defineProperty(bad, 'windowId', { enumerable: true, get() { reads++; throw Error('get'); } });
  const h = fixture({ get: () => ({ [KEY]: bad }) }); assert.equal(await h.checkpoint.restore(), null); assert.equal(reads, 0); assert.equal(h.calls.some(row => row[0] === 'window'), false);
});

test('writes are physically serialized with only the latest queued desired state; superseded Save is not reported applied', async () => {
  const held = deferred(), f = fixture({ set: () => held.promise });
  const first = f.checkpoint.save(40, 41); await turn(); const superseded = f.checkpoint.save(50, 51), rejected = assert.rejects(superseded, /not-ready/), clear = f.checkpoint.clear(); await rejected;
  assert.equal(f.calls.filter(row => row[0] === 'set').length, 1); assert.equal(f.calls.some(row => row[0] === 'remove'), false);
  held.resolve(); await first; await clear; assert.deepEqual(f.memory, {}); assert.deepEqual(f.calls.map(row => row[0]), ['set', 'remove']);
});

test('logical write deadlines retain the physical fence and an expired queued Clear still performs eventual cleanup', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const held = deferred(), f = fixture({ set: () => held.promise });
  const first = f.checkpoint.save(40, 41), firstFailure = assert.rejects(first, /not-ready/); await turn();
  const clearing = f.checkpoint.clear(), clearFailure = assert.rejects(clearing, /not-ready/); t.mock.timers.tick(LIMITS.timeoutMs); await firstFailure; await clearFailure;
  assert.deepEqual(f.calls.map(row => row[0]), ['set']); held.resolve(); await turn(); await turn(); assert.deepEqual(f.calls.map(row => row[0]), ['set', 'remove']); assert.deepEqual(f.memory, {});
});

test('Restore is singleflight and a timed-out read cannot start late window scans or bypass a queued write', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const held = deferred(), f = fixture({ get: () => held.promise });
  const first = f.checkpoint.restore(), second = f.checkpoint.restore(); assert.equal(first, second); const failure = assert.rejects(first, /not-ready/); await turn();
  t.mock.timers.tick(LIMITS.timeoutMs); await failure; const saved = f.checkpoint.save(50, 51); assert.equal(f.calls.some(row => row[0] === 'set'), false);
  held.resolve({ [KEY]: { v: 1, windowId: 40, tabId: 41 } }); await saved; assert.equal(f.calls.some(row => row[0] === 'window' || row[0] === 'all'), false);
  assert.deepEqual(f.memory[KEY], { v: 1, windowId: 50, tabId: 51 });
});

test('missing trusted session capability and failed reads/removal never fall back to disk or claim clear success', async () => {
  let diskReads = 0; const checkpoint = create({ storage: { local: { get() { diskReads++; } } } });
  await assert.rejects(checkpoint.restore(), /not-ready/); await assert.rejects(checkpoint.save(40, 41), /not-ready/); await assert.rejects(checkpoint.clear(), /not-ready/); assert.equal(diskReads, 0);
  const f = fixture({ stored: { malformed: true }, remove() { throw Error('no remove'); } }); await assert.rejects(f.checkpoint.restore(), /not-ready/); assert.equal(KEY in f.memory, true);
  const g = fixture({ get() { throw Error('no read'); } }); await assert.rejects(g.checkpoint.restore(), /not-ready/);
});
