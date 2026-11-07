// Export preview helpers (REQ-013, E14-01): the file is byte-for-byte the serialization of the preview
// object the user saw. Pure; the Blob/anchor download lives in the component.

import type { ExportPreview } from '@detect-expert/contracts';

export const EXPORT_MIME = 'application/json';

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
