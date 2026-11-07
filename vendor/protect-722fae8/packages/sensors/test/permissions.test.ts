// Permissions sensor (DET-039, task E08-03, S05) on fake Permissions / PermissionStatus interfaces. The realm is a
// plain object with the interface constructors as own data properties, like `window`. Native-like getters brand-check
// through private fields. Covers: the query dictionary is never read (ADR-006 §3), the category switch, the
// unclassified paths, late capture (ADR-017 §2) and privacy: the state value and the name never leave (REQ-005).

import { describe, expect, it } from 'vitest';
import { SensorRuntime, installPermissionsSensor } from '../src/index';
import type { RuntimeSnapshot } from '../src/index';
import { bridgeHello, bridgeSimple, deliver, makeEnv } from './helpers';

const STATE_CANARY = 'CANARY-STATE-granted-77c1';
const NAME_CANARY = 'CANARY-NAME-perm-88d2';

interface Behavior {
  /** Value query() returns; default: a resolved native Promise of a status for 'geolocation'. */
  query: unknown;
  queryError: unknown;
  stateError: unknown;
  nameError: unknown;
  /** When set, the name getter returns this instead of the status name. */
  nameOverride: { value: unknown } | null;
}

interface Fakes {
  realm: Record<string, unknown>;
  behavior: Behavior;
  nameCalls: () => number;
  queryCalls: Array<{ thisArg: unknown; args: unknown[] }>;
  Permissions: new () => { query(...args: unknown[]): unknown };
  PermissionStatus: new (name: string, state: string) => { readonly state: string; readonly name: string };
}

function makeFakes(options?: { withName?: boolean }): Fakes {
  const behavior: Behavior = { query: null, queryError: null, stateError: null, nameError: null, nameOverride: null };
  let nameCalls = 0;
  const queryCalls: Fakes['queryCalls'] = [];
  // Brand of a status: WeakMap lookups never run a Proxy trap; a foreign receiver has no entry -> TypeError.
  const names = new WeakMap<object, string>();

  class PermissionStatus {
    #state: string;
    constructor(name: string, state: string) {
      this.#state = state;
      names.set(this, name);
    }
    get state(): string {
      if (behavior.stateError !== null) throw behavior.stateError;
      return this.#state;
    }
  }
  if (options?.withName !== false) {
    Object.defineProperty(PermissionStatus.prototype, 'name', {
      configurable: true,
      enumerable: true,
      get: function name(this: object): unknown {
        nameCalls++;
        const own = names.get(this);
        if (own === undefined) throw new TypeError('Illegal invocation');
        if (behavior.nameError !== null) throw behavior.nameError;
        return behavior.nameOverride !== null ? behavior.nameOverride.value : own;
      },
    });
  }

  class Permissions {
    query(...args: unknown[]): unknown {
      queryCalls.push({ thisArg: this, args });
      if (behavior.queryError !== null) throw behavior.queryError;
      if (behavior.query !== null) return behavior.query;
      return Promise.resolve(new PermissionStatus('geolocation', 'prompt'));
    }
  }

  return {
    realm: { Permissions, PermissionStatus },
    behavior,
    nameCalls: () => nameCalls,
    queryCalls,
    Permissions,
    PermissionStatus: PermissionStatus as unknown as Fakes['PermissionStatus'],
  };
}

function setup(options?: { startedLate?: boolean; withName?: boolean }) {
  const fake = makeEnv(options);
  const runtime = new SensorRuntime(fake.env);
  runtime.start();
  const fakes = makeFakes(options);
  const sensor = installPermissionsSensor(runtime, fakes.realm);
  return { fake, runtime, fakes, sensor };
}

function rows(snap: RuntimeSnapshot): string[] {
  return snap.counters.map((c) => [c.techniqueId, c.phase, c.signalCodes.join(','), c.operationCode ?? '-', c.count, c.countQuality].join(' '));
}

describe('installation', () => {
  it('hooks Permissions.query (method) and PermissionStatus.state (getter); the name getter stays native', () => {
    const fakes = makeFakes();
    const nameBefore = Object.getOwnPropertyDescriptor(fakes.PermissionStatus.prototype, 'name');
    const runtime = new SensorRuntime(makeEnv().env);
    const sensor = installPermissionsSensor(runtime, fakes.realm);
    expect(sensor.results.map((r) => r.status + ':' + r.kind + ':' + r.label)).toEqual(['installed:method:query', 'installed:getter:state']);
    expect(sensor.skipped).toEqual([]);
    expect(sensor.categories).toBe(true);
    expect(Object.getOwnPropertyDescriptor(fakes.PermissionStatus.prototype, 'name')).toEqual(nameBefore);
    expect(runtime.snapshot().flags).toEqual([]);
    expect(fakes.nameCalls()).toBe(0);
    expect(runtime.stop('local')).toMatchObject({ restored: ['query', 'state'], cleanup: 'complete' });
  });

  it('absent interfaces are skipped without a flag', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    const sensor = installPermissionsSensor(runtime, {});
    expect(sensor.results).toEqual([]);
    expect(sensor.skipped).toEqual(['Permissions', 'PermissionStatus']);
    expect(runtime.snapshot().flags).toEqual([]);
  });
});

describe('Permissions.query', () => {
  it('returns the same Promise, attaches no handler and records query / settlement-unobserved', () => {
    const { runtime, fakes } = setup();
    let thenCalls = 0;
    class CountingPromise<T> extends Promise<T> {
      override then<A = T, B = never>(onFulfilled?: ((value: T) => A | PromiseLike<A>) | null, onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
        thenCalls++;
        return super.then(onFulfilled, onRejected);
      }
    }
    const original = new CountingPromise<unknown>(() => { /* never settles */ });
    fakes.behavior.query = original;
    const permissions = new fakes.Permissions();
    const descriptor = { name: 'geolocation' };
    expect(permissions.query(descriptor)).toBe(original);
    expect(thenCalls).toBe(0);
    expect(fakes.queryCalls[0]!.thisArg).toBe(permissions);
    expect(fakes.queryCalls[0]!.args[0]).toBe(descriptor);
    expect(rows(runtime.snapshot())).toEqual(['DET-039 settlement-unobserved api-use query 1 exact']);
  });

  it('never reads the dictionary: a Proxy with every trap and a name getter are untouched', () => {
    const { runtime, fakes } = setup();
    const traps: string[] = [];
    const dictionary = new Proxy({}, {
      get: (_t, k) => { traps.push('get:' + String(k)); return undefined; },
      has: () => { traps.push('has'); return false; },
      getPrototypeOf: () => { traps.push('getPrototypeOf'); return null; },
      getOwnPropertyDescriptor: () => { traps.push('gOPD'); return undefined; },
      ownKeys: () => { traps.push('ownKeys'); return []; },
    });
    let getterReads = 0;
    const withGetter = { get name(): string { getterReads++; return 'camera'; } };
    const permissions = new fakes.Permissions();
    permissions.query(dictionary);
    permissions.query(withGetter);
    permissions.query();
    expect(traps).toEqual([]);
    expect(getterReads).toBe(0);
    expect(rows(runtime.snapshot())).toEqual(['DET-039 settlement-unobserved api-use query 3 exact']);
  });

  it('a synchronous exception propagates as the same instance and is counted threw-sync', () => {
    const { runtime, fakes } = setup();
    const error = new TypeError('Illegal invocation');
    fakes.behavior.queryError = error;
    let caught: unknown;
    try {
      new fakes.Permissions().query({ name: 'camera' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(error);
    expect(rows(runtime.snapshot())).toEqual(['DET-039 threw-sync api-use query 1 exact']);
  });
});

describe('PermissionStatus.state categories', () => {
  it.each([
    ['geolocation', 'state-location'],
    ['notifications', 'state-notifications'],
    ['push', 'state-notifications'],
    ['camera', 'state-media'],
    ['microphone', 'state-media'],
    ['display-capture', 'state-media'],
    ['speaker-selection', 'state-media'],
    ['captured-surface-control', 'state-media'],
    ['accelerometer', 'state-sensors'],
    ['gyroscope', 'state-sensors'],
    ['magnetometer', 'state-sensors'],
    ['ambient-light-sensor', 'state-sensors'],
    ['midi', 'state-midi'],
    ['clipboard-read', 'state-clipboard'],
    ['clipboard-write', 'state-clipboard'],
    ['persistent-storage', 'state-storage'],
    ['storage-access', 'state-storage'],
    ['top-level-storage-access', 'state-storage'],
    ['background-sync', 'state-storage'],
    ['periodic-background-sync', 'state-storage'],
    ['background-fetch', 'state-storage'],
    // Internal names Chromium 153 returns from PermissionStatus.name (S05 browser fact).
    ['video_capture', 'state-media'],
    ['audio_capture', 'state-media'],
    ['display_capture', 'state-media'],
    ['sensors', 'state-sensors'],
    ['clipboard_read', 'state-clipboard'],
    ['clipboard_write', 'state-clipboard'],
    ['durable_storage', 'state-storage'],
    ['background_sync', 'state-storage'],
    ['periodic_background_sync', 'state-storage'],
    ['background_fetch', 'state-storage'],
    ['screen_wake_lock', 'state-other'],
    ['local_fonts', 'state-other'],
    ['window-management', 'state-other'],
    ['GEOLOCATION', 'state-other'],
    ['geolocation ', 'state-other'],
    ['', 'state-other'],
    [NAME_CANARY, 'state-other'],
  ] as const)('%s -> %s; the state value and the name are not recorded', (name, op) => {
    const { fake, runtime, fakes } = setup();
    deliver(fake, bridgeHello(runtime));
    const status = new fakes.PermissionStatus(name, STATE_CANARY);
    expect(status.state).toBe(STATE_CANARY);
    expect(rows(runtime.snapshot())).toEqual(['DET-039 returned-sync api-use ' + op + ' 1 exact']);
    fake.advance(300);
    const wire = JSON.stringify(fake.posted) + JSON.stringify(runtime.snapshot());
    expect(wire).not.toContain(STATE_CANARY);
    expect(wire).not.toContain('granted');
    if (name.length > 0 && !op.includes(name)) expect(wire).not.toContain(name);
  });

  it('no name getter -> state-unclassified (the getter is a candidate fact, not assumed)', () => {
    const { runtime, fakes, sensor } = setup({ withName: false });
    expect(sensor.categories).toBe(false);
    expect(new fakes.PermissionStatus('camera', 'prompt').state).toBe('prompt');
    expect(rows(runtime.snapshot())).toEqual(['DET-039 returned-sync api-use state-unclassified 1 exact']);
    expect(runtime.snapshot().flags).toEqual([]);
  });

  it('a throwing name getter or a non-string name -> state-unclassified, without coercion', () => {
    const { runtime, fakes } = setup();
    const status = new fakes.PermissionStatus('camera', 'prompt');
    fakes.behavior.nameError = new Error('name failed');
    expect(status.state).toBe('prompt');
    fakes.behavior.nameError = null;
    const touched: string[] = [];
    const boxed = new String('camera');
    Object.defineProperty(boxed, 'toString', { value: () => { touched.push('toString'); return 'camera'; } });
    Object.defineProperty(boxed, 'valueOf', { value: () => { touched.push('valueOf'); return 'camera'; } });
    for (const value of [boxed, 42, null, undefined, { toString: () => { touched.push('object.toString'); return 'camera'; } }]) {
      fakes.behavior.nameOverride = { value };
      expect(status.state).toBe('prompt');
    }
    expect(touched).toEqual([]);
    expect(rows(runtime.snapshot())).toEqual(['DET-039 returned-sync api-use state-unclassified 6 exact']);
  });

  it('a throwing state read -> threw-sync, api-use, no operation; the same exception instance reaches the page', () => {
    const { runtime, fakes } = setup();
    const status = new fakes.PermissionStatus('camera', 'prompt');
    const error = new DOMException('gone', 'InvalidStateError');
    fakes.behavior.stateError = error;
    let caught: unknown;
    try {
      void status.state;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(error);
    expect(rows(runtime.snapshot())).toEqual(['DET-039 threw-sync api-use - 1 exact']);
    expect(fakes.nameCalls()).toBe(0);
  });

  it('a Proxy receiver throws TypeError from the original getter; no trap runs and nothing is classified', () => {
    const { runtime, fakes } = setup();
    const status = new fakes.PermissionStatus('camera', 'prompt');
    const traps: string[] = [];
    const proxy = new Proxy(status, { get: (_t, k) => { traps.push(String(k)); return undefined; }, getPrototypeOf: () => { traps.push('proto'); return null; } });
    const getter = Object.getOwnPropertyDescriptor(fakes.PermissionStatus.prototype, 'state')!.get!;
    expect(() => Reflect.apply(getter, proxy, [])).toThrow(TypeError);
    expect(traps).toEqual([]);
    expect(rows(runtime.snapshot())).toEqual(['DET-039 threw-sync api-use - 1 exact']);
  });
});

describe('late capture, pause and privacy', () => {
  it('late install: the name getter is never captured or called; every read is state-unclassified; hook-failed', () => {
    const { runtime, fakes, sensor } = setup({ startedLate: true });
    expect(sensor.categories).toBe(false);
    expect(new fakes.PermissionStatus('geolocation', 'granted').state).toBe('granted');
    expect(new fakes.PermissionStatus('camera', 'denied').state).toBe('denied');
    expect(fakes.nameCalls()).toBe(0);
    expect(rows(runtime.snapshot())).toEqual(['DET-039 returned-sync api-use state-unclassified 2 exact']);
    expect(runtime.snapshot().flags).toEqual(['late-start', 'hook-failed']);
    installPermissionsSensor(runtime, fakes.realm);
    expect(runtime.snapshot().flags).toEqual(['late-start', 'hook-failed']);
  });

  it('paused: originals run, nothing is recorded, the name getter is not called', () => {
    const { fake, runtime, fakes } = setup();
    deliver(fake, bridgeHello(runtime));
    deliver(fake, bridgeSimple(runtime, 'bridge-pause'));
    new fakes.Permissions().query({ name: 'camera' });
    expect(new fakes.PermissionStatus('camera', 'granted').state).toBe('granted');
    expect(fakes.nameCalls()).toBe(0);
    expect(runtime.snapshot().counters).toEqual([]);
  });

  it('states (granted / denied / prompt) and names never reach the wire', async () => {
    const { fake, runtime, fakes } = setup();
    deliver(fake, bridgeHello(runtime));
    const permissions = new fakes.Permissions();
    const status = (await permissions.query({ name: 'geolocation' })) as { state: string };
    expect(status.state).toBe('prompt');
    for (const [name, state] of [['camera', 'granted'], ['clipboard-read', 'denied'], ['persistent-storage', 'prompt']] as const) {
      expect(new fakes.PermissionStatus(name, state).state).toBe(state);
    }
    fake.advance(300);
    const observations = fake.batches().flatMap((b) => b.observations);
    expect(observations.map((o) => o.operationCode).sort()).toEqual(['query', 'state-clipboard', 'state-location', 'state-media', 'state-storage']);
    const wire = JSON.stringify(fake.posted);
    for (const secret of ['granted', 'denied', 'prompt', 'geolocation', 'camera', 'clipboard-read', 'persistent-storage']) {
      expect(wire.includes(secret), secret).toBe(false);
    }
  });
});
