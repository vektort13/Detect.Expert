// Bounded microbenchmark, not the full extension performance gate. Returned browser values stay in-page.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const built=await build({stdin:{contents:"export {SensorRuntime,browserEnv} from './packages/sensors/src/runtime';export{installEnvironmentSensor}from './packages/sensors/src/environment';",resolveDir:process.cwd(),sourcefile:'environment-perf.ts',loader:'ts'},bundle:true,write:false,format:'iife',globalName:'EnvironmentPerf',platform:'browser',target:'es2022',logLevel:'silent'});
const browser=await chromium.launch({channel:'chromium',headless:true});
const evidence={measuredAt:new Date().toISOString(),chromium:browser.version(),scope:'isolated source microbenchmark; no global gate claim; shared machine',samples:5,loops:{getter:500000,method:100000},raw:[],complete:false};
try{
 const page=await browser.newPage();await page.addScriptTag({content:built.outputFiles[0].text});
 evidence.raw=await page.evaluate(()=>{
  const clock=performance.now.bind(performance), date=new Date(0), rows=[];
  function getter(count){let sum=0;for(let i=0;i<count;i++)sum+=navigator.hardwareConcurrency;return sum;}
  function method(count){let sum=0;for(let i=0;i<count;i++)sum+=date.getTimezoneOffset();return sum;}
  const measure=()=>{getter(20000);method(20000);let start=clock();const a=getter(500000);const getterMs=clock()-start;start=clock();const b=method(100000);return{getterMs,methodMs:clock()-start,a,b};};
  for(let i=0;i<5;i++){
   let native,sensor,runtime;
   if(i%2===0)native=measure();
   runtime=new EnvironmentPerf.SensorRuntime(EnvironmentPerf.browserEnv(window));EnvironmentPerf.installEnvironmentSensor(runtime,window);sensor=measure();
   const counts=runtime.snapshot().counters.map(c=>({id:c.techniqueId,count:c.count}));runtime.stop('local');
   if(i%2!==0)native=measure();
   rows.push({native:{getterMs:native.getterMs,methodMs:native.methodMs},sensor:{getterMs:sensor.getterMs,methodMs:sensor.methodMs},equal:Object.is(native.a,sensor.a)&&Object.is(native.b,sensor.b),counts});
  }return rows;
 });
 assert.ok(evidence.raw.every(r=>r.equal&&r.counts.some(c=>c.id==='DET-032'&&c.count===520000)&&r.counts.some(c=>c.id==='DET-035'&&c.count===120000)));
 const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
 evidence.summary=Object.fromEntries(['getterMs','methodMs'].map(key=>{
  const baseline=evidence.raw.map(r=>r.native[key]),sensor=evidence.raw.map(r=>r.sensor[key]);
  const medianNative=percentile(baseline,.5),medianSensor=percentile(sensor,.5);
  return[key,{medianNative,medianSensor,p95Native:percentile(baseline,.95),p95Sensor:percentile(sensor,.95),medianOverheadPercent:(medianSensor-medianNative)/medianNative*100}];
 }));evidence.complete=true;
}finally{await browser.close();writeFileSync('docs/coverage/perf/environment-api-use.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence.summary??{complete:false}));}
