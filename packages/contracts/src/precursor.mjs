// DET-CF-PRECURSOR-001 / REQ-005/008/009/011/012, ADR-009/073/074: metadata-only, read-only Precursor channel.
// A mode is deliberately unavailable until an independently verified mode signal exists.
export const PRECURSOR_RULE_IDS = Object.freeze(['cf-precursor-versioned-loader-v1']);
const coverage = new Set(['active', 'partial', 'late-start', 'paused', 'unsupported', 'no-access', 'degraded']);
const own = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
const integer = value => Number.isSafeInteger(value) && value >= 0;
function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length &&
    keys.every(key => { const field = Object.getOwnPropertyDescriptor(value, key); return field?.enumerable && Object.hasOwn(field, 'value'); });
}
function documentParts(value) {
  if (typeof value !== 'string' || value.length > 160 || !/^(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*):[A-Za-z0-9_-]{1,64}$/.test(value)) return null;
  const [tab, frame] = value.split(':');
  return integer(Number(tab)) && integer(Number(frame)) ? [Number(tab), Number(frame)] : null;
}
export function readPrecursorRequest(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'tabId', 'frameId', 'documentKey']) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'ui-get-precursor') return null;
    const tabId = own(value, 'tabId'), frameId = own(value, 'frameId'), documentKey = own(value, 'documentKey'), parts = documentParts(documentKey);
    if (!integer(tabId) || !integer(frameId) || !parts || parts[0] !== tabId || parts[1] !== frameId) return null;
    return { schemaVersion: 1, type: 'ui-get-precursor', tabId, frameId, documentKey };
  } catch { return null; }
}
export function readPrecursorSnapshot(value) {
  try {
    const keys = ['schemaVersion', 'type', 'documentKey', 'coverageState', 'presence', 'mode', 'lastObservedAt', 'ruleIds', 'evidenceSource', 'integrity', 'capabilities', 'truncated'];
    if (!exact(value, keys) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'precursor-state' || !documentParts(own(value, 'documentKey')) ||
      !coverage.has(own(value, 'coverageState')) || !['observed', 'not-observed'].includes(own(value, 'presence')) || own(value, 'mode') !== 'unknown' || typeof own(value, 'truncated') !== 'boolean') return null;
    const capabilities = own(value, 'capabilities');
    if (!exact(capabilities, ['presenceDetection', 'modeDetection']) || typeof own(capabilities, 'presenceDetection') !== 'boolean' || own(capabilities, 'modeDetection') !== false) return null;
    const inputRules = own(value, 'ruleIds'), ruleIds = [], length = own(inputRules ?? {}, 'length');
    if (!Array.isArray(inputRules) || !integer(length) || length > PRECURSOR_RULE_IDS.length || Reflect.ownKeys(inputRules).length !== length + 1) return null;
    for (let index = 0; index < length; ++index) {
      const field = Object.getOwnPropertyDescriptor(inputRules, String(index));
      if (!field?.enumerable || !Object.hasOwn(field, 'value') || !PRECURSOR_RULE_IDS.includes(field.value) || ruleIds.includes(field.value)) return null;
      ruleIds.push(field.value);
    }
    const observed = own(value, 'presence') === 'observed';
    if (observed) {
      if (!own(capabilities, 'presenceDetection') || !integer(own(value, 'lastObservedAt')) || !ruleIds.length ||
        !['browser-network', 'browser-resource-timing'].includes(own(value, 'evidenceSource')) || own(value, 'integrity') !== 'browser-observed' || ['paused', 'unsupported', 'no-access'].includes(own(value, 'coverageState'))) return null;
      if (own(value, 'evidenceSource') === 'browser-resource-timing' && own(value, 'coverageState') !== 'partial') return null;
    } else if (own(value, 'lastObservedAt') !== null || ruleIds.length || own(value, 'evidenceSource') !== null || own(value, 'integrity') !== null) return null;
    if (['paused', 'unsupported', 'no-access'].includes(own(value, 'coverageState')) && own(capabilities, 'presenceDetection')) return null;
    return { schemaVersion: 1, type: 'precursor-state', documentKey: own(value, 'documentKey'), coverageState: own(value, 'coverageState'),
      presence: own(value, 'presence'), mode: 'unknown', lastObservedAt: own(value, 'lastObservedAt'), ruleIds,
      evidenceSource: own(value, 'evidenceSource'), integrity: own(value, 'integrity'),
      capabilities: { presenceDetection: own(capabilities, 'presenceDetection'), modeDetection: false }, truncated: own(value, 'truncated') };
  } catch { return null; }
}
