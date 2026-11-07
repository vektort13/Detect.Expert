// ADR-020 §3, §7, §8, §10 (S05, E21-05 case 3): lifecycle of the module «Защита» in a real Chromium.
//   enable -> +2 registrations (ours only) and an active page part;
//   exclude a site -> excludeMatches on both registrations; the site answers protect-ack {active:false} and new
//   documents of it get no module file, another site still does;
//   revoke the broad grant -> needs-permission and none of our registrations; grant again -> active;
//   snooze -> snoozedUntil within now .. now + 1 h; snooze 0 -> null;
//   disable with purge -> IndexedDB, protect-* session keys and storage.local['protect'] are gone.
// Review r2: a site exclusion also covers cross-site frames of a tab whose top document loaded before the module was
// enabled (the SW takes the tab's top site from MessageSender.tab.url, not only from its own tab model).
// Enabling and the final disable go through the Options UI (S06: consent screen, permissions in the click); the other
// steps use __protectHarness (Options sender route, test profiles).

import { expect, test } from '@playwright/test';
import type { Frame, Page, Worker } from '@playwright/test';
import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import { getServiceWorker, startFixtureServer } from '../harness';
import { brief, disableProtectViaOptions, enableProtectViaOptions, fixtureResult, tabIdOf } from '../helpers';
import {
  OBSERVATION_SCRIPT_IDS,
  PROTECT_DB,
  PROTECT_SCRIPT_IDS,
  databases,
  enableProtect,
  grantAllSites,
  launchProtect,
  protectListeners,
  protectRoute,
  protectState,
  registeredIds,
  registeredScripts,
  revokeAllSites,
  standUrl,
  tripwire,
  typeInto,
} from './support';
import type { ProtectStateResponse } from './support';

/** protect-hello sent from the extension's ISOLATED world of a tab (what protect.js sends); the SW's answer. */
async function helloFrom(sw: Worker, tabId: number): Promise<unknown> {
  return sw.evaluate(async (id) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId: id },
      world: 'ISOLATED',
      func: async () => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'protect-hello', startedLate: true }),
    });
    return results[0]?.result as unknown;
  }, tabId);
}

/** Appends a cross-site iframe (#probe-frame) to the page and returns its Frame once loaded. */
async function addProbeFrame(page: Page, src: string): Promise<Frame> {
  await page.evaluate((url) => new Promise<void>((resolve) => {
    const frame = document.createElement('iframe');
    frame.id = 'probe-frame';
    frame.src = url;
    frame.width = '600';
    frame.height = '400';
    frame.addEventListener('load', () => resolve());
    document.body.appendChild(frame);
  }), src);
  const frame = page.frames().find((f) => f !== page.mainFrame() && f.url() === src);
  if (frame === undefined) throw new Error('probe frame not found: ' + src);
  return frame;
}

/** protect-hello from the extension's ISOLATED world of the frame of `tabId` whose URL is `url`; the SW's answer. */
async function helloFromFrame(sw: Worker, tabId: number, url: string): Promise<unknown> {
  return sw.evaluate(async ({ id, src }) => {
    const frames = (await chrome.webNavigation.getAllFrames({ tabId: id })) ?? [];
    const target = frames.find((f) => f.frameId !== 0 && f.url === src);
    if (target === undefined) throw new Error('frame not found in tab ' + String(id));
    const results = await chrome.scripting.executeScript({
      target: { tabId: id, frameIds: [target.frameId] },
      world: 'ISOLATED',
      func: async () => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'protect-hello', startedLate: true }),
    });
    return results[0]?.result as unknown;
  }, { id: tabId, src: url });
}

test('lifecycle: enable, site exclusion, broad revoke and re-grant, snooze, disable with purge', async () => {
  test.setTimeout(180_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const before = await registeredIds(sw);
    expect(before).toEqual([...OBSERVATION_SCRIPT_IDS]);

    // Enable through the Options consent screen -> +2 registrations, IndexedDB created, settings only in storage.local.
    const on = (await enableProtectViaOptions(ext.context, sw, ['value-match', 'session-replay'])) as ProtectStateResponse;
    expect(on.state?.state, brief(on)).toBe('active');
    expect(await registeredIds(sw)).toEqual([...before, ...PROTECT_SCRIPT_IDS].sort());
    expect(await databases(sw)).toContain(PROTECT_DB);
    const settings = (await sw.evaluate(() => chrome.storage.local.get('protect')))['protect'] as Record<string, unknown>;
    expect(Object.keys(settings).sort()).toEqual(['consentVersion', 'enabled', 'features', 'historyRetentionDays', 'preset', 'snoozeUntil', 'v']);

    const origin = server.origins[0]!;
    const comPage = await ext.context.newPage();
    await comPage.goto(standUrl(origin, 'www.example.com', '/protect/password-tripwire.html'));
    await fixtureResult(comPage);
    await expect.poll(() => tripwire(comPage), { message: 'module files run on example.com' }).toMatchObject({ isolated: { selfCheck: 1 }, main: { selfCheck: 1 } });
    const comTab = await tabIdOf(sw, comPage.url());
    expect(await helloFrom(sw, comTab)).toMatchObject({ type: 'protect-ack', active: true });

    // Exclude example.com: excludeMatches on both registrations; the open document is answered inactive.
    const excluded = await protectRoute(sw, { type: 'ui-protect-set-site', host: 'www.example.com', excluded: true });
    expect(excluded.state?.excludedSites, brief(excluded)).toEqual(['example.com']);
    for (const script of await registeredScripts(sw, [...PROTECT_SCRIPT_IDS])) {
      expect(script.excludeMatches, script.id).toEqual(['*://*.example.com/*', '*://example.com/*']);
    }
    for (const script of await registeredScripts(sw, [...OBSERVATION_SCRIPT_IDS])) expect(script.excludeMatches, script.id + ' (observation untouched)').toEqual([]);
    expect(await helloFrom(sw, comTab)).toEqual({ schemaVersion: 1, type: 'protect-ack', active: false, groups: 0 });
    const comAgain = await ext.context.newPage();
    await comAgain.goto(standUrl(origin, 'shop.example.com', '/protect/password-tripwire.html'));
    await fixtureResult(comAgain);
    await comAgain.waitForTimeout(300);
    expect(await tripwire(comAgain), 'an excluded site gets no module file').toEqual({ isolated: null, main: null });
    const orgPage = await ext.context.newPage();
    await orgPage.goto(standUrl(origin, 'www.example.org', '/protect/password-tripwire.html'));
    await fixtureResult(orgPage);
    await expect.poll(() => tripwire(orgPage), { message: 'another site still gets the module' }).toMatchObject({ isolated: { selfCheck: 1 }, main: { selfCheck: 1 } });
    expect(await helloFrom(sw, await tabIdOf(sw, orgPage.url()))).toMatchObject({ type: 'protect-ack', active: true });
    const included = await protectRoute(sw, { type: 'ui-protect-set-site', host: 'example.com', excluded: false });
    expect(included.state?.excludedSites).toEqual([]);
    for (const script of await registeredScripts(sw, [...PROTECT_SCRIPT_IDS])) expect(script.excludeMatches, script.id).toEqual([]);

    // Revoke the broad grant -> needs-permission, none of our registrations or listeners; settings and data stay.
    expect(await revokeAllSites(sw)).toBe(true);
    await expect.poll(async () => (await protectState(sw)).state).toBe('needs-permission');
    await expect.poll(async () => (await registeredIds(sw)).filter((id) => id.startsWith('detector-protect'))).toEqual([]);
    expect(await protectListeners(sw)).toMatchObject({ beforeRequestTabs: [], sendHeaders: false, completed: false });
    expect(await databases(sw)).toContain(PROTECT_DB);
    expect(Object.keys(await sw.evaluate(() => chrome.storage.local.get(null)))).toContain('protect');
    await grantAllSites(ext, sw);
    await expect.poll(async () => (await protectState(sw)).state).toBe('active');
    await expect.poll(async () => (await registeredIds(sw)).filter((id) => id.startsWith('detector-protect'))).toEqual([...PROTECT_SCRIPT_IDS]);

    // Snooze: never longer than one hour; 0 ends it.
    const t0 = await sw.evaluate(() => Date.now());
    const snoozed = await protectRoute(sw, { type: 'ui-protect-snooze', minutes: 60 });
    const t1 = await sw.evaluate(() => Date.now());
    const until = snoozed.state?.snoozedUntil;
    expect(typeof until, brief(snoozed)).toBe('number');
    expect(until!).toBeGreaterThan(t0);
    expect(until!).toBeLessThanOrEqual(t1 + PROTECT_BUDGETS.snoozeMs);
    expect((await protectRoute(sw, { type: 'ui-protect-snooze', minutes: 0 })).state?.snoozedUntil).toBeNull();

    // «Выключить» in Options with purge (ticked by default): IndexedDB, protect-* session keys and the settings key are
    // gone; observation stays.
    const off = (await disableProtectViaOptions(ext.context, sw, true)) as ProtectStateResponse;
    expect(off.state?.state, brief(off)).toBe('off');
    await expect.poll(() => databases(sw)).not.toContain(PROTECT_DB);
    expect(Object.keys(await sw.evaluate(() => chrome.storage.session.get(null))).filter((k) => k.startsWith('protect'))).toEqual([]);
    expect(Object.keys(await sw.evaluate(() => chrome.storage.local.get(null)))).not.toContain('protect');
    expect(await registeredIds(sw)).toEqual([...OBSERVATION_SCRIPT_IDS]);
  } finally {
    await ext.close();
    await server.close();
  }
});

test('review r2: a site exclusion covers cross-site frames of a tab loaded before the module was enabled', async () => {
  test.setTimeout(120_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const top = server.origins[0]!;
    // Both top documents load before the module is on: the module's tab model never sees them commit.
    const excludedTab = await ext.context.newPage();
    await excludedTab.goto(standUrl(top, 'www.example.com', '/protect/index.html'));
    const allowedTab = await ext.context.newPage();
    await allowedTab.goto(standUrl(top, 'www.example.org', '/protect/index.html'));
    const on = await enableProtect(sw, ['value-match', 'session-replay']);
    expect(on.state?.state, brief(on)).toBe('active');
    const excluded = await protectRoute(sw, { type: 'ui-protect-set-site', host: 'example.com', excluded: true });
    expect(excluded.state?.excludedSites, brief(excluded)).toEqual(['example.com']);
    // The same third-party frame (example.net, not excluded: excludeMatches does not cover it) in both tabs.
    const frameUrl = standUrl(server.origins[1]!, 'www.example.net', '/protect/password-tripwire.html?frameHost=www.example.net');

    // Positive control: the tab of a site that is not excluded. The module starts in the frame and reads the e-mail
    // the user types (so the tripwire counts module reads, and frames of tabs loaded before enable keep the module).
    const allowedFrame = await addProbeFrame(allowedTab, frameUrl);
    await expect.poll(() => tripwire(allowedFrame).then((t) => t.isolated?.selfCheck ?? 0), { message: 'module files run in the frame' }).toBe(1);
    await typeInto(allowedTab, allowedTab.frameLocator('#probe-frame').locator('#email'), 'r2-allowed@example.org');
    await allowedTab.frameLocator('#probe-frame').locator('#title').click();
    await expect.poll(() => tripwire(allowedFrame).then((t) => t.isolated?.nonPasswordReads ?? 0), { message: 'the module reads the e-mail in an allowed tab' }).toBeGreaterThan(0);
    expect(await helloFromFrame(sw, await tabIdOf(sw, allowedTab.url()), frameUrl)).toMatchObject({ type: 'protect-ack', active: true });

    // The excluded site's tab: the module file runs in the frame, but the SW answers inactive and nothing is read.
    const excludedFrame = await addProbeFrame(excludedTab, frameUrl);
    await expect.poll(() => tripwire(excludedFrame).then((t) => t.isolated?.selfCheck ?? 0), { message: 'module files run in the frame' }).toBe(1);
    await typeInto(excludedTab, excludedTab.frameLocator('#probe-frame').locator('#email'), 'r2-excluded@example.org');
    await excludedTab.frameLocator('#probe-frame').locator('#title').click();
    await excludedTab.waitForTimeout(1500);
    expect(await helloFromFrame(sw, await tabIdOf(sw, excludedTab.url()), frameUrl)).toEqual({ schemaVersion: 1, type: 'protect-ack', active: false, groups: 0 });
    expect((await tripwire(excludedFrame)).isolated, 'no module read in a frame of an excluded site tab').toMatchObject({ hits: 0, selfCheck: 1, nonPasswordReads: 0 });

    // Review W1: the module's MAIN wrappers (test profile: candidate hooks) stay in the allowed tab's frame and are
    // restored in the excluded tab's frame — its first protect-hello was answered inactive, so the ISOLATED part sent
    // protect-relay-stop to the frame's MAIN boot.
    const mainNative = (f: Frame): Promise<boolean[]> => f.evaluate(() => [EventTarget.prototype.addEventListener, MutationObserver.prototype.observe].map((fn) => Function.prototype.toString.call(fn).includes('[native code]')));
    expect(await mainNative(allowedFrame), 'positive control: wrappers installed in a frame of an allowed tab').toEqual([false, false]);
    await expect.poll(() => mainNative(excludedFrame), { message: 'wrappers restored in a frame of an excluded site tab' }).toEqual([true, true]);
  } finally {
    await ext.close();
    await server.close();
  }
});
