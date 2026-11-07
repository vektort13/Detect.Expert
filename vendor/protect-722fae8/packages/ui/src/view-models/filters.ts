// Side-panel filters and grouping of technique cards (S13, E13-02, spec V §7). Pure: the component holds the state,
// nothing is stored or sent. Options list only values present in the data (with counts) plus the current value.

import { EVIDENCE_SOURCES } from '@detect-expert/contracts';
import type { EvidenceSource, InterpretationConfidence } from '@detect-expert/contracts';
import { confidenceKey, filterCards, kindLabelKey } from './cards';
import type { CardKind, CardVM } from './cards';
import { msg } from './message';
import type { Message } from './message';
import { CATEGORY_ORDER, categoryKey } from './techniques';
import type { TechniqueCategory } from './techniques';

export interface CardFilter {
  category: TechniqueCategory | 'all';
  kind: CardKind | 'all';
  confidence: InterpretationConfidence | 'all';
  source: EvidenceSource | 'all';
}

export const NO_FILTER: Readonly<CardFilter> = Object.freeze({ category: 'all', kind: 'all', confidence: 'all', source: 'all' });

/** Kind options: hypotheses first, then plain API use, then "not enough data". */
export const KIND_ORDER: ReadonlyArray<CardKind> = ['possible-fingerprinting', 'api-use', 'unknown'];
export const CONFIDENCE_ORDER: ReadonlyArray<InterpretationConfidence> = ['high', 'medium', 'low', 'unassessed'];

export function isFilterActive(filter: CardFilter): boolean {
  return filter.category !== 'all' || filter.kind !== 'all' || filter.confidence !== 'all' || filter.source !== 'all';
}

function matches(card: CardVM, filter: CardFilter): boolean {
  return (
    (filter.category === 'all' || card.category === filter.category) &&
    (filter.kind === 'all' || card.kind === filter.kind) &&
    (filter.confidence === 'all' || card.confidenceLevel === filter.confidence) &&
    (filter.source === 'all' || card.evidenceSource === filter.source)
  );
}

/** Search query first (filterCards), then the field filters; order of the input is kept. */
export function applyCardFilter(cards: ReadonlyArray<CardVM>, query: string, filter: CardFilter): CardVM[] {
  const searched = filterCards(cards, query);
  return isFilterActive(filter) ? searched.filter((card) => matches(card, filter)) : searched;
}

export interface FilterOption<T extends string> {
  value: T;
  /** Cards with this value among the cards the options were built from (0 only for a kept current value). */
  count: number;
  label: Message;
}

export interface FilterOptionsVM {
  category: Array<FilterOption<TechniqueCategory>>;
  kind: Array<FilterOption<CardKind>>;
  confidence: Array<FilterOption<InterpretationConfidence>>;
  source: Array<FilterOption<EvidenceSource>>;
}

function sourceKey(source: EvidenceSource): string {
  return 'evidence_' + source.replace(/-/g, '_');
}

function optionsOf<T extends string>(
  order: ReadonlyArray<T>,
  cards: ReadonlyArray<CardVM>,
  valueOf: (card: CardVM) => T,
  current: T | 'all',
  labelKey: (value: T) => string,
): Array<FilterOption<T>> {
  const counts = new Map<T, number>();
  for (const card of cards) {
    const value = valueOf(card);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const out: Array<FilterOption<T>> = [];
  for (const value of order) {
    const count = counts.get(value) ?? 0;
    if (count > 0 || value === current) out.push({ value, count, label: msg(labelKey(value)) });
  }
  return out;
}

/**
 * Options of each filter: only values present in `cards`, with counts, in the fixed display order (categories by
 * CATEGORY_ORDER; kinds possible-fingerprinting, api-use, unknown; confidence high → unassessed; sources by
 * EVIDENCE_SOURCES). The current value is always listed (count 0 when no card has it), so a select never loses it.
 */
export function filterOptions(cards: ReadonlyArray<CardVM>, current: CardFilter): FilterOptionsVM {
  return {
    category: optionsOf(CATEGORY_ORDER, cards, (card) => card.category, current.category, categoryKey),
    kind: optionsOf(KIND_ORDER, cards, (card) => card.kind, current.kind, kindLabelKey),
    confidence: optionsOf(CONFIDENCE_ORDER, cards, (card) => card.confidenceLevel, current.confidence, confidenceKey),
    source: optionsOf(EVIDENCE_SOURCES, cards, (card) => card.evidenceSource, current.source, sourceKey),
  };
}

export type Grouping = 'category' | 'kind';

export interface CardGroup {
  /** Grouping value (category or kind); unique within one grouping. */
  key: string;
  label: Message;
  cards: CardVM[];
}

function groupBy<T extends string>(cards: ReadonlyArray<CardVM>, order: ReadonlyArray<T>, valueOf: (card: CardVM) => T, labelKey: (value: T) => string): CardGroup[] {
  const groups = new Map<T, CardVM[]>();
  for (const card of cards) {
    const value = valueOf(card);
    const list = groups.get(value);
    if (list === undefined) groups.set(value, [card]);
    else list.push(card);
  }
  const out: CardGroup[] = [];
  for (const value of order) {
    const list = groups.get(value);
    if (list !== undefined) out.push({ key: value, label: msg(labelKey(value)), cards: list });
  }
  // Defensive: a value outside the display order still gets a group, so no card is ever hidden by grouping.
  for (const [value, list] of groups) {
    if (!order.includes(value)) out.push({ key: value, label: msg(labelKey(value)), cards: list });
  }
  return out;
}

/** Groups in display order; every card is in exactly one group (sum of group sizes = number of cards). */
export function groupCards(cards: ReadonlyArray<CardVM>, grouping: Grouping): CardGroup[] {
  return grouping === 'kind'
    ? groupBy(cards, KIND_ORDER, (card) => card.kind, kindLabelKey)
    : groupBy(cards, CATEGORY_ORDER, (card) => card.category, categoryKey);
}

/** «Показано N из M». */
export function filterSummary(shown: number, total: number): Message {
  return msg('filter_summary', shown, total);
}
