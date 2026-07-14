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

The public repo intentionally excludes scraping scripts, raw CSV exports, API caches, logs, environment files, and Vercel local state.

## Files

- `karaoke_explorer.html` is the app entry point.
- `karaoke_explorer.css` contains the interface styles.
- `karaoke_explorer.js` contains all browser-side search, browse, filter, grouping, favorites, and setlist logic.
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
git diff --check
```

When changing `karaoke_explorer.js` or `karaoke_explorer.css`, bump `APP_VERSION` in `karaoke_explorer.js` and the matching query strings in `karaoke_explorer.html` so browsers and Vercel do not serve stale assets.
