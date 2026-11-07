import { render } from 'preact';
import { applyDocumentLanguage, initializeLanguage } from '@detect-expert/ui';
import { ProReportApp } from '../../../../packages/ui/src/pro/ProReport';

void initializeLanguage().then(() => {
  applyDocumentLanguage(document);
  const root = document.getElementById('root');
  if (root !== null) render(<ProReportApp />, root);
});
