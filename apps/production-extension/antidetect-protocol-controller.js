// ADR-064: a separate Chrome-native protocol guard; Firewall owns its existing ranges.
import { validateApiConfiguration, effectiveApiConfiguration } from './api-configuration.js';

// Disjoint from Firewall gpc 1..99, decisions 100000..100999,
// preset 101000..101023 and session 200000..200127.
export const ANTIDETECT_PROTOCOL_RULE_IDS = Object.freeze({ websocket: 300000, webtransport: 300001 });
const TYPES = Object.freeze(['websocket', 'webtransport']), PRIORITY = 1000, DEADLINE = 5000;
const ours = rule => rule?.id === ANTIDETECT_PROTOCOL_RULE_IDS.websocket || rule?.id === ANTIDETECT_PROTOCOL_RULE_IDS.webtransport;
const clone = value => JSON.parse(JSON.stringify(value));

export function buildAntidetectProtocolRules(configuration, scopeMatches, active) {
  const checked = validateApiConfiguration(configuration);
  if (!checked.ok || typeof active !== 'boolean' || !Array.isArray(scopeMatches) || scopeMatches.some(value => typeof value !== 'string')) return { status: 'error', rules: [] };
  if (!active || !checked.value.enabled) return { status: 'inactive', rules: [] };
  const matches = new Set(scopeMatches);
  // DNR initiatorDomains includes subdomains. It cannot represent the canonical
  // exact-host site overrides, nor per-document active-tab scope, without widening.
  if (!(matches.has('http://*/*') && matches.has('https://*/*'))) return { status: 'unsupported', rules: [] };
  const config = checked.value, global = effectiveApiConfiguration({ ...config, sites: [] }, 'antidetect-protocol.invalid');
  const enabled = id => global.some(row => row.id === id && row.mode === 'on');
  const supported = { websocket: true, webtransport: true };
  for (const site of config.sites) {
    // The strict validator already normalized every site. Do not revalidate the
    // whole configuration once per host (128 sites can hold megabytes of data).
    for (const id of TYPES) {
      const local = site.apis.find(row => row.id === id);
      const blocked = !site.disabled && (local.mode === 'bypass' ? enabled(id) : local.mode === 'on');
      if (site.disabled || blocked !== enabled(id)) supported[id] = false;
    }
  }
  const rules = TYPES.filter(id => supported[id] && enabled(id)).map(id => ({ id: ANTIDETECT_PROTOCOL_RULE_IDS[id], priority: PRIORITY,
    action: { type: 'block' }, condition: { resourceTypes: [id] } }));
  return { status: TYPES.some(id => !supported[id]) ? 'unsupported' : rules.length ? 'applied' : 'inactive', rules };
}

function identical(actual, desired) {
  if (!Array.isArray(actual) || actual.length !== desired.length) return false;
  return desired.every(wanted => {
    const rule = actual.find(value => value.id === wanted.id);
    return rule && Object.keys(rule).every(key => ['id', 'priority', 'action', 'condition'].includes(key)) && rule.priority === wanted.priority &&
      rule.action && Object.keys(rule.action).length === 1 && rule.action.type === 'block' && rule.condition && Object.keys(rule.condition).length === 1 &&
      Array.isArray(rule.condition.resourceTypes) && rule.condition.resourceTypes.length === 1 && rule.condition.resourceTypes[0] === wanted.condition.resourceTypes[0];
  });
}

export class AntidetectProtocolController {
  constructor(api, { timeoutMs = DEADLINE } = {}) {
    this.api = api; this.timeoutMs = timeoutMs; this.chain = Promise.resolve(); this.pendingPhysical = null; this.state = { status: 'inactive' };
  }
  snapshot(status) { return this.state = { status }; }
  inspect() { return { ...this.state }; }
  nativeApi() { return globalThis.browser?.runtime?.id === this.api.runtime?.id ? globalThis.browser : this.api; }
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
    const desired = buildAntidetectProtocolRules(configuration, scopeMatches, active);
    const run = () => this.apply(desired);
    const next = this.chain.then(run, run);
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }
  async apply(desired) {
    // Invalid input must not modify a previously applied valid configuration.
    if (desired.status === 'error') return this.snapshot('error');
    const api = this.nativeApi();
    let dnr;
    try {
      if (!api.runtime.getURL('').startsWith('chrome-extension://')) return this.snapshot('unsupported');
      dnr = api.declarativeNetRequest;
      if (typeof dnr?.getDynamicRules !== 'function' || typeof dnr?.updateDynamicRules !== 'function') return this.snapshot('unsupported');
      if (this.pendingPhysical !== null) return this.snapshot('error');
      const existing = await this.bounded(() => dnr.getDynamicRules());
      if (!Array.isArray(existing) || existing.length > 50000) return this.snapshot('error');
      const own = existing.filter(ours);
      if (identical(own, desired.rules)) return this.snapshot(desired.status);
      const payload = { removeRuleIds: own.map(rule => rule.id), addRules: clone(desired.rules) };
      const result = await this.bounded(() => dnr.updateDynamicRules(payload));
      if (result === false) return this.snapshot('error');
      const actual = await this.bounded(() => dnr.getDynamicRules());
      if (!Array.isArray(actual) || actual.length > 50000 || !identical(actual.filter(ours), desired.rules)) return this.snapshot('error');
      return this.snapshot(desired.status);
    } catch { return this.snapshot('error'); }
  }
}
