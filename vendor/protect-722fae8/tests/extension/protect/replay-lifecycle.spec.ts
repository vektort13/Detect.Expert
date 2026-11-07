// ADR-020 §E (S11): lifecycle of the session-recording lane in real Chromium (test profile).
//   1. Late enable: the module runs with value-match only (the S10 attribution lane records registrations); the page
//      starts recording; then session-replay is turned on. The page's earlier registrations come from the attribution
//      port (lower bound) and the summary says loaded-before-enable; after a reload the limitation is gone.
//   2. SW restart: the summary kept in storage.session comes back, never lower, marked cadence-reset.
//   3. Feature off: no replay in the projection any more (the lane's storage.session sections go).

import { expect, test } from '@playwright/test';
import type { Worker } from '@playwright/test';
import type { ProtectProjection, ReplaySummary } from '@detect-expert/contracts';
import { getServiceWorker, startFixtureServer } from '../harness';
import { brief, fixtureResult, openExtensionPage, tabIdOf } from '../helpers';
import { workerControl } from '../sw-restart/probe';
import { enableProtect, grantAllSites, launchProtect, protectRoute, standUrl } from './support';

async function report(sw: Worker, tabId: number): Promise<ProtectProjection | null> {
  const r = await protectRoute(sw, { type: 'ui-protect-get-report', tabId });
  return (r as unknown as { report?: ProtectProjection | null }).report ?? null;
}

async function waitReplay(sw: Worker, tabId: number, pred: (r: ReplaySummary) => boolean, message: string): Promise<ReplaySummary> {
  let last: ReplaySummary | null = null;
  await expect
    .poll(async () => {
      last = (await report(sw, tabId).catch(() => null))?.replay ?? null;
      return last !== null && pred(last);
    }, { timeout: 25_000, message })
    .toBe(true);
  return last!;
}

test('late enable (loaded-before-enable, port seed), SW restart (cadence-reset), feature off', async () => {
  test.setTimeout(240_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = await enableProtect(sw, ['value-match']);
    expect(on.state?.state, brief(on)).toBe('active');

    // 1. The page records before the feature is on; the feature is turned on mid-series.
    const page = await ext.context.newPage();
    const url = standUrl(server.origins[0]!, 'shop.example.com', '/protect/replay/recorder-positive.html');
    await page.goto(url + '?count=10');
    const tabId = await tabIdOf(sw, url);
    expect((await report(sw, tabId))?.replay ?? null).toBeNull();
    await page.waitForTimeout(2500);
    const set = await protectRoute(sw, { type: 'ui-protect-set-settings', features: ['value-match', 'session-replay'] });
    expect(set.type, brief(set)).toBe('protect-state');
    await fixtureResult(page, 30_000);
    const late = await waitReplay(sw, tabId, (r) => r.level === 'replay-like', 'late-enabled page reaches replay-like through the port seed');
    expect(late.limitationCodes, brief(late)).toContain('loaded-before-enable');
    expect(late.signals.find((s) => s.code === 'root-input-listeners')?.countQuality).toBe('lower-bound');

    // After a reload the registrations are observed by the lane itself.
    await page.goto(url + '?count=4');
    await fixtureResult(page, 30_000);
    const fresh = await waitReplay(sw, tabId, (r) => r.level === 'replay-like', 'reloaded page reaches replay-like');
    expect(fresh.limitationCodes).not.toContain('loaded-before-enable');

    // 2. SW restart: wait until the summary is in storage.session (debounced writes), then stop the worker.
    await expect
      .poll(() => sw.evaluate(async () => {
        const all = await chrome.storage.session.get(null);
        return Object.entries(all).some(([k, v]) => k.startsWith('protect-doc:') && JSON.stringify(v).includes('"level":"replay-like"'));
      }), { timeout: 15_000, message: 'replay summary persisted in storage.session' })
      .toBe(true);
    const ui = await openExtensionPage(ext.context, sw, 'popup.html');
    const control = await workerControl(ui, sw);
    await control.stop();
    await ui.evaluate(() => {
      void chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-get-scope' });
    });
    let restarted: Worker | undefined;
    await expect
      .poll(async () => {
        for (const w of [...ext.context.serviceWorkers()].reverse()) {
          try {
            if (await w.evaluate(() => typeof (globalThis as unknown as { __protectHarness?: unknown }).__protectHarness === 'object')) {
              restarted = w;
              return true;
            }
          } catch {
            // the stopped worker's handle
          }
        }
        return false;
      }, { timeout: 20_000, message: 'restarted service worker' })
      .toBe(true);
    const kept = await waitReplay(restarted!, tabId, (r) => r.limitationCodes.includes('cadence-reset'), 'summary restored with cadence-reset');
    expect(kept.level, brief(kept)).toBe('replay-like');

    // 3. Feature off: the projection carries no replay summary.
    const off = await protectRoute(restarted!, { type: 'ui-protect-set-settings', features: ['value-match'] });
    expect(off.type, brief(off)).toBe('protect-state');
    await expect.poll(async () => (await report(restarted!, tabId))?.replay ?? 'absent', { timeout: 10_000 }).toBe('absent');
    await ui.close();
  } finally {
    await ext.close();
    await server.close();
  }
});
