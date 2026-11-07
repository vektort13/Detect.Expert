# Third Party Surveillance — requests of the current visit

2026-10-09, production 1.1.0, ADR-029. Source: `apps/production-extension`.

2026-11-04 update (ADR-103, owner request): the long per-resource list was unreadable in the popup, so the panel now leads like the Active and Passive panels. It shows the request summary with coverage, then a technique-style table of request kinds (image, script, Fetch / XHR, ping, embedded document and so on) with their domains and request counts, each expandable to its domains. API activity in embedded documents follows, then a compact domain list with request kinds. The per-resource table, its filter and all fields below are unchanged but collapsed under «Сторонние запросы». Kinds and domains use the same admission rules as the badge, so their sums equal the request and domain totals.

The panel includes cross-site resource requests originating in the main document and accessible embedded documents. Rows show the resource's registrable domain, redacted path template, request type, observation count, source document when available, initiator origin when available, completion/error/redirect counts and recorded HTTP statuses. Query strings, private path identifiers, request/response bodies, cookie values and raw stacks are excluded.

The top-level document remains the inventory scope when opening embedded API activity. The red badge counts requests, separately from domains and resource groups. Same-site resources do not inflate it. Embedded API activity remains below the inventory. Local filtering and “show more” expose all retained live rows.

2026-10-10 UI update requested by the owner: popup and sidepanel omit the separate document picker, observation-coverage accordion and generic API-results truncation paragraph. Embedded document details remain accessible through this section. Clicking a section button returns to the current main document. Collection, report coverage metadata and the resource inventory are unchanged.

Chrome records native browser network events, including attempted requests later failing. Firefox reads resource timing from the authorized ISOLATED document bridge. Chrome also uses this bridge to recover an inventory lost after worker suspension. One source is selected per document; counts from the two sources are not added. Timing entries carry no inferred HTTP status or completion result. Unavailable outcomes display a dash. Neither an initiator origin nor a resource timing initiator type identifies the script which made the request.

The Pro report includes each retained cross-site resource group in a translated third-party section. Source-document and initiator fields stay unknown when the existing visit-level Pro aggregation does not record them. The report uses the already validated resource data and adds no storage/export wire fields.

Limits and actual acceptance results are recorded after native and independent validation in task result and release evidence.
