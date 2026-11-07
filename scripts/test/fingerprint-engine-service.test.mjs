import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiConfiguration,updateApiConfiguration} from '../../apps/production-extension/api-configuration.js';
import {FINGERPRINT_ENGINE_PORT,installFingerprintEngineService,isFingerprintEngineSender,validateFingerprintEngineCommand} from '../../apps/production-extension/fingerprint-engine-service.js';
const event=()=>{const listeners=new Set();return{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn),emit:(...args)=>Promise.all([...listeners].map(fn=>fn(...args))),size:()=>listeners.size};};
const turn=()=>new Promise(done=>setImmediate(done));
function config(){let value=createApiConfiguration();for(const[id,item]of [['hardware-concurrency',3],['css-media',{viewportWidth:800,viewportHeight:600,resolutionDppx:1.25}]]){const changed=updateApiConfiguration(value,id,{mode:'custom',selected:{kind:'value',value:item}});assert.equal(changed.ok,true);value=changed.value;}value.antidetectEnabled=true;return value;}
function fixture(options={}){
 const calls=[],state={revision:7,configuration:config(),active:true,matches:['https://*/*']};let context;
 const api={runtime:{id:'own',getURL:path=>'chrome-extension://own/'+path,onConnect:event()},debugger:{attach(){},sendCommand(){}},windows:{async create(data){calls.push(['create',data]);return options.creation?options.creation():{id:40,tabs:[{id:41,windowId:40}]};},async remove(id){calls.push(['close',id]);}},tabs:{async update(id,data){calls.push(['navigate',id,data]);assert.equal(context?.isCurrent(),true);return{id};},onRemoved:event()},permissions:{async contains(){return options.permission!==false;},onRemoved:event()},webNavigation:{onBeforeNavigate:event()},storage:{onChanged:event()}};
 const driver={snapshot:()=>options.nativeSnapshot??({status:'idle',attached:false,workerCount:0,bootstrappedWorkers:0,unsupported:['shared-worker','service-worker','worklet']}),async start(value){context=value;calls.push(['attach',value.tabId]);if(options.driverStart)await options.driverStart(value);return options.driverResult??{status:'ready',attached:true};},async stop(){calls.push(['detach']);if(options.driverStop)await options.driverStop();},async dispose(){calls.push(['dispose']);}};
 const checkpoint=options.checkpoint??{async restore(){return null;},async save(){},async clear(){}};
 const service=installFingerprintEngineService(api,{checkpoint,getProfile:async()=>{if(options.read)await options.read();return{...state,configuration:structuredClone(state.configuration)};},prepareWorker:async()=>options.prepare?options.prepare():({opaque:true}),driver:options.capture?null:driver,createDriver:(_api,hooks)=>{options.capture(hooks);return driver;}});
 const sender={id:'own',url:'chrome-extension://own/options.html#antidetect',origin:'chrome-extension://own',frameId:0,tab:{url:'chrome-extension://own/options.html'}};
 return{api,service,state,calls,sender,context:()=>context};
}
test('native engine authority accepts only own top-level Options and strict closed commands',()=>{
 const f=fixture();assert.equal(isFingerprintEngineSender(f.api,f.sender),true);
 for(const patch of [{id:'other'},{url:'https://example.test/options.html'},{url:'chrome-extension://own/popup.html'},{frameId:2},{origin:'https://example.test'},{documentLifecycle:'prerender'}])assert.equal(isFingerprintEngineSender(f.api,{...f.sender,...patch}),false);
 for(const message of [{v:1,id:'x',op:'eval',payload:{}},{v:1,id:'x',op:'load',payload:{}},{v:1,id:'x',op:'start',payload:{url:'javascript:alert(1)',expectedRevision:7}},{v:1,id:'x',op:'start',payload:{url:'https://user:pass@example.test/',expectedRevision:7}},{v:1,id:'x',op:'start',payload:{url:'https://example.test/',expectedRevision:7,tabId:99}}])assert.throws(()=>validateFingerprintEngineCommand(message),/invalid-input/);
});
test('native session creates an owned blank window, attaches before navigation and keeps worker fence live after Start',async()=>{
 const f=fixture();await f.service.start({url:'https://native.example.test/path',expectedRevision:7});
 assert.deepEqual(f.calls.slice(0,3).map(row=>row[0]),['create','attach','navigate']);assert.equal(f.calls[0][1].url,'about:blank');assert.equal(f.context().isCurrent(),true,'future worker must remain valid after startup token releases');
 const view=f.service.snapshot();assert.equal(view.sessionOpen,true);assert.doesNotMatch(JSON.stringify(view),/native\.example|tabId|windowId|mathSeed|canvasSeed|opaque/);await f.service.stop();assert.equal(f.context().isCurrent(),false);assert.deepEqual(f.calls.slice(-2),[['detach'],['close',40]]);assert.equal(f.service.snapshot().sessionOpen,false);await f.service.dispose();
});
test('stale revision, no consent/master and missing grants make no window or debugger effect',async()=>{
 for(const kind of ['revision','inactive','master','permission','scope']){
  const f=fixture({permission:kind!=='permission'});if(kind==='inactive')f.state.active=false;if(kind==='master')f.state.configuration.antidetectEnabled=false;if(kind==='scope')f.state.matches=['https://other.example.test/*'];
  await assert.rejects(f.service.start({url:'https://native.example.test/',expectedRevision:kind==='revision'?6:7}),error=>['stale-revision','inactive','scope-denied'].includes(error.code));assert.equal(f.calls.some(row=>row[0]==='create'||row[0]==='attach'),false);await f.service.dispose();
 }
});
test('Stop during physical window creation fences new Start and closes exactly the late owned window',async()=>{
 let finish;const f=fixture({creation:()=>new Promise(done=>{finish=done;})});const starting=f.service.start({url:'https://native.example.test/',expectedRevision:7});
 while(!finish)await turn();await f.service.stop({close:false});await assert.rejects(f.service.start({url:'https://native.example.test/',expectedRevision:7}),/busy/);
 finish({id:50,tabs:[{id:51,windowId:50}]});await assert.rejects(starting,/inactive/);await turn();assert.deepEqual(f.calls.filter(row=>row[0]==='close'),[['close',50]]);assert.equal(f.calls.some(row=>row[0]==='navigate'||row[0]==='attach'),false);await f.service.dispose();
});
test('Stop during driver startup invalidates its fence, prevents navigation and closes its owned window once',async()=>{
 let finish;const f=fixture({driverStart:()=>new Promise(done=>{finish=done;})});const starting=f.service.start({url:'https://native.example.test/',expectedRevision:7});while(!finish)await turn();
 await f.service.stop();finish();await assert.rejects(starting,/inactive/);assert.equal(f.calls.some(row=>row[0]==='navigate'),false);assert.equal(f.context().isCurrent(),false);assert.equal(f.calls.filter(row=>row[0]==='close').length,1);await f.service.dispose();
});
test('portable library-only edits preserve session; applied profile edits stop native effects without closing user work',async()=>{
 const f=fixture();await f.service.start({url:'https://native.example.test/',expectedRevision:7});const before=f.calls.filter(row=>row[0]==='detach').length;
 const library={...structuredClone(f.state.configuration),fingerprintProfiles:[{ignored:'metadata'}]};await f.api.storage.onChanged.emit({'api-configuration:v1':{newValue:{revision:8,configuration:library}}},'local');assert.equal(f.calls.filter(row=>row[0]==='detach').length,before);
 const changed=structuredClone(f.state.configuration);changed.antidetectEnabled=false;await f.api.storage.onChanged.emit({'api-configuration:v1':{newValue:{revision:9,configuration:changed}}},'local');await turn();assert.equal(f.context().isCurrent(),false);assert.equal(f.calls.some(row=>row[0]==='close'),false);assert.equal(f.service.snapshot().status,'stopped');await f.service.stop();await f.service.dispose();
});
test('native removal and external-origin navigation invalidate only the owned target',async()=>{
 const f=fixture();await f.service.start({url:'https://native.example.test/',expectedRevision:7});await f.api.webNavigation.onBeforeNavigate.emit({tabId:999,frameId:0,url:'https://other.example.test/'});assert.equal(f.context().isCurrent(),true);
 await f.api.webNavigation.onBeforeNavigate.emit({tabId:41,frameId:0,url:'https://other.example.test/'});await turn();assert.equal(f.context().isCurrent(),false);assert.equal(f.service.snapshot().error,'scope-denied');await f.service.stop();await f.service.dispose();
});
test('port routing rejects webpage/iframe clients and does not replay a duplicate Start request',async()=>{
 const f=fixture();let rejected=false;await f.api.runtime.onConnect.emit({name:FINGERPRINT_ENGINE_PORT,sender:{...f.sender,url:'https://native.example.test/'},disconnect(){rejected=true;}});assert.equal(rejected,true);
 const messages=[],port={name:FINGERPRINT_ENGINE_PORT,sender:f.sender,onMessage:event(),onDisconnect:event(),postMessage:value=>messages.push(value),disconnect(){}};await f.api.runtime.onConnect.emit(port);
 const request={v:1,id:'run',op:'start',payload:{url:'https://native.example.test/',expectedRevision:7}};await port.onMessage.emit(request);await port.onMessage.emit(request);assert.equal(f.calls.filter(row=>row[0]==='create').length,1);assert.ok(messages.some(row=>row.id==='run'&&row.ok===true));assert.ok(messages.some(row=>row.id==='run'&&row.error==='invalid-input'));await f.service.stop();await f.service.dispose();
});

test('driver unavailable result never navigates and closes only the created blank window',async()=>{const f=fixture({driverResult:{status:'unavailable',attached:false,error:'attach-failed'}});await assert.rejects(f.service.start({url:'https://native.example.test/',expectedRevision:7}),/native-error/);assert.equal(f.calls.some(row=>row[0]==='navigate'),false);assert.deepEqual(f.calls.filter(row=>row[0]==='close'),[['close',40]]);await f.service.dispose();});
test('failed owned-window closure stays visible and can be retried; a native stop never claims closed early',async()=>{const f=fixture();await f.service.start({url:'https://native.example.test/',expectedRevision:7});let attempts=0;f.api.windows.remove=async()=>{if(++attempts===1)throw Error('synthetic temporary native failure');};await f.service.stop();assert.equal(f.service.snapshot().sessionOpen,true);assert.equal(f.service.snapshot().status,'error');await assert.rejects(f.service.start({url:'https://native.example.test/',expectedRevision:7}),/busy/);await f.service.stop();assert.equal(attempts,2);assert.equal(f.service.snapshot().sessionOpen,false);await f.service.dispose();});
test('scope revocation invalidates a running session on native local-storage changes without closing existing work',async()=>{const f=fixture();await f.service.start({url:'https://native.example.test/',expectedRevision:7});f.state.active=false;await f.api.storage.onChanged.emit({'data-consent':{newValue:false}},'local');await turn();assert.equal(f.context().isCurrent(),false);assert.equal(f.calls.some(row=>row[0]==='close'),false);assert.equal(f.service.snapshot().status,'stopped');await f.service.stop();await f.service.dispose();});
test('future workers re-read current profile/scope and cannot use approval retained across Stop',async()=>{
 let hooks;const options={capture:value=>{hooks=value;}},f=fixture(options);await f.service.start({url:'https://native.example.test/',expectedRevision:7});
 const target={tabId:41,type:'worker',url:'blob:https://native.example.test/opaque-local-id'};
 assert.equal(await hooks.allowTarget(target),true);f.state.matches=['https://other.example.test/*'];assert.equal(await hooks.allowTarget(target),false);f.state.matches=['https://*/*'];
 let release;options.read=()=>new Promise(done=>{release=done;});const pending=hooks.allowTarget(target);while(!release)await turn();await f.service.stop();release();assert.equal(await pending,false);await f.service.dispose();
});
test('runtime partial and failed physical detach are reported even when compiler/start succeeded',async()=>{
 const options={},f=fixture(options);await f.service.start({url:'https://native.example.test/',expectedRevision:7});
 options.nativeSnapshot={status:'partial',attached:true,workerCount:1,bootstrappedWorkers:0,unsupported:[]};assert.equal(f.service.snapshot().partial,true);
 await f.service.stop({close:false});assert.equal(f.service.snapshot().status,'error');assert.equal(f.service.snapshot().error,'native-error');assert.equal(f.service.snapshot().sessionOpen,true);
 options.nativeSnapshot={status:'idle',attached:false,workerCount:0,bootstrappedWorkers:0,unsupported:[]};await f.service.stop();assert.equal(f.service.snapshot().error,null);await f.service.dispose();
});
test('duplicate port IDs cannot decrement another command and bypass the four-operation cap',async()=>{
 const releases=[],options={driverStop:()=>new Promise(done=>releases.push(done))},f=fixture(options),messages=[];
 const port={name:FINGERPRINT_ENGINE_PORT,sender:f.sender,onMessage:event(),onDisconnect:event(),postMessage:value=>messages.push(value),disconnect(){}};await f.api.runtime.onConnect.emit(port);
 const command=id=>({v:1,id,op:'stop'}),jobs=['a','b','c'].map(id=>port.onMessage.emit(command(id)));while(releases.length<3)await turn();
 await port.onMessage.emit(command('a'));jobs.push(port.onMessage.emit(command('d')));while(releases.length<4)await turn();await port.onMessage.emit(command('e'));
 assert.equal(releases.length,4);assert.ok(messages.some(row=>row.id==='a'&&row.error==='invalid-input'));options.driverStop=null;for(const release of releases)release();await Promise.all(jobs);await f.service.dispose();
});
test('restored ownership is detached and blocks new Start until explicit Close; never reattaches',async()=>{
 const writes=[],f=fixture({checkpoint:{async restore(){return{id:70,tabs:[{id:71}]};},async save(){writes.push('save');},async clear(){writes.push('clear');}}});
 await assert.rejects(f.service.start({url:'https://native.example.test/',expectedRevision:7}),/busy/);assert.equal(f.service.snapshot().status,'detached');assert.equal(f.service.snapshot().sessionOpen,true);assert.equal(f.calls.length,0);
 await f.service.stop();assert.deepEqual(f.calls.filter(row=>row[0]==='close'),[['close',70]]);assert.deepEqual(writes,['clear']);assert.equal(f.service.snapshot().sessionOpen,false);await f.service.dispose();
});
test('failure to checkpoint newly owned window prevents debugger/navigation and closes that exact window',async()=>{
 const f=fixture({checkpoint:{async restore(){return null;},async save(){throw Error('session storage unavailable');},async clear(){}}});await assert.rejects(f.service.start({url:'https://native.example.test/',expectedRevision:7}),/native-error/);
 assert.equal(f.calls.some(row=>['attach','navigate'].includes(row[0])),false);assert.deepEqual(f.calls.filter(row=>row[0]==='close'),[['close',40]]);await f.service.dispose();
});
test('dispose removes privileged listeners even if the session journal is temporarily unreadable',async()=>{
 const f=fixture({checkpoint:{async restore(){throw Error('temporary storage error');},async save(){},async clear(){}}});await f.service.dispose();assert.equal(f.api.runtime.onConnect.size(),0);assert.equal(f.api.tabs.onRemoved.size(),0);assert.ok(f.calls.some(row=>row[0]==='dispose'));
});
test('a hung profile read has one shared physical request; repeated timeouts cannot pile up providers',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let release,calls=0;const options={read:()=>{calls++;return new Promise(done=>{release=done;});}},f=fixture(options);
 const first=assert.rejects(f.service.start({url:'https://native.example.test/',expectedRevision:7}),/timeout/);while(!release)await turn();t.mock.timers.tick(6000);await first;
 await assert.rejects(f.service.start({url:'https://native.example.test/',expectedRevision:7}),/timeout/);assert.equal(calls,1);assert.equal(f.calls.length,0);options.read=null;release();await turn();await f.service.start({url:'https://native.example.test/',expectedRevision:7});await f.service.stop();await f.service.dispose();
});
test('hung private preparation times out before any window and retains its physical fence after Stop',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let release;const options={prepare:()=>new Promise(done=>{release=done;})},f=fixture(options);
 const first=assert.rejects(f.service.start({url:'https://native.example.test/',expectedRevision:7}),/timeout/);while(!release)await turn();t.mock.timers.tick(6000);await first;await f.service.stop();
 await assert.rejects(f.service.start({url:'https://native.example.test/',expectedRevision:7}),/busy/);assert.equal(f.calls.some(row=>row[0]==='create'),false);release({opaque:true});await turn();options.prepare=null;await f.service.start({url:'https://native.example.test/',expectedRevision:7});await f.service.stop();await f.service.dispose();
});
test('owned-window Close has a logical deadline but retries never duplicate an unresolved native remove',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();await f.service.start({url:'https://native.example.test/',expectedRevision:7});let release,removes=0;f.api.windows.remove=()=>{removes++;return new Promise(done=>{release=done;});};
 const stopping=f.service.stop();while(!release)await turn();t.mock.timers.tick(6000);await stopping;assert.equal(f.service.snapshot().status,'error');assert.equal(f.service.snapshot().sessionOpen,true);
 await f.service.stop();assert.equal(removes,1);release();await turn();await f.service.stop();assert.equal(removes,1);assert.equal(f.service.snapshot().sessionOpen,false);await f.service.dispose();
});
test('a late-created window is owned immediately while its first native Close remains unresolved',async()=>{
 let create,remove;const f=fixture({creation:()=>new Promise(done=>{create=done;})});f.api.windows.remove=()=>new Promise(done=>{remove=done;});
 const starting=assert.rejects(f.service.start({url:'https://native.example.test/',expectedRevision:7}),/inactive/);while(!create)await turn();await f.service.stop({close:false});create({id:50,tabs:[{id:51,windowId:50}]});while(!remove)await turn();
 assert.equal(f.service.snapshot().sessionOpen,true);await assert.rejects(f.service.start({url:'https://native.example.test/',expectedRevision:7}),/busy/);assert.equal(f.calls.filter(row=>row[0]==='create').length,1);
 remove();await starting;await turn();assert.equal(f.service.snapshot().sessionOpen,false);await f.service.dispose();
});

// ADR-107: the session window is sized from the claim and never exceeds the work area of a maximized window.
import {claimedSessionWindow} from '../../apps/production-extension/fingerprint-engine-service.js';
const claimed=(configuration,rows)=>{let value=configuration;for(const[id,item]of rows){const changed=updateApiConfiguration(value,id,{mode:'custom',selected:{kind:'value',value:item}});assert.equal(changed.ok,true,id);value=changed.value;}return value;};
const created=f=>f.calls.find(row=>row[0]==='create')[1];
test('ADR-107 claimed window: screen-geometry outer size first, else the claimed available screen, else none',()=>{
 assert.equal(claimedSessionWindow(config()),null);
 assert.deepEqual(claimedSessionWindow(claimed(config(),[['screen-avail-width',1920],['screen-avail-height',1032]])),{width:1920,height:1032});
 assert.deepEqual(claimedSessionWindow(claimed(config(),[['screen-avail-width',1920],['screen-avail-height',1032],['screen-geometry',{outerWidth:1280,outerHeight:720}]])),{width:1280,height:720});
 assert.equal(claimedSessionWindow(claimed(config(),[['screen-avail-width',1920]])),null,'both sides are needed');
 for(const junk of [null,undefined,5,{},{apis:5}])assert.equal(claimedSessionWindow(junk),null);
});
test('ADR-107 session window: the claim clamped to the last focused maximized window, else the largest maximized one; unknown work area keeps Chrome default',async()=>{
 const run=async(rows,windows)=>{const f=fixture();f.state.configuration=claimed(f.state.configuration,rows);Object.assign(f.api.windows,windows);await f.service.start({url:'https://native.example.test/',expectedRevision:7});const data=created(f);await f.service.stop();await f.service.dispose();return data;};
 const avail=[['screen-avail-width',1920],['screen-avail-height',1032]];
 let data=await run(avail,{async getLastFocused(){return{state:'maximized',width:1536,height:816};}});
 assert.equal(data.url,'about:blank');assert.equal(data.width,1536);assert.equal(data.height,816);
 data=await run(avail,{async getLastFocused(){return{state:'maximized',width:2560,height:1392};}});assert.deepEqual([data.width,data.height],[1920,1032],'a claim that fits keeps its size');
 data=await run([...avail,['screen-geometry',{outerWidth:1280,outerHeight:720}]],{async getLastFocused(){return{state:'maximized',width:2560,height:1392};}});assert.deepEqual([data.width,data.height],[1280,720]);
 data=await run(avail,{async getLastFocused(){return{state:'normal',width:800,height:600};},async getAll(){return[{state:'normal',width:3000,height:2000},{state:'maximized',width:1600,height:860},{state:'maximized',width:1700,height:900}];}});
 assert.deepEqual([data.width,data.height],[1700,900],'the largest maximized window bounds the claim');
 for(const windows of [{},{async getLastFocused(){return{state:'normal',width:800,height:600};}},{async getLastFocused(){throw new Error('denied');}},{async getAll(){return[{state:'minimized',width:10,height:10}];}},{async getLastFocused(){return{state:'maximized',width:-1,height:'x'};}}]){
  data=await run(avail,windows);assert.equal(Object.hasOwn(data,'width')||Object.hasOwn(data,'height'),false,'no sizing without a known work area');
 }
 data=await run([],{async getLastFocused(){return{state:'maximized',width:1536,height:816};}});assert.equal(Object.hasOwn(data,'width'),false,'no claim, no sizing');
});
