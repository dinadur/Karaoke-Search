# UI/UX review — 25 September 2026

A fresh heuristic and automated review of search, Browse, filters, the setlist, and the personal tools at 320–1440px in light and dark themes. Version `20260925-1`. Findings are ordered by impact; each fix has a regression check that fails on the previous release (`20260907-9`) and passes now.

## Fixed

1. **Artist links trapped later searches.** Clicking an artist quietly switched search to *Artist* scope and A–Z title order, and both stuck. After viewing Adele, typing "love" listed 92 artists instead of 2,175 songs. Clearing the search showed all 36,734 songs A–Z instead of Discover, and the saved UI state reopened that view on the next visit. Typing or clearing now leaves the artist view and restores the default scope and relevance order; the stale saved state is repaired on load.
2. **Long setlists were unreachable on desktop.** The sticky rail had no height limit: with 14 songs it was 1,832px tall in a 900px window, so later entries stayed below the fold while results scrolled (and infinite scroll kept moving the page end). The rail now fits the viewport, the list scrolls inside it, and a newly added song scrolls into view.
3. **The mobile Browse letter strip never stuck.** Its sticky rule could not leave its short parent section, so the strip scrolled away (top −598px) and changing letter meant scrolling back through up to ~1,900 songs. It now docks under the search bar, and a new letter starts at its top.
4. **Setlist rows lacked numbers and squeezed titles.** Grid list items render no `<ol>` markers, leaving an empty gutter, and five controls left titles about 110px ("Bohemian Rhapsody" wrapped). Rows are now numbered; the title and artist use the full width, and the singer chip shares a row with the controls. The singer slot has a fixed size so the controls never move when the singer editor opens or closes (a moving target swallowed the next click).
5. **Filter sheet layout.** At 390px the Order control clipped "Artist" and wrapped "Song title"; at 320px scrolled content showed beneath the sticky "Show songs" button; dropdowns started at ragged positions; three chip styles coexisted; option lists covered the rows below; and the scope and Show-only chips showed **no keyboard focus** (their real inputs are invisible). The sheet now uses labeled rows with an aligned label column, one chip style with focus rings, inline option lists, "Sort by" wording, and a flush footer with **Clear filters** beside **Show songs**.
6. **A dead recovery action.** On a no-match search, "Enable fuzzy" added a "Fuzzy" chip and filter badge but still found nothing, because near matches had already run automatically. The action is now offered only when filters hid the exact matches and near matches would pass them. It reads "Include near matches (n)", and the chip reads "Near matches". Empty results name the query.
7. **Browse showed an ignored query.** A search stayed in the box while Browse listed the whole catalog. Browse now shows an empty box; switching back to Search restores the remembered query and results.
8. **Help me choose rendered no Save icon and an off-centre "+".** Suggestion icons were never hydrated, and the add button lacked centring.

Smaller changes: the header shows "36,734 songs" instead of "33,600 tagged / 36,734 songs"; counts read "Showing 160 of 163 matches" or "36 matches"; Discover and Browse have their own headings ("Songs A–Z · M · 1,922 songs"); the hint no longer says "Tap the star" on desktop; a plain query no longer repeats as a chip under the search box (scoped queries such as "Artist: Adele" still show one, and the chip row clears only what it shows); the mobile setlist drawer labels Draft, Share, QR code, Copy, and Clear; swaps offer Undo like the other setlist edits; per-song Music links, Tags, and setlist buttons name their song for screen readers; at 320–374px the tabs take one row with Filters and More sharing the next instead of More wrapping alone; mobile planning cards keep Save, links, and Add on one row; the artist summary keeps Clear on its first line; the random pick card no longer stretches across wide screens.

## Opportunities not changed

- **Relevance tie-break.** An exact title match outranks an exact artist match, so "queen" lists Loren Gray's "Queen" above Queen's songs. Equal bonuses with popularity as the tie-break may suit karaoke better; build a small relevance test set first.
- **Artist order.** Artist views are A–Z grouped by letter. A popularity-first order ("the hits") could help for large artists. This is a product decision.
- **Density on phones.** Browse rows are about 125px and search cards 170–190px, showing three to six songs per screen. A compact row layout could roughly double that.
- **Desktop letter strip.** It wraps to a second row at common widths when the setlist rail is open.
- **Icon reuse.** The dice icon stands for Draft, Reshuffle, Help me choose, and Random pick.
- **Physical devices.** As in earlier passes, iOS Safari, Android, VoiceOver/TalkBack, and native share/install flows still need real-device checks.

## Verification

- `scripts/regression.js`: 18 scenarios, 7 new or updated for this pass. All 7 fail against the previous release, each on its defect, and all 18 pass now.
- Smoke, accessibility (axe, 320–1440px, light and dark), personal-songbook, first-visit, audio metadata, offline upgrade, and loading suites pass in Chromium. Firefox and WebKit run in CI.
- Syntax, data sidecar, importer, version-consistency, and whitespace checks pass.
- Before/after screenshots were captured and inspected at 320, 390, 768, 1024, 1280, and 1440px; they are local artifacts and are not committed.

This is a heuristic and automated browser review, not a study with users or an assistive-technology certification. Production was not modified.
