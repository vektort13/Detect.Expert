// ADR-020 §E, §F (S15, E21-15): a session recorder WITH script attribution → replay-recording / medium (rule R4: the
// root input and pointer listeners and the document observer are attributed by a sampled stack to the recorder's script
// host cdn.rec.example.net — registrable domain example.net — which is also the periodic receiver rec.example.net).
// Condition of the brief: «если listen и send = go». The quiet perf phase decided E21-10 as listen off, send off,
// observe wrap (strong class, provisional), so the release profile cannot reach R4 (listener-hook-off, ceiling
// signals-only for S1; unit: packages/sensors/test/protect-config.test.ts). The test profiles run the S10 candidate
// (listen prototype, observe wrap), so this spec checks the attribution chain S10 → S11 end to end where it exists,
// and asserts which hook configuration the build registered.

import { expect, test } from '@playwright/test';
import type { Worker } from '@playwright/test';
import type { ProtectProjection, ReplaySummary } from '@detect-expert/contracts';
import { getServiceWorker, startFixtureServer } from '../harness';
import { brief, fixtureResult, openExtensionPage, tabIdOf } from '../helpers';
import { PROTECT_SCRIPT_IDS, enableProtect, grantAllSites, launchProtect, protectRoute, registeredScripts, standUrl } from './support';

async function replayOf(sw: Worker, tabId: number): Promise<ReplaySummary | null> {
  const r = await protectRoute(sw, { type: 'ui-protect-get-report', tabId });
  return (r as unknown as { report?: ProtectProjection | null }).report?.replay ?? null;
}

test('stand: recorder with sampled-stack attribution → replay-recording / medium (test profile, S10 candidate hooks)', async () => {
  test.setTimeout(180_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = await enableProtect(sw, ['session-replay']);
    expect(on.state?.state, brief(on)).toBe('active');
    // The MAIN registration of the module carries the listen group (protect-on.<group>.js) in this profile.
    const main = (await registeredScripts(sw, [...PROTECT_SCRIPT_IDS])).find((s) => s.id === 'detector-protect-main-v1');
    expect(main?.js.some((f) => /^protect-on\./.test(f)), brief(main)).toBe(true);

    const page = await ext.context.newPage();
    const url = standUrl(server.origins[0]!, 'shop.example.com', '/protect/stand/recorder-attributed.html');
    await page.goto(url);
    const done = await fixtureResult<{ sends: number; error?: string }>(page, 30_000);
    expect(done, brief(done)).toMatchObject({ sends: 6 });
    const tabId = await tabIdOf(sw, url);

    await expect.poll(async () => (await replayOf(sw, tabId))?.level ?? null, { timeout: 30_000, message: 'R4: replay-recording' }).toBe('replay-recording');
    const r = (await replayOf(sw, tabId))!;
    expect(r, brief(r)).toMatchObject({ level: 'replay-recording', interpretationConfidence: 'medium', attributionConfidence: 'sampled-stack' });
    expect(r.periodicHosts.map((h) => h.registrableDomain)).toEqual(['example.net']);
    const s1 = r.signals.find((s) => s.code === 'root-input-listeners');
    const s2 = r.signals.find((s) => s.code === 'root-mutation-observe');
    expect(s1, brief(r.signals)).toMatchObject({ techniqueId: 'DET-043', integrity: 'page-controlled', linkedSite: 'example.net' });
    expect(s2, brief(r.signals)).toMatchObject({ integrity: 'page-controlled', linkedSite: 'example.net' });
    expect(r.limitationCodes).not.toContain('listener-hook-off');
    expect(r.limitationCodes).not.toContain('no-script-attribution');
    expect(r.limitationCodes).toEqual(expect.arrayContaining(['uncalibrated-threshold', 'masking-not-verifiable', 'websocket-not-observed']));
    expect(JSON.stringify(r)).not.toMatch(/https?:|\/replay\/collect|\?/);
    expect(server.stats.routes['replay']?.['POST rec.example.net/replay/collect']).toBe(6);

    // The popup row names the level (data attribute: locale independent); medium is never shown as high.
    const popup = await openExtensionPage(ext.context, sw, 'popup.html?tabId=' + String(tabId));
    const row = popup.locator('[data-protect-replay="popup"]');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.locator('[data-replay-level="replay-recording"]')).toBeVisible();
    await popup.close();
  } finally {
    await ext.close();
    await server.close();
  }
});
