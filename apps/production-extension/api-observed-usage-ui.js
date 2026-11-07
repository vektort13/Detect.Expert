// E22-21: factual page-observation presentation, independent of editable API modes.
export function observedApiUsage(usage, id) {
  if (usage?.status !== 'ready' || !usage.byApi || !Object.hasOwn(usage.byApi, id)) return null;
  const row = usage.byApi[id];
  return row && Number.isSafeInteger(row.count) && row.count > 0 ? row : null;
}
export function observedApiClass(usage, id) {
  const row = observedApiUsage(usage, id);
  return row ? ' api-usage-highlight api-usage-highlight--' + (row.fingerprintPattern === true ? 'fingerprint' : row.attempted === true ? 'attempted' : 'observed') : '';
}
export function observedApiAttributes(usage, id) {
  const row = observedApiUsage(usage, id);
  return row ? { 'data-api-observed': id, 'data-api-observed-kind': row.fingerprintPattern === true ? 'fingerprint' : row.attempted === true ? 'attempted' : 'observed' } : {};
}

export function createApiObservedUsageUi({ h, useLocale, translate }) {
  const text = key => translate('api_observed_' + key);
  function Icon({ pattern = false }) {
    return h('svg', { width: 15, height: 15, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.65, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true, focusable: 'false', children: h('path', { d: pattern ? 'M10 2a8 8 0 0 1 8 8M2 10a8 8 0 0 1 8-8M5 10a5 5 0 0 1 10 0v3m-7-3a2 2 0 0 1 4 0v5M5 13v2m3-2v4m7-1v1' : 'M2 10h4l2-6 4 12 2-6h4' }) });
  }
  function UsageBadge({ usage, apiId, label = null }) {
    useLocale?.();
    const row = observedApiUsage(usage, apiId); if (!row) return null;
    const kind = row.fingerprintPattern === true ? 'fingerprint' : row.attempted === true ? 'attempted' : 'observed';
    return h('div', { class: 'api-usage-badges', 'data-api-observed-badge': apiId, children: [
      label ? h('span', { class: 'api-usage-subject', dir: 'ltr', children: label }) : null,
      h('span', { class: 'api-usage-badge api-usage-badge--' + (row.attempted === true ? 'attempted' : 'observed'), children: [h(Icon, {}), text(row.attempted === true ? 'attempted' : 'observed')] }),
      row.fingerprintPattern === true ? h('span', { class: 'api-usage-badge api-usage-badge--fingerprint', 'data-api-observed-fingerprint': apiId, children: [h(Icon, { pattern: true }), text('fingerprint')] }) : null,
      ...[['firstPartyCount', 'first_party'], ['thirdPartyCount', 'third_party'], ['unknownCount', 'unknown_party']].filter(([key]) => Number.isSafeInteger(row[key]) && row[key] > 0).map(([key, label]) => h('span', { class: 'api-usage-party api-usage-party--' + label, 'data-api-observed-party': label, key, children: text(label) }))
    ], 'data-api-observed-badge-kind': kind });
  }
  function UsageContext({ usage, filtered = false, onFilterChange, showFilter = true }) {
    useLocale?.(); if (!usage) return null;
    const ready = usage.status === 'ready', status = ({ loading: 'loading', 'no-site': 'no_site', 'no-access': 'no_access', paused: 'paused', unsupported: 'unsupported', error: 'unavailable', stale: 'stale' })[usage.status];
    const hasRows = ready && Object.keys(usage.byApi ?? {}).some(id => observedApiUsage(usage, id));
    const coverage = usage.truncated ? 'partial' : usage.coverageState;
    const coverageKey = typeof coverage === 'string' && ['active', 'partial', 'late-start', 'paused', 'unsupported', 'no-access', 'degraded'].includes(coverage) ? 'status_' + coverage.replaceAll('-', '_') : null;
    return h('section', { class: 'api-usage-context', 'data-api-observed-context': true, 'data-api-observed-status': usage.status, children: [
      h('div', { class: 'api-usage-context__copy', children: [
        h('div', { class: 'api-usage-context__heading', children: [h('span', { class: 'api-usage-context__icon', children: h(Icon, {}) }), h('strong', { children: text('title') }), typeof usage.host === 'string' && usage.host ? h('bdi', { class: 'api-usage-context__host', dir: 'ltr', 'data-api-observed-host': true, children: usage.host }) : null] }),
        h('p', { class: 'api-usage-context__status', role: 'status', children: ready ? [text('scope'), coverageKey ? h('span', { class: 'api-usage-context__coverage', 'data-api-observed-coverage': coverage, children: translate(coverageKey) }) : null, !hasRows ? h('span', { 'data-api-observed-none': true, children: text('none') }) : null] : text(status ?? 'unavailable') })
      ] }),
      showFilter && typeof onFilterChange === 'function' ? h('label', { class: 'api-usage-filter', children: [h('input', { type: 'checkbox', checked: filtered, disabled: !ready, 'data-api-observed-filter': true, onChange: event => onFilterChange(event.currentTarget.checked) }), h('span', { children: text('filter') })] }) : null
    ] });
  }
  return { UsageBadge, UsageContext };
}
