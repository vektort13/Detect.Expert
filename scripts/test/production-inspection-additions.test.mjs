import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createIdentificationUi } from '../../apps/production-extension/identification-ui.js';
import { readCookieSnapshot, readSocialRows, readSocialSnapshot, readSocialDocuments } from '../../packages/contracts/src/inspection.mjs';
import { applyIdentificationCopy } from '../production-locales-identification.mjs';
import { applyCookieReportCopy, COOKIE_REPORT_KEYS } from '../production-locales-cookie-report.mjs';
import { applyCookiePurposeCopy } from '../production-locales-cookie-purposes.mjs';
import { applySocialCopy, SOCIAL_COPY_KEYS } from '../production-locales-social.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { COOKIE_PURPOSE_TRANSLATION_KEYS } from '../../apps/production-extension/cookie-purpose-localization.js';

const h = (type, props) => ({ type, props });
const localeTable = locale => applySocialCopy(applyCookiePurposeCopy(applyCookieReportCopy(applyIdentificationCopy(
  JSON.parse(readFileSync(new URL('../../apps/production-extension/' + (PRODUCTION_LANGUAGES.find(language => language.id === locale).uiOnly ? 'ui-locales' : '_locales') + '/' + locale + '/messages.json', import.meta.url), 'utf8')), locale), locale), locale), locale);
const translator = table => (key, substitutions = []) => {
  let output = table[key]?.message ?? key;
  for (const [name, placeholder] of Object.entries(table[key]?.placeholders ?? {})) output = output.replaceAll('$' + name.toUpperCase() + '$', substitutions[Number(placeholder.content.slice(1)) - 1] ?? '');
  return output;
};
const english = localeTable('en'), translate = translator(english);
const uiFor = (locale = 'en') => createIdentificationUi({ h, useState() {}, useEffect() {}, useRef() {}, useLocale: () => locale, translate: translator(localeTable(locale)) });
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
const cookie = changes => ({ name: '_ga_*', domain: 'example.test', hostOnly: true, secure: true, httpOnly: false,
  session: false, sameSite: 'lax', expirationDate: 2000000000, partitioned: false, tracking: true, category: 'analytics',
  owner: 'Public research provider', purpose: 'A documented public description.', confidence: 'community', ruleIds: ['review:cookie'], sourceUrls: ['https://docs.example.test/public-cookie'], ...changes });
const cookies = (entries = [], changes = {}) => ({ schemaVersion: 1, type: 'cookies-state', documentKey: '42:0:review', coverageState: 'active', permission: 'granted',
  trackingCount: entries.filter(entry => entry.tracking).length, entries, truncated: false, observedAt: 1800000000000, sessionBinding: { status: 'not-observed', headers: [] }, ...changes });
const socialRow = changes => ({ service: 'facebook', kind: 'tracking-pixel', endpoint: 'pixel', method: 'GET', requestType: 'image', count: 200,
  evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'frame-only', initiatorHost: 'example.test', script: null, ...changes });
const social = (rows = [], changes = {}) => ({ schemaVersion: 1, type: 'social-networks-state', documentKey: '42:0:review', coverageState: 'active', rows, truncated: false, ...changes });

test('independent report review: all 256 admitted cookies remain table rows, including identical masked names', () => {
  const rules = Array.from({ length: 8 }, (_, index) => 'review:rule-' + index);
  const sources = Array.from({ length: 8 }, (_, index) => 'https://docs.example.test/source-' + index);
  const entries = Array.from({ length: 256 }, (_, index) => cookie({ name: '_ga_*', purpose: 'Public purpose ' + index, ruleIds: rules, sourceUrls: sources, httpOnly: index % 2 === 0 }));
  const report = expand(uiFor().ProCookieSnapshot({ snapshot: cookies(entries, { totalCount: 256 }) }));
  const rows = nodes(report, node => node.props['data-cookie-report-row'] !== undefined);
  assert.equal(rows.length, 256);
  assert.deepEqual(rows.map(node => node.props['data-cookie-report-row']), Array.from({ length: 256 }, (_, index) => index));
  assert.equal(nodes(report, node => node.type === 'table').length, 1);
  assert.equal(nodes(report, node => node.type === 'details').length, 0);
  for (const [index, row] of rows.entries()) {
    const text = visibleText(row);
    assert.ok(text.includes('Public purpose ' + index));
    for (const rule of rules) assert.ok(text.includes(rule));
    assert.deepEqual(nodes(row, node => node.type === 'a').map(node => node.props.href), sources);
    assert.equal(nodes(row, node => node.type === 'a').every(node => node.props.rel === 'noreferrer noopener'), true);
    assert.equal(nodes(row, node => node.props.class === 'cookie-report-analysis').length, 0, 'attributes are stated once as compact facts');
    assert.ok(text.includes('HttpOnly=' + (index % 2 === 0 ? 'Yes' : 'No')));
  }
  assert.ok(visibleText(report).includes('All cookies: 256'));
  assert.equal(uiFor().ProCookieSnapshot({ snapshot: cookies([...entries, cookie()]) }), null);
});

test('independent report review: bounded unknown inventory stays visible with factual explanations and a lower-bound total', () => {
  const entry = cookie({ owner: '', purpose: '', tracking: false, category: 'unknown', confidence: 'unknown', hostOnly: false, secure: false, httpOnly: true, session: true, sameSite: 'unspecified', ruleIds: [], sourceUrls: [] });
  const report = expand(uiFor().ProCookieSnapshot({ snapshot: cookies([entry], { totalCount: 4096, truncated: true, coverageState: 'partial' }) }));
  assert.ok(visibleText(report).includes('Shown cookies: 1 of ≥4096'));
  for (const key of ['cookie_company_unknown', 'cookie_analysis_unknown', 'cookie_scope_domain', 'cookie_session']) assert.ok(visibleText(report).includes(translate(key)));
  for (const value of ['Secure=No', 'HttpOnly=Yes', 'SameSite=unspecified']) assert.ok(visibleText(report).includes(value));
  assert.equal(nodes(report, node => node.type === 'details' || node.props.dangerouslySetInnerHTML !== undefined).length, 0);
});

for (const ancestor of [true, false, undefined]) test('independent report review: cross-site ancestor state is explicit: ' + String(ancestor), () => {
  const entry = cookie({ partitioned: true, ...(ancestor === undefined ? {} : { hasCrossSiteAncestor: ancestor }) });
  const report = expand(uiFor().ProCookieSnapshot({ snapshot: cookies([entry]) }));
  const expected = ancestor === undefined ? 'cookie_ancestor_unreported' : ancestor ? 'cookie_cross_site_ancestor' : 'cookie_no_cross_site_ancestor';
  assert.equal(visibleText(report).includes(translate(expected)), ancestor !== undefined, 'known ancestor facts remain explicit; an absent field adds no repeated placeholder');
});


test('independent report review: cookie values, handles, raw identities and TPM assertions are rejected before rendering', () => {
  let reads = 0;
  for (const field of ['value', 'handle', 'path', 'storeId', 'partitionKey', 'tpmProtected', 'cannotExport']) {
    const row = cookie(); Object.defineProperty(row, field, { enumerable: true, get() { ++reads; throw Error('private getter'); } });
    assert.equal(readCookieSnapshot(cookies([row])), null);
    assert.equal(uiFor().ProCookieSnapshot({ snapshot: cookies([row]) }), null);
  }
  for (const extras of [{ handles: ['a'.repeat(32)] }, { value: 'PRIVATE_COOKIE_VALUE' }, { sessionId: 'PRIVATE_SESSION_ID' }]) assert.equal(uiFor().ProCookieSnapshot({ snapshot: { ...cookies([cookie()]), ...extras } }), null);
  for (const changes of [{ hasCrossSiteAncestor: 'yes' }, { purpose: 'x'.repeat(1201) }, { sourceUrls: ['javascript:alert(1)'] }, { sourceUrls: ['https://user:password@example.test/docs'] }, { ruleIds: Array.from({ length: 9 }, (_, i) => 'rule' + i) }]) assert.equal(readCookieSnapshot(cookies([cookie(changes)])), null);
  assert.equal(reads, 0);
});

for (const { id } of PRODUCTION_LANGUAGES) test('independent localization review: complete report and structured purpose copy for ' + id, () => {
  const table = localeTable(id), t = translator(table), ui = uiFor(id);
  assert.equal(COOKIE_REPORT_KEYS.length, 15); assert.equal(COOKIE_PURPOSE_TRANSLATION_KEYS.length, 21); assert.equal(SOCIAL_COPY_KEYS.length, 23);
  for (const key of [...COOKIE_REPORT_KEYS, ...COOKIE_PURPOSE_TRANSLATION_KEYS, ...SOCIAL_COPY_KEYS]) assert.ok(table[key]?.message);
  const vocabulary = [
    ['device storage and access', 'cookie_purpose_storage'], ['basic advertising', 'cookie_purpose_basic_advertising'],
    ['advertising profile creation', 'cookie_purpose_advertising_profile'], ['personalised advertising', 'cookie_purpose_personalised_advertising'],
    ['content profile creation', 'cookie_purpose_content_profile'], ['personalised content', 'cookie_purpose_personalised_content'],
    ['advertising measurement', 'cookie_purpose_advertising_measurement'], ['content measurement', 'cookie_purpose_content_measurement'],
    ['audience research', 'cookie_purpose_audience_research'], ['service development', 'cookie_purpose_service_development'],
    ['basic content selection', 'cookie_purpose_basic_content'], ['security and fraud prevention', 'cookie_purpose_security'],
    ['ad/content delivery', 'cookie_purpose_delivery'], ['privacy choices', 'cookie_purpose_privacy_choices'],
  ];
  const fixed = [
    ['Vendor-declared cookie storing a choice to opt out of tracking.', 'cookie_purpose_opt_out'],
    ['The vendor declares this cookie and domain without TCF purpose IDs.', 'cookie_purpose_without_ids'],
    ['CookieBlock lists this name as an exception to automated blocking; the exception does not establish its purpose or producer.', 'cookie_purpose_cookieblock_exception'],
  ];
  const declared = 'Vendor-declared purposes: ' + vocabulary.map(([term]) => term).join('; ') + '.';
  const original = 'A manufacturer-specific description preserved as published.';
  const reference = 'Catalogue name match: Research Provider — Vendor-declared purposes: security and fraud prevention.';
  const entries = [cookie({ owner: 'Vendor declaration: Public Provider', purpose: declared }), cookie({ purpose: original }), cookie({ owner: '', category: 'unknown', tracking: false, confidence: 'ambiguous', purpose: reference }),
    ...fixed.map(([purpose]) => cookie({ purpose }))];
  const report = expand(ui.ProCookieSnapshot({ snapshot: cookies(entries) }));
  const text = visibleText(report);
  const translatedPurpose = t('cookie_purpose_declared', [vocabulary.map(([, key]) => t(key)).join('; ')]);
  assert.ok(text.includes(translatedPurpose));
  assert.ok(text.includes(t('cookie_vendor_declaration', ['Public Provider'])));
  assert.ok(text.includes(original));
  assert.ok(text.includes('Research Provider — ' + t('cookie_purpose_declared', [t('cookie_purpose_security')])));
  for (const [, key] of fixed) assert.ok(text.includes(t(key)));
  for (const key of ['cookie_report_identity', 'cookie_report_explanation', 'cookie_report_properties']) assert.ok(text.includes(t(key)));
  assert.equal(text.includes('$PURPOSES$'), false);
  const referenceNodes = nodes(report, node => node.props['data-cookie-name-reference']);
  assert.equal(referenceNodes.length, 1);
  assert.equal(referenceNodes[0].props.children.startsWith('Catalogue name match: '), false);
  assert.equal(nodes(report, node => node.type === 'details').length, 0);
});

test('independent social review: all 64 rows per document and 256 rows across four documents are rendered', () => {
  const rows = Array.from({ length: 64 }, (_, count) => socialRow({ count: count + 1 }));
  const documents = Array.from({ length: 4 }, (_, i) => social(rows, { documentKey: '42:' + i + ':doc-' + i }));
  assert.ok(readSocialDocuments(documents));
  const report = expand(uiFor().ProSocialSnapshot({ snapshots: documents }));
  assert.equal(nodes(report, node => node.props['data-social-row'] !== undefined).length, 256);
  assert.equal(nodes(report, node => node.props['data-social-table']).length, 1);
  assert.equal(readSocialRows([...rows, socialRow()]), null);
  assert.equal(readSocialDocuments([...documents, social([socialRow()], { documentKey: '42:4:overflow' })]), null);
  assert.equal(uiFor().ProSocialSnapshot({ snapshots: [...documents, social([socialRow()], { documentKey: '42:4:overflow' })] }), null);
  const empty24 = Array.from({ length: 24 }, (_, i) => social([], { documentKey: '42:' + i + ':empty-' + i }));
  assert.ok(readSocialDocuments(empty24));
  assert.equal(uiFor().ProSocialSnapshot({ snapshots: empty24 }), null);
  assert.equal(readSocialDocuments([...empty24, social([], { documentKey: '42:24:overflow' })]), null);
});

test('independent social review: unique known services determine the fifth badge, rather than requests or unknown rows', () => {
  const rows = [socialRow(), socialRow({ count: 2147483647, kind: 'sdk-load', endpoint: 'sdk' }), socialRow({ service: 'youtube', kind: 'embedded-content', endpoint: 'embed' }),
    socialRow({ service: 'unknown', kind: 'fedcm-call', endpoint: 'fedcm', requestType: 'other', evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'unknown', initiatorHost: null })];
  const state = readSocialSnapshot(social(rows)); assert.ok(state);
  const ui = uiFor();
  const navigation = ui.IdentificationNavigation({ prefix: 'review', active: 'social', onSelect() {}, counts: { active: 0, passive: 0, 'third-party': 0 }, cookieState: cookies([cookie(), cookie()]), socialState: state });
  const tabs = nodes(navigation, node => node.props.role === 'tab');
  assert.deepEqual(tabs.map(node => node.props['data-identification-tab']), ['active', 'passive', 'third-party', 'cookie', 'social', 'beacons', 'background']);
  assert.equal(nodes(tabs[4], node => node.props['data-identification-count'] === 'social')[0].props.children, 2);
  assert.equal(nodes(tabs[3], node => node.props['data-identification-count'] === 'cookie')[0].props.children, 2);
  const panel = expand(ui.SocialPanel({ social: { state, pending: false, refresh() {} } }));
  assert.ok(visibleText(panel).includes('Detected social services: 2'));
  assert.equal(nodes(panel, node => node.props['data-social-row'] !== undefined).length, 4);
  const unknownRow = nodes(panel, node => node.props['data-social-row'] === 3)[0];
  assert.equal(visibleText(nodes(unknownRow, node => node.type === 'strong')[0]).trim(), translate('cookie_confidence_unknown'));
  assert.equal(nodes(unknownRow, node => node.props['data-company-logo'] !== undefined).length, 0);
  assert.equal(visibleText(panel).includes('2147483647'), true);
});

test('independent social review: provenance, accessor, raw account and script payload attacks are rejected', () => {
  let reads = 0;
  for (const changes of [{ evidenceSource: 'page-hook' }, { integrity: 'page-controlled' }, { attributionConfidence: 'exact-resource' }, { count: 0 }, { count: 2147483648 }, { service: 'arbitrary' },
    { loggedIn: true }, { accountId: 'PRIVATE_ID' }, { url: 'https://facebook.com/path?token=PRIVATE' }, { stack: 'RAW_STACK' }, { body: 'PRIVATE_BODY' }, { initiatorHost: 'https://example.test/private' },
    { script: { host: 'example.test', pathTemplate: '/main.js' } }]) assert.equal(readSocialRows([socialRow(changes)]), null);
  const page = socialRow({ kind: 'possible-login-probe', endpoint: 'login-status', requestType: 'xmlhttprequest', evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'sampled-stack', script: { host: 'assets.example.test', pathTemplate: '/<script>' } });
  assert.ok(readSocialRows([page]));
  assert.equal(readSocialRows([{ ...page, script: { ...page.script, pathTemplate: '/user/123/private.js?token=PRIVATE' } }]), null);
  assert.equal(readSocialRows([{ ...page, script: { ...page.script, url: 'https://example.test/private' } }]), null);
  for (const field of Object.keys(page)) {
    const row = { ...page }; Object.defineProperty(row, field, { enumerable: true, get() { ++reads; throw Error('untrusted getter'); } });
    assert.equal(readSocialRows([row]), null);
  }
  assert.equal(reads, 0);
  assert.equal(readSocialDocuments([social([page]), social([page])]), null);
  for (const coverageState of ['paused', 'unsupported', 'no-access']) assert.equal(readSocialSnapshot(social([page], { coverageState })), null);
});


const tick = async () => { for (let i = 0; i < 12; ++i) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const nativeEvent = () => { const listeners = new Set(); return { listeners, addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener), fire: value => { for (const listener of listeners) listener(value); } }; };
function browserMock(sendMessage) {
  return { runtime: { sendMessage }, permissions: { onAdded: nativeEvent(), onRemoved: nativeEvent() } };
}
function hookHarness(browserApi, method) {
  const slots = []; let cursor = 0, effects = [];
  const api = createIdentificationUi({ h, translate, useLocale: () => 'en', browserApi,
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: initial }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(effect, dependencies) { const index = cursor++, slot = slots[index] ??= {}; if (!slot.dependencies || dependencies.some((value, i) => value !== slot.dependencies[i])) effects.push(() => { slot.cleanup?.(); slot.dependencies = dependencies; slot.cleanup = effect(); }); }
  });
  return { render(session, argument) { cursor = 0; let result = api[method](session, argument); const work = effects; effects = []; work.forEach(effect => effect()); cursor = 0; return api[method](session, argument); }, dispose() { slots.forEach(slot => slot.cleanup?.()); } };
}
const session = (documentKey = '42:0:review', coverageState = 'active') => ({ loaded: true, busy: false, tabId: 42, selectedFrameId: 0, report: { documentKey, observedSince: 1, coverageState } });

for (const method of ['useSocial']) test('independent hook review: stale ' + method + ' replies cannot cross navigation or unmount', async t => {
  const late = deferred(), calls = [], browser = browserMock(request => { calls.push(request); return late.promise; });
  const hook = hookHarness(browser, method), arg = true;
  t.after(() => hook.dispose());
  hook.render(session(), arg);
  hook.render(session('42:0:next'), arg);
  late.resolve(social([socialRow()]));
  await tick();
  const state = hook.render(session('42:0:next'), arg);
  assert.equal(state.state, null);
  assert.equal(calls.length, 1);
  hook.dispose();
  assert.equal(browser.permissions.onRemoved.listeners.size, 0);
  assert.equal(browser.permissions.onAdded.listeners.size, 0);
});

for (const method of ['useSocial']) test('independent hook review: permission revocation drops a pending ' + method + ' reply immediately', async t => {
  const late = deferred(), browser = browserMock(() => late.promise), hook = hookHarness(browser, method);
  const arg = true;
  t.after(() => hook.dispose());
  hook.render(session(), arg);
  browser.permissions.onRemoved.fire({ permissions: ['cookies'], origins: [] });
  late.resolve(social([socialRow()]));
  await tick();
  const current = hook.render(session(), arg);
  assert.equal(current.state, null);
  assert.equal(current.pending, false);
});


