// ADR-048: bounded native baseline / Custom getter measurement, without page traffic.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installApiCustom } from '../../apps/production-extension/api-custom-runtime.js';
import { installApiCustomDocument } from '../../apps/production-extension/api-custom-document-runtime.js';

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage();
  await page.evaluate('window.__benchmarkInstall = (' + installApiCustom.toString() + ')');
  const measurements = await page.evaluate(() => {
    const install = window.__benchmarkInstall, original = navigator.hardwareConcurrency;
    const samples = 9, iterations = 100000, entries = [
      { id: 'hardware-concurrency', mode: 'custom', value: 16 },
      { id: 'screen-width', mode: 'custom', value: 1920 },
      { id: 'screen-height', mode: 'custom', value: 1080 },
      { id: 'navigator-platform', mode: 'custom', value: 'Test platform' },
    ];
    function median(values) { return values.sort((a, b) => a - b)[Math.floor(values.length / 2)]; }
    function measure(read) {
      let checksum = 0;
      for (let index = 0; index < 10000; index++) checksum += read();
      const times = [];
      for (let sample = 0; sample < samples; sample++) {
        const begin = performance.now();
        for (let index = 0; index < iterations; index++) checksum += read();
        times.push(performance.now() - begin);
      }
      return { medianMs: median(times), checksum };
    }
    const native = measure(() => navigator.hardwareConcurrency);
    const durations = [], installationBatch = 100;
    for (let sample = 0; sample < samples; sample++) {
      const begin = performance.now();
      for (let iteration = 0; iteration < installationBatch; iteration++) install(window, entries).stop();
      durations.push((performance.now() - begin) / installationBatch);
    }
    const handle = install(window, entries), snapshot = handle.snapshot();
    const custom = measure(() => navigator.hardwareConcurrency);
    const selected = navigator.hardwareConcurrency;
    handle.stop();
    return { iterations, samples, installationBatch, installRestoreFourMedianMs: median(durations), native, custom,
      customOverheadNsPerRead: (custom.medianMs - native.medianMs) * 1e6 / iterations,
      selected, restored: navigator.hardwareConcurrency === original, snapshot };
  });
  assert.equal(measurements.selected, 16);
  assert.equal(measurements.snapshot.installed, 4);
  assert.equal(measurements.snapshot.unavailable, 0);
  assert.equal(measurements.restored, true);
  const documentPage = await browser.newPage();
  await documentPage.evaluate('window.__benchmarkInstall = (' + installApiCustom.toString() + '); window.__benchmarkDocument = (' + installApiCustomDocument.toString() + ')');
  const documentMeasurements = await documentPage.evaluate(() => {
    const iterations = 2000, samples = 7;
    function run() {
      const values = [];
      for (let sample = 0; sample < samples; sample++) {
        const parent = document.createElement('section'); document.body.appendChild(parent);
        const begin = performance.now();
        for (let index = 0; index < iterations; index++) parent.appendChild(document.createElement('span'));
        values.push(performance.now() - begin); parent.remove();
      }
      return values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    }
    const nativeAppendMedianMs = run(), begin = performance.now();
    window.__benchmarkDocument(window, [{ id: 'hardware-concurrency', mode: 'custom', value: 257 }], window.__benchmarkInstall);
    const documentInstallMs = performance.now() - begin, customAppendMedianMs = run();
    const frame = document.createElement('iframe'); document.body.appendChild(frame);
    return { iterations, samples, documentInstallMs, nativeAppendMedianMs, customAppendMedianMs,
      addedMicrosecondsPerAppend: (customAppendMedianMs - nativeAppendMedianMs) * 1000 / iterations,
      inheritedCpu: frame.contentWindow.navigator.hardwareConcurrency };
  });
  assert.equal(documentMeasurements.inheritedCpu, 257);
  console.log(JSON.stringify({ browser: browser.version(), ...measurements, documentMeasurements }, null, 2));
} finally { await browser.close(); }
