# Music metadata enrichment — 20260907-7

## GetSongBPM import results

The user-selected top 1,000 distinct song lookups have all completed: **558 matched, 429 unmatched, and 13 ambiguous**. Matches cover **573 catalog rows**, including equivalent catalog versions: **529 rows have BPM** and **568 have a reference key**. No guesses were assigned to unmatched or ambiguous results. The final scoped batch made 899 requests after 101 previously completed lookups and ended without service errors or rate limiting.

The original catalog is unchanged. `audio_enrichment.json` contains the public metadata and source evidence; private credentials and resumable checkpoints are excluded from Git and deployment. Version `20260907-7` adds the metadata display and offline cache.

## MusicBrainz

The 2026-09-07 retry made nine recording searches, accepted one exact-name consensus match (Alex Warren — Ordinary, 2020s), and stopped after three consecutive service timeouts. The date sidecar now fills 41 missing rows: 40 catalog inferences plus one MusicBrainz match. Total era coverage is 15,318 of 36,734 rows. Existing era tags and the original catalog are unchanged. A subsequent retry made seven requests, added no further matches, and stopped after repeated network failures; MusicBrainz coverage remains unchanged.

Continue a bounded batch when the source responds:

```bash
node scripts/enrich-eras-musicbrainz.js 100
node scripts/check-era-enrichment.js
```

Progress survives under ignored `metadata_cache/era-musicbrainz-progress.json`; completed queries are skipped, failed requests remain retryable. Requests are spaced at least 1.2 seconds apart with backoff and an identifying User-Agent. An accepted name match supplies a decade, not independently verified karaoke audio metadata.

## GetSongBPM access

[Register at GetSongBPM](https://getsongbpm.com/api) using website `https://karaokesearch.uk/` and backlink page `https://karaokesearch.uk/`. The site footer links to GetSongBPM. The provider requires a valid email, email activation, and a public backlink before requesting access. The user completed registration and supplied the key through a hidden terminal prompt. Authenticated requests now succeed; the key remains in ignored `.env.local`.

The API is free with attribution and currently permits 3,000 requests/hour. The importer uses at least 1.5 seconds between requests (at most 2,400/hour), including between successive runs, and a local lock prevents overlapping copies. This allowance is shared with any other clients using the same API key. It stops on 401/403/429, API errors, or three consecutive network failures. No website-page crawling is needed.

After activation, create a local `.env.local` containing `GETSONGBPM_API_KEY=your-key` using an editor. This file is excluded from Git and Vercel uploads. Do not paste the key into browser code or a committed file.

```bash
node --env-file=.env.local scripts/enrich-getsongbpm.js 1000 --top=1000
node scripts/check-audio-enrichment.js
```

Use Node 20.6 or newer for `--env-file`. Each batch allows 1–1,000 requests, defaults to 100, and prioritizes popular songs. `--top=1000` restricts work to the first 1,000 distinct catalog queries; completed queries are skipped on subsequent runs. Omit `--top` to allow the full catalog. Re-run the command to resume. Failed/rate-limited queries are not marked complete. Successful results are saved after each response in `metadata_cache/getsongbpm-progress.json`; rerunning can reconstruct a missing output file. Preserve checkpoints. Remove a stale `metadata_cache/getsongbpm.lock` only after confirming no importer process is still running.

The API key is sent only in the `X-API-KEY` header to the fixed HTTPS API host. Redirects are rejected. Logs contain summary counts and generic failures, never the key or provider response bodies.

## Matching and output

Queries use both title and artist. Only exact normalized names are accepted; known comma-reversed artist aliases and karaoke source markers are normalized, while live/remix qualifiers are retained. One query can cover equivalent catalog rows. A full 100-result response is skipped because it may omit conflicts. Conflicting or missing values stay unknown; BPM is not doubled or halved to force agreement. Each accepted field must agree across the exact-name matches.

The output `audio_enrichment.json` records BPM, reference key, time signature, danceability, and acousticness when supplied and unambiguous, plus source IDs/URLs and the check date. Reference metadata describes a matching published recording; karaoke arrangements can differ. The importer does not overwrite the original catalog or a singer's preferred key.

The first authenticated batch validated the API response format. The provider returns `{ "search": { "error": "no result" } }` for missing songs; the importer records this as unmatched rather than treating it as a service failure. Other invalid response shapes still remain retryable.

The app loads the optional audio sidecar and shows sourced BPM and reference-key links on cards and in Browse tag details. Missing, malformed, or unavailable audio data does not prevent normal songbook use. The sidecar is cached offline. Personal preferred keys remain separate and are never overwritten. Danceability/acousticness are retained in the data for future work; they do not change current recommendations.

## Verification

`node scripts/test-getsongbpm.js` exercises exact matching, wrong artists and live versions, ambiguous values, empty/invalid responses, result limits, duplicate catalog rows, API-key transport, checkpoint recovery, quota failures, bounded retries, and missing credentials without external calls. `scripts/check-audio-enrichment.js` validates real output identities, ranges, provenance, and counts. `scripts/audio.js` checks source links, reference-key display, narrow-screen accessibility, preferred-key preservation, and missing/invalid sidecar handling in Chromium, Firefox, and WebKit. Offline upgrade tests also compare audio metadata before and after the upgrade. CI runs the mocked tests; no live API calls or secrets are used there.

Sources: [GetSongBPM API](https://getsongbpm.com/api), [MusicBrainz rate limits](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).
