// Data-requests page entry (ADR-020 §I; S03 page, S14 content). Opened only from the module UI; the app lives in
// @detect-expert/ui (RequestsApp), this file only mounts it. No network: letters are prepared locally (CSP connect-src 'none').

import { render } from 'preact';
import { applyDocumentLanguage } from '@detect-expert/ui';
import { RequestsApp } from '../../../../packages/ui/src/components/protect/requests/RequestsApp';

applyDocumentLanguage(document);
const root = document.getElementById('root');
if (root !== null) render(<RequestsApp />, root);
