// Pause / resume toggle. Pausing stops observation only; the page keeps working (spec VI I5).

import { t } from '../i18n';

export interface PauseButtonProps {
  paused: boolean;
  disabled: boolean;
  busy?: boolean;
  onToggle: () => void;
}

export function PauseButton(props: PauseButtonProps) {
  return (
    <button type="button" class="button" aria-disabled={props.busy === true || props.disabled} disabled={props.disabled} onClick={() => { if (!props.busy) props.onToggle(); }}>
      {props.paused ? t('action_resume') : t('action_pause')}
    </button>
  );
}
