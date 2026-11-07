// ADR-020 §3, §C (S08, E21-08 case 2): blocking presets in a real Chromium.
//   strict + the synthetic preset table (test profile: collect.example.net): the preset rule exists before any page,
//     so even the first request to it is stopped (the rule was in place before the request — §11 holds);
//   strict-auto: after the first event of a receiver that is not in the preset, a site-level block (origin preset,
//     with undo) stops the following requests; the first one was sent; «везде» is never automatic;
//   warn-only: no rule at all (every request delivered), enforcement `warn-only`.

import { expect, test } from '@playwright/test';
import { brief } from '../helpers';
import { ourDnrRules, protectRoute } from './support';
import { delivered, inject, launchFirewallStand, openStandPage, report, sendAttempts, typeEmail } from './firewall-support';

test('presets: strict with the synthetic preset, strict-auto after the first event, warn-only', async () => {
  test.setTimeout(240_000);
  const stand = await launchFirewallStand(['value-match', 'firewall'], 'strict');
  try {
    expect((await ourDnrRules(stand.sw)).ids, 'the preset rule exists before any page').toEqual([101000]);
    const a = await openStandPage(stand, 'www.example.com', 'leak-form.html');
    await typeEmail(stand, a);
    await a.page.waitForTimeout(400);
    expect(delivered(stand), 'strict + synthetic preset: the very first request is stopped (rule in place before it)').toBe(0);
    await expect.poll(async () => (await report(stand, a.tabId)).firewall.stoppedToday.count).toBeGreaterThanOrEqual(1);

    // Strict-auto on another site with a receiver host outside the preset.
    const b = await openStandPage(stand, 'shop.example.org', 'leak-form.html', '?to=beacon.example.net');
    await typeEmail(stand, b);
    await expect.poll(() => delivered(stand, 'beacon.example.net'), { message: 'the first request to a new receiver is sent' }).toBe(1);
    await inject(stand, { op: 'evidence', tabId: b.tabId, receiver: 'example.net' });
    await expect.poll(async () => (await report(stand, b.tabId)).firewall.notices.map((n) => n.kind), { message: 'strict-auto notice' }).toContain('strict-auto');
    const notice = (await report(stand, b.tabId)).firewall.notices.find((n) => n.kind === 'strict-auto');
    expect(notice, brief(notice)).toMatchObject({ receiver: 'example.net', site: 'example.org' });
    expect(notice!.undoId).toMatch(/^[0-9a-f]{16}$/);
    await b.page.waitForTimeout(200);
    await sendAttempts(b);
    expect(delivered(stand, 'beacon.example.net'), 'strict-auto stops the following requests').toBe(1);
    const rules = (await protectRoute(stand.sw, { type: 'ui-protect-list-rules', offset: 0, limit: 50 })) as unknown as { rows: Array<{ ruleKey: string; origin: string; scope: string }> };
    expect(rules.rows.map((r) => [r.ruleKey, r.origin, r.scope]), '«везде» never automatically').toEqual(expect.arrayContaining([['site:example.org>example.net', 'preset', 'site']]));
    expect(rules.rows.every((r) => r.scope === 'site')).toBe(true);

    // warn-only: every rule goes, requests are delivered, nothing is claimed as stopped.
    expect((await protectRoute(stand.sw, { type: 'ui-protect-set-settings', preset: 'warn-only' })).type).toBe('protect-state');
    await expect.poll(async () => {
      await report(stand, b.tabId); // any lane call notices the new preset
      return (await ourDnrRules(stand.sw)).ids;
    }, { message: 'warn-only: no rule' }).toEqual([]);
    expect((await report(stand, b.tabId)).firewall.enforcement).toBe('warn-only');
    await sendAttempts(b);
    await expect.poll(() => delivered(stand, 'beacon.example.net')).toBe(5);
    await sendAttempts(a);
    await expect.poll(() => delivered(stand)).toBe(4);
  } finally {
    await stand.close();
  }
});
