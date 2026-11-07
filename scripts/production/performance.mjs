// ADR-017 / REQ-011: local comparative measurement, no invented pass threshold.
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '../..'), temporary = join(root, '.tmp');
const artifact = join(root, 'test-results/production-1.1.0/performance.json');
mkdirSync(temporary, { recursive: true }); mkdirSync(join(root, 'test-results/production-1.1.0'), { recursive: true });
const server = createServer((_, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><title>Local measurement</title><main>ready</main>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const modes = [
  { name: 'baseline' },
  { name: '1.0.0 passive', directory: 'release/Detect.Expert-1.0.0-CWS-2026-09-16-r2' },
  { name: '1.1.0 passive', directory: 'apps/production-extension' },
  { name: '1.1.0 active Pro', directory: 'apps/production-extension', pro: true },
];
const metrics = ['measureTextMs', 'getImageDataMs', 'innerWidthMs', 'fontCheckMs', 'offsetWidthMs', 'svgTextLengthMs', 'nodeInsertionMs', 'ordinaryAttributeMs', 'sourceAttributeMs', 'totalMs'];
const evidence = { workload: { measureText: 30000, getImageData: 1000, innerWidth: 50000, fontCheck: 10000, offsetWidth: 50000, svgTextLength: 10000, nodeInsertion: 5000, ordinaryAttribute: 10000, sourceAttribute: 5000 }, warmup: 1, measuredRounds: 6, threshold: null, runs: [] };
try {
  for (const mode of modes) {
    const profile = mkdtempSync(join(temporary, 'production-perf-'));
    const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true });
    try {
      const page = await context.newPage();
      if (mode.directory) await page.addInitScript({ content: readFileSync(join(root, mode.directory, 'hook.early.js'), 'utf8') });
      await page.goto('http://127.0.0.1:' + server.address().port);
      if (mode.directory) await page.evaluate(() => new Promise(resolve => {
        globalThis.fixtureBatches = [];
        window.addEventListener('message', event => {
          if (event.source !== window || event.data?.channel !== 'detect.expert/v1') return;
          if (event.data.type === 'sensor-batch') fixtureBatches.push(event.data);
          if (event.data.type === 'sensor-hello') {
            window.postMessage({ channel: 'detect.expert/v1', sensorBootId: event.data.sensorBootId, type: 'bridge-hello', protocolVersion: 1, bridgeSessionId: 'performance', paused: false }, '*');
            resolve();
          }
        });
        window.postMessage({ channel: 'detect.expert/v1', sensorBootId: 'unbound', type: 'bridge-hello', protocolVersion: 1, bridgeSessionId: 'performance', paused: false }, '*');
        setTimeout(() => resolve(), 1500);
      }));
      if (mode.pro) {
        await page.evaluate(() => window.postMessage({ channel: 'detect.expert/pro-values/v1', type: 'pro-values-start', sessionId: 'performance', requestId: 'pro-1' }, '*'));
        await page.waitForTimeout(550);
      }
      const samples = [];
      for (let round = 0; round < 7; round++) {
        const result = await page.evaluate(workload => {
          const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.textContent = 'fixed local fixture'; svg.appendChild(text); document.body.appendChild(svg);
          let checksum = 0, start = performance.now();
          for (let index = 0; index < workload.measureText; index++) checksum += ctx.measureText('fixed local fixture').width;
          const measureTextMs = performance.now() - start; start = performance.now();
          for (let index = 0; index < workload.getImageData; index++) checksum += ctx.getImageData(0, 0, 1, 1).data.length;
          const getImageDataMs = performance.now() - start; start = performance.now();
          for (let index = 0; index < workload.innerWidth; index++) checksum += window.innerWidth;
          const innerWidthMs = performance.now() - start; start = performance.now();
          for (let index = 0; index < workload.fontCheck; index++) checksum += document.fonts.check('12px sans-serif');
          const fontCheckMs = performance.now() - start; start = performance.now();
          for (let index = 0; index < workload.offsetWidth; index++) checksum += document.body.offsetWidth;
          const offsetWidthMs = performance.now() - start; start = performance.now();
          for (let index = 0; index < workload.svgTextLength; index++) checksum += text.getComputedTextLength();
          const svgTextLengthMs = performance.now() - start;
          svg.remove();
          const parent = document.createElement('div'), child = document.createElement('span');
          document.body.appendChild(parent); start = performance.now();
          for (let index = 0; index < workload.nodeInsertion; index++) { parent.appendChild(child); parent.removeChild(child); }
          const nodeInsertionMs = performance.now() - start; parent.remove();
          start = performance.now();
          for (let index = 0; index < workload.ordinaryAttribute; index++) {
            child.setAttribute('class', 'fixture'); child.setAttribute('aria-label', 'fixture'); child.setAttribute('style', 'color: blue');
          }
          const ordinaryAttributeMs = performance.now() - start;
          const image = document.createElement('img'); start = performance.now();
          for (let index = 0; index < workload.sourceAttribute; index++) image.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
          const sourceAttributeMs = performance.now() - start;
          return { measureTextMs, getImageDataMs, innerWidthMs, fontCheckMs, offsetWidthMs, svgTextLengthMs, nodeInsertionMs, ordinaryAttributeMs, sourceAttributeMs, totalMs: measureTextMs + getImageDataMs + innerWidthMs + fontCheckMs + offsetWidthMs + svgTextLengthMs + nodeInsertionMs + ordinaryAttributeMs + sourceAttributeMs, checksum };
        }, evidence.workload);
        if (round > 0) samples.push(result); // first round warms native and observer paths
      }
      let proRows = null;
      if (mode.pro) proRows = await page.evaluate(() => new Promise(resolve => {
        const listener = event => { if (event.source === window && event.data?.type === 'pro-values-batch' && event.data.requestId === 'pro-2') { window.removeEventListener('message', listener); resolve(event.data.rows); } };
        window.addEventListener('message', listener);
        window.postMessage({ channel: 'detect.expert/pro-values/v1', type: 'pro-values-read', sessionId: 'performance', requestId: 'pro-2' }, '*');
        setTimeout(() => resolve(null), 1500);
      }));
      if (mode.pro) assert.ok(proRows?.some(row => row.operation === 'Window.innerWidth' && row.count > 1000), 'active history confirmed');
      await page.waitForTimeout(550);
      const observed = mode.directory ? await page.evaluate(() => fixtureBatches.flatMap(batch => batch.observations ?? []).map(row => ({ techniqueId: row.techniqueId, count: row.count }))) : [];
      if (mode.directory) assert.ok(observed.some(row => row.techniqueId === 'DET-002') && observed.some(row => row.techniqueId === 'DET-003'), 'native hooks emitted observed workload');
      const median = Object.fromEntries(metrics.map(key => {
        const sorted = samples.map(sample => sample[key]).sort((a, b) => a - b);
        return [key, (sorted[2] + sorted[3]) / 2];
      }));
      evidence.runs.push({ mode: mode.name, browser: context.browser().version(), samples, median, observed, proRows });
      console.log(mode.name + ': median ' + median.totalMs.toFixed(2) + 'ms');
    } finally {
      await context.close(); assert.ok(profile.startsWith(temporary + sep));
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
} finally {
  writeFileSync(artifact, JSON.stringify(evidence, null, 2) + '\n');
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
