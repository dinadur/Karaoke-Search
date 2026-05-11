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

`karaoke_explorer.js` defines `APP_VERSION`. The HTML also references `karaoke_explorer.css?v=...` and `karaoke_explorer.js?v=...`.

When editing JS or CSS, update all three version references together:

- `APP_VERSION` in `karaoke_explorer.js`
- CSS query string in `karaoke_explorer.html`
- JS query string in `karaoke_explorer.html`

This is used as a simple cache buster for Vercel and browsers.

## Current App Behavior

- Search scopes are `song` and `artist`.
- Fuzzy search is off by default and controlled by the search-box toggle.
- Filters include mood, genre, decade, holiday, duet, explicit, and favorites.
- Results can sort by relevance, song title, or artist.
- Sorting by song or artist groups results into expandable sections.
- Browse mode reads the full catalog by song title or artist letter.
- Artist names and visible tag pills are clickable filters/searches.
- Favorites and setlist are stored in `localStorage`.
- UI state is stored in `localStorage` and restored on refresh.
- Setlist supports add, remove, copy, clear, drag reorder, and up/down reorder.

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
