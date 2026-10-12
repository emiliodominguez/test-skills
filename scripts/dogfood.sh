#!/bin/sh
# Mutation-test the bundled scripts with the suite's own mutate.mjs. Each must keep its score.
# Slow (tens of minutes): run before a release, not on every change.
set -eu

MUTATE=skills/test-audit/scripts/mutate.mjs

node "$MUTATE" --file skills/test-audit/scripts/audit-tests.mjs --max 120 --min-score 75 -- npx vitest run test/audit.test.ts test/audit-cli.test.ts
node "$MUTATE" --file skills/test-guard/scripts/guard-tests.mjs --max 120 --min-score 80 -- npx vitest run test/guard.test.ts test/guard-more.test.ts test/hook.test.ts
node "$MUTATE" --file skills/test-flaky/scripts/repeat.mjs --min-score 85 -- npx vitest run test/repeat.test.ts
