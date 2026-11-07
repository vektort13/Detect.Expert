// DET-043 / REQ-002/005 / ADR-006: site API observations, never physical movement counts.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function section(source,start,end){
 const from=source.indexOf(start),to=source.indexOf(end,from);
 assert.ok(from>=0&&to>from,'audited production module boundaries');return source.slice(from,to);
}
function fixture(file){
 const source=readFileSync(new URL('../../apps/production-extension/'+file,import.meta.url),'utf8');
 const context=vm.createContext({TECHNIQUE_INDEX:{'DET-043':43},PHASE_INDEX:{'returned-sync':1,'threw-sync':2},
  signalMaskOf:values=>values.includes('movement-listener')?3:5,arrayPush:(array,value)=>array.push(value),
  extendedSurfacesSupport:{observeDeviceEvent(){}},screenEventOperation:()=>null,API_OPERATION_INDEX:{}});
 vm.runInContext(section(source,'  // packages/sensors/src/wrap.ts','  // packages/sensors/src/intrinsics.ts')+
 section(source,'  // packages/sensors/src/interaction.ts','  // packages/sensors/src/audio.ts')+`
 const listeners=new WeakMap(),coordinates=new WeakMap(),handlers=new WeakMap();
 globalThis.nativeCalls={add:0,get:0,set:0,dispatch:0};globalThis.returnMarker={nativeResult:true};
 globalThis.brandError=new TypeError('NATIVE_BRAND');globalThis.nativeError=new Error('NATIVE_SENTINEL');
 class EventTarget{
  constructor(){listeners.set(this,[]);}
  addEventListener(type,callback,options){
   nativeCalls.add++;const records=listeners.get(this);if(!records)throw brandError;
   const name=String(type);if(callback===nativeError)throw nativeError;
   if(options!==null&&typeof options==='object')void options.capture;
   if(callback!==undefined&&callback!==null)records.push({type:name,callback});return returnMarker;
  }
  dispatch(type,event){nativeCalls.dispatch++;for(const row of listeners.get(this))if(row.type===type&&typeof row.callback==='function')Reflect.apply(row.callback,this,[event]);}
 }
 class MouseEvent{constructor(value){coordinates.set(this,value);}}
 for(const key of['clientX','clientY','screenX','screenY','pageX','pageY','offsetX','offsetY','movementX','movementY','x','y'])
  Object.defineProperty(MouseEvent.prototype,key,{configurable:true,get(){nativeCalls.get++;if(!coordinates.has(this))throw brandError;return coordinates.get(this);}});
 globalThis.realm={EventTarget,MouseEvent};
 function handler(target,key){Object.defineProperty(target,key,{configurable:true,get(){return handlers.get(this);},set(value){nativeCalls.set++;if(value===nativeError)throw nativeError;handlers.set(this,value);}});}
 for(const key of['onmousemove','onpointermove','onpointerrawupdate'])handler(realm,key);
 for(const name of['Document','HTMLElement','SVGElement','MathMLElement']){
  const Constructor=class{};realm[name]=Constructor;for(const key of['onmousemove','onpointermove','onpointerrawupdate'])handler(Constructor.prototype,key);
 }
 globalThis.runtime={hooks:createHookContext(),events:[],flags:[],handles:[],
  record(...args){this.events.push(args);},recordOperation(){throw Error('unexpected operation registry change');},
  addFlag(value){this.flags.push(value);},attach(values){for(const value of values)if(value.status==='installed')this.handles.push(value);else this.addFlag(value.coverageFlag);}};
 globalThis.install=()=>installInteractionSensor(runtime,realm);install();
 globalThis.target=new EventTarget();
 `,context);
 return{context,run:source=>vm.runInContext(source,context),events:()=>JSON.parse(vm.runInContext('JSON.stringify(runtime.events)',context))};
}

for(const file of['hook.early.js','hook.main.js']){
 test(file+': all three movement subscriptions preserve native arguments/result once and only emit registration metadata',()=>{
  const f=fixture(file);f.run(`globalThis.optionReads=0;globalThis.callbackReads=0;
  globalThis.callback=new Proxy(function(){},{get(){callbackReads++;throw Error('callback probed');}});
  globalThis.options={get capture(){optionReads++;return false;}};
  for(const type of['mousemove','pointermove','pointerrawupdate'])if(target.addEventListener(type,callback,options)!==returnMarker)throw Error('native result identity');`);
  assert.equal(f.context.nativeCalls.add,3);assert.equal(f.context.optionReads,3);assert.equal(f.context.callbackReads,0);
  assert.deepEqual(f.events(),[[43,1,3],[43,1,3],[43,1,3]]);
 });

 test(file+': movement delivery itself is not misreported as registration or coordinate reading; page reads are counted separately',()=>{
  const f=fixture(file);f.run(`globalThis.delivered=0;target.addEventListener('mousemove',()=>delivered++);
  globalThis.event=new realm.MouseEvent(-0);Object.defineProperties(event,{type:{get(){throw Error('event type probe');}},isTrusted:{get(){throw Error('trusted probe');}}});
  target.dispatch('mousemove',event);target.dispatch('mousemove',event);`);
  assert.equal(f.context.delivered,2);assert.deepEqual(f.events(),[[43,1,3]]);
  const result=f.run('event.clientX');assert.ok(Object.is(result,-0));assert.equal(f.context.nativeCalls.get,1);
  assert.deepEqual(f.events(),[[43,1,3],[43,1,5]]);
  assert.deepEqual(f.events().map(row=>row.length),[3,3]);
 });

 test(file+': all twelve coordinate getters preserve original value/brand errors and never inspect event fields or retain values',()=>{
  const f=fixture(file);f.run(`globalThis.event=new realm.MouseEvent(NaN);Object.defineProperties(event,{type:{get(){throw Error('event type probe');}},isTrusted:{get(){throw Error('trusted probe');}}});
  for(const key of['clientX','clientY','screenX','screenY','pageX','pageY','offsetX','offsetY','movementX','movementY','x','y'])if(!Number.isNaN(event[key]))throw Error('native result changed');`);
  assert.equal(f.context.nativeCalls.get,12);assert.deepEqual(f.events(),Array.from({length:12},()=>[43,1,5]));
  assert.throws(()=>f.run(`Reflect.apply(Object.getOwnPropertyDescriptor(realm.MouseEvent.prototype,'clientX').get,{},[])`),error=>error===f.context.brandError);
  assert.equal(f.context.nativeCalls.get,13);assert.deepEqual(f.events().at(-1),[43,2,5]);
  assert.ok(f.events().every(row=>row.length===3&&row.every(Number.isInteger)));
 });

 test(file+': listener coercion/options stay native-only and failed, null or unrelated attempts keep correct classification',()=>{
  const f=fixture(file);f.run(`globalThis.coercions=0;globalThis.optionReads=0;globalThis.callback={get handleEvent(){throw Error('callback inspected');}};
  target.addEventListener({toString(){coercions++;return 'mousemove';}},callback,{get capture(){optionReads++;return false;}});
  target.addEventListener('keydown',callback);target.addEventListener('mousemove',null);target.addEventListener('pointermove');`);
  assert.equal(f.context.coercions,1);assert.equal(f.context.optionReads,1);assert.deepEqual(f.events(),[],'an opaque coerced name is not coerced again for classification');
  assert.throws(()=>f.run(`target.addEventListener('mousemove',nativeError)`),error=>error===f.context.nativeError);
  assert.deepEqual(f.events(),[[43,2,3]]);assert.equal(f.context.nativeCalls.add,5);
 });

 test(file+': Window/Document/HTML/SVG/MathML on-handlers preserve native setters and classify no null clearing as a subscription',()=>{
  const f=fixture(file);f.run(`globalThis.callback={get handleEvent(){throw Error('callback inspected');}};
  for(const item of[realm,new realm.Document(),new realm.HTMLElement(),new realm.SVGElement(),new realm.MathMLElement()])
   for(const key of['onmousemove','onpointermove','onpointerrawupdate']){item[key]=callback;if(item[key]!==callback)throw Error('setter value changed');item[key]=null;}`);
  assert.equal(f.context.nativeCalls.set,30);assert.deepEqual(f.events(),Array.from({length:15},()=>[43,1,3]));
  assert.throws(()=>f.run('realm.onmousemove=nativeError'),error=>error===f.context.nativeError);assert.deepEqual(f.events().at(-1),[43,2,3]);
 });

 test(file+': repeat install, observer failure, pause and ownership-safe cleanup never duplicate or break page operations',()=>{
  const f=fixture(file);f.run(`install();target.addEventListener('mousemove',()=>{});`);assert.deepEqual(f.events(),[[43,1,3]]);
  f.run(`globalThis.originalRecord=runtime.record;runtime.record=()=>{throw Error('observer failure');};`);
  assert.equal(f.run(`target.addEventListener('pointermove',()=>{})===returnMarker`),true);assert.equal(f.run('runtime.hooks.observerErrors'),1);
  f.run(`runtime.record=originalRecord;runtime.hooks.enabled=false;target.addEventListener('pointerrawupdate',()=>{});`);assert.deepEqual(f.events(),[[43,1,3]]);
  f.run(`globalThis.ours=realm.EventTarget.prototype.addEventListener;globalThis.pageReplacement=function(){return 'page';};realm.EventTarget.prototype.addEventListener=pageReplacement;
  for(const handle of runtime.handles)handle.restore();`);
  assert.equal(f.run('realm.EventTarget.prototype.addEventListener===pageReplacement'),true);
  assert.equal(f.run(`Reflect.apply(ours,target,['mousemove',()=>{}])===returnMarker`),true);assert.equal(f.context.nativeCalls.add,4);assert.deepEqual(f.events(),[[43,1,3]]);
 });
}
