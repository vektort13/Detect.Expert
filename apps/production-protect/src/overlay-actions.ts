// ADR-058: a page-hosted card can act only on its current, native-bound Firewall prompt.
// Sender/current-document/generation checks belong to ProtectOverlayController before this pure guard.
import { PROTECT_BUDGETS, validateProtectUiRequest } from '@detect-expert/contracts';
import type { ProtectProjection, ProtectUiRequest } from '@detect-expert/contracts';
import type { OverlayActionMessage } from './overlay-protocol';

export interface OverlayActionContext {
  tabId: number;
  documentKey: string;
  report: ProtectProjection | null;
  /** Only successful overlay-created once decisions, already restricted to this document and TTL. */
  undoIds: ReadonlySet<string>;
}
export type OverlayActionResult =
  | { type: 'request'; request: ProtectUiRequest }
  | { type: 'review' }
  | { type: 'reject'; code: 'invalid-request' | 'stale-revision' | 'module-disabled' | 'not-found' };

type Data = Record<string, unknown>;
const INVALID = { type: 'reject', code: 'invalid-request' } as const;
const STALE = { type: 'reject', code: 'stale-revision' } as const;
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ENVELOPE = ['schemaVersion', 'type', 'kind', 'generation', 'documentKey', 'action', 'request'];

/** Exact own data fields only: never turn an arbitrary body into privileged UI input by spreading it. */
function fields(value: unknown, expected: readonly string[]): Data | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some(key => typeof key !== 'string' || !expected.includes(key))) return null;
  const result: Data = {};
  for (const key of expected) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !Object.hasOwn(field, 'value')) return null;
    result[key] = field.value;
  }
  return result;
}
function receivers(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 1 || length > PROTECT_BUDGETS.maxPromptReceivers || Reflect.ownKeys(value).length !== length + 1) return null;
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (!field || !Object.hasOwn(field, 'value') || typeof field.value !== 'string') return null;
    result.push(field.value);
  }
  return result;
}

/**
 * Bodies exclude schemaVersion/type/tabId/frameId. The adapter removes its own UI routing fields;
 * an incoming payload cannot choose a native target. Persistent rules and global pause always require
 * the extension-owned review page, since a trusted click on a page-owned host can still be clickjacked.
 */
export function authorizeOverlayAction(action: OverlayActionMessage, context: OverlayActionContext): OverlayActionResult {
  try {
    const input = fields(action, ENVELOPE);
    if (!input || input['schemaVersion'] !== 1 || input['type'] !== 'protect-overlay-action' || input['kind'] !== 'findings' || !Number.isSafeInteger(input['generation']) || (input['generation'] as number) <= 0) return INVALID;
    if (!Number.isSafeInteger(context.tabId) || context.tabId < 0 || !context.documentKey.startsWith(`${context.tabId}:0:`) || !DOCUMENT_ID.test(context.documentKey.slice(`${context.tabId}:0:`.length))) return INVALID;
    const report = context.report;
    if (input['documentKey'] !== context.documentKey || report?.documentKey !== context.documentKey) return STALE;
    if ((report.moduleState !== 'active' && report.moduleState !== 'degraded') || !report.features.includes('firewall') || report.limitations.includes('site-excluded')) return { type: 'reject', code: 'module-disabled' };
    const name = input['action'];
    const body = fields(input['request'], name === 'decide'
      ? ['documentKey', 'protectRevision', 'promptId', 'receivers', 'action', 'scope']
      : name === 'dismiss' ? ['documentKey', 'protectRevision', 'promptId']
        : name === 'undo' ? ['undoId'] : name === 'snooze' ? ['minutes'] : []);
    if (!body || (name !== 'decide' && name !== 'dismiss' && name !== 'undo' && name !== 'snooze')) return INVALID;
    const values = name === 'decide' ? receivers(body['receivers']) : null;
    if (name === 'decide' && values === null) return INVALID;
    const candidate = name === 'decide'
      ? { schemaVersion: 1, type: 'ui-protect-decide', tabId: context.tabId, documentKey: body['documentKey'], protectRevision: body['protectRevision'], promptId: body['promptId'], receivers: values, action: body['action'], scope: body['scope'] }
      : name === 'dismiss'
        ? { schemaVersion: 1, type: 'ui-protect-dismiss', tabId: context.tabId, documentKey: body['documentKey'], protectRevision: body['protectRevision'], promptId: body['promptId'] }
        : name === 'undo' ? { schemaVersion: 1, type: 'ui-protect-undo', tabId: context.tabId, undoId: body['undoId'] }
          : { schemaVersion: 1, type: 'ui-protect-snooze', minutes: body['minutes'] };
    const checked = validateProtectUiRequest(candidate);
    if (!checked.ok) return INVALID;
    const request = checked.value;
    if (request.type === 'ui-protect-snooze') return { type: 'review' };
    if (request.type === 'ui-protect-undo') return context.undoIds.has(request.undoId) ? { type: 'request', request } : { type: 'reject', code: 'not-found' };
    if (request.type !== 'ui-protect-decide' && request.type !== 'ui-protect-dismiss') return INVALID;
    const prompt = report.firewall.prompt;
    if (!prompt || request.documentKey !== context.documentKey || request.protectRevision !== report.protectRevision || request.promptId !== prompt.promptId || prompt.site !== report.site) return STALE;
    if (request.type === 'ui-protect-decide') {
      if (!request.receivers.every(receiver => prompt.receivers.includes(receiver))) return STALE;
      if (request.scope !== 'once') return { type: 'review' };
    }
    return { type: 'request', request };
  } catch { return INVALID; }
}
