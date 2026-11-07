// ADR-020 §G, §8 (S12): history settings in Options (#history): volume indicator, storage note (this device only,
// unencrypted), retention 7/30/90 (Options-only `ui-protect-set-settings`), «Удалить всю историю» after a confirmation,
// and the export preview. Turning the history on or off is the feature box of ProtectSection (turning it off deletes
// the records: the note below says so). Shown only while the module is not off.

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { HISTORY_RETENTION_DAYS } from '@detect-expert/contracts';
import type { HistoryRetentionDays } from '@detect-expert/contracts';
import { t, tm } from '../../../i18n';
import { errorMessageKey, protectUi } from '../../../messaging';
import { msg } from '../../../view-models/message';
import { historyEnabled, parseHistoryProjection } from '../../../view-models/protect-history';
import { ConfirmDialog } from '../../ConfirmDialog';
import type { ProtectOptionsSlotProps } from '../ProtectOptionsPanel';
import { HistoryExportDialog } from './HistoryExportDialog';

export function HistorySettings(props: ProtectOptionsSlotProps): JSX.Element | null {
  const state = props.state;
  const enabled = historyEnabled(state);
  const [usage, setUsage] = useState<{ receivers: number; sites: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const clearRef = useRef<HTMLButtonElement>(null);
  const exportRef = useRef<HTMLButtonElement>(null);
  const records = state.history?.records ?? 0;

  useEffect(() => {
    if (!enabled) {
      setUsage(null);
      return;
    }
    let live = true;
    void protectUi.historyQuery({ windowDays: 90, offset: 0, limit: 1, minSites: 1 }).then((result) => {
      if (!live) return;
      const h = result.ok ? parseHistoryProjection(result.response) : null;
      setUsage(h === null ? null : { receivers: h.totalRows, sites: h.sitesInWindow });
    });
    return () => {
      live = false;
    };
  }, [enabled, records, state.historyRetentionDays]);

  if (state.state === 'off') return null;

  const setRetention = async (days: HistoryRetentionDays): Promise<void> => {
    if (days === state.historyRetentionDays || busy) return;
    setBusy(true);
    const result = await protectUi.setSettings({ historyRetentionDays: days });
    setBusy(false);
    setNotice(result.ok ? null : t(errorMessageKey(result.code)));
    await props.refreshState();
  };

  const clearAll = async (): Promise<void> => {
    setConfirmClear(false);
    setBusy(true);
    const result = await protectUi.purge('history');
    setBusy(false);
    setNotice(result.ok ? t('history_cleared') : t(errorMessageKey(result.code)));
    await props.refreshState();
    clearRef.current?.focus();
  };

  return (
    <section id="history" class="section history-settings" aria-labelledby="history-settings-title" data-history-settings={enabled ? 'on' : 'off'}>
      <h2 id="history-settings-title" class="section__title">{t('history_settings_title')}</h2>
      {!enabled ? (
        <p>{t('history_off_desc')}</p>
      ) : (
        <>
          <p data-history-usage="true">
            {usage === null ? tm(msg('protect_history_records', records)) : tm(msg('history_usage', usage.receivers, usage.sites))}
          </p>
          <p class="small muted">{t('history_storage_note')}</p>
          <div class="history-window" role="radiogroup" aria-labelledby="history-retention-label" data-history-retention="true">
            <span id="history-retention-label" class="history-window__label">{t('history_retention')}</span>
            {HISTORY_RETENTION_DAYS.map((days) => (
              <label key={days} class="history-window__option">
                <input
                  type="radio"
                  name="history-retention"
                  value={String(days)}
                  checked={state.historyRetentionDays === days}
                  disabled={busy || props.busy}
                  onChange={() => void setRetention(days)}
                />
                {' '}{tm(msg('history_window_days', days))}
              </label>
            ))}
          </div>
          <p class="small muted">{t('history_retention_note')}</p>
          <p class="small muted">{t('history_disable_note')}</p>
          <p class="actions">
            <button ref={exportRef} type="button" class="button" data-history-export="true" onClick={() => setExporting(true)}>
              {t('history_export')}
            </button>
            <button ref={clearRef} type="button" class="button" disabled={busy} data-history-clear="true" onClick={() => setConfirmClear(true)}>
              {t('history_clear')}
            </button>
          </p>
        </>
      )}
      {notice !== null ? <p class="small" role="status" data-history-notice="true">{notice}</p> : null}
      {confirmClear ? (
        <ConfirmDialog
          id="history-clear-confirm"
          title={t('history_clear_confirm')}
          description={t('history_clear_desc')}
          confirmLabel={t('history_clear')}
          onConfirm={() => void clearAll()}
          onCancel={() => {
            setConfirmClear(false);
            clearRef.current?.focus();
          }}
        />
      ) : null}
      {exporting ? (
        <HistoryExportDialog
          onClose={() => {
            setExporting(false);
            exportRef.current?.focus();
          }}
        />
      ) : null}
    </section>
  );
}
