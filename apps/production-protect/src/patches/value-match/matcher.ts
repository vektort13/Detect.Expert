// ADR-047 adapter copy of 722fae8; audit F2/F3 (2026-10-20): unsafe/truncated structures never enter the token ring.
// ADR-020 §B, §11 (S07): matching of typed-value fingerprints against outgoing requests of armed tabs, synchronously
// inside the webRequest callback. Direct direction: request tokens (and rolling windows for multi-word variants)
// against the tab's fingerprint index. Reverse direction: a new protect-input against the tab's token ring (10 s).
// Opaque bodies towards a third party within opaqueWindowMs of a value change give one `opaque-after-input` (low)
// per change. Every record describes a send that had already started; its delivery comes from the outcome tracker
// (§11: `sent` only after onSendHeaders, `stopped` only through the firewall port, otherwise `unknown`).
// Evidence carries no value, hash, mask, value length, URL or query (ProtectTransferEvidence). A path segment that
// carried a typed value or one of its variants is `:id` in every endpoint template: hits of the request (direct), of
// later fingerprints in the ring (reverse), and of later fingerprints in templates already stored (scrubTemplates).
// Review round 3: the same holds for the other page-controlled strings of a record. A parameter name, a host, a
// literal path segment or the sending script's host / path template that contains a variant of any field of the tab
// (every window of every variant length, as written and lower-cased) is dropped: the name is omitted, the host folds
// into its registrable domain, the segment is `:id`, the script is not named (frame-only) — when the record is made,
// and again for stored records when later fingerprints arrive.

import { MAX_COUNT, PROTECT_BUDGETS, PROTECT_LIMITATIONS, PROTECT_WIRE_LIMITS, SCRIPT_REF_KINDS, VALUE_ENCODINGS, isDomainName, isScriptHost, isScriptPathTemplate } from '@detect-expert/contracts';
import type {
  AttributionConfidence,
  DeliveryState,
  FingerprintEncoding,
  ProtectDropped,
  ProtectEvidence,
  ProtectLimitation,
  ProtectTransferEvidence,
  ScriptRef,
  SinceInput,
  SiteRelation,
  SubmitTiming,
  ValueEncoding,
} from '@detect-expert/contracts';
import {
  FORM_LEAK_RULE_VERSION,
  assessConfidence,
  capConfidence,
  classifyTransfer,
  confidenceCeiling,
  evidenceKey,
  fingerprintKey,
  fpRange,
  isHashEncoding,
  isTokenChar,
  mergeEvidence,
  rollingParams,
  rollingScan,
} from '@detect-expert/engine';
import type { FingerprintKey, RollingParams } from '@detect-expert/engine';
import { endpointHost, joinPathTemplate, pathTemplateParts, registrableDomain } from '@detect-expert/attribution';
import type { Clock, RequestDetailsLike } from '../../../../../vendor/protect-722fae8/packages/background/src/chrome-api';
import { fastHost } from '../../../../../vendor/protect-722fae8/packages/background/src/protect/net-hub';
import type { ProtectRequestContext } from '../../../../../vendor/protect-722fae8/packages/background/src/protect/net-hub';
import type { OutcomeEvent } from '../../../../../vendor/protect-722fae8/packages/background/src/protect/outcomes';
import type { ProtectServiceContext } from '../../../../../vendor/protect-722fae8/packages/background/src/protect/services';
import { siteOfHost } from '../../../../../vendor/protect-722fae8/packages/background/src/protect/tab-model';
import { containerViews, decodeContainer, isContainerCandidate, requestViews, scanTokens } from './decode';
import type { RequestView } from './decode';
import type { FieldRecord, FingerprintStore, IndexRef, TabIndex } from '../../../../../vendor/protect-722fae8/packages/background/src/protect/value-match/fingerprint-store';
import { RingBuilder, findHash, infoLen, infoView } from '../../../../../vendor/protect-722fae8/packages/background/src/protect/value-match/ring';
import type { RequestMeta, RingEntry, TokenRing, ViewMeta } from '../../../../../vendor/protect-722fae8/packages/background/src/protect/value-match/ring';

export interface MatchStats {
  requests: number;
  decoded: number;
  skippedFirstParty: number;
  skippedExcluded: number;
  directMatches: number;
  reverseMatches: number;
  opaqueEvidence: number;
  evidence: number;
  unstored: number;
  tokenBudget: number;
  containers: number;
  ringPushed: number;
  /** Stored records whose template, host or parameter name lost a part to a later value (scrubTemplates). */
  templatesScrubbed: number;
}

export function emptyStats(): MatchStats {
  return { requests: 0, decoded: 0, skippedFirstParty: 0, skippedExcluded: 0, directMatches: 0, reverseMatches: 0, opaqueEvidence: 0, evidence: 0, unstored: 0, tokenBudget: 0, containers: 0, ringPushed: 0, templatesScrubbed: 0 };
}

/** One field matched in one request. */
interface Match {
  view: ViewMeta;
  encodings: Set<ValueEncoding>;
  raw: Set<FingerprintEncoding>;
  /** Phone: digits of the first plain match (counted transiently), -1 when unknown. */
  digits: number;
}

interface PendingRef {
  storeKey: string;
  tabId: number;
  key: string;
}

const EMPTY_DROPPED: ProtectDropped = { evidence: 0, fingerprints: 0, bodies: 0, events: 0 };
const SCRIPT_KIND_SET: ReadonlySet<string> = new Set(SCRIPT_REF_KINDS);

function canonicalLimitations(list: Iterable<ProtectLimitation>, max: number): ProtectLimitation[] {
  const set = new Set(list);
  return PROTECT_LIMITATIONS.filter((l) => set.has(l)).slice(0, max);
}

/** Encodings in canonical order, hashes kept first when more than maxEvidenceEncodings were found. */
function canonicalEncodings(set: ReadonlySet<ValueEncoding>): ValueEncoding[] {
  const all = VALUE_ENCODINGS.filter((e) => set.has(e));
  if (all.length <= PROTECT_WIRE_LIMITS.maxEvidenceEncodings) return all;
  const keep = new Set([...all.filter(isHashEncoding), ...all.filter((e) => !isHashEncoding(e))].slice(0, PROTECT_WIRE_LIMITS.maxEvidenceEncodings));
  return all.filter((e) => keep.has(e));
}

export function sinceInputOf(ms: number): SinceInput {
  if (ms < 1000) return 'lt-1s';
  if (ms < 5000) return '1-5s';
  if (ms < 30000) return '5-30s';
  return 'gt-30s';
}

function countDigits(text: string, start: number, end: number): number {
  let n = 0;
  for (let i = start; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c >= 48 && c <= 57) n++;
  }
  return n;
}

function viewMeta(v: RequestView): ViewMeta {
  return { location: v.location, paramName: v.paramName, pathSegment: v.pathSegment, urlDecoded: v.urlDecoded, container: v.container };
}

/** A hit in a path view (or in a Base64 container of one): that segment is `:id` in every template of the request. */
function maskPath(meta: RequestMeta, view: ViewMeta): void {
  if (view.location === 'path' && view.pathSegment !== null && view.pathSegment < meta.pathParts.segments.length) meta.maskedSegments.add(view.pathSegment);
}

function isTransferEvidence(e: ProtectEvidence): e is ProtectTransferEvidence {
  return e.protectKind === 'value-match' || e.protectKind === 'opaque-after-input';
}

/** Fingerprints by variant length (scrub of stored templates). */
type HashesByLen = ReadonlyMap<number, ReadonlySet<number>>;

/** Some token of `text` (scanTokens, as the matcher tokenizes a view) has one of the fingerprints. */
function textCarries(text: string, key: FingerprintKey, hashes: HashesByLen): boolean {
  let hit = false;
  scanTokens(text, (start, end, lowerHex) => {
    const set = hashes.get(end - start);
    if (set !== undefined && set.has(fpRange(key, text, start, end, lowerHex))) {
      hit = true;
      return false;
    }
    return true;
  });
  return hit;
}

/** Fingerprints a short string is checked against, by variant length: the tab's index, or newly arrived fields. */
export interface VariantLookup {
  readonly lengths: readonly number[];
  has(len: number, h: number): boolean;
}

export function lookupOfIndex(index: TabIndex): VariantLookup {
  return {
    lengths: [...index.lengths],
    has(len, h) {
      const refs = index.byHash.get(h);
      if (refs === undefined) return false;
      for (const r of refs) if (r.entry.len === len) return true;
      return false;
    },
  };
}

export function lookupOfHashes(hashes: HashesByLen): VariantLookup {
  return { lengths: [...hashes.keys()], has: (len, h) => hashes.get(len)?.has(h) === true };
}

/**
 * Some substring of `text`, as written or lower-cased, is a variant of a typed value: every window of every variant
 * length is fingerprinted (rolling, O(length) per variant length). Unlike token matching, a value glued to other
 * characters (`Vasilchikova.em`, `vasilchikova.tracker.example.org`) is found. For short strings only: parameter
 * names (≤ 48), host names (≤ 253) and literal path segments (≤ 32) of a record (review round 3).
 */
export function carriesVariant(text: string, key: FingerprintKey, lookup: VariantLookup, params: (len: number) => RollingParams): boolean {
  const lower = text.toLowerCase();
  for (const form of lower === text ? [text] : [text, lower]) {
    for (const len of lookup.lengths) {
      if (len > form.length) continue;
      let hit = false;
      rollingScan(key, params(len), form, 0, form.length, (_index, value) => {
        if (!lookup.has(len, value)) return true;
        hit = true;
        return false;
      });
      if (hit) return true;
    }
  }
  return false;
}

/** The host or the path template of a script reference carries a variant (`carries`). */
function scriptCarries(script: ScriptRef, carries: (text: string) => boolean): boolean {
  return (script.host !== undefined && carries(script.host)) || (script.pathTemplate !== undefined && carries(script.pathTemplate));
}

/** A host that carried a value: its registrable domain (the party of the record), or null without one. */
function foldedHost(host: string): string | null {
  const registrable = registrableDomain(host);
  return registrable !== null && isDomainName(registrable) ? registrable : null;
}

/**
 * A stored template with every literal segment that carries one of the fingerprints (as a token, inside a Base64
 * container of the segment, or — with `carries` — as any substring) replaced by `:id`; null when nothing changes.
 */
export function scrubTemplate(template: string, key: FingerprintKey, hashes: HashesByLen, carries: ((text: string) => boolean) | null = null): string | null {
  if (template.length <= 1) return null;
  const parts = template.slice(1).split('/');
  let changed = false;
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]!;
    if (seg.length === 0 || seg === ':id' || seg === '…') continue;
    let hit = textCarries(seg, key, hashes) || (carries !== null && carries(seg));
    if (!hit && isContainerCandidate(seg, 0, seg.length)) {
      const inner = decodeContainer(seg, PROTECT_BUDGETS.maxBase64ContainerChars);
      hit = inner !== null && textCarries(inner, key, hashes);
    }
    if (hit) {
      parts[i] = ':id';
      changed = true;
    }
  }
  return changed ? '/' + parts.join('/') : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A ScriptRef from the attribution lane (S10), checked before it enters evidence; null otherwise. */
function checkedScript(v: unknown): ScriptRef | null {
  if (!isRecord(v) || typeof v['kind'] !== 'string' || !SCRIPT_KIND_SET.has(v['kind'])) return null;
  const kind = v['kind'] as ScriptRef['kind'];
  if (kind !== 'external') return Object.keys(v).length === 1 ? { kind } : null;
  const scheme = v['scheme'];
  if ((scheme !== 'http' && scheme !== 'https') || !isScriptHost(v['host']) || !isScriptPathTemplate(v['pathTemplate'])) return null;
  return { kind, scheme, host: v['host'], pathTemplate: v['pathTemplate'] };
}

export class ValueMatcher {
  private readonly tabs = new Map<number, { formPostAt: number | null; bodiesDropped: number }>();
  private readonly pending = new Map<string, { at: number; refs: PendingRef[] }>();
  private readonly builder = new RingBuilder();
  private readonly rollingCache = new Map<number, RollingParams>();
  private rollingKey: FingerprintKey | null = null;
  private idCounter = 0;
  private readonly idPrefix: string;
  /** Lookup of the last tab index used for endpoint checks (an index is rebuilt after every change). */
  private lookupCache: { index: TabIndex; lookup: VariantLookup } | null = null;
  /** The index a request's literal segments and host were last checked against (endpointOf). */
  private readonly checkedMeta = new WeakMap<RequestMeta, TabIndex>();

  constructor(
    private readonly ctx: ProtectServiceContext,
    private readonly store: FingerprintStore,
    private readonly ring: TokenRing,
    readonly stats: MatchStats,
    random: (n: number) => Uint8Array,
  ) {
    const bytes = random(4);
    let p = '';
    for (let i = 0; i < 4; i++) p += (bytes[i]! % 36).toString(36);
    this.idPrefix = p;
  }

  private get clock(): Clock {
    return this.ctx.clock;
  }

  private newEvidenceId(): string {
    this.idCounter = (this.idCounter + 1) % 36 ** 8;
    return 'pe-' + this.idPrefix + this.idCounter.toString(36);
  }

  private tab(tabId: number): { formPostAt: number | null; bodiesDropped: number } {
    let t = this.tabs.get(tabId);
    if (t === undefined) {
      t = { formPostAt: null, bodiesDropped: 0 };
      this.tabs.set(tabId, t);
      if (this.tabs.size > 64) {
        const first = this.tabs.keys().next();
        if (!first.done) this.tabs.delete(first.value);
      }
    }
    return t;
  }

  bodiesDropped(tabId: number): number {
    return this.tabs.get(tabId)?.bodiesDropped ?? 0;
  }

  /**
   * Expired fingerprints, ring entries and pending outcomes go. Driven by events and by the lane's expiry timer
   * (index.ts, review PT-1); `force` skips the ring's 500 ms throttle (the timer).
   */
  sweep(now: number, force = false): void {
    this.store.sweep(now, (site, tabId) => this.ctx.isExcluded(site) || this.ctx.isTabExcluded(tabId));
    this.ring.sweep(now, force);
    for (const [id, p] of this.pending) if (now - p.at > PROTECT_BUDGETS.outcomeTtlMs) this.pending.delete(id);
  }

  forgetTab(tabId: number): void {
    this.tabs.delete(tabId);
    for (const [id, p] of this.pending) if (p.refs.some((r) => r.tabId === tabId)) this.pending.delete(id);
  }

  clear(): void {
    this.tabs.clear();
    this.pending.clear();
  }

  pendingOutcomes(): number {
    return this.pending.size;
  }

  /** Relation to the top-level site; an IP / localhost receiver of the same host as the site is first party. */
  private relationOf(resolved: NonNullable<ProtectRequestContext['resolved']>, url: string): SiteRelation {
    if (resolved.relation !== 'unknown' || resolved.receiver !== null || resolved.topSite === null) return resolved.relation;
    const host = fastHost(url);
    return host !== null && siteOfHost(host.host) === resolved.topSite ? 'same-site' : 'unknown';
  }

  /** The tab's current top-level document is past a submit (boundary or a form POST within submitCarryMs). */
  private tabAfterSubmit(tabId: number, topKey: string | null, now: number): boolean {
    if (topKey !== null) {
      const doc = this.store.document(topKey);
      if (doc !== undefined && doc.submitAt !== null && doc.submitAt <= now) return true;
    }
    const t = this.tabs.get(tabId);
    return t !== undefined && t.formPostAt !== null && now - t.formPostAt <= PROTECT_BUDGETS.submitCarryMs;
  }

  private submitTiming(rec: FieldRecord, meta: RequestMeta, fromPrevious: boolean): SubmitTiming {
    if (meta.formPost) return 'after-submit';
    const doc = this.store.document(rec.documentKey);
    if (doc !== undefined && doc.submitAt !== null && doc.submitAt <= meta.at) return 'after-submit';
    const t = this.tabs.get(rec.tabId);
    if (t !== undefined && t.formPostAt !== null && t.formPostAt <= meta.at && meta.at - t.formPostAt <= PROTECT_BUDGETS.submitCarryMs && t.formPostAt >= rec.capturedAt) return 'after-submit';
    return fromPrevious ? 'unknown' : 'before-submit';
  }

  private attribution(requestId: string | null): { level: AttributionConfidence; script: ScriptRef | null } {
    const port = this.ctx.ports.attribution;
    if (requestId !== null && isRecord(port) && typeof port['attributionFor'] === 'function') {
      try {
        const a: unknown = (port['attributionFor'] as (id: string) => unknown)(requestId);
        if (isRecord(a) && a['attributionConfidence'] === 'sampled-stack') {
          const script = checkedScript(a['script']);
          if (script !== null) return { level: 'sampled-stack', script };
        }
      } catch {
        // The attribution lane is optional; a failure leaves the frame-level attribution.
      }
    }
    return { level: 'frame-only', script: null };
  }

  private buildMeta(details: RequestDetailsLike, r: NonNullable<ProtectRequestContext['resolved']>, relation: SiteRelation, now: number, formPost: boolean): RequestMeta {
    const receiver = r.receiver !== null && isDomainName(r.receiver) ? r.receiver : null;
    return {
      requestId: r.requestId,
      tabId: r.tabId,
      at: now,
      documentKey: r.documentKey,
      storeKey: r.topDocumentKey ?? (r.frameId === 0 ? r.documentKey : null),
      topSite: r.topSite,
      frameContext: r.frameContext,
      frameSite: r.frameContext !== 'top' && r.frameSite !== null && isDomainName(r.frameSite) ? r.frameSite : null,
      receiver,
      receiverCategory: receiver === null ? (r.receiverCategory ?? 'unknown') : null,
      relation,
      method: r.method,
      requestKind: r.requestKind,
      endpointHost: endpointHost(details.url),
      pathParts: pathTemplateParts(details.url),
      maskedSegments: new Set(),
      initiatorSite: r.initiatorSite !== null && isDomainName(r.initiatorSite) ? r.initiatorSite : null,
      formPost,
      limitations: [],
    };
  }

  private rolling(len: number): RollingParams {
    const key = fingerprintKey(this.store.salt);
    if (this.rollingKey !== key) {
      this.rollingCache.clear();
      this.rollingKey = key;
    }
    let p = this.rollingCache.get(len);
    if (p === undefined) {
      p = rollingParams(key, len);
      this.rollingCache.set(len, p);
    }
    return p;
  }

  /** `carriesVariant` against `lookup` with the matcher's rolling parameters. */
  private carrier(lookup: VariantLookup): (text: string) => boolean {
    const key = fingerprintKey(this.store.salt);
    const params = (len: number): RollingParams => this.rolling(len);
    return (text) => carriesVariant(text, key, lookup, params);
  }

  /** `carrier` of a tab index (its lookup is cached until the index is rebuilt). */
  private carrierOf(index: TabIndex): (text: string) => boolean {
    let cached = this.lookupCache;
    if (cached === null || cached.index !== index) {
      cached = { index, lookup: lookupOfIndex(index) };
      this.lookupCache = cached;
    }
    return this.carrier(cached.lookup);
  }

  /**
   * The sending script of a record (S10 port), unless its host or path template carries a variant of a field of the
   * tab: then the record names no script and falls back to the frame (review round 3).
   */
  private scriptOf(tabId: number, attr: { level: AttributionConfidence; script: ScriptRef | null }): { level: AttributionConfidence; script: ScriptRef | null } {
    if (attr.script === null) return attr;
    const index = this.store.index(tabId);
    if (index === null || !scriptCarries(attr.script, this.carrierOf(index))) return attr;
    return { level: 'frame-only', script: null };
  }

  /**
   * Endpoint fields of a record made from `meta` now (REQ-005, ADR-020 §B, review round 3), checked against every field
   * of the tab: a literal path segment that contains a variant becomes `:id` and the host folds into its registrable
   * domain — in `meta` itself, so every later record of the request agrees —, and a parameter name that contains one is
   * omitted. Records made earlier from the request are rewritten by scrubTemplates when the value arrives.
   */
  private endpointOf(meta: RequestMeta, paramName: string | null): { endpointHost: string | null; endpointPathTemplate: string; paramName: string | null } {
    const index = this.store.index(meta.tabId);
    if (index !== null) {
      const carries = this.carrierOf(index);
      if (this.checkedMeta.get(meta) !== index) {
        this.checkedMeta.set(meta, index);
        const segments = meta.pathParts.segments;
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i]!;
          if (seg !== ':id' && !meta.maskedSegments.has(i) && carries(seg)) meta.maskedSegments.add(i);
        }
        if (meta.endpointHost !== null && carries(meta.endpointHost)) meta.endpointHost = foldedHost(meta.endpointHost);
      }
      if (paramName !== null && carries(paramName)) paramName = null;
    }
    return { endpointHost: meta.endpointHost, endpointPathTemplate: joinPathTemplate(meta.pathParts, meta.maskedSegments), paramName };
  }

  /** webRequest.onBeforeRequest of an armed tab (synchronous; the body is used here and dropped). */
  onRequest(details: RequestDetailsLike, request: ProtectRequestContext): void {
    this.stats.requests = Math.min(MAX_COUNT, this.stats.requests + 1);
    if (!Number.isSafeInteger(details.tabId) || details.tabId < 0) return;
    if (typeof details.initiator === 'string' && details.initiator.startsWith('chrome-extension://')) return;
    const r = request.resolved;
    if (r === null) return;
    const now = this.clock.now();
    // Expiry first: an excluded site's fingerprints go at its next event.
    this.sweep(now);
    if (this.ctx.isTabExcluded(r.tabId) || (r.frameSite !== null && this.ctx.isExcluded(r.frameSite))) {
      this.stats.skippedExcluded++;
      return;
    }
    const navigation = details.type === 'main_frame' || details.type === 'sub_frame';
    const formPost = navigation && r.method === 'POST';
    if (formPost && details.type === 'main_frame') this.tab(r.tabId).formPostAt = now;
    const relation = this.relationOf(r, details.url);
    const firstParty = relation === 'same-site' || relation === 'same-origin';
    const topKey = r.topDocumentKey;
    if (firstParty && (formPost || this.tabAfterSubmit(r.tabId, topKey, now))) {
      // The form doing its job (and a same-site sign-in POST): the body is not decoded.
      this.stats.skippedFirstParty++;
      return;
    }
    const index = this.store.index(r.tabId);
    if (index === null && navigation) return;
    const decoded = requestViews(details);
    this.stats.decoded++;
    const meta = this.buildMeta(details, r, relation, now, formPost);
    const views = decoded.views;
    const key = fingerprintKey(this.store.salt);
    const matches = new Map<FieldRecord, Match>();
    const ringOn = !navigation && decoded.ringSafe;
    const builder = this.builder;
    builder.reset();
    let tokens = 0;
    let budgetHit = false;
    let credentialDropped = decoded.credentialDropped;
    let ringSafe = decoded.ringSafe;
    let containers = 0;
    let containerChars = 0;
    const record = (ref: IndexRef, view: ViewMeta, digits: number): void => {
      // Any field's hit (also of an excluded site): the segment never stays a literal in this request's templates.
      maskPath(meta, view);
      let m = matches.get(ref.rec);
      if (m === undefined) {
        m = { view, encodings: new Set(), raw: new Set(), digits: -1 };
        matches.set(ref.rec, m);
      }
      addEncoding(m, ref.entry.enc, view);
      if (m.digits < 0 && digits >= 0) m.digits = digits;
    };
    for (let vi = 0; vi < views.length && !budgetHit; vi++) {
      const view = views[vi]!;
      const text = view.text;
      const vm = viewMeta(view);
      const candidates: Array<[number, number]> = [];
      scanTokens(text, (start, end, lowerHex, kind) => {
        if (++tokens > PROTECT_BUDGETS.maxTokensPerRequest) {
          budgetHit = true;
          return false;
        }
        const len = end - start;
        if (len < PROTECT_WIRE_LIMITS.minFingerprintLen || len > PROTECT_WIRE_LIMITS.maxFingerprintLen) return true;
        const needIndex = index !== null && index.lengths.has(len);
        const needRing = ringOn && !builder.full;
        if (!needIndex && !needRing) {
          if (!view.container && kind !== 'hex' && candidates.length < PROTECT_BUDGETS.maxBase64Containers && isContainerCandidate(text, start, end)) candidates.push([start, end]);
          return true;
        }
        const h = fpRange(key, text, start, end, lowerHex);
        if (needRing) builder.add(h, vi, len);
        let hit = false;
        if (needIndex) {
          const refs = index.byHash.get(h);
          if (refs !== undefined) {
            for (const ref of refs) {
              if (ref.entry.len !== len) continue;
              hit = true;
              record(ref, vm, ref.rec.fieldKind === 'phone' && !isHashEncoding(ref.entry.enc) ? countDigits(text, start, end) : -1);
            }
          }
        }
        if (!hit && !view.container && kind !== 'hex' && candidates.length < PROTECT_BUDGETS.maxBase64Containers && isContainerCandidate(text, start, end)) candidates.push([start, end]);
        return true;
      });
      // One level of Base64 containers (≤ maxBase64Containers, ≤ maxBase64ContainerChars in total).
      for (const [start, end] of candidates) {
        if (containers >= PROTECT_BUDGETS.maxBase64Containers || containerChars + (end - start) > PROTECT_BUDGETS.maxBase64ContainerChars) break;
        containers++;
        containerChars += end - start;
        const inner = decodeContainer(text.slice(start, end), PROTECT_BUDGETS.maxBase64ContainerChars);
        if (inner === null) continue;
        const sink = containerViews(inner, view);
        if (sink.credentialDropped) credentialDropped = true;
        if (!sink.ringSafe) {
          ringSafe = false;
          decoded.limitations.add('body-opaque');
        }
        for (const v of sink.views) views.push(v);
        this.stats.containers++;
      }
    }
    if (budgetHit) {
      decoded.limitations.add('body-truncated');
      ringSafe = false;
      this.stats.tokenBudget++;
    }
    // Multi-word variants: rolling windows over every view (≤ 4 lengths), whole words only.
    if (index !== null && index.rolling.size > 0) {
      for (const [len, refs] of index.rolling) {
        const params = this.rolling(len);
        for (const view of views) {
          const text = view.text;
          if (text.length < len) continue;
          const vm = viewMeta(view);
          rollingScan(key, params, text, 0, text.length, (i, value) => {
            for (const ref of refs) {
              if (ref.entry.h !== value) continue;
              const before = i === 0 || !isTokenChar(text.charCodeAt(i - 1));
              const after = i + len >= text.length || !isTokenChar(text.charCodeAt(i + len));
              if (before && after) record(ref, vm, ref.rec.fieldKind === 'phone' ? countDigits(text, i, i + len) : -1);
            }
            return true;
          });
        }
      }
    }
    if (credentialDropped) decoded.limitations.add('body-had-credential-fields');
    if (decoded.limitations.has('body-truncated')) {
      const t = this.tab(r.tabId);
      t.bodiesDropped = Math.min(MAX_COUNT, t.bodiesDropped + 1);
    }
    meta.limitations = canonicalLimitations(decoded.limitations, PROTECT_WIRE_LIMITS.maxEvidenceLimitations);
    // Token ring (reverse direction): not for navigations nor for requests with credential-named keys.
    let entry: RingEntry | null = null;
    if (ringOn && ringSafe && !credentialDropped) {
      const built = builder.build();
      entry = { meta, views: views.map(viewMeta), hashes: built.hashes, info: built.info, opaque: decoded.opaque, delivery: 'unknown', matched: new Set() };
      this.ring.push(entry, now);
      this.stats.ringPushed++;
    }
    const refs: PendingRef[] = [];
    for (const [rec, m] of matches) {
      entry?.matched.add(fieldKey(rec));
      if (this.ctx.isExcluded(rec.site) || this.ctx.isExcluded(rec.topSite)) continue;
      this.stats.directMatches++;
      const key = this.emitTransfer(meta, rec, m, 'direct', 'unknown');
      if (key !== null) refs.push(key);
    }
    if (decoded.opaque && relation === 'cross-site') {
      for (const rec of this.store.fieldsOfTab(r.tabId)) {
        if (rec.changedAt === null || now - rec.changedAt > PROTECT_BUDGETS.opaqueWindowMs || rec.opaqueReportedSeq === rec.changeSeq) continue;
        if (this.ctx.isExcluded(rec.site) || this.ctx.isExcluded(rec.topSite)) continue;
        rec.opaqueReportedSeq = rec.changeSeq;
        entry?.matched.add(fieldKey(rec));
        const key = this.emitOpaque(meta, rec, sinceInputOf(now - rec.changedAt), 'unknown');
        if (key !== null) refs.push(key);
      }
    }
    if (refs.length > 0 && meta.requestId !== null) {
      this.ctx.outcomes.track(meta.requestId, r.tabId, r.timeStamp);
      this.pending.set(meta.requestId, { at: now, refs });
      if (this.pending.size > PROTECT_BUDGETS.maxPendingOutcomes) {
        const first = this.pending.keys().next();
        if (!first.done) this.pending.delete(first.value);
      }
    }
  }

  /** webRequest.onSendHeaders (every admitted request): a ring entry learns that Chrome sent its request. */
  onSendHeaders(details: RequestDetailsLike): void {
    const id = details.requestId;
    if (typeof id !== 'string') return;
    const entry = this.ring.byRequestId(id);
    if (entry !== undefined && entry.delivery === 'unknown') entry.delivery = 'sent';
  }

  /** Outcome of a tracked request: its records move from `unknown` to the observed delivery state. */
  onOutcome(event: OutcomeEvent): void {
    const p = this.pending.get(event.requestId);
    if (p === undefined) return;
    this.pending.delete(event.requestId);
    const entry = this.ring.byRequestId(event.requestId);
    if (entry !== undefined && event.state !== 'unknown') entry.delivery = event.state;
    if (event.state === 'unknown') return;
    for (const ref of p.refs) this.moveDelivery(ref, event.state);
  }

  private moveDelivery(ref: PendingRef, state: DeliveryState): void {
    let overflow = false;
    this.ctx.docStore.update(ref.storeKey, ref.tabId, 'evidence', (list) => {
      const i = list.findIndex((e) => evidenceKey(e) === ref.key);
      if (i < 0) return list;
      const cur = list[i]!;
      if (cur.protectKind !== 'value-match' && cur.protectKind !== 'opaque-after-input') return list;
      const rest = list.slice();
      if (cur.count <= 1) rest.splice(i, 1);
      else rest[i] = { ...cur, count: cur.count - 1 };
      const moved: ProtectEvidence = { ...cur, count: 1, deliveryState: state };
      const merged = mergeEvidence(rest, moved, EMPTY_DROPPED);
      overflow = merged.budgetExceeded;
      return merged.evidence;
    });
    if (overflow) this.ctx.docStore.update(ref.storeKey, ref.tabId, 'dropped', (d) => ({ ...d, evidence: Math.min(MAX_COUNT, d.evidence + 1) }));
  }

  /**
   * Reverse direction: new fingerprints of a tab against its token ring (requests of the last ringWindowMs), then
   * against the endpoint templates already stored for the tab (scrubTemplates).
   */
  reverse(tabId: number, recs: readonly FieldRecord[], now: number): void {
    if (recs.length === 0) return;
    const entries = this.ring.entries(tabId, now);
    for (const entry of entries) {
      const refs: PendingRef[] = [];
      this.reverseEntry(entry, recs, refs);
      // The request may still be in flight: its outcome moves these records like direct ones.
      const id = entry.meta.requestId;
      if (refs.length > 0 && id !== null && entry.delivery === 'unknown') {
        this.ctx.outcomes.track(id, entry.meta.tabId, entry.meta.at);
        const prev = this.pending.get(id);
        this.pending.set(id, { at: now, refs: [...(prev?.refs ?? []), ...refs] });
      }
    }
    this.scrubTemplates(tabId, recs);
  }

  private reverseEntry(entry: RingEntry, recs: readonly FieldRecord[], refs: PendingRef[]): void {
    // Every hit first: a path segment that carried any of these values is masked before a record is made from this
    // request (also for opaque requests, excluded sites and fields already matched).
    const hits = new Map<FieldRecord, Match>();
    for (const rec of recs) {
      const m = this.entryMatch(entry, rec);
      if (m !== null) hits.set(rec, m);
    }
    for (const rec of recs) {
      const fk = fieldKey(rec);
      if (entry.matched.has(fk)) continue;
      if (this.ctx.isExcluded(rec.site) || this.ctx.isExcluded(rec.topSite)) continue;
      if (entry.opaque) {
        if (entry.meta.relation !== 'cross-site' || rec.changedAt === null || rec.opaqueReportedSeq === rec.changeSeq) continue;
        if (rec.changedAt < entry.meta.at || rec.changedAt - entry.meta.at > PROTECT_BUDGETS.opaqueWindowMs) continue;
        rec.opaqueReportedSeq = rec.changeSeq;
        entry.matched.add(fk);
        const ref = this.emitOpaque(entry.meta, rec, 'before-value', entry.delivery);
        if (ref !== null) refs.push(ref);
        continue;
      }
      const m = hits.get(rec);
      if (m === undefined) continue;
      entry.matched.add(fk);
      this.stats.reverseMatches++;
      const ref = this.emitTransfer(entry.meta, rec, m, 'reverse', entry.delivery);
      if (ref !== null) refs.push(ref);
    }
  }

  /** Hits of one field's fingerprints in a ring entry; path segments that carried it are masked in the entry's meta. */
  private entryMatch(entry: RingEntry, rec: FieldRecord): Match | null {
    let m: Match | null = null;
    for (const e of rec.entries) {
      let idx = findHash(entry.hashes, e.h);
      while (idx >= 0 && idx < entry.hashes.length && entry.hashes[idx] === e.h) {
        const info = entry.info[idx]!;
        const view = entry.views[infoView(info)];
        if (infoLen(info) === e.len && view !== undefined) {
          maskPath(entry.meta, view);
          if (m === null) m = { view, encodings: new Set(), raw: new Set(), digits: -1 };
          addEncoding(m, e.enc, view);
          // The request text is gone: the variant length stands in for the digit count (−1 for a leading '+').
          if (rec.fieldKind === 'phone' && m.digits < 0 && !isHashEncoding(e.enc)) m.digits = Math.max(0, e.len - 1);
        }
        idx++;
      }
    }
    return m;
  }

  /**
   * New fingerprints against the endpoint fields already stored for the tab (REQ-005, ADR-020 §B): a literal segment,
   * a host or a parameter name that carried the value before the SW knew it (an earlier record of the same request, or
   * a request older than the ring) becomes `:id`, the registrable domain, or is omitted (review rounds 1 and 3).
   * Changed records are merged again under their new key; outcome references follow.
   */
  private scrubTemplates(tabId: number, recs: readonly FieldRecord[]): void {
    const hashes = new Map<number, Set<number>>();
    for (const rec of recs) {
      for (const e of rec.entries) {
        let set = hashes.get(e.len);
        if (set === undefined) {
          set = new Set();
          hashes.set(e.len, set);
        }
        set.add(e.h);
      }
    }
    if (hashes.size === 0) return;
    const key = fingerprintKey(this.store.salt);
    const carrier = this.carrier(lookupOfHashes(hashes));
    const carried = new Map<string, boolean>();
    const carries = (text: string): boolean => {
      let out = carried.get(text);
      if (out === undefined) {
        out = carrier(text);
        carried.set(text, out);
      }
      return out;
    };
    const cache = new Map<string, string | null>();
    const scrubbed = (template: string): string | null => {
      let out = cache.get(template);
      if (out === undefined) {
        out = scrubTemplate(template, key, hashes, carries);
        cache.set(template, out);
      }
      return out;
    };
    /** The record with its endpoint fields (and its script) scrubbed, or null when none of them carries a new value. */
    const scrubbedRecord = (e: ProtectEvidence): ProtectTransferEvidence | null => {
      if (!isTransferEvidence(e)) return null;
      const template = scrubbed(e.endpointPathTemplate);
      const host = e.endpointHost !== null && carries(e.endpointHost) ? foldedHost(e.endpointHost) : e.endpointHost;
      const dropName = e.paramName !== undefined && carries(e.paramName);
      const dropScript = e.script !== undefined && scriptCarries(e.script, carries);
      if (template === null && host === e.endpointHost && !dropName && !dropScript) return null;
      const next: ProtectTransferEvidence = { ...e, endpointHost: host, endpointPathTemplate: template ?? e.endpointPathTemplate };
      if (dropName) delete next.paramName;
      if (dropScript) {
        delete next.script;
        next.attributionConfidence = 'frame-only';
      }
      return next;
    };
    const scriptDropped = new Set<string>();
    for (const [docKey, doc] of this.ctx.docStore.docsOfTab(tabId)) {
      if (!doc.evidence.some((e) => scrubbedRecord(e) !== null)) continue;
      const renamed = new Map<string, string>();
      this.ctx.docStore.update(docKey, tabId, 'evidence', (list) => {
        const keep: ProtectEvidence[] = [];
        const moved: ProtectEvidence[] = [];
        for (const e of list) {
          const next = scrubbedRecord(e);
          if (next === null) {
            keep.push(e);
            continue;
          }
          if (isTransferEvidence(e) && e.script !== undefined && next.script === undefined && e.receiver !== undefined) scriptDropped.add(e.receiver);
          renamed.set(evidenceKey(e), evidenceKey(next));
          moved.push(next);
        }
        // Fewer or as many records as before: merging never exceeds the document budget.
        let out = keep;
        for (const e of moved) out = mergeEvidence(out, e, EMPTY_DROPPED).evidence;
        return out;
      });
      this.stats.templatesScrubbed = Math.min(MAX_COUNT, this.stats.templatesScrubbed + renamed.size);
      for (const p of this.pending.values()) {
        for (const ref of p.refs) {
          if (ref.storeKey !== docKey) continue;
          const next = renamed.get(ref.key);
          if (next !== undefined) ref.key = next;
        }
      }
    }
    // Review PT-4: copies of the dropped script elsewhere (firewall receiver view) go too.
    if (scriptDropped.size > 0) this.ctx.eventBus.publish({ kind: 'evidence-scrubbed', tabId, receivers: [...scriptDropped] });
  }

  private base(meta: RequestMeta): { storeKey: string; createdAt: number } | null {
    if (meta.storeKey === null) {
      this.stats.unstored++;
      return null;
    }
    const doc = this.ctx.docStore.ensure(meta.storeKey, meta.tabId);
    return { storeKey: meta.storeKey, createdAt: doc.createdAt };
  }

  private second(at: number, createdAt: number): number {
    return Math.max(0, Math.min(PROTECT_WIRE_LIMITS.maxEvidenceSecond, Math.floor((at - createdAt) / 1000)));
  }

  private emitTransfer(meta: RequestMeta, rec: FieldRecord, m: Match, mode: 'direct' | 'reverse', delivery: DeliveryState): PendingRef | null {
    const currentTop = this.ctx.tabModel.topDocumentKey(meta.tabId) ?? meta.storeKey;
    const fromPrevious = rec.topKey !== null && currentTop !== null && rec.topKey !== currentTop;
    const timing = this.submitTiming(rec, meta, fromPrevious);
    const transferClass = classifyTransfer({ relation: meta.relation, submitTiming: timing, opaque: false });
    if (transferClass === null) return null;
    const b = this.base(meta);
    if (b === null) return null;
    const encodings = canonicalEncodings(m.encodings);
    const normalizedOnly = [...m.raw].every((e) => e === 'plain-normalized');
    const conf = assessConfidence({
      fieldKind: rec.fieldKind,
      encodings,
      baseLength: m.digits,
      paramName: m.view.paramName,
      normalizedOnly,
      fromPreviousDocument: fromPrevious,
      opaque: false,
    });
    const level = capConfidence(conf.level, confidenceCeiling('value-match', rec.fieldKind, encodings));
    const lims: ProtectLimitation[] = [...meta.limitations, ...conf.limitationCodes];
    if (mode === 'reverse') lims.push('matched-in-recent-request');
    if (timing === 'unknown') lims.push('submit-moment-unknown');
    if (meta.relation === 'cross-site') lims.push('party-by-registrable-domain');
    if (rec.frameSite !== null && meta.receiver !== null && rec.frameSite === meta.receiver) lims.push('receiver-hosts-form-frame');
    const since: SinceInput | null = mode === 'reverse' ? 'before-value' : rec.changedAt === null ? null : sinceInputOf(meta.at - rec.changedAt);
    const attr = this.scriptOf(meta.tabId, this.attribution(meta.requestId));
    const sec = this.second(meta.at, b.createdAt);
    const endpoint = this.endpointOf(meta, m.view.paramName);
    const ev: ProtectTransferEvidence = {
      evidenceId: this.newEvidenceId(),
      frameContext: meta.frameContext,
      ...(meta.frameSite !== null ? { frameSite: meta.frameSite } : {}),
      ...(attr.script !== null ? { script: attr.script } : {}),
      attributionConfidence: attr.level,
      count: 1,
      countQuality: 'lower-bound',
      firstSecond: sec,
      lastSecond: sec,
      evidenceSource: 'derived',
      integrity: 'derived',
      ruleVersion: FORM_LEAK_RULE_VERSION,
      limitationCodes: canonicalLimitations(lims, PROTECT_WIRE_LIMITS.maxEvidenceLimitations),
      protectKind: 'value-match',
      ruleId: 'form-leak',
      transferClass,
      fieldKind: rec.fieldKind,
      ...(fromPrevious ? {} : { fieldRef: rec.fieldRef }),
      encodings,
      location: m.view.location,
      ...(endpoint.paramName !== null ? { paramName: endpoint.paramName } : {}),
      ...(m.view.location === 'path' && m.view.pathSegment !== null && m.view.pathSegment <= PROTECT_WIRE_LIMITS.maxEvidencePathSegment ? { pathSegment: m.view.pathSegment } : {}),
      ...(meta.receiver !== null ? { receiver: meta.receiver } : { receiverCategory: meta.receiverCategory ?? 'unknown' }),
      relation: meta.relation,
      method: meta.method,
      requestKind: meta.requestKind,
      endpointHost: endpoint.endpointHost,
      endpointPathTemplate: endpoint.endpointPathTemplate,
      ...(meta.initiatorSite !== null ? { initiatorSite: meta.initiatorSite } : {}),
      submitTiming: timing,
      ...(since !== null ? { sinceInput: since } : {}),
      deliveryState: delivery,
      interpretationConfidence: level,
    };
    return this.store_(b.storeKey, meta, ev);
  }

  private emitOpaque(meta: RequestMeta, rec: FieldRecord, since: SinceInput, delivery: DeliveryState): PendingRef | null {
    const currentTop = this.ctx.tabModel.topDocumentKey(meta.tabId) ?? meta.storeKey;
    const fromPrevious = rec.topKey !== null && currentTop !== null && rec.topKey !== currentTop;
    const timing = this.submitTiming(rec, meta, fromPrevious);
    const transferClass = classifyTransfer({ relation: meta.relation, submitTiming: timing, opaque: true });
    if (transferClass === null) return null;
    const b = this.base(meta);
    if (b === null) return null;
    const lims: ProtectLimitation[] = [...meta.limitations, 'body-opaque', 'party-by-registrable-domain'];
    if (fromPrevious) lims.push('value-from-previous-document');
    if (timing === 'unknown') lims.push('submit-moment-unknown');
    if (since === 'before-value') lims.push('matched-in-recent-request');
    const attr = this.scriptOf(meta.tabId, this.attribution(meta.requestId));
    const sec = this.second(meta.at, b.createdAt);
    const endpoint = this.endpointOf(meta, null);
    const ev: ProtectTransferEvidence = {
      evidenceId: this.newEvidenceId(),
      frameContext: meta.frameContext,
      ...(meta.frameSite !== null ? { frameSite: meta.frameSite } : {}),
      ...(attr.script !== null ? { script: attr.script } : {}),
      attributionConfidence: attr.level,
      count: 1,
      countQuality: 'lower-bound',
      firstSecond: sec,
      lastSecond: sec,
      evidenceSource: 'derived',
      integrity: 'derived',
      ruleVersion: FORM_LEAK_RULE_VERSION,
      limitationCodes: canonicalLimitations(lims, PROTECT_WIRE_LIMITS.maxEvidenceLimitations),
      protectKind: 'opaque-after-input',
      ruleId: 'form-leak',
      transferClass,
      fieldKind: rec.fieldKind,
      ...(fromPrevious ? {} : { fieldRef: rec.fieldRef }),
      encodings: [],
      location: 'body-opaque',
      ...(meta.receiver !== null ? { receiver: meta.receiver } : { receiverCategory: meta.receiverCategory ?? 'unknown' }),
      relation: meta.relation,
      method: meta.method,
      requestKind: meta.requestKind,
      endpointHost: endpoint.endpointHost,
      endpointPathTemplate: endpoint.endpointPathTemplate,
      ...(meta.initiatorSite !== null ? { initiatorSite: meta.initiatorSite } : {}),
      submitTiming: timing,
      sinceInput: since,
      deliveryState: delivery,
      interpretationConfidence: 'low',
    };
    this.stats.opaqueEvidence++;
    return this.store_(b.storeKey, meta, ev);
  }

  /**
   * Merges the record into the document (docStore), publishes it on the bus; returns the outcome reference. The bus
   * event carries the request id (memory only): the history waits for that request's outcome (§11, §G).
   */
  private store_(storeKey: string, meta: RequestMeta, ev: ProtectTransferEvidence): PendingRef | null {
    const result = this.ctx.docStore.addEvidence(storeKey, meta.tabId, ev);
    if (result === null || result.index < 0) return null;
    this.stats.evidence++;
    this.ctx.eventBus.publish({ kind: 'evidence', documentKey: storeKey, tabId: meta.tabId, site: meta.topSite, evidence: ev, ...(meta.requestId !== null ? { requestId: meta.requestId } : {}) });
    return { storeKey, tabId: meta.tabId, key: evidenceKey(ev) };
  }
}

export function fieldKey(rec: FieldRecord): string {
  return rec.documentKey + '#' + String(rec.fieldRef);
}

/** The encoding a match reports: Base64 containers and URL-decoded plain matches say how the value travelled. */
function addEncoding(m: Match, enc: FingerprintEncoding, view: ViewMeta): void {
  m.raw.add(enc);
  if (view.container) {
    m.encodings.add('in-base64-container');
    if (isHashEncoding(enc)) m.encodings.add(enc);
  } else if (view.urlDecoded && (enc === 'plain' || enc === 'plain-normalized')) m.encodings.add('url-encoded');
  else m.encodings.add(enc);
}
