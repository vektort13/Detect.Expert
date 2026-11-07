// ADR-020 §E (S11): the replay table in real Chromium, test profile only. The synthetic vendor `test-replay`
// (fixtures/vendors/synthetic/replay-catalog.json: loader http://127.0.0.1:4174/replay/loader.js, endpoint
// collect.replay.example.org/replay/collect) is an ENABLED test rule; production tables are empty (REQ-008). The loader
// observes the document (S2): without sends that is R3 (replay-like / low); with periodic sends to the vendor's own
// endpoint it is R5 (replay-recording / medium), with the vendor listed as a documented resource.

import { expect, test } from '@playwright/test';
import type { Worker } from '@playwright/test';
import type { ProtectProjection, ReplaySummary } from '@detect-expert/contracts';
import { getServiceWorker, startFixtureServer } from '../harness';
import { brief, fixtureResult, tabIdOf } from '../helpers';
import { enableProtect, grantAllSites, launchProtect, protectRoute, standUrl } from './support';

async function replayOf(sw: Worker, tabId: number): Promise<ReplaySummary | null> {
  const r = await protectRoute(sw, { type: 'ui-protect-get-report', tabId });
  return (r as unknown as { report?: ProtectProjection | null }).report?.replay ?? null;
}

async function waitLevel(sw: Worker, tabId: number, level: ReplaySummary['level'], message: string): Promise<ReplaySummary> {
  let last: ReplaySummary | null = null;
  await expect
    .poll(async () => {
      last = await replayOf(sw, tabId);
      return last?.level ?? null;
    }, { timeout: 20_000, message })
    .toBe(level);
  return last!;
}

const VENDOR = { vendorId: 'test-replay', vendorConfidence: 'documented-resource', ruleIds: ['test-replay-loader'], evidenceSource: 'browser-network', integrity: 'browser-observed' };

test('synthetic vendor: R3 with the loader alone, R5 with periodic sends to its endpoint', async () => {
  test.setTimeout(180_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = await enableProtect(sw, ['session-replay']);
    expect(on.state?.state, brief(on)).toBe('active');
    const base = standUrl(server.origins[0]!, 'shop.example.com', '/protect/replay/vendor-synthetic.html');

    const r3Page = await ext.context.newPage();
    await r3Page.goto(base);
    await fixtureResult(r3Page, 20_000);
    const r3Tab = await tabIdOf(sw, base);
    const r3 = await waitLevel(sw, r3Tab, 'replay-like', 'loader + document observer: R3');
    expect(r3, brief(r3)).toMatchObject({ interpretationConfidence: 'low', vendors: [VENDOR] });
    expect(r3.signals.map((s) => s.code)).toEqual(['root-mutation-observe', 'replay-vendor-resource']);
    expect(r3.limitationCodes).not.toContain('vendor-rules-disabled');
    await r3Page.close();

    const r5Page = await ext.context.newPage();
    const r5Url = base + '?sends=4';
    await r5Page.goto(r5Url);
    const done = await fixtureResult<{ sends: number }>(r5Page, 30_000);
    expect(done.sends).toBe(4);
    const r5Tab = await tabIdOf(sw, r5Url);
    const r5 = await waitLevel(sw, r5Tab, 'replay-recording', 'loader + observer + periodic sends to the vendor endpoint: R5');
    expect(r5, brief(r5)).toMatchObject({ interpretationConfidence: 'medium', vendors: [VENDOR] });
    expect(r5.periodicHosts.map((h) => h.registrableDomain)).toEqual(['example.org']);
    expect(server.stats.routes['replay']?.['GET 127.0.0.1/replay/loader.js']).toBe(2);
    expect(server.stats.routes['replay']?.['POST collect.replay.example.org/replay/collect']).toBe(4);
  } finally {
    await ext.close();
    await server.close();
  }
});
