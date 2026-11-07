import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installApiCustom } from '../../apps/production-extension/api-custom-runtime.js';

function fixture() {
 const context=vm.createContext({});
 vm.runInContext(`
  const NP=Promise;globalThis.calls={decoding:0,encoding:0,enumerate:0,capabilities:0,getters:0,external:0};
  globalThis.failure=new TypeError('native receiver');globalThis.rejection={nativeRejection:true};globalThis.reject=false;globalThis.argument={};
  class MediaKeySystemAccess {get nestedGetter(){calls.getters++;throw failure;}createMediaKeys(){if(this!==handle)throw failure;return 'native keys';}}
  globalThis.handle=new MediaKeySystemAccess();globalThis.configuration={type:'file',video:{contentType:'video/mp4',width:1280}};globalThis.future={native:true};globalThis.symbol=Symbol('native optional data');
  globalThis.nativeInfo=Object.create({get inherited(){calls.getters++;throw failure;}});
  Object.assign(nativeInfo,{configuration,supported:true,keySystemAccess:handle,smooth:true,powerEfficient:true,futureHint:future});
  Object.defineProperty(nativeInfo,symbol,{value:future,enumerable:true});
  Object.defineProperty(nativeInfo,'dangerousAccessor',{enumerable:true,get(){calls.getters++;throw failure;}});
  Object.defineProperty(nativeInfo,'__proto__',{value:{polluted:true},enumerable:true});
  class MediaCapabilities {
   decodingInfo(arg){if(this!==media)throw failure;calls.decoding++;globalThis.lastArgument=arg;return reject?NP.reject(rejection):NP.resolve(nativeInfo);}
   encodingInfo(arg){if(this!==media)throw failure;calls.encoding++;globalThis.lastArgument=arg;return NP.resolve({supported:true,smooth:true,powerEfficient:true});}
  }
  globalThis.media=new MediaCapabilities();
  const devices=new WeakSet();
  class MediaDeviceInfo {constructor(){devices.add(this);}get deviceId(){if(!devices.has(this))throw failure;return 'native-id';}get groupId(){if(!devices.has(this))throw failure;return 'native-group';}get kind(){if(!devices.has(this))throw failure;return 'videoinput';}get label(){if(!devices.has(this))throw failure;return 'Native camera';}toJSON(){if(!devices.has(this))throw failure;return {deviceId:'native-id',groupId:'native-group',kind:'videoinput',label:'Native camera'};}}
  globalThis.width={min:16,max:3840};globalThis.height={min:16,max:2160};globalThis.frameRate={min:1,max:120};
  globalThis.nativeCapabilities={width,deviceId:'native-id',height,groupId:'native-group',frameRate,facingMode:['user'],resizeMode:['none','crop-and-scale']};
  Object.defineProperty(nativeCapabilities,'dangerousAccessor',{enumerable:true,get(){calls.getters++;throw failure;}});
  Object.defineProperty(nativeCapabilities,'__proto__',{value:{polluted:true},enumerable:true});
  class InputDeviceInfo extends MediaDeviceInfo {getCapabilities(arg){if(!devices.has(this))throw failure;calls.capabilities++;globalThis.lastArgument=arg;return nativeCapabilities;}}
  class MediaDevices {enumerateDevices(){if(this!==mediaDevices)throw failure;calls.enumerate++;return NP.resolve([device]);}}
  globalThis.device=new InputDeviceInfo();globalThis.mediaDevices=new MediaDevices();
  globalThis.entries=[{id:'media-capabilities',mode:'custom',value:{supported:false,smooth:false,powerEfficient:false}},{id:'media-enumeration',mode:'custom',value:[{deviceId:'chosen-id',groupId:'chosen-group',kind:'videoinput',label:'Chosen camera'}]}];
  Object.assign(globalThis,{MediaCapabilities,MediaDevices,MediaDeviceInfo,InputDeviceInfo});
  globalThis.postMessage=globalThis.fetch=()=>{calls.external++;throw failure;};
 `,context);
 const installer=vm.runInContext('('+installApiCustom.toString()+')',context);
 context.guard=installer(vm.runInContext('globalThis',context),context.entries);
 return {context,run:source=>vm.runInContext(source,context)};
}
test('MediaCapabilities projects only the three selected flags and retains native optional handles, configuration and key order',async()=>{
 const f=fixture(),value=await f.run('media.decodingInfo(argument)');f.context.value=value;
 assert.equal(f.run(`value.supported===false&&value.smooth===false&&value.powerEfficient===false`),true);
 assert.equal(value.keySystemAccess,f.context.handle);assert.equal(value.configuration,f.context.configuration);assert.equal(value.futureHint,f.context.future);assert.equal(value[f.context.symbol],f.context.future);
 assert.equal(f.run(`value.keySystemAccess.createMediaKeys()==='native keys'&&Object.getPrototypeOf(value)===Object.prototype`),true);
 assert.deepEqual(Reflect.ownKeys(value),['configuration','supported','keySystemAccess','smooth','powerEfficient','futureHint',f.context.symbol]);
 assert.equal(Object.hasOwn(value,'__proto__'),false);assert.equal(Object.hasOwn(value,'dangerousAccessor'),false);assert.equal(value.polluted,undefined);
 assert.equal(f.context.calls.getters,0);assert.equal(f.context.calls.external,0);assert.equal(f.context.calls.decoding,1);assert.equal(f.context.lastArgument,f.context.argument);
 value.supported=true;assert.equal((await f.run('media.decodingInfo(argument)')).supported,false);assert.equal(f.context.nativeInfo.supported,true);
});
test('MediaCapabilities preserves optional-field absence and the native method argument, receiver and rejection paths',async()=>{
 const f=fixture(),encoded=await f.run('media.encodingInfo(argument)');
 assert.deepEqual(Object.keys(encoded),['supported','smooth','powerEfficient']);assert.equal(Object.hasOwn(encoded,'keySystemAccess'),false);assert.equal(Object.hasOwn(encoded,'configuration'),false);
 assert.equal(f.context.calls.encoding,1);assert.equal(f.context.lastArgument,f.context.argument);
 assert.throws(()=>f.run('Reflect.apply(media.decodingInfo,{},[argument])'),error=>error===f.context.failure);
 f.context.reject=true;await assert.rejects(f.run('media.decodingInfo(argument)'),error=>error===f.context.rejection);
 assert.equal(f.context.calls.decoding,1);assert.equal(f.context.calls.getters,0);
});
test('InputDeviceInfo retains all native capabilities and data identities while projecting only IDs, including borrowed calls',async()=>{
 const f=fixture(),devices=await f.run('mediaDevices.enumerateDevices()');f.context.selectedDevice=devices[0];
 assert.equal(devices[0],f.context.device);assert.equal(f.run('Object.getPrototypeOf(selectedDevice)===InputDeviceInfo.prototype'),true);
 const direct=f.run('selectedDevice.getCapabilities(argument)'),borrowed=f.run('Reflect.apply(InputDeviceInfo.prototype.getCapabilities,selectedDevice,[argument])');
 for(const value of[direct,borrowed]){
  assert.equal(value.deviceId,'chosen-id');assert.equal(value.groupId,'chosen-group');
  assert.equal(value.width,f.context.width);assert.equal(value.height,f.context.height);assert.equal(value.frameRate,f.context.frameRate);
  assert.deepEqual(Object.keys(value),['width','deviceId','height','groupId','frameRate','facingMode','resizeMode']);
  assert.equal(Object.hasOwn(value,'dangerousAccessor'),false);assert.equal(Object.hasOwn(value,'__proto__'),false);f.context.value=value;assert.equal(f.run('Object.getPrototypeOf(value)===Object.prototype'),true);
 }
 assert.equal(f.context.calls.capabilities,2);assert.equal(f.context.lastArgument,f.context.argument);assert.equal(f.context.calls.getters,0);assert.equal(f.context.calls.external,0);
 assert.throws(()=>f.run('Reflect.apply(InputDeviceInfo.prototype.getCapabilities,{},[argument])'),error=>error===f.context.failure);
 assert.equal(f.context.nativeCapabilities.deviceId,'native-id');assert.equal(f.context.nativeCapabilities.groupId,'native-group');
});
test('stopping the media projection restores the exact native result and retains native capability handles',async()=>{
 const f=fixture();await f.run('mediaDevices.enumerateDevices()');f.context.guard.stop();
 assert.equal(await f.run('media.decodingInfo(argument)'),f.context.nativeInfo);assert.equal(f.run('device.getCapabilities(argument)'),f.context.nativeCapabilities);
 assert.equal(f.context.calls.getters,0);assert.equal(f.context.calls.external,0);
});
// Round 5: the installApiCustom media case (dedicated Worker bootstrap, direct installs) lowers the native answer, never raises it.
function lowering(native, value) {
  const context = vm.createContext({});
  vm.runInContext(`
    const NP = Promise; globalThis.calls = 0; globalThis.reads = 0;
    class MediaCapabilities {
      decodingInfo(arg) { calls++; globalThis.lastArgument = arg; return NP.resolve(({ ...nativeResult })); }
      encodingInfo(arg) { calls++; globalThis.lastArgument = arg; return NP.resolve(({ ...nativeResult })); }
    }
    globalThis.nativeResult = ${JSON.stringify(native)}; globalThis.MediaCapabilities = MediaCapabilities; globalThis.media = new MediaCapabilities();
    globalThis.hostile = new Proxy({}, { get() { reads++; throw new Error('page getter read'); }, ownKeys() { reads++; throw new Error('page keys read'); }, getOwnPropertyDescriptor() { reads++; throw new Error('page descriptor read'); } });
  `, context);
  const installer = vm.runInContext('(' + installApiCustom.toString() + ')', context);
  const guard = installer(vm.runInContext('globalThis', context), [{ id: 'media-capabilities', mode: 'custom', value }]);
  return { context, guard, run: source => vm.runInContext(source, context) };
}
test('Custom media flags are native AND selected: smooth and power efficiency need support, nothing is raised above the native answer', async () => {
  const booleans = [false, true];
  let rows = 0;
  for (const ns of booleans) for (const nm of booleans) for (const np of booleans) for (const cs of booleans) for (const cm of booleans) for (const cp of booleans) {
    // A browser never reports smooth or power efficient without support, and the contract keeps both false when supported is false.
    if (!cs && (cm || cp) || !ns && (nm || np)) continue;
    const f = lowering({ powerEfficient: np, smooth: nm, supported: ns, keySystemAccess: null }, { supported: cs, smooth: cm, powerEfficient: cp, hidden: [] });
    const shown = cs && ns, expected = [shown, shown && cm && nm, shown && cp && np];
    for (const method of ['decodingInfo', 'encodingInfo']) {
      const value = await f.run(`media.${method}({})`);
      assert.deepEqual([value.supported, value.smooth, value.powerEfficient], expected, method + ' ' + JSON.stringify({ ns, nm, np, cs, cm, cp }));
      assert.deepEqual(Object.keys(value), ['powerEfficient', 'smooth', 'supported', 'keySystemAccess'], 'native key order is kept');
    }
    rows++;
  }
  assert.equal(rows, 5 * 5, 'every native answer a browser can give against every valid custom preset');
});
test('a Custom true on a native false stays false and an unreadable native flag is never raised', async () => {
  const f = lowering({ supported: false, smooth: false, powerEfficient: false }, { supported: true, smooth: true, powerEfficient: true, hidden: [] });
  const value = await f.run('media.decodingInfo({})');
  assert.deepEqual([value.supported, value.smooth, value.powerEfficient], [false, false, false]);
  const odd = lowering({ supported: 'yes', smooth: 1, powerEfficient: null }, { supported: true, smooth: true, powerEfficient: true, hidden: [] });
  const lowered = await odd.run('media.decodingInfo({})');
  assert.deepEqual([lowered.supported, lowered.smooth, lowered.powerEfficient], [false, false, false]);
});
test('the Worker path applies the flag algebra only: hidden families are not read from the page argument', async () => {
  // The native conversion already read the page dictionary once; this path never reads it again (a second read would run page
  // code), so a hidden family cannot be matched here. The Window bridge and the private backend apply it.
  const f = lowering({ supported: true, smooth: true, powerEfficient: true }, { supported: true, smooth: true, powerEfficient: true, hidden: ['h264'] });
  const value = await f.run('media.decodingInfo(hostile)');
  assert.deepEqual([value.supported, value.smooth, value.powerEfficient], [true, true, true]);
  assert.equal(f.context.reads, 0);
  assert.equal(f.context.calls, 1);
  assert.equal(f.context.lastArgument, f.context.hostile);
});
