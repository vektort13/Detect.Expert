// Coverage state (REQ-006, spec Part II A3/A8, ADR-011 §2). "Not observed" is only meaningful next to this.
// Pure and deterministic: the state is the highest-precedence candidate implied by the flags and the context.
//
// Precedence (first wins):
//   1. unsupported  restricted page (chrome://, Web Store, other extensions, special frames) or 'restricted-page'
//   2. no-access    scope off, host outside the granted scope, 'no-host-permission', 'revoked'
//   3. paused       user paused this document/site, or 'paused'
//   4. degraded     data was lost or the channel is broken: 'truncated', 'throttled', 'budget-exceeded',
//                   'bridge-ring-overflow', 'channel-gap', 'protocol-mismatch'
//   5. late-start   sensors installed after page scripts may have run: 'late-start'
//   6. partial      part of the document is not observed: 'hook-failed', 'descriptor-nonconfigurable',
//                   'unsupported-realm', 'worker-not-observed', 'network-limited', 'frames-inaccessible',
//                   'sensor-disabled' (ADR-019: a sensor family is disabled), or known inaccessible frames
//   7. active
// Rationale: states meaning "nothing is collected" outrank "something was lost", which outranks "the start was
// missed", which outranks "some areas are not covered". A quota failure must not hide behind late-start (ADR-011).
// The permanent architectural gaps (workers, WASM, CSS, server side) are NOT flags: 'active' already carries them
// in its UI text. Flags mark document-specific gaps only.

import type { CoverageFlag, CoverageState, DocumentReport, ScopeMode } from '@detect-expert/contracts';
import { COVERAGE_FLAGS } from '@detect-expert/contracts';

export interface CoverageContext {
  scopeMode: ScopeMode;
  /** The document is inside the granted scope (site/all-sites permission granted, or activeTab injected). */
  accessGranted: boolean;
  /** Restricted page where injection is never attempted. */
  restricted: boolean;
  /** Observation paused by the user for this document/site. */
  paused: boolean;
  /** Cross-origin frames known to be inaccessible (0 when none known). */
  inaccessibleFrames: number;
}

/** Post-install default: scope off, nothing granted. */
export const DEFAULT_COVERAGE_CONTEXT: Readonly<CoverageContext> = Object.freeze({
  scopeMode: 'off',
  accessGranted: false,
  restricted: false,
  paused: false,
  inaccessibleFrames: 0,
});

export const COVERAGE_PRECEDENCE: readonly CoverageState[] = [
  'unsupported',
  'no-access',
  'paused',
  'degraded',
  'late-start',
  'partial',
  'active',
];

/** The state each flag implies on its own. */
export const COVERAGE_FLAG_STATE: Readonly<Record<CoverageFlag, CoverageState>> = Object.freeze({
  'restricted-page': 'unsupported',
  'no-host-permission': 'no-access',
  revoked: 'no-access',
  paused: 'paused',
  truncated: 'degraded',
  throttled: 'degraded',
  'budget-exceeded': 'degraded',
  'bridge-ring-overflow': 'degraded',
  'channel-gap': 'degraded',
  'protocol-mismatch': 'degraded',
  'late-start': 'late-start',
  'hook-failed': 'partial',
  'descriptor-nonconfigurable': 'partial',
  'unsupported-realm': 'partial',
  'worker-not-observed': 'partial',
  'network-limited': 'partial',
  'frames-inaccessible': 'partial',
  'sensor-disabled': 'partial',
});

const RANK = new Map<CoverageState, number>(COVERAGE_PRECEDENCE.map((s, i) => [s, i]));

function rank(state: CoverageState): number {
  return RANK.get(state) ?? COVERAGE_PRECEDENCE.length;
}

export function computeCoverageState(
  flags: readonly CoverageFlag[],
  ctx: CoverageContext = DEFAULT_COVERAGE_CONTEXT,
): CoverageState {
  let best: CoverageState = 'active';
  const consider = (s: CoverageState): void => {
    if (rank(s) < rank(best)) best = s;
  };
  if (ctx.restricted) consider('unsupported');
  if (ctx.scopeMode === 'off' || !ctx.accessGranted) consider('no-access');
  if (ctx.paused) consider('paused');
  if (ctx.inaccessibleFrames > 0) consider('partial');
  for (const f of flags) {
    const s = COVERAGE_FLAG_STATE[f];
    if (s !== undefined) consider(s);
  }
  return best;
}

/**
 * Compact, deterministic reference to the coverage snapshot a finding was derived under (Finding.coverageRef).
 * Matches the contract id pattern ^[A-Za-z0-9_-]{1,64}$: 'cov-<state>-<flag bitmask as hex>'.
 */
export function coverageRef(state: CoverageState, flags: readonly CoverageFlag[]): string {
  let mask = 0;
  for (const f of flags) {
    const i = COVERAGE_FLAGS.indexOf(f);
    if (i >= 0) mask |= 1 << i;
  }
  return 'cov-' + state + '-' + mask.toString(16).padStart(4, '0');
}

/** Convenience: state of a stored report under a context. */
export function coverageStateOf(report: Pick<DocumentReport, 'coverageFlags'>, ctx?: CoverageContext): CoverageState {
  return computeCoverageState(report.coverageFlags, ctx);
}
