// Options page: onboarding text, scope picker (with host input for the `site` mode), «Очистить данные сессии»
// and the bundled data-inventory summary. No polling: one scope fetch plus refresh after actions.

import { t } from '../i18n';
import { Notice } from '../components/Notice';
import { ScopeLine } from '../components/ScopeLine';
import { ScopePicker } from '../components/ScopePicker';
import { useReportSession } from './useReportSession';

const INVENTORY_KEYS = ['inventory_session', 'inventory_local', 'inventory_never', 'inventory_export', 'inventory_sync', 'inventory_link'] as const;

export function OptionsApp() {
  const session = useReportSession({ surface: 'options', pollMs: 0, watchTabs: false });
  return (
    <main class="app app--options">
      <header class="header">
        <h1 class="app__title">{t('optionsTitle')}</h1>
      </header>
      <Notice notice={session.notice} onDismiss={session.dismissNotice} />

      <section class="section state state--muted" aria-labelledby="options-onboarding-title">
        <h2 id="options-onboarding-title" class="state__title">
          {t('options_onboarding_title')}
        </h2>
        <p>{t('onboarding_limits')}</p>
        <p>{t('onboarding_no_server')}</p>
        <p class="small muted">{t('disclaimerNoVerdict')}</p>
      </section>

      <section class="section">
        <ScopePicker
          surface="options"
          id="options-scope"
          scope={session.scope}
          host={null}
          allowHostInput={true}
          busy={session.busy}
          onApply={(mode, host) => void session.applyScope(mode, host)}
        />
        <ScopeLine scope={session.scope} loaded={session.loaded} />
      </section>

      <section class="section" aria-labelledby="options-clear-title">
        <h2 id="options-clear-title" class="section__title">
          {t('options_clear_session')}
        </h2>
        <p class="small muted">{t('options_clear_session_desc')}</p>
        <p class="actions">
          <button type="button" class="button" aria-disabled={session.busy} aria-busy={session.busy} onClick={() => void session.clearSession()}>
            {t('options_clear_session')}
          </button>
        </p>
      </section>

      <section class="section" aria-labelledby="options-inventory-title">
        <h2 id="options-inventory-title" class="section__title">
          {t('options_inventory_title')}
        </h2>
        <ul class="inventory">
          {INVENTORY_KEYS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
