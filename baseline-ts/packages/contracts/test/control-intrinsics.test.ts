// F168: real control shape remains valid after MAIN collection poisoning, with zero calls to poisoned code.
import { expect, it } from 'vitest';
import { CHANNEL, validateBridgeMessage } from '../src/index';

it('validates a genuine stop using captured intrinsics after Set/Array tampering', () => {
  const define = Object.defineProperty;
  const has = Object.getOwnPropertyDescriptor(Set.prototype, 'has')!;
  const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
  const exec = Object.getOwnPropertyDescriptor(RegExp.prototype, 'exec')!;
  const message = { channel: CHANNEL, type: 'bridge-stop', sensorBootId: 'real', reason: 'revoked' };
  let calls = 0;
  let result;
  const trap = () => { calls++; throw new Error('poisoned'); };
  try {
    define(Set.prototype, 'has', { ...has, value: trap });
    define(Array.prototype, Symbol.iterator, { ...iterator, value: trap });
    define(RegExp.prototype, 'exec', { ...exec, value: trap });
    result = validateBridgeMessage(message);
  } finally {
    define(Set.prototype, 'has', has);
    define(Array.prototype, Symbol.iterator, iterator);
    define(RegExp.prototype, 'exec', exec);
  }
  expect(result).toEqual({ ok: true, value: message });
  expect(calls).toBe(0);
});
