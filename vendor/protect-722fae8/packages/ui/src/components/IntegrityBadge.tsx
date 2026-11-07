// Trust-axis badge: integrity (browser-observed / page-controlled / derived) plus the evidence source.
// Text carries the meaning; the border style only reinforces it.

import type { EvidenceSource, Integrity } from '@detect-expert/contracts';
import { t } from '../i18n';

export function integrityKey(integrity: Integrity): string {
  return 'integrity_' + integrity.replace(/-/g, '_');
}

export function evidenceKey(source: EvidenceSource): string {
  return 'evidence_' + source.replace(/-/g, '_');
}

export function IntegrityBadge(props: { integrity: Integrity; evidenceSource: EvidenceSource }) {
  return (
    <span class="badge-row">
      <span class={'badge badge--' + props.integrity}>{t(integrityKey(props.integrity))}</span>
      <span class="muted small">{t(evidenceKey(props.evidenceSource))}</span>
    </span>
  );
}
