// ADR-020 §F, §12 (S10, E21-10 case 3): a hostile page against the stack sampler in a real Chromium (SP-12).
//   prepare  an accessor prepareStackTrace on Object.prototype: never invoked by the module (the page's counter stays
//            0); the request is still paired but carries no script (`stack-unavailable`);
//   limit    Error.stackTraceLimit = 0: `stack-unavailable`;
//   forge    eval code named by a sourceURL comment: the attribution follows what the page wrote (page-controlled, a
//            hint, never proof) — the level stays sampled-stack and integrity page-controlled;
//   global   window.Error replaced by the page: the intrinsics captured at document_start still work (`document`).
// In every mode the page's request reached the receiver exactly once.

import { expect, test } from '@playwright/test';
import type { Worker } from '@playwright/test';
import type { ScriptAttribution } from '@detect-expert/contracts';
import { getServiceWorker, startFixtureServer } from '../harness';
import { brief, fixtureResult, tabIdOf } from '../helpers';
import { enableProtect, grantAllSites, launchProtect, standUrl } from './support';

interface Decided {
  host: string | null;
  attribution: ScriptAttribution;
}

async function decided(sw: Worker, tabId: number): Promise<Decided[]> {
  return sw.evaluate(async (id) => {
    const h = (globalThis as unknown as { __protectHarness: { inject(name: string, payload: unknown): Promise<unknown> } }).__protectHarness;
    return (await h.inject('attribution', { op: 'results', tabId: id })) as Decided[];
  }, tabId) as Promise<Decided[]>;
}

test('hostile stack: no planted accessor runs, stack-unavailable instead of a script, forged names stay page-controlled', async () => {
  test.setTimeout(150_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = await enableProtect(sw, ['value-match']);
    expect(on.state?.state, brief(on)).toBe('active');
    const seen: Record<string, ScriptAttribution> = {};
    for (const mode of ['prepare', 'limit', 'forge', 'global'] as const) {
      const page = await ext.context.newPage();
      const url = standUrl(server.origins[0]!, 'shop.example.com', '/protect/attribution/hostile.html?mode=' + mode);
      await page.goto(url);
      const result = await fixtureResult<{ prepareStackTraceCalls: number }>(page, 20_000);
      expect(result.prepareStackTraceCalls, mode + ': the planted accessor was never invoked').toBe(0);
      const tabId = await tabIdOf(sw, url);
      await expect.poll(async () => (await decided(sw, tabId)).some((d) => d.host === 'collect-hostile.example.net'), { timeout: 20_000, message: mode }).toBe(true);
      seen[mode] = (await decided(sw, tabId)).find((d) => d.host === 'collect-hostile.example.net')!.attribution;
      await page.close();
    }
    for (const mode of ['prepare', 'limit'] as const) {
      expect(seen[mode], mode + ' ' + brief(seen)).toMatchObject({ correlation: 'unique', script: null, attributionConfidence: 'unknown', limitationCodes: ['stack-unavailable'] });
    }
    const forged = seen['forge']!;
    expect(forged.integrity).toBe('page-controlled');
    expect(forged.correlation).toBe('unique');
    // V8 names sourceURL-tagged eval code after the comment; either way the page decides what is shown.
    const forgedOk = (forged.script?.kind === 'external' && forged.script.host === 'forged.example.org') || forged.script?.kind === 'eval';
    expect(forgedOk, brief(forged)).toBe(true);
    expect(seen['global'], brief(seen)).toMatchObject({ correlation: 'unique', script: { kind: 'document' }, attributionConfidence: 'sampled-stack' });
    const counts = server.stats.routes['attribution'] ?? {};
    for (const mode of ['prepare', 'limit', 'forge', 'global']) expect(counts['collect-hostile.example.net/attr/' + mode], mode).toBe(1);
  } finally {
    await ext.close();
    await server.close();
  }
});
