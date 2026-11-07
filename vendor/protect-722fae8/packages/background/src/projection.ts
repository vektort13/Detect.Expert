// Read-only projection of a stored DocumentReport for the UI (docs/PROJECT_RULES.md protocol v1, spec A5 §5).
// The single projection lives in @detect-expert/engine (technique summaries, findings, vendors and the redaction
// allowlist); this module only supplies the SW-side options. The stored model contains hosts, enum codes, catalog rule
// ids and saturating counters only (REQ-005). Export is built from exactly this projection (REQ-013).
// S10: `catalog` is the build's vendor catalog with the SW clock; the runtime passes it only when it has rules, so a
// build without active rules projects catalogVersion null and vendors [].
// S11 / ADR-019: disabledSensors come from the document's own SW record (meta.sensorsOff, sticky until a new
// document) with the CURRENT reasons (`sourcesOf`); an empty reason list means "enabled again, reload to observe".

import { projectReport as engineProjectReport } from '@detect-expert/engine';
import type { ProjectionCatalog } from '@detect-expert/engine';
import type { DisabledSensorSummary, DocumentReport, ReportProjection, ScopeMode, SensorDisableSource, SensorId } from '@detect-expert/contracts';
import type { DocumentMeta } from './documents';

export type SensorSources = (id: SensorId) => SensorDisableSource[];

/** ADR-019: the document's disabled families with their current reasons (registry order kept by the meta). */
export function disabledSensorsOf(meta: DocumentMeta, sourcesOf: SensorSources): DisabledSensorSummary[] {
  const off = meta.sensorsOff ?? [];
  const mayRemain = meta.sensorsHooksMayRemain ?? [];
  return off.map((sensorId) => ({ sensorId, disabledBy: sourcesOf(sensorId), hooksMayRemain: mayRemain.includes(sensorId) }));
}

export function projectReport(
  report: DocumentReport,
  meta: DocumentMeta,
  scopeMode: ScopeMode,
  catalog: ProjectionCatalog | null = null,
  sourcesOf: SensorSources = () => [],
): ReportProjection {
  return engineProjectReport(report, {
    scopeMode,
    catalog,
    observedSince: meta.revoked || meta.accessGranted === false || scopeMode === 'off' ? null : meta.firstObservationAt,
    disabledSensors: meta.revoked || meta.accessGranted === false ? [] : disabledSensorsOf(meta, sourcesOf),
  });
}
