# Agent Notes

This repo is a static frontend for a karaoke songbook. It is deployed from `main` to Vercel and served at https://karaokesearch.uk.

## Project Shape

- No framework, bundler, package manager, or build step.
- Main app files:
  - `karaoke_explorer.html`
  - `karaoke_explorer.css`
  - `karaoke_explorer.js`
- Data/config files:
  - `karaoke_songs_enriched.json`
  - `tag_consolidation.json`
  - `mood_consolidation.json`
- `vercel.json` rewrites `/` to `karaoke_explorer.html`.

Local-only scraping/enrichment material is intentionally ignored: `*.ps1`, `*.csv`, `metadata_cache/`, logs, env files, and `.vercel/`.

## Local Run

```bash
python -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/karaoke_explorer.html`.

## Verification

Run these before committing frontend changes:

```bash
node --check karaoke_explorer.js
git diff --check
```

If local server is running, also check that the current asset version serves:

```powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:8765/karaoke_explorer.html' -UseBasicParsing
```

## Versioning

`karaoke_explorer.js` defines `APP_VERSION`. The HTML also references `karaoke_explorer.css?v=...` and `karaoke_explorer.js?v=...`, and `sw.js` defines `CACHE_VERSION` for the offline cache.

When editing JS, CSS, or data files, update all four version references together:

- `APP_VERSION` in `karaoke_explorer.js`
- CSS query string in `karaoke_explorer.html`
- JS query string in `karaoke_explorer.html`
- `CACHE_VERSION` in `sw.js` (must equal `APP_VERSION`, or the service worker precache misses the URLs the page requests and offline mode breaks)

This is used as a cache buster for Vercel, browsers, and the service worker cache.

## Current App Behavior

- Search scopes are `all` (songs & artists, default), `song`, and `artist`.
- Mood, genre, decade, and holiday filters are all multi-select (OR within a category, AND across categories). State lives in `state.filters.{moods,genres,decades,holidays}` arrays, URL params are comma-separated, and the UI is a shared toggle-chip popover component (`MULTI_FILTER_DEFS` + `buildMultiFilters`) with per-option song counts, inline inside the mobile sheet. There is no Explicit filter (songs still show Explicit pills).
- Headings and song titles use self-hosted Space Grotesk (`fonts/`, OFL license alongside); body text is the system stack.
- The palette is violet/coral ("stage light"): `--brand` is the primary accent variable (renamed from `--teal`).
- Fuzzy search is off by default; if an exact query has zero matches, a fuzzy pass runs automatically and a notice labels the results.
- With no query, no filters, and relevance order, the app shows a "discover" landing view of sampled shelves (cached per session) instead of the full ranked list.
- Filters include mood, genre, decade, holiday, duet, explicit, and favorites. On mobile they live in a bottom sheet behind a "Filters (n)" toggle.
- Results can sort by relevance, song title, or artist; song/artist sorts group into expandable sections. Further batches load automatically via an IntersectionObserver sentinel.
- Random shows a preview card (Add / Spin again / dismiss) above results; it does not modify the setlist or the query.
- Browse mode reads the full catalog by song title or artist letter.
- Artist names and visible tag pills are clickable filters/searches; cards cap pills at 5 with a "+N" expander.
- Query, scope, sort, and filters sync to the URL via `history.replaceState`; URL params win over stored state on load.
- Favorites and setlist are stored in `localStorage`.
- UI state is stored in `localStorage` and restored on refresh.
- Setlist supports add, remove (undo via snackbar), copy, share (Web Share API when available), clear (undo), drag reorder, and up/down reorder.
- Song titles are cleaned for display only (`getDisplaySongTitle`): karaoke bracket noise, empty/dangling brackets, and unclosed trailing brackets are stripped. Identity keys still use raw values.
- Icons render from an inline SVG sprite in `karaoke_explorer.html` (no CDN). New icons must be added to the sprite as `<symbol id="icon-NAME">` and referenced via `<i data-lucide="NAME">` + `hydrateIcons()`.
- Assets are cached immutably via `vercel.json` headers; the HTML, `sw.js`, and `manifest.json` revalidate. Bumping the version references (see Versioning) is the cache-busting mechanism, including for the catalog JSON.
- The app is an installable PWA: `manifest.json` + `sw.js` precache the shell and catalog, so the app works offline after one visit.
- Song cards show deterministic gradient cover tiles (hue hashed from artist key) with artist initials; matched query text is highlighted via a per-character `normalize()` index map.
- Discover shelves hide scrollbars (edge fades + hover arrows + dice reshuffle button); skeleton shelves show while the catalog loads.
- Setlist entries support an optional `singer` field (inline edit, shown as a chip, included in copy/share text); entries are stored as copies of catalog songs.
- Deploys from `main` may need a manual "Promote to Production" in the Vercel dashboard: `main` is updated server-side by the git proxy and Vercel sometimes only builds it as a preview.

## Data Notes

- `karaoke_songs_enriched.json` is large, currently about 37k songs.
- Do not hand-edit the large catalog unless the user explicitly asks for data repair.
- `tag_consolidation.json` and `mood_consolidation.json` are small public tuning files and are safer to edit by hand.
- Song IDs should remain stable across catalog reorder/regeneration. Use content-derived identity, not row index, for saved favorites/setlist comparisons.
- `normalize()` intentionally folds accents to ASCII for search, e.g. `uber` should match accented variants.
- Artist display cleanup strips common karaoke-source noise such as `Wvocal` and `karaoke`.

## Deployment

The user usually pushes directly to `main`; Vercel deploys from GitHub. After pushing, verify production HTML references the new cache-busted version:

```powershell
Invoke-WebRequest -Uri 'https://karaokesearch.uk/' -UseBasicParsing
```

Do not add scraping scripts, API keys, raw CSVs, cache files, logs, or `.env` files to the public repo.
