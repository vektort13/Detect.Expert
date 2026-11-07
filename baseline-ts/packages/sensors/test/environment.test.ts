import { describe, expect, it, vi } from 'vitest';
import { API_OPERATION_DEFINITIONS } from '@detect-expert/contracts';
import { API_OPERATION_INDEX } from '../src/codes';
import { SensorRuntime } from '../src/runtime';
import { installEnvironmentSensor } from '../src/environment';
import { makeEnv } from './helpers';

function setup() {
  const runtime = new SensorRuntime(makeEnv().env);
  const calls: string[] = [];
  const value = new Proxy({}, { get() { throw new Error('result must not be read'); } });
  const realm: Record<string, unknown> = {};
  const subjects: Record<string, object> = {};
  const add = (name: string, keys: string[]) => {
    const Constructor = class {};
    for (const key of keys) Object.defineProperty(Constructor.prototype, key, { configurable: true,
      get() { calls.push(name + '.' + key); return value; } });
    realm[name] = Constructor; subjects[name] = new Constructor();
    return Constructor.prototype as Record<string, unknown>;
  };
  const navigator = add('Navigator', ['userAgent', 'platform', 'vendor', 'language', 'languages', 'userAgentData',
    'plugins', 'mimeTypes', 'pdfViewerEnabled', 'webdriver', 'hardwareConcurrency', 'deviceMemory', 'maxTouchPoints', 'connection']);
  add('Screen', ['width', 'height', 'orientation', 'isExtended']);
  add('ScreenOrientation', ['angle', 'type']);
  add('VisualViewport', ['width', 'scale']);
  add('BatteryManager', ['charging', 'chargingTime', 'dischargingTime', 'level']);
  add('NetworkInformation', ['effectiveType', 'rtt', 'downlink', 'saveData']);
  const ua = add('NavigatorUAData', ['brands', 'mobile', 'platform']);
  const date = add('Date', []);
  const intl = add('DateTimeFormat', []);
  realm['Intl'] = { DateTimeFormat: realm['DateTimeFormat'] };
  const promise = Promise.resolve();
  let promiseReads = 0;
  Object.defineProperties(promise, { then: { get() { promiseReads++; throw new Error('then'); } }, catch: { get() { promiseReads++; throw new Error('catch'); } } });
  ua['getHighEntropyValues'] = function (...args: unknown[]) { calls.push('UA.method'); return { receiver: this, args, promise }; };
  navigator['getBattery'] = function () { calls.push('battery.method'); return promise; };
  date['getTimezoneOffset'] = function () { calls.push('date.method'); return -0; };
  intl['resolvedOptions'] = function () { calls.push('intl.method'); return value; };
  realm['getScreenDetails'] = function () { calls.push('screen.method'); return promise; };
  realm['matchMedia'] = function (...args: unknown[]) { calls.push('media.method'); return { receiver: this, args }; };
  realm['CSS'] = { supports(...args: unknown[]) { calls.push('css.method'); return args; } };
  Object.defineProperty(realm, 'innerWidth', { configurable: true, get() { calls.push('Window.innerWidth'); return NaN; } });
  const sensor = installEnvironmentSensor(runtime, realm);
  return { runtime, realm, subjects, navigator, ua, date, intl, calls, value, promise, promiseReads: () => promiseReads, sensor };
}

describe('environment facts / DET-025..038/040/041', () => {
  it.each(['screenX', 'screenY', 'screenLeft', 'screenTop'])('%s records a read without retaining window coordinates', key => {
    const runtime = new SensorRuntime(makeEnv().env);
    const realm = {};
    const original = vi.fn(() => -1927);
    Object.defineProperty(realm, key, { configurable: true, get: original });
    installEnvironmentSensor(runtime, realm);
    expect(original).not.toHaveBeenCalled();
    expect(Reflect.get(realm, key)).toBe(-1927);
    expect(original).toHaveBeenCalledOnce();
    expect(runtime.snapshot().counters).toEqual([expect.objectContaining({ techniqueId: 'DET-030', count: 1, phase: 'returned-sync', signalCodes: ['api-use'] })]);
    expect(JSON.stringify(runtime.snapshot())).not.toContain('-1927');
    runtime.stop('local');
    expect(Object.getOwnPropertyDescriptor(realm, key)?.get).toBe(original);
  });

  it.each(['throw', 'spoof'] as const)('missing operation keys ignore inherited %s getters', mode => {
    const inherited = vi.fn(() => {
      if (mode === 'throw') throw new Error('page prototype getter');
      return API_OPERATION_INDEX['GPUAdapter.info'];
    });
    const keys = ['Navigator.userAgent', 'Window.matchMedia'];
    let runtime: SensorRuntime | undefined;
    try {
      for (const key of keys) Object.defineProperty(Object.prototype, key, { get: inherited, configurable: true });
      const fixture = setup(); runtime = fixture.runtime;
      Reflect.get(fixture.subjects['Navigator']!, 'userAgent');
      Reflect.apply(fixture.realm['matchMedia'] as Function, fixture.realm, []);
      expect(inherited).not.toHaveBeenCalled();
      expect(runtime.snapshot().counters.map(counter => counter.techniqueId)).toEqual(['DET-025', 'DET-037']);
      expect(runtime.snapshot().counters.every(counter => counter.apiOperation === undefined)).toBe(true);
      expect(runtime.snapshot().flags).not.toContain('hook-failed');
    } finally {
      runtime?.stop('local');
      for (const key of keys) Reflect.deleteProperty(Object.prototype, key);
    }
  });

  it.each(API_OPERATION_DEFINITIONS.filter(definition => ['client-hints', 'window-management', 'compute-pressure', 'idle-detection'].includes(definition[2])
    && definition[3] !== 'set' && !definition[0].endsWith('EventListener')))(
    '%s keeps precise operation, original arguments/results and failures without collecting state', (apiOperation, techniqueId, _mechanism, kind) => {
      const runtime = new SensorRuntime(makeEnv().env);
      const touches = vi.fn(() => { throw new Error('observer read private input or state'); });
      const value = new Proxy({}, { get: touches, ownKeys: touches });
      let failing = false;
      const calls: Array<{ receiver: unknown; args: unknown[] }> = [];
      class NativeInterface {
        constructor(...args: unknown[]) {
          if (kind === 'construct') { calls.push({ receiver: this, args }); if (failing) throw value; }
        }
      }
      const [name, property] = apiOperation.split('.');
      const realm: Record<string, unknown> = { [name!]: NativeInterface };
      const isStatic = apiOperation === 'PressureObserver.knownSources' || apiOperation === 'IdleDetector.requestPermission';
      const target = name === 'Window' ? realm : isStatic ? NativeInterface : NativeInterface.prototype;
      const original = function (this: unknown, ...args: unknown[]) { calls.push({ receiver: this, args }); if (failing) throw value; return value; };
      if (property) Object.defineProperty(target, property, kind === 'get'
        ? { get: original, configurable: true } : { value: original, writable: true, configurable: true });
      let receiver: object | null = kind === 'construct' ? null : name === 'Window' ? realm : isStatic ? NativeInterface : new NativeInterface();
      installEnvironmentSensor(runtime, realm);
      if (isStatic) receiver = realm[name!] as object;
      const invoke = () => kind === 'construct' ? Reflect.construct(realm[name!] as Function, [value]) :
        kind === 'get' ? Reflect.get(receiver!, property!) : Reflect.apply(Reflect.get(receiver!, property!) as Function, receiver, [value]);
      const returned = invoke();
      if (kind === 'construct') expect(returned).toBeInstanceOf(NativeInterface); else expect(returned).toBe(value);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.args).toHaveLength(kind === 'get' ? 0 : 1);
      if (kind !== 'get') expect(calls[0]!.args[0] === value).toBe(true);
      expect(runtime.snapshot().counters).toEqual([expect.objectContaining({ techniqueId, apiOperation, count: 1,
        phase: kind === 'async-call' ? 'settlement-unobserved' : 'returned-sync', signalCodes: ['api-use'] })]);
      failing = true; let caught: unknown;
      try { invoke(); } catch (error) { caught = error; }
      expect(caught).toBe(value); expect(calls).toHaveLength(2);
      expect(touches).not.toHaveBeenCalled();
      expect(runtime.snapshot().counters.some(counter => counter.phase === 'threw-sync' && counter.apiOperation === apiOperation)).toBe(true);
      runtime.pause(); failing = false; invoke();
      expect(runtime.snapshot().counters.reduce((sum, counter) => sum + counter.count, 0)).toBe(2);
      runtime.stop('local');
    },
  );

  it('does not inspect an inherited get field on a data-valued window.screen descriptor', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    const realm = { screen: {} };
    let reads = 0;
    Object.defineProperty(Object.prototype, 'get', { configurable: true, get() { reads++; throw new Error('inherited getter'); } });
    try { installEnvironmentSensor(runtime, realm); }
    finally { delete (Object.prototype as { get?: unknown }).get; }
    expect(reads).toBe(0);
    expect(runtime.snapshot().counters).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(realm, 'screen')?.value).toBe(realm.screen);
    runtime.stop('local');
  });

  it.each(['Screen.onchange', 'ScreenDetails.onscreenschange', 'ScreenDetails.oncurrentscreenchange'] as const)(
    '%s records handler assignment without reading callbacks or installing listeners', apiOperation => {
      const runtime = new SensorRuntime(makeEnv().env);
      const [name, key] = apiOperation.split('.');
      const received: unknown[] = [];
      const original = vi.fn((value: unknown) => { received.push(value); });
      class Target {}
      Object.defineProperty(Target.prototype, key!, { configurable: true, set: original });
      const realm = { [name!]: Target };
      const callback = new Proxy({}, { get() { throw new Error('callback properties are private'); } });
      installEnvironmentSensor(runtime, realm);
      expect(original).not.toHaveBeenCalled();
      const receiver = new Target();
      Reflect.set(receiver, key!, callback); Reflect.set(receiver, key!, null);
      expect(received).toHaveLength(2);
      expect(received[0] === callback).toBe(true);
      expect(received[1]).toBeNull();
      expect(runtime.snapshot().counters).toEqual([expect.objectContaining({ apiOperation, count: 2, phase: 'returned-sync' })]);
      runtime.stop('local');
      expect(Object.getOwnPropertyDescriptor(Target.prototype, key!)?.set).toBe(original);
    },
  );

  it('installation performs zero value reads; getters cover independent browser families with api-use only', () => {
    const s = setup();
    expect(s.calls).toEqual([]);
    const reads = [ ['Navigator', 'userAgent', 'DET-025'], ['NavigatorUAData', 'brands', 'DET-026'],
      ['Navigator', 'plugins', 'DET-027'], ['Navigator', 'webdriver', 'DET-028'], ['Screen', 'width', 'DET-029'],
      ['VisualViewport', 'width', 'DET-030'], ['Screen', 'isExtended', 'DET-031'],
      ['Navigator', 'hardwareConcurrency', 'DET-032'], ['Navigator', 'deviceMemory', 'DET-033'],
      ['Navigator', 'maxTouchPoints', 'DET-034'], ['BatteryManager', 'level', 'DET-040'],
      ['NetworkInformation', 'saveData', 'DET-041'] ];
    for (const [name, key] of reads) expect(Reflect.get(s.subjects[name!]!, key!)).toBe(s.value);
    expect(s.calls).toHaveLength(reads.length);
    expect(s.runtime.snapshot().counters.map(c => c.techniqueId)).toEqual(reads.map(r => r[2]));
    for (const counter of s.runtime.snapshot().counters) expect(counter).toMatchObject({ count: 1, phase: 'returned-sync', signalCodes: ['api-use'] });
  });

  it('methods forward original receiver and extra hostile arguments once without reading them', () => {
    const s = setup();
    const poison = new Proxy({}, { get() { throw new Error('extra read'); }, ownKeys() { throw new Error('enumerated'); } });
    const media = Reflect.apply(s.realm['matchMedia'] as Function, poison, [poison, -0]) as { receiver: unknown; args: unknown[] };
    expect(media.receiver === poison).toBe(true); expect(media.args[0] === poison).toBe(true);
    expect(Object.is(media.args[1], -0)).toBe(true);
    const args = Reflect.apply((s.realm['CSS'] as { supports: Function }).supports, poison, [poison, poison]) as unknown[];
    expect(args[0] === poison && args[1] === poison).toBe(true);
    expect(s.calls).toEqual(['media.method', 'css.method']);
    expect(s.runtime.snapshot().counters.map(c => c.techniqueId)).toEqual(['DET-037', 'DET-038']);
  });

  it('async return identity and settlement-unobserved do not require inspecting a Promise or thenable', () => {
    const s = setup();
    expect(Reflect.apply(s.navigator['getBattery'] as Function, s.subjects['Navigator'], [])).toBe(s.promise);
    expect(Reflect.apply(s.realm['getScreenDetails'] as Function, s.realm, [])).toBe(s.promise);
    const poison = new Proxy({}, { get() { throw new Error('hints'); } });
    const result = Reflect.apply(s.ua['getHighEntropyValues'] as Function, s.subjects['NavigatorUAData'], [poison]) as { args: unknown[] };
    expect(result.args[0] === poison).toBe(true);
    expect(s.promiseReads()).toBe(0);
    expect(s.runtime.snapshot().counters).toHaveLength(3);
    expect(s.runtime.snapshot().counters.every(c => c.phase === 'settlement-unobserved')).toBe(true);
  });

  it('Date / Intl results and Window NaN are preserved without any value inspection', () => {
    const s = setup();
    expect(Object.is(Reflect.apply(s.date['getTimezoneOffset'] as Function, s.subjects['Date'], []), -0)).toBe(true);
    expect(Reflect.apply(s.intl['resolvedOptions'] as Function, s.subjects['DateTimeFormat'], [])).toBe(s.value);
    expect(Number.isNaN(s.realm['innerWidth'])).toBe(true);
    expect(s.runtime.snapshot().counters.map(c => c.techniqueId)).toEqual(['DET-035', 'DET-036', 'DET-030']);
  });

  for (const thrown of [undefined, null, false, 0, 'CANARY-PRIVATE-ERROR']) it('preserves original thrown identity including ' + typeof thrown, () => {
    const runtime = new SensorRuntime(makeEnv().env);
    let originalCalls = 0;
    class Navigator { get userAgent(): never { originalCalls++; throw thrown; } }
    const realm = { Navigator, matchMedia(): never { originalCalls++; throw thrown; } };
    installEnvironmentSensor(runtime, realm);
    for (const call of [() => new Navigator().userAgent, () => realm['matchMedia']()]) {
      let didThrow = false; try { call(); } catch (error) { didThrow = true; expect(error).toBe(thrown); }
      expect(didThrow).toBe(true);
    }
    expect(originalCalls).toBe(2);
    expect(runtime.snapshot().counters.every(c => c.phase === 'threw-sync')).toBe(true);
    expect(JSON.stringify(runtime.snapshot())).not.toContain('CANARY');
  });

  it('preserves native-owned coercion count and suppresses observer failure', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    let coercions = 0, calls = 0;
    const realm = { matchMedia(value: unknown) { calls++; return String(value); } };
    installEnvironmentSensor(runtime, realm);
    const observe = vi.spyOn(runtime, 'record').mockImplementation(() => { throw new Error('observer'); });
    expect(realm['matchMedia']({ toString() { coercions++; return 'CANARY-QUERY'; } })).toBe('CANARY-QUERY');
    expect(coercions).toBe(1); expect(calls).toBe(1); expect(observe).toHaveBeenCalledOnce();
    expect(runtime.hooks.observerErrors).toBe(1);
  });

  it('leaves namespace getters, data descriptors and frozen properties unchanged', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    let reads = 0;
    const realm = { innerWidth: 1137 };
    Object.defineProperty(realm, 'Navigator', { get() { reads++; throw new Error('namespace'); } });
    Object.defineProperty(realm, 'matchMedia', { configurable: false, value() { return true; } });
    const original = Object.getOwnPropertyDescriptor(realm, 'innerWidth');
    installEnvironmentSensor(runtime, realm);
    expect(reads).toBe(0); expect(Object.getOwnPropertyDescriptor(realm, 'innerWidth')).toEqual(original);
    expect(runtime.snapshot().flags).toEqual(expect.arrayContaining(['hook-failed', 'descriptor-nonconfigurable']));
  });

  it('pause, repeat installation, stop and foreign ownership retain page semantics', () => {
    const s = setup();
    const userAgent = Object.getOwnPropertyDescriptor((s.realm['Navigator'] as { prototype: object }).prototype, 'userAgent')!.get;
    installEnvironmentSensor(s.runtime, s.realm);
    expect(Object.getOwnPropertyDescriptor((s.realm['Navigator'] as { prototype: object }).prototype, 'userAgent')!.get).toBe(userAgent);
    Reflect.get(s.subjects['Navigator']!, 'userAgent');
    s.runtime.hooks.enabled = false;
    Reflect.get(s.subjects['Navigator']!, 'userAgent');
    expect(s.runtime.snapshot().counters[0]!.count).toBe(1);
    const foreign = () => 'foreign'; s.realm['matchMedia'] = foreign;
    s.runtime.stop('revoked');
    expect(s.realm['matchMedia']).toBe(foreign);
    expect(Object.getOwnPropertyDescriptor((s.realm['Navigator'] as { prototype: object }).prototype, 'userAgent')!.get).not.toBe(userAgent);
  });

  it('preserves accessor setters and does not create constructor wrappers', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    let value = 2;
    const realm = { get innerWidth() { return value; }, set innerWidth(next: number) { value = next; } };
    const setter = Object.getOwnPropertyDescriptor(realm, 'innerWidth')!.set;
    const installed = installEnvironmentSensor(runtime, realm);
    realm['innerWidth'] = 7;
    expect(realm['innerWidth']).toBe(7);
    expect(Object.getOwnPropertyDescriptor(realm, 'innerWidth')!.set).toBe(setter);
    expect(installed.results.every(r => r.kind !== 'constructor')).toBe(true);
  });
});
