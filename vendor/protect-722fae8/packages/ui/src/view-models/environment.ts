// Environment classification for the state list (spec V §7): restricted pages and unsupported Chrome.
// Pure parsers plus a thin runtime reader; the extension's own page is inspected here, never a site.

import type { TabUrlClass } from './coverage';

/** Schemes where injection is impossible or forbidden (spec A8: built-in pages, extensions, special frames). */
export const RESTRICTED_SCHEMES: ReadonlySet<string> = new Set([
  'chrome:',
  'chrome-extension:',
  'chrome-untrusted:',
  'chrome-search:',
  'chrome-error:',
  'devtools:',
  'edge:',
  'about:',
  'view-source:',
  'file:',
]);

/** Chrome Web Store hosts (Chrome blocks content scripts there). */
export const RESTRICTED_HOSTS: ReadonlySet<string> = new Set(['chromewebstore.google.com', 'chrome.google.com']);

export function classifyTabUrl(url: string | undefined): TabUrlClass {
  if (url === undefined || url === '') return 'unknown';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'restricted';
  }
  if (RESTRICTED_SCHEMES.has(parsed.protocol)) return 'restricted';
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return RESTRICTED_HOSTS.has(parsed.hostname.toLowerCase()) ? 'restricted' : 'web';
  }
  return 'restricted';
}

export interface BrandEntry {
  brand: string;
  version: string;
}

/** Major version from navigator.userAgentData brands, falling back to the UA string; null when unknown. */
export function parseChromeMajor(brands: ReadonlyArray<BrandEntry> | undefined, userAgent: string | undefined): number | null {
  if (brands !== undefined) {
    for (const entry of brands) {
      if (/^(Google Chrome|Chromium)$/.test(entry.brand)) {
        const major = Number.parseInt(entry.version, 10);
        if (Number.isFinite(major) && major > 0) return major;
      }
    }
  }
  if (userAgent !== undefined) {
    const match = /\bChrome\/(\d+)/.exec(userAgent);
    if (match !== null && match[1] !== undefined) {
      const major = Number.parseInt(match[1], 10);
      if (Number.isFinite(major) && major > 0) return major;
    }
  }
  return null;
}

/** Unknown version or floor never produces an "unsupported" claim (REQ-015). */
export function isChromeSupported(major: number | null, floor: string | undefined): boolean {
  if (major === null || floor === undefined) return true;
  const floorMajor = Number.parseInt(floor, 10);
  if (!Number.isFinite(floorMajor)) return true;
  return major >= floorMajor;
}

export interface ChromeSupport {
  major: number | null;
  supported: boolean;
  version: string | null;
}

interface NavigatorWithUaData {
  userAgentData?: { brands?: BrandEntry[] };
  userAgent?: string;
}

export function detectChrome(): ChromeSupport {
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as NavigatorWithUaData;
  const major = parseChromeMajor(nav.userAgentData?.brands, nav.userAgent);
  let floor: string | undefined;
  try {
    floor = typeof chrome === 'undefined' ? undefined : chrome.runtime.getManifest().minimum_chrome_version;
  } catch {
    floor = undefined;
  }
  return { major, supported: isChromeSupported(major, floor), version: major === null ? null : String(major) };
}
