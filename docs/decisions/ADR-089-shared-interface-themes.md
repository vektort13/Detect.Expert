# ADR-089 — Shared interface themes

Date: 2026-10-31. User-authorized appearance settings for Options, browser action popup and the existing side panel. Extends ADR-088; its earlier popup byte freeze applied to that completed redesign task.

The same local theme picker appears beside the language picker in both menus. Six preference IDs are accepted: `system`, `pearl`, `aurora`, `graphite`, `orchid`, `glass`. System follows the OS and resolves to Pearl or Graphite; explicit choices remain independent of OS changes. They are private UI values, not wire enums.

The sole persisted browser setting is the validated string `ui-theme-v1` in existing `storage.local`. Native `storage.onChanged` synchronizes simultaneous extension views. A same-origin `localStorage` mirror contains that same validated string solely for first paint. No visited site, feature configuration, report, identifier or credential is stored by the theme system. Neither storage.sync nor a background message/privileged endpoint is introduced.

An early external classic script applies the mirror before styles load and begins the native settings read. Initial paint is held for a bounded period on a cold read; a slow settings read can later restore the choice only if a newer user/storage revision has not superseded it. A failed write leaves the previous visible preference in place and reports an action error. Writes are serialized within a view. Read, write, removal, malformed value, cross-view and startup races are covered independently.

`themes.css`, loaded last, owns semantic surfaces, text, borders, gradients, shadows and interaction accents across both menus and their embedded workspaces. Semantic status colors remain distinct. Reduced-motion and forced-colors modes remain supported. Theme transition does not animate geometry. No new assets, remote fonts, dependencies, permissions, CSP or network access are required.

Brand geometry and original SVG paths are unchanged. The existing rendered UI mark stays `#2463c9` and its wordmark `#202936` across the six themes. A light brand region supplies contrast for dark palettes; the logo is not inverted, recolored, filtered or rescaled. The original `logo.svg` asset is also byte-frozen. These rendered UI colors are recorded separately from that asset's literal fill.

The controller, bootstrap, picker and 21-language theme labels are local modules. Existing locale bundles are not regenerated. Existing controllers, authorizations, consent wording, sensors, detector thresholds, fingerprint runtime and Protect module remain unchanged. Appearance selectors do not apply to web content.

Native verification covers bidirectional menu sync, persistence across actual browser restarts, native action popup, first-paint observations, all themes and logo invariants, keyboard control, responsive geometry and native browser zoom 100–250%. Exact evidence and limitations are recorded in внутренний отчёт and `docs/coverage/interface-themes.md`.
