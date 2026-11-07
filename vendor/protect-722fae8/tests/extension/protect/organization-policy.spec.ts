// ADR-020 §3, §7 (S05, E21-05 case 3): the organization can only forbid the module «Защита» (managed
// ProtectModuleDisabled, fail closed); there is no policy that turns it on. The managed value is replaced through the
// test-profile harness (__protectHarness.setManaged): delivery of a real policy through the OS is a manual check.
//   policy on -> organization-disabled; an active module stops (registrations, listeners, open documents);
//   enable -> disabled-by-organization; settings and module data stay until purge; purge removes them;
//   policy off -> the module may be enabled again.

import { expect, test } from '@playwright/test';
import type { Worker } from '@playwright/test';
import type { SensorSettings } from '@detect-expert/contracts';
import { getServiceWorker, startFixtureServer } from '../harness';
import { brief, fixtureResult, openExtensionPage, tabIdOf } from '../helpers';
import {
  NO_LISTENERS,
  OBSERVATION_SCRIPT_IDS,
  PROTECT_DB,
  PROTECT_SCRIPT_IDS,
  databases,
  disableProtect,
  dumpProtectDb,
  enableProtect,
  grantAllSites,
  harness,
  launchProtect,
  protectListeners,
  protectRoute,
  protectState,
  registeredIds,
  standUrl,
  tripwire,
} from './support';

/** The observation side of the same managed items (ADR-019 test-profile harness; undefined restores the real area). */
async function setSensorManaged(sw: Worker, items: unknown): Promise<SensorSettings> {
  return sw.evaluate((value) => (globalThis as unknown as { __sensorPolicyHarness: { setManaged(v: unknown): Promise<SensorSettings> } })
    .__sensorPolicyHarness.setManaged(value), items);
}

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

test('organization policy ProtectModuleDisabled: forbids and stops the module, keeps data until purge', async () => {
  test.setTimeout(120_000);
  const server = await startFixtureServer();
  const ext = await launchProtect();
  try {
    const sw = await getServiceWorker(ext.context);
    await grantAllSites(ext, sw);
    const on = await enableProtect(sw, ['value-match', 'session-replay']);
    expect(on.state?.state, brief(on)).toBe('active');
    // Module data: an excluded site in IndexedDB.
    expect((await protectRoute(sw, { type: 'ui-protect-set-site', host: 'www.example.org', excluded: true })).state?.excludedSites).toEqual(['example.org']);
    const page = await ext.context.newPage();
    await page.goto(standUrl(server.origins[0]!, 'www.example.com', '/protect/password-tripwire.html'));
    await fixtureResult(page);
    await expect.poll(() => tripwire(page)).toMatchObject({ isolated: { selfCheck: 1 }, main: { selfCheck: 1 } });
    const tabId = await tabIdOf(sw, page.url());
    expect(await helloFrom(sw, tabId)).toMatchObject({ active: true });

    // Policy on: the module stops at once.
    const disabled = await harness<Record<string, unknown>>(sw, 'setManaged', { ProtectModuleDisabled: true });
    expect(disabled, brief(disabled)).toMatchObject({ state: 'organization-disabled', organizationDisabled: true });
    expect(await registeredIds(sw)).toEqual([...OBSERVATION_SCRIPT_IDS]);
    expect(await protectListeners(sw)).toEqual(NO_LISTENERS);
    expect(await helloFrom(sw, tabId)).toEqual({ schemaVersion: 1, type: 'protect-ack', active: false, groups: 0 });

    // The observation reader of the same managed area (ADR-019) skips the approved module policy: no rejected entry,
    // no sensor notice on the Options page (review round 1, FOLLOWUPS п. 73).
    const sensorSettings = await setSensorManaged(sw, { ProtectModuleDisabled: true });
    expect(sensorSettings, brief(sensorSettings)).toMatchObject({ organizationPolicy: 'absent', rejectedPolicyEntries: 0 });
    expect(sensorSettings.sensors.every((row) => row.enabled)).toBe(true);
    const options = await openExtensionPage(ext.context, sw, 'options.html');
    await expect(options.locator('#options-sensors-canvas')).toBeChecked();
    await expect(options.locator('[data-sensor-notice="options_sensors_policy_rejected"]')).toHaveCount(0);
    await expect(options.locator('[data-sensor-notice]')).toHaveCount(0);
    await options.close();

    // Enabling is refused; nothing is registered.
    const refused = await enableProtect(sw, ['value-match']);
    expect(refused, brief(refused)).toMatchObject({ type: 'error', code: 'disabled-by-organization' });
    expect(await registeredIds(sw)).toEqual([...OBSERVATION_SCRIPT_IDS]);
    expect((await protectState(sw)).state).toBe('organization-disabled');

    // Data stays until purge.
    expect(await databases(sw)).toContain(PROTECT_DB);
    expect((await dumpProtectDb(sw))['exclusions']).toEqual([{ site: 'example.org' }]);
    expect(Object.keys(await sw.evaluate(() => chrome.storage.local.get(null)))).toContain('protect');

    // Purge (allowed while forbidden): everything of the module goes.
    const purged = await disableProtect(sw, true);
    expect(purged.state?.state, brief(purged)).toBe('organization-disabled');
    await expect.poll(() => databases(sw)).not.toContain(PROTECT_DB);
    expect(Object.keys(await sw.evaluate(() => chrome.storage.local.get(null)))).not.toContain('protect');
    expect(Object.keys(await sw.evaluate(() => chrome.storage.session.get(null))).filter((k) => k.startsWith('protect'))).toEqual([]);

    // Policy off: the module is off (not re-enabled by itself) and may be enabled again by the user.
    const cleared = await harness<Record<string, unknown>>(sw, 'setManaged', undefined);
    expect(cleared).toMatchObject({ state: 'off', organizationDisabled: false });
    expect(await setSensorManaged(sw, undefined)).toMatchObject({ organizationPolicy: 'absent', rejectedPolicyEntries: 0 });
    expect(await registeredIds(sw)).toEqual([...OBSERVATION_SCRIPT_IDS]);
    const again = await enableProtect(sw, ['value-match']);
    expect(again.state?.state, brief(again)).toBe('active');
    expect(await registeredIds(sw)).toEqual([...OBSERVATION_SCRIPT_IDS, ...PROTECT_SCRIPT_IDS].sort());
    expect((await disableProtect(sw, true)).state?.state).toBe('off');
  } finally {
    await ext.close();
    await server.close();
  }
});
