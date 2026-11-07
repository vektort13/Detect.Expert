// ADR-020 §G (S12, E21-12 cases 2, 3, 5): the history «Кто вас узнаёт» in a real Chromium (test profile).
//   two sites (example.com, example.net) with the receiver tracker.example.org → row d:example.org, sites = 2, and
//   frame-techniques (canvas in the receiver's own frame: frame-only, page-controlled);
//   synthetic value-match events on both sites (harness; the real matching is S07's stand) → value-match high;
//   __protectHarness.inject('history', {dayOffset: 91}) → the retention empties the history stores;
//   export = preview (sites site-N by default, names only when asked), «Удалить всю историю», feature off → no record.
// The IndexedDB dump holds domains, day numbers, enums and counts only: no URL, path, query or time of day.

import { expect, test } from '@playwright/test';
import type { Worker } from '@playwright/test';
import type { HistoryExport, HistoryProjection } from '@detect-expert/contracts';
import { getServiceWorker, startFixtureServer } from '../harness';
import type { ExtensionSession, FixtureServer } from '../harness';
import { brief, fixtureResult } from '../helpers';
import { dumpProtectDb, enableProtect, grantAllSites, launchProtect, protectRoute, standUrl } from './support';

const RECEIVER = 'tracker.example.org';
const SITES = ['www.example.com', 'www.example.net'];
const HISTORY_STORES = ['sightings', 'receivers', 'sites'] as const;

async function inject(sw: Worker, payload: unknown): Promise<Record<string, unknown>> {
  return sw.evaluate(async (p) => {
    const h = (globalThis as unknown as { __protectHarness?: { inject(name: string, payload: unknown): Promise<unknown> } }).__protectHarness;
    if (h === undefined) throw new Error('__protectHarness is missing (test profiles only)');
    return (await h.inject('history', p)) as Record<string, unknown>;
  }, payload);
}

async function query(sw: Worker, extra: Record<string, unknown> = {}): Promise<HistoryProjection> {
  const r = await protectRoute(sw, { type: 'ui-protect-history-query', windowDays: 30, offset: 0, limit: 50, ...extra });
  if (r.type !== 'protect-history') throw new Error('history query answered ' + brief(r));
  return (r as unknown as { history: HistoryProjection }).history;
}

async function visitSites(ext: ExtensionSession, server: FixtureServer): Promise<void> {
  for (const host of SITES) {
    const page = await ext.context.newPage();
    await page.goto(standUrl(server.origins[0]!, host, '/protect/history/site.html?receiver=' + RECEIVER));
    expect(await fixtureResult(page), host).toMatchObject({ receiver: true, script: 'load', frame: 'load' });
    const frame = page.frames().find((f) => f.url().includes('/protect/history/widget.html'));
    if (frame === undefined) throw new Error('widget frame missing on ' + host);
    expect(await fixtureResult(frame)).toMatchObject({ exported: true });
  }
}

function historyCounts(dump: Record<string, unknown[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of HISTORY_STORES) out[s] = (dump[s] ?? []).length;
  out['meta.history'] = (dump['meta'] ?? []).filter((m) => String((m as { key?: unknown }).key).startsWith('history')).length;
  return out;
}

test('history: a receiver on two sites, frame techniques, value-match high, retention, export, clear, feature off', async () => {
  test.setTimeout(240_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = await enableProtect(sw, ['history']);
    expect(on.state?.state, brief(on)).toBe('active');

    // Two sites with the same receiver → one row, two sites; canvas in the receiver's frame → frame-techniques.
    await visitSites(ext, server);
    await expect.poll(async () => {
      const row = (await query(sw)).rows.find((r) => r.rowKey === 'd:example.org');
      return row === undefined ? null : { sites: row.sites, mechanisms: row.mechanisms.map((m) => m.mechanism) };
    }, { timeout: 30_000, message: 'example.org on two sites' }).toEqual({ sites: 2, mechanisms: ['frame-techniques'] });
    const first = await query(sw);
    const frameMechanism = first.rows[0]!.mechanisms[0]!;
    expect(frameMechanism).toMatchObject({ attributionConfidence: 'frame-only', integrity: 'page-controlled', evidenceSource: 'page-hook' });
    expect(frameMechanism.families).toContain('canvas');
    expect(first.limitations).toContain('attribution-frame-only');
    expect(first.storage).toBe('ok');

    // Synthetic value-match evidence on both sites (hash of an e-mail) → value-match, high.
    for (const site of ['example.com', 'example.net']) await inject(sw, { evidence: { receiver: 'example.org', site, fieldKind: 'email', encodings: ['sha256-hex'] } });
    const vm = await query(sw, { mechanismsOnly: true });
    expect(vm.rows[0]!.mechanisms.find((m) => m.mechanism === 'value-match'), brief(vm.rows)).toMatchObject({ sites: 2, interpretationConfidence: 'high', integrity: 'derived' });

    // What is on disk: domains, day numbers, enums and counts only.
    const dump = await dumpProtectDb(sw);
    expect(historyCounts(dump)).toMatchObject({ sightings: 2, receivers: 1, sites: 2, 'meta.history': 1 });
    const disk = JSON.stringify(HISTORY_STORES.map((s) => dump[s]));
    expect(disk).not.toMatch(/:\/\/|\/protect\/|receiver=|collect|tracker\.example|www\.|T\d\d:\d\d|CANARY/);

    // Export = preview: site-N by default, the names only when asked.
    const exportOf = async (includeSites: boolean): Promise<HistoryExport> => {
      const r = await protectRoute(sw, { type: 'ui-protect-history-export', includeSites });
      expect(r.type, brief(r)).toBe('protect-history-export');
      return (r as unknown as { preview: HistoryExport }).preview;
    };
    const redacted = await exportOf(false);
    expect(redacted.sites.map((s) => s.site).sort()).toEqual(['site-1', 'site-2']);
    expect(JSON.stringify(redacted)).not.toMatch(/example\.com|example\.net/);
    expect((await exportOf(true)).sites.map((s) => s.site).sort()).toEqual(['example.com', 'example.net']);

    // Retention: 91 days later the 90-day mask is empty → every history record goes (no alarms: at the next event).
    const after = await inject(sw, { dayOffset: 91 });
    expect(after['purges'], brief(after)).toBeGreaterThan(0);
    expect(historyCounts(await dumpProtectDb(sw))).toEqual({ sightings: 0, receivers: 0, sites: 0, 'meta.history': 1 });

    // New visits on the shifted clock, then «Удалить всю историю».
    await visitSites(ext, server);
    await expect.poll(async () => (await query(sw)).rows.length, { timeout: 30_000 }).toBe(1);
    const purged = await protectRoute(sw, { type: 'ui-protect-purge', what: 'history' });
    expect(purged.type, brief(purged)).toBe('protect-state');
    expect(historyCounts(await dumpProtectDb(sw))).toEqual({ sightings: 0, receivers: 0, sites: 0, 'meta.history': 0 });

    // Turning the history feature off deletes its records (the stores stay empty while it is off).
    await visitSites(ext, server);
    await expect.poll(async () => (await query(sw)).rows.length, { timeout: 30_000 }).toBe(1);
    const off = await protectRoute(sw, { type: 'ui-protect-set-settings', features: ['value-match'] });
    expect(off.state?.features, brief(off)).toEqual(['value-match']);
    expect(historyCounts(await dumpProtectDb(sw))).toEqual({ sightings: 0, receivers: 0, sites: 0, 'meta.history': 0 });
    expect((await protectRoute(sw, { type: 'ui-protect-history-query', windowDays: 30, offset: 0, limit: 50 })).code).toBe('feature-disabled');
  } finally {
    await ext.close();
    await server.close();
  }
});
