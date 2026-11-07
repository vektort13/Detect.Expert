import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createThemeController,normalizeTheme,THEME_IDS,THEME_STORAGE_KEY} from '../../apps/production-extension/theme-controller.js';
const turn=()=>new Promise(done=>setImmediate(done));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
function root(id='system'){
 const attributes=new Map([['data-ui-theme',id]]);
 return{style:{},getAttribute:key=>attributes.get(key)??null,setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key)};
}
function fixture(initial='system'){
 let value=initial;const changes=new Set(),mediaChanges=new Set(),writes=[],cache=new Map(),media={matches:false,addEventListener:(_,fn)=>mediaChanges.add(fn),removeEventListener:(_,fn)=>mediaChanges.delete(fn)};
 const emit=(next,area='local',key=THEME_STORAGE_KEY)=>{const old=value;if(key===THEME_STORAGE_KEY&&area==='local')value=next;for(const listener of[...changes])listener({[key]:{oldValue:old,newValue:next}},area)};
 const api={storage:{local:{get:async key=>({[key]:value}),set:async next=>{writes.push(next);emit(next[THEME_STORAGE_KEY])}},onChanged:{addListener:fn=>changes.add(fn),removeListener:fn=>changes.delete(fn)}}};
 const make=(id='system',options={})=>{const element=root(id),controller=createThemeController({api,root:element,cache:{setItem:(key,next)=>cache.set(key,next)},media,timeoutMs:40,...options});return{element,controller}};
 return{api,emit,writes,cache,media,changes,mediaChanges,make,system(dark){media.matches=dark;for(const listener of mediaChanges)listener({matches:dark})}};
}
test('appearance accepts exactly six enums without coercing objects or executable strings',async()=>{
 assert.deepEqual(THEME_IDS,['system','pearl','aurora','graphite','orchid','glass']);assert.ok(Object.isFrozen(THEME_IDS));
 let calls=0;const hostile={toString(){calls++;throw Error('must not coerce')}};
 for(const value of[null,undefined,{},[],hostile,Symbol('x'),'Aurora','aurora;url(https://invalid)','__proto__','system-light','system-dark'])assert.equal(normalizeTheme(value),'system');
 assert.equal(calls,0);const f=fixture(),{controller}=f.make();
 for(const value of[hostile,'invalid',null,'system-light','system-dark'])await assert.rejects(controller.setTheme(value),/invalid-theme/u);
 assert.deepEqual(f.writes,[]);controller.dispose();
});
test('initial read applies native preference and writes only the validated first-paint cache',async()=>{
 const f=fixture('aurora'),{element,controller}=f.make();await controller.initializeTheme();
 assert.deepEqual(controller.getThemeSnapshot(),{id:'aurora',effectiveId:'aurora',ready:true,saving:false,error:null});
 assert.equal(element.getAttribute('data-ui-theme'),'aurora');assert.equal(element.style.colorScheme,'dark');assert.equal(f.cache.get(THEME_STORAGE_KEY),'aurora');assert.deepEqual(f.writes,[]);controller.dispose();
});
test('two open surfaces synchronize through native local events without touching any feature key',async()=>{
 const f=fixture('pearl'),a=f.make(),b=f.make();await Promise.all([a.controller.initializeTheme(),b.controller.initializeTheme()]);
 await a.controller.setTheme('glass');assert.equal(b.controller.getThemeSnapshot().id,'glass');
 await b.controller.setTheme('orchid');assert.equal(a.controller.getThemeSnapshot().id,'orchid');assert.equal(a.element.style.colorScheme,'light');
 assert.deepEqual(f.writes,[{'ui-theme-v1':'glass'},{'ui-theme-v1':'orchid'}]);assert.ok(Object.isFrozen(a.controller.getThemeSnapshot()));a.controller.dispose();b.controller.dispose();
});
test('system follows every OS change through separate effective IDs without persisting an OS palette',async()=>{
 const f=fixture('system'),{element,controller}=f.make();await controller.initializeTheme();
 for(const dark of[false,true,false,true]){
  f.system(dark);const expected=dark?'system-dark':'system-light';
  assert.equal(controller.getThemeSnapshot().id,'system');assert.equal(controller.getThemeSnapshot().effectiveId,expected);
  assert.equal(element.getAttribute('data-ui-theme'),'system');assert.equal(element.getAttribute('data-ui-theme-effective'),expected);assert.equal(element.style.colorScheme,dark?'dark':'light');
  assert.equal(f.cache.get(THEME_STORAGE_KEY),'system');assert.deepEqual(f.writes,[]);
 }
 controller.dispose();
});
test('explicit Pearl remains its own light choice and ignores OS events, including when reopened in a dark OS',async()=>{
 const f=fixture('system');f.media.matches=true;const a=f.make();await a.controller.initializeTheme();
 assert.equal(a.controller.getThemeSnapshot().effectiveId,'system-dark');await a.controller.setTheme('pearl');
 let notifications=0;const off=a.controller.subscribeTheme(()=>notifications++);
 for(const dark of[false,true,false,true]){
  f.system(dark);assert.equal(a.controller.getThemeSnapshot().id,'pearl');assert.equal(a.controller.getThemeSnapshot().effectiveId,'pearl');
  assert.equal(a.element.getAttribute('data-ui-theme-effective'),'pearl');assert.equal(a.element.style.colorScheme,'light');
 }
 assert.equal(notifications,0);assert.deepEqual(f.writes,[{[THEME_STORAGE_KEY]:'pearl'}]);assert.equal(f.cache.get(THEME_STORAGE_KEY),'pearl');off();a.controller.dispose();
 const b=f.make();await b.controller.initializeTheme();assert.equal(b.controller.getThemeSnapshot().effectiveId,'pearl');assert.equal(b.element.style.colorScheme,'light');b.controller.dispose();
});
test('a pending startup read cannot overwrite a newer native cross-window change',async()=>{
 const f=fixture(),read=deferred();f.api.storage.local.get=()=>read.promise;const{controller}=f.make();const initial=controller.initializeTheme();
 f.emit('glass');read.resolve({'ui-theme-v1':'pearl'});await initial;assert.equal(controller.getThemeSnapshot().id,'glass');assert.equal(controller.getThemeSnapshot().error,null);controller.dispose();
});
test('failed writes preserve the visible preference and a later retry clears its error',async()=>{
 const f=fixture('pearl'),{controller}=f.make();await controller.initializeTheme();const native=f.api.storage.local.set;
 f.api.storage.local.set=async()=>{throw Error('storage unavailable')};await assert.rejects(controller.setTheme('aurora'));
 assert.deepEqual(controller.getThemeSnapshot(),{id:'pearl',effectiveId:'pearl',ready:true,saving:false,error:'save-failed'});
 f.api.storage.local.set=native;await controller.setTheme('aurora');assert.equal(controller.getThemeSnapshot().error,null);assert.equal(controller.getThemeSnapshot().id,'aurora');controller.dispose();
});
test('an old local completion cannot revert the later authoritative storage event',async()=>{
 const f=fixture('pearl'),pending=deferred(),{controller}=f.make();await controller.initializeTheme();
 f.api.storage.local.set=next=>{f.emit(next[THEME_STORAGE_KEY]);return pending.promise};
 const changing=controller.setTheme('aurora');await turn();f.emit('graphite');pending.resolve();await changing;assert.equal(controller.getThemeSnapshot().id,'graphite');controller.dispose();
});
test('programmatic consecutive selections serialize writes and retain the final preference',async()=>{
 const f=fixture('pearl'),first=deferred(),entered=[];let count=0;f.api.storage.local.set=async next=>{entered.push(next);if(++count===1)await first.promise;f.emit(next[THEME_STORAGE_KEY])};
 const{controller}=f.make();await controller.initializeTheme();const a=controller.setTheme('aurora'),b=controller.setTheme('orchid');await turn();assert.equal(entered.length,1);assert.equal(controller.getThemeSnapshot().saving,true);
 first.resolve();await Promise.all([a,b]);assert.equal(entered.length,2);assert.equal(controller.getThemeSnapshot().id,'orchid');assert.equal(controller.getThemeSnapshot().saving,false);controller.dispose();
});
test('failed and timed-out startup reads settle ready instead of leaving controls disabled',async()=>{
 const f=fixture();f.api.storage.local.get=async()=>{throw Error('read failure')};const a=f.make('graphite');await a.controller.initializeTheme();assert.equal(a.controller.getThemeSnapshot().id,'graphite');assert.equal(a.controller.getThemeSnapshot().ready,true);assert.equal(a.controller.getThemeSnapshot().error,'read-failed');a.controller.dispose();
 f.api.storage.local.get=()=>new Promise(()=>{});const b=f.make('glass',{timeoutMs:5});await b.controller.initializeTheme();assert.equal(b.controller.getThemeSnapshot().ready,true);assert.equal(b.controller.getThemeSnapshot().error,'read-failed');b.controller.dispose();
});
test('session/unrelated changes are ignored and malformed/deleted preferences safely select system',async()=>{
 const f=fixture('aurora'),{controller}=f.make();await controller.initializeTheme();f.emit('glass','session');f.emit('pearl','local','other-setting');assert.equal(controller.getThemeSnapshot().id,'aurora');
 f.emit({toString(){throw Error('not called')}});assert.equal(controller.getThemeSnapshot().id,'system');await controller.setTheme('orchid');f.emit(undefined);assert.equal(controller.getThemeSnapshot().id,'system');controller.dispose();
});
test('isolated view exceptions do not block other subscribers and cleanup removes native listeners',async()=>{
 const f=fixture('pearl'),{controller}=f.make();let updates=0;controller.subscribeTheme(()=>{throw Error('closed view')});const off=controller.subscribeTheme(()=>updates++);await controller.initializeTheme();await controller.setTheme('glass');assert.ok(updates>=2);off();const before=updates;f.emit('aurora');assert.equal(updates,before);controller.dispose();assert.equal(f.changes.size,0);assert.equal(f.mediaChanges.size,0);await assert.rejects(controller.setTheme('pearl'),/theme-closed/u);
});
test('a new surface restores the native preference after all earlier controllers are disposed',async()=>{
 const f=fixture('system'),a=f.make();await a.controller.initializeTheme();await a.controller.setTheme('glass');a.controller.dispose();const b=f.make();await b.controller.initializeTheme();assert.equal(b.controller.getThemeSnapshot().id,'glass');assert.deepEqual(f.writes,[{'ui-theme-v1':'glass'}]);b.controller.dispose();
});
test('early classic bootstrap applies a validated cache before its asynchronous storage read',async()=>{
 const element=root(),cached=new Map([[THEME_STORAGE_KEY,'glass']]),read=deferred();const context={document:{documentElement:element},localStorage:{getItem:key=>cached.get(key),setItem:(key,value)=>cached.set(key,value)},chrome:{storage:{local:{get:()=>read.promise}}},matchMedia:()=>({matches:false}),setTimeout,clearTimeout,Symbol};
 vm.runInNewContext(readFileSync(new URL('../../apps/production-extension/theme-bootstrap.js',import.meta.url),'utf8'),context);
 assert.equal(element.getAttribute('data-ui-theme'),'glass');assert.equal(element.style.colorScheme,'dark');assert.equal(element.getAttribute('data-ui-theme-loading'),'true');
 const boot=context[Symbol.for('detect.expert/ui-theme-bootstrap/v1')];assert.deepEqual([...boot.ids],THEME_IDS);read.resolve({[THEME_STORAGE_KEY]:'orchid'});await boot.initialRead;assert.equal(element.getAttribute('data-ui-theme'),'orchid');assert.equal(element.getAttribute('data-ui-theme-loading'),null);
});
test('early bootstrap and controller agree on distinct System OS palettes and explicit Pearl without migrating stored IDs',async()=>{
 const source=readFileSync(new URL('../../apps/production-extension/theme-bootstrap.js',import.meta.url),'utf8');
 for(const[id,dark,expected]of[['system',false,'system-light'],['system',true,'system-dark'],['pearl',true,'pearl']]){
  const element=root(),cache=new Map([[THEME_STORAGE_KEY,id]]),writes=[];
  const media={matches:dark,addEventListener(){},removeEventListener(){}};
  const api={storage:{local:{get:async()=>({[THEME_STORAGE_KEY]:id}),set:async value=>writes.push(value)},onChanged:{addListener(){},removeListener(){}}}};
  const mirror={getItem:key=>cache.get(key),setItem:(key,value)=>cache.set(key,value)};
  const context={document:{documentElement:element},localStorage:mirror,chrome:api,matchMedia:()=>media,setTimeout,clearTimeout,Symbol};
  vm.runInNewContext(source,context);
  assert.equal(element.getAttribute('data-ui-theme'),id);assert.equal(element.getAttribute('data-ui-theme-effective'),expected);
  assert.equal(element.style.colorScheme,id==='system'&&dark?'dark':'light');
  const bootstrap=context[Symbol.for('detect.expert/ui-theme-bootstrap/v1')];await bootstrap.initialRead;
  const controller=createThemeController({api,root:element,cache:mirror,media,bootstrap});await controller.initializeTheme();
  assert.equal(controller.getThemeSnapshot().id,id);assert.equal(controller.getThemeSnapshot().effectiveId,expected);assert.equal(element.getAttribute('data-ui-theme-effective'),expected);
  assert.equal(cache.get(THEME_STORAGE_KEY),id);assert.deepEqual(writes,[]);controller.dispose();
 }
});
test('claimed bootstrap leaves the final startup decision to the controller revision fence',async()=>{
 const f=fixture(),initial=deferred();f.api.storage.local.get=()=>initial.promise;let claimed=0,finished=0;const boot={claim:()=>claimed++,finishLoading:()=>finished++,initialRead:Promise.resolve({id:'orchid',ok:true})};
 const{controller}=f.make('pearl',{bootstrap:boot});const pending=controller.initializeTheme();f.emit('aurora');initial.resolve({[THEME_STORAGE_KEY]:'orchid'});await pending;assert.equal(claimed,1);assert.ok(finished>0);assert.equal(controller.getThemeSnapshot().id,'aurora');controller.dispose();
});
test('a slow cold storage read restores its choice after the paint deadline without reverting user changes',async()=>{
 const f=fixture(),late=deferred(),boot={claim(){},finishLoading(){},initialRead:Promise.resolve({id:'system',ok:false})};f.api.storage.local.get=()=>late.promise;
 const a=f.make('system',{bootstrap:boot,timeoutMs:5});await a.controller.initializeTheme();assert.equal(a.controller.getThemeSnapshot().ready,true);late.resolve({[THEME_STORAGE_KEY]:'aurora'});await turn();assert.equal(a.controller.getThemeSnapshot().id,'aurora');assert.equal(a.controller.getThemeSnapshot().error,null);a.controller.dispose();
 const second=deferred();f.api.storage.local.get=()=>second.promise;const b=f.make('system',{bootstrap:boot,timeoutMs:5});await b.controller.initializeTheme();await b.controller.setTheme('orchid');second.resolve({[THEME_STORAGE_KEY]:'graphite'});await turn();assert.equal(b.controller.getThemeSnapshot().id,'orchid');b.controller.dispose();
});
test('a bootstrap result captured before native listener attachment cannot replace the newer stored choice',async()=>{
 const f=fixture('orchid'),boot={claim(){},finishLoading(){},initialRead:Promise.resolve({id:'pearl',ok:true})};const{controller}=f.make('pearl',{bootstrap:boot});await controller.initializeTheme();assert.equal(controller.getThemeSnapshot().id,'orchid');controller.dispose();
});
test('timed-out native writes block later writes until their actual settlement, with bounded errors',async()=>{
 const f=fixture('pearl'),pending=deferred();let calls=0;f.api.storage.local.set=()=>{calls++;return pending.promise};const{controller}=f.make('pearl',{timeoutMs:5});await controller.initializeTheme();
 const values=await Promise.allSettled([controller.setTheme('aurora'),controller.setTheme('orchid')]);assert.ok(values.every(row=>row.status==='rejected'));assert.equal(calls,1);assert.equal(controller.getThemeSnapshot().saving,false);await assert.rejects(controller.setTheme('glass'),/theme-save-pending/u);
 pending.resolve();await turn();assert.equal(controller.getThemeSnapshot().id,'aurora');f.api.storage.local.set=async value=>{calls++;f.emit(value[THEME_STORAGE_KEY])};await controller.setTheme('orchid');assert.equal(calls,2);assert.equal(controller.getThemeSnapshot().id,'orchid');controller.dispose();
});
