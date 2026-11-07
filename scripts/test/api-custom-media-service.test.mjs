import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaCapabilitiesRoute} from '../../apps/production-extension/api-custom-media-service.js';
import {mediaProfileChannel} from '../../apps/production-extension/api-custom-media-profile.js';
const selected={supported:true,smooth:true,powerEfficient:false};
const request={schemaVersion:1,type:'api-custom-media-request',payload:{serialized:JSON.stringify({channel:'detect-expert-media-v1:110',kind:'request',id:'1',method:'decodingInfo',argument:{type:'file'}})}};
function fixture(){
 const calls=[],context={tabId:1,frameId:0,documentId:'current',documentKey:'1:0:current',host:'example.test',originPattern:'https://example.test/*'};
 const state={grant:true,documentId:'current',result:'selected-result'};
 const controller={configuration:{},revision:3,readPageSender:sender=>sender?.trusted?{ok:true,context}:{ok:false},async permitted(){return state.grant;},async start(){}};
 const api={runtime:{id:'own'},webNavigation:{async getFrame(){return{documentId:state.documentId,documentLifecycle:'active'};}}};
 const backend={async run(...args){calls.push(args);return typeof state.result==='function'?state.result():state.result;}};
 const route=createMediaCapabilitiesRoute({api,controller,backend,entriesForHost:()=>state.off?[]:[{id:'media-capabilities',mode:'custom',selected:{kind:'value',value:selected}}]});
 return{route,controller,state,calls,context,api};
}
test('media route accepts only exact local request and native sender; no caller profile/tab authority',async()=>{
 const f=fixture();assert.equal(f.route({type:'other'},{}),null);
 for(const message of [{...request,profile:selected},{...request,payload:{...request.payload,tabId:9}},{...request,schemaVersion:2},{...request,payload:{serialized:'x'.repeat(16385)}}])assert.equal(await f.route(message,{trusted:true}),null);
 assert.equal(await f.route(request,{trusted:false}),null);assert.equal(f.calls.length,0);
 assert.equal(await f.route(request,{trusted:true}),'selected-result');assert.deepEqual(f.calls[0],[request.payload.serialized,selected,'detect-expert-media-v1:110']);
});
test('revoked scope, replaced document and disabled Custom never invoke private native backend',async()=>{
 for(const kind of ['grant','document','off']){const f=fixture();if(kind==='grant')f.state.grant=false;if(kind==='document')f.state.documentId='new';if(kind==='off')f.state.off=true;assert.equal(await f.route(request,{trusted:true}),null);assert.equal(f.calls.length,0);}
});
test('in-flight private answer cannot cross navigation, profile revision or permission fence',async()=>{
 for(const kind of ['grant','document','revision']){const f=fixture();let release;f.state.result=()=>new Promise(done=>{release=done;});const promise=f.route(request,{trusted:true});while(!release)await new Promise(done=>setImmediate(done));if(kind==='grant')f.state.grant=false;if(kind==='document')f.state.documentId='new';if(kind==='revision')f.controller.revision++;release('stale-answer');assert.equal(await promise,null);}
});
test('media requests obey a bounded per-document burst and never persist canonical codec arguments',async()=>{
 const f=fixture();for(let i=0;i<20;i++)assert.equal(await f.route(request,{trusted:true}),'selected-result');assert.equal(await f.route(request,{trusted:true}),null);assert.equal(f.calls.length,20);assert.deepEqual(Object.keys(f.controller).sort(),['configuration','permitted','readPageSender','revision','start']);
});
test('routing channel contains only selected flags and invalid profiles cannot select a backend',()=>{
 assert.equal(mediaProfileChannel(selected),'detect-expert-media-v1:110');assert.equal(mediaProfileChannel(null),null);assert.equal(mediaProfileChannel({supported:true,smooth:true}),null);
});
test('Firefox uses the existing bounded native-document resolver and never falls back after identity failure',async()=>{
 const f=fixture();let lookups=0;f.api.webNavigation.getFrame=async()=>{throw Error('unnormalized native Firefox frame');};
 f.api.__detectExpertResolveDocument=async value=>{lookups++;assert.deepEqual(value,{tabId:1,frameId:0,documentId:'current'});return{documentId:'current',documentLifecycle:'active'};};
 assert.equal(await f.route(request,{trusted:true}),'selected-result');assert.equal(lookups,2);
 f.api.__detectExpertResolveDocument=async()=>{throw Error('native document replaced');};assert.equal(await f.route(request,{trusted:true}),null);assert.equal(f.calls.length,1);
});
