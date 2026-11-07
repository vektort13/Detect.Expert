// ADR-020 §D (S09): where the decision applies — «Эта вкладка» (session rule until the tab closes or leaves the site),
// «Этот сайт» (default), «Везде» (the receiver on every site; a domain rule while service recognition is off). A
// fieldset of radios laid out as one row; every option carries its description for screen readers, the selected one is
// also shown under the row (compact first screen of a 360 x 600 popup).

import type { JSX } from 'preact';
import type { DecisionScope } from '@detect-expert/contracts';
import { t, tm } from '../../../i18n';
import type { FirewallScopeVM } from '../../../view-models/protect-firewall';

export interface FirewallScopePickerProps {
  scopes: ReadonlyArray<FirewallScopeVM>;
  scope: DecisionScope;
  note: string;
  disabled: boolean;
  onChange: (scope: DecisionScope) => void;
}

export function FirewallScopePicker(props: FirewallScopePickerProps): JSX.Element {
  const selected = props.scopes.find((s) => s.scope === props.scope) ?? props.scopes[0];
  return (
    <fieldset class="fw-scope" data-fw-scope={props.scope}>
      <legend class="fw-scope__legend">{t('fw_scope_legend')}</legend>
      <div class="fw-scope__options">
        {props.scopes.map((s) => (
          <label key={s.scope} class={'fw-scope__option' + (s.scope === props.scope ? ' fw-scope__option--checked' : '')}>
            <input
              type="radio"
              name="fw-scope"
              value={s.scope}
              checked={s.scope === props.scope}
              disabled={props.disabled}
              onChange={() => props.onChange(s.scope)}
            />
            <span class="fw-scope__label">{tm(s.label)}</span>
            <span class="sr-only">{tm(s.desc)}</span>
          </label>
        ))}
      </div>
      {selected !== undefined ? (
        <p class="fw-scope__desc" aria-hidden="true" data-fw-scope-desc="true">
          {tm(selected.desc)}
        </p>
      ) : null}
      {props.scope === 'everywhere' ? <p class="fw-scope__desc">{props.note}</p> : null}
    </fieldset>
  );
}
