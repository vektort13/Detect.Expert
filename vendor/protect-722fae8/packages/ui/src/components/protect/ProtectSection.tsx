// ADR-020 «Защита» (S06): the module section of Options. Two layouts:
// - `enable-only` (the module is off and keeps no data): state plaque, description, «Включить «Защиту»…»;
// - `full` (tab «Защита»): plus features, «Не беспокоить», excluded sites, history and decision counters (the blocking
//   mode is in the firewall part of the tab, S09), «Выключить» with the purge box (ticked by default) and «Удалить все данные модуля» (confirmed first).
// The plaque is an aria-live polite region (no role=status: the page's notice keeps that role). Notices explain
// needs-consent, needs-permission, organization-disabled and degraded. Enabling opens the consent screen; Chrome
// permissions are requested inside the confirm click (ProtectConsentDialog → session.enable).

import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { PROTECT_BUDGETS, PROTECT_FEATURES } from '@detect-expert/contracts';
import type { ProtectState } from '@detect-expert/contracts';
import { t, tm, uiLocale } from '../../i18n';
import type { ProtectStateSession } from '../../app/useProtectState';
import {
  PROTECT_DISABLE_PURGE_DEFAULT,
  PROTECT_FEATURE_KEYS,
  parseSiteInput,
  protectSectionView,
  toggleFeature,
} from '../../view-models/protect';
import { ConfirmDialog } from '../ConfirmDialog';
import { ProtectConsentDialog } from './ProtectConsentDialog';

export const PROTECT_SECTION_TITLE_ID = 'protect-title';

export interface ProtectSectionProps {
  session: ProtectStateSession;
  state: ProtectState;
  mode: 'enable-only' | 'full';
  /** After an action that changes the Options layout (enable, disable, purge): the page moves focus / tab. */
  onLayoutAction?: (action: 'enabled' | 'stopped') => void;
}

function formatTime(epochMs: number): string {
  try {
    return new Intl.DateTimeFormat(uiLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(epochMs));
  } catch {
    return new Date(epochMs).toISOString().slice(11, 16);
  }
}

const TONE_PILL: Readonly<Record<string, string>> = { neutral: 'pill', muted: 'pill pill--muted', attention: 'pill pill--attention', error: 'pill pill--error' };

export function ProtectSection(props: ProtectSectionProps): JSX.Element {
  const { session, state } = props;
  const vm = protectSectionView(state, Date.now());
  const busy = session.busy;
  const [consentOpen, setConsentOpen] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purgeOnDisable, setPurgeOnDisable] = useState(PROTECT_DISABLE_PURGE_DEFAULT);
  const [siteInput, setSiteInput] = useState('');
  const [siteInvalid, setSiteInvalid] = useState(false);
  const enableInvoker = useRef<HTMLButtonElement | null>(null);
  const purgeInvoker = useRef<HTMLButtonElement | null>(null);

  const restoreFocus = (ref: { current: HTMLButtonElement | null }): void => {
    if (ref.current?.isConnected === true) ref.current.focus();
    else document.getElementById(PROTECT_SECTION_TITLE_ID)?.focus();
  };

  const full = props.mode === 'full';
  const featuresHintId = 'protect-features-hint';
  const lastFeature = state.features.length === 1 ? state.features[0] : undefined;

  return (
    <section class="section" aria-labelledby={PROTECT_SECTION_TITLE_ID} data-protect-section={props.mode}>
      <h2 id={PROTECT_SECTION_TITLE_ID} class="section__title" tabIndex={-1}>
        {t('protect_title')}
      </h2>
      <p aria-live="polite" aria-atomic="true">
        <span class={TONE_PILL[vm.tone] ?? 'pill'} data-protect-state={state.state}>
          {t(vm.stateKey)}
        </span>
      </p>
      <p>{t('protect_section_desc')}</p>
      {vm.notices.map((notice) => (
        <p key={notice.key} class="state state--attention" data-protect-notice={notice.key}>
          {tm(notice)}
        </p>
      ))}
      {vm.reasons.length > 0 ? (
        <ul class="small" data-protect-reasons="true">
          {vm.reasons.map((reason, i) => <li key={String(i)}>{tm(reason)}</li>)}
        </ul>
      ) : null}

      {vm.enable ? (
        <p class="actions">
          <button
            type="button"
            class="button button--primary"
            aria-busy={busy}
            data-protect-enable="true"
            onClick={(event) => {
              if (busy) return;
              enableInvoker.current = event.currentTarget;
              session.dismissNotice();
              setConsentOpen(true);
            }}
          >
            {t('protect_enable')}
          </button>
        </p>
      ) : null}

      {full && vm.controls ? (
        <>
          <fieldset class="scope__fieldset" data-protect-features="true">
            <legend>{t('protect_features_title')}</legend>
            {PROTECT_FEATURES.map((feature) => {
              const checked = state.features.includes(feature);
              const locked = checked && lastFeature === feature;
              return (
                <div key={feature} class="scope__option">
                  <input
                    type="checkbox"
                    id={'protect-feature-' + feature}
                    checked={checked}
                    disabled={locked}
                    aria-describedby={locked ? featuresHintId : undefined}
                    onChange={(event) => {
                      const on = event.currentTarget.checked;
                      // The SW answer decides; until then the box shows the stored choice.
                      event.currentTarget.checked = checked;
                      void session.setFeatures(toggleFeature(state.features, feature, on));
                    }}
                  />
                  <label for={'protect-feature-' + feature}>{t(PROTECT_FEATURE_KEYS[feature])}</label>
                </div>
              );
            })}
            {lastFeature !== undefined ? (
              <p id={featuresHintId} class="small muted">
                {t('protect_consent_features_required')}
              </p>
            ) : null}
          </fieldset>

          {/* S09: the blocking mode moved to the firewall part of this tab (FirewallRulesPanel, #firewall). */}

          <div class="section" data-protect-snooze={vm.snoozedUntil === null ? 'off' : 'on'}>
            {vm.snoozedUntil === null ? (
              <p class="actions">
                <button type="button" class="button" aria-busy={busy} onClick={() => void session.snooze(60)}>
                  {t('protect_snooze')}
                </button>
              </p>
            ) : (
              <>
                <p>{t('protect_snooze_until', [formatTime(vm.snoozedUntil)])}</p>
                <p class="actions">
                  <button type="button" class="button" aria-busy={busy} onClick={() => void session.snooze(0)}>
                    {t('protect_snooze_cancel')}
                  </button>
                </p>
              </>
            )}
          </div>

          <section class="section" aria-labelledby="protect-sites-title" data-protect-sites="true">
            <h3 id="protect-sites-title" class="section__title">
              {t('protect_sites_title')}
            </h3>
            <p class="small muted">{t('protect_sites_desc')}</p>
            {vm.excludedSites.length === 0 ? (
              <p class="small muted">{t('protect_sites_empty')}</p>
            ) : (
              <ul class="access-list">
                {vm.excludedSites.map((site) => (
                  <li key={site} class="access-list__item">
                    <span class="access-list__host">{site}</span>
                    <button
                      type="button"
                      class="button"
                      aria-label={t('action_remove_site_named', [site])}
                      aria-busy={busy}
                      onClick={() => void session.setSite(site, false)}
                    >
                      {t('protect_sites_remove')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              class="section"
              onSubmit={(event) => {
                event.preventDefault();
                if (busy || !vm.canAddSite) return;
                const host = parseSiteInput(siteInput);
                setSiteInvalid(host === null);
                if (host === null) return;
                void session.setSite(host, true).then((ok) => {
                  if (ok) setSiteInput('');
                });
              }}
            >
              <div class="field">
                <label for="protect-site-input">{t('protect_sites_input_label')}</label>
                <input
                  id="protect-site-input"
                  type="text"
                  autocomplete="off"
                  spellcheck={false}
                  maxLength={253}
                  value={siteInput}
                  aria-invalid={siteInvalid}
                  aria-describedby={siteInvalid ? 'protect-site-invalid' : vm.canAddSite ? undefined : 'protect-site-limit'}
                  onInput={(event) => {
                    setSiteInput(event.currentTarget.value);
                    setSiteInvalid(false);
                  }}
                />
              </div>
              <p class="actions">
                <button type="submit" class="button" aria-disabled={!vm.canAddSite} aria-busy={busy}>
                  {t('protect_sites_add')}
                </button>
              </p>
              <p aria-live="polite" class="small">
                {siteInvalid ? <span id="protect-site-invalid">{t('protect_sites_invalid')}</span> : null}
              </p>
              {!vm.canAddSite ? (
                <p id="protect-site-limit" class="small">
                  {t('protect_sites_limit', [String(PROTECT_BUDGETS.maxExcludedSites)])}
                </p>
              ) : null}
            </form>
          </section>
        </>
      ) : null}

      {full && vm.historyRecords !== null ? (
        <p class="small muted" data-protect-history-records="true">
          {t('protect_history_records', [String(vm.historyRecords)])}
        </p>
      ) : null}
      {full && vm.purge ? (
        <p class="small muted" data-protect-decisions="true">
          {t('protect_decisions_count', [String(vm.decisions)])}
        </p>
      ) : null}

      {full && vm.disable ? (
        <div class="section" data-protect-disable="true">
          <div class="scope__option">
            <input
              type="checkbox"
              id="protect-disable-purge"
              checked={purgeOnDisable}
              onChange={(event) => setPurgeOnDisable(event.currentTarget.checked)}
            />
            <label for="protect-disable-purge">{t('protect_disable_purge')}</label>
          </div>
          <p class="actions">
            <button
              type="button"
              class="button"
              aria-busy={busy}
              onClick={() => {
                if (busy) return;
                void session.disable(purgeOnDisable).then((ok) => {
                  if (ok) props.onLayoutAction?.('stopped');
                });
              }}
            >
              {t('protect_disable')}
            </button>
          </p>
        </div>
      ) : null}

      {full && vm.purge ? (
        <p class="actions">
          <button
            type="button"
            class="button"
            aria-busy={busy}
            data-protect-purge="true"
            onClick={(event) => {
              if (busy) return;
              purgeInvoker.current = event.currentTarget;
              setConfirmPurge(true);
            }}
          >
            {t('protect_purge_all')}
          </button>
        </p>
      ) : null}

      <div
        aria-live="polite"
        aria-atomic="true"
        class={session.notice === null ? undefined : 'state' + (session.notice.tone === 'error' ? ' state--error' : session.notice.tone === 'attention' ? ' state--attention' : '')}
        data-protect-message="true"
      >
        {session.notice === null || consentOpen ? '' : tm(session.notice.message)}
      </div>
      <p class="small muted">{t('protect_no_verdict')}</p>

      {consentOpen ? (
        <ProtectConsentDialog
          id="protect-consent"
          state={state}
          busy={busy}
          error={session.notice === null || session.notice.tone === 'neutral' ? null : session.notice.message}
          onCancel={() => {
            setConsentOpen(false);
            session.dismissNotice();
            restoreFocus(enableInvoker);
          }}
          onConfirm={(features, preset) => {
            // Synchronous inside the click: session.enable asks Chrome for the permissions first.
            void session.enable(features, preset).then((ok) => {
              if (!ok) return;
              setConsentOpen(false);
              props.onLayoutAction?.('enabled');
              restoreFocus(enableInvoker);
            });
          }}
        />
      ) : null}

      {confirmPurge ? (
        <ConfirmDialog
          id="protect-confirm-purge"
          title={t('protect_purge_confirm_title')}
          description={t('protect_purge_confirm_desc')}
          confirmLabel={t('protect_purge_all')}
          onCancel={() => {
            setConfirmPurge(false);
            restoreFocus(purgeInvoker);
          }}
          onConfirm={() => {
            setConfirmPurge(false);
            void session.purgeAll().then((ok) => {
              if (ok) props.onLayoutAction?.('stopped');
              restoreFocus(purgeInvoker);
            });
          }}
        />
      ) : null}
    </section>
  );
}
