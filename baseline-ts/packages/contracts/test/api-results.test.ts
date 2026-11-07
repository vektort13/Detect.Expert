import { describe, expect, it, vi } from 'vitest';
import { API_RESULT_DEFINITIONS, API_RESULTS_CHANNEL, readApiResultEntries, readApiResultsBatch, readApiResultsControl,
  readApiResultsSnapshot, readApiResultsUiRequest } from '../src/api-results';
import { compileSchema } from './helpers';

const row = { operation: 'Screen.width', techniqueId: 'DET-029', phase: 'returned-sync', value: { kind: 'number', value: 1920 } };

describe('ADR-036 separate local result preview contract', () => {
  it('has unique fixed operation labels and accepts a technical result without adding an ordinary wire field', () => {
    expect(new Set(API_RESULT_DEFINITIONS.map(entry => entry.operation)).size).toBe(API_RESULT_DEFINITIONS.length);
    expect(readApiResultEntries([row])).toEqual([row]);
    expect(readApiResultsSnapshot({ rows: [row], truncated: false })).toEqual({ rows: [row], truncated: false });
  });

  it('rejects forbidden values, phase drift, unknown fields, duplicates and nonfinite numbers', () => {
    for (const invalid of [[row, row], [{ ...row, techniqueId: 'DET-025' }], [{ ...row, phase: 'threw-sync' }],
      [{ ...row, phase: 'settlement-unobserved' }], [{ ...row, operation: 'Document.cookie', techniqueId: 'DET-049' }],
      [{ ...row, url: 'https://secret.example/' }], [{ ...row, value: { kind: 'number', value: NaN } }],
      [{ ...row, value: { kind: 'number', value: -0 } }], [{ ...row, value: { kind: 'string', value: 'x'.repeat(257) } }],
      new Array(1), new Array(257).fill(row)]) expect(readApiResultEntries(invalid)).toBeNull();
    expect(readApiResultEntries([{ ...row, value: { kind: 'special-number', value: '-0' } }])).not.toBeNull();
  });

  it('does not invoke accessors in nested rows or arrays', () => {
    const touched = vi.fn();
    const poisoned = { ...row };
    Object.defineProperty(poisoned, 'value', { get: touched, enumerable: true });
    expect(readApiResultEntries([poisoned])).toBeNull();
    const array = [row];
    Object.defineProperty(array, 0, { get: touched, enumerable: true });
    expect(readApiResultEntries(array)).toBeNull();
    expect(touched).not.toHaveBeenCalled();
  });

  it('separates bounded page controls from privileged UI requests', () => {
    const control = { channel: API_RESULTS_CHANNEL, type: 'api-results-read', requestId: 'query-1', epoch: 0 };
    expect(readApiResultsControl(control)).toEqual(control);
    expect(readApiResultsControl({ ...control, epoch: -1 })).toBeNull();
    expect(readApiResultsControl({ ...control, type: 'ui-api-results' })).toBeNull();
    const ui = { schemaVersion: 1, type: 'ui-api-results', tabId: 7, frameId: 0, documentKey: '7:0:doc7' };
    expect(readApiResultsUiRequest(ui)).toEqual(ui);
    expect(readApiResultsUiRequest({ ...ui, rows: [row] })).toBeNull();
    const batch = { ...control, type: 'api-results-batch', batchSeq: 0, final: true, enabled: true, rows: [row], truncated: false };
    expect(readApiResultsBatch(batch)).toEqual(batch);
    expect(readApiResultsBatch({ ...batch, enabled: false })).toBeNull();
    expect(readApiResultsBatch({ ...batch, rows: new Array(33).fill(row) })).toBeNull();
  });

  it('agrees with the generated schema on operation, technique, phase and value restrictions', () => {
    const schema = compileSchema('api-results.v1.schema.json');
    const batch = { channel: API_RESULTS_CHANNEL, type: 'api-results-batch', requestId: 'query-1', epoch: 0,
      batchSeq: 0, final: true, enabled: true, rows: [row], truncated: false };
    expect(schema(batch)).toBe(true);
    for (const changes of [{ techniqueId: 'DET-025' }, { phase: 'settlement-unobserved' },
      { value: { kind: 'unobserved', reason: 'async' } }, { operation: 'NotSupported.value' },
      { value: { kind: 'number-array', values: [1, 2] } }, { value: { kind: 'string', value: 'x'.repeat(257) } }]) {
      const invalid = { ...batch, rows: [{ ...row, ...changes }] };
      expect(schema(invalid)).toBe(false);
      expect(readApiResultsBatch(invalid)).toBeNull();
    }
    for (const definition of API_RESULT_DEFINITIONS) {
      const phase = definition.asynchronous ? 'settlement-unobserved' : 'returned-sync';
      const value = definition.sensitive ? { kind: 'unobserved', reason: 'sensitive' } : definition.asynchronous ? { kind: 'unobserved', reason: 'async' } :
        definition.typeOnly ? { kind: 'unobserved', reason: 'unsupported' } : { kind: 'undefined' };
      const valid = { ...batch, rows: [{ operation: definition.operation, techniqueId: definition.techniqueId, phase, value }] };
      expect(schema(valid), definition.operation).toBe(true);
      expect(readApiResultsBatch(valid), definition.operation).not.toBeNull();
    }
  });
});