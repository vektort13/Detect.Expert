# ADR-088 — Adaptive internal management workspace

Date: 2026-10-31. Extends ADR-055; presentation changes only.

The internal menu is the existing `options.html` document. The external menu is the browser action popup. This change is limited to the internal menu; it introduces no permissions, remote resources, dependencies, storage keys, wire changes or detector behavior.

## Layout

The Options shell uses the full viewport, with a 224 CSS px primary navigation rail at widths of at least 1120 CSS px. Below that width navigation becomes an explicitly expanded, in-flow panel. Its button exposes `aria-expanded` and `aria-controls`; Escape closes it and returns focus. Primary tabs retain manual activation, roving focus and Home/End, and support vertical arrows as well as the existing horizontal arrows. A width transition preserves focus on a visible navigation control.

The content column is fluid and has no centered maximum width. Antidetect categories wrap above the editor. Utility pages use intrinsic form/card grids, wrapping toolbars and local scrolling for genuinely wide tables. Modal content can scroll within the viewport. Small layouts reflow actions and make the Antidetect save bar part of the document flow. Reduced motion and forced colors remain supported.

The site explorer uses a named inline-size container to align its two search controls. Site/country filters and the tracking-system heading share an explicit two-column template with10px gap; the icon/title occupy the first row, and system search occupies the next row's first logical column. The title's44px logical padding reserves the existing34px icon plus10px gap. Below450px of actual explorer content width, both grids become one column. This avoids auto-fit collapsing different empty tracks under a spanning heading. Both search controls retain matching42px base input height, padding and icon dimensions; the existing44px minimum for narrow/coarse-pointer contexts remains. Their DOM, handlers and localized names are unchanged. Evidence: внутренний отчёт.

`management-ui.css` styles only the Options shell. `management-workspaces.css` is loaded last by Options and scopes every rule to `.management-shell`. Antidetect/profile overrides are similarly scoped. The popup does not load these styles. Existing controllers, privileged channel validation, consent, API configuration, draft and revision logic are reused without modification. Repeated introductory paragraphs are removed from internal page headers; actual state, validation errors and permission actions are retained.

## Preservation and validation

ADR-055 routes, source-tab queries, legacy Firewall anchors, lazy retained panels, scroll memory and dialog cancellation remain. Navigating never enables a feature or applies a draft. Browser Debug remains under Settings. The Protect implementation and its consent text are unchanged.

The task captures a pre-change SHA-256 inventory of both delivered browsers, checks the bounded internal presentation diff, and compares the external popup and its dependencies byte for byte. Native checks distinguish browser page zoom (`tabs.setZoom/getZoom`, DPR and layout width) from emulated viewport dimensions. Mobile viewport checks establish responsive layout behavior; they do not establish support on a physical mobile browser.

Evidence and exact commands: внутренний отчёт and its linked machine-readable artifacts.
