import { describe, expect, it, vi } from 'vitest';
import { API_OPERATION_DEFINITIONS } from '@detect-expert/contracts';
import { installAudioSensor } from '../src/audio';
import { SensorRuntime } from '../src/runtime';
import { makeEnv } from './helpers';

describe('ADR-032 passive AudioContext operations DET-015/016/017', () => {
  it.each(API_OPERATION_DEFINITIONS.filter(definition => definition[2] === 'audio'))(
    '%s preserves arguments, result, exceptions and pause without reading samples', (operation, techniqueId, _mechanism, kind) => {
      const runtime = new SensorRuntime(makeEnv().env);
      const touched = vi.fn(() => { throw new Error('private audio input/result read'); });
      const opaque = new Proxy({}, { get: touched, ownKeys: touched });
      const calls: Array<{ receiver: unknown; args: unknown[] }> = [];
      let failing = false;
      class NativeInterface {
        constructor(...args: unknown[]) {
          if (kind === 'construct') { calls.push({ receiver: this, args }); if (failing) throw opaque; }
        }
      }
      const [name, property] = operation.split('.');
      const realm: Record<string, unknown> = { [name!]: NativeInterface };
      const original = function (this: unknown, ...args: unknown[]) { calls.push({ receiver: this, args }); if (failing) throw opaque; return opaque; };
      if (property) Object.defineProperty(NativeInterface.prototype, property, kind === 'get' ? { get: original, configurable: true } : { value: original, writable: true, configurable: true });
      const receiver = kind === 'construct' ? null : new NativeInterface();
      const installation = installAudioSensor(runtime, realm);
      expect(calls).toEqual([]);
      expect(installation.results.filter(result => result.status === 'installed' && result.key === (property ?? name))).toHaveLength(1);
      const invoke = () => kind === 'construct' ? Reflect.construct(realm[name!] as Function, [opaque]) :
        kind === 'get' ? Reflect.get(receiver!, property!) : Reflect.apply(Reflect.get(receiver!, property!) as Function, receiver, [opaque]);
      const result = invoke();
      if (kind === 'construct') expect(result).toBeInstanceOf(NativeInterface);
      else expect(result === opaque).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.args.length).toBe(kind === 'get' ? 0 : 1);
      if (kind !== 'get') expect(calls[0]!.args[0] === opaque).toBe(true);
      expect(runtime.snapshot().counters).toEqual([expect.objectContaining({ techniqueId, apiOperation: operation, count: 1,
        phase: kind === 'async-call' ? 'settlement-unobserved' : 'returned-sync', signalCodes: ['api-use'] })]);
      failing = true; let caught: unknown;
      try { invoke(); } catch (error) { caught = error; }
      expect(caught === opaque).toBe(true);
      expect(touched).not.toHaveBeenCalled();
      expect(runtime.snapshot().counters.some(counter => counter.apiOperation === operation && counter.phase === 'threw-sync')).toBe(true);
      runtime.pause(); failing = false; invoke();
      expect(runtime.snapshot().counters.reduce((sum, counter) => sum + counter.count, 0)).toBe(2);
      runtime.stop('local');
      if (property) expect(Object.getOwnPropertyDescriptor(NativeInterface.prototype, property)?.[kind === 'get' ? 'get' : 'value']).toBe(original);
    },
  );

  it('preserves the native Promise identity and never adds settlement handlers', () => {
    const runtime = new SensorRuntime(makeEnv().env), touched = vi.fn(() => { throw new Error('Promise observed'); });
    const promise = Promise.resolve('AUDIO_PRIVATE_CANARY');
    Object.defineProperties(promise, { then: { get: touched }, catch: { get: touched } });
    class OfflineAudioContext { startRendering() { return promise; } }
    const realm = { OfflineAudioContext }; installAudioSensor(runtime, realm);
    expect(new realm.OfflineAudioContext().startRendering() === promise).toBe(true);
    expect(touched).not.toHaveBeenCalled();
    expect(JSON.stringify(runtime.snapshot())).not.toContain('AUDIO_PRIVATE_CANARY');
    runtime.stop('local');
  });

  it('observes an existing webkit alias without invoking getters, creating audio or duplicating methods', () => {
    const runtime = new SensorRuntime(makeEnv().env), invoked = vi.fn();
    class AudioContext { constructor() { invoked(); } }
    const realm = { AudioContext, webkitAudioContext: AudioContext };
    Object.defineProperty(realm, 'OfflineAudioContext', { get() { throw new Error('namespace getter'); } });
    installAudioSensor(runtime, realm); installAudioSensor(runtime, realm);
    expect(invoked).not.toHaveBeenCalled();
    new realm.AudioContext(); new realm.webkitAudioContext();
    expect(invoked).toHaveBeenCalledTimes(2);
    expect(runtime.snapshot().counters).toEqual([expect.objectContaining({ apiOperation: 'AudioContext', count: 2 })]);
    expect(runtime.snapshot().flags).toContain('hook-failed');
    runtime.stop('local');
  });
});