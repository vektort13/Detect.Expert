// Typed manifest — single owner; permissions/CSP change only through an agreed ADR.
// scripts/build.mjs turns buildManifest(profile, version) into dist/<profile>/manifest.json.
// Source of the shape: spec Part II A4 and the project rules REQ-010. No static content_scripts: observation is off
// until the user picks a scope; scripts are registered dynamically via scripting.registerContentScripts.

import browserSupport from '../../browser-support.json';

export const BUILD_PROFILES = ['local', 'test', 'test-optional'] as const;
export type BuildProfile = (typeof BUILD_PROFILES)[number];

export const PERMISSIONS = ['activeTab', 'scripting', 'storage', 'webRequest', 'webNavigation', 'sidePanel'] as const;
export const OPTIONAL_HOST_PERMISSIONS = ['http://*/*', 'https://*/*'] as const;
/** Test profile only: the Playwright fixture servers on loopback. Never in the local (release) profile. */
export const TEST_HOST_PERMISSIONS = ['http://127.0.0.1/*'] as const;
export const EXTENSION_PAGES_CSP =
  "script-src 'self'; object-src 'none'; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'";
// ADR-002 / ADR-003 / F087: the support file owns the version; the API floor remains 119.
const minimumChromeVersion: unknown = browserSupport.minimumChromeVersion;
if (typeof minimumChromeVersion !== 'string' || !/^[1-9]\d{0,4}(\.\d{1,5}){0,3}$/.test(minimumChromeVersion)
  || Number(minimumChromeVersion.split('.')[0]) < 119) {
  throw new Error('invalid browser-support.json minimumChromeVersion (API floor 119)');
}
export const MINIMUM_CHROME_VERSION = minimumChromeVersion;
export const ICON_SIZES = [16, 32, 48, 128] as const;

export interface ExtensionManifest {
  manifest_version: 3;
  name: string;
  version: string;
  description: string;
  default_locale: 'ru';
  minimum_chrome_version: string;
  permissions: string[];
  optional_host_permissions: string[];
  host_permissions?: string[];
  background: { service_worker: string; type: 'module' };
  action: { default_popup: string; default_title: string };
  side_panel: { default_path: string };
  options_ui: { page: string; open_in_tab: boolean };
  incognito: 'not_allowed';
  content_security_policy: { extension_pages: string };
  icons: Record<string, string>;
}

const VERSION_RE = /^\d{1,5}(\.\d{1,5}){0,3}$/;

export function buildManifest(profile: BuildProfile, version: string): ExtensionManifest {
  if (!BUILD_PROFILES.includes(profile)) throw new Error('unknown build profile');
  if (!VERSION_RE.test(version)) throw new Error('invalid extension version');
  const icons: Record<string, string> = {};
  for (const size of ICON_SIZES) icons[String(size)] = 'icons/' + String(size) + '.png';
  const manifest: ExtensionManifest = {
    manifest_version: 3,
    name: '__MSG_extName__',
    version,
    description: '__MSG_extDescription__',
    default_locale: 'ru',
    minimum_chrome_version: MINIMUM_CHROME_VERSION,
    permissions: [...PERMISSIONS],
    optional_host_permissions: [...OPTIONAL_HOST_PERMISSIONS],
    background: { service_worker: 'background.js', type: 'module' },
    action: { default_popup: 'popup.html', default_title: '__MSG_actionTitle__' },
    side_panel: { default_path: 'sidepanel.html' },
    options_ui: { page: 'options.html', open_in_tab: true },
    incognito: 'not_allowed',
    content_security_policy: { extension_pages: EXTENSION_PAGES_CSP },
    icons,
  };
  if (profile !== 'local') manifest.name = '__MSG_extName__ (' + profile + ')';
  if (profile === 'test') {
    manifest.host_permissions = [...TEST_HOST_PERMISSIONS];
  }
  return manifest;
}
