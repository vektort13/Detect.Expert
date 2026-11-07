// S13 / E13-02: side-panel filters and grouping (pure view models).
import { describe, expect, it } from 'vitest';
import { EVIDENCE_SOURCES } from '@detect-expert/contracts';
import { buildCards } from '../src/view-models/cards';
import type { CardVM } from '../src/view-models/cards';
import { CONFIDENCE_ORDER, KIND_ORDER, NO_FILTER, applyCardFilter, filterOptions, filterSummary, groupCards, isFilterActive } from '../src/view-models/filters';
import type { CardFilter } from '../src/view-models/filters';
import { CATEGORY_ORDER } from '../src/view-models/techniques';
import { fallbackMessage } from '../src/i18n';
import { resolveMessage } from '../src/view-models/message';
import { finding, report, technique } from './fixtures';

const r = (m: Parameters<typeof resolveMessage>[1]) => resolveMessage(fallbackMessage, m);

/** DET-002 hypothesis (graphics), DET-001 api-use (graphics), DET-032 api-use (environment), DET-059 network. */
function cards(): CardVM[] {
  return buildCards(report({
    techniques: [
      technique({ techniqueId: 'DET-002', count: 4, firstBucket: 2, lastBucket: 9 }),
      technique({ techniqueId: 'DET-001', count: 1, firstBucket: 0, lastBucket: 1 }),
      technique({ techniqueId: 'DET-032', count: 2, firstBucket: 40, lastBucket: 41 }),
      technique({ techniqueId: 'DET-059', count: 5, evidenceSource: 'browser-network', integrity: 'browser-observed', firstBucket: 3, lastBucket: 7 }),
    ],
    findings: [finding({ findingId: 'fp', techniqueId: 'DET-002', interpretation: 'possible-fingerprinting', interpretationConfidence: 'low' })],
  }));
}

const filter = (patch: Partial<CardFilter>): CardFilter => ({ ...NO_FILTER, ...patch });

describe('CardFilter', () => {
  it('NO_FILTER is inactive; any field makes it active', () => {
    expect(isFilterActive(NO_FILTER)).toBe(false);
    expect(Object.isFrozen(NO_FILTER)).toBe(true);
    for (const patch of [{ category: 'graphics' }, { kind: 'api-use' }, { confidence: 'low' }, { source: 'page-hook' }] as const) {
      expect(isFilterActive(filter(patch))).toBe(true);
    }
  });

  it('applies the search query first, then every field; order is kept', () => {
    const all = cards();
    expect(applyCardFilter(all, '', NO_FILTER).map((c) => c.techniqueId)).toEqual(all.map((c) => c.techniqueId));
    expect(applyCardFilter(all, '', filter({ category: 'environment' })).map((c) => c.techniqueId)).toEqual(['DET-032']);
    expect(applyCardFilter(all, '', filter({ kind: 'possible-fingerprinting' })).map((c) => c.techniqueId)).toEqual(['DET-002']);
    expect(applyCardFilter(all, '', filter({ confidence: 'unassessed' })).map((c) => c.techniqueId).sort()).toEqual(['DET-001', 'DET-032', 'DET-059']);
    expect(applyCardFilter(all, '', filter({ source: 'browser-network' })).map((c) => c.techniqueId)).toEqual(['DET-059']);
    expect(applyCardFilter(all, 'det-00', filter({ category: 'graphics' })).map((c) => c.techniqueId).sort()).toEqual(['DET-001', 'DET-002']);
    expect(applyCardFilter(all, 'det-032', filter({ category: 'graphics' }))).toEqual([]);
    expect(applyCardFilter(all, 'det-002', filter({ kind: 'api-use' }))).toEqual([]);
  });
});

describe('filterOptions', () => {
  it('lists only values present in the data, with counts, in the fixed order', () => {
    const options = filterOptions(cards(), NO_FILTER);
    expect(options.category.map((o) => [o.value, o.count])).toEqual([['graphics', 2], ['environment', 1], ['network', 1]]);
    expect(options.kind.map((o) => [o.value, o.count])).toEqual([['possible-fingerprinting', 1], ['api-use', 3]]);
    expect(options.confidence.map((o) => [o.value, o.count])).toEqual([['low', 1], ['unassessed', 3]]);
    expect(options.source.map((o) => [o.value, o.count])).toEqual([['browser-network', 1], ['page-hook', 3]]);
    expect(r(options.category[0]!.label)).toBe('category_graphics');
    expect(r(options.kind[0]!.label)).toBe('card_fp_label');
    expect(r(options.kind[1]!.label)).toBe('card_api_use_label');
    expect(r(options.confidence[0]!.label)).toBe('confidence_low');
    expect(r(options.source[1]!.label)).toBe('evidence_page_hook');
  });

  it('keeps the current value even when no card has it (count 0), at its ordered position', () => {
    const options = filterOptions(cards(), { category: 'audio', kind: 'unknown', confidence: 'high', source: 'derived' });
    expect(options.category.map((o) => [o.value, o.count])).toEqual([['graphics', 2], ['audio', 0], ['environment', 1], ['network', 1]]);
    expect(options.kind.map((o) => [o.value, o.count])).toEqual([['possible-fingerprinting', 1], ['api-use', 3], ['unknown', 0]]);
    expect(options.confidence.map((o) => [o.value, o.count])).toEqual([['high', 0], ['low', 1], ['unassessed', 3]]);
    expect(options.source.map((o) => o.value)).toEqual(['browser-network', 'page-hook', 'derived']);
  });

  it('the orders are the documented ones', () => {
    expect(KIND_ORDER).toEqual(['possible-fingerprinting', 'api-use', 'unknown']);
    expect(CONFIDENCE_ORDER).toEqual(['high', 'medium', 'low', 'unassessed']);
    expect(CATEGORY_ORDER).toEqual(['graphics', 'audio', 'environment', 'permissions', 'storage', 'network']);
    expect(filterOptions([], NO_FILTER)).toEqual({ category: [], kind: [], confidence: [], source: [] });
    expect(EVIDENCE_SOURCES.length).toBeGreaterThanOrEqual(2);
  });
});

describe('groupCards', () => {
  it('groups by category in CATEGORY_ORDER and by kind in KIND_ORDER; sizes add up to the card count', () => {
    const all = cards();
    const byCategory = groupCards(all, 'category');
    expect(byCategory.map((g) => [g.key, g.cards.length])).toEqual([['graphics', 2], ['environment', 1], ['network', 1]]);
    expect(r(byCategory[0]!.label)).toBe('category_graphics');
    const byKind = groupCards(all, 'kind');
    expect(byKind.map((g) => [g.key, g.cards.length])).toEqual([['possible-fingerprinting', 1], ['api-use', 3]]);
    expect(r(byKind[0]!.label)).toBe('card_fp_label');
    for (const groups of [byCategory, byKind]) expect(groups.reduce((n, g) => n + g.cards.length, 0)).toBe(all.length);
    expect(groupCards([], 'kind')).toEqual([]);
  });

  it('keeps the rank order of cards inside a group', () => {
    const all = cards();
    const graphics = groupCards(all, 'category')[0]!.cards.map((c) => c.techniqueId);
    expect(graphics).toEqual(all.filter((c) => c.category === 'graphics').map((c) => c.techniqueId));
  });
});

it('filterSummary is «Показано N из M»', () => {
  expect(r(filterSummary(1, 3))).toBe('filter_summary[1, 3]');
});
