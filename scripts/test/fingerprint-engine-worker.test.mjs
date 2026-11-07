import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createApiConfiguration, updateApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';
import { prepareFingerprintWorkerSource as prepare, readFingerprintWorkerSource as read } from '../../apps/production-extension/fingerprint-engine-worker.js';

const base = () => ({ ...createApiConfiguration(), antidetectEnabled: true });
function custom(config, id, value, host = null) { const result = updateApiConfiguration(config, id, { mode: 'custom', selected: { kind: 'value', value } }, host); assert.equal(result.ok, true, result.error?.message); return result.value; }
function realm() {
  const context = vm.createContext({});
  vm.runInContext('class WorkerNavigator {} ; globalThis.WorkerNavigator=WorkerNavigator; globalThis.navigator=new WorkerNavigator(); Object.defineProperty(WorkerNavigator.prototype,"hardwareConcurrency",{configurable:true,enumerable:true,get(){if(this!==navigator)throw new TypeError("Illegal invocation");return 8}});', context);
  return context;
}
test('source is an opaque local capability, not a serialized command or forged object', () => {
  const source = prepare(base());
  assert.equal(read({ ...source }), null);
  assert.equal(read(null), null);
  assert.equal(typeof read(source), 'string');
  assert.deepEqual(Object.keys(source).sort(), ['entryCount', 'kind']);
  assert.equal(Object.isFrozen(source), true);
  assert.equal(JSON.stringify(source).includes('stop'), false);
});
test('actual WorkerNavigator hook preserves branding, native once and private restoration without Navigator facade', () => {
  const context = realm(), source = prepare(custom(base(), 'hardware-concurrency', 3));
  const native = vm.runInContext('Object.getOwnPropertyDescriptor(WorkerNavigator.prototype,"hardwareConcurrency").get', context);
  const guard = vm.runInContext(read(source), context);
  assert.equal(vm.runInContext('navigator.hardwareConcurrency', context), 3);
  assert.equal(vm.runInContext('"Navigator" in globalThis', context), false);
  assert.throws(() => vm.runInContext('Object.getOwnPropertyDescriptor(WorkerNavigator.prototype,"hardwareConcurrency").get.call({})', context), /Illegal invocation/);
  assert.equal(vm.runInContext('Object.keys(globalThis).some(key=>/restore|guard|bootstrap/i.test(key))', context), false);
  guard.stop();
  assert.equal(vm.runInContext('navigator.hardwareConcurrency', context), 8);
  assert.equal(vm.runInContext('Object.getOwnPropertyDescriptor(WorkerNavigator.prototype,"hardwareConcurrency").get', context), native);
  guard.stop();
});
test('scope inheritance is exact and disabled site/master install no Worker hooks', () => {
  let config = custom(base(), 'hardware-concurrency', 3);
  config = custom(config, 'hardware-concurrency', 6, 'qa.example');
  const value = (configuration, host) => { const context = realm(); vm.runInContext(read(prepare(configuration, { host })), context); return vm.runInContext('navigator.hardwareConcurrency', context); };
  assert.equal(value(config, 'qa.example'), 6);
  assert.equal(value(config, 'sub.qa.example'), 3);
  config.sites[0].disabled = true;
  assert.equal(value(config, 'qa.example'), 8);
  assert.equal(value({ ...config, antidetectEnabled: false }, 'other.example'), 8);
});
test('original Worker APIs are never fabricated for selected absent Window-only interfaces', () => {
  const context = realm();
  let config = custom(base(), 'screen-width', 1200);
  config = custom(config, 'audio-fingerprint', { seed: '00112233445566778899aabbccddeeff', amplitude: 0.00001 });
  vm.runInContext(read(prepare(config)), context);
  assert.equal(vm.runInContext('"screen" in globalThis || "AudioBuffer" in globalThis || "Navigator" in globalThis', context), false);
});
test('only selected Math/Canvas require their existing session seed; source data cannot close generated code', () => {
  let config = custom(base(), 'math-transcendentals', { algorithm: 'deterministic-ulp-v1', functions: ['sin'] });
  assert.throws(() => prepare(config), /persisted seed/);
  assert.throws(() => prepare(config, { mathSeed: '0'.repeat(63) }), /persisted seed/);
  assert.equal(typeof read(prepare(config, { mathSeed: '0'.repeat(64) })), 'string');
  config = custom(base(), 'navigator-user-agent', '</script>\u2028\u2029');
  const source = read(prepare(config));
  assert.equal(source.includes('</script>'), false);
  assert.doesNotThrow(() => new vm.Script(source));
});
test('configuration/options reject getters without reading them', () => {
  let reads = 0;
  const options = Object.defineProperty({}, 'host', { get() { reads++; return 'qa.example'; } });
  assert.throws(() => prepare(base(), options), /options/); assert.equal(reads, 0);
  assert.throws(() => prepare(base(), { host: 'https://qa.example' }), /host/);
  assert.throws(() => prepare(base(), { script: 'alert(1)' }), /options/);
});
test('null/undefined Math, timezone and Intl profiles fail validation before builder field access', () => {
  for (const id of ['math-transcendentals', 'timezone', 'intl-formatting']) for (const kind of ['null', 'undefined']) {
    const config = base();
    config.apis = config.apis.map(row => row.id === id ? { ...row, mode: 'custom', selected: { kind } } : row);
    assert.throws(() => prepare(config), error => error instanceof TypeError && error.message === 'Invalid fingerprint Worker configuration', id + ':' + kind);
  }
});
function patches() {
  const context = realm();
  context.DOMException = DOMException;
  vm.runInContext(`globalThis.origin='http://qa.example';
    const records=new WeakMap(),images=new WeakMap();
    class ImageData {constructor(){images.set(this,new Uint8ClampedArray([100,110,120,255]));}get data(){return images.get(this);}get width(){return 1;}get height(){return 1;}get colorSpace(){return 'srgb';}}
    class OffscreenCanvasRenderingContext2D {constructor(canvas){records.set(this,canvas);}get canvas(){if(!records.has(this))throw TypeError('brand');return records.get(this);}getContextAttributes(){return{colorSpace:'srgb',colorType:'unorm8'};}getImageData(){if(!records.has(this))throw TypeError('brand');return new ImageData();}}
    class OffscreenCanvas {get width(){return 1;}get height(){return 1;}getContext(type){return type==='2d'?new OffscreenCanvasRenderingContext2D(this):null;}}
    Object.assign(globalThis,{ImageData,OffscreenCanvas,OffscreenCanvasRenderingContext2D});`, context);
  let config = custom(base(), 'math-transcendentals', { algorithm: 'deterministic-ulp-v1', functions: ['sin'] });
  config = custom(config, 'canvas-readback', { algorithm: 'stable-rgb-v1' });
  return { context, source: read(prepare(config, { mathSeed: '01'.repeat(32), canvasSeed: '02'.repeat(32) })) };
}
test('private ledger restores actual snapshot-only Math and Canvas installers on Stop', () => {
  const {context,source}=patches();
  const native=vm.runInContext('({sin:Math.sin,context:OffscreenCanvas.prototype.getContext,image:OffscreenCanvasRenderingContext2D.prototype.getImageData})',context);
  const guard=vm.runInContext(source,context);
  assert.notEqual(vm.runInContext('Math.sin',context),native.sin);
  assert.notEqual(vm.runInContext('OffscreenCanvas.prototype.getContext',context),native.context);
  assert.equal(vm.runInContext('new OffscreenCanvas().getContext("2d").getImageData(0,0,1,1).data[0]!==100',context),true);
  guard.stop();
  assert.equal(vm.runInContext('Math.sin',context),native.sin);
  assert.equal(vm.runInContext('OffscreenCanvas.prototype.getContext',context),native.context);
  assert.equal(vm.runInContext('OffscreenCanvasRenderingContext2D.prototype.getImageData',context),native.image);
  assert.equal(vm.runInContext('new OffscreenCanvas().getContext("2d").getImageData(0,0,1,1).data[0]',context),100);
  guard.stop();
});
test('private ledger preserves later Worker-owned replacements and ignores poisoned descriptor prototypes', () => {
  const {context,source}=patches(),guard=vm.runInContext(source,context);
  const ownMath=vm.runInContext('Math.sin=function laterWorkerMath(){return 42;};Math.sin',context);
  vm.runInContext('globalThis.poisonReads=0;Object.defineProperty(Object.prototype,"get",{configurable:true,get(){poisonReads++;throw Error("poison");}});',context);
  guard.stop();
  assert.equal(vm.runInContext('Math.sin',context),ownMath);
  assert.equal(vm.runInContext('poisonReads',context),0);
  assert.equal(vm.runInContext('new OffscreenCanvas().getContext("2d").getImageData(0,0,1,1).data[0]',context),100);
});
