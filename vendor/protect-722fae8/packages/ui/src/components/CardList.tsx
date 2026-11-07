// Card list with the mandatory empty state («За этот период в доступной области находок нет» + coverage
// stays above it); never a green "all good".

import { t } from '../i18n';
import type { CardVM } from '../view-models/cards';
import { FindingCard } from './FindingCard';

export interface CardListProps {
  id: string;
  cards: ReadonlyArray<CardVM>;
  hiddenCount: number;
  onMore: (() => void) | null;
  emptyKey?: string;
}

export function CardList(props: CardListProps) {
  const headingId = props.id + '-title';
  return (
    <section class="section" aria-labelledby={headingId}>
      <h2 id={headingId} class="section__title">
        {t('findings_title')}
      </h2>
      {props.cards.length === 0 ? (
        <div class="empty">
          <p class="empty__title">{t(props.emptyKey ?? 'empty_no_findings')}</p>
          <p class="small muted">{t('empty_no_findings_hint')}</p>
        </div>
      ) : (
        <div class="cards">
          {props.cards.map((card) => (
            <FindingCard key={card.id} idPrefix={props.id} card={card} />
          ))}
        </div>
      )}
      {props.hiddenCount > 0 ? (
        <p class="actions">
          {props.onMore !== null ? (
            <button type="button" class="button button--text" onClick={props.onMore}>
              {t('more_in_panel', [String(props.hiddenCount)])}
            </button>
          ) : (
            <span class="small muted">{t('more_in_panel', [String(props.hiddenCount)])}</span>
          )}
        </p>
      ) : null}
    </section>
  );
}
