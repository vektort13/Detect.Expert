// Cheap gate for page-controlled window messages (ADR-004 §5, spec A6): type, array length, string length,
// nesting depth and number finiteness are checked before the shared validator runs. Garbage lowers the
// sender's budget (a dropped counter) and never produces a diagnostic log of the payload. Everything that
// passes is still `integrity: page-controlled` (REQ-004).

import { BUDGETS, CHANNEL, readExtensionResource, validateSensorMessage } from '@detect-expert/contracts';
import type { SensorMessage } from '@detect-expert/contracts';

export type IngestResult =
  /** Not addressed to the bridge: foreign source, non-object, no channel tag, or the bridge's own echo. */
  | { kind: 'ignore' }
  /** Tagged with the bridge channel but fails the shape gate or the validator. */
  | { kind: 'malformed' }
  | { kind: 'sensor'; message: SensorMessage };

const IGNORE: IngestResult = { kind: 'ignore' };
const MALFORMED: IngestResult = { kind: 'malformed' };

const SENSOR_TYPES: ReadonlySet<string> = new Set(['sensor-hello', 'sensor-batch', 'sensor-status', 'sensor-reset']);
/** The bridge's own messages come back through the same window listener. */
const BRIDGE_TYPES: ReadonlySet<string> = new Set(['bridge-hello', 'bridge-pause', 'bridge-resume', 'bridge-stop', 'bridge-reset']);
/** Every sensor message has exactly six top-level keys. */
const MAX_TOP_LEVEL_KEYS = 6;
const MAX_TYPE_CHARS = 32;

export function ingestWindowMessage(fromSelf: boolean, data: unknown): IngestResult {
  if (!fromSelf) return IGNORE;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return IGNORE;
  try {
    return gate(data as Record<string, unknown>);
  } catch {
    // Hostile getters/proxies cannot survive structured clone, but the gate must never throw regardless.
    return MALFORMED;
  }
}

function gate(data: Record<string, unknown>): IngestResult {
  if (data['channel'] !== CHANNEL) return IGNORE;
  const type = data['type'];
  if (typeof type !== 'string' || type.length > MAX_TYPE_CHARS) return MALFORMED;
  if (BRIDGE_TYPES.has(type)) return IGNORE;
  // ui-* and every unknown type stop here: only sensor messages are ever forwarded (E04-02 case 4).
  if (!SENSOR_TYPES.has(type)) return MALFORMED;
  if (Object.keys(data).length > MAX_TOP_LEVEL_KEYS) return MALFORMED;
  const bootId = data['sensorBootId'];
  if (typeof bootId !== 'string' || bootId.length === 0 || bootId.length > BUDGETS.maxIdChars) return MALFORMED;
  if (type === 'sensor-batch' && !observationsLookSane(data['observations'])) return MALFORMED;
  const result = validateSensorMessage(data);
  return result.ok ? { kind: 'sensor', message: result.value } : MALFORMED;
}

/** Primitives/flat signal arrays, plus the exact two-field ADR-028 resource metadata. */
function observationsLookSane(observations: unknown): boolean {
  if (!Array.isArray(observations)) return false;
  if (observations.length < 1 || observations.length > BUDGETS.maxBatchEvents) return false;
  for (const item of observations) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false;
    // Shape before values: enumeration still costs O(keys), but surplus values are never read (F118).
    if (Object.keys(item).length > 7) return false;
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      if (key === 'extensionResource') {
        if (readExtensionResource(value) === null) return false;
        continue;
      }
      if (typeof value === 'string') {
        if (value.length > BUDGETS.maxStringChars) return false;
      } else if (typeof value === 'number') {
        if (!Number.isFinite(value)) return false;
      } else if (Array.isArray(value)) {
        if (value.length > BUDGETS.maxSignalCodesPerObservation) return false;
        for (const s of value) if (typeof s !== 'string' || s.length > BUDGETS.maxStringChars) return false;
      } else {
        return false;
      }
    }
  }
  return true;
}
