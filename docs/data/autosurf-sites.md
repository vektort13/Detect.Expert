# Autosurfer site catalog: provenance and rebuilding

ADR-075. The extension imports a bundled, dated catalog. Searching, filtering and
selecting entries makes no network request. Only explicitly adding sites to the
visit plan changes the local draft; running the plan remains a separate action.

## Data and attribution

Contains modified Chrome User Experience Report (CrUX) data by Google, supplied
through the Internet Health Report country cache. CrUX datasets are licensed
under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
The Google source explicitly records that dataset license in its
[official methodology source](https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/docs/crux/methodology/index.md#license).

Snapshot: collection month **September 2026**, published **13 October 2026**.
The country cache is pinned to commit
`1db09887a9952d7f25abc480c6e1edc444a87673` of
[InternetHealthReport/crux-top-lists-country](https://github.com/InternetHealthReport/crux-top-lists-country/tree/1db09887a9952d7f25abc480c6e1edc444a87673/data/country).
The generator records the SHA-256 of every downloaded compressed country file.
The catalog modifies those inputs by retaining an authored exact-domain subset,
choosing one observed HTTPS origin per curated domain and adding project-authored
names and thematic categories. Google does not supply the thematic categories.

Country membership means that the **exact origin occurs in that country's CrUX
audience data**. It does not establish the operator's country or hosting location.
No ccTLD inference is used. A `www` alias cannot transfer country membership to a
different origin. Ranking values are coarse buckets, not exact positions; actual
2026 inputs contain intermediate buckets such as 5,000 and 50,000. The catalog is
not represented as an exhaustive top 50 for every country/category combination.

## Files

- `packages/catalog/data/autosurf-sites.seed.json`: project-authored exact-domain
  names/categories and the 57-country selection.
- `packages/catalog/data/autosurf-sites.country-inputs.json`: the filtered,
  redistributable upstream rows, pinned commit/month and original input hashes.
- `apps/production-extension/autosurf-sites-data.js`: generated data-only module.
- `apps/production-extension/autosurf-sites-LICENSE.txt`: shipped attribution,
  source/license URLs, snapshot details and the modifications made to the data.
- внутренний отчёт: actual counts, omitted seed
  domains, byte size and hashes from the latest generator execution.

The 20 categories are independent project curation. A site can have several
categories; no copied remote classification rules, content bodies, API secrets
or generated hostname guesses are shipped. An authored domain absent from the
pinned country inputs is omitted from the generated catalog and listed in the
build artifact. The release is historical evidence of inclusion, not a live
availability check.

## Rebuild

`node scripts/build-autosurf-sites.mjs` rebuilds from vendored filtered inputs
without network access. `node scripts/build-autosurf-sites.mjs --check` verifies
byte equality. Changing the curation requires refreshing the pinned source rows:
`node scripts/build-autosurf-sites.mjs --refresh`. This last command is an
explicit build-time network operation, never extension runtime functionality.

The downloader is limited to the fixed GitHub repository/commit, 57 country
paths, two concurrent responses, 120 seconds per response, 32 MiB compressed and
64 MiB uncompressed per country. Redirects, browser cookies, arbitrary URLs and
runtime code from the data source are not accepted. Generation is deterministic
from the seed and vendored inputs. The checked output contains only HTTPS root
origins that were present verbatim in the pinned source.

## Research decisions

The supplied research proposed multiple alternatives. This implementation uses
the licensed CrUX country cache and exact-domain project curation. Radar, Curlie,
search APIs, API keys and multitab scheduling are not part of this catalog.
Their example snippets and recommendations did not expand the task or the
extension's permission boundaries. The source example's date-based path was
corrected: actual files use the data month, e.g. `me/202609.csv.gz`.

## Tracking-system extension (ADR-078)

ADR-082 extends the local model with a bounded `trackingSystems` array. Selected
systems use OR, counting each site once; country, topic, text and technology
category still intersect. Single-system callers remain compatible. Active filter
chips and Clear all expose and reset the actual search state without changing
selected sites or the unsaved plan. No catalog records or wire fields change.

ADR-081 adds a separate tracking-category facet using the six categories already
stored on system records. Its parent navigation counts distinct sites under the
text/country/topic filters. Individual systems are scoped to that category;
incompatible individual/category combinations return no rows. Topic categories
remain independent. Switching scope retains site selections and the manual draft.

The later explicit owner request adds one shared
hostname/system relationship database. `autosurf-sites.tracking-inputs.json` is
an allowlisted, dated build input; the reproducible builder merges exact hostnames
without changing authored topics or copying country/rank data between aliases.
Unknown country/topic arrays stay empty. The current schema allows 50,000 origins,
500 systems, and 64 systems per site. The existing 200-URL plan limit is unchanged.

`trackingSourceId` references `sources`; `trackingSnapshotAt` dates these
associations independently from the September CrUX snapshot. Main Inspector uses
the same static database in a separate source/date panel; it does not turn the
catalogue into runtime detection evidence. See `docs/data/catalogue-inputs.md`.
