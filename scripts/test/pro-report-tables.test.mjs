// REQ-004/005/013: the report preserves saved evidence without depending on finding cards.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { createProReportTables, recordedValueRows } from '../../apps/production-extension/pro-report-tables.js';
import { createCompanyUi } from '../../apps/production-extension/company-ui.js';
import { applyProReportCopy } from '../production-locales-report.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const reportSource = readFileSync(new URL('../../apps/production-extension/report.js', import.meta.url), 'utf8');
const msg = (key, ...parameters) => ({ key, parameters });
const countStart = reportSource.indexOf('function countLabel(count, quality) {');
assert.ok(countStart >= 0);
const countEnd = reportSource.indexOf('\nfunction confidenceKey(', countStart);
assert.ok(countEnd > countStart);
// Exercise the production formatter as well as the renderer: saturated and lower-bound counts must stay qualified.
const productionCountLabel = vm.runInNewContext(reportSource.slice(countStart, countEnd) + '\ncountLabel;', { msg });
const techniqueStart = reportSource.indexOf('var G2 = "graphics"');
const techniqueEnd = reportSource.indexOf('// packages/catalog/src/labels.ts', techniqueStart);
assert.ok(techniqueStart >= 0 && techniqueEnd > techniqueStart);
const techniqueInfo = vm.runInNewContext(reportSource.slice(techniqueStart, techniqueEnd) + '\nTECHNIQUE_INFO;');
const cardStart = reportSource.indexOf('var KIND_BY_INTERPRETATION = {');
const cardEnd = reportSource.indexOf('var VENDOR_PURPOSE_KEYS = {', cardStart);
assert.ok(cardStart >= 0 && cardEnd > cardStart);
const productionBuildCards = vm.runInNewContext(reportSource.slice(cardStart, cardEnd) + '\nbuildCards;', { TECHNIQUE_INFO: techniqueInfo, msg });
const h = (type, props = {}) => ({ type, props });
const { CompanyLabel } = createCompanyUi({ h });
const SiteLabel = ({ host, label }) => h('span', { 'data-site-host': host, children: label ?? host });
const operationDefinition = operation => ({
  'MediaCapabilities.decodingInfo': { techniqueId: 'DET-020', mechanism: 'media-capabilities', kind: 'async-call' },
  'HTMLMediaElement.canPlayType': { techniqueId: 'DET-020', mechanism: 'media-capabilities', kind: 'call' },
  'Navigator.hardwareConcurrency': { techniqueId: 'DET-032', mechanism: 'browser-capabilities', kind: 'get' }
})[operation] ?? null;
const report = changes => ({ documentKey: '5:0:main', host: 'example.test', techniques: [], apiOperations: [], findings: [], cards: [], ...changes });
const page = changes => ({ documentKey: '5:0:main', reports: [], apiValues: [], ...changes });
const value = changes => ({ operation: 'Navigator.hardwareConcurrency', techniqueId: 'DET-032', phase: 'returned-sync', value: { kind: 'number', value: 8 }, parameters: [], count: 3, ...changes });
const document = (rows, changes = {}) => ({ documentKey: '5:0:main', rows, truncated: false, ...changes });
function catalog(language = PRODUCTION_LANGUAGES.find(item => item.id === 'en')) {
  return applyProReportCopy(JSON.parse(readFileSync(new URL('../../apps/production-extension/' + (language.uiOnly ? 'ui-locales' : '_locales') + '/' + language.id + '/messages.json', import.meta.url))), language.id);
}
function ui({ dictionary = catalog(), keys = new Set(), ...overrides } = {}) {
  const text = (key, parameters = []) => {
    keys.add(key);
    let result = dictionary[key]?.message ?? key;
    for (const [name, placeholder] of Object.entries(dictionary[key]?.placeholders ?? {})) result = result.replaceAll('$' + name.toUpperCase() + '$', String(parameters[Number(placeholder.content.slice(1)) - 1]));
    return result;
  };
  return createProReportTables({ h, text, message: item => typeof item === 'string' ? item : text(item.key, item.parameters),
    buildCards: item => item.cards, techniqueInfo, activity: () => null, operationDefinition, countLabel: productionCountLabel,
    CompanyLabel, SiteLabel, extensionTargetLabel: target => target === 'known-extension' ? { name: 'Known extension' } : null, ...overrides });
}
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
function visible(node) {
  if (Array.isArray(node)) return node.map(visible).join(' ');
  return node && typeof node === 'object' ? visible(node.props.children) : node === undefined || node === null || node === false ? '' : String(node);
}
const values = rendered => nodes(rendered, node => node.props['data-pro-value-row'] === true);
const bodyRows = rendered => nodes(rendered, node => node.type === 'tbody').flatMap(body => nodes(body, node => node.type === 'tr'));
const cellTexts = row => row.props.children.map(visible);

test('saved value documents remain visible without report documents, techniques or finding cards', () => {
  const first = value(), second = value({ value: { kind: 'number', value: 16 }, count: 2 });
  const input = page({ apiValues: [document([first]), document([second], { documentKey: '5:8:orphan' })] });
  const saved = recordedValueRows(input);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].row, first); assert.equal(saved[1].row, second);
  assert.deepEqual(saved.map(item => [item.documentKey, item.host]), [['5:0:main', null], ['5:8:orphan', null]]);
  const rendered = expand(ui({ buildCards() { throw Error('Values must not depend on finding cards'); } }).Values({ page: input }));
  assert.equal(values(rendered).length, 2);
  assert.deepEqual(values(rendered).map(row => row.props['data-value-document']), ['5:0:main', '5:8:orphan']);
  assert.match(visible(rendered), /5:8:orphan/);
});

test('multiple findings for one technique do not duplicate any saved value or count', () => {
  const input = page({ reports: [report({ findings: [{ techniqueId: 'DET-032' }, { techniqueId: 'DET-032' }], cards: [{ techniqueId: 'DET-032' }, { techniqueId: 'DET-032' }] })], apiValues: [document([value()])] });
  const before = structuredClone(input), rendered = expand(ui().Values({ page: input }));
  assert.equal(values(rendered).length, 1);
  assert.equal(cellTexts(values(rendered)[0]).at(-1), '3');
  assert.match(cellTexts(values(rendered)[0])[3], /example\.test/);
  assert.deepEqual(input, before);
});

test('same operation retains every argument, returned-value and phase variant separately', () => {
  const operation = 'WebGLRenderingContext.getParameter.MAX_TEXTURE_SIZE';
  const rows = [value({ operation, techniqueId: 'DET-011', parameters: [{ name: 'arg0', kind: 'number', value: 3379 }], value: { kind: 'number', value: 4096 }, count: 2 }),
    value({ operation, techniqueId: 'DET-011', parameters: [{ name: 'arg0', kind: 'number', value: 3379 }], value: { kind: 'number', value: 8192 }, count: 4 }),
    value({ operation, techniqueId: 'DET-011', phase: 'threw-sync', parameters: [{ name: 'arg0', kind: 'number', value: 0 }], value: { kind: 'unobserved', reason: 'exception' }, count: 1 })];
  const rendered = expand(ui().Values({ page: page({ apiValues: [document(rows)] }) }));
  assert.equal(values(rendered).length, 3);
  assert.deepEqual(values(rendered).map(row => row.props['data-api-result-phase']), ['returned-sync', 'returned-sync', 'threw-sync']);
  assert.deepEqual(values(rendered).map(row => cellTexts(row).at(-1)), ['2', '4', '1']);
  assert.match(cellTexts(values(rendered)[0])[1], /3379/); assert.match(cellTexts(values(rendered)[2])[1], /0/);
  assert.match(cellTexts(values(rendered)[0])[2], /4096/); assert.match(cellTexts(values(rendered)[1])[2], /8192/);
});

test('report introduces no display cap below the saved per-document value limits', () => {
  const input = page({ apiValues: [0, 1].map(documentIndex => document(Array.from({ length: 256 }, (_, index) => value({ value: { kind: 'number', value: documentIndex * 256 + index } })), { documentKey: '5:' + documentIndex + ':frame' })) });
  const rendered = expand(ui().Values({ page: input }));
  assert.equal(values(rendered).length, 512);
  assert.equal(nodes(rendered, node => node.props['data-api-value'] === true).at(-1).props.children, '511');
});

test('primitive and numeric-vector values preserve false, empty strings, null and every array item', () => {
  const projected = [{ kind: 'string', value: '' }, { kind: 'boolean', value: false }, { kind: 'null' }, { kind: 'undefined' },
    ...['-0', 'NaN', 'Infinity', '-Infinity'].map(item => ({ kind: 'special-number', value: item })),
    { kind: 'number-array', values: [-1, 0, 0.5, 16, 'NaN', 'Infinity', '-Infinity', '-0'] }];
  const rendered = expand(ui().Values({ page: page({ apiValues: [document(projected.map(item => value({ value: item })))] }) }));
  assert.deepEqual(nodes(rendered, node => node.props['data-api-value'] === true).map(node => node.props.children), ['""', 'false', 'null', 'undefined', '-0', 'NaN', 'Infinity', '-Infinity', '[-1, 0, 0.5, 16, NaN, Infinity, -Infinity, -0]']);
});

test('structured RTC snapshots retain each saved field, repeated field indices, source and truncation', () => {
  const fields = Array.from({ length: 64 }, (_, index) => ({ name: 'codec.clockRate', index, value: 8000 + index }));
  const rendered = expand(ui().Values({ page: page({ apiValues: [document([value({ operation: 'RTCRtpSender.getCapabilities', techniqueId: 'DET-020',
    value: { kind: 'webrtc', profile: 'rtp-capabilities', source: 'native-snapshot', fields, truncated: true } })])] }) }));
  const entries = nodes(rendered, node => node.props['data-rtc-field'] !== undefined);
  assert.equal(entries.length, fields.length);
  for (const [index, entry] of entries.entries()) { assert.match(visible(entry), new RegExp('\\[' + index + '\\]')); assert.match(visible(entry), new RegExp(String(8000 + index))); }
  assert.match(visible(rendered), /snapshot/i);
  assert.ok(visible(rendered).includes(catalog().rtc_values_limited.message));
});

test('unobserved asynchronous, sensitive and exceptional results keep reasons without inventing values', () => {
  const rows = ['async', 'sensitive', 'exception', 'object', 'unsupported', 'limit'].map(reason => value({ value: { kind: 'unobserved', reason }, phase: reason === 'async' ? 'settlement-unobserved' : reason === 'exception' ? 'threw-sync' : 'returned-sync' }));
  const rendered = expand(ui().Values({ page: page({ apiValues: [document(rows)] }) }));
  assert.equal(values(rendered).length, rows.length);
  assert.equal(nodes(rendered, node => node.props['data-api-value'] === true).length, 0);
  for (const row of rows) assert.ok(visible(rendered).includes(catalog()['api_result_' + row.value.reason].message));
});

test('truncation is reported once alongside retained values, and empty data creates no table', () => {
  const tables = ui();
  assert.equal(nodes(tables.Values({ page: page() }), node => node.type === 'table').length, 0);
  const rendered = tables.Values({ page: page({ apiValues: [document([value()], { truncated: true }), document([], { documentKey: '5:1:frame', truncated: true })] }) });
  assert.equal(values(rendered).length, 1);
  assert.equal(nodes(rendered, node => node.props['data-pro-values-truncated']).length, 1);
});

test('untrusted technical strings remain inert text and cannot become markup, links or script sources', () => {
  const payload = '</code><img src=x onerror=alert(1)><script>INERT_REPORT</script>';
  const rendered = expand(ui().Values({ page: page({ apiValues: [document([value({ value: { kind: 'string', value: payload } })])] }) }));
  assert.ok(visible(rendered).includes(JSON.stringify(payload)));
  assert.equal(nodes(rendered, node => ['script', 'img', 'iframe', 'a'].includes(node.type)).length, 0);
  assert.equal(nodes(rendered, node => Object.keys(node.props).some(key => key === 'dangerouslySetInnerHTML' || /^on[a-z]/i.test(key) || key === 'src' || key === 'href')).length, 0);
});

test('qualified counts survive both operation counters and saturated saved-value counters', () => {
  const input = page({ reports: [report({ apiOperations: [
    { apiOperation: 'Navigator.hardwareConcurrency', phase: 'returned-sync', count: 7, countQuality: 'lower-bound' },
    { apiOperation: 'MediaCapabilities.decodingInfo', phase: 'settlement-unobserved', count: 3, countQuality: 'sampled' }
  ] })], apiValues: [document([value({ count: 2147483647 })])] });
  const tables = ui(), checks = expand(tables.Checks({ page: input })), saved = expand(tables.Values({ page: input }));
  assert.deepEqual(bodyRows(checks).map(row => cellTexts(row).at(-1)), ['at least 7', 'about 3 (sampled)']);
  assert.equal(cellTexts(values(saved)[0]).at(-1), 'at least 2147483647');
});

test('aggregate technique counts and phases are preserved even when a registry operation represents that technique', () => {
  const input = page({ reports: [report({ techniques: [{ techniqueId: 'DET-020', count: 12, countQuality: 'lower-bound', phases: ['returned-sync', 'settlement-unobserved'], signalCodes: ['rtp-capabilities', 'media-capability-check'] }],
    apiOperations: [{ apiOperation: 'MediaCapabilities.decodingInfo', count: 3, countQuality: 'exact', phase: 'settlement-unobserved' }] })] });
  const rendered = expand(ui().Checks({ page: input }));
  assert.equal(bodyRows(rendered).length, 2);
  const aggregate = nodes(rendered, node => node.props['data-technique'] === 'DET-020');
  assert.equal(aggregate.length, 1); assert.equal(cellTexts(aggregate[0]).at(-1), 'at least 12');
  assert.ok(visible(aggregate[0]).includes(catalog().phase_returned_sync.message));
  assert.ok(visible(aggregate[0]).includes(catalog().phase_settlement_unobserved.message));
  assert.match(visible(aggregate[0]), /rtp-capabilities/);
  assert.match(visible(aggregate[0]), /media-capability-check/);
});

test('permission results, header hints, extension checks and local ports survive the compact tables', () => {
  const input = page({ reports: [report({
    permissionChecks: [{ permission: 'camera', kind: 'permission', result: 'denied', count: 2, countQuality: 'lower-bound' }, { permission: 'microphone', kind: 'policy', result: 'allowed', count: 1, countQuality: 'exact' }],
    responseHeaders: { entries: [{ name: 'accept-ch', count: 3, clientHints: ['sec-ch-ua-model', 'sec-ch-ua-platform-version'] }, { name: 'secure-session-registration', count: 2147483647, clientHints: [] }], truncated: true },
    extensionResources: [{ target: 'known-extension', method: 'fetch', phase: 'attempted', count: 4, countQuality: 'sampled' }, { target: 'unknown-extension', method: 'image-src', phase: 'threw-sync', count: 1, countQuality: 'exact' }],
    requestedLocalPorts: { ports: [443, 8080], truncated: true }
  })] });
  const rendered = expand(ui().OtherChecks({ page: input })), output = visible(rendered);
  assert.equal(nodes(rendered, node => node.type === 'table').length, 4);
  assert.equal(bodyRows(rendered).length, 7);
  for (const item of ['Camera', 'Microphone', 'denied', 'allowed', 'at least 2', 'at least 2147483647', 'accept-ch', 'sec-ch-ua-model, sec-ch-ua-platform-version', 'secure-session-registration', 'Known extension', 'unknown-extension', 'fetch', 'image-src', 'about 4 (sampled)', '443, 8080']) assert.ok(output.toLowerCase().includes(item.toLowerCase()), item);
  assert.ok(output.includes(catalog().headers_truncated.message));
  assert.ok(output.includes(catalog().local_ports_incomplete.message));
});

test('empty checks, permissions, companies and findings do not create empty sections', () => {
  const tables = ui(), input = page({ reports: [report()] });
  assert.equal(tables.Checks({ page: input }), null);
  assert.equal(tables.Findings({ page: input }), null);
  assert.equal(tables.Companies({ vendors: [] }), null);
  assert.equal(nodes(tables.OtherChecks({ page: input }), node => node.type === 'section').length, 0);
});

test('finding rows use the production interpretation model and do not promote plain API calls to patterns', () => {
  const summary = (techniqueId, interpretation) => ({ techniqueId, interpretation, interpretationConfidence: 'medium', count: 2, countQuality: 'lower-bound', phases: ['returned-sync'],
    evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'sampled-stack', signalCodes: ['canvas-export'] });
  const finding = (findingId, techniqueId, interpretation) => ({ findingId, techniqueId, interpretation, interpretationConfidence: 'medium', ruleId: 'canvas-pattern', ruleVersion: '1',
    vendorMatchIds: [], evidenceIds: [], counterEvidenceCodes: ['high-volume-rendering'], limitationCodes: ['no-time-window'] });
  const input = page({ reports: [report({ techniques: [summary('DET-001', 'fingerprinting-pattern'), summary('DET-032', 'api-use'), summary('DET-005', 'unknown')],
    findings: [finding('pattern-one', 'DET-001', 'fingerprinting-pattern'), finding('pattern-two', 'DET-001', 'possible-fingerprinting')] })] });
  const keys = new Set(), rendered = expand(ui({ keys, buildCards: productionBuildCards }).Findings({ page: input }));
  const rows = nodes(rendered, node => node.props['data-finding'] !== undefined);
  assert.deepEqual(rows.map(row => row.props['data-finding']).sort(), ['f:pattern-one', 'f:pattern-two']);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    const output = visible(row);
    assert.match(output, /canvas-pattern v1/);
    assert.ok(output.includes(catalog().evidence_page_hook.message));
    assert.ok(output.includes(catalog().integrity_page_controlled.message));
    assert.ok(output.includes(catalog().confidence_medium.message));
    assert.ok(output.includes(catalog().attribution_sampled_stack.message));
    assert.ok(output.includes(catalog().alternative_high_volume_rendering.message));
    assert.ok(output.includes(catalog().limitation_no_time_window.message));
  }
  assert.doesNotMatch(visible(rendered), /hardwareConcurrency|getBoundingClientRect/);
  for (const language of PRODUCTION_LANGUAGES) {
    const dictionary = catalog(language);
    for (const key of keys) assert.equal(typeof dictionary[key]?.message, 'string', language.id + ': missing finding label ' + key);
  }
});

test('company identities render packaged logos and preserve every recording source', () => {
  const sources = ['main', 'frame'].map((name, index) => ({ pageId: 'page-' + index, documentKey: '5:' + index + ':' + name, host: name + '.example.test', vendor: { matchLabel: 'Resource match', ruleIds: ['rule-' + name] } }));
  const rendered = expand(ui().Companies({ vendors: [{ vendorId: 'google-recaptcha', name: 'Google reCAPTCHA', sources }] }));
  assert.equal(nodes(rendered, node => node.props['data-company-logo'] !== undefined).length, 1);
  assert.equal(nodes(rendered, node => node.type === 'a').length, 2);
  const image = nodes(rendered, node => node.type === 'img')[0];
  assert.ok(image); assert.match(image.props.src, /icons\/brands\//); assert.doesNotMatch(image.props.src, /^https?:/);
  for (const entry of sources) { assert.ok(visible(rendered).includes(entry.documentKey)); assert.ok(visible(rendered).includes(entry.vendor.ruleIds[0])); }
});

test('all exercised table labels resolve in every production language, including dynamic phases, permissions and categories', () => {
  const keys = new Set(), tables = ui({ keys }), permissions = ['camera', 'microphone', 'geolocation', 'notifications', 'clipboard-read', 'clipboard-write', 'persistent-storage', 'background-sync', 'midi', 'sensors', 'payment-handler', 'screen-wake-lock', 'window-management', 'local-fonts', 'display-capture', 'storage-access', 'unknown'];
  const headers = ['accept-ch', 'critical-ch', 'permissions-policy', 'feature-policy', 'nel', 'report-to', 'reporting-endpoints', 'secure-session-registration', 'sec-session-registration', 'secure-session-challenge', 'sec-session-challenge', 'use-as-dictionary'];
  const input = page({ reports: [report({ techniques: Object.keys(techniqueInfo).map(techniqueId => ({ techniqueId, phases: ['attempted', 'returned-sync', 'threw-sync', 'async-returned', 'settlement-unobserved'], count: 1, countQuality: 'exact' })),
    permissionChecks: permissions.flatMap(permission => [{ permission, kind: 'permission', result: 'granted', count: 1, countQuality: 'exact' }, { permission, kind: 'permission', result: 'denied', count: 1, countQuality: 'exact' }, { permission, kind: 'permission', result: 'prompt', count: 1, countQuality: 'exact' }, { permission, kind: 'policy', result: 'allowed', count: 1, countQuality: 'exact' }, { permission, kind: 'policy', result: 'blocked', count: 1, countQuality: 'exact' }]),
    responseHeaders: { entries: headers.map(name => ({ name, count: 1, clientHints: [] })), truncated: true },
    extensionResources: [{ target: 'unknown-extension', method: 'fetch', phase: 'attempted', count: 1, countQuality: 'exact' }], requestedLocalPorts: { ports: [80], truncated: true } })],
    apiValues: [document([value(), value({ value: { kind: 'unobserved', reason: 'async' } }), value({ value: { kind: 'webrtc', fields: [], source: 'returned', truncated: true } })], { truncated: true })] });
  expand([tables.Values({ page: input }), tables.Checks({ page: input }), tables.OtherChecks({ page: input }), tables.Findings({ page: input }), tables.Companies({ vendors: [] })]);
  assert.ok(keys.size > 50);
  for (const language of PRODUCTION_LANGUAGES) {
    const dictionary = catalog(language);
    for (const key of keys) assert.equal(typeof dictionary[key]?.message, 'string', language.id + ': missing ' + key);
  }
});
