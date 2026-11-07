// ADR-070: the native startup event must not race the first physical restore.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installProxyService } from '../../apps/production-extension/proxy-service.js';
import { createDefaultProxyConfiguration, PROXY_STORAGE_KEY } from '../../apps/production-extension/proxy-shared.js';
const event=()=>{const listeners=new Set();return{addListener(fn){listeners.add(fn);},removeListener(fn){listeners.delete(fn);},emit(value){for(const fn of listeners)fn(value);}};};
test('onStartup during pending initial policy restore cannot start a second transaction',async()=>{
 const config=createDefaultProxyConfiguration();Object.assign(config,{enabled:true,protectWebRTC:false,disablePrediction:false,selectedId:'direct'});config.profiles=[{id:'direct',name:'Owned',type:'socks5',host:'192.0.2.15',port:1080,native:false}];
 let release,started,sets=0,writes=0,setting={mode:'direct'};
 const blocked=new Promise(done=>{release=done;}),firstStarted=new Promise(done=>{started=done;});
 const api={runtime:{id:'owned',getURL:path=>'chrome-extension://owned/'+path,onConnect:event(),onStartup:event()},permissions:{contains:async()=>true,onRemoved:event()},storage:{local:{get:async key=>({[key]:key===PROXY_STORAGE_KEY?config:undefined}),set:async value=>{writes++;Object.assign(config,value[PROXY_STORAGE_KEY]);}}},proxy:{onProxyError:event(),settings:{onChange:event(),get:async()=>({levelOfControl:sets?'controlled_by_this_extension':'controllable_by_this_extension',value:setting}),set:async({value})=>{sets++;if(sets===1){started();await blocked;}setting=value;},clear:async()=>{setting={mode:'direct'};}}}};
 const service=installProxyService(api,{privacyOverlay:{setActive:async()=>({status:'inactive'})}});
 try{await firstStarted;api.runtime.onStartup.emit();await new Promise(done=>setImmediate(done));assert.equal(sets,1);assert.equal(writes,1);release();await service.ready;assert.equal(sets,2);assert.equal(writes,1);assert.equal(service.snapshot().status.state,'connected');}finally{release();service.dispose();}
});
