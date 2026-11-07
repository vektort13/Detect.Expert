// ADR-017/020 / REQ-005/007/008/010/011: a bounded view of the current, already validated Pro session.
// This module reads reduced resource metadata only. It has no browser API or storage access.
export const GRAPH_LIMITS = Object.freeze({
  maxPages: 24, maxDomains: 48, maxEdges: 240,
  maxScannedPages: 100, maxScannedResources: 5000, maxResourcesPerPage: 500,
  maxStatuses: 500, maxStatusesPerResource: 16,
});
export const GRAPH_RESOURCE_TYPES = Object.freeze([
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other',
]);
const TYPES = new Set(GRAPH_RESOURCE_TYPES);
const COUNT_FIELDS = ['requestCount', 'completedCount', 'failedCount', 'redirectCount'];
const own = (value, key) => {
  try {
    const field = Object.getOwnPropertyDescriptor(value, key);
    return field && Object.hasOwn(field, 'value') ? field.value : undefined;
  } catch { return undefined; }
};
const validCount = value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,128}$/.test(value);
function validDomain(value) {
  if (typeof value !== 'string' || value.length > 253 || value !== value.toLowerCase()) return false;
  // A selected first-party IP is already permitted by Pro; do not add new redaction here.
  if (/^\[[0-9a-f:]{2,45}\]$/.test(value)) return true;
  return value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
function sizeOf(value) {
  return Array.isArray(value) ? Math.min(own(value, 'length') ?? 0, 1000000) : 0;
}
function counts() {
  return { requestCount: 0, completedCount: 0, failedCount: 0, redirectCount: 0, resourceGroups: 0 };
}
function addCounts(target, row) {
  for (const field of COUNT_FIELDS) target[field] += row[field];
  target.resourceGroups++;
}
function snapshotCounts(value) {
  return Object.fromEntries([...COUNT_FIELDS, 'resourceGroups'].map(field => [field, value[field]]));
}
function statusList(values) {
  return [...values].sort((a, b) => a - b).slice(0, GRAPH_LIMITS.maxStatuses);
}
function typeList(values) {
  return [...values.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([type, value]) => ({ type, ...snapshotCounts(value), statusCodes: statusList(value.statusCodes) }));
}

export function buildProRequestGraph(session, options = {}) {
  const party = options.party === 'all' ? 'all' : 'third-party';
  const type = TYPES.has(options.type) ? options.type : 'all';
  const selected = validDomain(options.selectedDomain) ? options.selectedDomain : null;
  const domains = new Map(), pageMap = new Map(), edgeMap = new Map(), seenPageIds = new Set(), total = counts();
  const pages = own(session, 'pages');
  let scannedResources = 0, inputTruncated = sizeOf(pages) > GRAPH_LIMITS.maxScannedPages;
  for (let index = 0; index < Math.min(sizeOf(pages), GRAPH_LIMITS.maxScannedPages); index++) {
    const page = own(pages, String(index)), pageId = own(page, 'id'), resources = own(page, 'resources');
    if (!validId(pageId) || seenPageIds.has(pageId)) continue;
    seenPageIds.add(pageId);
    const pageCounts = { id: pageId, ordinal: index + 1, ...counts() };
    if (sizeOf(resources) > GRAPH_LIMITS.maxResourcesPerPage) inputTruncated = true;
    for (let slot = 0; slot < Math.min(sizeOf(resources), GRAPH_LIMITS.maxResourcesPerPage); slot++) {
      if (scannedResources >= GRAPH_LIMITS.maxScannedResources) { inputTruncated = true; break; }
      scannedResources++;
      const resource = own(resources, String(slot));
      const domain = own(resource, 'domain'), relation = own(resource, 'relation'), resourceType = own(resource, 'type');
      if (!validDomain(domain) || !['same-site', 'cross-site', 'unknown'].includes(relation) || !TYPES.has(resourceType) ||
          party === 'third-party' && relation !== 'cross-site' || type !== 'all' && resourceType !== type) continue;
      const row = {};
      for (const field of COUNT_FIELDS) row[field] = own(resource, field);
      if (COUNT_FIELDS.some(field => !validCount(row[field])) || row.requestCount === 0) continue;
      const statuses = new Set(), rawStatuses = own(resource, 'statusCodes');
      if (sizeOf(rawStatuses) > GRAPH_LIMITS.maxStatusesPerResource) inputTruncated = true;
      for (let status = 0; status < Math.min(sizeOf(rawStatuses), GRAPH_LIMITS.maxStatusesPerResource); status++) {
        const code = own(rawStatuses, String(status));
        if (Number.isInteger(code) && code >= 100 && code <= 599) statuses.add(code);
      }
      let destination = domains.get(domain);
      if (!destination) {
        destination = { domain, relation, ...counts(), statusCodes: new Set(), types: new Map(), pages: new Map() };
        domains.set(domain, destination);
      } else if (destination.relation !== relation) destination.relation = 'unknown';
      const edgeKey = pageId + '\0' + domain;
      let edge = edgeMap.get(edgeKey);
      if (!edge) {
        edge = { pageId, domain, ordinal: index + 1, ...counts(), statusCodes: new Set(), types: new Map() };
        edgeMap.set(edgeKey, edge); destination.pages.set(pageId, edge);
      }
      for (const target of [destination, edge]) {
        addCounts(target, row);
        for (const code of statuses) target.statusCodes.add(code);
        let typed = target.types.get(resourceType);
        if (!typed) { typed = { ...counts(), statusCodes: new Set() }; target.types.set(resourceType, typed); }
        addCounts(typed, row);
        for (const code of statuses) typed.statusCodes.add(code);
      }
      addCounts(pageCounts, row); addCounts(total, row);
    }
    if (pageCounts.requestCount) pageMap.set(pageId, pageCounts);
  }
  const selectedData = selected === null ? null : domains.get(selected) ?? null;
  const allDomains = [...domains.values()].sort((a, b) =>
    Number(b.domain === selected) - Number(a.domain === selected) || b.requestCount - a.requestCount ||
    (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));
  const visibleDomains = allDomains.slice(0, GRAPH_LIMITS.maxDomains), domainSet = new Set(visibleDomains.map(item => item.domain));
  const visiblePages = [...pageMap.values()].sort((a, b) =>
    Number(selectedData?.pages.has(b.id) ?? false) - Number(selectedData?.pages.has(a.id) ?? false) || a.ordinal - b.ordinal)
    .slice(0, GRAPH_LIMITS.maxPages);
  const pageSet = new Set(visiblePages.map(page => page.id));
  const edges = [...edgeMap.values()].filter(edge => pageSet.has(edge.pageId) && domainSet.has(edge.domain))
    .sort((a, b) => Number(b.domain === selected) - Number(a.domain === selected) || a.ordinal - b.ordinal ||
      b.requestCount - a.requestCount || (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0))
    .slice(0, GRAPH_LIMITS.maxEdges).map(edge => ({
      pageId: edge.pageId, domain: edge.domain, ...snapshotCounts(edge),
      statusCodes: statusList(edge.statusCodes), types: typeList(edge.types), selected: edge.domain === selected,
    }));
  return {
    party, type, selectedDomain: selectedData?.domain ?? null,
    pages: visiblePages.map(page => ({ ...page, selected: selectedData?.pages.has(page.id) ?? false })),
    domains: visibleDomains.map(item => ({ domain: item.domain, relation: item.relation,
      ...snapshotCounts(item), visits: item.pages.size, selected: item.domain === selected,
      statusCodes: statusList(item.statusCodes), types: typeList(item.types) })),
    edges, totals: { pages: pageMap.size, domains: domains.size, ...snapshotCounts(total) },
    omitted: { pages: pageMap.size - visiblePages.length, domains: domains.size - visibleDomains.length, edges: edgeMap.size - edges.length },
    inputTruncated,
    detail: selectedData ? { domain: selectedData.domain, relation: selectedData.relation,
      ...snapshotCounts(selectedData), statusCodes: statusList(selectedData.statusCodes), types: typeList(selectedData.types),
      pages: [...selectedData.pages.values()].sort((a, b) => a.ordinal - b.ordinal).map(edge => ({
        id: edge.pageId, ordinal: edge.ordinal, ...snapshotCounts(edge),
        statusCodes: statusList(edge.statusCodes), types: typeList(edge.types),
      })) } : null,
  };
}

const FALLBACK = Object.freeze({
  pro_graph_title: 'Pro request map', pro_graph_parties: 'Domains', pro_graph_third_party: 'Third-party',
  pro_graph_all_parties: 'All domains', pro_graph_type_filter: 'Resource type', pro_graph_all_types: 'All types',
  pro_graph_pages: 'Page visits', pro_graph_domains: 'Domains', pro_graph_requests: 'Requests',
  pro_graph_completed: 'Completed', pro_graph_failed: 'Failed', pro_graph_redirects: 'Redirects',
  pro_graph_statuses: 'HTTP statuses', pro_graph_page: 'Page visit $1',
  pro_graph_select_domain: 'Choose a domain to see its page visits and request counts.',
  pro_graph_selected_domain: 'Domain details', pro_graph_clear_selection: 'Clear selection',
  pro_graph_empty: 'No matching resource requests.',
  pro_graph_omitted: 'Hidden by view limits: $1 page visits, $2 domains, $3 links.',
  pro_graph_input_limited: 'The input exceeds the map limits; the view is incomplete.',
  pro_graph_graph_label: 'Page visits linked to requested domains', pro_graph_resource_groups: 'Resource groups',
});

export function mountProRequestGraph(container, session, { translate } = {}) {
  const document = container.ownerDocument;
  let state = { party: 'third-party', type: 'all', selectedDomain: null }, disposed = false;
  const text = (key, substitutions = []) => {
    const values = Array.isArray(substitutions) ? substitutions.map(String) : [String(substitutions)];
    let result;
    try { result = translate?.(key, values); } catch {}
    if (typeof result === 'string' && result && result !== key) return result;
    return (FALLBACK[key] ?? key).replace(/\$(\d+)/g, (_, index) => values[Number(index) - 1] ?? '');
  };
  const element = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = String(content);
    return node;
  };
  const svgElement = (tag, attributes, content) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    if (content !== undefined) node.textContent = String(content);
    return node;
  };
  function metrics(value) {
    const list = element('dl', 'pro-request-graph__metrics');
    for (const [key, field] of [['requests', 'requestCount'], ['completed', 'completedCount'], ['failed', 'failedCount'], ['redirects', 'redirectCount']]) {
      const item = element('div'); item.append(element('dt', '', text('pro_graph_' + key)), element('dd', '', value[field])); list.append(item);
    }
    return list;
  }
  function table(rows, pageRows) {
    const scroll = element('div', 'pro-request-graph__table-scroll'), tableNode = element('table'), head = element('thead'), body = element('tbody');
    const header = element('tr');
    for (const key of [pageRows ? 'page' : 'type_filter', 'requests', 'completed', 'failed', 'redirects', 'statuses'])
      header.append(element('th', '', pageRows && key === 'page' ? text('pro_graph_pages') : text('pro_graph_' + key)));
    head.append(header);
    for (const row of rows) {
      const tr = element('tr');
      const rowHeader = element('th');
      rowHeader.setAttribute('scope', 'row');
      if (pageRows) {
        const anchor = element('a', '', text('pro_graph_page', [row.ordinal]));
        anchor.href = '#page-' + encodeURIComponent(row.id);
        rowHeader.append(anchor);
      } else rowHeader.textContent = row.type;
      tr.append(rowHeader);
      for (const field of COUNT_FIELDS) tr.append(element('td', '', row[field]));
      tr.append(element('td', '', row.statusCodes.join(', ') || '—')); body.append(tr);
    }
    tableNode.append(head, body); scroll.append(tableNode); return scroll;
  }
  function render() {
    if (disposed) return;
    const active = document.activeElement;
    const focused = active && container.contains(active) ? {
      filter: active.getAttribute('data-pro-graph-filter'),
      domain: active.getAttribute('data-pro-graph-domain'),
      clearDomain: active.getAttribute('data-pro-graph-clear'),
    } : null;
    const filterControls = new Map(), domainControls = new Map();
    let clearControl;
    const graph = buildProRequestGraph(session, state);
    state.selectedDomain = graph.selectedDomain;
    const section = element('section', 'pro-request-graph');
    section.setAttribute('aria-label', text('pro_graph_title'));
    section.append(element('h2', '', text('pro_graph_title')));
    const filters = element('div', 'pro-request-graph__filters');
    for (const [name, key, choices] of [
      ['party', 'pro_graph_parties', [['third-party', text('pro_graph_third_party')], ['all', text('pro_graph_all_parties')]]],
      ['type', 'pro_graph_type_filter', [['all', text('pro_graph_all_types')], ...GRAPH_RESOURCE_TYPES.map(value => [value, value])]],
    ]) {
      const label = element('label', '', text(key)), select = element('select');
      select.setAttribute('data-pro-graph-filter', name);
      filterControls.set(name, select);
      for (const [value, caption] of choices) { const option = element('option', '', caption); option.value = value; select.append(option); }
      select.value = state[name];
      select.addEventListener('change', () => { state[name] = select.value; render(); });
      label.append(select); filters.append(label);
    }
    section.append(filters);
    const summary = element('p', 'pro-request-graph__summary',
      text('pro_graph_pages') + ': ' + graph.totals.pages + ' · ' + text('pro_graph_domains') + ': ' + graph.totals.domains);
    section.append(summary, metrics(graph.totals));
    if (!graph.edges.length) section.append(element('p', 'pro-request-graph__empty', text('pro_graph_empty')));
    else {
      const canvas = element('div', 'pro-request-graph__canvas');
      const height = Math.max(graph.pages.length, graph.domains.length) * 44 + 32;
      const svg = svgElement('svg', { viewBox: '0 0 900 ' + height, width: '900', height, role: 'img', 'aria-label': text('pro_graph_graph_label') });
      const pages = new Map(graph.pages.map((page, index) => [page.id, index])), destinations = new Map(graph.domains.map((domain, index) => [domain.domain, index]));
      for (const edge of graph.edges) {
        const first = pages.get(edge.pageId) * 44 + 32, second = destinations.get(edge.domain) * 44 + 32;
        const path = svgElement('path', { d: `M260 ${first} C390 ${first} 510 ${second} 640 ${second}`,
          class: 'pro-request-graph__edge' + (edge.selected ? ' pro-request-graph__edge--selected' : ''),
          fill: 'none', 'data-pro-graph-edge': edge.pageId + ':' + edge.domain });
        path.append(svgElement('title', {}, text('pro_graph_requests') + ': ' + edge.requestCount)); svg.append(path);
      }
      for (const [side, nodes] of [['pages', graph.pages], ['domains', graph.domains]]) nodes.forEach((node, index) => {
        const x = side === 'pages' ? 8 : 640, y = index * 44 + 16;
        const group = svgElement('g', { class: 'pro-request-graph__node' + (node.selected ? ' pro-request-graph__node--selected' : ''),
          'data-pro-graph-page': side === 'pages' ? node.id : '', 'data-pro-graph-linked': node.selected ? 'true' : 'false' });
        group.append(svgElement('rect', { x, y, width: 252, height: 32, rx: 6 }));
        const caption = side === 'pages' ? text('pro_graph_page', [node.ordinal]) : node.domain;
        group.append(svgElement('text', { x: x + 10, y: y + 21 }, caption.length > 32 ? caption.slice(0, 29) + '…' : caption));
        group.append(svgElement('title', {}, caption)); svg.append(group);
      });
      canvas.append(svg); section.append(canvas);
    }
    const domainButtons = element('div', 'pro-request-graph__domains');
    domainButtons.setAttribute('aria-label', text('pro_graph_domains'));
    for (const domain of graph.domains) {
      const button = element('button', '', domain.domain); button.type = 'button';
      button.setAttribute('data-pro-graph-domain', domain.domain); button.setAttribute('aria-pressed', String(domain.selected));
      domainControls.set(domain.domain, button);
      button.addEventListener('click', () => { state.selectedDomain = domain.selected ? null : domain.domain; render(); });
      domainButtons.append(button);
    }
    section.append(domainButtons);
    if (Object.values(graph.omitted).some(value => value > 0)) section.append(element('p', 'pro-request-graph__omitted',
      text('pro_graph_omitted', [graph.omitted.pages, graph.omitted.domains, graph.omitted.edges])));
    if (graph.inputTruncated) section.append(element('p', 'pro-request-graph__omitted', text('pro_graph_input_limited')));
    const detail = element('section', 'pro-request-graph__details');
    detail.setAttribute('aria-live', 'polite');
    if (graph.detail) {
      detail.append(element('h3', '', text('pro_graph_selected_domain')), element('p', 'pro-request-graph__domain', graph.detail.domain));
      const clear = element('button', '', text('pro_graph_clear_selection')); clear.type = 'button';
      clear.setAttribute('data-pro-graph-clear', graph.detail.domain); clearControl = clear;
      clear.addEventListener('click', () => { state.selectedDomain = null; render(); });
      detail.append(clear, metrics(graph.detail), element('h4', '', text('pro_graph_type_filter')), table(graph.detail.types, false),
        element('h4', '', text('pro_graph_pages')), table(graph.detail.pages, true));
    } else detail.append(element('p', '', text('pro_graph_select_domain')));
    section.append(detail); container.replaceChildren(section);
    if (focused) {
      const replacement = focused.filter ? filterControls.get(focused.filter) : focused.domain ? domainControls.get(focused.domain) :
        focused.clearDomain ? clearControl ?? domainControls.get(focused.clearDomain) : null;
      if (replacement || focused.filter || focused.domain || focused.clearDomain)
        (replacement ?? filterControls.get('party')).focus({ preventScroll: true });
    }
  }
  render();
  return () => { disposed = true; container.replaceChildren(); };
}
