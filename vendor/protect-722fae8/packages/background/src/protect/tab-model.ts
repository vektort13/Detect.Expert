// ADR-020 §A (S04): per-tab model of the module «Защита»: the top-level document, its site (PSL registrable domain, or
// the host itself for IPv4 / single-label / localhost names), the commit time and the previous site. Fed by
// webNavigation.onCommitted (frame 0), tabs.onRemoved / onReplaced. resolveRequest() turns webRequest details into
// trusted ids, hosts and enums; the URL lives only in its local variables (REQ-005).
// Review r2: a tab the module never saw commit (loaded before enable, or evicted) learns its top site from a
// browser-trusted page-message sender (learnTopSite); the LRU bound evicts tabs the controller keeps (excluded sites) last.

import { makeDocumentKey } from '@detect-expert/contracts';
import type { FrameContext, HostCategory, ProtectHttpMethod, ProtectRequestKind, SiteRelation } from '@detect-expert/contracts';
import { redactHost, registrableDomain, requestScheme, toAsciiHost } from '../../../attribution/src/index';
import type { Clock, NavigationDetailsLike, RequestDetailsLike } from '../chrome-api';

export const MAX_PROTECT_TABS = 64;

export interface ProtectTabEntry {
  tabId: number;
  topDocumentId: string | null;
  site: string | null;
  scheme: 'http' | 'https' | null;
  committedAt: number;
  previousSite: string | null;
  leftPreviousAt: number | null;
  /** Small per-tab state of a lane (e.g. firewall `once` metadata); JSON data only, written through setLaneData. */
  lanes?: Record<string, unknown>;
}

/** What a webRequest event means for the module. Hosts are registrable domains or categories; never a URL. */
export interface ResolvedRequest {
  tabId: number;
  frameId: number;
  /** Document of the frame that made the request (Chrome ids), or null (navigation request, unknown document). */
  documentKey: string | null;
  /** Current top-level document of the tab (doc-store sections live under this key), or null. */
  topDocumentKey: string | null;
  topSite: string | null;
  frameContext: FrameContext;
  /** Registrable domain of a sub-frame's initiator (sub-frames only). */
  frameSite: string | null;
  /** Exactly one of receiver (registrable) and receiverCategory. */
  receiver: string | null;
  receiverCategory: HostCategory | null;
  /** Schemeful relation of the receiver to the top-level site (never `same-origin`: only sites are compared). */
  relation: SiteRelation;
  initiatorSite: string | null;
  requestKind: ProtectRequestKind;
  method: ProtectHttpMethod;
  requestId: string | null;
  timeStamp: number;
}

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Site name of a host: PSL registrable domain; an IPv4 literal, localhost name or single label as is; else null. */
export function siteOfHost(host: string | null | undefined): string | null {
  if (typeof host !== 'string' || host.length === 0 || host.length > 253) return null;
  const domain = registrableDomain(host);
  if (domain !== null) return domain;
  if (IPV4_RE.test(host)) return host;
  if (host === 'localhost' || host.endsWith('.localhost')) return 'localhost';
  if (!host.includes('.') && LABEL_RE.test(host)) return host;
  return null;
}

/** Site of a URL or origin string (http/https/ws/wss), or null. */
export function siteOfUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.length === 0 || url === 'null') return null;
  return siteOfHost(toAsciiHost(url));
}

const REQUEST_KINDS: Readonly<Record<string, ProtectRequestKind>> = {
  main_frame: 'navigation',
  sub_frame: 'frame',
  xmlhttprequest: 'xhr',
  ping: 'beacon',
  image: 'image',
  script: 'script',
};
const METHODS: ReadonlySet<string> = /* @__PURE__ */ new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export function requestKindOf(type: string): ProtectRequestKind {
  return REQUEST_KINDS[type] ?? 'other';
}

export function methodOf(method: string | undefined): ProtectHttpMethod {
  const m = typeof method === 'string' ? method.toUpperCase() : '';
  return METHODS.has(m) ? (m as ProtectHttpMethod) : 'OTHER';
}

function isEntry(v: unknown): v is ProtectTabEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return Number.isSafeInteger(e['tabId']) && (e['tabId'] as number) >= 0 && (e['topDocumentId'] === null || typeof e['topDocumentId'] === 'string') &&
    (e['site'] === null || typeof e['site'] === 'string') && typeof e['committedAt'] === 'number';
}

export class ProtectTabModel {
  private readonly tabs = new Map<number, ProtectTabEntry>();

  constructor(
    private readonly clock: Clock,
    /** Called after every change (doc-store persists `protect-tabs`, debounced). */
    private readonly onChange: () => void = () => undefined,
    /** Entries the LRU bound evicts last (the controller keeps tabs of excluded sites). */
    private readonly keep: (entry: Readonly<ProtectTabEntry>) => boolean = () => false,
  ) {}

  /** LRU bound: the oldest entry that is not kept goes first; only when every other entry is kept, the oldest. */
  private evictOverflow(current: number): void {
    while (this.tabs.size > MAX_PROTECT_TABS) {
      let victim: number | null = null;
      let oldest: number | null = null;
      for (const [id, e] of this.tabs) {
        if (id === current) continue;
        if (oldest === null) oldest = id;
        if (!this.keep(e)) {
          victim = id;
          break;
        }
      }
      const target = victim ?? oldest;
      if (target === null) break;
      this.tabs.delete(target);
    }
  }

  /** Hydration from `protect-tabs` (shape-checked; at most MAX_PROTECT_TABS). */
  load(entries: readonly unknown[]): void {
    this.tabs.clear();
    for (const e of entries.slice(-MAX_PROTECT_TABS)) {
      if (!isEntry(e)) continue;
      const scheme = e.scheme === 'http' || e.scheme === 'https' ? e.scheme : null;
      this.tabs.set(e.tabId, { tabId: e.tabId, topDocumentId: e.topDocumentId, site: e.site, scheme, committedAt: e.committedAt,
        previousSite: typeof e.previousSite === 'string' ? e.previousSite : null, leftPreviousAt: typeof e.leftPreviousAt === 'number' ? e.leftPreviousAt : null,
        ...(e.lanes !== undefined && typeof e.lanes === 'object' && e.lanes !== null ? { lanes: e.lanes } : {}) });
    }
  }

  entries(): ProtectTabEntry[] {
    return [...this.tabs.values()];
  }

  get size(): number {
    return this.tabs.size;
  }

  get(tabId: number): Readonly<ProtectTabEntry> | undefined {
    return this.tabs.get(tabId);
  }

  topDocumentKey(tabId: number): string | null {
    const e = this.tabs.get(tabId);
    return e === undefined || e.topDocumentId === null ? null : makeDocumentKey(tabId, 0, e.topDocumentId);
  }

  /** Keys of the current top-level documents (never evicted by the doc-store TTL). */
  topDocumentKeys(): Set<string> {
    const out = new Set<string>();
    for (const e of this.tabs.values()) if (e.topDocumentId !== null) out.add(makeDocumentKey(e.tabId, 0, e.topDocumentId));
    return out;
  }

  /** webNavigation.onCommitted of frame 0 (prerender ignored). Returns the updated entry, or null when ignored. */
  noteCommitted(details: NavigationDetailsLike): ProtectTabEntry | null {
    if (details.frameId !== 0 || !Number.isSafeInteger(details.tabId) || details.tabId < 0 || typeof details.documentId !== 'string') return null;
    if (details.documentLifecycle === 'prerender') return null;
    const site = siteOfUrl(details.url);
    const scheme = requestScheme(details.url);
    const now = this.clock.now();
    const before = this.tabs.get(details.tabId);
    const changedSite = before !== undefined && before.site !== site;
    const entry: ProtectTabEntry = {
      tabId: details.tabId,
      topDocumentId: details.documentId,
      site,
      scheme: scheme === 'http' || scheme === 'https' ? scheme : null,
      committedAt: now,
      previousSite: changedSite ? before.site : (before?.previousSite ?? null),
      leftPreviousAt: changedSite ? now : (before?.leftPreviousAt ?? null),
      ...(before?.lanes !== undefined ? { lanes: before.lanes } : {}),
    };
    this.tabs.delete(details.tabId);
    this.tabs.set(details.tabId, entry);
    this.evictOverflow(details.tabId);
    this.onChange();
    return entry;
  }

  /**
   * Review r2: top site of a tab the model does not know (its top document committed before the module was enabled,
   * or the entry was evicted), from a browser-trusted source (MessageSender of a page message: the frame itself for
   * frame 0, tab.url otherwise). Fills gaps only: an existing entry is never changed. No top document id (the report
   * of such a tab stays unknown); committedAt 0 = loaded before the module.
   */
  learnTopSite(tabId: number, site: string, scheme: 'http' | 'https' | null): ProtectTabEntry | null {
    if (!Number.isSafeInteger(tabId) || tabId < 0 || this.tabs.has(tabId)) return null;
    const entry: ProtectTabEntry = { tabId, topDocumentId: null, site, scheme, committedAt: 0, previousSite: null, leftPreviousAt: null };
    this.tabs.set(tabId, entry);
    this.evictOverflow(tabId);
    this.onChange();
    return entry;
  }

  noteRemoved(tabId: number): boolean {
    const had = this.tabs.delete(tabId);
    if (had) this.onChange();
    return had;
  }

  /** tabs.onReplaced (prerender / instant navigation swap): the new tab id takes over the entry. */
  noteReplaced(addedTabId: number, removedTabId: number): void {
    const e = this.tabs.get(removedTabId);
    this.tabs.delete(removedTabId);
    if (e !== undefined) this.tabs.set(addedTabId, { ...e, tabId: addedTabId, topDocumentId: null });
    this.onChange();
  }

  laneData(tabId: number, lane: string): unknown {
    return this.tabs.get(tabId)?.lanes?.[lane];
  }

  /** A lane's small per-tab state (JSON data). undefined removes it. Ignored for unknown tabs. */
  setLaneData(tabId: number, lane: string, data: unknown): void {
    const e = this.tabs.get(tabId);
    if (e === undefined) return;
    const lanes = { ...(e.lanes ?? {}) };
    if (data === undefined) delete lanes[lane];
    else lanes[lane] = data;
    this.tabs.set(tabId, { ...e, lanes });
    this.onChange();
  }

  clear(): void {
    if (this.tabs.size === 0) return;
    this.tabs.clear();
    this.onChange();
  }

  /** Trusted view of a webRequest event (ids from Chrome, hosts redacted here). Null for tabId < 0 or a non-http URL. */
  resolveRequest(details: RequestDetailsLike): ResolvedRequest | null {
    if (!Number.isSafeInteger(details.tabId) || details.tabId < 0) return null;
    const url = details.url;
    const scheme = requestScheme(url);
    if (scheme === null) return null;
    const entry = this.tabs.get(details.tabId);
    const topSite = entry?.site ?? null;
    const topDocumentKey = entry === undefined || entry.topDocumentId === null ? null : makeDocumentKey(details.tabId, 0, entry.topDocumentId);
    const red = redactHost(url);
    const receiver = red.kind === 'registrable' ? red.value : null;
    const receiverCategory: HostCategory | null = red.kind === 'registrable' ? null : red.kind === 'unknown' ? 'unknown' : red.value;
    const initiatorSite = siteOfUrl(details.initiator);
    const navigation = details.type === 'main_frame';
    const docId = typeof details.documentId === 'string' ? details.documentId : null;
    let frameContext: FrameContext = 'top';
    let frameSite: string | null = null;
    let documentKey: string | null = null;
    if (!navigation) {
      if (details.frameId === 0) documentKey = docId === null ? topDocumentKey : makeDocumentKey(details.tabId, 0, docId);
      else {
        frameSite = initiatorSite;
        frameContext = frameSite !== null && frameSite === topSite ? 'same-site-frame' : 'cross-site-frame';
        documentKey = docId === null ? null : makeDocumentKey(details.tabId, details.frameId, docId);
      }
    }
    let relation: SiteRelation = 'unknown';
    if (topSite !== null && receiver !== null) relation = receiver === topSite && (entry?.scheme ?? scheme) === scheme ? 'same-site' : 'cross-site';
    return {
      tabId: details.tabId,
      frameId: details.frameId,
      documentKey,
      topDocumentKey,
      topSite,
      frameContext,
      frameSite,
      receiver,
      receiverCategory,
      relation,
      initiatorSite,
      requestKind: requestKindOf(details.type),
      method: methodOf(details.method),
      requestId: typeof details.requestId === 'string' ? details.requestId : null,
      timeStamp: details.timeStamp,
    };
  }
}
