import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { API_MATH_FUNCTIONS } from '../../packages/contracts/src/math-functions.mjs';
import { installMathCustom } from '../../apps/production-extension/api-custom-math-runtime.js';
import { binary64UlpDistance } from './math-transcendentals-fixtures.mjs';

const previous = ['acos', 'acosh', 'asin', 'asinh', 'atan', 'atanh', 'atan2', 'cos', 'cosh', 'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'sin', 'sinh', 'tan', 'tanh', 'pow'];
const extra = ['sqrt', 'cbrt', 'hypot'], seed = '0123456789abcdef'.repeat(4);
const native = Object.defineProperties({}, Object.getOwnPropertyDescriptors(Math));
function fixture(options = {}) {
  const math = Object.defineProperties({}, Object.getOwnPropertyDescriptors(Math));
  options.prepare?.(math);
  const row = { id: 'math-transcendentals', mode: options.mode || 'custom', mathSeed: options.seed || seed,
    value: { algorithm: 'deterministic-ulp-v1', functions: options.functions || extra } };
  const guard = (options.installer || installMathCustom)({ Math: math, origin: options.origin || 'https://math-extra.invalid' }, [row]);
  return { math, guard };
}
const call = (math, name, args) => Reflect.apply(math[name], math, args);

test('Math catalog appends sqrt/cbrt/hypot after stable20 function IDs', () => {
  assert.deepEqual(API_MATH_FUNCTIONS.slice(0, 20), previous);
  assert.deepEqual(API_MATH_FUNCTIONS.slice(20), extra);
  assert.equal(new Set(API_MATH_FUNCTIONS).size, 23); assert.ok(Object.isFrozen(API_MATH_FUNCTIONS));
  const f = fixture({ functions: [...API_MATH_FUNCTIONS] });
  assert.equal(f.guard.snapshot().installed, 23); assert.equal(f.guard.snapshot().unavailable, 0);
});

test('Math three new nonexact primitive results are deterministic adjacent binary64 values', () => {
  const f = fixture();
  for (const [name, args] of [['sqrt', [0.7]], ['cbrt', [0.7]], ['hypot', [0.3, 0.9]]]) {
    const expected = call(native, name, args), result = call(f.math, name, args);
    assert.equal(binary64UlpDistance(result, expected), 1n, name);
    assert.equal(call(f.math, name, args), result, name + ': repeat');
  }
  const vectors = Array.from({ length: 32 }, (_, index) => ['sqrt', [0.123 + index / 97]]);
  const values = options => { const next = fixture(options);return vectors.map(([name, args]) => call(next.math, name, args)); };
  assert.deepEqual(values({}), values({}));
  assert.notDeepEqual(values({}), values({ origin: 'https://other-math.invalid' }));
  assert.notDeepEqual(values({}), values({ seed: 'f'.repeat(64) }));
});

test('Math new hooks preserve literal special/exact results and native signed zero', () => {
  const f = fixture();
  const vectors = [
    ['sqrt', [-0], -0], ['sqrt', [0], 0], ['sqrt', [-1], NaN], ['sqrt', [Infinity], Infinity],
    ['sqrt', [9], 3], ['sqrt', [0.25], 0.5], ['sqrt', [0.015625], 0.125],
    ['cbrt', [-0], -0], ['cbrt', [0], 0], ['cbrt', [-Infinity], -Infinity], ['cbrt', [Infinity], Infinity],
    ['cbrt', [8], 2], ['cbrt', [-8], -2], ['cbrt', [0.125], 0.5], ['cbrt', [-0.125], -0.5],
    ['hypot', [], 0], ['hypot', [-0, -0], 0], ['hypot', [3, 4, 12], 13], ['hypot', [-0.7], 0.7],
    ['hypot', [0, -0.7, -0], 0.7], ['hypot', [0.3, 0.4], 0.5],
    ['hypot', [NaN, Infinity], Infinity], ['hypot', [-Infinity, NaN], Infinity], ['hypot', [NaN, 1], NaN],
    ['hypot', [Number.MIN_VALUE, Number.MIN_VALUE], Number.MIN_VALUE],
    ['hypot', [-0.7, -Number.MIN_VALUE], 0.7], ['hypot', [0.7, Number.MIN_VALUE], 0.7]
  ];
  for (const [name, args, expected] of vectors) {
    assert.ok(Object.is(call(native, name, args), expected), name + ': oracle');
    assert.ok(Object.is(call(f.math, name, args), expected), name + ': custom');
  }
});

test('Math exact binary square/cube roots and Pythagorean scaled triples remain native', () => {
  const f = fixture(); let checked = 0;
  for (let exponent = -100; exponent <= 100; exponent += 5) {
    const value = 2 ** exponent;
    for (const [name, args] of [['sqrt', [value * value]], ['cbrt', [value * value * value]], ['cbrt', [-value * value * value]], ['hypot', [3 * value, 4 * value]], ['hypot', [3 * value, 4 * value, 12 * value]]]) {
      assert.ok(Object.is(call(f.math, name, args), call(native, name, args)), name + ':' + exponent);checked++;
    }
  }
  assert.equal(checked, 205);
});

test('Math exact high-mantissa Pythagorean distances survive inexact intermediate squares', () => {
  const f = fixture(); let exactNative = 0, inexactIntermediate = 0;
  for (let index = 1; index <= 256; index++) {
    const m = 2 ** 26 - index, n = 2 ** 25 - index * 2 - 1, scale = 2 ** -60;
    const a = (m * m - n * n) * scale, b = (2 * m * n) * scale, expected = (m * m + n * n) * scale;
    if (native.hypot(a, b) !== expected) continue;
    exactNative++; if (expected * expected !== a * a + b * b) inexactIntermediate++;
    assert.equal(f.math.hypot(a, b), expected, 'exact binary Pythagorean triple ' + index);
  }
  assert.ok(exactNative > 100);assert.ok(inexactIntermediate > 10);
});

test('Math original receiver/arguments/native operation once, with one user coercion or identical throw', () => {
  for (const name of extra) {
    const receiver = {}, marker = {}; let calls = 0, conversions = 0, gotReceiver, gotArgument;
    const argument = { [Symbol.toPrimitive]() { conversions++;return 0.7; } };
    const f = fixture({ prepare(math) { Object.defineProperty(math, name, { ...Object.getOwnPropertyDescriptor(math, name), value: new Proxy(native[name], {
      apply(target, actualReceiver, args) { calls++;gotReceiver = actualReceiver;gotArgument = args[0];return Reflect.apply(target, actualReceiver, args); }
    }) }); } });
    const args = name === 'hypot' ? [argument, 0.9] : [argument];
    const actual = Reflect.apply(f.math[name], receiver, args);
    assert.equal(calls, 1);assert.equal(conversions, 1);assert.equal(gotReceiver, receiver);assert.equal(gotArgument, argument);
    assert.ok(Object.is(actual, call(native, name, name === 'hypot' ? [0.7, 0.9] : [0.7])));
    assert.throws(() => f.math[name]({ [Symbol.toPrimitive]() { throw marker; } }, 0.9), error => error === marker);
    assert.equal(calls, 2);
    assert.throws(() => f.math[name](1n), error => error instanceof TypeError);
    assert.equal(calls, 3);
  }
});

test('Math variadic inspection is bounded, unary extras stay opaque and function metadata/nonconstructability remain native', () => {
  const f = fixture(); let reads = 0;
  const argument = new Proxy({}, new Proxy({}, { get() { reads++;throw Error('Unused argument'); } }));
  for (const name of ['sqrt', 'cbrt']) {
    f.math[name](0.7, argument);assert.equal(reads, 0);
  }
  const many = Array.from({ length: 33 }, (_, index) => 0.7 + index / 123);
  assert.ok(Object.is(call(f.math, 'hypot', many), call(native, 'hypot', many)));
  for (const name of extra) {
    assert.equal(f.math[name].name, native[name].name);assert.equal(f.math[name].length, native[name].length);
    assert.equal(Object.hasOwn(f.math[name], 'prototype'), false);assert.throws(() => Reflect.construct(f.math[name], [1]), TypeError);
  }
});

test('Math absent/accessor/immutable new functions stay unavailable without getter calls or synthesis', () => {
  let reads = 0;
  const f = fixture({ prepare(math) {
    delete math.sqrt;
    Object.defineProperty(math, 'cbrt', { configurable: true, get() { reads++;throw Error('Page getter'); } });
    Object.defineProperty(math, 'hypot', { value: native.hypot, configurable: false, writable: false });
  } });
  assert.equal(Object.hasOwn(f.math, 'sqrt'), false);assert.equal(reads, 0);assert.equal(f.math.hypot, native.hypot);
  assert.equal(f.guard.snapshot().unavailable, 3);assert.equal(f.guard.snapshot().installed, 0);
  const unselected = fixture({ functions: ['sin'] });for (const name of extra) assert.equal(unselected.math[name], native[name]);
});

test('Math finite sweep retains domains/sign/parity and at most one ULP', () => {
  const f = fixture(); let changed = 0;
  for (let index = 1; index <= 400; index++) for (const name of extra) {
    const value = index / 137;
    const args = name === 'hypot' ? [value, value / 3 + 0.123] : [value];
    const expected = call(native, name, args), actual = call(f.math, name, args);
    assert.ok(Number.isFinite(actual));assert.ok(actual > 0);assert.ok(binary64UlpDistance(expected, actual) <= 1n);
    if (actual !== expected) changed++;
    if (name === 'cbrt') assert.equal(f.math.cbrt(-value), -actual);
    if (name === 'hypot') assert.equal(f.math.hypot(-args[0], -args[1]), actual);
  }
  assert.ok(changed > 200);
});

test('Math appended hooks are serialized and inherited without reading poisoned parent intrinsics or iterators', () => {
  const realm = vm.createContext({});
  vm.runInContext(`const install=(${installMathCustom.toString()}),seed=${JSON.stringify(seed)};
    const make=()=>Object.defineProperties({},Object.getOwnPropertyDescriptors(Math));
    const parent={Math:make(),origin:'https://math-extra.invalid'},child={Math:make(),origin:'https://math-extra.invalid'};
    const rows=[{id:'math-transcendentals',mode:'custom',mathSeed:seed,value:{algorithm:'deterministic-ulp-v1',functions:['sqrt','cbrt','hypot']}}];
    install(parent,rows);const fail=()=>{throw Error('Poisoned intrinsic');};const define=Object.defineProperty;
    Reflect.apply=fail;Object.getOwnPropertyDescriptor=fail;Object.defineProperty=fail;Array.isArray=fail;
    define(Array.prototype,Symbol.iterator,{configurable:true,value:fail});
    globalThis.guard=install(child,rows);globalThis.same=parent.Math.sqrt(.7)===child.Math.sqrt(.7)&&parent.Math.cbrt(.7)===child.Math.cbrt(.7)&&parent.Math.hypot(.3,.9)===child.Math.hypot(.3,.9);`, realm);
  assert.equal(realm.same, true);assert.equal(realm.guard.snapshot().installed, 3);
});
