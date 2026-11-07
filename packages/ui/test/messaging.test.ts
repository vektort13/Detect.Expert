import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { UI_CLEAR_SESSION_REQUEST, errorMessageKey, isUiResponse, readTabIdOverride } from '../src/messaging';

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
