// Cookie catalog classification uses names and bounded metadata only.
// No cookie values, URLs, paths, store IDs, opaque partition keys, or hashes.

const getOwnDescriptor = Object.getOwnPropertyDescriptor;
const MAX_RULES = 8192;
const MAX_MATCHES = 8;
const CATEGORIES = new Set(['necessary', 'functional', 'analytics', 'advertising', 'security', 'consent', 'unknown']);
const GENERIC_NAMES = new Set(['id', 'uid', 'uuid', 'user', 'userid', 'user_id', 'visitor', 'visitorid', 'visitor_id', 'session', 'sessionid', 'session_id', 'sid', 'token', 'auth', 'access_token', 'refresh_token', 'lang', 'language', 'locale', 'consent', 'gdpr', 'i', 'c', 'b', 'phpseid', 'phpsessid', 'jsessionid']);
// A community category cannot promote generic session/authentication conventions
// to tracking, even when an upstream row includes a vendor domain.
const AMBIGUOUS_AUTH_NAMES = new Set(['session', 'sessionid', 'session_id', 'sid', 'auth', 'authorization', 'access_token', 'refresh_token', 'phpsessid', 'jsessionid', 'asp.net_sessionid', 'connect.sid', 'csrftoken', 'csrf_token', 'xsrf-token', 'xsrf_token']);
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,256}$/;
const DISPLAY_NAME = /^[A-Za-z0-9_.-]{1,80}$/;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;

function ownData(value, key) {
  if (value === null || typeof value !== 'object') return undefined;
  try {
    const descriptor = getOwnDescriptor(value, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
  } catch { return undefined; }
}

export function normalizeCookieDomain(value) {
  if (typeof value !== 'string' || value.length > 254) return '';
  const host = value.startsWith('.') ? value.slice(1).toLowerCase() : value.toLowerCase();
  if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) return '';
  return host;
}

function sourceUrl(value) {
  if (typeof value !== 'string' || value.length > 512 || UNSAFE_TEXT.test(value) || !/^https:\/\//.test(value)) return '';
  try {
    const url = new URL(value);
    return url.username || url.password ? '' : url.href;
  } catch { return ''; }
}

function displayCatalogName(name) {
  return name.length <= 80 ? name : name.slice(0, 77) + '...';
}

function candidateDisplayName(candidates) {
  const exact = candidates.find(rule => rule.match === 'exact');
  if (exact) return displayCatalogName(exact.name);
  const prefixes = candidates.filter(rule => rule.match === 'prefix').sort((a, b) => b.name.length - a.name.length || compareIds(a.id, b.id));
  return prefixes.length ? displayCatalogName(prefixes[0].name + '*') : '';
}

function nameReferencePurpose(name, matches) {
  const lower = name.toLowerCase();
  if (GENERIC_NAMES.has(lower) || AMBIGUOUS_AUTH_NAMES.has(lower)) return '';
  const references = [];
  for (const rule of matches) {
    if (rule.match === 'prefix' && (GENERIC_NAMES.has(rule.name.toLowerCase()) || AMBIGUOUS_AUTH_NAMES.has(rule.name.toLowerCase()) || rule.name === '__Secure-' || rule.name === '__Host-')) continue;
    if (!rule.purpose.trim()) continue;
    const reference = (rule.owner ? rule.owner + ' — ' : '') + rule.purpose;
    if (!references.includes(reference)) references.push(reference);
    if (references.length === 3) break;
  }
  return references.length ? ('Catalogue name match: ' + references.join(' / ')).slice(0, 512) : '';
}

function unknown(confidence = 'unknown', matches = [], name = '', purpose = '') {
  const sorted = matches.slice().sort((a, b) => b.rank - a.rank || compareIds(a.id, b.id));
  return {
    category: 'unknown', owner: '', purpose, confidence, tracking: false,
    ruleIds: sorted.map(rule => rule.id).slice(0, MAX_MATCHES),
    sourceUrls: [...new Set(sorted.flatMap(rule => rule.sourceUrls))].sort().slice(0, MAX_MATCHES),
    name
  };
}

function domainMatches(host, domain) {
  return host === domain || host.endsWith('.' + domain);
}

function compareIds(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function ownArrayValues(array) {
  const values = [];
  for (let index = 0; index < array.length; index++) values.push(ownData(array, String(index)));
  return values;
}

function compileRule(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const id = ownData(raw, 'id');
  const name = ownData(raw, 'name');
  const match = ownData(raw, 'match');
  const category = ownData(raw, 'category');
  const confidence = ownData(raw, 'confidence');
  const domainContext = ownData(raw, 'domainContext');
  const domains = ownData(raw, 'domains');
  const owner = ownData(raw, 'owner');
  const purpose = ownData(raw, 'purpose');
  const urls = ownData(raw, 'sourceUrls');
  let lengthDescriptor, suffixDescriptor;
  try { lengthDescriptor = getOwnDescriptor(raw, 'nameLength'); suffixDescriptor = getOwnDescriptor(raw, 'nameSuffix'); }
  catch { return null; }
  if (lengthDescriptor && !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') || suffixDescriptor && !Object.prototype.hasOwnProperty.call(suffixDescriptor, 'value')) return null;
  const nameLength = ownData(raw, 'nameLength'), nameSuffix = ownData(raw, 'nameSuffix');
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,96}$/.test(id) || typeof name !== 'string' || !COOKIE_NAME.test(name)) return null;
  if (!['exact', 'prefix'].includes(match) || !CATEGORIES.has(category) || !['documented', 'community'].includes(confidence)) return null;
  if (!['any', 'domain', 'unassessed'].includes(domainContext) || !Array.isArray(domains) || domains.length > 16) return null;
  if (typeof owner !== 'string' || owner.length > 128 || UNSAFE_TEXT.test(owner) || typeof purpose !== 'string' || purpose.length > 512 || UNSAFE_TEXT.test(purpose)) return null;
  if (!Array.isArray(urls) || urls.length > 16 || match === 'prefix' && name.length < 2) return null;
  if (nameLength !== undefined && (match !== 'prefix' || !Number.isInteger(nameLength) || nameLength <= name.length || nameLength > 256)) return null;
  if (nameSuffix !== undefined && (match !== 'prefix' || !['digits', 'hex'].includes(nameSuffix))) return null;
  const normalizedDomains = ownArrayValues(domains).map(normalizeCookieDomain).filter(Boolean);
  if (normalizedDomains.length !== domains.length || domainContext === 'domain' && !normalizedDomains.length) return null;
  const safeUrls = ownArrayValues(urls).map(sourceUrl).filter(Boolean);
  if (safeUrls.length !== urls.length || !safeUrls.length) return null;
  return {
    id, name, match, category, confidence, domainContext, domains: normalizedDomains, nameLength, nameSuffix,
    owner, purpose, sourceUrls: safeUrls,
    // A community hint with no documented domain is retained but not admitted.
    admitted: domainContext !== 'unassessed' && (confidence === 'documented' || domainContext === 'domain'),
    rank: (confidence === 'documented' ? 10000 : 0) + (domainContext === 'domain' ? 1000 : 0) + (match === 'exact' ? 500 : 0) + name.length
  };
}

export function createCookieClassifier(catalog) {
  const rows = ownData(catalog, 'entries');
  if (!Array.isArray(rows) || rows.length > MAX_RULES) throw new Error('Invalid bounded cookie catalog');
  const exact = new Map();
  const prefixes = [];
  const ids = new Set();
  for (let index = 0; index < rows.length; index++) {
    const rule = compileRule(ownData(rows, String(index)));
    if (!rule) continue;
    if (ids.has(rule.id)) throw new Error('Duplicate cookie catalog rule');
    ids.add(rule.id);
    if (rule.match === 'prefix') prefixes.push(rule);
    else {
      const list = exact.get(rule.name) ?? [];
      list.push(rule);
      exact.set(rule.name, list);
    }
  }
  prefixes.sort((a, b) => b.rank - a.rank || compareIds(a.id, b.id));

  function classifyCookie(cookie) {
    const name = ownData(cookie, 'name');
    const domain = normalizeCookieDomain(ownData(cookie, 'domain'));
    if (typeof name !== 'string' || !COOKIE_NAME.test(name) || !domain) return unknown();
    const candidates = [];
    const redactionCandidates = [];
    for (const rule of exact.get(name) ?? []) candidates.push(rule);
    for (const rule of prefixes) {
      // A dynamic prefix requires an actual suffix; no regex from the database.
      if (name.length > rule.name.length && name.startsWith(rule.name)) {
        redactionCandidates.push(rule);
        const suffix = name.slice(rule.name.length);
        const validSuffix = rule.nameSuffix === undefined || rule.nameSuffix === 'digits' && /^[0-9]+$/.test(suffix) || rule.nameSuffix === 'hex' && /^[0-9a-fA-F]+$/.test(suffix);
        if ((rule.nameLength === undefined || name.length === rule.nameLength) && validSuffix) candidates.push(rule);
      }
    }
    const displayName = candidateDisplayName([...(exact.get(name) ?? []), ...redactionCandidates]);
    if (!candidates.length) return unknown('unknown', [], displayName);
    const matching = candidates.filter(rule => rule.domainContext !== 'domain' || rule.domains.some(expected => domainMatches(domain, expected)));
    if (!matching.length) return unknown('unknown', [], displayName);
    const admitted = matching.filter(rule => rule.admitted && !(rule.confidence === 'community' && (AMBIGUOUS_AUTH_NAMES.has(name.toLowerCase()) || GENERIC_NAMES.has(name.toLowerCase()) && rule.domainContext !== 'domain')));
    if (!admitted.length) {
      const sorted = matching.slice().sort((a, b) => b.rank - a.rank || compareIds(a.id, b.id));
      const strongest = sorted.filter(rule => rule.rank === sorted[0].rank).slice(0, MAX_MATCHES);
      return unknown('ambiguous', strongest, displayName, nameReferencePurpose(name, strongest));
    }
    const highest = Math.max(...admitted.map(rule => rule.rank));
    const strongest = admitted.filter(rule => rule.rank === highest);
    const categories = new Set(strongest.map(rule => rule.category));
    const owners = new Set(strongest.map(rule => rule.owner));
    if (categories.size !== 1 || owners.size !== 1) {
      const sorted = strongest.slice().sort((a, b) => compareIds(a.id, b.id)).slice(0, MAX_MATCHES);
      return unknown('ambiguous', sorted, displayName, nameReferencePurpose(name, sorted));
    }
    const selected = strongest.slice().sort((a, b) => compareIds(a.id, b.id));
    const rule = selected[0];
    // A reviewed mixed-purpose rule still has useful documented attribution and
    // a purpose explanation. It remains unknown and never raises tracking.
    // Name references can explain unknown rows without assigning a company,
    // category or tracking status to the current site's cookie.
    if (rule.category === 'unknown' && rule.confidence !== 'documented') return unknown('ambiguous', selected.slice(0, MAX_MATCHES), displayName, nameReferencePurpose(name, selected.slice(0, MAX_MATCHES)));
    return {
      category: rule.category, owner: rule.owner, purpose: rule.purpose, confidence: rule.confidence,
      tracking: rule.category === 'analytics' || rule.category === 'advertising',
      ruleIds: selected.map(item => item.id).slice(0, MAX_MATCHES),
      sourceUrls: [...new Set(selected.flatMap(item => item.sourceUrls))].sort().slice(0, MAX_MATCHES),
      // Prefixes are displayed as catalog names; actual suffix identifiers are dropped.
      name: displayCatalogName(rule.match === 'prefix' ? rule.name + '*' : rule.name)
    };
  }

  function projectCookieMetadata(cookie) {
    const rawName = ownData(cookie, 'name');
    const domain = normalizeCookieDomain(ownData(cookie, 'domain'));
    if (typeof rawName !== 'string' || !domain) return null;
    const flags = {};
    for (const field of ['hostOnly', 'secure', 'httpOnly', 'session']) {
      const value = ownData(cookie, field);
      if (typeof value !== 'boolean') return null;
      flags[field] = value;
    }
    const sameSite = ownData(cookie, 'sameSite');
    if (!['unspecified', 'no_restriction', 'lax', 'strict'].includes(sameSite)) return null;
    const classified = classifyCookie(cookie);
    const result = {
      ...classified,
      name: classified.name || (typeof rawName === 'string' && DISPLAY_NAME.test(rawName) ? rawName : '<other>'),
      domain,
      ...flags,
      sameSite,
      partitioned: false
    };
    const expiration = ownData(cookie, 'expirationDate');
    if (typeof expiration === 'number' && Number.isFinite(expiration) && expiration >= 0 && expiration <= 253402300799) result.expirationDate = expiration;
    const partitionKey = ownData(cookie, 'partitionKey');
    if (partitionKey !== null && typeof partitionKey === 'object' && !Array.isArray(partitionKey)) {
      result.partitioned = true;
      const crossSite = ownData(partitionKey, 'hasCrossSiteAncestor');
      if (typeof crossSite === 'boolean') result.hasCrossSiteAncestor = crossSite;
    }
    return result;
  }

  return { classifyCookie, projectCookieMetadata, ruleCount: ids.size };
}
