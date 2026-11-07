import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';

if (!process.argv[2]) throw new Error('Pass an output JSON path with an existing parent directory');
const output = path.resolve(process.argv[2]);
const root = path.resolve(import.meta.dirname, '../../..');
const dist = path.join(root, 'dist/local');
const runs = 5, calls = 400, warmup = 40;
const results = [];
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/resource') { response.writeHead(204); response.end(); }
  else {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>Owned HTTP performance fixture</title><script>void navigator.hardwareConcurrency;</script>');
  }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = 'http://127.0.0.1:' + server.address().port;
let browserVersion;
try {
  for (let index = 0; index < runs; index++) for (const enabled of [false, true]) {
    const profile = mkdtempSync(path.join(os.tmpdir(), 'detect-extension-http-perf-'));
    let context;
    try {
      context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true,
        args: enabled ? ['--enable-unsafe-extension-debugging'] : [], ignoreDefaultArgs: enabled ? ['--disable-extensions'] : [] });
      browserVersion = context.browser().version();
      let ui;
      if (enabled) {
        const cdp = await context.browser().newBrowserCDPSession();
        const extension = await cdp.send('Extensions.loadUnpacked', { path: dist }); await cdp.detach();
        ui = await context.newPage(); await ui.goto('chrome-extension://' + extension.id + '/options.html');
        await ui.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-get-scope' }));
        await expect.poll(() => ui.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length)).toBeGreaterThanOrEqual(2);
      }
      const page = await context.newPage(); await page.goto(origin);
      let tabId;
      if (ui) {
        tabId = await ui.evaluate(async origin => (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(origin))?.id, origin);
        await expect.poll(async () => {
          const response = await ui.evaluate(tabId => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-get-report', tabId }), tabId);
          return response.report?.techniques.find(item => item.techniqueId === 'DET-032')?.count ?? 0;
        }).toBe(1);
      }
      const timings = await page.evaluate(async ({ calls, warmup, origin }) => {
        const url = origin + '/resource';
        async function workload(kind, count) {
          let completed = 0, next = 0;
          const started = performance.now();
          await Promise.all(Array.from({ length: 20 }, async () => {
            while (next < count) {
              next++;
              if (kind === 'fetch') {
                const response = await fetch(url);
                if (response.status !== 204) throw new Error('Unexpected fixture response');
              } else await new Promise((resolve, reject) => {
                const request = new XMLHttpRequest();
                request.onload = () => request.status === 204 ? resolve() : reject(new Error('Unexpected XHR response'));
                request.onerror = () => reject(new Error('Fixture XHR failed'));
                request.open('GET', url); request.send();
              });
              completed++;
            }
          }));
          return { milliseconds: performance.now() - started, completed };
        }
        await workload('fetch', warmup); await workload('xhr', warmup);
        return { fetch: await workload('fetch', calls), xhr: await workload('xhr', calls) };
      }, { calls, warmup, origin });
      assert.equal(timings.fetch.completed, calls); assert.equal(timings.xhr.completed, calls);
      if (ui) {
        await expect.poll(async () => {
          const response = await ui.evaluate(tabId => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-get-report', tabId }), tabId);
          assert.equal(response.report?.extensionResources, undefined);
          return response.report?.techniques.find(item => item.techniqueId === 'DET-059')?.count ?? 0;
        }).toBe(2 * (calls + warmup));
      }
      results.push({ run: index + 1, enabled, timings });
      console.log('HTTP A/B ' + (index + 1) + ': ' + (enabled ? 'with' : 'without') + ', fetch=' + timings.fetch.milliseconds.toFixed(1) + 'ms, XHR=' + timings.xhr.milliseconds.toFixed(1) + 'ms');
    } finally {
      await context?.close(); rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    }
  }
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
const summary = Object.fromEntries(['fetch', 'xhr'].map(method => {
  const samples = enabled => results.filter(row => row.enabled === enabled).map(row => row.timings[method].milliseconds).sort((first, second) => first - second);
  const baseline = samples(false), active = samples(true);
  return [method, { baselineMedianMs: baseline[2], activeMedianMs: active[2], baselineP95Ms: baseline[4], activeP95Ms: active[4],
    medianChangePercent: (active[2] - baseline[2]) / baseline[2] * 100, p95ChangePercent: (active[4] - baseline[4]) / baseline[4] * 100 }];
}));
writeFileSync(output, JSON.stringify({ completed: true, browser: browserVersion, node: process.version, calls, warmup, runs,
  ownedLoopbackOnly: true, scope: 'Full extension HTTP request latency; not an isolated wrapper cost or a universal overhead guarantee. p95 is max for n=5.',
  hookSha256: createHash('sha256').update(readFileSync(path.join(dist, 'hook.main.js'))).digest('hex'), summary, results }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));