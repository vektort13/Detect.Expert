// Environment sensor (DET-025/026/029/032/033, task E08-02, S06) on fake Navigator / NavigatorUAData / Screen
// interfaces. The realm is a plain object with the interface constructors as own data properties, like `window`;
// native-like getters brand-check through a WeakSet (a foreign or Proxy receiver throws one TypeError instance and
// runs no Proxy trap). Covers: operation codes per member, identity of results (languages array, Promise), the
// hints argument is never read (Proxy without traps, REQ-002), absent [SecureContext] members, config modes
// (wrap / retire / off), retirement, pause and privacy: no value reaches a message or the snapshot (REQ-005).

import { describe, expect, it } from 'vitest';
import { FAMILY_CONFIG, SensorRuntime, installEnvironmentSensor } from '../src/index';
import type { FamilyConfig, RuntimeSnapshot } from '../src/index';
import { bridgeHello, deliver, makeEnv } from './helpers';

const UA_CANARY = 'CANARY-UA-3c9e1f7a';
const PLATFORM_CANARY = 'CANARY-PLATFORM-41d7';
const VENDOR_CANARY = 'CANARY-VENDOR-5a2c';
const LANGUAGE_CANARY = 'xx-CANARY-6b3e';
const BRAND_CANARY = 'CANARY-BRAND-7f10';
const HINT_CANARY = 'CANARY-HINT-architecture-82ab';
const SIZE_CANARY = 7919;
const DEPTH_CANARY = 31;
const CONCURRENCY_CANARY = 977;
const MEMORY_CANARY = 0.0625;
const ILLEGAL = new TypeError('Illegal invocation');

interface Options {
  /** Members to leave out (e.g. the [SecureContext] ones). */
  omit?: readonly string[];
  /** Omit the NavigatorUAData interface. */
  noUaData?: boolean;
  /** Members defined non-configurable. */
  frozen?: readonly string[];
  /** getHighEntropyValues throws this synchronously. */
  hintsThrow?: unknown;
}

interface Fakes {
  realm: Record<string, unknown>;
  navigator: Record<string, unknown>;
  uaData: Record<string, unknown> & { toJSON(): unknown; getHighEntropyValues(...args: unknown[]): unknown };
  screen: Record<string, unknown>;
  protos: { Navigator: object; NavigatorUAData: object; Screen: object };
  /** Calls of each original, by `Interface.member`. */
  calls: Record<string, number>;
  /** Arguments the original getHighEntropyValues received. */
  hintArgs: unknown[][];
  languages: readonly string[];
  promise: Promise<unknown>;
  thenCalls: () => number;
}

function makeFakes(options: Options = {}): Fakes {
  const calls: Record<string, number> = {};
  const branded = new WeakSet<object>();
  const omit = new Set(options.omit ?? []);
  const frozen = new Set(options.frozen ?? []);
  const define = (proto: object, iface: string, key: string, value: (self: object) => unknown): void => {
    if (omit.has(iface + '.' + key)) return;
    Object.defineProperty(proto, key, {
      configurable: !frozen.has(iface + '.' + key),
      enumerable: true,
      get: function (this: object): unknown {
        calls[iface + '.' + key] = (calls[iface + '.' + key] ?? 0) + 1;
        if (!branded.has(this)) throw ILLEGAL;
        return value(this);
      },
    });
  };

  const languages = Object.freeze([LANGUAGE_CANARY, 'en']);
  let thenCalls = 0;
  const promise = Promise.resolve({ architecture: HINT_CANARY });
  // An own `then` that counts: the wrapper must never attach a handler (docs/PROJECT_RULES.md boundary 2).
  Object.defineProperty(promise, 'then', {
    configurable: true,
    value: function (this: Promise<unknown>, ...args: Parameters<Promise<unknown>['then']>) {
      thenCalls++;
      return Promise.prototype.then.apply(this, args);
    },
  });
  const hintArgs: unknown[][] = [];

  class NavigatorUAData {
    constructor() { branded.add(this); }
    toJSON(): unknown {
      calls['NavigatorUAData.toJSON'] = (calls['NavigatorUAData.toJSON'] ?? 0) + 1;
      if (!branded.has(this)) throw ILLEGAL;
      return { brands: [BRAND_CANARY], mobile: false, platform: PLATFORM_CANARY };
    }
    getHighEntropyValues(...args: unknown[]): unknown {
      calls['NavigatorUAData.getHighEntropyValues'] = (calls['NavigatorUAData.getHighEntropyValues'] ?? 0) + 1;
      hintArgs.push(args);
      if (options.hintsThrow !== undefined) throw options.hintsThrow;
      return promise;
    }
  }
  define(NavigatorUAData.prototype, 'NavigatorUAData', 'brands', () => Object.freeze([{ brand: BRAND_CANARY, version: '153' }]));
  define(NavigatorUAData.prototype, 'NavigatorUAData', 'mobile', () => false);
  define(NavigatorUAData.prototype, 'NavigatorUAData', 'platform', () => PLATFORM_CANARY);
  const uaData = new NavigatorUAData();

  class Navigator {
    constructor() { branded.add(this); }
  }
  define(Navigator.prototype, 'Navigator', 'userAgent', () => UA_CANARY);
  define(Navigator.prototype, 'Navigator', 'platform', () => PLATFORM_CANARY);
  define(Navigator.prototype, 'Navigator', 'vendor', () => VENDOR_CANARY);
  define(Navigator.prototype, 'Navigator', 'language', () => LANGUAGE_CANARY);
  define(Navigator.prototype, 'Navigator', 'languages', () => languages);
  define(Navigator.prototype, 'Navigator', 'hardwareConcurrency', () => CONCURRENCY_CANARY);
  define(Navigator.prototype, 'Navigator', 'deviceMemory', () => MEMORY_CANARY);
  define(Navigator.prototype, 'Navigator', 'userAgentData', () => uaData);
  // Not part of the family: must stay untouched.
  define(Navigator.prototype, 'Navigator', 'webdriver', () => false);

  class Screen {
    constructor() { branded.add(this); }
  }
  for (const key of ['width', 'height', 'availWidth', 'availHeight']) define(Screen.prototype, 'Screen', key, () => SIZE_CANARY);
  define(Screen.prototype, 'Screen', 'colorDepth', () => DEPTH_CANARY);
  define(Screen.prototype, 'Screen', 'pixelDepth', () => DEPTH_CANARY);
  const orientation = { type: 'CANARY-ORIENTATION' };
  define(Screen.prototype, 'Screen', 'orientation', () => orientation);

  const realm: Record<string, unknown> = { Navigator, Screen };
  if (options.noUaData !== true) realm['NavigatorUAData'] = NavigatorUAData;
  return {
    realm,
    navigator: new Navigator() as unknown as Record<string, unknown>,
    uaData: uaData as unknown as Fakes['uaData'],
    screen: new Screen() as unknown as Record<string, unknown>,
    protos: { Navigator: Navigator.prototype, NavigatorUAData: NavigatorUAData.prototype, Screen: Screen.prototype },
    calls,
    hintArgs,
    languages,
    promise,
    thenCalls: () => thenCalls,
  };
}

function setup(options: Options = {}, config: FamilyConfig = FAMILY_CONFIG) {
  const fake = makeEnv();
  const runtime = new SensorRuntime(fake.env);
  runtime.start();
  deliver(fake, bridgeHello(runtime));
  const fakes = makeFakes(options);
  const sensor = installEnvironmentSensor(runtime, fakes.realm, config);
  return { fake, runtime, fakes, sensor };
}

function rows(snap: RuntimeSnapshot): string[] {
  return snap.counters.map((c) => [c.techniqueId, c.phase, c.signalCodes.join(','), c.operationCode ?? '-', c.count, c.countQuality].join(' ')).sort();
}

const NAVIGATOR_KEYS = ['userAgent', 'platform', 'vendor', 'language', 'languages', 'hardwareConcurrency', 'deviceMemory', 'userAgentData'];
const UA_DATA_GETTERS = ['brands', 'mobile', 'platform'];
const SCREEN_KEYS = ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth', 'orientation'];

/** Reads every member once (and calls both NavigatorUAData methods once). */
function readAll(fakes: Fakes, hints: unknown = ['architecture']): void {
  for (const key of NAVIGATOR_KEYS) void fakes.navigator[key];
  for (const key of UA_DATA_GETTERS) void fakes.uaData[key];
  fakes.uaData.toJSON();
  fakes.uaData.getHighEntropyValues(hints);
  for (const key of SCREEN_KEYS) void fakes.screen[key];
}

const FULL_ROWS = [
  'DET-025 returned-sync api-use language 1 exact',
  'DET-025 returned-sync api-use languages 1 exact',
  'DET-025 returned-sync api-use platform 1 exact',
  'DET-025 returned-sync api-use user-agent 1 exact',
  'DET-025 returned-sync api-use vendor 1 exact',
  'DET-026 returned-sync api-use ua-brands 1 exact',
  'DET-026 returned-sync api-use ua-mobile 1 exact',
  'DET-026 returned-sync api-use ua-platform 1 exact',
  'DET-026 returned-sync api-use ua-to-json 1 exact',
  'DET-026 returned-sync api-use user-agent-data 1 exact',
  'DET-026 settlement-unobserved api-use get-high-entropy-values 1 exact',
  'DET-029 returned-sync api-use avail-height 1 exact',
  'DET-029 returned-sync api-use avail-width 1 exact',
  'DET-029 returned-sync api-use color-depth 1 exact',
  'DET-029 returned-sync api-use height 1 exact',
  'DET-029 returned-sync api-use orientation 1 exact',
  'DET-029 returned-sync api-use pixel-depth 1 exact',
  'DET-029 returned-sync api-use width 1 exact',
  'DET-032 returned-sync api-use - 1 exact',
  'DET-033 returned-sync api-use - 1 exact',
];

describe('installation', () => {
  it('default FAMILY_CONFIG (S03: navigator and screen go -> wrap) hooks 20 members; other members stay native', () => {
    expect(FAMILY_CONFIG.navigatorGetters).toBe('wrap');
    expect(FAMILY_CONFIG.screenGetters).toBe('wrap');
    const fakes = makeFakes();
    const webdriver = Object.getOwnPropertyDescriptor(fakes.protos.Navigator, 'webdriver');
    const runtime = new SensorRuntime(makeEnv().env);
    const sensor = installEnvironmentSensor(runtime, fakes.realm);
    expect(sensor.results.map((r) => r.status + ':' + r.kind + ':' + r.label)).toEqual([
      ...NAVIGATOR_KEYS.map((k) => 'installed:getter:' + k),
      ...UA_DATA_GETTERS.map((k) => 'installed:getter:' + k),
      'installed:method:toJSON',
      'installed:method:getHighEntropyValues',
      ...SCREEN_KEYS.map((k) => 'installed:getter:' + k),
    ]);
    expect(sensor.skipped).toEqual([]);
    expect(sensor.off).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(fakes.protos.Navigator, 'webdriver')).toEqual(webdriver);
    // Getters stay accessors (no value slot), never data properties.
    for (const key of NAVIGATOR_KEYS) expect(Object.getOwnPropertyDescriptor(fakes.protos.Navigator, key)).not.toHaveProperty('value');
    expect(runtime.snapshot().flags).toEqual([]);
    expect(Object.values(fakes.calls).reduce((a, b) => a + b, 0)).toBe(0);
    const stopped = runtime.stop('local');
    expect(stopped.cleanup).toBe('complete');
    expect(stopped.restored).toHaveLength(20);
  });

  it('absent [SecureContext] members and interfaces are skipped without a coverage flag', () => {
    const { runtime, sensor } = setup({ omit: ['Navigator.deviceMemory', 'Navigator.userAgentData', 'Screen.orientation'], noUaData: true });
    expect(sensor.skipped).toEqual(['Navigator.deviceMemory', 'Navigator.userAgentData', 'NavigatorUAData', 'Screen.orientation']);
    expect(sensor.results.every((r) => r.status === 'installed')).toBe(true);
    expect(sensor.results).toHaveLength(6 + 6);
    expect(runtime.snapshot().flags).toEqual([]);
    const empty = installEnvironmentSensor(new SensorRuntime(makeEnv().env), {});
    expect(empty).toEqual({ results: [], skipped: ['Navigator', 'NavigatorUAData', 'Screen'], off: [] });
  });

  it('a present non-configurable member is reported (descriptor-nonconfigurable), the rest installs', () => {
    const { runtime, sensor, fakes } = setup({ frozen: ['Navigator.userAgent'] });
    expect(sensor.results.filter((r) => r.status === 'unsupported').map((r) => r.label)).toEqual(['userAgent']);
    expect(runtime.snapshot().flags).toEqual(['descriptor-nonconfigurable']);
    expect(fakes.navigator['userAgent']).toBe(UA_CANARY);
    expect(rows(runtime.snapshot())).toEqual([]);
  });

  it("'off' groups are not wrapped at all; the descriptors stay identical", () => {
    const fakes = makeFakes();
    const before = {
      nav: Object.getOwnPropertyDescriptors(fakes.protos.Navigator),
      ua: Object.getOwnPropertyDescriptors(fakes.protos.NavigatorUAData),
      screen: Object.getOwnPropertyDescriptors(fakes.protos.Screen),
    };
    const runtime = new SensorRuntime(makeEnv().env);
    const sensor = installEnvironmentSensor(runtime, fakes.realm, { ...FAMILY_CONFIG, navigatorGetters: 'off', screenGetters: 'off' });
    expect(sensor.results).toEqual([]);
    expect(sensor.off).toHaveLength(8 + 5 + 7);
    expect(sensor.off[0]).toBe('Navigator.userAgent');
    expect(Object.getOwnPropertyDescriptors(fakes.protos.Navigator)).toEqual(before.nav);
    expect(Object.getOwnPropertyDescriptors(fakes.protos.NavigatorUAData)).toEqual(before.ua);
    expect(Object.getOwnPropertyDescriptors(fakes.protos.Screen)).toEqual(before.screen);
    readAll(fakes);
    expect(rows(runtime.snapshot())).toEqual([]);
    // Screen alone may be on while navigator is off.
    const fakes2 = makeFakes();
    const runtime2 = new SensorRuntime(makeEnv().env);
    installEnvironmentSensor(runtime2, fakes2.realm, { ...FAMILY_CONFIG, navigatorGetters: 'off' });
    readAll(fakes2);
    expect(rows(runtime2.snapshot()).map((r) => r.split(' ')[0])).toEqual(SCREEN_KEYS.map(() => 'DET-029'));
  });
});

describe('observation', () => {
  it('every member records its own operation; DET-032/033 carry none; getHighEntropyValues is settlement-unobserved', () => {
    const { runtime, fakes } = setup();
    readAll(fakes);
    expect(rows(runtime.snapshot())).toEqual(FULL_ROWS);
    // Each original was called exactly once.
    for (const key of NAVIGATOR_KEYS) expect(fakes.calls['Navigator.' + key], key).toBe(1);
    for (const key of SCREEN_KEYS) expect(fakes.calls['Screen.' + key], key).toBe(1);
    expect(fakes.calls['NavigatorUAData.getHighEntropyValues']).toBe(1);
  });

  it('returns the original values: the same languages array, the same orientation object, the same Promise without a handler', () => {
    const { fakes } = setup();
    expect(fakes.navigator['languages']).toBe(fakes.languages);
    expect(fakes.navigator['languages']).toBe(fakes.languages);
    expect(fakes.navigator['userAgent']).toBe(UA_CANARY);
    expect(fakes.navigator['hardwareConcurrency']).toBe(CONCURRENCY_CANARY);
    expect(fakes.navigator['deviceMemory']).toBe(MEMORY_CANARY);
    expect(fakes.navigator['userAgentData']).toBe(fakes.uaData);
    expect(fakes.screen['orientation']).toBe(fakes.screen['orientation']);
    expect(fakes.screen['colorDepth']).toBe(DEPTH_CANARY);
    expect(fakes.uaData.getHighEntropyValues(['architecture'])).toBe(fakes.promise);
    expect(fakes.thenCalls()).toBe(0);
  });

  it('a foreign receiver gets the same TypeError instance; the call is counted threw-sync', () => {
    const { runtime, fakes } = setup();
    const getter = Object.getOwnPropertyDescriptor(fakes.protos.Navigator, 'userAgent')!.get!;
    let caught: unknown;
    try {
      Reflect.apply(getter, {}, []);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(ILLEGAL);
    expect(() => Reflect.apply(Object.getOwnPropertyDescriptor(fakes.protos.Screen, 'width')!.get!, Object.create(fakes.screen), [])).toThrow(ILLEGAL);
    expect(() => Reflect.apply(fakes.uaData.toJSON, {}, [])).toThrow(ILLEGAL);
    expect(rows(runtime.snapshot())).toEqual([
      'DET-025 threw-sync api-use user-agent 1 exact',
      'DET-026 threw-sync api-use ua-to-json 1 exact',
      'DET-029 threw-sync api-use width 1 exact',
    ]);
  });

  it('a Proxy receiver and a Proxy hints array run no trap; the hints reach the original unchanged', () => {
    const { runtime, fakes } = setup();
    const traps: string[] = [];
    const handler: ProxyHandler<object> = {
      get: (_t, k) => { traps.push('get:' + String(k)); return undefined; },
      has: () => { traps.push('has'); return false; },
      getPrototypeOf: () => { traps.push('getPrototypeOf'); return null; },
      getOwnPropertyDescriptor: () => { traps.push('gOPD'); return undefined; },
      ownKeys: () => { traps.push('ownKeys'); return []; },
      apply: () => { traps.push('apply'); return undefined; },
    };
    const hints = new Proxy([HINT_CANARY], handler);
    expect(fakes.uaData.getHighEntropyValues(hints)).toBe(fakes.promise);
    expect(fakes.uaData.getHighEntropyValues()).toBe(fakes.promise);
    expect(fakes.uaData.getHighEntropyValues(hints, 'extra')).toBe(fakes.promise);
    expect(fakes.hintArgs[0]![0]).toBe(hints);
    expect(fakes.hintArgs.map((a) => a.length)).toEqual([1, 0, 2]);
    const receiver = new Proxy({}, handler);
    expect(() => Reflect.get(fakes.protos.Navigator, 'languages', receiver)).toThrow(ILLEGAL);
    expect(traps).toEqual([]);
    expect(rows(runtime.snapshot())).toEqual([
      'DET-025 threw-sync api-use languages 1 exact',
      'DET-026 settlement-unobserved api-use get-high-entropy-values 3 exact',
    ]);
  });

  it('a synchronous exception of getHighEntropyValues propagates as the same instance and is threw-sync', () => {
    const error = new TypeError('sync failure');
    const { runtime, fakes } = setup({ hintsThrow: error });
    let caught: unknown;
    try {
      fakes.uaData.getHighEntropyValues(['model']);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(error);
    expect(rows(runtime.snapshot())).toEqual(['DET-026 threw-sync api-use get-high-entropy-values 1 exact']);
  });

  it('pause: reads while paused are neither recorded nor change what the page sees', () => {
    const { runtime, fakes } = setup();
    runtime.pause();
    readAll(fakes);
    expect(fakes.navigator['userAgent']).toBe(UA_CANARY);
    expect(rows(runtime.snapshot())).toEqual([]);
    runtime.resume();
    void fakes.navigator['userAgent'];
    expect(rows(runtime.snapshot())).toEqual(['DET-025 returned-sync api-use user-agent 1 exact']);
  });
});

describe('privacy (REQ-005)', () => {
  it('no value (UA canary, platform, vendor, languages, sizes, depth, concurrency, memory, brands, hints) leaves the realm', () => {
    const { fake, runtime, fakes } = setup();
    for (let i = 0; i < 3; i++) readAll(fakes, [HINT_CANARY]);
    fake.advance(1000);
    const batches = fake.batches();
    expect(batches.length).toBeGreaterThan(0);
    const wire = JSON.stringify(fake.posted) + JSON.stringify(runtime.snapshot());
    for (const canary of [UA_CANARY, PLATFORM_CANARY, VENDOR_CANARY, LANGUAGE_CANARY, BRAND_CANARY, HINT_CANARY, 'CANARY-ORIENTATION', 'architecture']) {
      expect(wire.includes(canary), canary).toBe(false);
    }
    for (const number of [SIZE_CANARY, CONCURRENCY_CANARY, MEMORY_CANARY]) expect(wire.includes(String(number)), String(number)).toBe(false);
    const observations = batches.flatMap((b) => b.observations);
    expect(new Set(observations.map((o) => o.techniqueId))).toEqual(new Set(['DET-025', 'DET-026', 'DET-029', 'DET-032', 'DET-033']));
    for (const o of observations) expect(Object.keys(o).sort()).toEqual(expect.arrayContaining(['count', 'phase', 'signalCodes', 'techniqueId']));
  });
});

describe("retirement ('retire' config)", () => {
  const RETIRE: FamilyConfig = Object.freeze({ ...FAMILY_CONFIG, navigatorGetters: 'retire', screenGetters: 'retire', retireAfter: 3 });

  it('a getter retires on the retireAfter-th read: native descriptor back, lower-bound count, count-0 marker', () => {
    const fakes = makeFakes();
    const original = Object.getOwnPropertyDescriptor(fakes.protos.Navigator, 'userAgent')!;
    const runtime = new SensorRuntime(makeEnv().env);
    installEnvironmentSensor(runtime, fakes.realm, RETIRE);
    const wrapper = Object.getOwnPropertyDescriptor(fakes.protos.Navigator, 'userAgent')!.get!;
    expect(wrapper).not.toBe(original.get);
    for (let i = 0; i < 2; i++) expect(fakes.navigator['userAgent']).toBe(UA_CANARY);
    expect(Object.getOwnPropertyDescriptor(fakes.protos.Navigator, 'userAgent')!.get).toBe(wrapper);
    expect(fakes.navigator['userAgent']).toBe(UA_CANARY);
    expect(Object.getOwnPropertyDescriptor(fakes.protos.Navigator, 'userAgent')).toEqual(original);
    // The restored getter is the original: reading through it records nothing.
    for (let i = 0; i < 5; i++) void fakes.navigator['userAgent'];
    // A reference to the wrapper saved before retirement still calls the original once and records nothing.
    expect(Reflect.apply(wrapper, fakes.navigator, [])).toBe(UA_CANARY);
    expect(fakes.calls['Navigator.userAgent']).toBe(3 + 5 + 1);
    expect(rows(runtime.snapshot())).toEqual([
      'DET-025 returned-sync api-use user-agent 3 lower-bound',
      'DET-025 returned-sync api-use,sample-budget-exceeded user-agent 0 lower-bound',
    ]);
    expect(runtime.stop('local').restored).toContain('userAgent');
  });

  it('getHighEntropyValues retires with a settlement-unobserved marker; DET-032 retires without an operation', () => {
    const { runtime, fakes } = setup({}, RETIRE);
    for (let i = 0; i < 4; i++) fakes.uaData.getHighEntropyValues(['model']);
    for (let i = 0; i < 4; i++) void fakes.navigator['hardwareConcurrency'];
    expect(rows(runtime.snapshot())).toEqual([
      'DET-026 settlement-unobserved api-use get-high-entropy-values 3 lower-bound',
      'DET-026 settlement-unobserved api-use,sample-budget-exceeded get-high-entropy-values 0 lower-bound',
      'DET-032 returned-sync api-use - 3 lower-bound',
      'DET-032 returned-sync api-use,sample-budget-exceeded - 0 lower-bound',
    ]);
    expect(fakes.calls['NavigatorUAData.getHighEntropyValues']).toBe(4);
    expect(fakes.thenCalls()).toBe(0);
  });

  it('I1: a retired settlement hook turns its threw-sync aggregate lower-bound as well', () => {
    const error = new TypeError('sync failure');
    const { runtime, fakes } = setup({ hintsThrow: error }, RETIRE);
    for (let i = 0; i < 3; i++) expect(() => fakes.uaData.getHighEntropyValues(['model'])).toThrow(error);
    const snapshot = rows(runtime.snapshot());
    expect(snapshot).toHaveLength(2);
    expect(snapshot).toEqual(expect.arrayContaining([
      'DET-026 threw-sync api-use get-high-entropy-values 3 lower-bound',
      'DET-026 settlement-unobserved api-use,sample-budget-exceeded get-high-entropy-values 0 lower-bound',
    ]));
  });
});
