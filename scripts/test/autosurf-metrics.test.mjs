import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutosurfMetrics } from '../../apps/production-extension/autosurf-metrics.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const code = expected => error => error?.code === expected;
const cpu = (used, idle) => ({ processors: [{ usage: { user: used, kernel: 0, idle, total: used + idle } }] });
function fixture() {
  const state = { live: true, time: 1000, cpu: cpu(20, 80), memory: { capacity: 1000, availableCapacity: 600 }, grants: true, cpuCall: null, calls: [] };
  const context = { tabId: 1, documentId: 'owned-doc', isCurrent: () => state.live };
  const api = { permissions: { async contains(value) { state.calls.push(['permission', value.permissions[0]]); return state.grants; } }, system: { cpu: { async getInfo() { state.calls.push(['cpu']); return state.cpuCall ? state.cpuCall() : state.cpu; } }, memory: { async getInfo() { state.calls.push(['memory']); return state.memory; } } } };
  const metrics = createAutosurfMetrics(api, { now: () => state.time }); return { state, api, metrics, context };
}
test('first system sample has no fabricated CPU percentage, correctly scoped RAM and no GPU', async () => {
  const f = fixture(), result = await f.metrics.sample(f.context);
  assert.equal(result.systemCpuPercent, null); assert.equal(result.systemMemoryUsedBytes, 400); assert.equal(result.systemMemoryTotalBytes, 1000); assert.equal(result.gpuPercent, null); assert.equal(result.scope, 'system-and-renderer'); assert.equal(result.status, 'partial');
});
test('CPU utilization uses cumulative deltas, not the since-boot ratio', async () => {
  const f = fixture(); await f.metrics.sample(f.context); f.state.time += 10000; f.state.cpu = cpu(80, 120);
  assert.equal((await f.metrics.sample(f.context)).systemCpuPercent, 60);
});
test('CPU calculation aggregates logical processors with their actual time deltas', async () => {
  const f = fixture(); f.state.cpu.processors.push({ usage: { user: 50, kernel: 0, idle: 50, total: 100 } }); await f.metrics.sample(f.context);
  f.state.time += 10000; f.state.cpu = { processors: [{ usage: { user: 40, kernel: 0, idle: 160, total: 200 } }, { usage: { user: 90, kernel: 0, idle: 110, total: 200 } }] };
  assert.equal((await f.metrics.sample(f.context)).systemCpuPercent, 30);
});
test('CPU resets, count changes, clock reversal, long gaps and document changes yield null', async () => {
  for (const mutate of [f => { f.state.cpu = cpu(10, 10); }, f => { f.state.cpu.processors.push({ usage: { user: 10, kernel: 0, idle: 10, total: 20 } }); }, f => { f.state.time = 999; }, f => { f.state.time = 62000; }, f => { f.context.documentId = 'new-doc'; }]) {
    const f = fixture(); await f.metrics.sample(f.context); f.state.time += 10000; f.state.cpu = cpu(80, 120); mutate(f); assert.equal((await f.metrics.sample(f.context)).systemCpuPercent, null);
  }
});
test('reset explicitly invalidates CPU baseline across pauses and runs', async () => { const f = fixture(); await f.metrics.sample(f.context); f.state.time += 10000; f.state.cpu = cpu(80, 120); f.metrics.reset(); assert.equal((await f.metrics.sample(f.context)).systemCpuPercent, null); });
test('optional permission rejection does not query hardware', async () => { const f = fixture(); f.state.grants = false; const result = await f.metrics.sample(f.context); assert.equal(result.systemCpuPercent, null); assert.equal(result.systemMemoryUsedBytes, null); assert.equal(result.status, 'unsupported'); assert.equal(f.state.calls.some(row => row[0] === 'cpu' || row[0] === 'memory'), false); });
test('hardware identity getters and unrelated renderer fields are not read', async () => {
  const f = fixture(); Object.defineProperty(f.state.cpu, 'modelName', { get() { throw Error('must not read model'); } }); Object.defineProperty(f.state.cpu, 'features', { get() { throw Error('must not read features'); } });
  const renderer = { jsHeapBytes: 123, taskDurationMs: 40 }; Object.defineProperty(renderer, 'secret', { get() { throw Error('must not read secret'); } });
  const result = await f.metrics.sample(f.context, { sample: async () => renderer }); assert.equal(result.rendererJsHeapBytes, 123); assert.equal(result.rendererTaskDurationMs, 40); assert.ok(!JSON.stringify(result).includes('secret'));
});
test('invalid RAM and CPU samples stay null and cannot poison later valid baseline', async () => {
  const f = fixture(); f.state.memory = { capacity: 10, availableCapacity: 20 }; f.state.cpu = cpu(Number.NaN, 1); const first = await f.metrics.sample(f.context); assert.equal(first.systemCpuPercent, null); assert.equal(first.systemMemoryUsedBytes, null);
  f.state.cpu = cpu(20, 80); f.state.time += 10000; assert.equal((await f.metrics.sample(f.context)).systemCpuPercent, null);
  f.state.cpu = cpu(40, 160); f.state.time += 10000; assert.equal((await f.metrics.sample(f.context)).systemCpuPercent, 20);
});
test('timed-out hardware query retains physical capacity until underlying settlement', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const f = fixture(), pending = deferred(); f.state.cpuCall = () => pending.promise;
  const sampled = f.metrics.sample(f.context); await tick(); t.mock.timers.tick(2500); const first = await sampled; assert.equal(first.systemCpuPercent, null);
  await assert.rejects(f.metrics.sample(f.context), code('autosurf-busy')); assert.equal(f.state.calls.filter(row => row[0] === 'cpu').length, 1);
  pending.resolve(cpu(20, 80)); await tick(); f.state.cpuCall = null; f.state.time += 10000; assert.equal((await f.metrics.sample(f.context)).systemCpuPercent, null);
});
test('revocation during pending hardware query prevents all later API calls and results', async () => {
  const f = fixture(), pending = deferred(); f.state.cpuCall = () => pending.promise; const failed = assert.rejects(f.metrics.sample(f.context), code('autosurf-stale'));
  await tick(); f.state.live = false; pending.resolve(cpu(20, 80)); await failed; assert.equal(f.state.calls.some(row => row[0] === 'memory'), false);
});
test('unsupported browser reports null values without inventing CPU/GPU support', async () => { const metrics = createAutosurfMetrics({}, { now: () => 1000 }); assert.deepEqual(metrics.capabilities(), { systemCpu: false, systemMemory: false, renderer: false, gpu: false }); const result = await metrics.sample({ isCurrent: () => true }); assert.equal(result.status, 'unsupported'); assert.equal(result.gpuPercent, null); });
