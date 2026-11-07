// runtime.onMessage dispatcher (docs/PROJECT_RULES.md «Протокол v1», spec A5/A6, ADR-004 §8, E04-02).
// Two channels, decided by MessageSender only: extension pages get the privileged UI channel; content scripts
// get the PageBatch channel. The listener is synchronous, returns true, and answers through sendResponse.

import { validatePageBatch, validateUiRequest } from '@detect-expert/contracts';
import type { Ack, UiResponse } from '@detect-expert/contracts';
import type { MessageSenderLike } from './chrome-api';
import type { BackgroundRuntime } from './runtime';
import { uiError } from './runtime';
import { readPageSender, verifyUiSender } from './sender';

export type MessageListener = (message: unknown, sender: MessageSenderLike, sendResponse: (response: Ack | UiResponse) => void) => boolean;

function readField(message: unknown, field: 'schemaVersion' | 'type'): unknown {
  if (typeof message !== 'object' || message === null) return undefined;
  return (message as Record<string, unknown>)[field];
}

function ack(lastCommittedBatchSeq: number, paused: boolean, protocolOk: boolean): Ack {
  return { schemaVersion: 1, type: 'ack', lastCommittedBatchSeq, paused, protocolOk };
}

async function routeUi(runtime: BackgroundRuntime, message: unknown): Promise<UiResponse> {
  const request = validateUiRequest(message);
  if (!request.ok) return uiError('invalid-request');
  await runtime.whenReady();
  runtime.sweepExpired(runtime.now());
  const r = request.value;
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
      return { schemaVersion: 1, type: 'scope', scope: runtime.scope.getState() };
    }
    case 'ui-export-preview':
      return runtime.exportPreview(r.tabId, r.documentKey, r.reportRevision, r.includeHost);
    case 'ui-get-scope': {
      await runtime.whenReady();
      return { schemaVersion: 1, type: 'scope', scope: runtime.scope.getState() };
    }
    case 'ui-inject-now':
      return runtime.injectNow(r.tabId);
    case 'ui-clear-session':
      return runtime.clearSession();
  }
}

async function routePage(runtime: BackgroundRuntime, message: unknown, sender: MessageSenderLike): Promise<Ack | UiResponse> {
  const read = readPageSender(sender, runtime.api.runtime.id);
  if (!read.ok) {
    if (read.reason === 'opaque-origin' && readField(message, 'type') === 'sensor-events') {
      // readPageSender already validated these browser IDs before returning opaque-origin.
      runtime.dispatch({ type: 'frame:unavailable', tabId: sender.tab!.id!, frameId: sender.frameId!, documentId: sender.documentId!, at: runtime.now() });
      return { ...ack(0, true, true), stopReason: 'revoked' };
    }
    return uiError('unauthorized-sender');
  }
  const ctx = read.context;
  // Unknown protocol version -> protocolOk:false (bridge stops); checked before the full validation.
  if (readField(message, 'schemaVersion') !== 1) return ack(0, true, false);
  // A content script may only deliver observations; ui-* or anything else from a page sender is refused.
  if (readField(message, 'type') !== 'sensor-events') return uiError('unauthorized-sender');
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

export async function route(runtime: BackgroundRuntime, message: unknown, sender: MessageSenderLike): Promise<Ack | UiResponse> {
  if (verifyUiSender(sender, runtime.api.runtime.id)) return routeUi(runtime, message);
  return routePage(runtime, message, sender);
}

/** Synchronous listener: kicks off routing, returns true, answers via sendResponse (portable MV3 contract). */
export function createMessageListener(runtime: BackgroundRuntime): MessageListener {
  return (message, sender, sendResponse) => {
    route(runtime, message, sender).then(sendResponse, () => {
      sendResponse(uiError('invalid-request')); // Non-Ack: bounded deliverer retry on transient SW failures (F020).
    });
    return true;
  };
}
