// Geometry sensor (DET-005, task E07-02, S06) on fake Element / HTMLElement interfaces: config modes of the S03
// perf-gate ('wrap' / 'retire' / 'off'), retirement on the retireAfter-th (4096) read restoring the original
// descriptor, saved references after retirement, identity of returned rectangles and exceptions, the observer
// never touches the element (a Proxy receiver runs no trap) and no size reaches a message (REQ-002, REQ-005).

import { describe, expect, it } from 'vitest';
import { BUDGETS } from '@detect-expert/contracts';
import { FAMILY_CONFIG, SensorRuntime, installGeometrySensor } from '../src/index';
import type { FamilyConfig, RuntimeSnapshot } from '../src/index';
import { bridgeHello, deliver, makeEnv } from './helpers';

const WIDTH_CANARY = 7331;
const HEIGHT_CANARY = 6113;
const ILLEGAL = new TypeError('Illegal invocation');

function makeFakes() {
  const branded = new WeakSet<object>();
  const calls = { rect: 0, rects: 0, width: 0, height: 0 };
  const rect = Object.freeze({ x: 1, y: 2, width: WIDTH_CANARY, height: HEIGHT_CANARY });
  const rectList = Object.freeze([rect]);
  class Element {
    constructor() { branded.add(this); }
    getBoundingClientRect(): unknown {
      calls.rect++;
      if (!branded.has(this)) throw ILLEGAL;
      return rect;
    }
    getClientRects(): unknown {
      calls.rects++;
      if (!branded.has(this)) throw ILLEGAL;
      return rectList;
    }
  }
  class HTMLElement extends Element {}
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    enumerable: true,
    get: function (this: object): number {
      calls.width++;
      if (!branded.has(this)) throw ILLEGAL;
      return WIDTH_CANARY;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    enumerable: true,
    get: function (this: object): number {
      calls.height++;
      if (!branded.has(this)) throw ILLEGAL;
      return HEIGHT_CANARY;
    },
  });
  // Not part of the family: must stay untouched.
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, enumerable: true, get: () => 0 });
  const element = new HTMLElement() as HTMLElement & { offsetWidth: number; offsetHeight: number };
  return { realm: { Element, HTMLElement } as Record<string, unknown>, Element, HTMLElement, element, rect, rectList, calls };
}

function rows(snap: RuntimeSnapshot): string[] {
  return snap.counters.map((c) => [c.techniqueId, c.phase, c.signalCodes.join(','), c.operationCode ?? '-', c.count, c.countQuality].join(' ')).sort();
}

function setup(config: FamilyConfig = FAMILY_CONFIG) {
  const fake = makeEnv();
  const runtime = new SensorRuntime(fake.env);
  runtime.start();
  deliver(fake, bridgeHello(runtime));
  const fakes = makeFakes();
  const descriptors = {
    element: Object.getOwnPropertyDescriptors(fakes.Element.prototype),
    html: Object.getOwnPropertyDescriptors(fakes.HTMLElement.prototype),
  };
  const sensor = installGeometrySensor(runtime, fakes.realm, config);
  return { fake, runtime, fakes, sensor, descriptors };
}

describe('installation and modes', () => {
  it("default FAMILY_CONFIG (S03: offset and rect go -> 'wrap') hooks four members permanently", () => {
    expect(FAMILY_CONFIG.offsetGetters).toBe('wrap');
    expect(FAMILY_CONFIG.rectMethods).toBe('wrap');
    const { runtime, sensor, fakes, descriptors } = setup();
    expect(sensor.results.map((r) => r.status + ':' + r.kind + ':' + r.label)).toEqual([
      'installed:method:getBoundingClientRect',
      'installed:method:getClientRects',
      'installed:getter:offsetWidth',
      'installed:getter:offsetHeight',
    ]);
    expect(sensor.skipped).toEqual([]);
    expect(sensor.off).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(fakes.HTMLElement.prototype, 'offsetTop')).toEqual(descriptors.html['offsetTop']);
    expect(runtime.snapshot().flags).toEqual([]);
    expect(fakes.calls).toEqual({ rect: 0, rects: 0, width: 0, height: 0 });
    // 'wrap' never retires: far beyond retireAfter the hook is still ours and the count is exact.
    for (let i = 0; i < FAMILY_CONFIG.retireAfter + 10; i++) void fakes.element.offsetWidth;
    expect(Object.getOwnPropertyDescriptor(fakes.HTMLElement.prototype, 'offsetWidth')!.get).not.toBe(descriptors.html['offsetWidth']!.get);
    expect(rows(runtime.snapshot())).toEqual(['DET-005 returned-sync api-use offset-width ' + String(FAMILY_CONFIG.retireAfter + 10) + ' exact']);
    expect(runtime.stop('local')).toMatchObject({ cleanup: 'complete', restored: ['getBoundingClientRect', 'getClientRects', 'offsetWidth', 'offsetHeight'] });
    expect(Object.getOwnPropertyDescriptors(fakes.HTMLElement.prototype)).toEqual(descriptors.html);
    expect(Object.getOwnPropertyDescriptors(fakes.Element.prototype)).toEqual(descriptors.element);
  });

  it("'off' wraps nothing: descriptors identical, the members are listed as off, reads record nothing", () => {
    const { runtime, sensor, fakes, descriptors } = setup({ ...FAMILY_CONFIG, offsetGetters: 'off', rectMethods: 'off' });
    expect(sensor.results).toEqual([]);
    expect(sensor.off).toEqual(['Element.getBoundingClientRect', 'Element.getClientRects', 'HTMLElement.offsetWidth', 'HTMLElement.offsetHeight']);
    expect(Object.getOwnPropertyDescriptors(fakes.Element.prototype)).toEqual(descriptors.element);
    expect(Object.getOwnPropertyDescriptors(fakes.HTMLElement.prototype)).toEqual(descriptors.html);
    fakes.element.getBoundingClientRect();
    void fakes.element.offsetWidth;
    expect(rows(runtime.snapshot())).toEqual([]);
    expect(runtime.stop('local').cleanup).toBe('none');
  });

  it('one group may be off while the other is on', () => {
    const { runtime, sensor, fakes } = setup({ ...FAMILY_CONFIG, offsetGetters: 'off' });
    expect(sensor.results.map((r) => r.label)).toEqual(['getBoundingClientRect', 'getClientRects']);
    fakes.element.getBoundingClientRect();
    void fakes.element.offsetWidth;
    expect(rows(runtime.snapshot())).toEqual(['DET-005 returned-sync api-use get-bounding-client-rect 1 exact']);
  });

  it('absent interfaces and members are skipped without a flag', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    expect(installGeometrySensor(runtime, {})).toEqual({ results: [], skipped: ['Element', 'HTMLElement'], off: [] });
    class Element {}
    class HTMLElement extends Element {}
    expect(installGeometrySensor(runtime, { Element, HTMLElement }).skipped).toEqual([
      'Element.getBoundingClientRect',
      'Element.getClientRects',
      'HTMLElement.offsetWidth',
      'HTMLElement.offsetHeight',
    ]);
    expect(runtime.snapshot().flags).toEqual([]);
  });
});

describe('observation', () => {
  it('records one operation per member; returned rectangles keep their identity', () => {
    const { runtime, fakes } = setup();
    expect(fakes.element.getBoundingClientRect()).toBe(fakes.rect);
    expect(fakes.element.getClientRects()).toBe(fakes.rectList);
    expect(fakes.element.offsetWidth).toBe(WIDTH_CANARY);
    expect(fakes.element.offsetHeight).toBe(HEIGHT_CANARY);
    expect(fakes.element.offsetHeight).toBe(HEIGHT_CANARY);
    expect(fakes.calls).toEqual({ rect: 1, rects: 1, width: 1, height: 2 });
    expect(rows(runtime.snapshot())).toEqual([
      'DET-005 returned-sync api-use get-bounding-client-rect 1 exact',
      'DET-005 returned-sync api-use get-client-rects 1 exact',
      'DET-005 returned-sync api-use offset-height 2 exact',
      'DET-005 returned-sync api-use offset-width 1 exact',
    ]);
  });

  it('a Proxy receiver runs no trap; the same TypeError instance propagates and is counted threw-sync', () => {
    const { runtime, fakes } = setup();
    const traps: string[] = [];
    const receiver = new Proxy({}, {
      get: (_t, k) => { traps.push('get:' + String(k)); return undefined; },
      has: () => { traps.push('has'); return false; },
      getPrototypeOf: () => { traps.push('getPrototypeOf'); return null; },
      getOwnPropertyDescriptor: () => { traps.push('gOPD'); return undefined; },
    });
    let caught: unknown;
    try {
      Reflect.apply(fakes.Element.prototype.getBoundingClientRect, receiver, []);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(ILLEGAL);
    expect(() => Reflect.get(fakes.HTMLElement.prototype, 'offsetWidth', receiver)).toThrow(ILLEGAL);
    expect(traps).toEqual([]);
    expect(rows(runtime.snapshot())).toEqual([
      'DET-005 threw-sync api-use get-bounding-client-rect 1 exact',
      'DET-005 threw-sync api-use offset-width 1 exact',
    ]);
  });

  it('no size reaches a message or the snapshot (REQ-005)', () => {
    const { fake, runtime, fakes } = setup();
    for (let i = 0; i < 50; i++) {
      fakes.element.getBoundingClientRect();
      void fakes.element.offsetWidth;
      void fakes.element.offsetHeight;
    }
    fake.advance(BUDGETS.flushMaxMs);
    expect(fake.batches().length).toBeGreaterThan(0);
    const wire = JSON.stringify(fake.posted) + JSON.stringify(runtime.snapshot());
    for (const value of [WIDTH_CANARY, HEIGHT_CANARY]) expect(wire.includes(String(value))).toBe(false);
  });
});

describe("retirement ('retire': retireAfter = 4096)", () => {
  const RETIRE: FamilyConfig = Object.freeze({ ...FAMILY_CONFIG, offsetGetters: 'retire', rectMethods: 'retire' });

  it('the 4096th offsetWidth read restores the original descriptor; later and saved-reference reads record nothing', () => {
    expect(RETIRE.retireAfter).toBe(4096);
    const { runtime, fakes, descriptors } = setup(RETIRE);
    const wrapper = Object.getOwnPropertyDescriptor(fakes.HTMLElement.prototype, 'offsetWidth')!.get!;
    for (let i = 0; i < 4095; i++) void fakes.element.offsetWidth;
    expect(Object.getOwnPropertyDescriptor(fakes.HTMLElement.prototype, 'offsetWidth')!.get).toBe(wrapper);
    expect(fakes.element.offsetWidth).toBe(WIDTH_CANARY); // 4096th: recorded, then retired
    expect(Object.getOwnPropertyDescriptor(fakes.HTMLElement.prototype, 'offsetWidth')).toEqual(descriptors.html['offsetWidth']);
    // A reference saved after retirement is the original getter; one saved before it is the wrapper whose
    // observer is off. Neither creates a record; both call the original exactly once.
    const savedAfter = Object.getOwnPropertyDescriptor(fakes.HTMLElement.prototype, 'offsetWidth')!.get!;
    expect(Reflect.apply(savedAfter, fakes.element, [])).toBe(WIDTH_CANARY);
    expect(Reflect.apply(wrapper, fakes.element, [])).toBe(WIDTH_CANARY);
    for (let i = 0; i < 100; i++) void fakes.element.offsetWidth;
    expect(fakes.calls.width).toBe(4096 + 2 + 100);
    expect(rows(runtime.snapshot())).toEqual([
      'DET-005 returned-sync api-use offset-width 4096 lower-bound',
      'DET-005 returned-sync api-use,sample-budget-exceeded offset-width 0 lower-bound',
    ]);
    // offsetHeight keeps its own budget.
    expect(Object.getOwnPropertyDescriptor(fakes.HTMLElement.prototype, 'offsetHeight')!.get).not.toBe(descriptors.html['offsetHeight']!.get);
    const stopped = runtime.stop('local');
    expect(stopped.cleanup).toBe('complete');
    expect(stopped.restored).toContain('offsetWidth');
    expect(Object.getOwnPropertyDescriptors(fakes.HTMLElement.prototype)).toEqual(descriptors.html);
  });

  it('getBoundingClientRect retires on its 4096th call (method)', () => {
    const { runtime, fakes, descriptors } = setup(RETIRE);
    for (let i = 0; i < 4096; i++) fakes.element.getBoundingClientRect();
    expect(Object.getOwnPropertyDescriptor(fakes.Element.prototype, 'getBoundingClientRect')).toEqual(descriptors.element['getBoundingClientRect']);
    fakes.element.getBoundingClientRect();
    expect(rows(runtime.snapshot())).toEqual([
      'DET-005 returned-sync api-use get-bounding-client-rect 4096 lower-bound',
      'DET-005 returned-sync api-use,sample-budget-exceeded get-bounding-client-rect 0 lower-bound',
    ]);
  });
});
