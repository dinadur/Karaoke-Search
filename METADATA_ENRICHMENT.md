# Music metadata enrichment — 20260907-6

## MusicBrainz

The 2026-09-07 retry made nine recording searches, accepted one exact-name consensus match (Alex Warren — Ordinary, 2020s), and stopped after three consecutive service timeouts. The date sidecar now fills 41 missing rows: 40 catalog inferences plus one MusicBrainz match. Total era coverage is 15,318 of 36,734 rows. Existing era tags and the original catalog are unchanged.

Continue a bounded batch when the source responds:

```bash
node scripts/enrich-eras-musicbrainz.js 100
node scripts/check-era-enrichment.js
```

Progress survives under ignored `metadata_cache/era-musicbrainz-progress.json`; completed queries are skipped, failed requests remain retryable. Requests are spaced at least 1.2 seconds apart with backoff and an identifying User-Agent. An accepted name match supplies a decade, not independently verified karaoke audio metadata.

## GetSongBPM access

[Register at GetSongBPM](https://getsongbpm.com/api) using website `https://karaokesearch.uk/` and backlink page `https://karaokesearch.uk/`. The site footer links to GetSongBPM. The provider requires a valid email, email activation, and a public backlink before requesting access. Its signup page presented a Cloudflare human-verification challenge during setup, so registration and activation have not been completed by this workflow.

The API is free with attribution and currently permits 3,000 requests/hour. The importer uses at least 1.5 seconds between requests (at most 2,400/hour), including between successive runs, and a local lock prevents overlapping copies. This allowance is shared with any other clients using the same API key. It stops on 401/403/429, API errors, or three consecutive network failures. No website-page crawling is needed.

After activation, create a local `.env.local` containing `GETSONGBPM_API_KEY=your-key` using an editor. This file is excluded from Git and Vercel uploads. Do not paste the key into browser code or a committed file.

```bash
node --env-file=.env.local scripts/enrich-getsongbpm.js 100
node scripts/check-audio-enrichment.js
```

Use Node 20.6 or newer for `--env-file`. Each batch allows 1–1,000 requests, defaults to 100, and prioritizes popular songs. Re-run the command to resume. Failed/rate-limited queries are not marked complete. Successful results are saved after each response in `metadata_cache/getsongbpm-progress.json`; rerunning can reconstruct a missing output file. Preserve checkpoints. Remove a stale `metadata_cache/getsongbpm.lock` only after confirming no importer process is still running.

The API key is sent only in the `X-API-KEY` header to the fixed HTTPS API host. Redirects are rejected. Logs contain summary counts and generic failures, never the key or provider response bodies.

## Matching and output

Queries use both title and artist. Only exact normalized names are accepted; known comma-reversed artist aliases and karaoke source markers are normalized, while live/remix qualifiers are retained. One query can cover equivalent catalog rows. A full 100-result response is skipped because it may omit conflicts. Conflicting or missing values stay unknown; BPM is not doubled or halved to force agreement. Each accepted field must agree across the exact-name matches.

The output `audio_enrichment.json` records BPM, reference key, time signature, danceability, and acousticness when supplied and unambiguous, plus source IDs/URLs and the check date. Reference metadata describes a matching published recording; karaoke arrangements can differ. The importer does not overwrite the original catalog or a singer's preferred key.

No authenticated GetSongBPM batch has run yet, no BPM/key values have been added to the site, and the app does not yet load the audio sidecar. Once a real batch is available, validate it before integrating the display, filters, and offline cache and bump the app version for publication.

## Verification

`node scripts/test-getsongbpm.js` exercises exact matching, wrong artists and live versions, ambiguous values, empty/invalid responses, result limits, duplicate catalog rows, API-key transport, checkpoint recovery, quota failures, bounded retries, and missing credentials without external calls. `scripts/check-audio-enrichment.js` validates real output identities, ranges, provenance, and counts. CI runs the mocked tests; no live API calls or secrets are used there.

Sources: [GetSongBPM API](https://getsongbpm.com/api), [MusicBrainz rate limits](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).
