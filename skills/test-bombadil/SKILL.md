---
name: test-bombadil
description: "Property-based UI exploration with Bombadil: install, harness, runner, campaigns and CI for web or Electron apps. Use when setting up or running Bombadil or autonomous UI testing. Hands off to `test-bombadil-spec` for properties and `test-findings`."
compatibility: "Bombadil 0.7.x (verified on 0.7.8) on macOS arm64 or Linux x64/arm64; Node 20+; Chrome or Chromium, or an Electron app with a DevTools port."
metadata:
  stage: explore
---

# Bombadil

Bombadil drives a web interface at random and, after every action, checks properties: statements
that must hold whatever the user did. It reports the first state where one fails, with a trace to
replay. The harness around it decides whether those reports are reproducible and worth reading.

## Phase 1: First run

1. Install as a dev dependency: `@antithesishq/bombadil` ships the CLI binaries (macOS arm64,
   Linux x64 and arm64) and the spec types. Elsewhere, use the Docker image or a Linux runner.
2. Make a browser findable. Bombadil reads the `CHROME` variable, then looks for Chrome or
   Chromium on PATH and in standard locations. A browser downloaded by a test framework works:
   point `CHROME` at it.
3. Copy the bundled runner from this skill's `assets/` folder into the repository (for example
   `scripts/bombadil-run.mjs`) and smoke-test with the built-in defaults:

   ```sh
   node scripts/bombadil-run.mjs --start "npm run preview" --origin http://127.0.0.1:4173/ --time-limit 2m
   ```

   The runner finds the binary and a browser, starts the app and waits for it, runs headless
   under a watchdog, writes `run.json` and `summary.md` next to the trace, and works around
   browsers that reject Bombadil's default permission grants. The defaults check uncaught
   exceptions, unhandled rejections, console errors and HTTP 4xx/5xx responses.
4. Read `summary.md`, then open the trace with `bombadil browser inspect <output>`. A violation
   on a healthy app usually means the app logs errors on purpose or calls a failing endpoint;
   fix that or narrow the defaults before writing anything else.
5. Exit codes: `0` clean or time limit reached, `2` a property was violated, `1` any other error.
   Scripts and CI must treat `1` as a broken run, not a pass.

Without the runner: `bombadil browser test <origin> [spec] --headless --time-limit 2m --output-path out/bombadil/smoke`.

## Phase 2: Decide the target

- **Managed browser** (`browser test <origin> [spec]`): Bombadil launches Chromium. Add
  `--headless`, and `--no-sandbox` only in containers that need it.
- **External browser or Electron** (`browser test-external <origin> [spec] --remote-debugger http://127.0.0.1:<port>`):
  you launch the app with `--remote-debugging-port=<port>`. Omit `--create-target` for Electron
  so Bombadil uses the existing window instead of opening a tab.
- Exploration stays on the origin. (Newer releases add `--allow-url` match patterns; 0.7.8 does
  not have it.) Pass auth with `--cookie` or `--header`, or sign in through a gated action (see
  `test-bombadil-spec`).

## Phase 3: Build the harness

A raw run explores, but its findings often do not replay and some failures stay invisible.

1. **Load the page kit** from `assets/page-kit.js` before the app's own scripts, in test builds
   only: a script tag injected by the dev or preview server, an init script, or a preload in a
   desktop shell. It synthesizes stable test ids (replay matches clicks by test id, id, role with
   name or ARIA label, never by text), records injection sentinels (Bombadil answers `alert`
   itself, so XSS would pass unseen) and measures requests and slow interactions.
2. **Isolate the run:** a fresh, seeded data store per run, fake hardware and external services,
   native dialogs, printing, external links and app quit fenced.
3. **Keep the setup with the trace.** The runner writes `run.json`; replay with
   `node scripts/bombadil-run.mjs --reproduce <output>`, which starts the app the same way and
   writes the replay to `<output>/replay`.

Read [references/harness.md](references/harness.md) for the page kit internals, settling and
seeded fault injection, and [references/runner.md](references/runner.md) for what a runner owns
(bundling, watchdog, policy, latency baselines) when a project outgrows the bundled one.

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
- Runs write a trace plus the setup needed to replay them; a replay of a known run matches, or
  its divergence is explained (settling, ids, data).
- The cadence (per change, scheduled) is wired or explicitly deferred.

Write properties and actions with `test-bombadil-spec`; triage what runs find with `test-findings`.
