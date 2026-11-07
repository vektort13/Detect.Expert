// ADR-020 §G, REQ-013 (S12): export preview of the history. The SW builds the preview (sites as site-N unless «Включить
// названия сайтов» is ticked, with a warning); the dialog shows the exact file text and saves exactly that text.
// Native modal <dialog>; Escape and «Отмена» close it and the caller returns the focus.

import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { HistoryExport } from '@detect-expert/contracts';
import { triggerDownload } from '../../../download';
import { t } from '../../../i18n';
import { errorMessageKey, protectUi } from '../../../messaging';
import { historyExportDownload, parseHistoryExport } from '../../../view-models/protect-history';

export interface HistoryExportDialogProps {
  onClose: () => void;
}

export function HistoryExportDialog(props: HistoryExportDialogProps): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const [includeSites, setIncludeSites] = useState(false);
  const [preview, setPreview] = useState<HistoryExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const download = useMemo(() => (preview === null ? null : historyExportDownload(preview)), [preview]);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) {
      try {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      } catch {
        dialog.setAttribute('open', '');
      }
    }
    return () => {
      try {
        if (dialog?.open === true) dialog.close();
      } catch {
        // already detached
      }
    };
  }, []);

  useEffect(() => {
    let live = true;
    setPreview(null);
    void protectUi.historyExport({ includeSites }).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setError(errorMessageKey(result.code));
        return;
      }
      const parsed = parseHistoryExport(result.response);
      // The preview must say what was asked: names only with the box ticked.
      if (parsed === null || parsed.sitesIncluded !== includeSites) {
        setError(errorMessageKey('unavailable'));
        return;
      }
      setError(null);
      setPreview(parsed);
    });
    return () => {
      live = false;
    };
  }, [includeSites]);

  return (
    <dialog
      ref={ref}
      id="history-export-dialog"
      class="dialog history-export"
      aria-labelledby="history-export-title"
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onClose={() => props.onClose()}
    >
      <div class="dialog__body">
        <h2 id="history-export-title" class="section__title">{t('history_export')}</h2>
        <p>{t('history_export_desc')}</p>
        <label class="export-host">
          <input type="checkbox" checked={includeSites} data-history-export-sites="true" onChange={(event) => setIncludeSites(event.currentTarget.checked)} />
          {' '}{t('history_export_include_sites')}
        </label>
        {includeSites ? <p class="state state--attention" data-history-export-warning="true">{t('history_export_sites_warning')}</p> : null}
        {error !== null ? <p class="state state--attention" role="status">{t(error)}</p> : null}
        {preview !== null && download !== null ? (
          <>
            {preview.truncated ? <p class="state state--attention">{t('history_export_truncated')}</p> : null}
            <pre class="json history-export__json" tabIndex={0} data-history-export-json="true">{download.text}</pre>
            <p class="small muted mono">{download.fileName}</p>
          </>
        ) : error === null ? (
          <p class="small muted">{t('history_loading')}</p>
        ) : null}
        <p class="actions">
          <button type="button" class="button" onClick={props.onClose}>{t('action_cancel')}</button>
          <button
            type="button"
            class="button button--primary"
            disabled={download === null}
            data-history-export-save="true"
            onClick={() => {
              if (download === null) return;
              triggerDownload(download);
              props.onClose();
            }}
          >
            {t('export_save')}
          </button>
        </p>
      </div>
    </dialog>
  );
}
