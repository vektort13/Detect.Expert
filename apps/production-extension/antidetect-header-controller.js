// ADR-105: Chrome request headers follow the selected Custom JavaScript identity (declarativeNetRequest modifyHeaders).
import { validateApiConfiguration } from './api-configuration.js';

// Disjoint from Firewall gpc 1..99, decisions 100000..100999, preset 101000..101023,
// session 200000..200127 and the protocol guard 300000/300001. 300110..300119 stay
// reserved: reconcile removes any rule found there, no other module may use them.
export const ANTIDETECT_HEADER_RULE_IDS = Object.freeze({ userAgent: 300100, acceptLanguage: 300101, clientHints: 300102, highEntropy: 300103,
  deviceMemory: 300104, pixelRatio: 300105, viewport: 300106, network: 300107, preferences: 300108, clientData: 300109 });
export const ANTIDETECT_HEADER_RULE_RANGE = Object.freeze([300100, 300119]);
export const ANTIDETECT_HEADER_PRIORITY = 1000;
// Exactly the types Chrome 153/156 were measured to rewrite (ADR-105). webtransport and webbundle stay unlisted: unverified.
export const ANTIDETECT_HEADER_REQUEST_TYPES = Object.freeze(['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other']);
// A WebSocket handshake never carries client hints natively, so a `set` rule must not add them there.
const HINT_REQUEST_TYPES = Object.freeze(ANTIDETECT_HEADER_REQUEST_TYPES.filter(type => type !== 'websocket'));
export const ANTIDETECT_LOW_ENTROPY_HINTS = Object.freeze(['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform']);
export const ANTIDETECT_HIGH_ENTROPY_HINTS = Object.freeze(['sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-full-version', 'sec-ch-ua-full-version-list', 'sec-ch-ua-model', 'sec-ch-ua-platform-version', 'sec-ch-ua-wow64', 'sec-ch-ua-form-factors']);
// Remove-only groups: hints Chrome sends after Accept-CH with the REAL value (measured on Chromium 153 and Chrome 156, https and
// loopback http). Each group is active only while its own Custom row is; a value is never set, only removed. Names Chrome never
// sent in any configuration tried (viewport-height, save-data, sec-ch-prefers-contrast) are deliberately absent. Width/Sec-CH-Width
// (image slot width) have no matching row and stay native.
export const ANTIDETECT_HINT_GROUPS = Object.freeze({
  deviceMemory: Object.freeze({ row: 'device-memory', headers: Object.freeze(['device-memory', 'sec-ch-device-memory']) }),
  pixelRatio: Object.freeze({ row: 'window-device-pixel-ratio', headers: Object.freeze(['dpr', 'sec-ch-dpr']) }),
  viewport: Object.freeze({ row: 'screen-geometry', headers: Object.freeze(['viewport-width', 'sec-ch-viewport-width', 'sec-ch-viewport-height']) }),
  network: Object.freeze({ row: 'network-information', headers: Object.freeze(['ect', 'rtt', 'downlink']) }),
  preferences: Object.freeze({ row: 'css-media', headers: Object.freeze(['sec-ch-prefers-color-scheme', 'sec-ch-prefers-reduced-motion', 'sec-ch-prefers-reduced-transparency']) }),
});
// Google Chrome appends its field-trial ids to requests for Google-owned hosts (measured: Chrome 156 and Chromium 153 with variation ids, https only, never on
// a WebSocket handshake). Real Edge and Firefox do not, so an identity that claims another browser has it removed; it is never set and never added.
export const ANTIDETECT_CLIENT_DATA_HEADER = 'x-client-data';
const CANONICAL = Object.freeze({ 'x-client-data': 'X-Client-Data', 'user-agent': 'User-Agent', 'accept-language': 'Accept-Language', 'sec-ch-ua': 'Sec-CH-UA', 'sec-ch-ua-mobile': 'Sec-CH-UA-Mobile', 'sec-ch-ua-platform': 'Sec-CH-UA-Platform',
  'sec-ch-ua-arch': 'Sec-CH-UA-Arch', 'sec-ch-ua-bitness': 'Sec-CH-UA-Bitness', 'sec-ch-ua-full-version': 'Sec-CH-UA-Full-Version', 'sec-ch-ua-full-version-list': 'Sec-CH-UA-Full-Version-List',
  'sec-ch-ua-model': 'Sec-CH-UA-Model', 'sec-ch-ua-platform-version': 'Sec-CH-UA-Platform-Version', 'sec-ch-ua-wow64': 'Sec-CH-UA-WoW64', 'sec-ch-ua-form-factors': 'Sec-CH-UA-Form-Factors',
  'device-memory': 'Device-Memory', 'sec-ch-device-memory': 'Sec-CH-Device-Memory', 'dpr': 'DPR', 'sec-ch-dpr': 'Sec-CH-DPR', 'viewport-width': 'Viewport-Width', 'sec-ch-viewport-width': 'Sec-CH-Viewport-Width',
  'sec-ch-viewport-height': 'Sec-CH-Viewport-Height', 'ect': 'ECT', 'rtt': 'RTT', 'downlink': 'Downlink', 'sec-ch-prefers-color-scheme': 'Sec-CH-Prefers-Color-Scheme',
  'sec-ch-prefers-reduced-motion': 'Sec-CH-Prefers-Reduced-Motion', 'sec-ch-prefers-reduced-transparency': 'Sec-CH-Prefers-Reduced-Transparency' });
const GROUP_KEYS = Object.freeze(Object.keys(ANTIDETECT_HINT_GROUPS));
const USED_ROWS = Object.freeze(['navigator-user-agent', 'navigator-languages', 'navigator-language', 'client-hints', ...GROUP_KEYS.map(key => ANTIDETECT_HINT_GROUPS[key].row)]);
const DEADLINE = 5000, MAX_HEADER_VALUE = 4096;
const clone = value => JSON.parse(JSON.stringify(value));
const ours = rule => Number.isSafeInteger(rule?.id) && rule.id >= ANTIDETECT_HEADER_RULE_RANGE[0] && rule.id <= ANTIDETECT_HEADER_RULE_RANGE[1];
const outcome = (status, reason = null, items = []) => ({ status, reason, items });

// Chrome neither trims nor escapes for us: CR/LF is rejected by DNR but a control character is accepted and then
// makes servers answer 400 (measured). Only visible ASCII without edge spaces is ever written.
const headerValue = text => typeof text === 'string' && text.length > 0 && text.length <= MAX_HEADER_VALUE && /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/.test(text);
const quoted = text => typeof text === 'string' && /^[\x20-\x7e]*$/.test(text) ? '"' + text.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"' : null;

// Chrome builds `en-US,en;q=0.9`: the first tag bare, then q = 0.9, 0.8 ... with a floor of 0.1 (measured to 10 entries).
function acceptLanguage(tags) {
  if (!Array.isArray(tags) || tags.length === 0 || tags.some(tag => typeof tag !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(tag))) return null;
  const value = tags.map((tag, index) => index === 0 ? tag : tag + ';q=0.' + Math.max(1, 10 - index)).join(',');
  return headerValue(value) ? value : null;
}
// Same list and order as navigator.userAgentData.brands: `"Chromium";v="156", "Not.A/Brand";v="24"`.
function brandList(brands) {
  const parts = [];
  for (const item of brands) {
    const brand = quoted(item?.brand), version = quoted(item?.version);
    if (brand === null || version === null) return null;
    parts.push(brand + ';v=' + version);
  }
  const value = parts.join(', ');
  return value.length <= MAX_HEADER_VALUE ? value : null;
}
// Which engine family the selected User-Agent claims. Only a Gecko or WebKit claim means "this browser sends no UA-CH".
export function claimedFamily(agent) {
  if (typeof agent !== 'string') return 'unknown';
  if (/(?:CriOS|FxiOS|EdgiOS|OPiOS)\//.test(agent)) return 'safari';
  if (/(?:Chrome|Chromium)\//.test(agent)) return 'chromium';
  if (/Firefox\//.test(agent)) return 'firefox';
  if (/Safari\//.test(agent)) return 'safari';
  return 'unknown';
}

// Which product the selected User-Agent names (a different question from the engine family above). A bare Chrome/ token cannot tell Google Chrome
// from Chromium, so it stays 'chrome': only an explicitly named other product (an explicit Chromium/ token included) counts as a claim against Google Chrome.
export function claimedBrand(agent) {
  if (typeof agent !== 'string') return 'unknown';
  if (/(?:^| )(?:Edg|EdgA|EdgiOS|Edge)[/]/.test(agent)) return 'edge';
  if (/(?:^| )(?:OPR|OPiOS|Opera|Opera Mini)[/]/.test(agent)) return 'opera';
  if (/(?:^| )(?:Firefox|FxiOS)[/]/.test(agent)) return 'firefox';
  if (/(?:^| )SamsungBrowser[/]/.test(agent)) return 'samsung';
  if (/(?:^| )YaBrowser[/]/.test(agent)) return 'yandex';
  if (/(?:^| )Vivaldi[/]/.test(agent)) return 'vivaldi';
  if (/(?:^| )Chromium[/]/.test(agent)) return 'chromium';
  if (/(?:Chrome|CriOS)[/]/.test(agent)) return 'chrome';
  if (/Safari[/]/.test(agent)) return 'safari';
  return 'unknown';
}
const OTHER_PRODUCTS = Object.freeze(['edge', 'opera', 'firefox', 'samsung', 'yandex', 'vivaldi', 'chromium', 'safari']);
// True when the Custom identity says it is not Google Chrome: a client-hints brand list without "Google Chrome" (an empty list claims no UA-CH at all),
// or a User-Agent that names another product. Either source is enough: a browser without X-Client-Data is plausible for any identity, one with it is not.
function claimsOtherThanGoogleChrome(current) {
  if (current.hints !== undefined && !current.hints.brands.some(item => item?.brand === 'Google Chrome')) return true;
  return current.agent !== undefined && OTHER_PRODUCTS.includes(claimedBrand(current.agent));
}

// The contributions of the rows; only Custom rows with a value count, and only while the Custom master is on.
// Remove-only groups depend on the row being Custom, never on its value, so a differing site value is no difference.
function view(lookup, live) {
  const custom = id => { const row = lookup(id); return live && row?.mode === 'custom' && row.selected?.kind === 'value' ? row.selected.value : undefined; };
  const output = { agent: custom('navigator-user-agent'), languages: custom('navigator-languages'), language: custom('navigator-language'), hints: custom('client-hints') };
  for (const key of GROUP_KEYS) output[key] = custom(ANTIDETECT_HINT_GROUPS[key].row) === undefined ? undefined : true;
  return output;
}
const empty = current => Object.values(current).every(item => item === undefined);

// Items are the independent rule groups: { id, operation, headers: [[lowercase name, value?]] }.
function derive(current) {
  const items = []; let invalid = false;
  if (current.agent !== undefined) {
    if (headerValue(current.agent)) items.push({ id: 'userAgent', operation: 'set', headers: [['user-agent', current.agent]] }); else invalid = true;
  }
  const tags = current.languages !== undefined ? current.languages : current.language !== undefined ? [current.language] : undefined;
  if (tags !== undefined) {
    const value = acceptLanguage(tags);
    if (value !== null) items.push({ id: 'acceptLanguage', operation: 'set', headers: [['accept-language', value]] }); else invalid = true;
  }
  const family = current.agent === undefined ? 'unknown' : claimedFamily(current.agent);
  const noHints = current.hints !== undefined ? current.hints.brands.length === 0 : family === 'firefox' || family === 'safari';
  if (current.hints !== undefined && !noHints) {
    const list = brandList(current.hints.brands), platform = quoted(current.hints.platform);
    if (list !== null && list.length > 0 && platform !== null) items.push({ id: 'clientHints', operation: 'set', headers: [['sec-ch-ua', list], ['sec-ch-ua-mobile', current.hints.mobile ? '?1' : '?0'], ['sec-ch-ua-platform', platform]] });
    else invalid = true;
  } else if (noHints) items.push({ id: 'clientHints', operation: 'remove', headers: ANTIDETECT_LOW_ENTROPY_HINTS.map(name => [name]) });
  // A server may ask for the rest through Accept-CH/Critical-CH. Setting a value would add headers nobody requested, so they are only removed.
  if (current.hints !== undefined || noHints) items.push({ id: 'highEntropy', operation: 'remove', headers: ANTIDETECT_HIGH_ENTROPY_HINTS.map(name => [name]) });
  // Real device, viewport, network and preference hints would contradict their Custom row; only removal is ever generated.
  for (const key of GROUP_KEYS) if (current[key] === true) items.push({ id: key, operation: 'remove', headers: ANTIDETECT_HINT_GROUPS[key].headers.map(name => [name]) });
  // Only Google Chrome sends X-Client-Data; an identity that claims another browser must not carry it. Removal only: a value is never set.
  if (claimsOtherThanGoogleChrome(current)) items.push({ id: 'clientData', operation: 'remove', headers: [[ANTIDETECT_CLIENT_DATA_HEADER]] });
  return { items, invalid };
}

function plan(configuration, scopeMatches, active, chrome) {
  const checked = validateApiConfiguration(configuration);
  if (!checked.ok || typeof active !== 'boolean' || !Array.isArray(scopeMatches) || scopeMatches.some(value => typeof value !== 'string')) return outcome('error', 'invalid');
  if (chrome !== true) return outcome('unsupported', 'engine');
  const config = checked.value, live = active && config.antidetectEnabled === true;
  if (!live) return outcome('inactive');
  const globalRows = new Map(config.apis.filter(row => USED_ROWS.includes(row.id)).map(row => [row.id, row]));
  const wanted = view(id => globalRows.get(id), true);
  // DNR domains include subdomains and cannot name one exact host: every exact-site entry must resolve to the global view.
  // The strict validator already normalized every site; do not revalidate the whole configuration once per host.
  const wantedKey = JSON.stringify(wanted);
  const siteDiffers = config.sites.some(site => {
    if (site.disabled) return !empty(wanted);
    const local = new Map(site.apis.filter(row => USED_ROWS.includes(row.id) && row.mode !== 'bypass').map(row => [row.id, row]));
    return JSON.stringify(view(id => local.get(id) ?? globalRows.get(id), true)) !== wantedKey;
  });
  if (empty(wanted) && !siteDiffers) return outcome('inactive');
  const matches = new Set(scopeMatches);
  if (!(matches.has('http://*/*') && matches.has('https://*/*'))) return outcome('unsupported', 'scope');
  if (siteDiffers) return outcome('unsupported', 'site-overrides');
  const derived = derive(wanted);
  if (derived.invalid) return outcome('unsupported', 'invalid');
  return derived.items.length ? outcome('applied', null, derived.items) : outcome('inactive');
}

const names = (items, operation) => items.filter(item => item.operation === operation).flatMap(item => item.headers.map(([name]) => name));
const description = result => ({ status: result.status, set: names(result.items, 'set'), removed: names(result.items, 'remove'), reason: result.reason });

// Pure: what the UI shows. No chrome.* access; `chrome` must be exactly true on a Chrome-family build.
export function describeAntidetectHeaders(configuration, scopeMatches, active, options = {}) {
  return description(plan(configuration, scopeMatches, active, options?.chrome));
}

const RULE_CONDITION_KEYS = ['resourceTypes', 'excludedInitiatorDomains', 'urlFilter'];
function ruleFor(item, extensionId) {
  const set = item.operation === 'set', hints = item.id === 'clientHints';
  const requestHeaders = item.headers.map(([name, value]) => set ? { header: CANONICAL[name], operation: 'set', value } : { header: CANONICAL[name], operation: 'remove' });
  // Hints are set only for https (Chrome sends none to a non-trustworthy http origin) and never for a WebSocket handshake.
  const condition = { resourceTypes: [...(set && hints ? HINT_REQUEST_TYPES : ANTIDETECT_HEADER_REQUEST_TYPES)], excludedInitiatorDomains: [extensionId] };
  if (set && hints) condition.urlFilter = '|https://';
  return { id: ANTIDETECT_HEADER_RULE_IDS[item.id], priority: ANTIDETECT_HEADER_PRIORITY, action: { type: 'modifyHeaders', requestHeaders }, condition };
}

// Pure: the description plus the exact dynamic rules for it. Every desired rule is generated from `plan`, never from caller input.
export function buildAntidetectHeaderRules(configuration, scopeMatches, active, options = {}) {
  const result = plan(configuration, scopeMatches, active, options?.chrome), extensionId = options?.extensionId;
  if (result.items.length && (typeof extensionId !== 'string' || !/^[a-z0-9.-]{1,253}$/.test(extensionId))) return { ...description(outcome('error', 'invalid')), rules: [] };
  return { ...description(result), rules: result.items.map(item => ruleFor(item, extensionId)) };
}

const inert = value => value === undefined || value === false || Array.isArray(value) && value.length === 0;
const sameSet = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length && new Set(left).size === left.length && right.every(item => left.includes(item));
function sameRule(rule, wanted) {
  if (!rule || typeof rule !== 'object' || !Object.keys(rule).every(key => ['id', 'priority', 'action', 'condition'].includes(key)) || rule.priority !== wanted.priority) return false;
  const action = rule.action, headers = action?.requestHeaders;
  if (!action || action.type !== 'modifyHeaders' || !Object.keys(action).every(key => ['type', 'requestHeaders'].includes(key) || inert(action[key]))) return false;
  const expected = wanted.action.requestHeaders;
  if (!Array.isArray(headers) || headers.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index++) {
    const have = headers[index], want = expected[index];
    if (!have || typeof have.header !== 'string' || have.header.toLowerCase() !== want.header.toLowerCase() || have.operation !== want.operation || have.value !== want.value) return false;
    if (!Object.keys(have).every(key => ['header', 'operation', 'value'].includes(key))) return false;
  }
  const condition = rule.condition;
  if (!condition || typeof condition !== 'object') return false;
  for (const key of RULE_CONDITION_KEYS) {
    if (key === 'urlFilter') { if (condition.urlFilter !== wanted.condition.urlFilter) return false; } else if (!sameSet(condition[key], wanted.condition[key])) return false;
  }
  return Object.keys(condition).every(key => RULE_CONDITION_KEYS.includes(key) || inert(condition[key]));
}
function identical(actual, desired) {
  if (!Array.isArray(actual) || actual.length !== desired.length) return false;
  return desired.every(wanted => sameRule(actual.find(value => value?.id === wanted.id), wanted));
}

export class AntidetectHeaderController {
  constructor(api, { timeoutMs = DEADLINE } = {}) {
    this.api = api; this.timeoutMs = timeoutMs; this.chain = Promise.resolve(); this.pendingPhysical = null;
    this.state = { status: 'inactive', set: [], removed: [], reason: null };
  }
  snapshot(result) { return this.state = { status: result.status, set: [...result.set], removed: [...result.removed], reason: result.reason ?? null }; }
  failure() { return this.snapshot({ status: 'error', set: [], removed: [], reason: null }); }
  inspect() { return clone(this.state); }
  nativeApi() { return globalThis.browser?.runtime?.id === this.api.runtime?.id ? globalThis.browser : this.api; }
  chromeBuild() { try { return this.api.runtime.getURL('').startsWith('chrome-extension://'); } catch { return false; } }
  async bounded(operation) {
    if (this.pendingPhysical !== null) throw Error('busy');
    // Keep the mutex until the actual native Promise settles, including after a
    // visible timeout. A hanging write must never overlap a retry or cleanup.
    const physical = Promise.resolve().then(operation);
    this.pendingPhysical = physical;
    void physical.then(() => { if (this.pendingPhysical === physical) this.pendingPhysical = null; }, () => { if (this.pendingPhysical === physical) this.pendingPhysical = null; });
    let timer;
    try { return await Promise.race([physical, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('timeout')), this.timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }
  reconcile(configuration, scopeMatches, active) {
    const desired = buildAntidetectHeaderRules(configuration, scopeMatches, active, { chrome: this.chromeBuild(), extensionId: this.api.runtime?.id });
    const run = () => this.apply(desired);
    const next = this.chain.then(run, run);
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }
  async apply(desired) {
    // Invalid input must not modify a previously applied valid configuration.
    if (desired.status === 'error') return this.failure();
    // Other engines never had our rules: nothing to read, nothing to clean.
    if (desired.reason === 'engine') return this.snapshot(desired);
    const api = this.nativeApi();
    try {
      const dnr = api.declarativeNetRequest;
      if (typeof dnr?.getDynamicRules !== 'function' || typeof dnr?.updateDynamicRules !== 'function') return this.snapshot({ status: 'unsupported', set: [], removed: [], reason: 'engine' });
      if (this.pendingPhysical !== null) return this.failure();
      const existing = await this.bounded(() => dnr.getDynamicRules());
      if (!Array.isArray(existing) || existing.length > 50000) return this.failure();
      const own = existing.filter(ours);
      if (identical(own, desired.rules)) return this.snapshot(desired);
      const payload = { removeRuleIds: own.map(rule => rule.id), addRules: clone(desired.rules) };
      const result = await this.bounded(() => dnr.updateDynamicRules(payload));
      if (result === false) return this.failure();
      const actual = await this.bounded(() => dnr.getDynamicRules());
      if (!Array.isArray(actual) || actual.length > 50000 || !identical(actual.filter(ours), desired.rules)) return this.failure();
      return this.snapshot(desired);
    } catch { return this.failure(); }
  }
}
