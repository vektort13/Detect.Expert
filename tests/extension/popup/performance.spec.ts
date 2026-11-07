// P08 / ADR-011 / spec V §8: actual warm-SW projection, never the screenshot reply hook.
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, extensionIdOf, repoRoot } from '../harness';
import { observed, waitForReport, getReport, swAlive } from '../helpers';

test('P08: 20 warm-worker popup openings measure first useful content', async ({ ext, fixtures }, testInfo) => {
  const { sw, ui, tabId } = await observed(ext, fixtures.origins[0] + '/canvas-editor-negative.html');
  const report = await waitForReport(ui, tabId, (rep) => rep.techniques.length > 0);
  expect(await swAlive(ui)).toBe(true);
  const expectedHost = report.host ?? await ui.evaluate(() => chrome.i18n.getMessage('host_unknown'));
  const loading = await ui.evaluate(() => chrome.i18n.getMessage('statusLoading'));
  const samplesMs: number[] = [];
  for (let i = 0; i < 20; i++) {
    expect((await getReport(ui, tabId))?.documentKey).toBe(report.documentKey);
    const page = await ext.context.newPage();
    await page.setViewportSize({ width: 360, height: 800 });
    await page.addInitScript(({ expectedHost, loading }) => {
      document.addEventListener('DOMContentLoaded', () => {
        performance.mark('p08-dom-content-loaded');
        const check = () => {
          const host = document.querySelector<HTMLElement>('.host');
          const coverage = document.querySelector<HTMLElement>('#coverage-title');
          if (host?.textContent?.trim() === expectedHost && coverage?.checkVisibility() && coverage.textContent?.trim() && coverage.textContent !== loading && document.querySelector('.header__since')) {
            // The next frame includes a paint opportunity for the observed host + coverage DOM.
            requestAnimationFrame(() => {
              performance.mark('p08-useful-content');
              performance.measure('p08-first-content', 'p08-dom-content-loaded', 'p08-useful-content');
            });
          } else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }, { once: true });
    }, { expectedHost, loading });
    await page.goto(`chrome-extension://${extensionIdOf(sw)}/popup.html?tabId=${tabId}`);
    await page.waitForFunction(() => performance.getEntriesByName('p08-first-content').length === 1);
    samplesMs.push(await page.evaluate(() => performance.getEntriesByName('p08-first-content')[0]!.duration));
    await page.close();
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const medianMs = (sorted[9]! + sorted[10]!) / 2;
  const p95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
  const timestamp = new Date().toISOString();
  const result = { requirement: 'P08 / ТЗ V §8', timestamp, browser: ext.context.browser()!.version(), node: process.version, os: os.platform() + '-' + os.arch(), cpu: os.cpus()[0]?.model, profile: 'test', sampleCount: samplesMs.length, samplesMs, medianMs, p95Ms, targetMs: 300, targetMet: p95Ms <= 300, method: 'DOMContentLoaded mark → host + coverage DOM → следующий requestAnimationFrame (возможность paint); nearest-rank p95; 20 последовательных новых страниц, тёплый SW и сохранённый отчёт, реальные ui-get-scope/ui-get-report', limitations: 'Одна машина, headless Chromium, popup как страница. Loopback host редактируется до null: измеряется честный host_unknown. Это не замер compositor presentation и не branded/native toolbar latency.' };
  const directory = path.join(repoRoot, 'docs/coverage/perf');
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'popup-' + timestamp.replace(/[:.]/g, '-') + '.json');
  writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
  await testInfo.attach('popup-performance', { path: file, contentType: 'application/json' });
  console.log(JSON.stringify(result));
  expect(samplesMs).toHaveLength(20);
  expect(samplesMs.every((sample) => Number.isFinite(sample) && sample > 0)).toBe(true);
  // P08 explicitly requires reporting a missed target without tuning the threshold.
});
