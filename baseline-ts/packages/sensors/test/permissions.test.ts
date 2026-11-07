import { describe, expect, it, vi } from 'vitest';
import { installPermissionsSensor, permissionName } from '../src/permissions';
import { SensorRuntime } from '../src/runtime';
import { makeEnv } from './helpers';

function setup(startedLate = false) {
  const fake = makeEnv({ startedLate });
  const runtime = new SensorRuntime(fake.env);
  const calls: unknown[][] = [];
  let thenReads = 0, nameReads = 0, stateReads = 0;
  const promise = Promise.resolve(undefined);
  Object.defineProperty(promise, 'then', { get() { thenReads++; throw new Error('then touched'); } });
  const opaque = new Proxy({}, { get() { throw new Error('opaque property touched'); } });
  const failure = new Proxy({}, { get() { throw new Error('exception touched'); } });
  class Permissions { query(...args: unknown[]) { calls.push([this, ...args]); return promise; } }
  class PermissionStatus {
    get name() { nameReads++; throw new Error('non-native getter must not run'); }
    get state(): unknown { stateReads++; return 'prompt'; }
  }
  class Notification { static get permission(): unknown { calls.push([this]); return 'default'; } }
  class FeaturePolicy {
    allowsFeature(...args: unknown[]) { calls.push([this, ...args]); return true; }
    features() { calls.push([this]); return opaque; }
    allowedFeatures() { calls.push([this]); return opaque; }
    getAllowlistForFeature(...args: unknown[]) { calls.push([this, ...args]); return opaque; }
  }
  const realm = { Permissions, PermissionStatus, Notification, FeaturePolicy, PermissionsPolicy: FeaturePolicy };
  return { runtime, fake, realm, calls, promise, opaque, failure, thenReads: () => thenReads, nameReads: () => nameReads, stateReads: () => stateReads };
}

describe('DET-039 permission reads without an extension-created permission probe', () => {
  it('installation calls no browser method, getter, prompt or Promise handler and deduplicates policy aliases', () => {
    const s = setup(); const result = installPermissionsSensor(s.runtime, s.realm);
    expect(result.results).toHaveLength(7);
    expect(s.calls).toEqual([]); expect(s.stateReads()).toBe(0); expect(s.nameReads()).toBe(0); expect(s.thenReads()).toBe(0);
    expect(s.runtime.snapshot().counters).toEqual([]);
  });

  it('query preserves exact receiver, hostile input, Promise identity and settlement ignorance', () => {
    const s = setup(); installPermissionsSensor(s.runtime, s.realm);
    const instance = new s.realm.Permissions();
    let traps = 0;
    const input = new Proxy({}, { get() { traps++; throw new Error('input read'); }, getOwnPropertyDescriptor() { traps++; throw new Error('input descriptor read'); } });
    expect(instance.query(input)).toBe(s.promise);
    expect(s.calls).toHaveLength(1); expect(s.calls[0]?.[0] === instance && s.calls[0]?.[1] === input).toBe(true);
    expect(traps).toBe(0); expect(s.thenReads()).toBe(0);
    expect(s.runtime.snapshot().counters).toEqual([expect.objectContaining({ techniqueId: 'DET-039', phase: 'settlement-unobserved', signalCodes: ['api-use'], count: 1 })]);
  });

  it('query synchronous exceptions retain identity without inspecting the exception', () => {
    const s = setup();
    s.realm.Permissions.prototype.query = () => { throw s.failure; };
    installPermissionsSensor(s.runtime, s.realm);
    let caught: unknown; try { new s.realm.Permissions().query(); } catch (error) { caught = error; }
    expect(caught).toBe(s.failure);
    expect(s.runtime.snapshot().counters[0]).toMatchObject({ phase: 'threw-sync', signalCodes: ['api-use'] });
  });

  it('state getter runs once, leaves own name untouched, and JS replacement name is unknown', () => {
    const s = setup(); installPermissionsSensor(s.runtime, s.realm);
    const status = new s.realm.PermissionStatus();
    Object.defineProperty(status, 'name', { get() { throw new Error('own name read'); } });
    expect(status.state).toBe('prompt'); expect(s.stateReads()).toBe(1); expect(s.nameReads()).toBe(0);
    expect(s.runtime.snapshot().counters[0]).toMatchObject({ phase: 'returned-sync', signalCodes: ['api-use', 'permission-prompt', 'permission-unknown'] });
  });

  it('late capture does not call even a native-looking Proxy name getter', () => {
    const s = setup(true); let calls = 0;
    const getter = new Proxy(function () { return 'video_capture'; }, { apply() { calls++; return 'video_capture'; } });
    Object.defineProperty(s.realm.PermissionStatus.prototype, 'name', { configurable: true, get: getter });
    installPermissionsSensor(s.runtime, s.realm);
    expect(new s.realm.PermissionStatus().state).toBe('prompt'); expect(calls).toBe(0);
    expect(s.runtime.snapshot().counters[0]?.signalCodes).toContain('permission-unknown');
  });

  it('a data name descriptor cannot expose an inherited get accessor during capture', () => {
    const s = setup(); let inheritedReads = 0;
    Object.defineProperty(s.realm.PermissionStatus.prototype, 'name', { configurable: true, value: 'PRIVATE_NAME_CANARY' });
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'get');
    Object.defineProperty(Object.prototype, 'get', { __proto__: null, configurable: true, get() { inheritedReads++; throw new Error('inherited get'); } } as PropertyDescriptor);
    try { installPermissionsSensor(s.runtime, s.realm); void new s.realm.PermissionStatus().state; }
    finally { if (prior) Object.defineProperty(Object.prototype, 'get', prior); else Reflect.deleteProperty(Object.prototype, 'get'); }
    expect(inheritedReads).toBe(0);
    expect(s.runtime.snapshot().counters[0]?.signalCodes).toContain('permission-unknown');
    expect(JSON.stringify(s.runtime.snapshot())).not.toContain('PRIVATE_NAME_CANARY');
  });

  it('failed state read does not supplement name; original receiver error is unchanged', () => {
    const s = setup();
    Object.defineProperty(s.realm.PermissionStatus.prototype, 'state', { configurable: true, get() { throw s.failure; } });
    installPermissionsSensor(s.runtime, s.realm);
    let caught: unknown; try { void new s.realm.PermissionStatus().state; } catch (error) { caught = error; }
    expect(caught).toBe(s.failure); expect(s.nameReads()).toBe(0);
    expect(s.runtime.snapshot().counters[0]).toMatchObject({ phase: 'threw-sync', signalCodes: ['api-use'] });
  });

  it('opaque or arbitrary state results are passed unchanged and do not become permission facts', () => {
    const s = setup();
    Object.defineProperty(s.realm.PermissionStatus.prototype, 'state', { configurable: true, get() { return s.opaque; } });
    installPermissionsSensor(s.runtime, s.realm);
    expect(new s.realm.PermissionStatus().state).toBe(s.opaque);
    expect(s.runtime.snapshot().counters[0]?.signalCodes).toEqual(['api-use']);
  });

  it.each(['granted', 'denied', 'default'] as const)('Notification.permission preserves %s while mapping default to prompt', value => {
    const s = setup(); let reads = 0;
    Object.defineProperty(s.realm.Notification, 'permission', { configurable: true, get() { reads++; return value; } });
    installPermissionsSensor(s.runtime, s.realm);
    expect(s.realm.Notification.permission).toBe(value); expect(reads).toBe(1);
    expect(s.runtime.snapshot().counters[0]?.signalCodes).toEqual(['api-use', `permission-${value === 'default' ? 'prompt' : value}`, 'permission-notifications'].sort());
  });

  it('policy booleans remain policy facts, never permission grants; arrays and allowlist origins remain opaque', () => {
    const s = setup(); installPermissionsSensor(s.runtime, s.realm); const policy = new s.realm.FeaturePolicy();
    expect(policy.allowsFeature('camera')).toBe(true);
    expect(policy.features()).toBe(s.opaque); expect(policy.allowedFeatures()).toBe(s.opaque);
    expect(policy.getAllowlistForFeature(s.opaque)).toBe(s.opaque);
    expect(s.runtime.snapshot().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({ signalCodes: ['api-use', 'permission-camera', 'policy-allowed'], count: 1 }),
      expect.objectContaining({ signalCodes: ['api-use', 'policy-enumeration'], count: 3 }),
    ]));
  });

  it('blocked policy result retains false and correct policy-only label', () => {
    const s = setup(); s.realm.FeaturePolicy.prototype.allowsFeature = () => false;
    installPermissionsSensor(s.runtime, s.realm);
    expect(new s.realm.FeaturePolicy().allowsFeature('microphone')).toBe(false);
    expect(s.runtime.snapshot().counters[0]?.signalCodes).toEqual(['api-use', 'permission-microphone', 'policy-blocked']);
  });

  it('policy arguments are not coerced and explicit other-origin checks are generic', () => {
    const s = setup(); installPermissionsSensor(s.runtime, s.realm); const policy = new s.realm.FeaturePolicy();
    policy.allowsFeature(s.opaque); policy.allowsFeature('camera', s.opaque); policy.allowsFeature('PRIVATE_CANARY');
    expect(s.runtime.snapshot().counters).toEqual([expect.objectContaining({ signalCodes: ['api-use', 'policy-enumeration'], count: 3 })]);
    expect(JSON.stringify(s.runtime.snapshot())).not.toContain('PRIVATE_CANARY');
  });

  it('pause, resume, duplicate install and stop preserve ordinary behavior and ownership', () => {
    const s = setup(); const original = Object.getOwnPropertyDescriptor(s.realm.PermissionStatus.prototype, 'state');
    installPermissionsSensor(s.runtime, s.realm); installPermissionsSensor(s.runtime, s.realm);
    const status = new s.realm.PermissionStatus(); void status.state;
    s.runtime.pause(); void status.state; expect(s.runtime.snapshot().counters[0]?.count).toBe(1);
    s.runtime.resume(); void status.state; expect(s.runtime.snapshot().counters[0]?.count).toBe(2);
    s.runtime.stop('local'); expect(Object.getOwnPropertyDescriptor(s.realm.PermissionStatus.prototype, 'state')).toEqual(original);
    expect(s.stateReads()).toBe(3);
  });

  it('page replacements after installation survive cleanup', () => {
    const s = setup(); installPermissionsSensor(s.runtime, s.realm);
    const replacement = () => 'denied';
    Object.defineProperty(s.realm.PermissionStatus.prototype, 'state', { configurable: true, get: replacement });
    s.runtime.stop('local'); expect(Object.getOwnPropertyDescriptor(s.realm.PermissionStatus.prototype, 'state')?.get).toBe(replacement);
  });

  it('observer errors do not change state or result identity', () => {
    const s = setup(); installPermissionsSensor(s.runtime, s.realm);
    vi.spyOn(s.runtime, 'record').mockImplementation(() => { throw new Error('observer failure'); });
    expect(new s.realm.PermissionStatus().state).toBe('prompt');
    expect(new s.realm.Permissions().query()).toBe(s.promise);
    expect(s.runtime.hooks.observerErrors).toBe(2);
  });

  it('nonconfigurable getters stay untouched and absent interfaces are not created', () => {
    const s = setup(); Object.defineProperty(s.realm.PermissionStatus.prototype, 'state', { configurable: false });
    const original = Object.getOwnPropertyDescriptor(s.realm.PermissionStatus.prototype, 'state');
    const result = installPermissionsSensor(s.runtime, s.realm);
    expect(result.results.some(row => row.status === 'unsupported')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(s.realm.PermissionStatus.prototype, 'state')).toEqual(original);
    const empty = {}; const missing = installPermissionsSensor(s.runtime, empty); expect(missing.skipped).toContain('Permissions.query'); expect(empty).toEqual({});
  });

  it('fixed alias normalization never invokes user conversion and keeps motion permissions grouped', () => {
    const input = new Proxy({}, { get() { throw new Error('coercion'); } });
    expect(permissionName(input)).toBe('unknown'); expect(permissionName('video_capture')).toBe('camera');
    expect(permissionName('audio_capture')).toBe('microphone'); expect(permissionName('sensors')).toBe('sensors');
    expect(permissionName('accelerometer')).toBe('unknown'); expect(permissionName('CAMERA')).toBe('unknown');
  });
});
