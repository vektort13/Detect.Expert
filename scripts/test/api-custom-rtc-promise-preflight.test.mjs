import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {installWebRtcCustom} from '../../apps/production-extension/api-custom-webrtc-runtime.js';

// Reuse the existing bounded host-interface fixture without registering its
// tests. Every new case gets genuine fresh realm-local Promise intrinsics.
const original=readFileSync(new URL('./api-custom-webrtc-runtime.test.mjs',import.meta.url),'utf8');
const boundary=original.search(/\r?\ntest\(/u);assert.ok(boundary>0);
const prefix=original.slice(0,boundary).replace(/^import[^\r\n]*\r?\n/gmu,'');
const marker='  const installation=installWebRtcCustom';assert.equal(prefix.split(marker).length,2);
const firefoxModel=`
  const primordialPromise=Promise,primordialThen=Promise.prototype.then;
  globalThis.offerNativeCalls=0;globalThis.offerBackendCalls=0;globalThis.offerPublicResolveCalls=0;globalThis.enumerationBackendCalls=0;
  globalThis.offerBooleanResults=[];globalThis.offerCallbackThis={nativeCallbackThis:true};
  Object.defineProperty(RTCPeerConnection.prototype,'createOffer',{configurable:true,writable:true,value:function createOffer(first,onError,legacyOptions){
    offerNativeCalls++;
    if(!pcs.has(this))return primordialPromise.reject(invalid);
    const legacy=typeof first==='function',options=legacy?legacyOptions:first,converted={};
    globalThis.lastNativeOfferOptions=options;
    if(options!==undefined&&options!==null&&typeof options!=='object'&&typeof options!=='function')return primordialPromise.reject(invalid);
    try{
      // Real Firefox159 RTCOfferOptions has only these three Boolean members.
      // WebIDL dictionary Gets occur in lexical order before the JS backend.
      for(const key of ['iceRestart','offerToReceiveAudio','offerToReceiveVideo']){
        const item=options===undefined||options===null?undefined:Reflect.get(options,key,options);
        converted[key]=item===undefined?(key==='iceRestart'?false:undefined):!!item;
      }
    }catch(error){return primordialPromise.reject(error);}
    offerBooleanResults.push(converted);
    offerBackendCalls++;
    const internal=new primordialPromise(resolve=>resolve({type:'offer',sdp:nativeSdp}));
    // Firefox159 PeerConnection.sys.mjs::_async calls the content Promise.resolve
    // before returning. This is the source of the pre-return constructor read.
    offerPublicResolveCalls++;
    const result=realm.Promise.resolve(internal);
    return legacy?Reflect.apply(primordialThen,result,[value=>{Reflect.apply(first,offerCallbackThis,[value]);}]):result;
  }});
  const nativeEnumeration=MediaDevices.prototype.enumerateDevices;
  Object.defineProperty(MediaDevices.prototype,'enumerateDevices',{configurable:true,writable:true,value:function enumerateDevices(){enumerationBackendCalls++;return Reflect.apply(nativeEnumeration,this,arguments);}});
  if(typeof globalThis.beforeInstall==='function')beforeInstall(realm);
`;
function fixture(before='',overrides='') {
  const context=vm.createContext({TextEncoder,DOMException});
  vm.runInContext(`globalThis.installWebRtcCustom=(${installWebRtcCustom.toString()});${before}\n`+prefix.replace(marker,firefoxModel+'\n'+marker)+`
    globalThis.f=fixture(profile({randomizeDevices:true,${overrides}}));
    globalThis.P=Promise;globalThis.nativeThen=Promise.prototype.then;globalThis.coldTypeError=TypeError;
    globalThis.pc=new f.realm.RTCPeerConnection();
    globalThis.reads=0;globalThis.stolen=null;
  `,context);
  return{context,run:source=>vm.runInContext(source,context)};
}
const poisonConstructor=`Object.defineProperty(P.prototype,'constructor',{configurable:true,get(){reads++;stolen=this;return P;}});`;

test('RTC Promise preflight: ordinary Firefox-style offer still invokes native once and returns selected SDP',async()=>{
  const f=fixture(),value=await f.run('pc.createOffer()');
  assert.equal(f.context.offerBackendCalls,1);assert.equal(value.type,'offer');assert.ok(value.sdp.includes('198.51.100.20'));assert.equal(value.sdp.includes('192.168.99.7'),false);
  assert.equal(f.run(`Object.getOwnPropertyDescriptor(P.prototype,'constructor').value===P`),true);
});
for(const[name,poison]of[
 ['prototype constructor getter',poisonConstructor],
 ['static species getter',`Object.defineProperty(P,Symbol.species,{configurable:true,get(){reads++;return P;}});`],
 ['public resolve function',`P.resolve=function(value){reads++;stolen=value;return value;};`],
 ['public reject function',`P.reject=function(){reads++;stolen=this;};`],
 ['public all getter',`Object.defineProperty(P,'all',{configurable:true,get(){reads++;return undefined;}});`],
 ['public allSettled function',`P.allSettled=function(){reads++;stolen=this;};`],
 ['public any function',`P.any=function(){reads++;stolen=this;};`],
 ['public race function',`P.race=function(){reads++;stolen=this;};`],
 ['public withResolvers function',`P.withResolvers=function(){reads++;stolen=this;};`],
 ['public try function',`P.try=function(){reads++;stolen=this;};`],
 ['prototype then function',`P.prototype.then=function(){reads++;stolen=this;};`],
 ['prototype catch getter',`Object.defineProperty(P.prototype,'catch',{configurable:true,get(){reads++;stolen=this;return undefined;}});`],
 ['prototype finally function',`P.prototype.finally=function(){reads++;stolen=this;};`],
 ['Object inherited then accessor',`Object.defineProperty(f.realm.Object.prototype,'then',{configurable:true,get(){reads++;stolen=this;return undefined;}});`],
 ['Array inherited then accessor',`Object.defineProperty(f.realm.Array.prototype,'then',{configurable:true,get(){reads++;stolen=this;return undefined;}});`],
 ['Array prototype replacement',`Object.setPrototypeOf(f.realm.Array.prototype,new Proxy({},{getOwnPropertyDescriptor(){reads++;throw Error('untrusted prototype probed');},get(){reads++;throw Error('untrusted prototype read');}}));`],
 ['target global Object getter',`Object.defineProperty(f.realm,'Object',{configurable:true,get(){reads++;return Object;}});`],
 ['target global Array getter',`Object.defineProperty(f.realm,'Array',{configurable:true,get(){reads++;return Array;}});`],
 ['target global Promise getter',`Object.defineProperty(f.realm,'Promise',{configurable:true,get(){reads++;return P;}});`],
 ['target global Promise data replacement',`f.realm.Promise=new Proxy(function PagePromise(){},{getOwnPropertyDescriptor(){reads++;throw Error('untrusted replacement probed');}});`],
 ['missing target global Promise',`delete f.realm.Promise;`]
])test('RTC Promise preflight denies '+name+' without executing hostile code or the native backend',()=>{
 const f=fixture();f.run(poison);
 assert.throws(()=>f.run('pc.createOffer()'),error=>error.name==='TypeError'&&error instanceof f.context.coldTypeError&&Object.getOwnPropertyDescriptor(error,'message')?.value==='Custom WebRTC asynchronous state is unavailable');
 assert.equal(f.context.reads,0);assert.equal(f.context.stolen,null);assert.equal(f.context.offerBackendCalls,0);
 assert.ok(f.run('f.installation.snapshot().unavailable')>0);
});
test('RTC Promise preflight also denies device enumeration before the original operation',()=>{
 const f=fixture();f.run(poisonConstructor);
 assert.throws(()=>f.run('new f.realm.MediaDevices().enumerateDevices()'),error=>error.name==='TypeError');
 assert.equal(f.context.enumerationBackendCalls,0);assert.equal(f.context.reads,0);assert.equal(f.context.stolen,null);
});

test('RTC missing optional Promise static cannot inherit a page getter or gain a Proxy lookup path',()=>{
 for(const poison of[
  `Object.defineProperty(Object.getPrototypeOf(P),'try',{configurable:true,get(){reads++;return function(){stolen=this;};}});`,
  `Object.setPrototypeOf(P,new Proxy(Object.getPrototypeOf(P),{getOwnPropertyDescriptor(){reads++;throw Error('unsafe inherited lookup');}}));`
 ]){
  const f=fixture(`globalThis.beforeInstall=target=>{delete target.Promise.try;};`);f.run(poison);
  assert.throws(()=>f.run('pc.createOffer()'),error=>error instanceof f.context.coldTypeError&&error.message==='Custom WebRTC asynchronous state is unavailable');
  assert.equal(f.context.reads,0);assert.equal(f.context.offerBackendCalls,0);assert.equal(f.context.stolen,null);
  assert.equal(f.run(`Object.getOwnPropertyDescriptor(P,'try')===undefined`),true);
 }
});
test('RTC Promise preflight retains the first safe target snapshot across a later installation',()=>{
 const f=fixture(`globalThis.beforeInstall=target=>{installWebRtcCustom(target,[]);Object.defineProperty(target.Promise.prototype,'constructor',{configurable:true,get(){globalThis.earlyReads=(globalThis.earlyReads||0)+1;return target.Promise;}});};`);
 assert.throws(()=>f.run('pc.createOffer()'),error=>error.name==='TypeError');
 assert.equal(f.context.earlyReads,undefined);assert.equal(f.context.offerBackendCalls,0);
});
test('RTC Promise preflight does not repair a cold unsafe constructor or invoke it during capture',()=>{
 const f=fixture(`globalThis.beforeInstall=target=>Object.defineProperty(target.Promise.prototype,'constructor',{configurable:true,get(){globalThis.earlyReads=(globalThis.earlyReads||0)+1;return target.Promise;}});`);
 assert.equal(f.context.earlyReads,undefined);assert.throws(()=>f.run('pc.createOffer()'),error=>error.name==='TypeError');assert.equal(f.context.earlyReads,undefined);assert.equal(f.context.offerBackendCalls,0);
});
test('RTC Promise preflight uses captured symbols/exceptions and stop delegates the native operation',async()=>{
 const f=fixture();f.run(`globalThis.TypeError=function(){reads++;throw Error('late TypeError');};globalThis.Symbol={get species(){reads++;throw Error('late Symbol');}};${poisonConstructor}`);
 assert.throws(()=>f.run('pc.createOffer()'),error=>error instanceof f.context.coldTypeError);assert.equal(f.context.reads,0);
 f.run(`Object.defineProperty(P.prototype,'constructor',{configurable:true,writable:true,value:P});globalThis.retained=pc.createOffer;f.installation.stop();f.realm.Promise={resolve(value){reads++;return value;}};`);
 const value=await f.run('Reflect.apply(retained,pc,[])');assert.equal(f.context.offerBackendCalls,1);assert.equal(f.context.reads,1);assert.ok(value.sdp.includes('192.168.99.7'));
});
test('RTC Promise preflight does not apply a Custom denial to an explicit dormant mode',async()=>{
 const f=fixture();f.run(`f.installation.stop();installWebRtcCustom(f.realm,[{id:'webrtc',mode:'off',value:profile()}]);${poisonConstructor}`);
 const value=await f.run('pc.createOffer()');assert.equal(f.context.offerBackendCalls,1);assert.ok(value.sdp.includes('192.168.99.7'));assert.ok(f.context.reads>0);
});
test('RTC Promise preflight denies mutation from inside a native options getter before the offer backend and public resolve',async()=>{
 const f=fixture();
 const returned=f.run(`pc.createOffer({get offerToReceiveAudio(){
   globalThis.optionReads=(globalThis.optionReads||0)+1;
   Object.defineProperty(P.prototype,'constructor',{configurable:true,get(){
     reads++;
     if(!stolen){stolen=this;Reflect.apply(nativeThen,this,[value=>globalThis.earlySample=value]);}
     return P;
   }});return false;
 }})`);
 // Observe only the original operation. Later consumer .then/await may inspect
 // the public result's constructor and is not an internal-source exposure.
 assert.equal(f.context.reads,0);assert.equal(f.context.stolen,null);
 f.run(`Object.defineProperty(P.prototype,'constructor',{configurable:true,writable:true,value:P});`);
 await assert.rejects(returned,error=>error instanceof f.context.coldTypeError&&Object.getOwnPropertyDescriptor(error,'message')?.value==='Custom WebRTC asynchronous state is unavailable');
 assert.equal(f.context.optionReads,1);assert.equal(f.context.offerNativeCalls,1);assert.equal(f.context.offerBackendCalls,0);assert.equal(f.context.offerPublicResolveCalls,0);
 assert.equal(f.context.reads,0);assert.equal(f.context.stolen,null);assert.equal(f.context.earlySample,undefined);
});

test('RTC offer dictionary preserves native getter receiver/order/count, defaults and Boolean conversion without object coercion',async()=>{
 const f=fixture();
 const value=await f.run(`globalThis.optionOrder=[];globalThis.coercions=0;
 globalThis.options={get iceRestart(){optionOrder.push(['iceRestart',this===options]);return 0;},
 get offerToReceiveAudio(){optionOrder.push(['offerToReceiveAudio',this===options]);return {valueOf(){coercions++;throw Error('unused');},[Symbol.toPrimitive](){coercions++;throw Error('unused');}};},
 get offerToReceiveVideo(){optionOrder.push(['offerToReceiveVideo',this===options]);return '';},
 get unrelated(){throw Error('unused extra property');}};
 pc.createOffer(options)`);
 assert.deepEqual(JSON.parse(f.run('JSON.stringify(optionOrder)')),[['iceRestart',true],['offerToReceiveAudio',true],['offerToReceiveVideo',true]]);
 assert.deepEqual(JSON.parse(f.run('JSON.stringify(offerBooleanResults)')),[{iceRestart:false,offerToReceiveAudio:true,offerToReceiveVideo:false}]);
 assert.equal(f.context.coercions,0);assert.equal(f.context.offerNativeCalls,1);assert.equal(f.context.offerBackendCalls,1);assert.equal(f.context.offerPublicResolveCalls,1);assert.ok(value.sdp.includes('198.51.100.20'));
 assert.equal(f.run('lastNativeOfferOptions===options'),false,'the private dictionary Proxy is an explicit argument-identity boundary');
});

test('RTC offer dictionary supports frozen inputs and forwards an original Proxy get receiver exactly once without descriptor/ownKeys probes',async()=>{
 const f=fixture();
 const values=await f.run(`globalThis.trapOrder=[];globalThis.frozen=Object.freeze({iceRestart:true,offerToReceiveAudio:false,offerToReceiveVideo:true});
 globalThis.input=new Proxy(frozen,{get(target,key,receiver){trapOrder.push([key,receiver===input]);return Reflect.get(target,key,receiver);},
 getOwnPropertyDescriptor(){throw Error('descriptor probe');},ownKeys(){throw Error('enumeration probe');}});
 Promise.all([pc.createOffer(frozen),pc.createOffer(input)])`);
 assert.equal(values.length,2);assert.deepEqual(JSON.parse(f.run('JSON.stringify(trapOrder)')),[['iceRestart',true],['offerToReceiveAudio',true],['offerToReceiveVideo',true]]);
 assert.deepEqual(JSON.parse(f.run('JSON.stringify(offerBooleanResults)')),[{iceRestart:true,offerToReceiveAudio:false,offerToReceiveVideo:true},{iceRestart:true,offerToReceiveAudio:false,offerToReceiveVideo:true}]);
 assert.equal(f.context.offerNativeCalls,2);assert.equal(f.context.offerBackendCalls,2);
});

test('RTC offer dictionary preserves native brand ordering and the exact thrown getter rejection without reading later fields',async()=>{
 const f=fixture();
 await assert.rejects(f.run(`globalThis.sentinel=Error('native options getter');globalThis.throwReads=0;
 pc.createOffer({get iceRestart(){throwReads++;throw sentinel;},get offerToReceiveAudio(){throwReads++;throw Error('must not read');}})`),error=>error===f.context.sentinel);
 assert.equal(f.context.throwReads,1);assert.equal(f.context.offerBackendCalls,0);assert.equal(f.context.offerPublicResolveCalls,0);
 await assert.rejects(f.run(`Reflect.apply(pc.createOffer,{},[])`),error=>error.message==='NATIVE_BRAND');
 await assert.rejects(f.run(`Reflect.apply(pc.createOffer,{},[{get iceRestart(){throwReads++;throw sentinel;}}])`),error=>error.message==='NATIVE_BRAND');
 assert.equal(f.context.throwReads,1);assert.equal(f.context.offerNativeCalls,3);
});

test('RTC offer dictionary wraps only the actual legacy options slot and preserves callback receiver, once count and Promise void',async()=>{
 const f=fixture();
 const value=await f.run(`globalThis.legacyReads=[];globalThis.callbackCalls=0;globalThis.callbackSample=null;globalThis.callbackReceiver=null;
 globalThis.legacyOptions={get iceRestart(){legacyReads.push(['iceRestart',this===legacyOptions]);return true;},
 get offerToReceiveAudio(){legacyReads.push(['offerToReceiveAudio',this===legacyOptions]);return false;},
 get offerToReceiveVideo(){legacyReads.push(['offerToReceiveVideo',this===legacyOptions]);return true;}};
 pc.createOffer(function(sample){callbackCalls++;callbackSample=sample;callbackReceiver=this;},function(){throw Error('unexpected failure');},legacyOptions)`);
 assert.equal(value,undefined);assert.equal(f.context.callbackCalls,1);assert.equal(f.run('callbackReceiver===offerCallbackThis'),true);
 assert.ok(f.context.callbackSample.sdp.includes('198.51.100.20'));assert.equal(f.context.callbackSample.sdp.includes('192.168.99.7'),false);
 assert.deepEqual(JSON.parse(f.run('JSON.stringify(legacyReads)')),[['iceRestart',true],['offerToReceiveAudio',true],['offerToReceiveVideo',true]]);assert.equal(f.context.offerBackendCalls,1);
});

test('RTC offer dictionary denies late legacy options poisoning without success callback or public Promise observation',async()=>{
 const f=fixture();
 const returned=f.run(`globalThis.callbackCalls=0;pc.createOffer(()=>callbackCalls++,()=>callbackCalls++,{
 get offerToReceiveVideo(){${poisonConstructor}return false;}})`);
 assert.equal(f.context.reads,0);assert.equal(f.context.stolen,null);
 f.run(`Object.defineProperty(P.prototype,'constructor',{configurable:true,writable:true,value:P});`);
 await assert.rejects(returned,error=>error instanceof f.context.coldTypeError&&error.message==='Custom WebRTC asynchronous state is unavailable');
 assert.equal(f.context.offerNativeCalls,1);assert.equal(f.context.offerBackendCalls,0);assert.equal(f.context.offerPublicResolveCalls,0);assert.equal(f.context.callbackCalls,0);assert.equal(f.context.reads,0);assert.equal(f.context.stolen,null);
});

test('RTC offer dictionary leaves retained wrappers native after Stop including getter mutation and original options identity',async()=>{
 const f=fixture();f.run(`globalThis.retained=pc.createOffer;f.installation.stop();`);
 const value=await f.run(`globalThis.options={get offerToReceiveAudio(){${poisonConstructor}return false;}};Reflect.apply(retained,pc,[options])`);
 assert.equal(f.context.offerNativeCalls,1);assert.equal(f.context.offerBackendCalls,1);assert.equal(f.context.offerPublicResolveCalls,1);assert.ok(f.context.reads>0);assert.ok(value.sdp.includes('192.168.99.7'));
 assert.equal(f.run('lastNativeOfferOptions===options'),true);
});

for(const method of ['createOffer','createAnswer'])test('RTC '+method+' with no arguments never reads an inherited numeric argument',async()=>{
 const f=fixture();
 const returned=f.run(`globalThis.numericReads=0;globalThis.numericFailure=Error('unexpected argument read');
 Object.defineProperty(Object.prototype,'0',{configurable:true,get(){numericReads++;throw numericFailure;},set(value){Object.defineProperty(this,'0',{value,configurable:true,writable:true,enumerable:true});}});
 try{pc.${method}();}finally{delete Object.prototype['0'];}`);
 assert.equal(f.context.numericReads,0);
 const value=await returned;assert.equal(value.type,method==='createOffer'?'offer':'answer');assert.ok(value.sdp.includes('198.51.100.20'));
 assert.equal(f.run(`f.calls.filter(row=>row[0]==='${method==='createOffer'?'construct':'answer'}').length`),1);
 if(method==='createOffer')assert.equal(f.context.offerBackendCalls,1);
});

test('RTC legacy offer with an omitted third argument never reads inherited index two and preserves callback result',async()=>{
 const f=fixture();
 const returned=f.run(`globalThis.numericReads=0;globalThis.callbackCalls=0;globalThis.callbackSample=null;globalThis.callbackReceiver=null;
 Object.defineProperty(Object.prototype,'2',{configurable:true,get(){numericReads++;throw Error('unexpected omitted options read');},set(value){Object.defineProperty(this,'2',{value,configurable:true,writable:true,enumerable:true});}});
 try{pc.createOffer(function(value){callbackCalls++;callbackSample=value;callbackReceiver=this;},function(){throw Error('unexpected rejection callback');});}finally{delete Object.prototype['2'];}`);
 assert.equal(f.context.numericReads,0);assert.equal(await returned,undefined);
 assert.equal(f.context.callbackCalls,1);assert.equal(f.run('callbackReceiver===offerCallbackThis'),true);assert.ok(f.context.callbackSample.sdp.includes('198.51.100.20'));
 assert.equal(f.context.offerBackendCalls,1);assert.equal(f.run('lastNativeOfferOptions===undefined'),true);
});

test('RTC zero-argument selected configuration creates an own private argument without inherited numeric reads or writes',()=>{
 const f=fixture('',`freshCertificates:true,iceTransportPolicy:'relay'`);
 f.run(`globalThis.numericReads=0;globalThis.numericWrites=0;
 Object.defineProperty(Object.prototype,'0',{configurable:true,get(){numericReads++;throw Error('unexpected config read');},set(){numericWrites++;throw Error('unexpected config write');}});
 try{globalThis.selectedPc=new f.realm.RTCPeerConnection();}finally{delete Object.prototype['0'];}`);
 assert.equal(f.context.numericReads,0);assert.equal(f.context.numericWrites,0);
 assert.equal(f.run('selectedPc.getConfiguration().iceTransportPolicy'),'relay');assert.equal(f.run('selectedPc.getConfiguration().certificates[0].kind'),'native-fresh');
 assert.equal(f.run(`f.calls.filter(row=>row[0]==='construct').length`),2);
});

test('RTC stats missing keys preserve the native argument error without inherited numeric reads',async()=>{
 const f=fixture();f.context.report=await f.run('pc.getStats()');
 f.run(`globalThis.numericReads=0;globalThis.nativeErrors=0;
 Object.defineProperty(Object.prototype,'0',{configurable:true,get(){numericReads++;throw Error('unexpected stats key read');},set(value){Object.defineProperty(this,'0',{value,configurable:true,writable:true,enumerable:true});}});
 try{for(const key of ['get','has']){try{report[key]();}catch(error){if(error!==f.invalid)throw error;nativeErrors++;}}
 report.keys();report.values();report.entries();report[Symbol.iterator]();}finally{delete Object.prototype['0'];}`);
 assert.equal(f.context.numericReads,0);assert.equal(f.context.nativeErrors,2);
});
