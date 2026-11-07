// ADR-020 §C, §7 (S04): the only writer of declarativeNetRequest rules (with chrome-api.ts the only files naming the
// API, scripts/code-checks.mjs). The namespace exists only after the optional declarativeNetRequestWithHostAccess
// grant, so it is read lazily on every call. Each write: every rule passes assertAllowedRule, the module's id range is
// replaced atomically (one update call), the call is bounded by a 5 s timeout (SP-1: writes hang until the extension
// reloads after a runtime grant) and never retried in a loop: one attempt per trigger, a hung write blocks new writes.

import { DNR_RANGE_NAMES, DNR_RULE_IDS, PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { DnrRangeName, EnforcementDegraded, ProtectFeature } from '@detect-expert/contracts';
import { assertAllowedRule } from '@detect-expert/engine';
import type { AllowedDnrRule } from '@detect-expert/engine';
import type { BackgroundChromeApi, DnrLike, DnrRuleLike } from '../chrome-api';

export const DNR_WRITE_TIMEOUT_MS = 5000;
/**
 * Review W2: removeAllOurs() waits at most this long for a write in flight (a lane rebuild) to settle before it reads
 * our ids; otherwise that write lands after the read and its rules stay. A write hung by SP-1 does not settle: the
 * answer is then 'cleanup-pending', as before.
 */
export const DNR_PENDING_SETTLE_MS = 1000;

export type DnrApplyResult = { ok: true; changed: boolean } | { ok: false; code: EnforcementDegraded };

/** Where the applied-rule hashes live (doc-store `protect-runtime`); injected so the port has no storage of its own. */
export interface DnrHashStore {
  get(range: DnrRangeName): string | null;
  set(range: DnrRangeName, hash: string | null): void;
}

class DnrTimeout extends Error {}

function inRange(id: number, range: DnrRangeName): boolean {
  const [lo, hi] = DNR_RULE_IDS[range];
  return id >= lo && id <= hi;
}

function rangeBudget(range: DnrRangeName): number {
  switch (range) {
    case 'gpc': return DNR_RULE_IDS.gpc[1] - DNR_RULE_IDS.gpc[0] + 1;
    case 'decisions': return PROTECT_BUDGETS.maxDecisions;
    case 'preset': return PROTECT_BUDGETS.maxPresetEntries;
    case 'session': return PROTECT_BUDGETS.maxSessionRules;
  }
}

/** FNV-1a 32 of a deterministic rendering of the rules (ids ascending). Change detection only. */
export function hashRules(rules: readonly AllowedDnrRule[]): string {
  const text = [...rules].sort((a, b) => a.id - b.id).map((r) => JSON.stringify(r)).join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + ':' + String(rules.length);
}

export class DnrPort {
  private writePending = false;
  /** Settles when the write in flight settles (resolved when none). */
  private pendingSettled: Promise<void> = Promise.resolve();
  private lastDegraded: EnforcementDegraded | null = null;
  private writes = 0;
  private failures = 0;

  constructor(
    private readonly api: BackgroundChromeApi,
    private readonly hashes: DnrHashStore,
    private readonly timeoutMs = DNR_WRITE_TIMEOUT_MS,
  ) {}

  /** The namespace as Chrome exposes it right now (only after the grant), or null. Never throws. */
  private ns(): DnrLike | null {
    try {
      const ns = this.api.declarativeNetRequest;
      return typeof ns === 'object' && ns !== null ? ns : null;
    } catch {
      return null;
    }
  }

  available(): boolean {
    return this.ns() !== null;
  }

  /** Last write failure (null after a successful write). */
  get degraded(): EnforcementDegraded | null {
    return this.lastDegraded;
  }

  /** Effective rule limits: the smaller of Chrome's constants and the module budgets. */
  limits(): { dynamic: number; session: number } {
    const ns = this.ns();
    const chromeDynamic = typeof ns?.MAX_NUMBER_OF_DYNAMIC_RULES === 'number' ? ns.MAX_NUMBER_OF_DYNAMIC_RULES : Number.POSITIVE_INFINITY;
    const chromeSession = typeof ns?.MAX_NUMBER_OF_SESSION_RULES === 'number' ? ns.MAX_NUMBER_OF_SESSION_RULES : Number.POSITIVE_INFINITY;
    return { dynamic: Math.min(chromeDynamic, PROTECT_BUDGETS.maxDynamicRules), session: Math.min(chromeSession, PROTECT_BUDGETS.maxSessionRules) };
  }

  /** topDomains support (RuleConditionKeys lists it); otherwise site rules fall back to initiatorDomains. */
  features(): { topDomains: boolean } {
    try {
      const keys = this.ns()?.RuleConditionKeys;
      if (typeof keys !== 'object' || keys === null) return { topDomains: false };
      return { topDomains: Object.values(keys as Record<string, unknown>).includes('topDomains') };
    } catch {
      return { topDomains: false };
    }
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DnrTimeout('dnr timeout')), this.timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  private failed(e: unknown): DnrApplyResult {
    this.failures++;
    let code: EnforcementDegraded;
    if (e instanceof DnrTimeout) code = 'api-unavailable';
    else {
      const message = e instanceof Error ? e.message : String(e);
      if (/not available|undefined|permission/i.test(message)) code = 'api-unavailable';
      else if (/limit|exceed|maximum/i.test(message)) code = 'rule-limit';
      else code = 'update-rejected';
    }
    this.lastDegraded = code;
    return { ok: false, code };
  }

  /** Our rule ids currently in `range` (dynamic or session), or throws. */
  private async readIds(ns: DnrLike, range: DnrRangeName): Promise<number[]> {
    const rules = await this.withTimeout(range === 'session' ? ns.getSessionRules() : ns.getDynamicRules());
    return rules.map((r) => r.id).filter((id) => inRange(id, range));
  }

  /** Read-back of our rules (S13 verifies the GPC rule). Null when unavailable. */
  async readRules(range: DnrRangeName): Promise<DnrRuleLike[] | null> {
    const ns = this.ns();
    if (ns === null) return null;
    try {
      const rules = await this.withTimeout(range === 'session' ? ns.getSessionRules() : ns.getDynamicRules());
      return rules.filter((r) => inRange(r.id, range));
    } catch {
      return null;
    }
  }

  private validate(range: DnrRangeName, desired: readonly AllowedDnrRule[]): EnforcementDegraded | null {
    if (desired.length > rangeBudget(range)) return 'rule-limit';
    const limits = this.limits();
    if (desired.length > (range === 'session' ? limits.session : limits.dynamic)) return 'rule-limit';
    const ids = new Set<number>();
    for (const rule of desired) {
      try {
        assertAllowedRule(rule);
      } catch {
        return 'update-rejected';
      }
      if (!inRange(rule.id, range) || ids.has(rule.id)) return 'update-rejected';
      ids.add(rule.id);
    }
    return null;
  }

  private async apply(range: DnrRangeName, desired: readonly AllowedDnrRule[]): Promise<DnrApplyResult> {
    const invalid = this.validate(range, desired);
    if (invalid !== null) {
      this.lastDegraded = invalid;
      return { ok: false, code: invalid };
    }
    const ns = this.ns();
    if (ns === null) return this.failed(new Error('not available'));
    if (this.writePending) {
      this.lastDegraded = 'api-unavailable';
      return { ok: false, code: 'api-unavailable' };
    }
    const hash = desired.length === 0 ? null : hashRules(desired);
    try {
      const existing = await this.readIds(ns, range);
      const sameIds = existing.length === desired.length && desired.every((r) => existing.includes(r.id));
      if (sameIds && (desired.length === 0 || this.hashes.get(range) === hash)) {
        this.hashes.set(range, hash);
        this.lastDegraded = null;
        return { ok: true, changed: false };
      }
      const options = { removeRuleIds: existing, addRules: desired.map((r) => ({ ...r })) };
      await this.write(range === 'session' ? ns.updateSessionRules(options) : ns.updateDynamicRules(options));
      this.hashes.set(range, hash);
      this.lastDegraded = null;
      return { ok: true, changed: true };
    } catch (e) {
      return this.failed(e);
    }
  }

  /** One bounded write; a write that outlives the timeout keeps `writePending` until Chrome settles it. */
  private async write(promise: Promise<void>): Promise<void> {
    this.writePending = true;
    this.writes++;
    this.pendingSettled = promise.then(() => { this.writePending = false; }, () => { this.writePending = false; });
    await this.withTimeout(promise);
    this.writePending = false;
  }

  /** Bounded wait for the write in flight (if any) to settle. */
  private async settlePending(ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.pendingSettled, new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); })]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Replaces our rules of a dynamic range (gpc, decisions, preset) with `desired`. */
  applyDynamic(range: Exclude<DnrRangeName, 'session'>, desired: readonly AllowedDnrRule[]): Promise<DnrApplyResult> {
    return this.apply(range, desired);
  }

  /** Replaces our session rules (`once` decisions) with `desired`. */
  applySession(desired: readonly AllowedDnrRule[]): Promise<DnrApplyResult> {
    return this.apply('session', desired);
  }

  /** Empties one of our ranges. */
  clearRange(range: DnrRangeName): Promise<DnrApplyResult> {
    return this.apply(range, []);
  }

  /**
   * Removes every rule in our ranges (dynamic and session), read back from Chrome, regardless of the stored hashes.
   * Without the namespace: nothing can be read; 'cleanup-pending' when we may still have rules (SP-5: rules outlive a
   * removed permission until the next grant), else ok.
   */
  async removeAllOurs(): Promise<DnrApplyResult> {
    const ns = this.ns();
    const known = DNR_RANGE_NAMES.some((r) => this.hashes.get(r) !== null);
    if (ns === null) {
      if (!known) return { ok: true, changed: false };
      this.lastDegraded = 'cleanup-pending';
      return { ok: false, code: 'cleanup-pending' };
    }
    if (this.writePending) await this.settlePending(Math.min(DNR_PENDING_SETTLE_MS, this.timeoutMs));
    if (this.writePending) {
      this.lastDegraded = 'cleanup-pending';
      return { ok: false, code: 'cleanup-pending' };
    }
    try {
      const dynamic = (await this.withTimeout(ns.getDynamicRules())).map((r) => r.id).filter((id) => DNR_RANGE_NAMES.some((n) => n !== 'session' && inRange(id, n)));
      const session = (await this.withTimeout(ns.getSessionRules())).map((r) => r.id).filter((id) => inRange(id, 'session'));
      let changed = false;
      if (dynamic.length > 0) {
        await this.write(ns.updateDynamicRules({ removeRuleIds: dynamic }));
        changed = true;
      }
      if (session.length > 0) {
        await this.write(ns.updateSessionRules({ removeRuleIds: session }));
        changed = true;
      }
      for (const r of DNR_RANGE_NAMES) this.hashes.set(r, null);
      this.lastDegraded = null;
      return { ok: true, changed };
    } catch (e) {
      const result = this.failed(e);
      this.lastDegraded = 'cleanup-pending';
      return result.ok ? result : { ok: false, code: 'cleanup-pending' };
    }
  }

  /**
   * Startup / settings change with the module active: orphans in the ranges of disabled features are removed (gpc
   * range without gpc; decisions, preset and session ranges without firewall). Ranges of enabled features are owned by
   * their lanes, which replace them atomically on start.
   */
  async reconcile(features: readonly ProtectFeature[]): Promise<DnrApplyResult> {
    if (this.ns() === null) return { ok: true, changed: false };
    const ranges: DnrRangeName[] = [];
    if (!features.includes('gpc')) ranges.push('gpc');
    if (!features.includes('firewall')) ranges.push('decisions', 'preset', 'session');
    let changed = false;
    for (const range of ranges) {
      const result = await this.apply(range, []);
      if (!result.ok) return result;
      changed = changed || result.changed;
    }
    return { ok: true, changed };
  }

  debug(): { available: boolean; writePending: boolean; writes: number; failures: number } {
    return { available: this.available(), writePending: this.writePending, writes: this.writes, failures: this.failures };
  }
}
