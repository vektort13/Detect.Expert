// ADR-069: pure, bounded cookie file parsing and native field conversion.
// Cookie values never leave the caller's memory through this module.
import { canonicalCookieSite, cookieDomainScopeSupported } from './cookie-site.js';
export const COOKIE_TRANSFER_LIMITS = Object.freeze({ bytes: 16 * 1024 * 1024, cookies: 10000, stores: 64, name: 4096, value: 65536, path: 4096, domain: 253, string: 4096, depth: 12, nodes: 220000, chromePairBytes: 4096, chromePathBytes: 1024 });
const CODES = new Set(['invalid-input', 'invalid-json', 'invalid-format', 'unsupported-version', 'invalid-cookie', 'duplicate-key', 'duplicate-cookie', 'duplicate-store', 'invalid-domain', 'invalid-path', 'invalid-expiration', 'invalid-samesite', 'invalid-prefix', 'limit-exceeded', 'unsupported-partition', 'unsupported-first-party-domain', 'unsupported-samesite', 'unsupported-format', 'lossy-export', 'invalid-store', 'unsupported-field']);
export class CookieTransferError extends Error {
  constructor(code = 'invalid-input') { const safe = typeof code === 'string' && CODES.has(code) ? code : 'invalid-input'; super(safe); this.name = 'CookieTransferError'; this.code = safe; }
}
const fail = code => { throw new CookieTransferError(code); };
const own = (value, key) => { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('invalid-input'); return descriptor.value; };
const has = (value, key) => Object.hasOwn(value, key);
function object(value, keys, { required = keys, code = 'invalid-input' } = {}) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code);
  const found = Reflect.ownKeys(value);
  if (found.some(key => typeof key !== 'string' || !keys.includes(key)) || required.some(key => !has(value, key))) fail(code);
  for (const key of found) own(value, key);
  return value;
}
function wellFormed(value) {
  for (let i = 0; i < value.length; i++) { const code = value.charCodeAt(i); if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; } else if (code >= 0xdc00 && code <= 0xdfff) return false; }
  return true;
}
function string(value, max, { empty = true, controls = false, code = 'invalid-cookie' } = {}) {
  if (typeof value !== 'string' || value.length > max || !empty && !value || !wellFormed(value) || !controls && /[\u0000-\u001f\u007f]/u.test(value)) fail(code);
  return value;
}
function bool(value) { if (typeof value !== 'boolean') fail('invalid-cookie'); return value; }
function browserName(value) { if (!['chrome', 'firefox', 'unknown'].includes(value)) fail('invalid-format'); return value; }
function store(value) { return string(value, 256, { empty: false, code: 'invalid-store' }); }
function array(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('invalid-input');
  if (value.length > maximum) fail('limit-exceeded');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length))) fail('invalid-input');
  for (let i = 0; i < value.length; i++) if (!descriptors[i] || !has(descriptors[i], 'value')) fail('invalid-input');
  return value;
}

// The parser rejects duplicate decoded keys before JSON.parse could discard them.
export function parseCookieJson(text, { maxBytes = COOKIE_TRANSFER_LIMITS.bytes } = {}) {
  if (typeof text !== 'string' || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1024 * 1024) fail('invalid-input');
  if (text.length > maxBytes || new TextEncoder().encode(text).byteLength > maxBytes) fail('limit-exceeded');
  let index = 0, nodes = 0;
  const whitespace = () => { while (index < text.length && /[\t\n\r ]/u.test(text[index])) index++; };
  function quoted() {
    const start = index++;
    while (index < text.length) {
      if (text[index] === '"') { index++; try { return JSON.parse(text.slice(start, index)); } catch { fail('invalid-json'); } }
      if (text[index] === '\\') index += 2; else index++;
    }
    fail('invalid-json');
  }
  function value(depth) {
    if (++nodes > COOKIE_TRANSFER_LIMITS.nodes || depth > COOKIE_TRANSFER_LIMITS.depth) fail('limit-exceeded');
    whitespace(); const char = text[index];
    if (char === '"') return quoted();
    if (char === '{') {
      index++; whitespace(); const result = {}, seen = new Set();
      if (text[index] === '}') { index++; return result; }
      for (;;) {
        whitespace(); if (text[index] !== '"') fail('invalid-json'); const key = quoted();
        if (seen.has(key)) fail('duplicate-key');
        if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('invalid-json');
        seen.add(key); whitespace(); if (text[index++] !== ':') fail('invalid-json'); result[key] = value(depth + 1); whitespace();
        if (text[index] === '}') { index++; return result; } if (text[index++] !== ',') fail('invalid-json');
      }
    }
    if (char === '[') {
      index++; whitespace(); const result = [];
      if (text[index] === ']') { index++; return result; }
      for (;;) { result.push(value(depth + 1)); whitespace(); if (text[index] === ']') { index++; return result; } if (text[index++] !== ',') fail('invalid-json'); }
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) if (text.startsWith(literal, index)) { index += literal.length; return result; }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(index));
    if (!match) fail('invalid-json'); index += match[0].length; const result = Number(match[0]); if (!Number.isFinite(result)) fail('invalid-json'); return result;
  }
  const result = value(0); whitespace(); if (index !== text.length) fail('invalid-json'); return result;
}

function domain(value, hostOnly) {
  string(value, COOKIE_TRANSFER_LIMITS.domain, { empty: false, code: 'invalid-domain' });
  const input = value.startsWith('.') ? value.slice(1) : value;
  if (!input || /[\s\\/?#@%]/u.test(input) || input.startsWith('.') || input.includes(':') && !/^\[[0-9a-f:.]+\]$/iu.test(input)) fail('invalid-domain');
  let url; try { url = new URL(`https://${input}/`); } catch { fail('invalid-domain'); }
  if (!url.hostname || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) fail('invalid-domain');
  const host = url.hostname.toLowerCase();
  if (host.length > COOKIE_TRANSFER_LIMITS.domain || !host.startsWith('[') && !/^[a-z0-9_.-]+$/u.test(host)) fail('invalid-domain');
  if (!hostOnly && (host.startsWith('[') || /^\d+(?:\.\d+){3}$/u.test(host))) fail('invalid-domain');
  return hostOnly ? host : `.${host}`;
}
function partition(value) {
  if (value === null) return null;
  object(value, ['topLevelSite', 'hasCrossSiteAncestor'], { code: 'unsupported-partition' });
  const topLevelSite = string(own(value, 'topLevelSite'), COOKIE_TRANSFER_LIMITS.string, { empty: false, code: 'unsupported-partition' });
  let parsed; try { parsed = new URL(topLevelSite); } catch { fail('unsupported-partition'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || !['', '/'].includes(parsed.pathname) || parsed.search || parsed.hash) fail('unsupported-partition');
  const ancestor = own(value, 'hasCrossSiteAncestor'); if (ancestor !== null && typeof ancestor !== 'boolean') fail('unsupported-partition');
  return { topLevelSite: parsed.origin, hasCrossSiteAncestor: ancestor };
}
const FIELDS = ['name', 'value', 'domain', 'path', 'hostOnly', 'secure', 'httpOnly', 'sameSite', 'session', 'expirationDate', 'storeId', 'partitionKey', 'firstPartyDomain'];
export function validateCookieRecord(input) {
  object(input, FIELDS, { code: 'invalid-cookie' });
  const name = string(own(input, 'name'), COOKIE_TRANSFER_LIMITS.name);
  if (/[()<>@,;:\\"/\[\]?={}\s]/u.test(name)) fail('invalid-cookie');
  const value = string(own(input, 'value'), COOKIE_TRANSFER_LIMITS.value);
  const hostOnly = bool(own(input, 'hostOnly')), secure = bool(own(input, 'secure')), httpOnly = bool(own(input, 'httpOnly')), session = bool(own(input, 'session'));
  const cookieDomain = domain(own(input, 'domain'), hostOnly);
  const path = string(own(input, 'path'), COOKIE_TRANSFER_LIMITS.path, { empty: false, code: 'invalid-path' }); if (!path.startsWith('/')) fail('invalid-path');
  const sameSite = own(input, 'sameSite'); if (!['no_restriction', 'lax', 'strict', 'unspecified'].includes(sameSite)) fail('invalid-samesite');
  if (sameSite === 'no_restriction' && !secure) fail('invalid-samesite');
  const expirationDate = own(input, 'expirationDate');
  if (session ? expirationDate !== null : typeof expirationDate !== 'number' || !Number.isFinite(expirationDate) || expirationDate < 0) fail('invalid-expiration');
  const partitionKey = partition(own(input, 'partitionKey')); if (partitionKey && !secure) fail('unsupported-partition');
  const firstPartyDomain = own(input, 'firstPartyDomain'); if (firstPartyDomain !== null) string(firstPartyDomain, COOKIE_TRANSFER_LIMITS.string, { code: 'unsupported-first-party-domain' });
  if (name.startsWith('__Secure-') && !secure || name.startsWith('__Host-') && (!secure || !hostOnly || path !== '/') || (name.startsWith('__Http-') || name.startsWith('__Host-Http-')) && (!secure || !httpOnly)) fail('invalid-prefix');
  return { name, value, domain: cookieDomain, path, hostOnly, secure, httpOnly, sameSite, session, expirationDate, storeId: store(own(input, 'storeId')), partitionKey, firstPartyDomain };
}
export function normalizeNativeCookie(raw, { browser = 'unknown', storeId } = {}) {
  browserName(browser);
  // Firefox native API results can use another extension compartment's prototypes.
  // Admit only own data fields into a fresh local canonical record; imported
  // records still pass the strict same-realm object() validator unchanged.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('invalid-cookie');
  // Native implementations may append read-only metadata. Only known own data
  // fields are admitted; unknown fields are not inspected or sent back to set.
  if (Reflect.ownKeys(raw).some(key => typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key))) fail('invalid-cookie');
  for (const key of ['name', 'value', 'domain', 'path', 'hostOnly', 'secure', 'httpOnly', 'sameSite', 'session']) own(raw, key);
  const key = has(raw, 'partitionKey') ? own(raw, 'partitionKey') : null;
  let normalizedKey = null;
  if (key !== null) {
    if (!key || typeof key !== 'object' || Array.isArray(key) || Reflect.ownKeys(key).some(name => typeof name !== 'string' || !['topLevelSite', 'hasCrossSiteAncestor'].includes(name))) fail('unsupported-partition');
    normalizedKey = { topLevelSite: own(key, 'topLevelSite'), hasCrossSiteAncestor: has(key, 'hasCrossSiteAncestor') ? own(key, 'hasCrossSiteAncestor') : null };
  }
  const session = own(raw, 'session');
  if (session === true && has(raw, 'expirationDate') && own(raw, 'expirationDate') !== null) fail('invalid-expiration');
  return validateCookieRecord({ name: own(raw, 'name'), value: own(raw, 'value'), domain: own(raw, 'domain'), path: own(raw, 'path'), hostOnly: own(raw, 'hostOnly'), secure: own(raw, 'secure'), httpOnly: own(raw, 'httpOnly'), sameSite: own(raw, 'sameSite'), session, expirationDate: session ? null : has(raw, 'expirationDate') ? own(raw, 'expirationDate') : null, storeId: storeId ?? (has(raw, 'storeId') ? own(raw, 'storeId') : ''), partitionKey: normalizedKey, firstPartyDomain: has(raw, 'firstPartyDomain') ? own(raw, 'firstPartyDomain') : null });
}
export function cookieIdentity(input) {
  const record = validateCookieRecord(input);
  return JSON.stringify([record.storeId, record.domain, record.hostOnly, record.path, record.name, record.partitionKey?.topLevelSite ?? null, record.partitionKey?.hasCrossSiteAncestor ?? null, record.firstPartyDomain ?? '']);
}
export function cookieSignature(input) { return JSON.stringify(validateCookieRecord(input)); }
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function document(records, browser, declaredStores = null) {
  let totalBytes = 0;
  const cookies = array(records, COOKIE_TRANSFER_LIMITS.cookies).map(record => {
    const normalized = validateCookieRecord(record);
    totalBytes += new TextEncoder().encode(JSON.stringify(normalized)).byteLength;
    if (totalBytes > COOKIE_TRANSFER_LIMITS.bytes) fail('limit-exceeded');
    return normalized;
  }), seen = new Set();
  for (const record of cookies) { const identity = cookieIdentity(record); if (seen.has(identity)) fail('duplicate-cookie'); seen.add(identity); }
  cookies.sort((a, b) => compare(cookieIdentity(a), cookieIdentity(b)));
  let stores;
  if (declaredStores !== null) {
    stores = array(declaredStores, COOKIE_TRANSFER_LIMITS.stores).map(entry => { object(entry, ['id'], { code: 'invalid-store' }); return { id: store(own(entry, 'id')) }; });
    const ids = new Set(); for (const entry of stores) { if (ids.has(entry.id)) fail('duplicate-store'); ids.add(entry.id); }
    if (cookies.some(record => !ids.has(record.storeId))) fail('invalid-store');
  } else stores = [...new Set(cookies.map(record => record.storeId))].map(id => ({ id }));
  if (stores.length > COOKIE_TRANSFER_LIMITS.stores) fail('limit-exceeded'); stores.sort((a, b) => compare(a.id, b.id));
  return { format: 'detect.expert.cookies', formatVersion: 1, source: { browser: browserName(browser) }, stores, cookies };
}
// Automation-tool arrays (Playwright storageState/context.cookies, Puppeteer,
// CDP Network.Cookie and snake_case dumps): `expires` is Unix seconds and -1,
// null or absence means a session cookie; SameSite is Strict/Lax/None. Only a
// closed list of attributes the extension API can neither set nor read back is
// accepted and ignored; any other field rejects the whole file before preview.
const TOOL_ONLY_FIELDS = ['expires', 'http_only', 'same_site', 'size', 'priority', 'sourceScheme', 'sourcePort', 'sameParty', 'partitionKeyOpaque'];
const TOOL_FIELDS = ['name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite', 'session', 'partitionKey', ...TOOL_ONLY_FIELDS];
const TOOL_SAME_SITE = new Map([['strict', 'strict'], ['lax', 'lax'], ['none', 'no_restriction'], ['no_restriction', 'no_restriction'], ['unspecified', 'unspecified']]);
function toolAlias(raw, camel, snake) {
  if (has(raw, camel) && has(raw, snake)) fail('unsupported-field');
  return has(raw, camel) ? own(raw, camel) : has(raw, snake) ? own(raw, snake) : undefined;
}
function toolPartition(value) {
  if (value === null) return null;
  // Playwright and older Puppeteer give the top-level site as a string; CDP uses
  // topLevelSite and Puppeteer sourceOrigin for the same site. A missing
  // ancestor bit stays unknown (null), so browser-specific checks still apply.
  if (typeof value === 'string') return { topLevelSite: value, hasCrossSiteAncestor: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('unsupported-partition');
  const site = has(value, 'topLevelSite') ? 'topLevelSite' : 'sourceOrigin';
  object(value, [site, 'hasCrossSiteAncestor'], { required: [site], code: 'unsupported-partition' });
  return { topLevelSite: own(value, site), hasCrossSiteAncestor: has(value, 'hasCrossSiteAncestor') ? own(value, 'hasCrossSiteAncestor') : null };
}
function toolRecord(raw) {
  object(raw, TOOL_FIELDS, { required: ['name', 'value', 'domain', 'path', 'secure'], code: 'unsupported-field' });
  const size = has(raw, 'size') ? own(raw, 'size') : 0, port = has(raw, 'sourcePort') ? own(raw, 'sourcePort') : -1;
  if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(port) || port < -1 || port > 65535 || has(raw, 'priority') && !['Low', 'Medium', 'High'].includes(own(raw, 'priority')) || has(raw, 'sourceScheme') && !['Unset', 'NonSecure', 'Secure'].includes(own(raw, 'sourceScheme')) || has(raw, 'sameParty') && own(raw, 'sameParty') !== false) fail('unsupported-field');
  // An opaque partition belongs to no site that could be named again.
  if (has(raw, 'partitionKeyOpaque') && own(raw, 'partitionKeyOpaque') !== false) fail('unsupported-partition');
  const domainValue = own(raw, 'domain'); if (typeof domainValue !== 'string') fail('invalid-domain');
  const httpOnly = toolAlias(raw, 'httpOnly', 'http_only'); if (httpOnly === undefined) fail('unsupported-field');
  const suppliedSite = toolAlias(raw, 'sameSite', 'same_site');
  const sameSite = suppliedSite === undefined || suppliedSite === null ? 'unspecified' : typeof suppliedSite === 'string' ? TOOL_SAME_SITE.get(suppliedSite.toLowerCase()) : undefined;
  if (!sameSite) fail('invalid-samesite');
  const expires = has(raw, 'expires') ? own(raw, 'expires') : null;
  const session = expires === null || expires === -1;
  if (!session && (typeof expires !== 'number' || !Number.isFinite(expires) || expires < 0)) fail('invalid-expiration');
  if (has(raw, 'session') && own(raw, 'session') !== session) fail('invalid-expiration');
  return validateCookieRecord({ name: own(raw, 'name'), value: own(raw, 'value'), domain: domainValue, path: own(raw, 'path'), hostOnly: !domainValue.startsWith('.'), secure: own(raw, 'secure'), httpOnly, sameSite, session, expirationDate: session ? null : expires, storeId: 'import', partitionKey: toolPartition(has(raw, 'partitionKey') ? own(raw, 'partitionKey') : null), firstPartyDomain: null });
}
function externalArray(input) {
  const records = array(input, COOKIE_TRANSFER_LIMITS.cookies);
  // One reading per file: a tool-only field anywhere makes every record a tool
  // record, so extension fields in the same file are rejected, not mixed.
  if (records.some(raw => raw && typeof raw === 'object' && TOOL_ONLY_FIELDS.some(key => has(raw, key)))) return records.map(toolRecord);
  return records.map(raw => {
    object(raw, [...FIELDS, 'id'], { required: ['name', 'value', 'domain', 'path', 'secure', 'httpOnly'], code: 'unsupported-field' });
    const domainValue = own(raw, 'domain'); if (typeof domainValue !== 'string') fail('invalid-domain');
    const session = has(raw, 'session') ? own(raw, 'session') : !has(raw, 'expirationDate') || own(raw, 'expirationDate') === null;
    const key = has(raw, 'partitionKey') ? own(raw, 'partitionKey') : null;
    let normalizedKey = null;
    if (key !== null) { object(key, ['topLevelSite', 'hasCrossSiteAncestor'], { required: ['topLevelSite'], code: 'unsupported-partition' }); normalizedKey = { topLevelSite: own(key, 'topLevelSite'), hasCrossSiteAncestor: has(key, 'hasCrossSiteAncestor') ? own(key, 'hasCrossSiteAncestor') : null }; }
    const aliases = { None: 'no_restriction', Lax: 'lax', Strict: 'strict' }, suppliedSite = has(raw, 'sameSite') ? own(raw, 'sameSite') : 'unspecified';
    if (typeof suppliedSite !== 'string') fail('invalid-samesite');
    return validateCookieRecord({ name: own(raw, 'name'), value: own(raw, 'value'), domain: domainValue, path: own(raw, 'path'), hostOnly: has(raw, 'hostOnly') ? own(raw, 'hostOnly') : !domainValue.startsWith('.'), secure: own(raw, 'secure'), httpOnly: own(raw, 'httpOnly'), sameSite: has(aliases, suppliedSite) ? aliases[suppliedSite] : suppliedSite, session, expirationDate: has(raw, 'expirationDate') ? own(raw, 'expirationDate') : null, storeId: has(raw, 'storeId') ? own(raw, 'storeId') : 'import', partitionKey: normalizedKey, firstPartyDomain: has(raw, 'firstPartyDomain') ? own(raw, 'firstPartyDomain') : null });
  });
}
function netscape(text) {
  const records = [];
  for (let line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const httpOnly = line.startsWith('#HttpOnly_'); if (httpOnly) line = line.slice(10); else if (line.startsWith('#')) continue;
    const fields = line.split('\t'); if (fields.length !== 7 || !['TRUE', 'FALSE'].includes(fields[1]) || !['TRUE', 'FALSE'].includes(fields[3]) || !/^\d+$/u.test(fields[4])) fail('invalid-format');
    if (records.length >= COOKIE_TRANSFER_LIMITS.cookies) fail('limit-exceeded');
    const expires = Number(fields[4]); if (!Number.isSafeInteger(expires)) fail('invalid-expiration');
    records.push(validateCookieRecord({ name: fields[5], value: fields[6], domain: fields[0], path: fields[2], hostOnly: fields[1] === 'FALSE', secure: fields[3] === 'TRUE', httpOnly, sameSite: 'unspecified', session: expires === 0, expirationDate: expires === 0 ? null : expires, storeId: 'import', partitionKey: null, firstPartyDomain: null }));
  }
  return records;
}
export function parseCookieImport(text, { format = 'auto' } = {}) {
  if (typeof text !== 'string' || text.length > COOKIE_TRANSFER_LIMITS.bytes || new TextEncoder().encode(text).byteLength > COOKIE_TRANSFER_LIMITS.bytes) fail('limit-exceeded');
  if (!['auto', 'json', 'netscape'].includes(format)) fail('unsupported-format');
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (format === 'netscape' || format === 'auto' && !/^[\t\n\r ]*[\[{]/u.test(clean)) return document(netscape(clean), 'unknown');
  const input = parseCookieJson(clean);
  if (Array.isArray(input)) return document(externalArray(input), 'unknown');
  object(input, ['format', 'formatVersion', 'source', 'stores', 'cookies'], { code: 'invalid-format' });
  if (own(input, 'format') !== 'detect.expert.cookies') fail('invalid-format'); if (own(input, 'formatVersion') !== 1) fail('unsupported-version');
  const source = own(input, 'source'); object(source, ['browser'], { code: 'invalid-format' });
  return document(own(input, 'cookies'), own(source, 'browser'), own(input, 'stores'));
}
export function exportCookieRecords(records, { format = 'json', browser = 'unknown', allowLossy = false } = {}) {
  const normalized = document(records, browser), warnings = [];
  if (format === 'json') {
    const text = `${JSON.stringify(normalized, null, 2)}\n`;
    if (new TextEncoder().encode(text).byteLength > COOKIE_TRANSFER_LIMITS.bytes) fail('limit-exceeded');
    return { text, format, warnings };
  }
  if (format !== 'netscape') fail('unsupported-format');
  if (normalized.cookies.some(record => record.partitionKey || record.firstPartyDomain)) fail('unsupported-partition');
  if (normalized.stores.length > 1) fail('invalid-store');
  if (normalized.cookies.some(record => record.sameSite !== 'unspecified' || !record.session && !Number.isInteger(record.expirationDate))) warnings.push('netscape-attributes-lost');
  if (allowLossy !== true) fail('lossy-export');
  warnings.push('netscape-store-lost');
  const lines = normalized.cookies.map(record => {
    if (!record.session && Math.floor(record.expirationDate) <= 0) fail('invalid-expiration');
    if ([record.name, record.value, record.domain, record.path].some(value => /[\t\r\n]/u.test(value))) fail('invalid-format');
    return [`${record.httpOnly ? '#HttpOnly_' : ''}${record.domain}`, record.hostOnly ? 'FALSE' : 'TRUE', record.path, record.secure ? 'TRUE' : 'FALSE', record.session ? '0' : String(Math.floor(record.expirationDate)), record.name, record.value].join('\t');
  });
  return { text: '# Netscape HTTP Cookie File\n' + (lines.length ? lines.join('\n') + '\n' : ''), format, warnings };
}
export function cookieSetDetails(input, { storeId, browser = 'unknown', capabilities = {} } = {}) {
  const record = validateCookieRecord(input); browserName(browser);
  const host = record.hostOnly ? record.domain : record.domain.slice(1);
  if (!record.hostOnly && !cookieDomainScopeSupported(record.domain.slice(1))) fail('invalid-domain');
  if (browser === 'chrome') {
    if (new TextEncoder().encode(record.name + record.value).byteLength > COOKIE_TRANSFER_LIMITS.chromePairBytes || !record.name && !record.value || record.value.includes(';') || /^ | $/u.test(record.value)) fail('invalid-cookie');
    // Chromium URL-canonicalizes the explicit Cookie.path. Do not preflight
    // one identity and then mutate its encoded/normalized sibling instead.
    if (record.path.length > COOKIE_TRANSFER_LIMITS.chromePathBytes || /[\u0080-\uffff\s\\?#"<>`{}|^;]/u.test(record.path) || record.path.split('/').some(part => ['.', '..'].includes(part.replace(/%2e/giu, '.')))) fail('invalid-path');
  }
  const flags = { partitionKey: browser !== 'unknown', hasCrossSiteAncestor: browser === 'chrome', firstPartyDomain: browser === 'firefox', unspecifiedSameSite: browser === 'chrome' };
  object(capabilities, Object.keys(flags), { required: [], code: 'invalid-input' }); for (const key of Object.keys(capabilities)) { if (typeof own(capabilities, key) !== 'boolean') fail('invalid-input'); flags[key] = own(capabilities, key); }
  if (record.sameSite === 'unspecified' && !flags.unspecifiedSameSite) fail('unsupported-samesite');
  if (record.partitionKey && (!flags.partitionKey || record.partitionKey.hasCrossSiteAncestor !== null && !flags.hasCrossSiteAncestor)) fail('unsupported-partition');
  // A browser canonicalizes the partition to a schemeful site. Reject any key
  // that would be written into a different identity than the preview/readback.
  if (record.partitionKey && (canonicalCookieSite(record.partitionKey.topLevelSite) !== record.partitionKey.topLevelSite || browser === 'chrome' && record.partitionKey.hasCrossSiteAncestor === null)) fail('unsupported-partition');
  if (record.partitionKey?.hasCrossSiteAncestor === false) {
    const site = canonicalCookieSite(`https://${host}/`);
    // Firefox's ancestor bit uses the host relationship; native Firefox 138
    // preserves false across an HTTP/HTTPS top-level scheme difference.
    if (!site || (browser === 'firefox' ? new URL(site).hostname !== new URL(record.partitionKey.topLevelSite).hostname : site !== record.partitionKey.topLevelSite)) fail('unsupported-partition');
  }
  if (record.firstPartyDomain && !flags.firstPartyDomain) fail('unsupported-first-party-domain');
  // HTTPS is the native setter context, not a network request. Keep the Secure
  // attribute independent so existing Secure cookies can be edited to false.
  const details = { url: `https://${host}/`, name: record.name, value: record.value, path: record.path, secure: record.secure, httpOnly: record.httpOnly, sameSite: record.sameSite, storeId: store(storeId ?? record.storeId) };
  if (!record.hostOnly) details.domain = record.domain;
  if (!record.session) details.expirationDate = record.expirationDate;
  if (record.partitionKey) { details.partitionKey = { topLevelSite: record.partitionKey.topLevelSite }; if (record.partitionKey.hasCrossSiteAncestor !== null) details.partitionKey.hasCrossSiteAncestor = record.partitionKey.hasCrossSiteAncestor; }
  if (flags.firstPartyDomain) details.firstPartyDomain = record.firstPartyDomain ?? '';
  return details;
}
