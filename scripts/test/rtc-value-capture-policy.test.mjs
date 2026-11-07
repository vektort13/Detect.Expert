// ADR-066: the independent RTC endpoint channel obeys the same permanent
// privacy veto as Canvas/API-results, including its already queued snapshots.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { rtcCaptureRuntimeSource, valueCapturePolicyRuntimeSource } from '../production/sync-value-capture-policy.mjs';

function fixture() {
  const context = vm.createContext({});
  vm.runInContext(`
    const counters={configuration:0,added:0,removed:0};
    let duringConfiguration=null;
    const nativeLike=fn=>new Proxy(fn,{});
    globalThis.EventTarget=class EventTarget {};
    Object.defineProperty(EventTarget.prototype,'addEventListener',{value:nativeLike(function(){counters.added++})});
    Object.defineProperty(EventTarget.prototype,'removeEventListener',{value:nativeLike(function(){counters.removed++})});
    globalThis.RTCPeerConnection=class RTCPeerConnection extends EventTarget {};
    Object.defineProperty(RTCPeerConnection.prototype,'getConfiguration',{value:nativeLike(function(){
      counters.configuration++;duringConfiguration?.();return{iceServers:[{urls:'stun:fixture.invalid:3478'}]};
    })});
    Object.defineProperty(RTCPeerConnection.prototype,'connectionState',{get:nativeLike(function(){return'new'})});
    globalThis.Event=class Event {};
    Object.defineProperty(Event.prototype,'type',{get:nativeLike(function(){return'connectionstatechange'})});
    Object.defineProperty(Event.prototype,'target',{get:nativeLike(function(){return null})});
    const CHANNEL='detect.expert/v1',RTC_DETAILS_CHANNEL='detect.expert/rtc/v1';
    const RTC_LIMITS={maxConnections:32,maxServers:8,maxBytes:32768,flushMs:250};
    const parseRtcServerUrl=raw=>raw==='stun:fixture.invalid:3478'?{scheme:'stun',host:'fixture.invalid',port:3478,transport:'udp'}:null;
    const validateBridgeMessage=()=>({ok:false}),arrayPush=(a,v)=>a.push(v);
    const sent=[],timers=new Map(),listeners=new Map(),stopCallbacks=[];let timerId=0;
    const env={self:globalThis,now:()=>0,postMessage:m=>sent.push(m),
      setTimeout:fn=>{timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id),
      addEventListener:(type,fn)=>{const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list)},
      removeEventListener:(type,fn)=>listeners.set(type,(listeners.get(type)||[]).filter(value=>value!==fn))};
    const runtime={visualEnv:env,hooks:{enabled:true},historyEpoch:0,sensorBootId:'fixture-boot',
      onStop:fn=>stopCallbacks.push(fn),limitRtcValues:()=>{}};
    const runTimers=()=>{for(let n=0;n<10&&timers.size;n++){const callbacks=[...timers.values()];timers.clear();for(const fn of callbacks)fn()}};
    const mark=(realm=globalThis)=>Object.defineProperty(realm,Symbol.for('detect.expert/api-custom/value-capture-deny/v1'),{value:false,configurable:false});
    const request=(type,epoch=0)=>{for(const fn of listeners.get('message')||[])fn({source:globalThis,data:{channel:RTC_DETAILS_CHANNEL,type,sensorBootId:runtime.sensorBootId,epoch}})};
  ` + valueCapturePolicyRuntimeSource() + rtcCaptureRuntimeSource() + `
    registerValueCaptureRealm(runtime,globalThis);
    const install=callback=>installRtcCapture(runtime,callback);
    const inspect=()=>({counts:{...counters},snapshots:sent.filter(m=>m.type==='rtc-snapshot'),timerCount:timers.size,
      envListeners:[...listeners.values()].reduce((sum,list)=>sum+list.length,0)});
    globalThis.probe={install,mark,runTimers,request,inspect,create:()=>new RTCPeerConnection(),
      onConfiguration:fn=>{duringConfiguration=fn},registerChild:realm=>registerValueCaptureRealm(runtime,realm)};
  `, context);
  return { context, run: source => vm.runInContext(source, context), inspect: () => JSON.parse(vm.runInContext('JSON.stringify(probe.inspect())', context)) };
}

test('RTC endpoint capture without Custom retains its existing native snapshot behavior', () => {
  const f=fixture(); f.run('const capture=probe.install();capture.seen(probe.create(),true);probe.runTimers()');
  const result=f.inspect(); assert.ok(result.counts.configuration>0); assert.equal(result.counts.added,3);
  assert.equal(result.snapshots.length,1); assert.equal(result.snapshots[0].snapshot.total,1);
  assert.deepEqual(result.snapshots[0].snapshot.connections[0].servers,[{scheme:'stun',host:'fixture.invalid',port:3478,transport:'udp',configured:true,candidate:false,error:false}]);
});

test('RTC queued endpoint snapshots and native listeners are purged on a later veto', () => {
  const f=fixture(); f.run('const capture=probe.install();capture.seen(probe.create(),true)');
  const before=f.inspect(); assert.ok(before.timerCount>0); assert.equal(before.counts.added,3);
  f.run('probe.mark();probe.runTimers();probe.request("rtc-reset",1);probe.request("rtc-request",1);capture.seen(probe.create(),true);probe.runTimers()');
  const after=f.inspect(); assert.equal(after.snapshots.length,0); assert.equal(after.timerCount,0);
  assert.equal(after.counts.removed,3); assert.equal(after.counts.configuration,before.counts.configuration);
});

test('RTC veto before installation prevents extra native reads and transport listeners', () => {
  const f=fixture(); f.run('probe.mark();const capture=probe.install();capture.seen(probe.create(),true);probe.request("rtc-request");probe.runTimers()');
  const result=f.inspect(); assert.deepEqual(result.counts,{configuration:0,added:0,removed:0});
  assert.equal(result.snapshots.length,0); assert.equal(result.timerCount,0); assert.equal(result.envListeners,0);
});

test('RTC rechecks the veto after an original native snapshot returns', () => {
  const f=fixture(); f.run('probe.onConfiguration(()=>probe.mark());const capture=probe.install();capture.seen(probe.create(),true);probe.runTimers()');
  const result=f.inspect(); assert.equal(result.counts.configuration,1); assert.equal(result.counts.added,0);
  assert.equal(result.snapshots.length,0); assert.equal(result.timerCount,0);
});

test('RTC configuration callbacks cannot attach listeners after latching a veto', () => {
  const f=fixture(); f.run('const capture=probe.install(()=>probe.mark());capture.seen(probe.create(),true);probe.runTimers()');
  const result=f.inspect(); assert.equal(result.counts.configuration,1); assert.equal(result.counts.added,0);
  assert.equal(result.snapshots.length,0); assert.equal(result.timerCount,0);
});

test('RTC shares a child realm veto and cannot reopen through forged epoch controls', () => {
  const f=fixture(); f.run('const capture=probe.install();capture.seen(probe.create(),true);const child={};probe.mark(child);probe.registerChild(child);probe.request("rtc-reset",2);probe.request("rtc-request",2);probe.runTimers()');
  const result=f.inspect(); assert.equal(result.snapshots.length,0); assert.equal(result.counts.removed,3); assert.equal(result.timerCount,0);
});
