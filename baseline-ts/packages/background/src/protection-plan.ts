import { PROTECTION_FEATURES, effectiveProtection } from '@detect-expert/contracts';
import type { ProtectionFeature, ProtectionSettings } from '@detect-expert/contracts';
import type { RegisteredContentScriptLike } from './chrome-api';
import { hostPatterns, patternCoversHost } from './scope';

export const PROTECTION_SCRIPT_PREFIX = 'detector-protection-v1-';
export const PROTECTION_SCRIPT_IDS = PROTECTION_FEATURES.map(feature => PROTECTION_SCRIPT_PREFIX + feature);

export function protectionScriptFile(feature: ProtectionFeature): string {
  return 'protection.' + feature + '.js';
}

export function buildProtectionScripts(settings: ProtectionSettings, scopeMatches: readonly string[]): RegisteredContentScriptLike[] {
  if (!settings.enabled) return [];
  const scope = [...new Set(scopeMatches.filter(pattern => pattern.startsWith('http://') || pattern.startsWith('https://')))];
  if (scope.length === 0) return [];
  const global = effectiveProtection({ ...settings, sites: [] }, 'protection.invalid');
  const sites = settings.sites.map(site => ({ host: site.host, blocked: effectiveProtection(settings, site.host) }));
  const result: RegisteredContentScriptLike[] = [];
  for (const feature of PROTECTION_FEATURES) {
    const globalBlock = global.includes(feature);
    const matches = globalBlock ? [...scope] : sites.filter(site => site.blocked.includes(feature)).flatMap(site =>
      hostPatterns(site.host).filter(pattern => scope.some(grant =>
        grant.startsWith(pattern.slice(0, pattern.indexOf('://') + 3)) && patternCoversHost(grant, site.host))));
    if (matches.length === 0) continue;
    const excludeMatches = globalBlock ? sites.filter(site => !site.blocked.includes(feature)).flatMap(site => hostPatterns(site.host)) : [];
    result.push({
      id: PROTECTION_SCRIPT_PREFIX + feature,
      js: [protectionScriptFile(feature)],
      matches,
      excludeMatches,
      world: 'MAIN',
      runAt: 'document_start',
      allFrames: true,
      matchOriginAsFallback: false,
      persistAcrossSessions: true,
    });
  }
  return result;
}