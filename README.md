# Karaoke Search

A static karaoke songbook explorer for finding songs by title, artist, mood, genre, decade, holiday, duet/explicit flags, and favorites.

Live site: https://karaokesearch.uk

## Features

- Fast scoped search by song title or artist, with fuzzy search available when needed.
- Browse mode for reading the full catalog alphabetically by song title or artist.
- Filters for mood, genre, decade, holiday, duet, explicit, and favorites.
- Clickable artist names and tags to jump into focused searches.
- Grouped results when sorting by song title or artist, with expand/collapse controls.
- Local setlist with add, remove, copy, clear, drag reorder, and up/down reorder controls.
- Local favorites saved in the browser.
- Dark mode and saved UI state across refreshes.
- Links out to Spotify and YouTube Music searches for each song.

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
