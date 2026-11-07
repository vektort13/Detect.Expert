# ADR-090 — Grouped management, shared master controls and Detector workspace

Date: 2026-10-31. Extends ADR-055, ADR-088 and ADR-089 under the owner's explicit UI request.

## Navigation and actual state

The primary Options navigation has three groups, each with its own local SVG icon and palette:

- Attack: Antidetect, Autosurfer, Cookies, Proxy.
- Defense: API Guard, Detector, Firewall.
- Tools: API, Settings, Contacts. API uses the local `#integrations` route and contains the Precursor settings entry; existing `#api` remains API Guard.

Browser Debug keeps its existing Settings entry and direct hash. The private Options routes add `#detector`; existing Firewall and API aliases and `tabId` remain. This changes no wire enum, message type or sender validation.

Only the six actual modules have a state dot. The owner explicitly excluded Cookies, Settings and Contacts. Green means the authoritative module state is active; red covers OFF, paused, connecting and unavailable, with an accurate localized accessible label/title. A draft or configured intent is not claimed as running. API/Antidetect use the saved master plus registration; Autosurfer uses actual running state; Proxy requires an enabled configuration and connected status; Detector uses the existing observation control; Firewall uses existing Protect state and browser capability.

The indicator controller sends only existing read requests. It never starts a run, connects a proxy, requests access, reads cookies or changes feature settings. Native Autosurfer/Proxy clients retain their validation and ownership checks. Their existing `load` operations include their existing service reconciliation; this is not redefined as a new side-effect-free backend API. Related storage notifications refresh only the affected family. Inactive views dispose their clients; late callbacks are fenced.

## Shared top controls

Antidetect, API Guard, Autosurfer, Proxy and Firewall have the same full-width top control layout. Each retains its existing semantics:

- Antidetect commits only the accepted `antidetectEnabled` field through the existing CAS when the top switch is pressed. Its other draft parameters still require Save; toggling preserves those edits without applying them. The switch displays the accepted master, stays unchanged while pending or on rejection, and is fenced while stale, hidden or busy. An enabled configuration without registered rules displays the existing localized inactive reason in the header. This corrects the draft-only master after the owner's subsequent indicator bug report.
- API Guard retains its immediate master-only CAS and preserves other draft edits.
- Autosurfer has one top Start/Stop switch and three explicit run icons: Play/Pause/Stop. Play resumes a paused job; otherwise explicit Start validates and, if dirty, saves the plan through its original CAS before starting exactly that revision under one UI lock. Save alone never starts a run. Unknown transport, permissions/capability and busy gates remain; empty/invalid plans receive a focused validation error. The original Pause/Resume/Stop backend actions and cleanup stay unchanged.
- Proxy uses existing Connect/Disconnect. A reconnect uses the accepted selected profile; none is chosen automatically.
- Firewall reuses its existing launcher switch and full consent flow above the existing Options settings. By the owner's subsequent explicit request, the header is the sole power control: Options host CSS hides the lower enable row and the duplicate disable/paired-purge-checkbox group. The separate confirmed purge action remains and retains its existing stop-and-purge behavior. No module source or consent text changes. Firefox unavailable controls stay disabled.

The common component owns presentation only. Protected sources, consent wording, DNR, stores and native mutation routes are not modified.

The Antidetect controller fences storage changes observed during CAS/native projection by the operation's candidate revision. Newer or indeterminate changes reject that response as stale; its own revision is expected. An exact late echo of the accepted revision and configuration does not lock the switch as an external change. The fence resets per operation and does not block an explicit configuration reset. Temporarily disabled address edits remain in their existing local cache when the master is committed.

Indicator reads use independent bounded family slots. API Guard and Antidetect share one canonical read; slow Autosurfer or Proxy requests cannot delay it. Each family coalesces changes into one confirmation read and retains physical ownership after a timeout until settlement. Hidden/disposed generations and late reads after a newer client broadcast cannot repaint an old status. Active, inactive, error and unknown retain their existing meanings; enabling an empty configuration does not claim running rules. Regression evidence: внутренний отчёт.

## Reusing the full Inspector

Detector reuses the current production popup Inspector and its own bundled renderer. Rebuilding from the older TypeScript demo would omit current analyzers. A guarded exported mount runs the existing renderer in an Options-owned host; the normal popup entry remains unchanged. It is not an iframe and does not weaken top-window checks. The compact existing observation operator remains available.

Source tabs are explicitly chosen or supplied through the bounded source query, checked through native `tabs.get` and restricted to HTTP(S). The resolver also applies to action rechecks. Without a source the operator is shown without starting report hooks. When inactive, the Inspector renderer is unmounted so its report/sub-analyzer polling stops; stored reports remain unchanged.

One fixed local UI-only `import('./popup.js')` in `detector-ui.js` is independently reviewed and excepted by the scanner before normal scanning. No variable specifier, remote, alternate, second or MAIN import is exempt. Negative tests retain the eval, Function, HTML and network restrictions. Both inherited Preact prefixes and all backend/runtime code are checked by byte hashes.

## Validation

Existing draft/CAS, consent/privacy, keyboard, navigation and native control checks remain. New tests cover exact group membership, absence of utility dots, actual-state mapping, read-only commands, affected-family refresh, stale callbacks, local import restrictions and full Inspector lifecycle. Native tests include real module controls, both menus/themes, native popup, restart persistence, Detector source/teardown, adaptive layout and native zoom. Evidence: внутренний отчёт.
