import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createPrivateMediaCapabilitiesBackend} from '../../apps/production-extension/api-custom-media-private-runtime.js';
const channel='detect-expert-media-v1:000',profile={supported:false,smooth:false,powerEfficient:false};
const request=(id='one',argument={type:'file',video:{contentType:'video/webm; codecs="vp8"',width:16,height:16,bitrate:10000,framerate:30}})=>JSON.stringify({channel,kind:'request',id,method:'decodingInfo',argument});
const flush=async()=>{for(let index=0;index<5;index++)await Promise.resolve();};
function fixture(mode='ordinary'){
 const timers=new Map();let timer=0;
 const context=vm.createContext({setTimeout(callback,delay){const id=++timer;timers.set(id,{callback,delay});return id;},clearTimeout(id){timers.delete(id);}});
 vm.runInContext(`globalThis.make=(${createPrivateMediaCapabilitiesBackend.toString()});globalThis.nativeCalls=0;globalThis.resolvers=[];globalThis.mode=${JSON.stringify(mode)};
 globalThis.nativeResult={powerEfficient:true,smooth:true,supported:true,keySystemAccess:{nativeOpaque:true},configuration:{nativeOnly:true}};
 globalThis.receiver={decodingInfo(argument){nativeCalls++;globalThis.nativeArgument=argument;if(this!==receiver)throw Error('native receiver');
 if(mode==='pending')return new Promise((resolve,reject)=>Object.defineProperty(resolvers,resolvers.length,{value:{resolve,reject},enumerable:true,configurable:true}));
 if(mode==='rejected')return Promise.reject(new TypeError('private native diagnostics'));
 if(mode==='frozen')return Object.freeze(Promise.resolve(nativeResult));
 return Promise.resolve(nativeResult);},encodingInfo(argument){return this.decodingInfo(argument);}};
 globalThis.navigator={mediaCapabilities:receiver};globalThis.backend=make(globalThis);`,context);
 return{context,run:code=>vm.runInContext(code,context),backend:context.backend,timers,tick(){for(const[id,item]of [...timers]){timers.delete(id);item.callback();}}};
}
test('private backend runs native once on its captured receiver and emits only projected field names',async()=>{
 const f=fixture();const result=JSON.parse(await f.backend.run(request(),profile,channel));
 assert.deepEqual(result,{channel,kind:'result',id:'one',status:'fulfilled',fields:['powerEfficient','smooth','supported','keySystemAccess','configuration']});assert.equal(f.context.nativeCalls,1);assert.equal(JSON.stringify(result).includes('nativeOnly'),false);assert.equal(JSON.stringify(result).includes('nativeOpaque'),false);assert.equal(f.backend.snapshot().physical,0);
});
test('private projector never evaluates native value getters or sends native rejection messages',async()=>{
 const f=fixture();f.run(`for(const key of ['supported','smooth','powerEfficient','configuration','keySystemAccess'])Object.defineProperty(nativeResult,key,{configurable:true,get(){throw Error('native value read');}});`);
 assert.equal(JSON.parse(await f.backend.run(request(),profile,channel)).status,'fulfilled');
 const g=fixture('rejected'),encoded=await g.backend.run(request(),profile,channel);assert.equal(JSON.parse(encoded).error,'TypeError');assert.equal(encoded.includes('private native diagnostics'),false);assert.equal(g.backend.snapshot().physical,0);
});
for(const[name,mutate]of[
 ['caller profile',value=>{value.profile={supported:true};}],['unknown method',value=>{value.method='getUserMedia';}],['extra config',value=>{value.argument.extra=true;}],['wrong channel',value=>{value.channel='detect-expert-media-v1:111';}],['unknown nested config',value=>{value.argument.video.extra={};}],['wrong primitive',value=>{value.argument.video.width='16';}]
])test('private backend drops '+name+' without native work',async()=>{const f=fixture(),value=JSON.parse(request());mutate(value);assert.equal(await f.backend.run(JSON.stringify(value),profile,channel),null);assert.equal(f.context.nativeCalls,0);});
test('private backend caps actual physical operations across logical deadlines and opens only settled slots',async()=>{
 const f=fixture('pending'),promises=[];for(let index=0;index<64;index++)promises.push(f.backend.run(request(String(index)),profile,channel));assert.equal(f.context.nativeCalls,64);assert.equal(f.backend.snapshot().physical,64);
 f.tick();for(const result of await Promise.all(promises))assert.equal(JSON.parse(result).error,'TimeoutError');assert.equal(f.backend.snapshot().pending,0);assert.equal(f.backend.snapshot().physical,64);
 assert.equal(JSON.parse(await f.backend.run(request('blocked'),profile,channel)).error,'QuotaExceededError');assert.equal(f.context.nativeCalls,64);
 f.run('resolvers[0].resolve(nativeResult)');await flush();assert.equal(f.backend.snapshot().physical,63);const next=f.backend.run(request('new'),profile,channel);assert.equal(f.context.nativeCalls,65);assert.equal(f.backend.snapshot().physical,64);
 f.run('resolvers[64].resolve(nativeResult)');assert.equal(JSON.parse(await next).id,'new');assert.equal(f.backend.snapshot().physical,63);assert.equal(f.backend.snapshot().completed,65);
 f.run('for(let index=1;index<64;index++)resolvers[index].resolve(nativeResult)');await flush();assert.equal(f.backend.snapshot().physical,0);
});
test('a native source that cannot be observed retains its physical fence instead of admitting repeated work',async()=>{
 const f=fixture('frozen');assert.equal(JSON.parse(await f.backend.run(request(),profile,channel)).error,'TypeError');assert.equal(f.backend.snapshot().pending,0);assert.equal(f.backend.snapshot().physical,1);
});
test('DRM false uses one no-DRM codec validation and never passes the key system or an opaque handle',async()=>{
 const f=fixture(),argument=JSON.parse(request()).argument;argument.keySystemConfiguration={keySystem:'owned.test',sessionTypes:['temporary'],video:{robustness:''}};
 const result=JSON.parse(await f.backend.run(request('drm',argument),profile,channel));assert.equal(result.status,'fulfilled');assert.equal(f.context.nativeCalls,1);assert.equal(f.run('Object.hasOwn(nativeArgument,"keySystemConfiguration")'),false);
 const g=fixture();assert.equal(JSON.parse(await g.backend.run(request('drm',argument),{supported:true,smooth:true,powerEfficient:true},channel)).error,'NotSupportedError');assert.equal(g.context.nativeCalls,0);
});
test('DRM combinations rejected by native semantic validation are not silently stripped',async()=>{
 for(const key of [{keySystem:''},{keySystem:'owned',audio:{robustness:''}}]){const f=fixture(),argument=JSON.parse(request()).argument;argument.keySystemConfiguration=key;assert.equal(JSON.parse(await f.backend.run(request('bad',argument),profile,channel)).error,'TypeError');assert.equal(f.context.nativeCalls,0);}
});
test('private backend Stop prevents new work while started native work can finish',async()=>{
 const f=fixture('pending'),started=f.backend.run(request(),profile,channel);f.backend.stop();assert.equal(JSON.parse(await f.backend.run(request('after'),profile,channel)).error,'AbortError');assert.equal(f.context.nativeCalls,1);f.run('resolvers[0].resolve(nativeResult)');assert.equal(JSON.parse(await started).status,'fulfilled');assert.equal(f.backend.snapshot().physical,0);
});
test('missing native media APIs are not fabricated and UTF-8 limits apply before parsing/native work',async()=>{
 const f=fixture();f.run('delete navigator.mediaCapabilities;globalThis.absent=make(globalThis)');assert.equal(f.context.absent.snapshot().installed,0);assert.equal(JSON.parse(await f.context.absent.run(request(),profile,channel)).error,'NotSupportedError');
 const argument=JSON.parse(request()).argument;argument.video.contentType='漢'.repeat(6000);assert.equal(await f.backend.run(request('wide',argument),profile,channel),null);assert.equal(f.context.nativeCalls,0);
});
