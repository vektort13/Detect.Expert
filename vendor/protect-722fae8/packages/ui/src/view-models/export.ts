// Export preview helpers (REQ-013, E14-01): the file is byte-for-byte the serialization of the preview
// object the user saw. Pure; the Blob/anchor download lives in the component.

import type { ExportPreview, ReportProjection } from '@detect-expert/contracts';

export const EXPORT_MIME = 'application/json';

/** S13: whether «Экспорт» may open the preview, or the locale key of the visible reason why not. */
export type ExportAvailability = 'allowed' | 'export_unavailable' | 'export_unavailable_no_access' | 'export_unavailable_unsupported';

/**
 * S13 (E13-02): export needs a report of a document the extension can observe. The button stays focusable
 * (aria-disabled) and is described by this reason instead of being silently disabled.
 */
export function exportAvailability(report: ReportProjection | null): ExportAvailability {
  if (report === null) return 'export_unavailable';
  if (report.coverageState === 'no-access') return 'export_unavailable_no_access';
  if (report.coverageState === 'unsupported') return 'export_unavailable_unsupported';
  return 'allowed';
}

/** F054 / REQ-013: remove the host conservatively for every new preview, without changing the wire. */
export function withExportHost(preview: ExportPreview, includeHost = false): ExportPreview {
  return { ...preview, report: { ...preview.report, host: includeHost ? preview.report.host : null } };
}

export { serializeExportPreview } from '../../../export/src/index';
import { serializeExportPreview } from '../../../export/src/index';

export function exportFileName(preview: ExportPreview): string {
  return 'detect-expert-report-' + String(preview.documentOrdinal) + '-r' + String(preview.reportRevision) + '.json';
}

export interface ExportDownload {
  fileName: string;
  mime: typeof EXPORT_MIME;
  text: string;
}

export function buildExportDownload(preview: ExportPreview): ExportDownload {
  return { fileName: exportFileName(preview), mime: EXPORT_MIME, text: serializeExportPreview(preview) };
}

/** Field paths listed in the preview dialog: top level plus one level into `report`. */
export function exportFieldPaths(preview: ExportPreview): string[] {
  const paths: string[] = [];
  for (const key of Object.keys(preview)) {
    if (key === 'report') {
      for (const inner of Object.keys(preview.report)) paths.push('report.' + inner);
    } else {
      paths.push(key);
    }
  }
  return paths;
}
