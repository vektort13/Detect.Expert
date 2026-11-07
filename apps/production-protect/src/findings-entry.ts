// ADR-052: shared production UI bundle; no inline script or second runtime.
import { mountFindingsPage } from './protect-ui.js';

void mountFindingsPage(document.getElementById('root'));
