// ADR-020 §B, §C, §D, §11 (S15, E21-15): the whole firewall flow on the real path, no injected evidence.
//   1. the pixel of fixtures/protect/forms (sha256 of the typed e-mail on blur, before any submission) → value-match
//      evidence (third-party-before-submit, high, sent) → badge «1» → popup card: alert fw_alert_sent_before_submit,
//      the «Кто» row (sender; a script only with a sampled stack) → «Этот сайт» + «Блокировать следующие»;
//   2. the page sends again → no new card, the fixture server did not receive it, stoppedToday grows (a lower bound) and
//      the evidence gets deliveryState `stopped` (our rule was active ≥ 50 ms before the request, ERR_BLOCKED_BY_CLIENT);
//   3. «Отменить решение» → our rule is gone and the next send reaches the server again.
// The stand restarts the browser after the optional DNR grant (SP-1). Ground truth of deliveries is the fixture server.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { ProtectTransferEvidence } from '@detect-expert/contracts';
import { extensionIdOf, repoRoot } from '../harness';
import { brief, fixtureResult, tabIdOf } from '../helpers';
import { canaryHits, ourDnrRules, standUrl, tripwire, typeInto } from './support';
import type { Canary } from './support';
import { SLACK_WAIT_MS, launchFirewallStand, report } from './firewall-support';
import { transfers, vmDebug } from './value-match-support';

type Messages = Record<string, { message: string }>;
const registry = JSON.parse(readFileSync(path.join(repoRoot, 'fixtures/privacy/canaries.json'), 'utf8')) as { protect: Canary[] };
const EMAIL = registry.protect.find((c) => c.id === 'protect-email')!.value;
const FIELD_CANARIES = registry.protect.filter((c) => c.id.startsWith('protect-'));
const LOCALES = ['en', 'ru'].map((l) => JSON.parse(readFileSync(path.join(repoRoot, 'apps/extension/_locales', l, 'messages.json'), 'utf8')) as Messages);

/** The alert text before its $DATA$ placeholder, in every locale (the UI language of the headless browser may vary). */
function alertPrefixes(receiver: string): string[] {
  return LOCALES.map((m) => m['fw_alert_sent_before_submit']!.message.replace('$RECEIVER$', receiver).split('$DATA$')[0]!.trim());
}

test('stand: pixel → evidence → badge 1 → card «sent before submit» with «Кто» → this site + block → repeat stopped → undo', async () => {
  test.setTimeout(300_000);
  const stand = await launchFirewallStand(['value-match', 'firewall']);
  try {
    const rp = new URL(stand.server.origins[1]!).port;
    const page = await stand.context.newPage();
    await page.goto(standUrl(stand.server.origins[0]!, 'www.example.com', '/protect/forms/pixel-hash-on-blur.html') + '?rp=' + rp);
    await fixtureResult(page);
    const tabId = await tabIdOf(stand.sw, page.url());
    const pixelKey = 'GET px.tracker.example.net:' + rp + '/tr';
    const delivered = (): number => stand.server.stats.routes['forms']?.[pixelKey] ?? 0;
    const badgeText = (): Promise<string> => stand.sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
    const matched = async (): Promise<ProtectTransferEvidence[]> => (await transfers(stand.sw, tabId)).filter((e) => e.receiver === 'example.net');

    // 1. Trusted typing; the page's own pixel leaves on blur (the first request is never stopped).
    await typeInto(page, page.locator('#email'), EMAIL);
    await expect.poll(async () => Number((await vmDebug(stand.sw))['fields'] ?? 0), { message: 'fingerprints in the SW' }).toBeGreaterThanOrEqual(1);
    await page.locator('#title').click();
    await expect.poll(async () => (await matched()).some((e) => e.deliveryState === 'sent'), { timeout: 20_000, message: 'value-match evidence, sent' }).toBe(true);
    const first = (await matched()).find((e) => e.deliveryState === 'sent')!;
    expect(first, brief(first)).toMatchObject({ protectKind: 'value-match', transferClass: 'third-party-before-submit', fieldKind: 'email', interpretationConfidence: 'high', submitTiming: 'before-submit' });
    expect(delivered(), 'Chrome delivered the first pixel').toBe(1);
    await expect.poll(badgeText, { timeout: 10_000 }).toBe('1');

    const popup = await stand.context.newPage();
    await popup.setViewportSize({ width: 360, height: 600 });
    await popup.goto('chrome-extension://' + extensionIdOf(stand.sw) + '/popup.html?tabId=' + String(tabId));
    const card = popup.locator('[data-fw-card]');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toHaveAttribute('data-fw-card', 'sent');
    const alert = (await popup.locator('[data-fw-alert] .state__line').innerText()).trim();
    expect(alertPrefixes('example.net').some((p) => alert.startsWith(p)), alert).toBe(true);
    await expect(popup.locator('.fw-row[data-fw-row=receiver] .fw-row__host')).toHaveText('example.net');
    // «Кто»: the sender (frame / site) always; a script only with a sampled stack, never from a frame-level guess.
    const sender = popup.locator('.fw-row[data-fw-row=sender]');
    await expect(sender).toBeVisible();
    const rv = (await report(stand, tabId)).firewall.receivers.find((r) => r.receiver === 'example.net');
    expect(rv, 'receiver view').toBeDefined();
    test.info().annotations.push({ type: 'sender attribution', description: rv!.sender.attributionConfidence });
    console.log('stand-firewall-flow: «Кто» attribution = ' + rv!.sender.attributionConfidence + ', frame = ' + rv!.sender.frame);
    const scriptHost = rv!.sender.attributionConfidence === 'sampled-stack' && rv!.sender.script?.kind === 'external' ? rv!.sender.script.host : undefined;
    if (typeof scriptHost === 'string') {
      await expect(sender.locator('.fw-row__extra')).toContainText(scriptHost);
    } else {
      await expect(sender.locator('.fw-row__extra')).toHaveCount(0);
    }
    expect(canaryHits(await popup.locator('body').innerText(), FIELD_CANARIES)).toEqual([]);

    // «Этот сайт» (the default scope) + «Блокировать следующие».
    await expect(popup.locator('[data-fw-scope]')).toHaveAttribute('data-fw-scope', 'site');
    await popup.locator('input[name=fw-scope][value=site]').check();
    await popup.locator('[data-fw-action=block]').click();
    await expect(popup.locator('#fw-resolved-title')).toBeFocused({ timeout: 10_000 });
    expect((await ourDnrRules(stand.sw)).ids).toEqual([100000]);
    await expect.poll(badgeText, { timeout: 10_000 }).not.toBe('1');

    // 2. The page sends again (focus + blur): our rule was active long before → stopped; no new card.
    await page.waitForTimeout(SLACK_WAIT_MS);
    const before = delivered();
    const stoppedBefore = (await report(stand, tabId)).firewall.stoppedToday.count;
    await page.locator('#email').click();
    await page.locator('#title').click();
    await expect.poll(async () => (await matched()).some((e) => e.deliveryState === 'stopped'), { timeout: 20_000, message: 'evidence of the repeat: stopped' }).toBe(true);
    await page.waitForTimeout(600);
    expect(delivered(), 'the fixture server did not receive the repeat').toBe(before);
    const after = await report(stand, tabId);
    expect(after.firewall.prompt, brief(after.firewall)).toBeNull();
    expect(after.firewall.stoppedToday.countQuality).toBe('lower-bound');
    expect(after.firewall.stoppedToday.count).toBeGreaterThan(stoppedBefore);
    expect(await badgeText()).not.toMatch(/^[1-9]/);
    const again = await stand.context.newPage();
    await again.goto('chrome-extension://' + extensionIdOf(stand.sw) + '/popup.html?tabId=' + String(tabId));
    await again.waitForTimeout(1500);
    await expect(again.locator('[data-fw-action=block]'), 'no new decision card').toHaveCount(0);
    await again.close();

    // 3. «Отменить решение» in the first popup → the rule is gone; the next send reaches the server.
    await popup.locator('[data-fw-undo]').click();
    await expect.poll(async () => (await ourDnrRules(stand.sw)).ids, { timeout: 10_000 }).toEqual([]);
    await page.waitForTimeout(SLACK_WAIT_MS);
    const beforeUndoSend = delivered();
    await page.locator('#email').click();
    await page.locator('#title').click();
    await expect.poll(delivered, { timeout: 10_000, message: 'delivered after undo' }).toBe(beforeUndoSend + 1);
    expect((await tripwire(page)).isolated?.hits).toBe(0);
    await popup.close();
  } finally {
    await stand.close();
  }
});
