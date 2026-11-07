import assert from 'node:assert/strict';
import test from 'node:test';
import {MANAGEMENT_GROUPS,MANAGEMENT_TABS,MANAGEMENT_SECTIONS,managementSectionForHash,managementHashForSection} from '../../apps/production-extension/management-ui.js';
import {STATUS_MODULES,moduleStatus,createModuleStatusController} from '../../apps/production-extension/management-module-status.js';
import {managementNavigationLabels} from '../../apps/production-extension/management-navigation-labels.js';
const turn=()=>new Promise(done=>setImmediate(done));
test('ADR-103: the hub leads eleven primary entries in four groups and the nested Debug route remains',()=>{
 assert.deepEqual(MANAGEMENT_GROUPS.map(x=>[x.id,[...x.tabs]]),[['analysis',['detector']],['defense',['api','firewall']],['attack',['antidetect','autosurf','cookies','proxy']],['tools',['integrations','settings','contacts']]]);
 assert.equal(MANAGEMENT_TABS[0],'hub');assert.equal(managementSectionForHash(''),'hub');assert.equal(managementSectionForHash('#hub'),'hub');assert.equal(managementSectionForHash('#settings'),'settings');
 assert.equal(MANAGEMENT_TABS.length,11);assert.equal(new Set(MANAGEMENT_TABS).size,11);assert.equal(MANAGEMENT_SECTIONS.length,12);assert.ok(!MANAGEMENT_TABS.includes('browser-debug'));
 assert.equal(managementSectionForHash('#detector'),'detector');assert.equal(managementHashForSection('detector'),'#detector');for(const hash of['#protect','#firewall','#history','#requests'])assert.equal(managementSectionForHash(hash),'firewall');
 assert.equal(managementSectionForHash('#integrations'),'integrations');assert.equal(managementHashForSection('integrations'),'#integrations');assert.equal(managementSectionForHash('#api'),'api');
 assert.deepEqual(STATUS_MODULES,['antidetect','autosurf','proxy','api','detector','firewall']);for(const utility of['cookies','integrations','settings','contacts'])assert.ok(!STATUS_MODULES.includes(utility));
});
test('saved guard registration and actual proxy/run states distinguish active from intent or pause',()=>{
 for(const section of['api','antidetect']){const key=section==='api'?'enabled':'antidetectEnabled',value={type:'api-config-state',configuration:{[key]:true},registration:'ready'};assert.equal(moduleStatus(section,value),'active');assert.equal(moduleStatus(section,{...value,registration:'error'}),'error');assert.equal(moduleStatus(section,{...value,configuration:{[key]:false}}),'off');assert.equal(moduleStatus(section,{}),'unknown');}
 assert.equal(moduleStatus('autosurf',{status:'running'}),'active');assert.equal(moduleStatus('autosurf',{status:'paused'}),'paused');assert.equal(moduleStatus('autosurf',{status:'completed'}),'off');
 assert.equal(moduleStatus('proxy',{configuration:{enabled:true},status:{state:'connected'}}),'active');assert.equal(moduleStatus('proxy',{configuration:{enabled:true},status:{state:'connecting'}}),'connecting');assert.notEqual(moduleStatus('proxy',{configuration:{enabled:false},status:{state:'connected'}}),'active');
 assert.equal(moduleStatus('firewall',{type:'protect-state',state:{state:'active'}}),'active');assert.equal(moduleStatus('firewall',{type:'protect-state',state:{state:'off'}}),'off');assert.equal(moduleStatus('detector',{enabled:true}),'active');
 assert.equal(moduleStatus('api',{type:'api-config-state',configuration:{enabled:true},registration:'inactive'}),'inactive');assert.equal(managementNavigationLabels('ru').inactive,'Нет активных правил');
});
function fixture(){
 const messages=[],storage=new Set(),permissions=new Set(),autoCallbacks=[],proxyCallbacks=[];let loads=0;
 const api={runtime:{getManifest:()=>({permissions:['declarativeNetRequestWithHostAccess']}),sendMessage:async value=>{messages.push(value);switch(value.type){case'ui-api-config-get':return{type:'api-config-state',configuration:{enabled:true,antidetectEnabled:false},registration:'ready'};case'ui-data-consent-get':return{accepted:true};case'ui-get-scope':return{type:'scope',scope:{scopeMode:'all-sites'}};case'ui-protect-get-state':return{type:'protect-state',state:{state:'off'}};default:throw Error('unexpected mutation '+value.type);}}},storage:{onChanged:{addListener:fn=>storage.add(fn),removeListener:fn=>storage.delete(fn)}},permissions:{onAdded:{addListener:fn=>permissions.add(fn),removeListener:fn=>permissions.delete(fn)},onRemoved:{addListener:fn=>permissions.add(fn),removeListener:fn=>permissions.delete(fn)}}};
 const controller=createModuleStatusController(api,{autosurfFactory:(_,{onChange})=>{autoCallbacks.push(onChange);return{load:async()=>{loads++;return{status:'idle'}},dispose(){}}},proxyFactory:(_,{onChange})=>{proxyCallbacks.push(onChange);return{load:async()=>{loads++;return{configuration:{enabled:false},status:{state:'off'}}},dispose(){}}}});
 return{controller,messages,storage,permissions,autoCallbacks,proxyCallbacks,get loads(){return loads},emit(changes,area='local'){for(const fn of storage)fn(changes,area)}};
}
test('indicator initialization uses only existing reads and theme changes cause no feature reads or writes',async()=>{
 const f=fixture();await f.controller.refresh();assert.equal(f.messages.length,0);f.controller.setActive(true);await turn();await turn();
 assert.deepEqual(f.messages.map(x=>x.type).sort(),['ui-api-config-get','ui-data-consent-get','ui-get-scope','ui-protect-get-state'].sort());assert.equal(f.loads,2);assert.equal(f.controller.getState().api,'active');assert.equal(f.controller.getState().antidetect,'off');assert.equal(f.controller.getState().detector,'active');
 const count=f.messages.length;f.emit({'ui-theme-v1':{newValue:'glass'}});await turn();assert.equal(f.messages.length,count);assert.equal(f.loads,2);assert.ok(f.messages.every(x=>x.schemaVersion===1&&!x.type.includes('-set')));f.controller.dispose();
});
test('native run/connection broadcasts update dots while stale hidden-page callbacks cannot',async()=>{
 const f=fixture();f.controller.setActive(true);await turn();await turn();f.autoCallbacks[0]({status:'running'});f.proxyCallbacks[0]({configuration:{enabled:true},status:{state:'connected'}});assert.equal(f.controller.getState().autosurf,'active');assert.equal(f.controller.getState().proxy,'active');
 f.controller.setActive(false);f.controller.setActive(true);await turn();await turn();assert.equal(f.controller.getState().proxy,'off');f.proxyCallbacks[0]({configuration:{enabled:true},status:{state:'connected'}});assert.equal(f.controller.getState().proxy,'off');f.autoCallbacks.at(-1)({status:'paused'});assert.equal(f.controller.getState().autosurf,'paused');f.controller.dispose();assert.equal(f.storage.size,0);assert.equal(f.permissions.size,0);
});
test('storage notifications refresh only the affected family and never query Cookies',async()=>{
 const f=fixture();f.controller.setActive(true);await turn();await turn();const before=f.messages.length;f.emit({'api-configuration:v1':{newValue:{}}});await turn();await turn();assert.deepEqual(f.messages.slice(before).map(x=>x.type),['ui-api-config-get']);assert.equal(f.loads,2);
 f.emit({'autosurf:run:v1':{newValue:{}}});await turn();await turn();assert.equal(f.loads,3);assert.ok(!f.messages.some(x=>/cookie|export|connect|start|enable/iu.test(x.type)));f.controller.dispose();
});
test('all supported UI languages have concrete group/status labels and the requested Russian names',()=>{
 assert.deepEqual(Object.fromEntries(['attack','defense','tools'].map(k=>[k,managementNavigationLabels('ru')[k]])),{attack:'Атака',defense:'Защита',tools:'Инструменты'});
 for(const locale of['ru','en','zh_CN','vi','es','ar','uk','fr','pt_BR','hi','ur','ja','de','pl','id','mr','te','ko','ta','yue','wuu'])for(const value of Object.values(managementNavigationLabels(locale)))assert.ok(typeof value==='string'&&value.trim());
});

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject};}
function controlled(){
 const listeners=new Set(),timers=new Map(),proxyCallbacks=[],observed=[];let clock=0,sequence=0,enabled=false,apiHold=null,proxyHold=deferred(),apiReads=0,proxyReads=0;
 const response=()=>({type:'api-config-state',configuration:{enabled:false,antidetectEnabled:enabled},registration:'ready'});
 const event={addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)};
 const api={runtime:{getManifest:()=>({permissions:[]}),sendMessage(message){if(message.type==='ui-api-config-get'){apiReads++;if(apiHold){const held=apiHold;apiHold=null;return held.promise;}return Promise.resolve(response());}if(message.type==='ui-data-consent-get')return Promise.resolve({accepted:true});if(message.type==='ui-get-scope')return Promise.resolve({type:'scope',scope:{scopeMode:'off'}});throw Error('unexpected write');}},storage:{onChanged:event},permissions:{}};
 const env={setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout(id){timers.delete(id);}};
 const controller=createModuleStatusController(api,{env,onChange:value=>observed.push(value),autosurfFactory:()=>({load:async()=>({status:'idle'}),dispose(){}}),proxyFactory:(_,{onChange})=>{proxyCallbacks.push(onChange);return{load(){proxyReads++;if(proxyHold){const held=proxyHold;proxyHold=null;return held.promise;}return Promise.resolve({configuration:{enabled:false},status:{state:'off'}});},dispose(){}}}});
 const firstProxy=proxyHold;
 return{controller,response,observed,proxyCallbacks,timers,listeners,firstProxy,get apiReads(){return apiReads;},get proxyReads(){return proxyReads;},set enabled(value){enabled=value;},holdApi(value){apiHold=value;},emit(key='api-configuration:v1'){for(const fn of listeners)fn({[key]:{newValue:{}}},'local');},advance(ms){clock+=ms;for(const[id,timer]of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}},async settle(){for(let n=0;n<5;n++)await turn();},cleanup(){controller.dispose();firstProxy.resolve({configuration:{enabled:false},status:{state:'off'}});}};
}
test('a blocked Proxy load cannot delay API storage refresh; one hundred events coalesce within the API family',async()=>{
 const f=controlled(),held=deferred();try{
  f.controller.setActive(true);await f.settle();assert.equal(f.apiReads,1);assert.equal(f.controller.getState().antidetect,'off');
  f.enabled=true;f.holdApi(held);for(let n=0;n<100;n++)f.emit();await f.settle();assert.equal(f.apiReads,2,'API starts independently of the blocked Proxy family');assert.equal(f.proxyReads,1);
  held.resolve(f.response());await f.settle();assert.equal(f.apiReads,3,'the burst retains exactly one fresh rerun');assert.equal(f.controller.getState().antidetect,'active');assert.equal(f.proxyReads,1);
 }finally{held.resolve(f.response());f.cleanup();await f.settle();}
});
test('logical timeout never releases a still-physical family read or adopts its late stale response',async()=>{
 const f=controlled(),held=deferred();try{
  f.controller.setActive(true);await f.settle();f.holdApi(held);f.emit();await f.settle();assert.equal(f.apiReads,2);
  f.advance(4000);await f.settle();assert.equal(f.controller.getState().antidetect,'unknown');
  for(let n=0;n<100;n++){f.emit();f.emit('proxy:configuration:v1');}await f.settle();assert.equal(f.apiReads,2);assert.equal(f.proxyReads,1);
  held.resolve({type:'api-config-state',configuration:{enabled:false,antidetectEnabled:true},registration:'ready'});await f.settle();assert.equal(f.apiReads,3);assert.equal(f.controller.getState().antidetect,'off');assert.equal(f.observed.some(value=>value.antidetect==='active'),false);
  f.firstProxy.resolve({configuration:{enabled:false},status:{state:'off'}});await f.settle();assert.equal(f.proxyReads,2);
 }finally{held.resolve(f.response());f.cleanup();await f.settle();}
});
test('a storage invalidation suppresses an older held ON read before the queued OFF result',async()=>{
 const f=controlled(),held=deferred();try{
  f.enabled=true;f.holdApi(held);f.controller.setActive(true);await f.settle();assert.equal(f.apiReads,1);
  f.enabled=false;f.emit();await f.settle();assert.equal(f.apiReads,1);
  held.resolve({type:'api-config-state',configuration:{enabled:false,antidetectEnabled:true},registration:'ready'});await f.settle();assert.equal(f.apiReads,2);assert.equal(f.controller.getState().antidetect,'off');assert.equal(f.observed.some(value=>value.antidetect==='active'),false,'old ON must never repaint after the OFF invalidation');
 }finally{held.resolve(f.response());f.cleanup();await f.settle();}
});
test('scope and consent changes reread Guard with Detector without touching Proxy or Autosurfer',async()=>{
 const f=fixture();try{
  f.controller.setActive(true);await turn();await turn();const loads=f.loads;
  for(const[key,area]of[['scope','local'],['data-consent:v1','local'],['data-consent:pending-v1','session']]){const before=f.messages.length;f.emit({[key]:{newValue:{}}},area);await turn();await turn();assert.deepEqual(f.messages.slice(before).map(message=>message.type).sort(),['ui-api-config-get','ui-data-consent-get','ui-get-scope'].sort());assert.equal(f.loads,loads);}
 }finally{f.controller.dispose();}
});
test('an invalidated active observation cannot stay green behind a physically hung old read',async()=>{
 const f=controlled(),held=deferred();try{
  f.enabled=true;f.controller.setActive(true);await f.settle();assert.equal(f.controller.getState().antidetect,'active');
  f.holdApi(held);void f.controller.refresh(['api']);await f.settle();assert.equal(f.apiReads,2);
  f.enabled=false;f.emit('data-consent:v1');assert.equal(f.controller.getState().antidetect,'unknown');f.advance(4000);await f.settle();assert.equal(f.controller.getState().antidetect,'unknown');assert.equal(f.apiReads,2);
  const before=f.observed.length;held.resolve({type:'api-config-state',configuration:{enabled:false,antidetectEnabled:true},registration:'ready'});await f.settle();assert.equal(f.controller.getState().antidetect,'off');assert.equal(f.apiReads,3);assert.equal(f.observed.slice(before).some(value=>value.antidetect==='active'),false);
 }finally{held.resolve(f.response());f.cleanup();await f.settle();}
});
test('a hidden epoch retains the physical gate while old replies and old client callbacks cannot repaint the resumed view',async()=>{
 const f=controlled(),held=deferred();try{
  f.holdApi(held);f.controller.setActive(true);await f.settle();assert.equal(f.apiReads,1);
  f.controller.setActive(false);f.controller.setActive(true);await f.settle();assert.equal(f.apiReads,1);assert.equal(f.proxyReads,1);
  f.proxyCallbacks[0]({configuration:{enabled:true},status:{state:'connected'}});assert.notEqual(f.controller.getState().proxy,'active');
  held.resolve({type:'api-config-state',configuration:{enabled:false,antidetectEnabled:true},registration:'ready'});await f.settle();assert.equal(f.apiReads,2);assert.equal(f.controller.getState().antidetect,'off');assert.equal(f.observed.some(value=>value.antidetect==='active'),false);
 }finally{held.resolve(f.response());f.cleanup();await f.settle();}
});
test('a fresh current-client broadcast wins over a pending read failure and dispose cancels every logical timer',async()=>{
 const f=controlled();try{
  f.controller.setActive(true);await f.settle();f.proxyCallbacks[0]({configuration:{enabled:true},status:{state:'connected'}});assert.equal(f.controller.getState().proxy,'active');
  f.firstProxy.reject(Error('late read failure'));await f.settle();assert.equal(f.controller.getState().proxy,'active','late failure must not erase a newer actual observation');
  const held=deferred();f.holdApi(held);f.emit();await f.settle();const before=f.apiReads;f.controller.dispose();assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);f.advance(10000);held.resolve(f.response());await f.settle();assert.equal(f.apiReads,before);
 }finally{f.cleanup();await f.settle();}
});
