import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { API_CONFIG_CATALOG, API_MATH_FUNCTIONS } from '../../packages/contracts/src/api-configuration.mjs';
import { installWebRtcCustom } from '../../apps/production-extension/api-custom-webrtc-runtime.js';
import { API_CUSTOM_OPAQUE_NEUTRALS, installApiCustomOpaque } from '../../apps/production-extension/api-custom-opaque.entry.js';
import { API_CUSTOM_OPAQUE_IDS, apiCustomOpaqueFile, syncApiCustomOpaque } from '../production/sync-api-custom-opaque.mjs';
import { installApiCustom } from '../../apps/production-extension/api-custom-runtime.js';

function fixture(protocol = 'about:') {
  let reads = 0;
  function Navigator() {}
  Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { configurable: true, get() { reads++; return 32; } });
  Object.defineProperty(Navigator.prototype, 'platform', { configurable: true, get() { return 'Native platform'; } });
  function GPU() {}
  GPU.prototype.requestAdapter = function() { return Promise.resolve({ info: new GPUAdapterInfo() }); };
  function GPUAdapterInfo() {}
  for (const key of ['vendor', 'architecture', 'device', 'description']) Object.defineProperty(GPUAdapterInfo.prototype, key, { configurable: true, get() { return 'Native ' + key; } });
  return { realm: { Object, Array, Promise, location: { protocol }, Navigator, navigator: new Navigator(), GPU, GPUAdapterInfo }, reads: () => reads };
}
const marker = id => Symbol.for('detect.expert/api-custom/opaque/' + id + '/v1');
const captureDeny = Symbol.for('detect.expert/api-custom/value-capture-deny/v1');

test('ADR-049: opaque withholding maps exactly every Custom-supported API and no others', () => {
  const expected = API_CONFIG_CATALOG.filter(entry => entry.customSupported).map(entry => entry.id);
  assert.equal(expected.length, 56);
  assert.deepEqual(API_CUSTOM_OPAQUE_IDS, expected);
  assert.deepEqual(Object.keys(API_CUSTOM_OPAQUE_NEUTRALS).sort(), [...expected].sort());
  for (const id of expected) assert.equal(apiCustomOpaqueFile(id), 'api-custom-opaque.' + id + '.js');
  assert.throws(() => apiCustomOpaqueFile('not-a-supported-api'), /Unknown opaque/);
});
test('specialized opaque installers cannot be preempted by the imported common auto-initializer',()=>{
 for(const id of ['media-capabilities','navigator-metadata','navigator-plugins','screen-geometry','css-media','css-supports','intl-formatting','webgl-capabilities','webgpu-capabilities','canvas-text-metrics','audio-fingerprint','audio-metadata','clock-precision','canvas-font-policy','browser-surface','webgl-readback']){
  const f=fixture();let calls=0;installApiCustomOpaque(f.realm,id);assert.equal(Object.hasOwn(f.realm,marker(id)),false,id);
  installApiCustomOpaque(f.realm,id,null,()=>{calls++;});assert.equal(calls,1,id);assert.equal(Object.hasOwn(f.realm,marker(id)),true,id);installApiCustomOpaque(f.realm,id,null,()=>{calls++;});assert.equal(calls,1,id);
 }
});

test('opaque CPU metadata is withheld synchronously without sampling during installation', () => {
  for (const protocol of ['about:', 'blob:', 'data:']) {
    const f = fixture(protocol);
    assert.equal(installApiCustomOpaque(f.realm, 'hardware-concurrency'), undefined);
    assert.equal(f.reads(), 0);
    assert.equal(f.realm.navigator.hardwareConcurrency, 0);
    assert.equal(f.reads(), 1, 'Native brand/error semantics run once but native value is discarded');
    assert.equal(f.realm.navigator.platform, 'Native platform', 'Other API configuration is untouched');
    const descriptor = Object.getOwnPropertyDescriptor(f.realm, marker('hardware-concurrency'));
    assert.equal(descriptor.value, true); assert.equal(descriptor.writable, false); assert.equal(descriptor.configurable, false);
    assert.equal(Object.hasOwn(f.realm, Symbol.for('detect.expert/api-custom/document/v2')), false);
  }
});

test('normal URL documents and a complete selected profile are never overwritten by neutral guards', () => {
  for (const protocol of ['http:', 'https:', 'file:', 'chrome-extension:', 'moz-extension:']) {
    const f = fixture(protocol); installApiCustomOpaque(f.realm, 'hardware-concurrency');
    assert.equal(f.realm.navigator.hardwareConcurrency, 32); assert.equal(Object.hasOwn(f.realm, marker('hardware-concurrency')), false);
  }
  const f = fixture(); installApiCustom(f.realm, [{ id: 'hardware-concurrency', value: 257 }]);
  Object.defineProperty(f.realm, Symbol.for('detect.expert/api-custom/document/v2'), { value: true });
  installApiCustomOpaque(f.realm, 'hardware-concurrency'); assert.equal(f.realm.navigator.hardwareConcurrency, 257);
});

test('per-API guards compose, install once, retain no public handles and never synthesize absent APIs', () => {
  const f = fixture();
  installApiCustomOpaque(f.realm, 'hardware-concurrency');
  const getter = Object.getOwnPropertyDescriptor(f.realm.Navigator.prototype, 'hardwareConcurrency').get;
  installApiCustomOpaque(f.realm, 'hardware-concurrency');
  assert.equal(Object.getOwnPropertyDescriptor(f.realm.Navigator.prototype, 'hardwareConcurrency').get, getter);
  installApiCustomOpaque(f.realm, 'navigator-platform');
  assert.equal(f.realm.navigator.platform, ''); assert.equal(f.realm.navigator.hardwareConcurrency, 0);
  for (const key of Reflect.ownKeys(f.realm)) if (typeof key === 'symbol') assert.equal(Object.getOwnPropertyDescriptor(f.realm, key).value, true);
  const absent = { location: { protocol: 'about:' } };
  for (const id of API_CUSTOM_OPAQUE_IDS.filter(id => !['math-transcendentals', 'canvas-readback'].includes(id))) installApiCustomOpaque(absent, id, installWebRtcCustom);
  assert.deepEqual(Object.keys(absent), ['location']);
  const symbols = Reflect.ownKeys(absent).filter(key => typeof key === 'symbol');
  assert.equal(symbols.length, API_CUSTOM_OPAQUE_IDS.length - 2 - 16 + 1, 'Generic guards plus preview veto; sixteen specialized guards require their actual installers');
  assert.equal(symbols.includes(captureDeny), true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(absent, captureDeny), { value: true, configurable: false, writable: false, enumerable: false });
});
test('actual packaged specialized opaque bundle executes its installer after importing the common entry',()=>{
 const context=vm.createContext({location:{protocol:'data:'},DOMException});
 vm.runInContext(`globalThis.reads=0;globalThis.BaseAudioContext=class BaseAudioContext{get sampleRate(){reads++;return 96000;}};globalThis.AudioContext=class AudioContext extends BaseAudioContext{};`,context);
 const source=readFileSync(new URL('../../apps/production-extension/api-custom-opaque.audio-metadata.js',import.meta.url),'utf8');vm.runInContext(source,context);
 assert.equal(vm.runInContext('new AudioContext().sampleRate',context),48000);assert.equal(context.reads,1);
});
// Round 5: a configuration without a key system runs the realm's own native call and the neutral all-false record is the answer at once; only
// a key-system configuration still stops at the final type conversion and waits for the private backend, which an opaque document cannot reach.
function opaqueMedia(){
 const timers=new Map(),posted=[];let next=0;
 const context=vm.createContext({location:{protocol:'data:',origin:'null'},origin:'null',DOMException,setTimeout(fn){timers.set(++next,fn);return next;},clearTimeout(id){timers.delete(id);},postMessage(value){posted.push(value);},addEventListener(){},removeEventListener(){}});
 // The model reads the dictionary in the native order: the key system first, the type last.
 vm.runInContext(`globalThis.backends=0;globalThis.MediaCapabilities=class MediaCapabilities{decodingInfo(input){try{const key=input.keySystemConfiguration;if(key!==undefined)String(key.keySystem);String(input.type);backends++;return Promise.resolve({supported:true,smooth:true,powerEfficient:true});}catch(error){return Promise.reject(error);}}encodingInfo(input){return this.decodingInfo(input);}};`,context);
 vm.runInContext(readFileSync(new URL('../../apps/production-extension/api-custom-opaque.media-capabilities.js',import.meta.url),'utf8'),context);
 return{context,timers,posted};
}
test('actual opaque media bundle answers a configuration without a key system at once with the neutral all-false native-shaped record',async()=>{
 const{context,timers,posted}=opaqueMedia();let settled=false;
 const result=vm.runInContext('new MediaCapabilities().decodingInfo({type:"file"})',context);result.then(()=>{settled=true;},()=>{settled=true;});
 for(let index=0;index<8;index++)await Promise.resolve();
 assert.equal(settled,true,'no timer and no private backend is waited for');assert.equal(context.backends,1);assert.equal(posted.length,0);assert.equal(timers.size,0);
 const value=await result;assert.deepEqual(Object.keys(value),['supported','smooth','powerEfficient']);assert.deepEqual([value.supported,value.smooth,value.powerEfficient],[false,false,false]);
 assert.equal(Object.getPrototypeOf(value),vm.runInContext('Object.prototype',context));
});
test('actual opaque media bundle still aborts a key-system configuration before the MAIN backend and fails on a bounded private-backend deadline',async()=>{
 const{context,timers,posted}=opaqueMedia();
 const result=vm.runInContext('new MediaCapabilities().decodingInfo({type:"file",keySystemConfiguration:{keySystem:"owned.test"}})',context);const rejection=assert.rejects(result,error=>error.name==='TimeoutError');
 for(let index=0;index<8;index++)await Promise.resolve();assert.equal(context.backends,0);assert.equal(posted.length,1);assert.equal(timers.size,1);for(const timer of [...timers.values()])timer();await rejection;
});

test('WebGPU withholds both newly requested adapters and borrowed native adapter metadata', async () => {
  const f = fixture(), adapter = new f.realm.GPUAdapterInfo();
  installApiCustomOpaque(f.realm, 'webgpu');
  assert.equal(await new f.realm.GPU().requestAdapter(), null);
  for (const key of ['vendor', 'architecture', 'device', 'description']) {
    const getter = Object.getOwnPropertyDescriptor(f.realm.GPUAdapterInfo.prototype, key).get;
    assert.equal(adapter[key], ''); assert.equal(Reflect.apply(getter, adapter, []), '');
  }
});

test('a later full Custom profile can overlay withheld fields without exposing native through retained guards', () => {
  const f = fixture(); installApiCustomOpaque(f.realm, 'hardware-concurrency');
  const old = Object.getOwnPropertyDescriptor(f.realm.Navigator.prototype, 'hardwareConcurrency').get;
  const overlay = installApiCustom(f.realm, [{ id: 'hardware-concurrency', value: 257 }]);
  assert.equal(f.realm.navigator.hardwareConcurrency, 257);
  assert.equal(Reflect.apply(old, f.realm.navigator, []), 0);
  overlay.stop(); assert.equal(f.realm.navigator.hardwareConcurrency, 0);
});

test('all generated static files are deterministic, current and execute only their own neutral API', async () => {
  const outputs = await syncApiCustomOpaque({ check: true }); assert.equal(outputs.length, API_CUSTOM_OPAQUE_IDS.length + 3);
  assert.deepEqual(outputs.slice(0, API_CUSTOM_OPAQUE_IDS.length).map(row => row.id), API_CUSTOM_OPAQUE_IDS);
  assert.deepEqual(outputs.slice(API_CUSTOM_OPAQUE_IDS.length).map(row => row.file), ['antidetect-block-opaque.webrtc.js', 'antidetect-block-opaque.websocket.js', 'antidetect-block-opaque.webtransport.js']);
  // The 35 extended guards embed the shared serialized installers unminified (auditable output); the live-audit fixes grew them by 17 KiB each, round 3 (storage surfaces, sparse Canvas, mDNS, geolocation) by about 9 KiB each.
  assert.ok(outputs.reduce((sum, output) => sum + output.bytes, 0) < 5.5 * 1024 * 1024, 'Bounded 56-API packaged guards');
  const source = readFileSync(new URL('../../apps/production-extension/' + apiCustomOpaqueFile('hardware-concurrency'), import.meta.url), 'utf8');
  const f = fixture();
  vm.runInNewContext(source, { ...f.realm, Symbol, Object, Reflect, WeakMap, Promise });
  assert.equal(f.realm.navigator.hardwareConcurrency, 0); assert.equal(f.realm.navigator.platform, 'Native platform');
  assert.ok(!source.includes('postMessage('));
  assert.ok(!source.includes('sendMessage('));
});

function mathFixture(protocol = 'about:', prepare = () => {}) {
  const source = readFileSync(new URL('../../apps/production-extension/' + apiCustomOpaqueFile('math-transcendentals'), import.meta.url), 'utf8');
  const context = vm.createContext({ location: { protocol }, DOMException });
  const realm = vm.runInContext('globalThis', context), math = vm.runInContext('Math', context);
  const originals = Object.fromEntries(Reflect.ownKeys(math).map(name => [name, Object.getOwnPropertyDescriptor(math, name)]));
  prepare(realm, math);
  const before = Reflect.ownKeys(realm), result = vm.runInContext(source, context);
  return { realm, math, originals, before, result, source };
}
const denied = error => error instanceof DOMException && error.name === 'SecurityError';

test('dedicated Math static bundle denies all 23 functions in about/data/blob opaque realms', () => {
  for (const protocol of ['about:', 'data:', 'blob:']) {
    const { math } = mathFixture(protocol);
    for (const name of API_MATH_FUNCTIONS) assert.throws(() => Reflect.apply(math[name], math, [0.3, -3]), denied, protocol + name);
  }
});

test('Math static withholding leaves HTTP, HTTPS and extension documents completely native', () => {
  for (const protocol of ['http:', 'https:', 'file:', 'chrome-extension:', 'moz-extension:']) {
    const { math, originals } = mathFixture(protocol);
    for (const name of API_MATH_FUNCTIONS) assert.deepEqual(Object.getOwnPropertyDescriptor(math, name), originals[name], protocol + name);
  }
});

test('opaque Math denial keeps unselected standard constants and utility operations intact', () => {
  const { math, originals } = mathFixture();
  for (const name of Reflect.ownKeys(math).filter(name => !API_MATH_FUNCTIONS.includes(name))) assert.deepEqual(Object.getOwnPropertyDescriptor(math, name), originals[name], String(name));
  assert.equal(math.abs(-0.5), 0.5); assert.equal(math.floor(0.9), 0); assert.equal(math.fround(0.5), 0.5);
});

test('opaque Math denial never converts arguments or calls the captured original', () => {
  let conversions = 0, nativeCalls = 0;
  const argument = { [Symbol.toPrimitive]() { conversions++; throw Error('argument coercion'); } };
  const { math } = mathFixture('data:', (_realm, target) => {
    for (const name of API_MATH_FUNCTIONS) {
      const native = target[name];
      Object.defineProperty(target, name, { value: new Proxy(native, { apply(original, receiver, args) { nativeCalls++; return Reflect.apply(original, receiver, args); } }), configurable: true, writable: true });
    }
  });
  for (const name of API_MATH_FUNCTIONS) assert.throws(() => Reflect.apply(math[name], {}, [argument, argument]), denied, name);
  assert.equal(conversions, 0); assert.equal(nativeCalls, 0);
});

test('opaque Math wrappers retain descriptors and nonconstructibility without exposing stop or native handles', () => {
  const { realm, math, originals, before, result, source } = mathFixture();
  assert.equal(result, undefined); assert.deepEqual(Reflect.ownKeys(realm).filter(key => key !== captureDeny), before);
  assert.deepEqual(Object.getOwnPropertyDescriptor(realm, captureDeny), { value: true, writable: false, configurable: false, enumerable: false });
  assert.deepEqual(Reflect.ownKeys(math), Reflect.ownKeys(originals));
  for (const name of API_MATH_FUNCTIONS) {
    const field = Object.getOwnPropertyDescriptor(math, name), previous = originals[name];
    assert.equal(field.writable, previous.writable); assert.equal(field.enumerable, previous.enumerable); assert.equal(field.configurable, previous.configurable);
    assert.equal(field.value.name, previous.value.name); assert.equal(field.value.length, previous.value.length);
    assert.throws(() => Reflect.construct(field.value, []), { name: 'TypeError' });
    assert.equal(Object.hasOwn(field.value, 'stop'), false); assert.equal(Object.hasOwn(field.value, 'restore'), false);
  }
  assert.equal(source.includes('postMessage('), false); assert.equal(source.includes('sendMessage('), false);
  assert.equal(source.includes('mathSeed'), false);
});

test('a complete synchronously inherited Math profile is not overwritten by the static opaque guard', () => {
  const sentinel = () => 0.12345;
  const { math } = mathFixture('about:', (realm, target) => {
    Object.defineProperty(target, 'sin', { value: sentinel, configurable: true, writable: true });
    Object.defineProperty(realm, Symbol.for('detect.expert/api-custom/document/v2'), { value: true });
  });
  assert.equal(math.sin, sentinel); assert.equal(math.sin(0.3), 0.12345);
});

test('opaque Math guard does not synthesize absent functions or overwrite immutable originals', () => {
  let original;
  const { math } = mathFixture('blob:', (_realm, target) => {
    delete target.sin; original = target.cos;
    Object.defineProperty(target, 'cos', { value: original, configurable: false, writable: false });
  });
  assert.equal(Object.hasOwn(math, 'sin'), false); assert.equal(math.cos, original);
  assert.throws(() => math.tan(0.3), denied);
});

const CANVAS_GUARD_METHODS = [['CanvasRenderingContext2D', 'getImageData'], ['OffscreenCanvasRenderingContext2D', 'getImageData'], ['HTMLCanvasElement', 'toDataURL'], ['HTMLCanvasElement', 'toBlob'], ['OffscreenCanvas', 'convertToBlob']];
function canvasFixture(protocol = 'about:', prepare = () => {}) {
  const source = readFileSync(new URL('../../apps/production-extension/' + apiCustomOpaqueFile('canvas-readback'), import.meta.url), 'utf8');
  const context = vm.createContext({ location: { protocol }, origin: 'null', DOMException });
  vm.runInContext(`let nativeCalls=0;class CanvasRenderingContext2D{getImageData(){nativeCalls++;return 'raw';}measureText(){return 17;}}class OffscreenCanvasRenderingContext2D{getImageData(){nativeCalls++;return 'raw';}}class HTMLCanvasElement{toDataURL(){nativeCalls++;return 'raw';}toBlob(){nativeCalls++;return 'raw';}getContext(){return 'native-context';}}class OffscreenCanvas{convertToBlob(){nativeCalls++;return 'raw';}}Object.assign(globalThis,{CanvasRenderingContext2D,OffscreenCanvasRenderingContext2D,HTMLCanvasElement,OffscreenCanvas});`, context);
  const realm = vm.runInContext('globalThis', context), originals = CANVAS_GUARD_METHODS.map(([name, method]) => Object.getOwnPropertyDescriptor(realm[name].prototype, method));
  prepare(realm); const before = Reflect.ownKeys(realm), result = vm.runInContext(source, context);
  return { realm, source, originals, before, result, nativeCalls: () => vm.runInContext('nativeCalls', context) };
}

test('dedicated Canvas static bundle denies all five covered readbacks in opaque realms despite a forged public marker', () => {
  let conversions = 0; const argument = { [Symbol.toPrimitive]() { conversions++; throw Error('page coercion'); } };
  for (const protocol of ['about:', 'data:', 'blob:']) {
    const f = canvasFixture(protocol, realm => Object.defineProperty(realm, Symbol.for('detect.expert/api-custom/document/v2'), { value: true }));
    for (const [name, method] of CANVAS_GUARD_METHODS) assert.throws(() => Reflect.apply(f.realm[name].prototype[method], {}, [argument, argument]), denied, protocol + name + '.' + method);
    assert.equal(f.nativeCalls(), 0, 'opaque readback never calls its original');
  }
  assert.equal(conversions, 0, 'opaque readback never coerces page arguments');
});

test('Canvas static withholding keeps HTTP and extension documents native and preserves descriptors without exposing handles', () => {
  for (const protocol of ['http:', 'https:', 'file:', 'chrome-extension:', 'moz-extension:']) {
    const f = canvasFixture(protocol);
    for (let index = 0; index < CANVAS_GUARD_METHODS.length; index++) { const [name, method] = CANVAS_GUARD_METHODS[index]; assert.deepEqual(Object.getOwnPropertyDescriptor(f.realm[name].prototype, method), f.originals[index]); }
  }
  const f = canvasFixture(); assert.equal(f.result, undefined); assert.deepEqual(Reflect.ownKeys(f.realm).filter(key => key !== captureDeny), f.before);
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.realm, captureDeny), { value: true, writable: false, configurable: false, enumerable: false });
  for (let index = 0; index < CANVAS_GUARD_METHODS.length; index++) {
    const [name, method] = CANVAS_GUARD_METHODS[index], field = Object.getOwnPropertyDescriptor(f.realm[name].prototype, method), previous = f.originals[index];
    for (const key of ['writable', 'configurable', 'enumerable']) assert.equal(field[key], previous[key]);
    assert.equal(field.value.name, previous.value.name); assert.equal(field.value.length, previous.value.length);
    assert.throws(() => Reflect.construct(field.value, []), { name: 'TypeError' });
    assert.equal(Object.hasOwn(field.value, 'stop'), false); assert.equal(Object.hasOwn(field.value, 'restore'), false);
  }
  assert.equal(new f.realm.CanvasRenderingContext2D().measureText(), 17); assert.equal(new f.realm.HTMLCanvasElement().getContext(), 'native-context');
  for (const token of ['postMessage(', 'sendMessage(', 'canvasSeed', 'restore(']) assert.equal(f.source.includes(token), false, token);
});

test('Canvas guard preserves a synchronously inherited profile and never invents absent or immutable methods', () => {
  const inherited = canvasFixture('about:', realm => { realm.origin = 'https://parent.test'; Object.defineProperty(realm, Symbol.for('detect.expert/api-custom/document/v2'), { value: true }); });
  for (let index = 0; index < CANVAS_GUARD_METHODS.length; index++) { const [name, method] = CANVAS_GUARD_METHODS[index]; assert.equal(inherited.realm[name].prototype[method], inherited.originals[index].value); }
  let retained;
  const f = canvasFixture('data:', realm => { delete realm.OffscreenCanvas; delete realm.HTMLCanvasElement.prototype.toBlob; retained = realm.HTMLCanvasElement.prototype.toDataURL; Object.defineProperty(realm.HTMLCanvasElement.prototype, 'toDataURL', { value: retained, configurable: false, writable: false }); });
  assert.equal(Object.hasOwn(f.realm, 'OffscreenCanvas'), false); assert.equal(Object.hasOwn(f.realm.HTMLCanvasElement.prototype, 'toBlob'), false);
  assert.equal(f.realm.HTMLCanvasElement.prototype.toDataURL, retained);
  assert.throws(() => new f.realm.CanvasRenderingContext2D().getImageData(), denied);
});
