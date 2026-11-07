// Independent semantic vectors; no imports from the spoof implementation.
export const MATH_TRANSCENDENTAL_NAMES = Object.freeze([
  'acos', 'acosh', 'asin', 'asinh', 'atan', 'atanh', 'atan2', 'cos', 'cosh',
  'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'sin', 'sinh', 'tan', 'tanh', 'pow'
]);

export const MATH_UNTOUCHED_NAMES = Object.freeze([
  'cbrt', 'sqrt', 'hypot', 'abs', 'ceil', 'floor', 'round', 'trunc', 'fround',
  'imul', 'clz32', 'min', 'max', 'sign', 'random'
]);

const freezeVector = (name, args, expected, reason) => Object.freeze({
  name, args: Object.freeze(args), expected, reason
});

// Literal special-case expectations, not values obtained from the implementation.
export const MATH_SPEC_CASES = Object.freeze([
  ['acos', [1], 0], ['acos', [2], NaN],
  ['acosh', [1], 0], ['acosh', [0], NaN],
  ['asin', [-0], -0], ['asin', [2], NaN],
  ['asinh', [-0], -0], ['asinh', [-Infinity], -Infinity],
  ['atan', [-0], -0], ['atan', [NaN], NaN],
  ['atanh', [1], Infinity], ['atanh', [-1], -Infinity], ['atanh', [-0], -0],
  ['atan2', [-0, 0], -0], ['atan2', [0, 0], 0], ['atan2', [NaN, 1], NaN],
  ['cos', [-0], 1], ['cos', [Infinity], NaN],
  ['cosh', [-0], 1], ['cosh', [-Infinity], Infinity],
  ['exp', [-0], 1], ['exp', [-Infinity], 0],
  ['expm1', [-0], -0], ['expm1', [-Infinity], -1],
  ['log', [1], 0], ['log', [-0], -Infinity], ['log', [-1], NaN],
  ['log1p', [-0], -0], ['log1p', [-1], -Infinity], ['log1p', [-2], NaN],
  ['log2', [1], 0], ['log2', [-0], -Infinity],
  ['log10', [1], 0], ['log10', [-0], -Infinity],
  ['sin', [-0], -0], ['sin', [-Infinity], NaN],
  ['sinh', [-0], -0], ['sinh', [-Infinity], -Infinity],
  ['tan', [-0], -0], ['tan', [Infinity], NaN],
  ['tanh', [-0], -0], ['tanh', [-Infinity], -1],
  ['pow', [NaN, 0], 1], ['pow', [-1, Infinity], NaN],
  ['pow', [-0, 3], -0], ['pow', [-0, -3], -Infinity],
  ['pow', [-Infinity, -3], -0], ['pow', [-Infinity, -2], 0],
  ['pow', [-1.5, 0.5], NaN]
].map(([name, args, expected]) => freezeVector(name, args, expected, 'ecma-special-case')));

/** Call before installation, or provide captured native functions. */
export function createMathSemanticFixtures(nativeMath = Math) {
  const apply = Reflect.apply;
  const preserve = [];
  const add = (name, args, reason) => preserve.push(freezeVector(
    name, args, apply(nativeMath[name], nativeMath, args), reason
  ));
  const unary = MATH_TRANSCENDENTAL_NAMES.filter(name => name !== 'atan2' && name !== 'pow');
  for (const name of unary) {
    for (const value of [NaN, 0, -0, Infinity, -Infinity]) add(name, [value], 'special-input');
    for (const value of [undefined, null, true, false, '', '0.3', 'not-a-number']) {
      add(name, [value], 'primitive-coercion-native-only');
    }
    add(name, [], 'missing-argument');
  }

  const exactArguments = {
    acos: [[1], [-1]], acosh: [[1]], asin: [[1], [-1]],
    atan: [[1], [-1]], atanh: [[1], [-1]],
    cos: [[Number.MIN_VALUE], [-Number.MIN_VALUE]],
    cosh: [[Number.MIN_VALUE], [-Number.MIN_VALUE]],
    exp: [[-1000], [1000]], expm1: [[-1000], [1000]],
    log: [[1], [-1]], log1p: [[-1], [-2]],
    log2: [[1], [-1]], log10: [[1], [-1]],
    sinh: [[1000], [-1000]], tanh: [[1000], [-1000]]
  };
  for (const [name, values] of Object.entries(exactArguments)) {
    for (const args of values) add(name, args, 'exact-or-range-boundary');
  }

  for (const name of ['asin', 'asinh', 'atan', 'atanh', 'expm1', 'log1p', 'sin', 'sinh', 'tan', 'tanh']) {
    for (const value of [Number.MIN_VALUE, -Number.MIN_VALUE, 2 ** -1022, -(2 ** -1022), 2 ** -600, -(2 ** -600), 2 ** -30, -(2 ** -30)]) {
      if (Object.is(apply(nativeMath[name], nativeMath, [value]), value)) add(name, [value], 'rounded-input-identity');
    }
  }
  for (const exponent of [-1074, -1022, -100, -1, 0, 1, 52, 53, 100, 1023]) {
    add('log2', [2 ** exponent], 'binary-log-integral-result');
  }
  for (const exponent of [0, 1, 2, 3, 8, 15, 22]) {
    add('log10', [10 ** exponent], 'decimal-log-integral-result');
  }

  const axis = [0, -0, Infinity, -Infinity];
  for (const y of axis) {
    for (const x of [-1, 1, ...axis]) add('atan2', [y, x], 'axis-or-infinite-quadrant');
  }
  for (const x of axis) {
    for (const y of [-1, 1]) add('atan2', [y, x], 'axis-or-infinite-quadrant');
  }
  for (const [y, x] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [NaN, 1], [1, NaN], ['0.3', 2], [2, '0.3']]) {
    add('atan2', [y, x], 'diagonal-nan-or-coercion');
  }
  add('atan2', [], 'missing-arguments');
  add('atan2', [1], 'missing-x');

  for (const base of [NaN, 0, -0, 1, -1, Infinity, -Infinity, 2, -2]) {
    for (const exponent of [NaN, 0, -0, Infinity, -Infinity, 1, -1, 2, -2, 0.5]) {
      add('pow', [base, exponent], 'power-special-or-integral');
    }
  }
  for (const args of [
    [0.25, 1.5], [81 / 256, 0.25], [(3 / 4) ** 32, 1 / 32],
    [0.5, -3], [2, -1022], [2, -1074], [0.25, -0.5],
    [1.25, 3], [0.75, 7], [2.25, 0.5], [1.5, 1 / 1024],
    ['0.3', -3], [0.3, '-3'], [undefined, 0], [1], []
  ]) add('pow', args, 'exact-power-or-conservative-root');

  const probes = {
    acos: [0.12312423423423424], acosh: [1e308], asin: [0.31337], asinh: [1],
    atan: [0.5], atanh: [0.5], atan2: [0.3, 0.7], cos: [10.000000000123],
    cosh: [1], exp: [0.3], expm1: [1], log: [1.3], log1p: [10],
    log2: [1.3], log10: [1.3], sin: [-1e300], sinh: [1], tan: [-1e300],
    tanh: [1], pow: [nativeMath.PI, -100]
  };
  const eligible = MATH_TRANSCENDENTAL_NAMES.map(name => freezeVector(
    name, probes[name], apply(nativeMath[name], nativeMath, probes[name]), 'non-exact-fingerprint-probe'
  ));

  const limits = {
    acos: [0, nativeMath.PI], acosh: [0, Infinity],
    asin: [-nativeMath.PI / 2, nativeMath.PI / 2],
    atan: [-nativeMath.PI / 2, nativeMath.PI / 2],
    atan2: [-nativeMath.PI, nativeMath.PI], cos: [-1, 1], cosh: [1, Infinity],
    exp: [0, Infinity], expm1: [-1, Infinity], sin: [-1, 1], tanh: [-1, 1]
  };
  return Object.freeze({
    preserve: Object.freeze(preserve), eligible: Object.freeze(eligible),
    bounds: Object.freeze(Object.fromEntries(Object.entries(limits).map(([name, values]) => [name, Object.freeze(values)])))
  });
}

// Test-only binary64 oracle, independent of the runtime's Uint32 perturbation.
export function binary64UlpDistance(a, b) {
  if (Number.isNaN(a) || Number.isNaN(b)) throw new TypeError('NaN has no ordered ULP distance');
  const view = new DataView(new ArrayBuffer(8));
  const ordered = value => {
    view.setFloat64(0, value, false);
    const bits = view.getBigUint64(0, false);
    return bits & (1n << 63n) ? ~bits & ((1n << 64n) - 1n) : bits | (1n << 63n);
  };
  const difference = ordered(a) - ordered(b);
  return difference < 0n ? -difference : difference;
}
