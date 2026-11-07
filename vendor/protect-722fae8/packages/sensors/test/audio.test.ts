// Web Audio sensor (DET-015/016, task E08-01, S05) on fake Web Audio interfaces. The realm is a plain object with
// the interface constructors as own data properties, like `window`. Native-like getters brand-check through
// private fields (a wrong receiver or a Proxy throws TypeError without running a trap). Covers wrapper semantics
// (REQ-002: same Promise, no .then), the connect linkage rule, late capture (ADR-017 §2) and privacy (REQ-005).

import { describe, expect, it } from 'vitest';
import { SensorRuntime, installAudioSensor } from '../src/index';
import type { RuntimeSnapshot } from '../src/index';
import { bridgeHello, bridgeSimple, deliver, makeEnv } from './helpers';

// Distinctive canaries: none of them may ever reach a posted message or the runtime snapshot.
const SAMPLE_CANARY = 0.31415926;
const LENGTH_CANARY = 77777;
const RATE_CANARY = 12345;
const FREQUENCY_CANARY = 9876.5;
const THRESHOLD_CANARY = -42.25;

interface Behavior {
  /** Value startRendering returns (default: a resolved native Promise). */
  render: unknown;
  error: unknown;
  /** When true, connect() without arguments returns instead of throwing (to reach the observer's args check). */
  lenientConnect: boolean;
}

interface Spy {
  getters: Record<'length' | 'frequency' | 'threshold' | 'context', number>;
  calls: Array<{ member: string; thisArg: unknown; args: unknown[] }>;
}

interface AudioFakes {
  realm: Record<string, unknown>;
  behavior: Behavior;
  spy: Spy;
  classes: {
    BaseAudioContext: new () => object;
    OfflineAudioContext: new (length?: number) => object;
    AudioContext: new () => object;
    AudioNode: new (ctx: object) => object;
    OscillatorNode: new (ctx: object) => object;
    DynamicsCompressorNode: new (ctx: object) => object;
    GainNode: new (ctx: object) => object;
    AnalyserNode: new (ctx: object) => object;
    AudioBuffer: new () => object;
  };
}

function makeAudio(): AudioFakes {
  const behavior: Behavior = { render: null, error: null, lenientConnect: false };
  const spy: Spy = { getters: { length: 0, frequency: 0, threshold: 0, context: 0 }, calls: [] };
  const note = (member: string, thisArg: unknown, args: unknown[]): void => {
    spy.calls.push({ member, thisArg, args });
  };

  class AudioBuffer {
    #data = new Float32Array([SAMPLE_CANARY, SAMPLE_CANARY]);
    get sampleRate(): number {
      return RATE_CANARY;
    }
    getChannelData(...args: unknown[]): Float32Array {
      note('getChannelData', this, args);
      if (behavior.error !== null) throw behavior.error;
      return this.#data;
    }
    copyFromChannel(...args: unknown[]): void {
      note('copyFromChannel', this, args);
      if (behavior.error !== null) throw behavior.error;
    }
  }

  class BaseAudioContext {
    #base = true;
    createOscillator(...args: unknown[]): object {
      note('createOscillator', this, args);
      if (behavior.error !== null) throw behavior.error;
      return this.#base ? new OscillatorNode(this) : {};
    }
    createDynamicsCompressor(...args: unknown[]): object {
      note('createDynamicsCompressor', this, args);
      if (behavior.error !== null) throw behavior.error;
      return new DynamicsCompressorNode(this);
    }
  }

  class OfflineAudioContext extends BaseAudioContext {
    #length: number;
    constructor(length = LENGTH_CANARY) {
      super();
      this.#length = length;
    }
    get length(): number {
      spy.getters.length++;
      return this.#length;
    }
    startRendering(...args: unknown[]): unknown {
      note('startRendering', this, args);
      if (behavior.error !== null) throw behavior.error;
      return behavior.render ?? Promise.resolve(new AudioBuffer());
    }
  }

  class AudioContext extends BaseAudioContext {}

  class AudioNode {
    #context: object;
    constructor(ctx: object) {
      this.#context = ctx;
    }
    get context(): object {
      spy.getters.context++;
      return this.#context;
    }
    connect(...args: unknown[]): unknown {
      note('connect', this, args);
      if (behavior.error !== null) throw behavior.error;
      if (args.length === 0 && !behavior.lenientConnect) throw new TypeError('1 argument required, but only 0 present.');
      return args.length > 0 ? args[0] : undefined;
    }
  }

  class OscillatorNode extends AudioNode {
    #frequency = { value: FREQUENCY_CANARY };
    get frequency(): object {
      spy.getters.frequency++;
      return this.#frequency;
    }
  }

  class DynamicsCompressorNode extends AudioNode {
    #threshold = { value: THRESHOLD_CANARY };
    get threshold(): object {
      spy.getters.threshold++;
      return this.#threshold;
    }
  }

  class GainNode extends AudioNode {}

  class AnalyserNode extends AudioNode {
    getFloatFrequencyData(...args: unknown[]): void {
      note('getFloatFrequencyData', this, args);
    }
    getByteFrequencyData(...args: unknown[]): void {
      note('getByteFrequencyData', this, args);
    }
    getFloatTimeDomainData(...args: unknown[]): void {
      note('getFloatTimeDomainData', this, args);
    }
    getByteTimeDomainData(...args: unknown[]): void {
      note('getByteTimeDomainData', this, args);
    }
  }

  const classes = { BaseAudioContext, OfflineAudioContext, AudioContext, AudioNode, OscillatorNode, DynamicsCompressorNode, GainNode, AnalyserNode, AudioBuffer };
  return { realm: { ...classes }, behavior, spy, classes: classes as unknown as AudioFakes['classes'] };
}

function setup(options?: { startedLate?: boolean }) {
  const fake = makeEnv(options);
  const runtime = new SensorRuntime(fake.env);
  runtime.start();
  const audio = makeAudio();
  const sensor = installAudioSensor(runtime, audio.realm);
  return { fake, runtime, audio, sensor };
}

/** "technique phase signals op count quality" rows in creation order. */
function rows(snap: RuntimeSnapshot): string[] {
  return snap.counters.map((c) => [c.techniqueId, c.phase, c.signalCodes.join(','), c.operationCode ?? '-', c.count, c.countQuality].join(' '));
}

const ALL_MEMBERS = [
  'startRendering',
  'createOscillator',
  'createDynamicsCompressor',
  'connect',
  'getChannelData',
  'copyFromChannel',
  'getFloatFrequencyData',
  'getByteFrequencyData',
  'getFloatTimeDomainData',
  'getByteTimeDomainData',
];

describe('installation', () => {
  it('early capture: ten method hooks, no getter or constructor hook, linkage on, no flag', () => {
    const { sensor, runtime, audio } = setup();
    expect(sensor.results.map((r) => r.status + ':' + r.label)).toEqual(ALL_MEMBERS.map((m) => 'installed:' + m));
    expect(sensor.skipped).toEqual([]);
    expect(sensor.linkage).toBe(true);
    expect(runtime.snapshot().flags).toEqual([]);
    // Constructors and the supplemental getters stay native (FOLLOWUPS item 10; install-disjoint.test.ts).
    expect(audio.realm['OfflineAudioContext']).toBe(audio.classes.OfflineAudioContext);
    for (const [cls, key] of [
      [audio.classes.OfflineAudioContext, 'length'],
      [audio.classes.OscillatorNode, 'frequency'],
      [audio.classes.DynamicsCompressorNode, 'threshold'],
      [audio.classes.AudioNode, 'context'],
    ] as const) {
      expect(Object.getOwnPropertyDescriptor(cls.prototype, key)!.get!.name).toBe('get ' + key);
    }
    expect(Object.values(audio.spy.getters)).toEqual([0, 0, 0, 0]);
  });

  it('absent interfaces and members are skipped without a coverage flag', () => {
    const fake = makeEnv();
    const runtime = new SensorRuntime(fake.env);
    const audio = makeAudio();
    const realm = { AudioBuffer: audio.classes.AudioBuffer };
    const sensor = installAudioSensor(runtime, realm);
    expect(sensor.results.map((r) => r.label)).toEqual(['getChannelData', 'copyFromChannel']);
    expect(sensor.skipped).toEqual(['OfflineAudioContext', 'BaseAudioContext', 'AudioNode', 'AnalyserNode']);
    expect(sensor.linkage).toBe(false);
    expect(runtime.snapshot().flags).toEqual([]);
  });

  it('a second install reuses the hooks and does not double count; stop restores every descriptor', () => {
    const { runtime, audio, sensor } = setup();
    const protos = Object.values(audio.classes).map((c) => c.prototype as object);
    const again = installAudioSensor(runtime, audio.realm);
    expect(again.results).toEqual(sensor.results);
    new audio.classes.AudioBuffer();
    (new audio.classes.AudioBuffer() as any).getChannelData(0);
    expect(rows(runtime.snapshot())).toEqual(['DET-016 returned-sync api-use get-channel-data 1 exact']);
    const fresh = makeAudio();
    const before = Object.values(fresh.classes).map((c) => Object.getOwnPropertyDescriptors(c.prototype));
    const r2 = new SensorRuntime(makeEnv().env);
    installAudioSensor(r2, fresh.realm);
    expect(r2.stop('local')).toMatchObject({ notRestored: [], cleanup: 'complete' });
    expect(Object.values(fresh.classes).map((c) => Object.getOwnPropertyDescriptors(c.prototype))).toEqual(before);
    expect(protos.length).toBe(9);
  });
});

describe('DET-015 offline graph', () => {
  it('oscillator -> compressor on an OfflineAudioContext, startRendering, getChannelData: codes, offline-render, phases', () => {
    const { runtime, audio } = setup();
    const ctx = new audio.classes.OfflineAudioContext(5000) as any;
    const osc = ctx.createOscillator();
    const comp = ctx.createDynamicsCompressor();
    osc.connect(comp);
    comp.connect(new audio.classes.GainNode(ctx)); // not an oscillator receiver: not recorded
    const rendered = ctx.startRendering();
    expect(rendered).toBeInstanceOf(Promise);
    (new audio.classes.AudioBuffer() as any).getChannelData(0);
    expect(rows(runtime.snapshot())).toEqual([
      'DET-015 returned-sync api-use,offline-render create-oscillator 1 exact',
      'DET-015 returned-sync api-use,offline-render create-dynamics-compressor 1 exact',
      'DET-015 returned-sync api-use,offline-render connect-osc-compressor 1 exact',
      'DET-015 settlement-unobserved api-use,offline-render start-rendering 1 exact',
      'DET-016 returned-sync api-use get-channel-data 1 exact',
    ]);
  });

  it('a realtime context: no offline-render; only an oscillator -> compressor connect is recorded', () => {
    const { runtime, audio } = setup();
    const ctx = new audio.classes.AudioContext() as any;
    const osc = ctx.createOscillator();
    const gain = new audio.classes.GainNode(ctx) as any;
    const comp = ctx.createDynamicsCompressor();
    osc.connect(gain);
    gain.connect(comp);
    comp.connect(gain);
    osc.connect(comp);
    osc.connect(comp, 0, 0);
    expect(rows(runtime.snapshot())).toEqual([
      'DET-015 returned-sync api-use create-oscillator 1 exact',
      'DET-015 returned-sync api-use create-dynamics-compressor 1 exact',
      'DET-015 returned-sync api-use connect-osc-compressor 2 exact',
    ]);
    // Every connect still reached the original exactly once with its own arguments.
    expect(audio.spy.calls.filter((c) => c.member === 'connect').map((c) => c.args.length)).toEqual([1, 1, 1, 1, 3]);
  });

  it('startRendering returns the very same Promise and never calls then/catch/finally on it', () => {
    const { runtime, audio } = setup();
    let thenCalls = 0;
    class CountingPromise<T> extends Promise<T> {
      override then<A = T, B = never>(onFulfilled?: ((value: T) => A | PromiseLike<A>) | null, onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
        thenCalls++;
        return super.then(onFulfilled, onRejected);
      }
    }
    const original = new CountingPromise<number>(() => { /* never settles: settlement is not observed */ });
    audio.behavior.render = original;
    const ctx = new audio.classes.OfflineAudioContext() as any;
    const returned = ctx.startRendering();
    expect(returned).toBe(original);
    expect(thenCalls).toBe(0);
    // A rejected original stays unhandled for the page (no handler attached by the wrapper).
    const rejection = new Error('render rejected');
    const rejected = Promise.reject(rejection);
    audio.behavior.render = rejected;
    expect(ctx.startRendering()).toBe(rejected);
    rejected.catch(() => { /* the test, not the wrapper, handles it */ });
    expect(rows(runtime.snapshot())).toEqual(['DET-015 settlement-unobserved api-use,offline-render start-rendering 2 exact']);
  });

  it('a synchronous exception propagates as the same instance and is counted threw-sync', () => {
    const { runtime, audio } = setup();
    const ctx = new audio.classes.OfflineAudioContext() as any;
    const error = new DOMException('closed', 'InvalidStateError');
    audio.behavior.error = error;
    expect(() => ctx.startRendering()).toThrow(error);
    let caught: unknown;
    try {
      ctx.createOscillator();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(error);
    expect(() => (new audio.classes.AudioBuffer() as any).getChannelData(0)).toThrow(error);
    expect(rows(runtime.snapshot())).toEqual([
      'DET-015 threw-sync api-use,offline-render start-rendering 1 exact',
      'DET-015 threw-sync api-use,offline-render create-oscillator 1 exact',
      'DET-016 threw-sync api-use get-channel-data 1 exact',
    ]);
  });

  it('connect without arguments never reads index 0 through the prototype chain (Object.prototype getter)', () => {
    const { runtime, audio } = setup();
    audio.behavior.lenientConnect = true;
    const ctx = new audio.classes.OfflineAudioContext() as any;
    const osc = ctx.createOscillator();
    let touched = 0;
    Object.defineProperty(Object.prototype, '0', {
      configurable: true,
      get() {
        touched++;
        return undefined;
      },
    });
    try {
      osc.connect();
    } finally {
      delete (Object.prototype as Record<string, unknown>)['0'];
    }
    expect(touched).toBe(0);
    expect(audio.spy.getters.threshold).toBe(0);
    expect(rows(runtime.snapshot())).toEqual(['DET-015 returned-sync api-use,offline-render create-oscillator 1 exact']);
  });

  it('a failed connect and Proxy receivers or arguments are not recorded and run no trap', () => {
    const { runtime, audio } = setup();
    const ctx = new audio.classes.OfflineAudioContext() as any;
    const osc = ctx.createOscillator();
    const comp = ctx.createDynamicsCompressor();
    const traps: string[] = [];
    const handler: ProxyHandler<object> = {
      get: (_t, k) => { traps.push('get:' + String(k)); return undefined; },
      has: () => { traps.push('has'); return false; },
      getPrototypeOf: () => { traps.push('getPrototypeOf'); return null; },
      getOwnPropertyDescriptor: () => { traps.push('gOPD'); return undefined; },
      ownKeys: () => { traps.push('ownKeys'); return []; },
    };
    const proxyComp = new Proxy(comp, handler);
    const proxyOsc = new Proxy(osc, handler);
    const connect = audio.classes.AudioNode.prototype as any;
    osc.connect(proxyComp);
    Reflect.apply(connect.connect, proxyOsc, [comp]);
    // The fake original brand-checks its receiver too (private field): the TypeError reaches the caller unchanged.
    expect(() => Reflect.apply(ctx.createOscillator, new Proxy(ctx, handler), [])).toThrow(TypeError);
    audio.behavior.error = new Error('connect failed');
    expect(() => osc.connect(comp)).toThrow('connect failed');
    expect(traps).toEqual([]);
    expect(rows(runtime.snapshot())).toEqual([
      'DET-015 returned-sync api-use,offline-render create-oscillator 1 exact',
      'DET-015 returned-sync api-use,offline-render create-dynamics-compressor 1 exact',
      'DET-015 threw-sync api-use create-oscillator 1 exact',
    ]);
  });
});

describe('DET-016 readout', () => {
  it('maps every readout method to its code; arguments and arrays are never touched', () => {
    const { runtime, audio } = setup();
    const ctx = new audio.classes.AudioContext();
    const analyser = new audio.classes.AnalyserNode(ctx) as any;
    const buffer = new audio.classes.AudioBuffer() as any;
    const traps: string[] = [];
    const target = new Proxy(new Float32Array(4), { get: (t, k) => { traps.push(String(k)); return Reflect.get(t, k); } });
    analyser.getFloatFrequencyData(target);
    analyser.getByteFrequencyData(target);
    analyser.getByteFrequencyData(target);
    analyser.getFloatTimeDomainData(target);
    analyser.getByteTimeDomainData(target);
    buffer.copyFromChannel(target, 0, 0);
    const data = buffer.getChannelData(1);
    expect(data).toBe(buffer.getChannelData(1));
    expect(traps).toEqual([]);
    expect(rows(runtime.snapshot())).toEqual([
      'DET-016 returned-sync api-use analyser-float-frequency 1 exact',
      'DET-016 returned-sync api-use analyser-byte-frequency 2 exact',
      'DET-016 returned-sync api-use analyser-float-time-domain 1 exact',
      'DET-016 returned-sync api-use analyser-byte-time-domain 1 exact',
      'DET-016 returned-sync api-use copy-from-channel 1 exact',
      'DET-016 returned-sync api-use get-channel-data 2 exact',
    ]);
    // Same this and the exact argument list reached the original once per call.
    const copy = audio.spy.calls.find((c) => c.member === 'copyFromChannel')!;
    expect(copy.thisArg).toBe(buffer);
    expect(copy.args[0]).toBe(target);
  });
});

describe('late capture (ADR-017 §2)', () => {
  it('takes no supplemental getter, does not hook connect, records no offline-render and adds hook-failed once', () => {
    const fake = makeEnv({ startedLate: true });
    const runtime = new SensorRuntime(fake.env);
    const audio = makeAudio();
    const connectBefore = Object.getOwnPropertyDescriptor(audio.classes.AudioNode.prototype, 'connect');
    const sensor = installAudioSensor(runtime, audio.realm);
    expect(runtime.earlyCaptureGuaranteed).toBe(false);
    expect(sensor.linkage).toBe(false);
    expect(sensor.results.map((r) => r.label)).toEqual(ALL_MEMBERS.filter((m) => m !== 'connect'));
    expect(Object.getOwnPropertyDescriptor(audio.classes.AudioNode.prototype, 'connect')).toEqual(connectBefore);
    const ctx = new audio.classes.OfflineAudioContext() as any;
    const osc = ctx.createOscillator();
    const comp = ctx.createDynamicsCompressor();
    osc.connect(comp);
    ctx.startRendering();
    (new audio.classes.AudioBuffer() as any).getChannelData(0);
    expect(audio.spy.getters).toEqual({ length: 0, frequency: 0, threshold: 0, context: 0 });
    expect(rows(runtime.snapshot())).toEqual([
      'DET-015 returned-sync api-use create-oscillator 1 exact',
      'DET-015 returned-sync api-use create-dynamics-compressor 1 exact',
      'DET-015 settlement-unobserved api-use,offline-render start-rendering 1 exact',
      'DET-016 returned-sync api-use get-channel-data 1 exact',
    ]);
    installAudioSensor(runtime, audio.realm);
    const flags = runtime.snapshot().flags;
    expect(flags.filter((f) => f === 'hook-failed')).toHaveLength(1);
    expect(flags).toContain('late-start');
  });
});

describe('pause and privacy', () => {
  it('paused: originals run, nothing is recorded', () => {
    const { fake, runtime, audio } = setup();
    deliver(fake, bridgeHello(runtime));
    deliver(fake, bridgeSimple(runtime, 'bridge-pause'));
    const ctx = new audio.classes.OfflineAudioContext() as any;
    ctx.createOscillator();
    ctx.startRendering();
    expect(audio.spy.calls).toHaveLength(2);
    expect(runtime.snapshot().counters).toEqual([]);
  });

  it('samples, length, sampleRate, frequency and threshold never reach the wire or the snapshot', async () => {
    const { fake, runtime, audio } = setup();
    deliver(fake, bridgeHello(runtime));
    const ctx = new audio.classes.OfflineAudioContext() as any;
    const osc = ctx.createOscillator();
    const comp = ctx.createDynamicsCompressor();
    osc.connect(comp);
    const buffer = (await ctx.startRendering()) as any;
    const samples = buffer.getChannelData(0) as Float32Array;
    expect(samples[0]).toBeCloseTo(SAMPLE_CANARY);
    fake.advance(300);
    const batches = fake.batches();
    expect(batches.length).toBeGreaterThan(0);
    const wire = JSON.stringify(fake.posted) + JSON.stringify(runtime.snapshot());
    for (const secret of ['0.314159', String(LENGTH_CANARY), String(RATE_CANARY), String(FREQUENCY_CANARY), String(THRESHOLD_CANARY), 'Float32Array']) {
      expect(wire.includes(secret), secret).toBe(false);
    }
    const observations = batches.flatMap((b) => b.observations);
    for (const o of observations) {
      expect(Object.keys(o).sort()).toEqual(['count', 'countQuality', 'intervalBucket', 'operationCode', 'phase', 'signalCodes', 'techniqueId']);
    }
    expect(observations.map((o) => o.operationCode).sort()).toEqual([
      'connect-osc-compressor',
      'create-dynamics-compressor',
      'create-oscillator',
      'get-channel-data',
      'start-rendering',
    ]);
  });

  it('an observer error is isolated: the page gets the original result', () => {
    const { runtime, audio } = setup();
    const ctx = new audio.classes.OfflineAudioContext() as any;
    const original = (runtime as unknown as { recordKey: (k: number) => void }).recordKey;
    (runtime as unknown as { recordKey: (k: number) => void }).recordKey = () => {
      throw new Error('observer failed');
    };
    try {
      const osc = ctx.createOscillator();
      expect(osc).toBeInstanceOf(audio.classes.OscillatorNode);
    } finally {
      (runtime as unknown as { recordKey: (k: number) => void }).recordKey = original;
    }
    expect(runtime.snapshot().observerErrors).toBe(1);
  });
});
