// F057: keep the polite region mounted before messages arrive.

import { t, tm } from '../i18n';
import type { SessionNotice } from '../app/useReportSession';

export function Notice(props: { notice: SessionNotice | null; onDismiss: () => void; onReload?: (() => void) | undefined; busy?: boolean }) {
  return (
    <div class={props.notice === null ? undefined : 'notice state state--' + props.notice.tone}>
      <span role="status" aria-live="polite" aria-atomic="true">{props.notice === null ? '' : tm(props.notice.message)}</span>
      {props.notice !== null && props.onReload !== undefined ? (
        <button type="button" class="button button--primary" disabled={props.busy} onClick={props.onReload}>
          {t('action_reload_short')}
        </button>
      ) : null}
      {props.notice !== null ? (
      <button type="button" class="button button--text" onClick={props.onDismiss} aria-label={t('action_dismiss')}>
        ×
      </button>
      ) : null}
    </div>
  );
}
