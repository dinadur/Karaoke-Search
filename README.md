# Karaoke Search

A static karaoke songbook explorer for finding songs by title, artist, mood, genre, decade, holiday, popular/duet flags, and saved songs.

Live site: https://karaokesearch.uk

## Features

- Search across songs and artists at once (scopable to title-only or artist-only), with automatic fuzzy fallback when a query has no exact matches.
- Discover landing view with shelves (Crowd pleasers, Lucky dip, Singalong, Party, Duets, decades, seasonal holidays, and your saved songs) instead of an alphabetical dump.
- Browse mode for reading the full catalog alphabetically by song title or artist.
- Filters for mood, genre, decade, holiday, popular, duet, and saved songs — opened on demand in a focus-managed sheet behind a "Filters" toggle (bottom sheet on mobile, modal on desktop).
- Random song preview with Add / Spin again, drawing from the current filtered results.
- Clickable artist names and tags to jump into focused searches, from song cards, the setlist, and saved songs.
- Grouped results when sorting by song title or artist, with expand/collapse controls; long result sets load progressively as you scroll.
- Opt-in setlist planning with add, remove (with undo), swap (with undo), Draft, QR sharing, copy, share, clear (with undo), drag reorder, and up/down reorder controls.
- Saved songs stored locally in the browser (`karaokeSavedSongsV1`), with optional Want to try / Sung before status, comfort ratings, preferred keys, and personal notes kept on-device.
- Help me choose: five explained suggestions using familiarity, solo/duet, and energy preferences within the current results.
- Shareable URLs — query, scope, sort, and filters sync to the address bar.
- Dark mode (follows system preference on first visit) and saved UI state across refreshes.
- Links out to Spotify and YouTube Music searches for each song.
- Setlist singer assignments — tag who's singing what, included when copying/sharing.
- Installable PWA that works fully offline after the first visit.
- Search-match highlighting, gradient cover tiles per artist, and skeleton loading states.
- A light layer of stage effects: songs fly into the setlist, saves sparkle, random picks spin like a slot reel, Draft throws confetti, and switching theme sends a bloom of stage light from the button. All of it respects reduced motion and never blocks input. See [STAGE_EFFECTS.md](STAGE_EFFECTS.md).
- **Karaoke Night host mode** (via **More → Host karaoke night** or the Setlist **Host** button): singer roster chips, fair round-robin rotation that slots newcomers ahead of regulars' later rounds, catalog + custom YouTube requests, automatic embeddable YouTube karaoke finder (`/api/youtube-search`) with top-5 version switcher and manual YouTube URL fallback, and a dual-screen **TV Stage** pop-out window (`karaoke_stage.html`) synced live via `BroadcastChannel`.
- No external runtime dependencies: icons ship as an inline SVG sprite.

## Data

- `karaoke_songs_enriched.json` is the static catalog served by the app.
- `tag_consolidation.json` promotes recurring Last.fm/MusicBrainz tags into cleaner genre labels.
- `mood_consolidation.json` adds supplemental mood groupings on top of the catalog moods.
- `era_enrichment.json` adds provenance-backed missing era tags without changing the source catalog. Catalog-inferred tags are labeled; conflicting dates stay unresolved.
- `audio_enrichment.json` adds optional GetSongBPM reference recording BPM and key links without changing the source catalog.

The public repo intentionally excludes scraping scripts, raw CSV exports, API caches, logs, environment files, and Vercel local state.

The requested weekly venue updater is the maintained exception: GitHub Actions checks the [venue songbook](https://karaoke-search.onrender.com/) on Mondays at 09:17 UTC and publishes validated new songs. See [VENUE_SYNC.md](VENUE_SYNC.md) for matching, validation, reports, and manual runs.

## Files

- `karaoke_explorer.html` is the app entry point.
- `karaoke_explorer.css` contains the interface styles.
- `karaoke_explorer.js` contains the core app initialization, catalog loading, cards, and URL/history state.
- `search-ranking.js` contains text normalization, relevance scoring, fuzzy matching, and highlighting.
- `catalog-prep.js` and `catalog-worker.js` prepare, enrich, and index the catalog off the main thread.
- `filters-panel.js` contains the multi-select filter popovers, faceted counts, and active filter chips.
- `browse-discover.js` contains the Discover shelves, batched Song Browse, lazy Artist Browse, and result grouping.
- `setlist-panel.js` contains the setlist queue, singer editing, Draft/Swap, QR sharing, and snackbar logic.
- `karaoke-night.js`, `karaoke_stage.html`, and `api/youtube-search.js` power Karaoke Night host mode, the dual-screen TV stage window, and automatic YouTube karaoke lookup (set `YOUTUBE_API_KEY` in Vercel Environment Variables to enable automatic lookup; cached at the Vercel edge for 7 days, with YouTube search link and URL paste fallback when unset).
- `personal-songbook.js` contains the saved-songs notes/repertoire, guided picker, and era/audio overlay logic.
- `stage-effects.js` contains the decorative effects (`window.StageFx`).
- `vercel.json` rewrites `/` to `karaoke_explorer.html`.

There is no build step. The app is plain HTML/CSS/JavaScript served as static files, with one zero-dependency Vercel serverless route (`api/youtube-search.js`).

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

With a local server running and Playwright installed, run `node scripts/smoke.js` and `node scripts/regression.js`. The regression suite covers setlist Undo and editing, empty-result actions, legacy QR sharing, exact artist links and leaving them, facet counts, mobile layout/focus, load recovery, icon assets, and the fixes from [UX_REVIEW.md](UX_REVIEW.md). The browser suites accept `BROWSER=chromium`, `BROWSER=firefox`, or `BROWSER=webkit` (default: Chromium), and support `playwright-core` with `CHROMIUM_PATH` for a custom Chromium binary.

`node scripts/effects.js` checks that the stage effects play only when motion is allowed, clean up after themselves, and never intercept input.

With `axe-core` installed too, `node scripts/accessibility.js` checks representative light/dark screens and five viewport widths. CI runs the smoke, regression, accessibility, and offline suites in all three browser engines. Automated checks supplement manual keyboard and visual QA; they do not certify accessibility.

`node scripts/offline.js` runs its own private server to simulate an app upgrade, then checks cached loading and saved setlists, singers, and favorites with the server unreachable. Chromium and Firefox also use browser offline emulation; WebKit uses server disconnection because its protocol offline override rejects the navigation before the service worker can respond.

`node scripts/loading.js` checks typing and Browse during real-catalog preparation at 4× CPU slowdown, including the scheduling fallback. `node scripts/performance.js` reports three cold-context startup samples and their medians; run it separately from other browser tests. Optionally set `PERF_OUTPUT=qa/performance.json` to save local results. These are local responsiveness measurements, not phone or production-network benchmarks.

When changing JavaScript, CSS, or data, run `node scripts/bump-version.js` to update the app, HTML asset URLs, and service-worker cache together.

The PNG app icons are exported from `app-icon.svg` by `node scripts/generate-icons.js` using the same Playwright setup. These files are committed assets; there is no deployment build step.

Undo applies to the latest setlist operation and expires after another setlist edit, preventing an earlier snapshot from overwriting newer changes.

See [FEATURE_RELEASE.md](FEATURE_RELEASE.md) for feature behavior, data provenance, and enrichment maintenance. `node scripts/personal.js` checks the new flows in the selected browser; `node scripts/check-era-enrichment.js` validates sidecar evidence. Repertoire data stays in this browser and is excluded from shared setlists; clearing browser data removes it.

## Music metadata enrichment

See [METADATA_ENRICHMENT.md](METADATA_ENRICHMENT.md) for MusicBrainz progress, GetSongBPM registration, and resumable API import commands. API credentials stay in ignored `.env.local`; the public app never sends them. Importers preserve the original catalog and write source-attributed sidecar files.
