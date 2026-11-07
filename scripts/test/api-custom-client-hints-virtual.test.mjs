import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installApiCustom} from '../../apps/production-extension/api-custom-runtime.js';

function fixture(mode='custom'){
 const context=vm.createContext({});
 vm.runInContext(`globalThis.install=(${installApiCustom.toString()});
  const records=new WeakSet();globalThis.nativeCalls=0;globalThis.backendCalls=0;globalThis.brandCalls=0;
  globalThis.nativeBrandError=new TypeError('native UAData brand');globalThis.nativeResult=Promise.resolve({architecture:'native'});
  globalThis.NativePromise=Promise;globalThis.NativeTypeError=TypeError;globalThis.nativeThen=Promise.prototype.then;
  globalThis.NavigatorUAData=class NavigatorUAData{
   constructor(){records.add(this);}
   get mobile(){brandCalls++;if(!records.has(this))throw nativeBrandError;return true;}
   get brands(){if(!records.has(this))throw nativeBrandError;return[{brand:'native',version:'1'}];}
   get platform(){if(!records.has(this))throw nativeBrandError;return'native';}
   getHighEntropyValues(){nativeCalls++;globalThis.nativeThis=this;globalThis.nativeArgs=arguments;if(!records.has(this))return Promise.reject(nativeBrandError);backendCalls++;return nativeResult;}
  };
  globalThis.receiver=new NavigatorUAData();globalThis.selected={brands:[{brand:'selected',version:'2'}],mobile:false,platform:'selected',architecture:'selected-arch'};
  globalThis.guard=install(globalThis,[{id:'client-hints',mode:${JSON.stringify(mode)},value:selected}]);
 `,context);
 return{context,run:source=>vm.runInContext(source,context)};
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('UAData Custom snapshots requested selected/neutral values without a native high-entropy operation',async()=>{
 const f=fixture();
 const value=await f.run(`receiver.getHighEntropyValues(['wow64','fullVersionList','formFactors','bitness','uaFullVersion','platformVersion','model','architecture','architecture','unknown'])`);
 assert.deepEqual(Object.keys(value),['architecture','bitness','brands','formFactors','fullVersionList','mobile','model','platform','platformVersion','uaFullVersion','wow64']);
 assert.deepEqual(plain(value),{architecture:'selected-arch',bitness:'',brands:[{brand:'selected',version:'2'}],formFactors:[],fullVersionList:[],mobile:false,model:'',platform:'selected',platformVersion:'',uaFullVersion:'',wow64:false});
 assert.equal(f.context.nativeCalls,0);assert.equal(f.context.backendCalls,0);assert.equal(f.context.brandCalls,1);
 assert.deepEqual(plain(await f.run(`receiver.getHighEntropyValues([])`)),{brands:[{brand:'selected',version:'2'}],mobile:false,platform:'selected'});
 assert.equal(f.context.backendCalls,0);
});

test('UAData Custom values are fresh realm-local records and caller/profile mutation cannot change later snapshots',async()=>{
 const f=fixture();f.run(`globalThis.first=receiver.getHighEntropyValues(['architecture']);selected.platform='mutated';selected.brands[0].brand='mutated';`);
 const first=await f.context.first;first.brands[0].brand='caller';
 const second=await f.run(`receiver.getHighEntropyValues(['architecture'])`);
 assert.equal(second.platform,'selected');assert.equal(second.brands[0].brand,'selected');assert.notEqual(first,second);assert.notEqual(first.brands,second.brands);
 assert.equal(f.run('Object.getPrototypeOf(first)===Promise.prototype'),true);
 f.context.second=second;assert.equal(f.run('Object.getPrototypeOf(second)===Object.prototype&&Object.getPrototypeOf(second.brands)===Array.prototype'),true);
});

test('UAData sequence follows measured Chromium getter order/receivers without closing on a thrown conversion',async()=>{
 const f=fixture();
 const value=await f.run(`globalThis.events=[];globalThis.index=0;
 globalThis.item={get [Symbol.toPrimitive](){events.push('get coercion');return function(hint){events.push('coerce '+hint+' '+(this===item));return'architecture';};}};
 globalThis.iterator={get next(){events.push('get next '+(this===iterator));return function(){events.push('next call '+(this===iterator));return{get value(){events.push('get value');return item;},get done(){events.push('get done');return index++>0;}};};},get return(){events.push('get return');throw Error('must not close');}};
 globalThis.input={get [Symbol.iterator](){events.push('get iterator '+(this===input));return function(){events.push('iterator call '+(this===input));return iterator;};}};
 receiver.getHighEntropyValues(input)`);
 assert.equal(value.architecture,'selected-arch');assert.deepEqual(plain(f.context.events),['get iterator true','iterator call true','get next true','next call true','get value','get done','get coercion','coerce string true','next call true','get value','get done']);
 assert.equal(f.context.backendCalls,0);
});

for(const stage of ['iterator','iterator-call','next-get','next-call','value','done','coercion-get','coercion-call'])test('UAData propagates exact '+stage+' exception as a rejected Promise without iterator close or backend',async()=>{
 const f=fixture();
 const result=f.run(`globalThis.sentinel=Error('caller sentinel');globalThis.closeReads=0;globalThis.stage=${JSON.stringify(stage)};
 const item={get [Symbol.toPrimitive](){if(stage==='coercion-get')throw sentinel;return function(){if(stage==='coercion-call')throw sentinel;return'architecture';};}};
 const iterator={get next(){if(stage==='next-get')throw sentinel;return function(){if(stage==='next-call')throw sentinel;return{get value(){if(stage==='value')throw sentinel;return item;},get done(){if(stage==='done')throw sentinel;return false;}};};},get return(){closeReads++;throw Error('must not close');}};
 const input={get [Symbol.iterator](){if(stage==='iterator')throw sentinel;return function(){if(stage==='iterator-call')throw sentinel;return iterator;};}};
 receiver.getHighEntropyValues(input)`);
 await assert.rejects(result,error=>error===f.context.sentinel);assert.equal(f.context.closeReads,0);assert.equal(f.context.backendCalls,0);assert.equal(f.context.nativeCalls,0);
});

for(const input of[
 '', 'undefined', 'null', "'architecture'", '{}', '{[Symbol.iterator]:1}',
 '{[Symbol.iterator](){return 1;}}', '{[Symbol.iterator](){return{next:1};}}',
 '{[Symbol.iterator](){return{next(){return 1;}};}}', "[Symbol('owned')]",
 '[{[Symbol.toPrimitive](){return Symbol();}}]', '[{[Symbol.toPrimitive](){return{};}}]',
 '[{[Symbol.toPrimitive]:1}]'
])test('UAData invalid sequence '+(input||'missing')+' rejects captured TypeError without backend',async()=>{
 const f=fixture(),result=f.run('receiver.getHighEntropyValues('+input+')');
 await assert.rejects(result,error=>error instanceof f.context.NativeTypeError&&error.message==='Custom client hints arguments could not be converted');
 assert.equal(f.context.nativeCalls,0);assert.equal(f.context.backendCalls,0);
});

test('UAData native brand oracle rejects a Proxy without traps and original receives only private invalid sentinel',async()=>{
 const f=fixture();const result=f.run(`globalThis.traps=0;globalThis.caller=new Proxy({},{get(){traps++;throw Error('receiver trap');}});Reflect.apply(receiver.getHighEntropyValues,caller,[{get [Symbol.iterator](){traps++;throw Error('argument trap');}}])`);
 await assert.rejects(result,error=>error===f.context.nativeBrandError);assert.equal(f.context.traps,0);assert.equal(f.context.backendCalls,0);assert.equal(f.context.nativeCalls,1);assert.equal(f.run('nativeThis===caller'),false);
});

test('UAData conversion/deferred Promise pollution can observe selected dictionaries only and invokes no backend',async()=>{
 for(const timing of ['conversion','deferred']){
  const f=fixture();
  const returned=f.run(`globalThis.captured=[];globalThis.poison=()=>Object.defineProperty(Object.prototype,'then',{configurable:true,get(){if(Object.hasOwn(this,'architecture'))captured.push(this.architecture);return undefined;}});
  globalThis.input=[{[Symbol.toPrimitive](hint){if(${JSON.stringify(timing)}==='conversion')poison();return'architecture';}}];
  globalThis.returned=receiver.getHighEntropyValues(input);if(${JSON.stringify(timing)}==='deferred')poison();returned;`);
  const value=await returned;assert.equal(value.architecture,'selected-arch');assert.ok(f.context.captured.length>0);assert.deepEqual([...f.context.captured],Array(f.context.captured.length).fill('selected-arch'));
  f.run('delete Object.prototype.then');assert.equal(f.context.backendCalls,0);assert.equal(f.context.nativeCalls,0);
 }
});

test('UAData captured Promise/String/symbols remain functional when public globals and Promise methods are replaced',async()=>{
 const f=fixture();
 const returned=f.run(`globalThis.Promise=function(){throw Error('public Promise');};globalThis.String=function(){throw Error('public String');};globalThis.Symbol={};NativePromise.resolve=()=>{throw Error('public resolve');};NativePromise.prototype.then=()=>{throw Error('public then');};receiver.getHighEntropyValues(['architecture'])`);
 f.run('NativePromise.prototype.then=nativeThen');
 assert.equal((await returned).architecture,'selected-arch');assert.equal(f.context.backendCalls,0);
});

test('UAData Stop preserves started selected snapshot; future and retained calls delegate native once with exact this/args/Promise',async()=>{
 const f=fixture();f.run(`globalThis.retained=receiver.getHighEntropyValues;globalThis.started=retained.call(receiver,['architecture']);guard.stop();globalThis.arg={};globalThis.after=retained.call(receiver,arg);`);
 assert.equal((await f.context.started).architecture,'selected-arch');assert.equal(f.run('after===nativeResult'),true);assert.equal(f.run('nativeThis===receiver&&nativeArgs[0]===arg'),true);assert.equal(f.context.nativeCalls,1);assert.equal(f.context.backendCalls,1);
});

for(const mode of ['off','bypass'])test('UAData '+mode+' preserves native invocation/Promise identity',()=>{
 const f=fixture(mode);assert.equal(f.run(`globalThis.reads=0;globalThis.opaque=new Proxy({},{get(){reads++;throw Error('opaque argument');}});receiver.getHighEntropyValues(opaque,Symbol('extra'),undefined)===nativeResult`),true);
 assert.equal(f.context.reads,0);assert.equal(f.run('nativeThis===receiver&&nativeArgs[0]===opaque&&nativeArgs.length===3'),true);assert.equal(f.context.backendCalls,1);assert.equal(f.context.nativeCalls,1);
});

test('UAData absent API/native brand getter is not fabricated and oversized sequences fail boundedly',async()=>{
 const f=fixture();f.run(`guard.stop();delete NavigatorUAData.prototype.mobile;globalThis.original=NavigatorUAData.prototype.getHighEntropyValues;globalThis.absent=install(globalThis,[{id:'client-hints',value:selected}]);`);
 assert.equal(f.run('NavigatorUAData.prototype.getHighEntropyValues===original'),true);assert.ok(f.run('absent.snapshot().unavailable')>0);
 const g=fixture();const returned=g.run(`globalThis.reads=0;receiver.getHighEntropyValues({[Symbol.iterator](){return{next(){reads++;return{value:'unknown',done:false};}};}})`);
 await assert.rejects(returned,error=>error instanceof g.context.NativeTypeError);assert.equal(g.context.reads,4097);assert.equal(g.context.backendCalls,0);assert.ok(g.run('guard.snapshot().unavailable')>0);
});

test('native WorkerNavigator is used without fabricating a Window Navigator global',()=>{
 const context=vm.createContext({});vm.runInContext(`globalThis.install=(${installApiCustom.toString()});globalThis.nativeReads=0;
 globalThis.WorkerNavigator=class WorkerNavigator{get platform(){nativeReads++;if(this!==receiver)throw Error('native worker brand');return'native-worker';}};
 globalThis.receiver=new WorkerNavigator();globalThis.guard=install(globalThis,[{id:'navigator-platform',value:'selected-worker'}]);`,context);
 assert.equal(vm.runInContext('nativeReads',context),0);assert.equal(vm.runInContext('typeof Navigator',context),'undefined');assert.equal(vm.runInContext('receiver.platform',context),'selected-worker');
 assert.equal(vm.runInContext('nativeReads',context),1);vm.runInContext('guard.stop()',context);assert.equal(vm.runInContext('receiver.platform',context),'native-worker');
});

test('inherited UAData installation never constructs a late child replacement TypeError',async()=>{
 const parent=fixture(),child=fixture();child.run(`guard.stop();globalThis.constructorCalls=0;globalThis.TypeError=function(){constructorCalls++;throw Error('late public child constructor');};`);
 parent.context.adopted=child.run('globalThis');parent.run(`install(adopted,[{id:'client-hints',value:selected}]);`);
 const returned=child.run(`receiver.getHighEntropyValues([Symbol('invalid')])`);
 await assert.rejects(returned,error=>error instanceof parent.context.NativeTypeError&&error.message==='Custom client hints arguments could not be converted');
 assert.equal(child.context.constructorCalls,0);assert.equal(child.context.backendCalls,0);
});
