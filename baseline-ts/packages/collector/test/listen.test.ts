import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL } from '@detect-expert/contracts';
import { ingestWindowMessage, startCollector } from '../src/index';
import { FakeEnv, obs, sensorBatch, sensorHello } from './fake-env';

const huge = 'x'.repeat(1024 * 1024);

function throwingProxy(): unknown {
  return new Proxy({}, { get() { throw new Error('hostile'); }, ownKeys() { throw new Error('hostile'); }, has() { throw new Error('hostile'); } });
}

/** Objects tagged with the bridge channel that must be rejected and counted. */
const malformed: [string, unknown][] = [
  ['1 MiB string as type', { channel: CHANNEL, sensorBootId: 'b', type: huge }],
  ['1 MiB sensorBootId', { channel: CHANNEL, sensorBootId: huge, type: 'sensor-hello' }],
  ['sensorBootId 65 chars', sensorHello('a'.repeat(65))],
  ['ui type on page channel', { channel: CHANNEL, sensorBootId: 'b', type: 'ui-export-preview', tabId: 1 }],
  ['unknown type', { channel: CHANNEL, sensorBootId: 'b', type: 'sensor-export' }],
  ['Symbol as type', { channel: CHANNEL, sensorBootId: 'b', type: Symbol('x') }],
  ['33 observations', sensorBatch('b', 1, Array.from({ length: 33 }, () => obs()))],
  ['empty observations', sensorBatch('b', 1, [])],
  ['observations not an array', sensorBatch('b', 1, { length: 1 } as unknown as unknown[])],
  ['nested object in observation', sensorBatch('b', 1, [{ ...obs(), count: { value: 1 } }])],
  ['nested array in signalCodes', sensorBatch('b', 1, [{ ...obs(), signalCodes: [['api-use']] }])],
  ['9 signal codes', sensorBatch('b', 1, [{ ...obs(), signalCodes: Array.from({ length: 9 }, (_, i) => 's' + String(i)) }])],
  ['513-char string in observation', sensorBatch('b', 1, [{ ...obs(), techniqueId: 'D'.repeat(513) }])],
  ['1 MiB string in signalCodes', sensorBatch('b', 1, [{ ...obs(), signalCodes: [huge] }])],
  ['Infinity count', sensorBatch('b', 1, [{ ...obs(), count: Infinity }])],
  ['NaN intervalBucket', sensorBatch('b', 1, [{ ...obs(), intervalBucket: NaN }])],
  ['float count', sensorBatch('b', 1, [{ ...obs(), count: 1.5 }])],
  ['negative count', sensorBatch('b', 1, [{ ...obs(), count: -1 }])],
  ['unknown techniqueId', sensorBatch('b', 1, [{ ...obs(), techniqueId: 'DET-999' }])],
  ['extra top-level key', { ...sensorBatch('b', 1, [obs()]), tabId: 7 }],
  ['tabId inside observation', sensorBatch('b', 1, [{ ...obs(), tabId: 7 }])],
  ['sensorSeq 0', sensorBatch('b', 0, [obs()])],
  ['function value', sensorBatch('b', 1, [{ ...obs(), count: () => 1 }])],
  ['hostile proxy', throwingProxy()],
];

/** Not addressed to the bridge: dropped without counting. */
const ignored: [string, unknown][] = [
  ['null', null],
  ['number', 42],
  ['string payload', 'sensor-batch'],
  ['array payload', [{ channel: CHANNEL }]],
  ['object without channel', { type: 'sensor-hello', sensorBootId: 'b' }],
  ['other channel', { channel: 'detect.expert/v2', type: 'sensor-hello', sensorBootId: 'b' }],
  ['bridge-hello echo', { channel: CHANNEL, sensorBootId: 'b', type: 'bridge-hello', protocolVersion: 1, bridgeSessionId: 's', paused: false }],
  ['bridge-stop forged by page', { channel: CHANNEL, sensorBootId: 'b', type: 'bridge-stop', reason: 'revoked' }],
];

describe('ingestWindowMessage gate', () => {
  it('accepts only the exact ADR-028 resource shape before forwarding to the shared validator', () => {
    const observation = obs({ techniqueId: 'DET-059', phase: 'settlement-unobserved',
      extensionResource: { target: 'lanfdkkpgfjfdikkncbnojekcppdebfp', method: 'fetch' } });
    expect(ingestWindowMessage(true, sensorBatch('boot', 1, [observation])).kind).toBe('sensor');
    for (const resource of [{ target: 'unknown', method: 'fetch', installed: true },
      { target: 'unknown', method: 'fetch', path: 'PRIVATE' }, { target: 'a'.repeat(32), method: 'fetch' },
      { target: { value: 'unknown' }, method: 'fetch' }, { target: 'unknown', method: ['fetch'] }]) {
      expect(ingestWindowMessage(true, sensorBatch('boot', 1, [{ ...observation, extensionResource: resource }])).kind).toBe('malformed');
    }
    expect(ingestWindowMessage(true, sensorBatch('boot', 1, [{ ...observation, apiOperation: 'WebAssembly.compile' }])).kind).toBe('malformed');
  });

  it('rejects wide observations before reading any values or later observations (F118)', () => {
    const wide: Record<string, unknown> = {};
    const read = vi.fn(() => 'short');
    for (let i = 0; i < 200_000; i++) Object.defineProperty(wide, 'key' + String(i), { enumerable: true, get: read });
    const later = new Proxy({}, { get: read });
    const started = performance.now();
    expect(ingestWindowMessage(true, sensorBatch('b', 1, [wide, later])).kind).toBe('malformed');
    expect(read).not.toHaveBeenCalled();
    console.log(`collector/wide-observation: 200k keys rejected in ${(performance.now() - started).toFixed(2)} ms; zero value reads`);
  });

  for (const [name, input] of malformed) {
    it('malformed: ' + name, () => {
      expect(ingestWindowMessage(true, input).kind).toBe('malformed');
    });
  }
  for (const [name, input] of ignored) {
    it('ignored: ' + name, () => {
      expect(ingestWindowMessage(true, input).kind).toBe('ignore');
    });
  }
  it('foreign source is ignored even when well-formed', () => {
    expect(ingestWindowMessage(false, sensorHello('b')).kind).toBe('ignore');
  });
  it('well-formed sensor-batch passes as a normalized copy (count saturated)', () => {
    const input = sensorBatch('b', 3, [obs({ count: 1e300 })]);
    const r = ingestWindowMessage(true, input);
    expect(r.kind).toBe('sensor');
    if (r.kind !== 'sensor' || r.message.type !== 'sensor-batch') throw new Error('unreachable');
    expect(r.message.observations[0]?.count).toBe(2147483647);
    expect(r.message).not.toBe(input);
  });
});

describe('collector drop accounting', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts every malformed message, forwards nothing, never throws', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    for (const [, input] of malformed) env.emit(input);
    for (const [, input] of ignored) env.emit(input);
    env.emit(sensorHello('other'), false);
    await vi.advanceTimersByTimeAsync(2000);
    const snap = c.snapshot();
    expect(snap.stats.droppedMalformed).toBe(malformed.length);
    expect(snap.stats.observationsAccepted).toBe(0);
    expect(snap.ringSize).toBe(0);
    // No malformed content is ever forwarded; the SW receives exactly one coverage-only `throttled` batch.
    expect(env.sent).toHaveLength(1);
    expect(env.sent[0]?.batch.observations).toEqual([]);
    expect(env.sent[0]?.batch.coverageDelta).toContain('throttled');
    expect(snap.sensorBootIds).toEqual(['b']);
  });

  it('replayed / out-of-order sensorSeq is dropped and counted; totals stay cumulative (max, never a sum)', async () => {
    const env = new FakeEnv();
    const c = startCollector(env);
    env.emit(sensorHello('b'));
    env.emit(sensorBatch('b', 5, [obs({ count: 2 })]));
    env.emit(sensorBatch('b', 5, [obs({ count: 9 })]));
    env.emit(sensorBatch('b', 4, [obs({ count: 9 })]));
    env.emit(sensorBatch('b', 6, [obs({ count: 3 })]));
    await vi.advanceTimersByTimeAsync(300);
    expect(c.snapshot().stats.droppedReplayed).toBe(2);
    expect(env.sent[0]?.batch.observations[0]?.count).toBe(3);
    expect(env.sent[0]?.batch.coverageDelta.sort()).toEqual(['channel-gap', 'throttled']);
  });
});
