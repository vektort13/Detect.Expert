// ADR-020 §C (S08, E21-08 case 2): DNR enforcement of firewall decisions in a real Chromium (all-sites, module with
// value-match + firewall, enabled in Options, browser restarted for SP-1). Ground truth: the stand server's count of
// delivered requests to collect.example.net:4174/fw/collect.
//   site block (example.com > example.net): 0 deliveries from the site and from a cross-site frame on it (topDomains),
//     deliveries from another site;
//   once (tab): stopped in that tab only, removed on a cross-site navigation of the tab;
//   receiver block «везде»: 0 from every site except the receiver's own (first party) and a site allowed explicitly
//     (site allow p40 over receiver block p10); navigation to the receiver itself works.

import { expect, test } from '@playwright/test';
import { brief } from '../helpers';
import { ourDnrRules, protectRoute } from './support';
import { decide, delivered, frameSend, launchFirewallStand, openStandPage, promptFor, report, sendAttempts, typeEmail } from './firewall-support';
import type { FirewallStand, StandPage } from './firewall-support';

async function expectDelivered(stand: FirewallStand, expected: number, what: string): Promise<void> {
  await expect.poll(() => delivered(stand), { message: what }).toBe(expected);
}

async function unchanged(stand: FirewallStand, sp: StandPage, what: string): Promise<void> {
  const before = delivered(stand);
  await sendAttempts(sp);
  await sp.page.waitForTimeout(300);
  expect(delivered(stand), what).toBe(before);
}

async function plusFour(stand: FirewallStand, sp: StandPage, what: string): Promise<void> {
  const before = delivered(stand);
  await sendAttempts(sp);
  await expectDelivered(stand, before + 4, what);
}

test('firewall enforcement: site, once and receiver rules; first party, frames, navigation to the receiver', async () => {
  test.setTimeout(240_000);
  const stand = await launchFirewallStand();
  try {
    // Site block on example.com.
    const a = await openStandPage(stand, 'www.example.com', 'leak-form.html');
    await typeEmail(stand, a);
    await expectDelivered(stand, 1, 'the first request is sent: no rule existed before it');
    await promptFor(stand, a);
    const site = await decide(stand, a, ['example.net'], 'block', 'site');
    expect(site, brief(site)).toMatchObject({ type: 'protect-decision', applied: [{ receiver: 'example.net', ruleApplied: true }] });
    expect((await report(stand, a.tabId)).firewall.topDomainsSupported, 'Chromium 153 has topDomains (SP-9)').toBe(true);
    await unchanged(stand, a, 'site block: no delivery from example.com');
    const b = await openStandPage(stand, 'shop.example.org', 'second-site.html');
    await plusFour(stand, b, 'site block of example.com does not apply on example.org');
    const frame = await openStandPage(stand, 'www.example.com', 'iframe-host.html');
    const beforeFrame = delivered(stand);
    await frameSend(frame);
    await frame.page.waitForTimeout(300);
    expect(delivered(stand), 'a cross-site frame on the blocked site is covered (topDomains)').toBe(beforeFrame);

    // Once on example.org (tab b): only that tab, until it leaves the site.
    await promptFor(stand, b);
    const once = await decide(stand, b, ['example.net'], 'block', 'once');
    expect(once, brief(once)).toMatchObject({ applied: [{ ruleApplied: true }] });
    expect((await report(stand, b.tabId)).firewall.onceRules).toEqual([{ receiver: 'example.net', action: 'block' }]);
    await unchanged(stand, b, 'once: no delivery from the decided tab');
    const b2 = await openStandPage(stand, 'shop.example.org', 'second-site.html');
    await plusFour(stand, b2, 'once: another tab of the same site still delivers');
    expect((await ourDnrRules(stand.sw)).ids.filter((id) => id >= 200000)).toHaveLength(1);
    await b.page.goto(stand.server.origins[0]! + '/protect/firewall/leak-form.html');
    await expect.poll(async () => (await ourDnrRules(stand.sw)).ids.filter((id) => id >= 200000), { message: 'once rule goes on a cross-site navigation' }).toEqual([]);

    // Purge the decisions: the site block goes, example.com delivers again.
    expect((await protectRoute(stand.sw, { type: 'ui-protect-purge', what: 'decisions' })).type).toBe('protect-state');
    await expect.poll(async () => (await ourDnrRules(stand.sw)).ids).toEqual([]);
    await plusFour(stand, a, 'no rule after the purge');

    // A site allow on example.org (no rule needed yet), then a receiver block «везде» decided on example.com.
    const x = await openStandPage(stand, 'www.example.org', 'leak-form.html');
    await promptFor(stand, x);
    expect(await decide(stand, x, ['example.net'], 'allow', 'site')).toMatchObject({ applied: [{ ruleApplied: true }] });
    await promptFor(stand, a);
    expect(await decide(stand, a, ['example.net'], 'block', 'everywhere')).toMatchObject({ applied: [{ ruleApplied: true }] });
    await unchanged(stand, a, 'receiver block: none from example.com');
    const ip = await openStandPage(stand, '127.0.0.1', 'leak-form.html');
    await unchanged(stand, ip, 'receiver block: none from another site (127.0.0.1)');
    await plusFour(stand, x, 'site allow (p40) overrides the receiver block (p10) on example.org');
    const firstParty = await openStandPage(stand, 'www.example.net', 'first-party.html');
    await plusFour(stand, firstParty, 'the receiver site itself is never blocked (excludedTopDomains)');
    const receiverPage = await stand.context.newPage();
    const beforeNav = delivered(stand);
    const response = await receiverPage.goto(stand.server.origins[1]!.replace('127.0.0.1', 'collect.example.net') + '/protect/firewall/receiver.html');
    expect(response?.status(), 'navigation to the receiver works (main_frame is never targeted)').toBe(200);
    await expectDelivered(stand, beforeNav + 1, 'the receiver page’s own request is first party');
    const rows = (await protectRoute(stand.sw, { type: 'ui-protect-list-rules', offset: 0, limit: 50 })) as unknown as { rows: Array<{ ruleKey: string; active: boolean }> };
    expect(rows.rows.map((r) => r.ruleKey).sort()).toEqual(['everywhere:*>example.net', 'site:example.org>example.net']);
    expect(rows.rows.every((r) => r.active)).toBe(true);
  } finally {
    await stand.close();
  }
});
