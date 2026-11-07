// ADR-065: opt-in local hot-path measurement on a private Math copy. No page, network, or browser state is used.
import os from 'node:os';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { installMathCustom } from '../../apps/production-extension/api-custom-math-runtime.js';
import { MATH_TRANSCENDENTAL_NAMES as names } from './math-transcendentals-fixtures.mjs';
const count = 200000, repeats = 5;
const math = Object.defineProperties({}, Object.getOwnPropertyDescriptors(Math));
const original = Object.fromEntries(names.map(name=>[name,math[name]]));
installMathCustom({Math:math,origin:'https://example.test'},[{id:'math-transcendentals',mode:'custom',value:{algorithm:'deterministic-ulp-v1',functions:names},mathSeed:'0123456789abcdef'.repeat(4)}]);
let sink = 0;
function run(fn, name, n){
 let sum=0;
 if(name==='atan2') for(let i=0;i<n;i++)sum+=fn(0.3+(i&1023)*1e-6,0.7);
 else if(name==='pow')for(let i=0;i<n;i++)sum+=fn(Math.PI+(i&1023)*1e-6,-100);
 else if(name==='acosh'||name==='log'||name==='log2'||name==='log10')for(let i=0;i<n;i++)sum+=fn(1.3+(i&1023)*1e-6);
 else for(let i=0;i<n;i++)sum+=fn(0.3+(i&1023)*1e-6);
 sink+=sum;
}
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
const results=[];
for(const name of names){
 run(original[name],name,30000);run(math[name],name,30000);
 const baseline=[],spoof=[];
 for(let round=0;round<repeats;round++){
  let before=performance.now();run(original[name],name,count);baseline.push((performance.now()-before)*1e6/count);
  before=performance.now();run(math[name],name,count);spoof.push((performance.now()-before)*1e6/count);
 }
 const nativeNs=median(baseline),spoofNs=median(spoof);
 results.push({name,nativeNs:+nativeNs.toFixed(2),spoofNs:+spoofNs.toFixed(2),overheadNs:+(spoofNs-nativeNs).toFixed(2),ratio:+(spoofNs/nativeNs).toFixed(2)});
}
if (!Number.isFinite(sink)) throw new Error('Benchmark did not produce a finite consumed result');
const runtimeSHA256=createHash('sha256').update(fs.readFileSync(new URL('../../apps/production-extension/api-custom-math-runtime.js',import.meta.url))).digest('hex');
const result={result:'PASS',at:new Date().toISOString(),node:process.version,arch:process.arch,os:os.platform(),cpu:os.cpus()[0].model,count,repeats,functionCount:names.length,runtimeSHA256,clock:'performance.now; medians, warmed function dispatch',results};
const output = new URL('../../test-results/production-1.1.0/math-transcendentals/benchmark.json',import.meta.url);
fs.mkdirSync(new URL('./',output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
