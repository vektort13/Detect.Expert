// ADR-028: admitted Social observations stay complete, source-specific and localized.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createIdentificationUi } from '../../apps/production-extension/identification-ui.js';
import { SOCIAL_SERVICES, SOCIAL_KINDS, readSocialDocuments } from '../../packages/contracts/src/inspection.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { applySocialCopy } from '../production-locales-social.mjs';
import { applySocialTrackingCopy, SOCIAL_TRACKING_KEYS } from '../production-locales-social-tracking.mjs';
import { applyProReportCopy } from '../production-locales-report.mjs';

const h = (type, props) => ({ type, props });
const tableFor = locale => {
  const { uiOnly } = PRODUCTION_LANGUAGES.find(language => language.id === locale);
  const table = JSON.parse(readFileSync(new URL('../../apps/production-extension/' + (uiOnly ? 'ui-locales' : '_locales') + '/' + locale + '/messages.json', import.meta.url), 'utf8'));
  return applyProReportCopy(applySocialTrackingCopy(applySocialCopy(table, locale), locale), locale);
};
const translator = table => (key, substitutions = []) => {
  const entry = table[key]; let output = entry?.message ?? key;
  for (const [name, placeholder] of Object.entries(entry?.placeholders ?? {})) output = output.replaceAll('$' + name.toUpperCase() + '$', substitutions[Number(placeholder.content.slice(1)) - 1] ?? '');
  return output;
};
const uiFor = (locale = 'en') => createIdentificationUi({ h, useState() {}, useEffect() {}, useRef() {}, useLocale: () => locale, translate: translator(tableFor(locale)) });
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
const row = changes => ({ service: 'facebook', kind: 'tracking-sdk', endpoint: 'sdk', method: 'GET', requestType: 'script', count: 1,
  evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'frame-only', initiatorHost: 'example.test', script: null, ...changes });
const pageRow = changes => row({ evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'sampled-stack',
  script: { host: 'assets.example.test', pathTemplate: '/gtm.js' }, ...changes });
const state = (rows = [], changes = {}) => ({ schemaVersion: 1, type: 'social-networks-state', documentKey: '42:0:ui-social', coverageState: 'active', rows, truncated: false, ...changes });
const reportFor = (documents, locale = 'en') => expand(uiFor(locale).ProSocialSnapshot({ snapshots: documents }));
const reportRows = report => nodes(report, node => node.props['data-social-row'] !== undefined);
const markedText = (report, attribute) => visibleText(nodes(report, node => node.props[attribute])[0]);
const endpoints = ['service', 'sdk', 'pixel', 'embed', 'login', 'oauth', 'fedcm', 'login-status'];
const resourceTypes = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'];
const methods = ['GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'UNKNOWN'];

test('Pro Social keeps one table with owning document hosts and omits empty document blocks', () => {
  const documents = [state([], { documentKey: '42:0:empty' }), state([row(), pageRow()], { documentKey: '42:1:child' })];
  const report = expand(uiFor().ProSocialSnapshot({ snapshots: documents, page: { reports: [{ documentKey: '42:1:child', host: 'checkout.example.test' }] } }));
  assert.equal(nodes(report, node => node.props['data-social-table']).length, 1);
  assert.equal(reportRows(report).length, 2);
  assert.equal(nodes(report, node => node.type === 'h5').length, 0);
  assert.equal(visibleText(report).match(/checkout\.example\.test/g)?.length, 2);
  assert.equal(nodes(report, node => node.props['data-company-logo']).length, 2);
  assert.equal(uiFor().ProSocialSnapshot({ snapshots: [state([])] }), null);
});

test('Social UI retains every one of 256 rows across 24 admitted documents without additional caps or deduplication', () => {
  const documents = Array.from({ length: 24 }, (_, document) => state(Array.from({ length: document === 23 ? 26 : 10 }, (_, index) =>
    row({ count: document * 26 + index + 1, kind: SOCIAL_KINDS[(document + index) % SOCIAL_KINDS.length] })), { documentKey: '42:' + document + ':report-' + document }));
  assert.ok(readSocialDocuments(documents));
  const report = reportFor(documents), admitted = reportRows(report);
  assert.equal(admitted.length, 256);
  assert.equal(new Set(admitted.map(node => node.props['data-social-pro-document'])).size, 24);
  assert.equal(nodes(report, node => node.props['data-social-table']).length, 1);
  assert.equal(nodes(report, node => node.type === 'details').length, 0);
  assert.deepEqual(admitted.map(node => Number(visibleText(nodes(node, child => child.props['data-social-count-source'])[0]).split(': ')[1])), documents.flatMap(document => document.rows.map(item => item.count)));
  const overflow = documents.map(document => ({ ...document, rows: [...document.rows] })); overflow[0].rows.push(row());
  assert.equal(uiFor().ProSocialSnapshot({ snapshots: overflow }), null);
  assert.equal(uiFor().ProSocialSnapshot({ snapshots: [...documents, state([], { documentKey: '42:24:overflow' })] }), null);
  assert.equal(uiFor().ProSocialSnapshot({ snapshots: [state(Array.from({ length: 65 }, () => row()))] }), null);
});

test('Social UI labels all 45 approved providers by their proper names', () => {
  const names = ['Facebook', 'Instagram', 'X', 'LinkedIn', 'TikTok', 'Snapchat', 'Pinterest', 'Reddit', 'Discord', 'Twitch', 'YouTube', 'GitHub', 'GitLab', 'VK', 'OK', 'Weibo', 'QQ', 'Telegram', 'LINE', 'Google', 'Microsoft', 'Apple', 'Spotify', 'Steam', 'Yahoo', 'Tumblr', 'Quora', 'Disqus', 'Yandex', 'Mail.ru', 'Kakao', 'NAVER', 'Baidu', 'Bluesky', 'ShareThis', 'Douyin', 'WeChat', 'Mastodon', 'AddThis', 'WhatsApp', 'Viber', 'Threads', 'Vimeo', 'Dailymotion', 'SoundCloud'];
  assert.equal(SOCIAL_SERVICES.length, 46);
  const report = reportFor([state(SOCIAL_SERVICES.filter(service => service !== 'unknown').map(service => row({ service, kind: 'service-request', endpoint: 'service' })))]);
  const rendered = reportRows(report);
  assert.equal(rendered.length, 45);
  assert.deepEqual(rendered.map(item => visibleText(nodes(item, node => node.type === 'strong')[0]).trim()), names);
  for (const item of rendered) {
    const images = nodes(item, node => node.type === 'img' && node.props['data-company-logo']);
    assert.equal(images.length, 1, 'Every approved provider has one actual company image');
    assert.equal(images[0].props.width, 20);
    assert.equal(images[0].props.height, 20);
    assert.equal(images[0].props.alt, '');
    assert.equal(nodes(item, node => node.props['data-company-role'] === 'company').length, 1);
  }
  assert.equal(markedText(report, 'data-social-pro-services'), 'Detected social services: 45');
  assert.equal(nodes(report, node => node.props['data-social-pro-tracking-services']).length, 0);
});

test('Social totals deduplicate providers across documents and sources while preserving all admitted observations', () => {
  const documents = [state([
    row({ count: 2147483647 }), pageRow({ count: 7 }), row({ kind: 'tracking-pixel', endpoint: 'pixel', requestType: 'image', count: 3 }),
    row({ service: 'youtube', kind: 'embedded-content', endpoint: 'embed' }), row({ service: 'unknown', kind: 'tracking-pixel', endpoint: 'pixel' })
  ]), state([
    row({ service: 'facebook', kind: 'authentication-navigation', endpoint: 'login', requestType: 'main_frame' }),
    row({ service: 'tiktok', kind: 'tracking-sdk', count: 42 }), row({ service: 'tiktok', kind: 'sdk-load' })
  ], { documentKey: '42:1:second' })];
  const report = reportFor(documents);
  assert.equal(markedText(report, 'data-social-pro-services'), 'Detected social services: 3');
  assert.equal(markedText(report, 'data-social-pro-tracking-services'), 'Observed tracking services: 2');
  assert.equal(reportRows(report).length, 8);
  assert.equal(visibleText(report).includes('2147483647'), true);
  assert.equal(visibleText(report).includes('2147483693'), false);
  assert.equal(reportRows(report).filter(item => item.props['data-social-tracking'] === 'true').length, 5);
  const navigation = uiFor().IdentificationNavigation({ prefix: 'tracking', active: 'social', onSelect() {}, counts: { active: 0, passive: 0, 'third-party': 0 }, cookieState: null, socialState: documents[0] });
  assert.equal(nodes(navigation, node => node.props['data-identification-count'] === 'social')[0].props.children, 2);
});

test('Tracking SDK and pixel emphasis does not promote ordinary SDK, embed or authentication activity to tracking', () => {
  const report = reportFor([state(SOCIAL_KINDS.map(kind => row({ kind })))]);
  const rendered = reportRows(report);
  for (const item of rendered) {
    const kind = item.props['data-social-kind'], expected = kind === 'tracking-sdk' || kind === 'tracking-pixel';
    assert.equal(item.props['data-social-tracking'], String(expected));
    assert.equal(nodes(item, node => node.props.class?.split(' ').includes('social-kind--tracking')).length, expected ? 1 : 0);
    assert.equal(visibleText(item).includes('social_kind_'), false);
  }
  assert.deepEqual(rendered.filter(item => item.props['data-social-tracking'] === 'true').map(item => item.props['data-social-kind']), ['tracking-sdk', 'tracking-pixel']);
});

test('Browser attempts and page actions have distinct labels and preserve source, initiator and script evidence', () => {
  const report = reportFor([state([
    row({ count: 11, method: 'POST', requestType: 'ping' }),
    pageRow({ count: 9, method: 'POST', requestType: 'xmlhttprequest' }),
    pageRow({ kind: 'possible-login-probe', endpoint: 'login-status', attributionConfidence: 'unknown', script: null, method: 'UNKNOWN' })
  ])]);
  const [browser, page, possible] = reportRows(report);
  assert.equal(visibleText(nodes(browser, node => node.props['data-social-count-source'])[0]), 'Prepared requests: 11');
  assert.equal(visibleText(nodes(page, node => node.props['data-social-count-source'])[0]), 'Page actions: 9');
  assert.equal(nodes(browser, node => node.props['data-social-script']).length, 0);
  assert.equal(visibleText(browser).includes('Script not captured'), false);
  assert.equal(visibleText(browser).includes('example.test'), true);
  assert.equal(visibleText(page).includes('assets.example.test/gtm.js'), true);
  assert.equal(nodes(page, node => node.props['data-social-script'])[0].props.dir, 'ltr');
  assert.equal(visibleText(possible).includes('Not reported'), true);
  assert.equal(visibleText(possible).includes(translator(tableFor('en'))('social_kind_possible_login_probe')), true);
  assert.equal(/possible/i.test(visibleText(possible)), true);
  assert.equal(/received|delivered|completed|logged.in|account.present|browsing.history/i.test(visibleText(report)), false);
});

test('Social report retains one capture gap, omits empty document blocks and has no empty section', () => {
  const report = reportFor([state([row()], { coverageState: 'partial', truncated: true }), state([], { documentKey: '42:1:empty', coverageState: 'unsupported' })]);
  const t = translator(tableFor('en'));
  assert.equal(reportRows(report).length, 1);
  assert.equal(visibleText(report).includes(t('report_data_limited')), true);
  assert.equal(visibleText(report).includes(t('social_limit')), false);
  assert.equal(nodes(report, node => node.props['data-social-pro-truncated']).length, 1);
  for (const key of ['status_partial', 'status_unsupported', 'social_empty']) assert.equal(visibleText(report).includes(t(key)), false);
  const empty = reportFor([]);
  assert.equal(empty, null);
  for (const coverageState of ['paused', 'unsupported', 'no-access']) assert.equal(uiFor().ProSocialSnapshot({ snapshots: [state([row()], { coverageState })] }), null);
});

test('No private payload, account claim, spoofed provenance or untrusted accessor reaches the Social report', () => {
  let reads = 0;
  for (const field of ['url', 'query', 'body', 'responseBody', 'stack', 'accountId', 'emailHash', 'loggedIn', 'outcome']) {
    const item = row(); Object.defineProperty(item, field, { enumerable: true, get() { ++reads; throw Error('private getter'); } });
    assert.equal(uiFor().ProSocialSnapshot({ snapshots: [state([item])] }), null);
  }
  for (const changes of [{ service: 'fabricated' }, { evidenceSource: 'derived' }, { integrity: 'page-controlled' }, { attributionConfidence: 'exact-resource' },
    { script: { host: 'example.test', pathTemplate: '/sdk.js' } }, { initiatorHost: 'https://example.test/path?secret=CANARY' }]) assert.equal(uiFor().ProSocialSnapshot({ snapshots: [state([row(changes)])] }), null);
  for (const changes of [{ integrity: 'browser-observed' }, { script: { host: 'assets.example.test', pathTemplate: '/user/123.js?token=CANARY' } },
    { script: { host: 'assets.example.test', pathTemplate: '/sdk.js', url: 'https://example.test/?token=CANARY' } }]) assert.equal(uiFor().ProSocialSnapshot({ snapshots: [state([pageRow(changes)])] }), null);
  assert.equal(reads, 0);
  assert.equal(uiFor().ProSocialSnapshot({ snapshots: [state([row()]), state([row()])] }), null);
});

test('Social overlay rejects invalid table and locale inputs and preserves unrelated messages', () => {
  assert.equal(SOCIAL_TRACKING_KEYS.length, 40);
  assert.equal(new Set(SOCIAL_TRACKING_KEYS).size, 40);
  for (const locale of ['__proto__', 'constructor', 'xx', null, 1]) assert.throws(() => applySocialTrackingCopy({}, locale), /unknown locale/);
  for (const table of [null, undefined, [], 'messages']) assert.throws(() => applySocialTrackingCopy(table, 'en'), /message table/);
  const sentinel = { message: 'Preserve unrelated copy' }, table = { sentinel };
  assert.equal(applySocialTrackingCopy(table, 'en'), table);
  assert.equal(table.sentinel, sentinel);
});

for (const { id } of PRODUCTION_LANGUAGES) test('Social report localizes all kinds, metadata, source counts and summaries in ' + id, () => {
  const table = tableFor(id), t = translator(table);
  const enumRows = [
    ...endpoints.map(endpoint => row({ endpoint })), ...resourceTypes.map(requestType => row({ requestType })),
    ...methods.map(method => row({ method })), ...SOCIAL_KINDS.map(kind => row({ kind })), pageRow({ count: 37 })
  ];
  const report = reportFor([state(enumRows)], id), output = visibleText(report);
  assert.equal(reportRows(report).length, enumRows.length);
  for (const key of SOCIAL_TRACKING_KEYS) {
    assert.equal(typeof table[key]?.message, 'string', key);
    assert.equal(table[key].message.length > 0, true, key);
    const tokens = [...table[key].message.matchAll(/\$([A-Z][A-Z0-9_]*)\$/g)].map(match => match[1].toLowerCase());
    assert.deepEqual(tokens, Object.keys(table[key].placeholders ?? {}), id + '/' + key);
    for (const value of Object.values(table[key].placeholders ?? {})) assert.equal(value.content, '$1');
  }
  for (const endpoint of endpoints) assert.equal(output.includes(t('social_endpoint_' + endpoint.replaceAll('-', '_'))), true, endpoint);
  for (const requestType of resourceTypes) assert.equal(output.includes(t('social_resource_' + requestType)), true, requestType);
  for (const kind of SOCIAL_KINDS) assert.equal(output.includes(t('social_kind_' + kind.replaceAll('-', '_'))), true, kind);
  assert.equal(output.includes(t('social_browser_request_count', ['1'])), true);
  assert.equal(output.includes(t('social_page_action_count', ['37'])), true);
  assert.equal(output.includes(t('social_method_unknown')), true);
  assert.equal(output.includes(t('social_script_unknown')), false);
  assert.equal(markedText(report, 'data-social-pro-services'), t('social_service_count', ['1']));
  assert.equal(markedText(report, 'data-social-pro-tracking-services'), t('social_tracking_services', ['1']));
  assert.equal(output.includes(t('social_document', ['1'])), true);
  assert.equal(/\$(?:COUNT|NUMBER)\$|\bsocial_(?:kind|endpoint|resource|pro|browser|page)_/.test(output), false);
  assert.equal(nodes(report, node => node.props.dangerouslySetInnerHTML !== undefined || node.type === 'details').length, 0);
  if (id !== 'en') for (const key of ['social_kind_tracking_sdk', 'social_browser_request_count', 'social_page_action_count', 'social_pro_documents', 'social_pro_rows', 'social_title']) assert.notEqual(table[key].message, tableFor('en')[key].message, key);
});

test('Mandarin, Yue and Wu have their own functional Social copy', () => {
  const tables = ['zh_CN', 'yue', 'wuu'].map(tableFor);
  for (const key of ['social_tracking_services', 'social_browser_request_count', 'social_script_unknown', 'social_title', 'social_empty']) assert.equal(new Set(tables.map(table => table[key].message)).size, 3, key);
});
