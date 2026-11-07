import { requestScheme, siteRelation } from '../../attribution/src/index';
// Catalog matcher on received requests (S10, ADR-009 v1.1, ADR-018): non-blocking webRequest.onCompleted. A match
// means the browser received a resource whose scheme/host/port/path/type a catalog rule documents; it never means the
// service code ran, decided anything, or that the site is safe (REQ-007).
//
// The listener is registered only when the build's catalog has network rules or in the test profile (entrypoint).
// Checks mirror the S07 observer (network.ts): any host access, known type, sanitizable target and initiator, frame
// requests belong to the parent document, scope.networkRequestAllowed for the current mode, then the request's document
// (bound, or its report after the binding moved on — I1) with access that is neither paused nor revoked. Only then the URL is matched (matchNetworkRequest: scheme, WHATWG host,
// port, pathname, type and a received status; query and fragment never take part). The URL stays in this callback:
// the reducer receives the document ids, the host aggregation key parts (registrable domain or category, relation)
// and rule ids only. A match merges into an existing host entry; it never creates one.

import { matchNetworkRequest } from '@detect-expert/catalog';
import type { CatalogIndex } from '@detect-expert/catalog';
import { sanitizeHost } from '@detect-expert/contracts';
import type { RequestDetailsLike, RequestFilterLike } from './chrome-api';
import { redactNetworkTarget } from './network';
import type { BackgroundRuntime } from './runtime';

/** Resource types a catalog network rule may name (catalog ObservedResourceType; no websocket, no main_frame). */
export const VENDOR_MATCH_TYPES = [
  'script',
  'xmlhttprequest',
  'sub_frame',
  'ping',
  'image',
  'media',
  'font',
  'stylesheet',
  'other',
] as const;
export type VendorMatchType = (typeof VENDOR_MATCH_TYPES)[number];

export interface VendorMatchFilter extends RequestFilterLike {
  urls: string[];
  types: string[];
}

/** Filter for webRequest.onCompleted: http(s) only (rules have no ws/wss scheme); every type is a known one. */
export const VENDOR_MATCH_FILTER: VendorMatchFilter = { urls: ['http://*/*', 'https://*/*'], types: [...VENDOR_MATCH_TYPES] };

const TYPE_SET: ReadonlySet<string> = new Set<string>(VENDOR_MATCH_TYPES);
const MAX_DEFERRED = 256;

/** True when the index has at least one browser-network rule (otherwise matching is skipped before any parsing). */
export function catalogHasNetworkRules(index: CatalogIndex): boolean {
  return index.networkByHost.size > 0 || index.networkBySuffix.size > 0;
}

export type VendorMatchListener = (details: RequestDetailsLike) => undefined;

export function createVendorMatchListener(runtime: BackgroundRuntime): VendorMatchListener {
  let deferred = 0;
  const observe = (details: RequestDetailsLike): void => {
    const catalog = runtime.catalog;
    if (!catalogHasNetworkRules(catalog)) return;
    // 1. Cheap guards (same as the S07 observer).
    if (!runtime.scope.hasAnyHostAccess()) return;
    if (typeof details.type !== 'string' || !TYPE_SET.has(details.type) || typeof details.url !== 'string') return;
    const host = sanitizeHost(details.url);
    if (host === null) return;
    const initiator = typeof details.initiator === 'string' ? details.initiator : null;
    if (initiator === null) return;
    const initiatorHost = sanitizeHost(initiator);
    if (initiatorHost === null) return;
    // 2. Attribution: workers / browser stay unattributed (counted once by the S07 observer); frames -> parent.
    const tabId = typeof details.tabId === 'number' ? details.tabId : -1;
    if (tabId < 0) return;
    const isFrame = details.type === 'sub_frame' && typeof details.parentDocumentId === 'string' &&
      typeof details.parentFrameId === 'number' && details.parentFrameId >= 0;
    const frameId = isFrame ? (details.parentFrameId as number) : typeof details.frameId === 'number' ? details.frameId : 0;
    const documentId = isFrame ? (details.parentDocumentId as string) : typeof details.documentId === 'string' ? details.documentId : null;
    // 3. Permission matrix of the current scope mode.
    const scheme = requestScheme(details.url);
    if (scheme === null || documentId === null) return;
    if (!runtime.scope.networkRequestAllowed(tabId, documentId, host, scheme, initiatorHost, requestScheme(initiator))) return;
    // 4. Document, access, pause and revocation (I1: the same lookup as the S07 observer). A document whose binding
    //    moved on between onBeforeRequest and onCompleted (keepalive beacon after the next commit) still owns its host
    //    entry, so the match merges there. An unknown document ('unbound') is not counted again here: onBeforeRequest
    //    fires first, and the S07 observer already counted the request once (in a document, or as unattributed).
    if (runtime.networkDocumentLookup(tabId, frameId, documentId).kind !== 'document') return;
    // 5. Catalog match (the URL is read here and nowhere else).
    const ruleIds = matchNetworkRequest(catalog, { url: details.url, resourceType: details.type, statusCode: details.statusCode }, runtime.now());
    if (ruleIds.length === 0) return;
    // 6. Same aggregation key as the S07 host entry (PT-2 redaction included); ids and enums only.
    const redacted = redactNetworkTarget(host).redacted;
    runtime.dispatch({
      type: 'network:vendor-match',
      tabId,
      frameId,
      documentId,
      ...(redacted.kind === 'registrable' ? { registrableDomain: redacted.value } : { category: redacted.kind === 'unknown' ? 'unknown' as const : redacted.value }),
      relation: siteRelation(details.url, initiator),
      ruleIds: [...ruleIds],
      at: runtime.now(),
    });
  };
  const safeObserve = (details: RequestDetailsLike): void => {
    try {
      observe(details);
    } catch {
      // A failure inside the matcher never reaches the browser's event dispatch; nothing was recorded.
    }
  };
  return (details: RequestDetailsLike): undefined => {
    if (runtime.ready) {
      safeObserve(details);
      return undefined;
    }
    // Before hydration: bounded deferral behind the same readiness promise as the S07 observer, so the host entry of
    // the same request (onBeforeRequest fires first) is applied before its match. Beyond the bound: dropped.
    if (deferred >= MAX_DEFERRED) return undefined;
    deferred++;
    void runtime.whenReady().then(() => {
      deferred--;
      safeObserve(details);
    });
    return undefined;
  };
}
