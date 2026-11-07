// File download inside an extension page: Blob URL + <a download> click (E14-01 acceptance 9: no
// chrome.downloads permission, no remote fetch). Called only after the user confirmed the preview.

import type { ExportDownload } from './view-models/export';

export function triggerDownload(download: ExportDownload, doc: Document = document): void {
  const blob = new Blob([download.text], { type: download.mime });
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = download.fileName;
  anchor.rel = 'noopener';
  anchor.hidden = true;
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
