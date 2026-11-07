// Source-only DET-066 native proof. No production build, page timestamps or mark values in artifacts.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { startFixtureServer } from '../../../tests/fixture-server.mjs';
const bundle=await build({stdin:{contents:"export { SensorRuntime, browserEnv } from './packages/sensors/src/runtime'; export { installTimingSensor } from './packages/sensors/src/timing';",resolveDir:process.cwd(),sourcefile:'timing-native.ts',loader:'ts'},bundle:true,write:false,format:'iife',globalName:'TimingAudit',platform:'browser',target:'es2022',logLevel:'silent'});
const server=await startFixtureServer([6373]),browser=await chromium.launch({channel:'chromium',headless:true});
const evidence={measuredAt:new Date().toISOString(),browser:browser.version(),extensionLoaded:false,cases:[],complete:false};
try{for(const name of ['clocks','sampling','entriesAndOptions','infrastructure']){
  const context=await browser.newContext(),page=await context.newPage();
  try{await page.goto(server.origins[0]+'/browser-timing-native.html');await page.addScriptTag({content:bundle.outputFiles[0].text});
    const result=await page.evaluate(name=>window.__timingNative[name](),name);evidence.cases.push({name,result});
    if(name==='clocks'){
      assert.equal(result.noInstallReads,true);assert.equal(result.extraReads,0);assert.equal(result.restored,true);assert.equal(result.cleanup,'complete');
      for(const item of result.cases){for(const key of ['native','wrongReceiver','negativeZero','falsyError']){assert.equal(item[key].nativeCalls,1,item.api+key);assert.equal(item[key].identity,true);assert.equal(item[key].thisAndArgs,true);}assert.equal(item.negativeZero.negativeZero,true);assert.equal(item.falsyError.falsyError,true);assert.equal(item.nonconstructible,true);}
    }else if(name==='sampling'){
      const count=(list,phase='returned-sync')=>list.find(counter=>counter.phase===phase)?.count??0;
      for(const list of [result.first,result.after64,result.after65,result.sampled,result.mixed,result.resumed])assert.ok(list.every(counter=>counter.techniqueId==='DET-066'&&counter.countQuality==='sampled'&&counter.signalCodes.length===1&&counter.signalCodes[0]==='api-use'));
      assert.equal(count(result.first),1);assert.equal(count(result.after64),1);assert.equal(count(result.after65),2);assert.equal(count(result.sampled),5);assert.equal(count(result.sampled,'threw-sync'),2);assert.equal(count(result.mixed),8);assert.deepEqual(result.paused,result.mixed);assert.equal(count(result.resumed),9);assert.equal(result.clean,true);
    }else if(name==='entriesAndOptions'){
      for(const key of ['noInstallReads','hostileMatches','clean'])assert.equal(result[key],true);assert.equal(result.optionReadsPerCall,1);assert.equal(result.observerErrors,0);assert.equal(result.cleanup,'complete');
      for(const item of result.cases){assert.equal(item.nativeCalls,1,item.api);assert.equal(item.identity,true,item.api);assert.equal(item.thisAndArgs,true,item.api);assert.equal(item.threw,false,item.api);}
    }else{assert.deepEqual(result.before,[]);assert.deepEqual(result.after,[]);assert.equal(result.postedContainsTiming,false);}
    console.log('PASS '+name);
  }finally{await context.close();}
}evidence.complete=true;}catch(error){evidence.errorClass=error instanceof Error?error.name:'unknown';throw error;}
finally{await browser.close();await server.close();writeFileSync('test-results/prod/reports/2026-09-13-timing-native.json',JSON.stringify(evidence,null,2)+'\n');}
