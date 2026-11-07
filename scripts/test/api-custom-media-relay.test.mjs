import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../apps/production-extension/api-custom-media-relay.js',import.meta.url),'utf8');
const instrumented=source.replace('  installMediaCapabilitiesRelay(globalThis,','  globalThis.guard = installMediaCapabilitiesRelay(globalThis,');
assert.notEqual(source,instrumented);
const channel='detect-expert-media-v1:000',origin='https://owned.example';
const request=(id='one',argument={type:'file',video:{contentType:'video/webm; codecs="vp8"',width:16,height:16,bitrate:10000,framerate:30}})=>({channel,kind:'request',id,method:'decodingInfo',argument});
const reply=id=>JSON.stringify({channel,kind:'result',id,status:'fulfilled',fields:['powerEfficient','smooth','supported','keySystemAccess']});
const flush=async()=>{for(let index=0;index<5;index++)await Promise.resolve();};
function fixture(behavior=message=>Promise.resolve(reply(JSON.parse(message.payload.serialized).id)),adapter=false,locationOrigin=origin){
 const listeners=new Set(),timers=new Map(),sent=[],posted=[];let timerId=0;
 const context=vm.createContext({location:{origin:locationOrigin},origin,browser:{runtime:{sendMessage(message){sent.push(message);return behavior(message);}}},postMessage(value){posted.push(value);},addEventListener(type,listener){if(type==='message')listeners.add(listener);},removeEventListener(type,listener){listeners.delete(listener);},setTimeout(callback,delay){const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout(id){timers.delete(id);}});
 if(adapter){context.suppliedAdapter={runtime:{sendMessage(message){sent.push(message);return behavior(message);}}};context.browser.runtime.sendMessage=()=>{throw Error('raw browser API bypassed the document adapter');};vm.runInContext('const chrome=suppliedAdapter;',context);}
 vm.runInContext('globalThis.clock=0;Date.now=()=>clock;',context);vm.runInContext(instrumented,context);const global=vm.runInContext('globalThis',context);
 return{context,global,sent,posted,timers,run:code=>vm.runInContext(code,context),emit(value,fields={}){for(const listener of listeners)listener({source:global,origin,data:typeof value==='string'?value:JSON.stringify(value),...fields});},tick(time=5000){context.clock=time;for(const[id,timer]of [...timers]){timers.delete(id);timer.callback();}},stop(){context.guard.stop();}};
}
test('packaged relay sends only exact bounded canonical outer payload and posts projected string reply',async()=>{
 const f=fixture();f.emit(request());await flush();assert.equal(f.sent.length,1);assert.deepEqual(Object.keys(f.sent[0]),['schemaVersion','type','payload']);assert.equal(f.sent[0].schemaVersion,1);assert.equal(f.sent[0].type,'api-custom-media-request');assert.deepEqual(Object.keys(f.sent[0].payload),['serialized']);assert.deepEqual(JSON.parse(f.sent[0].payload.serialized),request());
 assert.equal(f.posted[0],reply('one'));assert.equal(f.context.guard.snapshot().pending,0);
});
test('relay answers in about:blank/srcdoc frames and blank popups where location.origin is "null" but window.origin is the real origin',async()=>{
 const f=fixture(undefined,false,'null');f.emit(request('blank'),{source:{parent:true}});await flush();assert.equal(f.sent.length,1);assert.equal(f.posted[0],reply('blank'));
 f.emit(request('cross'),{source:{cross:true},origin:'null'});await flush();assert.equal(f.sent.length,1,'a "null" opaque origin is still dropped');
});
test('relay prefers the lexically injected document adapter over raw globalThis.browser',async()=>{
 const f=fixture(undefined,true);assert.equal(f.run('globalThis.chrome===undefined&&typeof chrome==="object"'),true);f.emit(request());await flush();assert.equal(f.sent.length,1);assert.equal(f.posted[0],reply('one'));
});
test('relay accepts self and same-origin parent sources but drops null and cross-origin sources',async()=>{
 const f=fixture();f.emit(request('parent'),{source:{parent:true}});f.emit(request('null'),{source:null});f.emit(request('cross'),{source:{cross:true},origin:'https://foreign.example'});await flush();assert.equal(f.sent.length,1);assert.equal(JSON.parse(f.sent[0].payload.serialized).id,'parent');
});
for(const[name,mutate]of[
 ['extra top-level profile',value=>{value.profile={supported:true};}],
 ['extra canonical key',value=>{value.argument.extra='not allowed';}],
 ['nested prototype key',value=>{Object.defineProperty(value.argument.video,'__proto__',{value:{},enumerable:true});}],
 ['arbitrary method',value=>{value.method='requestMediaKeySystemAccess';}],
 ['bad channel',value=>{value.channel='page-controlled';}],
 ['noncanonical nested value',value=>{value.argument.video.width={value:16};}],
 ['array root',value=>{value.argument=[];}]
])test('relay drops '+name+' before runtime',async()=>{
 const f=fixture(),value=request();mutate(value);f.emit(value);await flush();assert.equal(f.sent.length,0);assert.equal(f.posted.length,0);
});
test('relay measures UTF-8 bytes and never inspects nonstring page payload objects',async()=>{
 const f=fixture();f.emit(request('wide',{type:'file',video:{contentType:'漢'.repeat(6000),width:1,height:1,bitrate:1,framerate:1}}));let reads=0;f.emit('',{data:new Proxy({},{get(){reads++;throw Error('page object');}})});await flush();assert.equal(f.sent.length,0);assert.equal(reads,0);
});
test('relay caps 64 inflight, returns deadlines and ignores late replies after a reused slot',async()=>{
 const resolvers=[],f=fixture(message=>new Promise(resolve=>resolvers.push({resolve,id:JSON.parse(message.payload.serialized).id})));
 for(let index=0;index<65;index++)f.emit(request(String(index)));assert.equal(f.sent.length,64);assert.equal(f.context.guard.snapshot().pending,64);assert.equal(JSON.parse(f.posted[0]).error,'QuotaExceededError');
 f.tick();assert.equal(f.context.guard.snapshot().pending,0);assert.equal(f.posted.filter(value=>JSON.parse(value).error==='TimeoutError').length,64);
 f.emit(request('new'));assert.equal(f.sent.length,65);resolvers[0].resolve(reply('0'));await flush();assert.equal(f.context.guard.snapshot().pending,1);assert.equal(f.posted.some(value=>JSON.parse(value).status==='fulfilled'),false);
 resolvers[64].resolve(reply('new'));await flush();assert.equal(f.context.guard.snapshot().pending,0);assert.equal(f.posted.at(-1),reply('new'));
});
test('relay also caps completed requests to 64 per second and resets the bounded rate window',async()=>{
 const f=fixture();for(let index=0;index<65;index++){f.emit(request(String(index)));await flush();}assert.equal(f.sent.length,64);assert.equal(JSON.parse(f.posted.at(-1)).error,'QuotaExceededError');f.context.clock=1000;f.emit(request('after-window'));await flush();assert.equal(f.sent.length,65);
});
for(const response of[
 JSON.stringify({channel,kind:'result',id:'one',status:'fulfilled',fields:['supported','smooth','powerEfficient'],nativeFlags:{supported:true}}),
 JSON.stringify({channel,kind:'result',id:'one',status:'fulfilled',fields:['supported','smooth','secret']}),
 JSON.stringify({channel,kind:'result',id:'one',status:'rejected',error:'arbitrary'}),
 reply('different-id'),null
])test('relay refuses forged or malformed backend reply '+String(response).slice(-30),async()=>{
 const f=fixture(()=>Promise.resolve(response));f.emit(request());await flush();assert.equal(JSON.parse(f.posted[0]).error,'NotSupportedError');assert.equal(f.context.guard.snapshot().pending,0);
});
test('relay Stop removes future routing while a started projected reply can finish',async()=>{
 let resolve;const f=fixture(()=>new Promise(accept=>{resolve=accept;}));f.emit(request());f.stop();f.emit(request('after'));assert.equal(f.sent.length,1);resolve(reply('one'));await flush();assert.equal(f.posted[0],reply('one'));assert.equal(f.context.guard.snapshot().stopped,true);
});
