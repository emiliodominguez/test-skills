---
name: test-e2e
description: "Scripted end-to-end tours of critical user paths in a browser, desktop shell or mobile app. Use when writing or stabilizing E2E tests or removing sleeps. Hands off to `test-explore` for unscripted paths or `test-findings`."
metadata:
  stage: author
---

# End-to-end tours

A tour drives the built application through one path a person would take and asserts what the
person would see. It proves the paths you know; exploration covers the rest.

## Pick the driver

Use the one the repository has. Otherwise: Playwright for web (cross-browser, auto-waiting,
traces) and Electron (experimental), Cypress where the team already runs it, WebdriverIO or Selenium for
browser grids and legacy stacks; for mobile, Maestro for flow files, Detox for React Native,
Espresso and XCUITest for native suites, Appium across both. Read
[references/drivers.md](references/drivers.md) for the trade-offs and the waiting model of each.

## Process

1. **Pick the path.** One business outcome per tour: sign in, do the job, see the result. List
   the states to assert and the evidence to keep.
2. **Isolate the run.** Fresh storage per tour (a temporary database or a seeded copy), seeded
   demo data, a fixed locale, time zone and viewport. Fake hardware and external services at
   their protocol boundary and write their output to files the tour can read.
3. **Fence side effects.** Stub native dialogs, printing, opening external links, relaunch and
   quit, so a click cannot stall the run or leave the sandbox.
4. **Locate semantically.** Role and accessible name, label, then a test id. Never CSS
   structure or visible text that translation changes, unless the text is the assertion.
5. **Wait on observable readiness.** Wait for the element, state or request that signals the
   step is done. Every fixed sleep needs a comment naming the event it stands in for, and a plan
   to replace it.
6. **Assert outcomes and traffic.** Assert the visible result and, where it matters, the calls
   the UI made: wrap the request or IPC handler in a recorder and assert no double submit and no
   over-fetching.
7. **Keep evidence.** Screenshots at key states into a per-tour output folder for review. Capture
   console errors from the page and fail on unexpected ones.
8. **Cover the matrix that breaks layouts.** The narrowest and a common desktop width, light and
   dark themes, and print media where the app prints. Keyboard-only and screen reader checks of
   the same path belong to `test-accessibility`.
9. **Prove it bites.** Run the tour against the old behavior (a baseline switch that swaps the
   old handler without editing production code, or a temporary revert) and see it fail.

## Running

- Build once, then run tours sequentially when they share output folders or ports. A runner
  prints pass or fail with duration per tour and exits non-zero on any failure.
- Headless by default, with an environment switch for a visible window when debugging.
- With retries off, capture evidence on the first failure: in Playwright, `trace:
  'retain-on-failure'` and `screenshot: 'only-on-failure'`; in other drivers, a screenshot and
  the console log from an after-each hook.
- Component fixture pages (the real components served by the dev server in a bare page) are
  cheaper than a full tour for keyboard, focus and ARIA behavior of custom controls.

## Post-deploy smoke

A handful of tours run against the deployed environment right after each deploy:

- Read-only paths, or a dedicated synthetic account whose writes clean up after themselves; never
  write to real customer data.
- The base URL comes from an environment switch, so the same tours run locally, on staging and on
  production.
- Fail on any 5xx response and on console errors, not only on a missing element.
- A couple of minutes at most, and tied to an action: a failure triggers the rollback or pages
  the owner.

## Flakiness

Find the nondeterminism before touching the test: shared storage, clock or time zone, random
data, ordering, animations, network, unawaited work. Fix it at the source: seed it, fake it,
isolate it or wait on it. No blind retries. A quarantine names an owner and stays visible as
missing coverage.

## Anti-patterns

- Asserting that a heading exists instead of the result of the action.
- Tours sharing one database or depending on each other's order.
- Retries that hide a race, or sleeps without the event they stand in for.
- Pixel diffs on unstable fonts and data (use `test-visual`), or screenshots nobody looks at used
  as assertions.

## Done when

- The tour asserts the path's outcome and fails on the old behavior.
- It passes repeatedly from a clean state, headless, with the command recorded.
- Remaining sleeps and known gaps are listed with the event or fix they await.

Explore the unscripted paths with `test-explore`; triage a failing tour with `test-findings`.
