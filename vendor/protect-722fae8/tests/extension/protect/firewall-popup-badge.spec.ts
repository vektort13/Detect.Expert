// ADR-020 §D (S09, E21-09 case 5) in a real Chromium with the real service worker (no fixed replies): typing an
// e-mail on the stand page makes the synthetic third party send its hash (value-match, S07) → a firewall prompt (S08)
// → the badge of that tab shows '1' on the firewall colour (the window does not open by itself) → the popup card shows
// the receiver with a truthful state → «Блокировать следующие» (this site) → the outcome is focused, our rule exists,
// the badge is cleared and its colour reset. Other tabs never get the firewall colour.

import { expect, test } from '@playwright/test';
import type { ProtectTransferEvidence } from '@detect-expert/contracts';
import { extensionIdOf } from '../harness';
import { brief } from '../helpers';
import { ourDnrRules } from './support';
import { launchFirewallStand, openStandPage, report, typeEmail } from './firewall-support';

const FIREWALL_RGBA = [36, 86, 179, 255];
const NEUTRAL_RGBA = [95, 99, 104, 255];

test('real SW: a prompt lights the badge; the popup card decides; the badge clears', async () => {
  test.setTimeout(240_000);
  const stand = await launchFirewallStand();
  try {
    const a = await openStandPage(stand, 'www.example.com', 'leak-form.html');
    const other = await openStandPage(stand, 'www.example.org', 'second-site.html');
    const badge = (tabId: number) => stand.sw.evaluate(async (id) => ({
      text: await chrome.action.getBadgeText({ tabId: id }),
      color: await chrome.action.getBadgeBackgroundColor({ tabId: id }),
      title: await chrome.action.getTitle({ tabId: id }),
    }), tabId);
    expect((await badge(a.tabId)).color).not.toEqual(FIREWALL_RGBA);

    await typeEmail(stand, a);
    await expect.poll(async () => (await report(stand, a.tabId)).firewall.prompt?.receivers ?? [], { timeout: 20_000, message: 'a prompt from the real value-match path' }).toContain('example.net');
    await expect.poll(async () => (await badge(a.tabId)).text, { timeout: 10_000 }).toBe('1');
    const lit = await badge(a.tabId);
    expect(lit.color).toEqual(FIREWALL_RGBA);
    expect(lit.title).toMatch(/1/);
    expect(lit.title).not.toMatch(/danger|threat|risk|опасн|угроз/i);
    const others = await badge(other.tabId);
    expect(others.color).not.toEqual(FIREWALL_RGBA);
    expect(['0', '?', '!']).not.toContain(others.text);

    const popup = await stand.context.newPage();
    await popup.setViewportSize({ width: 360, height: 600 });
    await popup.goto('chrome-extension://' + extensionIdOf(stand.sw) + '/popup.html?tabId=' + String(a.tabId));
    const card = popup.locator('[data-fw-card]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    const state = await card.getAttribute('data-fw-card');
    const rep = await report(stand, a.tabId);
    // The card follows the delivery of the request that carried the value (review round 2: not the receiver's
    // lastDelivery, which follows any request to its domain); the first request is never stopped.
    const matched = rep.evidence.filter((e): e is ProtectTransferEvidence => (e.protectKind === 'value-match' || e.protectKind === 'opaque-after-input') && e.receiver === 'example.net');
    expect(matched.length, brief(rep.evidence)).toBeGreaterThan(0);
    expect(matched.some((e) => e.deliveryState === 'stopped'), brief(matched)).toBe(false);
    if (matched.length === 1) expect(state, brief(matched)).toBe(matched[0]!.deliveryState === 'sent' ? 'sent' : 'unknown');
    else {
      expect(['sent', 'unknown'], brief(matched)).toContain(state);
      if (state === 'sent') expect(matched.some((e) => e.deliveryState === 'sent'), brief(matched)).toBe(true);
    }
    await expect(popup.locator('.fw-row[data-fw-row=receiver] .fw-row__host')).toHaveText('example.net');
    const boxes = await popup.locator('.fw-action').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom));
    expect(boxes.every((b) => b <= 600)).toBe(true);

    await popup.locator('[data-fw-action=block]').click();
    await expect(popup.locator('#fw-resolved-title')).toBeFocused({ timeout: 10_000 });
    await expect(popup.locator('[data-fw-resolved]')).toHaveAttribute('data-fw-resolved', 'neutral');
    expect((await ourDnrRules(stand.sw)).ids).toEqual([100000]);
    await expect.poll(async () => (await badge(a.tabId)).text, { timeout: 10_000 }).not.toBe('1');
    expect((await badge(a.tabId)).color).toEqual(NEUTRAL_RGBA);
    expect(['0', '?', '!']).not.toContain((await badge(a.tabId)).text);
    await popup.close();
  } finally {
    await stand.close();
  }
});
