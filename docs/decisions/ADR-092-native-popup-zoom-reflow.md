# ADR-092 — Native action-popup zoom and compact reflow

Date: 2026-10-31. Extends ADR-022 and ADR-091 under the owner's explicit requirement to verify both menus at100%,125%,150%,175%,200%,225% and250% browser zoom.

Native Chrome experiments distinguish the Options tab's per-origin zoom from the browser's default zoom. Changing the Options tab does not scale the toolbar popup. Setting default zoom through the browser's own Settings WebUI does scale a genuine `chrome.action.openPopup` document, including225%. These settings changes occur only in disposable test profiles; the extension gains no settings permission or browser-settings code.

At200–250%, Chrome's native popup size limit reduces the available CSS viewport while the original400px root remains wider. Native evidence confirmed horizontal overflow and an unreachable language control at250%. A popup-page tab or CSS scaling alone would not establish this finding.

The default definite400px root required by ADR-022 remains. A bounded300–411px viewport media rule changes the root to percentage width and releases its minimum only after a supported compact viewport is available. Percentage sizing uses the actual space excluding the native scrollbar. Initial provisional smaller viewports retain the definite bootstrap width. No overflow clipping, hidden controls, JavaScript resizing, CSS zoom, font scaling or SVG modification is used.

The candidate was tested in genuine popup documents at all seven native browser default zoom levels, plus Arabic/Urdu250% and repeated100%/250% openings. Raw content widths, control hit targets, trusted language/theme clicks, Escape/focus and post-ready frame stability are recorded separately. Final package verification must repeat native popup checks against the delivered bytes; a candidate or page-matrix PASS does not close the genuine-popup finding by itself.

Evidence and exact coverage: внутренний отчёт, `action-popup-zoom-candidate-report.md` and the task's final `RESULT.md`.
