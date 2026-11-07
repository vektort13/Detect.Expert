// ADR-023: opt-in, local scenario recordings. This is a privileged UI/SW channel, never MAIN.
import { ATTRIBUTION_CONFIDENCES, COUNT_QUALITIES, COVERAGE_FLAGS, COVERAGE_STATES, EVIDENCE_SOURCES, INTEGRITIES, INTERPRETATIONS, INTERPRETATION_CONFIDENCES, PHASES, SCOPE_MODES, SIGNAL_CODES, TECHNIQUE_IDS, VENDOR_MATCHES } from './enums';
import type { ReportProjection } from './messages';
import { readPermissionChecks } from './permission-checks';
import { readApiOperations } from './api-operations';
import { readRequestedLocalPorts } from './local-ports';
import { readResponseHeaders } from './response-headers';
import { MAX_COUNT } from './budgets';
import { readExtensionResources } from './extension-resources';

export const PRO_LIMITS = Object.freeze({ durationMs: 600_000, maxPages: 100, maxTabs: 16, maxResourcesPerPage: 500, maxResources: 5_000, maxDocumentsPerPage: 24, maxBytes: 3 * 1024 * 1024, maxUrlChars: 512, maxTitleChars: 200, maxPendingRequests: 1024 });
export const PRO_LIMITATIONS = ['started-mid-page', 'service-worker-restarted', 'navigation-gap', 'resource-limit', 'page-limit', 'document-limit', 'event-limit', 'storage-error', 'permission-limited', 'unsupported-contexts', 'redacted-urls'] as const;
export type ProLimitation = typeof PRO_LIMITATIONS[number];
export const PRO_STOP_REASONS = ['manual', 'timeout', 'tab-closed', 'access-revoked', 'storage-error', 'limit'] as const;
export type ProStopReason = typeof PRO_STOP_REASONS[number];
export const PRO_RESOURCE_TYPES = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'] as const;

export interface ProResource {
  id: string;
  /** Sanitized display URL: no userinfo, query, fragment or identifying path segments. */
  url: string;
  domain: string;
  relation: 'same-site' | 'cross-site' | 'unknown';
  type: string;
  requestCount: number;
  completedCount: number;
  failedCount: number;
  redirectCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  statusCodes: number[];
  durationTotalMs: number;
}
export interface ProPage {
  id: string;
  tabId: number;
  documentKey: string;
  url: string;
  title: string;
  startedAt: number;
  endedAt: number | null;
  /** Separate per-document projections; counts are recording/visit deltas, never prior Light totals. */
  reports: ReportProjection[];
  resources: ProResource[];
}
export interface ProSession {
  schemaVersion: 1;
  id: string;
  domain: string;
  /** Browser-derived scope identity; not rendered in the exported report. */
  siteKey: string;
  startTabId: number;
  status: 'recording' | 'stopped';
  startedAt: number;
  deadlineAt: number;
  stoppedAt: number | null;
  stopReason: ProStopReason | null;
  pages: ProPage[];
  limitations: ProLimitation[];
  dropped: { pages: number; resources: number; documents: number; events: number };
}
export type ProRequest =
  | { schemaVersion: 1; type: 'ui-pro-get'; tabId?: number }
  | { schemaVersion: 1; type: 'ui-pro-start'; tabId: number }
  | { schemaVersion: 1; type: 'ui-pro-stop' | 'ui-pro-clear'; sessionId: string };
export interface ProStateResponse {
  schemaVersion: 1;
  type: 'pro-state';
  session: ProSession | null;
  currentDomain: string | null;
  canStart: boolean;
}

type Checked<T> = { ok: true; value: T } | { ok: false };
const get = Object.getOwnPropertyDescriptor;
function read(v: object, k: string): unknown { return get(v, k)?.value; }
function shape(v: unknown, fields: readonly string[]): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v) || Object.getOwnPropertyNames(v).length !== fields.length) return false;
  return fields.every(k => { const d = get(v, k); return d !== undefined && get(d, 'value') !== undefined; });
}
function integer(v: unknown, max = 2_147_483_647): v is number { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max; }
function epoch(v: unknown): v is number { return integer(v, 8_640_000_000_000_000); }
function text(v: unknown, max = 512): v is string { return typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v); }
function id(v: unknown, max = 128): v is string { return text(v, max) && /^[A-Za-z0-9_:.-]+$/.test(v); }
function list(v: unknown, max: number, check: (x: unknown) => boolean): v is unknown[] {
  if (!Array.isArray(v) || v.length > max) return false;
  for (let i = 0; i < v.length; i++) { const d = get(v, String(i)); if (!d || !get(d, 'value') || !check(d.value)) return false; }
  return true;
}
function member(v: unknown, values: readonly unknown[]): boolean { return values.includes(v); }
function codes(v: unknown, values: readonly unknown[], max = 64): boolean { return list(v, max, x => member(x, values)) && new Set(v).size === v.length; }
function countObject(v: unknown, fields: readonly string[]): boolean { return shape(v, fields) && fields.every(k => integer(read(v, k))); }
function displayUrl(v: unknown): boolean {
  if (!text(v, PRO_LIMITS.maxUrlChars) || /[?#@\s\\]/.test(v)) return false;
  try { const u = new URL(v); return ['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol) && !u.username && !u.password && u.hostname.length > 0; } catch { return false; }
}
/** Bound traversal before any serialization; accessors, sparse arrays and custom prototypes are refused. */
function boundedPlain(value: unknown): boolean {
  let chars = 0, nodes = 0;
  function walk(v: unknown, depth: number): boolean {
    if (++nodes > 200_000 || depth > 12) return false;
    if (typeof v === 'string') { chars += v.length; return chars <= PRO_LIMITS.maxBytes; }
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return true;
    if (typeof v !== 'object') return false;
    const proto = Object.getPrototypeOf(v), array = Array.isArray(v);
    if (proto !== (array ? Array.prototype : Object.prototype) && proto !== null) return false;
    if (Object.getOwnPropertySymbols(v).length > 0) return false;
    const fields = Object.getOwnPropertyNames(v);
    if (fields.length > 5_001 || (array && fields.length !== v.length + 1)) return false;
    for (const key of fields) {
      if (array && key === 'length') continue;
      if (key === '__proto__' || key === 'prototype' || key === 'constructor' || key === 'toJSON') return false;
      chars += key.length + 8;
      if (chars > PRO_LIMITS.maxBytes) return false;
      const d = get(v, key);
      if (!d || !get(d, 'value') || !walk(d.value, depth + 1)) return false;
    }
    return true;
  }
  return walk(value, 0);
}
function technique(v: unknown): boolean {
  if (!shape(v, ['techniqueId', 'count', 'countQuality', 'phases', 'signalCodes', 'evidenceSource', 'integrity', 'interpretation', 'interpretationConfidence', 'attributionConfidence', 'firstBucket', 'lastBucket'])) return false;
  return member(v['techniqueId'], TECHNIQUE_IDS) && integer(v['count']) && member(v['countQuality'], COUNT_QUALITIES) && codes(v['phases'], PHASES, 5) && codes(v['signalCodes'], SIGNAL_CODES, SIGNAL_CODES.length) && member(v['evidenceSource'], EVIDENCE_SOURCES) && member(v['integrity'], INTEGRITIES) && member(v['interpretation'], INTERPRETATIONS) && member(v['interpretationConfidence'], INTERPRETATION_CONFIDENCES) && member(v['attributionConfidence'], ATTRIBUTION_CONFIDENCES) && integer(v['firstBucket']) && integer(v['lastBucket']);
}
function finding(v: unknown): boolean {
  const fields = ['findingId', 'ruleId', 'ruleVersion', 'techniqueId', 'interpretation', 'interpretationConfidence', 'evidenceIds', 'counterEvidenceCodes', 'limitationCodes', 'vendorMatchIds'];
  if (typeof v === 'object' && v !== null && get(v, 'coverageRef')) fields.push('coverageRef');
  if (!shape(v, fields)) return false;
  return ['findingId', 'ruleId', 'ruleVersion'].every(k => text(v[k])) && member(v['techniqueId'], TECHNIQUE_IDS) && member(v['interpretation'], INTERPRETATIONS) && member(v['interpretationConfidence'], INTERPRETATION_CONFIDENCES) && ['evidenceIds', 'counterEvidenceCodes', 'limitationCodes', 'vendorMatchIds'].every(k => list(v[k], 64, x => text(x))) && (v['coverageRef'] === undefined || text(v['coverageRef']));
}
function vendor(v: unknown): boolean {
  return shape(v, ['vendorId', 'vendorConfidence', 'ruleIds', 'evidenceSource', 'integrity']) && text(v['vendorId']) && member(v['vendorConfidence'], VENDOR_MATCHES) && list(v['ruleIds'], 64, x => text(x)) && member(v['evidenceSource'], EVIDENCE_SOURCES) && member(v['integrity'], INTEGRITIES);
}
function report(v: unknown): boolean {
  const fields = ['reportRevision', 'documentKey', 'host', 'coverageState', 'coverageFlags', 'techniques', 'findings', 'vendors', 'dropped', 'observedSince', 'scopeMode'];
  if (typeof v === 'object' && v !== null && get(v, 'permissionChecks') !== undefined) fields.push('permissionChecks');
  if (typeof v === 'object' && v !== null && get(v, 'apiOperations') !== undefined) fields.push('apiOperations');
  if (typeof v === 'object' && v !== null && get(v, 'extensionResources') !== undefined) fields.push('extensionResources');
  if (typeof v === 'object' && v !== null && get(v, 'requestedLocalPorts') !== undefined) fields.push('requestedLocalPorts');
  if (typeof v === 'object' && v !== null && get(v, 'responseHeaders') !== undefined) fields.push('responseHeaders');
  if (!shape(v, fields) || Object.hasOwn(v, 'permissionChecks') && readPermissionChecks(v['permissionChecks']) === null ||
      Object.hasOwn(v, 'apiOperations') && readApiOperations(v['apiOperations']) === null) return false;
  if (Object.hasOwn(v, 'extensionResources') && readExtensionResources(v['extensionResources']) === null) return false;
  if (Object.hasOwn(v, 'responseHeaders')) {
    const headers = readResponseHeaders(v['responseHeaders']);
    if (!headers || !Array.isArray(v['techniques'])) return false;
    const total = headers.entries.reduce((sum, entry) => Math.min(MAX_COUNT, sum + entry.count), 0);
    const rows = v['techniques'].filter(value => value?.techniqueId === 'DET-074');
    if (rows.length !== (total > 0 ? 1 : 0) || rows.some(value => value.count !== total || value.evidenceSource !== 'browser-network' || value.integrity !== 'browser-observed' ||
      !Array.isArray(value.phases) || value.phases.length !== 0 || !Array.isArray(value.signalCodes) || value.signalCodes.length !== 0 ||
      value.attributionConfidence !== 'frame-only' || value.firstBucket !== 0 || value.lastBucket !== 0 ||
      value.interpretation !== 'unknown' || value.interpretationConfidence !== 'unassessed' ||
      value.countQuality !== (headers.truncated || total === MAX_COUNT ? 'lower-bound' : 'exact'))) return false;
    } else if (Array.isArray(v['techniques']) && v['techniques'].some(value => value?.techniqueId === 'DET-074')) return false;
  if (Object.hasOwn(v, 'requestedLocalPorts') && (readRequestedLocalPorts(v['requestedLocalPorts']) === null ||
      !Array.isArray(v['techniques']) || !v['techniques'].some(value => value?.techniqueId === 'DET-060' && value.count > 0 &&
        value.evidenceSource === 'browser-network' && value.integrity === 'browser-observed'))) return false;
  return integer(v['reportRevision']) && id(v['documentKey']) && (v['host'] === null || text(v['host'], 253)) && member(v['coverageState'], COVERAGE_STATES) && codes(v['coverageFlags'], COVERAGE_FLAGS) && list(v['techniques'], 128, technique) && list(v['findings'], 256, finding) && list(v['vendors'], 128, vendor) && countObject(v['dropped'], ['observations', 'batches', 'findings', 'hosts', 'counters', 'transport']) && (v['observedSince'] === null || epoch(v['observedSince'])) && member(v['scopeMode'], SCOPE_MODES);
}
function resource(v: unknown): boolean {
  if (!shape(v, ['id', 'url', 'domain', 'relation', 'type', 'requestCount', 'completedCount', 'failedCount', 'redirectCount', 'firstSeenAt', 'lastSeenAt', 'statusCodes', 'durationTotalMs'])) return false;
  const statuses = v['statusCodes'];
  return id(v['id']) && displayUrl(v['url']) && text(v['domain'], 253) && member(v['relation'], ['same-site', 'cross-site', 'unknown']) && member(v['type'], PRO_RESOURCE_TYPES) && ['requestCount', 'completedCount', 'failedCount', 'redirectCount'].every(k => integer(v[k])) && epoch(v['firstSeenAt']) && epoch(v['lastSeenAt']) && (v['lastSeenAt'] as number) >= (v['firstSeenAt'] as number) && list(statuses, 16, x => integer(x, 599) && x >= 100) && new Set(statuses).size === statuses.length && integer(v['durationTotalMs'], Number.MAX_SAFE_INTEGER);
}

export function validateProRequest(v: unknown): Checked<ProRequest> {
  try {
    if (typeof v !== 'object' || v === null || read(v, 'schemaVersion') !== 1) return { ok: false };
    const type = read(v, 'type');
    if (type === 'ui-pro-get') {
      const fields = get(v, 'tabId') ? ['schemaVersion', 'type', 'tabId'] : ['schemaVersion', 'type'];
      if (shape(v, fields) && (fields.length === 2 || integer(read(v, 'tabId')))) return { ok: true, value: v as ProRequest };
    } else if (type === 'ui-pro-start' && shape(v, ['schemaVersion', 'type', 'tabId']) && integer(read(v, 'tabId'))) return { ok: true, value: v as ProRequest };
    else if ((type === 'ui-pro-stop' || type === 'ui-pro-clear') && shape(v, ['schemaVersion', 'type', 'sessionId']) && id(read(v, 'sessionId'), 64)) return { ok: true, value: v as ProRequest };
    return { ok: false };
  } catch { return { ok: false }; }
}
export function validateProSession(v: unknown): Checked<ProSession> {
  try {
    if (!boundedPlain(v)) return { ok: false };
    if (!shape(v, ['schemaVersion', 'id', 'domain', 'siteKey', 'startTabId', 'status', 'startedAt', 'deadlineAt', 'stoppedAt', 'stopReason', 'pages', 'limitations', 'dropped']) || v['schemaVersion'] !== 1 || !id(v['id'], 64) || !text(v['domain'], 253) || !text(v['siteKey'], 253) || !integer(v['startTabId']) || !member(v['status'], ['recording', 'stopped']) || !epoch(v['startedAt']) || !epoch(v['deadlineAt']) || v['deadlineAt'] - v['startedAt'] !== PRO_LIMITS.durationMs || !codes(v['limitations'], PRO_LIMITATIONS) || !countObject(v['dropped'], ['pages', 'resources', 'documents', 'events'])) return { ok: false };
    if (v['status'] === 'recording' ? (v['stoppedAt'] !== null || v['stopReason'] !== null) : (!epoch(v['stoppedAt']) || v['stoppedAt'] < v['startedAt'] || v['stoppedAt'] > v['deadlineAt'] || !member(v['stopReason'], PRO_STOP_REASONS))) return { ok: false };
    let resources = 0, chars = 1024;
    const ids = new Set<string>();
    const ok = list(v['pages'], PRO_LIMITS.maxPages, p => {
      if (!shape(p, ['id', 'tabId', 'documentKey', 'url', 'title', 'startedAt', 'endedAt', 'reports', 'resources']) || !id(p['id']) || ids.has(p['id']) || !integer(p['tabId']) || !id(p['documentKey']) || !displayUrl(p['url']) || !text(p['title'], PRO_LIMITS.maxTitleChars) || !epoch(p['startedAt']) || p['startedAt'] < (v['startedAt'] as number) || p['startedAt'] > (v['deadlineAt'] as number) || (p['endedAt'] !== null && (!epoch(p['endedAt']) || p['endedAt'] < p['startedAt'] || p['endedAt'] > (v['deadlineAt'] as number)))) return false;
      ids.add(p['id']);
      if (!list(p['reports'], PRO_LIMITS.maxDocumentsPerPage, report) || !list(p['resources'], PRO_LIMITS.maxResourcesPerPage, resource)) return false;
      const reportKeys = (p['reports'] as ReportProjection[]).map(item => item.documentKey);
      const entries = p['resources'] as ProResource[];
      if (new Set(reportKeys).size !== reportKeys.length || new Set(entries.map(item => item.id)).size !== entries.length) return false;
      if (entries.some(item => item.firstSeenAt < (v['startedAt'] as number) || item.lastSeenAt > (v['deadlineAt'] as number))) return false;
      if (v['status'] === 'stopped' && p['endedAt'] === null) return false;
      resources += (p['resources'] as unknown[]).length;
      if (resources > PRO_LIMITS.maxResources) return false;
      // Serialize only this structurally bounded page; reject before accumulating a large session.
      chars += JSON.stringify(p).length;
      return chars <= PRO_LIMITS.maxBytes;
    });
    if (!ok || new TextEncoder().encode(JSON.stringify(v)).byteLength > PRO_LIMITS.maxBytes) return { ok: false };
    return { ok: true, value: v as unknown as ProSession };
  } catch { return { ok: false }; }
}
export function validateProStateResponse(v: unknown): Checked<ProStateResponse> {
  try {
    if (!shape(v, ['schemaVersion', 'type', 'session', 'currentDomain', 'canStart']) || v['schemaVersion'] !== 1 || v['type'] !== 'pro-state' || (v['currentDomain'] !== null && !text(v['currentDomain'], 253)) || typeof v['canStart'] !== 'boolean') return { ok: false };
    if (v['session'] !== null && !validateProSession(v['session']).ok) return { ok: false };
    return { ok: true, value: v as unknown as ProStateResponse };
  } catch { return { ok: false }; }
}
