---
name: test-policy
description: "Policy tests that read the repository to enforce conventions: import boundaries, i18n parity, docs links and commands, banned patterns. Use when a review comment keeps recurring or a rule lives only in prose. Hands off to `test-unit`."
metadata:
  stage: author
---

# Policy tests

Turn a convention that reviewers keep repeating into a test that reads the repository and lists
every offender. A rule that only lives in a guide drifts; a failing test with a reason does not.

## When a rule deserves a test

- It was broken more than once, or breaking it is costly (a layer importing the platform, a
  missing translation, a dropped error value).
- It can be checked by reading files, without running the application.
- The offender list can be made exact. A rule with many judgment calls belongs in review.

## Process

1. State the rule in one sentence and the reason a contributor will read when it fails.
2. Find the cheapest reliable reader: a glob plus a regular expression for text rules, a JSON or
   YAML parse for catalogs and manifests, the language's compiler API for rules about code shape.
   A regular expression over code that the compiler could answer exactly will false-positive.
3. Collect offenders as `file:line: detail` and assert the list equals `[]`, so one run reports
   all of them.
4. Make allowlists explicit and local to the test. Adding an entry is a reviewed decision; give
   each entry a reason.
5. Prove it bites: introduce one violation, see the test name it, remove it.
6. Keep policy tests in their own project or folder so they run on every change in seconds.

## Rules worth encoding

- **Architecture:** a matrix of "this layer may import X" and "must not import X (reason)".
- **i18n:** every catalog has the same keys, placeholders and plural forms; every key used in
  code exists; every key exists for a reason; every error code has a message.
- **Documentation:** every relative link and anchor resolves; every command the docs tell people
  to run is a real script; every documented environment variable is read by the code and vice
  versa; lists of tests or tours in the docs match the files.
- **Code shape:** results or promises that are created and dropped; native form controls used
  outside the component library; unsafe options in security-sensitive constructors.
- **Data:** migration ids unique and sequential; identifiers follow the naming scheme.
- **Typography and wording:** banned characters or terms in user-facing text.

## Anti-patterns

- A test that passes because its glob matches no files. Assert the scanned set is non-empty.
- Snapshotting the whole repository state instead of asserting a rule.
- A silent allowlist that grows without reasons.
- Duplicating a rule the linter already enforces.

## Done when

- The rule, its reason and its allowlist are in the test, and a seeded violation failed it.
- It runs in the fast gate on every change.
- Existing offenders are fixed or explicitly allowlisted with reasons.

Continue with `test-unit` for behavior that needs execution, not reading.
