// ADR-020 §I (S14): Options section «Запросы о персональных данных» (#requests): what the generator does, the journal
// volume, «Открыть журнал запросов», «Новый запрос без наблюдений» (module active only) and «Удалить весь журнал»
// after a confirmation. Mounted by the «Защита» tab of Options (the S06 layout decides when the tab exists); shown while
// the module is not off, or while it is off but the journal still has records (view, export, deletion only).

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t, tm } from '../../../i18n';
import { errorMessageKey, protectUi } from '../../../messaging';
import { msg } from '../../../view-models/message';
import { parseRequestsJournal, requestsComposerAvailable } from '../../../view-models/protect-requests';
import type { RequestsJournalView } from '../../../view-models/protect-requests';
import { ConfirmDialog } from '../../ConfirmDialog';
import type { ProtectOptionsSlotProps } from '../ProtectOptionsPanel';
import { openRequestsPage } from './open';

export function RequestsOptionsSection(props: ProtectOptionsSlotProps): JSX.Element | null {
  const state = props.state;
  const [journal, setJournal] = useState<RequestsJournalView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const clearRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    void protectUi.requestsGet({ view: 'summary' }).then((result) => {
      if (live) setJournal(result.ok ? parseRequestsJournal(result.response) : null);
    });
    return () => {
      live = false;
    };
  }, [state.state, reload]);

  if (state.state === 'off' && (journal === null || journal.summary.total === 0)) return null;

  const clearAll = async (): Promise<void> => {
    setConfirm(false);
    setBusy(true);
    const result = await protectUi.purge('requests');
    setBusy(false);
    setNotice(result.ok ? t('protect_req_cleared') : t(errorMessageKey(result.code)));
    setReload((n) => n + 1);
    await props.refreshState();
    clearRef.current?.focus();
  };

  return (
    <section id="requests" class="section requests-options" aria-labelledby="requests-options-title" data-requests-options="true">
      <h2 id="requests-options-title" class="section__title">{t('protect_req_page_title')}</h2>
      <p>{t('protect_req_intro')}</p>
      <p class="small muted">{t('protect_req_not_legal_advice')}</p>
      {journal !== null ? (
        <p data-requests-summary="true">{tm(msg('protect_req_options_summary', journal.summary.total, journal.summary.dueSoon, journal.summary.overdue))}</p>
      ) : null}
      <p class="small muted">{t('protect_req_retention')}</p>
      <p class="actions">
        <button type="button" class="button" data-requests-open="true" onClick={() => void openRequestsPage()}>
          {t('protect_req_open_journal')}
        </button>
        {requestsComposerAvailable(state) ? (
          <button type="button" class="button" data-requests-new="manual" onClick={() => void openRequestsPage({ sourceKind: 'manual' })}>
            {t('protect_req_new_manual')}
          </button>
        ) : null}
        {journal !== null && journal.summary.total > 0 ? (
          <button ref={clearRef} type="button" class="button" disabled={busy || props.busy} data-requests-clear="true" onClick={() => setConfirm(true)}>
            {t('protect_req_clear_all')}
          </button>
        ) : null}
      </p>
      {notice !== null ? <p class="small" role="status">{notice}</p> : null}
      {confirm ? (
        <ConfirmDialog
          id="requests-clear-confirm"
          title={t('protect_req_clear_confirm')}
          description={t('protect_req_clear_desc')}
          confirmLabel={t('protect_req_clear_all')}
          onConfirm={() => void clearAll()}
          onCancel={() => {
            setConfirm(false);
            clearRef.current?.focus();
          }}
        />
      ) : null}
    </section>
  );
}
