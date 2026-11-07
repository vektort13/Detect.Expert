// ADR-020 §E (S11): negative stands of session recording in real Chromium (test profile). Never above signals-only,
// and no periodic receiver where the sends are not periodic cross-site POSTs with sizable bodies:
//   - heartbeat: POST of 100 B every 1.5 s to another site with the tab armed (value-match on, focus on the e-mail
//     field): the body sizes are observed and small; the GET variant is never a send of the series;
//   - first-party autosave: listeners + document observer + 4 KiB to the site's own subdomain;
//   - element listeners: fields / div listeners and an observer on a div, plus periodic POSTs (S3 alone);
//   - SPA with shortcuts: keydown + scroll + body observer and GET loads;
//   - WebSocket recorder: the data goes over a WebSocket, which the module does not see (websocket-not-observed).

import { expect, test } from '@playwright/test';
import type { Page, Worker } from '@playwright/test';
import type { ProtectProjection, ReplaySummary } from '@detect-expert/contracts';
import { getServiceWorker, startFixtureServer } from '../harness';
import type { ExtensionSession, FixtureServer } from '../harness';
import { brief, tabIdOf } from '../helpers';
import { enableProtect, grantAllSites, launchProtect, protectRoute, standUrl } from './support';

async function replayOf(sw: Worker, tabId: number): Promise<ReplaySummary | null> {
  const r = await protectRoute(sw, { type: 'ui-protect-get-report', tabId });
  return (r as unknown as { report?: ProtectProjection | null }).report?.replay ?? null;
}

interface Opened {
  page: Page;
  tabId: number;
}

async function open(ext: ExtensionSession, server: FixtureServer, sw: Worker, file: string): Promise<Opened> {
  const page = await ext.context.newPage();
  const url = standUrl(server.origins[0]!, 'shop.example.com', '/protect/replay/' + file);
  await page.goto(url);
  return { page, tabId: await tabIdOf(sw, url.replace(/\?.*$/, '')) };
}

async function finished(p: Opened, key: string, value: number): Promise<void> {
  await expect
    .poll(() => p.page.evaluate((k) => (window as unknown as { __fixtureResult?: Record<string, unknown> }).__fixtureResult?.[k] ?? null, key), { timeout: 30_000, message: 'fixture finished (' + key + ')' })
    .toBe(value);
}

/** The settled summary after the page finished (the projection is derived fresh, so one short wait suffices). */
async function settled(sw: Worker, p: Opened): Promise<ReplaySummary> {
  await p.page.waitForTimeout(1000);
  const r = await replayOf(sw, p.tabId);
  if (r === null) throw new Error('no replay summary');
  return r;
}

test('heartbeat, first-party autosave, element listeners, SPA shortcuts and a WebSocket recorder stay below replay-like', async () => {
  test.setTimeout(300_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = await enableProtect(sw, ['value-match', 'session-replay']);
    expect(on.state?.state, brief(on)).toBe('active');

    // Heartbeat (POST, armed tab: body sizes observed and small).
    const hb = await open(ext, server, sw, 'heartbeat-negative.html');
    await hb.page.locator('#email').click();
    await finished(hb, 'sends', 6);
    const hbr = await settled(sw, hb);
    expect(hbr.periodicHosts, brief(hbr)).toEqual([]);
    expect(hbr.signals.map((s) => s.code)).toEqual([]);
    expect(hbr.level).toBe('none');
    // Heartbeat, GET variant (not a send of the series at all).
    const hbGet = await open(ext, server, sw, 'heartbeat-negative.html?method=GET');
    await hbGet.page.locator('#email').click();
    await finished(hbGet, 'sends', 6);
    const hbGetR = await settled(sw, hbGet);
    expect(hbGetR.periodicHosts, brief(hbGetR)).toEqual([]);
    expect(hbGetR.level).toBe('none');
    expect(server.stats.routes['replay']?.['POST hb.example.net/replay/collect']).toBe(6);
    expect(server.stats.routes['replay']?.['GET hb.example.net/replay/collect']).toBe(6);

    // First-party autosave.
    const auto = await open(ext, server, sw, 'autosave-first-party-negative.html');
    await finished(auto, 'sends', 5);
    const autoR = await settled(sw, auto);
    expect(autoR.level, brief(autoR)).toBe('signals-only');
    expect(autoR.periodicHosts).toEqual([]);
    expect(autoR.signals.map((s) => s.code)).toEqual(['root-input-listeners', 'root-mutation-observe']);
    expect(autoR.limitationCodes).toContain('first-party-endpoints-not-assessed');

    // Element listeners only (S3 alone).
    const el = await open(ext, server, sw, 'element-listeners-negative.html');
    await finished(el, 'sends', 5);
    const elR = await settled(sw, el);
    expect(elR.level, brief(elR)).toBe('signals-only');
    expect(elR.signals.map((s) => s.code)).toEqual(['periodic-third-party-send']);
    expect(elR.limitationCodes).toContain('element-listeners-not-observed');

    // SPA with keyboard shortcuts, infinite scroll and GET loads.
    const spa = await open(ext, server, sw, 'spa-shortcuts-negative.html');
    await finished(spa, 'loads', 4);
    const spaR = await settled(sw, spa);
    expect(spaR.level, brief(spaR)).toBe('signals-only');
    expect(spaR.periodicHosts).toEqual([]);

    // A recorder that sends over a WebSocket only.
    const ws = await open(ext, server, sw, 'websocket-only.html');
    await finished(ws, 'frames', 6);
    const wsR = await settled(sw, ws);
    expect(wsR.level, brief(wsR)).toBe('signals-only');
    expect(wsR.periodicHosts).toEqual([]);
    expect(wsR.limitationCodes).toContain('websocket-not-observed');

    for (const r of [hbr, hbGetR, autoR, elR, spaR, wsR]) expect(['none', 'signals-only']).toContain(r.level);
  } finally {
    await ext.close();
    await server.close();
  }
});
