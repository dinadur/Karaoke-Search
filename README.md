# Karaoke Search

A static karaoke songbook explorer for finding songs by title, artist, mood, genre, decade, holiday, duet/explicit flags, and source tags.

## What It Does

- Searches the catalog by focused scopes instead of mixing every field together.
- Browses the full catalog alphabetically by song title or artist.
- Groups large facet result sets by artist or song title using the sort menu.
- Builds a local setlist in the browser.

## Files

- `karaoke_explorer.html` is the app entry point.
- `karaoke_explorer.css` contains the interface styles.
- `karaoke_explorer.js` contains the browser-side search, browse, grouping, and setlist logic.
- `karaoke_songs_enriched.json` is the static catalog data used by the app.

The enrichment/scraping scripts, raw CSV exports, local API caches, and environment files are intentionally not part of this frontend repo.

## Local Use

```bash
python -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/karaoke_explorer.html`.
