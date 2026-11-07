// Component microbenchmark: actual production recorder, no browser/network fixtures.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { runtimeSource } from '../production/pro-values-runtime.mjs';
import { proTechnicalRuntimeSource } from '../production/pro-technical-values-runtime.mjs';
import { readCookieSnapshot, normalizeProCookieMetadata, readLoaderRows, readTagManagerDocuments } from '../../packages/contracts/src/inspection.mjs';
import { readAdvancedPageFields } from '../../packages/contracts/src/advanced-inspection.mjs';
const root = new URL('../../', import.meta.url);
const background = readFileSync(new URL('apps/production-extension/background.js', root), 'utf8');
const contracts = background.slice(0, background.indexOf('// packages/attribution/src/psl-index.json')).replace(/^import[^\n]*\n/gm, '');
const hook = readFileSync(new URL('apps/production-extension/hook.main.js', root), 'utf8');
const first = hook.indexOf('// ADR-030 beacon MAIN sensor start'), last = hook.indexOf('// packages/sensors/src/runtime.ts', first);
const context = vm.createContext({ atob, btoa, TextEncoder, URL, readCookieSnapshot, normalizeProCookieMetadata, readLoaderRows, readTagManagerDocuments, readAdvancedPageFields });
vm.runInContext(contracts + '\n' + runtimeSource + '\nvar arrayPush = (array, value) => Array.prototype.push.call(array, value); var arraySlice = array => Array.prototype.slice.call(array);\n' + hook.slice(first, last) + '\n' + proTechnicalRuntimeSource + `
  var recorder = new ApiResultRecorder(true), projectorCalls = 0, inputReads = 0;
  var realm = { Intl, WebGLRenderingContext: { prototype: { getSupportedExtensions: Object } } };
  var projector = createProTechnicalProjector(realm, true, PRO_TECHNICAL_OPERATIONS, PRO_TECHNICAL_FIELDS);
  recorder.projectTechnical = (...args) => { projectorCalls++; return projector(...args); };
  var nativeIntl = new Intl.DateTimeFormat('en-US', { timeZone:'Asia/Dubai', dateStyle:'full', timeStyle:'long' }).resolvedOptions();
  var boundedVector = Array.from({length:1024}, (_, i) => 'EXT_fixture_' + i);
  var hostile = new Proxy({}, {getOwnPropertyDescriptor(){ inputReads++; throw Error('input inspected'); }});
  var disabled = () => recorder.recordPro('Intl.DateTimeFormat.resolvedOptions','returned-sync',hostile);
  var primitive = () => recorder.recordPro('Window.innerWidth','returned-sync',1440);
  var technical = () => recorder.recordPro('Intl.DateTimeFormat.resolvedOptions','returned-sync',nativeIntl);
  var bounded = () => recorder.recordPro('WebGLRenderingContext.getSupportedExtensions','returned-sync',boundedVector);
`, context);
function measure(fn) {
  for (let i = 0; i < 1000; i++) fn();
  const samples = [];
  for (let round = 0; round < 25; round++) {
    const start = performance.now();
    for (let i = 0; i < 2000; i++) fn();
    samples.push((performance.now() - start) / 2000);
  }
  samples.sort((a, b) => a - b);
  return { unit: 'ms/call', samples: 25, callsPerSample: 2000, median: samples[12], p95: samples[23] };
}
const proOff = measure(context.disabled);
assert.equal(context.projectorCalls, 0); assert.equal(context.inputReads, 0); assert.equal(context.recorder.proRows.size, 0);
context.recorder.proSession = 'component-benchmark';
const primitive = measure(context.primitive), intlTechnical = measure(context.technical), boundedTechnical = measure(context.bounded);
const stored = [...context.recorder.proRows.values()], vector = stored.find(row => row.operation === 'WebGLRenderingContext.getSupportedExtensions');
assert.ok(vector.value.truncated); assert.ok(vector.value.fields.length <= 128); assert.ok(context.recorder.proBytes <= 65536);
context.recorder.clearPro(); const previous = context.projectorCalls; context.disabled();
assert.equal(context.projectorCalls, previous); assert.equal(context.inputReads, 0);
const result = { date: new Date().toISOString(), componentOnly: true, fixture: 'Actual production ApiResultRecorder + native Node Intl; synthetic 1024-item extension array to exercise the 8KiB/128-field cap.', note: 'Excludes browser API execution, wrapper, IPC, storage and rendering; deduplicated repeated samples.', proOff, primitive, intlTechnical, boundedTechnical, proof: { proOffProjectorCalls: 0, proOffInputReads: 0, storedVariants: stored.length, boundedVectorFields: vector.value.fields.length, boundedVectorTruncated: vector.value.truncated, stopPreventsProjection: true } };
writeFileSync(new URL('.tmp/pro-technical-performance.json', root), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
