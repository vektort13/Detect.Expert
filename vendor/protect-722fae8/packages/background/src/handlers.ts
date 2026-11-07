// runtime.onMessage dispatcher (docs/PROJECT_RULES.md «Протокол v1», spec A5/A6, ADR-004 §8, E04-02).
// Two channels, decided by MessageSender only: extension pages get the privileged UI channel; content scripts
// get the PageBatch channel. The listener is synchronous, returns true, and answers through sendResponse.
// ADR-020 (S04): the opt-in module «Защита» adds ui-protect-* on the UI channel (one route, one validator) and
// protect-hello|arm|input|events on the content channel (answer protect-ack); a page can never reach ui-protect-*.

import { PROTECT_UI_REQUEST_TYPES, validatePageBatch, validateUiRequest } from '@detect-expert/contracts';
import type { Ack, ProtectAck, ProtectUiRequest, UiRequest, UiResponse } from '@detect-expert/contracts';
import type { MessageSenderLike } from './chrome-api';
import type { BackgroundRuntime } from './runtime';
import { uiError } from './runtime';
import { readPageSender, readSenderTabTop, verifyUiSender } from './sender';

/**
 * Answers: Ack (content channel), UiResponse (UI channel) and, ADR-020 (S04), ProtectAck for the module's page
 * messages. Chrome's sendResponse takes any JSON value (`(response?: any) => void`); the declared callback keeps the
 * observation answer type so existing callers stay valid, and createMessageListener widens it for ProtectAck.
 */
export type MessageResponse = Ack | UiResponse | ProtectAck;

export type MessageListener = (message: unknown, sender: MessageSenderLike, sendResponse: (response: Ack | UiResponse) => void) => boolean;

const PROTECT_UI_TYPES: ReadonlySet<string> = new Set<string>(PROTECT_UI_REQUEST_TYPES);
/** ISOLATED (protect.js) -> SW message types of the module (ADR-020 §9). */
const PROTECT_PAGE_TYPES: ReadonlySet<string> = new Set(['protect-hello', 'protect-arm', 'protect-input', 'protect-events']);
const PROTECT_INACTIVE: ProtectAck = { schemaVersion: 1, type: 'protect-ack', active: false, groups: 0 };

function isProtectUiRequest(request: UiRequest): request is ProtectUiRequest {
  return PROTECT_UI_TYPES.has(request.type);
}

function readField(message: unknown, field: 'schemaVersion' | 'type'): unknown {
  if (typeof message !== 'object' || message === null) return undefined;
  return (message as Record<string, unknown>)[field];
}

function ack(lastCommittedBatchSeq: number, paused: boolean, protocolOk: boolean): Ack {
  return { schemaVersion: 1, type: 'ack', lastCommittedBatchSeq, paused, protocolOk };
}

async function routeUi(runtime: BackgroundRuntime, message: unknown, sender: MessageSenderLike): Promise<UiResponse> {
  const request = validateUiRequest(message);
  if (!request.ok) return uiError('invalid-request');
  await runtime.whenReady();
  runtime.sweepExpired(runtime.now());
  const r = request.value;
  // ADR-020 (S04): one route for the module; widening actions are checked against the Options page there.
  if (isProtectUiRequest(r)) {
    const response = await runtime.protect.routeUi(r, sender);
    // S09: firewall prompts may have changed (decision, snooze, module state): the badge follows.
    runtime.markProtectBadge(r.type, 'tabId' in r ? r.tabId : null);
    return response;
  }
  switch (r.type) {
    case 'ui-get-report': {
      await runtime.whenReady();
      await runtime.scope.refreshRegistration(); // throttled: the projection must know whether sensors could have been injected
      const report = r.frameId === undefined ? runtime.getProjection(r.tabId) : runtime.getProjection(r.tabId, r.frameId);
      return { schemaVersion: 1, type: 'report', report };
    }
    case 'ui-pause':
      return runtime.pause(r.tabId, r.documentKey, r.reportRevision);
    case 'ui-resume':
      return runtime.resume(r.tabId, r.documentKey, r.reportRevision);
    case 'ui-clear':
      return runtime.clear(r.tabId, r.documentKey, r.reportRevision);
    case 'ui-set-scope': {
      await runtime.whenReady();
      const result = await runtime.scope.setScope(r);
      if (!result.ok) return uiError(result.code);
      await runtime.onPermissionsChanged();
      if (!runtime.scope.registrationHealthy) return uiError('no-access');
      return { schemaVersion: 1, type: 'scope', scope: runtime.scopeState() };
    }
    case 'ui-export-preview':
      return runtime.exportPreview(r.tabId, r.documentKey, r.reportRevision, r.includeHost);
    case 'ui-get-scope': {
      await runtime.whenReady();
      return { schemaVersion: 1, type: 'scope', scope: runtime.scopeState() };
    }
    case 'ui-inject-now':
      return runtime.injectNow(r.tabId);
    case 'ui-clear-session':
      return runtime.clearSession();
    case 'ui-set-sensor':
      // ADR-019: privileged UI channel only (verifyUiSender above); a page can never reach this.
      return runtime.setSensor(r.sensorId, r.enabled);
    case 'ui-remove-site': {
      // S12 / ADR-003 v3: privileged UI channel only. The list shrinks, then the documents now out of scope get
      // bridge-stop + revoked (onPermissionsChanged reconciles registration and access).
      await runtime.whenReady();
      await runtime.scope.removeSite(r.host);
      await runtime.onPermissionsChanged();
      if (!runtime.scope.registrationHealthy) return uiError('no-access');
      return { schemaVersion: 1, type: 'scope', scope: runtime.scopeState() };
    }
    default:
      return uiError('invalid-request');
  }
}

async function routePage(runtime: BackgroundRuntime, message: unknown, sender: MessageSenderLike): Promise<MessageResponse> {
  const type = readField(message, 'type');
  const protect = typeof type === 'string' && PROTECT_PAGE_TYPES.has(type);
  const read = readPageSender(sender, runtime.api.runtime.id);
  if (!read.ok) {
    if (read.reason === 'opaque-origin' && type === 'sensor-events') {
      // readPageSender already validated these browser IDs before returning opaque-origin.
      runtime.dispatch({ type: 'frame:unavailable', tabId: sender.tab!.id!, frameId: sender.frameId!, documentId: sender.documentId!, at: runtime.now() });
      return { ...ack(0, true, true), stopReason: 'revoked' };
    }
    // ADR-020: the module part of an opaque frame (no site) stops; it never runs there.
    if (read.reason === 'opaque-origin' && protect) return PROTECT_INACTIVE;
    return uiError('unauthorized-sender');
  }
  const ctx = read.context;
  // ADR-020 (S04): module messages get protect-ack; rate limit, grant, active state and exclusions are checked there.
  // Review r2: the top-level site of the sender's tab comes from MessageSender.tab.url (browser-trusted), not only from
  // the module's tab model, which does not know tabs loaded before enable.
  if (protect) {
    if (readField(message, 'schemaVersion') !== 1) return PROTECT_INACTIVE;
    return runtime.protect.onPageMessage(ctx, message, readSenderTabTop(sender));
  }
  // Unknown protocol version -> protocolOk:false (bridge stops); checked before the full validation.
  if (readField(message, 'schemaVersion') !== 1) return ack(0, true, false);
  // A content script may only deliver observations; ui-* or anything else from a page sender is refused.
  if (type !== 'sensor-events') return uiError('unauthorized-sender');
  if (!runtime.admitBatch(ctx)) {
    const session = typeof message === 'object' && message !== null ? (message as Record<string, unknown>)['bridgeSessionId'] : undefined;
    return ack(runtime.lastPersistedSeq(ctx.documentKey, typeof session === 'string' ? session : undefined), runtime.isPaused(ctx.documentKey), true);
  }
  const batch = validatePageBatch(message);
  if (!batch.ok) {
    runtime.countTransportDrop(ctx.documentKey);
    return ack(runtime.lastPersistedSeq(ctx.documentKey), runtime.isPaused(ctx.documentKey), true);
  }
  if (!await runtime.batchReadiness(ctx.documentKey)) return ack(0, false, true);
  const granted = ctx.originPattern !== null && (await runtime.scope.isGranted(ctx.originPattern, ctx.tabId, ctx.documentId));
  // Out of the granted scope (revoked while injected): stop instruction, nothing accepted (ADR-003 §5).
  if (!granted) return { ...ack(0, true, true), stopReason: 'revoked' };
  return runtime.handleBatch(ctx, batch.value, true);
}

export async function route(runtime: BackgroundRuntime, message: unknown, sender: MessageSenderLike): Promise<MessageResponse> {
  if (verifyUiSender(sender, runtime.api.runtime.id)) return routeUi(runtime, message, sender);
  return routePage(runtime, message, sender);
}

/** Synchronous listener: kicks off routing, returns true, answers via sendResponse (portable MV3 contract). */
export function createMessageListener(runtime: BackgroundRuntime): MessageListener {
  return (message, sender, sendResponse) => {
    const respond = sendResponse as (response: MessageResponse) => void;
    route(runtime, message, sender).then(respond, () => {
      respond(uiError('invalid-request')); // Non-Ack: bounded deliverer retry on transient SW failures (F020).
    });
    return true;
  };
}
