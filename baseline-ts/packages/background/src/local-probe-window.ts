// ADR-025 / DET-060: passive candidate, not a port-state or malicious-purpose classifier.
// Canonical target identities and ports exist only in this bounded ten-second memory window.
export const LOCAL_PROBE_WINDOW_MS = 10_000;
export const LOCAL_PROBE_MIN_PORTS = 4;
export const LOCAL_PROBE_LIMITS = Object.freeze({ documents: 32, targets: 8, ports: 16, requests: 128 });
interface WindowState { at: number; requests: Map<string, number>; targets: Map<string, Map<number, number>> }
export interface ProbeWindowResult { duplicate: boolean; multiPort: boolean; limited: boolean; evictedDocumentKey?: string }

export class LocalProbeWindow {
  private readonly documents = new Map<string, WindowState>();
  clear(documentKey?: string): void { if (documentKey === undefined) this.documents.clear(); else this.documents.delete(documentKey); }
  retain(current: ReadonlySet<string>): void { for (const key of this.documents.keys()) if (!current.has(key)) this.documents.delete(key); }
  get size(): number { return this.documents.size; }
  expire(at: number): void {
    for (const [key, state] of this.documents) {
      if (at < state.at || at - state.at >= LOCAL_PROBE_WINDOW_MS) { this.documents.delete(key); continue; }
      for (const [id, seen] of state.requests) if (at - seen >= LOCAL_PROBE_WINDOW_MS) state.requests.delete(id);
      for (const [host, ports] of state.targets) {
        for (const [port, seen] of ports) if (at - seen >= LOCAL_PROBE_WINDOW_MS) ports.delete(port);
        if (ports.size === 0) state.targets.delete(host);
      }
    }
  }
  get nextExpiry(): number {
    let next = Infinity;
    for (const state of this.documents.values()) {
      next = Math.min(next, state.at + LOCAL_PROBE_WINDOW_MS);
      for (const seen of state.requests.values()) next = Math.min(next, seen + LOCAL_PROBE_WINDOW_MS);
      for (const ports of state.targets.values()) for (const seen of ports.values()) next = Math.min(next, seen + LOCAL_PROBE_WINDOW_MS);
    }
    return next;
  }

  record(documentKey: string, requestId: string, target: string | null, port: number, at: number, now = at): ProbeWindowResult {
    let limited = false;
    let evictedDocumentKey: string | undefined;
    this.expire(now);
    if (at > now || now - at >= LOCAL_PROBE_WINDOW_MS) return { duplicate: false, multiPort: false, limited: true };
    let state = this.documents.get(documentKey);
    if (!state) {
      if (this.documents.size >= LOCAL_PROBE_LIMITS.documents) {
        let oldest: string | null = null, oldestAt = Infinity;
        for (const [key, entry] of this.documents) if (entry.at < oldestAt) { oldest = key; oldestAt = entry.at; }
        if (oldest !== null) { this.documents.delete(oldest); evictedDocumentKey = oldest; }
        limited = true;
      }
      state = { at, requests: new Map(), targets: new Map() };
      this.documents.set(documentKey, state);
    }
    state.at = Math.max(state.at, at);
    for (const [id, seen] of state.requests) if (now - seen >= LOCAL_PROBE_WINDOW_MS) state.requests.delete(id);
    if (state.requests.has(requestId)) return { duplicate: true, multiPort: false, limited };
    if (state.requests.size >= LOCAL_PROBE_LIMITS.requests) {
      // Admit no new IDs until the window advances: eviction could count a duplicate twice.
      return { duplicate: true, multiPort: false, limited: true };
    }
    state.requests.set(requestId, at);
    for (const [host, ports] of state.targets) {
      for (const [value, seen] of ports) if (now - seen >= LOCAL_PROBE_WINDOW_MS) ports.delete(value);
      if (ports.size === 0) state.targets.delete(host);
    }
    const eviction = evictedDocumentKey === undefined ? {} : { evictedDocumentKey };
    if (target === null || !Number.isInteger(port) || port < 1 || port > 65535) return { duplicate: false, multiPort: false, limited, ...eviction };
    let ports = state.targets.get(target);
    if (!ports) {
      if (state.targets.size >= LOCAL_PROBE_LIMITS.targets) return { duplicate: false, multiPort: false, limited: true };
      ports = new Map(); state.targets.set(target, ports);
    }
    if (!ports.has(port) && ports.size >= LOCAL_PROBE_LIMITS.ports) {
      let oldest = 0, oldestAt = Infinity;
      for (const [value, seen] of ports) if (seen < oldestAt) { oldest = value; oldestAt = seen; }
      ports.delete(oldest); limited = true;
    }
    ports.set(port, Math.max(ports.get(port) ?? at, at));
    return { duplicate: false, multiPort: ports.size >= LOCAL_PROBE_MIN_PORTS, limited, ...eviction };
  }
}
