// ADR-020 §8, §10, §15 п. 12 (S15, E21-15): after «Выключить «Защиту»» with «удалить данные» (Options UI) nothing of the
// module is left — with every feature on and real data before: a firewall decision (IndexedDB + our DNR rule), the GPC
// rule, history sightings, protect-* session keys, the settings key, the module's registrations and webRequest
// listeners. After: our rules are removed before the optional DNR grant (SP-5: a rule outlives the grant, so delivery to
// the formerly blocked receiver proves the removal), only the observation registrations remain, the database
// detect-expert-protect does not exist, no protect* keys, no listeners, navigator.globalPrivacyControl is undefined on a
// new page. The stand restarts the browser after the DNR grant (SP-1).

import { expect, test } from '@playwright/test';
import { brief, disableProtectViaOptions, dumpLocal, dumpSession, fixtureResult, tabIdOf } from '../helpers';
import {
  NO_LISTENERS,
  OBSERVATION_SCRIPT_IDS,
  PROTECT_DB,
  databases,
  dumpProtectDb,
  ourDnrRules,
  protectListeners,
  protectState,
  registeredIds,
  standUrl,
  typeInto,
} from './support';
import type { ProtectStateResponse } from './support';
import { decide, launchFirewallStand, report } from './firewall-support';
import { vmDebug } from './value-match-support';

const FEATURES = ['value-match', 'firewall', 'session-replay', 'history', 'gpc'];

test('stand: every feature with data, then disable with purge → no rules, registrations, IndexedDB, protect keys or listeners', async () => {
  test.setTimeout(300_000);
  const stand = await launchFirewallStand(FEATURES);
  try {
    const state = await protectState(stand.sw);
    expect(state.features, brief(state)).toEqual(FEATURES);
    const rp = new URL(stand.server.origins[1]!).port;
    const page = await stand.context.newPage();
    await page.goto(standUrl(stand.server.origins[0]!, 'www.example.com', '/protect/forms/pixel-hash-on-blur.html') + '?rp=' + rp);
    await fixtureResult(page);
    const tabId = await tabIdOf(stand.sw, page.url());
    const pixelKey = 'GET px.tracker.example.net:' + rp + '/tr';
    const delivered = (): number => stand.server.stats.routes['forms']?.[pixelKey] ?? 0;

    // Data of every kind: evidence → prompt → a site block rule; GPC rule; history sightings (flush every 5 s).
    await typeInto(page, page.locator('#email'), 'stand-all-off@example.com');
    await expect.poll(async () => Number((await vmDebug(stand.sw))['fields'] ?? 0)).toBeGreaterThanOrEqual(1);
    await page.locator('#title').click();
    await expect.poll(async () => (await report(stand, tabId)).firewall.prompt?.receivers ?? [], { timeout: 20_000 }).toContain('example.net');
    const decided = await decide(stand, { page, tabId }, ['example.net'], 'block', 'site');
    expect(decided.type, brief(decided)).toBe('protect-decision');
    await expect.poll(async () => (await ourDnrRules(stand.sw)).ids.sort((a, b) => a - b), { timeout: 10_000 }).toEqual([1, 100000]);
    await expect.poll(async () => ((await dumpProtectDb(stand.sw))['sightings'] ?? []).length, { timeout: 20_000, message: 'history flush' }).toBeGreaterThan(0);
    const db = await dumpProtectDb(stand.sw);
    expect((db['decisions'] ?? []).length).toBe(1);
    expect(Object.keys(await dumpSession(stand.sw)).some((k) => k.startsWith('protect'))).toBe(true);
    expect((await dumpLocal(stand.sw))['protect']).toBeDefined();
    expect(await protectListeners(stand.sw)).not.toEqual(NO_LISTENERS);
    // The rule works: a repeat is not delivered.
    const blockedBefore = delivered();
    await page.locator('#email').click();
    await page.locator('#title').click();
    await page.waitForTimeout(800);
    expect(delivered()).toBe(blockedBefore);

    // «Выключить «Защиту»» with «удалить данные» (default on).
    const off = (await disableProtectViaOptions(stand.context, stand.sw, true)) as ProtectStateResponse;
    expect(off.state?.state, brief(off)).toBe('off');
    expect(await registeredIds(stand.sw)).toEqual([...OBSERVATION_SCRIPT_IDS].sort());
    await expect.poll(() => databases(stand.sw), { timeout: 10_000 }).not.toContain(PROTECT_DB);
    expect((await dumpLocal(stand.sw))['protect']).toBeUndefined();
    expect(Object.keys(await dumpSession(stand.sw)).filter((k) => k.startsWith('protect'))).toEqual([]);
    expect(await protectListeners(stand.sw)).toEqual(NO_LISTENERS);
    expect(await stand.sw.evaluate(() => chrome.permissions.contains({ permissions: ['declarativeNetRequestWithHostAccess'] }))).toBe(false);
    // SP-5: an orphan rule would still block; the next send reaches the server, so our rules are gone.
    const beforeSend = delivered();
    await page.locator('#email').click();
    await page.locator('#title').click();
    await expect.poll(delivered, { timeout: 10_000, message: 'delivered after disable' }).toBe(beforeSend + 1);
    // A new document gets no module file: no GPC property.
    const fresh = await stand.context.newPage();
    await fresh.goto(standUrl(stand.server.origins[0]!, 'www.example.org', '/protect/forms/pixel-hash-on-blur.html') + '?rp=' + rp);
    await fixtureResult(fresh);
    expect(await fresh.evaluate(() => (navigator as unknown as { globalPrivacyControl?: unknown }).globalPrivacyControl)).toBeUndefined();
  } finally {
    await stand.close();
  }
});
