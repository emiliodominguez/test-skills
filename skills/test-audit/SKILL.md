---
name: test-audit
description: "Audit of tests that cannot fail: no assertions, tautologies, mocks of the unit, skips, sleeps, then mutants to prove the rest bite. Use when reviewing agent-written tests, suspecting fake coverage or before trusting a green suite. Hands off to `test-unit` or `test-guard`."
metadata:
  stage: triage
---

# Test audit

A test earns trust only by failing when the behavior breaks. Find the tests that cannot fail,
then prove the remaining ones can, by breaking the code on purpose.

## Process

1. **Scan.** Run the bundled scanner from this skill's folder over the suite or the changed files:

   ```sh
   node scripts/audit-tests.mjs [paths...]            # human report, exit 1 on errors
   node scripts/audit-tests.mjs --json [paths...]     # for further processing
   ```

   It reads JavaScript and TypeScript, Python and Go tests plus runner configs, and reports:

   | Rule | Meaning |
   | --- | --- |
   | `focused` | `.only`, `fit`, `fdescribe`: every other test silently stops running |
   | `skipped` | `.skip`, `xit`, `pytest.mark.skip`, `t.Skip`: missing coverage |
   | `no-assertion` | A test body with no assertion: it passes whatever the code does |
   | `tautology` | `expect(true).toBe(true)`, `expect(x).toBe(x)`, `assert True` |
   | `weak-assertion` | Only `toBeDefined`, `toBeTruthy`, `not.toThrow`, bare `toHaveBeenCalled` |
   | `snapshot-only` | Only snapshots, which get re-recorded without review |
   | `mocks-subject` | `cart.test.ts` mocks `./cart`: the test checks the mock |
   | `swallowed` | Empty `catch`, `.catch(() => {})`, `except: pass` |
   | `sleep` | Fixed delays: slow and flaky |
   | `retries` | Runner retries that hide failures |
   | `expected-failure` | `test.fails`, `xfail`: passes while the bug exists |

   The scanner uses patterns, not a parser. Treat each finding as a lead, read the test, and
   silence reviewed false positives with `// audit-tests-ignore <rule>: <reason>`.
2. **Read what the scanner cannot judge.** For each test in scope:
   - Does the name match what is asserted? "rejects expired cards" must assert a rejection.
   - Is the expected value computed independently, or copied from the implementation's output?
     A value pasted from a run freezes whatever the code did, bugs included.
   - Is the oracle the code itself (calling the function under test to build the expectation)?
   - How many mocks? A test that mocks everything except one line tests the wiring of mocks.
   - Are assertions inside conditionals or loops that may run zero times?
3. **Prove the rest bite (mutation check).** For the code the tests claim to cover, introduce one
   small fault at a time and run only the relevant tests:
   - flip a comparison (`<` to `<=`), negate a condition, drop an `else` branch;
   - change a constant or boundary by one, return early with a default;
   - delete a call with a side effect (save, emit, validate).

   Every mutant must make at least one test fail. A surviving mutant is a missing assertion;
   name it. Run the bundled mutation script per source file; it applies each mutant, runs the
   tests, restores the file and lists the survivors:

   ```sh
   node scripts/mutate.mjs --file src/pricing.ts -- <command that runs only the related tests>
   node scripts/mutate.mjs --file app/pricing.py --lines 10-60 --min-score 80 -- pytest tests/test_pricing.py -x -q
   ```

   Point it at the files the change touched and a fast, focused test command; each mutant is a
   full run. If the repository already has a mutation tool configured (for example Stryker,
   mutmut or go-mutesting), use that instead and report its score with the surviving mutants.
4. **Report.** Group by severity: tests that cannot fail, tests that check mocks, surviving
   mutants, flakiness risks. For each: file and line, why it cannot catch a regression, and the
   assertion or change that would fix it. Fix them only when asked.

## Red flags

- "The suite is green and coverage is 90%": coverage counts executed lines, not checked ones.
- "The test name says it checks X": read the assertions; names do not fail.
- "Mutation testing is too slow": run it with `--lines` on the lines the change touched.
- "I'll just update the snapshot": a snapshot accepted without reading the diff is a deleted test.

## Anti-patterns

- Rewriting tests to make the scanner quiet without improving what they check.
- Counting assertions as quality; one exact assertion beats five existence checks.
- Leaving a mutant in the code, or committing the ignore comments without reasons.
- Auditing only the new tests when the change also edited old ones.

## Done when

- The scanner ran on the scope, and each finding is fixed, justified or listed.
- Key behaviors have a mutation result: killed, or surviving with the missing assertion named.
- The report lists file, line, problem and fix for every test that cannot fail.

Fix weak tests with `test-unit`; keep them from regressing with `test-guard`.
