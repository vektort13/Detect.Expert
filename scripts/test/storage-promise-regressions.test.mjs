// Independent ADR-085 contract tests. Synthetic values only; no browser/probe.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sourceUrl = process.env.FP_PROMISE_RUNTIME_SOURCE || new URL('../../apps/production-extension/api-custom-runtime.js', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const installerSource = source.replace(/^export /m, '');
console.log(`actual-installer-sha256=${createHash('sha256').update(source).digest('hex')}`);
const selected = [{ id: 'storage-estimate', mode: 'custom', value: { quota: 1024, usage: 12 } }];
// A browser group's WebIDL Navigator brand crosses Window realms just as its
// StorageManager brand does. Keep genuinely unrelated fixture groups isolated.
const navigatorRegistries = new WeakMap();

function realm(managerRegistry = new WeakSet(), withQueueMicrotask = true) {
  let navigatorRegistry = navigatorRegistries.get(managerRegistry);
  if (!navigatorRegistry) {
    navigatorRegistry = { navigators: new WeakSet(), storageByNavigator: new WeakMap() };
    navigatorRegistries.set(managerRegistry, navigatorRegistry);
  }
  const globals = { __sharedManagers: managerRegistry, __sharedNavigators: navigatorRegistry.navigators, __sharedStorageByNavigator: navigatorRegistry.storageByNavigator };
  if (withQueueMicrotask) globals.queueMicrotask = queueMicrotask;
  const context = vm.createContext(globals);
  vm.runInContext(`'use strict';
    const P=Promise, O=Object, D=Object.defineProperty, W=WeakSet;
    const managers=__sharedManagers,navigators=__sharedNavigators,storageByNavigator=__sharedStorageByNavigator;
    delete globalThis.__sharedManagers;delete globalThis.__sharedNavigators;delete globalThis.__sharedStorageByNavigator;
    const has=W.prototype.has, add=W.prototype.add, apply=Reflect.apply;
    const mapGet=WeakMap.prototype.get,mapSet=WeakMap.prototype.set;
    globalThis.nativeCalls={quota:0,rejection:0,storageGetter:0,navigatorGetter:0};
    globalThis.capturedPromise=P;globalThis.capturedTypeError=TypeError;
    globalThis.objectPrototype=O.prototype;globalThis.promisePrototype=P.prototype;
    globalThis.getPrototype=O.getPrototypeOf;globalThis.define=D;globalThis.apply=apply;
    globalThis.nativeError=new TypeError('Synthetic native StorageManager receiver');
    globalThis.StorageManager=class StorageManager {
      constructor(){apply(add,managers,[this]);}
      estimate(){
        if(!apply(has,managers,[this])){nativeCalls.rejection++;return P.reject(nativeError);}
        nativeCalls.quota++;
        return P.resolve({quota:8192,usage:81});
      }
    };
    globalThis.nativeEstimate=StorageManager.prototype.estimate;
    const storage=new StorageManager();
    globalThis.Navigator=class Navigator {
      constructor(manager=storage){apply(add,navigators,[this]);apply(mapSet,storageByNavigator,[this,manager]);}
      get storage(){nativeCalls.storageGetter++;if(!apply(has,navigators,[this]))throw nativeError;return apply(mapGet,storageByNavigator,[this]);}
    };
    globalThis.nativeStorageGetter=O.getOwnPropertyDescriptor(Navigator.prototype,'storage').get;
    const nav=new Navigator();
    globalThis.knownStorage=storage;globalThis.knownNavigator=nav;
    globalThis.makeOtherGenuine=()=>new StorageManager();
    globalThis.window=globalThis;
    D(globalThis,'self',{configurable:true,get(){return this;}});
    // vm contextifies global receiver identity; Window brand is tested by the
    // document installer separately. Navigator.storage retains a real brand guard.
    D(globalThis,'navigator',{configurable:true,enumerable:true,get(){nativeCalls.navigatorGetter++;return nav;}});
  `, context);
  return { context, run: code => vm.runInContext(code, context) };
}
function install(f, entries = selected) {
  f.context.entries = structuredClone(entries);
  f.run(`${installerSource}\nglobalThis.guard=installApiCustom(globalThis,entries);`);
  return f;
}
function fixture(entries = selected) { return install(realm(), entries); }
function counts(f) { return JSON.parse(f.run('JSON.stringify(nativeCalls)')); }

test('fixture WebIDL control: captured native storage getter accepts cross-Window genuine Navigator and rejects fake/Proxy without traps', () => {
  const managers = new WeakSet(), parent = realm(managers), child = realm(managers);
  const parentGetter = parent.run('nativeStorageGetter'), childGetter = child.run('nativeStorageGetter');
  assert.equal(Reflect.apply(parentGetter, child.run('knownNavigator'), []), child.run('knownStorage'));
  assert.equal(Reflect.apply(childGetter, parent.run('knownNavigator'), []), parent.run('knownStorage'));
  let traps = 0;
  const genuine = child.run('knownNavigator');
  const proxy = new Proxy(genuine, new Proxy({}, { get() { traps++;throw new Error('Any Proxy trap'); } }));
  for (const receiver of [{}, Object.create(child.run('Navigator.prototype')), proxy]) {
    assert.throws(() => Reflect.apply(parentGetter, receiver, []), error => error === parent.run('nativeError'));
  }
  assert.equal(traps, 0);assert.equal(counts(parent).quota, 0);assert.equal(counts(child).quota, 0);
});

test('virtual estimate: installation is passive; lazy storage getter calls native once with exact receiver/result', () => {
  const f = fixture();
  assert.deepEqual(counts(f), { quota: 0, rejection: 0, storageGetter: 0, navigatorGetter: 0 });
  assert.equal(f.run('navigator.storage===knownStorage'), true);
  assert.equal(counts(f).storageGetter, 1);
  assert.equal(f.run(`apply(Object.getOwnPropertyDescriptor(Navigator.prototype,'storage').get,knownNavigator,[])===knownStorage`), true);
  assert.equal(counts(f).storageGetter, 2);
  for (const receiver of ['null', '{}', 'Object.create(Navigator.prototype)', 'new Proxy(knownNavigator,{})']) {
    assert.throws(() => f.run(`apply(Object.getOwnPropertyDescriptor(Navigator.prototype,'storage').get,${receiver},[])`), error => error === f.run('nativeError'));
  }
  assert.equal(counts(f).storageGetter, 6);
  assert.equal(counts(f).quota, 0);
});

test('virtual estimate: selected result is fresh, mutable, target-realm Promise/dictionary; no native quota call', async () => {
  const f = fixture();
  const result = f.run('globalThis.first=navigator.storage.estimate();first');
  assert.equal(f.run('getPrototype(first)===promisePrototype'), true);
  const value = await result;
  assert.equal(Object.getPrototypeOf(value), f.run('objectPrototype'));
  assert.deepEqual(Object.keys(value), ['quota', 'usage']);
  assert.equal(value.quota, 1024);assert.equal(value.usage, 12);
  value.quota = 99;
  const second = await f.run('navigator.storage.estimate()');
  assert.notEqual(second, value);assert.equal(second.quota, 1024);
  assert.equal(counts(f).quota, 0);
});

test('FP12 negative: inherited then accessor never sees native quota during virtual resolution', async () => {
  const f = fixture();
  f.run(`globalThis.nativeQuotaObserved=false;globalThis.selectedObserved=0;
    define(objectPrototype,'then',{configurable:true,get(){
      const quota=Object.getOwnPropertyDescriptor(this,'quota');
      if(quota&&typeof quota.value==='number'){
        if(quota.value===1024)selectedObserved++;else nativeQuotaObserved=true;
      }return undefined;
    }});
    globalThis.result=navigator.storage.estimate();`);
  try { assert.equal((await f.run('result')).quota, 1024); }
  finally { f.run('delete objectPrototype.then;'); }
  assert.equal(f.run('nativeQuotaObserved'), false);
  assert.equal(counts(f).quota, 0);
});

test('FP13 negative: inherited Promise constructor/species hooks cannot obtain an original quota Promise', async () => {
  const f = fixture();
  f.run(`globalThis.constructorReads=0;globalThis.speciesReads=0;globalThis.capturedOriginal=null;
    globalThis.constructorDescriptor=Object.getOwnPropertyDescriptor(promisePrototype,'constructor');
    globalThis.speciesDescriptor=Object.getOwnPropertyDescriptor(capturedPromise,Symbol.species);
    define(promisePrototype,'constructor',{configurable:true,get(){constructorReads++;capturedOriginal=this;return capturedPromise;}});
    define(capturedPromise,Symbol.species,{configurable:true,get(){speciesReads++;return capturedPromise;}});
    try{globalThis.result=navigator.storage.estimate();}
    finally{define(promisePrototype,'constructor',constructorDescriptor);define(capturedPromise,Symbol.species,speciesDescriptor);}`);
  assert.equal((await f.run('result')).quota, 1024);
  assert.equal(f.run('constructorReads'), 0);assert.equal(f.run('speciesReads'), 0);
  assert.equal(f.run('capturedOriginal'), null);assert.equal(counts(f).quota, 0);
});

test('virtual estimate: throwing page Promise constructor/species accessors are not called', async () => {
  const f = fixture();
  f.run(`globalThis.pageReads=0;
    globalThis.constructorDescriptor=Object.getOwnPropertyDescriptor(promisePrototype,'constructor');
    globalThis.speciesDescriptor=Object.getOwnPropertyDescriptor(capturedPromise,Symbol.species);
    define(promisePrototype,'constructor',{configurable:true,get(){pageReads++;throw Error('Page constructor');}});
    define(capturedPromise,Symbol.species,{configurable:true,get(){pageReads++;throw Error('Page species');}});
    try{globalThis.result=navigator.storage.estimate();}
    finally{define(promisePrototype,'constructor',constructorDescriptor);define(capturedPromise,Symbol.species,speciesDescriptor);}`);
  assert.equal((await f.run('result')).quota, 1024);
  assert.equal(f.run('pageReads'), 0);assert.equal(counts(f).quota, 0);
});

test('virtual estimate: real singleton only; null, primitive, forged prototype and Proxy receivers reject asynchronously', async () => {
  const f = fixture();
  for (const receiver of ['undefined', 'null', '0', '({})', 'Object.create(StorageManager.prototype)', 'new Proxy(knownStorage,{get(){throw Error("Proxy get");},getPrototypeOf(){throw Error("Proxy prototype");}})']) {
    const result = f.run(`apply(StorageManager.prototype.estimate,${receiver},[])`);
    assert.equal(Object.getPrototypeOf(result), f.run('promisePrototype'), receiver);
    await assert.rejects(result, error => error instanceof f.run('capturedTypeError'), receiver);
  }
  assert.equal(counts(f).quota, 0);
  assert.throws(() => f.run('new StorageManager.prototype.estimate()'), error => error instanceof f.run('capturedTypeError'));
});

test('virtual estimate: unknown genuine manager is never sent to native quota as a brand probe', async () => {
  const f = fixture();
  const promise = f.run('globalThis.unknownGenuine=makeOtherGenuine();apply(StorageManager.prototype.estimate,unknownGenuine,[])');
  await assert.rejects(promise, error => error instanceof f.run('capturedTypeError'));
  assert.equal(counts(f).quota, 0);
});

test('virtual estimate: unused arguments are not inspected or coerced', async () => {
  const f = fixture();
  const result = f.run(`globalThis.argumentReads=0;
    globalThis.argument=new Proxy({},{get(){argumentReads++;throw Error('Argument get');},getPrototypeOf(){argumentReads++;throw Error('Argument prototype');}});
    navigator.storage.estimate(argument,argument)`);
  assert.equal((await result).quota, 1024);assert.equal(f.run('argumentReads'), 0);
  assert.equal(counts(f).quota, 0);
});

test('virtual estimate: inherited then reentry receives selected records and causes no quota calls', async () => {
  const f = fixture();
  f.run(`globalThis.reentered=false;globalThis.nativeQuotaObserved=false;globalThis.nested=null;
    define(objectPrototype,'then',{configurable:true,get(){
      const field=Object.getOwnPropertyDescriptor(this,'quota');
      if(field){if(field.value!==1024)nativeQuotaObserved=true;
        if(!reentered){reentered=true;nested=navigator.storage.estimate();}}
      return undefined;
    }});
    globalThis.result=navigator.storage.estimate();`);
  try {
    assert.equal((await f.run('result')).quota, 1024);
    assert.equal((await f.run('nested')).quota, 1024);
  } finally { f.run('delete objectPrototype.then;'); }
  assert.equal(f.run('reentered'), true);assert.equal(f.run('nativeQuotaObserved'), false);
  assert.equal(counts(f).quota, 0);
});

test('virtual estimate: later global and navigator/storage accessors are not consulted per call', async () => {
  const f = fixture();
  f.run(`globalThis.pageReads=0;globalThis.savedEstimate=StorageManager.prototype.estimate;globalThis.registeredStorage=navigator.storage;
    for(const key of ['Promise','Object','TypeError','navigator','queueMicrotask'])define(globalThis,key,{configurable:true,get(){pageReads++;throw Error('Page global');}});
    define(Navigator.prototype,'storage',{configurable:true,get(){pageReads++;throw Error('Page storage');}});`);
  const result = f.run('apply(savedEstimate,registeredStorage,[])');
  assert.equal((await result).quota, 1024);assert.equal(f.run('pageReads'), 0);
  assert.equal(counts(f).quota, 0);
});

test('virtual estimate: already created selected snapshot survives an immediate stop', async () => {
  const f = fixture();
  const result = f.run('globalThis.result=navigator.storage.estimate();guard.stop();result');
  assert.equal((await result).quota, 1024);
  assert.equal(counts(f).quota, 0);
});

test('virtual estimate: stop restores owned descriptor and retained wrapper delegates once; newer owner survives', async () => {
  const f = fixture();
  f.run('globalThis.savedEstimate=StorageManager.prototype.estimate;guard.stop();guard.stop();');
  assert.equal(f.run('StorageManager.prototype.estimate===nativeEstimate'), true);
  assert.equal((await f.run('apply(savedEstimate,knownStorage,[])')).quota, 8192);
  assert.equal(counts(f).quota, 1);
  const next = fixture();
  next.run(`globalThis.pageReplacement=function(){return capturedPromise.resolve('page');};
    define(StorageManager.prototype,'estimate',{value:pageReplacement,configurable:true,writable:true});guard.stop();`);
  assert.equal(next.run('StorageManager.prototype.estimate===pageReplacement'), true);
});

test('virtual estimate: absent or immutable API remains absent/unchanged; OFF/bypass retains original Promise', async () => {
  for (const preparation of ['delete globalThis.StorageManager;', `define(StorageManager.prototype,'estimate',{value:nativeEstimate,configurable:false,writable:false});`]) {
    const f = realm();f.run(preparation);install(f);
    assert.equal(f.run(`typeof StorageManager==='undefined'||StorageManager.prototype.estimate===nativeEstimate`), true);
    assert.equal(counts(f).quota, 0);
  }
  for (const mode of ['off', 'bypass']) {
    const f = fixture([{ ...selected[0], mode }]);
    assert.equal(f.run('StorageManager.prototype.estimate===nativeEstimate'), true);
    assert.equal((await f.run('navigator.storage.estimate()')).quota, 8192);
    assert.equal(counts(f).quota, 1);
  }
});

test('virtual estimate: inherited child has child Promise/dictionary and no native quota call', async () => {
  const managerRegistry = new WeakSet(), parent = realm(managerRegistry), child = realm(managerRegistry);
  parent.context.entries = structuredClone(selected);
  parent.context.child = child.run('globalThis');
  parent.run(`${installerSource}\nglobalThis.guard=installApiCustom(globalThis,entries);globalThis.childGuard=installApiCustom(child,entries);`);
  const result = child.run('globalThis.result=navigator.storage.estimate();result');
  assert.equal(child.run('getPrototype(result)===promisePrototype'), true);
  assert.equal(Object.getPrototypeOf(await result), child.run('objectPrototype'));
  assert.equal(counts(child).quota, 0);assert.equal(counts(parent).quota, 0);
  parent.context.childStorage = child.run('navigator.storage');
  const borrowed = parent.run('globalThis.borrowed=apply(StorageManager.prototype.estimate,childStorage,[]);borrowed');
  assert.equal(parent.run('getPrototype(borrowed)===promisePrototype'), true);
  assert.equal(Object.getPrototypeOf(await borrowed), parent.run('objectPrototype'));
  assert.equal((await borrowed).quota, 1024);
  assert.equal(counts(child).quota, 0);assert.equal(counts(parent).quota, 0);
});

test('virtual estimate: absent/accessor child Promise uses captured fallback without calling page getter or native quota', async () => {
  for (const preparation of [`delete globalThis.Promise;`, `define(globalThis,'Promise',{configurable:true,get(){pageReads++;throw Error('Page Promise');}});`]) {
    const managerRegistry = new WeakSet(), parent = realm(managerRegistry), child = realm(managerRegistry);
    child.run(`globalThis.pageReads=0;${preparation}`);
    parent.context.entries = structuredClone(selected);parent.context.child = child.run('globalThis');
    parent.run(`${installerSource}\nglobalThis.guard=installApiCustom(globalThis,entries);globalThis.childGuard=installApiCustom(child,entries);`);
    assert.equal((await child.run('navigator.storage.estimate()')).quota, 1024);
    assert.equal(child.run('pageReads'), 0);assert.equal(counts(child).quota, 0);
  }
});

test('virtual estimate: registry cap fails closed for a new genuine manager and preserves registered identities', async () => {
  const f = fixture();
  f.run(`globalThis.firstRegistered=null;globalThis.overCap=null;
    for(let index=0;index<1025;index++){
      const manager=new Navigator(new StorageManager()).storage;
      if(index===0)firstRegistered=manager;if(index===1024)overCap=manager;
    }`);
  assert.equal((await f.run('apply(StorageManager.prototype.estimate,firstRegistered,[])')).quota, 1024);
  await assert.rejects(f.run('apply(StorageManager.prototype.estimate,overCap,[])'), error => error instanceof f.run('capturedTypeError'));
  assert.equal(counts(f).quota, 0);assert.equal(counts(f).storageGetter, 1025);
});

test('virtual estimate: selected then assimilation happens after method return', async () => {
  const f = fixture();
  f.run(`globalThis.methodReturned=false;globalThis.synchronousAssimilation=false;globalThis.selectedReads=0;
    define(objectPrototype,'then',{configurable:true,get(){
      const quota=Object.getOwnPropertyDescriptor(this,'quota');
      if(quota){if(!methodReturned)synchronousAssimilation=true;if(quota.value===1024)selectedReads++;}
      return undefined;
    }});
    globalThis.result=navigator.storage.estimate();methodReturned=true;`);
  try { assert.equal((await f.run('result')).quota, 1024); }
  finally { f.run('delete objectPrototype.then;'); }
  assert.equal(f.run('synchronousAssimilation'), false);assert.ok(f.run('selectedReads') > 0);
  assert.equal(counts(f).quota, 0);
});

test('virtual estimate: private deferred scheduler works without queueMicrotask or page constructor/species lookup', async () => {
  const f = install(realm(new WeakSet(), false));
  f.run(`globalThis.methodReturned=false;globalThis.synchronousAssimilation=false;globalThis.constructorReads=0;globalThis.speciesReads=0;
    globalThis.constructorDescriptor=Object.getOwnPropertyDescriptor(promisePrototype,'constructor');
    globalThis.speciesDescriptor=Object.getOwnPropertyDescriptor(capturedPromise,Symbol.species);
    define(promisePrototype,'constructor',{configurable:true,get(){constructorReads++;throw Error('Page constructor');}});
    define(capturedPromise,Symbol.species,{configurable:true,get(){speciesReads++;throw Error('Page species');}});
    define(objectPrototype,'then',{configurable:true,get(){
      if(Object.getOwnPropertyDescriptor(this,'quota')&&!methodReturned)synchronousAssimilation=true;
      return undefined;
    }});
    globalThis.result=navigator.storage.estimate();methodReturned=true;`);
  try {
    // Drain using host promises only. Awaiting the target Promise while its
    // constructor trap is active would be a caller-induced false positive.
    await new Promise(resolve => queueMicrotask(() => queueMicrotask(() => queueMicrotask(resolve))));
    assert.equal(f.run('synchronousAssimilation'), false);
    assert.equal(f.run('constructorReads'), 0);assert.equal(f.run('speciesReads'), 0);
  } finally {
    f.run(`define(promisePrototype,'constructor',constructorDescriptor);define(capturedPromise,Symbol.species,speciesDescriptor);delete objectPrototype.then;`);
  }
  assert.equal((await f.run('result')).quota, 1024);
  assert.equal(counts(f).quota, 0);
});
