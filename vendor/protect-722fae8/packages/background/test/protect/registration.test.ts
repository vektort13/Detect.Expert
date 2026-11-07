import { describe, expect, it } from 'vitest';
import {
  PROTECT_ISOLATED_SCRIPT_ID,
  PROTECT_MAIN_SCRIPT_ID,
  ProtectRegistration,
  excludeMatchesFor,
  protectGroupMask,
  protectGroupsFor,
  protectMainFiles,
} from '../../src/protect/registration';
import { createFakeChrome } from '../fake-chrome';

const TRIPWIRE = { isolated: 'protect-tripwire.isolated.js', main: 'protect-tripwire.main.js' };

describe('MAIN files by groups and gpc (ADR-020 §10)', () => {
  it('groups: send ⇐ value-match|firewall, listen ⇐ session-replay|value-match; gate can drop a group', () => {
    expect(protectGroupsFor(['value-match'])).toEqual(['send', 'listen']);
    expect(protectGroupsFor(['firewall'])).toEqual(['send']);
    expect(protectGroupsFor(['session-replay'])).toEqual(['listen']);
    expect(protectGroupsFor(['history', 'gpc'])).toEqual([]);
    expect(protectGroupsFor(['value-match'], (g) => g !== 'listen')).toEqual(['send']);
    expect(protectGroupMask(['send', 'listen'])).toBe(3);
    expect(protectGroupMask(['listen'])).toBe(2);
  });

  it('file order: [tripwire] [gpc.main.js] protect-policy, protect-on.<g>, protect.main.js; prelude only with a group', () => {
    expect(protectMainFiles({ features: ['firewall', 'gpc'], groups: ['send'] })).toEqual(['gpc.main.js', 'protect-policy.js', 'protect-on.send.js', 'protect.main.js']);
    expect(protectMainFiles({ features: ['gpc'], groups: [] })).toEqual(['gpc.main.js']);
    expect(protectMainFiles({ features: ['history'], groups: [] })).toEqual([]);
    expect(protectMainFiles({ features: ['value-match'], groups: ['send', 'listen'], tripwire: TRIPWIRE })).toEqual(['protect-tripwire.main.js', 'protect-policy.js', 'protect-on.send.js', 'protect-on.listen.js', 'protect.main.js']);
  });

  it('excludeMatches: the site and its subdomains; an IPv4 literal exactly', () => {
    expect(excludeMatchesFor(['bank-site.com', '127.0.0.1', 'localhost'])).toEqual(['*://bank-site.com/*', '*://*.bank-site.com/*', '*://127.0.0.1/*', '*://localhost/*', '*://*.localhost/*']);
  });
});

describe('ProtectRegistration.reconcile', () => {
  it('registers our two ids with matches, allFrames, document_start, persistAcrossSessions, matchOriginAsFallback', async () => {
    const fake = createFakeChrome();
    const reg = new ProtectRegistration(fake);
    await reg.reconcile({ features: ['value-match', 'gpc'], excludedSites: ['bank-site.com'] });
    const iso = fake.registered.get(PROTECT_ISOLATED_SCRIPT_ID);
    const main = fake.registered.get(PROTECT_MAIN_SCRIPT_ID);
    expect(iso).toMatchObject({ js: ['protect.js'], world: 'ISOLATED', matches: ['http://*/*', 'https://*/*'], allFrames: true, runAt: 'document_start', persistAcrossSessions: true, matchOriginAsFallback: true, excludeMatches: ['*://bank-site.com/*', '*://*.bank-site.com/*'] });
    expect(main).toMatchObject({ js: ['gpc.main.js', 'protect-policy.js', 'protect-on.send.js', 'protect-on.listen.js', 'protect.main.js'], world: 'MAIN' });
  });

  it('updates in place, clears excludeMatches with [], removes the MAIN registration when nothing needs it', async () => {
    const fake = createFakeChrome();
    const reg = new ProtectRegistration(fake);
    await reg.reconcile({ features: ['value-match'], excludedSites: ['bank-site.com'] });
    await reg.reconcile({ features: ['value-match'], excludedSites: [] });
    expect(fake.registered.get(PROTECT_ISOLATED_SCRIPT_ID)?.excludeMatches).toEqual([]);
    await reg.reconcile({ features: ['history'], excludedSites: [] });
    expect([...fake.registered.keys()]).toEqual([PROTECT_ISOLATED_SCRIPT_ID]);
  });

  it('retries without matchOriginAsFallback when the browser rejects it (feature detection, once)', async () => {
    const fake = createFakeChrome();
    fake.rejectMatchOriginAsFallback = true;
    const reg = new ProtectRegistration(fake);
    await reg.reconcile({ features: ['value-match'], excludedSites: [] });
    expect(fake.registered.get(PROTECT_ISOLATED_SCRIPT_ID)?.matchOriginAsFallback).toBeUndefined();
    await reg.reconcile({ features: ['firewall'], excludedSites: [] });
    expect(fake.registered.get(PROTECT_MAIN_SCRIPT_ID)?.js).toEqual(['protect-policy.js', 'protect-on.send.js', 'protect.main.js']);
  });

  it('never touches detector-*-v1 of observation; unregisterAll removes only our ids', async () => {
    const fake = createFakeChrome();
    fake.registered.set('detector-isolated-v1', { id: 'detector-isolated-v1', js: ['bridge.js'], matches: ['https://*/*'] });
    fake.registered.set('detector-main-v1', { id: 'detector-main-v1', js: ['sensor-policy.js', 'hook.early.js'], matches: ['https://*/*'] });
    const reg = new ProtectRegistration(fake, { tripwireFiles: TRIPWIRE });
    await reg.reconcile({ features: ['session-replay'], excludedSites: [] });
    expect(fake.registered.get(PROTECT_ISOLATED_SCRIPT_ID)?.js).toEqual(['protect-tripwire.isolated.js', 'protect.js']);
    expect(fake.registered.get(PROTECT_MAIN_SCRIPT_ID)?.js?.[0]).toBe('protect-tripwire.main.js');
    expect(await reg.unregisterAll()).toBe(2);
    expect([...fake.registered.keys()]).toEqual(['detector-isolated-v1', 'detector-main-v1']);
    expect(fake.registered.get('detector-main-v1')?.js).toEqual(['sensor-policy.js', 'hook.early.js']);
  });

  it('test profile: the MAIN tripwire registers even without hook groups', async () => {
    const fake = createFakeChrome();
    const reg = new ProtectRegistration(fake, { tripwireFiles: TRIPWIRE });
    await reg.reconcile({ features: ['history'], excludedSites: [] });
    expect(fake.registered.get(PROTECT_MAIN_SCRIPT_ID)?.js).toEqual(['protect-tripwire.main.js']);
  });
});
