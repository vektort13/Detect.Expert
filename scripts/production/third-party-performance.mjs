// ADR-029: local synthetic measurements with the actual production observer/PSL.
import { performance } from 'node:perf_hooks';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { ThirdPartyObserver } from '../../apps/production-extension/third-party-observer.js';

const root = resolve(import.meta.dirname, '../..');
const compiled = await build({ entryPoints: [resolve(root, 'packages/attribution/src/index.ts')], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node24', logLevel: 'silent' });
const attribution = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const quantile = (values, q) => values.toSorted((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))];
const key = binding => `${binding.tabId}:${binding.frameId}:${binding.documentId}`;
function measure(totalBindings, deep) {
  const bindings = new Map(), tabs = new Map();
  for (let i = 0; i < totalBindings; ++i) {
    const tabId = 7 + Math.floor(i / 128), frameId = i % 128, documentId = 'document-' + i;
    const parentDocumentId = frameId === 0 ? null : deep ? 'document-' + (i - 1) : 'document-' + (i - frameId);
    const binding = { tabId, frameId, documentId, parentDocumentId, documentKey: `${tabId}:${frameId}:${documentId}`, host: 'example.com', documentLifecycle: 'active' };
    bindings.set(`${tabId}:${frameId}`, binding);
    if (frameId === 0) tabs.set(tabId, { activeTopDocumentKey: binding.documentKey });
  }
  const sourceFrames = totalBindings === 1 ? [bindings.get('7:0')] : Array.from({ length: 32 }, (_, index) => bindings.get('7:' + (deep ? 96 + index : index)));
  let now = 1700000000000;
  const runtime = { isReady: true, state: { bindings, tabs }, now: () => now, api: {}, scope: { hasDataConsent: true, accessReady: true, accessGeneration: 1, hasAnyHostAccess: () => true, isHostGrantedSync: () => true },
    canObserveNetworkDocument: documentKey => bindings.get(documentKey.slice(0, documentKey.lastIndexOf(':')))?.documentKey === documentKey };
  const observer = new ThirdPartyObserver(runtime, { host: attribution.toAsciiHost, redact: attribution.redactHost });
  let counter = 0;
  const batch = () => {
    for (let i = 0; i < 1000; ++i) {
      const frame = sourceFrames[i % sourceFrames.length];
      const details = { tabId: frame.tabId, frameId: frame.frameId, documentId: frame.documentId, requestId: 'request-' + counter++, documentLifecycle: 'active', type: i % 2 ? 'xmlhttprequest' : 'script', url: 'https://' + 'static.example.net/assets/customer/account.js?secret=BENCHMARK_CANARY', initiator: 'https://' + 'example.com/', statusCode: 200 };
      observer.observe(details, 'before'); observer.observe(details, 'completed');
    }
  };
  for (let i = 0; i < 5; ++i) batch();
  const samples = [], pruning = [];
  for (let i = 0; i < 30; ++i) {
    const start = performance.now(); batch(); samples.push(performance.now() - start);
    now += 1000;
    const pruneStart = performance.now(); observer.prune(true); pruning.push(performance.now() - pruneStart);
  }
  return { totalBindings, observedDocuments: observer.documents.size, ancestry: deep ? '128-level chain' : 'flat', requestsPerSample: 1000, phasesPerSample: 2000, warmupSamples: 5, measuredSamples: 30,
    totalMs: { median: quantile(samples, .5), p95: quantile(samples, .95) }, perPhaseMs: { median: quantile(samples, .5) / 2000, p95: quantile(samples, .95) / 2000 },
    explicitPruneMs: { median: quantile(pruning, .5), p95: quantile(pruning, .95) }, retainedRows: [...observer.documents.values()].reduce((n, entry) => n + entry.rows.size, 0), estimatedBytes: observer.bytes, pendingRequests: observer.pending.size, samplesMs: samples };
}
const result = { date: new Date().toISOString(), node: process.version, sourceHash: createHash('sha256').update(readFileSync(resolve(root, 'apps/production-extension/third-party-observer.js'))).digest('hex'),
  scope: 'Synthetic Node measurements of synchronous observer callbacks with real offline PSL; excludes browser, delivery, storage, timing bridge and UI.',
  cases: [measure(1, false), measure(1024, false), measure(1024, true)] };
const directory = resolve(root, 'test-results/production-1.1.0/inspection'); mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, 'third-party-performance.json'), JSON.stringify(result, null, 2) + '\n');
for (const item of result.cases) console.log(JSON.stringify({ totalBindings: item.totalBindings, observedDocuments: item.observedDocuments, ancestry: item.ancestry, totalMs: item.totalMs, perPhaseMs: item.perPhaseMs, explicitPruneMs: item.explicitPruneMs, retainedRows: item.retainedRows, estimatedBytes: item.estimatedBytes, pendingRequests: item.pendingRequests }));
