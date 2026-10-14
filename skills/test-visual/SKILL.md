---
name: test-visual
description: "Visual regression tests: screenshot baselines, determinism, thresholds, reviewed updates. Use when adding screenshot tests, or a pixel diff or visual regression flakes. Hands off to `test-flaky` or `test-guard`."
compatibility: "Verified with @playwright/test 1.64.0 driving Chromium 141 in this repository's examples; the practices apply to Storybook-based and hosted tools."
metadata:
  stage: author
---

# Visual regression tests

A screenshot test compares what the user would see with a reviewed baseline. Success is a
screenshot that fails on a misaligned, clipped, overlapping or recolored element a DOM assertion
cannot see, passes on every repeat of an unchanged build, and whose baseline changes only through
a reviewed image diff.

## Process

1. **Confirm a screenshot is the right oracle.** Use it for appearance that has no DOM-level
   statement: alignment, spacing, color, clipping, overlap, icons, charts, theme. Assert behavior
   and text in the DOM (`test-e2e`, `test-component`), and rules that must hold in every state as
   properties (see "What screenshots cannot replace").
2. **Pick the tool the repository can sustain.** A browser runner already present: its built-in
   assertion (Playwright `toHaveScreenshot`), baselines in the repository. Components in
   Storybook: a story-based tool (Chromatic, Lost Pixel, Loki), one story per state. No container
   to maintain and several browsers on every change: a hosted service (Percy, Chromatic, Argos).
   URL lists without a suite: BackstopJS. Adding a tool or service is a dependency and data
   decision; ask first. Read [references/tools.md](references/tools.md) to compare them and for
   hosted versus self-hosted trade-offs.
3. **Choose what to snapshot.** Components and their states in isolation first: default, hover
   and focus, disabled, error, loading, empty, longest realistic text, right-to-left. Prefer
   element screenshots to full pages: smaller diffs, one reason to change, fewer masks. Add one
   full-page shot per critical template (checkout, dashboard, document) for composition bugs.
   Each screenshot has a name that says which state it pins.
4. **Make rendering deterministic before recording anything.** Same OS, browser build and fonts
   for recording and comparing, in one pinned container; fixed viewport and
   `deviceScaleFactor: 1`; fonts loaded; animations disabled and caret hidden at capture; a fixed
   clock set before navigation; fixture data at the network boundary; random content seeded or
   masked; remote images routed to fixtures. Rendering differs across operating systems, so a
   laptop baseline compared in CI is noise by construction. Read
   [references/determinism.md](references/determinism.md) for each source with its symptom and
   fix, and [references/playwright.md](references/playwright.md) for the config, options and
   container image.
5. **Prove determinism.** Run the unchanged build against its baselines at least five times
   (the runner's repeat option). Every run passes, or the nondeterminism is found and removed with
   `test-flaky`. Never answer flakiness with a larger allowance.
6. **Set thresholds from the smallest bug you need to catch.**
   - Per-pixel `threshold` decides when one pixel counts as different (Playwright default 0.2 on
     a 0 to 1 color distance). Leave it unless antialiasing differs inside the pinned container.
   - The pixel allowance decides how many differing pixels pass. In a pinned container start at
     zero. If repeats show measured noise, allow an absolute `maxDiffPixels` just above it and
     well below the diff of a real bug: a 6px button shift on a 320px card differed by 625
     pixels here.
   - Avoid `maxDiffPixelRatio` on large shots: it scales with area. 0.01 of a 1280x720 page is
     9,216 pixels, enough to lose an icon or a line of text; 0.05 accepted the 6px shift here.
   - Zero tolerance across different environments flakes on every font or GPU change; a loose
     allowance anywhere hides real regressions. Fix the environment, not the number.
   - With both `maxDiffPixels` and `maxDiffPixelRatio` set, Playwright 1.64 applies the stricter.
7. **Record baselines once, on the reference environment.** Generate them in the container (or
   the hosted service), commit them in the same change as the code that produced them, and keep
   them next to the tests through the runner's path template. Drop the platform from the path
   when every run uses one container; keep it only with one reviewed baseline set per OS. New
   tests: `--update-snapshots=missing`; the default mode writes missing baselines and fails, so
   CI never passes on a test that compared nothing.
8. **Update only through reviewed diffs.** For each failure, open expected, actual and diff, and
   classify it: an intended change re-records only that screenshot (`--update-snapshots=changed`
   narrowed with `--grep` or a file), and the reviewer sees the image diff in the change; an
   unintended change is a bug in the product; noise is a determinism bug (step 4). Never run a
   blind `--update-snapshots=all` to turn a run green. `test-guard` flags changed baselines as
   `updated-snapshots` when they live under `__snapshots__/`, `__screenshots__/`, the runner's
   default `-snapshots/` folders, `.loki/reference/` or `bitmaps_reference/`; each one needs a
   stated reason. With a hosted service, approval happens in its UI: require a reviewer other than
   the author.
9. **Budget the matrix.** Cost is browsers x viewports x themes x locales x states, in baselines
   to store and diffs to review. Defaults: one engine on every change, the others on a schedule
   or only for components whose rendering differs by engine (form controls, fonts, scrollbars);
   two viewports, the narrowest supported and a common desktop; themes and locales at component
   level, with one long-text locale and one right-to-left locale for layout-sensitive
   components. Add a cell only for a bug class it catches; say which.
10. **Prove it bites.** Seed a visual bug in a scratch change (shift an element a few pixels, swap
    a color token, overlap two labels) and watch the screenshot fail with a diff that points at
    it. A screenshot that passes on the seeded bug is decoration.

## What screenshots cannot replace

A screenshot covers only the states and widths that were captured, and only says "different",
not "wrong". Assert these as rules instead:

- No horizontal overflow, no clipped or truncated text, no overlapping interactive elements at
  any width and in any reachable state: generated exploration checks them everywhere
  (`test-explore`).
- Contrast, focus visibility, names and roles: `test-accessibility`.
- Behavior, navigation and data: `test-e2e`, `test-component`.
- Layout performance and shifts while loading: `test-performance`.

## Measured in this repository

`examples/visual/verify.mjs` runs a Playwright Test project (1.64.0, Chromium 141, 800x400
viewport, scale 1) against `examples/visual/page.html`, recording baselines from the correct page
into a temporary directory first:

- A 6px horizontal shift of the card's button fails the card's element screenshot with 625
  differing pixels (ratio 0.02) at the default per-pixel threshold and no allowance.
- The same bug passes with `maxDiffPixelRatio: 0.05`.
- With a live seconds clock and a promotion picked at random left unmasked, the unchanged page
  failed 5 of 5 repeats in each of four runs (between 23 and 698 differing pixels per
  repeat across the runs observed).
- With an infinite CSS animation allowed to run, Playwright never got two consecutive matching
  screenshots, so no baseline could be recorded.
- With a fixed clock, the promotion masked and animations disabled, the page passed 5 of 5
  repeats, and so did the card.

Cross-OS and cross-browser rendering differences were not measured here.

## Anti-patterns

- `--update-snapshots=all` after a red run, or accepting every snapshot in a hosted UI without
  opening the diffs.
- Baselines recorded on a laptop and compared in CI, or after a browser upgrade without a
  dedicated, reviewed re-record.
- Raising `maxDiffPixelRatio` or `threshold` until a flaky screenshot passes.
- Full-page screenshots of everything: every change touches every baseline and reviews become
  rubber stamps.
- Masking whole panels, which hides the overlaps and clipping inside them.
- Screenshots used as the only assertion of text or behavior.
- A browser x viewport x theme x locale matrix applied to every screenshot by default.

## Done when

- Each screenshot names the state it pins and was shown to fail on a seeded visual bug.
- The unchanged build passed at least five repeats, recorded with the command and environment
  (container image or service, browser build).
- Allowances are stated per screenshot with the measured noise and the smallest bug they catch.
- Baselines live where the change review shows them, and every updated baseline has a reason.
- The matrix is listed with the bug class each axis covers.

Measure flaky screenshots with `test-flaky`; check updated baselines with `test-guard`.
