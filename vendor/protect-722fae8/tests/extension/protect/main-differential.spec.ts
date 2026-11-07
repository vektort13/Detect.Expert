// ADR-020 §F, REQ-002 (S10, E21-10 case 3): differential run of fixtures/protect/attribution/differential.html in plain
// Chromium (launchPlain) and with the module's MAIN hooks installed (test profile, candidate configuration: fetch,
// XHR open/send, sendBeacon, addEventListener, MutationObserver.observe). The page-visible behaviour must be
// identical: addEventListener once / passive / capture / signal / removeEventListener / duplicates / handleEvent,
// error classes, a prototype patched later by the page (called once), fetch / XHR / sendBeacon results, Promise
// identity, MutationObserver records. Only `hooks` differs: a wrapper is detectable by design (REQ-003, REQ-014).

import { expect, test } from '@playwright/test';
import { getServiceWorker, launchPlain, startFixtureServer } from '../harness';
import { brief, fixtureResult } from '../helpers';
import { PROTECT_RESOLVER, enableProtect, grantAllSites, launchProtect, standUrl } from './support';

interface Differential {
  result: Record<string, unknown>;
  hooks: { fetchNative: boolean; addNative: boolean };
}

test('MAIN hooks differential: identical page-visible semantics with and without the module', async () => {
  test.setTimeout(120_000);
  const server = await startFixtureServer();
  const url = standUrl(server.origins[0]!, 'shop.example.com', '/protect/attribution/differential.html');
  try {
    const plain = await launchPlain({ hostResolverRules: PROTECT_RESOLVER });
    let baseline: Differential;
    try {
      const page = await plain.context.newPage();
      await page.goto(url);
      baseline = await fixtureResult<Differential>(page, 20_000);
    } finally {
      await plain.close();
    }
    expect(baseline.hooks).toEqual({ fetchNative: true, addNative: true });

    const ext = await launchProtect();
    try {
      const sw = await getServiceWorker(ext.context);
      await grantAllSites(ext, sw);
      const on = await enableProtect(sw, ['value-match', 'session-replay']);
      expect(on.state?.state, brief(on)).toBe('active');
      const page = await ext.context.newPage();
      await page.goto(url);
      const hooked = await fixtureResult<Differential>(page, 20_000);
      // The hooks are really there (otherwise the comparison proves nothing) ...
      expect(hooked.hooks, brief(hooked)).toEqual({ fetchNative: false, addNative: false });
      // ... and the page cannot tell them apart by behaviour.
      expect(hooked.result, brief({ baseline: baseline.result, hooked: hooked.result }, 4000)).toEqual(baseline.result);
      expect(baseline.result['once']).toBe(1);
      expect(baseline.result['latePatch']).toEqual({ patchCalls: 1, fired: 1 });
    } finally {
      await ext.close();
    }
  } finally {
    await server.close();
  }
});
