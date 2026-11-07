import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { summaryValueRows, createProReportTables } from '../../apps/production-extension/pro-report-tables.js';
import { applyProReportCopy } from '../production-locales-report.mjs';
const row = (operation, value, changes = {}) => ({ operation, techniqueId: 'DET-030', value: { kind: 'number', value }, phase: 'returned-sync', parameters: [], count: 1, ...changes });
const page = (rows, cookieRows = []) => ({ documentKey: '5:0:main', reports: [], apiValues: rows, cookieValues: { rows: cookieRows } });
const doc = (documentKey, rows) => ({ documentKey, rows, truncated: false });
const h = (type, props = {}) => ({ type, props });
const ui = createProReportTables({ h, text: key => applyProReportCopy({}, 'en')[key]?.message ?? key });
function nodes(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(value => nodes(value, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...nodes(node.props.children, predicate)];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  return node && typeof node === 'object' ? text(node.props.children) : node === undefined || node === null ? '' : String(node);
}
test('summary covers every visit and third-party document and sorts all names alphabetically', () => {
  const input = { pages: [page([doc('5:0:main', [row('Z.last', 1), row('A.first', 2)])]),
    page([doc('5:8:thirdParty', [row('M.middle', 3)]), doc('5:9:unmatchedFrame', [row('B.other', 4)])])] };
  assert.deepEqual(summaryValueRows(input).map(item => item.name), ['A.first', 'B.other', 'M.middle', 'Z.last']);
  assert.deepEqual(summaryValueRows(input).map(item => item.value), ['2', '4', '3', '1']);
});
test('summary lists each unique name and value once but preserves different values from other sites', () => {
  const input = { pages: [page([doc('5:0:first', [row('Window.innerWidth', 800), row('Window.innerWidth', 800)])]),
    page([doc('5:4:otherSite', [row('Window.innerWidth', 1200), row('Window.innerWidth', 800)])])] };
  assert.deepEqual(summaryValueRows(input), [{ name: 'Window.innerWidth', value: '800' }, { name: 'Window.innerWidth', value: '1200' }]);
});
test('summary has exactly ordinal, name and value columns and no count, phase or source prose', () => {
  const output = ui.Summary({ session: { pages: [page([doc('5:0:main', [row('Z.value', 88), row('A.value', 77)])])] } });
  assert.equal(output.props['data-pro-summary'], 'browser');
  assert.deepEqual(nodes(output, node => node.type === 'th').map(text), ['№', 'Name', 'Value']);
  const rows = nodes(output, node => node.props['data-summary-row']);
  assert.deepEqual(rows.map(item => item.props.children.map(text)), [['1', 'A.value', '77'], ['2', 'Z.value', '88']]);
  assert.equal(rows.every(item => item.props.children.length === 3), true);
});
test('all vector elements and structured WebRTC fields are individual named summary rows', () => {
  const input = { pages: [page([doc('5:0:main', [
    row('Vector', null, { value: { kind: 'number-array', values: [1, 2, 3] } }),
    row('RTC', null, { value: { kind: 'webrtc', fields: [{ name: 'codec.mimeType', index: 0, value: 'video/VP8' }, { name: 'codec.mimeType', index: 1, value: 'video/H264' }] } })
  ])])] };
  assert.deepEqual(summaryValueRows(input).map(item => item.name), ['RTC.codec.mimeType[0]', 'RTC.codec.mimeType[1]', 'Vector[0]', 'Vector[1]', 'Vector[2]']);
});
test('parameterized queries keep different requested properties under different names', () => {
  const input = { pages: [page([doc('5:0:main', [row('WebGL.getParameter', 8192, { parameters: [{ name: 'arg0', value: 3379 }] }), row('WebGL.getParameter', 16, { parameters: [{ name: 'arg0', value: 34921 }] })])])] };
  assert.deepEqual(summaryValueRows(input).map(item => item.name), ['WebGL.getParameter(arg0=3379)', 'WebGL.getParameter(arg0=34921)']);
});

test('special numbers remain numeric and distinct from equal-looking strings in summaries', () => {
  const special = ['NaN', '-0', 'Infinity', '-Infinity'];
  const input = { pages: [page([doc('5:0:main', special.flatMap(value => [
    row('Scalar', null, { value: { kind: 'special-number', value } }),
    row('Scalar', null, { value: { kind: 'string', value } })
  ]).concat(row('Vector', null, { value: { kind: 'number-array', values: special } })))])] };
  const rows = summaryValueRows(input);
  assert.equal(rows.length, 12);
  assert.deepEqual(new Set(rows.filter(item => item.name === 'Scalar').map(item => item.value)), new Set(special.flatMap(value => [value, JSON.stringify(value)])));
  assert.deepEqual(rows.filter(item => item.name.startsWith('Vector')).map(item => item.value), special);
});
test('absent, sensitive or thrown results do not become invented browser values', () => {
  const input = { pages: [page([doc('5:0:main', [row('A', null, { value: { kind: 'unobserved', reason: 'sensitive' } }), row('B', 1, { phase: 'threw-sync' }), row('C', null, { value: { kind: 'null' } }), row('D', null, { value: { kind: 'string', value: 'null' } })])])] };
  assert.deepEqual(summaryValueRows(input), [{ name: 'C', value: 'null' }, { name: 'D', value: '"null"' }]);
});
test('Cookie summary uses recorded outgoing values from all sites, never metadata or the current cookie jar', () => {
  const first = page([], [{ name: '_z', value: 'a=b%20c', destinationHost: 'site.test' }, { name: '_a', value: 'one', destinationHost: 'site.test' }]);
  first.cookies = { entries: [{ name: 'NOT_SENT', value: 'NOT_SENT' }] };
  const second = page([], [{ name: '_a', value: 'two', destinationHost: 'third-party.test' }, { name: '_a', value: 'one', destinationHost: 'third-party.test' }]);
  const input = { pages: [first, second] };
  assert.deepEqual(summaryValueRows(input, true), [{ name: '_a', value: 'one' }, { name: '_a', value: 'two' }, { name: '_z', value: 'a=b%20c' }]);
  const output = ui.Summary({ session: input, cookies: true });
  assert.equal(output.props['data-pro-summary'], 'cookies');
  assert.equal(nodes(output, node => node.props['data-summary-row']).length, 3);
  assert.doesNotMatch(text(output), /NOT_SENT|third-party\.test|site\.test/);
});

test('summary includes concrete decoded beacon values from every visit and third party, without presence flags or page attempts', () => {
  const beacon = changes => ({ service: 'meta', evidenceSource: 'browser-network', events: ['Purchase', 'unknown'], money: [{ event: 'Purchase', purpose: 'value', value: '49.99', currency: 'USD' }], identifiers: { hashedEmail: 'present' }, consent: { gcs: 'present', gcd: 'unknown', adUserData: 'denied', adPersonalization: 'absent' }, ...changes });
  const first = page([]), second = page([]);
  first.beacons = [{ documentKey: '5:0:main', rows: [beacon({})], scriptCalls: [beacon({ service: 'NOT_SENT' })] }];
  second.beacons = [{ documentKey: '5:8:thirdParty', rows: [beacon({ money: [{ event: 'Purchase', purpose: 'value', value: '99.5', currency: null }] }), beacon({ service: 'PAGE_ONLY', evidenceSource: 'page-dom' })], scriptCalls: [] }];
  const rows = summaryValueRows({ pages: [first, second] });
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.filter(row => row.name.endsWith('.value')).map(row => row.value), ['49.99', '99.5']);
  assert(rows.some(row => row.name === 'meta.beacon.event' && row.value === '"Purchase"'));
  assert(rows.some(row => row.name === 'meta.beacon.Purchase.currency' && row.value === '"USD"'));
  assert(rows.some(row => row.name === 'meta.beacon.consent.adUserData' && row.value === '"denied"'));
  assert.doesNotMatch(JSON.stringify(rows), /NOT_SENT|PAGE_ONLY|present|absent|unknown|hashedEmail/);
});
test('Cookie control characters are visible escapes; markup remains inert text', () => {
  const output = ui.Summary({ session: { pages: [page([], [{ name: 'cookie', value: '<script>test</script>\n\u202e' }])] }, cookies: true });
  assert.equal(nodes(output, node => node.type === 'script' || node.props.dangerouslySetInnerHTML).length, 0);
  assert.match(text(output), /<script>test<\/script>\\u000a\\u202e/);
});

test('summary does not present an endpoint-inferred conversion as a transmitted event value', () => {
  const input = page([]);
  input.beacons = [{ rows: ['google-ads-browser-v1', 'linkedin-image-v1', 'linkedin-capi-v1'].map(profile => ({ profile, service: 'service', evidenceSource: 'browser-network', events: ['conversion'], money: [], consent: {} })) }];
  assert.deepEqual(summaryValueRows({ pages: [input] }), []);
});
test('summary introduces no display cap and skips only truly empty summaries', () => {
  const input = { pages: Array.from({ length: 3 }, (_, pageIndex) => page([doc('5:0:p' + pageIndex, Array.from({ length: 256 }, (_, index) => row('Value.' + (pageIndex * 256 + index), index))) ])) };
  assert.equal(summaryValueRows(input).length, 768);
  assert.equal(ui.Summary({ session: { pages: [] } }), null);
  assert.equal(ui.Summary({ session: { pages: [page([])] }, cookies: true }), null);
});
test('summary includes structured API fields and passive request values from all documents, without normalized metadata', () => {
  const main = page([doc('5:0:main', [row('Navigator.languages', null, { value: { kind: 'technical', profile: 'languages', fields: [
    { name: 'language', index: 0, kind: 'string', value: 'ru-RU' },
    { name: 'language', index: 1, kind: 'string', value: 'en-US' }
  ], truncated: false } })])]);
  main.requestValues = { rows: [{ name: 'User-Agent', value: 'Browser A', destinationHost: 'main.test' }, { name: 'Sec-CH-UA-Platform', value: '"Windows"', destinationHost: 'third.test' }] };
  main.reports = [{ documentKey: '5:0:main', permissionChecks: [{ permission: 'geolocation', kind: 'permission', result: 'prompt', count: 8 }] }];
  const child = page([doc('5:8:thirdParty', [row('Intl.DateTimeFormat.resolvedOptions', null, { value: { kind: 'technical', profile: 'intl', fields: [{ name: 'timeZone', index: 0, kind: 'string', value: 'Asia/Dubai' }], truncated: false } })])]);
  child.requestValues = { rows: [{ name: 'User-Agent', value: 'Browser B', destinationHost: 'third.test' }] };
  child.reports = [{ documentKey: '5:8:thirdParty', permissionChecks: [{ permission: 'camera', kind: 'policy', result: 'blocked', count: 2 }] }];
  const rows = summaryValueRows({ pages: [main, child] });
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.filter(row => row.name === 'User-Agent').map(row => row.value), ['"Browser A"', '"Browser B"']);
  assert(rows.some(row => row.name.includes('timeZone') && row.value === '"Asia/Dubai"'));
  assert.equal(rows.some(row => row.name.startsWith('Permission')), false);
  assert.equal(rows.some(row => row.name.includes('count') || row.value === 'third.test'), false);
});
test('summary print style explicitly starts each section on a fresh page and uses 12pt text', () => {
  const css = readFileSync(new URL('../../apps/production-extension/report.css', import.meta.url), 'utf8');
  assert.match(css, /\.pro-report \.pro-summary \{ break-before: page; page-break-before: always; margin: 0; padding: 0; \}/);
  assert.match(css, /\.pro-report \.pro-summary-table code \{ font-size: 12pt;/);
});
