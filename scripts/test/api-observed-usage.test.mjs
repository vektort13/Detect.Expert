import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { API_CONFIG_CATALOG } from '../../apps/production-extension/api-configuration.js';
import { WASM_SURFACES } from '../../apps/production-extension/webassembly-apis.js';
import {
  emptyObservedUsage, projectObservedUsage,
  API_OBSERVED_USAGE_OPERATION_MAP, API_OBSERVED_USAGE_TECHNIQUE_MAP,
} from '../../apps/production-extension/api-observed-usage.js';

const op = (apiOperation, count = 1, phase = 'returned-sync', countQuality = 'exact') => ({ apiOperation, count, phase, countQuality });
const technique = (techniqueId, count = 1, extra = {}) => ({ techniqueId, count, countQuality: 'exact', phases: ['returned-sync'], interpretation: 'api-use', ...extra });
const doc = (patch = {}, relation = 'same-origin') => ({ report: {
  reportRevision: 1, documentKey: '1:0:document-a', host: 'example.com', coverageState: 'active', coverageFlags: [], scopeMode: 'site', techniques: [], apiOperations: [], ...patch,
}, relation });
const usage = (patch, relation) => projectObservedUsage([doc(patch, relation)]);

test('E22-21: mapped operations exist in the current canonical registry and use catalogue IDs', async () => {
  const source = await readFile(new URL('../../baseline-ts/packages/contracts/src/api-operations.ts', import.meta.url), 'utf8');
  const registry = new Map([...source.matchAll(/\['([^']+)', '(DET-\d+)', '[^']+', '([^']+)'\]/g)].map(match => [match[1], { techniqueId: match[2], kind: match[3] }]));
  const review = JSON.parse(await readFile(new URL('../../packages/contracts/src/review-operations.json', import.meta.url), 'utf8'));
  for (const [operation, techniqueId, , kind] of review.operations) registry.set(operation, { techniqueId, kind });
  for (const surface of WASM_SURFACES) registry.set(surface.operation, { techniqueId: 'DET-065', kind: surface.kind });
  const ids = new Set([...API_CONFIG_CATALOG.map(entry => entry.id), 'webrtc-certificates']);
  const seen = new Set();
  for (const row of API_OBSERVED_USAGE_OPERATION_MAP) {
    assert.deepEqual(registry.get(row.operation), { techniqueId: row.techniqueId, kind: row.kind }, row.operation);
    assert.equal(seen.has(row.operation), false); seen.add(row.operation);
    for (const id of row.ids) assert.equal(ids.has(id), true, `${row.operation} -> ${id}`);
  }
  assert.equal(API_OBSERVED_USAGE_OPERATION_MAP.length, 380);
  for (const row of API_OBSERVED_USAGE_TECHNIQUE_MAP) assert.equal(ids.has(row.id), true);
});

test('E22-21: an exact Screen.width read does not light sibling screen fields or imply fingerprinting', () => {
  const result = usage({ apiOperations: [op('Screen.width', 3)], techniques: [technique('DET-029', 20)] });
  assert.deepEqual(Object.keys(result.byApi), ['screen-width']);
  assert.equal(result.byApi['screen-width'].count, 3);
  assert.equal(result.byApi['screen-width'].fingerprintPattern, false);
  assert.deepEqual(result.byApi['screen-width'].operations, ['Screen.width']);
});

test('E22-21: ambiguous aggregate families do not manufacture individual property/protocol activity', () => {
  const result = usage({ techniques: ['DET-003', 'DET-018', 'DET-019', 'DET-020', 'DET-021', 'DET-025', 'DET-029', 'DET-030', 'DET-032', 'DET-036', 'DET-042', 'DET-043', 'DET-046', 'DET-049', 'DET-053', 'DET-058', 'DET-064', 'DET-069'].map(id => technique(id, 17)) });
  assert.deepEqual(Object.keys(result.byApi), []);
});

test('E22-21: text drawing alone is not Canvas readback, ordinary readback is not a fingerprint pattern', () => {
  assert.equal(usage({ techniques: [technique('DET-003', 10, { signalCodes: ['text-drawn'] })] }).byApi['canvas-readback'], undefined);
  const row = usage({ techniques: [technique('DET-001', 2), technique('DET-002', 3)] }).byApi['canvas-readback'];
  assert.equal(row.count, 5); assert.equal(row.basis, 'technique'); assert.equal(row.fingerprintPattern, false);
});

test('E22-21: only a preexisting linked fingerprint-pattern interpretation enables the pattern flag', () => {
  const result = usage({ techniques: [technique('DET-001', 2, { interpretation: 'fingerprinting-pattern' }), technique('DET-040', 4)], apiOperations: [op('Screen.width')] });
  assert.equal(result.byApi['canvas-readback'].fingerprintPattern, true);
  assert.equal(result.byApi.battery.fingerprintPattern, false);
  assert.equal(result.byApi['screen-width'].fingerprintPattern, false);
  assert.equal(usage({ techniques: [technique('DET-001', 1, { interpretation: 'possible-fingerprinting' })] }).byApi['canvas-readback'].fingerprintPattern, false);
});

test('E22-21: exact and technique aggregates are alternative bases, never added to each other', () => {
  const row = usage({ apiOperations: [op('GPU.requestAdapter', 2, 'settlement-unobserved'), op('GPUAdapter.info', 3)], techniques: [technique('DET-013', 20), technique('DET-014', 7)] }).byApi.webgpu;
  assert.equal(row.count, 5); assert.equal(row.basis, 'operation');
  assert.deepEqual(row.operations, ['GPU.requestAdapter', 'GPUAdapter.info']);
  assert.equal(usage({ techniques: [technique('DET-013', 20), technique('DET-014', 7)] }).byApi.webgpu.count, 27);
});

test('E22-21: successful, thrown and async-unsettled operations keep their recorded semantics', () => {
  const result = usage({ apiOperations: [op('Screen.width', 2), op('Screen.width', 3, 'threw-sync'), op('GPU.requestAdapter', 4, 'settlement-unobserved')] });
  assert.equal(result.byApi['screen-width'].count, 5); assert.equal(result.byApi['screen-width'].attempted, true);
  assert.equal(result.byApi.webgpu.count, 4); assert.equal(result.byApi.webgpu.attempted, false);
  assert.equal(usage({ apiOperations: [op('GPU.requestAdapter', 5)] }).byApi.webgpu, undefined, 'async operation with a forged sync-success phase is unavailable');
});

test('E22-21: DTLS certificate facet requires exact certificate operations, never generic RTC/SDP/IDB activity', () => {
  const generic = usage({ apiOperations: [op('RTCPeerConnection'), op('RTCSessionDescription.sdp'), op('IDBObjectStore.put')], techniques: [technique('DET-057', 5)] });
  assert.equal(generic.byApi.webrtc.count, 2); assert.equal(generic.byApi['webrtc-certificates'], undefined);
  const row = usage({ apiOperations: [op('RTCPeerConnection.generateCertificate', 2, 'settlement-unobserved'), op('RTCCertificate.expires', 1), op('RTCCertificate.getFingerprints', 4)] }).byApi['webrtc-certificates'];
  assert.equal(row.count, 7); assert.equal(row.basis, 'operation');
});

test('E22-21: granular WebAssembly highlights its exact row and broad master, not every Wasm function', () => {
  const result = usage({ apiOperations: [op('WebAssembly.Memory.grow', 3)], techniques: [technique('DET-065', 90)] });
  assert.deepEqual(Object.keys(result.byApi), ['webassembly', 'webassembly-memory-grow']);
  assert.equal(result.byApi.webassembly.count, 3);
  assert.equal(result.byApi['webassembly-memory-grow'].count, 3);
  assert.deepEqual(Object.keys(usage({ techniques: [technique('DET-065', 90)] }).byApi), ['webassembly']);
});

test('E22-21: narrow Math signatures imply only the family; no function names or values are invented', () => {
  const row = usage({ techniques: [technique('DET-022', 2), technique('DET-023', 1)] }).byApi['math-transcendentals'];
  assert.equal(row.count, 3); assert.deepEqual(row.operations, []); assert.equal(row.fingerprintPattern, false);
});

test('E22-21: media, sensors, codecs and application APIs use precise operations rather than their broad DET family', () => {
  const result = usage({ apiOperations: [
    op('MediaDevices.enumerateDevices', 2, 'settlement-unobserved'), op('MediaDevices.getUserMedia', 3, 'settlement-unobserved'),
    op('RTCRtpSender.getCapabilities', 4), op('AudioDecoder.isConfigSupported', 5, 'settlement-unobserved'),
    op('MediaKeys.getStatusForPolicy', 6, 'settlement-unobserved'), op('Accelerometer', 7),
    op('PressureObserver', 8), op('Worker', 9), op('Document.cookie.get', 10),
  ] });
  for (const [id, count] of [['media-enumeration', 2], ['media-capture', 3], ['webrtc-codecs', 4], ['webcodecs-capabilities', 5], ['hdcp-policy', 6], ['generic-sensors', 7], ['compute-pressure', 8], ['dedicated-worker', 9], ['document-cookie', 10]]) assert.equal(result.byApi[id].count, count, id);
  for (const id of ['media-capabilities', 'encrypted-media', 'shared-worker', 'cookie-store', 'device-motion']) assert.equal(result.byApi[id], undefined, id);
});

test('E22-21: source party counts describe documents only; unrelated loaded scripts never acquire API attribution', () => {
  const report = { apiOperations: [op('Screen.width', 4)], hostEntries: [{ host: 'tracker.example', relation: 'cross-site', requestCount: 500 }], vendors: [{ host: 'tracker.example' }] };
  const row = usage(report).byApi['screen-width'];
  assert.equal(row.firstPartyCount, 4); assert.equal(row.thirdPartyCount, 0);
  assert.equal(row.sources[0].callerRelation, 'unknown'); assert.equal(row.sources[0].host, 'example.com');
  assert.equal(JSON.stringify(row).includes('tracker.example'), false);
});

test('E22-21: canonical relation is preserved; host inequality alone cannot produce third-party attribution', () => {
  const documents = [doc({ apiOperations: [op('Screen.width', 2)] }),
    doc({ documentKey: '1:1:child-a', host: 'other.example', apiOperations: [op('Screen.width', 3)] }, 'unknown'),
    doc({ documentKey: '1:2:child-b', host: 'example.com', apiOperations: [op('Screen.width', 5)] }, 'cross-site'),
    doc({ documentKey: '1:3:child-c', host: 'example.com', apiOperations: [op('Screen.width', 7)] }, 'same-site'),
    doc({ documentKey: '1:4:child-d', host: null, apiOperations: [op('Screen.width', 11)] }, 'opaque')];
  const row = projectObservedUsage(documents).byApi['screen-width'];
  assert.equal(row.count, 28); assert.equal(row.firstPartyCount, 9); assert.equal(row.thirdPartyCount, 5); assert.equal(row.unknownCount, 14);
  assert.equal(row.sources.length, 5); assert.ok(row.sources.every(source => source.callerRelation === 'unknown'));
});

test('E22-21: repeated documents and operation keys are not double counted; latest report revision wins', () => {
  const result = projectObservedUsage([doc({ apiOperations: [op('Screen.width', 99)] }), doc({ reportRevision: 2, apiOperations: [op('Screen.width', 3), op('Screen.width', 3)] }), doc({ apiOperations: [op('Screen.width', 77)] })]);
  assert.equal(result.documentCount, 1); assert.equal(result.byApi['screen-width'].count, 3); assert.equal(result.byApi['screen-width'].sources.length, 1);
});

test('E22-21: saturation and sampled/lower-bound quality remain visible', () => {
  assert.equal(usage({ apiOperations: [op('Screen.width', 2, 'returned-sync', 'sampled')] }).byApi['screen-width'].countQuality, 'sampled');
  const row = usage({ apiOperations: [op('Screen.width', 2147483647), op('Screen.width', 2, 'threw-sync')] }).byApi['screen-width'];
  assert.equal(row.count, 2147483647); assert.equal(row.countQuality, 'lower-bound');
  assert.equal(usage({ techniques: [technique('DET-040', 1, { countQuality: 'lower-bound' })] }).byApi.battery.countQuality, 'lower-bound');
});

test('E22-21: settings, raw results, arbitrary strings and unknown operations do not become observed evidence', () => {
  const result = usage({ apis: [{ id: 'hardware-concurrency', mode: 'custom', selected: 'value' }], apiResults: [{ operation: 'Screen.width', value: 1920 }], apiOperations: [op('Navigator.hardwareConcurrency'), op('Math.sin'), op('Screen.width.secret'), op('Screen.height', 0), op('Screen.availWidth', -1)], techniques: [technique('DET-999', 1)] });
  assert.deepEqual(Object.keys(result.byApi), []);
});

test('E22-21: disabled/inaccessible reports and non-ready states cannot resurrect old rows', () => {
  for (const coverageState of ['paused', 'no-access', 'unsupported']) assert.equal(usage({ coverageState, apiOperations: [op('Screen.width')] }).documentCount, 0);
  assert.equal(usage({ scopeMode: 'off', apiOperations: [op('Screen.width')] }).documentCount, 0);
  for (const status of ['loading', 'no-site', 'error', 'no-access', 'unsupported', 'paused']) {
    const result = projectObservedUsage([doc({ apiOperations: [op('Screen.width')] })], { status });
    assert.equal(result.status, status); assert.deepEqual(Object.keys(result.byApi), []);
  }
  assert.equal(emptyObservedUsage('invented').status, 'error');
});

test('E22-21: input getters are not invoked and malformed/coercing data cannot leak values', () => {
  let calls = 0; const bad = {};
  Object.defineProperty(bad, 'apiOperation', { get() { calls++; throw new Error('getter must not run'); } });
  const report = doc({ apiOperations: [bad, op('Screen.width', { valueOf() { calls++; return 5; } }), op('Screen.height', 2)] });
  Object.defineProperty(report.report, 'host', { get() { calls++; return 'secret.example'; } });
  const result = projectObservedUsage([report]);
  assert.equal(calls, 0); assert.deepEqual(Object.keys(result.byApi), ['screen-height']); assert.equal(result.byApi['screen-height'].sources[0].host, null);
  const array = []; Object.defineProperty(array, '0', { get() { calls++; return doc(); } });
  projectObservedUsage(array); assert.equal(calls, 0);
});

test('E22-21: work is bounded and partial limits are explicit, with no fabricated empty row', () => {
  const documents = Array.from({ length: 40 }, (_, index) => doc({ documentKey: `1:${index}:document`, apiOperations: [op('Screen.width')] }));
  const result = projectObservedUsage(documents);
  assert.equal(result.documentCount, 32); assert.equal(result.byApi['screen-width'].count, 32); assert.equal(result.truncated, true);
  const tooMany = usage({ apiOperations: [...Array.from({ length: 128 }, () => op('unknown-operation')), op('Screen.width', 99)] });
  assert.equal(tooMany.truncated, true); assert.deepEqual(Object.keys(tooMany.byApi), []);
  assert.equal(projectObservedUsage([], { truncated: true }).truncated, true);
});
