// P09 / E02-02 / ADR-011/012: isolated measurement, no extension or production Math sensor.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startFixtureServer } from '../tests/fixture-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const scenarios = ['single', 'families', 'animation', 'calculator', 'physics'];
export const modes = ['baseline', 'fast', 'naive'];
export function summarize(values) {
  assert(values.length > 0 && values.every((v) => Number.isFinite(v) && v >= 0), 'Invalid timing samples');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { n: sorted.length, median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}
export function validateRun(result, scenario, mode) {
  assert.equal(result.scenario, scenario);
  assert.equal(result.mode, mode);
  assert(Number.isFinite(result.totalMs) && result.totalMs > 0, 'Invalid total timing');
  assert(Number.isFinite(result.checksum), 'Invalid checksum');
  const n = scenario === 'single' ? 1_000_000 : 100_000;
  let expected;
  if (scenario === 'animation') {
    assert(result.totalMs >= 5000 && Number.isInteger(result.frames) && result.frames >= 2);
    assert(Number.isFinite(result.workMs) && result.workMs > 0 && result.workMs <= result.totalMs);
    assert.equal(result.frameIntervalsMs.length, result.frames - 1);
    assert(result.frameIntervalsMs.every((v) => Number.isFinite(v) && v > 0));
    expected = [result.frames * 256, result.frames * 256, 0, 0, 0, 0, 0, 0, 0];
  } else {
    assert.equal(result.iterations, n);
    expected = { single: [n, 0, 0, 0, 0, 0, 0, 0, 0], families: [n, 0, n, n, n, n, n, n, n],
      calculator: [n, n, 0, 0, 0, 0, n, n, n], physics: [n, 0, 0, 0, 0, 0, 0, 0, 0] }[scenario];
  }
  assert.deepEqual(result.expectedCounts, expected);
  const calls = expected.reduce((a, b) => a + b, 0);
  assert.equal(result.calls, calls);
  if (mode === 'baseline') assert.equal(result.observed, null);
  else {
    assert.equal(result.observed.installed, 9);
    assert.equal(result.observed.degraded, false);
    assert.deepEqual(result.observed.counts, expected);
    assert.equal(result.observed.mask, expected.reduce((mask, count, code) => count ? mask | (1 << code) : mask, 0));
    assert.equal(result.observed.stackReads, mode === 'naive' ? calls : 0);
  }
}
export function compare(baseline, wrapped) {
  assert(baseline.median > 0 && baseline.p95 > 0, 'Baseline below timer resolution');
  return { medianMs: wrapped.median - baseline.median, medianPct: (wrapped.median / baseline.median - 1) * 100,
    p95Ms: wrapped.p95 - baseline.p95, p95Pct: (wrapped.p95 / baseline.p95 - 1) * 100 };
}

async function main() {
  assert.equal(process.argv.length, 2, 'This protocol uses exactly five runs; no CLI overrides');
  const source = readFileSync(path.join(root, 'tests/perf/math/proto-wrap.js'), 'utf8');
  const server = await startFixtureServer();
  let browser;
  const runs = [];
  let browserVersion;
  try {
    browser = await chromium.launch({ channel: 'chromium', headless: true });
    const probe = await browser.newPage();
    browserVersion = await (await probe.context().newCDPSession(probe)).send('Browser.getVersion');
    assert.match(browserVersion.product, /^(?:Chrome|HeadlessChrome)\/153\./, 'Chromium 153 required');
    await probe.close();
    for (const scenario of scenarios) {
      for (let index = 0; index < 5; index++) {
        // Rotate order to distribute thermal/JIT drift. Each sample has its own fresh realm/context.
        const order = modes.map((_, offset) => modes[(index + offset) % modes.length]);
        for (const mode of order) {
          const context = await browser.newContext();
          try {
            if (mode !== 'baseline') {
              await context.addInitScript({ content: source + '\nglobalThis.__mathMode = ' + JSON.stringify(mode) + ';' });
            }
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.goto(server.origins[0] + '/perf/math-' + scenario + '.html');
            await page.waitForFunction(() => document.getElementById('result')?.textContent, undefined, { timeout: 180_000 });
            assert.deepEqual(errors, []);
            const result = JSON.parse(await page.locator('#result').textContent());
            validateRun(result, scenario, mode);
            const previous = runs.find((r) => r.scenario === scenario);
            if (previous) assert.equal(result.checksum, previous.checksum, 'Workload result changed');
            runs.push({ index: index + 1, ...result });
            console.log(`math: ${scenario} ${index + 1}/5 ${mode}: ${result.totalMs.toFixed(3)} ms`);
          } finally { await context.close(); }
        }
      }
    }
  } finally {
    try { await browser?.close(); } finally { await server.close(); }
  }
  const metrics = {};
  const table = [];
  for (const scenario of scenarios) {
    const names = scenario === 'animation' ? ['totalMs', 'workMs', 'workMsPerFrame', 'frames', 'frameIntervalP95Ms'] : ['totalMs'];
    metrics[scenario] = {};
    for (const metric of names) {
      const summaries = Object.fromEntries(modes.map((mode) => [mode, summarize(runs.filter((r) => r.scenario === scenario && r.mode === mode)
        .map((r) => metric === 'workMsPerFrame' ? r.workMs / r.frames : metric === 'frameIntervalP95Ms' ? summarize(r.frameIntervalsMs).p95 : r[metric]))]));
      const overhead = Object.fromEntries(['fast', 'naive'].map((mode) => [mode, compare(summaries.baseline, summaries[mode])]));
      metrics[scenario][metric] = { ...summaries, overhead };
      for (const mode of modes) table.push({ scenario, metric, mode, median: summaries[mode].median.toFixed(3), p95: summaries[mode].p95.toFixed(3),
        'delta median %': mode === 'baseline' ? '-' : overhead[mode].medianPct.toFixed(2),
        'delta p95 %': mode === 'baseline' ? '-' : overhead[mode].p95Pct.toFixed(2) });
    }
  }
  // The hot-loop target is proposed, not a test gate. A successful command can report no-go.
  const decision = metrics.single.totalMs.overhead.fast.medianPct <= 5 ? 'go-limited' : 'no-go';
  const results = {
    schemaVersion: 1, task: 'P09', generatedAt: new Date().toISOString(), decision,
    machine: { platform: process.platform, release: os.release(), arch: process.arch, cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length, memoryGiB: os.totalmem() / 1024 ** 3, node: process.version },
    chromium: browserVersion,
    method: { runsPerMode: 5, headless: true, channel: 'chromium', extensionLoaded: false,
      warmup: '1000 iterations; animation: one 256-pair kernel; counters reset before timing',
      isolation: 'fresh context/realm per sample; one browser; serial samples; rotating mode order',
      statistic: 'median and nearest-rank p95 across 5 runs; p95 = maximum, not a stable tail estimate',
      proposedHotMedianOverheadPct: 5, secondHardwareClassMeasured: false,
      decisionRule: 'single fast median > 5%: no-go; otherwise go-limited pending second hardware and full sensor costs',
      allocations: 'no explicit fast observer allocations; arguments materialization/GC not profiled',
      omittedCosts: ['window scheduling', 'bounded stack sampling', 'attribution', 'bridge', 'storage', 'classifier'] },
    metrics, runs,
  };
  const archive = 'docs/coverage/perf/math-spike-' + results.generatedAt.replace(/:/g, '-') + '.json';
  for (const output of ['tests/perf/math/results.json', archive]) {
    mkdirSync(path.dirname(path.join(root, output)), { recursive: true });
    writeFileSync(path.join(root, output), JSON.stringify(results, null, 2) + '\n');
  }
  console.table(table);
  console.log(`math: ${decision}; proposed hot median target <= 5%; second hardware class not measured`);
  console.log('math: evidence saved to tests/perf/math/results.json and ' + archive);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
