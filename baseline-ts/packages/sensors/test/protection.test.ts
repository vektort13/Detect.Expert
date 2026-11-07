import { describe, expect, it, vi } from 'vitest';
import { installProtection } from '../src/protection';
import { wrapMethod } from '../src/wrap';

describe('ADR-035 explicit API denial semantics', () => {
  it('rejects a Promise without calling the original or reading argument properties', async () => {
    const original = vi.fn();
    const touched = vi.fn(() => { throw new Error('coercion'); });
    const opaque = new Proxy({}, { get: touched, ownKeys: touched });
    const realm = { getScreenDetails: original };
    const installation = installProtection(realm, 'window-management');
    const result = Reflect.apply(realm.getScreenDetails, opaque, [opaque]);
    expect(result).toBeInstanceOf(Promise);
    await expect(result).rejects.toMatchObject({ name: 'NotAllowedError', message: 'Blocked by detect.expert' });
    expect(original).not.toHaveBeenCalled();
    expect(touched).not.toHaveBeenCalled();
    expect(installation.snapshot()).toMatchObject({ installed: 1, blocked: 1, stopped: false });
  });

  it('restores an owned wrapper and preserves original receiver, arguments and Promise identity', () => {
    const promise = Promise.resolve({});
    const receiver = {};
    const argument = {};
    const original = vi.fn(function(this: unknown, passed: unknown) {
      expect(this).toBe(receiver);
      expect(passed).toBe(argument);
      return promise;
    });
    const realm = { getScreenDetails: original };
    const installation = installProtection(realm, 'window-management');
    const retained = realm.getScreenDetails;
    installation.stop();
    expect(realm.getScreenDetails).toBe(original);
    expect(Reflect.apply(retained, receiver, [argument])).toBe(promise);
    expect(original).toHaveBeenCalledTimes(1);
    expect(installation.snapshot().blocked).toBe(0);
  });

  it('does not overwrite a later observer and disables retained denial inside it', () => {
    const failure = {};
    const original = vi.fn(() => { throw failure; });
    const realm = { getScreenDetails: original };
    const installation = installProtection(realm, 'window-management');
    const retained = realm.getScreenDetails;
    const observer = vi.fn(() => Reflect.apply(retained, realm, []));
    realm.getScreenDetails = observer;
    installation.stop();
    expect(realm.getScreenDetails).toBe(observer);
    let caught: unknown;
    try { realm.getScreenDetails(); } catch (error) { caught = error; }
    expect(caught).toBe(failure);
    expect(original).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledTimes(1);
  });

  it('distinguishes callback canvas synchronous denial from offscreen Promise rejection', async () => {
    const canvasRead = vi.fn();
    const offscreenRead = vi.fn();
    const callback = vi.fn();
    const realm = { HTMLCanvasElement: { prototype: { toBlob: canvasRead, toDataURL: canvasRead, captureStream: canvasRead } },
      CanvasRenderingContext2D: { prototype: { getImageData: canvasRead } },
      OffscreenCanvasRenderingContext2D: { prototype: { getImageData: canvasRead } },
      OffscreenCanvas: { prototype: { convertToBlob: offscreenRead } } };
    const installation = installProtection(realm, 'canvas-readback');
    let caught: unknown;
    try { realm.HTMLCanvasElement.prototype.toBlob(callback); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(DOMException);
    expect(caught).toMatchObject({ name: 'SecurityError' });
    await expect(realm.OffscreenCanvas.prototype.convertToBlob()).rejects.toMatchObject({ name: 'SecurityError' });
    expect(callback).not.toHaveBeenCalled();
    expect(canvasRead).not.toHaveBeenCalled();
    expect(offscreenRead).not.toHaveBeenCalled();
    expect(installation.snapshot()).toMatchObject({ installed: 6, unavailable: 0, blocked: 2 });
  });

  it('denies only recognized primitive WebGL context names without coercion and preserves 2d', () => {
    const context = {};
    const original = vi.fn(() => context);
    const getContext = original as (...args: unknown[]) => unknown;
    const realm = { HTMLCanvasElement: { prototype: { getContext } }, OffscreenCanvas: { prototype: { getContext } } };
    const touched = vi.fn();
    const opaque = new Proxy({}, { get: touched });
    const installation = installProtection(realm, 'webgl');
    for (const name of ['webgl', 'webgl2', 'experimental-webgl']) expect(realm.HTMLCanvasElement.prototype.getContext(name, opaque)).toBeNull();
    expect(original).not.toHaveBeenCalled();
    expect(realm.HTMLCanvasElement.prototype.getContext('2d', opaque)).toBe(context);
    expect(realm.HTMLCanvasElement.prototype.getContext(opaque)).toBe(context);
    expect(realm.HTMLCanvasElement.prototype.getContext()).toBe(context);
    expect(realm.OffscreenCanvas.prototype.getContext('experimental-webgl')).toBe(context);
    expect(original).toHaveBeenCalledTimes(4);
    expect(touched).not.toHaveBeenCalled();
    expect(installation.snapshot().blocked).toBe(3);
  });

  it('resolves WebGPU adapter absence and Idle permission denial with native Promise shapes', async () => {
    const adapter = vi.fn();
    class Idle { static requestPermission = vi.fn(); start = vi.fn(); }
    Object.defineProperty(Idle.prototype, 'start', { configurable: true, value: vi.fn() });
    const realm = { GPU: { prototype: { requestAdapter: adapter } }, IdleDetector: Idle };
    installProtection(realm, 'webgpu');
    installProtection(realm, 'idle-detection');
    await expect(realm.GPU.prototype.requestAdapter()).resolves.toBeNull();
    await expect(realm.IdleDetector.requestPermission()).resolves.toBe('denied');
    await expect(Reflect.apply(Idle.prototype.start, {}, [])).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(adapter).not.toHaveBeenCalled();
  });

  it.each(['compute-pressure', 'local-fonts', 'clipboard-read'] as const)('returns a rejected Promise for %s without calling native', async feature => {
    const original = vi.fn();
    const realm = { PressureObserver: { prototype: { observe: original } }, queryLocalFonts: original,
      Clipboard: { prototype: { read: original, readText: original } } };
    const installation = installProtection(realm, feature);
    const call = feature === 'compute-pressure' ? realm.PressureObserver.prototype.observe :
      feature === 'local-fonts' ? realm.queryLocalFonts : realm.Clipboard.prototype.readText;
    await expect(call()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(original).not.toHaveBeenCalled();
    expect(installation.snapshot().blocked).toBe(1);
  });

  it('does not invoke descriptor accessors and leaves nonconfigurable methods alone', () => {
    const getter = vi.fn();
    const original = vi.fn();
    const realm = {};
    Object.defineProperty(realm, 'getScreenDetails', { configurable: false, value: original });
    Object.defineProperty(realm, 'queryLocalFonts', { configurable: true, get: getter });
    expect(installProtection(realm, 'window-management').snapshot()).toMatchObject({ installed: 0, unavailable: 1 });
    expect(installProtection(realm, 'local-fonts').snapshot()).toMatchObject({ installed: 0, unavailable: 1 });
    expect(getter).not.toHaveBeenCalled();
    expect(original).not.toHaveBeenCalled();
  });

  it('removes configurable entry points without constructing devices or forging successful data', () => {
    const constructor = vi.fn();
    const realm = { AudioContext: constructor, OfflineAudioContext: constructor };
    const installation = installProtection(realm, 'audio');
    expect('AudioContext' in realm).toBe(false);
    expect('OfflineAudioContext' in realm).toBe(false);
    expect(constructor).not.toHaveBeenCalled();
    expect(installation.snapshot().removed).toBe(2);
    const replacement = vi.fn();
    realm.AudioContext = replacement;
    installation.stop();
    expect(realm.AudioContext).toBe(replacement);
    expect('OfflineAudioContext' in realm).toBe(false);
  });

  it.each([
    ['webassembly', 'WebAssembly'], ['webrtc', 'RTCPeerConnection'], ['battery', 'getBattery'],
    ['network-information', 'connection'], ['keyboard', 'keyboard'], ['client-hints', 'userAgentData'],
  ] as const)('removes %s at its actual descriptor owner', (feature, key) => {
    const getter = vi.fn();
    const target = Object.create(null) as object;
    Object.defineProperty(target, key, { get: getter, configurable: true });
    const realm = feature === 'webrtc' || feature === 'webassembly' ? target : { Navigator: { prototype: target } };
    const installation = installProtection(realm, feature);
    expect(Object.hasOwn(target, key)).toBe(false);
    expect(installation.snapshot().removed).toBe(1);
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(['observer-first', 'denial-first'] as const)('preserves pass-through and ownership for %s installation order', async order => {
    const result = Promise.resolve({});
    const original = vi.fn(() => result);
    const realm = { getScreenDetails: original };
    const observe = vi.fn();
    const firstObserver = order === 'observer-first' ? wrapMethod(realm, 'getScreenDetails', observe) : null;
    const denial = installProtection(realm, 'window-management');
    const secondObserver = order === 'denial-first' ? wrapMethod(realm, 'getScreenDetails', observe) : null;
    await expect(realm.getScreenDetails()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(original).not.toHaveBeenCalled();
    const retained = realm.getScreenDetails;
    denial.stop();
    expect(retained()).toBe(result);
    expect(original).toHaveBeenCalledTimes(1);
    const observer = firstObserver ?? secondObserver;
    expect(observer?.status).toBe('installed');
    if (observer?.status === 'installed') expect(observer.restore()).toBe(true);
    expect(realm.getScreenDetails()).toBe(result);
    expect(original).toHaveBeenCalledTimes(2);
  });

  it('uses captured intrinsics after late page replacement of Promise, Reflect and Object methods', async () => {
    const original = vi.fn();
    const realm = { getScreenDetails: original };
    const installation = installProtection(realm, 'window-management');
    const originalReject = Promise.reject;
    const originalApply = Reflect.apply;
    const originalGet = Object.getOwnPropertyDescriptor;
    const originalDefine = Object.defineProperty;
    let called = false;
    const changed = () => { called = true; throw new Error('late intrinsic called'); };
    let denied: unknown;
    try {
      Promise.reject = changed; Reflect.apply = changed;
      Object.getOwnPropertyDescriptor = changed; Object.defineProperty = changed;
      denied = realm.getScreenDetails();
      installation.stop();
    } finally {
      Promise.reject = originalReject; Reflect.apply = originalApply;
      Object.getOwnPropertyDescriptor = originalGet; Object.defineProperty = originalDefine;
    }
    await expect(denied).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(called).toBe(false);
    expect(realm.getScreenDetails).toBe(original);
    expect(original).not.toHaveBeenCalled();
  });
});