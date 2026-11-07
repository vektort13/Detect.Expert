import { redactHost, siteRelation } from '../../attribution/src/index';
// Minimal network observer (spec A9, ADR-007 §2): webRequest.onCompleted for script/xmlhttprequest/sub_frame/
// other on http(s). Only the sanitized host and reviewed constant rule IDs survive the callback — no
// headers, bodies, full URL or requestId. Attribution by documentId (A7: tabId -1 stays unattributed).

import { sanitizeHost } from '@detect-expert/contracts';
import { matchVendorResource } from '../../catalog/src/index';
import type { RequestDetailsLike, RequestFilterLike } from './chrome-api';
import type { BackgroundRuntime } from './runtime';

export const NETWORK_RESOURCE_TYPES = ['script', 'xmlhttprequest', 'sub_frame', 'other'] as const;
export type NetworkResourceType = (typeof NETWORK_RESOURCE_TYPES)[number];

/** Filter for webRequest.onCompleted; typed so it is assignable to chrome.webRequest.RequestFilter. */
export const NETWORK_FILTER: RequestFilterLike & { types: NetworkResourceType[] } = {
  urls: ['http://*/*', 'https://*/*'],
  types: [...NETWORK_RESOURCE_TYPES],
};

const TYPE_SET: ReadonlySet<string> = new Set<string>(NETWORK_RESOURCE_TYPES);

export function createNetworkListener(runtime: BackgroundRuntime): (details: RequestDetailsLike) => void {
  return (details: RequestDetailsLike): void => {
    if (!runtime.canBufferRedactedBrowserData()) return;
    // ADR-009: a request may wake the worker before its grants are hydrated. Buffer only
    // the normalized event; replay then requires verified all-sites access and document binding.
    const requiresAllSitesAccess = !runtime.hydrationComplete;
    if (!requiresAllSitesAccess && !runtime.scope.hasAnyHostAccess()) return;
    if (typeof details.type !== 'string' || !TYPE_SET.has(details.type)) return;
    const host = sanitizeHost(details.url);
    if (host === null) return;
    const initiator = typeof details.initiator === 'string' ? details.initiator : '';
    const initiatorHost = sanitizeHost(initiator);
    if (!initiatorHost || (!requiresAllSitesAccess &&
        (!runtime.scope.isHostGrantedSync(host, details.url.startsWith('https:') ? 'https' : 'http') ||
        !runtime.scope.isHostGrantedSync(initiatorHost, initiator.startsWith('https:') ? 'https' : 'http')))) return;
    const redacted = redactHost(host);
    const relation = siteRelation(details.url, initiator);
    const at = runtime.now();
    // ADR-009: a completed successful resource establishes loading only, never SDK execution.
    // URL/query remain transient inside the matcher; only vetted constant rule IDs enter state.
    const status = details.statusCode;
    const ruleIds = typeof status === 'number' && Number.isInteger(status) &&
      ((status >= 200 && status <= 299) || status === 304)
      ? matchVendorResource(details.url, details.type, at).map(match => match.ruleId) : [];
    runtime.dispatch({
      type: 'network:host',
      tabId: typeof details.tabId === 'number' ? details.tabId : -1,
      frameId: typeof details.frameId === 'number' ? details.frameId : 0,
      documentId: typeof details.documentId === 'string' ? details.documentId : null,
      parentFrameId: typeof details.parentFrameId === 'number' ? details.parentFrameId : null,
      parentDocumentId: typeof details.parentDocumentId === 'string' ? details.parentDocumentId : null,
      resourceType: details.type,
      host: redacted.kind === 'registrable' ? redacted.value : '',
      ...(redacted.kind === 'registrable' ? {} : { category: redacted.kind === 'unknown' ? 'unknown' as const : redacted.value }),
      relation,
      ruleIds,
      ...(requiresAllSitesAccess ? { requiresAllSitesAccess: true as const } : {}),
      at,
    });
  };
}

/** Only PSL registrable names may be retained as names; IP/local/unknown use categories instead. */
export function approvedNetworkHost(host: string): boolean {
  return redactHost(host).kind === 'registrable';
}
