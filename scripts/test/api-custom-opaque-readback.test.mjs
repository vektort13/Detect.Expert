// ADR-087/107: the generated opaque guards for the readback rows withhold every covered readback in an inaccessible opaque realm before
// its native call (AudioBuffer samples, the four AnalyserNode readouts, WebGL readPixels); other methods and accessible realms stay native.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const bundle = id => readFileSync(new URL('../../apps/production-extension/api-custom-opaque.' + id + '.js', import.meta.url), 'utf8');
const READBACKS = {
  'audio-fingerprint': { AudioBuffer: ['getChannelData', 'copyFromChannel'], AnalyserNode: ['getFloatFrequencyData', 'getByteFrequencyData', 'getFloatTimeDomainData', 'getByteTimeDomainData'] },
  'webgl-readback': { WebGLRenderingContext: ['readPixels'], WebGL2RenderingContext: ['readPixels'] },
};
// Every interface gets the covered methods plus one uncovered method; each native records its call.
function realm(protocol, id) {
  const context = vm.createContext({ DOMException });
  vm.runInContext(`globalThis.location = { protocol: ${JSON.stringify(protocol)} }; globalThis.nativeCalls = [];
    for (const [name, methods] of Object.entries(${JSON.stringify(READBACKS[id])})) {
      const Interface = function() {}; Object.defineProperty(globalThis, name, { value: Interface, writable: true, configurable: true });
      for (const method of [...methods, 'uncovered']) Object.defineProperty(Interface.prototype, method, { configurable: true, writable: true, value: function() { nativeCalls.push(name + '.' + method); return 'native'; } });
    }`, context);
  vm.runInContext(bundle(id), context);
  return code => vm.runInContext(code, context);
}

test('opaque realms withhold every covered readback before its native call, AnalyserNode readouts included', () => {
  for (const [id, interfaces] of Object.entries(READBACKS)) for (const protocol of ['about:', 'data:', 'blob:']) {
    const run = realm(protocol, id);
    for (const [name, methods] of Object.entries(interfaces)) {
      for (const method of methods) assert.throws(() => run(`${name}.prototype.${method}.call(new ${name}(), new Float32Array(4))`), error => error.name === 'SecurityError' && /Readback profile unavailable/.test(error.message), `${id} ${protocol} ${name}.${method}`);
      assert.equal(run(`${name}.prototype.uncovered.call(new ${name}())`), 'native', name + '.uncovered stays native');
    }
    assert.equal(run('JSON.stringify(nativeCalls)'), JSON.stringify(Object.keys(interfaces).map(name => name + '.uncovered')), id + ' ' + protocol + ': no covered native ran');
    assert.equal(run(`Object.getOwnPropertyDescriptor(globalThis, Symbol.for('detect.expert/api-custom/value-capture-deny/v1')).value`), true);
  }
});

test('accessible realms and realms without the interfaces are left alone', () => {
  for (const id of Object.keys(READBACKS)) {
    const run = realm('https:', id);
    for (const [name, methods] of Object.entries(READBACKS[id])) for (const method of methods) assert.equal(run(`${name}.prototype.${method}.call(new ${name}())`), 'native');
    const empty = vm.createContext({ DOMException }); vm.runInContext('globalThis.location = { protocol: "about:" };', empty);
    vm.runInContext(bundle(id), empty);
    assert.equal(vm.runInContext('typeof AnalyserNode + typeof AudioBuffer + typeof WebGLRenderingContext', empty), 'undefinedundefinedundefined');
  }
});

// ADR-112: the denial Proxy of an opaque realm refuses to close a prototype cycle through itself with the engine's own TypeError, exactly as the native
// function does, and still denies afterwards (a closed cycle would make every later property read of the function overflow the stack).
const CYCLE = `(fn => {
  const out = {}, native = Object.getPrototypeOf(fn);
  try { Object.setPrototypeOf(fn, fn); out.threw = false; } catch (error) { out.threw = error instanceof TypeError; out.message = String(error.message); }
  out.reads = [typeof fn.name, typeof fn.length, typeof fn.call].join(); out.proto = Object.getPrototypeOf(fn) === native;
  out.other = Reflect.setPrototypeOf(fn, Object.prototype) && Object.getPrototypeOf(fn) === Object.prototype && Reflect.setPrototypeOf(fn, native);
  return out;
})`;
function guarded(id, setup, protocol = 'about:') {
  const context = vm.createContext({ DOMException });
  vm.runInContext(`globalThis.location = { protocol: ${JSON.stringify(protocol)} };\n` + setup, context);
  vm.runInContext(bundle(id), context);
  return code => vm.runInContext(code, context);
}
test('every generated opaque denial Proxy refuses a prototype cycle and keeps denying', () => {
  const cases = [
    ['canvas-readback', `for (const [name, methods] of Object.entries({ CanvasRenderingContext2D: ['getImageData'], OffscreenCanvasRenderingContext2D: ['getImageData'], HTMLCanvasElement: ['toDataURL', 'toBlob'], OffscreenCanvas: ['convertToBlob'] })) {
        const Interface = function() {}; Object.defineProperty(globalThis, name, { value: Interface, writable: true, configurable: true });
        for (const method of methods) Object.defineProperty(Interface.prototype, method, { configurable: true, writable: true, value: function() { return 'native'; } }); }`,
      ['CanvasRenderingContext2D.prototype.getImageData', 'HTMLCanvasElement.prototype.toDataURL', 'HTMLCanvasElement.prototype.toBlob', 'OffscreenCanvas.prototype.convertToBlob']],
    ['audio-fingerprint', `for (const [name, methods] of Object.entries(${JSON.stringify(READBACKS['audio-fingerprint'])})) { const Interface = function() {}; Object.defineProperty(globalThis, name, { value: Interface, writable: true, configurable: true });
        for (const method of methods) Object.defineProperty(Interface.prototype, method, { configurable: true, writable: true, value: function() { return 'native'; } }); }`, ['AudioBuffer.prototype.getChannelData', 'AnalyserNode.prototype.getFloatFrequencyData']],
    ['webgl-readback', `for (const [name, methods] of Object.entries(${JSON.stringify(READBACKS['webgl-readback'])})) { const Interface = function() {}; Object.defineProperty(globalThis, name, { value: Interface, writable: true, configurable: true });
        for (const method of methods) Object.defineProperty(Interface.prototype, method, { configurable: true, writable: true, value: function() { return 'native'; } }); }`, ['WebGLRenderingContext.prototype.readPixels', 'WebGL2RenderingContext.prototype.readPixels']],
    ['math-transcendentals', `Math.sin = function sin(x) { return 'native'; }`, ['Math.sin']],
    ['geolocation', `globalThis.Geolocation = function Geolocation() {}; Geolocation.prototype.getCurrentPosition = function getCurrentPosition() { return 'native'; }; Geolocation.prototype.watchPosition = function watchPosition() { return 'native'; };`, ['Geolocation.prototype.getCurrentPosition', 'Geolocation.prototype.watchPosition']],
  ];
  for (const [id, setup, expressions] of cases) {
    const run = guarded(id, setup);
    for (const expression of expressions) {
      const out = run(CYCLE + '(' + expression + ')');
      assert.equal(out.threw, true, id + ' ' + expression + ': a TypeError, as for a native function'); assert.match(out.message, /cyclic|cycle/i, id + ' ' + expression);
      assert.equal(out.reads, 'string,number,function', id + ' ' + expression + ': properties stay readable'); assert.equal(out.proto, true, id + ' ' + expression); assert.equal(out.other, true, id + ' ' + expression + ': other prototypes are forwarded');
    }
  }
  // The denial is still in force after the attempts.
  const run = guarded('webgl-readback', `for (const [name, methods] of Object.entries(${JSON.stringify(READBACKS['webgl-readback'])})) { const Interface = function() {}; Object.defineProperty(globalThis, name, { value: Interface, writable: true, configurable: true });
    for (const method of methods) Object.defineProperty(Interface.prototype, method, { configurable: true, writable: true, value: function() { return 'native'; } }); }`);
  run(CYCLE + '(WebGLRenderingContext.prototype.readPixels)');
  assert.throws(() => run('WebGLRenderingContext.prototype.readPixels.call(new WebGLRenderingContext(), 0, 0, 1, 1, 6408, 5121, new Uint8Array(4))'), error => error.name === 'SecurityError');
});
