// Action row: pause/resume, export preview, delete this document's report.
// S13 (E13-02): deleting asks for confirmation (ConfirmDialog) bound to the document shown when the dialog opened; if
// the document changes meanwhile, the dialog closes without deleting. Export without access stays focusable
// (aria-disabled) and is described by a visible reason instead of a silent `disabled`.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { ReportProjection } from '@detect-expert/contracts';
import { t } from '../i18n';
import type { ReportSession } from '../app/useReportSession';
import { exportAvailability } from '../view-models/export';
import { ConfirmDialog } from './ConfirmDialog';
import { PauseButton } from './PauseButton';

export function exportAllowed(report: ReportProjection | null): boolean {
  return exportAvailability(report) === 'allowed';
}

interface PendingClear {
  documentKey: string;
  host: string | null;
}

export interface ReportActionsProps {
  session: ReportSession;
  /** Prefix of element ids (popup / panel): the reason line and the confirmation dialog. */
  idPrefix: string;
}

function focusIfConnected(element: HTMLElement | null): void {
  if (element !== null && element.isConnected) element.focus();
}

export function ReportActions(props: ReportActionsProps) {
  const s = props.session;
  const report = s.report;
  const disabled = report === null;
  const paused = report !== null && report.coverageState === 'paused';
  const availability = exportAvailability(report);
  const exportReasonId = props.idPrefix + '-export-reason';
  const [pending, setPending] = useState<PendingClear | null>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  const currentKey = report?.documentKey ?? null;

  useEffect(() => {
    // Another document is shown now: close without deleting anything.
    if (pending !== null && pending.documentKey !== currentKey) setPending(null);
  }, [pending, currentKey]);

  const cancel = (): void => {
    setPending(null);
    focusIfConnected(invokerRef.current);
  };

  const confirm = (): void => {
    const target = pending;
    setPending(null);
    focusIfConnected(invokerRef.current);
    if (target !== null) void s.clear(target.documentKey);
  };

  return (
    <div class="actions actions--wrap" aria-busy={s.busy}>
      <PauseButton paused={paused} busy={s.busy} disabled={disabled} onToggle={() => void (paused ? s.resume() : s.pause())} />
      <button
        type="button"
        class="button"
        aria-disabled={s.busy || availability !== 'allowed'}
        aria-describedby={availability === 'allowed' ? undefined : exportReasonId}
        onClick={() => {
          if (availability === 'allowed') void s.openExport();
        }}
      >
        {t('action_export')}
      </button>
      <button
        type="button"
        class="button"
        aria-disabled={s.busy}
        disabled={disabled}
        onClick={(event) => {
          if (report === null || s.busy) return;
          invokerRef.current = event.currentTarget;
          setPending({ documentKey: report.documentKey, host: report.host });
        }}
      >
        {t('action_clear')}
      </button>
      {availability !== 'allowed' ? (
        <p id={exportReasonId} class="actions__reason small muted">
          {t(availability)}
        </p>
      ) : null}
      {pending !== null ? (
        <ConfirmDialog
          id={props.idPrefix + '-confirm-clear'}
          title={t('confirm_clear_title')}
          description={t('confirm_clear_desc', [pending.host ?? t('host_unknown')])}
          confirmLabel={t('confirm_clear_action')}
          onConfirm={confirm}
          onCancel={cancel}
        />
      ) : null}
    </div>
  );
}
