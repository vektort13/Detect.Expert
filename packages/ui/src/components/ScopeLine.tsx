// One-line current scope: «Область наблюдения: …». Keeps the `.value` hook used by the extension smoke test.

import type { ScopeState } from '@detect-expert/contracts';
import { t } from '../i18n';
import { SCOPE_MODE_LABEL_KEYS } from '../view-models/scope';

export function ScopeLine(props: { scope: ScopeState | null; loaded: boolean }) {
  const label = props.scope === null ? (props.loaded ? t('statusUnavailable') : t('statusLoading')) : t(SCOPE_MODE_LABEL_KEYS[props.scope.scopeMode]);
  return (
    <p class="scope-line">
      <span class="label">{t('scopeLabel')}</span> <span class="value">{label}</span>
    </p>
  );
}
