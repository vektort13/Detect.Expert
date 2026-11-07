// ADR-020 §C, §D (S15, E21-15): three receivers of one typed e-mail → ONE prompt (tab, site) → one firewall card that
// lists the three receivers (checkboxes, all checked), badge «3». Real path: trusted typing, the page's own pixels to
// px.tracker.example.net, px.ads.example.org and px.metrics.example.edu (three registrable domains; *.example.edu is
// mapped to the loopback stand in this spec). No decision is made, so no DNR write and no browser restart is needed.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { getServiceWorker, launch, repoRoot, startFixtureServer } from '../harness';
import { brief, enableProtectViaOptions, fixtureResult, openExtensionPage, tabIdOf } from '../helpers';
import { PROTECT_RESOLVER, canaryHits, grantAllSites, standUrl, typeInto } from './support';
import type { Canary, ProtectStateResponse } from './support';
import { protectReport, transfers, vmDebug } from './value-match-support';

const registry = JSON.parse(readFileSync(path.join(repoRoot, 'fixtures/privacy/canaries.json'), 'utf8')) as { protect: Canary[] };
const EMAIL = registry.protect.find((c) => c.id === 'protect-email')!.value;
const FIELD_CANARIES = registry.protect.filter((c) => c.id.startsWith('protect-'));
const RECEIVERS = ['example.edu', 'example.net', 'example.org'];

test('stand: three receivers of one value → one prompt, one card with three receivers, badge 3', async () => {
  test.setTimeout(180_000);
  const ext = await launch({ profile: 'test', hostResolverRules: PROTECT_RESOLVER + ', MAP *.example.edu 127.0.0.1' });
  const server = await startFixtureServer();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = (await enableProtectViaOptions(ext.context, sw, ['value-match', 'firewall'])) as ProtectStateResponse;
    expect(on.state?.state, brief(on)).toBe('active');

    const rp = new URL(server.origins[1]!).port;
    const page = await ext.context.newPage();
    await page.goto(standUrl(server.origins[0]!, 'www.example.com', '/protect/stand/multi-pixel.html') + '?rp=' + rp);
    await fixtureResult(page);
    const tabId = await tabIdOf(sw, page.url());
    await typeInto(page, page.locator('#email'), EMAIL);
    await expect.poll(async () => Number((await vmDebug(sw))['fields'] ?? 0), { message: 'fingerprints in the SW' }).toBeGreaterThanOrEqual(1);
    await page.locator('#title').click();

    await expect.poll(async () => [...new Set((await transfers(sw, tabId)).filter((e) => e.transferClass === 'third-party-before-submit').map((e) => e.receiver))].sort(), { timeout: 20_000, message: 'evidence for three receivers' }).toEqual(RECEIVERS);
    await expect.poll(async () => [...((await protectReport(sw, tabId)).firewall.prompt?.receivers ?? [])].sort(), { timeout: 20_000, message: 'one prompt with three receivers' }).toEqual(RECEIVERS);
    const rep = await protectReport(sw, tabId);
    expect(rep.firewall.prompt?.hidden, brief(rep.firewall.prompt)).toBe(0);
    for (const host of ['px.tracker.example.net', 'px.ads.example.org', 'px.metrics.example.edu']) {
      expect(server.stats.routes['forms']?.['GET ' + host + ':' + rp + '/tr'] ?? 0, host).toBe(1);
    }
    await expect.poll(() => sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId), { timeout: 10_000 }).toBe('3');

    const popup = await openExtensionPage(ext.context, sw, 'popup.html?tabId=' + String(tabId));
    await expect(popup.locator('[data-fw-card]')).toHaveCount(1, { timeout: 15_000 });
    const list = popup.locator('[data-fw-receivers]');
    await expect(list).toHaveAttribute('data-fw-receivers', '3');
    const hosts = (await list.locator('.fw-receivers__host').allInnerTexts()).map((s) => s.trim()).sort();
    expect(hosts).toEqual(RECEIVERS);
    for (const box of await list.locator('input[type=checkbox]').all()) await expect(box).toBeChecked();
    await expect(popup.locator('[data-fw-action=block]')).toHaveCount(1);
    expect(canaryHits(await popup.locator('body').innerText(), FIELD_CANARIES)).toEqual([]);
    await popup.close();
  } finally {
    await ext.close();
    await server.close();
  }
});
