import { describe, expect, it } from 'vitest';
import { SensorRuntime } from '../src/runtime';
import { installGeometrySensor } from '../src/geometry';
import { makeEnv } from './helpers';

function setup() {
  const fake = makeEnv();
  const runtime = new SensorRuntime(fake.env);
  const calls: unknown[][] = [];
  const result = new Proxy({}, { get() { throw new Error('must not inspect result'); } });
  const error = new Proxy({}, { get() { throw new Error('must not inspect exception'); } });
  class Element {
    getClientRects(...args: unknown[]) { calls.push([this, ...args]); return result; }
    getBoundingClientRect() { calls.push([this]); throw error; }
  }
  class HTMLElement { get offsetWidth() { calls.push([this]); return -0; } get offsetHeight() { calls.push([this]); return NaN; } }
  class Range { getClientRects() { calls.push([this]); return result; } getBoundingClientRect() { calls.push([this]); return result; } }
  class SVGGraphicsElement { getBBox() { calls.push([this]); return result; } }
  class SVGTextContentElement { getComputedTextLength() { calls.push([this]); return 42.123456; } getSubStringLength(...args: unknown[]) { calls.push([this, ...args]); return 12.987654; } }
  const promise = Promise.resolve();
  let thenReads = 0;
  Object.defineProperty(promise, 'then', { get() { thenReads++; throw new Error('must not inspect promise'); } });
  class FontFaceSet { check(...args: unknown[]) { calls.push([this, ...args]); return false; } load(...args: unknown[]) { calls.push([this, ...args]); return promise; } }
  const realm = { Element, HTMLElement, Range, SVGGraphicsElement, SVGTextContentElement, FontFaceSet,
    queryLocalFonts(...args: unknown[]) { calls.push([this, ...args]); return promise; } };
  const sensor = installGeometrySensor(runtime, realm);
  return { runtime, fake, calls, result, error, realm, sensor, promise, thenReads: () => thenReads };
}

describe('E07-02 geometry and font request facts', () => {
  it('installation performs no measurements and methods preserve receiver, arguments, result and exception identity', () => {
    const s = setup();
    expect(s.calls).toEqual([]);
    const element = new s.realm.Element();
    const hostile = new Proxy({}, { get() { throw new Error('must not inspect argument'); } });
    expect(element.getClientRects(hostile)).toBe(s.result);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]?.[0] === element).toBe(true);
    expect(s.calls[0]?.[1] === hostile).toBe(true);
    let caught: unknown;
    try { element.getBoundingClientRect(); } catch (error) { caught = error; }
    expect(caught).toBe(s.error);
    expect(s.calls).toHaveLength(2);
    expect(s.runtime.snapshot().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({ techniqueId: 'DET-005', phase: 'returned-sync', count: 1 }),
      expect.objectContaining({ techniqueId: 'DET-005', phase: 'threw-sync', count: 1 }),
    ]));
  });

  it('getter observations preserve NaN and -0 without extra layout reads', () => {
    const s = setup();
    const element = new s.realm.HTMLElement();
    expect(Object.is(element.offsetWidth, -0)).toBe(true);
    expect(Number.isNaN(element.offsetHeight)).toBe(true);
    expect(s.calls).toHaveLength(2);
    expect(s.runtime.snapshot().counters[0]).toMatchObject({ techniqueId: 'DET-005', count: 2 });
  });

  it('font promises, request options and strings are not inspected or serialized', () => {
    const s = setup();
    const fonts = new s.realm.FontFaceSet();
    const options = new Proxy({}, { get() { throw new Error('must not inspect configuration'); } });
    expect(fonts.check('CANARY-FONT-NAME', 'CANARY-TEXT')).toBe(false);
    expect(fonts.load('CANARY-FONT-NAME', 'CANARY-TEXT')).toBe(s.promise);
    expect(s.realm.queryLocalFonts(options)).toBe(s.promise);
    expect(s.thenReads()).toBe(0);
    expect(s.calls).toHaveLength(3);
    const counters = s.runtime.snapshot().counters;
    expect(counters).toEqual(expect.arrayContaining([
      expect.objectContaining({ techniqueId: 'DET-008', phase: 'settlement-unobserved', count: 1 }),
      expect.objectContaining({ techniqueId: 'DET-009', phase: 'settlement-unobserved', count: 1 }),
    ]));
    expect(JSON.stringify(counters)).not.toContain('CANARY');
  });

  it('ordinary range and SVG calls remain api-use without storing geometry', () => {
    const s = setup();
    new s.realm.Range().getClientRects();
    new s.realm.SVGGraphicsElement().getBBox();
    new s.realm.SVGTextContentElement().getComputedTextLength();
    expect(s.runtime.snapshot().counters.map(c => c.signalCodes)).toEqual([['api-use'], ['api-use']]);
    expect(JSON.stringify(s.runtime.snapshot().counters)).not.toContain('42.123456');
  });

  it('stop restores only owned hooks and disables counters', () => {
    const s = setup();
    const el = new s.realm.Element();
    const original = s.sensor.results.find(r => r.label === 'getClientRects');
    expect(original?.status).toBe('installed');
    const foreign = () => s.result;
    s.realm.Element.prototype.getClientRects = foreign;
    s.runtime.stop('revoked');
    expect(el.getClientRects).toBe(foreign);
    expect(s.runtime.snapshot().counters).toEqual([]);
  });

  it('missing/hostile interface accessors are never invoked; frozen hooks report their limitation', () => {
    const fake = makeEnv();
    const runtime = new SensorRuntime(fake.env);
    const realm = {};
    Object.defineProperty(realm, 'Element', { get() { throw new Error('page getter'); } });
    const installed = installGeometrySensor(runtime, realm);
    expect(installed.results).toEqual([]);
    const target = { getClientRects() { return null; } };
    Object.defineProperty(target, 'getClientRects', { configurable: false });
    function Element() {}
    Element.prototype = target;
    installGeometrySensor(runtime, { Element });
    expect(runtime.snapshot().flags).toContain('descriptor-nonconfigurable');
  });

  it('late Array.push replacement cannot leave installed wrappers outside runtime cleanup', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    class Element { getClientRects() { return null; } }
    const original = Element.prototype.getClientRects;
    const push = Object.getOwnPropertyDescriptor(Array.prototype, 'push')!;
    let sensor;
    try {
      Object.defineProperty(Array.prototype, 'push', { ...push, value() { throw new Error('hostile push'); } });
      sensor = installGeometrySensor(runtime, { Element });
    } finally { Object.defineProperty(Array.prototype, 'push', push); }
    expect(sensor.results).toHaveLength(1);
    expect(Element.prototype.getClientRects).not.toBe(original);
    expect(runtime.stop('local').cleanup).toBe('complete');
    expect(Element.prototype.getClientRects).toBe(original);
  });

  it('a hostile later interface cannot orphan earlier hooks; paused and stopped installs do nothing', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    class Element { getClientRects() { return null; } }
    const original = Element.prototype.getClientRects;
    const realm = new Proxy({ Element }, { getOwnPropertyDescriptor(target, key) {
      if (key === 'Range') throw new Error('hostile descriptor');
      return Reflect.getOwnPropertyDescriptor(target, key);
    } });
    runtime.pause();
    expect(installGeometrySensor(runtime, realm).results).toEqual([]);
    expect(Element.prototype.getClientRects).toBe(original);
    runtime.resume();
    expect(installGeometrySensor(runtime, realm).results).toHaveLength(1);
    expect(runtime.snapshot().flags).toContain('hook-failed');
    expect(runtime.stop('local').cleanup).toBe('complete');
    expect(Element.prototype.getClientRects).toBe(original);
    expect(installGeometrySensor(runtime, realm).results).toEqual([]);
  });
});
