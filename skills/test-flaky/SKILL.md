---
name: test-flaky
description: "Flaky test diagnosis: measure the failure rate, find the nondeterminism, fix it at the source, prove the fix by repetition. Use when a test fails intermittently, passes on retry or only fails in CI. Hands off to `test-findings` or `test-e2e`."
metadata:
  stage: triage
---

# Flaky tests

A flaky test is a real nondeterminism, in the test or in the product. Measure it, name the
source, remove it, and prove the fix with the same measurement. Never hide it behind a retry.

## Process

1. **Measure before touching anything.** Run the single test or file many times with the bundled
   script from this skill's folder, and keep the logs of failing runs:

   ```sh
   node scripts/repeat.mjs --runs 50 -- <test command for one file>
   node scripts/repeat.mjs --runs 200 --until-fail -- <command>
   node scripts/repeat.mjs --runs 30 --parallel 4 -- <command>   # add contention
   ```

   Record the failure rate. A test that fails 1 in 50 needs about 150 clean runs before a fix
   can be called proven (3x the expected interval, for roughly 95% confidence).
2. **Reproduce the conditions.** Run it alone and with its neighbors, in the CI order and
   reversed, with a fixed and a random seed, in the CI time zone and locale, with parallel
   workers, and under CPU contention. The condition that changes the rate is the lead.
3. **Classify the source** from the failing logs:

   | Source | Signals | Fix at the source |
   | --- | --- | --- |
   | Order or shared state | Fails with neighbors, passes alone | Fresh state per test; no module-level mutable state; reset fakes |
   | Time | Fails near midnight, month end, DST, other zones | Inject a clock; pin the time zone; never assert on "now" |
   | Randomness | Fails with some seeds | Seed it, log the seed, make the generator injectable |
   | Async and timing | Fails under load; sleeps nearby | Wait for an observable condition; await every promise |
   | Network or services | Timeouts, connection resets | Fake at the protocol boundary; no live third parties in tests |
   | Concurrency | Fails with parallel workers | Unique resources per worker: ports, temp dirs, database schemas |
   | Resource leaks | Fails late in long runs | Close handles, servers and watchers in teardown |
   | Locators (UI) | Element detached, strict-mode violations | Semantic locators; wait on state, not on time |
   | Product race | Fails under real timing | It is a bug: write a deterministic test that forces the interleaving |

4. **Fix and re-measure** with the same command and at least the run count from step 1. Show the
   before and after rates.
5. **If it cannot be fixed now,** quarantine it visibly: an owner, a reason, a date, and the test
   still runs in a non-blocking job so the rate stays known. A quarantine is missing coverage.

## Red flags

- "Add a retry": the retry turns a known failure rate into an invisible one.
- "Increase the timeout": only when the operation is legitimately slow; name the measured duration.
- "It passed 5 times in a row": at a 1-in-50 rate that is expected even without a fix.
- "Only CI is flaky": CI has different cores, time zone, order and load; reproduce those.

## Anti-patterns

- Fixing a flaky test without measuring the rate before and after.
- Sleeps as a fix, or deleting the assertion that failed.
- Blaming the framework before ruling out shared state and time.
- A quarantine without an owner and an expiry.

## Done when

- The failure rate before, the named source and the rate after are reported with the commands.
- The fix removes the nondeterminism instead of hiding it.
- Any remaining quarantine has an owner, a reason and a date.

Triage a product race with `test-findings`; rewrite unstable UI tests with `test-e2e`.
