// ADR-020 §B, §8 (S07): token ring of armed tabs for the reverse direction (the value reaches the SW after a request
// that already carried it). SW memory only, ringWindowMs (10 s): keyed fingerprints of at most ringMaxTokensPerEntry
// tokens per request (no request text is kept), ≤ ringMaxPerTab entries per tab, ≤ ringMaxEntriesGlobal overall.
// Navigations and requests that had credential-named keys never enter the ring. Opaque bodies enter it without tokens
// (opaque-after-input in the reverse direction).

import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { DeliveryState, FrameContext, HostCategory, ProtectHttpMethod, ProtectLimitation, ProtectRequestKind, SiteRelation } from '@detect-expert/contracts';
import type { PathTemplateParts } from '../../../../attribution/src/index';
import type { RequestView } from './decode';

/** What evidence needs about the request (value-free; computed once in the callback). */
export interface RequestMeta {
  requestId: string | null;
  tabId: number;
  at: number;
  documentKey: string | null;
  storeKey: string | null;
  topSite: string | null;
  frameContext: FrameContext;
  frameSite: string | null;
  receiver: string | null;
  receiverCategory: HostCategory | null;
  relation: SiteRelation;
  method: ProtectHttpMethod;
  requestKind: ProtectRequestKind;
  endpointHost: string | null;
  /** Template segments of the path (literal or `:id`); evidence takes joinPathTemplate(pathParts, maskedSegments). */
  pathParts: PathTemplateParts;
  /**
   * Path segments that carried a typed value or one of its variants (direct hits, later reverse hits): `:id` in every
   * template made from this request, never a literal (REQ-005, ADR-020 §B). Indices < maxEndpointPathSegments only.
   */
  maskedSegments: Set<number>;
  initiatorSite: string | null;
  /** A form POST navigation (main_frame / sub_frame): the request is itself a submit. */
  formPost: boolean;
  limitations: ProtectLimitation[];
}

export interface ViewMeta {
  location: RequestView['location'];
  paramName: string | null;
  pathSegment: number | null;
  urlDecoded: boolean;
  container: boolean;
}

export interface RingEntry {
  meta: RequestMeta;
  views: ViewMeta[];
  /** Sorted unique token fingerprints, with their (view index << 11 | len) in the same order. */
  hashes: Float64Array;
  info: Uint32Array;
  opaque: boolean;
  /** onSendHeaders seen for the request (a later reverse match says `sent`). */
  delivery: DeliveryState;
  /** Fields already matched against this request (documentKey#fieldRef). */
  matched: Set<string>;
}

/** In-place co-sort of fingerprints and their info (quicksort with insertion sort below 16). */
function coSort(h: Float64Array, info: Uint32Array, lo: number, hi: number): void {
  while (hi - lo > 16) {
    const mid = (lo + hi) >>> 1;
    const pivot = h[mid]!;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (h[i]! < pivot) i++;
      while (h[j]! > pivot) j--;
      if (i <= j) {
        const th = h[i]!;
        h[i] = h[j]!;
        h[j] = th;
        const ti = info[i]!;
        info[i] = info[j]!;
        info[j] = ti;
        i++;
        j--;
      }
    }
    if (j - lo < hi - i) {
      coSort(h, info, lo, j);
      lo = i;
    } else {
      coSort(h, info, i, hi);
      hi = j;
    }
  }
  for (let a = lo + 1; a <= hi; a++) {
    const vh = h[a]!;
    const vi = info[a]!;
    let b = a - 1;
    while (b >= lo && h[b]! > vh) {
      h[b + 1] = h[b]!;
      info[b + 1] = info[b]!;
      b--;
    }
    h[b + 1] = vh;
    info[b + 1] = vi;
  }
}

/** Collects token fingerprints of one request (≤ ringMaxTokensPerEntry), then freezes them sorted. */
export class RingBuilder {
  private readonly h = new Float64Array(PROTECT_BUDGETS.ringMaxTokensPerEntry);
  private readonly info = new Uint32Array(PROTECT_BUDGETS.ringMaxTokensPerEntry);
  private n = 0;

  get full(): boolean {
    return this.n >= this.h.length;
  }

  /** Reused across requests (the callback is synchronous): empties the builder. */
  reset(): void {
    this.n = 0;
  }

  add(hash: number, view: number, len: number): void {
    if (this.n >= this.h.length) return;
    this.h[this.n] = hash;
    this.info[this.n] = ((Math.min(view, 0x1fffff) << 11) | (len & 0x7ff)) >>> 0;
    this.n++;
  }

  build(): { hashes: Float64Array; info: Uint32Array } {
    const h = this.h.slice(0, this.n);
    const info = this.info.slice(0, this.n);
    if (h.length > 1) coSort(h, info, 0, h.length - 1);
    return { hashes: h, info };
  }
}

/** Index of `hash` in a sorted array, or -1. */
export function findHash(hashes: Float64Array, hash: number): number {
  let lo = 0;
  let hi = hashes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = hashes[mid]!;
    if (v === hash) return firstOf(hashes, mid, hash);
    if (v < hash) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

function firstOf(hashes: Float64Array, at: number, hash: number): number {
  let i = at;
  while (i > 0 && hashes[i - 1] === hash) i--;
  return i;
}

export function infoView(info: number): number {
  return info >>> 11;
}

export function infoLen(info: number): number {
  return info & 0x7ff;
}

export class TokenRing {
  private readonly byTab = new Map<number, RingEntry[]>();
  private readonly byRequest = new Map<string, RingEntry>();
  private total = 0;
  private lastSweep = 0;

  get size(): number {
    return this.total;
  }

  tokens(): number {
    let n = 0;
    for (const list of this.byTab.values()) for (const e of list) n += e.hashes.length;
    return n;
  }

  push(entry: RingEntry, now: number): void {
    this.sweep(now, true);
    let list = this.byTab.get(entry.meta.tabId);
    if (list === undefined) {
      list = [];
      this.byTab.set(entry.meta.tabId, list);
    }
    list.push(entry);
    this.total++;
    if (entry.meta.requestId !== null) this.byRequest.set(entry.meta.requestId, entry);
    while (list.length > PROTECT_BUDGETS.ringMaxPerTab) this.drop(list.shift()!);
    while (this.total > PROTECT_BUDGETS.ringMaxEntriesGlobal) {
      let oldest: RingEntry | null = null;
      for (const l of this.byTab.values()) {
        const first = l[0];
        if (first !== undefined && (oldest === null || first.meta.at < oldest.meta.at)) oldest = first;
      }
      if (oldest === null) break;
      const l = this.byTab.get(oldest.meta.tabId)!;
      l.shift();
      this.drop(oldest);
    }
  }

  private drop(entry: RingEntry): void {
    this.total--;
    if (entry.meta.requestId !== null && this.byRequest.get(entry.meta.requestId) === entry) this.byRequest.delete(entry.meta.requestId);
  }

  /** Entries of a tab within ringWindowMs, oldest first. */
  entries(tabId: number, now: number): RingEntry[] {
    this.sweep(now, false);
    return (this.byTab.get(tabId) ?? []).filter((e) => now - e.meta.at <= PROTECT_BUDGETS.ringWindowMs);
  }

  byRequestId(requestId: string): RingEntry | undefined {
    return this.byRequest.get(requestId);
  }

  /** Expired entries go (at most every 500 ms unless forced). */
  sweep(now: number, force: boolean): void {
    if (!force && now - this.lastSweep < 500) return;
    this.lastSweep = now;
    for (const [tabId, list] of this.byTab) {
      while (list.length > 0 && now - list[0]!.meta.at > PROTECT_BUDGETS.ringWindowMs) this.drop(list.shift()!);
      if (list.length === 0) this.byTab.delete(tabId);
    }
  }

  /** Earliest moment a forced sweep removes an entry (sweep drops `now - at > ringWindowMs`); +Infinity when empty. */
  nextExpiry(): number {
    let at = Number.POSITIVE_INFINITY;
    for (const list of this.byTab.values()) for (const e of list) at = Math.min(at, e.meta.at + PROTECT_BUDGETS.ringWindowMs + 1);
    return at;
  }

  forgetTab(tabId: number): void {
    const list = this.byTab.get(tabId);
    if (list === undefined) return;
    for (const e of list) this.drop(e);
    this.byTab.delete(tabId);
  }

  clear(): void {
    this.byTab.clear();
    this.byRequest.clear();
    this.total = 0;
  }
}
