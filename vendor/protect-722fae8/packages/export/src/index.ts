import { reportHost } from '../../attribution/src/index';
// REQ-005/013, F027/F054/F108: explicit export allowlist, never serialize a stored/UI report directly.
import { MAX_COUNT, ORGANIZATION_POLICY_STATES, SENSOR_IDS, WIRE_CATALOG_VERSION_PATTERN } from '@detect-expert/contracts';
import type { EvidenceSource, ExportPreview, OrganizationPolicyState, ReportProjection, SensorId } from '@detect-expert/contracts';

/** ADR-019 (S11): unique registry ids in registry order; anything else is dropped. */
function sensorIds(values: readonly unknown[]): SensorId[] {
  const seen = new Set<unknown>(values);
  return SENSOR_IDS.filter((id) => seen.has(id));
}

/**
 * S07 / ADR-018: buckets of different evidence sources use different scales (page-hook: sensor buckets; browser-network:
 * seconds since the report was created), so each source is made relative to its own earliest bucket.
 */
function firstBucketBySource(report: ReportProjection): Map<EvidenceSource, number> {
  const first = new Map<EvidenceSource, number>();
  for (const t of report.techniques) first.set(t.evidenceSource, Math.min(first.get(t.evidenceSource) ?? MAX_COUNT, t.firstBucket));
  return first;
}

/**
 * Hosts (ReportProjection.hosts) are shown in the UI only and are never copied into the export (ADR-018). The vendor
 * summaries and the catalog version (S10) are copied field by field: rule ids, enum levels and the version only.
 */
export function createExportPreview(report: ReportProjection, now: number, includeHost = false): ExportPreview {
  const firstBySource = firstBucketBySource(report);
  return {
    schemaVersion: 1, redacted: true, documentOrdinal: 1, reportRevision: report.reportRevision,
    report: {
      host: includeHost ? reportHost(report.host) : null,
      coverageState: report.coverageState, coverageFlags: [...report.coverageFlags],
      techniques: report.techniques.map((t) => {
        const first = firstBySource.get(t.evidenceSource) ?? MAX_COUNT;
        return {
          techniqueId: t.techniqueId, count: t.count, countQuality: t.countQuality, phases: [...t.phases],
          signalCodes: [...t.signalCodes], evidenceSource: t.evidenceSource, integrity: t.integrity,
          interpretation: t.interpretation, interpretationConfidence: t.interpretationConfidence,
          attributionConfidence: t.attributionConfidence,
          firstBucket: Math.max(0, t.firstBucket - first), lastBucket: Math.max(0, t.lastBucket - first),
          // ADR-017: enum codes only, copied explicitly and only when present.
          ...(t.operationCodes === undefined || t.operationCodes.length === 0 ? {} : { operationCodes: [...t.operationCodes] }),
        };
      }),
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
        transport: report.dropped.transport,
        ...(report.dropped.ring === undefined ? {} : { ring: report.dropped.ring }) },
      observationAgeMinutes: report.observedSince === null ? null : Math.min(MAX_COUNT, Math.max(0, Math.floor((now - report.observedSince) / 60_000))),
      scopeMode: report.scopeMode,
      catalogVersion: typeof report.catalogVersion === 'string' && WIRE_CATALOG_VERSION_PATTERN.test(report.catalogVersion) ? report.catalogVersion : null,
      // ADR-019 (S11): ids only (no reasons, no organization state), and only when a family is disabled.
      ...disabledSensorField(report),
    },
  };
}

function disabledSensorField(report: ReportProjection): { disabledSensors?: SensorId[] } {
  const ids = sensorIds((report.disabledSensors ?? []).map((d) => d.sensorId));
  return ids.length === 0 ? {} : { disabledSensors: ids };
}

export function serializeExportPreview(preview: ExportPreview): string {
  return JSON.stringify(preview, null, 2) + '\n';
}

/** ADR-019 (S11): sensor settings in the diagnostics (ids, policy state and a count; no policy values). */
export interface DiagnosticSensors {
  off: readonly unknown[];
  organizationPolicy: unknown;
  rejectedPolicyEntries: unknown;
}

/** F064: bounded support metadata; no report, host, tab, payload or clock is accepted. */
export function diagnosticPreview(extensionVersion: string, chromeMajor: number | null, swAvailable: boolean, sensors?: DiagnosticSensors) {
  const base = {
    schemaVersion: 1 as const,
    extensionVersion: /^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(extensionVersion) ? extensionVersion : 'unknown',
    chromeMajor: chromeMajor !== null && Number.isInteger(chromeMajor) && chromeMajor > 0 && chromeMajor < 10000 ? chromeMajor : null,
    swAvailable,
  };
  if (sensors === undefined) return base;
  const policy = sensors.organizationPolicy;
  const rejected = sensors.rejectedPolicyEntries;
  return {
    ...base,
    disabledSensors: sensorIds(Array.isArray(sensors.off) ? sensors.off : []),
    organizationPolicy: (ORGANIZATION_POLICY_STATES as readonly unknown[]).includes(policy) ? (policy as OrganizationPolicyState) : 'absent',
    rejectedPolicyEntries: typeof rejected === 'number' && Number.isInteger(rejected) && rejected >= 0 ? Math.min(rejected, MAX_COUNT) : 0,
  };
}
