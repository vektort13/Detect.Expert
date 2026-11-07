// ADR-047 (S4b): entry of firewall.html, the firewall of the module «Защита» as its own action popup (the service
// worker sets it per tab while a prompt waits and opens it, surface.ts). Everything lives in protect-ui.js; this file
// stays a one-line loader so the page and the islands share one bundle (build-protect.mjs keeps the import external).
import { mountFirewallPage } from './protect-ui.js';

void mountFirewallPage(document.getElementById('root'));
