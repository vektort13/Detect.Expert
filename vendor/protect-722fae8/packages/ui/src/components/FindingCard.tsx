// Finding / technique card with three separate levels (observation, interpretation, purpose in general) and
// expandable details: API, integrity badge, rule id/version, counters, limitations, ordinary explanations.
// S13 (E13-02): after attribution — approximate activity (page-hook buckets only), page-context signal codes and the
// document the report is about.

import { t, tm, tOptional } from '../i18n';
import type { CardVM } from '../view-models/cards';
import { categoryKey } from '../view-models/techniques';
import { activityMessage, documentScopeKey, validBuckets } from '../view-models/timeline';
import { IntegrityBadge } from './IntegrityBadge';

function codeText(prefix: string, code: string): string {
  const slug = code.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return tOptional(prefix + slug) ?? code;
}

function CodeList(props: { prefix: string; codes: ReadonlyArray<string> }) {
  if (props.codes.length === 0) return <span>{t('detail_none')}</span>;
  return (
    <ul class="codes">
      {props.codes.map((code) => (
        <li key={code}>{codeText(props.prefix, code)}</li>
      ))}
    </ul>
  );
}

function Row(props: { term: string; children: preact.ComponentChildren }) {
  return (
    <div class="details__row">
      <dt>{props.term}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

export interface FindingCardProps {
  idPrefix: string;
  card: CardVM;
  open?: boolean;
}

export function FindingCard(props: FindingCardProps) {
  const card = props.card;
  const headingId = props.idPrefix + '-card-' + encodeURIComponent(card.id);
  const countText = typeof card.countLabel === 'string' ? card.countLabel : tm(card.countLabel);
  const activity = card.firstBucket !== null && card.lastBucket !== null && validBuckets(card.firstBucket, card.lastBucket) ? activityMessage(card.firstBucket, card.lastBucket) : null;
  const documentKey = documentScopeKey(card.documentKey);
  return (
    <article class={'card card--' + card.kind} aria-labelledby={headingId}>
      <div class="card__head">
        <h3 id={headingId} class="card__label">
          <span class={'chip chip--' + card.kind}>{tm(card.label)}</span>
        </h3>
        <span class="muted small mono">{card.techniqueId}</span>
      </div>
      <dl class="levels">
        <div class="levels__row">
          <dt>{t('level_observation')}</dt>
          <dd>
            {tm(card.observation)}
            {card.attemptOnly ? <span class="block small muted">{t('card_api_use_attempt_only')}</span> : null}
            {card.completionUnobserved ? <span class="block small muted">{t('phase_settlement_unobserved')}</span> : null}
          </dd>
        </div>
        <div class="levels__row">
          <dt>{t('level_interpretation')}</dt>
          <dd>
            {tm(card.interpretation)}
            {card.interpretationNote !== null ? <span class="block small muted">{tm(card.interpretationNote)}</span> : null}
            {card.familyNote !== null ? <span class="block small muted">{tm(card.familyNote)}</span> : null}
            <span class="block small muted">{tm(card.confidence)}</span>
            {card.counterEvidenceCodes.length > 0 ? (
              <span class="block small muted">{t('card_fp_alternatives', [card.counterEvidenceCodes.map((code) => codeText('alternative_', code)).join(', ')])}</span>
            ) : null}
          </dd>
        </div>
        <div class="levels__row">
          <dt>{t('level_purpose')}</dt>
          <dd>{tm(card.purpose)}</dd>
        </div>
      </dl>
      <details class="card__details" open={props.open === true}>
        <summary>{t('detail_show')}</summary>
        <dl class="details">
          <Row term={t('detail_api')}>
            <span class="mono">{card.api}</span>
          </Row>
          <Row term={t('detail_technique')}>
            <span class="mono">{card.techniqueId}</span>
          </Row>
          <Row term={t('detail_category')}>{t(categoryKey(card.category))}</Row>
          <Row term={t('detail_evidence')}>
            <IntegrityBadge integrity={card.integrity} evidenceSource={card.evidenceSource} />
          </Row>
          <Row term={t('detail_attribution')}>{t('attribution_' + card.attribution.replace(/-/g, '_'))}</Row>
          {activity !== null ? <Row term={t('detail_activity')}>{tm(activity)}</Row> : null}
          {card.evidenceSource === 'page-hook' && card.signalCodes.length > 0 ? (
            <Row term={t('detail_signals')}>
              <CodeList prefix="signal_" codes={card.signalCodes} />
            </Row>
          ) : null}
          {documentKey !== null ? <Row term={t('detail_document')}>{t(documentKey)}</Row> : null}
          <Row term={t('detail_rule')}>
            {card.ruleId === null ? t('detail_none') : <span class="mono">{card.ruleId + (card.ruleVersion === null ? '' : ' v' + card.ruleVersion)}</span>}
          </Row>
          {card.findingId !== null ? (
            <Row term={t('detail_finding_id')}>
              <span class="mono">{card.findingId}</span>
            </Row>
          ) : null}
          {card.evidenceIds.length > 0 ? (
            <Row term={t('detail_evidence_ids')}>
              <span class="mono">{card.evidenceIds.join(', ')}</span>
            </Row>
          ) : null}
          <Row term={t('detail_counts')}>
            <span class="num">{countText}</span> <span class="muted small">({t('count_' + card.countQuality.replace(/-/g, '_'))})</span>
          </Row>
          <Row term={t('detail_phases')}>
            {card.phases.length === 0 ? t('detail_none') : card.phases.map((phase) => t('phase_' + phase.replace(/-/g, '_'))).join(', ')}
          </Row>
          {card.operations.length > 0 ? (
            <Row term={t('detail_operations')}>
              <ul class="codes">
                {card.operations.map((item) =>
                  typeof item === 'string' ? (
                    <li key={'api:' + item} class="mono">{item}</li>
                  ) : (
                    <li key={'key:' + item.key}>{tm(item)}</li>
                  ),
                )}
              </ul>
              <span class="block small muted">{t('detail_operations_hint')}</span>
            </Row>
          ) : null}
          <Row term={t('detail_limitations')}>
            <CodeList prefix="limitation_" codes={card.limitationCodes} />
          </Row>
          <Row term={t('detail_alternatives')}>
            <CodeList prefix="alternative_" codes={card.counterEvidenceCodes} />
          </Row>
        </dl>
      </details>
    </article>
  );
}
