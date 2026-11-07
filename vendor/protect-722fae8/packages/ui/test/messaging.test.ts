import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { validateUiRequest } from '@detect-expert/contracts';
import { UI_CLEAR_SESSION_REQUEST, errorMessageKey, isUiResponse, readGrantedAccess, readTabIdOverride, removeOrigins, removeSiteRequest } from '../src/messaging';

describe('messaging helpers', () => {
  it('parses the test-only tabId override from the page query string', () => {
    expect(readTabIdOverride('?tabId=42')).toBe(42);
    expect(readTabIdOverride('?x=1&tabId=7&y=2')).toBe(7);
    expect(readTabIdOverride('')).toBeNull();
    expect(readTabIdOverride('?tabId=')).toBeNull();
    expect(readTabIdOverride('?tabId=abc')).toBeNull();
    expect(readTabIdOverride('?tabId=-1')).toBeNull();
    expect(readTabIdOverride('?tabId=99999999999')).toBeNull();
    expect(readTabIdOverride('?xtabId=5')).toBeNull();
  });

  it('accepts only schemaVersion 1 responses with a string type', () => {
    expect(isUiResponse({ schemaVersion: 1, type: 'report', report: null })).toBe(true);
    expect(isUiResponse({ schemaVersion: 2, type: 'report' })).toBe(false);
    expect(isUiResponse({ type: 'report' })).toBe(false);
    expect(isUiResponse(null)).toBe(false);
    expect(isUiResponse('report')).toBe(false);
  });

  it('maps error codes to locale keys and freezes the proposed clear-session request', () => {
    expect(errorMessageKey('stale-revision')).toBe('error_stale_revision');
    expect(errorMessageKey('unavailable')).toBe('error_unavailable');
    expect(Object.isFrozen(UI_CLEAR_SESSION_REQUEST)).toBe(true);
    expect(UI_CLEAR_SESSION_REQUEST).toEqual({ schemaVersion: 1, type: 'ui-clear-session' });
  });
});

// F141: exercise the compiled branch, not merely the query parser.
it('enables query overrides only with a compile-time test profile', async () => {
  for (const profile of ['local', 'test', 'test-optional', null]) {
    const output = await build({
      stdin: { contents: "import { queryActiveTab } from './packages/ui/src/messaging'; globalThis.result = queryActiveTab();", resolveDir: process.cwd() },
      bundle: true, write: false, format: 'iife',
      define: profile === null ? {} : { __BUILD_PROFILE__: JSON.stringify(profile) },
    });
    const code = output.outputFiles[0]!.text;
    const context = { location: { search: '?tabId=42' }, chrome: { tabs: {
      query: async () => [{ id: 7 }], get: async (id: number) => ({ id }),
    } }, result: null as unknown };
    runInNewContext(code, context);
    expect(await context.result).toEqual({ id: profile === 'test' || profile === 'test-optional' ? 42 : 7, url: undefined });
    if (profile === 'local') expect(code).not.toContain('function readTabIdOverride');
    if (profile === 'test') expect(code).toContain('function readTabIdOverride');
  }
});

// S12 / E13-03: granted access, permissions.remove and the ui-remove-site payload (extension page context).
describe('site access helpers (S12)', () => {
  function withChrome(value: unknown, run: () => Promise<void>): Promise<void> {
    const g = globalThis as { chrome?: unknown };
    const before = g.chrome;
    g.chrome = value;
    return run().finally(() => { g.chrome = before; });
  }

  it('readGrantedAccess: strings only, deduplicated, bounded; null when the API throws', async () => {
    const many = Array.from({ length: 600 }, (_, i) => 'https://h' + i + '.example/*');
    await withChrome({
      permissions: { getAll: async () => ({ origins: ['https://example.com/*', 'https://example.com/*', 7, null, 'x'.repeat(600), ...many] }) },
      runtime: { getManifest: () => ({ host_permissions: ['http://127.0.0.1/*', 5] }) },
    }, async () => {
      const access = await readGrantedAccess();
      expect(access?.required).toEqual(['http://127.0.0.1/*']);
      expect(access?.origins[0]).toBe('https://example.com/*');
      expect(access?.origins).toHaveLength(512);
      expect(access?.origins.every((o) => typeof o === 'string' && o.length <= 512)).toBe(true);
    });
    await withChrome({ permissions: { getAll: async () => ({}) }, runtime: { getManifest: () => { throw new Error('x'); } } }, async () => {
      expect(await readGrantedAccess()).toEqual({ origins: [], required: [] });
    });
    await withChrome({ permissions: { getAll: async () => { throw new Error('unavailable'); } } }, async () => {
      expect(await readGrantedAccess()).toBeNull();
    });
  });

  it('removeOrigins: [] -> true without a call; the browser answer otherwise; a rejection -> false', async () => {
    const calls: unknown[] = [];
    let answer: unknown = true;
    await withChrome({ permissions: { remove: async (p: unknown) => { calls.push(p); if (answer === 'throw') throw new Error('You cannot remove required permissions.'); return answer; } } }, async () => {
      expect(await removeOrigins([])).toBe(true);
      expect(calls).toEqual([]);
      expect(await removeOrigins(['https://example.com/*'])).toBe(true);
      expect(calls).toEqual([{ origins: ['https://example.com/*'] }]);
      answer = false;
      expect(await removeOrigins(['https://example.com/*'])).toBe(false);
      answer = 'throw';
      expect(await removeOrigins(['http://127.0.0.1/*'])).toBe(false);
    });
  });

  it('removeSiteRequest builds exactly the three-key contract message', () => {
    expect(removeSiteRequest('example.com')).toEqual({ schemaVersion: 1, type: 'ui-remove-site', host: 'example.com' });
    expect(validateUiRequest(removeSiteRequest('example.com')).ok).toBe(true);
  });
});
