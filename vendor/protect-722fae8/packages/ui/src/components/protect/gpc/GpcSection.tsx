// ADR-020 §H (S13): GPC section of the Options tab «Защита» (#gpc). Description, the state of the signal and of its
// header rule (the switch itself is the `gpc` feature box of ProtectSection), the visibility warning, the legal block
// (candidate texts until a lawyer's review) and the coverage gaps. Shown only while the module is not off.

import type { JSX } from 'preact';
import { t, tm } from '../../../i18n';
import { gpcSectionView } from '../../../view-models/protect-gpc';
import type { ProtectOptionsSlotProps } from '../ProtectOptionsPanel';

export function GpcSection(props: ProtectOptionsSlotProps): JSX.Element | null {
  const vm = gpcSectionView(props.state);
  if (vm === null) return null;
  return (
    <section id="gpc" class="section gpc-settings" aria-labelledby="gpc-settings-title" data-gpc-section={vm.enabled ? 'on' : 'off'}>
      <h2 id="gpc-settings-title" class="section__title">
        {t('protect_gpc_title')}
      </h2>
      <p>{t('protect_gpc_desc')}</p>
      <div class={'gpc-state gpc-state--' + vm.tone} data-gpc-rule={vm.ruleState} role="status">
        {vm.lines.map((line, i) => (
          <p class="gpc-state__line" key={String(i)}>
            {tm(line)}
          </p>
        ))}
      </div>
      <p class="small">{t('protect_gpc_visibility')}</p>
      <details class="gpc-legal" data-gpc-legal="true">
        <summary class="gpc-legal__summary">{t('protect_gpc_legal_title')}</summary>
        <div class="gpc-legal__body">
          {vm.legal.map((line, i) => (
            <p class="small" key={String(i)}>
              {tm(line)}
            </p>
          ))}
        </div>
      </details>
      <p class="small muted">{t('protect_gpc_gaps')}</p>
    </section>
  );
}
