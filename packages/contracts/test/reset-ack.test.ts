import { describe, expect, it } from 'vitest';
import { validateBridgeResetAck } from '../src/index';
import { compileSchema } from './helpers';

const good = () => ({ schemaVersion: 1, type: 'bridge-reset-ack', resetId: 'reset-1', bridgeSessionId: 'bridge-2', sensorBootIds: ['boot-2'] });

describe('native reset acknowledgment reader', () => {
  const schema = compileSchema('bridge-reset-ack.v1.schema.json');
  it('accepts the bounded data response and rejects empty, duplicate and oversized boot lists', () => {
    for (const sensorBootIds of [['boot-2'], ['boot-2', 'boot-3', 'boot-4', 'boot-5'], [], ['boot-2', 'boot-2'], ['a', 'b', 'c', 'd', 'e']]) {
      const input = { ...good(), sensorBootIds };
      expect(validateBridgeResetAck(input).ok).toBe(schema(input));
    }
  });
  it.each(['schemaVersion', 'type', 'resetId', 'bridgeSessionId', 'sensorBootIds'])('rejects a %s getter without evaluating it', key => {
    const input = good(); let reads = 0;
    Object.defineProperty(input, key, { enumerable: true, get() { reads++; return 'ignored'; } });
    expect(validateBridgeResetAck(input).ok).toBe(false); expect(reads).toBe(0);
  });
  it('rejects accessor elements and never invokes a supplied array iterator', () => {
    const accessor = good(); let reads = 0, iterations = 0;
    Object.defineProperty(accessor.sensorBootIds, '0', { enumerable: true, get() { reads++; return 'boot-2'; } });
    expect(validateBridgeResetAck(accessor).ok).toBe(false); expect(reads).toBe(0);
    const iterator = good();
    Object.defineProperty(iterator.sensorBootIds, Symbol.iterator, { value() { iterations++; throw Error('must not execute'); } });
    expect(validateBridgeResetAck(iterator).ok).toBe(false); expect(iterations).toBe(0);
  });
  it('rejects sparse arrays, extra properties and inherited required fields', () => {
    expect(validateBridgeResetAck({ ...good(), sensorBootIds: new Array(1) }).ok).toBe(false);
    expect(validateBridgeResetAck({ ...good(), sensorBootIds: Object.assign(['boot-2'], { extra: 'x' }) }).ok).toBe(false);
    expect(validateBridgeResetAck(Object.create(good())).ok).toBe(false);
  });
});
