---
name: test-guard
description: "Guard that diffs a change against its base and flags weakened tests: deleted or skipped cases, loosened or rewritten assertions, re-recorded snapshots, lowered thresholds, retries. Use before committing agent work or in CI. Hands off to `test-audit`."
metadata:
  stage: triage
---

# Test guard

A green run after a change proves nothing if the change also edited the tests. Before calling
work done, check that no test was deleted, skipped, loosened or bent to match the code.

## Process

1. **Run the guard** from this skill's folder, at the repository root:

   ```sh
   node scripts/guard-tests.mjs                 # vs the merge base with the default branch
   node scripts/guard-tests.mjs --base HEAD     # only uncommitted changes
   node scripts/guard-tests.mjs --json          # for tooling
   ```

   It compares the working tree, untracked files included, with the base and reports:

   | Rule | Level | Meaning |
   | --- | --- | --- |
   | `deleted-test-file` | error | A test file is gone |
   | `removed-tests` | error | Fewer test cases than before, with the missing titles |
   | `added-focus`, `added-skip` | error | New `.only`, `.skip`, `xfail`, `t.Skip` |
   | `weakened-assertion` | error | Exact matchers replaced by existence or truthiness checks |
   | `lowered-threshold` | error | Coverage or mutation thresholds went down |
   | `added-retries` | error | More retries in a runner config |
   | `removed-assertions` | warn | Fewer assertions in a test file |
   | `changed-expectation` | warn | Same subject, different expected value: `toBe(3)` became `toBe(4)` |
   | `updated-snapshots` | warn | Snapshot or golden files changed |
   | `excluded-tests` | warn | New exclude or ignore patterns in a test config |
   | `no-test-changes` | info | Source changed and no test did |

   Exit `1` means something was weakened; `0` means nothing was; `2` is a usage or git error.
2. **Resolve every error.** For each finding, either restore the test or state in the change
   description why it is right: the behavior was removed on purpose, the case moved (name the
   new test), or the requirement changed (name where it was decided). The guard cannot tell a
   legitimate removal from a hidden failure; the justification is the review.
3. **Read every changed expectation.** A rewritten expected value is legitimate only when the
   requirement changed. If the code changed and the test was edited until it passed, revert the
   test edit and fix the code.
4. **Read every snapshot diff** line by line. Accept only differences the change intended.
5. **Report** the guard output with the justification next to each error, so a reviewer sees both.

## Wiring it in

- **Per change, locally:** a pre-commit hook running `node <path>/guard-tests.mjs --base HEAD`.
- **At the end of an agent session:** run it before claiming the work is done, and include its
  output in the summary.
- **In CI:** run it on change requests against the target branch (`--base origin/main`) with
  enough history fetched for the merge base, and require a justification for each error.

## Red flags

- "The test was wrong, so I updated the expected value": show where the requirement says so.
- "That test was flaky, so I skipped it": skipping is a decision with an owner and a date.
- "Snapshots needed updating": which lines changed, and why is each change intended?
- "Coverage dropped because of generated code": exclude the generated code by path, then keep the threshold.

## Anti-patterns

- Making the guard quiet by editing tests further instead of restoring them.
- Running it only against `HEAD` after committing, which hides committed weakening.
- Treating `warn` as noise: rewritten expectations are where bent tests hide.

## Done when

- The guard ran against the right base, and its output is in the report.
- Every error is reverted or justified with a reason a reviewer can check.
- Changed expectations and snapshots were read, not bulk-accepted.

Audit what remains with `test-audit`.
