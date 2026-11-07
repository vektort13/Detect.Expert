import { redactHost, siteRelation } from '../../attribution/src/index';
// Minimal network observer (spec A9, ADR-007 §2): webRequest.onCompleted for script/xmlhttprequest/sub_frame/
// other on http(s). Only the sanitized host survives the callback — no headers, no bodies, no full URL,
// no requestId retained. Attribution by documentId (A7: tabId -1 stays unattributed).

import { sanitizeHost } from '@detect-expert/contracts';
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
    // Guard: without any granted host access there is nothing to attribute (Chrome would not fire, but be explicit).
    if (!runtime.scope.hasAnyHostAccess()) return;
    if (typeof details.type !== 'string' || !TYPE_SET.has(details.type)) return;
    const host = sanitizeHost(details.url);
    if (host === null) return;
    const initiator = typeof details.initiator === 'string' ? details.initiator : '';
    const initiatorHost = sanitizeHost(initiator);
    if (!initiatorHost || !runtime.scope.isHostGrantedSync(host, details.url.startsWith('https:') ? 'https' : 'http') ||
        !runtime.scope.isHostGrantedSync(initiatorHost, initiator.startsWith('https:') ? 'https' : 'http')) return;
    const redacted = redactHost(host);
    const relation = siteRelation(details.url, initiator);
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
      at: runtime.now(),
    });
  };
}

/** Only PSL registrable names may be retained as names; IP/local/unknown use categories instead. */
export function approvedNetworkHost(host: string): boolean {
  return redactHost(host).kind === 'registrable';
}
