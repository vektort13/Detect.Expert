// ADR-047 (S1, port plan §2.1 B5): a persisted production observation report reaches the module's history lane
// (vendored fold.ts) only after cheap shape checks of exactly the fields the lane reads. The production report and
// binding come from the production runtime (trusted, browser-observed and derived data, REQ-004 does not apply), but
// they are a different code base: a field the vendored code expects and production does not have makes the report
// skipped (counted), never a thrown error inside the production persist path. No serialization, no deep copy.

import type { DocumentReport } from '@detect-expert/contracts';
import type { FrameBinding } from '../../../vendor/protect-722fae8/packages/background/src/documents';
import type { ProductionBindingOf } from './host-api';

const DOCUMENT_KEY_RE = /^(0|[1-9][0-9]{0,15}):(0|[1-9][0-9]{0,15}):([A-Za-z0-9_-]{1,64})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** tabId, frameId and documentId of a production document key `tabId:frameId:documentId`, or null. */
export function parseDocumentKey(key: unknown): { tabId: number; frameId: number; documentId: string } | null {
  if (typeof key !== 'string' || key.length > 160) return null;
  const m = DOCUMENT_KEY_RE.exec(key);
  if (m === null) return null;
  const tabId = Number(m[1]);
  const frameId = Number(m[2]);
  const documentId = m[3];
  if (!Number.isSafeInteger(tabId) || !Number.isSafeInteger(frameId) || documentId === undefined) return null;
  return { tabId, frameId, documentId };
}

/** The report when it has the fields the history fold reads (lifecycle, host, keys, counters, findings, hosts). */
export function asProtectReport(documentKey: string, report: unknown): Readonly<DocumentReport> | null {
  if (!isRecord(report)) return null;
  if (report['documentKey'] !== documentKey) return null;
  const lifecycle = report['lifecycle'];
  if (typeof lifecycle !== 'string') return null;
  const host = report['host'];
  if (host !== null && typeof host !== 'string') return null;
  if (!isCount(report['revision']) || !isCount(report['frameId'])) return null;
  const flags = report['coverageFlags'];
  if (!Array.isArray(flags)) return null;
  const counters = report['counters'];
  if (!Array.isArray(counters) || counters.length > 4096) return null;
  for (const c of counters) if (!isRecord(c) || typeof c['techniqueId'] !== 'string' || typeof c['count'] !== 'number') return null;
  const findings = report['findings'];
  if (!Array.isArray(findings) || findings.length > 4096) return null;
  for (const f of findings) if (!isRecord(f) || typeof f['techniqueId'] !== 'string' || typeof f['interpretation'] !== 'string') return null;
  const hosts = report['hosts'];
  if (!Array.isArray(hosts) || hosts.length > 4096) return null;
  for (const h of hosts) {
    if (!isRecord(h) || typeof h['requestCount'] !== 'number' || !Array.isArray(h['ruleIds'])) return null;
    const rd = h['registrableDomain'];
    if (rd !== undefined && typeof rd !== 'string') return null;
  }
  return report as unknown as Readonly<DocumentReport>;
}

/** A production binding with the fields the top-site lookup reads, or null. */
export function asFrameBinding(value: unknown): Readonly<FrameBinding> | null {
  if (!isRecord(value)) return null;
  if (!isCount(value['tabId']) || !isCount(value['frameId'])) return null;
  if (typeof value['documentId'] !== 'string' || typeof value['documentKey'] !== 'string') return null;
  const parent = value['parentDocumentId'];
  if (parent !== null && typeof parent !== 'string') return null;
  const lifecycle = value['documentLifecycle'];
  if (lifecycle !== null && lifecycle !== undefined && typeof lifecycle !== 'string') return null;
  const host = value['host'];
  if (host !== null && host !== undefined && typeof host !== 'string') return null;
  return value as unknown as Readonly<FrameBinding>;
}

/** Wraps the production lookup: every binding it returns is shape-checked; a throwing lookup counts as none. */
export function bindingLookup(bindingOf: ProductionBindingOf): (tabId: number, documentId: string) => Readonly<FrameBinding> | null {
  return (tabId, documentId) => {
    try {
      return asFrameBinding(bindingOf(tabId, documentId));
    } catch {
      return null;
    }
  };
}

/** Binding of the persisted document itself (through the lookup, matched by its key), or null. */
export function bindingOfDocument(documentKey: string, lookup: (tabId: number, documentId: string) => Readonly<FrameBinding> | null): Readonly<FrameBinding> | null {
  const ids = parseDocumentKey(documentKey);
  if (ids === null) return null;
  const binding = lookup(ids.tabId, ids.documentId);
  return binding !== null && binding.documentKey === documentKey ? binding : null;
}

/** meta.paused of the production DocumentMeta (anything but true counts as not paused). */
export function pausedOf(meta: unknown): boolean {
  return isRecord(meta) && meta['paused'] === true;
}
