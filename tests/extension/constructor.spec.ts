// P03 / ADR-006 / REQ-001: exercise the real wrapper in the fixture's MAIN realm.
// The probe is page-owned, test-only, and never becomes a production constructor sensor.
import { build } from 'esbuild';
import { expect, launchPlain, startFixtureServer, test as extensionTest } from './harness';
import { observed } from './helpers';
import type { wrapConstructor } from '../../packages/sensors/src/wrap';

// One local origin is sufficient; isolate this probe from the two-origin fixture stand.
const test = extensionTest.extend({
  fixtures: async ({}, use) => {
    const server = await startFixtureServer([4183]);
    try { await use(server); } finally { await server.close(); }
  },
});

function probe({ name, wrapped }: { name: 'Path2D' | 'OffscreenCanvas'; wrapped: boolean }) {
  const Original = window[name];
  const originalPrototypeConstructor = Original.prototype.constructor;
  const args = name === 'Path2D' ? [] : [2, 3];
  const root = window as unknown as { ConstructorHooks: { wrapConstructor: typeof wrapConstructor } };
  let observations = 0;
  let lastError: unknown;
  let observerThrew = false;
  const handle = wrapped ? root.ConstructorHooks.wrapConstructor(window, name, (_args, _target, threw, error) => {
    observations++;
    lastError = error;
    observerThrew = threw;
    throw new Error('test observer failure');
  }) : undefined;
  if (wrapped && handle?.status !== 'installed') throw new Error('constructor hook not installed');
  const Current = window[name];
  const descriptor = (key: 'name' | 'length') => Object.getOwnPropertyDescriptor(Current, key);
  const instance = Reflect.construct(Current, args);
  const originalInstance = Reflect.construct(Original, args);
  class Sub extends (Current as typeof Path2D) {}
  const sub = Reflect.construct(Sub, args);
  const errorFacts = (call: () => unknown) => {
    try { call(); return { threw: false }; } catch (error) {
      if (wrapped && (!observerThrew || lastError !== error)) throw new Error('exception identity changed');
      return { threw: true, name: (error as Error).name, message: (error as Error).message };
    }
  };
  const withoutNew = errorFacts(() => Reflect.apply(Current, {}, args));
  const invalidArgs = errorFacts(() => Reflect.construct(Current, name === 'Path2D' ? [Symbol('invalid')] : []));
  const proxyLog: string[] = [];
  const prototype = {};
  let reads = 0;
  const target = new Proxy(function Target() {}, { get(t, key, receiver) {
    proxyLog.push('get ' + String(key));
    if (key === 'prototype') {
      if (++reads > 1) throw new Error('unexpected second prototype read');
      return prototype;
    }
    return Reflect.get(t, key, receiver);
  } });
  // OffscreenCanvas coercion logs establish ordering relative to the native prototype read.
  const coercingArgs = name === 'Path2D' ? [] : [
    { valueOf() { proxyLog.push('width'); return 2; } },
    { valueOf() { proxyLog.push('height'); return 3; } },
  ];
  const viaProxy = Reflect.construct(Current, coercingArgs, target);
  const trapError = {};
  let throwingReads = 0;
  let sameTrapError = false;
  const throwingTarget = new Proxy(function Target() {}, { get() { throwingReads++; throw trapError; } });
  try { Reflect.construct(Current, args, throwingTarget); } catch (error) {
    sameTrapError = error === trapError;
    if (wrapped && lastError !== error) throw new Error('prototype exception identity changed');
  }
  const facts = {
    name: descriptor('name'), length: descriptor('length'),
    toString: Function.prototype.toString.call(Current),
    prototypeShared: Current.prototype === Original.prototype,
    constructorUnchanged: Current.prototype.constructor === originalPrototypeConstructor,
    instanceOfBoth: instance instanceof Current && instance instanceof Original,
    originalInstanceOfBoth: originalInstance instanceof Current && originalInstance instanceof Original,
    subclass: sub instanceof Sub && sub instanceof Current && sub instanceof Original && Object.getPrototypeOf(sub) === Sub.prototype,
    brand: Object.prototype.toString.call(instance),
    dimensions: name === 'OffscreenCanvas' ? [instance.width, instance.height] : null,
    withoutNew, invalidArgs, proxyLog, reads,
    proxyPrototype: Object.getPrototypeOf(viaProxy) === prototype,
    throwingReads, sameTrapError,
  };
  const detectable = Current !== Original && instance.constructor !== Current;
  const restored = handle?.status === 'installed' ? handle.restore() && window[name] === Original : true;
  return { facts, observations, detectable, restored };
}

for (const name of ['Path2D', 'OffscreenCanvas'] as const) {
  test(`P03 ${name}: native constructor differential in MAIN`, async ({ ext, fixtures }, testInfo) => {
    const bundle = await build({
      entryPoints: ['packages/sensors/src/wrap.ts'], bundle: true, write: false,
      format: 'iife', globalName: 'ConstructorHooks', platform: 'browser', target: 'es2022',
    });
    const plain = await launchPlain();
    try {
      const plainPage = await plain.context.newPage();
      await plainPage.goto(fixtures.origins[0] + '/canvas-editor-negative.html');
      const baseline = await plainPage.evaluate(probe, { name, wrapped: false });
      const { page } = await observed(ext, fixtures.origins[0] + '/canvas-editor-negative.html');
      await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
      const actual = await page.evaluate(probe, { name, wrapped: true });
      const cdp = await ext.context.newCDPSession(page);
      const version = await cdp.send('Browser.getVersion');
      await testInfo.attach('constructor-differential', {
        body: JSON.stringify({ version, baseline, actual }, null, 2), contentType: 'application/json',
      });
      expect(baseline.facts).toMatchObject({
        prototypeShared: true, constructorUnchanged: true, instanceOfBoth: true,
        originalInstanceOfBoth: true, subclass: true, proxyPrototype: true,
        reads: 1, throwingReads: 1, sameTrapError: true,
        withoutNew: { threw: true, name: 'TypeError' }, invalidArgs: { threw: true, name: 'TypeError' },
      });
      // REQ-003: callable Proxy stringification is detectable; do not normalize it away.
      const { toString: baselineToString, ...baselineSemantics } = baseline.facts;
      const { toString: actualToString, ...actualSemantics } = actual.facts;
      expect(baselineToString).toBe(`function ${name}() { [native code] }`);
      expect(actualToString).toBe('function () { [native code] }');
      expect(actualSemantics).toEqual(baselineSemantics);
      expect(actual.observations).toBe(6);
      expect(actual.detectable).toBe(true);
      expect(actual.restored).toBe(true);
    } finally { await plain.close(); }
  });
}
