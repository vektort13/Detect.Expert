import test from 'node:test';
import assert from 'node:assert/strict';
import { createProReportHistory, purgeProReportHistory, withProReportHistoryPurge, archiveCurrentProReport, proReportHistoryIntent } from '../../apps/production-extension/pro-report-history.js';
import { canonicalSessionValidator, stoppedProSession, memoryHistoryBackend } from './pro-report-history-fixture.mjs';
const validateSession = canonicalSessionValidator();
function fixture() { const storage = memoryHistoryBackend();let revision = 0;return { storage, history: createProReportHistory({ storage, validateSession, now: () => 3000 }), purge: { storage, makeEpoch: () => 'purge-' + ++revision } }; }
const deferred = () => { let resolve;const promise = new Promise(done => { resolve = done; });return { promise, resolve }; };

test('saved stopped session persists independently of live recording; list reads only safe summaries', async () => {
  const f = fixture(), session = stoppedProSession();assert.equal(validateSession(session).ok, true);
  await f.history.save(session, await f.history.captureEpoch());session.pages[0].title = 'MUTATED';
  const loaded = await f.history.get('saved-1');assert.equal(loaded.pages[0].title, 'PRIVATE_PAGE_TITLE');
  const rows = await f.history.list();assert.equal(rows.length, 1);assert.equal(rows[0].domain, 'example.test');assert.equal(rows[0].pages, 1);assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_PAGE_TITLE|https:|document-1|startTabId/);
  assert.deepEqual(f.storage.calls.at(-1), { names: ['summaries'], mode: 'readonly' });
});
test('canonical validator rejects a recording, extra fields and accessors without executing a getter', async () => {
  const f = fixture(), epoch = await f.history.captureEpoch();let reads = 0;
  for (const session of [{ ...stoppedProSession(), status: 'recording' }, { ...stoppedProSession(), unexpected: true }, Object.defineProperty(stoppedProSession(), 'domain', { get() { reads++;return 'secret.test'; } })]) await assert.rejects(f.history.save(session, epoch), /history-invalid/);
  assert.equal(reads, 0);assert.deepEqual(await f.history.list(), []);
});

test('complete canonical fixture accepts saved API documents and rejects a malformed row without erasing valid values', async () => {
  const f = fixture(), session = stoppedProSession('with-api-values'), epoch = await f.history.captureEpoch();
  session.pages[0].apiValues = [{ documentKey: session.pages[0].documentKey, truncated: false, rows: [{ operation: 'HTMLCanvasElement.toDataURL', techniqueId: 'DET-001', phase: 'returned-sync', value: { kind: 'unobserved', reason: 'sensitive' }, parameters: [], count: 1 }] }];
  assert.equal(validateSession(session).ok, true, 'The actual later-declared PRO value validators must be present');
  await f.history.save(session, epoch);
  assert.deepEqual((await f.history.get(session.id)).pages[0].apiValues, session.pages[0].apiValues);
  const malformed = structuredClone(session); malformed.pages[0].apiValues[0].rows[0].count = 0;
  assert.equal(validateSession(malformed).ok, false);
  await assert.rejects(f.history.save(malformed, epoch), /history-invalid/);
  assert.equal((await f.history.get(session.id)).pages[0].apiValues[0].rows[0].count, 1);
});
test('record cap rejects a new save without evicting or changing twenty existing reports; same id is replaceable', async () => {
  const f = fixture(), epoch = await f.history.captureEpoch();for (let i = 0; i < 20; i++) await f.history.save(stoppedProSession('saved-' + i), epoch);
  await assert.rejects(f.history.save(stoppedProSession('overflow'), epoch), /history-full/);assert.equal((await f.history.list()).length, 20);assert.equal(await f.history.get('overflow'), null);
  await f.history.save(stoppedProSession('saved-3'), epoch);assert.equal((await f.history.list()).length, 20);
});
test('payload byte cap rejects overflow and never evicts existing records', async () => {
  const storage = memoryHistoryBackend(), history = createProReportHistory({ storage, now: () => 3000, validateSession: value => ({ ok: true, value }) }), epoch = await history.captureEpoch();
  const first = { ...stoppedProSession('large-1'), syntheticBudgetPayload: 'x'.repeat(3 * 1024 * 1024) }, second = { ...first, id: 'large-2' }, third = { ...first, id: 'large-3' };
  await history.save(first, epoch);await history.save(second, epoch);await assert.rejects(history.save(third, epoch), /history-full/);assert.deepEqual((await history.list()).map(row => row.id), ['large-1', 'large-2']);
});
test('failed summary commit rolls back report payload and metadata atomically', async () => {
  const f = fixture();f.storage.failNext('summaries');await assert.rejects(f.history.save(stoppedProSession(), await f.history.captureEpoch()), /STORAGE_WRITE_FAILED/);assert.deepEqual(await f.history.list(), []);assert.equal(await f.history.get('saved-1'), null);
});
test('missing or corrupt epoch fails closed until an explicit purge repairs it', async () => {
  const f = fixture(), old = await f.history.captureEpoch();await f.storage.transaction(['state'], 'readwrite', io => io.clear('state'));
  await assert.rejects(f.history.captureEpoch(), /history-corrupt/);await assert.rejects(f.history.save(stoppedProSession(), old), /history-corrupt/);
  await purgeProReportHistory(f.purge);await assert.rejects(f.history.save(stoppedProSession(), old), /history-stale/);
});
test('clear without UI listeners fences both old captures and snapshots captured during the old-session reset', async () => {
  const f = fixture(), before = await f.history.captureEpoch();await f.history.save(stoppedProSession('old'), before);let inside;
  const result = await withProReportHistoryPurge(async () => { assert.deepEqual(await f.history.list(), []);inside = await f.history.captureEpoch();await f.history.save(stoppedProSession('during-reset'), inside);return 'RESET_DONE'; }, f.purge);
  assert.deepEqual(result, { ok: true, value: 'RESET_DONE' });assert.deepEqual(await f.history.list(), []);
  for (const captured of [before, inside]) await assert.rejects(f.history.save(stoppedProSession('late'), captured), /history-stale/);assert.deepEqual(await f.history.list(), []);
});
test('archive save captures epoch before fresh source read and cannot resurrect after a concurrent purge', async () => {
  const f = fixture(), entered = deferred(), release = deferred(), order = [];
  const save = archiveCurrentProReport({ history: { ...f.history, captureEpoch: async () => { order.push('epoch');return f.history.captureEpoch(); } }, candidateId: 'saved-1', readCurrent: async () => { order.push('fresh-source');entered.resolve();await release.promise;return { ok: true, response: { session: stoppedProSession() } }; } });
  await entered.promise;await withProReportHistoryPurge(async () => {}, f.purge);release.resolve();await assert.rejects(save, /history-stale/);assert.deepEqual(order, ['epoch', 'fresh-source']);assert.deepEqual(await f.history.list(), []);
});
test('failed erase never reports success, while old reset and final cleanup still run', async () => {
  const f = fixture();let oldReset = 0;f.storage.failNext('reports');const result = await withProReportHistoryPurge(async () => { oldReset++;return 'OLD_RESULT'; }, f.purge);assert.equal(result.ok, false);assert.equal(result.value, 'OLD_RESULT');assert.equal(oldReset, 1);assert.deepEqual(await f.history.list(), []);
});
test('original reset exception including undefined survives after final archive purge', async () => {
  for (const sentinel of [new Error('OLD_RESET'), undefined]) { const f = fixture();let caught = false;try { await withProReportHistoryPurge(async () => { throw sentinel; }, f.purge); } catch (error) { caught = true;assert.equal(error, sentinel); }assert.equal(caught, true);assert.notEqual(await f.history.captureEpoch(), 'initial-v1'); }
});
test('explicit delete removes one archived report; archive-only route never falls back after deletion', async () => {
  const f = fixture(), epoch = await f.history.captureEpoch();await f.history.save(stoppedProSession('a'), epoch);await f.history.save(stoppedProSession('b'), epoch);await f.history.remove('a');assert.equal(await f.history.get('a'), null);assert.equal((await f.history.get('b')).id, 'b');
  assert.equal(proReportHistoryIntent('?id=a&history=1'), 'archive');assert.equal(proReportHistoryIntent('?id=a'), 'fallback');assert.equal(proReportHistoryIntent('?history=1&history=0'), 'invalid');
  await assert.rejects(f.history.save(stoppedProSession('a'), epoch), /history-stale/, 'explicit deletion also fences pending older saves');
});
test('abandoned explicit save cannot read a different report or write after its UI generation changed', async () => {
  const f = fixture();let current = true, writes = 0;const history = { ...f.history, save: async (...args) => { writes++;return f.history.save(...args); } };
  await assert.rejects(archiveCurrentProReport({ history, candidateId: 'saved-1', isCurrent: () => current, readCurrent: async () => { current = false;return { ok: true, response: { session: stoppedProSession() } }; } }), /history-stale/);assert.equal(writes, 0);
  current = true;await assert.rejects(archiveCurrentProReport({ history, candidateId: 'saved-1', readCurrent: async () => ({ ok: true, response: { session: stoppedProSession('replacement') } }) }), /history-stale/);assert.equal(writes, 0);
});
