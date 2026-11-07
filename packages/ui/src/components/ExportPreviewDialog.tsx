// Export preview (REQ-013, E14-01): shows the exact redacted JSON that will be saved, the field list and the
// host warning; the file is produced only after «Сохранить файл». Native <dialog> keeps focus inside.

import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { ExportPreview } from '@detect-expert/contracts';
import { t, tm } from '../i18n';
import type { SessionNotice } from '../app/useReportSession';
import { buildExportDownload, exportFieldPaths } from '../view-models/export';

export interface ExportPreviewDialogProps {
  preview: ExportPreview | null;
  host: string | null;
  onIncludeHost: (include: boolean) => void;
  status: SessionNotice | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ExportPreviewDialog(props: ExportPreviewDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const preview = props.preview;
  const download = useMemo(() => (preview === null ? null : buildExportDownload(preview)), [preview]);
  const fields = useMemo(() => (preview === null ? [] : exportFieldPaths(preview)), [preview]);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (preview !== null && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (preview === null && dialog.open) {
      dialog.close();
    }
  }, [preview]);

  return (
    <dialog
      ref={ref}
      class="dialog"
      aria-labelledby="export-title"
      onCancel={(event) => {
        event.preventDefault();
        props.onCancel();
      }}
    >
      {preview !== null && download !== null ? (
        <div class="dialog__body">
          <h2 id="export-title" class="section__title">
            {t('export_preview_title')}
          </h2>
          <p>{t('export_preview_desc')}</p>
          {props.host !== null ? (
            <label class="export-host">
              <input type="checkbox" checked={preview.report.host !== null} onChange={(event) => props.onIncludeHost(event.currentTarget.checked)} />
              {' '}{t('export_include_host')} <span class="mono" dir="auto">{props.host}</span>
            </label>
          ) : null}
          {preview.report.host !== null ? (
            <p class="state state--attention">
              {t('export_host_warning', [preview.report.host])}
            </p>
          ) : null}
          <h3 class="small">{t('export_fields_title')}</h3>
          <ul class="codes mono small">
            {fields.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
          <details class="card__details">
            <summary>{t('export_json_title')}</summary>
            <pre class="json" tabIndex={0}>
              {download.text}
            </pre>
          </details>
          <p class="small muted mono">{download.fileName}</p>
          {props.status !== null ? <p class={'state state--' + props.status.tone}>{tm(props.status.message)}</p> : null}
          <p class="actions">
            <button type="button" class="button" onClick={props.onCancel}>
              {t('action_cancel')}
            </button>
            <button type="button" class="button button--primary" onClick={props.onConfirm}>
              {t('export_save')}
            </button>
          </p>
        </div>
      ) : null}
    </dialog>
  );
}
