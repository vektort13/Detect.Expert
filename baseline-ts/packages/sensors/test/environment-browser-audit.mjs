// Independent source harness. All API calls belong to this synthetic page; artifacts contain no values.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { startFixtureServer } from '../../../tests/fixture-server.mjs';

const built = await build({ stdin: { contents: "export { SensorRuntime, browserEnv } from './packages/sensors/src/runtime'; export { installEnvironmentSensor } from './packages/sensors/src/environment'; export { interpretReport } from './packages/engine/src/interpret'; export { projectReport } from './packages/engine/src/projection';", resolveDir: process.cwd(), sourcefile: 'environment-audit.ts', loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'EnvironmentAudit', platform: 'browser', target: 'es2022', logLevel: 'silent' });
const fixture = await startFixtureServer([6173]);
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const evidence = { measuredAt: new Date().toISOString(), chromium: browser.version(), extensionLoaded: false,
  savedData: 'fixed API labels, counts, support/identity booleans and timing only; no browser values, queries, formatted text or hashes', complete: false, cases: [] };
async function check(name, run) {
  const page = await browser.newPage();
  try {
    await page.goto(fixture.origins[0] + '/environment-native-audit.html');
    await page.addScriptTag({ content: built.outputFiles[0].text });
    const result = await run(page);
    evidence.cases.push({ name, result }); console.log('PASS ' + name);
  } finally { await page.close(); }
}
try {
  await check('native configurable getter original once, receiver, result/error identity and unchanged data properties', async page => {
    const result = await page.evaluate(async () => {
      const battery = navigator.getBattery ? await navigator.getBattery() : null;
      const groups = [
        ['Navigator', navigator, ['userAgent','platform','vendor','language','languages','appVersion','appName','appCodeName','product','productSub','vendorSub','plugins','mimeTypes','pdfViewerEnabled','webdriver','userAgentData','hardwareConcurrency','deviceMemory','maxTouchPoints','connection']],
        ['NavigatorUAData', navigator.userAgentData, ['brands','mobile','platform']],
        ['Screen', screen, ['width','height','availWidth','availHeight','colorDepth','pixelDepth','orientation','isExtended']],
        ['ScreenOrientation', screen.orientation, ['type','angle']],
        ['VisualViewport', visualViewport, ['offsetLeft','offsetTop','pageLeft','pageTop','width','height','scale']],
        ['BatteryManager', battery, ['charging','chargingTime','dischargingTime','level']],
        ['NetworkInformation', navigator.connection, ['type','effectiveType','rtt','downlink','downlinkMax','saveData']],
        ['Window', window, ['innerWidth','innerHeight','outerWidth','outerHeight','devicePixelRatio','visualViewport']],
      ];
      const checks = [], untouched = [];
      for (const [name, receiver, keys] of groups) {
        if (!receiver) continue;
        const target = name === 'Window' ? window : window[name]?.prototype;
        if (!target) continue;
        for (const key of keys) {
          const d = Object.getOwnPropertyDescriptor(target, key);
          if (!d) continue;
          if (!d.configurable || !d.get) { untouched.push({ target, key, descriptor: d, name: name + '.' + key }); continue; }
          const state = { target, key, name: name + '.' + key, receiver, calls: 0, result: undefined, error: undefined, args: null, self: null };
          Object.defineProperty(target, key, { ...d, get: new Proxy(d.get, { apply(original, self, args) {
            state.calls++; state.self = self; state.args = args;
            try { return state.result = Reflect.apply(original, self, args); } catch (error) { state.error = error; throw error; }
          } }) });
          checks.push(state);
        }
      }
      const runtime = new EnvironmentAudit.SensorRuntime(EnvironmentAudit.browserEnv(window));
      EnvironmentAudit.installEnvironmentSensor(runtime, window);
      const installationReads = checks.reduce((n, s) => n + s.calls, 0);
      const poison = new Proxy({}, { get() { throw new Error('observer inspected extra argument'); } });
      const facts = [];
      for (const s of checks) {
        const getter = Object.getOwnPropertyDescriptor(s.target, s.key).get;
        let value, error, threw = false;
        try { value = Reflect.apply(getter, s.receiver, [poison]); } catch (e) { error = e; threw = true; }
        const normal = s.calls === 1 && s.self === s.receiver && s.args.length === 1 && s.args[0] === poison && (threw ? error === s.error : Object.is(value, s.result));
        let invalidValue, invalidError, invalidThrew = false;
        try { invalidValue = Reflect.apply(getter, {}, []); } catch (e) { invalidError = e; invalidThrew = true; }
        const invalid = s.calls === 2 && (invalidThrew ? invalidError === s.error : Object.is(invalidValue, s.result));
        let nonconstructible = false; try { Reflect.construct(getter, []); } catch { nonconstructible = true; }
        facts.push({ api: s.name, originalCalls: s.calls, normal, invalid, nonconstructible });
      }
      const dataUnchanged = untouched.every(s => { const d = Object.getOwnPropertyDescriptor(s.target, s.key); return d.value === s.descriptor.value && d.get === s.descriptor.get && d.set === s.descriptor.set && d.configurable === s.descriptor.configurable && d.writable === s.descriptor.writable; });
      const counters = runtime.snapshot().counters.map(c => ({ id: c.techniqueId, count: c.count, phase: c.phase, signals: c.signalCodes }));
      runtime.stop('local');
      return { installationReads, facts, dataUnchanged, untouched: untouched.map(s => s.name), counters };
    });
    assert.equal(result.installationReads, 0); assert.equal(result.dataUnchanged, true); assert.ok(result.facts.length >= 40);
    assert.ok(result.facts.every(f => f.originalCalls === 2 && f.normal && f.invalid && f.nonconstructible));
    assert.ok(result.counters.every(c => c.signals.length === 1 && c.signals[0] === 'api-use'));
    return result;
  });

  await check('native methods, coercion, original Promise identity and zero then/catch reads', async page => {
    const result = await page.evaluate(async () => {
      const entries = [
        [Date.prototype, 'getTimezoneOffset', new Date(0), [], false],
        [window, 'matchMedia', window, ['(prefers-reduced-motion: reduce)'], false],
        [CSS, 'supports', CSS, ['display','grid'], false],
      ];
      const intlNames = ['Collator','DateTimeFormat','NumberFormat','PluralRules','RelativeTimeFormat','ListFormat','Segmenter','DisplayNames'];
      for (const name of intlNames) if (typeof Intl[name] === 'function') {
        const receiver = name === 'DisplayNames' ? new Intl[name]('en', { type: 'language' }) : new Intl[name]('en');
        entries.push([Intl[name].prototype, 'resolvedOptions', receiver, [], false]);
      }
      if (navigator.userAgentData) entries.push([NavigatorUAData.prototype,'getHighEntropyValues',navigator.userAgentData,[['architecture']],true]);
      if (navigator.getBattery) entries.push([Navigator.prototype,'getBattery',navigator,[],true]);
      // A wrong native receiver cannot prompt for access; original Promise settlement is observed only by the fixture.
      if (window.getScreenDetails) entries.push([window,'getScreenDetails',{},[],true]);
      const states = [];
      for (const [target,key,receiver,args,async] of entries) {
        const d = Object.getOwnPropertyDescriptor(target,key); if (!d?.configurable || typeof d.value !== 'function') continue;
        const s = { target,key,receiver,args,async, calls: 0, result: undefined,error: undefined, thenReads: 0 };
        Object.defineProperty(target,key,{ ...d,value:new Proxy(d.value,{ apply(original,self,args) {
          s.calls++; try {
            s.result = Reflect.apply(original,self,args);
            if (async) for (const name of ['then','catch']) Object.defineProperty(s.result,name,{ configurable:true,get(){ s.thenReads++; throw new Error('Promise touched by observer'); } });
            return s.result;
          } catch(error){ s.error=error; throw error; }
        } }) }); states.push(s);
      }
      const runtime = new EnvironmentAudit.SensorRuntime(EnvironmentAudit.browserEnv(window));
      EnvironmentAudit.installEnvironmentSensor(runtime,window);
      const facts = [];
      for (const s of states) {
        const method = s.target[s.key]; let value,error,threw=false;
        try { value=Reflect.apply(method,s.receiver,s.args); } catch(e){error=e;threw=true;}
        const identity = threw ? error===s.error : Object.is(value,s.result);
        let promiseUntouched=s.thenReads===0;
        if(s.async&&!threw){ delete value.then;delete value.catch;try{await value;}catch{/* Fixture observes native rejection. */} }
        let invalidValue,invalidError,invalidThrew=false;
        try{invalidValue=Reflect.apply(method,{},s.args);}catch(e){invalidError=e;invalidThrew=true;}
        const invalidIdentity=invalidThrew?invalidError===s.error:Object.is(invalidValue,s.result);
        promiseUntouched=promiseUntouched&&s.thenReads===0;
        if(s.async&&!invalidThrew){delete invalidValue.then;delete invalidValue.catch;try{await invalidValue;}catch{/* Original rejection belongs to the fixture. */}}
        let nonconstructible=false;try{Reflect.construct(method,[]);}catch{nonconstructible=true;}
        facts.push({api:s.key,originalCalls:s.calls,identity,invalidIdentity,promiseUntouched,nonconstructible,asynchronous:s.async});
      }
      let coercions=0;
      const query={toString(){coercions++;return '(min-width: 1px)';}};
      window.matchMedia(query);
      CSS.supports({toString(){coercions++;return 'display';}}, {toString(){coercions++;return 'grid';}});
      const invalidDateNaN=Number.isNaN(new Date(NaN).getTimezoneOffset());
      const snapshot=runtime.snapshot();
      const counters=snapshot.counters.map(c=>({id:c.techniqueId,count:c.count,phase:c.phase}));
      runtime.stop('local');
      return {facts,coercions,invalidDateNaN,counters,privateDataAbsent:!JSON.stringify(snapshot).includes('prefers-reduced-motion')};
    });
    assert.ok(result.facts.length >= 13); assert.ok(result.facts.every(f => f.originalCalls===2&&f.identity&&f.invalidIdentity&&f.promiseUntouched&&f.nonconstructible));
    assert.equal(result.coercions,3); assert.equal(result.privateDataAbsent,true);assert.equal(result.invalidDateNaN,true);
    assert.ok(result.counters.some(c=>c.id==='DET-026'&&c.phase==='settlement-unobserved'));
    assert.ok(result.counters.some(c=>c.id==='DET-040'&&c.phase==='settlement-unobserved'));
    return result;
  });

  for (const wrapped of [false,true]) await check('native unhandled rejection preserved wrapped='+wrapped, async page => {
    const result=await page.evaluate(async wrapped=>{
      let runtime;
      if(wrapped){runtime=new EnvironmentAudit.SensorRuntime(EnvironmentAudit.browserEnv(window));EnvironmentAudit.installEnvironmentSensor(runtime,window);}
      let promise;const events=[];
      addEventListener('unhandledrejection',e=>{events.push({samePromise:e.promise===promise,type:e.reason.name});e.preventDefault();});
      promise=NavigatorUAData.prototype.getHighEntropyValues.call({},[]);
      await new Promise(resolve=>setTimeout(resolve,100));runtime?.stop('local');return{events};
    },wrapped);
    assert.deepEqual(result.events,[{samePromise:true,type:'TypeError'}]); return result;
  });

  await check('ordinary responsive UI/localization/power adaptation remains api-use and pause/cleanup works', async page=>{
    const result=await page.evaluate(async()=>{
      const originals={getter:Object.getOwnPropertyDescriptor(Navigator.prototype,'hardwareConcurrency').get,method:Date.prototype.getTimezoneOffset};
      const runtime=new EnvironmentAudit.SensorRuntime(EnvironmentAudit.browserEnv(window));EnvironmentAudit.installEnvironmentSensor(runtime,window);
      // Ordinary page-owned use: choose formatting, worker pool, responsive motion and adaptive download.
      void navigator.language;void navigator.hardwareConcurrency;void navigator.maxTouchPoints;
      void screen.width;void window.innerWidth;void navigator.connection.saveData;
      new Intl.DateTimeFormat().resolvedOptions();new Date().getTimezoneOffset();matchMedia('(prefers-reduced-motion: reduce)');CSS.supports('display','grid');
      if(navigator.getBattery){const battery=await navigator.getBattery();void battery.charging;}
      const report={schemaVersion:1,documentKey:'1:0:native',host:null,createdAt:0,updatedAt:0,revision:0,coverageState:'active',coverageFlags:[],counters:runtime.snapshot().counters.map(c=>({...c,firstBucket:c.lastBucket})),findings:[],hosts:[],dropped:{observations:0,batches:0,findings:0,hosts:0,counters:0,transport:0}};
      const projection=EnvironmentAudit.projectReport(EnvironmentAudit.interpretReport(report).report,{scopeMode:'all-sites'});
      const before=runtime.snapshot().counters.find(c=>c.techniqueId==='DET-032').count;
      runtime.hooks.enabled=false;void navigator.hardwareConcurrency;
      const paused=runtime.snapshot().counters.find(c=>c.techniqueId==='DET-032').count;
      runtime.hooks.enabled=true;void navigator.hardwareConcurrency;
      const resumed=runtime.snapshot().counters.find(c=>c.techniqueId==='DET-032').count;
      const foreign=()=>false;window.matchMedia=foreign;runtime.stop('local');
      return {techniques:projection.techniques.map(t=>({id:t.techniqueId,interpretation:t.interpretation,confidence:t.interpretationConfidence})),before,paused,resumed,
        restored:Object.getOwnPropertyDescriptor(Navigator.prototype,'hardwareConcurrency').get===originals.getter&&Date.prototype.getTimezoneOffset===originals.method,foreignKept:window.matchMedia===foreign};
    });
    assert.ok(result.techniques.length>=10);assert.ok(result.techniques.every(t=>t.interpretation==='api-use'&&t.confidence==='unassessed'));
    assert.equal(result.before,result.paused);assert.equal(result.resumed,result.before+1);assert.equal(result.restored,true);assert.equal(result.foreignKept,true);return result;
  });
  for (const kind of ['positive','negative']) await check('standalone '+kind+' fixture factual projection',async page=>{
    await page.goto(fixture.origins[0]+'/environment-'+kind+'.html');
    await page.addScriptTag({content:built.outputFiles[0].text});
    const result=await page.evaluate(async kind=>{
      const runtime=new EnvironmentAudit.SensorRuntime(EnvironmentAudit.browserEnv(window));EnvironmentAudit.installEnvironmentSensor(runtime,window);
      await window[kind==='positive'?'runEnvironmentPositive':'runEnvironmentNegative']();
      const counters=runtime.snapshot().counters.map(c=>({...c,firstBucket:c.lastBucket}));
      const report={schemaVersion:1,documentKey:'1:0:fixture',host:null,createdAt:0,updatedAt:0,revision:0,coverageState:'active',coverageFlags:[],counters,findings:[],hosts:[],dropped:{observations:0,batches:0,findings:0,hosts:0,counters:0,transport:0}};
      const projection=EnvironmentAudit.projectReport(EnvironmentAudit.interpretReport(report).report,{scopeMode:'all-sites'});
      runtime.stop('local');return{techniques:projection.techniques.map(t=>({id:t.techniqueId,count:t.count,interpretation:t.interpretation,confidence:t.interpretationConfidence}))};
    },kind);
    assert.ok(result.techniques.length>8);assert.ok(result.techniques.every(t=>t.interpretation==='api-use'&&t.confidence==='unassessed'));
    if(kind==='positive')assert.deepEqual(result.techniques.map(t=>t.id),['DET-025','DET-026','DET-027','DET-028','DET-029','DET-030','DET-031','DET-032','DET-033','DET-034','DET-035','DET-036','DET-037','DET-038','DET-040','DET-041']);
    return result;
  });
  evidence.complete=true;
} finally {
  writeFileSync('test-results/prod/reports/2026-09-13-environment-native.json',JSON.stringify(evidence,null,2)+'\n');
  await browser.close();await fixture.close();
}
