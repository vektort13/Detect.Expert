// ADR-020 §D (S09): the firewall part of the Options tab «Защита» (#firewall). The blocking mode (radios + «Применить
// режим»; the strict mode carries its warning), «Сегодня» (lower bound of requests our rules stopped), the rules: a
// domain search (300 ms debounce), an action filter, «Выбрать все показанные» (tri-state), «Удалить выбранные (N)»
// through ConfirmDialog (focus on «Отмена»), rows «адрес · где · решение · когда · кем создано» (≤ 200 per page; a rule
// not in effect says why), and «Удалить все правила фаервола» (ui-protect-purge decisions). The mode lives here and
// not in the module section: it only concerns the firewall.

import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PROTECT_PRESETS } from '@detect-expert/contracts';
import type { FirewallAction, ProtectPreset } from '@detect-expert/contracts';
import { t, tm, uiLocale } from '../../../i18n';
import { errorMessageKey } from '../../../messaging';
import { useFirewallRules } from '../../../app/useFirewall';
import { PROTECT_PRESET_KEYS } from '../../../view-models/protect';
import { localDayOf, rulesView } from '../../../view-models/protect-firewall-rules';
import { ConfirmDialog } from '../../ConfirmDialog';
import type { ProtectOptionsSlotProps } from '../ProtectOptionsPanel';

export const FIREWALL_RULES_TITLE_ID = 'fw-rules-panel-title';

function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return day;
  try {
    return new Intl.DateTimeFormat(uiLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(y, m - 1, d));
  } catch {
    return day;
  }
}

export function FirewallRulesPanel(props: ProtectOptionsSlotProps): JSX.Element | null {
  const { state } = props;
  const running = state.state === 'active' || state.state === 'degraded';
  const firewallOn = running && state.features.includes('firewall');
  const rules = useFirewallRules({ enabled: firewallOn, refreshState: props.refreshState });
  const [presetDraft, setPresetDraft] = useState<ProtectPreset>(state.preset);
  const [confirm, setConfirm] = useState<'selected' | 'all' | null>(null);
  const allRef = useRef<HTMLInputElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const today = localDayOf(Date.now());
  const vm = useMemo(() => rulesView(rules.answer, rules.query, rules.selected, today, formatDay), [rules.answer, rules.query, rules.selected, today]);
  const busy = rules.busy || props.busy;

  useEffect(() => {
    setPresetDraft(state.preset);
  }, [state.preset]);

  useEffect(() => {
    if (allRef.current !== null) allRef.current.indeterminate = vm.selectAll === 'some';
  }, [vm.selectAll]);

  // options.html#firewall (popup «Настройки фаервола»): the section is brought into view with its heading focused.
  useEffect(() => {
    if (typeof location === 'undefined' || location.hash !== '#firewall') return;
    const heading = document.getElementById(FIREWALL_RULES_TITLE_ID);
    if (heading === null) return;
    heading.scrollIntoView({ block: 'start' });
    heading.focus();
  }, []);

  if (state.state === 'off' && state.decisions === 0) return null;

  const failure = rules.failureCode;
  const restore = (ref: { current: HTMLButtonElement | null }): void => {
    if (ref.current?.isConnected === true) ref.current.focus();
    else document.getElementById(FIREWALL_RULES_TITLE_ID)?.focus();
  };

  return (
    <section class="section fw-rules" id="firewall" aria-labelledby={FIREWALL_RULES_TITLE_ID} data-fw-rules={firewallOn ? 'on' : 'off'}>
      <h2 id={FIREWALL_RULES_TITLE_ID} class="section__title" tabIndex={-1}>
        {t('fw_title')}
      </h2>
      {!firewallOn ? (
        <p class="small muted" data-fw-feature-off="true">
          {t('fw_feature_off')}
        </p>
      ) : null}

      {running ? (
        <form
          class="fw-mode"
          data-fw-mode-form="true"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void rules.applyMode(presetDraft);
          }}
        >
          <fieldset class="scope__fieldset">
            <legend>{t('protect_preset_title')}</legend>
            {PROTECT_PRESETS.map((preset) => (
              <div key={preset} class="scope__option">
                <input
                  type="radio"
                  name="fw-mode"
                  id={'fw-mode-' + preset}
                  value={preset}
                  checked={presetDraft === preset}
                  aria-describedby={preset === 'strict' ? 'fw-mode-strict-warning' : undefined}
                  onChange={() => setPresetDraft(preset)}
                />
                <label for={'fw-mode-' + preset}>{t(PROTECT_PRESET_KEYS[preset])}</label>
              </div>
            ))}
            <p id="fw-mode-strict-warning" class="small fw-mode__warning">
              {t('fw_mode_strict_warning')}
            </p>
          </fieldset>
          <p class="actions">
            <button type="submit" class="button" aria-busy={busy} data-fw-mode-apply="true">
              {t('fw_mode_apply')}
            </button>
          </p>
        </form>
      ) : null}

      {firewallOn ? (
        <div class="fw-today" data-fw-today="true">
          <h3 class="section__title">{t('fw_today_title')}</h3>
          <p>{tm(vm.today)}</p>
          <p class="small muted">{tm(vm.todayNote)}</p>
        </div>
      ) : null}

      {firewallOn ? (
        <div class="fw-list" data-fw-list="true">
          <h3 class="section__title" id="fw-rules-title">
            {t('fw_rules_title')}
          </h3>
          <div class="fw-list__controls">
            <div class="field">
              <label for="fw-rules-search">{t('fw_rules_search')}</label>
              <input
                id="fw-rules-search"
                type="search"
                autocomplete="off"
                spellcheck={false}
                maxLength={253}
                value={rules.searchText}
                aria-invalid={rules.searchInvalid}
                aria-describedby={rules.searchInvalid ? 'fw-rules-search-invalid' : undefined}
                onInput={(event) => rules.setSearchText(event.currentTarget.value)}
              />
            </div>
            <div class="field">
              <label for="fw-rules-action">{t('fw_rules_filter_label')}</label>
              <select
                id="fw-rules-action"
                value={rules.query.action}
                onChange={(event) => {
                  const v = event.currentTarget.value;
                  rules.setAction(v === 'block' || v === 'allow' ? (v as FirewallAction) : 'all');
                }}
              >
                <option value="all">{t('fw_rules_filter_all')}</option>
                <option value="block">{t('fw_rule_blocked')}</option>
                <option value="allow">{t('fw_rule_allowed')}</option>
              </select>
            </div>
          </div>
          {rules.searchInvalid ? (
            <p id="fw-rules-search-invalid" class="small">
              {t('fw_rules_search_invalid')}
            </p>
          ) : null}
          {failure !== null ? (
            <p class="state state--attention" data-fw-rules-failure={failure}>
              {failure === 'feature-disabled' ? t('fw_feature_off') : t(errorMessageKey(failure))}
            </p>
          ) : null}

          {vm.rows.length > 0 ? (
            <div class="scope__option fw-list__all">
              <input type="checkbox" id="fw-rules-all" ref={allRef} checked={vm.selectAll === 'all'} onChange={() => rules.toggleAllShown()} />
              <label for="fw-rules-all">{t('fw_rules_select_all')}</label>
            </div>
          ) : null}
          {vm.rows.length > 0 ? (
            <ul class="fw-list__rows" aria-labelledby="fw-rules-title">
              {vm.rows.map((row, i) => (
                <li key={row.ruleKey} class="fw-list__row scope__option" data-fw-rule={row.ruleKey} data-fw-rule-action={row.action}>
                  <input
                    type="checkbox"
                    id={'fw-rule-' + String(i)}
                    checked={row.checked}
                    onChange={(event) => rules.toggle(row.ruleKey, event.currentTarget.checked)}
                  />
                  <label for={'fw-rule-' + String(i)}>
                    <span class="fw-list__line">{tm(row.line)}</span>
                    {row.inactive !== null ? <span class="small muted"> ({tm(row.inactive)})</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          {vm.empty !== null ? (
            <p class="small muted" data-fw-rules-empty="true">
              {tm(vm.empty)}
            </p>
          ) : null}
          {vm.shown !== null ? <p class="small muted">{tm(vm.shown)}</p> : null}
          {vm.hasPrev || vm.hasNext ? (
            <p class="actions">
              {vm.hasPrev ? (
                <button type="button" class="button" onClick={() => rules.setPage(rules.query.page - 1)}>
                  {t('fw_rules_prev')}
                </button>
              ) : null}
              {vm.hasNext ? (
                <button type="button" class="button" onClick={() => rules.setPage(rules.query.page + 1)}>
                  {t('fw_rules_next')}
                </button>
              ) : null}
            </p>
          ) : null}
          <p class="actions">
            <button
              ref={removeRef}
              type="button"
              class="button"
              aria-disabled={vm.selectedCount === 0}
              aria-busy={busy}
              data-fw-remove-selected="true"
              onClick={() => {
                if (busy || vm.selectedCount === 0) return;
                setConfirm('selected');
              }}
            >
              {tm(vm.removeLabel)}
            </button>
          </p>
        </div>
      ) : null}

      {firewallOn || state.decisions > 0 ? (
        <p class="actions">
          <button
            ref={clearRef}
            type="button"
            class="button"
            aria-busy={busy}
            data-fw-clear-all="true"
            onClick={() => {
              if (!busy) setConfirm('all');
            }}
          >
            {t('fw_rules_clear_all')}
          </button>
        </p>
      ) : null}

      <div aria-live="polite" aria-atomic="true" data-fw-rules-message="true"
        class={rules.message === null ? undefined : 'state' + (rules.message.tone === 'error' ? ' state--error' : rules.message.tone === 'attention' ? ' state--attention' : '')}>
        {rules.message === null ? '' : tm(rules.message.message)}
      </div>

      {confirm === 'selected' ? (
        <ConfirmDialog
          id="fw-confirm-remove"
          title={t('fw_rules_confirm_title', [String(vm.selectedCount)])}
          description={t('fw_rules_confirm_desc')}
          confirmLabel={tm(vm.removeLabel)}
          onCancel={() => {
            setConfirm(null);
            restore(removeRef);
          }}
          onConfirm={() => {
            setConfirm(null);
            void rules.removeSelected().then(() => restore(removeRef));
          }}
        />
      ) : null}
      {confirm === 'all' ? (
        <ConfirmDialog
          id="fw-confirm-clear"
          title={t('fw_rules_clear_all_confirm')}
          description={t('fw_rules_confirm_desc')}
          confirmLabel={t('fw_rules_clear_all')}
          onCancel={() => {
            setConfirm(null);
            restore(clearRef);
          }}
          onConfirm={() => {
            setConfirm(null);
            void rules.clearAll().then(() => restore(clearRef));
          }}
        />
      ) : null}
    </section>
  );
}
