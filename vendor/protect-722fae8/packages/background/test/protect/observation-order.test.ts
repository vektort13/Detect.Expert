// Review W3 (ADR-020 §13): the module's MAIN registration (detector-protect-main-v1) runs after observation's
// detector-main-v1 in new documents (SP-7: MAIN scripts run in registration order). Observation's bootstrap refuses a
// non-native window.addEventListener, which the module's listen hook replaces in the test profiles. When observation
// registers afresh while the module is active (scope chosen after enabling the module, SW start), the module
// registers its MAIN script again, after it. With the module off nothing of the module is touched.

import { describe, expect, it } from 'vitest';
import { BackgroundRuntime } from '../../src/index';
import { PROTECT_ISOLATED_SCRIPT_ID, PROTECT_MAIN_SCRIPT_ID, ProtectRegistration } from '../../src/protect/registration';
import { createFakeChrome } from '../fake-chrome';
import { MemoryProtectDb } from './memory-db';
import { ALL_SITES, ENABLED_SETTINGS } from './support';

const OBS_MAIN = 'detector-main-v1';
const OBS_ISOLATED = 'detector-isolated-v1';

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('timed out waiting for ' + what);
}

describe('review W3: MAIN registration order (observation first)', () => {
  it('reregisterMain puts our MAIN registration after one registered later; nothing without our MAIN registration', async () => {
    const fake = createFakeChrome();
    const reg = new ProtectRegistration(fake);
    const desired = { features: ['value-match'] as const, excludedSites: ['bank-site.com'] };
    expect(await reg.reregisterMain({ ...desired, features: [...desired.features] })).toBe(false);
    await reg.reconcile({ ...desired, features: [...desired.features] });
    await fake.scripting.registerContentScripts([{ id: OBS_MAIN, js: ['hook.main.js'], matches: ['<all_urls>'], world: 'MAIN' }]);
    expect([...fake.registered.keys()]).toEqual([PROTECT_ISOLATED_SCRIPT_ID, PROTECT_MAIN_SCRIPT_ID, OBS_MAIN]);
    const before = fake.registered.get(PROTECT_MAIN_SCRIPT_ID);
    expect(await reg.reregisterMain({ ...desired, features: [...desired.features] })).toBe(true);
    expect([...fake.registered.keys()]).toEqual([PROTECT_ISOLATED_SCRIPT_ID, OBS_MAIN, PROTECT_MAIN_SCRIPT_ID]);
    expect(fake.registered.get(PROTECT_MAIN_SCRIPT_ID)).toEqual(before);
  });

  it('module active, observation scope chosen afterwards: our MAIN registration ends after detector-main-v1', async () => {
    const fake = createFakeChrome({ grantedOrigins: ALL_SITES });
    fake.local.data.set('protect', { ...ENABLED_SETTINGS, features: ['value-match', 'session-replay'] });
    const runtime = new BackgroundRuntime(fake, { ttlIntervalMs: 0, protect: { dbFactory: () => new MemoryProtectDb() } });
    try {
      await runtime.start();
      await until(() => runtime.protect.isActive, 'module active');
      await runtime.protect.idle();
      expect([...fake.registered.keys()]).toEqual([PROTECT_ISOLATED_SCRIPT_ID, PROTECT_MAIN_SCRIPT_ID]);
      // Observation scope picked after the module was enabled: detector-*-v1 are registered after ours.
      expect(await runtime.scope.setScope({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' })).toMatchObject({ ok: true, scope: { scopeMode: 'all-sites' } });
      await until(() => [...fake.registered.keys()].at(-1) === PROTECT_MAIN_SCRIPT_ID, 'our MAIN registration after observation');
      await runtime.protect.idle();
      const order = [...fake.registered.keys()];
      expect(order.indexOf(OBS_MAIN)).toBeLessThan(order.indexOf(PROTECT_MAIN_SCRIPT_ID));
      expect(order).toContain(OBS_ISOLATED);
      expect(runtime.protect.diagnostics()['mainReordered']).toBeGreaterThanOrEqual(1);
      // Observation unregisters and registers again (scope off, then all sites): the module follows once more.
      await runtime.scope.setScope({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'off' });
      await runtime.scope.setScope({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' });
      await until(() => [...fake.registered.keys()].at(-1) === PROTECT_MAIN_SCRIPT_ID, 'our MAIN registration after observation again');
      await runtime.protect.idle();
      expect(runtime.protect.diagnostics()['mainReordered']).toBeGreaterThanOrEqual(2);
    } finally {
      runtime.stop();
    }
  });

  it('module off: observation registers as before and nothing of the module is registered or touched', async () => {
    const fake = createFakeChrome({ grantedOrigins: ALL_SITES });
    const runtime = new BackgroundRuntime(fake, { ttlIntervalMs: 0, protect: { dbFactory: () => new MemoryProtectDb() } });
    try {
      await runtime.start();
      await runtime.protect.idle();
      await runtime.scope.setScope({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' });
      await runtime.protect.idle();
      expect([...fake.registered.keys()].sort()).toEqual([OBS_ISOLATED, OBS_MAIN]);
      expect(runtime.protect.diagnostics()['mainReordered']).toBe(0);
    } finally {
      runtime.stop();
    }
  });
});
