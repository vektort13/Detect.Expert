import { describe, expect, it } from 'vitest';
import { installTimingSensor } from '../src/timing';
import { SensorRuntime } from '../src/runtime';
import { PHASE_INDEX, SIGNAL_BIT, TECHNIQUE_INDEX } from '../src/codes';
import { makeEnv } from './helpers';

function setup() {
  const fake = makeEnv();
  const runtime = new SensorRuntime(fake.env);
  const calls: unknown[][] = [];
  const opaque = new Proxy({}, { get() { throw new Error('result inspected'); } });
  const error = new Proxy({}, { get() { throw new Error('error inspected'); } });
  class Performance {
    now(...args: unknown[]) { calls.push([this, ...args]); return -0; }
    mark(...args: unknown[]) { calls.push([this, ...args]); return opaque; }
    measure(...args: unknown[]) { calls.push([this, ...args]); throw error; }
    getEntries() { calls.push([this]); return opaque; }
  }
  const Date = { now(...args: unknown[]) { calls.push([this, ...args]); return NaN; } };
  const realm = { Performance, Date };
  installTimingSensor(runtime, realm);
  return { fake, runtime, calls, realm, opaque, error };
}

describe('DET-066 bounded passive timing observations', () => {
  it('installation does not query a clock and first clock reads are honestly sampled', () => {
    const s = setup();
    expect(s.calls).toEqual([]);
    expect(s.runtime.snapshot().counters).toEqual([]);
    expect(Object.is(new s.realm.Performance().now(), -0)).toBe(true);
    expect(Number.isNaN(s.realm.Date.now())).toBe(true);
    expect(s.calls).toHaveLength(2);
    expect(s.runtime.snapshot().counters).toEqual([expect.objectContaining({ techniqueId: 'DET-066', count: 2, countQuality: 'sampled', signalCodes: ['api-use'] })]);
  });

  it('one million timer calls execute the original one million times with bounded sampled counters', () => {
    const s = setup(); const performance = new s.realm.Performance();
    // Keep test memory bounded: count native calls independently instead of retaining a million argument lists.
    let nativeCalls = 0;
    class FastPerformance { now() { nativeCalls++; return 7; } }
    const runtime = new SensorRuntime(makeEnv().env);
    installTimingSensor(runtime, { Performance: FastPerformance });
    const fast = new FastPerformance();
    let resultsUnchanged = true;
    for (let i = 0; i < 1_000_000; i++) if (fast.now() !== 7) resultsUnchanged = false;
    expect(resultsUnchanged).toBe(true);
    expect(nativeCalls).toBe(1_000_000);
    expect(runtime.snapshot().counters).toEqual([expect.objectContaining({ count: 15625, countQuality: 'sampled' })]);
    for (let i = 0; i < 65; i++) performance.now();
    expect(s.calls).toHaveLength(65);
    expect(s.runtime.snapshot().counters[0]?.count).toBe(2);
  });

  it('records the first thrown clock call independently of successful sampling', () => {
    const fake = makeEnv(); const runtime = new SensorRuntime(fake.env);
    const error = {};
    class Performance { now(fail = false) { if (fail) throw error; return 1; } }
    installTimingSensor(runtime, { Performance });
    const p = new Performance(); p.now();
    let caught: unknown; try { p.now(true); } catch (value) { caught = value; }
    expect(caught).toBe(error);
    expect(runtime.snapshot().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'returned-sync', count: 1, countQuality: 'sampled' }),
      expect.objectContaining({ phase: 'threw-sync', count: 1, countQuality: 'sampled' }),
    ]));
  });

  it('marks/entries preserve opaque result and exception identity without reading names/details', () => {
    const s = setup(); const p = new s.realm.Performance();
    const options = new Proxy({}, { get() { throw new Error('detail read'); } });
    expect(p.mark('TIMING_MARK_CANARY', options)).toBe(s.opaque);
    expect(s.calls[0]?.[0] === p && s.calls[0]?.[2] === options).toBe(true);
    let caught: unknown; try { p.measure('TIMING_MEASURE_CANARY', options); } catch (value) { caught = value; }
    expect(caught === s.error).toBe(true);
    expect(p.getEntries()).toBe(s.opaque);
    expect(s.calls).toHaveLength(3);
    expect(s.runtime.snapshot().counters.map(c => c.countQuality)).toEqual(['exact', 'exact']);
    expect(JSON.stringify(s.runtime.snapshot())).not.toContain('TIMING_');
  });

  it('mixed exact API operations never upgrade a sampled counter back to exact', () => {
    const s = setup(); const p = new s.realm.Performance();
    p.now(); p.mark('CANARY'); p.getEntries();
    expect(s.runtime.snapshot().counters[0]).toMatchObject({ count: 3, countQuality: 'sampled' });
  });

  it('runtime-owned clocks and flush bookkeeping do not fabricate page timing observations', () => {
    const s = setup();
    s.fake.env.now();
    s.runtime.start();
    s.runtime.record(TECHNIQUE_INDEX['DET-032'], PHASE_INDEX['returned-sync'], SIGNAL_BIT['api-use']);
    s.fake.advance(500);
    expect(s.runtime.snapshot().counters.some(c => c.techniqueId === 'DET-066')).toBe(false);
    expect(s.calls).toEqual([]);
  });

  it('pause suppresses sampling and local stop restores owned methods', () => {
    const s = setup(); const p = new s.realm.Performance();
    const wrapper = p.now;
    s.runtime.pause(); p.now();
    expect(s.runtime.snapshot().counters).toEqual([]);
    s.runtime.resume(); p.now();
    expect(s.runtime.snapshot().counters[0]?.count).toBe(1);
    s.runtime.stop('local'); p.now();
    expect(p.now).not.toBe(wrapper);
    expect(s.runtime.snapshot().counters[0]?.count).toBe(1);
    expect(s.calls).toHaveLength(3);
  });

  it('does not invoke hostile constructors and does not replace frozen clocks or foreign wrappers', () => {
    const fake = makeEnv(); const runtime = new SensorRuntime(fake.env);
    class Performance { now() { return 1; } }
    Object.defineProperty(Performance.prototype, 'now', { configurable: false });
    const realm = { Performance };
    Object.defineProperty(realm, 'Date', { get() { throw new Error('constructor getter'); } });
    installTimingSensor(runtime, realm);
    expect(runtime.snapshot().flags).toContain('descriptor-nonconfigurable');
    const s = setup(); const foreign = () => 1;
    s.realm.Performance.prototype.now = foreign;
    s.runtime.stop('revoked');
    expect(s.realm.Performance.prototype.now).toBe(foreign);
  });
});
