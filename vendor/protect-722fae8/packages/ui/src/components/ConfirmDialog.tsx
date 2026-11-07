// Confirmation of an irreversible action (S13, E13-02): deleting a document report or the session data. Mounted only
// while open; native modal <dialog> as an alertdialog. Initial focus is on «Отмена»; Escape and «Отмена» cancel.
// The confirm button is the ordinary primary style, not red: red is reserved for product/collection errors.

import { useEffect, useRef } from 'preact/hooks';
import { t } from '../i18n';

export interface ConfirmDialogProps {
  id: string;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  /** Set once the outcome is decided, so a later native `close` event does not report a second outcome. */
  const doneRef = useRef(false);
  const titleId = props.id + '-title';
  const descId = props.id + '-desc';

  // Close the native modal first: while it is open the rest of the page is inert, so the caller could not move
  // focus back to the control that opened it.
  const finish = (callback: () => void): void => {
    if (doneRef.current) return;
    doneRef.current = true;
    const dialog = ref.current;
    try {
      if (dialog !== null && dialog.open) dialog.close();
    } catch {
      // already detached
    }
    callback();
  };

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (!dialog.open) {
      try {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      } catch {
        dialog.setAttribute('open', '');
      }
    }
    cancelRef.current?.focus();
    return () => {
      doneRef.current = true;
      try {
        if (dialog.open) dialog.close();
      } catch {
        // already detached
      }
    };
  }, []);

  return (
    <dialog
      ref={ref}
      id={props.id}
      class="dialog dialog--confirm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(event) => {
        event.preventDefault();
        finish(props.onCancel);
      }}
      // Chrome may close a modal on Escape without a cancel event (close watcher without user activation): that is a
      // cancel too.
      onClose={() => finish(props.onCancel)}
    >
      <div class="dialog__body">
        <h2 id={titleId} class="section__title">
          {props.title}
        </h2>
        <p id={descId}>{props.description}</p>
        <p class="actions">
          <button ref={cancelRef} type="button" class="button" onClick={() => finish(props.onCancel)}>
            {t('action_cancel')}
          </button>
          <button type="button" class="button button--primary" onClick={() => finish(props.onConfirm)}>
            {props.confirmLabel}
          </button>
        </p>
      </div>
    </dialog>
  );
}
