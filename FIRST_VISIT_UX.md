# First-visit usability pass — 7 September 2026

The default experience now centers on finding and saving a song. Advanced tools remain available through More. This is a local preview change, version `20260907-9`.

## Audit and changes

1. **First visit — too many competing choices.** The original desktop screen exposed fuzzy search, Random, theme, Help me choose, My repertoire, every filter, and an empty setlist beside the catalog. The mobile screen also showed an empty Setlist launcher. The revised screen presents search, Search/Browse, Filters, and More. Filters open on demand at every width. Random, theme, the picker, saved songs, and setlist planning are in More. The clear-search button appears inside the input only when needed. Evidence: `qa/simple-before-desktop.png`, `qa/simple-before-mobile.png`, `qa/simple-after-desktop.png`, `qa/simple-after-mobile.png`.

2. **Choose a result — competing save actions and dense tags.** The star and book previously represented two different collections, beside an Add action that assumed the user was building a setlist. There is now one labeled Save action. A second click on Saved opens optional notes, status, comfort, and preferred key. Cards expose two metadata pills (three when no disclosure is necessary); Details expands and collapses the remainder without losing keyboard focus. Reference BPM/key data and source attribution remain available. Evidence: `qa/simple-search-mobile.png`.

3. **Return to saved songs — one collection.** More → Saved songs contains both previous favorites and repertoire entries. One click saves; entering practice information is optional. Removing an entry is explicit in its notes editor. The empty collection explains the star action. Evidence: `qa/simple-saved-mobile.png`.

4. **Plan a setlist — opt in when needed.** More → Plan a setlist reveals Add actions and the desktop rail or mobile drawer. Done planning hides the planning controls without clearing the queue. Existing queues remain accessible from More after reload. Adding a picker suggestion or accepting a shared setlist enables planning. Sharing, singers, reordering, duplicate prevention, QR, and Undo remain supported.

## Saved-data migration

`karaokeSavedSongsV1` atomically stores the combined collection and the legacy favorite IDs already imported. Existing notes, preferred keys, comfort, and sung/want-to-try status take precedence over plain favorites. Matching stable and legacy row IDs are deduplicated. Removed imported favorites do not reappear on reload. Unmatched legacy IDs remain in the original store for a future catalog match.

The original `karaokeFavorites` and `karaokeRepertoireV1` stores remain untouched as recovery copies. If the browser cannot persist the migration, the merged collection stays available in memory, an error is shown, and a subsequent successful save persists the complete collection. Private notes remain absent from shared setlists and URLs. Collections remain local to their browser/origin; this change does not add cloud synchronization.

## Verification

- Chromium, Firefox, and WebKit: first-visit/saved-data migration scenarios, 13 behavioral regression scenarios, 5 personal-songbook scenarios, full-catalog smoke, 3 audio metadata scenarios, and offline cache upgrade/search/personal-data checks passed.
- Accessibility checks passed across 1440, 1024, 768, 390, and 320px layouts, mobile filters/setlist, dark mode, QR, and personal dialogs. More is additionally audited as a component at desktop/mobile widths: its floating panel deliberately obscures some background song controls, so that audit is scoped to the disclosure; the closed page is tested separately.
- Keyboard checks cover filter focus containment/restoration, More dismissal and dialog return focus, song-detail disclosure focus, and setlist/QR nesting. Chromium's actual accessibility tree additionally verifies background isolation for dialogs.
- Catalog-loading tests passed with both native scheduling and the timer fallback. Syntax, version consistency, and whitespace checks passed.
- Fresh desktop/mobile screenshots were visually inspected. Before/after discovery captures use the same viewport and empty-query state; shelf contents naturally differ because discovery is randomized.

This is a heuristic and automated browser review, not a study with first-time users or a complete assistive-technology certification. Production was not modified during this pass.
