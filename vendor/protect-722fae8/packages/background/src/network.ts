import { isLocalTarget, leftmostSubLabel, redactHost, requestScheme, siteRelation } from '../../attribution/src/index';
import type { RedactedHost } from '../../attribution/src/index';
// Network observer (S07, ADR-018; spec A9, ADR-007 §2, ADR-008): non-blocking webRequest.onBeforeRequest. It sees
// request ATTEMPTS the page made; the extension itself never sends, probes, resolves or repeats anything.
//
// Order of checks in the callback (cheap and permission checks first):
//   1. any host access at all; known resource type; sanitizable target host; a browser-reported initiator;
//   2. sub_frame requests belong to the parent document; tabId < 0 (workers, browser) stays unattributed;
//   3. scope.networkRequestAllowed: active-tab -> the captured document only; site/all-sites -> grants on BOTH target
//      and initiator (ws/wss checked as http/https);
//   4. runtime.networkDocumentLookup: a document with access that is neither paused nor revoked (its current binding,
//      or its report under the same Chrome ids after the binding moved on); an unknown document counts as
//      unattributed.requests (explicit gap, I1), an out-of-scope/paused/revoked one is skipped by design;
//   5. redaction inside this callback: PSL registrable domain or category (PT-2: a registrable domain whose own label
//      looks random is folded into 'unknown'), relation to the initiator, local target
//      (DET-060) cross-origin to the requesting document (I1), window counts only from a public document, effective
//      port (default 80/443), salted ephemeral tokens, random label;
//   6. dispatch 'network:host' with enums and small counts only.
// Raw URL, host, port, label and initiator never leave local variables: no path, query, port, IP literal or label
// reaches the reducer, storage, the UI or the export. The tracker keeps only salted tokens in SW memory.

import { sanitizeHost } from '@detect-expert/contracts';
import { looksRandomLabel } from '@detect-expert/engine';
import type { RequestDetailsLike, RequestFilterLike } from './chrome-api';
import type { NetworkRequestClass } from './documents';
import type { BackgroundRuntime } from './runtime';

/** Long-standing webRequest resource types observed by S07 (main_frame is navigation, not a request of the page). */
export const NETWORK_RESOURCE_TYPES = [
  'script',
  'xmlhttprequest',
  'sub_frame',
  'websocket',
  'ping',
  'image',
  'media',
  'font',
  'stylesheet',
  'other',
] as const;
export type NetworkResourceType = (typeof NETWORK_RESOURCE_TYPES)[number];
/** Optional type: added only when this Chrome's webRequest.ResourceType lists it (an unknown type throws in addListener). */
export const OPTIONAL_NETWORK_RESOURCE_TYPES = ['webtransport'] as const;

export interface NetworkFilter extends RequestFilterLike {
  urls: string[];
  types: string[];
}

/**
 * Filter for webRequest.onBeforeRequest. `available` is chrome.webRequest.ResourceType (or its values): optional
 * types are added only when present there; without it only the base list is used.
 */
export function buildNetworkFilter(available?: Readonly<Record<string, string>> | readonly string[] | null): NetworkFilter {
  const known = new Set<string>();
  if (Array.isArray(available)) for (const v of available) { if (typeof v === 'string') known.add(v); }
  else if (available !== null && typeof available === 'object') for (const v of Object.values(available)) { if (typeof v === 'string') known.add(v); }
  const types: string[] = [...NETWORK_RESOURCE_TYPES];
  for (const t of OPTIONAL_NETWORK_RESOURCE_TYPES) if (known.has(t)) types.push(t);
  return { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'], types };
}

/** Default filter without feature detection (base types only). */
export const NETWORK_FILTER: NetworkFilter = buildNetworkFilter();

const TYPE_SET: ReadonlySet<string> = new Set<string>([...NETWORK_RESOURCE_TYPES, ...OPTIONAL_NETWORK_RESOURCE_TYPES]);

/** Request class carried to the reducer (string literals; never API identifiers, see scripts/code-checks.mjs). */
export function classifyRequest(type: string): NetworkRequestClass {
  switch (type) {
    case 'websocket':
    case 'webtransport':
      return 'socket';
    case 'xmlhttprequest':
      return 'xhr';
    case 'ping':
      return 'beacon';
    case 'sub_frame':
      return 'frame';
    default:
      return 'subresource';
  }
}

/** Effective port of an http(s)/ws(s) URL: explicit port or the scheme default (80/443); null when unparsable. */
function effectivePort(url: string, scheme: 'http' | 'https'): string | null {
  try {
    const port = new URL(url).port;
    return port.length > 0 ? port : scheme === 'https' ? '443' : '80';
  } catch {
    return null;
  }
}

/**
 * I1: origin equality of the request URL and the browser-reported initiator (the requesting document's origin):
 * scheme (ws/wss compared as http/https, as in siteRelation), WHATWG hostname and effective port. Unparsable -> false.
 */
function sameOrigin(url: string, scheme: 'http' | 'https', initiator: string): boolean {
  if (requestScheme(initiator) !== scheme) return false;
  try {
    if (new URL(url).hostname !== new URL(initiator).hostname) return false;
  } catch {
    return false;
  }
  const port = effectivePort(url, scheme);
  return port !== null && port === effectivePort(initiator, scheme);
}

function publicInitiator(initiatorHost: string): boolean {
  const r = redactHost(initiatorHost);
  return r.kind === 'registrable' || (r.kind === 'ip' && r.value === 'public');
}

/**
 * PT-2 (docs/PROJECT_RULES.md #5, ADR-018): redaction of a request target for the host list. The PSL (ICANN and PRIVATE sections,
 * ADR-008) makes `<token>.ngrok-free.app`, `<token>.workers.dev` or `<id>.cloudfront.net` a registrable domain whose
 * own leftmost label is the random part. Such a name is a random DNS label: it is folded into the 'unknown' category
 * and never stored or shown. `randomSuffix` (the public suffix under the label) stays in the callback and only keys
 * the ephemeral DET-061 window, so these labels are counted like random subdomains. Other targets are unchanged.
 */
export function redactNetworkTarget(host: string): { redacted: RedactedHost; randomSuffix: string | null } {
  const redacted = redactHost(host);
  if (redacted.kind !== 'registrable') return { redacted, randomSuffix: null };
  const dot = redacted.value.indexOf('.');
  if (dot <= 0 || !looksRandomLabel(redacted.value.slice(0, dot))) return { redacted, randomSuffix: null };
  return { redacted: { kind: 'unknown' }, randomSuffix: redacted.value.slice(dot + 1) };
}

/** Bounded deferral of events that arrive before hydration (SW wake-up by the event itself). */
const MAX_DEFERRED = 256;

/** Non-blocking listener: always returns undefined (never a BlockingResponse). */
export type NetworkListener = (details: RequestDetailsLike) => undefined;

export function createNetworkListener(runtime: BackgroundRuntime): NetworkListener {
  let deferred = 0;
  const observe = (details: RequestDetailsLike): void => {
    // 1. Cheap guards.
    if (!runtime.scope.hasAnyHostAccess()) return;
    if (typeof details.type !== 'string' || !TYPE_SET.has(details.type) || typeof details.url !== 'string') return;
    const host = sanitizeHost(details.url);
    if (host === null) return;
    const initiator = typeof details.initiator === 'string' ? details.initiator : null;
    if (initiator === null) return;
    const initiatorHost = sanitizeHost(initiator);
    if (initiatorHost === null) return;
    // 2. Attribution: a frame request belongs to the parent document (A7); workers and the browser stay unattributed.
    const tabId = typeof details.tabId === 'number' ? details.tabId : -1;
    if (tabId < 0) {
      runtime.countUnattributedRequest();
      return;
    }
    const isFrame = details.type === 'sub_frame' && typeof details.parentDocumentId === 'string' &&
      typeof details.parentFrameId === 'number' && details.parentFrameId >= 0;
    const frameId = isFrame ? (details.parentFrameId as number) : typeof details.frameId === 'number' ? details.frameId : 0;
    const documentId = isFrame ? (details.parentDocumentId as string) : typeof details.documentId === 'string' ? details.documentId : null;
    // 3. Permission matrix of the current scope mode.
    const scheme = requestScheme(details.url);
    if (!runtime.scope.networkRequestAllowed(tabId, documentId, host, scheme, initiatorHost, requestScheme(initiator)) ||
        scheme === null || documentId === null) return;
    // 4. Document binding, access, pause and revocation. An unknown document is an explicit gap (I1), never silent.
    const lookup = runtime.networkDocumentLookup(tabId, frameId, documentId);
    if (lookup.kind === 'unbound') {
      runtime.countUnattributedRequest();
      return;
    }
    if (lookup.kind !== 'document') return;
    const key = lookup.key;
    // 5. Redaction and ephemeral windows (raw values stay in this scope).
    const at = runtime.now();
    const target = redactNetworkTarget(host);
    const redacted = target.redacted;
    const relation = siteRelation(details.url, initiator);
    let local: { fromPublic: boolean; ports: number; targets: number } | undefined;
    // I1 / ADR-018 ред.: DET-060 counts a local target only when it is cross-origin to the requesting document (the
    // browser-reported initiator). A page served from localhost / a LAN address loading its own resources is not a
    // local-address attempt; a dev page calling another local port still is (api-use; patterns need fromPublic).
    if (isLocalTarget(redacted) && !sameOrigin(details.url, scheme, initiator)) {
      const fromPublic = publicInitiator(initiatorHost);
      local = { fromPublic, ports: 0, targets: 0 };
      if (fromPublic) {
        const port = effectivePort(details.url, scheme);
        if (port !== null) {
          const window = runtime.networkWindows.observeLocal(key, host, host + ':' + port, at);
          local = { fromPublic, ports: window.ports, targets: window.targets };
        }
      }
    }
    let randomSubdomains: number | undefined;
    // PT-2: a random label directly under a public suffix counts per suffix (the label itself is never kept).
    if (target.randomSuffix !== null) randomSubdomains = runtime.networkWindows.observeSubdomain(key, target.randomSuffix, host, at);
    else if (redacted.kind === 'registrable') {
      const label = leftmostSubLabel(host, redacted.value);
      if (label !== null && looksRandomLabel(label)) randomSubdomains = runtime.networkWindows.observeSubdomain(key, redacted.value, host, at);
    }
    // 6. Enums and small counts only.
    runtime.dispatch({
      type: 'network:host',
      tabId,
      frameId: typeof details.frameId === 'number' ? details.frameId : 0,
      documentId: typeof details.documentId === 'string' ? details.documentId : null,
      parentFrameId: typeof details.parentFrameId === 'number' ? details.parentFrameId : null,
      parentDocumentId: typeof details.parentDocumentId === 'string' ? details.parentDocumentId : null,
      resourceType: details.type,
      host: redacted.kind === 'registrable' ? redacted.value : '',
      ...(redacted.kind === 'registrable' ? {} : { category: redacted.kind === 'unknown' ? 'unknown' as const : redacted.value }),
      relation,
      requestClass: classifyRequest(details.type),
      ...(local === undefined ? {} : { local }),
      ...(randomSubdomains === undefined ? {} : { randomSubdomains }),
      at,
    });
  };
  // A failure inside the observer must never surface in the browser's event dispatch or as an unhandled rejection.
  const safeObserve = (details: RequestDetailsLike): void => {
    try {
      observe(details);
    } catch {
      // Dropped request: nothing was recorded for it.
    }
  };
  return (details: RequestDetailsLike): undefined => {
    if (runtime.ready) {
      safeObserve(details);
      return undefined;
    }
    // Before hydration the bindings are not known yet (the event itself may have woken the SW): defer once, bounded.
    // The closure keeps the browser's details object in SW memory until readiness; nothing is stored or queued in
    // reducer state, and the same callback then applies every check above.
    if (deferred >= MAX_DEFERRED) {
      runtime.countUnattributedRequest();
      return undefined;
    }
    deferred++;
    void runtime.whenReady().then(() => {
      deferred--;
      safeObserve(details);
    });
    return undefined;
  };
}

/** Only PSL registrable names may be retained as names; IP/local/unknown use categories instead. */
export function approvedNetworkHost(host: string): boolean {
  return redactHost(host).kind === 'registrable';
}
