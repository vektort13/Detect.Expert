// Ephemeral network pattern windows (S07, ADR-018 §5; DET-060/061). Memory of the service worker only: nothing here
// is stored, projected, exported or sent anywhere, and the tokens never leave this class.
//
// Per document key (LRU, at most MAX_DOCUMENTS) a tumbling window of BUDGETS.networkWindowMs keeps:
// - local: a set of local-target tokens and, for at most MAX_LOCAL_TARGETS targets, a set of endpoint tokens
//   (target + port) -> "how many distinct ports of one local target" and "how many distinct local targets";
// - subdomains: for at most MAX_DOMAINS registrable domains, a set of host tokens with a random-looking leftmost
//   label -> "how many distinct random subdomains of one domain".
// Every set holds at most BUDGETS.maxNetworkWindowDistinct tokens; a full set stops growing (the count saturates).
//
// Token = FNV-1a 32 of (salt + '\u0000' + value). The salt is 16 random bytes per SW lifetime (injected in tests).
// A token is NOT anonymization (ADR-007 §7): with the salt in memory a value could be confirmed by recomputation. It
// exists so that raw hosts/ports never need to be retained even transiently between requests; collisions only make
// the counts smaller (undercount), never larger.

import { BUDGETS } from '@detect-expert/contracts';

export const MAX_NETWORK_WINDOW_DOCUMENTS = 32;
export const MAX_LOCAL_TARGETS = 16;
export const MAX_SUBDOMAIN_DOMAINS = 8;

interface DocumentWindow {
  startedAt: number;
  localTargets: Set<number>;
  /** targetToken -> endpoint tokens; at most MAX_LOCAL_TARGETS keys. */
  localPorts: Map<number, Set<number>>;
  /** domainToken -> random-subdomain host tokens; at most MAX_SUBDOMAIN_DOMAINS keys. */
  subdomains: Map<number, Set<number>>;
}

export interface NetworkWindowOptions {
  /** Hex or any string; default: 16 random bytes from crypto.getRandomValues. */
  salt?: string;
  windowMs?: number;
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += (b < 16 ? '0' : '') + b.toString(16);
  return out;
}

/** FNV-1a 32 over UTF-16 code units (inputs are ASCII hosts/ports); unsigned 32-bit result. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function addBounded(set: Set<number>, token: number): void {
  if (set.size < BUDGETS.maxNetworkWindowDistinct || set.has(token)) set.add(token);
}

export class NetworkWindowTracker {
  private readonly salt: string;
  private readonly windowMs: number;
  private readonly windows = new Map<string, DocumentWindow>();

  constructor(options: NetworkWindowOptions = {}) {
    this.salt = typeof options.salt === 'string' && options.salt.length > 0 ? options.salt : randomSalt();
    this.windowMs = options.windowMs ?? BUDGETS.networkWindowMs;
  }

  private token(value: string): number {
    return fnv1a(this.salt + '\u0000' + value);
  }

  /** Current window of a document (LRU touch, tumbling reset), creating it when absent. */
  private window(key: string, at: number): DocumentWindow {
    let w = this.windows.get(key);
    if (w !== undefined) this.windows.delete(key);
    if (w === undefined || !(at - w.startedAt < this.windowMs) || at < w.startedAt) {
      w = { startedAt: at, localTargets: new Set(), localPorts: new Map(), subdomains: new Map() };
    }
    this.windows.set(key, w);
    while (this.windows.size > MAX_NETWORK_WINDOW_DOCUMENTS) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) break;
      this.windows.delete(oldest);
    }
    return w;
  }

  /**
   * A request from a public document to a local target. `target` is the exact local host, `endpoint` the target plus
   * its effective port. Returns the distinct ports of this target and the distinct local targets in the window.
   */
  observeLocal(key: string, target: string, endpoint: string, at: number): { ports: number; targets: number } {
    const w = this.window(key, at);
    const targetToken = this.token('t:' + target);
    addBounded(w.localTargets, targetToken);
    let ports = w.localPorts.get(targetToken);
    if (ports === undefined && w.localPorts.size < MAX_LOCAL_TARGETS) {
      ports = new Set();
      w.localPorts.set(targetToken, ports);
    }
    if (ports !== undefined) addBounded(ports, this.token('e:' + endpoint));
    return { ports: ports === undefined ? 1 : ports.size, targets: w.localTargets.size };
  }

  /** A request to `host` with a random-looking leftmost label below `domain`; returns the distinct such hosts. */
  observeSubdomain(key: string, domain: string, host: string, at: number): number {
    const w = this.window(key, at);
    const domainToken = this.token('d:' + domain);
    let hosts = w.subdomains.get(domainToken);
    if (hosts === undefined) {
      if (w.subdomains.size >= MAX_SUBDOMAIN_DOMAINS) return 1;
      hosts = new Set();
      w.subdomains.set(domainToken, hosts);
    }
    addBounded(hosts, this.token('h:' + host));
    return hosts.size;
  }

  /** Drops the window of one document (ui-clear, revoke, eviction, TTL). */
  forget(key: string): void {
    this.windows.delete(key);
  }

  /** Drops every window (clear session, stop). */
  clear(): void {
    this.windows.clear();
  }

  /** Number of tracked documents (bounded by MAX_NETWORK_WINDOW_DOCUMENTS); for tests and perf checks. */
  get size(): number {
    return this.windows.size;
  }

  /** Total retained tokens across all documents (bounded); for tests and perf checks. Never the tokens themselves. */
  retainedTokens(): number {
    let n = 0;
    for (const w of this.windows.values()) {
      n += w.localTargets.size;
      for (const s of w.localPorts.values()) n += s.size;
      for (const s of w.subdomains.values()) n += s.size;
    }
    return n;
  }
}
