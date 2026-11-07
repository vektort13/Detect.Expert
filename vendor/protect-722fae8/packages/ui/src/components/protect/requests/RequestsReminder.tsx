// ADR-020 §I (S14): popup reminder about data requests whose approximate deadline is close or has passed. One
// `ui-protect-requests-get {view:'summary'}` when the popup opens, only while the module is active; nothing is shown
// (and nothing else is asked) when no request is due soon or overdue. The extension does not observe answers: the
// deadline is the user's own record.

import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { t, tm } from '../../../i18n';
import { protectUi } from '../../../messaging';
import { msg } from '../../../view-models/message';
import { parseRequestsJournal, reminderCounts } from '../../../view-models/protect-requests';
import type { ProtectPopupSlotProps } from '../ProtectPopupArea';
import { openRequestsPage } from './open';

export function RequestsReminder(props: ProtectPopupSlotProps): JSX.Element | null {
  const active = props.state.state === 'active';
  const [counts, setCounts] = useState<{ soon: number; overdue: number } | null>(null);

  useEffect(() => {
    if (!active) {
      setCounts(null);
      return;
    }
    let live = true;
    void protectUi.requestsGet({ view: 'summary' }).then((result) => {
      if (!live) return;
      const journal = result.ok ? parseRequestsJournal(result.response) : null;
      setCounts(reminderCounts(journal?.summary ?? null));
    });
    return () => {
      live = false;
    };
  }, [active]);

  if (!active || counts === null) return null;
  return (
    <div class={'requests-reminder' + (counts.overdue > 0 ? ' requests-reminder--overdue' : '')} data-requests-reminder="true">
      <p class="requests-reminder__text">{tm(msg('protect_req_reminder', counts.soon, counts.overdue))}</p>
      <button type="button" class="button button--text small" data-requests-open="true" onClick={() => void openRequestsPage()}>
        {t('protect_req_open_journal')}
      </button>
    </div>
  );
}
