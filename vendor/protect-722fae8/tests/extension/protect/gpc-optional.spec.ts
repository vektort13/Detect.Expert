// ADR-020 §H, §7 (S13, E21-13 case 2): the test-optional profile without the optional DNR grant. GPC needs
// declarativeNetRequestWithHostAccess: enabling the module with it, or adding it later, answers permission-required;
// nothing of GPC runs (no rule, no gpc.main.js, no request-header listener) and neither the header nor the property
// reaches the page. Ground truth: the fixture server reads only sec-gpc (tests/fixture-routes/gpc.mjs).

import { expect, test } from '@playwright/test';
import { getServiceWorker, startFixtureServer } from '../harness';
import { brief, fixtureResult } from '../helpers';
import { enableProtect, grantAllSites, launchProtect, ourDnrRules, protectListeners, protectRoute, protectState, registeredScripts, standUrl } from './support';

test('test-optional without the DNR grant: gpc → permission-required, no rule, no header, no property', async () => {
  test.setTimeout(120_000);
  const server = await startFixtureServer();
  const ext = await launchProtect({ profile: 'test-optional' });
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    expect(await sw.evaluate(() => chrome.permissions.contains({ permissions: ['declarativeNetRequestWithHostAccess'] }))).toBe(false);

    const refused = await enableProtect(sw, ['gpc']);
    expect(refused.code, brief(refused)).toBe('permission-required');
    expect((await protectState(sw)).state).toBe('off');

    const on = await enableProtect(sw, ['value-match']);
    expect(on.state?.state, brief(on)).toBe('active');
    const add = await protectRoute(sw, { type: 'ui-protect-set-settings', features: ['value-match', 'gpc'] });
    expect(add.code, brief(add)).toBe('permission-required');
    const state = await protectState(sw);
    expect(state.features).toEqual(['value-match']);
    expect(state.permissions.dnr).toBe(false);

    expect(await ourDnrRules(sw)).toEqual({ api: false, ids: [] });
    expect((await registeredScripts(sw, ['detector-protect-main-v1'])).flatMap((s) => s.js)).not.toContain('gpc.main.js');
    expect(await protectListeners(sw)).toMatchObject({ requestHeaders: false });

    const page = await ext.context.newPage();
    const other = standUrl(server.origins[1]!, 'api.example.net', '');
    await page.goto(standUrl(server.origins[0]!, 'www.example.com', '/protect/gpc/gpc-top.html') + '?other=' + encodeURIComponent(other));
    const result = await fixtureResult<{ property: { value: unknown; onPrototype: boolean }; requests: { fetchSame: unknown; fetchCross: unknown } }>(page, 25_000);
    expect(result.property).toMatchObject({ value: 'undefined', onPrototype: false });
    expect(result.requests.fetchSame).toEqual({ secGpc: null });
    expect(result.requests.fetchCross).toEqual({ secGpc: null });
    const bucket = server.stats.routes?.['gpc'] ?? {};
    const withHeader = Object.entries(bucket).filter(([k, n]) => k.endsWith(' 1') && n > 0);
    expect(withHeader, 'no request reached the stand with Sec-GPC: 1').toEqual([]);
    expect(Object.keys(bucket).length).toBeGreaterThan(0);
  } finally {
    await ext.close();
    await server.close();
  }
});
