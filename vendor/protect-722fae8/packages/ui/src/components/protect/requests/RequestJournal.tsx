// ADR-020 §I (S14): the request journal of requests.html. Statuses are set by the user (the extension does not observe
// sending, delivery or answers); after «отправлен» the approximate deadline is shown with its basis and the note that
// it counts from the sending day and ignores public holidays. «Добавить срок в календарь (.ics)» previews the file
// (no site or observation in it), «Повторить письмо» reopens the composer, deletion asks first, export previews the
// exact file (observations only when ticked). While the module is not active the journal is read-only: view, export,
// deletion.

import type { JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import type { DeletionRequestRecord, LocalDay, RequestStatus } from '@detect-expert/contracts';
import { t, tm, uiLocale } from '../../../i18n';
import { errorMessageKey, protectUi } from '../../../messaging';
import { joinMessages, msg } from '../../../view-models/message';
import {
  REQUEST_KIND_KEYS,
  REQUEST_LAW_KEYS,
  REQUEST_MARK_KEYS,
  parseRequestsJournal,
  requestExportDownload,
  requestIcsDownload,
  requestRowView,
} from '../../../view-models/protect-requests';
import type { RequestsJournalView } from '../../../view-models/protect-requests';
import { ConfirmDialog } from '../../ConfirmDialog';
import { RequestFileDialog } from './RequestFileDialog';

export interface RequestJournalProps {
  journal: RequestsJournalView;
  today: LocalDay;
  /** The module is active: status changes, .ics and «Повторить письмо». */
  editable: boolean;
  onChanged: (journal: RequestsJournalView) => void;
  /** Re-reads the journal after stale-revision; the new revision or null. */
  reload: () => Promise<number | null>;
  onRepeat: (record: DeletionRequestRecord) => void;
}

type Mutation = (revision: number) => ReturnType<typeof protectUi.requestDelete>;

interface RowProps {
  record: DeletionRequestRecord;
  today: LocalDay;
  editable: boolean;
  busy: boolean;
  mutate: (run: Mutation, invoker: HTMLElement | null) => Promise<boolean>;
  onIcs: (record: DeletionRequestRecord, invoker: HTMLElement) => void;
  onDelete: (record: DeletionRequestRecord, invoker: HTMLElement) => void;
  onRepeat: (record: DeletionRequestRecord) => void;
}

function RequestRow(props: RowProps): JSX.Element {
  const locale = uiLocale();
  const r = props.record;
  const view = requestRowView(r, props.today, locale);
  const [next, setNext] = useState<Exclude<RequestStatus, 'prepared'> | ''>(view.next[0] ?? '');
  const [day, setDay] = useState<string>(props.today);
  const titleId = 'request-' + r.requestId + '-title';
  const dueClass = view.due === null ? '' : ' requests-due--' + view.due.state;
  const chosen = view.next.includes(next as Exclude<RequestStatus, 'prepared'>) ? (next as Exclude<RequestStatus, 'prepared'>) : (view.next[0] ?? null);

  return (
    <li class="requests-row" aria-labelledby={titleId} data-request-row={r.requestId} data-request-status={r.status}>
      <h3 id={titleId} class="requests-row__title">{r.subject.entityName}</h3>
      <p class="requests-row__line">
        {tm(view.law)} · {tm(msg('protect_req_kinds_line', joinMessages(view.kinds)))}
      </p>
      <p class="requests-row__line small">
        {tm(view.created)} · <span data-request-status-text="true">{tm(view.status)}</span>
      </p>
      <p class="requests-row__line small muted">
        {view.recipient !== null ? <span class="mono" dir="ltr">{tm(view.recipient)} · </span> : null}
        {tm(view.delivery)}
        {view.factCount > 0 ? ' · ' + tm(msg('protect_req_facts_count', view.factCount)) : ''}
      </p>
      {view.due !== null ? (
        <div class={'requests-due' + dueClass} data-request-due={view.due.state}>
          <p class="requests-due__line">{tm(view.due.message)}</p>
          <p class="small">{tm(view.due.basis)}</p>
        </div>
      ) : null}
      <div class="requests-row__actions">
        {props.editable && chosen !== null ? (
          <div class="requests-status" data-request-status-form="true">
            <label class="field">
              <span>{t('protect_req_status_new')}</span>
              <select value={chosen} data-request-next="true" onChange={(e) => setNext(e.currentTarget.value as Exclude<RequestStatus, 'prepared'>)}>
                {view.next.map((s) => (
                  <option key={s} value={s}>{t(REQUEST_MARK_KEYS[s])}</option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>{t('protect_req_status_day')}</span>
              <input type="date" value={day} min={r.createdDay} max={props.today} data-request-day="true" onInput={(e) => setDay(e.currentTarget.value)} />
            </label>
            <button
              type="button"
              class="button"
              disabled={props.busy}
              data-request-apply="true"
              onClick={(event) => {
                const invoker = event.currentTarget;
                void props.mutate((revision) => protectUi.requestStatus({ expectedRevision: revision, requestId: r.requestId, status: chosen, day }), invoker);
              }}
            >
              {t('protect_req_status_apply')}
            </button>
          </div>
        ) : null}
        <p class="actions">
          {props.editable && view.due !== null ? (
            <button type="button" class="button" data-request-ics="true" onClick={(e) => props.onIcs(r, e.currentTarget)}>
              {t('protect_req_ics')}
            </button>
          ) : null}
          {props.editable ? (
            <button type="button" class="button" data-request-repeat="true" onClick={() => props.onRepeat(r)}>
              {t('protect_req_repeat')}
            </button>
          ) : null}
          <button type="button" class="button button--text" disabled={props.busy} data-request-delete="true" onClick={(e) => props.onDelete(r, e.currentTarget)}>
            {t('protect_req_delete')}
          </button>
        </p>
      </div>
    </li>
  );
}

export function RequestJournal(props: RequestJournalProps): JSX.Element {
  const records = props.journal.requests ?? [];
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DeletionRequestRecord | null>(null);
  const [ics, setIcs] = useState<DeletionRequestRecord | null>(null);
  const [exporting, setExporting] = useState(false);
  const [includeFacts, setIncludeFacts] = useState(false);
  const invoker = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const exportRef = useRef<HTMLButtonElement>(null);

  const mutate = async (run: Mutation, from: HTMLElement | null): Promise<boolean> => {
    setBusy(true);
    let result = await run(props.journal.revision);
    if (!result.ok && result.code === 'stale-revision') {
      const fresh = await props.reload();
      if (fresh !== null) result = await run(fresh);
    }
    setBusy(false);
    const journal = result.ok ? parseRequestsJournal(result.response) : null;
    if (journal === null) {
      setNotice(t(errorMessageKey(result.ok ? 'unavailable' : result.code)));
      from?.focus();
      return false;
    }
    setNotice(null);
    props.onChanged(journal);
    return true;
  };

  const icsDownload = useMemo(() => {
    if (ics === null) return null;
    const kinds = joinMessages(ics.kinds.map((k) => msg(REQUEST_KIND_KEYS[k])));
    return requestIcsDownload(ics, props.today, {
      summary: t('protect_req_ics_summary'),
      description: tm(msg('protect_req_ics_description', msg(REQUEST_LAW_KEYS[ics.jurisdiction]), kinds)),
      alarm: t('protect_req_ics_alarm'),
    }, Date.now());
  }, [ics, props.today]);

  const exportFile = useMemo(() => (exporting ? requestExportDownload(records, includeFacts, props.today).download : null), [exporting, records, includeFacts, props.today]);

  return (
    <section class="section requests-journal" aria-labelledby="requests-journal-title" data-requests-journal={props.editable ? 'editable' : 'read-only'}>
      <h2 id="requests-journal-title" ref={headingRef} class="section__title" tabIndex={-1}>{t('protect_req_journal_title')}</h2>
      {props.journal.droppedRecords > 0 ? <p class="state state--attention small">{tm(msg('protect_req_dropped', props.journal.droppedRecords))}</p> : null}
      {records.length === 0 ? (
        <p class="small muted" data-requests-empty="true">{t('protect_req_journal_empty')}</p>
      ) : (
        <ul class="requests-list">
          {records.map((r) => (
            <RequestRow
              key={r.requestId}
              record={r}
              today={props.today}
              editable={props.editable}
              busy={busy}
              mutate={mutate}
              onIcs={(rec, from) => {
                invoker.current = from;
                setIcs(rec);
              }}
              onDelete={(rec, from) => {
                invoker.current = from;
                setPendingDelete(rec);
              }}
              onRepeat={props.onRepeat}
            />
          ))}
        </ul>
      )}
      <ul class="small muted requests-notes">
        <li>{t('protect_req_deadline_note')}</li>
        <li>{t('protect_req_retention')}</li>
        <li>{t('protect_req_journal_storage')}</li>
      </ul>
      {notice !== null ? <p class="state state--attention small" aria-live="polite" data-requests-journal-notice="true">{notice}</p> : null}
      {records.length > 0 ? (
        <p class="actions">
          <button ref={exportRef} type="button" class="button" data-requests-export="true" onClick={() => setExporting(true)}>
            {t('protect_req_export')}
          </button>
        </p>
      ) : null}
      {pendingDelete !== null ? (
        <ConfirmDialog
          id="request-delete-confirm"
          title={t('protect_req_delete_confirm')}
          description={t('protect_req_delete_desc')}
          confirmLabel={t('protect_req_delete')}
          onConfirm={() => {
            const rec = pendingDelete;
            setPendingDelete(null);
            void mutate((revision) => protectUi.requestDelete({ expectedRevision: revision, requestId: rec.requestId }), invoker.current).then((ok) => {
              if (ok) headingRef.current?.focus();
            });
          }}
          onCancel={() => {
            setPendingDelete(null);
            invoker.current?.focus();
          }}
        />
      ) : null}
      {ics !== null ? (
        <RequestFileDialog
          id="request-ics-dialog"
          title={t('protect_req_ics_title')}
          description={t('protect_req_ics_desc')}
          download={icsDownload}
          onClose={() => {
            setIcs(null);
            invoker.current?.focus();
          }}
        />
      ) : null}
      {exporting ? (
        <RequestFileDialog
          id="requests-export-dialog"
          title={t('protect_req_export')}
          description={t('protect_req_export_desc')}
          download={exportFile}
          onClose={() => {
            setExporting(false);
            setIncludeFacts(false);
            exportRef.current?.focus();
          }}
        >
          <label class="export-host">
            <input type="checkbox" checked={includeFacts} data-requests-export-facts="true" onChange={(e) => setIncludeFacts(e.currentTarget.checked)} />
            {' '}{t('protect_req_export_include_facts')}
          </label>
          {includeFacts ? <p class="state state--attention small" data-requests-export-warning="true">{t('protect_req_export_facts_warning')}</p> : null}
        </RequestFileDialog>
      ) : null}
    </section>
  );
}
