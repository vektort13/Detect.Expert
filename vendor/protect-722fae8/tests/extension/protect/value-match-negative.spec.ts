// ADR-020 §4, §12 (S07): negative controls of value matching in real Chromium.
// 1. The site itself sends a password (plain JSON with a credential key, and its sha256 in a pixel): the extension
//    never reads a password, so it has no fingerprint: no evidence, the lane's field count does not grow and the
//    ISOLATED tripwire counts no read.
// 2. Revoke: turning value-match off stops the intake at once — the lane stops, open documents are told to re-key and
//    drop the salt (no further read), and a later pixel with the e-mail hash produces nothing.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { repoRoot } from '../harness';
import { brief } from '../helpers';
import { protectRoute, tripwire, typeInto } from './support';
import type { Canary } from './support';
import { delivered, launchValueMatchStand, openForm, transfers, vmDebug, waitFields } from './value-match-support';

const registry = JSON.parse(readFileSync(path.join(repoRoot, 'fixtures/privacy/canaries.json'), 'utf8')) as { protect: Canary[] };
const canary = (id: string): string => registry.protect.find((c) => c.id === id)!.value;

test('password sent by the site: no evidence, no fingerprint, no read', async () => {
  test.setTimeout(120_000);
  const stand = await launchValueMatchStand();
  try {
    const pw = await openForm(stand, 'password-negative.html');
    const before = Number((await vmDebug(stand.sw))['fields'] ?? 0);
    await typeInto(pw.page, pw.page.locator('#password'), canary('protect-password'));
    await pw.page.locator('#title').click();
    await expect.poll(() => delivered(stand)['POST pw.collect.example.org:' + stand.rp + '/fsink/pw'] ?? 0, { message: 'the page sent the password itself' }).toBeGreaterThanOrEqual(1);
    await expect.poll(() => delivered(stand)['GET pw.collect.example.org:' + stand.rp + '/tr'] ?? 0).toBeGreaterThanOrEqual(1);
    await pw.page.waitForTimeout(1000);
    expect(await transfers(stand.sw, pw.tabId)).toEqual([]);
    const debug = await vmDebug(stand.sw);
    expect(Number(debug['fields'] ?? 0), brief(debug)).toBe(before);
    expect((await tripwire(pw.page)).isolated, 'the module never read the password').toMatchObject({ hits: 0, nonPasswordReads: 0 });
  } finally {
    await stand.close();
  }
});

test('revoke: turning value-match off stops reading and matching on an open page', async () => {
  test.setTimeout(120_000);
  const stand = await launchValueMatchStand(['value-match', 'session-replay']);
  try {
    const px = await openForm(stand, 'pixel-hash-on-blur.html');
    await typeInto(px.page, px.page.locator('#email'), 'first.user@example.org');
    await waitFields(stand.sw, 1);
    const readsBefore = (await tripwire(px.page)).isolated?.nonPasswordReads ?? 0;
    expect(readsBefore).toBeGreaterThanOrEqual(1);
    const off = await protectRoute(stand.sw, { type: 'ui-protect-set-settings', features: ['session-replay'] });
    expect(off.type, brief(off)).toBe('protect-state');
    expect((await vmDebug(stand.sw))['running']).toBe(false);
    await px.page.waitForTimeout(500); // the document re-keys and drops the salt
    // More typing after the lane stopped, then blur: the page's pixel goes, the module neither reads nor matches.
    await typeInto(px.page, px.page.locator('#email'), canary('protect-email'));
    await px.page.waitForTimeout(600);
    await px.page.locator('#title').click();
    await expect.poll(() => delivered(stand)['GET px.tracker.example.net:' + stand.rp + '/tr'] ?? 0).toBeGreaterThanOrEqual(1);
    await px.page.waitForTimeout(800);
    expect((await transfers(stand.sw, px.tabId)).filter((e) => e.protectKind === 'value-match')).toEqual([]);
    expect((await tripwire(px.page)).isolated?.nonPasswordReads, 'no read after value-match was turned off').toBe(readsBefore);
  } finally {
    await stand.close();
  }
});
