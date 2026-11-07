// F175 / REQ-006 / ADR-003: preserve permission limitations across the shared wire contract.
import { describe, expect, it } from 'vitest';
import { CHANNEL, COVERAGE_FLAGS, validatePageBatch, validateSensorMessage } from '../src/index';
import { compileSchema } from './helpers';

describe('F175 permission coverage flags', () => {
  const validateBatchSchema = compileSchema('page-batch.v1.schema.json');
  const validateMessageSchema = compileSchema('page-message.v1.schema.json');
  const observation = {
    techniqueId: 'DET-001', count: 1, countQuality: 'exact', phase: 'attempted',
    signalCodes: ['api-use'], intervalBucket: 0,
  };

  for (const flags of [
    ['network-limited'],
    ['frames-inaccessible'],
    ['network-limited', 'frames-inaccessible', 'paused', 'revoked', 'channel-gap'],
    [...COVERAGE_FLAGS],
  ]) {
    it(`preserves ${flags.join(', ')}`, () => {
      const batch = {
        schemaVersion: 1, type: 'sensor-events', sensorBootId: 'boot-1',
        bridgeSessionId: 'bridge-1', batchSeq: 1, observations: [observation], coverageDelta: flags,
      };
      const parsed = validatePageBatch(batch);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value.coverageDelta).toEqual(flags);
      expect(validateBatchSchema(batch)).toBe(true);

      const status = {
        channel: CHANNEL, type: 'sensor-status', sensorBootId: 'boot-1',
        state: 'degraded', coverageFlags: flags, droppedSinceLast: 0,
      };
      const message = validateSensorMessage(status);
      expect(message.ok).toBe(true);
      if (message.ok) expect(message.value).toEqual(status);
      expect(validateMessageSchema(status)).toBe(true);
    });
  }

  for (const flags of [
    ['network-limited', 'network-limited'],
    ['frames-inaccessible', 'frames-inaccessible'],
    ['network-unlimited'],
    [...COVERAGE_FLAGS, 'network-limited'],
  ]) {
    it(`rejects duplicate, unknown or excessive flags: ${flags.join(', ')}`, () => {
      const batch = {
        schemaVersion: 1, type: 'sensor-events', sensorBootId: 'boot-1',
        bridgeSessionId: 'bridge-1', batchSeq: 1, observations: [observation], coverageDelta: flags,
      };
      expect(validatePageBatch(batch).ok).toBe(false);
      expect(validateBatchSchema(batch)).toBe(false);
      const status = {
        channel: CHANNEL, type: 'sensor-status', sensorBootId: 'boot-1',
        state: 'degraded', coverageFlags: flags, droppedSinceLast: 0,
      };
      expect(validateSensorMessage(status).ok).toBe(false);
      expect(validateMessageSchema(status)).toBe(false);
    });
  }
});
