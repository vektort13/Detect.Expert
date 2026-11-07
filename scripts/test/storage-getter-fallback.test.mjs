// Independent B1 semantic tests. All native-looking brands and values are mocks.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {installApiCustom} from '../../apps/production-extension/api-custom-runtime.js';

function fixture(options={}) {
  const context=vm.createContext({options});
  vm.runInContext(`'use strict';
    const P=Promise,E=TypeError,D=Object.defineProperty,A=Reflect.apply;
    const managers=new WeakSet(),navigatorManagers=new WeakMap();
    globalThis.calls={quota:0,rejection:0,windowGet:0,storageGet:0,receiverReads:0,inherited:0,lateReads:0};
    globalThis.reason=new E('Native Storage brand failure');
    globalThis.StorageManager=class StorageManager {
      constructor(){managers.add(this);}
      estimate(){if(!managers.has(this)){calls.rejection++;return new P((resolve,reject)=>reject(reason));}
        calls.quota++;return new P(resolve=>resolve({quota:777777,usage:17}));}
    };
    globalThis.Navigator=class Navigator {constructor(manager){navigatorManagers.set(this,manager);}};
    globalThis.nativeStorageGet={storage(){'use strict';calls.storageGet++;
      if(!navigatorManagers.has(this))throw reason;return navigatorManagers.get(this);
    }}.storage;
    globalThis.manager=new StorageManager();globalThis.nav=new Navigator(manager);
    globalThis.fixtureRealm={Navigator,StorageManager,Promise,Object,Array};
    globalThis.nativeWindowGet={navigator(){'use strict';calls.windowGet++;
      if(this!==fixtureRealm||options.throwWindow)throw reason;return nav;
    }}.navigator;
    if(options.windowKind==='inherited'){
      Object.setPrototypeOf(fixtureRealm,Object.create(Object.prototype,{navigator:{configurable:true,get(){calls.inherited++;throw Error('Inherited page getter');}}}));
    }else if(options.windowKind==='data')D(fixtureRealm,'navigator',{value:nav,configurable:true});
    else if(options.windowKind==='proxy-data')D(fixtureRealm,'navigator',{value:new Proxy(nav,{
      get(){calls.receiverReads++;throw Error('Proxy navigator get');},getPrototypeOf(){calls.receiverReads++;throw Error('Proxy navigator prototype');}
    }),configurable:true});
    else D(fixtureRealm,'navigator',{get:nativeWindowGet,configurable:true});
    globalThis.storageDescriptor={get:nativeStorageGet,configurable:true,enumerable:true};
    D(Navigator.prototype,'storage',storageDescriptor);
    globalThis.installer=(${installApiCustom.toString()});
    const selected={id:'storage-estimate',mode:'custom',value:{quota:1024,usage:12}};
    if(options.registryFull){
      const warm=installer(fixtureRealm,[selected]);
      for(let index=0;index<1024;index++)new Navigator(new StorageManager()).storage;
      warm.stop();
      for(const key of Object.keys(calls))calls[key]=0;
    }
    if(options.storageKind==='missing')delete Navigator.prototype.storage;
    else if(options.storageKind==='data')D(Navigator.prototype,'storage',{value:manager,configurable:true});
    else if(!options.hooked)D(Navigator.prototype,'storage',{...storageDescriptor,configurable:false});
    D(Navigator.prototype,'hardwareConcurrency',{get(){return 8;},configurable:true});
    const entries=[];
    if(options.lastSlot)for(let index=0;index<4095;index++)entries.push({id:'hardware-concurrency',mode:'custom',value:16});
    entries.push(selected);
    globalThis.guard=installer(fixtureRealm,entries);
    globalThis.applyEstimate=()=>A(StorageManager.prototype.estimate,manager,[]);
    globalThis.A=A;globalThis.D=D;globalThis.E=E;
  `,context);
  return {run:source=>vm.runInContext(source,context)};
}
const counts=f=>JSON.parse(f.run('JSON.stringify(calls)'));
async function selected(f,expression='applyEstimate()') {
  const result=await f.run(expression);
  assert.deepEqual(Object.keys(result),['quota','usage']);assert.equal(result.quota,1024);assert.equal(result.usage,12);
  return result;
}
async function rejected(f,expression='applyEstimate()') {
  await assert.rejects(f.run(expression),error=>error===f.run('reason'));
  assert.equal(counts(f).quota,0);
}

test('B1 immutable genuine storage getter: passive install, exact own authentication, cached fresh snapshot and stop',async()=>{
  const f=fixture();
  assert.equal(counts(f).windowGet,0);assert.equal(counts(f).storageGet,0);
  const first=await selected(f),second=await selected(f);first.quota=1;
  assert.notEqual(first,second);assert.equal(second.quota,1024);
  assert.equal(counts(f).windowGet,1);assert.equal(counts(f).storageGet,1);
  assert.equal(counts(f).quota,0);assert.equal(counts(f).rejection,0);
  f.run('guard.stop();');assert.equal((await f.run('applyEstimate()')).quota,777777);
  assert.equal(counts(f).quota,1);
});

test('B1 getter record failure at last handle slot still authenticates own manager without quota',async()=>{
  const f=fixture({hooked:true,lastSlot:true});
  assert.equal(f.run('guard.snapshot().installed'),4096);
  assert.ok(f.run('guard.snapshot().unavailable')>=1);
  assert.equal(counts(f).windowGet,0);assert.equal(counts(f).storageGet,0);
  await selected(f);
  assert.equal(counts(f).windowGet,1);assert.equal(counts(f).storageGet,1);
  assert.equal(counts(f).quota,0);
});

test('B1 missing or data-only STORAGE descriptor stays unavailable and rejects without handle/backend probes',async()=>{
  for(const storageKind of ['missing','data']){
    const f=fixture({storageKind});
    assert.ok(f.run('guard.snapshot().unavailable')>=1);
    await rejected(f);
    assert.equal(counts(f).windowGet,0);assert.equal(counts(f).storageGet,0);
    assert.equal(counts(f).rejection,1);
  }
});

test('B1 throwing captured own Window navigator getter fails closed and never consults storage/backend',async()=>{
  const f=fixture({throwWindow:true});
  await rejected(f);
  assert.equal(counts(f).windowGet,1);assert.equal(counts(f).storageGet,0);
  assert.ok(f.run('guard.snapshot().unavailable')>=1);
});

test('B1 fallback calls captured getters after late globals/accessors are replaced without reading page replacements',async()=>{
  const f=fixture();
  f.run(`D(fixtureRealm,'navigator',{configurable:true,get(){calls.lateReads++;throw Error('Late navigator');}});
    for(const key of ['Navigator','Promise','Object'])D(fixtureRealm,key,{configurable:true,get(){calls.lateReads++;throw Error('Late global');}});`);
  await selected(f);assert.equal(counts(f).lateReads,0);assert.equal(counts(f).quota,0);
});

test('B1 filled shared registry fails closed for unregistered own manager; successful lookup cannot exceed cap',async()=>{
  const f=fixture({registryFull:true});
  assert.equal(counts(f).windowGet,0);assert.equal(counts(f).storageGet,0);
  await rejected(f);assert.equal(counts(f).windowGet,1);assert.equal(counts(f).storageGet,1);
  assert.ok(f.run('guard.snapshot().unavailable')>=1);
});

test('B1 primitives and Proxy mismatch remain unread; mismatch never registers the captured own manager',async()=>{
  const f=fixture();
  for(const receiver of ['undefined','null','0','"x"','Symbol()'])await rejected(f,`A(StorageManager.prototype.estimate,${receiver},[])`);
  assert.equal(counts(f).windowGet,0);assert.equal(counts(f).storageGet,0);
  await rejected(f,`A(StorageManager.prototype.estimate,new Proxy(manager,{
    get(){calls.receiverReads++;throw Error('get');},getPrototypeOf(){calls.receiverReads++;throw Error('prototype');},ownKeys(){calls.receiverReads++;throw Error('keys');}
  }),[])`);
  assert.equal(counts(f).receiverReads,0);assert.equal(counts(f).windowGet,1);assert.equal(counts(f).storageGet,1);
  await selected(f);
  assert.equal(counts(f).windowGet,2,'mismatch must not pre-register own manager');
  assert.equal(counts(f).storageGet,2);assert.equal(counts(f).quota,0);
});

test('B1 normal successfully hooked getter preserves zero extra fallback handle lookups',async()=>{
  const f=fixture({hooked:true});
  await selected(f,'fixtureRealm.navigator.storage.estimate()');
  assert.equal(counts(f).windowGet,1);assert.equal(counts(f).storageGet,1);
  await selected(f);assert.equal(counts(f).windowGet,1);assert.equal(counts(f).storageGet,1);
  assert.equal(counts(f).quota,0);
});

test('B1 inherited Window navigator accessor is never consulted by fallback',async()=>{
  const f=fixture({windowKind:'inherited'});await rejected(f);
  assert.equal(counts(f).inherited,0);assert.equal(counts(f).windowGet,0);assert.equal(counts(f).storageGet,0);
});

test('B1 captured OWN data navigator is accepted only through native Storage getter brand; Proxy remains unread',async()=>{
  const f=fixture({windowKind:'data'});await selected(f);
  assert.equal(counts(f).windowGet,0);assert.equal(counts(f).storageGet,1);assert.equal(counts(f).quota,0);
  const proxy=fixture({windowKind:'proxy-data'});await rejected(proxy);
  assert.equal(counts(proxy).windowGet,0);assert.equal(counts(proxy).storageGet,1);assert.equal(counts(proxy).receiverReads,0);
});
