// ADR-020 §7 (SP-5), §8 (S08, E21-08 case 2): turning the firewall off and taking its permission away.
//   - disable without purge (Options): our rules go before the permission, requests are delivered again, the
//     decisions stay in IndexedDB; enabling again (and the SP-1 restart) brings the same rules back;
//   - the DNR permission removed while active: needs-permission; SP-5 — the rules keep acting without the API;
//     granted again by a click: the module resumes and our ranges are reconciled (no duplicate, no foreign rule);
//   - disable with purge: IndexedDB, rules and decisions are gone.

import { expect, test } from '@playwright/test';
import { brief, disableProtectViaOptions, enableProtectViaOptions, openExtensionPage } from '../helpers';
import { PROTECT_DB, databases, dumpProtectDb, ourDnrRules, protectState } from './support';
import type { ProtectStateResponse } from './support';
import { decide, delivered, launchFirewallStand, openStandPage, promptFor, sendAttempts } from './firewall-support';
import type { FirewallStand, StandPage } from './firewall-support';

const DNR = 'declarativeNetRequestWithHostAccess' as chrome.runtime.ManifestPermission;

async function deliveredDelta(stand: FirewallStand, sp: StandPage): Promise<number> {
  const before = delivered(stand);
  await sendAttempts(sp);
  await sp.page.waitForTimeout(400);
  return delivered(stand) - before;
}

async function grantDnrByClick(stand: FirewallStand): Promise<boolean> {
  const page = await openExtensionPage(stand.context, stand.sw, 'options.html');
  try {
    await page.evaluate((permission) => {
      const button = document.createElement('button');
      button.id = 'fw-grant-dnr';
      button.textContent = 'grant';
      button.addEventListener('click', () => {
        void chrome.permissions.request({ permissions: [permission] }).then((r) => {
          (window as unknown as { __granted?: boolean }).__granted = r;
        });
      });
      document.body.prepend(button);
    }, DNR);
    await page.locator('#fw-grant-dnr').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __granted?: boolean }).__granted)).not.toBeUndefined();
    return (await page.evaluate(() => (window as unknown as { __granted?: boolean }).__granted)) === true;
  } finally {
    await page.close();
  }
}

test('revocation: disable with and without purge, DNR permission removed and granted again', async () => {
  test.setTimeout(300_000);
  const stand = await launchFirewallStand();
  try {
    const a = await openStandPage(stand, 'www.example.com', 'leak-form.html');
    await promptFor(stand, a);
    expect(await decide(stand, a, ['example.net'], 'block', 'site')).toMatchObject({ applied: [{ ruleApplied: true }] });
    expect(await deliveredDelta(stand, a)).toBe(0);

    // Off without purge: rules first, then the permission (Options); decisions stay.
    const off = (await disableProtectViaOptions(stand.context, stand.sw, false)) as ProtectStateResponse;
    expect(off.state?.state, brief(off)).toBe('off');
    await expect.poll(() => stand.sw.evaluate((p) => chrome.permissions.contains({ permissions: [p] }), DNR)).toBe(false);
    expect(await deliveredDelta(stand, a), 'no rule once the module is off').toBe(4);
    expect((await dumpProtectDb(stand.sw))['decisions'], 'decisions are kept without purge').toHaveLength(1);

    // On again (consent screen, DNR by click), then the SP-1 restart: the same rule comes back.
    const on = (await enableProtectViaOptions(stand.context, stand.sw, ['value-match', 'firewall'])) as ProtectStateResponse;
    expect(on.state?.state, brief(on)).toBe('active');
    await stand.restart();
    expect((await ourDnrRules(stand.sw)).ids).toEqual([100000]);
    const a2 = await openStandPage(stand, 'www.example.com', 'leak-form.html');
    expect(await deliveredDelta(stand, a2), 'the stored decision is enforced again').toBe(0);

    // The DNR permission removed while active: needs-permission; SP-5: the rules still act without the API.
    expect(await stand.sw.evaluate((p) => chrome.permissions.remove({ permissions: [p] }), DNR)).toBe(true);
    await expect.poll(async () => (await protectState(stand.sw)).state).toBe('needs-permission');
    const removed = await protectState(stand.sw);
    expect(removed.permissions.dnr).toBe(false);
    expect(await deliveredDelta(stand, a2), 'SP-5: rules outlive the removed permission').toBe(0);

    // Granted again by a click: the module resumes; our ranges are reconciled before anything else is written.
    expect(await grantDnrByClick(stand)).toBe(true);
    await expect.poll(async () => (await protectState(stand.sw)).state, { timeout: 20_000 }).toBe('active');
    await expect.poll(async () => (await ourDnrRules(stand.sw)).ids).toEqual([100000]);
    expect(await deliveredDelta(stand, a2)).toBe(0);

    // Off with purge: everything of the module goes, requests are delivered.
    const purged = (await disableProtectViaOptions(stand.context, stand.sw, true)) as ProtectStateResponse;
    expect(purged.state?.state, brief(purged)).toBe('off');
    await expect.poll(() => databases(stand.sw)).not.toContain(PROTECT_DB);
    expect(await deliveredDelta(stand, a2), 'no rule after the purge').toBe(4);
  } finally {
    await stand.close();
  }
});
