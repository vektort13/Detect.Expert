// Action row: pause/resume, export preview (disabled without access or report), delete this document's report.

import type { ReportProjection } from '@detect-expert/contracts';
import { t } from '../i18n';
import type { ReportSession } from '../app/useReportSession';
import { PauseButton } from './PauseButton';

export function exportAllowed(report: ReportProjection | null): boolean {
  return report !== null && report.coverageState !== 'no-access' && report.coverageState !== 'unsupported';
}

export function ReportActions(props: { session: ReportSession }) {
  const s = props.session;
  const report = s.report;
  const disabled = report === null;
  const paused = report !== null && report.coverageState === 'paused';
  return (
    <div class="actions actions--wrap" aria-busy={s.busy}>
      <PauseButton paused={paused} busy={s.busy} disabled={disabled} onToggle={() => void (paused ? s.resume() : s.pause())} />
      <button type="button" class="button" aria-disabled={s.busy} disabled={disabled || !exportAllowed(report)} onClick={() => void s.openExport()}>
        {t('action_export')}
      </button>
      <button type="button" class="button" aria-disabled={s.busy} disabled={disabled} onClick={() => void s.clear()}>
        {t('action_clear')}
      </button>
    </div>
  );
}
