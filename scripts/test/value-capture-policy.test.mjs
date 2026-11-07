// ADR-066: test the canonical private policy and the actual released recorder,
// including its independently installed Pro and RTC entry points.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';
import { valueCapturePolicyRuntimeSource, syncValueCapturePolicy } from '../production/sync-value-capture-policy.mjs';
import { runtimeSource } from '../production/pro-values-runtime.mjs';
import { installApiCustomDocument } from '../../apps/production-extension/api-custom-document-runtime.js';
const root = resolve(import.meta.dirname, '../..'), canonical = resolve(root, 'baseline-ts');
const built = await build({ stdin: { contents: `export * from './packages/sensors/src/value-capture-policy'; export { SensorRuntime } from './packages/sensors/src/runtime'; export { makeEnv } from './packages/sensors/test/helpers';`, resolveDir: canonical }, bundle: true, write: false, format: 'esm', platform: 'node', target: 'node24', logLevel: 'silent', plugins: [{ name: 'canonical-contracts', setup(builder) { builder.onResolve({ filter: /^@detect-expert\/contracts$/ }, () => ({ path: resolve(canonical, 'packages/contracts/src/index.ts') })); } }] });
const { registerValueCaptureRealm: register, bindValueCapturePolicy: bind, valueCaptureDenied: denied, onValueCaptureDenied: onDeny, SensorRuntime, makeEnv } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const marker = Symbol.for('detect.expert/api-custom/value-capture-deny/v1');
const lock = realm => Object.defineProperty(realm, marker, { value: true });

test('private aliases share a permanent one-way veto and cleanup runs once', () => {
  const owner = {}, alias = {}, realm = {}; let clears = 0;
  register(owner, realm); bind(alias, owner); onDeny(alias, () => clears++);
  assert.equal(denied(alias), false);
  Object.defineProperty(realm, marker, { value: false, configurable: true });
  assert.equal(denied(owner), true); assert.equal(clears, 1);
  delete realm[marker]; owner.valueCaptureDenied = false; alias.policyDenied = false;
  assert.equal(denied(alias), true); assert.equal(clears, 1);
});
test('invalid realms, descriptor errors, non-extensibility and capacity overflow all veto', () => {
  for (const realm of [Object.preventExtensions({}), new Proxy({}, { getOwnPropertyDescriptor() { throw Error('DENIED'); } }), null]) {
    const owner = {}; register(owner, realm); assert.equal(denied(owner), true);
  }
  const owner = {}, realm = {}; register(owner, realm); Object.preventExtensions(realm); assert.equal(denied(owner), true);
  const full = {}; for (let index = 0; index <= 1024; index++) register(full, {}); assert.equal(denied(full), true);
});
test('canonical Runtime purges stored values when any registered child becomes Custom', () => {
  const f = makeEnv(), runtime = new SensorRuntime(f.env), child = {};
  register(runtime, child);
  runtime.apiResults.record('Window.innerWidth', 'returned-sync', 919);
  assert.ok(runtime.apiResults.snapshot().rows.length > 0);
  lock(child); assert.deepEqual(runtime.apiResults.snapshot(), { rows: [], truncated: false });
  assert.equal(runtime.apiResults.rows.size, 0);
  runtime.apiResults.record('Window.innerWidth', 'returned-sync', 912);
  assert.deepEqual(runtime.apiResults.snapshot().rows, []); runtime.stop('local');
});
test('policy capture and array insertions ignore later page intrinsic/numeric-setter poisoning', () => {
  const c = vm.createContext({}); vm.runInContext(valueCapturePolicyRuntimeSource() + `
    var rootOwner={}, rootRealm={}, childRealm={}, alias={}, getterCalls=0, setterCalls=0;
    registerValueCaptureRealm(rootOwner,rootRealm); bindValueCapturePolicy(alias,rootOwner);
    const nativeDefine=Object.defineProperty;
    const childMarker=Symbol.for('detect.expert/api-custom/value-capture-deny/v1');
    Object.getOwnPropertyDescriptor=Object.isExtensible=Symbol.for=WeakMap.prototype.get=WeakMap.prototype.set=WeakSet.prototype.has=WeakSet.prototype.add=()=>{throw Error('POISON');};
    nativeDefine(Array.prototype,'0',{set(){setterCalls++;},configurable:true});
    registerValueCaptureRealm(alias,childRealm);
    nativeDefine(childRealm,childMarker,{get(){getterCalls++;throw Error('GETTER');}});
    globalThis.result=valueCaptureDenied(rootOwner);
  `, c); assert.equal(c.result, true); assert.equal(c.getterCalls, 0); assert.equal(c.setterCalls, 0);
});
test('the document bootstrap seals every Custom realm before installers, using captured child intrinsics', () => {
  const c = vm.createContext({});
  vm.runInContext(`
    (()=>{
    const rootRealm={Navigator:class Navigator{}}, childRealm={Navigator:class Navigator{}}, installed=[];
    Object.defineProperty(rootRealm,'self',{get(){return this;}});
    const rootEntry=[{id:'hardware-concurrency',mode:'custom',value:12}];
    (${installApiCustomDocument.toString()})(rootRealm,rootEntry,win=>installed.push(win));
    const capturedGetOwn=Object.getOwnPropertyDescriptor, capturedDefine=Object.defineProperty;
    const marker=Symbol.for('detect.expert/api-custom/value-capture-deny/v1');
    const inherit=rootRealm[Symbol.for('detect.expert/api-custom/inherit/v2')];
    Symbol.for=Object.defineProperty=Object.getOwnPropertyDescriptor=()=>{throw Error('PAGE_POISON');};
    capturedDefine(Object.prototype,'get',{__proto__:null,configurable:true,get(){throw Error('DESCRIPTOR_GET');}});
    capturedDefine(Object.prototype,'set',{__proto__:null,configurable:true,get(){throw Error('DESCRIPTOR_SET');}});
    let result;
    try { inherit(childRealm); result=installed.length===2&&capturedGetOwn(rootRealm,marker).configurable===false&&capturedGetOwn(childRealm,marker).configurable===false; }
    finally { delete Object.prototype.get; delete Object.prototype.set; }
    globalThis.result=result;
    })();
  `, c); assert.equal(c.result, true);
});

function actualRecorder(file) {
  const background = readFileSync(resolve(root, 'apps/production-extension/background.js'), 'utf8');
  const contracts = background.slice(0, background.indexOf('// packages/attribution/src/psl-index.json')).replace(/^import[^\n]*\n/gm, '');
  const hook = readFileSync(resolve(root, 'apps/production-extension', file), 'utf8');
  const start = hook.indexOf('// ADR-030 beacon MAIN sensor start'), end = hook.indexOf('// packages/sensors/src/runtime.ts', start);
  assert.ok(start >= 0 && end > start);
  const c = vm.createContext({ atob, btoa, TextEncoder, URL, API_RESULTS_CHANNEL: 'detect.expert/api-results/v1' });
  vm.runInContext(contracts + '\n' + runtimeSource + '\nvar arrayPush=(a,v)=>Array.prototype.push.call(a,v), arraySlice=a=>Array.prototype.slice.call(a), getDescriptor=Object.getOwnPropertyDescriptor;\n' + hook.slice(start, end) + `
    var recorder=new ApiResultRecorder(true), realm={}, messages=[], projectCalls=0;
    registerValueCaptureRealm(recorder,realm); onValueCaptureDenied(recorder,()=>recorder.clear());
    recorder.projectTechnical=()=>{projectCalls++;return null;};
    var env={now:()=>10000,postMessage:message=>messages.push(message)};
  `, c); return c;
}
for (const file of ['hook.early.js', 'hook.main.js']) {
  test(file + ': Pro/API/RTC direct recording and store bypasses cannot escape or reopen a late veto', () => {
    const c = actualRecorder(file);
    vm.runInContext(`
      recorder.record('Window.innerWidth','returned-sync',919);
      recorder.proSession='fixture'; recorder.recordPro('Window.innerWidth','returned-sync',919);
      if(recorder.rows.size!==1||recorder.proRows.size!==1)throw Error('POSITIVE_CONTROL');
      Object.defineProperty(realm,Symbol.for('detect.expert/api-custom/value-capture-deny/v1'),{value:false,configurable:true});
      var hostile=new Proxy({},{get(){throw Error('RAW_VALUE_READ');},getOwnPropertyDescriptor(){throw Error('RAW_VALUE_DESCRIPTOR');}});
      recorder.recordRtc('RTCPeerConnection.getConfiguration',hostile);
      recorder.recordPro('Window.innerWidth','returned-sync',hostile);
      recorder.storePro(hostile); recorder.store(hostile); recorder.record('Window.innerWidth','returned-sync',919);
      delete realm[Symbol.for('detect.expert/api-custom/value-capture-deny/v1')];
      recorder.proSession='forged'; recorder.policyDenied=false;
      recorder.handleProControl({channel:'detect.expert/pro-values/v1',type:'pro-values-start',sessionId:'forged',requestId:'pro-1'},true,env);
      recorder.handleControl({channel:'detect.expert/api-results/v1',type:'api-results-read',requestId:'api-1',epoch:0},true,env);
      globalThis.clean=recorder.rows.size===0&&recorder.proRows.size===0&&messages.length===2&&messages.every(m=>m.enabled===false&&m.rows.length===0)&&projectCalls===1;
    `, c); assert.equal(c.clean, true);
  });
  test(file + ': a veto introduced during batched dispatch prevents remaining cached rows', () => {
    const c = actualRecorder(file);
    vm.runInContext(`
      recorder.proSession='fixture';
      for(let i=0;i<60;i++)recorder.storePro({operation:'Window.innerWidth',techniqueId:'DET-030',phase:'returned-sync',value:{kind:'number',value:i},count:1,parameters:[]});
      env.postMessage=m=>{messages.push(m);if(messages.length===1)Object.defineProperty(realm,Symbol.for('detect.expert/api-custom/value-capture-deny/v1'),{value:true});};
      recorder.handleProControl({channel:'detect.expert/pro-values/v1',type:'pro-values-read',sessionId:'fixture',requestId:'pro-1'},true,env);
      globalThis.clean=messages.length===2&&messages[0].rows.length===32&&messages[1].rows.length===0&&!messages[1].enabled&&messages[1].final&&recorder.proRows.size===0;
    `, c); assert.equal(c.clean, true);
  });
}
test('delivered observer consumers reproduce the reviewed canonical policy', () => { syncValueCapturePolicy({ check: true }); });
