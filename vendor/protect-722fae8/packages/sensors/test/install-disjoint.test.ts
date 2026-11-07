// Install-disjointness of sensor families (S05, S06; ADR-017 §2, REQ-002): no family may wrap a member that an observer
// (of any family) calls through a getter captured at install time. Otherwise an observer would run another family's
// wrapper (reentrancy, double counting, a page-replaced getter reached from inside an observer). The test installs
// every registered family on one fake realm that carries all of their interfaces, diffs the own descriptors of every
// prototype and checks that the wrapped set and the observer-called set do not intersect. A scenario then drives
// each observer to prove that the listed getters are really the ones observers call.

import { describe, expect, it } from 'vitest';
import { SENSOR_FAMILIES, SensorRuntime, installSensors } from '../src/index';
import { makeEnv } from './helpers';

/** Members that observers call through captured native getters (canvas, audio, permissions). */
const OBSERVER_CALLED: ReadonlyArray<readonly [string, string]> = [
  ['CanvasRenderingContext2D', 'canvas'],
  ['OffscreenCanvasRenderingContext2D', 'canvas'],
  ['DOMException', 'name'],
  ['OfflineAudioContext', 'length'],
  ['OscillatorNode', 'frequency'],
  ['DynamicsCompressorNode', 'threshold'],
  ['AudioNode', 'context'],
  ['PermissionStatus', 'name'],
];

function fullRealm() {
  const getterCalls: Record<string, number> = {};
  const brand = new WeakMap<object, string>();
  const branded = (self: object, kind: string): void => {
    if (brand.get(self) !== kind && !(brand.get(self) ?? '').startsWith(kind + ':')) throw new TypeError('Illegal invocation');
  };
  const spyGetter = (cls: { prototype: object }, key: string, kind: string, value: (self: object) => unknown): void => {
    Object.defineProperty(cls.prototype, key, {
      configurable: true,
      enumerable: true,
      get: function (this: object): unknown {
        getterCalls[kind + '.' + key] = (getterCalls[kind + '.' + key] ?? 0) + 1;
        branded(this, kind);
        return value(this);
      },
    });
  };

  // Canvas family.
  class HTMLCanvasElement {
    get width(): number { return 300; }
    set width(_v: number) { /* native-like */ }
    get height(): number { return 150; }
    set height(_v: number) { /* native-like */ }
    toDataURL(): string { return 'data:'; }
    toBlob(): void { /* native-like */ }
  }
  class CanvasRenderingContext2D {
    fail: unknown = null;
    constructor(readonly owner: object) { brand.set(this, 'CanvasRenderingContext2D'); }
    getImageData(): object {
      if (this.fail !== null) throw this.fail;
      return {};
    }
    measureText(): object { return {}; }
    fillText(): void { /* native-like */ }
    strokeText(): void { /* native-like */ }
    clearRect(): void { /* native-like */ }
  }
  spyGetter(CanvasRenderingContext2D, 'canvas', 'CanvasRenderingContext2D', (self) => (self as CanvasRenderingContext2D).owner);
  class OffscreenCanvas {
    get width(): number { return 300; }
    set width(_v: number) { /* native-like */ }
    get height(): number { return 150; }
    set height(_v: number) { /* native-like */ }
    convertToBlob(): Promise<unknown> { return Promise.resolve({}); }
  }
  class OffscreenCanvasRenderingContext2D {
    constructor(readonly owner: object) { brand.set(this, 'OffscreenCanvasRenderingContext2D'); }
    getImageData(): object { return {}; }
    measureText(): object { return {}; }
    fillText(): void { /* native-like */ }
    strokeText(): void { /* native-like */ }
    clearRect(): void { /* native-like */ }
  }
  spyGetter(OffscreenCanvasRenderingContext2D, 'canvas', 'OffscreenCanvasRenderingContext2D', (self) => (self as OffscreenCanvasRenderingContext2D).owner);
  class FakeDOMException {
    constructor(readonly label: string) { brand.set(this, 'DOMException'); }
  }
  spyGetter(FakeDOMException, 'name', 'DOMException', (self) => (self as FakeDOMException).label);

  // WebGL family.
  class WebGLRenderingContext {
    getParameter(): unknown { return 0; }
    getExtension(): unknown { return null; }
    getSupportedExtensions(): unknown { return []; }
    getShaderPrecisionFormat(): unknown { return null; }
    readPixels(): void { /* native-like */ }
  }

  // Audio family (brand kinds: 'OfflineAudioContext', 'AudioNode:OscillatorNode', 'AudioNode:DynamicsCompressorNode').
  class BaseAudioContext {
    createOscillator(): object { return new OscillatorNode(this); }
    createDynamicsCompressor(): object { return new DynamicsCompressorNode(this); }
  }
  class OfflineAudioContext extends BaseAudioContext {
    constructor() { super(); brand.set(this, 'OfflineAudioContext'); }
    startRendering(): Promise<unknown> { return Promise.resolve(new AudioBuffer()); }
  }
  spyGetter(OfflineAudioContext, 'length', 'OfflineAudioContext', () => 5000);
  class AudioNode {
    constructor(readonly ctx: object, kind: string) { brand.set(this, 'AudioNode:' + kind); }
    connect(...args: unknown[]): unknown { return args.length > 0 ? args[0] : undefined; }
  }
  spyGetter(AudioNode, 'context', 'AudioNode', (self) => (self as AudioNode).ctx);
  class OscillatorNode extends AudioNode {
    constructor(ctx: object) { super(ctx, 'OscillatorNode'); }
  }
  spyGetter(OscillatorNode, 'frequency', 'AudioNode:OscillatorNode', () => ({}));
  class DynamicsCompressorNode extends AudioNode {
    constructor(ctx: object) { super(ctx, 'DynamicsCompressorNode'); }
  }
  spyGetter(DynamicsCompressorNode, 'threshold', 'AudioNode:DynamicsCompressorNode', () => ({}));
  class AnalyserNode extends AudioNode {
    getFloatFrequencyData(): void { /* native-like */ }
    getByteFrequencyData(): void { /* native-like */ }
    getFloatTimeDomainData(): void { /* native-like */ }
    getByteTimeDomainData(): void { /* native-like */ }
  }
  class AudioBuffer {
    getChannelData(): Float32Array { return new Float32Array(1); }
    copyFromChannel(): void { /* native-like */ }
  }

  // Permissions family.
  class PermissionStatus {
    constructor(readonly permission: string) { brand.set(this, 'PermissionStatus'); }
    get state(): string { return 'prompt'; }
  }
  spyGetter(PermissionStatus, 'name', 'PermissionStatus', (self) => (self as PermissionStatus).permission);
  class Permissions {
    query(): Promise<unknown> { return Promise.resolve(new PermissionStatus('camera')); }
  }

  // Environment family (S06): observers call no captured getter; nothing to add to OBSERVER_CALLED.
  class NavigatorUAData {
    get brands(): unknown { return []; }
    get mobile(): boolean { return false; }
    get platform(): string { return 'p'; }
    toJSON(): unknown { return {}; }
    getHighEntropyValues(): Promise<unknown> { return Promise.resolve({}); }
  }
  class Navigator {
    get userAgent(): string { return 'ua'; }
    get platform(): string { return 'p'; }
    get vendor(): string { return 'v'; }
    get language(): string { return 'l'; }
    get languages(): readonly string[] { return ['l']; }
    get hardwareConcurrency(): number { return 4; }
    get deviceMemory(): number { return 8; }
    get userAgentData(): unknown { return new NavigatorUAData(); }
  }
  class Screen {
    get width(): number { return 1; }
    get height(): number { return 1; }
    get availWidth(): number { return 1; }
    get availHeight(): number { return 1; }
    get colorDepth(): number { return 24; }
    get pixelDepth(): number { return 24; }
    get orientation(): unknown { return {}; }
  }

  // Geometry family (S06).
  class Element {
    getBoundingClientRect(): unknown { return {}; }
    getClientRects(): unknown { return []; }
  }
  class HTMLElement extends Element {
    get offsetWidth(): number { return 1; }
    get offsetHeight(): number { return 1; }
  }

  const realm: Record<string, { prototype: object }> = {
    HTMLCanvasElement,
    CanvasRenderingContext2D,
    OffscreenCanvas,
    OffscreenCanvasRenderingContext2D,
    DOMException: FakeDOMException,
    WebGLRenderingContext,
    BaseAudioContext,
    OfflineAudioContext,
    AudioNode,
    OscillatorNode,
    DynamicsCompressorNode,
    AnalyserNode,
    AudioBuffer,
    PermissionStatus,
    Permissions,
    Navigator,
    NavigatorUAData,
    Screen,
    Element,
    HTMLElement,
  };
  return { realm, getterCalls, classes: { CanvasRenderingContext2D, FakeDOMException, OfflineAudioContext, PermissionStatus, AnalyserNode } };
}

type Descriptors = Record<string, Record<PropertyKey, PropertyDescriptor>>;

function descriptors(realm: Record<string, { prototype: object }>): Descriptors {
  const out: Descriptors = {};
  for (const [name, cls] of Object.entries(realm)) out[name] = Object.getOwnPropertyDescriptors(cls.prototype);
  return out;
}

function changedMembers(before: Descriptors, after: Descriptors): string[] {
  const out: string[] = [];
  for (const name of Object.keys(before)) {
    for (const key of Object.keys(before[name]!)) {
      const a = before[name]![key]!;
      const b = after[name]![key]!;
      if (a.value !== b.value || a.get !== b.get || a.set !== b.set) out.push(name + '.' + key);
    }
  }
  return out.sort();
}

describe('install-disjoint families (S05)', () => {
  it('no registered family wraps a member that an observer calls through a captured getter', () => {
    const { realm } = fullRealm();
    const before = descriptors(realm);
    const runtime = new SensorRuntime(makeEnv().env);
    expect(installSensors(runtime, realm)).toEqual(SENSOR_FAMILIES.map((f) => f.id));
    const wrapped = changedMembers(before, descriptors(realm));
    const observerCalled = OBSERVER_CALLED.map(([iface, key]) => iface + '.' + key);
    expect(wrapped.filter((m) => observerCalled.includes(m))).toEqual([]);
    // Sanity: the families did install (one member per family at least) and every observer-called member exists.
    for (const member of [
      'CanvasRenderingContext2D.getImageData',
      'WebGLRenderingContext.readPixels',
      'AudioNode.connect',
      'PermissionStatus.state',
      'Permissions.query',
      // S06: environment and geometry.
      'Navigator.userAgent',
      'Navigator.deviceMemory',
      'NavigatorUAData.getHighEntropyValues',
      'Screen.width',
      'Element.getBoundingClientRect',
      'HTMLElement.offsetWidth',
    ]) {
      expect(wrapped).toContain(member);
    }
    for (const [iface, key] of OBSERVER_CALLED) expect(before[iface]![key]?.get, iface + '.' + key).toBeTypeOf('function');
    expect(runtime.snapshot().flags).toEqual([]);
    expect(runtime.stop('local').cleanup).toBe('complete');
    expect(descriptors(realm)).toEqual(before);
  });

  it('the listed getters are the ones the observers actually call (scenario over all families)', () => {
    const { realm, getterCalls } = fullRealm();
    const runtime = new SensorRuntime(makeEnv().env);
    installSensors(runtime, realm);
    const R = realm as unknown as Record<string, new (...args: never[]) => any>;
    // canvas: a text draw resolves the canvas through the 2D/offscreen `canvas` getters; a throwing readback asks
    // DOMException.name.
    const owner = {};
    new R['CanvasRenderingContext2D']!(owner as never).fillText();
    new R['OffscreenCanvasRenderingContext2D']!(owner as never).fillText();
    const ctx2d = new R['CanvasRenderingContext2D']!(owner as never);
    ctx2d.fail = new R['DOMException']!('SecurityError' as never);
    expect(() => ctx2d.getImageData()).toThrow();
    // audio: oscillator -> compressor on an offline context reads frequency, threshold, context and length.
    const ctx = new R['OfflineAudioContext']!();
    const osc = ctx.createOscillator();
    osc.connect(ctx.createDynamicsCompressor());
    // permissions: a state read asks PermissionStatus.name.
    void new R['PermissionStatus']!('camera' as never).state;
    // environment and geometry (S06): their observers call no captured getter; reading them adds no getter call.
    const before = { ...getterCalls };
    const nav = new R['Navigator']!();
    void nav.userAgent;
    void nav.userAgentData.brands;
    void nav.userAgentData.getHighEntropyValues(['model']);
    void new R['Screen']!().width;
    const el = new R['HTMLElement']!();
    void el.offsetWidth;
    el.getBoundingClientRect();
    expect(getterCalls).toEqual(before);
    for (const member of [
      'CanvasRenderingContext2D.canvas',
      'DOMException.name',
      'OffscreenCanvasRenderingContext2D.canvas',
      'OfflineAudioContext.length',
      'AudioNode:OscillatorNode.frequency',
      'AudioNode:DynamicsCompressorNode.threshold',
      'AudioNode.context',
      'PermissionStatus.name',
    ]) {
      expect(getterCalls[member], member).toBeGreaterThan(0);
    }
    expect(runtime.snapshot().observerErrors).toBe(0);
  });
});
