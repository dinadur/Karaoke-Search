# Release QA — 20260907-4

Final pre-publication sweep completed on 2026-09-07. No release-blocking defects were found. This release includes the review fixes, usability and startup improvements, and personal songbook features documented in CODE_REVIEW.md, QA_REPORT.md, and FEATURE_RELEASE.md.

## Verified before publication

- Chromium, Firefox, and WebKit: full-catalog smoke checks, all 13 regression scenarios, and all five personal-feature scenarios pass.
- All three engines: nine general accessibility checks plus five new-dialog checks pass; responsive layouts cover 320–1440px. Chromium also verifies the browser accessibility tree for modal background exclusion and reachable Undo.
- All three engines: service-worker upgrades preserve the setlist, singer, favorites, and repertoire; catalog search, icons, and the picker work after server disconnection. Chromium and Firefox additionally use browser offline emulation.
- Chromium: typing and switching to Browse during catalog preparation work with native scheduling and the timer fallback.
- JavaScript syntax, synchronized asset/cache versions, era provenance/counts, mocked MusicBrainz ambiguity and checkpoint recovery, and Git whitespace checks pass.
- The original 36,734-row catalog is unchanged. The optional sidecar supplies 40 inferred era tags with evidence.

The final sweep uses browser engines on Linux. Physical iOS/Android devices, screen readers, and native OS install/share sheets remain outside this verification. The earlier performance timings are recorded in FEATURE_RELEASE.md; performance tests were not run concurrently with this sweep.

## Publication verification

After pushing this candidate, verify GitHub CI, deployment status, production asset versions and bytes, live browser workflows, and the real service-worker transition from the previous production release. These checks must be confirmed against the deployed site before declaring publication complete.
