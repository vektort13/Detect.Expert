// Independent foreign-Window Storage regressions. All brands and data are mocks.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const source = readFileSync(process.env.FP_STORAGE_FOREIGN_RUNTIME_SOURCE || new URL('../../apps/production-extension/api-custom-runtime.js', import.meta.url), 'utf8');
const installerSource = source.replace(/^export /m, '');
console.log(`foreign-storage-installer-sha256=${createHash('sha256').update(source).digest('hex')}`);
const selection = (quota, usage, mode = 'custom') => [{ id: 'storage-estimate', mode, value: { quota, usage } }];

function makeRealm(label, brands, options = {}) {
  const context = vm.createContext({ fixtureBrands: brands, fixtureLabel: label, fixtureOptions: options });
  vm.runInContext(`'use strict';
    const brands=fixtureBrands, options=fixtureOptions, label=fixtureLabel;
    delete globalThis.fixtureBrands;delete globalThis.fixtureOptions;delete globalThis.fixtureLabel;
    const P=Promise,D=Object.defineProperty,A=Reflect.apply;
    const has=WeakSet.prototype.has,add=WeakSet.prototype.add,mapGet=WeakMap.prototype.get,mapSet=WeakMap.prototype.set;
    globalThis.calls={quota:0,rejection:0,windowGetter:0,storageGetter:0,pageReads:0,proxyTraps:0,open:0};
    globalThis.receivers=[];globalThis.nativeError=new TypeError('Synthetic native Storage brand '+label);
    globalThis.StorageManager=class StorageManager {
      constructor(){A(add,brands.managers,[this]);}
      estimate(){receivers.push(this);
        if(!A(has,brands.managers,[this])){calls.rejection++;return P.reject(nativeError);}
        calls.quota++;return P.resolve({quota:8388608,usage:81});
      }
    };
    globalThis.Navigator=class Navigator {
      constructor(manager){A(mapSet,brands.navigatorManagers,[this,manager]);}
      get storage(){calls.storageGetter++;
        if(!A(has,brands.navigators,[this]))throw nativeError;
        return A(mapGet,brands.navigatorManagers,[this]);
      }
    };
    const nativeNavigatorConstructor=Navigator;
    globalThis.makeNavigator=manager=>{const navigator=new nativeNavigatorConstructor(manager);A(add,brands.navigators,[navigator]);return navigator;};
    globalThis.nativeEstimate=StorageManager.prototype.estimate;
    globalThis.nativeStorageGetter=Object.getOwnPropertyDescriptor(Navigator.prototype,'storage').get;
    const manager=new StorageManager(),navigator=makeNavigator(manager);
    globalThis.realm={Object,Array,Promise,Navigator,StorageManager,origin:options.origin||'https://same.example'};
    A(add,brands.windows,[realm]);A(mapSet,brands.windowNavigators,[realm,navigator]);
    A(mapSet,brands.windowOrigins,[realm,realm.origin]);
    A(mapSet,brands.windowParents,[realm,realm]);A(mapSet,brands.windowOpeners,[realm,null]);A(mapSet,brands.windowFrames,[realm,[]]);
    A(mapSet,brands.windowDocuments,[realm,{defaultView:realm}]);
    function sameOrigin(window){
      if(!A(has,brands.windows,[window])||A(mapGet,brands.windowOrigins,[window])!==realm.origin)throw nativeError;
    }
    globalThis.nativeWindowGetter={navigator(){'use strict';calls.windowGetter++;
      sameOrigin(this);return A(mapGet,brands.windowNavigators,[this]);
    }}.navigator;
    D(realm,'navigator',{configurable:true,enumerable:true,get:nativeWindowGetter});
    D(realm,'self',{configurable:true,get(){if(!A(has,brands.windows,[this]))throw nativeError;return this;}});
    D(realm,'document',{configurable:true,get(){sameOrigin(this);return A(mapGet,brands.windowDocuments,[this]);}});
    D(realm,'parent',{configurable:true,get(){if(!A(has,brands.windows,[this]))throw nativeError;return A(mapGet,brands.windowParents,[this]);}});
    D(realm,'opener',{configurable:true,get(){if(!A(has,brands.windows,[this]))throw nativeError;return A(mapGet,brands.windowOpeners,[this]);}});
    D(realm,'frames',{configurable:true,get(){if(!A(has,brands.windows,[this]))throw nativeError;return this;}});
    D(realm,'length',{configurable:true,get(){if(!A(has,brands.windows,[this]))throw nativeError;return A(mapGet,brands.windowFrames,[this]).length;}});
    globalThis.openResult=null;globalThis.openThrows=false;globalThis.openError=new Error('Synthetic native Window.open');
    globalThis.nativeOpen={open(){'use strict';calls.open++;globalThis.openReceiver=this;globalThis.openArguments=arguments;
      if(openThrows)throw openError;return openResult;
    }}.open;
    D(realm,'open',{configurable:true,enumerable:true,writable:true,value:nativeOpen});
    // Real page flow: cache the handle before installing either Custom hook.
    globalThis.cached=realm.navigator.storage;globalThis.navigatorIdentity=navigator;
    globalThis.cacheProof={windowGetter:calls.windowGetter,storageGetter:calls.storageGetter};
    if(options.navigatorKind==='data')D(realm,'navigator',{value:navigator,configurable:true});
    for(const key of Object.keys(calls))calls[key]=0;
    if(options.missingEstimate)delete StorageManager.prototype.estimate;
    if(options.storageKind==='missing')delete Navigator.prototype.storage;
    if(options.storageKind==='data')D(Navigator.prototype,'storage',{configurable:true,value:manager});
    globalThis.A=A;globalThis.D=D;globalThis.P=P;
    globalThis.objectPrototype=Object.prototype;globalThis.promisePrototype=P.prototype;
    globalThis.nativeStorageDescriptor=Object.getOwnPropertyDescriptor(Navigator.prototype,'storage');
    globalThis.poisonAfterCapture=()=>{
      D(realm,'navigator',{configurable:true,get(){calls.pageReads++;throw Error('Late Window.navigator');}});
      D(Navigator.prototype,'storage',{configurable:true,get(){calls.pageReads++;throw Error('Late Navigator.storage');}});
      for(const key of ['Object','Array','Promise','Navigator','StorageManager'])D(realm,key,{configurable:true,get(){calls.pageReads++;throw Error('Late '+key);}});
    };
    globalThis.makeUntracked=()=>new StorageManager();
    globalThis.makePassiveWindow=()=>{
      const window={},manager=new StorageManager(),nav=makeNavigator(manager);
      A(add,brands.windows,[window]);A(mapSet,brands.windowNavigators,[window,nav]);
      A(mapSet,brands.windowOrigins,[window,realm.origin]);A(mapSet,brands.windowParents,[window,window]);
      A(mapSet,brands.windowOpeners,[window,null]);A(mapSet,brands.windowFrames,[window,[]]);
      A(mapSet,brands.windowDocuments,[window,{defaultView:window}]);return {window,manager};
    };
    globalThis.changeWindowNavigator=()=>{
      const manager=new StorageManager(),nav=makeNavigator(manager);
      A(mapSet,brands.windowNavigators,[realm,nav]);return manager;
    };
    globalThis.makeHostileProxy=()=>new Proxy(cached,new Proxy(Object.create(null),{
      get(){calls.proxyTraps++;throw Error('Any Proxy trap lookup');}
    }));
  `, context);
  const run = code => vm.runInContext(code, context);
  return { context, run, target: run('realm'), calls: () => JSON.parse(run('JSON.stringify(calls)')) };
}

function fixture(options = {}) {
  const brands = { managers: new WeakSet(), navigators: new WeakSet(), navigatorManagers: new WeakMap(), windows: new WeakSet(), windowNavigators: new WeakMap(), windowOrigins: new WeakMap(), windowParents: new WeakMap(), windowOpeners: new WeakMap(), windowFrames: new WeakMap(), windowDocuments: new WeakMap() };
  const parent = makeRealm('parent', brands, options.parent);
  const child = makeRealm('child', brands, options.child);
  const popup = makeRealm('popup', brands, options.popup);
  parent.run(`${installerSource}\nglobalThis.installer=installApiCustom;`);
  const install = parent.run('installer');
  const windows = { parent, child, popup };
  brands.windowParents.set(child.target, parent.target);
  brands.windowOpeners.set(popup.target, parent.target);
  brands.windowFrames.set(parent.target, [child.target]);
  Object.defineProperty(parent.target, '0', { configurable: true, value: child.target });
  const entries = { parent: selection(1024, 12), child: selection(2048, 24), popup: selection(4096, 48), ...options.entries };
  for (const [name, f] of Object.entries(windows)) {
    assert.deepEqual(JSON.parse(f.run('JSON.stringify(cacheProof)')), { windowGetter: 1, storageGetter: 1 });
    if (name === 'child') options.beforeChildInstall?.(child);
    f.guard = install(f.target, structuredClone(entries[name]));
    f.wrapper = f.run('StorageManager.prototype.estimate');
  }
  const quotaCalls = () => Object.values(windows).reduce((total, f) => total + f.calls().quota, 0);
  const pageReads = () => Object.values(windows).reduce((total, f) => total + f.calls().pageReads, 0);
  function borrowed(owner, receiver, argument = undefined) {
    return Reflect.apply(windows[owner].wrapper, windows[receiver].run('cached'), argument === undefined ? [] : [argument]);
  }
  function attachChild(window) {
    const children = brands.windowFrames.get(parent.target);
    Object.defineProperty(parent.target, children.length, { configurable: true, value: window });
    children.push(window);brands.windowParents.set(window, parent.target);
  }
  return { ...windows, install, windows, borrowed, quotaCalls, pageReads, attachChild };
}

async function selected(promise, owner, quota, usage) {
  assert.equal(Object.getPrototypeOf(promise), owner.run('promisePrototype'));
  const value = await promise;
  assert.equal(Object.getPrototypeOf(value), owner.run('objectPrototype'));
  assert.deepEqual(Object.keys(value), ['quota', 'usage']);
  assert.equal(value.quota, quota);assert.equal(value.usage, usage);
  return value;
}

test('foreign Storage: cached same-origin child manager authenticates after passive shared installation', async () => {
  const f = fixture();
  for (const window of Object.values(f.windows)) assert.deepEqual(window.calls(), { quota: 0, rejection: 0, windowGetter: 0, storageGetter: 0, pageReads: 0, proxyTraps: 0, open: 0 });
  await selected(f.borrowed('parent', 'child'), f.parent, 1024, 12);
  assert.equal(f.quotaCalls(), 0);
  assert.equal(f.parent.calls().rejection, 0);
});

test('foreign Storage: own Window handle cached before a successfully installed getter authenticates lazily', async () => {
  const f = fixture();
  await selected(f.borrowed('parent', 'parent'), f.parent, 1024, 12);
  assert.equal(f.quotaCalls(), 0);
});

test('foreign Storage: child-to-parent and popup borrowed calls retain method-owner selection and result realm', async () => {
  const f = fixture();
  for (const [owner, receiver, quota, usage] of [
    ['child', 'parent', 2048, 24], ['popup', 'child', 4096, 48], ['parent', 'popup', 1024, 12], ['child', 'popup', 2048, 24],
  ]) await selected(f.borrowed(owner, receiver), f.windows[owner], quota, usage);
  assert.equal(f.quotaCalls(), 0);
});

test('foreign Storage: late Window/storage/global replacements are unread during cached-handle authentication', async () => {
  const f = fixture();
  for (const window of Object.values(f.windows)) window.run('poisonAfterCapture()');
  await selected(f.borrowed('parent', 'child'), f.parent, 1024, 12);
  await selected(f.borrowed('child', 'popup'), f.child, 2048, 24);
  await selected(f.borrowed('popup', 'parent'), f.popup, 4096, 48);
  assert.equal(f.pageReads(), 0);assert.equal(f.quotaCalls(), 0);
});

test('foreign Storage: already registered manager stays cached without repeated passive discovery', async () => {
  const f = fixture();
  await selected(f.borrowed('parent', 'child'), f.parent, 1024, 12);
  const before = Object.fromEntries(Object.entries(f.windows).map(([name, window]) => [name, window.calls()]));
  const second = await selected(f.borrowed('parent', 'child'), f.parent, 1024, 12);
  second.usage = 99;
  await selected(f.borrowed('popup', 'child'), f.popup, 4096, 48);
  for (const [name, window] of Object.entries(f.windows)) {
    assert.equal(window.calls().windowGetter, before[name].windowGetter);
    assert.equal(window.calls().storageGetter, before[name].storageGetter);
  }
  assert.equal(f.quotaCalls(), 0);
});

test('foreign Storage: fake/prototype/Proxy/revoked/primitive receivers reject without any receiver trap or quota call', async () => {
  const f = fixture();
  const proxy = f.child.run('makeHostileProxy()');
  const revoked = Proxy.revocable(f.child.run('cached'), {});revoked.revoke();
  const fake = Object.create(f.child.run('StorageManager.prototype'));
  for (const receiver of [proxy, revoked.proxy, fake, {}, undefined, null, 0, Symbol('invalid')]) {
    const promise = Reflect.apply(f.parent.wrapper, receiver, []);
    assert.equal(Object.getPrototypeOf(promise), f.parent.run('promisePrototype'));
    await assert.rejects(promise, error => error === f.parent.run('nativeError'));
    assert.notEqual(f.parent.run('receivers[receivers.length-1]'), receiver, 'invalid original gets a private sentinel, never unknown actual this');
  }
  assert.equal(f.child.calls().proxyTraps, 0);assert.equal(f.quotaCalls(), 0);
  assert.equal(f.parent.calls().rejection, 8);
});

test('foreign Storage: an untracked genuine manager without a known Window identity stays fail closed', async () => {
  const f = fixture();
  const untracked = f.child.run('makeUntracked()');
  await assert.rejects(Reflect.apply(f.parent.wrapper, untracked, []), error => error === f.parent.run('nativeError'));
  assert.notEqual(f.parent.run('receivers[0]'), untracked);
  assert.equal(f.quotaCalls(), 0);
});

test('foreign Storage: absent estimate is not synthesized in a known child Window', () => {
  const f = fixture({ child: { missingEstimate: true } });
  assert.equal(f.child.run('Object.hasOwn(StorageManager.prototype,"estimate")'), false);
  assert.ok(f.child.guard.snapshot().unavailable >= 1);
  assert.equal(f.quotaCalls(), 0);
});

test('foreign Storage: missing or data-only storage API in all known Windows remains unavailable without quota fallback', async () => {
  for (const storageKind of ['missing', 'data']) {
    const options = { storageKind };
    const f = fixture({ parent: options, child: options, popup: options });
    await assert.rejects(f.borrowed('parent', 'child'), error => error === f.parent.run('nativeError'));
    for (const window of Object.values(f.windows)) {
      assert.ok(window.guard.snapshot().unavailable >= 1);
      assert.equal(window.calls().storageGetter, 0);
      assert.equal(window.run('typeof Object.getOwnPropertyDescriptor(Navigator.prototype,"storage")?.get'), 'undefined');
    }
    assert.equal(f.quotaCalls(), 0);
  }
});

test('foreign Storage: borrowed genuine call never inspects unused opaque arguments', async () => {
  const f = fixture();
  let traps = 0;
  const argument = new Proxy({}, new Proxy({}, { get() { traps++;throw new Error('Unused argument trap'); } }));
  await selected(f.borrowed('parent', 'child', argument), f.parent, 1024, 12);
  assert.equal(traps, 0);assert.equal(f.quotaCalls(), 0);
});

test('foreign Storage: Bypass/empty effective child configuration is not overwritten by another Window profile', () => {
  for (const rows of [[], [{ id: 'storage-estimate', mode: 'bypass' }], [{ id: 'storage-estimate', mode: 'off' }]]) {
    const f = fixture({ child: { origin: 'https://other.example' }, entries: { child: rows } });
    assert.equal(f.child.run('StorageManager.prototype.estimate===nativeEstimate'), true);
    assert.equal(f.child.run('Object.getOwnPropertyDescriptor(Navigator.prototype,"storage").get===nativeStorageGetter'), true);
    assert.equal(f.child.guard.snapshot().installed, 0);
    assert.equal(f.quotaCalls(), 0);
  }
});

test('foreign Storage: reachable same-origin child without Custom accepts borrowed parent function and keeps native own APIs', async () => {
  const f = fixture({ entries: { child: [] } });
  assert.equal(f.child.run('StorageManager.prototype.estimate===nativeEstimate'), true);
  assert.equal(f.child.run('Object.getOwnPropertyDescriptor(Navigator.prototype,"storage").get===nativeStorageGetter'), true);
  await selected(f.borrowed('parent', 'child'), f.parent, 1024, 12);
  assert.equal(f.child.run('StorageManager.prototype.estimate===nativeEstimate'), true);
  assert.equal(f.child.guard.snapshot().installed, 0);
  assert.equal(f.quotaCalls(), 0);
});

test('foreign Storage: popup Custom authenticates reachable uninstalled opener through captured native Window getters', async () => {
  const f = fixture({ entries: { parent: [], child: [] } });
  f.parent.run('poisonAfterCapture()');
  await selected(f.borrowed('popup', 'parent'), f.popup, 4096, 48);
  assert.equal(f.parent.run('StorageManager.prototype.estimate===nativeEstimate'), true);
  assert.equal(f.parent.guard.snapshot().installed, 0);
  assert.equal(f.pageReads(), 0);assert.equal(f.quotaCalls(), 0);
});

test('foreign Storage: inaccessible cross-origin graph candidate stays rejected without profile override or quota', async () => {
  const f = fixture({ child: { origin: 'https://other.example' }, entries: { child: [] } });
  await assert.rejects(f.borrowed('parent', 'child'), error => error === f.parent.run('nativeError'));
  assert.equal(f.child.run('StorageManager.prototype.estimate===nativeEstimate'), true);
  assert.equal(f.child.guard.snapshot().installed, 0);
  assert.equal(f.quotaCalls(), 0);
});

test('foreign Storage: inherited 1024-manager registry cap stays fail closed with bounded counters', async () => {
  const f = fixture();
  f.child.run(`globalThis.cappedManager=makeUntracked();globalThis.cappedNavigator=makeNavigator(cappedManager);
    globalThis.currentStorageGetter=Object.getOwnPropertyDescriptor(Navigator.prototype,'storage').get;
    for(let index=0;index<1024;index++)A(currentStorageGetter,makeNavigator(makeUntracked()),[]);
    for(let index=0;index<65550;index++)A(currentStorageGetter,cappedNavigator,[]);`);
  await assert.rejects(f.borrowed('parent', 'child'), error => error === f.parent.run('nativeError'));
  const row = f.child.guard.snapshot().entries.find(row => row.id === 'storage-estimate');
  assert.equal(row.unavailable, 65535);
  assert.equal(f.child.guard.snapshot().unavailable, 65535);
  assert.equal(f.quotaCalls(), 0);
});

test('foreign Storage: pre-inherited-install page storage getter cannot register fake or Proxy; genuine cached manager uses pristine getters', async () => {
  for (const makeFake of ['Object.create(StorageManager.prototype)', 'makeHostileProxy()']) {
    const f = fixture({ beforeChildInstall(child) {
      child.run(`globalThis.fakeStorage=${makeFake};D(Navigator.prototype,'storage',{
        configurable:true,get(){calls.pageReads++;return fakeStorage;}
      });`);
    } });
    assert.equal(f.pageReads(), 0, 'inherited installation never invokes the page getter');
    const fake = f.child.run('navigatorIdentity.storage');
    assert.equal(fake, f.child.run('fakeStorage'));
    assert.equal(f.child.calls().pageReads, 1, 'actual page property read is forwarded once');
    await assert.rejects(Reflect.apply(f.parent.wrapper, fake, []), error => error === f.parent.run('nativeError'));
    await assert.rejects(Reflect.apply(f.child.wrapper, fake, []), error => error === f.child.run('nativeError'));
    await selected(f.borrowed('parent', 'child'), f.parent, 1024, 12);
    await selected(f.borrowed('child', 'child'), f.child, 2048, 24);
    assert.equal(f.pageReads(), 1, 'authentication never rereads the late page storage getter');
    assert.equal(f.child.calls().proxyTraps, 0);assert.equal(f.quotaCalls(), 0);
  }
});

test('foreign Storage: a prior miss does not poison a manager that becomes reachable later', async () => {
  const f = fixture();
  const added = f.child.run('makePassiveWindow()');
  await assert.rejects(Reflect.apply(f.parent.wrapper, added.manager, []), error => error === f.parent.run('nativeError'));
  f.attachChild(added.window);
  await selected(Reflect.apply(f.parent.wrapper, added.manager, []), f.parent, 1024, 12);
  assert.equal(f.quotaCalls(), 0);
});

test('foreign Storage: native Navigator change behind a known Window discovers new identity and retains authenticated old manager', async () => {
  const f = fixture();
  await selected(f.borrowed('parent', 'child'), f.parent, 1024, 12);
  const next = f.child.run('changeWindowNavigator()');
  f.child.run('poisonAfterCapture()');
  await selected(Reflect.apply(f.parent.wrapper, next, []), f.parent, 1024, 12);
  await selected(f.borrowed('parent', 'child'), f.parent, 1024, 12);
  assert.equal(f.pageReads(), 0);assert.equal(f.quotaCalls(), 0);
});

test('foreign Storage: Window.open forwards exactly once and passively remembers uninstalled detached popup', async () => {
  const f = fixture({ entries: { popup: [] } });
  f.parent.context.returnedPopup = f.popup.target;
  f.parent.run('openResult=returnedPopup;');
  let argumentTraps = 0;
  const argument = new Proxy({}, new Proxy({}, { get() { argumentTraps++;throw new Error('Unused open argument'); } }));
  const result = Reflect.apply(f.parent.target.open, f.parent.target, [argument, 'unused', argument]);
  assert.equal(result, f.popup.target);assert.equal(f.parent.calls().open, 1);
  assert.equal(f.parent.run('openReceiver'), f.parent.target);
  assert.equal(f.parent.run('openArguments[0]'), argument);assert.equal(f.parent.run('openArguments[2]'), argument);
  for (const window of Object.values(f.windows)) {
    assert.equal(window.calls().windowGetter, 0);assert.equal(window.calls().storageGetter, 0);
  }
  assert.equal(argumentTraps, 0);
  await selected(f.borrowed('parent', 'popup'), f.parent, 1024, 12);
  assert.equal(f.popup.run('StorageManager.prototype.estimate===nativeEstimate'), true);
  assert.equal(f.popup.guard.snapshot().installed, 0);assert.equal(f.quotaCalls(), 0);
});

test('foreign Storage: Window.open null/fake/Proxy results preserve return and cannot establish Window identity', async () => {
  const f = fixture({ entries: { popup: [] } });
  let traps = 0;
  const proxy = new Proxy(f.popup.target, new Proxy({}, { get() { traps++;throw new Error('Window Proxy trap'); } }));
  const fake = Object.create(null, { self: { get() { traps++;throw new Error('Fake self'); } } });
  for (const result of [null, fake, proxy, 3]) {
    f.parent.context.returned = result;f.parent.run('openResult=returned;');
    assert.equal(Reflect.apply(f.parent.target.open, f.parent.target, []), result);
  }
  assert.equal(f.parent.calls().open, 4);assert.equal(traps, 0);
  await assert.rejects(f.borrowed('parent', 'popup'), error => error === f.parent.run('nativeError'));
  assert.equal(f.quotaCalls(), 0);
});

test('foreign Storage: Window.open preserves throw, nonconstructability, stop and newer descriptor owner', () => {
  const f = fixture();
  const wrapper = f.parent.target.open;
  assert.throws(() => Reflect.construct(wrapper, []), error => error instanceof TypeError);
  assert.equal(f.parent.calls().open, 0);
  f.parent.run('openThrows=true;');
  assert.throws(() => Reflect.apply(wrapper, f.parent.target, []), error => error === f.parent.run('openError'));
  assert.equal(f.parent.calls().open, 1);
  f.parent.run('openThrows=false;');f.parent.guard.stop();
  assert.equal(f.parent.target.open, f.parent.run('nativeOpen'));
  assert.equal(Reflect.apply(wrapper, f.parent.target, []), null);
  assert.equal(f.parent.calls().open, 2);
  const next = fixture();
  const replacement = () => 'new-owner';
  Object.defineProperty(next.parent.target, 'open', { configurable: true, writable: true, value: replacement });
  next.parent.guard.stop();assert.equal(next.parent.target.open, replacement);
});

test('foreign Storage: passive Window hint cap1024 keeps prior identities and rejects over-cap unlinked window', async () => {
  const f = fixture({ entries: { child: [], popup: [] } });
  f.parent.run(`globalThis.firstHint=null;
    for(let index=0;index<1023;index++){
      const hint=makePassiveWindow();if(index===0)firstHint=hint;
      openResult=hint.window;A(realm.open,realm,[]);
    }
    globalThis.overCap=makePassiveWindow();openResult=overCap.window;A(realm.open,realm,[]);`);
  assert.ok(f.parent.guard.snapshot().unavailable >= 1);
  for (const window of Object.values(f.windows)) {
    assert.equal(window.calls().windowGetter, 0);assert.equal(window.calls().storageGetter, 0);
  }
  await selected(Reflect.apply(f.parent.wrapper, f.parent.run('firstHint.manager'), []), f.parent, 1024, 12);
  await assert.rejects(Reflect.apply(f.parent.wrapper, f.parent.run('overCap.manager'), []), error => error === f.parent.run('nativeError'));
  assert.equal(f.quotaCalls(), 0);
});

test('foreign Storage: OWN-data first navigator never authenticates late page storage getter fake or Proxy', async () => {
  for (const makeFake of ['Object.create(StorageManager.prototype)', 'makeHostileProxy()']) {
    const f = fixture({ parent: { navigatorKind: 'data' }, beforeChildInstall(child) {
      child.run(`globalThis.fakeStorage=${makeFake};D(Navigator.prototype,'storage',{
        configurable:true,get(){calls.pageReads++;return fakeStorage;}
      });`);
    } });
    const fake = f.child.run('fakeStorage');
    for (const owner of [f.parent, f.child]) {
      await assert.rejects(Reflect.apply(owner.wrapper, fake, []), error => error === owner.run('nativeError'));
    }
    assert.equal(f.pageReads(), 0, 'unknown receiver authentication never executes late child getter');
    assert.equal(f.child.calls().proxyTraps, 0);
    await selected(f.borrowed('parent', 'parent'), f.parent, 1024, 12);
    assert.equal(f.child.run('navigatorIdentity.storage===fakeStorage'), true);
    assert.equal(f.pageReads(), 1, 'an actual page property read still forwards original getter once');
    await assert.rejects(Reflect.apply(f.child.wrapper, fake, []), error => error === f.child.run('nativeError'));
    assert.equal(f.pageReads(), 1, 'the forwarded fake result did not enter the authenticated registry');
    assert.equal(f.child.calls().proxyTraps, 0);
    assert.equal(f.quotaCalls(), 0);
  }
});

test('foreign Storage: OWN-data genuine navigators authenticate through pristine shared storage despite late page getter', async () => {
  const f = fixture({ parent: { navigatorKind: 'data' }, child: { navigatorKind: 'data' }, beforeChildInstall(child) {
    child.run(`D(Navigator.prototype,'storage',{
      configurable:true,get(){calls.pageReads++;throw Error('Late child getter must not authenticate');}
    });`);
  } });
  await selected(f.borrowed('parent', 'parent'), f.parent, 1024, 12);
  await selected(f.borrowed('child', 'child'), f.child, 2048, 24);
  await selected(f.borrowed('parent', 'child'), f.parent, 1024, 12);
  assert.equal(f.pageReads(), 0);
  assert.equal(f.quotaCalls(), 0);
  assert.equal(f.parent.calls().rejection, 0);
  assert.equal(f.child.calls().rejection, 0);
});
