// ADR-100: actual serialized Custom installer, real realm-local Promise algorithms.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { test } from 'node:test';
import { types } from 'node:util';
import { installApiCustom } from '../../apps/production-extension/api-custom-runtime.js';

function fixture({ style = 'resolve', before = '', mode = 'custom', installer = null } = {}) {
  const context = vm.createContext({});
  vm.runInContext(`
    const NP=Promise,OP=Object,AP=Array,define=Object.defineProperty,descriptor=Object.getOwnPropertyDescriptor;
    const capturedTypeError=TypeError;globalThis.calls=0;
    const pristineThen=NP.prototype.then,RA=Reflect.apply;globalThis.reason=undefined;
    globalThis.collect=p=>{RA(pristineThen,p,[undefined,e=>{globalThis.reason=e;}]);};globalThis.reads=0;globalThis.coercions=0;globalThis.captured=null;
    globalThis.invalid={nativeBrand:true};globalThis.failure={nativeRejection:true};globalThis.coercionFailure={nativeCoercion:true};
    globalThis.style=${JSON.stringify(style)};globalThis.rejectNative=false;globalThis.argument={};globalThis.seenArgument=null;
    class USB {getDevices(arg){
      if(this!==receiver)throw invalid;
      calls++;seenArgument=arg;
      if(arg?.coerce)String(arg);
      const raw=[{native:true}];
      const source=rejectNative?NP.reject(failure):new NP(resolve=>{if(style==='pending')globalThis.release=()=>resolve(raw);else resolve(raw);});
      globalThis.nativeResult=source;
      if(style==='await')return(async()=>await source)();
      if(style==='then')return source.then(value=>value);
      if(style==='catch')return source.catch(error=>{throw error;});
      if(style==='finally')return source.finally(()=>{});
      if(style==='all')return NP.all([source]).then(values=>values[0]);
      if(style==='optional-try'){const helper=NP.try;return typeof helper==='function'?helper(()=>source):source;}
      return source;
    }}
    globalThis.receiver=new USB();globalThis.realm={Object,Array,Promise,USB};
    ${before}
  `, context);
  const install = installer ?? vm.runInContext('(' + installApiCustom.toString() + ')', context);
  const guard = install(context.realm, [{ id: 'usb', mode, value: [] }]);
  return { context, guard, install, run: code => vm.runInContext(code, context) };
}
const guardError = f => error => error instanceof f.run('capturedTypeError') && error.message === 'Custom asynchronous state is unavailable';
// ADR-100 + WebIDL: a refused asynchronous operation returns a rejected Promise; it never throws synchronously. Nothing here may touch a property
// of the Promise (util.inspect would run constructor/species lookups), so the rejection reason is collected through the pristine `then` only after
// the side-effect counters were read; a Promise that is not rejected with the guard error leaves `reason` undefined and fails the check.
function refused(f, code) {
  let promise;
  assert.doesNotThrow(() => { promise = f.run(code); }, 'a refusal never throws synchronously');
  assert.equal(types.isPromise(promise), true);
  return promise;
}
async function reasonOf(f, promise) {
  f.context.collect(promise); await new Promise(resolve => setImmediate(resolve));
  return { reason: f.context.reason }; // wrapped: a page-poisoned Object.prototype.then must not turn the reason into a thenable
}
const poisons = [
  ['Promise constructor getter', `define(NP.prototype,'constructor',{configurable:true,get(){reads++;captured=this;return NP;}});`],
  ['Promise resolve replacement', `NP.resolve=function(){reads++;throw failure;};`],
  ['Promise reject replacement', `NP.reject=function(){reads++;throw failure;};`],
  ['Promise all getter', `define(NP,'all',{configurable:true,get(){reads++;return undefined;}});`],
  ['Promise allSettled replacement', `NP.allSettled=function(){reads++;throw failure;};`],
  ['Promise any replacement', `NP.any=function(){reads++;throw failure;};`],
  ['Promise race replacement', `NP.race=function(){reads++;throw failure;};`],
  ['Promise withResolvers replacement', `NP.withResolvers=function(){reads++;throw failure;};`],
  ['Promise try replacement', `NP.try=function(){reads++;throw failure;};`],
  ['Promise then getter', `define(NP.prototype,'then',{configurable:true,get(){reads++;captured=this;return undefined;}});`],
  ['Promise catch getter', `define(NP.prototype,'catch',{configurable:true,get(){reads++;captured=this;return undefined;}});`],
  ['Promise finally replacement', `NP.prototype.finally=function(){reads++;captured=this;};`],
  ['Promise species getter', `define(NP,Symbol.species,{configurable:true,get(){reads++;return NP;}});`],
  ['target Promise getter', `define(realm,'Promise',{configurable:true,get(){reads++;return NP;}});`],
  ['target Promise Proxy replacement', `realm.Promise=new Proxy(function(){},{getOwnPropertyDescriptor(){reads++;throw failure;}});`],
  ['target Object getter', `define(realm,'Object',{configurable:true,get(){reads++;return OP;}});`],
  ['target Array getter', `define(realm,'Array',{configurable:true,get(){reads++;return AP;}});`],
  ['Object inherited then accessor', `define(OP.prototype,'then',{configurable:true,get(){reads++;captured=this;return undefined;}});`],
  ['Object inherited then function', `define(OP.prototype,'then',{configurable:true,value:function(){reads++;captured=this;}});`],
  ['Array inherited then accessor', `define(AP.prototype,'then',{configurable:true,get(){reads++;captured=this;return undefined;}});`],
  ['Array inherited then function', `define(AP.prototype,'then',{configurable:true,value:function(){reads++;captured=this;}});`],
  ['changed Array prototype with a then accessor', `OP.setPrototypeOf(AP.prototype,{get then(){reads++;captured=this;}});`],
  ['changed Array prototype to a Proxy', `OP.setPrototypeOf(AP.prototype,new Proxy({}, {getOwnPropertyDescriptor(){reads++;throw failure;},get(){reads++;throw failure;}}));`],
];

for (const style of ['resolve', 'await', 'then', 'catch', 'finally', 'all']) test('clean internal ' + style + ' chain remains functional with one original call', async () => {
  const f = fixture({ style });
  const value = await f.run('receiver.getDevices(argument)');
  assert.equal(Array.isArray(value), true); assert.equal(value.length, 0);
  assert.equal(f.context.calls, 1); assert.equal(f.context.seenArgument, f.context.argument);
});

for (const [name, poison] of poisons) test('unsafe ' + name + ' is rejected without getter/trap/backend execution', async () => {
  const f = fixture(); f.run(poison);
  const promise = refused(f, 'receiver.getDevices(argument)');
  assert.equal(f.context.calls, 0); assert.equal(f.context.reads, 0); assert.equal(f.context.captured, null);
  assert.equal(f.guard.snapshot().unavailable, 1);
  assert.equal(guardError(f)((await reasonOf(f, promise)).reason), true);
});

test('clean native invalid receiver, exact coercion throw and rejection reasons survive', async () => {
  const f = fixture();
  assert.throws(() => f.run('Reflect.apply(USB.prototype.getDevices,{},[argument])'), error => error === f.context.invalid);
  assert.throws(() => f.run('receiver.getDevices({coerce:true,toString(){coercions++;throw coercionFailure;}})'), error => error === f.context.coercionFailure);
  assert.equal(f.context.coercions, 1);
  f.run('rejectNative=true;');
  await assert.rejects(f.run('receiver.getDevices(argument)'), error => error === f.context.failure);
  assert.equal(f.context.calls, 2);
});

test('unsafe preflight has explicit precedence over native receiver and argument conversion', async () => {
  const f = fixture(); f.run(poisons[0][1]);
  const promise = refused(f, 'Reflect.apply(USB.prototype.getDevices,{},[{coerce:true,toString(){coercions++;throw coercionFailure;}}])');
  assert.equal(f.context.calls, 0); assert.equal(f.context.coercions, 0); assert.equal(f.context.reads, 0);
  assert.equal(guardError(f)((await reasonOf(f, promise)).reason), true);
});

test('stopped retained wrapper preserves native Promise identity even when the boundary is unsafe', async () => {
  const f = fixture(); f.run('globalThis.retained=receiver.getDevices;'); f.guard.stop();
  f.run(poisons[0][1]);
  const returned = f.run('globalThis.result=Reflect.apply(retained,receiver,[argument]);result');
  assert.equal(returned, f.context.nativeResult); assert.equal(f.context.calls, 1);
  f.run(`define(NP.prototype,'constructor',{configurable:true,writable:true,value:NP});`);
  const value = await returned; assert.equal(value[0].native, true);
});

for (const mode of ['off', 'bypass']) test(mode + ' keeps the native operation and error semantics despite unsafe state', async () => {
  const f = fixture({ mode }); f.run(poisons[0][1]);
  const returned = f.run('receiver.getDevices(argument)'); assert.equal(returned, f.context.nativeResult);
  assert.throws(() => f.run('Reflect.apply(receiver.getDevices,{},[])'), error => error === f.context.invalid);
  f.run(`define(NP.prototype,'constructor',{configurable:true,writable:true,value:NP});`);
  assert.equal((await returned)[0].native, true); assert.equal(f.context.calls, 1);
});

test('pending native settlement established before mutation survives without a second backend call', async () => {
  const f = fixture({ style: 'pending' }), returned = f.run('receiver.getDevices(argument)');
  f.run(poisons[0][1]); f.guard.stop(); f.run('release();');
  f.run(`define(NP.prototype,'constructor',{configurable:true,writable:true,value:NP});`);
  assert.equal((await returned)[0].native, true); assert.equal(f.context.calls, 1);
});

test('first unsafe effective then capture is not evaluated or repaired', async () => {
  const f = fixture({ before: `define(OP.prototype,'then',{configurable:true,get(){reads++;return undefined;}});` });
  assert.equal(f.context.reads, 0);
  const promise = refused(f, 'receiver.getDevices(argument)');
  assert.equal(f.context.calls, 0); assert.equal(f.context.reads, 0);
  assert.equal(f.run(`typeof descriptor(OP.prototype,'then').get==='function'`), true);
  assert.equal(guardError(f)((await reasonOf(f, promise)).reason), true);
});

test('safe descriptor hardening retains data identities and does not disable a clean operation', async () => {
  const f = fixture(); f.run(`for(const [target,key]of[[NP.prototype,'constructor'],[NP,'resolve'],[NP.prototype,'then'],[NP.prototype,'catch'],[NP.prototype,'finally']])define(target,key,{...descriptor(target,key),writable:false,configurable:false});`);
  assert.equal((await f.run('receiver.getDevices(argument)')).length, 0); assert.equal(f.context.calls, 1);
});

test('per-target boundary rejects poisoned child globals without touching parent or replacement traps', async () => {
  const parent = fixture(), child = fixture({ installer: parent.install });
  child.run(`realm.Promise=new Proxy(function(){},{getOwnPropertyDescriptor(){reads++;throw failure;}});`);
  const promise = refused(child, 'receiver.getDevices(argument)');
  assert.equal(child.context.reads, 0); assert.equal(child.context.calls, 0);
  assert.equal((await reasonOf(child, promise)).reason instanceof parent.run('capturedTypeError'), true);
  assert.equal(parent.run('NP.prototype.constructor===NP&&NP.prototype.then===descriptor(NP.prototype,"then").value'), true);
});

test('parent Promise/Object poisoning does not become a false child-backend observation', async () => {
  const parent = fixture(), child = fixture({ installer: parent.install });
  parent.run(poisons[0][1] + poisons.find(([name]) => name === 'Object inherited then accessor')[1]);
  const returned = child.run('receiver.getDevices(argument)');
  parent.run(`define(NP.prototype,'constructor',{configurable:true,writable:true,value:NP});delete OP.prototype.then;`);
  assert.equal((await returned).length, 0); assert.equal(child.context.calls, 1); assert.equal(parent.context.reads, 0);
});

test('missing target Promise becomes unavailable without synthesizing a global or backend success', async () => {
  const f = fixture({ before: 'delete realm.Promise;' });
  const promise = refused(f, 'receiver.getDevices(argument)');
  assert.equal(f.context.calls, 0); assert.equal(Object.hasOwn(f.context.realm, 'Promise'), false);
  assert.equal(guardError(f)((await reasonOf(f, promise)).reason), true);
});

test('missing optional Promise statics stay absent, while a later added replacement is refused', async () => {
  const f = fixture({ before: 'delete NP.try;delete NP.withResolvers;' });
  assert.equal((await f.run('receiver.getDevices(argument)')).length, 0);
  assert.equal(f.run(`descriptor(NP,'try')===undefined&&descriptor(NP,'withResolvers')===undefined`), true);
  f.run('NP.try=function(){reads++;throw failure;};');
  const promise = refused(f, 'receiver.getDevices(argument)');
  assert.equal(f.context.calls, 1); assert.equal(f.context.reads, 0);
  assert.equal(guardError(f)((await reasonOf(f, promise)).reason), true);
});

test('a missing optional static cannot gain an inherited getter or callback capability before backend entry', async () => {
  const f = fixture({ style: 'optional-try', before: 'delete NP.try;' });
  f.run(`define(OP.getPrototypeOf(NP),'try',{configurable:true,get(){reads++;return function(callback){captured=callback();return captured;};}});`);
  const promise = refused(f, 'receiver.getDevices(argument)');
  assert.equal(f.context.calls, 0); assert.equal(f.context.reads, 0); assert.equal(f.context.captured, null);
  assert.equal(f.run(`descriptor(NP,'try')===undefined`), true, 'the guard never creates the missing native static');
  assert.equal(guardError(f)((await reasonOf(f, promise)).reason), true);
});

test('changed optional-static inheritance is rejected without probing a replacement Proxy', async () => {
  const f = fixture({ before: 'delete NP.withResolvers;' });
  f.run(`OP.setPrototypeOf(NP,new Proxy(OP.getPrototypeOf(NP),{getOwnPropertyDescriptor(){reads++;throw failure;},get(){reads++;throw failure;}}));`);
  const promise = refused(f, 'receiver.getDevices(argument)');
  assert.equal(f.context.calls, 0); assert.equal(f.context.reads, 0);
  assert.equal(guardError(f)((await reasonOf(f, promise)).reason), true);
});

test('documented limit: native argument coercion can mutate the boundary after preflight', async () => {
  const f = fixture({ style: 'await' });
  const returned = f.run(`receiver.getDevices({coerce:true,toString(){
    coercions++;define(NP.prototype,'constructor',{configurable:true,get(){reads++;if(!captured)captured=this;return NP;}});return 'native conversion';
  }})`);
  assert.equal(f.context.calls, 1); assert.equal(f.context.coercions, 1); assert.equal(f.context.reads, 1);
  assert.equal(f.context.captured, f.context.nativeResult, 'this synthetic native-internal Promise is outside the pre-call proof');
  f.run(`define(NP.prototype,'constructor',{configurable:true,writable:true,value:NP});`);
  assert.equal((await f.context.captured)[0].native, true);
  assert.equal((await returned).length, 0, 'a selected final result does not close earlier internal exposure');
});
