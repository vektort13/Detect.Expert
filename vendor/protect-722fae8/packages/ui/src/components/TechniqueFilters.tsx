// Side-panel filters (S13, E13-02, spec V §7): native label + select for category, interpretation, confidence, data
// source (only when the report has at least two sources) and grouping. A visible «Показано N из M» line (not a live
// region: SearchFeedback announces) and «Сбросить фильтры», which keeps focus on itself after the reset.

import { t, tm } from '../i18n';
import type { CardFilter, FilterOption, FilterOptionsVM, Grouping } from '../view-models/filters';
import { NO_FILTER, filterSummary, isFilterActive } from '../view-models/filters';

export interface TechniqueFiltersProps {
  idPrefix: string;
  options: FilterOptionsVM;
  filter: CardFilter;
  onFilter: (filter: CardFilter) => void;
  grouping: Grouping;
  onGrouping: (grouping: Grouping) => void;
  shown: number;
  total: number;
}

function optionText(option: FilterOption<string>): string {
  return t('filter_option_count', [tm(option.label), String(option.count)]);
}

function Select(props: { id: string; label: string; value: string; options: ReadonlyArray<FilterOption<string>>; onChange: (value: string) => void }) {
  return (
    <div class="field">
      <label for={props.id}>{props.label}</label>
      <select id={props.id} value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)}>
        <option value="all">{t('filter_all')}</option>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {optionText(option)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TechniqueFilters(props: TechniqueFiltersProps) {
  const id = props.idPrefix + '-filters';
  const filter = props.filter;
  const set = (patch: Partial<CardFilter>) => props.onFilter({ ...filter, ...patch } as CardFilter);
  const showSource = props.options.source.length >= 2 || filter.source !== 'all';
  return (
    <section class="section" aria-labelledby={id + '-title'} data-technique-filters="true">
      <h3 id={id + '-title'} class="group__title">
        {t('filters_title')}
      </h3>
      <div class="filters">
        <Select id={id + '-category'} label={t('detail_category')} value={filter.category} options={props.options.category}
          onChange={(value) => set({ category: value as CardFilter['category'] })} />
        <Select id={id + '-kind'} label={t('filter_kind')} value={filter.kind} options={props.options.kind}
          onChange={(value) => set({ kind: value as CardFilter['kind'] })} />
        <Select id={id + '-confidence'} label={t('filter_confidence')} value={filter.confidence} options={props.options.confidence}
          onChange={(value) => set({ confidence: value as CardFilter['confidence'] })} />
        {showSource ? (
          <Select id={id + '-source'} label={t('detail_evidence')} value={filter.source} options={props.options.source}
            onChange={(value) => set({ source: value as CardFilter['source'] })} />
        ) : null}
        <div class="field">
          <label for={id + '-group'}>{t('group_by')}</label>
          <select id={id + '-group'} value={props.grouping} onChange={(event) => props.onGrouping(event.currentTarget.value === 'kind' ? 'kind' : 'category')}>
            <option value="category">{t('group_by_category')}</option>
            <option value="kind">{t('group_by_kind')}</option>
          </select>
        </div>
      </div>
      <p class="filters__footer">
        <span id={id + '-summary'} class="small muted" data-filter-summary="true">
          {tm(filterSummary(props.shown, props.total))}
        </span>
        <button type="button" class="button" data-filter-active={isFilterActive(filter) ? 'true' : 'false'} onClick={() => props.onFilter(NO_FILTER)}>
          {t('filter_reset')}
        </button>
      </p>
    </section>
  );
}
