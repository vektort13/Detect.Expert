// ADR-021: metadata-only cookie inventory and bounded page-controlled loader evidence.
export const COOKIE_CATEGORIES = Object.freeze(['necessary', 'functional', 'analytics', 'advertising', 'security', 'consent', 'unknown']);
export const COOKIE_CONFIDENCES = Object.freeze(['documented', 'community', 'ambiguous', 'unknown']);
export const LOADER_SERVICES = Object.freeze(['google-tag-manager', 'google-analytics', 'google-ads', 'facebook-pixel', 'hotjar', 'criteo', 'microsoft-clarity', 'tiktok-pixel', 'linkedin-insight', 'bing-uet']);
// ADR-028: additive documented service profiles and tracking SDK classification.
export const SOCIAL_SERVICES = Object.freeze(['facebook', 'instagram', 'x', 'linkedin', 'tiktok', 'snapchat', 'pinterest', 'reddit', 'discord', 'twitch', 'youtube', 'github', 'gitlab', 'vk', 'ok', 'weibo', 'qq', 'telegram', 'line', 'google', 'microsoft', 'apple', 'spotify', 'steam', 'yahoo', 'tumblr', 'quora', 'disqus', 'yandex', 'mailru', 'kakao', 'naver', 'baidu', 'bluesky', 'sharethis', 'douyin', 'wechat', 'mastodon', 'addthis', 'whatsapp', 'viber', 'threads', 'vimeo', 'dailymotion', 'soundcloud', 'unknown']);
export const SOCIAL_KINDS = Object.freeze(['service-request', 'sdk-load', 'tracking-sdk', 'tracking-pixel', 'embedded-content', 'authentication-navigation', 'authentication-frame', 'authentication-request', 'possible-login-probe', 'manual-redirect-request', 'fedcm-call', 'login-status-api']);
const field = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value);
const exact = (value, required, optional = []) => value && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).every(key => typeof key === 'string' && [...required, ...optional].includes(key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) && required.every(key => Object.hasOwn(value, key));
const list = (value, max, read) => {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return null;
  const output = [];
  for (let index = 0; index < value.length; index++) { const item = read(field(value, index)); if (item === null) return null; output.push(item); }
  return output;
};
const doc = value => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,160}$/.test(value);
// ADR-072: metadata domains are normalized DNS labels, not arbitrary dot/hyphen strings.
const cookieDomain = value => text(value, 253) && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(value);
function readCookieActionRequest(value, type, extra = []) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'tabId', 'documentKey'], ['frameId', ...extra]) || field(value, 'schemaVersion') !== 1 || field(value, 'type') !== type || !Number.isSafeInteger(field(value, 'tabId')) || field(value, 'tabId') < 0 || !doc(field(value, 'documentKey'))) return null;
    const frameId = Object.hasOwn(value, 'frameId') ? field(value, 'frameId') : 0;
    if (!Number.isSafeInteger(frameId) || frameId < 0 || !field(value, 'documentKey').startsWith(`${field(value, 'tabId')}:${frameId}:`)) return null;
    return { schemaVersion: 1, type, tabId: field(value, 'tabId'), frameId, documentKey: field(value, 'documentKey') };
  } catch { return null; }
}
export function readCookieRequest(value) { return readCookieActionRequest(value, 'ui-get-cookies'); }
export function readSocialRequest(value) { return readCookieActionRequest(value, 'ui-get-social-networks'); }
export function readCookieViewRequest(value) { return readCookieActionRequest(value, 'ui-get-cookie-view'); }
const cookieHandle = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
export function readCookieValueRequest(value) {
  try {
    const request = readCookieActionRequest(value, 'ui-get-cookie-value', ['handle']);
    return request && cookieHandle(field(value, 'handle')) ? { ...request, handle: field(value, 'handle') } : null;
  } catch { return null; }
}
// ADR-023: private live UI replies. Neither reply is admitted as a Pro snapshot.
export function readCookieView(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'snapshot', 'handles']) || field(value, 'schemaVersion') !== 1 || field(value, 'type') !== 'cookies-view-state') return null;
    const snapshot = readCookieSnapshot(field(value, 'snapshot')), handles = field(value, 'handles');
    if (!snapshot || !Array.isArray(handles) || handles.length !== snapshot.entries.length || handles.length > 256 || Reflect.ownKeys(handles).length !== handles.length + 1) return null;
    const output = [], seen = new Set();
    for (let index = 0; index < handles.length; ++index) {
      const descriptor = Object.getOwnPropertyDescriptor(handles, index);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      const handle = descriptor.value;
      if (handle !== null && (!cookieHandle(handle) || seen.has(handle) || snapshot.permission !== 'granted')) return null;
      if (handle !== null) seen.add(handle);
      output.push(handle);
    }
    return { schemaVersion: 1, type: 'cookies-view-state', snapshot, handles: output };
  } catch { return null; }
}
export function readCookieValueResult(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'documentKey', 'handle', 'value', 'truncated']) || field(value, 'schemaVersion') !== 1 || field(value, 'type') !== 'cookie-value-state' || !doc(field(value, 'documentKey')) || !cookieHandle(field(value, 'handle')) || typeof field(value, 'value') !== 'string' || field(value, 'value').length > 16384 || typeof field(value, 'truncated') !== 'boolean') return null;
    return { schemaVersion: 1, type: 'cookie-value-state', documentKey: field(value, 'documentKey'), handle: field(value, 'handle'), value: field(value, 'value'), truncated: field(value, 'truncated') };
  } catch { return null; }
}
export function readClearCookiesRequest(value) { return readCookieActionRequest(value, 'ui-clear-site-cookies'); }
export function readClearCookiesResult(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'documentKey', 'removedCount', 'failedCount', 'truncated']) || field(value, 'schemaVersion') !== 1 || field(value, 'type') !== 'cookies-clear-state' || !doc(field(value, 'documentKey')) || typeof field(value, 'truncated') !== 'boolean') return null;
    const removedCount = field(value, 'removedCount'), failedCount = field(value, 'failedCount');
    if (![removedCount, failedCount].every(count => Number.isSafeInteger(count) && count >= 0 && count <= 4096) || removedCount + failedCount > 4096) return null;
    return { schemaVersion: 1, type: 'cookies-clear-state', documentKey: field(value, 'documentKey'), removedCount, failedCount, truncated: field(value, 'truncated') };
  } catch { return null; }
}
export function readCookieSnapshot(value) {
  try {
    const required = ['schemaVersion', 'type', 'documentKey', 'coverageState', 'permission', 'trackingCount', 'entries', 'truncated', 'observedAt'];
    if (!exact(value, required, ['totalCount', 'siteCount', 'sessionBinding']) || field(value, 'schemaVersion') !== 1 || field(value, 'type') !== 'cookies-state' || !doc(field(value, 'documentKey')) || !['active', 'partial', 'paused', 'unsupported', 'no-access'].includes(field(value, 'coverageState')) || !['granted', 'required', 'unsupported'].includes(field(value, 'permission')) || typeof field(value, 'truncated') !== 'boolean' || !Number.isSafeInteger(field(value, 'observedAt')) || field(value, 'observedAt') < 0) return null;
    const entries = list(field(value, 'entries'), 256, item => {
      const fields = ['name', 'domain', 'hostOnly', 'secure', 'httpOnly', 'session', 'sameSite', 'partitioned', 'tracking', 'category', 'owner', 'purpose', 'confidence', 'ruleIds', 'sourceUrls'];
      if (!exact(item, fields, ['expirationDate', 'hasCrossSiteAncestor', 'boundSessionStatus']) || !text(field(item, 'name'), 80) || !cookieDomain(field(item, 'domain')) || !['hostOnly', 'secure', 'httpOnly', 'session', 'partitioned', 'tracking'].every(key => typeof field(item, key) === 'boolean') || !['no_restriction', 'lax', 'strict', 'unspecified'].includes(field(item, 'sameSite')) || !COOKIE_CATEGORIES.includes(field(item, 'category')) || !COOKIE_CONFIDENCES.includes(field(item, 'confidence')) || !text(field(item, 'owner'), 160) || !text(field(item, 'purpose'), 1200)) return null;
      if (Object.hasOwn(item, 'expirationDate') && (!Number.isFinite(field(item, 'expirationDate')) || field(item, 'expirationDate') < 0 || field(item, 'expirationDate') > 253402300799)) return null;
      if (Object.hasOwn(item, 'hasCrossSiteAncestor') && typeof field(item, 'hasCrossSiteAncestor') !== 'boolean') return null;
      const ruleIds = list(field(item, 'ruleIds'), 8, id => text(id, 96) && /^[A-Za-z0-9_.:-]+$/.test(id) ? id : null);
      const sourceUrls = list(field(item, 'sourceUrls'), 8, url => { if (!text(url, 1024)) return null; try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? url : null; } catch { return null; } });
      if (!ruleIds || !sourceUrls || field(item, 'tracking') && !['analytics', 'advertising'].includes(field(item, 'category'))) return null;
      return Object.fromEntries([...fields, 'expirationDate', 'hasCrossSiteAncestor'].filter(key => Object.hasOwn(item, key)).map(key => [key, key === 'ruleIds' ? ruleIds : key === 'sourceUrls' ? sourceUrls : field(item, key)]));
    });
    if (!entries || field(value, 'trackingCount') !== entries.filter(item => item.tracking).length || field(value, 'permission') !== 'granted' && entries.length) return null;
    const counts = {};
    if (Object.hasOwn(value, 'totalCount')) {
      const total = field(value, 'totalCount');
      if (!Number.isSafeInteger(total) || total < entries.length || total > 4096 || field(value, 'permission') !== 'granted' && total !== 0) return null;
      counts.totalCount = total;
    }
    if (Object.hasOwn(value, 'siteCount')) {
      const site = field(value, 'siteCount');
      if (!Number.isSafeInteger(site) || site < 0 || site > (counts.totalCount ?? entries.length)) return null;
      counts.siteCount = site;
    }
    return { schemaVersion: 1, type: 'cookies-state', documentKey: field(value, 'documentKey'), coverageState: field(value, 'coverageState'), permission: field(value, 'permission'), trackingCount: field(value, 'trackingCount'), ...counts, entries, truncated: field(value, 'truncated'), observedAt: field(value, 'observedAt') };
  } catch { return null; }
}
export function readLoaderRows(value) {
  try {
    const seen = new Set();
    return list(value, 128, row => {
      if (!exact(row, ['source', 'target', 'attributionConfidence', 'evidenceSource', 'integrity', 'count']) || field(row, 'source') !== 'google-tag-manager' || !LOADER_SERVICES.includes(field(row, 'target')) || field(row, 'target') === 'google-tag-manager' || !['exact-resource', 'sampled-stack'].includes(field(row, 'attributionConfidence')) || field(row, 'evidenceSource') !== 'page-hook' || field(row, 'integrity') !== 'page-controlled' || !Number.isInteger(field(row, 'count')) || field(row, 'count') < 1 || field(row, 'count') > 2147483647) return null;
      const key = field(row, 'target') + '|' + field(row, 'attributionConfidence');
      if (seen.has(key)) return null; seen.add(key);
      return Object.fromEntries(['source', 'target', 'attributionConfidence', 'evidenceSource', 'integrity', 'count'].map(key => [key, field(row, key)]));
    });
  } catch { return null; }
}
export function readTagManagerDocuments(value) {
  try {
    const seen = new Set();
    return list(value, 24, item => {
      if (!exact(item, ['documentKey', 'rows', 'truncated']) || !doc(field(item, 'documentKey')) || seen.has(field(item, 'documentKey')) || typeof field(item, 'truncated') !== 'boolean') return null;
      const rows = readLoaderRows(field(item, 'rows')); if (!rows) return null;
      seen.add(field(item, 'documentKey'));
      return { documentKey: field(item, 'documentKey'), rows, truncated: field(item, 'truncated') };
    });
  } catch { return null; }
}

// ADR-026: observations, without social account state, query, body or raw stack.
export function readSocialRows(value) {
  try {
    return list(value, 64, item => {
      const keys = ['service', 'kind', 'endpoint', 'method', 'requestType', 'count', 'evidenceSource', 'integrity', 'attributionConfidence', 'initiatorHost', 'script'];
      if (!exact(item, keys) || !SOCIAL_SERVICES.includes(field(item, 'service')) || !SOCIAL_KINDS.includes(field(item, 'kind')) ||
          !['service', 'sdk', 'pixel', 'embed', 'login', 'oauth', 'fedcm', 'login-status'].includes(field(item, 'endpoint')) ||
          !['GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'UNKNOWN'].includes(field(item, 'method')) ||
          !['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'].includes(field(item, 'requestType')) ||
          !Number.isSafeInteger(field(item, 'count')) || field(item, 'count') < 1 || field(item, 'count') > 2147483647) return null;
      const browser = field(item, 'evidenceSource') === 'browser-network';
      if (!browser && field(item, 'evidenceSource') !== 'page-hook' || field(item, 'integrity') !== (browser ? 'browser-observed' : 'page-controlled') ||
          !(browser ? ['frame-only', 'unknown'] : ['exact-resource', 'sampled-stack', 'unknown']).includes(field(item, 'attributionConfidence'))) return null;
      const host = input => input === null || text(input, 253) && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(input) && !input.includes('..');
      if (!host(field(item, 'initiatorHost'))) return null;
      const script = field(item, 'script');
      if (script !== null && (browser || !exact(script, ['host', 'pathTemplate']) || !host(field(script, 'host')) || field(script, 'host') === null ||
          !text(field(script, 'pathTemplate'), 64) || !/^\/(?:<script>|(?:main|client|script|sdk|gtm|fbevents|widgets|tracker|analytics)\.(?:js|mjs))$/.test(field(script, 'pathTemplate')))) return null;
      if ((script === null) !== (browser || field(item, 'attributionConfidence') === 'unknown')) return null;
      return Object.fromEntries(keys.map(key => [key, key === 'script' && script !== null ? { host: field(script, 'host'), pathTemplate: field(script, 'pathTemplate') } : field(item, key)]));
    });
  } catch { return null; }
}
export function readSocialSnapshot(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'documentKey', 'coverageState', 'rows', 'truncated']) || field(value, 'schemaVersion') !== 1 || field(value, 'type') !== 'social-networks-state' || !doc(field(value, 'documentKey')) ||
        !['active', 'partial', 'late-start', 'paused', 'unsupported', 'no-access', 'degraded'].includes(field(value, 'coverageState')) || typeof field(value, 'truncated') !== 'boolean') return null;
    const rows = readSocialRows(field(value, 'rows')); if (!rows || ['paused', 'unsupported', 'no-access'].includes(field(value, 'coverageState')) && rows.length) return null;
    return { schemaVersion: 1, type: 'social-networks-state', documentKey: field(value, 'documentKey'), coverageState: field(value, 'coverageState'), rows, truncated: field(value, 'truncated') };
  } catch { return null; }
}
export function readSocialDocuments(value) {
  try {
    const seen = new Set(); let count = 0;
    return list(value, 24, item => {
      const snapshot = readSocialSnapshot(item);
      if (!snapshot || seen.has(snapshot.documentKey) || (count += snapshot.rows.length) > 256) return null;
      seen.add(snapshot.documentKey); return snapshot;
    });
  } catch { return null; }
}
export function mergeLoaderRows(existing, current, baseline = []) {
  const old = readLoaderRows(existing), next = readLoaderRows(current), retained = readLoaderRows(baseline);
  if (!old || !next || !retained) return null;
  const key = row => row.target + '|' + row.attributionConfidence;
  const rows = new Map(old.map(row => [key(row), row]));
  const previous = new Map(retained.map(row => [key(row), row.count]));
  for (const row of next) rows.set(key(row), { ...row, count: Math.max(rows.get(key(row))?.count ?? 0, Math.min(2147483647, row.count + (previous.get(key(row)) ?? 0))) });
  return [...rows.values()];
}

// ADR-044: normalize previously stored cookie metadata after full Pro validation.
// Legacy fields are accepted only as own data properties, and never returned.
export function normalizeProCookieMetadata(session) {
  return { ...session, pages: session.pages.map(page => Object.hasOwn(page, 'cookies')
    ? { ...page, cookies: readCookieSnapshot(page.cookies) } : page) };
}
