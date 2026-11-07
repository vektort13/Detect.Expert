import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installMathCustom } from '../../apps/production-extension/api-custom-math-runtime.js';
import { MATH_TRANSCENDENTAL_NAMES as names, MATH_UNTOUCHED_NAMES, MATH_SPEC_CASES,
  createMathSemanticFixtures, binary64UlpDistance } from './math-transcendentals-fixtures.mjs';

const seed = '0123456789abcdef'.repeat(4);
const native = Object.defineProperties({}, Object.getOwnPropertyDescriptors(Math));
const fixtures = createMathSemanticFixtures(native);
const profile = (functions = [...names]) => ({ algorithm: 'deterministic-ulp-v1', functions });
const entry = (patch = {}) => ({ id: 'math-transcendentals', mode: 'custom', value: profile(), mathSeed: seed, ...patch });
function fixture(options = {}) {
  const math = Object.defineProperties({}, Object.getOwnPropertyDescriptors(Math));
  if (options.prepare) options.prepare(math);
  const realm = { Math: math, origin: options.origin ?? 'https://example.test' };
  const installation = (options.installer ?? installMathCustom)(realm, options.entries ?? [entry(options.entry)]);
  return { realm, math, installation };
}
const call = (math, vector) => Reflect.apply(math[vector.name], math, vector.args);

test('all 20 functions use exactly one adjacent binary64 value for independent fingerprint probes', () => {
  const f = fixture();
  assert.equal(f.installation.snapshot().installed, 20);
  assert.equal(f.installation.snapshot().unavailable, 0);
  for (const vector of fixtures.eligible) {
    const result = call(f.math, vector);
    assert.equal(binary64UlpDistance(result, vector.expected), 1n, vector.name);
    assert.equal(call(f.math, vector), result, vector.name + ' deterministic repeat');
  }
});

test('504 independent native-compatibility cases retain exact identity and signed zero', () => {
  const f = fixture();
  assert.ok(fixtures.preserve.length >= 500);
  for (const vector of fixtures.preserve) assert.ok(Object.is(call(f.math, vector), vector.expected), vector.name + ':' + vector.reason + ':' + String(vector.args));
});

test('literal ECMAScript cases validate both original and wrapped functions', () => {
  const f = fixture();
  assert.ok(MATH_SPEC_CASES.length >= 49);
  for (const vector of MATH_SPEC_CASES) {
    assert.ok(Object.is(call(native, vector), vector.expected), 'native:' + vector.name);
    assert.ok(Object.is(call(f.math, vector), vector.expected), 'wrapped:' + vector.name);
  }
});

test('site/origin and browser-session seeds separate deterministic output vectors', () => {
  const result = options => { const f = fixture(options); return fixtures.eligible.map(vector => call(f.math, vector)); };
  const first = result({});
  assert.deepEqual(result({}), first);
  assert.notDeepEqual(result({ origin: 'https://other.test' }), first);
  assert.notDeepEqual(result({ origin: 'http://example.test' }), first);
  assert.notDeepEqual(result({ origin: 'https://example.test:8443' }), first);
  assert.notDeepEqual(result({ entry: { mathSeed: 'a' + seed.slice(1) } }), first, 'first key half participates');
  assert.notDeepEqual(result({ entry: { mathSeed: seed.slice(0, 63) + 'a' } }), first, 'second key half participates');
});

test('Allow and Bypass never read dormant profile fields or install wrappers; ON reports unsupported', () => {
  for (const mode of ['off', 'bypass']) {
    let reads = 0;
    const row = { id: 'math-transcendentals', mode, get value() { reads++; throw new Error('dormant'); }, get mathSeed() { reads++; throw new Error('dormant'); } };
    const f = fixture({ entries: [row] });
    assert.equal(f.math.sin, native.sin); assert.equal(reads, 0); assert.equal(f.installation.snapshot().installed, 0);
  }
  const on = fixture({ entry: { mode: 'on' } });
  assert.equal(on.math.sin, native.sin); assert.equal(on.installation.snapshot().unavailable, 1);
});

test('empty selection, absent record and unrelated records do not install any Math hook', () => {
  for (const options of [{ entry: { value: profile([]) } }, { entries: [] }, { entries: [{ id: 'webrtc', mode: 'custom', value: {} }] }]) {
    const f = fixture(options); assert.equal(f.math.sin, native.sin); assert.equal(f.installation.snapshot().installed, 0);
  }
});

test('a selected function leaves unselected functions and all exact/utility Math operations unchanged', () => {
  const f = fixture({ entry: { value: profile(['sin']) } });
  assert.notEqual(f.math.sin, native.sin);
  for (const name of [...names.filter(name => name !== 'sin'), ...MATH_UNTOUCHED_NAMES]) assert.equal(f.math[name], native[name], name);
  assert.equal(f.math.sqrt(9), 3); assert.equal(f.math.imul(0xffffffff, 5), -5);
});

test('selected sqrt preserves standard SQRT2 and SQRT1_2 identities while projecting unrelated inexact inputs', () => {
  const f = fixture({ entry: { value: profile(['sqrt']) } });
  assert.equal(f.math.sqrt(2), f.math.SQRT2);
  assert.equal(f.math.sqrt(.5), f.math.SQRT1_2);
  assert.equal(f.math.sqrt(4), 2);
  assert.equal(Object.is(f.math.sqrt(-0), -0), true);
  assert.equal(Number.isNaN(f.math.sqrt(-2)), true);
  assert.equal(binary64UlpDistance(f.math.sqrt(.7), native.sqrt(.7)), 1n);
});

test('invalid seeds, algorithms, duplicate names/records and unsupported names install nothing', () => {
  const cases = [
    { entry: { mathSeed: undefined } }, { entry: { mathSeed: '1'.repeat(63) } }, { entry: { mathSeed: 'A'.repeat(64) } },
    { entry: { value: { algorithm: 'future', functions: ['sin'] } } },
    { entry: { value: profile(['sin', 'sin']) } }, { entry: { value: profile(['fround']) } },
    { entries: [entry(), entry()] }, { entry: { value: profile(new Array(1)) } },
  ];
  for (const options of cases) {
    const f = fixture(options); assert.equal(f.math.sin, native.sin); assert.equal(f.installation.snapshot().installed, 0); assert.ok(f.installation.snapshot().unavailable > 0);
  }
});

test('configuration accessors are never invoked and missing origin never gets a shared fallback key', () => {
  let reads = 0;
  const access = { id: 'math-transcendentals', mode: 'custom', get value() { reads++; throw 0; } };
  const f = fixture({ entries: [access] }); assert.equal(reads, 0); assert.equal(f.math.sin, native.sin);
  const math = Object.defineProperties({}, Object.getOwnPropertyDescriptors(Math));
  const realm = { Math: math, get origin() { reads++; throw 0; } };
  const result = installMathCustom(realm, [entry()]); assert.equal(reads, 0); assert.equal(result.snapshot().installed, 0); assert.ok(result.snapshot().unavailable > 0);
});

test('native call sees original receiver/arguments once and ignores untouched extra arguments', () => {
  const calls = [], receiver = { marker: 'receiver' }, extra = new Proxy({}, { get() { assert.fail('extra argument read'); } });
  const f = fixture({ prepare(math) {
    Object.defineProperty(math, 'sin', { ...Object.getOwnPropertyDescriptor(math, 'sin'), value: new Proxy(native.sin, {
      apply(target, self, args) { calls.push({ self, args }); return Reflect.apply(target, self, args); }
    }) });
  } });
  const result = Reflect.apply(f.math.sin, receiver, [0.3, extra]);
  assert.equal(calls.length, 1); assert.equal(calls[0].self, receiver); assert.deepEqual(calls[0].args, [0.3, extra]);
  assert.equal(binary64UlpDistance(result, native.sin(0.3)), 1n);
});

test('object and primitive coercion stay exclusively native, including Symbol and BigInt errors', () => {
  const f = fixture();
  for (const name of names) {
    let conversions = 0;
    const numeric = { [Symbol.toPrimitive](hint) { assert.equal(hint, 'number'); conversions++; return 0.3; } };
    const args = name === 'atan2' || name === 'pow' ? [numeric, 0.7] : [numeric];
    const expected = Reflect.apply(native[name], native, [0.3, ...(args.length === 2 ? [0.7] : [])]);
    assert.ok(Object.is(Reflect.apply(f.math[name], {}, args), expected), name); assert.equal(conversions, 1, name);
    for (const nonNumber of ['0.3', 1n, Symbol('test')]) {
      const actualArgs = args.length === 2 ? [nonNumber, 0.7] : [nonNumber];
      if (typeof nonNumber === 'string') assert.ok(Object.is(Reflect.apply(f.math[name], null, actualArgs), Reflect.apply(native[name], null, actualArgs)), name);
      else assert.throws(() => Reflect.apply(f.math[name], null, actualArgs), TypeError, name);
    }
  }
});

test('native exception identity and conversion order survive without observer reads', () => {
  const sentinel = new Error('NATIVE_SENTINEL'), reads = [];
  const f = fixture();
  const first = { [Symbol.toPrimitive]() { reads.push('first'); return 0.3; } };
  const second = { [Symbol.toPrimitive]() { reads.push('second'); throw sentinel; } };
  for (const name of ['atan2', 'pow']) {
    reads.length = 0;
    assert.throws(() => f.math[name](first, second), error => error === sentinel); assert.deepEqual(reads, ['first', 'second']);
  }
  const alternate = fixture({ prepare(math) { Object.defineProperty(math, 'sin', { ...Object.getOwnPropertyDescriptor(math, 'sin'), value() { throw sentinel; } }); } });
  assert.throws(() => alternate.math.sin(0.3), error => error === sentinel);
});

test('unexpected native result objects are returned without coercion or added promise handlers', () => {
  const result = new Proxy({}, { get() { assert.fail('native result read'); } });
  const f = fixture({ prepare(math) { Object.defineProperty(math, 'sin', { ...Object.getOwnPropertyDescriptor(math, 'sin'), value: () => result }); } });
  assert.equal(f.math.sin(0.3), result);
});

test('function descriptors/name/length/nonconstructibility and Math own-key order are retained', () => {
  const before = Reflect.ownKeys(native), f = fixture();
  assert.deepEqual(Reflect.ownKeys(f.math), before);
  for (const name of names) {
    const original = Object.getOwnPropertyDescriptor(native, name), actual = Object.getOwnPropertyDescriptor(f.math, name);
    for (const key of ['configurable', 'enumerable', 'writable']) assert.equal(actual[key], original[key], name + ':' + key);
    assert.equal(actual.value.name, original.value.name, name); assert.equal(actual.value.length, original.value.length, name);
    assert.deepEqual(Reflect.ownKeys(actual.value), Reflect.ownKeys(original.value), name);
    assert.equal(Object.hasOwn(actual.value, 'prototype'), false, name); assert.throws(() => Reflect.construct(actual.value, [1, 2]), TypeError, name);
  }
});

test('Function.prototype.toString is never changed and no native restore handle is returned', () => {
  const original = Function.prototype.toString, beforeKeys = Reflect.ownKeys(globalThis), f = fixture();
  assert.equal(Function.prototype.toString, original); assert.deepEqual(Reflect.ownKeys(globalThis), beforeKeys);
  assert.deepEqual(Object.keys(f.installation), ['snapshot']);
  const serialized = JSON.stringify(f.installation.snapshot());
  assert.equal(serialized.includes(seed), false); assert.equal(serialized.includes('https://'), false);
  assert.deepEqual(Object.keys(f.installation.snapshot()).sort(), ['changed', 'functions', 'installed', 'unavailable']);
  for (const row of f.installation.snapshot().functions) assert.deepEqual(Object.keys(row).sort(), ['changed', 'installed', 'name', 'unavailable']);
});

test('immutable installation does not double-apply and retained wrappers do not follow page replacements', () => {
  const f = fixture(), retained = f.math.sin, vector = fixtures.eligible.find(row => row.name === 'sin');
  const expected = call(f.math, vector);
  const second = installMathCustom(f.realm, [entry()]); assert.equal(second.snapshot().installed, 0); assert.equal(f.math.sin, retained);
  f.math.sin = () => 12345; assert.equal(f.math.sin(), 12345); assert.equal(Reflect.apply(retained, null, vector.args), expected);
  const snap = f.installation.snapshot(); snap.changed = -100; snap.functions[0].installed = -100;
  assert.ok(f.installation.snapshot().changed >= 0); assert.ok(f.installation.snapshot().functions[0].installed >= 0);
});

test('missing, accessor-based and immutable functions are not synthesized or invoked', () => {
  let reads = 0;
  const f = fixture({ prepare(math) {
    delete math.sin;
    Object.defineProperty(math, 'cos', { configurable: true, get() { reads++; throw 0; } });
    Object.defineProperty(math, 'tan', { value: native.tan, configurable: false, writable: false });
  } });
  assert.equal(reads, 0); assert.equal(Object.hasOwn(f.math, 'sin'), false); assert.equal(f.math.tan, native.tan);
  assert.equal(f.installation.snapshot().unavailable, 3); assert.equal(f.installation.snapshot().installed, 17);
});

test('signed odd/even parity remains consistent without an additional native call', () => {
  const f = fixture();
  for (const name of ['asin', 'asinh', 'atan', 'atanh', 'sin', 'sinh', 'tan', 'tanh']) for (const x of [0.123, 0.3, 0.7]) {
    assert.equal(f.math[name](-x), -f.math[name](x), name);
  }
  for (const name of ['cos', 'cosh']) for (const x of [0.123, 1.7, 10]) assert.equal(f.math[name](-x), f.math[name](x), name);
});

test('finite domain sweeps preserve range/sign and never exceed one ULP', () => {
  const f = fixture(); let samples = 0;
  let rng = 0x12345678;
  const next = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 0x100000000; };
  for (const name of names) for (let index = 0; index < 1000; index++) {
    const uniform = next(), signed = (uniform - 0.5) * 40;
    let args;
    if (name === 'acos' || name === 'asin' || name === 'atanh') args = [uniform * 2 - 1];
    else if (name === 'acosh') args = [1 + uniform * 1e6];
    else if (name === 'log' || name === 'log2' || name === 'log10') args = [uniform * 1e6 + 1e-12];
    else if (name === 'log1p') args = [uniform * 100 - 0.99];
    else if (name === 'atan2') args = [signed, next() * 40 - 20];
    else if (name === 'pow') args = [uniform * 8 + 1e-12, next() * 30 - 15];
    else args = [signed];
    const expected = Reflect.apply(native[name], native, args), actual = Reflect.apply(f.math[name], f.math, args);
    assert.ok(Number.isFinite(actual), name); assert.ok(binary64UlpDistance(actual, expected) <= 1n, name);
    if (expected !== 0) assert.equal(actual > 0, expected > 0, name);
    if (fixtures.bounds[name]) { assert.ok(actual >= fixtures.bounds[name][0], name); assert.ok(actual <= fixtures.bounds[name][1], name); }
    samples++;
  }
  assert.equal(samples, 20000);
});

test('subnormal/overflow/underflow output edges are never pushed across a finite boundary', () => {
  for (const mathSeed of [seed, 'f'.repeat(64), '0'.repeat(64)]) {
    const f = fixture({ entry: { mathSeed } });
    for (const [name, args] of [['exp', [-745]], ['exp', [-744]], ['exp', [-708.3964185322641]], ['exp', [709.782712893384]],
      ['sinh', [710.4758600739439]], ['pow', [Number.MIN_VALUE, 1]], ['pow', [2, -1074]], ['pow', [Number.MAX_VALUE, 1]], ['log1p', [-Number.MIN_VALUE]]]) {
      const expected = Reflect.apply(native[name], native, args), actual = Reflect.apply(f.math[name], f.math, args);
      if (expected === 0 || !Number.isFinite(expected) || Math.abs(expected) < 2 ** -1022) assert.ok(Object.is(actual, expected), name);
      else { assert.ok(Number.isFinite(actual), name); assert.ok(binary64UlpDistance(actual, expected) <= 1n, name); }
    }
  }
});

test('binary64 word carry/borrow across mantissa boundaries keeps one ULP for both signs', () => {
  let sawAbove = false, sawBelow = false;
  for (const result of [1.9999999999999998, 2.0000000000000004, -1.9999999999999998, -2.0000000000000004,
    0.49999999999999994, 0.5000000000000001, -0.49999999999999994, -0.5000000000000001]) {
    for (let index = 0; index < 12; index++) {
      const f = fixture({ entry: { mathSeed: index.toString(16).padStart(64, '0') }, prepare(math) {
        Object.defineProperty(math, 'log', { ...Object.getOwnPropertyDescriptor(math, 'log'), value: () => result });
      } });
      const actual = f.math.log(1.3); assert.equal(binary64UlpDistance(actual, result), 1n);
      if (actual > result) sawAbove = true; if (actual < result) sawBelow = true;
    }
  }
  assert.equal(sawAbove, true); assert.equal(sawBelow, true);
});

test('result counters saturate instead of retaining samples or growing without bound', () => {
  const f = fixture({ entry: { value: profile(['sin']) } });
  for (let index = 0; index < 66000; index++) f.math.sin(0.3);
  const snapshot = f.installation.snapshot();
  assert.equal(snapshot.changed, 65535); assert.equal(snapshot.functions.length, 1); assert.equal(snapshot.functions[0].changed, 65535);
});

test('serialized installer is self-contained and child realms reuse captured intrinsics after poisoning', () => {
  const context = vm.createContext({});
  vm.runInContext(`
    const install = (${installMathCustom.toString()});
    const makeMath = () => Object.defineProperties({}, Object.getOwnPropertyDescriptors(Math));
    const parentMath = makeMath(), childMath = makeMath();
    const row = ${JSON.stringify(entry())};
    const realm = {Math: parentMath, origin: 'https://example.test'};
    const first = install(realm, [row]);
    const expected = parentMath.sin(0.3);
    const fail = () => { throw new Error('POISONED_INTRINSIC'); };
    const child = {Math: childMath, origin: 'https://example.test'};
    Object.defineProperty(Object.getPrototypeOf(Uint8Array.prototype),'length',{configurable:true,get:fail});
    Reflect.apply = fail; Object.getOwnPropertyDescriptor = fail; Object.defineProperty = fail;
    Object.getPrototypeOf = fail; Object.freeze = fail; Array.isArray = fail;
    String.prototype.charCodeAt = fail; RegExp.prototype.exec = fail;
    WeakSet.prototype.has = fail; WeakSet.prototype.add = fail;
    Array.prototype[Symbol.iterator] = fail; Math.random = fail;
    globalThis.Proxy = fail; globalThis.ArrayBuffer = fail; globalThis.Float64Array = fail;
    globalThis.Uint32Array = fail; globalThis.Uint8Array = fail; globalThis.WeakSet = fail;
    globalThis.childInstallation = install(child, [row]);
    globalThis.parentResult = parentMath.sin(0.3);
    globalThis.childResult = childMath.sin(0.3);
    globalThis.expectedResult = expected;
  `, context);
  assert.equal(context.childInstallation.snapshot().installed, 20); assert.equal(context.childResult, context.expectedResult); assert.equal(context.parentResult, context.expectedResult);
});

test('captured native origin getter applies to later child realms without reading their page accessor', () => {
  const context = vm.createContext({});
  const result = vm.runInContext(`(() => {
    const install = (${installMathCustom.toString()});
    const origins = new WeakMap();
    const proto = {get origin(){ return origins.get(this); }};
    const make = origin => {const realm=Object.create(proto);realm.Math=Object.defineProperties({},Object.getOwnPropertyDescriptors(Math));origins.set(realm,origin);return realm;};
    const parent = make('https://example.test'), child = make('https://example.test');
    const row = ${JSON.stringify(entry())}; install(parent,[row]);
    Object.defineProperty(child,'origin',{get(){throw new Error('PAGE_ORIGIN');}});
    const result=install(child,[row]);return {installed:result.snapshot().installed,equal:child.Math.sin(0.3)===parent.Math.sin(0.3)};
  })()`, context);
  assert.equal(result.installed, 20); assert.equal(result.equal, true);
});

// Official SipHash-2-4 reference vectors: https://github.com/veorq/SipHash/blob/master/vectors.h
const sipVectors = [
  '726fdb47dd0e0e31','74f839c593dc67fd','0d6c8009d9a94f5a','85676696d7fb7e2d','cf2794e0277187b7','18765564cd99a68d','cbc9466e58fee3ce','ab0200f58b01d137',
  '93f5f5799a932462','9e0082df0ba9e4b0','7a5dbbc594ddb9f3','f4b32f46226bada7','751e8fbc860ee5fb','14ea5627c0843d90','f723ca908e7af2ee','a129ca6149be45e5',
  '3f2acc7f57c29bdb','699ae9f52cbe4794','4bc1b3f0968dd39c','bb6dc91da77961bd','bed65cf21aa2ee98','d0f2cbb02e3b67c7','93536795e3a33e88','a80c038ccd5ccec8',
  'b8ad50c6f649af94','bce192de8a85b8ea','17d835b85bbb15f3','2f2e6163076bcfad','de4daaaca71dc9a5','a6a2506687956571','ad87a3535c49ef28','32d892fad841c342',
  '7127512f72f27cce','a7f32346f95978e3','12e0b01abb051238','15e034d40fa197ae','314dffbe0815a3b4','027990f029623981','cadcd4e59ef40c4d','9abfd8766a33735c',
  '0e3ea96b5304a7d0','ad0c42d6fc585992','187306c89bc215a9','d4a60abcf3792b95','f935451de4f21df2','a9538f0419755787','db9acddff56ca510','d06c98cd5c0975eb',
  'e612a3cb9ecba951','c766e62cfcadaf96','ee64435a9752fe72','a192d576b245165a','0a8787bf8ecb74b2','81b3e73d20b49b6f','7fa8220ba3b2ecea','245731c13ca42499',
  'b78dbfaf3a8d83bd','ea1ad565322a1a0b','60e61c23a3795013','6606d7e446282b93','6ca4ecb15c5f91e1','9f626da15c9625f3','e51b38608ef25f57','958a324ceb064572'
];
test('32-bit SipHash-2-4 matches all 64 official reference vectors', () => {
  installMathCustom({}, []);
  const hash = installMathCustom.__detectExpertMathIntrinsicsV1.sipHash24, output = new Uint32Array(2);
  for (let length = 0; length < sipVectors.length; length++) {
    hash(Uint8Array.from({ length }, (_, i) => i), 0x03020100, 0x07060504, 0x0b0a0908, 0x0f0e0d0c, output);
    const hex = output[1].toString(16).padStart(8, '0') + output[0].toString(16).padStart(8, '0'); assert.equal(hex, sipVectors[length], 'length ' + length);
  }
});

test('SipHash long/high-byte messages match an independent BigInt reference across 256-byte length boundaries', () => {
  const mask = (1n << 64n) - 1n;
  const rotate = (value, bits) => ((value << BigInt(bits)) | (value >> BigInt(64 - bits))) & mask;
  function reference(bytes, key) {
    const k0 = BigInt(key[0]) | BigInt(key[1]) << 32n, k1 = BigInt(key[2]) | BigInt(key[3]) << 32n;
    const v = [k0 ^ 0x736f6d6570736575n, k1 ^ 0x646f72616e646f6dn, k0 ^ 0x6c7967656e657261n, k1 ^ 0x7465646279746573n];
    const round = () => {
      v[0] = (v[0] + v[1]) & mask; v[1] = rotate(v[1], 13) ^ v[0]; v[0] = rotate(v[0], 32);
      v[2] = (v[2] + v[3]) & mask; v[3] = rotate(v[3], 16) ^ v[2];
      v[0] = (v[0] + v[3]) & mask; v[3] = rotate(v[3], 21) ^ v[0];
      v[2] = (v[2] + v[1]) & mask; v[1] = rotate(v[1], 17) ^ v[2]; v[2] = rotate(v[2], 32);
    };
    let position = 0;
    while (position + 8 <= bytes.length) {
      let word = 0n; for (let offset = 0; offset < 8; offset++) word |= BigInt(bytes[position + offset]) << BigInt(8 * offset);
      v[3] ^= word; round(); round(); v[0] ^= word; position += 8;
    }
    let tail = BigInt(bytes.length & 255) << 56n;
    for (let offset = 0; position + offset < bytes.length; offset++) tail |= BigInt(bytes[position + offset]) << BigInt(8 * offset);
    v[3] ^= tail; round(); round(); v[0] ^= tail; v[2] ^= 255n;
    round(); round(); round(); round(); return v[0] ^ v[1] ^ v[2] ^ v[3];
  }
  const hash = installMathCustom.__detectExpertMathIntrinsicsV1.sipHash24, output = new Uint32Array(2);
  for (const key of [[0, 0, 0, 0], [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff], [0xcafebabe, 0x88776655, 0x80000000, 0x12345678]]) {
    for (const length of [0, 1, 7, 8, 9, 63, 64, 127, 255, 256, 257, 511, 512, 4095, 4118]) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 197 + 251) & 255);
      hash(bytes, ...key, output);
      assert.equal(BigInt(output[0]) | BigInt(output[1]) << 32n, reference(bytes, key), 'length=' + length + ', key=' + key);
    }
  }
});

test('everyday decimal results keep their value (pow(10,-1) is 0.1, sqrt(0.49) is 0.7) while genuine transcendental results still shift', () => {
  const f = fixture({ entry: { value: profile([...names, 'sqrt', 'cbrt']) } });
  for (const [name, args] of [['pow', [10, -1]], ['pow', [10, -2]], ['pow', [10, -7]], ['pow', [5, -1]], ['pow', [2, -1]], ['pow', [10, -12]], ['sqrt', [0.49]], ['sqrt', [0.01]], ['cbrt', [0.001]]]) {
    assert.ok(Object.is(call(f.math, { name, args }), native[name](...args)), name + '(' + args + ') must stay the everyday decimal');
  }
  for (const [name, args] of [['sin', [0.7]], ['cos', [1.3]], ['exp', [0.3]], ['log', [3.7]], ['pow', [3.1, 2.7]]]) {
    assert.notEqual(call(f.math, { name, args }), native[name](...args), name + '(' + args + ') still shifts by one binary64 step');
  }
});
