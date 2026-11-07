// ADR-020 §F (S10, E21-10 case 3): registration samples in a real Chromium (test profile, candidate hook
// configuration). recorder.js (cdn.replay.example.net) registers listeners on window, document, the root and a
// password field and observes the body; inline code registers on an e-mail field and a plain div. Expected: script
// activity with listen / observe-document per script, the target kinds, and one `password-field-listener` fact
// (interpretationConfidence low, sampled-stack) in the module projection. The password value is never read by any
// layer: both tripwires (test profile) count 0 hits.

import { expect, test } from '@playwright/test';
import type { Worker } from '@playwright/test';
import type { ProtectProjection, ScriptActivityEntry } from '@detect-expert/contracts';
import { getServiceWorker, startFixtureServer } from '../harness';
import { brief, fixtureResult, tabIdOf } from '../helpers';
import { enableProtect, grantAllSites, launchProtect, protectRoute, standUrl, tripwire } from './support';

async function activity(sw: Worker, tabId: number): Promise<Array<{ frame: number; activity: ScriptActivityEntry[] }>> {
  return sw.evaluate(async (id) => {
    const h = (globalThis as unknown as { __protectHarness: { inject(name: string, payload: unknown): Promise<unknown> } }).__protectHarness;
    return (await h.inject('attribution', { op: 'activity', tabId: id })) as Array<{ frame: number; activity: ScriptActivityEntry[] }>;
  }, tabId) as Promise<Array<{ frame: number; activity: ScriptActivityEntry[] }>>;
}

test('attribution of registrations: listen / observe-document per script and a password-field-listener fact without reading the value', async () => {
  test.setTimeout(120_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = await enableProtect(sw, ['value-match', 'session-replay']);
    expect(on.state?.state, brief(on)).toBe('active');

    const page = await ext.context.newPage();
    const url = standUrl(server.origins[0]!, 'shop.example.com', '/protect/attribution/registration.html');
    await page.goto(url);
    await fixtureResult(page, 20_000);
    const tabId = await tabIdOf(sw, url);
    const recorder = { kind: 'external', scheme: 'http', host: 'cdn.replay.example.net', pathTemplate: '/protect/attribution/recorder.js' };

    await expect
      .poll(async () => {
        const top = (await activity(sw, tabId)).find((x) => x.frame === 0)?.activity ?? [];
        const rec = top.find((e) => e.script.kind === 'external' && e.script.host === recorder.host);
        return rec !== undefined && rec.hookPoints.includes('observe-document') && rec.targetKinds.includes('field-password') && top.some((e) => e.script.kind === 'document');
      }, { timeout: 20_000, message: 'registrations of the stand reached the SW' })
      .toBe(true);
    const top = (await activity(sw, tabId)).find((x) => x.frame === 0)!.activity;
    const rec = top.find((e) => e.script.kind === 'external')!;
    expect(rec, brief(top)).toMatchObject({ script: recorder, scriptSite: 'example.net', countQuality: 'exact' });
    expect([...rec.hookPoints].sort()).toEqual(['listen', 'observe-document']);
    expect([...rec.eventCodes].sort()).toEqual(['input', 'keydown', 'keyup', 'pointermove', 'scroll']);
    expect([...rec.targetKinds].sort()).toEqual(['document', 'field-password', 'root', 'window']);
    expect(rec.count).toBe(6);
    const inline = top.find((e) => e.script.kind === 'document')!;
    expect(inline, brief(top)).toMatchObject({ hookPoints: ['listen'], eventCodes: ['change'], targetKinds: ['field'] });
    // mousemove on a plain div: counted without a stack sample; click is not a tracked type at all.
    const unattributed = top.find((e) => e.script.kind === 'unknown');
    expect(unattributed?.eventCodes, brief(top)).toContain('mousemove');
    expect(unattributed?.targetKinds, brief(top)).toContain('other');
    expect(unattributed?.sampledCount, brief(top)).toBe(0);
    expect(JSON.stringify(top)).not.toContain('click');

    // The fact in the module projection (ui-protect-get-report of this tab).
    await expect
      .poll(async () => {
        const r = await protectRoute(sw, { type: 'ui-protect-get-report', tabId });
        const projection = (r as unknown as { report?: ProtectProjection | null }).report;
        return projection?.evidence.filter((e) => e.protectKind === 'password-field-listener').length ?? -1;
      }, { timeout: 10_000 })
      .toBe(1);
    const report = await protectRoute(sw, { type: 'ui-protect-get-report', tabId });
    const fact = (report as unknown as { report: ProtectProjection }).report.evidence.find((e) => e.protectKind === 'password-field-listener')!;
    expect(fact, brief(fact)).toMatchObject({ ruleId: 'password-listener', interpretationConfidence: 'low', attributionConfidence: 'sampled-stack', script: recorder, frameContext: 'top', evidenceSource: 'derived', integrity: 'derived' });
    expect(fact.count).toBe(2); // input + keyup on the password field

    // Nothing read the password in either world.
    const wires = await tripwire(page);
    expect(wires.main, brief(wires)).toMatchObject({ hits: 0, selfCheck: 1 });
    expect(wires.isolated, brief(wires)).toMatchObject({ hits: 0, selfCheck: 1 });
  } finally {
    await ext.close();
    await server.close();
  }
});
