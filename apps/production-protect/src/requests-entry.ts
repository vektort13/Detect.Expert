// ADR-047 (S1): entry of requests.html (data requests of the module «Защита», ADR-020 §I). Opened only from the
// module UI (vendored openRequestsPage). Everything lives in protect-ui.js; this file stays a one-line loader so the
// page and the islands share one bundle (build-protect.mjs keeps the import external). No network (CSP connect-src
// 'none'): letters are prepared locally.
import { mountRequestsPage } from './protect-ui.js';

void mountRequestsPage(document.getElementById('root'));
