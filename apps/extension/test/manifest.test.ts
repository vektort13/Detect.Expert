import { afterEach, describe, expect, it, vi } from 'vitest';
import browserSupport from '../../../browser-support.json';
import { buildManifest, MINIMUM_CHROME_VERSION } from '../manifest';

// ADR-002 / ADR-003 / REQ-010: expectations are independent of manifest constants.
describe('F165 approved manifest profiles', () => {
  for (const profile of ['local', 'test'] as const) {
    it(profile + ' preserves exact permissions, CSP and absent static entrypoints', () => {
      const manifest = buildManifest(profile, '0.1.0');
      expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'storage', 'webRequest', 'webNavigation', 'sidePanel']);
      expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
      expect(manifest.content_security_policy).toEqual({
        extension_pages: "script-src 'self'; object-src 'none'; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      expect(manifest.minimum_chrome_version).toBe(browserSupport.minimumChromeVersion);
      expect(MINIMUM_CHROME_VERSION).toBe(browserSupport.minimumChromeVersion);
      expect(manifest.incognito).toBe('not_allowed');
      for (const field of ['content_scripts', 'web_accessible_resources']) expect(manifest).not.toHaveProperty(field);
      if (profile === 'local') expect(manifest).not.toHaveProperty('host_permissions');
      else expect(manifest.host_permissions).toEqual(['http://127.0.0.1/*']);
    });
  }
});

describe('F087 support-file validation during manifest generation', () => {
  afterEach(() => { vi.doUnmock('../../../browser-support.json'); vi.resetModules(); });

  for (const version of ['120', '153.0.8010.12']) {
    it('uses a changed support version: ' + version, async () => {
      vi.resetModules();
      vi.doMock('../../../browser-support.json', () => ({ default: { minimumChromeVersion: version } }));
      const manifest = await import('../manifest');
      expect(manifest.buildManifest('local', '0.1.0').minimum_chrome_version).toBe(version);
      expect(manifest.buildManifest('test', '0.1.0').minimum_chrome_version).toBe(version);
    });
  }

  for (const version of [undefined, null, 119, '', '118', '118.999', '119beta', ' 119', '119.0.0.0.1']) {
    it('rejects malformed or below-floor support version: ' + String(version), async () => {
      vi.resetModules();
      vi.doMock('../../../browser-support.json', () => ({ default: { minimumChromeVersion: version } }));
      await expect(import('../manifest')).rejects.toThrow('invalid browser-support.json minimumChromeVersion');
    });
  }
});
