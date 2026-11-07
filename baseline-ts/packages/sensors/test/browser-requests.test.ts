import { describe, expect, it } from 'vitest';
import { installBrowserRequestSensor as installRequests } from '../src/browser-requests';
import { installPermissionsSensor } from '../src/permissions';
import { SensorRuntime } from '../src/runtime';
import { makeEnv } from './helpers';

// DET-039 now has its own sensor; exercise the same composition as hook.main.
function installBrowserRequestSensor(runtime: SensorRuntime, realm: object) {
  const requests = installRequests(runtime, realm), permissions = installPermissionsSensor(runtime, realm);
  return { results: [...requests.results, ...permissions.results], skipped: [...requests.skipped, ...permissions.skipped] };
}

function setup() {
  const fake = makeEnv();
  const runtime = new SensorRuntime(fake.env);
  const calls: unknown[][] = [];
  let thenReads = 0;
  const promise = Promise.resolve(undefined);
  Object.defineProperty(promise, 'then', { get() { thenReads++; throw new Error('observer read then'); } });
  const opaque = new Proxy({}, { get() { throw new Error('observer inspected output'); } });
  const failure = new Proxy({}, { get() { throw new Error('observer inspected exception'); } });
  let cookie = 'COOKIE_VALUE_CANARY';
  class Permissions { query(...args: unknown[]) { calls.push([this, ...args]); return promise; } }
  class Storage {
    getItem(...args: unknown[]) { calls.push([this, ...args]); return opaque; }
    setItem(...args: unknown[]) { calls.push([this, ...args]); throw failure; }
  }
  class Document {
    get cookie() { calls.push([this]); return cookie; }
    set cookie(value: string) { cookie = value; }
    hasStorageAccess() { calls.push([this]); return promise; }
  }
  class Navigator {
    getGamepads() { calls.push([this]); return opaque; }
    sendBeacon(...args: unknown[]) { calls.push([this, ...args]); return false; }
  }
  class Geolocation { getCurrentPosition(...args: unknown[]) { calls.push([this, ...args]); return undefined; } }
  class IDBFactory { open(...args: unknown[]) { calls.push([this, ...args]); return opaque; } }
  const realm = { Permissions, Storage, Document, Navigator, Geolocation, IDBFactory,
    fetch(...args: unknown[]) { calls.push([this, ...args]); return promise; } };
  return { realm, fake, runtime, calls, promise, opaque, failure, thenReads: () => thenReads };
}

describe('browser request API facts without inspecting request data', () => {
  it('install invokes no API and leaves ordinary unsupported interfaces absent', () => {
    const s = setup();
    const result = installBrowserRequestSensor(s.runtime, s.realm);
    expect(s.calls).toEqual([]);
    expect(s.thenReads()).toBe(0);
    expect(s.runtime.snapshot().counters).toEqual([]);
    expect(result.skipped).toContain('Bluetooth');
    expect(Object.hasOwn(s.realm, 'Bluetooth')).toBe(false);
  });

  it('Permissions.query preserves receiver, hostile options and Promise identity without handling settlement', () => {
    const s = setup(); installBrowserRequestSensor(s.runtime, s.realm);
    const permissions = new s.realm.Permissions();
    const options = new Proxy({}, { get() { throw new Error('option reread'); } });
    expect(permissions.query(options)).toBe(s.promise);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]?.[0] === permissions && s.calls[0]?.[1] === options).toBe(true);
    expect(s.thenReads()).toBe(0);
    expect(s.runtime.snapshot().counters).toEqual([expect.objectContaining({ techniqueId: 'DET-039', phase: 'settlement-unobserved', count: 1, signalCodes: ['api-use'] })]);
  });

  it('storage results and the original exception are opaque to the observer', () => {
    const s = setup(); installBrowserRequestSensor(s.runtime, s.realm);
    const storage = new s.realm.Storage();
    expect(storage.getItem('STORAGE_KEY_CANARY')).toBe(s.opaque);
    let caught: unknown;
    try { storage.setItem('STORAGE_KEY_CANARY', 'STORAGE_VALUE_CANARY'); } catch (error) { caught = error; }
    expect(caught === s.failure).toBe(true);
    expect(s.calls).toHaveLength(2);
    const counters = s.runtime.snapshot().counters;
    expect(counters).toEqual(expect.arrayContaining([
      expect.objectContaining({ techniqueId: 'DET-050', phase: 'returned-sync', count: 1 }),
      expect.objectContaining({ techniqueId: 'DET-050', phase: 'threw-sync', count: 1 }),
    ]));
    expect(JSON.stringify(counters)).not.toContain('CANARY');
  });

  it('cookie reads are counted, values discarded, original setter and its behavior untouched', () => {
    const s = setup();
    const original = Object.getOwnPropertyDescriptor(s.realm.Document.prototype, 'cookie')!;
    installBrowserRequestSensor(s.runtime, s.realm);
    const document = new s.realm.Document();
    document.cookie = 'NEW_COOKIE_CANARY';
    expect(Object.getOwnPropertyDescriptor(s.realm.Document.prototype, 'cookie')!.set).toBe(original.set);
    expect(s.runtime.snapshot().counters).toEqual([]);
    expect(document.cookie).toBe('NEW_COOKIE_CANARY');
    expect(s.calls).toHaveLength(1);
    expect(s.runtime.snapshot().counters).toEqual([expect.objectContaining({ techniqueId: 'DET-049', count: 1 })]);
    expect(JSON.stringify(s.runtime.snapshot())).not.toContain('COOKIE');
    s.runtime.stop('local');
    expect(Object.getOwnPropertyDescriptor(s.realm.Document.prototype, 'cookie')).toEqual(original);
  });

  it('fetch and beacon forward URL/body/options untouched and preserve asynchronous versus synchronous phase', () => {
    const s = setup(); installBrowserRequestSensor(s.runtime, s.realm);
    const input = new Proxy({}, { get() { throw new Error('input inspected'); } });
    expect(s.realm.fetch(input, input)).toBe(s.promise);
    const navigator = new s.realm.Navigator();
    expect(navigator.sendBeacon(input, input)).toBe(false);
    expect(s.calls).toHaveLength(2);
    expect(s.calls.every(call => call[1] === input && call[2] === input)).toBe(true);
    expect(s.thenReads()).toBe(0);
    expect(s.runtime.snapshot().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({ techniqueId: 'DET-059', phase: 'settlement-unobserved', count: 1 }),
      expect.objectContaining({ techniqueId: 'DET-059', phase: 'returned-sync', count: 1 }),
    ]));
  });

  it('callback and IDB request identity stay untouched; returned values do not establish completion', () => {
    const s = setup(); installBrowserRequestSensor(s.runtime, s.realm);
    const callback = () => { throw new Error('sensor invoked callback'); };
    const options = new Proxy({}, { get() { throw new Error('options inspected'); } });
    expect(new s.realm.Geolocation().getCurrentPosition(callback, callback, options)).toBeUndefined();
    expect(s.calls[0]?.[1] === callback && s.calls[0]?.[2] === callback && s.calls[0]?.[3] === options).toBe(true);
    expect(new s.realm.IDBFactory().open('DB_NAME_CANARY')).toBe(s.opaque);
    expect(s.runtime.snapshot().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({ techniqueId: 'DET-044', phase: 'settlement-unobserved', count: 1 }),
      expect.objectContaining({ techniqueId: 'DET-051', phase: 'settlement-unobserved', count: 1 }),
    ]));
    expect(JSON.stringify(s.runtime.snapshot())).not.toContain('DB_NAME');
  });

  it('does not enumerate gamepad objects or add queries on installation, pause or stop', () => {
    const s = setup(); installBrowserRequestSensor(s.runtime, s.realm);
    const navigator = new s.realm.Navigator();
    expect(navigator.getGamepads()).toBe(s.opaque);
    expect(s.runtime.snapshot().counters).toEqual([expect.objectContaining({ techniqueId: 'DET-047', count: 1 })]);
    s.runtime.pause(); navigator.getGamepads();
    expect(s.runtime.snapshot().counters[0]?.count).toBe(1);
    s.runtime.resume(); navigator.getGamepads();
    expect(s.runtime.snapshot().counters[0]?.count).toBe(2);
    s.runtime.stop('local'); navigator.getGamepads();
    expect(s.calls).toHaveLength(4);
    expect(s.runtime.snapshot().counters[0]?.count).toBe(2);
  });

  it('never invokes interface getters; reports frozen methods and continues installing later families', () => {
    const s = setup();
    Object.defineProperty(s.realm, 'Bluetooth', { get() { throw new Error('constructor getter'); } });
    Object.defineProperty(s.realm.Permissions.prototype, 'query', { configurable: false });
    installBrowserRequestSensor(s.runtime, s.realm);
    expect(s.runtime.snapshot().flags).toContain('descriptor-nonconfigurable');
    new s.realm.Navigator().sendBeacon('URL_CANARY');
    expect(s.runtime.snapshot().counters[0]?.techniqueId).toBe('DET-059');
  });

  it('reinjection never double-counts and cleanup preserves a later page replacement', () => {
    const s = setup();
    installBrowserRequestSensor(s.runtime, s.realm); installBrowserRequestSensor(s.runtime, s.realm);
    new s.realm.Permissions().query({});
    expect(s.runtime.snapshot().counters[0]?.count).toBe(1);
    const foreign = () => s.promise;
    s.realm.Permissions.prototype.query = foreign;
    s.runtime.stop('revoked');
    expect(s.realm.Permissions.prototype.query).toBe(foreign);
    expect(installBrowserRequestSensor(s.runtime, s.realm).results).toEqual([]);
  });

  it('observer failure cannot change original result or exception', () => {
    const s = setup(); installBrowserRequestSensor(s.runtime, s.realm);
    s.runtime.record = () => { throw new Error('observer failed'); };
    expect(new s.realm.Storage().getItem()).toBe(s.opaque);
    let caught: unknown;
    try { new s.realm.Storage().setItem(); } catch (error) { caught = error; }
    expect(caught === s.failure).toBe(true);
    expect(s.calls).toHaveLength(2);
    expect(s.runtime.hooks.observerErrors).toBe(2);
  });
});
