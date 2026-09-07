# Personal songbook release — 20260907-4

Release candidate `20260907-4`. See [RELEASE_QA.md](RELEASE_QA.md) for the final pre-publication sweep. Personal data remains in browser storage; this release adds no account system.

## My repertoire

Use the book button on a search result or Browse row to save a song. Each entry supports Want to try / Sung before, a 1–5 comfort rating, a preferred key or transposition note, and personal notes. My repertoire searches and filters saved songs, loads more entries in batches, and allows editing/removal.

Entries live in this browser's `karaokeRepertoireV1` storage. They persist across reloads and app upgrades and work offline. They are not synced between devices. Clearing browser data removes them. Repertoire notes and preferred keys are not included in shared setlist text or QR URLs. A storage failure keeps the editor open with the unsaved draft intact.

## Help me choose

The picker starts with the current search/filter results, or the selected Browse letter. It excludes songs already queued and offers up to five songs, favoring different artists and avoiding equivalent title/artist versions.

- Familiar means songs marked Sung before or favorited by this user.
- Adventurous excludes those songs. Want-to-try entries receive a small selection preference.
- Duet uses the catalog's Duet flag. Solo excludes that flag; it does not claim that every unflagged song has been independently verified as solo.
- Energetic uses Party, High energy, or Danceable mood tags. Relaxed uses Mellow, Relaxed, Chill, Calm, or Romantic, excluding conflicting energetic tags.
- Every result explains the actual metadata or personal preference behind the match. These are not vocal-difficulty predictions.

Preferences stay within the selected result pool. Empty matches offer recovery advice rather than unrelated songs. Find my five produces another selection without changing the queue; Add remains explicit.

## Era coverage and sources

The original large catalog was not edited. A 31 KB `era_enrichment.json` sidecar fills **40 missing era tags**, taking coverage from **15,277 to 15,317 of 36,734 rows**. Existing dates are preserved, and **15 conflicting missing-row candidates** were skipped. These additions show “inferred” on the decade pill, with the source described in its accessible name and tooltip.

Each addition records its source, checked date, matching method, confidence, and supporting catalog entries. Exact normalized artist/title matches must agree on one decade. Comma-reversed artist names are accepted only if the corresponding normal name is already present in the catalog. Karaoke source markers can be removed for matching; live/remix qualifiers are retained.

MusicBrainz was attempted in a bounded batch. Five requests produced no accepted additions; the batch stopped after three consecutive timeouts. **This release contains no new externally verified MusicBrainz dates.** Broad coverage remains unfinished because the source was unavailable/unresponsive during this run.

Maintenance commands:

```bash
node scripts/enrich-eras.js
node scripts/enrich-eras-musicbrainz.js 100
node scripts/check-era-enrichment.js
node scripts/bump-version.js
```

The first command reproduces the catalog-consensus sidecar and retains existing MusicBrainz additions. The second processes up to 100 unique missing-date searches, starting with popular songs. It spaces requests at least 1.2 seconds apart, supplies a descriptive User-Agent, and stops after three consecutive service errors. Successful searches and accepted matches are checkpointed under ignored `metadata_cache/era-musicbrainz-progress.json`, so later runs progress through the catalog and interrupted accepted matches can be recovered. Remove that local checkpoint only when intentionally rechecking previously searched songs.

MusicBrainz matches require exact normalized recording title and credited artist, score 100, complete search results, and dated matching recordings agreeing on one decade. Provenance includes recording IDs and source URLs. Ambiguous matches stay unknown. The app makes no live requests to MusicBrainz; its optional sidecar is versioned and cached for offline use. An unavailable sidecar does not prevent normal catalog loading.

References: [MusicBrainz rate limits](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting), [recording search fields](https://musicbrainz.org/doc/MusicBrainz_API/Search).

## Verification

- Five feature scenarios pass in Chromium, Firefox, and WebKit: persistence/editing/filtering/private sharing; storage failure; scoped recommendations; era overlay behavior; narrow dialogs/accessibility.
- The new-dialog scenario runs five axe checks per engine, covering picker, results, editor, and light/dark repertoire. Browser reflow is checked at 320px.
- All 13 previous regression scenarios pass in all three engines. The existing Chromium smoke/accessibility suites and native/fallback startup-input checks pass.
- Controlled offline upgrades preserve singer/setlist/favorites/repertoire and can run the picker in all three engines. WebKit uses a disconnected test server, while Chromium and Firefox also use browser offline emulation.
- Real-catalog startup at 4× CPU slowdown: median 2,742 ms ready and 151 ms longest task across three fresh contexts ([timings](qa/performance-personal.json)).
- Era evidence/counts, JavaScript syntax, asset versions, and whitespace checks pass. A mocked API test checks exact matching, rejection of ambiguous/undated/fuzzy results, and checkpoint recovery without network requests.
- CI includes the new browser suite and era evidence validation. Enrichment API calls are manual maintenance, not part of CI or page loading.

Inspected screenshots: [320px search](qa/personal-search-mobile.png), [editor](qa/personal-editor-mobile.png), [repertoire](qa/personal-library-mobile.png), [picker](qa/personal-picker-mobile.png), [suggestions](qa/personal-picks-mobile.png), [desktop library](qa/personal-library-desktop.png).

The previous physical-device limitations still apply: actual iOS Safari, VoiceOver/TalkBack, mobile keyboards, and OS install/share sheets require real-device validation.
