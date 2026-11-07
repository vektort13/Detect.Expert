// ADR-020 §B, §D, §11 (S07): a pixel sends sha256(trim+lower e-mail) to a third party on blur, before any submission.
// Real Chromium, all sites granted, module with value-match only. The SW records third-party-before-submit for
// example.net with sha256-hex in ud[em], confidence high, path /tr, and `sent` once Chrome reported onSendHeaders.
// The popup lists it (≤ 5, coverage next to the list) and the side panel shows the details; neither shows the value,
// a hash or a URL. Screenshots (light and dark) go to test-results for review.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { repoRoot } from '../harness';
import { openExtensionPage } from '../helpers';
import { canaryHits, tripwire } from './support';
import type { Canary } from './support';
import { delivered, evidenceWhere, launchValueMatchStand, openForm, transfers, typeAndLeave } from './value-match-support';

const registry = JSON.parse(readFileSync(path.join(repoRoot, 'fixtures/privacy/canaries.json'), 'utf8')) as { protect: Canary[] };
const EMAIL = registry.protect.find((c) => c.id === 'protect-email')!.value;
const FIELD_CANARIES = registry.protect.filter((c) => c.id.startsWith('protect-'));

test('pixel: sha256(e-mail) on blur → third-party-before-submit, example.net, sha256-hex, ud[em], high, sent, /tr', async () => {
  test.setTimeout(120_000);
  const stand = await launchValueMatchStand();
  try {
    const form = await openForm(stand, 'pixel-hash-on-blur.html');
    await typeAndLeave(stand, form, '#email', EMAIL);
    const ev = await evidenceWhere(stand.sw, form.tabId, (e) => e.receiver === 'example.net' && e.deliveryState === 'sent', 'pixel evidence with delivery sent');
    expect(ev).toMatchObject({
      protectKind: 'value-match',
      transferClass: 'third-party-before-submit',
      fieldKind: 'email',
      encodings: ['sha256-hex'],
      location: 'query',
      paramName: 'ud[em]',
      interpretationConfidence: 'high',
      deliveryState: 'sent',
      endpointHost: 'px.tracker.example.net',
      endpointPathTemplate: '/tr',
      requestKind: 'image',
      method: 'GET',
      relation: 'cross-site',
      submitTiming: 'before-submit',
      frameContext: 'top',
    });
    expect(delivered(stand)['GET px.tracker.example.net:' + stand.rp + '/tr'] ?? 0, 'Chrome delivered the pixel').toBeGreaterThanOrEqual(1);
    expect(canaryHits(JSON.stringify(await transfers(stand.sw, form.tabId)), FIELD_CANARIES)).toEqual([]);
    expect((await tripwire(form.page)).isolated?.hits).toBe(0);

    // Popup: the list (≤ 5) with coverage next to it; no value, hash or URL in the text.
    const popup = await openExtensionPage(stand.ext.context, stand.sw, 'popup.html?tabId=' + String(form.tabId));
    const list = popup.locator('[data-protect-leaks="popup"]');
    await expect(list).toBeVisible({ timeout: 15_000 });
    await expect(list.locator('details.leak')).toHaveCount(1);
    await expect(list.locator('details.leak')).toHaveAttribute('data-delivery', 'sent');
    await expect(list.locator('.leak__title')).toContainText('example.net');
    await list.locator('summary').first().click();
    const popupText = await list.innerText();
    expect(popupText).toMatch(/px\.tracker\.example\.net\/tr/);
    expect(popupText).not.toMatch(/https?:\/\//);
    expect(canaryHits(popupText, FIELD_CANARIES)).toEqual([]);
    await popup.screenshot({ path: test.info().outputPath('popup-light.png'), fullPage: true });
    await popup.emulateMedia({ colorScheme: 'dark' });
    await popup.screenshot({ path: test.info().outputPath('popup-dark.png'), fullPage: true });

    // Side panel: the «Защита» tab shows the expanded details and the fixed notes.
    const panel = await openExtensionPage(stand.ext.context, stand.sw, 'sidepanel.html?tabId=' + String(form.tabId));
    await panel.getByRole('tab', { name: /Protection|Защита/ }).click();
    const details = panel.locator('[data-protect-leaks="panel"]');
    await expect(details).toBeVisible({ timeout: 15_000 });
    await expect(details.locator('details.leak[open]')).toHaveCount(1);
    const panelText = await details.innerText();
    expect(panelText).toMatch(/SHA-256/);
    expect(canaryHits(panelText, FIELD_CANARIES)).toEqual([]);
    await panel.screenshot({ path: test.info().outputPath('sidepanel-light.png'), fullPage: true });
  } finally {
    await stand.close();
  }
});
