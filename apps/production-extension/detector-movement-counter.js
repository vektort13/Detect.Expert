// ADR-097: fixed ISOLATED-world lease function. Never reads pointer coordinates.
export function detectorMovementLease(action, leaseId, policy) {
  const own = (value, key) => {
    if (value === null || typeof value !== 'object' && typeof value !== 'function') return undefined;
    const field = Object.getOwnPropertyDescriptor(value, key);
    return field && Object.hasOwn(field, 'value') ? field.value : undefined;
  };
  if (!['sample', 'close'].includes(action) || typeof leaseId !== 'string' || !/^[a-f0-9-]{20,64}$/u.test(leaseId)) return {state: 'unavailable'};
  const slot = Symbol.for('detect.expert/isolated-movement-leases/v1');
  const published = Object.getOwnPropertyDescriptor(globalThis, slot);
  if (published && (!Object.hasOwn(published, 'value') || published.value === undefined)) return {state: 'unavailable'};
  let holder = own(globalThis, slot), operate = own(holder, 'operate');
  if (holder !== undefined && typeof operate !== 'function') return {state: 'unavailable'};
  const permitted = () => {
    try {
      if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return false;
      const mode = own(policy, 'scopeMode'), hosts = own(policy, 'hosts'), broad = own(policy, 'grantedAllSites'), active = own(policy, 'activeDocumentId');
      if (!['all-sites', 'site', 'active-tab'].includes(mode) || typeof broad !== 'boolean' || !Array.isArray(hosts) || hosts.length > 512) return false;
      const allowed = [];
      for (let index = 0; index < hosts.length; index++) {
        const host = own(hosts, index);
        if (typeof host !== 'string' || !host.length || host.length > 253) return false;
        const parsed = new URL('https://' + host);
        if (parsed.hostname !== host || parsed.host !== host || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) return false;
        allowed.push(host);
      }
      if (mode === 'all-sites' && broad !== true || mode === 'site' && !allowed.length || mode === 'active-tab' && (typeof active !== 'string' || !/^[A-Za-z0-9_:.-]{1,128}$/u.test(active))) return false;
      const location = (globalThis.window ?? globalThis).location, protocol = location.protocol, hostname = location.hostname;
      return ['http:', 'https:'].includes(protocol) && typeof hostname === 'string' && hostname.length > 0 && (mode !== 'site' || allowed.includes(hostname));
    } catch {return false;}
  };
  if (action === 'sample' && !permitted()) {
    try {if (typeof operate === 'function') operate('close', leaseId);} catch { /* Denied samples cannot renew a retained lease. */ }
    return {state: 'unavailable'};
  }
  if (!holder && action === 'close') return {state: 'closed'};
  if (!holder) {
    const apply = Reflect.apply, define = Object.defineProperty, descriptor = Object.getOwnPropertyDescriptor;
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener, eventTarget = globalThis.window ?? globalThis;
    const setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout;
    const clock = globalThis.performance?.now, clockReceiver = globalThis.performance;
    if (typeof add !== 'function' || typeof remove !== 'function' || typeof setTimer !== 'function' || typeof clearTimer !== 'function' || typeof clock !== 'function') return {state: 'unavailable'};
    let documentToken;
    try {
      const words = new Uint32Array(4);globalThis.crypto.getRandomValues(words);
      documentToken = Array.from(words, value => value.toString(16).padStart(8, '0')).join('');
    } catch { return {state: 'unavailable'}; }
    const leases = new Map(), MAX = 2147483647, TTL = 120000;
    let timer = null, installed = false, generation = 0, closed = false;
    const now = () => apply(clock, clockReceiver, []);
    const detach = () => {
      closed = true;
      if (installed) {installed = false;try {apply(remove, eventTarget, ['mousemove', movement, true]);} catch { /* Expired leases cannot count further input. */ }}
      if (timer !== null) {const previous = timer;timer = null;try {apply(clearTimer, globalThis, [previous]);} catch { /* A queued callback still checks ownership. */ }}
      const current = descriptor(globalThis, slot);
      if (current?.value === holder) delete globalThis[slot];
    };
    const expire = at => {
      for (const [id, lease] of leases) if (lease.until <= at) leases.delete(id);
      if (leases.size === 0) detach();
    };
    const arm = () => {
      if (timer !== null || closed) return;
      timer = apply(setTimer, globalThis, [() => {
        timer = null;
        try {expire(now());if (!closed) arm();}
        catch {leases.clear();detach();}
      }, 1000]);
    };
    function movement(event) {
      try {
        const at = now();expire(at);
        if (closed || event.isTrusted !== true) return;
        for (const lease of leases.values()) {
          if (lease.count < MAX) lease.count++;
          else lease.saturated = true;
        }
      } catch {leases.clear();detach();}
    }
    operate = (verb, id) => {
      const at = now();
      if (verb === 'close') {
        leases.delete(id);expire(at);return {state: 'closed'};
      }
      // The caller renews an existing lease at most once per second. A new
      // document/expired lease starts a new explicit observation generation.
      for (const [key, lease] of leases) if (lease.until <= at) leases.delete(key);
      let lease = leases.get(id);
      if (!lease) {
        if (leases.size >= 8 || generation >= MAX) return {state: 'unavailable'};
        lease = {count: 0, saturated: false, until: at + TTL, generation: ++generation};leases.set(id, lease);
      } else lease.until = at + TTL;
      try {
        if (!installed) {apply(add, eventTarget, ['mousemove', movement, {capture: true, passive: true}]);installed = true;}
        closed = false;arm();
      } catch {
        leases.clear();detach();return {state: 'unavailable'};
      }
      return {state: 'ready', documentToken, generation: lease.generation, count: lease.count, saturated: lease.saturated};
    };
    holder = Object.freeze({operate});
    try {define(globalThis, slot, {value: holder, configurable: true});}
    catch {return {state: 'unavailable'};}
  }
  try {return operate(action, leaseId);}
  catch {return {state: 'unavailable'};}
}
