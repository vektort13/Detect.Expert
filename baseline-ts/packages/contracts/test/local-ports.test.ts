import { describe, expect, it, vi } from 'vitest';
import { readRequestedLocalPorts, REQUESTED_LOCAL_PORTS_LIMIT } from '../src/local-ports';
import { validatePageBatch } from '../src/validate';
import { makeAjv } from './helpers';

describe('ADR-031 requested local ports', () => {
  it('accepts only a sorted bounded set of browser-requested port numbers and explicit loss', () => {
    for (const ports of [[], [0, 80, 443, 3389, 65535], Array.from({ length: REQUESTED_LOCAL_PORTS_LIMIT }, (_, index) => index)]) {
      const value = { ports, truncated: false };
      expect(readRequestedLocalPorts(value)).toEqual(value);
      expect(readRequestedLocalPorts(value)?.ports).not.toBe(ports);
    }
    expect(readRequestedLocalPorts({ ports: [80], truncated: true })).toEqual({ ports: [80], truncated: true });
    expect(readRequestedLocalPorts({ ports: [443, 80], truncated: false })).toEqual({ ports: [80, 443], truncated: false });
  });

  it('rejects invalid numbers, duplicates, unbounded arrays and arbitrary data', () => {
    for (const ports of [[-1], [-0], [65536], [1.5], [NaN], [Infinity], ['80'], [80, 80], new Array(1),
      Array.from({ length: REQUESTED_LOCAL_PORTS_LIMIT + 1 }, (_, index) => index)]) {
      expect(readRequestedLocalPorts({ ports, truncated: false })).toBeNull();
    }
    for (const value of [null, [], { ports: [80] }, { ports: [80], truncated: 'false' },
      { ports: [80], truncated: false, host: 'PRIVATE_ADDRESS' }, { ports: [80], truncated: false, open: true }]) {
      expect(readRequestedLocalPorts(value)).toBeNull();
    }
  });

  it('does not invoke accessor fields or array elements', () => {
    const read = vi.fn(() => [80]);
    const value = { ports: [80], truncated: false };
    Object.defineProperty(value, 'ports', { get: read, enumerable: true });
    expect(readRequestedLocalPorts(value)).toBeNull();
    const ports = [80];
    Object.defineProperty(ports, '0', { get: read, enumerable: true });
    expect(readRequestedLocalPorts({ ports, truncated: false })).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('never permits a page to provide a browser-owned port list', () => {
    const observation = { techniqueId: 'DET-060', phase: 'attempted', signalCodes: ['api-use'], count: 1, countQuality: 'exact', intervalBucket: 0 };
    const batch = { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'boot', bridgeSessionId: 'bridge', batchSeq: 1,
      coverageDelta: [], observations: [observation] };
    expect(validatePageBatch(batch).ok).toBe(true);
    expect(validatePageBatch({ ...batch, requestedLocalPorts: { ports: [3389], truncated: false } }).ok).toBe(false);
    expect(validatePageBatch({ ...batch, observations: [{ ...observation, port: 3389 }] }).ok).toBe(false);
  });

  it('matches JSON Schema for list shape, bounds and browser-only report provenance', () => {
    const ajv = makeAjv();
    const schema = ajv.compile({ $ref: 'urn:detect-expert:contracts:common:v1#/$defs/requestedLocalPorts' });
    for (const value of [{ ports: [], truncated: true }, { ports: [443, 80], truncated: false },
      { ports: [0, 65535], truncated: false }, { ports: [80, 80], truncated: false }, { ports: [65536], truncated: true },
      { ports: [80], truncated: 0 }, { ports: [80], truncated: false, host: 'PRIVATE' },
      { ports: Array.from({ length: 129 }, (_, index) => index), truncated: true }]) {
      expect(schema(value)).toBe(readRequestedLocalPorts(value) !== null);
    }
    const projection = ajv.compile({ $ref: 'urn:detect-expert:contracts:common:v1#/$defs/reportProjection' });
    const report = { reportRevision: 1, documentKey: '7:0:document', host: null, coverageState: 'active', coverageFlags: [],
      techniques: [], findings: [], vendors: [], dropped: { observations: 0, batches: 0, findings: 0, hosts: 0, counters: 0, transport: 0 },
      observedSince: 1, scopeMode: 'all-sites', requestedLocalPorts: { ports: [80], truncated: false } };
    const technique = { techniqueId: 'DET-060', count: 1, countQuality: 'exact', phases: ['attempted'], signalCodes: ['api-use'],
      evidenceSource: 'browser-network', integrity: 'browser-observed', interpretation: 'api-use', interpretationConfidence: 'unassessed',
      attributionConfidence: 'frame-only', firstBucket: 0, lastBucket: 0 };
    expect(projection(report)).toBe(false);
    expect(projection({ ...report, techniques: [technique] })).toBe(true);
    expect(projection({ ...report, techniques: [{ ...technique, evidenceSource: 'page-hook', integrity: 'page-controlled' }] })).toBe(false);
  });
});