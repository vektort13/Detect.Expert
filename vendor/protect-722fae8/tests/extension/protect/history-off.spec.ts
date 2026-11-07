// ADR-020 §G (S12, E21-12 case 2 «при выключенной фиче ни одной записи в IDB»): with the module on but the history feature
// off, browsing two sites with a shared receiver leaves no history record in IndexedDB (no sighting, receiver, site or
// meta['history-state']); the history routes answer feature-disabled; the side panel tab «Кто узнаёт» only says that
// the history is off. With the module off there is no such tab at all.

import { expect, test } from '@playwright/test';
import { getServiceWorker, startFixtureServer } from '../harness';
import { brief, fixtureResult, openExtensionPage, tabIdOf } from '../helpers';
import { disableProtect, dumpProtectDb, enableProtect, grantAllSites, launchProtect, protectRoute, standUrl } from './support';

test('history off: no record in IndexedDB, routes refuse, the tab explains; module off: no tab', async () => {
  test.setTimeout(180_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = await enableProtect(sw, ['value-match']);
    expect(on.state?.state, brief(on)).toBe('active');
    let lastTab = -1;
    for (const host of ['www.example.com', 'www.example.net']) {
      const page = await ext.context.newPage();
      const url = standUrl(server.origins[0]!, host, '/protect/history/site.html?receiver=tracker.example.org');
      await page.goto(url);
      expect(await fixtureResult(page)).toMatchObject({ receiver: true, frame: 'load' });
      lastTab = await tabIdOf(sw, page.url());
    }
    // Reports of both sites are persisted (the observation side works as usual) ...
    await expect.poll(async () => {
      const session = await sw.evaluate(() => chrome.storage.session.get(null));
      return Object.keys(session).filter((k) => k.startsWith('doc:')).length;
    }, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
    await new Promise((r) => setTimeout(r, 1500));
    // ... and the history has nothing.
    const dump = await dumpProtectDb(sw);
    for (const store of ['sightings', 'receivers', 'sites']) expect(dump[store] ?? [], store).toEqual([]);
    expect((dump['meta'] ?? []).map((m) => String((m as { key?: unknown }).key)).filter((k) => k.startsWith('history'))).toEqual([]);
    const refused = await protectRoute(sw, { type: 'ui-protect-history-query', windowDays: 30, offset: 0, limit: 50 });
    expect(refused.code, brief(refused)).toBe('feature-disabled');

    // Side panel: the module tab set is there; «Кто узнаёт» says the history is off.
    const panel = await openExtensionPage(ext.context, sw, 'sidepanel.html?tabId=' + String(lastTab));
    await panel.locator('#panel-tab-history').click();
    await expect(panel.locator('[data-history-panel]')).toHaveAttribute('data-history-panel', 'off');
    await expect(panel.locator('[data-history-row]')).toHaveCount(0);
    await panel.close();

    // Module off (purge): no «Кто узнаёт» tab, no database.
    const off = await disableProtect(sw, true);
    expect(off.state?.state, brief(off)).toBe('off');
    const again = await openExtensionPage(ext.context, sw, 'sidepanel.html?tabId=' + String(lastTab));
    await expect(again.locator('#panel-tab-overview')).toBeVisible();
    await expect(again.locator('#panel-tab-history')).toHaveCount(0);
    await again.close();
    expect(await dumpProtectDb(sw)).toEqual({});
  } finally {
    await ext.close();
    await server.close();
  }
});
