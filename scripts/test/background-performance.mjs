// Bounded synthetic hot-path measurement; does not execute browser APIs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { backgroundSensorSupport, backgroundSensorRuntimeSource } from '../production/background-activity-runtime.mjs';

const root = resolve(import.meta.dirname, '../..'), directory = resolve(root, 'test-results/production-1.1.0/inspection');
for (const name of ['hook.main.js', 'hook.early.js']) assert.ok(readFileSync(resolve(root, 'apps/production-extension', name), 'utf8').includes(backgroundSensorRuntimeSource), name + ': exact runtime parity');
const collector = backgroundSensorSupport.createCollector(), operations = ['PushManager.subscribe', 'SyncManager.register', 'PeriodicSyncManager.register', 'ServiceWorkerContainer.register'];
const source = { attributionConfidence: 'exact-resource', script: { host: 'fixture.test', pathTemplate: '/main.js' } }, worker = { host: 'fixture.test', pathTemplate: '/sw.js' };
const batch = () => { for (let index = 0; index < 1000; index++) collector.record(operations[index % operations.length], 'async-returned', source, index % operations.length === 3 ? worker : null); };
for (let index = 0; index < 10; index++) { collector.reset(); batch(); }
const samples = [];
for (let index = 0; index < 30; index++) { collector.reset(); const start = performance.now(); batch(); samples.push((performance.now() - start) / 1000); const snapshot = collector.snapshot(); assert.equal(snapshot.rows.length, 4); assert.equal(snapshot.rows.reduce((sum, row) => sum + row.count, 0), 1000); assert.equal(snapshot.truncated, false); }
samples.sort((a, b) => a - b);
const evidence = { environment: 'Node ' + process.versions.node, fixture: 'Synthetic fixed operation labels and redacted resources; collector only, excludes native APIs and attribution stack cost', samples: 30, callsPerSample: 1000, medianMsPerCall: samples[15], p95MsPerCall: samples[Math.floor(samples.length * .95)], maximumMsPerCall: samples.at(-1), rowsPerSample: 4, noDroppedCalls: true, sha256: { runtime: createHash('sha256').update(readFileSync(resolve(root, 'scripts/production/background-activity-runtime.mjs'))).digest('hex'), serialized: createHash('sha256').update(backgroundSensorRuntimeSource).digest('hex') } };
assert.ok(evidence.p95MsPerCall < .1, 'bounded collector p95 under 0.1 ms');
mkdirSync(directory, { recursive: true }); writeFileSync(resolve(directory, 'background-collector-performance.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log('PASS: background collector 30 ×1000 calls, p95 ' + evidence.p95MsPerCall.toFixed(6) + ' ms/call');
