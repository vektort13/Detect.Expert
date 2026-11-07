export const DNS_PROBE_WINDOW_MS = 10_000;
export const DNS_PROBE_MIN_NAMES = 8;
export const DNS_PROBE_LIMITS = Object.freeze({ documents: 32, domains: 8, names: 64, requests: 128, hashes: 64 });

interface NameEntry { at: number; reported: boolean }
interface DomainWindow { names: Map<string, NameEntry> }
interface DocumentWindow { at: number; requests: Map<string, number>; domains: Map<string, DomainWindow> }
export interface DnsProbeResult { count: number; limited: boolean; evictedDocumentKey?: string }

export function isDnsProbeHostname(host: string, domain: string): boolean {
  if (host === domain || !host.endsWith('.' + domain)) return false;
  const label = host.slice(0, host.indexOf('.'));
  return label.length >= 8 && label.length <= 63 && /^[a-z0-9]+$/.test(label) &&
    /[a-z]/.test(label) && /[0-9]/.test(label) && new Set(label).size >= 4;
}

export class DnsProbeWindow {
  private readonly documents = new Map<string, DocumentWindow>();

  get size(): number { return this.documents.size; }
  clear(documentKey?: string): void {
    if (documentKey === undefined) this.documents.clear(); else this.documents.delete(documentKey);
  }
  retain(keys: ReadonlySet<string>): void {
    for (const key of this.documents.keys()) if (!keys.has(key)) this.documents.delete(key);
  }
  expire(now: number): void {
    for (const [key, document] of this.documents) {
      if (now < document.at || now - document.at >= DNS_PROBE_WINDOW_MS) { this.documents.delete(key); continue; }
      for (const [request, at] of document.requests) if (now - at >= DNS_PROBE_WINDOW_MS) document.requests.delete(request);
      for (const [domain, window] of document.domains) {
        for (const [token, entry] of window.names) if (now - entry.at >= DNS_PROBE_WINDOW_MS) window.names.delete(token);
        if (!window.names.size) document.domains.delete(domain);
      }
    }
  }
  get nextExpiry(): number {
    let next = Infinity;
    for (const document of this.documents.values()) {
      next = Math.min(next, document.at + DNS_PROBE_WINDOW_MS);
      for (const at of document.requests.values()) next = Math.min(next, at + DNS_PROBE_WINDOW_MS);
      for (const window of document.domains.values()) for (const entry of window.names.values()) next = Math.min(next, entry.at + DNS_PROBE_WINDOW_MS);
    }
    return next;
  }
  record(documentKey: string, requestId: string, domain: string, token: string, at: number, now = at): DnsProbeResult {
    this.expire(now);
    if (at > now || now - at >= DNS_PROBE_WINDOW_MS) return { count: 0, limited: true };
    let evictedDocumentKey: string | undefined;
    let document = this.documents.get(documentKey);
    if (!document) {
      if (this.documents.size >= DNS_PROBE_LIMITS.documents) {
        let oldestAt = Infinity;
        for (const [key, entry] of this.documents) if (entry.at < oldestAt) { oldestAt = entry.at; evictedDocumentKey = key; }
        if (evictedDocumentKey !== undefined) this.documents.delete(evictedDocumentKey);
      }
      document = { at, requests: new Map(), domains: new Map() };
      this.documents.set(documentKey, document);
    }
    const eviction = evictedDocumentKey === undefined ? {} : { evictedDocumentKey };
    document.at = Math.max(document.at, at);
    if (document.requests.has(requestId)) return { count: 0, limited: false, ...eviction };
    if (document.requests.size >= DNS_PROBE_LIMITS.requests) return { count: 0, limited: true, ...eviction };
    document.requests.set(requestId, at);
    let window = document.domains.get(domain);
    if (!window) {
      if (document.domains.size >= DNS_PROBE_LIMITS.domains) return { count: 0, limited: true, ...eviction };
      window = { names: new Map() }; document.domains.set(domain, window);
    }
    const entry = window.names.get(token);
    if (entry) entry.at = Math.max(entry.at, at);
    else {
      if (window.names.size >= DNS_PROBE_LIMITS.names) return { count: 0, limited: true, ...eviction };
      window.names.set(token, { at, reported: false });
    }
    let count = 0;
    if (window.names.size >= DNS_PROBE_MIN_NAMES) for (const name of window.names.values()) {
      if (!name.reported) { name.reported = true; count++; }
    }
    return { count, limited: evictedDocumentKey !== undefined, ...eviction };
  }
}