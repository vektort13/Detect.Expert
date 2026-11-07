// Run explicitly: node scripts/test/math-signature-performance.mjs
// Diagnostic microbenchmark: does not alter the existing 5% all-browsing Math gate.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { mathSignatureRuntimeSource } from '../production/math-signature-runtime.mjs';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'test-results/math-signature-2026-10-10'); mkdirSync(output, { recursive: true });
const source = readFileSync(resolve(root, 'apps/production-extension/hook.main.js'), 'utf8');
const start = source.indexOf('// packages/sensors/src/wrap.ts'), end = source.indexOf('// packages/sensors/src/intrinsics.ts', start);
assert.ok(start >= 0 && end > start); const wrapperSource = source.slice(start, end);
const names = ['sin', 'cos', 'tan', 'acos', 'acosh', 'asin', 'pow'];
const browser = await chromium.launchPersistentContext(resolve(root, '.tmp/math-signature-performance-profile'), {
  channel: 'chromium', headless: true, args: ['--disable-extensions', '--no-proxy-server'],
});
const report = { measuredAt: new Date().toISOString(), browser: browser.browser().version(), platform: process.platform, node: process.version, warmups: 5, samples: 11,
  scope: 'Shipped method wrappers plus exact-marker sensor; ordinary non-matching computation. No extension transport overhead is included because no event is produced.',
  fivePercentGate: 'unchanged; activePro result is reported, not converted into a passing ordinary-mode gate', results: [], comparisons: [] };
try {
  // Alternate mode order between scenarios to reduce thermal/order bias.
  for (const [scenario, modes] of [['single-sin', ['baseline', 'ordinary', 'active-pro', 'restored']], ['mixed-seven', ['active-pro', 'ordinary', 'restored', 'baseline']], ['physics', ['restored', 'baseline', 'active-pro', 'ordinary']]]) {
    for (const mode of modes) {
      const page = await browser.newPage();
      await page.addScriptTag({ content: wrapperSource + mathSignatureRuntimeSource + `
        globalThis.benchmarkSensor = (() => {
          const originals = ${JSON.stringify(names)}.map(name => Math[name]);
          let observations = 0;
          const hooks = {enabled:true,observerErrors:0};
          const runtime = {hooks,apiResults:{proSession:''},record(){++observations},addFlag(flag){throw Error('coverage '+flag)},attach(){throw Error('unsupported hook')},onStop(){}};
          const support = mathSignatureSupport.install(runtime,globalThis,{wrapMethod},{'DET-022':21,'DET-023':22},{'returned-sync':1,'threw-sync':2},{'api-use':1,'known-numeric-pattern':8});
          return {runtime,support,originals,get observations(){return observations}};
        })();
        globalThis.runMathWorkload = (scenario, iterations) => {
          let checksum=0;
          if(scenario==='single-sin') { for(let index=0;index<iterations;++index) checksum += Math.sin(index*0.000013+0.01); }
          else if(scenario==='mixed-seven') { for(let index=0;index<iterations;++index) { const value=(index%8191)/8192;checksum+=Math.sin(value)+Math.cos(value)+Math.tan(value)+Math.acos(value)+Math.acosh(value+1)+Math.asin(value)+Math.pow(value+1,2); } }
          else { let x=0.01,y=0.04,vx=0.01,vy=0.02;for(let index=0;index<iterations;++index) {vx+=Math.sin(x)*0.0001;vy+=Math.cos(y)*0.0001;x=(x+vx)%100;y=(y+vy)%100;checksum+=Math.sin(x)*Math.cos(y)+Math.pow(vx,2)+Math.pow(vy,2);} }
          return checksum;
        };` });
      const result = await page.evaluate(({ scenario, mode, names }) => {
        const sensor = globalThis.benchmarkSensor;
        if (mode === 'baseline') sensor.support.stop();
        if (mode === 'active-pro' || mode === 'restored') sensor.runtime.apiResults.onProSessionChanged(true);
        if (mode === 'restored') sensor.runtime.apiResults.onProSessionChanged(false);
        const identity = names.every((name, index) => Math[name] === sensor.originals[index]);
        const iterations = scenario === 'single-sin' ? 1000000 : 250000;
        for (let warmup = 0; warmup < 5; ++warmup) globalThis.runMathWorkload(scenario, iterations);
        const ms = []; let checksum;
        for (let sample = 0; sample < 11; ++sample) {
          const begin = performance.now(); checksum = globalThis.runMathWorkload(scenario, iterations); ms.push(performance.now() - begin);
        }
        return { scenario, mode, iterations, calls: iterations * (scenario === 'single-sin' ? 1 : scenario === 'mixed-seven' ? 7 : 6), ms, checksum, identity, observations: sensor.observations, observerErrors: sensor.runtime.hooks.observerErrors, installed: sensor.support.installed };
      }, { scenario, mode, names });
      assert.equal(result.identity, mode !== 'active-pro'); assert.equal(result.observations, 0); assert.equal(result.observerErrors, 0);
      assert.equal(result.installed, mode === 'active-pro' ? 7 : 0); assert.ok(Number.isFinite(result.checksum)); assert.ok(result.ms.every(value => value > 0));
      const sorted = result.ms.toSorted((a, b) => a - b); result.medianMs = sorted[5]; result.p95Ms = sorted[10];
      report.results.push(result); await page.close();
    }
    const rows = report.results.filter(row => row.scenario === scenario), baseline = rows.find(row => row.mode === 'baseline'), expectedChecksum = baseline.checksum;
    for (const row of rows) {
      assert.equal(row.checksum, expectedChecksum, 'all modes must perform the same computation');
      if (row.mode !== 'baseline') report.comparisons.push({ scenario, mode: row.mode, medianOverheadPct: (row.medianMs / baseline.medianMs - 1) * 100, p95OverheadPct: (row.p95Ms / baseline.p95Ms - 1) * 100 });
      delete row.checksum; // Mathematical workload outputs are not exported in the benchmark artifact.
    }
  }
  report.completed = true;
} finally {
  await browser.close(); writeFileSync(resolve(output, 'performance.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ completed: report.completed, browser: report.browser, comparisons: report.comparisons }, null, 2));
