// REQ-004/005/013: present every saved Pro value, independently of finding cards.
// Input is the validated, stopped recording. This module does not collect data.
export function recordedValueRows(page) {
  const documents = new Map((page.reports ?? []).map(report => [report.documentKey, report]));
  return (page.apiValues ?? []).flatMap(document => document.rows.map((row, index) => ({
    row, index, documentKey: document.documentKey, host: documents.get(document.documentKey)?.host ?? null
  })));
}

// A value shared by several sites is listed once; every different value remains.
// Names and values are the only data projected into these session-wide summaries.
export function summaryValueRows(session, cookies = false, locale = 'en') {
  const unique = new Map();
  const add = (name, value, type = typeof value) => {
    const display = type === 'string' ? cookies ? value : JSON.stringify(value) : value === null ? 'null' : String(value);
    const readable = display.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
      character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
    const row = { name, value: readable };
    unique.set(JSON.stringify([name, type, display]), row);
  };
  for (const page of session.pages) {
    if (cookies) {
      for (const row of page.cookieValues?.rows ?? []) add(row.name, row.value);
      continue;
    }
    for (const { row } of recordedValueRows(page)) {
      const value = row.value;
      const name = row.operation + (row.parameters.length ? '(' + row.parameters.map(parameter => parameter.name + '=' + parameter.value).join(', ') + ')' : '');
      if (value.kind === 'unobserved' || row.phase === 'threw-sync') continue;
      if (value.kind === 'webrtc' || value.kind === 'technical') {
        for (const field of value.fields) add(name + '.' + field.name + '[' + field.index + ']', field.value,
          field.kind === 'special-number' ? 'number' : typeof field.value);
      } else if (value.kind === 'number-array') {
        value.values.forEach((number, index) => add(name + '[' + index + ']', number, 'number'));
      } else if (value.kind === 'null') add(name, null);
      else if (value.kind === 'undefined') add(name, undefined);
      else add(name, value.value, value.kind === 'special-number' ? 'number' : typeof value.value);
    }
    for (const row of page.requestValues?.rows ?? []) add(row.name, row.value);
    // Include concrete decoded payload fields of browser-observed requests.
    // Identifier-presence flags and page call attempts are not transmitted values.
    for (const document of page.beacons ?? []) for (const row of document.rows) {
      if (row.evidenceSource !== 'browser-network') continue;
      const prefix = row.service + '.beacon.';
      // These profiles infer "conversion" from the endpoint, not an event value.
      if (!['google-ads-browser-v1', 'linkedin-image-v1', 'linkedin-capi-v1'].includes(row.profile)) {
        for (const event of row.events) if (event !== 'unknown') add(prefix + 'event', event);
      }
      for (const item of row.money) {
        const event = item.event === 'unknown' ? '' : item.event + '.';
        add(prefix + event + item.purpose, item.value, 'number');
        if (item.currency !== null) add(prefix + event + 'currency', item.currency);
      }
      for (const field of ['adUserData', 'adPersonalization']) {
        if (['granted', 'denied'].includes(row.consent[field])) add(prefix + 'consent.' + field, row.consent[field]);
      }
    }
  }
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'variant' });
  return [...unique.values()].sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.value, b.value));
}

export function createProReportTables({ h, text, message, buildCards, techniqueInfo, activity, operationDefinition, countLabel, CompanyLabel, SiteLabel, extensionTargetLabel }) {
  const code = value => h('code', { dir: 'ltr', children: String(value) });
  const small = value => h('span', { class: 'report-cell-note', children: value });
  const count = (value, quality) => { const label = countLabel(value, quality); return typeof label === 'string' ? label : message(label); };
  const phase = value => text('phase_' + value.replace(/-/g, '_'));
  const source = (page, key, host) => h('span', { class: 'report-document-ref', 'data-report-document': key, children: [
    host ? h(SiteLabel, { host }) : code(key),
    small(key === page.documentKey ? text('frame_main') : text('report_data_document') + ' ' + (Array.from(new Set([...page.reports.map(report => report.documentKey), ...(page.apiValues ?? []).map(document => document.documentKey)])).indexOf(key) + 1))
  ] });
  function table(title, columns, rows, props = {}) {
    if (!rows.length) return null;
    return h('section', { class: 'report-data-section', children: [
      h('h4', { children: title }),
      h('div', { class: 'report-table-wrap', children: h('table', { class: 'pro-data-table', ...props, children: [
        h('thead', { children: h('tr', { children: columns.map(label => h('th', { scope: 'col', children: label })) }) }),
        h('tbody', { children: rows })
      ] }) })
    ] });
  }
  const cells = (children, props = {}) => h('tr', { ...props, children: children.map(child => h('td', { children: child })) });
  function operationTitle(row) {
    const action = activity(row.operation), info = techniqueInfo[row.techniqueId];
    return [action ? small(text('api_activity_' + action)) : info ? small(text('category_' + info.category)) : null, code(row.operation)];
  }
  function valueView(value) {
    if (value.kind === 'unobserved') return small(text('api_result_' + value.reason));
    if (value.kind === 'technical') return [
      h('dl', { class: 'report-value-fields', children: value.fields.map(field => h('div', { children: [
        h('dt', { children: code(field.name + ' [' + field.index + ']') }),
        h('dd', { children: h('code', { dir: 'ltr', 'data-api-value': true, children: String(field.value) }) })
      ] })) }),
      value.truncated ? small(text('report_dropped_note')) : null
    ];
    if (value.kind === 'webrtc') return [
      small(text(value.source === 'returned' ? 'rtc_values_returned' : 'rtc_values_snapshot')),
      h('dl', { class: 'report-value-fields', children: value.fields.map(field => h('div', { 'data-rtc-field': field.name, children: [
        h('dt', { children: code(field.name + ' [' + field.index + ']') }),
        h('dd', { children: h('code', { dir: 'ltr', 'data-api-value': true, children: String(field.value) }) })
      ] })) }),
      !value.fields.length ? small(text('rtc_values_empty')) : null,
      value.truncated ? small(text('rtc_values_limited')) : null
    ];
    const display = value.kind === 'string' ? JSON.stringify(value.value) : value.kind === 'number-array' ? '[' + value.values.join(', ') + ']' : value.kind === 'null' || value.kind === 'undefined' ? value.kind : String(value.value);
    return h('code', { dir: 'auto', 'data-api-value': true, children: display });
  }
  function Values({ page }) {
    const rows = recordedValueRows(page);
    return [table(text('report_data_title'), ['report_data_operation', 'report_data_parameters', 'report_data_value', 'report_data_document', 'report_data_samples'].map(text), rows.map(({ row, documentKey, host, index }) => cells([
      operationTitle(row),
      row.parameters.length ? row.parameters.map(parameter => h('div', { children: code(parameter.name + ' = ' + parameter.value) })) : '—',
      [valueView(row.value), small(phase(row.phase))],
      source(page, documentKey, host),
      count(row.count, 'exact')
    ], { 'data-pro-value-row': true, 'data-api-result-operation': row.operation, 'data-api-result-phase': row.phase, 'data-value-document': documentKey, key: documentKey + ':' + index })), { class: 'pro-data-table pro-api-values', 'data-pro-values-table': true }),
    page.apiValues?.some(document => document.truncated) ? h('p', { class: 'report-muted', 'data-pro-values-truncated': true, children: text('report_dropped_note') }) : null];
  }
  function RequestValues({ page }) {
    return table(text('report_data_title'), ['report_data_operation', 'report_data_value', 'report_data_document', 'detail_counts'].map(text),
      (page.requestValues?.rows ?? []).map(row => cells([
        code(row.name), code(row.value), h(SiteLabel, { host: row.destinationHost }), count(row.count, 'exact')
      ], { 'data-pro-request-value': true })), { 'data-pro-request-values-table': true });
  }
  function Checks({ page }) {
    const rows = [];
    for (const report of page.reports) {
      for (const operation of report.apiOperations ?? []) {
        const definition = operationDefinition(operation.apiOperation);
        rows.push(cells([
          operationTitle({ operation: operation.apiOperation, techniqueId: definition?.techniqueId }),
          phase(operation.phase), source(page, report.documentKey, report.host), count(operation.count, operation.countQuality)
        ], { 'data-api-operation': operation.apiOperation, 'data-api-phase': operation.phase }));
      }
      // Technique counters can include legacy hooks absent from the operation registry.
      // Keep their separate aggregate instead of replacing it with operation totals.
      for (const technique of report.techniques) {
        const info = techniqueInfo[technique.techniqueId];
        rows.push(cells([
          [small(text('inspector_group') + ' · ' + technique.techniqueId), info ? text('category_' + info.category) : null, code(info?.api ?? technique.techniqueId)],
          [technique.phases.map(phase).join(' · '), ...(technique.signalCodes ?? []).map(code)], source(page, report.documentKey, report.host), count(technique.count, technique.countQuality)
        ], { 'data-technique': technique.techniqueId }));
      }
    }
    return table(text('report_data_checks'), ['report_data_operation', 'detail_phases', 'report_data_document', 'detail_counts'].map(text), rows, { 'data-pro-checks': true });
  }
  function Findings({ page }) {
    const rows = page.reports.flatMap(report => buildCards(report).filter(card => card.kind !== 'api-use' && card.kind !== 'unknown').map(card => cells([
      [code(card.api), small(card.techniqueId)],
      [message(card.interpretation), small(message(card.confidence))],
      source(page, report.documentKey, report.host),
      [text('evidence_' + card.evidenceSource.replace(/-/g, '_')), small(text('integrity_' + card.integrity.replace(/-/g, '_'))),
        card.attribution && card.attribution !== 'unknown' ? small(text('attribution_' + card.attribution.replace(/-/g, '_'))) : null,
        card.ruleId ? small(card.ruleId + (card.ruleVersion ? ' v' + card.ruleVersion : '')) : null,
        ...(card.counterEvidenceCodes ?? []).map(value => small(text('alternative_' + value.replace(/-/g, '_')))),
        ...(card.limitationCodes ?? []).map(value => small(text('limitation_' + value.replace(/-/g, '_'))))]
    ], { 'data-finding': card.id })));
    return table(text('identification_passive'), ['report_data_operation', 'level_interpretation', 'report_data_document', 'detail_evidence'].map(text), rows);
  }
  function OtherChecks({ page }) {
    const permissions = [], headers = [], extensions = [], ports = [];
    for (const report of page.reports) {
      const origin = source(page, report.documentKey, report.host);
      for (const check of report.permissionChecks ?? []) permissions.push(cells([
        text('permission_name_' + check.permission.replace(/-/g, '_')),
        text('permission_kind_' + check.kind) + ' · ' + text('permission_result_' + check.result), origin, count(check.count, check.countQuality)
      ]));
      for (const entry of report.responseHeaders?.entries ?? []) headers.push(cells([
        code(entry.name), [text(explainHeader(entry.name)), entry.clientHints.length ? code(entry.clientHints.join(', ')) : null], origin, count(entry.count, 'exact')
      ]));
      for (const entry of report.extensionResources ?? []) extensions.push(cells([
        [extensionTargetLabel(entry.target)?.name ?? text('extension_targets_unknown'), small(entry.target)],
        [code(entry.method), small(phase(entry.phase))], origin, count(entry.count, entry.countQuality)
      ], { 'data-extension-target': entry.target }));
      if (report.requestedLocalPorts?.ports.length) ports.push(cells([origin, code(report.requestedLocalPorts.ports.join(', ')), report.requestedLocalPorts.truncated ? text('local_ports_incomplete') : '—']));
    }
    const cols = ['report_data_operation', 'report_data_value', 'report_data_document', 'detail_counts'].map(text);
    return [
      table(text('permission_checks_title'), cols, permissions),
      table(text('inspector_group_response_headers'), cols, headers),
      page.reports.some(report => report.responseHeaders?.truncated) ? h('p', { class: 'report-muted', children: text('headers_truncated') }) : null,
      table(text('extension_targets_title'), cols, extensions),
      table(text('local_ports_requested'), ['report_data_document', 'local_ports_requested', 'detail_limitations'].map(text), ports)
    ];
  }
  function Companies({ vendors }) {
    return table(text('identification_vendors_title'), [text('report_data_companies'), text('report_data_document'), text('detail_evidence')], vendors.map(vendor => cells([
      h(CompanyLabel, { name: vendor.name, identity: vendor.vendorId, size: 'large' }),
      vendor.sources.map(source => h('div', { children: h('a', { href: '#page-' + encodeURIComponent(source.pageId), children: [h(SiteLabel, { host: source.host, label: source.host ?? source.documentKey }), small(source.documentKey)] }) })),
      vendor.sources.map(source => h('div', { children: [message(source.vendor.matchLabel), small(source.vendor.ruleIds.join(', '))] }))
    ], { 'data-vendor-id': vendor.vendorId })), { 'data-pro-vendors': true });
  }
  function Summary({ session, cookies = false, locale = 'en' }) {
    const rows = summaryValueRows(session, cookies, locale);
    if (!rows.length) return null;
    return h('section', { class: 'pro-summary', 'data-pro-summary': cookies ? 'cookies' : 'browser', children: [
      h('h2', { children: text(cookies ? 'report_summary_cookies_title' : 'report_summary_values_title') }),
      h('table', { class: 'pro-summary-table', children: [
        h('thead', { children: h('tr', { children: ['№', text('report_summary_name'), text('report_data_value')].map(label => h('th', { scope: 'col', children: label })) }) }),
        h('tbody', { children: rows.map((row, index) => cells([index + 1, code(row.name), code(row.value)], { 'data-summary-row': true })) })
      ] })
    ] });
  }
  return { Values, RequestValues, Checks, Findings, OtherChecks, Companies, Summary };
}

function explainHeader(name) {
  switch (name) {
    case 'accept-ch': case 'critical-ch': return 'headers_client_hints_note';
    case 'permissions-policy': case 'feature-policy': return 'headers_policy_note';
    case 'nel': case 'report-to': case 'reporting-endpoints': return 'headers_reporting_note';
    case 'use-as-dictionary': return 'headers_dictionary_note';
    case 'secure-session-registration': case 'sec-session-registration':
    case 'secure-session-challenge': case 'sec-session-challenge': return 'headers_session_note';
    case 'set-login': return 'headers_login_status_note';
    case 'content-security-policy': return 'headers_csp_note';
    case 'strict-transport-security': return 'headers_hsts_note';
    case 'cross-origin-opener-policy': return 'headers_coop_note';
    case 'cross-origin-embedder-policy': return 'headers_coep_note';
    case 'x-frame-options': return 'headers_frame_note';
    default: return 'headers_presence_note';
  }
}
