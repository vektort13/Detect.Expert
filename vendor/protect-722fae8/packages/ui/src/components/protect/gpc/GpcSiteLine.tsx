// ADR-020 §H (S13): GPC line of the popup for the shown site — whether the signal is sent there, «Не отправлять на этом
// сайте» (= ui-protect-set-site excluded:true; bringing the site back is an Options-only action), and, collapsed, what
// Chrome reported for this page's requests («добавлен к запросу», never «the server received»). The reload note shows
// when the setting changed after the page loaded (the header follows at once, the property only after a reload).

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { t, tm } from '../../../i18n';
import { errorMessageKey, protectUi } from '../../../messaging';
import { gpcSiteLineView } from '../../../view-models/protect-gpc';
import type { ProtectPopupSlotProps } from '../ProtectPopupArea';

export function GpcSiteLine(props: ProtectPopupSlotProps): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const vm = gpcSiteLineView(props.state, props.report);
  if (vm === null) return null;

  const exclude = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const result = await protectUi.setSite(vm.site, true);
    setBusy(false);
    setNotice(result.ok ? null : t(errorMessageKey(result.code)));
    await props.refreshState();
    await props.refreshReport();
  };

  return (
    <section class={'gpc gpc--' + vm.tone} aria-labelledby="popup-gpc-title" data-gpc-site={vm.siteState}>
      <h3 id="popup-gpc-title" class="gpc__title">
        {vm.line === null ? t('protect_gpc_label') : tm(vm.line)}
      </h3>
      {vm.ruleError.map((line, i) => (
        <p class="gpc__line small" key={'e' + String(i)} data-gpc-rule-error="true">
          {tm(line)}
        </p>
      ))}
      {vm.excludedHint !== null ? <p class="gpc__line small muted">{tm(vm.excludedHint)}</p> : null}
      {vm.reload !== null ? (
        <p class="gpc__line small" data-gpc-reload="true">
          {tm(vm.reload)}
        </p>
      ) : null}
      {vm.canExclude ? (
        <p class="actions gpc__actions">
          <button type="button" class="button" disabled={busy} aria-busy={busy} data-gpc-exclude="true" onClick={() => void exclude()}>
            {t('protect_gpc_site_exclude')}
          </button>
        </p>
      ) : null}
      {vm.details.length > 0 ? (
        <details class="gpc__details" data-gpc-details="true">
          <summary class="gpc__summary">{t('protect_gpc_details')}</summary>
          <div class="gpc__body">
            {vm.details.map((line, i) => (
              <p class="gpc__line small" key={String(i)}>
                {tm(line)}
              </p>
            ))}
          </div>
        </details>
      ) : null}
      {notice !== null ? (
        <p class="small" role="status" data-gpc-notice="true">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
