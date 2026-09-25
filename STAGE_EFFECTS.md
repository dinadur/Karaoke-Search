# Stage effects — 25 September 2026

A light layer of "stage night" delight on top of the songbook (version `20260925-6`). Each effect answers something the person did, or marks loading. None of them loops while you browse.

## What plays, and when

| Moment | Effect |
| --- | --- |
| Songbook loading | "Loading songbook" fills in like a karaoke lyric while a ball bounces over it (header on desktop, result count everywhere). |
| Songbook ready | Soft violet and coral stage lights rise behind the header, and a sheen crosses "tonight's" (violet-to-coral gradient text). |
| Discover | Shelves are dealt in one after another; Reshuffle rolls its dice. |
| New search | Matched text fills in left to right, card by card, like a sing-along lyric. |
| Mouse over a card | A soft spotlight follows the pointer (mouse only). |
| Save | The star pops and throws a few sparks, including inside the Saved songs and Help me choose dialogs. |
| Add | The song's cover tile arcs into the setlist rail (desktop) or the floating Setlist button (phones). The new row flashes, or the button bumps. Adds inside dialogs skip the flight. |
| Random pick, Spin again | The cover tile spins like a slot reel through other songs before landing; the dice rolls. |
| Draft | Confetti bursts from the button, and the drafted songs cascade into the list. |
| Theme switch | The new lighting spreads in a circle from where the switch was used (View Transitions, where supported). |

## Guardrails

- **Reduced motion** skips all movement. The static decoration (header glow, gradient title) stays, and the theme switches instantly.
- **Behavior is unchanged.** Effects run after the app has updated its state and DOM. The app calls them as `window.StageFx?.…`, and failures are caught and logged, so a missing or failing effect cannot change behavior.
- **Assistive technology.** Temporary elements are `aria-hidden`, ignore pointer events, and remove themselves, with a timer fallback. Nothing moves focus or writes to a live region. Inside a modal dialog, sparks render in the dialog's top layer.
- **Forced colors.** The gradient title and the loading lyric use system colors, and the glow is hidden.
- **Startup.** Nothing new animates while the catalog is prepared except the small loading lyric; the lights come up once `#resultsList` is no longer `aria-busy`. The list starts `aria-busy="true"` in the HTML. In an interleaved comparison at 4× CPU slowdown (7 rounds each), median readiness was 9,570ms against 9,555ms for the previous release, well within run-to-run variation (about ±300ms).
- **Known limitation.** While the theme transition runs (about 0.6s), browsers deliver clicks to the page rather than to its controls, so the reveal is kept short.

## Maintenance

- Code lives in `stage-effects.js` (`window.StageFx`), styles in the stage effects section at the end of `karaoke_explorer.css`, and hooks in `karaoke_explorer.js`. The script is in the service-worker precache.
- New effects should check `motionOK()`, clean up after themselves, and use `fx-` class names. `scripts/effects.js` fails if any `fx-` element or class is left behind.
- `node scripts/effects.js` checks, with the same server as the other suites:
  - effects play only when motion is allowed, then clean up;
  - reduced motion skips all of them;
  - clicks and typing are never intercepted;
  - sparks appear above dialogs, and phone adds fly into the Setlist button;
  - the title stays legible in forced colors (Chromium).
