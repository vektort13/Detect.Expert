// Raw source-module overhead. The measurement clock is captured before hooks and never observed.
import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle=await build({stdin:{contents:"export { SensorRuntime, browserEnv } from './packages/sensors/src/runtime'; export { installTimingSensor } from './packages/sensors/src/timing';",resolveDir:process.cwd(),sourcefile:'timing-perf.ts',loader:'ts'},bundle:true,write:false,format:'iife',globalName:'TimingAudit',platform:'browser',target:'es2022',logLevel:'silent'});
const browser=await chromium.launch({channel:'chromium',headless:true});
try{
  const page=await browser.newPage();await page.goto('about:blank');await page.addScriptTag({content:bundle.outputFiles[0].text});
  const measurements=await page.evaluate(()=>{
    const originalPerformanceNow=Performance.prototype.now.bind(performance),originalDateNow=Date.now.bind(Date);
    const env=TimingAudit.browserEnv(window),runtime=new TimingAudit.SensorRuntime({...env,setTimeout:()=>0,clearTimeout(){},postMessage(){}});
    TimingAudit.installTimingSensor(runtime,window);
    const wrappedPerformanceNow=performance.now.bind(performance),wrappedDateNow=Date.now.bind(Date),iterations=1_000_000;
    let sink=0;
    const measure=fn=>{const begin=originalPerformanceNow();for(let i=0;i<iterations;i++)sink=fn();return(originalPerformanceNow()-begin)*1_000_000/iterations;};
    const noop=()=>0;
    const apiResults=[];
    for(const [api,native,wrapped]of [['Performance.now',originalPerformanceNow,wrappedPerformanceNow],['Date.now',originalDateNow,wrappedDateNow]]){
      for(let i=0;i<100_000;i++){sink=native();sink=wrapped();}
      const pairs=[];
      for(let trial=0;trial<5;trial++){
        let nativeNs,wrappedNs;
        if(trial%2===0){nativeNs=measure(native);wrappedNs=measure(wrapped);}else{wrappedNs=measure(wrapped);nativeNs=measure(native);}
        pairs.push({trial:trial+1,order:trial%2===0?'native-first':'wrapped-first',nativeNsPerCall:nativeNs,wrappedNsPerCall:wrappedNs,noopNsPerCall:measure(noop)});
      }
      apiResults.push({api,pairs});
    }
    const finiteResultConsumed=Number.isFinite(sink);sink=0;
    const counters=runtime.snapshot().counters.map(counter=>({id:counter.techniqueId,count:counter.count,quality:counter.countQuality}));runtime.stop('local');
    return{iterations,trials:5,apiResults,finiteResultConsumed,counters};
  });
  const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const result={measuredAt:new Date().toISOString(),browser:browser.version(),extensionLoaded:false,
    method:'5 alternating native/wrapped pairs per API; 100k warmup; 1M calls/batch; bound call sites; captured original Performance.now measurement and real browserEnv bookkeeping clock; transport timers disabled; no clock values retained',
    interpretation:'raw microbenchmark only, not the global Canvas 5% gate, fingerprint classification or computer performance score',...measurements};
  for(const api of result.apiResults){api.nativeMedianNsPerCall=median(api.pairs.map(pair=>pair.nativeNsPerCall));api.wrappedMedianNsPerCall=median(api.pairs.map(pair=>pair.wrappedNsPerCall));api.deltaNsPerCall=api.wrappedMedianNsPerCall-api.nativeMedianNsPerCall;api.relativeDeltaPercent=100*api.deltaNsPerCall/api.nativeMedianNsPerCall;}
  writeFileSync('test-results/prod/reports/2026-09-13-timing-microperf.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.apiResults.map(({api,nativeMedianNsPerCall,wrappedMedianNsPerCall,deltaNsPerCall,relativeDeltaPercent})=>({api,nativeMedianNsPerCall,wrappedMedianNsPerCall,deltaNsPerCall,relativeDeltaPercent})),null,2));
}finally{await browser.close();}
