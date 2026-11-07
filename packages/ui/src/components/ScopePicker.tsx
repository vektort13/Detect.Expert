// Scope picker: off + three observation levels with the honest promise text of spec A3 / ADR-003.
// Optional host permissions are requested by the session (chrome.permissions from the UI context) and the
// SW is told via ui-set-scope only after the grant. Managed policies make the picker read-only.

import { useEffect, useState } from 'preact/hooks';
import type { ScopeMode, ScopeState } from '@detect-expert/contracts';
import { t } from '../i18n';
import type { UiSurface } from '../view-models/scope';
import { SCOPE_OPTIONS, parseHostInput } from '../view-models/scope';

export interface ScopePickerProps {
  id: string;
  surface: UiSurface;
  scope: ScopeState | null;
  /** Sanitized host of the current document (popup / side panel), null when unknown. */
  host: string | null;
  /** Options page: let the user type a host for the `site` mode. */
  allowHostInput: boolean;
  busy: boolean;
  /** First-run popup: expose the three activation choices and a named primary action. */
  activation?: boolean;
  onApply: (mode: ScopeMode, host: string | null) => void;
}

export function ScopePicker(props: ScopePickerProps) {
  const storedMode: ScopeMode = props.scope?.scopeMode ?? 'off';
  const currentMode: ScopeMode = props.activation && (storedMode === 'off' || storedMode === 'active-tab') ? 'active-tab' : storedMode;
  const [selected, setSelected] = useState<ScopeMode>(currentMode);
  const [touched, setTouched] = useState(false);
  const [hostInput, setHostInput] = useState('');

  useEffect(() => {
    if (!touched) setSelected(currentMode);
  }, [currentMode, touched]);

  const managed = props.scope?.managed === true;
  const typedHost = props.allowHostInput ? parseHostInput(hostInput) : null;
  const effectiveHost = props.host ?? typedHost;
  const siteUnavailable = !props.allowHostInput && props.host === null;
  const canApply = props.scope !== null && !managed && (selected !== 'active-tab' || props.surface === 'popup') && (selected !== 'site' || effectiveHost !== null);
  const legendId = props.id + '-legend';
  const applyButton = (
    <p class="actions">
      <button type="submit" class="button button--primary" disabled={!canApply} aria-disabled={props.busy || !canApply}>
        {t(props.activation ? SCOPE_OPTIONS.find((option) => option.mode === selected)?.labelKey ?? 'action_apply' : 'action_apply')}
      </button>
    </p>
  );

  return (
    <form
      class="scope"
      onSubmit={(event) => {
        event.preventDefault();
        if (canApply && !props.busy) props.onApply(selected, selected === 'site' ? effectiveHost : null);
      }}
    >
      <fieldset class="scope__fieldset" disabled={managed} aria-busy={props.busy} aria-describedby={managed ? props.id + '-managed' : undefined}>
        <legend id={legendId} class="section__title">
          {t(props.activation ? 'scope_start_title' : 'scopeLabel')}
        </legend>
        {/* P11: the primary action stays above longer localized permission explanations. */}
        {props.activation ? applyButton : null}
        {SCOPE_OPTIONS.filter((option) => !props.activation || option.mode !== 'off').map((option) => {
          const inputId = props.id + '-' + option.mode;
          const disabled = (option.mode === 'site' && siteUnavailable) || (option.mode === 'active-tab' && props.surface !== 'popup');
          return (
            <div key={option.mode} class="scope__option">
              <input
                type="radio"
                id={inputId}
                name={props.id + '-mode'}
                value={option.mode}
                checked={selected === option.mode}
                disabled={disabled}
                onChange={() => {
                  setTouched(true);
                  setSelected(option.mode);
                }}
              />
              <label for={inputId}>
                <span class="scope__label">{t(option.labelKey)}</span>
                <span class="scope__desc small muted">{t(option.mode === 'active-tab' && props.surface !== 'popup' ? 'scope_active_tab_toolbar' : option.descKey)}</span>
                {option.mode === 'site' && props.host !== null ? (
                  <span class="scope__desc small mono" dir="auto">
                    {props.host}
                  </span>
                ) : null}
                {option.mode === 'site' && siteUnavailable ? <span class="scope__desc small muted">{t('scope_site_host_unknown')}</span> : null}
              </label>
            </div>
          );
        })}
        {props.allowHostInput && selected === 'site' ? (
          <div class="field">
            <label for={props.id + '-host'}>{t('scope_host_input_label')}</label>
            <input
              id={props.id + '-host'}
              type="text"
              inputMode="url"
              autocomplete="off"
              spellcheck={false}
              dir="auto"
              value={hostInput}
              aria-invalid={hostInput !== '' && typedHost === null}
              aria-describedby={props.id + '-host-hint'}
              onInput={(event) => setHostInput(event.currentTarget.value)}
            />
            <span id={props.id + '-host-hint'} class="small muted">
              {t('scope_host_invalid')}
            </span>
          </div>
        ) : null}
      </fieldset>
      {managed ? (
        <p id={props.id + '-managed'} class="small muted">
          {t('coverage_managed_desc')}
        </p>
      ) : null}
      {props.scope !== null && props.scope.hosts.length > 0 ? (
        <p class="small muted">
          {t('scope_hosts_list')}: <span dir="auto">{props.scope.hosts.join(', ')}</span>
        </p>
      ) : null}
      {props.scope?.grantedAllSites === true ? <p class="small muted">{t('scope_granted_all')}</p> : null}
      {!props.activation ? applyButton : null}
    </form>
  );
}
