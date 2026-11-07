import { describe, expect, it, vi } from 'vitest';
import { extensionResourceId } from '../src/extension-resource';
import { EXTENSION_TARGET_KEYS, EXTENSION_RESOURCE_METHODS } from '@detect-expert/contracts';
import { decodeKey, extensionResourceKey, PHASE_INDEX } from '../src/codes';
import { SensorRuntime } from '../src/runtime';
import { bridgeHello, deliver, makeEnv } from './helpers';
import { installBrowserRequestSensor } from '../src/browser-requests';

describe('ADR-028 primitive extension resource targets', () => {
  const id = 'a'.repeat(32);
  const known = 'lanfdkkpgfjfdikkncbnojekcppdebfp', other = 'pkehgijcmpdhfbdbbnkijodmdjhbjlgp';
  for (const field of ['extensionResource', 'apiOperation'] as const) for (const when of ['before-first', 'before-flush'] as const) {
    it.each([false, true])('never reads inherited ' + field + ' ' + when + ' (throw=%s)', throwing => {
      const fake = makeEnv(), runtime = new SensorRuntime(fake.env);
      const realm = { fetch(_input: unknown) { return undefined; } };
      installBrowserRequestSensor(runtime, realm);
      runtime.start(); deliver(fake, bridgeHello(runtime));
      const emit = () => {
        realm.fetch('https://example.test/ordinary');
        realm.fetch('chrome-extension://' + known + '/private');
      };
      if (when === 'before-flush') emit();
      const inherited = vi.fn(() => {
        if (throwing) throw new Error('inherited metadata read');
        return field === 'extensionResource' ? { target: other, method: 'fetch' } : 'GPUAdapter.info';
      });
      let snapshot: ReturnType<SensorRuntime['snapshot']>;
      const previous = Object.getOwnPropertyDescriptor(Object.prototype, field);
      try {
        Object.defineProperty(Object.prototype, field, { configurable: true, get: inherited });
        if (when === 'before-first') emit();
        snapshot = runtime.snapshot();
        fake.advance(250);
      } finally {
        if (previous) Object.defineProperty(Object.prototype, field, previous);
        else Reflect.deleteProperty(Object.prototype, field);
      }
      expect(inherited).not.toHaveBeenCalled();
      expect(snapshot!.counters).toHaveLength(2);
      expect(snapshot!.observerErrors).toBe(0);
      const observations = fake.batches().flatMap(batch => batch.observations);
      expect(observations).toHaveLength(2);
      expect(Object.hasOwn(observations[0]!, 'extensionResource')).toBe(false);
      expect(Object.hasOwn(observations[0]!, 'apiOperation')).toBe(false);
      expect(observations[1]!.extensionResource).toEqual({ target: known, method: 'fetch' });
      expect(runtime.hooks.observerErrors).toBe(0);
      runtime.stop('local');
    });
  }
  it('records fetch and disconnected src references once without touching arguments, Promise or output', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    const touched = vi.fn(() => { throw new Error('private value read'); });
    const opaque = new Proxy({}, { get: touched, ownKeys: touched });
    const calls: unknown[][] = [];
    class HTMLImageElement { set src(value: unknown) { calls.push([this, value]); } }
    const realm = { fetch(...args: unknown[]) { calls.push([this, ...args]); return opaque; }, HTMLImageElement };
    installBrowserRequestSensor(runtime, realm);
    const url = 'chrome-extension://' + known + '/PRIVATE?QUERY';
    expect(realm.fetch(url, opaque) === opaque).toBe(true);
    realm.fetch('chrome-extension://' + id + '/PRIVATE');
    realm.fetch(opaque);
    new realm.HTMLImageElement().src = url;
    expect(calls).toHaveLength(4); expect(touched).not.toHaveBeenCalled();
    const counters = runtime.snapshot().counters;
    expect(counters.map(counter => [counter.extensionResource?.target, counter.extensionResource?.method, counter.count])).toEqual([
      [known, 'fetch', 1], ['unknown', 'fetch', 1], [undefined, undefined, 1], [known, 'image-src', 1],
    ]);
    expect(JSON.stringify(counters)).not.toMatch(/PRIVATE|QUERY|aaaaaaaa/);
    runtime.stop('local');
  });

  it('XHR open invalidates before synchronous callbacks and never overwrites a nested re-open', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    let callback: (() => void) | null = null, fail = false;
    const failure = {};
    class XMLHttpRequest {
      open(_method: unknown, _url: unknown) { if (fail) throw failure; callback?.(); return failure; }
      send() { return failure; }
    }
    const realm = { XMLHttpRequest }; installBrowserRequestSensor(runtime, realm);
    const request = new XMLHttpRequest();
    request.open('GET', 'chrome-extension://' + known + '/first'); request.send();
    callback = () => { callback = null; request.send(); request.open('GET', 'chrome-extension://' + other + '/nested'); };
    request.open('GET', 'chrome-extension://' + known + '/outer'); request.send();
    fail = true;
    expect(() => request.open('GET', 'chrome-extension://' + known + '/failed')).toThrow();
    request.send(); fail = false;
    request.open('GET', 'chrome-extension://' + known + '/before-pause');
    runtime.pause(); request.open('GET', 'https://example.test/paused'); runtime.resume(); request.send();
    const counters = runtime.snapshot().counters;
    expect(counters.filter(counter => counter.extensionResource).map(counter => [counter.extensionResource!.target, counter.count])).toEqual([[known, 1], [other, 1]]);
    expect(counters.find(counter => !counter.extensionResource)?.count).toBe(3);
    runtime.stop('local');
  });

  it('bounds new XHR target associations without losing the generic request count', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    class XMLHttpRequest { open(_method: unknown, _url: unknown) {} send() {} }
    installBrowserRequestSensor(runtime, { XMLHttpRequest });
    for (let index = 0; index < 600; index++) {
      const request = new XMLHttpRequest(); request.open('GET', 'chrome-extension://' + known + '/'); request.send();
    }
    expect(runtime.snapshot().counters.reduce((sum, counter) => sum + counter.count, 0)).toBe(600);
    expect(runtime.snapshot().flags).toContain('budget-exceeded');
    expect(runtime.snapshot().counters.find(counter => counter.extensionResource)?.count).toBe(512);
    runtime.stop('local');
  });

  it.each([false, true])('keeps the send target captured before a reentrant re-open (throw=%s)', failing => {
    const runtime = new SensorRuntime(makeEnv().env), failure = {};
    class XMLHttpRequest {
      open(_method: unknown, _url: unknown) {}
      send() { this.open('GET', 'chrome-extension://' + other + '/reopened'); if (failing) throw failure; return failure; }
    }
    installBrowserRequestSensor(runtime, { XMLHttpRequest });
    const request = new XMLHttpRequest(); request.open('GET', 'chrome-extension://' + known + '/original');
    let caught: unknown;
    try { request.send(); } catch (error) { caught = error; }
    expect(caught).toBe(failing ? failure : undefined);
    expect(runtime.snapshot().counters).toEqual([expect.objectContaining({ extensionResource: { target: known, method: 'xhr-send' },
      phase: failing ? 'threw-sync' : 'settlement-unobserved', count: 1 })]);
    runtime.stop('local');
  });
  it('round-trips all target/method/phase keys and preserves the runtime counter cap', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    const keys = new Set<number>();
    for (const [targetIndex, target] of EXTENSION_TARGET_KEYS.entries()) for (const [methodIndex, method] of EXTENSION_RESOURCE_METHODS.entries()) {
      for (const phase of ['threw-sync', method.endsWith('-src') ? 'returned-sync' : 'settlement-unobserved'] as const) {
        const key = extensionResourceKey(targetIndex * EXTENSION_RESOURCE_METHODS.length + methodIndex, PHASE_INDEX[phase]);
        expect(keys.has(key)).toBe(false); keys.add(key);
        expect(decodeKey(key)).toEqual({ techniqueId: 'DET-059', signalCodes: ['api-use'], phase, extensionResource: { target, method } });
        runtime.recordExtensionResource(targetIndex, methodIndex, PHASE_INDEX[phase]);
      }
    }
    expect(keys.size).toBe(1032);
    expect(runtime.snapshot().size).toBe(32);
    expect(runtime.snapshot().flags).toContain('budget-exceeded');
    expect(decodeKey(extensionResourceKey(516, 0))).toBeNull();
    expect(decodeKey(extensionResourceKey(0, PHASE_INDEX['returned-sync']))).toBeNull();
  });

  it('extracts only the extension identifier, never resource path or query', () => {
    expect(extensionResourceId('chrome-extension://' + id + '/PRIVATE_PATH?PRIVATE_QUERY#PRIVATE_FRAGMENT')).toBe(id);
    expect(extensionResourceId('chrome-extension://' + id)).toBe(id);
  });

  it('ignores ordinary URLs, lookalikes, invalid IDs, credentials and unbounded input', () => {
    for (const input of ['https://' + id + '/chrome-extension://', 'https://example.com/?chrome-extension://' + id,
      'chrome-extension://' + id + '.evil/', 'chrome-extension://invalid/', 'chrome-extension://' + 'q'.repeat(32) + '/',
      'chrome-extension://user:secret@' + id + '/', 'chrome-extension://' + id + ':123/',
      'chrome-extension://' + id + '/' + 'x'.repeat(4096)]) expect(extensionResourceId(input)).toBeNull();
  });

  it('never reads or coerces arbitrary objects', () => {
    const touched = vi.fn(() => { throw new Error('untrusted input read'); });
    const input = new Proxy({}, { get: touched, ownKeys: touched, getOwnPropertyDescriptor: touched });
    for (const value of [input, { toString: touched }, new URL('chrome-extension://' + id + '/'), null, undefined, 1, Symbol('target')]) {
      expect(extensionResourceId(value)).toBeNull();
    }
    expect(touched).not.toHaveBeenCalled();
  });

  it('uses captured parser intrinsics after page prototype replacement', () => {
    const touched = vi.fn(() => { throw new Error('late prototype access'); });
    const slots: Array<[object, string]> = [[String.prototype, 'startsWith'], [RegExp.prototype, 'exec'],
      ...['protocol', 'hostname', 'username', 'password', 'port'].map(key => [URL.prototype, key] as [object, string])];
    const originals = slots.map(([owner, key]) => Object.getOwnPropertyDescriptor(owner, key)!);
    let result: string | null = null;
    try {
      for (let index = 0; index < slots.length; index++) {
        const [owner, key] = slots[index]!, original = originals[index]!;
        Object.defineProperty(owner, key, { ...original, ...(Object.hasOwn(original, 'value') ? { value: touched } : { get: touched }) });
      }
      result = extensionResourceId('chrome-extension://' + id + '/PRIVATE');
    } finally {
      for (let index = 0; index < slots.length; index++) Object.defineProperty(slots[index]![0], slots[index]![1], originals[index]!);
    }
    expect(result).toBe(id);
    expect(touched).not.toHaveBeenCalled();
  });
});