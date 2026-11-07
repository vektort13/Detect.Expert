# ADR-094 — Transparent vector identity

2026-10-31. The owner explicitly requested a vector identity without the light background that disrupts dark themes, with an optional subtle cyber animation. This replaces ADR-089's fixed light brand region and fixed dark wordmark. The recognizable original two SVG contours, viewBox, proportions and rendered UI blue `#2463c9` remain unchanged; the root `logo.svg` remains byte-identical.

Both menus and the embedded Detector use transparent brand containers. The text wordmark and subtitle use existing theme text tokens. Contacts uses the new local transparent `brand-symbol.svg` in place of the raster icon and removes only the Detect Expert tile's white surface. Other companies' brand plates remain unchanged.

A separate, noninteractive CSS layer draws quiet corner brackets and a single 3.2-second scan on appearance. Only its transform and opacity animate; the actual logo is not filtered, animated, distorted or recolored. Reduced motion suppresses the scan; forced colors removes the decoration. There is no perpetual animation, timer, script, network call, new permission or dependency. Header geometry and controls stay unchanged.

Verification covers native Chrome/Firefox, light/dark themes, both menu layouts, local vector loading, native zoom, reduced motion, forced colors and unrelated-control regressions. Historical reports retain their previous white-plate expectation; the current task checks the new appearance explicitly.
