// Synthetic pipeline/driver state, actual serialized production installer.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../apps/production-extension/api-custom-surfaces-runtime.js', import.meta.url), 'utf8').replace(/^export /m, '');
function fixture(setup = '') {
  const context = vm.createContext({ DOMException });
  vm.runInContext(`
    const brands=new WeakMap();globalThis.calls={read:0,query:0,lost:0,error:0,traps:0};
    globalThis.reason=new TypeError('Synthetic native WebGL brand'),thrown={};
    function data(receiver,webgl2){const d=brands.get(receiver);if(!d||d.webgl2!==webgl2)throw reason;return d;}
    function makeClass(webgl2){return class {
      constructor(){brands.set(this,{webgl2,width:16,height:16,alignment:8,rowLength:0,skipRows:0,skipPixels:0,framebuffer:null,pbo:null,readBuffer:1029,format:6408,type:5121,lost:false,noWrite:false,loseAfter:false,throwRead:false});}
      get drawingBufferWidth(){return data(this,webgl2).width;}get drawingBufferHeight(){return data(this,webgl2).height;}
      isContextLost(){calls.lost++;return data(this,webgl2).lost;}
      getParameter(name){calls.query++;const d=data(this,webgl2);
        if(name===3333)return d.alignment;if(name===35739)return d.format;if(name===35738)return d.type;
        if(name===(webgl2?36010:36006))return d.framebuffer;
        if(webgl2){if(name===35053)return d.pbo;if(name===3074)return d.readBuffer;if(name===3330)return d.rowLength;if(name===3331)return d.skipRows;if(name===3332)return d.skipPixels;}
        throw reason;
      }
      getError(){calls.error++;return 1286;}
      readPixels(x,y,width,height,format,type,destination,offset=0){
        const d=data(this,webgl2);calls.read++;globalThis.actualDestination=destination;globalThis.actualArguments=arguments;globalThis.actualReceiver=this;
        if(d.throwRead)throw thrown;if(d.noWrite)return;
        const rowPixels=d.rowLength||width,stride=Math.ceil(rowPixels*4/d.alignment)*d.alignment,start=offset+d.skipRows*stride+d.skipPixels*4;
        for(let row=0;row<height;row++)for(let pixel=0;pixel<width;pixel++){
          const at=start+row*stride+pixel*4;destination[at]=d.rgba?.[0]??100;destination[at+1]=d.rgba?.[1]??110;destination[at+2]=d.rgba?.[2]??120;destination[at+3]=d.rgba?.[3]??255;
        }
        if(d.loseAfter)d.lost=true;
      }
    };}
    globalThis.WebGLRenderingContext=makeClass(false);globalThis.WebGL2RenderingContext=makeClass(true);
    globalThis.gl=new WebGLRenderingContext(),gl2=new WebGL2RenderingContext();
    globalThis.config=brands.get(gl);globalThis.config2=brands.get(gl2);
    globalThis.realm={WebGLRenderingContext,WebGL2RenderingContext,origin:'https://top.example'};
    ${setup}
    ${source}
    // ADR-107: webgl-readback alone is keyed by the private entry.webglKey (sparse-rgb-v1 of the Canvas runtime).
    globalThis.guard=installSurfaceCustom(realm,[{id:'webgl-readback',mode:'custom',value:{seed:'00000000000000000000000000000000'},webglKey:'fedcba9876543210'.repeat(4)}]);
  `, context);
  return { run: code => vm.runInContext(code, context) };
}
const denied = (f, code) => assert.throws(() => f.run(code), error => error.name === 'SecurityError');

test('GL readback: private native destination once, alignment8 padding and alpha preserved, both rows projected', () => {
  const f = fixture();
  f.run('globalThis.bytes=new Uint8Array(20).fill(51);gl.readPixels(0,0,1,2,6408,5121,bytes);');
  assert.equal(f.run('calls.read'), 1);assert.equal(f.run('actualDestination===bytes'), false);
  assert.equal(f.run('actualReceiver===gl'), true);assert.equal(f.run('bytes[3]===255&&bytes[11]===255'), true);
  assert.equal(f.run('bytes.slice(4,8).every(v=>v===51)&&bytes.slice(12).every(v=>v===51)'), true);
  assert.equal(f.run('[0,1,2,8,9,10].every((at,index)=>Math.abs(bytes[at]-[100,110,120][index%3])<=1)'), true);
  assert.equal(f.run('calls.error'), 0);
});

test('GL readback: overlapping rectangles and separate rows return the same framebuffer pixels', () => {
  const f=fixture();
  f.run('globalThis.full=new Uint8Array(64);gl.readPixels(0,0,4,4,6408,5121,full);globalThis.roi=new Uint8Array(8);gl.readPixels(1,2,2,1,6408,5121,roi)');
  assert.equal(f.run('roi.every((value,index)=>value===full[36+index])'),true);
  f.run('globalThis.rowBytes=new Uint8Array(16);gl.readPixels(0,2,4,1,6408,5121,rowBytes)');
  assert.equal(f.run('rowBytes.every((value,index)=>value===full[32+index])'),true);
  assert.equal(f.run('calls.read'),3);assert.equal(f.run('calls.error'),0);
});

test('GL readback: fully transparent black remains black and alpha is preserved', () => {
  const f=fixture();f.run('config.rgba=[0,0,0,0];globalThis.bytes=new Uint8Array(16).fill(51);gl.readPixels(0,0,2,2,6408,5121,bytes)');
  assert.equal(f.run('bytes.every(value=>value===0)'),true);assert.equal(f.run('calls.read'),1);
});

test('GL readback: transparent and translucent pixels stay exactly native, like the Canvas projection; every opaque pixel of a small buffer moves one level', () => {
  // ADR-107: only alpha-255 pixels move (a cleared buffer no longer has 38% of its bytes flipped), so premultiplied data stays valid.
  for (const rgba of [[100,110,120,0],[100,100,100,100],[20,30,40,200],[255,255,255,254],[0,0,0,1]]) {
    const f=fixture();f.run(`config.rgba=${JSON.stringify(rgba)};globalThis.full=new Uint8Array(64);gl.readPixels(0,0,4,4,6408,5121,full)`);
    assert.equal(f.run(`full.every((value,index)=>value===${JSON.stringify(rgba)}[index&3])`),true,rgba.join());
    assert.equal(f.run('calls.read'),1);assert.equal(f.run('calls.error'),0);
  }
  const f=fixture();f.run('config.rgba=[100,110,120,255];globalThis.opaque=new Uint8Array(64);gl.readPixels(0,0,4,4,6408,5121,opaque)');
  // 16x16 = 256 pixels: sparse-rgb-v1 draws one byte per pixel, so each opaque pixel has exactly one channel one level away.
  assert.equal(f.run('[0,4,8,12].every(pixel=>opaque[pixel*4+3]===255&&[0,1,2].filter(channel=>opaque[pixel*4+channel]!==[100,110,120][channel]).length===1&&[0,1,2].every(channel=>Math.abs(opaque[pixel*4+channel]-[100,110,120][channel])<=1))'),true);
});

test('GL readback: coordinate hashing stays exact up to 2^30 drawing-buffer pixels; larger sparse buffers are denied before the native read', () => {
  const f=fixture();f.run('config.width=32768;config.height=32768;config.alignment=4;globalThis.full=new Uint8Array(16);gl.readPixels(1,4194,4,1,6408,5121,full);globalThis.roi=new Uint8Array(8);gl.readPixels(2,4194,2,1,6408,5121,roi)');
  assert.equal(f.run('roi.every((value,index)=>value===full[4+index])'),true);
  assert.equal(f.run('calls.read'),2);assert.equal(f.run('calls.error'),0);
  const huge=fixture();huge.run('config.width=2147483647;config.height=2147483647;');
  denied(huge,'gl.readPixels(1,4194305,4,1,6408,5121,new Uint8Array(16))');assert.equal(huge.run('calls.read'),0);
});

test('GL readback: without a usable private key or origin every read fails closed before the native call', () => {
  for (const setup of ['delete realm.origin;', 'realm.origin="";']) {
    const f=fixture(setup);denied(f,'gl.readPixels(0,0,1,1,6408,5121,new Uint8Array(4))');assert.equal(f.run('calls.read'),0);
  }
  const context=vm.createContext({DOMException});
  vm.runInContext(`${source};globalThis.calls=0;class WebGLRenderingContext{readPixels(){calls++;}getParameter(){return null;}isContextLost(){return false;}get drawingBufferWidth(){return 1;}get drawingBufferHeight(){return 1;}}
    globalThis.guard=installSurfaceCustom({WebGLRenderingContext,origin:'https://top.example'},[{id:'webgl-readback',mode:'custom',value:{seed:'00000000000000000000000000000000'}}]);globalThis.gl=new WebGLRenderingContext();`,context);
  assert.throws(()=>vm.runInContext('gl.readPixels(0,0,1,1,6408,5121,new Uint8Array(4))',context),error=>error.name==='SecurityError');
  assert.equal(vm.runInContext('calls',context),0);assert.ok(vm.runInContext('guard.snapshot().unavailable',context)>=2,'missing key counted at install and per call');
});

test('GL2 readback: row length/skip/dstOffset target only addressed pixels inside a nonzero-offset view', () => {
  const f = fixture();
  f.run(`config2.rowLength=4;config2.skipRows=1;config2.skipPixels=1;
    globalThis.backing=new Uint8Array(100).fill(51);globalThis.bytes=new Uint8Array(backing.buffer,5,64);
    gl2.readPixels(0,0,2,2,6408,5121,bytes,3);`);
  assert.equal(f.run('calls.read'), 1);assert.equal(f.run('actualArguments[7]'), 3);
  assert.equal(f.run('actualDestination===bytes'), false);
  assert.equal(f.run(`backing.every((v,i)=>{const p=i-5;return p>=23&&p<31||p>=39&&p<47?true:v===51;})`), true);
  assert.equal(f.run('[26,30,42,46].every(at=>bytes[at]===255)'), true);
  assert.equal(f.run('calls.error'), 0);
});

test('GL readback: native no-write and context loss after read leave caller bytes unchanged without consuming errors', () => {
  for (const option of ['noWrite', 'loseAfter']) {
    const f = fixture();f.run(`config.${option}=true;globalThis.bytes=new Uint8Array(12).fill(51);gl.readPixels(0,0,1,2,6408,5121,bytes);`);
    assert.equal(f.run('calls.read'), 1);assert.equal(f.run('bytes.every(v=>v===51)'), true);
    assert.equal(f.run('calls.error'), 0);assert.ok(f.run('guard.snapshot().unavailable') >= 1);
  }
});

test('GL readback: unsupported state/geometry/buffer fails before native read', () => {
  const configurations = ['config.framebuffer={}', 'config.format=6407', 'config.type=5126', 'config.alignment=3', 'config.lost=true', 'config2.pbo={}', 'config2.readBuffer=0', 'config2.rowLength=1;config2.skipPixels=1'];
  for (const setup of configurations) {
    const f = fixture();f.run(`${setup};globalThis.bytes=new Uint8Array(64).fill(51);`);
    denied(f, `${setup.includes('config2') ? 'gl2' : 'gl'}.readPixels(0,0,1,1,6408,5121,bytes)`);
    assert.equal(f.run('calls.read'), 0);assert.equal(f.run('bytes.every(v=>v===51)'), true);assert.equal(f.run('calls.error'), 0);
  }
  for (const code of [
    'gl.readPixels(-1,0,1,1,6408,5121,new Uint8Array(4))',
    'gl.readPixels(0,0,17,1,6408,5121,new Uint8Array(128))',
    'gl.readPixels(0,0,1,2,6408,5121,new Uint8Array(8))',
    'gl.readPixels(0,0,1,1,6408,5121,0)',
    'gl.readPixels(0,0,1,1,6408,5121,new Uint8Array(new SharedArrayBuffer(4)))',
    'gl2.readPixels(0,0,1,1,6408,5121,new Uint8Array(4),16777216)',
    'gl.readPixels(0,0,1,1,6408,5121,new Uint8Array(4),0)',
  ]) { const f = fixture();denied(f, code);assert.equal(f.run('calls.read'), 0); }
});

test('GL readback: opaque geometry/Proxy view never runs page traps or conversions; native receiver errors preserved', () => {
  const f = fixture();
  denied(f, 'gl.readPixels({valueOf(){calls.traps++;throw thrown;}},0,1,1,6408,5121,new Uint8Array(4))');
  denied(f, 'gl.readPixels(0,0,1,1,6408,5121,new Proxy(new Uint8Array(4),new Proxy({}, {get(){calls.traps++;throw thrown;}})))');
  assert.equal(f.run('calls.traps'), 0);assert.equal(f.run('calls.read'), 0);
  assert.throws(() => f.run('Reflect.apply(gl.readPixels,{},[0,0,1,1,6408,5121,new Uint8Array(4)])'), e => e === f.run('reason'));
  assert.throws(() => f.run('new gl.readPixels()'), e => e.name === 'TypeError');
  assert.equal(f.run('calls.read'), 0);
});

test('GL readback: original throw identity, conservative all-sentinel/no-write and missing readonly guard', () => {
  const f = fixture();f.run('config.throwRead=true;globalThis.bytes=new Uint8Array(4).fill(51);');
  assert.throws(() => f.run('gl.readPixels(0,0,1,1,6408,5121,bytes)'), e => e === f.run('thrown'));
  assert.equal(f.run('bytes.every(v=>v===51)'), true);assert.equal(f.run('calls.read'), 1);
  const missing = fixture('delete WebGLRenderingContext.prototype.isContextLost;');
  denied(missing, 'gl.readPixels(0,0,1,1,6408,5121,new Uint8Array(4))');assert.equal(missing.run('calls.read'), 0);
});

test('GL readback: stop retained wrapper delegates native original with caller destination and newer owner survives', () => {
  const f = fixture();
  f.run('globalThis.saved=gl.readPixels;guard.stop();globalThis.bytes=new Uint8Array(4).fill(51);Reflect.apply(saved,gl,[0,0,1,1,6408,5121,bytes]);');
  assert.equal(f.run('calls.read'), 1);assert.equal(f.run('actualDestination===bytes'), true);assert.equal(f.run('calls.query+calls.lost'), 0);
  assert.equal(f.run('bytes[0]===100&&bytes[1]===110&&bytes[2]===120'), true);
  const next = fixture();next.run(`Object.defineProperty(WebGLRenderingContext.prototype,'readPixels',{configurable:true,value(){return 123;}});guard.stop();`);
  assert.equal(next.run('gl.readPixels()'), 123);
});
