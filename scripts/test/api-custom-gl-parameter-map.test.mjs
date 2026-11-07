// S4 (surfaces installer): the webgl-capabilities getParameter wrapper resolves pname -> key through a map built once at install,
// not through Object.keys(glNames) on every call. Results must stay identical to the old key-list scan (reference below).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { surfaceFixture } from './surface-test-kit.mjs';

// The installer's own pname table, read from its source so this test cannot drift from it.
const source = readFileSync(new URL('../../apps/production-extension/api-custom-surfaces-runtime.js', import.meta.url), 'utf8');
const GL_NAMES = new Function('return {' + /const glNames = \{([\s\S]*?)\n  \};/.exec(source)[1] + '}')();
const KEYS = Object.keys(GL_NAMES);

// Native values of the synthetic context: strings, numbers and the typed arrays real WebGL returns for the range queries.
const nativeOf = key => key === 'VERSION' ? 'WebGL 1.0 (native)' : key === 'SHADING_LANGUAGE_VERSION' ? 'WebGL GLSL ES 1.0 (native)'
  : key === 'MAX_VIEWPORT_DIMS' ? { type: 'Int32Array', values: [16384, 16384] } : key === 'ALIASED_LINE_WIDTH_RANGE' ? { type: 'Float32Array', values: [1, 8] }
  : key === 'ALIASED_POINT_SIZE_RANGE' ? { type: 'Float32Array', values: [1, 1024] } : 8192;
const selectedOf = (key, index, impossible) => key === 'MAX_TEXTURE_SIZE' ? 4096 : key === 'MAX_VERTEX_ATTRIBS' ? undefined : key === 'MAX_RENDERBUFFER_SIZE' ? 16384 : key === 'VERSION' ? 'WebGL selected' : key === 'SHADING_LANGUAGE_VERSION' ? 'GLSL selected'
  : key === 'MAX_VIEWPORT_DIMS' ? [2048, 1024] : key === 'ALIASED_LINE_WIDTH_RANGE' ? (impossible ? [20, 40] : [2, 4]) : key === 'ALIASED_POINT_SIZE_RANGE' ? [2, 512]
  : index % 3 === 0 ? undefined : index % 2 ? 4096 : 16384;
const parametersOf = impossible => Object.fromEntries(KEYS.map((key, index) => [key, selectedOf(key, index, impossible)]).filter(([, value]) => value !== undefined));

const MOCKS = `(() => {
  const brands = new WeakSet(), natives = ${JSON.stringify(Object.fromEntries(KEYS.map(key => [GL_NAMES[key], nativeOf(key)])))};
  globalThis.keysCalls = 0; globalThis.parameterCalls = 0;
  const original = Object.keys; Object.keys = function keys(object) { keysCalls++; return Reflect.apply(original, this, [object]); };
  class Context {
    constructor() { brands.add(this); }
    getParameter(pname) {
      if (!brands.has(this)) throw new TypeError('Illegal invocation'); parameterCalls++;
      const key = Number(pname) >>> 0, value = natives[key];
      if (value === undefined) return null;
      return value !== null && typeof value === 'object' ? (value.type === 'Int32Array' ? new Int32Array(value.values) : new Float32Array(value.values)) : value;
    }
  }
  globalThis.WebGLRenderingContext = class WebGLRenderingContext extends Context {};
  globalThis.WebGL2RenderingContext = class WebGL2RenderingContext extends Context {};
  globalThis.describe = value => value !== null && typeof value === 'object' && ArrayBuffer.isView(value) ? Object.getPrototypeOf(value) === Int32Array.prototype ? 'Int32Array:' + Array.from(value).join() : Object.getPrototypeOf(value) === Float32Array.prototype ? 'Float32Array:' + Array.from(value).join() : 'view?' : typeof value + ':' + String(value);
})();`;

// The previous implementation, verbatim in behaviour: scan Object.keys(glNames) for the pname, then apply the same selection rules.
function reference(pname, native, parameters) {
  const number = pname;
  for (const key of Object.keys(GL_NAMES)) if (GL_NAMES[key] === number) {
    const selected = parameters[key]; if (selected === undefined || native === null) return describe(native);
    if (typeof native === 'number' && typeof selected === 'number') return describe(Math.min(native, selected));
    if (typeof native === 'string' && typeof selected === 'string') return describe(selected);
    if (Array.isArray(selected) && native && typeof native === 'object') {
      const typed = native.type, values = key === 'MAX_VIEWPORT_DIMS' ? [Math.min(native.values[0], selected[0]), Math.min(native.values[1], selected[1])] : [Math.max(native.values[0], selected[0]), Math.min(native.values[1], selected[1])];
      if (key !== 'MAX_VIEWPORT_DIMS' && values[0] > values[1]) return 'DENIED';
      return typed + ':' + values.join();
    }
    return describe(native);
  }
  return describe(native);
}
function describe(value) {
  if (value !== null && typeof value === 'object' && value.type) return value.type + ':' + value.values.join();
  return typeof value + ':' + String(value);
}

const fixture = impossible => {
  const run = surfaceFixture([{ id: 'webgl-capabilities', value: { parameters: parametersOf(impossible) } }], { mocks: MOCKS });
  run('globalThis.gl = new WebGLRenderingContext(); globalThis.gl2 = new WebGL2RenderingContext();');
  return run;
};
const ask = (run, receiver, pname) => { try { return run('describe(' + receiver + '.getParameter(' + pname + '))'); } catch (error) { if (error.name === 'SecurityError') return 'DENIED'; throw error; } };

test('every pname in the table resolves to the same result as the old key-list scan, for WebGL and WebGL2', () => {
  assert.equal(KEYS.length, 29, 'the table the installer ships');
  assert.equal(new Set(Object.values(GL_NAMES)).size, KEYS.length, 'pnames are unique, so a pname -> key map is equivalent to the scan');
  for (const impossible of [false, true]) {
    const parameters = parametersOf(impossible), run = fixture(impossible);
    for (const receiver of ['gl', 'gl2']) for (const key of KEYS) {
      const native = nativeOf(key);
      assert.equal(ask(run, receiver, GL_NAMES[key]), reference(GL_NAMES[key], native, parameters), receiver + ' ' + key + (impossible ? ' (impossible range)' : ''));
    }
  }
  // Hard-coded anchors, so the reference above cannot silently mirror a bug.
  const run = fixture(false);
  assert.equal(run('gl.getParameter(3379)'), 4096, 'selected below native');
  assert.equal(run('gl.getParameter(34921)'), 8192, 'unselected key keeps the native value');
  assert.equal(run('gl.getParameter(34024)'), 8192, 'selected above native is capped by the native value');
  assert.equal(run('gl.getParameter(7938)'), 'WebGL selected');
  assert.equal(run('describe(gl.getParameter(3386))'), 'Int32Array:2048,1024');
  assert.equal(run('describe(gl.getParameter(33902))'), 'Float32Array:2,4');
  assert.throws(() => fixture(true)('gl.getParameter(33902)'), error => error.name === 'SecurityError');
});

test('unknown and coerced pnames follow the same rules as before', () => {
  const parameters = parametersOf(false), run = fixture(false);
  const cases = [0, 1, 4294967295, -1, 3379.7, 2 ** 32 + 3379, NaN, Infinity, '"3379"', '"7938"', 'undefined', 'null', 'true', '{ valueOf() { return 3379; } }'];
  for (const pname of cases) {
    const text = String(pname);
    const numeric = typeof pname === 'number' ? pname : text === '"3379"' ? 3379 : text === '"7938"' ? 7938 : text === '{ valueOf() { return 3379; } }' ? 3379 : text === 'true' ? 1 : 0;
    if (text.startsWith('{')) { assert.equal(ask(run, 'gl', text), 'undefined:undefined', 'an object argument keeps the opaque path: the native value is withheld'); continue; }
    const known = KEYS.find(key => GL_NAMES[key] === (numeric >>> 0));
    assert.equal(ask(run, 'gl', text), reference(numeric >>> 0, known === undefined ? null : nativeOf(known), parameters), 'pname ' + text);
  }
  assert.throws(() => run('WebGLRenderingContext.prototype.getParameter.call({}, 3379)'), error => error.name === 'TypeError' && /Illegal invocation/.test(error.message));
});

test('the wrapper never rebuilds the key list: Object.keys is not called per getParameter call, and the native runs once per call', () => {
  const run = fixture(false);
  const afterInstall = Number(run('keysCalls'));
  assert.ok(afterInstall >= 1, 'the installer used the (counting) Object.keys it captured, once for the map: ' + afterInstall);
  run('parameterCalls = 0;');
  for (let round = 0; round < 40; round++) for (const key of KEYS) run('gl.getParameter(' + GL_NAMES[key] + ')');
  run('gl.getParameter(12345); gl2.getParameter(12345);');
  assert.equal(Number(run('keysCalls')), afterInstall, 'zero Object.keys calls per getParameter call');
  assert.equal(Number(run('parameterCalls')), 40 * KEYS.length + 2, 'the original ran exactly once per call');
});
