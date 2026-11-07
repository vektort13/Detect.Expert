// Scope picker view model (spec A3, ADR-003): three observation levels plus `off`, honest promise texts,
// optional host permission origins. Pure; the chrome.permissions calls live in the component.

import { sanitizeHost } from '@detect-expert/contracts';
import type { ScopeMode, UiSetScopeRequest } from '@detect-expert/contracts';

// F053: only the toolbar popup carries a fresh activeTab gesture.
export type UiSurface = 'popup' | 'sidepanel' | 'options';

export interface ScopeOption {
  mode: ScopeMode;
  labelKey: string;
  /** What the UI honestly promises for this level (spec A3 table). */
  descKey: string;
  needsHost: boolean;
}

export const SCOPE_OPTIONS: ReadonlyArray<ScopeOption> = [
  { mode: 'off', labelKey: 'mode_off', descKey: 'mode_off_desc', needsHost: false },
  { mode: 'active-tab', labelKey: 'mode_active_tab', descKey: 'mode_active_tab_desc', needsHost: false },
  { mode: 'site', labelKey: 'mode_site', descKey: 'mode_site_desc', needsHost: true },
  { mode: 'all-sites', labelKey: 'mode_all', descKey: 'mode_all_desc', needsHost: false },
];

export const SCOPE_MODE_LABEL_KEYS: Readonly<Record<ScopeMode, string>> = {
  off: 'scopeOff',
  'active-tab': 'scopeActiveTab',
  site: 'scopeSite',
  'all-sites': 'scopeAllSites',
};

export const ALL_SITES_ORIGINS: ReadonlyArray<string> = ['http://*/*', 'https://*/*'];

/** Origin patterns to request via chrome.permissions; null when the mode needs no optional host access. */
export function permissionOriginsFor(mode: ScopeMode, host: string | null): string[] | null {
  switch (mode) {
    case 'site':
      return host === null ? null : ['https://' + host + '/*', 'http://' + host + '/*'];
    case 'all-sites':
      return [...ALL_SITES_ORIGINS];
    default:
      return null;
  }
}

/** ui-set-scope payload; null when `site` is requested without a known host. */
export function scopeRequest(mode: ScopeMode, host: string | null): UiSetScopeRequest | null {
  if (mode === 'site') {
    if (host === null) return null;
    return { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host };
  }
  return { schemaVersion: 1, type: 'ui-set-scope', scopeMode: mode };
}

/** User-typed host (options page): accepts "example.com" or a full URL; returns a sanitized host or null. */
export function parseHostInput(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '' || /[\s*]/.test(trimmed)) return null;
  const url = trimmed.includes('://') ? trimmed : 'https://' + trimmed;
  return sanitizeHost(url);
}
