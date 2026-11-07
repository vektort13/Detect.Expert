// Scope modes and permission reactions (spec A3, ADR-003, E06-02). The SW never calls permissions.request
// (it needs a user gesture in an extension page): the popup calls `requestScopeAccess`, then sends
// `ui-set-scope`; the SW verifies with permissions.contains and (un)registers content scripts.
// Preferences live in storage.local (ADR-007 §4); reports never do.

import { BUDGETS, SCOPE_MODES, isSanitizedHost } from '@detect-expert/contracts';
import type { ScopeMode, ScopeState, UiSetScopeRequest } from '@detect-expert/contracts';
import type { BackgroundChromeApi, Clock, PermissionsLike, RegisteredContentScriptLike } from './chrome-api';
import { DATA_CONSENT_KEY, DATA_CONSENT_PENDING_KEY, DATA_CONSENT_VERSION, storedDataConsent } from '../../contracts/src/data-consent';

export const SCOPE_PREFS_KEY = 'scope';
/** ADR-018: migrate prior setup once; subsequent explicit user choices win. */
export const FULL_ACCESS_DEFAULT_KEY = 'scope:full-access-default-v1';
export const ACTIVE_TABS_KEY = 'active-tabs';
interface ActiveGrant { documentId: string }

export const ISOLATED_SCRIPT_ID = 'detector-isolated-v1';
export const MAIN_SCRIPT_ID = 'detector-main-v1';
export const ISOLATED_SCRIPT_FILE = 'bridge.js';
export const MAIN_SCRIPT_FILE = 'hook.main.js';
export const EARLY_MAIN_SCRIPT_FILE = 'hook.early.js';
export const ALL_SITES_PATTERNS: readonly string[] = ['http://*/*', 'https://*/*'];
export const ALL_NETWORK_ACCESS_PATTERNS: readonly string[] = [...ALL_SITES_PATTERNS, 'ws://*/*', 'wss://*/*'];
export type NetworkScheme = 'http' | 'https' | 'ws' | 'wss';
/** permissions.contains results are cached briefly; invalidated on every permissions.onAdded/onRemoved. */
const CONTAINS_CACHE_MS = 5000;
/** The browser's actual registration is re-read at most this often (the SW never assumes its own survived). */
const REGISTRATION_CACHE_MS = 1000;
const MAX_CONTAINS_CACHE = 512;

export interface ScopePrefs {
  v: 1;
  scopeMode: ScopeMode;
  /** Sanitized hosts chosen for site mode (bounded). */
  hosts: string[];
}

const SCOPE_SET: ReadonlySet<string> = new Set<string>(SCOPE_MODES);

export function hostPatterns(host: string): string[] {
  return ['http://' + host + '/*', 'https://' + host + '/*'];
}
export function hostAccessPatterns(host: string): string[] {
  return [...hostPatterns(host), 'ws://' + host + '/*', 'wss://' + host + '/*'];
}

// Match-pattern host test for the subset Chrome grants here: <all_urls>, wildcard-host patterns
// (scheme://*/path), exact host patterns (scheme://host/path) and subdomain patterns (scheme://*.suffix/path).
export function patternCoversHost(pattern: string, host: string): boolean {
  if (pattern === '<all_urls>') return true;
  const schemeEnd = pattern.indexOf('://');
  if (schemeEnd <= 0) return false;
  const scheme = pattern.slice(0, schemeEnd);
  if (scheme !== '*' && scheme !== 'http' && scheme !== 'https' && scheme !== 'ws' && scheme !== 'wss') return false;
  const rest = pattern.slice(schemeEnd + 3);
  const slash = rest.indexOf('/');
  if (slash < 0) return false;
  const patternHost = rest.slice(0, slash).toLowerCase();
  if (patternHost === '*') return true;
  if (patternHost.startsWith('*.')) {
    const suffix = patternHost.slice(2);
    return host === suffix || host.endsWith('.' + suffix);
  }
  return patternHost === host;
}

function readPrefs(value: unknown): ScopePrefs {
  const fallback: ScopePrefs = { v: 1, scopeMode: 'off', hosts: [] };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const v = value as Record<string, unknown>;
  if (v['v'] !== 1) return fallback;
  const mode = v['scopeMode'];
  const hostsRaw = v['hosts'];
  const scopeMode: ScopeMode = typeof mode === 'string' && SCOPE_SET.has(mode) ? (mode as ScopeMode) : 'off';
  const hosts: string[] = [];
  if (Array.isArray(hostsRaw)) {
    for (const h of hostsRaw) {
      if (isSanitizedHost(h) && !hosts.includes(h)) hosts.push(h);
      if (hosts.length >= BUDGETS.maxHostsPerDocument) break;
    }
  }
  return { v: 1, scopeMode, hosts };
}

/**
 * UI-context helper (popup/options): asks the browser for the optional host permission of a scope.
 * Must run from a user gesture inside an extension page; the SW only reacts to the result via ui-set-scope
 * and permissions.onAdded. Returns the browser answer; never throws.
 */
export async function requestScopeAccess(
  permissions: { request(permissions: PermissionsLike): Promise<boolean> },
  scopeMode: ScopeMode,
  host?: string,
): Promise<boolean> {
  try {
    if (scopeMode === 'all-sites') return await permissions.request({ origins: [...ALL_NETWORK_ACCESS_PATTERNS] });
    if (scopeMode === 'site') {
      if (!isSanitizedHost(host)) return false;
      return await permissions.request({ origins: hostAccessPatterns(host) });
    }
    return true;
  } catch {
    return false;
  }
}

export type SetScopeResult = { ok: true; scope: ScopeState } | { ok: false; code: 'no-access' };

export class ScopeController {
  private prefs: ScopePrefs = { v: 1, scopeMode: 'off', hosts: [] };
  private consentAccepted = false;
  dataConsentLoaded = false;
  private fullAccessDefaultApplied = false;
  get hasDataConsent(): boolean { return this.consentAccepted; }
  /** Origin patterns the browser reports as granted (permissions.getAll). */
  private grantedOrigins: string[] = [];
  private grantedAllSites = false;
  private requiredAllSites = false;
  /** Static host_permissions from the manifest that are actually granted (test profile only). */
  private staticPatterns: string[] = [];
  /** Successful activeTab injection, bounded by trusted tab/document identity (F003/F110). */
  private readonly activeTabs = new Map<number, ActiveGrant>();
  private readonly containsCache = new Map<string, { granted: boolean; at: number }>();
  private matchOriginAsFallbackSupported: boolean | null = null;
  private registrationOk = true;
  /** Match patterns the browser reports for BOTH detector scripts; [] when either is missing. */
  private registeredMatches: string[] = [];
  private registeredAt = 0;
  private mutationChain: Promise<unknown> = Promise.resolve();
  private registrationRunning: Promise<void> | null = null;
  private registrationDirty = false;
  private activeSaveChain: Promise<void> = Promise.resolve();

  accessGeneration = 0;
  private accessMutations = 0;
  get accessReady(): boolean { return this.consentAccepted && this.accessMutations === 0; }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    this.accessMutations++;
    const next = this.mutationChain.then(task, task).finally(() => { this.accessMutations--; });
    this.mutationChain = next.catch(() => undefined);
    return next;
  }

  private async saveActiveTabs(): Promise<void> {
    const next = this.activeSaveChain.then(() => this.api.storage.session.set({ [ACTIVE_TABS_KEY]: [...this.activeTabs].map(([tabId, grant]) => ({ tabId, ...grant })) }));
    this.activeSaveChain = next.catch(() => undefined);
    await next;
  }

  constructor(
    private readonly api: BackgroundChromeApi,
    private readonly clock: Clock,
    private readonly testBootstrap = false,
  ) {}

  async load(): Promise<void> {
    try {
      const items = await this.api.storage.local.get([SCOPE_PREFS_KEY, DATA_CONSENT_KEY, FULL_ACCESS_DEFAULT_KEY]);
      const pending = await this.api.storage.session.get(DATA_CONSENT_PENDING_KEY);
      this.consentAccepted = pending[DATA_CONSENT_PENDING_KEY] !== true && storedDataConsent(items[DATA_CONSENT_KEY]);
      this.fullAccessDefaultApplied = items[FULL_ACCESS_DEFAULT_KEY] === true;
      this.prefs = readPrefs(items[SCOPE_PREFS_KEY]);
    } catch {
      this.consentAccepted = false;
      this.prefs = { v: 1, scopeMode: 'off', hosts: [] };
    } finally {
      this.dataConsentLoaded = true;
    }
    await this.refreshGrants();
  }

  async refreshGrants(): Promise<void> {
    this.accessGeneration++;
    this.containsCache.clear();
    const all = await this.api.permissions.getAll();
    const origins = Array.isArray(all.origins) ? all.origins.filter((o): o is string => typeof o === 'string') : [];
    this.grantedOrigins = origins;
    this.grantedAllSites =
      origins.includes('<all_urls>') || (origins.includes('http://*/*') && origins.includes('https://*/*'));
    let manifestHosts: string[] = [];
    try {
      const hp = (this.api.runtime.getManifest() as { host_permissions?: unknown }).host_permissions;
      manifestHosts = Array.isArray(hp) ? hp.filter((p): p is string => typeof p === 'string') : [];
    } catch {
      manifestHosts = [];
    }
    this.staticPatterns = manifestHosts.filter((p) => this.testBootstrap && origins.includes(p));
    this.requiredAllSites = manifestHosts.includes('<all_urls>') ||
      (manifestHosts.includes('http://*/*') && manifestHosts.includes('https://*/*'));
  }

  private async applyFullAccessDefault(): Promise<void> {
    // Only the user-authorized production manifest carries these required permissions. Optional
    // profiles and browser-withheld grants keep their existing choice and never imply access.
    if (!this.consentAccepted || !this.requiredAllSites || !this.grantedAllSites) return;
    const saved = await this.api.storage.local.get(FULL_ACCESS_DEFAULT_KEY);
    if (saved[FULL_ACCESS_DEFAULT_KEY] === true) return;
    const next: ScopePrefs = { v: 1, scopeMode: 'all-sites', hosts: [] };
    await this.api.storage.local.set({ [SCOPE_PREFS_KEY]: next, [FULL_ACCESS_DEFAULT_KEY]: true });
    this.prefs = next;
  }

  /** Startup: load prefs, verify grants, reconcile registrations (static test grants included). */
  async startup(): Promise<void> {
    await this.serialize(async () => {
      try {
      await this.load();
      await this.applyFullAccessDefault();
      const saved = await this.api.storage.local.get(SCOPE_PREFS_KEY);
      if (saved[SCOPE_PREFS_KEY] === undefined && this.testBootstrap && this.staticPatterns.length > 0) {
        const hosts = this.staticPatterns.map((p) => p.slice(p.indexOf('://') + 3, -2));
        this.prefs = readPrefs({ v: 1, scopeMode: 'site', hosts });
      }
      const stored = (await this.api.storage.session.get(ACTIVE_TABS_KEY))[ACTIVE_TABS_KEY];
      if (this.prefs.scopeMode === 'active-tab' && Array.isArray(stored)) {
        for (const entry of stored.slice(0, BUDGETS.maxHostsPerDocument)) {
          if (entry && Number.isInteger(entry.tabId) && entry.tabId >= 0 &&
              typeof entry.documentId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(entry.documentId)) {
            this.activeTabs.set(entry.tabId, { documentId: entry.documentId });
          }
        }
      }
      await this.saveActiveTabs();
      await this.reconcilePrefs();
      } catch (error) {
        this.suspendDataConsent();
        throw error;
      } finally {
        await this.ensureRegistration();
      }
    });
  }

  getScopeMode(): ScopeMode {
    return this.consentAccepted ? this.prefs.scopeMode : 'off';
  }

  getState(): ScopeState {
    return { scopeMode: this.getScopeMode(), hosts: this.consentAccepted ? [...this.prefs.hosts] : [], grantedAllSites: this.grantedAllSites, managed: false };
  }

  setDataConsent(accepted: boolean): Promise<boolean> {
    return this.serialize(async () => {
      this.suspendDataConsent();
      await this.ensureRegistration();
      try {
        await this.refreshGrants();
        const next: ScopePrefs = accepted && !this.fullAccessDefaultApplied && this.prefs.scopeMode === 'off' && this.requiredAllSites && this.grantedAllSites ?
          { v: 1, scopeMode: 'all-sites', hosts: [] } : this.prefs;
        const applied = this.fullAccessDefaultApplied || accepted;
        await this.saveActiveTabs();
        await this.api.storage.local.set({ [DATA_CONSENT_KEY]: { version: DATA_CONSENT_VERSION, accepted },
          [SCOPE_PREFS_KEY]: next, [FULL_ACCESS_DEFAULT_KEY]: applied });
        this.prefs = next;
        this.fullAccessDefaultApplied = applied;
        await this.api.storage.session.remove(DATA_CONSENT_PENDING_KEY);
        this.consentAccepted = accepted;
        await this.ensureRegistration();
        return true;
      } catch {
        this.consentAccepted = false;
        await this.ensureRegistration();
        return false;
      }
    });
  }

  suspendDataConsent(): void {
    this.consentAccepted = false;
    this.accessGeneration++;
    this.containsCache.clear();
    this.activeTabs.clear();
  }

  async beginDataConsentChange(): Promise<boolean> {
    this.suspendDataConsent();
    const saved = await Promise.allSettled([
      this.api.storage.session.set({ [DATA_CONSENT_PENDING_KEY]: true }),
      this.api.storage.local.set({ [DATA_CONSENT_KEY]: { version: DATA_CONSENT_VERSION, accepted: false } }),
    ]);
    await this.ensureRegistration();
    return saved.some(result => result.status === 'fulfilled');
  }

  /** Guard for the network observer: no host access at all means nothing to attribute. */
  hasAnyHostAccess(): boolean {
    return this.consentAccepted && (this.desiredMatches().length > 0 || (this.prefs.scopeMode === 'active-tab' && this.activeTabs.size > 0));
  }

  isHostGrantedSync(host: string, scheme?: NetworkScheme): boolean {
    for (const p of this.grantedOrigins) if (patternCoversHost(p, host) && (p === '<all_urls>' ||
      (scheme === undefined ? /^(?:http|https|\*):\/\//.test(p) : p.startsWith(scheme + '://') ||
        (scheme === 'http' || scheme === 'https') && p.startsWith('*://')))) return true;
    return false;
  }

  hasBroadNetworkAccess(): boolean {
    return this.consentAccepted && (this.grantedOrigins.includes('<all_urls>') || ALL_NETWORK_ACCESS_PATTERNS.every(pattern => this.grantedOrigins.includes(pattern)));
  }

  isTabActiveTabGranted(tabId: number, host: string | null, documentId?: string): boolean {
    const grant = this.activeTabs.get(tabId);
    return this.consentAccepted && this.prefs.scopeMode === 'active-tab' && host !== null && grant !== undefined &&
      documentId !== undefined && grant.documentId === documentId;
  }

  // REQ-012: retained browser permissions never override the user's selected scope.
  inScope(host: string | null, tabId: number, documentId?: string, scheme?: 'http' | 'https'): boolean {
    if (!this.consentAccepted || host === null) return false;
    if (this.isTabActiveTabGranted(tabId, host, documentId)) return true;
    if (this.prefs.scopeMode === 'all-sites') return this.grantedAllSites;
    if (this.prefs.scopeMode === 'site') return this.prefs.hosts.includes(host) && this.isHostGrantedSync(host, scheme);
    return false;
  }

  /** ScopeAccess for sender verification: activeTab set, then permissions.contains (cached briefly). */
  async isGranted(originPattern: string, tabId: number, documentId?: string): Promise<boolean> {
    await this.mutationChain;
    if (!this.accessReady) return false;
    const generation = this.accessGeneration;
    const host = originPattern.slice(originPattern.indexOf('://') + 3, originPattern.length - 2);
    if (!this.inScope(host, tabId, documentId)) return false;
    if (this.isTabActiveTabGranted(tabId, host, documentId)) return true;
    const now = this.clock.now();
    const cacheKey = documentId === undefined ? null : String(tabId) + ':' + documentId;
    const cached = cacheKey === null ? undefined : this.containsCache.get(cacheKey);
    if (cached !== undefined && now - cached.at < CONTAINS_CACHE_MS) return cached.granted;
    const granted = await this.api.permissions.contains({ origins: [originPattern] });
    if (!this.accessReady || generation !== this.accessGeneration || !this.inScope(host, tabId, documentId)) return false;
    if (this.containsCache.size >= MAX_CONTAINS_CACHE) this.containsCache.clear();
    if (cacheKey !== null) this.containsCache.set(cacheKey, { granted, at: now });
    return granted;
  }

  /** SW side of ui-set-scope: verifies the permission is already granted, persists prefs, (un)registers. */
  setScope(request: UiSetScopeRequest): Promise<SetScopeResult> {
    return this.serialize(() => this.setScopeNow(request));
  }

  private async setScopeNow(request: UiSetScopeRequest): Promise<SetScopeResult> {
    if (!this.consentAccepted && request.scopeMode !== 'off') return { ok: false, code: 'no-access' };
    this.containsCache.clear();
    if (request.scopeMode === 'site') {
      const host = request.host;
      if (!isSanitizedHost(host)) return { ok: false, code: 'no-access' };
      if (!(await Promise.all(hostPatterns(host).map((p) => this.contains([p])))).some(Boolean)) return { ok: false, code: 'no-access' };
      const hosts = this.prefs.hosts.filter((h) => h !== host);
      hosts.push(host);
      while (hosts.length > BUDGETS.maxHostsPerDocument) hosts.shift();
      this.prefs = { v: 1, scopeMode: 'site', hosts };
    } else if (request.scopeMode === 'all-sites') {
      if (!(await this.contains([...ALL_SITES_PATTERNS]))) return { ok: false, code: 'no-access' };
      this.prefs = { ...this.prefs, scopeMode: 'all-sites' };
    } else {
      this.prefs = { ...this.prefs, scopeMode: request.scopeMode };
    }
    this.activeTabs.clear();
    await this.saveActiveTabs();
    try {
      await this.api.storage.local.set({ [SCOPE_PREFS_KEY]: this.prefs, [FULL_ACCESS_DEFAULT_KEY]: true });
    } catch {
      // Preferences are a convenience; the in-memory scope still applies for this SW lifetime.
    }
    await this.refreshGrants();
    await this.ensureRegistration();
    return { ok: true, scope: this.getState() };
  }

  /** active-tab mode: late injection of both worlds into the tab the popup was opened on (activeTab grant). */
  injectNow(tabId: number, host: string | null, documentId?: string): Promise<boolean> {
    return this.serialize(() => this.injectNowCurrent(tabId, host, documentId));
  }

  private async injectNowCurrent(tabId: number, host: string | null, documentId?: string): Promise<boolean> {
    if (!this.consentAccepted || host === null || documentId === undefined) return false;
    const generation = this.accessGeneration;
    try {
      await this.api.scripting.executeScript({
        target: { tabId, documentIds: [documentId] },
        files: [ISOLATED_SCRIPT_FILE],
        world: 'ISOLATED',
        injectImmediately: true,
      });
      if (!this.consentAccepted || generation !== this.accessGeneration) return false;
      await this.api.scripting.executeScript({
        target: { tabId, documentIds: [documentId] },
        files: [MAIN_SCRIPT_FILE],
        world: 'MAIN',
        injectImmediately: true,
      });
    } catch {
      return false;
    }
    const current = (await this.api.webNavigation.getAllFrames({ tabId }))?.find((f) => f.frameId === 0);
    if (!this.consentAccepted || generation !== this.accessGeneration) return false;
    if (current?.documentId !== documentId) return false;
    const previousGrant = this.activeTabs.get(tabId);
    this.activeTabs.delete(tabId);
    if (this.activeTabs.size >= BUDGETS.maxHostsPerDocument) return false;
    this.activeTabs.set(tabId, { documentId });
    const previous = this.prefs;
    this.prefs = { ...this.prefs, scopeMode: 'active-tab' };
    try {
      await this.api.storage.local.set({ [SCOPE_PREFS_KEY]: this.prefs, [FULL_ACCESS_DEFAULT_KEY]: true });
      await this.saveActiveTabs();
    } catch {
      this.activeTabs.delete(tabId);
      if (previousGrant !== undefined) this.activeTabs.set(tabId, previousGrant);
      this.prefs = previous;
      try {
        await this.api.storage.local.set({ [SCOPE_PREFS_KEY]: previous });
        await this.saveActiveTabs();
      } catch { /* in-memory authorization retains the previous scope */ }
      return false;
    }
    this.accessGeneration++;
    await this.ensureRegistration();
    return true;
  }

  async reconcileActiveTabs(live: ReadonlySet<string>): Promise<void> {
    for (const [tabId, grant] of this.activeTabs) if (!live.has(String(tabId) + ':' + grant.documentId)) this.activeTabs.delete(tabId);
    await this.saveActiveTabs();
  }

  noteTabRemoved(tabId: number): void {
    if (this.activeTabs.delete(tabId)) void this.saveActiveTabs().catch(() => undefined);
  }

  /** activeTab access ends when the tab navigates to another origin (ADR-003 «Последствия»). */
  noteTopCommit(tabId: number, host: string | null, documentId?: string): boolean {
    const grant = this.activeTabs.get(tabId);
    // Conservative document-lifetime grant: also expires on same-origin cross-document navigation.
    if (grant !== undefined && (documentId !== grant.documentId)) { this.accessGeneration++; this.noteTabRemoved(tabId); return true; }
    return false;
  }

  async onPermissionsChanged(): Promise<void> {
    await this.serialize(async () => {
      await this.refreshGrants();
      await this.applyFullAccessDefault();
      await this.reconcilePrefs();
      await this.ensureRegistration();
    });
  }

  private async reconcilePrefs(): Promise<void> {
    const hosts = this.prefs.hosts.filter((h) => this.isHostGrantedSync(h));
    let scopeMode = this.prefs.scopeMode;
    if ((scopeMode === 'site' && hosts.length === 0) || (scopeMode === 'all-sites' && !this.grantedAllSites)) scopeMode = 'off';
    this.prefs = { v: 1, hosts, scopeMode };
    await this.api.storage.local.set({ [SCOPE_PREFS_KEY]: this.prefs });
  }

  get registrationHealthy(): boolean {
    return this.registrationOk;
  }

  private noteRegistered(matches: readonly string[]): void {
    this.registeredMatches = [...matches];
    this.registeredAt = this.clock.now();
  }

  /** Re-reads the browser's registration (throttled). Never throws; an API failure counts as "nothing registered". */
  async refreshRegistration(): Promise<void> {
    const now = this.clock.now();
    if (now - this.registeredAt < REGISTRATION_CACHE_MS) return;
    this.registeredAt = now;
    try {
      const existing = await this.api.scripting.getRegisteredContentScripts({ ids: [ISOLATED_SCRIPT_ID, MAIN_SCRIPT_ID] });
      const isolated = existing.find((s) => s.id === ISOLATED_SCRIPT_ID)?.matches ?? [];
      const main = existing.find((s) => s.id === MAIN_SCRIPT_ID)?.matches ?? [];
      this.registeredMatches = existing.length === 2 ? main.filter((p) => isolated.includes(p)) : [];
    } catch {
      this.registeredMatches = [];
    }
  }

  /** Both detector scripts are registered for the host: sensors were injected at document_start (REQ-006). */
  sensorsRegisteredFor(host: string, scheme?: 'http' | 'https'): boolean {
    if (!this.consentAccepted) return false;
    for (const p of this.registeredMatches) {
      if (!patternCoversHost(p, host)) continue;
      if (scheme === undefined || p === '<all_urls>' || p.startsWith('*://') || p.startsWith(scheme + '://')) return true;
    }
    return false;
  }

  /** Individually granted patterns selected by the current scope. */
  desiredMatches(): string[] {
    if (!this.consentAccepted) return [];
    const out: string[] = [];
    if (this.prefs.scopeMode === 'all-sites' && this.grantedAllSites) out.push(...ALL_SITES_PATTERNS);
    else if (this.prefs.scopeMode === 'site') {
      for (const h of this.prefs.hosts) for (const p of hostPatterns(h)) {
        if (this.grantedOrigins.some((g) => (g === '<all_urls>' || g.startsWith('*://') || g.startsWith(p.slice(0, p.indexOf('://') + 3))) && patternCoversHost(g, h))) out.push(p);
      }
    }
    return out;
  }

  private async contains(origins: string[]): Promise<boolean> {
    try {
      return await this.api.permissions.contains({ origins });
    } catch {
      return false;
    }
  }

  private buildScripts(matches: string[], withFallback: boolean): RegisteredContentScriptLike[] {
    const base = { matches, allFrames: true, runAt: 'document_start' as const, persistAcrossSessions: true };
    const fallback = withFallback ? { matchOriginAsFallback: true } : {};
    return [
      { id: ISOLATED_SCRIPT_ID, js: [ISOLATED_SCRIPT_FILE], world: 'ISOLATED', ...base, ...fallback },
      { id: MAIN_SCRIPT_ID, js: [EARLY_MAIN_SCRIPT_FILE], world: 'MAIN', ...base, ...fallback },
    ];
  }

  /** Registers/updates/unregisters detector-isolated-v1 + detector-main-v1 to match the desired scope. */
  ensureRegistration(): Promise<void> {
    this.registrationDirty = true;
    if (this.registrationRunning !== null) return this.registrationRunning;
    this.registrationRunning = (async () => {
      for (let pass = 0; pass < 3 && this.registrationDirty; pass++) {
        this.registrationDirty = false;
        await this.reconcileRegistration();
      }
      if (this.registrationDirty) this.registrationOk = false;
    })().finally(() => { this.registrationRunning = null; });
    return this.registrationRunning;
  }

  private async reconcileRegistration(): Promise<void> {
    const ids = [ISOLATED_SCRIPT_ID, MAIN_SCRIPT_ID];
    const matches = this.desiredMatches();
    try {
      const existing = await this.api.scripting.getRegisteredContentScripts({ ids });
      if (matches.length === 0) {
        if (existing.length > 0) await this.api.scripting.unregisterContentScripts({ ids: existing.map((script) => script.id) });
        this.registrationOk = true;
        this.noteRegistered([]);
        return;
      }
      const useUpdate = existing.length === ids.length;
      if (!useUpdate && existing.length > 0) await this.api.scripting.unregisterContentScripts({ ids: existing.map((script) => script.id) });
      const withFallback = this.matchOriginAsFallbackSupported !== false;
      try {
        const scripts = this.buildScripts(matches, withFallback);
        if (useUpdate) await this.api.scripting.updateContentScripts(scripts);
        else await this.api.scripting.registerContentScripts(scripts);
        if (withFallback) this.matchOriginAsFallbackSupported = true;
      } catch (e) {
        // Feature detection: older builds reject the unknown property; retry without it.
        const message = e instanceof Error ? e.message : String(e);
        if (!withFallback || !/matchOriginAsFallback/.test(message)) throw e;
        this.matchOriginAsFallbackSupported = false;
        const scripts = this.buildScripts(matches, false);
        if (useUpdate) await this.api.scripting.updateContentScripts(scripts);
        else await this.api.scripting.registerContentScripts(scripts);
      }
      this.registrationOk = true;
      this.noteRegistered(matches);
    } catch {
      this.registrationOk = false;
      this.noteRegistered([]);
    }
  }
}
