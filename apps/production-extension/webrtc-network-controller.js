// ADR-060: optional, explicit browser-wide WebRTC policy; never restores another owner's value.
// Round 5: Firefox's privacy API has one more value, 'proxy_only' (stricter than disable_non_proxied_udp: every WebRTC connection must go through a
// proxy, so calls fail when none carries UDP). Chrome's API has no such value, so a Chrome build never writes it; a stored choice shows "unsupported".
// Listed from the weakest to the strictest: the stricter of the chosen policy and the Proxy module's requirement wins.
export const WEBRTC_POLICIES = Object.freeze(['system', 'default_public_interface_only', 'disable_non_proxied_udp', 'proxy_only']);
export const WEBRTC_FIREFOX_ONLY_POLICIES = Object.freeze(['proxy_only']);
// The fixed code that refuses applying a choice this browser cannot apply (nothing is written).
export const WEBRTC_POLICY_UNSUPPORTED_CODE = 'webrtc-policy-unsupported';
const POLICIES = WEBRTC_POLICIES;
const CONTROLS = ['not_controllable', 'controlled_by_other_extensions', 'controllable_by_this_extension', 'controlled_by_this_extension'];
export class WebRtcNetworkController {
  constructor(api) {
    this.api = api; this.desired = 'system'; this.proxyActive = false; this.queue = Promise.resolve(); this.releaseNeeded = true; this.releaseFailed = false; this.mutationAttempted = false;
    this.state = { desired: 'system', status: 'inactive', value: null, levelOfControl: null };
  }
  nativeApi() {
    return globalThis.browser?.runtime?.id === this.api.runtime?.id ? globalThis.browser : this.api;
  }
  async allowed() {
    try { return await this.nativeApi().permissions.contains({ permissions: ['privacy'] }) === true; }
    catch { return false; }
  }
  snapshot(status, details = null) {
    return this.state = { desired: this.desired, status,
      value: typeof details?.value === 'string' && details.value.length <= 64 ? details.value : null,
      levelOfControl: CONTROLS.includes(details?.levelOfControl) ? details.levelOfControl : null };
  }
  firefoxBuild() { try { return this.api.runtime.getURL('').startsWith('moz-extension:'); } catch { return false; } }
  /** True when this browser's privacy API has the value: the three shared ones everywhere, 'proxy_only' only in a Firefox build. */
  supports(policy) { return POLICIES.includes(policy) && (!WEBRTC_FIREFOX_ONLY_POLICIES.includes(policy) || this.firefoxBuild()); }
  /** The fixed refusal code for a choice this browser cannot apply, or null when it can be applied. */
  refusal(policy) { return POLICIES.includes(policy) && !this.supports(policy) ? WEBRTC_POLICY_UNSUPPORTED_CODE : null; }
  refused() { return !this.supports(this.desired); }
  // A choice this browser cannot apply counts as System (it is released, never replaced); the Proxy requirement never drops below disable_non_proxied_udp.
  effectivePolicy() {
    const chosen = this.supports(this.desired) ? this.desired : 'system';
    return this.proxyActive && POLICIES.indexOf(chosen) < POLICIES.indexOf('disable_non_proxied_udp') ? 'disable_non_proxied_udp' : chosen;
  }
  // A refused choice is reported as unsupported instead of "unchanged"; errors, permission loss and a still applied Proxy requirement keep their own status.
  view(state) { return this.refused() && state.status === 'inactive' ? this.snapshot('unsupported', state) : state; }
  async inspect() { return this.view(await this.read()); }
  async read() {
    const effective = this.effectivePolicy();
    if (!await this.allowed()) return this.snapshot(effective === 'system' && !this.mutationAttempted && !this.releaseFailed ? 'inactive' : 'permission-required');
    const setting = this.nativeApi().privacy?.network?.webRTCIPHandlingPolicy;
    if (!setting || typeof setting.get !== 'function') return this.snapshot('unsupported');
    try {
      const details = await setting.get({});
      if (!CONTROLS.includes(details?.levelOfControl)) return this.snapshot('error');
      if (details.levelOfControl === 'controlled_by_this_extension') this.mutationAttempted = true;
      if (effective === 'system') return this.snapshot(this.releaseFailed || details.levelOfControl === 'controlled_by_this_extension' ? 'error' : 'inactive', details);
      return this.snapshot(details.levelOfControl === 'controlled_by_this_extension' && details.value === effective ? 'applied' : 'not-controllable', details);
    } catch { return this.snapshot('error'); }
  }
  // ADR-070: one physical owner aggregates Antidetect and Proxy. Turning either
  // module off cannot clear the other module's active WebRTC requirement.
  enqueue(change) {
    const operation = async () => {
      change();
      const policy = this.effectivePolicy();
      const current = await this.read();
      if (['permission-required', 'unsupported'].includes(current.status) || current.levelOfControl === null) return this.view(current);
      const setting = this.nativeApi().privacy.network.webRTCIPHandlingPolicy;
      // A refused choice starts no blind release: with no layer of ours in sight (read() records that) there is nothing to release and nothing is written.
      let skipped = false;
      try {
        if (policy === 'system') {
          // clear removes only our extension's layer, including a layer hidden
          // by a newer extension. Never resurrect it when that owner goes away.
          skipped = this.refused() && !this.mutationAttempted;
          if (!skipped && (this.releaseNeeded || current.levelOfControl === 'controlled_by_this_extension')) {
            if (await setting.clear({ scope: 'regular' }) === false) { this.releaseFailed = true; return this.snapshot('error', current); }
            this.releaseFailed = false;
          }
        } else {
          this.releaseNeeded = true;
          if (!['controllable_by_this_extension', 'controlled_by_this_extension'].includes(current.levelOfControl)) return this.snapshot('not-controllable', current);
          if (current.levelOfControl !== 'controlled_by_this_extension' || current.value !== policy) {
            // ADR-072: a lost permission/ack cannot prove that a possibly written layer was released.
            this.mutationAttempted = true;
            if (await setting.set({ value: policy, scope: 'regular' }) === false) return this.snapshot('error', current);
          }
        }
        const applied = await this.read();
        if (policy === 'system' && applied.levelOfControl === 'controlled_by_this_extension') return this.snapshot('error', applied);
        if (policy === 'system' && applied.status === 'inactive' && !skipped) { this.releaseNeeded = false; this.mutationAttempted = false; }
        return this.view(applied);
      } catch { if (policy === 'system') this.releaseFailed = true; return this.snapshot('error', current); }
    };
    const task = this.queue.then(operation, operation);
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }
  reconcile(policy) {
    if (!POLICIES.includes(policy)) return Promise.reject(new TypeError('Invalid WebRTC network policy.'));
    return this.enqueue(() => { this.desired = policy; });
  }
  setProxyActive(active) {
    if (typeof active !== 'boolean') return Promise.reject(new TypeError('Invalid Proxy WebRTC state.'));
    return this.enqueue(() => { this.proxyActive = active; });
  }
}

const SESSION_SEED = 'webrtc-device-session-seed:v1', SITE_SEED = 'webrtc-device-site-seed:v1';
const validSeed = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export class WebRtcProfileSeeds {
  constructor(api) { this.api = api; this.pending = new Map(); }
  async seed(lifetime) {
    if (!['session', 'site'].includes(lifetime)) throw new TypeError('Invalid WebRTC device lifetime.');
    if (this.pending.has(lifetime)) return this.pending.get(lifetime);
    const operation = (async () => {
      const storage = lifetime === 'session' ? this.api.storage.session : this.api.storage.local;
      if (!storage) throw new Error('WebRTC device seed storage is unavailable.');
      const key = lifetime === 'session' ? SESSION_SEED : SITE_SEED;
      const saved = (await storage.get(key))[key];
      if (validSeed(saved)) return saved;
      const bytes = new Uint8Array(32); globalThis.crypto.getRandomValues(bytes);
      const seed = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
      await storage.set({ [key]: seed }); return seed;
    })();
    this.pending.set(lifetime, operation);
    try { return await operation; } catch (error) { this.pending.delete(lifetime); throw error; }
  }
  async prepare(entries) {
    const seeds = {};
    for (const entry of entries) {
      const value = entry.id === 'webrtc' && entry.mode === 'custom' && entry.selected?.kind === 'value' ? entry.selected.value : null;
      if (value?.randomizeDevices === true) seeds[value.deviceLifetime] = await this.seed(value.deviceLifetime);
    }
    return seeds;
  }
}
