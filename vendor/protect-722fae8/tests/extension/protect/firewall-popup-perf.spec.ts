// E21-09 perf gate of the firewall popup (ADR-020 §13), real service worker. Criteria written into E21-09
// before any measurement (2026-10-17T19:01:11Z): popup with the card — first useful content p95 ≤ 300 ms (P08
// method: DOMContentLoaded mark → the card heading and its alert in the DOM and visible → the next requestAnimationFrame;
// 20 new popup pages, warm SW, nearest-rank p95); click «Разрешить» → focus on the outcome heading p95 ≤ 200 ms
// (pointer click handler mark → focusin on #fw-resolved-title; 20 decisions, each undone through «Отменить решение»).
// Runs only with PROTECT_PERF_GATE=1 (decisive, thresholds asserted; the quiet perf phase) or PROTECT_PERF_SMOKE=1
// (2 iterations, harness check, numbers are not a result). PROTECT_PERF_RECORD=1 writes
// docs/coverage/perf/protect-firewall-ui-<ts>.json. Thresholds are never adjusted to a result.

import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { extensionIdOf, repoRoot } from '../harness';
import { launchFirewallStand, openStandPage, report, typeEmail } from './firewall-support';

const GATE = process.env['PROTECT_PERF_GATE'] === '1';
const SMOKE = process.env['PROTECT_PERF_SMOKE'] === '1';
const RECORD = process.env['PROTECT_PERF_RECORD'] === '1';
const CRITERIA = { firstContentP95Ms: 300, focusP95Ms: 200 };

function p95(samples: number[]): number {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.ceil(s.length * 0.95) - 1] ?? Number.NaN;
}

test.skip(!GATE && !SMOKE, 'E21-09 perf: PROTECT_PERF_GATE=1 (quiet perf phase) or PROTECT_PERF_SMOKE=1');

test('E21-09: popup with the firewall card — first useful content and click → focus on the outcome', async () => {
  test.setTimeout(300_000);
  const runs = GATE ? 20 : 2;
  const stand = await launchFirewallStand();
  try {
    const a = await openStandPage(stand, 'www.example.com', 'leak-form.html');
    await typeEmail(stand, a);
    await expect.poll(async () => (await report(stand, a.tabId)).firewall.prompt?.receivers ?? [], { timeout: 20_000 }).toContain('example.net');
    const url = 'chrome-extension://' + extensionIdOf(stand.sw) + '/popup.html?tabId=' + String(a.tabId);

    const firstContent: number[] = [];
    for (let i = 0; i < runs; i++) {
      const page = await stand.context.newPage();
      await page.setViewportSize({ width: 360, height: 600 });
      await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
          performance.mark('fw-dcl');
          const check = (): void => {
            const title = document.querySelector<HTMLElement>('#fw-card-title');
            const alert = document.querySelector<HTMLElement>('.fw-alert');
            if (title?.checkVisibility() && alert?.checkVisibility() && (alert.textContent ?? '').trim() !== '') {
              requestAnimationFrame(() => {
                performance.mark('fw-useful');
                performance.measure('fw-first-content', 'fw-dcl', 'fw-useful');
              });
            } else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        }, { once: true });
      });
      await page.goto(url);
      await page.waitForFunction(() => performance.getEntriesByName('fw-first-content').length === 1, undefined, { timeout: 10_000 });
      firstContent.push(await page.evaluate(() => performance.getEntriesByName('fw-first-content')[0]!.duration));
      await page.close();
    }

    const focus: number[] = [];
    const page = await stand.context.newPage();
    await page.setViewportSize({ width: 360, height: 600 });
    await page.goto(url);
    for (let i = 0; i < runs; i++) {
      await expect(page.locator('[data-fw-action=allow]')).toBeVisible({ timeout: 10_000 });
      await page.evaluate(() => {
        const w = window as unknown as { __fwFocus?: number };
        delete w.__fwFocus;
        document.querySelector('[data-fw-action=allow]')!.addEventListener('click', () => performance.mark('fw-click'), { once: true, capture: true });
        document.addEventListener('focusin', function onFocus(event) {
          if ((event.target as HTMLElement).id !== 'fw-resolved-title') return;
          document.removeEventListener('focusin', onFocus);
          performance.mark('fw-focus');
          w.__fwFocus = performance.measure('fw-click-focus', 'fw-click', 'fw-focus').duration;
        });
      });
      await page.locator('[data-fw-action=allow]').click();
      await page.waitForFunction(() => typeof (window as unknown as { __fwFocus?: number }).__fwFocus === 'number', undefined, { timeout: 10_000 });
      focus.push(await page.evaluate(() => (window as unknown as { __fwFocus: number }).__fwFocus));
      await page.evaluate(() => performance.clearMarks());
      await page.locator('[data-fw-undo]').click();
      await expect(page.locator('#fw-card-title')).toBeFocused({ timeout: 10_000 });
    }
    await page.close();

    const result = {
      requirement: 'E21-09 / ADR-020 §13',
      mode: GATE ? 'gate' : 'smoke (not a result)',
      timestamp: new Date().toISOString(),
      node: process.version,
      os: os.platform() + '-' + os.arch(),
      cpu: os.cpus()[0]?.model,
      firstContent: { samplesMs: firstContent, p95Ms: p95(firstContent), criterionMs: CRITERIA.firstContentP95Ms },
      clickFocus: { samplesMs: focus, p95Ms: p95(focus), criterionMs: CRITERIA.focusP95Ms },
      method: 'P08: DOMContentLoaded → card heading + alert visible → next rAF; click (capture) → focusin on #fw-resolved-title; nearest-rank p95; real warm SW, prompt from the real value-match path',
    };
    console.log(JSON.stringify(result));
    if (RECORD) {
      const dir = path.join(repoRoot, 'docs/coverage/perf');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'protect-firewall-ui-' + result.timestamp.replace(/[:.]/g, '-') + '.json'), JSON.stringify(result, null, 2) + '\n');
    }
    expect(firstContent).toHaveLength(runs);
    expect(focus).toHaveLength(runs);
    if (GATE) {
      expect(result.firstContent.p95Ms).toBeLessThanOrEqual(CRITERIA.firstContentP95Ms);
      expect(result.clickFocus.p95Ms).toBeLessThanOrEqual(CRITERIA.focusP95Ms);
    }
  } finally {
    await stand.close();
  }
});
