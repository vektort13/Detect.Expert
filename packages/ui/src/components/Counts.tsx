// Three numeric groups: Техники / Сервисы / Сторонние источники (tabular numerals). A missing host list is
// shown as an explicit "no data" value, never as zero.

import { t } from '../i18n';
import type { CountsVM } from '../view-models/counts';

export function Counts(props: { vm: CountsVM }) {
  const thirdParty = props.vm.thirdParty;
  return (
    <dl class="counts">
      <div class="counts__item">
        <dt>{t('group_techniques')}</dt>
        <dd class="num">{props.vm.techniques}</dd>
      </div>
      <div class="counts__item">
        <dt>{t('group_services')}</dt>
        {props.vm.services === null ? (
          <dd class="num num--na">
            <span aria-hidden="true">—</span>
            <span class="sr-only">{t('counts_unavailable')}</span>
          </dd>
        ) : <dd class="num">{props.vm.services}</dd>}
      </div>
      <div class="counts__item">
        <dt>{t('group_third_party')}</dt>
        {thirdParty === null ? (
          <dd class="num num--na">
            <span aria-hidden="true">—</span>
            <span class="sr-only">{t('counts_unavailable')}</span>
          </dd>
        ) : (
          <dd class="num">{thirdParty}</dd>
        )}
      </div>
    </dl>
  );
}
