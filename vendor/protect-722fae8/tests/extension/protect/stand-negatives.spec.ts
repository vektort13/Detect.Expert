// ADR-020 §B, §C, §D (S15, E21-15): negatives of the whole chain — no firewall card where there is no third-party
// transfer of a typed value.
//   first-party autosave: the site saves the draft to its own origin while the user types → value-match evidence
//     first-party-before-submit (the positive control: matching worked), but no prompt, no card, no badge number;
//   password: the site sends the typed password in plain text and as SHA-256 to a third party → the module never read
//     it, so no evidence at all, no new fingerprint field in the SW, no prompt, no card; the ISOLATED tripwire stays 0.
// Real path: trusted typing, module with value-match + firewall enabled through the Options consent screen.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Worker } from '@playwright/test';
import { getServiceWorker, repoRoot, startFixtureServer } from '../harness';
import { brief, enableProtectViaOptions, fixtureResult, openExtensionPage, tabIdOf } from '../helpers';
import { canaryHits, grantAllSites, launchProtect, standUrl, tripwire, typeInto } from './support';
import type { Canary, ProtectStateResponse } from './support';
import { protectReport, vmDebug } from './value-match-support';

const registry = JSON.parse(readFileSync(path.join(repoRoot, 'fixtures/privacy/canaries.json'), 'utf8')) as { protect: Canary[] };
const canary = (id: string): string => registry.protect.find((c) => c.id === id)!.value;
const FIELD_CANARIES = registry.protect.filter((c) => c.id.startsWith('protect-'));

async function noCard(sw: Worker, ext: Awaited<ReturnType<typeof launchProtect>>, tabId: number): Promise<void> {
  const rep = await protectReport(sw, tabId);
  expect(rep.firewall.prompt, brief(rep.firewall)).toBeNull();
  expect(await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)).not.toMatch(/^[1-9]/);
  const popup = await openExtensionPage(ext.context, sw, 'popup.html?tabId=' + String(tabId));
  await popup.waitForTimeout(1500);
  await expect(popup.locator('[data-fw-card]')).toHaveCount(0);
  expect(canaryHits(await popup.locator('body').innerText(), FIELD_CANARIES)).toEqual([]);
  await popup.close();
}

test('stand negatives: first-party autosave and a password sent by the site → no firewall card', async () => {
  test.setTimeout(180_000);
  const ext = await launchProtect();
  const server = await startFixtureServer();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = (await enableProtectViaOptions(ext.context, sw, ['value-match', 'firewall'])) as ProtectStateResponse;
    expect(on.state?.state, brief(on)).toBe('active');
    const rp = new URL(server.origins[1]!).port;

    // First-party autosave: the positive control is the first-party evidence itself.
    const auto = await ext.context.newPage();
    await auto.goto(standUrl(server.origins[0]!, 'www.example.com', '/protect/forms/first-party-autosave.html') + '?rp=' + rp);
    await fixtureResult(auto);
    const autoTab = await tabIdOf(sw, auto.url());
    await typeInto(auto, auto.locator('#email'), canary('protect-email'));
    await expect.poll(async () => Number((await vmDebug(sw))['fields'] ?? 0)).toBeGreaterThanOrEqual(1);
    await auto.locator('#title').click();
    await expect.poll(async () => (await protectReport(sw, autoTab)).evidence.some((e) => e.protectKind === 'value-match' && e.transferClass === 'first-party-before-submit'), { timeout: 20_000, message: 'first-party evidence (positive control)' }).toBe(true);
    const autoRep = await protectReport(sw, autoTab);
    expect(autoRep.evidence.filter((e) => e.protectKind === 'value-match' && e.transferClass !== 'first-party-before-submit'), brief(autoRep.evidence)).toEqual([]);
    await noCard(sw, ext, autoTab);

    // Password sent by the site itself: nothing of it is ever read, matched or shown.
    const fieldsBefore = Number((await vmDebug(sw))['fields'] ?? 0);
    const pw = await ext.context.newPage();
    await pw.goto(standUrl(server.origins[0]!, 'www.example.com', '/protect/forms/password-negative.html') + '?rp=' + rp);
    await fixtureResult(pw);
    const pwTab = await tabIdOf(sw, pw.url());
    await typeInto(pw, pw.locator('#password'), canary('protect-password'));
    await pw.locator('#title').click();
    await expect.poll(() => server.stats.routes['forms']?.['POST pw.collect.example.org:' + rp + '/fsink/pw'] ?? 0, { timeout: 10_000, message: 'the site sent its password' }).toBe(1);
    await pw.waitForTimeout(2500);
    const pwRep = await protectReport(sw, pwTab);
    expect(pwRep.evidence.filter((e) => e.protectKind === 'value-match' || e.protectKind === 'opaque-after-input'), brief(pwRep.evidence)).toEqual([]);
    expect(Number((await vmDebug(sw))['fields'] ?? 0)).toBe(fieldsBefore);
    expect((await tripwire(pw)).isolated?.hits).toBe(0);
    await noCard(sw, ext, pwTab);
  } finally {
    await ext.close();
    await server.close();
  }
});
