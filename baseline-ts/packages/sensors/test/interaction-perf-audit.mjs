// Bounded source microbenchmark, not a whole-extension performance acceptance gate.
// All API calls belong to this controlled page. Coordinate values remain in-page.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '../../..');
const output = path.join(root, 'test-results/prod/reports/interaction'); mkdirSync(output, { recursive: true });
const bundled = await build({ stdin: { contents: "export { SensorRuntime, browserEnv } from './packages/sensors/src/runtime'; export { installInteractionSensor } from './packages/sensors/src/interaction';", resolveDir: root, sourcefile: 'interaction-perf.ts', loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'InteractionPerf', platform: 'browser', target: 'es2022', logLevel: 'silent' });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = { at: new Date().toISOString(), browser: browser.version(), extensionLoaded: false, controlledPageOnly: true,
  scope: 'Isolated source microbenchmark on a shared machine; no full-extension/global performance gate claim.',
  samples: 9, loops: { movementRegistration: 100000, unrelatedRegistration: 100000, coordinateGetter: 500000 },
  warmup: { registration: 5000, getter: 10000 }, completed: false };
try {
  const page = await browser.newPage(); await page.addScriptTag({ content: bundled.outputFiles[0].text });
  evidence.rows = await page.evaluate(() => {
    const clock = performance.now.bind(performance), target = new EventTarget(), callback = () => {}, event = new MouseEvent('click', { clientX: 41.25 });
    const rows = [];
    function registration(type, count) { for (let index = 0; index < count; index++) target.addEventListener(type, callback); }
    function getter(count) { let value = 0; for (let index = 0; index < count; index++) value += event.clientX; return value; }
    function measure() {
      registration('mousemove', 5000); registration('click', 5000); getter(10000);
      let start = clock(); registration('mousemove', 100000); const movementRegistration = clock() - start;
      start = clock(); registration('click', 100000); const unrelatedRegistration = clock() - start;
      start = clock(); const checksum = getter(500000), coordinateGetter = clock() - start;
      return { times: { movementRegistration, unrelatedRegistration, coordinateGetter }, checksum };
    }
    for (let index = 0; index < 9; index++) {
      let native;
      if (index % 2 === 0) native = measure();
      const runtime = new InteractionPerf.SensorRuntime(InteractionPerf.browserEnv(window)); InteractionPerf.installInteractionSensor(runtime, window);
      const observed = measure();
      const counts = runtime.snapshot().counters.map(c => ({ count: c.count, signals: c.signalCodes }));
      runtime.pause(); const paused = measure();
      const pausedCountsSame = JSON.stringify(runtime.snapshot().counters.map(c => ({ count: c.count, signals: c.signalCodes }))) === JSON.stringify(counts);
      runtime.stop('local');
      if (index % 2 !== 0) native = measure();
      rows.push({ native: native.times, observed: observed.times, paused: paused.times,
        sameResult: Object.is(native.checksum, observed.checksum) && Object.is(native.checksum, paused.checksum), pausedCountsSame, counts });
    }
    return rows;
  });
  assert.equal(evidence.rows.length, evidence.samples);
  assert.ok(evidence.rows.every(row => row.sameResult && row.pausedCountsSame && row.counts.length === 2 &&
    row.counts.some(counter => counter.count === 105000 && counter.signals.includes('movement-listener')) &&
    row.counts.some(counter => counter.count === 510000 && counter.signals.includes('pointer-coordinate-read'))));
  const percentile = (values, percentile) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * percentile) - 1];
  evidence.summary = Object.fromEntries(Object.entries(evidence.loops).map(([name, count]) => {
    const modes = Object.fromEntries(['native', 'observed', 'paused'].map(mode => {
      const values = evidence.rows.map(row => row[mode][name]);
      return [mode, { p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), p50NanosecondsPerCall: percentile(values, 0.5) * 1e6 / count }];
    }));
    return [name, { ...modes, p50AddedNanosecondsPerCall: modes.observed.p50NanosecondsPerCall - modes.native.p50NanosecondsPerCall,
      p50OverheadPercent: (modes.observed.p50Ms - modes.native.p50Ms) / modes.native.p50Ms * 100 }];
  }));
  evidence.completed = true;
  console.log(JSON.stringify(evidence.summary));
} finally {
  await browser.close(); writeFileSync(path.join(output, 'sensor-perf.json'), JSON.stringify(evidence, null, 2) + '\n');
}
