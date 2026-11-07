import { describe, expect, it, vi } from 'vitest';
import { API_MECHANISMS, API_OPERATIONS, API_OPERATION_DEFINITIONS, apiOperationAllows, apiOperationDefinition, isApiOperation, readApiOperations } from '../src/api-operations';
import { TECHNIQUE_IDS } from '../src/technique-ids';
import { counterKey } from '../src/messages';
import { validatePageBatch } from '../src/validate';
import { compileSchema, makeAjv } from './helpers';

describe('ADR-029 finite API operation vocabulary', () => {
  it('contains bounded unique operations assigned to fixed mechanisms and existing technique IDs', () => {
    expect(API_OPERATIONS.length).toBeGreaterThan(80);
    expect(API_OPERATIONS.length).toBeLessThanOrEqual(512);
    expect(new Set(API_OPERATIONS).size).toBe(API_OPERATIONS.length);
    expect([...new Set(API_OPERATION_DEFINITIONS.map(definition => definition[2]))].sort()).toEqual([...API_MECHANISMS].sort());
    for (const [operation, techniqueId] of API_OPERATION_DEFINITIONS) {
      expect(operation.length).toBeLessThanOrEqual(64);
      expect(operation).toMatch(/^[A-Za-z][A-Za-z0-9.]+$/);
      expect(TECHNIQUE_IDS).toContain(techniqueId);
    }
  });

  it('binds precise operations to their technique and possible phases, not successful async completion', () => {
    expect(API_OPERATIONS[152]).toBe('PressureRecord.toJSON');
    expect(API_OPERATIONS[153]).toBe('Navigator.ml');
    expect(API_OPERATIONS[196]).toBe('MLGraphBuilder.dequantizeLinear');
    expect(API_OPERATIONS[197]).toBe('RTCRtpSender.getCapabilities');
    expect(apiOperationAllows('MLContext.opSupportLimits', 'DET-070', 'returned-sync')).toBe(true);
    expect(apiOperationAllows('MLContext.opSupportLimits', 'DET-014', 'returned-sync')).toBe(false);
    expect(apiOperationAllows('ML.createContext', 'DET-070', 'returned-sync')).toBe(false);
    expect(apiOperationAllows('ML.createContext', 'DET-070', 'settlement-unobserved')).toBe(true);
    expect(apiOperationAllows('GPUDevice.adapterInfo', 'DET-013', 'returned-sync')).toBe(true);
    expect(apiOperationAllows('GPUDevice.adapterInfo', 'DET-026', 'returned-sync')).toBe(false);
    expect(apiOperationAllows('WebAssembly.validate', 'DET-065', 'threw-sync')).toBe(true);
    expect(apiOperationAllows('WebAssembly.compile', 'DET-065', 'returned-sync')).toBe(false);
    expect(apiOperationAllows('WebAssembly.compile', 'DET-065', 'settlement-unobserved')).toBe(true);
    expect(apiOperationAllows('IdleDetector.start', 'DET-043', 'settlement-unobserved')).toBe(true);
    expect(apiOperationAllows('PressureObserver.takeRecords', 'DET-042', 'returned-sync')).toBe(true);
    expect(apiOperationDefinition('NavigatorUAData.getHighEntropyValues')).toEqual({ techniqueId: 'DET-026', mechanism: 'client-hints', kind: 'async-call' });
    expect(apiOperationDefinition('ScreenDetails.screens')).toEqual({ techniqueId: 'DET-031', mechanism: 'window-management', kind: 'get' });
  });

  it('rejects arbitrary strings and objects without coercion or property access', () => {
    const touched = vi.fn(() => { throw new Error('untrusted property read'); });
    const object = new Proxy({}, { get: touched, ownKeys: touched, getOwnPropertyDescriptor: touched });
    for (const candidate of [object, undefined, null, 1, '', 'constructor', '__proto__', 'GPUAdapter.requestAdapterInfo', 'x'.repeat(512)]) {
      expect(isApiOperation(candidate)).toBe(false);
    }
    expect(touched).not.toHaveBeenCalled();
  });

  it('reads old and new observations without changing old keys or accepting mismatched tuples', () => {
    const observation = { techniqueId: 'DET-013', phase: 'returned-sync', count: 2, countQuality: 'exact', signalCodes: ['api-use'], intervalBucket: 0 };
    const batch = { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'boot', bridgeSessionId: 'bridge', batchSeq: 1, coverageDelta: [], observations: [observation] };
    expect(validatePageBatch(batch).ok).toBe(true);
    const detailed = { ...observation, apiOperation: 'GPUDevice.adapterInfo' };
    expect(validatePageBatch({ ...batch, observations: [detailed] })).toEqual({ ok: true, value: { ...batch, observations: [detailed] } });
    for (const changes of [{ apiOperation: 'GPUAdapter.requestAdapterInfo' }, { apiOperation: undefined },
      { techniqueId: 'DET-026' }, { phase: 'settlement-unobserved' }, { signalCodes: [] },
      { signalCodes: ['api-use', 'numeric-diversity'] }, { result: 'GPU_CANARY' }]) {
      expect(validatePageBatch({ ...batch, observations: [{ ...detailed, ...changes }] }).ok).toBe(false);
    }
    expect(counterKey('DET-013', 'returned-sync', ['api-use'])).toBe('DET-013|returned-sync|api-use');
    expect(counterKey('DET-013', 'returned-sync', ['api-use'], 'GPUDevice.adapterInfo')).toBe('DET-013|returned-sync|api-use|GPUDevice.adapterInfo');
  });

  it('accepts only unique bounded summary pairs with exact own data fields', () => {
    const row = { apiOperation: 'Window.getScreenDetails', phase: 'settlement-unobserved', count: 1, countQuality: 'exact' };
    expect(readApiOperations([row])).toEqual([row]);
    expect(readApiOperations([row, { ...row, count: 2 }])).toBeNull();
    for (const input of [[{ ...row, phase: 'returned-sync' }], [{ ...row, count: 0 }], [{ ...row, count: NaN }],
      [{ ...row, value: 42 }], [{ ...row, countQuality: 'trusted' }], new Array(1), Array(129).fill(row)]) {
      expect(readApiOperations(input)).toBeNull();
    }
    const read = vi.fn(() => row.apiOperation);
    const poisoned = { ...row };
    Object.defineProperty(poisoned, 'apiOperation', { enumerable: true, get: read });
    expect(readApiOperations([poisoned])).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('matches JSON Schema on every defined operation and rejects identity or phase drift', () => {
    const schema = compileSchema('page-batch.v1.schema.json');
    for (const [apiOperation, techniqueId, , kind] of API_OPERATION_DEFINITIONS) {
      const observation = { techniqueId, apiOperation, count: 2, countQuality: 'exact', signalCodes: ['api-use'], intervalBucket: 0,
        phase: kind === 'async-call' ? 'settlement-unobserved' : 'returned-sync' };
      const batch = { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'boot', bridgeSessionId: 'bridge', batchSeq: 1, coverageDelta: [], observations: [observation] };
      expect(schema(batch), apiOperation + ': valid schema tuple').toBe(true);
      expect(validatePageBatch(batch).ok).toBe(true);
      for (const delta of [{ techniqueId: 'DET-001' }, { phase: 'attempted' }, { signalCodes: ['api-use', 'bfcache-restore'] }, { apiOperation: 'unknown' }]) {
        const invalid = { ...batch, observations: [{ ...observation, ...delta }] };
        expect(schema(invalid), apiOperation + ': invalid schema tuple').toBe(false);
        expect(validatePageBatch(invalid).ok).toBe(false);
      }
    }
  });

  it('matches summary schema uniqueness by operation and phase even when counts or qualities differ', () => {
    const schema = makeAjv().compile({ $ref: 'urn:detect-expert:contracts:common:v1#/$defs/apiOperations' });
    expect(schema([])).toBe(true);
    expect(readApiOperations([])).toEqual([]);
    for (const [apiOperation, , , kind] of API_OPERATION_DEFINITIONS) {
      const row = { apiOperation, phase: kind === 'async-call' ? 'settlement-unobserved' : 'returned-sync', count: 1, countQuality: 'exact' };
      for (const duplicate of [row, { ...row, count: 2 }, { ...row, countQuality: 'lower-bound' }]) {
        expect(schema([row, duplicate]), apiOperation).toBe(false);
        expect(readApiOperations([row, duplicate])).toBeNull();
      }
      const distinct = [row, { ...row, phase: 'threw-sync' }];
      expect(schema(distinct), apiOperation).toBe(true);
      expect(readApiOperations(distinct)).toEqual(distinct);
    }
  });
});
