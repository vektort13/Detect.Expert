// ADR-020 §E (S11): session recording in real Chromium (test profile: the S10 candidate hook configuration, so the
// MAIN listen / observe hooks run). Our synthetic recorder (fixtures/protect/replay/replay-sim.js, served by the site
// itself) registers page-level listeners, observes the document and POSTs 2 KiB to rec.example.net every 1.5 s × 6.
// Expected: replay-like / low with three signals, periodic receiver example.net (runMax ≥ 3), masking not confirmed,
// the popup row; a late recorder and a recorder inside a cross-site frame reach replay-like as well. The summary
// carries no URL, query or body; the fixture server received exactly what the pages sent.

import { expect, test } from '@playwright/test';
import type { Worker } from '@playwright/test';
import type { ProtectProjection, ReplaySummary } from '@detect-expert/contracts';
import { getServiceWorker, startFixtureServer } from '../harness';
import { brief, fixtureResult, openExtensionPage, tabIdOf } from '../helpers';
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

test('positive recorder, popup row, late recorder and a recorder in a cross-site frame', async () => {
  test.setTimeout(240_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = await enableProtect(sw, ['session-replay']);
    expect(on.state?.state, brief(on)).toBe('active');
    const origin = server.origins[0]!;

    // 1. Positive stand.
    const page = await ext.context.newPage();
    const url = standUrl(origin, 'shop.example.com', '/protect/replay/recorder-positive.html');
    await page.goto(url);
    const done = await fixtureResult<{ sends: number }>(page, 30_000);
    expect(done.sends).toBe(6);
    const tabId = await tabIdOf(sw, url);
    const r = await waitLevel(sw, tabId, 'replay-like', 'positive stand reaches replay-like');
    expect(r, brief(r)).toMatchObject({ ruleId: 'session-replay-behavior', interpretationConfidence: 'low', inputMasking: 'unconfirmed', vendors: [] });
    expect(r.signals.map((s) => s.code)).toEqual(['root-input-listeners', 'root-mutation-observe', 'periodic-third-party-send']);
    expect(r.signals[0]).toMatchObject({ techniqueId: 'DET-043', evidenceSource: 'page-hook', integrity: 'page-controlled' });
    expect(r.periodicHosts).toHaveLength(1);
    expect(r.periodicHosts[0]!.registrableDomain).toBe('example.net');
    expect(r.periodicHosts[0]!.runMax).toBeGreaterThanOrEqual(3);
    expect(r.limitationCodes).toEqual(expect.arrayContaining(['uncalibrated-threshold', 'websocket-not-observed', 'element-listeners-not-observed', 'masking-not-verifiable', 'body-size-not-observed']));
    // The test profile carries the synthetic replay table (test-replay), so vendor rules are "enabled" here; the
    // production table is empty (vendor-rules-disabled: unit tests and replay-seed.test.ts).
    expect(r.limitationCodes).not.toContain('vendor-rules-disabled');
    expect(r.limitationCodes).not.toContain('listener-hook-off');
    expect(JSON.stringify(r)).not.toMatch(/https?:|\/replay\/collect|\?/);
    // Exactly the six page requests reached the receiver; the extension sent nothing of its own.
    expect(server.stats.routes['replay']?.['POST rec.example.net/replay/collect']).toBe(6);

    // 2. The popup row of that tab (level as a data attribute: locale independent).
    const popup = await openExtensionPage(ext.context, sw, 'popup.html?tabId=' + String(tabId));
    const row = popup.locator('[data-protect-replay="popup"]');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.locator('[data-replay-level="replay-like"]')).toBeVisible();
    await expect(row.locator('[data-replay-receiver="example.net"]')).toBeVisible();
    await expect(row.locator('[data-replay-masking="true"]')).toBeVisible();
    await popup.close();

    // 3. A recorder that starts 3 s after load (registrations long after document_start are still observed).
    const late = await ext.context.newPage();
    const lateUrl = standUrl(origin, 'shop.example.com', '/protect/replay/late-recorder.html');
    await late.goto(lateUrl);
    await expect.poll(() => late.evaluate(() => (window as unknown as { __fixtureResult?: { sends?: number } }).__fixtureResult?.sends ?? 0), { timeout: 30_000 }).toBe(4);
    const lateTab = await tabIdOf(sw, lateUrl);
    await waitLevel(sw, lateTab, 'replay-like', 'late recorder reaches replay-like');

    // 4. A recorder inside a cross-site frame: the conjunction is judged within the frame document.
    const host = await ext.context.newPage();
    const frameUrl = standUrl(origin, 'shop.example.com', '/protect/replay/iframe-recorder.html');
    await host.goto(frameUrl);
    const framed = await fixtureResult<{ frameSends: number }>(host, 30_000);
    expect(framed.frameSends).toBe(4);
    const frameTab = await tabIdOf(sw, frameUrl);
    const f = await waitLevel(sw, frameTab, 'replay-like', 'frame recorder reaches replay-like');
    expect(f.periodicHosts.map((h) => h.registrableDomain)).toEqual(['example.net']);
  } finally {
    await ext.close();
    await server.close();
  }
});
