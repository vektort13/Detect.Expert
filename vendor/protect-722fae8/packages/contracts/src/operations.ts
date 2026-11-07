// Operation codes (ADR-017): an optional, per-technique allowlisted description of WHAT the page asked for
// (which method/property, or the category of a primitive argument). Never a browser answer, never a page value.
// No API strings here (they live in operation-api.ts) and no side effects beyond frozen tables.
//
// PAGE_OPERATIONS order defines the local operation index 1..n inside a technique (index 0 = no operation); the
// MAIN key layout v2 (ADR-017, S02) packs that index into 6 bits, hence at most 63 codes per technique.
// Adding, removing or reordering a code = ADR-017 changelog entry + gen-schemas + API name + privacy review.

import type { SignalCode, TechniqueId } from './enums';

/** Union of every PAGE_OPERATIONS list in TECHNIQUE_IDS order (57 codes). Unique across techniques. */
export const OPERATION_CODES = [
  // DET-005 geometry
  'get-client-rects',
  'get-bounding-client-rect',
  'offset-width',
  'offset-height',
  // DET-011 WebGL parameters / extensions
  'param-vendor',
  'param-renderer',
  'param-version',
  'param-shading-language-version',
  'param-unmasked-vendor',
  'param-unmasked-renderer',
  'param-limit',
  'param-other',
  'param-unclassified',
  'ext-debug-renderer-info',
  'ext-other',
  'ext-unclassified',
  'supported-extensions',
  'shader-precision-format',
  // DET-012 WebGL readback
  'read-pixels',
  // DET-015 audio graph
  'start-rendering',
  'create-oscillator',
  'create-dynamics-compressor',
  'connect-osc-compressor',
  // DET-016 audio readout
  'get-channel-data',
  'copy-from-channel',
  'analyser-float-frequency',
  'analyser-byte-frequency',
  'analyser-float-time-domain',
  'analyser-byte-time-domain',
  // DET-025 navigator identity
  'user-agent',
  'platform',
  'vendor',
  'language',
  'languages',
  // DET-026 User-Agent Client Hints
  'user-agent-data',
  'ua-brands',
  'ua-mobile',
  'ua-platform',
  'ua-to-json',
  'get-high-entropy-values',
  // DET-029 screen
  'width',
  'height',
  'avail-width',
  'avail-height',
  'color-depth',
  'pixel-depth',
  'orientation',
  // DET-039 permissions
  'query',
  'state-location',
  'state-notifications',
  'state-media',
  'state-sensors',
  'state-midi',
  'state-clipboard',
  'state-storage',
  'state-other',
  'state-unclassified',
] as const;
export type OperationCode = (typeof OPERATION_CODES)[number];

type OperationTable = Readonly<Partial<Record<TechniqueId, readonly OperationCode[]>>>;

function freezeTable<T>(table: Partial<Record<TechniqueId, readonly T[]>>): Readonly<Partial<Record<TechniqueId, readonly T[]>>> {
  for (const list of Object.values(table) as Array<readonly T[]>) Object.freeze(list);
  return Object.freeze(table);
}

/** Per-technique operation allowlist. The position in a list is the local index (1-based) in the MAIN key. */
export const PAGE_OPERATIONS: OperationTable = /* @__PURE__ */ freezeTable<OperationCode>({
  'DET-005': ['get-client-rects', 'get-bounding-client-rect', 'offset-width', 'offset-height'],
  'DET-011': [
    'param-vendor',
    'param-renderer',
    'param-version',
    'param-shading-language-version',
    'param-unmasked-vendor',
    'param-unmasked-renderer',
    'param-limit',
    'param-other',
    'param-unclassified',
    'ext-debug-renderer-info',
    'ext-other',
    'ext-unclassified',
    'supported-extensions',
    'shader-precision-format',
  ],
  'DET-012': ['read-pixels'],
  'DET-015': ['start-rendering', 'create-oscillator', 'create-dynamics-compressor', 'connect-osc-compressor'],
  'DET-016': [
    'get-channel-data',
    'copy-from-channel',
    'analyser-float-frequency',
    'analyser-byte-frequency',
    'analyser-float-time-domain',
    'analyser-byte-time-domain',
  ],
  'DET-025': ['user-agent', 'platform', 'vendor', 'language', 'languages'],
  'DET-026': ['user-agent-data', 'ua-brands', 'ua-mobile', 'ua-platform', 'ua-to-json', 'get-high-entropy-values'],
  'DET-029': ['width', 'height', 'avail-width', 'avail-height', 'color-depth', 'pixel-depth', 'orientation'],
  'DET-039': [
    'query',
    'state-location',
    'state-notifications',
    'state-media',
    'state-sensors',
    'state-midi',
    'state-clipboard',
    'state-storage',
    'state-other',
    'state-unclassified',
  ],
});

const CANVAS_SIGNALS = ['api-use', 'readback-after-text', 'tainted-canvas-attempt'] as const;
const HOT_SIGNALS = ['api-use', 'sample-budget-exceeded'] as const;
const DEFAULT_SIGNALS: readonly SignalCode[] = /* @__PURE__ */ Object.freeze(['api-use'] as const);

/**
 * Local signal table used by MAIN only (bit i = list[i], bit 0 = api-use; at most 8; never bfcache-restore, which
 * the bridge adds). Not enforced on the wire: page payload is page-controlled anyway (ADR-017).
 */
export const TECHNIQUE_SIGNALS: Readonly<Partial<Record<TechniqueId, readonly SignalCode[]>>> = /* @__PURE__ */ freezeTable<SignalCode>({
  'DET-001': CANVAS_SIGNALS,
  'DET-002': CANVAS_SIGNALS,
  'DET-003': ['api-use', 'text-drawn', 'text-measured'],
  'DET-004': CANVAS_SIGNALS,
  'DET-005': HOT_SIGNALS,
  'DET-011': HOT_SIGNALS,
  'DET-012': HOT_SIGNALS,
  'DET-015': ['api-use', 'offline-render'],
  'DET-022': ['api-use', 'numeric-diversity', 'sample-budget-exceeded'],
  'DET-025': HOT_SIGNALS,
  'DET-026': HOT_SIGNALS,
  'DET-029': HOT_SIGNALS,
  'DET-032': HOT_SIGNALS,
  'DET-033': HOT_SIGNALS,
});

const NO_OPERATIONS: readonly OperationCode[] = /* @__PURE__ */ Object.freeze([]);

/** Allowlisted operation codes of a technique in registry order; [] when the technique has none. */
export function pageOperations(techniqueId: TechniqueId): readonly OperationCode[] {
  return PAGE_OPERATIONS[techniqueId] ?? NO_OPERATIONS;
}

/** Local signal list of a technique; ['api-use'] when the technique declares none. */
export function techniqueSignals(techniqueId: TechniqueId): readonly SignalCode[] {
  return TECHNIQUE_SIGNALS[techniqueId] ?? DEFAULT_SIGNALS;
}

// Membership is checked with intrinsics captured at load (F168): page code may later poison Map/Set prototypes
// in the realm where this module runs.
const capturedApply = Reflect.apply;
const capturedMapGet = Map.prototype.get;
const capturedSetHas = Set.prototype.has;

const OPERATION_SETS: ReadonlyMap<string, ReadonlySet<string>> = /* @__PURE__ */ (() => {
  const map = new Map<string, ReadonlySet<string>>();
  for (const [techniqueId, list] of Object.entries(PAGE_OPERATIONS) as Array<[string, readonly OperationCode[]]>) {
    map.set(techniqueId, Object.freeze(new Set<string>(list)));
  }
  return Object.freeze(map);
})();

/** True when `op` is a string allowlisted for `techniqueId`. Never coerces `op`, never throws for primitives. */
export function isPageOperation(techniqueId: string, op: unknown): op is OperationCode {
  if (typeof op !== 'string' || typeof techniqueId !== 'string') return false;
  const set = capturedApply(capturedMapGet, OPERATION_SETS, [techniqueId]) as ReadonlySet<string> | undefined;
  return set !== undefined && (capturedApply(capturedSetHas, set, [op]) as boolean);
}
