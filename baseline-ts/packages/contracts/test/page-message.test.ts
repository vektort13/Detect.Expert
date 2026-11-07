import { describe, expect, it } from 'vitest';
import { CHANNEL, COVERAGE_FLAGS, MAX_COUNT, validateBridgeMessage, validateSensorMessage } from '../src/index';
import { compileSchema, id65, throwingProxy, unicode513, withOwnProtoKey } from './helpers';

type Json = Record<string, unknown>;

interface Case {
  name: string;
  input: unknown;
  expect: 'sensor' | 'bridge' | 'fail';
  saturates?: boolean;
  handOnly?: boolean;
}

const header: Json = { channel: CHANNEL, sensorBootId: 'boot-1' };
const obs: Json = {
  techniqueId: 'DET-007',
  count: 1,
  countQuality: 'sampled',
  phase: 'async-returned',
  signalCodes: ['readback-after-text', 'offline-render'],
  intervalBucket: 3,
};

const cases: Case[] = [
  { name: 'sensor-hello', input: { ...header, type: 'sensor-hello', protocolVersion: 1, startedLate: false, coverageFlags: [] }, expect: 'sensor' },
  { name: 'sensor-hello late with flags', input: { ...header, type: 'sensor-hello', protocolVersion: 2, startedLate: true, coverageFlags: ['late-start', 'unsupported-realm'] }, expect: 'sensor' },
  { name: 'sensor-batch', input: { ...header, type: 'sensor-batch', sensorSeq: 1, observations: [obs], coverageDelta: [] }, expect: 'sensor' },
  { name: 'sensor-status', input: { ...header, type: 'sensor-status', state: 'degraded', coverageFlags: ['budget-exceeded'], droppedSinceLast: 12 }, expect: 'sensor' },
  { name: 'sensor-status droppedSinceLast saturates', input: { ...header, type: 'sensor-status', state: 'active', coverageFlags: [], droppedSinceLast: 1e300 }, expect: 'sensor', saturates: true },
  { name: 'bridge-hello', input: { ...header, type: 'bridge-hello', protocolVersion: 1, bridgeSessionId: 'bridge-1', paused: true }, expect: 'bridge' },
  { name: 'bridge-pause', input: { ...header, type: 'bridge-pause' }, expect: 'bridge' },
  { name: 'bridge-resume', input: { ...header, type: 'bridge-resume' }, expect: 'bridge' },
  { name: 'bridge-stop', input: { ...header, type: 'bridge-stop', reason: 'protocol-mismatch' }, expect: 'bridge' },

  { name: 'null', input: null, expect: 'fail' },
  { name: 'array', input: [], expect: 'fail' },
  { name: 'string', input: 'sensor-hello', expect: 'fail' },
  { name: 'wrong channel', input: { channel: 'detect.expert/v2', sensorBootId: 'boot-1', type: 'bridge-pause' }, expect: 'fail' },
  { name: 'missing channel', input: { sensorBootId: 'boot-1', type: 'bridge-pause' }, expect: 'fail' },
  { name: 'missing sensorBootId', input: { channel: CHANNEL, type: 'bridge-pause' }, expect: 'fail' },
  { name: 'sensorBootId 65 chars', input: { channel: CHANNEL, sensorBootId: id65, type: 'bridge-pause' }, expect: 'fail' },
  { name: 'sensorBootId 513 unicode', input: { channel: CHANNEL, sensorBootId: unicode513, type: 'bridge-pause' }, expect: 'fail' },
  { name: 'unknown type', input: { ...header, type: 'sensor-export' }, expect: 'fail' },
  { name: 'page batch type', input: { ...header, type: 'sensor-events' }, expect: 'fail' },
  { name: 'ui type on page channel', input: { ...header, type: 'ui-clear' }, expect: 'fail' },
  { name: 'extra key', input: { ...header, type: 'bridge-pause', extra: 1 }, expect: 'fail' },
  { name: 'own __proto__ key', input: withOwnProtoKey({ ...header, type: 'bridge-pause' }, '__proto__'), expect: 'fail' },
  { name: 'sensor-hello protocolVersion -1', input: { ...header, type: 'sensor-hello', protocolVersion: -1, startedLate: false, coverageFlags: [] }, expect: 'fail' },
  { name: 'sensor-hello protocolVersion string', input: { ...header, type: 'sensor-hello', protocolVersion: '1', startedLate: false, coverageFlags: [] }, expect: 'fail' },
  { name: 'sensor-hello startedLate string', input: { ...header, type: 'sensor-hello', protocolVersion: 1, startedLate: 'no', coverageFlags: [] }, expect: 'fail' },
  { name: 'sensor-hello coverageFlags duplicate', input: { ...header, type: 'sensor-hello', protocolVersion: 1, startedLate: false, coverageFlags: ['paused', 'paused'] }, expect: 'fail' },
  { name: 'sensor-hello coverageFlags 16', input: { ...header, type: 'sensor-hello', protocolVersion: 1, startedLate: false, coverageFlags: [...COVERAGE_FLAGS, 'paused'] }, expect: 'fail' },
  { name: 'sensor-batch sensorSeq 0', input: { ...header, type: 'sensor-batch', sensorSeq: 0, observations: [obs], coverageDelta: [] }, expect: 'fail' },
  { name: 'sensor-batch sensorSeq 2^31', input: { ...header, type: 'sensor-batch', sensorSeq: MAX_COUNT + 1, observations: [obs], coverageDelta: [] }, expect: 'fail' },
  { name: 'sensor-batch empty observations', input: { ...header, type: 'sensor-batch', sensorSeq: 1, observations: [], coverageDelta: [] }, expect: 'fail' },
  { name: 'sensor-batch 33 observations', input: { ...header, type: 'sensor-batch', sensorSeq: 1, observations: Array.from({ length: 33 }, () => obs), coverageDelta: [] }, expect: 'fail' },
  { name: 'sensor-batch bad observation', input: { ...header, type: 'sensor-batch', sensorSeq: 1, observations: [{ ...obs, count: -1 }], coverageDelta: [] }, expect: 'fail' },
  { name: 'sensor-batch with batchSeq (ISOLATED field)', input: { ...header, type: 'sensor-batch', sensorSeq: 1, batchSeq: 1, observations: [obs], coverageDelta: [] }, expect: 'fail' },
  { name: 'sensor-status unknown state', input: { ...header, type: 'sensor-status', state: 'running', coverageFlags: [], droppedSinceLast: 0 }, expect: 'fail' },
  { name: 'sensor-status droppedSinceLast -1', input: { ...header, type: 'sensor-status', state: 'active', coverageFlags: [], droppedSinceLast: -1 }, expect: 'fail' },
  { name: 'bridge-hello missing bridgeSessionId', input: { ...header, type: 'bridge-hello', protocolVersion: 1, paused: true }, expect: 'fail' },
  { name: 'bridge-hello paused string', input: { ...header, type: 'bridge-hello', protocolVersion: 1, bridgeSessionId: 'b', paused: 'yes' }, expect: 'fail' },
  { name: 'bridge-stop unknown reason', input: { ...header, type: 'bridge-stop', reason: 'bored' }, expect: 'fail' },
  { name: 'bridge-stop missing reason', input: { ...header, type: 'bridge-stop' }, expect: 'fail' },
  { name: 'bridge-pause with reason', input: { ...header, type: 'bridge-pause', reason: 'unload' }, expect: 'fail' },
  { name: 'hostile proxy', input: throwingProxy(), expect: 'fail', handOnly: true },
];

describe('validateSensorMessage / validateBridgeMessage vs JSON Schema (page-message.v1)', () => {
  const ajvValidate = compileSchema('page-message.v1.schema.json');

  for (const c of cases) {
    it(c.name, () => {
      const sensor = validateSensorMessage(c.input);
      const bridge = validateBridgeMessage(c.input);
      expect(sensor.ok).toBe(c.expect === 'sensor');
      expect(bridge.ok).toBe(c.expect === 'bridge');
      if (c.handOnly) return;
      const handOk = sensor.ok || bridge.ok;
      const value = sensor.ok ? sensor.value : bridge.ok ? bridge.value : null;
      if (c.saturates) {
        expect(handOk).toBe(true);
        expect(ajvValidate(c.input)).toBe(false);
        expect(ajvValidate(value)).toBe(true);
        return;
      }
      expect(ajvValidate(c.input)).toBe(handOk);
      if (handOk) {
        expect(ajvValidate(value)).toBe(true);
        expect(value).toEqual(c.input as Json);
      }
    });
  }
});
