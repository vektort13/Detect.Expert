// «Распознанные сервисы защиты и идентификации» (REQ-007, AUD-01): recognition is not trust, no green
// badge, the ThreatMetrix wording of spec V §7 comes from the locale.

import { t, tm } from '../i18n';
import type { VendorCardVM } from '../view-models/cards';
import { IntegrityBadge } from './IntegrityBadge';

function VendorCard(props: { idPrefix: string; vendor: VendorCardVM }) {
  const vendor = props.vendor;
  const headingId = props.idPrefix + '-vendor-' + encodeURIComponent(vendor.vendorId);
  const rules = vendor.ruleIds.length === 0 ? t('detail_none') : vendor.ruleIds.join(', ');
  return (
    <article class="card card--vendor" aria-labelledby={headingId}>
      <h3 id={headingId} class="card__label">
        {tm(vendor.found)}
      </h3>
      <p>{tm(vendor.purpose)}</p>
      <p class="small muted">{t('card_vendor_rules', [rules, tm(vendor.matchLabel)])}</p>
      <p class="small">
        <IntegrityBadge integrity={vendor.integrity} evidenceSource={vendor.evidenceSource} />
      </p>
      <p class="small muted">{t('card_vendor_not_linked')}</p>
    </article>
  );
}

export interface VendorsSectionProps {
  id: string;
  catalogAvailable: boolean;
  vendors: ReadonlyArray<VendorCardVM>;
}

export function VendorsSection(props: VendorsSectionProps) {
  const headingId = props.id + '-title';
  return (
    <section class="section" aria-labelledby={headingId}>
      <h2 id={headingId} class="section__title">
        {t('vendorsSectionTitle')}
      </h2>
      {!props.catalogAvailable ? (
        <p class="muted">{t('vendors_catalog_unavailable')}</p>
      ) : props.vendors.length === 0 ? (
        <p class="muted">{t('vendorsEmpty')}</p>
      ) : (
        <div class="cards">
          {props.vendors.map((vendor) => (
            <VendorCard key={vendor.vendorId} idPrefix={props.id} vendor={vendor} />
          ))}
        </div>
      )}
      <p class="small muted">{t('card_vendor_no_trust')}</p>
    </section>
  );
}
