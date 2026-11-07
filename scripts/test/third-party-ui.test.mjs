// ADR-029: main-page third-party inventory, truthful counts and root-document isolation.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createIdentificationUi, thirdPartyGroups, thirdPartyTotals } from '../../apps/production-extension/identification-ui.js';
import { readThirdPartySnapshot } from '../../packages/contracts/src/third-party.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { applyThirdPartyCopy, THIRD_PARTY_KEYS } from '../production-locales-third-party.mjs';

const h = (type, props) => ({ type, props });
const tableFor = locale => {
  const language = PRODUCTION_LANGUAGES.find(item => item.id === locale);
  const table = JSON.parse(readFileSync(new URL('../../apps/production-extension/' + (language.uiOnly ? 'ui-locales' : '_locales') + '/' + locale + '/messages.json', import.meta.url), 'utf8'));
  return applyThirdPartyCopy(table, locale);
};
const translator = table => (key, substitutions = []) => {
  const entry = table[key]; let output = entry?.message ?? key;
  for (const [name, placeholder] of Object.entries(entry?.placeholders ?? {})) output = output.replaceAll('$' + name.toUpperCase() + '$', substitutions[Number(placeholder.content.slice(1)) - 1] ?? '');
  return output;
};
const uiFor = (locale = 'en') => createIdentificationUi({ h, useState: initial => [initial, () => {}], useEffect() {}, useRef: initial => ({ current: initial }), useLocale: () => locale, translate: translator(tableFor(locale)) });
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== 'object') return node;
  if (typeof node.type === 'function') return expand(node.type(node.props));
  return { ...node, props: { ...node.props, children: expand(node.props.children) } };
}
function nodes(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...nodes(node.props.children, predicate)];
}
function visibleText(node) {
  if (Array.isArray(node)) return node.map(visibleText).join(' ');
  return node && typeof node === 'object' ? visibleText(node.props.children) : node == null ? '' : String(node);
}
const row = changes => ({ domain: 'third.test', pathTemplate: '/scripts/:resource.js', type: 'script', relation: 'cross-site', requestCount: 1,
  completedCount: 1, failedCount: 0, redirectCount: 0, statusCodes: [200], documentKey: '42:0:main', documentHost: 'example.test', initiatorHost: 'example.test',
  evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'frame-only', script: null, ...changes });
const timingRow = changes => row({ evidenceSource: 'page-dom', integrity: 'page-controlled', completedCount: 0, statusCodes: [], ...changes });
const snapshot = (rows = [], changes = {}) => ({ schemaVersion: 1, type: 'third-party-state', documentKey: '42:0:main', coverageState: 'active', rows, truncated: false, ...changes });
const resource = changes => ({ id: 'resource-1', url: 'https://third.test/scripts/:resource.js', domain: 'third.test', relation: 'cross-site', type: 'script', requestCount: 1,
  completedCount: 1, failedCount: 0, redirectCount: 0, firstSeenAt: 1, lastSeenAt: 2, statusCodes: [200], durationTotalMs: 1, ...changes });
const page = resources => ({ id: 'page-1', documentKey: '42:0:main', url: 'https://example.test/', startedAt: 0, resources });
const renderedRows = report => nodes(report, node => node.props['data-third-party-row'] !== undefined);
const renderedValue = (report, attribute) => nodes(report, node => node.props[attribute] !== undefined)[0]?.props[attribute];

test('Main document requests populate Third Party without an iframe or detected API technique', () => {
  const state = snapshot([row({ requestCount: 4, completedCount: 3, failedCount: 1 })]);
  assert.ok(readThirdPartySnapshot(state));
  const report = expand(uiFor().ThirdPartyRows({ state }));
  assert.equal(renderedRows(report).length, 1);
  assert.equal(renderedValue(report, 'data-third-party-requests'), 4);
  assert.equal(renderedValue(report, 'data-third-party-domains'), 1);
  const navigation = uiFor().IdentificationNavigation({ prefix: 'main', active: 'third-party', onSelect() {},
    counts: { active: 0, passive: 0, 'third-party': 0 }, cookieState: null, thirdPartyState: state });
  const badge = nodes(navigation, node => node.props['data-identification-count'] === 'third-party')[0];
  assert.equal(badge.props.children, 4);
  assert.equal(badge.props['aria-label'], 'Third-party requests: 4');
});

test('A cross-site iframe resource remains third-party to the top-level site regardless of its same-site initiator', () => {
  const state = snapshot([row({ domain: 'widget.test', documentKey: '42:1:widget', documentHost: 'widget.test', initiatorHost: 'widget.test', requestCount: 3 })]);
  assert.ok(readThirdPartySnapshot(state));
  const report = expand(uiFor().ThirdPartyRows({ state }));
  assert.equal(renderedValue(report, 'data-third-party-requests'), 3);
  assert.equal(renderedRows(report)[0].props['data-third-party-domain'], 'widget.test');
  assert.equal(visibleText(report).includes('widget.test'), true);
  assert.equal(visibleText(report).includes('Initiating script unavailable'), true);
});

test('Unknown relationships and zero counts cannot inflate the badge or domain total', () => {
  const state = snapshot([row({ requestCount: 7 }), row({ domain: 'unknown.invalid', relation: 'unknown', requestCount: 99 }), row({ domain: 'zero.test', requestCount: 0, completedCount: 0, statusCodes: [] })]);
  assert.deepEqual(thirdPartyTotals(state), { requests: 7, domains: 1, resources: 1 });
  assert.deepEqual(thirdPartyTotals(null), { requests: 0, domains: 0, resources: 0 });
});

test('Browser and resource-timing rows from the same document cannot be added into duplicate requests', () => {
  const mixed = snapshot([row({ requestCount: 3 }), timingRow({ requestCount: 9 }), timingRow({ domain: 'child.test', documentKey: '42:1:child', documentHost: 'child.test', requestCount: 2 })]);
  assert.equal(thirdPartyTotals(mixed).requests, 5);
  const report = expand(uiFor().ThirdPartyRows({ state: mixed }));
  assert.equal(renderedRows(report).length, 3);
  assert.deepEqual(renderedRows(report).map(item => item.props['data-third-party-source']), ['browser-network', 'page-dom', 'page-dom']);
});

test('Request totals saturate and all native outcome counts remain distinct', () => {
  const state = snapshot([row({ requestCount: 2147483647, completedCount: 3, failedCount: 4, redirectCount: 5, statusCodes: [200, 404, 500] }), row({ domain: 'other.test', requestCount: 40 })]);
  assert.equal(thirdPartyTotals(state).requests, 2147483647);
  const report = expand(uiFor().ThirdPartyRows({ state }));
  const text = visibleText(report);
  assert.ok(text.includes('Completed 3'));
  assert.ok(text.includes('Failed 4'));
  assert.ok(text.includes('Redirects 5'));
  assert.ok(text.includes('200, 404, 500'));
  assert.equal(/2147483687|tracker|keylogger|logged.in|received.by.server/i.test(text), false);
});

test('Pro Third Party excludes same-site siblings and unknown relations while preserving all admitted resource groups', () => {
  const resources = [resource({ domain: 'example.test', url: 'https://assets.example.test/scripts/:resource.js', relation: 'same-site', requestCount: 12 }),
    resource({ domain: 'unknown.invalid', relation: 'unknown' }), ...Array.from({ length: 498 }, (_, index) => resource({ id: 'resource-' + (index + 3), domain: 'third-' + index + '.test', url: 'https://third-' + index + '.test/scripts/:resource.js', requestCount: index + 1 }))];
  const report = expand(uiFor().ProThirdPartySnapshot({ page: page(resources) }));
  assert.equal(renderedRows(report).length, 498);
  assert.equal(renderedValue(report, 'data-third-party-requests'), 498 * 499 / 2);
  assert.equal(visibleText(report).includes('assets.example.test'), false);
  assert.equal(visibleText(report).includes('https://'), false);
  assert.ok(renderedRows(report).every(item => item.props['data-third-party-source'] === 'browser-network'));
  const maximum = expand(uiFor().ProThirdPartySnapshot({ page: page(Array.from({ length: 500 }, (_, index) => resource({ id: 'resource-' + index, domain: 'group-' + index + '.test', url: 'https://group-' + index + '.test/scripts/:resource.js' }))) }));
  assert.equal(renderedRows(maximum).length, 500);
  assert.equal(nodes(maximum, node => node.type === 'details').length, 0);
});

test('Pro Third Party retains page-relative observation times and total duration beside every resource', () => {
  const visit = { ...page([resource({ firstSeenAt: 123450, lastSeenAt: 191000, durationTotalMs: 1234.5 })]), startedAt: 120000 };
  const report = expand(uiFor().ProThirdPartySnapshot({ page: visit }));
  const timings = nodes(report, node => node.props['data-third-party-timing']);
  const durations = nodes(report, node => node.props['data-third-party-duration']);
  assert.equal(timings.length, 1); assert.equal(durations.length, 1);
  assert.equal(visibleText(timings[0]), 'First observed: 00:03 · Last observed: 01:11');
  assert.equal(visibleText(durations[0]), 'Total observed request duration: 1,234.5 ms');
  assert.equal(nodes(report, node => node.type === 'th').length, 7, 'timings do not widen the report table');
  const partial = expand(uiFor().ProThirdPartySnapshot({ page: { ...visit, startedAt: undefined } }));
  assert.equal(visibleText(partial).includes('NaN'), false);
});

test('Native initiator origins are never rendered as an exact initiating script', () => {
  const state = snapshot([row({ initiatorHost: 'initiator.test' }), timingRow({ documentKey: '42:1:child', initiatorHost: null, attributionConfidence: 'unknown' })]);
  const report = expand(uiFor().ThirdPartyRows({ state }));
  assert.equal(visibleText(report).includes('initiator.test'), true);
  assert.equal(nodes(report, node => node.props['data-third-party-script'] !== undefined).length, 0);
  assert.equal(nodes(report, node => node.type === 'a').length, 0);
  assert.equal(visibleText(report).split('Initiating script unavailable').length - 1, 2);
});

test('Resource Timing does not render unavailable HTTP outcomes as observed zero failures or completions', () => {
  const report = expand(uiFor().ThirdPartyRows({ state: snapshot([timingRow()]) })), text = visibleText(report);
  for (const outcome of ['Completed', 'Failed', 'Redirects']) {
    assert.ok(text.includes(outcome + ' —'));
    assert.equal(text.includes(outcome + ' 0'), false);
  }
  assert.equal(renderedValue(report, 'data-third-party-requests'), 1);
});

test('Private payloads, unsupported provenance and hostile accessors fail canonical projection without running getters', () => {
  let reads = 0;
  for (const field of ['url', 'query', 'body', 'responseBody', 'stack', 'accountId', 'emailHash', 'outcome']) {
    const item = row(); Object.defineProperty(item, field, { enumerable: true, get() { ++reads; throw Error('private getter'); } });
    assert.equal(readThirdPartySnapshot(snapshot([item])), null, field);
  }
  for (const changes of [{ evidenceSource: 'page-hook' }, { integrity: 'page-controlled' }, { attributionConfidence: 'exact-resource' },
    { script: { host: 'initiator.test', pathTemplate: '/sdk.js' } }, { pathTemplate: '/private/user/123?token=CANARY' }, { domain: 'https://third.test/?token=CANARY' }]) {
    assert.equal(readThirdPartySnapshot(snapshot([row(changes)])), null);
  }
  const item = row(); Object.defineProperty(item, 'requestCount', { enumerable: true, get() { ++reads; return 1; } });
  assert.equal(readThirdPartySnapshot(snapshot([item])), null);
  assert.equal(reads, 0);
});

test('The new section uses short factual empty states and preserves an explicit truncated result', () => {
  const report = expand(uiFor().ThirdPartyRows({ state: snapshot([], { coverageState: 'partial', truncated: true }) }));
  assert.ok(visibleText(report).includes('No third-party requests recorded'));
  assert.ok(visibleText(report).includes('Resource list truncated'));
  assert.equal(nodes(report, node => node.props['data-third-party-truncated'] !== undefined).length, 1);
  assert.equal(/does not prove|means nothing|controlled|safety verdict/i.test(visibleText(report)), false);
  const unavailable = expand(uiFor().ThirdPartyPanel({ thirdParty: { state: null, pending: false, refresh() {} } }));
  assert.ok(visibleText(unavailable).includes('Request data unavailable'));
});

for (const { id } of PRODUCTION_LANGUAGES) test('Third Party live and Pro metadata is localized in ' + id, () => {
  const table = tableFor(id), translate = translator(table);
  const state = snapshot([row({ requestCount: 7, failedCount: 1, redirectCount: 1 })]);
  const live = expand(uiFor(id).ThirdPartyRows({ state })), pro = expand(uiFor(id).ProThirdPartySnapshot({ page: page([resource({ requestCount: 7 })]) }));
  assert.equal(renderedRows(live).length, 1); assert.equal(renderedRows(pro).length, 1);
  for (const key of THIRD_PARTY_KEYS) {
    assert.equal(typeof table[key]?.message, 'string', key); assert.ok(table[key].message.trim(), key);
    const tokens = [...table[key].message.matchAll(/\$([A-Z][A-Z0-9_]*)\$/g)].map(match => match[1].toLowerCase());
    assert.deepEqual(tokens, Object.keys(table[key].placeholders ?? {}), key);
  }
  for (const [index, output] of [visibleText(live), visibleText(pro)].entries()) {
    const common = ['third_party_requests_total', 'third_party_domains_total', 'third_party_resource', 'third_party_status', 'third_party_completed', 'third_party_failed', 'third_party_redirects'];
    for (const key of [...common, ...(index === 0 ? ['third_party_initiator', 'third_party_script_unknown'] : [])]) {
      assert.ok(output.includes(translate(key, [key === 'third_party_domains_total' ? '1' : '7'])), key);
    }
    assert.equal(/\$(?:COUNT|NUMBER)\$|\bthird_party_(?:title|requests|domains|resource|initiator|status|completed)/.test(output), false);
  }
  if (id !== 'en') for (const key of ['third_party_title', 'third_party_requests_total', 'third_party_script_unknown', 'third_party_empty']) assert.notEqual(table[key].message, tableFor('en')[key].message, key);
});

const tick = async () => { for (let index = 0; index < 12; ++index) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const nativeEvent = () => { const listeners = new Set(); return { listeners, addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener), fire: value => { for (const listener of listeners) listener(value); } }; };
const browserMock = sendMessage => ({ runtime: { sendMessage }, permissions: { onAdded: nativeEvent(), onRemoved: nativeEvent() } });
function hookHarness(browserApi) {
  const slots = []; let cursor = 0, effects = [];
  const ui = createIdentificationUi({ h, translate: translator(tableFor('en')), useLocale: () => 'en', browserApi,
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: initial }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(effect, dependencies) { const index = cursor++, slot = slots[index] ??= {}; if (!slot.dependencies || dependencies.some((value, i) => value !== slot.dependencies[i])) effects.push(() => { slot.cleanup?.(); slot.dependencies = dependencies; slot.cleanup = effect(); }); }
  });
  return { render(session, enabled = true, visible = true) { cursor = 0; ui.useThirdParty(session, enabled, visible); const work = effects; effects = []; work.forEach(effect => effect()); cursor = 0; return ui.useThirdParty(session, enabled, visible); }, dispose() { slots.forEach(slot => slot.cleanup?.()); } };
}
const session = (documentKey = '42:0:main', coverageState = 'active') => ({ loaded: true, busy: false, tabId: 42, selectedFrameId: 0,
  frames: [{ frameId: 0, documentKey }], frameOverviews: [{ frameId: 0, documentKey, coverageState }], report: { documentKey, observedSince: 1, coverageState } });

test('Third Party always asks for the authoritative root document, including when a child is selected', async t => {
  const calls = [], browser = browserMock(async request => { calls.push(request); return snapshot([row()]); }), hook = hookHarness(browser);
  t.after(() => hook.dispose());
  const child = { ...session(), selectedFrameId: 1, frames: [...session().frames, { frameId: 1, documentKey: '42:1:child' }], report: { documentKey: '42:1:child', observedSince: 1, coverageState: 'no-access' } };
  hook.render(child); await tick(); const current = hook.render(child);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { schemaVersion: 1, type: 'ui-get-third-party', tabId: 42, frameId: 0, documentKey: '42:0:main' });
  assert.equal(current.state?.documentKey, '42:0:main');
});

test('Late Third Party replies cannot cross a root navigation, permission change or unmount', async t => {
  const late = deferred(), browser = browserMock(() => late.promise), hook = hookHarness(browser);
  t.after(() => hook.dispose());
  hook.render(session()); hook.render(session('42:0:next'));
  late.resolve(snapshot([row()])); await tick();
  assert.equal(hook.render(session('42:0:next')).state, null);
  hook.dispose(); assert.equal(browser.permissions.onRemoved.listeners.size, 0);
  assert.equal(browser.permissions.onAdded.listeners.size, 0);
  const revoked = deferred(), revBrowser = browserMock(() => revoked.promise), revHook = hookHarness(revBrowser);
  t.after(() => revHook.dispose()); revHook.render(session()); revBrowser.permissions.onRemoved.fire({ origins: ['https://example.test/*'] });
  revoked.resolve(snapshot([row()])); await tick();
  assert.equal(revHook.render(session()).state, null);
});

test('Paused roots and disabled inspection neither show a cached inventory nor perform native reads', async t => {
  let calls = 0; const browser = browserMock(async () => { ++calls; return snapshot([row()]); }), hook = hookHarness(browser);
  t.after(() => hook.dispose());
  hook.render(session(), false); await tick(); assert.equal(calls, 0);
  hook.render(session()); await tick(); assert.ok(hook.render(session()).state);
  assert.equal(hook.render(session('42:0:main', 'paused')).state, null);
  assert.equal(calls, 1);
});

test('Clearing the same root document discards its previous inventory before the refreshed reply arrives', async t => {
  const next = deferred(); let calls = 0;
  const browser = browserMock(() => ++calls === 1 ? Promise.resolve(snapshot([row({ requestCount: 9 })])) : next.promise), hook = hookHarness(browser);
  t.after(() => hook.dispose()); hook.render(session()); await tick();
  assert.equal(hook.render(session()).state.rows[0].requestCount, 9);
  const cleared = { ...session(), report: { ...session().report, observedSince: null } };
  assert.equal(hook.render(cleared).state, null);
  next.resolve(snapshot([])); await tick();
  assert.deepEqual(hook.render(cleared).state.rows, []);
  assert.equal(calls, 2);
});

test('A valid snapshot for another root cannot become the current main-page inventory', async t => {
  const browser = browserMock(async () => snapshot([row({ documentKey: '42:0:other' })], { documentKey: '42:0:other' })), hook = hookHarness(browser);
  t.after(() => hook.dispose()); hook.render(session()); await tick();
  assert.equal(hook.render(session()).state, null);
});

// ADR-103: request kinds and domains lead the panel; the per-resource table stays available, collapsed.
test('ADR-103: Third Party groups admitted requests by kind and by domain with the same totals', () => {
  const state = snapshot([
    row({ domain: 'ads.test', type: 'image', pathTemplate: '/p/:id.gif', requestCount: 5 }),
    row({ domain: 'ads.test', type: 'script', requestCount: 2 }),
    row({ domain: 'cdn.test', type: 'image', pathTemplate: '/b/:id.gif', requestCount: 3 }),
    row({ domain: 'other.test', type: 'ping', requestCount: 1, relation: 'unknown' }),
    timingRow({ domain: 'ads.test', type: 'image', requestCount: 9 })
  ]);
  const groups = thirdPartyGroups(state), totals = thirdPartyTotals(state);
  assert.deepEqual(groups.types.map(group => [group.type, group.requests]), [['image', 8], ['script', 2]]);
  assert.deepEqual(groups.types[0].domains, [{ domain: 'ads.test', requests: 5 }, { domain: 'cdn.test', requests: 3 }]);
  assert.deepEqual(groups.domains.map(domain => [domain.domain, domain.requests, domain.types]), [['ads.test', 7, ['image', 'script']], ['cdn.test', 3, ['image']]]);
  assert.equal(groups.types.reduce((sum, group) => sum + group.requests, 0), totals.requests);
  assert.equal(groups.domains.length, totals.domains);
});

test('ADR-103: the Third Party panel leads with request kinds, keeps one summary and collapses the per-resource table', () => {
  const state = snapshot([row({ domain: 'ads.test', type: 'image', requestCount: 4 }), row({ domain: 'cdn.test', type: 'script', requestCount: 1 })]);
  const embedded = h('section', { class: 'inspector-other-documents', children: 'API' });
  const panel = expand(uiFor('en').ThirdPartyPanel({ thirdParty: { state, pending: false, refresh() {} }, embedded }));
  const order = nodes(panel, node => ['data-third-party-techniques', 'data-third-party-domain-list', 'data-third-party-details'].some(key => node.props[key] !== undefined) || node.props.class === 'inspector-other-documents')
    .map(node => node.props['data-third-party-techniques'] ? 'kinds' : node.props['data-third-party-domain-list'] ? 'domains' : node.props['data-third-party-details'] ? 'details' : 'embedded');
  assert.deepEqual(order, ['kinds', 'embedded', 'domains', 'details']);
  assert.equal(nodes(panel, node => node.props['data-third-party-requests'] !== undefined).length, 1, 'a single request summary');
  assert.equal(renderedValue(panel, 'data-third-party-requests'), 5);
  assert.deepEqual(nodes(panel, node => node.props['data-third-party-type'] !== undefined).map(node => node.props['data-third-party-type']), ['image', 'script']);
  const details = nodes(panel, node => node.props['data-third-party-details'] !== undefined)[0];
  assert.equal(details.type, 'details'); assert.equal(details.props.open, undefined, 'the per-resource table starts collapsed');
  assert.equal(renderedRows(details).length, 2, 'every resource row stays available inside the details');
  assert.ok(visibleText(panel).includes('ads.test'));
});

test('ADR-103: API use in embedded documents stays visible without third-party requests or a snapshot', () => {
  const embedded = h('section', { class: 'inspector-other-documents', children: 'API' });
  const empty = expand(uiFor('en').ThirdPartyPanel({ thirdParty: { state: snapshot([]), pending: false, refresh() {} }, embedded }));
  assert.equal(nodes(empty, node => node.props.class === 'inspector-other-documents').length, 1);
  assert.equal(nodes(empty, node => node.props['data-third-party-details'] !== undefined).length, 0);
  const unavailable = expand(uiFor('en').ThirdPartyPanel({ thirdParty: { state: null, pending: false, refresh() {} }, embedded }));
  assert.equal(nodes(unavailable, node => node.props.class === 'inspector-other-documents').length, 1);
});

for (const { id } of PRODUCTION_LANGUAGES) test('ADR-103 Third Party kinds and domains are localized in ' + id, () => {
  const state = snapshot([row({ type: 'image', requestCount: 2 }), row({ domain: 'b.test', type: 'xmlhttprequest' })]);
  const output = visibleText(expand(uiFor(id).ThirdPartyPanel({ thirdParty: { state, pending: false, refresh() {} } })));
  assert.equal(/social_resource_|inspector_(group|found|spotted)|pro_graph_domains|third_party_title/.test(output), false, output.slice(0, 200));
});
