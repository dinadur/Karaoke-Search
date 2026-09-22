# Weekly venue songbook update

The `Weekly songbook update` GitHub Actions workflow checks
<https://karaoke-search.onrender.com/> every Monday at **09:17 UTC**. It also runs
when the updater itself changes on `main`, and supports **Run workflow** with a
dry-run option. No venue password, enrichment API key, or personal GitHub token
is required; the job uses the repository's built-in token with contents-write
permission to publish validated additions to `main`.

## What a run does

1. Fetch `/search?query=.&filter=` from the venue. Its current search endpoint
   supports regular expressions: `.` returns every nonempty listing, including
   non-Latin names. This was verified against a 41-query enumeration (38,024
   distinct listings on September 22, 2026). A normal run needs just one request.
   Retry transient failures up to three
   times, waiting 15, 30 and 60 seconds to allow the Render service to wake;
   stop immediately on a rate limit. The coverage check rejects a truncated result
   or an API behavior change that stops returning the full catalog.
2. Match venue rows against existing raw and lookup artist/title names, folding
   accents, karaoke/Wvocal aliases and the venue's `Christmas -` category prefix
   (already removed by earlier catalog repairs). Check new IDs against the app's identity
   rules. Existing records and their saved-song identities stay unchanged.
3. Append genuinely new rows as `pending`, without inventing genre, era, BPM,
   key, or popularity metadata. Existing enrichment processes can fill them later.
4. Refresh audio/era summary counts and bump all app/cache/icon versions together.
   Metadata evidence and lookup timestamps are preserved. Failed validation rolls
   back all changed data and version files.
5. Run catalog/version checks and Chromium smoke, regression, personal-songbook,
   audio, and offline checks before committing. Publish only the seven expected
   data/version files. A concurrent change to `main` stops the push; rerun against
   the new head instead of rebasing or force-pushing.

No new songs means no commit or cache-version change. Missing venue listings are
reported, never automatically removed. A fetch matching fewer than 95% of existing
rows, more than 500 proposed additions, malformed data, or a failed request stops
the update. Review unusually large legitimate changes before adjusting those limits.

Each run's summary and 30-day `venue-sync-report` artifact list additions, absent
rows and any identity collisions. HTTP failure before a complete comparison does
not produce a report. GitHub's normal Actions failure notifications apply.

The existing GitHub-to-Vercel integration publishes changes on `main`. GitHub does
not trigger other push workflows for commits made with `GITHUB_TOKEN`, so this job
runs its own validation before pushing. If Vercel creates a preview instead of a
production deployment, use the project's existing promotion procedure.

## Local maintenance

```bash
node scripts/test-sync-venue.js
node scripts/sync-venue.js          # live comparison, no catalog changes
node scripts/sync-venue.js --write  # append, refresh counts, bump and validate
```

Use a clean checkout. Reports and the exclusive run lock live under ignored
`metadata_cache/`. If a terminated local process leaves `venue-sync.lock`, confirm
no updater is still running before removing it. The scheduled job has its own
concurrency lock and starts with a fresh checkout each time. A push changing the
updater cancels an obsolete run; manual and scheduled runs otherwise queue.

The deterministic test uses actual catalog copies to verify dry runs, append-only
updates, sidecar validation, version bumps, idempotency, rollback and locking. It
also compares importer identities to the real frontend functions for every row.

The importer is an intentional exception to the repository's exclusion of local
scraping tools: it is required by the requested GitHub schedule. Raw exports,
credentials, enrichment caches and logs remain excluded. Importer and test files
are also excluded from the deployed static site.

GitHub can delay scheduled runs and disables schedules in public repositories
after 60 days without repository activity. Re-enable the workflow in Actions if
that happens during a long period with no additions or other commits. See
[GitHub's schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
