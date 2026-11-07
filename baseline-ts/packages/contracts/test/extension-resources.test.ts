import { describe, expect, it, vi } from 'vitest';
import { EXTENSION_TARGET_IDS, EXTENSION_RESOURCE_METHODS, extensionResourceAllows, extensionTargetIndex, readExtensionResource, readExtensionResources } from '../src/extension-resources';
import { counterKey } from '../src/messages';
import { validatePageBatch } from '../src/validate';
import { loadSchema, makeAjv } from './helpers';

const schemaEngine = makeAjv();
const batchSchema = schemaEngine.compile(loadSchema('page-batch.v1.schema.json'));
const summarySchema = schemaEngine.compile({ $ref: 'urn:detect-expert:contracts:common:v1#/$defs/extensionResources' });

describe('ADR-028 bounded extension resource targets', () => {
  const target = 'lanfdkkpgfjfdikkncbnojekcppdebfp';
  it('has 128 fixed CWS targets and a separate unknown bucket', () => {
    expect(EXTENSION_TARGET_IDS).toHaveLength(128);
    expect(new Set(EXTENSION_TARGET_IDS).size).toBe(128);
    for (const id of EXTENSION_TARGET_IDS) expect(id).toMatch(/^[a-p]{32}$/);
    expect(extensionTargetIndex(target)).not.toBeNull();
    expect(extensionTargetIndex('unknown')).toBe(0);
    expect(extensionTargetIndex('a'.repeat(32))).toBeNull();
  });
  it('binds methods to API outcome phases and rejects mismatched techniques', () => {
    for (const method of EXTENSION_RESOURCE_METHODS) {
      const resource = { target, method } as const;
      expect(extensionResourceAllows(resource, 'DET-059', 'threw-sync')).toBe(true);
      expect(extensionResourceAllows(resource, 'DET-059', method.endsWith('-src') ? 'returned-sync' : 'settlement-unobserved')).toBe(true);
      expect(extensionResourceAllows(resource, 'DET-013', 'returned-sync')).toBe(false);
      expect(extensionResourceAllows(resource, 'DET-059', 'attempted')).toBe(false);
    }
  });
  it('refuses unverified IDs and extra fields without invoking getters', () => {
    expect(readExtensionResource({ target, method: 'fetch' })).toEqual({ target, method: 'fetch' });
    for (const value of [{ target: 'a'.repeat(32), method: 'fetch' }, { target, method: 'fetch', path: 'PRIVATE' }, { target, method: 'network' }]) {
      expect(readExtensionResource(value)).toBeNull();
    }
    const touched = vi.fn(() => target);
    expect(readExtensionResource({ get target() { return touched(); }, method: 'fetch' })).toBeNull();
    expect(touched).not.toHaveBeenCalled();
  });
  it('keeps exact unique bounded target/method/phase summaries', () => {
    const row = { target, method: 'fetch', phase: 'settlement-unobserved', count: 3, countQuality: 'exact' };
    expect(readExtensionResources([row])).toEqual([row]);
    for (const input of [[row, { ...row, count: 8 }], [{ ...row, installed: true }], [{ ...row, count: 0 }], [{ ...row, phase: 'returned-sync' }], new Array(1), Array(129).fill(row)]) {
      expect(readExtensionResources(input)).toBeNull();
    }
  });
  it('accepts only matching DET059 tuples and preserves the original generic counter key', () => {
    const observation = { techniqueId: 'DET-059', count: 1, countQuality: 'exact', phase: 'settlement-unobserved', signalCodes: ['api-use'], intervalBucket: 0,
      extensionResource: { target, method: 'fetch' } };
    const batch = { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'boot', bridgeSessionId: 'bridge', batchSeq: 1, coverageDelta: [], observations: [observation] };
    expect(validatePageBatch(batch)).toEqual({ ok: true, value: batch });
    for (const changes of [{ apiOperation: 'WebAssembly.compile' }, { techniqueId: 'DET-001' }, { phase: 'returned-sync' },
      { signalCodes: ['api-use', 'bfcache-restore'] }, { extensionResource: { target: 'a'.repeat(32), method: 'fetch' } }]) {
      expect(validatePageBatch({ ...batch, observations: [{ ...observation, ...changes }] }).ok).toBe(false);
    }
    expect(counterKey('DET-059', 'settlement-unobserved', ['api-use'])).toBe('DET-059|settlement-unobserved|api-use');
    expect(counterKey('DET-059', 'settlement-unobserved', ['api-use'], undefined, { target, method: 'fetch' }))
      .toBe('DET-059|settlement-unobserved|api-use|extension|' + target + '|fetch');
  });
  it('keeps generated schema parity for methods, metadata exclusivity and duplicate summaries', () => {
    for (const method of EXTENSION_RESOURCE_METHODS) for (const id of [target, 'unknown']) {
      const row = { target: id, method, phase: method.endsWith('-src') ? 'returned-sync' : 'settlement-unobserved', count: 1, countQuality: 'exact' };
      expect(summarySchema([row])).toBe(true);
      expect(summarySchema([row, { ...row, count: 2 }])).toBe(false);
      expect(readExtensionResources([row, { ...row, count: 2 }])).toBeNull();
      const observation = { techniqueId: 'DET-059', count: 1, countQuality: 'exact', phase: row.phase, signalCodes: ['api-use'], intervalBucket: 0,
        extensionResource: { target: id, method } };
      const batch = { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'boot', bridgeSessionId: 'bridge', batchSeq: 1, coverageDelta: [], observations: [observation] };
      expect(batchSchema(batch)).toBe(true); expect(validatePageBatch(batch).ok).toBe(true);
      for (const change of [{ apiOperation: 'WebAssembly.compile' }, { techniqueId: 'DET-013' }, { phase: 'attempted' }, { extensionResource: { target: 'PRIVATE', method } }]) {
        const input = { ...batch, observations: [{ ...observation, ...change }] };
        expect(batchSchema(input)).toBe(false); expect(validatePageBatch(input).ok).toBe(false);
      }
    }
  });
});