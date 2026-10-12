# Changelog

## Unreleased

- Bombadil terminal driver: `references/terminal.md`, a verified `examples/buggy-cli` demo and
  `--terminal` in the runner.
- Runner streams traces (terminal traces reach gigabytes), bounds its log, and prunes clean runs
  with `--prune-clean`.
- CI is manual-only; `pnpm verify` runs the gate and both demos locally.

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
