// Geometry sensor: DET-005 (element size and position reads). Task E07-02, S06; spec III §2.1 row DET-005; REQ-001,
// REQ-002, REQ-003, REQ-005, REQ-011; ADR-006, ADR-017 §5.
//
// Observed: which member the page called (operation code) and the phase. Never read or recorded: the element, its
// text or font, the returned rectangles and sizes. The observer does not touch `this`, so it never forces layout.
//   - Element.prototype getBoundingClientRect / getClientRects -> `get-bounding-client-rect` / `get-client-rects`
//     (methods; FAMILY_CONFIG.rectMethods);
//   - HTMLElement.prototype offsetWidth / offsetHeight -> `offset-width` / `offset-height` (getters;
//     FAMILY_CONFIG.offsetGetters).
// Modes come from the S03 perf-gate (docs/coverage/perf/getters-spike.md): 'wrap' = permanent hot hook, 'retire' =
// hot hook that restores the original descriptor after retireAfter observed calls (lower-bound count plus a
// sample-budget-exceeded marker), 'off' = not wrapped (the operation codes stay reserved). Layout code reads these
// members constantly, so DET-005 alone is never more than api-use (no rule claims it). Range/SVG geometry (DET-006/
// 007), fonts (DET-008) and computed style (DET-010) are outside this family.

import type { OperationCode } from '@detect-expert/contracts';
import { FAMILY_CONFIG, hotLimit } from './families';
import type { FamilyConfig, HotMode } from './families';
import { wrapHotGetter, wrapHotMethod } from './hot';
import { arrayPush } from './intrinsics';
import { prototypeOf } from './realm';
import type { SensorRuntime } from './runtime';
import type { WrapResult } from './wrap';

const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

const ELEMENT = 'Element';
const HTML_ELEMENT = 'HTMLElement';

export interface GeometrySensor {
  /** One entry per attempted hook (installed or unsupported), in install order. */
  results: WrapResult[];
  /** Interfaces absent from the realm, or `Interface.member` that is not an own property (not a failure). */
  skipped: string[];
  /** `Interface.member` left unwrapped because its FAMILY_CONFIG group is 'off'. */
  off: string[];
}

/**
 * Installs the geometry hooks on `realm` (the window) and registers them with the runtime. `config` defaults to the
 * perf-gate decisions (families.ts); tests pass another mode. Repeated calls in the same module instance return the
 * same handles (wrap.ts registry) and add no observer.
 */
export function installGeometrySensor(runtime: SensorRuntime, realm: object = globalThis, config: FamilyConfig = FAMILY_CONFIG): GeometrySensor {
  const results: WrapResult[] = [];
  const skipped: string[] = [];
  const off: string[] = [];

  const install = (name: string, keys: readonly string[], ops: readonly OperationCode[], kind: 'getter' | 'method', mode: HotMode): void => {
    const proto = prototypeOf(realm, name);
    if (proto === null) {
      arrayPush(skipped, name);
      return;
    }
    const limit = mode === 'off' ? null : hotLimit(mode, config);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      if (getOwnPropertyDescriptor(proto, key) === undefined) {
        arrayPush(skipped, name + '.' + key);
        continue;
      }
      if (mode === 'off') {
        arrayPush(off, name + '.' + key);
        continue;
      }
      const spec = { technique: 'DET-005' as const, op: ops[i]!, limit };
      arrayPush(results, kind === 'getter' ? wrapHotGetter(runtime, proto, key, spec) : wrapHotMethod(runtime, proto, key, spec));
    }
  };

  try {
    install(ELEMENT, ['getBoundingClientRect', 'getClientRects'], ['get-bounding-client-rect', 'get-client-rects'], 'method', config.rectMethods);
    install(HTML_ELEMENT, ['offsetWidth', 'offsetHeight'], ['offset-width', 'offset-height'], 'getter', config.offsetGetters);
  } finally {
    // A throwing realm lookup must not strand installed hooks outside ownership-checked cleanup (ADR-006 §8).
    runtime.attach(results);
  }
  return { results, skipped, off };
}
