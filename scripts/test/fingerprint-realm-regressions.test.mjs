// ADR-084 / FP14: inherited Custom outputs belong to their API's Window realm.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installApiCustom } from '../../apps/production-extension/api-custom-runtime.js';
import { installApiCustomDocument } from '../../apps/production-extension/api-custom-document-runtime.js';

function storageBrands() { return { managers: new WeakSet(), navigatorStorage: new WeakMap() }; }
function realmContext(sharedStorageBrands = storageBrands()) {
  const context = vm.createContext({ __sharedStorageBrands: sharedStorageBrands });
  vm.runInContext(`'use strict';
    const nativeFreeze=Object.freeze;
    const storageBrands=__sharedStorageBrands;delete globalThis.__sharedStorageBrands;
    const apply=Reflect.apply,mapHas=WeakMap.prototype.has,mapGet=WeakMap.prototype.get,mapSet=WeakMap.prototype.set;
    const managerHas=WeakSet.prototype.has,managerAdd=WeakSet.prototype.add;
    globalThis.window=globalThis;
    globalThis.nativeCalls={languages:0,storage:0,high:0,json:0,enumerate:0,gpu:0};
    globalThis.nativeError=new TypeError('Native receiver');
    globalThis.arrayPrototype=Array.prototype;globalThis.objectPrototype=Object.prototype;
    globalThis.getPrototype=Object.getPrototypeOf;
    Object.defineProperty(globalThis,'self',{configurable:true,get(){return this;}});
    globalThis.Navigator=class Navigator {
      get languages(){nativeCalls.languages++;if(this!==navigator)throw nativeError;return nativeFreeze(['native']);}
      getGamepads(){return [];}
    };
    globalThis.navigator=new Navigator();
    globalThis.StorageManager=class StorageManager {
      constructor(){apply(managerAdd,storageBrands.managers,[this]);}
      estimate(){nativeCalls.storage++;if(!apply(managerHas,storageBrands.managers,[this]))return Promise.reject(nativeError);return Promise.resolve({quota:999,usage:9});}
    };
    const nativeStorage=new StorageManager();
    apply(mapSet,storageBrands.navigatorStorage,[navigator,nativeStorage]);
    Object.defineProperty(Navigator.prototype,'storage',{configurable:true,get(){
      if(!apply(mapHas,storageBrands.navigatorStorage,[this]))throw nativeError;
      return apply(mapGet,storageBrands.navigatorStorage,[this]);
    }});
    globalThis.nativeStorageIdentity=nativeStorage;
    globalThis.nativeStorageGetter=Object.getOwnPropertyDescriptor(Navigator.prototype,'storage').get;
    globalThis.NavigatorUAData=class NavigatorUAData {
      get brands(){if(this!==navigator.userAgentData)throw nativeError;return nativeFreeze([{brand:'Native',version:'153'}]);}
      get mobile(){return false;}get platform(){return 'Native';}
      toJSON(){nativeCalls.json++;if(this!==navigator.userAgentData)throw nativeError;return {brands:[{brand:'Native',version:'153'}],mobile:false,platform:'Native'};}
      getHighEntropyValues(){nativeCalls.high++;if(this!==navigator.userAgentData)return Promise.reject(nativeError);return Promise.resolve({brands:[{brand:'Native',version:'153'}],mobile:false,platform:'Native',fullVersionList:[{brand:'Native',version:'153.1'}]});}
    };
    navigator.userAgentData=new NavigatorUAData();
    const devices=new WeakSet();
    globalThis.MediaDeviceInfo=class MediaDeviceInfo {
      constructor(){devices.add(this);}
      get deviceId(){if(!devices.has(this))throw nativeError;return 'native-device';}
      get groupId(){if(!devices.has(this))throw nativeError;return 'native-group';}
      get kind(){if(!devices.has(this))throw nativeError;return 'audioinput';}
      get label(){if(!devices.has(this))throw nativeError;return 'Native';}
      toJSON(){if(!devices.has(this))throw nativeError;return {deviceId:'native-device',groupId:'native-group',kind:'audioinput',label:'Native'};}
    };
    globalThis.nativeDevice=new MediaDeviceInfo();
    globalThis.MediaDevices=class MediaDevices {enumerateDevices(){nativeCalls.enumerate++;return Promise.resolve([nativeDevice]);}};
    navigator.mediaDevices=new MediaDevices();
    globalThis.SpeechSynthesis=class SpeechSynthesis {getVoices(){return [];}};globalThis.speechSynthesis=new SpeechSynthesis();
    globalThis.Bluetooth=class Bluetooth {getAvailability(){return Promise.resolve(false);}getDevices(){return Promise.resolve([]);}};navigator.bluetooth=new Bluetooth();
    for(const name of ['USB','HID','Serial']){
      const operation=name==='Serial'?'getPorts':'getDevices';
      globalThis[name]=class {[operation](){return Promise.resolve([]);}};
      navigator[name.toLowerCase()]=new globalThis[name]();
    }
    globalThis.GPUAdapterInfo=class GPUAdapterInfo {};
    for(const key of ['vendor','architecture','device','description'])Object.defineProperty(GPUAdapterInfo.prototype,key,{configurable:true,get(){return 'Native';}});
    globalThis.nativeInfo=new GPUAdapterInfo();
    globalThis.GPUAdapter=class GPUAdapter {get info(){nativeCalls.gpu++;if(this!==adapter)throw nativeError;return nativeInfo;}};
    globalThis.adapter=new GPUAdapter();
  `, context);
  return context;
}
function inherited(entries, beforeChild = '', beforeInheritance = '') {
  // Genuine WebIDL Navigator/StorageManager brands span this browser group's
  // Window realms; an arbitrary object or JS Proxy never gains that brand.
  const sharedStorageBrands = storageBrands();
  const parent = realmContext(sharedStorageBrands), child = realmContext(sharedStorageBrands);
  if (beforeChild) vm.runInContext(beforeChild, child);
  parent.child = vm.runInContext('globalThis', child);
  parent.entries = structuredClone(entries);
  vm.runInContext(`'use strict';
    const base=(${installApiCustom.toString()});
    (${installApiCustomDocument.toString()})(globalThis,entries,win=>base(win,entries));
  `, parent);
  if (beforeInheritance) vm.runInContext(beforeInheritance, parent);
  vm.runInContext(`globalThis[Symbol.for('detect.expert/api-custom/inherit/v2')](child);`, parent);
  return { parent, child, run: source => vm.runInContext(source, child) };
}
const selected = (id, value) => ({ id, mode: 'custom', value });
const hints = { brands: [{ brand: 'Chosen', version: '153' }], mobile: false, platform: 'Chosen OS', fullVersionList: [{ brand: 'Chosen', version: '153.1' }] };

test('FP14 fixture WebIDL control: captured storage getter accepts genuine foreign Navigator and rejects fake/Proxy without traps', () => {
  const brands = storageBrands(), parent = realmContext(brands), child = realmContext(brands);
  const run = (context, source) => vm.runInContext(source, context);
  const parentGetter = run(parent, 'nativeStorageGetter'), childGetter = run(child, 'nativeStorageGetter');
  assert.equal(Reflect.apply(parentGetter, run(child, 'navigator'), []), run(child, 'nativeStorageIdentity'));
  assert.equal(Reflect.apply(childGetter, run(parent, 'navigator'), []), run(parent, 'nativeStorageIdentity'));
  let traps = 0;
  const proxy = new Proxy(run(child, 'navigator'), new Proxy({}, { get() { traps++;throw new Error('Any Navigator Proxy trap'); } }));
  for (const receiver of [{}, Object.create(run(child, 'Navigator.prototype')), proxy]) {
    assert.throws(() => Reflect.apply(parentGetter, receiver, []), error => error === run(parent, 'nativeError'));
  }
  assert.equal(traps, 0);
  assert.equal(run(parent, 'nativeCalls.storage'), 0);assert.equal(run(child, 'nativeCalls.storage'), 0);
});

test('FP14: actual inherited installer returns fresh child arrays/dictionaries for languages and UAData', async () => {
  const f = inherited([selected('navigator-languages', ['de-DE', 'de']), selected('client-hints', hints)]);
  assert.equal(f.run('getPrototype(navigator.languages)===arrayPrototype'), true);
  assert.equal(f.run('navigator.languages[0]'), 'de-DE');
  assert.equal(f.run('Object.isFrozen(navigator.languages)'), true);
  assert.equal(f.run('getPrototype(navigator.userAgentData.brands)===arrayPrototype'), true);
  assert.equal(f.run('getPrototype(navigator.userAgentData.brands[0])===objectPrototype'), true);
  assert.equal(f.run('navigator.userAgentData.brands!==navigator.userAgentData.brands'), true);
  assert.equal(f.run('getPrototype(navigator.userAgentData.toJSON())===objectPrototype'), true);
  assert.equal(f.run('getPrototype(navigator.userAgentData.toJSON().brands)===arrayPrototype'), true);
  assert.equal(await f.run(`navigator.userAgentData.getHighEntropyValues(['fullVersionList']).then(value=>
    getPrototype(value)===objectPrototype&&getPrototype(value.fullVersionList)===arrayPrototype&&getPrototype(value.fullVersionList[0])===objectPrototype)`), true);
  assert.equal(f.run(`(()=>{const result=navigator.userAgentData.brands;result[0].brand='Page';return navigator.userAgentData.brands[0].brand==='Chosen';})()`), true);
});

test('FP14/ADR-085: virtual child StorageEstimate retains child Promise realm, zero quota calls and native brand rejection', async () => {
  const f = inherited([selected('storage-estimate', { quota: 1024, usage: 12 }), selected('navigator-languages', ['de-DE'])]);
  assert.equal(f.run('nativeCalls.storage'), 0);
  assert.equal(await f.run(`(()=>{const result=navigator.storage.estimate();return result instanceof Promise&&result.then(value=>getPrototype(value)===objectPrototype&&value.quota===1024);})()`), true);
  assert.equal(f.run('nativeCalls.storage'), 0, 'virtual Custom does not request native quota');
  const wrong = f.run('Reflect.apply(StorageManager.prototype.estimate,{},[])');
  await assert.rejects(wrong, error => error === f.run('nativeError'));
  assert.equal(f.run('nativeCalls.storage'), 1, 'only the private invalid sentinel reaches the native brand check');
  assert.throws(() => f.run(`Reflect.apply(Object.getOwnPropertyDescriptor(Navigator.prototype,'languages').get,{},[])`), error => error === f.run('nativeError'));
  assert.equal(f.run('nativeCalls.languages'), 1);
});

test('FP14: media output arrays and toJSON records use child realm without cloning native handles; a row without a device of its kind is dropped', async () => {
  const rows = [
    { deviceId: 'chosen', groupId: 'group', kind: 'audioinput', label: 'Chosen' },
    { deviceId: 'extra', groupId: '', kind: 'videoinput', label: 'Metadata' }
  ];
  const f = inherited([selected('media-enumeration', rows)]);
  assert.equal(await f.run(`navigator.mediaDevices.enumerateDevices().then(values=>
    getPrototype(values)===arrayPrototype&&values[0]===nativeDevice&&values[0] instanceof MediaDeviceInfo&&
    getPrototype(values[0].toJSON())===objectPrototype&&values.length===1&&values[0].toJSON().label==='Chosen')`), true);
  assert.equal(f.run('nativeCalls.enumerate'), 1);
});

test('FP14: empty gamepad/voice/device arrays belong to the child realm', async () => {
  const f = inherited([
    selected('gamepads', []), selected('speech-voices', []), selected('bluetooth', { available: false, devices: [] }),
    selected('usb', []), selected('hid', []), selected('serial', [])
  ]);
  assert.equal(f.run('getPrototype(navigator.getGamepads())===arrayPrototype'), true);
  assert.equal(f.run('getPrototype(speechSynthesis.getVoices())===arrayPrototype'), true);
  for (const expression of ['navigator.bluetooth.getDevices()', 'navigator.usb.getDevices()', 'navigator.hid.getDevices()', 'navigator.serial.getPorts()']) {
    assert.equal(await f.run(`${expression}.then(values=>values.length===0&&getPrototype(values)===arrayPrototype)`), true, expression);
  }
});

test('FP14: GPU info handles and Intl native result prototypes stay native', () => {
  const f = inherited([selected('webgpu', { vendor: 'Chosen', architecture: 'arm', device: '1', description: 'Fixture' }), selected('timezone', { timeZone: 'UTC', offsetMinutes: 0 })]);
  assert.equal(f.run(`adapter.info===nativeInfo&&getPrototype(adapter.info)===GPUAdapterInfo.prototype&&adapter.info.vendor==='Chosen'`), true);
  assert.equal(f.run(`getPrototype(new Intl.DateTimeFormat('en-US',{timeZone:'UTC'}).resolvedOptions())===objectPrototype`), true);
  assert.throws(() => f.run(`Reflect.apply(Object.getOwnPropertyDescriptor(GPUAdapter.prototype,'info').get,{},[])`), error => error === f.run('nativeError'));
});

test('FP14: captured target prototypes survive later constructor accessors and polluted setters/array helpers', async () => {
  const f = inherited([selected('navigator-languages', ['de-DE']), selected('storage-estimate', { quota: 1024, usage: 12 }), selected('client-hints', hints)]);
  f.run(`
    globalThis.pageReads=0;
    const define=Object.defineProperty;
    Object.defineProperty(objectPrototype,'quota',{configurable:true,set(){pageReads++;throw Error('Page setter');}});
    Object.defineProperty(arrayPrototype,'push',{configurable:true,value(){pageReads++;throw Error('Page push');}});
    for(const name of ['Object','Array'])define(globalThis,name,{configurable:true,get(){pageReads++;throw Error('Page constructor getter');}});
  `);
  assert.equal(f.run('getPrototype(navigator.languages)===arrayPrototype'), true);
  assert.equal(f.run('getPrototype(navigator.userAgentData.brands[0])===objectPrototype'), true);
  assert.equal(await f.run('navigator.storage.estimate().then(value=>getPrototype(value)===objectPrototype&&value.quota===1024)'), true);
  assert.equal(f.run('pageReads'), 0);
});

test('FP14: missing/accessor constructor globals are not invoked, and absent browser APIs are not synthesized', () => {
  const f = inherited([selected('navigator-languages', ['de-DE']), selected('storage-estimate', { quota: 1024, usage: 12 })], `
    globalThis.pageReads=0;
    const define=Object.defineProperty;
    for(const name of ['Object','Array'])define(globalThis,name,{configurable:true,get(){pageReads++;throw Error('Constructor getter');}});
    delete globalThis.StorageManager;delete Navigator.prototype.storage;
  `);
  assert.equal(f.run('navigator.languages[0]'), 'de-DE');
  assert.equal(f.run('pageReads'), 0);
  assert.equal(f.run(`'StorageManager' in globalThis||'storage' in navigator`), false);
});

test('FP14: later child allocation reuses captured parent allocation intrinsics after page poisoning', async () => {
  const f = inherited([selected('navigator-languages', ['de-DE']), selected('storage-estimate', { quota: 1024, usage: 12 })], '', `
    for(const name of ['create','setPrototypeOf','getOwnPropertyDescriptor','getPrototypeOf'])Object[name]=()=>{throw Error('Poisoned parent intrinsic');};
    Array.prototype.push=()=>{throw Error('Poisoned parent push');};
  `);
  assert.equal(f.run('getPrototype(navigator.languages)===arrayPrototype'), true);
  assert.equal(await f.run('navigator.storage.estimate().then(value=>getPrototype(value)===objectPrototype&&value.quota===1024)'), true);
});

test('FP14: existing GPU metadata fallback is a child record and does not rewrite immutable native info', () => {
  const f = inherited([selected('webgpu', { vendor: 'Chosen', architecture: 'arm', device: '1', description: 'Fixture' })], `
    for(const key of ['vendor','architecture','device','description'])Object.defineProperty(nativeInfo,key,{value:'Immutable native',configurable:false});
  `);
  assert.equal(f.run(`(()=>{const value=adapter.info;return value!==nativeInfo&&getPrototype(value)===objectPrototype&&value.vendor==='Chosen';})()`), true);
  assert.equal(f.run(`nativeInfo.vendor==='Immutable native'&&getPrototype(nativeInfo)===GPUAdapterInfo.prototype`), true);
});
