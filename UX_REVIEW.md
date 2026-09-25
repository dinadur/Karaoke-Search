# UI/UX review — 25 September 2026

A fresh heuristic and automated review of search, Browse, filters, the setlist, and the personal tools at 320–1440px in light and dark themes. Version `20260925-1`. Findings are ordered by impact; each fix has a regression check that fails on the previous release (`20260907-9`) and passes now.

## Fixed

1. **Artist links trapped later searches.** Clicking an artist quietly switched search to *Artist* scope and A–Z title order, and both stuck. After viewing Adele, typing "love" listed 92 artists instead of 2,175 songs. Clearing the search showed all 36,734 songs A–Z instead of Discover, and the saved UI state reopened that view on the next visit. Typing, clearing, choosing a scope, or following a suggestion now leaves the artist view through one function (`leaveArtistView`), which restores the default scope and relevance order. Saved UI state is now versioned, so the stale state is repaired once while a title order chosen later is kept.
2. **Long setlists were unreachable on desktop.** The sticky rail had no height limit: with 14 songs it was 1,832px tall in a 900px window, so later entries stayed below the fold while results scrolled (and infinite scroll kept moving the page end). The rail now fits the viewport, the list scrolls inside it, and a newly added song scrolls into view.
3. **The mobile Browse letter strip never stuck.** Its sticky rule could not leave its short parent section, so the strip scrolled away (top −598px) and changing letter meant scrolling back through up to ~1,900 songs. The strip now sits directly in the page shell and docks under the search bar, and a new letter starts at its top. On desktop it takes its own row, so all 27 letters fit one line from 1280px instead of wrapping.
4. **Setlist rows lacked numbers and squeezed titles.** Grid list items render no `<ol>` markers, leaving an empty gutter, and five controls left titles about 110px ("Bohemian Rhapsody" wrapped). Rows are now numbered (the list keeps an explicit `role="list"` for VoiceOver); the title and artist use the full width, and the singer chip shares a row with the controls. The singer slot has a fixed size so the controls never move when the singer editor opens or closes (a moving target swallowed the next click).
5. **Filter sheet layout.** At 390px the Order control clipped "Artist" and wrapped "Song title"; at 320px scrolled content showed beneath the sticky "Show songs" button; dropdowns started at ragged positions; three chip styles coexisted; option lists covered the rows below; and the scope and Show-only chips showed **no keyboard focus** (their real inputs are invisible). The sheet now uses labeled rows with an aligned label column, one chip style with focus rings, inline option lists, "Sort by" wording, and a flush footer with **Clear filters** beside **Show songs**.
6. **A dead recovery action.** On a no-match search, "Enable fuzzy" added a "Fuzzy" chip and filter badge but still found nothing, because near matches had already run automatically. The action is now offered only when filters hid the exact matches and near matches would pass them. It reads "Include near matches (n)", and the chip reads "Near matches". The count comes from the suggestion scan that already runs over the filtered catalog, so it adds no extra pass over the whole catalog. Empty results say whether the query or the filters found nothing.
7. **Browse showed an ignored query.** A search stayed in the box while Browse listed the whole catalog. Browse now shows an empty box; switching back to Search restores the remembered query and results.
8. **Help me choose rendered no Save icon and an off-centre "+".** Suggestion icons were never hydrated, and the add button lacked centring.

Smaller changes: the header shows "36,734 songs" instead of "33,600 tagged / 36,734 songs"; counts read "Showing 160 of 163 matches" or "36 matches"; Discover and Browse have their own headings ("Songs A–Z · M · 1,922 songs"); the hint no longer says "Tap the star" on desktop; a plain query no longer repeats as a chip under the search box (scoped queries such as "Artist: Adele" still show one; the chip row clears only what it shows and returns to Discover once no search remains); the mobile setlist drawer labels Draft, Share, QR code, Copy, and Clear; swaps offer Undo like the other setlist edits; per-song Music links, Tags, and setlist buttons, including Swap, name their song for screen readers; at 320–374px the tabs take one row with Filters and More sharing the next instead of More wrapping alone; mobile planning cards keep Save, links, and Add on one row; the artist summary keeps Clear on its first line; the random pick card no longer stretches across wide screens.

## Opportunities not changed

- **Relevance tie-break.** An exact title match outranks an exact artist match, so "queen" lists Loren Gray's "Queen" above Queen's songs. Equal bonuses with popularity as the tie-break may suit karaoke better; build a small relevance test set first.
- **Artist order.** Artist views are A–Z grouped by letter. A popularity-first order ("the hits") could help for large artists. This is a product decision.
- **Density on phones.** Browse rows are about 125px and search cards 170–190px, showing three to six songs per screen. A compact row layout could roughly double that.
- **Icon reuse.** The dice icon stands for Draft, Reshuffle, Help me choose, and Random pick.
- **Physical devices.** As in earlier passes, iOS Safari, Android, VoiceOver/TalkBack, and native share/install flows still need real-device checks.

## Code review follow-up

A structured review of the pull request found gaps that are fixed above:
- Three other paths still left the artist view without restoring the defaults.
- The stored-state repair was unversioned.
- The chip-row clear no longer returned to Discover.
- The near-match count added a full-catalog fuzzy pass, about 375ms per render at 4× CPU slowdown; that render now takes about 93ms.
- The empty-state heading blamed the query when filters removed the matches.
- The Browse strip relied on `display: contents`, which older WebKit can drop from the accessibility tree.
- The swap button had a generic label.

The sticky offsets now share one `--sticky-toolbar-height` variable. The toolbar height is fixed by the search box's 46px minimum height and its 44px clear button.

## Verification

- `scripts/regression.js`: 19 scenarios, 8 new or updated for this pass. Each fails against the previous code on its defect, and all 19 pass now.
- Smoke, accessibility (axe, 320–1440px, light and dark), personal-songbook, first-visit, audio metadata, offline upgrade, and loading suites pass in Chromium. Firefox and WebKit run in CI.
- Syntax, data sidecar, importer, version-consistency, and whitespace checks pass.
- Before/after screenshots were captured and inspected at 320, 390, 768, 1024, 1280, and 1440px; they are local artifacts and are not committed.

This is a heuristic and automated browser review, not a study with users or an assistive-technology certification. Production was not modified.
