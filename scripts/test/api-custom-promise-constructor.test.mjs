import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { inspect, types } from 'node:util';
import { installApiCustom } from '../../apps/production-extension/api-custom-runtime.js';
import { installCanvasCustom } from '../../apps/production-extension/api-custom-canvas-runtime.js';
import { installWebRtcCustom } from '../../apps/production-extension/api-custom-webrtc-runtime.js';

// Real, realm-local Promise algorithms with bounded host-API fixtures. Every
// installer is reconstructed from its serialized source, as in document start.
const common = `
 const NP=Promise,define=Object.defineProperty,descriptor=Object.getOwnPropertyDescriptor,freeze=Object.freeze,SP=Symbol.species;
 globalThis.mode='fulfilled';globalThis.calls=0;globalThis.nativeError=new TypeError('native receiver');globalThis.nativeRejection={native:true};
 globalThis.argument={};globalThis.seenArgument=null;globalThis.seenReceiver=null;globalThis.nativeValue=null;
 function outcome(value,receiver,arg){
  calls++;seenReceiver=receiver;seenArgument=arg;nativeValue=value;
  let result=mode==='rejected'?NP.reject(nativeRejection):mode==='pending'?new NP(resolve=>globalThis.release=()=>resolve(value)):NP.resolve(value);
  if(mode==='frozen')freeze(result);
  if(mode==='locked-constructor')define(result,'constructor',{get(){globalThis.lockedReads++;throw nativeError;}});
  if(mode==='configurable-data')define(result,'constructor',{value:NP,writable:true,configurable:true,enumerable:true});
  if(mode==='configurable-getter')define(result,'constructor',{get(){globalThis.lockedReads++;return NP;},configurable:true,enumerable:true});
  globalThis.lastNative=result;return result;
 }
 globalThis.lockedReads=0;
`;
const usb = `
 class USB {getDevices(arg){if(this!==receiver)throw nativeError;return outcome([{raw:true}],this,arg);}}
 globalThis.receiver=new USB();globalThis.realm={Object,Array,Promise,USB};globalThis.entries=[{id:'usb',mode:'custom',value:[]}];
 globalThis.bind=()=>{globalThis.wrapper=USB.prototype.getDevices;globalThis.invoke=()=>Reflect.apply(wrapper,receiver,[argument]);};
`;
const rtc = `
 const devices=new WeakMap();
 class RTCIceCandidate {get candidate(){return '';}get type(){return 'host';}get address(){return '192.0.2.1';}get relatedAddress(){return null;}toJSON(){return {candidate:''};}}
 class RTCSessionDescription {get sdp(){return '';}toJSON(){return {type:'offer',sdp:''};}}
 class RTCPeerConnection {
  createOffer(){return NP.resolve({type:'offer',sdp:''});}createAnswer(){return NP.resolve({type:'answer',sdp:''});}
  setLocalDescription(){return NP.resolve();}setRemoteDescription(){return NP.resolve();}addIceCandidate(){return NP.resolve();}
  getStats(arg){if(this!==pcReceiver)return NP.reject(nativeError);return outcome(new Map([['raw-id',{id:'raw-id',type:'local-candidate',candidateType:'host',address:'192.0.2.1',port:9}]]),this,arg);}
 }
 class MediaDeviceInfo {constructor(){devices.set(this,true);}get deviceId(){if(!devices.has(this))throw nativeError;return 'raw-device';}get groupId(){return 'raw-group';}get kind(){return 'audioinput';}get label(){return 'Raw microphone';}}
 class MediaDevices {enumerateDevices(arg){if(this!==mediaReceiver)return NP.reject(nativeError);return outcome([new MediaDeviceInfo()],this,arg);}}
 globalThis.pcReceiver=new RTCPeerConnection();globalThis.mediaReceiver=new MediaDevices();
 globalThis.realm={Object,Array,Promise,RTCPeerConnection,RTCIceCandidate,RTCSessionDescription,MediaDevices,MediaDeviceInfo,location:{origin:'https://example.test'}};
 globalThis.entries=[{id:'webrtc',mode:'custom',deviceSeed:'a'.repeat(64),value:{addresses:{ipv4:{host:'198.51.100.1',stun:'198.51.100.2',turn:'198.51.100.3'},ipv6:{host:null,stun:null,turn:null}},iceTransportPolicy:'preserve',randomizeDevices:true,freshCertificates:false,deviceLifetime:'site'}}];
`;
const canvas = `
 const records=new WeakMap(),contexts=new WeakMap(),images=new WeakMap();
 function required(map,key){const value=map.get(key);if(!value)throw nativeError;return value;}
 class ImageData {constructor(data,w,h){images.set(this,{data,w,h});}get data(){return required(images,this).data;}get width(){return required(images,this).w;}get height(){return required(images,this).h;}get colorSpace(){return 'srgb';}}
 class CanvasRenderingContext2D {
  constructor(canvas){contexts.set(this,canvas);}get canvas(){return required(contexts,this);}getContextAttributes(){return {colorSpace:'srgb',colorType:'unorm8'};}
  getImageData(){const r=required(records,this.canvas);return new ImageData(new Uint8ClampedArray(r.data),r.w,r.h);}
  putImageData(image){required(records,this.canvas).data.set(image.data);}
  drawImage(source){required(records,this.canvas).data.set(required(records,source).data);}
 }
 class OffscreenCanvasRenderingContext2D extends CanvasRenderingContext2D {}
 class HTMLCanvasElement {
  constructor(){records.set(this,{w:1,h:1,data:new Uint8ClampedArray([10,20,30,255])});}
  get width(){return required(records,this).w;}set width(v){const r=required(records,this);r.w=v;r.data=new Uint8ClampedArray(r.w*r.h*4);}
  get height(){return required(records,this).h;}set height(v){const r=required(records,this);r.h=v;r.data=new Uint8ClampedArray(r.w*r.h*4);}
  getContext(){const r=required(records,this);return r.ctx??=new CanvasRenderingContext2D(this);}
  toBlob(callback){const value=new Blob([required(records,this).data],{type:'image/png'});queueMicrotask(()=>callback(value));}
 }
 class OffscreenCanvas {
  constructor(){records.set(this,{w:1,h:1,data:new Uint8ClampedArray([10,20,30,255])});}
  get width(){return required(records,this).w;}get height(){return required(records,this).h;}
  getContext(){const r=required(records,this);return r.ctx??=new OffscreenCanvasRenderingContext2D(this);}
  convertToBlob(arg){return outcome(new Blob([required(records,this).data],{type:'image/png'}),this,arg);}
 }
 class Document {createElement(){return new HTMLCanvasElement();}}
 globalThis.realm={HTMLCanvasElement,OffscreenCanvas,CanvasRenderingContext2D,OffscreenCanvasRenderingContext2D,ImageData,Document,Blob,DOMException,document:new Document(),origin:'https://example.test'};
 globalThis.entries=[{id:'canvas-readback',mode:'custom',value:{algorithm:'stable-rgb-v1'},canvasSeed:'0123456789abcdef'.repeat(4)}];
 globalThis.argument=undefined;
 globalThis.bind=()=>{globalThis.receiver=new OffscreenCanvas();receiver.getContext('2d');globalThis.wrapper=OffscreenCanvas.prototype.convertToBlob;globalThis.invoke=()=>Reflect.apply(wrapper,receiver,[argument]);};
`;
const definitions = [
 {id:'generic USB',installer:installApiCustom,source:usb,projection:'Array.isArray(value)&&value.length===0'},
 {id:'RTC statistics',installer:installWebRtcCustom,source:rtc+`globalThis.receiver=pcReceiver;globalThis.bind=()=>{globalThis.wrapper=RTCPeerConnection.prototype.getStats;globalThis.invoke=()=>Reflect.apply(wrapper,receiver,[argument]);};`,projection:`value instanceof Map&&value!==nativeValue&&[...value.values()][0].address==='198.51.100.1'`},
 {id:'RTC enumeration',installer:installWebRtcCustom,source:rtc+`globalThis.receiver=mediaReceiver;globalThis.bind=()=>{globalThis.wrapper=MediaDevices.prototype.enumerateDevices;globalThis.invoke=()=>Reflect.apply(wrapper,receiver,[argument]);};`,projection:`Array.isArray(value)&&value.length===1&&value[0].deviceId!=='raw-device'&&value[0].deviceId.length===64`},
 {id:'Offscreen encoder',installer:installCanvasCustom,source:canvas,projection:`value instanceof Blob&&value.type==='image/png'&&value!==nativeValue`},
];
function fixture(definition,selectedMode='fulfilled') {
 const context=vm.createContext({Blob,DOMException,TextEncoder,queueMicrotask});
 vm.runInContext(common+definition.source,context);
 const installer=vm.runInContext('('+definition.installer.toString()+')',context);
 context.guard=installer(context.realm,context.entries);vm.runInContext('bind();',context);context.mode=selectedMode;
 const run=source=>vm.runInContext(source,context);
 return {context,run};
}
function trappedInvoke(f) {
 return f.run(`(()=>{
  const original=descriptor(NP.prototype,'constructor'),species=descriptor(NP,SP);
  globalThis.constructorReads=0;globalThis.speciesReads=0;
  define(NP.prototype,'constructor',{configurable:true,get(){constructorReads++;globalThis.stolen=this;return NP;}});
  define(NP,SP,{configurable:true,get(){speciesReads++;return NP;}});
  try {globalThis.returned=invoke();return returned;}
  finally {define(NP.prototype,'constructor',original);define(NP,SP,species);}
 })()`);
}
// ADR-100 + WebIDL: the generic installer refuses an unsafe Promise boundary with a rejected Promise; the WebRTC installer still throws.
function denied(definition,invoke) {
 if(definition.installer!==installApiCustom){assert.throws(invoke,error=>error.name==='TypeError');return undefined;}
 let returned;assert.doesNotThrow(()=>{returned=invoke();});
 assert.equal(types.isPromise(returned),true);assert.match(inspect(returned,{depth:0}),/^Promise \{\s*<rejected> TypeError/u);
 return returned;
}
function selectedInvoke(f,definition) {
 if(definition.installer===installCanvasCustom)return trappedInvoke(f);
 f.run('globalThis.constructorReads=0;globalThis.speciesReads=0;');return f.run('globalThis.returned=invoke();returned');
}
for(const definition of definitions){
 test(definition.id+(definition.installer!==installCanvasCustom?': pre-existing hostile constructor/species is denied before native invocation':': no public constructor/species lookup; serialized installer returns only the selected result'),async()=>{
  if(definition.installer!==installCanvasCustom){
   const f=fixture(definition),returned=denied(definition,()=>trappedInvoke(f));
   assert.equal(f.context.constructorReads,0);assert.equal(f.context.speciesReads,0);assert.equal(f.context.stolen,undefined);assert.equal(f.context.calls,0);
   if(returned)await assert.rejects(returned,error=>error.name==='TypeError');return;
  }
  const f=fixture(definition),returned=trappedInvoke(f),value=await returned;
  assert.equal(f.context.constructorReads,0);assert.equal(f.context.speciesReads,0);assert.equal(f.context.stolen,undefined);
  assert.equal(f.context.calls,1);assert.equal(f.context.seenReceiver,f.context.receiver);assert.equal(f.context.seenArgument,f.context.argument);
  assert.notEqual(returned,f.context.lastNative);f.context.value=value;assert.equal(f.run(definition.projection),true);
  if(definition.installer===installCanvasCustom){
   const actual=new Uint8Array(await value.arrayBuffer()),native=new Uint8Array(await f.context.nativeValue.arrayBuffer());
   assert.equal(actual.length,4);assert.equal(actual[3],native[3]);for(let channel=0;channel<3;channel++)assert.equal(Math.abs(actual[channel]-native[channel]),1);
  }
  assert.equal(f.run(`(()=>{const d=descriptor(lastNative,'constructor'),s=descriptor(d.value,SP);return d.enumerable===false&&d.writable===false&&d.configurable===false&&Object.getPrototypeOf(d.value)===null&&Object.isFrozen(d.value)&&s.value===NP&&s.get===undefined;})()`),true);
 });
 for(const mode of['configurable-data','configurable-getter'])test(definition.id+': existing '+mode+' constructor is replaced without reading it and sealed before projection',async()=>{
  const f=fixture(definition,mode),value=await selectedInvoke(f,definition);f.context.value=value;
  assert.equal(f.run(definition.projection),true);assert.equal(f.context.constructorReads,0);assert.equal(f.context.speciesReads,0);assert.equal(f.context.lockedReads,0);assert.equal(f.context.calls,1);
  assert.equal(f.run(`(()=>{const d=descriptor(lastNative,'constructor'),s=descriptor(d.value,SP);return d.enumerable===false&&d.writable===false&&d.configurable===false&&Object.getPrototypeOf(d.value)===null&&Object.isFrozen(d.value)&&s.value===NP&&s.get===undefined;})()`),true);
 });
 test(definition.id+': native rejection identity survives without exposing the rejected source Promise',async()=>{
  const f=fixture(definition,'rejected'),returned=selectedInvoke(f,definition);
  await assert.rejects(returned,error=>error===f.context.nativeRejection);
  assert.equal(f.context.constructorReads,0);assert.equal(f.context.speciesReads,0);assert.equal(f.context.calls,1);
 });
 for(const mode of['frozen','locked-constructor'])test(definition.id+': '+mode+' source fails closed without a raw fallback or getter call',()=>{
  const f=fixture(definition,mode);
  assert.throws(()=>selectedInvoke(f,definition),error=>error.name==='TypeError');
  assert.equal(f.context.constructorReads,0);assert.equal(f.context.speciesReads,0);assert.equal(f.context.lockedReads,0);assert.equal(f.context.calls,1);
 });
 test(definition.id+(definition.installer!==installCanvasCustom?': late target Promise replacement is denied using captured exception/symbol intrinsics':': late global Promise, Symbol and TypeError replacements are not consulted'),async()=>{
  const f=fixture(definition);
  f.run(`globalThis.Promise=function(){throw Error('late Promise');};globalThis.TypeError=function(){throw Error('late TypeError');};globalThis.Symbol={get species(){throw Error('late species');}};`);
  if(definition.installer!==installCanvasCustom){
   f.run('realm.Promise=Promise;');const returned=denied(definition,()=>trappedInvoke(f));assert.equal(f.context.calls,0);assert.equal(f.context.constructorReads,0);assert.equal(f.context.speciesReads,0);
   if(returned)await assert.rejects(returned,error=>error.name==='TypeError');return;
  }
  const value=await trappedInvoke(f);f.context.value=value;assert.equal(f.run(definition.projection),true);
  assert.equal(f.context.constructorReads,0);assert.equal(f.context.speciesReads,0);
 });
 if(definition.installer!==installCanvasCustom){
  test(definition.id+': stopped retained wrapper preserves native Promise identity without pinning',()=>{
   const f=fixture(definition);f.context.guard.stop();const returned=f.run('invoke()');
   assert.equal(returned,f.context.lastNative);assert.equal(f.run(`descriptor(lastNative,'constructor')===undefined`),true);
  });
  test(definition.id+': pending stop retains the established native settlement',async()=>{
   const f=fixture(definition,'pending'),returned=selectedInvoke(f,definition);f.context.guard.stop();f.context.release();
   assert.equal(await returned,f.context.nativeValue);assert.equal(f.context.calls,1);
  });
 }
}
test('generic async native invalid receiver still throws the exact native exception before any pin',()=>{
 const f=fixture(definitions[0]);assert.throws(()=>f.run('Reflect.apply(wrapper,{},[argument])'),error=>error===f.context.nativeError);assert.equal(f.context.calls,0);
});
test('RTC async native invalid receiver still rejects with the exact native error',async()=>{
 const f=fixture(definitions[1]);await assert.rejects(f.run('Reflect.apply(wrapper,{},[argument])'),error=>error===f.context.nativeError);assert.equal(f.context.calls,0);
});
