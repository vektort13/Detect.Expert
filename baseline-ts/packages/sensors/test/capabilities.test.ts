import { describe, expect, it } from 'vitest';
import { installCapabilitySensor } from '../src/capabilities';
import { SensorRuntime } from '../src/runtime';
import { makeEnv } from './helpers';

describe('ADR-038 passive capability APIs', () => {
  it('installs static and instance methods without reading configs, device results or Promise settlement', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    let calls = 0, reads = 0;
    const opaque = new Proxy({}, { get() { reads++; throw new Error('private data read'); }, ownKeys() { reads++; throw new Error('private enumeration'); } });
    const promise = Promise.resolve(undefined);
    Object.defineProperty(promise, 'then', { get() { reads++; throw new Error('Promise inspected'); } });
    class AudioDecoder { static isConfigSupported(input: unknown) { calls++; expect(input === opaque).toBe(true); return promise; } }
    class SpeechSynthesis { getVoices() { calls++; return opaque; } }
    class MediaCapabilities { decodingInfo(input: unknown) { calls++; expect(input === opaque).toBe(true); return promise; } }
    installCapabilitySensor(runtime, { AudioDecoder, SpeechSynthesis, MediaCapabilities });
    expect(calls).toBe(0);
    expect(AudioDecoder.isConfigSupported(opaque) === promise).toBe(true);
    expect(new SpeechSynthesis().getVoices() === opaque).toBe(true);
    expect(new MediaCapabilities().decodingInfo(opaque) === promise).toBe(true);
    expect(calls).toBe(3); expect(reads).toBe(0);
    expect(runtime.snapshot().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiOperation: 'AudioDecoder.isConfigSupported', phase: 'settlement-unobserved', signalCodes: ['api-use'] }),
      expect.objectContaining({ apiOperation: 'SpeechSynthesis.getVoices', phase: 'returned-sync', signalCodes: ['api-use'] }),
    ]));
    runtime.stop('local');
  });

  it('preserves thrown identity and does not execute missing API accessors during installation', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    const error = new Proxy({}, { get() { throw new Error('error read'); } });
    const realm = Object.defineProperty({}, 'LanguageModel', { get() { throw new Error('API getter'); } });
    expect(installCapabilitySensor(runtime, realm).results).toEqual([]);
    let calls = 0;
    class MediaKeys { getStatusForPolicy() { calls++; throw error; } }
    installCapabilitySensor(runtime, { MediaKeys });
    let caught: unknown;
    try { new MediaKeys().getStatusForPolicy(); } catch (value) { caught = value; }
    expect(caught === error).toBe(true); expect(calls).toBe(1);
    expect(runtime.snapshot().counters[0]).toMatchObject({ apiOperation: 'MediaKeys.getStatusForPolicy', phase: 'threw-sync' });
    runtime.stop('local');
  });

  it('distinguishes AI availability from use without reading language pairs, options or generated content', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    let reads = 0, calls = 0;
    const options = new Proxy({}, { get() { reads++; throw new Error('language pair read'); } });
    const promise = Promise.resolve(undefined);
    Object.defineProperty(promise, 'then', { get() { reads++; throw new Error('AI Promise inspected'); } });
    class Translator {
      static availability(value: unknown) { calls++; expect(value === options).toBe(true); return promise; }
      static create(value: unknown) { calls++; expect(value === options).toBe(true); return promise; }
      translate(input: unknown) { calls++; expect(input === options).toBe(true); return promise; }
      translateStreaming() { calls++; return 'AI_OUTPUT_SECRET_CANARY'; }
    }
    installCapabilitySensor(runtime, { Translator });
    expect(calls).toBe(0);
    expect(Translator.availability(options) === promise).toBe(true);
    expect(Translator.create(options) === promise).toBe(true);
    expect(new Translator().translate(options) === promise).toBe(true);
    expect(new Translator().translateStreaming()).toBe('AI_OUTPUT_SECRET_CANARY');
    expect(calls).toBe(4); expect(reads).toBe(0);
    expect(runtime.snapshot().counters.every(counter => counter.techniqueId === 'DET-071' && counter.signalCodes[0] === 'api-use')).toBe(true);
    expect(JSON.stringify(runtime.apiResults.snapshot())).not.toContain('AI_OUTPUT_SECRET_CANARY');
    runtime.stop('local');
  });

  it('preserves recognition constructors and opaque detection results without inspecting image inputs', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    let calls = 0, reads = 0;
    const opaque = new Proxy({}, { get() { reads++; throw new Error('image read'); } });
    const targets: Function[] = [];
    class BarcodeDetector {
      constructor(input: unknown) { calls++; expect(input === opaque).toBe(true); targets.push(new.target); }
      detect(input: unknown) { calls++; expect(input === opaque).toBe(true); return opaque; }
    }
    const realm = { BarcodeDetector };
    installCapabilitySensor(runtime, realm);
    class Derived extends realm.BarcodeDetector {}
    const detector = new Derived(opaque);
    expect(detector.detect(opaque) === opaque).toBe(true);
    expect(targets).toEqual([Derived]); expect(calls).toBe(2); expect(reads).toBe(0);
    expect(runtime.snapshot().counters.every(counter => counter.techniqueId === 'DET-072')).toBe(true);
    runtime.stop('local'); expect(realm.BarcodeDetector).toBe(BarcodeDetector);
  });

  it('never wraps LockManager callbacks or opens a file picker during installation', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    let calls = 0;
    const callback = () => 'LOCK_CALLBACK_SECRET';
    class LockManager { request(_name: unknown, input: unknown) { calls++; expect(input === callback).toBe(true); return input; } }
    const picker = () => { calls++; return Promise.resolve([]); };
    const realm = { LockManager, showOpenFilePicker: picker };
    installCapabilitySensor(runtime, realm);
    expect(calls).toBe(0);
    expect(new LockManager().request('LOCK_NAME_SECRET', callback) === callback).toBe(true);
    expect(calls).toBe(1);
    expect(JSON.stringify(runtime.snapshot())).not.toContain('SECRET');
    runtime.stop('local'); expect(realm.showOpenFilePicker).toBe(picker);
  });
});