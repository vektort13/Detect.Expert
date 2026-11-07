import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createIdentificationUi, displayCookieValue, identificationCounts } from '../../apps/production-extension/identification-ui.js';
import { cookieCompanyMark } from '../../apps/production-extension/cookie-branding.js';
import { applyIdentificationCopy } from '../production-locales-identification.mjs';
import { applyCookieReportCopy } from '../production-locales-cookie-report.mjs';
import { applyCookiePurposeCopy } from '../production-locales-cookie-purposes.mjs';
import { applySocialCopy } from '../production-locales-social.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const english = applySocialCopy(applyCookiePurposeCopy(applyCookieReportCopy(applyIdentificationCopy(JSON.parse(readFileSync(new URL('../../apps/production-extension/_locales/en/messages.json', import.meta.url))), 'en'), 'en'), 'en'), 'en');
const translate = (key, substitutions = []) => {
  let result = english[key]?.message ?? key;
  for (const [name, placeholder] of Object.entries(english[key]?.placeholders ?? {})) result = result.replaceAll('$' + name.toUpperCase() + '$', substitutions[Number(placeholder.content.slice(1)) - 1]);
  return result;
};
const h = (type, props) => ({ type, props });
const ui = createIdentificationUi({ h, useState() {}, useEffect() {}, useRef() {}, useLocale() {}, translate });
const snapshot = (entries = [], changes = {}) => ({
  schemaVersion: 1, type: 'cookies-state', documentKey: '5:0:main', coverageState: 'active', permission: 'granted',
  trackingCount: entries.filter(entry => entry.tracking).length, entries, truncated: false, observedAt: 1,
  sessionBinding: { status: 'not-observed', headers: [] }, ...changes
});
const cookie = (changes = {}) => ({ name: '_ga', domain: 'example.test', hostOnly: true, secure: true, httpOnly: false,
  session: false, sameSite: 'lax', expirationDate: 2000000000, partitioned: false, tracking: true, category: 'analytics',
  owner: 'Google Analytics', purpose: 'Page views', confidence: 'community', ruleIds: ['cookie.ga'], sourceUrls: ['https://example.test/reference'], ...changes });
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
  return node && typeof node === 'object' ? visibleText(node.props.children) : node === undefined || node === null ? '' : String(node);
}
function globals(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
}

test('identification badges count distinct techniques, with zero-count and unmapped operations excluded', () => {
  const report = { techniques: [{ techniqueId: 'DET-005', count: 10000 }, { techniqueId: 'DET-005', count: 1 }, { techniqueId: 'DET-011', count: 3 }, { techniqueId: 'DET-019', count: 0 }],
    apiOperations: [{ apiOperation: 'Rect.width', count: 2000 }, { apiOperation: 'Rect.height', count: 4000 }, { apiOperation: 'GPU.adapter', count: 2 }, { apiOperation: 'GPU.device', count: 0 }, { apiOperation: 'Unmapped.call', count: 5000 }] };
  const definition = operation => ({ 'Rect.width': { techniqueId: 'DET-005' }, 'Rect.height': { techniqueId: 'DET-005' }, 'GPU.adapter': { techniqueId: 'DET-013' }, 'GPU.device': { techniqueId: 'DET-014' } })[operation] ?? null;
  assert.deepEqual(identificationCounts(report, 0, [], [], definition), { active: 2, passive: 2, 'third-party': 0 });
});

test('child badge unions current and child overviews, excluding the main document and stale frame reuse', () => {
  const report = { techniques: [{ techniqueId: 'DET-005', count: 4 }, { techniqueId: 'DET-011', count: 1 }], apiOperations: [] };
  const frames = [{ frameId: 0, documentKey: '5:0:main' }, { frameId: 3, documentKey: '5:3:current' }, { frameId: 4, documentKey: '5:4:next' }];
  const overviews = [{ frameId: 0, documentKey: '5:0:main', techniqueIds: ['DET-001'] }, { frameId: 3, documentKey: '5:3:current', techniqueIds: ['DET-005'] },
    { frameId: 4, documentKey: '5:4:next', techniqueIds: ['DET-005', 'DET-019'] }, { frameId: 4, documentKey: '5:4:old', techniqueIds: ['DET-025'] }];
  assert.deepEqual(identificationCounts(report, 3, frames, overviews, () => null), { active: 0, passive: 2, 'third-party': 3 });
});

test('navigation exposes seven controlled tabs, roving focus and RTL-aware keys; Cookie badge counts tracking only', t => {
  const selected = [], focused = [], document = { documentElement: { dir: 'ltr' }, getElementById(id) { return { focus() { focused.push(id); } }; } };
  globals(t, { document });
  const navigation = ui.IdentificationNavigation({ prefix: 'test', active: 'passive', onSelect: panel => selected.push(panel), counts: { active: 2, passive: 3, 'third-party': 4 }, cookieState: snapshot([cookie(), cookie({ name: 'session', tracking: false, category: 'necessary' })]) });
  const tabs = nodes(navigation, node => node.props.role === 'tab');
  assert.equal(tabs.length, 7);
  assert.deepEqual(tabs.map(tab => tab.props.tabIndex), [-1, 0, -1, -1, -1, -1, -1]);
  assert.equal(tabs[1].props['aria-selected'], true);
  assert.equal(tabs[1].props['aria-controls'], 'test-panel-passive');
  assert.equal(nodes(tabs[3], node => node.props['data-identification-count'] === 'cookie')[0].props.children, 1);
  const key = value => ({ key: value, preventDefault() {} });
  tabs[1].props.onKeyDown(key('ArrowRight'));
  assert.equal(selected.at(-1), 'third-party');
  assert.equal(focused.at(-1), 'test-tab-third-party');
  document.documentElement.dir = 'rtl';
  tabs[1].props.onKeyDown(key('ArrowRight'));
  assert.equal(selected.at(-1), 'active');
  tabs[1].props.onKeyDown(key('End'));
  assert.equal(selected.at(-1), 'background');
  tabs[3].props.onClick();
  assert.equal(selected.at(-1), 'cookie');
});

test('Cookie report validates metadata, retains security cookies separately and drops legacy session metadata', () => {
  const state = snapshot([cookie({ partitioned: true }), cookie({ name: '__Host-session', tracking: false, category: 'security', session: true, confidence: 'unknown', owner: '', purpose: '', ruleIds: [], sourceUrls: [] })],
    { sessionBinding: { status: 'registration-observed', headers: ['secure-session-registration'] } });
  const rendered = expand(ui.ProCookieSnapshot({ snapshot: state }));
  const text = visibleText(rendered);
  assert.match(text, /Tracking cookies: 1/);
  assert.match(text, /Other displayed cookies: 1/);
  assert.match(text, /Security/);
  assert.match(text, /Partitioned/);
  assert.doesNotMatch(text, /Session registration header observed/);
  assert.doesNotMatch(text, /TPM|DBSC/);
  assert.doesNotMatch(text, /hardware|non-exportable|bound device/i);
  assert.equal(nodes(rendered, node => node.props['data-cookie-tpm'] === 'unknown').length, 0);
  assert.equal(nodes(rendered, node => node.props['data-cookie-value-action']).length, 0);
  assert.equal(nodes(rendered, node => node.props['data-cookie-tracking'] === 'true').length, 1);
  assert.equal(nodes(rendered, node => node.props['data-cookie-tracking'] === 'false').length, 1);
  assert.equal(ui.ProCookieSnapshot({ snapshot: snapshot([cookie({ value: 'CREDENTIAL_CANARY' })]) }), null);
});

test('Pro Cookie omits absent and inaccessible inventories including legacy header-only snapshots', () => {
  assert.equal(ui.ProCookieSnapshot({}), null);
  assert.equal(ui.ProCookieSnapshot({ snapshot: snapshot([]) }), null);
  assert.equal(ui.ProCookieSnapshot({ snapshot: snapshot([], { permission: 'required', coverageState: 'no-access' }) }), null);
  const report = expand(ui.ProCookieSnapshot({ snapshot: snapshot([], { sessionBinding: { status: 'registration-observed', headers: ['secure-session-registration'] } }) }));
  assert.equal(report, null);
  assert.equal(nodes(report, node => node.type === 'table').length, 0);
});

test('name references explain an unknown Cookie without a company logo or tracking promotion', () => {
  const entry = cookie({ tracking: false, category: 'unknown', owner: '', confidence: 'ambiguous',
    purpose: 'Catalogue name match: Reference vendor — <script>INERT_REFERENCE</script>' });
  const rendered = expand(ui.ProCookieSnapshot({ snapshot: snapshot([entry]) }));
  const references = nodes(rendered, node => node.props['data-cookie-name-reference']);
  assert.equal(references.length, 1);
  assert.equal(references[0].props.children, 'Reference vendor — <script>INERT_REFERENCE</script>');
  assert.match(visibleText(rendered), /Catalogue name match/);
  assert.equal(nodes(rendered, node => node.props['data-cookie-tracking'] === 'true').length, 0);
  assert.equal(nodes(rendered, node => node.props['data-company-logo'] !== undefined).length, 0);
  assert.equal(nodes(rendered, node => node.type === 'script' || node.props.dangerouslySetInnerHTML !== undefined).length, 0);
  assert.equal(nodes(rendered, node => node.props['data-cookie-tpm'] === 'unknown').length, 0);
});

test('Cookie permission and unavailable states use explicit actions; opening a view cannot grant access', () => {
  let granted = 0, refreshed = 0;
  const view = ui.CookiePanel({ cookies: { state: snapshot([], { permission: 'required', coverageState: 'no-access' }), pending: false, grant() { granted++; }, refresh() { refreshed++; } } });
  assert.equal(granted, 0);
  const grant = nodes(view, node => node.props['data-cookie-action'] === 'grant')[0];
  grant.props.onClick();
  assert.equal(granted, 1);
  nodes(view, node => node.props['data-cookie-action'] === 'refresh')[0].props.onClick();
  assert.equal(refreshed, 1);
  assert.match(visibleText(ui.CookiePanel({ cookies: { state: null, pending: true } })), /Loading cookie metadata/);
  assert.match(visibleText(ui.CookiePanel({ cookies: { state: null, pending: false } })), /Cookie metadata is unavailable/);
});

test('Cookie tab shows inventory total separately from its tracking badge', () => {
  const state = snapshot([cookie(), cookie({ name: 'session', tracking: false, category: 'necessary' })], { totalCount: 8, siteCount: 4, truncated: true });
  const view = ui.IdentificationNavigation({ prefix: 'total', active: 'cookie', onSelect() {}, counts: { active: 0, passive: 0, 'third-party': 0 }, cookieState: state });
  const tab = nodes(view, node => node.props['data-identification-tab'] === 'cookie')[0];
  assert.match(visibleText(tab), /Cookie · ≥8/);
  assert.equal(nodes(tab, node => node.props['data-identification-count'] === 'cookie')[0].props.children, 1);
  const report = expand(ui.ProCookieSnapshot({ snapshot: state }));
  assert.match(visibleText(report), /All cookies: ≥8/); assert.match(visibleText(report), /Cookies of this site: ≥4/);
  assert.match(visibleText(report), /Other displayed cookies: 1/);
  assert.equal(nodes(report, node => node.props['data-cookie-action'] === 'clear').length, 0, 'Pro snapshots stay read-only');
  const old = expand(ui.ProCookieSnapshot({ snapshot: snapshot([cookie()]) }));
  assert.match(visibleText(old), /All cookies: 1/); assert.doesNotMatch(visibleText(old), /Cookies of this site:/);
});

test('Cookie cards use category color hooks and factual expanded analysis for unknown metadata', () => {
  const unknown = cookie({ name: 'site-state', owner: '', purpose: '', confidence: 'unknown', category: 'unknown', tracking: false, secure: false, httpOnly: true, hostOnly: false, session: true, sameSite: 'unspecified', ruleIds: [], sourceUrls: [] });
  const report = expand(ui.CookiePanel({ cookies: { state: snapshot([cookie(), unknown]) } }));
  const cards = nodes(report, node => node.type === 'article');
  assert.equal(cards[0].props['data-cookie-category'], 'analytics'); assert.match(cards[0].props.class, /cookie-entry--tracking/);
  const analysis = nodes(cards[1], node => node.props['data-cookie-analysis'])[0];
  assert.equal(analysis.props.open, true);
  const text = visibleText(analysis);
  assert.match(text, /No single purpose match/); assert.match(text, /Scope: domain and subdomains/);
  assert.match(text, /Secure attribute is absent/); assert.match(text, /HttpOnly: hidden from page JavaScript/);
  assert.match(text, /Lifetime: browser session/); assert.match(text, /SameSite attribute is unspecified/);
  assert.doesNotMatch(text, /TPM|guaranteed|encrypted|safe device|malicious/i);
  assert.match(visibleText(cards[1]), /Company not identified/);
});

test('Cookie inventory with filtered metadata and a positive total does not claim the site has no cookies', () => {
  const report = expand(ui.ProCookieSnapshot({ snapshot: snapshot([], { totalCount: 2, siteCount: 2, coverageState: 'partial' }) }));
  const text = visibleText(report);
  assert.match(text, /All cookies: 2/); assert.match(text, /Cookie metadata is unavailable/);
  assert.doesNotMatch(text, /No cookies found/);
  const empty = expand(ui.ProCookieSnapshot({ snapshot: snapshot([], { totalCount: 0, siteCount: 0 }) }));
  assert.equal(empty, null, 'a zero inventory does not create an empty report section');
});

test('Cookie clear action is first in the panel and displays partial counts without a success substitute', () => {
  let calls = 0;
  const view = ui.CookiePanel({ cookies: { state: snapshot([cookie()]), pending: false, busy: false, clear() { calls++; }, clearResult: { removedCount: 2, failedCount: 1, truncated: false } } });
  assert.equal(view.props.children[0].props['data-cookie-action'], 'clear');
  assert.equal(view.props.children[0].props.disabled, false); view.props.children[0].props.onClick(); assert.equal(calls, 1);
  assert.match(visibleText(view), /Removed: 2\. Failed: 1/); assert.match(visibleText(view), /Cookie clearing was partial/);
  assert.equal(ui.CookiePanel({ cookies: { state: snapshot([], { permission: 'required', coverageState: 'no-access' }) } }).props.children[0].props.disabled, true);
});

test('Cookie company marks use exact known aliases and verified local SVGs with a neutral fallback', () => {
  for (const [owner, brand] of [['Google Analytics', 'google'], ['Google reCAPTCHA', 'google'], ['Yandex Metrica', 'yandex'], ['Hotjar', 'hotjar'], ['Meta', 'meta'], ['Facebook', 'facebook'], ['X', 'x-twitter'], ['Twitter', 'twitter']]) {
    const mark = cookieCompanyMark(owner); assert.equal(mark.brand, brand); assert.ok(mark.src.endsWith('/icons/brands/' + brand + '.svg')); assert.equal(/^https?:/.test(mark.src), false);
  }
  for (const owner of ['Google impostor', 'Cookiebot convention', 'Site consent manager (Cookiebot convention)', '__proto__', '']) assert.equal(cookieCompanyMark(owner).src, null);
  assert.equal(cookieCompanyMark('').monogram, '?'); assert.equal(cookieCompanyMark('Unknown Company').monogram, 'UN');
  const directory = new URL('../../apps/production-extension/icons/brands/', import.meta.url);
  const provenance = JSON.parse(readFileSync(new URL('PROVENANCE.json', directory), 'utf8'));
  assert.equal(provenance.icons.length, 18); assert.equal(provenance.commit, 'af620534bfc3c2d4cbefcfeec29603bbe7809e64');
  for (const icon of provenance.icons) {
    assert.match(icon.file, /^[a-z-]+\.svg$/); const body = readFileSync(new URL(icon.file, directory));
    assert.equal(body.length, icon.bytes); assert.equal(createHash('sha256').update(body).digest('hex'), icon.sha256);
    assert.match(body.toString('utf8'), /Font Awesome Free/); assert.doesNotMatch(body.toString('utf8'), /<(?:script|style|image|foreignObject|use|animate|set)\b|\b(?:href|src|on[a-z]+)\s*=/i);
  }
  assert.match(readFileSync(new URL('FONT-AWESOME-LICENSE.txt', directory), 'utf8'), /Icons: CC BY 4\.0/);
});

function hookHarness(browserApi = globalThis.chrome, method = 'useCookies') {
  const slots = []; let cursor = 0, effects = [];
  const api = createIdentificationUi({ h, useLocale() {}, translate, browserApi,
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: initial }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(effect, dependencies) { const index = cursor++, slot = slots[index] ??= {}; if (!slot.dependencies || dependencies.some((value, position) => value !== slot.dependencies[position])) effects.push(() => { slot.cleanup?.(); slot.dependencies = dependencies; slot.cleanup = effect(); }); }
  });
  return { render(session, visible) { cursor = 0; let result = api[method](session, visible); const work = effects; effects = []; work.forEach(effect => effect()); cursor = 0; result = api[method](session, visible); return result; }, dispose() { slots.forEach(slot => slot.cleanup?.()); } };
}
const session = (documentKey = '5:0:main') => ({ loaded: true, busy: false, tabId: 5, selectedFrameId: 0, report: { documentKey, observedSince: 1, coverageState: 'active' } });
const tick = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
const event = () => { const listeners = new Set(); return { addListener(listener) { listeners.add(listener); }, removeListener(listener) { listeners.delete(listener); }, fire(value) { for (const listener of listeners) listener(value); } }; };
const handles = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)];
const cookieView = (state = snapshot([cookie()]), identifiers = [handles[0]]) => ({ schemaVersion: 1, type: 'cookies-view-state', snapshot: state, handles: identifiers });
const cookieValue = (value, changes = {}) => ({ schemaVersion: 1, type: 'cookie-value-state', documentKey: '5:0:main', handle: handles[0], value, truncated: false, ...changes });

test('live Cookie controls keep original inventory indices after tracking grouping, with no action for unavailable handles', () => {
  const requests = [];
  const state = snapshot([cookie({ name: 'PHPSESSID', tracking: false, category: 'functional' }), cookie({ name: '_ga' }), cookie({ name: 'external', domain: 'other.test' })]);
  const view = expand(ui.CookiePanel({ cookies: { state, handles: [handles[0], handles[1], null], showValue(index) { requests.push(index); }, hideValue() {} } }));
  const cards = nodes(view, node => node.type === 'article');
  assert.deepEqual(cards.map(card => nodes(card, node => node.type === 'h4')[0].props.children), ['_ga', 'external', 'PHPSESSID']);
  const buttons = nodes(view, node => node.props['data-cookie-value-action'] === 'show');
  assert.equal(buttons.length, 2); buttons[0].props.onClick(); buttons[1].props.onClick();
  assert.deepEqual(requests, [1, 0]);
  assert.equal(nodes(cards[1], node => node.props['data-cookie-value-action']).length, 0);
  assert.match(visibleText(cards[1]), /Cookie value is unavailable/);
  assert.equal(nodes(expand(ui.ProCookieSnapshot({ snapshot: state })), node => node.props['data-cookie-value'] !== undefined).length, 0);
});

test('live Cookie values render literal text, escaped controls and bidi, with an explicit empty state', () => {
  const raw = '<img src=x onerror=alert(1)>\u202e\n\u0000\u2066\u061c';
  const state = snapshot([cookie()]);
  const render = valueState => expand(ui.CookiePanel({ cookies: { state, handles: [handles[0]], valueState, hideValue() {} } }));
  const view = render({ index: 0, value: raw, truncated: true });
  const value = nodes(view, node => node.props['data-cookie-value-text'])[0];
  assert.equal(value.type, 'pre'); assert.equal(value.props.dir, 'ltr');
  assert.equal(value.props.children, '<img src=x onerror=alert(1)>\\u202e\\u000a\\u0000\\u2066\\u061c');
  assert.equal(Object.hasOwn(value.props, 'dangerouslySetInnerHTML'), false);
  assert.equal(nodes(view, node => node.type === 'img' && node.props.src === 'x').length, 0);
  assert.match(visibleText(view), /Value display limit reached/);
  const empty = render({ index: 0, value: '', truncated: false });
  assert.equal(nodes(empty, node => node.props['data-cookie-empty-value']).length, 1);
  assert.equal(nodes(empty, node => node.props['data-cookie-value-text']).length, 0);
  assert.match(visibleText(empty), /Empty value/); assert.doesNotMatch(visibleText(empty), /Cookie value is unavailable/);
  assert.equal(displayCookieValue('a\u007fb\u0085c\u200f'), 'a\\u007fb\\u0085c\\u200f');
});

test('Cookie value is read only by explicit click, one request at a time and one value displayed', async t => {
  const requests = [], pending = [];
  const state = snapshot([cookie(), cookie({ name: 'PHPSESSID', tracking: false, category: 'functional' })]);
  const harness = hookHarness({ runtime: { sendMessage(request) {
    requests.push(request);
    return request.type === 'ui-get-cookie-value' ? new Promise(resolve => pending.push(resolve)) : Promise.resolve(cookieView(state, handles.slice(0, 2)));
  } }, permissions: {} });
  t.after(() => harness.dispose());
  harness.render(session(), true); await tick(); let view = harness.render(session(), true);
  assert.equal(requests.length, 1); assert.equal(requests[0].type, 'ui-get-cookie-view'); assert.equal(view.valueState, null);
  const first = view.showValue(0); await view.showValue(0); await view.showValue(1);
  assert.equal(requests.length, 2); assert.equal(harness.render(session(), true).valueState.pending, true);
  assert.deepEqual(requests[1], { schemaVersion: 1, type: 'ui-get-cookie-value', tabId: 5, frameId: 0, documentKey: '5:0:main', handle: handles[0] });
  pending.shift()(cookieValue('FIRST_VALUE')); await first; view = harness.render(session(), true);
  assert.equal(view.valueState.value, 'FIRST_VALUE'); assert.equal(Object.hasOwn(view.state.entries[0], 'value'), false);
  const second = view.showValue(1); assert.equal(harness.render(session(), true).valueState.value, null);
  pending.shift()(cookieValue('SECOND_VALUE', { handle: handles[1] })); await second;
  view = harness.render(session(), true); assert.equal(view.valueState.value, 'SECOND_VALUE'); assert.equal(view.valueState.index, 1);
  view.hideValue(); assert.equal(harness.render(session(), true).valueState, null); assert.equal(requests.length, 3);
});

test('hidden Cookie overview never obtains live handles, reads no values and retains metadata counts', async t => {
  const requests = [];
  const harness = hookHarness({ runtime: { async sendMessage(request) { requests.push(request); return request.type === 'ui-get-cookie-view' ? cookieView() : snapshot([cookie()]); } }, permissions: {} });
  t.after(() => harness.dispose());
  harness.render(session(), false); await tick(); let view = harness.render(session(), false);
  assert.equal(view.state.trackingCount, 1); assert.deepEqual(view.handles, []); await view.showValue(0);
  assert.equal(requests.length, 1); assert.equal(requests[0].type, 'ui-get-cookies');
  harness.render(session(), true); await tick(); view = harness.render(session(), true);
  assert.deepEqual(view.handles, [handles[0]]); assert.equal(requests.length, 2);
});

for (const change of ['navigation', 'revocation', 'host-revocation', 'refresh', 'hide', 'pause', 'busy', 'clear']) test('Cookie live value rejects a late reply after ' + change, async t => {
  let resolveValue; const removed = event(), requests = [];
  const harness = hookHarness({ runtime: { sendMessage(request) {
    requests.push(request);
    if (request.type === 'ui-get-cookie-value') return new Promise(resolve => { resolveValue = resolve; });
    if (request.type === 'ui-clear-site-cookies') return Promise.resolve({ schemaVersion: 1, type: 'cookies-clear-state', documentKey: '5:0:main', removedCount: 1, failedCount: 0, truncated: false });
    return Promise.resolve(cookieView(snapshot([cookie()], { documentKey: request.documentKey })));
  } }, permissions: { onRemoved: removed } });
  t.after(() => harness.dispose());
  harness.render(session(), true); await tick(); let selected = session(), visible = true;
  const job = harness.render(selected, visible).showValue(0);
  if (change === 'navigation') selected = session('5:0:next');
  else if (change === 'revocation' || change === 'host-revocation') removed.fire(change === 'revocation' ? { permissions: ['cookies'] } : { origins: ['https://example.test/*'] });
  else if (change === 'refresh') await harness.render(selected, visible).refresh();
  else if (change === 'hide') visible = false;
  else if (change === 'pause') selected.report.coverageState = 'paused';
  else if (change === 'busy') selected.busy = true;
  else if (change === 'clear') await harness.render(selected, visible).clear();
  harness.render(selected, visible); resolveValue(cookieValue('LATE_VALUE_CANARY')); await job; await tick();
  assert.equal(harness.render(selected, visible).valueState, null);
  assert.equal(requests.filter(request => request.type === 'ui-get-cookie-value').length, 1);
});

test('Cookie value rejects mismatched identity, extra payload fields and accessors without retry', async t => {
  let reads = 0, requestCount = 0;
  const accessor = cookieValue('IGNORED'); Object.defineProperty(accessor, 'value', { get() { reads++; return 'ACCESSOR_CANARY'; }, enumerable: true });
  const bad = [cookieValue('DOCUMENT_CANARY', { documentKey: '5:0:other' }), cookieValue('HANDLE_CANARY', { handle: handles[1] }), cookieValue('EXTRA_CANARY', { url: 'https://example.test/secret' }), accessor];
  const harness = hookHarness({ runtime: { async sendMessage(request) { if (request.type === 'ui-get-cookie-value') { requestCount++; return bad.shift(); } return cookieView(); } }, permissions: {} });
  t.after(() => harness.dispose());
  harness.render(session(), true); await tick();
  for (let index = 0; index < 4; index++) { await harness.render(session(), true).showValue(0); const view = harness.render(session(), true); assert.equal(view.valueState.value, null); assert.equal(view.valueState.unavailable, true); }
  assert.equal(requestCount, 4); assert.equal(reads, 0);
});

test('Cookie value stops after its six-second deadline and ignores a late response', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let requests = 0, resolveValue;
  const harness = hookHarness({ runtime: { sendMessage(request) { if (request.type !== 'ui-get-cookie-value') return Promise.resolve(cookieView()); requests++; return new Promise(resolve => { resolveValue = resolve; }); } }, permissions: {} });
  t.after(() => harness.dispose());
  harness.render(session(), true); await tick(); const job = harness.render(session(), true).showValue(0);
  t.mock.timers.tick(5999); await tick(); assert.equal(harness.render(session(), true).valueState.pending, true);
  t.mock.timers.tick(1); await job; assert.equal(harness.render(session(), true).valueState.unavailable, true);
  resolveValue(cookieValue('TIMEOUT_CANARY')); await tick();
  assert.equal(harness.render(session(), true).valueState.value, null); assert.equal(requests, 1);
});

test('live Cookie value is reset on print or document hiding, and print CSS excludes the whole live value area', async t => {
  const listeners = new Map(), visibility = new Map(), document = { visibilityState: 'visible', addEventListener(name, listener) { visibility.set(name, listener); }, removeEventListener(name) { visibility.delete(name); } };
  globals(t, { document, addEventListener(name, listener) { listeners.set(name, listener); }, removeEventListener(name) { listeners.delete(name); } });
  const harness = hookHarness({ runtime: { async sendMessage(request) { return request.type === 'ui-get-cookie-value' ? cookieValue('PRINT_CANARY') : cookieView(); } }, permissions: {} });
  t.after(() => harness.dispose());
  harness.render(session(), true); await tick(); await harness.render(session(), true).showValue(0);
  assert.equal(harness.render(session(), true).valueState.value, 'PRINT_CANARY'); listeners.get('beforeprint')();
  assert.equal(harness.render(session(), true).valueState, null);
  await harness.render(session(), true).showValue(0); document.visibilityState = 'hidden'; visibility.get('visibilitychange')();
  assert.equal(harness.render(session(), true).valueState, null);
  const css = readFileSync(new URL('../../apps/production-extension/identification-ui.css', import.meta.url), 'utf8');
  assert.match(css, /@media print\s*\{\s*\.cookie-value\s*\{\s*display:\s*none\s*!important/);
});

test('Secure, HttpOnly and CHIPS remain visible without retired DBSC and TPM labels', () => {
  for (const status of ['not-observed', 'registration-observed', 'protocol-observed', 'unsupported']) {
    const state = snapshot([cookie({ secure: true, httpOnly: true, partitioned: true })], { sessionBinding: { status, headers: status === 'registration-observed' ? ['secure-session-registration'] : [] } });
    const rendered = expand(ui.ProCookieSnapshot({ snapshot: state }));
    assert.doesNotMatch(visibleText(rendered), /TPM|DBSC/);
    assert.equal(nodes(rendered, node => node.props['data-cookie-tpm'] === 'unknown').length, 0);
    assert.equal(nodes(rendered, node => node.props['data-cookie-tpm'] === 'protected').length, 0);
    assert.equal(nodes(rendered, node => /(?:lock|tpm-protected)/.test(node.props.class ?? '')).length, 0);
  }
  assert.equal(ui.ProCookieSnapshot({ snapshot: snapshot([cookie({ tpmProtected: true })]) }), null, 'untrusted fabricated hardware flag is rejected');
});

test('Cookie hook grants only on explicit click, then refreshes the exact selected document', async t => {
  const requests = []; let permissionCalls = 0, allowed = false;
  globals(t, { chrome: { runtime: { async sendMessage(request) { requests.push(request); return allowed ? snapshot([cookie()]) : snapshot([], { permission: 'required', coverageState: 'no-access' }); } },
    permissions: { request() { permissionCalls++; allowed = true; return Promise.resolve(true); }, onAdded: event(), onRemoved: event() } } });
  const harness = hookHarness(); t.after(() => harness.dispose());
  harness.render(session(), true); await tick();
  let view = harness.render(session(), true);
  assert.equal(view.state.permission, 'required');
  assert.equal(permissionCalls, 0);
  const grant = view.grant();
  assert.equal(permissionCalls, 1, 'permission request occurs synchronously in the click handler');
  await grant; view = harness.render(session(), true);
  assert.equal(view.state.trackingCount, 1);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], { schemaVersion: 1, type: 'ui-get-cookie-view', tabId: 5, frameId: 0, documentKey: '5:0:main' });
  await view.refresh();
  assert.equal(requests.length, 3);
});

test('overview reads Cookie metadata once per selected document without requesting permission, and opens with fresh data', async t => {
  let requests = 0, permissionCalls = 0;
  globals(t, { chrome: { runtime: { async sendMessage() { requests++; return snapshot([], { permission: 'required', coverageState: 'no-access' }); } },
    permissions: { async request() { permissionCalls++; return false; } } } });
  const harness = hookHarness(); t.after(() => harness.dispose());
  harness.render(session(), false); await tick();
  assert.equal(requests, 1);
  assert.equal(permissionCalls, 0);
  assert.equal(harness.render(session(), false).state.permission, 'required');
  harness.render(session(), false); await tick();
  assert.equal(requests, 1, 'normal report refresh keeps the same document metadata');
  harness.render(session(), true); await tick();
  assert.equal(requests, 2, 'opening Cookie refreshes metadata without a permission prompt');
  assert.equal(permissionCalls, 0);
});

test('denied Cookie permission preserves the required state and does not read a cookie inventory', async t => {
  let requests = 0;
  globals(t, { chrome: { runtime: { async sendMessage() { requests++; return snapshot([], { permission: 'required', coverageState: 'no-access' }); } }, permissions: { request: async () => false } } });
  const harness = hookHarness(); t.after(() => harness.dispose());
  harness.render(session(), true); await tick();
  await harness.render(session(), true).grant();
  assert.equal(harness.render(session(), true).state.permission, 'required');
  assert.equal(harness.render(session(), true).pending, false);
  assert.equal(requests, 1);
});

test('Cookie hook drops replies from an old document while a new document inventory is pending', async t => {
  const pending = [];
  globals(t, { chrome: { runtime: { sendMessage(request) { return new Promise(resolve => pending.push({ request, resolve })); } }, permissions: {} } });
  const harness = hookHarness(); t.after(() => harness.dispose());
  harness.render(session(), true);
  const next = session('5:0:next');
  assert.equal(harness.render(next, true).state, null);
  assert.equal(pending.length, 2);
  pending[0].resolve(snapshot([cookie()])); await tick();
  assert.equal(harness.render(next, true).state, null);
  pending[1].resolve(snapshot([cookie({ name: 'new-document-cookie' })], { documentKey: '5:0:next' })); await tick();
  assert.equal(harness.render(next, true).state.entries[0].name, 'new-document-cookie');
});

test('cookie permission revocation clears a cached hidden panel immediately', async t => {
  const removed = event();
  globals(t, { chrome: { runtime: { async sendMessage() { return snapshot([cookie()]); } }, permissions: { onRemoved: removed } } });
  const harness = hookHarness(); t.after(() => harness.dispose());
  harness.render(session(), true); await tick();
  assert.equal(harness.render(session(), false).state.trackingCount, 1);
  removed.fire({ permissions: ['cookies'] });
  assert.equal(harness.render(session(), false).state, null);
});

test('shared Cookie module uses the supplied browser adapter without a global chrome namespace', async t => {
  globals(t, { chrome: undefined });
  const requests = [];
  const browserApi = { runtime: { async sendMessage(request) { requests.push(request); return snapshot([cookie()]); } }, permissions: {} };
  const harness = hookHarness(browserApi); t.after(() => harness.dispose());
  harness.render(session(), true); await tick();
  assert.equal(harness.render(session(), true).state.trackingCount, 1);
  assert.equal(requests.length, 1);
});

test('Cookie clear sends one explicit command, blocks overlapping reads and refreshes actual metadata', async t => {
  let resolveClear, cleared = false, prompts = 0; const requests = [];
  const browserApi = { runtime: { sendMessage(request) { requests.push(request); if (request.type === 'ui-clear-site-cookies') return new Promise(resolve => { resolveClear = resolve; }); return Promise.resolve(cleared ? snapshot([cookie({ name: 'service', tracking: false, category: 'functional' })]) : snapshot([cookie()])); } }, permissions: { request() { prompts++; return true; } } };
  const harness = hookHarness(browserApi); t.after(() => harness.dispose());
  harness.render(session(), false); await tick(); const view = harness.render(session(), false);
  assert.equal(requests.length, 1); const job = view.clear();
  assert.equal(harness.render(session(), false).busy, true); assert.equal(harness.render(session(), false).state.trackingCount, 1, 'no optimistic zero');
  await harness.render(session(), false).clear(); await harness.render(session(), false).refresh();
  assert.equal(requests.length, 2, 'double click and read are blocked during clear'); assert.equal(prompts, 0);
  assert.deepEqual(requests[1], { schemaVersion: 1, type: 'ui-clear-site-cookies', tabId: 5, frameId: 0, documentKey: '5:0:main' });
  cleared = true; resolveClear({ schemaVersion: 1, type: 'cookies-clear-state', documentKey: '5:0:main', removedCount: 1, failedCount: 0, truncated: false }); await job;
  const after = harness.render(session(), false); assert.equal(after.state.trackingCount, 0); assert.equal(after.state.entries.length, 1);
  assert.equal(after.clearResult.removedCount, 1); assert.equal(after.busy, false); assert.equal(requests.length, 3);
});

test('Cookie clear rejects raw fields and has one fifteen-second deadline without destructive retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let calls = 0, resolveClear; const browserApi = { runtime: { sendMessage(request) { if (request.type !== 'ui-clear-site-cookies') return Promise.resolve(snapshot([cookie()])); calls++; return calls === 1 ? Promise.resolve({ schemaVersion: 1, type: 'cookies-clear-state', documentKey: '5:0:main', removedCount: 1, failedCount: 0, truncated: false, value: 'CLEAR_CANARY' }) : new Promise(resolve => { resolveClear = resolve; }); } }, permissions: {} };
  const harness = hookHarness(browserApi); t.after(() => harness.dispose());
  harness.render(session(), true); await tick(); await harness.render(session(), true).clear();
  assert.equal(harness.render(session(), true).clearUnavailable, true); assert.equal(harness.render(session(), true).state.trackingCount, 1);
  const job = harness.render(session(), true).clear(); t.mock.timers.tick(14999); await tick(); assert.equal(harness.render(session(), true).busy, true);
  t.mock.timers.tick(1); await job;
  assert.equal(calls, 2); assert.equal(harness.render(session(), true).clearUnavailable, true); assert.equal(harness.render(session(), true).state.trackingCount, 1);
  resolveClear({ schemaVersion: 1, type: 'cookies-clear-state', documentKey: '5:0:main', removedCount: 1, failedCount: 0, truncated: false }); await tick();
  assert.equal(harness.render(session(), true).clearResult, null); assert.equal(calls, 2);
});

for (const change of ['navigation', 'revocation']) test('Cookie clear drops old results after ' + change + ' and reads only the current state', async t => {
  const removed = event(); let resolveClear, revoked = false; const requests = [];
  const browserApi = { runtime: { sendMessage(request) { requests.push(request); if (request.type === 'ui-clear-site-cookies') return new Promise(resolve => { resolveClear = resolve; }); return Promise.resolve(revoked ? snapshot([], { documentKey: request.documentKey, permission: 'required', coverageState: 'no-access' }) : snapshot([cookie()], { documentKey: request.documentKey })); } }, permissions: { onRemoved: removed } };
  const harness = hookHarness(browserApi); t.after(() => harness.dispose());
  harness.render(session(), true); await tick(); const job = harness.render(session(), true).clear();
  const selected = change === 'navigation' ? session('5:0:next') : session();
  if (change === 'navigation') harness.render(selected, true); else { revoked = true; removed.fire({ permissions: ['cookies'] }); }
  assert.equal(harness.render(selected, true).state, null);
  resolveClear({ schemaVersion: 1, type: 'cookies-clear-state', documentKey: '5:0:main', removedCount: 1, failedCount: 0, truncated: false }); await job;
  const view = harness.render(selected, true); assert.equal(view.clearResult, null); assert.equal(view.busy, false);
  assert.equal(view.state.documentKey, selected.report.documentKey);
  if (change === 'revocation') { assert.equal(view.state.permission, 'required'); assert.equal(view.state.entries.length, 0); }
  assert.equal(requests.filter(request => request.type === 'ui-clear-site-cookies').length, 1);
});

test('Cookie grant event retries a stale access revision without another permission prompt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const added = event(); let granted = false, postGrantReads = 0, prompts = 0;
  const requests = [];
  const browserApi = { runtime: { async sendMessage(request) {
    requests.push(request);
    if (!granted) return snapshot([], { permission: 'required', coverageState: 'no-access' });
    if (++postGrantReads === 1) return { schemaVersion: 1, type: 'error', code: 'stale-revision' };
    return snapshot([cookie()]);
  } }, permissions: { request() { prompts++; granted = true; added.fire({ permissions: ['cookies'] }); return Promise.resolve(true); }, onAdded: added, onRemoved: event() } };
  const harness = hookHarness(browserApi); t.after(() => harness.dispose());
  harness.render(session(), false); await tick();
  const grant = harness.render(session(), false).grant();
  assert.equal(prompts, 1, 'the click calls request before yielding');
  await grant; await tick();
  assert.equal(harness.render(session(), false).pending, true);
  t.mock.timers.tick(150); await tick();
  const state = harness.render(session(), false);
  assert.equal(state.state.trackingCount, 1); assert.equal(state.pending, false);
  assert.equal(prompts, 1); assert.equal(requests.length, 3);
  assert.ok(requests.every(request => request.documentKey === '5:0:main'));
});

test('Cookie stale revision retry stops after four attempts', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let requests = 0;
  const harness = hookHarness({ runtime: { async sendMessage() { requests++; return { schemaVersion: 1, type: 'error', code: 'stale-revision' }; } }, permissions: {} });
  t.after(() => harness.dispose());
  harness.render(session(), false); await tick();
  for (const delay of [150, 300, 600]) { t.mock.timers.tick(delay); await tick(); }
  const state = harness.render(session(), false);
  assert.equal(requests, 4); assert.equal(state.pending, false); assert.equal(state.unavailable, true); assert.equal(state.state, null);
  t.mock.timers.tick(6000); await tick(); assert.equal(requests, 4);
});

test('Cookie read does not retry other errors or error accessors', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let requests = 0, reads = 0;
  const raw = { schemaVersion: 1, type: 'error' };
  Object.defineProperty(raw, 'code', { get() { reads++; return 'stale-revision'; } });
  const harness = hookHarness({ runtime: { async sendMessage() { requests++; return requests === 1 ? { schemaVersion: 1, type: 'error', code: 'no-access' } : raw; } }, permissions: {} });
  t.after(() => harness.dispose());
  harness.render(session(), false); await tick();
  assert.equal(harness.render(session(), false).unavailable, true);
  await harness.render(session(), false).refresh();
  t.mock.timers.tick(6000); await tick();
  assert.equal(requests, 2); assert.equal(reads, 0); assert.equal(harness.render(session(), false).unavailable, true);
});

for (const change of ['navigation', 'revocation']) test('Cookie stale retry is cancelled by ' + change, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const removed = event(), requests = [];
  const browserApi = { runtime: { async sendMessage(request) {
    requests.push(request);
    if (requests.length === 1) return { schemaVersion: 1, type: 'error', code: 'stale-revision' };
    return change === 'navigation' ? snapshot([cookie()], { documentKey: request.documentKey }) : snapshot([], { permission: 'required', coverageState: 'no-access' });
  } }, permissions: { onRemoved: removed } };
  const harness = hookHarness(browserApi); t.after(() => harness.dispose());
  harness.render(session(), false); await tick();
  const selected = change === 'navigation' ? session('5:0:next') : session();
  if (change === 'navigation') harness.render(selected, false); else removed.fire({ permissions: ['cookies'] });
  await tick(); t.mock.timers.tick(6000); await tick();
  const state = harness.render(selected, false);
  assert.equal(requests.length, 2, 'the invalidated retry makes no additional request');
  assert.equal(state.pending, false);
  if (change === 'navigation') assert.equal(state.state.documentKey, '5:0:next');
  else { assert.equal(state.state.permission, 'required'); assert.equal(state.state.trackingCount, 0); }
});

test('Cookie stale retry shares one six-second response deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let requests = 0;
  const harness = hookHarness({ runtime: { sendMessage() { return ++requests === 1 ? Promise.resolve({ schemaVersion: 1, type: 'error', code: 'stale-revision' }) : new Promise(() => {}); } }, permissions: {} });
  t.after(() => harness.dispose());
  harness.render(session(), false); await tick();
  t.mock.timers.tick(150); await tick(); assert.equal(requests, 2);
  t.mock.timers.tick(5849); await tick(); assert.equal(harness.render(session(), false).pending, true);
  t.mock.timers.tick(1); await tick();
  const state = harness.render(session(), false);
  assert.equal(state.pending, false); assert.equal(state.unavailable, true); assert.equal(state.state, null); assert.equal(requests, 2);
});

test('Tag Manager report retains source, target, phase-independent observations and canonical evidence', () => {
  const row = { source: 'google-tag-manager', target: 'hotjar', count: 2, attributionConfidence: 'sampled-stack', evidenceSource: 'page-hook', integrity: 'page-controlled' };
  const page = { url: 'https://example.test/page', tagManager: [{ documentKey: '5:0:main', rows: [row], truncated: false }] };
  const rendered = expand(ui.ProTagManagerSection({ pages: [page] }));
  assert.match(visibleText(rendered), /Google Tag Manager/);
  assert.match(visibleText(rendered), /Hotjar/);
  assert.ok(visibleText(rendered).includes(translate('attribution_sampled_stack')));
  assert.ok(visibleText(rendered).includes(translate('integrity_page_controlled')));
  assert.equal(nodes(rendered, node => node.type === 'tbody')[0].props.children.length, 1);
  const invalid = { ...page, tagManager: [{ documentKey: '5:0:main', rows: [{ ...row, url: 'https://example.test/?credential=CREDENTIAL_CANARY' }], truncated: false }] };
  const rejected = visibleText(expand(ui.ProTagManagerSection({ pages: [invalid] })));
  assert.equal(rejected, '');
  assert.doesNotMatch(rejected, /CREDENTIAL_CANARY|credential=/);
});

test('Tag Manager displays every admitted row without a second rendering cap and preserves capture gaps', () => {
  const row = { source: 'google-tag-manager', target: 'facebook-pixel', count: 1, attributionConfidence: 'exact-resource', evidenceSource: 'page-hook', integrity: 'page-controlled' };
  const targets = ['google-analytics', 'google-ads', 'facebook-pixel', 'hotjar', 'criteo', 'microsoft-clarity', 'tiktok-pixel', 'linkedin-insight', 'bing-uet'];
  const rows = targets.flatMap(target => ['exact-resource', 'sampled-stack'].map(attributionConfidence => ({ ...row, target, attributionConfidence })));
  const page = { url: 'https://example.test/', tagManager: Array.from({ length: 16 }, (_, index) => ({ documentKey: '5:' + index + ':document', rows: rows.map(item => ({ ...item })), truncated: false })) };
  const rendered = expand(ui.ProTagManagerSection({ pages: [page] }));
  assert.equal(nodes(rendered, node => node.type === 'tbody').reduce((total, node) => total + node.props.children.length, 0), 288);
  assert.doesNotMatch(visibleText(rendered), /Tag Manager observations are incomplete/);
  const inputLimited = expand(ui.ProTagManagerSection({ pages: [{ ...page, tagManager: [{ documentKey: '5:0:main', rows: [row], truncated: true }] }] }));
  assert.match(visibleText(inputLimited), /Tag Manager observations are incomplete/);
});

test('Tag Manager summary names each admitted service once per page across documents and confidence rows', () => {
  const row = target => ({ source: 'google-tag-manager', target, count: 1, attributionConfidence: 'exact-resource', evidenceSource: 'page-hook', integrity: 'page-controlled' });
  const pages = [
    { url: 'https://example.test/first', tagManager: [
      { documentKey: '5:0:main', rows: [row('facebook-pixel'), row('hotjar'), { ...row('hotjar'), attributionConfidence: 'sampled-stack' }], truncated: false },
      { documentKey: '5:1:child', rows: [row('criteo')], truncated: false }
    ] },
    { url: 'https://example.test/next', tagManager: [{ documentKey: '5:0:next', rows: [row('google-analytics')], truncated: false }] },
    { url: 'https://example.test/rejected', tagManager: [{ documentKey: '5:0:rejected', rows: [{ ...row('hotjar'), url: 'https://example.test/?token=SUMMARY_CANARY' }], truncated: false }] }
  ];
  const summaries = nodes(expand(ui.ProTagManagerSection({ pages })), node => node.props['data-tag-manager-summary']);
  assert.equal(summaries.length, 2);
  const first = visibleText(summaries[0]), next = visibleText(summaries[1]);
  assert.match(first, /Google Tag Manager initiated loading: Facebook Pixel, Hotjar, Criteo/);
  assert.equal(first.match(/Hotjar/g)?.length, 1);
  assert.match(next, /Google Analytics/); assert.doesNotMatch(next, /Hotjar|Criteo|Facebook/);
  assert.doesNotMatch(first + next, /SUMMARY_CANARY|token=|\$SERVICES\$/);
});

test('all 21 UI languages define exactly the same identification, Cookie and GTM keys with count placeholders', () => {
  const reference = applyIdentificationCopy({}, 'en');
  assert.equal(Object.keys(reference).length, 83);
  for (const language of PRODUCTION_LANGUAGES) {
    const sentinel = { message: 'unchanged' }, table = applyIdentificationCopy({ sentinel }, language.id);
    assert.equal(table.sentinel, sentinel);
    assert.deepEqual(Object.keys(table).filter(key => key !== 'sentinel').sort(), Object.keys(reference).sort(), language.id);
    for (const [key, entry] of Object.entries(reference)) {
      assert.ok(table[key].message.trim(), `${language.id}:${key}`);
      assert.equal(/[\uFFFD\uE000-\uE00F]/u.test(table[key].message), false);
      assert.deepEqual(table[key].placeholders, entry.placeholders, `${language.id}:${key}`);
    }
    assert.ok(table.identification_third_party.message.trim());
    if (language.id === 'en') assert.equal(table.identification_third_party.message, 'Third Party Surveillance');
    else assert.notEqual(table.identification_third_party.message, 'Third Party Surveillance');
    assert.equal(table.identification_cookie.message, 'Cookie');
  }
  assert.throws(() => applyIdentificationCopy({}, '__proto__'), /unknown locale/);
});

test('both shared Preact inspector bundles keep identification and Pro without the removed document/coverage block', () => {
  for (const name of ['popup.js', 'sidepanel.js']) {
    const source = readFileSync(new URL('../../apps/production-extension/' + name, import.meta.url), 'utf8');
    const inspector = source.slice(source.indexOf('function InspectorView('), source.indexOf('// packages/ui/src/components/DataConsent', source.indexOf('function InspectorView(')));
    for (const panel of ['active', 'passive', 'third-party', 'cookie']) assert.ok(inspector.includes('id: panelId(identificationPrefix, "' + panel + '")'));
    assert.equal(inspector.includes('u3(CoverageBox,'), false);
    assert.equal(inspector.includes('u3(FramePicker,'), false);
    assert.equal(inspector.includes('t3("api_results_truncated")'), false);
    assert.ok(inspector.includes('u3(ProModeView,'));
    assert.ok(inspector.includes('frame.frameId > 0'));
    assert.ok(inspector.includes('setIdentificationPanel("passive"), setExpanded'));
  }
});
