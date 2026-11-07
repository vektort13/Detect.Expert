import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installMediaCapabilitiesBridge} from '../../apps/production-extension/api-custom-media-bridge.js';
import {createMediaCodecMatcher} from '../../apps/production-extension/api-custom-media-codecs.js';
const origin='https://owned.example',channel='detect-expert-media-v1:000';
const flush=async()=>{for(let index=0;index<5;index++)await Promise.resolve();};
// round 5: a configuration without a key system runs the page's own native call to completion and the answer is that native result lowered
// by the selected flags and the hidden codec families; a key-system configuration still stops at the final type conversion and uses the relay.
function fixture(selected={supported:false,smooth:false,powerEfficient:false},label=channel,withCodecs=false){
 const listeners=new Set(),timers=new Map(),posted=[];let next=0;
 const context=vm.createContext({DOMException,origin,location:{origin},setTimeout(fn,delay){const id=++next;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},postMessage(value){posted.push(value);},addEventListener(type,fn){if(type==='message')listeners.add(fn);},removeEventListener(type,fn){listeners.delete(fn);}});
 // Bounded host-interface model: the native conversion owns Get/coercion; the final type hook stops it with a marker only for a key system.
 vm.runInContext(`globalThis.install=(${installMediaCapabilitiesBridge.toString()});globalThis.codecs=(${createMediaCodecMatcher.toString()})();const P=Promise,concat=String.prototype.concat;
 globalThis.nativeCalls=0;globalThis.mainBackendCalls=0;globalThis.nativeEnum=new TypeError('native enum');globalThis.nativeBrand=new TypeError('native brand');const branded=new WeakSet();
 globalThis.nativeAnswer={powerEfficient:true,smooth:true,supported:true,keySystemAccess:null};globalThis.nativeFailure=null;
 function text(value){return Reflect.apply(concat,'',[value]);}
 function convert(input){if(input===undefined||input===null)input={};if(typeof input!=='object'&&typeof input!=='function')throw new TypeError('native dictionary');
  const output={};for(const name of ['audio','video']){const value=input[name];if(value===undefined)continue;const target=output[name]={};if(value===null)throw new TypeError('native required field');
   const keys=name==='audio'?['bitrate','channels','contentType','samplerate','spatialRendering']:['bitrate','colorGamut','contentType','framerate','hdrMetadataType','height','scalabilityMode','spatialScalability','transferFunction','width'];
   for(const key of keys){const item=value[key];if(item===undefined){if(['contentType',...(name==='video'?['bitrate','framerate','height','width']:[])].includes(key))throw new TypeError('native required field');continue;}
    target[key]=['width','height','bitrate','samplerate','framerate'].includes(key)?+item:key==='spatialScalability'||key==='spatialRendering'?!!item:text(item);
    if(key==='framerate'&&!Number.isFinite(target[key]))throw new TypeError('native finite double');}}
  const key=input.keySystemConfiguration;if(key!==undefined)output.keySystemConfiguration={keySystem:text(key.keySystem)};
  const type=input.type;if(type===undefined)throw new TypeError('native required type');output.type=text(type);if(!['file','media-source','webrtc'].includes(output.type))throw nativeEnum;return output;}
 globalThis.MediaCapabilities=class MediaCapabilities{constructor(){branded.add(this);}decodingInfo(input){nativeCalls++;if(!branded.has(this))return P.reject(nativeBrand);try{globalThis.converted=convert(input);mainBackendCalls++;if(nativeFailure)throw nativeFailure.reason;return P.resolve(nativeAnswer);}catch(error){return P.reject(error);}}encodingInfo(input){return this.decodingInfo(input);}};
 globalThis.receiver=new MediaCapabilities();globalThis.original=MediaCapabilities.prototype.decodingInfo;
 globalThis.guard=install(globalThis,${JSON.stringify(selected)},{channel:${JSON.stringify(label)},bitrateBits:32}${withCodecs?',codecs':''});
 globalThis.config=()=>({type:'file',video:{contentType:'video/webm; codecs="vp8"',width:16,height:16,bitrate:10000,framerate:30}});
 globalThis.drmConfig=()=>Object.assign(config(),{keySystemConfiguration:{keySystem:'owned.test'}});`,context);
 const global=vm.runInContext('globalThis',context);
 return{context,global,posted,timers,run:code=>vm.runInContext(code,context),emit(value){for(const listener of listeners)listener({origin,source:global,data:typeof value==='string'?value:JSON.stringify(value)});},reply(request,extra={}){const parsed=typeof request==='string'?JSON.parse(request):request;this.emit({channel:label,kind:'result',id:parsed.id,status:'fulfilled',fields:['powerEfficient','smooth','supported','keySystemAccess','configuration'],...extra});},tick(){for(const[id,callback]of [...timers]){timers.delete(id);callback();}}};
}
const triple=value=>[value.supported,value.smooth,value.powerEfficient];
const PRESETS=[[false,false,false],[true,false,false],[true,true,false],[true,false,true],[true,true,true]];
const profileOf=(flags,hidden=[])=>({supported:flags[0],smooth:flags[1],powerEfficient:flags[2],hidden});
const labelOf=flags=>'detect-expert-media-v1:'+flags.map(flag=>flag?'1':'0').join('');

// ---- configurations without a key system: the page's own native call, lowered ----
test('native path: the page native call runs to completion, nothing is relayed, and the result is the native one lowered by the profile',async()=>{
 const f=fixture(profileOf([true,true,false]),labelOf([true,true,false])),value=await f.run('receiver.decodingInfo(config())');
 assert.equal(f.context.nativeCalls,1);assert.equal(f.context.mainBackendCalls,1);assert.equal(f.posted.length,0);assert.equal(f.timers.size,0);
 assert.deepEqual(Object.keys(value),['powerEfficient','smooth','supported','keySystemAccess']);
 assert.deepEqual([...triple(value),value.keySystemAccess],[true,true,false,null]);
 assert.equal(Object.getPrototypeOf(value),f.run('Object.prototype'));assert.equal(f.context.guard.snapshot().pending,0);
});
test('native path flag algebra: native AND selected, smooth and power efficiency also need support, nothing is raised',async()=>{
 const natives=[[false,false,false],[true,false,false],[true,true,false],[true,false,true],[true,true,true]];let rows=0;
 for(const nativeFlags of natives)for(const flags of PRESETS){
  const f=fixture(profileOf(flags),labelOf(flags));f.run(`nativeAnswer={powerEfficient:${nativeFlags[2]},smooth:${nativeFlags[1]},supported:${nativeFlags[0]},keySystemAccess:null}`);
  const value=await f.run('receiver.decodingInfo(config())'),shown=flags[0]&&nativeFlags[0];
  assert.deepEqual(triple(value),[shown,shown&&flags[1]&&nativeFlags[1],shown&&flags[2]&&nativeFlags[2]],JSON.stringify({nativeFlags,flags}));rows++;
 }
 assert.equal(rows,25);
 const f=fixture(profileOf([true,true,true]),labelOf([true,true,true]));f.run('nativeAnswer={powerEfficient:true,smooth:true,supported:false,keySystemAccess:null}');
 assert.deepEqual(triple(await f.run('receiver.decodingInfo(config())')),[false,false,false],'smooth and power efficiency need the supported flag, even for an odd native answer');
 f.run('nativeAnswer={powerEfficient:1,smooth:"yes",supported:null,keySystemAccess:null}');
 assert.deepEqual(triple(await f.run('receiver.decodingInfo(config())')),[false,false,false],'a non-boolean native flag is never raised to true');
});
test('native path keeps every other own data field of the native result: order, identities, symbols; skips accessors and __proto__',async()=>{
 const f=fixture(profileOf([true,false,false]),labelOf([true,false,false]));
 f.run(`globalThis.handle={native:'handle'};globalThis.echo={type:'file'};globalThis.mark=Symbol('native');
  nativeAnswer={configuration:echo,supported:true,keySystemAccess:handle,smooth:true,powerEfficient:true,futureHint:{future:true}};
  Object.defineProperty(nativeAnswer,mark,{value:handle,enumerable:true});Object.defineProperty(nativeAnswer,'trap',{enumerable:true,get(){throw Error('native accessor read');}});Object.defineProperty(nativeAnswer,'__proto__',{value:{polluted:true},enumerable:true});`);
 const value=await f.run('receiver.decodingInfo(config())');
 assert.deepEqual(Reflect.ownKeys(value),['configuration','supported','keySystemAccess','smooth','powerEfficient','futureHint',f.run('mark')]);
 assert.deepEqual(triple(value),[true,false,false]);assert.equal(value.configuration,f.run('echo'));assert.equal(value.keySystemAccess,f.run('handle'));assert.equal(value[f.run('mark')],f.run('handle'));
 assert.equal(Object.hasOwn(value,'trap'),false);assert.equal(Object.hasOwn(value,'__proto__'),false);assert.equal(value.polluted,undefined);
 assert.equal(f.run('nativeAnswer.supported'),true,'the native object itself is untouched');
});
test('native path: hidden codec families come from the strings the native conversion saw, once',async()=>{
 const all=profileOf([true,true,true],['h264','aac']);
 const run=async(config,flags=all)=>{const f=fixture(flags,labelOf([flags.supported,flags.smooth,flags.powerEfficient]),true);return triple(await f.run(`receiver.decodingInfo(${config})`));};
 const video=type=>`Object.assign(config(),{video:{contentType:${JSON.stringify(type)},width:16,height:16,bitrate:1,framerate:30}})`;
 assert.deepEqual(await run(video('video/mp4; codecs="avc1.42E01E"')),[false,false,false]);
 assert.deepEqual(await run(video('video/webm; codecs="vp8"')),[true,true,true],'a non-hidden codec equals native AND custom');
 assert.deepEqual(await run(video('video/mp4')),[true,true,true],'a container-only type is never hidden');
 assert.deepEqual(await run(`Object.assign(config(),{audio:{contentType:'audio/mp4; codecs="mp4a.40.2"'}})`),[false,false,false],'the audio track names a hidden family');
 assert.deepEqual(await run(`Object.assign(config(),{type:'webrtc',video:{contentType:'video/H264',width:16,height:16,bitrate:1,framerate:30}})`),[false,false,false],'a WebRTC subtype names its codec');
 assert.deepEqual(await run(`Object.assign(config(),{type:'webrtc',video:{contentType:'video/VP8',width:16,height:16,bitrate:1,framerate:30}})`),[true,true,true]);
 assert.deepEqual(await run(video('video/mp4; codecs="avc1.42E01E"'),profileOf([true,true,true])),[true,true,true],'a profile without hidden families hides nothing');
 // The string is the one the native conversion converted: the page getter and its coercion each run once, in the native order.
 const f=fixture(all,labelOf([true,true,true]),true);
 const value=await f.run(`globalThis.reads=[];let coercions=0;const input=config();const code={[Symbol.toPrimitive](hint){reads.push(['coercion',hint]);return coercions++===0?'video/mp4; codecs="avc1.42E01E"':'video/webm; codecs="vp8"';}};
  Object.defineProperty(input.video,'contentType',{get(){reads.push(['get']);return code;}});receiver.decodingInfo(input)`);
 assert.deepEqual(triple(value),[false,false,false]);assert.deepEqual(JSON.parse(f.run('JSON.stringify(reads)')),[['get'],['coercion','string']]);
 // supported:false hides everything in the answer; the native call still runs once.
 const none=fixture(profileOf([false,false,false]),labelOf([false,false,false]),true);
 assert.deepEqual(triple(await none.run('receiver.decodingInfo(config())')),[false,false,false]);assert.equal(none.context.nativeCalls,1);
});
test('native path: the native Promise is never handed out, a native rejection keeps its identity, and no timer or pending slot is used',async()=>{
 const f=fixture(profileOf([true,true,true]),labelOf([true,true,true]));
 const promise=f.run('receiver.decodingInfo(config())');
 assert.equal(f.run('Promise.prototype')===Object.getPrototypeOf(promise),true);assert.notEqual(promise,f.run('nativeAnswer'));
 assert.equal(f.timers.size,0);assert.equal(f.context.guard.snapshot().pending,0);await promise;
 for(const reason of ['sentinel','null','undefined','0','false']){
  const g=fixture(profileOf([true,true,true]),labelOf([true,true,true]));
  const returned=g.run(`globalThis.sentinel=Error('native');receiver.decodingInfo({type:'file',get video(){throw ${reason};}})`);
  let observed='not rejected';try{await returned;}catch(error){observed=error;}
  assert.equal(observed,reason==='sentinel'?g.context.sentinel:reason==='null'?null:reason==='undefined'?undefined:reason==='0'?0:false);
 }
 // Many concurrent native-path calls are not capped or timed out by the relay limits.
 const many=fixture(profileOf([true,true,true]),labelOf([true,true,true])),calls=[];for(let index=0;index<150;index++)calls.push(many.run('receiver.decodingInfo(config())'));
 const values=await Promise.all(calls);assert.equal(values.length,150);assert.ok(values.every(value=>triple(value).every(Boolean)));assert.equal(many.context.nativeCalls,150);assert.equal(many.timers.size,0);
});
test('native path: a native rejection after a complete conversion keeps its identity, falsy reasons included, and relays nothing',async()=>{
 for(const reason of ['sentinel','null','undefined','0','false','""']){
  const f=fixture(profileOf([true,true,true]),labelOf([true,true,true]));
  f.run(`globalThis.sentinel=Error('native semantic');nativeFailure={reason:${reason}}`);
  let observed='not rejected';try{await f.run('receiver.decodingInfo(config())');}catch(error){observed=error;}
  assert.equal(observed,reason==='sentinel'?f.context.sentinel:reason==='null'?null:reason==='undefined'?undefined:reason==='0'?0:reason==='false'?false:'');
  assert.equal(f.posted.length,0);assert.equal(f.context.mainBackendCalls,1);assert.equal(f.timers.size,0);
 }
});
test('native path: the species constructor of the native Promise is never consulted and a page Promise getter cannot interfere',async()=>{
 const f=fixture(profileOf([true,true,true]),labelOf([true,true,true]));
 f.run(`globalThis.consulted=0;Object.defineProperty(Promise.prototype,'constructor',{configurable:true,get(){consulted++;return Promise;}});Object.defineProperty(Promise,Symbol.species,{configurable:true,get(){consulted++;return Promise;}});`);
 const pending=f.run('receiver.decodingInfo(config())');await flush();
 assert.equal(f.run('consulted'),0,'neither the native then nor the page result reads constructor or Symbol.species');
 assert.deepEqual(triple(await pending),[true,true,true]);
});
test('native path: an unknown configuration type is rejected by the native converter itself, with no relay or backend work',async()=>{
 for(const type of['nonsense','','FILE','record']){
  const f=fixture();const returned=f.run(`globalThis.input=config();input.type=${JSON.stringify(type)};receiver.decodingInfo(input)`);
  let observed='not rejected';try{await returned;}catch(error){observed=error;}
  assert.equal(observed,f.context.nativeEnum,'the page sees the native error object for type '+JSON.stringify(type));
  assert.equal(f.posted.length,0);assert.equal(f.context.mainBackendCalls,0);assert.equal(f.context.guard.snapshot().pending,0);
 }
});
test('native path: Stop restores the wrappers; a retained wrapper answers natively and an in-flight lowered answer still completes',async()=>{
 const f=fixture(profileOf([true,false,false]),labelOf([true,false,false])),inflight=f.run('globalThis.retained=receiver.decodingInfo;receiver.decodingInfo(config())');
 f.run('guard.stop()');assert.equal(f.run('MediaCapabilities.prototype.decodingInfo===original'),true);
 assert.deepEqual(triple(await inflight),[true,false,false]);
 assert.deepEqual(triple(await f.run('retained.call(receiver,config())')),[true,true,true],'a retained wrapper calls straight through after Stop');
});

// ---- configurations with a key system: the native call stops at the final type conversion, the private backend answers ----
test('key system: the native call stops at the final type conversion, never runs the native query, and the reply is the selected projection',async()=>{
 const f=fixture(),returned=f.run('receiver.decodingInfo(drmConfig())');await flush();assert.equal(f.context.nativeCalls,1);assert.equal(f.context.mainBackendCalls,0);assert.equal(f.posted.length,1);const frame=JSON.parse(f.posted[0]);assert.deepEqual(Object.keys(frame),['channel','kind','id','method','argument']);assert.deepEqual(frame.argument,{keySystemConfiguration:{keySystem:'owned.test'},video:{bitrate:10000,contentType:'video/webm; codecs="vp8"',framerate:30,height:16,width:16},type:'file'});
 f.reply(frame);const value=await returned;assert.equal(value.supported,false);assert.equal(value.keySystemAccess,null);assert.equal(value.configuration.video.width,16);assert.equal(f.context.guard.snapshot().pending,0);
});
test('MAIN recorder preserves original dictionary getter/coercion receivers and Boolean conversion without valueOf',async()=>{
 const f=fixture();const returned=f.run(`globalThis.events=[];globalThis.booleanCoercions=0;globalThis.input=drmConfig();globalThis.width={ [Symbol.toPrimitive](hint){events.push(['coercion',hint,this===width]);return 17.5;}};
 Object.defineProperty(input.video,'width',{get(){events.push(['width',this===input.video]);return width;}});input.video.spatialScalability={valueOf(){booleanCoercions++;throw Error('must not coerce Boolean object');}};
 Object.defineProperty(input,'type',{get(){events.push(['type',this===input]);return'file';}});receiver.decodingInfo(input)`);await flush();const frame=JSON.parse(f.posted[0]);assert.equal(frame.argument.video.width,17.5);assert.equal(frame.argument.video.spatialScalability,true);assert.equal(f.context.booleanCoercions,0);assert.deepEqual(JSON.parse(f.run('JSON.stringify(events)')),[['width',true],['coercion','number',true],['type',true]]);f.reply(frame);assert.equal((await returned).configuration.video.width,17);
});
test('the same recorder serves the native path: getter and coercion receivers, order and counts are the native ones',async()=>{
 const f=fixture(profileOf([true,true,true]),labelOf([true,true,true]));
 const value=await f.run(`globalThis.events=[];globalThis.booleanCoercions=0;globalThis.input=config();globalThis.width={ [Symbol.toPrimitive](hint){events.push(['coercion',hint,this===width]);return 17.5;}};
 Object.defineProperty(input.video,'width',{get(){events.push(['width',this===input.video]);return width;}});input.video.spatialScalability={valueOf(){booleanCoercions++;throw Error('must not coerce Boolean object');}};
 Object.defineProperty(input,'type',{get(){events.push(['type',this===input]);return'file';}});receiver.decodingInfo(input)`);
 assert.equal(f.context.booleanCoercions,0);assert.deepEqual(JSON.parse(f.run('JSON.stringify(events)')),[['width',true],['coercion','number',true],['type',true]]);assert.deepEqual(triple(value),[true,true,true]);assert.equal(f.posted.length,0);
});
for(const stage of ['audio','video','width','type'])test('MAIN preserves exact caller '+stage+' exception, including falsy reasons, with no relay/backend',async()=>{
 for(const reason of ['sentinel','null','undefined','0','false']){
  const f=fixture();const returned=f.run(`globalThis.sentinel=Error('caller');globalThis.input=config();Object.defineProperty(${stage==='width'?'input.video':'input'},${JSON.stringify(stage)},{get(){throw ${reason};}});receiver.decodingInfo(input)`);
  let observed='not rejected';try{await returned;}catch(error){observed=error;}assert.equal(observed,reason==='sentinel'?f.context.sentinel:reason==='null'?null:reason==='undefined'?undefined:reason==='0'?0:false);assert.equal(f.posted.length,0);assert.equal(f.context.mainBackendCalls,0);assert.equal(f.context.guard.snapshot().pending,0);
 }
});
test('MAIN native brand precedes argument access and wrapper is non-constructable',async()=>{
 const f=fixture();const returned=f.run(`globalThis.reads=0;Reflect.apply(receiver.decodingInfo,{},[{get video(){reads++;throw Error('unused');}}])`);await assert.rejects(returned,error=>error===f.context.nativeBrand);assert.equal(f.context.reads,0);assert.equal(f.posted.length,0);assert.throws(()=>f.run('new receiver.decodingInfo()'),error=>error.name==='TypeError');
});
test('MAIN ignores forged reply keys/IDs and keeps its trusted flags even when page forges a valid status',async()=>{
 const f=fixture(),result=f.run('receiver.decodingInfo(drmConfig())');await flush();const frame=JSON.parse(f.posted[0]);f.reply(frame,{extra:{supported:true}});assert.equal(f.context.guard.snapshot().pending,1);f.reply(frame,{id:'wrong'});assert.equal(f.context.guard.snapshot().pending,1);f.reply(frame);assert.equal((await result).supported,false);
});
test('MAIN pending cap/deadline ignores stale responses and Stop keeps started selected replies',async()=>{
 const f=fixture(),promises=[];for(let index=0;index<64;index++)promises.push(f.run('receiver.decodingInfo(drmConfig())'));await flush();await assert.rejects(f.run('receiver.decodingInfo(drmConfig())'),error=>error.name==='QuotaExceededError');assert.equal(f.context.nativeCalls,64);f.tick();await Promise.all(promises.map(value=>assert.rejects(value,error=>error.name==='TimeoutError')));assert.equal(f.context.guard.snapshot().pending,0);
 const next=f.run('globalThis.retained=receiver.decodingInfo;receiver.decodingInfo(drmConfig())');await flush();f.reply(f.posted[0]);assert.equal(f.context.guard.snapshot().pending,1);f.run('guard.stop()');f.reply(f.posted.at(-1));assert.equal((await next).supported,false);assert.equal(f.context.guard.snapshot().pending,0);await f.run('retained.call(receiver,config())');assert.equal(f.context.mainBackendCalls,1);
});
test('MAIN enforces the UTF-8 argument bound on the relay; the native path has no such bound',async()=>{
 const f=fixture();await assert.rejects(f.run(`globalThis.input=drmConfig();input.video.contentType='漢'.repeat(6000);receiver.decodingInfo(input)`),error=>error.name==='QuotaExceededError');assert.equal(f.posted.length,0);assert.equal(f.context.mainBackendCalls,0);
 const g=fixture(profileOf([true,true,true]),labelOf([true,true,true]));assert.deepEqual(triple(await g.run(`globalThis.input=config();input.video.contentType='漢'.repeat(6000);receiver.decodingInfo(input)`)),[true,true,true]);assert.equal(g.posted.length,0);
 f.run(`globalThis.replacement=function(){};MediaCapabilities.prototype.decodingInfo=replacement;guard.stop();`);assert.equal(f.run('MediaCapabilities.prototype.decodingInfo===replacement'),true);
});
test('key system: replies need exactly five keys and the selected flags are the only flags the page ever receives',async()=>{
 const f=fixture({supported:false,smooth:false,powerEfficient:false}),result=f.run('receiver.decodingInfo(drmConfig())');await flush();const frame=JSON.parse(f.posted[0]);
 f.reply(frame,{flags:[true,true,true]});assert.equal(f.context.guard.snapshot().pending,1,'a six-key reply is not a reply');
 f.emit({channel,kind:'result',id:frame.id,status:'rejected',error:'TypeError',flags:[true,true,true]});assert.equal(f.context.guard.snapshot().pending,1);
 f.reply(frame);const value=await result;assert.deepEqual(triple(value),[false,false,false]);
});
