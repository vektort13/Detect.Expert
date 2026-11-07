// ADR-020 §E (S11): side-panel details of «Запись сессии» — the level with its confidence and basis, every signal with
// its trust badge (page-hook signals are page-controlled; network ones browser-observed), every periodic receiver, the
// masking line, the limitations of the conclusion, coverage, the disclaimer and the level help. No URL, value or
// body exists in the data, so none is shown.

import type { JSX } from 'preact';
import { t, tm } from '../../../i18n';
import { replayDetailsView } from '../../../view-models/protect-replay';
import { IntegrityBadge } from '../../IntegrityBadge';
import type { ProtectPanelSlotProps } from '../ProtectSidepanel';
import { ReplayLevel, ReplayReceivers } from './ReplayRow';

export function ReplayDetails(props: ProtectPanelSlotProps): JSX.Element | null {
  if (!props.state.features.includes('session-replay')) return null;
  const vm = replayDetailsView(props.report);
  if (vm === null) return null;
  const row = vm.row;
  return (
    <section class={'replay replay--panel replay--' + row.tone} aria-labelledby="panel-replay-title" data-protect-replay="panel">
      <h3 id="panel-replay-title" class="replay__title">
        {t('replay_section_title')}
      </h3>
      <ReplayLevel vm={row} id="panel-replay-level" />
      {row.basis !== null ? <p class="replay__line small">{tm(row.basis)}</p> : null}
      {row.likeNote !== null ? <p class="replay__line small muted">{tm(row.likeNote)}</p> : null}
      {vm.signals.length > 0 ? (
        <>
          <h4 class="replay__subtitle">{t('replay_signals_title')}</h4>
          <ul class="replay__signals">
            {vm.signals.map((s) => (
              <li key={s.code} class="replay__signal" data-replay-signal={s.code}>
                <span>{tm(s.text)}</span>
                {s.script !== null ? <span class="small muted"> {tm(s.script)}</span> : null}
                <IntegrityBadge integrity={s.integrity} evidenceSource={s.evidenceSource} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {row.receivers.length > 0 ? (
        <>
          <h4 class="replay__subtitle">{t('replay_receivers_title')}</h4>
          <ReplayReceivers vm={row} />
        </>
      ) : null}
      {row.level !== 'none' ? <p class="replay__line small" data-replay-masking="true">{tm(row.masking)}</p> : null}
      {row.vendorRulesDisabled !== null ? <p class="replay__line small muted">{tm(row.vendorRulesDisabled)}</p> : null}
      {row.coverage !== null ? <p class="replay__line small muted">{tm(row.coverage)}</p> : null}
      {vm.limitations.length > 0 ? (
        <>
          <h4 class="replay__subtitle">{t('replay_limits_title')}</h4>
          <ul class="replay__limits small muted">
            {vm.limitations.map((m, i) => (
              <li key={String(i)}>{tm(m)}</li>
            ))}
          </ul>
        </>
      ) : null}
      <p class="replay__line small muted">{tm(row.disclaimer)}</p>
      <details class="replay__help">
        <summary class="small">{t('replay_levels_title')}</summary>
        <ul class="replay__limits small">
          {vm.levels.map((m, i) => (
            <li key={String(i)}>{tm(m)}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
