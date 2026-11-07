// «Распознанные сервисы защиты и идентификации» (REQ-007, AUD-01): recognition is not trust, no green
// badge, the ThreatMetrix wording of spec V §7 comes from the locale.
// S10 / ADR-009 v1.1: a card names the service and its general purpose (catalog), says that a network match only
// means the browser received the resource, lists the matched rules with version and catalog version, and keeps the
// rule texts (what was observed / what it does not mean) behind <details>. Without an active catalog the markup is
// exactly the pre-S10 one (catalog unavailable + disclaimer).

import { t, tm } from '../i18n';
import type { VendorCardVM } from '../view-models/cards';
import { IntegrityBadge } from './IntegrityBadge';

function VendorCard(props: { idPrefix: string; vendor: VendorCardVM }) {
  const vendor = props.vendor;
  const headingId = props.idPrefix + '-vendor-' + encodeURIComponent(vendor.vendorId);
  const explained = vendor.rules.filter((rule) => rule.meaning !== null || rule.limitations !== null);
  return (
    <article class="card card--vendor" aria-labelledby={headingId}>
      <h3 id={headingId} class="card__label">
        {tm(vendor.found)}
      </h3>
      <p>{tm(vendor.purpose)}</p>
      {vendor.requestOnly ? <p class="small">{t('card_vendor_request_only')}</p> : null}
      <p class="small muted">{tm(vendor.matchLabel)}</p>
      {vendor.rules.length > 0 ? (
        <ul class="small muted">
          {vendor.rules.map((rule) => (
            <li key={rule.ruleId}>{t('card_vendor_rule_line', [rule.ruleId, rule.ruleVersion ?? '—', vendor.catalogVersion ?? '—'])}</li>
          ))}
        </ul>
      ) : null}
      {explained.length > 0 ? (
        <details class="card__details small">
          <summary>{t('card_vendor_details')}</summary>
          {explained.map((rule) => (
            <div key={rule.ruleId}>
              {rule.meaning !== null ? <p>{t('card_vendor_rule_meaning', [rule.meaning])}</p> : null}
              {rule.limitations !== null ? <p>{t('card_vendor_rule_limitations', [rule.limitations])}</p> : null}
            </div>
          ))}
        </details>
      ) : null}
      <p class="small">
        <IntegrityBadge integrity={vendor.integrity} evidenceSource={vendor.evidenceSource} />
      </p>
      <p class="small muted">{t('card_vendor_not_linked')}</p>
    </article>
  );
}

export interface VendorsSectionProps {
  id: string;
  /** S10: the SW matched this projection against an active catalog (catalogVersion not null). */
  catalogAvailable: boolean;
  vendors: ReadonlyArray<VendorCardVM>;
  /** S10: requests to other hosts are not visible (scope other than all-sites, or network-limited). */
  coverageLimited?: boolean;
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
        <>
          <p class="muted">{t('vendorsEmpty')}</p>
          {props.coverageLimited === true ? <p class="small muted">{t('vendors_coverage_limited')}</p> : null}
        </>
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
