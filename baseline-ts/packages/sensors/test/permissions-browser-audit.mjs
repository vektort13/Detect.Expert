// DET-039/ADR-026 native source-module acceptance. Test pages own every query and policy read.
// No extension permission grants, device access, prompts or query-result settlement observer.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const built = await build({ stdin: { contents: "export { SensorRuntime, browserEnv } from './packages/sensors/src/runtime'; export { installPermissionsSensor } from './packages/sensors/src/permissions';",
  resolveDir: process.cwd(), sourcefile: 'permissions-native-audit.ts', loader: 'ts' }, bundle: true, write: false,
  format: 'iife', globalName: 'PermissionsAudit', platform: 'browser', target: 'es2022', logLevel: 'silent' });
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html', ...(request.url === '/blocked' ? { 'Permissions-Policy': 'camera=(), microphone=()' } : {}) });
  response.end('<!doctype html><title>Fixture-owned permission reads</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = { measuredAt: new Date().toISOString(), browser: browser.version(), extensionLoaded: false,
  fixtureOwnedQueries: true, deviceAccessRequested: false, permissionPromptsRequested: false, browserPermissionOverrides: false,
  observerHandlesPromises: false, workerInstrumentation: false, complete: false, cases: [] };
async function check(name, run, path = '/', instrumented = true) {
  const page = await browser.newPage();
  try {
    await page.addInitScript({ content: built.outputFiles[0].text + `
      globalThis.permissionFixture = { originals: { state: Object.getOwnPropertyDescriptor(PermissionStatus.prototype, 'state'),
        name: Object.getOwnPropertyDescriptor(PermissionStatus.prototype, 'name'), query: Object.getOwnPropertyDescriptor(Permissions.prototype, 'query'),
        notification: Object.getOwnPropertyDescriptor(Notification, 'permission') }, calls: { query:0, state:0, name:0, notification:0 }, thenReads:0 };
      const fixture = permissionFixture, apply = Reflect.apply, then = Promise.prototype.then;
      Object.defineProperty(Permissions.prototype, 'query', { ...fixture.originals.query, value: new Proxy(fixture.originals.query.value, { apply(target, receiver, args) {
        fixture.calls.query++; const result = apply(target, receiver, args); fixture.lastPromise = result;
        Object.defineProperty(result, 'then', { configurable:true, get() { fixture.thenReads++; return then; } }); return result;
      } }) });
      for (const key of ['state','name']) Object.defineProperty(PermissionStatus.prototype, key, { ...fixture.originals[key], get: new Proxy(fixture.originals[key].get, { apply(target, receiver, args) { fixture.calls[key]++; return apply(target, receiver, args); } }) });
      Object.defineProperty(Notification, 'permission', { ...fixture.originals.notification, get: new Proxy(fixture.originals.notification.get, { apply(target, receiver, args) { fixture.calls.notification++; return apply(target, receiver, args); } }) });
      fixture.runtime = new PermissionsAudit.SensorRuntime(PermissionsAudit.browserEnv(window, true));
      ${instrumented ? 'PermissionsAudit.installPermissionsSensor(fixture.runtime, window);' : ''}
      fixture.installCounts = {...fixture.calls}; fixture.early = fixture.runtime.earlyCaptureGuaranteed;
    ` });
    await page.goto('http://127.0.0.1:' + server.address().port + path);
    const result = await run(page); evidence.cases.push({ name, result }); console.log('PASS ' + name);
  } finally { await page.close(); }
}
try {
  await check('query identity and once-only descriptor conversion; state enum correlation through native aliases', async page => {
    const result = await page.evaluate(async () => {
      const f = permissionFixture, rows = [];
      for (const name of ['camera','microphone','geolocation','notifications','clipboard-write','accelerometer','gyroscope','magnetometer']) {
        let descriptorReads = 0, ownNameReads = 0, baselineDescriptorReads = 0;
        await Reflect.apply(f.originals.query.value,navigator.permissions,[{get name(){baselineDescriptorReads++;return name;}}]);
        const descriptor = { get name() { descriptorReads++; return name; } };
        const output = navigator.permissions.query(descriptor), samePromise = output === f.lastPromise;
        const beforeRead = f.runtime.snapshot().counters.filter(c => c.phase === 'returned-sync').reduce((n,c) => n+c.count,0);
        const status = await output;
        const afterSettlement = f.runtime.snapshot().counters.filter(c => c.phase === 'returned-sync').reduce((n,c) => n+c.count,0);
        Object.defineProperty(status, 'name', { get() { ownNameReads++; throw new Error('own name accessed'); } });
        const nativeValue = Reflect.apply(f.originals.state.get,status,[]), value = status.state;
        rows.push({ requested:name, samePromise, descriptorReads, baselineDescriptorReads, ownNameReads, nativeValue, value, noReadOnSettlement:beforeRead===afterSettlement });
      }
      return { early:f.early, installCounts:f.installCounts, calls:f.calls, thenReads:f.thenReads, rows, counters:f.runtime.snapshot().counters };
    });
    assert.equal(result.early,true); assert.deepEqual(result.installCounts,{query:0,state:0,name:0,notification:0});
    assert.deepEqual(result.calls,{query:8,state:8,name:8,notification:0}); assert.equal(result.thenReads,0);
    for (const row of result.rows) { assert.equal(row.samePromise,true); assert.equal(row.descriptorReads,row.baselineDescriptorReads); assert.equal(row.ownNameReads,0); assert.equal(row.value,row.nativeValue); assert.equal(row.noReadOnSettlement,true); }
    const signatures = result.counters.map(c => [c.signalCodes.join(','),c.count]);
    assert.ok(signatures.some(([codes,n]) => codes === 'api-use,permission-camera,permission-prompt' && n===1));
    assert.ok(signatures.some(([codes,n]) => codes === 'api-use,permission-microphone,permission-prompt' && n===1));
    assert.ok(signatures.some(([codes,n]) => codes === 'api-use,permission-granted,permission-sensors' && n===3));
    return result;
  });
  await check('denied permission state from policy is distinct from policy-blocked; native arrays preserved', async page => {
    const result = await page.evaluate(async () => {
      const f=permissionFixture, camera=await navigator.permissions.query({name:'camera'}), value=camera.state;
      const policy=document.featurePolicy;
      const before=policy.allowsFeature('camera'), enumeration=policy.features(), allowed=policy.allowedFeatures(), origins=policy.getAllowlistForFeature('camera');
      return {value, before, arrays:[enumeration,allowed,origins].every(Array.isArray), counters:f.runtime.snapshot().counters,
        noPermissionPrompt:true, calls:f.calls};
    });
    assert.equal(result.value,'denied'); assert.equal(result.before,false); assert.equal(result.arrays,true);
    assert.ok(result.counters.some(c=>c.signalCodes.join(',')==='api-use,permission-camera,permission-denied'));
    assert.ok(result.counters.some(c=>c.signalCodes.join(',')==='api-use,permission-camera,policy-blocked'));
    assert.ok(result.counters.some(c=>c.signalCodes.join(',')==='api-use,policy-enumeration' && c.count===3)); return result;
  }, '/blocked');
  await check('native invalid receivers retain TypeError and bypass all Proxy traps', async page => {
    const result = await page.evaluate(async () => {
      const f=permissionFixture, status=await navigator.permissions.query({name:'camera'});
      let traps=0; const proxy=new Proxy(status,{get(){traps++;throw new Error('trap');}, getOwnPropertyDescriptor(){traps++;throw new Error('trap');}});
      const getter=Object.getOwnPropertyDescriptor(PermissionStatus.prototype,'state').get;
      const errors=[]; for(const receiver of [proxy,{},null]) { let original,wrapped; try {Reflect.apply(f.originals.state.get,receiver,[]);}catch(e){original=e;} try{Reflect.apply(getter,receiver,[]);}catch(e){wrapped=e;} errors.push({sameClass:original.constructor===wrapped.constructor,sameMessage:original.message===wrapped.message}); }
      return {traps,errors,calls:f.calls,counters:f.runtime.snapshot().counters};
    });
    assert.equal(result.traps,0); assert.equal(result.calls.name,0); assert.equal(result.calls.state,3);
    for(const error of result.errors){assert.equal(error.sameClass,true);assert.equal(error.sameMessage,true);}
    assert.ok(result.counters.some(c=>c.phase==='threw-sync' && c.count===3 && c.signalCodes.join(',')==='api-use')); return result;
  });
  await check('Notification default read; explicit-origin policy and coercion stay generic', async page => {
    const result = await page.evaluate(() => {
      const f=permissionFixture, notification=Notification.permission;
      let conversions=0; const argument={toString(){conversions++;return 'camera';}};
      const actual=document.featurePolicy.allowsFeature(argument), explicit=document.featurePolicy.allowsFeature('camera',location.origin);
      return {notification,actual,explicit,conversions,calls:f.calls,counters:f.runtime.snapshot().counters};
    });
    assert.equal(result.notification,'default');assert.equal(result.conversions,1);assert.equal(result.calls.notification,1);
    assert.ok(result.counters.some(c=>c.signalCodes.join(',')==='api-use,permission-notifications,permission-prompt'));
    assert.ok(result.counters.some(c=>c.signalCodes.join(',')==='api-use,policy-enumeration'&&c.count===2));return result;
  });
  for(const enabled of [false,true]) await check('unhandled rejection parity '+(enabled?'wrapped':'baseline'), async page => {
    const result=await page.evaluate(async()=>{
      const events=[];let promise;
      window.addEventListener('unhandledrejection',event=>{events.push({samePromise:event.promise===promise,name:event.reason.name});event.preventDefault();});
      promise=navigator.permissions.query({name:'PRIVATE_UNSUPPORTED_CANARY'});
      await new Promise(resolve=>setTimeout(resolve,80));
      return {events,thenReads:permissionFixture.thenReads,counters:permissionFixture.runtime.snapshot().counters};
    });
    assert.deepEqual(result.events,[{samePromise:true,name:'TypeError'}]); assert.equal(result.thenReads,0);
    assert.equal(JSON.stringify(result.counters).includes('CANARY'),false); return result;
  },'/',enabled);
  await check('pause and cleanup preserve original getters and third-party replacements',async page=>{
    const result=await page.evaluate(async()=>{
      const f=permissionFixture,status=await navigator.permissions.query({name:'camera'});
      void status.state; const before=f.calls.name; f.runtime.pause(); const paused=status.state; const noSupplement=f.calls.name===before;
      f.runtime.resume(); void status.state; const replacement=()=>true; document.featurePolicy.constructor.prototype.allowsFeature=replacement;
      f.runtime.stop('local'); const restored=Object.getOwnPropertyDescriptor(PermissionStatus.prototype,'state').get; const value=status.state;
      return {paused,value,noSupplement,stateIsUnwrapped:Function.prototype.toString.call(restored).includes('[native code]'),foreignPreserved:document.featurePolicy.allowsFeature===replacement};
    });
    assert.equal(result.paused,'prompt');assert.equal(result.value,'prompt');assert.equal(result.noSupplement,true);assert.equal(result.stateIsUnwrapped,true);assert.equal(result.foreignPreserved,true);return result;
  });
  await check('native PermissionStatus state wrapper isolated microbenchmark',async page=>{
    const result=await page.evaluate(async()=>{
      const f=permissionFixture,status=await navigator.permissions.query({name:'camera'}),original=f.originals.state.get;
      const apply=Reflect.apply,now=performance.now.bind(performance),iterations=30000,warmup=2000,trials=5,pairs=[];
      const native=()=>apply(original,status,[]),wrapped=()=>status.state;
      for(let i=0;i<warmup;i++){native();wrapped();}
      let valid=true; const measure=fn=>{const start=now();for(let i=0;i<iterations;i++)valid=fn()==='prompt'&&valid;return (now()-start)*1e6/iterations;};
      for(let i=0;i<trials;i++)pairs.push(i%2===0?{nativeNs:measure(native),wrappedNs:measure(wrapped)}:(()=>{const wrappedNs=measure(wrapped);return{nativeNs:measure(native),wrappedNs};})());
      return{iterations,warmup,trials,pairs,valid};
    });
    assert.equal(result.valid,true);const median=key=>result.pairs.map(p=>p[key]).sort((a,b)=>a-b)[2];
    return {...result,nativeMedianNs:median('nativeNs'),wrappedMedianNs:median('wrappedNs'),limitation:'Source-module getter plus native name correlation and runtime counter only. Fixture monitors add calls; no transport, full extension or global overhead claim.'};
  });
  evidence.complete=true;
} finally {
  await browser.close(); await new Promise(resolve=>server.close(resolve));
  writeFileSync('test-results/prod/reports/2026-09-13-permissions-native-acceptance.json',JSON.stringify(evidence,null,2)+'\n');
}
