// ADR-073: execute the actual shipped JS reducer/repository, including production-only counter fields.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { patchClearBackground } from '../production/clear-background-patches.mjs';
import { classMember } from '../production/clear-reset-tools.mjs';

const original = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
const patched = patchClearBackground(original);
const context = vm.createContext({ console, TextEncoder, URL, atob, btoa });
vm.runInContext(patched.slice(patched.indexOf('// packages/contracts/src/technique-ids.ts'), patched.indexOf('// packages/contracts/src/data-consent.ts')), context);
const { reduce, createInitialState, SessionRepository, CLEAR_FENCES_KEY, validateBridgeResetAck } = context;
const deps = { deriveFindings: () => [] }, id = 'document-000000001', key = '7:0:' + id;
const sender = { tabId: 7, frameId: 0, documentId: id, documentKey: key, host: 'example.com', originPattern: 'https://example.com/*', documentLifecycle: 'active', frameType: null };
const fence = { documentKey: key, bridgeSessionId: 'new-session', sensorBootIds: ['new-boot'], at: 1001000, reportRevision: 9 };
function initial() { return reduce(createInitialState(), { type: 'navigation:committed', ...sender, parentDocumentId: null, accessGranted: true, at: 1000000 }, deps).state; }
function batch(state, count, { boot = 'old-boot', session = 'old-session', seq = 1, techniqueId = 'DET-001', apiOperation } = {}) {
  return reduce(state, { type: 'batch', sender, at: 1002000, batch: { schemaVersion: 1, type: 'sensor-events', sensorBootId: boot, bridgeSessionId: session, batchSeq: seq, coverageDelta: [], observations: [{ techniqueId, phase: 'attempted', signalCodes: ['api-use'], count, countQuality: 'exact', intervalBucket: seq, ...(apiOperation ? { apiOperation } : {}) }] } }, deps);
}
function storage() {
  const data = new Map(); let failure = null;
  return { data, fail(value) { failure = value; }, async get(keys) { if (failure === 'read') throw Error('read failed'); return Object.fromEntries([...data].filter(([key]) => keys == null || (Array.isArray(keys) ? keys : [keys]).includes(key))); },
    async set(items) { if (failure === 'write') throw Error('write failed'); for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value)); },
    async remove(keys) { if (failure === 'remove') throw Error('remove failed'); for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key); }, async clear() { data.clear(); } };
}
const record = state => ({ v: 1, report: state.reports.get(key), meta: state.metas.get(key) });
const plain = value => JSON.parse(JSON.stringify(value));

test('shipped substrate patch is idempotent and preserves ordinary commit and Protect predicate', () => {
  assert.equal(patchClearBackground(patched), patched);
  assert.equal(classMember(patched, 'SessionRepository', 'commit').text, classMember(original, 'SessionRepository', 'commit').text);
  assert.ok(classMember(patched, 'SessionRepository', 'clearAll').text.includes('keepKey(key2) === !0'));
  assert.throws(() => patchClearBackground(patched.replace('function applyBatch(d, ctx, batch, at, deps) {', 'function applyBatch(d, ctx, batch, at, deps) { /* unreviewed change */')), /drift/);
});

test('ADR-076 report hydration reads only report keys and never obtains the session credential value',async()=>{
  const s=storage(),repo=new SessionRepository(s),calls=[];
  await repo.commit(key,record(batch(initial(),1).state),null);
  s.data.set('precursor-credential:v1',{token:'SESSION_VAULT_CANARY'});s.data.set('unrelated-session-key',{value:'UNRELATED_CANARY'});
  s.getKeys=async()=>[...s.data.keys()];const read=s.get.bind(s);s.get=async keys=>{calls.push(keys);assert.notEqual(keys,null);assert.ok(!keys.includes('precursor-credential:v1'));return read(keys);};
  const result=await repo.loadAll();assert.equal(result.documents.length,1);assert.equal(JSON.stringify(result).includes('CANARY'),false);assert.equal(calls.length,1);
});
test('ADR-076 failure of keys-only enumeration never falls back to broad credential reads',async()=>{
  const s=storage(),repo=new SessionRepository(s);let reads=0;
  s.getKeys=async()=>{throw Error('keys-unavailable');};s.get=async()=>{reads++;return {};};
  await assert.rejects(repo.loadAll(),/keys-unavailable/);assert.equal(reads,0);
  assert.equal(await repo.clearAll(['keep']),false);assert.equal(reads,0);
});
test('ADR-076 selective session purge removes vault by key without reading it or touching Protect predicate',async()=>{
  const s=storage(),repo=new SessionRepository(s);s.data.set('precursor-credential:v1',{token:'SESSION_VAULT_CANARY'});s.data.set('protect-runtime:v1',{alive:true});s.data.set('keep',true);
  s.getKeys=async()=>[...s.data.keys()];s.get=async()=>{throw Error('unexpected-value-read');};
  assert.equal(await repo.clearAll(['keep'],name=>name.startsWith('protect-')),true);
  assert.equal(s.data.has('precursor-credential:v1'),false);assert.equal(s.data.has('protect-runtime:v1'),true);assert.equal(s.data.has('keep'),true);
});

test('ADR-076 old Firefox enumeration helper returns only names and never dereferences credential values',async()=>{
  const s=storage(),repo=new SessionRepository(s),reads=[];let secretReads=0;
  const raw={};Object.defineProperty(raw,'precursor-credential:v1',{enumerable:true,get(){secretReads++;throw Error('secret accessed');}});
  const read=s.get.bind(s);s.get=async keys=>{reads.push(keys);if(keys===null)return raw;assert.ok(!keys.includes('precursor-credential:v1'));return read(keys);};
  const result=await repo.loadAll();assert.equal(result.documents.length,0);assert.equal(secretReads,0);
  assert.deepEqual(plain(reads),[null,[]]);
});
test('actual production reducer fences unseen old keys and counts first fresh event from zero', () => {
  let state = batch(initial(), 100).state;
  state = reduce(state, { type: 'ui:clear', documentKey: key, fence, at: fence.at }, deps).state;
  assert.equal(state.reports.get(key).counters.length, 0);
  assert.ok(state.reports.get(key).revision >= 9);
  for (const techniqueId of ['DET-001', 'DET-002']) { const old = batch(state, 101, { seq: 2, techniqueId }); assert.equal(old.batch.status, 'duplicate'); assert.equal(old.state.reports.get(key).counters.length, 0); }
  state = batch(state, 1, { boot: 'new-boot', session: 'new-session' }).state;
  assert.equal(state.reports.get(key).counters[0].count, 1);
  assert.equal(state.metas.get(key).counterKeyFormat, 'index-v1');
  assert.equal(state.metas.get(key).cleared, undefined);
});
test('actual repository reports failed authority write and preserves old payload', async () => {
  const s = storage(), repo = new SessionRepository(s), old = record(batch(initial(), 100).state);
  await repo.commit(key, old, null); s.fail('write');
  assert.deepEqual(plain(await repo.commitClear([fence])), { committed: false, cleaned: false });
  assert.equal(s.data.get('doc:' + key).report.counters[0].count, 100);
});
test('actual repository durable fence survives torn cleanup and worker reload', async () => {
  const s = storage(), repo = new SessionRepository(s); await repo.commit(key, record(batch(initial(), 100).state), null);
  s.fail('remove'); assert.deepEqual(plain(await repo.commitClear([fence])), { committed: true, cleaned: false });
  s.fail(null); const next = new SessionRepository(s), loaded = await next.loadAll();
  assert.equal(loaded.documents.length, 1); assert.equal(loaded.documents[0].report.counters.length, 0); assert.equal(loaded.documents[0].meta.clearEpoch, fence.bridgeSessionId);
  assert.ok(next.clearFenceBytes > 0);
});
test('actual repository includes authority bytes in budget and preserves Protect keys on full discard', async () => {
  const s = storage(), repo = new SessionRepository(s);
  assert.deepEqual(plain(await repo.commitClear([fence], 4 * 1024 * 1024)), { committed: false, cleaned: false });
  assert.equal((await repo.commitClear([fence])).committed, true);
  s.data.set('protect-owned', { keep: true }); s.data.set('bad-predicate', true);
  assert.equal(await repo.clearAll([], key => { if (key === 'bad-predicate') throw Error('predicate'); return key === 'protect-owned'; }), true);
  assert.deepEqual([...s.data.keys()], ['protect-owned']); assert.equal(repo.clearFenceBytes, 0); assert.equal(repo.clearFence(key), undefined);
});
test('actual reset ACK reader rejects descriptors and iterators without running them', () => {
  const ack = { schemaVersion: 1, type: 'bridge-reset-ack', resetId: 'reset-1', bridgeSessionId: 'bridge-1', sensorBootIds: ['boot-1'] };
  assert.equal(validateBridgeResetAck(ack).ok, true); let reads = 0;
  assert.equal(validateBridgeResetAck({ ...ack, get resetId() { reads++; return 'reset-1'; } }).ok, false);
  const boots = ['boot-1']; Object.defineProperty(boots, '0', { enumerable: true, get() { reads++; return 'boot-1'; } });
  assert.equal(validateBridgeResetAck({ ...ack, sensorBootIds: boots }).ok, false);
  assert.equal(validateBridgeResetAck({ ...ack, sensorBootIds: Object.assign(['boot-1'], { [Symbol.iterator]() { reads++; throw Error('iterator'); } }) }).ok, false);
  assert.equal(reads, 0); assert.equal(CLEAR_FENCES_KEY, 'clear-epochs:v1');
});

test('actual authority read failure rejects instead of exposing empty history', async () => {
  const s = storage(); s.fail('read');
  await assert.rejects(new SessionRepository(s).loadAll(), /read failed/);
});
test('captured old hydration snapshot cannot migrate payload back after consent purge', async () => {
  const s = storage(), repo = new SessionRepository(s); await repo.commit(key, record(batch(initial(), 100).state), null);
  const read = s.get; let release, started;
  const reading = new Promise(resolve => { started = resolve; });
  s.get = async keys => { const snapshot = await read(keys); started(); return new Promise(resolve => { release = () => resolve(snapshot); }); };
  let current = true; const pending = repo.loadAll(() => current); await reading;
  current = false; assert.equal(await repo.clearAll(), true); release();
  await assert.rejects(pending, /history-access-changed/); assert.equal(s.data.size, 0);
});
