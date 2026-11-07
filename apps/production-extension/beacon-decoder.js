// ADR-030: known destinations are decoded transiently; no source value is retained.
import { BEACON_EVENTS, BEACON_CURRENCIES, beaconDecimal } from './beacon-contracts.js';

const LIMIT = 32768, FIELD_LIMIT = 64;
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const has = (value, key) => value && typeof value === 'object' && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value');
const plainArray = (value, max) => Array.isArray(value) && value.length <= max && Reflect.ownKeys(value).length === value.length + 1;
const googleHosts = new Set(['www.google-analytics.com', 'region1.google-analytics.com', 'analytics.google-analytics.com']);
const yandexHosts = new Set(['mc.yandex.ru', 'mc.yandex.com', 'mc.yandex.com.tr', 'mc.yandex.kz', 'mc.yandex.by', 'mc.webvisor.org']);
export const BEACON_REQUEST_FILTER = Object.freeze({ urls: [
  ...[...googleHosts].flatMap(host => ['/g/collect*', '/j/collect*', '/collect*', '/mp/collect*'].map(path => 'https://' + host + path)),
  ...['www.googleadservices.com', 'www.google.com', 'googleads.g.doubleclick.net'].flatMap(host => ['/pagead/conversion/*', '/pagead/viewthroughconversion/*', '/pagead/1p-conversion/*', '/pagead/1p-viewthroughconversion/*'].map(path => 'https://' + host + path)),
  'https://www.facebook.com/tr*', 'https://graph.facebook.com/v*/*/events*',
  'https://analytics.tiktok.com/api/v*/pixel*', 'https://analytics.tiktok.com/api/v*/i18n/pixel*', 'https://business-api.tiktok.com/open_api/v1.3/event/track/*',
  ...[...yandexHosts].flatMap(host => ['/watch/*', '/collect*'].map(path => 'https://' + host + path)),
  'https://px.ads.linkedin.com/collect*', 'https://api.linkedin.com/rest/conversionEvents*',
] });
export function beaconProfile(raw) {
  if (typeof raw !== 'string' || raw.length > LIMIT) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') return null;
    const host = url.hostname, path = url.pathname;
    if (googleHosts.has(host)) {
      if (path === '/mp/collect') return { service: 'google-analytics', profile: 'ga4-mp-v1', schemaConfidence: 'documented', json: true };
      if (['/g/collect', '/j/collect', '/collect'].includes(path) && (path !== '/collect' || url.searchParams.get('v') === '2')) return { service: 'google-analytics', profile: 'ga4-browser-v1', schemaConfidence: 'transport-candidate', json: false };
    }
    if (['www.googleadservices.com', 'www.google.com', 'googleads.g.doubleclick.net'].includes(host) && /^\/pagead\/(?:1p-)?(?:conversion|viewthroughconversion)\/[0-9]{1,20}\/?$/.test(path)) return { service: 'google-ads', profile: 'google-ads-browser-v1', schemaConfidence: 'transport-candidate', json: false };
    if (host === 'www.facebook.com' && /^\/tr\/?$/.test(path)) return { service: 'meta', profile: 'meta-browser-v1', schemaConfidence: 'transport-candidate', json: false };
    if (host === 'graph.facebook.com' && /^\/v[0-9]{1,2}\.[0-9]{1,2}\/[0-9]{1,24}\/events\/?$/.test(path)) return { service: 'meta', profile: 'meta-capi-v1', schemaConfidence: 'documented', json: true };
    if (host === 'analytics.tiktok.com' && /^\/api\/v[12]\/(?:pixel|i18n\/pixel)\/?$/.test(path)) return { service: 'tiktok', profile: 'tiktok-browser-v1', schemaConfidence: 'endpoint-only', json: false };
    if (host === 'business-api.tiktok.com' && path === '/open_api/v1.3/event/track/') return { service: 'tiktok', profile: 'tiktok-events-v1', schemaConfidence: 'documented', json: true };
    if (yandexHosts.has(host)) {
      if (/^\/watch\/[0-9]{1,20}\/?$/.test(path)) return { service: 'yandex', profile: 'yandex-watch-v1', schemaConfidence: 'endpoint-only', json: false };
      if (path === '/collect') return { service: 'yandex', profile: 'yandex-mp-v1', schemaConfidence: 'documented', json: false };
    }
    if (host === 'px.ads.linkedin.com' && /^\/collect\/?$/.test(path)) return { service: 'linkedin', profile: 'linkedin-image-v1', schemaConfidence: 'documented', json: false };
    if (host === 'api.linkedin.com' && path === '/rest/conversionEvents') return { service: 'linkedin', profile: 'linkedin-capi-v1', schemaConfidence: 'documented', json: true };
  } catch {}
  return null;
}

// A duplicate-key aware JSON parser. Native objects, accessors and streams are never accepted.
export function parseBeaconJson(source) {
  if (typeof source !== 'string' || source.length > LIMIT) return { value: null, status: 'truncated' };
  let index = 0, fields = 0;
  const fail = code => { throw code; };
  const whitespace = () => { while (/\s/.test(source[index] ?? '') && index < source.length) index++; };
  const string = () => {
    const start = index++;
    for (; index < source.length; index++) {
      if (source[index] === '\\') { index++; continue; }
      if (source[index] === '"') { index++; return JSON.parse(source.slice(start, index)); }
    }
    fail('invalid');
  };
  const value = depth => {
    if (depth > 8) fail('truncated');
    whitespace(); const char = source[index];
    if (char === '"') return string();
    if (char === '{') {
      index++; whitespace(); const output = Object.create(null), seen = new Set();
      if (source[index] === '}') { index++; return output; }
      for (;;) {
        whitespace(); if (source[index] !== '"') fail('invalid');
        const key = string(); if (++fields > FIELD_LIMIT) fail('truncated');
        if (seen.has(key)) fail('ambiguous'); seen.add(key);
        whitespace(); if (source[index++] !== ':') fail('invalid');
        output[key] = value(depth + 1); whitespace();
        if (source[index] === '}') { index++; return output; }
        if (source[index++] !== ',') fail('invalid');
      }
    }
    if (char === '[') {
      index++; whitespace(); const output = [];
      if (source[index] === ']') { index++; return output; }
      for (;;) {
        if (output.length >= 32) fail('truncated');
        output.push(value(depth + 1)); whitespace();
        if (source[index] === ']') { index++; return output; }
        if (source[index++] !== ',') fail('invalid');
      }
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) if (source.slice(index, index + literal.length) === literal) { index += literal.length; return result; }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(index));
    if (!number) fail('invalid'); index += number[0].length;
    const result = Number(number[0]); if (!Number.isFinite(result)) fail('invalid'); return result;
  };
  try { const output = value(0); whitespace(); if (index !== source.length || !output || typeof output !== 'object' || Array.isArray(output)) return { value: null, status: 'invalid' }; return { value: output, status: 'complete' }; }
  catch (code) { return { value: null, status: ['truncated', 'ambiguous'].includes(code) ? code : 'invalid' }; }
}

function rawBody(body) {
  const error = own(body, 'error'); if (error !== undefined) return { text: null, status: 'partial' };
  const raw = own(body, 'raw');
  if (!plainArray(raw, 8)) return { text: null, status: 'partial' };
  const buffers = []; let bytes = 0;
  for (let index = 0; index < raw.length; ++index) {
    const item = own(raw, index), buffer = own(item, 'bytes');
    if (has(item, 'file') || !(buffer instanceof ArrayBuffer)) return { text: null, status: 'partial' };
    bytes += buffer.byteLength; if (bytes > LIMIT) return { text: null, status: 'truncated' };
    buffers.push(new Uint8Array(buffer));
  }
  if (!bytes) return { text: '', status: 'complete' };
  const combined = new Uint8Array(bytes); let offset = 0;
  for (const buffer of buffers) { combined.set(buffer, offset); offset += buffer.byteLength; }
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(combined), status: 'complete' }; }
  catch { return { text: null, status: 'invalid' }; }
}
function fieldsFromText(text) {
  const fields = new Map();
  if (typeof text !== 'string' || text.length > LIMIT) return { fields, status: 'truncated' };
  if (!text) return { fields, status: 'complete' };
  const pieces = text.split('&'); if (pieces.length > FIELD_LIMIT) return { fields, status: 'truncated' };
  try {
    for (const piece of pieces) {
      const equal = piece.indexOf('='), key = decodeURIComponent((equal < 0 ? piece : piece.slice(0, equal)).replace(/\+/g, ' ')), value = decodeURIComponent((equal < 0 ? '' : piece.slice(equal + 1)).replace(/\+/g, ' '));
      const values = fields.get(key) ?? []; values.push(value); fields.set(key, values);
    }
    return { fields, status: 'complete' };
  } catch { return { fields: new Map(), status: 'invalid' }; }
}
function fieldsFromForm(form) {
  const fields = new Map(); let bytes = 0, count = 0;
  if (!form || typeof form !== 'object' || Array.isArray(form)) return { fields, status: 'partial' };
  try {
    const keys = Reflect.ownKeys(form); if (keys.length > FIELD_LIMIT) return { fields, status: 'truncated' };
    for (const key of keys) {
      const values = own(form, key);
      if (typeof key !== 'string' || !plainArray(values, 16)) return { fields: new Map(), status: 'invalid' };
      const output = [];
      for (let index = 0; index < values.length; ++index) {
        const value = own(values, index);
        if (typeof value !== 'string') return { fields: new Map(), status: 'invalid' };
        bytes += key.length + value.length; if (++count > FIELD_LIMIT || bytes > LIMIT) return { fields: new Map(), status: 'truncated' };
        output.push(value);
      }
      fields.set(key, output);
    }
    return { fields, status: 'complete' };
  } catch { return { fields: new Map(), status: 'invalid' }; }
}
const worst = (left, right) => ['complete', 'partial', 'invalid', 'truncated', 'ambiguous'].indexOf(left) >= ['complete', 'partial', 'invalid', 'truncated', 'ambiguous'].indexOf(right) ? left : right;
const event = value => typeof value === 'string' && BEACON_EVENTS.includes(value) ? value : 'unknown';
const currency = value => { if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) return null; const normalized = value.toUpperCase(); return BEACON_CURRENCIES.includes(normalized) ? normalized : null; };
function empty(match, complete) {
  return { ...match, events: [], money: [], identifiers: Object.fromEntries(['clientId', 'browserId', 'sessionId', 'userId', 'hashedEmail', 'hashedPhone'].map(key => [key, complete ? 'absent' : 'unknown'])), consent: { gcs: complete ? 'absent' : 'unknown', gcd: complete ? 'absent' : 'unknown', adUserData: complete ? 'absent' : 'unknown', adPersonalization: complete ? 'absent' : 'unknown' }, parameterNames: [], decodeStatus: complete ? 'complete' : 'partial' };
}
function addParameter(result, name) { if (!result.parameterNames.includes(name)) result.parameterNames.push(name); }
function markField(result, container, keys, property, parameter, hashed = false) {
  const values = [];
  for (const key of keys) if (has(container, key)) {
    const value = own(container, key);
    if (Array.isArray(value)) { if (value.length > 16) { result.identifiers[property] = 'ambiguous'; return; } values.push(...value); }
    else values.push(value);
  }
  if (!values.length) return;
  addParameter(result, parameter);
  const valid = values.every(value => (typeof value === 'string' && value.length > 0 || typeof value === 'number' && Number.isFinite(value)) && (!hashed || typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)));
  result.identifiers[property] = !valid ? 'invalid' : values.length > 1 ? 'ambiguous' : 'present';
}
function markMap(result, fields, keys, property, parameter, hashed = false) {
  const container = Object.create(null);
  for (const key of keys) if (fields.has(key)) container[key] = fields.get(key);
  markField(result, container, keys, property, parameter, hashed);
}
function scalar(fields, keys) {
  const values = keys.flatMap(key => fields.get(key) ?? []);
  return { value: values.length === 1 ? values[0] : undefined, present: values.length > 0, ambiguous: values.length > 1 };
}
function addMoney(result, value, unit, purpose, name) {
  if (value === undefined) return;
  addParameter(result, 'value'); if (unit !== undefined) addParameter(result, 'currency');
  const decimal = beaconDecimal(value);
  if (decimal === null || unit !== undefined && currency(unit) === null) { result.decodeStatus = worst(result.decodeStatus, 'partial'); return; }
  if (result.money.length >= 16) { result.decodeStatus = 'truncated'; return; }
  result.money.push({ purpose, value: decimal, currency: currency(unit), event: event(name) });
}
function addMapEvent(result, fields, keys) {
  const found = scalar(fields, keys);
  if (found.present) { addParameter(result, 'event'); result.events.push(found.ambiguous ? 'unknown' : event(found.value)); if (found.ambiguous) result.decodeStatus = 'ambiguous'; }
  return found.value;
}
function consentMap(result, fields) {
  for (const key of ['gcs', 'gcd']) {
    const value = scalar(fields, [key]);
    if (value.present) { result.consent[key] = value.ambiguous ? 'ambiguous' : 'present'; addParameter(result, 'consent'); }
  }
}
function consentJson(result, input) {
  for (const [key, wire] of [['adUserData', 'ad_user_data'], ['adPersonalization', 'ad_personalization']]) if (has(input, wire)) {
    const value = own(input, wire); result.consent[key] = value === 'GRANTED' ? 'granted' : value === 'DENIED' ? 'denied' : 'invalid'; addParameter(result, 'consent');
  }
}
function decodeFields(result, fields) {
  const profile = result.profile;
  if (profile === 'ga4-browser-v1') {
    const name = addMapEvent(result, fields, ['en']);
    markMap(result, fields, ['cid'], 'clientId', 'client-id'); markMap(result, fields, ['sid'], 'sessionId', 'session-id'); markMap(result, fields, ['uid'], 'userId', 'user-id');
    const amount = scalar(fields, ['epn.value', 'ep.value']), unit = scalar(fields, ['cu']);
    if (amount.ambiguous || unit.ambiguous) result.decodeStatus = 'ambiguous'; else addMoney(result, amount.value, unit.value, 'value', name);
    consentMap(result, fields);
  } else if (profile === 'meta-browser-v1') {
    const name = addMapEvent(result, fields, ['ev']);
    markMap(result, fields, ['fbp', 'fbc'], 'browserId', 'browser-id'); markMap(result, fields, ['ud[external_id]'], 'userId', 'user-id');
    markMap(result, fields, ['ud[em]'], 'hashedEmail', 'hashed-email', true); markMap(result, fields, ['ud[ph]'], 'hashedPhone', 'hashed-phone', true);
    const amount = scalar(fields, ['cd[value]']), unit = scalar(fields, ['cd[currency]']);
    if (amount.ambiguous || unit.ambiguous) result.decodeStatus = 'ambiguous'; else addMoney(result, amount.value, unit.value, 'value', name);
  } else if (profile === 'google-ads-browser-v1') {
    const amount = scalar(fields, ['value']), unit = scalar(fields, ['currency_code']);
    result.events.push('conversion'); addParameter(result, 'event');
    if (amount.ambiguous || unit.ambiguous) result.decodeStatus = 'ambiguous'; else addMoney(result, amount.value, unit.value, 'value', 'conversion');
    // Enhanced-conversion wire values are opaque. The parameter is a presence signal.
    if (fields.has('em')) {
      const values = fields.get('em');
      result.identifiers.hashedEmail = values.length > 1 ? 'ambiguous' : /^tv\.1~em\.[a-f0-9]{64}$/i.test(values[0]) || /^[a-f0-9]{64}$/i.test(values[0]) ? 'present' : 'invalid';
      addParameter(result, 'hashed-email');
    }
    consentMap(result, fields);
  } else if (profile === 'yandex-mp-v1') {
    const name = addMapEvent(result, fields, ['t']);
    markMap(result, fields, ['cid'], 'clientId', 'client-id');
    const unit = scalar(fields, ['cu']);
    for (const [key, purpose] of [['ev', 'goal-value'], ['tr', 'revenue']]) { const amount = scalar(fields, [key]); if (amount.ambiguous || unit.ambiguous) result.decodeStatus = 'ambiguous'; else addMoney(result, amount.value, unit.value, purpose, name); }
    if (fields.has('ea')) { addParameter(result, 'event'); if (!result.events.length) result.events.push('unknown'); }
  } else if (profile === 'linkedin-image-v1') {
    if (fields.has('conversionId')) { result.events.push('conversion'); addParameter(result, 'event'); addParameter(result, 'conversion-id'); }
  }
}
function decodeJson(result, input) {
  const profile = result.profile;
  let entries = [];
  if (profile === 'ga4-mp-v1') {
    markField(result, input, ['client_id'], 'clientId', 'client-id'); markField(result, input, ['user_id'], 'userId', 'user-id');
    const user = own(input, 'user_data'); markField(result, user, ['sha256_email_address'], 'hashedEmail', 'hashed-email', true); markField(result, user, ['sha256_phone_number'], 'hashedPhone', 'hashed-phone', true);
    consentJson(result, own(input, 'consent'));
    entries = own(input, 'events');
  } else if (profile === 'meta-capi-v1' || profile === 'tiktok-events-v1') entries = own(input, 'data');
  else if (profile === 'linkedin-capi-v1') {
    entries = [input];
    const userIds = own(own(input, 'user'), 'userIds');
    if (Array.isArray(userIds)) for (const item of userIds.slice(0, 16)) {
      const kind = own(item, 'idType');
      if (kind === 'SHA256_EMAIL') markField(result, item, ['idValue'], 'hashedEmail', 'hashed-email', true);
      if (kind === 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID') markField(result, item, ['idValue'], 'browserId', 'browser-id');
    }
  }
  if (!Array.isArray(entries)) { result.decodeStatus = worst(result.decodeStatus, 'partial'); return; }
  if (entries.length > 16) result.decodeStatus = 'truncated';
  for (const item of entries.slice(0, 16)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { result.decodeStatus = worst(result.decodeStatus, 'partial'); continue; }
    const name = profile === 'ga4-mp-v1' ? own(item, 'name') : profile === 'meta-capi-v1' ? own(item, 'event_name') : profile === 'tiktok-events-v1' ? own(item, 'event') : 'conversion';
    result.events.push(event(name)); addParameter(result, 'event');
    const parameters = profile === 'ga4-mp-v1' ? own(item, 'params') : profile === 'meta-capi-v1' ? own(item, 'custom_data') : profile === 'tiktok-events-v1' ? own(item, 'properties') : own(item, 'conversionValue');
    addMoney(result, own(parameters, profile === 'linkedin-capi-v1' ? 'amount' : 'value'), own(parameters, profile === 'linkedin-capi-v1' ? 'currencyCode' : 'currency'), 'value', name);
    if (profile === 'ga4-mp-v1') markField(result, parameters, ['session_id'], 'sessionId', 'session-id');
    const user = own(item, profile === 'meta-capi-v1' ? 'user_data' : 'user');
    if (profile === 'meta-capi-v1') { markField(result, user, ['em'], 'hashedEmail', 'hashed-email', true); markField(result, user, ['ph'], 'hashedPhone', 'hashed-phone', true); markField(result, user, ['external_id'], 'userId', 'user-id'); markField(result, user, ['fbp', 'fbc'], 'browserId', 'browser-id'); }
    if (profile === 'tiktok-events-v1') { markField(result, user, ['email'], 'hashedEmail', 'hashed-email', true); markField(result, user, ['phone'], 'hashedPhone', 'hashed-phone', true); markField(result, user, ['external_id'], 'userId', 'user-id'); markField(result, user, ['ttp', 'ttclid'], 'browserId', 'browser-id'); }
  }
}

export function decodeBeacon(input) {
  const raw = own(input, 'url'), match = beaconProfile(raw);
  if (!match) return null;
  const method = own(input, 'method'), json = match.json; delete match.json; match.destinationHost = new URL(raw).hostname;
  const query = fieldsFromText(new URL(raw).search.slice(1));
  const body = own(input, 'body'), hasBody = own(input, 'bodyAvailable') === true;
  let status = query.status, fields = query.fields, parsed = null;
  if (method === 'POST' || method === 'PUT') {
    if (!hasBody) status = worst(status, 'partial');
    else if (json) {
      const form = own(body, 'formData');
      if (match.profile === 'meta-capi-v1' && form !== undefined) {
        const fields = fieldsFromForm(form), data = scalar(fields.fields, ['data']); status = worst(status, fields.status);
        if (data.ambiguous) status = 'ambiguous';
        else if (typeof data.value === 'string') { const decoded = parseBeaconJson('{"data":' + data.value + '}'); status = worst(status, decoded.status); parsed = decoded.value; }
        else status = worst(status, 'partial');
      } else {
        const bytes = rawBody(body); status = worst(status, bytes.status);
        if (bytes.text !== null) { const decoded = parseBeaconJson(bytes.text); status = worst(status, decoded.status); parsed = decoded.value; }
      }
    } else {
      const form = own(body, 'formData');
      const bytes = form === undefined ? rawBody(body) : null;
      const decoded = form === undefined ? bytes.text === null ? { fields: new Map(), status: bytes.status } : bytes.text !== '' && (!/^[^&=\s]+=[\s\S]*$/.test(bytes.text) || /[\r\n]/.test(bytes.text)) ? { fields: new Map(), status: 'partial' } : fieldsFromText(bytes.text) : fieldsFromForm(form);
      status = worst(status, decoded.status);
      for (const [key, values] of decoded.fields) fields.set(key, [...(fields.get(key) ?? []), ...values]);
      if ([...fields.values()].reduce((count, values) => count + values.length, 0) > FIELD_LIMIT) { fields = new Map(); status = 'truncated'; }
    }
  } else if (json) status = worst(status, 'partial');
  // Timing does not report a method or upload body; positive query fields stay useful.
  if (method === 'unknown') status = worst(status, 'partial');
  const result = empty(match, status === 'complete'); result.decodeStatus = status;
  if (result.schemaConfidence === 'endpoint-only') { const endpointOnly = empty(match, false); endpointOnly.decodeStatus = 'endpoint-only'; return endpointOnly; }
  if (json) { if (parsed) decodeJson(result, parsed); }
  else decodeFields(result, fields);
  return result;
}
