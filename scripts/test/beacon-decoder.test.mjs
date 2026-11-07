import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beaconProfile, decodeBeacon, parseBeaconJson } from '../../apps/production-extension/beacon-decoder.js';
import { beaconDecimal, readBeaconRows, readBeaconSnapshot, readBeaconDocuments, readBeaconScriptRows } from '../../packages/contracts/src/beacons.mjs';

const hash = 'e'.repeat(64), canary = 'PRIVATE_VALUE_SENTINEL';
const body = value => ({ raw: [{ bytes: new TextEncoder().encode(value).buffer }] });
const decode = (url, options = {}) => decodeBeacon({ url, method: 'GET', bodyAvailable: false, ...options });
const wire = decoded => ({ ...decoded, method: 'GET', requestType: 'image', count: 1, completedCount: 0, failedCount: 0, redirectCount: 0, statusCodes: [], evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'frame-only', initiatorHost: 'example.com', script: null });
const snapshot = row => ({ schemaVersion: 1, type: 'beacons-state', documentKey: '7:0:doc', coverageState: 'partial', requestCount: 1, rows: [row], scriptCalls: [], truncated: false });

test('GA4 query decoder projects standard event, canonical value and presence without identifiers', () => {
  const result = decode('https://www.google-analytics.com/g/collect?v=2&en=purchase&epn.value=49.9900&cu=EUR&cid=' + canary + '&sid=123&uid=' + canary + '&gcs=G111&gcd=' + canary + '&ep.product=' + canary);
  assert.deepEqual(result.events, ['purchase']); assert.deepEqual(result.money, [{ purpose: 'value', value: '49.99', currency: 'EUR', event: 'purchase' }]);
  assert.equal(result.identifiers.clientId, 'present'); assert.equal(result.identifiers.sessionId, 'present'); assert.equal(result.identifiers.userId, 'present');
  assert.equal(result.consent.gcs, 'present'); assert.equal(result.consent.gcd, 'present'); assert.equal(result.consent.adUserData, 'absent');
  assert.equal(result.schemaConfidence, 'transport-candidate'); assert.ok(readBeaconRows([wire(result)]));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_VALUE|G111|g\/collect|ep\.product|123/);
});
test('GA4 Measurement Protocol parses batch events and documented hash/consent fields', () => {
  const result = decode('https://region1.google-analytics.com/mp/collect?api_secret=' + canary, { method: 'POST', bodyAvailable: true, body: body(JSON.stringify({ client_id: canary, user_id: canary, user_data: { sha256_email_address: hash }, consent: { ad_user_data: 'DENIED', ad_personalization: 'GRANTED' }, events: [{ name: 'purchase', params: { value: 49.99, currency: 'EUR', session_id: canary } }, { name: 'view_item', params: { value: 2, currency: 'USD' } }] })) });
  assert.deepEqual(result.events, ['purchase', 'view_item']); assert.equal(result.money.length, 2); assert.equal(result.money[0].value, '49.99');
  assert.equal(result.identifiers.hashedEmail, 'present'); assert.equal(result.consent.adUserData, 'denied'); assert.equal(result.consent.adPersonalization, 'granted');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_VALUE|eeeeeeee|api_secret|session_id/);
});
test('Meta query/form fixtures preserve Purchase and multiple monetary variants as separate requests', () => {
  const result = decode('https://www.facebook.com/tr/?id=' + canary, { method: 'POST', bodyAvailable: true, body: { formData: { ev: ['Purchase'], 'cd[value]': ['49.99'], 'cd[currency]': ['EUR'], 'ud[em]': [hash], fbp: [canary], access_token: [canary] } } });
  assert.deepEqual(result.events, ['Purchase']); assert.equal(result.money[0].value, '49.99'); assert.equal(result.identifiers.hashedEmail, 'present');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_VALUE|eeeeeeee|access_token|ud\[em\]/);
  const ambiguous = decode('https://www.facebook.com/tr/?ev=Purchase&cd%5Bvalue%5D=1&cd%5Bvalue%5D=2&cd%5Bcurrency%5D=USD');
  assert.equal(ambiguous.decodeStatus, 'ambiguous'); assert.deepEqual(ambiguous.money, []);
});
test('documented Meta/TikTok APIs decode individual fixed events and user-field presence', () => {
  for (const [url, payload, expected] of [
    ['https://graph.facebook.com/v23.0/123456/events?access_token=' + canary, { data: [{ event_name: 'Purchase', user_data: { em: [hash], ph: [hash], external_id: canary }, custom_data: { value: 49.99, currency: 'EUR' } }] }, 'Purchase'],
    ['https://business-api.tiktok.com/open_api/v1.3/event/track/', { event_source: 'web', event_source_id: canary, data: [{ event: 'CompletePayment', user: { email: hash, phone: hash, external_id: canary }, properties: { value: 49.99, currency: 'EUR' } }] }, 'CompletePayment'],
  ]) {
    const result = decode(url, { method: 'POST', bodyAvailable: true, body: body(JSON.stringify(payload)) });
    assert.deepEqual(result.events, [expected]); assert.equal(result.money[0].value, '49.99'); assert.equal(result.identifiers.hashedEmail, 'present'); assert.equal(result.identifiers.hashedPhone, 'present');
    assert.equal(result.schemaConfidence, 'documented'); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_VALUE|eeeeeeee|123456|event_source_id|access_token/);
  }
});
test('Yandex goal value and revenue stay distinct; ms is never interpreted as consent', () => {
  const result = decode('https://mc.yandex.ru/collect?tid=123&cid=' + canary + '&t=ecommerce&ea=' + canary + '&ev=7.00&tr=49.990&cu=RUB&ms=' + canary + '&ti=' + canary);
  assert.deepEqual(result.money.map(item => [item.purpose, item.value]), [['goal-value', '7'], ['revenue', '49.99']]);
  assert.equal(result.identifiers.clientId, 'present'); assert.equal(result.consent.gcs, 'absent'); assert.equal(result.consent.gcd, 'absent');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_VALUE|\bms\b|\bti\b|123/);
});
test('LinkedIn image conversion IDs do not invent a conversion name, money or browser identifier', () => {
  const result = decode('https://px.ads.linkedin.com/collect/?pid=' + canary + '&conversionId=' + canary + '&eventId=' + canary + '&fmt=gif&email=' + canary);
  assert.deepEqual(result.events, ['conversion']); assert.deepEqual(result.money, []); assert.equal(result.identifiers.hashedEmail, 'absent'); assert.equal(result.identifiers.browserId, 'absent');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_VALUE|eventId|conversionId|fmt/);
});
test('LinkedIn CAPI parses documented currency/amount and typed hash field only', () => {
  const result = decode('https://api.linkedin.com/rest/conversionEvents', { method: 'POST', bodyAvailable: true, body: body(JSON.stringify({ conversion: canary, conversionValue: { amount: '49.99', currencyCode: 'EUR' }, user: { userIds: [{ idType: 'SHA256_EMAIL', idValue: hash }, { idType: 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID', idValue: canary }] } })) });
  assert.deepEqual(result.events, ['conversion']); assert.equal(result.money[0].value, '49.99'); assert.equal(result.identifiers.hashedEmail, 'present'); assert.equal(result.identifiers.browserId, 'present');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_VALUE|eeeeeeee|idValue|conversionValue/);
});
test('Google Ads enhanced conversion candidate validates a hash-shaped value without retaining it', () => {
  const result = decode('https://www.googleadservices.com/pagead/conversion/123/?value=49.99&currency_code=EUR&em=tv.1~em.' + hash + '&gcs=G100&gcd=' + canary);
  assert.equal(result.identifiers.hashedEmail, 'present'); assert.equal(result.money[0].value, '49.99'); assert.equal(result.consent.gcs, 'present');
  assert.doesNotMatch(JSON.stringify(result), /eeeeeeee|G100|PRIVATE_VALUE|123/);
  assert.equal(decode('https://www.google.com/pagead/1p-conversion/123/?em=' + canary).identifiers.hashedEmail, 'invalid');
});
test('endpoint-only TikTok/Yandex browser profiles never apply a server API schema', () => {
  for (const url of ['https://analytics.tiktok.com/api/v2/pixel?event=Purchase&value=49.99&email=' + hash, 'https://mc.yandex.ru/watch/123?browser-info=' + canary + '&ms=' + canary]) {
    const result = decode(url); assert.equal(result.decodeStatus, 'endpoint-only'); assert.deepEqual(result.events, []); assert.deepEqual(result.money, []); assert.equal(result.identifiers.hashedEmail, 'unknown');
    assert.doesNotMatch(JSON.stringify(result), /eeeeeeee|PRIVATE_VALUE|49\.99|Purchase|123/);
  }
});
test('lookalike hosts, ports, credentials, unknown paths and first-party proxies are rejected', () => {
  for (const url of ['https://www.facebook.com.attacker.test/tr?ev=Purchase', 'https://attacker.test@www.facebook.com/tr', 'https://www.facebook.com:444/tr', 'http://www.facebook.com/tr', 'https://www.facebook.com/login?ev=Purchase', 'https://shop.example.com/g/collect?v=2', 'https://www.google-analytics.com/collect?v=1', 'https://analytics.tiktok.com/open_api/v1.3/event/track/']) assert.equal(beaconProfile(url), null, url);
});
test('custom event names, invalid amount/currency and arbitrary hashes never enter a projection', () => {
  const result = decode('https://www.facebook.com/tr?ev=' + canary + '&cd%5Bvalue%5D=' + canary + '&cd%5Bcurrency%5D=' + canary + '&ud%5Bem%5D=' + canary + '&custom_hash=' + hash);
  assert.deepEqual(result.events, ['unknown']); assert.deepEqual(result.money, []); assert.equal(result.identifiers.hashedEmail, 'invalid');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_VALUE|eeeeeeee|custom_hash/);
});
test('JSON duplicate keys, duplicate escaped keys, depth and field budgets fail explicitly', () => {
  for (const source of ['{"client_id":"one","client_id":"two"}', '{"client_id":"one","client_\\u0069d":"two"}']) assert.equal(parseBeaconJson(source).status, 'ambiguous');
  assert.equal(parseBeaconJson('{"events":NaN}').status, 'invalid'); assert.equal(parseBeaconJson('{"a":1,}').status, 'invalid');
  assert.equal(parseBeaconJson('{"a":' + '['.repeat(9) + '0' + ']'.repeat(9) + '}').status, 'truncated');
  assert.equal(parseBeaconJson(JSON.stringify(Object.fromEntries(Array.from({ length: 65 }, (_, index) => ['key' + index, index])))).status, 'truncated');
  assert.equal(parseBeaconJson('x'.repeat(32769)).status, 'truncated');
});
test('malformed UTF8/percent, unavailable, file, compressed and opaque bodies remain unknown', () => {
  const url = 'https://www.google-analytics.com/mp/collect';
  for (const payload of [undefined, { error: canary }, { raw: [{ file: 'C:/' + canary }] }, { raw: [{ bytes: new Uint8Array([0xff]).buffer }] }, { raw: [{ bytes: new Uint8Array([0x1f, 0x8b, 0, 0]).buffer }] }]) {
    const result = decode(url, { method: 'POST', bodyAvailable: payload !== undefined, body: payload });
    assert.equal(result.identifiers.clientId, 'unknown'); assert.notEqual(result.decodeStatus, 'complete'); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_VALUE|C:\//);
  }
  assert.equal(decode('https://www.facebook.com/tr?ev=%ff').decodeStatus, 'invalid');
  assert.equal(decode('https://www.facebook.com/tr', { method: 'POST', bodyAvailable: true, body: body('encrypted-opaque') }).identifiers.hashedEmail, 'unknown');
});
test('native form body getters and unknown body properties are not invoked', () => {
  let reads = 0;
  const form = { ev: ['PageView'] }, payload = { formData: form };
  Object.defineProperties(payload, { authorization: { get() { reads++; throw Error('secret'); } }, response: { get() { reads++; throw Error('body'); } } });
  assert.deepEqual(decode('https://www.facebook.com/tr', { method: 'POST', bodyAvailable: true, body: payload }).events, ['PageView']);
  Object.defineProperty(form, 'private', { enumerable: true, get() { reads++; throw Error('getter'); } });
  assert.equal(decode('https://www.facebook.com/tr', { method: 'POST', bodyAvailable: true, body: payload }).decodeStatus, 'invalid'); assert.equal(reads, 0);
});
test('canonical decimals preserve zero/refund without exponent or rounding artifacts', () => {
  for (const [input, expected] of [['0.000', '0'], ['-0.00', '0'], ['-49.9900', '-49.99'], [49.99, '49.99']]) assert.equal(beaconDecimal(input), expected);
  for (const input of ['01', '+1', '1e2', '1.0000001', '1000000000', Number.NaN, Infinity, {}, { valueOf() { throw Error('coercion'); } }]) assert.equal(beaconDecimal(input), null);
});
test('canonical readers reject raw/private fields, invented attribution/outcome and inconsistent counts', () => {
  const row = wire(decode('https://www.facebook.com/tr?ev=Purchase'));
  assert.ok(readBeaconSnapshot(snapshot(row))); assert.ok(readBeaconDocuments([snapshot(row)]));
  for (const invalid of [{ ...row, rawUrl: canary }, { ...row, events: [canary] }, { ...row, statusCodes: [999] }, { ...row, script: { host: 'example.com', pathTemplate: '/private.js' } }, { ...row, attributionConfidence: 'exact-resource' }, { ...row, completedCount: 2 }, { ...row, identifiers: { ...row.identifiers, hashedEmail: hash } }]) assert.equal(readBeaconRows([invalid]), null);
  assert.equal(readBeaconSnapshot({ ...snapshot(row), requestCount: 2 }), null); assert.equal(readBeaconSnapshot({ ...snapshot(row), coverageState: 'paused' }), null);
  assert.equal(readBeaconDocuments([snapshot(row), snapshot(row)]), null);
});
test('source-attributed page calls have their own reader and never invent network completion', () => {
  const row = { ...wire(decode('https://www.facebook.com/tr?ev=Purchase')), evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'exact-resource', script: { host: 'example.com', pathTemplate: '/tracker.js' } };
  assert.ok(readBeaconScriptRows([row])); assert.equal(readBeaconRows([row]), null); assert.equal(readBeaconScriptRows([{ ...row, completedCount: 1 }]), null);
  assert.equal(readBeaconScriptRows([{ ...row, script: { host: 'example.com', pathTemplate: '/account-private.js' } }]), null);
});
