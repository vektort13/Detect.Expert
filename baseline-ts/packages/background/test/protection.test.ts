import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROTECTION_SETTINGS, PROTECTION_FEATURES, PROTECTION_SETTINGS_KEY, PROTECTION_PENDING_KEY } from '@detect-expert/contracts';
import { buildProtectionScripts, PROTECTION_SCRIPT_PREFIX } from '../src/protection-plan';
import { ProtectionController } from '../src/protection';
import { ScopeController } from '../src/scope';
import { createFakeChrome, RUNTIME_ID } from './fake-chrome';

describe('ADR-035 packaged protection registrations', () => {
  it('does not register any protection while disabled or outside persistent observation scope', () => {
    expect(buildProtectionScripts(DEFAULT_PROTECTION_SETTINGS, ['https://*/*'])).toEqual([]);
    expect(buildProtectionScripts({ ...DEFAULT_PROTECTION_SETTINGS, enabled: true }, [])).toEqual([]);
    expect(buildProtectionScripts({ ...DEFAULT_PROTECTION_SETTINGS, enabled: true }, ['ws://*/*', 'chrome://*/*'])).toEqual([]);
  });

  it('uses fixed packaged files and already authorized document-start matches without userScripts', () => {
    const scripts = buildProtectionScripts({ ...DEFAULT_PROTECTION_SETTINGS, enabled: true }, ['https://allowed.example/*']);
    expect(scripts.length).toBe(4);
    expect(scripts.length).toBeLessThanOrEqual(PROTECTION_FEATURES.length);
    for (const script of scripts) {
      expect(script.id).toMatch(/^detector-protection-v1-/);
      expect(script.js).toHaveLength(1);
      expect(script.js?.[0]).toMatch(/^protection\.[a-z-]+\.js$/);
      expect(script.matches).toEqual(['https://allowed.example/*']);
      expect(script).toMatchObject({ world: 'MAIN', runAt: 'document_start', allFrames: true, persistAcrossSessions: true });
      expect(script.matchOriginAsFallback).toBe(false);
      expect(script).not.toHaveProperty('code');
    }
  });

  it('excludes exact-host allow rules from a globally blocked feature', () => {
    const scripts = buildProtectionScripts({ ...DEFAULT_PROTECTION_SETTINGS, enabled: true, sites: [
      { host: 'example.com', disabled: false, rules: [{ feature: 'window-management', state: 'allow' }] },
    ] }, ['http://*/*', 'https://*/*']);
    const window = scripts.find(script => script.id === PROTECTION_SCRIPT_PREFIX + 'window-management');
    expect(window?.excludeMatches).toEqual(['http://example.com/*', 'https://example.com/*']);
    expect(scripts.find(script => script.id.endsWith('compute-pressure'))?.excludeMatches).toEqual([]);
  });

  it('intersects per-site blocks with granted schemes and hosts, never broadening permissions', () => {
    const settings = { ...DEFAULT_PROTECTION_SETTINGS, enabled: true, sites: [
      { host: 'allowed.example', disabled: false, rules: [{ feature: 'canvas-readback', state: 'block' }] },
      { host: 'ungranted.example', disabled: false, rules: [{ feature: 'canvas-readback', state: 'block' }] },
    ] } as const;
    const scripts = buildProtectionScripts(settings, ['https://allowed.example/*']);
    expect(scripts.find(script => script.id.endsWith('canvas-readback'))?.matches).toEqual(['https://allowed.example/*']);
    expect(JSON.stringify(scripts)).not.toContain('ungranted.example');
  });

  it('applies site exemptions to every globally blocked feature with bounded stable output', () => {
    const settings = { ...DEFAULT_PROTECTION_SETTINGS, enabled: true, sites: [
      { host: 'example.com', disabled: true, rules: [] },
    ] };
    const scripts = buildProtectionScripts(settings, ['https://*/*', 'https://*/*']);
    expect(new Set(scripts.map(script => script.id)).size).toBe(scripts.length);
    for (const script of scripts) {
      expect(script.matches).toEqual(['https://*/*']);
      expect(script.excludeMatches).toContain('https://example.com/*');
    }
    expect(buildProtectionScripts(settings, ['https://*/*'])).toEqual(scripts);
  });
});

describe('ADR-035 persisted and privileged protection controller', () => {
  async function setup() {
    const api = createFakeChrome({ grantedOrigins: ['http://*/*', 'https://*/*'] });
    const scope = new ScopeController(api, { now: () => 0 });
    await scope.startup();
    await scope.setScope({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' });
    const controller = new ProtectionController(api, scope);
    await controller.start();
    return { api, scope, controller };
  }

  it('keeps the existing observer registrations and persists only a validated explicit policy', async () => {
    const { api, controller } = await setup();
    expect([...api.registered.keys()]).toHaveLength(2);
    expect((await controller.get(null)).settings.enabled).toBe(false);
    const response = await controller.set({ ...DEFAULT_PROTECTION_SETTINGS, enabled: true }, null);
    expect(response).toMatchObject({ type: 'protection-state', registration: 'ready', settings: { enabled: true, revision: 1 } });
    expect([...api.registered.keys()]).toHaveLength(6);
    expect(api.local.data.get(PROTECTION_SETTINGS_KEY)).toMatchObject({ enabled: true, revision: 1 });
    expect(api.session.data.has(PROTECTION_SETTINGS_KEY)).toBe(false);
  });

  it('rejects stale changes and leaves existing settings intact after storage failure', async () => {
    const { api, controller } = await setup();
    await controller.set({ ...DEFAULT_PROTECTION_SETTINGS, enabled: true }, null);
    expect(await controller.set(DEFAULT_PROTECTION_SETTINGS, null)).toMatchObject({ code: 'stale-revision' });
    api.local.failNextSets = 1;
    expect(await controller.set({ ...DEFAULT_PROTECTION_SETTINGS, revision: 1 }, null)).toMatchObject({ code: 'storage-error' });
    expect((await controller.get(null)).settings.enabled).toBe(true);
    expect([...api.registered.keys()]).toHaveLength(6);
  });

  it('restores settings after SW restart and removes protection registrations on disable', async () => {
    const { api, scope, controller } = await setup();
    await controller.set({ ...DEFAULT_PROTECTION_SETTINGS, enabled: true }, null);
    const restarted = new ProtectionController(api, scope);
    await restarted.start();
    expect((await restarted.get(null)).registration).toBe('ready');
    await restarted.set({ ...DEFAULT_PROTECTION_SETTINGS, revision: 1 }, null);
    expect([...api.registered.keys()]).toHaveLength(2);
    expect((await restarted.get(null)).registration).toBe('inactive');
  });

  it('reconciles revoked scope and never uses stale persistent registrations', async () => {
    const { api, scope, controller } = await setup();
    await controller.set({ ...DEFAULT_PROTECTION_SETTINGS, enabled: true }, null);
    api.grantedOrigins.clear();
    await scope.onPermissionsChanged();
    await controller.accessChanged();
    expect(api.registered.size).toBe(0);
    expect((await controller.get(null)).registration).toBe('inactive');
  });

  it('reports registration failure and removes partial protection without removing sensors', async () => {
    const { api, controller } = await setup();
    const register = api.scripting.registerContentScripts;
    api.scripting.registerContentScripts = vi.fn(async scripts => {
      await register(scripts.slice(0, 1));
      throw new Error('browser failure');
    });
    expect(await controller.set({ ...DEFAULT_PROTECTION_SETTINGS, enabled: true }, null)).toMatchObject({ registration: 'error' });
    expect([...api.registered.keys()]).toHaveLength(2);
  });

  it('does not authorize content or foreign extension senders to modify policy', async () => {
    const { api, controller } = await setup();
    const message = { schemaVersion: 1, type: 'ui-protection-set', tabId: null, settings: { ...DEFAULT_PROTECTION_SETTINGS, enabled: true } };
    for (const sender of [{ id: RUNTIME_ID, tab: { id: 1 }, frameId: 0, documentId: 'doc', origin: 'https://example.com', url: 'https://example.com/' },
      { id: 'other', origin: 'chrome-extension://other', url: 'chrome-extension://other/popup.html' }, {}]) {
      expect(await controller.route(message, sender, async () => undefined)).toMatchObject({ code: 'unauthorized-sender' });
    }
    expect(api.local.data.has(PROTECTION_SETTINGS_KEY)).toBe(false);
    expect(await controller.route(message, { id: RUNTIME_ID, origin: 'chrome-extension://' + RUNTIME_ID,
      url: 'chrome-extension://' + RUNTIME_ID + '/popup.html' }, async () => undefined)).toMatchObject({ settings: { enabled: true } });
  });

  it('fails closed on corrupt storage and clears prior registered protection on restart', async () => {
    const { api, scope, controller } = await setup();
    await controller.set({ ...DEFAULT_PROTECTION_SETTINGS, enabled: true }, null);
    api.local.data.set(PROTECTION_SETTINGS_KEY, { enabled: true });
    const restarted = new ProtectionController(api, scope);
    await restarted.start();
    expect(await restarted.get(null)).toMatchObject({ registration: 'error', settings: { enabled: false } });
    expect([...api.registered.keys()]).toHaveLength(2);
  });

  it('finishes interrupted application on restart and stops live stale denials even with valid disabled settings', async () => {
    const { api, scope, controller } = await setup();
    await controller.set({ ...DEFAULT_PROTECTION_SETTINGS, enabled: true }, null);
    api.tabList = [{ id: 7 }];
    api.local.data.set(PROTECTION_SETTINGS_KEY, { ...DEFAULT_PROTECTION_SETTINGS, revision: 2 });
    api.local.data.set(PROTECTION_PENDING_KEY, true);
    const restarted = new ProtectionController(api, scope);
    await restarted.start();
    expect([...api.registered.keys()]).toHaveLength(2);
    expect(api.sentToTabs).toContainEqual({ tabId: 7, message: { schemaVersion: 1, type: 'protection-stop' }, options: undefined });
    expect(api.local.data.get(PROTECTION_PENDING_KEY)).toBe(false);
    expect((await restarted.get(null)).settings.enabled).toBe(false);
  });

  it('stops stale denials on disabled startup even without an interruption marker', async () => {
    const { api, scope } = await setup();
    api.tabList = [{ id: 7 }];
    await new ProtectionController(api, scope).start();
    expect(api.sentToTabs.some(entry => entry.tabId === 7 && (entry.message as { type: string }).type === 'protection-stop')).toBe(true);
  });

  it('suspends protection independently of broken scope preference persistence', async () => {
    const { api, scope, controller } = await setup();
    await controller.set({ ...DEFAULT_PROTECTION_SETTINGS, enabled: true }, null);
    api.tabList = [{ id: 7 }];
    api.grantedOrigins.clear();
    api.local.failNextSets = 1;
    await expect(scope.onPermissionsChanged()).rejects.toThrow();
    await controller.suspendAccess();
    expect([...api.registered.keys()].some(key => key.startsWith(PROTECTION_SCRIPT_PREFIX))).toBe(false);
    expect(api.sentToTabs.some(entry => entry.tabId === 7)).toBe(true);
    expect((await controller.get(null)).registration).toBe('error');
  });

  it('discards delayed observations when permissions change during a query', async () => {
    const { api, scope, controller } = await setup();
    await controller.set({ ...DEFAULT_PROTECTION_SETTINGS, enabled: true }, null);
    api.framesByTab.set(7, [{ frameId: 0, documentId: 'doc7', url: 'https://example.com/' }]);
    let deliver: (value: unknown) => void = () => undefined;
    api.tabs.sendMessage = vi.fn(() => new Promise(resolve => { deliver = resolve; }));
    const read = controller.get(7);
    await vi.waitFor(() => expect(api.tabs.sendMessage).toHaveBeenCalledTimes(1));
    api.grantedOrigins.clear();
    await scope.onPermissionsChanged();
    deliver([{ feature: 'window-management', installed: 1, unavailable: 0, removed: 0, blocked: 10, stopped: false }]);
    expect(await read).toMatchObject({ configured: [], observations: [], liveRead: 'unavailable' });
  });

  it('detects stale browser registration fields even when the expected IDs exist', async () => {
    const { api, controller } = await setup();
    await controller.set({ ...DEFAULT_PROTECTION_SETTINGS, enabled: true }, null);
    api.scripting.updateContentScripts = vi.fn(async () => undefined);
    const result = await controller.set({ ...DEFAULT_PROTECTION_SETTINGS, enabled: true, revision: 1, sites: [
      { host: 'example.com', disabled: true, rules: [] },
    ] }, null);
    expect(result).toMatchObject({ registration: 'error' });
    expect([...api.registered.keys()]).toHaveLength(2);
  });
});