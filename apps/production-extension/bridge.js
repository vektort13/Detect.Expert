// ADR-021 inspection contract start
var inspectionContracts = (() => {
// ADR-021: metadata-only cookie inventory and bounded page-controlled loader evidence.
const COOKIE_CATEGORIES = Object.freeze(['necessary', 'functional', 'analytics', 'advertising', 'security', 'consent', 'unknown']);
const COOKIE_CONFIDENCES = Object.freeze(['documented', 'community', 'ambiguous', 'unknown']);
const LOADER_SERVICES = Object.freeze(['google-tag-manager', 'google-analytics', 'google-ads', 'facebook-pixel', 'hotjar', 'criteo', 'microsoft-clarity', 'tiktok-pixel', 'linkedin-insight', 'bing-uet']);
// ADR-028: additive documented service profiles and tracking SDK classification.
const SOCIAL_SERVICES = Object.freeze(['facebook', 'instagram', 'x', 'linkedin', 'tiktok', 'snapchat', 'pinterest', 'reddit', 'discord', 'twitch', 'youtube', 'github', 'gitlab', 'vk', 'ok', 'weibo', 'qq', 'telegram', 'line', 'google', 'microsoft', 'apple', 'spotify', 'steam', 'yahoo', 'tumblr', 'quora', 'disqus', 'yandex', 'mailru', 'kakao', 'naver', 'baidu', 'bluesky', 'sharethis', 'douyin', 'wechat', 'mastodon', 'addthis', 'whatsapp', 'viber', 'threads', 'vimeo', 'dailymotion', 'soundcloud', 'unknown']);
const SOCIAL_KINDS = Object.freeze(['service-request', 'sdk-load', 'tracking-sdk', 'tracking-pixel', 'embedded-content', 'authentication-navigation', 'authentication-frame', 'authentication-request', 'possible-login-probe', 'manual-redirect-request', 'fedcm-call', 'login-status-api']);
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
function readCookieActionRequest(value, type, extra = []) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'tabId', 'documentKey'], ['frameId', ...extra]) || field(value, 'schemaVersion') !== 1 || field(value, 'type') !== type || !Number.isSafeInteger(field(value, 'tabId')) || field(value, 'tabId') < 0 || !doc(field(value, 'documentKey'))) return null;
    const frameId = Object.hasOwn(value, 'frameId') ? field(value, 'frameId') : 0;
    if (!Number.isSafeInteger(frameId) || frameId < 0 || !field(value, 'documentKey').startsWith(`${field(value, 'tabId')}:${frameId}:`)) return null;
    return { schemaVersion: 1, type, tabId: field(value, 'tabId'), frameId, documentKey: field(value, 'documentKey') };
  } catch { return null; }
}
function readCookieRequest(value) { return readCookieActionRequest(value, 'ui-get-cookies'); }
function readSocialRequest(value) { return readCookieActionRequest(value, 'ui-get-social-networks'); }
function readCookieViewRequest(value) { return readCookieActionRequest(value, 'ui-get-cookie-view'); }
const cookieHandle = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
function readCookieValueRequest(value) {
  try {
    const request = readCookieActionRequest(value, 'ui-get-cookie-value', ['handle']);
    return request && cookieHandle(field(value, 'handle')) ? { ...request, handle: field(value, 'handle') } : null;
  } catch { return null; }
}
// ADR-023: private live UI replies. Neither reply is admitted as a Pro snapshot.
function readCookieView(value) {
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
function readCookieValueResult(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'documentKey', 'handle', 'value', 'truncated']) || field(value, 'schemaVersion') !== 1 || field(value, 'type') !== 'cookie-value-state' || !doc(field(value, 'documentKey')) || !cookieHandle(field(value, 'handle')) || typeof field(value, 'value') !== 'string' || field(value, 'value').length > 16384 || typeof field(value, 'truncated') !== 'boolean') return null;
    return { schemaVersion: 1, type: 'cookie-value-state', documentKey: field(value, 'documentKey'), handle: field(value, 'handle'), value: field(value, 'value'), truncated: field(value, 'truncated') };
  } catch { return null; }
}
function readClearCookiesRequest(value) { return readCookieActionRequest(value, 'ui-clear-site-cookies'); }
function readClearCookiesResult(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'documentKey', 'removedCount', 'failedCount', 'truncated']) || field(value, 'schemaVersion') !== 1 || field(value, 'type') !== 'cookies-clear-state' || !doc(field(value, 'documentKey')) || typeof field(value, 'truncated') !== 'boolean') return null;
    const removedCount = field(value, 'removedCount'), failedCount = field(value, 'failedCount');
    if (![removedCount, failedCount].every(count => Number.isSafeInteger(count) && count >= 0 && count <= 4096) || removedCount + failedCount > 4096) return null;
    return { schemaVersion: 1, type: 'cookies-clear-state', documentKey: field(value, 'documentKey'), removedCount, failedCount, truncated: field(value, 'truncated') };
  } catch { return null; }
}
function readCookieSnapshot(value) {
  try {
    const required = ['schemaVersion', 'type', 'documentKey', 'coverageState', 'permission', 'trackingCount', 'entries', 'truncated', 'observedAt'];
    if (!exact(value, required, ['totalCount', 'siteCount', 'sessionBinding']) || field(value, 'schemaVersion') !== 1 || field(value, 'type') !== 'cookies-state' || !doc(field(value, 'documentKey')) || !['active', 'partial', 'paused', 'unsupported', 'no-access'].includes(field(value, 'coverageState')) || !['granted', 'required', 'unsupported'].includes(field(value, 'permission')) || typeof field(value, 'truncated') !== 'boolean' || !Number.isSafeInteger(field(value, 'observedAt')) || field(value, 'observedAt') < 0) return null;
    const entries = list(field(value, 'entries'), 256, item => {
      const fields = ['name', 'domain', 'hostOnly', 'secure', 'httpOnly', 'session', 'sameSite', 'partitioned', 'tracking', 'category', 'owner', 'purpose', 'confidence', 'ruleIds', 'sourceUrls'];
      if (!exact(item, fields, ['expirationDate', 'hasCrossSiteAncestor', 'boundSessionStatus']) || !text(field(item, 'name'), 80) || !text(field(item, 'domain'), 253) || !/^[a-z0-9.-]+$/.test(field(item, 'domain')) || !['hostOnly', 'secure', 'httpOnly', 'session', 'partitioned', 'tracking'].every(key => typeof field(item, key) === 'boolean') || !['no_restriction', 'lax', 'strict', 'unspecified'].includes(field(item, 'sameSite')) || !COOKIE_CATEGORIES.includes(field(item, 'category')) || !COOKIE_CONFIDENCES.includes(field(item, 'confidence')) || !text(field(item, 'owner'), 160) || !text(field(item, 'purpose'), 1200)) return null;
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
function readLoaderRows(value) {
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
function readTagManagerDocuments(value) {
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
function readSocialRows(value) {
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
function readSocialSnapshot(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'documentKey', 'coverageState', 'rows', 'truncated']) || field(value, 'schemaVersion') !== 1 || field(value, 'type') !== 'social-networks-state' || !doc(field(value, 'documentKey')) ||
        !['active', 'partial', 'late-start', 'paused', 'unsupported', 'no-access', 'degraded'].includes(field(value, 'coverageState')) || typeof field(value, 'truncated') !== 'boolean') return null;
    const rows = readSocialRows(field(value, 'rows')); if (!rows || ['paused', 'unsupported', 'no-access'].includes(field(value, 'coverageState')) && rows.length) return null;
    return { schemaVersion: 1, type: 'social-networks-state', documentKey: field(value, 'documentKey'), coverageState: field(value, 'coverageState'), rows, truncated: field(value, 'truncated') };
  } catch { return null; }
}
function readSocialDocuments(value) {
  try {
    const seen = new Set(); let count = 0;
    return list(value, 24, item => {
      const snapshot = readSocialSnapshot(item);
      if (!snapshot || seen.has(snapshot.documentKey) || (count += snapshot.rows.length) > 256) return null;
      seen.add(snapshot.documentKey); return snapshot;
    });
  } catch { return null; }
}
function mergeLoaderRows(existing, current, baseline = []) {
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
function normalizeProCookieMetadata(session) {
  return { ...session, pages: session.pages.map(page => Object.hasOwn(page, 'cookies')
    ? { ...page, cookies: readCookieSnapshot(page.cookies) } : page) };
}

return { readCookieSnapshot, readLoaderRows, readTagManagerDocuments, readSocialRows, readSocialDocuments, normalizeProCookieMetadata };
})();
var readCookieSnapshot = inspectionContracts.readCookieSnapshot, readLoaderRows = inspectionContracts.readLoaderRows, readTagManagerDocuments = inspectionContracts.readTagManagerDocuments, readSocialRows = inspectionContracts.readSocialRows, readSocialDocuments = inspectionContracts.readSocialDocuments, normalizeProCookieMetadata = inspectionContracts.normalizeProCookieMetadata;
// ADR-021 inspection contract end
"use strict";
(() => {
  // packages/contracts/src/technique-ids.ts
  var TECHNIQUE_IDS = [
    "DET-001",
    "DET-002",
    "DET-003",
    "DET-004",
    "DET-005",
    "DET-006",
    "DET-007",
    "DET-008",
    "DET-009",
    "DET-010",
    "DET-011",
    "DET-012",
    "DET-013",
    "DET-014",
    "DET-015",
    "DET-016",
    "DET-017",
    "DET-018",
    "DET-019",
    "DET-020",
    "DET-021",
    "DET-022",
    "DET-023",
    "DET-024",
    "DET-025",
    "DET-026",
    "DET-027",
    "DET-028",
    "DET-029",
    "DET-030",
    "DET-031",
    "DET-032",
    "DET-033",
    "DET-034",
    "DET-035",
    "DET-036",
    "DET-037",
    "DET-038",
    "DET-039",
    "DET-040",
    "DET-041",
    "DET-042",
    "DET-043",
    "DET-044",
    "DET-045",
    "DET-046",
    "DET-047",
    "DET-048",
    "DET-049",
    "DET-050",
    "DET-051",
    "DET-052",
    "DET-053",
    "DET-054",
    "DET-055",
    "DET-056",
    "DET-057",
    "DET-058",
    "DET-059",
    "DET-060",
    "DET-061",
    "DET-062",
    "DET-063",
    "DET-064",
    "DET-065",
    "DET-066",
    "DET-067",
    "DET-068",
    "DET-069",
    "DET-070",
    "DET-071",
    "DET-072",
    "DET-073",
    "DET-074"
  ];

  // packages/contracts/src/enums.ts
  var PROTOCOL_VERSION = 1, CHANNEL = "detect.expert/v1", UNBOUND_SENSOR_BOOT_ID = "unbound", SIGNAL_CODES = [
    "api-use",
    "readback-after-text",
    "offline-render",
    "numeric-diversity",
    "known-numeric-pattern",
    "local-multi-port",
    "unique-subdomains",
    "early-observation",
    "late-start",
    "hook-failed",
    "sample-budget-exceeded",
    "tainted-canvas-attempt",
    "export-after-text",
    "hook-replaced",
    "bfcache-restore",
    "text-measured",
    "text-drawn",
    // ADR-026: bounded facts about site API use; never pointer coordinates or arbitrary API names.
    "movement-listener",
    "pointer-coordinate-read",
    "permission-camera",
    "permission-microphone",
    "permission-geolocation",
    "permission-notifications",
    "permission-clipboard-read",
    "permission-clipboard-write",
    "permission-persistent-storage",
    "permission-background-sync",
    "permission-midi",
    "permission-sensors",
    "permission-payment-handler",
    "permission-screen-wake-lock",
    "permission-window-management",
    "permission-local-fonts",
    "permission-display-capture",
    "permission-storage-access",
    "permission-unknown",
    "permission-granted",
    "permission-denied",
    "permission-prompt",
    "policy-allowed",
    "policy-blocked",
    "policy-enumeration"
  ];
  var COVERAGE_FLAGS = [
    "late-start",
    "hook-failed",
    "throttled",
    "unsupported-realm",
    "channel-gap",
    "truncated",
    "paused",
    "revoked",
    "protocol-mismatch",
    "descriptor-nonconfigurable",
    "bridge-ring-overflow",
    "budget-exceeded",
    "no-host-permission",
    "restricted-page",
    "worker-not-observed",
    // Permission-limited network and inaccessible child frames (REQ-006, ADR-003, F175).
    "network-limited",
    "frames-inaccessible"
  ];
  var COUNT_QUALITIES = ["exact", "sampled", "lower-bound"], PHASES = [
    "attempted",
    "returned-sync",
    "threw-sync",
    "async-returned",
    "settlement-unobserved"
  ], SCOPE_MODES = ["off", "active-tab", "site", "all-sites"], SENSOR_STATES = ["active", "paused", "degraded", "stopped"], BRIDGE_STOP_REASONS = ["protocol-mismatch", "revoked", "scope-changed", "unload"], BRIDGE_CONTROL_COMMANDS = ["pause", "resume", "reset"];

  // packages/contracts/src/budgets.ts
  var BUDGETS = {
    /** Wire batch: observations per PageBatch. */
    maxBatchEvents: 32,
    /** Wire batch: serialized bytes, checked after bounded structural validation. */
    maxBatchBytes: 16384,
    /** Any incoming string (specialized fields may be shorter). */
    maxStringChars: 512,
    /** sensorBootId / bridgeSessionId and similar local identifiers. */
    maxIdChars: 64,
    /** documentKey (assigned by the SW from MessageSender / webNavigation). */
    maxDocumentKeyChars: 128,
    /** Rate after aggregation (token bucket); not a recommended normal rate. */
    maxBatchesPerSecondPerDocument: 20,
    maxBatchesPerSecondPerTab: 100,
    maxBatchesPerSecondGlobal: 200,
    /** ISOLATED bridge ring: normalized aggregates per document; oldest unacknowledged dropped with a gap marker. */
    maxBridgeRecordsPerDocument: 512,
    /** Normal flush window when data is present. */
    flushMinMs: 250,
    flushMaxMs: 500,
    /** Hot Math: at most one aggregate per this window. */
    hotMathFlushMs: 500,
    /** Sensor counters per document per sensor group; rare keys fold into `other`. */
    maxCountersPerDocumentGroup: 128,
    maxFindingsPerDocument: 256,
    maxHostsPerDocument: 128,
    /** Serialized document aggregate target. */
    maxReportSerializedBytes: 102400,
    /** Session storage estimate for reports + indexes + diagnostics together. */
    maxSessionTotalBytes: 4194304,
    inactiveDocumentTtlMs: 6e5,
    /** Diagnostics ring: inside the session budget; session only; no domains/paths/page content. */
    maxDiagnosticsBytes: 1048576,
    diagnosticsTtlMs: 864e5,
    /** Out-of-order quarantine (per extension). */
    maxOutOfOrderEntriesGlobal: 128,
    outOfOrderTtlMs: 2e3,
    /** Math stack sampling per realm. */
    maxMathStackSamplesPerWindow: 8,
    mathSampleWindowMs: 2e3,
    mathAttributionSlots: 32,
    /** Per-observation signal codes. */
    maxSignalCodesPerObservation: 8,
    /** Saturation ceiling for counts and sequence numbers. */
    maxCount: 2147483647
  };

  // packages/contracts/src/messages.ts
  var EMPTY_DROPPED = Object.freeze({
    observations: 0,
    batches: 0,
    findings: 0,
    hosts: 0,
    counters: 0,
    transport: 0
  });
  function counterKey(techniqueId, phase, signalCodes, apiOperation, extensionResource) {
    let legacy = techniqueId + "|" + phase + "|" + [...signalCodes].sort().join(",");
    return extensionResource !== void 0 ? legacy + "|extension|" + extensionResource.target + "|" + extensionResource.method : apiOperation === void 0 ? legacy : legacy + "|" + apiOperation;
  }

  // packages/contracts/src/api-operations.ts
  var API_OPERATION_DEFINITIONS = [
  ["GPU.requestAdapter","DET-013","webgpu","async-call"],
  ["GPUAdapter.requestDevice","DET-013","webgpu","async-call"],
  ["GPUAdapter.info","DET-013","webgpu","get"],
  ["GPUAdapter.features","DET-013","webgpu","get"],
  ["GPUAdapter.limits","DET-013","webgpu","get"],
  ["GPUDevice.adapterInfo","DET-013","webgpu","get"],
  ["GPUDevice.features","DET-013","webgpu","get"],
  ["GPUDevice.limits","DET-013","webgpu","get"],
  ["GPUDevice.createShaderModule","DET-013","webgpu","call"],
  ["GPUDevice.createComputePipeline","DET-013","webgpu","call"],
  ["GPUDevice.createComputePipelineAsync","DET-013","webgpu","async-call"],
  ["GPUDevice.createRenderPipeline","DET-013","webgpu","call"],
  ["GPUDevice.createRenderPipelineAsync","DET-013","webgpu","async-call"],
  ["GPUShaderModule.getCompilationInfo","DET-013","webgpu","async-call"],
  ["GPUAdapterInfo.vendor","DET-013","webgpu","get"],
  ["GPUAdapterInfo.architecture","DET-013","webgpu","get"],
  ["GPUAdapterInfo.device","DET-013","webgpu","get"],
  ["GPUAdapterInfo.description","DET-013","webgpu","get"],
  ["GPUAdapterInfo.powerPreference","DET-013","webgpu","get"],
  ["GPUAdapterInfo.isFallbackAdapter","DET-013","webgpu","get"],
  ["GPUAdapterInfo.subgroupMinSize","DET-013","webgpu","get"],
  ["GPUAdapterInfo.subgroupMaxSize","DET-013","webgpu","get"],
  ["GPUAdapterInfo.type","DET-013","webgpu","get"],
  ["GPUAdapterInfo.backend","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxTextureDimension1D","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxTextureDimension2D","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxTextureDimension3D","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxTextureArrayLayers","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxBindGroups","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxBindGroupsPlusVertexBuffers","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxBindingsPerBindGroup","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxDynamicUniformBuffersPerPipelineLayout","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxDynamicStorageBuffersPerPipelineLayout","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxSampledTexturesPerShaderStage","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxSamplersPerShaderStage","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxStorageBuffersPerShaderStage","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxStorageTexturesPerShaderStage","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxUniformBuffersPerShaderStage","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxUniformBufferBindingSize","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxStorageBufferBindingSize","DET-013","webgpu","get"],
  ["GPUSupportedLimits.minUniformBufferOffsetAlignment","DET-013","webgpu","get"],
  ["GPUSupportedLimits.minStorageBufferOffsetAlignment","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxVertexBuffers","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxBufferSize","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxVertexAttributes","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxVertexBufferArrayStride","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxInterStageShaderComponents","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxInterStageShaderVariables","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxColorAttachments","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxColorAttachmentBytesPerSample","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxComputeWorkgroupStorageSize","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxComputeInvocationsPerWorkgroup","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxComputeWorkgroupSizeX","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxComputeWorkgroupSizeY","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxComputeWorkgroupSizeZ","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxComputeWorkgroupsPerDimension","DET-013","webgpu","get"],
  ["WebAssembly.compile","DET-065","wasm","async-call"],
  ["WebAssembly.instantiate","DET-065","wasm","async-call"],
  ["WebAssembly.compileStreaming","DET-065","wasm","async-call"],
  ["WebAssembly.instantiateStreaming","DET-065","wasm","async-call"],
  ["WebAssembly.validate","DET-065","wasm","call"],
  ["WebAssembly.Module","DET-065","wasm","construct"],
  ["WebAssembly.Instance","DET-065","wasm","construct"],
  ["WebAssembly.Memory","DET-065","wasm","construct"],
  ["WebAssembly.Memory.grow","DET-065","wasm","call"],
  ["WebAssembly.Memory.buffer","DET-065","wasm","get"],
  ["Navigator.userAgentData","DET-026","client-hints","get"],
  ["NavigatorUAData.brands","DET-026","client-hints","get"],
  ["NavigatorUAData.mobile","DET-026","client-hints","get"],
  ["NavigatorUAData.platform","DET-026","client-hints","get"],
  ["NavigatorUAData.getHighEntropyValues","DET-026","client-hints","async-call"],
  ["Screen.isExtended","DET-031","window-management","get"],
  ["Window.getScreenDetails","DET-031","window-management","async-call"],
  ["ScreenDetails.screens","DET-031","window-management","get"],
  ["ScreenDetails.currentScreen","DET-031","window-management","get"],
  ["ScreenDetailed.left","DET-031","window-management","get"],
  ["ScreenDetailed.top","DET-031","window-management","get"],
  ["Screen.availLeft","DET-031","window-management","get"],
  ["Screen.availTop","DET-031","window-management","get"],
  ["ScreenDetailed.devicePixelRatio","DET-031","window-management","get"],
  ["ScreenDetailed.label","DET-031","window-management","get"],
  ["ScreenDetailed.isPrimary","DET-031","window-management","get"],
  ["ScreenDetailed.isInternal","DET-031","window-management","get"],
  ["PressureObserver","DET-042","compute-pressure","construct"],
  ["PressureObserver.knownSources","DET-042","compute-pressure","get"],
  ["PressureObserver.observe","DET-042","compute-pressure","async-call"],
  ["PressureObserver.unobserve","DET-042","compute-pressure","call"],
  ["PressureObserver.disconnect","DET-042","compute-pressure","call"],
  ["PressureObserver.takeRecords","DET-042","compute-pressure","call"],
  ["PressureRecord.source","DET-042","compute-pressure","get"],
  ["PressureRecord.state","DET-042","compute-pressure","get"],
  ["PressureRecord.time","DET-042","compute-pressure","get"],
  ["IdleDetector","DET-043","idle-detection","construct"],
  ["IdleDetector.requestPermission","DET-043","idle-detection","async-call"],
  ["IdleDetector.start","DET-043","idle-detection","async-call"],
  ["IdleDetector.userState","DET-043","idle-detection","get"],
  ["IdleDetector.screenState","DET-043","idle-detection","get"],
  ["AudioContext","DET-017","audio","construct"],
  ["OfflineAudioContext","DET-015","audio","construct"],
  ["OfflineAudioContext.startRendering","DET-015","audio","async-call"],
  ["BaseAudioContext.createOscillator","DET-015","audio","call"],
  ["BaseAudioContext.createDynamicsCompressor","DET-015","audio","call"],
  ["BaseAudioContext.createAnalyser","DET-015","audio","call"],
  ["BaseAudioContext.createGain","DET-015","audio","call"],
  ["BaseAudioContext.createBiquadFilter","DET-015","audio","call"],
  ["BaseAudioContext.createBufferSource","DET-015","audio","call"],
  ["AudioNode.connect","DET-015","audio","call"],
  ["AudioScheduledSourceNode.start","DET-015","audio","call"],
  ["OscillatorNode","DET-015","audio","construct"],
  ["DynamicsCompressorNode","DET-015","audio","construct"],
  ["AnalyserNode","DET-015","audio","construct"],
  ["GainNode","DET-015","audio","construct"],
  ["AudioBuffer.getChannelData","DET-016","audio","call"],
  ["AudioBuffer.copyFromChannel","DET-016","audio","call"],
  ["AnalyserNode.getFloatFrequencyData","DET-016","audio","call"],
  ["AnalyserNode.getByteFrequencyData","DET-016","audio","call"],
  ["AnalyserNode.getFloatTimeDomainData","DET-016","audio","call"],
  ["AnalyserNode.getByteTimeDomainData","DET-016","audio","call"],
  ["BaseAudioContext.sampleRate","DET-017","audio","get"],
  ["BaseAudioContext.destination","DET-017","audio","get"],
  ["AudioContext.baseLatency","DET-017","audio","get"],
  ["AudioContext.outputLatency","DET-017","audio","get"],
  ["AudioDestinationNode.maxChannelCount","DET-017","audio","get"],
  ["Screen.width","DET-029","window-management","get"],
  ["Screen.height","DET-029","window-management","get"],
  ["Screen.availWidth","DET-029","window-management","get"],
  ["Screen.availHeight","DET-029","window-management","get"],
  ["Screen.colorDepth","DET-029","window-management","get"],
  ["Screen.pixelDepth","DET-029","window-management","get"],
  ["Screen.orientation","DET-029","window-management","get"],
  ["ScreenOrientation.angle","DET-029","window-management","get"],
  ["ScreenOrientation.type","DET-029","window-management","get"],
  ["Window.screenX","DET-030","window-management","get"],
  ["Window.screenY","DET-030","window-management","get"],
  ["Window.screenLeft","DET-030","window-management","get"],
  ["Window.screenTop","DET-030","window-management","get"],
  ["Window.outerWidth","DET-030","window-management","get"],
  ["Window.outerHeight","DET-030","window-management","get"],
  ["Element.requestFullscreen","DET-031","window-management","async-call"],
  ["Document.exitFullscreen","DET-031","window-management","async-call"],
  ["Window.open","DET-031","window-management","call"],
  ["Window.moveTo","DET-031","window-management","call"],
  ["Window.moveBy","DET-031","window-management","call"],
  ["Window.resizeTo","DET-031","window-management","call"],
  ["Window.resizeBy","DET-031","window-management","call"],
  ["Screen.onchange","DET-031","window-management","set"],
  ["ScreenDetails.onscreenschange","DET-031","window-management","set"],
  ["ScreenDetails.oncurrentscreenchange","DET-031","window-management","set"],
  ["Screen.addEventListener","DET-031","window-management","call"],
  ["Screen.removeEventListener","DET-031","window-management","call"],
  ["ScreenDetails.addEventListener","DET-031","window-management","call"],
  ["ScreenDetails.removeEventListener","DET-031","window-management","call"],
  ["PressureRecord.toJSON","DET-042","compute-pressure","call"],
  ["Navigator.ml","DET-070","webnn","get"],
  ["ML.createContext","DET-070","webnn","async-call"],
  ["MLContext.opSupportLimits","DET-070","webnn","call"],
  ["MLGraphBuilder","DET-070","webnn","construct"],
  ["MLGraphBuilder.input","DET-070","webnn","call"],
  ["MLGraphBuilder.constant","DET-070","webnn","call"],
  ["MLGraphBuilder.build","DET-070","webnn","async-call"],
  ["MLContext.createTensor","DET-070","webnn","async-call"],
  ["MLContext.readTensor","DET-070","webnn","async-call"],
  ["MLContext.writeTensor","DET-070","webnn","call"],
  ["MLContext.dispatch","DET-070","webnn","call"],
  ["MLContext.compute","DET-070","webnn","async-call"],
  ["MLContext.destroy","DET-070","webnn","call"],
  ["MLContext.lost","DET-070","webnn","get"],
  ["MLGraph.destroy","DET-070","webnn","call"],
  ["MLTensor.dataType","DET-070","webnn","get"],
  ["MLTensor.shape","DET-070","webnn","get"],
  ["MLTensor.readable","DET-070","webnn","get"],
  ["MLTensor.writable","DET-070","webnn","get"],
  ["MLTensor.constant","DET-070","webnn","get"],
  ["MLTensor.destroy","DET-070","webnn","call"],
  ["MLOperand.dataType","DET-070","webnn","get"],
  ["MLOperand.shape","DET-070","webnn","get"],
  ["MLGraphBuilder.add","DET-070","webnn","call"],
  ["MLGraphBuilder.sub","DET-070","webnn","call"],
  ["MLGraphBuilder.mul","DET-070","webnn","call"],
  ["MLGraphBuilder.div","DET-070","webnn","call"],
  ["MLGraphBuilder.matmul","DET-070","webnn","call"],
  ["MLGraphBuilder.gemm","DET-070","webnn","call"],
  ["MLGraphBuilder.conv2d","DET-070","webnn","call"],
  ["MLGraphBuilder.convTranspose2d","DET-070","webnn","call"],
  ["MLGraphBuilder.relu","DET-070","webnn","call"],
  ["MLGraphBuilder.sigmoid","DET-070","webnn","call"],
  ["MLGraphBuilder.softmax","DET-070","webnn","call"],
  ["MLGraphBuilder.reshape","DET-070","webnn","call"],
  ["MLGraphBuilder.transpose","DET-070","webnn","call"],
  ["MLGraphBuilder.concat","DET-070","webnn","call"],
  ["MLGraphBuilder.split","DET-070","webnn","call"],
  ["MLGraphBuilder.cast","DET-070","webnn","call"],
  ["MLGraphBuilder.reduceSum","DET-070","webnn","call"],
  ["MLGraphBuilder.reduceMean","DET-070","webnn","call"],
  ["MLGraphBuilder.gather","DET-070","webnn","call"],
  ["MLGraphBuilder.quantizeLinear","DET-070","webnn","call"],
  ["MLGraphBuilder.dequantizeLinear","DET-070","webnn","call"],
  ["RTCRtpSender.getCapabilities","DET-020","media-capabilities","call"],
  ["RTCRtpReceiver.getCapabilities","DET-020","media-capabilities","call"],
  ["HTMLMediaElement.canPlayType","DET-020","media-capabilities","call"],
  ["MediaSource.isTypeSupported","DET-020","media-capabilities","call"],
  ["MediaCapabilities.decodingInfo","DET-020","media-capabilities","async-call"],
  ["MediaCapabilities.encodingInfo","DET-020","media-capabilities","async-call"],
  ["AudioDecoder.isConfigSupported","DET-020","media-capabilities","async-call"],
  ["AudioEncoder.isConfigSupported","DET-020","media-capabilities","async-call"],
  ["VideoDecoder.isConfigSupported","DET-020","media-capabilities","async-call"],
  ["VideoEncoder.isConfigSupported","DET-020","media-capabilities","async-call"],
  ["ImageDecoder.isTypeSupported","DET-020","media-capabilities","async-call"],
  ["SpeechSynthesis.getVoices","DET-018","speech","call"],
  ["SpeechRecognition.available","DET-018","speech","async-call"],
  ["SpeechRecognition.install","DET-018","speech","async-call"],
  ["MediaDevices.enumerateDevices","DET-019","media-devices","async-call"],
  ["MediaDevices.getSupportedConstraints","DET-019","media-devices","call"],
  ["MediaDevices.getUserMedia","DET-019","media-devices","async-call"],
  ["MediaDevices.getDisplayMedia","DET-019","media-devices","async-call"],
  ["MediaStreamTrack.getCapabilities","DET-019","media-devices","call"],
  ["MediaStreamTrack.getSettings","DET-019","media-devices","call"],
  ["Navigator.requestMediaKeySystemAccess","DET-021","drm","async-call"],
  ["MediaKeySystemAccess.getConfiguration","DET-021","drm","call"],
  ["MediaKeySystemAccess.createMediaKeys","DET-021","drm","async-call"],
  ["MediaKeys.getStatusForPolicy","DET-021","drm","async-call"],
  ["Bluetooth.getAvailability","DET-045","device-access","async-call"],
  ["Bluetooth.getDevices","DET-045","device-access","async-call"],
  ["Bluetooth.requestDevice","DET-045","device-access","async-call"],
  ["USB.getDevices","DET-046","device-access","async-call"],
  ["USB.requestDevice","DET-046","device-access","async-call"],
  ["HID.getDevices","DET-046","device-access","async-call"],
  ["HID.requestDevice","DET-046","device-access","async-call"],
  ["Serial.getPorts","DET-046","device-access","async-call"],
  ["Serial.requestPort","DET-046","device-access","async-call"],
  ["Navigator.cpuPerformance","DET-032","browser-capabilities","get"],
  ["Intl.supportedValuesOf","DET-036","browser-capabilities","call"],
  ["PerformanceObserver.supportedEntryTypes","DET-066","browser-capabilities","get"],
  ["Notification.maxActions","DET-039","browser-capabilities","get"],
  ["LanguageModel.availability","DET-071","builtin-ai","async-call"],
  ["LanguageModel.params","DET-071","builtin-ai","async-call"],
  ["LanguageModel.create","DET-071","builtin-ai","async-call"],
  ["Translator.availability","DET-071","builtin-ai","async-call"],
  ["Translator.params","DET-071","builtin-ai","async-call"],
  ["Translator.create","DET-071","builtin-ai","async-call"],
  ["Summarizer.availability","DET-071","builtin-ai","async-call"],
  ["Summarizer.params","DET-071","builtin-ai","async-call"],
  ["Summarizer.create","DET-071","builtin-ai","async-call"],
  ["Writer.availability","DET-071","builtin-ai","async-call"],
  ["Writer.params","DET-071","builtin-ai","async-call"],
  ["Writer.create","DET-071","builtin-ai","async-call"],
  ["Rewriter.availability","DET-071","builtin-ai","async-call"],
  ["Rewriter.params","DET-071","builtin-ai","async-call"],
  ["Rewriter.create","DET-071","builtin-ai","async-call"],
  ["LanguageDetector.availability","DET-071","builtin-ai","async-call"],
  ["LanguageDetector.params","DET-071","builtin-ai","async-call"],
  ["LanguageDetector.create","DET-071","builtin-ai","async-call"],
  ["Proofreader.availability","DET-071","builtin-ai","async-call"],
  ["Proofreader.params","DET-071","builtin-ai","async-call"],
  ["Proofreader.create","DET-071","builtin-ai","async-call"],
  ["LanguageModel.prompt","DET-071","builtin-ai","async-call"],
  ["LanguageModel.promptStreaming","DET-071","builtin-ai","call"],
  ["Translator.translate","DET-071","builtin-ai","async-call"],
  ["Translator.translateStreaming","DET-071","builtin-ai","call"],
  ["Summarizer.summarize","DET-071","builtin-ai","async-call"],
  ["Summarizer.summarizeStreaming","DET-071","builtin-ai","call"],
  ["Writer.write","DET-071","builtin-ai","async-call"],
  ["Writer.writeStreaming","DET-071","builtin-ai","call"],
  ["Rewriter.rewrite","DET-071","builtin-ai","async-call"],
  ["Rewriter.rewriteStreaming","DET-071","builtin-ai","call"],
  ["LanguageDetector.detect","DET-071","builtin-ai","async-call"],
  ["Proofreader.proofread","DET-071","builtin-ai","async-call"],
  ["Navigator.queryHandwritingRecognizer","DET-072","recognition","async-call"],
  ["Navigator.createHandwritingRecognizer","DET-072","recognition","async-call"],
  ["BarcodeDetector","DET-072","recognition","construct"],
  ["BarcodeDetector.getSupportedFormats","DET-072","recognition","async-call"],
  ["BarcodeDetector.detect","DET-072","recognition","async-call"],
  ["FaceDetector","DET-072","recognition","construct"],
  ["FaceDetector.detect","DET-072","recognition","async-call"],
  ["TextDetector","DET-072","recognition","construct"],
  ["TextDetector.detect","DET-072","recognition","async-call"],
  ["Navigator.getInstalledRelatedApps","DET-073","app-integration","async-call"],
  ["Navigator.registerProtocolHandler","DET-073","app-integration","call"],
  ["Navigator.unregisterProtocolHandler","DET-073","app-integration","call"],
  ["Window.getDigitalGoodsService","DET-073","app-integration","async-call"],
  ["Navigator.locks","DET-073","app-integration","get"],
  ["LockManager.query","DET-073","app-integration","async-call"],
  ["LockManager.request","DET-073","app-integration","async-call"],
  ["Navigator.setAppBadge","DET-073","app-integration","async-call"],
  ["Navigator.clearAppBadge","DET-073","app-integration","async-call"],
  ["Navigator.canShare","DET-073","app-integration","call"],
  ["Navigator.share","DET-073","app-integration","async-call"],
  ["Window.showOpenFilePicker","DET-073","app-integration","async-call"],
  ["Window.showSaveFilePicker","DET-073","app-integration","async-call"],
  ["Window.showDirectoryPicker","DET-073","app-integration","async-call"],
  ["StorageManager.getDirectory","DET-073","app-integration","async-call"],
  ["FileSystemHandle.queryPermission","DET-073","app-integration","async-call"],
  ["FileSystemHandle.requestPermission","DET-073","app-integration","async-call"],
  ["PushManager.permissionState","DET-073","app-integration","async-call"],
  ["PushManager.getSubscription","DET-073","app-integration","async-call"],
  ["PushManager.subscribe","DET-073","app-integration","async-call"],
  ["SyncManager.register","DET-073","app-integration","async-call"],
  ["SyncManager.getTags","DET-073","app-integration","async-call"],
  ["PeriodicSyncManager.register","DET-073","app-integration","async-call"],
  ["PeriodicSyncManager.getTags","DET-073","app-integration","async-call"],
  ["PeriodicSyncManager.unregister","DET-073","app-integration","async-call"],
  ["BackgroundFetchManager.fetch","DET-073","app-integration","async-call"],
  ["BackgroundFetchManager.get","DET-073","app-integration","async-call"],
  ["BackgroundFetchManager.getIds","DET-073","app-integration","async-call"],
  ["Navigation.navigate","DET-073","app-integration","call"],
  ["Navigation.reload","DET-073","app-integration","call"],
  ["Navigation.back","DET-073","app-integration","call"],
  ["Navigation.forward","DET-073","app-integration","call"],
  ["Navigation.traverseTo","DET-073","app-integration","call"],
  ["CloseWatcher","DET-073","app-integration","construct"],
  ["CloseWatcher.requestClose","DET-073","app-integration","call"],
  ["CloseWatcher.close","DET-073","app-integration","call"],
  ["CloseWatcher.destroy","DET-073","app-integration","call"],
  ["HTMLElement.showPopover","DET-073","app-integration","call"],
  ["HTMLElement.hidePopover","DET-073","app-integration","call"],
  ["HTMLElement.togglePopover","DET-073","app-integration","call"],
  ["Navigator.ink","DET-073","app-integration","get"],
  ["Ink.requestPresenter","DET-073","app-integration","async-call"],
  ["TrustedTypePolicyFactory.createPolicy","DET-073","app-integration","call"],
  ["TrustedTypePolicyFactory.isHTML","DET-073","app-integration","call"],
  ["TrustedTypePolicyFactory.isScript","DET-073","app-integration","call"],
  ["TrustedTypePolicyFactory.isScriptURL","DET-073","app-integration","call"],
  ["TrustedTypePolicyFactory.getAttributeType","DET-073","app-integration","call"],
  ["TrustedTypePolicyFactory.getPropertyType","DET-073","app-integration","call"],
  ["Permissions.query","DET-039","browser-capabilities","async-call"],
  ["RTCPeerConnection","DET-056","webrtc","construct"],
  ["RTCPeerConnection.generateCertificate","DET-056","webrtc","async-call"],
  ["RTCPeerConnection.createOffer","DET-056","webrtc","async-call"],
  ["RTCPeerConnection.createAnswer","DET-056","webrtc","async-call"],
  ["RTCPeerConnection.setLocalDescription","DET-056","webrtc","async-call"],
  ["RTCPeerConnection.setRemoteDescription","DET-056","webrtc","async-call"],
  ["RTCPeerConnection.addIceCandidate","DET-056","webrtc","async-call"],
  ["RTCPeerConnection.createDataChannel","DET-056","webrtc","call"],
  ["RTCPeerConnection.addTrack","DET-056","webrtc","call"],
  ["RTCPeerConnection.removeTrack","DET-056","webrtc","call"],
  ["RTCPeerConnection.addTransceiver","DET-056","webrtc","call"],
  ["RTCPeerConnection.getConfiguration","DET-056","webrtc","call"],
  ["RTCPeerConnection.setConfiguration","DET-056","webrtc","call"],
  ["RTCPeerConnection.restartIce","DET-056","webrtc","call"],
  ["RTCPeerConnection.close","DET-056","webrtc","call"],
  ["RTCPeerConnection.getSenders","DET-056","webrtc","call"],
  ["RTCPeerConnection.getReceivers","DET-056","webrtc","call"],
  ["RTCPeerConnection.getTransceivers","DET-056","webrtc","call"],
  ["RTCPeerConnection.connectionState","DET-056","webrtc","get"],
  ["RTCPeerConnection.iceConnectionState","DET-056","webrtc","get"],
  ["RTCPeerConnection.iceGatheringState","DET-056","webrtc","get"],
  ["RTCPeerConnection.signalingState","DET-056","webrtc","get"],
  ["RTCPeerConnection.canTrickleIceCandidates","DET-056","webrtc","get"],
  ["RTCPeerConnection.localDescription","DET-057","webrtc","get"],
  ["RTCPeerConnection.currentLocalDescription","DET-057","webrtc","get"],
  ["RTCPeerConnection.pendingLocalDescription","DET-057","webrtc","get"],
  ["RTCPeerConnection.remoteDescription","DET-057","webrtc","get"],
  ["RTCPeerConnection.currentRemoteDescription","DET-057","webrtc","get"],
  ["RTCPeerConnection.pendingRemoteDescription","DET-057","webrtc","get"],
  ["RTCPeerConnection.getStats","DET-057","webrtc","async-call"],
  ["RTCSessionDescription.sdp","DET-057","webrtc","get"],
  ["RTCSessionDescription.type","DET-057","webrtc","get"],
  ["RTCSessionDescription.toJSON","DET-057","webrtc","call"],
  ["RTCCertificate.getFingerprints","DET-057","webrtc","call"],
  ["RTCCertificate.expires","DET-057","webrtc","get"],
  ["RTCRtpSender.getParameters","DET-020","webrtc","call"],
  ["RTCRtpReceiver.getParameters","DET-020","webrtc","call"],
  ["RTCRtpSender.getStats","DET-057","webrtc","async-call"],
  ["RTCRtpReceiver.getStats","DET-057","webrtc","async-call"],
  ["RTCStatsReport.get","DET-057","webrtc","call"],
  ["RTCStatsReport.values","DET-057","webrtc","call"],
  ["RTCStatsReport.entries","DET-057","webrtc","call"],
  ["RTCStatsReport.forEach","DET-057","webrtc","call"],
  ["IDBObjectStore.put","DET-051","webrtc","call"],
  ["IDBObjectStore.add","DET-051","webrtc","call"],
  ["IDBRequest.result","DET-051","webrtc","get"],
  ["Accelerometer","DET-042","device-sensor","construct"],
  ["Gyroscope","DET-042","device-sensor","construct"],
  ["LinearAccelerationSensor","DET-042","device-sensor","construct"],
  ["GravitySensor","DET-042","device-sensor","construct"],
  ["Magnetometer","DET-042","device-sensor","construct"],
  ["AbsoluteOrientationSensor","DET-042","device-sensor","construct"],
  ["RelativeOrientationSensor","DET-042","device-sensor","construct"],
  ["WebTransport","DET-058","webtransport","construct"],
  ["CredentialsContainer.create","DET-069","webauthn","async-call"],
  ["Clipboard.read","DET-069","clipboard","async-call"],
  ["Clipboard.readText","DET-069","clipboard","async-call"],
  ["Clipboard.write","DET-069","clipboard","async-call"],
  ["Clipboard.writeText","DET-069","clipboard","async-call"],
  ["GPUBuffer.mapAsync","DET-014","webgpu","async-call"],
  ["GPUBuffer.getMappedRange","DET-014","webgpu","call"],
  ["GPUBuffer.unmap","DET-014","webgpu","call"],
  ["Window.addEventListener.deviceorientation","DET-042","device-sensor","call"],
  ["Window.ondeviceorientation","DET-042","device-sensor","set"],
  ["Window.addEventListener.devicemotion","DET-042","device-sensor","call"],
  ["Window.ondevicemotion","DET-042","device-sensor","set"],
  ["Window.addEventListener.deviceorientationabsolute","DET-042","device-sensor","call"],
  ["Window.ondeviceorientationabsolute","DET-042","device-sensor","set"],
  ["Worker","DET-064","worker","construct"],
  ["SharedWorker","DET-064","worker","construct"],
  ["Worklet.addModule","DET-064","worker","async-call"],
  ["Document.cookie.get","DET-049","storage","get"],
  ["Document.cookie.set","DET-049","storage","set"],
  ["WebAssembly.Module.imports","DET-065","wasm","call"],
  ["WebAssembly.Module.exports","DET-065","wasm","call"],
  ["WebAssembly.Module.customSections","DET-065","wasm","call"],
  ["WebAssembly.Instance.exports","DET-065","wasm","get"],
  ["WebAssembly.Table","DET-065","wasm","construct"],
  ["WebAssembly.Table.length","DET-065","wasm","get"],
  ["WebAssembly.Table.grow","DET-065","wasm","call"],
  ["WebAssembly.Table.get","DET-065","wasm","call"],
  ["WebAssembly.Table.set","DET-065","wasm","call"],
  ["WebAssembly.Global","DET-065","wasm","construct"],
  ["WebAssembly.Global.valueOf","DET-065","wasm","call"],
  ["WebAssembly.Global.value","DET-065","wasm","get"],
  ["WebAssembly.Global.value.set","DET-065","wasm","set"],
  ["WebAssembly.Tag","DET-065","wasm","construct"],
  ["WebAssembly.Exception","DET-065","wasm","construct"],
  ["WebAssembly.Exception.is","DET-065","wasm","call"],
  ["WebAssembly.Exception.getArg","DET-065","wasm","call"],
  ["WebAssembly.Exception.stack","DET-065","wasm","get"],
  ["WebAssembly.CompileError","DET-065","wasm","construct"],
  ["WebAssembly.LinkError","DET-065","wasm","construct"],
  ["WebAssembly.RuntimeError","DET-065","wasm","construct"],
  ["WebAssembly.Suspending","DET-065","wasm","construct"],
  ["WebAssembly.promising","DET-065","wasm","call"],
  ["WebAssembly.SuspendError","DET-065","wasm","construct"],
  ["WebAssembly.Memory.toFixedLengthBuffer","DET-065","wasm","call"],
  ["WebAssembly.Memory.toResizableBuffer","DET-065","wasm","call"],
  ["WebAssembly.Tag.type","DET-065","wasm","call"]
], API_OPERATIONS = Object.freeze(API_OPERATION_DEFINITIONS.map((definition) => definition[0]));
  var apply = Reflect.apply, mapGet = Map.prototype.get, definitions = new Map(API_OPERATION_DEFINITIONS.map(([operation, techniqueId, mechanism, kind]) => [operation, Object.freeze({ techniqueId, mechanism, kind })]));
  function apiOperationDefinition(operation) {
    return typeof operation != "string" || operation.length > 64 ? null : apply(mapGet, definitions, [operation]) ?? null;
  }
  function isApiOperation(operation) {
    return apiOperationDefinition(operation) !== null;
  }
  function apiOperationAllows(operation, techniqueId, phase) {
    let definition = apiOperationDefinition(operation);
    return definition !== null && definition.techniqueId === techniqueId && (phase === "threw-sync" || phase === (definition.kind === "async-call" ? "settlement-unobserved" : "returned-sync"));
  }

  // packages/contracts/src/extension-targets.generated.ts
  var EXTENSION_TARGET_IDS = [
    "aapbdbdomjkkjkaonfhkkikfgjllcleb",
    "adlpodnneegcnbophopdmhedicjbcgco",
    "admmjipmmciaobhojoghlmleefbicajg",
    "ahmpjcflkgiildlgicmcieglgoilbfdp",
    "akcocjjpkmlniicdeemdceeajlmoabhg",
    "alncdjedloppbablonallfbkeiknmkdi",
    "ammoloihpcbognfddfjcljgembpibcmb",
    "bfbameneiokkgbdmiekhjnmfkcnldhhm",
    "bfogiafebfohielmmehodmfbbebbbpei",
    "bgnkhhnnamicmpeenaelnjfhikgbkllg",
    "bhchdcejhohfmigjafbampogmaanbfkg",
    "bhmmomiinigofkjcapegjjndpbikblnp",
    "bkdgflcldnnnapblkhphbgpggdiikppg",
    "bmnlcjabgnpnenekpadlanbbkooimhnj",
    "bpoadfkcbjbfhfodiogcnhhhpibjhbnh",
    "caljgklbbfbcjjanaijlacgncafpegll",
    "cfhdojbkjhnklbpkdaibdccddilifddb",
    "chhjbpecpncaggjpdakmflnfcopglcmi",
    "cmedhionkhpnakcndndgjdbohmhepckk",
    "cofdbpoegempjloogbagkncekinflcnj",
    "cpcifbdmkopohnnofedkjghjiclmhdah",
    "dahenjhkoodjbpjheillcadbppiidmhp",
    "ddkjiahejlhfcafbddmgiahcphecmpfh",
    "dgjbaljgolmlcmmklmmeafecikidmjpi",
    "dhdgffkkebhmkfjojejmpbldmpobfkfo",
    "dhopldobnfjeckokfjimfcdagmlhjdce",
    "djflhoibgkdhkhhcedjiklpkjnoahfmg",
    "dmghijelimhndkbmpgbldicpogfkceaj",
    "doojmbjmlfjjnbmnoijecmcbfeoakpjm",
    "eclbecdgdoahkliaijlpkigldlkojjdn",
    "ecnphlgnajanjnkcmbpancdjoidceilk",
    "edacconmaakjimmfgnblocblbcdcpbko",
    "edlifbnjlicfpckhgjhflgkeeibhhcii",
    "eenflijjbchafephdplkdmeenekabdfb",
    "efaidnbmnnnibpcajpcglclefindmkaj",
    "egjidjbpglichdcondbcbdnbeeppgdph",
    "eiadekoaikejlgdbkbdfeijglgfdalml",
    "eimadpbcbfnmbkopoojfekhnkhdbieeh",
    "einpaelgookohagofgnnkcfjbkkgepnp",
    "ejjladinnckdgjemekebdpeokbikhfci",
    "elicpjhcidhpjomhibiffojpinpmmpil",
    "emalgedpdlghbkikiaeocoblajamonoh",
    "eppiocemhmnlbhjplcgkofciiegomcon",
    "facgnnelgcipeopfbjcajpaibhhdjgcp",
    "fcalilbnpkfikdppppppchmkdipibalb",
    "fcoeoabgfenejglbffodgkkbkcdhcgfn",
    "fhkphphbadjkepgfljndicmgdlndmoke",
    "fjkmabmdepjfammlpliljpnbhleegehm",
    "fjoaledfpmneenckfbpdfhkmimnjocfa",
    "fllaojicojecljbmefodhfapmkghcbnh",
    "fmkadmapgofadopljbjfkapdkoienihi",
    "gcalenpjmijncebpfijmoaglllgpjagf",
    "gcoekeoenehjmndhkdnoomdjeaclkhbe",
    "gdbofhhdmcladcmmfjolgndfkpobecpg",
    "gebbhagfogifgggkldgodflihgfeippi",
    "gekdekpbfehejjiecgonmgmepbdnaggp",
    "gighmmpiobklfepjocnamgkkbiglidom",
    "gjjbmfigjpgnehjioicaalopaikcnheo",
    "gjoijpfmdhbjkkgnmahganhoinjjpohk",
    "gkojfkhlekighikafcpjkiklfbnlmeio",
    "glcimepnljoholdmjchkloafkggfoijh",
    "gomekmidlodglbbmalcneegieacbdmki",
    "hdokiejnpimakedhajhdlcegeplioahd",
    "hhnhplojcganfmfimkeboiipphklcbih",
    "hipncndjamdcmphkgngojegjblibadbe",
    "hkdmdpdhfaamhgaojpelccmeehpfljgf",
    "hmlcjjclebjnfohgmgikjfnbmfkigocc",
    "hnfanknocfeofbddgcijnmhnfnkdnaad",
    "hniebljpgcogalllopnjokppmgbhaden",
    "iidnankcocecmgpcafggbgbmkbcldmno",
    "inoeonmfapjbbkmdafoankkfajkcphgd",
    "inomeogfingihgjfjlpeplalcfajhgai",
    "jaoafpkngncfpfggjefnekilbkcpjdgp",
    "jchobbjgibcahbheicfocecmhocglkco",
    "jdopnakmnlnccgpfpmjmdjjohmcdgabp",
    "jgfbgkjjlonelmpenhpfeeljjlcgnkpe",
    "jinjaccalgkegednnccohejagnlnfdag",
    "jlhmfgmfgeifomenelglieieghnjghma",
    "jofioghmpdcgiiobkhmdojhjbjiejfbd",
    "jpkfgepcmmchgfbjblnodjhldacghenp",
    "kadocklfjjaaekpjhmpbkbjkhloacing",
    "kbfnbcaeplbcioakkpcpgfkobkghlhen",
    "kceglpglilklghkgofolieongaolnaob",
    "kdfieneakcjfaiglcfcgkidlkmlijjnh",
    "kdmnjgijlmjgmimahnillepgcgeemffb",
    "kobncfkmjelbefaoohoblamnbackjggk",
    "kpdjmbiefanbdgnkcikhllpmjnnllbbc",
    "kpiecbcckbofpmkkkdibbllpinceiihk",
    "lanfdkkpgfjfdikkncbnojekcppdebfp",
    "ldipcbpaocekfooobnbcddclnhejkcpn",
    "ldpochfccmkkmhdbclfhpagapcfdljkj",
    "lejoknkbcogjceoniealiipllomkpioe",
    "lfdconleibeikjpklmlahaihpnkpmlch",
    "lfidjngibpklhhijphdmbmedchiiolgk",
    "lgblnfidahcdcjddiepkckcfdhpknnjh",
    "lgjhepbpjcmfmjlpkkdjlbgomamkgonb",
    "llbcnfanfmjhpedaedhbcnpgeepdnnok",
    "lmjnegcaeklhafolokijcfjliaokphfk",
    "lneaocagcijjdpkcabeanfpdbmapcjjg",
    "majdfhpaihoncoakbjgbdhglocklcgno",
    "mbniclmhobmnbdlbpiphghaielnnpgdp",
    "mciiogijehkdemklbdcbfkefimifhecn",
    "mclkkofklkfljcocdinagocijmpgbhab",
    "mcohilncbfahbmgdjkbpemcciiolgcge",
    "meojnmfhjkahlfcecpdcdgjclcilmaij",
    "mfpiaehgjbbfednooihadalhehabhcjo",
    "mhkgegcmcapcgmnnloigolapjkajgfmd",
    "mlomiejdfkolichcflejclcbmpeaniij",
    "mmeijimgabbpbgpdklnllpncmdofkcpn",
    "mpnlkmlkncncpgnnkmkgoobfpnjmblnk",
    "ncennffkjdiamlpmcbajkmaiiiddgioo",
    "nfadicbbecgbdbgbibgflooojfbolpgk",
    "njgehaondchbmjmajphnhlojfnbfokng",
    "nkbihfbeogaeaoehlefnkodbefgpgknn",
    "nlipoenfbbikpbjkfpfillcgkoblgpmj",
    "nngceckbapebfimnlniiiahkandclblb",
    "nomnklagbgmgghhjidfhnoelnjfndfpd",
    "npeicpdbkakmehahjeeohfdhnlpdklia",
    "oaobmlmjmhedmlphfdmdjpppjmcljnkp",
    "oejgccbfbmkkpaidnkphaiaecficdnfn",
    "oemmndcbldboiebfnladdacbdfmadadm",
    "oldceeleldhonbafppcapldpdifcinji",
    "olnbjpaejebpnokblkepbphhembdicik",
    "omghfjlpggmjjaagoclmmobgdodcjboh",
    "pcbjiidheaempljdefbdplebgdgpjcbe",
    "pkehgijcmpdhfbdbbnkijodmdjhbjlgp",
    "ponfpcnoihfmfllpaingbgckeeldkhle",
    "ppnbnpeolgkicgegkbkbjmhlideopiji"
  ];

  // packages/contracts/src/extension-resources.ts
  var EXTENSION_TARGET_KEYS = ["unknown", ...EXTENSION_TARGET_IDS], EXTENSION_RESOURCE_METHODS = ["fetch", "xhr-send", "image-src", "script-src"], apply2 = Reflect.apply, mapGet2 = Map.prototype.get, targets = new Map(EXTENSION_TARGET_KEYS.map((target, index) => [target, index]));
  function extensionTargetIndex(target) {
    return typeof target != "string" || target.length > 32 ? null : apply2(mapGet2, targets, [target]) ?? null;
  }
  function extensionResourceAllows(resource, techniqueId, phase) {
    return techniqueId === "DET-059" && (phase === "threw-sync" || phase === (resource.method === "fetch" || resource.method === "xhr-send" ? "settlement-unobserved" : "returned-sync"));
  }
  function readExtensionResource(value) {
    try {
      if (typeof value != "object" || value === null || Array.isArray(value) || Reflect.ownKeys(value).length !== 2) return null;
      let prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return null;
      let target = Object.getOwnPropertyDescriptor(value, "target"), method = Object.getOwnPropertyDescriptor(value, "method");
      return !target?.enumerable || !method?.enumerable || !Object.hasOwn(target, "value") || !Object.hasOwn(method, "value") || extensionTargetIndex(target.value) === null || !EXTENSION_RESOURCE_METHODS.includes(method.value) ? null : { target: target.value, method: method.value };
    } catch {
      return null;
    }
  }

  // packages/contracts/src/validate.ts
  var capturedApply = Reflect.apply, capturedKeys = Object.keys, capturedIsArray = Array.isArray, capturedHasOwn = Object.prototype.hasOwnProperty, capturedSetHas = Set.prototype.has, capturedSetSize = Object.getOwnPropertyDescriptor(Set.prototype, "size").get, capturedInteger = Number.isInteger, capturedRegexExec = RegExp.prototype.exec;
  function setContains(set, value) {
    return capturedApply(capturedSetHas, set, [value]);
  }
  var TECHNIQUE_SET = new Set(TECHNIQUE_IDS), SIGNAL_SET = new Set(SIGNAL_CODES), COVERAGE_SET = new Set(COVERAGE_FLAGS), COUNT_QUALITY_SET = new Set(COUNT_QUALITIES), PHASE_SET = new Set(PHASES), SCOPE_SET = new Set(SCOPE_MODES), SENSOR_STATE_SET = new Set(SENSOR_STATES), STOP_REASON_SET = new Set(BRIDGE_STOP_REASONS), CONTROL_COMMAND_SET = new Set(BRIDGE_CONTROL_COMMANDS), ID_RE = /^[A-Za-z0-9_-]+$/;
  var FORBIDDEN_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]), MAX_ENUM_CHARS = 64, MAX_TYPE_CHARS = 32;
  function fail(reason) {
    return { ok: !1, reason };
  }
  function isObjectLike(v) {
    return typeof v == "object" && v !== null && !capturedIsArray(v);
  }
  function hasOwn(o, k) {
    return capturedApply(capturedHasOwn, o, [k]);
  }
  function checkKeys(obj, allowed, required, path) {
    let keys3 = capturedKeys(obj);
    if (keys3.length > capturedApply(capturedSetSize, allowed, [])) return path + ": too many keys";
    for (let i = 0; i < keys3.length; i++) {
      let k = keys3[i];
      if (setContains(FORBIDDEN_KEYS, k)) return path + ": forbidden key";
      if (!setContains(allowed, k)) return path + ": unknown key";
    }
    for (let i = 0; i < required.length; i++) {
      let r = required[i];
      if (!hasOwn(obj, r)) return path + ": missing " + r;
    }
    return null;
  }
  function readString(v, max) {
    return typeof v == "string" && v.length >= 1 && v.length <= max ? v : null;
  }
  function readId(v) {
    let s = readString(v, BUDGETS.maxIdChars);
    return s !== null && capturedApply(capturedRegexExec, ID_RE, [s]) !== null ? s : null;
  }
  function readBool(v) {
    return typeof v == "boolean" ? v : null;
  }
  function readInt(v, min, max) {
    return typeof v != "number" || !capturedInteger(v) || v < min || v > max ? null : v === 0 ? 0 : v;
  }
  function readCount(v) {
    return typeof v != "number" || !capturedInteger(v) || v < 0 ? null : v > 2147483647 ? 2147483647 : v === 0 ? 0 : v;
  }
  function readEnum(v, set) {
    return typeof v == "string" && v.length <= MAX_ENUM_CHARS && setContains(set, v) ? v : null;
  }
  function readEnumArray(v, set, max) {
    if (!capturedIsArray(v) || v.length > max) return null;
    let out = [], seen = /* @__PURE__ */ new Set();
    for (let item of v) {
      let e = readEnum(item, set);
      if (e === null || seen.has(e)) return null;
      seen.add(e), out.push(e);
    }
    return out;
  }
  function readCoverageFlags(v) {
    return readEnumArray(v, COVERAGE_SET, COVERAGE_FLAGS.length);
  }
  var OBS_KEYS = ["techniqueId", "count", "countQuality", "phase", "signalCodes", "intervalBucket"], OBS_KEY_SET = /* @__PURE__ */ new Set([...OBS_KEYS, "apiOperation", "extensionResource"]);
  function validateObservation(v, path) {
    if (!isObjectLike(v)) return fail(path + ": not an object");
    let keyError = checkKeys(v, OBS_KEY_SET, OBS_KEYS, path);
    if (keyError !== null) return fail(keyError);
    let techniqueId = readEnum(v.techniqueId, TECHNIQUE_SET);
    if (techniqueId === null || techniqueId === "DET-074") return fail(path + ".techniqueId");
    let count = readCount(v.count);
    if (count === null) return fail(path + ".count");
    let countQuality = readEnum(v.countQuality, COUNT_QUALITY_SET);
    if (countQuality === null) return fail(path + ".countQuality");
    let phase = readEnum(v.phase, PHASE_SET);
    if (phase === null) return fail(path + ".phase");
    let signalCodes = readEnumArray(v.signalCodes, SIGNAL_SET, BUDGETS.maxSignalCodesPerObservation);
    if (signalCodes === null) return fail(path + ".signalCodes");
    let intervalBucket = readInt(v.intervalBucket, 0, 2147483647);
    if (intervalBucket === null) return fail(path + ".intervalBucket");
    if (hasOwn(v, "extensionResource")) {
      let field2 = Object.getOwnPropertyDescriptor(v, "extensionResource"), resource = field2 && hasOwn(field2, "value") && field2.enumerable ? readExtensionResource(field2.value) : null;
      return !resource || hasOwn(v, "apiOperation") || !extensionResourceAllows(resource, techniqueId, phase) || signalCodes.length !== 1 || signalCodes[0] !== "api-use" ? fail(path + ".extensionResource") : { ok: !0, value: { techniqueId, count, countQuality, phase, signalCodes, intervalBucket, extensionResource: resource } };
    }
    if (hasOwn(v, "apiOperation")) {
      let field2 = Object.getOwnPropertyDescriptor(v, "apiOperation");
      return !field2 || !hasOwn(field2, "value") || !field2.enumerable || !isApiOperation(field2.value) || !apiOperationAllows(field2.value, techniqueId, phase) || signalCodes.length !== 1 || signalCodes[0] !== "api-use" ? fail(path + ".apiOperation") : { ok: !0, value: { techniqueId, count, countQuality, phase, signalCodes, intervalBucket, apiOperation: field2.value } };
    }
    return { ok: !0, value: { techniqueId, count, countQuality, phase, signalCodes, intervalBucket } };
  }
  function validateObservations(v, path, minItems = 1) {
    if (!capturedIsArray(v)) return fail(path + ": not an array");
    if (v.length < minItems || v.length > BUDGETS.maxBatchEvents) return fail(path + ": length out of range");
    let out = [];
    for (let i = 0; i < v.length; i++) {
      let r = validateObservation(v[i], path + "[" + String(i) + "]");
      if (!r.ok) return r;
      out.push(r.value);
    }
    return { ok: !0, value: out };
  }
  var BATCH_KEYS = [
    "schemaVersion",
    "type",
    "sensorBootId",
    "bridgeSessionId",
    "batchSeq",
    "observations",
    "coverageDelta"
  ], BATCH_KEY_SET = new Set(BATCH_KEYS);
  var SENSOR_HELLO_KEYS = ["channel", "sensorBootId", "type", "protocolVersion", "startedLate", "coverageFlags"], SENSOR_BATCH_KEYS = ["channel", "sensorBootId", "type", "sensorSeq", "observations", "coverageDelta"], SENSOR_STATUS_KEYS = ["channel", "sensorBootId", "type", "state", "coverageFlags", "droppedSinceLast"], SENSOR_HELLO_SET = new Set(SENSOR_HELLO_KEYS), SENSOR_BATCH_SET = new Set(SENSOR_BATCH_KEYS), SENSOR_STATUS_SET = new Set(SENSOR_STATUS_KEYS);
  function readMessageType(input) {
    let t = input.type;
    return typeof t == "string" && t.length >= 1 && t.length <= MAX_TYPE_CHARS ? t : null;
  }
  function readPageMessageHeader(input, path) {
    if (input.channel !== CHANNEL) return fail(path + ".channel");
    let sensorBootId = readId(input.sensorBootId);
    return sensorBootId === null ? fail(path + ".sensorBootId") : { ok: !0, value: sensorBootId };
  }
  function sensorMessage(input) {
  if (!isObjectLike(input)) return fail("sensor: not an object");
  const type = readMessageType(input);
  if (type === null) return fail("sensor.type");
  switch (type) {
    case "sensor-reset": {
      const required = ["channel", "sensorBootId", "type", "resetId", "nextSensorBootId", "coverageFlags"];
      const error = checkKeys(input, new Set(required), required, type);
      if (error !== null) return fail(error);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      const resetId = readId(input["resetId"]);
      const nextSensorBootId = readId(input["nextSensorBootId"]);
      const coverageFlags = readCoverageFlags(input["coverageFlags"]);
      if (resetId === null || nextSensorBootId === null || nextSensorBootId === header.value || coverageFlags === null) return fail("sensor-reset.ids");
      return { ok: true, value: { channel: CHANNEL, sensorBootId: header.value, type, resetId, nextSensorBootId, coverageFlags } };
    }
    case "sensor-hello": {
      const keyError = checkKeys(input, SENSOR_HELLO_SET, SENSOR_HELLO_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      const protocolVersion = readInt(input["protocolVersion"], 0, 2147483647);
      if (protocolVersion === null) return fail(type + ".protocolVersion");
      const startedLate = readBool(input["startedLate"]);
      if (startedLate === null) return fail(type + ".startedLate");
      const coverageFlags = readCoverageFlags(input["coverageFlags"]);
      if (coverageFlags === null) return fail(type + ".coverageFlags");
      return {
        ok: true,
        value: { channel: CHANNEL, sensorBootId: header.value, type, protocolVersion, startedLate, coverageFlags }
      };
    }
    case "sensor-batch": {
      const keyError = checkKeys(input, SENSOR_BATCH_SET, SENSOR_BATCH_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      const sensorSeq = readInt(input["sensorSeq"], 1, 2147483647);
      if (sensorSeq === null) return fail(type + ".sensorSeq");
      const observations = validateObservations(input["observations"], type + ".observations");
      if (!observations.ok) return observations;
      const coverageDelta = readCoverageFlags(input["coverageDelta"]);
      if (coverageDelta === null) return fail(type + ".coverageDelta");
      return {
        ok: true,
        value: {
          channel: CHANNEL,
          sensorBootId: header.value,
          type,
          sensorSeq,
          observations: observations.value,
          coverageDelta
        }
      };
    }
    case "sensor-status": {
      const keyError = checkKeys(input, SENSOR_STATUS_SET, SENSOR_STATUS_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      const state = readEnum(input["state"], SENSOR_STATE_SET);
      if (state === null) return fail(type + ".state");
      const coverageFlags = readCoverageFlags(input["coverageFlags"]);
      if (coverageFlags === null) return fail(type + ".coverageFlags");
      const droppedSinceLast = readCount(input["droppedSinceLast"]);
      if (droppedSinceLast === null) return fail(type + ".droppedSinceLast");
      return {
        ok: true,
        value: { channel: CHANNEL, sensorBootId: header.value, type, state, coverageFlags, droppedSinceLast }
      };
    }
    default:
      return fail("sensor.type");
  }
}
  function validateSensorMessage(input) {
    try {
      return sensorMessage(input);
    } catch {
      return fail("sensor: exception");
    }
  }
  var BRIDGE_HELLO_KEYS = ["channel", "sensorBootId", "type", "protocolVersion", "bridgeSessionId", "paused"], BRIDGE_SIMPLE_KEYS = ["channel", "sensorBootId", "type"], BRIDGE_STOP_KEYS = ["channel", "sensorBootId", "type", "reason"], BRIDGE_HELLO_SET = new Set(BRIDGE_HELLO_KEYS), BRIDGE_SIMPLE_SET = new Set(BRIDGE_SIMPLE_KEYS), BRIDGE_STOP_SET = new Set(BRIDGE_STOP_KEYS);
  function bridgeMessage(input) {
  if (!isObjectLike(input)) return fail("bridge: not an object");
  const type = readMessageType(input);
  if (type === null) return fail("bridge.type");
  switch (type) {
    case "bridge-reset": {
      const required = ["channel", "sensorBootId", "type", "resetId"];
      const error = checkKeys(input, new Set(required), required, type);
      if (error !== null) return fail(error);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      const resetId = readId(input["resetId"]);
      return resetId === null ? fail("bridge-reset.resetId") : { ok: true, value: { channel: CHANNEL, sensorBootId: header.value, type, resetId } };
    }
    case "bridge-hello": {
      const keyError = checkKeys(input, BRIDGE_HELLO_SET, BRIDGE_HELLO_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      const protocolVersion = readInt(input["protocolVersion"], 0, 2147483647);
      if (protocolVersion === null) return fail(type + ".protocolVersion");
      const bridgeSessionId = readId(input["bridgeSessionId"]);
      if (bridgeSessionId === null) return fail(type + ".bridgeSessionId");
      const paused = readBool(input["paused"]);
      if (paused === null) return fail(type + ".paused");
      return {
        ok: true,
        value: { channel: CHANNEL, sensorBootId: header.value, type, protocolVersion, bridgeSessionId, paused }
      };
    }
    case "bridge-pause":
    case "bridge-resume": {
      const keyError = checkKeys(input, BRIDGE_SIMPLE_SET, BRIDGE_SIMPLE_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      return { ok: true, value: { channel: CHANNEL, sensorBootId: header.value, type } };
    }
    case "bridge-stop": {
      const keyError = checkKeys(input, BRIDGE_STOP_SET, BRIDGE_STOP_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      const reason = readEnum(input["reason"], STOP_REASON_SET);
      if (reason === null) return fail(type + ".reason");
      return { ok: true, value: { channel: CHANNEL, sensorBootId: header.value, type, reason } };
    }
    default:
      return fail("bridge.type");
  }
}
  function validateBridgeMessage(input) {
    try {
      return bridgeMessage(input);
    } catch {
      return fail("bridge: exception");
    }
  }
  var BRIDGE_CONTROL_KEYS = ["schemaVersion", "type", "command"], BRIDGE_CONTROL_SET = new Set(BRIDGE_CONTROL_KEYS);
  /* clear-reset:control-reader:start */
var capturedOwnKeys = Reflect.ownKeys, capturedDescriptor = Object.getOwnPropertyDescriptor, capturedCreate = Object.create;
var BRIDGE_CONTROL_RESET_SET = new Set([...BRIDGE_CONTROL_KEYS, "resetId"]);
function readDataFields(input, allowed, required) {
  if (!isObjectLike(input)) return null;
  const keys = capturedOwnKeys(input);
  if (keys.length > capturedApply(capturedSetSize, allowed, [])) return null;
  const fields = capturedCreate(null);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (typeof key !== "string" || !setContains(allowed, key)) return null;
    const descriptor = capturedDescriptor(input, key);
    if (descriptor === void 0 || !hasOwn(descriptor, "value") || !descriptor.enumerable) return null;
    fields[key] = descriptor.value;
  }
  for (let index = 0; index < required.length; index++) if (!hasOwn(fields, required[index])) return null;
  return fields;
}
/* clear-reset:control-reader:end */
function bridgeControl(input) {
  const fields = readDataFields(input, BRIDGE_CONTROL_RESET_SET, BRIDGE_CONTROL_KEYS);
  if (fields === null) return fail("control: data fields");
  input = fields;
  if (!isObjectLike(input)) return fail("control: not an object");
  if (readMessageType(input) === "bridge-control" && input["command"] === "reset") {
    const required = ["schemaVersion", "type", "command", "resetId"];
    const error = checkKeys(input, new Set(required), required, "bridge-control");
    if (error !== null) return fail(error);
    const resetId = readId(input["resetId"]);
    return input["schemaVersion"] === 1 && resetId !== null ? { ok: true, value: { schemaVersion: 1, type: "bridge-control", command: "reset", resetId } } : fail("bridge-control.reset");
  }
  const keyError = checkKeys(input, BRIDGE_CONTROL_SET, BRIDGE_CONTROL_KEYS, "bridge-control");
  if (keyError !== null) return fail(keyError);
  if (input["schemaVersion"] !== 1) return fail("bridge-control.schemaVersion");
  if (input["type"] !== "bridge-control") return fail("bridge-control.type");
  const command = readEnum(input["command"], CONTROL_COMMAND_SET);
  if (command === null || command === "reset") return fail("bridge-control.command");
  return { ok: true, value: { schemaVersion: 1, type: "bridge-control", command } };
}
  function validateBridgeControl(input) {
    try {
      return bridgeControl(input);
    } catch {
      return fail("control: exception");
    }
  }
  var UI_GET_REPORT_REQUIRED = ["schemaVersion", "type", "tabId"], UI_GET_REPORT_SET = /* @__PURE__ */ new Set([...UI_GET_REPORT_REQUIRED, "frameId"]), UI_REVISION_KEYS = ["schemaVersion", "type", "tabId", "documentKey", "reportRevision"], UI_REVISION_SET = new Set(UI_REVISION_KEYS), UI_EXPORT_SET = /* @__PURE__ */ new Set([...UI_REVISION_KEYS, "includeHost"]), UI_SET_SCOPE_REQUIRED = ["schemaVersion", "type", "scopeMode"], UI_SET_SCOPE_SET = /* @__PURE__ */ new Set([...UI_SET_SCOPE_REQUIRED, "host"]), UI_GET_SCOPE_KEYS = ["schemaVersion", "type"], UI_GET_SCOPE_SET = new Set(UI_GET_SCOPE_KEYS), UI_INJECT_NOW_KEYS = ["schemaVersion", "type", "tabId"], UI_INJECT_NOW_SET = new Set(UI_INJECT_NOW_KEYS);

  // packages/contracts/src/visual-preview.ts
  var VISUAL_CHANNEL = "detect.expert/visual/v1", VISUAL_LIMITS = Object.freeze({
    leaseMs: 6e4,
    maxPixels: 65536,
    maxDimension: 1024,
    maxBase64Chars: 524288,
    maxImages: 256,
    maxCanvases: 512,
    maxTotalBase64Chars: 12582912,
    maxFrames: 512,
    maxReadbacks: 65535,
    maxDocuments: 4,
    maxPending: 4
  }), VISUAL_RENDERERS = ["unknown", "2d", "webgl", "webgl2", "webgpu", "bitmaprenderer"], VISUAL_OPERATIONS = [
    "text",
    "image-copy",
    "cropped-copy",
    "recombined-copy",
    "flip-back-copy",
    "canvas-reset",
    "pixel-write",
    "fill",
    "gradient",
    "pattern",
    "path",
    "transform",
    "flip-x",
    "flip-y",
    "fractional",
    "alpha",
    "composite",
    "repeat-readback",
    "multiple-readback-formats",
    "texture-upload",
    "2d-to-webgl",
    "webgl-to-2d",
    "webgl-to-webgl",
    "shader",
    "gpu-draw",
    "gpu-sync",
    "gl-parameters",
    "timer-extension",
    "timer-query",
    "query-read",
    "occlusion-query",
    "bitmap-transfer",
    "offscreen-transfer",
    "bitmap-create",
    "svg-source"
  ], VISUAL_CACHE_IDLE_MS = 10 * 6e4, descriptor = Object.getOwnPropertyDescriptor, names = Object.getOwnPropertyNames, integer = Number.isSafeInteger, test = Function.prototype.call.bind(RegExp.prototype.test), BASE64 = /^[A-Za-z0-9+/]*={0,2}$/, decode = atob, BOOT = /^boot-[a-f0-9]{24}$/, CACHE_TOKEN = /^[a-f0-9]{32}$/, CANVAS_ID = /^boot-[a-f0-9]{24}:[1-9][0-9]{0,2}$/;
  function read(value, key) {
    return descriptor(value, key)?.value;
  }
  function shape(value, keys3) {
    if (typeof value != "object" || value === null || names(value).length !== keys3.length) return !1;
    for (let i = 0; i < keys3.length; i++) {
      let d = descriptor(value, keys3[i]);
      if (!d || !descriptor(d, "value")) return !1;
    }
    return !0;
  }
  function whole(value, min, max) {
    return typeof value == "number" && integer(value) && value >= min && value <= max;
  }
  function control(value) {
    return typeof read(value, "enabled") == "boolean" && whole(read(value, "remainingMs"), 0, VISUAL_LIMITS.leaseMs);
  }
  function optionalShape(value, required, optional) {
    return typeof value != "object" || value === null ? !1 : shape(value, [...required, ...optional.filter((key) => descriptor(value, key) !== void 0)]);
  }
  function visualCanvas(input) {
    if (!shape(input, ["id", "renderer", "operations", "readbacks"])) return null;
    let id = read(input, "id"), renderer = read(input, "renderer"), raw = read(input, "operations"), readbacks = read(input, "readbacks");
    if (typeof id != "string" || !test(CANVAS_ID, id) || !whole(Number(id.slice(30)), 1, VISUAL_LIMITS.maxCanvases) || !VISUAL_RENDERERS.some((value) => value === renderer) || !whole(readbacks, 1, VISUAL_LIMITS.maxReadbacks) || !Array.isArray(raw) || raw.length > VISUAL_OPERATIONS.length) return null;
    let operations = [];
    for (let index = 0; index < raw.length; index++) {
      let item = descriptor(raw, String(index));
      if (!item || !descriptor(item, "value") || !VISUAL_OPERATIONS.some((value) => value === item.value) || operations.includes(item.value)) return null;
      operations.push(item.value);
    }
    return { id, renderer, operations, readbacks };
  }
  function visualImageKey(image) {
    return image.canvas?.id ?? image.kind;
  }
  function mergeVisualImage(previous, image) {
    if (!previous) return image;
    if (!previous.canvas || !image.canvas) return previous;
    let operations = VISUAL_OPERATIONS.filter((operation) => previous.canvas.operations.includes(operation) || image.canvas.operations.includes(operation)), readbacks = Math.max(previous.canvas.readbacks, image.canvas.readbacks), renderer = previous.canvas.renderer === "unknown" ? image.canvas.renderer : previous.canvas.renderer;
    if (operations.length === previous.canvas.operations.length && readbacks === previous.canvas.readbacks && renderer === previous.canvas.renderer) return previous;
    let kind = previous.format === "png" && (renderer === "webgl" || renderer === "webgl2") ? "webgl" : previous.kind;
    return { ...previous, kind, canvas: { id: previous.canvas.id, renderer, operations, readbacks } };
  }
  function retainVisualImage(images, image) {
    let key = visualImageKey(image), previous = images.get(key);
    if (image = mergeVisualImage(previous, image), previous === image) return !0;
    if (!previous && images.size >= VISUAL_LIMITS.maxImages) return !1;
    let total = image.data.length - (previous?.data.length ?? 0);
    for (let retained of images.values()) total += retained.data.length;
    return total > VISUAL_LIMITS.maxTotalBase64Chars ? !1 : (images.set(key, image), !0);
  }
  function validateVisualImage(input) {
    try {
      if (!optionalShape(input, ["kind", "source", "format", "width", "height", "data"], ["canvas"])) return { ok: !1 };
      let kind = read(input, "kind"), source = read(input, "source"), format = read(input, "format"), width = read(input, "width"), height = read(input, "height"), data = read(input, "data");
      if (!whole(width, 1, VISUAL_LIMITS.maxDimension) || !whole(height, 1, VISUAL_LIMITS.maxDimension) || width * height > VISUAL_LIMITS.maxPixels) return { ok: !1 };
      if (typeof data != "string" || data.length === 0 || data.length > VISUAL_LIMITS.maxBase64Chars || data.length % 4 !== 0 || !test(BASE64, data)) return { ok: !1 };
      if (kind === "webgl" ? !(source === "readPixels" && format === "rgba" || source === "toDataURL" && format === "png") : kind !== "canvas" || !(source === "getImageData" && format === "rgba" || source === "toDataURL" && format === "png")) return { ok: !1 };
      if (format === "rgba") {
        if (data.length / 4 * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0) !== width * height * 4) return { ok: !1 };
      } else {
        if (data.length < 44) return { ok: !1 };
        let header = decode(data.slice(0, 44)), byte = (i) => header.charCodeAt(i), uint = (i) => byte(i) * 16777216 + byte(i + 1) * 65536 + byte(i + 2) * 256 + byte(i + 3);
        if (header.slice(0, 8) !== `PNG\r

` || uint(8) !== 13 || header.slice(12, 16) !== "IHDR" || uint(16) !== width || uint(20) !== height) return { ok: !1 };
      }
      let hasCanvas = descriptor(input, "canvas") !== void 0, canvas = hasCanvas ? visualCanvas(read(input, "canvas")) : null;
      return hasCanvas && canvas === null ? { ok: !1 } : canvas && (canvas.renderer === "webgl" || canvas.renderer === "webgl2") != (kind === "webgl") && canvas.renderer !== "unknown" ? { ok: !1 } : { ok: !0, value: { kind, source, format, width, height, data, ...canvas ? { canvas } : {} } };
    } catch {
      return { ok: !1 };
    }
  }
  function validateBridgeVisualControl(input) {
    try {
      return !shape(input, ["schemaVersion", "type", "enabled", "remainingMs"]) || read(input, "schemaVersion") !== 1 || read(input, "type") !== "visual-control" || !control(input) ? { ok: !1 } : { ok: !0, value: input };
    } catch {
      return { ok: !1 };
    }
  }
  function validateVisualFrameAck(input) {
    try {
      if (!optionalShape(input, ["schemaVersion", "type", "accepted", "cacheToken", "remainingMs"], ["retained", "truncated"]) || read(input, "schemaVersion") !== 1 || read(input, "type") !== "visual-frame-ack") return { ok: !1 };
      let accepted = read(input, "accepted"), cacheToken = read(input, "cacheToken"), remainingMs = read(input, "remainingMs");
      if (typeof accepted != "boolean" || !whole(remainingMs, 0, VISUAL_CACHE_IDLE_MS)) return { ok: !1 };
      if (accepted ? typeof cacheToken != "string" || !test(CACHE_TOKEN, cacheToken) || remainingMs === 0 : cacheToken !== null || remainingMs !== 0) return { ok: !1 };
      let retained = read(input, "retained"), truncated = read(input, "truncated");
      return descriptor(input, "retained") && typeof retained != "boolean" || descriptor(input, "truncated") && typeof truncated != "boolean" ? { ok: !1 } : { ok: !0, value: {
        schemaVersion: 1,
        type: "visual-frame-ack",
        accepted,
        cacheToken,
        remainingMs,
        ...typeof retained == "boolean" ? { retained } : {},
        ...typeof truncated == "boolean" ? { truncated } : {}
      } };
    } catch {
      return { ok: !1 };
    }
  }
  function validateVisualCacheRequest(input) {
    try {
      if (!shape(input, ["schemaVersion", "type", "cacheToken"]) || read(input, "schemaVersion") !== 1) return { ok: !1 };
      let type = read(input, "type"), cacheToken = read(input, "cacheToken");
      return type !== "visual-cache-read" && type !== "visual-cache-touch" || typeof cacheToken != "string" || !test(CACHE_TOKEN, cacheToken) ? { ok: !1 } : { ok: !0, value: { schemaVersion: 1, type, cacheToken } };
    } catch {
      return { ok: !1 };
    }
  }
  function validateVisualSensorMessage(input) {
    try {
      if (typeof input != "object" || input === null || read(input, "channel") !== VISUAL_CHANNEL) return { ok: !1 };
      let boot = read(input, "sensorBootId");
      if (typeof boot != "string" || !test(BOOT, boot)) return { ok: !1 };
      let type = read(input, "type");
      if ((type === "visual-hello" || type === "visual-limited") && shape(input, ["channel", "type", "sensorBootId"])) return { ok: !0, value: { channel: VISUAL_CHANNEL, type, sensorBootId: boot } };
      if (read(input, "type") === "visual-image" && shape(input, ["channel", "type", "sensorBootId", "image"])) {
        let image = validateVisualImage(read(input, "image"));
        if (image.ok) return { ok: !0, value: { channel: VISUAL_CHANNEL, type: "visual-image", sensorBootId: boot, image: image.value } };
      }
      return { ok: !1 };
    } catch {
      return { ok: !1 };
    }
  }

  // packages/contracts/src/rtc-details.ts
  var RTC_DETAILS_CHANNEL = "detect.expert/rtc/v1", RTC_LIMITS = Object.freeze({ maxConnections: 32, maxServers: 8, maxBytes: 32768, maxDocuments: 8, idleMs: 6e5, flushMs: 250 }), RTC_STATES = ["new", "connecting", "connected", "disconnected", "failed", "closed", "unknown"], RTC_DURATIONS = ["open", "under-1s", "1-10s", "10s-plus", "unknown"], get = Object.getOwnPropertyDescriptor, keys = Object.getOwnPropertyNames, isArray = Array.isArray, isInteger = Number.isSafeInteger, exec = Function.prototype.call.bind(RegExp.prototype.exec), test2 = (re, text) => exec(re, text) !== null, lower = Function.prototype.call.bind(String.prototype.toLowerCase), at = Function.prototype.call.bind(String.prototype.charCodeAt), TOKEN = /^[a-f0-9]{32}$/, BOOT2 = /^boot-[a-f0-9]{24}$/, MAX_COUNT2 = 2147483647;
  function read2(v, key) {
    return get(v, key)?.value;
  }
  function shape2(v, fields2) {
    if (typeof v != "object" || v === null || keys(v).length !== fields2.length) return !1;
    for (let i = 0; i < fields2.length; i++) {
      let d = get(v, fields2[i]);
      if (!d || !get(d, "value")) return !1;
    }
    return !0;
  }
  function integer2(v, min = 0, max = MAX_COUNT2) {
    return typeof v == "number" && isInteger(v) && v >= min && v <= max;
  }
  function token(v) {
    return typeof v == "string" && test2(TOKEN, v);
  }
  function host(v) {
    if (typeof v != "string" || v.length < 1 || v.length > 253) return !1;
    if (test2(/^\[[0-9a-f:]{2,45}\]$/, v)) {
      for (let i = 0; i < v.length; i++) if (at(v, i) === 58) return !0;
      return !1;
    }
    if (!test2(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/, v)) return !1;
    let length = 0, previous = 0;
    for (let i = 0; i <= v.length; i++) {
      let c = i === v.length ? 46 : at(v, i);
      if (c === 46) {
        if (length === 0 || length > 63 || previous === 45) return !1;
        length = 0;
      } else {
        if (length === 0 && c === 45) return !1;
        length++;
      }
      previous = c;
    }
    return !0;
  }
  function validateRtcSnapshot(value) {
    try {
      if (!shape2(value, ["revision", "total", "omitted", "captureLimited", "connections"])) return { ok: !1 };
      let revision = read2(value, "revision"), total = read2(value, "total"), omitted = read2(value, "omitted"), captureLimited = read2(value, "captureLimited"), raw = read2(value, "connections");
      if (!integer2(revision) || !integer2(total) || !integer2(omitted) || typeof captureLimited != "boolean" || !isArray(raw) || raw.length > RTC_LIMITS.maxConnections || total < raw.length || omitted > total) return { ok: !1 };
      let connections = [], chars = 128, ids = /* @__PURE__ */ new Set();
      for (let i = 0; i < raw.length; i++) {
        let c = read2(raw, String(i));
        if (!shape2(c, ["id", "created", "closed", "connected", "state", "duration", "configurationChanges", "servers", "truncated"])) return { ok: !1 };
        let id = read2(c, "id"), created = read2(c, "created"), closed = read2(c, "closed"), connected = read2(c, "connected"), state = read2(c, "state"), duration = read2(c, "duration"), configurationChanges = read2(c, "configurationChanges"), truncated = read2(c, "truncated"), s = read2(c, "servers");
        if (!integer2(id, 1) || ids.has(id) || id > total || typeof created != "boolean" || typeof closed != "boolean" || typeof connected != "boolean" || !RTC_STATES.includes(state) || !RTC_DURATIONS.includes(duration) || !integer2(configurationChanges) || typeof truncated != "boolean" || !isArray(s) || s.length > RTC_LIMITS.maxServers) return { ok: !1 };
        ids.add(id);
        let servers = [], endpoints = /* @__PURE__ */ new Set();
        chars += 240;
        for (let j = 0; j < s.length; j++) {
          let item = read2(s, String(j));
          if (!shape2(item, ["scheme", "host", "port", "transport", "configured", "candidate", "error"])) return { ok: !1 };
          let scheme = read2(item, "scheme"), h = read2(item, "host"), port = read2(item, "port"), transport = read2(item, "transport"), configured = read2(item, "configured"), candidate = read2(item, "candidate"), error = read2(item, "error");
          if (!["stun", "stuns", "turn", "turns"].includes(scheme) || !host(h) || port !== null && !integer2(port, 1, 65535) || transport !== null && transport !== "udp" && transport !== "tcp" || typeof configured != "boolean" || typeof candidate != "boolean" || typeof error != "boolean") return { ok: !1 };
          let key = scheme + "|" + h + "|" + port + "|" + transport;
          if (endpoints.has(key)) return { ok: !1 };
          if (endpoints.add(key), chars += h.length + 140, chars > RTC_LIMITS.maxBytes) return { ok: !1 };
          servers.push({ scheme, host: h, port, transport, configured, candidate, error });
        }
        connections.push({ id, created, closed, connected, state, duration, configurationChanges, servers, truncated });
      }
      return { ok: !0, value: { revision, total, omitted, captureLimited, connections } };
    } catch {
      return { ok: !1 };
    }
  }
  function validateRtcControl(v) {
    try {
      return !shape2(v, ["schemaVersion", "type", "enabled", "token", "reset"]) || read2(v, "schemaVersion") !== 1 || read2(v, "type") !== "rtc-control" || typeof read2(v, "enabled") != "boolean" || typeof read2(v, "reset") != "boolean" ? { ok: !1 } : (read2(v, "enabled") ? !token(read2(v, "token")) : read2(v, "token") !== null) ? { ok: !1 } : { ok: !0, value: v };
    } catch {
      return { ok: !1 };
    }
  }
  function validateRtcSensorMessage(v) {
    try {
      if (typeof v != "object" || v === null || read2(v, "channel") !== RTC_DETAILS_CHANNEL || typeof read2(v, "sensorBootId") != "string" || !test2(BOOT2, read2(v, "sensorBootId")) || !integer2(read2(v, "epoch"))) return { ok: !1 };
      if (read2(v, "type") === "rtc-hello" && shape2(v, ["channel", "type", "sensorBootId", "epoch"])) return { ok: !0, value: v };
      if (read2(v, "type") !== "rtc-snapshot" || !shape2(v, ["channel", "type", "sensorBootId", "epoch", "snapshot"])) return { ok: !1 };
      let snapshot = validateRtcSnapshot(read2(v, "snapshot"));
      return snapshot.ok ? { ok: !0, value: { channel: RTC_DETAILS_CHANNEL, type: "rtc-snapshot", sensorBootId: read2(v, "sensorBootId"), epoch: read2(v, "epoch"), snapshot: snapshot.value } } : { ok: !1 };
    } catch {
      return { ok: !1 };
    }
  }

  // packages/contracts/src/protection.ts
  var PROTECTION_FEATURES = [
  "window-management",
  "compute-pressure",
  "idle-detection",
  "local-fonts",
  "canvas-readback",
  "webgl",
  "webgpu",
  "audio",
  "webrtc",
  "webassembly",
  "battery",
  "network-information",
  "keyboard",
  "client-hints",
  "clipboard-read",
  "media-enumeration",
  "media-capture",
  "geolocation",
  "generic-sensors",
  "bluetooth",
  "usb",
  "serial",
  "hid",
  "midi",
  "gamepads",
  "speech-voices",
  "service-worker",
  "push",
  "background-sync",
  "periodic-sync",
  "notifications",
  "storage-estimate",
  "videoframe-readback",
  "screen-extended",
  "webcodecs-capabilities",
  "media-capabilities",
  "encrypted-media",
  "hdcp-policy",
  "autoplay-policy",
  "webrtc-codecs",
  "device-motion",
  "hardware-concurrency",
  "device-memory",
  "performance-memory",
  "cpu-performance",
  "touch-points",
  "webxr",
  "speech-recognition",
  "shape-detection",
  "handwriting-recognition",
  "webnn",
  "builtin-ai-models",
  "translation-ai",
  "screen-wake-lock",
  "picture-in-picture",
  "document-picture-in-picture",
  "fullscreen",
  "pointer-lock",
  "file-system-pickers",
  "protocol-handlers",
  "installed-related-apps",
  "media-session",
  "opfs",
  "cookie-store",
  "document-cookie",
  "storage-buckets",
  "persistent-storage",
  "indexeddb-enumeration",
  "cache-storage",
  "legacy-quota",
  "cast-discovery",
  "send-beacon",
  "fetch-later",
  "websocket",
  "webtransport",
  "platform-authenticator",
  "web-share",
  "credential-management",
  "fedcm-user-info",
  "payment-probes",
  "storage-access",
  "private-state-tokens",
  "background-fetch",
  "shared-worker",
  "dedicated-worker",
  "clipboard-write",
  "permission-probes",
  "reporting-observer",
  "feature-policy",
  "webassembly-compile",
  "webassembly-instantiate",
  "webassembly-compile-streaming",
  "webassembly-instantiate-streaming",
  "webassembly-validate",
  "webassembly-module",
  "webassembly-instance",
  "webassembly-memory",
  "webassembly-memory-grow",
  "webassembly-memory-buffer",
  "webassembly-module-imports",
  "webassembly-module-exports",
  "webassembly-module-custom-sections",
  "webassembly-instance-exports",
  "webassembly-table",
  "webassembly-table-length",
  "webassembly-table-grow",
  "webassembly-table-get",
  "webassembly-table-set",
  "webassembly-global",
  "webassembly-global-value-of",
  "webassembly-global-value",
  "webassembly-global-value-set",
  "webassembly-tag",
  "webassembly-exception",
  "webassembly-exception-is",
  "webassembly-exception-get-arg",
  "webassembly-exception-stack",
  "webassembly-compile-error",
  "webassembly-link-error",
  "webassembly-runtime-error",
  "webassembly-suspending",
  "webassembly-promising",
  "webassembly-suspend-error",
  "webassembly-memory-to-fixed-length-buffer",
  "webassembly-memory-to-resizable-buffer",
  "webassembly-tag-type"
];
  var PROTECTION_CHANNEL = "detect.expert/protection/v1", DEFAULT_PROTECTION_SETTINGS = Object.freeze({
    schemaVersion: 1,
    revision: 0,
    enabled: !1,
    preset: "limited",
    global: Object.freeze([]),
    sites: Object.freeze([])
  }), FEATURE_SET = new Set(PROTECTION_FEATURES), LIMITED = ["window-management", "compute-pressure", "idle-detection", "local-fonts"], STRICT = [
    ...LIMITED,
    "canvas-readback",
    "battery",
    "network-information",
    "keyboard",
    "client-hints"
  ];
  function dataRecord(value, keys3) {
    if (typeof value != "object" || value === null || Array.isArray(value) || Reflect.ownKeys(value).length !== keys3.length) return null;
    let result = /* @__PURE__ */ Object.create(null);
    for (let key of keys3) {
      let descriptor3 = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor3 || !Object.hasOwn(descriptor3, "value")) return null;
      result[key] = descriptor3.value;
    }
    return result;
  }
  function readArray(value, limit, read3) {
    if (!Array.isArray(value)) return null;
    let length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (typeof length != "number" || !Number.isInteger(length) || length < 0 || length > limit) return null;
    let result = [];
    for (let index = 0; index < length; index++) {
      let descriptor3 = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor3 || !Object.hasOwn(descriptor3, "value")) return null;
      let entry = read3(descriptor3.value);
      if (entry === null) return null;
      result.push(entry);
    }
    return result;
  }
  function readProtectionObservations(value) {
    try {
      let seen = /* @__PURE__ */ new Set();
      return readArray(value, PROTECTION_FEATURES.length, (entry) => {
        let row = dataRecord(entry, ["feature", "installed", "unavailable", "removed", "blocked", "stopped"]);
        if (!row) return null;
        let feature = row.feature;
        if (typeof feature != "string" || !FEATURE_SET.has(feature) || seen.has(feature) || typeof row.stopped != "boolean") return null;
        for (let key of ["installed", "unavailable", "removed", "blocked"]) {
          let count = row[key];
          if (typeof count != "number" || !Number.isInteger(count) || count < 0 || count > (key === "blocked" ? 65535 : 16)) return null;
        }
        return row.removed > row.installed ? null : (seen.add(feature), {
          feature,
          installed: row.installed,
          unavailable: row.unavailable,
          removed: row.removed,
          blocked: row.blocked,
          stopped: row.stopped
        });
      });
    } catch {
      return null;
    }
  }

  // packages/contracts/src/rtc-values.ts
  var RTC_VALUE_LIMITS = Object.freeze({ fields: 96, index: 31, bytes: 12e3, sourceChars: 32768, sourceLines: 512 }), RTC_VALUE_PROFILES = ["capabilities", "description", "configuration", "certificate", "stats", "certificate-storage", "media-settings"], RTC_CODEC_MIME_TYPES = [
    "audio/opus",
    "audio/PCMU",
    "audio/PCMA",
    "audio/G722",
    "audio/ISAC",
    "audio/CN",
    "audio/telephone-event",
    "audio/red",
    "video/VP8",
    "video/VP9",
    "video/H264",
    "video/H265",
    "video/AV1",
    "video/rtx",
    "video/red",
    "video/ulpfec",
    "video/flexfec-03"
  ], RTC_HEADER_EXTENSION_URIS = [
    "urn:ietf:params:rtp-hdrext:ssrc-audio-level",
    "urn:ietf:params:rtp-hdrext:csrc-audio-level",
    "urn:ietf:params:rtp-hdrext:sdes:mid",
    "urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id",
    "urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id",
    "urn:ietf:params:rtp-hdrext:toffset",
    "urn:3gpp:video-orientation",
    "http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time",
    "http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
    "http://www.webrtc.org/experiments/rtp-hdrext/playout-delay",
    "http://www.webrtc.org/experiments/rtp-hdrext/video-content-type",
    "http://www.webrtc.org/experiments/rtp-hdrext/video-timing",
    "http://www.webrtc.org/experiments/rtp-hdrext/color-space",
    "http://www.webrtc.org/experiments/rtp-hdrext/abs-capture-time",
    "http://www.webrtc.org/experiments/rtp-hdrext/video-layers-allocation00",
    "https://aomediacodec.github.io/av1-rtp-spec/#dependency-descriptor-rtp-header-extension"
  ], RTC_FMTP_PATTERN = "^(?:(?:apt|level-asymmetry-allowed|packetization-mode|profile-id|level-id|tier-flag|minptime|maxplaybackrate|sprop-maxcapturerate|stereo|sprop-stereo|useinbandfec|usedtx|maxaveragebitrate|max-fr|tx-mode|L|D|repair-window)=[0-9]{1,9}|profile-level-id=[A-Fa-f0-9]{6})(?:;(?:(?:apt|level-asymmetry-allowed|packetization-mode|profile-id|level-id|tier-flag|minptime|maxplaybackrate|sprop-maxcapturerate|stereo|sprop-stereo|useinbandfec|usedtx|maxaveragebitrate|max-fr|tx-mode|L|D|repair-window)=[0-9]{1,9}|profile-level-id=[A-Fa-f0-9]{6})){0,15}$", RTC_VALUE_FIELDS = {
    "codec.mimeType": { type: "enum", values: RTC_CODEC_MIME_TYPES },
    "codec.clockRate": { type: "integer", maximum: 384e3 },
    "codec.channels": { type: "integer", maximum: 32 },
    "codec.payloadType": { type: "integer", maximum: 127 },
    "codec.mediaSection": { type: "integer", maximum: 31 },
    "codec.parameters": { type: "pattern", pattern: RTC_FMTP_PATTERN, maximum: 256 },
    "headerExtension.uri": { type: "enum", values: RTC_HEADER_EXTENSION_URIS },
    "headerExtension.id": { type: "integer", maximum: 255 },
    "headerExtension.mediaSection": { type: "integer", maximum: 31 },
    "description.type": { type: "enum", values: ["offer", "answer", "pranswer", "rollback"] },
    "media.kind": { type: "enum", values: ["audio", "video", "application"] },
    "media.protocol": { type: "enum", values: ["UDP/TLS/RTP/SAVPF", "RTP/SAVPF", "UDP/DTLS/SCTP", "DTLS/SCTP"] },
    "media.payloadTypes": { type: "pattern", pattern: "^(?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-7])(?: (?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-7])){0,31}$", maximum: 127 },
    "media.direction": { type: "enum", values: ["sendrecv", "sendonly", "recvonly", "inactive"] },
    "media.rtcpMux": { type: "boolean" },
    "dtls.setup": { type: "enum", values: ["active", "passive", "actpass", "holdconn"] },
    "certificate.sha-256": { type: "pattern", pattern: "^[A-Fa-f0-9]{2}(?::[A-Fa-f0-9]{2}){31}$", maximum: 95 },
    "certificate.sha-384": { type: "pattern", pattern: "^[A-Fa-f0-9]{2}(?::[A-Fa-f0-9]{2}){47}$", maximum: 143 },
    "certificate.sha-512": { type: "pattern", pattern: "^[A-Fa-f0-9]{2}(?::[A-Fa-f0-9]{2}){63}$", maximum: 191 },
    "certificate.expires": { type: "integer", maximum: 864e13 },
    "configuration.bundlePolicy": { type: "enum", values: ["balanced", "max-compat", "max-bundle"] },
    "configuration.iceTransportPolicy": { type: "enum", values: ["all", "relay"] },
    "configuration.rtcpMuxPolicy": { type: "enum", values: ["require", "negotiate"] },
    "configuration.iceCandidatePoolSize": { type: "integer", maximum: 255 },
    "configuration.certificates": { type: "integer", maximum: 32 },
    "storage.operation": { type: "enum", values: ["put", "add", "result"] },
    "storage.completion": { type: "enum", values: ["request-returned", "value-returned"] },
    "stats.type": { type: "enum", values: ["codec", "inbound-rtp", "outbound-rtp", "certificate", "transport", "peer-connection", "data-channel"] },
    "stats.encoderImplementation": { type: "enum", values: ["libvpx", "OpenH264", "ExternalEncoder", "ExternalEncoder (Unknown)", "VideoToolbox", "MediaCodec"] },
    "stats.decoderImplementation": { type: "enum", values: ["libvpx", "OpenH264", "ExternalDecoder", "ExternalDecoder (Unknown)", "VideoToolbox", "MediaCodec", "FFmpeg", "libaom", "dav1d"] },
    "stats.powerEfficientEncoder": { type: "boolean" },
    "stats.powerEfficientDecoder": { type: "boolean" },
    "stats.dtlsState": { type: "enum", values: ["new", "connecting", "connected", "closed", "failed"] },
    "media.width": { type: "integer", maximum: 65535 },
    "media.height": { type: "integer", maximum: 65535 },
    "media.frameRate": { type: "number", maximum: 1e4 },
    "media.aspectRatio": { type: "number", maximum: 65535 },
    "media.sampleRate": { type: "integer", maximum: 384e3 },
    "media.sampleSize": { type: "integer", maximum: 128 },
    "media.channelCount": { type: "integer", maximum: 32 },
    "media.echoCancellation": { type: "boolean" },
    "media.noiseSuppression": { type: "boolean" },
    "media.autoGainControl": { type: "boolean" }
  }, RTC_VALUE_OPERATIONS = [
    ["RTCPeerConnection.getConfiguration", "configuration"],
    ["RTCPeerConnection.configurationSnapshot", "configuration"],
    ["RTCCertificate.getFingerprints", "certificate"],
    ["RTCRtpSender.getCapabilities", "capabilities"],
    ["RTCRtpReceiver.getCapabilities", "capabilities"],
    ["RTCRtpSender.getParameters", "capabilities"],
    ["RTCRtpReceiver.getParameters", "capabilities"],
    ["RTCSessionDescription.sdp", "description"],
    ["RTCSessionDescription.toJSON", "description"],
    ["RTCStatsReport.get", "stats"],
    ["IDBObjectStore.put", "certificate-storage"],
    ["IDBObjectStore.add", "certificate-storage"],
    ["IDBRequest.result", "certificate-storage"],
    ["MediaStreamTrack.getSettings", "media-settings"]
  ], profiles = new Map(RTC_VALUE_OPERATIONS), mapGet3 = Map.prototype.get;
  function rtcValueProfile(operation) {
    return apply3(mapGet3, profiles, [operation]) ?? null;
  }
  function rtcValueSource(operation) {
    return operation === "RTCPeerConnection.configurationSnapshot" || operation === "IDBObjectStore.put" || operation === "IDBObjectStore.add" || operation === "IDBRequest.result" ? "native-snapshot" : "returned";
  }
  var descriptor2 = Object.getOwnPropertyDescriptor, own = Object.hasOwn, keys2 = Reflect.ownKeys, array = Array.isArray, apply3 = Reflect.apply, includes = Array.prototype.includes, regexpExec = RegExp.prototype.exec, finite = Number.isFinite, integer3 = Number.isSafeInteger, objectIs = Object.is, create = Object.create, define = Object.defineProperty, startsWith = String.prototype.startsWith, patterns = Object.fromEntries(Object.entries(RTC_VALUE_FIELDS).flatMap(([name, spec]) => spec.type === "pattern" ? [[name, new RegExp(spec.pattern)]] : []));
  function field(value, key) {
    let found = descriptor2(value, key);
    return found && found.enumerable && own(found, "value") ? found.value : void 0;
  }
  function exact(value, count) {
    return value !== null && typeof value == "object" && !array(value) && keys2(value).length === count;
  }
  function rtcValueFieldAllowed(profile, name) {
    let prefix = (value) => apply3(startsWith, name, [value]);
    return profile === "certificate" ? prefix("certificate.") : profile === "certificate-storage" ? prefix("certificate.") || prefix("storage.") : profile === "configuration" ? prefix("certificate.") || prefix("configuration.") : profile === "capabilities" ? prefix("codec.") || prefix("headerExtension.") : profile === "stats" ? prefix("stats.") || prefix("codec.") || prefix("certificate.") : profile === "media-settings" ? prefix("media.") && !apply3(includes, ["media.kind", "media.protocol", "media.payloadTypes", "media.direction", "media.rtcpMux"], [name]) : prefix("codec.") || prefix("headerExtension.") || prefix("description.") || prefix("dtls.") || apply3(includes, ["media.kind", "media.protocol", "media.payloadTypes", "media.direction", "media.rtcpMux", "certificate.sha-256", "certificate.sha-384", "certificate.sha-512"], [name]);
  }
  function validRtcFieldValue(name, value) {
    if (!own(RTC_VALUE_FIELDS, name)) return !1;
    let spec = RTC_VALUE_FIELDS[name];
    return spec ? spec.type === "boolean" ? typeof value == "boolean" : spec.type === "enum" ? typeof value == "string" && apply3(includes, spec.values, [value]) : spec.type === "pattern" ? typeof value == "string" && value.length <= spec.maximum && apply3(regexpExec, patterns[name], [value]) !== null : typeof value == "number" && finite(value) && !objectIs(value, -0) && value >= 0 && value <= spec.maximum && (spec.type !== "integer" || integer3(value)) : !1;
  }
  function rtcValueBytes(value) {
    let bytes = 256;
    for (let index = 0; index < value.fields.length; index++) {
      let entry = value.fields[index];
      bytes += 80 + entry.name.length + (typeof entry.value == "string" ? entry.value.length * 6 : 32);
    }
    return bytes;
  }
  function readRtcValue(value) {
    try {
      if (!exact(value, 5) || field(value, "kind") !== "webrtc") return null;
      let profile = field(value, "profile"), source = field(value, "source"), rows = field(value, "fields"), truncated = field(value, "truncated");
      if (typeof profile != "string" || !apply3(includes, RTC_VALUE_PROFILES, [profile]) || source !== "returned" && source !== "native-snapshot" || typeof truncated != "boolean" || !array(rows) || rows.length > RTC_VALUE_LIMITS.fields || keys2(rows).length !== rows.length + 1) return null;
      let fields2 = [], seen = create(null);
      for (let index = 0; index < rows.length; index++) {
        let row = field(rows, "" + index);
        if (!exact(row, 3)) return null;
        let name = field(row, "name"), position = field(row, "index"), content = field(row, "value");
        if (typeof name != "string" || !own(RTC_VALUE_FIELDS, name) || !rtcValueFieldAllowed(profile, name) || typeof position != "number" || !integer3(position) || position < 0 || position > RTC_VALUE_LIMITS.index || !validRtcFieldValue(name, content) || profile === "configuration" && source === "returned" && apply3(startsWith, name, ["certificate."])) return null;
        let key = name + ":" + position;
        if (seen[key]) return null;
        seen[key] = !0, define(fields2, index, { __proto__: null, value: { name, index: position, value: content }, enumerable: !0, configurable: !0, writable: !0 });
      }
      let result = { kind: "webrtc", profile, source, fields: fields2, truncated };
      return rtcValueBytes(result) <= RTC_VALUE_LIMITS.bytes ? result : null;
    } catch {
      return null;
    }
  }

  // packages/contracts/src/api-results.ts
  var API_RESULTS_CHANNEL = "detect.expert/api-results/v1", API_RESULTS_LIMITS = Object.freeze({ rows: 256, stringChars: 256, vectorItems: 16, bytes: 65536, batchRows: 32, queryMs: 200 }), WEBGL_RESULT_PARAMETERS = [
    [7936, "VENDOR"],
    [7937, "RENDERER"],
    [7938, "VERSION"],
    [35724, "SHADING_LANGUAGE_VERSION"],
    [37445, "UNMASKED_VENDOR_WEBGL"],
    [37446, "UNMASKED_RENDERER_WEBGL"],
    [3379, "MAX_TEXTURE_SIZE"],
    [34076, "MAX_CUBE_MAP_TEXTURE_SIZE"],
    [34024, "MAX_RENDERBUFFER_SIZE"],
    [3386, "MAX_VIEWPORT_DIMS"],
    [34921, "MAX_VERTEX_ATTRIBS"],
    [35660, "MAX_VERTEX_TEXTURE_IMAGE_UNITS"],
    [34930, "MAX_TEXTURE_IMAGE_UNITS"],
    [35661, "MAX_COMBINED_TEXTURE_IMAGE_UNITS"],
    [36347, "MAX_VERTEX_UNIFORM_VECTORS"],
    [36349, "MAX_FRAGMENT_UNIFORM_VECTORS"],
    [36348, "MAX_VARYING_VECTORS"],
    [33901, "ALIASED_POINT_SIZE_RANGE"],
    [33902, "ALIASED_LINE_WIDTH_RANGE"],
    [3410, "RED_BITS"],
    [3411, "GREEN_BITS"],
    [3412, "BLUE_BITS"],
    [3413, "ALPHA_BITS"],
    [3414, "DEPTH_BITS"],
    [3415, "STENCIL_BITS"],
    [32936, "SAMPLE_BUFFERS"],
    [32937, "SAMPLES"],
    [34047, "MAX_TEXTURE_MAX_ANISOTROPY_EXT"],
    [34467, "COMPRESSED_TEXTURE_FORMATS"],
    [32883, "MAX_3D_TEXTURE_SIZE"],
    [35071, "MAX_ARRAY_TEXTURE_LAYERS"],
    [36063, "MAX_COLOR_ATTACHMENTS"],
    [34852, "MAX_DRAW_BUFFERS"],
    [36203, "MAX_ELEMENT_INDEX"],
    [33001, "MAX_ELEMENTS_INDICES"],
    [33e3, "MAX_ELEMENTS_VERTICES"],
    [37157, "MAX_FRAGMENT_INPUT_COMPONENTS"],
    [35657, "MAX_FRAGMENT_UNIFORM_COMPONENTS"],
    [37154, "MAX_VERTEX_OUTPUT_COMPONENTS"],
    [35659, "MAX_VARYING_COMPONENTS"],
    [35658, "MAX_VERTEX_UNIFORM_COMPONENTS"],
    [35375, "MAX_UNIFORM_BUFFER_BINDINGS"],
    [35376, "MAX_UNIFORM_BLOCK_SIZE"],
    [35380, "UNIFORM_BUFFER_OFFSET_ALIGNMENT"],
    [33390, "MAX_UNIFORM_LOCATIONS"],
    [35374, "MAX_COMBINED_UNIFORM_BLOCKS"],
    [35371, "MAX_VERTEX_UNIFORM_BLOCKS"],
    [35373, "MAX_FRAGMENT_UNIFORM_BLOCKS"],
    [35377, "MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS"],
    [35379, "MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS"]
  ], WEBGL_RESULT_EXTENSIONS = [
    "WEBGL_debug_renderer_info",
    "WEBGL_debug_shaders",
    "WEBGL_lose_context",
    "WEBGL_draw_buffers",
    "WEBGL_compressed_texture_s3tc",
    "WEBGL_compressed_texture_s3tc_srgb",
    "WEBGL_compressed_texture_etc",
    "WEBGL_compressed_texture_etc1",
    "WEBGL_compressed_texture_astc",
    "WEBGL_compressed_texture_pvrtc",
    "WEBGL_depth_texture",
    "EXT_texture_filter_anisotropic",
    "EXT_disjoint_timer_query",
    "EXT_disjoint_timer_query_webgl2",
    "EXT_color_buffer_float",
    "EXT_color_buffer_half_float",
    "EXT_float_blend",
    "EXT_shader_texture_lod",
    "EXT_frag_depth",
    "EXT_sRGB",
    "OES_texture_float",
    "OES_texture_float_linear",
    "OES_texture_half_float",
    "OES_texture_half_float_linear",
    "OES_standard_derivatives",
    "OES_element_index_uint",
    "OES_vertex_array_object",
    "ANGLE_instanced_arrays"
  ], additional = [
    ["Navigator", "DET-025", ["userAgent", "platform", "vendor", "language", "languages", "appVersion", "appName", "appCodeName", "product", "productSub", "vendorSub"]],
    ["Navigator", "DET-027", ["plugins", "mimeTypes", "pdfViewerEnabled"]],
    ["Navigator", "DET-028", ["webdriver"]],
    ["Window", "DET-030", ["innerWidth", "innerHeight", "devicePixelRatio", "visualViewport"]],
    ["VisualViewport", "DET-030", ["offsetLeft", "offsetTop", "pageLeft", "pageTop", "width", "height", "scale"]],
    ["Navigator", "DET-032", ["hardwareConcurrency"]],
    ["Navigator", "DET-033", ["deviceMemory"]],
    ["Navigator", "DET-034", ["maxTouchPoints"]],
    ["Date", "DET-035", ["getTimezoneOffset"]],
    ["Intl.Collator", "DET-036", ["resolvedOptions"]],
    ["Intl.DateTimeFormat", "DET-036", ["resolvedOptions"]],
    ["Intl.NumberFormat", "DET-036", ["resolvedOptions"]],
    ["Intl.PluralRules", "DET-036", ["resolvedOptions"]],
    ["Intl.RelativeTimeFormat", "DET-036", ["resolvedOptions"]],
    ["Intl.ListFormat", "DET-036", ["resolvedOptions"]],
    ["Intl.Segmenter", "DET-036", ["resolvedOptions"]],
    ["Intl.DisplayNames", "DET-036", ["resolvedOptions"]],
    ["Window", "DET-037", ["matchMedia"]],
    ["CSS", "DET-038", ["supports"]],
    ["Navigator", "DET-040", ["getBattery"]],
    ["BatteryManager", "DET-040", ["charging", "chargingTime", "dischargingTime", "level"]],
    ["Navigator", "DET-041", ["connection"]],
    ["NetworkInformation", "DET-041", ["type", "effectiveType", "rtt", "downlink", "downlinkMax", "saveData"]],
    ["Document", "DET-049", ["cookie"]],
    ["Clipboard", "DET-069", ["read", "readText", "write", "writeText"]],
    ["WebGLShaderPrecisionFormat", "DET-011", ["rangeMin", "rangeMax", "precision"]],
    ["Element", "DET-005", ["getClientRects", "getBoundingClientRect"]],
    ["HTMLElement", "DET-005", ["offsetWidth", "offsetHeight"]],
    ["Range", "DET-006", ["getClientRects", "getBoundingClientRect"]],
    ["SVGGraphicsElement", "DET-007", ["getBBox"]],
    ["SVGTextContentElement", "DET-007", ["getComputedTextLength", "getSubStringLength"]],
    ["FontFaceSet", "DET-008", ["check", "load", "values", "keys", "entries", "forEach", "iterator"]],
    ["Window", "DET-009", ["queryLocalFonts"]],
    ["MediaQueryList", "DET-037", ["matches"]],
    ["Permissions", "DET-039", ["query"]],
    ["PermissionStatus", "DET-039", ["state"]],
    ["Notification", "DET-039", ["permission"]],
    ["Geolocation", "DET-044", ["getCurrentPosition", "watchPosition"]],
    ["Bluetooth", "DET-045", ["getAvailability", "getDevices", "requestDevice"]],
    ["USB", "DET-046", ["getDevices", "requestDevice"]],
    ["HID", "DET-046", ["getDevices", "requestDevice"]],
    ["Serial", "DET-046", ["getPorts", "requestPort"]],
    ["Navigator", "DET-047", ["getGamepads"]],
    ["XRSystem", "DET-048", ["isSessionSupported", "requestSession"]],
    ["CookieStore", "DET-049", ["get", "getAll", "set", "delete"]],
    ["Storage", "DET-050", ["getItem", "setItem", "removeItem", "clear", "key"]],
    ["IDBFactory", "DET-051", ["open", "deleteDatabase", "databases"]],
    ["CacheStorage", "DET-052", ["open", "match", "has", "delete", "keys"]],
    ["Cache", "DET-052", ["match", "matchAll", "add", "addAll", "put", "delete", "keys"]],
    ["StorageManager", "DET-053", ["estimate", "persist", "persisted"]],
    ["Document", "DET-054", ["hasStorageAccess", "requestStorageAccess", "hasUnpartitionedCookieAccess", "requestStorageAccessFor"]],
    ["ServiceWorkerContainer", "DET-063", ["register", "getRegistration", "getRegistrations"]],
    ["PublicKeyCredential", "DET-069", ["isUserVerifyingPlatformAuthenticatorAvailable", "isConditionalMediationAvailable", "getClientCapabilities"]]
  ], SENSITIVE = /* @__PURE__ */ new Set([
    "Document.cookie",
    "Clipboard.read",
    "Clipboard.readText",
    "AudioBuffer.getChannelData",
    "AudioBuffer.copyFromChannel",
    "AnalyserNode.getFloatFrequencyData",
    "AnalyserNode.getByteFrequencyData",
    "AnalyserNode.getFloatTimeDomainData",
    "AnalyserNode.getByteTimeDomainData",
    "PressureRecord.time",
    "ScreenDetailed.label",
    "Storage.getItem",
    "Storage.key",
    "CookieStore.get",
    "CookieStore.getAll",
    "MLContext.readTensor",
    "MLContext.compute",
    "MLTensor.shape",
    "MLOperand.shape"
  ]);
  for (let [operation, techniqueId] of API_OPERATION_DEFINITIONS)
    (techniqueId === "DET-071" && !operation.endsWith(".availability") && !operation.endsWith(".params") && !operation.endsWith(".create") || techniqueId === "DET-072" && operation.endsWith(".detect")) && SENSITIVE.add(operation);
  var definitions2 = /* @__PURE__ */ new Map(), ASYNC = /* @__PURE__ */ new Set([
    "Navigator.getBattery",
    "Clipboard.read",
    "Clipboard.readText",
    "Clipboard.write",
    "Clipboard.writeText",
    "Window.fetch",
    "Window.queryLocalFonts",
    "FontFaceSet.load",
    "Permissions.query",
    "Geolocation.getCurrentPosition",
    "Geolocation.watchPosition",
    "Bluetooth.getAvailability",
    "Bluetooth.getDevices",
    "Bluetooth.requestDevice",
    "USB.getDevices",
    "USB.requestDevice",
    "HID.getDevices",
    "HID.requestDevice",
    "Serial.getPorts",
    "Serial.requestPort",
    "XRSystem.isSessionSupported",
    "XRSystem.requestSession",
    "CookieStore.get",
    "CookieStore.getAll",
    "CookieStore.set",
    "CookieStore.delete",
    "IDBFactory.open",
    "IDBFactory.deleteDatabase",
    "IDBFactory.databases",
    "CacheStorage.open",
    "CacheStorage.match",
    "CacheStorage.has",
    "CacheStorage.delete",
    "CacheStorage.keys",
    "Cache.match",
    "Cache.matchAll",
    "Cache.add",
    "Cache.addAll",
    "Cache.put",
    "Cache.delete",
    "Cache.keys",
    "StorageManager.estimate",
    "StorageManager.persist",
    "StorageManager.persisted",
    "Document.hasStorageAccess",
    "Document.requestStorageAccess",
    "Document.hasUnpartitionedCookieAccess",
    "Document.requestStorageAccessFor",
    "ServiceWorkerContainer.register",
    "ServiceWorkerContainer.getRegistration",
    "ServiceWorkerContainer.getRegistrations",
    "PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable",
    "PublicKeyCredential.isConditionalMediationAvailable",
    "PublicKeyCredential.getClientCapabilities"
  ]);
  for (let [operation, techniqueId, , kind] of API_OPERATION_DEFINITIONS) definitions2.set(operation, {
    operation,
    techniqueId,
    sensitive: SENSITIVE.has(operation),
    asynchronous: kind === "async-call",
    numericVector: !1,
    typeOnly: !1
  });
  for (let [prefix, techniqueId, keys3] of additional) for (let key of keys3) {
    let operation = prefix + "." + key;
    definitions2.set(operation, { operation, techniqueId, sensitive: SENSITIVE.has(operation), asynchronous: ASYNC.has(operation), numericVector: !1, typeOnly: !1 });
  }
  for (let operation of ["Window.fetch", "Navigator.sendBeacon"]) definitions2.set(operation, {
    operation,
    techniqueId: "DET-059",
    sensitive: !1,
    asynchronous: ASYNC.has(operation),
    numericVector: !1,
    typeOnly: !1
  });
  var vectorParameters = /* @__PURE__ */ new Set(["MAX_VIEWPORT_DIMS", "ALIASED_POINT_SIZE_RANGE", "ALIASED_LINE_WIDTH_RANGE", "COMPRESSED_TEXTURE_FORMATS"]), glParameters = new Map(WEBGL_RESULT_PARAMETERS), glExtensions = new Map(WEBGL_RESULT_EXTENSIONS.map((name) => [name.toLowerCase(), name]));
  for (let prefix of ["WebGLRenderingContext", "WebGL2RenderingContext"]) {
    for (let name of ["getParameter", "getExtension", "getSupportedExtensions", "getShaderPrecisionFormat", "readPixels"]) {
      let operation = prefix + "." + name;
      definitions2.set(operation, {
        operation,
        techniqueId: name === "readPixels" ? "DET-012" : "DET-011",
        asynchronous: !1,
        sensitive: name === "readPixels",
        typeOnly: name === "getParameter",
        numericVector: !1
      });
    }
    for (let [, name] of WEBGL_RESULT_PARAMETERS) {
      let operation = prefix + ".getParameter." + name;
      definitions2.set(operation, { operation, techniqueId: "DET-011", asynchronous: !1, sensitive: !1, numericVector: vectorParameters.has(name), typeOnly: !1 });
    }
    for (let name of WEBGL_RESULT_EXTENSIONS) {
      let operation = prefix + ".getExtension." + name;
      definitions2.set(operation, { operation, techniqueId: "DET-011", asynchronous: !1, sensitive: !1, numericVector: !1, typeOnly: !1 });
    }
  }
  for (let permission of [
    "camera",
    "microphone",
    "geolocation",
    "notifications",
    "clipboard-read",
    "clipboard-write",
    "persistent-storage",
    "background-sync",
    "midi",
    "sensors",
    "payment-handler",
    "screen-wake-lock",
    "window-management",
    "local-fonts",
    "display-capture",
    "storage-access",
    "unknown"
  ]) {
    let operation = "PermissionStatus.state." + permission;
    definitions2.set(operation, { operation, techniqueId: "DET-039", asynchronous: !1, sensitive: !1, numericVector: !1, typeOnly: !1 });
  }
  for (let prefix of ["FeaturePolicy", "PermissionsPolicy"]) for (let method of ["allowsFeature", "features", "allowedFeatures", "getAllowlistForFeature"]) {
    let operation = prefix + "." + method;
    definitions2.set(operation, { operation, techniqueId: "DET-039", asynchronous: !1, sensitive: method === "getAllowlistForFeature", numericVector: !1, typeOnly: !1 });
  }
  definitions2.set("RTCPeerConnection.configurationSnapshot", {
    operation: "RTCPeerConnection.configurationSnapshot",
    techniqueId: "DET-056",
    sensitive: !1,
    asynchronous: !1,
    numericVector: !1,
    typeOnly: !0
  });
  for (let definition of definitions2.values()) rtcValueProfile(definition.operation) && (definition.typeOnly = !0);
  for (let member of ["localDescription", "currentLocalDescription", "pendingLocalDescription", "remoteDescription", "currentRemoteDescription", "pendingRemoteDescription"]) {
    let definition = definitions2.get("RTCPeerConnection." + member);
    definition && (definition.typeOnly = !0);
  }
  var API_RESULT_DEFINITIONS = Object.freeze([...definitions2.values()]), apply4 = Reflect.apply, mapGet4 = Map.prototype.get, lowerCase = String.prototype.toLowerCase;
  function apiResultDefinition(operation) {
    return typeof operation != "string" || operation.length > 128 ? null : apply4(mapGet4, definitions2, [operation]) ?? null;
  }
  var own2 = Object.getOwnPropertyDescriptor, keysOf = Reflect.ownKeys, hasOwn2 = Object.hasOwn, isArray2 = Array.isArray, finite2 = Number.isFinite, integer4 = Number.isInteger, is = Object.is, create2 = Object.create, define2 = Object.defineProperty, test3 = RegExp.prototype.test, ID = /^[A-Za-z0-9_-]{1,64}$/;
  function fields(value, names2) {
    if (typeof value != "object" || value === null || isArray2(value) || keysOf(value).length !== names2.length) return null;
    let result = create2(null);
    for (let index = 0; index < names2.length; index++) {
      let name = names2[index], descriptor3 = own2(value, name);
      if (!descriptor3 || !hasOwn2(descriptor3, "value") || descriptor3.enumerable !== !0) return null;
      result[name] = descriptor3.value;
    }
    return result;
  }
  function nonNegative(value, maximum = 2147483647) {
    return typeof value == "number" && integer4(value) && value >= 0 && value <= maximum;
  }
  function readValue(value) {
    if (typeof value != "object" || value === null) return null;
    let kind = own2(value, "kind")?.value;
    if (kind === "webrtc") return readRtcValue(value);
    if (kind === "null" || kind === "undefined") return fields(value, ["kind"]) ? { kind } : null;
    if (kind === "unobserved") {
      let reason = fields(value, ["kind", "reason"])?.reason;
      return reason !== "object" && reason !== "async" && reason !== "exception" && reason !== "sensitive" && reason !== "limit" && reason !== "unsupported" ? null : { kind, reason };
    }
    if (kind === "number-array") {
      let raw = fields(value, ["kind", "values"])?.values;
      if (!isArray2(raw) || raw.length > API_RESULTS_LIMITS.vectorItems || keysOf(raw).length !== raw.length + 1) return null;
      let values = [];
      for (let index = 0; index < raw.length; index++) {
        let descriptor3 = own2(raw, index);
        if (!descriptor3 || !hasOwn2(descriptor3, "value")) return null;
        let element = descriptor3.value;
        if (!(typeof element == "number" && finite2(element) && !is(element, -0)) && element !== "NaN" && element !== "Infinity" && element !== "-Infinity" && element !== "-0") return null;
        define2(values, index, { __proto__: null, value: element, enumerable: !0, configurable: !0, writable: !0 });
      }
      return { kind, values };
    }
    let record = fields(value, ["kind", "value"]);
    if (!record) return null;
    let content = record.value;
    return kind === "number" && typeof content == "number" && finite2(content) && !is(content, -0) ? { kind, value: content } : kind === "boolean" && typeof content == "boolean" ? { kind, value: content } : kind === "string" && typeof content == "string" && content.length <= API_RESULTS_LIMITS.stringChars ? { kind, value: content } : kind === "special-number" && (content === "NaN" || content === "Infinity" || content === "-Infinity" || content === "-0") ? { kind, value: content } : null;
  }
  function apiResultEntryBytes(entry) {
    return entry.operation.length + 192 + (entry.value.kind === "string" ? entry.value.value.length * 6 : entry.value.kind === "number-array" ? entry.value.values.length * 32 : entry.value.kind === "webrtc" ? rtcValueBytes(entry.value) : 0);
  }
  function readApiResultEntries(value, maximum = API_RESULTS_LIMITS.rows) {
    try {
      if (!isArray2(value) || value.length > maximum || keysOf(value).length !== value.length + 1) return null;
      let result = [], seen = create2(null), bytes = 512;
      for (let index = 0; index < value.length; index++) {
        let item = own2(value, index);
        if (!item || !hasOwn2(item, "value")) return null;
        let row = fields(item.value, ["operation", "techniqueId", "phase", "value"]);
        if (!row) return null;
        let definition = apiResultDefinition(row.operation), phase = row.phase;
        if (!definition || row.techniqueId !== definition.techniqueId || phase !== "returned-sync" && phase !== "threw-sync" && phase !== "settlement-unobserved") return null;
        let preview = readValue(row.value);
        if (!preview || phase !== "threw-sync" && definition.asynchronous !== (phase === "settlement-unobserved") || !definition.asynchronous && preview.kind === "unobserved" && preview.reason === "async" || phase === "threw-sync" && (preview.kind !== "unobserved" || preview.reason !== "exception") || phase !== "threw-sync" && preview.kind === "unobserved" && preview.reason === "exception" || phase !== "threw-sync" && definition.sensitive && (preview.kind !== "unobserved" || preview.reason !== "sensitive") || preview.kind === "webrtc" && (phase !== "returned-sync" || preview.profile !== rtcValueProfile(definition.operation) || preview.source !== rtcValueSource(definition.operation)) || phase !== "threw-sync" && definition.typeOnly && preview.kind !== "webrtc" && (preview.kind !== "unobserved" || preview.reason !== "unsupported") || preview.kind === "number-array" && !definition.numericVector || phase === "settlement-unobserved" && !definition.sensitive && (preview.kind !== "unobserved" || preview.reason !== "async")) return null;
        let key = definition.operation + ":" + phase;
        if (seen[key]) return null;
        seen[key] = !0;
        let entry = { operation: definition.operation, techniqueId: definition.techniqueId, phase, value: preview };
        if (bytes += apiResultEntryBytes(entry), bytes > API_RESULTS_LIMITS.bytes) return null;
        define2(result, index, { __proto__: null, value: entry, enumerable: !0, configurable: !0, writable: !0 });
      }
      return result;
    } catch {
      return null;
    }
  }
  function readApiResultsBatch(value) {
    try {
      let record = fields(value, ["channel", "type", "requestId", "epoch", "batchSeq", "final", "enabled", "rows", "truncated"]);
      if (!record || record.channel !== API_RESULTS_CHANNEL || record.type !== "api-results-batch" || typeof record.requestId != "string" || !apply4(test3, ID, [record.requestId]) || !nonNegative(record.epoch) || !nonNegative(record.batchSeq, 63) || typeof record.final != "boolean" || typeof record.enabled != "boolean" || typeof record.truncated != "boolean") return null;
      let rows = readApiResultEntries(record.rows, API_RESULTS_LIMITS.batchRows);
      if (!rows || !record.enabled && rows.length > 0) return null;
      let bytes = 512;
      for (let index = 0; index < rows.length; index++) bytes += apiResultEntryBytes(rows[index]);
      return bytes > 16384 ? null : {
        channel: API_RESULTS_CHANNEL,
        type: "api-results-batch",
        requestId: record.requestId,
        epoch: record.epoch,
        batchSeq: record.batchSeq,
        final: record.final,
        enabled: record.enabled,
        rows,
        truncated: record.truncated
      };
    } catch {
      return null;
    }
  }

  // packages/collector/src/rate-limit.ts
  var RateLimiter = class {
    constructor(limit, windowMs) {
      this.limit = limit;
      this.windowMs = windowMs;
      this.stamps = new Array(limit).fill(0);
    }
    limit;
    windowMs;
    stamps;
    head = 0;
    filled = 0;
    /** Consumes a slot if one is free at `now`. */
    tryAcquire(now) {
      if (this.filled < this.limit)
        return this.stamps[(this.head + this.filled) % this.limit] = now, this.filled++, !0;
      let oldest = this.stamps[this.head] ?? 0;
      return now - oldest < this.windowMs ? !1 : (this.stamps[this.head] = now, this.head = (this.head + 1) % this.limit, !0);
    }
    /** Milliseconds until a slot frees up; 0 when one is available now. */
    waitMs(now) {
      if (this.filled < this.limit) return 0;
      let oldest = this.stamps[this.head] ?? 0, wait = this.windowMs - (now - oldest);
      return wait > 0 ? wait : 0;
    }
  };

  // packages/collector/src/deliver.ts
var { Deliverer, readAck, isFatalTransportError } = (() => {
class Deliverer {
  constructor(env, ring, bridgeSessionId, options, hooks) {
    this.env = env;
    this.ring = ring;
    this.bridgeSessionId = bridgeSessionId;
    this.options = options;
    this.hooks = hooks;
    this.limiter = new RateLimiter(options.maxBatchesPerSecond, 1e3);
    this.backoffMs = options.retransmitBaseMs;
  }
  env;
  ring;
  bridgeSessionId;
  options;
  hooks;
  stats = {
    batchesSent: 0,
    batchesRetransmitted: 0,
    batchesCommitted: 0,
    batchesAbandoned: 0,
    acksInvalid: 0,
    acksNotCommitted: 0,
    acksTimedOut: 0,
    transportFailures: 0
  };
  limiter;
  batchSeq = 0;
  inFlight = null;
  flushTimer = null;
  retryTimer = null;
  ackTimer = null;
  backoffMs;
  paused = false;
  stopped = false;
  suspended = false;
  consecutiveAbandons = 0;
  controlGeneration = 0;
  physicalPending = 0;
  physicalBlocked = false;
  noteControl() {
    this.controlGeneration++;
  }
  get lastBatchSeq() {
    return this.batchSeq;
  }
  get inFlightBatchSeq() {
    return this.inFlight === null ? null : this.inFlight.batch.batchSeq;
  }
  get isPaused() {
    return this.paused;
  }
  get isStopped() {
    return this.stopped;
  }
  get isSuspended() {
    return this.suspended || this.physicalBlocked;
  }
  /** New dirty data in the ring. */
  notifyData() {
    this.schedule();
  }
  schedule() {
    if (this.stopped || this.paused || this.suspended || this.physicalBlocked || this.inFlight !== null) return;
    if (this.flushTimer !== null || this.retryTimer !== null) return;
    if (this.ring.dirty === 0) {
      if (!this.hooks.hasUndeliveredCoverage()) return;
      this.ring.markCoverageDirty();
    }
    const now = this.env.now();
    const base = this.ring.dirty >= this.options.maxBatchEvents ? 0 : this.options.flushMinMs;
    const wait = this.limiter.waitMs(now);
    this.flushTimer = this.env.setTimer(() => {
      this.flushTimer = null;
      this.flush();
    }, base > wait ? base : wait);
  }
  flush() {
    if (this.stopped || this.paused || this.suspended || this.inFlight !== null) return;
    if (this.ring.dirty === 0 && !this.hooks.hasUndeliveredCoverage()) return;
    if (!this.limiter.tryAcquire(this.env.now())) {
      this.schedule();
      return;
    }
    this.startBatch();
  }
  startBatch() {
    const entries = this.ring.takeBatch(this.options.maxBatchEvents);
    const coverageDelta = this.hooks.coverageDelta();
    const first = entries[0];
    if (first === void 0 && coverageDelta.length === 0) return;
    if (this.batchSeq < 2147483647) this.batchSeq++;
    const batch = {
      schemaVersion: 1,
      type: "sensor-events",
      sensorBootId: first === void 0 ? this.hooks.sensorBootId() : first.sensorBootId,
      bridgeSessionId: this.bridgeSessionId,
      batchSeq: this.batchSeq,
      observations: entries.map((e) => e.observation),
      coverageDelta
    };
    this.inFlight = { batch, entries, attempts: 0, attemptId: 0 };
    this.stats.batchesSent++;
    this.transmit();
  }
  transmit() {
    const token = this.inFlight;
    if (token === null) return;
    if (this.physicalPending > 0) {
      this.clearAckTimer();
      if (!this.physicalBlocked) {
        this.physicalBlocked = true;
        this.hooks.onSuspended();
      }
      return;
    }
    this.clearAckTimer();
    token.attemptId++;
    const attemptId = token.attemptId;
    const controlGeneration = this.controlGeneration;
    this.ackTimer = this.env.setTimer(() => {
      this.ackTimer = null;
      this.onAckTimeout(token, attemptId);
    }, this.options.ackTimeoutMs);
    let promise;
    this.physicalPending++;
    try {
      promise = this.env.sendToBackground(token.batch);
    } catch (error) {
      promise = Promise.reject(error);
    }
    const settled = () => {
      if (this.physicalPending === 0 && this.physicalBlocked) {
        this.physicalBlocked = false;
        if (!this.stopped && !this.paused && !this.suspended) {
          if (this.inFlight !== null) {
            if (this.retryTimer === null) this.transmit();
          } else this.schedule();
        }
      }
    };
    promise.then(
      (response) => {
        this.physicalPending--;
        if (this.inFlight === token) this.onResponse(token, attemptId, response, controlGeneration);
        settled();
      },
      (error) => {
        this.physicalPending--;
        if (this.inFlight === token) this.onFailure(token, attemptId, error);
        settled();
      }
    );
  }
  isCurrent(token, attemptId) {
    return this.inFlight === token && token.attemptId === attemptId;
  }
  onAckTimeout(token, attemptId) {
    if (this.stopped || !this.isCurrent(token, attemptId)) return;
    this.stats.acksTimedOut++;
    this.retryLater(token);
  }
  onResponse(token, attemptId, raw, controlGeneration) {
    if (this.stopped || this.inFlight !== token) return;
    const current = token.attemptId === attemptId;
    const ack = readAck(raw);
    if (ack === null) {
      if (!current) return;
      this.clearAckTimer();
      this.stats.acksInvalid++;
      this.retryLater(token);
      return;
    }
    const committed = ack.lastCommittedBatchSeq >= token.batch.batchSeq;
    if (!current && !committed) return;
    this.clearAckTimer();
    this.hooks.onAck(ack, controlGeneration === this.controlGeneration);
    if (this.stopped) return;
    if (committed) {
      this.backoffMs = this.options.retransmitBaseMs;
      this.consecutiveAbandons = 0;
      this.clearRetryTimer();
      this.ring.markAcked(token.entries);
      this.hooks.committed(token.batch.coverageDelta);
      this.stats.batchesCommitted++;
      this.inFlight = null;
      this.schedule();
      return;
    }
    this.stats.acksNotCommitted++;
    this.retryLater(token);
  }
  onFailure(token, attemptId, error) {
    if (this.stopped) return;
    if (isFatalTransportError(error) || !this.env.isContextAlive()) {
      this.stats.transportFailures++;
      this.stop();
      this.hooks.onFatal();
      return;
    }
    if (!this.isCurrent(token, attemptId)) return;
    this.clearAckTimer();
    this.stats.transportFailures++;
    this.retryLater(token);
  }
  retryLater(token) {
    if (this.paused || this.retryTimer !== null) return;
    token.attempts++;
    if (token.attempts > this.options.maxRetransmits) {
      this.stats.batchesAbandoned++;
      this.consecutiveAbandons++;
      this.inFlight = null;
      this.backoffMs = this.options.retransmitBaseMs;
      if (this.consecutiveAbandons >= this.options.maxConsecutiveAbandons) {
        this.suspended = true;
        this.clearTimers();
        this.hooks.onSuspended();
        return;
      }
      this.retryTimer = this.env.setTimer(() => {
        this.retryTimer = null;
        this.schedule();
      }, this.options.retransmitMaxMs);
      return;
    }
    const wait = this.limiter.waitMs(this.env.now());
    const delay = this.backoffMs > wait ? this.backoffMs : wait;
    this.backoffMs = Math.min(this.options.retransmitMaxMs, this.backoffMs * 2);
    this.retryTimer = this.env.setTimer(() => {
      this.retryTimer = null;
      this.retransmit(token);
    }, delay);
  }
  retransmit(token) {
    if (this.stopped || this.paused || this.suspended || this.inFlight !== token) return;
    const now = this.env.now();
    if (!this.limiter.tryAcquire(now)) {
      this.retryTimer = this.env.setTimer(() => {
        this.retryTimer = null;
        this.retransmit(token);
      }, this.limiter.waitMs(now));
      return;
    }
    this.stats.batchesRetransmitted++;
    this.transmit();
  }
  /** pagehide: one best-effort send now (in-flight batch first, else a fresh one). No unload handler. */
  forceFlush() {
    if (this.stopped || this.paused || this.suspended) return;
    this.clearTimers();
    if (this.inFlight !== null) {
      this.stats.batchesRetransmitted++;
      this.transmit();
      return;
    }
    if (this.ring.dirty === 0) {
      if (!this.hooks.hasUndeliveredCoverage()) return;
      this.ring.markCoverageDirty();
    }
    this.startBatch();
  }
  setPaused(paused) {
    if (this.stopped || this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.clearTimers();
      return;
    }
    if (this.suspended) return;
    if (this.inFlight !== null) {
      this.stats.batchesRetransmitted++;
      this.transmit();
      return;
    }
    this.schedule();
  }
  /** Only explicit local resume or trusted browser lifecycle may reset the failure budget. */
  recover() {
    if (this.stopped || this.paused || !this.suspended) return;
    this.suspended = false;
    this.consecutiveAbandons = 0;
    this.backoffMs = this.options.retransmitBaseMs;
    this.schedule();
  }
  /** ADR-073: discard old delivery tokens without awaiting their ACK (the SW may hold the document queue). */
  reset(bridgeSessionId) {
    this.noteControl();
    this.clearTimers();
    this.inFlight = null;
    this.batchSeq = 0;
    this.bridgeSessionId = bridgeSessionId;
    this.suspended = false;
    this.consecutiveAbandons = 0;
    this.backoffMs = this.options.retransmitBaseMs;
    this.physicalBlocked = this.physicalPending > 0;
    if (this.physicalBlocked) this.hooks.onSuspended();
  }
  stop() {
    this.stopped = true;
    this.clearTimers();
    this.inFlight = null;
  }
  clearTimers() {
    if (this.flushTimer !== null) {
      this.env.clearTimer(this.flushTimer);
      this.flushTimer = null;
    }
    this.clearRetryTimer();
    this.clearAckTimer();
  }
  clearRetryTimer() {
    if (this.retryTimer !== null) {
      this.env.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
  }
  clearAckTimer() {
    if (this.ackTimer !== null) {
      this.env.clearTimer(this.ackTimer);
      this.ackTimer = null;
    }
  }
}
function readAck(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw;
  const seq = r["lastCommittedBatchSeq"];
  const paused = r["paused"];
  const protocolOk = r["protocolOk"];
  if (r["schemaVersion"] !== 1 || r["type"] !== "ack") return null;
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0 || seq > 2147483647) return null;
  if (typeof paused !== "boolean" || typeof protocolOk !== "boolean") return null;
  if (r["stopReason"] !== void 0 && r["stopReason"] !== "revoked") return null;
  return {
    schemaVersion: 1,
    type: "ack",
    lastCommittedBatchSeq: seq,
    paused,
    protocolOk,
    ...r["stopReason"] === "revoked" ? { stopReason: "revoked" } : {}
  };
}
function isFatalTransportError(error) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /context invalidated/i.test(message);
}

return { Deliverer, readAck, isFatalTransportError };
})();

  // packages/collector/src/handshake.ts
var { Handshake } = (() => {
class Handshake {
  constructor(env, bridgeSessionId, isPaused, options, onMissing = () => void 0) {
    this.env = env;
    this.bridgeSessionId = bridgeSessionId;
    this.isPaused = isPaused;
    this.options = options;
    this.onMissing = onMissing;
  }
  env;
  bridgeSessionId;
  isPaused;
  options;
  onMissing;
  // Replay state shares the bounded boot lifetime (REQ-011, F032).
  boots = /* @__PURE__ */ new Map();
  timer = null;
  tries = 0;
  stopped = false;
  /** ADR-073: adopt the fresh epoch and rebind only its new boots (re-handshakes under the new session). */
  reset(bridgeSessionId, boots) {
    this.clearTimer();
    this.bridgeSessionId = bridgeSessionId;
    this.boots.clear();
    for (const boot of boots) this.bind(boot);
  }
  /** Swap a boot that answered a reset for its rotated successor, keeping the bounded route set. */
  replace(oldBoot, nextBoot) {
    this.boots.delete(oldBoot);
    this.bind(nextBoot);
  }
  start() {
    this.tries = 1;
    this.sendHello(UNBOUND_SENSOR_BOOT_ID);
    this.scheduleRetry();
  }
  scheduleRetry() {
    if (this.stopped || this.boots.size > 0) return;
    if (this.tries >= this.options.helloRetries) {
      this.onMissing();
      return;
    }
    this.timer = this.env.setTimer(() => {
      this.timer = null;
      if (this.stopped || this.boots.size > 0) return;
      this.tries++;
      this.sendHello(UNBOUND_SENSOR_BOOT_ID);
      this.scheduleRetry();
    }, this.options.helloIntervalMs);
  }
  /** First accepted routes survive churn even before their first data batch (F031; not authentication). */
  bind(sensorBootId) {
    if (this.stopped || this.boots.has(sensorBootId)) return false;
    if (this.boots.size >= this.options.maxKnownBoots) return false;
    this.boots.set(sensorBootId, { lastSeq: 0 });
    this.clearTimer();
    this.sendHello(sensorBootId);
    return true;
  }
  /** Forgets a boot (e.g. after a bridge-stop for protocol mismatch). */
  unbind(sensorBootId) {
    this.boots.delete(sensorBootId);
  }
  isKnown(sensorBootId) {
    return this.boots.has(sensorBootId);
  }
  /** Routing heuristic, never authentication: a page cannot advance the watermark arbitrarily (F004). */
  acceptSequence(sensorBootId, seq) {
    const record = this.boots.get(sensorBootId);
    if (record === void 0 || seq <= record.lastSeq || seq - record.lastSeq > 64) return false;
    record.lastSeq = seq;
    return true;
  }
  get bootIds() {
    return [...this.boots.keys()];
  }
  sendHello(sensorBootId) {
    this.env.postToPage({
      channel: CHANNEL,
      sensorBootId,
      type: "bridge-hello",
      protocolVersion: PROTOCOL_VERSION,
      bridgeSessionId: this.bridgeSessionId,
      paused: this.isPaused()
    });
  }
  sendPause(paused) {
    for (const sensorBootId of this.boots.keys()) {
      this.env.postToPage({ channel: CHANNEL, sensorBootId, type: paused ? "bridge-pause" : "bridge-resume" });
    }
  }
  /** bridge-stop to one boot, or to every known boot when `sensorBootId` is null. */
  sendStop(reason, sensorBootId) {
    const targets = sensorBootId === null ? this.boots.keys() : [sensorBootId];
    for (const id of targets) this.env.postToPage({ channel: CHANNEL, sensorBootId: id, type: "bridge-stop", reason });
  }
  stop() {
    this.stopped = true;
    this.clearTimer();
  }
  clearTimer() {
    if (this.timer !== null) {
      this.env.clearTimer(this.timer);
      this.timer = null;
    }
  }
}

return { Handshake };
})();

  // packages/collector/src/listen.ts
var { ingestWindowMessage } = (() => {
const IGNORE = { kind: "ignore" };
const MALFORMED = { kind: "malformed" };
const SENSOR_TYPES = /* @__PURE__ */ new Set(["sensor-hello", "sensor-batch", "sensor-status", "sensor-reset"]);
const BRIDGE_TYPES = /* @__PURE__ */ new Set(["bridge-hello", "bridge-pause", "bridge-resume", "bridge-stop", "bridge-reset"]);
const MAX_TOP_LEVEL_KEYS = 6;
const MAX_TYPE_CHARS = 32;
function ingestWindowMessage(fromSelf, data) {
  if (!fromSelf) return IGNORE;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return IGNORE;
  try {
    return gate(data);
  } catch {
    return MALFORMED;
  }
}
function gate(data) {
  if (data["channel"] !== CHANNEL) return IGNORE;
  const type = data["type"];
  if (typeof type !== "string" || type.length > MAX_TYPE_CHARS) return MALFORMED;
  if (BRIDGE_TYPES.has(type)) return IGNORE;
  if (!SENSOR_TYPES.has(type)) return MALFORMED;
  if (Object.keys(data).length > MAX_TOP_LEVEL_KEYS) return MALFORMED;
  const bootId = data["sensorBootId"];
  if (typeof bootId !== "string" || bootId.length === 0 || bootId.length > BUDGETS.maxIdChars) return MALFORMED;
  if (type === "sensor-batch" && !observationsLookSane(data["observations"])) return MALFORMED;
  const result = validateSensorMessage(data);
  return result.ok ? { kind: "sensor", message: result.value } : MALFORMED;
}
function observationsLookSane(observations) {
  if (!Array.isArray(observations)) return false;
  if (observations.length < 1 || observations.length > BUDGETS.maxBatchEvents) return false;
  for (const item of observations) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
    if (Object.keys(item).length > 7) return false;
    for (const [key, value] of Object.entries(item)) {
      if (key === "extensionResource") {
        if (readExtensionResource(value) === null) return false;
        continue;
      }
      if (typeof value === "string") {
        if (value.length > BUDGETS.maxStringChars) return false;
      } else if (typeof value === "number") {
        if (!Number.isFinite(value)) return false;
      } else if (Array.isArray(value)) {
        if (value.length > BUDGETS.maxSignalCodesPerObservation) return false;
        for (const s of value) if (typeof s !== "string" || s.length > BUDGETS.maxStringChars) return false;
      } else {
        return false;
      }
    }
  }
  return true;
}

return { ingestWindowMessage };
})();

  // packages/collector/src/ring.ts
  var QUALITY_RANK = { exact: 0, sampled: 1, "lower-bound": 2 };
  function sat(n) {
    return n > 2147483647 ? 2147483647 : n < 0 ? 0 : n;
  }
  var AggregateRing = class {
    constructor(capacity) {
      this.capacity = capacity;
    }
    capacity;
    /** Insertion order = LRU order (touched records are re-inserted at the end). */
    records = /* @__PURE__ */ new Map();
    /** Acknowledged keys in acknowledgement order. */
    cleanKeys = /* @__PURE__ */ new Set();
    dirtyCount = 0;
    get size() {
      return this.records.size;
    }
    /** Records whose latest total has not been acknowledged. */
    get dirty() {
      return this.dirtyCount;
    }
    /**
     * Merges one normalized observation (cumulative per sensor key). `extraSignal` (bfcache-restore) re-keys the
     * record when it fits the signal budget; the re-keyed record reports the growth since the pre-restore total.
     */
    add(sensorBootId, obs, extraSignal) {
      let sensorCodes = [...obs.signalCodes].sort(), sensorKey = sensorBootId + "|" + counterKey(obs.techniqueId, obs.phase, sensorCodes, obs.apiOperation, obs.extensionResource), codes = sensorCodes, key = sensorKey;
      obs.apiOperation === void 0 && obs.extensionResource === void 0 && extraSignal !== null && !sensorCodes.includes(extraSignal) && sensorCodes.length < BUDGETS.maxSignalCodesPerObservation && (codes = [...sensorCodes, extraSignal].sort(), key = sensorBootId + "|" + counterKey(obs.techniqueId, obs.phase, codes));
      let existing = this.records.get(key);
      if (existing !== void 0) {
        let changed = !1;
        if (obs.count > existing.sensorTotal) {
          existing.sensorTotal = obs.count;
          let total = sat(obs.count - existing.baseline);
          total > existing.count && (existing.count = total, changed = !0);
        }
        return QUALITY_RANK[obs.countQuality] > QUALITY_RANK[existing.countQuality] && (existing.countQuality = obs.countQuality, changed = !0), obs.intervalBucket > existing.intervalBucket && (existing.intervalBucket = obs.intervalBucket, changed = !0), changed ? (existing.version++, this.cleanKeys.delete(key) && this.dirtyCount++, this.records.delete(key), this.records.set(key, existing), "updated") : "unchanged";
      }
      let baseline = key === sensorKey ? 0 : this.records.get(sensorKey)?.sensorTotal ?? 0, outcome = "inserted";
      return this.records.size >= this.capacity && (outcome = this.evictOne()), this.records.set(key, {
        identity: {},
        key,
        sensorBootId,
        techniqueId: obs.techniqueId,
        ...obs.apiOperation === void 0 ? {} : { apiOperation: obs.apiOperation },
        ...obs.extensionResource === void 0 ? {} : { extensionResource: { ...obs.extensionResource } },
        phase: obs.phase,
        signalCodes: codes,
        count: sat(obs.count - baseline),
        countQuality: obs.countQuality,
        intervalBucket: obs.intervalBucket,
        sensorTotal: obs.count,
        baseline,
        version: 1,
        ackedVersion: 0
      }), this.dirtyCount++, outcome;
    }
    evictOne() {
      let clean = this.cleanKeys.values().next().value;
      if (clean !== void 0)
        return this.cleanKeys.delete(clean), this.records.delete(clean), "evicted-clean";
      let oldest = this.records.keys().next().value;
      return oldest !== void 0 && (this.records.delete(oldest), this.dirtyCount--), "evicted-dirty";
    }
    /** Up to `max` dirty records of a single sensor boot (the boot of the least recently touched dirty record). */
    takeBatch(max) {
      let out = [], boot = null;
      for (let r of this.records.values())
        if (r.version !== r.ackedVersion) {
          if (boot === null) boot = r.sensorBootId;
          else if (r.sensorBootId !== boot) continue;
          if (out.push({ identity: r.identity, key: r.key, version: r.version, sensorBootId: r.sensorBootId, observation: toObservation(r) }), out.length >= max) break;
        }
      return out;
    }
    /** Marks entries clean unless they were updated after the batch was built. Returns how many became clean. */
    markAcked(entries) {
      let cleaned = 0;
      for (let e of entries) {
        let r = this.records.get(e.key);
        r === void 0 || r.identity !== e.identity || e.version > r.version || (r.ackedVersion < e.version && (r.ackedVersion = e.version), r.version === r.ackedVersion && !this.cleanKeys.has(e.key) && (this.cleanKeys.add(e.key), this.dirtyCount--, cleaned++));
      }
      return cleaned;
    }
    /** Resend one real cumulative snapshot to carry coverage without fabricating an observation (F033). */
    markCoverageDirty() {
      if (this.dirtyCount > 0) return;
      let key = this.cleanKeys.values().next().value;
      if (key === void 0) return;
      let record = this.records.get(key);
      record !== void 0 && (record.version++, this.cleanKeys.delete(key), this.dirtyCount++);
    }
    /** BFCache restore: every record is resent as a snapshot (idempotent at the SW). */
    markAllDirty() {
      for (let key of this.cleanKeys) {
        let r = this.records.get(key);
        r !== void 0 && r.version++;
      }
      this.dirtyCount += this.cleanKeys.size, this.cleanKeys.clear();
    }
  
clear() { this.records.clear(); this.cleanKeys.clear(); this.dirtyCount = 0; }
};
  function toObservation(r) {
    return {
      techniqueId: r.techniqueId,
      ...r.apiOperation === void 0 ? {} : { apiOperation: r.apiOperation },
      ...r.extensionResource === void 0 ? {} : { extensionResource: { ...r.extensionResource } },
      count: r.count,
      countQuality: r.countQuality,
      phase: r.phase,
      signalCodes: [...r.signalCodes],
      intervalBucket: r.intervalBucket
    };
  }

  // packages/collector/src/collector.ts
var { startCollector, DEFAULT_COLLECTOR_OPTIONS } = (() => {
const DEFAULT_COLLECTOR_OPTIONS = Object.freeze({
  helloRetries: 10,
  helloIntervalMs: 100,
  maxKnownBoots: 4,
  flushMinMs: BUDGETS.flushMinMs,
  maxBatchEvents: BUDGETS.maxBatchEvents,
  maxBatchesPerSecond: BUDGETS.maxBatchesPerSecondPerDocument,
  ackTimeoutMs: 1e3,
  retransmitBaseMs: BUDGETS.flushMaxMs,
  retransmitMaxMs: 8e3,
  maxRetransmits: 10,
  maxConsecutiveAbandons: 3,
  maxRecords: BUDGETS.maxBridgeRecordsPerDocument
});
function sat(n) {
  return n >= 2147483647 ? 2147483647 : n + 1;
}
function satAdd(n, delta) {
  const sum = n + delta;
  return sum > 2147483647 ? 2147483647 : sum;
}
function startCollector(env, overrides = {}) {
  const options = { ...DEFAULT_COLLECTOR_OPTIONS, ...overrides };
  let bridgeSessionId = "bridge-" + env.randomHex(12);
  const ring = new AggregateRing(options.maxRecords);
  const pendingCoverage = /* @__PURE__ */ new Set();
  const deliveredCoverage = /* @__PURE__ */ new Set();
  let state = "active";
  let bfcacheRestored = false;
  let resetBoots = null;
  let lastReset = null;
  let resetting = null;
  const stats = {
    batchesSent: 0,
    batchesRetransmitted: 0,
    batchesCommitted: 0,
    batchesAbandoned: 0,
    acksInvalid: 0,
    acksNotCommitted: 0,
    acksTimedOut: 0,
    transportFailures: 0,
    droppedMalformed: 0,
    droppedUnknownBoot: 0,
    droppedReplayed: 0,
    droppedWhilePaused: 0,
    observationsAccepted: 0,
    sensorDropped: 0,
    ringEvictedDirty: 0,
    ringEvictedClean: 0,
    protocolMismatches: 0,
    bfcacheRestores: 0
  };
  const handshake = new Handshake(env, bridgeSessionId, () => state === "paused", options, () => {
    addFlags(["hook-failed"]);
    deliverer.notifyData();
  });
  const deliverer = new Deliverer(env, ring, bridgeSessionId, options, {
    coverageDelta: () => [...pendingCoverage],
    committed: (flags) => {
      for (const f of flags) {
        pendingCoverage.delete(f);
        deliveredCoverage.add(f);
      }
    },
    hasUndeliveredCoverage: () => {
      for (const f of pendingCoverage) if (!deliveredCoverage.has(f)) return true;
      return false;
    },
    sensorBootId: () => handshake.bootIds.at(-1) ?? UNBOUND_SENSOR_BOOT_ID,
    onAck: (ack, currentControl) => {
      if (ack.stopReason === "revoked") {
        stop("revoked");
        return;
      }
      if (!ack.protocolOk) {
        stats.protocolMismatches = sat(stats.protocolMismatches);
        stop("protocol-mismatch");
        return;
      }
      if (currentControl) setPaused(ack.paused);
    },
    onFatal: () => stop("revoked"),
    onSuspended: () => addFlags(["channel-gap", "budget-exceeded"])
  });
  function setPaused(paused) {
    if (state === "stopped" || state === "paused" === paused) return;
    state = paused ? "paused" : "active";
    if (paused) pendingCoverage.add("paused");
    deliverer.setPaused(paused);
    handshake.sendPause(paused);
  }
  function stop(reason) {
    if (state === "stopped") return;
    state = "stopped";
    if (resetting !== null) {
      env.clearTimer(resetting.timer);
      resetting.reject(new Error("reset-stopped"));
      resetting = null;
    }
    deliverer.stop();
    handshake.sendStop(reason, null);
    handshake.stop();
  }
  function addFlags(flags) {
    for (const f of flags) pendingCoverage.add(f);
  }
  function addSensorFlags(flags) {
    let accepted = 0;
    for (const flag of flags) {
      if (flag === "hook-failed" || flag === "unsupported-realm" || flag === "descriptor-nonconfigurable" || flag === "worker-not-observed" || flag === "budget-exceeded" || flag === "throttled" || flag === "channel-gap") {
        pendingCoverage.add(flag);
        accepted++;
      }
    }
    return accepted;
  }
  function rejected(counter) {
    stats[counter] = sat(stats[counter]);
    pendingCoverage.add("throttled");
    deliverer.notifyData();
  }
  function onHello(message) {
    if (resetting !== null) return;
    if (resetBoots !== null && !resetBoots.has(message.sensorBootId)) {
      rejected("droppedUnknownBoot");
      return;
    }
    if (handshake.isKnown(message.sensorBootId)) {
      if (message.protocolVersion !== PROTOCOL_VERSION) {
        pendingCoverage.add("channel-gap");
        rejected("droppedMalformed");
      }
      return;
    }
    if (message.protocolVersion !== PROTOCOL_VERSION) {
      stats.protocolMismatches = sat(stats.protocolMismatches);
      pendingCoverage.add("channel-gap");
      rejected("droppedMalformed");
      handshake.sendStop("protocol-mismatch", message.sensorBootId);
      deliverer.notifyData();
      return;
    }
    if (!handshake.bind(message.sensorBootId)) {
      pendingCoverage.add("channel-gap");
      rejected("droppedUnknownBoot");
      return;
    }
    addSensorFlags(message.coverageFlags);
    if (message.startedLate) pendingCoverage.add("late-start");
    deliverer.notifyData();
  }
  function onBatch(message) {
    if (resetting !== null) return;
    const boot = message.sensorBootId;
    if (resetBoots !== null && !resetBoots.has(boot)) {
      rejected("droppedUnknownBoot");
      return;
    }
    if (!handshake.isKnown(boot)) {
      rejected("droppedUnknownBoot");
      return;
    }
    if (state === "paused") {
      stats.droppedWhilePaused = sat(stats.droppedWhilePaused);
      return;
    }
    if (!handshake.acceptSequence(boot, message.sensorSeq)) {
      pendingCoverage.add("channel-gap");
      rejected("droppedReplayed");
      return;
    }
    const extra = bfcacheRestored ? "bfcache-restore" : null;
    for (const obs of message.observations) {
      const outcome = ring.add(boot, obs, extra);
      if (outcome === "evicted-dirty" || outcome === "evicted-clean") {
        if (outcome === "evicted-dirty") stats.ringEvictedDirty = sat(stats.ringEvictedDirty);
        else stats.ringEvictedClean = sat(stats.ringEvictedClean);
        pendingCoverage.add("bridge-ring-overflow");
        pendingCoverage.add("channel-gap");
      }
    }
    stats.observationsAccepted = satAdd(stats.observationsAccepted, message.observations.length);
    addSensorFlags(message.coverageDelta);
    deliverer.notifyData();
  }
  function onStatus(message) {
    if (resetting !== null) return;
    if (resetBoots !== null && !resetBoots.has(message.sensorBootId)) {
      rejected("droppedUnknownBoot");
      return;
    }
    if (!handshake.isKnown(message.sensorBootId)) {
      rejected("droppedUnknownBoot");
      return;
    }
    const sensorDiagnostics = addSensorFlags(message.coverageFlags);
    if (message.state === "stopped" || message.state === "paused" && state !== "paused" || message.state === "degraded" && sensorDiagnostics === 0) pendingCoverage.add("channel-gap");
    if (message.droppedSinceLast > 0) {
      stats.sensorDropped = satAdd(stats.sensorDropped, message.droppedSinceLast);
      pendingCoverage.add("truncated");
    }
    if (pendingCoverage.size > 0) deliverer.notifyData();
  }
  function reset(resetId) {
    if (lastReset?.resetId === resetId) return Promise.resolve(lastReset);
    if (resetting !== null) return resetting.resetId === resetId ? resetting.promise : Promise.reject(new Error("reset-busy"));
    const targets = new Set(handshake.bootIds);
    if (targets.size === 0) return Promise.reject(new Error("reset-no-sensor"));
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const pending = { resetId, targets, replies: /* @__PURE__ */ new Map(), promise, resolve, reject, timer: null };
    resetting = pending;
    deliverer.noteControl();
    deliverer.setPaused(true);
    pending.timer = env.setTimer(() => {
      if (resetting !== pending) return;
      resetting = null;
      for (const [oldBoot, reply] of pending.replies) handshake.replace(oldBoot, reply.nextSensorBootId);
      resetBoots = new Set(handshake.bootIds);
      addFlags(["channel-gap"]);
      deliverer.setPaused(state === "paused");
      deliverer.notifyData();
      reject(new Error("reset-timeout"));
    }, 2e3);
    for (const sensorBootId of targets) env.postToPage({ channel: CHANNEL, type: "bridge-reset", sensorBootId, resetId });
    return promise;
  }
  function onReset(message) {
    const pending = resetting;
    if (pending === null || pending.resetId !== message.resetId || !pending.targets.has(message.sensorBootId) || pending.replies.has(message.sensorBootId)) return;
    if ([...pending.replies.values()].some((reply2) => reply2.nextSensorBootId === message.nextSensorBootId) || pending.targets.has(message.nextSensorBootId)) return;
    pending.replies.set(message.sensorBootId, message);
    if (pending.replies.size !== pending.targets.size) return;
    env.clearTimer(pending.timer);
    const sensorBootIds = [...pending.replies.values()].map((reply2) => reply2.nextSensorBootId);
    bridgeSessionId = "bridge-" + env.randomHex(12);
    const reply = { schemaVersion: 1, type: "bridge-reset-ack", resetId: pending.resetId, bridgeSessionId, sensorBootIds };
    resetting = null;
    resetBoots = new Set(sensorBootIds);
    ring.clear();
    pendingCoverage.clear();
    deliveredCoverage.clear();
    bfcacheRestored = false;
    deliverer.reset(bridgeSessionId);
    handshake.reset(bridgeSessionId, sensorBootIds);
    for (const result of pending.replies.values()) addSensorFlags(result.coverageFlags);
    deliverer.setPaused(state === "paused");
    deliverer.notifyData();
    lastReset = reply;
    pending.resolve(reply);
  }
  env.onWindowMessage((fromSelf, data) => {
    if (state === "stopped") return;
    try {
      if (fromSelf && data && typeof data === "object" && data.channel === CHANNEL && data.type === "bridge-hello") {
        const control = validateBridgeMessage(data);
        if (control.ok && control.value.type === "bridge-hello" && control.value.protocolVersion !== PROTOCOL_VERSION) {
          addFlags(["channel-gap"]);
          rejected("droppedMalformed");
        }
      }
    } catch {
    }
    const result = ingestWindowMessage(fromSelf, data);
    if (result.kind === "ignore") return;
    if (result.kind === "malformed") {
      rejected("droppedMalformed");
      return;
    }
    const message = result.message;
    try {
      if (message.type === "sensor-hello") onHello(message);
      else if (message.type === "sensor-batch") onBatch(message);
      else if (message.type === "sensor-status") onStatus(message);
      else onReset(message);
    } catch {
      rejected("droppedMalformed");
    }
  });
  env.onPageShow((persisted) => {
    if (!persisted || state === "stopped") return;
    bfcacheRestored = true;
    stats.bfcacheRestores = sat(stats.bfcacheRestores);
    for (const f of deliveredCoverage) pendingCoverage.add(f);
    deliveredCoverage.clear();
    ring.markAllDirty();
    deliverer.recover();
    deliverer.notifyData();
  });
  env.onPageHide(() => {
    deliverer.forceFlush();
  });
  env.onControlMessage((fromExtension, data) => {
    if (!fromExtension || state === "stopped") return;
    const result = validateBridgeControl(data);
    if (!result.ok) return;
    if (result.value.command === "reset") return reset(result.value.resetId);
    deliverer.noteControl();
    if (result.value.command === "pause") {
      setPaused(true);
      return;
    }
    setPaused(false);
    deliverer.recover();
  });
  handshake.start();
  return {
    stop,
    pause: () => setPaused(true),
    resume: () => {
      setPaused(false);
      deliverer.recover();
    },
    snapshot: () => ({
      state,
      bridgeSessionId,
      sensorBootIds: handshake.bootIds,
      lastBatchSeq: deliverer.lastBatchSeq,
      inFlightBatchSeq: deliverer.inFlightBatchSeq,
      transportSuspended: deliverer.isSuspended,
      ringSize: ring.size,
      ringDirty: ring.dirty,
      pendingCoverage: [...pendingCoverage],
      stats: { ...stats, ...deliverer.stats }
    })
  };
}

return { startCollector, DEFAULT_COLLECTOR_OPTIONS };
})();

  // packages/collector/src/env.ts
  var CONTEXT_INVALIDATED = "Extension context invalidated";
  function isOwnServiceWorker(sender) {
    try {
      let id = chrome.runtime.id;
      if (typeof id != "string" || sender.id !== id || sender.tab !== void 0) return !1;
      let own3 = "chrome-extension://" + id;
      return sender.origin === own3 || typeof sender.url == "string" && sender.url.startsWith(own3 + "/");
    } catch {
      return !1;
    }
  }
  function contextAlive() {
    try {
      return typeof chrome < "u" && chrome.runtime !== void 0 && typeof chrome.runtime.id == "string";
    } catch {
      return !1;
    }
  }
  function createBrowserCollectorEnv() {
  const win = window;
  return {
    onWindowMessage(listener) {
      win.addEventListener("message", (event) => {
        listener(event.source === win, event.data);
      });
    },
    onPageShow(listener) {
      win.addEventListener("pageshow", (event) => {
        if (event.isTrusted) listener(event.persisted);
      });
    },
    onPageHide(listener) {
      win.addEventListener("pagehide", (event) => {
        if (event.isTrusted) listener(event.persisted);
      });
    },
    onControlMessage(listener) {
      try {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
          const result = listener(isOwnServiceWorker(sender), message);
          if (result instanceof Promise) {
            result.then(sendResponse, () => sendResponse(null));
            return true;
          }
          return false;
        });
      } catch {
      }
    },
    postToPage(message) {
      try {
        win.postMessage(message, "*");
      } catch {
      }
    },
    sendToBackground(batch) {
      if (!contextAlive()) return Promise.reject(new Error(CONTEXT_INVALIDATED));
      try {
        return chrome.runtime.sendMessage(batch);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(CONTEXT_INVALIDATED));
      }
    },
    isContextAlive: contextAlive,
    now: () => Date.now(),
    setTimer: (fn, ms) => win.setTimeout(fn, ms),
    clearTimer: (handle) => {
      if (typeof handle === "number") win.clearTimeout(handle);
    },
    randomHex(bytes) {
      const buf = new Uint8Array(bytes);
      crypto.getRandomValues(buf);
      let out = "";
      for (const b of buf) out += (b < 16 ? "0" : "") + b.toString(16);
      return out;
    }
  };
}

  // packages/collector/src/visual.ts
  function startVisualBridge(env) {
    let expiresAt = 0, configVersion = 0, pending = /* @__PURE__ */ new Set(), pendingImages = /* @__PURE__ */ new Map(), queued = /* @__PURE__ */ new Map(), receivedFrames = 0, receivedChars = 0, truncated = !1, limitPending = !1, limitSent = !1, terminal = !1, boots = /* @__PURE__ */ new Map(), retained = /* @__PURE__ */ new Map(), cacheToken = null, cacheExpiresAt = 0, cacheTimer = null, cacheVersion = 0, sendSequence = 0, ownerSequence = 0, clearCache = () => {
      cacheVersion++, queued.clear(), retained.clear(), cacheToken = null, cacheExpiresAt = 0, truncated = !1, limitPending = !1, cacheTimer !== null && (env.clearTimer(cacheTimer), cacheTimer = null);
    }, touchCache = (remainingMs = VISUAL_CACHE_IDLE_MS) => {
      cacheTimer !== null && env.clearTimer(cacheTimer), cacheExpiresAt = env.now() + remainingMs, cacheTimer = env.setTimer(clearCache, remainingMs);
    }, field2 = (value, key) => typeof value == "object" && value !== null ? Object.getOwnPropertyDescriptor(value, key)?.value : void 0, sendConfig = (boot) => {
      let remainingMs = Math.min(VISUAL_LIMITS.leaseMs, Math.max(0, Math.floor(expiresAt - env.now())));
      env.postToPage({ channel: VISUAL_CHANNEL, type: "visual-config", sensorBootId: boot, enabled: remainingMs > 0 && !terminal, remainingMs });
    }, applyConfig = (raw) => {
      let parsed = validateBridgeVisualControl(raw);
      if (!(!parsed.ok || terminal)) {
        configVersion++, expiresAt = parsed.value.enabled ? env.now() + parsed.value.remainingMs : 0, (!parsed.value.enabled || parsed.value.remainingMs === 0) && clearCache();
        for (let boot of boots.keys()) sendConfig(boot);
      }
    }, disable = () => {
      configVersion++, expiresAt = 0, queued.clear();
      for (let boot of boots.keys()) sendConfig(boot);
    }, ready = () => {
      if (terminal || !env.isContextAlive()) return;
      let version = configVersion;
      env.sendToBackground({ schemaVersion: 1, type: "visual-ready" }).then((response) => {
        version === configVersion && applyConfig(response);
      }, () => {
        version === configVersion && disable();
      });
    }, markLimited = () => {
      truncated = !0, limitSent || (limitPending = !0);
    }, drain = () => {
      if (!(terminal || !env.isContextAlive() || expiresAt === 0))
        for (env.now() >= expiresAt && queued.size > 0 && (queued.clear(), markLimited()); pending.size < 2 && (queued.size > 0 || limitPending); ) {
          let entry = queued.entries().next().value, key = entry?.[0] ?? "limited", image = entry?.[1];
          if (pending.has(key)) return;
          entry ? (queued.delete(key), pendingImages.set(key, entry[1])) : (limitPending = !1, limitSent = !0), pending.add(key);
          let version = configVersion, retentionVersion = cacheVersion, sequence = ++sendSequence, request = image ? { schemaVersion: 1, type: "visual-frame", image } : { schemaVersion: 1, type: "visual-limited" };
          env.sendToBackground(request).then((response) => {
            if (version !== configVersion || retentionVersion !== cacheVersion || terminal || !env.isContextAlive()) return;
            let ack = validateVisualFrameAck(response);
            if (!ack.ok) {
              applyConfig(response);
              return;
            }
            if (!ack.value.accepted || ack.value.cacheToken === null) {
              clearCache(), disable();
              return;
            }
            if (cacheToken !== ack.value.cacheToken) {
              if (sequence < ownerSequence) return;
              retained.clear(), cacheToken = ack.value.cacheToken, ownerSequence = sequence;
            }
            ack.value.truncated && (truncated = !0), image && ack.value.retained !== !1 && !retainVisualImage(retained, image) && markLimited(), touchCache(ack.value.remainingMs);
          }, () => {
            version === configVersion && (markLimited(), disable());
          }).finally(() => {
            pending.delete(key), pendingImages.delete(key), drain();
          });
        }
    };
    env.onWindowMessage((fromSelf, raw) => {
      try {
        if (!fromSelf || terminal || !env.isContextAlive() || field2(raw, "channel") !== VISUAL_CHANNEL) return;
        let type = field2(raw, "type");
        if (type !== "visual-hello") {
          let boot = field2(raw, "sensorBootId");
          if (expiresAt === 0 || typeof boot != "string" || !boots.has(boot)) return;
          if (env.now() >= expiresAt && type === "visual-image") {
            markLimited(), drain();
            return;
          }
          if (receivedFrames >= VISUAL_LIMITS.maxFrames) {
            markLimited(), drain();
            return;
          }
          receivedFrames++;
        }
        let parsed = validateVisualSensorMessage(raw);
        if (!parsed.ok) return;
        let message = parsed.value;
        if (message.type === "visual-hello") {
          let last = boots.get(message.sensorBootId);
          if (last !== void 0 && env.now() - last < 250 || last === void 0 && boots.size >= 4) return;
          boots.set(message.sensorBootId, env.now()), sendConfig(message.sensorBootId);
          return;
        }
        if (!boots.has(message.sensorBootId)) return;
        if (message.type === "visual-limited") {
          markLimited(), drain();
          return;
        }
        if (message.image.canvas && !message.image.canvas.id.startsWith(message.sensorBootId + ":")) return;
        let key = visualImageKey(message.image), previous = queued.get(key) ?? pendingImages.get(key) ?? retained.get(key), merged = mergeVisualImage(previous, message.image);
        if (merged === previous) return;
        if (receivedChars += message.image.data.length, receivedChars > VISUAL_LIMITS.maxTotalBase64Chars * 2) {
          markLimited(), drain();
          return;
        }
        let owned = new Map([...retained, ...pendingImages, ...queued]);
        owned.set(key, merged);
        let memory = 0;
        for (let image of owned.values()) memory += image.data.length;
        let identities = /* @__PURE__ */ new Set([...retained.keys(), ...queued.keys(), ...pendingImages.keys(), key]);
        if (memory > VISUAL_LIMITS.maxTotalBase64Chars || identities.size > VISUAL_LIMITS.maxImages) {
          markLimited(), drain();
          return;
        }
        queued.set(key, merged), drain();
      } catch {
      }
    }), env.onControlMessage((fromExtension, raw) => {
      if (fromExtension) {
        if (field2(raw, "type") === "bridge-control" && (field2(raw, "command") === "pause" || field2(raw, "command") === "stop")) {
          clearCache(), disable(), field2(raw, "command") === "stop" && (terminal = !0);
          return;
        }
        applyConfig(raw);
      }
    }), env.onCacheRequest((fromExtension, raw) => {
      if (!fromExtension || terminal || !env.isContextAlive()) return null;
      let request = validateVisualCacheRequest(raw);
      return !request.ok || (cacheToken !== null && env.now() >= cacheExpiresAt && clearCache(), cacheToken !== request.value.cacheToken) || (touchCache(), request.value.type === "visual-cache-touch") ? null : {
        schemaVersion: 1,
        type: "visual-cache-state",
        cacheToken,
        images: [...retained.values()].map((image) => ({ ...image })),
        ...truncated ? { truncated: !0 } : {}
      };
    }), env.onPageHide(() => {
      clearCache(), disable();
    }), env.onPageShow((persisted) => {
      persisted && ready();
    }), ready();
  }
  function startBrowserVisualBridge() {
    let env = createBrowserCollectorEnv();
    startVisualBridge({
      ...env,
      onCacheRequest(listener) {
        try {
          chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            let response = listener(isOwnServiceWorker(sender), message);
            return response !== null && sendResponse(response), !1;
          });
        } catch {
        }
      },
      postToPage(message) {
        try {
          window.postMessage(message, "*");
        } catch {
        }
      },
      sendToBackground(message) {
        try {
          return chrome.runtime.sendMessage(message);
        } catch (error) {
          return Promise.reject(error);
        }
      }
    });
  }

  // packages/collector/src/rtc.ts
  var RESPONSE_DEADLINE_MS = 2e3, MAX_UNSETTLED_REQUESTS = 4;
  function startRtcBridge(env) {
    let boot = null, rtcSeen = !1, token2 = null, pending = null, generation = 0, ready = !1, sending = !1, timer = null, stopped = !1, paused = !1, attempts = 0, lastInput = -1 / 0, lastSent = -1 / 0, lastHandshake = -1 / 0, unsettledRequests = 0, capacityBlocked = !1, post = (type) => {
      boot && env.postToPage({ channel: RTC_DETAILS_CHANNEL, type, sensorBootId: boot, epoch: generation });
    }, schedule = (ms = RTC_LIMITS.flushMs) => {
      rtcSeen && !stopped && !paused && timer === null && (timer = env.setTimer(() => {
        timer = null, drain();
      }, ms));
    }, hasCapacity = () => unsettledRequests < MAX_UNSETTLED_REQUESTS ? !0 : (capacityBlocked = !0, !1), request = (message) => (unsettledRequests++, new Promise((resolve, reject) => {
      let waiting = !0, completed = !1, deadline = env.setTimer(() => {
        waiting = !1, reject(new Error("RTC response deadline exceeded"));
      }, RESPONSE_DEADLINE_MS), complete = (ok, value) => {
        if (completed) return;
        completed = !0, unsettledRequests--;
        let late = !waiting;
        waiting && (waiting = !1, env.clearTimer(deadline), ok ? resolve(value) : reject(value)), (capacityBlocked || late && attempts >= 4) && (capacityBlocked = !1, attempts = 0, schedule());
      };
      try {
        env.sendToBackground(message).then((value) => complete(!0, value), (error) => complete(!1, error));
      } catch (error) {
        complete(!1, error);
      }
    })), reset = () => {
      generation++, pending = null, token2 = null, ready = !1, sending = !1, attempts = 0, lastHandshake = -1 / 0, timer !== null && env.clearTimer(timer), timer = null, post("rtc-reset");
    }, handshake = async () => {
      if (!rtcSeen || ready || stopped || paused || attempts >= 4 || !boot || !env.isContextAlive() || !hasCapacity()) return;
      let delay = RTC_LIMITS.flushMs - (env.now() - lastHandshake);
      if (delay > 0) {
        schedule(delay);
        return;
      }
      ready = !0, lastHandshake = env.now();
      let version = generation;
      try {
        let raw = await request({ schemaVersion: 1, type: "rtc-ready" });
        if (version !== generation || stopped) return;
        let response = validateRtcControl(raw);
        if (!response.ok) throw new Error("invalid rtc control");
        if (!response.value.enabled) {
          reset(), paused = !0;
          return;
        }
        if (response.value.reset) {
          reset(), schedule();
          return;
        }
        token2 = response.value.enabled ? response.value.token : null, token2 && (attempts = 0, post("rtc-request"), pending && schedule());
      } catch {
        version === generation && attempts++ < 3 && schedule();
      } finally {
        version === generation && (ready = !1);
      }
    }, drain = async () => {
      if (stopped || paused || sending || !env.isContextAlive()) return;
      if (token2 === null) {
        await handshake();
        return;
      }
      if (!pending || !hasCapacity()) return;
      let elapsed = env.now() - lastSent;
      if (elapsed < RTC_LIMITS.flushMs) {
        schedule(RTC_LIMITS.flushMs - elapsed);
        return;
      }
      sending = !0, lastSent = env.now();
      let snapshot = pending, version = generation;
      try {
        let raw = await request({ schemaVersion: 1, type: "rtc-snapshot", token: token2, snapshot });
        if (version !== generation || stopped) return;
        if (!raw || typeof raw != "object") throw new Error("missing rtc acknowledgement");
        let response = raw;
        if (response.schemaVersion !== 1 || response.type !== "rtc-ack" || typeof response.accepted != "boolean" || typeof response.reset != "boolean") throw new Error("invalid rtc acknowledgement");
        if (response.reset) {
          reset(), schedule();
          return;
        }
        if (!response.accepted) throw new Error("rtc snapshot not committed");
        pending === snapshot && (pending = null), attempts = 0;
      } catch {
        version === generation && attempts++ < 3 && schedule(250 * attempts);
      } finally {
        version === generation && (sending = !1, pending !== snapshot && pending && schedule());
      }
    };
    env.onWindowMessage((fromSelf, data) => {
      if (!fromSelf || stopped || !env.isContextAlive() || typeof data != "object" || data === null) return;
      let type = Object.getOwnPropertyDescriptor(data, "type")?.value, channel = Object.getOwnPropertyDescriptor(data, "channel")?.value;
      if (channel === CHANNEL) {
        if (boot !== null || type !== "sensor-hello") return;
        let ordinary = validateSensorMessage(data);
        if (!ordinary.ok || ordinary.value.type !== "sensor-hello" || ordinary.value.protocolVersion !== PROTOCOL_VERSION) return;
        boot = ordinary.value.sensorBootId, generation > 0 && post("rtc-reset");
        return;
      }
      if (paused || channel !== RTC_DETAILS_CHANNEL || type === "rtc-snapshot" && env.now() - lastInput < 100) return;
      type === "rtc-snapshot" && (lastInput = env.now());
      let message = validateRtcSensorMessage(data);
      if (!(!message.ok || boot !== null && boot !== message.value.sensorBootId)) {
        if (boot === null && message.value.type === "rtc-hello" && message.value.epoch !== generation) {
          boot = message.value.sensorBootId, rtcSeen = !0, post("rtc-reset"), schedule();
          return;
        }
        message.value.epoch === generation && (boot = message.value.sensorBootId, rtcSeen = !0, message.value.type === "rtc-snapshot" && ((!pending || message.value.snapshot.revision >= pending.revision) && (pending = message.value.snapshot), attempts = 0), token2 ? pending && schedule() : handshake());
      }
    }), env.onControlMessage((fromExtension, data) => {
      if (!fromExtension || !data || typeof data != "object") return;
      let value = data;
      if (value.schemaVersion === 1 && (value.type === "rtc-reset" && (reset(), stopped || schedule()), value.type === "bridge-control")) {
        let command = value.command;
        command === "pause" || command === "stop" ? (reset(), paused = !0, stopped = command === "stop") : command === "resume" && !stopped && (paused = !1, schedule());
      }
    }), env.onPageHide(() => {
      pending && token2 && !sending && (lastSent = -1 / 0, drain());
    });
  }
  function startBrowserRtcBridge() {
    let env = createBrowserCollectorEnv();
    startRtcBridge({
      ...env,
      postToPage(message) {
        try {
          window.postMessage(message, "*");
        } catch {
        }
      },
      sendToBackground(message) {
        try {
          return chrome.runtime.sendMessage(message);
        } catch (error) {
          return Promise.reject(error);
        }
      }
    });
  }

  // packages/collector/src/protection.ts
  function startProtectionBridge(env) {
    let pending = null, rows = /* @__PURE__ */ new Map(), admitted = 0, field2 = (value, key) => {
      if (typeof value != "object" || value === null) return;
      let descriptor3 = Object.getOwnPropertyDescriptor(value, key);
      return descriptor3 && Object.hasOwn(descriptor3, "value") ? descriptor3.value : void 0;
    }, stop = () => {
      env.post({ channel: PROTECTION_CHANNEL, type: "protection-stop" });
    };
    // ADR-046: one reply per installed rule plus bounded page noise.
    env.onRestore(stop), env.onPage((sameWindow, data) => {
      if (!sameWindow || pending === null || admitted >= 2 * PROTECTION_FEATURES.length || field2(data, "channel") !== PROTECTION_CHANNEL || field2(data, "type") !== "protection-observation") return;
      admitted++;
      let row = readProtectionObservations([field2(data, "observation")])?.[0];
      row && rows.set(row.feature, row);
    }), env.onCommand((trusted, data, respond) => {
      if (!trusted || field2(data, "schemaVersion") !== 1) return !1;
      let type = field2(data, "type");
      return type === "protection-stop" ? (stop(), respond([]), !1) : type !== "protection-query" ? !1 : pending !== null ? (pending.length < 4 ? pending.push(respond) : respond([]), !0) : (rows.clear(), admitted = 0, pending = [respond], env.post({ channel: PROTECTION_CHANNEL, type: "protection-query" }), env.later(() => {
        let waiting = pending;
        if (pending = null, waiting) for (let reply of waiting) reply([...rows.values()]);
        rows.clear();
      }, 50), !0);
    });
  }
  function startBrowserProtectionBridge() {
    startProtectionBridge({
      onPage: (listener) => window.addEventListener("message", (event) => listener(event.source === window, event.data)),
      onCommand: (listener) => chrome.runtime.onMessage.addListener((message, sender, respond) => listener(isOwnServiceWorker(sender), message, respond)),
      onRestore: (listener) => window.addEventListener("pageshow", (event) => {
        event.persisted && listener();
      }),
      post: (message) => window.postMessage(message, "*"),
      later: (callback, delay) => {
        setTimeout(callback, delay);
      }
    });
  }

  // ADR-017: Pro values
var PRO_TECHNICAL_OPERATIONS = {"Navigator.languages":["languages","DET-025"],"Navigator.plugins":["plugins","DET-027"],"Navigator.mimeTypes":["mime-types","DET-027"],"NavigatorUAData.brands":["ua-data","DET-026"],"NavigatorUAData.toJSON":["ua-data","DET-026"],"Window.matchMedia":["media-query","DET-037"],"Element.getBoundingClientRect":["geometry","DET-005"],"Element.getClientRects":["geometry","DET-005"],"Range.getBoundingClientRect":["geometry","DET-006"],"Range.getClientRects":["geometry","DET-006"],"SVGGraphicsElement.getBBox":["geometry","DET-007"],"CanvasRenderingContext2D.measureText":["text-metrics","DET-003"],"OffscreenCanvasRenderingContext2D.measureText":["text-metrics","DET-003"],"WebGLRenderingContext.getSupportedExtensions":["webgl-extensions","DET-011"],"WebGL2RenderingContext.getSupportedExtensions":["webgl-extensions","DET-011"],"Intl.Collator.resolvedOptions":["intl","DET-036"],"Intl.DateTimeFormat.resolvedOptions":["intl","DET-036"],"Intl.NumberFormat.resolvedOptions":["intl","DET-036"],"Intl.PluralRules.resolvedOptions":["intl","DET-036"],"Intl.RelativeTimeFormat.resolvedOptions":["intl","DET-036"],"Intl.ListFormat.resolvedOptions":["intl","DET-036"],"Intl.Segmenter.resolvedOptions":["intl","DET-036"],"Intl.DisplayNames.resolvedOptions":["intl","DET-036"]};
var PRO_TECHNICAL_FIELDS = {"languages":{"language":"string"},"plugins":{"name":"string","description":"string","filename":"string","length":"number"},"mime-types":{"type":"string","description":"string","suffixes":"string"},"ua-data":{"brand":"string","version":"string","mobile":"boolean","platform":"string"},"media-query":{"media":"string","matches":"boolean"},"geometry":{"x":"number","y":"number","width":"number","height":"number","top":"number","right":"number","bottom":"number","left":"number"},"text-metrics":{"width":"number","actualBoundingBoxLeft":"number","actualBoundingBoxRight":"number","fontBoundingBoxAscent":"number","fontBoundingBoxDescent":"number","actualBoundingBoxAscent":"number","actualBoundingBoxDescent":"number","emHeightAscent":"number","emHeightDescent":"number","hangingBaseline":"number","alphabeticBaseline":"number","ideographicBaseline":"number"},"webgl-extensions":{"extension":"string"},"intl":{"locale":"string","usage":"string","sensitivity":"string","collation":"string","caseFirst":"string","calendar":"string","numberingSystem":"string","timeZone":"string","hourCycle":"string","weekday":"string","era":"string","year":"string","month":"string","day":"string","dayPeriod":"string","hour":"string","minute":"string","second":"string","timeZoneName":"string","dateStyle":"string","timeStyle":"string","style":"string","currency":"string","currencyDisplay":"string","currencySign":"string","unit":"string","unitDisplay":"string","notation":"string","compactDisplay":"string","signDisplay":"string","roundingMode":"string","roundingPriority":"string","trailingZeroDisplay":"string","type":"string","pluralCategory":"string","numeric":"string|boolean","granularity":"string","fallback":"string","languageDisplay":"string","fractionalSecondDigits":"number","minimumIntegerDigits":"number","minimumFractionDigits":"number","maximumFractionDigits":"number","minimumSignificantDigits":"number","maximumSignificantDigits":"number","roundingIncrement":"number","ignorePunctuation":"boolean","hour12":"boolean","useGrouping":"string|boolean"}};
var proTechnicalContractNative = (function captureTechnicalContractIntrinsics() {
  const apply = Reflect.apply, includes = Array.prototype.includes, define = Object.defineProperty, exec = RegExp.prototype.exec, own = Object.getOwnPropertyDescriptor, has = Object.hasOwn;
  return { own, keys: Reflect.ownKeys, has, array: Array.isArray, integer: Number.isSafeInteger, finite: Number.isFinite, is: Object.is,
    data: (object, name) => { const d = own(object, name); return d && has(d, 'value') ? d.value : undefined; },
    includes: (a, v) => apply(includes, a, [v]), push: (a, v) => define(a, a.length, { __proto__: null, value: v, writable: true, configurable: true, enumerable: true }), test: (re, v) => apply(exec, re, [v]) !== null };
})();
function readProTechnicalValue(value, operation) {
  const n = proTechnicalContractNative;
  try {
    const expected = n.has(PRO_TECHNICAL_OPERATIONS, operation) ? PRO_TECHNICAL_OPERATIONS[operation] : null;
    if (!expected || !value || typeof value !== 'object' || n.keys(value).length !== 4) return null;
    const kind = n.data(value, 'kind'), profile = n.data(value, 'profile'), fields = n.data(value, 'fields'), truncated = n.data(value, 'truncated');
    if (kind !== 'technical' || profile !== expected[0] || typeof truncated !== 'boolean' || !n.array(fields) || fields.length > 128 || n.keys(fields).length !== fields.length + 1) return null;
    const allowed = PRO_TECHNICAL_FIELDS[profile], output = [], identities = [];
    let bytes = 256;
    for (let i = 0; i < fields.length; i++) {
      const field = n.data(fields, i);
      if (!field || typeof field !== 'object' || n.keys(field).length !== 4) return null;
      const name = n.data(field, 'name'), index = n.data(field, 'index'), type = n.data(field, 'kind'), item = n.data(field, 'value');
      if (typeof name !== 'string' || !n.has(allowed, name) || !n.integer(index) || index < 0 || index > 127 || typeof type !== 'string') return null;
      const expectedType = allowed[name], identity = name + ':' + index;
      if (n.includes(identities, identity)) return null;
      if (type === 'special-number') {
        if (expectedType !== 'number' || !n.includes(['NaN', 'Infinity', '-Infinity', '-0'], item)) return null;
      } else {
        if (type !== expectedType && !(expectedType === 'string|boolean' && (type === 'string' || type === 'boolean'))) return null;
        if (typeof item !== type) return null;
        if (type === 'string' && (item.length > 256 || n.test(/[\u0000-\u001f\u007f]/, item))) return null;
        if (type === 'number' && (!n.finite(item) || n.is(item, -0))) return null;
      }
      bytes += 64 + name.length * 2 + (typeof item === 'string' ? item.length * 2 : 16);
      if (bytes > 8192) return null;
      n.push(identities, identity); n.push(output, { name, index, kind: type, value: item });
    }
    return { kind: 'technical', profile, fields: output, truncated };
  } catch { return null; }
}
function readProTechnicalRow(row) {
  const n = proTechnicalContractNative;
  try {
    if (!row || typeof row !== 'object' || n.keys(row).length !== 4) return null;
    const operation = n.data(row, 'operation'), techniqueId = n.data(row, 'techniqueId'), phase = n.data(row, 'phase');
    if (typeof operation !== 'string' || !n.has(PRO_TECHNICAL_OPERATIONS, operation) || PRO_TECHNICAL_OPERATIONS[operation][1] !== techniqueId || phase !== 'returned-sync') return null;
    const value = readProTechnicalValue(n.data(row, 'value'), operation);
    return value ? [{ operation, techniqueId, phase, value }] : null;
  } catch { return null; }
}

var proValueIntrinsics = (function captureProIntrinsics() {
  const apply = Reflect.apply, define = Object.defineProperty, includes = Array.prototype.includes, test = RegExp.prototype.exec;
  const hasOwn = Object.hasOwn;
  const MapCtor = Map, SetCtor = Set, get = Map.prototype.get, set = Map.prototype.set, clear = Map.prototype.clear;
  const setHas = Set.prototype.has, add = Set.prototype.add, size = Object.getOwnPropertyDescriptor(Set.prototype, 'size').get;
  return { MapCtor, SetCtor, mapGet: (map, key) => apply(get, map, [key]), mapSet: (map, key, value) => apply(set, map, [key, value]), mapClear: map => apply(clear, map, []), setHas: (set, key) => apply(setHas, set, [key]), setAdd: (set, key) => apply(add, set, [key]), setSize: set => apply(size, set, []), descriptor: Object.getOwnPropertyDescriptor, keys: Reflect.ownKeys, finite: Number.isFinite, abs: Math.abs, is: Object.is, hasOwn, push: (array, value) => define(array, array.length, { __proto__: null, value, writable: true, configurable: true, enumerable: true }), includes: (array, value) => apply(includes, array, [value]), test: (pattern, value) => apply(test, pattern, [value]) !== null };
})();
function proValueFallback(operation, techniqueId, phase, value) {
  const surfaces = { 'HTMLCanvasElement.toDataURL': 'DET-001', 'HTMLCanvasElement.toBlob': 'DET-001', 'CanvasRenderingContext2D.getImageData': 'DET-002', 'CanvasRenderingContext2D.measureText': 'DET-003', 'OffscreenCanvasRenderingContext2D.measureText': 'DET-003', 'OffscreenCanvasRenderingContext2D.getImageData': 'DET-004', 'OffscreenCanvas.convertToBlob': 'DET-004' };
  if (typeof operation !== 'string' || !proValueIntrinsics.hasOwn(surfaces, operation) || surfaces[operation] !== techniqueId || !proValueIntrinsics.includes(['attempted', 'returned-sync', 'threw-sync', 'settlement-unobserved'], phase)) return null;
  if (!value || typeof value !== 'object' || proValueIntrinsics.keys(value).length !== 2 || proValueIntrinsics.descriptor(value, 'kind')?.value !== 'unobserved' || proValueIntrinsics.descriptor(value, 'reason')?.value !== 'sensitive') return null;
  return [{ operation, techniqueId, phase, value: { kind: 'unobserved', reason: 'sensitive' } }];
}

function proValueParameters(operation, args) {
  const result = [];
  if (!args) return result;
  let numeric = 0, allowed = null;
  if (proValueIntrinsics.test(/^(?:CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D)\.getImageData$/, operation)) numeric = 4;
  else if (proValueIntrinsics.test(/^(?:WebGLRenderingContext|WebGL2RenderingContext)\.getParameter\./, operation)) numeric = 1;
  else if (operation === 'WebAssembly.Memory.grow') numeric = 1;
  else if (proValueIntrinsics.test(/^(?:HTMLCanvasElement|OffscreenCanvas)\.getContext$/, operation)) allowed = ['2d', 'webgl', 'webgl2', 'experimental-webgl', 'webgpu', 'bitmaprenderer'];
  else if (proValueIntrinsics.test(/^(?:RTCRtpSender|RTCRtpReceiver)\.getCapabilities$/, operation)) allowed = ['audio', 'video'];
  for (let index = 0; index < numeric && index < args.length; index++) {
    const value = args[index];
    if (typeof value === 'number' && proValueIntrinsics.finite(value) && proValueIntrinsics.abs(value) <= 2147483647) proValueIntrinsics.push(result, { name: 'arg' + index, kind: 'number', value: proValueIntrinsics.is(value, -0) ? 0 : value });
  }
  if (allowed && typeof args[0] === 'string' && proValueIntrinsics.includes(allowed, args[0])) proValueIntrinsics.push(result, { name: 'arg0', kind: 'string', value: args[0] });
  // Only primitive technical queries. Never measureText text, font sample text,
  // request bodies, arbitrary option objects, or any argument coercion.
  let queries = 0;
  if (operation === 'CSS.supports') queries = 2;
  else if (operation === 'Window.matchMedia' || operation === 'FontFaceSet.check' || operation === 'FontFaceSet.load' || operation === 'HTMLMediaElement.canPlayType' || operation === 'MediaSource.isTypeSupported' || operation === 'MediaRecorder.isTypeSupported' || operation === 'ImageDecoder.isTypeSupported') queries = 1;
  for (let index = 0; index < queries && index < args.length; index++) {
    const query = args[index];
    if (typeof query === 'string' && query.length <= 256 && !proValueIntrinsics.test(/[\u0000-\u001f\u007f]|(?:url\s*\(|(?:https?|data|blob|file):)/i, query)) proValueIntrinsics.push(result, { name: 'arg' + index, kind: 'string', value: query });
  }
  return result;
}

function proValueKey(row) {
  const value = row.value;
  // Length prefixes distinguish delimiters inside already validated technical strings.
  const part = item => { const text = typeof item + ':' + item; return text.length + ':' + text; };
  let key = part(row.operation) + part(row.phase) + part(value.kind);
  if (value.kind === 'unobserved') key += part(value.reason);
  else if (value.kind === 'number-array') for (let index = 0; index < value.values.length; index++) key += part(value.values[index]);
  else if (value.kind === 'webrtc') {
    key += part(value.profile) + part(value.source) + part(value.truncated);
    for (let index = 0; index < value.fields.length; index++) { const field = value.fields[index]; key += part(field.name) + part(field.index) + part(field.value); }
  } else if (value.kind === 'technical') {
    key += part(value.profile) + part(value.truncated);
    for (let index = 0; index < value.fields.length; index++) { const field = value.fields[index]; key += part(field.name) + part(field.index) + part(field.kind) + part(field.value); }
  } else if (proValueIntrinsics.hasOwn(value, 'value')) key += part(value.value);
  for (let index = 0; index < row.parameters.length; index++) { const parameter = row.parameters[index]; key += part(parameter.name) + part(parameter.kind) + part(parameter.value); }
  return key;
}

function createProParameterBudget() {
  const native = proValueIntrinsics, states = new native.MapCtor();
  return {
    admit(row) {
      if (!row.parameters.length) return true;
      let key = '';
      for (let i = 0; i < row.parameters.length; i++) {
        const p = row.parameters[i], part = p.name + ':' + p.kind + ':' + p.value;
        key += part.length + ':' + part;
      }
      let known = native.mapGet(states, row.operation);
      if (known && native.setHas(known, key)) return true;
      if (known && native.setSize(known) >= 32) return false;
      if (!known) { known = new native.SetCtor(); native.mapSet(states, row.operation, known); }
      native.setAdd(known, key);
      return true;
    },
    reset() { native.mapClear(states); }
  };
}

function proValueRows(value, validate) {
  try {
    const own = Object.getOwnPropertyDescriptor;
    if (!Array.isArray(value) || value.length > 256 || Reflect.ownKeys(value).length !== value.length + 1) return null;
    const rows = [], seen = new Set();
    let bytes = 512;
    for (let index = 0; index < value.length; index++) {
      const item = own(value, index)?.value;
      const names = ['operation', 'techniqueId', 'phase', 'value', 'parameters', 'count'];
      if (!item || typeof item !== 'object' || Reflect.ownKeys(item).length !== names.length || names.some(name => !Object.hasOwn(own(item, name) ?? {}, 'value'))) return null;
      const inputRow = { operation: own(item, 'operation').value, techniqueId: own(item, 'techniqueId').value, phase: own(item, 'phase').value, value: own(item, 'value').value };
      const base = readProTechnicalRow(inputRow) ?? validate([inputRow]) ?? proValueFallback(inputRow.operation, inputRow.techniqueId, inputRow.phase, inputRow.value);
      if (!base || base.length !== 1) return null;
      const count = own(item, 'count').value, input = own(item, 'parameters').value;
      if (!Number.isSafeInteger(count) || count < 1 || count > 2147483647 || !Array.isArray(input) || input.length > 4 || Reflect.ownKeys(input).length !== input.length + 1) return null;
      const parameters = [];
      for (let position = 0; position < input.length; position++) {
        const parameter = own(input, position)?.value;
        if (!parameter || typeof parameter !== 'object' || Reflect.ownKeys(parameter).length !== 3 || ['name', 'kind', 'value'].some(name => !Object.hasOwn(own(parameter, name) ?? {}, 'value'))) return null;
        parameters.push({ name: own(parameter, 'name').value, kind: own(parameter, 'kind').value, value: own(parameter, 'value').value });
      }
      // Reconstruct a primitive argument vector and apply the same allowlist as MAIN.
      const args = [];
      for (const parameter of parameters) {
        if (typeof parameter.name !== 'string' || !/^arg[0-3]$/.test(parameter.name) || (parameter.kind !== 'number' && parameter.kind !== 'string') || typeof parameter.value !== parameter.kind) return null;
        const index = Number(parameter.name.slice(3));
        if (Object.hasOwn(args, index)) return null;
        args[index] = parameter.value;
      }
      const canonical = proValueParameters(base[0].operation, args);
      if (canonical.length !== parameters.length || canonical.some((parameter, index) => parameter.name !== parameters[index].name || parameter.kind !== parameters[index].kind || !Object.is(parameter.value, parameters[index].value))) return null;
      const row = { ...base[0], parameters, count }, key = proValueKey(row);
      if (seen.has(key)) return null;
      seen.add(key);
      bytes += 256 + key.length * 2;
      if (bytes > 65536) return null;
      rows.push(row);
    }
    return rows;
  } catch {
    return null;
  }
}

function proValueDocuments(value, validate) {
  try {
    if (!Array.isArray(value) || value.length > 24 || Reflect.ownKeys(value).length !== value.length + 1) return null;
    const result = [], seen = new Set();
    for (let index = 0; index < value.length; index++) {
      const item = Object.getOwnPropertyDescriptor(value, index)?.value;
      if (!item || typeof item !== 'object' || Reflect.ownKeys(item).length !== 3) return null;
      const documentKey = Object.getOwnPropertyDescriptor(item, 'documentKey')?.value;
      const truncated = Object.getOwnPropertyDescriptor(item, 'truncated')?.value;
      const rows = proValueRows(Object.getOwnPropertyDescriptor(item, 'rows')?.value, validate);
      if (typeof documentKey !== 'string' || !/^[A-Za-z0-9_:.-]{1,160}$/.test(documentKey) || typeof truncated !== 'boolean' || !rows || seen.has(documentKey)) return null;
      seen.add(documentKey);
      result.push({ documentKey, rows, truncated });
    }
    return result;
  } catch {
    return null;
  }
}

  function startProValuesBridge() {
    let pending = null, sequence = 0, retiredFull = false;
    const retired = new Set();
    const finish = (available) => {
      if (!pending) return;
      let current = pending; pending = null; clearTimeout(current.timer);
      current.respond({ schemaVersion: 1, type: "pro-values-cache", sessionId: current.sessionId, available, rows: available ? current.rows : [], truncated: current.truncated || !available, loaderRows: available ? current.loaderRows ?? [] : [], loaderTruncated: current.loaderTruncated || !available });
    };
    window.addEventListener("message", event => {
      let data = event.data;
      if (event.source !== window || !pending || !data || typeof data !== "object" || data.channel !== "detect.expert/pro-values/v1" || data.type !== "pro-values-batch" || pending.admitted++ >= 64) return;
      if (data.requestId !== pending.requestId || data.sessionId !== pending.sessionId || data.batchSeq !== pending.batch || typeof data.final !== "boolean" || typeof data.enabled !== "boolean" || typeof data.truncated !== "boolean") return;
      let rows = proValueRows(data.rows, readApiResultEntries);
      if (!rows || rows.length > 32 || pending.rows.length + rows.length > 256) { pending.truncated = !0; return; }
      let loaderRows = [], loaderTruncated = false;
      if (Object.hasOwn(data, "loaderRows") || Object.hasOwn(data, "loaderTruncated")) {
        loaderRows = readLoaderRows(data.loaderRows);
        if (!data.final || !loaderRows || typeof data.loaderTruncated !== "boolean") { pending.truncated = !0; return; }
        loaderTruncated = data.loaderTruncated;
      }
      let bytes = rows.reduce((sum, row) => sum + 256 + proValueKey(row).length * 2, 512) + loaderRows.length * 256;
      if (bytes > 16384 || pending.bytes + bytes > 65536) { pending.truncated = !0; return; }
      pending.bytes += bytes; pending.batch++; pending.truncated ||= data.truncated;
      pending.rows.push(...rows);
      if (data.final) { pending.loaderRows = loaderRows; pending.loaderTruncated = loaderTruncated; }
      if (data.final) finish(data.enabled && proValueRows(pending.rows, readApiResultEntries) !== null);
    });
    chrome.runtime.onMessage.addListener((data, sender, respond) => {
      if (!isOwnServiceWorker(sender) || !data || typeof data !== "object" || Reflect.ownKeys(data).length !== 3 || data.schemaVersion !== 1 || typeof data.sessionId !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(data.sessionId)) return !1;
      if (!["pro-values-start", "pro-values-read", "pro-values-stop"].includes(data.type)) return !1;
      if (data.type === "pro-values-stop") {
        // A trusted delayed start for a retired token must not reinstall Pro hooks.
        // Never evict tombstones: after 128 tokens this document rejects new recording.
        if (!retired.has(data.sessionId)) { if (retired.size < 128) retired.add(data.sessionId); else retiredFull = true; }
        if (pending?.sessionId === data.sessionId) finish(!1);
        window.postMessage({ channel: "detect.expert/pro-values/v1", ...data, requestId: "pro-" + (sequence = Math.min(2147483647, sequence + 1)) }, "*");
        respond({ schemaVersion: 1, type: "pro-values-stopped" }); return !1;
      }
      if (pending || retiredFull || retired.has(data.sessionId) || sequence >= 2147483647) { respond({ schemaVersion: 1, type: "pro-values-cache", sessionId: data.sessionId, available: !1, rows: [], truncated: !0 }); return !1; }
      let requestId = "pro-" + ++sequence;
      pending = { sessionId: data.sessionId, requestId, respond, rows: [], batch: 0, admitted: 0, bytes: 512, truncated: !1, timer: setTimeout(() => finish(!1), 300) };
      window.postMessage({ channel: "detect.expert/pro-values/v1", type: data.type, sessionId: data.sessionId, requestId }, "*");
      return !0;
    });
    window.addEventListener("pagehide", () => finish(!1));
  }

  // packages/collector/src/social-network.ts
  var startSocialValuesBridge = (function startSocialValuesBridge(env, readRows) {
  const descriptor = Object.getOwnPropertyDescriptor, ownKeys = Reflect.ownKeys, hasOwn = Object.hasOwn;
  const field = (value, key) => value && typeof value === 'object' ? descriptor(value, key)?.value : undefined;
  const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && ownKeys(value).length === names.length && names.every(name => hasOwn(descriptor(value, name) ?? {}, 'value'));
  let pending = null, sequence = 0, nextReadAt = -Infinity;
  const empty = () => ({ schemaVersion: 1, type: 'social-values-cache', available: false, rows: [], truncated: true });
  const finish = (available, rows = [], truncated = true) => {
    if (!pending) return;
    const current = pending; pending = null; env.cancel(current.timer);
    nextReadAt = env.now() + 500;
    current.respond(available ? { schemaVersion: 1, type: 'social-values-cache', available: true, rows, truncated } : empty());
  };
  env.onPage((sameWindow, data) => {
    if (!sameWindow || !pending || !pending.posted || pending.admitted++ >= 8 || !exact(data, ['channel', 'type', 'requestId', 'enabled', 'rows', 'truncated']) || field(data, 'channel') !== 'detect.expert/social/v1' || field(data, 'type') !== 'social-values-batch' || field(data, 'requestId') !== pending.requestId || typeof field(data, 'enabled') !== 'boolean' || typeof field(data, 'truncated') !== 'boolean') return;
    const rows = readRows(field(data, 'rows'));
    if (!rows || rows.some(row => row.evidenceSource !== 'page-hook' || row.integrity !== 'page-controlled') || JSON.stringify(rows).length > 12000) return;
    finish(field(data, 'enabled'), rows, field(data, 'truncated'));
  });
  env.onCommand((trusted, data, respond) => {
    if (!trusted || !exact(data, ['schemaVersion', 'type']) || field(data, 'schemaVersion') !== 1 || field(data, 'type') !== 'social-values-query') return false;
    if (pending || sequence >= 2147483647) { respond(empty()); return false; }
    const requestId = 'social-' + ++sequence;
    const current = { requestId, respond, admitted: 0, timer: null, posted: false };
    pending = current;
    const post = () => {
      if (pending !== current) return;
      current.posted = true;
      current.timer = env.later(() => finish(false), 400);
      env.post({ channel: 'detect.expert/social/v1', type: 'social-values-read', requestId });
    };
    const delay = Math.max(0, nextReadAt - env.now());
    if (delay) current.timer = env.later(post, delay);
    else post();
    return true;
  });
  env.onHide(() => finish(false));
});
  function startBrowserSocialValuesBridge() {
    startSocialValuesBridge({
      onPage: listener => window.addEventListener("message", event => listener(event.source === window, event.data)),
      onCommand: listener => chrome.runtime.onMessage.addListener((message, sender, respond) => listener(isOwnServiceWorker(sender), message, respond)),
      onHide: listener => window.addEventListener("pagehide", listener),
      post: message => window.postMessage(message, "*"),
      later: (callback, delay) => setTimeout(callback, delay), cancel: timer => clearTimeout(timer), now: () => performance.now(),
    }, readSocialRows);
  }

  // ADR-029 third-party timing bridge start
  var thirdPartyTimingContracts = (() => {
// ADR-029 / REQ-004/005/011: privileged current-visit resource inventory.
const THIRD_PARTY_RESOURCE_TYPES = Object.freeze(['sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other']);
const own = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
const array = (value, max) => Array.isArray(value) && value.length <= max && Reflect.ownKeys(value).length === value.length + 1 && Array.from({ length: value.length }, (_, index) => Object.hasOwn(Object.getOwnPropertyDescriptor(value, index) ?? {}, 'value')).every(Boolean);
const document = value => typeof value === 'string' && /^[0-9]+:[0-9]+:[A-Za-z0-9_-]{1,64}$/.test(value) && value.length <= 160;
const host = value => typeof value === 'string' && value.length <= 253 && value.includes('.') && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
const paths = new Set('account accounts api app assets auth authentication blog browser browserleaks canvas cart catalog categories checkout client contact css dashboard data docs download fingerprint fonts forgot-password home images img index js javascript login logout main media news oauth password password-recovery pixelscan privacy product products profile recover recovery register registration reset reset-password resources script scripts search service services settings signup static status styles terms test tests user users v1 v2 v3 vendor vendors webgl webgpu webrtc'.split(' '));
const extensions = new Set(['js', 'mjs', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'woff', 'woff2', 'ttf', 'wasm', 'json', 'html', 'htm', 'php', 'aspx', 'map']);
function thirdPartyPathTemplate(path) {
  if (typeof path !== 'string' || path.length > 16384) return null;
  return '/' + path.split('/').slice(1, 13).map(part => {
    if (!part) return '';
    const lower = part.toLowerCase();
    if (paths.has(lower)) return lower;
    const dot = lower.lastIndexOf('.'), extension = dot >= 0 ? lower.slice(dot + 1) : '';
    return extensions.has(extension) ? (paths.has(lower.slice(0, dot)) ? lower.slice(0, dot) : ':resource') + '.' + extension : ':segment';
  }).join('/');
}
const path = value => typeof value === 'string' && value.length <= 512 && value.startsWith('/') && thirdPartyPathTemplate(value) === value;
function readThirdPartyRequest(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'tabId', 'frameId', 'documentKey']) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'ui-get-third-party' || !Number.isSafeInteger(own(value, 'tabId')) || own(value, 'tabId') < 0 || own(value, 'frameId') !== 0 || !document(own(value, 'documentKey')) || !own(value, 'documentKey').startsWith(own(value, 'tabId') + ':0:')) return null;
    return { schemaVersion: 1, type: 'ui-get-third-party', tabId: own(value, 'tabId'), frameId: 0, documentKey: own(value, 'documentKey') };
  } catch { return null; }
}
function readThirdPartyRows(value, max = 1024) {
  try {
    if (!array(value, max)) return null;
    const keys = ['domain', 'pathTemplate', 'type', 'relation', 'requestCount', 'completedCount', 'failedCount', 'redirectCount', 'statusCodes', 'documentKey', 'documentHost', 'initiatorHost', 'evidenceSource', 'integrity', 'attributionConfidence', 'script'];
    const result = [], seen = new Set(), sources = new Map();
    let bytes = 512;
    for (let index = 0; index < value.length; ++index) {
      const row = own(value, index);
      if (!exact(row, keys) || !host(own(row, 'domain')) || !path(own(row, 'pathTemplate')) || !THIRD_PARTY_RESOURCE_TYPES.includes(own(row, 'type')) || !['cross-site', 'unknown'].includes(own(row, 'relation')) || !document(own(row, 'documentKey')) || !['documentHost', 'initiatorHost'].every(key => own(row, key) === null || host(own(row, key))) || !['requestCount', 'completedCount', 'failedCount', 'redirectCount'].every(key => count(own(row, key))) || own(row, 'requestCount') < 1 || !['frame-only', 'unknown'].includes(own(row, 'attributionConfidence')) || own(row, 'script') !== null) return null;
      const source = own(row, 'evidenceSource'), browser = source === 'browser-network';
      if (!(browser && own(row, 'integrity') === 'browser-observed' || source === 'page-dom' && own(row, 'integrity') === 'page-controlled') || !browser && (own(row, 'completedCount') || own(row, 'failedCount') || own(row, 'redirectCount'))) return null;
      const statuses = own(row, 'statusCodes');
      if (!array(statuses, 16) || statuses.some(status => !Number.isSafeInteger(status) || status < 100 || status > 599) || new Set(statuses).size !== statuses.length || !browser && statuses.length) return null;
      const key = [own(row, 'documentKey'), source, own(row, 'domain'), own(row, 'pathTemplate'), own(row, 'type'), own(row, 'initiatorHost') ?? ''].join('|');
      if (seen.has(key) || sources.has(own(row, 'documentKey')) && sources.get(own(row, 'documentKey')) !== source) return null;
      seen.add(key); sources.set(own(row, 'documentKey'), source);
      const output = Object.fromEntries(keys.map(key => [key, key === 'statusCodes' ? statuses.slice() : own(row, key)]));
      bytes += 256 + JSON.stringify(output).length * 2;
      if (bytes > 1048576) return null;
      result.push(output);
    }
    return result;
  } catch { return null; }
}
function readThirdPartySnapshot(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'documentKey', 'coverageState', 'rows', 'truncated']) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'third-party-state' || !document(own(value, 'documentKey')) || own(value, 'documentKey').split(':')[1] !== '0' || !['active', 'partial', 'late-start', 'paused', 'unsupported', 'no-access', 'degraded'].includes(own(value, 'coverageState')) || typeof own(value, 'truncated') !== 'boolean') return null;
    const rows = readThirdPartyRows(own(value, 'rows'));
    if (rows === null || rows.some(row => row.documentKey.split(':')[0] !== own(value, 'documentKey').split(':')[0]) || ['no-access', 'unsupported', 'paused'].includes(own(value, 'coverageState')) && rows.length) return null;
    return { schemaVersion: 1, type: 'third-party-state', documentKey: own(value, 'documentKey'), coverageState: own(value, 'coverageState'), rows, truncated: own(value, 'truncated') };
  } catch { return null; }
}
function readThirdPartyTiming(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'available', 'rows', 'truncated']) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'third-party-timing-cache' || typeof own(value, 'available') !== 'boolean' || typeof own(value, 'truncated') !== 'boolean' || !array(own(value, 'rows'), 256)) return null;
    const rows = [], seen = new Set();
    for (let index = 0; index < own(value, 'rows').length; ++index) {
      const row = own(own(value, 'rows'), index);
      if (!exact(row, ['domain', 'pathTemplate', 'type', 'requestCount']) || !host(own(row, 'domain')) || !path(own(row, 'pathTemplate')) || !THIRD_PARTY_RESOURCE_TYPES.includes(own(row, 'type')) || !count(own(row, 'requestCount')) || own(row, 'requestCount') < 1) return null;
      const output = { domain: own(row, 'domain'), pathTemplate: own(row, 'pathTemplate'), type: own(row, 'type'), requestCount: own(row, 'requestCount') }, key = output.domain + '|' + output.pathTemplate + '|' + output.type;
      if (seen.has(key)) return null;
      seen.add(key); rows.push(output);
    }
    if (!own(value, 'available') && rows.length) return null;
    return { schemaVersion: 1, type: 'third-party-timing-cache', available: own(value, 'available'), rows, truncated: own(value, 'truncated') };
  } catch { return null; }
}

return { thirdPartyPathTemplate };
})();
  var thirdPartyTimingAttribution = (() => {
// packages/attribution/src/psl-index.json
var psl_index_default = { sha256: "4b673689999dbaca60b93fa3e1da5752505ef9717b1c4dc44acbfdafd35679ea", rules: [`0:a00trk9--nx
2:27qjf--nx
2:e9ebgn--nx
2:nbb0c7abgm--nx
1:12oa08--nx
2:apg6qpcbgm--nx
2:hbbgm--nx
2:rdceqa08--nx
1:28ugbgm--nx
2:eyh3la2ckx--nx
2:qbd9--nx
1:32wqq1--nx
2:60a0y8--nx
1:4x1d77xrck--nx
1:61f4a3abgm--nx
2:2yqyn--nx
2:5b06t--nx
2:axq--nx
2:ec7q--nx
2:lbgw--nx
1:883xnn--nx
1:9d2c24--nx
1:aa
2:it
1:b
2:.gro
3:lim
3:moc
3:sr
3:ten
3:ude
3:vog
3:yldnerb.pohs
2:abila
2:c
2:ihsot
2:m
2:n
1:c
2:.ba
4:m
4:n
3:cb
4:g
4:q
3:dino
3:ep
3:fn
3:ks
4:y
3:ln
3:no
3:oc
3:pi-on
4:ohsdaerpsym
3:sn
3:tn
3:un
3:vedwa.*
3:xob
3:ysrab
2:ima
3:rfa
3:sroc
1:dats
2:neit
3:oh
2:om
2:sa
2:tl
1:eg
1:fc
2:ob
1:g
2:emo
2:naripi
2:oy
1:hskihs
1:idem
5:.remarf
2:hs
2:k
3:on
2:sa
4:.nomead
5:snduolc
5:xid
1:jnin
1:kaso
2:dov
2:ede
2:usto
1:l
2:.gro
3:moc
3:ofni
3:rep
4:nb
3:ten
4:ni
3:ude
3:vog
2:irgnahs
2:lenisiuc
4:rbmuder
1:m
2:.ca
3:gro
3:oc
3:sserp
3:ten
3:vog
2:ahokoy
2:e00sf7vqn--nx
2:m
1:n
2:.gro
3:moc
3:oc
3:ten
4:la
3:vog
2:av
2:is
2:olecrab
2:tea
1:p
2:.bog`, `3:ca
3:dem
4:ls
3:gni
4:ro
3:moc
5:n
3:oba
3:ten
3:ude
2:c
2:g7hyabgm--nx
2:ra
4:.461e
5:6pi
5:emoh
5:iru
5:nru
5:rdda-ni
5:siri
2:s
1:q
2:.eman
3:gro
3:hcs
3:lim
3:moc
3:ten
3:ude
3:vog
1:raz
2:emac
2:f4a3abgm--nx
2:n
3:d5uhf8le58r4w--nx
2:ukas
1:s
2:.bup
3:dem
3:gro
3:hcs
3:moc
3:ten
3:ude
3:vog
2:ac
4:.uban.iu
2:iv
1:tad
2:elhta
2:led
2:oyot
1:u
2:.acinniv
4:emirc
4:ihzhziropaz
5:stynniv
5:ttaprakaz
4:sedo
5:sedo
4:tlay
4:vatlop
3:bs
3:cc
3:dargovorik
4:o
5:roghzu
7:hhzu
4:tl
3:ehzhziropaz
4:nvir
4:t
3:fi
4:ni
3:gl
4:ro
3:hk
3:istvinrehc
4:ykstynlemhk
10:vypork
3:kc
4:m
4:snagul
7:hul
5:tenod
6:ul
5:viknarf-onavi
6:orteporpend
14:ind
3:liponret
4:opotsabes
10:ves
4:p
3:mk
4:oc
4:s
4:yrk
3:nc
4:d
4:i
4:osrehk
4:v
4:ylov
3:oc
4:nvor
3:pd
4:p
4:z
3:rc
4:imotihz
4:k
4:ymotyhz
3:sk
3:ten
4:l
4:z
3:ude
3:v
4:c
4:ealokin
5:ik
4:ialokym
5:hinrehc
5:krahk
5:vl
5:yk
4:k
4:l`, `4:og
6:inrehc
5:krahk
4:r
3:xc
3:yikstinlemhk
4:mus
4:sakrehc
5:sakrehc
5:tvonrehc
3:zib
4:u
1:v
2:aj
2:bb
2:et
2:iv
1:waniko
1:xa
2:iacal
1:yogan
1:z.bew
3:ca
4:in
5:rga
3:gro
3:lim
4:oohcs
3:mon
4:t
3:oc
4:gn
3:radnorg
3:sin
3:ten
4:la
3:ude
3:vog
3:wal
2:zip
5:.korgn
0:b00ave5a9iabgm--nx
1:125qhx--nx
2:68quv--nx
2:e2kc1--nx
1:2xtbgm--nx
1:3b2kcc--nx
2:jca1d--nx
1:461rfz--nx
3:qif--nx
2:96rzc--nx
1:88uvor--nx
1:a0dc4xbgm--nx
2:c
2:her
2:n
2:ra
2:t
1:b
2:.erots
3:gro
3:moc
3:oc
4:fni
3:ten
3:ude
3:vog
4:t
3:zib
2:a
1:cj
2:s
1:dhesa08--nx
2:mi
1:ew
1:g
1:l
2:.gro
3:moc
3:ten
3:ude
3:vog
2:m
1:s
2:.gro
3:moc
3:ten
3:ude
3:vog
1:tc-retarebsnegmrev--nx
1:ulc
4:.elej
5:snduolc
5:ysrab
4:smas
2:p
3:.di.*
4:nik.*
4:ysrab
1:wp-gnutarebsnegmrev--nx
0:c11q54--nx
2:hbgw--nx
1:2e9c2czf--nx
1:44ub1km--nx
2:a1e--nx
2:byj9q--nx
2:erd5a9b1kcb--nx
1:84xx2g--nx
2:c9jrb2h--nx
1:9jrb2h--nx
5:54--nx
5:9s--nx
4:ceg--nx
5:h3--nx
5:s2--nx
1:a
2:.gro
3:hcs
3:kcabdeef
3:lim
3:moc
3:rrd
3:smrof
3:ten
3:ude
3:vog
2:3a09--nx
10:.ca1o--nx`, `11:gva1c--nx
11:hca1o--nx
12:za09--nx
11:ta1d--nx
11:ua08--nx
1:ba
2:b
2:ci
2:f76a0c7ylqbgm--nx
2:sh
1:c
2:.ce
3:eugaelysatnaf
4:zyrs
3:gnipparcs
3:ku
3:liamwt
3:nwaps.secnatsni
3:pi-duolc
3:revres-emag
3:snduolc
4:otohpym
4:pparevelc
4:seccaptf
4:u
3:ue
4:g
4:wcc
3:xsc
2:0atf7b45--nx
2:a1l--nx
1:e
2:.21k
3:apc
3:bog
4:up
3:cisp
4:od
3:dem
3:esab
4:uc
4:yg
3:fehc
4:orp
3:gba
4:ne
4:ro
4:tkm
3:hcet
3:jol
3:lag
5:iciffo
5:s
4:im
4:ut
3:mda
4:oc
4:se
3:ngd
4:if
4:om
5:rga
3:ocsid
4:fni
4:ir
5:u
4:rp
3:pprr
3:qisp
3:rab
4:bi
4:tn
4:ut
3:tal
4:en
5:v
4:ned
5:oc
6:do
4:of
4:qra
4:ra
3:ude
3:vog
3:xxx
2:beuq
2:n
2:smoc
1:fdh
1:ilohtac
2:nagro
3:ilc
3:osanap
2:sum
2:tic
1:l
2:.gro
3:moc
3:oc
3:ten
3:ude
3:vog
3:yo
2:l
1:m
2:.mt
3:ossa
2:p1akcq--nx
1:n
2:.mon
3:ossa
2:i
2:p
1:relcel
1:s
2:.gro
3:moc
3:ten
3:ude
3:vog
1:t
2:s
2:w
1:v
2:.e0.*
3:gro
3:lim
3:moc`, `3:sndym
3:ten
3:ude
3:vg
5:.d
4:og
1:wp
1:yn
0:d2urzc--nx
1:31wrpk--nx
2:c4b11--nx
3:9jrcpf--nx
1:5xq55--nx
1:697uto--nx
1:75yrpk--nx
1:9ctdvkce--nx
1:a
2:d
2:er
2:olnwod
1:b
2:.ca
3:di
3:gro
3:hcs
3:ia
3:lim
3:moc
3:oc
4:fni
3:ten
4:i
3:ude
3:vog
4:t
2:2babgm--nx
1:c
2:.cc
3:vog
2:g9a2g2b0ae0chclc--nx
1:em
3:bulc
2:r
3:k
2:sopxe
2:timil
2:w
1:fc
1:g
2:.ude
3:vog
1:hd3tbgm--nx
2:p
2:t
1:i
2:.ased
3:bew
3:ca
3:e
4:noz
3:hcs
3:ia
3:lim
3:oc
4:g
3:pok
3:ro
3:sepnop
3:ten
3:ykft9--nx
4:m
3:zib
2:b
2:ordna
2:p
2:rdam
1:liub
5:.0v
6:frusdniw
6:yadotpihs
2:og
2:row
1:m
2:.ri
1:nab
3:l
4:raas
2:ob
2:uf
1:oof
2:rp
1:ractiderc
4:yalcrab
3:ugnav
2:ef506w4b--nx
2:k
3:.oc
4:ude
3:jh3a1habgm--nx
2:of
1:s
2:.dem
3:gro
3:moc
3:ofni
3:ten
3:ude
3:vog
4:t
2:m
3:kcrem
1:t
2:excwkcc--nx
2:l
1:uolc
5:.2k.3s
9:bps-ur.3s
16:bl
16:etisbew
9:citsale
9:etisbew
9:ksm-ur.3s
16:bl
16:etisbew
6:abura-vnej.1ti
17:abura.rue.1ti
7:tcepsrep
7:xo`, `9:.ku
10:nt
6:baltam
7:dnevar
7:ewilek
13:.sc
6:citsalej.piv
6:drayknil
6:elej
7:mohsnd
7:tisotnegam.*
8:oj
6:gnitsohdnert.ed
19:hc
6:letemirp
14:.ku
8:varal
6:medaid
7:ialcer.ac
14:ku
14:su
6:ndctegeb.*
7:evueluk
7:woru
6:paz
6:qhelbavresbo
6:rehcnar-no.*
8:polroov
8:vres-enilno
7:gtsh
7:opav
8:tnemele
6:scitats.*
7:ecivres-nosinu
6:tenraxa.1-se
7:ikcatsno.snur
7:lobevres
7:negreme
7:sinogatna
6:ululetoj
6:wcs.gnilebaltrams
10:koobelacs
10:latemerab.1-rap-rf
22:sma-ln
20:2-rap-rf
10:rap-rf.3s
17:bdgm
19:r
17:cnf
20:.snoitcnuf
17:etisbew-3s
17:hwtd
17:kfak
17:lbcs
18:dd
17:mhw
17:rfi
17:s8k
20:.sedon
17:tipkcoc
10:s8k
11:ecnatsni.bup
20:virp
11:ma-ln.3s
17:bdgm
19:r
17:etisbew-3s
17:hwtd
17:kfak
17:lbcs
18:dd
17:mhw
17:rfi
17:s8k
20:.sedon
17:tipkcoc
10:waw-lp.3s
17:bdgm
19:r
17:etisbew-3s
17:hwtd
17:kfak
17:lbcs
18:dd
17:rfi
17:s8k
20:.sedon
17:tipkcoc
6:xelpciffart
8:vnoc
12:.1-tsae-su
17:ew-ue
6:yawocne.ue
1:za5cbgn--nx
0:e153wlf--nx
2:7a1hbbgm--nx
2:ta3kg--nx
1:2a6a1b6b1i--nx
1:3ma0e1cvr--nx
1:418txh--nx
1:707b0e3--nx
1:a
2:.ca
3:gro
3:hcs
3:lim
3:oc
3:ten
3:vog
2:09--nx
1:b
2:.ca
3:etisbew321
3:gnitsohbew
3:lrusnart.*
3:nevueluk.yxorpze
3:pohsdaerpsym
3:snduolc
5:oitulostsohretni.duolc
3:ym
2:ortal
2:ut
4:uoy
1:c0krbd4--nx
12:.a2qbd8--nx
13:b8adbeh--nx
13:c6ytdgbd4--nx
13:d8lhbd5--nx`, `2:alp
5:.oc
3:ps
5:.fh
8:.citats
6:lla4sx
6:rebu
6:sonoi-ppa
6:tcejorp
7:negayolped
7:safym
8:ohebiv
6:uyieh
5:artxe
3:sla
2:i
3:ffo
2:nad
4:iler
4:nif
4:rusni
9:efil
9:srelevart
3:eics
2:rofria
1:d
2:.1sndnyd
3:42pi-nyd
4:6emoh
5:vpi
3:7erauqs
3:amil4
3:bow-nrefeilgitsng--nx
4:rb-ni
4:ur
4:vz-nelletsebgitsng--nx
3:cessndd
9:nyd
3:decalpb
3:ecnatsni-so-duolcwb.*
4:daregtmueart
4:luhcsvresi
4:mohsnd
4:nihcamyek
4:tiesbew321
3:gifnocecapsbew
3:hcierebsnoissuksid
3:kcodluhcs
4:eegnietsi
3:lsd-ni
3:moc
4:rofttalpluhcs
4:uhcob-inu-rhur
18:.con.oi
3:n-i-g-o-l
4:esgnutiel
4:iemtsi
5:lreb-ni
11:yd
4:norblieh-sh.ti.hcraeser-segap
19:segap
4:pv-ni
3:oc
4:rp-ytinummoc
3:ph21
4:iog
7:ol
4:ohsdaerpsym
3:rentrapdeeps.remotsuc
5:su-lautriv
7:lautriv
5:tadpusnd
6:tub-ni
6:uor-ym
5:vres-ebucl
11:mohym
9:bew-emoh
17:.nyd
9:luhcs
3:snd-nufiat
7:sehcsimanyd
7:tenretni
6:isoc.nyd
6:mieh
6:ps
6:vrs
4:oper-nvs
9:tig
4:sndd
8:.nyd
9:sndnyd
3:tcennocnonex.*
3:vresi-niem
9:tset
3:xi2
3:yawetag-llawerif
11:ym
4:ksurf.*
4:m
4:srab
4:tic-amil
3:ztenmitbel
7:sadtretteuf
2:art
2:isdoow
3:ug
2:on--nx
1:e
2:.bil
3:dem
3:eif
3:gro
3:irp
3:kiir
3:moc
3:pia
3:ude
3:vog
2:ei
2:ffoc
2:gg
2:rf
3:ged
1:fac
3:s
2:il
1:g
2:.byc`, `3:cll
3:enilno
3:gro
3:loohcs
3:moc
3:ten
4:vp
3:ude
3:vog
3:xnt
2:af
3:gtrom
3:p
4:.grebedoc
5:kselp
5:mea
5:sndp
6:ruelfxued
5:tsohcitats
5:wolfyeh
5:xlh
6:obym
5:ycvrp
6:kcor
3:rots
3:yov
2:elloc
2:nahcxe
4:ro
6:.hcet
2:roeg
2:ug
1:i
2:.pohsdaerpsym
3:vog
2:tilop
2:vbba
3:om
1:j
2:.fo
3:gro
3:oc
3:ten
1:k
2:.ca
4:s
3:em
4:n
3:ibom
3:oc
4:fni
4:g
3:ro
2:ib
3:l
3:n
1:ladmrif
3:s
4:rof
2:ba
3:ib
4:dua
2:caro
3:ric
2:dnik
2:g
3:oog
2:ibom
3:ms
2:lasal
3:erauqa
2:ppa
5:.tni
9:.duolc.*
16:r.*
18:1-htron-pa.*
26:ue.*
22:uos-pa.*
20:lartnec-su.*
28:ue.*
20:tsae-su.*
22:ew-su.*
18:2-htuos-pa.*
20:lartnec-su.*
20:tsae-su.*
22:ew-su.*
18:3-tsew-su.*
2:uhcs
2:yts
5:efil
1:m
2:.432i
4:pct
5:v
3:66c
3:ailisarb
3:ca
4:ooh.xorpes
3:duolcnepo
8:sd
3:gro
4:s-raegelif
3:kcatsegde
4:org
3:noitatsksid
3:oc
4:tnigol
5:poh
3:pion
5:snart.etis
4:ohbew
3:raegelif
4:idcm
4:ofsnd
3:sdym
4:ndd
4:ti
4:umhol
3:ten
4:farc
4:sacdnuos
5:ohon
3:ude
3:virp
4:og
3:xobym
3:ygolonys
4:srab`, `2:ag
3:n
4:.citeneek
5:reganampsi
7:h.togrof
5:sih.togrof
2:em
2:irp
2:orhc
2:w
1:n
2:goloc
2:ilno
6:.egats-oree
7:koob
7:llecpael
7:oree
7:redliubetisbew
7:sndmieh
7:ysrab
3:w
2:o
3:.ecivres
5:tisbew
4:nik.*
3:hp
3:latipac
3:tsegdirb
6:rif
3:z
4:.amil
5:notirt.*
5:sporez-1grp
11:.*
5:tikcats
2:ruoblem
1:om
1:p
2:.bog
3:gro
3:lim
3:moc
5:n
3:ten
3:ude
2:irg
2:yks
1:r
2:.bilten
3:moc
3:nac
3:ossa
2:ac
4:htlaeh
3:pmoc
3:wtfos
2:bc
2:eh
2:if
2:ots
5:.erawpohs
7:saberots
6:yflles
7:srab
2:taeht
2:uces
3:sni
3:tinruf
4:necca
3:za
1:s
2:.a
4:disnim321
3:b
4:ibnal
4:rofmok
3:c
4:a
3:d
4:b
4:narb
5:ubroflanummok
3:e
3:f
3:g
4:ro
3:h
4:f
3:i
4:trap
3:k
4:shf
3:l
3:m
4:oc
4:t
3:n
4:mygskurbrutan
3:o
3:p
4:ohsdaerpsym
4:p
3:r
4:owebdluocti
3:s
4:serp
4:yspoi
3:t
3:u
3:vhf
3:w
3:x
4:uvmok
3:y
3:z
2:ac
4:.vas
3:el
3:hc
2:ier
3:urc
2:nesemoh
2:roh
2:uoh
1:tad
3:tse
6:.etupmoc.*
6:laer`, `5:lla
2:is
4:.amgif
6:reduolc.*
6:vnac.ym
5:bewwuoj
5:derauqspw
5:edocyalp
6:lej
6:nieffac
8:lnigol
6:rauqs
7:ocevon
6:winmo
5:hsmroftalp.*
5:laicosnepo
6:enapc
6:os
5:neyb
6:oiton
7:yc
5:oc
5:retup
5:sihtedam
6:pvtsaf
5:tfarcecruos
6:hrs
6:pgtahc
6:roppus
6:st.*
5:vog-amgif
5:wcs
8:.sma
9:waw
6:eiverp
6:olfyeh
5:xevnoc
11:.1-tsae-su
16:ew-ue
6:obeip
5:ysrab
4:bew
7:.remarf
2:ov
2:ra
2:tioled
3:ol
2:utitsni
1:ulb
2:qinilc
4:tuob
1:v
2:.21e
3:ai
3:bew
4:ib
4:og
3:cer
5:t
3:ednerpme
4:rots
3:gro
3:lim
3:moc
5:n
4:rif
3:oc
4:fni
3:rar
3:stra
3:ten
4:ni
3:ude
3:vog
2:as
2:e3gerb2h--nx
2:il
4:.mea
5:pwe.*
5:xlh
3:rd
3:ssergorp
2:ol
1:wkct--nx
2:r
1:xul
1:y
2:.gro
3:lim
3:moc
3:ten
3:ude
3:vog
0:f0f3rkcg--nx
1:198xim--nx
1:280xim--nx
1:7vqn--nx
1:a
2:.gro
3:moc
3:ten
3:ude
3:vog
1:b
2:.vog
2:wa9bgm--nx
1:c
2:a1p--nx
9:.a14--nx
10:b8lea1j--nx
10:cavc0aaa08--nx
11:ma09--nx
10:fa1a09--nx
11:ea1j--nx
10:gva1c--nx
10:nha1h--nx
10:pda1j--nx
10:zila1h--nx
2:ns
1:ea1j--nx
1:g
1:iam
1:la1d--nx
2:og
1:n
2:.bew
3:cer
3:erots`, `3:moc
4:rif
3:ofni
3:rehto
5:p
3:stra
3:ten
1:orp
1:p
2:.gro
3:moc
3:ude
1:rus
1:t
2:.hcs
2:w
3:.sndd
1:w
2:.hcs
3:zib
0:g24wq55--nx
2:8zrf6--nx
1:344sd3--nx
2:91w6j--nx
11:.a5wqmg--nx
12:d22svcw--nx
13:5xq55--nx
12:gla0do--nx
12:m1qtxm--nx
12:vta0cu--nx
1:455ses--nx
1:5mzt5--nx
1:69vqhr--nx
1:78a4d5a4prebgm--nx
2:rb2c--nx
1:a
2:.gro
3:jbo
3:moc
5:n
3:oc
3:ten
2:vd
1:b
2:.0
3:1
3:2
3:3
3:4
3:5
3:6
3:7
3:8
3:9
3:a
3:b
3:c
3:d
3:e
3:f
3:g
3:h
3:i
3:j
3:k
3:l
3:m
3:n
3:o
3:p
3:q
3:r
3:s
3:t
3:u
3:v
3:w
3:x
3:y
4:srab
3:z
1:c
2:b
2:za9a0cbgm--nx
1:e
2:.ca
3:em
5:an
3:gro
3:ics
3:lim
3:moc
3:nue
3:ofni
3:ten
4:rops
3:ude
3:vog
4:t
2:a
1:g
2:.gro
3:hsadtob
3:lenap
8:.nomead
3:oc
3:saak
3:ten
4:ikcats
3:ylp.6d
7:ta.*
1:ia
2:v
1:k
2:.ea
3:gro
3:lim
3:moc
3:su
3:ten
3:ude
3:vog
3:xx
1:m
2:.drp
3:gro
3:lim
3:moc`, `5:n
3:oc
3:ude
3:vog
2:pk
1:n
2:.clp
3:dtl
3:eman
3:gro
3:hcs
3:i
4:bom
3:lim
4:oc
3:moc
4:rif
3:neg
3:ogn
3:ten
3:ude
3:vog
3:zib
6:.gl
7:ld
7:no
7:oc
8:g
2:aw
2:i
3:b
4:mulp
3:car
3:dart
4:dew
3:hsif
4:tolc
3:kiv
4:oob
6:c
3:ls
3:naelc
4:iart
3:p
4:pohs
3:reenigne
5:tac
3:tad
4:ekram
4:hgil
4:lusnoc
4:neg
4:ov
4:soh
7:.tfarcnepo
3:vig
5:l
2:o
3:s
2:urehcisrev
3:smas
1:od
2:lb
2:og
4:.duolc
5:etalsnart
5:tnetnocresu.*
1:p.*
1:r2n084qlj--nx
2:ebmoolb
2:o
3:.77ndc.c
11:sr
4:aremacytirucesym
5:tneimip
6:sivretla
5:xor
5:z
4:bew-llams
4:cimanyd-pi
4:dab-yrev-si
5:esufnocsim
6:vas-si
5:nuof-si
5:oog-yrev-si
5:uolcarfniarodef
9:ehtgnituor
9:mw
11:.ateb
4:ea
5:cin-yrev-si
5:grofloot
9:peh
5:las-4-ffuts
6:poeparodef
5:m-morf
6:agevres
6:ohruoyslles
5:nozdop
5:rehwongniogyldlob
6:iwym
6:uces-77ndc.nigiro.lss
5:tadidnac-a-si
6:is-ybboh
8:golb
4:fehc-a-si
4:golbymdaer
4:keeg-a-si
10:si
5:h
5:nut
4:lacol-si
5:iamwt
6:ve-yrev-si
5:lawerif-ym
12:ym
5:sd-ni
4:macssecca
5:edom-elbac
4:nafblm
7:cfu
7:egelloc
7:lfn
7:scitlec-a-si
8:niurb-a-si
8:tap-a-si
7:xos-a-si
5:ibptth`, `5:orviop
5:pj
6:v-ni
4:ojodsnd
5:tpaz
7:oh
4:pi-on
6:fles
5:ohbew
6:tksedeerf
5:tfemoh
8:vres
7:ym
4:regatop
6:ppepteews
6:su-xunil-a-si
5:vdmac
4:sailanyd
9:snd
6:nymsd
5:balfmw
6:bevres
5:dikcet.3s
6:ylimaf
5:egapsf
6:irfotatophcuoc
5:j
5:koob-daer
5:ltbup
5:nd-won
7:deerf
7:emoh
7:golb
7:kcud
7:mood
7:nyd
10:.emoh
11:og
7:pd
8:s
7:rvd
7:tog
7:uolc
5:sa-skcik
6:ndd
5:tnemhcattaomb
5:u
4:tcejorparodef.duolc
18:gts.so.ppa
18:so.ppa
7:riderbew
5:eews-yrev-si
6:nretniehtfodne
12:fodne
5:hgink-a-si
5:sixetnod
11:seod
6:oh-emag
7:l-si
4:ue
6:.ac
7:dc
7:eb
8:d
8:e
8:i
8:m
8:s
7:gb
8:n
7:hc
7:if
8:s
7:kd
8:m
8:s
8:u
7:la
8:i
8:n
8:p
7:nc
8:i
7:on
8:r
8:ssa
7:pj
7:rf
8:g
8:h
8:k
8:t
7:se
8:i
8:u
7:ta
8:en
8:i
8:l
8:m
8:ni
8:p
7:ua
8:de
8:h
8:l
8:r
7:vl
7:yc
8:m
7:zc
8:n
4:vresnyd
4:xinuemoh
5:unilemoh
4:ylimafxut
5:raidanetah
5:srab
2:ubmah
4:oj
1:s
2:.delacsne
3:gro
3:moc
3:ten
3:ude
3:vog
2:gb639j43us5--nx`, `1:t
1:u
2:.ca
4:s
3:en
3:gro
3:lim
3:moc
3:oc
4:g
3:ro
3:su
3:ude
3:vog
1:v
2:.ude
2:a1c--nx
1:wsa08--nx
0:h0ee5a3ld2ckx--nx
1:4wc3o--nx
10:.a2xyc3o--nx
12:3j0hc3m--nx
12:ve4b3c0oc21--nx
11:id1kzuc3h--nx
11:l8bxi8ifc21--nx
11:rb0ef1c21--nx
1:88yvfe--nx
2:a7maabgm--nx
1:b
2:.gro
3:moc
3:ten
3:ude
3:vog
2:mg
1:c
2:.7erauqs
3:amil4
3:duolc-drayknil
3:egarotstcejbo.amr
17:gpl
4:lacsduolc.amr.stcejbo
14:gpl.stcejbo
14:tsuc
4:tisbew321
3:gniksnd
3:ph21
4:ohsdaerpsym
3:sndtog
6:uolc
3:tenerif.*
11:cvs.*
3:wolf.ea.1pla
9:nigneppa
3:xi2
3:ytic-amil
2:aoc
2:et
4:.spparevelc
2:ir
4:euz
2:raes
3:uhc
2:sob
2:taw
5:s
1:d0sbgp--nx
1:f2lpbgm--nx
2:k
1:g
2:.gro
3:lim
3:moc
3:ten
3:ude
3:vog
3:zib
1:k
2:.gro
3:moc
3:ten
3:ude
3:vog
1:m
2:a1j--nx
1:ocir
1:p
2:.gro
3:i
3:lim
3:moc
3:ogn
3:snduolc
3:ten
3:ude
3:vog
1:s
2:.adtob
3:elbavol
3:gnabhsah
4:ro
3:lim
3:moc
4:roftalp.su
12:tne
12:ue
3:ten
4:ropelet
3:vog
3:won
2:ac
3:nom
2:id
3:f
3:ri
1:t
2:.ca
3:enilno
3:im
3:ni
3:oc
4:g
3:pohs
3:ro
3:ten
2:iaf
2:laeh
6:.arh`, `2:orxer
2:rae
1:vo
3:.lopdren
1:zb
0:i3tupk--nx
1:7a0oi--nx
1:a
2:.ffo
3:gro
3:moc
3:remarf
3:sppaolik
3:ten
3:uwu
2:1p--nx
2:bud
2:dnuyh
2:tnihc
1:b
2:.gro
3:moc
3:oc
3:ro
3:ude
2:ahduba
2:o
3:m
4:.duolcsd
5:ysrab
2:s
1:c
2:.ayb-tropora--nx
3:ca
3:de
3:gro
3:moc
3:oc
4:g
4:ssa
3:ro
3:su
3:ten
4:ni
3:ude
3:vuog
2:cug
2:t
1:ddk
2:ua
1:ebhf--nx
2:piat
1:f
2:.aw5-nenikkh--nx
3:dnala
3:iki
4:spak
3:mroftalpduolc.if
3:pohsdaerpsym
3:uvisitok321
3:yd
2:onas
1:g
2:.dom
4:tl
3:gro
3:moc
3:ude
3:vog
1:hcatih
3:ra
2:sabodoy
3:ibustim
1:juohs
1:k
2:.gro
3:moc
3:ofni
3:ten
3:ude
3:vog
3:zib
2:b4gc--nx
2:iw
4:.remarf
2:nisleh
2:s
2:uzus
1:l
2:drahcir
2:iamsi
1:maim
1:n
2:.bew
4:og
3:ca
3:gro
3:lim
3:moc
5:n
3:ni
3:oc
4:fni
3:ten
4:ni
3:ude
3:zib
2:airpic
2:ihgrobmal
3:m
2:re
1:om
1:rarref
1:s
2:.5f
3:egaptig
3:ppatig
2:ed
1:tic
3:nifni
2:rahb
1:ut
1:v
2:.21k
3:gro
3:moc
3:oc
3:ten`, `1:wik
1:xarp
3:t
1:yf
0:j6pqgza9iabgm--nx
1:8da1tabbgl--nx
1:b
2:.acirfa
3:eto
3:gro
3:moc
4:siruot
3:oc
5:e
4:fni
4:noce
4:rga
4:tser
3:russa
3:setcetihcra
4:risiol
4:tacova
3:ten
4:naruatser
3:ude
3:vinu
3:yenom
1:d
1:f
2:.ca
3:di
3:eman
3:gro
3:lim
3:moc
3:ofni
4:rp
3:ten
3:ude
3:vog
3:zib
1:nj
1:s
1:t
2:.bew
3:cin
3:eman
3:gro
3:lim
3:moc
3:oc
4:g
3:ten
4:ni
4:set
3:ude
3:vog
3:zib
1:yqx94qit--nx
0:k8uxp3--nx
1:924tcf--nx
1:arfel
1:c.*
3:www!
2:abdeef
3:lb
2:ebdnul
2:ilc
2:rem
5:e
1:d
2:.edisemmejh321
4:rots
3:ger
3:mrif
3:oc
3:pohsdaerpsym
3:zib
2:t
1:ees
2:samet
1:f.*
1:h
2:.a4ya0cu--nx
4:5wqmg--nx
3:b3qa0do--nx
3:cni
3:d22svcw--nx
5:3rvcl--nx
4:5xq55--nx
4:tl
3:ga0nt--nx
4:la0do--nx
4:ro
3:i050qmg--nx
4:7a0oi--nx
4:xa0km--nx
3:m1qtxm--nx
4:oc
3:npqic--nx
3:ten
3:ude
3:vdi
4:og
4:ta0cu--nx
3:xva0fz--nx
2:n
1:itsob
2:vdnas
1:l
2:.bew
3:ca
4:os
3:dtl
3:gro
3:hcs
3:letoh
3:moc
3:nssa
3:ogn
3:prg
3:ten
4:ni
3:ude
3:vog
2:at
2:cd
2:is`, `1:m
2:.eman
3:fni
3:gro
3:moc
3:ten
3:ude
3:vog
1:nab
4:cfdh
4:etats
4:mmoc
4:ten
5:fos
4:u
2:i
3:l
4:.ahcarots.sfpi
6:vnac
5:bewd.*
5:citeneek
6:mnioj
5:egarotstfn.sfpi
5:hte.*
5:noyc
5:pepym
5:resworbni.*
5:s3w.sfpi
5:ztirfym
3:p
1:oob
1:p
2:.bew
4:og
3:ca
3:gog
4:ro
3:kog
3:maf
4:oc
3:pkg
4:og
3:sog
3:ten
3:ude
3:vog
3:zib
1:row
4:.retup
5:yxorp-enigami
4:ten
7:.etirwppa
8:htumiza
8:mea
8:nolt
8:oc
9:vra
8:secla.*
1:s
2:.gro
1:t
1:u
2:.ca
4:lp
3:dtl
3:ecilop
4:m
4:tismin
3:gro
6:.gul
10:g
7:sgul
7:yrettolylkeew
15:tiniffa
9:tneelffar
3:hcs.*
3:lenap-tnednepedni
3:nnoc
4:oissimmoc-layor
14:tnednepedni
3:oc
5:.bunsorter.tsuc
6:enilnoysrab
6:omida
6:pi-on
7:ohsdaerpsym
6:tfihsreyal.j
6:vres-hn
6:ysrab
4:rpoc
3:psoh
3:shn
4:ppaduolcvogelcaro.*
3:ten
4:nmyp
4:seuqni-tnednepedni
3:vog
6:.ecivres
7:ipa
7:ngiapmac
3:weiver-tnednepedni
3:yriuqni-cilbup
11:tnednepedni
4:srab
0:l04sr4w--nx
1:a
2:.gro
3:lim
3:moc
3:ten
3:ude
3:vog
2:bolg
6:.etirwppa
2:c
2:ed
2:g
3:el
2:icnanif
9:.oc
9:lpl
4:os
3:romem
3:tnedurp
2:nif
3:oitanretni
2:tigid
4:pac`, `5:soh
3:ned
3:ot
1:c
2:.bog
3:lim
3:oc
3:snduolc
3:vog
1:dil
1:edatic
2:nahc
3:nahc
7:rehtaew
2:t
3:oh
3:ria
3:tam
2:vart
1:f8fpbgo--nx
4:tbgm--nx
2:a
2:n
1:g
2:.gro
3:moc
3:oc
3:ten
3:ude
1:hd
2:op
1:i
2:.21k
3:ca
3:fdi
3:gro
3:inum
3:oc
5:.egapvar
6:redrotibat
6:tibatym
3:ten
3:vog
2:af
3:me
5:.hcuotni
6:kwat.p
6:otkwat.p
4:g
4:toh
2:m
2:r
1:labesab
4:teksab
10:.sua
11:zn
5:oof
3:c
3:mt
2:ed
3:hs
2:ihmailliw
2:j
1:m
2:.ca
3:esserp
3:gro
3:moc
3:ofni
4:ssa
3:rp
3:ten
4:ra
4:sni
3:ude
3:vog
4:uog
1:n
2:.etisbew321
3:lrusnart.*
3:nomed
5:rtsic
3:oc
3:pohsdaerpsym
3:retsulc-gnitsoh
3:vog
3:yalphk
2:o
1:oa
2:btuf
2:l
3:.gmo
2:oc
4:.ed
5:rotnemele
3:hcs
2:rit
2:u
1:p
2:.2uoy
3:acindiws
7:gel
4:dg
5:ortso
5:urawon
4:idem
5:mraw
5:nydg
4:keloguld
8:rtso
5:slopolam
5:tsu
5:ytsyrut
4:lip
5:okzs
6:w-awolats
7:oksnok
4:mrifd
4:nerapohs
5:img
5:zcel
4:rog-aibab
10:nelej
7:j
7:z
4:syn
4:tsaim
4:waleib`, `7:i
7:o
6:zsraw
5:onamil
6:tainop
4:zeiwolaib
5:mol
3:ceiwalselob
7:onsos
8:rtso
5:leim
7:zrogz
4:orw
4:p
3:dem
4:ia
4:ragrats
4:uolcinu
8:sds
3:ecilrog
6:naibap
6:weinreiks
7:ilg
7:ohcarats
10:orp
8:klop
8:tak
5:yzreibok
4:icsjuoniws
5:ksromop
5:saldop
4:lahdop
5:opo
4:napokaz
4:tatselaer
5:iselpmis
4:zromop
5:swozam
3:galble
4:ezrbolok
9:nrat
4:ro
3:hcyzrblaw
3:icsomohcurein
4:grat
4:klawus
3:kcolp
4:erut
5:walcolw
4:inbyr
6:diws
6:sark
4:le
4:onas
5:tsylaib
4:robel
7:lam
4:sals
5:jazel
5:nadg
5:puls
5:rowezrp
3:lcolw
4:er
5:vart
4:iam
5:m
3:moc
5:dar
5:n
5:tyb
4:sg
5:iruot
4:t
5:a
3:nagaz
5:nzop
4:ibul
5:cezczs
5:lbul
5:molow
5:nok
5:zdeb
7:obeiws
4:uleiw
5:rot
4:ytzslo
5:zrtek
6:seic
3:oc
4:fni
4:kcelo
5:sleib
5:zdolk
4:lkan
4:nleim
5:pek
5:tuk
6:yzczs
5:zcopo
6:eing
6:rowaj
4:rga
4:tnokd
5:ua
4:wejarg
5:ogarm
3:peeb
5:lks
8:emoh
4:klwwortso
4:ohs
7:-ecremmoce
7:daerpsym
3:romophcaz
3:sklofc
4:os
3:taiwop
4:en
4:opos
4:ra
4:sezc
3:ude
3:virp
4:og
6:.aio
8:p
8:s`, `9:w
7:bnip
10:w
7:ci
7:dtiw
7:eko
8:ssp
10:w
7:fiw
7:gimu
8:u
7:hiiw
7:migu
8:rio
8:u
9:o
7:nds
10:ipz
7:oks
8:p
9:pu
8:s
8:wtsorats
7:pa
8:sp
10:mk
10:pk
10:wk
8:um
9:p
8:wk
8:z
7:rhcso
8:ksw
8:p
8:s
7:si
8:oiw
8:u
8:zu
7:talusnok
7:wgzr
8:ip
9:rg
9:w
8:m
8:oo
9:pu
8:u
9:imzw
7:zkw
8:ouw
3:walcorw
6:sizdow
5:w
4:ogolg
5:kark
6:ul
6:zsurp
5:raz
6:gew
5:trabul
6:sugua
5:zcoks
6:sezr
3:xes
3:ybuzsak
4:dazczseib
5:ikseb
4:hcyt
4:njes
5:lod-zreimizak
4:pal
4:rogt
5:uzam
4:walup
4:zutrak
3:zam-awar
4:caprak
5:iwol
5:zsogdyb
4:dalezc
6:reis
5:ol
4:ib
4:reigz
4:silak
6:p
5:uklo
2:l
1:ras
2:f
2:s
1:s
2:.gro
3:moc
3:ten
3:ude
3:vog
1:t
2:.vog
1:ubnatsi
1:x3b689qq6--nx
1:yc5rb54--nx
0:m00tsb3--nx
1:1qtxm--nx
1:981rvj--nx
1:a
2:.enummoc
3:gro
3:moc
3:oc
4:idar
3:ten
2:c
3:bew
2:dretsma
2:erts
3:t
4:.citsalej
5:esruocsid
2:fma
2:xq--nx
1:b
2:.gro
3:moc
3:ten
3:ude`, `3:vog
2:i
1:c
2:.moc
3:oc
3:ten
3:vog
1:d
2:.gro
3:moc
3:oc
3:ten
3:ude
3:vog
1:f
2:.gro
3:moc
3:oidar
3:resu.*
3:ten
3:ude
2:i
1:g
2:vu96d8syzf--nx
1:h
1:i
2:.ca
3:gro
3:moc
3:oc
5:.clp
6:dtl
3:ten
4:t
3:vt
2:k
2:rbg4--nx
1:j.*
1:k
2:.drp
3:erianiretev
4:sserp
3:gro
3:lim
3:moc
5:n
4:t
3:nicedem
3:ossa
3:pooc
3:seriaton
4:neicamrahp
4:sa
3:ude
3:vog
4:uog
1:lif
2:ohkcots
1:m.*
1:o
2:.dem
3:gro
3:moc
4:uesum
3:oc
4:rp
3:ten
3:ude
3:vog
2:b
2:c
3:.0x
4:121sesaila
5:dna1-sppa
4:2aq
4:3pmevres
4:ac-morf
6:irfa
5:g-morf
6:oy-sehcaet
5:i-morf
5:m-morf
6:all-a-si
9:amai
5:p-morf
6:c-a-si
5:remacytirucesym
5:s
5:tadtsudgniht
6:emta
5:v-morf
5:w-morf
5:z
4:bew-sndnyd
7:arukas
7:draiw.segap
7:ottad
4:camytirucesemoh
5:d-morf
5:esyrcs
5:itsalej.omed
5:n-morf
6:vym
5:pkroweht
6:ytirucesemoh
5:rievres
5:s-morf
4:daerotffuts
5:ebme-detsoh-avnac
6:calpb
6:ifitrec-si
14:ton-si
6:rewopenignepw
19:.sj
6:tsoh-scodehtdaer
10:2a
10:ecapsppa
5:i-morf
6:parpc
6:rgevissam.saap
5:m-morf
5:n-morf
6:abeht-htiw-si
5:om-vog-su-p3-naissalta.*
6:rpnonduolcwm
5:s-morf
5:uolc-noitatsyalp
10:revelc.secivres.*`, `9:ehtgnituor
9:hr
9:iafaw.dej
16:yr
9:meaeboda
17:.ved.*
9:nevia.*
9:panqym
15:-ahpla
16:ved
9:sanym
10:metsystuo
9:vedj
12:pw
5:vreser
5:wetomer
4:ebutuoyhtiw
5:capsylop
6:iffo-sndnyd
7:vedlootx
6:rofselas.mroftalp.gts-redliub-edoc.tset.100.*
5:d
6:-morf
6:oc.redliub-gts.*
17:ved.*
16:.*
8:avnac
8:elgoog
7:nil.recnalabedon.*
11:srebmem
8:neve.1-su
15:ue
13:2-su
15:ue
13:3-su
15:ue
13:4-su
15:ue
5:erf-sndnyd
8:sndd
5:filflahevres
5:garots-77ndc
6:de-yltsaf
6:nahcxeevres
6:rof-no
5:ihcet-a-si
6:p-sekil
5:kauqevres
6:irtsretnuocevres
5:lbitpa-no
6:googhtiw
5:magevres
6:ina-otni-si
6:oh-sndnyd
9:ta-sndnyd
5:n-morf
6:ilnoysrab
6:og-si
5:pacsledom
5:ralfduolcyrt
6:ehwynanohtyp
18:.ue
6:ihcec
5:srun-a-si
5:tinuarepo
7:s-ybboh
8:aloy
8:bew-evil
8:elpmis
8:rodabew
8:tipohs
8:xiw
6:omer-sndnyd
6:ysgolb
5:vals-elcibuc-a-si
6:itavresnoc-a-si
5:zamkcar
6:eelg
6:iig
4:fehc-a-si
4:gnigats-raeghtua
12:swennwot
7:ksndd
7:robsikrow
7:tsoh-bt.etis
11:edalbderiw
11:ovip
11:unyd
5:ofgp
6:lb-sndnyd
8:anetah
8:sihtsetirw
4:hn-morf
5:o-morf
4:ico-remotsuc.*
17:ico.*
17:pco.*
17:sco.*
5:fiwehtno
5:h-morf
5:kiw-sndnyd
5:m-morf
5:paerocne
6:detsoh
5:r-morf
5:w-morf
5:zihcppa
6:nilppa
4:jn-morf
4:ka-morf
6:erfocsic
5:cils-si
5:eeg-a-si
10:si
8:sndd
5:h
5:latsnaebcitsale
20:.1-htron-ue
25:uos-em
29:fa
29:pa
29:ue
23:lartnec-ac
31:em
31:li
31:ue
23:tsae-as
28:pa`, `28:su
28:vog-su
27:htron-pa
29:uos-pa
25:ew-su
28:ue
28:vog-su
21:2-htuos-ue
23:tsae-su
27:htron-pa
29:uos-pa
25:ew-su
28:ue
21:3-tsaehtron-pa
29:uos-pa
25:ew-ue
21:5-tsaehtuos-pa
21:7-tsaehtuos-pa
5:nil-kaerts
5:o-morf
5:radhtiwtliub
6:ow-sndnyd
9:ta-sndnyd
8:ten-orehkcats
5:sedal
5:u
4:la-morf
6:colottad
6:rebil-a-si
6:tropqhylauq.*
5:f-morf
5:i-morf
6:am-sndnyd
8:detsohpw
5:lecelffaw
5:rihwyap.*
6:u-elpmis
8:taen
4:mme0.*
5:n-morf
5:rofepyt.orp
9:rerac-htlaeh
8:talp-evird
5:sacrasevres
5:uirarret-yltsaf
4:nacilbuper-a-si
6:f-sllub-a-si
7:racsan-a-si
6:icisum-a-si
7:ratrebil-a-si
6:tarukas
5:c
5:dchsums
7:umpw
5:eerg-a-si
5:i-morf
6:jod
5:m-morf
5:oehtnaptog
6:isam-al-a-tse
6:rtap-el-tse
6:siam-al-a-tse
7:replausunu
5:pj
5:t-morf
4:oc
5:hce-namtsop
5:idutsxiw
5:jodsnd
5:m-morf
6:ed-baltlow
5:niloxip
5:tingocnozama.1-htron-ue.htua
22:uos-em.htua
26:fa.htua
26:pa.htua
26:ue.htua
20:lartnec-ac.htua
28:em.htua
28:li.htua
28:ue.htua
28:xm.htua
20:tsae-as.htua
25:pa.htua
25:su.htua
28:spif-htua
25:vog-su.spif-htua
24:htron-pa.htua
26:uos-pa.htua
22:ew-ac.htua
25:su.htua
28:spif-htua
25:ue.htua
25:vog-su.spif-htua
18:2-htuos-pa.htua
26:ue.htua
20:lartnec-ue.htua
20:tsae-su.htua
28:spif-htua
24:htron-pa.htua
26:uos-pa.htua
22:ew-su.htua
28:spif-htua
25:ue.htua
18:3-tsaehtron-pa.htua
26:uos-pa.htua
22:ew-ue.htua
18:4-tsaehtuos-pa.htua
18:5-tsaehtuos-pa.htua
18:7-tsaehtuos-pa.htua
6:tadym
4:p2pevres
5:3-detalosi-naissalta.*
7:naissalta.*
5:aelutym
5:i-sndnyd
6:fles
6:ogol
6:ruoyesol
10:hctid
6:ymeerf
8:teg
5:mirhselbmub
5:ohsdaerpsym
8:uneviv
5:pa-emas
8:selucreh
7:anis`, `11:piv
7:esaberif
7:iparts
13:.aidem
7:k1
7:nuspu
7:oifilauq
7:roetem
13:.ue
7:snrettapcigam
7:tilmaerts
7:ukoreh
7:yfilpma
5:tfevres
6:thevres
4:r081
5:a-morf
6:tskcor-a-si
5:b
6:asnd
5:ediverp-yb-detsoh.saap
9:orpnwo
7:ner.ppa
10:no
6:ebevres
7:nigne-na-si
6:ggolb-a-si
6:hcaet-a-si
7:pargotohp-a-si
6:krow-drah-a-si
6:ngised-a-si
7:iartlanosrep-a-si
9:tretne-na-si
7:nurppaswa.*
7:trapqhylauq.*
6:pacsdnal-a-si
7:eekkoob-a-si
6:retac-a-si
6:subq
6:tnecysrab
8:iap-a-si
8:uh-a-si
6:vres-ki.cpj-rev-duolcj
14:duolcj
11:sndnyd
12:pvtsaf
10:bdym
10:inim
10:nmad
10:pc
10:sak
6:yalp-a-si
7:wal-a-si
6:zilibomdeepsegap
5:g
5:ituob
5:mgrp.nex
5:o-morf
6:pav-no
6:sivdalaicnanif-a-si
6:tareleccalabolgswa
7:ca-na-si
8:od-a-si
7:susaym
5:p-morf
5:uas-o-nyd
6:etsoh.duolc-gar
12:hc-duolc-gar
7:ugolb-nom-tse
6:omuhevres
4:saapod
6:ilanyd
9:snd
6:nduolcym
7:ymsd
6:vnac-sued
10:remarf
5:bal-ecir
6:bevres
5:cduolcababila
6:ip-sndnyd
8:evres
7:tcatytiruces
5:dylimaf
5:ecapsnaecolatigid.*
7:ived-anelab
6:itilitu3
6:lahw-eht-sevas
6:mag-otni-si
6:tiiis
8:sro
7:yskciuq
6:ugaelyajyarg
5:fpi-eralfduolc
9:fc
5:iht2tniop
6:murud
6:paelgoog
8:tneltneg
5:jfac
5:k-morf
6:aerf-ten
6:colbegrof
10:pohsym
6:nilkaerts
5:m-morf
5:nd-pmet
7:d-pi
8:unyd
8:yard
7:golb
7:htiwssem
7:looc1
7:mood
7:rba
7:tog
6:kselp
6:nyd
6:ootrac-otni-si
5:o-xobeerf
6:xobeerf
5:ppa-avnac
8:duolcelcaro.*
13:vogelcaro.*
8:nived.*
8:raeghtua
8:swa
8:tneg`, `5:rac-otni-si
6:entrap-paelut
7:tsohmaerd
5:sel-rof-slles
7:rtca-na-si
6:ibodym
5:tcejboedonil.*
11:rtluv.*
6:nemelepiuq.*
6:saeb-cihtym.allicno
19:zno
18:ilay
18:lacarac
18:regitnef
20:motsuc
18:sv
18:toleco
18:x
19:nihps
20:yl
5:u
5:wanozama.1-3s
16:etupmoc.*
16:htron-ue-3s
24:.3s
25:9duolc-swa.stessa-weivbew
31:.sfv
33:tessa-weivbew
25:adbmal-tcejbo-3s
25:dorp-iupparme
30:oidutsrme
30:skoobetonrme
25:etisbew-3s
25:ipa-etucexe
25:kcatslaud.3s
35:tniopssecca-3s
25:tniopssecca-3s
18:uos-em-3s
24:.3s
25:9duolc-swa.stessa-weivbew
31:.sfv
33:tessa-weivbew
25:adbmal-tcejbo-3s
25:dorp-iupparme
30:oidutsrme
30:skoobetonrme
25:etisbew-3s
25:ipa-etucexe
25:kcatslaud.3s
35:tniopssecca-3s
25:tniopssecca-3s
22:fa.3s
25:9duolc-swa.stessa-weivbew
31:.sfv
33:tessa-weivbew
25:adbmal-tcejbo-3s
25:dorp-iupparme
30:oidutsrme
30:skoobetonrme
25:etisbew-3s
25:ipa-etucexe
25:kcatslaud.3s
35:etisbew-3s
35:tniopssecca-3s
25:tniopssecca-3s
22:pa-3s
24:.3s
25:9duolc-swa.stessa-weivbew
31:.sfv
33:tessa-weivbew
25:adbmal-tcejbo-3s
25:dorp-iupparme
30:oidutsrme
30:skoobetonrme
25:etisbew-3s
25:ipa-etucexe
25:kcatslaud.3s
35:etisbew-3s
35:tniopssecca-3s
25:tniopssecca-3s
25:yawetag-scitylana
22:ue.3s
25:9duolc-swa.stessa-weivbew
31:.sfv
33:tessa-weivbew
25:adbmal-tcejbo-3s
25:dorp-iupparme
30:oidutsrme
30:skoobetonrme
25:etisbew-3s
25:ipa-etucexe
25:kcatslaud.3s
35:etisbew-3s
35:tniopssecca-3s
25:tniopssecca-3s
16:lanretxe-3s
18:rtnec-ac-3s
26:.3s
27:9duolc-swa.stessa-weivbew
33:.sfv
35:tessa-weivbew
27:adbmal-tcejbo-3s
27:dorp-iupparme
32:oidutsrme
32:skoobetonrme
27:etisbew-3s
27:ipa-etucexe
27:kcatslaud.3s
37:etisbew-3s
37:spif-3s
42:tniopssecca-3s
37:tniopssecca-3s
27:spif-3s
32:tniopssecca-3s
27:tniopssecca-3s
24:em.3s
27:adbmal-tcejbo-3s
27:dorp-iupparme
32:oidutsrme
32:skoobetonrme
27:etisbew-3s
27:ipa-etucexe
27:kcatslaud.3s
37:etisbew-3s
37:tniopssecca-3s
27:tniopssecca-3s
24:li.3s
27:9duolc-swa.stessa-weivbew`, `33:.sfv
27:adbmal-tcejbo-3s
27:dorp-iupparme
32:oidutsrme
32:skoobetonrme
27:etisbew-3s
27:ipa-etucexe
27:kcatslaud.3s
37:etisbew-3s
37:tniopssecca-3s
27:tniopssecca-3s
24:ue-3s
26:.3s
27:9duolc-swa.stessa-weivbew
33:.sfv
35:tessa-weivbew
27:adbmal-tcejbo-3s
27:dorp-iupparme
32:oidutsrme
32:skoobetonrme
27:etisbew-3s
27:ipa-etucexe
27:kcatslaud.3s
37:etisbew-3s
37:tniopssecca-3s
27:tniopssecca-3s
27:yawetag-scitylana
16:tsae-as-3s
24:etisbew-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:dorp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:etisbew-3s
34:tniopssecca-3s
24:tniopssecca-3s
21:pa-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:dorp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:tniopssecca-3s
24:tniopssecca-3s
21:su
23:-etisbew-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:detacerped-3s
25:orp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:etisbew-3s
34:spif-3s
39:tniopssecca-3s
34:tniopssecca-3s
24:spif-3s
29:tniopssecca-3s
24:tniopssecca-3s
24:yawetag-scitylana
21:vog-su-3s
28:spif-3s
27:.3s
28:adbmal-tcejbo-3s
28:dorp-iupparme
33:oidutsrme
33:skoobetonrme
28:etisbew-3s
28:ipa-etucexe
28:kcatslaud.3s
38:etisbew-3s
38:spif-3s
43:tniopssecca-3s
38:tniopssecca-3s
28:spif-3s
33:tniopssecca-3s
28:tniopssecca-3s
20:htron-pa-3s
29:etisbew-3s
28:.3s
29:9duolc-swa.stessa-weivbew
35:.sfv
37:tessa-weivbew
29:adbmal-tcejbo-3s
29:dorp-iupparme
34:oidutsrme
34:skoobetonrme
29:etisbew-3s
29:ipa-etucexe
29:kcatslaud.3s
39:etisbew-3s
39:tniopssecca-3s
29:tniopssecca-3s
29:yawetag-scitylana
22:uos-pa-3s
29:etisbew-3s
28:.3s
29:9duolc-swa.stessa-weivbew
35:.sfv
37:tessa-weivbew
29:adbmal-tcejbo-3s
29:dorp-iupparme
34:oidutsrme
34:skoobetonrme
29:etisbew-3s
29:ipa-etucexe
29:kcatslaud.3s
39:etisbew-3s
39:tniopssecca-3s`, `29:tniopssecca-3s
29:yawetag-scitylana
18:ew-ac.3s
24:adbmal-tcejbo-3s
24:dorp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:etisbew-3s
34:spif-3s
39:tniopssecca-3s
34:tniopssecca-3s
24:spif-3s
29:tniopssecca-3s
24:tniopssecca-3s
21:su-3s
24:etisbew-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:dorp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:etisbew-3s
34:spif-3s
39:tniopssecca-3s
34:tniopssecca-3s
24:spif-3s
29:tniopssecca-3s
24:tniopssecca-3s
21:ue-3s
24:etisbew-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:detacerped-3s
25:orp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:etisbew-3s
34:tniopssecca-3s
24:tniopssecca-3s
24:yawetag-scitylana
21:vog-su-3s
28:etisbew-3s
28:spif-3s
27:.3s
28:adbmal-tcejbo-3s
28:dorp-iupparme
33:oidutsrme
33:skoobetonrme
28:etisbew-3s
28:ipa-etucexe
28:kcatslaud.3s
38:etisbew-3s
38:spif-3s
43:tniopssecca-3s
38:tniopssecca-3s
28:spif-3s
33:tniopssecca-3s
28:tniopssecca-3s
14:2-htuos-pa.3s
25:adbmal-tcejbo-3s
25:dorp-iupparme
30:oidutsrme
30:skoobetonrme
25:etisbew-3s
25:ipa-etucexe
25:kcatslaud.3s
35:etisbew-3s
35:tniopssecca-3s
25:tniopssecca-3s
22:ue.3s
25:adbmal-tcejbo-3s
25:dorp-iupparme
30:oidutsrme
30:skoobetonrme
25:etisbew-3s
25:ipa-etucexe
25:kcatslaud.3s
35:etisbew-3s
35:tniopssecca-3s
25:tniopssecca-3s
16:lartnec-ue.3s
27:adbmal-tcejbo-3s
27:dorp-iupparme
32:oidutsrme
32:skoobetonrme
27:etisbew-3s
27:ipa-etucexe
27:kcatslaud.3s
37:etisbew-3s
37:tniopssecca-3s
27:tniopssecca-3s
16:tsae-su-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:detacerped-3s
25:orp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:etisbew-3s
34:spif-3s
39:tniopssecca-3s
34:tniopssecca-3s
24:spif-3s
29:tniopssecca-3s
24:tniopssecca-3s
24:yawetag-scitylana
20:htron-pa-3s`, `28:.3s
29:9duolc-swa.stessa-weivbew
35:.sfv
37:tessa-weivbew
29:adbmal-tcejbo-3s
29:dorp-iupparme
34:oidutsrme
34:skoobetonrme
29:etisbew-3s
29:ipa-etucexe
29:kcatslaud.3s
39:etisbew-3s
39:tniopssecca-3s
29:tniopssecca-3s
29:yawetag-scitylana
22:uos-pa-3s
29:etisbew-3s
28:.3s
29:9duolc-swa.stessa-weivbew
35:.sfv
37:tessa-weivbew
29:adbmal-tcejbo-3s
29:dorp-iupparme
34:oidutsrme
34:skoobetonrme
29:etisbew-3s
29:ipa-etucexe
29:kcatslaud.3s
39:etisbew-3s
39:tniopssecca-3s
29:tniopssecca-3s
29:yawetag-scitylana
18:ew-su-3s
24:etisbew-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:detacerped-3s
25:orp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:etisbew-3s
34:spif-3s
39:tniopssecca-3s
34:tniopssecca-3s
24:spif-3s
29:tniopssecca-3s
24:tniopssecca-3s
24:yawetag-scitylana
21:ue-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:dorp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:tniopssecca-3s
24:tniopssecca-3s
14:3-tsaehtron-pa-3s
28:.3s
29:9duolc-swa.stessa-weivbew
35:.sfv
37:tessa-weivbew
29:adbmal-tcejbo-3s
29:dorp-iupparme
34:oidutsrme
34:skoobetonrme
29:etisbew-3s
29:ipa-etucexe
29:kcatslaud.3s
39:etisbew-3s
39:tniopssecca-3s
29:tniopssecca-3s
22:uos-pa.3s
29:adbmal-tcejbo-3s
29:dorp-iupparme
34:oidutsrme
34:skoobetonrme
29:etisbew-3s
29:ipa-etucexe
29:kcatslaud.3s
39:etisbew-3s
39:tniopssecca-3s
29:tniopssecca-3s
18:ew-ue-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:dorp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:etisbew-3s
34:tniopssecca-3s
24:tniopssecca-3s
15:s
14:4-tsaehtuos-pa.3s
29:adbmal-tcejbo-3s
29:dorp-iupparme
34:oidutsrme
34:skoobetonrme
29:etisbew-3s
29:ipa-etucexe
29:kcatslaud.3s
39:etisbew-3s
39:tniopssecca-3s
29:tniopssecca-3s
14:5-tsaehtuos-pa.3s
29:adbmal-tcejbo-3s
29:detacerped-3s
29:etisbew-3s
29:ipa-etucexe
29:kcatslaud.3s
39:etisbew-3s`, `39:tniopssecca-3s
29:tniopssecca-3s
14:ble.*
14:etupmoc.*
14:labolg-3s.tniopssecca.parm
14:sdr.1-htuos-em.*
26:fa.*
26:pa.*
20:lartnec-ac.*
28:em.*
28:li.*
28:ue.*
28:xm.*
20:tsae-as.*
25:pa.*
25:su.*
25:vog-su.*
24:htron-pa.*
30:su.*
26:uos-pa.*
22:ew-ac.*
25:su.*
25:ue.*
25:vog-su.*
18:2-htuos-pa.*
20:lartnec-ue.*
20:tsae-pa.*
25:su.*
24:htron-pa.*
26:uos-pa.*
22:ew-su.*
25:ue.*
18:3-tsaehtron-pa.*
26:uos-pa.*
22:ew-ue.*
18:4-tsaehtuos-pa.*
18:5-tsaehtuos-pa.*
18:6-tsaehtuos-pa.*
18:7-tsaehtuos-pa.*
14:wolfria.1-htron-ue.*
26:uos-em.*
30:fa.*
30:pa.*
30:ue.*
24:lartnec-ac.*
32:em.*
32:li.*
32:ue.*
24:tsae-as.*
29:pa.*
29:su.*
28:htron-pa.*
30:uos-pa.*
26:ew-ac.*
29:su.*
29:ue.*
22:2-htuos-pa.*
30:ue.*
24:lartnec-ue.*
24:tsae-su.*
28:htron-pa.*
30:uos-pa.*
26:ew-su.*
29:ue.*
22:3-tsaehtron-pa.*
30:uos-pa.*
26:ew-ue.*
22:4-tsaehtuos-pa.*
22:5-tsaehtuos-pa.*
22:7-tsaehtuos-pa.*
5:yasdrocsid
4:tarcomed-a-si
5:c-morf
6:ejorpelbavol
7:tedatad.ecnatsni
15:omed
5:eel-si
8:rebu-si
6:notlacol
5:hgilfhtiwletoh
5:i
6:batym
6:nelp-1al
12:su
12:ue
5:m-morf
5:natnuocca-na-si
6:eduts-a-si
7:gatnegreme.weiverp
9:yolped
7:r-ot-ecaps
7:tnocresuahcom
16:rtul.*
15:buhtig
15:ecapsppa
16:donil.pi
17:ualc
21:.emarf
16:lbavresbo.citats
16:vat
15:iaatem.*
17:o.*
16:ua.*
15:kaerts
15:pl
15:rosruc.*
5:opsedoc
8:golb
8:ppa
11:.r.*
5:sihcrana-a-si
14:na-si
7:laicos-a-si
7:pareht-a-si
7:tra-na-si
7:xetnod
11:seod
6:oh-ecapsbew
8:piym
8:sfn
5:u-morf
6:nyekcoh-asi
5:v-morf
4:u-rof-slles
5:4
5:e
5:oynahtretramssi
5:r`, `6:ug-a-si
8:sndd
4:ved-selucreh
5:n-morf
5:rdlf
5:w-morf
4:weiverp-emas
5:olpwons-yrt
6:zok
4:xbsbf.sppa
5:em
5:inuemoh
5:obdnas-44esab
5:t-morf
5:unilemoh
4:yalerottad
6:p-csbus
6:wetag-llawerif
5:dnacsekil
6:uts-tcejorp.ved
5:fipohsym
5:k-morf
6:niksisnd
5:raidanetah
6:otceridevitcaym
5:ugoo
5:w-morf
5:xalagkeeg
6:orpmapson.duolc
21:.563o
4:zesdrocsid
5:tilbcitats-proc-w
16:ssellaitnederc-w
16:w
3:inu
2:m
2:or
2:tsla
1:p
2:.eman
3:nwo
1:raf
4:etats
1:s
1:t
2:.gro
3:lim
3:moc
5:n
3:oc
3:ten
3:ude
3:vog
1:uesum
2:rof
1:z
2:.ca
3:gro
3:hcs
3:lim
3:moc
3:oc
4:fni
3:ten
3:ude
3:vog
3:zib
0:n315rmi--nx
1:abrud
2:cilbuper
2:f
3:.mkm
2:grompj
2:hkaga
2:m
2:ol
2:ssin
2:uhix
3:qna
2:varac
2:yalo
1:b
2:.gro
3:moc
3:oc
3:ten
3:ude
3:vog
2:c
1:c
2:.ah
3:bh
3:ca
4:s
3:d5xq55--nx
4:g
4:s
4:uolcpanqym
3:edoc-avnac
4:h
4:tisavnac.ym
3:gla0do--nx
4:ro
3:ha
4:q
4:s
5:.sa
3:i7a0oi--nx
4:h
3:jb
4:f
4:shk
4:t
4:x
4:z
3:kh
3:lh
4:im
4:j
3:mn
4:oc
6:.rekamegas.1-htron-nc.koobeton
28:oiduts
19:tsewhtron-nc.koobeton
32:oiduts
7:secivresbewnozama.no.1-htron-nc.ppabew-refsnart
39:wolfria.*
30:tsewhtron-nc.ppabew-refsnart`, `43:wolfria.*
8:wanozama.1-htron-nc.3s
28:adbmal-tcejbo-3s
28:detacerped-3s
29:orp-iupparme
33:oidutsrme
33:skoobetonrme
28:etisbew-3s
28:ipa-etucexe
28:kcatslaud.3s
38:etisbew-3s
38:tniopssecca-3s
28:sdr.*
28:tniopssecca-3s
19:tsewhtron-nc.3s
32:adbmal-tcejbo-3s
32:dorp-iupparme
37:oidutsrme
37:skoobetonrme
32:etisbew-3s
32:ipa-etucexe
32:kcatslaud.3s
42:tniopssecca-3s
32:sdr.*
32:tniopssecca-3s
17:be.1-htron-nc
22:tsewhtron-nc
18:le.*
17:etupmoc.*
17:wolfria.1-htron-nc.*
27:tsewhtron-nc.*
3:nh
4:l
4:s
4:y
3:om
3:qc
3:sg
4:j
4:ppa-avnac
3:tcennockciuq.tcerid
4:en
3:ude
3:vog
3:wt
3:xg
4:j
4:n
4:s
3:zg
4:x
2:b
1:dg
3:.ypnc
2:ka
1:edrag
2:erg
2:fuak
2:hctik
2:ilibommi
3:w
2:m
2:po
2:r
3:ednaalv
2:sier
2:ves
1:g
2:.ca
3:gro
3:moc
3:ten
3:ude
3:vog
2:ised
6:.cihparg
7:ssb
4:irev
1:h
2:.bog
3:gro
3:lim
3:moc
3:ten
3:ude
1:i
2:.ac
3:bew
4:u
3:ca
4:in
3:dni
3:em
4:sabapus
3:g5
4:6
4:p
4:ro
3:ia
4:hled
4:nmula
3:knab
4:u
3:levart
4:im
4:oohcs
3:ma
4:oc
4:rif
3:nc
4:eg
4:if
3:oc
4:fni
4:i
4:rea
5:p
3:pooc
4:u
3:rahib
4:d
4:e
3:sc
4:er
4:nduolc
4:senisub
4:u
4:vedni`, `3:tarajug
4:en
6:retni
4:ni
4:sop
3:ude
3:vog
4:t
3:ysrab
3:zib
2:elknivlac
2:griv
2:ks
2:lreb
6:.sndd
2:p
2:v
2:w
2:x
1:k
2:.gro
3:ten
3:ude
3:vog
1:leok
2:ocnil
1:m
2:.cyn
3:gro
3:ude
3:vog
1:odnol
2:ihsaf
3:no
4:utiderc
3:siv
6:orue
3:tacude
9:.oc
5:dnuof
5:tsyalp
4:cetorp
5:ua
6:rtsnoc
2:kin
2:las
2:mrom
2:nac
2:pq
3:uoc
2:siam
3:pe
3:scire
2:tron
3:sob
2:zama
1:p
2:.gro
3:oc
3:ten
3:ude
3:vog
2:k
1:rec
3:yab
2:op
1:s
2:.gro
3:moc
3:tra
3:ude
3:vinu
4:uog
1:t
2:.dni
4:uolcegnaro
3:gro
3:ltni
3:moc
6:nim
4:siruot
3:nif
3:ofni
4:srep
3:sne
3:tan
4:en
3:vog
2:m
1:uf
3:.pciv
7:y
7:z
4:sm
2:r
3:.arail
9:.nari
5:vnac
4:bdnevar
4:dliub.*
5:uolc
4:edoc.*
5:lbavol
6:deen
5:sabatad.*
5:tirwppa.*
4:lav
7:.bew
5:ecrev
5:per
4:noitargim.*
4:retropno
4:tikcats
5:nempoleved
4:xiw
2:stad
2:xamay
2:y
1:v
2:.alnos
4:ohhnahk
10:t
3:ca
4:ouhphnib
4:uhphniv
3:di
3:eman
4:rtneb`, `4:uh
6:neihtauht
3:gnaboac
6:igah
8:cab
8:na
9:eik
11:t
8:uah
6:nad
6:rtcos
6:uqneyut
5:odmal
6:hpiah
6:lhniv
6:nkad
6:udhnib
8:iah
4:ro
3:hnibaoh
7:gnauq
7:hnin
7:iaht
6:dhnib
7:man
6:mihcohohphnaht
6:ncab
7:gnauq
7:yat
6:tah
6:vart
4:tlaeh
3:ia
5:bney
5:coal
5:gngnauq
5:laig
5:ngnod
4:onah
4:rtgnauq
3:kalkad
3:manah
6:gnauq
4:oc
4:utnok
3:naehgn
5:gnol
5:kcab
5:uhthnib
11:n
4:eibneid
5:ygnuh
6:ugniaht
7:hp
4:osgnal
3:ofni
4:htnac
6:uhp
4:i
4:rp
3:pahtgnod
3:ten
4:ni
3:uahcial
5:mac
5:tgnuv-airab
4:de
4:eilcab
3:vog
3:zib
1:worc
3:t
4:epac
0:o76i4orfy--nx
1:a
2:.bp
3:de
3:go
4:ro
3:oc
3:ti
3:ude
3:vg
4:og
2:boat
1:b
2:.acisum
6:tilop
4:i
5:carcomed
6:neic
5:goloce
9:ncet
5:medaca
6:onoce
5:rtap
7:sudni
5:vilob
4:negidni
5:icidem
4:serpme
4:tsiver
4:vitarepooc
3:bew
4:og
3:dulas
3:erbmon
4:tra
6:oped
8:snart
3:golb
4:ro
3:ikiw
3:lanoicanirulp
8:seforp
5:rutan
4:im
3:moc
3:ofni
4:lbeup
4:rga
4:tneimivom
3:saiciton
3:taskt
4:en
4:ni
3:ude
3:vt`, `2:h
2:iew
2:olg
1:c
2:.apdr.sretsulc.*
9:selrvrs.*
3:drc
5:rac
3:esabapus
11:.egarots
13:mitlaer
3:gro
3:ipym
3:lim
4:per
7:.di
3:moc
5:n
3:osmu
3:pato.*
3:segapdael
8:l
4:ndih
3:ten
4:ilperdellawerif
19:.di
5:mx.*
3:ude
3:vog
2:a
2:e
2:in
2:mara
2:sedarb
3:ic
1:d
2:.bew
4:og
3:dls
3:gro
3:lim
3:moc
3:ten
4:ra
3:ude
3:vog
2:agoba
2:if
2:zd7acbgm--nx
1:ec
2:div
3:or
1:f
2:ni
4:.dlawttim
5:egdelwonk-fo-lerrab
19:lerrab
7:ellocevoli
6:ht-skorg
6:rom-rof-ereh
6:tadpusn
13:d
5:llatiswonk
5:macrvd
5:ofni-v
5:pi-on
7:fles
6:ohbew
5:revres3opyt
11:dlawttim
6:uo-rof
5:siht-skorg
6:nd-cimanyd
8:nyd
8:uolc
5:tsrifyam
5:ysrab
5:zmurof
1:gel
2:n
3:am
3:ib
1:hwsohw
1:i
2:.0pci
7:.war.*
3:1pci
7:.war.*
3:8302
3:aminifed
4:tad-b
3:baltig
4:uhtig
3:citeneek
3:detpyrcs.tneilc
4:raobelgaeb
4:uolcropav
3:ecivedniser
4:donppad.sndnyd
7:repyh
4:egipa
4:lacsnoom.*
5:bbub.ndc
5:ej
4:nilnigol
4:sufxob
4:tibeulb
6:snoehtnap
5:newtu
5:ybeeb.saap
4:varb
8:.s.*
3:gnalkrad
5:igatsniser.secived
6:tsoh-br.etis
10:ytsoh
4:ro
3:kcoregrof.di
4:oobtig
5:rgn
8:.as
9:ni
9:pa
10:j
9:su
9:ua
10:e
4:ramytefasresworb`, `3:lim
3:moc
5:n
4:roftalp-evird
3:naicisum
4:mtsp
8:.kcom
4:yded
3:oc
4:idutsxiw
5:r-no.*
4:toq
3:popilol
4:pa-arusah
6:etybeeb.1dkes
3:rddaym
4:eniatnoceruza.*
5:tsneum-hf
5:vrescisab
9:lautriv
4:ial.sppa
3:s3k-no.*
4:codehtdaer
4:gnihtbew
4:nemeis-om
4:olots.*
4:ppaelbbub
7:olik
7:revelc
4:tacdnas
5:ekcit
3:tekcubtib
5:n
4:ibelet
5:gude
4:netnocresuseebduolc
4:raedon.egats
4:setwolfbew
5:udgniht.cersid.dvreser
20:tsuc
13:dorp.tsuc
13:gnitset.dvreser
21:tsuc
13:ved.dvreser
17:tsuc
3:ude
3:vog
3:wolfbew
3:xbdrym
4:cq
6:.sys.*
4:rotide
3:ysrab
3:zzq
2:b
2:dar
3:ua
4:ts
6:.ia
2:j
2:r
2:syhp
1:j
2:.dhp
3:gne
4:ro
3:hcs
3:ia
4:rga
3:lim
3:mf
4:oc
3:rep
3:ten
3:ude
3:vog
4:t
1:llag
3:o
1:m
2:.gro
3:moc
3:ten
3:ude
3:vog
2:g
2:il
4:.hte.*
2:mi
2:orp
1:n
2:.a0b-ekhgnark--nx
5:c-iehsrgev--nx
5:g-lksedlig--nx
5:k-negnanvk--nx
4:1p-nedragy--nx
5:q-asierrs--nx
7:grebsnt--nx
7:lado-rs--nx
7:negnidl--nx
8:orf-rs--nx
7:regnayh--nx
7:ssofenh--nx
5:r-datsgrt--nx
5:s-ladrjts--nx
5:v-ysenner--nx
8:vrejks--nx
4:3g-datsobegh--nx
4:45-dnaleprj--nx
7:goksnerl--nx
7:tednalyh--nx
5:6-neladnjm--nx
5:s-antouvachb--nx
7:impouvtalm--nx
5:y-agrjnevvad--nx
7:ikhvlaraeb--nx
4:7k-antouvacchb--nx
4:8k-rekie-erv--nx
5:l-ladrua-rs--nx
5:m-darehsdrk--nx
4:a
5:.sg
4:bct-eimeuvejsemn--nx
4:ddo
5:iisevvad
5:leig
6:ov
5:narts`, `5:uas
4:f1-l--nx
7:s--nx
5:2-h--nx
4:g10aq0-ineve--nx
5:av
5:ev
5:lot
5:rajnevvad
9:u
4:h
4:iz-lf--nx
4:jddadab
5:sel
4:kel
5:hojsarak
5:iivagnael
12:g
8:ran
4:lf
5:lahrevo
5:oms
6:s
5:sennev
5:t-ilm--nx
7:tom--nx
5:u-edr--nx
6:s
4:muar
4:n0-tsr--nx
5:2-dob--nx
5:5-asir--nx
7:tals--nx
5:ar
7:-i-om
7:f
7:t
6:t
5:douvsatvid
5:kiv
5:mos
5:nod
5:ra
5:sen
5:taouvatheig
6:ouvacchab
11:hab
10:n
9:iag
9:samo
11:ttvid
5:z-rey--nx
4:op-ladr--nx
7:sens--nx
5:q-nagv--nx
5:r-asns--nx
5:s-kjks--nx
5:v-murb--nx
5:w-anrf--nx
10:t--nx
7:ublk--nx
4:ppol
4:q0-tbaol--nx
8:soum--nx
8:veib--nx
5:x-ipphl--nx
7:rembh--nx
8:imph--nx
5:y-tinks--nx
4:rf-atsr--nx
5:g-anms--nx
9:nd--nx
7:edrf--nx
8:ngs--nx
7:murs--nx
7:netl--nx
7:olmb--nx
7:sorr--nx
5:h-alms--nx
8:yrf--nx
7:emjt--nx
5:i-lboh--nx
7:rsir--nx
7:ydar--nx
9:na--nx
8:ksa--nx
8:lem--nx
8:rul--nx
9:yd--nx
6:stu
5:j-drav--nx
7:rolf--nx
7:sdav--nx
5:kua
5:l-drojf--nx
7:lares--nx
5:m-tlohr--nx
5:n-esans--nx
5:olf
5:p-sdnil--nx
5:s-ladrl--nx
5:tih
5:v-rvsyt--nx
4:sans
6:ons
5:iar
6:erdron
8:ros
5:lag
7:h
5:mor
8:t
5:sir
5:uf
4:tkoulonka
5:la
5:p-raddjb--nx
5:r-agrjnu--nx
5:saeframmah
6:orf
6:ro
5:u-vreiks--nx
4:uh-dnusel--nx
5:i-drojfk--nx
7:vleslm--nx
5:j-ekerom--nx
5:k-rekrem--nx
5:u-dnalr--nx`, `7:goksr--nx
7:sensk--nx
5:v-nekyr--nx
5:w-kabrd--nx
8:ivjg--nx
7:oryso--nx
5:y-ydnas--nx
8:mrak--nx
8:nart--nx
9:nif--nx
8:reva--nx
5:z-smort--nx
4:v
5:.sg
5:ledatskork
5:reiks
4:wh-antouvn--nx
4:x9-dlofts--nx.aoq-relv--nx
5:d-nmaherk--nx
5:f-dnalnks--nx
5:h-neltloh--nx
5:i-drgeppo--nx
5:j-gvegnal--nx
10:lreb--nx
5:m-negnilr--nx
5:n-drojfvk--nx
4:y7-ujdaehal--nx
5:8-antouvig--nx
5:b-dlofrs--nx
7:goksmr--nx
7:kivryr--nx
7:retslj--nx
5:e-nejsom--nx
5:f-yramah--nx
9:edni--nx
10:tso--nx
8:slrak--nx
9:tivk--nx
5:g-regark--nx
5:orf
4:z9-drojfstb--nx
3:b25-akiivagael--nx
4:53ay7-olousech--nx
4:aiy-gv--nx
5:le-tlb--nx
10:s--nx
5:n0-ydr--nx
4:c0-dnal-erdns--nx
5:z-netot-erts--nx
4:gg-regnarav-rs--nx
5:o-nejssendnas--nx
4:ju-erdils-ertsy--nx
4:nj-dnalh-goksrua--nx
4:qq-ladsmor-go-erm--nx.ari-yreh--nx
26:ednas
5:s-neslahsladrjts--nx
3:ca4s-atsaefrmmh--nx
5:8m-dnusynnrb--nx
5:il-tl--nx
5:le-slg--nx
5:n5-rdib--nx
5:op-drgl--nx
5:uw-ynnrb--nx
3:daqx-tggrv--nx
5:reh
8:nnivk
8:sdork
8:uas
5:tsebi
8:kkar
8:llyh
8:nnan
7:gort
7:kalf
8:irderf
7:levev
7:mirg
7:obegah
7:rah
8:ejg
4:barm-jdddb--nx
4:ie
6:rah
6:setivk
7:ladman
4:lofros
7:tsev.ednas
9:o.relav
4:nal-erdnos
11:ron
7:adroh.so
7:dron.ag5-b--nx
13:ri-yreh--nx
12:ob
12:yoreh
7:em
9:lejh
8:proj
8:vi
7:gyb
7:naks
7:oh-goksrua
8:rf
7:ro
8:ua
7:tros
6:rts
9:edevt
10:lab
10:mloh
6:sellil
7:naitsirk
7:rof
5:ul
7:os
6:s
7:dim
8:lejt
7:eguah
8:la
7:kkoh
7:lavk
7:naitsirk
7:raf
8:ege
10:ie
7:tef
7:yonnorb`, `4:rablavs
11:.sg
6:geppo
7:la
5:ojfa
9:dniv
9:k
9:vk
8:die
8:ednas
9:kkelf
8:llins
8:riel
9:ots
8:slab
9:tab
9:yt
7:les
6:ts
4:ureksub.sen
3:eayb-yrettn--nx
4:dar
5:isemmejh321
5:lom
5:rof
4:ggyr
5:nats
5:roneu
4:imeuvejsemaan
9:sekaal
5:rjea
4:jdef
6:oks
5:les
4:keraom
5:hgnaark
5:iregnir
5:kot
8:s
5:sig
6:uaf
4:lbmab
5:kyb
5:lav
6:ehtats
5:oh
4:mit
5:ojt
4:narg
5:gos
5:meh
5:reil
5:te
5:ummok
5:yrb
4:r
5:dils-ertsev
14:yo
5:ua
5:vod
4:saans
4:tleijt
5:robraa
5:spaav
4:urg
3:f62ats-ugsrop--nx
4:a10-ujvrekkhr--nx
5:7k-tajjrv-attm--nx
4:o
5:.sg
5:h
4:s
5:.sg
4:v
5:.sg
3:g5aly-yrn--nx
11:v--nx
4:allor
5:vegnal
7:lreb
4:nav
7:snellu
5:org
4:oksdie
7:mor
7:nerol
7:ro
4:reb
7:adnar
7:edyps
7:sdie
8:elf
8:gnok
8:not
5:obspras
4:uahatsla
3:h0alu-ysm--nx
4:74ay8-akiivagg--nx
5:5ay7-atkoulok--nx
4:a
5:.sg
3:iehsragev
4:khavlaraeb
5:s
4:lma
4:mpouvtalam
4:pphal
4:rrounaddleid
4:ssaneve
3:j0aoq-ysgv--nx
4:94bawh-akhojrk--nx
3:kabord
5:jks
5:lleis
4:iv
6:aklejps
6:lam
7:evs
7:u
6:mag
6:nel
6:ojg
6:ral
8:n
7:epok
7:iel
7:yor
6:sah`, `7:kel
4:kabene
4:ojsarak
4:ramdeh.aoq-relv--nx
11:relav
11:so
7:elet.ag5-b--nx
12:ob
8:ra
3:la
5:danrus
6:dnumurb
7:ron
6:egnard
7:ndua
8:te
7:smeh
8:sin
7:ttin
6:gis
7:nyl
6:kro
6:lem
7:lejfttah
8:of
7:uag-ertdim
8:s
6:nam
7:era
7:gos
7:ib
8:nroh
8:r
7:kos
7:nus
7:oj
6:o-dron
8:ros
6:ppo
6:ra
8:l
8:nram
7:egne
8:l
8:v
7:is
7:ojts
8:ts
7:ua-dron
10:ros
8:h
6:sejg
8:nivk
8:ryf
7:kav
7:mor-go-erom.ednas
19:yoreh
7:uag
6:tlas
7:rajh
7:suan
6:vla
8:e-rots
7:u-go-eron
6:yt
5:ksedlig
5:resa
4:bibeklof
7:seklyf
4:es
6:dah
4:h
5:.sg
4:im
5:syrt
4:lejf
5:ovetsua
7:gnit
7:ksa
7:sdie
4:n
5:.sg
4:o
5:.sg
5:boh
5:g
5:h
4:r
5:.sg
3:marah
5:vk
4:f
5:.sg
4:h
5:.sg
4:iehdnort
7:rtsua
7:ssej
6:rkrejb
5:ksa
4:ol
4:t
5:.sg
4:udom
5:esum
5:rab
6:drejg
6:evle
6:os
6:uh
5:ttals
3:nagav
6:okssman
5:jlis
5:khous
5:or
5:rg
6:rev
4:eddosen
8:ton
6:lah
6:ragyo
7:ojfsam
5:giets
6:nalas
9:lab
8:navk
8:targ`, `9:ddosen
8:val
9:essov
7:idol
8:lar
7:yl
6:reb
5:iks
5:ksrot
6:yor
5:ladgnos
8:ner
9:ojm
8:om
7:tloh
6:ug
5:mmard
5:ojsom
8:sendnas
5:ppolg
5:slahsladrojts
6:o
5:tol
7:t-ertsev
13:o
6:roh
5:vlykkys
8:nav
5:yam-naj
12:.sg
4:gorf
5:ujb
4:idnaort
5:etslu
5:vnarg
4:kob
4:maherka
4:nit
5:urgsrop
4:orf-dron
8:ros
4:raieb
5:evats
4:sfev
4:uaks
4:yrts
3:o6axi-ygvtsev--nx
4:c
4:dob
5:rav
4:ievs
4:kssouf
4:lmob
5:ousadna
8:echac
5:so
7:.sg
4:msdeks
4:niekotuak
4:regark
5:olf
5:yoso
4:sdav
5:mort
3:ped
4:ohsdaerpsym
4:pakdron
5:elk
3:raddjab
6:iab
5:jtif
5:luag
5:mah
5:vsyt
4:egnakiel
9:ro
8:merb
8:nat
9:mas
8:rav-ros
8:srop
8:talf
8:vats
9:el
8:yoh
7:ivsgnok
5:il
5:jkniets
5:kanvej
7:rem
7:sgnir
8:nellu
6:ie-erden
11:vo
6:ram
6:sa
5:lajf
7:vh
5:mbah
6:mahellil
5:nnul
5:tsloj
7:ul
5:yo
4:impah
4:m
5:.sg
4:osir
4:t
5:.sg
3:sadnil
4:endnas
6:edga
7:krib
10:k
8:som
7:ve
6:meh
8:jg
6:nroh-go-ejve
6:sa
7:ednil
7:ko
7:of
7:yt
6:tsev
4:gv
4:hf`, `4:igaval
4:oror
5:sman
4:sofenoh
6:m
6:v
4:uhlem
6:sreka.sen
3:tabaol
5:gaov
6:grav
5:jjrav-attam
5:lab
7:s
5:soum
5:ts
5:veib
6:our
4:ednalyoh
5:f
5:snyt
6:rokomsdeks
6:sen
5:vtpiks
4:inaks
4:lohar
4:n
5:.sg
4:oma
4:s
5:.sg
5:efremmah
5:or
4:terdi
3:ub
5:.sg
5:alk
5:edna
6:gnir
6:nner
5:les
4:drab
7:eb
4:gnasrop
5:vi
4:jdaehala
5:jedub
5:varekkhar
4:ksiouf
4:ndiaegadvoug
5:taed
3:virp
4:leslam
3:ybessen
5:nart
5:sebel
5:tsev
4:odar
6:na
8:s
6:or
5:gavtsev
5:ksa
5:lem
5:mrak
5:nart
6:nif
7:orb
5:ramah
7:n
7:v
6:edni
7:tso
8:ton
7:va
6:ul
6:yd
5:sam
6:enner
6:gav
6:lrak
6:tivk
5:vrejks
2:aki
2:isac
3:tal
2:u
1:ob
2:f
2:hay
2:o
2:ttat
1:r
2:.cer
3:erots
3:gro
3:moc
5:n
4:rif
4:t
3:oc
4:fni
3:pohs
3:stra
3:tn
3:www
3:ysrab
2:ea
4:.aac
6:cgd
6:idem
5:bulc
9:orea
5:ciffartria
7:taborea
5:ecalptekram
7:nallievrus-ria
10:ubma
9:netniam
9:rusni
8:erefnoc
6:gnahcxe
6:mordorea
6:nigne
8:lria
8:zagam
6:rawtfos
5:gnidart`, `9:ilg
12:arap
12:gnah
8:ldnahdnuorg
9:ledom
8:noollab
8:retac
8:sael
8:tlusnoc
9:uhcarap
8:vidyks
5:hcraeser
5:ixat
5:lanruoj
6:euf
6:icnuoc
6:ortnoc
12:-ciffart-ria
5:ngised
6:oinu
8:tacifitrec
10:ercer
10:gitsevni-tnedicca
12:van
10:icossa
16:-regnessap
11:valivic
10:redef
9:cudorp
9:neverp-tnedicca
5:ograc
5:pihsnoipmahc
6:uorg
10:gnikrow
5:redart
7:enigne
7:korb
7:niart
7:trahc
6:ohtua
7:tacude
5:scitsigol
6:ecivres
7:r
6:krow
6:serp
10:xe
6:tnega
5:tfarcria
11:otor
6:hgierf
9:lf
10:orcim
6:liubemoh
6:natlusnoc
7:eduts
8:mniatretne
10:revog
9:piuqe
6:olip
6:ropria
6:silanruoj
8:tneics
5:werc
6:ohs
5:ycnegreme
6:dobper
6:tefas
3:rref
3:z
2:p
3:.aaa
5:ca
5:pc
4:citeneek
4:dem
4:gne
4:korgn
4:rab
5:uj
4:snduolc
4:tacova
5:cca
5:hcer
4:wal
4:ysrab
1:s
2:.em
3:gro
3:moc
3:syevrus
3:ten
3:ude
3:vog
1:t
2:.0x
3:116
3:ayo
3:gro
3:lim
3:moc
3:sulpnpv
3:tcennockciuq.tcerid
4:en
4:ten
3:ude
3:vog
2:ohp
3:m
3:v
3:yk
2:tol
2:ua
1:viv
2:lov
1:xas
1:ykot
0:paehc
2:g
2:m
2:s
1:eej
1:g
2:.gro
3:ibom
3:moc
3:ossa
3:ten`, `3:ude
1:ir
3:.nalc
2:v
3:.sndih
2:z
1:j
2:.0g0
4:j0
4:o0o
4:t0
3:a35xq6f--nx
5:xqi0ostn--nx
4:5wtb6--nx
4:85uwuu--nx
4:9xtlk--nx
4:ad
4:bats
5:ihc
8:.abihciakoy
10:don
10:mahim
12:yeragan
14:tat
10:rabom
12:gan
12:hihci
11:uagedos
12:kas
12:ustak
10:sos
11:ufomihs
10:tamihcay
11:iran
10:wagimanah
15:o
13:omak
12:kihci
12:zustum
11:ihsak
10:yagamak
11:imonihci
9:eakas
10:nagot
9:iazni
10:esohc
10:hasa
11:sabanuf
12:ohc
10:kato
12:zok
10:musi
10:orihs
10:rakihabihsokoy
11:odim
12:tak
11:ukujuk
10:usihs
9:nanohc
13:yk
9:odiakustoy
11:ustam
10:hsonhot
10:karihs
12:t
11:iba
10:nihsaran
10:sobimanim
10:tasarihsimao
13:imot
10:uhc
10:yihcay
9:ukujno
10:sayaru
11:timik
12:tuf
10:zarasik
4:ccah
5:ed
4:gas
7:.agas
9:matamah
11:yik
10:ihsak
9:rat
9:tagatik
11:hatik
10:ira
13:ihsin
8:ekaira
9:nimimak
8:iakneg
9:garuyk
10:o
9:hcamo
11:uo
10:siorihs
9:kaznak
9:modukuf
9:ragonihsoy
11:mi
8:nezih
8:ukat
10:ohuok
9:sot
10:tarak
5:ihs
8:.akok
10:mahagan
12:yirom
11:ihsakat
10:rabiam
10:wagoton
9:emiharot
10:nokih
9:houyr
9:iazaihsin
10:esok
10:kustakat
10:moihsagih
9:namihcahimo
11:nok
9:ohsia
10:mag
10:tasoyot
11:ok
11:tir
9:usay`, `11:tasuk
12:o
4:kaso
8:.adawihsik
11:eki
10:kanoyot
12:sakaayahihc
13:oihsagih
11:oadat
11:uziak
10:mayas
15:akaso
11:odak
10:rabustam
12:wihsak
11:ediijuf
10:takarih
11:ik
12:us
10:wagayen
13:odoyihsagih
9:eson
10:tawanojihs
9:honim
9:iakas
10:hcugirom
11:sayabadnot
12:iakat
14:t
13:n
12:oyimusihsagih
10:karabi
12:sim
11:ustakat
10:muzi
10:rijat
11:otamuk
9:nanak
12:nah
13:es
9:oay
10:naganihcawak
12:simuzi
12:tak
11:eba
11:ikibah
11:oyot
10:tanim
11:iad
11:omamihs
10:uhc
9:ustoimuzi
12:tes
5:oukuf
10:.adamay
13:eos
12:gno
13:ok
13:usak
12:hiku
12:kawayim
13:uzii
12:makan
14:yasih
15:im
12:rawak
12:tagon
14:kah
16:num
16:t
13:umo
12:wagakan
16:nay
16:t
15:ias
14:ko
16:rih
12:yihsa
13:usak
11:emay
13:uruk
12:taruk
12:us
11:ianohs
13:raihcat
12:goruk
12:hcukuf
13:sagih
15:hukuy
14:in
12:kagako
14:muzim
13:iust
13:o
13:ustani
12:manim
13:otihsoynihs
13:u
12:rogo
13:ugasas
12:usu
11:nesiek
13:zub
15:kihc
11:ogukihc
12:hak
13:ot
13:ukihc
12:jono
13:ukihc
12:kayim
12:nihsukihc
12:to
12:uhc
11:ufiazad
12:gnihs
12:stoyot
7:zihs
11:.abmetog
13:damihs
14:eijuf
14:ihsoy
14:omihs
13:kouzihs
13:mihsim
13:rabiah
15:honikam
13:tawi`, `13:wagekak
16:ukik
15:kijuf
13:yimonijuf
12:iara
14:sok
13:hcamirom
13:juf
13:kazeamo
16:ustam
13:mannak
15:ta
13:nukonuzi
13:orukuf
12:nohenawak
12:onosus
13:ti
12:ustamamah
13:zamun
15:wak
14:i
15:ay
15:ihsagih
18:in
16:manim
15:mihs
4:mahokoy.*
12:ytic!
6:tias
10:.adihsoy
13:ot
13:usah
12:kadih
14:sa
13:oarihs
14:s
12:matias
14:yas
15:orom
16:tah
15:ustamihsagih
13:ihsagurust
14:jawak
13:uri
12:ni
12:wageko
16:man
15:ikot
15:o
14:kara
15:ihsoy
16:mak
14:ru
14:zorokot
12:yagamuk
15:ihsok
15:otah
14:kuf
13:imo
12:ziin
11:ebakusak
12:ogawak
12:sogo
12:ttas
12:zokoy
11:ibaraw
12:hcugawak
13:soyim
14:ubustam
12:iroy
12:kato
13:ihs
13:uk
14:stawi
12:makoyr
13:ihsoy
14:juf
13:uziimak
11:naznar
11:odakas
12:ihsay
12:jnoh
12:nago
14:nim
13:imijuf
13:nah
13:oy
12:rihsayim
13:otagan
12:tasim
17:ak
13:igus
13:omatik
12:zak
11:ubihcihc
19:ihsagih
12:sonuok
12:ynah
6:yakaw
11:.adira
14:notimak
13:kadih
13:maharihs
16:im
15:yakaw
17:tik
16:oduk
13:ruustakihcan
15:y
13:sauy
13:wagadira
17:zok
16:orih
15:konik
13:yok
13:zok
12:ebanat
13:dawi
12:igarustak
13:jiat
13:mani
12:naniak
12:obog
13:nimik
13:tasim
14:omihsah
19:uk
12:ugnihs`, `9:o
10:.ajos
12:koasak
12:mayako
15:ust
13:ihsayah
12:rabi
13:ukawaihsin
12:wiaka
14:nam
11:egakay
12:kaw
11:igan
12:hcukasa
15:otes
13:sahakat
12:kasim
13:ihsaruk
12:miin
11:nanemuk
12:ezib
11:ohsotas
12:jnihs
12:namat
13:imagak
12:ohs
12:uhcibik
7:ot
9:.adamay
11:got
11:koakat
11:mayetat
14:ot
11:nahoj
11:riat
11:wakiinakan
15:reman
10:ebayo
12:oruk
10:ihasa
12:ciimak
12:sahanuf
11:kuzanu
11:mani
14:ot
12:ih
10:nezuyn
10:otnan
10:uhcuf
11:stimukuf
11:zimi
12:ou
5:ihsogak
12:.amayuok
15:ihsogak
14:si
14:yonak
13:ebanawak
14:natakan
17:imanim
15:uka
14:tomoonihsin
13:iadnesamustas
14:kazarukam
15:oih
14:mama
15:uzi
14:usuy
13:nesi
13:oknik
14:os
14:tomustam
13:uzimurat
9:rih
12:.akan
16:s
14:mayukuf
15:ihsorihihsagih
16:jate
17:imakikaso
14:rabohs
16:hekat
17:im
15:es
14:tiak
14:wiad
13:ekato
14:ruk
13:ihciakustah
17:mono
17:nihs
15:sinares
16:oyim
14:manimasa
14:uk
13:negokikesnij
13:ognoh
14:namuk
13:uhcuf
8:ukot
12:.abihci
14:mihsukot
19:stamok
16:m
14:wagakan
13:egihsustam
13:igum
14:hcoganas
15:soyim
14:kijaw
14:manim
15:uzia
14:ukihsihs
13:nana
16:iak
13:onati
14:turan
10:uf
12:.abatuf
14:mato
16:yenak
17:irok
15:ihsim
18:ukuf
15:os
15:uko
14:raboihsatik
15:uganat`, `14:takatik
16:mawak
16:rih
14:wagakus
17:emas
17:uy
16:kamat
18:rihs
18:sa
17:ihsi
16:nah
15:ohs
13:egnabuzia
14:iman
14:tad
16:tii
13:iadnab
14:enet
14:hsagih
16:iimagak
14:kawi
16:zimuzi
15:ubay
14:minuk
14:rook
15:ustamay
13:nihsiat
13:ogetomo
15:ihsin
15:nan
15:omihs
14:no
16:duruf
16:rih
14:rihsawani
14:tamay
16:simuzia
13:urahim
14:stamakawuzia
14:ziaihsin
17:nay
5:nug
8:.abawak
10:doyihc
10:kanna
11:oihsoy
13:juf
13:mot
10:mayakat
11:ustagaihsagih
10:nihsatak
11:nak
10:rahonagan
11:nak
11:o
11:ukati
12:mamat
10:tamun
11:inomihs
11:o
10:wakubihs
11:iem
11:ohs
9:ihsabeam
13:yabetat
10:kasakat
13:esi
10:makanim
11:uzio
10:ogamust
10:rodim
9:ojonakan
10:neu
11:oyikust
10:tnihs
9:ukomnan
10:stasuk
10:yrik
5:rep
4:nibmab
5:nog
5:ob
4:ppacihc
4:ran
7:.abihsak
9:dakatotamay
10:u
11:o
9:guraki
9:mayatikimak
16:omihs
12:irokotamay
10:oki
9:rahihsak
11:n
9:wageson
11:knet
8:ekayim
9:ozamay
9:sog
9:ustim
8:iarukas
10:wak
9:garustak
9:hciomihs
10:sinawak
9:jo
9:kamnak
11:toruk
9:makawak
9:nos
9:rnet
10:otakat
10:ugeh
8:odna
10:oyo
9:gnas
9:jnihs
9:nihsoy
15:ihsagih
9:tomarawat
9:yrok
6:rikik
4:tagamay
11:.adihsio
13:katarihs
14:ourust
13:mayakan`, `17:rum
16:enak
16:onimak
13:rukho
13:tagamay
17:nuf
15:hakat
15:kas
13:wagekas
16:orumam
15:kihsin
17:m
15:zanabo
16:enoy
16:ot
13:zuy
12:eagas
13:bonamay
13:dii
13:nihsagih
13:o
12:iagan
14:nohs
13:hasa
14:sinawak
13:nugo
12:odnet
13:jnihs
13:ynan
12:ukohak
7:iin
10:.aga
12:kium
13:oagan
12:munou
17:imanim
12:tabihs
14:giin
13:ioy
12:wagioti
14:kikes
14:zuy
13:irak
12:yijo
11:ekustim
12:mabust
11:ianiat
12:hcamakot
12:kazawihsak
15:omuzi
12:magat
14:karum
13:o
11:nanust
12:esog
11:odas
12:ihcot
12:jnas
12:kihay
13:oym
12:mak
12:naga
12:ries
11:uories
12:steoj
5:ika
8:.ago
10:kasok
11:oimak
10:tago
14:rihcah
11:ika
14:atik
10:waki
11:oyk
9:emojog
10:natim
10:suranihsagih
10:tado
11:okoy
9:ihsoyirom
10:magatak
10:naokimak
9:nesiad
9:ohakin
10:jnoh
14:iruy
10:nuzak
10:rihson
10:tasijuf
14:m
10:yjnoh
9:ukobmes
10:oppah
7:in
6:o
7:.adakatognub
9:masah
10:ihsemih
9:su
9:tekat
10:ih
11:o
8:eonokok
9:ustimak
8:ijih
9:kasinuk
10:ias
10:usu
9:mukust
8:onoognub
8:ufuy
9:juk
9:ppeb
9:suk
5:nayn
4:wagak
9:.amihsoan
11:rihotok
11:wagakihsagih
15:ya
10:emaguram
10:ijnonak
12:ustnez
11:kunas
11:monihcu
10:ohsonot
11:nnam`, `11:yotim
10:ustamakat
13:odat
11:zatu
8:nak
11:.adustam
13:kusokoy
16:tarih
13:maz
13:nibe
13:ragihsaimanim
15:hesi
16:imagas
15:wado
17:guy
14:uim
15:kamak
13:tikamay
13:wakia
16:oyik
16:umas
15:sijuf
13:yimonin
12:enokah
13:saya
12:iakan
13:esiak
13:gusta
13:hsuz
13:kasagihc
13:o
13:ukust
12:onadah
13:sio
13:tamay
6:kihsi
11:.adanihcu
13:gak
13:kihs
13:mijaw
13:tabust
14:ikawak
13:wazanak
12:igurust
13:hcionon
13:mon
13:ukah
12:nasukah
12:oanan
13:ton
16:akan
12:ukohak
13:stamok
13:zimana
14:us
6:niko
10:.ahan
12:marat
13:ijemuk
13:uru
12:nedak
14:zi
13:no
12:rahihsin
14:rih
12:wakihsi
14:niko
12:yehi
12:zonig
11:eosaru
12:seay
11:ihsagih
12:jomihs
12:kagihsi
14:not
13:ihsakot
12:maginuk
14:kihsug
14:maz
13:igo
13:otekat
12:nuga
16:noy
11:namoti
13:timoy
13:wonig
12:ijikan
13:k
11:ogan
12:jnan
12:tiadatik
16:imanim
11:ubotom
12:kusugakan
21:atik
17:imot
12:rabanoy
15:eah
4:yogan.*
10:ytic!
5:p
4:zomim
3:bus
3:c204ugv--nx
4:462a0t7--nx
4:678z7vq5d--nx
4:94ptr5--nx
4:a
4:mpopilol
3:d-2
4:17sql1--nx
4:3thr--nx
4:520xbz--nx
5:40sj5--nx
4:787tlk--nx
5:ptlk--nx
4:861ti4--nx
4:a
4:e
5:tfarcdnah
4:neirflrig
9:yob
5:om
4:ooftac
3:e16thr--nx
4:51a4m2--nx
5:9ny7k--nx
4:bok.*`, `8:ytic!
4:damydaer
4:eweep
4:garotsarukas.10ksi.3s
17:20ksi.3s
4:ibmoz
5:m
6:.abot
8:kasustam
9:uzus
8:mahim
10:yemak
11:im
9:ihs
8:nawuk
8:wiem
10:k
7:ebani
8:ogawak
8:si
10:imanim
7:iarataw
8:gusim
8:hasa
9:ciakkoy
8:kamat
10:sosik
10:t
9:iat
8:raban
7:odat
8:hik
8:namuk
9:ihseru
9:odu
10:mok
7:ust
4:kilbew
4:lasrepus
4:mihe
8:.amahataway
13:iin
12:yustam
11:ijawu
13:imak
10:taki
14:man
9:ebot
9:ianoh
10:kasam
10:rabami
9:nania
10:egokamuk
10:oot
9:ojias
10:kihcu
10:nustam
10:uhcukokihs
10:yi
12:es
9:ukohik
10:zo
4:n
5:.arukas
6:lapo
6:nerukom
7:riheg
6:omomus
6:stnim
6:teniesa.resu
6:xob-liam
6:yrovi
6:zapot
5:amihs
10:.adamah
13:ho
13:usam
12:kustay
12:ma
13:ihsonihsin
19:ko
12:wakih
11:enamihs
12:ustam
11:igaka
13:usay
12:konikak
12:mikih
11:nannu
11:omukay
14:zi
16:ihsagih
16:uko
12:nawust
12:tasim
11:ustog
12:yamat
5:nep
4:rotsnoihsaf
4:srev
4:tawi
8:.abahay
10:damay
11:on
10:koirom
10:tahonat
12:katnezukir
11:imus
10:wasijuf
13:uzim
11:ihs
9:ehonihci
14:n
13:uk
10:tawi
9:iaduf
11:murak
11:wak
10:hcusto
11:siamak
13:ukuzihs
10:joboj
11:uk
10:kamanah
13:uzuk
12:sagenak
11:esonihci
10:makatik`, `11:uziarih
15:wi
9:okayim
10:norih
12:t
10:tanufo
9:uhso
5:isarap
5:saman
5:tococ
4:ulbybab
3:g3zsiu--nx
4:71qstn--nx
4:jw
4:l
4:olbanetah
7:looc
3:h03pv23--nx
4:13ynr--nx
4:22tsiu--nx
4:61qqle--nx
4:o-hu
4:sulb
3:i54urkm--nx
4:adnes.*
10:ytic!
5:zosbew
4:ced
4:gayim
9:.adukak
11:magoihs
13:kihs
12:ihsustam
20:ihsagih
12:unawi
11:rawago
12:iho
11:tabihs
13:rum
11:wagano
13:kuruf
12:iat
11:yimot
12:ukaw
10:emot
11:nimes
10:ihsiorihs
11:kamonihsi
13:sawak
14:o
11:mak
11:rataw
12:omuram
13:tan
10:oaz
11:jagat
11:tasim
12:omamay
10:ufir
11:kirnasimanim
12:uhsakihcihs
5:ihcot
10:.agah
14:kihsa
13:ust
12:kom
12:mayo
15:usarak
13:unak
12:raboihsusan
14:watho
13:iho
13:ukas
12:takihsin
13:iay
12:wakonimak
14:zenakat
12:yimonustu
13:oihs
11:eiiju
12:kustomihs
12:nufawi
11:iakihci
12:getom
13:ihcot
13:on
11:okihsam
13:kin
12:nas
12:sioruk
12:tab
11:ubim
12:san
4:hcia
8:.adnah
10:ma
12:hakat
13:im
12:yuni
11:ihsibot
14:ust
10:rahat
12:tihs
11:ik
11:uihsagih
12:kawi
10:tihc
11:ok
12:yot
10:wakoyot
12:zani
10:yimonihci
12:rak
9:einak
10:kaoyot
11:usa
10:manokot
10:noyot
9:iagusak
11:kot
11:sia
10:eot
10:hasairawo
11:cugo
11:sahoyot
12:oyim
10:kamok
12:zako`, `11:ihssi
10:motay
10:rogamag
9:nanikeh
12:ok
10:ihssin
9:ogot
10:ihsin
10:jna
10:rihsnihs
10:suf
10:tes
9:ubo
10:raho
10:soyik
11:takihs
10:yrihc
10:zah
6:ok
8:.adusay
10:kadih
10:mayotom
10:rahim
13:usuy
11:umakan
10:sot
13:ihsin
10:wagatik
13:odoyin
12:kas
13:o
9:iesieg
10:hco
13:k
10:jamu
10:ka
12:sus
11:usto
10:magak
12:k
10:rahan
9:omukus
10:ni
11:ust
14:ihsagih
10:torum
10:yot
13:o
9:ukoknan
10:zimihsasot
6:ugamay
12:.amayukot
15:ihso
14:toyot
13:ebu
14:subat
13:igah
14:kesonomihs
14:nukawi
14:rakih
13:nanuhs
13:otagan
13:uba
14:foh
14:otim
14:stamaduk
14:uy
5:sanamay
12:.adihsoyijuf
14:mayabat
14:rahoneu
15:ustakihsin
14:wakayah
17:ijuf
16:suran
15:ohs
13:egusok
13:iak
14:hcimakan
15:sanamay
16:od
14:kasarin
15:ufeuf
16:sto
13:okakanamay
15:ihcugawakijuf
14:nihso
14:tasimawakihci
15:ukoh
14:uhc
13:spla-imanim
13:ubnan
15:onim
14:fok
14:hsok
14:rust
6:ubon
4:ix
4:karabi
10:.abukust
12:gok
12:kan
15:ihcatih
12:masak
14:timo
14:wi
13:ihsak
13:ustomihs
12:ni
12:rahihcu
14:way
13:uagimusak
14:ihcust
12:tagamay
15:eman
13:oihcatih
12:wagarukas
15:o
13:os
12:yimoihcatih
14:rom
11:ebomot
12:dirot
12:not
12:tadomihs
11:iakas
14:ot
13:rao`, `12:esukihc
12:gahakat
12:hasa
13:catih
12:karabi
14:saguyr
13:ihsani
13:uy
12:ma
12:rukustamat
11:odnab
12:giad
12:him
12:kati
12:rihsijuf
12:soj
12:tasorihs
13:im
12:yihcay
11:ufius
12:kihsu
12:simak
6:sagan
11:.amabo
14:ihsust
13:natawak
13:rabamihs
14:umo
15:ustam
13:wijihc
13:yahasi
12:iakias
13:hies
13:kasagan
14:i
13:masah
12:neznu
12:obesas
13:darih
13:teso
14:og
16:imaknihs
12:ustigot
15:onihcuk
15:uf
8:wak.*
12:ytic!
6:zayim
11:.abiihs
13:guyh
13:koebon
14:ustorom
13:mihsuk
13:remihsin
14:uatik
13:takatik
15:mim
13:wagatik
16:odak
13:ya
12:ebanakat
13:sakog
12:ihsayabok
13:kazakat
17:yim
13:manimawak
14:otinuk
16:nihs
12:nanihcin
12:ojik
14:onokayim
13:nibe
14:ust
13:tias
12:urahakat
4:rocep
6:moa
9:.adawot
11:turust
11:wasim
10:ehonihcah
17:ihs
14:nas
14:og
14:ukor
11:sario
10:ianarih
11:ganayati
11:hsioruk
11:jehon
11:kasorih
11:makihsah
11:nawo
11:ramodakan
12:omoa
10:ognihs
11:kkat
10:uragust
11:stum
6:ttot
10:.arahawak
13:uotok
12:sakaw
14:sim
11:egok
11:irottot
11:nanihcin
11:oganoy
12:nih
12:tanimiakas
11:ubnan
12:zay
13:ihc
4:ukuf
8:.adeki
10:gurust
10:mabo
12:hakat
13:im
12:yustak
10:sakaw
9:eabas
9:iakas
10:ho
10:jiehie
10:ukuf
9:nezihce
16:imanim`, `9:ono
3:k26rtl8--nx
4:43qtr5--nx
5:ytjd--nx
4:522tin--nx
4:797ti4--nx
4:cigid
6:ht
6:sevol
4:ee
4:limybab
4:nat
5:upatilol
3:l33ussp--nx
4:eccabew.resu
12:sr
5:llarap
4:lik
4:oof
4:rigetuc
3:m11tqqq--nx
4:41s3c--nx
4:a0
4:ef
4:sioge
3:n30sql1--nx
4:65zqhe--nx
4:aebyllej
5:ilognom
6:viv
4:iam
4:n7p7qrt0--nx
4:oolas
6:mflah
5:ruk
5:staw
3:o131rot--nx
4:7qrbk--nx
4:aic
4:c
4:diakkoh
11:.adeki
13:gakihset
13:hcebihs
13:kadih
14:ufib
15:narihs
13:mayiruk
14:hot
14:ihsorihatik
17:ukuf
14:oras
14:usta
13:riba
17:ka
16:o
16:uruf
14:ozo
14:ugakihsagih
15:oyot
13:sakim
13:tagikust
15:mun
13:wagakan
18:uf
17:nus
20:imak
15:karu
16:ihasa
18:sagih
17:kat
17:mak
16:omihs
16:um
15:zimawi
14:ine
14:oyk
13:yot
12:eamustam
14:nan
13:bakihs
15:yak
14:onoroh
15:to
13:ian
13:kihsam
14:ufoto
13:nakami
13:ppoko
18:ihsin
13:sotihc
13:tad
16:okah
13:uonikat
12:iabib
14:mokamot
14:nakkaw
17:oroh
16:wi
15:eomak
15:ihsatu
15:okik
15:ustamoruk
19:sakan
13:eib
13:hcioy
15:ubmek
16:irihs
14:sase
15:ekka
15:oknar
15:uesom
13:jufirihsir
13:kamamihs
14:iat
15:n
13:matik
14:otoyot
13:oakihs
15:rihs
13:rahs
15:kihsi
15:mot
14:ihsaba
17:ir
14:otarib
12:nahctuk
14:rorum`, `14:se
14:tokahs
13:uber
12:okayot
13:mire
14:ukay
13:naruf
18:imak
21:nim
13:orih
13:rihibo
16:suk
14:obah
15:hib
17:hsimak
16:sa
15:pnan
15:yan
14:umen
13:tasoyik
14:eko
14:ukoh
12:ubassa
13:kotnihs
13:massaw
14:uo
13:ppakiin
15:enioto
17:nuk
15:ip
13:rato
13:sakat
14:tebe
17:ia
18:hs
20:a
18:robon
17:me
18:om
19:takan
17:noh
19:tamah
17:omik
18:s
18:t
17:ukir
18:ppihc
18:st
15:onihsnihs
15:ufuras
14:uaru
13:yru
16:koh
13:zimihs
19:ok
5:nu
4:g
5:iti
5:oyh
8:.abmat
10:dnas
10:gusak
10:kat
11:ooyot
12:y
11:uzarakat
10:mayasas
11:irah
10:wagani
13:okak
12:kihci
14:mak
13:oy
10:yihsa
12:monihsin
9:iasak
10:hsaka
12:iat
13:nawak
10:jawa
14:imanim
11:emih
10:kagoa
12:sagama
13:ukuf
12:wihsin
11:ihsog
12:m
10:mati
10:oia
10:rogimak
9:nannas
10:esnonihs
9:ogasa
14:kat
10:ka
10:nikat
11:o
11:ustat
10:rihsay
10:sihs
10:tomus
10:yas
9:ubay
10:gnihs
4:hih
4:konip
4:lbetah
6:s
5:ik
4:mol
4:nagan
9:.abukah
11:daw
13:yim
12:eki
13:u
12:ii
11:kasay
14:uki
13:zus
12:ihsoo
12:ousay
11:mayakat
14:ii
12:ihsukufosik
13:jii
12:ukihc`, `11:ni
13:hsetat
12:uzii
11:rah
12:ugot
11:saim
11:tagamay
12:oyim
11:wagakan
15:n
14:o
13:kustam
13:ziurak
12:onim
16:imanim
12:ukoo
13:s
14:omihs
11:yako
13:rih
10:eakas
11:nagamok
11:subo
10:igakat
11:hasa
12:ca
14:mo
16:nanihs
13:uonamay
12:sukagot
11:kakas
13:mimanim
13:to
12:iaatik
14:imanim
12:oa
12:uzihcom
11:makawak
12:ijuf
12:o
13:t
11:rato
12:ijoihs
12:omakat
10:nana
11:esnoawazon
10:ohukas
11:nagan
13:kan
12:ihc
13:muza
12:ustat
11:romok
11:sigan
13:k
11:tomustam
10:ukas
12:ohukihc
11:stamega
4:ob
5:m
5:pac
4:roppas.*
11:ytic!
4:tomamuk
11:.agamay
13:rahihsin
13:sukama
19:imak
13:tamanim
12:enufim
12:ihcukik
13:kihsam
14:u
13:nugo
17:imanim
13:romakat
12:oara
13:rihsustay
13:sa
13:tamay
14:omamuk
16:us
14:u
15:koyg
13:yohc
12:usagan
13:zo
6:yk
8:.abmatoyk
10:kies
11:oemak
11:uzaw
10:mayihcukuf
15:sagih
14:muk
10:nihsamay
10:rawatiju
10:taway
11:ik
9:ebanat
15:oyk
12:ya
10:di
10:ni
9:iju
10:kazamayo
10:manim
9:natnan
9:ognatoyk
10:kum
10:mak
10:rihsamayimanim
10:ygakan
11:kakoagan
13:s
11:oj
9:uruziam
10:zayim
11:ik
4:wtc1--nx
4:ykot
8:.adihcam
12:mus
11:oyihc
10:katim
11:ihsustak
10:mat`, `13:uko
12:yarumihsagih
21:sum
11:ihsagoa
14:ika
14:o
15:t
14:uzuok
12:ren
10:rahonih
12:wasago
11:iadok
11:umah
10:ssuf
10:tik
11:o
10:waganihs
13:ode
12:kara
13:ihcat
10:yagates
11:ubihs
9:eamok
10:donih
10:mo
11:urukihsagih
10:soyik
9:ienagok
10:gani
10:hcada
13:tinuk
11:sabati
10:jnubukok
11:oihcah
10:manigus
9:ohuzim
10:jihcah
10:nakan
11:ih
13:sasum
11:urika
10:rugem
10:tamayihsagih
12:nim
11:iat
11:ok
10:uhc
10:yknub
9:ufohc
10:hcuf
10:kujnihs
3:paehc
5:rc
4:ohseht
7:iiawak
7:yub
5:lf
5:pevol
6:ydnac
5:rdkcab
7:niar
3:r2xro6--nx
4:atselttil
4:ednu
6:wohc
5:h
5:ilf
5:ppep
7:irts
7:u
5:taerg
6:tib
4:g
5:r
4:ks
4:o
5:on
4:ufekaf
3:s9nvfe--nx
4:dom
4:ndym
4:pihc
5:oo
4:remagten
4:sikhcnerf
4:ubloohcs
5:ruci
5:srev
4:xvp4--nx
3:tacyssup
5:obgip
4:erces
5:vlev
4:hginyad
4:netnocresu
4:sidas
4:ub
5:ollihc
3:u4rvp8--nx
4:fig
7:.adeki
10:ih
9:kimot
9:mayakat
10:ihsah
9:ne
9:rahagikes
15:makak
13:sak
9:tagamay
13:tik
9:wagibi
12:ustakan
11:karihs
17:ihsagih
8:ekatim
9:uawak
8:igohakas
9:hcapna
11:uonaw
9:kago
10:es
10:ot
9:manuzim
10:ijat
9:nak
9:urat
8:nanig`, `8:odog
9:jug
9:makonim
9:nim
9:roy
9:sihcih
8:ufig
9:sotom
10:tamasak
11:oay
4:hc
5:suykatik.*
14:ytic!
4:pup
4:stoknot
4:ynup
3:wgp
4:onsetihw
3:x5ytlk--nx
4:irtam
3:yadynnus
4:dr
4:knarc
4:loh
5:rig
4:moolg
4:ob
4:ppih
6:olf
4:raidanetah
5:gna
7:uh
4:u6d27srjd--nx
4:vaeh
3:z72thr--nx
4:eej
5:lur
1:k
2:.art
3:gro
3:moc
3:per
3:ude
3:vog
1:leh
2:l
1:m
2:.uj
2:ac
4:.fme.ta
2:j
1:n.*
2:d
1:og
2:hpih
3:s
4:.enilnoysrab
6:rawpohs
6:sab
5:xilpoh
5:ysrab
2:oc
2:t
3:.ldaw.*
5:ldtn
1:pa
3:.44esab
4:ahcom
5:rusah
4:b2e
5:ew
5:sc
7:.weiverp
5:uhtig
6:lckcah
4:deepseroc
6:tsoh.*
4:edualc
5:erf-korgn
5:gatskrelc
5:kalfwons.*
14:kniletavirp.*
5:lbavol
5:nilnigol
5:ralfduolc
5:sabnwaps
5:tupmocegde
5:varb
9:.s.*
4:frusdniw
4:hsadtob
4:ilressem
5:nayul
4:keelf-no
5:nalfhtron.*
5:orgn
5:relc
4:law
5:ecrev
6:napysae
5:lecpael
4:maerdepyt
4:naecolatigidno
5:epedoc
6:rim
6:via
5:ur.*
8:sltm.*
6:spu.*
4:opxe
8:.gnigats
16:.no
9:no
4:poon
4:rcne
8:.dnetnorf
5:emarf
7:saw
6:poleved.*
6:tup
5:ubaez
4:selucrehno
6:tirps
5:jasudem
5:nrettapcigam
5:porez.*
4:tayn
5:egdag`, `7:eb.*
5:ibelet
6:lmaerts
7:per
10:.di
5:luavreve.yaler
5:xenw
4:weiverptekcor
5:olfrettulf
4:xevnoc
5:lpp
4:yadotpihs
6:wliar.pu
5:filten
1:raa
3:hs
1:uekam
2:llag
2:org
5:.esruocsid
5:cts
5:kouk
5:nayalo
1:vsr
1:xece4ibgm--nx
0:qa
2:3a9y--nx
1:g
1:i
2:.gro
3:lim
3:moc
3:ten
3:ude
3:vog
1:m
1:se
0:ra
2:.acisum
4:sanes
3:bog
3:ges
4:ro
3:lautum
4:im
3:moc
3:pooc
3:rut
3:teb
5:n
4:ni
3:ude
3:vog
2:4d5a4prebgm--nx
2:b
3:.evloser
2:c
2:eydoog
2:los
2:tat
3:s
4:uen
2:ugaj
1:b
2:.21g
3:abacoros
6:iuc
5:itiruc
4:cnogoas
4:dicerapa
4:gniram
4:i
5:naiog
5:ramatnas
4:nerom
5:irdnol
4:op
4:pacam
5:irolf
5:maj
7:s
4:rief
4:tsivaob
3:b
4:aj
4:ib
4:mi
4:sb
3:cba
4:er
5:t
4:js
4:sp
4:t
5:e
3:dem
4:mb
4:nf
5:i
4:rt
3:ednarganipmac
4:ficer
4:hct
5:t
4:llivnioj
4:rdnaotnas
3:fdj
4:ed
4:gg
4:ne
5:i
3:gel
6:.ab
8:m
8:p
7:bp
7:ca
8:s
7:ec
8:p
8:s
7:fd
7:gm
7:ip
7:jr
7:la
7:ma
7:nr`, `7:og
8:r
8:t
7:pa
8:s
7:rp
8:r
7:se
8:m
8:r
7:tm
5:s
4:ls
5:z
4:nc
5:e
5:o
4:ol
6:b
6:f
6:v
4:pp
4:ro
3:hvp
3:idu
4:kiw
4:nana
4:oretin
4:pa
4:rc
5:eurab
4:sp
4:te
4:xat
3:laicos
5:tan
6:rof
4:el
4:im
4:sq
3:ma
4:da
4:egatnoc
5:leb
4:f
4:ic
4:oc
6:.etiselpmis
5:n.*
3:nce
3:oaliel
5:riebir
4:ce
5:narboir
5:saso
4:do
5:ranreboas
4:eg
5:t
4:ib
5:dar
5:ecam
5:r
4:rp
4:ta
5:erpoir
3:per
4:m
5:e
5:t
4:ooc
4:pa
4:se
3:qra
3:raf
4:ga
4:odavlas
5:j
4:tn
4:ut
3:saixac
5:mlap
5:nipmac
4:ed
4:uanam
5:j
5:m
3:tam
4:eb
5:d
5:n
5:v
4:nc
4:of
5:n
4:ra
4:sf
3:ucaug9
4:de
4:ja
4:rg
3:vda
4:ed
4:og
6:.ab
8:m
8:p
7:bp
7:ca
8:s
7:ec
8:p
8:s
7:fd
7:gm
7:ip
7:jr
7:la
7:ma
7:nr
7:og
8:r
8:t
7:pa
8:s
7:rp
8:r
7:se`, `8:m
8:r
7:tm
4:rs
4:t
3:xiv
3:zhb
4:ls
4:oc
5:f
4:yx
1:c
2:.as
3:ca
3:de
3:if
3:oc
4:g
3:ro
1:e.*
2:bew
2:ccos
2:eb
3:nigne
4:oip
3:rac
2:gniarg
5:rheob
2:hsok
3:taew
4:orb
2:itnorf
2:kcol
3:op
4:rb
2:laed
3:ffeahcs
2:mal
2:nes
2:pinuj
2:taeht
3:law
3:nec
3:snom
4:ubkcolb
3:upmoc
2:vocsid
4:rdnal
3:resbo
2:ywal
2:zifp
1:f
2:.aterg
3:bew-no
6:etis321
3:drp
3:ecitsuj-reissiuh
5:narf-ne-setsitned-sneigrurihc
4:lipuog
4:rianiretev
3:hny
3:icc
4:rgabmahc
3:moc
5:n
4:t
3:neicamrahp
4:icedem
3:ossa
3:pohsdaerpsym
3:selbatpmoc-strepxe
5:riaton
5:tsitned-sneigrurihc
5:uova
4:ndk
4:o-xbf
7:obeerf
5:xbf
6:obeerf
3:tacova
4:rop
7:orea
3:vuog
3:xobided
2:avc7ylqbgm--nx
2:s
1:g
2:.etiselpmis
3:gro
3:moc
3:ten
3:ude
3:vog
3:ysrab
1:h
2:.eman
3:moc
5:rf
3:yldnerb.pohs
3:zi
2:ur
1:i
2:.a61f4a3abgm--nx
4:rf4a3abgm--nx
3:ca
3:di
3:egdenavra
3:golbatsiv
4:ro
3:hcs
3:oc
3:ten
3:vog
2:ah
3:per
2:ew
2:lf
1:k
2:.10c
3:ca
4:s
3:em
4:n
4:p
4:r
3:gk
3:ia
4:ggnoeyg`, `4:kv
4:pa-vile
3:kubgnoeyg
8:uhc
6:noej
3:lim
4:uoes
3:mangnoeyg
8:uhc
6:noej
3:naslu
6:ub
4:dc-vile
4:oehcni
6:jead
5:wgnag
3:oc
4:g
4:i
3:ro
3:se
4:h
4:m
4:nd-vile
3:ti
3:ugead
4:jej
5:gnawg
3:vmm
2:cilf
1:l
2:.gro
3:moc
3:ten
3:ude
3:vog
1:m
2:.vog
1:n
2:.gro
3:moc
3:ofni
3:ten
3:ude
3:vog
3:zib
1:ohtua
2:tca
4:od
3:laer
1:p
2:.alsi
3:ca
3:eman
3:forp
3:gro
3:moc
3:ofni
4:rp
3:ten
4:se
3:ude
3:vog
3:zib
1:s
1:t
2:.21k
3:bew
3:cn
5:.vog
3:eman
3:gro
3:kst
3:leb
5:t
4:im
4:op
3:moc
3:neg
3:ofni
3:pek
3:rd
3:sbb
3:ten
3:ude
3:va
4:og
4:t
3:zib
2:f
2:m
1:vd
0:s8sqif--nx
1:9zqif--nx
1:a
2:.vog
2:birappnb
2:gev
2:lliv
2:mtsirhc
2:s
1:b
2:.ew
3:gro
3:moc
3:ten
3:ude
3:vog
2:oj
2:s
2:u
1:cihparg
3:p
3:tylana
2:od
1:da
2:d
2:ik
2:l
2:niwriaf
3:omaid
2:oogemoh
2:rac
1:e
2:.bewim321
4:og
3:gro
3:moc`, `5:n
3:pohsdaerpsym
3:ude
2:civres
8:.enilnigol
2:dd2bgm--nx
3:oc
5:.owo.*
2:hctaw
3:guh
2:ilppus
3:rtsudni
3:treporp
10:yrrek
2:jaiv
2:law
3:cycrotom
3:gnis
3:pats
2:mag
5:.yelp
7:zeehs
3:oh
3:reh
2:nut
2:ohs
2:picer
2:rit
3:utcip
8:.7331
5:nev
2:sirpretne
4:urc
3:ruoc
2:taicossa
2:vig
1:g
2:nidloh
1:h5c822qif--nx
1:i
2:a09--nx
2:nnet
2:rap
2:targ
1:kcor
5:.ecapsbew
6:snddym
6:tikcats
6:ytic-amil
3:us
2:hxda08--nx
2:row
1:l
2:.ca
4:s
3:gro
3:oc
4:fni
3:ten
3:ude
3:vog
3:zib
2:aed
3:tner
2:essurb
3:toh
6:yrrek
2:lahsram
2:m
2:oot
5:.rdda.nyd
10:ym
1:m
2:.etisinim
3:gro
3:moc
3:ten
3:ude
3:vog
2:b
2:etsys
7:.nerim
8:tniopthgink
2:ialc
1:naf
3:gorf
3:ol
2:iagrab
4:mod
3:giro
2:oitacav
5:cudorp
5:ulos
3:puoc
1:odnoc
2:geuj
2:ppaz
2:tohp
6:.remarf
3:ua
1:p
2:.ces
3:gro
3:moc
3:olp
3:ten
3:ude
3:vog
2:ihsralohcs
3:lihp
3:t
2:u
1:r
2:.ca
3:gro
3:ni
3:oc
3:ude
3:vog
3:xo
3:yldnerb.pohs
4:srab
2:ac
3:p
3:tiug
2:c
2:edliub
8:.etisduolc`, `3:erac
3:gor
3:levart
3:mraf
3:nniw
4:trap
3:wolf
2:otcartnoc
4:omatat
2:pj
2:uot
1:s
2:.em
3:gro
3:hcs
3:moc
3:oc
3:ten
3:ude
3:vog
3:zib
2:alg
2:enisub
8:.oc
4:tif
3:rp
5:xe
7:nacirema
3:xnal
2:iws
1:taeb
3:ob
2:ekcit
4:ram
2:fig
2:hcay
3:gilf
2:natnuocca
3:emtrapa
6:sevni
4:ve
6:.nibook
7:oc
2:rap
1:u
2:.ac
5:.21k
6:bil
6:cc
4:g
5:.21k
6:bil
6:cc
4:i
5:.21k
6:bil
6:cc
4:l
5:.21k
6:bil
6:cc
4:m
5:.21k
9:.hcorap
10:rthc
10:tvp
6:bil
6:cc
4:p
5:.21k
6:bil
6:cc
4:si
4:v
5:.21k
6:bil
6:cc
4:w
5:.21k
6:aes
7:ilartnec
8:pmylo
6:bil
6:cc
6:dnesnwot-trop
8:omder
7:rahcro-trop
6:eladrevlis
8:ttaes
7:uvelleb
6:lsi-egdirbniab
6:maiuqoh
7:iuqes
6:needreba
7:otlehs
9:ner
9:remerb
9:sgnik
6:obsluop
6:robrah-gig
6:selegna-trop
7:ilahehc
7:krof
6:tniop-worray
7:ropyek
6:woldul-trop
3:cd
5:.21k
6:bil
6:cc
4:n
5:.21k
6:bil
6:cc
4:s
5:.21k
6:bil
6:cc
3:delacsne.xhp
4:i
5:.21k
6:bil
6:cc
4:m
5:.21k
6:bil
6:cc
4:n`, `4:s
5:.bil
6:cc
4:uolcrim
3:ed
5:.cc
4:las-4-dnal
10:ffuts
4:m
5:.21k
6:bil
6:cc
5:anrevres
4:n
5:.21k
6:bil
6:cc
3:hn
5:.21k
6:bil
6:cc
4:o
5:.21k
6:bil
6:cc
3:ih
5:.bil
6:cc
4:m
5:.21k
6:bil
6:cc
7:et
6:goc
6:neg
7:otae
6:robra-nna
6:sum
6:tsd
6:wanethsaw
4:nd
4:pa-eruza
4:r
5:.bil
6:cc
4:v
5:.21k
6:bil
6:cc
4:w
5:.21k
6:bil
6:cc
3:jn
5:.21k
6:bil
6:cc
3:ka
5:.21k
6:bil
6:cc
4:o
5:.21k
6:bil
6:cc
3:la
5:.21k
6:bil
6:cc
4:f
5:.21k
6:bil
6:cc
4:i
5:.21k
6:bil
6:cc
3:mn
5:.21k
6:bil
6:cc
3:nafflog
4:i
5:.21k
6:bil
6:cc
4:m
5:.21k
6:bil
6:cc
4:sn
4:t
5:.21k
6:bil
6:cc
3:oc
5:.21k
6:bil
6:cc
4:gn
4:m
5:.21k
6:bil
6:cc
4:ttniop
3:pion
3:ra
5:.21k
6:bil
6:cc
4:o
5:.21k
6:bil
6:cc
4:p
5:.21k
6:bil
6:cc
3:sa
5:.21k
6:bil
6:cc
4:etisbeweruza
4:k
5:.21k
6:bil
6:cc
4:m`, `5:.21k
6:cc
4:nddeerf
6:uolc
3:tc
5:.21k
6:bil
6:cc
4:m
5:.21k
6:bil
6:cc
4:sohoileh
4:u
5:.21k
6:bil
6:cc
4:v
5:.21k
6:bil
6:cc
3:ug
5:.21k
6:bil
6:cc
3:vn
5:.21k
6:bil
6:cc
4:rs
6:.hg
7:lg
4:w
5:.cc
3:xt
5:.21k
6:bil
6:cc
3:yb-si
4:k
5:.21k
6:bil
6:cc
4:n
5:.21k
6:bil
6:cc
4:w
5:.21k
6:bil
6:cc
3:za
5:.21k
6:bil
6:cc
2:ah
4:uab
2:bria
2:col
2:e
3:.ytrap.resu
2:ineserf
2:lp
4:.tiyalp
11:.htiw
12:ta.*
2:xel
4:n
1:vt
1:w
2:.66duolc
3:gro
3:moc
3:rosivda.*
3:sndnyd
4:tepym
3:ten
3:ude
3:vog
2:a
3:.no.1-htron-ue.lru-adbmal
18:ppabew-refsnart
18:wolfria.*
11:uos-em.lru-adbmal
18:ppabew-refsnart
18:wolfria.*
15:fa.lru-adbmal
18:ppabew-refsnart
18:wolfria.*
15:pa.lru-adbmal
18:ppabew-refsnart
18:wolfria.*
15:ue.lru-adbmal
18:ppabew-refsnart
18:wolfria.*
9:lartnec-ac.lru-adbmal
20:ppabew-refsnart
20:wolfria.*
17:em.ppabew-refsnart
20:wolfria.*
17:li.ppabew-refsnart
20:wolfria.*
17:ue.lru-adbmal
20:ppabew-refsnart
20:wolfria.*
17:xm.ppabew-refsnart
9:tsae-as.lru-adbmal
17:ppabew-refsnart
17:wolfria.*
14:pa.lru-adbmal
17:ppabew-refsnart
17:wolfria.*
14:su.lru-adbmal
17:ppabew-refsnart
17:wolfria.*
14:vog-su.ppabew-refsnart
21:spif-ppabew-refsnart
13:htron-pa.lru-adbmal
22:ppabew-refsnart
22:wolfria.*
15:uos-pa.lru-adbmal
22:ppabew-refsnart
22:wolfria.*
11:ew-ac.ppabew-refsnart
17:wolfria.*
14:su.lru-adbmal
17:ppabew-refsnart
17:wolfria.*`, `14:ue.lru-adbmal
17:ppabew-refsnart
17:wolfria.*
14:vog-su.ppabew-refsnart
21:spif-ppabew-refsnart
7:2-htuos-pa.ppabew-refsnart
18:wolfria.*
15:ue.ppabew-refsnart
18:wolfria.*
9:lartnec-ue.ppabew-refsnart
20:wolfria.*
9:tsae-su.lru-adbmal
17:ppabew-refsnart
17:wolfria.*
13:htron-pa.lru-adbmal
22:ppabew-refsnart
22:wolfria.*
15:uos-pa.lru-adbmal
22:ppabew-refsnart
22:wolfria.*
11:ew-su.lru-adbmal
17:ppabew-refsnart
17:wolfria.*
14:ue.lru-adbmal
17:ppabew-refsnart
17:wolfria.*
7:3-tsaehtron-pa.lru-adbmal
22:ppabew-refsnart
22:wolfria.*
15:uos-pa.lru-adbmal
22:ppabew-refsnart
22:wolfria.*
11:ew-ue.lru-adbmal
17:ppabew-refsnart
17:wolfria.*
7:4-tsaehtuos-pa.ppabew-refsnart
22:wolfria.*
7:5-tsaehtuos-pa.ppabew-refsnart
22:wolfria.*
7:7-tsaehtuos-pa.ppabew-refsnart
4:rekamegas.1-htron-ue.koobeton
25:oiduts
18:uos-em.koobeton
25:oiduts
22:fa.koobeton
25:oiduts
22:pa.gnilebal
25:koobeton
25:oiduts
22:ue.koobeton
25:oiduts
16:lartnec-ac.gnilebal
27:koobeton
27:oiduts
27:spif-koobeton
24:em.koobeton
27:oiduts
24:li.koobeton
27:oiduts
24:ue.gnilebal
27:koobeton
27:oiduts
16:tsae-as.koobeton
24:oiduts
21:pa.koobeton
24:oiduts
21:su.gnilebal
24:koobeton
24:oiduts
24:spif-koobeton
21:vog-su.koobeton
28:oiduts
28:spif-koobeton
33:oiduts
20:htron-pa.gnilebal
29:koobeton
29:oiduts
22:uos-pa.gnilebal
29:koobeton
29:oiduts
18:ew-ac.koobeton
24:spif-koobeton
21:su.koobeton
24:oiduts
24:spif-koobeton
21:ue.gnilebal
24:koobeton
24:oiduts
21:vog-su.koobeton
28:oiduts
28:spif-koobeton
33:oiduts
14:2-htuos-pa.koobeton
22:ue.koobeton
25:oiduts
16:lartnec-ue.koobeton
27:oiduts
16:tsae-su.gnilebal
24:koobeton
24:oiduts
24:spif-koobeton
20:htron-pa.gnilebal
29:koobeton
29:oiduts
22:uos-pa.gnilebal
29:koobeton
29:oiduts
18:ew-su.gnilebal
24:koobeton
24:oiduts
24:spif-koobeton
21:ue.gnilebal
24:koobeton
24:oiduts
14:3-tsaehtron-pa.koobeton
29:oiduts
22:uos-pa.koobeton
29:oiduts
18:ew-ue.koobeton
24:oiduts
14:4-tsaehtuos-pa.koobeton
14:stnemirepxe.*
4:tsoper.etavirp.*
2:eiver
7:.mea
3:n
4:.elbaeciton
2:odniw`, `1:yalcrab
2:ot
0:t0srzc--nx
1:a
2:.4
3:amil4
3:ca
5:.hts
3:emohsnd
4:tiesbew321
3:gniliamerutuf
6:tsoherutuf
3:oc
4:fnistro.nednuk.*
12:xe.*
3:ph21
4:ohsdaerpsym
3:reuefknuf.neiw
4:o
3:smcerutuf.*
13:ni.*
13:xe.*
3:vg
4:irp
3:xi2
3:ym
4:tic-amil
2:c
2:e
3:s
2:hc
2:l
2:mami
2:rcomed
1:b
2:.gro
3:moc
3:ten
3:ude
3:vog
2:b
2:gl
1:catnoc
2:eles
3:rid
6:.p2pbil
6:txen
1:dimhcs
1:e
2:.eman
3:gro
3:moc
3:ofni
3:ten
3:ude
3:vog
3:zib
2:b
2:em
2:grat
2:id
2:kcirc
3:ram
2:n
3:.1dna1-sppa
4:46vpi
4:5ed
5:inu
4:6vnyd
4:77ndc.r
5:erauqs
4:al-morf
6:moob
5:minifed
5:remacytirucesym
5:tadsyawla
5:z
4:bboi
5:ewdarym
5:g
5:lyltsaf
12:.pam
4:cbaz
5:imanyd-snd
6:nagro-gnitae
6:tats-oieboda
5:paidemym
4:decalpb
6:ziamaka
5:feruza
5:hiamaka
5:irgevissam.saap.1-gs
23:nol
23:rf
23:yn
21:2-nol
23:yn
5:nab-eht-ni
5:uolc-snd
9:ehtgnituor
9:ftc
9:meaeboda
9:nievas.cdi-etsedron
17:itsalej
9:xednay
15:.egarots
17:tisbew
4:ecnarusnihtlaehezitavirp
6:rofelacs.j
5:gdeeruza
8:iamaka
5:ht-no-eciffo
5:lacsnoom
6:ibom-eruza
6:omlennut
5:mantenym.ns
6:ecnuob
6:itnuroieboda
6:ohtanyd
6:tcerider
5:nilno-evreser
6:ozdop
5:ralfduolc
14:.ndc
6:ehurht
5:s
6:abapus
5:tis-repparcs`, `7:usegde
5:zamaym
8:kcar
4:faeletis
5:crs.cos
9:resu
5:ehc-a-si
5:fgg
4:gnigats-deziamaka
13:hiamaka
12:egdeiamaka
13:tiusegde
12:iamaka
12:nigiroiamaka
12:yekegde
7:reesnes
7:sirkcilc
5:olbevres
4:hsadtob
5:vo.gnitsoh.*
8:saapbew.*
4:iamaka
5:nayul
5:pa-eruza
7:duolcvogsu.eroc.bew
24:olb
23:elif
18:subecivres
4:keeg-a-si
10:si
5:ipo
5:u
4:labolgeralfduolc.ndc
6:colottad
5:iamwt
5:meteh
5:sd-ni
6:s-77ndc
4:macasac
7:ih
5:urofniem
4:nafagp
7:lhn
6:ibed
7:llerk
5:ceralfduolc.ndc
5:dcduabkcalb
5:i
6:giroiamaka
5:o-drowyek
7:evil
7:revres
5:pv-ni
5:srh.spv
4:oc-morf
5:duppa
5:jodsnd
5:lefam
5:ned
8:.xobdnas
6:refnino
5:rp-ytinummoc
5:tlacol.*
6:tadym
4:pci.*
5:i-etsef
7:on
7:sndd
6:emoh
6:fles
6:nwo
5:j
5:mac-dnab-ta
5:o-oidar-mah
6:hbew
7:sdaerpsym
5:paduolc
12:vogsu
5:tfemoh
8:vres
5:usnd
4:reganamciffart
18:vogsu
6:tsulcyduolc
6:vres-xnk
5:vdslennahc
15:.u
4:sailanyd
9:snd
6:nymsd
5:bbevres
5:dylimaf
5:egde-ndc
6:rauqs
6:suohsyub
6:tisbeweruza
17:.10-2lartnecailartsua
22:sulartnechtuos
24:tsae
26:ew
21:3sutsae
26:ew
21:5sutsaehtron
30:uos
21:aidnihtuos
26:lartnec
26:tsew
23:satsae
29:htuos
21:egatsaisatsae
26:sulartnechtron
22:poruehtron
27:tsew
21:htronacirfahtuos
26:dnalaezwen
30:reztiws
26:eau
26:nawiat
26:ylati
27:namreg
23:uosaerok
26:ecnarf
26:ku
26:lizarb
26:nedews
21:lartnecadanac
29:erok
29:idnioij`, `30:lartsua
30:senodni
28:dnalop
28:eau
29:cnarf
29:lihc
28:htuosaidni
28:learsi
28:muigleb
28:nedews
29:iaps
28:ocixem
28:rataq
28:tsewynamreg
21:paue2sutsae
25:sulartnec
21:sulartnec
30:htron
32:uos
30:tsew
23:tsae
25:ew
21:tsaeadanac
26:ilartsua
27:rtsua
25:htuosailartsua
30:lizarb
25:kramned
25:napaj
25:yawron
23:ewacirfahtuos
26:idnioij
27:syalam
25:dnalreztiws
25:htronlearsi
30:nawiat
25:ku
25:napaj
25:yawron
18:p.*
7:ys
5:kekokohcs
5:nd-won
7:aka
7:d
8:unyd
7:golb
7:npv
6:oitcnufduolc
5:ppacitatseruza
19:.1
20:2
21:sutsae
25:ew
20:3
20:4
20:5
20:6
20:7
20:aisatsae
20:eporuetsew
20:sulartnec
5:sa-skcik
6:ecca-citats
10:duolc
5:t
6:.c.*
5:wodniw.eroc.bew
18:olb
17:elif
12:subecivres
4:tadies
5:ceffeym
7:jorprot
14:.segap
7:lespohs
5:enretnifodne
6:smem
5:farcenimevres
5:i-ekorb
7:seod
8:lles
8:teg
5:nessidym
7:tnocresuv
6:orfduolc
5:reclacol
5:sacynaeralfduolc.ndc
6:ixetnod
6:oh-spv
12:.citsalej.cir
22:lta
22:sjn
8:gnik
5:yrps
4:uh
5:nyd
5:r
4:ved-anafarg
8:naissalta.dorp.ndc
4:xinuemoh
5:spym
5:tsale.1ots-slj
11:2ots-slj
11:3ots-slj
5:unilemoh
4:yap-csbus
6:wetag-llawerif
5:ekegde
5:ffijduolc
14:.ed-1arf
15:su-1tsew
5:golonysym
5:ltsaf.dorp.a
16:labolg
11:lss.a
15:b
15:labolg
11:pam
11:slteerf
5:n-morf
6:ofipi
5:srab
4:za-morf
5:tirfym
2:p
2:tcip
2:v`, `1:fig
2:osorcim
1:g
2:.bog
3:dni
3:gro
3:lim
3:moc
3:ten
3:ude
1:h
2:.dem
3:gro
3:ler
4:op
3:moc
4:rif
3:ofni
4:rp
4:srep
5:sa
3:pohs
5:oc
3:ten
4:luda
4:r
5:a
3:ude
3:vuog
1:i
2:.a2n-loritds--nx
4:7e-etsoaellav--nx
4:8c-aneseclrof--nx
5:i-lrofanesec--nx
4:at
4:b
4:c
5:cul
4:dv
4:iblo-oipmet
8:oipmet
5:cserb
5:drabmol
5:ggof
6:urep
5:lgup
6:icis
7:me-oigger
9:oigger
6:uig-aizenev-iluirf
17:iluirf
10:ev-iluirf
12:iluirf
10:v-iluirf
11:iluirf
9:aizenev-iluirf
16:iluirf
9:ev-iluirf
11:iluirf
9:v-iluirf
10:iluirf
5:nabrev
7:cul
7:pmac
7:tac
6:idras
6:obrac-saiselgi
11:saiselgi
6:resi
5:otsip
5:rbalac
11:-oigger
11:oigger
7:mu
6:dna-attelrab-inart
10:inart-attelrab
9:attelrabinart
9:inartattelrab
9:ssela
6:epmi
6:ugil
5:tnelav-obiv
11:obiv
5:vap
5:zenev
7:ps-al
9:al
6:irog
4:liuqal
5:leib
5:osso-oisuc-onabrev
4:mor
5:rap
4:n
5:acsot
5:edom
6:is
6:sec-ilrof
9:ilrof
5:gamor-ailime
10:ailime
6:edras
11:-dus
11:dus
6:olob
5:issem
6:tal
5:ne
7:var
5:ocna
6:merc
6:rev
6:vas
4:oneg
4:p
4:r
5:acsep
6:rrac-assam
10:assam
8:ef
6:von
5:etam
5:tsailgo
12:-lled
12:lled
4:s
5:ip
5:sam-ararrac`, `8:ararrac
5:ucaris
6:gar
4:t
5:acilisab
6:recam
5:resac
5:soa
8:-d-ellav
11:lav
10:ellav
10:lav
9:ellav
8:d-ellav
10:lav
9:ellav
8:ellav
5:telrab-airdna-inart
12:inart-airdna
11:airdnainart
11:inartairdna
7:ssinatlac
4:udap
4:v
5:odap
6:neg
6:tnam
4:znairb-alled-e-aznom
12:znom
10:alledeaznom
11:znom
10:eaznom
6:ecaip
8:iv
7:soc
7:top
6:om
3:b-23
5:46
5:61
4:3c-lorit-ds-onitnert--nx
4:be-etsoa-ellav--nx
12:dellav--nx
4:c
5:f-anesec-lrof--nx
5:m-lrof-anesec--nx
4:he-etsoa-d-ellav--nx
4:m
5:u
4:o2-loritds-nezob--nx
4:sn-loritds-naslab--nx
19:ub--nx
14:nitnert--nx
4:v
5:6-lorit-dsnitnert--nx
5:7-loritds-nitnert--nx
14:onitnert--nx
4:zr-lorit-ds-nitnert--nx
15:onitnert--nx
5:s-loritds-onitnert--nx
3:cf
4:is
4:l
4:m
4:p
4:r
4:v
3:dp
4:u
5:olcnys
3:ec
5:cel
5:inev
5:nerolf
4:f
4:g
5:apemoh321
5:ida-a-onitnert
10:onitnert
9:otla
13:-onitnert
13:onitnert
8:a-onitnert
9:onitnert
8:otla
12:-onazlob
15:itnert
12:onitnert
4:hcram
4:l
4:m
5:ohsnd
6:r
4:nidu
5:onedrop
7:isorf
6:torc
4:p
4:r
4:serav
5:ilom
4:t
5:nomeip
5:seirt
6:oa
8:-d-eellav
9:eellav
8:deellav
8:eellav
4:v
4:znerif
3:ga
4:b
4:f
4:il
4:o
4:p
4:r
4:up
4:vf
3:hc
3:ib
4:c
4:dol
4:f
4:l
5:lecrev
5:opan`, `5:rof-anesec
8:anesec
4:m
4:napart
6:rt-attelrab-airdna
8:attelrabairdna
5:imir
5:ret
4:p
4:r
5:ab
6:ilgac
6:ssas
4:s
5:idnirb
4:teihc
7:r
5:sa
4:v
3:la
5:c
4:b
4:c
4:om
5:rit-deus-nitnert
14:onitnert
13:nitnert
13:onitnert
10:us-nitnert
13:onitnert
12:nitnert
12:onitnert
9:s-onitnert
10:onitnert
8:deus
12:-naslab
17:ub
14:ezob
14:itnert
13:onitnert
12:nitnert
12:onitnert
9:us-naslab
16:ub
13:ezob
13:itnert
12:onitnert
11:nitnert
8:s-onitnert
9:onitnert
3:mac
4:f
4:i
4:ol
4:r
3:na
5:lim
5:slab
7:ub
4:b
4:c
4:e
5:en.cj
5:v
5:zob
4:irut
4:m
5:p
4:p
4:r
4:t
3:oa
5:v
4:b
5:retiv
4:c
5:cel
4:enuc
4:g
5:ivor
4:idem-onadipmac
8:onadipmac
5:pmet-aiblo
9:aiblo
5:rdnos
5:zal
4:l
4:m
5:agreb
6:ret
5:oc
5:ref
7:lap
4:n
5:adipmac-oidem
12:oidem
6:lim
6:tsiro
6:zlob
5:ecip-ilocsa
9:ilocsa
5:ibru-orasep
9:orasep
6:lleva
6:rot
6:tnert
5:relas
6:ovil
5:ulleb
4:p
4:r
5:asep-onibru
9:onibru
6:znatac
5:oun
4:s
5:ivert
5:sabopmac
4:t
5:arp
5:enev
6:ssorg
5:narat
6:egirga
7:rt
7:veneb
4:zzera
6:urba`, `3:pa
4:ohsdaerpsym
4:s
4:t
3:qa
3:ra
5:m
5:s
4:b
5:a
4:c
4:f
4:g
4:k
4:me
4:o
4:p
4:s
4:t
4:v
3:sab
5:iselgi-ainobrac
11:ainobrac
4:b
4:c
4:elpan
4:i
4:m
4:ot
5:xbi
6:obdaili
4:s
4:t
4:v
3:ta
4:b
4:c
4:l
4:m
4:nomdeip
4:o
4:p
4:v
3:ude
4:l
4:n
4:p
4:s
3:va
4:og
4:p
4:s
4:t
4:v
3:ydrabmol
4:ellav-atsoa
9:atsoa
4:licis
4:nacsut
3:zal
4:b
4:c
4:p
2:derc
2:er
2:f
2:m
2:utni
1:je3a3abgm--nx
1:kh
1:l
2:.vog
2:uda
1:m
2:.gro
3:moc
3:ten
3:ude
1:namorockivdnas
3:ruatser
3:tnuocca
2:eg
3:meganam
4:piuqe
3:r
2:i
3:.ue
3:m
3:opdlog
2:opud
2:uocsid
1:ob
2:cs
4:.em
5:gro
5:oc
5:vog
8:.ecivres
8:ym
2:d
2:g
2:h
2:j
2:oferab
2:pedemoh
3:s
1:p
2:.bewanigap321
3:emon
3:gro
3:lbup
3:moc
3:ten
4:ni
3:ude
3:vog
1:ra
3:mlaw
4:s
2:epxe
2:oper
4:pus
7:.ysrab
4:s
1:s
2:.adaxiabme
4:rarik
3:emotoas`, `4:picnirp
4:rots
3:gro
3:lim
3:moc
3:nc.*
3:oc
4:dalusnoc
4:hoileh
6:n
3:ten
3:ude
2:af
2:eb
3:r
3:uq
2:i
3:rolf
3:tned
2:oh
4:.2pw
5:duolcrim
5:elej
6:tiseerf
5:flah
5:lenapysae
6:rupmet
5:spvtsaf
6:seccaduolc
5:tegdag
6:lob
6:negreme
6:safym
5:vedumpw
6:resi
3:p
4:sua
2:urt
1:t
2:.eman
3:gro
3:lim
3:moc
3:oc
4:fni
4:rp
3:ten
3:ude
3:vog
3:zib
2:ayh
2:n
2:o
3:bba
3:irram
1:uognah
1:xen
1:y
2:.gro
1:ztej
0:u25te9--nx
2:yssp--nx
1:a
2:.as
4:w
3:civ
3:di
4:lq
3:fnoc
3:gro
3:moc
6:.pohsdaerpsym
7:stelduolc.lem
3:nsa
3:sat
3:tca
4:en
4:n
3:ude
6:.as
8:w
7:cilohtac
9:v
7:dlq
7:sat
7:tca
8:n
7:wsn
3:vog
6:.as
8:w
7:civ
7:dlq
7:sat
3:wsn
3:zo
2:ti
1:c
2:.bog
3:fni
3:gro
3:moc
3:tan
4:en
3:ude
2:i
1:de
3:.tir.segap-tig
2:iab
1:e
2:.axn.*
3:emohsnd
3:lrusnart.*
3:odagod.citsalej
3:pwtcerid
3:secivresbewnozama.no.1-tsae-ed-csue.pdi-otingoc.htua
4:ndps
6:uolc
4:ruelfxued
3:wvrp
3:ysrab
1:g
2:.bew
3:gro
3:maug
4:oc
3:ofni
3:ten`, `3:ude
3:vog
1:h
2:.0002
3:acitore
4:idem
4:kitore
3:edszot
3:gro
3:ilus
3:letoh
3:malker
4:lif
4:t
4:urof
3:naltagni
3:oc
4:ediv
4:fni
4:levynok
4:nisac
3:pohs
3:rarga
3:sakal
5:zatu
4:emag
4:wen
3:tlob
4:rops
3:virp
3:xes
5:zs
3:ytic
3:zsagoj
2:os
2:sut
1:l
2:.etisbew321
1:m
2:.ca
3:gro
3:moc
3:oc
3:ro
3:ten
3:vog
1:n
2:.duolcesirpretne
3:eniesrem
6:m
3:tenkcahs
2:em
4:.enilnoysrab
5:ysrab
1:oggnaw
2:y
3:c
1:r
2:.aikymlak
5:rikhsab
5:vodrom
4:yegyda
3:bps
3:ca
3:duolcrim
3:eniram
4:rpcm
3:gbc
4:ro
3:ianatsuk
3:kihclan
4:sm
5:rogitayp
3:liamdlc.bh
5:m
3:moc
3:natsegad
3:onijym
9:.gnidnal.*
13:tsoh.*
10:murtceps.*
10:spv.*
3:pp
3:rib
5:dcm
8:.spv
6:orue
5:midalv
3:sar
4:itym
3:ten
4:ni
3:u4an
4:de
3:vog
5:n
3:ynzorg
3:zakvakidalv
2:myc
2:p
2:ug
1:s
2:.adgolov
5:nagarak
4:gulak
4:igroeg
5:kymlak
5:lerak
5:nemra
5:rikhsab
5:ssakahk
5:vodrom
5:zahkba
4:lut
4:rahkub
4:vut
4:yegyda
4:znep
3:bps
3:dabaghsa
5:rgonilest
3:gunel
3:ianatsuk
4:hcos
4:ovan
4:ttailgot
3:kalhsygnam
4:ihclan`, `4:slegnahkra
5:m
5:namrum
7:yrb
6:ibuytka
7:nbo
5:tiort
5:vorkop
3:locarak
4:ybmaj
3:nagruk
5:jiabreza
5:tsegad
7:hkazak-htron
14:tsae
3:ovonavi
3:radonsark
4:imidalv
3:tenxe
4:nekhsat
7:mihc
3:vohsalab
5:n
3:ynzorg
3:zakvakidalv
4:emret
2:tamok
3:ijuf
4:masih
1:v
2:.gro
3:moc
3:ten
3:ude
1:ykuyr
0:vb
1:c
2:.di
3:emon
4:rots
3:gro
3:lbup
3:moc
3:ten
4:ni
3:ude
3:ved
1:ed
3:.2r
4:a-si
6:ton-si
4:codeberg
4:daolyap
5:oog-a-si
4:eerf-korgn
5:garots.3t
7:tsgts.*
9:lcl.*
5:nilnigol
5:rahbew.*
5:varb
9:.s.*
4:gnigats-oned
5:olbraeb
5:ts.*
4:hcetaidem
5:sadtob
4:ipaegarots.3t
4:kcatslluf-a-si
5:orgn
4:lcl.*
5:ecrev
6:nap
5:lecpael
5:ooc-si
4:mrc.aa.*
9:p.*
9:w.*
8:ba.*
9:p.*
9:w.*
8:ca.*
9:p.*
9:w.*
8:d.*
9:a.*
9:p.*
9:w.*
8:ea.*
9:p.*
9:w.*
8:fa.*
9:p.*
9:w.*
8:ic.*
8:w.*
4:nepedoc
5:srh
4:oned
4:pl
6:.ipa
7:stcejbo
5:ohsuneviv
5:pa-rettalp
5:re
7:.bew
4:rddaym
5:esworbni.*
6:yalplacol
4:segap
5:rekrow
7:niatnocnur
4:tilper
10:.arik
11:deer
12:i
12:racip
11:ekip
12:saelererp
11:frow
11:gnigats
11:kcops
12:rik
11:labolg
11:mik
11:odo
12:ksis
11:rehcra`, `13:kcah
15:ut
14:ir
11:senob
12:irap
12:maet
11:tiprat
11:ulus
11:yawenaj
12:elsew
12:ranac
6:mx
5:luavreve.yaler
5:reclacol.resu.*
4:vresi
4:weiverpbuhtig
4:xdom
5:obdnas-ahcom
4:yawetag.*
5:lf
5:srab
1:ih
1:l
2:.di
3:fnoc
3:gro
3:lim
3:moc
3:nsa
3:ten
3:ude
3:vog
1:m
2:.eman
3:gro
3:lim
3:moc
4:uesum
3:ofni
4:rea
5:p
3:pooc
3:ten
4:ni
3:ude
3:vog
3:zib
1:og
2:m
1:rt
1:s
2:.bog
3:der
3:gro
3:moc
3:ude
1:t
2:.arukas
3:bew-eht-no
3:morf
3:naht-esrow
8:retteb
3:sndnyd
2:d
2:i
2:won
1:uqhv--nx
0:wa
2:.moc
2:l
1:b
2:.ca
3:gro
3:oc
3:ten
3:vog
1:c
2:.gro
3:moc
3:ten
3:ude
2:cp
1:eiver
2:n
3:.tekcorhtiwtliub.*
2:s
1:g
2:.xn
1:k
2:.bme
3:dni
3:gro
3:moc
3:ten
3:ude
3:vog
1:m
2:.ca
3:gro
3:moc
3:oc
3:pooc
3:ten
4:ni
3:ude
3:vog
3:zib
2:b
1:ocsom
2:h
3:s
4:.sm
2:n
3:.ereh
4:nyd
4:pmt
2:w
1:p
2:.344x
3:snduolc
3:vog
1:r
2:.ca
3:gro
3:lim
3:oc
3:pooc
3:ten`, `3:vog
2:n
1:t
2:.bulc
3:emag
3:gro
3:lim
4:ru
3:moc
6:.reliamym
3:sndym
3:ten
3:ude
3:vdi
4:og
3:zibe
1:z
2:.ca
3:gro
3:lim
3:oc
3:vog
0:xa
2:t
1:c
2:.dehcraeser
3:hta
3:ofni
3:sezziuq
4:lennuf
4:nduolc
4:rotaluclac
4:tnemssessa
5:set
3:vog
3:wonyap
1:edef
3:nay
2:ma
4:nab
2:rof
2:s
1:ilften
1:jt
1:m
2:.bog
3:gro
3:moc
3:ten
3:ude
2:g
2:ma2ibgy--nx
1:ob
3:x
2:f
2:rex
1:rbgn--nx
1:s
2:.vog
1:xamjt
4:kt
2:x
0:y4punu--nx
1:7rr03--nx
1:ad
3:iloh
4:rfkcalb
3:ot
5:.emyfilauqerp
2:g
3:.segap
2:lp
2:p
3:ila
2:rot
2:ssin
2:wdaorb
1:b
2:.fo
3:hcetaidem
3:lim
3:moc
3:vog
2:ab
2:gur
1:c
2:.ca
3:dtl
3:gro
3:lim
3:moc
6:.ecrofelacs.j
4:t
3:orp
3:segolke
4:serp
3:ten
3:vog
3:zib
2:amrahp
2:nega
1:ddadog
2:uts
1:ekcoh
2:ndys
3:om
3:rotta
2:snikcm
1:g
2:.gro
3:moc
3:oc
3:ten
3:ude
3:vog
2:olonhcet
10:.oc
2:rene
1:hpargotohp
1:id
3:.enigami
5:sruocsid
1:k
2:.gro
3:moc
3:ten
3:ude
2:s`, `1:l
2:.clp
3:dem
4:i
3:gro
3:hcs
3:moc
3:ten
3:ude
3:vog
2:f
2:imaf
6:nacirema
2:la
3:il
2:ppus
1:m
2:.eman
3:gro
3:lim
3:moc
3:ten
3:ude
3:vog
3:zib
2:edaca
7:.laiciffo
2:ra
1:napmoc
7:.xobym
2:os
1:oj
2:s
1:p
2:.gro
3:lim
3:moc
3:pooc
3:ten
3:ude
3:vog
1:recorg
3:grus
3:llag
3:viled
2:lewej
2:otcerid
2:tnuoc
2:uxul
1:s
2:.gro
3:lim
3:moc
3:ten
3:ude
3:vog
1:tefas
2:ic
3:ledif
3:nummoc
9:.bdnevar
10:gon
10:murofym
3:rahc
4:uces
3:srevinu
2:laer
2:rap
3:eporp
2:uaeb
1:u
2:.bug
3:gro
3:lim
3:moc
3:ten
3:ude
3:vg
2:b
3:tseb
1:van
1:xes
0:za
2:.eman
3:gro
3:lim
3:moc
3:oc
4:fni
4:rp
3:pp
3:ten
4:ni
3:ude
3:vog
3:zib
1:b
2:.az
3:gro
3:jsg
3:moc
3:oc
3:sndym
3:ten
3:ude
3:vog
1:c
2:.4e
3:9yxorptnetnoc.csr
3:inum.duolc.rsu
14:tlf
3:mlaer
4:urtnecatem.duolc.*
15:motsuc
3:oc
3:vog
1:d
2:.cos
3:gro
3:lop
3:moc
4:t
3:ossa
3:ten
4:ra
3:ude
3:vog
1:ib`, `3:.duolcsd
4:eht-rof
5:mos-rof
5:rom-rof
4:izoj
4:liartevitca
4:nafamm
4:pi-duolc
7:on
6:fles
5:ohbew
5:tfym
4:retteb-rof
4:sndnyd
7:uolc
4:xro
3:g
1:k
2:.duolcj
3:gro
3:lim
3:moc
3:ten
3:ude
3:vog
1:m
2:.ca
3:gro
3:lim
3:oc
3:ten
3:ude
3:vda
4:og
1:n
2:.asq-irom--nx
3:ca
3:gro
3:htlaeh
3:irc
5:oam
4:wi
6:k
3:keeg
3:lim
4:oohcs
3:neg
3:oc
3:snduolc
3:ten
4:nemailrap
4:vog
2:a
3:niflla
1:rawhcs
1:s
2:.ca
3:gro
3:oc
1:t
2:.ca
4:s
3:em
4:n
3:ibom
3:letoh
4:im
3:oc
4:fni
4:g
3:ro
3:vt
1:u
2:.gro
3:moc
3:oc
3:ten
2:rwon
1:yx
3:.enieffac
5:xe
4:hsadtob
4:lennutnepo
4:tibelet.*
1:zub`] };

// packages/attribution/src/psl.ts
function unpackRules(packed) {
  let previous = "";
  return packed.split(`
`).map((row) => {
    let colon = row.indexOf(":");
    return previous = previous.slice(0, Number(row.slice(0, colon))) + row.slice(colon + 1), [...previous].reverse().join("");
  });
}

// packages/attribution/src/index.ts
var rules = new Set(unpackRules(psl_index_default.rules.join(`
`)));
function toAsciiHost(input) {
  if (typeof input != "string" || !input || input.length > 65536 || /[\s\\]/.test(input)) return null;
  try {
    let isUrl = input.includes("://");
    if (!isUrl && ["/", "@", "?", "#"].some((part) => input.includes(part))) return null;
    let u = new URL(isUrl ? input : "http://" + input);
    if (!["http:", "https:", "ws:", "wss:"].includes(u.protocol)) return null;
    let h = u.hostname.toLowerCase().replace(/\.$/, "");
    return h.startsWith("[") || h.length <= 253 && h.split(".").every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) ? h : null;
  } catch {
    return null;
  }
}
function v4Class(n) {
  let a = n[0], b = n[1];
  return a === 127 ? "loopback" : a === 169 && b === 254 ? "link-local" : a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 ? "private" : "public";
}
function parseIpLiteral(input) {
  let h = toAsciiHost(input);
  if (h === null) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return { version: 4, category: v4Class(h.split(".").map(Number)) };
  if (!h.startsWith("[")) return null;
  let parts = h.slice(1, -1).split("::"), left = parts[0] ? parts[0].split(":").map((x) => parseInt(x, 16)) : [], right = parts[1] ? parts[1].split(":").map((x) => parseInt(x, 16)) : [], words = parts.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right] : left, category = "public";
  return words.slice(0, 7).every((w) => w === 0) && words[7] === 1 ? category = "loopback" : (words[0] & 65472) === 65152 ? category = "link-local" : (words[0] & 65024) === 64512 ? category = "ULA" : words.slice(0, 5).every((w) => w === 0) && words[5] === 65535 && (category = v4Class([words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255])), { version: 6, category };
}
function registrableDomain(input, index = rules) {
  let h = toAsciiHost(input);
  if (h === null || parseIpLiteral(h) !== null) return null;
  let labels2 = h.split("."), suffix = 0;
  for (let i = 0; i < labels2.length; i++) {
    let candidate = labels2.slice(i).join(".");
    if (index.has("!" + candidate)) return labels2.slice(i).join(".");
    index.has(candidate) && (suffix = Math.max(suffix, labels2.length - i)), i > 0 && index.has("*." + candidate) && (suffix = Math.max(suffix, labels2.length - i + 1));
  }
  return suffix > 0 && labels2.length > suffix ? labels2.slice(-suffix - 1).join(".") : null;
}
function redactHost(input) {
  let h = toAsciiHost(input);
  if (h === null) return { kind: "unknown" };
  let ip = parseIpLiteral(h);
  if (ip) return { kind: "ip", value: ip.category };
  if (h === "localhost" || h.endsWith(".localhost")) return { kind: "local", value: "localhost" };
  if (h.endsWith(".local")) return { kind: "local", value: "local" };
  if (!h.includes(".")) return { kind: "local", value: "single-label" };
  let domain = registrableDomain(h);
  return domain === null ? { kind: "unknown" } : { kind: "registrable", value: domain };
}
function reportHost(input) {
  let h = redactHost(input);
  return h.kind === "registrable" ? h.value : null;
}
function siteRelation(a, b) {
  if (typeof a != "string" || typeof b != "string") return "unknown";
  try {
    let ua = new URL(a), ub = new URL(b);
    if (ua.origin === "null" || ub.origin === "null" || !/^https?:$/.test(ua.protocol) || !/^https?:$/.test(ub.protocol)) return "opaque";
    if (ua.origin === ub.origin) return "same-origin";
    if (ua.protocol === ub.protocol && ua.hostname === ub.hostname && (parseIpLiteral(ua.hostname) || redactHost(ua.hostname).kind === "local")) return "same-site";
    let da = registrableDomain(ua.hostname), db = registrableDomain(ub.hostname);
    return !da || !db ? "unknown" : ua.protocol === ub.protocol && da === db ? "same-site" : "cross-site";
  } catch {
    return "unknown";
  }
}


return { redactHost };
})();
  var startThirdPartyTimingBridge = (function startThirdPartyTimingBridge(env) {
  const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
  let rows = new Map(), bytes = 256, truncated = false, cutoff = -Infinity, observer = null, enabled = true, started = false, fallbackRead = false;
  const types = new Map([['script', 'script'], ['img', 'image'], ['image', 'image'], ['iframe', 'sub_frame'], ['css', 'stylesheet'], ['fetch', 'xmlhttprequest'], ['xmlhttprequest', 'xmlhttprequest'], ['beacon', 'ping'], ['audio', 'media'], ['video', 'media'], ['object', 'object']]);
  const type = (value, path) => value === 'link' ? path.endsWith('.css') ? 'stylesheet' : /\.(?:woff2?|ttf)$/.test(path) ? 'font' : 'other' : (types.get(value) ?? 'other');
  const record = entries => {
    if (!enabled) return;
    if (!Array.isArray(entries) || entries.length > 2048) { truncated = true; return; }
    for (const entry of entries) {
      try {
        const raw = env.name(entry), start = env.start(entry), kind = env.initiator(entry);
        if (typeof raw !== 'string' || raw.length > 16384 || typeof start !== 'number' || start < cutoff) continue;
        const url = new URL(raw);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
        const redacted = env.redact(url.hostname), domain = redacted.kind === 'registrable' ? redacted.value : ((redacted.kind === 'unknown' ? 'unknown' : redacted.value).toLowerCase() + '.invalid');
        const pathTemplate = env.path(url.pathname);
        if (!pathTemplate || pathTemplate.length > 512) { truncated = true; continue; }
        const row = { domain, pathTemplate, type: type(kind, pathTemplate), requestCount: 1 }, key = domain + '|' + pathTemplate + '|' + row.type, prior = rows.get(key);
        if (prior) { prior.requestCount = Math.min(2147483647, prior.requestCount + 1); continue; }
        const cost = 128 + JSON.stringify(row).length * 2;
        if (rows.size >= 256 || bytes + cost > 65536) { truncated = true; continue; }
        rows.set(key, row); bytes += cost;
      } catch { truncated = true; }
    }
  };
  const connect = () => {
    if (observer || !enabled) return;
    try { observer = env.observe(record, !started); started = true; }
    catch {
      truncated = true;
      // A missing native observer provides one bounded buffer snapshot, not a
      // fresh copy of the same requests on every popup refresh.
      if (!fallbackRead) { fallbackRead = true; record(env.entries()); }
    }
  };
  const reset = () => { rows = new Map(); bytes = 256; truncated = false; cutoff = env.now(); fallbackRead = false; };
  const empty = () => ({ schemaVersion: 1, type: 'third-party-timing-cache', available: false, rows: [], truncated: true });
  connect();
  env.onCommand((trusted, message, respond) => {
    if (!trusted || !message || typeof message !== 'object') return false;
    const messageType = own(message, 'type');
    if (messageType === 'bridge-control' && ['pause', 'stop', 'resume'].includes(own(message, 'command'))) {
      reset(); enabled = own(message, 'command') === 'resume';
      if (!enabled) { observer?.disconnect(); observer = null; } else connect();
      return false;
    }
    if (Reflect.ownKeys(message).length !== 2 || own(message, 'schemaVersion') !== 1 || !['third-party-timing-query', 'third-party-timing-reset'].includes(messageType)) return false;
    if (messageType === 'third-party-timing-reset') { reset(); respond({ schemaVersion: 1, type: 'third-party-timing-reset-ack' }); return false; }
    if (!enabled) { respond(empty()); return false; }
    connect();
    if (observer?.takeRecords) record(observer.takeRecords());
    respond({ schemaVersion: 1, type: 'third-party-timing-cache', available: true, rows: [...rows.values()].map(row => ({ ...row })), truncated });
    return false;
  });
  env.onHide(() => { observer?.disconnect(); observer = null; });
  env.onRestore(() => connect());
  env.onBufferFull(() => { truncated = true; });
});
  function startBrowserThirdPartyTimingBridge() {
    const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor;
    const read = (prototype, name) => descriptor(prototype, name)?.get;
    const name = read(PerformanceEntry.prototype, "name"), start = read(PerformanceEntry.prototype, "startTime"), initiator = read(PerformanceResourceTiming.prototype, "initiatorType");
    startThirdPartyTimingBridge({
      name: entry => apply(name, entry, []), start: entry => apply(start, entry, []), initiator: entry => apply(initiator, entry, []),
      redact: thirdPartyTimingAttribution.redactHost, path: thirdPartyTimingContracts.thirdPartyPathTemplate,
      now: () => performance.now(), entries: () => performance.getEntriesByType("resource"),
      observe: (record, buffered = true) => { const observer = new PerformanceObserver(list => record(list.getEntries())); observer.observe({ type: "resource", buffered }); return observer; },
      onCommand: listener => chrome.runtime.onMessage.addListener((message, sender, respond) => listener(isOwnServiceWorker(sender), message, respond)),
      onHide: listener => window.addEventListener("pagehide", listener), onRestore: listener => window.addEventListener("pageshow", event => { if (event.persisted) listener(); }),
      onBufferFull: listener => performance.addEventListener("resourcetimingbufferfull", listener),
    });
  }
  // ADR-029 third-party timing bridge end

  // ADR-030 beacon bridge start
var beaconContracts = (() => {
// ADR-030 / REQ-004/005/011: a bounded, identifier-free beacon projection.
const BEACON_SERVICES = Object.freeze(['google-analytics', 'google-ads', 'meta', 'tiktok', 'yandex', 'linkedin']);
const BEACON_PROFILES = Object.freeze(['ga4-browser-v1', 'ga4-mp-v1', 'google-ads-browser-v1', 'meta-browser-v1', 'meta-capi-v1', 'tiktok-browser-v1', 'tiktok-events-v1', 'yandex-watch-v1', 'yandex-mp-v1', 'linkedin-image-v1', 'linkedin-capi-v1']);
const BEACON_EVENTS = Object.freeze(('unknown page_view session_start first_visit user_engagement click scroll file_download form_start form_submit view_search_results video_start video_progress video_complete add_payment_info add_shipping_info add_to_cart add_to_wishlist begin_checkout earn_virtual_currency generate_lead join_group level_end level_start login post_score purchase refund remove_from_cart search select_content select_item select_promotion share sign_up spend_virtual_currency tutorial_begin tutorial_complete unlock_achievement view_cart view_item view_item_list view_promotion PageView AddPaymentInfo AddToCart AddToWishlist CompleteRegistration Contact CustomizeProduct Donate FindLocation InitiateCheckout Lead Purchase Schedule Search StartTrial SubmitApplication Subscribe ViewContent ViewContentBrowse ClickButton Download CompletePayment PlaceAnOrder InitiateOrder AddContact CompleteTutorial pageview event ecommerce conversion').split(' '));
const BEACON_PRESENCE = Object.freeze(['present', 'absent', 'unknown', 'invalid', 'ambiguous']);
const BEACON_PARAMETERS = Object.freeze(['event', 'value', 'currency', 'client-id', 'browser-id', 'session-id', 'user-id', 'hashed-email', 'hashed-phone', 'consent', 'conversion-id']);
const BEACON_HOSTS = Object.freeze(['www.google-analytics.com', 'region1.google-analytics.com', 'analytics.google-analytics.com', 'www.googleadservices.com', 'www.google.com', 'googleads.g.doubleclick.net', 'www.facebook.com', 'graph.facebook.com', 'analytics.tiktok.com', 'business-api.tiktok.com', 'mc.yandex.ru', 'mc.yandex.com', 'mc.yandex.com.tr', 'mc.yandex.kz', 'mc.yandex.by', 'mc.webvisor.org', 'px.ads.linkedin.com', 'api.linkedin.com']);
const BEACON_CURRENCIES = Object.freeze(('AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VED VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWL').split(' '));
const BEACON_PROFILE_SERVICES = Object.freeze(Object.fromEntries(BEACON_PROFILES.map(profile => [profile, profile.startsWith('ga4-') ? 'google-analytics' : profile.startsWith('google-ads-') ? 'google-ads' : profile.split('-')[0]])));
const own = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
const array = (value, max) => Array.isArray(value) && value.length <= max && Reflect.ownKeys(value).length === value.length + 1 && Array.from({ length: value.length }, (_, index) => Object.hasOwn(Object.getOwnPropertyDescriptor(value, index) ?? {}, 'value')).every(Boolean);
const document = value => typeof value === 'string' && /^[0-9]+:[0-9]+:[A-Za-z0-9_-]{1,64}$/.test(value) && value.length <= 160;
const host = value => typeof value === 'string' && value.length <= 253 && value.includes('.') && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
function beaconDecimal(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > 999999999.999999) return null;
    value = Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value !== 'string' || !/^-?(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?$/.test(value)) return null;
  value = value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
  return value === '-0' ? '0' : value;
}
function readBeaconRequest(value) {
  try {
    const keys = ['schemaVersion', 'type', 'tabId', 'frameId', 'documentKey'];
    if (!exact(value, keys) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'ui-get-beacons' || !Number.isSafeInteger(own(value, 'tabId')) || own(value, 'tabId') < 0 || !Number.isSafeInteger(own(value, 'frameId')) || own(value, 'frameId') < 0 || !document(own(value, 'documentKey')) || !own(value, 'documentKey').startsWith(own(value, 'tabId') + ':' + own(value, 'frameId') + ':')) return null;
    return Object.fromEntries(keys.map(key => [key, own(value, key)]));
  } catch { return null; }
}
function readBeaconRows(value, max = 64, allowScripts = false) {
  try {
    if (!array(value, max)) return null;
    const keys = ['service', 'profile', 'destinationHost', 'schemaConfidence', 'method', 'requestType', 'events', 'money', 'identifiers', 'consent', 'parameterNames', 'decodeStatus', 'count', 'completedCount', 'failedCount', 'redirectCount', 'statusCodes', 'evidenceSource', 'integrity', 'attributionConfidence', 'initiatorHost', 'script'];
    const identifierKeys = ['clientId', 'browserId', 'sessionId', 'userId', 'hashedEmail', 'hashedPhone'];
    const consentKeys = ['gcs', 'gcd', 'adUserData', 'adPersonalization'];
    const output = [], seen = new Set(); let bytes = 256;
    for (let index = 0; index < value.length; ++index) {
      const row = own(value, index);
      if (!exact(row, keys) || !BEACON_PROFILES.includes(own(row, 'profile')) || own(row, 'service') !== BEACON_PROFILE_SERVICES[own(row, 'profile')] || !BEACON_HOSTS.includes(own(row, 'destinationHost')) || !['documented', 'transport-candidate', 'endpoint-only'].includes(own(row, 'schemaConfidence')) || !['GET', 'POST', 'PUT', 'other', 'unknown'].includes(own(row, 'method')) || !['image', 'xmlhttprequest', 'ping', 'script', 'other'].includes(own(row, 'requestType')) || !['complete', 'partial', 'invalid', 'truncated', 'ambiguous', 'endpoint-only'].includes(own(row, 'decodeStatus')) || !['count', 'completedCount', 'failedCount', 'redirectCount'].every(key => count(own(row, key))) || own(row, 'count') < 1 || own(row, 'completedCount') + own(row, 'failedCount') > own(row, 'count') || own(row, 'redirectCount') > own(row, 'count') || own(row, 'initiatorHost') !== null && !host(own(row, 'initiatorHost'))) return null;
      const source = own(row, 'evidenceSource'), browser = source === 'browser-network';
      const pageCall = allowScripts && source === 'page-hook';
      if (!(browser && own(row, 'integrity') === 'browser-observed' || (source === 'page-dom' || pageCall) && own(row, 'integrity') === 'page-controlled') || !browser && (own(row, 'completedCount') || own(row, 'failedCount') || own(row, 'redirectCount')) || source === 'page-dom' && own(row, 'method') !== 'unknown') return null;
      const script = own(row, 'script'), confidence = own(row, 'attributionConfidence');
      if (pageCall ? !['exact-resource', 'sampled-stack', 'unknown'].includes(confidence) : !['frame-only', 'unknown'].includes(confidence) || script !== null) return null;
      if (pageCall && (script !== null && (!exact(script, ['host', 'pathTemplate']) || !host(own(script, 'host')) || typeof own(script, 'pathTemplate') !== 'string' || !/^\/(?:<script>|(?:main|client|script|sdk|gtm|fbevents|widgets|tracker|analytics)\.(?:js|mjs))$/.test(own(script, 'pathTemplate'))) || (script === null) !== (confidence === 'unknown'))) return null;
      const events = own(row, 'events'), money = own(row, 'money'), identifiers = own(row, 'identifiers'), consent = own(row, 'consent'), parameters = own(row, 'parameterNames'), statuses = own(row, 'statusCodes');
      if (!array(events, 16) || events.some(event => !BEACON_EVENTS.includes(event)) || !array(money, 16) || !exact(identifiers, identifierKeys) || identifierKeys.some(key => !BEACON_PRESENCE.includes(own(identifiers, key))) || !exact(consent, consentKeys) || ['gcs', 'gcd'].some(key => !BEACON_PRESENCE.includes(own(consent, key))) || ['adUserData', 'adPersonalization'].some(key => !['granted', 'denied', 'absent', 'unknown', 'invalid', 'ambiguous'].includes(own(consent, key))) || !array(parameters, BEACON_PARAMETERS.length) || parameters.some(parameter => !BEACON_PARAMETERS.includes(parameter)) || new Set(parameters).size !== parameters.length || !array(statuses, 16) || statuses.some(status => !Number.isSafeInteger(status) || status < 100 || status > 599) || new Set(statuses).size !== statuses.length || !browser && statuses.length) return null;
      const projectedMoney = [];
      for (const item of money) {
        if (!exact(item, ['purpose', 'value', 'currency', 'event']) || !['value', 'goal-value', 'revenue'].includes(own(item, 'purpose')) || beaconDecimal(own(item, 'value')) !== own(item, 'value') || own(item, 'value') === null || own(item, 'currency') !== null && !BEACON_CURRENCIES.includes(own(item, 'currency')) || !BEACON_EVENTS.includes(own(item, 'event'))) return null;
        projectedMoney.push(Object.fromEntries(['purpose', 'value', 'currency', 'event'].map(key => [key, own(item, key)])));
      }
      const projected = { ...Object.fromEntries(keys.map(key => [key, own(row, key)])), events: events.slice(), money: projectedMoney, identifiers: { ...identifiers }, consent: { ...consent }, parameterNames: parameters.slice(), statusCodes: statuses.slice(), script: script ? { host: own(script, 'host'), pathTemplate: own(script, 'pathTemplate') } : null };
      const signature = JSON.stringify({ ...projected, count: 0, completedCount: 0, failedCount: 0, redirectCount: 0, statusCodes: [] });
      if (seen.has(signature)) return null;
      seen.add(signature); bytes += 256 + JSON.stringify(projected).length * 2;
      if (bytes > 65536) return null;
      output.push(projected);
    }
    return output;
  } catch { return null; }
}
function readBeaconSnapshot(value) {
  try {
    const keys = ['schemaVersion', 'type', 'documentKey', 'coverageState', 'requestCount', 'rows', 'scriptCalls', 'truncated'];
    if (!exact(value, keys) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'beacons-state' || !document(own(value, 'documentKey')) || !['active', 'partial', 'late-start', 'paused', 'unsupported', 'no-access', 'degraded'].includes(own(value, 'coverageState')) || !count(own(value, 'requestCount')) || typeof own(value, 'truncated') !== 'boolean') return null;
    const rows = readBeaconRows(own(value, 'rows')), scriptCalls = readBeaconScriptRows(own(value, 'scriptCalls'));
    if (!rows || !scriptCalls || Math.min(2147483647, rows.reduce((total, row) => total + row.count, 0)) !== own(value, 'requestCount') || ['no-access', 'unsupported', 'paused'].includes(own(value, 'coverageState')) && (rows.length || scriptCalls.length)) return null;
    return { ...Object.fromEntries(keys.map(key => [key, own(value, key)])), rows, scriptCalls };
  } catch { return null; }
}
function readBeaconTiming(value) {
  try {
    const keys = ['schemaVersion', 'type', 'available', 'rows', 'truncated'];
    if (!exact(value, keys) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'beacon-timing-cache' || typeof own(value, 'available') !== 'boolean' || typeof own(value, 'truncated') !== 'boolean') return null;
    const rows = readBeaconRows(own(value, 'rows'));
    if (!rows || rows.some(row => row.evidenceSource !== 'page-dom') || !own(value, 'available') && rows.length) return null;
    return { ...Object.fromEntries(keys.map(key => [key, own(value, key)])), rows };
  } catch { return null; }
}
function readBeaconDocuments(value) {
  try {
    if (!array(value, 24)) return null;
    const output = [], seen = new Set(); let rows = 0, bytes = 256;
    for (let index = 0; index < value.length; ++index) {
      const snapshot = readBeaconSnapshot(own(value, index));
      if (!snapshot || seen.has(snapshot.documentKey) || (rows += snapshot.rows.length + snapshot.scriptCalls.length) > 256) return null;
      seen.add(snapshot.documentKey); bytes += 256 + JSON.stringify(snapshot).length * 2;
      if (bytes > 262144) return null;
      output.push(snapshot);
    }
    return output;
  } catch { return null; }
}
function readBeaconScriptRows(value) {
  const rows = readBeaconRows(value, 32, true);
  return rows && rows.every(row => row.evidenceSource === 'page-hook') && JSON.stringify(rows).length <= 12000 ? rows : null;
}

return { BEACON_EVENTS, BEACON_CURRENCIES, beaconDecimal, readBeaconScriptRows, readBeaconSnapshot, readBeaconDocuments };
})();
var beaconDecoder = (() => {
const URL=globalThis.URL, URLSearchParams=globalThis.URLSearchParams, Map=globalThis.Map, Set=globalThis.Set, String=globalThis.String, Object=globalThis.Object, Array=globalThis.Array, Number=globalThis.Number, RegExp=globalThis.RegExp, Reflect=globalThis.Reflect, JSON=globalThis.JSON, TextDecoder=globalThis.TextDecoder, ArrayBuffer=globalThis.ArrayBuffer, Uint8Array=globalThis.Uint8Array;
const {BEACON_EVENTS,BEACON_CURRENCIES,beaconDecimal}=beaconContracts;
// ADR-030: known destinations are decoded transiently; no source value is retained.

const LIMIT = 32768, FIELD_LIMIT = 64;
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const has = (value, key) => value && typeof value === 'object' && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value');
const plainArray = (value, max) => Array.isArray(value) && value.length <= max && Reflect.ownKeys(value).length === value.length + 1;
const googleHosts = new Set(['www.google-analytics.com', 'region1.google-analytics.com', 'analytics.google-analytics.com']);
const yandexHosts = new Set(['mc.yandex.ru', 'mc.yandex.com', 'mc.yandex.com.tr', 'mc.yandex.kz', 'mc.yandex.by', 'mc.webvisor.org']);
const BEACON_REQUEST_FILTER = Object.freeze({ urls: [
  ...[...googleHosts].flatMap(host => ['/g/collect*', '/j/collect*', '/collect*', '/mp/collect*'].map(path => 'https://' + host + path)),
  ...['www.googleadservices.com', 'www.google.com', 'googleads.g.doubleclick.net'].flatMap(host => ['/pagead/conversion/*', '/pagead/viewthroughconversion/*', '/pagead/1p-conversion/*', '/pagead/1p-viewthroughconversion/*'].map(path => 'https://' + host + path)),
  'https://www.facebook.com/tr*', 'https://graph.facebook.com/v*/*/events*',
  'https://analytics.tiktok.com/api/v*/pixel*', 'https://analytics.tiktok.com/api/v*/i18n/pixel*', 'https://business-api.tiktok.com/open_api/v1.3/event/track/*',
  ...[...yandexHosts].flatMap(host => ['/watch/*', '/collect*'].map(path => 'https://' + host + path)),
  'https://px.ads.linkedin.com/collect*', 'https://api.linkedin.com/rest/conversionEvents*',
] });
function beaconProfile(raw) {
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
function parseBeaconJson(source) {
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

function decodeBeacon(input) {
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

return {decodeBeacon};
})();
  var startBeaconTimingBridge = (function startBeaconTimingBridge(env) {
  const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
  let rows = new Map(), bytes = 256, truncated = false, cutoff = -Infinity, observer = null, enabled = true, started = false, fallbackRead = false;
  const rowKey = row => JSON.stringify({ ...row, count: 0 });
  const record = entries => {
    if (!enabled) return;
    if (!Array.isArray(entries) || entries.length > 2048) { truncated = true; return; }
    for (const entry of entries) {
      try {
        const raw = env.name(entry), start = env.start(entry), kind = env.initiator(entry);
        if (typeof start !== 'number' || start < cutoff) continue;
        const decoded = env.decode({ url: raw, method: 'unknown', bodyAvailable: false });
        if (!decoded) continue;
        const requestType = kind === 'img' || kind === 'image' ? 'image' : kind === 'fetch' || kind === 'xmlhttprequest' ? 'xmlhttprequest' : kind === 'beacon' ? 'ping' : kind === 'script' ? 'script' : 'other';
        const row = { ...decoded, method: 'unknown', requestType, count: 1, completedCount: 0, failedCount: 0, redirectCount: 0, statusCodes: [], evidenceSource: 'page-dom', integrity: 'page-controlled', attributionConfidence: 'unknown', initiatorHost: null, script: null };
        const key = rowKey(row), prior = rows.get(key);
        if (prior) { prior.count = Math.min(2147483647, prior.count + 1); continue; }
        const cost = 256 + JSON.stringify(row).length * 2;
        if (rows.size >= 64 || bytes + cost > 65536) { truncated = true; continue; }
        rows.set(key, row); bytes += cost;
      } catch { truncated = true; }
    }
  };
  const connect = () => {
    if (observer || !enabled) return;
    try { observer = env.observe(record, !started); started = true; }
    catch { truncated = true; if (!fallbackRead) { fallbackRead = true; record(env.entries()); } }
  };
  const reset = () => { rows = new Map(); bytes = 256; truncated = false; cutoff = env.now(); fallbackRead = false; };
  connect();
  env.onCommand((trusted, message, respond) => {
    if (!trusted || !message || typeof message !== 'object') return false;
    const type = own(message, 'type');
    if (type === 'bridge-control' && ['pause', 'stop', 'resume'].includes(own(message, 'command'))) {
      reset(); enabled = own(message, 'command') === 'resume';
      if (!enabled) { observer?.disconnect(); observer = null; } else connect(); return false;
    }
    if (Reflect.ownKeys(message).length !== 2 || own(message, 'schemaVersion') !== 1 || !['beacon-timing-query', 'beacon-timing-reset'].includes(type)) return false;
    if (type === 'beacon-timing-reset') { reset(); respond({ schemaVersion: 1, type: 'beacon-timing-reset-ack' }); return false; }
    if (!enabled) { respond({ schemaVersion: 1, type: 'beacon-timing-cache', available: false, rows: [], truncated: true }); return false; }
    connect(); if (observer?.takeRecords) record(observer.takeRecords());
    respond({ schemaVersion: 1, type: 'beacon-timing-cache', available: true, rows: [...rows.values()], truncated }); return false;
  });
  env.onHide(() => { observer?.disconnect(); observer = null; });
  env.onRestore(() => connect());
  env.onBufferFull(() => { truncated = true; });
});
  var startBeaconValuesBridge = (function startBeaconValuesBridge(env, readRows) {
  const descriptor = Object.getOwnPropertyDescriptor, ownKeys = Reflect.ownKeys, hasOwn = Object.hasOwn;
  const field = (value, key) => value && typeof value === 'object' ? descriptor(value, key)?.value : undefined;
  const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && ownKeys(value).length === names.length && names.every(name => hasOwn(descriptor(value, name) ?? {}, 'value'));
  let pending = null, sequence = 0, nextReadAt = -Infinity;
  const empty = () => ({ schemaVersion: 1, type: 'beacon-values-cache', available: false, rows: [], truncated: true });
  const finish = (available, rows = [], truncated = true) => {
    if (!pending) return;
    const current = pending; pending = null; env.cancel(current.timer); nextReadAt = env.now() + 500;
    current.respond(available ? { schemaVersion: 1, type: 'beacon-values-cache', available: true, rows, truncated } : empty());
  };
  env.onPage((sameWindow, data) => {
    if (!sameWindow || !pending || !pending.posted || pending.admitted++ >= 8 || !exact(data, ['channel', 'type', 'requestId', 'enabled', 'rows', 'truncated']) || field(data, 'channel') !== 'detect.expert/beacon/v1' || field(data, 'type') !== 'beacon-values-batch' || field(data, 'requestId') !== pending.requestId || typeof field(data, 'enabled') !== 'boolean' || typeof field(data, 'truncated') !== 'boolean') return;
    const rows = readRows(field(data, 'rows'));
    if (rows) finish(field(data, 'enabled'), rows, field(data, 'truncated'));
  });
  env.onCommand((trusted, data, respond) => {
    if (!trusted || !exact(data, ['schemaVersion', 'type']) || field(data, 'schemaVersion') !== 1 || field(data, 'type') !== 'beacon-values-query') return false;
    if (pending || sequence >= 2147483647) { respond(empty()); return false; }
    const requestId = 'beacon-' + ++sequence, current = { requestId, respond, admitted: 0, timer: null, posted: false }; pending = current;
    const post = () => { if (pending !== current) return; current.posted = true; current.timer = env.later(() => finish(false), 400); env.post({ channel: 'detect.expert/beacon/v1', type: 'beacon-values-read', requestId }); };
    const delay = Math.max(0, nextReadAt - env.now()); if (delay) current.timer = env.later(post, delay); else post(); return true;
  });
  env.onHide(() => finish(false));
});
  function startBrowserBeaconBridges() {
    const apply=Reflect.apply, descriptor=Object.getOwnPropertyDescriptor;
    const name=descriptor(PerformanceEntry.prototype,"name")?.get, start=descriptor(PerformanceEntry.prototype,"startTime")?.get, initiator=descriptor(PerformanceResourceTiming.prototype,"initiatorType")?.get;
    const env={onCommand: listener=>chrome.runtime.onMessage.addListener((message,sender,respond)=>listener(isOwnServiceWorker(sender),message,respond)),onHide:listener=>window.addEventListener("pagehide",listener)};
    startBeaconTimingBridge({...env,decode:beaconDecoder.decodeBeacon,name:entry=>apply(name,entry,[]),start:entry=>apply(start,entry,[]),initiator:entry=>apply(initiator,entry,[]),now:()=>performance.now(),entries:()=>performance.getEntriesByType("resource"),observe:(record,buffered)=>{const observer=new PerformanceObserver(list=>record(list.getEntries()));observer.observe({type:"resource",buffered});return observer;},onRestore:listener=>window.addEventListener("pageshow",event=>{if(event.persisted)listener();}),onBufferFull:listener=>performance.addEventListener("resourcetimingbufferfull",listener)});
    startBeaconValuesBridge({...env,onPage:listener=>window.addEventListener("message",event=>listener(event.source===window,event.data)),post:message=>window.postMessage(message,"*"),later:(callback,delay)=>setTimeout(callback,delay),cancel:timer=>clearTimeout(timer),now:()=>performance.now()},beaconContracts.readBeaconScriptRows);
  }
  // ADR-030 beacon bridge end

  // packages/collector/src/background-activity.ts
  var backgroundBridgeContracts = (function createBackgroundActivityContracts() {
  const operations = Object.freeze(['ServiceWorkerContainer.register', 'ServiceWorkerContainer.getRegistration', 'ServiceWorkerContainer.getRegistrations', 'PushManager.subscribe', 'PushManager.getSubscription', 'PushManager.permissionState', 'SyncManager.register', 'SyncManager.getTags', 'PeriodicSyncManager.register', 'PeriodicSyncManager.getTags', 'PeriodicSyncManager.unregister', 'Notification.requestPermission']);
  const field = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
  const document = value => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,160}$/.test(value);
  const count = (value, max = 2147483647) => Number.isSafeInteger(value) && value >= 0 && value <= max;
  const host = value => typeof value === 'string' && value.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && !value.includes('..');
  const paths = Object.freeze(['/', '/<scope>', '/<worker>', '/<script>', '/sw.js', '/service-worker.js', '/worker.js', '/firebase-messaging-sw.js', '/main.js', '/app.js', '/bundle.js', '/sdk.js', '/gtm.js', '/fbevents.js', '/bat.js']);
  const resource = value => value === null ? null : exact(value, ['host', 'pathTemplate']) && host(field(value, 'host')) && paths.includes(field(value, 'pathTemplate')) ? { host: field(value, 'host'), pathTemplate: field(value, 'pathTemplate') } : false;
  const list = (value, max, read) => {
    if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return null;
    const output = [];
    for (let index = 0; index < value.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(value, index); if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null; const item = read(descriptor.value); if (item === null) return null; output.push(item); }
    return output;
  };
  function readRows(value) {
    try {
      const seen = new Set();
      return list(value, 64, item => {
        const keys = ['operation', 'phase', 'count', 'evidenceSource', 'integrity', 'attributionConfidence', 'script', 'worker'];
        if (!exact(item, keys) || !operations.includes(field(item, 'operation')) || !['async-returned', 'threw-sync'].includes(field(item, 'phase')) || !count(field(item, 'count')) || field(item, 'count') < 1 || field(item, 'evidenceSource') !== 'page-hook' || field(item, 'integrity') !== 'page-controlled' || !['exact-resource', 'sampled-stack', 'unknown'].includes(field(item, 'attributionConfidence'))) return null;
        const script = resource(field(item, 'script')), worker = resource(field(item, 'worker'));
        if (script === false || worker === false || (script === null) !== (field(item, 'attributionConfidence') === 'unknown') || field(item, 'operation') !== 'ServiceWorkerContainer.register' && worker !== null) return null;
        const key = [field(item, 'operation'), field(item, 'phase'), field(item, 'attributionConfidence'), script?.host ?? '', script?.pathTemplate ?? '', worker?.host ?? '', worker?.pathTemplate ?? ''].join('|');
        if (seen.has(key)) return null; seen.add(key);
        return Object.fromEntries(keys.map(key => [key, key === 'script' ? script : key === 'worker' ? worker : field(item, key)]));
      });
    } catch { return null; }
  }
  function readInventory(value) {
    try {
      const keys = ['status', 'secureContext', 'supported', 'permissions', 'registrationCount', 'pushSubscriptionCount', 'syncTagCount', 'periodicTagCount', 'registrations', 'truncated', 'checkedAt'];
      if (!exact(value, keys) || !['available', 'unsupported', 'unavailable'].includes(field(value, 'status')) || typeof field(value, 'secureContext') !== 'boolean' || typeof field(value, 'truncated') !== 'boolean' || !count(field(value, 'checkedAt'), Number.MAX_SAFE_INTEGER)) return null;
      const supported = field(value, 'supported'), permissions = field(value, 'permissions'), supportKeys = ['serviceWorker', 'push', 'sync', 'periodicSync'], permissionKeys = ['notifications', 'push', 'sync', 'periodicSync'];
      if (!exact(supported, supportKeys) || !supportKeys.every(key => typeof field(supported, key) === 'boolean') || !exact(permissions, permissionKeys) || !permissionKeys.every(key => ['granted', 'denied', 'prompt', 'unsupported', 'unknown'].includes(field(permissions, key)))) return null;
      for (const key of ['registrationCount', 'pushSubscriptionCount', 'syncTagCount', 'periodicTagCount']) if (field(value, key) !== null && !count(field(value, key), key === 'registrationCount' || key === 'pushSubscriptionCount' ? 4096 : 65536)) return null;
      const registrations = list(field(value, 'registrations'), 16, item => {
        if (!exact(item, ['scope', 'script', 'state', 'pushSubscribed', 'syncTagCount', 'periodicTagCount'])) return null;
        const scope = resource(field(item, 'scope')), script = resource(field(item, 'script'));
        if (!scope || scope === false || script === false || !['activated', 'installing', 'installed', 'activating', 'redundant', 'unknown'].includes(field(item, 'state')) || field(item, 'pushSubscribed') !== null && typeof field(item, 'pushSubscribed') !== 'boolean' || !['syncTagCount', 'periodicTagCount'].every(key => field(item, key) === null || count(field(item, key), 4096))) return null;
        return { scope, script, state: field(item, 'state'), pushSubscribed: field(item, 'pushSubscribed'), syncTagCount: field(item, 'syncTagCount'), periodicTagCount: field(item, 'periodicTagCount') };
      });
      if (!registrations || field(value, 'registrationCount') !== null && field(value, 'registrationCount') < registrations.length || field(value, 'status') !== 'available' && registrations.length || field(value, 'status') === 'unsupported' && field(supported, 'serviceWorker')) return null;
      return { ...Object.fromEntries(keys.map(key => [key, field(value, key)])), supported: Object.fromEntries(supportKeys.map(key => [key, field(supported, key)])), permissions: Object.fromEntries(permissionKeys.map(key => [key, field(permissions, key)])), registrations };
    } catch { return null; }
  }
  function readCache(value) {
    try {
      if (!exact(value, ['schemaVersion', 'type', 'available', 'rows', 'truncated', 'inventory']) || field(value, 'schemaVersion') !== 1 || field(value, 'type') !== 'background-values-cache' || typeof field(value, 'available') !== 'boolean' || typeof field(value, 'truncated') !== 'boolean') return null;
      const rows = readRows(field(value, 'rows')), inventory = readInventory(field(value, 'inventory'));
      return rows && inventory && (field(value, 'available') || !rows.length) ? { schemaVersion: 1, type: 'background-values-cache', available: field(value, 'available'), rows, truncated: field(value, 'truncated'), inventory } : null;
    } catch { return null; }
  }
  function readSnapshot(value) {
    try {
      const keys = ['schemaVersion', 'type', 'documentKey', 'coverageState', 'observedAt', 'rows', 'truncated', 'inventory'];
      if (!exact(value, keys) || field(value, 'schemaVersion') !== 1 || field(value, 'type') !== 'background-activity-state' || !document(field(value, 'documentKey')) || !['active', 'partial', 'degraded', 'no-access', 'paused', 'unsupported'].includes(field(value, 'coverageState')) || !count(field(value, 'observedAt'), Number.MAX_SAFE_INTEGER) || typeof field(value, 'truncated') !== 'boolean') return null;
      const rows = readRows(field(value, 'rows')), inventory = readInventory(field(value, 'inventory'));
      if (!rows || !inventory || ['no-access', 'paused', 'unsupported'].includes(field(value, 'coverageState')) && (rows.length || inventory.registrations.length || inventory.status === 'available')) return null;
      return { ...Object.fromEntries(keys.map(key => [key, field(value, key)])), rows, inventory };
    } catch { return null; }
  }
  function readRequest(value) {
    try {
      const keys = ['schemaVersion', 'type', 'tabId', 'frameId', 'documentKey'];
      if (!exact(value, keys) || field(value, 'schemaVersion') !== 1 || !['ui-get-background-activity', 'ui-refresh-background-activity'].includes(field(value, 'type')) || !count(field(value, 'tabId')) || !count(field(value, 'frameId')) || !document(field(value, 'documentKey')) || !field(value, 'documentKey').startsWith(`${field(value, 'tabId')}:${field(value, 'frameId')}:`)) return null;
      return Object.fromEntries(keys.map(key => [key, field(value, key)]));
    } catch { return null; }
  }
  function readDocuments(value) {
    try {
      const seen = new Set(); let rows = 0;
      return list(value, 24, item => { const snapshot = readSnapshot(item); if (!snapshot || seen.has(snapshot.documentKey) || (rows += snapshot.rows.length) > 256) return null; seen.add(snapshot.documentKey); return snapshot; });
    } catch { return null; }
  }
  return { operations, readRows, readInventory, readCache, readSnapshot, readRequest, readDocuments };
})();
  var backgroundBridgeRedactor = (function createBackgroundResourceRedactor(trustedNatives = false) {
  const descriptor = Object.getOwnPropertyDescriptor, apply = Reflect.apply;
  const NativeURL = descriptor(globalThis, 'URL')?.value, fnString = Function.prototype.toString, exec = RegExp.prototype.exec;
  const native = value => typeof value === 'function' && (trustedNatives || apply(exec, /\[native code\]/, [apply(fnString, value, [])]) !== null);
  const getter = key => { const value = NativeURL && descriptor(NativeURL.prototype, key)?.get; return native(value) ? value : null; };
  const protocol = getter('protocol'), hostname = getter('hostname'), pathname = getter('pathname');
  const ready = native(NativeURL) && protocol && hostname && pathname;
  const basenames = ['sw.js', 'service-worker.js', 'worker.js', 'firebase-messaging-sw.js', 'main.js', 'app.js', 'bundle.js', 'sdk.js', 'gtm.js', 'fbevents.js', 'bat.js'];
  const slice = String.prototype.slice, lastIndex = String.prototype.lastIndexOf, includes = Array.prototype.includes;
  return (raw, base, kind = 'worker') => {
    if (!ready || typeof raw !== 'string' || raw.length > 16384 || typeof base !== 'string' && base !== undefined) return null;
    try {
      const url = new NativeURL(raw, base), scheme = apply(protocol, url, []), host = apply(hostname, url, []), path = apply(pathname, url, []);
      if (scheme !== 'https:' && scheme !== 'http:' || !host || host.length > 253 || apply(exec, /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/, [host]) === null || apply(exec, /\.\./, [host]) !== null) return null;
      const basename = apply(slice, path, [apply(lastIndex, path, ['/']) + 1]);
      const pathTemplate = kind === 'scope' ? path === '/' ? '/' : '/<scope>' : apply(includes, basenames, [basename]) ? '/' + basename : kind === 'script' ? '/<script>' : '/<worker>';
      return { host, pathTemplate };
    } catch { return null; }
  };
})();
  var createBackgroundInventoryReader = (function createBackgroundInventoryReader(realm, redact, trustedNatives = false) {
  const descriptor = Object.getOwnPropertyDescriptor, apply = Reflect.apply, getPrototype = Object.getPrototypeOf;
  const fnString = Function.prototype.toString, exec = RegExp.prototype.exec;
  const native = value => { try { return typeof value === 'function' && (trustedNatives || apply(exec, /\[native code\]/, [apply(fnString, value, [])]) !== null); } catch { return false; } };
  const own = (value, key) => { try { return value && descriptor(value, key)?.value; } catch { return undefined; } };
  const getter = (target, key) => { try { for (let depth = 0; target && depth < 8; target = getPrototype(target), ++depth) { const value = descriptor(target, key); if (value) return native(value.get) ? value.get : null; } } catch { /* Inaccessible native surface. */ } return null; };
  const method = (target, key) => { const value = own(target, key); return native(value) ? value : null; };
  const read = (fn, receiver) => { try { return fn ? apply(fn, receiver, []) : null; } catch { return null; } };
  const root = key => {
    try {
      for (let target = realm, depth = 0; target && depth < 8; target = getPrototype(target), ++depth) {
        const value = descriptor(target, key);
        if (value) return Object.hasOwn(value, 'value') ? value.value : native(value.get) ? read(value.get, realm) : null;
      }
    } catch { /* Inaccessible isolated global. */ }
    return null;
  };
  // Firefox Xray globals expose WebIDL constructors on an inherited native global.
  // Only the trusted isolated global is inspected; argument/option objects are opaque.
  const constructors = new Map();
  const constructor = name => { if (!constructors.has(name)) constructors.set(name, root(name)); return constructors.get(name); };
  const prototype = name => own(constructor(name), 'prototype');
  const navigator = root('navigator'), notification = constructor('Notification'), secureContext = root('isSecureContext') === true;
  const document = root('document'), documentURL = getter(prototype('Document'), 'URL');
  const NativeURL = constructor('URL') ?? own(globalThis, 'URL'), originGetter = NativeURL && getter(own(NativeURL, 'prototype'), 'origin');
  const origin = raw => { try { return typeof raw === 'string' && native(NativeURL) && originGetter ? apply(originGetter, new NativeURL(raw), []) : null; } catch { return null; } };
  const documentOrigin = origin(read(documentURL, document));
  const container = read(getter(prototype('Navigator'), 'serviceWorker'), navigator);
  const permissions = read(getter(prototype('Navigator'), 'permissions'), navigator);
  const getRegistrations = method(prototype('ServiceWorkerContainer'), 'getRegistrations'), query = method(prototype('Permissions'), 'query');
  const state = getter(prototype('PermissionStatus'), 'state'), notificationPermission = getter(notification, 'permission');
  const registrationPrototype = prototype('ServiceWorkerRegistration');
  const scope = getter(registrationPrototype, 'scope'), active = getter(registrationPrototype, 'active'), waiting = getter(registrationPrototype, 'waiting'), installing = getter(registrationPrototype, 'installing');
  const pushManager = getter(registrationPrototype, 'pushManager'), sync = getter(registrationPrototype, 'sync'), periodic = getter(registrationPrototype, 'periodicSync');
  const workerURL = getter(prototype('ServiceWorker'), 'scriptURL'), workerState = getter(prototype('ServiceWorker'), 'state');
  const getSubscription = method(prototype('PushManager'), 'getSubscription'), getSyncTags = method(prototype('SyncManager'), 'getTags'), getPeriodicTags = method(prototype('PeriodicSyncManager'), 'getTags');
  const supported = { serviceWorker: secureContext && !!container && !!getRegistrations, push: !!pushManager && !!getSubscription, sync: !!sync && !!getSyncTags, periodicSync: !!periodic && !!getPeriodicTags };
  const now = Date.now;
  const empty = () => ({ status: supported.serviceWorker ? 'unavailable' : 'unsupported', secureContext, supported: { ...supported }, permissions: { notifications: notificationPermission ? 'unknown' : 'unsupported', push: supported.push ? 'unknown' : 'unsupported', sync: supported.sync ? 'unknown' : 'unsupported', periodicSync: supported.periodicSync ? 'unknown' : 'unsupported' }, registrationCount: null, pushSubscriptionCount: null, syncTagCount: null, periodicTagCount: null, registrations: [], truncated: false, checkedAt: 0 });
  let physical = null;
  async function inspect() {
    const output = empty(); output.checkedAt = now();
    if (!supported.serviceWorker) return output;
    const nativeNotification = read(notificationPermission, notification);
    output.permissions.notifications = nativeNotification === 'default' ? 'prompt' : ['granted', 'denied'].includes(nativeNotification) ? nativeNotification : notificationPermission ? 'unknown' : 'unsupported';
    const permission = async (name, available) => {
      if (!available) return 'unsupported';
      if (!query || !permissions || !state) return 'unknown';
      try { const status = await apply(query, permissions, [{ name }]), value = read(state, status); return ['granted', 'denied', 'prompt'].includes(value) ? value : 'unknown'; } catch { return 'unknown'; }
    };
    const results = await Promise.all([permission('push', supported.push), permission('background-sync', supported.sync), permission('periodic-background-sync', supported.periodicSync)]);
    [output.permissions.push, output.permissions.sync, output.permissions.periodicSync] = results;
    let registrations;
    try { registrations = await apply(getRegistrations, container, []); } catch { return output; }
    const length = Array.isArray(registrations) ? descriptor(registrations, 'length')?.value : null;
    if (!Number.isSafeInteger(length) || length < 0) return output;
    output.status = 'available'; output.registrationCount = Math.min(4096, length); output.truncated = length > 16;
    output.pushSubscriptionCount = supported.push ? 0 : null; output.syncTagCount = supported.sync ? 0 : null; output.periodicTagCount = supported.periodicSync ? 0 : null;
    const tagCount = async (fn, manager) => {
      if (!fn || !manager) return null;
      try { const tags = await apply(fn, manager, []), count = Array.isArray(tags) ? descriptor(tags, 'length')?.value : null; if (!Number.isSafeInteger(count) || count < 0) return null; if (count > 4096) output.truncated = true; return Math.min(4096, count); } catch { return null; }
    };
    for (let index = 0; index < Math.min(16, length); ++index) {
      const registration = descriptor(registrations, index)?.value;
      const rawScope = read(scope, registration), redactedScope = redact(rawScope, undefined, 'scope');
      if (!documentOrigin || origin(rawScope) !== documentOrigin) { output.truncated = true; continue; }
      if (!redactedScope) { output.truncated = true; continue; }
      const worker = read(active, registration) ?? read(waiting, registration) ?? read(installing, registration);
      const redactedScript = worker ? redact(read(workerURL, worker), undefined, 'worker') : null;
      const nativeState = worker ? read(workerState, worker) : null;
      const item = { scope: redactedScope, script: redactedScript, state: ['activated', 'installing', 'installed', 'activating', 'redundant'].includes(nativeState) ? nativeState : 'unknown', pushSubscribed: null, syncTagCount: null, periodicTagCount: null };
      if (supported.push) try { item.pushSubscribed = (await apply(getSubscription, read(pushManager, registration), [])) !== null; } catch { /* Unavailable remains null. */ }
      [item.syncTagCount, item.periodicTagCount] = await Promise.all([tagCount(getSyncTags, read(sync, registration)), tagCount(getPeriodicTags, read(periodic, registration))]);
      for (const [total, count] of [['pushSubscriptionCount', item.pushSubscribed === null ? null : item.pushSubscribed ? 1 : 0], ['syncTagCount', item.syncTagCount], ['periodicTagCount', item.periodicTagCount]]) output[total] = output[total] === null || count === null ? null : output[total] + count;
      output.registrations.push(item);
    }
    if (output.registrations.length !== length) { output.pushSubscriptionCount = null; output.syncTagCount = null; output.periodicTagCount = null; }
    return output;
  }
  return { empty, supported: { ...supported }, read() {
    if (physical) return Promise.resolve({ ...empty(), truncated: true });
    const job = inspect(); physical = job;
    const release = () => { if (physical === job) physical = null; }; job.then(release, release);
    return job;
  } };
});
  var startBackgroundValuesBridge = (function startBackgroundValuesBridge(env, contracts, inventoryReader) {
  const descriptor = Object.getOwnPropertyDescriptor, ownKeys = Reflect.ownKeys, hasOwn = Object.hasOwn;
  const field = (value, key) => value && typeof value === 'object' ? descriptor(value, key)?.value : undefined;
  const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && ownKeys(value).length === names.length && names.every(name => hasOwn(descriptor(value, name) ?? {}, 'value'));
  let pending = null, sequence = 0, nextReadAt = -Infinity, active = true;
  const unavailable = () => ({ schemaVersion: 1, type: 'background-values-cache', available: false, rows: [], truncated: true, inventory: inventoryReader.empty() });
  const finish = current => {
    if (!active || pending !== current || !current.pageDone || !current.inventoryDone) return;
    pending = null; env.cancel(current.pageTimer); env.cancel(current.inventoryTimer); nextReadAt = env.now() + 500;
    current.respond({ schemaVersion: 1, type: 'background-values-cache', available: current.available, rows: current.rows, truncated: current.truncated, inventory: current.inventory });
  };
  env.onPage((sameWindow, data) => {
    const current = pending;
    if (!sameWindow || !current || !current.posted || current.pageDone || current.admitted++ >= 8 || !exact(data, ['channel', 'type', 'requestId', 'enabled', 'rows', 'truncated']) || field(data, 'channel') !== 'detect.expert/background/v1' || field(data, 'type') !== 'background-values-batch' || field(data, 'requestId') !== current.requestId || typeof field(data, 'enabled') !== 'boolean' || typeof field(data, 'truncated') !== 'boolean') return;
    const rows = contracts.readRows(field(data, 'rows')); if (!rows || JSON.stringify(rows).length > 12000) return;
    current.available = field(data, 'enabled'); current.rows = current.available ? rows : []; current.truncated = field(data, 'truncated') || !current.available; current.pageDone = true; finish(current);
  });
  env.onCommand((trusted, data, respond) => {
    if (!trusted || !exact(data, ['schemaVersion', 'type', 'refresh']) || field(data, 'schemaVersion') !== 1 || field(data, 'type') !== 'background-values-query' || typeof field(data, 'refresh') !== 'boolean') return false;
    if (!active || pending || sequence >= 2147483647) { respond(unavailable()); return false; }
    const current = { requestId: 'background-' + ++sequence, respond, admitted: 0, posted: false, pageDone: false, inventoryDone: !field(data, 'refresh'), available: false, rows: [], truncated: true, inventory: inventoryReader.empty(), pageTimer: null, inventoryTimer: null };
    pending = current;
    if (field(data, 'refresh')) {
      current.inventoryTimer = env.later(() => { current.inventoryDone = true; current.inventory = { ...inventoryReader.empty(), truncated: true }; finish(current); }, 1000);
      Promise.resolve().then(() => inventoryReader.read()).then(value => {
        if (!active || pending !== current || current.inventoryDone) return;
        const inventory = contracts.readInventory(value); current.inventoryDone = true; env.cancel(current.inventoryTimer);
        current.inventory = inventory ?? { ...inventoryReader.empty(), truncated: true }; finish(current);
      }, () => { if (!active || pending !== current || current.inventoryDone) return; current.inventoryDone = true; current.inventory = { ...inventoryReader.empty(), truncated: true }; finish(current); });
    }
    const post = () => { if (!active || pending !== current) return; current.posted = true; current.pageTimer = env.later(() => { current.pageDone = true; finish(current); }, 400); env.post({ channel: 'detect.expert/background/v1', type: 'background-values-read', requestId: current.requestId }); };
    const delay = Math.max(0, nextReadAt - env.now()); if (delay) current.pageTimer = env.later(post, delay); else post();
    return true;
  });
  env.onHide(() => { active = false; const current = pending; pending = null; if (current) { env.cancel(current.pageTimer); env.cancel(current.inventoryTimer); current.respond(unavailable()); } });
  env.onShow?.(() => { active = true; });
});
  function startBrowserBackgroundValuesBridge() {
    startBackgroundValuesBridge({
      onPage: listener => window.addEventListener("message", event => listener(event.source === window, event.data)),
      onCommand: listener => chrome.runtime.onMessage.addListener((message, sender, respond) => listener(isOwnServiceWorker(sender), message, respond)),
      onHide: listener => window.addEventListener("pagehide", listener), onShow: listener => window.addEventListener("pageshow", listener),
      post: message => window.postMessage(message, "*"), later: (callback, delay) => setTimeout(callback, delay), cancel: timer => clearTimeout(timer), now: () => performance.now(),
    }, backgroundBridgeContracts, createBackgroundInventoryReader(globalThis, backgroundBridgeRedactor));
  }
  // packages/collector/src/background-activity:end

  // packages/collector/src/api-results.ts
  function startApiResultsBridge(env) {
    let epoch = 0, sequence = 0, expectedBatch = 0, admitted = 0, bytes = 512, requestId = "", timer = null, cacheTimer = null, cached = null, nextReadAt = -1 / 0, waiting = null, truncated = !1, rows = /* @__PURE__ */ new Map(), empty = () => ({ schemaVersion: 1, type: "api-results-cache", epoch, available: !1, rows: [], truncated: !0 }), clearCache = () => {
      cached = null, cacheTimer !== null && env.cancel(cacheTimer), cacheTimer = null;
    }, finish = (available) => {
      timer !== null && env.cancel(timer), timer = null;
      let callbacks = waiting;
      waiting = null;
      let result = {
        schemaVersion: 1,
        type: "api-results-cache",
        epoch,
        available,
        rows: available ? [...rows.values()] : [],
        truncated: truncated || !available
      };
      if (rows.clear(), clearCache(), available && (cached = result, nextReadAt = env.now() + 1e3, cacheTimer = env.later(clearCache, 1e3)), callbacks) for (let respond of callbacks) respond(result);
    }, reset = () => {
      epoch = epoch < 2147483647 ? epoch + 1 : 2147483647, finish(!1), nextReadAt = -1 / 0, env.post({ channel: API_RESULTS_CHANNEL, type: "api-results-reset", requestId: "reset-" + epoch, epoch });
    };
    env.onRestore(reset), env.onPage((sameWindow, data) => {
      if (!sameWindow || waiting === null || admitted >= 64 || typeof data != "object" || data === null || Object.getOwnPropertyDescriptor(data, "channel")?.value !== API_RESULTS_CHANNEL) return;
      admitted++;
      let message = readApiResultsBatch(data);
      if (!message || message.requestId !== requestId || message.epoch !== epoch || message.batchSeq !== expectedBatch) {
        truncated = !0;
        return;
      }
      expectedBatch++;
      for (let row of message.rows) {
        let key = row.operation + ":" + row.phase;
        if (rows.has(key)) {
          truncated = !0;
          continue;
        }
        let cost = apiResultEntryBytes(row);
        if (rows.size >= API_RESULTS_LIMITS.rows || bytes + cost > API_RESULTS_LIMITS.bytes) {
          truncated = !0;
          continue;
        }
        rows.set(key, row), bytes += cost;
      }
      truncated ||= message.truncated, message.final && finish(message.enabled);
    }), env.onCommand((trusted, data, respond) => {
      if (!trusted || typeof data != "object" || data === null || Array.isArray(data) || Reflect.ownKeys(data).length !== 2 || Object.getOwnPropertyDescriptor(data, "schemaVersion")?.value !== 1) return !1;
      let type = Object.getOwnPropertyDescriptor(data, "type")?.value;
      return type === "api-results-reset" ? (reset(), respond({ schemaVersion: 1, type: "api-results-reset-ack", epoch }), !1) : type !== "api-results-query" ? !1 : epoch === 2147483647 || sequence === 2147483647 ? (respond(empty()), !1) : waiting !== null ? (waiting.length < 4 ? waiting.push(respond) : respond(empty()), !0) : cached !== null && env.now() < nextReadAt ? (respond(cached), !1) : env.now() < nextReadAt ? (respond(empty()), !1) : (clearCache(), sequence++, requestId = "query-" + sequence, expectedBatch = 0, admitted = 0, bytes = 512, truncated = !1, rows.clear(), waiting = [respond], timer = env.later(() => finish(!1), API_RESULTS_LIMITS.queryMs), env.post({ channel: API_RESULTS_CHANNEL, type: "api-results-read", requestId, epoch }), !0);
    });
  }
  function startBrowserApiResultsBridge() {
    startApiResultsBridge({
      onPage: (listener) => window.addEventListener("message", (event) => listener(event.source === window, event.data)),
      onCommand: (listener) => chrome.runtime.onMessage.addListener((message, sender, respond) => listener(isOwnServiceWorker(sender), message, respond)),
      onRestore: (listener) => window.addEventListener("pageshow", (event) => {
        event.persisted && listener();
      }),
      post: (message) => window.postMessage(message, "*"),
      later: (callback, delay) => setTimeout(callback, delay),
      cancel: (timer) => clearTimeout(timer),
      now: () => performance.now()
    });
  }

  // ADR-076 Precursor native timing bridge start
  var classifyPrecursorTimingResource = (function classifyPrecursorTimingResource(raw, origin) {
  if (typeof raw !== 'string' || raw.length > 16384 || !raw.startsWith('https://') || /[\\\u0000-\u0020\u007f]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && url.origin === origin &&
      /^\/cdn-cgi\/challenge-platform\/h\/g\/scripts\/precursor\/[a-f0-9]{12}\/main\.js$/.test(url.pathname) ? 'cf-precursor-versioned-loader-v1' : null;
  } catch { return null; }
});
  var startPrecursorTimingBridge = (function startPrecursorTimingBridge(env) {
  const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length &&
    keys.every(key => { const field = Object.getOwnPropertyDescriptor(value, key); return field?.enumerable && Object.hasOwn(field, 'value'); });
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
  let observer = null, enabled = true, suspended = false, available = env.available === true, truncated = false;
  let observed = false, observedAt = -Infinity, revision = 0, cutoff = -Infinity, started = false, fallbackRead = false;
  let sessionId = null, lastResetId = null, windowAt = -Infinity, windowEntries = 0;
  const advance = () => { if (revision < 2147483647) ++revision; else { available = false; truncated = true; observed = false; } };
  const reset = () => {
    observed = false; observedAt = -Infinity; cutoff = env.now(); truncated = false;
    fallbackRead = true; windowAt = cutoff; windowEntries = 0; advance();
    // Drop queued old deliveries without clearing or resizing the page's own timing buffer.
    try { observer?.takeRecords(); } catch { truncated = true; }
  };
  const record = entries => {
    if (!enabled || suspended || !available) return;
    const now = env.now();
    if (!Number.isFinite(now)) { truncated = true; return; }
    if (now < windowAt || now - windowAt >= 1000) { windowAt = now; windowEntries = 0; }
    if (!Array.isArray(entries) || entries.length > 2048 || windowEntries + entries.length > 4096) { truncated = true; return; }
    windowEntries += entries.length;
    for (const entry of entries) {
      try {
        const start = env.start(entry);
        if (!Number.isFinite(start) || start < 0 || start <= cutoff || start > now || env.initiator(entry) !== 'script') continue;
        const rule = env.classify(env.name(entry), env.origin());
        if (rule === null) continue;
        const status = env.status(entry);
        // Firefox 138 retains application/javascript; newer normalization may use text/javascript.
        if (!Number.isInteger(status) || !(status >= 200 && status <= 299 || status === 304) || !['text/javascript', 'application/javascript'].includes(env.contentType(entry))) continue;
        observed = true; observedAt = now; advance();
      } catch { truncated = true; }
    }
  };
  const connect = () => {
    if (observer || !enabled || suspended || !available) return;
    try { observer = env.observe(record, !started); started = true; }
    catch {
      truncated = true;
      if (!fallbackRead) { fallbackRead = true; try { record(env.entries()); } catch { available = false; } }
    }
  };
  const disconnect = () => { try { observer?.disconnect(); } catch {} observer = null; };
  const snapshot = () => {
    const now = env.now();
    if (observed && (!Number.isFinite(now) || now < observedAt || now - observedAt >= 600000)) { observed = false; advance(); }
    return { schemaVersion: 1, type: 'precursor-timing-cache', available: available && enabled && !suspended,
      ruleIds: available && enabled && !suspended && observed ? ['cf-precursor-versioned-loader-v1'] : [], revision, truncated };
  };
  connect();
  env.onCommand((trusted, message, respond) => {
    if (!trusted) return false;
    const type = own(message, 'type');
    if (type === 'bridge-control' && own(message, 'schemaVersion') === 1) {
      const command = own(message, 'command');
      if (['pause', 'stop', 'resume'].includes(command) && exact(message, ['schemaVersion', 'type', 'command'])) {
        reset(); enabled = command === 'resume'; if (!enabled) disconnect(); else connect();
      } else if (command === 'reset' && exact(message, ['schemaVersion', 'type', 'command', 'resetId']) && id(own(message, 'resetId')) && lastResetId !== own(message, 'resetId')) {
        reset(); lastResetId = own(message, 'resetId');
      }
      // The core collector owns bridge-control ACKs; do not race its responder.
      return false;
    }
    if (type === 'precursor-timing-reset' && exact(message, ['schemaVersion', 'type', 'resetId']) && own(message, 'schemaVersion') === 1 && id(own(message, 'resetId'))) {
      if (lastResetId !== own(message, 'resetId')) { reset(); lastResetId = own(message, 'resetId'); }
      respond({ schemaVersion: 1, type: 'precursor-timing-reset-ack', resetId: lastResetId }); return false;
    }
    if (type !== 'precursor-timing-query' || !exact(message, ['schemaVersion', 'type', 'sessionId']) || own(message, 'schemaVersion') !== 1 || !id(own(message, 'sessionId'))) return false;
    // Event-page/SW replacement cannot adopt a producer already queried by an older instance.
    if (sessionId !== null && sessionId !== own(message, 'sessionId')) reset();
    sessionId = own(message, 'sessionId'); connect();
    try { if (observer?.takeRecords) record(observer.takeRecords()); } catch { truncated = true; }
    respond(snapshot()); return false;
  });
  env.onHide(() => { reset(); suspended = true; disconnect(); });
  env.onRestore(() => { reset(); suspended = false; connect(); });
  env.onBufferFull(() => { truncated = true; });
});
  var installPrecursorTimingBridge = (function installPrecursorTimingBridge(start, classify, trust, api) {
  // Chrome has exact native network identity; avoid a second unused resource observer.
  try {
    // getBrowserInfo is not exposed in Firefox 138 content scripts; getURL is native in both realms.
    if (typeof api?.runtime?.getURL !== 'function' || !api.runtime.getURL('').startsWith('moz-extension://')) return;
    const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor;
    const getter = (prototype, key) => descriptor(prototype, key)?.get;
    const name = getter(PerformanceEntry.prototype, 'name'), time = getter(PerformanceEntry.prototype, 'startTime');
    const initiator = getter(PerformanceResourceTiming.prototype, 'initiatorType'), status = getter(PerformanceResourceTiming.prototype, 'responseStatus');
    const contentType = getter(PerformanceResourceTiming.prototype, 'contentType');
    const getEntries = Performance.prototype.getEntriesByType, now = Performance.prototype.now;
    start({ available: [name, time, initiator, status, contentType, getEntries, now].every(value => typeof value === 'function'),
      name: entry => apply(name, entry, []), start: entry => apply(time, entry, []), initiator: entry => apply(initiator, entry, []),
      status: entry => apply(status, entry, []), contentType: entry => apply(contentType, entry, []), classify,
      origin: () => location.origin, now: () => apply(now, performance, []), entries: () => apply(getEntries, performance, ['resource']),
      observe: (record, buffered) => { const observer = new PerformanceObserver(list => record(list.getEntries())); observer.observe({ type: 'resource', buffered }); return observer; },
      onCommand: listener => api.runtime.onMessage.addListener((message, sender, respond) => listener(trust(sender), message, respond)),
      onHide: listener => window.addEventListener('pagehide', listener),
      onRestore: listener => window.addEventListener('pageshow', event => { if (event.persisted) listener(); }),
      onBufferFull: listener => performance.addEventListener('resourcetimingbufferfull', listener) });
  } catch { /* Missing browser timing support stays unavailable. */ }
});
  // ADR-076 Precursor native timing bridge end

// ADR-038 writer bridge start
  var readCookieWriterRows = (() => {
// DET-049 / REQ-002/004/005/011: cookie setter names and script attribution only.
const COOKIE_WRITER_LIMITS = Object.freeze({ rows: 64, bytes: 24576, documents: 24, totalRows: 256, nameChars: 256 });
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
const doc = value => typeof value === 'string' && /^[0-9]+:[0-9]+:[A-Za-z0-9_-]{1,64}$/.test(value) && value.length <= 160;
const array = (value, max) => Array.isArray(value) && value.length <= max && Reflect.ownKeys(value).length === value.length + 1;
const cookieName = value => typeof value === 'string' && /^[!#$%&'*+\-.^_\x60|~0-9A-Za-z]{1,256}$/.test(value);
const scriptHost = value => typeof value === 'string' && value.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && !value.includes('..');
const scriptPath = value => typeof value === 'string' && /^\/(?:<script>|(?:main|client|script|sdk|gtm|fbevents|widgets|tracker|analytics)\.(?:js|mjs))$/.test(value);
const cookieWriterRowKey = row => row.name.length + ':' + row.name + ':' + row.phase + ':' + row.attributionConfidence + ':' + (row.script?.host ?? '') + ':' + (row.script?.pathTemplate ?? '');
const cookieWriterRowBytes = row => 512 + cookieWriterRowKey(row).length * 2;
function readCookieWriterRequest(value) {
  try {
    const frameId = Object.hasOwn(value, 'frameId') ? own(value, 'frameId') : 0;
    const keys = ['schemaVersion', 'type', 'tabId', 'documentKey']; if (Object.hasOwn(value, 'frameId')) keys.push('frameId');
    const tabId = own(value, 'tabId'), documentKey = own(value, 'documentKey');
    if (!exact(value, keys) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'ui-get-cookie-writers' || !Number.isSafeInteger(tabId) || tabId < 0 || !Number.isSafeInteger(frameId) || frameId < 0 || !doc(documentKey) || !documentKey.startsWith(tabId + ':' + frameId + ':')) return null;
    return { schemaVersion: 1, type: 'ui-get-cookie-writers', tabId, frameId, documentKey };
  } catch { return null; }
}
function readCookieWriterRows(value) {
  try {
    if (!array(value, COOKIE_WRITER_LIMITS.rows)) return null;
    const rows = [], seen = new Set(); let bytes = 512;
    const keys = ['name', 'phase', 'script', 'attributionConfidence', 'evidenceSource', 'integrity', 'count'];
    for (let index = 0; index < value.length; ++index) {
      const item = own(value, index);
      if (!exact(item, keys)) return null;
      const row = Object.fromEntries(keys.map(key => [key, own(item, key)]));
      if (!cookieName(row.name) || !['returned-sync', 'threw-sync'].includes(row.phase) || row.evidenceSource !== 'page-hook' || row.integrity !== 'page-controlled' || !['exact-resource', 'sampled-stack', 'unknown'].includes(row.attributionConfidence) || !Number.isSafeInteger(row.count) || row.count < 1 || row.count > 2147483647) return null;
      if (row.script === null) { if (row.attributionConfidence !== 'unknown') return null; }
      else {
        if (row.attributionConfidence === 'unknown' || !exact(row.script, ['host', 'pathTemplate'])) return null;
        const host = own(row.script, 'host'), pathTemplate = own(row.script, 'pathTemplate');
        if (!scriptHost(host) || !scriptPath(pathTemplate)) return null;
        row.script = { host, pathTemplate };
      }
      const key = cookieWriterRowKey(row);
      if (seen.has(key) || (bytes += cookieWriterRowBytes(row)) > COOKIE_WRITER_LIMITS.bytes) return null;
      seen.add(key); rows.push(row);
    }
    return rows;
  } catch { return null; }
}
function readCookieWriterSnapshot(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'documentKey', 'coverageState', 'rows', 'truncated']) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'cookie-writers-state' || !doc(own(value, 'documentKey')) || !['active', 'partial', 'late-start', 'paused', 'unsupported', 'no-access', 'degraded'].includes(own(value, 'coverageState')) || typeof own(value, 'truncated') !== 'boolean') return null;
    const rows = readCookieWriterRows(own(value, 'rows'));
    if (!rows || rows.length && ['paused', 'unsupported', 'no-access'].includes(own(value, 'coverageState'))) return null;
    return { schemaVersion: 1, type: 'cookie-writers-state', documentKey: own(value, 'documentKey'), coverageState: own(value, 'coverageState'), rows, truncated: own(value, 'truncated') };
  } catch { return null; }
}
function readCookieWriterCache(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'available', 'rows', 'truncated']) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'cookie-writers-cache' || typeof own(value, 'available') !== 'boolean' || typeof own(value, 'truncated') !== 'boolean') return null;
    const rows = readCookieWriterRows(own(value, 'rows'));
    if (!rows || !own(value, 'available') && rows.length) return null;
    return { schemaVersion: 1, type: 'cookie-writers-cache', available: own(value, 'available'), rows, truncated: own(value, 'truncated') };
  } catch { return null; }
}
function readCookieWriterDocuments(value) {
  try {
    if (!array(value, COOKIE_WRITER_LIMITS.documents)) return null;
    const documents = [], seen = new Set(); let count = 0;
    for (let index = 0; index < value.length; ++index) {
      const snapshot = readCookieWriterSnapshot(own(value, index));
      if (!snapshot || seen.has(snapshot.documentKey) || (count += snapshot.rows.length) > COOKIE_WRITER_LIMITS.totalRows) return null;
      seen.add(snapshot.documentKey); documents.push(snapshot);
    }
    return documents;
  } catch { return null; }
}

return readCookieWriterRows;
})();
  // packages/collector/src/cookie-writers.ts
  var startCookieWriterBridge = (function startCookieWriterBridge(env, readRows) {
  const descriptor = Object.getOwnPropertyDescriptor, ownKeys = Reflect.ownKeys, hasOwn = Object.hasOwn;
  const field = (value, key) => value && typeof value === 'object' ? descriptor(value, key)?.value : undefined;
  const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && ownKeys(value).length === names.length && names.every(name => hasOwn(descriptor(value, name) ?? {}, 'value'));
  let pending = null, sequence = 0, nextReadAt = -Infinity;
  const empty = () => ({ schemaVersion: 1, type: 'cookie-writers-cache', available: false, rows: [], truncated: true });
  const finish = (available, rows = [], truncated = true) => {
    if (!pending) return;
    const current = pending; pending = null; env.cancel(current.timer); nextReadAt = env.now() + 500;
    current.respond(available ? { schemaVersion: 1, type: 'cookie-writers-cache', available: true, rows, truncated } : empty());
  };
  env.onPage((sameWindow, data) => {
    if (!sameWindow || !pending || !pending.posted || field(data, 'channel') !== 'detect.expert/cookie-writers/v1' || field(data, 'type') !== 'cookie-writers-batch' || field(data, 'requestId') !== pending.requestId) return;
    if (pending.admitted++ >= 8 || !exact(data, ['channel', 'type', 'requestId', 'enabled', 'rows', 'truncated']) || typeof field(data, 'enabled') !== 'boolean' || typeof field(data, 'truncated') !== 'boolean') return;
    const rows = readRows(field(data, 'rows'));
    if (!rows || JSON.stringify(rows).length * 2 > 24576) return;
    finish(field(data, 'enabled'), rows, field(data, 'truncated'));
  });
  env.onCommand((trusted, data, respond) => {
    if (!trusted || !exact(data, ['schemaVersion', 'type']) || field(data, 'schemaVersion') !== 1 || field(data, 'type') !== 'cookie-writers-query') return false;
    if (pending || sequence >= 2147483647) { respond(empty()); return false; }
    const current = { requestId: 'cookie-writers-' + ++sequence, respond, admitted: 0, timer: null, posted: false }; pending = current;
    const post = () => {
      if (pending !== current) return;
      current.posted = true; current.timer = env.later(() => finish(false), 400);
      env.post({ channel: 'detect.expert/cookie-writers/v1', type: 'cookie-writers-read', requestId: current.requestId });
    };
    const delay = Math.max(0, nextReadAt - env.now());
    if (delay) current.timer = env.later(post, delay); else post();
    return true;
  });
  env.onHide(() => finish(false));
});
  function startBrowserCookieWriterBridge() {
    startCookieWriterBridge({
      onPage: listener => window.addEventListener("message", event => listener(event.source === window, event.data)),
      onCommand: listener => chrome.runtime.onMessage.addListener((message, sender, respond) => listener(isOwnServiceWorker(sender), message, respond)),
      onHide: listener => window.addEventListener("pagehide", listener),
      post: message => window.postMessage(message, "*"),
      later: (callback, delay) => setTimeout(callback, delay), cancel: timer => clearTimeout(timer), now: () => performance.now(),
    }, readCookieWriterRows);
  }

// ADR-038 writer bridge end
  // apps/extension/entrypoints/bridge.ts
  (() => {
    try {
      let mark = /* @__PURE__ */ Symbol.for("detect.expert/bridge/v1");
      if (Object.getOwnPropertyDescriptor(globalThis, mark) !== void 0) return;
      Object.defineProperty(globalThis, mark, { value: !0, writable: !1, enumerable: !1, configurable: !1 });
      let collector = startCollector(createBrowserCollectorEnv());
      startBrowserCookieWriterBridge(), startBrowserVisualBridge(), startBrowserRtcBridge(), startBrowserProtectionBridge(), startBrowserApiResultsBridge(), startProValuesBridge(), startBrowserSocialValuesBridge(), startBrowserBackgroundValuesBridge(), startBrowserBeaconBridges(), startBrowserThirdPartyTimingBridge();
      installPrecursorTimingBridge(startPrecursorTimingBridge, classifyPrecursorTimingResource, isOwnServiceWorker, chrome);
      try {
        let frame = window.frameElement;
        window !== window.parent && frame?.localName === "iframe" && frame.hasAttribute("sandbox") && !frame.sandbox.contains("allow-scripts") && window.parent.postMessage("detect.expert/child-realm/v1", "*");
      } catch {
      }
    } catch {
    }
  })();
})();
