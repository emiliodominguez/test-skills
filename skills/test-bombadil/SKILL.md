---
name: test-bombadil
description: "Property-based UI exploration with Bombadil: install, harness, runner, campaigns and CI for web or Electron apps. Use when setting up or running Bombadil or autonomous UI testing. Hands off to `test-bombadil-spec` for properties and `test-findings`."
compatibility: "Bombadil 0.7.x on macOS (Apple silicon) or Linux x86_64; Chromium or an Electron app with a DevTools port."
metadata:
  stage: explore
---

# Bombadil

Bombadil drives a web interface at random and, after every action, checks properties: statements
that must hold whatever the user did. It reports the first state where one fails, with a trace to
replay. The harness around it decides whether those reports are reproducible and worth reading.

## Phase 1: First run

1. Install as a dev dependency: `@antithesishq/bombadil` gives the CLI and the spec types.
   Native binaries exist for macOS on Apple silicon and Linux x86_64; elsewhere use the Docker
   image or a Linux CI runner.
2. Smoke-test with the built-in defaults against the running app:
   `bombadil browser test <origin> --headless --time-limit 2m --exit-on-violation --output-path out/bombadil/smoke`.
   The defaults check uncaught exceptions, unhandled rejections, console errors and HTTP 4xx/5xx
   responses, with clicks, inputs, scroll and navigation.
3. Open the trace with `bombadil browser inspect out/bombadil/smoke`. A violation on a healthy
   app usually means the app logs errors on purpose or calls a failing endpoint; fix that or
   narrow the default before writing anything else.
4. Exit codes: `0` clean or time limit reached, `2` a property was violated, `1` any other error.
   Scripts and CI must treat `1` as a broken run, not a pass.

## Phase 2: Decide the target

- **Managed browser** (`browser test <origin> [spec]`): Bombadil launches Chromium. Add
  `--headless`, and `--no-sandbox` only in containers that need it.
- **External browser or Electron** (`browser test-external <origin> [spec] --remote-debugger http://127.0.0.1:<port>`):
  you launch the app with `--remote-debugging-port=<port>`. Omit `--create-target` for Electron
  so Bombadil uses the existing window instead of opening a tab.
- Keep exploration on the app: by default it stays on the origin; widen or narrow it with
  `--allow-url <match pattern>`. Pass auth with `--cookie` or `--header`, or sign in through a
  gated action (see `test-bombadil-spec`).

## Phase 3: Build the harness

A raw run explores, but its findings often do not replay and some failures stay invisible. Before
relying on it, add a runner and a page kit. Read [references/runner.md](references/runner.md) for
the runner (bundling specs, spawning the binary, watchdog, recorded setup, policy) and
[references/harness.md](references/harness.md) for the page kit (stable test ids, settling,
measurements, injection sentinels, fenced side effects, seeded fault injection).

Minimum for trustworthy results:

- A fresh, seeded data store per run, with fake hardware and external services.
- Native dialogs, printing, external links and app quit fenced.
- Specs bundled into one file with the Bombadil package kept external.
- A stable id on every clickable element, so clicks replay.
- Settling after each action, so the recorded state is the finished one.
- The full setup written next to the trace, so replays repeat it.

## Phase 4: Run it on a cadence

- **While developing a property or action:** run the covering spec 3-5 minutes and keep going
  past violations, to see it is silent on a correct app and actually reached its screen.
- **Per change (optional):** a short smoke spec, 2-5 minutes, exit on violation.
- **Scheduled:** long campaigns across specs, locales, viewports, themes, fault profiles and data
  sets. Read [references/campaigns.md](references/campaigns.md) for matrix scheduling and CI.

Clean rounds can delete their output; screenshots grow fast.

## Version notes

Read [references/gotchas.md](references/gotchas.md) before debugging a run that hangs, diverges
on replay, crashes on a string, or ignores your clicks. They are 0.7.x behaviors with known
workarounds.

## Anti-patterns

- Trusting a finding that has not been replayed on a fresh app.
- Running against shared or production data, or with real dialogs and external links live.
- Treating exit code `1` (harness error) as success.
- Long unattended runs without a watchdog.
- Adding properties before the defaults run clean.

## Done when

- The defaults run clean on the app, headless, with the command recorded.
- Runs write a trace plus the setup needed to replay them, and a replay of a known run matches.
- The cadence (per change, scheduled) is wired or explicitly deferred.

Write properties and actions with `test-bombadil-spec`; triage what runs find with `test-findings`.
