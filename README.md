# Karaoke Search

A static karaoke songbook explorer for finding songs by title, artist, mood, genre, decade, holiday, duet/explicit flags, and favorites.

Live site: https://karaokesearch.uk

## Features

- Search across songs and artists at once (scopable to title-only or artist-only), with automatic fuzzy fallback when a query has no exact matches.
- Discover landing view with shelves (Lucky dip, Singalong, Party, Duets, decades, seasonal holidays, and your favorites) instead of an alphabetical dump.
- Browse mode for reading the full catalog alphabetically by song title or artist.
- Filters for mood, genre, decade, holiday, duet, explicit, and favorites — inline on desktop, a bottom sheet behind a "Filters (n)" toggle on mobile.
- Random song preview with Add / Spin again, drawing from the current filtered results.
- Clickable artist names and tags to jump into focused searches.
- Grouped results when sorting by song title or artist, with expand/collapse controls; long result sets load progressively as you scroll.
- Local setlist with add, remove (with undo), copy, share, clear (with undo), drag reorder, and up/down reorder controls.
- Local favorites saved in the browser.
- My repertoire: Want to try / Sung before, comfort ratings, preferred keys, and personal notes saved on the device.
- Help me choose: five explained suggestions using familiarity, solo/duet, and energy preferences within the current results.
- Shareable URLs — query, scope, sort, and filters sync to the address bar.
- Dark mode (follows system preference on first visit) and saved UI state across refreshes.
- Links out to Spotify and YouTube Music searches for each song.
- Setlist singer assignments — tag who's singing what, included when copying/sharing.
- Installable PWA that works fully offline after the first visit.
- Search-match highlighting, gradient cover tiles per artist, and skeleton loading states.
- No external runtime dependencies: icons ship as an inline SVG sprite.

## Data

- `karaoke_songs_enriched.json` is the static catalog served by the app.
- `tag_consolidation.json` promotes recurring Last.fm/MusicBrainz tags into cleaner genre labels.
- `mood_consolidation.json` adds supplemental mood groupings on top of the catalog moods.
- `era_enrichment.json` adds provenance-backed missing era tags without changing the source catalog. Catalog-inferred tags are labeled; conflicting dates stay unresolved.

The public repo intentionally excludes scraping scripts, raw CSV exports, API caches, logs, environment files, and Vercel local state.

## Files

- `karaoke_explorer.html` is the app entry point.
- `karaoke_explorer.css` contains the interface styles.
- `karaoke_explorer.js` contains all browser-side search, browse, filter, grouping, favorites, and setlist logic.
- `personal-songbook.js` contains the repertoire, guided picker, and era-overlay logic.
- `vercel.json` rewrites `/` to `karaoke_explorer.html`.

There is no build step. The app is plain HTML/CSS/JavaScript served as static files.

## Local Use

```bash
python -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/karaoke_explorer.html`.

## Verification

Useful quick checks before pushing:

```bash
node --check karaoke_explorer.js
node scripts/check-versions.js
git diff --check
```

With a local server running and Playwright installed, run `node scripts/smoke.js` and `node scripts/regression.js`. The regression suite covers setlist Undo and editing, empty-result actions, legacy QR sharing, exact artist links, facet counts, mobile layout/focus, load recovery, and icon assets. The browser suites accept `BROWSER=chromium`, `BROWSER=firefox`, or `BROWSER=webkit` (default: Chromium), and support `playwright-core` with `CHROMIUM_PATH` for a custom Chromium binary.

With `axe-core` installed too, `node scripts/accessibility.js` checks representative light/dark screens and five viewport widths. CI runs the smoke, regression, accessibility, and offline suites in all three browser engines. Automated checks supplement manual keyboard and visual QA; they do not certify accessibility.

`node scripts/offline.js` runs its own private server to simulate an app upgrade, then checks cached loading and saved setlists, singers, and favorites with the server unreachable. Chromium and Firefox also use browser offline emulation; WebKit uses server disconnection because its protocol offline override rejects the navigation before the service worker can respond.

`node scripts/loading.js` checks typing and Browse during real-catalog preparation at 4× CPU slowdown, including the scheduling fallback. `node scripts/performance.js` reports three cold-context startup samples and their medians; run it separately from other browser tests. Optionally set `PERF_OUTPUT=qa/performance.json` to save local results. These are local responsiveness measurements, not phone or production-network benchmarks.

When changing JavaScript, CSS, or data, run `node scripts/bump-version.js` to update the app, HTML asset URLs, and service-worker cache together.

The PNG app icons are exported from `app-icon.svg` by `node scripts/generate-icons.js` using the same Playwright setup. These files are committed assets; there is no deployment build step.

Undo applies to the latest setlist operation and expires after another setlist edit, preventing an earlier snapshot from overwriting newer changes.

See [FEATURE_RELEASE.md](FEATURE_RELEASE.md) for feature behavior, data provenance, and enrichment maintenance. `node scripts/personal.js` checks the new flows in the selected browser; `node scripts/check-era-enrichment.js` validates sidecar evidence. Repertoire data stays in this browser and is excluded from shared setlists; clearing browser data removes it.
