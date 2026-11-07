// ADR-020 §10 (S04): content-script registrations of the module «Защита». Only the module's own ids are read or
// changed (getRegisteredContentScripts({ids})); detector-*-v1 of observation are never touched, and scope.ts likewise
// removes only its own ids. Registrations are reconciled at every SW start with the module enabled (SP-7: they did not
// survive a browser restart in the harness even with persistAcrossSessions).

import { PROTECT_MAIN_GROUPS } from '@detect-expert/contracts';
import type { ProtectFeature, ProtectMainGroup } from '@detect-expert/contracts';
import type { BackgroundChromeApi, RegisteredContentScriptLike } from '../chrome-api';

export const PROTECT_ISOLATED_SCRIPT_ID = 'detector-protect-isolated-v1';
export const PROTECT_MAIN_SCRIPT_ID = 'detector-protect-main-v1';
export const PROTECT_SCRIPT_IDS: readonly string[] = [PROTECT_ISOLATED_SCRIPT_ID, PROTECT_MAIN_SCRIPT_ID];
export const PROTECT_ISOLATED_FILE = 'protect.js';
export const PROTECT_POLICY_FILE = 'protect-policy.js';
export const PROTECT_MAIN_FILE = 'protect.main.js';
export const GPC_MAIN_FILE = 'gpc.main.js';
const MATCHES: readonly string[] = ['http://*/*', 'https://*/*'];

/** Prelude file that sets the bit of one MAIN hook group (built per PROTECT_MAIN_GROUPS entry by scripts/build.mjs). */
export function protectOnFile(group: ProtectMainGroup): string {
  return 'protect-on.' + group + '.js';
}

/**
 * MAIN hook groups the features need: `send` ⇐ value-match or firewall (send attribution); `listen` ⇐ session-replay
 * or value-match (listener facts on password fields). `gate` is the perf-gate decision per group (PROTECT_HOOK_CONFIG,
 * S10); a group the gate rejects is not registered.
 */
export function protectGroupsFor(features: readonly ProtectFeature[], gate: (group: ProtectMainGroup) => boolean = () => true): ProtectMainGroup[] {
  const want = new Set<ProtectMainGroup>();
  if (features.includes('value-match') || features.includes('firewall')) want.add('send');
  if (features.includes('session-replay') || features.includes('value-match')) want.add('listen');
  return PROTECT_MAIN_GROUPS.filter((g) => want.has(g) && gate(g));
}

/** Prelude mask of `groups` (bit = 1 << index in PROTECT_MAIN_GROUPS). */
export function protectGroupMask(groups: readonly ProtectMainGroup[]): number {
  let mask = 0;
  PROTECT_MAIN_GROUPS.forEach((g, i) => {
    if (groups.includes(g)) mask |= 1 << i;
  });
  return mask;
}

/**
 * Test profile only: the password tripwire bundles that run first in each world (S05). Their names reach the
 * registration only from the test branch of the SW entry, so dist/local carries none (scripts/release-verify.mjs).
 */
export interface ProtectTripwireFiles {
  isolated: string;
  main: string;
}

/**
 * MAIN files in order: [tripwire (test)], [gpc.main.js], then — only with at least one group — protect-policy.js,
 * one protect-on.<group>.js per group and protect.main.js. Empty when nothing is needed (the tripwire alone still
 * registers in the test profile, so the MAIN world is always checked there).
 */
export function protectMainFiles(options: { features: readonly ProtectFeature[]; groups: readonly ProtectMainGroup[]; tripwire?: ProtectTripwireFiles | undefined }): string[] {
  const files: string[] = [];
  if (options.features.includes('gpc')) files.push(GPC_MAIN_FILE);
  if (options.groups.length > 0) files.push(PROTECT_POLICY_FILE, ...PROTECT_MAIN_GROUPS.filter((g) => options.groups.includes(g)).map(protectOnFile), PROTECT_MAIN_FILE);
  if (options.tripwire !== undefined) files.unshift(options.tripwire.main);
  return files;
}

export function protectIsolatedFiles(tripwire?: ProtectTripwireFiles): string[] {
  return tripwire === undefined ? [PROTECT_ISOLATED_FILE] : [tripwire.isolated, PROTECT_ISOLATED_FILE];
}

const HAS_LETTER_RE = /[a-z]/;

/** `*://site/*` and, for DNS names, `*://*.site/*` per excluded site (IPv4 literals: the exact host only). */
export function excludeMatchesFor(sites: readonly string[]): string[] {
  const out: string[] = [];
  for (const site of sites) {
    out.push('*://' + site + '/*');
    const last = site.slice(site.lastIndexOf('.') + 1);
    if (HAS_LETTER_RE.test(last)) out.push('*://*.' + site + '/*');
  }
  return out;
}

export interface ProtectRegistrationDesired {
  features: readonly ProtectFeature[];
  excludedSites: readonly string[];
}

export interface ProtectRegistrationOptions {
  /** Test profile only (see ProtectTripwireFiles). */
  tripwireFiles?: ProtectTripwireFiles | undefined;
  /** Perf-gate decision per MAIN group (S10 PROTECT_HOOK_CONFIG); default: every group allowed (hooks gate themselves). */
  groupGate?: ((group: ProtectMainGroup) => boolean) | undefined;
}

export class ProtectRegistration {
  private matchOriginAsFallbackSupported: boolean | null = null;
  private readonly tripwire: ProtectTripwireFiles | undefined;
  private readonly gate: (group: ProtectMainGroup) => boolean;

  constructor(private readonly api: BackgroundChromeApi, options: ProtectRegistrationOptions = {}) {
    this.tripwire = options.tripwireFiles;
    this.gate = options.groupGate ?? (() => true);
  }

  /** MAIN groups of the current features after the perf gate. */
  groups(features: readonly ProtectFeature[]): ProtectMainGroup[] {
    return protectGroupsFor(features, this.gate);
  }

  /** The scripts the module wants (an empty MAIN list means no MAIN registration). */
  build(desired: ProtectRegistrationDesired, withFallback: boolean): RegisteredContentScriptLike[] {
    const exclude = excludeMatchesFor(desired.excludedSites);
    const base = {
      matches: [...MATCHES],
      allFrames: true,
      runAt: 'document_start' as const,
      persistAcrossSessions: true,
      ...(withFallback ? { matchOriginAsFallback: true } : {}),
      ...(exclude.length > 0 ? { excludeMatches: exclude } : {}),
    };
    const scripts: RegisteredContentScriptLike[] = [{ id: PROTECT_ISOLATED_SCRIPT_ID, js: protectIsolatedFiles(this.tripwire), world: 'ISOLATED', ...base }];
    const main = protectMainFiles({ features: desired.features, groups: this.groups(desired.features), tripwire: this.tripwire });
    if (main.length > 0) scripts.push({ id: PROTECT_MAIN_SCRIPT_ID, js: main, world: 'MAIN', ...base });
    return scripts;
  }

  /** Our registrations as the browser reports them. */
  async registered(): Promise<RegisteredContentScriptLike[]> {
    return this.api.scripting.getRegisteredContentScripts({ ids: [...PROTECT_SCRIPT_IDS] });
  }

  /**
   * Makes the browser's registrations of our ids equal `desired`: unregister what is not wanted, update what exists
   * (excludeMatches always passed, [] clears it), register what is missing. matchOriginAsFallback is feature-detected
   * (retry without it once when the browser rejects the property). Throws when the browser rejects the change.
   */
  async reconcile(desired: ProtectRegistrationDesired): Promise<void> {
    const existing = await this.registered();
    const existingIds = new Set(existing.map((s) => s.id));
    const attempt = async (withFallback: boolean): Promise<void> => {
      const wanted = this.build(desired, withFallback);
      const wantedIds = new Set(wanted.map((s) => s.id));
      const remove = [...existingIds].filter((id) => !wantedIds.has(id));
      if (remove.length > 0) {
        await this.api.scripting.unregisterContentScripts({ ids: remove });
        for (const id of remove) existingIds.delete(id);
      }
      const update = wanted.filter((s) => existingIds.has(s.id)).map((s) => ({ ...s, excludeMatches: s.excludeMatches ?? [] }));
      const register = wanted.filter((s) => !existingIds.has(s.id));
      if (update.length > 0) await this.api.scripting.updateContentScripts(update);
      if (register.length > 0) {
        await this.api.scripting.registerContentScripts(register);
        for (const s of register) existingIds.add(s.id);
      }
    };
    const withFallback = this.matchOriginAsFallbackSupported !== false;
    try {
      await attempt(withFallback);
      if (withFallback) this.matchOriginAsFallbackSupported = true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!withFallback || !/matchOriginAsFallback/.test(message)) throw e;
      this.matchOriginAsFallbackSupported = false;
      await attempt(false);
    }
  }

  /**
   * Review W3: registers our MAIN script again (unregister + register), so it runs after observation's detector-main-v1
   * in new documents (SP-7: MAIN scripts run in registration order). Observation's bootstrap refuses a non-native
   * window.addEventListener, and the module's listen hook replaces it (test profiles; release: listen off). Only when
   * our MAIN registration exists; false otherwise. Throws when the browser rejects the change.
   */
  async reregisterMain(desired: ProtectRegistrationDesired): Promise<boolean> {
    const existing = await this.api.scripting.getRegisteredContentScripts({ ids: [PROTECT_MAIN_SCRIPT_ID] });
    if (existing.length === 0) return false;
    const main = this.build(desired, this.matchOriginAsFallbackSupported !== false).find((s) => s.id === PROTECT_MAIN_SCRIPT_ID);
    await this.api.scripting.unregisterContentScripts({ ids: [PROTECT_MAIN_SCRIPT_ID] });
    if (main === undefined) return false;
    await this.api.scripting.registerContentScripts([main]);
    return true;
  }

  /** Removes our registrations only (ids read back first: unregistering an unknown id would reject). */
  async unregisterAll(): Promise<number> {
    const existing = await this.registered();
    if (existing.length === 0) return 0;
    await this.api.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
    return existing.length;
  }
}
