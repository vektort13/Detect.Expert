// E21-14 perf gate of the popup reminder about data requests (ADR-020 §13), real service worker. Criterion written into
// E21-14 before any measurement (2026-10-17T19:01:11Z): «разница открытия popup ≤ 10 мс». Method (written
// into the card before any measurement, see «Метод замера»): the module is active with value-match; the popup is opened
// 20 times (new page each, warm SW) in two journal states — (a) empty journal: the reminder asks once and renders
// nothing; (b) one overdue request: the reminder line is shown. «Popup open» = DOMContentLoaded mark → the module status
// line (#popup-protect-status) visible, and in (b) also [data-requests-reminder] visible → the next
// requestAnimationFrame. Criterion: median(b) − median(a) ≤ 10 ms.
// Runs only with PROTECT_PERF_GATE=1 (decisive, threshold asserted; the quiet perf phase) or PROTECT_PERF_SMOKE=1
// (2 iterations each, harness check, numbers are not a result). PROTECT_PERF_RECORD=1 writes
// docs/coverage/perf/protect-requests-popup-<ts>.json. The threshold is never adjusted to a result.

import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { extensionIdOf, getServiceWorker, repoRoot } from '../harness';
import { enableProtect, grantAllSites, launchProtect } from './support';
import { journalRecord, putJournalRecords, swLocalDay } from './requests-support';

const GATE = process.env['PROTECT_PERF_GATE'] === '1';
const SMOKE = process.env['PROTECT_PERF_SMOKE'] === '1';
const RECORD = process.env['PROTECT_PERF_RECORD'] === '1';
const CRITERIA = { openDeltaMedianMs: 10 };

function median(samples: number[]): number {
  const s = [...samples].sort((a, b) => a - b);
  if (s.length === 0) return Number.NaN;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

test.skip(!GATE && !SMOKE, 'E21-14 perf: PROTECT_PERF_GATE=1 (quiet perf phase) or PROTECT_PERF_SMOKE=1');

async function openTimes(context: BrowserContext, url: string, withReminder: boolean, runs: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < runs; i++) {
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 600 });
    await page.addInitScript((reminder: boolean) => {
      document.addEventListener('DOMContentLoaded', () => {
        performance.mark('rq-dcl');
        const check = (): void => {
          const status = document.querySelector<HTMLElement>('#popup-protect-status');
          const line = document.querySelector<HTMLElement>('[data-requests-reminder]');
          if (status?.checkVisibility() && (!reminder || line?.checkVisibility())) {
            requestAnimationFrame(() => {
              performance.mark('rq-open');
              performance.measure('rq-popup-open', 'rq-dcl', 'rq-open');
            });
          } else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }, { once: true });
    }, withReminder);
    await page.goto(url);
    await page.waitForFunction(() => performance.getEntriesByName('rq-popup-open').length === 1, undefined, { timeout: 10_000 });
    out.push(await page.evaluate(() => performance.getEntriesByName('rq-popup-open')[0]!.duration));
    await page.close();
  }
  return out;
}

test('E21-14: popup opening with the data-request reminder vs without', async () => {
  test.setTimeout(300_000);
  const runs = GATE ? 20 : 2;
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    expect((await enableProtect(sw, ['value-match'])).state?.state).toBe('active');
    const url = 'chrome-extension://' + extensionIdOf(sw) + '/popup.html';
    // Warm-up (SW and the journal cache).
    await openTimes(ext.context, url, false, 1);
    const empty = await openTimes(ext.context, url, false, runs);
    const created = await swLocalDay(sw, -60);
    const sent = await swLocalDay(sw, -59);
    await putJournalRecords(sw, [journalRecord({ requestId: 'rq_perfaaaaaaaaaaaaaaaa', createdDay: created, status: 'sent', statusDay: sent, sentDay: sent, deadlineDay: await swLocalDay(sw, -29), extendedDeadlineDay: null, history: [{ status: 'prepared', day: created }, { status: 'sent', day: sent }] })]);
    await openTimes(ext.context, url, true, 1);
    const reminder = await openTimes(ext.context, url, true, runs);
    const result = {
      requirement: 'E21-14 / ADR-020 §13',
      mode: GATE ? 'gate' : 'smoke (not a result)',
      timestamp: new Date().toISOString(),
      node: process.version,
      os: os.platform() + '-' + os.arch(),
      cpu: os.cpus()[0]?.model,
      emptyJournal: { samplesMs: empty, medianMs: median(empty) },
      overdueReminder: { samplesMs: reminder, medianMs: median(reminder) },
      deltaMedianMs: median(reminder) - median(empty),
      criterionMs: CRITERIA.openDeltaMedianMs,
      method: 'DOMContentLoaded → #popup-protect-status (+ [data-requests-reminder] in b) visible → next rAF; new popup page per run, warm SW; median(b) − median(a)',
    };
    console.log(JSON.stringify(result));
    if (RECORD) {
      const dir = path.join(repoRoot, 'docs/coverage/perf');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'protect-requests-popup-' + result.timestamp.replace(/[:.]/g, '-') + '.json'), JSON.stringify(result, null, 2) + '\n');
    }
    expect(empty).toHaveLength(runs);
    expect(reminder).toHaveLength(runs);
    if (GATE) expect(result.deltaMedianMs).toBeLessThanOrEqual(CRITERIA.openDeltaMedianMs);
  } finally {
    await ext.close();
  }
});
