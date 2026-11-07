import { describe, expect, it } from 'vitest';
import { ALL_SITES_PATTERNS, FULL_ACCESS_DEFAULT_KEY, ScopeController } from '../src/index';
import { createFakeChrome } from './fake-chrome';

const clock = { now: () => 1000 };
const required = () => createFakeChrome({ hostPermissions: [...ALL_SITES_PATTERNS], grantedOrigins: [...ALL_SITES_PATTERNS] });
describe('ADR-018 production full-scope default', () => {
  it('deduplicates static HTTP/WS hosts without merging their protocol permissions', async () => {
    const origins = ['http://127.0.0.1/*', 'ws://127.0.0.1/*'];
    const fake = createFakeChrome({ hostPermissions: origins, grantedOrigins: origins });
    const scope = new ScopeController(fake, clock, true);
    await scope.startup();
    expect(scope.getState()).toEqual({ scopeMode: 'site', hosts: ['127.0.0.1'], grantedAllSites: false, managed: false });
    expect(scope.isHostGrantedSync('127.0.0.1', 'http')).toBe(true);
    expect(scope.isHostGrantedSync('127.0.0.1', 'ws')).toBe(true);
    expect(scope.isHostGrantedSync('127.0.0.1', 'https')).toBe(false);
    fake.grantedOrigins.delete('ws://127.0.0.1/*');
    await scope.onPermissionsChanged();
    expect(scope.getState().hosts).toEqual(['127.0.0.1']);
    expect(scope.isHostGrantedSync('127.0.0.1', 'http')).toBe(true);
    expect(scope.isHostGrantedSync('127.0.0.1', 'ws')).toBe(false);
  });

  it('fresh required permissions start both document-start worlds automatically', async () => {
    const fake = required();
    const scope = new ScopeController(fake, clock);
    await scope.startup();
    expect(scope.getState()).toMatchObject({ scopeMode: 'all-sites', grantedAllSites: true });
    expect(fake.local.data.get(FULL_ACCESS_DEFAULT_KEY)).toBe(true);
    expect([...fake.registered.values()].map(script => [script.world, script.runAt, script.matches])).toEqual([
      ['ISOLATED', 'document_start', [...ALL_SITES_PATTERNS]], ['MAIN', 'document_start', [...ALL_SITES_PATTERNS]],
    ]);
  });

  it('migrates every legacy mode once, then respects a subsequent explicit off across restart', async () => {
    for (const scopeMode of ['off', 'site', 'active-tab', 'all-sites']) {
      const fake = required();
      fake.local.data.set('scope', { v: 1, scopeMode, hosts: ['example.com'] });
      const scope = new ScopeController(fake, clock);
      await scope.startup();
      expect(scope.getScopeMode()).toBe('all-sites');
      await scope.setScope({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'off' });
      const restarted = new ScopeController(fake, clock);
      await restarted.startup();
      expect(restarted.getScopeMode()).toBe('off');
      expect(fake.registered.size).toBe(0);
    }
  });

  it('never infers required permissions from optional grants or a single granted scheme', async () => {
    for (const fake of [createFakeChrome({ grantedOrigins: [...ALL_SITES_PATTERNS] }),
      createFakeChrome({ hostPermissions: [...ALL_SITES_PATTERNS], grantedOrigins: ['https://*/*'] })]) {
      const scope = new ScopeController(fake, clock);
      await scope.startup();
      expect(scope.getScopeMode()).toBe('off');
      expect(fake.registered.size).toBe(0);
      expect(fake.local.data.has(FULL_ACCESS_DEFAULT_KEY)).toBe(false);
    }
  });

  it('applies a withheld initial default after browser grants become available', async () => {
    const fake = createFakeChrome({ hostPermissions: [...ALL_SITES_PATTERNS] });
    const scope = new ScopeController(fake, clock);
    await scope.startup();
    expect(scope.getScopeMode()).toBe('off');
    for (const origin of ALL_SITES_PATTERNS) fake.grantedOrigins.add(origin);
    await scope.onPermissionsChanged();
    expect(scope.getScopeMode()).toBe('all-sites');
    expect(fake.registered.size).toBe(2);
  });

  it('an explicit choice made before withheld grants return prevents default migration', async () => {
    const fake = createFakeChrome({ hostPermissions: [...ALL_SITES_PATTERNS] });
    const scope = new ScopeController(fake, clock);
    await scope.startup();
    await scope.setScope({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'off' });
    for (const origin of ALL_SITES_PATTERNS) fake.grantedOrigins.add(origin);
    await scope.onPermissionsChanged();
    expect(scope.getScopeMode()).toBe('off');
  });

  it('failed migration persistence does not activate observation with an unrecorded default', async () => {
    const fake = required();
    fake.local.failNextSets = 1;
    const scope = new ScopeController(fake, clock);
    await expect(scope.startup()).rejects.toThrow();
    expect(scope.getScopeMode()).toBe('off');
    expect(fake.registered.size).toBe(0);
  });
});
