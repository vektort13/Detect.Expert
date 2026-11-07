import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProRequestGraph, mountProRequestGraph, GRAPH_LIMITS } from '../../apps/production-extension/pro-request-graph.js';

// ADR-020 / REQ-005/007/010/011: source-only tests; no browser, network or retained history.
const resource = (domain, overrides = {}) => ({
  domain, relation: 'cross-site', type: 'script', requestCount: 1,
  completedCount: 1, failedCount: 0, redirectCount: 0, statusCodes: [200], ...overrides,
});
const page = (id, resources) => ({ id, resources });
const session = pages => ({ siteKey: 'example.test', pages });
const fixture = () => session([
  page('visit-1', [
    resource('shared.test', { requestCount: 4, completedCount: 2, failedCount: 1, redirectCount: 1, statusCodes: [200, 404] }),
    resource('shared.test', { type: 'image', requestCount: 2, completedCount: 2, statusCodes: [500] }),
    resource('example.test', { relation: 'same-site', requestCount: 3, completedCount: 3 }),
    resource('unknown.test', { relation: 'unknown' }),
  ]),
  page('visit-2', [resource('shared.test', { type: 'xmlhttprequest', requestCount: 5, completedCount: 4, failedCount: 1, statusCodes: [201] })]),
]);

test('aggregates observed page-to-domain requests and keeps outcomes distinct', () => {
  const graph = buildProRequestGraph(fixture(), { selectedDomain: 'shared.test' });
  assert.equal(graph.totals.pages, 2);
  assert.equal(graph.totals.domains, 1);
  assert.deepEqual(graph.totals, { pages: 2, domains: 1, requestCount: 11, completedCount: 8, failedCount: 2, redirectCount: 1, resourceGroups: 3 });
  assert.deepEqual(graph.detail.statusCodes, [200, 201, 404, 500]);
  assert.equal(graph.detail.pages.length, 2);
  assert.equal(graph.detail.types.length, 3);
  assert.equal(graph.detail.pages[0].requestCount, 6);
  assert.equal(graph.detail.pages[0].completedCount, 4);
  assert.equal(graph.edges.length, 2);
  assert(graph.edges.every(edge => edge.selected && edge.domain === 'shared.test'));
  assert(graph.pages.every(visit => visit.selected));
  assert.equal(Object.hasOwn(graph.detail, 'successCount'), false);
  assert.equal(Object.hasOwn(graph.detail, 'tracker'), false);
});

test('filters before aggregation, with unknown relation included only in all domains', () => {
  const source = fixture();
  const all = buildProRequestGraph(source, { party: 'all' });
  assert.equal(all.totals.requestCount, 15);
  assert.deepEqual(all.domains.map(row => row.domain), ['shared.test', 'example.test', 'unknown.test']);
  const image = buildProRequestGraph(source, { party: 'all', type: 'image', selectedDomain: 'shared.test' });
  assert.equal(image.totals.requestCount, 2);
  assert.equal(image.detail.completedCount, 2);
  assert.deepEqual(image.detail.statusCodes, [500]);
  assert.deepEqual(image.detail.types.map(row => row.type), ['image']);
  assert.deepEqual(image.detail.pages.map(row => row.id), ['visit-1']);
  const missing = buildProRequestGraph(source, { type: 'font', selectedDomain: 'shared.test' });
  assert.equal(missing.detail, null);
  assert.equal(missing.selectedDomain, null);
  assert.equal(missing.totals.requestCount, 0);
});

test('selected first-party loopback survives the existing all-domain filter', () => {
  const graph = buildProRequestGraph(session([page('local-visit', [resource('127.0.0.1', { relation: 'same-site' })])]),
    { party: 'all', selectedDomain: '127.0.0.1' });
  assert.equal(graph.detail.domain, '127.0.0.1');
  assert.equal(graph.detail.relation, 'same-site');
  assert.equal(graph.detail.pages[0].id, 'local-visit');
});

test('all observed HTTP codes remain visible when many valid groups are merged', () => {
  const statuses = Array.from({ length: 500 }, (_, index) => index + 100);
  const graph = buildProRequestGraph(session([page('visit', statuses.map(code => resource('statuses.test', { statusCodes: [code] })))]),
    { selectedDomain: 'statuses.test' });
  for (const row of [graph.detail, graph.detail.types[0], graph.detail.pages[0], graph.edges[0], graph.domains[0]])
    assert.deepEqual(row.statusCodes, statuses);
  assert.equal(graph.inputTruncated, false);
  assert.deepEqual(graph.omitted, { pages: 0, domains: 0, edges: 0 });
});

test('does not read URL, title, API values, request payloads or inherited getters', () => {
  let reads = 0;
  const blocked = () => { reads++; throw new Error('Sensitive getter accessed'); };
  const row = resource('safe.test');
  const visit = page('private-visit', [row]);
  const source = session([visit]);
  for (const value of [row, visit, source]) for (const key of ['url', 'title', 'apiValues', 'query', 'body', 'headers'])
    Object.defineProperty(value, key, { get: blocked });
  Object.defineProperty(row, 'ignored', { value: 'query-canary=token-SECRET', enumerable: true });
  const graph = buildProRequestGraph(source, { selectedDomain: 'safe.test' });
  assert.equal(graph.totals.requestCount, 1);
  assert.equal(reads, 0);
  assert.equal(JSON.stringify(graph).includes('SECRET'), false);
  assert.equal(JSON.stringify(graph).includes('private-visit?'), false);
  const inherited = Object.create(resource('inherited.test'));
  const getter = { ...resource('getter.test') };
  Object.defineProperty(getter, 'domain', { get: blocked });
  assert.equal(buildProRequestGraph(session([page('visit', [inherited, getter])])).totals.requestCount, 0);
  assert.equal(reads, 0);
});

test('prototype-shaped keys remain data; markup and malformed domains cannot enter output', () => {
  const unsafe = ['__proto__', '<svg/onload=alert(1)>', 'user@host.test', 'host.test?token=x', 'Host.test', '', 'x'.repeat(64) + '.test'];
  const source = session([page('constructor', [resource('constructor'), resource('to-string.test'), ...unsafe.map(name => resource(name))])]);
  const graph = buildProRequestGraph(source, { selectedDomain: 'constructor' });
  assert.equal(graph.detail.domain, 'constructor');
  assert.equal(graph.detail.pages[0].id, 'constructor');
  assert.equal(graph.totals.requestCount, 2);
  assert.equal({}.polluted, undefined);
  assert.equal(JSON.stringify(graph).includes('<svg'), false);
});

test('malformed counts, types, statuses and page IDs are handled without coercion', () => {
  let coerced = 0;
  const trap = { valueOf() { coerced++; throw new Error('coercion'); }, toString() { coerced++; throw new Error('coercion'); } };
  const rejected = [NaN, Infinity, -1, 0.5, 2147483648, '1', trap].map(requestCount => resource('invalid.test', { requestCount }));
  const source = session([
    page('valid', [...rejected, resource('invalid.test', { type: trap }), resource(trap),
      resource('accepted.test', { statusCodes: [99, 100, 200, 599, 600, 404.5, '200', trap] })]),
    page('<img>', [resource('invalid-id.test')]),
  ]);
  const graph = buildProRequestGraph(source, { selectedDomain: 'accepted.test' });
  assert.equal(graph.totals.requestCount, 1);
  assert.deepEqual(graph.detail.statusCodes, [100, 200, 599]);
  assert.equal(coerced, 0);
});

test('does not mutate source arrays or collapse distinct visits of the same site', () => {
  const source = fixture();
  const original = structuredClone(source);
  for (const visit of source.pages) { for (const row of visit.resources) { Object.freeze(row.statusCodes); Object.freeze(row); } Object.freeze(visit.resources); Object.freeze(visit); }
  Object.freeze(source.pages); Object.freeze(source);
  const graph = buildProRequestGraph(source, { selectedDomain: 'shared.test' });
  assert.deepEqual(source, original);
  assert.deepEqual(graph.detail.pages.map(row => row.id), ['visit-1', 'visit-2']);
  assert.equal(graph.detail.pages[0].ordinal, 1);
  assert.equal(graph.detail.pages[1].ordinal, 2);
});

test('visible caps are explicit and selected low-frequency domains remain reachable', () => {
  const source = session(Array.from({ length: 30 }, (_, index) => page('page-' + index,
    Array.from({ length: 60 }, (_, domain) => resource('d' + domain + '.test')))));
  const graph = buildProRequestGraph(source, { selectedDomain: 'd59.test' });
  assert.equal(graph.pages.length, GRAPH_LIMITS.maxPages);
  assert.equal(graph.domains.length, GRAPH_LIMITS.maxDomains);
  assert.equal(graph.edges.length, GRAPH_LIMITS.maxEdges);
  assert.deepEqual(graph.omitted, { pages: 6, domains: 12, edges: 1560 });
  assert.equal(graph.totals.requestCount, 1800);
  assert.equal(graph.detail.requestCount, 30);
  assert.equal(graph.domains[0].domain, 'd59.test');
  assert.equal(graph.inputTruncated, false);
  const selectedLastPage = buildProRequestGraph(session([...source.pages, page('late-visit', [resource('rare.test')])]), { selectedDomain: 'rare.test' });
  assert.equal(selectedLastPage.pages[0].id, 'late-visit');
  assert(selectedLastPage.edges.some(edge => edge.pageId === 'late-visit' && edge.domain === 'rare.test'));
});

test('source scan limits are reported and exact resource cap with empty visits is complete', () => {
  const full = Array.from({ length: 10 }, (_, index) => page('page-' + index, Array.from({ length: 500 }, () => resource('bounded.test'))));
  const complete = buildProRequestGraph(session([...full, page('empty', []), page('empty-2', [])]));
  assert.equal(complete.totals.requestCount, 5000);
  assert.equal(complete.inputTruncated, false);
  const extra = buildProRequestGraph(session([...full, page('extra', [resource('extra.test')])]));
  assert.equal(extra.totals.requestCount, 5000);
  assert.equal(extra.inputTruncated, true);
  assert.equal(extra.domains.some(row => row.domain === 'extra.test'), false);
  const perPage = buildProRequestGraph(session([page('page', Array.from({ length: 501 }, () => resource('bounded.test')))]));
  assert.equal(perPage.totals.requestCount, 500);
  assert.equal(perPage.inputTruncated, true);
  const manyPages = buildProRequestGraph(session(Array.from({ length: 101 }, (_, index) => page('page-' + index, [resource('bounded.test')]))));
  assert.equal(manyPages.totals.requestCount, 100);
  assert.equal(manyPages.inputTruncated, true);
});

test('mixed relation metadata is conservatively unknown and ordering is stable', () => {
  const rows = [resource('z.test'), resource('a.test'), resource('a.test', { relation: 'same-site', type: 'image' })];
  const a = buildProRequestGraph(session([page('visit', rows)]), { party: 'all', selectedDomain: 'a.test' });
  const b = buildProRequestGraph(session([page('visit', [...rows].reverse())]), { party: 'all', selectedDomain: 'a.test' });
  assert.deepEqual(a, b);
  assert.equal(a.detail.relation, 'unknown');
});

// A minimal DOM mock checks control bookkeeping and cleanup; real browser focus is tested separately.
class FixtureNode {
  constructor(document, tag) { this.ownerDocument = document; this.tagName = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.parentNode = null; this._text = ''; this.value = ''; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  set href(value) { this.setAttribute('href', value); }
  get href() { return this.getAttribute('href'); }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  replaceChildren(...nodes) {
    if (this.contains(this.ownerDocument.activeElement) && this.ownerDocument.activeElement !== this) this.ownerDocument.activeElement = this.ownerDocument.body;
    for (const child of this.children) child.parentNode = null;
    this.children = []; this.append(...nodes);
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  dispatch(name) { this.listeners.get(name)?.({ target: this }); }
  focus() { this.ownerDocument.activeElement = this; }
}
function domFixture() {
  const document = { createElement(tag) { return new FixtureNode(this, tag); }, createElementNS(_namespace, tag) { return this.createElement(tag); } };
  document.body = document.createElement('body'); document.activeElement = document.body;
  const container = document.createElement('div'); document.body.append(container);
  const nodes = root => [root, ...root.children.flatMap(nodes)];
  const find = (name, value) => nodes(container).find(node => node.getAttribute(name) === value);
  return { document, container, find, nodes };
}

test('renderer keeps keyboard focus on filters, domains and clear-selection fallback', () => {
  const { document, container, find } = domFixture();
  const dispose = mountProRequestGraph(container, fixture());
  assert.equal(document.activeElement, document.body, 'initial render must not steal focus');
  const domain = find('data-pro-graph-domain', 'shared.test'); domain.focus(); domain.dispatch('click');
  assert.equal(document.activeElement.getAttribute('data-pro-graph-domain'), 'shared.test');
  assert.equal(document.activeElement.getAttribute('aria-pressed'), 'true');
  const clear = find('data-pro-graph-clear', 'shared.test'); clear.focus(); clear.dispatch('click');
  assert.equal(document.activeElement.getAttribute('data-pro-graph-domain'), 'shared.test');
  assert.equal(document.activeElement.getAttribute('aria-pressed'), 'false');
  const filter = find('data-pro-graph-filter', 'type'); filter.focus(); filter.value = 'font'; filter.dispatch('change');
  assert.equal(document.activeElement.getAttribute('data-pro-graph-filter'), 'type');
  assert.equal(document.activeElement.value, 'font');
  dispose(); assert.equal(container.children.length, 0);
  filter.dispatch('change'); assert.equal(container.children.length, 0, 'disposed handlers must not recreate the graph');
});

test('domain detail links only to local page inventory and receives numbered locale substitutions', () => {
  const { container, find, nodes } = domFixture();
  const calls = [];
  const source = session([page('visit:1', [resource('safe.test')])]);
  mountProRequestGraph(container, source, { translate(key, values) { calls.push([key, values]); return undefined; } });
  const button = find('data-pro-graph-domain', 'safe.test'); button.focus(); button.dispatch('click');
  const anchors = nodes(container).filter(node => node.tagName === 'a');
  assert.deepEqual(anchors.map(node => node.getAttribute('href')), ['#page-visit%3A1']);
  assert.equal(anchors[0].textContent, 'Page visit 1');
  assert(calls.some(([key, values]) => key === 'pro_graph_page' && values[0] === '1'));
  assert.equal(nodes(container).some(node => ['iframe', 'img', 'script'].includes(node.tagName)), false);
});

test('renderer explicitly reports truncated source input as well as view omissions', () => {
  const { container } = domFixture();
  mountProRequestGraph(container, session([page('visit', Array.from({ length: 501 }, () => resource('bounded.test')))]));
  assert.match(container.textContent, /The input exceeds the map limits; the view is incomplete/);
  const other = domFixture();
  mountProRequestGraph(other.container, session([page('visit', Array.from({ length: 49 }, (_, index) => resource('d' + index + '.test')))]));
  assert.match(other.container.textContent, /Hidden by view limits: 0 page visits, 1 domains, 1 links/);
});

test('new mount uses only the new recording and cleanup keeps no previous session nodes', () => {
  const { container, find } = domFixture();
  const dispose = mountProRequestGraph(container, session([page('old-visit', [resource('old.test')])]));
  find('data-pro-graph-domain', 'old.test').dispatch('click');
  dispose();
  mountProRequestGraph(container, session([page('new-visit', [resource('new.test')])]));
  assert.equal(container.textContent.includes('old.test'), false);
  assert.equal(find('data-pro-graph-domain', 'new.test').getAttribute('aria-pressed'), 'false');
  assert.equal(container.textContent.includes('old-visit'), false);
});
