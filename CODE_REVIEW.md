# Karaoke Search code review

Reviewed on 2026-09-07: `dinadur/Karaoke-Search`, branch `main`, commit `035aa471d4dc89a4975bd1e723e5656be2046fc4`.

Remediation on 2026-09-07: all six findings below have been addressed in the working tree, with regression coverage in `scripts/regression.js` and cache version `20260907-1`. The findings and line references below describe the original reviewed commit. Undo now expires after another setlist edit; empty searches keep an empty selection pool; QR sharing recomputes content-derived identity; facet counts use current query results; raster icons ship with deployment exceptions; mobile sheets isolate focus while retaining access to Undo and native dialogs.

The repository is loaded into `/home/ubuntu/codex-workspaces/karaoke-search`. This review did not modify application code, catalog data, or GitHub. Six actionable findings follow; all are P2 (normal priority). Address the setlist data-loss issue first.

## 1. Undoing a clear discards songs added after the clear

Location: `karaoke_explorer.js:637` (clear-setlist Undo callback). Related snapshot restoration occurs in the draft and import Undo callbacks.

Reproduction: add song A, clear the setlist, add song B, then press Undo within the six-second snackbar window. The setlist becomes `[A]`; B is silently discarded and the loss is persisted to localStorage. Adding B does not invalidate the earlier Undo action.

Restore the cleared entries while preserving subsequent additions, or invalidate the old Undo action when another edit makes snapshot restoration unsafe. Add a regression check for Clear → Add → Undo.

## 2. Empty results cause Random, Draft, and Swap to ignore the search

Locations: `karaoke_explorer.js:3456` (`getDraftPool`) and `karaoke_explorer.js:996` (`pickRandomSong`).

Both functions use a nonzero result count to decide whether a search is scoped. An empty scoped result therefore falls back to the full catalog. Search for `zzzzzzzzzzzzzzzzzz`: the page reports zero matches, but Draft adds ten unrelated songs and Random shows an unrelated result. Swap uses `getDraftPool` too, so it can replace an existing entry with a song outside the selected query and filters. An empty Favorites selection has the same problem.

Determine scope from the current mode, query, and filters, independently of the number of results. Preserve an empty scoped pool and show the existing no-matches message or disable the action.

## 3. QR sharing cannot resolve saved entries with legacy IDs

Location: `karaoke_explorer.js:3343` (`encodeSetlistPayload`). Related code: `loadSetlist` at line 3592 and the import ID map at line 3411.

Older versions stored row-based IDs; the formula is visible in the revision preceding commit `ee3697b`. The current loader retains those IDs. Sharing prefers any existing `song.id`, but the recipient only looks up current content-derived IDs. Consequently an old saved entry still displays and participates in duplicate detection locally, yet disappears during QR import. If every shared entry is old, no import dialog appears.

A fixture with an entry carrying the legacy ID encoded and decoded successfully but resolved zero of one songs. A two-song payload with current IDs imported successfully.

Resolve saved entries to current catalog identities before encoding, and consider migrating IDs on load. Test an actual old-format stored entry through share and import, including a mixed old/new setlist.

## 4. Filter counts can describe the full catalog or the previous query

Locations: `karaoke_explorer.js:3944` (`updateFacetedCounts`) and `karaoke_explorer.js:919` (render ordering).

Two reproducible paths make the counts incorrect:

- A query with zero matches falls back to `state.songs`. For `zzzzzzzzzzzzzzzzzz`, the decade popover advertised 5,459 songs from the 80s although none matched the query.
- `renderSearchFilters()` updates an open popover before `render()` recalculates `state.queryScopedSongs`. Search for `abba`, open Decade, press `/` to focus the search box without closing the popover, then enter `adele`. The counts retain ABBA's 61 matches from the 70s and 46 from the 80s; recomputing against the new query gives zero for both.

Compute query results before rendering facet counts, and treat an empty result array as a valid result. Test both zero-result searches and query edits while a popover stays open.

## 5. Referenced PWA icons are absent and excluded from deployment

Locations: `manifest.json:12`, `manifest.json:18`, `manifest.json:24`, and `karaoke_explorer.html:10`. Both `.gitignore` and `.vercelignore` contain `*.png`.

The manifest references `icon-192.png`, `icon-512.png`, and `icon-maskable-512.png`; the HTML references `apple-touch-icon.png`. None is tracked or present, and all four returned HTTP 404 locally. The SVG icon exists, but the declared raster, maskable, and Apple touch assets cannot load. The deployment ignore rule would also exclude PNG replacements if left unchanged.

Add the intended assets and explicit exceptions to the ignore rules, or revise references to supported assets that actually ship. Validate every declared manifest/HTML asset in CI. Actual platform installation behavior was not tested.

## 6. Keyboard focus escapes mobile modal sheets

Locations: `karaoke_explorer.js:1090` (`openFiltersSheet`) and `karaoke_explorer.js:1114` (`openSetlistDrawer`).

The sheets set `role="dialog"` and `aria-modal="true"` and move initial focus, but do not contain keyboard focus or make the background inert. At a 390×844 viewport, open Filters and press Shift+Tab once: focus moves to the background `filtersToggleButton` while the dialog remains open. Users can continue navigating obscured controls. The setlist drawer uses the same approach.

Use a native modal dialog or implement focus containment plus background inertness, preserving the existing focus restoration. Verify Tab, Shift+Tab, Escape, and focus restoration for both sheets.

## Validation and scope

Passed:

- JavaScript syntax checks for the application, service worker, and vendored QR library; version consistency (`20260715-9`); `git diff --check`.
- The repository's unmodified Playwright smoke test: Discover, search, highlighting, adding to setlist, decade filtering, Browse, and no uncaught page errors.
- Additional Chromium checks: favorites survive reload; setlist entries and singer assignments survive reload; URL decade selections use OR semantics; Back restores query and filters; grouped title results render and expand; current QR links import; mobile layout has no horizontal page overflow.
- Offline reload after service-worker activation loads all 36,734 catalog rows and does not open the data-error dialog.

Inspected the first-party application logic, HTML and responsive styles, service worker, caching/deployment configuration, version scripts, CI/smoke coverage, catalog field shapes, and dynamic HTML/URL construction. No confirmed injection vulnerability was found in the inspected rendering paths; this is not a security certification. The QR library was treated as vendored code, with a syntax check and functional generation/import checks rather than a complete algorithm audit.

The catalog contains 36,734 rows and 36,631 unique computed IDs. Sample duplicate identities represent title/artist variants; this alone is not classified as a bug. Some enrichment fields are absent, and the inspected paths generally provide defaults. Enrichment accuracy and the complete dataset were not manually audited.

Testing used local Chromium, desktop and mobile-sized viewports, and the documented Python static server. Production Vercel headers/rewrites, deployment upgrade races, real mobile devices, Safari/Firefox, and OS installation prompts were not verified. The stock Python server does not implement Vercel's `/` rewrite; local app checks used `/karaoke_explorer.html`.

The current CI smoke test does not exercise the six reported edge cases. Keep the existing smoke test and add targeted regressions as these issues are fixed. Test dependencies and exploratory scripts were installed under `/tmp/karaoke-review-tools`, outside the repository.
