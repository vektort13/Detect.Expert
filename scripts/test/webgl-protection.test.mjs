// WebGL ON: native-driven WebIDL conversion, no resource allocation or raw result fallback.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {installProtection} from '../../apps/production-extension/protection-runtime.js';

function fixture(){
  const instances=new WeakMap(),calls=[],invalid=new TypeError('native receiver'),missing=new TypeError('native required name'),symbol=new TypeError('native DOMString Symbol'),enumeration=new TypeError('native enum');
  function getContext(receiver,args,offscreen){
    const state=instances.get(receiver);if(!state)throw invalid;if(!args.length)throw missing;
    calls.push({receiver,args:[...args]});
    if(typeof args[0]==='symbol')throw symbol;
    const name=String(args[0]);
    if(offscreen&&!['2d','bitmaprenderer','webgl','webgl2','webgpu'].includes(name))throw enumeration;
    if(!['2d','bitmaprenderer','webgl','webgl2','experimental-webgl'].includes(name))return null;
    if(state.context)return state.name===name?state.context:null;
    if(args[1]&&typeof args[1]==='object')void args[1].alpha;
    state.name=name;state.context={name,native:true};return state.context;
  }
  class HTMLCanvasElement{constructor(){instances.set(this,{});}getContext(){return getContext(this,arguments,false);}}
  class OffscreenCanvas{constructor(){instances.set(this,{});}getContext(){return getContext(this,arguments,true);}}
  const realm={HTMLCanvasElement,OffscreenCanvas},native=HTMLCanvasElement.prototype.getContext,guard=installProtection(realm,'webgl');
  return{realm,native,guard,calls,instances,invalid,missing,symbol,enumeration};
}

test('WebGL primitive names, String objects and native-driven coercion deny before allocation and preserve 2d fallback',()=>{
  const f=fixture();
  for(const name of ['webgl','webgl2','experimental-webgl'])for(const kind of ['primitive','String','custom','function']){
    const canvas=new f.realm.HTMLCanvasElement();let reads=0,options=0;
    const value=kind==='primitive'?name:kind==='String'?new String(name):kind==='function'?Object.assign(function(){},{[Symbol.toPrimitive](hint){assert.equal(hint,'string');reads++;return name;}}):{toString(){assert.equal(this,value);reads++;return name;}};
    const before=f.calls.length;assert.equal(canvas.getContext(value,{get alpha(){options++;throw Error('unread');}}),null);
    assert.equal(f.calls.length,before+1);assert.equal(reads,kind==='custom'||kind==='function'?1:0);assert.equal(options,0);assert.equal(f.instances.get(canvas).context,undefined);
    assert.equal(canvas.getContext('2d').native,true,'blocked WebGL never commits the canvas to a GL context');
  }
  assert.equal(f.guard.snapshot().blocked,12);
});

test('Offscreen valid WebGL names deny without creation; unsupported aliases keep native enum errors',()=>{
  const f=fixture();
  for(const name of ['webgl','webgl2'])for(const value of [name,new String(name),{[Symbol.toPrimitive](){return name;}}]){
    const canvas=new f.realm.OffscreenCanvas();assert.equal(canvas.getContext(value),null);assert.equal(f.instances.get(canvas).context,undefined);assert.equal(canvas.getContext('bitmaprenderer').native,true);
  }
  assert.throws(()=>new f.realm.OffscreenCanvas().getContext('experimental-webgl'),error=>error===f.enumeration);
  assert.throws(()=>new f.realm.OffscreenCanvas().getContext({toString(){return 'experimental-webgl';}}),error=>error===f.enumeration);
});

test('native receiver, missing argument, Symbol and caller exception ordering survive the private conversion abort',()=>{
  const f=fixture();let reads=0;const input={toString(){reads++;return 'webgl';}};
  assert.throws(()=>f.realm.HTMLCanvasElement.prototype.getContext.call({},input),error=>error===f.invalid);assert.equal(reads,0);
  assert.throws(()=>f.realm.HTMLCanvasElement.prototype.getContext.call({},'webgl'),error=>error===f.invalid);
  assert.throws(()=>new f.realm.HTMLCanvasElement().getContext(),error=>error===f.missing);
  assert.throws(()=>new f.realm.HTMLCanvasElement().getContext(Symbol('webgl')),error=>error===f.symbol);
  const sentinel={native:true};assert.throws(()=>new f.realm.HTMLCanvasElement().getContext({get [Symbol.toPrimitive](){throw sentinel;}}),error=>error===sentinel);
  assert.throws(()=>new f.realm.HTMLCanvasElement().getContext({toString(){throw sentinel;}}),error=>error===sentinel);
  assert.equal(f.guard.snapshot().blocked,0);
});

test('non-WebGL contexts retain original argument receiver/coercion/options order and native result identity',()=>{
  const f=fixture(),canvas=new f.realm.HTMLCanvasElement(),events=[];
  const value={get [Symbol.toPrimitive](){events.push('primitive getter');return undefined;},toString(){assert.equal(this,value);events.push('toString');return {};},valueOf(){assert.equal(this,value);events.push('valueOf');return '2d';}};
  const options={get alpha(){events.push('alpha');return true;}};const result=canvas.getContext(value,options);
  assert.equal(result,f.instances.get(canvas).context);assert.deepEqual(events,['primitive getter','toString','valueOf','alpha']);assert.equal(f.calls.length,1);assert.equal(f.calls[0].args[1],options);assert.equal(f.guard.snapshot().blocked,0);
  const unknown=new f.realm.HTMLCanvasElement();let count=0;assert.equal(unknown.getContext({toString(){count++;return 'unsupported-context';}}),null);assert.equal(count,1);
});

test('stop preserves later page replacement; retained wrapper forwards native handles and exceptions once',()=>{
  const f=fixture(),retained=f.realm.HTMLCanvasElement.prototype.getContext,canvas=new f.realm.HTMLCanvasElement(),replacement=()=>({page:true});
  f.realm.HTMLCanvasElement.prototype.getContext=replacement;f.guard.stop();assert.equal(f.realm.HTMLCanvasElement.prototype.getContext,replacement);
  let reads=0;const result=retained.call(canvas,{toString(){reads++;return 'webgl';}});assert.equal(result,f.instances.get(canvas).context);assert.equal(result.name,'webgl');assert.equal(reads,1);assert.equal(f.calls.length,1);
});
