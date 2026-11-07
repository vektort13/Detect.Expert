// ADR-020 §I (S14): «Подготовить запрос о данных» next to an evidence record (side panel, S07) or a history receiver
// card (S12). Opens requests.html#new=<source>.<id>; the SW builds the draft from that record. Shown only while the
// module is active (the caller decides).

import type { JSX } from 'preact';
import { t } from '../../../i18n';
import { openRequestsPage } from './open';

export interface PrepareRequestButtonProps {
  sourceKind: 'evidence' | 'history';
  recordId: string;
}

export function PrepareRequestButton(props: PrepareRequestButtonProps): JSX.Element {
  return (
    <button
      type="button"
      class="button button--text small requests-entry"
      data-request-entry={props.sourceKind}
      onClick={() => void openRequestsPage({ sourceKind: props.sourceKind, recordId: props.recordId })}
    >
      {t('protect_req_entry')}
    </button>
  );
}
