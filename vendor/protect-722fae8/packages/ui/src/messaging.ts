// UI -> SW channel helpers (privileged: the SW authorizes extension pages by sender.origin, ADR-004 §8).
// Every call is bounded: an unanswered or malformed response becomes { ok: false, code: 'unavailable' }.
// ADR-020 «Защита» (S06): typed senders of the 22 `ui-protect-*` requests (below), the permission calls of the
// Options gesture and the link to the module's Options tab.

import { PROTECT_CONSENT_VERSION, UI_ERROR_CODES, validateProtectUiRequest } from '@detect-expert/contracts';
import type {
  ProtectFeature,
  ProtectPreset,
  ProtectPurgeTarget,
  ProtectSnoozeMinutes,
  ProtectUiRequest,
  ProtectUiRequestType,
  ProtectUiResponse,
  ProtectUiResponseType,
  UiClearSessionRequest,
  UiErrorCode,
  UiProtectDecideRequest,
  UiProtectDismissRequest,
  UiProtectHistoryDeleteRequest,
  UiProtectHistoryExportRequest,
  UiProtectHistoryQueryRequest,
  UiProtectHistoryReceiverRequest,
  UiProtectListRulesRequest,
  UiProtectRemoveRulesRequest,
  UiProtectRequestDeleteRequest,
  UiProtectRequestDraftRequest,
  UiProtectRequestSaveRequest,
  UiProtectRequestStatusRequest,
  UiProtectRequestsGetRequest,
  UiProtectSetSettingsRequest,
  UiProtectUndoRequest,
  UiRemoveSiteRequest,
  UiRequest,
  UiResponse,
} from '@detect-expert/contracts';
import type { ProtectOptionsHash, ProtectPermissionRequest } from './view-models/protect';
import { PROTECT_DNR_PERMISSION, isProtectProjectionShape, parseProtectState } from './view-models/protect';
import type { GrantedAccess } from './view-models/site-access';
import { MAX_ACCESS_PATTERNS } from './view-models/site-access';

export type { UiClearSessionRequest };

/** Clears every session report (contract `ui-clear-session`, ADR-004 changelog); the SW answers ok. */
export const UI_CLEAR_SESSION_REQUEST: Readonly<UiClearSessionRequest> = Object.freeze({
  schemaVersion: 1,
  type: 'ui-clear-session',
});

export type SendFailureCode = UiErrorCode | 'unavailable';

export type SendResult = { ok: true; response: Exclude<UiResponse, { type: 'error' }> } | { ok: false; code: SendFailureCode };

export function isUiResponse(value: unknown): value is UiResponse {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { schemaVersion?: unknown; type?: unknown };
  return record.schemaVersion === 1 && typeof record.type === 'string';
}

export async function sendUiRequest(request: UiRequest): Promise<SendResult> {
  try {
    const raw: unknown = await chrome.runtime.sendMessage(request);
    if (!isUiResponse(raw)) return { ok: false, code: 'unavailable' };
    if (raw.type === 'error') return { ok: false, code: raw.code };
    return { ok: true, response: raw };
  } catch {
    return { ok: false, code: 'unavailable' };
  }
}

export interface ActiveTab {
  id: number | null;
  /** Present only when the browser exposes it (host permission / activeTab); undefined otherwise. */
  url: string | undefined;
}

/**
 * Test/debug override: an extension page opened as `popup.html?tabId=<n>` reports on that tab instead of the
 * active one (Playwright opens extension pages as ordinary tabs, so the active tab would be the page itself).
 * Only extension pages can carry this query string; web pages cannot open extension URLs (no web-accessible resources).
 */
export function readTabIdOverride(search: string): number | null {
  const match = /(?:^\?|&)tabId=(\d{1,10})(?:&|$)/.exec(search);
  if (match === null || match[1] === undefined) return null;
  const tabId = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(tabId) && tabId >= 0 ? tabId : null;
}

/** tabs.query needs no `tabs` permission for the id; `url` is omitted by Chrome without host access. */
export async function queryActiveTab(): Promise<ActiveTab> {
  try {
    // F141: fail closed until the release owner supplies the compile-time profile.
    const override = typeof __BUILD_PROFILE__ !== 'undefined' && (__BUILD_PROFILE__ === 'test' || __BUILD_PROFILE__ === 'test-optional') && typeof location !== 'undefined'
      ? readTabIdOverride(location.search) : null;
    if (override !== null) {
      const tab = await chrome.tabs.get(override);
      return { id: typeof tab.id === 'number' ? tab.id : override, url: typeof tab.url === 'string' ? tab.url : undefined };
    }
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (tab === undefined || typeof tab.id !== 'number' || tab.id < 0) return { id: null, url: undefined };
    return { id: tab.id, url: typeof tab.url === 'string' ? tab.url : undefined };
  } catch {
    return { id: null, url: undefined };
  }
}

export function errorMessageKey(code: SendFailureCode): string {
  return 'error_' + code.replace(/-/g, '_');
}

/** S12: ui-remove-site payload (the host comes from the shown row: a sanitized host from ScopeState or a grant). */
export function removeSiteRequest(host: string): UiRemoveSiteRequest {
  return { schemaVersion: 1, type: 'ui-remove-site', host };
}

function boundedStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (out.length >= MAX_ACCESS_PATTERNS) break;
    if (typeof item === 'string' && item.length <= MAX_ACCESS_PATTERNS && !out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * S12: the browser's granted host patterns (chrome.permissions.getAll) and the build's required host_permissions
 * (manifest). Strings only, at most 512 of each; null when the browser API is unavailable.
 */
export async function readGrantedAccess(): Promise<GrantedAccess | null> {
  try {
    const all = await chrome.permissions.getAll();
    let required: string[] = [];
    try {
      required = boundedStrings((chrome.runtime.getManifest() as { host_permissions?: unknown }).host_permissions);
    } catch {
      required = [];
    }
    return { origins: boundedStrings(all.origins), required };
  } catch {
    return null;
  }
}

/**
 * S12: chrome.permissions.remove from the extension page (no user gesture needed). [] -> true without a call; a
 * rejection (for example a required permission) -> false. Never throws.
 */
export async function removeOrigins(origins: readonly string[]): Promise<boolean> {
  if (origins.length === 0) return true;
  try {
    return (await chrome.permissions.remove({ origins: [...origins] })) === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// ADR-020 «Защита» (S06): `ui-protect-*`. The request is checked by the contract validator before it leaves the page
// (invalid → `invalid-request`, nothing is sent); the answer must be one of the response types expected for the
// request, `protect-state` must pass parseProtectState and `protect-report` the projection shape check. An error
// answer keeps its code only when it is a contract UiErrorCode. Widening actions (enable, set-settings, set-site with
// excluded:false) are accepted by the SW from Options only (isOptionsSender); the popup and the side panel never send
// them.
// ---------------------------------------------------------------------------

/** Answer types the UI accepts per request type (lanes read their own answers in their view models). */
export const PROTECT_RESPONSE_TYPES = {
  'ui-protect-get-state': ['protect-state'],
  'ui-protect-enable': ['protect-state'],
  'ui-protect-disable': ['protect-state'],
  'ui-protect-set-settings': ['protect-state'],
  'ui-protect-snooze': ['protect-state'],
  'ui-protect-set-site': ['protect-state'],
  'ui-protect-purge': ['protect-state'],
  'ui-protect-get-report': ['protect-report'],
  'ui-protect-decide': ['protect-decision'],
  'ui-protect-undo': ['protect-decision', 'protect-report'],
  'ui-protect-dismiss': ['protect-decision', 'protect-report'],
  'ui-protect-list-rules': ['protect-rules'],
  'ui-protect-remove-rules': ['protect-rules'],
  'ui-protect-history-query': ['protect-history'],
  'ui-protect-history-receiver': ['protect-history-receiver'],
  'ui-protect-history-delete': ['protect-history'],
  'ui-protect-history-export': ['protect-history-export'],
  'ui-protect-requests-get': ['protect-requests'],
  'ui-protect-request-draft': ['protect-request-draft'],
  'ui-protect-request-save': ['protect-requests'],
  'ui-protect-request-status': ['protect-requests'],
  'ui-protect-request-delete': ['protect-requests'],
} as const satisfies Readonly<Record<ProtectUiRequestType, ReadonlyArray<ProtectUiResponseType>>>;

export type ProtectResponseFor<T extends ProtectUiRequestType> = Extract<ProtectUiResponse, { type: (typeof PROTECT_RESPONSE_TYPES)[T][number] }>;

export type ProtectSendResult<R extends ProtectUiResponse = ProtectUiResponse> = { ok: true; response: R } | { ok: false; code: SendFailureCode };

const UI_ERROR_CODE_SET: ReadonlySet<string> = new Set(UI_ERROR_CODES);
const UNAVAILABLE: { ok: false; code: SendFailureCode } = { ok: false, code: 'unavailable' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Defensive reading of the SW answer to a `ui-protect-*` request of type `requestType`. */
export function parseProtectResponse<T extends ProtectUiRequestType>(requestType: T, raw: unknown): ProtectSendResult<ProtectResponseFor<T>> {
  if (!isUiResponse(raw)) return UNAVAILABLE;
  if (raw.type === 'error') {
    const code: unknown = (raw as { code?: unknown }).code;
    return { ok: false, code: typeof code === 'string' && UI_ERROR_CODE_SET.has(code) ? (code as UiErrorCode) : 'unavailable' };
  }
  const expected: ReadonlyArray<string> = PROTECT_RESPONSE_TYPES[requestType];
  if (!expected.includes(raw.type)) return UNAVAILABLE;
  if (raw.type === 'protect-state') {
    const state = parseProtectState((raw as { state?: unknown }).state);
    if (state === null) return UNAVAILABLE;
    return { ok: true, response: { schemaVersion: 1, type: 'protect-state', state } as ProtectResponseFor<T> };
  }
  if (raw.type === 'protect-report') {
    const report: unknown = (raw as { report?: unknown }).report;
    if (!isProtectProjectionShape(report)) return UNAVAILABLE;
    return { ok: true, response: { schemaVersion: 1, type: 'protect-report', report } as ProtectResponseFor<T> };
  }
  // Lane answers: an object of the expected type; the lane view models read the fields they use defensively.
  if (!isPlainObject(raw)) return UNAVAILABLE;
  return { ok: true, response: raw as unknown as ProtectResponseFor<T> };
}

/** Sends one `ui-protect-*` request. Never throws. */
export async function sendProtectRequest<R extends ProtectUiRequest>(request: R): Promise<ProtectSendResult<ProtectResponseFor<R['type']>>> {
  const checked = validateProtectUiRequest(request);
  if (!checked.ok || checked.value.type !== request.type) return { ok: false, code: 'invalid-request' };
  let raw: unknown;
  try {
    raw = await chrome.runtime.sendMessage(checked.value);
  } catch {
    return UNAVAILABLE;
  }
  return parseProtectResponse<R['type']>(request.type, raw);
}

type Body<T> = Omit<T, 'schemaVersion' | 'type'>;

/** Typed senders, one per `ui-protect-*` type (22). */
export const protectUi = /* @__PURE__ */ Object.freeze({
  getState: () => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-get-state' }),
  /** Options only, after requestProtectPermissions in the same gesture. */
  enable: (features: ReadonlyArray<ProtectFeature>, preset: ProtectPreset) =>
    sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-enable', consentVersion: PROTECT_CONSENT_VERSION, features: [...features], preset }),
  disable: (purge: boolean) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-disable', purge }),
  /** Options only. */
  setSettings: (body: Body<UiProtectSetSettingsRequest>) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-set-settings', ...body }),
  snooze: (minutes: ProtectSnoozeMinutes) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-snooze', minutes }),
  /** excluded:false is accepted from Options only. */
  setSite: (host: string, excluded: boolean) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-set-site', host, excluded }),
  purge: (what: ProtectPurgeTarget) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-purge', what }),
  getReport: (tabId: number, frameId?: number) =>
    sendProtectRequest(frameId === undefined
      ? { schemaVersion: 1, type: 'ui-protect-get-report', tabId }
      : { schemaVersion: 1, type: 'ui-protect-get-report', tabId, frameId }),
  decide: (body: Body<UiProtectDecideRequest>) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-decide', ...body }),
  undo: (body: Body<UiProtectUndoRequest>) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-undo', ...body }),
  dismiss: (body: Body<UiProtectDismissRequest>) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-dismiss', ...body }),
  listRules: (body: Body<UiProtectListRulesRequest>) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-list-rules', ...body }),
  removeRules: (body: Body<UiProtectRemoveRulesRequest>) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-remove-rules', ...body }),
  historyQuery: (body: Body<UiProtectHistoryQueryRequest>) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-history-query', ...body }),
  historyReceiver: (body: Body<UiProtectHistoryReceiverRequest>) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-history-receiver', ...body }),
  historyDelete: (body: Body<UiProtectHistoryDeleteRequest>) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-history-delete', ...body }),
  historyExport: (body: Body<UiProtectHistoryExportRequest>) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-history-export', ...body }),
  requestsGet: (body: Body<UiProtectRequestsGetRequest>) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-requests-get', ...body }),
  requestDraft: (body: Body<UiProtectRequestDraftRequest>) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-request-draft', ...body }),
  requestSave: (body: Body<UiProtectRequestSaveRequest>) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-request-save', ...body }),
  requestStatus: (body: Body<UiProtectRequestStatusRequest>) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-request-status', ...body }),
  requestDelete: (body: Body<UiProtectRequestDeleteRequest>) => sendProtectRequest({ schemaVersion: 1, type: 'ui-protect-request-delete', ...body }),
});

/**
 * ADR-020 §6: chrome.permissions.request must run inside the user gesture. This function calls it synchronously (no
 * await before the call), so the caller must invoke it directly from the click handler, before any await. false on a
 * refusal, a rejection or a missing API.
 */
export function requestProtectPermissions(request: ProtectPermissionRequest): Promise<boolean> {
  try {
    return Promise.resolve(chrome.permissions.request({ origins: [...request.origins], permissions: [...request.permissions] }))
      .then((granted) => granted === true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

/** After the SW stopped the module and removed our rules (SP-5): drop the optional DNR grant. Never throws. */
export async function removeProtectDnrPermission(): Promise<boolean> {
  try {
    return (await chrome.permissions.remove({ permissions: [PROTECT_DNR_PERMISSION] })) === true;
  } catch {
    return false;
  }
}

/** Opens the module's Options tab (`options.html#<hash>`) in a new tab; no `tabs` permission is needed. */
export async function openProtectOptions(hash: ProtectOptionsHash = 'protect'): Promise<boolean> {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('options.html#' + hash) });
    return true;
  } catch {
    return false;
  }
}
