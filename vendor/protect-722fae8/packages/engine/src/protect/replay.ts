// ADR-020 §E (S11): session recording behaviour of the module «Защита». Pure logic: no chrome.*, no clock, no DOM, no
// network, no regex compilation of table data. The service worker (packages/background/src/protect/replay) feeds it:
//   - root listener / observer registrations (S1 `root-input-listeners`, S2 `root-mutation-observe`): MAIN samples of
//     S10 (page-controlled), folded by event group and target (window / document only for S1);
//   - periodic cross-site sends (S3 `periodic-third-party-send`): cadence of webRequest.onSendHeaders (browser-observed),
//     bursts glued under coalesceMs, a series while the pause is ≤ maxGapMs, body size only where Chrome gave a body;
//   - enabled replay-table rules (S5 `replay-vendor-resource`): none in production until REQ-008.
// Levels: none, signals-only (unassessed), replay-like (low; R1 = S1∧S2∧S3, R3 = S5∧(S1∨S2)), replay-recording (medium;
// R4 = S1 and S2 sampled-stack-attributed to scripts of site D and S3 towards D; R5 = S5 ∧ S3 on an endpoint of the
// same vendor ∧ (S1∨S2)). `high` is never set; without attribution and without an enabled vendor rule the ceiling is
// replay-like (`no-script-attribution`). Thresholds: thresholds/session-replay-behavior.v1.json (calibrated:false).
// No value, hash, URL, query or field content is ever an input: only enums, counters, registrable domains and ids.

import { MAX_COUNT, PROTECT_BUDGETS, PROTECT_LIMITATIONS, PROTECT_WIRE_LIMITS, isDomainName } from '@detect-expert/contracts';
import type {
  AttributionConfidence,
  CountQuality,
  ListenEventCode,
  ListenTargetKind,
  ProtectLimitation,
  ProtectRequestKind,
  ReplayBodySize,
  ReplayLevel,
  ReplayPeriodicHost,
  ReplaySignal,
  ReplaySummary,
  VendorSummary,
} from '@detect-expert/contracts';
import thresholdsJson from './thresholds/session-replay-behavior.v1.json';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const REPLAY_RULE_ID = 'session-replay-behavior' as const;

export interface ReplayThresholds {
  ruleId: typeof REPLAY_RULE_ID;
  ruleVersion: string;
  calibrated: false;
  /** Sends closer than this are one burst (glued). */
  coalesceMs: number;
  /** A pause up to this continues the series; a longer one starts a new series. */
  maxGapMs: number;
  /** Bursts in one series needed for S3. */
  minPeriodicRun: number;
  /** A burst is large when one of its observed bodies has at least this many bytes. */
  largeBodyBytes: number;
  /** Large (or not observed) bursts needed in that series. */
  minLargeSendsInRun: number;
}

function positiveInt(v: unknown, max: number): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= max;
}

/** Shape check of the thresholds file (throws at load: a broken rule file must never run). */
export function readReplayThresholds(raw: unknown): ReplayThresholds {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const ok =
    r['ruleId'] === REPLAY_RULE_ID &&
    typeof r['ruleVersion'] === 'string' &&
    /^[0-9]{1,4}(?:\.[0-9]{1,4}){0,2}$/.test(r['ruleVersion']) &&
    r['calibrated'] === false &&
    positiveInt(r['coalesceMs'], 60_000) &&
    positiveInt(r['maxGapMs'], 600_000) &&
    positiveInt(r['minPeriodicRun'], PROTECT_BUDGETS.replayRunMaxCeiling) &&
    positiveInt(r['largeBodyBytes'], PROTECT_BUDGETS.maxScannedBodyBytes) &&
    positiveInt(r['minLargeSendsInRun'], PROTECT_BUDGETS.replayRunMaxCeiling) &&
    (r['coalesceMs'] as number) < (r['maxGapMs'] as number);
  if (!ok) throw new Error('replay: invalid thresholds (session-replay-behavior.v1.json)');
  return Object.freeze({
    ruleId: REPLAY_RULE_ID,
    ruleVersion: r['ruleVersion'] as string,
    calibrated: false,
    coalesceMs: r['coalesceMs'] as number,
    maxGapMs: r['maxGapMs'] as number,
    minPeriodicRun: r['minPeriodicRun'] as number,
    largeBodyBytes: r['largeBodyBytes'] as number,
    minLargeSendsInRun: r['minLargeSendsInRun'] as number,
  });
}

export const REPLAY_THRESHOLDS: Readonly<ReplayThresholds> = readReplayThresholds(thresholdsJson);

// ---------------------------------------------------------------------------
// Registration groups (S1, S2)
// ---------------------------------------------------------------------------

/** Keyboard / text input events of S1. */
export const REPLAY_INPUT_EVENTS: ReadonlySet<ListenEventCode> = new Set<ListenEventCode>(['input', 'beforeinput', 'change', 'keydown', 'keyup', 'keypress']);
/** Pointer / scroll events of S1. */
export const REPLAY_POINTER_EVENTS: ReadonlySet<ListenEventCode> = new Set<ListenEventCode>(['mousemove', 'pointermove', 'touchmove', 'scroll', 'wheel']);
/** Targets of S1: the page level only (element and field listeners are not counted). */
export const REPLAY_ROOT_TARGETS: ReadonlySet<ListenTargetKind> = new Set<ListenTargetKind>(['window', 'document']);
/** Attributed sites remembered per registration group. */
export const MAX_REPLAY_GROUP_SITES = 8;

export type ReplayEventGroup = 'input' | 'pointer';

export function replayEventGroup(code: ListenEventCode | undefined): ReplayEventGroup | null {
  if (code === undefined) return null;
  if (REPLAY_INPUT_EVENTS.has(code)) return 'input';
  if (REPLAY_POINTER_EVENTS.has(code)) return 'pointer';
  return null;
}

export interface ReplayRootGroup {
  /** Saturating number of registrations. */
  count: number;
  /** Registrable domains of sampled scripts (page-controlled), at most MAX_REPLAY_GROUP_SITES. */
  sites: string[];
  /** At least one registration had no sampled script. */
  unattributed: boolean;
}

/** One registration sample as the SW sees it; `site` = registrable domain of the sampled script, or null. */
export interface ReplayRegistrationInput {
  hookPoint: 'listen' | 'observe-document';
  eventCode?: ListenEventCode | undefined;
  targetKind: ListenTargetKind;
  count: number;
  site: string | null;
}

export interface ReplayPeriodicFact {
  registrableDomain: string;
  cadence: Readonly<ReplayCadence>;
  /** Vendors whose ENABLED endpoint rule matched a send to this receiver. */
  vendorIds: readonly string[];
}

export interface ReplayVendorResource {
  vendorId: string;
  ruleIds: readonly string[];
  count: number;
}

/** What the SW knows about one document (a frame document; the tab's summary picks the best frame). */
export interface ReplayFacts {
  inputRoot: ReplayRootGroup;
  pointerRoot: ReplayRootGroup;
  observeDocument: ReplayRootGroup;
  registrationQuality: CountQuality;
  periodic: ReplayPeriodicFact[];
  /** Receivers were dropped by the cadence bound (LRU) or more qualify than PROTECT_BUDGETS.maxReplayPeriodicHosts. */
  periodicTruncated: boolean;
  vendorResources: ReplayVendorResource[];
}

function emptyGroup(): ReplayRootGroup {
  return { count: 0, sites: [], unattributed: false };
}

export function createReplayFacts(): ReplayFacts {
  return { inputRoot: emptyGroup(), pointerRoot: emptyGroup(), observeDocument: emptyGroup(), registrationQuality: 'exact', periodic: [], periodicTruncated: false, vendorResources: [] };
}

function satAdd(a: number, b: number): number {
  return Math.min(MAX_COUNT, Math.max(0, a) + Math.max(0, b));
}

function noteGroup(group: ReplayRootGroup, count: number, site: string | null): void {
  group.count = satAdd(group.count, Math.max(1, count));
  if (site === null) group.unattributed = true;
  else if (!group.sites.includes(site) && group.sites.length < MAX_REPLAY_GROUP_SITES) group.sites.push(site);
}

/**
 * Folds one registration into the facts: `listen` on window / document with an input or pointer event (S1),
 * `observe-document` (S2). Element, field and root-element listeners are ignored by construction. Returns true when
 * the facts changed.
 */
export function noteReplayRegistration(facts: ReplayFacts, r: ReplayRegistrationInput): boolean {
  if (r.hookPoint === 'observe-document') {
    noteGroup(facts.observeDocument, r.count, r.site);
    return true;
  }
  if (!REPLAY_ROOT_TARGETS.has(r.targetKind)) return false;
  const group = replayEventGroup(r.eventCode);
  if (group === null) return false;
  noteGroup(group === 'input' ? facts.inputRoot : facts.pointerRoot, r.count, r.site);
  return true;
}

// ---------------------------------------------------------------------------
// Cadence (S3): one receiver of one document
// ---------------------------------------------------------------------------

/** State of the current burst: large > unknown (body not observed) > small. */
const BURST_NONE = 0;
const BURST_SMALL = 1;
const BURST_UNKNOWN = 2;
const BURST_LARGE = 3;

export interface ReplayCadence {
  /** Time of the last send (ms, Chrome timeStamp); NaN before the first. */
  lastAt: number;
  /** Bursts in the current series. */
  run: number;
  /** Large bursts in the current series. */
  large: number;
  /** Bursts without an observed body in the current series. */
  unknown: number;
  burst: number;
  /** Longest series, 0..replayRunMaxCeiling. */
  runMax: number;
  /** Most large bursts in one series. */
  largeInRunMax: number;
  /** A series reached minPeriodicRun with at least minLargeSendsInRun large or not-observed bursts. */
  qualified: boolean;
  /** Saturating number of sends. */
  sends: number;
  /** Sends whose body size was not observed. */
  unknownSends: number;
  /** Largest observed body in bytes; -1 when none was observed. */
  maxBody: number;
}

export function createCadence(): ReplayCadence {
  return { lastAt: Number.NaN, run: 0, large: 0, unknown: 0, burst: BURST_NONE, runMax: 0, largeInRunMax: 0, qualified: false, sends: 0, unknownSends: 0, maxBody: -1 };
}

/**
 * One send at `t` (ms) with `bytes` of observed body (null = not observed). Mutates `c` (hot path: no allocation).
 * Gaps under coalesceMs glue sends into one burst; a burst counts once in the series; a pause above maxGapMs starts a
 * new series. Returns `c.qualified`.
 */
export function stepCadence(c: ReplayCadence, t: number, bytes: number | null, th: Readonly<ReplayThresholds> = REPLAY_THRESHOLDS): boolean {
  const ceiling = PROTECT_BUDGETS.replayRunMaxCeiling;
  const first = Number.isNaN(c.lastAt);
  const gap = first ? 0 : Math.max(0, t - c.lastAt);
  if (first || gap > th.maxGapMs) {
    c.run = 1;
    c.large = 0;
    c.unknown = 0;
    c.burst = BURST_NONE;
  } else if (gap >= th.coalesceMs) {
    if (c.run < ceiling) c.run++;
    c.burst = BURST_NONE;
  }
  if (first || t > c.lastAt) c.lastAt = t;
  const state = bytes === null ? BURST_UNKNOWN : bytes >= th.largeBodyBytes ? BURST_LARGE : BURST_SMALL;
  if (state > c.burst) {
    if (c.burst === BURST_UNKNOWN) c.unknown--;
    if (state === BURST_UNKNOWN) c.unknown++;
    else if (state === BURST_LARGE && c.large < ceiling) c.large++;
    c.burst = state;
  }
  c.sends = c.sends < MAX_COUNT ? c.sends + 1 : MAX_COUNT;
  if (bytes === null) c.unknownSends = c.unknownSends < MAX_COUNT ? c.unknownSends + 1 : MAX_COUNT;
  else if (bytes > c.maxBody) c.maxBody = bytes;
  if (c.run > c.runMax) c.runMax = c.run;
  if (c.large > c.largeInRunMax) c.largeInRunMax = c.large;
  if (!c.qualified && c.run >= th.minPeriodicRun && c.large + c.unknown >= th.minLargeSendsInRun) c.qualified = true;
  return c.qualified;
}

/** Coarse bucket of a body size (never the exact number). */
export function replayBodySize(bytes: number | null): ReplayBodySize {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return 'not-observed';
  if (bytes === 0) return 'empty';
  if (bytes < 1024) return 'under-1k';
  if (bytes <= 16384) return '1k-16k';
  return 'over-16k';
}

// ---------------------------------------------------------------------------
// Replay table (catalog protect-tables; production empty until REQ-008). Data only, no regex at runtime.
// ---------------------------------------------------------------------------

export const REPLAY_ENTRY_ROLES = ['resource', 'endpoint'] as const;
export type ReplayEntryRole = (typeof REPLAY_ENTRY_ROLES)[number];

export interface ReplayMatchConditions {
  scheme?: 'http' | 'https';
  hostExact?: string;
  hostOneOf?: readonly string[];
  /** The host equals these labels or exactly one label precedes them. */
  hostSuffixLabels?: string;
  /** Test-profile entries only; without it the request must use the scheme's default port. */
  portExact?: number;
  pathExact?: string;
  pathOneOf?: readonly string[];
}

export interface ReplayTableEntry {
  ruleId: string;
  vendorId: string;
  role: ReplayEntryRole;
  conditions: ReplayMatchConditions;
  synthetic?: true;
}

/** The request as the matcher sees it (SW callback memory only; never stored). */
export interface ReplayRequestView {
  scheme: 'http' | 'https';
  host: string;
  port: number | null;
  path: string;
  kind: ProtectRequestKind;
}

export const REPLAY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,255}$/;
const CONDITION_KEYS: ReadonlySet<string> = new Set(['scheme', 'hostExact', 'hostOneOf', 'hostSuffixLabels', 'portExact', 'pathExact', 'pathOneOf']);
const ENTRY_KEYS: ReadonlySet<string> = new Set(['ruleId', 'vendorId', 'role', 'conditions', 'synthetic']);

function isHost(v: unknown): v is string {
  return typeof v === 'string' && HOST_RE.test(v);
}

function isPath(v: unknown): v is string {
  return typeof v === 'string' && PATH_RE.test(v);
}

function readStringList(v: unknown, check: (x: unknown) => x is string): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 16) return null;
  for (const x of v) if (!check(x)) return null;
  return [...(v as string[])];
}

/** Closed shape check of one condition object; null when invalid (unknown key, regex, URL-shaped value). */
export function readReplayConditions(raw: unknown, allowPort: boolean): ReplayMatchConditions | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  for (const k of Object.keys(c)) if (!CONDITION_KEYS.has(k)) return null;
  const out: ReplayMatchConditions = {};
  if (c['scheme'] !== undefined) {
    if (c['scheme'] !== 'http' && c['scheme'] !== 'https') return null;
    out.scheme = c['scheme'];
  }
  let hosts = 0;
  if (c['hostExact'] !== undefined) {
    if (!isHost(c['hostExact'])) return null;
    out.hostExact = c['hostExact'];
    hosts++;
  }
  if (c['hostOneOf'] !== undefined) {
    const list = readStringList(c['hostOneOf'], isHost);
    if (list === null) return null;
    out.hostOneOf = list;
    hosts++;
  }
  if (c['hostSuffixLabels'] !== undefined) {
    if (!isHost(c['hostSuffixLabels']) || !c['hostSuffixLabels'].includes('.')) return null;
    out.hostSuffixLabels = c['hostSuffixLabels'];
    hosts++;
  }
  if (hosts !== 1) return null;
  if (c['portExact'] !== undefined) {
    const p = c['portExact'];
    if (!allowPort || typeof p !== 'number' || !Number.isSafeInteger(p) || p < 1 || p > 65535) return null;
    out.portExact = p;
  }
  if (c['pathExact'] !== undefined && c['pathOneOf'] !== undefined) return null;
  if (c['pathExact'] !== undefined) {
    if (!isPath(c['pathExact'])) return null;
    out.pathExact = c['pathExact'];
  }
  if (c['pathOneOf'] !== undefined) {
    const list = readStringList(c['pathOneOf'], isPath);
    if (list === null) return null;
    out.pathOneOf = list;
  }
  return out;
}

/**
 * Runtime entries of the replay table. Production data never carries `synthetic`; test-profile data only with
 * allowSynthetic (and only there `portExact`). Invalid entries are dropped, never thrown on.
 */
export function parseReplayEntries(raw: readonly unknown[], options: { allowSynthetic: boolean }): ReplayTableEntry[] {
  const out: ReplayTableEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, 256)) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const e = item as Record<string, unknown>;
    if (Object.keys(e).some((k) => !ENTRY_KEYS.has(k))) continue;
    const synthetic = e['synthetic'] === true;
    if (e['synthetic'] !== undefined && !synthetic) continue;
    if (synthetic && !options.allowSynthetic) continue;
    if (typeof e['ruleId'] !== 'string' || !REPLAY_ID_PATTERN.test(e['ruleId']) || typeof e['vendorId'] !== 'string' || !REPLAY_ID_PATTERN.test(e['vendorId'])) continue;
    if (e['role'] !== 'resource' && e['role'] !== 'endpoint') continue;
    const conditions = readReplayConditions(e['conditions'], synthetic);
    if (conditions === null) continue;
    const key = e['ruleId'] + '|' + e['role'];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ruleId: e['ruleId'], vendorId: e['vendorId'], role: e['role'], conditions, ...(synthetic ? { synthetic: true as const } : {}) });
  }
  return out;
}

function hostMatches(c: ReplayMatchConditions, host: string): boolean {
  if (c.hostExact !== undefined) return host === c.hostExact;
  if (c.hostOneOf !== undefined) return c.hostOneOf.includes(host);
  const labels = c.hostSuffixLabels;
  if (labels === undefined) return false;
  if (host === labels) return true;
  if (host.length <= labels.length + 1 || !host.endsWith('.' + labels)) return false;
  const left = host.slice(0, host.length - labels.length - 1);
  return left.length > 0 && left.length <= 63 && !left.includes('.');
}

export function matchReplayConditions(c: ReplayMatchConditions, req: ReplayRequestView): boolean {
  if (c.scheme !== undefined && c.scheme !== req.scheme) return false;
  if ((c.portExact ?? null) !== req.port) return false;
  if (!hostMatches(c, req.host)) return false;
  if (c.pathExact !== undefined && req.path !== c.pathExact) return false;
  if (c.pathOneOf !== undefined && !c.pathOneOf.includes(req.path)) return false;
  return true;
}

/** Resource rules apply to `script` requests; endpoint rules to xhr / beacon sends. */
export function matchReplayEntry(entry: ReplayTableEntry, req: ReplayRequestView): boolean {
  if (entry.role === 'resource' ? req.kind !== 'script' : req.kind !== 'xhr' && req.kind !== 'beacon') return false;
  return matchReplayConditions(entry.conditions, req);
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export const REPLAY_LEVEL_RANK: Readonly<Record<ReplayLevel, number>> = { none: 0, 'signals-only': 1, 'replay-like': 2, 'replay-recording': 3 };

/** Limitations every summary carries (what the module never sees or never checks). */
export const REPLAY_ALWAYS_LIMITATIONS: readonly ProtectLimitation[] = [
  'element-listeners-not-observed',
  'mo-options-not-read',
  'websocket-not-observed',
  'worker-requests-may-be-missed',
  'masking-not-verifiable',
  'first-party-endpoints-not-assessed',
  'uncalibrated-threshold',
];

export interface ReplayDeriveOptions {
  /** MAIN hook configuration of this build (S10 PROTECT_HOOK_CONFIG): listen / observe hooks installed at all. */
  hooks: { listen: boolean; observe: boolean };
  /** The replay table of this build has at least one enabled rule (production: false until REQ-008). */
  vendorRulesEnabled: boolean;
  /** Receivers (registrable domains) of value-match evidence of this document. */
  valueSeenReceivers?: readonly string[];
  loadedBeforeEnable?: boolean;
  cadenceReset?: boolean;
  thresholds?: Readonly<ReplayThresholds>;
}

export type ReplayRuleHit = 'R1' | 'R3' | 'R4' | 'R5';

export interface ReplayDerivation {
  summary: ReplaySummary;
  /** Rules that hold (R4 / R5 decide replay-recording, R1 / R3 replay-like). */
  rules: ReplayRuleHit[];
  /** Receivers the conclusion is about (for the history event), at most maxReplayPeriodicHosts. */
  linkedReceivers: string[];
}

function canonicalLimitations(codes: Iterable<ProtectLimitation>): ProtectLimitation[] {
  const set = new Set(codes);
  return PROTECT_LIMITATIONS.filter((l) => set.has(l)).slice(0, PROTECT_WIRE_LIMITS.maxReplayLimitations);
}

function domains(list: readonly string[]): string[] {
  return list.filter((s) => isDomainName(s));
}

function qualifies(p: ReplayPeriodicFact, th: Readonly<ReplayThresholds>): boolean {
  return isDomainName(p.registrableDomain) && p.cadence.qualified && p.cadence.runMax >= th.minPeriodicRun;
}

function byRun(a: ReplayPeriodicFact, b: ReplayPeriodicFact): number {
  return b.cadence.runMax - a.cadence.runMax || b.cadence.sends - a.cadence.sends || (a.registrableDomain < b.registrableDomain ? -1 : a.registrableDomain > b.registrableDomain ? 1 : 0);
}

function periodicHost(p: ReplayPeriodicFact): ReplayPeriodicHost {
  const ceiling = PROTECT_BUDGETS.replayRunMaxCeiling;
  const c = p.cadence;
  return {
    registrableDomain: p.registrableDomain,
    runMax: Math.min(ceiling, c.runMax),
    sends: Math.min(MAX_COUNT, c.sends),
    largeInRunMax: Math.min(ceiling, c.largeInRunMax),
    bodySize: replayBodySize(c.maxBody < 0 ? null : c.maxBody),
  };
}

/** Level, confidence, signals, receivers and limitations of one document. */
export function deriveReplayDetailed(facts: Readonly<ReplayFacts>, options: ReplayDeriveOptions): ReplayDerivation {
  const th = options.thresholds ?? REPLAY_THRESHOLDS;
  const s1 = options.hooks.listen && facts.inputRoot.count > 0 && facts.pointerRoot.count > 0;
  const s2 = options.hooks.observe && facts.observeDocument.count > 0;
  const qualifying = facts.periodic.filter((p) => qualifies(p, th)).sort(byRun);
  const reported = qualifying.slice(0, PROTECT_BUDGETS.maxReplayPeriodicHosts);
  const s3 = reported.length > 0;
  const resources = options.vendorRulesEnabled ? facts.vendorResources.filter((v) => v.count > 0 && REPLAY_ID_PATTERN.test(v.vendorId)) : [];
  const s5 = resources.length > 0;

  const s1Sites = s1 ? domains(facts.inputRoot.sites).filter((s) => facts.pointerRoot.sites.includes(s)) : [];
  const s2Sites = s2 ? domains(facts.observeDocument.sites) : [];
  let r4Site: string | null = null;
  if (s1 && s2 && s3) {
    for (const p of reported) {
      if (s1Sites.includes(p.registrableDomain) && s2Sites.includes(p.registrableDomain)) {
        r4Site = p.registrableDomain;
        break;
      }
    }
  }
  const vendorIds = new Set(resources.map((v) => v.vendorId));
  const r5Hosts = s5 && (s1 || s2) ? reported.filter((p) => p.vendorIds.some((id) => vendorIds.has(id))).map((p) => p.registrableDomain) : [];
  const rules: ReplayRuleHit[] = [];
  if (s1 && s2 && s3) rules.push('R1');
  if (s5 && (s1 || s2)) rules.push('R3');
  if (r4Site !== null) rules.push('R4');
  if (r5Hosts.length > 0) rules.push('R5');

  let level: ReplayLevel = 'none';
  if (rules.includes('R4') || rules.includes('R5')) level = 'replay-recording';
  else if (rules.includes('R1') || rules.includes('R3')) level = 'replay-like';
  else if (s1 || s2 || s3 || s5) level = 'signals-only';
  const interpretationConfidence: ReplaySummary['interpretationConfidence'] = level === 'replay-recording' ? 'medium' : level === 'replay-like' ? 'low' : 'unassessed';
  const attributionConfidence: AttributionConfidence = r4Site !== null ? 'sampled-stack' : 'unknown';

  const linked = new Set<string>();
  if (r4Site !== null) linked.add(r4Site);
  for (const h of r5Hosts) linked.add(h);
  if (level === 'replay-like' && rules.includes('R1')) for (const p of reported) linked.add(p.registrableDomain);

  const signals: ReplaySignal[] = [];
  if (s1) {
    const site = r4Site ?? (s1Sites.length === 1 ? s1Sites[0]! : null);
    signals.push({
      code: 'root-input-listeners',
      techniqueId: 'DET-043',
      evidenceSource: 'page-hook',
      integrity: 'page-controlled',
      count: satAdd(facts.inputRoot.count, facts.pointerRoot.count),
      countQuality: facts.registrationQuality,
      ...(site !== null ? { linkedSite: site } : {}),
    });
  }
  if (s2) {
    const site = r4Site ?? (s2Sites.length === 1 ? s2Sites[0]! : null);
    signals.push({
      code: 'root-mutation-observe',
      evidenceSource: 'page-hook',
      integrity: 'page-controlled',
      count: Math.min(MAX_COUNT, facts.observeDocument.count),
      countQuality: facts.registrationQuality,
      ...(site !== null ? { linkedSite: site } : {}),
    });
  }
  if (s3) {
    let sends = 0;
    for (const p of reported) sends = satAdd(sends, p.cadence.sends);
    signals.push({
      code: 'periodic-third-party-send',
      evidenceSource: 'browser-network',
      integrity: 'browser-observed',
      count: sends,
      countQuality: options.cadenceReset === true || facts.periodicTruncated || qualifying.length > reported.length ? 'lower-bound' : 'exact',
      linkedSite: r4Site ?? reported[0]!.registrableDomain,
    });
  }
  if (s5) {
    let count = 0;
    for (const v of resources) count = satAdd(count, v.count);
    signals.push({ code: 'replay-vendor-resource', evidenceSource: 'browser-network', integrity: 'browser-observed', count, countQuality: 'exact' });
  }

  const vendors: VendorSummary[] = [...resources]
    .sort((a, b) => (a.vendorId < b.vendorId ? -1 : a.vendorId > b.vendorId ? 1 : 0))
    .slice(0, PROTECT_BUDGETS.maxReplayVendors)
    .map((v) => ({
      vendorId: v.vendorId,
      vendorConfidence: 'documented-resource',
      ruleIds: [...new Set(v.ruleIds.filter((id) => REPLAY_ID_PATTERN.test(id)))].sort().slice(0, 8),
      evidenceSource: 'browser-network',
      integrity: 'browser-observed',
    }));

  const periodicHosts = reported.map(periodicHost);
  const seen = new Set(options.valueSeenReceivers ?? []);
  const inputMasking = periodicHosts.some((h) => seen.has(h.registrableDomain)) ? 'value-seen-in-traffic' : 'unconfirmed';

  const limits = new Set<ProtectLimitation>(REPLAY_ALWAYS_LIMITATIONS);
  if (!options.hooks.listen) limits.add('listener-hook-off');
  if (!options.hooks.observe) limits.add('mo-hook-off');
  if (reported.some((p) => p.cadence.unknownSends > 0)) limits.add('body-size-not-observed');
  if (options.loadedBeforeEnable === true) limits.add('loaded-before-enable');
  if (options.cadenceReset === true) limits.add('cadence-reset');
  if (facts.periodicTruncated || qualifying.length > reported.length) limits.add('periodic-hosts-truncated');
  if (!options.vendorRulesEnabled) limits.add('vendor-rules-disabled');
  const unlinked = (s1 && s1Sites.length === 0) || (s2 && s2Sites.length === 0);
  if (level !== 'replay-recording' && (s1 || s2) && unlinked && !s5) limits.add('no-script-attribution');

  const summary: ReplaySummary = {
    ruleId: REPLAY_RULE_ID,
    ruleVersion: th.ruleVersion,
    level,
    interpretationConfidence,
    attributionConfidence,
    signals: signals.slice(0, PROTECT_WIRE_LIMITS.maxReplaySignals),
    periodicHosts,
    vendors,
    inputMasking,
    limitationCodes: canonicalLimitations(limits),
  };
  return { summary, rules, linkedReceivers: [...linked].slice(0, PROTECT_BUDGETS.maxReplayPeriodicHosts) };
}

export function deriveReplay(facts: Readonly<ReplayFacts>, options: ReplayDeriveOptions): ReplaySummary {
  return deriveReplayDetailed(facts, options).summary;
}

/** The higher level of two summaries of one document (a summary kept from before a SW restart, or another frame). */
export function higherReplay(a: ReplaySummary, b: ReplaySummary): ReplaySummary {
  const ra = REPLAY_LEVEL_RANK[a.level];
  const rb = REPLAY_LEVEL_RANK[b.level];
  if (ra !== rb) return ra > rb ? a : b;
  return b.signals.length > a.signals.length ? b : a;
}

/** Same summary content (cheap field comparison of a bounded object; never serialized to compare). */
export function sameReplaySummary(a: ReplaySummary | null | undefined, b: ReplaySummary | null | undefined): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (a.level !== b.level || a.interpretationConfidence !== b.interpretationConfidence || a.attributionConfidence !== b.attributionConfidence) return false;
  if (a.inputMasking !== b.inputMasking || a.ruleVersion !== b.ruleVersion) return false;
  if (a.signals.length !== b.signals.length || a.periodicHosts.length !== b.periodicHosts.length || a.vendors.length !== b.vendors.length) return false;
  if (a.limitationCodes.length !== b.limitationCodes.length || a.limitationCodes.some((l, i) => l !== b.limitationCodes[i])) return false;
  for (let i = 0; i < a.signals.length; i++) {
    const x = a.signals[i]!;
    const y = b.signals[i]!;
    if (x.code !== y.code || x.count !== y.count || x.countQuality !== y.countQuality || x.linkedSite !== y.linkedSite) return false;
  }
  for (let i = 0; i < a.periodicHosts.length; i++) {
    const x = a.periodicHosts[i]!;
    const y = b.periodicHosts[i]!;
    if (x.registrableDomain !== y.registrableDomain || x.runMax !== y.runMax || x.sends !== y.sends || x.largeInRunMax !== y.largeInRunMax || x.bodySize !== y.bodySize) return false;
  }
  for (let i = 0; i < a.vendors.length; i++) {
    const x = a.vendors[i]!;
    const y = b.vendors[i]!;
    if (x.vendorId !== y.vendorId || x.ruleIds.join(',') !== y.ruleIds.join(',')) return false;
  }
  return true;
}
