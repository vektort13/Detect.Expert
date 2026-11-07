// ADR-008: presence of a network script never attributes a neighboring API call.
import type { AttributionConfidence, EvidenceSource, Integrity } from '@detect-expert/contracts';
export interface AttributionEvidence {
  evidenceSource: EvidenceSource;
  integrity: Integrity;
  frameBound: boolean;
  scriptKind?: 'external' | 'inline' | 'eval' | 'blob' | 'unknown';
  scriptUrl?: string;
}
export function attributionConfidence(e: AttributionEvidence): AttributionConfidence {
  if (e.scriptKind === 'inline' || e.scriptKind === 'eval' || e.scriptKind === 'blob' || e.scriptKind === 'unknown') return 'unknown';
  if (e.scriptKind === 'external' && e.evidenceSource === 'browser-network' && e.integrity === 'browser-observed' && e.scriptUrl) {
    try {
      const url = new URL(e.scriptUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') return 'exact-resource';
    } catch { /* Malformed resources stay unknown. */ }
    return 'unknown';
  }
  return e.frameBound ? 'frame-only' : 'unknown';
}
