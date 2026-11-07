import { readFileSync } from 'node:fs';
import { chromium, expect, test, type Browser } from '@playwright/test';

// P09 / REQ-002/005: lab-only prototype, no extension or production classifier.
interface PrototypeState {
  counts: number[]; mask: number; stackReads: number; degraded: boolean; installed: number;
}
interface Prototype {
  snapshot(): PrototypeState;
  reset(): void;
  restore(): void;
  setEnabled(value: boolean): void;
  seedCount(code: number, value: number): void;
}
declare global {
  interface Window {
    __installMathPrototype(mode: string, target?: object): Prototype;
  }
}
let browser: Browser;
const source = readFileSync(new URL('../perf/math/proto-wrap.js', import.meta.url), 'utf8');
test.beforeAll(async () => { browser = await chromium.launch({ channel: 'chromium', headless: true }); });
test.afterAll(async () => { await browser?.close(); });

for (const mode of ['fast', 'naive']) {
  test(`P09 ${mode}: native values, coercion, exceptions, guard, saturation and pause`, async () => {
    const page = await browser.newPage();
    try {
      await page.addScriptTag({ content: source });
      const result = await page.evaluate((selectedMode) => {
        const sin = Math.sin;
        const pow = Math.pow;
        const descriptor = Object.getOwnPropertyDescriptor(Math, 'sin');
        const prototype = window.__installMathPrototype(selectedMode);
        const minusZero = Object.is(Math.sin(-0), -0);
        const nan = Number.isNaN(Math.sin(NaN));
        const stringResult = Reflect.apply(Math.pow, null, ['0.5', '2']) === pow(0.5, 2);
        const sentinel = {};
        let coercions = 0;
        const input = { valueOf() { coercions++; Math.cos(0); return 0.5; } };
        const coerced = Reflect.apply(Math.sin, null, [input]) === sin(0.5);
        const nestedSkipped = prototype.snapshot().counts[1] === 0;
        let sameError = false;
        try { Reflect.apply(Math.sin, null, [{ valueOf() { throw sentinel; } }]); }
        catch (error) { sameError = error === sentinel; }
        let symbolThrows = false;
        try { Reflect.apply(Math.sin, null, [Symbol('input')]); } catch (error) { symbolThrows = error instanceof TypeError; }
        let nonConstructor = false;
        try { Reflect.construct(Math.sin, [0]); } catch (error) { nonConstructor = error instanceof TypeError; }
        prototype.reset();
        prototype.seedCount(0, 2147483646);
        Math.sin(0); Math.sin(0);
        const saturated = prototype.snapshot().counts[0] === 2147483647;
        prototype.reset();
        prototype.setEnabled(false);
        Math.sin(0);
        const paused = prototype.snapshot().mask === 0;
        prototype.setEnabled(true);
        Math.sin(0);
        const resumed = prototype.snapshot();
        const noValues = Object.keys(resumed).sort().join(',') === 'counts,degraded,installed,mask,stackReads';
        prototype.restore();
        return { minusZero, nan, stringResult, coerced, coercions, nestedSkipped, sameError, symbolThrows,
          nonConstructor, saturated, paused, resumed, noValues,
          restored: Math.sin === sin && JSON.stringify(Object.getOwnPropertyDescriptor(Math, 'sin')) === JSON.stringify(descriptor) };
      }, mode);
      expect(result).toMatchObject({ minusZero: true, nan: true, stringResult: true, coerced: true, coercions: 1,
        nestedSkipped: true, sameError: true, symbolThrows: true, nonConstructor: true, saturated: true,
        paused: true, noValues: true, restored: true });
      expect(result.resumed).toMatchObject({ counts: [1, 0, 0, 0, 0, 0, 0, 0, 0], mask: 1, degraded: false,
        stackReads: mode === 'naive' ? 1 : 0 });
    } finally { await page.close(); }
  });
}

test('P09 original receives exact this/arguments once; replacement ownership and frozen descriptors', async () => {
  const page = await browser.newPage();
  try {
    await page.addScriptTag({ content: source });
    const result = await page.evaluate(() => {
      let calls = 0;
      const receiver = {};
      const input = {};
      const output = {};
      let forwarded = false;
      const original = function (this: unknown, ...args: unknown[]) {
        calls++; forwarded = this === receiver && args.length === 3 && args[0] === input && args[1] === undefined && args[2] === 4;
        return output;
      };
      const target = { sin: original };
      Object.defineProperty(target, 'cos', { value: Math.cos, configurable: false });
      const prototype = window.__installMathPrototype('fast', target);
      const identity = Reflect.apply(target.sin, receiver, [input, undefined, 4]) === output;
      const thisTarget = { sin(this: unknown) { 'use strict'; return this; } };
      const thisPrototype = window.__installMathPrototype('fast', thisTarget);
      const exactThis = [undefined, null, 0, 'input'].every((value) => Object.is(Reflect.apply(thisTarget.sin, value, []), value));
      thisPrototype.restore();
      const replacement = () => output;
      target.sin = replacement;
      prototype.restore();
      return { calls, forwarded, identity, exactThis, installed: prototype.snapshot().installed, owned: target.sin === replacement };
    });
    expect(result).toEqual({ calls: 1, forwarded: true, identity: true, exactThis: true, installed: 1, owned: true });
  } finally { await page.close(); }
});

for (const mode of ['fast', 'naive']) {
test(`P09 ${mode}: hostile stack leaves original calls intact and fast observer active`, async () => {
  const page = await browser.newPage();
  try {
    // Capture a hostile stack intrinsic before prototype installation, without exposing raw stacks.
    await page.addScriptTag({ content: 'globalThis.Error = class { get stack() { throw 42; } };' });
    await page.addScriptTag({ content: source });
    const result = await page.evaluate((selectedMode) => {
      let calls = 0;
      const target = { sin() { calls++; return -0; } };
      const prototype = window.__installMathPrototype(selectedMode, target);
      const first = Object.is(target.sin(), -0);
      const second = Object.is(target.sin(), -0);
      return { calls, first, second, snapshot: prototype.snapshot() };
    }, mode);
    expect(result).toMatchObject({ calls: 2, first: true, second: true,
      snapshot: { degraded: mode === 'naive', stackReads: 0, counts: [mode === 'naive' ? 1 : 2, 0, 0, 0, 0, 0, 0, 0, 0] } });
  } finally { await page.close(); }
});
}
