// Coverage box: state message + human explanation + coverage flags + «Перезагрузить для анализа с начала»
// (late-start or access granted for a document that still runs without sensors). Always above the cards.

import { t, tm } from '../i18n';
import type { CoverageVM } from '../view-models/coverage';
import { StateMessage } from './StateMessage';

export interface CoverageBoxProps {
  id: string;
  vm: CoverageVM;
  onReload: (() => void) | null;
  showFlags?: boolean;
  busy?: boolean;
}

export function CoverageBox(props: CoverageBoxProps) {
  const showFlags = props.showFlags ?? true;
  return (
    <StateMessage id={props.id} tone={props.vm.tone} title={props.vm.title} lines={props.vm.lines}>
      {showFlags && props.vm.flags.length > 0 ? (
        <div class="flags">
          <p class="flags__title small muted">{t('coverage_flags_title')}</p>
          <ul class="flags__list">
            {props.vm.flags.map((flag) => (
              <li key={flag.flag}>{tm(flag.label)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {props.vm.showReload && props.onReload !== null ? (
        <p class="actions">
          <button type="button" class="button button--primary" onClick={() => { if (!props.busy) props.onReload?.(); }} aria-disabled={props.busy === true}>
            {t('action_reload')}
          </button>
        </p>
      ) : null}
    </StateMessage>
  );
}
