# ADR-091 — Shared menu typography

Date: 2026-10-31. Extends ADR-088, ADR-089 and ADR-090 under the owner's explicit request for consistent headings, labels, body text and hints in both menus and their localized workspaces.

`ui-typography.css` is the final stylesheet in Options, popup and sidepanel. It centralizes system-font sizes, line heights and weights in private CSS tokens. Page titles use24px/1.3/700; section titles18px/1.4/650; nested titles14px/1.4/650; control labels13px/1.45/600; body text14px/1.5/400; supporting text12px/1.5/400, with600 for counters. The root font size is unchanged so existing rem-based layouts keep their reference.

Explicit semantic tags and current component classes map to these roles. The owned `#root` anchor resolves older per-component selector conflicts without an all-element font reset or `!important`. Original brand wordmarks and SVGs keep their styles, paths and proportions. Existing monospace data families and bidi rules are preserved. The sheet changes no colors, theme preference, translated content, screen-reader-only behavior, hidden/inert state or control handlers.

Upper module switch state tokens ON/OFF stay on one line. The Options host overrides legacy fixed button width and label padding with intrinsic flex sizing and a non-shrinking label, using the same owned #root specificity as the shared typography. Screen-reader-only spans and decorative dots retain their own behavior. This fixes the API Guard label wrapping after the shared knob was introduced; no control handler or saved state changes. Evidence: внутренний отчёт.

Find sites and Tracking systems share the same section-title rule and matching existing icon-badge dimensions; Tracking systems has a local decorative radar SVG. Wrapping control labels and automatic heights allow longer translations to reflow. Editable values and native select/tooltip presentation retain their browser behavior; no CSS claim is made about operating-system popups.

The site-selection numeric badge is not a heading. It is excluded from the generic heading rule so its existing36px structural minimum and original16px/650 counter typography remain effective instead of the18px section title style. Its counter value is unchanged. The internal selection footer retains padding on all four sides instead of inheriting a top-only host override. Evidence: внутренний отчёт.

All10 Options sections, the current full Inspector, external popup and sidepanel inherit the same roles. Separate exported/print reports, privacy documents and generated standalone Protect windows are outside this menu-only stylesheet scope. Their protected source and content are unchanged.

Validation uses independent source/cascade review, existing control/privacy checks and native-browser localization, clipping, overlap and zoom tests. Viewport emulation is distinguished from physical-device testing, and native zoom from CSS scaling. Exact results, executed sources and limitations are recorded in внутренний отчёт.
