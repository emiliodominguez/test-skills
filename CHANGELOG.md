# Changelog

## Unreleased

- **Breaking (a major release):** `test-bombadil`, `test-bombadil-spec` and
  `test-e2e-to-bombadil` are merged into `test-explore`, and the `bombadil` profile is replaced by
  `generative`. Remove the old skills with `./uninstall.sh` (it now removes retired skills too) or
  `npx skills remove test-bombadil test-bombadil-spec test-e2e-to-bombadil -g -y`.
- Broader scope: skills for every kind of testing. New `test-component`, `test-integration`,
  `test-accessibility`, `test-visual`, `test-performance` and `test-llm`, each with evidence that
  runs here (a seeded bug caught by the recommended test, the fix passing).
- Tool-agnostic exploration: `test-bombadil`, `test-bombadil-spec` and `test-e2e-to-bombadil`
  merge into `test-explore`, with drivers for Bombadil, fast-check + Playwright (new kit:
  `assets/fast-check-explore.mjs`) and Hypothesis + Playwright, all verified on the demo shop.
- `test-properties` covers property-based testing in depth: libraries per language, metamorphic,
  differential and model-based tests, generators, fuzzing; five property shapes proven in
  `test/properties-examples.test.ts`.
- `test-strategy` routes every risk to a test type and ships a catalog of test types.
- `test-e2e` gains driver selection for web, desktop and mobile.
- New profiles: `frontend`, `backend`, `generative`, `ai`; `bombadil` is replaced by `generative`.
- `test-guard` recognizes `__screenshots__/`, `.loki/reference/` and `bitmaps_reference/` baselines,
  flags raised tolerances (`maxDiffPixels`, `maxDiffPixelRatio`, k6 thresholds, Lighthouse
  `maxNumericValue`), lowered Lighthouse `minScore`, fewer property-test runs and removed pinned
  examples, and reads Stryker and Lighthouse CI configs.
- `test-audit` treats screenshot comparisons as visual tests, not `snapshot-only`, and flags property
  tests limited to one or two runs (`tiny-budget`).
- `pnpm verify` runs `scripts/verify-examples.mjs` (accessibility and visual evidence) and the
  fast-check demo.
- Codex: `agents/openai.yaml` per skill, a `.codex-plugin/` manifest and
  `.agents/plugins/marketplace.json`, Codex hook docs, and `scripts/codex-check.mjs` (19 checks
  against the real CLI, including its sandboxes). `mutate.mjs` and `repeat.mjs` fail cleanly or
  degrade when the workspace is read-only.
- `guard-hook.mjs` for agent stop hooks and git hooks, a plugin `hooks/hooks.json`, and
  `docs/HOOKS.md`.
- Bombadil terminal driver: `skills/test-explore/references/bombadil-terminal.md`, a verified `examples/buggy-cli` demo and
  `--terminal` in the runner.
- Runner streams traces (terminal traces reach gigabytes), bounds its log, and prunes clean runs
  with `--prune-clean`.
- CI is manual-only; `pnpm verify` runs the gate and both demos locally.
- `pnpm dogfood`: mutation testing of the bundled scripts with floors (audit 75%, guard 80%, repeat
  85%; measured 89.2%, 90.8% and 94.1%), plus tests for the audit CLI, the guard's edge cases and `repeat.mjs`.
- Fixed: the audit and mutation scanners treated quotes inside regex literals as strings, hiding
  findings and producing invalid mutants.
- Fixed: the guard now flags a test file renamed to a name the runner does not collect.
- Fixed: a mutation run killed outright (SIGKILL, agent timeouts) left a mutant in the source; the
  next run now restores it from `<file>.mutate-backup.json`, and refuses if the file was edited
  since.

## 0.2.0

- New skills: `test-audit`, `test-guard`, `test-flaky`, `test-properties`, `test-e2e-to-bombadil`.
- Zero-dependency scripts bundled with the skills:
    - `audit-tests.mjs`: focused, skipped, assertion-less, tautological, weak, snapshot-only and
      self-mocking tests, swallowed errors, sleeps and retries (JavaScript, TypeScript, Python, Go).
    - `mutate.mjs`: one-file mutation testing with any test command (JavaScript, TypeScript, Python).
    - `guard-tests.mjs`: deleted, skipped, loosened or rewritten tests, snapshot updates, lowered
      thresholds, added retries and exclusions against a base revision.
    - `repeat.mjs`: flakiness measurement with repeated and parallel runs.
    - `bombadil-run.mjs`: Bombadil runner with browser discovery, app start, watchdog, recorded
      setup, finding policy, summary and replay.
    - `page-kit.js`: synthesized stable test ids, injection sentinels, request and responsiveness
      measurements.
    - A typed Bombadil property and action kit.
- `examples/buggy-shop`: a demo store with seeded bugs, verified by `pnpm verify` to be found by the
  spec and to stay silent when fixed.
- Bombadil gotchas found while verifying 0.7.8.

## 0.1.0

- First release: `test-strategy`, `test-unit`, `test-e2e`, `test-policy`, `test-security`,
  `test-bombadil`, `test-bombadil-spec`, `test-findings`.
