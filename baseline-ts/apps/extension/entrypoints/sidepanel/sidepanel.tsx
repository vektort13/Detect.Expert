// Side panel entry (E13-01). Everything lives in @detect-expert/ui; this file only mounts the app.

import { render } from 'preact';
import { SidepanelApp, applyDocumentLanguage, initializeLanguage } from '@detect-expert/ui';

void initializeLanguage().then(() => {
  applyDocumentLanguage(document);
  const root = document.getElementById('root');
  if (root !== null) render(<SidepanelApp />, root);
});
