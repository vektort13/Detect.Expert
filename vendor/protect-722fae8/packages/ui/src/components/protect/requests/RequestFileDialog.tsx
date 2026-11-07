// ADR-020 §I, REQ-013 (S14): preview of a file of the data-request page (.ics of a deadline, export of the journal).
// The dialog shows the exact file text; «Сохранить файл» saves exactly that text (Blob + <a download>, no downloads
// permission, no network). Native modal <dialog>; Escape and «Отмена» close it and the caller returns the focus.

import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../../../i18n';
import type { RequestFileDownload } from '../../../view-models/protect-requests';

export function saveRequestFile(download: RequestFileDownload, doc: Document = document): void {
  const blob = new Blob([download.text], { type: download.mime });
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = download.fileName;
  anchor.rel = 'noopener';
  anchor.hidden = true;
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface RequestFileDialogProps {
  id: string;
  title: string;
  description: string;
  download: RequestFileDownload | null;
  children?: ComponentChildren;
  onClose: () => void;
}

export function RequestFileDialog(props: RequestFileDialogProps): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);

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

  return (
    <dialog
      ref={ref}
      id={props.id}
      class="dialog requests-file"
      aria-labelledby={props.id + '-title'}
      aria-describedby={props.id + '-desc'}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onClose={() => props.onClose()}
    >
      <div class="dialog__body">
        <h2 id={props.id + '-title'} class="section__title">{props.title}</h2>
        <p id={props.id + '-desc'}>{props.description}</p>
        {props.children}
        {props.download !== null ? (
          <>
            <pre class="json requests-file__text" tabIndex={0} data-requests-file-text="true">{props.download.text}</pre>
            <p class="small muted mono">{props.download.fileName}</p>
          </>
        ) : null}
        <p class="actions">
          <button type="button" class="button" onClick={props.onClose}>{t('action_cancel')}</button>
          <button
            type="button"
            class="button button--primary"
            disabled={props.download === null}
            data-requests-file-save="true"
            onClick={() => {
              if (props.download === null) return;
              saveRequestFile(props.download);
              props.onClose();
            }}
          >
            {t('protect_req_save_file')}
          </button>
        </p>
      </div>
    </dialog>
  );
}
