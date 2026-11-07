// ADR-020 §B, §D (S07): side-panel details of «Передача введённых данных» — every transfer record of the shown tab,
// expanded, with the module's coverage, document-level limitations and the fixed notes (unobserved channels; passwords
// are never read). Empty: «не наблюдалось в доступной области за этот период» (never «передачи не было»).

import type { JSX } from 'preact';
import { t, tm } from '../../../i18n';
import { evidenceListView } from '../../../view-models/protect-evidence';
import type { ProtectPanelSlotProps } from '../ProtectSidepanel';
import { EvidenceItem } from './EvidenceList';
import { PrepareRequestButton } from '../requests/PrepareRequestButton';

export function EvidenceDetails(props: ProtectPanelSlotProps): JSX.Element | null {
  if (!props.state.features.includes('value-match')) return null;
  const vm = evidenceListView(props.report, null);
  if (vm === null) return null;
  return (
    <section class="leaks leaks--panel" aria-labelledby="panel-leaks-title" data-protect-leaks="panel">
      <h3 id="panel-leaks-title" class="leaks__title">
        {t('protect_leak_section_title')}
      </h3>
      {vm.coverage !== null ? <p class="leaks__coverage small muted">{tm(vm.coverage)}</p> : null}
      {vm.empty !== null ? (
        <p class="leaks__empty small">{tm(vm.empty)}</p>
      ) : (
        <ul class="leaks__list">
          {vm.rows.map((row) => (
            <li key={row.id}>
              <EvidenceItem row={row} open={true} />
              {props.state.state === 'active' ? <PrepareRequestButton sourceKind="evidence" recordId={row.id} /> : null}
            </li>
          ))}
        </ul>
      )}
      {vm.previous !== null ? <p class="small muted">{tm(vm.previous)}</p> : null}
      <ul class="leaks__notes small muted">
        {vm.notes.map((m, i) => (
          <li key={String(i)}>{tm(m)}</li>
        ))}
      </ul>
    </section>
  );
}
