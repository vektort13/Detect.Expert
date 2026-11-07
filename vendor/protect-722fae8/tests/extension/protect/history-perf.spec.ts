// ADR-020 §13, E21-12 perf gate of the history (Playwright part). Criteria written into E21-12 on
// 2026-10-17T19:01:11Z, before any measurement: flush of 512 deltas ≤ 40 ms p95; query over 16 384 sightings ≤ 120 ms
// p95; clearing ≤ 3 s in total; navigator.storage.estimate().usage ≤ 16 MiB with a full history. Timings are taken
// inside the service worker (__protectHarness.inject('history', {bench})), numbers only.
// The decisive run belongs to the quiet perf phase (other lanes load the machine meanwhile): the spec runs only with
// PROTECT_PERF=1 and is skipped otherwise. A threshold is never adjusted to a result; a miss is a no-go with numbers.

import { expect, test } from '@playwright/test';
import type { Worker } from '@playwright/test';
import { getServiceWorker } from '../harness';
import { brief } from '../helpers';
import { enableProtect, grantAllSites, launchProtect } from './support';

const CRITERIA = { flushP95Ms: 40, queryP95Ms: 120, clearTotalMs: 3000, estimateBytes: 16 * 1024 * 1024 } as const;

async function inject(sw: Worker, payload: unknown): Promise<Record<string, unknown>> {
  return sw.evaluate(async (p) => {
    const h = (globalThis as unknown as { __protectHarness?: { inject(name: string, payload: unknown): Promise<unknown> } }).__protectHarness;
    if (h === undefined) throw new Error('__protectHarness is missing (test profiles only)');
    return (await h.inject('history', p)) as Record<string, unknown>;
  }, payload);
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
}

test('history perf gate (E21-12): flush, query, clear, storage estimate', async () => {
  test.skip(process.env['PROTECT_PERF'] !== '1', 'decisive perf runs only in the quiet perf phase (PROTECT_PERF=1)');
  test.setTimeout(600_000);
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    expect((await enableProtect(sw, ['history'])).state?.state).toBe('active');
    const flush: number[] = [];
    for (let i = 0; i < 20; i++) flush.push(Number((await inject(sw, { bench: 'flush', n: 512 }))['ms']));
    // A full history within the limits: 16 000 sightings (2000 receivers × 8 sites; ≤ 2048 receivers and sites).
    const seeded = await inject(sw, { seed: { receivers: 2000, sitesPerReceiver: 8 } });
    const query: number[] = [];
    for (let i = 0; i < 20; i++) query.push(Number((await inject(sw, { bench: 'query' }))['ms']));
    const estimate = await sw.evaluate(async () => (await navigator.storage.estimate()).usage ?? -1);
    const clear = Number((await inject(sw, { bench: 'clear' }))['ms']);
    const result = { flushP95Ms: p95(flush), queryP95Ms: p95(query), clearTotalMs: clear, estimateBytes: estimate, seeded: seeded['sightings'] };
    console.log('perf: history ' + JSON.stringify(result));
    expect(Number(seeded['sightings']), brief(seeded)).toBeGreaterThanOrEqual(16_000);
    expect(result.flushP95Ms).toBeLessThanOrEqual(CRITERIA.flushP95Ms);
    expect(result.queryP95Ms).toBeLessThanOrEqual(CRITERIA.queryP95Ms);
    expect(result.clearTotalMs).toBeLessThanOrEqual(CRITERIA.clearTotalMs);
    expect(result.estimateBytes).toBeGreaterThanOrEqual(0);
    expect(result.estimateBytes).toBeLessThanOrEqual(CRITERIA.estimateBytes);
  } finally {
    await ext.close();
  }
});
