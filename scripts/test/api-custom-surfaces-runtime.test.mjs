import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installSurfaceCustom} from '../../apps/production-extension/api-custom-surfaces-runtime.js';

// Note: the mock classes below are top-level declarations, i.e. lexical bindings that shadow the global properties the installer wraps.
// "new AudioBuffer()" in these tests therefore bypasses the installer's AudioBuffer constructor wrapper and models an engine-produced
// buffer (always projected). Page-authored buffers (createBuffer, wrapped constructor) are covered by api-custom-audio-authored.test.mjs.
function fixture(entries, setup = '') {
  const context = vm.createContext({});
  vm.runInContext(`
    globalThis.counts={parameter:0,extension:0,audioRead:0,audioCopy:0,fontSet:0,raf:0};
    const gls=new WeakSet(),buffers=new WeakMap(),metrics=new WeakMap(),fonts=new WeakMap(),featureSets=new WeakMap();
    class WebGLRenderingContext {
      constructor(){gls.add(this)}
      getParameter(key){if(!gls.has(this))throw new TypeError('brand');counts.parameter++; key=Number(key)>>>0;
        if(key===3379)return8192;if(key===3386)return new Int32Array([8192,8192]);if(key===33902)return new Float32Array([1,8]);if(key===7938)return 'WebGL synthetic';return null}
      getSupportedExtensions(){if(!gls.has(this))throw new TypeError('brand');return ['EXT_a','EXT_b']}
      getExtension(key){if(!gls.has(this))throw new TypeError('brand');counts.extension++;key=String(key).toLowerCase();return key==='ext_a'||key==='ext_b'?{extension:true}:null}
    }
    class AudioBuffer {
      constructor(length=32){buffers.set(this,new Float32Array(Array.from({length},(_,index)=>index===0?0:Math.sin(index)*0.75)))}
      get length(){const data=buffers.get(this);if(!data)throw new TypeError('brand');return data.length}
      get duration(){return this.length/44100}get sampleRate(){if(!buffers.has(this))throw new TypeError('brand');return44100}
      getChannelData(channel){const data=buffers.get(this);if(!data)throw new TypeError('brand');counts.audioRead++;if((Number(channel)>>>0)!==0)throw new RangeError('channel');return data}
      copyFromChannel(destination,channel,start=0){const data=buffers.get(this);if(!data)throw new TypeError('brand');counts.audioCopy++;if((Number(channel)>>>0)!==0)throw new RangeError('channel');start=Number(start)>>>0;for(let i=0;i<Math.max(0,Math.min(destination.length,data.length-start));i++)destination[i]=data[start+i]}
    }
    class TextMetrics {constructor(){metrics.set(this,20)}get width(){if(!metrics.has(this))throw new TypeError('brand');return metrics.get(this)}}
    class CanvasRenderingContext2D {constructor(){fonts.set(this,'10px sans-serif')}get font(){if(!fonts.has(this))throw new TypeError('brand');return fonts.get(this)}set font(value){if(!fonts.has(this))throw new TypeError('brand');counts.fontSet++;value=String(value);if(/px /.test(value))fonts.set(this,value)}}
    class GPUSupportedLimits {get maxTextureDimension2D(){if(!(this instanceof GPUSupportedLimits))throw new TypeError('brand');return8192}get minUniformBufferOffsetAlignment(){return64}}
    class GPUSupportedFeatures {
      constructor(){featureSets.set(this,new Set(['feature-a','feature-b']))}
      get size(){const set=featureSets.get(this);if(!set)throw new TypeError('brand');return set.size}
      has(value){const set=featureSets.get(this);if(!set)throw new TypeError('brand');return set.has(String(value))}
      values(){const set=featureSets.get(this);if(!set)throw new TypeError('brand');return set.values()}
      keys(){return this.values()}entries(){const set=featureSets.get(this);if(!set)throw new TypeError('brand');return set.entries()}
      [Symbol.iterator](){const set=featureSets.get(this);if(!set)throw new TypeError('brand');return set.values()}
      forEach(callback,thisArg){const set=featureSets.get(this);if(!set)throw new TypeError('brand');return set.forEach((value)=>callback.call(thisArg,value,value,this))}
    }
    class Performance {now(){if(this!==performance)throw new TypeError('brand');return123.75}}
    class Navigator {};
    Object.assign(globalThis,{WebGLRenderingContext,AudioBuffer,TextMetrics,CanvasRenderingContext2D,GPUSupportedLimits,GPUSupportedFeatures,Performance,Navigator});
    globalThis.performance=new Performance();globalThis.navigator=new Navigator();globalThis.chrome={app:{}};
    globalThis.requestAnimationFrame=function(callback){if(typeof callback!=='function')throw new TypeError('callback');counts.raf++;globalThis.rafCallback=callback;return99};
    ${setup}
    globalThis.installSurfaceCustom=(${installSurfaceCustom.toString()});
  `.replaceAll('return8192','return 8192').replaceAll('return44100','return 44100').replaceAll('return64','return 64').replaceAll('return123','return 123').replaceAll('return99','return 99'),context);
  context.entries=entries.map(row=>({...row,mode:'custom'}));vm.runInContext('globalThis.guard=installSurfaceCustom(globalThis,entries)',context);
  return source=>vm.runInContext(source,context);
}
test('surfaces WebGL capabilities keep typed result realm and cap actual supported limits',()=>{
 const run=fixture([{id:'webgl-capabilities',value:{parameters:{MAX_TEXTURE_SIZE:4096,MAX_VIEWPORT_DIMS:[2048,1024],VERSION:'WebGL selected'},extensions:['EXT_a']}}]);
 assert.equal(run('new WebGLRenderingContext().getParameter(3379)'),4096);
 assert.equal(run('new WebGLRenderingContext().getParameter(7938)'),'WebGL selected');
 assert.equal(run('Object.getPrototypeOf(new WebGLRenderingContext().getParameter(3386))===Int32Array.prototype'),true);
 assert.equal(run('[...new WebGLRenderingContext().getParameter(3386)].join()'),'2048,1024');
 assert.equal(run('new WebGLRenderingContext().getSupportedExtensions().join()'),'EXT_a');
 assert.equal(run('new WebGLRenderingContext().getExtension("EXT_b")'),null);
 assert.equal(run('!!new WebGLRenderingContext().getExtension("ext_a")'),true);
});
test('surfaces WebGL original coercion runs once; fake receiver and opaque extension do not leak selected capabilities',()=>{
 const run=fixture([{id:'webgl-capabilities',value:{parameters:{MAX_TEXTURE_SIZE:4096},extensions:[]}}]);
 assert.equal(run('let coercions=0; const gl=new WebGLRenderingContext(); gl.getParameter({valueOf(){coercions++;return3379}});coercions'.replace('return3379','return 3379')),1);
 assert.equal(run('gl.getExtension({toString(){coercions++;return "EXT_a"}})'),null);assert.equal(run('coercions'),2);
 assert.throws(()=>run('WebGLRenderingContext.prototype.getParameter.call({},3379)'),/brand/);
});
test('surfaces GPU features keep size, has, values, entries and forEach consistent with actual subset',()=>{
 const run=fixture([{id:'webgpu-capabilities',value:{limits:{maxTextureDimension2D:4096,minUniformBufferOffsetAlignment:128},features:['feature-a','not-native']}}]);
 assert.equal(run('new GPUSupportedLimits().maxTextureDimension2D'),4096);
 assert.equal(run('new GPUSupportedLimits().minUniformBufferOffsetAlignment'),128);
 assert.equal(run('const f=new GPUSupportedFeatures();f.size'),1);assert.equal(run('f.has("feature-b")'),false);
 assert.equal(run('[...f].join()'),'feature-a');assert.equal(run('[...f.entries()].map(pair=>pair.join(":")).join()'),'feature-a:feature-a');
 assert.equal(run('let hits=0;const owner={};f.forEach(function(value,key,self){if(value===key&&self===f&&this===owner)hits++},owner);hits'),1);
 assert.throws(()=>run('GPUSupportedFeatures.prototype.has.call({},"feature-a")'),/brand/);
});
test('surfaces audio projection is deterministic, idempotent and bounded; silence and genuine array identity survive',()=>{
 const run=fixture([{id:'audio-fingerprint',value:{seed:'00112233445566778899aabbccddeeff',amplitude:0.00001},audioKey:'0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2)}]);
 assert.equal(run('const b=new AudioBuffer();const d=b.getChannelData(0);const first=Array.from(d);b.getChannelData(0)===d'),true);
 assert.equal(run('first.every((value,index)=>value===b.getChannelData(0)[index])'),true);
 assert.equal(run('first[0]'),0);assert.equal(run('first.some((value,index)=>index>0&&value!==Math.fround(Math.sin(index)*0.75))'),true);
 assert.equal(run('first.every((value,index)=>Math.abs(value-Math.fround(index===0?0:Math.sin(index)*0.75))<=0.00001)'),true);
 assert.throws(()=>run('AudioBuffer.prototype.getChannelData.call({},0)'),/brand/);
 assert.throws(()=>run('b.getChannelData(1)'),/channel/);
});
test('surfaces AudioBuffer copyFromChannel projects only copied frames, consistent with getChannelData and offsets',()=>{
 const run=fixture([{id:'audio-fingerprint',value:{seed:'00112233445566778899aabbccddeeff',amplitude:0.00001},audioKey:'0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2)}]);
 assert.equal(run('const b=new AudioBuffer(8);const dest=new Float32Array(10).fill(0.25);b.copyFromChannel(dest,0,4);dest.slice(4).every(value=>value===0.25)'),true);
 assert.equal(run('const data=b.getChannelData(0);dest.slice(0,4).every((value,index)=>value===data[index+4])'),true);
 assert.equal(run('const untouched=new Float32Array(4).fill(0.2);b.copyFromChannel(untouched,0,99);untouched.every(value=>value===Math.fround(0.2))'),true);
 assert.throws(()=>run('b.getChannelData({valueOf(){throw Error("must not coerce")}})'),/unavailable/);
});
test('surfaces AudioBuffer rate and duration stay native under audio-metadata (D-canvas-audio-8: page-chosen buffer rates are never rewritten)',()=>{
 const run=fixture([{id:'audio-metadata',value:{sampleRate:48000}}]);assert.equal(run('const b=new AudioBuffer(441);b.sampleRate'),44100);
 assert.equal(run('b.duration'),0.01);assert.equal(run('b.length'),441);
});
test('surfaces TextMetrics keep the native value domain: integers stay integral, float32 stays float32, other doubles scale',()=>{
 // Native values like Chromium's (float metrics, integral font ascents) plus edge cases; one getter per metric, brand checked.
 const table='{width:20,actualBoundingBoxLeft:-3,actualBoundingBoxRight:41.8505859375,fontBoundingBoxAscent:120,fontBoundingBoxDescent:Math.fround(3.1),actualBoundingBoxAscent:0.1,actualBoundingBoxDescent:-0,emHeightAscent:NaN,emHeightDescent:Infinity,hangingBaseline:"text",alphabeticBaseline:1000,ideographicBaseline:-12.5}';
 const run=fixture([{id:'canvas-text-metrics',value:{scale:1.01}}],'const table='+table+';for(const [key,value] of Object.entries(table))Object.defineProperty(TextMetrics.prototype,key,{configurable:true,get(){if(!metrics.has(this))throw new TypeError("brand");return value;}});');
 const read=key=>run('new TextMetrics().'+key);
 assert.equal(read('width'),20,'20 x 1.01 rounds back to the integer 20');assert.equal(read('fontBoundingBoxAscent'),121);assert.equal(read('alphabeticBaseline'),1010);
 assert.equal(read('actualBoundingBoxLeft'),-3);assert.ok(Object.is(read('actualBoundingBoxDescent'),-0));
 for(const key of ['width','actualBoundingBoxLeft','fontBoundingBoxAscent','alphabeticBaseline'])assert.equal(Number.isInteger(read(key)),true,key);
 assert.equal(read('actualBoundingBoxRight'),Math.fround(41.8505859375*1.01));assert.equal(read('fontBoundingBoxDescent'),Math.fround(Math.fround(3.1)*1.01));
 assert.equal(read('ideographicBaseline'),Math.fround(-12.5*1.01));
 for(const key of ['actualBoundingBoxRight','fontBoundingBoxDescent','ideographicBaseline']){const value=read(key);assert.equal(Math.fround(value),value,key+' round-trips through float32');assert.notEqual(value,run('table.'+key),key+' moved');}
 assert.equal(read('actualBoundingBoxAscent'),0.1*1.01,'a double that is not float32 scales as before');
 assert.ok(Number.isNaN(read('emHeightAscent')));assert.equal(read('emHeightDescent'),Infinity);assert.equal(read('hangingBaseline'),'text');
 assert.throws(()=>run('Object.getOwnPropertyDescriptor(TextMetrics.prototype,"width").get.call({})'),/brand/);
});
test('surfaces font policy applies actual selected font before draw, not fabricated font availability',()=>{
 const run=fixture([{id:'canvas-font-policy',value:{families:['Allowed'],fallback:'sans-serif'}}]);
 assert.equal(run('const c=new CanvasRenderingContext2D();c.font="16px Secret, monospace";c.font'),'16px monospace');
 assert.equal(run('c.font="20px Allowed";c.font'),'20px Allowed');assert.equal(run('c.font="14px Secret";c.font'),'14px sans-serif');
 assert.equal(run('counts.fontSet'),6);assert.throws(()=>run('Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype,"font").set.call({},"12px X")'),/brand/);
});
test('surfaces clock precision quantizes now/Date/RAF while retaining native callback identity and handle semantics',()=>{
 const run=fixture([{id:'clock-precision',value:{resolutionMs:10}}]);assert.equal(run('performance.now()'),120);assert.equal(run('Date.now()%10'),0);
 assert.equal(run('let observed;const owner={};requestAnimationFrame(function(stamp){observed=[stamp,this]})'),99);
 run('rafCallback.call(owner,123.75)');assert.equal(run('observed[0]'),120);assert.equal(run('observed[1]===owner'),true);
 assert.throws(()=>run('requestAnimationFrame(null)'),/callback/);
});

test('Date precision retains integral milliseconds and ordered negative/positive epochs for fractional resolutions',()=>{
 for(const resolutionMs of [.1,.5,1.1,1.5,7,1000]){
  const run=fixture([{id:'clock-precision',value:{resolutionMs}}], 'globalThis.dateInput=0;globalThis.dateCalls=0;Date.now=function(){dateCalls++;return dateInput}');
  const inputs=[-10001,-1000,-8,-2,-1,0,1,2,7,8,1000,10001,1793440123457];let prior=-Infinity;
  for(const input of inputs){
   const output=run('dateInput='+input+';Date.now()');
   assert.equal(Number.isInteger(output),true,resolutionMs+': integral Date timestamp');
   assert.ok(output>=prior&&output<=input,resolutionMs+': ordered, never future');
   assert.ok(input-output<Math.max(1,Math.ceil(resolutionMs)),resolutionMs+': bounded precision');prior=output;
  }
  assert.equal(run('dateCalls'),inputs.length,'one native invocation per Date call');
  run('guard.stop()');assert.equal(run('dateInput=123;Date.now()'),123);
 }
});

test('fractional clock resolution keeps sub-millisecond Performance and RAF values',()=>{
 const run=fixture([{id:'clock-precision',value:{resolutionMs:.5}}]);
 assert.equal(run('performance.now()'),123.5);run('globalThis.clockStamp=null;requestAnimationFrame(value=>clockStamp=value);rafCallback(123.75)');
 assert.equal(run('clockStamp'),123.5);
});
test('surfaces feature exposure removes only chosen existing configurable APIs',()=>{
 const run=fixture([{id:'browser-surface',value:{disabledGlobals:['SharedArrayBuffer'],chrome:'hidden'}}]);assert.equal(run('typeof SharedArrayBuffer'),'undefined');assert.equal(run('typeof chrome'),'undefined');
 run('guard.stop()');assert.equal(run('typeof SharedArrayBuffer'),'function');assert.equal(run('typeof chrome'),'object');
});
test('surfaces stopped retained methods delegate native and never overwrite a later owner',()=>{
 const run=fixture([{id:'webgl-capabilities',value:{parameters:{MAX_TEXTURE_SIZE:4096}}}]);
 run('const retained=WebGLRenderingContext.prototype.getParameter;const next=function(){return 7};WebGLRenderingContext.prototype.getParameter=next;guard.stop();guard.stop()');
 assert.equal(run('WebGLRenderingContext.prototype.getParameter===next'),true);assert.equal(run('retained.call(new WebGLRenderingContext(),3379)'),8192);
});
test('surfaces installers are standalone serialized and do not fabricate absent interfaces',()=>{
 const run=fixture([{id:'webgpu-capabilities',value:{features:[]}}]);assert.equal(run('typeof GPU'),'undefined');assert.equal(run('guard.snapshot().installed>0'),true);
});
test('surfaces stop during native argument coercion preserves the completed native result',()=>{
 const run=fixture([{id:'webgl-capabilities',value:{parameters:{MAX_TEXTURE_SIZE:4096}}}]);
 assert.equal(run('new WebGLRenderingContext().getParameter({valueOf(){guard.stop();return 3379}})'),8192);
});
test('surfaces deferred calls attribute unsupported arguments to their selected entry',()=>{
 const run=fixture([{id:'audio-fingerprint',value:{seed:'00112233445566778899aabbccddeeff',amplitude:0.00001},audioKey:'0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2)},{id:'webgl-capabilities',value:{parameters:{MAX_TEXTURE_SIZE:4096}}}]);
 const before=run('guard.snapshot().entries.find(row=>row.id==="audio-fingerprint").unavailable');
 assert.throws(()=>run('new AudioBuffer().getChannelData({})'),/unavailable/);
 assert.equal(run('guard.snapshot().entries.find(row=>row.id==="audio-fingerprint").unavailable'),before+1);
});
test('surfaces GL capability ranges intersect actual minimum and maximum; impossible selected ranges are withheld',()=>{
 const run=fixture([{id:'webgl-capabilities',value:{parameters:{ALIASED_LINE_WIDTH_RANGE:[0,4]}}}]);
 assert.equal(run('[...new WebGLRenderingContext().getParameter(33902)].join()'),'1,4');
 const denied=fixture([{id:'webgl-capabilities',value:{parameters:{ALIASED_LINE_WIDTH_RANGE:[20,40]}}}]);
 assert.throws(()=>denied('new WebGLRenderingContext().getParameter(33902)'),/unavailable/);
});
