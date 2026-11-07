// ADR-020 §B (S07): the transfer classes in real Chromium (fixtures/protect/forms): a keylogger beacon (JSON `v`), an
// ESP form submission (body-form `email`, at submit), first-party autosave (no third party), a conversion pixel after
// a form POST (value from the previous document) and a cross-site form frame. One stand, a fresh tab per flow.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { repoRoot } from '../harness';
import { brief, fixtureResult } from '../helpers';
import { canaryHits, typeInto } from './support';
import type { Canary } from './support';
import { delivered, evidenceWhere, launchValueMatchStand, openForm, transfers, typeAndLeave, waitFields } from './value-match-support';

const registry = JSON.parse(readFileSync(path.join(repoRoot, 'fixtures/privacy/canaries.json'), 'utf8')) as { protect: Canary[] };
const EMAIL = registry.protect.find((c) => c.id === 'protect-email')!.value;
const FIELD_CANARIES = registry.protect.filter((c) => c.id.startsWith('protect-'));

test('keylogger beacon, ESP submit, first-party autosave, thank-you pixel, cross-site form frame', async () => {
  test.setTimeout(240_000);
  const stand = await launchValueMatchStand();
  try {
    // 1. Keylogger: sendBeacon text/plain {"v": …} on every input (the full value usually precedes the fingerprint).
    const kl = await openForm(stand, 'keylogger-beacon.html');
    await typeAndLeave(stand, kl, '#email', EMAIL);
    const beacon = await evidenceWhere(stand.sw, kl.tabId, (e) => e.receiver === 'example.org' && e.requestKind === 'beacon', 'keylogger evidence');
    expect(beacon).toMatchObject({ transferClass: 'third-party-before-submit', location: 'body-json', paramName: 'v', encodings: ['plain'], interpretationConfidence: 'high', method: 'POST' });
    await kl.page.close();

    // 2. ESP: a plain form POST to another site (the submission itself carries the value).
    const esp = await openForm(stand, 'esp-on-submit.html');
    await typeInto(esp.page, esp.page.locator('#email'), EMAIL);
    await waitFields(stand.sw, 1);
    await esp.page.locator('#submit').click();
    const atSubmit = await evidenceWhere(stand.sw, esp.tabId, (e) => e.endpointHost === 'esp.example.org', 'ESP submission evidence');
    expect(atSubmit).toMatchObject({ transferClass: 'third-party-at-submit', submitTiming: 'after-submit', location: 'body-form', paramName: 'email', requestKind: 'navigation', method: 'POST' });
    await esp.page.close();

    // 3. First-party autosave: the site's own origin before submission; no third party.
    const auto = await openForm(stand, 'first-party-autosave.html');
    await typeAndLeave(stand, auto, '#email', EMAIL);
    const own = await evidenceWhere(stand.sw, auto.tabId, (e) => e.transferClass === 'first-party-before-submit', 'autosave evidence');
    expect(own).toMatchObject({ location: 'body-json', paramName: 'draft.email', relation: 'same-site', receiver: 'example.com' });
    await auto.page.waitForTimeout(800);
    expect((await transfers(stand.sw, auto.tabId)).filter((e) => e.relation !== 'same-site'), 'no third party in the autosave page').toEqual([]);
    await auto.page.close();

    // 4. Thank-you: same-site form POST, then the conversion pixel on the next page.
    const ty = await openForm(stand, 'thank-you-start.html');
    await typeInto(ty.page, ty.page.locator('#email'), EMAIL);
    await waitFields(stand.sw, 1);
    await Promise.all([ty.page.waitForURL(/thank-you\.html/), ty.page.locator('#submit').click()]);
    await fixtureResult(ty.page);
    const conversion = await evidenceWhere(stand.sw, ty.tabId, (e) => e.endpointHost === 'px.tracker.example.net', 'conversion pixel evidence');
    expect(conversion).toMatchObject({ transferClass: 'third-party-at-submit', encodings: ['sha256-hex'], paramName: 'ud[em]' });
    expect(conversion.limitationCodes).toContain('value-from-previous-document');
    expect(conversion.fieldRef).toBeUndefined();
    expect(['low', 'medium']).toContain(conversion.interpretationConfidence);
    await ty.page.close();

    // 5. A form in a cross-site frame posting to its own origin.
    const parent = await openForm(stand, 'iframe-parent.html');
    await expect.poll(() => parent.page.evaluate(() => (window as unknown as { __fixtureResult: { events: string[] } }).__fixtureResult.events.includes('frame-loaded'))).toBe(true);
    await typeInto(parent.page, parent.page.frameLocator('#form-frame').locator('#frame-email'), EMAIL);
    await waitFields(stand.sw, 1);
    await parent.page.locator('#title').click();
    const framed = await evidenceWhere(stand.sw, parent.tabId, (e) => e.frameContext === 'cross-site-frame', 'cross-site frame evidence');
    expect(framed).toMatchObject({ frameSite: 'example.org', receiver: 'example.org', location: 'body-form', paramName: 'email', transferClass: 'third-party-before-submit' });
    expect(framed.limitationCodes).toContain('receiver-hosts-form-frame');

    const all = [kl, esp, auto, ty, parent].map((p) => p.tabId);
    const dumps = await Promise.all(all.map((id) => transfers(stand.sw, id).catch(() => [])));
    expect(canaryHits(JSON.stringify(dumps), FIELD_CANARIES), brief(dumps, 400)).toEqual([]);
    test.info().annotations.push({ type: 'delivered', description: JSON.stringify(delivered(stand)) });
  } finally {
    await stand.close();
  }
});
