// ADR-054: the activation acknowledgement uses the shared local UI runtime.
import { mountActivationToastPage } from './protect-ui.js';

void mountActivationToastPage(document.getElementById('root'));
