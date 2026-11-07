// Three numeric groups: Техники / Сервисы / Сторонние источники (tabular numerals). A missing or hidden host list
// is shown as an explicit "—" with a screen-reader reason, never as zero; a lower bound is shown as "≥ N".

import { t } from '../i18n';
import type { CountsVM } from '../view-models/counts';

function Unknown(props: { reason: string }) {
  return (
    <dd class="num num--na">
      <span aria-hidden="true">—</span>
      <span class="sr-only">{props.reason}</span>
    </dd>
  );
}

function ThirdParty(props: { vm: CountsVM }) {
  const { thirdParty, thirdPartyQuality, thirdPartyNote } = props.vm;
  if (thirdParty === null) return <Unknown reason={thirdPartyNote === 'limited' ? t('counts_third_party_limited') : t('counts_unavailable')} />;
  if (thirdPartyQuality === 'lower-bound') {
    return (
      <dd class="num">
        <span aria-hidden="true">≥ {thirdParty}</span>
        <span class="sr-only">{t('count_value_lower_bound', [String(thirdParty)])}</span>
      </dd>
    );
  }
  return <dd class="num">{thirdParty}</dd>;
}

export function Counts(props: { vm: CountsVM }) {
  return (
    <dl class="counts">
      <div class="counts__item">
        <dt>{t('group_techniques')}</dt>
        <dd class="num">{props.vm.techniques}</dd>
      </div>
      <div class="counts__item">
        <dt>{t('group_services')}</dt>
        {props.vm.services === null ? <Unknown reason={t('counts_unavailable')} /> : <dd class="num">{props.vm.services}</dd>}
      </div>
      <div class="counts__item">
        <dt>{t('group_third_party')}</dt>
        <ThirdParty vm={props.vm} />
      </div>
    </dl>
  );
}
