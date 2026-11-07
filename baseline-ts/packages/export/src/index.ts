import { reportHost } from '../../attribution/src/index';
// REQ-005/013, F027/F054/F108: explicit export allowlist, never serialize a stored/UI report directly.
import { MAX_COUNT, readResponseHeaders } from '@detect-expert/contracts';
import type { ExportPreview, ReportProjection } from '@detect-expert/contracts';

export function createExportPreview(report: ReportProjection, now: number, includeHost = false): ExportPreview {
  const first = report.techniques.reduce((min, t) => Math.min(min, t.firstBucket), MAX_COUNT);
  return {
    schemaVersion: 1, redacted: true, documentOrdinal: 1, reportRevision: report.reportRevision,
    report: {
      host: includeHost ? reportHost(report.host) : null,
      coverageState: report.coverageState, coverageFlags: [...report.coverageFlags],
      techniques: report.techniques.map((t) => ({
        techniqueId: t.techniqueId, count: t.count, countQuality: t.countQuality, phases: [...t.phases],
        signalCodes: [...t.signalCodes], evidenceSource: t.evidenceSource, integrity: t.integrity,
        interpretation: t.interpretation, interpretationConfidence: t.interpretationConfidence,
        attributionConfidence: t.attributionConfidence,
        firstBucket: Math.max(0, t.firstBucket - first), lastBucket: Math.max(0, t.lastBucket - first),
      })),
      findings: report.findings.map((f) => ({
        findingId: f.findingId, ruleId: f.ruleId, ruleVersion: f.ruleVersion, techniqueId: f.techniqueId,
        interpretation: f.interpretation, interpretationConfidence: f.interpretationConfidence,
        evidenceIds: [...f.evidenceIds], counterEvidenceCodes: [...f.counterEvidenceCodes],
        limitationCodes: [...f.limitationCodes], vendorMatchIds: [...f.vendorMatchIds],
        ...(f.coverageRef === undefined ? {} : { coverageRef: f.coverageRef }),
      })),
      vendors: report.vendors.map((v) => ({ vendorId: v.vendorId, vendorConfidence: v.vendorConfidence,
        ruleIds: [...v.ruleIds], evidenceSource: v.evidenceSource, integrity: v.integrity })),
      dropped: { observations: report.dropped.observations, batches: report.dropped.batches,
        findings: report.dropped.findings, hosts: report.dropped.hosts, counters: report.dropped.counters,
        transport: report.dropped.transport },
      observationAgeMinutes: report.observedSince === null ? null : Math.min(MAX_COUNT, Math.max(0, Math.floor((now - report.observedSince) / 60_000))),
      scopeMode: report.scopeMode,
      ...(report.permissionChecks === undefined ? {} : { permissionChecks: report.permissionChecks.map(row => ({
        permission: row.permission, kind: row.kind, result: row.result, count: row.count, countQuality: row.countQuality,
      })) }),
      ...(report.apiOperations === undefined ? {} : { apiOperations: report.apiOperations.map(row => ({
        apiOperation: row.apiOperation, phase: row.phase, count: row.count, countQuality: row.countQuality,
      })) }),
      ...(report.requestedLocalPorts === undefined ? {} : { requestedLocalPorts: {
        ports: [...report.requestedLocalPorts.ports], truncated: report.requestedLocalPorts.truncated,
      } }),
      ...(report.extensionResources === undefined ? {} : { extensionResources: report.extensionResources.map(row => ({
        target: row.target, method: row.method, phase: row.phase, count: row.count, countQuality: row.countQuality,
      })) }),
      ...(report.responseHeaders === undefined ? {} : { responseHeaders: readResponseHeaders(report.responseHeaders)! }),
    },
  };
}

export function serializeExportPreview(preview: ExportPreview): string {
  return JSON.stringify(preview, null, 2) + '\n';
}

/** F064: bounded support metadata; no report, host, tab, payload or clock is accepted. */
export function diagnosticPreview(extensionVersion: string, chromeMajor: number | null, swAvailable: boolean) {
  return {
    schemaVersion: 1 as const,
    extensionVersion: /^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(extensionVersion) ? extensionVersion : 'unknown',
    chromeMajor: chromeMajor !== null && Number.isInteger(chromeMajor) && chromeMajor > 0 && chromeMajor < 10000 ? chromeMajor : null,
    swAvailable,
  };
}
