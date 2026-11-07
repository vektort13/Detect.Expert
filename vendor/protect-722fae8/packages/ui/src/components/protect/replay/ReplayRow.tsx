// ADR-020 §E (S11): popup row «Запись сессии» — level pill (attention for «похоже» / «записывает», muted otherwise;
// never green or red), confidence, the basis line, at most two periodic receivers with their body-size bucket, the
// input-masking line, the vendor-rules note, coverage on this page and the disclaimer; «Подробнее» opens the side
// panel. The data carries no URL, value or body: none is shown. Palette: ui.css tokens (replay.css).

import type { JSX } from 'preact';
import { t, tm } from '../../../i18n';
import { REPLAY_POPUP_RECEIVERS, replayRowView } from '../../../view-models/protect-replay';
import type { ReplayRowVM } from '../../../view-models/protect-replay';
import type { ProtectPopupSlotProps } from '../ProtectPopupArea';

export function ReplayLevel(props: { vm: ReplayRowVM; id: string }): JSX.Element {
  const { vm } = props;
  return (
    <div class="replay__head">
      <span class={'pill pill--' + vm.tone + ' replay__pill'} id={props.id} data-replay-level={vm.level}>
        {tm(vm.title)}
      </span>
      <span class="replay__confidence small">{tm(vm.confidence)}</span>
    </div>
  );
}

export function ReplayReceivers(props: { vm: ReplayRowVM }): JSX.Element | null {
  if (props.vm.receivers.length === 0) return null;
  return (
    <ul class="replay__receivers">
      {props.vm.receivers.map((r) => (
        <li key={r.site} class="replay__receiver" data-replay-receiver={r.site}>
          <span>{tm(r.text)}</span> <span class="small muted">({tm(r.body)})</span>
        </li>
      ))}
    </ul>
  );
}

export function ReplayRow(props: ProtectPopupSlotProps): JSX.Element | null {
  if (!props.state.features.includes('session-replay')) return null;
  const vm = replayRowView(props.report, REPLAY_POPUP_RECEIVERS);
  if (vm === null) return null;
  return (
    <section class={'replay replay--' + vm.tone} aria-labelledby="popup-replay-title" data-protect-replay="popup">
      <h3 id="popup-replay-title" class="replay__title">
        {t('replay_section_title')}
      </h3>
      <ReplayLevel vm={vm} id="popup-replay-level" />
      {vm.basis !== null ? <p class="replay__line small">{tm(vm.basis)}</p> : null}
      {vm.likeNote !== null ? <p class="replay__line small muted">{tm(vm.likeNote)}</p> : null}
      <ReplayReceivers vm={vm} />
      {vm.hiddenReceivers > 0 ? <p class="replay__line small muted">{t('replay_receivers_more', [String(vm.hiddenReceivers)])}</p> : null}
      {vm.level !== 'none' ? <p class="replay__line small" data-replay-masking="true">{tm(vm.masking)}</p> : null}
      {vm.vendorRulesDisabled !== null ? <p class="replay__line small muted">{tm(vm.vendorRulesDisabled)}</p> : null}
      {vm.coverage !== null ? <p class="replay__line small muted">{tm(vm.coverage)}</p> : null}
      <p class="replay__line small muted">{tm(vm.disclaimer)}</p>
      <p class="replay__more">
        <button type="button" class="button button--text" onClick={() => props.openSidePanel()}>
          {t('replay_more')}
        </button>
      </p>
    </section>
  );
}
