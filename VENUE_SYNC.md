# Weekly venue songbook update

Since 2026-11-23 the weekly update runs as a scheduled task in the KaraokeSearch
Claude project (Mondays, 5 AM New York time). It runs the importer with
enrichment, checks and tests the result, and fast-forwards `main`:

```bash
node scripts/sync-venue.js --write --enrich --max-additions=2000
```

`--enrich` tags only the newly added rows, before they are appended: Last.fm
`track.getTopTags` first (needs `LASTFM_API_KEY`; skipped without it), then
MusicBrainz artist tags (search score 90 or higher, 1 request per 1.1 s) as the
fallback. Year tags become era labels. Rows with no match stay `pending`.
MusicBrainz tags describe the artist, not the song. Existing rows are never
passed to the enricher. The run's counts are in the `enrichment` field of
`metadata_cache/venue-sync-report.json`. A cloud session needs network access to
the venue, `musicbrainz.org` and `ws.audioscrobbler.com`.

`--max-additions` raises the default 500-row safety cap for a run you have
reviewed (the dry run lists the additions first).

The `Weekly songbook update` GitHub Actions workflow is now a manual fallback
(**Run workflow**, with a dry-run option). It no longer runs on a schedule or on
pushes. It caps a run at 500 additions and adds no tags. No venue password,
enrichment API key, or personal GitHub token is required; the job uses the
repository's built-in token with contents-write permission to publish validated
additions to `main`. The rest of this section describes that workflow.

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

Preparation exports the uploaded artifact's immutable ID and the tar archive's
SHA-256 digest as job outputs. Verification and publication download that exact
ID and check the archive against the preparation digest before extracting it.
They never trust a checksum packaged alongside the archive. Replacing an artifact
under the same name gives it a different ID; deletion or replacement stops the run
instead of publishing different bytes. Browser dependencies run only in the
read-only verification job, and only the final publication step receives the push
credential.

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

## What's new

The site's What's new shelf reads `whats_new.json`, which lists recent additions
by date. After a sync that adds songs, run `node scripts/build-whats-new.js`
(with `--worktree` before committing the sync, or without it afterwards) and ship
the file with the version bump. It reads only the catalog's Git history, so it
needs a full clone (`git fetch --unshallow` in a shallow one). Rows that
`--enrich` tagged before the commit still count, because the catalog grew by
that many rows. The manual GitHub workflow does not run it; until a sync
regenerates the file, What's new keeps showing the previous batch.

## Local maintenance

```bash
node scripts/test-sync-venue.js
node scripts/test-new-row-enrichment.js # offline enrichment fixture
node scripts/test-venue-workflow.js # local artifact replacement regression
node scripts/test-weekly-songbook.js # local artifacts and Git origin only
node scripts/test-weekly-songbook.js --browser # requires installed Playwright browser
node scripts/sync-venue.js          # live comparison, no catalog changes
node scripts/sync-venue.js --write  # append, refresh counts, bump and validate
node scripts/sync-venue.js --write --enrich  # same, and tag the new rows
```

Use a clean checkout. Reports and the exclusive run lock live under ignored
`metadata_cache/`. If a terminated local process leaves `venue-sync.lock`, confirm
no updater is still running before removing it. The scheduled job has its own
concurrency lock and starts with a fresh checkout each time. A push changing the
updater cancels an obsolete run; manual and scheduled runs otherwise queue.

The deterministic test uses actual catalog copies to verify dry runs, append-only
updates, sidecar validation, version bumps, idempotency, rollback and locking. It
also compares importer identities to the real frontend functions for every row.
Interrupted response bodies use the same four-attempt retry limit as connection
failures; a fully received corrupt JSON response fails immediately. Write-mode
fixtures check truncated results, corrupt catalog/sidecars, every validator's
rollback, concurrent edits, and isolated workflow outputs.

The weekly fixture test executes the workflow's real packaging, verification,
commit and publication shell steps against a temporary local bare Git origin.
It checks immutable artifact reuse, the separate prepare digest, corrupt archives, unexpected paths,
no-op commits and both concurrent-main races. It never requests the venue or
pushes to GitHub. `--browser` also loads the published pending song from a private
server, searches it and checks its saved identity after reloading. CI runs this
browser check in Chromium, Firefox and WebKit; all temporary catalogs are removed.

The importer is an intentional exception to the repository's exclusion of local
scraping tools: it is required by the requested GitHub schedule. Raw exports,
credentials, enrichment caches and logs remain excluded. Importer and test files
are also excluded from the deployed static site.

GitHub can delay scheduled runs and disables schedules in public repositories
after 60 days without repository activity. Re-enable the workflow in Actions if
that happens during a long period with no additions or other commits. See
[GitHub's schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
