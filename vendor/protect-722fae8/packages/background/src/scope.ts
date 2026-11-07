// Scope modes and permission reactions (spec A3, ADR-003, E06-02). The SW never calls permissions.request
// (it needs a user gesture in an extension page): the popup calls `requestScopeAccess`, then sends
// `ui-set-scope`; the SW verifies with permissions.contains and (un)registers content scripts.
// Preferences live in storage.local (ADR-007 §4); reports never do.

import { BUDGETS, SCOPE_MODES, isSanitizedHost } from '@detect-expert/contracts';
import type { ScopeMode, SensorId, UiSetScopeRequest } from '@detect-expert/contracts';
import type { BackgroundChromeApi, Clock, PermissionsLike, RegisteredContentScriptLike } from './chrome-api';
import { isSensorId, inRegistryOrder } from './sensors';

export const SCOPE_PREFS_KEY = 'scope';
export const ACTIVE_TABS_KEY = 'active-tabs';
interface ActiveGrant { documentId: string }

export const ISOLATED_SCRIPT_ID = 'detector-isolated-v1';
export const MAIN_SCRIPT_ID = 'detector-main-v1';
export const ISOLATED_SCRIPT_FILE = 'bridge.js';
export const MAIN_SCRIPT_FILE = 'hook.main.js';
export const EARLY_MAIN_SCRIPT_FILE = 'hook.early.js';
/** ADR-019 (S11): MAIN policy prelude, always the first MAIN file. */
export const SENSOR_POLICY_FILE = 'sensor-policy.js';

/** ADR-019: prelude file that sets the off bit of one family (built per SENSOR_IDS entry by scripts/build.mjs). */
export function sensorOffFile(id: SensorId): string {
  return 'sensor-off.' + id + '.js';
}

/**
 * ADR-019 (S11): the MAIN files of one document, in order: the policy record, one off file per disabled family,
 * then the sensor bundle (hook.early.js for the document_start registration, hook.main.js for a late injection).
 */
export function mainFiles(early: boolean, off: readonly SensorId[]): string[] {
  return [SENSOR_POLICY_FILE, ...inRegistryOrder(off).map(sensorOffFile), early ? EARLY_MAIN_SCRIPT_FILE : MAIN_SCRIPT_FILE];
}

const SENSOR_OFF_FILE_RE = /^sensor-off\.([a-z][a-z0-9-]{0,63})\.js$/;

/**
 * The off set a registered MAIN js list installs, or null when the list has no policy prelude (an older registration)
 * or is not a list mainFiles() produces. null means "the sensor bundle finds no record and installs nothing".
 */
export function parseMainFiles(js: readonly string[] | undefined): SensorId[] | null {
  if (!Array.isArray(js) || js.length < 2 || js[0] !== SENSOR_POLICY_FILE) return null;
  const last = js[js.length - 1];
  if (last !== EARLY_MAIN_SCRIPT_FILE && last !== MAIN_SCRIPT_FILE) return null;
  const off: SensorId[] = [];
  for (let i = 1; i < js.length - 1; i++) {
    const id = SENSOR_OFF_FILE_RE.exec(js[i] ?? '')?.[1];
    if (!isSensorId(id) || off.includes(id)) return null;
    off.push(id);
  }
  return inRegistryOrder(off);
}

/** Result of a late injection: which families were injected as disabled (exact, ADR-019). */
export interface InjectResult {
  ok: boolean;
  off: SensorId[];
}

/** Scope fields of ScopeState; the runtime adds sensorSettings (ADR-019). */
export interface ScopeCoreState {
  scopeMode: ScopeMode;
  hosts: string[];
  grantedAllSites: boolean;
  managed: boolean;
}
export const ALL_SITES_PATTERNS: readonly string[] = ['http://*/*', 'https://*/*'];
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

// Match-pattern host test for the subset Chrome grants here: <all_urls>, wildcard-host patterns
// (scheme://*/path), exact host patterns (scheme://host/path) and subdomain patterns (scheme://*.suffix/path).
export function patternCoversHost(pattern: string, host: string): boolean {
  if (pattern === '<all_urls>') return true;
  const schemeEnd = pattern.indexOf('://');
  if (schemeEnd <= 0) return false;
  const scheme = pattern.slice(0, schemeEnd);
  if (scheme !== '*' && scheme !== 'http' && scheme !== 'https') return false;
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
    if (scopeMode === 'all-sites') return await permissions.request({ origins: [...ALL_SITES_PATTERNS] });
    if (scopeMode === 'site') {
      if (!isSanitizedHost(host)) return false;
      return await permissions.request({ origins: hostPatterns(host) });
    }
    return true;
  } catch {
    return false;
  }
}

export type SetScopeResult = { ok: true; scope: ScopeCoreState } | { ok: false; code: 'no-access' };

export class ScopeController {
  private prefs: ScopePrefs = { v: 1, scopeMode: 'off', hosts: [] };
  /** Origin patterns the browser reports as granted (permissions.getAll). */
  private grantedOrigins: string[] = [];
  private grantedAllSites = false;
  /** Static host_permissions from the manifest that are actually granted (test profile only). */
  private staticPatterns: string[] = [];
  /** Successful activeTab injection, bounded by trusted tab/document identity (F003/F110). */
  private readonly activeTabs = new Map<number, ActiveGrant>();
  private readonly containsCache = new Map<string, { granted: boolean; at: number }>();
  private matchOriginAsFallbackSupported: boolean | null = null;
  private registrationOk = true;
  /** Match patterns the browser reports for BOTH detector scripts; [] when either is missing. */
  private registeredMatches: string[] = [];
  /** ADR-019: off set of the registered MAIN prelude; null = no registration or one without the prelude. */
  private registeredOffSet: SensorId[] | null = null;
  private registeredAt = 0;
  private mutationChain: Promise<unknown> = Promise.resolve();
  private registrationRunning: Promise<void> | null = null;
  private registrationDirty = false;
  private activeSaveChain: Promise<void> = Promise.resolve();
  /** Review W3 (ADR-020): called after detector-*-v1 were registered or updated (both move them last). Never awaited. */
  private mainRegisteredListener: (() => void) | null = null;

  /** Review W3: the module «Защита» re-registers its MAIN script after ours (execution order follows it). One listener. */
  onMainRegistered(listener: (() => void) | null): void {
    this.mainRegisteredListener = listener;
  }

  private notifyMainRegistered(): void {
    try {
      this.mainRegisteredListener?.();
    } catch {
      // A failing listener never affects observation's registration.
    }
  }

  accessGeneration = 0;
  private accessMutations = 0;
  get accessReady(): boolean { return this.accessMutations === 0; }

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
    /** ADR-019: effective disabled sensor families (SensorPolicyController.effectiveOff). */
    private readonly sensorsOff: () => readonly SensorId[] = () => [],
  ) {}

  /** ADR-019: the off set the browser's MAIN registration installs (refreshed with the registration). */
  get registeredOff(): SensorId[] | null {
    return this.registeredOffSet === null ? null : [...this.registeredOffSet];
  }

  async load(): Promise<void> {
    try {
      const items = await this.api.storage.local.get(SCOPE_PREFS_KEY);
      this.prefs = readPrefs(items[SCOPE_PREFS_KEY]);
    } catch {
      this.prefs = { v: 1, scopeMode: 'off', hosts: [] };
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
  }

  /** Startup: load prefs, verify grants, reconcile registrations (static test grants included). */
  async startup(): Promise<void> {
    await this.serialize(async () => {
      await this.load();
      const saved = await this.api.storage.local.get(SCOPE_PREFS_KEY);
      if (saved[SCOPE_PREFS_KEY] === undefined && this.testBootstrap && this.staticPatterns.length > 0) {
        const hosts = this.staticPatterns.map((p) => p.slice(p.indexOf('://') + 3, -2)).filter(isSanitizedHost);
        this.prefs = { v: 1, scopeMode: 'site', hosts };
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
      await this.ensureRegistration();
    });
  }

  getScopeMode(): ScopeMode {
    return this.prefs.scopeMode;
  }

  getState(): ScopeCoreState {
    return { scopeMode: this.prefs.scopeMode, hosts: [...this.prefs.hosts], grantedAllSites: this.grantedAllSites, managed: false };
  }

  /** Guard for the network observer: no host access at all means nothing to attribute. */
  hasAnyHostAccess(): boolean {
    return this.desiredMatches().length > 0 || (this.prefs.scopeMode === 'active-tab' && this.activeTabs.size > 0);
  }

  /**
   * S07 / ADR-018: only all-sites with the broad grant actually given lets webRequest see every target of a document.
   * In active-tab and site modes requests to hosts outside the grants are invisible ('network-limited').
   */
  networkUnrestricted(): boolean {
    return this.prefs.scopeMode === 'all-sites' && this.grantedAllSites;
  }

  /**
   * S07 / ADR-018: may this request be observed? Scheme families come from requestScheme (ws/wss -> http/https).
   * active-tab: the tab's captured document only (Chrome's activeTab delivery to webRequest is a candidate fact).
   * site / all-sites: Chrome needs host access to BOTH the target and the initiator; both are checked explicitly.
   * The document's own scope membership is checked separately (runtime.networkDocumentKey).
   */
  networkRequestAllowed(
    tabId: number,
    documentId: string | null,
    host: string,
    scheme: 'http' | 'https' | null,
    initiatorHost: string,
    initiatorScheme: 'http' | 'https' | null,
  ): boolean {
    if (scheme === null || initiatorScheme === null || documentId === null) return false;
    switch (this.prefs.scopeMode) {
      case 'off':
        return false;
      case 'active-tab':
        return this.isTabActiveTabGranted(tabId, initiatorHost, documentId);
      case 'site':
      case 'all-sites':
        return this.isHostGrantedSync(host, scheme) && this.isHostGrantedSync(initiatorHost, initiatorScheme);
    }
  }

  isHostGrantedSync(host: string, scheme?: 'http' | 'https'): boolean {
    for (const p of this.grantedOrigins) if (patternCoversHost(p, host) && (scheme === undefined || p === '<all_urls>' || p.startsWith('*://') || p.startsWith(scheme + '://'))) return true;
    return false;
  }

  isTabActiveTabGranted(tabId: number, host: string | null, documentId?: string): boolean {
    const grant = this.activeTabs.get(tabId);
    return this.prefs.scopeMode === 'active-tab' && host !== null && grant !== undefined &&
      documentId !== undefined && grant.documentId === documentId;
  }

  // REQ-012: retained browser permissions never override the user's selected scope.
  inScope(host: string | null, tabId: number, documentId?: string, scheme?: 'http' | 'https'): boolean {
    if (host === null) return false;
    if (this.isTabActiveTabGranted(tabId, host, documentId)) return true;
    if (this.prefs.scopeMode === 'all-sites') return this.grantedAllSites;
    if (this.prefs.scopeMode === 'site') return this.prefs.hosts.includes(host) && this.isHostGrantedSync(host, scheme);
    return false;
  }

  /** ScopeAccess for sender verification: activeTab set, then permissions.contains (cached briefly). */
  async isGranted(originPattern: string, tabId: number, documentId?: string): Promise<boolean> {
    await this.mutationChain;
    const host = originPattern.slice(originPattern.indexOf('://') + 3, originPattern.length - 2);
    if (!this.inScope(host, tabId, documentId)) return false;
    if (this.isTabActiveTabGranted(tabId, host, documentId)) return true;
    const now = this.clock.now();
    const cacheKey = documentId === undefined ? null : String(tabId) + ':' + documentId;
    const cached = cacheKey === null ? undefined : this.containsCache.get(cacheKey);
    if (cached !== undefined && now - cached.at < CONTAINS_CACHE_MS) return cached.granted;
    const granted = await this.api.permissions.contains({ origins: [originPattern] });
    if (this.containsCache.size >= MAX_CONTAINS_CACHE) this.containsCache.clear();
    if (cacheKey !== null) this.containsCache.set(cacheKey, { granted, at: now });
    return granted;
  }

  /** SW side of ui-set-scope: verifies the permission is already granted, persists prefs, (un)registers. */
  setScope(request: UiSetScopeRequest): Promise<SetScopeResult> {
    return this.serialize(() => this.setScopeNow(request));
  }

  private async setScopeNow(request: UiSetScopeRequest): Promise<SetScopeResult> {
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
      await this.api.storage.local.set({ [SCOPE_PREFS_KEY]: this.prefs });
    } catch {
      // Preferences are a convenience; the in-memory scope still applies for this SW lifetime.
    }
    await this.refreshGrants();
    await this.ensureRegistration();
    return { ok: true, scope: this.getState() };
  }

  /**
   * S12 / ADR-003 v3 (ui-remove-site): the host leaves the site list; `site` with an empty list becomes `off`, other
   * modes stay. The registration narrows at once. Idempotent: an unknown host only re-applies the current state.
   * Revoking the browser grant is a separate chrome.permissions.remove of the UI page.
   */
  removeSite(host: string): Promise<ScopeCoreState> {
    return this.serialize(async () => {
      this.containsCache.clear();
      const hosts = this.prefs.hosts.filter((h) => h !== host);
      const scopeMode: ScopeMode = this.prefs.scopeMode === 'site' && hosts.length === 0 ? 'off' : this.prefs.scopeMode;
      this.prefs = { v: 1, scopeMode, hosts };
      try {
        await this.api.storage.local.set({ [SCOPE_PREFS_KEY]: this.prefs });
      } catch {
        // Preferences are a convenience; the in-memory scope still applies for this SW lifetime.
      }
      await this.refreshGrants();
      await this.ensureRegistration();
      return this.getState();
    });
  }

  /**
   * active-tab mode: late injection of both worlds into the tab the popup was opened on (activeTab grant). The MAIN
   * files carry the current policy prelude (ADR-019); `off` is exactly the set injected as disabled.
   */
  async injectWithPolicy(tabId: number, host: string | null, documentId?: string): Promise<InjectResult> {
    const off = inRegistryOrder(this.sensorsOff());
    const ok = await this.serialize(() => this.injectNowCurrent(tabId, host, off, documentId));
    return { ok, off };
  }

  /** Boolean form of injectWithPolicy (pre-S11 callers). */
  async injectNow(tabId: number, host: string | null, documentId?: string): Promise<boolean> {
    return (await this.injectWithPolicy(tabId, host, documentId)).ok;
  }

  private async injectNowCurrent(tabId: number, host: string | null, off: readonly SensorId[], documentId?: string): Promise<boolean> {
    if (host === null || documentId === undefined) return false;
    try {
      await this.api.scripting.executeScript({
        target: { tabId, documentIds: [documentId] },
        files: [ISOLATED_SCRIPT_FILE],
        world: 'ISOLATED',
        injectImmediately: true,
      });
      await this.api.scripting.executeScript({
        target: { tabId, documentIds: [documentId] },
        files: mainFiles(false, off),
        world: 'MAIN',
        injectImmediately: true,
      });
    } catch {
      return false;
    }
    const current = (await this.api.webNavigation.getAllFrames({ tabId }))?.find((f) => f.frameId === 0);
    if (current?.documentId !== documentId) return false;
    const previousGrant = this.activeTabs.get(tabId);
    this.activeTabs.delete(tabId);
    if (this.activeTabs.size >= BUDGETS.maxHostsPerDocument) return false;
    this.activeTabs.set(tabId, { documentId });
    const previous = this.prefs;
    this.prefs = { ...this.prefs, scopeMode: 'active-tab' };
    try {
      await this.api.storage.local.set({ [SCOPE_PREFS_KEY]: this.prefs });
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

  private noteRegistered(matches: readonly string[], off: readonly SensorId[] | null): void {
    this.registeredMatches = [...matches];
    this.registeredOffSet = matches.length === 0 || off === null ? null : inRegistryOrder(off);
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
      const mainScript = existing.find((s) => s.id === MAIN_SCRIPT_ID);
      const main = mainScript?.matches ?? [];
      this.registeredMatches = existing.length === 2 ? main.filter((p) => isolated.includes(p)) : [];
      this.registeredOffSet = this.registeredMatches.length === 0 ? null : parseMainFiles(mainScript?.js);
    } catch {
      this.registeredMatches = [];
      this.registeredOffSet = null;
    }
  }

  /** Both detector scripts are registered for the host: sensors were injected at document_start (REQ-006). */
  sensorsRegisteredFor(host: string, scheme?: 'http' | 'https'): boolean {
    for (const p of this.registeredMatches) {
      if (!patternCoversHost(p, host)) continue;
      if (scheme === undefined || p === '<all_urls>' || p.startsWith('*://') || p.startsWith(scheme + '://')) return true;
    }
    return false;
  }

  /** Individually granted patterns selected by the current scope. */
  desiredMatches(): string[] {
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

  private buildScripts(matches: string[], withFallback: boolean, off: readonly SensorId[]): RegisteredContentScriptLike[] {
    const base = { matches, allFrames: true, runAt: 'document_start' as const, persistAcrossSessions: true };
    const fallback = withFallback ? { matchOriginAsFallback: true } : {};
    return [
      { id: ISOLATED_SCRIPT_ID, js: [ISOLATED_SCRIPT_FILE], world: 'ISOLATED', ...base, ...fallback },
      // ADR-019: one registration, several files in order (policy record, off bits, sensor bundle).
      { id: MAIN_SCRIPT_ID, js: mainFiles(true, off), world: 'MAIN', ...base, ...fallback },
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
    const off = inRegistryOrder(this.sensorsOff());
    try {
      const existing = await this.api.scripting.getRegisteredContentScripts({ ids });
      if (matches.length === 0) {
        if (existing.length > 0) await this.api.scripting.unregisterContentScripts({ ids: existing.map((script) => script.id) });
        this.registrationOk = true;
        this.noteRegistered([], null);
        return;
      }
      const useUpdate = existing.length === ids.length;
      if (!useUpdate && existing.length > 0) await this.api.scripting.unregisterContentScripts({ ids: existing.map((script) => script.id) });
      const withFallback = this.matchOriginAsFallbackSupported !== false;
      try {
        const scripts = this.buildScripts(matches, withFallback, off);
        if (useUpdate) await this.api.scripting.updateContentScripts(scripts);
        else await this.api.scripting.registerContentScripts(scripts);
        if (withFallback) this.matchOriginAsFallbackSupported = true;
      } catch (e) {
        // Feature detection: older builds reject the unknown property; retry without it.
        const message = e instanceof Error ? e.message : String(e);
        if (!withFallback || !/matchOriginAsFallback/.test(message)) throw e;
        this.matchOriginAsFallbackSupported = false;
        const scripts = this.buildScripts(matches, false, off);
        if (useUpdate) await this.api.scripting.updateContentScripts(scripts);
        else await this.api.scripting.registerContentScripts(scripts);
      }
      this.registrationOk = true;
      this.noteRegistered(matches, off);
      // Also after an update: Chrome moves updated scripts behind the others (e2e, review W3).
      this.notifyMainRegistered();
    } catch {
      this.registrationOk = false;
      this.noteRegistered([], null);
    }
  }
}
